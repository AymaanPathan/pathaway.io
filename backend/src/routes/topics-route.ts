import { Router } from "express";
import type { Graph } from "../db/falkordb.js";
import { getGraphForDeveloper } from "../db/falkordb.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import {
  analyzeDeveloperDepth,
  createDepthLlmFromEnv,
  explainTopicEvidence,
  reanalyzeTopicDepth,
} from "../agents/depth-analyzer-agent.js";
import {
  DEPTH_ANALYSIS_VERSION,
  DEPTH_BANDS,
  DEPTH_LEVELS,
  DEPTH_RANK,
  ensureDepthSchema,
  findTopicsByText,
  readDeveloperTopicProfile,
  readLearningFrontier,
  readTaxonomyEdges,
  readTopicDepthDetail,
  readTopicGraphEvidence,
  readTopicLearningGraph,
  readTopicPathDetailed,
  slugify,
  type Authenticity,
  type DepthLevel,
  type DepthProfileSummary,
  type ProgressFn,
  type TopicDepthSummary,
} from "../graph/depth-analyzer-graph.js";

export const topicsRouter = Router();

type Row = Record<string, any>;
type Query = Record<string, unknown>;

const LOG = "[topics-route]";
const CACHE_MS = 30_000;
// Three different things are never collapsed into one number:
//   taxonomy importance (PageRank / betweenness / community: structure of the shared taxonomy),
//   developer proficiency (level / score / authenticity: judged from evidence),
//   assessment confidence (strength + diversity of evidence).
const MAX_JOB_MS = 15 * 60_000;
const SLUG = /^[a-z0-9_]{1,60}$/;

const flag = (v: unknown): boolean => v === "1" || v === "true";
const off = (v: unknown): boolean => v === "0" || v === "false";
const str = (v: unknown, fallback = ""): string =>
  v == null || typeof v === "object" ? fallback : String(v).trim();
const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const nullableNum = (v: unknown): number | null =>
  v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const round = (v: number, digits = 2): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));
const uniq = <T>(items: T[]): T[] => [...new Set(items)];
const humanize = (s: string): string =>
  s ? s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Other";
const avg = (items: number[]): number =>
  items.length
    ? Math.round(items.reduce((a, b) => a + b, 0) / items.length)
    : 0;
const asRows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
const asArray = <T = unknown>(v: unknown): T[] =>
  Array.isArray(v) ? (v as T[]) : [];

const NOT_SYNCED = {
  error: "No topics yet: this developer has not been synced.",
};

async function cypher(
  graph: Graph,
  label: string,
  query: string,
  params: Row = {},
): Promise<Row[] | null> {
  try {
    const result = await graph.query(query, { params });
    return (result.data ?? []) as Row[];
  } catch (error) {
    console.error(
      `${LOG} ${label} failed:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

const LEVEL_META: Record<
  DepthLevel,
  { label: string; meaning: string; color: string }
> = {
  none: {
    label: "None",
    meaning: "No real evidence of this topic in authored code.",
    color: "#9ca3af",
  },
  surface: {
    label: "Surface",
    meaning:
      "Touched, imported or configured. A single sighting, copied boilerplate, or library defaults.",
    color: "#f59e0b",
  },
  working: {
    label: "Working",
    meaning:
      "Used correctly in real features and repeated, but relying on defaults with no visible design decisions.",
    color: "#3b82f6",
  },
  proficient: {
    label: "Proficient",
    meaning:
      "Deliberate decisions are visible (configuration, error paths, cleanup, limits) across several contexts, with signs of iteration or tests.",
    color: "#8b5cf6",
  },
  deep: {
    label: "Deep",
    meaning:
      "Built or composed the mechanism themselves, hardened it, evolved it after problems, tested it, or combined approaches with visible trade-offs.",
    color: "#10b981",
  },
};

const AUTHENTICITY_META: Record<
  Authenticity,
  { label: string; meaning: string; maxLevel: DepthLevel }
> = {
  genuine_implementation: {
    label: "Genuine implementation",
    meaning: "They implemented the mechanism or made real design decisions.",
    maxLevel: "deep",
  },
  working_usage: {
    label: "Working usage",
    meaning: "Used properly, but not built or tuned by them.",
    maxLevel: "proficient",
  },
  incidental: {
    label: "Incidental",
    meaning: "Appears as a side effect: a transitive helper or a one-off call.",
    maxLevel: "working",
  },
  boilerplate: {
    label: "Boilerplate",
    meaning:
      "Scaffold, template or starter code, or a dependency declared but never used.",
    maxLevel: "surface",
  },
  insufficient_evidence: {
    label: "Insufficient evidence",
    meaning: "Not enough evidence to say.",
    maxLevel: "surface",
  },
};

/**
 * `role` is the single responsibility of each algorithm.
 * `affectsAssessment` is true only when the result changes a stored or displayed
 * assessment outcome (confidence factors, limitations, prerequisite status).
 * Structural algorithms describe the taxonomy; they never raise or lower proficiency.
 */
const ALGORITHMS = [
  {
    id: "pagerank",
    name: "PageRank",
    engine: "falkordb",
    call: "CALL algo.pageRank('Topic', 'BUILDS_ON')",
    scope: "Shared Topic taxonomy (no developer data)",
    relationships: ["BUILDS_ON"],
    writesProperty: "Topic.foundation_rank",
    role: "Taxonomy importance: which topics many others stand on.",
    affectsAssessment: false,
    fallback:
      "None. If it fails the score stays empty; no proxy ranking is used.",
    why: "BUILDS_ON edges point from an advanced topic to the foundation it needs. Rank therefore flows toward foundations, so a high score means many topics (directly or transitively) stand on this one. It describes taxonomy structure; it does not prove the developer has the skill.",
    howToRead:
      "High = a structurally central foundation (for example data modeling). Low = a leaf or specialised topic. Never read it as proficiency.",
    frontendUse: [
      "Badge topics as 'foundation'",
      "Order topics from foundations upward",
    ],
  },
  {
    id: "betweenness",
    name: "Betweenness centrality",
    engine: "falkordb",
    call: "CALL algo.betweenness({nodeLabels: ['Topic'], relationshipTypes: ['BUILDS_ON', 'RELATED_TOPIC']})",
    scope: "Shared Topic taxonomy (no developer data)",
    relationships: ["BUILDS_ON", "RELATED_TOPIC"],
    writesProperty: "Topic.bridge_score",
    role: "Structural bridges: topics connecting otherwise separate areas.",
    affectsAssessment: false,
    fallback: "None. If it fails the score stays empty.",
    why: "Counts how often a topic sits on the shortest path between two others. Topics that connect separate areas score high. It is a structural measure, not evidence of expertise.",
    howToRead: "High = a bridge topic. Zero = sits inside one area.",
    frontendUse: ["Badge topics as 'bridge'", "Size nodes in the graph view"],
  },
  {
    id: "label_propagation",
    name: "Label propagation (community detection)",
    engine: "falkordb",
    call: "CALL algo.labelPropagation({nodeLabels: ['Topic'], relationshipTypes: ['RELATED_TOPIC'], maxIterations: 10})",
    scope: "Shared Topic taxonomy (no developer data)",
    relationships: ["RELATED_TOPIC"],
    writesProperty: "Topic.cluster_id",
    role: "Knowledge areas: groups of tightly related sibling topics.",
    affectsAssessment: false,
    fallback: "None. If it fails topics stay unclustered.",
    why: "Finds groups of tightly related sibling topics without choosing the number of groups in advance. A group is only shown when it has at least 2 assessed topics.",
    howToRead:
      "Topics sharing a cluster_id belong to the same knowledge community. This API labels each cluster after its most foundational assessed topic.",
    frontendUse: ["Colour nodes by community", "Show 'knowledge areas'"],
  },
  {
    id: "wcc",
    name: "Weakly connected components",
    engine: "falkordb",
    call: "CALL algo.WCC({nodeLabels: ['Topic'], relationshipTypes: ['BUILDS_ON', 'RELATED_TOPIC']})",
    scope: "Shared Topic taxonomy (no developer data)",
    relationships: ["BUILDS_ON", "RELATED_TOPIC"],
    writesProperty: "Topic.component_id",
    role: "Taxonomy quality check: separates the main body from isolated topics.",
    affectsAssessment: false,
    fallback: "None. If it fails components stay empty.",
    why: "Splits the taxonomy into islands with no path between them and doubles as a data-quality check.",
    howToRead:
      "The largest component is the main knowledge graph. Small components are isolated topics.",
    frontendUse: ["Flag isolated topics"],
  },
  {
    id: "shortest_path",
    name: "Shortest path",
    engine: "cypher",
    call: "shortestPath((a)-[:BUILDS_ON|RELATED_TOPIC*1..6]->(b))",
    scope: "Native Cypher over the Topic taxonomy",
    relationships: ["BUILDS_ON", "RELATED_TOPIC"],
    writesProperty: null,
    role: "Explains how two topics connect; every hop is typed.",
    affectsAssessment: false,
    fallback: "Tries the reverse direction when the forward path is empty",
    why: "Every hop reports whether it is a foundation dependency or an association.",
    howToRead:
      "An ordered list of topics, each hop labelled BUILDS_ON or RELATED_TOPIC. A path shows connection, not skill.",
    frontendUse: ["Path highlighter between two selected nodes"],
  },
  {
    id: "foundation_traversal",
    name: "Prerequisite traversal",
    engine: "cypher",
    call: "(t:Topic)-[:BUILDS_ON*1..3]->(f:Topic)",
    scope: "Native Cypher, joined to this developer's assessments",
    relationships: ["BUILDS_ON"],
    writesProperty: null,
    role: "Which foundations a topic needs, and whether this developer's code backs them.",
    affectsAssessment: true,
    fallback: null,
    why: "Only BUILDS_ON edges with a stated reason count. The result feeds the 'foundations backed' confidence factor, the foundation-gap list and the topic's limitations.",
    howToRead:
      "Each path lists steps, the reason per hop, and whether the foundations are demonstrated, shallow or not assessed.",
    frontendUse: ["Foundation paths on the topic detail"],
  },
  {
    id: "fulltext",
    name: "Full-text index",
    engine: "index",
    call: "CALL db.idx.fulltext.queryNodes('Topic', $q)",
    scope: "Topic.name, Topic.description, Topic.aliases_text",
    relationships: [],
    writesProperty: null,
    role: "Lookup and canonical-topic reuse (deduplication).",
    affectsAssessment: false,
    fallback: "Substring match in memory when the index returns nothing",
    why: "Fast fuzzy lookup, and it lets the analyzer reuse an existing topic instead of creating a near-duplicate.",
    howToRead: "Higher score = better text match.",
    frontendUse: ["Search box"],
  },
  {
    id: "evidence_clusters",
    name: "Co-usage clustering of code atoms",
    engine: "in-process",
    call: "propagateLabels() over package/signal pairs that co-occur in commits",
    scope: "One developer's authored code (never written to the shared graph)",
    relationships: [],
    writesProperty: null,
    role: "Discovery input: groups packages and signals used together.",
    affectsAssessment: true,
    fallback: null,
    why: "Runs inside the analyzer. Groups atoms used together so topics and approaches are grounded in real usage.",
    howToRead: "Internal discovery input. Not exposed as a Topic property.",
    frontendUse: [],
  },
] as const;

const PIPELINE = [
  {
    step: 1,
    id: "atlas",
    engine: "falkordb",
    title: "Evidence atlas",
    does: "Reads authored FileChanges, commits, capabilities and experiences and condenses them into packages, code signals, vocabulary and co-usage clusters. No LLM.",
  },
  {
    step: 2,
    id: "discover",
    engine: "llm",
    title: "Discover topics",
    does: "The model proposes topics and approaches, but every package, signal and capability must exist in the atlas or it is dropped.",
  },
  {
    step: 3,
    id: "gather",
    engine: "falkordb",
    title: "Gather evidence",
    does: "Per topic: matching files, commits, demonstrations, samples, revisits, scaffold share and a deterministic baseline score.",
  },
  {
    step: 4,
    id: "judge",
    engine: "llm",
    title: "Judge depth",
    does: "The model judges level, authenticity and how each approach was implemented, citing evidence refs and separating observed, inferred and associated claims.",
  },
  {
    step: 5,
    id: "reconcile",
    engine: "deterministic",
    title: "Guard-rails",
    does: "The graph baseline, authenticity caps and an evidence-strength cap on confidence keep the model honest. Every adjustment is written into the rationale.",
  },
  {
    step: 6,
    id: "store",
    engine: "falkordb",
    title: "Persist",
    does: "Writes DepthAssessment, Approach, Topic nodes and the ASSESSED, OF_TOPIC, USES_APPROACH, BACKED_BY and KNOWS_TOPIC edges.",
  },
  {
    step: 7,
    id: "synthesize",
    engine: "llm",
    title: "Profile summary",
    does: "A headline and pattern. Falls back to a deterministic summary.",
  },
  {
    step: 8,
    id: "metrics",
    engine: "falkordb",
    title: "Topic graph metrics",
    does: "PageRank, betweenness, label propagation and WCC over the shared taxonomy.",
  },
] as const;

const BASELINE_COMPONENTS = [
  { id: "volume", max: 12, meaning: "Lines added (log scale)" },
  { id: "breadth", max: 14, meaning: "Number of files" },
  { id: "commits", max: 14, meaning: "Number of commits" },
  { id: "sustained", max: 14, meaning: "Active days and time span" },
  { id: "repos", max: 5, meaning: "Number of repositories" },
  {
    id: "ownImplementation",
    max: 20,
    meaning: "Own definitions plus detected built mechanisms",
  },
  { id: "hardening", max: 8, meaning: "Hardening behaviours observed" },
  {
    id: "maturation",
    max: 7,
    meaning: "Revisited files and fix/perf/refactor follow-ups",
  },
  { id: "tests", max: 5, meaning: "Related test files" },
  { id: "approachDiversity", max: 5, meaning: "More than one approach used" },
] as const;

const GUARD_RAILS = [
  "The final level can be at most one level above the deterministic baseline.",
  "Authenticity caps the level: genuine_implementation up to deep, working_usage up to proficient, incidental up to working, boilerplate and insufficient_evidence up to surface.",
  "When no model reviewed the code (graph baseline only), the level can never exceed proficient: counts alone are not depth.",
  "Genuine implementation is downgraded to working usage when there are no own definitions, no built mechanism and fewer than 3 files.",
  "When 70% or more of the evidence sits in scaffold-like commits the topic is marked boilerplate.",
  "Confidence follows the strength and the diversity of the evidence: fewer than 3 files or fewer than 2 commits is always low; evidence from a single repository, from fewer than three kinds, or with no directly observed work cannot be high. The model may lower confidence, never raise it above this cap. The API shows the lower of the stored value and the value re-derived from the current evidence.",
  "The score is clamped into the band of its level, and an approach can never be deeper than its topic.",
  "The baseline is reduced when evidence is mostly scaffold (x0.6), when one commit (cap 25) or one file (cap 20) touches the topic.",
  "A capability is only 'observed' when a detected demonstration in the developer's own code backs it. Without one it is 'inferred' or 'association' (taxonomy link only, reported as unknown). Related topics are never prerequisites; only BUILDS_ON edges with a stated reason form a prerequisite path.",
  "A BUILDS_ON edge without a stated reason is kept but marked untrusted and is ignored by prerequisite paths, foundation gaps and the frontier.",
  "The explainer may only write numbers that exist in the supplied facts; otherwise its output is rejected and the deterministic story is used.",
];

const ENDPOINTS = [
  { method: "GET", path: "/api/topics", purpose: "Overview dossier" },
  {
    method: "GET",
    path: "/api/topics/groups",
    purpose: "Groupings with their method",
  },
  {
    method: "GET",
    path: "/api/topics/relations",
    purpose: "How topics relate",
  },
  {
    method: "GET",
    path: "/api/topics/graph",
    purpose: "Nodes and edges for visualisation",
  },
  {
    method: "GET",
    path: "/api/topics/algorithms",
    purpose: "Algorithms used and why",
  },
  {
    method: "GET",
    path: "/api/topics/integrity",
    purpose: "Deterministic integrity checks over the graph snapshot",
  },
  { method: "GET", path: "/api/topics/search?q=", purpose: "Search" },
  {
    method: "GET",
    path: "/api/topics/path?from=&to=",
    purpose: "Shortest path with typed hops",
  },
  {
    method: "GET",
    path: "/api/topics/:slug",
    purpose:
      "Topic detail with reasoning trace, proof ledger, prerequisite paths and confidence",
  },
  {
    method: "GET",
    path: "/api/topics/:slug/trace",
    purpose: "Reproducible reasoning trace for one topic",
  },
  {
    method: "GET",
    path: "/api/topics/:slug/graph",
    purpose: "Evidence map, assessment steps and plain-language story",
  },
  {
    method: "GET",
    path: "/api/topics/:slug/reasoning",
    purpose:
      "Build/mission, depth change, graph walk and next action as ordered steps",
  },
  {
    method: "GET",
    path: "/api/topics/:slug/evolution",
    purpose: "Assessment history with reasons",
  },
  {
    method: "POST",
    path: "/api/topics/:slug/explain",
    purpose: "Agent explains the evidence in plain English (grounding-checked)",
  },
  { method: "POST", path: "/api/topics/analyze", purpose: "Start analysis" },
  { method: "GET", path: "/api/topics/analyze/status", purpose: "Job status" },
  {
    method: "POST",
    path: "/api/topics/:slug/reanalyze",
    purpose: "Re-judge one topic",
  },
] as const;

const TOPICS_MODEL = {
  version: DEPTH_ANALYSIS_VERSION,
  nodes: [
    {
      label: "Topic",
      shared: true,
      description:
        "An engineering concept (caching, authentication ...). Carries no developer data.",
      properties: [
        "slug",
        "name",
        "domain",
        "description",
        "aliases_text",
        "foundation_rank",
        "bridge_score",
        "cluster_id",
        "component_id",
      ],
    },
    {
      label: "Approach",
      shared: true,
      description: "A distinct way a topic was done (in-memory LRU vs Redis).",
      properties: ["slug", "name", "description", "topic_slug"],
    },
    {
      label: "DepthAssessment",
      shared: false,
      description: "One developer's judged depth in one topic.",
      properties: [
        "level",
        "score",
        "baseline_score",
        "confidence",
        "authenticity",
        "verdict",
        "rationale",
      ],
    },
  ],
  relationships: [
    {
      type: "ASSESSED",
      pattern: "(Developer)-[:ASSESSED]->(DepthAssessment)",
      private: true,
      meaning: "The developer was assessed on a topic",
    },
    {
      type: "OF_TOPIC",
      pattern: "(DepthAssessment)-[:OF_TOPIC]->(Topic)",
      private: true,
      meaning: "Which canonical topic the assessment is about",
    },
    {
      type: "USES_APPROACH",
      pattern: "(DepthAssessment)-[:USES_APPROACH]->(Approach)",
      private: true,
      meaning: "The developer demonstrably uses this implementation approach",
    },
    {
      type: "BACKED_BY",
      pattern:
        "(DepthAssessment)-[:BACKED_BY]->(FileChange|Demonstration|Experience|Commit)",
      private: true,
      meaning: "The assessment is supported by identifiable evidence",
    },
    {
      type: "KNOWS_TOPIC",
      pattern: "(Developer)-[:KNOWS_TOPIC]->(Topic)",
      private: true,
    },
    {
      type: "MAPS_TO",
      pattern: "(Topic)-[:MAPS_TO]->(Capability)",
      private: false,
      meaning: "taxonomy mapping, not proof of skill",
    },
    {
      type: "BUILDS_ON",
      pattern: "(Topic)-[:BUILDS_ON]->(Topic)",
      private: false,
      meaning:
        "advanced topic genuinely depends on its foundation (needs a stated reason)",
    },
    {
      type: "RELATED_TOPIC",
      pattern: "(Topic)-[:RELATED_TOPIC]<->(Topic)",
      private: false,
      meaning: "associated sibling topics, never a prerequisite",
    },
  ],
  privacy:
    "Topic, Approach and the Topic-to-Topic relationships carry no developer data and are shared. Everything developer-specific lives on DepthAssessment and on the edges that start at it. FalkorDB algorithms only run over the shared taxonomy.",
  levels: DEPTH_LEVELS.map((level) => ({
    id: level,
    rank: DEPTH_RANK[level],
    band: DEPTH_BANDS[level],
    ...LEVEL_META[level],
  })),
  authenticity: (Object.keys(AUTHENTICITY_META) as Authenticity[]).map(
    (id) => ({
      id,
      ...AUTHENTICITY_META[id],
    }),
  ),
  scoring: {
    summary:
      "A deterministic baseline is computed from graph counts. The LLM judges level and authenticity from cited evidence. Guard-rails reconcile the two. Taxonomy importance, proficiency and confidence are reported separately.",
    baselineComponents: BASELINE_COMPONENTS,
    baselineNote: "Components are summed, then capped at 100.",
    guardRails: GUARD_RAILS,
  },
  pipeline: PIPELINE,
  algorithms: ALGORITHMS,
  endpoints: ENDPOINTS,
};

// ============================================================
// DOSSIER: everything read once, cached 30s, shaped by the views
// ============================================================

interface GraphMetrics {
  foundationRank: number | null;
  foundationRankNorm: number | null;
  bridgeScore: number | null;
  bridgeScoreNorm: number | null;
  clusterId: number | null;
  componentId: number | null;
  roles: string[];
}

interface TopicCard {
  slug: string;
  name: string;
  domain: string;
  domainLabel: string;
  level: DepthLevel;
  levelLabel: string;
  levelRank: number;
  score: number;
  baselineScore: number;
  scoreDelta: number;
  confidence: string;
  authenticity: Authenticity;
  authenticityLabel: string;
  verdict: string;
  evidence: {
    files: number;
    commits: number;
    repos: number;
    activeDays: number;
    firstSeen: string;
    lastSeen: string;
  };
  approaches: TopicDepthSummary["approaches"];
  primaryApproach: string | null;
  fallback: boolean;
  graph: GraphMetrics;
}

interface NodeRef {
  slug: string;
  name: string;
  domain: string;
  foundationRank: number | null;
  bridgeScore: number | null;
  clusterId: number | null;
  componentId: number | null;
}

interface EdgeRow {
  id: string;
  source: string;
  target: string;
  type: "BUILDS_ON" | "RELATED_TOPIC";
  reason: string;
  basis: string;
  /** BUILDS_ON is trusted only when it carries a stated reason */
  trusted: boolean;
}

interface Dossier {
  developerId: string;
  generatedAt: string;
  cards: TopicCard[];
  bySlug: Map<string, TopicCard>;
  neighbors: Map<string, NodeRef>;
  edges: EdgeRow[];
  summary: DepthProfileSummary | null;
  maxima: { foundationRank: number; bridgeScore: number };
  coverage: {
    topics: number;
    foundationRank: number;
    bridgeScore: number;
    clusterId: number;
    componentId: number;
  };
  taxonomy: { topics: number; buildsOn: number; related: number };
  analysis: { model: string; updatedAt: string; version: number } | null;
  /** real evidence totals read from the graph (BACKED_BY edges, stored stats) */
  evidence: { byKind: Record<string, number>; testFilesAcrossTopics: number };
}

const cache = new Map<string, { at: number; dossier: Dossier | null }>();
const pending = new Map<string, Promise<Dossier | null>>();

export const onTopicsChanged = (developerId: string): void => {
  cache.delete(developerId);
};

function rolesFor(prNorm: number | null, btNorm: number | null): string[] {
  const roles: string[] = [];
  if (prNorm != null && prNorm >= 0.6) roles.push("foundation");
  if (btNorm != null && btNorm >= 0.5) roles.push("bridge");
  return roles;
}

function endpoint(r: Row, p: "a_" | "b_"): NodeRef {
  return {
    slug: str(r[`${p}slug`]),
    name: str(r[`${p}name`]),
    domain: str(r[`${p}domain`]),
    foundationRank: nullableNum(r[`${p}pr`]),
    bridgeScore: nullableNum(r[`${p}bt`]),
    clusterId: nullableNum(r[`${p}cl`]),
    componentId: nullableNum(r[`${p}cc`]),
  };
}

async function buildDossier(developerId: string): Promise<Dossier | null> {
  const graph = await getGraphForDeveloper(developerId);
  await ensureDepthSchema(graph);

  const exists = await cypher(
    graph,
    "developer exists",
    `MATCH (d:Developer {id: $dev}) RETURN d.id AS id LIMIT 1`,
    { dev: developerId },
  );
  if (exists && exists.length === 0) return null;

  const [
    profile,
    metaRows,
    globalRows,
    buildsRows,
    relatedRows,
    analysisRows,
    kindRows,
    statRows,
  ] = await Promise.all([
    readDeveloperTopicProfile(graph, developerId),
    cypher(
      graph,
      "topic metrics",
      `
        MATCH (:Developer {id: $dev})-[:ASSESSED]->(:DepthAssessment)-[:OF_TOPIC]->(t:Topic)
        RETURN t.slug AS slug, t.bridge_score AS bridge_score, t.component_id AS component_id
        `,
      { dev: developerId },
    ),
    cypher(
      graph,
      "taxonomy coverage",
      `
        MATCH (t:Topic)
        RETURN count(t) AS total, max(t.foundation_rank) AS max_pr, max(t.bridge_score) AS max_bt,
               count(t.foundation_rank) AS c_pr, count(t.bridge_score) AS c_bt,
               count(t.cluster_id) AS c_cl, count(t.component_id) AS c_cc
        `,
    ),
    cypher(
      graph,
      "builds_on count",
      `MATCH (:Topic)-[r:BUILDS_ON]->(:Topic) RETURN count(r) AS n`,
    ),
    cypher(
      graph,
      "related count",
      `MATCH (:Topic)-[r:RELATED_TOPIC]->(:Topic) RETURN count(r) AS n`,
    ),
    cypher(
      graph,
      "analysis meta",
      `
        MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment)
        RETURN a.model AS model, max(a.updated_at) AS updated, min(a.analysis_version) AS version
        ORDER BY updated DESC
        LIMIT 1
        `,
      { dev: developerId },
    ),
    cypher(
      graph,
      "evidence by kind",
      `
        MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment)
        OPTIONAL MATCH (a)-[:BACKED_BY]->(x)
        RETURN labels(x)[0] AS kind, count(DISTINCT x) AS n
        `,
      { dev: developerId },
    ),
    cypher(
      graph,
      "assessment stats",
      `MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment) RETURN a.stats_json AS stats`,
      { dev: developerId },
    ),
  ]);

  const evidenceByKind: Record<string, number> = {};
  for (const r of kindRows ?? []) {
    const k = str(r.kind);
    if (k) evidenceByKind[k] = num(r.n);
  }
  let testFiles = 0;
  for (const r of statRows ?? []) {
    try {
      testFiles += num(JSON.parse(str(r.stats)).testFiles);
    } catch {
      /* no stats stored */
    }
  }

  const g = globalRows?.[0] ?? {};
  const maxPr = num(g.max_pr);
  const maxBt = num(g.max_bt);
  const meta = new Map<
    string,
    { bridge: number | null; component: number | null }
  >(
    (metaRows ?? []).map(
      (r) =>
        [
          str(r.slug),
          {
            bridge: nullableNum(r.bridge_score),
            component: nullableNum(r.component_id),
          },
        ] as [string, { bridge: number | null; component: number | null }],
    ),
  );

  const cards: TopicCard[] = profile.topics.map((t) => {
    const m = meta.get(t.slug);
    const prNorm =
      t.foundationRank != null && maxPr > 0
        ? round(t.foundationRank / maxPr, 3)
        : null;
    const bridge = m?.bridge ?? null;
    const btNorm =
      bridge != null && maxBt > 0 ? round(bridge / maxBt, 3) : null;
    const primary = t.approaches.find((a) => a.isPrimary) ?? t.approaches[0];
    return {
      slug: t.slug,
      name: t.name,
      domain: t.domain || "other",
      domainLabel: humanize(t.domain),
      level: t.level,
      levelLabel: LEVEL_META[t.level].label,
      levelRank: DEPTH_RANK[t.level],
      score: t.score,
      baselineScore: t.baselineScore,
      scoreDelta: t.score - t.baselineScore,
      confidence: t.confidence,
      authenticity: t.authenticity,
      authenticityLabel: AUTHENTICITY_META[t.authenticity].label,
      verdict: t.verdict,
      evidence: {
        files: t.files,
        commits: t.commits,
        repos: t.repos,
        activeDays: t.activeDays,
        firstSeen: t.firstSeen,
        lastSeen: t.lastSeen,
      },
      approaches: t.approaches,
      primaryApproach: primary?.name ?? null,
      fallback: t.fallback,
      graph: {
        foundationRank: t.foundationRank,
        foundationRankNorm: prNorm,
        bridgeScore: bridge,
        bridgeScoreNorm: btNorm,
        clusterId: t.clusterId,
        componentId: m?.component ?? null,
        roles: rolesFor(prNorm, btNorm),
      },
    };
  });
  // canonical dedupe: one card per slug
  const bySlug = new Map<string, TopicCard>();
  for (const c of cards) if (!bySlug.has(c.slug)) bySlug.set(c.slug, c);
  const uniqueCards = [...bySlug.values()];

  // ---- relations touching this developer's topics ----
  const edges: EdgeRow[] = [];
  const neighbors = new Map<string, NodeRef>();
  if (uniqueCards.length) {
    const edgeRows =
      (await cypher(
        graph,
        "topic relations",
        `
        MATCH (a:Topic)-[r:BUILDS_ON|RELATED_TOPIC]->(b:Topic)
        WHERE a.slug IN $slugs OR b.slug IN $slugs
        RETURN a.slug AS a_slug, a.name AS a_name, coalesce(a.domain, "") AS a_domain,
               a.foundation_rank AS a_pr, a.bridge_score AS a_bt,
               a.cluster_id AS a_cl, a.component_id AS a_cc,
               b.slug AS b_slug, b.name AS b_name, coalesce(b.domain, "") AS b_domain,
               b.foundation_rank AS b_pr, b.bridge_score AS b_bt,
               b.cluster_id AS b_cl, b.component_id AS b_cc,
               type(r) AS type, coalesce(r.reason, "") AS reason, coalesce(r.basis, "") AS basis
        LIMIT 3000
        `,
        { slugs: uniqueCards.map((c) => c.slug) },
      )) ?? [];

    const seen = new Set<string>();
    for (const r of edgeRows) {
      const a = endpoint(r, "a_");
      const b = endpoint(r, "b_");
      const type = str(r.type) === "BUILDS_ON" ? "BUILDS_ON" : "RELATED_TOPIC";
      if (!a.slug || !b.slug || a.slug === b.slug) continue;
      const key =
        type === "RELATED_TOPIC"
          ? `R:${[a.slug, b.slug].sort().join("~")}`
          : `B:${a.slug}>${b.slug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const reason = str(r.reason);
      edges.push({
        id: `${type}:${a.slug}>${b.slug}`,
        source: a.slug,
        target: b.slug,
        type,
        reason,
        basis: str(r.basis),
        trusted: type === "RELATED_TOPIC" ? true : reason.length > 0,
      });
      for (const n of [a, b]) {
        if (!bySlug.has(n.slug) && !neighbors.has(n.slug))
          neighbors.set(n.slug, n);
      }
    }
  }

  const analysis = analysisRows?.[0];
  return {
    developerId,
    generatedAt: new Date().toISOString(),
    cards: uniqueCards,
    bySlug,
    neighbors,
    edges,
    summary: profile.summary,
    maxima: { foundationRank: maxPr, bridgeScore: maxBt },
    coverage: {
      topics: num(g.total),
      foundationRank: num(g.c_pr),
      bridgeScore: num(g.c_bt),
      clusterId: num(g.c_cl),
      componentId: num(g.c_cc),
    },
    taxonomy: {
      topics: num(g.total),
      buildsOn: num(buildsRows?.[0]?.n),
      related: num(relatedRows?.[0]?.n),
    },
    analysis: analysis
      ? {
          model: str(analysis.model),
          updatedAt: str(analysis.updated),
          version: num(analysis.version, DEPTH_ANALYSIS_VERSION),
        }
      : null,
    evidence: { byKind: evidenceByKind, testFilesAcrossTopics: testFiles },
  };
}

