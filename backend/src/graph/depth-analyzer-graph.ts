import type { Graph } from "../db/falkordb.js";

type Row = Record<string, any>;
export type ProgressFn = (stage: string, detail?: Row) => void;

const LOG_PREFIX = "[depth-graph]";

function log(message: string, detail?: Row): void {
  if (detail !== undefined) console.log(`${LOG_PREFIX} ${message}`, detail);
  else console.log(`${LOG_PREFIX} ${message}`);
}

const raw = (v: unknown): string =>
  v == null || typeof v === "object" ? "" : String(v);
const str = (v: unknown, fallback = ""): string =>
  v == null || typeof v === "object" ? fallback : String(v).trim();
const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (v: unknown): boolean => v === true || v === "true" || v === 1;
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : [];
const mapList = (v: unknown): Row[] =>
  Array.isArray(v)
    ? v.filter((x) => x && typeof x === "object" && !Array.isArray(x))
    : [];
const unique = <T>(items: T[]): T[] => [...new Set(items)];
const round = (v: number, digits = 2): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    const s = raw(value);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

function envInt(name: string, fallback: number, min = 1, max = 1_000_000) {
  const parsed = Number(process.env[name]);
  const value =
    Number.isFinite(parsed) && process.env[name] ? parsed : fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

const FILE_PAGE_SIZE = envInt("DEPTH_FILE_PAGE_SIZE", 1000, 50, 5000);
const DB_BATCH_SIZE = envInt("FALKORDB_BATCH_SIZE", 500);
const DEMO_LIMIT = envInt("DEPTH_DEMO_LIMIT", 1500, 50, 10_000);
/** How long taxonomy reads (edges, topic meta) are reused inside one process. */
const TAXONOMY_TTL_MS = envInt("DEPTH_TAXONOMY_CACHE_MS", 15_000, 0, 600_000);
const DAY_MS = 86_400_000;

export const DEPTH_ANALYSIS_VERSION = 3;

// ---- query helpers ---------------------------------------------------------

type Primitive = string | number | boolean | null;

function toParams(items: Row[]): Array<Record<string, Primitive>> {
  return items.map((item) => {
    const out: Record<string, Primitive> = {};
    for (const [key, value] of Object.entries(item)) {
      if (value === undefined || value === null) out[key] = null;
      else if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        out[key] = value;
      } else {
        throw new TypeError(
          `Unsupported FalkorDB query parameter for "${key}": ${typeof value}`,
        );
      }
    }
    return out;
  });
}

async function rows(
  graph: Graph,
  query: string,
  params: Row = {},
): Promise<Row[]> {
  const result = await graph.query(query, { params });
  return (result.data ?? []) as Row[];
}

/** Like rows(), but returns null on failure so callers can fall back. */
async function tryRows(
  graph: Graph,
  label: string,
  query: string,
  params: Row = {},
): Promise<Row[] | null> {
  try {
    return await rows(graph, query, params);
  } catch (error) {
    log(`${label} failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * One write query over `items` in batches. The query MUST take rows from
 * $batch and end with `RETURN count(<var>) AS n`. Every query does ONE job so
 * that a missed MATCH costs one write and is logged instead of vanishing.
 * strict = true throws when rows were lost (used before stale cleanup).
 */
async function runCounted(
  graph: Graph,
  label: string,
  query: string,
  items: Row[],
  options: { params?: Row; strict?: boolean } = {},
): Promise<number> {
  let written = 0;
  for (const batch of chunk(items, DB_BATCH_SIZE)) {
    const result = await graph.query(query, {
      params: { ...(options.params ?? {}), batch: toParams(batch) },
    });
    written += num(((result.data ?? []) as Row[])[0]?.n);
  }
  if (written < items.length) {
    log(
      `${label}: ${items.length - written} of ${items.length} rows matched nothing`,
    );
    if (options.strict) {
      throw new Error(
        `${label} was incomplete (${written}/${items.length}); refusing to continue to stale-data cleanup`,
      );
    }
  }
  return written;
}

async function ignoreExists(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already\s+(exists|indexed)/i.test(message)) {
      log(`${label} failed`, { message });
    }
  }
}

// ============================================================
// TYPES
// ============================================================

export type DepthLevel = "none" | "surface" | "working" | "proficient" | "deep";

/** Was it built, or just present? Decided by the agent, guarded by the graph. */
export type Authenticity =
  | "genuine_implementation"
  | "working_usage"
  | "incidental"
  | "boilerplate"
  | "insufficient_evidence";

export type Confidence = "high" | "medium" | "low";

export const DEPTH_RANK: Record<DepthLevel, number> = {
  none: 0,
  surface: 1,
  working: 2,
  proficient: 3,
  deep: 4,
};
export const DEPTH_LEVELS: DepthLevel[] = [
  "none",
  "surface",
  "working",
  "proficient",
  "deep",
];

/** Score band of every level. The final score is always clamped into it. */
export const DEPTH_BANDS: Record<DepthLevel, [number, number]> = {
  none: [0, 0],
  surface: [1, 19],
  working: [20, 39],
  proficient: [40, 64],
  deep: [65, 100],
};

export function levelForScore(score: number): DepthLevel {
  if (score <= 0) return "none";
  if (score < 20) return "surface";
  if (score < 40) return "working";
  if (score < 65) return "proficient";
  return "deep";
}

export const asDepthLevel = (v: unknown, fallback: DepthLevel = "none") =>
  (DEPTH_LEVELS as string[]).includes(str(v))
    ? (str(v) as DepthLevel)
    : fallback;

const AUTHENTICITY: Authenticity[] = [
  "genuine_implementation",
  "working_usage",
  "incidental",
  "boilerplate",
  "insufficient_evidence",
];
export const asAuthenticity = (
  v: unknown,
  fallback: Authenticity = "insufficient_evidence",
): Authenticity =>
  (AUTHENTICITY as string[]).includes(str(v))
    ? (str(v) as Authenticity)
    : fallback;

export const asConfidence = (v: unknown, fallback: Confidence = "low") =>
  ["high", "medium", "low"].includes(str(v))
    ? (str(v) as Confidence)
    : fallback;

// ---- controlled topic-domain taxonomy ----------------------------------------

/**
 * The only domains a Topic may carry. The graph layer never guesses a domain:
 * it only validates that what the agent classified belongs to this set.
 */
export const TOPIC_DOMAINS = [
  "frontend",
  "backend",
  "database",
  "infrastructure",
  "ai_ml",
  "mobile",
  "general",
] as const;
export type TopicDomain = (typeof TOPIC_DOMAINS)[number];

const DOMAIN_SYNONYMS: Record<string, TopicDomain> = {
  frontend: "frontend",
  front_end: "frontend",
  backend: "backend",
  back_end: "backend",
  database: "database",
  databases: "database",
  db: "database",
  infrastructure: "infrastructure",
  infra: "infrastructure",
  devops: "infrastructure",
  ai_ml: "ai_ml",
  aiml: "ai_ml",
  ai: "ai_ml",
  ml: "ai_ml",
  machine_learning: "ai_ml",
  mobile: "mobile",
  general: "general",
};

/** Maps a stored/proposed label to a taxonomy domain, or null when it is not one. */
export function asTopicDomain(v: unknown): TopicDomain | null {
  const key = slugify(str(v));
  return key ? (DOMAIN_SYNONYMS[key] ?? null) : null;
}

/** Relationship types that make up the SHARED topic taxonomy. */
export const SUPPORTED_TOPIC_RELATIONS = [
  "BUILDS_ON",
  "RELATED_TOPIC",
] as const;
export type TopicRelationType = (typeof SUPPORTED_TOPIC_RELATIONS)[number];

/**
 * BUILDS_ON direction: (advanced)-[:BUILDS_ON]->(prerequisite). The target is a
 * concept a learner should understand BEFORE the source.
 *   required : the source cannot really be learned without the target
 *   helpful  : the target makes the source easier, but is not a blocker
 */
export type RelationStrength = "required" | "helpful";
/** Where an edge came from. Edges are never anonymous. */
export type RelationBasis = "llm_inferred" | "evidence_overlap" | "curated";

/** Minimum weight a Topic -> Capability mapping needs to be persisted. */
export const MIN_MAPPING_WEIGHT = 0.3;
/** Minimum developer level that counts as "has the prerequisite". */
export const PREREQ_MET_RANK = DEPTH_RANK.working;

const GENERIC_RELATION_TEMPLATE =
  /\b(builds on|relates to|is related to|related to|depends on)\b/i;

/**
 * A rationale is specific when it is a real sentence that says WHY. Template
 * strings such as "X builds on Y" are not rationales and are never stored.
 */
export function isSpecificRationale(reason: string): boolean {
  const r = reason.trim();
  if (r.length < 24) return false;
  const words = r.split(/\s+/).length;
  if (words < 5) return false;
  if (words <= 9 && GENERIC_RELATION_TEMPLATE.test(r)) return false;
  return true;
}

// ---- evidence index (one lightweight record per authored FileChange) -------

export interface FileRecord {
  id: string;
  path: string;
  repositoryId: string;
  commitSha: string;
  commitId: string;
  createdAt: string;
  ts: number;
  language: string;
  role: string;
  isTest: boolean;
  additions: number;
  deletions: number;
  packages: string[];
  packagesRemoved: string[];
  signals: Record<string, number>;
  /** "kind:name" for symbols DEFINED in the added lines */
  symbols: string[];
  symbolsModified: string[];
  depChanges: { added: string[]; removed: string[]; changed: string[] } | null;
  /** lazily computed lowercase search text (matching runs once per topic x file) */
  symbolText?: string;
  pathText?: string;
}

/** One detector demonstration, loaded once per atlas and filtered in memory. */
export interface DemoRow {
  id: string;
  capabilityId: string;
  technique: string;
  techniqueLower: string;
  summaryLower: string;
  depth: string;
  depthRank: number;
  modifiers: string;
  repository: string;
  path: string;
  permalink: string;
  commitSubject: string;
  snippet: string;
}

export interface FileIndex {
  files: FileRecord[];
  repoNames: Map<string, string>;
  /** packages declared in a repository's manifests (Repository.dependencies_json) */
  repoDeclared: Map<string, Set<string>>;
  commitFileCount: Map<string, number>;
  /** commit metadata cache shared by every topic of one atlas (no repeated queries) */
  commitMeta?: Map<string, Row>;
  /** all developer demonstrations, or null when the preload failed */
  demos?: DemoRow[] | null;
}

export interface PackageAtom {
  name: string;
  files: number;
  commits: number;
  repos: number;
  activeDays: number;
  firstSeen: string;
  lastSeen: string;
}
export interface SignalAtom {
  name: string;
  files: number;
  commits: number;
  occurrences: number;
}
export interface VocabAtom {
  term: string;
  files: number;
}
export interface AtomCluster {
  id: string;
  members: string[];
  commits: number;
  cohesion: number;
}
export interface AtlasCapability {
  id: string;
  name: string;
  description: string;
  level: string;
  evidence: number;
  commits: number;
  repos: number;
}
export interface AtlasExperience {
  id: string;
  capabilityId: string;
  technique: string;
  summary: string;
  depth: string;
  evidence: number;
  commits: number;
  repos: number;
  technologies: string[];
  repositories: string[];
}
export interface AtlasSkill {
  id: string;
  name: string;
  level: string;
  score: number;
}
export interface AtlasRepository {
  id: string;
  name: string;
  description: string;
  language: string;
  topics: string[];
}

export interface EvidenceAtlas {
  developerId: string;
  generatedAt: string;
  totals: {
    files: number;
    codeFiles: number;
    commits: number;
    repositories: number;
    activeDays: number;
    firstSeen: string;
    lastSeen: string;
  };
  packages: PackageAtom[];
  signals: SignalAtom[];
  vocabulary: VocabAtom[];
  clusters: AtomCluster[];
  capabilities: AtlasCapability[];
  experiences: AtlasExperience[];
  skills: AtlasSkill[];
  repositories: AtlasRepository[];
  /** in memory only, never serialised */
  index: FileIndex;
}

// ---- topic spec: what the agent asks the graph to look for -------------------

export interface ApproachSpec {
  slug: string;
  name: string;
  description: string;
  packages: string[];
  signals: string[];
  keywords: string[];
}

/** One validated Topic -> Capability mapping with the reason it exists. */
export interface CapabilityMappingSpec {
  id: string;
  /** 0..1: how strongly the capability belongs to the topic */
  weight: number;
  reason: string;
}

/** One topic-to-topic edge the agent wants to assert, with its rationale. */
export interface RelationDetail {
  slug: string;
  reason: string;
  confidence: number;
  strength?: RelationStrength;
  basis?: RelationBasis;
}

export interface TopicSpec {
  slug: string;
  name: string;
  /** one of TOPIC_DOMAINS; classified by the agent from evidence */
  domain: string;
  description: string;
  aliases: string[];
  keywords: string[];
  packages: string[];
  signals: string[];
  /** capability ids already validated against the Capability catalog */
  capabilityIds: string[];
  /** weighted, explained version of capabilityIds (optional for old stored specs) */
  capabilityMappings?: CapabilityMappingSpec[];
  approaches: ApproachSpec[];
  /** canonical topic slugs once resolved by the agent */
  buildsOn: string[];
  related: string[];
  /** rationale-carrying versions of buildsOn / related (optional for old stored specs) */
  buildsOnDetail?: RelationDetail[];
  relatedDetail?: RelationDetail[];
  /** FileChange ids confirmed by a full-text probe (code content matches) */
  pinnedFileIds: string[];
}

// ---- topic evidence --------------------------------------------------------

export interface EvidenceTotals {
  files: number;
  commits: number;
  repos: number;
  activeDays: number;
  spanDays: number;
  additions: number;
  deletions: number;
  testFiles: number;
  firstSeen: string;
  lastSeen: string;
}

export interface EvidenceRef {
  key: string;
  kind: "code" | "demonstration" | "experience" | "commit";
  id: string;
  label: string;
  repository: string;
  path: string;
  permalink: string;
  snippet: string;
}

export interface BaselineDepth {
  score: number;
  level: DepthLevel;
  components: Record<string, number>;
  reasons: string[];
  caps: string[];
}

export interface ApproachEvidence {
  slug: string;
  name: string;
  files: number;
  commits: number;
  repos: number;
  activeDays: number;
  firstSeen: string;
  lastSeen: string;
  additions: number;
  testFiles: number;
  matchedPackages: string[];
  matchedSignals: Record<string, number>;
  definedSymbols: string[];
  revisitedFiles: number;
  baseline: BaselineDepth;
}

export interface CodeSample {
  ref: string;
  approach: string;
  repository: string;
  path: string;
  commitSubject: string;
  date: string;
  matched: string[];
  excerpt: string;
}
export interface DemoNote {
  ref: string;
  capabilityId: string;
  /** "capability": reached through a mapped capability; "keyword": text match only */
  matchedBy: "capability" | "keyword";
  technique: string;
  depth: string;
  modifiers: string[];
  repository: string;
  path: string;
  commitSubject: string;
  snippet: string;
}
export interface ExperienceNote {
  ref: string;
  capabilityId: string;
  technique: string;
  summary: string;
  depth: string;
  evidenceCount: number;
  commitCount: number;
  repoCount: number;
  technologies: string[];
  repositories: string[];
}
export interface CommitNote {
  ref: string;
  id: string;
  subject: string;
  type: string;
  day: string;
  filesCount: number;
  scaffold: boolean;
}

/** Short, citable proof that sits behind a developer's depth in a topic. */
export interface EvidenceBrief {
  ref: string;
  kind: string;
  label: string;
  repository: string;
  path: string;
  permalink: string;
}

/** What one developer has demonstrated in one topic (from the stored assessment). */
export interface DeveloperTopicDepth {
  slug: string;
  level: DepthLevel;
  score: number;
  confidence: Confidence;
  authenticity: Authenticity;
  verdict: string;
  files: number;
  commits: number;
  repos: number;
  safeguards: string[];
  evidence: EvidenceBrief[];
}

export interface TopicContext {
  foundationRank: number | null;
  bridgeScore: number | null;
  clusterId: number | null;
  foundations: Array<{
    slug: string;
    name: string;
    hops: number;
    developerLevel: string;
    developerScore: number;
    /** why the first hop of the path exists */
    reason?: string;
    confidence?: number;
    strength?: RelationStrength;
    basis?: string;
    /** slugs from the topic (excluded) to this foundation (included) */
    via?: string[];
    developerConfidence?: string;
    developerAuthenticity?: string;
    verdict?: string;
    files?: number;
    commits?: number;
    evidence?: EvidenceBrief[];
  }>;
}

/**
 * Where a topic lives in the developer's code, EXCLUDING scaffold commits.
 * Two topics that share commits, directories or repositories are related by
 * real evidence; the agent uses this to connect the taxonomy.
 */
export interface TopicFootprint {
  commitIds: string[];
  repoIds: string[];
  /** "<repositoryId>:<directory>" of every matched file */
  dirs: string[];
}

export interface TopicEvidence {
  spec: TopicSpec;
  matched: boolean;
  totals: EvidenceTotals;
  approaches: ApproachEvidence[];
  unattributedFiles: number;
  maturation: {
    revisitedFiles: number;
    revisitRatio: number;
    followUpCommits: number;
    commitTypes: Record<string, number>;
  };
  scaffold: { commits: number; share: number };
  declaredOnly: string[];
  dependencyEvents: Array<{
    package: string;
    event: "added" | "removed" | "changed";
    day: string;
    repository: string;
  }>;
  capabilityRollups: AtlasCapability[];
  demonstrations: DemoNote[];
  experiences: ExperienceNote[];
  samples: CodeSample[];
  commits: CommitNote[];
  timeline: Array<{ month: string; files: number }>;
  hardening: Array<{ label: string; count: number }>;
  baseline: BaselineDepth;
  refs: EvidenceRef[];
  context: TopicContext | null;
  footprint?: TopicFootprint;
}

// ============================================================
// SCHEMA
// ============================================================

let schemaReady: Promise<void> | null = null;

export function ensureDepthSchema(
  graph: Graph,
  options: { force?: boolean } = {},
): Promise<void> {
  if (schemaReady && !options.force) return schemaReady;

  const pending: Promise<void> = setupSchema(graph).catch((error) => {
    if (schemaReady === pending) schemaReady = null;
    throw error;
  });
  schemaReady = pending;
  return pending;
}

async function setupSchema(graph: Graph): Promise<void> {
  // Every `WHERE x.id IN $ids` / `MATCH (x:Label {id: ...})` below is a full
  // label scan without an index, so each looked-up label gets one.
  const indexes: Array<[string, string]> = [
    ["Topic", "id"],
    ["Topic", "slug"],
    ["Approach", "id"],
    ["Approach", "slug"],
    ["Approach", "topic_slug"],
    ["DepthSnapshot", "id"],
    ["DepthSnapshot", "developer_id"],
    ["DepthSnapshot", "topic_slug"],
    ["DepthAssessment", "id"],
    ["DepthAssessment", "developer_id"],
    ["DepthAssessment", "topic_slug"],
    ["Developer", "id"],
    ["Capability", "id"],
    ["Commit", "id"],
    ["FileChange", "id"],
    ["Repository", "id"],
    ["Demonstration", "id"],
    ["Experience", "id"],
  ];
  for (const [label, property] of indexes) {
    await ignoreExists(`index ${label}.${property}`, () =>
      graph.query(`CREATE INDEX FOR (n:${label}) ON (n.${property})`),
    );
  }
  await ignoreExists("fulltext Topic", () =>
    graph.query(
      `CALL db.idx.fulltext.createNodeIndex('Topic', 'name', 'description', 'aliases_text')`,
    ),
  );
}

// ============================================================
// 1. EVIDENCE ATLAS
// ============================================================

const NON_CODE_ROLES = new Set(["config", "infra", "dependency_manifest"]);

/** Signals that fire in almost every file: they need a higher count to count. */
const GENERIC_SIGNALS = new Set([
  "async_await",
  "error_handling",
  "generics",
  "hook_calls",
  "decorators",
  "todo_markers",
  "any_usage",
  "lint_type_suppressions",
  "comment_markers",
]);
const GENERIC_SIGNAL_MIN = 3;

const DEFINING_KINDS = new Set([
  "class",
  "function",
  "component",
  "interface",
  "type",
  "enum",
  "struct",
  "trait",
  "impl",
  "method",
  "module",
  "model",
  "route",
  "ddl",
  "contract",
  "resource",
]);

const VOCAB_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "get",
  "set",
  "use",
  "new",
  "index",
  "main",
  "app",
  "src",
  "lib",
  "libs",
  "util",
  "utils",
  "helper",
  "helpers",
  "common",
  "shared",
  "types",
  "type",
  "test",
  "tests",
  "spec",
  "data",
  "item",
  "items",
  "list",
  "value",
  "values",
  "handler",
  "handlers",
  "props",
  "state",
  "default",
  "config",
  "file",
  "files",
  "page",
  "pages",
  "component",
  "components",
  "function",
  "class",
  "const",
  "init",
  "args",
  "result",
  "results",
  "error",
  "errors",
  "async",
  "await",
  "from",
  "into",
  "all",
  "one",
  "two",
  "tsx",
  "jsx",
  "json",
  "map",
  "key",
  "keys",
  "name",
  "names",
  "string",
  "number",
  "object",
  "array",
  "param",
  "params",
  "options",
  "option",
  "context",
  "service",
  "services",
  "model",
  "models",
  "request",
  "response",
  "req",
  "res",
]);

function splitIdentifier(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(
      (t) => t.length >= 3 && !/^\d+$/.test(t) && !VOCAB_STOPWORDS.has(t),
    );
}

function symbolName(symbol: string): string {
  const i = symbol.indexOf(":");
  return i === -1 ? symbol : symbol.slice(i + 1);
}
function symbolKind(symbol: string): string {
  const i = symbol.indexOf(":");
  return i === -1 ? "" : symbol.slice(0, i);
}

const isoDay = (ts: number): string =>
  ts ? new Date(ts).toISOString().slice(0, 10) : "";

/**
 * Keyset pagination (WHERE id > $after ... LIMIT n): every page costs the same.
 * SKIP/LIMIT made each page re-sort and skip everything before it, so the full
 * scan was quadratic in the number of files.
 */
async function fetchFileRecords(
  graph: Graph,
  developerId: string,
  onProgress: ProgressFn,
): Promise<FileRecord[]> {
  const out: FileRecord[] = [];
  let after = "";

  while (true) {
    const page = await rows(
      graph,
      `
      MATCH (d:Developer {id: $dev})-[:AUTHORED_CODE]->(fc:FileChange)
      WHERE fc.id > $after
      RETURN fc.id AS id,
             coalesce(fc.path, "") AS path,
             coalesce(fc.language, "") AS language,
             coalesce(fc.file_role, "source") AS role,
             coalesce(fc.is_test, false) AS is_test,
             coalesce(fc.additions, 0) AS additions,
             coalesce(fc.deletions, 0) AS deletions,
             coalesce(fc.commit_sha, "") AS commit_sha,
             coalesce(fc.repository_id, "") AS repository_id,
             coalesce(fc.created_at, "") AS created_at,
             coalesce(fc.imports_added_json, "[]") AS imports_added,
             coalesce(fc.imports_removed_json, "[]") AS imports_removed,
             coalesce(fc.symbols_added_json, "[]") AS symbols_added,
             coalesce(fc.symbols_modified_json, "[]") AS symbols_modified,
             coalesce(fc.code_signals_json, "{}") AS code_signals,
             coalesce(fc.dependency_changes_json, "") AS dependency_changes
      ORDER BY fc.id
      LIMIT ${FILE_PAGE_SIZE}
      `,
      { dev: developerId, after },
    );

    for (const r of page) {
      const createdAt = str(r.created_at);
      const ts = Date.parse(createdAt);
      const repositoryId = str(r.repository_id);
      const commitSha = str(r.commit_sha);
      const dep = parseJson<Row | null>(r.dependency_changes, null);

      out.push({
        id: str(r.id),
        path: str(r.path),
        repositoryId,
        commitSha,
        commitId: `${repositoryId}:commit:${commitSha}`,
        createdAt,
        ts: Number.isFinite(ts) ? ts : 0,
        language: str(r.language),
        role: str(r.role, "source"),
        isTest: bool(r.is_test),
        additions: num(r.additions),
        deletions: num(r.deletions),
        packages: strList(parseJson<unknown>(r.imports_added, [])).map((p) =>
          p.toLowerCase(),
        ),
        packagesRemoved: strList(parseJson<unknown>(r.imports_removed, [])).map(
          (p) => p.toLowerCase(),
        ),
        signals: Object.fromEntries(
          Object.entries(parseJson<Row>(r.code_signals, {})).map(([k, v]) => [
            k,
            num(v),
          ]),
        ),
        symbols: strList(parseJson<unknown>(r.symbols_added, [])),
        symbolsModified: strList(parseJson<unknown>(r.symbols_modified, [])),
        depChanges: dep
          ? {
              added: mapList(dep.added).map((x) => str(x.name).toLowerCase()),
              removed: mapList(dep.removed).map((x) =>
                str(x.name).toLowerCase(),
              ),
              changed: mapList(dep.changed).map((x) =>
                str(x.name).toLowerCase(),
              ),
            }
          : null,
      });
    }

    onProgress("depth_files_scanned", { scanned: out.length });
    if (page.length < FILE_PAGE_SIZE) break;
    const last = str(page[page.length - 1]?.id);
    if (!last || last === after) break;
    after = last;
  }

  return out;
}

/** One query for every demonstration of the developer; topics filter in memory. */
async function fetchDemonstrations(
  graph: Graph,
  developerId: string,
): Promise<DemoRow[] | null> {
  const result = await tryRows(
    graph,
    "atlas demonstrations",
    `
    MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability)
    OPTIONAL MATCH (x)-[:IN_REPOSITORY]->(r:Repository)
    RETURN x.id AS id, c.id AS capability_id,
           coalesce(x.technique, "") AS technique,
           coalesce(x.summary, "") AS summary,
           coalesce(x.depth, "usage") AS depth,
           coalesce(x.depth_rank, 1) AS depth_rank,
           coalesce(x.modifiers, "") AS modifiers,
           coalesce(r.full_name, r.name, "") AS repository,
           coalesce(x.path, "") AS path,
           coalesce(x.permalink, "") AS permalink,
           coalesce(x.commit_subject, "") AS commit_subject,
           coalesce(x.snippet, "") AS snippet
    ORDER BY depth_rank DESC
    LIMIT ${DEMO_LIMIT}
    `,
    { dev: developerId },
  );
  if (!result) return null;
  return result.map((r) => ({
    id: str(r.id),
    capabilityId: str(r.capability_id),
    technique: str(r.technique),
    techniqueLower: str(r.technique).toLowerCase(),
    summaryLower: str(r.summary).toLowerCase(),
    depth: str(r.depth, "usage"),
    depthRank: num(r.depth_rank, 1),
    modifiers: str(r.modifiers),
    repository: str(r.repository),
    path: str(r.path),
    permalink: str(r.permalink),
    commitSubject: str(r.commit_subject),
    snippet: raw(r.snippet).slice(0, 500),
  }));
}

interface Acc {
  files: number;
  commits: Set<string>;
  repos: Set<string>;
  days: Set<string>;
  first: number;
  last: number;
  count: number;
}
const newAcc = (): Acc => ({
  files: 0,
  commits: new Set(),
  repos: new Set(),
  days: new Set(),
  first: Number.POSITIVE_INFINITY,
  last: 0,
  count: 0,
});
function touch(acc: Acc, f: FileRecord, count = 1): void {
  acc.files += 1;
  acc.count += count;
  acc.commits.add(f.commitId);
  if (f.repositoryId) acc.repos.add(f.repositoryId);
  if (f.ts) {
    acc.first = Math.min(acc.first, f.ts);
    acc.last = Math.max(acc.last, f.ts);
    acc.days.add(isoDay(f.ts));
  }
}

/** Deterministic weighted label propagation (asynchronous, sorted, stable ties). */
function propagateLabels(
  nodes: string[],
  edges: Array<[string, string, number]>,
  maxIterations = 15,
): Map<string, string> {
  const adjacency = new Map<string, Map<string, number>>();
  for (const n of nodes) adjacency.set(n, new Map());
  for (const [a, b, w] of edges) {
    adjacency.get(a)?.set(b, w);
    adjacency.get(b)?.set(a, w);
  }
  const labels = new Map(nodes.map((n) => [n, n]));
  const order = [...nodes].sort();

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;
    for (const node of order) {
      const weights = new Map<string, number>();
      for (const [neighbor, w] of adjacency.get(node) ?? []) {
        const label = labels.get(neighbor) as string;
        weights.set(label, (weights.get(label) ?? 0) + w);
      }
      if (weights.size === 0) continue;
      let best = labels.get(node) as string;
      let bestWeight = -1;
      for (const [label, w] of [...weights.entries()].sort((a, b) =>
        a[0].localeCompare(b[0]),
      )) {
        if (w > bestWeight) {
          best = label;
          bestWeight = w;
        }
      }
      if (best !== labels.get(node)) {
        labels.set(node, best);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return labels;
}

/** Which packages / signals are used together, grouped by co-occurrence in commits. */
function buildClusters(files: FileRecord[]): AtomCluster[] {
  const commitAtoms = new Map<string, Set<string>>();
  for (const f of files) {
    if (f.isTest || NON_CODE_ROLES.has(f.role)) continue;
    let set = commitAtoms.get(f.commitId);
    if (!set) {
      set = new Set();
      commitAtoms.set(f.commitId, set);
    }
    for (const p of f.packages) set.add(`pkg:${p}`);
    for (const [s, c] of Object.entries(f.signals)) {
      if (!GENERIC_SIGNALS.has(s) && c >= 1) set.add(`sig:${s}`);
    }
  }

  const freq = new Map<string, number>();
  for (const set of commitAtoms.values()) {
    for (const a of set) freq.set(a, (freq.get(a) ?? 0) + 1);
  }

  const pairs = new Map<string, number>();
  for (const set of commitAtoms.values()) {
    if (set.size < 2 || set.size > 40) continue;
    const atoms = [...set].filter((a) => (freq.get(a) ?? 0) >= 2).sort();
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const key = `${atoms[i]}\u0000${atoms[j]}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }

  const edges: Array<[string, string, number]> = [];
  const nodeSet = new Set<string>();
  for (const [key, co] of pairs) {
    if (co < 2) continue;
    const [a, b] = key.split("\u0000") as [string, string];
    const w = co / Math.min(freq.get(a) ?? co, freq.get(b) ?? co);
    if (w < 0.4) continue;
    edges.push([a, b, w]);
    nodeSet.add(a);
    nodeSet.add(b);
  }
  if (edges.length === 0) return [];

  const labels = propagateLabels([...nodeSet], edges);
  const groups = new Map<string, string[]>();
  for (const [node, label] of labels) {
    const list = groups.get(label) ?? [];
    list.push(node);
    groups.set(label, list);
  }

  const clusters: AtomCluster[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const set = new Set(members);
    const inside = edges.filter(([a, b]) => set.has(a) && set.has(b));
    clusters.push({
      id: "",
      members: members
        .sort(
          (a, b) =>
            (freq.get(b) ?? 0) - (freq.get(a) ?? 0) || a.localeCompare(b),
        )
        .slice(0, 10),
      commits: members.reduce((n, m) => n + (freq.get(m) ?? 0), 0),
      cohesion: inside.length
        ? round(inside.reduce((n, e) => n + e[2], 0) / inside.length)
        : 0,
    });
  }
  return clusters
    .sort((a, b) => b.commits - a.commits)
    .slice(0, 20)
    .map((c, i) => ({ ...c, id: `cl${i + 1}` }));
}

