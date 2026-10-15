import { Project, SourceFile, SyntaxKind, Node } from "ts-morph";

// ============================================================
// AST-BASED SIGNAL RESOLUTION
//
// Regex can't tell whether `new Pool()` came from `import { Pool }
// from 'pg'` or from some unrelated worker-pool library — it just
// matches the text. This module fixes that class of bug by
// actually resolving identifiers back through the file's real
// import/require statements before counting them as evidence.
//
// A single shared ts-morph Project is reused across files (created
// once, source files added/forgotten per call) since this runs in
// a background batch job, not on the request path — creating a
// fresh Project per file would be wasteful but is not correctness-
// critical either way.
// ============================================================

const project = new Project({
  useInMemoryFileSystem: true,
  compilerOptions: { allowJs: true, jsx: 4 /* ts.JsxEmit.Preserve */ },
});

export interface AstSignal {
  name: string; // canonical skill name
  signal: string;
  count: number;
}

// --------------------------------------------------------------
// RULES
//
// Each rule describes one skill that can ONLY be trusted via
// import resolution -- i.e. its telltale identifiers (class names,
// bare function names, method names) are too generic to match on
// their own. Anything not listed here is left to the existing
// regex TECH_PATTERNS in analyze-skills.ts, which already require
// a distinctive, non-generic token (e.g. `mongoose.model(`,
// `z.object(`) and don't need AST verification.
// --------------------------------------------------------------

interface AstRule {
  skillName: string;
  signal: string;
  packageNames: string[]; // any import from these packages satisfies the rule
  constructorNames?: string[]; // `new X(...)` where X resolves to packageNames
  methodNames?: string[]; // `<trustedInstance>.method(...)` where the instance
  //                          was constructed via constructorNames above
  namespaceMethodNames?: string[]; // `<namespaceImport>.method(...)` directly
  bareFunctionNames?: string[]; // `fn(...)` where fn is a named import
}

const AST_RULES: AstRule[] = [
  {
    skillName: "PostgreSQL",
    signal: "PostgreSQL client usage (import-verified)",
    packageNames: ["pg"],
    constructorNames: ["Pool", "Client"],
    methodNames: ["query", "connect"],
    namespaceMethodNames: [], // `pg.Pool`/`pg.Client` handled by constructorNames via namespace resolution below
  },
  {
    skillName: "MySQL",
    signal: "MySQL client usage (import-verified)",
    packageNames: ["mysql", "mysql2"],
    namespaceMethodNames: [
      "createPool",
      "createConnection",
      "query",
      "execute",
    ],
  },
  {
    skillName: "Neo4j",
    signal: "Neo4j driver usage (import-verified)",
    packageNames: ["neo4j-driver"],
    constructorNames: [],
    namespaceMethodNames: ["driver"],
    methodNames: ["session"],
  },
  {
    skillName: "BullMQ",
    signal: "BullMQ queue/worker usage (import-verified)",
    packageNames: ["bullmq"],
    constructorNames: ["Queue", "Worker", "QueueEvents"],
    methodNames: ["add", "process"],
  },
  {
    skillName: "Vue",
    signal: "Vue reactivity API usage (import-verified)",
    packageNames: ["vue"],
    bareFunctionNames: [
      "ref",
      "computed",
      "watch",
      "reactive",
      "watchEffect",
      "onMounted",
      "defineComponent",
    ],
  },
  {
    skillName: "Chroma",
    signal: "Chroma vector database usage (import-verified)",
    packageNames: ["chromadb"],
    constructorNames: ["ChromaClient"],
    methodNames: ["add", "query", "getOrCreateCollection"],
  },
  {
    skillName: "Pinecone",
    signal: "Pinecone vector database usage (import-verified)",
    packageNames: ["@pinecone-database/pinecone"],
    constructorNames: ["Pinecone"],
    methodNames: ["upsert", "query", "deleteMany", "fetch"],
  },
  {
    skillName: "LlamaIndex",
    signal: "LlamaIndex retrieval framework usage (import-verified)",
    packageNames: ["llamaindex"],
    constructorNames: ["VectorStoreIndex", "Document", "QueryEngine"],
  },
  {
    skillName: "MongoDB",
    signal: "MongoDB client usage (import-verified)",
    packageNames: ["mongodb"],
    constructorNames: ["MongoClient"],
    methodNames: [
      "findOne",
      "findOneAndUpdate",
      "insertOne",
      "updateOne",
      "deleteOne",
      "insertMany",
      "updateMany",
      "deleteMany",
    ],
  },
];

