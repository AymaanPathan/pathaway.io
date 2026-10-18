import type { MissionRepoPin } from "../graph/mission-graph.js";
import { withGithubMcp } from "../mcp/github-mcp.js";
import {
  getCommit,
  getFileContents,
  getMe,
  searchRepositories,
} from "../github-mcp-tools/index.js";

export type CiState = "success" | "failure" | "pending" | "none";

export interface ChangedFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string;
}

export interface CompareCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

export interface CompareResult {
  aheadBy: number;
  status: string;
  headSha: string;
  headSubject: string;
  commits: CompareCommit[];
  files: ChangedFile[];
  truncated: boolean;
}

export interface RepoInspector {
  resolveHead(repo: string): Promise<{ branch: string; sha: string }>;
  listFiles(repo: string, sha: string): Promise<string[]>;
  readFile(repo: string, sha: string, path: string): Promise<string | null>;
  compare(repo: string, base: string, head: string): Promise<CompareResult>;
  ciState(repo: string, sha: string): Promise<CiState>;
  /** login of the user the token belongs to (needs a USER token) */
  currentUser(): Promise<string>;
  /** forks `repo` into the token's account and waits until it is ready. Returns "owner/name". */
  forkRepo(repo: string): Promise<string>;
  /** creates `branch` at `sha`. If it already exists it is reused. Returns the branch name. */
  createBranch(repo: string, branch: string, sha: string): Promise<string>;
}

// ------------------------------------------------------------
// GitHub implementation
// ------------------------------------------------------------

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);
const encodePath = (p: string): string =>
  p.split("/").map(encodeURIComponent).join("/");

/** GitHub answered 401: the token is expired, revoked or malformed. Reconnecting GitHub fixes it. */
export class GithubAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GithubAuthError";
  }
}

/** Strips whitespace / an accidental "Bearer " prefix; empty -> undefined. */
function cleanToken(raw: string | undefined | null): string | undefined {
  const t = String(raw ?? "")
    .trim()
    .replace(/^bearer\s+/i, "")
    .trim();
  return t || undefined;
}