function parseDeclared(json: unknown): Set<string> {
  const out = new Set<string>();
  const parsed = parseJson<Record<string, any>>(json, {});
  for (const bucket of Object.values(parsed)) {
    if (!bucket || typeof bucket !== "object") continue;
    for (const group of [bucket.runtime, bucket.dev]) {
      if (group && typeof group === "object") {
        for (const name of Object.keys(group)) out.add(name.toLowerCase());
      }
    }
  }
  return out;
}

const atlasCache = new Map<string, { at: number; atlas: EvidenceAtlas }>();

/** Drop cached atlases (call after a GitHub sync changed the developer's code). */
export function invalidateAtlasCache(developerId?: string): void {
  if (developerId) atlasCache.delete(developerId);
  else atlasCache.clear();
}

/**
 * Reads everything the analyzer needs about one developer: authored files,
 * capabilities, experiences, skills, repositories and demonstrations.
 * `cacheMs` > 0 reuses a recent atlas (batch re-analysis of many topics);
 * the default (0) always reads fresh data.
 */
export async function readEvidenceAtlas(
  graph: Graph,
  developerId: string,
  onProgress: ProgressFn = () => {},
  options: { cacheMs?: number } = {},
): Promise<EvidenceAtlas | null> {
  await ensureDepthSchema(graph);

  const cacheMs = options.cacheMs ?? 0;
  if (cacheMs > 0) {
    const hit = atlasCache.get(developerId);
    if (hit && Date.now() - hit.at < cacheMs) {
      onProgress("depth_atlas_ready", {
        files: hit.atlas.totals.files,
        cached: true,
      });
      return hit.atlas;
    }
  }

  const exists = await tryRows(
    graph,
    "developer exists",
    `MATCH (d:Developer {id: $dev}) RETURN d.id AS id LIMIT 1`,
    { dev: developerId },
  );
  if (!exists || exists.length === 0) return null;

  const files = await fetchFileRecords(graph, developerId, onProgress);
  const repoIds = unique(files.map((f) => f.repositoryId).filter(Boolean));

  const [capRows, expRows, skillRows, repoRows, demos] = await Promise.all([
    tryRows(
      graph,
      "atlas capabilities",
      `
      MATCH (d:Developer {id: $dev})-[hc:HAS_CAPABILITY]->(c:Capability)
      WHERE c.parent_id <> ""
      RETURN c.id AS id, c.name AS name, coalesce(c.description, "") AS description,
             coalesce(hc.level, "missing") AS level,
             coalesce(hc.evidence_count, 0) AS evidence,
             coalesce(hc.commit_count, 0) AS commits,
             coalesce(hc.repo_count, 0) AS repos
      ORDER BY evidence DESC
      `,
      { dev: developerId },
    ),
    tryRows(
      graph,
      "atlas experiences",
      `
      MATCH (d:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)
      OPTIONAL MATCH (e)-[:USES_TECHNOLOGY]->(t:Technology)
      OPTIONAL MATCH (e)-[:OCCURS_IN]->(r:Repository)
      RETURN e.id AS id,
             coalesce(e.capability_id, "") AS capability_id,
             coalesce(e.technique, "") AS technique,
             coalesce(e.summary, "") AS summary,
             coalesce(e.best_depth, "usage") AS depth,
             coalesce(e.evidence_count, 0) AS evidence,
             coalesce(e.commit_count, 0) AS commits,
             coalesce(e.repo_count, 0) AS repos,
             collect(DISTINCT t.name) AS techs,
             collect(DISTINCT coalesce(r.full_name, r.name)) AS repositories
      ORDER BY evidence DESC
      `,
      { dev: developerId },
    ),
    tryRows(
      graph,
      "atlas skills",
      `
      MATCH (d:Developer {id: $dev})-[hs:HAS_SKILL]->(s:Skill)
      RETURN s.id AS id, s.name AS name, coalesce(hs.level, "") AS level,
             coalesce(hs.depth_score, 0) AS score
      ORDER BY score DESC
      `,
      { dev: developerId },
    ),
    repoIds.length
      ? tryRows(
          graph,
          "atlas repositories",
          `
          MATCH (r:Repository)
          WHERE r.id IN $ids
          RETURN r.id AS id,
                 coalesce(r.full_name, r.name, "") AS full_name,
                 coalesce(r.description, "") AS description,
                 coalesce(r.language, "") AS language,
                 coalesce(r.topics_json, "[]") AS topics_json,
                 coalesce(r.dependencies_json, "{}") AS dependencies_json
          `,
          { ids: repoIds },
        )
      : Promise.resolve([] as Row[]),
    fetchDemonstrations(graph, developerId),
  ]);

  // ---- atoms ----------------------------------------------------------------
  const pkg = new Map<string, Acc>();
  const sig = new Map<string, Acc>();
  const vocab = new Map<string, number>();
  const allCommits = new Set<string>();
  const allDays = new Set<string>();
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  let codeFiles = 0;
  const commitFileCount = new Map<string, number>();

  for (const f of files) {
    allCommits.add(f.commitId);
    commitFileCount.set(f.commitId, (commitFileCount.get(f.commitId) ?? 0) + 1);
    if (f.ts) {
      first = Math.min(first, f.ts);
      last = Math.max(last, f.ts);
      allDays.add(isoDay(f.ts));
    }
    if (f.isTest || NON_CODE_ROLES.has(f.role)) continue;
    codeFiles += 1;

    for (const p of f.packages) {
      const acc = pkg.get(p) ?? newAcc();
      touch(acc, f);
      pkg.set(p, acc);
    }
    for (const [s, c] of Object.entries(f.signals)) {
      if (c <= 0) continue;
      const acc = sig.get(s) ?? newAcc();
      touch(acc, f, c);
      sig.set(s, acc);
    }

    const terms = new Set<string>();
    for (const symbol of f.symbols) {
      for (const t of splitIdentifier(symbolName(symbol))) terms.add(t);
    }
    for (const segment of f.path.split("/")) {
      for (const t of splitIdentifier(segment.replace(/\.[a-z0-9]+$/i, ""))) {
        terms.add(t);
      }
    }
    for (const t of terms) vocab.set(t, (vocab.get(t) ?? 0) + 1);
  }

  const repoNames = new Map<string, string>();
  const repoDeclared = new Map<string, Set<string>>();
  const repositories: AtlasRepository[] = (repoRows ?? []).map((r) => {
    const id = str(r.id);
    repoNames.set(id, str(r.full_name));
    repoDeclared.set(id, parseDeclared(r.dependencies_json));
    return {
      id,
      name: str(r.full_name),
      description: str(r.description).slice(0, 240),
      language: str(r.language),
      topics: strList(parseJson<unknown>(r.topics_json, [])),
    };
  });

  const packages: PackageAtom[] = [...pkg.entries()]
    .map(([name, a]) => ({
      name,
      files: a.files,
      commits: a.commits.size,
      repos: a.repos.size,
      activeDays: a.days.size,
      firstSeen: isoDay(a.first),
      lastSeen: isoDay(a.last),
    }))
    .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));

  const signals: SignalAtom[] = [...sig.entries()]
    .map(([name, a]) => ({
      name,
      files: a.files,
      commits: a.commits.size,
      occurrences: a.count,
    }))
    .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));

  const vocabulary: VocabAtom[] = [...vocab.entries()]
    .filter(([, n]) => n >= 2)
    .map(([term, n]) => ({ term, files: n }))
    .sort((a, b) => b.files - a.files || a.term.localeCompare(b.term))
    .slice(0, 120);

  const capabilities: AtlasCapability[] = (capRows ?? []).map((r) => ({
    id: str(r.id),
    name: str(r.name),
    description: str(r.description),
    level: str(r.level),
    evidence: num(r.evidence),
    commits: num(r.commits),
    repos: num(r.repos),
  }));

  const experiences: AtlasExperience[] = (expRows ?? []).map((r) => ({
    id: str(r.id),
    capabilityId: str(r.capability_id),
    technique: str(r.technique),
    summary: str(r.summary),
    depth: str(r.depth),
    evidence: num(r.evidence),
    commits: num(r.commits),
    repos: num(r.repos),
    technologies: strList(r.techs),
    repositories: strList(r.repositories),
  }));

  const skills: AtlasSkill[] = (skillRows ?? []).map((r) => ({
    id: str(r.id),
    name: str(r.name),
    level: str(r.level),
    score: num(r.score),
  }));

  const atlas: EvidenceAtlas = {
    developerId,
    generatedAt: new Date().toISOString(),
    totals: {
      files: files.length,
      codeFiles,
      commits: allCommits.size,
      repositories: repoIds.length,
      activeDays: allDays.size,
      firstSeen: isoDay(Number.isFinite(first) ? first : 0),
      lastSeen: isoDay(last),
    },
    packages,
    signals,
    vocabulary,
    clusters: buildClusters(files),
    capabilities,
    experiences,
    skills,
    repositories,
    index: {
      files,
      repoNames,
      repoDeclared,
      commitFileCount,
      commitMeta: new Map(),
      demos,
    },
  };

  if (cacheMs > 0) atlasCache.set(developerId, { at: Date.now(), atlas });

  onProgress("depth_atlas_ready", {
    files: files.length,
    packages: packages.length,
    signals: signals.length,
    clusters: atlas.clusters.length,
  });
  return atlas;
}

// ============================================================
// 2. TOPIC EVIDENCE
// ============================================================

interface Compiled {
  packages: Set<string>;
  signals: Set<string>;
  keywords: string[];
  pinned: Set<string>;
}

interface MatchInfo {
  strength: number;
  packages: string[];
  signals: string[];
  keywords: string[];
}

const normalizeKeyword = (k: string): string =>
  k
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

function compileAtoms(
  atoms: { packages: string[]; signals: string[]; keywords: string[] },
  pinned: string[] = [],
): Compiled {
  return {
    packages: new Set(atoms.packages.map((p) => p.toLowerCase())),
    signals: new Set(atoms.signals),
    keywords: unique(
      atoms.keywords.map(normalizeKeyword).filter((k) => k.length >= 3),
    ),
    pinned: new Set(pinned),
  };
}

function packageMatches(pkg: string, wanted: Set<string>): boolean {
  if (wanted.has(pkg)) return true;
  for (const w of wanted) {
    if (pkg.startsWith(`${w}/`)) return true;
  }
  return false;
}

/** Lowercase search text is built once per file, not once per topic x file. */
function ensureTexts(f: FileRecord): void {
  if (f.symbolText !== undefined) return;
  f.symbolText = [...f.symbols, ...f.symbolsModified]
    .map((s) =>
      symbolName(s)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ""),
    )
    .join(" ");
  f.pathText = f.path.toLowerCase().replace(/[^a-z0-9/]+/g, "");
}

function matchFile(f: FileRecord, c: Compiled): MatchInfo | null {
  const packages = f.packages.filter((p) => packageMatches(p, c.packages));
  const signals = Object.entries(f.signals)
    .filter(
      ([s, n]) =>
        c.signals.has(s) &&
        n >= (GENERIC_SIGNALS.has(s) ? GENERIC_SIGNAL_MIN : 1),
    )
    .map(([s]) => s);

  ensureTexts(f);
  const symbolText = f.symbolText as string;
  const pathText = f.pathText as string;
  const symbolHits = c.keywords.filter((k) => symbolText.includes(k));
  const pathHits = c.keywords.filter((k) => pathText.includes(k));

  let strength = 0;
  if (packages.length) strength += 2;
  if (signals.length) strength += 1;
  if (symbolHits.length) strength += 1;
  if (pathHits.length) strength += 0.5;
  if (c.pinned.has(f.id)) strength = Math.max(strength, 1);

  const threshold = f.isTest ? 0.5 : 1;
  if (strength < threshold) return null;

  return {
    strength,
    packages,
    signals,
    keywords: unique([...symbolHits, ...pathHits]),
  };
}

function totalsFor(files: FileRecord[]): EvidenceTotals {
  const commits = new Set<string>();
  const repos = new Set<string>();
  const days = new Set<string>();
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    commits.add(f.commitId);
    if (f.repositoryId) repos.add(f.repositoryId);
    if (f.ts) {
      first = Math.min(first, f.ts);
      last = Math.max(last, f.ts);
      days.add(isoDay(f.ts));
    }
    additions += f.additions;
    deletions += f.deletions;
  }
  return {
    files: files.length,
    commits: commits.size,
    repos: repos.size,
    activeDays: days.size,
    spanDays:
      Number.isFinite(first) && last ? Math.round((last - first) / DAY_MS) : 0,
    additions,
    deletions,
    testFiles: 0,
    firstSeen: Number.isFinite(first) ? isoDay(first) : "",
    lastSeen: isoDay(last),
  };
}

function definedSymbolsFor(files: FileRecord[], needles: string[]): string[] {
  const out = new Set<string>();
  const wanted = needles.map(normalizeKeyword).filter((n) => n.length >= 3);
  if (wanted.length === 0) return [];
  for (const f of files) {
    if (f.isTest) continue;
    for (const symbol of f.symbols) {
      if (!DEFINING_KINDS.has(symbolKind(symbol))) continue;
      const name = symbolName(symbol);
      const flat = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (wanted.some((w) => flat.includes(w))) out.add(name);
    }
  }
  return [...out].slice(0, 12);
}

function revisitStats(files: FileRecord[]): {
  groups: number;
  revisited: number;
} {
  const byFile = new Map<string, Set<string>>();
  for (const f of files) {
    const key = `${f.repositoryId}:${f.path}`;
    const set = byFile.get(key) ?? new Set<string>();
    set.add(f.commitId);
    byFile.set(key, set);
  }
  let revisited = 0;
  for (const set of byFile.values()) if (set.size >= 2) revisited += 1;
  return { groups: byFile.size, revisited };
}

// ---- baseline --------------------------------------------------------------

export interface BaselineInput {
  files: number;
  commits: number;
  repos: number;
  activeDays: number;
  spanDays: number;
  additions: number;
  testFiles: number;
  definedSymbols: number;
  demoBestRank: number; // 0 none, 1 usage, 2 implementation, 3 strong
  hardeningCount: number;
  revisitRatio: number;
  followUpCommits: number;
  approachesWithEvidence: number;
  scaffoldShare: number;
}

/**
 * Deterministic depth prior. Every component is capped, so no single number
 * (for example one giant commit) can dominate, and every reduction is listed
 * in `caps` so the agent can explain it.
 */
export function computeBaselineDepth(i: BaselineInput): BaselineDepth {
  const c: Record<string, number> = {
    volume: Math.min(Math.log10(i.additions + 1) / 3.5, 1) * 12,
    breadth: Math.sqrt(Math.min(i.files / 20, 1)) * 14,
    commits: Math.sqrt(Math.min(i.commits / 25, 1)) * 14,
    sustained:
      (0.6 * Math.min(i.activeDays / 15, 1) +
        0.4 * Math.min(i.spanDays / 120, 1)) *
      14,
    repos: Math.min(i.repos / 3, 1) * 5,
    ownImplementation:
      Math.min(i.definedSymbols / 5, 1) * 8 +
      (Math.min(i.demoBestRank, 3) / 3) * 12,
    hardening: Math.min(i.hardeningCount / 6, 1) * 8,
    maturation:
      Math.min(i.revisitRatio * 2, 1) * 4 +
      Math.min(i.followUpCommits / 4, 1) * 3,
    tests: Math.min(i.testFiles / 3, 1) * 5,
    approachDiversity: i.approachesWithEvidence >= 2 ? 5 : 0,
  };

  let score = Object.values(c).reduce((a, b) => a + b, 0);
  const caps: string[] = [];
  const reasons: string[] = [];

  if (i.scaffoldShare >= 0.6) {
    score *= 0.6;
    caps.push(
      `${Math.round(i.scaffoldShare * 100)}% of the evidence sits in scaffold-like commits (x0.6)`,
    );
  }
  if (i.commits <= 1 && score > 25) {
    score = 25;
    caps.push("only one commit touches this topic (capped at 25)");
  }
  if (i.files <= 1 && score > 20) {
    score = 20;
    caps.push("only one file touches this topic (capped at 20)");
  }
  if (i.files === 0) score = 0;

  const final = Math.max(0, Math.min(100, Math.round(score)));
  if (i.demoBestRank >= 2)
    reasons.push("a built mechanism was detected (implementation depth)");
  if (i.definedSymbols > 0)
    reasons.push(`${i.definedSymbols} own definitions match the topic`);
  if (i.hardeningCount > 0)
    reasons.push(`${i.hardeningCount} hardening behaviours observed`);
  if (i.revisitRatio >= 0.25)
    reasons.push("files were revisited in later commits");
  if (i.testFiles > 0) reasons.push("related test files exist");
  if (i.approachesWithEvidence >= 2)
    reasons.push("more than one approach was used");

  return {
    score: final,
    level: levelForScore(final),
    components: Object.fromEntries(
      Object.entries(c).map(([k, v]) => [k, round(v, 1)]),
    ),
    reasons,
    caps,
  };
}

// ---- demonstrations / commits / samples ---------------------------------------

