import type { Graph } from "../db/falkordb.js";
import type { FileRole } from "./sync-types.js";

export function envNumber(
  name: string,
  fallback: number,
  min = 1,
  max = Number.POSITIVE_INFINITY,
): number {
  const raw = process.env[name];
  const parsed = raw === undefined || raw === "" ? NaN : Number(raw);
  const value = Number.isFinite(parsed) ? parsed : fallback;

  return Math.min(max, Math.max(min, value));
}

export function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];

  if (raw === undefined || raw === "") {
    return fallback;
  }

  return raw === "true" || raw === "1";
}

export const REPO_CONCURRENCY = envNumber("GITHUB_CONCURRENCY", 10);
export const COMMIT_CONCURRENCY = envNumber("GITHUB_COMMIT_CONCURRENCY", 12);
export const PR_DETAIL_CONCURRENCY = envNumber(
  "GITHUB_PR_DETAIL_CONCURRENCY",
  8,
);

export const CONCURRENCY = REPO_CONCURRENCY;

export const PAGE_SIZE = envNumber("GITHUB_PAGE_SIZE", 100, 1, 100);

export const DEVELOPER_HISTORY_DAYS = envNumber("GITHUB_HISTORY_DAYS", 365);

export const MAX_INITIAL_COMMITS_PER_REPO = envNumber(
  "GITHUB_MAX_INITIAL_COMMITS_PER_REPO",
  60,
);

export const MAX_INITIAL_COMMITS_TOTAL = envNumber(
  "GITHUB_MAX_INITIAL_COMMITS_TOTAL",
  400,
);

export const SYNC_OVERLAP_DAYS = envNumber("GITHUB_SYNC_OVERLAP_DAYS", 7, 0);

export const MAX_PR_DETAILS = envNumber("GITHUB_MAX_PR_DETAILS", 20, 0);
export const MAX_ACTIVITY_ITEMS = envNumber("GITHUB_MAX_ACTIVITY_ITEMS", 50, 0);
export const MAX_WORKFLOW_FILES = envNumber("GITHUB_MAX_WORKFLOW_FILES", 2, 0);

export const EXCLUDED_REPOS = new Set(
  process.env.GITHUB_EXCLUDE_REPOS?.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

export function isExcludedRepo(repo: {
  name?: string;
  full_name?: string;
}): boolean {
  const name = String(repo.name ?? "").toLowerCase();
  const full = String(repo.full_name ?? "").toLowerCase();
  const short = full.split("/").pop() ?? "";

  return (
    EXCLUDED_REPOS.has(name) ||
    EXCLUDED_REPOS.has(full) ||
    EXCLUDED_REPOS.has(short)
  );
}

export const FETCH_PRS = envFlag("GITHUB_FETCH_PRS", true);

// PR detail fetches are one MCP call each: off by default for onboarding.
export const FETCH_PR_DETAILS = envFlag("GITHUB_FETCH_PR_DETAILS", false);

export const FETCH_PR_FILES = envFlag("GITHUB_FETCH_PR_FILES", false);

export const FETCH_ACTIVITY = envFlag("GITHUB_FETCH_ACTIVITY", true);

export const INCLUDE_EXTENDED_EVIDENCE = envFlag(
  "GITHUB_EXTENDED_EVIDENCE",
  true,
);

export const FETCH_FULL_FILE_FALLBACK = envFlag(
  "GITHUB_FETCH_FULL_FILE_FALLBACK",
  false,
);

export const DEBUG_GITHUB_PATCH = envFlag("GITHUB_SYNC_DEBUG", false);

// Repair re-fetches commits: skipped on onboarding, run it in a later refresh.
export const REPAIR_INCOMPLETE_FILECHANGES = envFlag(
  "GITHUB_REPAIR_INCOMPLETE_FILECHANGES",
  false,
);

export const ANALYSIS_VERSION = 4;

// Smaller stored patches = far less data over MCP, into FalkorDB and back out
// for analysis. 60k chars of diff per file is plenty for pattern detection.
export const MAX_PATCH_CHARS = envNumber(
  "GITHUB_MAX_PATCH_CHARS",
  60_000,
  10_000,
);
export const MAX_ADDED_CODE_CHARS = envNumber(
  "GITHUB_MAX_ADDED_CODE_CHARS",
  40_000,
  5_000,
);
export const MAX_DELETED_CODE_CHARS = envNumber(
  "GITHUB_MAX_DELETED_CODE_CHARS",
  10_000,
  5_000,
);

export const MAX_HUNKS_STORED = 300;
export const MAX_SCOPES_STORED = 120;
export const MAX_SYMBOLS_STORED = 250;
export const MAX_IMPORTS_STORED = 150;
export const MAX_REVIEW_COMMENTS_STORED = 12;

export const DB_BATCH_SIZE = envNumber("FALKORDB_BATCH_SIZE", 500);

export const FILECHANGE_BATCH_SIZE = envNumber(
  "FALKORDB_FILECHANGE_BATCH_SIZE",
  40,
);

export const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".java",
  ".go",
  ".rs",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".cxx",
  ".hpp",
  ".cs",
  ".rb",
  ".php",
  ".swift",
  ".kt",
  ".kts",
  ".scala",
  ".dart",
  ".ex",
  ".exs",
  ".erl",
  ".hrl",
  ".fs",
  ".fsx",
  ".lua",
  ".r",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
  ".vue",
  ".svelte",
  ".sol",
]);

