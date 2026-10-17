import type { Graph } from "../db/falkordb.js";

type Row = Record<string, any>;

const LOG_PREFIX = "[journey-graph]";

function log(message: string, detail?: Row): void {
  if (detail !== undefined) console.log(`${LOG_PREFIX} ${message}`, detail);
  else console.log(`${LOG_PREFIX} ${message}`);
}

const str = (v: unknown, fallback = ""): string =>
  v === null || v === undefined || typeof v === "object"
    ? fallback
    : String(v).trim();

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : [];

const mapList = (v: unknown): Row[] =>
  Array.isArray(v)
    ? v.filter((x) => x && typeof x === "object" && !Array.isArray(x))
    : [];

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

// ============================================================
// FILE MAP
//
//   A. Types, local level/state helpers, and the graph model
//      (this file has NO import from developer-knowledge-graph)
//   B. Light schema setup (full-text index only; never seeds the taxonomy)
//   C. THE JOURNEY: readJourney() + traversal readers.
//      Read-only. No goal, no recommendations. Every section carries a
//      plain-English account of how FalkorDB produced it, and an honest
//      list of limitations.
//   D. Goal frontier (used ONLY by the goal / mission / chat agents,
//      never by the journey API)
// ============================================================

// ============================================================
// A. TYPES + LOCAL HELPERS
// ============================================================

export type CapLevel =
  | "missing"
  | "insufficient_evidence"
  | "usage"
  | "repeated_usage"
  | "implementation"
  | "strong";

export type EvidenceState =
  | "demonstrated"
  | "partial"
  | "unverified"
  | "missing";

const ALL_LEVELS: CapLevel[] = [
  "missing",
  "insufficient_evidence",
  "usage",
  "repeated_usage",
  "implementation",
  "strong",
];

const LEVEL_RANK: Record<CapLevel, number> = {
  missing: -1,
  insufficient_evidence: 0,
  usage: 1,
  repeated_usage: 2,
  implementation: 3,
  strong: 4,
};

const DEPTH_BY_RANK = ["", "usage", "implementation", "strong"];

const asLevel = (v: unknown): CapLevel => {
  const s = str(v);
  return (ALL_LEVELS as string[]).includes(s) ? (s as CapLevel) : "missing";
};

/**
 * demonstrated  a mechanism was built (implementation / strong)
 * partial       the primitive was used but the mechanism was not built
 * unverified    a lone sighting, not enough to say anything
 * missing       nothing seen
 */
export function evidenceStateFor(level: CapLevel): EvidenceState {
  if (level === "strong" || level === "implementation") return "demonstrated";
  if (level === "usage" || level === "repeated_usage") return "partial";
  if (level === "insufficient_evidence") return "unverified";
  return "missing";
}

export function levelsInStates(states: readonly EvidenceState[]): CapLevel[] {
  return ALL_LEVELS.filter((l) => states.includes(evidenceStateFor(l)));
}

/**
 * How many PREREQUISITE_OF hops the goal frontier may walk. Kept equal to
 * MAX_PREREQUISITE_DEPTH in developer-knowledge-graph.ts, whose validator
 * accepts chains up to that length.
 */
const MAX_PREREQUISITE_DEPTH = 10;

/** A prerequisite counts as satisfied only when the mechanism was built. */
const PREREQUISITE_SATISFIED_BY: readonly EvidenceState[] = ["demonstrated"];

/** A strength backed by fewer detections or commits than this is tentative. */
const MIN_DETECTIONS_FOR_CONFIDENCE = 3;
const MIN_COMMITS_FOR_CONFIDENCE = 2;

export interface ProofRef {
  repository: string;
  path: string;
  startLine: number;
  endLine: number;
  permalink: string;
  snippet: string;
  commitSubject: string;
  depth: string;
  modifiers: string[];
}

export interface ExperienceBrief {
  id: string;
  technique: string;
  summary: string;
  problem: string;
  capabilityId: string;
  depth: string;
  evidenceCount: number;
  commitCount: number;
  repoCount: number;
  activeDays: number;
  firstSeen: string;
  lastSeen: string;
  repositories: string[];
  technologies: string[];
  contexts: string[];
  proof: ProofRef | null;
}

export interface SelfReadout {
  name: string;
  username: string;
  avatarUrl: string;
  totals: {
    repositories: number;
    commits: number;
    fileChanges: number;
    demonstrations: number;
    experiences: number;
    capabilities: number;
  };
  topExperiences: ExperienceBrief[];
  layers: Array<{ name: string; experiences: number; evidence: number }>;
  intents: Array<{ name: string; count: number }>;
  technologies: Array<{ name: string; experiences: number; evidence: number }>;
  habits: Array<{ label: string; count: number }>;
  repositories: Array<{
    name: string;
    experiences: number;
    evidence: number;
    techniques: string[];
  }>;
  depthMix: Array<{ depth: string; count: number }>;
  skills: Array<{ name: string; level: string; score: number }>;
  activity: Array<{ month: string; count: number }>;
}

/** How much of the developer's GitHub history was actually readable. */
export interface Coverage {
  /** false when coverage could not be determined: treat as unknown, not as "fine" */
  known: boolean;
  /** which graph path produced the numbers */
  source: "file_changes" | "contributed_to" | "none";
  repositories: number;
  incomplete: number;
  incompleteNames: string[];
}

// ---- journey types --------------------------------------------------

/** One technique the developer built for a capability, from Demonstration nodes. */
export interface BuiltTechnique {
  ruleId: string;
  technique: string;
  timesBuilt: number;
  bestDepth: string;
  /** hardening behaviours actually observed in their code, most frequent first */
  hardening: Array<{ label: string; count: number }>;
}

/** A capability the developer has evidence for (HAS_CAPABILITY exists). */
export interface BuiltCapability {
  capabilityId: string;
  name: string;
  description: string;
  domainId: string;
  domain: string;
  level: CapLevel;
  state: EvidenceState;
  recency: string;
  bestDepth: string;
  evidenceCount: number;
  commitCount: number;
  repoCount: number;
  activeDays: number;
  firstSeen: string;
  lastSeen: string;
  techniques: BuiltTechnique[];
  /** engineering experiences grouped from the demonstrations (filled by readJourney) */
  experiences: ExperienceBrief[];
  /** strongest concrete demonstrations: the proof (filled by readJourney) */
  proofs: ProofRef[];
}

export type StrengthTier = "core" | "solid" | "emerging";

export interface JourneyStrength {
  capabilityId: string;
  name: string;
  domain: string;
  tier: StrengthTier;
  level: CapLevel;
  evidenceCount: number;
  commitCount: number;
  repoCount: number;
  activeDays: number;
  /** true when the evidence is thin (few detections or a single commit) */
  tentative: boolean;
  /** the numbers behind the tier, in plain words */
  reason: string;
}

export interface DomainSummary {
  domainId: string;
  domain: string;
  /** capabilities in this domain with any evidence */
  touched: number;
  /** of those, built (implementation or strong) */
  built: number;
  evidence: number;
  bestLevel: CapLevel;
}

export interface TimelinePoint {
  month: string;
  capabilityId: string;
  name: string;
  count: number;
  bestDepth: string;
}

export interface JourneyRepository {
  name: string;
  experiences: number;
  evidence: number;
  capabilities: string[];
  techniques: string[];
}

/** One traversal that produced one section of the journey. */
export interface GraphStep {
  section: string;
  /** the question this section answers */
  question: string;
  /** the graph path walked, in Cypher-style notation */
  pattern: string;
  rows: number;
  /** why this traversal answers that part of the journey */
  why: string;
  /** PLAIN ENGLISH: what FalkorDB actually did, with this developer's real numbers */
  explanation: string;
  /** the FalkorDB capabilities this step leaned on */
  falkordb: string[];
}

export interface Journey {
  developerId: string;
  self: SelfReadout;
  summary: {
    capabilitiesWithEvidence: number;
    built: number;
    partial: number;
    /** length of the returned `strengths` list (core + solid + emerging) */
    strengths: number;
    /** core + solid only; emerging ones are listed but not counted as proven */
    provenStrengths: number;
    /** repositories in which detectors found evidence */
    repositories: number;
    /** repositories the developer committed to at all (from FileChange nodes) */
    repositoriesTouched: number;
  };
  /** every capability with evidence, strongest first, with techniques, experiences and proof */
  capabilities: BuiltCapability[];
  /** what they are good at: decided by deterministic rules over the graph */
  strengths: JourneyStrength[];
  domains: DomainSummary[];
  timeline: TimelinePoint[];
  repositories: JourneyRepository[];
  coverage: Coverage;
  /** the whole story in words: how FalkorDB turned commits into this journey */
  howFalkorDBAnswered: string;
  /** honest limits of what this journey can claim */
  limitations: string[];
  /** how each section was read from FalkorDB, step by step, in words */
  provenance: GraphStep[];
}

export interface CapabilityTrace {
  capabilityId: string;
  name: string;
  level: CapLevel;
  state: EvidenceState;
  evidenceCount: number;
  experiences: ExperienceBrief[];
  demonstrations: Array<{
    id: string;
    capabilityId: string;
    technique: string;
    depth: string;
    modifiers: string[];
    repository: string;
    path: string;
    startLine: number;
    endLine: number;
    permalink: string;
    commitSubject: string;
    changeIntent: string;
    layer: string;
    snippet: string;
    skills: string[];
    createdAt: string;
  }>;
}

export interface RepositoryTrace {
  query: string;
  matches: Array<{
    repository: string;
    experiences: Array<{
      id: string;
      technique: string;
      capabilityId: string;
      capability: string;
      depth: string;
      evidenceCount: number;
      firstSeen: string;
      lastSeen: string;
    }>;
  }>;
}

export interface CapabilityHit {
  capabilityId: string;
  name: string;
  score: number;
}

// ============================================================
// THE GRAPH MODEL: what the journey is read from
// ============================================================

