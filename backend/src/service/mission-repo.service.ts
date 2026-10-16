import type { MissionRepoPin } from "../graph/mission-graph.js";

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

export function githubInspector(
  opts: { token?: string; timeoutMs?: number; apiBase?: string } = {},
): RepoInspector {
  const token = opts.token ?? process.env.GITHUB_TOKEN;
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
      throw new Error(`GitHub ${res.status} for ${path}${hint}`);
    }
    return JSON.parse(res.text) as T;
  }

  const checked = (repo: string): string => {
    if (!REPO_RE.test(repo))
      throw new Error(`"${repo}" is not an owner/name repository`);
    return repo;
  };
  const encodePath = (p: string): string =>
    p.split("/").map(encodeURIComponent).join("/");

  return {
    async resolveHead(repo) {
      checked(repo);
      const info = await getJson<{ default_branch: string }>(`/repos/${repo}`);
      const commit = await getJson<{ sha: string }>(
        `/repos/${repo}/commits/${encodeURIComponent(info.default_branch)}`,
      );
      return { branch: info.default_branch, sha: commit.sha };
    },

    async listFiles(repo, sha) {
      checked(repo);
      const tree = await getJson<{
        tree: Array<{ path: string; type: string }>;
      }>(`/repos/${repo}/git/trees/${encodeURIComponent(sha)}?recursive=1`);
      return tree.tree.filter((t) => t.type === "blob").map((t) => t.path);
    },

    async readFile(repo, sha, path) {
      checked(repo);
      const res = await get(
        `/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(sha)}`,
        "application/vnd.github.raw+json",
      );
      if (res.status === 404) return null;
      if (res.status < 200 || res.status >= 300)
        throw new Error(`GitHub ${res.status} reading ${path}`);
      return res.text;
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
      return (await getJson<{ login: string }>(`/user`)).login;
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