// --------------------------------------------------------------
// IMPORT / REQUIRE RESOLUTION
//
// Builds three maps for a file:
//   namedImports:     localName -> packageName   (import { Pool } from 'pg')
//   namespaceImports:  localName -> packageName   (import * as pg from 'pg')
//   defaultImports:    localName -> packageName   (import pg from 'pg')
// require() destructuring and `const pg = require('pg')` are folded
// into the same maps.
// --------------------------------------------------------------

interface ImportMaps {
  named: Map<string, string>;
  namespace: Map<string, string>;
}

function buildImportMaps(sourceFile: SourceFile): ImportMaps {
  const named = new Map<string, string>();
  const namespace = new Map<string, string>();

  for (const decl of sourceFile.getImportDeclarations()) {
    let pkg: string;
    try {
      pkg = decl.getModuleSpecifierValue();
    } catch {
      // Module specifier isn't a plain string literal -- can happen on
      // truncated/malformed diff fragments where the import statement
      // never fully closed. This one import can't be resolved to a
      // package, so skip it rather than failing the whole file.
      continue;
    }

    for (const ni of decl.getNamedImports()) {
      const local = ni.getAliasNode()?.getText() ?? ni.getName();
      named.set(local, pkg);
    }

    const defaultImport = decl.getDefaultImport();
    if (defaultImport) named.set(defaultImport.getText(), pkg);

    const namespaceImport = decl.getNamespaceImport();
    if (namespaceImport) namespace.set(namespaceImport.getText(), pkg);
  }

  // require('pkg') forms: const x = require('pkg'); const { a, b } = require('pkg');
  for (const varDecl of sourceFile.getDescendantsOfKind(
    SyntaxKind.VariableDeclaration,
  )) {
    const initializer = varDecl.getInitializer();
    if (!initializer || !Node.isCallExpression(initializer)) continue;
    if (initializer.getExpression().getText() !== "require") continue;

    const arg = initializer.getArguments()[0];
    if (!arg || !Node.isStringLiteral(arg)) continue;
    const pkg = arg.getLiteralValue();

    const nameNode = varDecl.getNameNode();
    if (Node.isIdentifier(nameNode)) {
      // const pg = require('pg')  -> treat like a namespace import
      namespace.set(nameNode.getText(), pkg);
    } else if (Node.isObjectBindingPattern(nameNode)) {
      // const { Pool } = require('pg') -> treat like named imports
      for (const el of nameNode.getElements()) {
        const propertyName =
          el.getPropertyNameNode()?.getText() ?? el.getName();
        named.set(el.getName(), pkg);
        void propertyName;
      }
    }
  }

  return { named, namespace };
}

function resolvesToPackage(
  identifier: string,
  packageNames: string[],
  maps: ImportMaps,
): boolean {
  const resolved = maps.named.get(identifier) ?? maps.namespace.get(identifier);
  return !!resolved && packageNames.includes(resolved);
}

// --------------------------------------------------------------
// TRUSTED RECEIVER TRACKING
//
// Finds every `const x = new Ctor(...)` (or `this.x = new Ctor(...)`,
// or `private x = new Ctor(...)` class field) where Ctor resolves to
// one of the rule's expected packages, and records the receiver's
// text ("x" or "this.x") as trustworthy for that rule.
// --------------------------------------------------------------