export const IGNORE_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".rst",
  ".lock",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".mp3",
  ".mp4",
  ".mov",
  ".map",
]);

export const IGNORE_FILENAMES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "go.sum",
  "cargo.lock",
  "poetry.lock",
  "composer.lock",
  "gemfile.lock",
]);

export const IGNORE_PATH_SEGMENTS = [
  "node_modules/",
  "vendor/",
  "dist/",
  "build/",
  "coverage/",
  ".next/",
  ".nuxt/",
  "out/",
  "target/",
  "__pycache__/",
  ".git/",
  ".cache/",
  "generated/",
  "generated-code/",
];

export const GENERATED_FILE_PATTERNS = [
  /\.min\./i,
  /\.bundle\./i,
  /\.generated\./i,
  /\.g\./i,
  /\.gen\./i,
  /-generated\./i,
  /\.snap$/i,
];

export const LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".java": "java",
  ".go": "go",
  ".rs": "rust",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".scala": "scala",
  ".dart": "dart",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".hrl": "erlang",
  ".fs": "fsharp",
  ".fsx": "fsharp",
  ".lua": "lua",
  ".r": "r",
  ".sql": "sql",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".vue": "vue",
  ".svelte": "svelte",
  ".sol": "solidity",

  ".css": "css",
  ".scss": "scss",
  ".sass": "scss",
  ".less": "less",
  ".html": "html",
  ".prisma": "prisma",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".proto": "protobuf",
  ".tf": "terraform",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".cypher": "cypher",
};

export const STYLE_EXTENSIONS = new Set([".css", ".scss", ".sass", ".less"]);
export const SCHEMA_EXTENSIONS = new Set([
  ".prisma",
  ".graphql",
  ".gql",
  ".proto",
  ".cypher",
]);

export const MANIFEST_LANGUAGE: Record<string, string> = {
  "package.json": "json",
  "pyproject.toml": "toml",
  "requirements.txt": "text",
  "go.mod": "gomod",
  "cargo.toml": "toml",
  gemfile: "ruby",
  "composer.json": "json",
};

export const CONFIG_BASENAME_RE =
  /^(?:tsconfig[\w.-]*\.json|jsconfig\.json|\.eslintrc[\w.]*|\.prettierrc[\w.]*|eslint\.config\.\w+|biome\.jsonc?|turbo\.json|vercel\.json|nx\.json|components\.json|\.babelrc|\.nvmrc|\.env\.example)$/;

export const CONFIG_CODE_RE =
  /(?:^|\/)[\w.-]*\.config\.(?:ts|js|mjs|cjs)$|(?:^|\/)\.?(?:eslintrc|prettierrc)\.(?:js|cjs)$/;