async function getDossier(
  developerId: string,
  fresh = false,
): Promise<Dossier | null> {
  const hit = cache.get(developerId);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.dossier;

  const inflight = pending.get(developerId);
  if (inflight) return inflight;

  const work = buildDossier(developerId)
    .then((dossier) => {
      cache.set(developerId, { at: Date.now(), dossier });
      return dossier;
    })
    .finally(() => pending.delete(developerId));
  pending.set(developerId, work);
  return work;
}

// ============================================================
// SHAPES
// ============================================================

const mini = (c: TopicCard) => ({
  slug: c.slug,
  name: c.name,
  domain: c.domain,
  level: c.level,
  score: c.score,
  authenticity: c.authenticity,
});

function levelCounts(cards: TopicCard[]): Record<DepthLevel, number> {
  const out = {
    none: 0,
    surface: 0,
    working: 0,
    proficient: 0,
    deep: 0,
  } as Record<DepthLevel, number>;
  for (const c of cards) out[c.level] += 1;
  return out;
}

function bestLevel(cards: TopicCard[]): DepthLevel {
  return cards.reduce<DepthLevel>(
    (best, c) => (c.levelRank > DEPTH_RANK[best] ? c.level : best),
    "none",
  );
}

const byGraph = (a: TopicCard, b: TopicCard) =>
  (b.graph.foundationRank ?? -1) - (a.graph.foundationRank ?? -1) ||
  (b.graph.bridgeScore ?? -1) - (a.graph.bridgeScore ?? -1) ||
  a.name.localeCompare(b.name);

function makeGroup(
  key: string,
  label: string,
  cards: TopicCard[],
  extra: Row = {},
) {
  const sorted = [...cards].sort(byGraph);
  return {
    key,
    label,
    count: cards.length,
    averageScore: avg(cards.map((c) => c.score)),
    bestLevel: bestLevel(cards),
    levelCounts: levelCounts(cards),
    topics: sorted.map(mini),
    ...extra,
  };
}

function groupBy<T>(
  items: T[],
  keyFn: (item: T) => string | null,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    if (key == null) continue;
    out.set(key, [...(out.get(key) ?? []), item]);
  }
  return out;
}