const SCAFFOLD_SUBJECT =
  /\b(initial commit|first commit|init(ial)? project|scaffold\w*|boilerplate|bootstrap\w*|create[- ]?(react|next|vite|t3)[- ]?app|starter)\b/i;
const SCAFFOLD_FILE_COUNT = 25;

function excerptAround(
  code: string,
  needles: string[],
  maxChars = 900,
): string {
  const lines = code.split("\n");
  const wanted = needles.map((n) => n.toLowerCase()).filter(Boolean);
  let at = -1;
  if (wanted.length) {
    at = lines.findIndex((l) => {
      const lower = l.toLowerCase();
      return wanted.some((n) => lower.includes(n));
    });
  }
  const start = at === -1 ? 0 : Math.max(0, at - 3);
  const end =
    at === -1 ? Math.min(lines.length, 18) : Math.min(lines.length, at + 15);
  const text = lines.slice(start, end).join("\n").trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…` : text;
}

export interface GatherOptions {
  maxSamples?: number;
  maxDemos?: number;
}

export async function gatherTopicEvidence(
  graph: Graph,
  atlas: EvidenceAtlas,
  spec: TopicSpec,
  options: GatherOptions = {},
): Promise<TopicEvidence> {
  const maxSamples = options.maxSamples ?? 8;
  const maxDemos = options.maxDemos ?? 10;
  const { index } = atlas;
  const developerId = atlas.developerId;
  const commitMeta = index.commitMeta ?? (index.commitMeta = new Map());

  const topicCompiled = compileAtoms(spec, spec.pinnedFileIds);
  const approachCompiled = spec.approaches.map((a) => ({
    spec: a,
    compiled: compileAtoms(a),
  }));

  // allow topic-level atoms OR any approach atoms to qualify a file
  const unionCompiled: Compiled = {
    packages: new Set([
      ...topicCompiled.packages,
      ...approachCompiled.flatMap((a) => [...a.compiled.packages]),
    ]),
    signals: new Set([
      ...topicCompiled.signals,
      ...approachCompiled.flatMap((a) => [...a.compiled.signals]),
    ]),
    keywords: unique([
      ...topicCompiled.keywords,
      ...approachCompiled.flatMap((a) => a.compiled.keywords),
    ]),
    pinned: topicCompiled.pinned,
  };

  // ---- match files -----------------------------------------------------------
  const matchedCode: Array<{ f: FileRecord; m: MatchInfo }> = [];
  const matchedTests: FileRecord[] = [];
  const perApproach = new Map<string, Array<{ f: FileRecord; m: MatchInfo }>>();
  for (const a of approachCompiled) perApproach.set(a.spec.slug, []);
  const dependencyEvents: TopicEvidence["dependencyEvents"] = [];

  for (const f of index.files) {
    if (f.depChanges) {
      for (const [event, names] of [
        ["added", f.depChanges.added],
        ["removed", f.depChanges.removed],
        ["changed", f.depChanges.changed],
      ] as const) {
        for (const name of names) {
          if (packageMatches(name, unionCompiled.packages)) {
            dependencyEvents.push({
              package: name,
              event,
              day: isoDay(f.ts),
              repository: index.repoNames.get(f.repositoryId) ?? "",
            });
          }
        }
      }
    }

    if (NON_CODE_ROLES.has(f.role)) continue;
    const m = matchFile(f, unionCompiled);
    if (!m) continue;
    if (f.isTest) {
      matchedTests.push(f);
      continue;
    }
    matchedCode.push({ f, m });
    for (const a of approachCompiled) {
      const am = matchFile(f, a.compiled);
      if (am && !f.isTest) perApproach.get(a.spec.slug)?.push({ f, m: am });
    }
  }

  const codeFiles = matchedCode.map((x) => x.f);
  const attributed = new Set<string>();
  for (const list of perApproach.values())
    for (const x of list) attributed.add(x.f.id);

  const topicTotals = totalsFor(codeFiles);
  topicTotals.testFiles = matchedTests.length;

  // ---- commit notes (metadata cached across topics) ---------------------------
  const commitIds = unique(codeFiles.map((f) => f.commitId));
  const idsForQuery = [...commitIds].sort().slice(0, 800);
  const missingIds = idsForQuery.filter((id) => !commitMeta.has(id));
  for (const part of chunk(missingIds, 300)) {
    const r = await tryRows(
      graph,
      "topic commits",
      `
      MATCH (c:Commit)
      WHERE c.id IN $ids
      RETURN c.id AS id, coalesce(c.subject, "") AS subject,
             coalesce(c.commit_type, "other") AS type,
             coalesce(c.date_day, "") AS day,
             coalesce(c.files_count, 0) AS files_count
      `,
      { ids: part },
    );
    if (!r) continue; // failed: leave uncached so a later topic retries
    for (const row of r) commitMeta.set(str(row.id), row);
    // negative cache: asked for, not found
    for (const id of part) if (!commitMeta.has(id)) commitMeta.set(id, {});
  }
  const commitById = commitMeta;

  const isScaffoldCommit = (id: string): boolean => {
    const row = commitById.get(id);
    const filesCount =
      num(row?.files_count) || index.commitFileCount.get(id) || 0;
    return (
      filesCount >= SCAFFOLD_FILE_COUNT ||
      SCAFFOLD_SUBJECT.test(str(row?.subject))
    );
  };
  const scaffoldCommitIds = commitIds.filter(isScaffoldCommit);
  const scaffoldSet = new Set(scaffoldCommitIds);
  const commitTs = new Map<string, number>();
  for (const f of codeFiles) {
    commitTs.set(f.commitId, Math.max(commitTs.get(f.commitId) ?? 0, f.ts));
  }
  const scaffoldFiles = codeFiles.filter((f) => scaffoldSet.has(f.commitId));
  const scaffoldShare = codeFiles.length
    ? scaffoldFiles.length / codeFiles.length
    : 0;

  // ---- footprint: where the topic lives (scaffold commits excluded) ----------
  const fpCommits = new Set<string>();
  const fpRepos = new Set<string>();
  const fpDirs = new Set<string>();
  for (const f of codeFiles) {
    if (scaffoldSet.has(f.commitId)) continue;
    fpCommits.add(f.commitId);
    if (!f.repositoryId) continue;
    fpRepos.add(f.repositoryId);
    const dir = f.path.split("/").slice(0, -1).slice(0, 3).join("/");
    if (dir) fpDirs.add(`${f.repositoryId}:${dir}`);
  }
  const footprint: TopicFootprint = {
    commitIds: [...fpCommits],
    repoIds: [...fpRepos],
    dirs: [...fpDirs],
  };

  // ---- maturation -----------------------------------------------------------
  const revisit = revisitStats(codeFiles);
  let firstTs = Number.POSITIVE_INFINITY;
  for (const f of codeFiles) firstTs = Math.min(firstTs, f.ts || firstTs);
  const commitTypes: Record<string, number> = {};
  let followUpCommits = 0;
  for (const id of commitIds) {
    const row = commitById.get(id);
    const type = str(row?.type, "other");
    commitTypes[type] = (commitTypes[type] ?? 0) + 1;
    const ts = commitTs.get(id) ?? 0;
    if (["fix", "perf", "refactor"].includes(type) && ts > firstTs)
      followUpCommits += 1;
  }

  // ---- demonstrations (existing detector evidence) --------------------------
  // The persisted Topic -[:MAPS_TO]-> Capability edges are taxonomy only. They
  // tell us WHICH demonstrations to read; they are never proof of depth.
  const mappedCapRows =
    (await tryRows(
      graph,
      "topic mapped capabilities",
      `MATCH (:Topic {slug: $slug})-[:MAPS_TO]->(c:Capability) RETURN c.id AS id`,
      { slug: spec.slug },
    )) ?? [];
  const capabilityIds = unique([
    ...spec.capabilityIds,
    ...mappedCapRows.map((r) => str(r.id)).filter(Boolean),
  ]);
  const demoKeywords = unique(
    [...unionCompiled.keywords, ...spec.name.toLowerCase().split(/\W+/)].filter(
      (k) => k.length >= 4,
    ),
  ).slice(0, 12);

  let demoRows: Row[];
  if (index.demos) {
    // preloaded once per atlas: filter in memory, no per-topic graph query
    const capSet = new Set(capabilityIds);
    demoRows = [];
    for (const d of index.demos) {
      const byCap = capSet.has(d.capabilityId);
      if (
        !byCap &&
        !demoKeywords.some(
          (k) => d.techniqueLower.includes(k) || d.summaryLower.includes(k),
        )
      ) {
        continue;
      }
      demoRows.push({
        id: d.id,
        capability_id: d.capabilityId,
        matched_by: byCap ? "capability" : "keyword",
        technique: d.technique,
        depth: d.depth,
        depth_rank: d.depthRank,
        modifiers: d.modifiers,
        repository: d.repository,
        path: d.path,
        permalink: d.permalink,
        commit_subject: d.commitSubject,
        snippet: d.snippet,
      });
      if (demoRows.length >= 200) break;
    }
  } else {
    demoRows =
      (await tryRows(
        graph,
        "topic demonstrations",
        `
        MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability)
        WHERE c.id IN $cap_ids
           OR any(k IN $keywords WHERE toLower(coalesce(x.technique, "")) CONTAINS k
                                    OR toLower(coalesce(x.summary, "")) CONTAINS k)
        OPTIONAL MATCH (x)-[:IN_REPOSITORY]->(r:Repository)
        RETURN x.id AS id, c.id AS capability_id,
               CASE WHEN c.id IN $cap_ids THEN "capability" ELSE "keyword" END AS matched_by,
               coalesce(x.technique, "") AS technique,
               coalesce(x.depth, "usage") AS depth,
               coalesce(x.depth_rank, 1) AS depth_rank,
               coalesce(x.modifiers, "") AS modifiers,
               coalesce(r.full_name, r.name, "") AS repository,
               coalesce(x.path, "") AS path,
               coalesce(x.permalink, "") AS permalink,
               coalesce(x.commit_subject, "") AS commit_subject,
               coalesce(x.snippet, "") AS snippet
        ORDER BY depth_rank DESC
        LIMIT 200
        `,
        { dev: developerId, cap_ids: capabilityIds, keywords: demoKeywords },
      )) ?? [];
  }

  const hardeningCounts = new Map<string, number>();
  let demoBestRank = 0;
  for (const r of demoRows) {
    const rank = num(r.depth_rank);
    // a text-only match can show usage, never an implementation
    const effective =
      str(r.matched_by) === "capability" ? rank : Math.min(rank, 1);
    demoBestRank = Math.max(demoBestRank, effective);
    for (const label of str(r.modifiers).split(" | ")) {
      const l = label.trim();
      if (l) hardeningCounts.set(l, (hardeningCounts.get(l) ?? 0) + 1);
    }
  }
  // Discovery != depth: detector demonstrations need authored code behind them.
  if (codeFiles.length < 2) demoBestRank = Math.min(demoBestRank, 1);
  const hardening = [...hardeningCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  // ---- experiences & rollups (from the atlas, no query) --------------------
  const techWords = unique(
    [
      ...unionCompiled.packages,
      ...approachCompiled.map((a) => a.spec.name.toLowerCase()),
    ].map((s) => s.toLowerCase()),
  );
  const experiences = atlas.experiences.filter((e) => {
    if (capabilityIds.includes(e.capabilityId)) return true;
    const t = e.technique.toLowerCase();
    if (demoKeywords.some((k) => t.includes(k))) return true;
    return e.technologies.some((tech) =>
      techWords.some(
        (w) => w.includes(tech.toLowerCase()) || tech.toLowerCase().includes(w),
      ),
    );
  });
  const capabilityRollups = atlas.capabilities.filter((c) =>
    capabilityIds.includes(c.id),
  );

  // ---- per-approach stats ------------------------------------------------
  const topicNeedles = unique([
    ...unionCompiled.keywords,
    ...spec.name
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length >= 4),
  ]);

  const approachEvidence: ApproachEvidence[] = approachCompiled.map(
    ({ spec: a, compiled }) => {
      const list = perApproach.get(a.slug) ?? [];
      const files = list.map((x) => x.f);
      const t = totalsFor(files);
      const needles = unique([
        ...a.keywords,
        ...a.name
          .toLowerCase()
          .split(/\W+/)
          .filter((w) => w.length >= 4),
      ]);
      const defined = definedSymbolsFor(files, needles);
      const rv = revisitStats(files);
      const testFiles = matchedTests.filter(
        (tf) => matchFile(tf, compiled) !== null,
      ).length;

      const matchedPackages = unique(list.flatMap((x) => x.m.packages));
      const matchedSignals: Record<string, number> = {};
      for (const x of list) {
        for (const s of x.m.signals) {
          matchedSignals[s] = (matchedSignals[s] ?? 0) + (x.f.signals[s] ?? 1);
        }
      }
      const appCommitScaffold = files.filter((f) =>
        scaffoldSet.has(f.commitId),
      ).length;

      return {
        slug: a.slug,
        name: a.name,
        files: t.files,
        commits: t.commits,
        repos: t.repos,
        activeDays: t.activeDays,
        firstSeen: t.firstSeen,
        lastSeen: t.lastSeen,
        additions: t.additions,
        testFiles,
        matchedPackages,
        matchedSignals,
        definedSymbols: defined,
        revisitedFiles: rv.revisited,
        baseline: computeBaselineDepth({
          files: t.files,
          commits: t.commits,
          repos: t.repos,
          activeDays: t.activeDays,
          spanDays: t.spanDays,
          additions: t.additions,
          testFiles,
          definedSymbols: defined.length,
          demoBestRank: files.length ? Math.min(demoBestRank, 2) : 0,
          hardeningCount: files.length ? Math.min(hardening.length, 4) : 0,
          revisitRatio: rv.groups ? rv.revisited / rv.groups : 0,
          followUpCommits: 0,
          approachesWithEvidence: 1,
          scaffoldShare: files.length ? appCommitScaffold / files.length : 0,
        }),
      };
    },
  );

  const topicDefined = definedSymbolsFor(codeFiles, topicNeedles);
  const baseline = computeBaselineDepth({
    files: topicTotals.files,
    commits: topicTotals.commits,
    repos: topicTotals.repos,
    activeDays: topicTotals.activeDays,
    spanDays: topicTotals.spanDays,
    additions: topicTotals.additions,
    testFiles: matchedTests.length,
    definedSymbols: topicDefined.length,
    demoBestRank,
    hardeningCount: hardening.length,
    revisitRatio: revisit.groups ? revisit.revisited / revisit.groups : 0,
    followUpCommits,
    approachesWithEvidence: approachEvidence.filter((a) => a.files > 0).length,
    scaffoldShare,
  });

  // ---- declared but never imported ------------------------------------------
  // every imported package plus each of its "/"-prefixes, so a wanted package
  // is "imported" when it equals one of them (same rule as packageMatches)
  const importedPrefixes = new Set<string>();
  for (const f of index.files) {
    for (const i of f.packages) {
      importedPrefixes.add(i);
      let at = i.indexOf("/");
      while (at !== -1) {
        importedPrefixes.add(i.slice(0, at));
        at = i.indexOf("/", at + 1);
      }
    }
  }
  const authoredRepos = new Set(index.files.map((f) => f.repositoryId));
  const declaredOnly: string[] = [];
  for (const p of unionCompiled.packages) {
    if (importedPrefixes.has(p)) continue;
    for (const repoId of authoredRepos) {
      if (index.repoDeclared.get(repoId)?.has(p)) {
        declaredOnly.push(p);
        break;
      }
    }
  }

  // ---- refs: commits, samples, demonstrations, experiences ------------------
  const refs: EvidenceRef[] = [];

  const commitNotes: CommitNote[] = [];
  const byTs = [...commitIds].sort(
    (a, b) => (commitTs.get(a) ?? 0) - (commitTs.get(b) ?? 0),
  );
  const chosen = new Set<string>([...byTs.slice(0, 3), ...byTs.slice(-3)]);
  for (const id of byTs) {
    if (chosen.size >= 14) break;
    const type = str(commitById.get(id)?.type, "other");
    if (["fix", "perf", "refactor", "test"].includes(type)) chosen.add(id);
  }
  let ci = 0;
  for (const id of byTs.filter((x) => chosen.has(x))) {
    const row = commitById.get(id);
    ci += 1;
    const ref = `C${ci}`;
    const note: CommitNote = {
      ref,
      id,
      subject: str(row?.subject).slice(0, 160),
      type: str(row?.type, "other"),
      day: str(row?.day),
      filesCount: num(row?.files_count) || index.commitFileCount.get(id) || 0,
      scaffold: scaffoldSet.has(id),
    };
    commitNotes.push(note);
    refs.push({
      key: ref,
      kind: "commit",
      id,
      label: note.subject,
      repository: "",
      path: "",
      permalink: "",
      snippet: "",
    });
  }

  // code samples: best files per approach (+ unattributed), strongest first
  const pickFrom = (list: Array<{ f: FileRecord; m: MatchInfo }>, n: number) =>
    [...list]
      .sort(
        (a, b) =>
          b.m.strength - a.m.strength ||
          b.f.additions - a.f.additions ||
          a.f.path.localeCompare(b.f.path),
      )
      .slice(0, n);

  const sampleSources: Array<{
    approach: string;
    item: { f: FileRecord; m: MatchInfo };
  }> = [];
  const usedIds = new Set<string>();
  const addSample = (
    approach: string,
    item: { f: FileRecord; m: MatchInfo },
  ) => {
    if (usedIds.has(item.f.id) || sampleSources.length >= maxSamples) return;
    usedIds.add(item.f.id);
    sampleSources.push({ approach, item });
  };
  for (const a of approachCompiled) {
    for (const item of pickFrom(perApproach.get(a.spec.slug) ?? [], 2)) {
      addSample(a.spec.slug, item);
    }
  }
  for (const item of pickFrom(
    matchedCode.filter((x) => !attributed.has(x.f.id)),
    2,
  )) {
    addSample("", item);
  }
  for (const item of pickFrom(matchedCode, maxSamples)) addSample("", item);

  const codeRows = sampleSources.length
    ? ((await tryRows(
        graph,
        "topic samples",
        `MATCH (fc:FileChange) WHERE fc.id IN $ids RETURN fc.id AS id, fc.added_code AS code`,
        { ids: sampleSources.map((s) => s.item.f.id) },
      )) ?? [])
    : [];
  const codeById = new Map(codeRows.map((r) => [str(r.id), raw(r.code)]));

  const samples: CodeSample[] = [];
  let si = 0;
  for (const { approach, item } of sampleSources) {
    const code = codeById.get(item.f.id) ?? "";
    if (!code.trim()) continue;
    si += 1;
    const ref = `S${si}`;
    const repository = index.repoNames.get(item.f.repositoryId) ?? "";
    const matched = unique([...item.m.packages, ...item.m.keywords]);
    const excerpt = excerptAround(code, matched);
    const subject = str(commitById.get(item.f.commitId)?.subject).slice(0, 140);
    samples.push({
      ref,
      approach,
      repository,
      path: item.f.path,
      commitSubject: subject,
      date: isoDay(item.f.ts),
      matched,
      excerpt,
    });
    refs.push({
      key: ref,
      kind: "code",
      id: item.f.id,
      label: `${item.f.path}${subject ? ` (${subject})` : ""}`,
      repository,
      path: item.f.path,
      permalink:
        repository && item.f.commitSha
          ? `https://github.com/${repository}/blob/${item.f.commitSha}/${item.f.path
              .split("/")
              .map(encodeURIComponent)
              .join("/")}`
          : "",
      snippet: excerpt.slice(0, 500),
    });
  }

  const demonstrations: DemoNote[] = [];
  demoRows.slice(0, maxDemos).forEach((r, i) => {
    const ref = `D${i + 1}`;
    const note: DemoNote = {
      ref,
      capabilityId: str(r.capability_id),
      matchedBy: str(r.matched_by) === "capability" ? "capability" : "keyword",
      technique: str(r.technique),
      depth: str(r.depth),
      modifiers: str(r.modifiers).split(" | ").filter(Boolean),
      repository: str(r.repository),
      path: str(r.path),
      commitSubject: str(r.commit_subject).slice(0, 140),
      snippet: raw(r.snippet).slice(0, 400),
    };
    demonstrations.push(note);
    refs.push({
      key: ref,
      kind: "demonstration",
      id: str(r.id),
      label: `${note.technique} (${note.depth})`,
      repository: note.repository,
      path: note.path,
      permalink: str(r.permalink),
      snippet: note.snippet.slice(0, 500),
    });
  });

  const experienceNotes: ExperienceNote[] = experiences
    .slice(0, 6)
    .map((e, i) => {
      const ref = `E${i + 1}`;
      refs.push({
        key: ref,
        kind: "experience",
        id: e.id,
        label: `${e.technique} (${e.depth})`,
        repository: e.repositories[0] ?? "",
        path: "",
        permalink: "",
        snippet: e.summary.slice(0, 300),
      });
      return {
        ref,
        capabilityId: e.capabilityId,
        technique: e.technique,
        summary: e.summary.slice(0, 300),
        depth: e.depth,
        evidenceCount: e.evidence,
        commitCount: e.commits,
        repoCount: e.repos,
        technologies: e.technologies,
        repositories: e.repositories.slice(0, 4),
      };
    });

  // timeline by month
  const months = new Map<string, number>();
  for (const f of codeFiles) {
    const m = f.createdAt.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(m)) months.set(m, (months.get(m) ?? 0) + 1);
  }
  const timeline = [...months.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-14)
    .map(([month, files]) => ({ month, files }));

  const context = await readTopicContext(graph, developerId, spec.slug);

  return {
    spec,
    matched: codeFiles.length > 0,
    totals: topicTotals,
    approaches: approachEvidence,
    unattributedFiles: codeFiles.filter((f) => !attributed.has(f.id)).length,
    maturation: {
      revisitedFiles: revisit.revisited,
      revisitRatio: revisit.groups
        ? round(revisit.revisited / revisit.groups)
        : 0,
      followUpCommits,
      commitTypes,
    },
    scaffold: {
      commits: scaffoldCommitIds.length,
      share: round(scaffoldShare),
    },
    declaredOnly,
    dependencyEvents: dependencyEvents
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(0, 10),
    capabilityRollups,
    demonstrations,
    experiences: experienceNotes,
    samples,
    commits: commitNotes,
    timeline,
    hardening: hardening.slice(0, 12),
    baseline,
    refs,
    context,
    footprint,
  };
}

// ---- probes: let the agent verify atoms before it trusts them ----------------

/** In-memory check against the atlas: which proposed packages/keywords exist. */
export function probeAtlas(
  atlas: EvidenceAtlas,
  atoms: { packages?: string[]; keywords?: string[]; signals?: string[] },
): { packages: string[]; keywords: string[]; signals: string[] } {
  const known = new Set(atlas.packages.map((p) => p.name));
  const knownSignals = new Set(atlas.signals.map((s) => s.name));
  const vocab = new Set(atlas.vocabulary.map((v) => v.term));
  return {
    packages: unique(
      (atoms.packages ?? [])
        .map((p) => p.toLowerCase())
        .filter((p) => known.has(p)),
    ),
    signals: unique((atoms.signals ?? []).filter((s) => knownSignals.has(s))),
    keywords: unique(
      (atoms.keywords ?? [])
        .map(normalizeKeyword)
        .filter(
          (k) =>
            k.length >= 3 &&
            [...vocab].some((v) => v.includes(k) || k.includes(v)),
        ),
    ),
  };
}

/**
 * Full-text probe over the content of the developer's added code
 * (FalkorDB full-text index on FileChange.path / FileChange.added_code).
 * Returns the FileChange ids that contain the keyword, so the agent can pin
 * them into a TopicSpec and the matcher will see code the symbol index missed.
 */
export async function probeKeywords(
  graph: Graph,
  developerId: string,
  keywords: string[],
  limitPerKeyword = 30,
): Promise<Array<{ keyword: string; fileIds: string[]; paths: string[] }>> {
  const out: Array<{ keyword: string; fileIds: string[]; paths: string[] }> =
    [];
  for (const keyword of unique(keywords.map(normalizeKeyword)).slice(0, 8)) {
    if (keyword.length < 3) continue;
    const q = keyword.length >= 4 ? `${keyword}*` : keyword;
    const result = await tryRows(
      graph,
      `fulltext probe ${keyword}`,
      `
      CALL db.idx.fulltext.queryNodes('FileChange', $q) YIELD node, score
      WHERE node.developer_id = $dev AND coalesce(node.is_test, false) = false
      RETURN node.id AS id, node.path AS path, score
      ORDER BY score DESC
      LIMIT ${Math.min(Math.max(Math.floor(limitPerKeyword), 1), 100)}
      `,
      { q, dev: developerId },
    );
    if (result && result.length) {
      out.push({
        keyword,
        fileIds: result.map((r) => str(r.id)),
        paths: result.slice(0, 5).map((r) => str(r.path)),
      });
    }
  }
  return out;
}

// ============================================================
// 3. TOPIC GRAPH: taxonomy reads + algorithms
// ============================================================

export interface TopicCatalogEntry {
  slug: string;
  name: string;
  domain: string;
  aliases: string[];
  foundationRank: number | null;
  clusterId: number | null;
}

export async function listTopicCatalog(
  graph: Graph,
  limit = 200,
): Promise<TopicCatalogEntry[]> {
  await ensureDepthSchema(graph);
  const n = Math.min(Math.max(Math.floor(limit), 1), 500);
  const result = await tryRows(
    graph,
    "topic catalog",
    `
    MATCH (t:Topic)
    RETURN t.slug AS slug, coalesce(t.name, "") AS name, coalesce(t.domain, "") AS domain,
           coalesce(t.aliases_text, "") AS aliases, t.foundation_rank AS foundation_rank,
           t.cluster_id AS cluster_id
    ORDER BY coalesce(t.foundation_rank, 0) DESC, t.name
    LIMIT ${n}
    `,
  );
  return (result ?? []).map((r) => ({
    slug: str(r.slug),
    name: str(r.name),
    domain: str(r.domain),
    aliases: str(r.aliases)
      .split("|")
      .map((a) => a.trim())
      .filter(Boolean),
    foundationRank: r.foundation_rank == null ? null : num(r.foundation_rank),
    clusterId: r.cluster_id == null ? null : num(r.cluster_id),
  }));
}

export interface CapabilityCatalogEntry {
  id: string;
  name: string;
  description: string;
}

/**
 * Every real leaf Capability in the graph (shared taxonomy, no developer data).
 * This is the ONLY source of valid capability ids for Topic -[:MAPS_TO]-> mappings.
 */
export async function listCapabilityCatalog(
  graph: Graph,
): Promise<CapabilityCatalogEntry[]> {
  const result = await tryRows(
    graph,
    "capability catalog",
    `
    MATCH (c:Capability)
    WHERE coalesce(c.parent_id, "") <> ""
    RETURN c.id AS id, coalesce(c.name, "") AS name, coalesce(c.description, "") AS description
    ORDER BY c.id
    `,
  );
  return (result ?? [])
    .map((r) => ({
      id: str(r.id),
      name: str(r.name),
      description: str(r.description),
    }))
    .filter((c) => c.id);
}

export async function findTopicsByText(
  graph: Graph,
  text: string,
  limit = 8,
): Promise<Array<{ slug: string; name: string; score: number }>> {
  await ensureDepthSchema(graph);
  const tokens = unique(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).slice(
    0,
    10,
  );
  if (!tokens.length) return [];
  const q = tokens.map((t) => (t.length >= 4 ? `${t}*` : t)).join("|");
  const result = await tryRows(
    graph,
    "topic fulltext",
    `
    CALL db.idx.fulltext.queryNodes('Topic', $q) YIELD node, score
    RETURN node.slug AS slug, node.name AS name, score
    ORDER BY score DESC
    LIMIT ${Math.min(Math.max(Math.floor(limit), 1), 20)}
    `,
    { q },
  );
  return (result ?? []).map((r) => ({
    slug: str(r.slug),
    name: str(r.name),
    score: num(r.score),
  }));
}

// ---- taxonomy edge reads (rationale + provenance travel with every edge) -----

export interface TaxonomyEdge {
  from: string;
  to: string;
  type: TopicRelationType;
  reason: string;
  confidence: number;
  strength: RelationStrength;
  basis: string;
  buildId: string;
  model: string;
  updatedAt: string;
}

interface TopicMeta {
  slug: string;
  name: string;
  domain: string;
  description: string;
  foundationRank: number | null;
  bridgeScore: number | null;
  clusterId: number | null;
}

/**
 * Short-lived per-process cache of the shared taxonomy (edges + topic meta).
 * The analyzer, the learning graph and every topic's context used to re-read
 * the same few thousand rows once per topic. Writers call
 * invalidateTaxonomyCache() so a process always sees its own writes.
 */
interface TaxonomyCache {
  edges: Map<string, { at: number; rows: TaxonomyEdge[] }>;
  meta: { at: number; map: Map<string, TopicMeta> } | null;
}
const taxCaches = new WeakMap<object, TaxonomyCache>();

function taxCache(graph: Graph): TaxonomyCache {
  let c = taxCaches.get(graph as unknown as object);
  if (!c) {
    c = { edges: new Map(), meta: null };
    taxCaches.set(graph as unknown as object, c);
  }
  return c;
}

export function invalidateTaxonomyCache(graph: Graph): void {
  taxCaches.delete(graph as unknown as object);
}

/**
 * Every edge of one taxonomy relationship type, by topic slug. The taxonomy is
 * small (hundreds of topics), so graph traversals over it run in memory on one
 * cheap read instead of one variable-length Cypher path query per topic.
 * Callers must treat the returned array as read-only; pass { fresh: true }
 * when the answer decides a write (cycle checks).
 */
export async function readTaxonomyEdges(
  graph: Graph,
  type: TopicRelationType,
  options: { fresh?: boolean } = {},
): Promise<TaxonomyEdge[]> {
  if (!(SUPPORTED_TOPIC_RELATIONS as readonly string[]).includes(type)) {
    throw new Error(`unsupported taxonomy relation ${type}`);
  }
  const cache = taxCache(graph);
  const hit = cache.edges.get(type);
  if (!options.fresh && hit && Date.now() - hit.at < TAXONOMY_TTL_MS) {
    return hit.rows;
  }
  const result = await tryRows(
    graph,
    `taxonomy edges ${type}`,
    `
    MATCH (a:Topic)-[r:${type}]->(b:Topic)
    RETURN a.slug AS from_slug, b.slug AS to_slug,
           coalesce(r.reason, "") AS reason,
           coalesce(r.confidence, 0) AS confidence,
           coalesce(r.strength, "helpful") AS strength,
           coalesce(r.basis, "") AS basis,
           coalesce(r.build_id, "") AS build_id,
           coalesce(r.model, "") AS model,
           coalesce(r.updated_at, "") AS updated_at
    LIMIT 10000
    `,
  );
  const mapped = (result ?? [])
    .map((r) => ({
      from: str(r.from_slug),
      to: str(r.to_slug),
      type,
      reason: str(r.reason),
      confidence: round(num(r.confidence), 2),
      strength: (str(r.strength) === "required"
        ? "required"
        : "helpful") as RelationStrength,
      basis: str(r.basis),
      buildId: str(r.build_id),
      model: str(r.model),
      updatedAt: str(r.updated_at),
    }))
    .filter((e) => e.from && e.to);
  if (result) cache.edges.set(type, { at: Date.now(), rows: mapped });
  return mapped;
}

/** True when adding from -> to would make (to) reach (from) through BUILDS_ON. */
export function wouldCreateBuildsOnCycle(
  edges: Array<{ from: string; to: string }>,
  from: string,
  to: string,
): boolean {
  if (from === to) return true;
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    const list = adjacency.get(e.from) ?? [];
    list.push(e.to);
    adjacency.set(e.from, list);
  }
  const stack = [to];
  const visited = new Set<string>();
  while (stack.length) {
    const node = stack.pop() as string;
    if (node === from) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const next of adjacency.get(node) ?? []) stack.push(next);
  }
  return false;
}

async function readTopicMeta(
  graph: Graph,
  options: { fresh?: boolean } = {},
): Promise<Map<string, TopicMeta>> {
  const cache = taxCache(graph);
  if (
    !options.fresh &&
    cache.meta &&
    Date.now() - cache.meta.at < TAXONOMY_TTL_MS
  ) {
    return cache.meta.map;
  }
  const result = await tryRows(
    graph,
    "topic meta",
    `
    MATCH (t:Topic)
    RETURN t.slug AS slug, coalesce(t.name, "") AS name, coalesce(t.domain, "") AS domain,
           coalesce(t.description, "") AS description,
           t.foundation_rank AS foundation_rank, t.bridge_score AS bridge_score,
           t.cluster_id AS cluster_id
    LIMIT 5000
    `,
  );
  const out = new Map<string, TopicMeta>();
  for (const r of result ?? []) {
    const slug = str(r.slug);
    if (!slug) continue;
    out.set(slug, {
      slug,
      name: str(r.name) || slug,
      domain: str(r.domain),
      description: str(r.description),
      foundationRank: r.foundation_rank == null ? null : num(r.foundation_rank),
      bridgeScore: r.bridge_score == null ? null : num(r.bridge_score),
      clusterId: r.cluster_id == null ? null : num(r.cluster_id),
    });
  }
  if (result) cache.meta = { at: Date.now(), map: out };
  return out;
}

const parseEvidenceBrief = (value: unknown, max = 3): EvidenceBrief[] =>
  mapList(parseJson<unknown>(value, []))
    .slice(0, max)
    .map((e) => ({
      ref: str(e.key),
      kind: str(e.kind),
      label: str(e.label).slice(0, 200),
      repository: str(e.repository),
      path: str(e.path),
      permalink: str(e.permalink),
    }));

/** What this developer has demonstrated in each of the given topics. */
async function readDeveloperDepthMap(
  graph: Graph,
  developerId: string,
  slugs: string[],
): Promise<Map<string, DeveloperTopicDepth>> {
  const out = new Map<string, DeveloperTopicDepth>();
  const wanted = unique(slugs.filter(Boolean));
  for (const part of chunk(wanted, 400)) {
    const result = await tryRows(
      graph,
      "developer depth map",
      `
      MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment)
      WHERE a.topic_slug IN $slugs
      RETURN a.topic_slug AS slug, a.level AS level, a.score AS score,
             a.confidence AS confidence, a.authenticity AS authenticity,
             coalesce(a.verdict, "") AS verdict,
             coalesce(a.files, 0) AS files, coalesce(a.commits, 0) AS commits,
             coalesce(a.repos, 0) AS repos,
             coalesce(a.safeguards_json, "[]") AS safeguards,
             coalesce(a.evidence_json, "[]") AS evidence
      `,
      { dev: developerId, slugs: part },
    );
    for (const r of result ?? []) {
      const slug = str(r.slug);
      out.set(slug, {
        slug,
        level: asDepthLevel(r.level),
        score: num(r.score),
        confidence: asConfidence(r.confidence),
        authenticity: asAuthenticity(r.authenticity),
        verdict: str(r.verdict),
        files: num(r.files),
        commits: num(r.commits),
        repos: num(r.repos),
        safeguards: strList(parseJson<unknown>(r.safeguards, [])).slice(0, 8),
        evidence: parseEvidenceBrief(r.evidence),
      });
    }
  }
  return out;
}

const isPrereqMet = (d: DeveloperTopicDepth | null | undefined): boolean =>
  Boolean(d) && DEPTH_RANK[(d as DeveloperTopicDepth).level] >= PREREQ_MET_RANK;

interface WalkNode {
  slug: string;
  hops: number;
  via: string[];
  edge: TaxonomyEdge;
  requiredPath: boolean;
}

/**
 * Breadth-first walk over BUILDS_ON edges held in memory.
 *   "out": prerequisites (what `start` builds on)
 *   "in" : unlocks (what builds on `start`)
 * Deterministic: neighbours are visited by confidence, then slug.
 */
function walkBuildsOn(
  edges: TaxonomyEdge[],
  direction: "out" | "in",
  start: string,
  maxHops: number,
): WalkNode[] {
  const adjacency = new Map<string, TaxonomyEdge[]>();
  for (const e of edges) {
    const key = direction === "out" ? e.from : e.to;
    const list = adjacency.get(key) ?? [];
    list.push(e);
    adjacency.set(key, list);
  }
  for (const list of adjacency.values()) {
    list.sort((a, b) => {
      const an = direction === "out" ? a.to : a.from;
      const bn = direction === "out" ? b.to : b.from;
      return b.confidence - a.confidence || an.localeCompare(bn);
    });
  }

  const out: WalkNode[] = [];
  const visited = new Set<string>([start]);
  let frontier: WalkNode[] = [
    {
      slug: start,
      hops: 0,
      via: [],
      edge: undefined as unknown as TaxonomyEdge,
      requiredPath: true,
    },
  ];
  for (let hop = 1; hop <= maxHops; hop++) {
    const next: WalkNode[] = [];
    for (const node of frontier) {
      for (const e of adjacency.get(node.slug) ?? []) {
        const target = direction === "out" ? e.to : e.from;
        if (visited.has(target)) continue;
        visited.add(target);
        const child: WalkNode = {
          slug: target,
          hops: hop,
          via: [...node.via, target],
          edge: e,
          requiredPath: node.requiredPath && e.strength === "required",
        };
        out.push(child);
        next.push(child);
      }
    }
    if (!next.length) break;
    frontier = next;
  }
  return out;
}

/** Foundations (BUILDS_ON*1..3) of a topic, with what this developer has shown for each. */
export async function readTopicContext(
  graph: Graph,
  developerId: string,
  slug: string,
): Promise<TopicContext | null> {
  // head comes from the cached topic meta: no query per topic
  const meta = await readTopicMeta(graph);
  const head = meta.get(slug);
  if (!head) return null;

  const builds = await readTaxonomyEdges(graph, "BUILDS_ON");
  const walked = walkBuildsOn(builds, "out", slug, 3);
  const depth = walked.length
    ? await readDeveloperDepthMap(
        graph,
        developerId,
        walked.map((n) => n.slug),
      )
    : new Map<string, DeveloperTopicDepth>();

  const foundations = walked
    .map((n) => {
      const m = meta.get(n.slug);
      const d = depth.get(n.slug);
      return {
        slug: n.slug,
        name: m?.name ?? n.slug,
        hops: n.hops,
        developerLevel: d?.level ?? "none",
        developerScore: d?.score ?? 0,
        reason: n.edge.reason,
        confidence: n.edge.confidence,
        strength: n.edge.strength,
        basis: n.edge.basis,
        via: n.via,
        developerConfidence: d?.confidence,
        developerAuthenticity: d?.authenticity,
        verdict: d?.verdict,
        files: d?.files,
        commits: d?.commits,
        evidence: d?.evidence,
      };
    })
    .sort((a, b) => a.hops - b.hops || a.name.localeCompare(b.name))
    .slice(0, 12);

  return {
    foundationRank: head.foundationRank,
    bridgeScore: head.bridgeScore,
    clusterId: head.clusterId,
    foundations,
  };
}

/** Shortest taxonomy path (native Cypher shortestPath, directed in both orders). */
export async function readTopicPath(
  graph: Graph,
  fromSlug: string,
  toSlug: string,
): Promise<string[]> {
  const query = `
    MATCH (a:Topic {slug: $a}), (b:Topic {slug: $b})
    WITH shortestPath((a)-[:BUILDS_ON|RELATED_TOPIC*1..6]->(b)) AS p
    RETURN CASE WHEN p IS NULL THEN [] ELSE [n IN nodes(p) | n.slug] END AS slugs
  `;
  const forward = await tryRows(graph, "topic path", query, {
    a: fromSlug,
    b: toSlug,
  });
  const f = strList(forward?.[0]?.slugs);
  if (f.length) return f;
  const backward = await tryRows(graph, "topic path (reverse)", query, {
    a: toSlug,
    b: fromSlug,
  });
  return strList(backward?.[0]?.slugs).reverse();
}

export interface TopicPathHop {
  from: string;
  to: string;
  type: "BUILDS_ON" | "RELATED_TOPIC";
}

export async function readTopicPathDetailed(
  graph: Graph,
  fromSlug: string,
  toSlug: string,
): Promise<{ slugs: string[]; hops: TopicPathHop[] }> {
  const query = `
    MATCH (a:Topic {slug: $a}), (b:Topic {slug: $b})
    WITH shortestPath((a)-[:BUILDS_ON|RELATED_TOPIC*1..6]->(b)) AS p
    RETURN CASE WHEN p IS NULL THEN [] ELSE [n IN nodes(p) | n.slug] END AS slugs,
           CASE WHEN p IS NULL THEN [] ELSE [r IN relationships(p) | type(r)] END AS types
  `;
  const build = (slugs: string[], types: string[]) => ({
    slugs,
    hops: slugs.slice(0, -1).map((s, i) => ({
      from: s,
      to: slugs[i + 1] as string,
      type: (types[i] === "BUILDS_ON"
        ? "BUILDS_ON"
        : "RELATED_TOPIC") as TopicPathHop["type"],
    })),
  });
  const fwd = await tryRows(graph, "topic path", query, {
    a: fromSlug,
    b: toSlug,
  });
  const fs = strList(fwd?.[0]?.slugs);
  if (fs.length) return build(fs, strList(fwd?.[0]?.types));
  const back = await tryRows(graph, "topic path (reverse)", query, {
    a: toSlug,
    b: fromSlug,
  });
  const bs = strList(back?.[0]?.slugs);
  return bs.length
    ? build([...bs].reverse(), [...strList(back?.[0]?.types)].reverse())
    : { slugs: [], hops: [] };
}

/**
 * Evidence traversal: Topic -> MAPS_TO -> Capability <- OF_CAPABILITY <- Demonstration
 * for ONE developer. The MAPS_TO hop is taxonomy; the demonstration count is
 * what this developer actually did. Zero demonstrations is a valid answer.
 */
export interface TopicEvidencePath {
  capabilityId: string;
  capability: string;
  demonstrations: number;
  /** how strongly the capability belongs to the topic (0..1), when recorded */
  weight: number | null;
  /** why the capability was mapped to the topic */
  reason: string;
}

export async function readTopicEvidenceTraversal(
  graph: Graph,
  developerId: string,
  slug: string,
): Promise<TopicEvidencePath[]> {
  const result = await tryRows(
    graph,
    "topic evidence traversal",
    `
    MATCH (t:Topic {slug: $slug})-[m:MAPS_TO]->(c:Capability)
    OPTIONAL MATCH (:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c)
    RETURN c.id AS id, coalesce(c.name, "") AS name, count(DISTINCT x) AS demonstrations,
           m.weight AS weight, coalesce(m.reason, "") AS reason
    ORDER BY demonstrations DESC, name
    `,
    { slug, dev: developerId },
  );
  return (result ?? []).map((r) => ({
    capabilityId: str(r.id),
    capability: str(r.name),
    demonstrations: num(r.demonstrations),
    weight: r.weight == null ? null : round(num(r.weight), 2),
    reason: str(r.reason),
  }));
}

// ---- learning graph: traversal + developer depth + evidence -------------------

export interface LearningEdge {
  reason: string;
  confidence: number;
  strength: RelationStrength;
  basis: string;
  buildId: string;
  model: string;
  updatedAt: string;
}

const toLearningEdge = (e: TaxonomyEdge): LearningEdge => ({
  reason: e.reason,
  confidence: e.confidence,
  strength: e.strength,
  basis: e.basis,
  buildId: e.buildId,
  model: e.model,
  updatedAt: e.updatedAt,
});

export interface LearningNode {
  slug: string;
  name: string;
  domain: string;
  hops: number;
  /** slugs from the topic (excluded) to this node (included) */
  via: string[];
  /** the edge that connects this node to the previous one on `via` */
  edge: LearningEdge;
  /** every edge on the path is "required" */
  requiredPath: boolean;
  foundationRank: number | null;
  developer: DeveloperTopicDepth | null;
  /** the developer shows at least working depth here */
  met: boolean;
  /** required, on a required path, and not met */
  blocking: boolean;
}

export interface RelatedLearningNode {
  slug: string;
  name: string;
  domain: string;
  clusterId: number | null;
  edge: LearningEdge;
  developer: DeveloperTopicDepth | null;
}

export interface TopicLearningGraph {
  topic: {
    slug: string;
    name: string;
    domain: string;
    description: string;
    foundationRank: number | null;
    bridgeScore: number | null;
    clusterId: number | null;
  };
  developer: DeveloperTopicDepth | null;
  /** BUILDS_ON*1..maxHops: what must be understood first */
  prerequisites: LearningNode[];
  /** reverse BUILDS_ON: what this topic opens up */
  unlocks: LearningNode[];
  related: RelatedLearningNode[];
  /** taxonomy capabilities with weights, reasons and this developer's demonstration counts */
  capabilityPaths: TopicEvidencePath[];
  readiness: {
    /** no direct required prerequisite is unmet */
    ready: boolean;
    unmetRequired: string[];
    /** unmet required foundations, deepest first: the order to learn them in */
    learningOrder: string[];
    metPrerequisites: string[];
  };
}

function buildLearningNodes(
  walked: WalkNode[],
  meta: Map<string, TopicMeta>,
  depth: Map<string, DeveloperTopicDepth>,
): LearningNode[] {
  return walked.map((n) => {
    const m = meta.get(n.slug);
    const d = depth.get(n.slug) ?? null;
    const met = isPrereqMet(d);
    return {
      slug: n.slug,
      name: m?.name ?? n.slug,
      domain: m?.domain ?? "",
      hops: n.hops,
      via: n.via,
      edge: toLearningEdge(n.edge),
      requiredPath: n.requiredPath,
      foundationRank: m?.foundationRank ?? null,
      developer: d,
      met,
      blocking: n.requiredPath && !met,
    };
  });
}

/**
 * Everything the goal agent needs about ONE topic: its prerequisites (each with
 * the rationale of the edge and what this developer has shown there), what it
 * unlocks, related topics, weighted capability paths and a readiness verdict.
 * Reads the shared taxonomy once (cached) and traverses it in memory.
 */
export async function readTopicLearningGraph(
  graph: Graph,
  developerId: string,
  slug: string,
  options: { maxHops?: number; maxUnlockHops?: number } = {},
): Promise<TopicLearningGraph | null> {
  await ensureDepthSchema(graph);
  const maxHops = Math.min(Math.max(options.maxHops ?? 3, 1), 6);
  const maxUnlockHops = Math.min(Math.max(options.maxUnlockHops ?? 2, 1), 4);

  const meta = await readTopicMeta(graph);
  const head = meta.get(slug);
  if (!head) return null;

  const [builds, relatedEdges] = await Promise.all([
    readTaxonomyEdges(graph, "BUILDS_ON"),
    readTaxonomyEdges(graph, "RELATED_TOPIC"),
  ]);
  const prereqWalk = walkBuildsOn(builds, "out", slug, maxHops);
  const unlockWalk = walkBuildsOn(builds, "in", slug, maxUnlockHops);
  const relatedOut = relatedEdges
    .filter((e) => e.from === slug)
    .sort((a, b) => b.confidence - a.confidence || a.to.localeCompare(b.to))
    .slice(0, 12);

  const [depth, capabilityPaths] = await Promise.all([
    readDeveloperDepthMap(graph, developerId, [
      slug,
      ...prereqWalk.map((n) => n.slug),
      ...unlockWalk.map((n) => n.slug),
      ...relatedOut.map((e) => e.to),
    ]),
    readTopicEvidenceTraversal(graph, developerId, slug),
  ]);

  const prerequisites = buildLearningNodes(prereqWalk, meta, depth).sort(
    (a, b) => a.hops - b.hops || a.name.localeCompare(b.name),
  );
  const unlocks = buildLearningNodes(unlockWalk, meta, depth).sort(
    (a, b) => a.hops - b.hops || a.name.localeCompare(b.name),
  );
  const related: RelatedLearningNode[] = relatedOut.map((e) => {
    const m = meta.get(e.to);
    return {
      slug: e.to,
      name: m?.name ?? e.to,
      domain: m?.domain ?? "",
      clusterId: m?.clusterId ?? null,
      edge: toLearningEdge(e),
      developer: depth.get(e.to) ?? null,
    };
  });

  const blocking = prerequisites.filter((n) => n.blocking);
  const unmetRequired = prerequisites
    .filter((n) => n.hops === 1 && n.blocking)
    .map((n) => n.slug);
  const learningOrder = [...blocking]
    .sort(
      (a, b) =>
        b.hops - a.hops ||
        (b.foundationRank ?? 0) - (a.foundationRank ?? 0) ||
        a.slug.localeCompare(b.slug),
    )
    .map((n) => n.slug);

  return {
    topic: {
      slug: head.slug,
      name: head.name,
      domain: head.domain,
      description: head.description,
      foundationRank: head.foundationRank,
      bridgeScore: head.bridgeScore,
      clusterId: head.clusterId,
    },
    developer: depth.get(slug) ?? null,
    prerequisites,
    unlocks,
    related,
    capabilityPaths,
    readiness: {
      ready: unmetRequired.length === 0,
      unmetRequired,
      learningOrder,
      metPrerequisites: prerequisites.filter((n) => n.met).map((n) => n.slug),
    },
  };
}

export interface LearningFrontierEntry {
  topic: {
    slug: string;
    name: string;
    domain: string;
    foundationRank: number | null;
    bridgeScore: number | null;
    clusterId: number | null;
  };
  developer: DeveloperTopicDepth | null;
  /** every direct required prerequisite is met (or there are none) */
  ready: boolean;
  /** direct prerequisites with edge rationale and the developer's depth in each */
  prerequisites: Array<{
    slug: string;
    name: string;
    strength: RelationStrength;
    reason: string;
    confidence: number;
    met: boolean;
    developer: DeveloperTopicDepth | null;
  }>;
  blockedBy: string[];
  /** number of topics that directly build on this one */
  unlocks: number;
  why: string;
}

/**
 * Topics the developer has not yet mastered, ordered by how useful they are to
 * learn next: unblocked first, then foundational (PageRank over BUILDS_ON),
 * then how many topics they unlock, then how far the developer already is.
 */
export async function readLearningFrontier(
  graph: Graph,
  developerId: string,
  options: { limit?: number; belowLevel?: DepthLevel } = {},
): Promise<LearningFrontierEntry[]> {
  await ensureDepthSchema(graph);
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 25), 1), 200);
  const belowRank = DEPTH_RANK[options.belowLevel ?? "proficient"];

  const meta = await readTopicMeta(graph);
  if (meta.size === 0) return [];
  const builds = await readTaxonomyEdges(graph, "BUILDS_ON");
  const depth = await readDeveloperDepthMap(graph, developerId, [
    ...meta.keys(),
  ]);

  const outgoing = new Map<string, TaxonomyEdge[]>();
  const unlockCount = new Map<string, number>();
  for (const e of builds) {
    outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e]);
    unlockCount.set(e.to, (unlockCount.get(e.to) ?? 0) + 1);
  }

  const entries: LearningFrontierEntry[] = [];
  for (const m of meta.values()) {
    const d = depth.get(m.slug) ?? null;
    if (d && DEPTH_RANK[d.level] >= belowRank) continue;

    const prerequisites = (outgoing.get(m.slug) ?? [])
      .map((e) => {
        const pm = meta.get(e.to);
        const pd = depth.get(e.to) ?? null;
        return {
          slug: e.to,
          name: pm?.name ?? e.to,
          strength: e.strength,
          reason: e.reason,
          confidence: e.confidence,
          met: isPrereqMet(pd),
          developer: pd,
        };
      })
      .sort(
        (a, b) =>
          Number(a.met) - Number(b.met) ||
          b.confidence - a.confidence ||
          a.slug.localeCompare(b.slug),
      );
    const blockedBy = prerequisites
      .filter((p) => p.strength === "required" && !p.met)
      .map((p) => p.slug);
    const unlocks = unlockCount.get(m.slug) ?? 0;
    const ready = blockedBy.length === 0;

    const state = d
      ? `currently ${d.level} (${d.authenticity})`
      : "not yet demonstrated in the developer's code";
    entries.push({
      topic: {
        slug: m.slug,
        name: m.name,
        domain: m.domain,
        foundationRank: m.foundationRank,
        bridgeScore: m.bridgeScore,
        clusterId: m.clusterId,
      },
      developer: d,
      ready,
      prerequisites,
      blockedBy,
      unlocks,
      why: ready
        ? `${m.name} is ${state}; no required prerequisite is missing${unlocks ? `, and ${unlocks} topic(s) build on it` : ""}.`
        : `${m.name} is ${state}; first needs ${blockedBy.join(", ")}.`,
    });
  }

  entries.sort(
    (a, b) =>
      Number(b.ready) - Number(a.ready) ||
      (b.topic.foundationRank ?? 0) - (a.topic.foundationRank ?? 0) ||
      b.unlocks - a.unlocks ||
      (b.developer?.score ?? 0) - (a.developer?.score ?? 0) ||
      a.topic.slug.localeCompare(b.topic.slug),
  );
  return entries.slice(0, limit);
}

export interface TopicGraphMetrics {
  topics: number;
  relations: number;
  pageRank: number;
  betweenness: number;
  communities: number;
  components: number;
  /** human-readable reasons a metric is absent (kept for older callers) */
  fallbacks: string[];
  /** ok: every expected algorithm ran and wrote every row; partial/failed/empty_graph otherwise */
  status: "ok" | "partial" | "failed" | "empty_graph";
  algorithmsRun: string[];
  failures: string[];
}

const TOPIC_METRIC_PROPS = new Set([
  "foundation_rank",
  "bridge_score",
  "cluster_id",
  "component_id",
]);

async function writeTopicMetric(
  graph: Graph,
  prop: string,
  items: Array<{ id: string; value: number }>,
  metadata: { computedAt: string; buildId: string },
): Promise<number> {
  if (!TOPIC_METRIC_PROPS.has(prop))
    throw new Error(`unsafe topic property ${prop}`);
  return runCounted(
    graph,
    `Topic.${prop}`,
    `
    UNWIND $batch AS item
    MATCH (t:Topic {id: item.id})
    SET t.${prop} = item.value,
        t.computed_at = $computed_at,
        t.build_id = $build_id
    RETURN count(t) AS n
    `,
    items,
    {
      params: { computed_at: metadata.computedAt, build_id: metadata.buildId },
    },
  );
}

/**
 * Runs FalkorDB graph algorithms over the SHARED topic taxonomy and writes the
 * results back onto Topic nodes:
 *
 *   algo.pageRank          foundation_rank  how many topics (transitively)
 *                                           build on this one: foundations score high
 *   algo.betweenness       bridge_score     topics that connect otherwise separate areas
 *   algo.labelPropagation  cluster_id       topic communities (RELATED_TOPIC)
 *   algo.WCC               component_id     disconnected topic islands
 *
 * Old ranks are never wiped up front any more: each metric is computed first,
 * written, and only then are stale values of THAT metric removed, so a failed
 * run leaves the previous ranks in place instead of an empty graph. An empty
 * taxonomy (nothing to rank) does clear them.
 */
export async function refreshTopicGraphMetrics(
  graph: Graph,
  options: { buildId?: string; now?: string } = {},
): Promise<TopicGraphMetrics> {
  try {
    return await refreshTopicGraphMetricsImpl(graph, options);
  } finally {
    invalidateTaxonomyCache(graph);
  }
}

async function refreshTopicGraphMetricsImpl(
  graph: Graph,
  options: { buildId?: string; now?: string },
): Promise<TopicGraphMetrics> {
  await ensureDepthSchema(graph);
  const computedAt = options.now ?? new Date().toISOString();
  const metricBuildId =
    options.buildId?.trim() || `topic-metrics:${computedAt}`;
  const metricMetadata = { computedAt, buildId: metricBuildId };
  const metrics: TopicGraphMetrics = {
    topics: 0,
    relations: 0,
    pageRank: 0,
    betweenness: 0,
    communities: 0,
    components: 0,
    fallbacks: [],
    status: "failed",
    algorithmsRun: [],
    failures: [],
  };
  const fail = (message: string) => {
    metrics.failures.push(message);
    metrics.fallbacks.push(message);
  };

  // Count each relationship type independently. FalkorDB graph algorithms
  // can reject a configuration containing a relationship type absent from
  // the current graph (for example BUILDS_ON when only RELATED_TOPIC exists).
  const counts = await tryRows(
    graph,
    "topic relationship counts",
    `
    MATCH (t:Topic)
    WITH count(t) AS topics
    OPTIONAL MATCH (:Topic)-[b:BUILDS_ON]->(:Topic)
    WITH topics, count(b) AS buildsOnEdges
    OPTIONAL MATCH (:Topic)-[r:RELATED_TOPIC]->(:Topic)
    RETURN topics, buildsOnEdges, count(r) AS relatedEdges
    `,
  );

  if (!counts) {
    fail("topic relationship counts unavailable");
    log("topic graph metrics unavailable", metrics as unknown as Row);
    return metrics;
  }

  const countRow = counts[0] ?? {};
  metrics.topics = num(countRow.topics);
  let buildsOnEdges = num(countRow.buildsOnEdges);
  let relatedEdges = num(countRow.relatedEdges);

  // Validate relationship types against what the database actually knows.
  const typeRows = await tryRows(
    graph,
    "relationship types",
    `CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType`,
  );
  if (typeRows) {
    const dbTypes = new Set(typeRows.map((r) => str(r.relationshipType)));
    if (!dbTypes.has("BUILDS_ON") && buildsOnEdges > 0) {
      fail("BUILDS_ON edges counted but the type is unknown to the database");
      buildsOnEdges = 0;
    }
    if (!dbTypes.has("RELATED_TOPIC") && relatedEdges > 0) {
      fail(
        "RELATED_TOPIC edges counted but the type is unknown to the database",
      );
      relatedEdges = 0;
    }
  }
  metrics.relations = buildsOnEdges + relatedEdges;

  if (metrics.topics < 2 || metrics.relations === 0) {
    metrics.status = "empty_graph";
    fail(
      `graph ranking unavailable: ${metrics.topics} topics and ${metrics.relations} usable taxonomy edges; nothing was ranked`,
    );
    // nothing to rank: previous ranks no longer describe this taxonomy
    await tryRows(
      graph,
      "clear topic metrics",
      `MATCH (t:Topic)
       REMOVE t.foundation_rank, t.bridge_score, t.cluster_id, t.component_id,
              t.computed_at, t.build_id
       RETURN count(t) AS n`,
    );
    log("graph ranking unavailable: topic taxonomy has no connected edges", {
      ...metrics,
      buildsOnEdges,
      relatedEdges,
    });
    return metrics;
  }

  const runMetric = async (
    label: string,
    query: string,
    prop: string,
    valueKey: string,
  ): Promise<number> => {
    const result = await tryRows(graph, label, query);
    if (!result || result.length === 0) {
      fail(`${prop}: ${label} returned no results; no proxy ranking used`);
      return 0;
    }
    try {
      const items = result.map((r) => ({
        id: str(r.id),
        value: round(num(r[valueKey]), 6),
      }));
      const written = await writeTopicMetric(
        graph,
        prop,
        items,
        metricMetadata,
      );
      if (written < items.length) {
        fail(
          `${prop}: only ${written}/${items.length} ${label} results matched persisted Topic nodes`,
        );
      }
      if (written > 0) {
        metrics.algorithmsRun.push(label);
        // drop this metric from topics the fresh run did not return
        await tryRows(
          graph,
          `clear stale ${prop}`,
          `MATCH (t:Topic)
           WHERE NOT t.id IN $ids AND t.${prop} IS NOT NULL
           REMOVE t.${prop}
           RETURN count(t) AS n`,
          { ids: items.map((i) => i.id) },
        );
      }
      return written;
    } catch (error) {
      fail(
        `${prop}: writing ${label} results failed (${error instanceof Error ? error.message : String(error)})`,
      );
      return 0;
    }
  };

  // Prefer dependency edges for foundation PageRank; when there are none yet,
  // rank the existing RELATED_TOPIC graph instead. Both are FalkorDB PageRank.
  const pageRankType = buildsOnEdges > 0 ? "BUILDS_ON" : "RELATED_TOPIC";
  metrics.pageRank = await runMetric(
    `algo.pageRank (${pageRankType})`,
    `CALL algo.pageRank('Topic', '${pageRankType}')
     YIELD node, score
     RETURN node.id AS id, score`,
    "foundation_rank",
    "score",
  );

  // Pass only relationship types that exist and have edges.
  const traversalTypes: string[] = [];
  if (buildsOnEdges > 0) traversalTypes.push("BUILDS_ON");
  if (relatedEdges > 0) traversalTypes.push("RELATED_TOPIC");
  const traversalTypesCypher = JSON.stringify(traversalTypes);

  metrics.betweenness = await runMetric(
    "algo.betweenness",
    `
    CALL algo.betweenness({
      nodeLabels: ['Topic'],
      relationshipTypes: ${traversalTypesCypher}
    })
    YIELD node, score
    RETURN node.id AS id, score
    `,
    "bridge_score",
    "score",
  );

  // Communities are meaningful only on the RELATED_TOPIC subgraph.
  if (relatedEdges > 0) {
    metrics.communities = await runMetric(
      "algo.labelPropagation",
      `
      CALL algo.labelPropagation({
        nodeLabels: ['Topic'],
        relationshipTypes: ['RELATED_TOPIC'],
        maxIterations: 10
      })
      YIELD node, communityId
      RETURN node.id AS id, communityId
      `,
      "cluster_id",
      "communityId",
    );
  } else {
    await tryRows(
      graph,
      "clear cluster_id",
      `MATCH (t:Topic) WHERE t.cluster_id IS NOT NULL REMOVE t.cluster_id RETURN count(t) AS n`,
    );
  }

  metrics.components = await runMetric(
    "algo.WCC",
    `
    CALL algo.WCC({
      nodeLabels: ['Topic'],
      relationshipTypes: ${traversalTypesCypher}
    })
    YIELD node, componentId
    RETURN node.id AS id, componentId
    `,
    "component_id",
    "componentId",
  );

  const expected = 3 + (relatedEdges > 0 ? 1 : 0);
  metrics.status =
    metrics.failures.length === 0 && metrics.algorithmsRun.length === expected
      ? "ok"
      : metrics.algorithmsRun.length > 0
        ? "partial"
        : "failed";

  log("topic graph metrics refreshed", {
    ...metrics,
    buildsOnEdges,
    relatedEdges,
    pageRankRelationship: pageRankType,
    traversalRelationshipTypes: traversalTypes,
  } as unknown as Row);
  return metrics;
}

// ============================================================
// 4. PERSISTENCE
// ============================================================

export interface ApproachRecord {
  slug: string;
  name: string;
  description: string;
  files: number;
  commits: number;
  repos: number;
  firstSeen: string;
  lastSeen: string;
  depth: DepthLevel;
  authenticity: Authenticity;
  isPrimary: boolean;
  howImplemented: string;
  hardening: string[];
  gaps: string[];
  evidenceRefs: string[];
}

/** A concrete thing the developer built, pointing at the code that shows it. */
export interface ImplementationNote {
  ref: string;
  what: string;
  repository: string;
  path: string;
  permalink: string;
}

export interface DepthAssessmentRecord {
  slug: any;
  name: any;
  topic: {
    slug: string;
    name: string;
    domain: string;
    description: string;
    aliases: string[];
  };
  level: DepthLevel;
  score: number;
  baselineScore: number;
  baselineLevel: DepthLevel;
  confidence: Confidence;
  authenticity: Authenticity;
  verdict: string;
  rationale: string;
  strengths: string[];
  gaps: string[];
  /** hardening behaviours (limits, error paths, cleanup, validation...) actually observed */
  safeguards: string[];
  /** what was built, each tied to a cited code or detector reference */
  implementations: ImplementationNote[];
  approaches: ApproachRecord[];
  /** only the evidence that was actually cited */
  evidence: EvidenceRef[];
  stats: EvidenceTotals;
  spec: TopicSpec;
  /** true when the LLM was unavailable and the baseline decided */
  fallback: boolean;
}

export interface TopicRelationInput {
  from: string;
  to: string;
  type: TopicRelationType;
  /** specific rationale: why the edge exists. Generic templates are rejected. */
  reason: string;
  /** 0..1 (default 0.6) */
  confidence?: number;
  /** BUILDS_ON only (default "helpful") */
  strength?: RelationStrength;
  /** default "llm_inferred" */
  basis?: RelationBasis;
}

export interface TopicRelationRejection {
  from: string;
  to: string;
  type: string;
  reason: string;
}

export interface StoreDepthInput {
  developerId: string;
  buildId: string;
  model: string;
  assessments: DepthAssessmentRecord[];
  relations: TopicRelationInput[];
  /** true: remove this developer's assessments that are not in this build */
  replaceAll: boolean;
  /**
   * true: Topic -[:MAPS_TO]-> Capability edges of the written topics that this
   * build did not re-assert are removed (the topic was deliberately remapped).
   * Only edges created by this pipeline (basis "agent_validated") are touched.
   */
  pruneStaleMappings?: boolean;
}

export interface StoreDepthResult {
  topics: number;
  assessments: number;
  approaches: number;
  evidenceEdges: number;
  mappings: number;
  unresolvedMappings: Array<{
    topic: string;
    capabilityId: string;
    reason: string;
  }>;
  relationsRequested: number;
  relations: number;
  rejectedRelations: TopicRelationRejection[];
  /** nodes deleted because they lost their anchor during this write */
  orphansRemoved: { assessments: number; approaches: number; topics: number };
}

const topicId = (slug: string) => `topic:${slug}`;
const approachId = (topic: string, slug: string) => `approach:${topic}:${slug}`;
const assessmentId = (dev: string, slug: string) => `depth:${dev}:${slug}`;

// ---- shared-taxonomy writers (no developer data passes through here) ---------

export interface TopicMetadataInput {
  slug: string;
  name: string;
  domain: string;
  description: string;
  aliases: string[];
}

/**
 * Upserts validated Topic metadata.
 *  - created_at is written once and preserved.
 *  - domain is validated against TOPIC_DOMAINS and updated on every write, so
 *    a validated domain corrects an older "general". A "general" write never
 *    downgrades an already-specific domain.
 *  - empty description / aliases never erase existing text.
 * createMissing=false only touches nodes that already exist (used by backfill).
 */
export async function writeTopicMetadata(
  graph: Graph,
  topics: TopicMetadataInput[],
  options: { now: string; createMissing?: boolean },
): Promise<number> {
  const items = topics
    .filter((t) => t.slug && t.name)
    .map((t) => ({
      id: topicId(t.slug),
      slug: t.slug,
      name: t.name,
      domain: asTopicDomain(t.domain) ?? "general",
      description: t.description ?? "",
      aliases_text: t.aliases.join(" | "),
    }));

  const setClause = `
    SET t.slug = item.slug,
        t.name = CASE WHEN item.name <> "" THEN item.name ELSE t.name END,
        t.domain = CASE WHEN item.domain = "general" AND coalesce(t.domain, "general") <> "general"
                        THEN t.domain ELSE item.domain END,
        t.description = CASE WHEN item.description <> "" THEN item.description
                             ELSE coalesce(t.description, "") END,
        t.aliases_text = CASE WHEN item.aliases_text <> "" THEN item.aliases_text
                              ELSE coalesce(t.aliases_text, "") END,
        t.updated_at = $now
    RETURN count(t) AS n`;

  const query =
    options.createMissing === false
      ? `UNWIND $batch AS item
         MATCH (t:Topic {id: item.id})
         ${setClause}`
      : `UNWIND $batch AS item
         MERGE (t:Topic {id: item.id})
         ON CREATE SET t.created_at = $now
         ${setClause}`;

  try {
    return await runCounted(graph, "Topic metadata", query, items, {
      params: { now: options.now },
      strict: options.createMissing !== false,
    });
  } finally {
    invalidateTaxonomyCache(graph);
  }
}

export interface TopicCapabilityMapping {
  topicSlug: string;
  capabilityId: string;
  /** 0..1 (default 0.5). Mappings under MIN_MAPPING_WEIGHT are not persisted. */
  weight?: number;
  /** why this capability belongs to this topic */
  reason?: string;
}

/**
 * Persists Topic -[:MAPS_TO]-> Capability using ONLY leaf capability ids that
 * exist in the graph. Unknown, non-leaf and weak mappings are returned as
 * unresolved, never created. Every edge carries its weight, reason and the
 * build that last asserted it. MAPS_TO is taxonomy, not proof a developer
 * implemented the capability.
 */
export async function writeTopicCapabilityMappings(
  graph: Graph,
  mappings: TopicCapabilityMapping[],
  options: { buildId: string; now: string; pruneStaleForTopics?: string[] },
): Promise<{
  written: number;
  unresolved: StoreDepthResult["unresolvedMappings"];
}> {
  const seen = new Set<string>();
  const wanted = mappings.filter((m) => {
    if (!m.topicSlug || !m.capabilityId) return false;
    const key = `${m.topicSlug}>${m.capabilityId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const existing = new Set<string>();
  for (const part of chunk(unique(wanted.map((m) => m.capabilityId)), 300)) {
    const found = await rows(
      graph,
      `MATCH (c:Capability) WHERE c.id IN $ids AND coalesce(c.parent_id, "") <> "" RETURN c.id AS id`,
      { ids: part },
    );
    for (const r of found) existing.add(str(r.id));
  }

  const unresolved: StoreDepthResult["unresolvedMappings"] = [];
  const valid = wanted.filter((m) => {
    if (!existing.has(m.capabilityId)) {
      unresolved.push({
        topic: m.topicSlug,
        capabilityId: m.capabilityId,
        reason: "capability does not exist in the graph or is not a leaf",
      });
      return false;
    }
    const weight = clamp01(m.weight ?? 0.5);
    if (weight < MIN_MAPPING_WEIGHT) {
      unresolved.push({
        topic: m.topicSlug,
        capabilityId: m.capabilityId,
        reason: `mapping weight ${round(weight)} is below ${MIN_MAPPING_WEIGHT}`,
      });
      return false;
    }
    return true;
  });

  const written = await runCounted(
    graph,
    "MAPS_TO edges",
    `
    UNWIND $batch AS item
    MATCH (t:Topic {id: item.topic_id})
    MATCH (c:Capability {id: item.capability_id})
    MERGE (t)-[r:MAPS_TO]->(c)
    ON CREATE SET r.created_at = $now
    SET r.basis = "agent_validated",
        r.reason = CASE WHEN item.reason <> "" THEN item.reason ELSE coalesce(r.reason, "") END,
        r.weight = CASE WHEN item.weight >= coalesce(r.weight, 0) THEN item.weight ELSE r.weight END,
        r.build_id = $build_id,
        r.updated_at = $now
    RETURN count(r) AS n
    `,
    valid.map((m) => ({
      topic_id: topicId(m.topicSlug),
      capability_id: m.capabilityId,
      weight: round(clamp01(m.weight ?? 0.5), 2),
      reason: (m.reason ?? "").slice(0, 300),
    })),
    { params: { build_id: options.buildId, now: options.now } },
  );

  const pruneTopics = options.pruneStaleForTopics ?? [];
  if (pruneTopics.length) {
    if (written === valid.length) {
      await graph.query(
        `
        MATCH (t:Topic)-[r:MAPS_TO]->(:Capability)
        WHERE t.id IN $ids
          AND coalesce(r.basis, "") = "agent_validated"
          AND coalesce(r.build_id, "") <> $build_id
        DELETE r
        `,
        {
          params: {
            ids: pruneTopics.map(topicId),
            build_id: options.buildId,
          },
        },
      );
    } else {
      log("MAPS_TO stale cleanup skipped: some mappings were not written", {
        expected: valid.length,
        written,
      });
    }
  }
  return { written, unresolved };
}

