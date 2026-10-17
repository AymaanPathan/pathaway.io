import type { Graph } from "../db/falkordb.js";

type Row = Record<string, any>;

const LOG_PREFIX = "[goal-graph]";
function log(message: string, detail?: Row): void {
  if (detail !== undefined) console.log(`${LOG_PREFIX} ${message}`, detail);
  else console.log(`${LOG_PREFIX} ${message}`);
}

// ------------------------------------------------------------
// small helpers
// ------------------------------------------------------------

const str = (v: unknown, fallback = ""): string =>
  v == null || typeof v === "object" ? fallback : String(v).trim();
const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const numOrNull = (v: unknown): number | null =>
  v == null || !Number.isFinite(Number(v)) ? null : Number(v);
const round = (v: number, digits = 2): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
const uniq = <T>(items: T[]): T[] => [...new Set(items)];
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const slugify = (v: string): string =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

function parseList(v: unknown): string[] {
  try {
    const parsed = JSON.parse(str(v) || "[]");
    return Array.isArray(parsed)
      ? parsed.map((x) => str(x)).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function parseObjects(v: unknown): Row[] {
  try {
    const parsed = JSON.parse(str(v) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((x) => x && typeof x === "object" && !Array.isArray(x))
      : [];
  } catch {
    return [];
  }
}

async function query(
  graph: Graph,
  label: string,
  cypher: string,
  params: Row = {},
): Promise<Row[] | null> {
  try {
    const result = await graph.query(cypher, { params });
    return (result.data ?? []) as Row[];
  } catch (error) {
    log(`${label} failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** One write query over batch rows; returns how many rows matched. */
async function writeBatch(
  graph: Graph,
  label: string,
  cypher: string,
  batch: Row[],
  params: Row = {},
): Promise<number> {
  if (!batch.length) return 0;
  const rows = await query(graph, label, cypher, { ...params, batch });
  return num(rows?.[0]?.n);
}

// ------------------------------------------------------------
// types
// ------------------------------------------------------------

export type DepthLevel = "none" | "surface" | "working" | "proficient" | "deep";
export const LEVELS: DepthLevel[] = [
  "none",
  "surface",
  "working",
  "proficient",
  "deep",
];
export const levelRank = (l: DepthLevel): number => LEVELS.indexOf(l);
/** Depth at which a topic counts as something the developer can stand on. */
export const READY_RANK = 2;
const asLevel = (v: unknown): DepthLevel => {
  const s = str(v).toLowerCase();
  return (LEVELS as string[]).includes(s) ? (s as DepthLevel) : "none";
};

export interface GraphOperation {
  id: string;
  kind: "fulltext" | "cypher" | "personalized_pagerank" | "rules";
  purpose: string;
  status: "ok" | "empty" | "failed";
  /** what it actually returned for this request */
  result: string;
  durationMs: number;
}

export interface Approach {
  /** stable id the goal agent copies into decision.approachSlug */
  slug: string;
  name: string;
  isPrimary: boolean;
  depth: DepthLevel;
  /** assessor's authenticity verdict for this approach (empty when not stored) */
  authenticity: string;
  howImplemented: string;
}

export interface DeveloperDepth {
  assessed: boolean;
  level: DepthLevel;
  score: number | null;
  confidence: string;
  authenticity: string;
  verdict: string;
  strengths: string[];
  gaps: string[];
  files: number;
  commits: number;
  repos: number;
  lastSeen: string;
  approaches: Approach[];
  /** hardening behaviours observed in the developer's code (limits, cleanup, validation...) */
  safeguards: string[];
  /** concrete things the assessment says the developer built */
  built: Array<{ what: string; path: string }>;
  /** the assessor's reasoning for the level */
  rationale: string;
}

export type TopicRole = "seed" | "related" | "cluster";

export interface GraphTopic {
  slug: string;
  name: string;
  domain: string;
  description: string;
  role: TopicRole;
  /** hops from the nearest seed (0 for seeds) */
  hops: number;
  foundationRank: number | null;
  clusterId: number | null;
  /** Personalized PageRank score of this topic, 0..1 relative to the best topic */
  relevance: number;
  depth: DeveloperDepth;
}

export interface TopicLink {
  a: string;
  b: string;
  type: "RELATED_TOPIC" | "SAME_CLUSTER";
  reason: string;
  weight: number;
}

/** A capability mapped to a topic, and how many demonstrations THIS developer has for it. */
export interface CapabilityCoverage {
  topicSlug: string;
  capabilityId: string;
  capability: string;
  weight: number;
  demonstrations: number;
}

export interface EvidenceItem {
  /** stable id the agent cites, e.g. "E3" */
  id: string;
  topicSlug: string;
  capabilityId: string;
  capability: string;
  demonstrationId: string;
  technique: string;
  summary: string;
  depth: string;
  repository: string;
  path: string;
  commitSha: string;
  commitSubject: string;
  permalink: string;
  fileChangeId: string;
  /** hardening behaviours the detector saw on this demonstration */
  hardening: string[];
  isTest: boolean;
  /** lowercase words (package names, keywords) used to find the relevant lines in the code */
  hints: string[];
}

/** Real code behind one piece of evidence, so the agent reads what was actually built. */
export interface CodeContext {
  evidenceId: string;
  path: string;
  excerpt: string;
}

/** A mission this developer already completed and had verified. The agent must not repeat it. */
export interface CompletedMove {
  title: string;
  /** focus topic of the mission, when the stored mission records one */
  topicSlug: string;
  verifiedAt: string;
}

export type ContextKind =
  | "topic"
  | "assessment"
  | "capability"
  | "demonstration"
  | "file"
  | "repository";

export interface ContextNode {
  key: string;
  kind: ContextKind;
  label: string;
  /** Personalized PageRank score (sums to 1 over all nodes) */
  score: number;
}
export interface ContextEdge {
  from: string;
  to: string;
  type: string;
  weight: number;
}

export interface Signal {
  slug: string;
  name: string;
  domain: string;
  level: DepthLevel;
  relevance: number;
  /** plain-words facts from the graph */
  reasons: string[];
  /** evidence ids (E1...) that belong to this topic */
  evidenceIds: string[];
  /** strengths this topic is directly related to */
  nearStrengths: string[];
  /** capabilities mapped to the topic with zero demonstrations */
  missingCapabilities: string[];
}

export type ResolutionMethod =
  | "agent_topics"
  | "exact_name"
  | "domain"
  | "full_text"
  | "none";

export interface Resolution {
  method: ResolutionMethod;
  confidence: "high" | "medium" | "none";
  needsClarification: boolean;
  tokens: string[];
  seeds: Array<{ slug: string; name: string; domain: string }>;
}

export interface GoalGraphResult {
  developerId: string;
  wish: string;
  resolution: Resolution;
  topics: GraphTopic[];
  links: TopicLink[];
  coverage: CapabilityCoverage[];
  evidence: EvidenceItem[];
  /** the retrieved subgraph, for the UI */
  context: { nodes: ContextNode[]; edges: ContextEdge[] };
  /** top nodes by Personalized PageRank (context order, not a decision) */
  ranking: ContextNode[];
  signals: {
    strengths: Signal[];
    unproven: Signal[];
    opportunities: Signal[];
  };
  operations: GraphOperation[];
  /** code excerpts for the strongest evidence (the only code the agent may quote) */
  code: CodeContext[];
  /** the NextMove currently stored for this goal, so the agent does not repeat it */
  previousMove: { title: string; doneWhen: string } | null;
  /** missions already verified on the topics in this neighbourhood, so the agent does not repeat them */
  completedMoves: CompletedMove[];
  clarification: {
    reason: string;
    suggestions: Array<{ slug: string; name: string; domain: string }>;
  } | null;
  truncated: boolean;
}

export interface GoalGraphInput {
  developerId: string;
  /** what the developer typed */
  wish: string;
  /** topics the goal agent extracted (slugs or names). Checked against the graph. */
  goalTopics?: string[];
}

// ------------------------------------------------------------
// wording -> tokens
// ------------------------------------------------------------

const STOPWORDS = new Set(
  (
    "i me my we our you your the a an and or of to in on for with at by from as is are be " +
    "want wanna need like would will can could should get got make build building built " +
    "learn improve improving better more much very about into some any how skill skills " +
    "engineering engineer developer development software code coding level good great " +
    "become deeper deep advanced understand using use work working goal next that this " +
    "it do doing myself stronger master focus focusing grow growth deepen " +
    "strengthen topic topics area areas around particular"
  ).split(" "),
);

export function wishTokens(wish: string): string[] {
  return uniq(
    (wish.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []).filter(
      (t) => !STOPWORDS.has(t),
    ),
  ).slice(0, 10);
}

/** contiguous 1-3 word phrases, as names ("rate limiting") and slugs ("rate_limiting"). */
function phraseVariants(text: string): { names: string[]; slugs: string[] } {
  const words = (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (w) => !STOPWORDS.has(w),
  );
  const names: string[] = [];
  for (let n = 1; n <= 3; n++)
    for (let i = 0; i + n <= words.length; i++)
      names.push(words.slice(i, i + n).join(" "));
  const slugs = names.flatMap((p) => [
    p.replace(/ /g, "_"),
    p.replace(/ /g, "-"),
  ]);
  return { names: uniq(names), slugs: uniq(slugs) };
}

function tokenCoverage(tokens: string[], text: string): number {
  if (!tokens.length) return 0;
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const covered = tokens.filter((t) =>
    words.some((w) => w.startsWith(t) || (w.length >= 4 && t.startsWith(w))),
  );
  return covered.length / tokens.length;
}

// ------------------------------------------------------------
// 1. START: seeds that really exist in the graph
// ------------------------------------------------------------

interface SeedRow {
  slug: string;
  name: string;
  domain: string;
}
const seedFrom = (r: Row): SeedRow => ({
  slug: str(r.slug),
  name: str(r.name),
  domain: str(r.domain),
});

async function resolveSeeds(
  graph: Graph,
  input: GoalGraphInput,
  ops: GraphOperation[],
): Promise<Resolution> {
  const tokens = wishTokens(input.wish);
  const none: Resolution = {
    method: "none",
    confidence: "none",
    needsClarification: true,
    tokens,
    seeds: [],
  };

  // a) topics named by the goal agent: accepted only if they exist
  const named = uniq(
    (input.goalTopics ?? []).map((t) => t.trim()).filter(Boolean),
  ).slice(0, 8);
  if (named.length) {
    const t0 = Date.now();
    const rows = await query(
      graph,
      "agent topics",
      `
      MATCH (t:Topic)
      WHERE t.slug IN $slugs OR toLower(t.name) IN $names
      RETURN DISTINCT t.slug AS slug, t.name AS name, coalesce(t.domain, "") AS domain
      LIMIT 12
      `,
      {
        slugs: uniq(named.flatMap((n) => [n, slugify(n)])),
        names: named.map((n) => n.toLowerCase()),
      },
    );
    ops.push({
      id: "seed.agent",
      kind: "cypher",
      purpose:
        "Check that the topics the goal agent extracted exist as Topic nodes (the agent may not invent topics).",
      status: rows === null ? "failed" : rows.length ? "ok" : "empty",
      result: rows?.length
        ? `${rows.length} of ${named.length} named topic(s) exist: ${rows.map((r) => str(r.name)).join(", ")}.`
        : `None of ${named.length} named topic(s) exist in the graph.`,
      durationMs: Date.now() - t0,
    });
    if (rows?.length) {
      return {
        method: "agent_topics",
        confidence: "high",
        needsClarification: false,
        tokens,
        seeds: rows.map(seedFrom),
      };
    }
  }

  if (!tokens.length) return none;
  const { names, slugs } = phraseVariants(input.wish);

  // b) exact topic name / slug inside the wording
  let t0 = Date.now();
  const exact = await query(
    graph,
    "exact topic match",
    `
    MATCH (t:Topic)
    WHERE toLower(t.name) IN $names OR t.slug IN $slugs
    RETURN t.slug AS slug, t.name AS name, coalesce(t.domain, "") AS domain
    ORDER BY coalesce(t.foundation_rank, 0) DESC
    LIMIT 3
    `,
    { names, slugs },
  );
  ops.push({
    id: "seed.exact",
    kind: "cypher",
    purpose: "Match the wording against Topic names and slugs exactly.",
    status: exact === null ? "failed" : exact.length ? "ok" : "empty",
    result: exact?.length
      ? `Matched ${exact.map((r) => str(r.name)).join(", ")}.`
      : "No Topic has exactly that name.",
    durationMs: Date.now() - t0,
  });
  if (exact?.length) {
    return {
      method: "exact_name",
      confidence: "high",
      needsClarification: false,
      tokens,
      seeds: exact.map(seedFrom),
    };
  }

  // c) the whole wording is a broad area ("frontend")
  t0 = Date.now();
  const domainRows = await query(
    graph,
    "topic domains",
    `MATCH (t:Topic) WHERE t.domain IS NOT NULL RETURN DISTINCT toLower(t.domain) AS domain`,
  );
  const domains = new Set((domainRows ?? []).map((r) => str(r.domain)));
  const domainTokens = tokens.filter((t) => domains.has(t));
  const byDomain = async (): Promise<Row[]> =>
    (await query(
      graph,
      "domain topics",
      `
      MATCH (t:Topic)
      WHERE toLower(t.domain) IN $domains
      RETURN t.slug AS slug, t.name AS name, coalesce(t.domain, "") AS domain
      ORDER BY coalesce(t.foundation_rank, 0) DESC, t.name
      LIMIT 8
      `,
      { domains: domainTokens },
    )) ?? [];
  if (domainTokens.length && domainTokens.length === tokens.length) {
    const rows = await byDomain();
    ops.push({
      id: "seed.domain",
      kind: "cypher",
      purpose:
        "The wording names a whole area: use that area's highest-ranked topics as seeds.",
      status: rows.length ? "ok" : "empty",
      result: rows.length
        ? `Area "${domainTokens.join(", ")}": ${rows.length} topic(s).`
        : `No Topic has domain "${domainTokens.join(", ")}".`,
      durationMs: Date.now() - t0,
    });
    if (rows.length) {
      return {
        method: "domain",
        confidence: "medium",
        needsClarification: false,
        tokens,
        seeds: rows.map(seedFrom),
      };
    }
  }

  // d) full-text index over Topic name / description / aliases
  t0 = Date.now();
  const q = tokens.map((t) => (t.length >= 4 ? `${t}*` : t)).join("|");
  const ft = await query(
    graph,
    "topic fulltext",
    `
    CALL db.idx.fulltext.queryNodes('Topic', $q) YIELD node, score
    RETURN node.slug AS slug, node.name AS name,
           coalesce(node.domain, "") AS domain, score
    ORDER BY score DESC
    LIMIT 10
    `,
    { q },
  );
  const hits = (ft ?? []).map((r) => ({
    ...seedFrom(r),
    score: num(r.score),
    coverage: tokenCoverage(tokens, `${str(r.name)} ${str(r.slug)}`),
  }));
  const reliable = hits.filter((h) => h.coverage >= 0.5);
  const top = Math.max(0, ...reliable.map((h) => h.score));
  const chosen = reliable.filter((h) => h.score >= top * 0.4).slice(0, 6);
  ops.push({
    id: "seed.fulltext",
    kind: "fulltext",
    purpose:
      "Match the wording against the full-text index on Topic name, description and aliases.",
    status: ft === null ? "failed" : chosen.length ? "ok" : "empty",
    result: chosen.length
      ? `${hits.length} hit(s); kept ${chosen.length} whose names cover the wording: ${chosen.map((h) => h.name).join(", ")}.`
      : hits.length
        ? `${hits.length} hit(s), none covers the wording well enough to trust.`
        : "No hits.",
    durationMs: Date.now() - t0,
  });
  if (chosen.length) {
    return {
      method: "full_text",
      confidence: chosen.some((h) => h.coverage === 1) ? "high" : "medium",
      needsClarification: false,
      tokens,
      seeds: chosen.map(({ slug, name, domain }) => ({ slug, name, domain })),
    };
  }

  // e) a domain word sat next to other words and nothing else matched
  if (domainTokens.length) {
    const rows = await byDomain();
    if (rows.length) {
      ops.push({
        id: "seed.domain",
        kind: "cypher",
        purpose: "Fallback: use the area named in the wording.",
        status: "ok",
        result: `Area "${domainTokens.join(", ")}": ${rows.length} topic(s).`,
        durationMs: 0,
      });
      return {
        method: "domain",
        confidence: "medium",
        needsClarification: false,
        tokens,
        seeds: rows.map(seedFrom),
      };
    }
  }
  return none;
}

// ------------------------------------------------------------
// 2. EXPAND: neighbourhood around the seeds
// ------------------------------------------------------------

const MAX_HOPS = 2;
const MAX_TOPICS = 60;
const MAX_EVIDENCE = 60;
const EVIDENCE_PER_TOPIC = 3;

const linkKey = (a: string, b: string, type: string): string =>
  `${type}:${[a, b].sort().join("~")}`;

async function expandTopics(
  graph: Graph,
  seeds: string[],
  ops: GraphOperation[],
): Promise<{
  places: Map<string, { role: TopicRole; hops: number }>;
  links: TopicLink[];
}> {
  const places = new Map<string, { role: TopicRole; hops: number }>(
    seeds.map((s) => [s, { role: "seed", hops: 0 }]),
  );
  const links = new Map<string, TopicLink>();

  // RELATED_TOPIC, one hop per query, so every edge keeps its reason
  let t0 = Date.now();
  let frontier = seeds;
  let failed = false;
  for (let hop = 1; hop <= MAX_HOPS && frontier.length; hop++) {
    const rows = await query(
      graph,
      `related hop ${hop}`,
      `
      MATCH (a:Topic)-[e:RELATED_TOPIC]-(b:Topic)
      WHERE a.slug IN $frontier AND a.slug <> b.slug
      RETURN DISTINCT a.slug AS a, b.slug AS b,
             coalesce(e.reason, "") AS reason,
             coalesce(e.confidence, 0.5) AS confidence
      LIMIT 300
      `,
      { frontier },
    );
    if (rows === null) {
      failed = true;
      break;
    }
    const next: string[] = [];
    for (const r of rows) {
      const a = str(r.a);
      const b = str(r.b);
      if (!a || !b) continue;
      const key = linkKey(a, b, "RELATED_TOPIC");
      if (!links.has(key)) {
        links.set(key, {
          a,
          b,
          type: "RELATED_TOPIC",
          reason: str(r.reason),
          weight: Math.max(0.1, Math.min(1, num(r.confidence, 0.5))),
        });
      }
      if (!places.has(b)) {
        places.set(b, { role: "related", hops: hop });
        next.push(b);
      }
    }
    frontier = next;
  }
  ops.push({
    id: "expand.related",
    kind: "cypher",
    purpose: `Walk RELATED_TOPIC up to ${MAX_HOPS} hops from the seeds, one hop per query.`,
    status: failed ? "failed" : links.size ? "ok" : "empty",
    result: `${links.size} related link(s); ${places.size} topic(s) reached including seeds.`,
    durationMs: Date.now() - t0,
  });

  // topics in the same stored community (labelPropagation) as a seed
  t0 = Date.now();
  const clusterRows = await query(
    graph,
    "cluster peers",
    `
    MATCH (s:Topic)
    WHERE s.slug IN $seeds AND s.cluster_id IS NOT NULL
    MATCH (t:Topic)
    WHERE t.cluster_id = s.cluster_id AND t.slug <> s.slug
    RETURN DISTINCT s.slug AS a, t.slug AS b
    LIMIT 100
    `,
    { seeds },
  );
  let clusterAdded = 0;
  for (const r of clusterRows ?? []) {
    const a = str(r.a);
    const b = str(r.b);
    if (!a || !b) continue;
    const key = linkKey(a, b, "SAME_CLUSTER");
    if (links.has(key)) continue;
    links.set(key, {
      a,
      b,
      type: "SAME_CLUSTER",
      reason: "stored community (Topic.cluster_id) is the same",
      weight: 0.25,
    });
    clusterAdded += 1;
    if (!places.has(b)) places.set(b, { role: "cluster", hops: 1 });
  }
  ops.push({
    id: "expand.cluster",
    kind: "cypher",
    purpose:
      "Add topics that share a stored cluster_id (community) with a seed. Weak link, weight 0.25.",
    status: clusterRows === null ? "failed" : clusterAdded ? "ok" : "empty",
    result: `${clusterAdded} same-cluster link(s).`,
    durationMs: Date.now() - t0,
  });

  return { places, links: [...links.values()] };
}

// ------------------------------------------------------------
// 3. depth, capability coverage, evidence
// ------------------------------------------------------------

const MISSING_DEPTH: DeveloperDepth = {
  assessed: false,
  level: "none",
  score: null,
  confidence: "",
  authenticity: "",
  verdict: "",
  strengths: [],
  gaps: [],
  files: 0,
  commits: 0,
  repos: 0,
  lastSeen: "",
  approaches: [],
  safeguards: [],
  built: [],
  rationale: "",
};

async function readDepth(
  graph: Graph,
  developerId: string,
  slugs: string[],
): Promise<Map<string, DeveloperDepth> | null> {
  const [assess, approaches] = await Promise.all([
    query(
      graph,
      "depth assessments",
      `
      MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment)-[:OF_TOPIC]->(t:Topic)
      WHERE t.slug IN $slugs
      RETURN t.slug AS slug, a.level AS level, a.score AS score,
             coalesce(a.confidence, "") AS confidence,
             coalesce(a.authenticity, "") AS authenticity,
             coalesce(a.verdict, "") AS verdict,
             coalesce(a.strengths_json, "[]") AS strengths,
             coalesce(a.gaps_json, "[]") AS gaps,
             coalesce(a.files, 0) AS files, coalesce(a.commits, 0) AS commits,
             coalesce(a.repos, 0) AS repos, coalesce(a.last_seen, "") AS last_seen,
             coalesce(a.safeguards_json, "[]") AS safeguards,
             coalesce(a.implementations_json, "[]") AS implementations,
             coalesce(a.rationale, "") AS rationale
      `,
      { dev: developerId, slugs },
    ),
    query(
      graph,
      "depth approaches",
      `
      MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment)-[u:USES_APPROACH]->(ap:Approach)
      WHERE a.topic_slug IN $slugs
      RETURN a.topic_slug AS slug, ap.name AS name,
             coalesce(ap.slug, u.slug, "") AS approach_slug,
             coalesce(u.is_primary, false) AS is_primary,
             coalesce(u.depth, "") AS depth,
             coalesce(u.authenticity, "") AS authenticity,
             coalesce(u.how_implemented, "") AS how
      ORDER BY coalesce(u.depth_rank, 0) DESC
      `,
      { dev: developerId, slugs },
    ),
  ]);
  if (assess === null) return null;
  const byTopic = new Map<string, Approach[]>();
  for (const r of approaches ?? []) {
    const list = byTopic.get(str(r.slug)) ?? [];
    const name = str(r.name);
    list.push({
      // fall back to a slug derived from the name when the node stores none
      slug: str(r.approach_slug) || slugify(name),
      name,
      isPrimary: r.is_primary === true || r.is_primary === "true",
      depth: asLevel(r.depth),
      authenticity: str(r.authenticity),
      howImplemented: str(r.how).slice(0, 400),
    });
    byTopic.set(str(r.slug), list);
  }
  const out = new Map<string, DeveloperDepth>();
  for (const r of assess) {
    const slug = str(r.slug);
    out.set(slug, {
      assessed: true,
      level: asLevel(r.level),
      score: numOrNull(r.score),
      confidence: str(r.confidence),
      authenticity: str(r.authenticity),
      verdict: str(r.verdict).slice(0, 400),
      strengths: parseList(r.strengths).slice(0, 5),
      gaps: parseList(r.gaps).slice(0, 5),
      files: num(r.files),
      commits: num(r.commits),
      repos: num(r.repos),
      lastSeen: str(r.last_seen),
      approaches: (byTopic.get(slug) ?? []).slice(0, 4),
      safeguards: parseList(r.safeguards).slice(0, 6),
      built: parseObjects(r.implementations)
        .slice(0, 5)
        .map((o) => ({ what: str(o.what).slice(0, 200), path: str(o.path) })),
      rationale: str(r.rationale).slice(0, 400),
    });
  }
  return out;
}

async function readCoverage(
  graph: Graph,
  developerId: string,
  slugs: string[],
): Promise<CapabilityCoverage[] | null> {
  const rows = await query(
    graph,
    "capability coverage",
    `
    MATCH (t:Topic)-[m:MAPS_TO]->(c:Capability)
    WHERE t.slug IN $slugs
    OPTIONAL MATCH (:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c)
    RETURN t.slug AS slug, c.id AS id, coalesce(c.name, c.id) AS name,
           coalesce(m.weight, 0.5) AS weight, count(DISTINCT x) AS demos
    `,
    { dev: developerId, slugs },
  );
  if (rows === null) return null;
  return rows.map((r) => ({
    topicSlug: str(r.slug),
    capabilityId: str(r.id),
    capability: str(r.name),
    weight: Math.max(0.1, Math.min(1, num(r.weight, 0.5))),
    demonstrations: num(r.demos),
  }));
}

/**
 * Missions this developer completed and had verified, on the topics in this
 * neighbourhood. The goal agent uses them so it never proposes the same move
 * twice.
 *
 * ADJUST TO YOUR MISSION SCHEMA: this assumes
 *   (:Developer)-[:HAS_MISSION]->(:Mission {title, verification_state,
 *   focus_slug, verified_at})
 * Change the label, relationship and property names below to match what the
 * mission store actually writes. A wrong name returns zero rows (the agent then
 * simply has no completed moves); it does not throw.
 */
async function readCompletedMoves(
  graph: Graph,
  developerId: string,
  slugs: string[],
): Promise<CompletedMove[] | null> {
  const rows = await query(
    graph,
    "completed missions",
    `
    MATCH (:Developer {id: $dev})-[:HAS_MISSION]->(m:Mission)
    WHERE m.verification_state = "verified"
      AND (m.focus_slug IN $slugs OR m.topic_slug IN $slugs)
    RETURN coalesce(m.title, "") AS title,
           coalesce(m.focus_slug, m.topic_slug, "") AS topic,
           coalesce(m.verified_at, m.updated_at, "") AS verified_at
    ORDER BY verified_at DESC
    LIMIT 30
    `,
    { dev: developerId, slugs },
  );
  if (rows === null) return null;
  return rows
    .map((r) => ({
      title: str(r.title).slice(0, 200),
      topicSlug: str(r.topic),
      verifiedAt: str(r.verified_at),
    }))
    .filter((m) => m.title);
}

const SKIP_ROLES = ["config", "infra", "dependency_manifest"];
const GENERIC_PACKAGES = new Set([
  "react",
  "react-dom",
  "next",
  "express",
  "typescript",
  "vue",
  "svelte",
]);

function githubLink(repo: string, sha: string, path: string): string {
  return repo && sha && path
    ? `https://github.com/${repo}/blob/${sha}/${path
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`
    : "";
}

/**
 * This file only CONSUMES the topic model: it never defines topics, approaches
 * or depth, and it reads the canonical links written by the other graphs.
 *
 * Evidence comes from four places, strongest first:
 *  0. Demonstrations linked straight to the topic (Demonstration -EVIDENCE_FOR_TOPIC-> Topic),
 *     which carry a reason and confidence; links below 0.3 confidence are ignored
 *  1. Demonstrations  (Topic -> Capability <- Demonstration -> FileChange)
 *  2. Code the depth assessment itself cites (DepthAssessment -BACKED_BY-> FileChange)
 *  3. For the topics the developer asked about: authored files that match the
 *     topic's own packages / keywords (stored in the assessment spec)
 * A topic with no mapped capability (for example client state management) used to
 * have NO evidence. Now 2 and 3 give the agent real code to start from.
 */
async function readEvidence(
  graph: Graph,
  developerId: string,
  slugs: string[],
  seedSlugs: string[] = [],
): Promise<EvidenceItem[] | null> {
  if (!slugs.length) return [];

  const [linkedRows, demoRows, citedRows, specRows] = await Promise.all([
    query(
      graph,
      "explicit evidence links",
      `
      MATCH (:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[l:EVIDENCE_FOR_TOPIC]->(t:Topic)
      WHERE t.slug IN $slugs AND l.developer_id = $dev AND coalesce(l.confidence, 0) >= 0.3
      OPTIONAL MATCH (x)-[:OF_CAPABILITY]->(c:Capability)
      OPTIONAL MATCH (x)-[:IN_REPOSITORY]->(r:Repository)
      OPTIONAL MATCH (x)-[:EVIDENCED_BY]->(fc:FileChange)
      RETURN t.slug AS slug, coalesce(c.id, "") AS capability_id,
             coalesce(c.name, c.id, "") AS capability,
             x.id AS id,
             coalesce(x.technique, "") AS technique,
             coalesce(x.summary, "") AS summary,
             coalesce(x.depth, "") AS depth,
             coalesce(x.depth_rank, 0) AS depth_rank,
             coalesce(r.full_name, r.name, "") AS repository,
             coalesce(x.path, "") AS path,
             coalesce(x.commit_sha, "") AS commit_sha,
             coalesce(x.commit_subject, "") AS commit_subject,
             coalesce(x.permalink, "") AS permalink,
             coalesce(fc.id, "") AS file_change_id,
             coalesce(x.modifiers, "") AS modifiers,
             coalesce(fc.is_test, false) AS is_test
      ORDER BY coalesce(l.confidence, 0) DESC, depth_rank DESC
      LIMIT 400
      `,
      { dev: developerId, slugs },
    ),
    query(
      graph,
      "evidence chain",
      `
      MATCH (t:Topic)-[:MAPS_TO]->(c:Capability)
      WHERE t.slug IN $slugs
      MATCH (:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c)
      OPTIONAL MATCH (x)-[:IN_REPOSITORY]->(r:Repository)
      OPTIONAL MATCH (x)-[:EVIDENCED_BY]->(fc:FileChange)
      RETURN t.slug AS slug, c.id AS capability_id, coalesce(c.name, c.id) AS capability,
             x.id AS id,
             coalesce(x.technique, "") AS technique,
             coalesce(x.summary, "") AS summary,
             coalesce(x.depth, "") AS depth,
             coalesce(x.depth_rank, 0) AS depth_rank,
             coalesce(r.full_name, r.name, "") AS repository,
             coalesce(x.path, "") AS path,
             coalesce(x.commit_sha, "") AS commit_sha,
             coalesce(x.commit_subject, "") AS commit_subject,
             coalesce(x.permalink, "") AS permalink,
             coalesce(fc.id, "") AS file_change_id,
             coalesce(x.modifiers, "") AS modifiers,
             coalesce(fc.is_test, false) AS is_test
      ORDER BY depth_rank DESC
      LIMIT 400
      `,
      { dev: developerId, slugs },
    ),
    query(
      graph,
      "assessment-cited code",
      `
      MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment)-[:BACKED_BY]->(fc:FileChange)
      WHERE a.topic_slug IN $slugs AND coalesce(fc.is_test, false) = false
      OPTIONAL MATCH (r:Repository) WHERE r.id = fc.repository_id
      OPTIONAL MATCH (c:Commit) WHERE c.id = fc.repository_id + ":commit:" + fc.commit_sha
      RETURN a.topic_slug AS slug, coalesce(a.level, "") AS level,
             fc.id AS file_change_id, coalesce(fc.path, "") AS path,
             coalesce(fc.commit_sha, "") AS commit_sha,
             coalesce(r.full_name, r.name, "") AS repository,
             coalesce(c.subject, "") AS subject
      ORDER BY coalesce(fc.additions, 0) DESC
      LIMIT 200
      `,
      { dev: developerId, slugs },
    ),
    query(
      graph,
      "topic specs",
      `
      MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment)
      WHERE a.topic_slug IN $slugs
      RETURN a.topic_slug AS slug, coalesce(a.spec_json, "{}") AS spec
      `,
      { dev: developerId, slugs },
    ),
  ]);
  if (demoRows === null && citedRows === null && linkedRows === null)
    return null;

  // the topic's own packages / keywords (from the stored assessment spec)
  const pkgsBy = new Map<string, string[]>();
  const kwsBy = new Map<string, string[]>();
  const hintsBy = new Map<string, string[]>();
  for (const r of specRows ?? []) {
    let spec: Row = {};
    try {
      spec = JSON.parse(str(r.spec) || "{}") as Row;
    } catch {
      /* keep empty */
    }
    const approaches = asList(spec.approaches) as Row[];
    const pkgs = uniq(
      [
        ...asList(spec.packages),
        ...approaches.flatMap((a) => asList(a?.packages)),
      ]
        .map((x) => str(x).toLowerCase())
        .filter((p) => p && !GENERIC_PACKAGES.has(p)),
    );
    const kws = uniq(
      [
        ...asList(spec.keywords),
        ...approaches.flatMap((a) => asList(a?.keywords)),
      ]
        .map((x) => str(x).toLowerCase())
        .filter((k) => k.length >= 4),
    );
    const slug = str(r.slug);
    pkgsBy.set(slug, pkgs);
    kwsBy.set(slug, kws);
    hintsBy.set(
      slug,
      uniq([...pkgs.map((p) => p.split("/").pop() ?? p), ...kws]).slice(0, 12),
    );
  }

  const items: EvidenceItem[] = [];
  const seenDemo = new Set<string>();
  const seenFile = new Set<string>();
  const perTopic = new Map<string, number>();
  const perTopicCode = new Map<string, number>();

  const add = (
    slug: string,
    rest: Omit<EvidenceItem, "id" | "topicSlug" | "hints">,
  ) =>
    items.push({
      id: `E${items.length + 1}`,
      topicSlug: slug,
      hints: hintsBy.get(slug) ?? [],
      ...rest,
    });

  // 1. demonstrations
  // explicit topic links first; the capability-mediated rows only fill the rest
  for (const r of [...(linkedRows ?? []), ...(demoRows ?? [])]) {
    if (items.length >= MAX_EVIDENCE) break;
    const slug = str(r.slug);
    const key = `${slug}|${str(r.id)}`;
    if (seenDemo.has(key)) continue;
    if ((perTopic.get(slug) ?? 0) >= EVIDENCE_PER_TOPIC) continue;
    seenDemo.add(key);
    perTopic.set(slug, (perTopic.get(slug) ?? 0) + 1);
    const fcId = str(r.file_change_id);
    if (fcId) seenFile.add(`${slug}|${fcId}`);
    add(slug, {
      capabilityId: str(r.capability_id),
      capability: str(r.capability),
      demonstrationId: str(r.id),
      technique: str(r.technique),
      summary: str(r.summary).slice(0, 300),
      depth: str(r.depth),
      repository: str(r.repository),
      path: str(r.path),
      commitSha: str(r.commit_sha),
      commitSubject: str(r.commit_subject).slice(0, 160),
      permalink: str(r.permalink),
      fileChangeId: fcId,
      hardening: str(r.modifiers)
        .split(" | ")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 6),
      isTest: r.is_test === true || r.is_test === "true",
    });
  }

  // 2. code the assessment cites (no capability needed)
  for (const r of citedRows ?? []) {
    if (items.length >= MAX_EVIDENCE) break;
    const slug = str(r.slug);
    const fcId = str(r.file_change_id);
    if (!fcId || seenFile.has(`${slug}|${fcId}`)) continue;
    if ((perTopicCode.get(slug) ?? 0) >= EVIDENCE_PER_TOPIC) continue;
    seenFile.add(`${slug}|${fcId}`);
    perTopicCode.set(slug, (perTopicCode.get(slug) ?? 0) + 1);
    const repo = str(r.repository);
    const sha = str(r.commit_sha);
    const path = str(r.path);
    add(slug, {
      capabilityId: "",
      capability: "",
      demonstrationId: "",
      technique: "",
      summary: `Authored code cited by the ${str(r.level) || "depth"} assessment of this topic.`,
      depth: str(r.level),
      repository: repo,
      path,
      commitSha: sha,
      commitSubject: str(r.subject).slice(0, 160),
      permalink: githubLink(repo, sha, path),
      fileChangeId: fcId,
      hardening: [],
      isTest: false,
    });
  }

  // 3. topics the developer asked about that still have no code: match by the topic's own atoms
  for (const slug of seedSlugs) {
    if (items.some((e) => e.topicSlug === slug && e.fileChangeId && !e.isTest))
      continue;
    const pkgs = pkgsBy.get(slug) ?? [];
    const kws = kwsBy.get(slug) ?? [];
    if (!pkgs.length && !kws.length) continue;
    const rows = await query(
      graph,
      `spec-matched code (${slug})`,
      `
      MATCH (:Developer {id: $dev})-[:AUTHORED_CODE]->(fc:FileChange)
      WHERE coalesce(fc.is_test, false) = false
        AND NOT coalesce(fc.file_role, "source") IN $skip
        AND (any(p IN $pkgs WHERE toLower(coalesce(fc.imports_added_json, "")) CONTAINS p)
          OR any(k IN $kws WHERE toLower(coalesce(fc.path, "")) CONTAINS k))
      OPTIONAL MATCH (r:Repository) WHERE r.id = fc.repository_id
      OPTIONAL MATCH (c:Commit) WHERE c.id = fc.repository_id + ":commit:" + fc.commit_sha
      RETURN fc.id AS file_change_id, coalesce(fc.path, "") AS path,
             coalesce(fc.commit_sha, "") AS commit_sha,
             coalesce(r.full_name, r.name, "") AS repository,
             coalesce(c.subject, "") AS subject
      ORDER BY coalesce(fc.additions, 0) DESC
      LIMIT 4
      `,
      { dev: developerId, skip: SKIP_ROLES, pkgs, kws },
    );
    for (const r of rows ?? []) {
      if (items.length >= MAX_EVIDENCE) break;
      const fcId = str(r.file_change_id);
      if (!fcId || seenFile.has(`${slug}|${fcId}`)) continue;
      seenFile.add(`${slug}|${fcId}`);
      const repo = str(r.repository);
      const sha = str(r.commit_sha);
      const path = str(r.path);
      add(slug, {
        capabilityId: "",
        capability: "",
        demonstrationId: "",
        technique: "",
        summary:
          "Authored file that uses this topic's packages or matches its keywords (found by matching, not cited by an assessment).",
        depth: "",
        repository: repo,
        path,
        commitSha: sha,
        commitSubject: str(r.subject).slice(0, 160),
        permalink: githubLink(repo, sha, path),
        fileChangeId: fcId,
        hardening: [],
        isTest: false,
      });
    }
  }
  return items;
}

const MAX_CODE = 8;
const CODE_CHARS = 1200;

function excerptAround(
  code: string,
  snippet: string,
  hints: string[] = [],
): string {
  const lines = code.split("\n");
  const first = snippet
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length >= 12);
  let at = first ? lines.findIndex((l) => l.includes(first)) : -1;
  // no demonstration snippet: anchor on the topic's own packages / keywords
  if (at < 0 && hints.length)
    at = lines.findIndex((l) => {
      const low = l.toLowerCase();
      return hints.some((h) => low.includes(h));
    });
  // Never substitute Demonstration.snippet for source code. That field can
  // contain a prose note (for example, "NOTE: ..."), which would then be
  // passed to the Goal Agent as if it were a code excerpt and later fail
  // mission-time repository validation.
  if (at < 0) return code.trim().slice(0, CODE_CHARS);
  return lines
    .slice(Math.max(0, at - 6), at + 40)
    .join("\n")
    .slice(0, CODE_CHARS);
}

/**
 * Real code behind the strongest evidence (seed topics first, at most two per
 * topic). The agent may quote only this, so what it proposes starts from code
 * that exists.
 */
async function readCode(
  graph: Graph,
  evidence: EvidenceItem[],
  seedSlugs: Set<string>,
): Promise<CodeContext[] | null> {
  const usable = evidence.filter((e) => !e.isTest && e.fileChangeId);
  const ordered = [
    ...usable.filter((e) => seedSlugs.has(e.topicSlug)),
    ...usable.filter((e) => !seedSlugs.has(e.topicSlug)),
  ];
  const perTopic = new Map<string, number>();
  const picked: EvidenceItem[] = [];
  for (const e of ordered) {
    if (picked.length >= MAX_CODE) break;
    const n = perTopic.get(e.topicSlug) ?? 0;
    if (n >= 2) continue;
    perTopic.set(e.topicSlug, n + 1);
    picked.push(e);
  }
  if (!picked.length) return [];
  const [codeRows, snippetRows] = await Promise.all([
    query(
      graph,
      "evidence code",
      `MATCH (fc:FileChange) WHERE fc.id IN $ids
       RETURN fc.id AS id, coalesce(fc.added_code, "") AS code`,
      { ids: uniq(picked.map((e) => e.fileChangeId)) },
    ),
    query(
      graph,
      "evidence snippets",
      `MATCH (x:Demonstration) WHERE x.id IN $ids
       RETURN x.id AS id, coalesce(x.snippet, "") AS snippet`,
      { ids: uniq(picked.map((e) => e.demonstrationId).filter(Boolean)) },
    ),
  ]);
  if (codeRows === null) return null;
  const codeBy = new Map(
    codeRows.map((r) => [str(r.id), String(r.code ?? "")]),
  );
  const snippetBy = new Map(
    (snippetRows ?? []).map((r) => [str(r.id), String(r.snippet ?? "").trim()]),
  );
  const out: CodeContext[] = [];
  for (const e of picked) {
    const excerpt = excerptAround(
      codeBy.get(e.fileChangeId) ?? "",
      snippetBy.get(e.demonstrationId) ?? "",
      e.hints,
    );
    if (excerpt.length >= 40)
      out.push({ evidenceId: e.id, path: e.path, excerpt });
  }
  return out;
}

// ------------------------------------------------------------
// 4. RANK: Personalized PageRank over the retrieved subgraph
// ------------------------------------------------------------

/**
 * Power iteration with restart. At every step a walker either follows an edge
 * (probability `damping`, edge chosen proportionally to weight) or jumps back
 * to a restart node (probability 1 - damping). Nodes that sit close to the
 * restart nodes through many / heavy paths end up with the highest score.
 * Mass stuck on nodes without edges is sent back to the restart nodes.
 */
export function personalizedPageRank(
  nodes: string[],
  edges: Array<{ from: string; to: string; weight: number }>,
  restart: string[],
  options: { damping?: number; iterations?: number; tolerance?: number } = {},
): Map<string, number> {
  const damping = options.damping ?? 0.85;
  const iterations = options.iterations ?? 80;
  const tolerance = options.tolerance ?? 1e-9;

  const adj = new Map<string, Array<[string, number]>>();
  const outSum = new Map<string, number>();
  for (const n of nodes) {
    adj.set(n, []);
    outSum.set(n, 0);
  }
  for (const e of edges) {
    if (!adj.has(e.from) || !adj.has(e.to) || e.weight <= 0) continue;
    adj.get(e.from)!.push([e.to, e.weight]);
    adj.get(e.to)!.push([e.from, e.weight]);
    outSum.set(e.from, (outSum.get(e.from) ?? 0) + e.weight);
    outSum.set(e.to, (outSum.get(e.to) ?? 0) + e.weight);
  }

  const start = restart.filter((r) => adj.has(r));
  const r0 = new Map<string, number>(
    (start.length ? start : nodes).map((n) => [
      n,
      1 / (start.length || nodes.length || 1),
    ]),
  );

  let score = new Map<string, number>(r0);
  for (let i = 0; i < iterations; i++) {
    const next = new Map<string, number>();
    let dangling = 0;
    for (const n of nodes) {
      const p = score.get(n) ?? 0;
      const total = outSum.get(n) ?? 0;
      if (total === 0) {
        dangling += p;
        continue;
      }
      for (const [m, w] of adj.get(n) ?? []) {
        next.set(m, (next.get(m) ?? 0) + damping * p * (w / total));
      }
    }
    let diff = 0;
    for (const n of nodes) {
      const restartMass = r0.get(n) ?? 0;
      const v =
        (next.get(n) ?? 0) + restartMass * (1 - damping + damping * dangling);
      diff += Math.abs(v - (score.get(n) ?? 0));
      next.set(n, v);
    }
    score = next;
    if (diff < tolerance) break;
  }
  return score;
}

const K = {
  topic: (s: string) => `topic:${s}`,
  assessment: (s: string) => `assessment:${s}`,
  capability: (id: string) => `capability:${id}`,
  demonstration: (id: string) => `demonstration:${id}`,
  file: (id: string) => `file:${id}`,
  repository: (n: string) => `repository:${n}`,
};

function buildContext(
  topics: Array<{ slug: string; name: string; depth: DeveloperDepth }>,
  links: TopicLink[],
  coverage: CapabilityCoverage[],
  evidence: EvidenceItem[],
): { nodes: ContextNode[]; edges: ContextEdge[] } {
  const nodes = new Map<string, ContextNode>();
  const edges: ContextEdge[] = [];
  const addNode = (key: string, kind: ContextKind, label: string) => {
    if (!nodes.has(key)) nodes.set(key, { key, kind, label, score: 0 });
  };
  const addEdge = (from: string, to: string, type: string, weight: number) =>
    edges.push({ from, to, type, weight });

  for (const t of topics) addNode(K.topic(t.slug), "topic", t.name);
  for (const l of links) {
    if (nodes.has(K.topic(l.a)) && nodes.has(K.topic(l.b)))
      addEdge(K.topic(l.a), K.topic(l.b), l.type, l.weight);
  }
  for (const t of topics) {
    if (!t.depth.assessed) continue;
    addNode(K.assessment(t.slug), "assessment", `${t.name}: ${t.depth.level}`);
    // deeper assessments pull more rank towards their topic
    addEdge(
      K.topic(t.slug),
      K.assessment(t.slug),
      "OF_TOPIC",
      0.5 + 0.25 * levelRank(t.depth.level),
    );
  }
  for (const c of coverage) {
    if (!nodes.has(K.topic(c.topicSlug))) continue;
    addNode(K.capability(c.capabilityId), "capability", c.capability);
    addEdge(
      K.topic(c.topicSlug),
      K.capability(c.capabilityId),
      "MAPS_TO",
      c.weight,
    );
  }
  for (const e of evidence) {
    if (e.demonstrationId) {
      const demo = K.demonstration(e.demonstrationId);
      addNode(demo, "demonstration", e.technique || e.capability);
      if (nodes.has(K.capability(e.capabilityId)))
        addEdge(demo, K.capability(e.capabilityId), "OF_CAPABILITY", 1);
      if (e.fileChangeId) {
        addNode(K.file(e.fileChangeId), "file", e.path || e.fileChangeId);
        addEdge(demo, K.file(e.fileChangeId), "EVIDENCED_BY", 1);
      }
      if (e.repository) {
        addNode(K.repository(e.repository), "repository", e.repository);
        addEdge(demo, K.repository(e.repository), "IN_REPOSITORY", 1);
      }
    } else if (e.fileChangeId && nodes.has(K.topic(e.topicSlug))) {
      // code cited by the assessment: the topic points straight at the file
      addNode(K.file(e.fileChangeId), "file", e.path || e.fileChangeId);
      addEdge(K.topic(e.topicSlug), K.file(e.fileChangeId), "CITED_CODE", 0.8);
      if (e.repository) {
        addNode(K.repository(e.repository), "repository", e.repository);
        addEdge(
          K.file(e.fileChangeId),
          K.repository(e.repository),
          "IN_REPOSITORY",
          1,
        );
      }
    }
  }
  return { nodes: [...nodes.values()], edges };
}

// ------------------------------------------------------------
// 5. SIGNALS: facts for the agent (not a decision)
// ------------------------------------------------------------

function buildSignals(
  topics: GraphTopic[],
  links: TopicLink[],
  coverage: CapabilityCoverage[],
  evidence: EvidenceItem[],
  scope: { domains: Set<string>; strict: boolean },
): GoalGraphResult["signals"] {
  const evidenceByTopic = new Map<string, string[]>();
  for (const e of evidence)
    evidenceByTopic.set(e.topicSlug, [
      ...(evidenceByTopic.get(e.topicSlug) ?? []),
      e.id,
    ]);
  const missingByTopic = new Map<string, string[]>();
  for (const c of coverage)
    if (c.demonstrations === 0)
      missingByTopic.set(c.topicSlug, [
        ...(missingByTopic.get(c.topicSlug) ?? []),
        c.capability,
      ]);
  const nameOf = new Map(topics.map((t) => [t.slug, t.name]));

  // direct RELATED_TOPIC neighbours (not weak cluster peers)
  const neighbours = new Map<string, Set<string>>();
  for (const l of links) {
    if (l.type !== "RELATED_TOPIC") continue;
    (neighbours.get(l.a) ?? neighbours.set(l.a, new Set()).get(l.a)!).add(l.b);
    (neighbours.get(l.b) ?? neighbours.set(l.b, new Set()).get(l.b)!).add(l.a);
  }

  const mk = (t: GraphTopic, reasons: string[]): Signal => ({
    slug: t.slug,
    name: t.name,
    domain: t.domain,
    level: t.depth.level,
    relevance: t.relevance,
    reasons,
    evidenceIds: evidenceByTopic.get(t.slug) ?? [],
    nearStrengths: [],
    missingCapabilities: (missingByTopic.get(t.slug) ?? []).slice(0, 5),
  });

  const strengths: Signal[] = [];
  const unproven: Signal[] = [];
  for (const t of topics) {
    const d = t.depth;
    const rank = levelRank(d.level);
    const ids = evidenceByTopic.get(t.slug) ?? [];
    const inDomain =
      scope.domains.size === 0 || scope.domains.has(t.domain.toLowerCase());
    const strong =
      d.assessed &&
      (rank >= 3 ||
        (rank >= READY_RANK && d.authenticity === "genuine_implementation"));

    if (strong && ids.length) {
      strengths.push(
        mk(t, [
          `assessed ${d.level} (${d.authenticity || "authenticity unknown"}) from ${d.files} file(s), ${d.commits} commit(s), ${d.repos} repo(s)`,
          `${ids.length} linked piece(s) of evidence trace this to code`,
        ]),
      );
      continue;
    }
    if (scope.strict && !inDomain) continue;

    const reasons: string[] = [];
    if (!d.assessed) reasons.push("no assessment exists for this topic");
    else if (strong)
      reasons.push(
        `assessed ${d.level}, but no evidence is linked, so the claim cannot be traced to code`,
      );
    else reasons.push(`assessed only ${d.level}`);
    const missing = missingByTopic.get(t.slug) ?? [];
    if (missing.length)
      reasons.push(
        `mapped capabilities with no demonstration: ${missing.slice(0, 3).join(", ")}`,
      );
    if (d.gaps.length)
      reasons.push(`assessment gaps: ${d.gaps.slice(0, 2).join("; ")}`);
    unproven.push(mk(t, reasons));
  }

  const strengthSet = new Set(strengths.map((s) => s.slug));
  for (const u of unproven) {
    u.nearStrengths = [...(neighbours.get(u.slug) ?? [])]
      .filter((s) => strengthSet.has(s))
      .map((s) => nameOf.get(s) ?? s);
    if (u.nearStrengths.length)
      u.reasons.push(
        `directly related to your strength: ${u.nearStrengths.join(", ")}`,
      );
  }

  const byRelevance = (a: Signal, b: Signal) =>
    b.relevance - a.relevance || a.name.localeCompare(b.name);
  const opportunities = unproven
    .filter((u) => u.nearStrengths.length > 0 || u.relevance >= 0.5)
    .map((u) => ({ u, rank: u.relevance * (1 + 0.5 * u.nearStrengths.length) }))
    .sort((a, b) => b.rank - a.rank || a.u.name.localeCompare(b.u.name))
    .slice(0, 5)
    .map((x) => x.u);

  return {
    strengths: strengths.sort(byRelevance).slice(0, 8),
    unproven: unproven.sort(byRelevance).slice(0, 8),
    opportunities,
  };
}

// ------------------------------------------------------------
// 6. the investigation
// ------------------------------------------------------------

async function clarificationSuggestions(
  graph: Graph,
  developerId: string,
): Promise<SeedRow[]> {
  const mine = await query(
    graph,
    "suggestions from developer",
    `
    MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment)-[:OF_TOPIC]->(t:Topic)
    RETURN t.slug AS slug, t.name AS name, coalesce(t.domain, "") AS domain
    ORDER BY coalesce(a.score, 0) DESC
    LIMIT 6
    `,
    { dev: developerId },
  );
  if (mine?.length) return mine.map(seedFrom);
  const general = await query(
    graph,
    "suggestions from taxonomy",
    `
    MATCH (t:Topic)
    RETURN t.slug AS slug, t.name AS name, coalesce(t.domain, "") AS domain
    ORDER BY coalesce(t.foundation_rank, 0) DESC
    LIMIT 6
    `,
  );
  return (general ?? []).map(seedFrom);
}

export async function buildGoalGraph(
  graph: Graph,
  input: GoalGraphInput,
): Promise<GoalGraphResult> {
  const { developerId } = input;
  const wish = input.wish.trim();
  const operations: GraphOperation[] = [];

  // ---- 1. START ----
  const resolution = await resolveSeeds(graph, { ...input, wish }, operations);
  if (resolution.needsClarification) {
    return {
      developerId,
      wish,
      resolution,
      topics: [],
      links: [],
      coverage: [],
      evidence: [],
      context: { nodes: [], edges: [] },
      ranking: [],
      signals: { strengths: [], unproven: [], opportunities: [] },
      operations,
      code: [],
      previousMove: null,
      completedMoves: [],
      clarification: {
        reason: `"${wish}" could not be tied to any topic in your knowledge graph reliably.`,
        suggestions: await clarificationSuggestions(graph, developerId),
      },
      truncated: false,
    };
  }
  const seeds = resolution.seeds.map((s) => s.slug);

  // ---- 2. EXPAND ----
  const { places, links: allLinks } = await expandTopics(
    graph,
    seeds,
    operations,
  );
  const ordered = [...places.entries()]
    .sort((a, b) => a[1].hops - b[1].hops)
    .map(([s]) => s);
  const truncated = ordered.length > MAX_TOPICS;
  const slugs = ordered.slice(0, MAX_TOPICS);
  const inScope = new Set(slugs);
  const links = allLinks.filter((l) => inScope.has(l.a) && inScope.has(l.b));

  let t0 = Date.now();
  const [topicRows, depth, coverageRows, evidenceRows, completedRows] =
    await Promise.all([
      query(
        graph,
        "topic details",
        `
      MATCH (t:Topic)
      WHERE t.slug IN $slugs
      RETURN t.slug AS slug, t.name AS name, coalesce(t.domain, "") AS domain,
             coalesce(t.description, "") AS description,
             t.foundation_rank AS pr, t.cluster_id AS cl
      `,
        { slugs },
      ),
      readDepth(graph, developerId, slugs),
      readCoverage(graph, developerId, slugs),
      readEvidence(graph, developerId, slugs, seeds),
      readCompletedMoves(graph, developerId, slugs),
    ]);
  const readMs = Date.now() - t0;
  const coverage = coverageRows ?? [];
  const evidence = evidenceRows ?? [];
  const completedMoves = completedRows ?? [];
  const detail = new Map((topicRows ?? []).map((r) => [str(r.slug), r]));
  const present = slugs.filter((s) => detail.has(s));

  const assessedCount = present.filter((s) => depth?.has(s)).length;
  operations.push({
    id: "depth",
    kind: "cypher",
    purpose:
      "Read Developer -> DepthAssessment -> Topic for every topic in the neighbourhood (level, authenticity, approaches, gaps).",
    status: depth === null ? "failed" : assessedCount ? "ok" : "empty",
    result: `${present.length} topic(s); ${assessedCount} assessed, ${present.length - assessedCount} with no assessment.`,
    durationMs: readMs,
  });
  const demoCount = evidence.filter((e) => e.demonstrationId).length;
  operations.push({
    id: "evidence",
    kind: "cypher",
    purpose:
      "Read evidence: demonstrations (Topic -> Capability <- Demonstration -> FileChange), code the depth assessment cites, and authored files matching the topic's own packages/keywords.",
    status: evidenceRows === null ? "failed" : evidence.length ? "ok" : "empty",
    result: `${evidence.length} evidence item(s) (${demoCount} demonstration(s), ${evidence.length - demoCount} cited/matched code) across ${uniq(evidence.map((e) => e.repository).filter(Boolean)).length} repositor(ies); ${coverage.length} topic-capability mapping(s), ${coverage.filter((c) => c.demonstrations === 0).length} with no demonstration.`,
    durationMs: readMs,
  });
  operations.push({
    id: "completed",
    kind: "cypher",
    purpose:
      "Read missions this developer already completed and had verified on these topics, so the agent does not propose them again.",
    status:
      completedRows === null
        ? "failed"
        : completedMoves.length
          ? "ok"
          : "empty",
    result: `${completedMoves.length} verified mission(s).`,
    durationMs: readMs,
  });

  // ---- 3. RANK ----
  t0 = Date.now();
  const draftTopics = present.map((slug) => ({
    slug,
    name: str(detail.get(slug)?.name, slug),
    depth: depth?.get(slug) ?? MISSING_DEPTH,
  }));
  const context = buildContext(draftTopics, links, coverage, evidence);
  const ppr = personalizedPageRank(
    context.nodes.map((n) => n.key),
    context.edges,
    seeds.map(K.topic),
  );
  for (const n of context.nodes) n.score = round(ppr.get(n.key) ?? 0, 6);
  const maxTopicScore = Math.max(
    1e-12,
    ...context.nodes.filter((n) => n.kind === "topic").map((n) => n.score),
  );
  const ranking = [...context.nodes]
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, 25);
  operations.push({
    id: "ppr",
    kind: "personalized_pagerank",
    purpose:
      "Rank the retrieved subgraph by closeness to the seed topics (restart on seeds). Orders context for the agent; it does not choose the goal.",
    status: context.nodes.length ? "ok" : "empty",
    result: `${context.nodes.length} node(s), ${context.edges.length} edge(s); top: ${ranking
      .slice(0, 3)
      .map((n) => n.label)
      .join(", ")}.`,
    durationMs: Date.now() - t0,
  });

  const topics: GraphTopic[] = present.map((slug) => {
    const r = detail.get(slug) as Row;
    const place = places.get(slug) as { role: TopicRole; hops: number };
    return {
      slug,
      name: str(r.name, slug),
      domain: str(r.domain),
      description: str(r.description).slice(0, 240),
      role: place.role,
      hops: place.hops,
      foundationRank: numOrNull(r.pr),
      clusterId: numOrNull(r.cl),
      relevance: round((ppr.get(K.topic(slug)) ?? 0) / maxTopicScore, 3),
      depth: depth?.get(slug) ?? MISSING_DEPTH,
    };
  });

  // ---- 3b. CODE + PREVIOUS MOVE (provider data for the agent) ----
  t0 = Date.now();
  const codeRows = await readCode(graph, evidence, new Set(seeds));
  const code = codeRows ?? [];
  operations.push({
    id: "code",
    kind: "cypher",
    purpose:
      "Read the code behind the strongest evidence (FileChange.added_code) so the agent works from what was actually built.",
    status: codeRows === null ? "failed" : code.length ? "ok" : "empty",
    result: `${code.length} code excerpt(s) for ${evidence.length} evidence item(s).`,
    durationMs: Date.now() - t0,
  });
  const prevRows = await query(
    graph,
    "previous move",
    `MATCH (:Goal {id: $goal_id})-[:PROPOSES]->(m:NextMove)
     RETURN m.title AS title, coalesce(m.done_when, "") AS done_when LIMIT 1`,
    { goal_id: `goal:${developerId}:${slugify(wish) || "goal"}` },
  );
  const previousMove = prevRows?.[0]
    ? { title: str(prevRows[0].title), doneWhen: str(prevRows[0].done_when) }
    : null;

  // ---- 4. SIGNALS ----
  const seedDomains = new Set(
    resolution.seeds.map((s) => s.domain.toLowerCase()).filter(Boolean),
  );
  const signals = buildSignals(topics, links, coverage, evidence, {
    domains: seedDomains,
    // a whole-area wish spans domains; a specific topic should stay in its area
    strict: resolution.method !== "domain" && seedDomains.size > 0,
  });

  log("goal graph built", {
    method: resolution.method,
    seeds: seeds.length,
    topics: topics.length,
    links: links.length,
    evidence: evidence.length,
    completed: completedMoves.length,
    nodes: context.nodes.length,
    strengths: signals.strengths.length,
    unproven: signals.unproven.length,
    opportunities: signals.opportunities.length,
  });

  return {
    developerId,
    wish,
    resolution,
    topics,
    links,
    coverage,
    evidence,
    context,
    ranking,
    signals,
    operations,
    code,
    previousMove,
    completedMoves,
    clarification: null,
    truncated,
  };
}

// ------------------------------------------------------------
// 7. CONNECT: write the NextMove the agent decided on
// ------------------------------------------------------------

export interface NextMoveInput {
  title: string;
  summary: string;
  /** topic the move is about; null when it introduces something new */
  focusSlug: string | null;
  /** strengths the move builds on. Each needs cited evidence from that topic. */
  strengthSlugs: string[];
  /** unproven topics the move closes */
  gapSlugs: string[];
  /** evidence ids (E1...) from this GoalGraphResult */
  evidenceIds: string[];
  /** capability the move advances (Capability.id), when it targets one */
  capabilityId?: string | null;
  /** FileChange the task starts from (FileChange.id) */
  startFileChangeId?: string | null;
  /** objectively checkable completion condition */
  doneWhen?: string;
  /** why this move was selected: selection facts, challenge, steps (stored as JSON) */
  details?: Row;
}

export interface NextMoveStored {
  stored: boolean;
  goalId: string;
  nextMoveId: string;
  links: {
    targets: number;
    focus: number;
    leverages: number;
    closesGap: number;
    demonstrations: number;
    fileChanges: number;
    assessments: number;
    capability: number;
    startsAt: number;
  };
  /** things the agent claimed that the graph result did not support */
  rejected: string[];
}

const topicId = (slug: string) => `topic:${slug}`;
const assessmentId = (dev: string, slug: string) => `depth:${dev}:${slug}`;

/**
 * Persists (Developer)-[:HAS_GOAL]->(Goal)-[:PROPOSES]->(NextMove) and links the
 * move to topics, its target capability, its starting file and its evidence.
 * Only what this result contains can be cited:
 * unknown topics and evidence ids are dropped and reported, and a topic can be
 * claimed as a strength only if the move cites evidence that belongs to it.
 * The move also keeps done_when and details_json (why it was selected).
 * One current NextMove per goal: a new one replaces the previous.
 */
export async function storeNextMove(
  graph: Graph,
  result: GoalGraphResult,
  move: NextMoveInput,
): Promise<NextMoveStored> {
  const rejected: string[] = [];
  const dev = result.developerId;
  const goalId = `goal:${dev}:${slugify(result.wish) || "goal"}`;
  const nextMoveId = `nextmove:${goalId}`;
  const empty: NextMoveStored = {
    stored: false,
    goalId,
    nextMoveId,
    links: {
      targets: 0,
      focus: 0,
      leverages: 0,
      closesGap: 0,
      demonstrations: 0,
      fileChanges: 0,
      assessments: 0,
      capability: 0,
      startsAt: 0,
    },
    rejected,
  };
  if (!move.title.trim()) {
    rejected.push("NextMove has no title");
    return empty;
  }

  const topics = new Map(result.topics.map((t) => [t.slug, t]));
  const evidenceById = new Map(result.evidence.map((e) => [e.id, e]));

  const cited: EvidenceItem[] = [];
  for (const id of uniq(move.evidenceIds)) {
    const e = evidenceById.get(id);
    if (e) cited.push(e);
    else rejected.push(`unknown evidence id ${id}`);
  }
  const citedTopics = new Set(cited.map((e) => e.topicSlug));

  const known = (slug: string, role: string): boolean => {
    if (topics.has(slug)) return true;
    rejected.push(`${role} topic "${slug}" is not in the goal graph`);
    return false;
  };
  const focus =
    move.focusSlug && known(move.focusSlug, "focus") ? move.focusSlug : null;
  const strengths = uniq(move.strengthSlugs).filter((s) => {
    if (!known(s, "strength")) return false;
    if (!citedTopics.has(s)) {
      rejected.push(
        `strength "${s}" has no cited evidence, so it was not linked`,
      );
      return false;
    }
    return true;
  });
  const gaps = uniq(move.gapSlugs).filter((s) => known(s, "gap"));
  const seeds = result.resolution.seeds.map((s) => s.slug);
  const now = new Date().toISOString();

  // the target capability and starting file must come from this result too
  const capabilityId =
    move.capabilityId &&
    result.coverage.some((c) => c.capabilityId === move.capabilityId)
      ? move.capabilityId
      : null;
  if (move.capabilityId && !capabilityId)
    rejected.push(
      `capability "${move.capabilityId}" is not in the goal graph, so it was not linked`,
    );
  const startFileChangeId =
    move.startFileChangeId &&
    result.evidence.some((e) => e.fileChangeId === move.startFileChangeId)
      ? move.startFileChangeId
      : null;
  if (move.startFileChangeId && !startFileChangeId)
    rejected.push(
      `starting file "${move.startFileChangeId}" is not in the cited evidence, so it was not linked`,
    );

  const goalOk = await query(
    graph,
    "upsert goal",
    `
    MATCH (d:Developer {id: $dev})
    MERGE (g:Goal {id: $goal_id})
    SET g.developer_id = $dev, g.wish = $wish, g.resolved_by = $method,
        g.updated_at = $now
    MERGE (d)-[:HAS_GOAL]->(g)
    RETURN count(g) AS n
    `,
    {
      dev,
      goal_id: goalId,
      wish: result.wish,
      method: result.resolution.method,
      now,
    },
  );
  if (!goalOk || num(goalOk[0]?.n) === 0) {
    rejected.push("Developer node not found, nothing was written");
    return empty;
  }

  // replace the previous move of this goal
  await query(
    graph,
    "remove previous NextMove",
    `MATCH (:Goal {id: $goal_id})-[:PROPOSES]->(m:NextMove) DETACH DELETE m`,
    { goal_id: goalId },
  );
  const created = await query(
    graph,
    "create NextMove",
    `
    MATCH (g:Goal {id: $goal_id})
    MERGE (m:NextMove {id: $move_id})
    SET m.title = $title, m.summary = $summary, m.developer_id = $dev,
        m.created_at = $now, m.done_when = $done_when,
        m.details_json = $details
    MERGE (g)-[:PROPOSES]->(m)
    RETURN count(m) AS n
    `,
    {
      goal_id: goalId,
      move_id: nextMoveId,
      title: move.title.trim().slice(0, 200),
      summary: move.summary.trim().slice(0, 1200),
      done_when: (move.doneWhen ?? "").trim().slice(0, 400),
      details: JSON.stringify(move.details ?? {}).slice(0, 8000),
      dev,
      now,
    },
  );
  if (!created || num(created[0]?.n) === 0) return empty;

  const topicLink = (
    label: string,
    rel: string,
    from: "goal" | "move",
    list: string[],
  ) =>
    writeBatch(
      graph,
      label,
      `
      UNWIND $batch AS item
      MATCH (x:${from === "goal" ? "Goal {id: $goal_id}" : "NextMove {id: $move_id}"})
      MATCH (t:Topic {id: item.topic_id})
      MERGE (x)-[r:${rel}]->(t)
      RETURN count(r) AS n
      `,
      list.map((s) => ({ topic_id: topicId(s) })),
      { goal_id: goalId, move_id: nextMoveId },
    );

  const links = { ...empty.links };
  links.targets = await topicLink("TARGETS", "TARGETS", "goal", seeds);
  links.focus = await topicLink(
    "FOCUSES_ON",
    "FOCUSES_ON",
    "move",
    focus ? [focus] : [],
  );
  links.leverages = await topicLink(
    "LEVERAGES",
    "LEVERAGES",
    "move",
    strengths,
  );
  links.closesGap = await topicLink(
    "CLOSES_GAP_IN",
    "CLOSES_GAP_IN",
    "move",
    gaps,
  );

  const backedBy = (label: string, nodeLabel: string, batch: Row[]) =>
    writeBatch(
      graph,
      label,
      `
      UNWIND $batch AS item
      MATCH (m:NextMove {id: $move_id})
      MATCH (x:${nodeLabel} {id: item.id})
      MERGE (m)-[r:BACKED_BY]->(x)
      SET r.ref = item.ref
      RETURN count(r) AS n
      `,
      batch,
      { move_id: nextMoveId },
    );
  const citedDemos = cited.filter((e) => e.demonstrationId);
  links.demonstrations = await backedBy(
    "BACKED_BY Demonstration",
    "Demonstration",
    citedDemos.map((e) => ({ id: e.demonstrationId, ref: e.id })),
  );
  links.fileChanges = await backedBy(
    "BACKED_BY FileChange",
    "FileChange",
    cited
      .filter((e) => e.fileChangeId)
      .map((e) => ({ id: e.fileChangeId, ref: e.id })),
  );
  links.assessments = await backedBy(
    "BACKED_BY DepthAssessment",
    "DepthAssessment",
    strengths.map((s) => ({ id: assessmentId(dev, s), ref: s })),
  );

  // the capability the move advances, and the code it starts from
  const single = (
    label: string,
    rel: string,
    nodeLabel: string,
    id: string | null,
  ) =>
    id
      ? writeBatch(
          graph,
          label,
          `
          UNWIND $batch AS item
          MATCH (m:NextMove {id: $move_id})
          MATCH (x:${nodeLabel} {id: item.id})
          MERGE (m)-[r:${rel}]->(x)
          RETURN count(r) AS n
          `,
          [{ id }],
          { move_id: nextMoveId },
        )
      : Promise.resolve(0);
  links.capability = await single(
    "ADVANCES",
    "ADVANCES",
    "Capability",
    capabilityId,
  );
  links.startsAt = await single(
    "STARTS_AT",
    "STARTS_AT",
    "FileChange",
    startFileChangeId,
  );

  if (links.demonstrations < citedDemos.length)
    rejected.push(
      `${citedDemos.length - links.demonstrations} cited demonstration(s) no longer exist in the graph`,
    );
  log("next move stored", { nextMoveId, ...links, rejected: rejected.length });
  return { stored: true, goalId, nextMoveId, links, rejected };
}

// ------------------------------------------------------------
// compact view for the agent prompt
// ------------------------------------------------------------

/**
 * Everything the graph knows about the goal's neighbourhood, as plain data.
 * Nothing here is a decision: the agent reads it and decides. `code` holds the
 * only code excerpts the agent may quote.
 */
export function briefForAgent(result: GoalGraphResult): Row {
  const name = (slug: string) =>
    result.topics.find((t) => t.slug === slug)?.name ?? slug;
  const codeIds = new Set(result.code.map((c) => c.evidenceId));

  const groups = new Map<number, string[]>();
  for (const t of result.topics) {
    if (t.clusterId == null) continue;
    groups.set(t.clusterId, [...(groups.get(t.clusterId) ?? []), t.name]);
  }

  return {
    goal: result.wish,
    howToUse:
      "This is data read from the developer's knowledge graph. The graph does not choose anything: you decide the next move. Cite evidence ids (E1...) for every claim about what the developer has built. Use only topic slugs, capability ids and evidence ids listed here. 'relevance' is Personalized PageRank closeness to the goal and only orders the data. A capability with 0 demonstrations means no evidence was found, not that the developer cannot do it.",
    resolvedBy: {
      method: result.resolution.method,
      confidence: result.resolution.confidence,
      seeds: result.resolution.seeds.map((s) => s.slug),
    },
    topics: result.topics.slice(0, 40).map((t) => ({
      slug: t.slug,
      name: t.name,
      domain: t.domain,
      role: t.role,
      hops: t.hops,
      relevance: t.relevance,
      assessed: t.depth.assessed,
      level: t.depth.level,
      authenticity: t.depth.authenticity || null,
      confidence: t.depth.confidence || null,
      files: t.depth.files,
      commits: t.depth.commits,
      repos: t.depth.repos,
      lastSeen: t.depth.lastSeen || null,
      strengths: t.depth.strengths,
      gaps: t.depth.gaps,
      verdict: t.depth.verdict || null,
      rationale: t.depth.rationale || null,
      safeguards: t.depth.safeguards,
      built: t.depth.built,
      // the agent copies decision.approachSlug from here, so slug must be present
      approaches: t.depth.approaches.map((a) => ({
        slug: a.slug,
        name: a.name,
        primary: a.isPrimary,
        depth: a.depth,
        authenticity: a.authenticity || null,
        how: a.howImplemented,
      })),
    })),
    relatedTopics: result.links
      .filter((l) => l.type === "RELATED_TOPIC")
      .slice(0, 60)
      .map((l) => ({
        a: name(l.a),
        b: name(l.b),
        reason: l.reason || undefined,
      })),
    groups: [...groups.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([id, names]) => ({ group: id, topics: names.slice(0, 12) })),
    capabilities: result.coverage.slice(0, 60).map((c) => ({
      id: c.capabilityId,
      name: c.capability,
      topic: c.topicSlug,
      weight: c.weight,
      demonstrations: c.demonstrations,
    })),
    evidence: result.evidence.map((e) => ({
      id: e.id,
      topic: e.topicSlug,
      capability: e.capability,
      capabilityId: e.capabilityId,
      repository: e.repository,
      path: e.path,
      technique: e.technique,
      summary: e.summary,
      depth: e.depth,
      hardening: e.hardening,
      commit: e.commitSubject,
      hasCode: codeIds.has(e.id),
    })),
    signals: {
      note: "pre-computed facts about the neighbourhood, not recommendations",
      strengths: result.signals.strengths.map((s) => s.name),
      unproven: result.signals.unproven.map((s) => ({
        name: s.name,
        reasons: s.reasons,
      })),
      nearStrengths: result.signals.opportunities.map((s) => ({
        name: s.name,
        nearStrengths: s.nearStrengths,
      })),
    },
    previousMove: result.previousMove,
    completedMoves: result.completedMoves.slice(0, 20).map((m) => ({
      title: m.title,
      topic: m.topicSlug || null,
    })),
    code: result.code,
  };
}
