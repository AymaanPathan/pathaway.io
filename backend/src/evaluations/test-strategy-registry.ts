import { extractJson, type LlmClient } from "../agents/goal-agent.js";
import type { MissionSpec, Row } from "../graph/mission-graph.js";
import type {
  ChangedFile,
  ExecutionPlan,
  MissionTestPlan,
  MockPlan,
  RepoProfile,
  StrategyId,
  TestCase,
} from "./types.js";
import {
  PROVISIONABLE_STORES,
  TEST_FILE,
  ask,
  clip,
  escapeRe,
  txt,
} from "./utils.js";

export const RUNNER_SUPPORTS_BROWSER = false;

/** Bump when the generator or reviewer prompts change: stored test files are then rewritten. */
export const TEST_GEN_VERSION = "5";

export interface Availability {
  ok: boolean;
  reason: string;
}

export interface StrategyDef {
  id: StrategyId;
  label: string;
  where: "inline" | "sandbox";
  summary: string;
  /** rules given to the LLM that writes the test file (sandbox strategies only) */
  guide: string;
  availability: (profile: RepoProfile) => Availability;
}

const OK: Availability = { ok: true, reason: "" };

const canBoot = (p: RepoProfile): Availability =>
  p.startCommand
    ? OK
    : {
        ok: false,
        reason:
          "package.json has no start or dev script, so the server cannot be booted for HTTP tests.",
      };

export const STRATEGIES: Record<StrategyId, StrategyDef> = {
  static: {
    id: "static",
    label: "Static check",
    where: "inline",
    summary:
      "Reads the pushed code: the implementation files changed and the required library is really imported.",
    guide: "",
    availability: () => OK,
  },
  unit: {
    id: "unit",
    label: "Unit test",
    where: "sandbox",
    summary: "Imports the developer's function and calls it directly.",
    guide:
      "UNIT: import the exported function/class with a relative path and call it. Mock collaborators with vi.mock or injected fakes. Assert return values, thrown errors and call counts.",
    availability: () => OK,
  },
  integration: {
    id: "integration",
    label: "Integration test (mocked client)",
    where: "sandbox",
    summary:
      "Imports the developer's code and replaces the contract library's client with a mock, then asserts the interaction.",
    guide:
      'INTEGRATION: mock the contract library with vi.mock("<package>", ...) or an injected fake and assert the calls it received (keys written, values read back, TTLs, deletions). A test a plain in-memory Map would pass is invalid.',
    availability: () => OK,
  },
  http: {
    id: "http",
    label: "HTTP / API test",
    where: "sandbox",
    summary: "Boots the server and calls its endpoints with fetch.",
    guide:
      "HTTP: call the running server with fetch(`${process.env.MISSION_BASE_URL}/path`). Assert status codes, JSON bodies and headers. Do not import the developer's code. Use unique ids per test so tests are independent.",
    availability: canBoot,
  },
  database: {
    id: "database",
    label: "Database test (through the API)",
    where: "sandbox",
    summary:
      "Boots the server with a provisioned database and checks persistence by writing and reading back over HTTP.",
    guide:
      "DATABASE: a real database is provisioned and the server is connected to it. Through HTTP only: write data, read it back, update, delete, and assert it persists across separate requests. Never connect to the database directly. Use unique ids per test.",
    availability: (p) => {
      const boot = canBoot(p);
      if (!boot.ok) return boot;
      if (!p.dataStores.length)
        return {
          ok: false,
          reason: "No database client was detected in dependencies.",
        };
      const bad = p.dataStores.filter(
        (s) => !PROVISIONABLE_STORES.includes(s.kind),
      );
      if (bad.length)
        return {
          ok: false,
          reason: `The sandbox cannot provision ${bad.map((s) => s.kind).join(", ")} yet.`,
        };
      return OK;
    },
  },
  browser: {
    id: "browser",
    label: "Browser / E2E test",
    where: "sandbox",
    summary: "Drives a real browser against the running app.",
    guide: "BROWSER: not generated yet.",
    availability: (p) =>
      RUNNER_SUPPORTS_BROWSER
        ? canBoot(p)
        : {
            ok: false,
            reason:
              "Browser/E2E checks need a headless browser, which the sandbox runner does not provide yet.",
          },
  },
};

export const strategyAvailability = (
  id: StrategyId,
  profile: RepoProfile,
): Availability => STRATEGIES[id].availability(profile);