/** Cheap token probe (GET /user). "unknown" = network error / rate limit, do not treat as invalid. */
export async function checkGithubToken(
  rawToken: string,
  apiBase = "https://api.github.com",
): Promise<"valid" | "invalid" | "unknown"> {
  const token = cleanToken(rawToken);
  if (!token) return "invalid";
  try {
    const res = await fetch(`${apiBase}/user`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "pathway-mission",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 200) return "valid";
    if (res.status === 401) return "invalid";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function githubInspector(
  opts: { token?: string; timeoutMs?: number; apiBase?: string } = {},
): RepoInspector {
  const token = cleanToken(opts.token ?? process.env.GITHUB_TOKEN);
  const base = opts.apiBase ?? "https://api.github.com";
  const timeoutMs = opts.timeoutMs ?? 15_000;

  async function request(
    path: string,
    init: { method?: string; body?: unknown; accept?: string } = {},
  ): Promise<{ status: number; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}${path}`, {
        method: init.method ?? "GET",
        headers: {
          Accept: init.accept ?? "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "pathway-mission",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
      return { status: res.status, text: await res.text() };
    } finally {
      clearTimeout(timer);
    }
  }

  const get = (path: string, accept?: string) => request(path, { accept });

  async function getJson<T>(path: string): Promise<T> {
    const res = await get(path);
    if (res.status < 200 || res.status >= 300) {
      // GitHub answers 404 (not 401/403) for private repos the token can't see
      const hint =
        res.status === 404
          ? token
            ? " (repository not found, or this token has no access to it: private repo needs the `repo` scope)"
            : " (no GitHub token was used: private repositories return 404 without one)"
          : res.status === 401
            ? " (GitHub token is invalid or expired: reconnect GitHub)"
            : res.status === 403
              ? " (forbidden or rate limited)"
              : "";
      const message = `GitHub ${res.status} for ${path}${hint}`;
      if (res.status === 401) throw new GithubAuthError(message);
      throw new Error(message);
    }
    return JSON.parse(res.text) as T;
  }

  const checked = (repo: string): string => {
    if (!REPO_RE.test(repo))
      throw new Error(`"${repo}" is not an owner/name repository`);
    return repo;
  };
  const requireToken = (): string => {
    if (!token) throw new Error("GitHub MCP requires an access token");
    return token;
  };

  // ---- resolveHead: MCP first, REST fallback ------------------------------

  async function resolveHeadViaMcp(
    repo: string,
  ): Promise<{ branch: string; sha: string }> {
    const [owner, name] = repo.split("/") as [string, string];
    return withGithubMcp(
      requireToken(),
      ["search_repositories", "get_commit"],
      async (call) => {
        const search = await searchRepositories(call, {
          query: `repo:${repo}`,
          perPage: 1,
          page: 1,
        });
        if (!search.ok)
          throw new Error(search.text || "search_repositories failed");

        const items: any[] = Array.isArray(search.data)
          ? search.data
          : Array.isArray(search.data?.items)
            ? search.data.items
            : [];
        const info =
          items.find(
            (i) =>
              String(i?.full_name ?? "").toLowerCase() === repo.toLowerCase(),
          ) ?? items[0];
        if (!info)
          throw new Error(
            `search_repositories returned no result for ${repo} (not visible to this token, or not indexed yet)`,
          );

        const branch = String(info.default_branch ?? info.defaultBranch ?? "");
        if (!branch)
          throw new Error(`default branch of ${repo} missing in search result`);

        const commit = await getCommit(call, {
          owner,
          repo: name,
          sha: branch,
        });
        if (!commit.ok)
          throw new Error(
            commit.text || `get_commit failed for ${repo}@${branch}`,
          );
        const sha = (commit.data as { sha?: unknown } | null)?.sha;
        if (typeof sha !== "string" || !sha)
          throw new Error(`get_commit returned no sha for ${repo}@${branch}`);
        return { branch, sha };
      },
    );
  }

  async function resolveHeadViaRest(
    repo: string,
  ): Promise<{ branch: string; sha: string }> {
    const info = await getJson<{ default_branch?: string }>(`/repos/${repo}`);
    const branch = info.default_branch;
    if (!branch)
      throw new Error(`GitHub did not report a default branch for ${repo}`);
    const commit = await getJson<{ sha?: string }>(
      `/repos/${repo}/commits/${encodeURIComponent(branch)}`,
    );
    if (!commit.sha)
      throw new Error(`GitHub returned no commit for ${repo}@${branch}`);
    return { branch, sha: commit.sha };
  }

  // ---- listFiles: one REST tree call, MCP directory walk as fallback ------

  async function listFilesViaRest(
    repo: string,
    sha: string,
  ): Promise<string[]> {
    const tree = await getJson<{
      truncated?: boolean;
      tree?: Array<{ path: string; type: string }>;
    }>(`/repos/${repo}/git/trees/${encodeURIComponent(sha)}?recursive=1`);
    if (tree.truncated)
      throw new Error(
        "git tree was truncated by GitHub (repository too large)",
      );
    return (tree.tree ?? [])
      .filter((t) => t.type === "blob")
      .map((t) => t.path);
  }

  async function listFilesViaMcp(repo: string, sha: string): Promise<string[]> {
    const [owner, name] = repo.split("/") as [string, string];
    return withGithubMcp(
      requireToken(),
      ["get_file_contents"],
      async (call) => {
        const files: string[] = [];
        const SKIP = new Set(["node_modules", ".git", "dist", "build"]);
        const visit = async (path: string): Promise<void> => {
          const result = await getFileContents(call, {
            owner,
            repo: name,
            path,
            ref: sha,
          });
          if (!result.ok)
            throw new Error(
              result.text || `GitHub MCP could not read ${path || repo}`,
            );
          const data = result.data as any;
          const entries: any[] = Array.isArray(data)
            ? data
            : Array.isArray(data?.entries)
              ? data.entries
              : [];
          for (const entry of entries) {
            const entryPath = String(entry?.path ?? entry?.name ?? "");
            if (!entryPath) continue;
            const type = String(entry?.type ?? "");
            if (type === "dir" || type === "directory" || type === "tree") {
              if (!SKIP.has(entryPath.split("/").pop() ?? ""))
                await visit(entryPath);
            } else if (type === "file" || type === "blob") {
              files.push(entryPath);
            }
          }
        };
        await visit("");
        return files;
      },
    );
  }

  // ---- readFile: one REST call, MCP as fallback ---------------------------

  async function readFileViaRest(
    repo: string,
    sha: string,
    path: string,
  ): Promise<string | null> {
    const res = await get(
      `/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(sha)}`,
      "application/vnd.github.raw+json",
    );
    if (res.status === 404) return null;
    if (res.status === 401)
      throw new GithubAuthError(
        `GitHub 401 reading ${path} (token invalid or expired)`,
      );
    if (res.status < 200 || res.status >= 300)
      throw new Error(`GitHub ${res.status} reading ${path}`);
    return res.text;
  }

  async function readFileViaMcp(
    repo: string,
    sha: string,
    path: string,
  ): Promise<string | null> {
    const [owner, name] = repo.split("/") as [string, string];
    return withGithubMcp(
      requireToken(),
      ["get_file_contents"],
      async (call) => {
        const result = await getFileContents(call, {
          owner,
          repo: name,
          path,
          ref: sha,
        });
        if (!result.ok) return null;
        const data = result.data as { content?: unknown } | string | null;
        return typeof data === "string"
          ? data
          : typeof data?.content === "string"
            ? data.content
            : null;
      },
    );
  }

  return {
    async resolveHead(repo) {
      checked(repo);
      let mcpError = "";
      try {
        return await resolveHeadViaMcp(repo);
      } catch (error) {
        mcpError = errText(error);
        console.warn(
          `[repo-inspector] MCP resolveHead failed for ${repo}: ${mcpError}`,
        );
      }
      try {
        return await resolveHeadViaRest(repo);
      } catch (error) {
        const message = `could not resolve ${repo} (MCP: ${mcpError}; REST: ${errText(error)})`;
        if (error instanceof GithubAuthError)
          throw new GithubAuthError(message);
        throw new Error(message);
      }
    },

    async listFiles(repo, sha) {
      checked(repo);
      try {
        return await listFilesViaRest(repo, sha);
      } catch (error) {
        if (error instanceof GithubAuthError) throw error;
        console.warn(
          `[repo-inspector] REST listFiles failed for ${repo}@${sha.slice(0, 7)}: ${errText(error)}; walking via MCP`,
        );
        return listFilesViaMcp(repo, sha);
      }
    },

    async readFile(repo, sha, path) {
      checked(repo);
      try {
        return await readFileViaRest(repo, sha, path);
      } catch (error) {
        if (error instanceof GithubAuthError) throw error;
        console.warn(
          `[repo-inspector] REST readFile failed for ${path}: ${errText(error)}; trying MCP`,
        );
        return readFileViaMcp(repo, sha, path);
      }
    },

    async compare(repo, baseRef, head) {
      checked(repo);
      const data = await getJson<{
        status: string;
        ahead_by: number;
        commits?: Array<{
          sha: string;
          html_url?: string;
          commit?: {
            message?: string;
            author?: { name?: string; date?: string };
          };
          author?: { login?: string };
        }>;
        files?: Array<{
          filename: string;
          status: string;
          additions: number;
          deletions: number;
          patch?: string;
        }>;
      }>(
        `/repos/${repo}/compare/${encodeURIComponent(baseRef)}...${encodeURIComponent(head)}`,
      );
      const last = data.commits?.[data.commits.length - 1];
      const commits = (data.commits ?? []).map((commit) => ({
        sha: commit.sha,
        message: (commit.commit?.message ?? "").split("\n")[0] ?? "",
        author:
          commit.author?.login ?? commit.commit?.author?.name ?? "unknown",
        date: commit.commit?.author?.date ?? "",
        url: commit.html_url ?? "",
      }));
      const files = (data.files ?? []).map((f) => ({
        path: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? "",
      }));
      return {
        aheadBy: data.ahead_by ?? 0,
        status: data.status,
        headSha: last?.sha ?? head,
        headSubject: (last?.commit?.message ?? "").split("\n")[0] ?? "",
        commits,
        files,
        truncated: files.length >= 300,
      };
    },

    async ciState(repo, sha) {
      checked(repo);
      try {
        const data = await getJson<{
          total_count: number;
          check_runs: Array<{ status: string; conclusion: string | null }>;
        }>(
          `/repos/${repo}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`,
        );
        const runs = data.check_runs ?? [];
        if (!runs.length) return "none";
        if (runs.some((r) => r.status !== "completed")) return "pending";
        const bad = new Set([
          "failure",
          "timed_out",
          "cancelled",
          "action_required",
        ]);
        return runs.some((r) => r.conclusion && bad.has(r.conclusion))
          ? "failure"
          : "success";
      } catch {
        return "none";
      }
    },

    async currentUser() {
      try {
        return await withGithubMcp(requireToken(), ["get_me"], async (call) => {
          const result = await getMe(call);
          if (!result.ok) throw new Error(result.text || "get_me failed");
          const login = (result.data as { login?: unknown } | null)?.login;
          if (typeof login !== "string" || !login)
            throw new Error("GitHub MCP did not return the current user");
          return login;
        });
      } catch (error) {
        console.warn(
          `[repo-inspector] MCP get_me failed: ${errText(error)}; using REST`,
        );
        const me = await getJson<{ login?: string }>("/user");
        if (!me.login)
          throw new Error("GitHub did not return the current user");
        return me.login;
      }
    },

    async forkRepo(repo) {
      checked(repo);
      const me = await this.currentUser();
      const [owner, name] = repo.split("/") as [string, string];
      // the developer already owns the repo: no fork needed
      if (owner.toLowerCase() === me.toLowerCase()) return repo;

      const res = await request(`/repos/${repo}/forks`, {
        method: "POST",
        body: {},
      });
      if (res.status !== 202 && res.status !== 200)
        throw new Error(
          `GitHub ${res.status} forking ${repo}: ${res.text.slice(0, 200)}`,
        );
      const fork =
        (JSON.parse(res.text) as { full_name?: string }).full_name ??
        `${me}/${name}`;

      // forking is asynchronous: wait until the fork answers
      for (let i = 0; i < 20; i++) {
        const probe = await get(`/repos/${fork}`);
        if (probe.status === 200) return fork;
        await sleep(1500);
      }
      throw new Error(
        `fork ${fork} was created but is not ready yet, try again in a moment`,
      );
    },

    async createBranch(repo, branch, sha) {
      checked(repo);
      const res = await request(`/repos/${repo}/git/refs`, {
        method: "POST",
        body: { ref: `refs/heads/${branch}`, sha },
      });
      if (res.status === 201) return branch;
      if (res.status === 422 && /already exists/i.test(res.text)) return branch;
      throw new Error(
        `GitHub ${res.status} creating branch ${branch}: ${res.text.slice(0, 200)}`,
      );
    },
  };
}

// ------------------------------------------------------------
// inspection
// ------------------------------------------------------------

export const TEST_FILE =
  /(^|\/)(__tests__\/.+|[^/]+\.(test|spec)\.[cm]?[jt]sx?)$/i;

/**
 * What the repository says about a suspected gap. This is evidence, not a verdict:
 * it only covers the package manifest, the start file and file paths.
 */
export interface GapProbe {
  terms: string[];
  /** dependency names (package.json) that contain a gap term */
  dependencyHits: string[];
  /** gap terms that appear in the start file text */
  startFileHits: string[];
  /** repository paths that contain a gap term (max 5) */
  pathHits: string[];
  /** terms found BOTH as a dependency and in the start file: the gap is probably not real */
  contradictingTerms: string[];
  manifestScanned: boolean;
}

export interface RepoInspection {
  pin: MissionRepoPin;
  startPath: string;
  startFileExists: boolean;
  startFileText: string;
  observedStillPresent: boolean;
  excerpt: string;
  files: string[];
  nearbyFiles: string[];
  testFiles: string[];
  sampleTest: { path: string; excerpt: string } | null;
  gapProbe: GapProbe;
}

const norm = (s: string): string =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_$]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
const dirOf = (p: string): string => p.split("/").slice(0, -1).join("/");
const baseName = (p: string): string =>
  (p.split("/").pop() ?? "")
    .replace(/\.(test|spec)(?=\.)/i, "")
    .replace(/\.[^.]+$/, "");

/** Where the NEW test file of a mission goes: next to the starting file. */
export function suggestTestPath(startPath: string): string {
  const dir = dirOf(startPath);
  const name = `${baseName(startPath)}.mission.test.ts`;
  return dir ? `${dir}/${name}` : name;
}

const GAP_STOP = new Set([
  "with",
  "from",
  "into",
  "using",
  "basic",
  "basics",
  "advanced",
  "backend",
  "frontend",
  "testing",
  "tests",
  "handling",
  "management",
  "design",
  "development",
  "engineering",
  "service",
  "services",
  "system",
  "systems",
  "code",
  "data",
  "node",
  "pattern",
  "patterns",
  "layer",
  "client",
  "package",
]);

/** Search terms for the gap probe, taken from capability and gap topic names. */
export function deriveGapTerms(
  inputs: Array<string | null | undefined>,
): string[] {
  const out = new Set<string>();
  for (const input of inputs)
    for (const t of String(input ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/))
      if (t.length >= 4 && !GAP_STOP.has(t) && !/^\d+$/.test(t)) out.add(t);
  return [...out].slice(0, 8);
}

/** First meaningful token of a library name: "ioredis" -> "ioredis", "@redis/client" -> "redis". */
export function mechanismToken(library: string | null | undefined): string {
  const skip = new Set(["the", "for", "and", "npm", "node", "js", "client"]);
  return (
    String(library ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .find((t) => t.length >= 3 && !skip.has(t)) ?? ""
  );
}

function findPackageRoot(
  fileSet: Set<string>,
  startPath: string,
): string | null {
  const parts = dirOf(startPath).split("/").filter(Boolean);
  for (let i = parts.length; i >= 0; i--) {
    const dir = parts.slice(0, i).join("/");
    if (fileSet.has(dir ? `${dir}/package.json` : "package.json")) return dir;
  }
  return null;
}

function findEvidenceAnchor(text: string, fragment: string): string | null {
  const normalizedText = norm(text);
  const normalizedFragment = norm(fragment);
  if (!normalizedText || !normalizedFragment) return null;

  if (normalizedText.includes(normalizedFragment)) return fragment;

  const candidates = fragment
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => norm(line).length >= 24)
    .sort((a, b) => norm(b).length - norm(a).length);

  for (const candidate of candidates) {
    if (normalizedText.includes(norm(candidate))) return candidate;
  }
  return null;
}

function excerptAround(text: string, fragment: string, found: boolean): string {
  const lines = text.split(/\r?\n/);
  const normalizedText = norm(text);
  const anchor = found
    ? fragment
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => norm(line).length >= 12)
        .sort((a, b) => norm(b).length - norm(a).length)
        .find((line) => normalizedText.includes(norm(line)))
    : null;
  const normalizedAnchor = anchor ? norm(anchor) : "";
  const at = normalizedAnchor
    ? lines.findIndex((line) => norm(line).includes(normalizedAnchor))
    : -1;

  if (at < 0) return text.slice(0, 3000);
  return lines
    .slice(Math.max(0, at - 10), at + 60)
    .join("\n")
    .slice(0, 3000);
}

/**
 * Looks for `fragment` in `text` (whitespace/punctuation-insensitive).
 * `excerpt` is a short window around the match, or "" when it was not found.
 */
export function locateEvidence(
  text: string,
  fragment: string,
  maxChars = 1200,
): { found: boolean; excerpt: string } {
  const anchor = findEvidenceAnchor(text, fragment);
  if (anchor === null) return { found: false, excerpt: "" };
  return {
    found: true,
    excerpt: excerptAround(text, anchor, true).slice(0, maxChars),
  };
}

/**
 * Command that runs the mission's test file. Works even when the repository
 * has no test script: falls back to vitest (the mission adds it).
 */
export function testCommandFor(
  pin: MissionRepoPin,
  testFile: string | null,
): string | null {
  const prefix = pin.packageRoot ? `cd ${pin.packageRoot} && ` : "";
  if (!testFile) return pin.testCommand ?? `${prefix}npx --yes vitest run`;
  const rel =
    pin.packageRoot && testFile.startsWith(`${pin.packageRoot}/`)
      ? testFile.slice(pin.packageRoot.length + 1)
      : testFile;
  if (pin.testRunner === "jest") return `${prefix}npx jest ${rel}`;
  if (pin.testRunner === "mocha") return `${prefix}npx mocha ${rel}`;
  return `${prefix}npx --yes vitest run ${rel}`;
}

export async function inspectRepository(
  inspector: RepoInspector,
  input: {
    repository: string;
    startPath: string;
    observedInCode: string;
    /** terms from the capability / gap topics, used to probe whether the gap is real */
    gapTerms?: string[];
  },
): Promise<RepoInspection> {
  const { repository } = input;
  const { branch, sha } = await inspector.resolveHead(repository);
  const files = await inspector.listFiles(repository, sha);
  const fileSet = new Set(files);

  const startPath =
    files.find((f) => f === input.startPath) ??
    files.find((f) => f.toLowerCase() === input.startPath.toLowerCase()) ??
    input.startPath;
  const startFileExists = fileSet.has(startPath);
  const startFileText = startFileExists
    ? ((await inspector.readFile(repository, sha, startPath)) ?? "")
    : "";
  const matchedEvidence = startFileExists
    ? findEvidenceAnchor(startFileText, input.observedInCode)
    : null;
  const observedStillPresent = matchedEvidence !== null;

  const root = findPackageRoot(fileSet, startPath);
  const packageRoot = root ?? "";
  let testRunner: MissionRepoPin["testRunner"] = "unknown";
  let testCommand: string | null = null;
  let packageManager: MissionRepoPin["packageManager"] = "npm";
  let depNames: string[] = [];
  let manifestScanned = false;
  if (root !== null) {
    const pjText = await inspector.readFile(
      repository,
      sha,
      root ? `${root}/package.json` : "package.json",
    );
    let pj: Record<string, any> = {};
    try {
      pj = pjText ? JSON.parse(pjText) : {};
      manifestScanned = Boolean(pjText);
    } catch {
      pj = {};
    }
    const deps = { ...(pj.dependencies ?? {}), ...(pj.devDependencies ?? {}) };
    depNames = Object.keys(deps);
    testRunner = deps.vitest
      ? "vitest"
      : deps.jest || deps["ts-jest"]
        ? "jest"
        : deps.mocha
          ? "mocha"
          : "unknown";
    const has = (name: string): boolean =>
      fileSet.has(root ? `${root}/${name}` : name) || fileSet.has(name);
    packageManager = has("pnpm-lock.yaml")
      ? "pnpm"
      : has("yarn.lock")
        ? "yarn"
        : has("bun.lockb") || has("bun.lock")
          ? "bun"
          : "npm";
    const script = typeof pj.scripts?.test === "string" ? pj.scripts.test : "";
    if (script && !/no test specified/i.test(script)) {
      const run =
        packageManager === "bun" ? "bun run test" : `${packageManager} test`;
      testCommand = `${root ? `cd ${root} && ` : ""}${run}`;
    }
  }

  // gap probe: evidence about whether the suspected gap is really open
  const terms = input.gapTerms ?? [];
  const lowerStart = startFileText.toLowerCase();
  const depMatches = (t: string): boolean =>
    depNames.some((d) => d.toLowerCase().includes(t));
  const gapProbe: GapProbe = {
    terms,
    dependencyHits: depNames.filter((d) =>
      terms.some((t) => d.toLowerCase().includes(t)),
    ),
    startFileHits: terms.filter((t) => lowerStart.includes(t)),
    pathHits: files
      .filter((f) => terms.some((t) => f.toLowerCase().includes(t)))
      .slice(0, 5),
    contradictingTerms: terms.filter(
      (t) => depMatches(t) && lowerStart.includes(t),
    ),
    manifestScanned,
  };

  const inRoot = (f: string): boolean =>
    !packageRoot || f.startsWith(`${packageRoot}/`);
  const startDir = dirOf(startPath);
  const stem = baseName(startPath).toLowerCase();

  const testFiles = files
    .filter((f) => TEST_FILE.test(f) && inRoot(f))
    .sort((a, b) => {
      const score = (f: string): number =>
        (baseName(f).toLowerCase() === stem ? 2 : 0) +
        (dirOf(f) === startDir ? 1 : 0);
      return score(b) - score(a) || a.localeCompare(b);
    })
    .slice(0, 12);
  const nearbyFiles = files
    .filter((f) => dirOf(f) === startDir && f !== startPath)
    .slice(0, 20);

  let sampleTest: RepoInspection["sampleTest"] = null;
  const sampleFrom = testFiles[0];
  if (sampleFrom) {
    const text = await inspector.readFile(repository, sha, sampleFrom);
    if (text) sampleTest = { path: sampleFrom, excerpt: text.slice(0, 1500) };
  }

  return {
    pin: {
      repository,
      branch,
      baseCommit: sha,
      packageRoot,
      packageManager,
      testRunner,
      testCommand,
    },
    startPath,
    startFileExists,
    startFileText,
    observedStillPresent,
    excerpt: excerptAround(
      startFileText,
      matchedEvidence ?? input.observedInCode,
      observedStillPresent,
    ),
    files,
    nearbyFiles,
    testFiles,
    sampleTest,
    gapProbe,
  };
}