function buildGroups(d: Dossier) {
  const { cards } = d;
  const related = d.edges.filter((e) => e.type === "RELATED_TOPIC");

  const domains = [...groupBy(cards, (c) => c.domain).entries()]
    .map(([key, list]) => makeGroup(key, humanize(key), list))
    .sort((a, b) => a.label.localeCompare(b.label));

  // communities are validated: a group needs >= 2 assessed topics AND at least
  // one RELATED_TOPIC link between its members, otherwise it is merely co-labelled
  const byCluster = groupBy(cards, (c) =>
    c.graph.clusterId == null ? null : String(c.graph.clusterId),
  );
  const clusters = [...byCluster.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([key, list]) => {
      const anchor = [...list].sort(byGraph)[0] as TopicCard;
      const slugs = new Set(list.map((c) => c.slug));
      const domainSet = uniq(list.map((c) => c.domainLabel));
      const internalLinks = related.filter(
        (e) => slugs.has(e.source) && slugs.has(e.target),
      ).length;
      return makeGroup(key, `Around ${anchor.name}`, list, {
        clusterId: Number(key),
        anchor: { slug: anchor.slug, name: anchor.name },
        domains: domainSet,
        crossDomain: domainSet.length > 1,
        internalLinks,
        meaningful: internalLinks > 0,
      });
    })
    .filter((g) => Boolean((g as Row).meaningful))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const clusteredSlugs = new Set(
    clusters.flatMap((c) => c.topics.map((t) => t.slug)),
  );
  const unclustered = cards
    .filter((c) => !clusteredSlugs.has(c.slug))
    .map(mini);

  const byComponent = groupBy(cards, (c) =>
    c.graph.componentId == null ? null : String(c.graph.componentId),
  );
  const largest = Math.max(
    0,
    ...[...byComponent.values()].map((l) => l.length),
  );
  const components = [...byComponent.entries()]
    .map(([key, list]) =>
      makeGroup(
        key,
        list.length === largest && largest > 1
          ? "Main knowledge graph"
          : `Component ${key}`,
        list,
        {
          componentId: Number(key),
          isMain: list.length === largest && largest > 1,
        },
      ),
    )
    .sort((a, b) => b.count - a.count);
  const componentSlugs = new Set(
    components.flatMap((c) => c.topics.map((t) => t.slug)),
  );

  const byLevel = [...DEPTH_LEVELS]
    .reverse()
    .map((level) =>
      makeGroup(
        level,
        LEVEL_META[level].label,
        cards.filter((c) => c.level === level),
        {
          band: DEPTH_BANDS[level],
          meaning: LEVEL_META[level].meaning,
          color: LEVEL_META[level].color,
        },
      ),
    )
    .filter((g) => g.count > 0);

  const byAuth = (Object.keys(AUTHENTICITY_META) as Authenticity[])
    .map((id) =>
      makeGroup(
        id,
        AUTHENTICITY_META[id].label,
        cards.filter((c) => c.authenticity === id),
        { meaning: AUTHENTICITY_META[id].meaning },
      ),
    )
    .filter((g) => g.count > 0);

  return [
    {
      id: "domain",
      title: "By domain",
      method: {
        engine: "llm",
        algorithm: "Topic discovery",
        property: "Topic.domain",
        why: "The discovery model labels each topic with an engineering domain. Good for a familiar, human-readable grouping.",
      },
      groups: domains,
      ungrouped: [],
    },
    {
      id: "community",
      title: "By knowledge community",
      method: {
        engine: "falkordb",
        algorithm: "algo.labelPropagation over RELATED_TOPIC",
        property: "Topic.cluster_id",
        why: "Groups tightly related topics. A community is shown only when its members are actually linked to each other, so it is meaningful and not merely co-labelled.",
      },
      groups: clusters,
      ungrouped: unclustered,
    },
    {
      id: "component",
      title: "By connected component",
      method: {
        engine: "falkordb",
        algorithm: "algo.WCC over BUILDS_ON and RELATED_TOPIC",
        property: "Topic.component_id",
        why: "Separates the main connected body of knowledge from isolated topics that have no known relation to anything else.",
      },
      groups: components,
      ungrouped: cards.filter((c) => !componentSlugs.has(c.slug)).map(mini),
    },
    {
      id: "level",
      title: "By depth level",
      method: {
        engine: "deterministic",
        algorithm: "Baseline score + LLM judgement + guard-rails",
        property: "DepthAssessment.level",
        why: "How deeply the topic is known, from surface to deep, with the score always inside the level's band.",
      },
      groups: byLevel,
      ungrouped: [],
    },
    {
      id: "authenticity",
      title: "By authenticity",
      method: {
        engine: "llm + guard-rails",
        algorithm:
          "Judgement checked against scaffold share and own definitions",
        property: "DepthAssessment.authenticity",
        why: "Separates topics the developer built from topics that are only present (boilerplate, incidental).",
      },
      groups: byAuth,
      ungrouped: [],
    },
  ];
}

function refFor(d: Dossier, slug: string) {
  const card = d.bySlug.get(slug);
  if (card) {
    return {
      slug,
      name: card.name,
      domain: card.domain,
      assessed: true,
      level: card.level as DepthLevel | null,
      score: card.score as number | null,
      foundationRank: card.graph.foundationRank,
      bridgeScore: card.graph.bridgeScore,
    };
  }
  const n = d.neighbors.get(slug);
  return {
    slug,
    name: n?.name ?? slug,
    domain: n?.domain ?? "",
    assessed: false,
    level: null as DepthLevel | null,
    score: null as number | null,
    foundationRank: n?.foundationRank ?? null,
    bridgeScore: n?.bridgeScore ?? null,
  };
}

function buildRelations(d: Dossier) {
  const allBuilds = d.edges.filter((e) => e.type === "BUILDS_ON");
  // only BUILDS_ON edges with a stated reason are treated as real dependencies
  const builds = allBuilds.filter((e) => e.trusted);
  const related = d.edges.filter((e) => e.type === "RELATED_TOPIC");

  const hierarchy = d.cards
    .map((c) => {
      const dependsOn = builds
        .filter((e) => e.source === c.slug)
        .map((e) => ({
          ...refFor(d, e.target),
          reason: e.reason,
          sentence: `${c.name} builds on ${refFor(d, e.target).name}`,
        }));
      const unlocks = builds
        .filter((e) => e.target === c.slug)
        .map((e) => ({
          ...refFor(d, e.source),
          reason: e.reason,
          sentence: `${refFor(d, e.source).name} builds on ${c.name}`,
        }));
      return { topic: mini(c), buildsOn: dependsOn, unlocks };
    })
    .filter((h) => h.buildsOn.length || h.unlocks.length);

  const siblings = d.cards
    .map((c) => ({
      topic: mini(c),
      related: related
        .filter((e) => e.source === c.slug || e.target === c.slug)
        .map((e) => ({
          ...refFor(d, e.source === c.slug ? e.target : e.source),
          reason: e.reason,
        })),
    }))
    .filter((s) => s.related.length);

  const foundationGaps = builds
    .map((e) => {
      const upper = d.bySlug.get(e.source);
      if (!upper || upper.levelRank < 3) return null;
      const lower = refFor(d, e.target);
      const lowerRank = lower.level ? DEPTH_RANK[lower.level] : -1;
      if (lowerRank > 1) return null;
      return {
        topic: mini(upper),
        foundation: lower,
        severity: lower.assessed ? "weak" : "unverified",
        reason: e.reason,
        message: lower.assessed
          ? `${upper.name} is ${upper.level}, but its foundation ${lower.name} is only ${lower.level}.`
          : `${upper.name} is ${upper.level}; its foundation ${lower.name} has no assessment yet.`,
      };
    })
    .filter((g): g is NonNullable<typeof g> => g !== null)
    .sort((a, b) => {
      const aCard = d.bySlug.get(a.topic.slug);
      const bCard = d.bySlug.get(b.topic.slug);
      return (
        (bCard?.graph.foundationRank ?? -1) -
          (aCard?.graph.foundationRank ?? -1) ||
        (bCard?.graph.bridgeScore ?? -1) - (aCard?.graph.bridgeScore ?? -1)
      );
    })
    .slice(0, 12);

  const frontierMap = new Map<
    string,
    { node: ReturnType<typeof refFor>; known: TopicCard[] }
  >();
  for (const e of builds) {
    const known = d.bySlug.get(e.target);
    if (!known || d.bySlug.has(e.source)) continue;
    const entry = frontierMap.get(e.source) ?? {
      node: refFor(d, e.source),
      known: [],
    };
    entry.known.push(known);
    frontierMap.set(e.source, entry);
  }
  const frontier = [...frontierMap.values()]
    .map(({ node, known }) => ({
      ...node,
      builtOn: known.map(mini),
      knownFoundationCount: known.length,
      message: `${node.name} builds on ${known.map((k) => k.name).join(", ")}, which are assessed.`,
    }))
    .sort(
      (a, b) =>
        b.builtOn.length - a.builtOn.length ||
        (b.foundationRank ?? -1) - (a.foundationRank ?? -1) ||
        (b.bridgeScore ?? -1) - (a.bridgeScore ?? -1) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 8);

  return {
    counts: {
      buildsOn: builds.length,
      untrustedBuildsOn: allBuilds.length - builds.length,
      related: related.length,
      assessedTopics: d.cards.length,
      externalTopics: d.neighbors.size,
    },
    explain: {
      BUILDS_ON:
        "Directed. 'A builds on B' means B is a foundation of A. Requires a stated reason; edges without one are untrusted and ignored for prerequisites.",
      RELATED_TOPIC:
        "Undirected siblings. Stored in both directions, returned once. An association, not a prerequisite, never proof of mastery.",
      basis:
        "Relations are inferred by the discovery model (basis: llm_inferred) or from evidence overlap, and shared across developers.",
    },
    hierarchy,
    siblings,
    foundationGaps,
    frontier,
    edges: d.edges.map((e) => ({
      ...e,
      directed: e.type === "BUILDS_ON",
      label: e.type === "BUILDS_ON" ? "builds on" : "related to",
      source: refFor(d, e.source),
      target: refFor(d, e.target),
    })),
  };
}

function buildGraph(d: Dossier, includeNeighbors: boolean) {
  const nodes = [
    ...d.cards.map((c) => ({
      id: c.slug,
      slug: c.slug,
      label: c.name,
      assessed: true,
      domain: c.domain,
      level: c.level,
      levelRank: c.levelRank,
      score: c.score,
      confidence: c.confidence,
      authenticity: c.authenticity,
      files: c.evidence.files,
      commits: c.evidence.commits,
      size: round(12 + (c.score / 100) * 28, 1),
      roles: c.graph.roles,
      metrics: {
        foundationRank: c.graph.foundationRank,
        foundationRankNorm: c.graph.foundationRankNorm,
        bridgeScore: c.graph.bridgeScore,
        bridgeScoreNorm: c.graph.bridgeScoreNorm,
      },
      cluster: c.graph.clusterId,
      component: c.graph.componentId,
    })),
    ...(includeNeighbors
      ? [...d.neighbors.values()].map((n) => ({
          id: n.slug,
          slug: n.slug,
          label: n.name,
          assessed: false,
          domain: n.domain,
          level: null as DepthLevel | null,
          levelRank: -1,
          score: null as number | null,
          confidence: null as string | null,
          authenticity: null as string | null,
          files: 0,
          commits: 0,
          size: 10,
          roles: [] as string[],
          metrics: {
            foundationRank: n.foundationRank,
            foundationRankNorm: null as number | null,
            bridgeScore: n.bridgeScore,
            bridgeScoreNorm: null as number | null,
          },
          cluster: n.clusterId,
          component: n.componentId,
        }))
      : []),
  ];
  const visible = new Set(nodes.map((n) => n.id));
  const edges = d.edges
    .filter((e) => visible.has(e.source) && visible.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type,
      directed: e.type === "BUILDS_ON",
      trusted: e.trusted,
      label: e.type === "BUILDS_ON" ? "builds on" : "related to",
      reason: e.reason,
    }));

  return {
    developerId: d.developerId,
    generatedAt: d.generatedAt,
    nodes,
    edges,
    stats: {
      nodes: nodes.length,
      assessedNodes: d.cards.length,
      externalNodes: nodes.length - d.cards.length,
      edges: edges.length,
      buildsOn: edges.filter((e) => e.type === "BUILDS_ON").length,
      untrustedBuildsOn: edges.filter(
        (e) => e.type === "BUILDS_ON" && !e.trusted,
      ).length,
      related: edges.filter((e) => e.type === "RELATED_TOPIC").length,
    },
    legend: {
      levels: DEPTH_LEVELS.map((l) => ({
        id: l,
        label: LEVEL_META[l].label,
        color: LEVEL_META[l].color,
        band: DEPTH_BANDS[l],
      })),
      unassessed: { label: "Related, not assessed", color: "#d1d5db" },
      edgeTypes: [
        {
          id: "BUILDS_ON",
          label: "Builds on",
          directed: true,
          meaning: "Arrow points to the foundation",
        },
        {
          id: "RELATED_TOPIC",
          label: "Related",
          directed: false,
          meaning: "Sibling topics",
        },
      ],
      roles: [
        {
          id: "foundation",
          meaning: "PageRank over BUILDS_ON is high: many topics build on it",
        },
        {
          id: "bridge",
          meaning: "Betweenness is high: it connects separate areas",
        },
      ],
    },
    hints: {
      colorBy: ["level", "domain", "cluster", "component"],
      sizeBy: "score",
      layout:
        "BUILDS_ON points from advanced to foundation: draw foundations at the bottom or centre. Use cluster for hulls or force groups.",
    },
  };
}

function neighborSlugs(d: Dossier, slug: string): string[] {
  return uniq(
    d.edges
      .filter((e) => e.source === slug || e.target === slug)
      .map((e) => (e.source === slug ? e.target : e.source)),
  );
}

function clusterOf(d: Dossier, slug: string): number | null {
  return (
    d.bySlug.get(slug)?.graph.clusterId ??
    d.neighbors.get(slug)?.clusterId ??
    null
  );
}

function buildAlgorithms(d: Dossier) {
  const { coverage } = d;
  const total = coverage.topics;
  const status = (covered: number) => ({
    computed: covered > 0,
    coveredTopics: covered,
    totalTopics: total,
    coverage: total ? round(covered / total, 3) : 0,
  });
  const dependents = (slug: string) =>
    d.edges.filter(
      (e) => e.type === "BUILDS_ON" && e.trusted && e.target === slug,
    ).length;

  const topFoundations = d.cards
    .filter((c) => (c.graph.foundationRank ?? 0) > 0)
    .sort(
      (a, b) => (b.graph.foundationRank ?? 0) - (a.graph.foundationRank ?? 0),
    )
    .slice(0, 5)
    .map((c) => ({
      topic: mini(c),
      rank: c.graph.foundationRank,
      norm: c.graph.foundationRankNorm,
      directDependents: dependents(c.slug),
      message: `${dependents(c.slug)} topic(s) directly build on ${c.name}.`,
    }));

  const topBridges = d.cards
    .filter((c) => (c.graph.bridgeScore ?? 0) > 0)
    .sort((a, b) => (b.graph.bridgeScore ?? 0) - (a.graph.bridgeScore ?? 0))
    .slice(0, 5)
    .map((c) => {
      const communities = uniq(
        neighborSlugs(d, c.slug)
          .map((s) => clusterOf(d, s))
          .filter((x): x is number => x != null),
      );
      return {
        topic: mini(c),
        score: c.graph.bridgeScore,
        norm: c.graph.bridgeScoreNorm,
        connectsCommunities: communities.length,
        message: `${c.name} links ${communities.length} knowledge communit${communities.length === 1 ? "y" : "ies"}.`,
      };
    });

  const groups = buildGroups(d);
  const community = groups.find((g) => g.id === "community");
  const component = groups.find((g) => g.id === "component");

  const findings: Record<string, unknown> = {
    pagerank: { topFoundations },
    betweenness: { topBridges },
    label_propagation: {
      communities: community?.groups.length ?? 0,
      largest: community?.groups[0]
        ? {
            key: community.groups[0].key,
            label: community.groups[0].label,
            count: community.groups[0].count,
          }
        : null,
      unclusteredTopics: community?.ungrouped.length ?? 0,
    },
    wcc: {
      components: component?.groups.length ?? 0,
      mainSize: component?.groups[0]?.count ?? 0,
      isolatedTopics: (component?.groups ?? [])
        .filter((g) => g.count === 1)
        .flatMap((g) => g.topics),
    },
  };

  const covered: Record<string, number | null> = {
    pagerank: coverage.foundationRank,
    betweenness: coverage.bridgeScore,
    label_propagation: coverage.clusterId,
    wcc: coverage.componentId,
  };

  return {
    developerId: d.developerId,
    generatedAt: d.generatedAt,
    taxonomy: d.taxonomy,
    note: "FalkorDB algorithms run only over the shared Topic taxonomy, which carries no developer data. This API overlays the results on the signed-in developer's topics. Taxonomy importance, developer proficiency and assessment confidence are three different things and are never merged into one score.",
    algorithms: ALGORITHMS.map((a) => ({
      ...a,
      status: covered[a.id] == null ? null : status(covered[a.id] as number),
      findings: findings[a.id] ?? null,
    })),
  };
}

// ---- overview list filtering ---------------------------------------------

const SORTS: Record<string, (a: TopicCard, b: TopicCard) => number> = {
  foundation: byGraph,
  bridge: (a, b) =>
    (b.graph.bridgeScore ?? -1) - (a.graph.bridgeScore ?? -1) ||
    (b.graph.foundationRank ?? -1) - (a.graph.foundationRank ?? -1) ||
    a.name.localeCompare(b.name),
  name: (a, b) => a.name.localeCompare(b.name),
  recent: (a, b) => b.evidence.lastSeen.localeCompare(a.evidence.lastSeen),
};

function selectCards(cards: TopicCard[], query: Query) {
  const domain = str(query.domain) ? slugify(str(query.domain)) : "";
  const level = str(query.level);
  const authenticity = str(query.authenticity);
  const cluster =
    query.cluster != null && str(query.cluster) !== ""
      ? Number(query.cluster)
      : null;
  const text = str(query.q).toLowerCase();
  const minScore = num(query.minScore, 0);

  let list = cards.filter(
    (c) =>
      (!domain || c.domain === domain) &&
      (!level || c.level === level) &&
      (!authenticity || c.authenticity === authenticity) &&
      (cluster == null || c.graph.clusterId === cluster) &&
      (!text ||
        `${c.name} ${c.slug} ${c.domain} ${c.verdict}`
          .toLowerCase()
          .includes(text)) &&
      c.score >= minScore,
  );

  const sortKey = str(query.sort, "foundation");
  const sort = SORTS[sortKey] ?? SORTS.foundation;
  list = [...list].sort(sort);
  if (str(query.order) === "asc" && sortKey !== "name" && sortKey !== "recent")
    list.reverse();
  if (
    str(query.order) === "desc" &&
    (sortKey === "name" || sortKey === "recent")
  )
    list.reverse();

  const limit = clamp(Math.floor(num(query.limit, 200)), 1, 500);
  const offset = Math.max(0, Math.floor(num(query.offset, 0)));
  const items = list.slice(offset, offset + limit);
  return {
    total: list.length,
    returned: items.length,
    limit,
    offset,
    items,
  };
}

