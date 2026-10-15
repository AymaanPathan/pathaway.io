import type { AnyObject, FileChangeRecord, FileRole, GitHubCommit } from "./sync-types.js";
import {
  ANALYSIS_VERSION,
  CONCURRENCY,
  CONFIG_BASENAME_RE,
  CONFIG_CODE_RE,
  DEVELOPER_HISTORY_DAYS,
  GENERATED_FILE_PATTERNS,
  IGNORE_EXTENSIONS,
  IGNORE_FILENAMES,
  IGNORE_PATH_SEGMENTS,
  INCLUDE_EXTENDED_EVIDENCE,
  INFRA_PATH_RE,
  LANGUAGE_MAP,
  MANIFEST_LANGUAGE,
  MAX_ADDED_CODE_CHARS,
  MAX_DELETED_CODE_CHARS,
  MAX_HUNKS_STORED,
  MAX_IMPORTS_STORED,
  MAX_INITIAL_COMMITS_PER_REPO,
  MAX_PATCH_CHARS,
  MAX_SCOPES_STORED,
  MAX_SYMBOLS_STORED,
  MIGRATION_PATH_RE,
  SCHEMA_EXTENSIONS,
  SOURCE_EXTENSIONS,
  STYLE_EXTENSIONS,
  TEST_PATH_RE,
} from "./sync-config.js";

export function safeString(value: unknown): string {
  return value == null ? "" : String(value);
}