export function runStaticChecks(
  spec: MissionSpec,
  testPlan: MissionTestPlan,
  code: Map<string, string>,
  changed: ChangedFile[],
): TestCase[] {
  const cases: TestCase[] = [];
  const changedPaths = new Set(
    changed.filter((c) => c.status !== "removed").map((c) => c.path),
  );
  const scopePaths = [
    spec.scope.startPath,
    ...spec.scope.modifyPaths,
    ...spec.scope.createPaths,
  ];
  const sources = [...code.entries()].filter(([p]) => !TEST_FILE.test(p));
  const lib = spec.contract?.library ?? null;

  for (const c of testPlan.criteria) {
    if (c.strategy !== "static" || !c.available) continue;

    const touched = scopePaths.filter((p) => changedPaths.has(p));
    cases.push({
      id: c.id,
      name: `${c.id} static: implementation files changed`,
      status: touched.length ? "passed" : "failed",
      message: touched.length
        ? ""
        : `None of ${scopePaths.slice(0, 4).join(", ")} changed in this push.`,
    });

    if (lib && c.needsMechanism) {
      const re = new RegExp(
        `(from\\s+|require\\(\\s*|import\\(\\s*)["']${escapeRe(lib)}(/[^"']*)?["']`,
      );
      const hit = sources.find(([, body]) => re.test(body));
      cases.push({
        id: c.id,
        name: `${c.id} static: ${lib} is imported`,
        status: hit ? "passed" : "failed",
        message: hit ? "" : `No source file imports ${lib}.`,
      });
    }
  }
  return cases;
}

/* ------------------------------------------------------------------ */
/* what the developer's files really export                            */
/* ------------------------------------------------------------------ */

/** Names a source file exports. Guides the LLM and catches invented imports. */
export function exportsOf(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(
    /export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|enum|interface|type)\s+([A-Za-z_$][\w$]*)/g,
  ))
    out.add(m[1]);
  for (const m of src.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}/g))
    for (const part of m[1].split(",")) {
      const n = part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (n) out.add(n);
    }
  if (/export\s+default\b/.test(src)) out.add("default");
  return [...out];
}