function buildOverview(d: Dossier, query: Query, view: string) {
  const { cards } = d;
  const byAuth: Record<string, number> = {};
  const byConfidence: Record<string, number> = {};
  for (const c of cards) {
    byAuth[c.authenticity] = (byAuth[c.authenticity] ?? 0) + 1;
    byConfidence[c.confidence] = (byConfidence[c.confidence] ?? 0) + 1;
  }

  const relations = buildRelations(d);
  const picked = selectCards(cards, query);
  const sortedByGraph = [...cards].sort(byGraph);

  const stats = {
    topics: cards.length,
    byLevel: levelCounts(cards),
    byAuthenticity: byAuth,
    byConfidence,
    averageScore: avg(cards.map((c) => c.score)),
    deepTopics: cards.filter((c) => c.level === "deep").length,
    ownImplementations: cards.filter(
      (c) => c.authenticity === "genuine_implementation",
    ).length,
    approaches: cards.reduce((n, c) => n + c.approaches.length, 0),
    domains: uniq(cards.map((c) => c.domain)).length,
    fallbackAssessments: cards.filter((c) => c.fallback).length,
    relations: relations.counts,
    evidence: d.evidence,
    connections: relations.counts.buildsOn + relations.counts.related,
  };

  const highlights = {
    strongest: sortedByGraph
      .filter((c) => c.levelRank >= 3)
      .slice(0, 5)
      .map(mini),
    builds: cards
      .filter((c) => c.authenticity === "genuine_implementation")
      .slice(0, 5)
      .map(mini),
    broadButShallow: cards
      .filter((c) => c.levelRank <= 2 && c.evidence.files >= 5)
      .slice(0, 5)
      .map(mini),
    lowConfidence: cards
      .filter((c) => c.confidence === "low" && c.evidence.files > 0)
      .slice(0, 5)
      .map(mini),
    topFoundations: [...cards]
      .filter((c) => (c.graph.foundationRank ?? 0) > 0)
      .sort(
        (a, b) => (b.graph.foundationRank ?? 0) - (a.graph.foundationRank ?? 0),
      )
      .slice(0, 5)
      .map(mini),
    topBridges: [...cards]
      .filter((c) => (c.graph.bridgeScore ?? 0) > 0)
      .sort((a, b) => (b.graph.bridgeScore ?? 0) - (a.graph.bridgeScore ?? 0))
      .slice(0, 5)
      .map(mini),
    recentlyActive: [...cards]
      .sort((a, b) => b.evidence.lastSeen.localeCompare(a.evidence.lastSeen))
      .slice(0, 5)
      .map(mini),
    foundationGaps: relations.foundationGaps.slice(0, 5),
  };

  const base = {
    developerId: d.developerId,
    generatedAt: d.generatedAt,
    status: {
      analyzed: cards.length > 0,
      topics: cards.length,
      model: d.analysis?.model ?? null,
      lastAnalyzedAt: d.analysis?.updatedAt ?? null,
      analysisVersion: d.analysis?.version ?? null,
      currentVersion: DEPTH_ANALYSIS_VERSION,
      outdated: d.analysis
        ? d.analysis.version < DEPTH_ANALYSIS_VERSION
        : false,
      job: jobView(d.developerId, false),
    },
    summary: d.summary,
    stats,
    highlights,
    groups: buildGroups(d),
    algorithms: ALGORITHMS.filter((a) => a.engine !== "in-process").map(
      (a) => ({
        id: a.id,
        name: a.name,
        engine: a.engine,
        writesProperty: a.writesProperty,
        role: a.role,
        affectsAssessment: a.affectsAssessment,
        why: a.why,
      }),
    ),
    levels: TOPICS_MODEL.levels,
    coverage: d.coverage,
    taxonomy: d.taxonomy,
  };

  if (view === "summary") return base;
  return {
    ...base,
    topics: {
      total: picked.total,
      returned: picked.returned,
      limit: picked.limit,
      offset: picked.offset,
      items: picked.items,
    },
    relations,
  };
}

// ============================================================
// INTEGRITY: deterministic checks over one graph snapshot
// ============================================================

interface IntegrityCheck {
  id: string;
  passed: boolean;
  detail: string;
}

function hasCycle(builds: EdgeRow[]): string[] | null {
  const adj = new Map<string, string[]>();
  for (const e of builds)
    adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (n: string): string[] | null => {
    state.set(n, 1);
    stack.push(n);
    for (const m of adj.get(n) ?? []) {
      if (state.get(m) === 1) return [...stack.slice(stack.indexOf(m)), m];
      if (!state.has(m)) {
        const c = visit(m);
        if (c) return c;
      }
    }
    stack.pop();
    state.set(n, 2);
    return null;
  };
  for (const n of adj.keys())
    if (!state.has(n)) {
      const c = visit(n);
      if (c) return c;
    }
  return null;
}

function buildIntegrity(d: Dossier) {
  const builds = d.edges.filter((e) => e.type === "BUILDS_ON");
  const untrusted = builds.filter((e) => !e.trusted);
  const cycle = hasCycle(builds.filter((e) => e.trusted));
  const buildPairs = new Set(builds.map((e) => `${e.source}>${e.target}`));
  const conflicting = builds.filter((e) =>
    buildPairs.has(`${e.target}>${e.source}`),
  );
  const relatedAlsoBuilds = d.edges.filter(
    (e) =>
      e.type === "RELATED_TOPIC" &&
      (buildPairs.has(`${e.source}>${e.target}`) ||
        buildPairs.has(`${e.target}>${e.source}`)),
  );
  const slugs = d.cards.map((c) => c.slug);
  const stale = d.analysis
    ? d.analysis.version < DEPTH_ANALYSIS_VERSION
    : false;
  const outOfBand = d.cards.filter((c) => {
    const [lo, hi] = DEPTH_BANDS[c.level];
    return c.score < lo || c.score > hi;
  });
  const checks: IntegrityCheck[] = [
    {
      id: "builds_on_has_reason",
      passed: untrusted.length === 0,
      detail: `${untrusted.length} of ${builds.length} BUILDS_ON edges have no stated reason (ignored as prerequisites).`,
    },
    {
      id: "builds_on_acyclic",
      passed: !cycle,
      detail: cycle
        ? `Cycle: ${cycle.join(" -> ")}`
        : "No BUILDS_ON cycle among trusted edges.",
    },
    {
      id: "builds_on_not_contradictory",
      passed: conflicting.length === 0,
      detail: `${conflicting.length} BUILDS_ON edges have an opposite edge.`,
    },
    {
      id: "related_not_duplicating_dependency",
      passed: relatedAlsoBuilds.length === 0,
      detail: `${relatedAlsoBuilds.length} RELATED_TOPIC edges duplicate a BUILDS_ON pair.`,
    },
    {
      id: "canonical_topics_unique",
      passed: new Set(slugs).size === slugs.length,
      detail: `${slugs.length} assessed topics, ${new Set(slugs).size} unique slugs.`,
    },
    {
      id: "score_inside_level_band",
      passed: outOfBand.length === 0,
      detail: `${outOfBand.length} topics have a score outside their level band.`,
    },
    {
      id: "algorithms_computed",
      passed:
        d.coverage.foundationRank > 0 &&
        d.coverage.bridgeScore >= 0 &&
        d.coverage.clusterId >= 0,
      detail: `PageRank covers ${d.coverage.foundationRank}/${d.coverage.topics} topics.`,
    },
    {
      id: "analysis_current",
      passed: !stale,
      detail: stale
        ? `Analysis version ${d.analysis?.version} is older than ${DEPTH_ANALYSIS_VERSION}; re-run the analysis.`
        : `Analysis version matches ${DEPTH_ANALYSIS_VERSION}.`,
    },
  ];
  return {
    developerId: d.developerId,
    generatedAt: d.generatedAt,
    analysisVersion: d.analysis?.version ?? null,
    passed: checks.every((c) => c.passed),
    checks,
  };
}

// ============================================================
// BACKGROUND JOBS
// ============================================================

interface Job {
  id: string;
  kind: "full" | "topic";
  topic: string | null;
  status: "running" | "completed" | "failed";
  stage: string;
  startedAt: string;
  finishedAt: string | null;
  progress: {
    atlasReady: boolean;
    proposed: number;
    gathered: number;
    assessed: number;
    latestTopic: string | null;
  };
  events: Array<{ at: string; stage: string; detail?: Row }>;
  result: Row | null;
  error: string | null;
}

const jobs = new Map<string, Job>();

const STAGE_LABELS: Record<string, string> = {
  depth_start: "Starting",
  depth_files_scanned: "Reading authored code",
  depth_atlas_ready: "Evidence atlas ready",
  depth_discovering: "Discovering topics",
  depth_topics_proposed: "Topics proposed",
  depth_evidence_gathered: "Gathering evidence",
  depth_refining: "Looking for more evidence",
  depth_topic_assessed: "Judging depth",
  depth_complete: "Done",
};

const jobRunning = (job: Job | undefined): job is Job =>
  !!job &&
  job.status === "running" &&
  Date.now() - Date.parse(job.startedAt) < MAX_JOB_MS;

function percent(job: Job): number {
  if (job.status === "completed") return 100;
  const p = job.progress;
  if (p.proposed > 0) {
    return Math.min(
      95,
      Math.round(
        25 +
          25 * Math.min(p.gathered / p.proposed, 1) +
          45 * Math.min(p.assessed / p.proposed, 1),
      ),
    );
  }
  if (job.kind === "topic") return p.atlasReady ? 50 : 10;
  return p.atlasReady ? 12 : 3;
}

function trackProgress(job: Job, stage: string, detail?: Row): void {
  job.stage = stage;
  if (stage === "depth_atlas_ready") job.progress.atlasReady = true;
  if (stage === "depth_topics_proposed")
    job.progress.proposed = num(detail?.count);
  if (stage === "depth_evidence_gathered") job.progress.gathered += 1;
  if (stage === "depth_topic_assessed") {
    job.progress.assessed += 1;
    job.progress.latestTopic = str(detail?.topic) || null;
  }
  if (stage === "depth_files_scanned") return;
  job.events.push({ at: new Date().toISOString(), stage, detail });
  if (job.events.length > 40) job.events.shift();
}

function jobView(developerId: string, withEvents: boolean) {
  const job = jobs.get(developerId);
  if (!job) return null;
  const { events, ...rest } = job;
  return {
    ...rest,
    stageLabel: STAGE_LABELS[job.stage] ?? job.stage,
    percent: percent(job),
    ...(withEvents ? { events } : {}),
  };
}

function launch(
  developerId: string,
  kind: Job["kind"],
  topic: string | null,
  work: (onProgress: ProgressFn) => Promise<Row>,
): Job {
  const job: Job = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    topic,
    status: "running",
    stage: "depth_start",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    progress: {
      atlasReady: false,
      proposed: kind === "topic" ? 1 : 0,
      gathered: 0,
      assessed: 0,
      latestTopic: null,
    },
    events: [],
    result: null,
    error: null,
  };
  jobs.set(developerId, job);

  const onProgress: ProgressFn = (stage, detail) =>
    trackProgress(job, stage, detail);
  void work(onProgress)
    .then((result) => {
      job.status = "completed";
      job.stage = "depth_complete";
      job.result = result;
    })
    .catch((error) => {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
      console.error(`${LOG} job failed for ${developerId}:`, job.error);
    })
    .finally(() => {
      job.finishedAt = new Date().toISOString();
      onTopicsChanged(developerId);
    });
  return job;
}

// ============================================================
// PROOF: observed / inferred / association; genuine prerequisite paths;
// confidence from strength AND diversity of evidence
// ============================================================

type ProofClass = "observed" | "inferred" | "association";

const CLASS_LABEL: Record<ProofClass, string> = {
  observed: "Seen in your code",
  inferred: "Inferred, not seen",
  association: "Linked only",
};

interface Citation {
  kind: "real_work" | "practice_mission" | "implementation" | "code" | "commit";
  title: string;
  snippet: string;
  path: string;
  repository: string;
  commit: string;
  permalink: string;
  when: string;
}

interface ProofItem {
  id: string;
  capabilityId: string;
  capability: string;
  class: ProofClass;
  classLabel: string;
  demonstrations: number;
  weight: number | null;
  practiceOnly: boolean;
  attributed: boolean;
  citations: Citation[];
  demonstrates: string;
  matters: string;
  limit: string;
}

interface ProofResult {
  items: ProofItem[];
  topicCitations: Citation[];
  counts: { observed: number; inferred: number; association: number };
}

const looksLikeCode = (s: string): boolean =>
  /[{};]|=>|\bfunction\b|\bimport\b|\breturn\b/.test(s);

const isCitation = (c: Citation): boolean =>
  Boolean(c.title || c.snippet || c.path || c.commit || c.permalink);

function citeBuild(b: Row): Citation {
  return {
    kind: b.kind === "mission" ? "practice_mission" : "real_work",
    title: str(b.title),
    snippet: "",
    path: str(b.path),
    repository: str(b.repository),
    commit: str(b.commitSubject),
    permalink: str(b.permalink),
    when: str(b.createdAt),
  };
}

function citeImplementation(i: Row): Citation {
  const what = str(i.what);
  const code = looksLikeCode(what);
  return {
    kind: "implementation",
    title: code ? "" : what,
    snippet: code ? what.slice(0, 400) : "",
    path: str(i.path),
    repository: str(i.repository),
    commit: "",
    permalink: str(i.permalink),
    when: "",
  };
}

function citeEvidence(e: Row): Citation | null {
  const kind = str(e.kind);
  if (kind !== "code" && kind !== "commit" && kind !== "demonstration")
    return null;
  const title = str(
    e.title ?? e.subject ?? e.technique ?? e.label ?? e.ref ?? e.key,
  );
  return {
    kind:
      kind === "commit"
        ? "commit"
        : kind === "demonstration"
          ? "implementation"
          : "code",
    title: kind === "code" ? "" : title,
    snippet: "",
    path: str(e.path),
    repository: str(e.repository),
    commit: kind === "commit" ? title : str(e.commitSubject),
    permalink: str(e.permalink),
    when: str(e.createdAt ?? e.date),
  };
}

const citationKey = (c: Citation): string =>
  c.permalink ||
  [c.repository, c.path, c.title, c.snippet.slice(0, 40), c.commit].join("|");

function dedupeCitations(list: Citation[]): Citation[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    if (!isCitation(c)) return false;
    const key = citationKey(c);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

function buildProof(card: TopicCard, detail: Row, builds: Row[]): ProofResult {
  const paths = asRows(detail.capabilityPaths);
  const impls = asRows(detail.implementations);
  const evidence = asRows(detail.evidence);

  const topicCitations = dedupeCitations([
    ...impls.map(citeImplementation),
    ...evidence.map(citeEvidence).filter((c): c is Citation => c !== null),
  ]).slice(0, 8);

  const level = LEVEL_META[card.level].label.toLowerCase();
  const strongTopic =
    card.levelRank >= 2 && topicCitations.length > 0 && card.evidence.files > 0;

  const items: ProofItem[] = paths.map((p, i) => {
    const capabilityId = str(p.capabilityId);
    const name = str(p.capability) || capabilityId || "this skill";
    const demos = num(p.demonstrations);

    const linked = dedupeCitations(
      builds
        .filter(
          (b) =>
            (capabilityId && str(b.capabilityId) === capabilityId) ||
            (str(b.capability) !== "" &&
              str(b.capability) === str(p.capability)),
        )
        .map(citeBuild),
    );

    const cls: ProofClass =
      demos > 0 || linked.length > 0
        ? "observed"
        : strongTopic
          ? "inferred"
          : "association";

    const practiceOnly =
      cls === "observed" &&
      linked.length > 0 &&
      linked.every((c) => c.kind === "practice_mission");

    let citations: Citation[] = [];
    let attributed = false;
    if (cls === "observed") {
      if (linked.length) {
        citations = linked.slice(0, 3);
        attributed = true;
      } else {
        citations = topicCitations.slice(0, 3);
      }
    } else if (cls === "inferred") {
      citations = topicCitations.slice(0, 2);
    }

    const count = Math.max(demos, linked.length);
    const first = citations[0];
    const where = first?.repository ? ` in ${first.repository}` : "";
    const example = first?.title ? `, such as “${first.title}”` : "";

    let demonstrates: string;
    let matters: string;
    let limit: string;
    if (cls === "observed") {
      demonstrates = `${plural(count, "detected example")} of ${name} in your own code${example}${where}.${practiceOnly ? " Only practice missions back it." : ""}`;
      matters = `This is applied work, not a label. Your ${level} rating in ${card.name} rests partly on it.`;
      limit = practiceOnly
        ? "Practice missions are guided exercises, not your own project."
        : count <= 1
          ? "Only one example was found. Repeated use would make it stronger."
          : "";
    } else if (cls === "inferred") {
      demonstrates = `No example of ${name} was matched directly. It is inferred because ${card.name} is rated ${level} from ${plural(card.evidence.files, "file")} with cited code.`;
      matters =
        "Treat it as likely, not proven. One matched example would confirm it.";
      limit = "No direct example in your code.";
    } else {
      demonstrates = `${name} is linked to ${card.name} in the topic map. Nothing in your code was matched to it.`;
      matters =
        "A link in the map is not evidence of skill. It only shows where this topic could lead.";
      limit = "Taxonomy mapping only.";
    }

    return {
      id: `${capabilityId || "cap"}:${i}`,
      capabilityId,
      capability: name,
      class: cls,
      classLabel: CLASS_LABEL[cls],
      demonstrations: demos,
      weight: nullableNum(p.weight),
      practiceOnly,
      attributed,
      citations,
      demonstrates,
      matters,
      limit,
    };
  });

  const order: Record<ProofClass, number> = {
    observed: 0,
    inferred: 1,
    association: 2,
  };
  items.sort(
    (a, b) =>
      order[a.class] - order[b.class] ||
      b.demonstrations - a.demonstrations ||
      a.capability.localeCompare(b.capability),
  );

  return {
    items,
    topicCitations,
    counts: {
      observed: items.filter((x) => x.class === "observed").length,
      inferred: items.filter((x) => x.class === "inferred").length,
      association: items.filter((x) => x.class === "association").length,
    },
  };
}

interface PrereqStep {
  slug: string;
  name: string;
  assessed: boolean;
  level: DepthLevel | null;
  score: number | null;
}

interface PrereqPath {
  steps: PrereqStep[];
  hops: number;
  reasons: string[];
  strength: "required" | "helpful" | "unknown";
  status: "demonstrated" | "weak" | "unverified";
  weakest: string;
  sentence: string;
}

/**
 * Genuine prerequisite chains: only BUILDS_ON edges that carry a stated reason.
 * RELATED_TOPIC never appears here.
 */
function buildPrereqPaths(d: Dossier, slug: string, detail: Row): PrereqPath[] {
  const adj = new Map<string, EdgeRow[]>();
  for (const e of d.edges) {
    if (e.type !== "BUILDS_ON" || !e.trusted) continue;
    adj.set(e.source, [...(adj.get(e.source) ?? []), e]);
  }
  const learn = asRows(detail.learning?.prerequisites);
  const strengthOf = (target: string): PrereqPath["strength"] => {
    const hit = learn.find((p) => str(p.slug ?? p.topic?.slug) === target);
    const s = str(hit?.edge?.strength);
    return s === "required" || s === "helpful" ? s : "unknown";
  };

  const trails: EdgeRow[][] = [];
  const walk = (node: string, trail: EdgeRow[], seen: Set<string>): void => {
    const next = (adj.get(node) ?? []).filter((e) => !seen.has(e.target));
    if (!next.length || trail.length >= 3) {
      if (trail.length) trails.push(trail);
      return;
    }
    for (const e of next)
      walk(e.target, [...trail, e], new Set([...seen, e.target]));
  };
  walk(slug, [], new Set([slug]));

  const rankOf = (s: PrereqStep): number =>
    s.assessed ? DEPTH_RANK[s.level ?? "none"] : -1;

  return trails
    .map((trail): PrereqPath => {
      const names = [slug, ...trail.map((e) => e.target)];
      const steps: PrereqStep[] = names.map((s) => {
        const r = refFor(d, s);
        return {
          slug: s,
          name: r.name,
          assessed: r.assessed,
          level: r.level,
          score: r.score,
        };
      });
      const found = steps.slice(1);
      const status: PrereqPath["status"] = found.some((s) => !s.assessed)
        ? "unverified"
        : found.some((s) => rankOf(s) <= 1)
          ? "weak"
          : "demonstrated";
      const weakest =
        [...found].sort((a, b) => rankOf(a) - rankOf(b))[0]?.name ?? "";
      return {
        steps,
        hops: trail.length,
        reasons: trail.map((e) => e.reason),
        strength: strengthOf(trail[0].target),
        status,
        weakest,
        sentence: steps.map((s) => s.name).join(" builds on "),
      };
    })
    .sort(
      (a, b) =>
        a.hops - b.hops ||
        Number(b.strength === "required") - Number(a.strength === "required") ||
        a.sentence.localeCompare(b.sentence),
    )
    .slice(0, 8);
}

interface ConfidenceFactor {
  id: string;
  label: string;
  value: number;
  max: number;
  note: string;
}

interface ConfidenceView {
  stated: string;
  derived: string;
  effective: string;
  score: number;
  factors: ConfidenceFactor[];
  strengths: string[];
  limits: string[];
  /** the rules that actually hold confidence down, in plain words */
  binding: string[];
}

const CONF_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };
const EVIDENCE_KINDS = ["code", "demonstration", "experience", "commit"];