export const TEST_PATH_RE =
  /(?:^|\/)(?:__tests__|__mocks__|tests?|specs?|e2e|cypress|playwright)\/|\.(?:test|spec)\.[a-z0-9]+$|_test\.(?:go|py|rb)$|(?:^|\/)test_[^/]+\.py$/;

export const MIGRATION_PATH_RE = /(?:^|\/)(?:migrations?|db\/migrate)\//;

export const INFRA_PATH_RE =
  /(?:^|\/)(?:\.github\/workflows|\.circleci|k8s|kubernetes|helm|terraform|deploy|infra)\/|docker-compose[\w.-]*\.ya?ml$|(?:^|\/)compose\.ya?ml$|(?:^|\/)\.gitlab-ci\.yml$/;

export const MANIFEST_FILENAMES = [
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
  "Gemfile",
  "composer.json",
];

export const CONFIG_FILENAMES = [
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yaml",
  "tsconfig.json",
  "Makefile",
  "prisma/schema.prisma",
  "turbo.json",
  "pnpm-workspace.yaml",
  "vercel.json",
  ".env.example",
];

export const MAX_README_CHARS = 12_000;
export const MAX_MANIFEST_FILE_CHARS = 12_000;
export const MAX_CONFIG_FILE_CHARS = 4_000;
export const MAX_DEPENDENCIES_PER_ECOSYSTEM = 300;

export const REPO_CONTEXT_REFRESH_DAYS = envNumber(
  "GITHUB_REPO_CONTEXT_REFRESH_DAYS",
  7,
);

export const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertSafeIdentifier(value: string): string {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(
      `Refusing to interpolate unsafe identifier into Cypher: "${value}"`,
    );
  }

  return value;
}

export const INGESTION_INDEXES: Array<{ label: string; property: string }> = [
  { label: "Repository", property: "id" },
  { label: "Repository", property: "full_name" },
  { label: "Commit", property: "id" },
  { label: "Commit", property: "developer_id" },
  { label: "FileChange", property: "id" },
  { label: "FileChange", property: "repository_id" },
  { label: "FileChange", property: "developer_id" },
  { label: "Developer", property: "id" },
  { label: "PullRequest", property: "id" },
  { label: "File", property: "id" },
  { label: "Issue", property: "id" },
  { label: "ReviewedPullRequest", property: "id" },
];

export async function ensureIngestionIndexes(graph: Graph): Promise<void> {
  for (const { label, property } of INGESTION_INDEXES) {
    const safeLabel = assertSafeIdentifier(label);
    const safeProperty = assertSafeIdentifier(property);

    try {
      await graph.query(
        `CREATE INDEX FOR (n:${safeLabel}) ON (n.${safeProperty})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (!/already\s+(exists|indexed)/i.test(message)) {
        console.error(
          `⚠️ Failed to create index on :${safeLabel}(${safeProperty}):`,
          message,
        );
      }
    }
  }
}

export const FULLTEXT_INDEXES: Array<{ label: string; properties: string[] }> =
  [
    { label: "Commit", properties: ["message"] },
    { label: "FileChange", properties: ["path", "added_code"] },
    { label: "PullRequest", properties: ["title", "body"] },
    { label: "Issue", properties: ["title", "body"] },
  ];

export async function ensureFulltextIndexes(graph: Graph): Promise<void> {
  for (const { label, properties } of FULLTEXT_INDEXES) {
    const safeLabel = assertSafeIdentifier(label);
    const propsList = properties
      .map((p) => `'${assertSafeIdentifier(p)}'`)
      .join(", ");

    try {
      await graph.query(
        `CALL db.idx.fulltext.createNodeIndex('${safeLabel}', ${propsList})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (!/already\s+(exists|indexed)/i.test(message)) {
        console.error(
          `⚠️ Failed to create fulltext index on :${safeLabel}:`,
          message,
        );
      }
    }
  }
}