function joinPath(base: string, rel: string): string {
  const parts = base.split("/").filter(Boolean);
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

const stem = (p: string): string => p.replace(/\.(tsx?|jsx?|mjs|cjs)$/, "");

const testDir = (root: string): string =>
  root ? `${root}/__mission__` : "__mission__";

/** Resolves an import written in <root>/__mission__/mission.test.ts to a repo file. */
function resolveRel(
  specifier: string,
  root: string,
  repo: Map<string, string>,
): string | null {
  const target = joinPath(testDir(root), specifier);
  const base = stem(target);
  const exts = [
    "",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    "/index.ts",
    "/index.tsx",
    "/index.js",
  ];
  for (const t of [target, base])
    for (const x of exts) if (repo.has(`${t}${x}`)) return `${t}${x}`;
  return null;
}

/**
 * Problems with the relative imports of a module-mode test: files that do not
 * exist, or names the file does not export. These are "soft": a file or export
 * the mission asks the developer to create may legitimately be missing, so
 * they only trigger a rewrite, they never stop the run on the last attempt.
 */
export function importProblems(
  code: string,
  plan: ExecutionPlan,
  spec: MissionSpec,
  repo: Map<string, string>,
): string[] {
  if (plan.mode !== "module" || !repo.size) return [];
  const root = plan.root;
  const scopeStems = new Set(
    [
      spec.scope.startPath,
      ...spec.scope.modifyPaths,
      ...spec.scope.createPaths,
    ].map(stem),
  );
  const out: string[] = [];

  const paths = new Set<string>();
  for (const m of code.matchAll(
    /(?:from\s*|import\(\s*|vi\.(?:mock|doMock)\(\s*)["'](\.{1,2}\/[^"']+)["']/g,
  ))
    paths.add(m[1]);

  for (const sp of paths) {
    if (/\.(json|css|svg|png|jpg|html)$/.test(sp)) continue;
    if (resolveRel(sp, root, repo)) continue;
    const t = stem(joinPath(testDir(root), sp));
    // a file the mission tells the developer to create: its absence is the developer's gap
    if (scopeStems.has(t) || scopeStems.has(`${t}/index`)) continue;
    out.push(
      `the test imports "${sp}" but no such file exists in the repository; use only real paths from DATA.exports`,
    );
  }

  const named = [
    /import\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*["'](\.{1,2}\/[^"']+)["']/g,
    /\{([^}]*)\}\s*=\s*await\s+import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g,
  ];
  for (const re of named)
    for (const m of code.matchAll(re)) {
      const file = resolveRel(m[2], root, repo);
      if (!file) continue;
      const src = repo.get(file) ?? "";
      if (!src || /export\s*\*/.test(src)) continue;
      const have = new Set(exportsOf(src));
      const want = m[1]
        .split(",")
        .map((n) =>
          n
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+|\s*:\s*/)[0]
            .trim(),
        )
        .filter(Boolean);
      const missing = want.filter((n) => !have.has(n));
      if (missing.length)
        out.push(
          `"${m[2]}" does not export ${missing.join(", ")}; it exports: ${[...have].join(", ") || "nothing"}`,
        );
    }
  return out.slice(0, 5);
}

/** true when at least one sandboxed criterion must prove a library is used */
export const testPlanNeedsMechanism = (testPlan: MissionTestPlan): boolean =>
  testPlan.criteria.some(
    (c) => testPlan.sandboxCriteria.includes(c.id) && c.needsMechanism,
  );

/* ------------------------------------------------------------------ */
/* sandbox strategies: LLM writes one vitest file                      */
/* ------------------------------------------------------------------ */

export interface GenerateInput {
  spec: MissionSpec;
  plan: ExecutionPlan;
  testPlan: MissionTestPlan;
  profile: RepoProfile;
  mocks: MockPlan[];
  /** pushed code: path -> content (changed + scope files) */
  code: Map<string, string>;
  /** every text file of the repository, used to verify the imports of the generated test */
  repoFiles?: Map<string, string>;
  changed: ChangedFile[];
  /** why the previous version of the test file could not run, so the rewrite fixes it */
  feedback?: string;
  timeoutMs?: number;
}

const BASE_RULES = `You write ONE vitest test file for a developer's mission. The developer was shown ONLY the mission's objective, steps, contract and acceptance criteria. Your tests must check exactly that, so what the developer was told and what the tests check are the same thing.

A wrong test is the worst outcome: it makes a correct solution fail, and the developer can then never finish the mission. A test that passes a wrong solution is nearly as bad. Take the time to trace every scenario through the code before you write it.

Rules:
1. Import { describe, it, expect, vi, beforeEach, afterEach } from "vitest". TypeScript.
2. Create exactly one top-level describe per criterion listed in DATA.criteria, titled "AC1: <the criterion's description, shortened>", "AC2: ...". The id MUST be the first token of the title and must be exactly the "id" given in DATA.criteria. Every test for that criterion lives inside it. Do not write tests for criteria that are not listed.
3. Test EXACTLY what the criterion states and nothing more. Each criterion has a "how" field: it describes the scenario the developer was told will be checked, so build your test from it. Never assert behaviour that no criterion mentions. If the criterion does not fix a value (an error message, a field name, a log line, a key format), assert loosely (type, truthiness, toContain, a regex) and never an exact string you invented. A correct implementation that follows the criteria must pass. If the pushed code does not do what the criterion says, the test must FAIL: never bend an assertion to match what the code happens to do.
4. Use only exports, routes and names that really exist in the pushed code (see DATA.exports and PUSHED CODE). Read the real signatures and call them exactly as defined. Never invent an API. If the code exposes a factory or accepts an injected client, use that. If the mission asks the developer to create something that does not exist yet, import it from the path in DATA.scope; the test will then fail, which is correct.
5. PROVE THE MECHANISM: when the contract names a library or service, mock that library's client (vi.mock("<package>", ...)) or inject a fake, and assert the calls it received. A test a plain in-memory Map would pass is invalid.
6. No real network, no real credentials, no child_process, no process.exit, no fs writes. Use vi.useFakeTimers() for TTL/time behaviour when needed. NEVER call vi.runAllTimers() or vi.runAllTimersAsync() before asserting an intermediate-time condition. Advance only the intended interval with await vi.advanceTimersByTimeAsync(ms), then assert. Restore real timers in afterEach.
7. In "module" mode: the file lives at <packageRoot>/__mission__/mission.test.ts. Import the developer's code with a relative path such as "../src/foo" (no extension). Use vi.resetModules() and dynamic import() inside tests when mocks must be registered before the module loads. Packages listed in DATA.mocks must be mocked, never called for real. Set no env yourself; the harness provides placeholder env values.
8. In "http" mode: the server is already running (with DATA.services provisioned). Call it with fetch using process.env.MISSION_BASE_URL (never a hard-coded host). Do not import the developer's code. Every criterion is checked through HTTP.
9. ROUTE DISCOVERY: DATA.routes is a deterministic index extracted from the repository's imports, router mounts and route declarations. Prefer a route whose method, path, handler and behaviour match the criterion. A mounted route's public path is the concatenation of all mount prefixes and its local route path. Do not call a router's local path as if it were a public path when a mount prefix is shown. If a matching route is listed, use that exact method and path; do not guess a path from the criterion alone. If no route matches because the mission asks for a new endpoint, use the route path explicitly stated by the mission or the implementation's declared contract and say so in a scenario comment.
10. AUTHENTICATION: the isolated HTTP evaluation runtime bypasses common, identifiable auth-guard middleware when the mission is NOT about authentication/authorization. Do not add login flows, hunt for test users, invent credentials, or add auth setup just to reach an unrelated feature. Do not test auth behavior for an unrelated mission. If the mission itself concerns authentication, authorization, sessions, JWTs, or permissions, the runtime leaves middleware untouched and tests the real auth behavior.
11. If a criterion requires importing project source in an HTTP-mode test (for example, checking middleware configuration directly), use paths relative to a test file located at <project-root>/__mission__/mission.test.ts. For a backend project, imports such as ../src/middleware/rateLimiter are valid from that location. Never assume the test file is inside the separate mission-runner directory.
11. Keep it simple: 2 or 3 small tests per criterion, each fast, independent and deterministic. Give every it() an explicit timeout as its last argument, e.g. it("...", async () => { ... }, 8000). Mock only what is needed.
12. Do NOT read or import any test file of the developer.

SCENARIO DESIGN (the usual reason a correct solution fails a bad test):
13. Above every it() write two comment lines: "// SCENARIO: <the states the test creates, in order>" and "// REACHABLE: <why the code can really reach those states with the values you chose>". Trace the pushed code to make sure the REACHABLE line is true before you write the test.
14. Choose parameter values that make the behaviour under test possible. Read how the code uses every constructor and function parameter. Never pass 0, negative, empty or "irrelevant" values for anything that controls time, expiry, capacity, limits, ordering, retries or counts, unless the criterion is about that very value. (An object built with a time-to-live of 0 has entries that are already expired, so it can never produce a hit and can never test one.) Use realistic non-zero values, and cross a time boundary on purpose with fake timers.
15. When a criterion is about a special state (in flight, expired, locked, retrying, concurrent, full), the test must first drive the code into that state through public calls, then check the behaviour. Work out from the code which exact call sequence produces that state. If a state can only be reached one way, use that way.
16. Pending promises: create controllable promises with a helper defined inside the test file:
   function deferred<T>() { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }
   Start the call under test WITHOUT awaiting it, perform the other steps, call resolve(...), and only then await the call. Never await a promise that only your own later lines can settle. Never attach properties to a promise and never read .resolve from one.
17. Assert observable behaviour first (return values, call counts, thrown errors). Only when a criterion is literally about an internal structure may you read it with (instance as any).<name>, and only names that appear verbatim in the pushed code.
18. Every test must be able to FAIL: assert something a naive or missing implementation would get wrong. Before the decisive assertion, assert the precondition as a control (for example that a value really was cached before the pressure that should evict it), so the test cannot pass by coincidence.
19. With spies, assert exact call counts. When a count spans several phases, assert deltas or reset the spy, and re-derive the expected number from the exact sequence you wrote, one call at a time.

Reply with ONLY the TypeScript file in a single \`\`\`ts code block. No explanation.`;

function systemPrompt(testPlan: MissionTestPlan): string {
  const used = new Set(
    testPlan.criteria
      .filter((c) => testPlan.sandboxCriteria.includes(c.id))
      .map((c) => c.strategy),
  );
  const guides = [...used]
    .map((s) => STRATEGIES[s].guide)
    .filter(Boolean)
    .join("\n");
  return `${BASE_RULES}\n\nSTRATEGY RULES:\n${guides}`;
}

/**
 * Build a conservative route index from repository source. It follows relative
 * imports and simple Express-style app.use(prefix, router) mounts, including
 * nested mounts. This is prompt evidence, not a claim that every JS syntax is
 * statically understood; unresolved mounts are explicitly marked.
 */
export interface DiscoveredHttpRoute {
  method: string;
  path: string;
  localPath: string;
  file: string;
  mountChain: string[];
  authClues: string[];
  evidence: string;
}

function normaliseSourcePath(value: string): string {
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function resolveRelativeSource(
  from: string,
  specifier: string,
  files: Map<string, string>,
): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = normaliseSourcePath(
    `${from.slice(0, Math.max(0, from.lastIndexOf("/")) + 1)}${specifier}`,
  );
  const candidates = [base];
  // TS projects commonly write runtime imports ending in .js while the checked-in
  // source is .ts; resolve those pairs as NodeNext/ESM projects do.
  const sourceBase = base.replace(/\.(?:mjs|cjs|js|jsx)$/i, "");
  if (sourceBase !== base) candidates.push(sourceBase);
  for (const root of [base, sourceBase]) {
    candidates.push(
      ...[".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"].map(
        (ext) => `${root}${ext}`,
      ),
    );
    candidates.push(
      ...["index.ts", "index.tsx", "index.js", "index.jsx"].map(
        (name) => `${root}/${name}`,
      ),
    );
  }
  return candidates.find((candidate) => files.has(candidate)) ?? null;
}

function importedBindings(
  file: string,
  source: string,
  files: Map<string, string>,
): Map<string, string> {
  const bindings = new Map<string, string>();
  const add = (name: string, specifier: string) => {
    const target = resolveRelativeSource(file, specifier, files);
    if (target) bindings.set(name, target);
  };
  for (const match of source.matchAll(
    /import\s+([\s\S]*?)\s+from\s*["']([^"']+)["']/g,
  )) {
    const clause = match[1].trim();
    if (!clause.startsWith("{")) {
      const name = clause.split(/[\s,]/)[0];
      if (/^[A-Za-z_$][\w$]*$/.test(name)) add(name, match[2]);
    }
    const named = /\{([^}]+)\}/.exec(clause)?.[1];
    if (named)
      for (const item of named.split(",")) {
        const bits = item.trim().split(/\s+as\s+/);
        const local = (bits[1] ?? bits[0]).trim();
        if (/^[A-Za-z_$][\w$]*$/.test(local)) add(local, match[2]);
      }
  }
  for (const match of source.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*["']([^"']+)["']\s*\)/g,
  ))
    add(match[1], match[2]);
  return bindings;
}