function buildConfidence(
  card: TopicCard,
  detail: Row,
  proof: ProofResult,
  paths: PrereqPath[],
): ConfidenceView {
  const ev = card.evidence;
  const step = (v: number, steps: number[]): number =>
    steps.filter((s) => v >= s).length;

  const storedKinds = ((detail.stats ?? {}) as Row).evidenceKinds as
    | Record<string, number>
    | undefined;
  const kindsSeen = EVIDENCE_KINDS.filter(
    (k) =>
      (storedKinds && num(storedKinds[k]) > 0) ||
      asRows(detail.evidence).some((e) => str(e.kind) === k),
  );

  const observedReal = proof.items.filter(
    (i) => i.class === "observed" && !i.practiceOnly,
  ).length;

  const factors: ConfidenceFactor[] = [
    {
      id: "files",
      label: "Files touched",
      value: step(ev.files, [3, 8, 20]),
      max: 3,
      note: plural(ev.files, "file"),
    },
    {
      id: "commits",
      label: "Separate changes",
      value: step(ev.commits, [2, 5, 12]),
      max: 3,
      note: plural(ev.commits, "commit"),
    },
    {
      id: "repos",
      label: "Projects",
      value: step(ev.repos, [2, 3]),
      max: 2,
      note:
        ev.repos < 2
          ? "evidence comes from a single project"
          : `${ev.repos} projects`,
    },
    {
      id: "days",
      label: "Work over time",
      value: step(ev.activeDays, [3, 10]),
      max: 2,
      note: plural(ev.activeDays, "active day"),
    },
    {
      id: "kinds",
      label: "Kinds of evidence",
      value: kindsSeen.length,
      max: 4,
      note: `${kindsSeen.length} of 4 kinds (${kindsSeen.join(", ") || "none"})`,
    },
    {
      id: "observed",
      label: "Skills seen in your code",
      value: Math.min(3, observedReal),
      max: 3,
      note: `${observedReal} skill${observedReal === 1 ? "" : "s"} with a detected example in your own work`,
    },
    {
      id: "authenticity",
      label: "Built or only used",
      value:
        card.authenticity === "genuine_implementation"
          ? 2
          : card.authenticity === "working_usage"
            ? 1
            : 0,
      max: 2,
      note: AUTHENTICITY_META[card.authenticity].label.toLowerCase(),
    },
  ];
  if (paths.length) {
    const good = paths.filter((p) => p.status === "demonstrated").length;
    factors.push({
      id: "foundations",
      label: "Foundations backed",
      value: Math.round((good / paths.length) * 2),
      max: 2,
      note: `${good} of ${paths.length} foundation path${paths.length === 1 ? "" : "s"} backed by your code`,
    });
  }

  const total = factors.reduce((n, f) => n + f.value, 0);
  const max = factors.reduce((n, f) => n + f.max, 0);
  const ratio = max ? total / max : 0;

  let derived: string =
    ratio >= 0.6 && kindsSeen.length >= 3
      ? "high"
      : ratio >= 0.35
        ? "medium"
        : "low";
  if (ev.files < 3 || ev.commits < 2) derived = "low";
  if (derived === "high" && ev.repos < 2) derived = "medium";
  if (derived === "high" && observedReal === 0) derived = "medium";
  if (card.fallback) derived = "low";

  const stated = card.confidence || "low";
  const effective =
    (CONF_RANK[derived] ?? 1) < (CONF_RANK[stated] ?? 1) ? derived : stated;

  // The rules that actually hold confidence down, said once in plain words.
  const binding: string[] = [];
  if (card.fallback)
    binding.push(
      "no model reviewed the code, so the level comes from counts only",
    );
  if (ev.files < 3 || ev.commits < 2) binding.push("very few files or commits");
  if (kindsSeen.length < 3)
    binding.push(`only ${kindsSeen.length} of 4 kinds of evidence`);
  if (ev.repos < 2) binding.push("all of the evidence is in one project");
  if (observedReal === 0)
    binding.push("no skill has a detected example in your own code");

  return {
    stated,
    derived,
    effective,
    score: round(ratio, 2),
    factors,
    strengths: factors
      .filter((f) => f.value / f.max >= 0.67)
      .map((f) => `${f.label}: ${f.note}`),
    limits: factors
      .filter((f) => f.value / f.max < 0.5)
      .map((f) => `${f.label}: ${f.note}`),
    binding,
  };
}

interface ProofContext {
  proof: ProofResult;
  paths: PrereqPath[];
  confidence: ConfidenceView;
}