/**
 * Persists BUILDS_ON / RELATED_TOPIC between canonical topic ids.
 *
 * Rejected (and returned): unsupported types, self loops, endpoints that are
 * not persisted Topics, missing or generic rationales, a BUILDS_ON that would
 * close a cycle with ANY BUILDS_ON already in the graph (a prerequisite
 * relation must stay a DAG), and a RELATED_TOPIC between topics already linked
 * by BUILDS_ON.
 *
 * Every accepted edge keeps its rationale and provenance: reason, confidence,
 * strength (BUILDS_ON), basis, the build and model that last asserted it, plus
 * created_at / created_build_id / created_model that are written once. A later
 * assertion replaces the stored rationale only when it is at least as
 * confident, so a vague re-run can never overwrite a better explanation.
 */
export async function writeTopicRelations(
  graph: Graph,
  relations: TopicRelationInput[],
  options: {
    now: string;
    buildId?: string;
    model?: string;
    requireRationale?: boolean;
  },
): Promise<{ persisted: number; rejected: TopicRelationRejection[] }> {
  try {
    return await writeTopicRelationsImpl(graph, relations, options);
  } finally {
    invalidateTaxonomyCache(graph);
  }
}

async function writeTopicRelationsImpl(
  graph: Graph,
  relations: TopicRelationInput[],
  options: {
    now: string;
    buildId?: string;
    model?: string;
    requireRationale?: boolean;
  },
): Promise<{ persisted: number; rejected: TopicRelationRejection[] }> {
  const rejected: TopicRelationRejection[] = [];
  const supported = new Set<string>(SUPPORTED_TOPIC_RELATIONS);
  const requireRationale = options.requireRationale !== false;
  const buildId = options.buildId ?? "";
  const model = options.model ?? "";

  const endpoints = unique(
    relations.flatMap((r) => [r.from, r.to]).filter(Boolean),
  );
  const present = new Set<string>();
  for (const part of chunk(endpoints.map(topicId), 300)) {
    const found = await rows(
      graph,
      `MATCH (t:Topic) WHERE t.id IN $ids RETURN t.id AS id`,
      { ids: part },
    );
    for (const r of found) present.add(str(r.id));
  }

  // A foundation the model names but that has no assessment used to be rejected
  // with "target topic is not persisted", which silently dropped most BUILDS_ON
  // edges. Persist it as an unassessed taxonomy node (frontend draws it dashed).
  const SLUG_OK = /^[a-z0-9_]{1,60}$/;
  const stubSlugs = unique(
    relations
      .filter(
        (r) =>
          supported.has(r.type) &&
          r.from &&
          r.to &&
          r.from !== r.to &&
          (!requireRationale || isSpecificRationale(r.reason ?? "")),
      )
      .flatMap((r) => [r.from, r.to]),
  ).filter((s) => SLUG_OK.test(s) && !present.has(topicId(s)));
  if (stubSlugs.length) {
    await runCounted(
      graph,
      "Topic stubs",
      `
      UNWIND $batch AS item
      MERGE (t:Topic {id: item.id})
      ON CREATE SET t.slug = item.slug, t.name = item.name, t.domain = "general",
                    t.description = "", t.aliases_text = "", t.stub = true,
                    t.created_at = $now
      RETURN count(t) AS n
      `,
      stubSlugs.map((slug) => ({
        id: topicId(slug),
        slug,
        name: slug.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
      })),
      { params: { now: options.now } },
    );
    for (const slug of stubSlugs) present.add(topicId(slug));
    log("created unassessed foundation topics", { count: stubSlugs.length });
  }
  // fresh read: this decides a write (cycle detection must see every edge)
  const existingBuilds = await readTaxonomyEdges(graph, "BUILDS_ON", {
    fresh: true,
  });
  const buildsGraph: Array<{ from: string; to: string }> = existingBuilds.map(
    (e) => ({ from: e.from, to: e.to }),
  );
  const linkedByBuilds = new Set<string>(
    buildsGraph.map((e) => [e.from, e.to].sort().join("~")),
  );

  const ok: TopicRelationInput[] = [];
  const seen = new Set<string>();
  const precheck = (r: TopicRelationInput): string | null => {
    if (!supported.has(r.type)) return "unsupported relationship type";
    if (!r.from || !r.to || r.from === r.to)
      return "self-referential or empty edge";
    if (!present.has(topicId(r.from))) return "source topic is not persisted";
    if (!present.has(topicId(r.to))) return "target topic is not persisted";
    if (requireRationale && !isSpecificRationale(r.reason ?? ""))
      return "missing or generic rationale";
    return null;
  };

  // BUILDS_ON first so RELATED_TOPIC checks see every accepted prerequisite.
  for (const r of relations.filter((x) => x.type === "BUILDS_ON")) {
    const base = { from: r.from, to: r.to, type: r.type };
    const problem = precheck(r);
    if (problem) {
      rejected.push({ ...base, reason: problem });
      continue;
    }
    const key = `${r.type}:${r.from}>${r.to}`;
    if (seen.has(key)) continue;
    if (wouldCreateBuildsOnCycle(buildsGraph, r.from, r.to)) {
      rejected.push({
        ...base,
        reason: "would create a BUILDS_ON cycle with the existing taxonomy",
      });
      continue;
    }
    seen.add(key);
    buildsGraph.push({ from: r.from, to: r.to });
    linkedByBuilds.add([r.from, r.to].sort().join("~"));
    ok.push(r);
  }
  for (const r of relations.filter((x) => x.type !== "BUILDS_ON")) {
    const base = { from: r.from, to: r.to, type: r.type };
    const problem = precheck(r);
    if (problem) {
      rejected.push({ ...base, reason: problem });
      continue;
    }
    if (linkedByBuilds.has([r.from, r.to].sort().join("~"))) {
      rejected.push({ ...base, reason: "already linked by BUILDS_ON" });
      continue;
    }
    const key = `${r.type}:${[r.from, r.to].sort().join("~")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ok.push(r);
  }

  const toRows = (list: TopicRelationInput[]) =>
    list.map((r) => ({
      from_id: topicId(r.from),
      to_id: topicId(r.to),
      reason: (r.reason ?? "").trim().slice(0, 400),
      confidence: round(clamp01(r.confidence ?? 0.6), 2),
      strength: r.strength === "required" ? "required" : "helpful",
      basis: r.basis ?? "llm_inferred",
    }));
  const edgeParams = { now: options.now, build_id: buildId, model };

  // The rationale only moves when the new assertion is at least as confident
  // as the stored one (or nothing meaningful is stored yet).
  const edgeQuery = (type: TopicRelationType, reverse: boolean) => `
    UNWIND $batch AS item
    MATCH (a:Topic {id: item.from_id})
    MATCH (b:Topic {id: item.to_id})
    MERGE (${reverse ? "b" : "a"})-[r:${type}]->(${reverse ? "a" : "b"})
    ON CREATE SET r.created_at = $now, r.created_build_id = $build_id, r.created_model = $model
    WITH r, item, (coalesce(r.reason, "") = "" OR coalesce(r.confidence, 0) <= item.confidence) AS take
    SET r.reason = CASE WHEN take THEN item.reason ELSE r.reason END,
        r.confidence = CASE WHEN take THEN item.confidence ELSE r.confidence END,
        r.strength = CASE WHEN take THEN item.strength ELSE coalesce(r.strength, item.strength) END,
        r.basis = CASE WHEN take THEN item.basis ELSE coalesce(r.basis, item.basis) END,
        r.build_id = CASE WHEN take THEN $build_id ELSE coalesce(r.build_id, $build_id) END,
        r.model = CASE WHEN take THEN $model ELSE coalesce(r.model, $model) END,
        r.updated_at = $now
    RETURN count(r) AS n
  `;

  const builds = await runCounted(
    graph,
    "BUILDS_ON edges",
    edgeQuery("BUILDS_ON", false),
    toRows(ok.filter((r) => r.type === "BUILDS_ON")),
    { params: edgeParams },
  );

  const relatedList = toRows(ok.filter((r) => r.type === "RELATED_TOPIC"));
  const relatedForward = await runCounted(
    graph,
    "RELATED_TOPIC edges",
    edgeQuery("RELATED_TOPIC", false),
    relatedList,
    { params: edgeParams },
  );
  const relatedReverse = await runCounted(
    graph,
    "RELATED_TOPIC reverse edges",
    edgeQuery("RELATED_TOPIC", true),
    relatedList,
    { params: edgeParams },
  );

  const expected = ok.length;
  const persisted = builds + Math.min(relatedForward, relatedReverse);
  if (persisted < expected) {
    log("some topic relations were rejected by the database", {
      expected,
      persisted,
    });
  }
  if (rejected.length) {
    log("topic relations rejected before writing", {
      rejected: rejected.length,
      sample: rejected.slice(0, 5),
    });
  }
  return { persisted, rejected };
}

/**
 * Taxonomy hygiene: removes self-referential edges and makes RELATED_TOPIC
 * symmetric (the reverse edge copies reason, confidence and basis). Never
 * touches developer data.
 */
export async function repairTopicEdges(
  graph: Graph,
  options: { now: string },
): Promise<{ selfLoopsRemoved: number; reverseAdded: number }> {
  const loops = await tryRows(
    graph,
    "count self loops",
    `MATCH (a:Topic)-[r:BUILDS_ON|RELATED_TOPIC]->(b:Topic) WHERE a.id = b.id RETURN count(r) AS n`,
  );
  const selfLoopsRemoved = num(loops?.[0]?.n);
  if (selfLoopsRemoved > 0) {
    await tryRows(
      graph,
      "remove self loops",
      `MATCH (a:Topic)-[r:BUILDS_ON|RELATED_TOPIC]->(b:Topic) WHERE a.id = b.id DELETE r`,
    );
  }

  const missing = await tryRows(
    graph,
    "asymmetric related edges",
    `
    MATCH (a:Topic)-[r:RELATED_TOPIC]->(b:Topic)
    WHERE NOT (b)-[:RELATED_TOPIC]->(a)
    RETURN a.id AS a_id, b.id AS b_id, coalesce(r.reason, "") AS reason,
           coalesce(r.confidence, 0) AS confidence,
           coalesce(r.basis, "llm_inferred") AS basis,
           coalesce(r.build_id, "") AS build_id,
           coalesce(r.model, "") AS model
    `,
  );
  const reverseAdded = await runCounted(
    graph,
    "RELATED_TOPIC symmetry",
    `
    UNWIND $batch AS item
    MATCH (a:Topic {id: item.a_id})
    MATCH (b:Topic {id: item.b_id})
    MERGE (b)-[r:RELATED_TOPIC]->(a)
    ON CREATE SET r.created_at = $now
    SET r.basis = item.basis, r.reason = item.reason, r.confidence = item.confidence,
        r.build_id = item.build_id, r.model = item.model, r.updated_at = $now
    RETURN count(r) AS n
    `,
    (missing ?? []).map((m) => ({
      a_id: str(m.a_id),
      b_id: str(m.b_id),
      reason: str(m.reason),
      confidence: num(m.confidence),
      basis: str(m.basis, "llm_inferred"),
      build_id: str(m.build_id),
      model: str(m.model),
    })),
    { params: { now: options.now } },
  );
  invalidateTaxonomyCache(graph);
  return { selfLoopsRemoved, reverseAdded };
}

// ---- backfill reads ------------------------------------------------------------

export interface BackfillTopicRow {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  description: string;
  aliases: string[];
  /** every stored TopicSpec (any developer) that produced an assessment of this topic */
  specs: TopicSpec[];
  /** id does not follow the canonical `topic:<slug>` form */
  nonCanonicalId: boolean;
}

/** Reads existing Topic nodes plus the specs that were stored with their assessments. */
export async function readTopicsForBackfill(
  graph: Graph,
): Promise<BackfillTopicRow[]> {
  await ensureDepthSchema(graph);
  const topicRows =
    (await tryRows(
      graph,
      "backfill topics",
      `
      MATCH (t:Topic)
      RETURN t.id AS id, t.slug AS slug, coalesce(t.name, "") AS name,
             t.domain AS domain, coalesce(t.description, "") AS description,
             coalesce(t.aliases_text, "") AS aliases
      ORDER BY t.id
      `,
    )) ?? [];
  const specRows =
    (await tryRows(
      graph,
      "backfill specs",
      `
      MATCH (a:DepthAssessment)-[:OF_TOPIC]->(t:Topic)
      RETURN t.id AS id, a.spec_json AS spec
      `,
    )) ?? [];

  const specsById = new Map<string, TopicSpec[]>();
  for (const r of specRows) {
    const spec = parseJson<TopicSpec | null>(r.spec, null);
    if (!spec || !spec.slug) continue;
    const list = specsById.get(str(r.id)) ?? [];
    list.push({
      ...spec,
      aliases: strList(spec.aliases),
      keywords: strList(spec.keywords),
      packages: strList(spec.packages),
      signals: strList(spec.signals),
      capabilityIds: strList(spec.capabilityIds),
      buildsOn: strList(spec.buildsOn),
      related: strList(spec.related),
      approaches: mapList(spec.approaches).map((a) => ({
        slug: str(a.slug),
        name: str(a.name),
        description: str(a.description),
        packages: strList(a.packages),
        signals: strList(a.signals),
        keywords: strList(a.keywords),
      })),
      pinnedFileIds: [],
    });
    specsById.set(str(r.id), list);
  }

  return topicRows.map((r) => {
    const id = str(r.id);
    const slug = str(r.slug) || id.replace(/^topic:/, "");
    return {
      id,
      slug,
      name: str(r.name),
      domain: r.domain == null ? null : str(r.domain),
      description: str(r.description),
      aliases: str(r.aliases)
        .split("|")
        .map((a) => a.trim())
        .filter(Boolean),
      specs: specsById.get(id) ?? [],
      nonCanonicalId: !slug || id !== topicId(slug),
    };
  });
}

// ---- developer-specific persistence ----------------------------------------------

// ---- explainable depth: dimensions, evidence quantity, confidence weight ----

/**
 * Depth, confidence and evidence quantity are three different facts and are
 * stored separately. These dimensions are INFORMATIONAL: they explain the
 * depth level (they never change the score), so Overview and Chat can say why.
 */
export interface AssessmentDimensions {
  /** 0..1: deterministic baseline score, i.e. the mechanism actually built */
  implementationComplexity: number;
  approachCoverage: { assessed: number; credible: number; ratio: number };
  /** hardening / safeguard behaviours actually observed */
  safeguards: number;
  /** distinct cited implementations (not configuration or scaffold) */
  independentImplementations: number;
  repeatedApplication: { repos: number; activeDays: number; commits: number };
  recencyDays: number | null;
}

export type EvidenceBand = "none" | "sparse" | "moderate" | "rich";

export function evidenceBandFor(files: number, commits: number): EvidenceBand {
  if (files <= 0) return "none";
  if (files < 3 || commits < 2) return "sparse";
  if (files < 15 || commits < 8) return "moderate";
  return "rich";
}

export function assessmentDimensions(
  a: DepthAssessmentRecord,
): AssessmentDimensions {
  const credible = a.approaches.filter(
    (ap) => DEPTH_RANK[ap.depth] >= DEPTH_RANK.working,
  ).length;
  const last = Date.parse(a.stats.lastSeen);
  return {
    implementationComplexity: round(
      Math.max(0, Math.min(1, a.baselineScore / 100)),
      2,
    ),
    approachCoverage: {
      assessed: a.approaches.length,
      credible,
      ratio: a.approaches.length ? round(credible / a.approaches.length, 2) : 0,
    },
    safeguards: (a.safeguards ?? []).length,
    independentImplementations: (a.implementations ?? []).length,
    repeatedApplication: {
      repos: a.stats.repos,
      activeDays: a.stats.activeDays,
      commits: a.stats.commits,
    },
    recencyDays: Number.isFinite(last)
      ? Math.max(0, Math.round((Date.now() - last) / DAY_MS))
      : null,
  };
}

const CONFIDENCE_WEIGHT: Record<Confidence, number> = {
  high: 0.85,
  medium: 0.6,
  low: 0.35,
};

const snapshotId = (dev: string, slug: string, build: string) =>
  `snap:${dev}:${slug}:${build}`;

export async function storeDepthAssessments(
  graph: Graph,
  input: StoreDepthInput,
): Promise<StoreDepthResult> {
  await ensureDepthSchema(graph);
  const { developerId, buildId } = input;
  const now = new Date().toISOString();
  const result: StoreDepthResult = {
    topics: 0,
    assessments: 0,
    approaches: 0,
    evidenceEdges: 0,
    mappings: 0,
    unresolvedMappings: [],
    relationsRequested: input.relations.length,
    relations: 0,
    rejectedRelations: [],
    orphansRemoved: { assessments: 0, approaches: 0, topics: 0 },
  };
  const list = input.assessments;

  // 1) Topic nodes (SHARED taxonomy). Metadata is validated and refreshed on
  //    every write; created_at is preserved. No developer data lands here.
  result.topics = await writeTopicMetadata(
    graph,
    list.map((a) => a.topic),
    { now },
  );

  // 1b) Topic -> Capability taxonomy mappings (SHARED, existing capabilities only).
  const mappingInputs: TopicCapabilityMapping[] = list.flatMap((a) => {
    const detailed = a.spec.capabilityMappings ?? [];
    const detailedIds = new Set(detailed.map((m) => m.id));
    return [
      ...detailed.map((m) => ({
        topicSlug: a.topic.slug,
        capabilityId: m.id,
        weight: m.weight,
        reason: m.reason,
      })),
      ...unique(a.spec.capabilityIds)
        .filter((id) => !detailedIds.has(id))
        .map((capabilityId) => ({
          topicSlug: a.topic.slug,
          capabilityId,
          weight: 0.5,
          reason: "",
        })),
    ];
  });
  const mapped = await writeTopicCapabilityMappings(graph, mappingInputs, {
    buildId,
    now,
    pruneStaleForTopics: input.pruneStaleMappings
      ? list.map((a) => a.topic.slug)
      : [],
  });
  result.mappings = mapped.written;
  result.unresolvedMappings = mapped.unresolved;

  // 2) Approach nodes + APPROACH_OF.
  const approachRows = list.flatMap((a) =>
    a.approaches.map((ap) => ({
      id: approachId(a.topic.slug, ap.slug),
      slug: ap.slug,
      name: ap.name,
      description: ap.description,
      topic_slug: a.topic.slug,
      topic_id: topicId(a.topic.slug),
    })),
  );
  result.approaches = await runCounted(
    graph,
    "Approach nodes",
    `
    UNWIND $batch AS item
    MERGE (ap:Approach {id: item.id})
    SET ap.slug = item.slug, ap.name = item.name, ap.description = item.description,
        ap.topic_slug = item.topic_slug
    WITH ap, item
    MATCH (t:Topic {id: item.topic_id})
    MERGE (ap)-[r:APPROACH_OF]->(t)
    MERGE (t)-[h:HAS_APPROACH]->(ap)
    SET h.build_id = $build_id, h.updated_at = $now
    RETURN count(r) AS n
    `,
    approachRows,
    { strict: true, params: { build_id: buildId, now } },
  );

  // 3) DepthAssessment nodes (DEVELOPER-specific; id embeds the developer id,
  //    so one developer's run can never overwrite another's record).
  result.assessments = await runCounted(
    graph,
    "DepthAssessment nodes",
    `
    UNWIND $batch AS item
    MERGE (a:DepthAssessment {id: item.id})
    SET a.developer_id = $developer_id,
        a.topic_slug = item.topic_slug,
        a.topic_id = item.topic_id,
        a.level = item.level,
        a.level_rank = item.level_rank,
        a.score = item.score,
        a.baseline_score = item.baseline_score,
        a.baseline_level = item.baseline_level,
        a.confidence = item.confidence,
        a.authenticity = item.authenticity,
        a.verdict = item.verdict,
        a.rationale = item.rationale,
        a.strengths_json = item.strengths_json,
        a.gaps_json = item.gaps_json,
        a.safeguards_json = item.safeguards_json,
        a.implementations_json = item.implementations_json,
        a.approaches_json = item.approaches_json,
        a.evidence_json = item.evidence_json,
        a.evidence_refs_json = item.evidence_refs_json,
        a.stats_json = item.stats_json,
        a.spec_json = item.spec_json,
        a.files = item.files,
        a.commits = item.commits,
        a.repos = item.repos,
        a.active_days = item.active_days,
        a.approach_count = item.approach_count,
        a.first_seen = item.first_seen,
        a.last_seen = item.last_seen,
        a.fallback = item.fallback,
        a.evidence_files = item.evidence_files,
        a.evidence_cited = item.evidence_cited,
        a.evidence_band = item.evidence_band,
        a.dimensions_json = item.dimensions_json,
        a.is_current = true,
        a.stale = false,
        a.stale_reason = "",
        a.analysis_version = $version,
        a.model = $model,
        a.build_id = $build_id,
        a.assessed_at = $now,
        a.updated_at = $now
    RETURN count(a) AS n
    `,
    list.map((a) => ({
      id: assessmentId(developerId, a.topic.slug),
      topic_slug: a.topic.slug,
      topic_id: topicId(a.topic.slug),
      level: a.level,
      level_rank: DEPTH_RANK[a.level],
      score: a.score,
      baseline_score: a.baselineScore,
      baseline_level: a.baselineLevel,
      confidence: a.confidence,
      authenticity: a.authenticity,
      verdict: a.verdict,
      rationale: a.rationale,
      strengths_json: JSON.stringify(a.strengths),
      gaps_json: JSON.stringify(a.gaps),
      safeguards_json: JSON.stringify(a.safeguards ?? []),
      implementations_json: JSON.stringify(a.implementations ?? []),
      approaches_json: JSON.stringify(a.approaches),
      evidence_json: JSON.stringify(a.evidence),
      evidence_refs_json: JSON.stringify(a.evidence.map((e) => e.key)),
      stats_json: JSON.stringify(a.stats),
      spec_json: JSON.stringify(a.spec),
      files: a.stats.files,
      commits: a.stats.commits,
      repos: a.stats.repos,
      active_days: a.stats.activeDays,
      approach_count: a.approaches.length,
      first_seen: a.stats.firstSeen,
      last_seen: a.stats.lastSeen,
      fallback: a.fallback,
      evidence_files: a.stats.files,
      evidence_cited: a.evidence.length,
      evidence_band: evidenceBandFor(a.stats.files, a.stats.commits),
      dimensions_json: JSON.stringify(assessmentDimensions(a)),
    })),
    {
      params: {
        developer_id: developerId,
        version: DEPTH_ANALYSIS_VERSION,
        model: input.model,
        build_id: buildId,
        now,
      },
      strict: true,
    },
  );

  // 4) Ownership + topic edges.
  const owner = list.map((a) => ({
    assessment_id: assessmentId(developerId, a.topic.slug),
    topic_id: topicId(a.topic.slug),
  }));
  await runCounted(
    graph,
    "ASSESSED edges",
    `
    UNWIND $batch AS item
    MATCH (d:Developer {id: $developer_id})
    MATCH (a:DepthAssessment {id: item.assessment_id})
    MERGE (d)-[r:ASSESSED]->(a)
    RETURN count(r) AS n
    `,
    owner,
    { params: { developer_id: developerId }, strict: true },
  );
  await runCounted(
    graph,
    "OF_TOPIC edges",
    `
    UNWIND $batch AS item
    MATCH (a:DepthAssessment {id: item.assessment_id})
    MATCH (t:Topic {id: item.topic_id})
    MERGE (a)-[r:OF_TOPIC]->(t)
    RETURN count(r) AS n
    `,
    owner,
    { strict: true },
  );

  // 5) USES_APPROACH (the grouping: which way did this developer do it?).
  await runCounted(
    graph,
    "USES_APPROACH edges",
    `
    UNWIND $batch AS item
    MATCH (a:DepthAssessment {id: item.assessment_id})
    MATCH (ap:Approach {id: item.approach_id})
    MERGE (a)-[r:USES_APPROACH]->(ap)
    SET r.depth = item.depth, r.depth_rank = item.depth_rank,
        r.authenticity = item.authenticity, r.is_primary = item.is_primary,
        r.files = item.files, r.commits = item.commits, r.repos = item.repos,
        r.first_seen = item.first_seen, r.last_seen = item.last_seen,
        r.how_implemented = item.how_implemented,
        r.hardening_json = item.hardening_json, r.gaps_json = item.gaps_json,
        r.build_id = $build_id
    RETURN count(r) AS n
    `,
    list.flatMap((a) =>
      a.approaches.map((ap) => ({
        assessment_id: assessmentId(developerId, a.topic.slug),
        approach_id: approachId(a.topic.slug, ap.slug),
        depth: ap.depth,
        depth_rank: DEPTH_RANK[ap.depth],
        authenticity: ap.authenticity,
        is_primary: ap.isPrimary,
        files: ap.files,
        commits: ap.commits,
        repos: ap.repos,
        first_seen: ap.firstSeen,
        last_seen: ap.lastSeen,
        how_implemented: ap.howImplemented,
        hardening_json: JSON.stringify(ap.hardening),
        gaps_json: JSON.stringify(ap.gaps),
      })),
    ),
    { params: { build_id: buildId }, strict: true },
  );

  // 6) BACKED_BY: cited evidence. Targets can vanish when the evidence graph
  //    is rebuilt, so these are non-strict; evidence_json keeps a snapshot.
  const kinds: Array<[EvidenceRef["kind"], string]> = [
    ["code", "FileChange"],
    ["demonstration", "Demonstration"],
    ["experience", "Experience"],
    ["commit", "Commit"],
  ];
  for (const [kind, label] of kinds) {
    const targets = list.flatMap((a) =>
      a.evidence
        .filter((e) => e.kind === kind)
        .map((e) => ({
          assessment_id: assessmentId(developerId, a.topic.slug),
          target_id: e.id,
          ref: e.key,
          role: kind,
        })),
    );
    if (targets.length === 0) continue;
    result.evidenceEdges += await runCounted(
      graph,
      `BACKED_BY ${label}`,
      `
      UNWIND $batch AS item
      MATCH (a:DepthAssessment {id: item.assessment_id})
      MATCH (x:${label} {id: item.target_id})
      MERGE (a)-[r:BACKED_BY]->(x)
      SET r.ref = item.ref, r.role = item.role, r.build_id = $build_id
      RETURN count(r) AS n
      `,
      targets,
      { params: { build_id: buildId } },
    );
  }

  // 6b) Explicit evidence links on the SHARED evidence side:
  //     (Demonstration)-[:EVIDENCE_FOR_TOPIC]->(Topic) and
  //     (Demonstration)-[:DEMONSTRATES_APPROACH]->(Approach). Each carries
  //     reason, confidence, source and build_id so the mapping is explainable.
  //     Only demonstrations the assessment actually cited get a link.
  const topicLinks = list.flatMap((a) =>
    a.evidence
      .filter((e) => e.kind === "demonstration")
      .map((e) => ({
        target_id: e.id,
        topic_id: topicId(a.topic.slug),
        topic_slug: a.topic.slug,
        ref: e.key,
        confidence: CONFIDENCE_WEIGHT[a.confidence],
        reason:
          `Cited in the ${a.level} assessment of ${a.topic.name}: ${e.label}`.slice(
            0,
            300,
          ),
      })),
  );
  if (topicLinks.length) {
    result.evidenceEdges += await runCounted(
      graph,
      "EVIDENCE_FOR_TOPIC",
      `
      UNWIND $batch AS item
      MATCH (x:Demonstration {id: item.target_id})
      MATCH (t:Topic {id: item.topic_id})
      MERGE (x)-[r:EVIDENCE_FOR_TOPIC {source: "depth_assessment"}]->(t)
      SET r.developer_id = $developer_id, r.topic_slug = item.topic_slug,
          r.ref = item.ref, r.reason = item.reason, r.confidence = item.confidence,
          r.source = "depth_assessment", r.build_id = $build_id, r.updated_at = $now
      RETURN count(r) AS n
      `,
      topicLinks,
      { params: { developer_id: developerId, build_id: buildId, now } },
    );
  }
  const approachLinks = list.flatMap((a) => {
    const byKey = new Map(
      a.evidence
        .filter((e) => e.kind === "demonstration")
        .map((e) => [e.key, e]),
    );
    return a.approaches.flatMap((ap) =>
      unique(ap.evidenceRefs)
        .map((key) => byKey.get(key))
        .filter((e): e is EvidenceRef => Boolean(e))
        .map((e) => ({
          target_id: e.id,
          approach_id: approachId(a.topic.slug, ap.slug),
          topic_slug: a.topic.slug,
          ref: e.key,
          confidence: CONFIDENCE_WEIGHT[a.confidence],
          reason: (ap.howImplemented || `Cited for ${ap.name}`).slice(0, 300),
        })),
    );
  });
  if (approachLinks.length) {
    result.evidenceEdges += await runCounted(
      graph,
      "DEMONSTRATES_APPROACH",
      `
      UNWIND $batch AS item
      MATCH (x:Demonstration {id: item.target_id})
      MATCH (ap:Approach {id: item.approach_id})
      MERGE (x)-[r:DEMONSTRATES_APPROACH {source: "depth_assessment"}]->(ap)
      SET r.developer_id = $developer_id, r.topic_slug = item.topic_slug,
          r.ref = item.ref, r.reason = item.reason, r.confidence = item.confidence,
          r.source = "depth_assessment", r.build_id = $build_id, r.updated_at = $now
      RETURN count(r) AS n
      `,
      approachLinks,
      { params: { developer_id: developerId, build_id: buildId, now } },
    );
  }

  // 6c) History: one immutable snapshot per developer/topic/build. Snapshots
  //     hang off Developer and Topic (not the assessment), so replacing the
  //     CURRENT assessment never deletes history.
  await runCounted(
    graph,
    "DepthSnapshot nodes",
    `
    UNWIND $batch AS item
    MERGE (s:DepthSnapshot {id: item.id})
    SET s.developer_id = $developer_id, s.topic_slug = item.topic_slug,
        s.topic_id = item.topic_id, s.level = item.level, s.level_rank = item.level_rank,
        s.score = item.score, s.confidence = item.confidence,
        s.evidence_band = item.evidence_band, s.approach_count = item.approach_count,
        s.files = item.files, s.commits = item.commits, s.last_seen = item.last_seen,
        s.build_id = $build_id, s.analysis_version = $version, s.assessed_at = $now
    WITH s, item
    MATCH (d:Developer {id: $developer_id})
    MATCH (t:Topic {id: item.topic_id})
    MERGE (d)-[:HAD_SNAPSHOT]->(s)
    MERGE (s)-[:SNAPSHOT_OF]->(t)
    RETURN count(s) AS n
    `,
    list.map((a) => ({
      id: snapshotId(developerId, a.topic.slug, buildId),
      topic_slug: a.topic.slug,
      topic_id: topicId(a.topic.slug),
      level: a.level,
      level_rank: DEPTH_RANK[a.level],
      score: a.score,
      confidence: a.confidence,
      evidence_band: evidenceBandFor(a.stats.files, a.stats.commits),
      approach_count: a.approaches.length,
      files: a.stats.files,
      commits: a.stats.commits,
      last_seen: a.stats.lastSeen,
    })),
    {
      params: {
        developer_id: developerId,
        build_id: buildId,
        version: DEPTH_ANALYSIS_VERSION,
        now,
      },
    },
  );

  // 7) Developer -> Topic roll-up for fast reads and algorithms.
  await runCounted(
    graph,
    "KNOWS_TOPIC edges",
    `
    UNWIND $batch AS item
    MATCH (d:Developer {id: $developer_id})
    MATCH (t:Topic {id: item.topic_id})
    MERGE (d)-[r:KNOWS_TOPIC]->(t)
    SET r.level = item.level, r.level_rank = item.level_rank, r.score = item.score,
        r.confidence = item.confidence, r.authenticity = item.authenticity,
        r.approach_count = item.approach_count, r.files = item.files,
        r.commits = item.commits, r.last_seen = item.last_seen,
        r.build_id = $build_id, r.updated_at = $now
    RETURN count(r) AS n
    `,
    list.map((a) => ({
      topic_id: topicId(a.topic.slug),
      level: a.level,
      level_rank: DEPTH_RANK[a.level],
      score: a.score,
      confidence: a.confidence,
      authenticity: a.authenticity,
      approach_count: a.approaches.length,
      files: a.stats.files,
      commits: a.stats.commits,
      last_seen: a.stats.lastSeen,
    })),
    {
      params: { developer_id: developerId, build_id: buildId, now },
      strict: true,
    },
  );

  // 8) Taxonomy relations (SHARED, no developer data). Validated: only edges
  //    the database accepted are counted; everything else is reported.
  const relationOutcome = await writeTopicRelations(graph, input.relations, {
    now,
    buildId,
    model: input.model,
  });
  result.relations = relationOutcome.persisted;
  result.rejectedRelations = relationOutcome.rejected;

  log("taxonomy persistence complete", {
    topics: result.topics,
    mappings: result.mappings,
    unresolvedMappings: result.unresolvedMappings.length,
    relationsRequested: result.relationsRequested,
    relationsPersisted: result.relations,
    relationsRejected: result.rejectedRelations.length,
  });

  // 9) Stale cleanup. Only after every strict write above succeeded.
  await graph.query(
    `
    MATCH (a:DepthAssessment)-[r:BACKED_BY|USES_APPROACH]->()
    WHERE a.id IN $ids AND coalesce(r.build_id, "") <> $build_id
    DELETE r
    `,
    { params: { ids: owner.map((o) => o.assessment_id), build_id: buildId } },
  );

  // Evidence links written by this pipeline for the topics in this build.
  // Links with another source (e.g. the knowledge-graph pipeline) are kept.
  await graph.query(
    `
    MATCH (x:Demonstration)-[r:EVIDENCE_FOR_TOPIC|DEMONSTRATES_APPROACH]->()
    WHERE r.developer_id = $developer_id
      AND r.source = "depth_assessment"
      AND r.topic_slug IN $slugs
      AND coalesce(r.build_id, "") <> $build_id
    DELETE r
    `,
    {
      params: {
        developer_id: developerId,
        slugs: list.map((a) => a.topic.slug),
        build_id: buildId,
      },
    },
  );

  if (input.replaceAll) {
    await graph.query(
      `
      MATCH (d:Developer {id: $developer_id})-[:ASSESSED]->(a:DepthAssessment)
      WHERE coalesce(a.build_id, "") <> $build_id
      DETACH DELETE a
      `,
      { params: { developer_id: developerId, build_id: buildId } },
    );
    await graph.query(
      `
      MATCH (d:Developer {id: $developer_id})-[k:KNOWS_TOPIC]->(:Topic)
      WHERE coalesce(k.build_id, "") <> $build_id
      DELETE k
      `,
      { params: { developer_id: developerId, build_id: buildId } },
    );
  }

  // 10) Orphan cleanup: assessments / approaches / topics that lost their anchor.
  result.orphansRemoved = await cleanupOrphans(graph);

  log("depth assessments stored", result as unknown as Row);
  return result;
}

export interface DepthProfileSummary {
  headline: string;
  pattern: string;
  strongest: Array<{
    slug: string;
    name: string;
    level: DepthLevel;
    score: number;
  }>;
  broadButShallow: Array<{ slug: string; name: string }>;
  deepening: Array<{ slug: string; name: string; why: string }>;
  generatedBy: "llm" | "deterministic";
}

export async function storeDepthProfileSummary(
  graph: Graph,
  developerId: string,
  summary: DepthProfileSummary,
): Promise<void> {
  await graph.query(
    `
    MATCH (d:Developer {id: $dev})
    SET d.topic_depth_summary_json = $summary, d.topic_depth_updated_at = $now
    `,
    {
      params: {
        dev: developerId,
        summary: JSON.stringify(summary),
        now: new Date().toISOString(),
      },
    },
  );
}

// ---- orphan handling ---------------------------------------------------------

export interface OrphanReport {
  /** Topics no assessment points at */
  topicsWithoutAssessment: string[];
  /** Topics with no BUILDS_ON / RELATED_TOPIC edge in either direction */
  topicsWithoutRelations: string[];
  /** Topics with no MAPS_TO -> Capability edge */
  topicsWithoutCapability: string[];
  assessmentsWithoutTopic: number;
  approachesWithoutTopic: number;
}

export async function readOrphanReport(graph: Graph): Promise<OrphanReport> {
  const slugs = async (label: string, query: string): Promise<string[]> =>
    ((await tryRows(graph, label, query)) ?? [])
      .map((r) => str(r.slug))
      .filter(Boolean);
  const count = async (label: string, query: string): Promise<number> =>
    num(((await tryRows(graph, label, query)) ?? [])[0]?.n);

  const [noAssessment, noRelations, noCapability, badAssess, badApproach] =
    await Promise.all([
      slugs(
        "topics without assessment",
        `MATCH (t:Topic) WHERE NOT ()-[:OF_TOPIC]->(t) RETURN t.slug AS slug LIMIT 500`,
      ),
      slugs(
        "topics without relations",
        `MATCH (t:Topic)
         WHERE NOT (t)-[:BUILDS_ON]-() AND NOT (t)-[:RELATED_TOPIC]-()
         RETURN t.slug AS slug LIMIT 500`,
      ),
      slugs(
        "topics without capability",
        `MATCH (t:Topic) WHERE NOT (t)-[:MAPS_TO]->(:Capability) RETURN t.slug AS slug LIMIT 500`,
      ),
      count(
        "assessments without topic",
        `MATCH (a:DepthAssessment) WHERE NOT (a)-[:OF_TOPIC]->(:Topic) RETURN count(a) AS n`,
      ),
      count(
        "approaches without topic",
        `MATCH (ap:Approach) WHERE NOT (ap)-[:APPROACH_OF]->(:Topic) RETURN count(ap) AS n`,
      ),
    ]);

  return {
    topicsWithoutAssessment: noAssessment,
    topicsWithoutRelations: noRelations,
    topicsWithoutCapability: noCapability,
    assessmentsWithoutTopic: badAssess,
    approachesWithoutTopic: badApproach,
  };
}

async function deleteWhere(
  graph: Graph,
  label: string,
  match: string,
): Promise<number> {
  const found = await tryRows(
    graph,
    `count ${label}`,
    `${match} RETURN count(x) AS n`,
  );
  const n = num(found?.[0]?.n);
  if (n > 0)
    await tryRows(graph, `delete ${label}`, `${match} DETACH DELETE x`);
  return n;
}

/**
 * Removes nodes that lost their anchor. Order matters: assessments first
 * (they hold Approach/Topic references), then approaches, then topics.
 * A Topic survives when ANY assessment, KNOWS_TOPIC, taxonomy edge or
 * MAPS_TO edge still points at it, so curated taxonomy is never deleted.
 */
export async function cleanupOrphans(graph: Graph): Promise<{
  assessments: number;
  approaches: number;
  topics: number;
}> {
  const assessments = await deleteWhere(
    graph,
    "orphan assessments",
    `MATCH (x:DepthAssessment)
     WHERE NOT ()-[:ASSESSED]->(x) OR NOT (x)-[:OF_TOPIC]->(:Topic)`,
  );
  const approaches = await deleteWhere(
    graph,
    "orphan approaches",
    `MATCH (x:Approach)
     WHERE NOT (x)<-[:USES_APPROACH]-(:DepthAssessment)
        OR NOT (x)-[:APPROACH_OF]->(:Topic)`,
  );
  const topics = await deleteWhere(
    graph,
    "orphan topics",
    `MATCH (x:Topic)
     WHERE NOT ()-[:OF_TOPIC]->(x)
       AND NOT ()-[:KNOWS_TOPIC]->(x)
       AND NOT ()-[:SNAPSHOT_OF]->(x)
       AND NOT (x)-[:BUILDS_ON]-()
       AND NOT (x)-[:RELATED_TOPIC]-()
       AND NOT (x)-[:MAPS_TO]->()`,
  );
  if (assessments || approaches || topics) {
    log("orphans removed", { assessments, approaches, topics });
  }
  if (topics) invalidateTaxonomyCache(graph);
  return { assessments, approaches, topics };
}

// ============================================================
// 5. READ API
// ============================================================

export interface TopicDepthSummary {
  slug: string;
  name: string;
  domain: string;
  level: DepthLevel;
  score: number;
  baselineScore: number;
  confidence: Confidence;
  authenticity: Authenticity;
  verdict: string;
  files: number;
  commits: number;
  repos: number;
  activeDays: number;
  firstSeen: string;
  lastSeen: string;
  foundationRank: number | null;
  clusterId: number | null;
  fallback: boolean;
  approaches: Array<{
    slug: string;
    name: string;
    depth: DepthLevel;
    authenticity: Authenticity;
    isPrimary: boolean;
    files: number;
    commits: number;
    howImplemented: string;
  }>;
}

export interface DeveloperTopicProfile {
  developerId: string;
  topics: TopicDepthSummary[];
  domains: Array<{
    domain: string;
    topics: number;
    bestLevel: DepthLevel;
    averageScore: number;
  }>;
  clusters: Array<{ clusterId: number; topics: string[] }>;
  summary: DepthProfileSummary | null;
}

export async function readDeveloperTopicProfile(
  graph: Graph,
  developerId: string,
): Promise<DeveloperTopicProfile> {
  const [topicRows, approachRows, summaryRows] = await Promise.all([
    tryRows(
      graph,
      "topic profile",
      `
      MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment)-[:OF_TOPIC]->(t:Topic)
      RETURN t.slug AS slug, t.name AS name, coalesce(t.domain, "") AS domain,
             t.foundation_rank AS foundation_rank, t.cluster_id AS cluster_id,
             a.level AS level, a.score AS score, a.baseline_score AS baseline_score,
             a.confidence AS confidence, a.authenticity AS authenticity,
             coalesce(a.verdict, "") AS verdict, coalesce(a.files, 0) AS files,
             coalesce(a.commits, 0) AS commits, coalesce(a.repos, 0) AS repos,
             coalesce(a.active_days, 0) AS active_days,
             coalesce(a.first_seen, "") AS first_seen, coalesce(a.last_seen, "") AS last_seen,
             coalesce(a.fallback, false) AS fallback
      ORDER BY t.name
      `,
      { dev: developerId },
    ),
    tryRows(
      graph,
      "topic approaches",
      `
      MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment)-[u:USES_APPROACH]->(ap:Approach)
      RETURN a.topic_slug AS topic_slug, ap.slug AS slug, ap.name AS name,
             u.depth AS depth, u.authenticity AS authenticity, u.is_primary AS is_primary,
             coalesce(u.files, 0) AS files, coalesce(u.commits, 0) AS commits,
             coalesce(u.how_implemented, "") AS how
      ORDER BY u.depth_rank DESC, files DESC
      `,
      { dev: developerId },
    ),
    tryRows(
      graph,
      "depth summary",
      `MATCH (d:Developer {id: $dev}) RETURN d.topic_depth_summary_json AS summary LIMIT 1`,
      { dev: developerId },
    ),
  ]);

  const byTopic = new Map<string, TopicDepthSummary["approaches"]>();
  for (const r of approachRows ?? []) {
    const list = byTopic.get(str(r.topic_slug)) ?? [];
    list.push({
      slug: str(r.slug),
      name: str(r.name),
      depth: asDepthLevel(r.depth),
      authenticity: asAuthenticity(r.authenticity),
      isPrimary: bool(r.is_primary),
      files: num(r.files),
      commits: num(r.commits),
      howImplemented: str(r.how),
    });
    byTopic.set(str(r.topic_slug), list);
  }

  const topics: TopicDepthSummary[] = (topicRows ?? []).map((r) => ({
    slug: str(r.slug),
    name: str(r.name),
    domain: str(r.domain),
    level: asDepthLevel(r.level),
    score: num(r.score),
    baselineScore: num(r.baseline_score),
    confidence: asConfidence(r.confidence),
    authenticity: asAuthenticity(r.authenticity),
    verdict: str(r.verdict),
    files: num(r.files),
    commits: num(r.commits),
    repos: num(r.repos),
    activeDays: num(r.active_days),
    firstSeen: str(r.first_seen),
    lastSeen: str(r.last_seen),
    foundationRank: r.foundation_rank == null ? null : num(r.foundation_rank),
    clusterId: r.cluster_id == null ? null : num(r.cluster_id),
    fallback: bool(r.fallback),
    approaches: byTopic.get(str(r.slug)) ?? [],
  }));

  const domainMap = new Map<string, TopicDepthSummary[]>();
  for (const t of topics) {
    const key = t.domain || "other";
    domainMap.set(key, [...(domainMap.get(key) ?? []), t]);
  }
  const domains = [...domainMap.entries()]
    .map(([domain, list]) => ({
      domain,
      topics: list.length,
      bestLevel: list.reduce<DepthLevel>(
        (best, t) => (DEPTH_RANK[t.level] > DEPTH_RANK[best] ? t.level : best),
        "none",
      ),
      averageScore: Math.round(
        list.reduce((n, t) => n + t.score, 0) / list.length,
      ),
    }))
    .sort((a, b) => b.averageScore - a.averageScore);

  const clusterMap = new Map<number, string[]>();
  for (const t of topics) {
    if (t.clusterId == null) continue;
    clusterMap.set(t.clusterId, [
      ...(clusterMap.get(t.clusterId) ?? []),
      t.name,
    ]);
  }

  const summary = parseJson<DepthProfileSummary | null>(
    summaryRows?.[0]?.summary,
    null,
  );

  return {
    developerId,
    topics,
    domains,
    clusters: [...clusterMap.entries()]
      .map(([clusterId, names]) => ({ clusterId, topics: names }))
      .filter((c) => c.topics.length > 1),
    summary,
  };
}

export interface TopicDepthDetail {
  summary: TopicDepthSummary;
  rationale: string;
  strengths: string[];
  gaps: string[];
  safeguards: string[];
  implementations: ImplementationNote[];
  approaches: ApproachRecord[];
  evidence: EvidenceRef[];
  stats: EvidenceTotals | null;
  baselineLevel: DepthLevel;
  context: TopicContext | null;
  /** topics that build on this one, each with the reason the edge exists */
  unlocks: Array<{
    slug: string;
    name: string;
    reason: string;
    confidence: number;
    strength: RelationStrength;
  }>;
  related: Array<{
    slug: string;
    name: string;
    reason: string;
    confidence: number;
  }>;
  /** taxonomy capabilities of the topic with weights, reasons and THIS developer's demonstration counts */
  capabilityPaths: TopicEvidencePath[];
  /** full prerequisite / unlock traversal with developer depth and evidence */
  learning: TopicLearningGraph | null;
  /** depth, confidence and evidence quantity are reported separately */
  confidence: Confidence;
  evidenceBand: EvidenceBand;
  evidenceFiles: number;
  dimensions: AssessmentDimensions | null;
  /** per approach: depth plus the demonstrations linked via DEMONSTRATES_APPROACH */
  approachEvidence: Array<{
    slug: string;
    name: string;
    depth: DepthLevel;
    demonstrationIds: string[];
  }>;
  /** one entry per analysed build, newest first */
  history: Array<{
    buildId: string;
    level: DepthLevel;
    score: number;
    confidence: Confidence;
    evidenceBand: string;
    approachCount: number;
    files: number;
    commits: number;
    assessedAt: string;
  }>;
}

export async function readTopicDepthDetail(
  graph: Graph,
  developerId: string,
  slug: string,
): Promise<TopicDepthDetail | null> {
  const profile = await readDeveloperTopicProfile(graph, developerId);
  const summary = profile.topics.find((t) => t.slug === slug);
  if (!summary) return null;

  // unlocks / related come from the cached taxonomy: no extra queries
  const [
    rowsA,
    buildEdges,
    relatedEdges,
    meta,
    context,
    capabilityPaths,
    learning,
  ] = await Promise.all([
    tryRows(
      graph,
      "assessment detail",
      `
      MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment {topic_slug: $slug})
      RETURN a.rationale AS rationale, a.strengths_json AS strengths, a.gaps_json AS gaps,
             a.safeguards_json AS safeguards, a.implementations_json AS implementations,
             a.approaches_json AS approaches, a.evidence_json AS evidence,
             a.stats_json AS stats, a.baseline_level AS baseline_level,
             a.confidence AS confidence, a.evidence_band AS evidence_band,
             a.evidence_files AS evidence_files, a.dimensions_json AS dimensions
      LIMIT 1
      `,
      { dev: developerId, slug },
    ),
    readTaxonomyEdges(graph, "BUILDS_ON"),
    readTaxonomyEdges(graph, "RELATED_TOPIC"),
    readTopicMeta(graph),
    readTopicContext(graph, developerId, slug),
    readTopicEvidenceTraversal(graph, developerId, slug),
    readTopicLearningGraph(graph, developerId, slug),
  ]);

  const nameOf = (s: string) => meta.get(s)?.name ?? s;
  const unlocks = buildEdges
    .filter((e) => e.to === slug)
    .map((e) => ({
      slug: e.from,
      name: nameOf(e.from),
      reason: e.reason,
      confidence: round(e.confidence, 2),
      strength: e.strength,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 12);
  const related = relatedEdges
    .filter((e) => e.from === slug)
    .map((e) => ({
      slug: e.to,
      name: nameOf(e.to),
      reason: e.reason,
      confidence: round(e.confidence, 2),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 12);

  const [historyRows, approachRows] = await Promise.all([
    tryRows(
      graph,
      "topic history",
      `
      MATCH (:Developer {id: $dev})-[:HAD_SNAPSHOT]->(s:DepthSnapshot {topic_slug: $slug})
      RETURN s.build_id AS build_id, s.level AS level, s.score AS score,
             s.confidence AS confidence, s.evidence_band AS evidence_band,
             s.approach_count AS approach_count, s.files AS files,
             s.commits AS commits, s.assessed_at AS assessed_at
      ORDER BY s.assessed_at DESC
      LIMIT 20
      `,
      { dev: developerId, slug },
    ),
    tryRows(
      graph,
      "approach evidence",
      `
      MATCH (:Developer {id: $dev})-[:ASSESSED]->(:DepthAssessment {topic_slug: $slug})
            -[u:USES_APPROACH]->(ap:Approach)
      OPTIONAL MATCH (x:Demonstration)-[r:DEMONSTRATES_APPROACH]->(ap)
        WHERE r.developer_id = $dev
      RETURN ap.slug AS slug, ap.name AS name, u.depth AS depth,
             collect(DISTINCT x.id) AS demo_ids
      `,
      { dev: developerId, slug },
    ),
  ]);

  const a = rowsA?.[0] ?? {};
  return {
    confidence: asConfidence(a.confidence),
    evidenceBand: str(a.evidence_band, "none") as EvidenceBand,
    evidenceFiles: num(a.evidence_files),
    dimensions: parseJson<AssessmentDimensions | null>(a.dimensions, null),
    approachEvidence: (approachRows ?? []).map((r) => ({
      slug: str(r.slug),
      name: str(r.name),
      depth: asDepthLevel(r.depth),
      demonstrationIds: strList(r.demo_ids).filter(Boolean),
    })),
    history: (historyRows ?? []).map((r) => ({
      buildId: str(r.build_id),
      level: asDepthLevel(r.level),
      score: num(r.score),
      confidence: asConfidence(r.confidence),
      evidenceBand: str(r.evidence_band),
      approachCount: num(r.approach_count),
      files: num(r.files),
      commits: num(r.commits),
      assessedAt: str(r.assessed_at),
    })),
    summary,
    rationale: str(a.rationale),
    strengths: parseJson<string[]>(a.strengths, []),
    gaps: parseJson<string[]>(a.gaps, []),
    safeguards: parseJson<string[]>(a.safeguards, []),
    implementations: parseJson<ImplementationNote[]>(a.implementations, []),
    approaches: parseJson<ApproachRecord[]>(a.approaches, []),
    evidence: parseJson<EvidenceRef[]>(a.evidence, []),
    stats: parseJson<EvidenceTotals | null>(a.stats, null),
    baselineLevel: asDepthLevel(a.baseline_level),
    context,
    unlocks,
    related,
    capabilityPaths,
    learning,
  };
}

/** The TopicSpec that produced a stored assessment, for incremental re-analysis. */
export async function readStoredTopicSpec(
  graph: Graph,
  developerId: string,
  slug: string,
): Promise<TopicSpec | null> {
  const result = await tryRows(
    graph,
    "stored topic spec",
    `
    MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment {topic_slug: $slug})
    RETURN a.spec_json AS spec LIMIT 1
    `,
    { dev: developerId, slug },
  );
  const spec = parseJson<TopicSpec | null>(result?.[0]?.spec, null);
  return spec && spec.slug ? spec : null;
}

// ============================================================
// DEVELOPER KNOWLEDGE SUBGRAPH (graph-first foundation)
// ============================================================

/**
 * A persisted, evidence-linked slice of the developer's existing FalkorDB graph.
 * This deliberately returns existing graph entities and relationships instead
 * of rebuilding a second evidence graph from every FileChange in TypeScript.
 */
export interface DeveloperKnowledgeNode {
  id: string;
  label: string;
  name: string;
  properties: Row;
}

export interface DeveloperKnowledgeEdge {
  from: string;
  to: string;
  type: string;
  properties: Row;
}

export interface DeveloperKnowledgeGraph {
  developerId: string;
  nodes: DeveloperKnowledgeNode[];
  edges: DeveloperKnowledgeEdge[];
  counts: { nodes: number; edges: number; evidenceNodes: number };
}

/**
 * Reads a bounded multi-hop neighborhood around the developer from FalkorDB.
 *
 * The traversal includes implementation evidence, demonstrated capabilities,
 * techniques, safeguards, experiences, repositories, technologies, and topic
 * relationships. It uses the existing graph as the source of truth and keeps
 * the actual relationship type/properties so callers can explain *why* two
 * concepts are connected. The limit is intentionally applied in the database.
 */
export async function readDeveloperKnowledgeGraph(
  graph: Graph,
  developerId: string,
  options: { maxNodes?: number; maxHops?: number } = {},
): Promise<DeveloperKnowledgeGraph | null> {
  const maxNodes = Math.max(
    25,
    Math.min(1500, Math.floor(options.maxNodes ?? 500)),
  );
  // FalkorDB variable-length paths are bounded here to prevent accidental
  // graph-wide traversal. Keep this a literal because it is query syntax.
  const maxHops = Math.max(1, Math.min(3, Math.floor(options.maxHops ?? 3)));

  const exists = await tryRows(
    graph,
    "knowledge graph developer exists",
    `MATCH (d:Developer {id: $dev}) RETURN d.id AS id LIMIT 1`,
    { dev: developerId },
  );
  if (!exists?.length) return null;

  // Separate, bounded relationship queries are more robust than assuming every
  // optional label/relationship exists in every developer's graph build.
  const hopPattern = `-[*1..${maxHops}]-`;
  const nodeRows = await tryRows(
    graph,
    "developer knowledge graph nodes",
    `
    MATCH (d:Developer {id: $dev})${hopPattern}(n)
    WITH DISTINCT n LIMIT ${maxNodes}
    RETURN labels(n) AS labels,
           coalesce(n.id, n.slug, n.topic_slug, n.name, toString(ID(n))) AS id,
           coalesce(n.name, n.title, n.technique, n.summary, n.slug, n.topic_slug, "") AS name,
           properties(n) AS properties
    `,
    { dev: developerId },
  );
  if (!nodeRows) return null;

  const edgeRows = await tryRows(
    graph,
    "developer knowledge graph edges",
    `
    MATCH (d:Developer {id: $dev})${hopPattern}(a)-[r]-(b)
    WITH DISTINCT a, r, b LIMIT ${maxNodes * 3}
    RETURN coalesce(a.id, a.slug, a.topic_slug, a.name, toString(ID(a))) AS from_id,
           coalesce(b.id, b.slug, b.topic_slug, b.name, toString(ID(b))) AS to_id,
           type(r) AS type, properties(r) AS properties
    `,
    { dev: developerId },
  );

  const nodes: DeveloperKnowledgeNode[] = nodeRows.map((r) => {
    const labels = strList(r.labels);
    const properties =
      r.properties && typeof r.properties === "object"
        ? (r.properties as Row)
        : {};
    return {
      id: str(r.id),
      label: labels[0] ?? "Unknown",
      name: str(r.name),
      properties,
    };
  });
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: DeveloperKnowledgeEdge[] = (edgeRows ?? [])
    .map((r) => ({
      from: str(r.from_id),
      to: str(r.to_id),
      type: str(r.type),
      properties:
        r.properties && typeof r.properties === "object"
          ? (r.properties as Row)
          : {},
    }))
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  const evidenceLabels = new Set([
    "FileChange",
    "Commit",
    "Demonstration",
    "PullRequest",
    "Issue",
    "Experience",
    "Safeguard",
    "TechniqueSpec",
  ]);
  return {
    developerId,
    nodes,
    edges,
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      evidenceNodes: nodes.filter((n) => evidenceLabels.has(n.label)).length,
    },
  };
}

/**
 * Returns concrete evidence paths for one topic without treating Topic->MAPS_TO
 * as proof of skill. Mapping edges only select candidate capabilities; actual
 * evidence must still be connected to the developer through Demonstration,
 * Experience, Commit, FileChange, or an authored-code relationship.
 */
export async function readDeveloperTopicEvidenceGraph(
  graph: Graph,
  developerId: string,
  topicSlug: string,
  options: { limit?: number } = {},
): Promise<DeveloperKnowledgeGraph | null> {
  const limit = Math.max(10, Math.min(500, Math.floor(options.limit ?? 100)));
  const result = await tryRows(
    graph,
    "developer topic evidence graph",
    `
    MATCH (d:Developer {id: $dev})
    MATCH (t:Topic {slug: $slug})
    OPTIONAL MATCH (t)-[:MAPS_TO]->(c:Capability)
    WITH d, t, collect(DISTINCT c.id) AS capabilityIds
    MATCH (d)-[r1]-(e)
    WHERE (e:Demonstration AND EXISTS {
      MATCH (e)-[:OF_CAPABILITY]->(c2:Capability)
      WHERE c2.id IN capabilityIds
    })
       OR (e:Experience AND (e.capability_id IN capabilityIds OR
           toLower(coalesce(e.technique, "")) CONTAINS toLower($slug) OR
           toLower(coalesce(e.summary, "")) CONTAINS toLower($slug)))
       OR (e:DepthAssessment AND e.topic_slug = $slug)
    WITH d, t, e, r1 LIMIT ${limit}
    OPTIONAL MATCH (e)-[r2]-(support)
    WHERE support:Commit OR support:FileChange OR support:Repository
       OR support:TechniqueSpec OR support:Safeguard OR support:Technology
       OR support:EngineeringContext OR support:Problem OR support:Approach
    RETURN labels(e) AS evidence_labels,
           coalesce(e.id, e.topic_slug, toString(ID(e))) AS evidence_id,
           coalesce(e.name, e.technique, e.summary, e.title, "") AS evidence_name,
           type(r1) AS developer_relation,
           labels(support) AS support_labels,
           coalesce(support.id, support.slug, support.name, toString(ID(support))) AS support_id,
           coalesce(support.name, support.path, support.technique, support.summary, "") AS support_name,
           type(r2) AS support_relation,
           properties(e) AS evidence_properties,
           properties(support) AS support_properties
    LIMIT ${limit}
    `,
    { dev: developerId, slug: topicSlug },
  );
  if (!result) return null;

  const nodeMap = new Map<string, DeveloperKnowledgeNode>();
  const edges: DeveloperKnowledgeEdge[] = [];
  for (const row of result) {
    const evidenceId = str(row.evidence_id);
    if (evidenceId)
      nodeMap.set(evidenceId, {
        id: evidenceId,
        label: strList(row.evidence_labels)[0] ?? "Evidence",
        name: str(row.evidence_name),
        properties:
          row.evidence_properties && typeof row.evidence_properties === "object"
            ? (row.evidence_properties as Row)
            : {},
      });
    const supportId = str(row.support_id);
    if (supportId) {
      nodeMap.set(supportId, {
        id: supportId,
        label: strList(row.support_labels)[0] ?? "Evidence",
        name: str(row.support_name),
        properties:
          row.support_properties && typeof row.support_properties === "object"
            ? (row.support_properties as Row)
            : {},
      });
      if (evidenceId)
        edges.push({
          from: evidenceId,
          to: supportId,
          type: str(row.support_relation),
          properties: {},
        });
    }
    if (evidenceId)
      edges.push({
        from: developerId,
        to: evidenceId,
        type: str(row.developer_relation),
        properties: {},
      });
  }
  const nodes = [...nodeMap.values()];
  return {
    developerId,
    nodes,
    edges,
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      evidenceNodes: nodes.filter((n) =>
        [
          "Demonstration",
          "Experience",
          "DepthAssessment",
          "Commit",
          "FileChange",
          "PullRequest",
        ].includes(n.label),
      ).length,
    },
  };
}
// ============================================================
// TOPIC GRAPH EVIDENCE: everything shown as nodes + edges + hops
// ============================================================

export type EvidenceNodeKind =
  | "topic"
  | "capability"
  | "demonstration"
  | "experience"
  | "repository"
  | "topic_neighbor";

export interface EvidenceGraphNode {
  id: string;
  kind: EvidenceNodeKind;
  label: string;
  hop: number;
  meta: Row;
}
export interface EvidenceGraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  hop: number;
  note: string;
}
export interface TopicBuild {
  id: string;
  kind: "mission" | "build";
  title: string;
  technique: string;
  depth: string;
  repository: string;
  path: string;
  permalink: string;
  commitSubject: string;
  createdAt: string;
  capabilityId: string;
  capability: string;
  /** node ids on the route from the topic to this build */
  routeIds: string[];
  /** the same route as readable edges */
  route: Array<{ from: string; type: string; to: string }>;
}
export interface TopicGraphTraceStep {
  name: string;
  pattern: string;
  algorithm: string;
  rows: number;
  ms: number;
}
export interface TopicGraphEvidence {
  slug: string;
  nodes: EvidenceGraphNode[];
  edges: EvidenceGraphEdge[];
  hopCounts: Record<number, number>;
  maxHop: number;
  builds: TopicBuild[];
  buildTotals: { missions: number; builds: number };
  backedBy: Array<{ kind: string; count: number }>;
  metrics: {
    foundationRank: number | null;
    bridgeScore: number | null;
    clusterId: number | null;
    clusterSize: number;
    componentId: number | null;
    componentSize: number;
  };
  reach: {
    prerequisites: number;
    unlocks: number;
    related: number;
    maxPrereqHop: number;
  };
  trace: TopicGraphTraceStep[];
}

export async function readTopicGraphEvidence(
  graph: Graph,
  developerId: string,
  slug: string,
): Promise<TopicGraphEvidence | null> {
  await ensureDepthSchema(graph);
  const meta = await readTopicMeta(graph);
  const head = meta.get(slug);
  if (!head) return null;

  const trace: TopicGraphTraceStep[] = [];
  const timed = async (
    name: string,
    pattern: string,
    algorithm: string,
    query: string,
    params: Row,
  ): Promise<Row[]> => {
    const t0 = Date.now();
    const r = (await tryRows(graph, name, query, params)) ?? [];
    trace.push({
      name,
      pattern,
      algorithm,
      rows: r.length,
      ms: Date.now() - t0,
    });
    return r;
  };

  const nodes = new Map<string, EvidenceGraphNode>();
  const edges = new Map<string, EvidenceGraphEdge>();
  const node = (
    id: string,
    kind: EvidenceNodeKind,
    label: string,
    hop: number,
    m: Row = {},
  ) => {
    const prev = nodes.get(id);
    if (!prev || hop < prev.hop)
      nodes.set(id, { id, kind, label, hop, meta: m });
  };
  const edge = (
    source: string,
    target: string,
    type: string,
    hop: number,
    note = "",
  ) => {
    const id = `${source}|${type}|${target}`;
    if (!edges.has(id)) edges.set(id, { id, source, target, type, hop, note });
  };

  const topicNode = `topic:${slug}`;
  node(topicNode, "topic", head.name, 0, { slug, domain: head.domain });

  // 1. Topic -MAPS_TO-> Capability
  const capRows = await timed(
    "Topic to capabilities",
    "(Topic)-[:MAPS_TO]->(Capability)",
    "1-hop traversal",
    `MATCH (t:Topic {slug: $slug})-[m:MAPS_TO]->(c:Capability)
     RETURN c.id AS id, coalesce(c.name, "") AS name, m.weight AS weight, coalesce(m.reason, "") AS reason`,
    { slug },
  );
  const capName = new Map<string, string>();
  for (const r of capRows) {
    const id = str(r.id);
    capName.set(id, str(r.name) || id);
    node(`cap:${id}`, "capability", str(r.name) || id, 1, {
      weight: r.weight == null ? null : round(num(r.weight), 2),
    });
    edge(topicNode, `cap:${id}`, "MAPS_TO", 1, str(r.reason));
  }

  // 2. Capability <-OF_CAPABILITY- Demonstration -IN_REPOSITORY-> Repository
  const demoRows = await timed(
    "Developer demonstrations for the topic",
    "(Developer)-[:DEMONSTRATED]->(Demonstration)-[:OF_CAPABILITY]->(Capability)<-[:MAPS_TO]-(Topic)",
    "3-hop traversal anchored on Developer and Topic",
    `
    MATCH (:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability)<-[:MAPS_TO]-(:Topic {slug: $slug})
    OPTIONAL MATCH (x)-[:IN_REPOSITORY]->(r:Repository)
    RETURN x.id AS id, c.id AS capability_id,
           coalesce(x.source, "") AS source,
           coalesce(x.mission_title, x.technique, "") AS title,
           coalesce(x.technique, "") AS technique,
           coalesce(x.depth, "usage") AS depth,
           coalesce(x.depth_rank, 1) AS depth_rank,
           coalesce(r.full_name, r.name, "") AS repository,
           coalesce(x.path, "") AS path,
           coalesce(x.permalink, "") AS permalink,
           coalesce(x.commit_subject, "") AS commit_subject,
           coalesce(x.created_at, "") AS created_at
    ORDER BY created_at DESC
    LIMIT 60
    `,
    { dev: developerId, slug },
  );
  const missions = demoRows.filter((r) => str(r.source) === "mission");
  const others = demoRows
    .filter((r) => str(r.source) !== "mission")
    .sort(
      (a, b) =>
        num(b.depth_rank) - num(a.depth_rank) ||
        str(b.created_at).localeCompare(str(a.created_at)),
    );
  const shown = [
    ...missions.slice(0, 4),
    ...others.slice(0, 8 - Math.min(4, missions.length)),
  ];

  const builds: TopicBuild[] = [];
  for (const r of shown) {
    const id = str(r.id);
    const capId = str(r.capability_id);
    const isMission = str(r.source) === "mission";
    const repo = str(r.repository);
    const label = cut80(str(r.title) || str(r.technique) || "demonstration");
    node(`demo:${id}`, "demonstration", label, 2, {
      mission: isMission,
      depth: str(r.depth),
    });
    edge(`demo:${id}`, `cap:${capId}`, "OF_CAPABILITY", 2);
    const routeIds = [topicNode, `cap:${capId}`, `demo:${id}`];
    const route = [
      { from: head.name, type: "MAPS_TO", to: capName.get(capId) ?? capId },
      { from: label, type: "OF_CAPABILITY", to: capName.get(capId) ?? capId },
    ];
    if (repo) {
      node(`repo:${repo}`, "repository", repo, 3);
      edge(`demo:${id}`, `repo:${repo}`, "IN_REPOSITORY", 3);
      routeIds.push(`repo:${repo}`);
      route.push({ from: label, type: "IN_REPOSITORY", to: repo });
    }
    builds.push({
      id,
      kind: isMission ? "mission" : "build",
      title: label,
      technique: str(r.technique),
      depth: str(r.depth),
      repository: repo,
      path: str(r.path),
      permalink: str(r.permalink),
      commitSubject: str(r.commit_subject),
      createdAt: str(r.created_at),
      capabilityId: capId,
      capability: capName.get(capId) ?? capId,
      routeIds,
      route,
    });
  }
  builds.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // 3. Experience -DEMONSTRATES_CAPABILITY-> Capability
  const expRows = await timed(
    "Developer experiences for the topic",
    "(Developer)-[:EXPERIENCED]->(Experience)-[:DEMONSTRATES_CAPABILITY]->(Capability)<-[:MAPS_TO]-(Topic)",
    "3-hop traversal",
    `
    MATCH (:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)-[:DEMONSTRATES_CAPABILITY]->(c:Capability)<-[:MAPS_TO]-(:Topic {slug: $slug})
    RETURN e.id AS id, coalesce(e.technique, "") AS technique, c.id AS capability_id,
           coalesce(e.evidence_count, 0) AS evidence
    ORDER BY evidence DESC
    LIMIT 5
    `,
    { dev: developerId, slug },
  );
  for (const r of expRows) {
    const id = str(r.id);
    node(`exp:${id}`, "experience", cut80(str(r.technique)), 2, {
      evidence: num(r.evidence),
    });
    edge(
      `exp:${id}`,
      `cap:${str(r.capability_id)}`,
      "DEMONSTRATES_CAPABILITY",
      2,
    );
  }

  // 4. Topic taxonomy: BUILDS_ON*1..3 out, *1..2 in, RELATED_TOPIC
  const t0 = Date.now();
  const [buildEdges, relatedEdges] = await Promise.all([
    readTaxonomyEdges(graph, "BUILDS_ON"),
    readTaxonomyEdges(graph, "RELATED_TOPIC"),
  ]);
  const prereq = walkBuildsOn(buildEdges, "out", slug, 3);
  const unlocks = walkBuildsOn(buildEdges, "in", slug, 2);
  const related = relatedEdges.filter((e) => e.from === slug).slice(0, 8);
  trace.push({
    name: "Topic taxonomy walk",
    pattern:
      "(Topic)-[:BUILDS_ON*1..3]->(Topic); (Topic)<-[:BUILDS_ON*1..2]-(Topic); (Topic)-[:RELATED_TOPIC]->(Topic)",
    algorithm: "Variable-length BFS (breadth-first walk)",
    rows: prereq.length + unlocks.length + related.length,
    ms: Date.now() - t0,
  });
  const nodeFor = (s: string, hop: number) =>
    node(`tn:${s}`, "topic_neighbor", meta.get(s)?.name ?? s, hop, { slug: s });
  for (const n of prereq) {
    nodeFor(n.slug, n.hops);
    const prev = n.via.length > 1 ? `tn:${n.via[n.via.length - 2]}` : topicNode;
    edge(prev, `tn:${n.slug}`, "BUILDS_ON", n.hops, n.edge.reason);
  }
  for (const n of unlocks) {
    nodeFor(n.slug, n.hops);
    const next = n.via.length > 1 ? `tn:${n.via[n.via.length - 2]}` : topicNode;
    edge(`tn:${n.slug}`, next, "BUILDS_ON", n.hops, n.edge.reason);
  }
  for (const e of related) {
    nodeFor(e.to, 1);
    edge(topicNode, `tn:${e.to}`, "RELATED_TOPIC", 1, e.reason);
  }

  // 5. What the assessment is BACKED_BY (edge counts per evidence kind)
  const backed = await timed(
    "Assessment evidence edges",
    "(DepthAssessment)-[:BACKED_BY]->(FileChange|Demonstration|Experience|Commit)",
    "1-hop aggregation",
    `MATCH (a:DepthAssessment {id: $id})-[:BACKED_BY]->(x)
     RETURN labels(x)[0] AS kind, count(x) AS n ORDER BY n DESC`,
    { id: assessmentId(developerId, slug) },
  );

  // 6. Algorithm results written on the Topic node
  const metricRows = await timed(
    "Algorithm results on the topic",
    "(Topic {foundation_rank, bridge_score, cluster_id, component_id})",
    "algo.pageRank / betweenness / labelPropagation / WCC (precomputed)",
    `MATCH (t:Topic {slug: $slug})
     RETURN t.foundation_rank AS pr, t.bridge_score AS bt, t.cluster_id AS cl, t.component_id AS cc`,
    { slug },
  );
  const m = metricRows[0] ?? {};
  const clusterId = m.cl == null ? null : num(m.cl);
  const componentId = m.cc == null ? null : num(m.cc);
  const sizeOf = async (
    prop: "cluster_id" | "component_id",
    v: number | null,
  ) =>
    v == null
      ? 0
      : num(
          ((await tryRows(
            graph,
            `${prop} size`,
            `MATCH (t:Topic) WHERE t.${prop} = $v RETURN count(t) AS n`,
            { v },
          )) ?? [])[0]?.n,
        );
  const [clusterSize, componentSize] = await Promise.all([
    sizeOf("cluster_id", clusterId),
    sizeOf("component_id", componentId),
  ]);

  const all = [...nodes.values()];
  const hopCounts: Record<number, number> = {};
  for (const n of all)
    if (n.hop > 0) hopCounts[n.hop] = (hopCounts[n.hop] ?? 0) + 1;

  return {
    slug,
    nodes: all,
    edges: [...edges.values()].filter(
      (e) => nodes.has(e.source) && nodes.has(e.target),
    ),
    hopCounts,
    maxHop: Math.max(0, ...all.map((n) => n.hop)),
    builds,
    buildTotals: { missions: missions.length, builds: others.length },
    backedBy: backed.map((r) => ({ kind: str(r.kind), count: num(r.n) })),
    metrics: {
      foundationRank: m.pr == null ? null : num(m.pr),
      bridgeScore: m.bt == null ? null : num(m.bt),
      clusterId,
      clusterSize,
      componentId,
      componentSize,
    },
    reach: {
      prerequisites: prereq.length,
      unlocks: unlocks.length,
      related: related.length,
      maxPrereqHop: Math.max(0, ...prereq.map((n) => n.hops)),
    },
    trace,
  };
}

const cut80 = (s: string): string =>
  s.length <= 80 ? s : `${s.slice(0, 79)}…`;