export function discoverHttpRoutes(
  repository: Map<string, string>,
): DiscoveredHttpRoute[] {
  const files = new Map(
    [...repository.entries()].map(([p, c]) => [normaliseSourcePath(p), c]),
  );
  const bindingsByFile = new Map<string, Map<string, string>>();
  for (const [file, source] of files)
    bindingsByFile.set(file, importedBindings(file, source, files));

  type Mount = {
    parent: string;
    target: string;
    prefix: string;
    evidence: string;
  };
  const mounts: Mount[] = [];
  for (const [file, source] of files) {
    const bindings = bindingsByFile.get(file)!;
    for (const match of source.matchAll(
      /\b([A-Za-z_$][\w$]*)\.use\(\s*["']([^"']*)["']\s*,\s*(?:[A-Za-z_$][\w$]*\s*,\s*)*([A-Za-z_$][\w$]*)\s*\)/g,
    )) {
      const target = bindings.get(match[3]);
      if (target)
        mounts.push({
          parent: file,
          target,
          prefix: match[2],
          evidence: match[0].slice(0, 240),
        });
    }
  }

  const inheritedAuthFor = (
    target: string,
    seen = new Set<string>(),
  ): string[] => {
    if (seen.has(target) || seen.size > 8) return [];
    const nextSeen = new Set(seen);
    nextSeen.add(target);
    const found = new Set<string>();
    for (const mount of mounts.filter((item) => item.target === target)) {
      for (const clue of mount.evidence.match(
        /requireAuth|authenticate|isAuthenticated|authMiddleware|verifyToken|passport\.authenticate|authorize|session|jwt|protect/gi,
      ) ?? [])
        found.add(clue.toLowerCase());
      for (const clue of inheritedAuthFor(mount.parent, nextSeen))
        found.add(clue);
    }
    return [...found].slice(0, 6);
  };

  const routes: DiscoveredHttpRoute[] = [];
  for (const [file, source] of files) {
    // Route declarations on router/app-like objects; ignore common non-route objects.
    for (const match of source.matchAll(
      /\b([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete|options|head|all)\(\s*["']([^"']*)["']/g,
    )) {
      const routeObject = match[1];
      const routerLike =
        /^(app|router|api|server|routes?)$/i.test(routeObject) ||
        new RegExp(
          `(?:const|let|var)\\s+${escapeRe(routeObject)}\\s*=\\s*(?:express\\.)?Router\\s*\\(`,
        ).test(source);
      if (!routerLike) continue;
      const method = match[2].toUpperCase();
      const localPath = match[3];
      if (!localPath.startsWith("/") && localPath !== "*") continue;
      const lineStart = source.lastIndexOf("\n", match.index ?? 0) + 1;
      const lineEndRaw = source.indexOf("\n", match.index ?? 0);
      const declaration = source
        .slice(
          lineStart,
          lineEndRaw < 0
            ? Math.min(source.length, (match.index ?? 0) + 500)
            : lineEndRaw,
        )
        .trim();
      const nearby = source.slice(
        Math.max(0, (match.index ?? 0) - 240),
        Math.min(source.length, (match.index ?? 0) + 900),
      );
      const authClues = [
        ...new Set([
          ...inheritedAuthFor(file),
          ...(
            nearby.match(
              /requireAuth|authenticate|isAuthenticated|authMiddleware|verifyToken|passport\.authenticate|authorize|session|jwt|protect/gi,
            ) ?? []
          ).map((x) => x.toLowerCase()),
        ]),
      ].slice(0, 6);
      const chains: string[][] = [];
      const walk = (target: string, prefix: string[], seen: Set<string>) => {
        if (seen.has(target) || seen.size > 8) {
          chains.push(prefix);
          return;
        }
        const nextSeen = new Set(seen);
        nextSeen.add(target);
        const parents = mounts.filter((m) => m.target === target);
        if (!parents.length) {
          chains.push(prefix);
          return;
        }
        for (const mount of parents)
          walk(mount.parent, [mount.prefix, ...prefix], nextSeen);
      };
      walk(file, [], new Set());
      const uniqueChains = chains.length ? chains : [[]];
      for (const chain of uniqueChains.slice(0, 3)) {
        const prefixes = chain.filter(Boolean);
        const fullPath = `/${[...prefixes, localPath]
          .map((p) => p.replace(/^\/+|\/+$/g, ""))
          .filter(Boolean)
          .join("/")}`.replace(/\/{2,}/g, "/");
        routes.push({
          method,
          path: fullPath,
          localPath,
          file,
          mountChain: prefixes,
          authClues,
          evidence: declaration.slice(0, 260),
        });
      }
    }
  }
  // Express's router.route("/x").get/post(...) form is common too.
  for (const [file, source] of files) {
    for (const match of source.matchAll(
      /\.route\(\s*["']([^"']+)["']\s*\)([\s\S]{0,260}?)(?=;|\n\s*\w+\.|$)/g,
    )) {
      const routePrefix = source.slice(
        Math.max(0, (match.index ?? 0) - 80),
        match.index ?? 0,
      );
      const routeObject = /([A-Za-z_$][\w$]*)\s*$/.exec(routePrefix)?.[1] ?? "";
      const routerLike =
        /^(app|router|api|server|routes?)$/i.test(routeObject) ||
        new RegExp(
          `(?:const|let|var)\\s+${escapeRe(routeObject)}\\s*=\\s*(?:express\\.)?Router\\s*\\(`,
        ).test(source);
      if (!routerLike) continue;
      const localPath = match[1];
      const chainText = match[2];
      const methods = [
        ...chainText.matchAll(
          /\.(get|post|put|patch|delete|options|head|all)\s*\(/g,
        ),
      ].map((m) => m[1].toUpperCase());
      if (!localPath.startsWith("/")) continue;
      for (const method of methods) {
        const chains: string[][] = [];
        const walk = (target: string, prefix: string[], seen: Set<string>) => {
          if (seen.has(target) || seen.size > 8) {
            chains.push(prefix);
            return;
          }
          const nextSeen = new Set(seen);
          nextSeen.add(target);
          const parents = mounts.filter((m) => m.target === target);
          if (!parents.length) {
            chains.push(prefix);
            return;
          }
          for (const mount of parents)
            walk(mount.parent, [mount.prefix, ...prefix], nextSeen);
        };
        walk(file, [], new Set());
        for (const chain of (chains.length ? chains : [[]]).slice(0, 3)) {
          const prefixes = chain.filter(Boolean);
          const path = `/${[...prefixes, localPath]
            .map((p) => p.replace(/^\/+|\/+$/g, ""))
            .filter(Boolean)
            .join("/")}`.replace(/\/{2,}/g, "/");
          const nearby = source.slice(
            match.index ?? 0,
            Math.min(source.length, (match.index ?? 0) + 900),
          );
          const authClues = [
            ...new Set([
              ...inheritedAuthFor(file),
              ...(
                nearby.match(
                  /requireAuth|authenticate|isAuthenticated|authMiddleware|verifyToken|passport\.authenticate|authorize|session|jwt|protect/gi,
                ) ?? []
              ).map((x) => x.toLowerCase()),
            ]),
          ].slice(0, 6);
          routes.push({
            method,
            path,
            localPath,
            file,
            mountChain: prefixes,
            authClues,
            evidence: match[0].slice(0, 260),
          });
        }
      }
    }
  }

  const unique = new Map<string, DiscoveredHttpRoute>();
  for (const route of routes)
    unique.set(`${route.method} ${route.path} ${route.file}`, route);
  return [...unique.values()]
    .sort(
      (a, b) =>
        a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
    )
    .slice(0, 60);
}

function renderGenerateUser(input: GenerateInput): string {
  const { spec, plan, testPlan, profile, mocks, code, changed } = input;
  const routeSource = input.repoFiles ?? code;
  const routes = plan.mode === "http" ? discoverHttpRoutes(routeSource) : [];
  const sources = [...code.entries()].filter(([p]) => !TEST_FILE.test(p));
  const files = sources
    .slice(0, 8)
    .map(([p, c]) => `FILE ${p}\n\`\`\`\n${clip(c, 12000)}\n\`\`\``)
    .join("\n\n");
  const exportsIndex: Record<string, string[]> = {};
  for (const [p, c] of sources) {
    const names = exportsOf(c);
    if (names.length) exportsIndex[p] = names;
  }
  const ids = new Set(testPlan.sandboxCriteria);
  const data = {
    mode: plan.mode,
    track: plan.track,
    framework: profile.framework,
    packageRoot: plan.root || "(repository root)",
    objective: spec.objective,
    steps: spec.steps,
    criteria: spec.criteria
      .filter((c) => ids.has(c.id))
      .map((c) => ({
        ...c,
        strategy:
          testPlan.criteria.find((x) => x.id === c.id)?.strategy ?? "unit",
      })),
    contract: spec.contract ?? null,
    scope: spec.scope,
    exports: exportsIndex,
    changedFiles: changed.map((c) => `${c.status} ${c.path}`),
    mocks:
      plan.mode === "module"
        ? mocks.filter((m) => m.kind === "module-mock").map((m) => m.name)
        : [],
    services: plan.mode === "http" ? plan.serviceSetup.map((s) => s.name) : [],
    routes,
  };
  return `DATA:\n${JSON.stringify(data)}\n\nPUSHED CODE\n${files || "(no source files found)"}`;
}

export function extractTestCode(raw: string): string {
  const m = /```(?:ts|typescript|tsx)?\s*\n([\s\S]*?)```/.exec(raw);
  return (m ? m[1] : raw).trim();
}

/** Hard rules: a test file that breaks one of them is never run. */
export function validateTestCode(
  code: string,
  spec: MissionSpec,
  plan: ExecutionPlan,
  sandboxIds: string[],
  needsMechanism: boolean,
): string[] {
  const errors: string[] = [];
  if (code.length < 200) errors.push("test file is too short");
  if (code.length > 40_000) errors.push("test file is too long");
  if (!/from\s+["']vitest["']/.test(code))
    errors.push('must import from "vitest"');
  for (const id of sandboxIds)
    if (!new RegExp(`describe\\(\\s*["'\`]${escapeRe(id)}\\b`).test(code))
      errors.push(`missing describe("${id}: ...")`);
  if (/child_process|process\.exit|execSync|spawnSync|writeFileSync/.test(code))
    errors.push("forbidden API (child_process / process.exit / fs writes)");
  if (/fetch\(\s*["'`]https?:\/\/(?!127\.0\.0\.1|localhost)/.test(code))
    errors.push("external network call");
  if (plan.mode === "http" && !code.includes("MISSION_BASE_URL"))
    errors.push("http mode tests must use process.env.MISSION_BASE_URL");
  if (
    /vi\.useFakeTimers\s*\(/.test(code) &&
    /vi\.runAllTimers(?:Async)?\s*\(/.test(code)
  )
    errors.push(
      "timing tests must not drain all fake timers before intermediate-time assertions; use await vi.advanceTimersByTimeAsync(ms) for each intended interval",
    );
  if (/\b(?:it|test|describe)\.(?:only|skip|todo)\s*\(/.test(code))
    errors.push("it.only / it.skip / it.todo are not allowed");
  if (/\bas\s+any\s*\)?\s*\.\s*resolve\b/.test(code))
    errors.push(
      "never attach or read .resolve on a promise; create controllable promises with a deferred() helper and await the call only after resolving",
    );
  if (/expect\(\s*true\s*\)\s*\.toBe\(\s*true\s*\)/.test(code))
    errors.push("trivial assertion expect(true).toBe(true)");
  const itCount = (code.match(/\b(?:it|test)\s*\(/g) ?? []).length;
  const expectCount = (code.match(/\bexpect(?:\.\w+)?\s*\(/g) ?? []).length;
  if (itCount === 0) errors.push("the file contains no tests");
  else if (expectCount < itCount)
    errors.push("some tests have no assertion: every it() needs an expect()");
  const lib = spec.contract?.library;
  if (lib && plan.mode === "module" && needsMechanism) {
    const token = lib.toLowerCase().replace(/^@[^/]+\//, "");
    if (!code.toLowerCase().includes(token))
      errors.push(`tests never mention the required library "${lib}"`);
    if (!/vi\.mock\(|vi\.fn\(|vi\.spyOn\(/.test(code))
      errors.push("tests must mock or spy on the library client");
  }
  return errors;
}

/* ------------------------------------------------------------------ */
/* reviewer: reads the finished test file before it is ever run        */
/* ------------------------------------------------------------------ */

const REVIEW_SYSTEM = `You review ONE vitest file that was written to grade a developer's coding mission. A bad test is costly: it fails a correct solution (the developer can then never finish) or it passes a wrong one. You run nothing; you trace by reading.

You get the acceptance criteria, pushed code, a DATA.routes index and the test file. The pushed code may be incomplete or wrong: use it only to learn real signatures and the existing behaviour of code the mission does not change (for example how a TTL, size or limit parameter is used). Judge each test against the CRITERION, never against whether the pushed code happens to pass. For HTTP tests, compare method/path with DATA.routes and account for every router mount prefix. If the mission is unrelated to auth, do not add login/session setup: the isolated sandbox runtime bypasses common identifiable auth guards. If the mission tests auth/authorization, keep the real middleware and exercise it.

For EVERY it(), trace it line by line and decide:
A. REACHABLE: can the states the test sets up really occur? Check each parameter value against how the code uses it (a TTL of 0 makes entries expire at birth; capacity values change what gets evicted; fake timers must be advanced to cross an expiry). An assertion that depends on a state the setup cannot produce is defective.
B. TERMINATES: does any await wait for a promise that only later lines of the same test can settle? Does the test rely on properties attached to a promise? Defective.
C. FAITHFUL: does it assert only what the criterion states? Would a correct implementation of the criterion pass it? Invented exact strings, extra behaviours, spy counts that are wrong when you recount them call by call, or wrong ordering expectations are defective.
D. DISCRIMINATING: would it also pass for an implementation that ignores the criterion, or for the code before the change? Then it is defective.
E. COMPLETE: do the tests under a describe exercise the behaviour the criterion actually states? If the decisive behaviour is never exercised, report it once for that describe with test "(describe)".

Be precise and conservative. Report a test as defective only when you can name the line and the reason. Never report style issues.

Reply with JSON only: {"tests":[{"ac":"AC1","test":"<it title>","defective":false,"problem":""}]}. For a defective test, "problem" is one or two sentences: what is wrong and how to fix it.`;

export interface ReviewResult {
  defects: string[];
}

function renderReviewUser(input: GenerateInput, testCode: string): string {
  const { spec, plan, testPlan, code } = input;
  const routes =
    plan.mode === "http" ? discoverHttpRoutes(input.repoFiles ?? code) : [];
  const sources = [...code.entries()].filter(([p]) => !TEST_FILE.test(p));
  const files = sources
    .slice(0, 8)
    .map(([p, c]) => `FILE ${p}\n\`\`\`\n${clip(c, 12000)}\n\`\`\``)
    .join("\n\n");
  const ids = new Set(testPlan.sandboxCriteria);
  const data = {
    mode: plan.mode,
    objective: spec.objective,
    criteria: spec.criteria
      .filter((c) => ids.has(c.id))
      .map((c) => ({ id: c.id, description: c.description, how: c.how })),
    contract: spec.contract ?? null,
    scope: spec.scope,
    routes,
  };
  return `DATA:\n${JSON.stringify(data)}\n\nPUSHED CODE\n${files || "(no source files found)"}\n\nTEST FILE\n\`\`\`ts\n${clip(testCode, 16000)}\n\`\`\``;
}

/**
 * Second pair of eyes on a freshly written test file. Never blocks on its own
 * failure: when the reviewer is unavailable the file is accepted and the
 * post-run audit still protects the developer.
 */
export async function reviewMissionTest(
  llm: LlmClient,
  input: GenerateInput,
  testCode: string,
  timeoutMs: number,
): Promise<ReviewResult> {
  try {
    const raw = await ask(
      llm,
      REVIEW_SYSTEM,
      renderReviewUser(input, testCode),
      1800,
      true,
      timeoutMs,
    );
    const root = (extractJson(raw) ?? {}) as Row;
    const tests = Array.isArray(root.tests) ? (root.tests as Row[]) : [];
    const defects = tests
      .filter((t) => t && t.defective === true && txt(t.problem))
      .map(
        (t) =>
          `${txt(t.ac) || "?"} "${clip(txt(t.test), 90)}": ${clip(txt(t.problem), 320)}`,
      );
    return { defects: defects.slice(0, 6) };
  } catch {
    return { defects: [] };
  }
}

/**
 * Writes the vitest file for every sandbox criterion of the plan.
 * Returns code null after 3 attempts that broke a hard rule. Import problems
 * and reviewer findings trigger a rewrite on the first two attempts only: on
 * the last one the file is accepted (a missing export is then most likely the
 * developer's gap, and the post-run audit still guards against a faulty test).
 */
export async function generateMissionTest(
  llm: LlmClient,
  input: GenerateInput,
): Promise<{ code: string | null; attempts: number; errors: string[] }> {
  const timeoutMs =
    input.timeoutMs ?? Number(process.env.LLM_TIMEOUT_MS ?? 60_000);
  const system = systemPrompt(input.testPlan);
  const baseUser = renderGenerateUser(input);
  const user = input.feedback
    ? `${baseUser}\n\nA previous version of this test file was found defective:\n${input.feedback}\nWrite a corrected file. Re-trace every scenario through the code and fix each point.`
    : baseUser;
  const needsMechanism = testPlanNeedsMechanism(input.testPlan);
  const repo = input.repoFiles ?? input.code;
  let errors: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = attempt === 2;
    const prompt =
      attempt === 0
        ? user
        : `${user}\n\nYour previous file was rejected:\n${errors.map((e) => `- ${e}`).join("\n")}\n\nRe-trace the affected scenarios and return the corrected full file only.`;
    let raw: string;
    try {
      raw = await ask(llm, system, prompt, 12000, false, timeoutMs);
    } catch (e) {
      errors = [
        `LLM call failed: ${e instanceof Error ? e.message : String(e)}`,
      ];
      break;
    }
    console.log(
      `[mission-test] attempt ${attempt + 1}/3: model returned ${raw.length} chars`,
      raw.length < 300 ? JSON.stringify(raw) : raw.slice(0, 200),
    );
    if (!raw.trim()) {
      errors = [
        "the model returned an empty answer (thinking may be using the whole token budget, or the request was rejected)",
      ];
      continue;
    }
    const code = extractTestCode(raw);
    const hard = validateTestCode(
      code,
      input.spec,
      input.plan,
      input.testPlan.sandboxCriteria,
      needsMechanism,
    );
    if (hard.length) {
      errors = hard;
      continue;
    }
    const soft = importProblems(code, input.plan, input.spec, repo);
    if (soft.length && !last) {
      errors = soft;
      continue;
    }
    const review = await reviewMissionTest(llm, input, code, timeoutMs);
    if (review.defects.length && !last) {
      errors = review.defects.map((d) => `reviewer: ${d}`);
      continue;
    }
    return { code, attempts: attempt + 1, errors: [] };
  }
  return { code: null, attempts: 3, errors };
}