async function proofContext(
  d: Dossier,
  card: TopicCard,
  detail: Row,
  ev?: Row | null,
): Promise<ProofContext> {
  let builds = asRows(ev?.builds);
  if (!ev) {
    try {
      const graph = await getGraphForDeveloper(d.developerId);
      const e = (await readTopicGraphEvidence(
        graph,
        d.developerId,
        card.slug,
      )) as unknown as Row | null;
      builds = asRows(e?.builds);
    } catch (err) {
      console.error(
        `${LOG} proof builds unavailable:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  const proof = buildProof(card, detail, builds);
  const paths = buildPrereqPaths(d, card.slug, detail);
  const confidence = buildConfidence(card, detail, proof, paths);
  return { proof, paths, confidence };
}

const citationLabel = (c: Citation): string =>
  [
    c.title || (c.snippet ? c.snippet.slice(0, 80) : "") || c.commit,
    c.path,
    c.repository,
  ]
    .filter(Boolean)
    .join(" · ");

// ============================================================
// LIMITATIONS, CONTRADICTIONS AND THE REASONING TRACE
// Every line is built from stored fields or the queried graph. Nothing invented.
// ============================================================

function limitationsFor(
  card: TopicCard,
  detail: Row,
  ctx: ProofContext,
): string[] {
  const limitations: string[] = [...asArray<string>(detail.gaps)];
  if (ctx.confidence.effective === "low")
    limitations.push(
      "Confidence is low: little or narrow evidence sits behind this level.",
    );
  else if (ctx.confidence.effective !== card.confidence)
    limitations.push(
      `Confidence is shown as ${ctx.confidence.effective}: the stored value (${card.confidence}) is higher than the current evidence supports.`,
    );
  for (const lim of ctx.confidence.limits.slice(0, 2))
    limitations.push(`Evidence is thin on: ${lim}.`);
  if (card.authenticity !== "genuine_implementation")
    limitations.push(
      `Authenticity is "${AUTHENTICITY_META[card.authenticity].label.toLowerCase()}", so this is not shown as something the developer built.`,
    );
  if (card.fallback)
    limitations.push(
      "No model judgement was available; the graph baseline decided.",
    );
  if (card.evidence.commits <= 1 && card.evidence.files > 0)
    limitations.push("Only one commit touches this topic.");
  if (ctx.proof.counts.inferred > 0)
    limitations.push(
      `${plural(ctx.proof.counts.inferred, "linked skill")} ${ctx.proof.counts.inferred === 1 ? "is" : "are"} only inferred from the topic rating; no example was matched.`,
    );
  if (ctx.proof.counts.association > 0)
    limitations.push(
      `${plural(ctx.proof.counts.association, "linked skill")} ${ctx.proof.counts.association === 1 ? "is" : "are"} linked in the taxonomy only, not seen in your code.`,
    );
  for (const p of ctx.paths
    .filter((x) => x.status !== "demonstrated")
    .slice(0, 2))
    limitations.push(
      p.status === "unverified"
        ? `Foundation path "${p.sentence}" has a foundation with no assessment (${p.weakest}).`
        : `Foundation path "${p.sentence}" rests on a shallow foundation (${p.weakest}).`,
    );
  for (const p of asRows(detail.learning?.prerequisites)) {
    if (p.hops === 1 && p.edge?.strength === "required" && !p.met)
      limitations.push(
        `Required foundation ${p.name} is not shown at working depth.`,
      );
  }
  return uniq(limitations).slice(0, 10);
}

/** Conflicts between stored fields, and assessments older than the current analysis version. */
function contradictionsFor(
  d: Dossier,
  card: TopicCard,
  ctx: ProofContext,
): {
  contradictions: string[];
  stale: boolean;
  analysisVersion: number | null;
} {
  const out: string[] = [];
  const observedReal = ctx.proof.items.filter(
    (i) => i.class === "observed" && !i.practiceOnly,
  ).length;
  if (card.fallback && card.levelRank > DEPTH_RANK.proficient)
    out.push(
      `Rated ${card.levelLabel.toLowerCase()} from counts alone: no model reviewed the code. Re-judge this topic; new analyses cap this case at proficient.`,
    );
  if (card.level === "deep" && card.authenticity !== "genuine_implementation")
    out.push("Rated deep, but authenticity is not a genuine implementation.");
  if (card.levelRank >= 3 && ctx.proof.items.length > 0 && observedReal === 0)
    out.push(
      `Rated ${card.levelLabel.toLowerCase()}, but none of its linked skills has a detected example in your own code.`,
    );
  if (card.levelRank >= 2 && card.authenticity === "boilerplate")
    out.push("Rated above surface, but the evidence is mostly boilerplate.");
  if (ctx.confidence.stated !== ctx.confidence.effective)
    out.push(
      `Stored confidence (${ctx.confidence.stated}) is higher than the current evidence supports (${ctx.confidence.derived}).`,
    );
  if (Math.abs(card.scoreDelta) >= 25)
    out.push(
      `Final score differs from the graph baseline by ${card.scoreDelta >= 0 ? "+" : ""}${card.scoreDelta} points.`,
    );
  const weakRequired = ctx.paths.find(
    (p) =>
      p.hops === 1 && p.strength === "required" && p.status !== "demonstrated",
  );
  if (card.levelRank >= 3 && weakRequired)
    out.push(
      `Rated ${card.levelLabel.toLowerCase()} while its required foundation ${weakRequired.weakest} is not backed by your code.`,
    );
  const version = d.analysis?.version ?? null;
  const stale = version != null && version < DEPTH_ANALYSIS_VERSION;
  if (stale)
    out.push(
      `Assessed with analysis version ${version}; the current version is ${DEPTH_ANALYSIS_VERSION}. Re-run to refresh.`,
    );
  return { contradictions: out, stale, analysisVersion: version };
}

interface Claim {
  text: string;
  evidenceIds: string[];
  slug?: string;
}

function buildTrace(
  d: Dossier,
  card: TopicCard,
  detail: Row,
  ev: Row | null,
  ctx: ProofContext,
  limitations: string[],
) {
  const nodes = asRows(ev?.nodes);
  const edges = asRows(ev?.edges);
  const labelOf = (id: string) =>
    str(nodes.find((n) => n.id === id)?.label) ||
    id.replace(/^(topic|approach|assessment):/, "");
  const topicNode = `topic:${card.slug}`;
  const assessmentNode = `assessment:${card.slug}`;

  // ---- supporting evidence, with stable ids, tied to what it supports ----
  const supportingEvidence: Array<{
    evidenceId: string;
    kind: string;
    source: string;
    supports: string;
    permalink: string;
  }> = [];
  const idByKey = new Map<string, string>();
  const addEvidence = (c: Citation, supports: string): string => {
    const key = citationKey(c);
    const known = idByKey.get(key);
    if (known) return known;
    const id = `E${supportingEvidence.length + 1}`;
    idByKey.set(key, id);
    supportingEvidence.push({
      evidenceId: id,
      kind: c.kind,
      source: citationLabel(c) || "cited work",
      supports,
      permalink: c.permalink,
    });
    return id;
  };
  const idsFor = new Map<string, string[]>();
  for (const i of ctx.proof.items) {
    if (i.class !== "observed") continue;
    idsFor.set(
      i.id,
      i.citations
        .filter(isCitation)
        .map((c) => addEvidence(c, `capability: ${i.capability}`)),
    );
  }
  for (const c of ctx.proof.topicCitations)
    addEvidence(c, `topic: ${card.name}`);

  // ---- scope: why the topic total can be larger than an approach's count ----
  const approachRows = asRows(detail.approaches);
  const storedStats = (detail.stats ?? {}) as Row;
  const scope = {
    topicFiles: card.evidence.files,
    topicCommits: card.evidence.commits,
    topicRepos: card.evidence.repos,
    approaches: approachRows.map((a) => ({
      name: str(a.name ?? a.slug),
      files: num(a.files),
      commits: num(a.commits),
    })),
    unattributedFiles: nullableNum(storedStats.unattributedFiles),
    note: `${card.evidence.files} files across ${card.evidence.commits} commits match the topic as a whole. Each approach counts only the files that match its own packages and signals, so an approach can show fewer.`,
  };

  // ---- claims: observed / inferred / unknown ----
  const observed: Claim[] = [];
  const inferred: Claim[] = [];
  const unknown: Claim[] = [];
  for (const a of approachRows) {
    const refs = asArray(a.evidenceRefs ?? a.evidence ?? a.evidenceItems);
    const how = str(a.howImplemented);
    const depth = LEVEL_META[str(a.depth) as DepthLevel]?.label ?? str(a.depth);
    const name = str(a.name ?? a.slug);
    const own = `${plural(num(a.files), "file")} / ${plural(num(a.commits), "commit")} for this approach`;
    if (
      refs.length > 0 ||
      (how && str(a.authenticity) === "genuine_implementation")
    )
      observed.push({
        text: `Approach ${name} (${depth}, ${own}): ${how || plural(refs.length, "cited piece") + " of code"}`,
        evidenceIds: [],
        slug: str(a.slug),
      });
    else
      inferred.push({
        text: `Approach ${name} (${depth}, ${own}): judged from the topic rating, no code cited for this approach.`,
        evidenceIds: [],
        slug: str(a.slug),
      });
  }
  for (const i of ctx.proof.items) {
    if (i.class === "observed")
      observed.push({
        text: `Detected in your code: ${i.capability}`,
        evidenceIds: idsFor.get(i.id) ?? [],
      });
    else if (i.class === "inferred")
      inferred.push({
        text: `${i.capability}: inferred from the topic rating, no example matched.`,
        evidenceIds: [],
      });
    else
      unknown.push({
        text: `${i.capability}: linked in the topic map only; nothing in your code was matched.`,
        evidenceIds: [],
      });
  }
  if (observed.length === 0 && asArray(detail.implementations).length > 0)
    observed.push({
      text: `${plural(asArray(detail.implementations).length, "implementation")} cited by the assessment.`,
      evidenceIds: supportingEvidence.slice(0, 3).map((e) => e.evidenceId),
    });
  for (const l of limitations) unknown.push({ text: l, evidenceIds: [] });

  // ---- graph paths: every one comes from the queried graph ----
  const graphPaths: Array<{
    kind: string;
    nodeIds: string[];
    relationshipTypes: string[];
    explanation: string;
  }> = [
    {
      kind: "assessment",
      nodeIds: ["developer", assessmentNode, topicNode],
      relationshipTypes: ["ASSESSED", "OF_TOPIC"],
      explanation: `Developer was assessed on ${card.name}.`,
    },
  ];
  for (const a of approachRows)
    graphPaths.push({
      kind: "approach",
      nodeIds: [assessmentNode, `approach:${str(a.slug)}`],
      relationshipTypes: ["USES_APPROACH"],
      explanation: `The assessment records the approach "${str(a.name ?? a.slug)}" (${str(a.depth)}).`,
    });
  for (const b of asRows(ev?.backedBy))
    graphPaths.push({
      kind: "evidence",
      nodeIds: [assessmentNode, `evidence:${str(b.kind)}`],
      relationshipTypes: ["BACKED_BY"],
      explanation: `${num(b.count)} ${str(b.kind)} item(s) back the assessment.`,
    });
  for (const e of [...edges]
    .sort((a, b) => num(a.hop) - num(b.hop))
    .slice(0, 24))
    graphPaths.push({
      kind: "topic_edge",
      nodeIds: [str(e.source), str(e.target)],
      relationshipTypes: [str(e.type)],
      explanation: `${labelOf(str(e.source))} ${str(e.type) === "BUILDS_ON" ? "builds on" : str(e.type) === "RELATED_TOPIC" ? "is related to" : str(e.type)} ${labelOf(str(e.target))} (hop ${num(e.hop)})${str(e.note) ? `: ${str(e.note).slice(0, 140)}` : ""}`,
    });
  for (const p of ctx.paths)
    graphPaths.push({
      kind: "prerequisite",
      nodeIds: p.steps.map((s) => `topic:${s.slug}`),
      relationshipTypes: p.steps.slice(1).map(() => "BUILDS_ON"),
      explanation: `${p.sentence}. Status: ${p.status}${p.weakest ? `, weakest link ${p.weakest}` : ""}. Reasons: ${p.reasons.join(" | ")}`,
    });

  // ---- algorithms: one responsibility each; only some change the assessment ----
  const ranked = (pick: (c: TopicCard) => number | null) => {
    const list = d.cards
      .map((c) => ({ slug: c.slug, v: pick(c) }))
      .filter((x): x is { slug: string; v: number } => x.v != null)
      .sort((a, b) => b.v - a.v);
    const i = list.findIndex((x) => x.slug === card.slug);
    return { position: i < 0 ? null : i + 1, of: list.length };
  };
  const demonstrated = ctx.paths.filter(
    (p) => p.status === "demonstrated",
  ).length;
  const algorithmsApplied = [
    {
      name: "Prerequisite traversal",
      purpose:
        "Find the foundations this topic needs and check them against your code.",
      affectsAssessment: true,
      result: {
        paths: ctx.paths.length,
        demonstrated,
        weak: ctx.paths.filter((p) => p.status === "weak").length,
        unverified: ctx.paths.filter((p) => p.status === "unverified").length,
        usedFor:
          "confidence factor 'Foundations backed', limitations, foundation gaps",
      },
    },
    {
      name: "PageRank",
      purpose: "Taxonomy importance: how many topics stand on this one.",
      affectsAssessment: false,
      result: {
        value: card.graph.foundationRank,
        normalized: card.graph.foundationRankNorm,
        ...ranked((c) => c.graph.foundationRank),
        note: "Structural. Not proficiency.",
      },
    },
    {
      name: "Betweenness centrality",
      purpose: "Structural bridge between otherwise separate areas.",
      affectsAssessment: false,
      result: {
        value: card.graph.bridgeScore,
        normalized: card.graph.bridgeScoreNorm,
        ...ranked((c) => c.graph.bridgeScore),
        note: "Structural. Not expertise.",
      },
    },
    {
      name: "Label propagation",
      purpose: "Knowledge area this topic belongs to.",
      affectsAssessment: false,
      result: {
        clusterId: card.graph.clusterId,
        peers:
          card.graph.clusterId == null
            ? 0
            : d.cards.filter(
                (c) =>
                  c.slug !== card.slug &&
                  c.graph.clusterId === card.graph.clusterId,
              ).length,
      },
    },
    {
      name: "Weakly connected components",
      purpose: "Taxonomy quality: is the topic part of the main body?",
      affectsAssessment: false,
      result: { componentId: card.graph.componentId },
    },
  ];

  const flags = contradictionsFor(d, card, ctx);
  return {
    topicId: card.slug,
    snapshot: {
      analysisVersion: flags.analysisVersion,
      currentVersion: DEPTH_ANALYSIS_VERSION,
      model: d.analysis?.model ?? null,
      lastAnalyzedAt: d.analysis?.updatedAt ?? null,
    },
    scope,
    // three different things, never collapsed into one score
    structure: {
      taxonomyImportance: {
        foundationRank: card.graph.foundationRank,
        bridgeScore: card.graph.bridgeScore,
        clusterId: card.graph.clusterId,
        componentId: card.graph.componentId,
        roles: card.graph.roles,
        note: "Describes the shared taxonomy. Says nothing about this developer's skill.",
      },
      proficiency: {
        level: card.level,
        score: card.score,
        baseline: card.baselineScore,
        authenticity: card.authenticity,
        note: "Judged from cited evidence and checked by guard-rails.",
      },
      confidence: {
        level: ctx.confidence.effective,
        stored: ctx.confidence.stated,
        derived: ctx.confidence.derived,
        ratio: ctx.confidence.score,
        binding: ctx.confidence.binding,
        note: "How strong and varied the evidence is. Not how good the developer is.",
      },
    },
    assessment: {
      depth: card.level,
      score: card.score,
      confidence: ctx.confidence.effective,
      confidenceRatio: ctx.confidence.score,
      authenticity: card.authenticity,
    },
    claims: { observed, inferred, unknown: unknown.slice(0, 12) },
    supportingEvidence,
    graphPaths,
    algorithmsApplied,
    limitations,
    contradictions: flags.contradictions,
    stale: flags.stale,
  };
}

// ============================================================
// PLAIN-LANGUAGE STORY (graph facts -> words a normal user understands)
// ============================================================

interface PlainStory {
  headline: string;
  summary: string;
  steps: Array<{ title: string; text: string }>;
  meaning: string;
  caveat: string;
  followups: string[];
  proof: ProofItem[];
  prerequisitePaths: PrereqPath[];
  prerequisiteSummary: string;
  confidence: ConfidenceView;
  confidenceNote: string;
}

const joinList = (items: string[], max = 3): string => {
  const a = uniq(items.filter(Boolean)).slice(0, max);
  if (a.length <= 1) return a.join("");
  return `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;
};

const cardScore = (d: Dossier, slug: string): number =>
  d.bySlug.get(slug)?.score ?? 0;

function plainFacts(
  card: TopicCard,
  ev: Row,
  algorithms: Row[],
  ctx: ProofContext,
): Row {
  const nodes = asRows(ev.nodes);
  const edges = asRows(ev.edges);
  const builds = asRows(ev.builds);
  const topicNode = `topic:${card.slug}`;
  const label = (id: string) =>
    str(nodes.find((n) => n.id === id)?.label) || id;
  const rank = (id: string) => {
    const a = algorithms.find((x) => x.id === id);
    return a?.position ? { position: num(a.position), of: num(a.of) } : null;
  };

  const skills = nodes
    .filter((n) => n.kind === "capability")
    .map((n) => str(n.label));
  const projects = nodes
    .filter((n) => n.kind === "repository")
    .map((n) => str(n.label));
  const usedBy = edges
    .filter((e) => e.type === "BUILDS_ON" && e.target === topicNode)
    .map((e) => label(str(e.source)));
  const related = edges
    .filter((e) => e.type === "RELATED_TOPIC" && e.source === topicNode)
    .map((e) => label(str(e.target)));
  const buildsOn = uniq(
    ctx.paths.filter((p) => p.hops === 1).map((p) => p.steps[1]?.name ?? ""),
  ).filter(Boolean);

  const conf = ctx.confidence;
  const limitations: string[] = [];
  if (conf.effective === "low")
    limitations.push("Confidence is low because there is little evidence.");
  else if (conf.limits.length)
    limitations.push(`Confidence is held back: ${conf.limits[0]}.`);
  if (card.authenticity !== "genuine_implementation")
    limitations.push(
      "The code looks more like using this than building it from scratch.",
    );
  if (card.evidence.commits <= 1 && card.evidence.files > 0)
    limitations.push("Only one change to the code touches this topic.");
  if (ctx.proof.counts.inferred + ctx.proof.counts.association > 0)
    limitations.push(
      `${ctx.proof.counts.inferred + ctx.proof.counts.association} linked skill${ctx.proof.counts.inferred + ctx.proof.counts.association === 1 ? " is" : "s are"} not seen in your code.`,
    );
  if (num(ev.buildTotals?.missions) === 0)
    limitations.push("No completed practice mission is linked to it.");
  if (builds.length === 0)
    limitations.push("No real piece of work is linked to it in the graph.");

  return {
    topic: card.name,
    area: card.domainLabel,
    level: card.levelLabel,
    levelMeaning: LEVEL_META[card.level].meaning,
    score: card.score,
    confidence: conf.effective,
    authenticity: card.authenticityLabel,
    filesChecked: card.evidence.files,
    changesChecked: card.evidence.commits,
    projectsInvolved: card.evidence.repos,
    realWorkLinked: builds.length,
    missionsLinked: num(ev.buildTotals?.missions),
    examples: builds.slice(0, 4).map((b) => ({
      title: str(b.title),
      project: str(b.repository),
      type: b.kind === "mission" ? "practice mission" : "real work",
    })),
    skillsCovered: uniq(skills).slice(0, 6),
    projects: uniq(projects).slice(0, 5),
    buildsOn: buildsOn.slice(0, 5),
    otherTopicsBuiltOnIt: uniq(usedBy).slice(0, 5),
    usedTogetherWith: uniq(related).slice(0, 5),
    relatedGroupSize: num(ev.metrics?.clusterSize),
    foundationRank: rank("pagerank"),
    connectorRank: rank("betweenness"),
    proofLedger: ctx.proof.items.map((i) => ({
      id: i.id,
      skill: i.capability,
      class: i.class,
      demonstrations: i.demonstrations,
      practiceOnly: i.practiceOnly,
      cited: i.citations.slice(0, 2).map(citationLabel).filter(Boolean),
    })),
    prerequisitePaths: ctx.paths.slice(0, 5).map((p) => ({
      chain: p.sentence,
      status: p.status,
      strength: p.strength,
      weakestLink: p.weakest,
      reasons: p.reasons.slice(0, 2),
    })),
    confidenceDetail: {
      level: conf.effective,
      storedByAssessment: conf.stated,
      strengths: conf.strengths.slice(0, 3),
      limits: conf.limits.slice(0, 3),
    },
    limitations: limitations.slice(0, 4),
  };
}

function plainStory(f: Row, ctx: ProofContext): PlainStory {
  const usedBy = f.otherTopicsBuiltOnIt as string[];
  const related = f.usedTogetherWith as string[];
  const projects = f.projects as string[];
  const examples = f.examples as Array<{ title: string; project: string }>;
  const work = num(f.realWorkLinked);
  const { proof, paths, confidence } = ctx;

  const built =
    f.authenticity === "Genuine implementation"
      ? "The code suggests you built this yourself."
      : "The code suggests you use this well, but did not build the mechanism yourself.";

  const found = work
    ? `${work} piece${work === 1 ? "" : "s"} of real work ${work === 1 ? "is" : "are"} linked to this topic${examples[0] ? `, for example “${examples[0].title}”` : ""}.`
    : "No piece of real work is linked to this topic yet.";

  const skillsText = proof.items.length
    ? `Of ${plural(proof.items.length, "linked skill")}: ${proof.counts.observed} seen in your code, ${proof.counts.inferred} inferred from the topic rating, ${proof.counts.association} only linked in the topic map.`
    : "No wider skill is linked to this topic yet.";

  const fit: string[] = [];
  const direct = paths.filter((p) => p.hops === 1);
  if (direct.length)
    fit.push(
      `It really builds on ${joinList(direct.map((p) => p.steps[1].name))}.`,
    );
  if (usedBy.length) fit.push(`${joinList(usedBy)} build on it.`);
  if (related.length)
    fit.push(
      `It is often used with ${joinList(related)} (an association, not a prerequisite).`,
    );

  const demonstrated = paths.filter((p) => p.status === "demonstrated").length;
  const weak = paths.filter((p) => p.status === "weak").length;
  const unverified = paths.filter((p) => p.status === "unverified").length;
  const prerequisiteSummary = paths.length
    ? `${plural(paths.length, "foundation path")}: ${demonstrated} backed by your code, ${weak} shallow, ${unverified} not assessed.${paths[0].weakest && paths[0].status !== "demonstrated" ? ` Weakest link: ${paths[0].weakest}.` : ""}`
    : "No prerequisite links are recorded for this topic. Connections are associations only.";

  const confidenceNote = `Confidence is ${confidence.effective}. ${[
    confidence.strengths[0],
    confidence.limits[0],
  ]
    .filter(Boolean)
    .join(". But ")}.`.replace(/\.\.$/, ".");

  const files = num(f.filesChecked);
  const projectCount = num(f.projectsInvolved);

  return {
    headline: `${f.topic}: ${String(f.level).toLowerCase()} level, ${f.confidence} confidence`,
    summary: `Pathway checked ${files} file${files === 1 ? "" : "s"} across ${f.changesChecked} change${num(f.changesChecked) === 1 ? "" : "s"} in ${projectCount} project${projectCount === 1 ? "" : "s"} and rated your ${f.topic} skill as ${String(f.level).toLowerCase()}. ${built}`,
    steps: [
      { title: "What we found", text: found },
      { title: "Skills it covers", text: skillsText },
      {
        title: "Where it fits",
        text: fit.length
          ? fit.join(" ")
          : "It is not yet connected to other topics in your graph.",
      },
      {
        title: "Where the work lives",
        text: projects.length
          ? `The work sits in ${joinList(projects)}.`
          : "No project is linked to the work yet.",
      },
    ],
    meaning: String(f.levelMeaning),
    caveat:
      (f.limitations as string[])[0] ??
      "The graph shows activity and connections, not a test of ability.",
    followups: [
      `What does ${f.topic} build on?`,
      `Show me the work behind ${f.topic}`,
      `What is unproven about my ${f.topic}?`,
    ],
    proof: proof.items,
    prerequisitePaths: paths,
    prerequisiteSummary,
    confidence,
    confidenceNote,
  };
}

/** Numbers the model writes must exist in the facts it was given. */
const numbersIn = (s: string): string[] => s.match(/\d+(?:\.\d+)?/g) ?? [];
function ungroundedNumbers(facts: Row, texts: string[]): string[] {
  const allowed = new Set([
    ...numbersIn(JSON.stringify(facts)),
    "0",
    "1",
    "2",
    "3",
  ]);
  return uniq(texts.flatMap(numbersIn).filter((n) => !allowed.has(n)));
}

// ============================================================
// ASSESSMENT STEPS: "How Pathway assessed this topic"
// ============================================================

interface AssessStep {
  id: string;
  title: string;
  summary: string;
  facts: Array<{ label: string; value: string }>;
  items: string[];
  text: string;
  trace?: Row[];
}

function buildAssessment(
  card: TopicCard,
  detail: Row,
  ev: Row,
  ctx: ProofContext,
): AssessStep[] {
  const nodes = asRows(ev.nodes);
  const edges = asRows(ev.edges);
  const trace = asRows(ev.trace);
  const backed = asRows(ev.backedBy);
  const label = (id: string) =>
    str(nodes.find((n) => n.id === id)?.label) || id;
  const stats = (detail.stats ?? {}) as Row;
  const dims = (detail.dimensions ?? null) as Row | null;
  const e = card.evidence;
  const hopCounts = (ev.hopCounts ?? {}) as Record<string, number>;
  const signed = (n: number) => `${n >= 0 ? "+" : ""}${n}`;

  const edgeLines = [...edges]
    .sort((a, b) => num(a.hop) - num(b.hop))
    .slice(0, 16)
    .map(
      (x) =>
        `${label(str(x.source))} —${str(x.type)}→ ${label(str(x.target))} (hop ${num(x.hop)})${str(x.note) ? ` · ${str(x.note).slice(0, 120)}` : ""}`,
    );

  const approaches = asRows(detail.approaches);
  const authCap = AUTHENTICITY_META[card.authenticity];
  const band = DEPTH_BANDS[card.level];

  return [
    {
      id: "discovery",
      title: "Evidence discovery",
      summary: `Pathway matched ${plural(e.files, "authored file")} across ${plural(e.commits, "commit")} in ${plural(e.repos, "repository", "repositories")} to this topic.`,
      facts: [
        { label: "Active days", value: String(e.activeDays) },
        { label: "First seen", value: e.firstSeen || "–" },
        { label: "Last seen", value: e.lastSeen || "–" },
        { label: "Test files matched", value: String(num(stats.testFiles)) },
        {
          label: "Real work linked",
          value: String(num(ev.buildTotals?.builds)),
        },
        {
          label: "Practice missions linked",
          value: String(num(ev.buildTotals?.missions)),
        },
        ...backed.map((b) => ({
          label: `Cited ${str(b.kind)}`,
          value: String(num(b.count)),
        })),
      ],
      items: ctx.proof.topicCitations.slice(0, 5).map(citationLabel),
      text: "",
    },
    {
      id: "traversal",
      title: "Graph traversal",
      summary: `${edges.length} relationship(s) and ${Math.max(0, nodes.length - 1)} node(s) were returned around this topic, up to ${num(ev.maxHop)} hop(s) away.`,
      facts: Object.entries(hopCounts).map(([h, n]) => ({
        label: `Hop ${h}`,
        value: `${n} node(s)`,
      })),
      items: edgeLines,
      text: "Each query below ran against FalkorDB for this topic. Rows and timings are the real execution results.",
      trace,
    },
    {
      id: "implementation",
      title: "Implementation analysis",
      summary: approaches.length
        ? `${plural(approaches.length, "approach", "approaches")} were judged separately.`
        : "No approach is recorded for this topic.",
      facts: [
        {
          label: "Safeguards observed",
          value: String(asArray(detail.safeguards).length),
        },
        {
          label: "Cited implementations",
          value: String(asArray(detail.implementations).length),
        },
        { label: "Test files matched", value: String(num(stats.testFiles)) },
      ],
      items: [
        ...approaches.map(
          (a) =>
            `${str(a.name)}: ${str(a.depth)}${a.isPrimary ? " (primary)" : ""}${str(a.howImplemented) ? ` — ${str(a.howImplemented)}` : ""}`,
        ),
        ...asArray<string>(detail.safeguards)
          .slice(0, 4)
          .map((s) => `Safeguard: ${s}`),
      ],
      text: "",
    },
    {
      id: "judgment",
      title: "Agent judgment",
      summary: `Baseline ${card.baselineScore}, final ${card.score} (${card.levelLabel}), adjustment ${signed(card.scoreDelta)}.`,
      facts: [
        {
          label: "Baseline",
          value: `${card.baselineScore} (${str(detail.baselineLevel)})`,
        },
        { label: "Final", value: `${card.score} (${card.levelLabel})` },
        {
          label: "Decided by",
          value: card.fallback
            ? "graph baseline only"
            : "model judgement + guard-rails",
        },
        {
          label: "Authenticity",
          value: `${authCap.label} (cap: ${authCap.maxLevel})`,
        },
        { label: "Level band", value: `${band[0]}–${band[1]}` },
        ...(dims
          ? [
              {
                label: "Implementation complexity",
                value: String(num(dims.implementationComplexity)),
              },
              {
                label: "Approaches credible",
                value: `${num(dims.approachCoverage?.credible)}/${num(dims.approachCoverage?.assessed)}`,
              },
            ]
          : []),
      ],
      items: [],
      text: str(detail.rationale),
    },
    {
      id: "confidence",
      title: "Confidence and limitations",
      summary: `Confidence is ${ctx.confidence.effective}${ctx.confidence.stated !== ctx.confidence.effective ? ` (stored as ${ctx.confidence.stated}; current evidence supports ${ctx.confidence.derived})` : ""}.`,
      facts: ctx.confidence.factors.map((f) => ({
        label: f.label,
        value: `${f.value}/${f.max} · ${f.note}`,
      })),
      items: ctx.confidence.limits,
      text: "Missing evidence lowers confidence. It is not treated as proof that the skill is absent.",
    },
  ];
}

async function buildGraphPayload(d: Dossier, slug: string) {
  const card = d.bySlug.get(slug);
  if (!card) return null;
  const graph = await getGraphForDeveloper(d.developerId);
  const ev = await readTopicGraphEvidence(graph, d.developerId, slug);
  if (!ev) return null;
  const detail = await readTopicDepthDetail(graph, d.developerId, slug);
  const ctx = await proofContext(
    d,
    card,
    (detail ?? {}) as unknown as Row,
    ev as unknown as Row,
  );

  const posOf = (pick: (c: TopicCard) => number | null) => {
    const ranked = d.cards
      .map((c) => ({ slug: c.slug, v: pick(c) }))
      .filter((x): x is { slug: string; v: number } => x.v != null)
      .sort((a, b) => b.v - a.v);
    const i = ranked.findIndex((x) => x.slug === slug);
    return { position: i < 0 ? null : i + 1, of: ranked.length };
  };

  const algorithms = [
    {
      id: "pagerank",
      name: "PageRank",
      call: "CALL algo.pageRank('Topic', 'BUILDS_ON')",
      property: "Topic.foundation_rank",
      value: card.graph.foundationRank,
      norm: card.graph.foundationRankNorm,
      ...posOf((c) => c.graph.foundationRank),
      reading: `${ev.reach.unlocks} topic(s) build on this one within 2 hops.`,
    },
    {
      id: "betweenness",
      name: "Betweenness centrality",
      call: "CALL algo.betweenness({nodeLabels:['Topic'], relationshipTypes:['BUILDS_ON','RELATED_TOPIC']})",
      property: "Topic.bridge_score",
      value: card.graph.bridgeScore,
      norm: card.graph.bridgeScoreNorm,
      ...posOf((c) => c.graph.bridgeScore),
      reading:
        "How often this topic sits on a shortest path between two others.",
    },
    {
      id: "label_propagation",
      name: "Label propagation",
      call: "CALL algo.labelPropagation({relationshipTypes:['RELATED_TOPIC']})",
      property: "Topic.cluster_id",
      value: ev.metrics.clusterId,
      norm: null,
      position: null,
      of: ev.metrics.clusterSize,
      reading:
        ev.metrics.clusterId == null
          ? "Not in a community (no RELATED_TOPIC edges)."
          : `Community ${ev.metrics.clusterId} with ${ev.metrics.clusterSize} topics.`,
    },
    {
      id: "wcc",
      name: "Weakly connected components",
      call: "CALL algo.WCC({relationshipTypes:['BUILDS_ON','RELATED_TOPIC']})",
      property: "Topic.component_id",
      value: ev.metrics.componentId,
      norm: null,
      position: null,
      of: ev.metrics.componentSize,
      reading:
        ev.metrics.componentId == null
          ? "Not computed."
          : `Component ${ev.metrics.componentId} with ${ev.metrics.componentSize} topics.`,
    },
    {
      id: "traversal",
      name: "Variable-length traversal",
      call: "(t)-[:BUILDS_ON*1..3]->(f); (t)<-[:BUILDS_ON*1..2]-(u)",
      property: null,
      value: ev.reach.maxPrereqHop,
      norm: null,
      position: null,
      of: 0,
      reading: `${ev.reach.prerequisites} foundation(s) up to ${ev.reach.maxPrereqHop} hops down, ${ev.reach.unlocks} topic(s) above, ${ev.reach.related} related.`,
    },
  ];

  const enrichedNodes: Row[] = (ev.nodes as unknown as Row[]).map((n) => {
    if (n.kind === "topic_neighbor") {
      const s = str(n.meta?.slug);
      const c = d.bySlug.get(s);
      return {
        ...n,
        kind: "topic",
        slug: s,
        level: c?.level,
        assessed: Boolean(c),
        note: c ? c.verdict : "Linked in the topic map, not assessed.",
      };
    }
    if (n.kind === "demonstration") {
      const b = ev.builds.find((x) => `demo:${x.id}` === n.id);
      return {
        ...n,
        permalink: b?.permalink || undefined,
        note: `Depth: ${str(n.meta?.depth)}${n.meta?.mission ? " (practice mission)" : ""}`,
      };
    }
    return n;
  });
  const backedNodes: Row[] = ev.backedBy.map((b) => ({
    id: `backed:${b.kind}`,
    kind: "evidence",
    label: `${b.count} cited ${b.kind.toLowerCase()}`,
    hop: 1,
    meta: {},
    note: `${b.count} ${b.kind} item(s) back this assessment (BACKED_BY).`,
  }));
  const backedEdges: Row[] = ev.backedBy.map((b) => ({
    id: `topic:${slug}|BACKED_BY|backed:${b.kind}`,
    source: `topic:${slug}`,
    target: `backed:${b.kind}`,
    type: "BACKED_BY",
    hop: 1,
    note: "",
  }));

  const base = {
    ...ev,
    nodes: [...enrichedNodes, ...backedNodes],
    edges: [...(ev.edges as unknown as Row[]), ...backedEdges],
    topic: mini(card),
    algorithms,
    proof: ctx.proof.items,
    proofCounts: ctx.proof.counts,
    topicCitations: ctx.proof.topicCitations,
    prerequisitePaths: ctx.paths,
    confidence: ctx.confidence,
    score: {
      score: card.score,
      level: card.level,
      baseline: card.baselineScore,
      adjustment: card.scoreDelta,
      confidence: ctx.confidence.effective,
      authenticity: card.authenticity,
      evidence: card.evidence,
      graphSupport: {
        demonstrations: ev.buildTotals.missions + ev.buildTotals.builds,
        missions: ev.buildTotals.missions,
        citedEdges: ev.backedBy.reduce((n, b) => n + b.count, 0),
      },
    },
    assessment: buildAssessment(
      card,
      (detail ?? {}) as unknown as Row,
      ev as unknown as Row,
      ctx,
    ),
  };
  const facts = plainFacts(card, base as unknown as Row, algorithms, ctx);
  return { ...base, plain: { facts, story: plainStory(facts, ctx) } };
}

// ============================================================
// ROUTES
// ============================================================

async function dossierFor(req: AuthedRequest): Promise<Dossier | null> {
  return getDossier(req.developer!.developerId, flag(req.query.fresh));
}

topicsRouter.get("/api/topics/model", requireAuth, (_req, res) =>
  res.json(TOPICS_MODEL),
);

topicsRouter.get(
  "/api/topics",
  requireAuth,
  async (req: AuthedRequest, res) => {
    try {
      const d = await dossierFor(req);
      if (!d) return res.status(404).json(NOT_SYNCED);
      const view = str(req.query.view, "full");
      return res.json(buildOverview(d, req.query as Query, view));
    } catch (err) {
      console.error("GET /api/topics failed:", err);
      return res.status(500).json({ error: "Failed to load topics" });
    }
  },
);

topicsRouter.get(
  "/api/topics/groups",
  requireAuth,
  async (req: AuthedRequest, res) => {
    try {
      const d = await dossierFor(req);
      if (!d) return res.status(404).json(NOT_SYNCED);
      return res.json({
        developerId: d.developerId,
        generatedAt: d.generatedAt,
        totalTopics: d.cards.length,
        dimensions: buildGroups(d),
      });
    } catch (err) {
      console.error("GET /api/topics/groups failed:", err);
      return res.status(500).json({ error: "Failed to build groups" });
    }
  },
);

topicsRouter.get(
  "/api/topics/relations",
  requireAuth,
  async (req: AuthedRequest, res) => {
    try {
      const d = await dossierFor(req);
      if (!d) return res.status(404).json(NOT_SYNCED);
      return res.json({
        developerId: d.developerId,
        generatedAt: d.generatedAt,
        ...buildRelations(d),
      });
    } catch (err) {
      console.error("GET /api/topics/relations failed:", err);
      return res.status(500).json({ error: "Failed to build relations" });
    }
  },
);

topicsRouter.get(
  "/api/topics/graph",
  requireAuth,
  async (req: AuthedRequest, res) => {
    try {
      const d = await dossierFor(req);
      if (!d) return res.status(404).json(NOT_SYNCED);
      return res.json(buildGraph(d, !off(req.query.neighbors)));
    } catch (err) {
      console.error("GET /api/topics/graph failed:", err);
      return res.status(500).json({ error: "Failed to build topic graph" });
    }
  },
);

topicsRouter.get(
  "/api/topics/algorithms",
  requireAuth,
  async (req: AuthedRequest, res) => {
    try {
      const d = await dossierFor(req);
      if (!d) return res.status(404).json(NOT_SYNCED);
      return res.json(buildAlgorithms(d));
    } catch (err) {
      console.error("GET /api/topics/algorithms failed:", err);
      return res.status(500).json({ error: "Failed to describe algorithms" });
    }
  },
);

topicsRouter.get(
  "/api/topics/integrity",
  requireAuth,
  async (req: AuthedRequest, res) => {
    try {
      const d = await dossierFor(req);
      if (!d) return res.status(404).json(NOT_SYNCED);
      return res.json(buildIntegrity(d));
    } catch (err) {
      console.error("GET /api/topics/integrity failed:", err);
      return res.status(500).json({ error: "Failed to run integrity checks" });
    }
  },
);

topicsRouter.get(
  "/api/topics/search",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const q = str(req.query.q);
    if (q.length < 2 || q.length > 80)
      return res
        .status(400)
        .json({ error: "Provide ?q= with 2 to 80 characters." });
    try {
      const d = await dossierFor(req);
      if (!d) return res.status(404).json(NOT_SYNCED);
      const graph = await getGraphForDeveloper(d.developerId);

      const hits = await findTopicsByText(graph, q, 20);
      let results = hits
        .filter((h) => d.bySlug.has(h.slug) || d.neighbors.has(h.slug))
        .map((h) => ({ ...refFor(d, h.slug), matchScore: round(h.score, 3) }));

      let engine = "falkordb full-text";
      if (results.length === 0) {
        const needle = q.toLowerCase();
        engine = "substring";
        results = [
          ...d.cards
            .filter((c) =>
              `${c.name} ${c.slug} ${c.domain}`.toLowerCase().includes(needle),
            )
            .map((c) => c.slug),
          ...[...d.neighbors.values()]
            .filter((n) =>
              `${n.name} ${n.slug} ${n.domain}`.toLowerCase().includes(needle),
            )
            .map((n) => n.slug),
        ]
          .slice(0, 20)
          .map((slug) => ({ ...refFor(d, slug), matchScore: 0 }));
      }
      return res.json({ query: q, engine, results });
    } catch (err) {
      console.error("GET /api/topics/search failed:", err);
      return res.status(500).json({ error: "Search failed" });
    }
  },
);

topicsRouter.get(
  "/api/topics/path",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const from = slugify(str(req.query.from));
    const to = slugify(str(req.query.to));
    if (!SLUG.test(from) || !SLUG.test(to))
      return res
        .status(400)
        .json({ error: "Provide ?from= and ?to= topic slugs." });
    try {
      const d = await dossierFor(req);
      if (!d) return res.status(404).json(NOT_SYNCED);
      const visible = (s: string) => d.bySlug.has(s) || d.neighbors.has(s);
      if (!visible(from) || !visible(to))
        return res
          .status(404)
          .json({ error: "Unknown topic for this developer." });

      const graph = await getGraphForDeveloper(d.developerId);
      const { slugs, hops: typedHops } = await readTopicPathDetailed(
        graph,
        from,
        to,
      );
      if (slugs.length === 0)
        return res
          .status(404)
          .json({ error: `No taxonomy path between "${from}" and "${to}".` });

      const names = await cypher(
        graph,
        "path names",
        `MATCH (t:Topic) WHERE t.slug IN $slugs RETURN t.slug AS slug, t.name AS name, coalesce(t.domain, "") AS domain`,
        { slugs },
      );
      const nameBy = new Map((names ?? []).map((r) => [str(r.slug), r]));
      const steps = slugs.map((slug, i) => {
        const known = refFor(d, slug);
        const row = nameBy.get(slug);
        return {
          step: i + 1,
          ...known,
          name: str(row?.name) || known.name,
          domain: str(row?.domain) || known.domain,
        };
      });
      const nameOf = (s: string) => steps.find((x) => x.slug === s)?.name ?? s;
      const segments = typedHops.map((h) => ({
        from: h.from,
        to: h.to,
        fromName: nameOf(h.from),
        toName: nameOf(h.to),
        type: h.type,
      }));
      return res.json({
        from,
        to,
        hops: slugs.length - 1,
        engine: "cypher shortestPath over BUILDS_ON|RELATED_TOPIC (max 6 hops)",
        steps,
        segments,
        sentence: steps.map((s) => s.name).join(" → "),
      });
    } catch (err) {
      console.error("GET /api/topics/path failed:", err);
      return res.status(500).json({ error: "Failed to compute path" });
    }
  },
);

// ---- analysis jobs (static paths first, before /:slug) ---------------------------

topicsRouter.post(
  "/api/topics/analyze",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const developerId = req.developer!.developerId;
    if (jobRunning(jobs.get(developerId)))
      return res.status(409).json({
        error: "An analysis is already running.",
        job: jobView(developerId, true),
      });

    let llm;
    try {
      llm = createDepthLlmFromEnv();
    } catch (err) {
      return res.status(501).json({
        error: "Depth analysis is not configured.",
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const graph = await getGraphForDeveloper(developerId);
      const maxTopics = clamp(Math.floor(num(req.body?.maxTopics, 16)), 1, 30);
      const job = launch(developerId, "full", null, async (onProgress) => {
        const r = await analyzeDeveloperDepth(graph, developerId, {
          llm,
          maxTopics,
          synthesize: req.body?.synthesize !== false,
          onProgress,
        });
        return {
          model: r.model,
          topicsDiscovered: r.topicsDiscovered,
          topicsAssessed: r.topicsAssessed,
          dropped: r.dropped,
          llmCalls: r.llmCalls,
          llmFailures: r.llmFailures,
          usedFallback: r.usedFallback,
          refinements: r.refinements,
          durationMs: r.durationMs,
          metrics: r.metrics,
          // why prerequisite links were or were not stored (shown in the UI)
          relations: {
            requested: r.diagnostics.storage?.relationsRequested ?? 0,
            persisted: r.diagnostics.storage?.relationsPersisted ?? 0,
            rejectedBeforeWrite: r.diagnostics.rejectedRelations.slice(0, 20),
            rejectedByDatabase: (
              r.diagnostics.storage?.rejectedRelations ?? []
            ).slice(0, 20),
          },
        };
      });
      return res.status(202).json({
        job: jobView(developerId, false) ?? { id: job.id },
        statusUrl: "/api/topics/analyze/status",
      });
    } catch (err) {
      console.error("POST /api/topics/analyze failed:", err);
      return res.status(500).json({ error: "Failed to start analysis" });
    }
  },
);

topicsRouter.get(
  "/api/topics/analyze/status",
  requireAuth,
  (req: AuthedRequest, res) => {
    const view = jobView(req.developer!.developerId, true);
    if (!view)
      return res.status(404).json({ error: "No analysis has been started." });
    return res.json(view);
  },
);

// ---- one topic -----------------------------------------------------------------

/** Loads everything one topic needs, once, so detail and trace always agree. */
async function loadTopic(d: Dossier, slug: string) {
  const card = d.bySlug.get(slug);
  if (!card) return { error: `No assessment for topic "${slug}".` } as const;
  const graph = await getGraphForDeveloper(d.developerId);
  const detail = await readTopicDepthDetail(graph, d.developerId, slug);
  if (!detail) return { error: `No assessment for topic "${slug}".` } as const;
  let ev: Row | null = null;
  try {
    ev = (await readTopicGraphEvidence(
      graph,
      d.developerId,
      slug,
    )) as unknown as Row | null;
  } catch (err) {
    console.error(
      `${LOG} graph evidence unavailable:`,
      err instanceof Error ? err.message : err,
    );
  }
  const row = detail as unknown as Row;
  const ctx = await proofContext(d, card, row, ev);
  const limitations = limitationsFor(card, row, ctx);
  const trace = buildTrace(d, card, row, ev, ctx, limitations);
  return { card, detail, row, ev, ctx, limitations, trace } as const;
}

topicsRouter.get(
  "/api/topics/:slug",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const slug = slugify(str(req.params.slug));
    if (!SLUG.test(slug))
      return res.status(400).json({ error: "Invalid topic slug." });
    try {
      const d = await dossierFor(req);
      if (!d) return res.status(404).json(NOT_SYNCED);
      const t = await loadTopic(d, slug);
      if ("error" in t) return res.status(404).json({ error: t.error });
      const { card, detail, ctx, limitations, trace } = t;

      const nextLevel = DEPTH_LEVELS[card.levelRank + 1] ?? null;
      const evidenceByKind: Record<string, typeof detail.evidence> = {
        code: [],
        demonstration: [],
        experience: [],
        commit: [],
      };
      for (const e of detail.evidence) (evidenceByKind[e.kind] ??= []).push(e);

      const clusterPeers =
        card.graph.clusterId == null
          ? []
          : d.cards
              .filter(
                (c) =>
                  c.slug !== slug && c.graph.clusterId === card.graph.clusterId,
              )
              .map(mini);

      const st = (detail.stats ?? {}) as Row;
      const comps = (st.baselineComponents ?? {}) as Record<string, number>;
      const lvl = (s: string) => {
        const c = d.bySlug.get(s);
        return { level: c?.level ?? null, assessed: Boolean(c) };
      };

      return res.json({
        topic: {
          ...card,
          confidence: ctx.confidence.effective,
          statedConfidence: card.confidence,
        },
        verdict: card.verdict,
        scoring: {
          score: card.score,
          baseline: card.baselineScore,
          level: card.level,
          band: DEPTH_BANDS[card.level],
        },
        confidence: ctx.confidence,
        graph: {
          metrics: {
            foundationRank: card.graph.foundationRank,
            bridgeScore: card.graph.bridgeScore,
            clusterId: card.graph.clusterId,
            componentId: card.graph.componentId,
          },
          foundations: (detail.context?.foundations ?? [])
            .filter((f) => f.hops === 1)
            .map((f) => ({
              slug: f.slug,
              name: f.name,
              reason: f.reason ?? "",
              level: f.developerLevel,
              assessed: f.developerLevel !== "none",
            })),
          unlocks: detail.unlocks.map((u) => ({
            slug: u.slug,
            name: u.name,
            reason: u.reason,
            ...lvl(u.slug),
          })),
          related: detail.related.map((r) => ({
            slug: r.slug,
            name: r.name,
            reason: r.reason,
            ...lvl(r.slug),
          })),
          community: { peers: clusterPeers },
        },
        approaches: detail.approaches,
        capabilityPaths: detail.capabilityPaths,
        prerequisitePaths: ctx.paths,
        evidence: { byKind: evidenceByKind },
        trace,
        depthProfile: {
          score: card.score,
          baseline: card.baselineScore,
          level: card.level,
          nextLevel,
          pointsToNextLevel: nextLevel
            ? Math.max(0, DEPTH_BANDS[nextLevel][0] - card.score)
            : 0,
          fallback: card.fallback,
          hasBreakdown: Object.keys(comps).length > 0,
          ladder: DEPTH_LEVELS.filter((l) => l !== "none").map((l) => ({
            id: l,
            label: LEVEL_META[l].label,
            min: DEPTH_BANDS[l][0],
            max: DEPTH_BANDS[l][1],
          })),
          components: BASELINE_COMPONENTS.map((c) => ({
            id: c.id,
            meaning: c.meaning,
            max: c.max,
            value: num(comps[c.id]),
          })),
          caps: asArray<string>(st.baselineCaps),
          evidenceKinds: st.evidenceKinds ?? null,
          timeline: asArray(st.timeline),
          hardening: asArray(st.hardening),
        },
      });
    } catch (err) {
      console.error("GET /api/topics/:slug failed:", err);
      return res.status(500).json({ error: "Failed to load topic" });
    }
  },
);

topicsRouter.get(
  "/api/topics/:slug/trace",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const slug = slugify(str(req.params.slug));
    if (!SLUG.test(slug))
      return res.status(400).json({ error: "Invalid topic slug." });
    try {
      const d = await dossierFor(req);
      if (!d) return res.status(404).json(NOT_SYNCED);
      const t = await loadTopic(d, slug);
      if ("error" in t) return res.status(404).json({ error: t.error });
      return res.json(t.trace);
    } catch (err) {
      console.error("GET /api/topics/:slug/trace failed:", err);
      return res.status(500).json({ error: "Failed to build reasoning trace" });
    }
  },
);

