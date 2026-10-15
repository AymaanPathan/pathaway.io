import { Router } from "express";
import type { Graph } from "../db/falkordb.js";
import { getGraphForDeveloper } from "../db/falkordb.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import {
  analyzeDeveloperDepth,
  createDepthLlmFromEnv,
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
  readTopicDepthDetail,
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
// Proficiency scores are descriptive assessment fields only. Topic ordering
// defaults must come from FalkorDB graph algorithms/traversals.
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

const ALGORITHMS = [
  {
    id: "pagerank",
    name: "PageRank",
    engine: "falkordb",
    call: "CALL algo.pageRank('Topic', 'BUILDS_ON')",
    scope: "Shared Topic taxonomy (no developer data)",
    relationships: ["BUILDS_ON"],
    writesProperty: "Topic.foundation_rank",
    fallback:
      "None. If it fails the score stays empty; no proxy ranking is used.",
    why: "BUILDS_ON edges point from an advanced topic to the foundation it needs. Rank therefore flows toward foundations, so a high score means many topics (directly or transitively) stand on this one. It describes graph structure; it does not prove the developer has the skill.",
    howToRead:
      "High = a structurally central foundation (for example data modeling). Low = a leaf or specialised topic. When no BUILDS_ON edge exists the rank is computed over RELATED_TOPIC instead and does not mean 'foundation'.",
    frontendUse: [
      "Badge topics as 'foundation'",
      "Order topics from foundations upward",
      "Weight foundation gaps",
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
    fallback: "None. If it fails the score stays empty.",
    why: "Counts how often a topic sits on the shortest path between two others. Topics that connect otherwise separate areas score high, which marks knowledge that transfers across domains. It is a structural measure, not evidence of expertise.",
    howToRead:
      "High = a bridge topic (for example real-time sync linking frontend state and backend events). Zero = sits inside one area.",
    frontendUse: [
      "Badge topics as 'bridge'",
      "Highlight transferable skills",
      "Size nodes in the graph view",
    ],
  },
  {
    id: "label_propagation",
    name: "Label propagation (community detection)",
    engine: "falkordb",
    call: "CALL algo.labelPropagation({nodeLabels: ['Topic'], relationshipTypes: ['RELATED_TOPIC'], maxIterations: 10})",
    scope: "Shared Topic taxonomy (no developer data)",
    relationships: ["RELATED_TOPIC"],
    writesProperty: "Topic.cluster_id",
    fallback: "None. If it fails topics stay unclustered.",
    why: "Finds groups of tightly related sibling topics without choosing the number of groups in advance. Gives data-driven groups that cut across the LLM's domain labels.",
    howToRead:
      "Topics sharing a cluster_id belong to the same knowledge community. The cluster id is a number; this API labels each cluster after its strongest assessed topic.",
    frontendUse: [
      "Colour or hull nodes by community",
      "Show 'knowledge areas' cards",
      "Find cross-domain communities",
    ],
  },
  {
    id: "wcc",
    name: "Weakly connected components",
    engine: "falkordb",
    call: "CALL algo.WCC({nodeLabels: ['Topic'], relationshipTypes: ['BUILDS_ON', 'RELATED_TOPIC']})",
    scope: "Shared Topic taxonomy (no developer data)",
    relationships: ["BUILDS_ON", "RELATED_TOPIC"],
    writesProperty: "Topic.component_id",
    fallback: "None. If it fails components stay empty.",
    why: "Splits the taxonomy into islands that have no path between them. Separates the main body of knowledge from isolated topics and doubles as a data-quality check on the taxonomy.",
    howToRead:
      "The largest component is the main knowledge graph. Small components are isolated topics with no known relation to anything else.",
    frontendUse: [
      "Flag isolated topics",
      "Decide which topics can be drawn in one connected layout",
    ],
  },
  {
    id: "shortest_path",
    name: "Shortest path",
    engine: "cypher",
    call: "shortestPath((a)-[:BUILDS_ON|RELATED_TOPIC*1..6]->(b))",
    scope: "Native Cypher over the Topic taxonomy",
    relationships: ["BUILDS_ON", "RELATED_TOPIC"],
    writesProperty: null,
    fallback: "Tries the reverse direction when the forward path is empty",
    why: "Explains how two topics connect through real relationships. Every hop reports whether it is a foundation dependency or an association.",
    howToRead:
      "An ordered list of topics from the first to the second, each hop labelled BUILDS_ON or RELATED_TOPIC. A path shows connection, not skill.",
    frontendUse: ["Path highlighter between two selected nodes"],
  },
  {
    id: "foundation_traversal",
    name: "Variable-length traversal",
    engine: "cypher",
    call: "(t:Topic)-[:BUILDS_ON*1..3]->(f:Topic)",
    scope: "Native Cypher, joined to this developer's assessments",
    relationships: ["BUILDS_ON"],
    writesProperty: null,
    fallback: null,
    why: "Finds the foundations (up to 3 hops) of a topic and what this developer has shown for each, so a deep topic on a weak foundation can be flagged.",
    howToRead:
      "Each foundation lists hop distance and the developer's level in it.",
    frontendUse: ["Foundation tree on the topic detail page"],
  },
  {
    id: "fulltext",
    name: "Full-text index",
    engine: "index",
    call: "CALL db.idx.fulltext.queryNodes('Topic', $q)",
    scope: "Topic.name, Topic.description, Topic.aliases_text",
    relationships: [],
    writesProperty: null,
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
    fallback: null,
    why: "Runs inside the analyzer, not in FalkorDB. Groups packages and code signals that are used together so the LLM can propose topics and approaches grounded in real usage.",
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
    does: "The model judges level, authenticity and how each approach was implemented, citing evidence refs. It may request one extra evidence round via full-text probes.",
  },
  {
    step: 5,
    id: "reconcile",
    engine: "deterministic",
    title: "Guard-rails",
    does: "The graph baseline and authenticity caps keep the model honest. Every adjustment is written into the rationale.",
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
  "Genuine implementation is downgraded to working usage when there are no own definitions, no built mechanism and fewer than 3 files.",
  "When 70% or more of the evidence sits in scaffold-like commits the topic is marked boilerplate.",
  "Confidence follows the amount of evidence: fewer than 3 files or fewer than 2 commits is always low.",
  "The score is clamped into the band of its level, and an approach can never be deeper than its topic.",
  "The baseline is reduced when evidence is mostly scaffold (x0.6), when one commit (cap 25) or one file (cap 20) touches the topic.",
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
  { method: "GET", path: "/api/topics/search?q=", purpose: "Search" },
  {
    method: "GET",
    path: "/api/topics/path?from=&to=",
    purpose: "Shortest path with typed hops",
  },
  { method: "GET", path: "/api/topics/:slug", purpose: "Topic detail" },
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
    },
    {
      type: "OF_TOPIC",
      pattern: "(DepthAssessment)-[:OF_TOPIC]->(Topic)",
      private: true,
    },
    {
      type: "USES_APPROACH",
      pattern: "(DepthAssessment)-[:USES_APPROACH]->(Approach)",
      private: true,
    },
    {
      type: "BACKED_BY",
      pattern:
        "(DepthAssessment)-[:BACKED_BY]->(FileChange|Demonstration|Experience|Commit)",
      private: true,
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
      meaning: "advanced topic -> its foundation",
    },
    {
      type: "RELATED_TOPIC",
      pattern: "(Topic)-[:RELATED_TOPIC]<->(Topic)",
      private: false,
      meaning: "sibling topics, stored in both directions",
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
      "A deterministic baseline is computed from graph counts. The LLM judges level and authenticity from cited evidence. Guard-rails reconcile the two.",
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

  const [profile, metaRows, globalRows, buildsRows, relatedRows, analysisRows] =
    await Promise.all([
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
    ]);

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
  const bySlug = new Map(cards.map((c) => [c.slug, c]));

  // ---- relations touching this developer's topics ----
  const edges: EdgeRow[] = [];
  const neighbors = new Map<string, NodeRef>();
  if (cards.length) {
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
        { slugs: cards.map((c) => c.slug) },
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
      edges.push({
        id: `${type}:${a.slug}>${b.slug}`,
        source: a.slug,
        target: b.slug,
        type,
        reason: str(r.reason),
        basis: str(r.basis),
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
    cards,
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

function makeGroup(
  key: string,
  label: string,
  cards: TopicCard[],
  extra: Row = {},
) {
  const sorted = [...cards].sort(
    (a, b) =>
      (b.graph.foundationRank ?? -1) - (a.graph.foundationRank ?? -1) ||
      (b.graph.bridgeScore ?? -1) - (a.graph.bridgeScore ?? -1) ||
      a.name.localeCompare(b.name),
  );
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

  // domain: labelled by the discovery model
  const domains = [...groupBy(cards, (c) => c.domain).entries()]
    .map(([key, list]) => makeGroup(key, humanize(key), list))
    .sort((a, b) => a.label.localeCompare(b.label));

  // community: label propagation over RELATED_TOPIC
  const byCluster = groupBy(cards, (c) =>
    c.graph.clusterId == null ? null : String(c.graph.clusterId),
  );
  const clusters = [...byCluster.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([key, list]) => {
      const anchor = [...list].sort(
        (a, b) =>
          (b.graph.foundationRank ?? -1) - (a.graph.foundationRank ?? -1) ||
          (b.graph.bridgeScore ?? -1) - (a.graph.bridgeScore ?? -1) ||
          a.name.localeCompare(b.name),
      )[0] as TopicCard;
      const slugs = new Set(list.map((c) => c.slug));
      const domainSet = uniq(list.map((c) => c.domainLabel));
      return makeGroup(key, `Around ${anchor.name}`, list, {
        clusterId: Number(key),
        anchor: { slug: anchor.slug, name: anchor.name },
        domains: domainSet,
        crossDomain: domainSet.length > 1,
        internalLinks: related.filter(
          (e) => slugs.has(e.source) && slugs.has(e.target),
        ).length,
      });
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const clusteredSlugs = new Set(
    clusters.flatMap((c) => c.topics.map((t) => t.slug)),
  );
  const unclustered = cards
    .filter((c) => !clusteredSlugs.has(c.slug))
    .map(mini);

  // component: weakly connected components over both relation types
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
        {
          meaning: AUTHENTICITY_META[id].meaning,
        },
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
        why: "Groups tightly related topics without choosing the group count in advance. Often cuts across domains and shows what is worked on together.",
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
  const builds = d.edges.filter((e) => e.type === "BUILDS_ON");
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

  // a strong topic standing on a weak or unverified foundation
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

  // topics that build on what the developer already knows, but are not assessed
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
      related: related.length,
      assessedTopics: d.cards.length,
      externalTopics: d.neighbors.size,
    },
    explain: {
      BUILDS_ON:
        "Directed. 'A builds on B' means B is a foundation of A. Drawn from advanced to foundation.",
      RELATED_TOPIC:
        "Undirected siblings. Stored in both directions, returned once. An association, not a prerequisite.",
      basis:
        "Relations are inferred by the discovery model (basis: llm_inferred) and shared across developers.",
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
    d.edges.filter((e) => e.type === "BUILDS_ON" && e.target === slug).length;

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
    note: "FalkorDB algorithms run only over the shared Topic taxonomy, which carries no developer data. This API overlays the results on the signed-in developer's topics. Only results that were actually computed are shown; centrality describes graph structure and does not prove expertise.",
    algorithms: ALGORITHMS.map((a) => ({
      ...a,
      status: covered[a.id] == null ? null : status(covered[a.id] as number),
      findings: findings[a.id] ?? null,
    })),
  };
}

// ---- overview list filtering ---------------------------------------------

const SORTS: Record<string, (a: TopicCard, b: TopicCard) => number> = {
  // Ranking modes are backed by persisted FalkorDB graph-algorithm output.
  // "name" and "recent" are display-order utilities, not ranks.
  foundation: (a, b) =>
    (b.graph.foundationRank ?? -1) - (a.graph.foundationRank ?? -1) ||
    (b.graph.bridgeScore ?? -1) - (a.graph.bridgeScore ?? -1) ||
    a.name.localeCompare(b.name),
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

  // Default ordering is FalkorDB PageRank (foundation_rank), with
  // FalkorDB betweenness as the deterministic graph-only tie-breaker.
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
  return {
    total: list.length,
    returned: list.slice(offset, offset + limit).length,
    limit,
    offset,
    items: list.slice(offset, offset + limit),
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
  const sortedByGraph = [...cards].sort(
    (a, b) =>
      (b.graph.foundationRank ?? -1) - (a.graph.foundationRank ?? -1) ||
      (b.graph.bridgeScore ?? -1) - (a.graph.bridgeScore ?? -1) ||
      a.name.localeCompare(b.name),
  );

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
        why: a.why,
      }),
    ),
    levels: TOPICS_MODEL.levels,
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
  if (stage === "depth_files_scanned") return; // too chatty for the event log
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

      // full-text runs over the shared taxonomy: keep only topics visible to this developer
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
      // every hop says whether it is a foundation dependency or an association
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
      const card = d.bySlug.get(slug);
      if (!card)
        return res
          .status(404)
          .json({ error: `No assessment for topic "${slug}".` });

      const graph = await getGraphForDeveloper(d.developerId);
      const detail = await readTopicDepthDetail(graph, d.developerId, slug);
      if (!detail)
        return res
          .status(404)
          .json({ error: `No assessment for topic "${slug}".` });

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

      // What is NOT established, built only from stored fields. Never invented.
      const limitations: string[] = [...detail.gaps];
      if (card.confidence === "low")
        limitations.push(
          "Confidence is low: little evidence sits behind this level.",
        );
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
      if (
        detail.capabilityPaths.length > 0 &&
        detail.capabilityPaths.every((p) => p.demonstrations === 0)
      )
        limitations.push(
          "Mapped capabilities have no demonstrations for this developer; a mapping is taxonomy, not proof.",
        );
      for (const p of detail.learning?.prerequisites ?? []) {
        if (p.hops === 1 && p.edge.strength === "required" && !p.met)
          limitations.push(
            `Required foundation ${p.name} is not shown at working depth.`,
          );
      }

      return res.json({
        topic: card,
        verdict: detail.summary.verdict,
        rationale: detail.rationale,
        strengths: detail.strengths,
        gaps: detail.gaps,
        limitations: uniq(limitations).slice(0, 8),
        implementations: detail.implementations,
        safeguards: detail.safeguards,
        capabilityPaths: detail.capabilityPaths,
        approaches: [...detail.approaches].sort(
          (a, b) =>
            Number(b.isPrimary) - Number(a.isPrimary) ||
            DEPTH_RANK[b.depth] - DEPTH_RANK[a.depth],
        ),
        evidence: { total: detail.evidence.length, byKind: evidenceByKind },
        stats: detail.stats,
        scoring: {
          level: card.level,
          score: card.score,
          band: DEPTH_BANDS[card.level],
          nextLevel,
          pointsToNextLevel: nextLevel
            ? Math.max(0, DEPTH_BANDS[nextLevel][0] - card.score)
            : 0,
          baseline: { score: card.baselineScore, level: detail.baselineLevel },
          adjustment: card.scoreDelta,
          decidedBy: card.fallback
            ? "graph baseline only (no model judgement)"
            : "model judgement checked by guard-rails",
        },
        graph: {
          metrics: card.graph,
          context: detail.context,
          foundations: detail.context?.foundations ?? [],
          unlocks: detail.unlocks,
          related: detail.related,
          community:
            card.graph.clusterId == null
              ? null
              : { clusterId: card.graph.clusterId, peers: clusterPeers },
          explain: {
            foundationRank:
              "PageRank over BUILDS_ON: how many topics build on this one. Structural, not proof of skill.",
            bridgeScore:
              "Betweenness: how much this topic connects separate areas. Structural, not proof of skill.",
            clusterId:
              "Label propagation over RELATED_TOPIC: which community it belongs to.",
          },
        },
      });
    } catch (err) {
      console.error("GET /api/topics/:slug failed:", err);
      return res.status(500).json({ error: "Failed to load topic" });
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

export default topicsRouter;