export const GRAPH_MODEL = {
  summary:
    "One shared FalkorDB graph holds every developer. Each developer is a Developer node, and every journey query starts at that node, so it only follows that developer's own edges. GitHub history is turned into evidence by rule-based detectors, evidence is grouped into experiences, and experiences roll up into capability levels. The journey is a set of read-only traversals over that structure; every claim can be walked back to a file, a line range and a commit. The capabilities themselves are inferences from code patterns, not verified skills.",
  whyFalkorDB: [
    "A developer's history is naturally a web of connected things: a person wrote diffs, diffs sit in commits, commits sit in repositories, diffs show techniques, techniques prove skills. FalkorDB stores that web as it is: nodes for the things, edges for the connections.",
    "FalkorDB keeps edges as real stored connections, not as join tables. Walking from a Developer to their capabilities, or from a capability down to the exact code that supports it, is following stored links rather than searching and matching rows. The cost depends on how much you actually touch, not on how big the whole database is.",
    "Roll-ups live on the edges. The HAS_CAPABILITY edge between a developer and a skill stores level, evidence count, commit count, repository count and first/last seen. Answering 'what are they good at' is reading those edge properties, not recounting thousands of demonstrations.",
    "Every claim is one hop from its supporting code. Capability <- Demonstration -> Repository / FileChange means the same graph that answers 'what are they good at' also answers 'show me the code', with a GitHub permalink, so a reader can judge the evidence themselves.",
    "FalkorDB also provides a full-text index over capability names, descriptions and keywords, so a loose phrase like 'make my API safer' becomes real capability nodes, and graph algorithms (shortest path, PageRank, BFS) for relationships between skills.",
    "Every private-data query is anchored on one Developer node and follows that developer's own edges (DEMONSTRATED, EXPERIENCED, HAS_CAPABILITY, AUTHORED_CODE), so a journey only reads that developer's evidence even though the graph is shared. Only the capability taxonomy is shared.",
  ],
  nodes: [
    {
      label: "Developer",
      meaning: "The person. Root of every traversal.",
      createdBy: "GitHub sync",
    },
    {
      label: "Repository",
      meaning: "A project they contributed to.",
      createdBy: "GitHub sync",
    },
    {
      label: "Commit",
      meaning: "A commit they made. Its message gives the 'why'.",
      createdBy: "GitHub sync",
    },
    {
      label: "FileChange",
      meaning:
        "One file diff inside a commit. The raw material of all evidence.",
      createdBy: "GitHub sync",
    },
    {
      label: "Demonstration",
      meaning:
        "ATOMIC EVIDENCE: one place where code matched a detector for a mechanism (e.g. retry with backoff), with technique, depth, hardening modifiers, file, line range, permalink and snippet.",
      createdBy:
        "Signal rules run over added, non-comment, non-test lines of each FileChange",
    },
    {
      label: "Experience",
      meaning:
        "DURABLE MEMORY: demonstrations of the same capability + technique grouped into one engineering experience, with counts across commits, repositories and days.",
      createdBy: "Deterministic grouping (no LLM) on every sync",
    },
    {
      label: "Capability",
      meaning:
        "A learnable engineering ability (e.g. retry_backoff). Domains (reliability, data_layer ...) are category nodes that only group capabilities.",
      createdBy: "Capability taxonomy (owned outside this file)",
    },
    {
      label: "EngineeringContext",
      meaning:
        "Which layer of the system the work touched (request pipeline, data layer ...).",
      createdBy: "Path patterns",
    },
    {
      label: "Technique / Technology / Problem / Skill",
      meaning:
        "Names attached to experiences: how it was done, with what tools, and what problem the commits said they solved.",
      createdBy: "Experience build and skill graph",
    },
  ],
  relationships: [
    {
      type: "AUTHORED_CODE",
      from: "Developer",
      to: "FileChange",
      meaning: "The developer wrote this diff.",
      why: "Only the developer's own code can count as evidence.",
    },
    {
      type: "DEMONSTRATED",
      from: "Developer",
      to: "Demonstration",
      meaning: "This piece of evidence belongs to this developer.",
      why: "Ownership edge: stops two developers sharing evidence.",
    },
    {
      type: "OF_CAPABILITY",
      from: "Demonstration",
      to: "Capability",
      meaning: "The evidence points to this capability.",
      why: "Links raw code evidence to a named skill.",
    },
    {
      type: "IN_REPOSITORY",
      from: "Demonstration",
      to: "Repository",
      meaning: "Where the evidence lives.",
      why: "Answers 'where did you build this?'",
    },
    {
      type: "EVIDENCED_BY",
      from: "Demonstration",
      to: "FileChange",
      meaning: "The exact diff the evidence was extracted from.",
      why: "Lets every claim be opened on GitHub.",
    },
    {
      type: "EXPERIENCED",
      from: "Developer",
      to: "Experience",
      meaning: "The developer has this engineering experience.",
      why: "Entry point to 'what has this developer built'.",
    },
    {
      type: "SUPPORTED_BY",
      from: "Experience",
      to: "Demonstration",
      meaning: "The demonstrations the experience was grouped from.",
      why: "Experience -> proof snippet.",
    },
    {
      type: "DEMONSTRATES_CAPABILITY",
      from: "Experience",
      to: "Capability",
      meaning: "The experience points to this capability.",
      why: "Experience -> skill.",
    },
    {
      type: "OCCURS_IN",
      from: "Experience",
      to: "Repository",
      meaning: "The experience happened in this project.",
      why: "Project -> what was built there.",
    },
    {
      type: "IN_CONTEXT",
      from: "Experience",
      to: "EngineeringContext",
      meaning: "The system layer it touched.",
      why: "Shows breadth across layers.",
    },
    {
      type: "HAS_CAPABILITY",
      from: "Developer",
      to: "Capability",
      meaning:
        "ROLL-UP of all demonstrations of a capability: level, evidence/commit/repo/day counts, first/last seen. No blended score.",
      why: "One edge per skill = the fast answer to 'what have they demonstrated'.",
    },
    {
      type: "SPECIALIZES",
      from: "Capability",
      to: "Capability (domain)",
      meaning: "Capability belongs to a domain. Grouping only.",
      why: "Lets the journey summarise by domain.",
    },
    {
      type: "HAS_SKILL",
      from: "Developer",
      to: "Skill",
      meaning:
        "Technology skills (TypeScript, Express ...) from the skill graph.",
      why: "Tools they work with, complementary to capabilities.",
    },
    {
      type: "EVIDENCE_FOR_TOPIC",
      from: "Demonstration",
      to: "Topic",
      meaning:
        "This implementation is evidence for a canonical engineering topic. Carries reason, confidence, source, build_id and developer_id; one edge per source.",
      why: "Lets a topic reach the exact code without relying on the broad capability hop.",
    },
    {
      type: "DEMONSTRATES_APPROACH",
      from: "Demonstration",
      to: "Approach",
      meaning:
        "This implementation is evidence for one approach of a topic (for example Redis-backed caching). Carries reason, confidence, source and build_id.",
      why: "Approaches are assessed independently, so each needs its own proof.",
    },
    {
      type: "HAD_SNAPSHOT",
      from: "Developer",
      to: "DepthSnapshot",
      meaning:
        "One immutable record of a topic assessment per build (SNAPSHOT_OF links it to the Topic).",
      why: "History of how topic depth and evidence changed, kept when the current assessment is replaced.",
    },
  ],
  levels: {
    insufficient_evidence: "a single lone sighting; Pathway cannot tell yet",
    usage: "a primitive was used",
    repeated_usage:
      "a primitive was used in 2+ commits, but the mechanism was never built",
    implementation:
      "a composed mechanism was detected, or a primitive plus 2 hardening behaviours",
    strong:
      "detected with hardening in 2+ separate commits (a hardened mechanism, repeated)",
  } as Record<string, string>,
  paths: [
    {
      question: "What have they demonstrated, and how well?",
      pattern:
        "(Developer)-[HAS_CAPABILITY]->(Capability)-[SPECIALIZES]->(domain)",
      tool: "list_built_capabilities",
    },
    {
      question: "What supports a skill?",
      pattern:
        "(Capability)<-[OF_CAPABILITY]-(Demonstration)-[IN_REPOSITORY]->(Repository)",
      tool: "trace_capability",
    },
    {
      question: "What did they build in a project?",
      pattern:
        "(Repository)<-[OCCURS_IN]-(Experience)-[DEMONSTRATES_CAPABILITY]->(Capability)",
      tool: "trace_repository",
    },
    {
      question: "What are they good at?",
      pattern:
        "level + evidence/commit/repo/day counts on HAS_CAPABILITY, tiered by rules (core / solid / emerging)",
      tool: "get_developer_journey",
    },
    {
      question: "When did each skill grow?",
      pattern:
        "(Developer)-[DEMONSTRATED]->(Demonstration {created_at})-[OF_CAPABILITY]->(Capability), grouped by month",
      tool: "get_developer_journey / get_skill_evolution",
    },
    {
      question: "Which topics and approaches does this experience support?",
      pattern:
        "(Experience)-[SUPPORTED_BY]->(Demonstration)-[EVIDENCE_FOR_TOPIC]->(Topic) and -[DEMONSTRATES_APPROACH]->(Approach)",
      tool: "get_topic_experiences",
    },
    {
      question:
        "How did evidence for a topic grow, and when did each approach appear?",
      pattern:
        "(Demonstration {created_at})-[EVIDENCE_FOR_TOPIC]->(Topic), grouped by month and approach, plus (Developer)-[HAD_SNAPSHOT]->(DepthSnapshot)",
      tool: "get_topic_history",
    },
  ],
};

// ============================================================
// B. LIGHT SCHEMA SETUP
//
// This file does not own the capability taxonomy. Capability nodes, domains,
// PREREQUISITE_OF / RELATED_TO edges and technique specs are created by
// whoever builds the knowledge graph. Here we only make sure the full-text
// index exists and that existing Capability nodes carry search keywords.
// ============================================================

const CAPABILITY_KEYWORDS: Record<string, string> = {
  concurrency_control: "concurrency consistency shared state",
  async_processing: "asynchronous async background processing",
  reliability: "reliability resilience resilient fault tolerance",
  caching: "caching performance latency",
  realtime: "realtime real-time live delivery",
  api_engineering: "api design security secure",
  data_layer: "data layer database engineering",
  frontend_delivery: "frontend delivery rendering seo",

  distributed_locking:
    "lock locks locking mutex redlock mutual exclusion distributed",
  transactional_integrity:
    "transaction transactions acid atomic integrity consistency data backend",
  optimistic_concurrency:
    "optimistic concurrency race condition lost update conflict",
  idempotent_operations:
    "idempotent idempotency duplicate exactly once distributed payments",
  job_queues:
    "queue queues worker workers background job jobs bullmq cron backend scalable",
  event_messaging:
    "kafka rabbitmq broker pubsub messaging event driven events sqs distributed scalable system design",
  webhook_handling: "webhook webhooks callback callbacks integrations",
  retry_backoff:
    "retry retries backoff resilient resilience fault tolerant backend distributed",
  rate_limit_handling: "throttle throttling ratelimit 429 upstream",
  timeouts_cancellation: "timeout timeouts cancel cancellation abort deadline",
  application_caching:
    "cache caching latency performance fast backend scalable redis",
  websocket_channels:
    "websocket websockets socket realtime real-time live streaming chat",
  api_design:
    "api rest restful endpoint endpoints route routes http backend design",
  input_validation: "validation validate zod sanitize secure security input",
  authn_authz:
    "auth authentication authorization login jwt oauth security secure permission password backend",
  rate_limiting: "rate limiting limiter abuse secure security protect",
  schema_migrations: "migration migrations schema database evolve",
  batched_writes: "bulk batch batched insert performance database throughput",
  graph_modeling: "graph cypher neo4j falkordb traversal knowledge",
  rendering_strategies:
    "ssr ssg isr nextjs next rendering seo server components frontend",
};

// Pathway uses ONE shared FalkorDB graph (see db/falkordb.ts), and
// graph.selectGraph() hands back a new object on every call, so the setup is
// cached once per process, not per Graph object.
//
// A cached "ready" is only trustworthy if the Capability nodes existed when it
// ran: keywords attach only to Capability nodes that already exist. So callers
// that have just (re)built the knowledge graph pass { force: true }, which
// re-runs the idempotent setup and replaces the cached result.
let schemaReady: Promise<void> | null = null;