topicsRouter.post(
  "/api/topics/:slug/reanalyze",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const developerId = req.developer!.developerId;
    const slug = slugify(str(req.params.slug));
    if (!SLUG.test(slug))
      return res.status(400).json({ error: "Invalid topic slug." });
    if (jobRunning(jobs.get(developerId)))
      return res.status(409).json({
        error: "An analysis is already running.",
        job: jobView(developerId, true),
      });

    let llm;
    try {
      llm = createDepthLlmFromEnv();
    } catch (err) {
      return res.status(501).json({
        error: "Depth analysis is not configured.",
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const d = await getDossier(developerId, true);
      if (!d) return res.status(404).json(NOT_SYNCED);
      if (!d.bySlug.has(slug))
        return res
          .status(404)
          .json({ error: `No assessment for topic "${slug}".` });

      const graph = await getGraphForDeveloper(developerId);
      launch(developerId, "topic", slug, async (onProgress) => {
        const r = await reanalyzeTopicDepth(graph, developerId, slug, {
          llm,
          onProgress,
        });
        return {
          topic: slug,
          level: r.level,
          score: r.score,
          authenticity: r.authenticity,
          confidence: r.confidence,
          fallback: r.fallback,
        };
      });
      return res.status(202).json({
        job: jobView(developerId, false),
        statusUrl: "/api/topics/analyze/status",
      });
    } catch (err) {
      console.error("POST /api/topics/:slug/reanalyze failed:", err);
      return res.status(500).json({ error: "Failed to start re-analysis" });
    }
  },
);

// ---- evidence map: graph + assessment steps + plain-language story ---------------

topicsRouter.get(
  "/api/topics/:slug/graph",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const slug = slugify(str(req.params.slug));
    if (!SLUG.test(slug))
      return res.status(400).json({ error: "Invalid topic slug." });
    try {
      const d = await dossierFor(req);
      if (!d) return res.status(404).json(NOT_SYNCED);
      const payload = await buildGraphPayload(d, slug);
      if (!payload)
        return res
          .status(404)
          .json({ error: `No assessment for topic "${slug}".` });
      return res.json(payload);
    } catch (err) {
      console.error("GET /api/topics/:slug/graph failed:", err);
      return res.status(500).json({ error: "Failed to build graph evidence" });
    }
  },
);