export function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n\n[TRUNCATED]`;
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

export function getExtension(path: string): string {
  const filename = normalizePath(path).split("/").pop() ?? "";

  const dot = filename.lastIndexOf(".");

  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}

export function jsonCapped(value: unknown, fallback = "[]"): string {
  try {
    return JSON.stringify(value) ?? fallback;
  } catch {
    return fallback;
  }
}

export function decodeFileContent(file: AnyObject | null | undefined): string {
  if (!file?.content) {
    return "";
  }

  const content = safeString(file.content);

  if (file.encoding === "base64") {
    try {
      return Buffer.from(content, "base64").toString("utf8");
    } catch {
      return "";
    }
  }

  return content;
}

export type QueryPrimitive = string | number | boolean | null;

export type QueryParamObject = Record<string, QueryPrimitive>;

export function asQueryParams<T extends object>(items: T[]): QueryParamObject[] {
  return items.map((item) => {
    const params: QueryParamObject = {};

    for (const [key, value] of Object.entries(item)) {
      if (value === undefined) {
        params[key] = null;
      } else if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        params[key] = value;
      } else {
        throw new TypeError(
          `Unsupported FalkorDB query parameter for "${key}": ${typeof value}`,
        );
      }
    }

    return params;
  });
}

export function getCommitDate(commit: GitHubCommit): string {
  return commit.commit?.author?.date ?? commit.commit?.committer?.date ?? "";
}

export function getCommitTimestamp(commit: GitHubCommit): number {
  const value = new Date(getCommitDate(commit)).getTime();
  return Number.isFinite(value) ? value : 0;
}

export function getHistoryCutoff(): number {
  return Date.now() - DEVELOPER_HISTORY_DAYS * 24 * 60 * 60 * 1000;
}

export function selectInitialCommits(commits: GitHubCommit[]): GitHubCommit[] {
  const cutoff = getHistoryCutoff();

  return [...commits]
    .filter((commit) => {
      const timestamp = getCommitTimestamp(commit);
      return timestamp > 0 && timestamp >= cutoff;
    })
    .sort((a, b) => getCommitTimestamp(b) - getCommitTimestamp(a))
    .slice(0, MAX_INITIAL_COMMITS_PER_REPO);
}


export interface FileClassification {
  language: string;
  role: FileRole;
  isSourceCode: boolean;
}

export function isIgnoredPath(path: string): boolean {
  const lower = `/${normalizePath(path).toLowerCase()}`;

  if (IGNORE_PATH_SEGMENTS.some((part) => lower.includes(`/${part}`))) {
    return true;
  }

  return GENERATED_FILE_PATTERNS.some((pattern) => pattern.test(lower));
}

export function classifyFile(path: string): FileClassification | null {
  const normalized = normalizePath(path);

  if (!normalized || isIgnoredPath(normalized)) {
    return null;
  }

  const lower = normalized.toLowerCase();
  const base = lower.split("/").pop() ?? "";
  const ext = getExtension(normalized);
  const isCodeExt = SOURCE_EXTENSIONS.has(ext);

  if (IGNORE_FILENAMES.has(base)) {
    return null;
  }

  if (!isCodeExt && !INCLUDE_EXTENDED_EVIDENCE) {
    return null;
  }

  if (base in MANIFEST_LANGUAGE) {
    return {
      language: MANIFEST_LANGUAGE[base],
      role: "dependency_manifest",
      isSourceCode: false,
    };
  }

  if (
    base === "dockerfile" ||
    base.startsWith("dockerfile.") ||
    base.endsWith(".dockerfile")
  ) {
    return { language: "dockerfile", role: "infra", isSourceCode: false };
  }

  if (base === "makefile") {
    return { language: "make", role: "config", isSourceCode: false };
  }

  if (CONFIG_BASENAME_RE.test(base)) {
    return {
      language: ext === ".json" || ext === "" ? "json" : "text",
      role: "config",
      isSourceCode: false,
    };
  }

  if (IGNORE_EXTENSIONS.has(ext)) {
    return null;
  }

  const language = LANGUAGE_MAP[ext];

  if (!language) {
    return null;
  }

  if (ext === ".tf") {
    return { language, role: "infra", isSourceCode: false };
  }

  if (ext === ".yml" || ext === ".yaml") {
    return {
      language,
      role: INFRA_PATH_RE.test(lower) ? "infra" : "config",
      isSourceCode: false,
    };
  }

  if (STYLE_EXTENSIONS.has(ext)) {
    return { language, role: "style", isSourceCode: true };
  }

  if (ext === ".html") {
    return { language, role: "markup", isSourceCode: true };
  }

  if (SCHEMA_EXTENSIONS.has(ext)) {
    return { language, role: "schema", isSourceCode: true };
  }

  if (TEST_PATH_RE.test(lower)) {
    return { language, role: "test", isSourceCode: true };
  }

  if (MIGRATION_PATH_RE.test(lower)) {
    return { language, role: "migration", isSourceCode: true };
  }

  if (CONFIG_CODE_RE.test(lower)) {
    return { language, role: "config", isSourceCode: true };
  }

  return { language, role: "source", isSourceCode: true };
}


export const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: ?(.*))?$/;

export interface HunkInfo {
  newStart: number;
  newLines: number;
  added: number;
  deleted: number;
  context: string;
}

export interface ParsedPatch {
  hunks: HunkInfo[];
  addedLines: string[];
  deletedLines: string[];
}

export function parsePatch(patch: string): ParsedPatch {
  const hunks: HunkInfo[] = [];
  const addedLines: string[] = [];
  const deletedLines: string[] = [];

  let current: HunkInfo | null = null;

  for (const line of patch.split("\n")) {
    const header = HUNK_HEADER.exec(line);

    if (header) {
      current = {
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        added: 0,
        deleted: 0,
        context: safeString(header[5]).trim().slice(0, 120),
      };

      hunks.push(current);
      continue;
    }

    if (!current) {
      if (line.startsWith("+") || line.startsWith("-")) {
        current = {
          newStart: 0,
          newLines: 0,
          added: 0,
          deleted: 0,
          context: "",
        };
        hunks.push(current);
      } else {
        continue;
      }
    }

    if (line.startsWith("+")) {
      addedLines.push(line.slice(1));
      current.added++;
    } else if (line.startsWith("-")) {
      deletedLines.push(line.slice(1));
      current.deleted++;
    }
  }

  return { hunks, addedLines, deletedLines };
}


export type SymbolPattern = [string, RegExp];

export const JS_TS_SYMBOLS: SymbolPattern[] = [
  [
    "route",
    /\b(?:app|router)\.(?:get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)/,
  ],
  [
    "component",
    /^\s*(?:export\s+)?(?:default\s+)?function\s+([A-Z][A-Za-z0-9]*)\b/,
  ],
  [
    "component",
    /^\s*(?:export\s+)?(?:default\s+)?const\s+([A-Z][a-z][A-Za-z0-9]*)\s*(?::[^=]+)?=\s*(?:React\.)?(?:memo|forwardRef|\()/,
  ],
  [
    "function",
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  ],
  [
    "class",
    /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  ],
  [
    "interface",
    /^\s*(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/,
  ],
  [
    "type",
    /^\s*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*>)?\s*=/,
  ],
  [
    "enum",
    /^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/,
  ],
  [
    "function",
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>|function\b)/,
  ],
];

export const SYMBOL_PATTERNS: Record<string, SymbolPattern[]> = {
  typescript: JS_TS_SYMBOLS,
  javascript: JS_TS_SYMBOLS,
  vue: JS_TS_SYMBOLS,
  svelte: JS_TS_SYMBOLS,
  python: [
    ["function", /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/],
    ["class", /^\s*class\s+([A-Za-z_]\w*)/],
  ],
  go: [
    ["function", /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/],
    ["type", /^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/],
  ],
  rust: [
    [
      "function",
      /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)/,
    ],
    ["struct", /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/],
    ["enum", /^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/],
    ["trait", /^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_]\w*)/],
    ["impl", /^\s*impl(?:<[^>]*>)?\s+(?:[\w:<>]+\s+for\s+)?([A-Za-z_]\w*)/],
  ],
  java: [
    [
      "type",
      /^\s*(?:(?:public|protected|private|static|final|abstract|sealed)\s+)*(class|interface|enum|record)\s+([A-Za-z_]\w*)/,
    ],
    [
      "method",
      /^\s*(?:public|protected|private)\s+(?:(?:static|final|abstract|synchronized)\s+)*[\w<>\[\],.? ]+\s+([A-Za-z_]\w*)\s*\(/,
    ],
  ],
  kotlin: [
    [
      "function",
      /^\s*(?:(?:private|public|internal|protected|suspend|inline|override)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?([A-Za-z_]\w*)/,
    ],
    [
      "type",
      /^\s*(?:(?:data|sealed|abstract|open|enum|private|public|internal)\s+)*(class|object|interface)\s+([A-Za-z_]\w*)/,
    ],
  ],
  scala: [
    ["function", /^\s*(?:override\s+)?def\s+([A-Za-z_]\w*)/],
    ["type", /^\s*(?:case\s+)?(class|object|trait)\s+([A-Za-z_]\w*)/],
  ],
  csharp: [
    [
      "type",
      /^\s*(?:(?:public|internal|private|protected|static|sealed|abstract|partial)\s+)*(class|interface|struct|enum|record)\s+([A-Za-z_]\w*)/,
    ],
    [
      "method",
      /^\s*(?:public|private|protected|internal)\s+(?:(?:static|async|virtual|override|abstract)\s+)*[\w<>\[\],.? ]+\s+([A-Za-z_]\w*)\s*\(/,
    ],
  ],
  ruby: [
    ["function", /^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/],
    ["type", /^\s*(class|module)\s+([A-Z][\w:]*)/],
  ],
  php: [
    [
      "function",
      /^\s*(?:(?:public|private|protected|static|final|abstract)\s+)*function\s+&?([A-Za-z_]\w*)/,
    ],
    [
      "type",
      /^\s*(?:(?:final|abstract)\s+)?(class|interface|trait)\s+([A-Za-z_]\w*)/,
    ],
  ],
  swift: [
    [
      "function",
      /^\s*(?:(?:public|private|internal|fileprivate|open|static|final|override|mutating)\s+)*func\s+([A-Za-z_]\w*)/,
    ],
    [
      "type",
      /^\s*(?:(?:public|private|internal|final|open)\s+)*(class|struct|enum|protocol|extension|actor)\s+([A-Za-z_]\w*)/,
    ],
  ],
  dart: [
    [
      "type",
      /^\s*(?:abstract\s+)?(class|mixin|enum|extension)\s+([A-Za-z_]\w*)/,
    ],
  ],
  elixir: [
    ["module", /^\s*defmodule\s+([\w.]+)/],
    ["function", /^\s*defp?\s+([a-z_]\w*[?!]?)/],
  ],
  lua: [["function", /^\s*(?:local\s+)?function\s+([\w.:]+)/]],
  solidity: [
    ["type", /^\s*(contract|interface|library)\s+([A-Za-z_]\w*)/],
    ["function", /^\s*function\s+([A-Za-z_]\w*)/],
    ["event", /^\s*event\s+([A-Za-z_]\w*)/],
    ["modifier", /^\s*modifier\s+([A-Za-z_]\w*)/],
  ],
  sql: [
    [
      "ddl",
      /^\s*create\s+(?:or\s+replace\s+)?(?:unique\s+)?(?:table|view|materialized\s+view|function|procedure|index|trigger)\s+(?:if\s+not\s+exists\s+)?([\w."]+)/i,
    ],
  ],
  shell: [
    ["function", /^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\s*\)\s*\{?/],
  ],
  c: [
    ["type", /^\s*(?:typedef\s+)?(struct|enum|union)\s+([A-Za-z_]\w*)/],
    [
      "function",
      /^[A-Za-z_][\w\s*&:<>]*?\s+\**([A-Za-z_]\w*)\s*\([^;]*\)\s*\{?\s*$/,
    ],
  ],
  cpp: [
    [
      "type",
      /^\s*(?:template\s*<[^>]*>\s*)?(class|struct|enum)\s+([A-Za-z_]\w*)/,
    ],
    [
      "function",
      /^[A-Za-z_][\w\s*&:<>]*?\s+[*&]*([A-Za-z_][\w:]*)\s*\([^;]*\)\s*(?:const\s*)?\{?\s*$/,
    ],
  ],
  prisma: [["model", /^\s*(model|enum|view)\s+([A-Za-z_]\w*)/]],
  graphql: [
    [
      "type",
      /^\s*(type|input|enum|interface|union|scalar|query|mutation|subscription)\s+([A-Za-z_]\w*)/,
    ],
  ],
  protobuf: [["type", /^\s*(message|service|enum)\s+([A-Za-z_]\w*)/]],
  terraform: [
    ["resource", /^\s*(?:resource|module|data)\s+"([^"]+)"(?:\s+"([^"]+)")?/],
  ],
  dockerfile: [["base_image", /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/i]],
  css: [["selector", /^\s*(\.[\w-]+)\s*(?:[,{:]|$)/]],
  scss: [
    ["mixin", /^\s*@(?:mixin|function)\s+([\w-]+)/],
    ["selector", /^\s*(\.[\w-]+)\s*(?:[,{:]|$)/],
  ],
};

export const SYMBOL_KEYWORD_BLOCKLIST = new Set([
  "if",
  "for",
  "while",
  "switch",
  "return",
  "else",
  "catch",
  "sizeof",
  "do",
  "case",
  "new",
  "delete",
  "throw",
  "typeof",
]);

export function lastDefinedGroup(match: RegExpExecArray): string {
  for (let i = match.length - 1; i >= 1; i--) {
    if (match[i]) {
      return match[i];
    }
  }

  return "";
}

export function extractSymbols(lines: string[], language: string): Set<string> {
  const patterns = SYMBOL_PATTERNS[language];
  const symbols = new Set<string>();

  if (!patterns) {
    return symbols;
  }

  for (const line of lines) {
    if (line.length > 400) {
      continue;
    }

    for (const [kind, pattern] of patterns) {
      const match = pattern.exec(line);

      if (!match) {
        continue;
      }

      const name = lastDefinedGroup(match);

      if (name && !SYMBOL_KEYWORD_BLOCKLIST.has(name)) {
        symbols.add(`${kind}:${name}`);
      }

      break;
    }
  }

  return symbols;
}


export const JS_TS_IMPORTS: RegExp[] = [
  /^\s*import\s+(?:type\s+)?(?:[\w*${}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/,
  /^\s*\}\s*from\s+['"]([^'"]+)['"]/,
  /^\s*export\s+(?:type\s+)?(?:\*|\{[^}]*\})(?:\s+as\s+\w+)?\s+from\s+['"]([^'"]+)['"]/,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/,
];

export const IMPORT_PATTERNS: Record<string, RegExp[]> = {
  typescript: JS_TS_IMPORTS,
  javascript: JS_TS_IMPORTS,
  vue: JS_TS_IMPORTS,
  svelte: JS_TS_IMPORTS,
  python: [/^\s*import\s+([\w.]+)/, /^\s*from\s+([\w.]+)\s+import\b/],
  go: [
    /^\s*import\s+(?:[\w._]+\s+)?"([^"]+)"/,
    /^\s*(?:[\w._]+\s+)?"([A-Za-z0-9_.\-]+(?:\/[A-Za-z0-9_.\-]+)+)"\s*$/,
  ],
  java: [/^\s*import\s+(?:static\s+)?([\w.]+)/],
  kotlin: [/^\s*import\s+([\w.]+)/],
  scala: [/^\s*import\s+([\w.]+)/],
  rust: [/^\s*(?:pub\s+)?use\s+([\w:]+)/, /^\s*extern\s+crate\s+(\w+)/],
  c: [/^\s*#\s*include\s*[<"]([^>"]+)[>"]/],
  cpp: [/^\s*#\s*include\s*[<"]([^>"]+)[>"]/],
  csharp: [/^\s*using\s+(?:static\s+)?([\w.]+)\s*;/],
  ruby: [/^\s*require(?:_relative)?\s+['"]([^'"]+)['"]/],
  php: [
    /^\s*use\s+([\w\\]+)/,
    /\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/,
  ],
  swift: [/^\s*import\s+(?:class\s+|struct\s+)?(\w+)/],
  dart: [/^\s*import\s+['"]([^'"]+)['"]/],
  elixir: [/^\s*(?:alias|import|use|require)\s+([\w.]+)/],
  lua: [/\brequire\s*\(?\s*['"]([^'"]+)['"]/],
  solidity: [/^\s*import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/],
  css: [/^\s*@import\s+(?:url\()?['"]?([^'")\s;]+)/],
  scss: [/^\s*@(?:import|use|forward)\s+['"]([^'"]+)['"]/],
  graphql: [/^\s*#\s*import\s+.*from\s+['"]([^'"]+)['"]/],
  protobuf: [/^\s*import\s+(?:public\s+)?['"]([^'"]+)['"]/],
};

export function normalizeImport(
  language: string,
  spec: string,
): { name: string; internal: boolean } {
  const s = spec.trim();

  if (!s) {
    return { name: "", internal: true };
  }

  switch (language) {
    case "typescript":
    case "javascript":
    case "vue":
    case "svelte":
    case "css":
    case "scss": {
      if (/^(?:\.|\/|~|@\/|#|src\/)/.test(s)) {
        return { name: s, internal: true };
      }

      if (s.startsWith("node:")) {
        return { name: s, internal: false };
      }

      const parts = s.split("/");
      return {
        name: s.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0],
        internal: false,
      };
    }

    case "python":
      return s.startsWith(".")
        ? { name: s, internal: true }
        : { name: s.split(".")[0], internal: false };

    case "go": {
      const parts = s.split("/");
      return {
        name: s.startsWith("github.com/") ? parts.slice(0, 3).join("/") : s,
        internal: false,
      };
    }

    case "rust": {
      const head = s.split("::")[0];
      return {
        name: head,
        internal: ["crate", "self", "super"].includes(head),
      };
    }

    case "java":
    case "kotlin":
    case "scala":
      return { name: s.split(".").slice(0, 3).join("."), internal: false };

    case "csharp":
      return { name: s.split(".").slice(0, 2).join("."), internal: false };

    default:
      return { name: s, internal: s.startsWith(".") };
  }
}

export function extractImports(
  lines: string[],
  language: string,
): { external: Set<string>; internalCount: number } {
  const patterns = IMPORT_PATTERNS[language];
  const external = new Set<string>();
  let internalCount = 0;

  if (!patterns) {
    return { external, internalCount };
  }

  for (const line of lines) {
    if (line.length > 400) {
      continue;
    }

    for (const pattern of patterns) {
      const match = pattern.exec(line);

      if (!match?.[1]) {
        continue;
      }

      const { name, internal } = normalizeImport(language, match[1]);

      if (!name) {
        break;
      }

      if (internal) {
        internalCount++;
      } else {
        external.add(name);
      }

      break;
    }
  }

  return { external, internalCount };
}


export const CODE_SIGNALS: Array<[string, RegExp]> = [
  ["async_await", /\b(?:async|await)\b/g],
  ["promise_combinators", /\bPromise\.(?:all|allSettled|race|any)\b/g],
  [
    "error_handling",
    /\btry\s*[{:]|\bcatch\s*[({]|\bexcept\b[^:\n]*:|\.catch\s*\(|\bthrow\s+new\b|\braise\s+\w|\brecover\(\)/g,
  ],
  [
    "react_hooks",
    /\buse(?:State|Effect|Memo|Callback|Ref|Context|Reducer|LayoutEffect|Transition|DeferredValue|Id)\b/g,
  ],
  ["hook_calls", /\buse[A-Z]\w*\s*\(/g],
  ["jsx_elements", /<[A-Z][\w.]*[\s/>]/g],
  ["generics", /<[A-Z]\w*(?:\s*,\s*[A-Z]\w*)*>/g],
  ["any_usage", /:\s*any\b|\bas\s+any\b|<any>/g],
  [
    "lint_type_suppressions",
    /@ts-ignore|@ts-expect-error|eslint-disable|#\s*noqa|#\s*type:\s*ignore|#\s*pylint:\s*disable/g,
  ],
  ["todo_markers", /\b(?:TODO|FIXME|HACK|XXX)\b/g],
  [
    "test_assertions",
    /\b(?:describe|it|test)(?:\.each|\.only|\.skip)?\s*\(|\bexpect\s*\(|\bassert\w*\s*[.(]|@pytest|\bunittest\b|\bvi\.|\bjest\./g,
  ],
  [
    "sql_cypher",
    /\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX)|ALTER\s+TABLE|MATCH|MERGE|UNWIND|RETURN)\b/g,
  ],
  [
    "http_routes",
    /\b(?:app|router)\.(?:get|post|put|patch|delete|use)\s*\(|@(?:Get|Post|Put|Patch|Delete|Controller)\s*\(/g,
  ],
  [
    "http_clients",
    /\bfetch\s*\(|\baxios\b|\bhttpx?\.|\brequests\.(?:get|post|put|delete)/g,
  ],
  [
    "streaming_realtime",
    /text\/event-stream|\bEventSource\b|\bReadableStream\b|\bWebSocket\b|\bsocket\.io\b/g,
  ],
  [
    "queues_workers",
    /\bBullMQ\b|new\s+(?:Queue|Worker|QueueEvents)\s*\(|\bcelery\b|\bsidekiq\b|\bgo\s+func\b|\bchan\s+\w+/g,
  ],
  ["caching", /\bredis\b|\bmemoize\b|\bcache\.(?:get|set|del)\b|\bLRU\b/gi],
  [
    "observability",
    /\b(?:logger|log)\.(?:info|warn|error|debug)\b|\btracer\b|\bstartSpan\b|\bopentelemetry\b|\bmetrics?\.\w+/gi,
  ],
  [
    "validation",
    /\bz\.(?:object|string|number|array|enum|union)\b|\bzod\b|\bjoi\b|\byup\b|\bpydantic\b|\bBaseModel\b/g,
  ],
  [
    "auth_security",
    /\bjwt\b|\boauth\b|\bbcrypt\b|\bpassport\b|\bcsrf\b|\bhelmet\b|\bcors\b|\bhmac\b|\bcrypto\.\w+|\bsanitize\w*/gi,
  ],
  [
    "llm_ai",
    /\b(?:openai|anthropic|langchain|langgraph|embeddings?|llm|completion|rag|vector\s*store|tool_call|systemPrompt)\b/gi,
  ],
  [
    "graphics_3d",
    /@react-three|\bTHREE\.|\buseFrame\b|\bshaderMaterial\b|\bBufferGeometry\b|\bInstancedMesh\b/g,
  ],
  ["graph_db", /\bfalkordb\b|\bneo4j\b|\bcypher\b|\bgraph\.query\b/gi],
  [
    "state_management",
    /\b(?:createSlice|configureStore|zustand|useStore|redux|recoil|jotai|createContext)\b/g,
  ],
  ["decorators", /^\s*@\w+/gm],
  [
    "docker_instructions",
    /^\s*(?:FROM|RUN|COPY|EXPOSE|ENTRYPOINT|CMD|HEALTHCHECK)\s/gm,
  ],
  ["ci_steps", /^\s*(?:-\s+)?(?:uses|run):\s/gm],
];

export function computeCodeSignals(code: string): Record<string, number> {
  const signals: Record<string, number> = {};

  if (!code) {
    return signals;
  }

  for (const [name, pattern] of CODE_SIGNALS) {
    const matches = code.match(pattern);

    if (matches && matches.length > 0) {
      signals[name] = matches.length;
    }
  }

  return signals;
}


export const SLASH_COMMENT_LANGS = new Set([
  "typescript",
  "javascript",
  "java",
  "go",
  "rust",
  "c",
  "cpp",
  "csharp",
  "swift",
  "kotlin",
  "scala",
  "dart",
  "solidity",
  "php",
  "vue",
  "svelte",
  "css",
  "scss",
  "less",
  "protobuf",
  "graphql",
]);

export const HASH_COMMENT_LANGS = new Set([
  "python",
  "ruby",
  "shell",
  "elixir",
  "yaml",
  "terraform",
  "dockerfile",
  "make",
  "r",
  "php",
]);

export const DASH_COMMENT_LANGS = new Set(["sql", "lua"]);

export function isCommentLine(trimmed: string, language: string): boolean {
  if (!trimmed) {
    return false;
  }

  if (SLASH_COMMENT_LANGS.has(language)) {
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*/") ||
      trimmed === "*" ||
      trimmed.startsWith("* ")
    ) {
      return true;
    }
  }

  if (HASH_COMMENT_LANGS.has(language) && trimmed.startsWith("#")) {
    return true;
  }

  if (DASH_COMMENT_LANGS.has(language) && trimmed.startsWith("--")) {
    return true;
  }

  if (
    language === "python" &&
    (trimmed.startsWith('"""') || trimmed.startsWith("'''"))
  ) {
    return true;
  }

  return false;
}

export function indentDepth(line: string): number {
  let tabs = 0;
  let spaces = 0;

  for (const ch of line) {
    if (ch === "\t") {
      tabs++;
    } else if (ch === " ") {
      spaces++;
    } else {
      break;
    }
  }

  return tabs + Math.floor(spaces / 2);
}


export interface DependencyChanges {
  added: Array<{ name: string; version: string }>;
  removed: Array<{ name: string; version: string }>;
  changed: Array<{ name: string; from: string; to: string }>;
}

export const NON_DEP_KEYS = new Set([
  "name",
  "version",
  "description",
  "main",
  "module",
  "types",
  "type",
  "license",
  "private",
  "author",
  "homepage",
  "readme",
  "authors",
  "edition",
  "requires-python",
  "packagemanager",
  "node",
  "npm",
  "pnpm",
  "yarn",
  "bun",
]);

export const DEP_VERSION_LIKE =
  /^(?:[\^~<>=]*\s*\d|\*$|latest$|next$|workspace:|npm:|git\+|github:|file:|link:|https?:)/;

export function dependencyMapFromLines(
  base: string,
  lines: string[],
): Map<string, string> {
  const out = new Map<string, string>();

  for (const raw of lines) {
    const line = raw.trim();

    if (!line || line.startsWith("#") || line.startsWith("//")) {
      continue;
    }

    let name = "";
    let version = "";

    if (base === "package.json" || base === "composer.json") {
      const m = /^"(@?[\w./-]+)"\s*:\s*"([^"]*)"\s*,?$/.exec(line);

      if (
        m &&
        !NON_DEP_KEYS.has(m[1].toLowerCase()) &&
        DEP_VERSION_LIKE.test(m[2])
      ) {
        name = m[1];
        version = m[2];
      }
    } else if (base === "requirements.txt") {
      if (!line.startsWith("-")) {
        const m =
          /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*((?:[=<>~!]=?|@)\s*.*)?$/.exec(
            line,
          );

        if (m) {
          name = m[1];
          version = (m[2] ?? "").trim();
        }
      }
    } else if (base === "pyproject.toml" || base === "cargo.toml") {
      const kv =
        /^([A-Za-z0-9_.-]+)\s*=\s*(?:"([^"]*)"|\{[^}]*version\s*=\s*"([^"]*)")/.exec(
          line,
        );
      const arr =
        /^"([A-Za-z0-9][A-Za-z0-9._-]*)\s*([<>=~!^][^"]*)?"\s*,?$/.exec(line);

      if (kv && !NON_DEP_KEYS.has(kv[1].toLowerCase())) {
        name = kv[1];
        version = kv[2] ?? kv[3] ?? "";
      } else if (arr) {
        name = arr[1];
        version = arr[2] ?? "";
      }
    } else if (base === "go.mod") {
      const m =
        /^(?:require\s+)?([A-Za-z0-9.\-]+\.[A-Za-z]{2,}\/[^\s]+)\s+(v[^\s]+)/.exec(
          line,
        );

      if (m) {
        name = m[1];
        version = m[2];
      }
    } else if (base === "gemfile") {
      const m = /^gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/.exec(
        line,
      );

      if (m) {
        name = m[1];
        version = m[2] ?? "";
      }
    }

    if (name) {
      out.set(name, version);
    }
  }

  return out;
}

export function detectDependencyChanges(
  path: string,
  addedLines: string[],
  deletedLines: string[],
): DependencyChanges | null {
  const base = (normalizePath(path).split("/").pop() ?? "").toLowerCase();

  if (!(base in MANIFEST_LANGUAGE)) {
    return null;
  }

  const added = dependencyMapFromLines(base, addedLines);
  const removed = dependencyMapFromLines(base, deletedLines);

  const result: DependencyChanges = { added: [], removed: [], changed: [] };

  for (const [name, version] of added) {
    if (!removed.has(name)) {
      result.added.push({ name, version });
    } else if (removed.get(name) !== version) {
      result.changed.push({ name, from: removed.get(name) ?? "", to: version });
    }
  }

  for (const [name, version] of removed) {
    if (!added.has(name)) {
      result.removed.push({ name, version });
    }
  }

  return result.added.length || result.removed.length || result.changed.length
    ? result
    : null;
}


export interface PatchAnalysis {
  addedCode: string;
  deletedCode: string;
  hunkCount: number;
  hunksJson: string;
  touchedScopesJson: string;
  symbolsAdded: string[];
  symbolsModified: string[];
  symbolsRemoved: string[];
  importsAdded: string[];
  importsRemoved: string[];
  relativeImportsAdded: number;
  signals: Record<string, number>;
  commentLinesAdded: number;
  maxIndentDepth: number;
  dependencyChanges: DependencyChanges | null;
}

export function analyzePatch(
  rawPatch: string,
  path: string,
  language: string,
): PatchAnalysis {
  const { hunks, addedLines, deletedLines } = parsePatch(rawPatch);

  const addedCodeFull = addedLines.join("\n").trim();
  const deletedCodeFull = deletedLines.join("\n").trim();

  const addedSymbols = extractSymbols(addedLines, language);
  const removedSymbols = extractSymbols(deletedLines, language);

  const symbolsAdded: string[] = [];
  const symbolsModified: string[] = [];
  const symbolsRemoved: string[] = [];

  for (const symbol of addedSymbols) {
    (removedSymbols.has(symbol) ? symbolsModified : symbolsAdded).push(symbol);
  }

  for (const symbol of removedSymbols) {
    if (!addedSymbols.has(symbol)) {
      symbolsRemoved.push(symbol);
    }
  }

  const addedImports = extractImports(addedLines, language);
  const removedImports = extractImports(deletedLines, language);

  const importsAdded = [...addedImports.external].filter(
    (name) => !removedImports.external.has(name),
  );
  const importsRemoved = [...removedImports.external].filter(
    (name) => !addedImports.external.has(name),
  );

  let commentLinesAdded = 0;
  let maxIndentDepth = 0;

  for (const line of addedLines) {
    if (isCommentLine(line.trim(), language)) {
      commentLinesAdded++;
    }

    if (line.trim()) {
      maxIndentDepth = Math.max(maxIndentDepth, indentDepth(line));
    }
  }

  const scopes: string[] = [];
  const seenScopes = new Set<string>();

  for (const hunk of hunks) {
    if (hunk.context && !seenScopes.has(hunk.context)) {
      seenScopes.add(hunk.context);
      scopes.push(hunk.context);
    }
  }

  return {
    addedCode: truncate(addedCodeFull, MAX_ADDED_CODE_CHARS),
    deletedCode: truncate(deletedCodeFull, MAX_DELETED_CODE_CHARS),
    hunkCount: hunks.length,
    hunksJson: jsonCapped(
      hunks.slice(0, MAX_HUNKS_STORED).map((h) => ({
        s: h.newStart,
        n: h.newLines,
        a: h.added,
        d: h.deleted,
        c: h.context,
      })),
    ),
    touchedScopesJson: jsonCapped(scopes.slice(0, MAX_SCOPES_STORED)),
    symbolsAdded: symbolsAdded.slice(0, MAX_SYMBOLS_STORED),
    symbolsModified: symbolsModified.slice(0, MAX_SYMBOLS_STORED),
    symbolsRemoved: symbolsRemoved.slice(0, MAX_SYMBOLS_STORED),
    importsAdded: importsAdded.slice(0, MAX_IMPORTS_STORED),
    importsRemoved: importsRemoved.slice(0, MAX_IMPORTS_STORED),
    relativeImportsAdded: addedImports.internalCount,
    signals: computeCodeSignals(addedCodeFull),
    commentLinesAdded,
    maxIndentDepth,
    dependencyChanges: detectDependencyChanges(path, addedLines, deletedLines),
  };
}

export function normalizePatch(patch: string): string {
  return truncate(
    patch.replace(/\r\n/g, "\n").replace(/\r/g, "\n"),
    MAX_PATCH_CHARS,
  );
}


export interface MessageInfo {
  subject: string;
  body: string;
  commitType: string;
  commitScope: string;
  isBreaking: boolean;
  isRevert: boolean;
  isMergeMessage: boolean;
  coAuthors: number;
  prNumber: number | null;
}

export const CONVENTIONAL_RE =
  /^(feat|fix|refactor|perf|test|docs|chore|build|ci|style|revert)(?:\(([^)]+)\))?(!)?:\s/i;

export const LEADING_VERB_TYPES: Array<[RegExp, string]> = [
  [/^(?:add|implement|introduce|create|support|build)\b/i, "feat"],
  [/^(?:fix|resolve|patch|correct|handle)\b/i, "fix"],
  [
    /^(?:refactor|rewrite|restructure|simplify|clean|extract|move|rename)\b/i,
    "refactor",
  ],
  [/^(?:optimi[sz]e|speed|improve performance|reduce)\b/i, "perf"],
  [/^(?:test|add tests?)\b/i, "test"],
  [/^(?:doc|readme|document)\b/i, "docs"],
  [/^(?:bump|upgrade|update dep|deps?)\b/i, "chore"],
  [/^merge\b/i, "merge"],
  [/^revert\b/i, "revert"],
];

export function parseCommitMessage(message: string): MessageInfo {
  const text = message.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const subject = (lines[0] ?? "").trim();
  const body = lines.slice(1).join("\n").trim();

  let commitType = "other";
  let commitScope = "";
  let isBreaking = /BREAKING[ -]CHANGE/i.test(text);

  const conventional = CONVENTIONAL_RE.exec(subject);

  if (conventional) {
    commitType = conventional[1].toLowerCase();
    commitScope = conventional[2] ?? "";
    isBreaking = isBreaking || Boolean(conventional[3]);
  } else {
    for (const [pattern, type] of LEADING_VERB_TYPES) {
      if (pattern.test(subject)) {
        commitType = type;
        break;
      }
    }
  }

  const prMatch =
    /\(#(\d+)\)\s*$/.exec(subject) ??
    /^Merge pull request #(\d+)/i.exec(subject);

  return {
    subject,
    body,
    commitType,
    commitScope,
    isBreaking,
    isRevert: /^revert\b/i.test(subject),
    isMergeMessage: /^merge\b/i.test(subject),
    coAuthors: (text.match(/^co-authored-by:/gim) ?? []).length,
    prNumber: prMatch ? Number(prMatch[1]) : null,
  };
}


export function isRateLimitError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const err = error as AnyObject;

  const status =
    err?.status ?? err?.statusCode ?? err?.response?.status ?? undefined;

  if (status === 403 || status === 429) {
    return true;
  }

  const remaining =
    err?.response?.headers?.["x-ratelimit-remaining"] ??
    err?.headers?.["x-ratelimit-remaining"];

  if (remaining === "0" || remaining === 0) {
    return true;
  }

  const message = safeString(
    err?.message ?? (typeof error === "string" ? error : ""),
  ).toLowerCase();

  return (
    message.includes("rate limit") ||
    message.includes("ratelimit") ||
    message.includes("secondary rate limit") ||
    message.includes("abuse detection")
  );
}


export function parseToolResponse(response: any): any {
  if (response?.isError) {
    throw new Error(
      `GitHub MCP tool returned an error: ${JSON.stringify(response)}`,
    );
  }

  const contents = Array.isArray(response?.content) ? response.content : [];

  const textContent = contents.find((item: any) => item?.type === "text");

  if (textContent?.text !== undefined) {
    const text = String(textContent.text);

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  const resourceContent = contents.find(
    (item: any) => item?.type === "resource" || item?.resource,
  );

  if (resourceContent) {
    const resource = resourceContent?.resource ?? resourceContent;

    if (resource?.text !== undefined) {
      return {
        content: resource.text,
        encoding: "utf8",
        uri: resource.uri ?? "",
        mimeType: resource.mimeType ?? "",
      };
    }

    if (resource?.blob !== undefined) {
      return {
        content: resource.blob,
        encoding: "base64",
        uri: resource.uri ?? "",
        mimeType: resource.mimeType ?? "",
      };
    }
  }

  if (response?.structuredContent) {
    return response.structuredContent;
  }

  throw new Error("GitHub MCP returned an unsupported response format");
}


export async function mapWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency = CONCURRENCY,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<R>(items.length);

  let nextIndex = 0;

  const workerLoop = async () => {
    while (true) {
      const index = nextIndex++;

      if (index >= items.length) {
        return;
      }

      results[index] = await worker(items[index], index);
    }
  };

  await Promise.all(
    Array.from(
      {
        length: Math.min(concurrency, items.length),
      },
      () => workerLoop(),
    ),
  );

  return results;
}


export type DependencyBuckets = {
  runtime: Record<string, string>;
  dev: Record<string, string>;
};