export function ensureJourneySchema(
  graph: Graph,
  options: { force?: boolean } = {},
): Promise<void> {
  if (schemaReady && !options.force) return schemaReady;

  const pending: Promise<void> = setupSearch(graph).catch((error) => {
    if (schemaReady === pending) schemaReady = null;
    throw error;
  });
  schemaReady = pending;
  return pending;
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

async function setupSearch(graph: Graph): Promise<void> {
  // Keywords only touch Capability nodes that already exist. Nothing is created.
  const keywordRows = Object.entries(CAPABILITY_KEYWORDS).map(
    ([id, keywords]) => ({ id, keywords }),
  );

  await ignoreExists("capability keywords", () =>
    graph.query(
      `
      UNWIND $batch AS item
      MATCH (c:Capability {id: item.id})
      SET c.keywords = item.keywords
      RETURN count(c) AS n
      `,
      { params: { batch: keywordRows } },
    ),
  );

  await ignoreExists("index Capability.id", () =>
    graph.query(`CREATE INDEX FOR (n:Capability) ON (n.id)`),
  );
  await ignoreExists("index Developer.id", () =>
    graph.query(`CREATE INDEX FOR (n:Developer) ON (n.id)`),
  );

  await ignoreExists("fulltext Capability", () =>
    graph.query(
      `CALL db.idx.fulltext.createNodeIndex('Capability', 'name', 'description', 'keywords')`,
    ),
  );

  log("journey search ready", { keywordRows: keywordRows.length });
}

// ============================================================
// FREE TEXT -> CAPABILITIES   (FalkorDB full-text + bounded hierarchy expansion)
//
// A broad match such as "reliability" can hit a domain/category node. Expand
// descendants up to three SPECIALIZES edges so nested capability taxonomies do
// not silently lose deeper learnable capabilities. Results are deduped by ID.
// ============================================================

const STOPWORDS = new Set([
  "i",
  "me",
  "my",
  "we",
  "you",
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "want",
  "need",
  "like",
  "get",
  "become",
  "learn",
  "better",
  "more",
  "good",
  "great",
  "strong",
  "stronger",
  "skills",
  "skill",
  "engineer",
  "engineering",
  "developer",
  "software",
  "about",
  "into",
  "from",
  "have",
  "can",
  "able",
  "how",
  "build",
  "building",
  "work",
  "working",
  "level",
  "senior",
  "junior",
  "improve",
  "understand",
  "deep",
  "deeper",
  "stuff",
]);

function fulltextQuery(text: string): string {
  const tokens = [
    ...new Set(
      (text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter(
        (t) => !STOPWORDS.has(t),
      ),
    ),
  ].slice(0, 12);

  return tokens.map((t) => (t.length >= 4 ? `${t}*` : t)).join("|");
}

export async function findCapabilitiesForText(
  graph: Graph,
  text: string,
  limit = 8,
): Promise<CapabilityHit[]> {
  await ensureJourneySchema(graph);

  const q = fulltextQuery(text);
  if (!q) return [];

  const n = Math.min(Math.max(Math.floor(limit), 1), 12);

  const result = await tryRows(
    graph,
    "fulltext capability search",
    `
    CALL db.idx.fulltext.queryNodes('Capability', $q) YIELD node, score
    OPTIONAL MATCH (leaf:Capability)-[:SPECIALIZES*1..3]->(node)
    WITH CASE WHEN leaf IS NULL THEN node ELSE leaf END AS cap, score
    WHERE cap.parent_id <> ""
    RETURN cap.id AS capability_id, cap.name AS name, max(score) AS score
    ORDER BY score DESC
    LIMIT ${n}
    `,
    { q },
  );

  return (result ?? []).map((r) => ({
    capabilityId: str(r.capability_id),
    name: str(r.name),
    score: num(r.score),
  }));
}

// ============================================================
// C. THE JOURNEY (read-only)
// ============================================================

// ---- shared Cypher fragments ----------------------------------------

// Collapses Experience's neighbours into lists. Expects `e` in scope.
const EXPERIENCE_DETAIL = `
  OPTIONAL MATCH (e)-[:SOLVES]->(p:Problem)
  OPTIONAL MATCH (e)-[:OCCURS_IN]->(r:Repository)
  OPTIONAL MATCH (e)-[:USES_TECHNOLOGY]->(tech:Technology)
  OPTIONAL MATCH (e)-[:IN_CONTEXT]->(ctx:EngineeringContext)
`;

const EXPERIENCE_MAP = `{
  id: e.id,
  technique: e.technique,
  summary: coalesce(e.summary, ""),
  problem: coalesce(p.statement, ""),
  capability_id: e.capability_id,
  depth: coalesce(e.best_depth, "usage"),
  evidence: coalesce(e.evidence_count, 0),
  commits: coalesce(e.commit_count, 0),
  repos_n: coalesce(e.repo_count, 0),
  active_days: coalesce(e.active_days, 0),
  first_seen: coalesce(e.first_seen, ""),
  last_seen: coalesce(e.last_seen, ""),
  repositories: repos,
  technologies: techs,
  contexts: ctxs
}`;

function toExperience(m: Row): ExperienceBrief {
  return {
    id: str(m.id),
    technique: str(m.technique),
    summary: str(m.summary),
    problem: str(m.problem),
    capabilityId: str(m.capability_id),
    depth: str(m.depth) || "usage",
    evidenceCount: num(m.evidence),
    commitCount: num(m.commits),
    repoCount: num(m.repos_n),
    activeDays: num(m.active_days),
    firstSeen: str(m.first_seen),
    lastSeen: str(m.last_seen),
    repositories: strList(m.repositories),
    technologies: strList(m.technologies),
    contexts: strList(m.contexts),
    proof: null,
  };
}

// ---- SELF: how this developer actually builds -------------------------

async function readTopExperiences(
  graph: Graph,
  developerId: string,
  limit: number,
): Promise<ExperienceBrief[]> {
  const result = await tryRows(
    graph,
    "top experiences",
    `
    MATCH (d:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)
    ${EXPERIENCE_DETAIL}
    WITH e, p,
         collect(DISTINCT coalesce(r.full_name, r.name)) AS repos,
         collect(DISTINCT tech.name) AS techs,
         collect(DISTINCT ctx.name) AS ctxs,
         CASE WHEN e.best_depth = "strong" THEN 3
              WHEN e.best_depth = "implementation" THEN 2
              ELSE 1 END AS depth_rank
    ORDER BY depth_rank DESC, e.evidence_count DESC
    LIMIT ${limit}
    RETURN ${EXPERIENCE_MAP} AS exp
    `,
    { dev: developerId },
  );

  return (result ?? []).map((r) => toExperience(r.exp ?? {}));
}

export async function readSelf(
  graph: Graph,
  developerId: string,
): Promise<SelfReadout> {
  const [
    who,
    work,
    demos,
    exps,
    caps,
    topExperiences,
    layers,
    intents,
    technologies,
    habits,
    repositories,
    depthMix,
    skills,
    activity,
  ] = await Promise.all([
    tryRows(
      graph,
      "developer",
      `MATCH (d:Developer {id: $dev})
       RETURN coalesce(d.name, "") AS name,
              coalesce(d.username, "") AS username,
              coalesce(d.avatar_url, "") AS avatar_url
       LIMIT 1`,
      { dev: developerId },
    ),
    tryRows(
      graph,
      "work totals",
      `MATCH (d:Developer {id: $dev})-[:AUTHORED_CODE]->(fc:FileChange)
       RETURN count(fc) AS file_changes,
              count(DISTINCT fc.commit_sha) AS commits,
              count(DISTINCT fc.repository_id) AS repositories`,
      { dev: developerId },
    ),
    tryRows(
      graph,
      "demonstration totals",
      `MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)
       RETURN count(x) AS n`,
      { dev: developerId },
    ),
    tryRows(
      graph,
      "experience totals",
      `MATCH (d:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)
       RETURN count(e) AS n`,
      { dev: developerId },
    ),
    tryRows(
      graph,
      "capability totals",
      `MATCH (d:Developer {id: $dev})-[:HAS_CAPABILITY]->(c:Capability)
       WHERE c.parent_id <> ""
       RETURN count(c) AS n`,
      { dev: developerId },
    ),
    readTopExperiences(graph, developerId, 10),

    // which layer of the system they work in
    tryRows(
      graph,
      "layers",
      `MATCH (d:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)-[:IN_CONTEXT]->(ctx:EngineeringContext)
       RETURN ctx.name AS name,
              count(DISTINCT e) AS experiences,
              sum(e.evidence_count) AS evidence
       ORDER BY evidence DESC
       LIMIT 6`,
      { dev: developerId },
    ),

    // why they change code (fix / feature / performance / reliability ...)
    tryRows(
      graph,
      "intents",
      `MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)
       RETURN coalesce(x.change_intent, "change") AS name, count(x) AS n
       ORDER BY n DESC
       LIMIT 6`,
      { dev: developerId },
    ),

    // what tools show up in their solutions
    tryRows(
      graph,
      "technologies",
      `MATCH (d:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)-[:USES_TECHNOLOGY]->(t:Technology)
       RETURN t.name AS name,
              count(DISTINCT e) AS experiences,
              sum(e.evidence_count) AS evidence
       ORDER BY evidence DESC
       LIMIT 8`,
      { dev: developerId },
    ),

    // hardening habits: split the stored " | " modifier string inside Cypher
    tryRows(
      graph,
      "habits",
      `MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)
       WHERE x.modifiers IS NOT NULL AND x.modifiers <> ""
       UNWIND split(x.modifiers, " | ") AS label
       RETURN label, count(*) AS n
       ORDER BY n DESC
       LIMIT 8`,
      { dev: developerId },
    ),

    tryRows(
      graph,
      "repositories",
      `MATCH (d:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)-[:OCCURS_IN]->(r:Repository)
       WITH r,
            count(DISTINCT e) AS experiences,
            sum(e.evidence_count) AS evidence,
            collect(DISTINCT e.technique) AS all_techniques
       RETURN coalesce(r.full_name, r.name) AS name,
              experiences,
              evidence,
              all_techniques[0..4] AS techs
       ORDER BY evidence DESC
       LIMIT 6`,
      { dev: developerId },
    ),

    tryRows(
      graph,
      "depth mix",
      `MATCH (d:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)
       RETURN coalesce(e.best_depth, "usage") AS depth, count(e) AS n
       ORDER BY n DESC`,
      { dev: developerId },
    ),

    tryRows(
      graph,
      "skills",
      `MATCH (d:Developer {id: $dev})-[hs:HAS_SKILL]->(s:Skill)
       RETURN s.name AS name,
              coalesce(hs.level, "") AS level,
              coalesce(hs.depth_score, 0) AS score
       ORDER BY score DESC
       LIMIT 8`,
      { dev: developerId },
    ),

    tryRows(
      graph,
      "activity",
      `MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)
       WHERE x.created_at IS NOT NULL AND x.created_at <> ""
       RETURN substring(x.created_at, 0, 7) AS month, count(x) AS n
       ORDER BY month`,
      { dev: developerId },
    ),
  ]);

  const w = work?.[0] ?? {};

  return {
    name: str(who?.[0]?.name),
    username: str(who?.[0]?.username),
    avatarUrl: str(who?.[0]?.avatar_url),
    totals: {
      repositories: num(w.repositories),
      commits: num(w.commits),
      fileChanges: num(w.file_changes),
      demonstrations: num(demos?.[0]?.n),
      experiences: num(exps?.[0]?.n),
      capabilities: num(caps?.[0]?.n),
    },
    topExperiences,
    layers: (layers ?? []).map((r) => ({
      name: str(r.name),
      experiences: num(r.experiences),
      evidence: num(r.evidence),
    })),
    intents: (intents ?? []).map((r) => ({
      name: str(r.name),
      count: num(r.n),
    })),
    technologies: (technologies ?? []).map((r) => ({
      name: str(r.name),
      experiences: num(r.experiences),
      evidence: num(r.evidence),
    })),
    habits: (habits ?? []).map((r) => ({
      label: str(r.label),
      count: num(r.n),
    })),
    repositories: (repositories ?? []).map((r) => ({
      name: str(r.name),
      experiences: num(r.experiences),
      evidence: num(r.evidence),
      techniques: strList(r.techs),
    })),
    depthMix: (depthMix ?? []).map((r) => ({
      depth: str(r.depth),
      count: num(r.n),
    })),
    skills: (skills ?? []).map((r) => ({
      name: str(r.name),
      level: str(r.level),
      score: num(r.score),
    })),
    activity: (activity ?? [])
      .map((r) => ({ month: str(r.month), count: num(r.n) }))
      .filter((r) => /^\d{4}-\d{2}$/.test(r.month))
      .slice(-14),
  };
}

// ---- experiences and proof ---------------------------------------------

async function readExperiencesByCapability(
  graph: Graph,
  developerId: string,
  capabilityIds: string[],
): Promise<Map<string, ExperienceBrief[]>> {
  const out = new Map<string, ExperienceBrief[]>();
  if (!capabilityIds.length) return out;

  const result = await tryRows(
    graph,
    "experiences by capability",
    `
    UNWIND $ids AS cid
    MATCH (d:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)-[:DEMONSTRATES_CAPABILITY]->(c:Capability {id: cid})
    ${EXPERIENCE_DETAIL}
    WITH cid, e, p,
         collect(DISTINCT coalesce(r.full_name, r.name)) AS repos,
         collect(DISTINCT tech.name) AS techs,
         collect(DISTINCT ctx.name) AS ctxs
    ORDER BY e.evidence_count DESC
    WITH cid, collect(${EXPERIENCE_MAP}) AS exps
    RETURN cid AS capability_id, exps[0..3] AS experiences
    `,
    { dev: developerId, ids: capabilityIds },
  );

  for (const r of result ?? []) {
    out.set(str(r.capability_id), mapList(r.experiences).map(toExperience));
  }
  return out;
}

async function readProofs(
  graph: Graph,
  experienceIds: string[],
): Promise<Map<string, ProofRef>> {
  const out = new Map<string, ProofRef>();
  if (!experienceIds.length) return out;

  const result = await tryRows(
    graph,
    "experience proofs",
    `
    UNWIND $ids AS eid
    MATCH (e:Experience {id: eid})-[:SUPPORTED_BY]->(x:Demonstration)
    OPTIONAL MATCH (x)-[:IN_REPOSITORY]->(r:Repository)
    WITH eid, x, r
    ORDER BY x.depth_rank DESC, x.created_at DESC
    WITH eid, collect({
      repository: coalesce(r.full_name, r.name, ""),
      path: coalesce(x.path, ""),
      start_line: coalesce(x.start_line, 0),
      end_line: coalesce(x.end_line, 0),
      permalink: coalesce(x.permalink, ""),
      snippet: coalesce(x.snippet, ""),
      commit_subject: coalesce(x.commit_subject, ""),
      depth: coalesce(x.depth, "usage"),
      modifiers: coalesce(x.modifiers, "")
    }) AS proofs
    RETURN eid AS id, proofs[0] AS proof
    `,
    { ids: experienceIds },
  );

  for (const r of result ?? []) {
    const p = r.proof;
    if (!p || typeof p !== "object") continue;
    out.set(str(r.id), toProof(p));
  }
  return out;
}

/** Stored ranges can be missing or inverted: report 0/0 and drop the permalink instead of a wrong anchor. */
function cleanRange(start: unknown, end: unknown) {
  const a = Number(start);
  const b = Number(end);
  const ok = Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b >= a;
  return { ok, start: ok ? a : 0, end: ok ? b : 0 };
}

function toProof(p: Row): ProofRef {
  return {
    repository: str(p.repository),
    path: str(p.path),
    startLine: cleanRange(p.start_line, p.end_line).start,
    endLine: cleanRange(p.start_line, p.end_line).end,
    permalink: cleanRange(p.start_line, p.end_line).ok ? str(p.permalink) : "",
    snippet: str(p.snippet),
    commitSubject: str(p.commit_subject),
    depth: str(p.depth) || "usage",
    modifiers: str(p.modifiers).split(" | ").filter(Boolean),
  };
}

/** Top 3 strongest demonstrations per capability: the "show me the code" proof. */
async function readCapabilityProofs(
  graph: Graph,
  developerId: string,
  capabilityIds: string[],
): Promise<Map<string, ProofRef[]>> {
  const out = new Map<string, ProofRef[]>();
  if (!capabilityIds.length) return out;

  const result = await tryRows(
    graph,
    "capability proofs",
    `
    UNWIND $ids AS cid
    MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability {id: cid})
    OPTIONAL MATCH (x)-[:IN_REPOSITORY]->(r:Repository)
    WITH cid, x, r
    ORDER BY x.depth_rank DESC, x.created_at DESC
    WITH cid, collect({
      repository: coalesce(r.full_name, r.name, ""),
      path: coalesce(x.path, ""),
      start_line: coalesce(x.start_line, 0),
      end_line: coalesce(x.end_line, 0),
      permalink: coalesce(x.permalink, ""),
      snippet: coalesce(x.snippet, ""),
      commit_subject: coalesce(x.commit_subject, ""),
      depth: coalesce(x.depth, "usage"),
      modifiers: coalesce(x.modifiers, "")
    }) AS proofs
    RETURN cid AS capability_id, proofs[0..3] AS proofs
    `,
    { dev: developerId, ids: capabilityIds },
  );

  for (const r of result ?? []) {
    out.set(str(r.capability_id), mapList(r.proofs).map(toProof));
  }
  return out;
}

// ---- capabilities: the core traversal --------------------------------------

/**
 * Developer -[HAS_CAPABILITY]-> Capability -[SPECIALIZES]-> domain, joined with
 * what was built per technique (Demonstration -[OF_CAPABILITY]-> Capability).
 * Returns null when the capability query itself failed.
 */
async function readCapabilityRows(
  graph: Graph,
  developerId: string,
): Promise<BuiltCapability[] | null> {
  const [caps, techs] = await Promise.all([
    tryRows(
      graph,
      "built capabilities",
      `
      MATCH (d:Developer {id: $dev})-[hc:HAS_CAPABILITY]->(c:Capability)
      WHERE c.parent_id <> ""
      OPTIONAL MATCH (c)-[:SPECIALIZES]->(dom:Capability)
      RETURN c.id AS capability_id,
             c.name AS name,
             coalesce(c.description, "") AS description,
             coalesce(dom.id, "") AS domain_id,
             coalesce(dom.name, "") AS domain,
             coalesce(hc.level, "missing") AS level,
             coalesce(hc.recency, "") AS recency,
             coalesce(hc.best_depth, "usage") AS best_depth,
             coalesce(hc.evidence_count, 0) AS evidence_count,
             coalesce(hc.commit_count, 0) AS commit_count,
             coalesce(hc.repo_count, 0) AS repo_count,
             coalesce(hc.active_days, 0) AS active_days,
             coalesce(hc.first_seen, "") AS first_seen,
             coalesce(hc.last_seen, "") AS last_seen
      `,
      { dev: developerId },
    ),
    tryRows(
      graph,
      "built techniques",
      `
      MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability)
      RETURN c.id AS capability_id,
             x.rule_id AS rule_id,
             x.technique AS technique,
             count(x) AS times_built,
             max(x.depth_rank) AS best_rank,
             collect(x.modifiers) AS mods
      `,
      { dev: developerId },
    ),
  ]);

  if (!caps) return null;

  const techByCap = new Map<string, BuiltTechnique[]>();
  for (const r of techs ?? []) {
    const counts = new Map<string, number>();
    for (const m of strList(r.mods)) {
      for (const label of m.split(" | ")) {
        const l = label.trim();
        if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
      }
    }
    const hardening = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6)
      .map(([label, count]) => ({ label, count }));

    const id = str(r.capability_id);
    const list = techByCap.get(id) ?? [];
    list.push({
      ruleId: str(r.rule_id),
      technique: str(r.technique),
      timesBuilt: num(r.times_built),
      bestDepth: DEPTH_BY_RANK[num(r.best_rank)] || "usage",
      hardening,
    });
    techByCap.set(id, list);
  }

  return caps
    .map((r): BuiltCapability => {
      const level = asLevel(r.level);
      const id = str(r.capability_id);
      return {
        capabilityId: id,
        name: str(r.name),
        description: str(r.description),
        domainId: str(r.domain_id),
        domain: str(r.domain),
        level,
        state: evidenceStateFor(level),
        recency: str(r.recency),
        bestDepth: str(r.best_depth) || "usage",
        evidenceCount: num(r.evidence_count),
        commitCount: num(r.commit_count),
        repoCount: num(r.repo_count),
        activeDays: num(r.active_days),
        firstSeen: str(r.first_seen),
        lastSeen: str(r.last_seen),
        techniques: (techByCap.get(id) ?? []).sort(
          (a, b) => b.timesBuilt - a.timesBuilt,
        ),
        experiences: [],
        proofs: [],
      };
    })
    .sort(
      (a, b) =>
        LEVEL_RANK[b.level] - LEVEL_RANK[a.level] ||
        b.evidenceCount - a.evidenceCount ||
        a.name.localeCompare(b.name),
    );
}

/** Tool entry: every capability with evidence, optionally filtered. */
export async function readBuiltCapabilities(
  graph: Graph,
  developerId: string,
  filter: { minLevel?: string; domainId?: string } = {},
): Promise<BuiltCapability[]> {
  await ensureJourneySchema(graph);
  const all = await readCapabilityRows(graph, developerId);
  if (!all) throw new Error("capability read failed");

  const min = filter.minLevel ? LEVEL_RANK[asLevel(filter.minLevel)] : -1;
  return all.filter(
    (c) =>
      LEVEL_RANK[c.level] >= min &&
      (!filter.domainId || c.domainId === filter.domainId),
  );
}

// ---- strengths: "what are they good at?" -----------------------------------
//
// Pure rules over the HAS_CAPABILITY roll-up. Nothing is scored or blended:
//   core      level "strong": a hardened mechanism detected in 2+ separate commits
//   solid     level "implementation": the mechanism was detected
//   emerging  level "repeated_usage": a primitive used in 2+ commits, the
//             mechanism itself not detected (said honestly, not as "good at")
// usage / insufficient_evidence are listed as capabilities but are not strengths.
// Skills do not expire: recency is shown, never used to remove a strength.
//
// A strength resting on fewer than MIN_DETECTIONS_FOR_CONFIDENCE detections or
// MIN_COMMITS_FOR_CONFIDENCE commits is flagged `tentative`.

export function deriveStrengths(caps: BuiltCapability[]): JourneyStrength[] {
  const tierRank: Record<StrengthTier, number> = {
    core: 3,
    solid: 2,
    emerging: 1,
  };
  const out: JourneyStrength[] = [];

  for (const c of caps) {
    const tier: StrengthTier | null =
      c.level === "strong"
        ? "core"
        : c.level === "implementation"
          ? "solid"
          : c.level === "repeated_usage"
            ? "emerging"
            : null;
    if (!tier) continue;

    const tentative =
      c.evidenceCount < MIN_DETECTIONS_FOR_CONFIDENCE ||
      c.commitCount < MIN_COMMITS_FOR_CONFIDENCE;

    const top = c.techniques[0];
    const base = `${c.evidenceCount} detection${c.evidenceCount === 1 ? "" : "s"} across ${c.commitCount} commit${c.commitCount === 1 ? "" : "s"} in ${c.repoCount} repositor${c.repoCount === 1 ? "y" : "ies"} over ${c.activeDays} active day${c.activeDays === 1 ? "" : "s"}`;
    const tail = top
      ? `; main technique: ${top.technique}${
          top.hardening.length
            ? ` (${top.hardening
                .slice(0, 3)
                .map((h) => h.label)
                .join(", ")})`
            : ""
        }`
      : "";
    const caveat =
      tier === "emerging"
        ? "; used repeatedly but the mechanism itself was not detected"
        : "";
    const thin = tentative
      ? "; thin evidence, treat as tentative until more code confirms it"
      : "";

    out.push({
      capabilityId: c.capabilityId,
      name: c.name,
      domain: c.domain,
      tier,
      level: c.level,
      evidenceCount: c.evidenceCount,
      commitCount: c.commitCount,
      repoCount: c.repoCount,
      activeDays: c.activeDays,
      tentative,
      reason: `${base}${tail}${caveat}${thin}.`,
    });
  }

  return out.sort(
    (a, b) =>
      tierRank[b.tier] - tierRank[a.tier] ||
      Number(a.tentative) - Number(b.tentative) ||
      b.evidenceCount - a.evidenceCount ||
      a.name.localeCompare(b.name),
  );
}

function summariseDomains(caps: BuiltCapability[]): DomainSummary[] {
  const byDomain = new Map<string, DomainSummary>();
  for (const c of caps) {
    if (!c.domainId) continue;
    const d = byDomain.get(c.domainId) ?? {
      domainId: c.domainId,
      domain: c.domain,
      touched: 0,
      built: 0,
      evidence: 0,
      bestLevel: "missing" as CapLevel,
    };
    d.touched += 1;
    if (c.state === "demonstrated") d.built += 1;
    d.evidence += c.evidenceCount;
    if (LEVEL_RANK[c.level] > LEVEL_RANK[d.bestLevel]) d.bestLevel = c.level;
    byDomain.set(c.domainId, d);
  }
  return [...byDomain.values()].sort(
    (a, b) =>
      LEVEL_RANK[b.bestLevel] - LEVEL_RANK[a.bestLevel] ||
      b.evidence - a.evidence ||
      a.domain.localeCompare(b.domain),
  );
}

// ---- timeline, repositories, coverage ----------------------------------------

async function readTimeline(
  graph: Graph,
  developerId: string,
): Promise<TimelinePoint[] | null> {
  const result = await tryRows(
    graph,
    "capability timeline",
    `
    MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability)
    WHERE x.created_at IS NOT NULL AND x.created_at <> "" AND c.parent_id <> ""
    RETURN substring(x.created_at, 0, 7) AS month,
           c.id AS capability_id,
           c.name AS name,
           count(x) AS n,
           max(x.depth_rank) AS best_rank
    ORDER BY month
    `,
    { dev: developerId },
  );
  if (!result) return null;

  return result
    .map((r) => ({
      month: str(r.month),
      capabilityId: str(r.capability_id),
      name: str(r.name),
      count: num(r.n),
      bestDepth: DEPTH_BY_RANK[num(r.best_rank)] || "usage",
    }))
    .filter((r) => /^\d{4}-\d{2}$/.test(r.month));
}

// ---- TOPIC VIEW: experiences and history for one canonical topic ----------
//
// Read-only. Topic depth is NOT calculated here: the canonical depth
// assessment lives in depth-analyzer-graph.ts. These readers only return the
// evidence (counts, dates, provenance) and the recorded assessment history,
// grouped by the canonical topic and approach ids.

export interface TopicExperience {
  /** stable identity: topic | approach (or technique) | technique */
  identity: string;
  experienceId: string;
  technique: string;
  summary: string;
  capabilityId: string;
  approachSlugs: string[];
  depth: string;
  /** strongest link confidence between these demonstrations and the topic */
  linkConfidence: number;
  evidenceCount: number;
  firstSeen: string;
  lastSeen: string;
  repositories: string[];
  /** provenance: the demonstrations, file changes and commits behind it */
  demonstrationIds: string[];
  fileChangeIds: string[];
  commitShas: string[];
}

/**
 * Experiences that have at least one demonstration linked to the topic. An
 * experience is shown with only the evidence that belongs to this topic, so a
 * broad capability label cannot pull unrelated implementations into it.
 */
export async function readTopicExperiences(
  graph: Graph,
  developerId: string,
  topicSlug: string,
  limit = 12,
): Promise<TopicExperience[]> {
  const result = await tryRows(
    graph,
    "topic experiences",
    `
    MATCH (d:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)-[:SUPPORTED_BY]->(x:Demonstration)
          -[l:EVIDENCE_FOR_TOPIC]->(t:Topic {slug: $slug})
    WHERE l.developer_id = $dev
    OPTIONAL MATCH (x)-[a:DEMONSTRATES_APPROACH]->(ap:Approach)
      WHERE a.developer_id = $dev AND ap.topic_slug = $slug
    WITH e,
         collect(DISTINCT ap.slug) AS approaches,
         collect(DISTINCT x.id) AS demo_ids,
         collect(DISTINCT x.file_change_id) AS fc_ids,
         collect(DISTINCT x.commit_sha) AS shas,
         max(l.confidence) AS conf,
         min(x.created_at) AS first_seen,
         max(x.created_at) AS last_seen,
         max(x.depth_rank) AS best_rank
    OPTIONAL MATCH (e)-[:OCCURS_IN]->(r:Repository)
    RETURN e.id AS id, e.technique AS technique, coalesce(e.summary, "") AS summary,
           e.capability_id AS capability_id, approaches, demo_ids, fc_ids, shas,
           conf, first_seen, last_seen, best_rank,
           collect(DISTINCT coalesce(r.full_name, r.name)) AS repos
    ORDER BY best_rank DESC, size(demo_ids) DESC
    LIMIT ${Math.max(1, Math.min(50, Math.floor(limit)))}
    `,
    { dev: developerId, slug: topicSlug },
  );

  return (result ?? []).map((r) => {
    const approaches = strList(r.approaches).filter(Boolean);
    const technique = str(r.technique);
    const demos = strList(r.demo_ids).filter(Boolean);
    return {
      identity: [topicSlug, approaches[0] ?? technique, technique]
        .join("|")
        .toLowerCase(),
      experienceId: str(r.id),
      technique,
      summary: str(r.summary),
      capabilityId: str(r.capability_id),
      approachSlugs: approaches,
      depth: DEPTH_BY_RANK[num(r.best_rank)] || "usage",
      linkConfidence: Math.round(num(r.conf) * 100) / 100,
      evidenceCount: demos.length,
      firstSeen: str(r.first_seen),
      lastSeen: str(r.last_seen),
      repositories: strList(r.repos).filter(Boolean),
      demonstrationIds: demos,
      fileChangeIds: strList(r.fc_ids).filter(Boolean),
      commitShas: strList(r.shas).filter(Boolean),
    };
  });
}

export interface ExperienceProvenanceRow {
  demonstrationId: string;
  repositoryId: string;
  path: string;
  startLine: number;
  endLine: number;
  permalink: string;
  commitSha: string;
  commitSubject: string;
  fileChangeId: string;
  depth: string;
  createdAt: string;
}

/** Experience -> demonstrations -> file change / commit, oldest first. */
export async function readExperienceProvenance(
  graph: Graph,
  developerId: string,
  experienceId: string,
): Promise<ExperienceProvenanceRow[]> {
  const result = await tryRows(
    graph,
    "experience provenance",
    `
    MATCH (d:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience {id: $id})-[:SUPPORTED_BY]->(x:Demonstration)
    RETURN x.id AS id, x.repository_id AS repository_id, x.path AS path,
           x.start_line AS start_line, x.end_line AS end_line,
           x.permalink AS permalink, x.commit_sha AS commit_sha,
           x.commit_subject AS commit_subject, x.file_change_id AS file_change_id,
           x.depth_rank AS depth_rank, x.created_at AS created_at
    ORDER BY x.created_at
    LIMIT 200
    `,
    { dev: developerId, id: experienceId },
  );
  return (result ?? []).map((r) => ({
    demonstrationId: str(r.id),
    repositoryId: str(r.repository_id),
    path: str(r.path),
    startLine: cleanRange(r.start_line, r.end_line).start,
    endLine: cleanRange(r.start_line, r.end_line).end,
    permalink: cleanRange(r.start_line, r.end_line).ok ? str(r.permalink) : "",
    commitSha: str(r.commit_sha),
    commitSubject: str(r.commit_subject),
    fileChangeId: str(r.file_change_id),
    depth: DEPTH_BY_RANK[num(r.depth_rank)] || "usage",
    createdAt: str(r.created_at),
  }));
}

export interface TopicTimelinePoint {
  month: string;
  /** "" when the evidence is not tied to a specific approach */
  approachSlug: string;
  count: number;
  bestDepth: string;
}

export type TopicHistoryEventKind =
  | "evidence_started"
  | "approach_appeared"
  | "approach_strengthened"
  | "level_changed";

export interface TopicHistoryEvent {
  kind: TopicHistoryEventKind;
  when: string;
  approachSlug?: string;
  detail: string;
}

export interface TopicHistory {
  slug: string;
  timeline: TopicTimelinePoint[];
  events: TopicHistoryEvent[];
  explanation: string;
}

/**
 * How the evidence for a topic grew over time and when each approach first
 * appeared or got stronger, plus level changes between recorded assessments.
 */
export async function readTopicHistory(
  graph: Graph,
  developerId: string,
  topicSlug: string,
): Promise<TopicHistory> {
  const [timelineRows, snapshotRows] = await Promise.all([
    tryRows(
      graph,
      "topic timeline",
      `
      MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)
            -[l:EVIDENCE_FOR_TOPIC]->(t:Topic {slug: $slug})
      WHERE l.developer_id = $dev AND x.created_at IS NOT NULL AND x.created_at <> ""
      OPTIONAL MATCH (x)-[a:DEMONSTRATES_APPROACH]->(ap:Approach)
        WHERE a.developer_id = $dev AND ap.topic_slug = $slug
      RETURN substring(x.created_at, 0, 7) AS month,
             coalesce(ap.slug, "") AS approach,
             count(DISTINCT x) AS n,
             max(x.depth_rank) AS best_rank
      ORDER BY month
      `,
      { dev: developerId, slug: topicSlug },
    ),
    tryRows(
      graph,
      "topic snapshots",
      `
      MATCH (:Developer {id: $dev})-[:HAD_SNAPSHOT]->(s:DepthSnapshot {topic_slug: $slug})
      RETURN s.level AS level, s.assessed_at AS assessed_at
      ORDER BY s.assessed_at
      `,
      { dev: developerId, slug: topicSlug },
    ),
  ]);

  const timeline: TopicTimelinePoint[] = (timelineRows ?? [])
    .map((r) => ({
      month: str(r.month),
      approachSlug: str(r.approach),
      count: num(r.n),
      bestDepth: DEPTH_BY_RANK[num(r.best_rank)] || "usage",
    }))
    .filter((r) => /^\d{4}-\d{2}$/.test(r.month));

  const events: TopicHistoryEvent[] = [];
  if (timeline.length) {
    events.push({
      kind: "evidence_started",
      when: timeline[0].month,
      detail: `First implementation evidence for this topic (${timeline[0].count} demonstration${timeline[0].count === 1 ? "" : "s"}).`,
    });
  }
  const bestRank = new Map<string, number>();
  for (const point of timeline) {
    if (!point.approachSlug) continue;
    const rank = DEPTH_BY_RANK.indexOf(point.bestDepth);
    const seen = bestRank.get(point.approachSlug);
    if (seen === undefined) {
      events.push({
        kind: "approach_appeared",
        when: point.month,
        approachSlug: point.approachSlug,
        detail: `Approach ${point.approachSlug} first appeared at ${point.bestDepth} depth.`,
      });
    } else if (rank > seen) {
      events.push({
        kind: "approach_strengthened",
        when: point.month,
        approachSlug: point.approachSlug,
        detail: `Approach ${point.approachSlug} moved from ${DEPTH_BY_RANK[seen]} to ${point.bestDepth} depth.`,
      });
    }
    bestRank.set(point.approachSlug, Math.max(seen ?? 0, rank));
  }
  let previous = "";
  for (const r of snapshotRows ?? []) {
    const level = str(r.level);
    if (previous && level && level !== previous) {
      events.push({
        kind: "level_changed",
        when: str(r.assessed_at).slice(0, 10),
        detail: `Assessed depth changed from ${previous} to ${level}.`,
      });
    }
    if (level) previous = level;
  }
  events.sort((a, b) => a.when.localeCompare(b.when));

  const approaches = bestRank.size;
  const explanation = timeline.length
    ? `Evidence for this topic spans ${timeline[0].month} to ${timeline[timeline.length - 1].month}` +
      (approaches
        ? `, across ${approaches} approach${approaches === 1 ? "" : "es"} that have linked implementation evidence.`
        : ". No approach-level evidence is linked yet.") +
      " The depth level itself comes from the topic assessment, not from this timeline."
    : "No implementation evidence is linked to this topic yet.";

  return { slug: topicSlug, timeline, events, explanation };
}

async function readJourneyRepositories(
  graph: Graph,
  developerId: string,
): Promise<JourneyRepository[] | null> {
  const result = await tryRows(
    graph,
    "journey repositories",
    `
    MATCH (d:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)-[:OCCURS_IN]->(r:Repository)
    OPTIONAL MATCH (e)-[:DEMONSTRATES_CAPABILITY]->(c:Capability)
    WITH r, e, c
    WITH r,
         count(DISTINCT e) AS experiences,
         sum(e.evidence_count) AS evidence,
         collect(DISTINCT c.name) AS caps,
         collect(DISTINCT e.technique) AS techs
    RETURN coalesce(r.full_name, r.name) AS name,
           experiences,
           evidence,
           caps,
           techs
    ORDER BY evidence DESC
    LIMIT 15
    `,
    { dev: developerId },
  );
  if (!result) return null;

  return result.map((r) => ({
    name: str(r.name),
    experiences: num(r.experiences),
    evidence: num(r.evidence),
    capabilities: strList(r.caps).sort((a, b) => a.localeCompare(b)),
    techniques: strList(r.techs).sort((a, b) => a.localeCompare(b)),
  }));
}

// A repository counts as incomplete when
//   - the sync marked it r.analysis_status = "failed" | "partial", or
//   - more than half of its stored file changes have no patch.
// "No evidence found" is only a fair statement when nothing was skipped.
//
// The repositories are discovered from the developer's own FileChange nodes
// (Developer -[AUTHORED_CODE]-> FileChange, grouped by repository_id). That is
// the same data the totals use, so coverage and totals can never disagree about
// how many repositories exist. The older Developer -[CONTRIBUTED_TO]-> Repository
// edge is only a fallback, because the sync does not always create it.
// When neither path returns anything, coverage is reported as UNKNOWN rather
// than as "fine".
function badRepo(r: Row): boolean {
  const status = str(r.status);
  const changes = num(r.changes);
  const noPatch = num(r.no_patch);
  return (
    status === "failed" ||
    status === "partial" ||
    (changes > 0 && noPatch / changes > 0.5)
  );
}

async function readCoverage(
  graph: Graph,
  developerId: string,
): Promise<Coverage> {
  const unknown: Coverage = {
    known: false,
    source: "none",
    repositories: 0,
    incomplete: 0,
    incompleteNames: [],
  };

  const fromFileChanges = await tryRows(
    graph,
    "coverage (file changes)",
    `
    MATCH (:Developer {id: $dev})-[:AUTHORED_CODE]->(fc:FileChange)
    WITH fc.repository_id AS rid,
         count(fc) AS changes,
         sum(CASE WHEN fc.patch IS NULL OR fc.patch = "" THEN 1 ELSE 0 END) AS no_patch
    WHERE rid IS NOT NULL
    OPTIONAL MATCH (r:Repository {id: rid})
    RETURN toString(rid) AS rid,
           coalesce(r.full_name, r.name, toString(rid)) AS name,
           coalesce(r.analysis_status, "") AS status,
           changes,
           no_patch
    `,
    { dev: developerId },
  );

  if (fromFileChanges && fromFileChanges.length > 0) {
    const bad = fromFileChanges.filter(badRepo);
    return {
      known: true,
      source: "file_changes",
      repositories: fromFileChanges.length,
      incomplete: bad.length,
      incompleteNames: bad
        .map((r) => str(r.name))
        .filter(Boolean)
        .slice(0, 6),
    };
  }

  const fromEdge = await tryRows(
    graph,
    "coverage (contributed_to)",
    `
    MATCH (:Developer {id: $dev})-[:CONTRIBUTED_TO]->(r:Repository)
    OPTIONAL MATCH (fc:FileChange {repository_id: r.id})
    WITH r,
         count(fc) AS changes,
         sum(CASE WHEN fc IS NOT NULL AND (fc.patch IS NULL OR fc.patch = "")
                  THEN 1 ELSE 0 END) AS no_patch
    RETURN coalesce(r.full_name, r.name, "") AS name,
           coalesce(r.analysis_status, "") AS status,
           changes,
           no_patch
    `,
    { dev: developerId },
  );

  if (fromEdge && fromEdge.length > 0) {
    const bad = fromEdge.filter(badRepo);
    return {
      known: true,
      source: "contributed_to",
      repositories: fromEdge.length,
      incomplete: bad.length,
      incompleteNames: bad
        .map((r) => str(r.name))
        .filter(Boolean)
        .slice(0, 6),
    };
  }

  return unknown;
}

// ---- focused traversals (agent tools) ------------------------------------------

/** Follows one capability (or domain) down to the demonstrations that prove it. */
export async function readCapabilityTrace(
  graph: Graph,
  developerId: string,
  capabilityId: string,
  limit = 8,
): Promise<CapabilityTrace | { error: string }> {
  const cid = capabilityId.trim();
  if (!cid) return { error: "capability_id is required" };
  const n = Math.min(Math.max(Math.floor(limit) || 8, 1), 20);

  const [head, demos] = await Promise.all([
    tryRows(
      graph,
      "capability header",
      `
      MATCH (c:Capability {id: $cid})
      OPTIONAL MATCH (:Developer {id: $dev})-[hc:HAS_CAPABILITY]->(c)
      RETURN c.name AS name,
             coalesce(hc.level, "missing") AS level,
             coalesce(hc.evidence_count, 0) AS evidence_count
      LIMIT 1
      `,
      { dev: developerId, cid },
    ),
    tryRows(
      graph,
      "capability demonstrations",
      `
      MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability)
      WHERE c.id = $cid OR c.parent_id = $cid
      OPTIONAL MATCH (x)-[:IN_REPOSITORY]->(r:Repository)
      OPTIONAL MATCH (x)-[:IN_CONTEXT]->(ctx:EngineeringContext)
      OPTIONAL MATCH (x)-[:USES]->(s:Skill)
      WITH x, c, r, ctx, collect(DISTINCT s.name) AS skills
      RETURN x.id AS id,
             c.id AS capability_id,
             x.technique AS technique,
             coalesce(x.depth, "usage") AS depth,
             coalesce(x.modifiers, "") AS modifiers,
             coalesce(r.full_name, r.name, "") AS repository,
             coalesce(x.path, "") AS path,
             coalesce(x.start_line, 0) AS start_line,
             coalesce(x.end_line, 0) AS end_line,
             coalesce(x.permalink, "") AS permalink,
             coalesce(x.commit_subject, "") AS commit_subject,
             coalesce(x.change_intent, "") AS change_intent,
             coalesce(ctx.name, "") AS layer,
             coalesce(x.snippet, "") AS snippet,
             skills,
             coalesce(x.created_at, "") AS created_at
      ORDER BY x.depth_rank DESC, x.created_at DESC
      LIMIT ${n}
      `,
      { dev: developerId, cid },
    ),
  ]);

  if (!head || head.length === 0) {
    return { error: `unknown capability "${cid}"` };
  }
  if (!demos) return { error: "demonstration read failed" };

  const experiences =
    (await readExperiencesByCapability(graph, developerId, [cid])).get(cid) ??
    [];
  const proofs = await readProofs(
    graph,
    experiences.map((e) => e.id),
  );
  for (const e of experiences) e.proof = proofs.get(e.id) ?? null;

  const level = asLevel(head[0].level);
  return {
    capabilityId: cid,
    name: str(head[0].name),
    level,
    state: evidenceStateFor(level),
    evidenceCount: num(head[0].evidence_count),
    experiences,
    demonstrations: demos.map((r) => ({
      id: str(r.id),
      capabilityId: str(r.capability_id),
      technique: str(r.technique),
      depth: str(r.depth) || "usage",
      modifiers: str(r.modifiers).split(" | ").filter(Boolean),
      repository: str(r.repository),
      path: str(r.path),
      startLine: cleanRange(r.start_line, r.end_line).start,
      endLine: cleanRange(r.start_line, r.end_line).end,
      permalink: cleanRange(r.start_line, r.end_line).ok
        ? str(r.permalink)
        : "",
      commitSubject: str(r.commit_subject),
      changeIntent: str(r.change_intent),
      layer: str(r.layer),
      snippet: str(r.snippet),
      skills: strList(r.skills),
      createdAt: str(r.created_at),
    })),
  };
}

/** Follows one project: which experiences and capabilities were built there. */
export async function readRepositoryTrace(
  graph: Graph,
  developerId: string,
  repository: string,
): Promise<RepositoryTrace | { error: string }> {
  const q = repository.trim().toLowerCase();
  if (!q) return { error: "repository is required" };

  const result = await tryRows(
    graph,
    "repository trace",
    `
    MATCH (d:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)-[:OCCURS_IN]->(r:Repository)
    WHERE toLower(coalesce(r.full_name, r.name, "")) CONTAINS $q
    OPTIONAL MATCH (e)-[:DEMONSTRATES_CAPABILITY]->(c:Capability)
    RETURN coalesce(r.full_name, r.name) AS repository,
           e.id AS id,
           e.technique AS technique,
           coalesce(c.id, "") AS capability_id,
           coalesce(c.name, "") AS capability,
           coalesce(e.best_depth, "usage") AS depth,
           coalesce(e.evidence_count, 0) AS evidence,
           coalesce(e.first_seen, "") AS first_seen,
           coalesce(e.last_seen, "") AS last_seen
    ORDER BY evidence DESC
    LIMIT 40
    `,
    { dev: developerId, q },
  );
  if (!result) return { error: "repository read failed" };

  const byRepo = new Map<string, RepositoryTrace["matches"][number]>();
  for (const r of result) {
    const name = str(r.repository);
    const entry = byRepo.get(name) ?? { repository: name, experiences: [] };
    entry.experiences.push({
      id: str(r.id),
      technique: str(r.technique),
      capabilityId: str(r.capability_id),
      capability: str(r.capability),
      depth: str(r.depth),
      evidenceCount: num(r.evidence),
      firstSeen: str(r.first_seen),
      lastSeen: str(r.last_seen),
    });
    byRepo.set(name, entry);
  }

  return { query: repository, matches: [...byRepo.values()] };
}

// ============================================================
// EXPLAINING THE GRAPH WALK IN WORDS
//
// These builders turn the real numbers of one developer into sentences that
// say what FalkorDB did: where the traversal started, which edges it followed,
// what it read off those edges, and why that is cheaper than a flat table.
// They are also careful about what the graph cannot claim: the evidence is
// produced by pattern detectors, so every explanation says "detected" and
// never "proved" or "guessed nothing". Nothing here touches the database.
// ============================================================

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

function explainSelf(self: SelfReadout): string {
  const t = self.totals;
  return (
    `FalkorDB started at your Developer node and followed AUTHORED_CODE edges out to ${plural(t.fileChanges, "FileChange node")} ` +
    `(${plural(t.commits, "commit")} across ${plural(t.repositories, "repository", "repositories")}). ` +
    `From the same starting node it followed DEMONSTRATED edges to ${plural(t.demonstrations, "Demonstration")} and EXPERIENCED edges to ${plural(t.experiences, "Experience")}. ` +
    `The layers, intents, technologies and repositories in this section come from one more hop each: from an Experience to its EngineeringContext, its Technology and its Repository. ` +
    `Every hop follows a stored edge, so FalkorDB only touched your own part of the graph and never had to search other people's data.`
  );
}

function explainCapabilities(
  caps: BuiltCapability[],
  self: SelfReadout,
): string {
  const built = caps.filter((c) => c.state === "demonstrated").length;
  const partial = caps.filter((c) => c.state === "partial").length;
  const techniques = caps.reduce((n, c) => n + c.techniques.length, 0);
  return (
    `FalkorDB followed ${plural(caps.length, "HAS_CAPABILITY edge")} out of your Developer node. ` +
    `Each of those edges already stores the roll-up that was written at sync time: level, evidence count, commit count, repository count, active days, first and last seen. ` +
    `So the level of every skill (${built} with a mechanism detected, ${partial} only used) was read straight off the edge, not recomputed from your ${self.totals.demonstrations} detections. ` +
    `One more hop along SPECIALIZES gave each skill its domain. ` +
    `A second traversal, Developer to Demonstration to Capability, grouped the evidence by technique and collected the hardening habits seen in your code (${plural(techniques, "technique")} in total). ` +
    `The levels themselves were assigned at sync time by rule-based detectors, so they describe patterns found in your diffs, not a verified skill assessment.`
  );
}

function explainProof(caps: BuiltCapability[], proofCount: number): string {
  const repos = new Set(
    caps.flatMap((c) => c.proofs.map((p) => p.repository)).filter(Boolean),
  );
  return (
    `For every skill, FalkorDB walked backwards from the Capability node along OF_CAPABILITY edges to the Demonstration nodes that support it, ` +
    `then one hop on IN_REPOSITORY to the repository. It ordered them by depth and recency and kept the strongest few: ${plural(proofCount, "example")} across ${plural(repos.size, "repository", "repositories")}. ` +
    `Each Demonstration stores the file path, line range, commit subject, snippet and GitHub permalink, so a claim like "strong at REST API design" is exactly one hop away from the code that triggered it. ` +
    `You can open those links and judge the code yourself; a detection shows a pattern was present, not that it was well designed. ` +
    `Experiences were reached the same way, through SUPPORTED_BY edges.`
  );
}

function explainStrengths(strengths: JourneyStrength[]): string {
  const core = strengths.filter((s) => s.tier === "core").length;
  const solid = strengths.filter((s) => s.tier === "solid").length;
  const emerging = strengths.filter((s) => s.tier === "emerging").length;
  const tentative = strengths.filter((s) => s.tentative);
  return (
    `No new query ran here. The rules read the properties FalkorDB had already returned from the HAS_CAPABILITY edges: ` +
    `level "strong" means core (${core}), "implementation" means solid (${solid}), "repeated_usage" means emerging (${emerging}). ` +
    `No language model is involved, so the result is repeatable, but the rules judge detector output, so the tiers are only as good as the detectors. ` +
    (tentative.length
      ? `${plural(tentative.length, "strength")} (${tentative.map((s) => s.name).join(", ")}) rest on very little evidence and are marked tentative.`
      : `Every listed strength has at least ${MIN_DETECTIONS_FOR_CONFIDENCE} detections across ${MIN_COMMITS_FOR_CONFIDENCE} or more commits.`)
  );
}

function explainTimeline(timeline: TimelinePoint[]): string {
  const months = new Set(timeline.map((t) => t.month)).size;
  return (
    `FalkorDB went from your Developer node along DEMONSTRATED edges to each Demonstration, read its created_at, hopped along OF_CAPABILITY to the skill, ` +
    `and grouped the results by month and skill inside the query itself (count and best depth). ` +
    `That produced ${plural(timeline.length, "month-and-skill point")} over ${plural(months, "month")}, showing when each skill was first detected and how deep it got.`
  );
}

function explainRepositories(
  repos: JourneyRepository[],
  touched: number,
): string {
  const gap =
    touched > repos.length
      ? ` You committed to ${touched} repositories in total; the other ${touched - repos.length} produced no detected evidence, which means the detectors saw nothing there, not that no work happened.`
      : "";
  return (
    `Starting from your Experience nodes, FalkorDB followed OCCURS_IN to each Repository and DEMONSTRATES_CAPABILITY to each Capability, ` +
    `then grouped by repository. That gave ${plural(repos.length, "project")} with the skills and techniques detected inside each. ` +
    `It is the same graph read from the other side: from a project to its skills instead of from a skill to its projects.` +
    gap
  );
}

function explainCoverage(cov: Coverage, touched: number): string {
  if (!cov.known) {
    return (
      `Coverage could not be determined: neither your FileChange nodes nor a CONTRIBUTED_TO edge returned any repositories to check, ` +
      `even though ${plural(touched, "repository", "repositories")} appear in your totals. ` +
      `So how much of your history was readable is unknown. Treat missing evidence as "not seen", never as "cannot do it".`
    );
  }
  const via =
    cov.source === "file_changes"
      ? "grouped your AUTHORED_CODE file changes by repository"
      : "followed CONTRIBUTED_TO edges to your repositories";
  return (
    `FalkorDB ${via}, giving ${plural(cov.repositories, "repository", "repositories")}, and counted how many file changes in each had a stored patch. ` +
    (cov.incomplete === 0
      ? `Every one had a readable patch for most of its changes, so gaps in the evidence are unlikely to come from unreadable data (they can still come from patterns the detectors do not know).`
      : `${plural(cov.incomplete, "repository", "repositories")} (${cov.incompleteNames.join(", ")}) were only partly readable, so gaps there mean "not seen", not "cannot do it".`)
  );
}

function explainWhole(
  self: SelfReadout,
  caps: BuiltCapability[],
  strengths: JourneyStrength[],
): string {
  const t = self.totals;
  const core = strengths
    .filter((s) => s.tier === "core" && !s.tentative)
    .map((s) => s.name);
  return (
    `Your GitHub history is stored in FalkorDB as a graph, not as rows. ` +
    `${plural(t.commits, "commit")} became ${plural(t.fileChanges, "FileChange node")}; rule-based detectors then scanned the added code in them and recorded ${plural(t.demonstrations, "Demonstration node")} wherever a known pattern matched, ` +
    `each linked to a Capability, a Repository and the exact diff. Detections of the same skill and technique were grouped into ${plural(t.experiences, "Experience node")}, ` +
    `and everything for a skill was rolled up onto one HAS_CAPABILITY edge between you and that skill. ` +
    `This journey is read by walking those edges: from you to your ${plural(caps.length, "capability", "capabilities")}, from each capability down to the code that triggered it, ` +
    `and from each project to what was detected there. ` +
    (core.length
      ? `The skills marked core (${core.join(", ")}) are the ones where a hardened mechanism was detected in two or more separate commits. `
      : "") +
    `Levels, counts and tiers are stored properties produced by deterministic rules, so they are repeatable and every one can be followed to a file, a line range and a GitHub permalink. ` +
    `They are still inferences from code patterns, not a verdict on how well you build things; see limitations.`
  );
}

/** Honest limits of what the journey can claim. */
function buildLimitations(
  self: SelfReadout,
  caps: BuiltCapability[],
  strengths: JourneyStrength[],
  repositories: JourneyRepository[],
  coverage: Coverage,
): string[] {
  const out: string[] = [];

  out.push(
    "Capabilities are inferred by pattern detectors over the added lines of your diffs. The rules are deterministic and repeatable, but they are heuristics: a pattern can match without the code being good, and good work written in a way the detectors do not recognise is not seen.",
  );
  out.push(
    "Levels (usage, implementation, strong) and tiers (core, solid, emerging) are Pathway's own thresholds, not an industry standard or a peer-reviewed assessment.",
  );

  const tentative = strengths.filter((s) => s.tentative);
  if (tentative.length) {
    out.push(
      `Tentative strengths with very little evidence: ${tentative
        .map(
          (s) =>
            `${s.name} (${s.evidenceCount} detection${s.evidenceCount === 1 ? "" : "s"}, ${s.commitCount} commit${s.commitCount === 1 ? "" : "s"})`,
        )
        .join("; ")}.`,
    );
  }

  const unverified = caps.filter((c) => c.state === "unverified");
  if (unverified.length) {
    out.push(
      `Single sightings that are not enough to judge: ${unverified.map((c) => c.name).join(", ")}.`,
    );
  }

  if (!coverage.known) {
    out.push(
      "Coverage could not be determined, so it is unknown how much of your history was readable.",
    );
  } else if (coverage.incomplete > 0) {
    out.push(
      `Some history was only partly readable (${coverage.incompleteNames.join(", ")}); evidence there may be missing.`,
    );
  }

  const touched = self.totals.repositories;
  if (touched > repositories.length) {
    out.push(
      `${touched} repositories were touched but only ${repositories.length} contain detected evidence. The rest are not evidence of absence.`,
    );
  }

  out.push(
    "Missing evidence always means 'not seen', never 'cannot do it'. Skills built outside GitHub, in private repositories that were not synced, or older than the sync window are not represented.",
  );

  return out;
}

// ============================================================
// THE JOURNEY: assemble every section
//
//   1. exists?        Developer node
//   2. self           totals, layers, intents, technologies, top experiences
//   3. capabilities   HAS_CAPABILITY (+ techniques from Demonstrations)
//   4. proof          Demonstration + Experience traversals per capability
//   5. strengths      pure rules over (3)
//   6. timeline       Demonstration.created_at grouped by month
//   7. repositories   Experience -[OCCURS_IN]-> Repository
//   8. coverage       how much history was readable
//
// Each section is appended to `provenance` with the graph path that produced
// it AND a plain-English explanation of what FalkorDB did, so the response
// explains how every part was derived.
// ============================================================

export async function readJourney(
  graph: Graph,
  developerId: string,
): Promise<Journey | null> {
  await ensureJourneySchema(graph);

  const exists = await tryRows(
    graph,
    "developer exists",
    `MATCH (d:Developer {id: $dev}) RETURN d.id AS id LIMIT 1`,
    { dev: developerId },
  );
  if (!exists || exists.length === 0) return null;

  const provenance: GraphStep[] = [];
  const step = (s: GraphStep) => provenance.push(s);

  const [self, capsRead, timelineRead, reposRead, coverage] = await Promise.all(
    [
      readSelf(graph, developerId),
      readCapabilityRows(graph, developerId),
      readTimeline(graph, developerId),
      readJourneyRepositories(graph, developerId),
      readCoverage(graph, developerId),
    ],
  );

  if (!capsRead) throw new Error("capability read failed");
  const capabilities = capsRead;

  step({
    section: "self",
    question: "What does this developer's work look like overall?",
    pattern:
      "(Developer)-[AUTHORED_CODE]->(FileChange); (Developer)-[EXPERIENCED]->(Experience)-[IN_CONTEXT|USES_TECHNOLOGY]->(...)",
    rows: self.topExperiences.length,
    why: "Totals and the shape of the work: layers, intents, technologies, strongest experiences.",
    explanation: explainSelf(self),
    falkordb: [
      "Property graph: Developer, FileChange, Experience and Technology are real nodes joined by stored edges",
      "Cypher aggregation (count, sum, collect) done inside the database",
      "Traversal starts at one indexed Developer node, so other developers are never touched",
    ],
  });

  step({
    section: "capabilities",
    question:
      "Which skills were detected in this developer's code, and at what level?",
    pattern:
      "(Developer)-[HAS_CAPABILITY]->(Capability)-[SPECIALIZES]->(domain); (Developer)-[DEMONSTRATED]->(Demonstration)-[OF_CAPABILITY]->(Capability)",
    rows: capabilities.length,
    why: "HAS_CAPABILITY is the roll-up level per skill; the Demonstration side shows which techniques were detected and which hardening behaviours were observed.",
    explanation: explainCapabilities(capabilities, self),
    falkordb: [
      "Relationship properties: level and evidence counts are stored on the HAS_CAPABILITY edge",
      "One-hop traversal from Developer to Capability, one more hop to the domain",
      "Group-by over Demonstration nodes to count techniques and hardening habits",
    ],
  });

  // proof: experiences and demonstrations for every capability with evidence
  const ids = capabilities.map((c) => c.capabilityId);
  const [expByCap, proofByCap] = await Promise.all([
    readExperiencesByCapability(graph, developerId, ids),
    readCapabilityProofs(graph, developerId, ids),
  ]);

  const experiencesShown: ExperienceBrief[] = [
    ...self.topExperiences,
    ...[...expByCap.values()].flat(),
  ];
  const expProofs = await readProofs(graph, [
    ...new Set(experiencesShown.map((e) => e.id)),
  ]);
  for (const e of experiencesShown) e.proof = expProofs.get(e.id) ?? null;

  for (const c of capabilities) {
    c.experiences = expByCap.get(c.capabilityId) ?? [];
    c.proofs = proofByCap.get(c.capabilityId) ?? [];
  }

  const proofCount = [...proofByCap.values()].reduce((n, p) => n + p.length, 0);
  step({
    section: "proof",
    question: "Which code triggered each detection?",
    pattern:
      "(Capability)<-[OF_CAPABILITY]-(Demonstration)-[IN_REPOSITORY]->(Repository); (Experience)-[SUPPORTED_BY]->(Demonstration)",
    rows: proofCount,
    why: "Every skill is walked down to concrete code: repository, file, line range, GitHub permalink, snippet.",
    explanation: explainProof(capabilities, proofCount),
    falkordb: [
      "Reverse traversal: edges can be followed from the skill back to its evidence",
      "ORDER BY and slicing inside the query keep only the strongest examples per skill",
      "Evidence nodes carry permalink, path and line range, so no second lookup is needed",
    ],
  });

  const strengths = deriveStrengths(capabilities);
  step({
    section: "strengths",
    question: "What does the evidence say this developer is strongest at?",
    pattern:
      "level + evidence/commit/repo/day counts on HAS_CAPABILITY (rules: strong=core, implementation=solid, repeated_usage=emerging)",
    rows: strengths.length,
    why: "Tiers are decided by deterministic rules over the developer's own code evidence, not by an LLM and not by a blended score. They are only as reliable as the detectors behind them.",
    explanation: explainStrengths(strengths),
    falkordb: [
      "Reuses properties already stored on HAS_CAPABILITY edges; no extra query",
    ],
  });

  const timeline = timelineRead ?? [];
  step({
    section: "timeline",
    question: "When did each skill first appear and grow?",
    pattern:
      "(Developer)-[DEMONSTRATED]->(Demonstration {created_at})-[OF_CAPABILITY]->(Capability), grouped by month",
    rows: timeline.length,
    why: "Shows when each skill was first detected and how deep it got over time.",
    explanation: explainTimeline(timeline),
    falkordb: [
      "Two-hop traversal with a filter on a node property (created_at)",
      "Grouping by month and skill is done in Cypher, so only summary rows leave the database",
    ],
  });

  const repositories = reposRead ?? [];
  step({
    section: "repositories",
    question: "What was detected in which project?",
    pattern:
      "(Developer)-[EXPERIENCED]->(Experience)-[OCCURS_IN]->(Repository); (Experience)-[DEMONSTRATES_CAPABILITY]->(Capability)",
    rows: repositories.length,
    why: "What was detected where: per project, the capabilities and techniques it contains.",
    explanation: explainRepositories(repositories, self.totals.repositories),
    falkordb: [
      "The same graph read from the project side",
      "collect(DISTINCT ...) gathers each project's skills and techniques in one pass",
    ],
  });

  step({
    section: "coverage",
    question: "Was any of the history unreadable?",
    pattern:
      coverage.source === "contributed_to"
        ? "(Developer)-[CONTRIBUTED_TO]->(Repository)<-(FileChange {patch})"
        : "(Developer)-[AUTHORED_CODE]->(FileChange {repository_id, patch}) grouped by repository",
    rows: coverage.repositories,
    why: "Tells you whether anything was skipped. Missing evidence means 'not seen', never 'cannot do it'.",
    explanation: explainCoverage(coverage, self.totals.repositories),
    falkordb: [
      "Grouping file changes by repository inside the query, so coverage is computed from the same nodes as the totals",
      "Optional match to attach each repository's sync status when the node exists",
    ],
  });

  return {
    developerId,
    self,
    summary: {
      capabilitiesWithEvidence: capabilities.length,
      built: capabilities.filter((c) => c.state === "demonstrated").length,
      partial: capabilities.filter((c) => c.state === "partial").length,
      strengths: strengths.length,
      provenStrengths: strengths.filter((s) => s.tier !== "emerging").length,
      repositories: repositories.length,
      repositoriesTouched: self.totals.repositories,
    },
    capabilities,
    strengths,
    domains: summariseDomains(capabilities),
    timeline,
    repositories,
    coverage,
    howFalkorDBAnswered: explainWhole(self, capabilities, strengths),
    limitations: buildLimitations(
      self,
      capabilities,
      strengths,
      repositories,
      coverage,
    ),
    provenance,
  };
}

// ============================================================
// D. GOAL FRONTIER
//
// NOT part of the journey. Kept only because the goal / mission / chat agents
// (get_learning_frontier, find_bridge_path) still import it. The journey API,
// the journey agent and the journey tools never call anything below.
// It relies on PREREQUISITE_OF edges that the knowledge graph builder creates;
// this file only reads them.
// ============================================================

export type FrontierStatus = "demonstrated" | "eligible" | "blocked";

export interface PrerequisiteReadout {
  capabilityId: string;
  name: string;
  level: CapLevel;
  state: EvidenceState;
  /** true when this prerequisite's state is in PREREQUISITE_SATISFIED_BY */
  satisfied: boolean;
  evidenceCount: number;
  experiences: ExperienceBrief[];
}

/** One hardening behaviour a technique is expected to show. */
export interface SafeguardCriterion {
  label: string;
  seen: boolean;
}

/** One technique the taxonomy expects for a capability, and what the developer built. */
export interface TechniqueCriterion {
  ruleId: string;
  technique: string;
  built: number;
  bestDepth: string;
  permalink: string;
  path: string;
  safeguards: SafeguardCriterion[];
}

export interface FrontierNode {
  capabilityId: string;
  name: string;
  description: string;
  domain: string;
  status: FrontierStatus;
  state: EvidenceState;
  level: CapLevel;
  evidenceCount: number;
  commitCount: number;
  repoCount: number;
  activeDays: number;
  firstSeen: string;
  lastSeen: string;
  recency: string;
  requiredByGoal: boolean;
  priority: number;
  reason: string;
  criteriaMet: boolean;
  unmetCriteria: string[];
  prerequisites: PrerequisiteReadout[];
  unlocks: string[];
  routes: Array<{
    goalCapabilityId: string;
    goalCapabilityName: string;
    ids: string[];
    names: string[];
  }>;
}

/**
 * Pure mirror of the status CASE in FRONTIER_QUERY.
 *   demonstrated  own evidence says so
 *   eligible      not demonstrated, every direct prerequisite satisfied
 *   blocked       not demonstrated, some direct prerequisite not satisfied
 */
export function deriveFrontierStatus(
  level: CapLevel,
  prerequisites: Array<{ level: CapLevel }>,
): FrontierStatus {
  if (levelsInStates(["demonstrated"]).includes(level)) return "demonstrated";
  const satisfying = new Set<string>(levelsInStates(PREREQUISITE_SATISFIED_BY));
  return prerequisites.every((p) => satisfying.has(p.level))
    ? "eligible"
    : "blocked";
}

/**
 * Is one capability "done" by explicit criteria? Missing evidence only ever
 * makes this FALSE, never TRUE.
 */
export function evaluateCapabilityCriteria(
  level: CapLevel,
  techniques: TechniqueCriterion[],
): { met: boolean; unmet: string[] } {
  const unmet: string[] = [];

  if (techniques.length === 0) {
    unmet.push("No explicit criteria exist for this capability");
  }
  if (evidenceStateFor(level) !== "demonstrated") {
    unmet.push("Build the mechanism yourself (only used or unseen so far)");
  }
  if (techniques.length > 0 && !techniques.some((t) => t.built > 0)) {
    unmet.push("Build at least one of the expected techniques");
  }
  for (const t of techniques) {
    if (t.built === 0) continue;
    for (const s of t.safeguards) {
      if (!s.seen) unmet.push(`${t.technique}: ${s.label}`);
    }
  }

  return { met: unmet.length === 0, unmet };
}

/** A goal is complete only when every explicit criterion is satisfied. */
export function isGoalComplete(
  nodes: Array<{
    status: FrontierStatus;
    requiredByGoal: boolean;
    criteriaMet: boolean;
  }>,
  unsupported: string[],
): boolean {
  const required = nodes.filter((n) => n.requiredByGoal);
  return (
    nodes.length > 0 &&
    required.length > 0 &&
    unsupported.length === 0 &&
    nodes.every((n) => n.status === "demonstrated") &&
    required.every((n) => n.criteriaMet)
  );
}

/**
 * Collects the direct prerequisites of `c` with the developer's evidence for
 * each. Expects `d` (Developer) and `c` (Capability) in scope plus the scalars
 * listed in `carry`. Ends with `prereqs`: a list of {id, name, level, evidence, met}.
 */
export const PREREQUISITE_CHECK = (carry: string) => `
  OPTIONAL MATCH (p:Capability)-[:PREREQUISITE_OF]->(c)
  OPTIONAL MATCH (d)-[pc:HAS_CAPABILITY]->(p)
  WITH ${carry},
       CASE WHEN p IS NULL THEN null
            ELSE {
              id: p.id,
              name: p.name,
              level: coalesce(pc.level, "missing"),
              evidence: coalesce(pc.evidence_count, 0),
              met: coalesce(pc.level, "missing") IN $satisfying
            } END AS pre
  WITH ${carry}, collect(pre) AS prereqs
`;

export const FRONTIER_QUERY = `
  MATCH (d:Developer {id: $dev})
  OPTIONAL MATCH (d)-[done_edge:HAS_CAPABILITY]->(done_cap:Capability)
  WHERE done_edge.level IN $demonstrated
  WITH d, collect(done_cap.id) AS done

  MATCH (d)-[:HAS_GOAL]->(:Goal)-[req:REQUIRES]->(r:Capability)
  OPTIONAL MATCH (leaf:Capability)-[:SPECIALIZES*1..3]->(r)
  WITH d, done, req,
       CASE WHEN r.parent_id = "" THEN leaf ELSE r END AS goal_cap
  WHERE goal_cap IS NOT NULL

  MATCH path = (c:Capability)-[:PREREQUISITE_OF*0..${MAX_PREREQUISITE_DEPTH}]->(goal_cap)
  WHERE size([n IN nodes(path)[1..] WHERE n.id IN done]) = 0
  WITH d, c, goal_cap, req, length(path) AS hops,
       [n IN nodes(path) | n.id] AS route_ids,
       [n IN nodes(path) | n.name] AS route_names
  ORDER BY hops ASC
  WITH d, c,
       collect({
         goal_id: goal_cap.id,
         goal_name: goal_cap.name,
         priority: coalesce(req.priority, 0.0),
         reason: coalesce(req.reason, ""),
         ids: route_ids,
         names: route_names
       }) AS routes

  OPTIONAL MATCH (d)-[hc:HAS_CAPABILITY]->(c)
  WITH d, c, routes,
       coalesce(hc.level, "missing") AS lvl,
       coalesce(hc.evidence_count, 0) AS ev,
       coalesce(hc.commit_count, 0) AS cm,
       coalesce(hc.repo_count, 0) AS rp,
       coalesce(hc.active_days, 0) AS ad,
       coalesce(hc.first_seen, "") AS fs,
       coalesce(hc.last_seen, "") AS ls,
       coalesce(hc.recency, "") AS rec
  ${PREREQUISITE_CHECK("d, c, routes, lvl, ev, cm, rp, ad, fs, ls, rec")}
  OPTIONAL MATCH (c)-[:SPECIALIZES]->(dom:Capability)
  RETURN c.id AS capability_id,
         c.name AS name,
         coalesce(c.description, "") AS description,
         coalesce(dom.name, "") AS domain,
         lvl AS level,
         ev AS evidence_count,
         cm AS commit_count,
         rp AS repo_count,
         ad AS active_days,
         fs AS first_seen,
         ls AS last_seen,
         rec AS recency,
         any(route IN routes WHERE route.goal_id = c.id) AS required_by_goal,
         coalesce(head([route IN routes WHERE route.goal_id = c.id | route.priority]), 0.0) AS priority,
         coalesce(head([route IN routes WHERE route.goal_id = c.id | route.reason]), "") AS reason,
         prereqs,
         routes,
         CASE WHEN lvl IN $demonstrated THEN "demonstrated"
              WHEN size([x IN prereqs WHERE NOT x.met]) = 0 THEN "eligible"
              ELSE "blocked" END AS status
`;

const asStatus = (v: unknown): FrontierStatus => {
  const s = str(v);
  return s === "demonstrated" || s === "eligible" ? s : "blocked";
};

const byNameThenId = (
  a: { name: string; capabilityId: string },
  b: { name: string; capabilityId: string },
): number =>
  a.name.localeCompare(b.name) || a.capabilityId.localeCompare(b.capabilityId);

export async function readFrontier(
  graph: Graph,
  developerId: string,
): Promise<FrontierNode[]> {
  return (await readFrontierChecked(graph, developerId)) ?? [];
}

/** Same as readFrontier(), but returns null when the query FAILED. */
export async function readFrontierChecked(
  graph: Graph,
  developerId: string,
): Promise<FrontierNode[] | null> {
  const result = await tryRows(graph, "goal frontier", FRONTIER_QUERY, {
    dev: developerId,
    satisfying: levelsInStates(PREREQUISITE_SATISFIED_BY),
    demonstrated: levelsInStates(["demonstrated"]),
  });
  if (!result) return null;

  const nodes: FrontierNode[] = result.map((r) => {
    const level = asLevel(r.level);
    const status = asStatus(r.status);
    const requiredByGoal = r.required_by_goal === true;

    const seenGoals = new Set<string>();
    const routes = mapList(r.routes).flatMap((route) => {
      const goalId = str(route.goal_id);
      if (!goalId || seenGoals.has(goalId)) return [];
      seenGoals.add(goalId);
      return [
        {
          goalCapabilityId: goalId,
          goalCapabilityName: str(route.goal_name),
          ids: strList(route.ids),
          names: strList(route.names),
        },
      ];
    });

    const node: FrontierNode = {
      capabilityId: str(r.capability_id),
      name: str(r.name),
      description: str(r.description),
      domain: str(r.domain),
      status,
      state: evidenceStateFor(level),
      level,
      evidenceCount: num(r.evidence_count),
      commitCount: num(r.commit_count),
      repoCount: num(r.repo_count),
      activeDays: num(r.active_days),
      firstSeen: str(r.first_seen),
      lastSeen: str(r.last_seen),
      recency: str(r.recency),
      requiredByGoal,
      priority: num(r.priority),
      reason: str(r.reason),
      criteriaMet: requiredByGoal ? false : status === "demonstrated",
      unmetCriteria: [],
      prerequisites: mapList(r.prereqs)
        .map((p) => {
          const pl = asLevel(p.level);
          return {
            capabilityId: str(p.id),
            name: str(p.name),
            level: pl,
            state: evidenceStateFor(pl),
            satisfied: p.met === true,
            evidenceCount: num(p.evidence),
            experiences: [] as ExperienceBrief[],
          };
        })
        .sort(byNameThenId),
      unlocks: [],
      routes,
    };

    const derived = deriveFrontierStatus(level, node.prerequisites);
    if (derived !== status) {
      log("frontier status mismatch", {
        capabilityId: node.capabilityId,
        cypher: status,
        derived,
      });
    }

    return node;
  });

  for (const node of nodes) {
    node.unlocks = nodes
      .filter((o) =>
        o.prerequisites.some((p) => p.capabilityId === node.capabilityId),
      )
      .map((o) => o.name)
      .sort((a, b) => a.localeCompare(b));
  }

  return nodes.sort(byNameThenId);
}

/** Every eligible capability on the map. No ranking. */
export function eligibleNextSteps(frontier: FrontierNode[]): FrontierNode[] {
  return frontier.filter((n) => n.status === "eligible");
}

export interface DirectionMove {
  capabilityId: string;
  name: string;
  kind: "deepen" | "extend";
  state: EvidenceState;
  level: CapLevel;
  builtOn: Array<{ id: string; name: string; level: CapLevel }>;
  unlocks: string[];
}

export interface DirectionReadout {
  domainId: string;
  domain: string;
  moves: DirectionMove[];
}

export async function readDirections(
  graph: Graph,
  developerId: string,
): Promise<DirectionReadout[]> {
  await ensureJourneySchema(graph);

  const result = await tryRows(
    graph,
    "directions",
    `
    MATCH (d:Developer {id: $dev})
    OPTIONAL MATCH (d)-[done_edge:HAS_CAPABILITY]->(done_cap:Capability)
    WHERE done_edge.level IN $demonstrated
    WITH d, collect(done_cap.id) AS done

    MATCH (c:Capability)
    WHERE c.parent_id <> "" AND NOT c.id IN done
    OPTIONAL MATCH (c)-[:PREREQUISITE_OF*1..${MAX_PREREQUISITE_DEPTH}]->(later:Capability)
    WHERE later.id IN done
    WITH d, c, done, count(later) AS proven_later
    WHERE proven_later = 0

    OPTIONAL MATCH (d)-[hc:HAS_CAPABILITY]->(c)
    WITH d, c, coalesce(hc.level, "missing") AS lvl
    ${PREREQUISITE_CHECK("d, c, lvl")}
    WITH c, lvl, prereqs
    WHERE size([x IN prereqs WHERE NOT x.met]) = 0

    OPTIONAL MATCH (c)-[:PREREQUISITE_OF]->(nx:Capability)
    WITH c, lvl, prereqs, collect(DISTINCT nx.name) AS unlocks
    OPTIONAL MATCH (c)-[:SPECIALIZES]->(dom:Capability)
    RETURN c.id AS capability_id,
           c.name AS name,
           lvl AS level,
           coalesce(dom.id, "") AS domain_id,
           coalesce(dom.name, "") AS domain,
           prereqs,
           unlocks
    `,
    {
      dev: developerId,
      satisfying: levelsInStates(PREREQUISITE_SATISFIED_BY),
      demonstrated: levelsInStates(["demonstrated"]),
    },
  );

  const byDomain = new Map<string, DirectionReadout>();
  for (const r of result ?? []) {
    const domainId = str(r.domain_id);
    if (!domainId) continue;

    let direction = byDomain.get(domainId);
    if (!direction) {
      direction = { domainId, domain: str(r.domain), moves: [] };
      byDomain.set(domainId, direction);
    }

    const level = asLevel(r.level);
    const state = evidenceStateFor(level);
    direction.moves.push({
      capabilityId: str(r.capability_id),
      name: str(r.name),
      kind: state === "partial" ? "deepen" : "extend",
      state,
      level,
      builtOn: mapList(r.prereqs)
        .map((p) => ({
          id: str(p.id),
          name: str(p.name),
          level: asLevel(p.level),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      unlocks: strList(r.unlocks).sort((a, b) => a.localeCompare(b)),
    });
  }

  return [...byDomain.values()]
    .map((d) => ({
      ...d,
      moves: d.moves.sort(
        (a, b) =>
          a.name.localeCompare(b.name) ||
          a.capabilityId.localeCompare(b.capabilityId),
      ),
    }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
}