// ---- reasoning: build/mission -> depth change -> graph walk -> next action ------
// Built only from data the graph already holds. When no BUILDS_ON edge exists the
// walk step says so and the next action is labelled a ranking, never a prerequisite.

topicsRouter.get(
  "/api/topics/:slug/reasoning",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const slug = slugify(str(req.params.slug));
    if (!SLUG.test(slug))
      return res.status(400).json({ error: "Invalid topic slug." });
    try {
      const d = await dossierFor(req);
      if (!d) return res.status(404).json(NOT_SYNCED);
      const card = d.bySlug.get(slug);
      if (!card)
        return res
          .status(404)
          .json({ error: `No assessment for topic "${slug}".` });

      const graph = await getGraphForDeveloper(d.developerId);
      const [ev, lg, frontier, detail] = await Promise.all([
        readTopicGraphEvidence(graph, d.developerId, slug),
        readTopicLearningGraph(graph, d.developerId, slug),
        readLearningFrontier(graph, d.developerId, { limit: 10 }),
        readTopicDepthDetail(graph, d.developerId, slug),
      ]);

      // 1. what just happened: the newest linked build or mission
      const builds = ev?.builds ?? [];
      const trigger = builds[0] ?? null;
      const buildTotals = ev?.buildTotals ?? { missions: 0, builds: 0 };
      const triggerKind = trigger?.kind === "mission" ? "Mission" : "Build";
      const triggerText = trigger
        ? `${triggerKind} “${trigger.title}”${trigger.repository ? ` in ${trigger.repository}` : ""}${trigger.createdAt ? ` (${trigger.createdAt.slice(0, 10)})` : ""}, linked to ${trigger.capability || "this topic"}.`
        : "No build or mission is linked to this topic in the graph yet.";

      // 2. what changed: a real diff of the last two stored snapshots
      const history = detail?.history ?? [];
      const after = history[0];
      const before = history[1];
      let change: {
        from: string;
        to: string;
        scoreDelta: number;
        since: string;
        until: string;
        linkedWork: number;
      } | null = null;
      if (after && before) {
        const from = Date.parse(before.assessedAt);
        const to = Date.parse(after.assessedAt);
        const linkedWork = builds.filter((b) => {
          const t = Date.parse(b.createdAt);
          return Number.isFinite(t) && t > from && t <= to;
        }).length;
        change = {
          from: before.level,
          to: after.level,
          scoreDelta: after.score - before.score,
          since: before.assessedAt,
          until: after.assessedAt,
          linkedWork,
        };
      }
      const changeText = change
        ? change.from !== change.to
          ? `Between the last two analyses depth moved from ${change.from} to ${change.to} (score ${change.scoreDelta >= 0 ? "+" : ""}${change.scoreDelta}); ${plural(change.linkedWork, "linked build or mission")} fall in that window.`
          : `Between the last two analyses depth stayed ${change.to} (score ${change.scoreDelta >= 0 ? "+" : ""}${change.scoreDelta}); ${plural(change.linkedWork, "linked build or mission")} fall in that window.`
        : "Only one analysis exists for this topic, so no change can be shown yet.";

      // 3. the walk: prerequisites if they exist, associations otherwise
      const prereqs = lg?.prerequisites ?? [];
      const related = lg?.related ?? [];
      const mode: "prerequisite" | "association_only" = prereqs.length
        ? "prerequisite"
        : "association_only";
      const metCount = prereqs.filter((p) => p.met).length;
      const missingCount = prereqs.length - metCount;
      const walkText =
        mode === "prerequisite"
          ? `Walked ${plural(prereqs.length, "prerequisite")} up to ${Math.max(0, ...prereqs.map((p) => p.hops))} step(s) down: ${metCount} met, ${missingCount} missing.`
          : related.length
            ? `0 prerequisite edges are recorded, so this step used associations only: ${joinList(
                related.map(
                  (r) => `${r.name} (${r.developer?.level ?? "not assessed"})`,
                ),
                4,
              )}. Associations are not prerequisites.`
            : "0 prerequisite edges and no related topics are recorded, so the graph had nothing to walk.";

      // 4. the next action, with its basis stated
      const unmet = lg?.readiness.learningOrder ?? [];
      let next: {
        slug: string;
        name: string;
        basis: "unmet_prerequisite" | "ranking";
        basisText: string;
        why: string;
      } | null = null;
      if (mode === "prerequisite" && unmet.length) {
        const target = prereqs.find((p) => p.slug === unmet[0]);
        next = {
          slug: unmet[0],
          name: target?.name ?? unmet[0],
          basis: "unmet_prerequisite",
          basisText: "A required prerequisite is not shown at working depth.",
          why: `${target?.name ?? unmet[0]} is a required foundation of ${card.name}${target?.edge.reason ? `: ${target.edge.reason}` : "."}`,
        };
      } else {
        const pick =
          frontier.find((f) => f.ready && f.topic.slug !== slug) ??
          frontier.find((f) => f.topic.slug !== slug);
        if (pick)
          next = {
            slug: pick.topic.slug,
            name: pick.topic.name,
            basis: "ranking",
            basisText:
              mode === "prerequisite"
                ? "All prerequisites are met, so the next topic is ranked by PageRank and how many topics it unlocks."
                : "No prerequisite edges exist. This is a ranking by PageRank and topics unlocked, not a prerequisite chain.",
            why: pick.why,
          };
      }
      const nextText = next
        ? `Next: ${next.name}. ${next.basisText}`
        : "No next topic could be ranked from the graph.";

      return res.json({
        slug,
        topic: card.name,
        mode,
        graphPrerequisiteEdges: d.taxonomy.buildsOn,
        steps: [
          { id: "trigger", title: "Build or mission", text: triggerText },
          { id: "change", title: "Depth change", text: changeText },
          { id: "walk", title: "Graph walk", text: walkText },
          { id: "next", title: "Next action", text: nextText },
        ],
        trigger,
        linked: {
          builds: buildTotals.builds,
          missions: buildTotals.missions,
        },
        change,
        walked: prereqs.map((p) => ({
          slug: p.slug,
          topic: p.name,
          hops: p.hops,
          met: p.met,
          required: p.edge.strength === "required",
          level: p.developer?.level ?? "not assessed",
          reason: p.edge.reason,
        })),
        related: related.map((r) => ({
          slug: r.slug,
          topic: r.name,
          level: r.developer?.level ?? "not assessed",
        })),
        evidence: (lg?.capabilityPaths ?? []).map((c) => ({
          capability: c.capability,
          demonstrations: c.demonstrations,
        })),
        next,
      });
    } catch (err) {
      console.error("GET /api/topics/:slug/reasoning failed:", err);
      return res.status(500).json({ error: "Failed to build reasoning" });
    }
  },
);

// ---- evolution: real DepthSnapshot history, diffed. Never invents a change. ------

topicsRouter.get(
  "/api/topics/:slug/evolution",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const slug = slugify(str(req.params.slug));
    if (!SLUG.test(slug))
      return res.status(400).json({ error: "Invalid topic slug." });
    try {
      const d = await dossierFor(req);
      if (!d) return res.status(404).json(NOT_SYNCED);
      if (!d.bySlug.has(slug))
        return res
          .status(404)
          .json({ error: `No assessment for topic "${slug}".` });

      const graph = await getGraphForDeveloper(d.developerId);
      const [detail, ev, buildEdges, relatedEdges] = await Promise.all([
        readTopicDepthDetail(graph, d.developerId, slug),
        readTopicGraphEvidence(graph, d.developerId, slug),
        readTaxonomyEdges(graph, "BUILDS_ON"),
        readTaxonomyEdges(graph, "RELATED_TOPIC"),
      ]);
      if (!detail) return res.status(404).json({ error: "No assessment." });

      const snaps = [...detail.history].reverse();
      const touching = [...buildEdges, ...relatedEdges].filter(
        (e) => e.from === slug || e.to === slug,
      );
      const builds = asRows((ev as unknown as Row | null)?.builds);
      const nameOf = (s: string) => refFor(d, s).name;

      const steps = snaps.map((s, i) => {
        const prev = i > 0 ? snaps[i - 1] : null;
        const from = prev ? Date.parse(prev.assessedAt) : 0;
        const to = Date.parse(s.assessedAt);
        const contributions = builds
          .filter((b) => {
            const t = Date.parse(str(b.createdAt));
            return Number.isFinite(t) && t > from && t <= to;
          })
          .map((b) => ({
            id: str(b.id),
            title: str(b.title),
            kind: str(b.kind),
            repository: str(b.repository),
            permalink: str(b.permalink),
            createdAt: str(b.createdAt),
          }));
        const relations = touching
          .filter((e) => e.buildId === s.buildId)
          .map((e) => ({
            type: e.type,
            from: nameOf(e.from),
            to: nameOf(e.to),
            reason: e.reason,
          }));
        const levelChanged = !!prev && prev.level !== s.level;
        const confChanged = !!prev && prev.confidence !== s.confidence;
        const filesDelta = prev ? s.files - prev.files : 0;
        const commitsDelta = prev ? s.commits - prev.commits : 0;

        let reason: string;
        if (!prev) {
          reason =
            "First assessment: there is no earlier snapshot to compare against.";
        } else if (levelChanged || confChanged) {
          const parts: string[] = [];
          if (levelChanged) parts.push(`depth ${prev.level} → ${s.level}`);
          if (confChanged)
            parts.push(`confidence ${prev.confidence} → ${s.confidence}`);
          reason = `${parts.join(", ")}, with ${filesDelta >= 0 ? "+" : ""}${filesDelta} files and ${commitsDelta >= 0 ? "+" : ""}${commitsDelta} commits since the previous snapshot. The new level was judged from cited evidence and checked by guard-rails.`;
        } else if (filesDelta > 0 || commitsDelta > 0) {
          reason = `Evidence grew (+${filesDelta} files, +${commitsDelta} commits) but depth and confidence held. Depth follows the kind of evidence, not its volume.`;
        } else {
          reason = "No change in depth, confidence or evidence.";
        }

        return {
          buildId: s.buildId,
          assessedAt: s.assessedAt,
          level: s.level,
          score: s.score,
          confidence: s.confidence,
          evidenceBand: s.evidenceBand,
          files: s.files,
          commits: s.commits,
          approachCount: s.approachCount,
          scoreDelta: prev ? s.score - prev.score : 0,
          filesDelta,
          commitsDelta,
          levelChanged,
          confidenceChanged: confChanged,
          contributions,
          relations,
          reason,
        };
      });

      return res.json({ slug, evolved: steps.length >= 2, steps });
    } catch (err) {
      console.error("GET /api/topics/:slug/evolution failed:", err);
      return res.status(500).json({ error: "Failed to load evolution" });
    }
  },
);

/**
 * The agent: rewrites the graph facts as a plain-English explanation.
 * Facts are rebuilt on the server. Proof classes, citations, prerequisite paths
 * and confidence are always the server's deterministic values; the model only
 * supplies wording. Any number it writes that is not in the facts rejects the
 * whole output and the deterministic story is used instead.
 */
topicsRouter.post(
  "/api/topics/:slug/explain",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const slug = slugify(str(req.params.slug));
    if (!SLUG.test(slug))
      return res.status(400).json({ error: "Invalid topic slug." });
    try {
      const d = await dossierFor(req);
      if (!d) return res.status(404).json(NOT_SYNCED);
      const payload = await buildGraphPayload(d, slug);
      if (!payload)
        return res
          .status(404)
          .json({ error: `No assessment for topic "${slug}".` });

      const facts = payload.plain.facts;
      const base: PlainStory = payload.plain.story;
      let story: PlainStory = base;
      let source: "llm" | "graph" = "graph";
      let grounding: { checked: boolean; rejectedNumbers: string[] } = {
        checked: false,
        rejectedNumbers: [],
      };
      try {
        const llm = createDepthLlmFromEnv();
        const cacheKey = `${d.developerId}:${slug}:${cardScore(d, slug)}:${base.confidence.effective}:${JSON.stringify(facts).length}`;
        const out = await explainTopicEvidence(llm, facts, cacheKey);
        if (out) {
          const bad = ungroundedNumbers(facts, [
            out.headline,
            out.summary,
            out.meaning,
            out.caveat,
            out.prerequisiteSummary,
            out.confidenceNote,
            ...out.steps.map((s) => s.text),
            ...out.items.flatMap((i) => [i.demonstrates, i.matters]),
          ]);
          grounding = { checked: true, rejectedNumbers: bad };
          if (bad.length === 0) {
            story = {
              ...base,
              headline: out.headline,
              summary: out.summary,
              steps: out.steps,
              meaning: out.meaning,
              caveat: out.caveat || base.caveat,
              followups: out.followups.length ? out.followups : base.followups,
              prerequisiteSummary:
                out.prerequisiteSummary || base.prerequisiteSummary,
              confidenceNote: out.confidenceNote || base.confidenceNote,
              proof: base.proof.map((item) => {
                if (item.class !== "observed") return item;
                const w = out.items.find((x) => x.id === item.id);
                return w
                  ? {
                      ...item,
                      demonstrates: w.demonstrates || item.demonstrates,
                      matters: w.matters || item.matters,
                    }
                  : item;
              }),
            };
            source = "llm";
          }
        }
      } catch (err) {
        console.error("explain: model unavailable, using graph story:", err);
      }
      return res.json({ story, source, grounding });
    } catch (err) {
      console.error("POST /api/topics/:slug/explain failed:", err);
      return res.status(500).json({ error: "Failed to explain topic" });
    }
  },
);

export default topicsRouter;