function findTrustedReceivers(
  sourceFile: SourceFile,
  rule: AstRule,
  maps: ImportMaps,
): Set<string> {
  const trusted = new Set<string>();
  if (!rule.constructorNames || rule.constructorNames.length === 0)
    return trusted;

  const newExpressions = sourceFile.getDescendantsOfKind(
    SyntaxKind.NewExpression,
  );

  for (const newExpr of newExpressions) {
    const calleeText = newExpr.getExpression().getText(); // "Pool" or "pg.Pool"
    const [nsOrName, maybeMember] = calleeText.split(".");

    let verified = false;
    if (maybeMember) {
      // namespaced form: pg.Pool -- verify "pg" resolves to an expected package
      verified =
        rule.constructorNames.includes(maybeMember) &&
        resolvesToPackage(nsOrName, rule.packageNames, maps);
    } else {
      // bare form: Pool -- verify "Pool" was imported (named) from an expected package
      verified =
        rule.constructorNames.includes(nsOrName) &&
        resolvesToPackage(nsOrName, rule.packageNames, maps);
    }
    if (!verified) continue;

    // walk up to the enclosing declaration to capture the receiver name
    const varDecl = newExpr.getFirstAncestorByKind(
      SyntaxKind.VariableDeclaration,
    );
    if (varDecl) {
      trusted.add(varDecl.getName());
      continue;
    }
    const propDecl = newExpr.getFirstAncestorByKind(
      SyntaxKind.PropertyDeclaration,
    );
    if (propDecl) {
      trusted.add(`this.${propDecl.getName()}`);
      continue;
    }
    const binaryExpr = newExpr.getFirstAncestorByKind(
      SyntaxKind.BinaryExpression,
    );
    if (binaryExpr && binaryExpr.getOperatorToken().getText() === "=") {
      trusted.add(binaryExpr.getLeft().getText()); // e.g. "this.pool ="
    }
  }

  return trusted;
}

// --------------------------------------------------------------
// MAIN ENTRY POINT
// --------------------------------------------------------------

export function extractAstVerifiedSignals(
  code: string,
  path: string,
): AstSignal[] {
  const results: AstSignal[] = [];

  let sourceFile: SourceFile;
  try {
    sourceFile = project.createSourceFile(
      `__tmp__/${Date.now()}_${path.replace(/[^a-zA-Z0-9.]/g, "_")}`,
      code,
      {
        overwrite: true,
      },
    );
  } catch {
    return results; // unparseable snippet (partial diff, non-JS/TS file) -- fail closed, no signal
  }

  try {
    const maps = buildImportMaps(sourceFile);

    for (const rule of AST_RULES) {
      let count = 0;

      // 1. bare function calls: ref(...), computed(...) etc, verified via import
      if (rule.bareFunctionNames) {
        for (const call of sourceFile.getDescendantsOfKind(
          SyntaxKind.CallExpression,
        )) {
          const expr = call.getExpression();
          if (!Node.isIdentifier(expr)) continue;
          const name = expr.getText();
          if (
            rule.bareFunctionNames.includes(name) &&
            resolvesToPackage(name, rule.packageNames, maps)
          ) {
            count++;
          }
        }
      }

      // 2. namespace-qualified calls: pg.Pool(...), mysql.createPool(...)
      if (rule.namespaceMethodNames) {
        for (const call of sourceFile.getDescendantsOfKind(
          SyntaxKind.CallExpression,
        )) {
          const expr = call.getExpression();
          if (!Node.isPropertyAccessExpression(expr)) continue;
          const receiver = expr.getExpression().getText();
          const method = expr.getName();
          if (
            rule.namespaceMethodNames.includes(method) &&
            resolvesToPackage(receiver, rule.packageNames, maps)
          ) {
            count++;
          }
        }
      }

      // 3. method calls on a trusted instance: pool.query(...), this.pool.query(...)
      if (rule.methodNames && rule.constructorNames) {
        const trusted = findTrustedReceivers(sourceFile, rule, maps);
        if (trusted.size > 0) {
          for (const call of sourceFile.getDescendantsOfKind(
            SyntaxKind.CallExpression,
          )) {
            const expr = call.getExpression();
            if (!Node.isPropertyAccessExpression(expr)) continue;
            const receiver = expr.getExpression().getText();
            const method = expr.getName();
            if (rule.methodNames.includes(method) && trusted.has(receiver)) {
              count++;
            }
          }
        }
      }

      if (count > 0) {
        results.push({ name: rule.skillName, signal: rule.signal, count });
      }
    }
  } catch (err) {
    // Any other unexpected ts-morph traversal failure on a malformed/
    // truncated diff fragment (e.g. an unusual node shape a specific
    // getXValue()/getName() call didn't expect) should degrade this
    // one file to "no AST-verified signals" rather than crashing the
    // entire extraction run across thousands of files.
    console.warn(
      `⚠️ AST signal extraction failed for ${path}, skipping this file's AST signals:`,
      err instanceof Error ? err.message : err,
    );
  } finally {
    sourceFile.forget(); // free memory -- this is an in-memory project reused across many files
  }

  return results;
}
