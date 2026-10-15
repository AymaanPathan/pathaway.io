import type { Graph } from "../../db/falkordb.js";




import { Domain as _constants } from './constants.js';
import { Domain as _queries } from './queries.js';
import { Domain as _readers } from './readers.js';
import { Domain as _types } from './types.js';
import { Domain as _writers } from './writers.js';

export namespace Domain {
import LOG_PREFIX = _constants.LOG_PREFIX;
import LEVELS = _constants.LEVELS;
import levelRank = _constants.levelRank;
import READY_RANK = _readers.READY_RANK;
import readDepth = _readers.readDepth;
import readCoverage = _readers.readCoverage;
import readEvidence = _readers.readEvidence;
import readCode = _readers.readCode;
import personalizedPageRank = _readers.personalizedPageRank;
import buildGoalGraph = _readers.buildGoalGraph;
import briefForAgent = _readers.briefForAgent;
import Row = _types.Row;
import DepthLevel = _types.DepthLevel;
import GraphOperation = _types.GraphOperation;
import Approach = _types.Approach;
import DeveloperDepth = _types.DeveloperDepth;
import TopicRole = _types.TopicRole;
import GraphTopic = _types.GraphTopic;
import TopicLink = _types.TopicLink;
import CapabilityCoverage = _types.CapabilityCoverage;
import EvidenceItem = _types.EvidenceItem;
import CodeContext = _types.CodeContext;
import ContextKind = _types.ContextKind;
import ContextNode = _types.ContextNode;
import ContextEdge = _types.ContextEdge;
import Signal = _types.Signal;
import ResolutionMethod = _types.ResolutionMethod;
import Resolution = _types.Resolution;
import GoalGraphResult = _types.GoalGraphResult;
import GoalGraphInput = _types.GoalGraphInput;
import SeedRow = _types.SeedRow;
import NextMoveInput = _types.NextMoveInput;
import NextMoveStored = _types.NextMoveStored;
import writeBatch = _writers.writeBatch;
import storeNextMove = _writers.storeNextMove;

export function log(message: string, detail?: Row): void {
  if (detail !== undefined) console.log(`${LOG_PREFIX} ${message}`, detail);
  else console.log(`${LOG_PREFIX} ${message}`);
}

export const str = (v: unknown, fallback = ""): string =>
  v == null || typeof v === "object" ? fallback : String(v).trim();

export const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const numOrNull = (v: unknown): number | null =>
  v == null || !Number.isFinite(Number(v)) ? null : Number(v);

export const round = (v: number, digits = 2): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

export const uniq = <T>(items: T[]): T[] => [...new Set(items)];

export const slugify = (v: string): string =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

export function parseList(v: unknown): string[] {
  try {
    const parsed = JSON.parse(str(v) || "[]");
    return Array.isArray(parsed)
      ? parsed.map((x) => str(x)).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

export function parseObjects(v: unknown): Row[] {
  try {
    const parsed = JSON.parse(str(v) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((x) => x && typeof x === "object" && !Array.isArray(x))
      : [];
  } catch {
    return [];
  }
}

export async function query(
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

export const asLevel = (v: unknown): DepthLevel => {
  const s = str(v).toLowerCase();
  return (LEVELS as string[]).includes(s) ? (s as DepthLevel) : "none";
};

export const STOPWORDS = new Set(
  (
    "i me my we our you your the a an and or of to in on for with at by from as is are be " +
    "want wanna need like would will can could should get got make build building built " +
    "learn improve improving better more much very about into some any how skill skills " +
    "engineering engineer developer development software code coding level good great " +
    "become deeper deep advanced understand using use work working goal next that this " +
    "it do doing myself stronger master"
  ).split(" "),
);

export function wishTokens(wish: string): string[] {
  return uniq(
    (wish.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []).filter(
      (t) => !STOPWORDS.has(t),
    ),
  ).slice(0, 10);
}

export function phraseVariants(text: string): { names: string[]; slugs: string[] } {
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

export function tokenCoverage(tokens: string[], text: string): number {
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

export const seedFrom = (r: Row): SeedRow => ({
  slug: str(r.slug),
  name: str(r.name),
  domain: str(r.domain),
});

export async function resolveSeeds(
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

export const MAX_HOPS = 2;

export const MAX_TOPICS = 60;

export const MAX_EVIDENCE = 60;

export const EVIDENCE_PER_TOPIC = 3;

export const linkKey = (a: string, b: string, type: string): string =>
  `${type}:${[a, b].sort().join("~")}`;

export async function expandTopics(
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

export const MISSING_DEPTH: DeveloperDepth = {
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

export const MAX_CODE = 8;

export const CODE_CHARS = 1200;

export function excerptAround(code: string, snippet: string): string {
  const lines = code.split("\n");
  const first = snippet
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length >= 12);
  const at = first ? lines.findIndex((l) => l.includes(first)) : -1;
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

export const K = {
  topic: (s: string) => `topic:${s}`,
  assessment: (s: string) => `assessment:${s}`,
  capability: (id: string) => `capability:${id}`,
  demonstration: (id: string) => `demonstration:${id}`,
  file: (id: string) => `file:${id}`,
  repository: (n: string) => `repository:${n}`,
};

export function buildContext(
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
  }
  return { nodes: [...nodes.values()], edges };
}

export function buildSignals(
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
          `${ids.length} linked demonstration(s) trace this to code`,
        ]),
      );
      continue;
    }
    if (scope.strict && !inDomain) continue;

    const reasons: string[] = [];
    if (!d.assessed) reasons.push("no assessment exists for this topic");
    else if (strong)
      reasons.push(
        `assessed ${d.level}, but no demonstration is linked, so the claim cannot be traced to code`,
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

export async function clarificationSuggestions(
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

export const topicId = (slug: string) => `topic:${slug}`;

export const assessmentId = (dev: string, slug: string) => `depth:${dev}:${slug}`;
}
