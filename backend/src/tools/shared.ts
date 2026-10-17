import { AsyncLocalStorage } from "node:async_hooks";
import type { Graph } from "../db/falkordb.js";
import {
  asAuthenticity,
  asConfidence,
  asDepthLevel,
  DEPTH_RANK,
} from "../graph/depth-analyzer-graph.js";
import type { DevTopic, MetricResult, Row, ToolResult } from "./types.js";
import type { TopicItem } from "./ui.js";

export const str = (v: unknown, fallback = ""): string =>
  v == null || typeof v === "object" ? fallback : String(v).trim();
export const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
export const nullableNum = (v: unknown): number | null =>
  v == null || !Number.isFinite(Number(v)) ? null : Number(v);
export const round = (v: number, digits = 2): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));
export const uniq = <T>(items: T[]): T[] => [...new Set(items)];
export const humanize = (s: string): string =>
  s ? s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Other";
export const LEVEL_LABEL: Record<string, string> = {
  none: "None",
  surface: "Surface",
  working: "Working",
  proficient: "Proficient",
  deep: "Deep",
};

export function daysSince(iso: string): number | null {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86_400_000) : null;
}

/**
 * Per-tool-run query health. cypher() returns null when a query throws, and most
 * tools treat null like "no rows", so a broken query used to look exactly like an
 * empty graph. runTool() opens one of these around every tool; cypher() records
 * failures into it so the agent can report "partial" instead of "empty".
 */
export interface QueryHealth {
  total: number;
  failed: string[];
}
export const queryHealth = new AsyncLocalStorage<QueryHealth>();

export async function cypher(
  graph: Graph,
  label: string,
  query: string,
  params: Row = {},
): Promise<Row[] | null> {
  const health = queryHealth.getStore();
  if (health) health.total += 1;
  try {
    const result = await graph.query(query, { params });
    return (result.data ?? []) as Row[];
  } catch (error) {
    health?.failed.push(label);
    console.warn(
      `[topic-tools] ${label} failed:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export const FOUNDATION_WEAK_RANK = 2;

export const FOUNDATION_LIFT = 1.5;

const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

export const evidenceVolume = (t: DevTopic): number =>
  t.files + 2 * t.commits + 3 * t.repos;

export const strengthOrder = (a: DevTopic, b: DevTopic): number =>
  b.levelRank - a.levelRank ||
  (CONFIDENCE_RANK[b.confidence] ?? 0) - (CONFIDENCE_RANK[a.confidence] ?? 0) ||
  evidenceVolume(b) - evidenceVolume(a) ||
  b.score - a.score ||
  a.name.localeCompare(b.name);

export function broadButShallow(topics: DevTopic[]): {
  items: DevTopic[];
  bar: number;
} {
  if (!topics.length) return { items: [], bar: 5 };
  const files = topics.map((t) => t.files).sort((a, b) => a - b);
  const median = files[Math.floor(files.length / 2)] ?? 0;
  const bar = Math.max(5, median);
  const items = topics
    .filter((t) => t.levelRank <= 2 && t.files >= bar)
    .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));
  return { items, bar };
}

export async function loadDeveloperTopics(
  graph: Graph,
  developerId: string,
): Promise<DevTopic[]> {
  const result =
    (await cypher(
      graph,
      "developer topics",
      `
      MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment)-[:OF_TOPIC]->(t:Topic)
      RETURN t.slug AS slug, t.name AS name, coalesce(t.domain, "") AS domain,
             t.foundation_rank AS pr, t.bridge_score AS bt,
             t.cluster_id AS cl, t.component_id AS cc,
             a.level AS level, coalesce(a.score, 0) AS score,
             coalesce(a.baseline_score, 0) AS baseline,
             a.confidence AS confidence, a.authenticity AS authenticity,
             coalesce(a.verdict, "") AS verdict,
             coalesce(a.files, 0) AS files, coalesce(a.commits, 0) AS commits,
             coalesce(a.repos, 0) AS repos, coalesce(a.active_days, 0) AS active_days,
             coalesce(a.first_seen, "") AS first_seen, coalesce(a.last_seen, "") AS last_seen,
             coalesce(a.approach_count, 0) AS approach_count
      `,
      { dev: developerId },
    )) ?? [];

  return result.map((r) => {
    const level = asDepthLevel(r.level);
    return {
      slug: str(r.slug),
      name: str(r.name),
      domain: str(r.domain) || "other",
      level,
      levelRank: DEPTH_RANK[level],
      score: num(r.score),
      baselineScore: num(r.baseline),
      confidence: asConfidence(r.confidence),
      authenticity: asAuthenticity(r.authenticity),
      verdict: str(r.verdict),
      files: num(r.files),
      commits: num(r.commits),
      repos: num(r.repos),
      activeDays: num(r.active_days),
      firstSeen: str(r.first_seen),
      lastSeen: str(r.last_seen),
      approachCount: num(r.approach_count),
      foundationRank: nullableNum(r.pr),
      bridgeScore: nullableNum(r.bt),
      clusterId: nullableNum(r.cl),
      componentId: nullableNum(r.cc),
    };
  });
}

export async function loadNeighbors(
  graph: Graph,
  slugs: string[],
): Promise<Map<string, { name: string; domain: string }>> {
  const out = new Map<string, { name: string; domain: string }>();
  if (!slugs.length) return out;
  const result =
    (await cypher(
      graph,
      "visible neighbors",
      `
      MATCH (a:Topic)-[:BUILDS_ON|RELATED_TOPIC]-(n:Topic)
      WHERE a.slug IN $slugs
      RETURN DISTINCT n.slug AS slug, n.name AS name, coalesce(n.domain, "") AS domain
      LIMIT 1000
      `,
      { slugs },
    )) ?? [];
  const known = new Set(slugs);
  for (const r of result) {
    const slug = str(r.slug);
    if (slug && !known.has(slug)) {
      out.set(slug, { name: str(r.name), domain: str(r.domain) });
    }
  }
  return out;
}

export interface TaxonomyShape {
  topics: number;
  builds: number;
  related: number;
}

export async function taxonomyShape(graph: Graph): Promise<TaxonomyShape> {
  const rows = await cypher(
    graph,
    "taxonomy shape",
    `
    MATCH (t:Topic)
    WITH count(t) AS topics
    OPTIONAL MATCH (:Topic)-[b:BUILDS_ON]->(:Topic)
    WITH topics, count(b) AS builds
    OPTIONAL MATCH (:Topic)-[r:RELATED_TOPIC]->(:Topic)
    RETURN topics, builds, count(r) AS related
    `,
  );
  const r = rows?.[0] ?? {};
  return {
    topics: num(r.topics),
    builds: num(r.builds),
    related: num(r.related),
  };
}

export const relTypes = (s: TaxonomyShape): string[] => [
  ...(s.builds > 0 ? ["BUILDS_ON"] : []),
  ...(s.related > 0 ? ["RELATED_TOPIC"] : []),
];

export interface Subgraph {
  slugs: string[];
  builds: Array<[string, string]>;
  related: Array<[string, string]>;
}

const pairKey = (a: string, b: string): string =>
  a < b ? `${a}~${b}` : `${b}~${a}`;

async function loadSubgraph(
  graph: Graph,
  devSlugs: string[],
): Promise<Subgraph | null> {
  if (!devSlugs.length) return null;
  const closure = await cypher(
    graph,
    "foundation closure",
    `
    MATCH (t:Topic)-[:BUILDS_ON*1..3]->(f:Topic)
    WHERE t.slug IN $slugs
    RETURN DISTINCT f.slug AS slug
    `,
    { slugs: devSlugs },
  );
  if (closure === null) return null;
  const slugs = uniq([
    ...devSlugs,
    ...closure.map((r) => str(r.slug)).filter(Boolean),
  ]);
  const rows = await cypher(
    graph,
    "scoped edges",
    `
    MATCH (a:Topic)-[r:BUILDS_ON|RELATED_TOPIC]->(b:Topic)
    WHERE a.slug IN $s AND b.slug IN $s
    RETURN a.slug AS a, b.slug AS b, type(r) AS type
    `,
    { s: slugs },
  );
  if (rows === null) return null;

  const builds: Array<[string, string]> = [];
  const related: Array<[string, string]> = [];
  const seenB = new Set<string>();
  const seenR = new Set<string>();
  for (const r of rows) {
    const a = str(r.a);
    const b = str(r.b);
    if (!a || !b || a === b) continue;
    if (str(r.type) === "BUILDS_ON") {
      if (seenB.has(`${a}>${b}`)) continue;
      seenB.add(`${a}>${b}`);
      builds.push([a, b]);
    } else {
      const k = pairKey(a, b);
      if (seenR.has(k)) continue;
      seenR.add(k);
      related.push([a, b]);
    }
  }
  return { slugs, builds, related };
}

const subCache = new Map<string, { at: number; p: Promise<Subgraph | null> }>();
const SUB_TTL_MS = 30_000;

export function scopedSubgraph(
  graph: Graph,
  developerId: string,
  slugs: string[],
): Promise<Subgraph | null> {
  const key = `${developerId}|${[...slugs].sort().join(",")}`;
  const hit = subCache.get(key);
  if (hit && Date.now() - hit.at < SUB_TTL_MS) return hit.p;
  const p = loadSubgraph(graph, slugs);
  subCache.set(key, { at: Date.now(), p });
  if (subCache.size > 50) {
    const oldest = subCache.keys().next().value;
    if (oldest !== undefined) subCache.delete(oldest);
  }
  return p;
}

export function componentsLocal(
  nodes: string[],
  edges: Array<[string, string]>,
): Map<string, number> {
  const parent = new Map(nodes.map((s) => [s, s] as [string, string]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const nx = parent.get(c)!;
      parent.set(c, r);
      c = nx;
    }
    return r;
  };
  for (const [a, b] of edges) {
    if (!parent.has(a) || !parent.has(b)) continue;
    parent.set(find(a), find(b));
  }
  const ids = new Map<string, number>();
  const out = new Map<string, number>();
  for (const s of nodes) {
    const root = find(s);
    if (!ids.has(root)) ids.set(root, ids.size);
    out.set(s, ids.get(root)!);
  }
  return out;
}

export interface MetricMeta {
  scope: "developer" | "global" | "persisted" | "none";
  nodes: number;
  builds: number;
  related: number;
  note: string;
}

type WithMeta = MetricResult & { meta: MetricMeta };

function withMeta(m: MetricResult, meta: MetricMeta): WithMeta {
  return Object.assign(m, { meta });
}

export function metricMeta(m: MetricResult): MetricMeta {
  const meta = (m as Partial<WithMeta>).meta;
  if (meta) return meta;
  return {
    scope: m.live ? "global" : m.scores.size ? "persisted" : "none",
    nodes: m.scores.size,
    builds: 0,
    related: 0,
    note: "",
  };
}

export function liftOf(m: MetricResult, slug: string): number {
  const n = m.scores.size;
  return n ? (m.scores.get(slug) ?? 0) * n : 0;
}

function pageRankLocal(
  nodes: string[],
  edges: Array<[string, string]>,
  d = 0.85,
  iterations = 60,
): Map<string, number> {
  const n = nodes.length;
  const idx = new Map(nodes.map((s, i) => [s, i] as [string, number]));
  const out: number[][] = nodes.map(() => []);
  for (const [a, b] of edges) {
    const i = idx.get(a);
    const j = idx.get(b);
    if (i !== undefined && j !== undefined) out[i]!.push(j);
  }
  let r = new Array<number>(n).fill(1 / n);
  for (let k = 0; k < iterations; k++) {
    const next = new Array<number>(n).fill((1 - d) / n);
    let dangling = 0;
    for (let i = 0; i < n; i++) {
      if (!out[i]!.length) {
        dangling += r[i]!;
        continue;
      }
      const share = r[i]! / out[i]!.length;
      for (const j of out[i]!) next[j]! += d * share;
    }
    const add = (d * dangling) / n;
    for (let i = 0; i < n; i++) next[i]! += add;
    r = next;
  }
  return new Map(nodes.map((s, i) => [s, r[i]!]));
}

function betweennessLocal(
  nodes: string[],
  edges: Array<[string, string]>,
): Map<string, number> {
  const n = nodes.length;
  const idx = new Map(nodes.map((s, i) => [s, i] as [string, number]));
  const adj: Array<Set<number>> = nodes.map(() => new Set<number>());
  for (const [a, b] of edges) {
    const i = idx.get(a);
    const j = idx.get(b);
    if (i === undefined || j === undefined || i === j) continue;
    adj[i]!.add(j);
    adj[j]!.add(i);
  }
  const cb = new Array<number>(n).fill(0);
  for (let s = 0; s < n; s++) {
    const stack: number[] = [];
    const pred: number[][] = nodes.map(() => []);
    const sigma = new Array<number>(n).fill(0);
    const dist = new Array<number>(n).fill(-1);
    sigma[s] = 1;
    dist[s] = 0;
    const queue = [s];
    for (let h = 0; h < queue.length; h++) {
      const v = queue[h]!;
      stack.push(v);
      for (const w of adj[v]!) {
        if (dist[w]! < 0) {
          dist[w] = dist[v]! + 1;
          queue.push(w);
        }
        if (dist[w] === dist[v]! + 1) {
          sigma[w]! += sigma[v]!;
          pred[w]!.push(v);
        }
      }
    }
    const delta = new Array<number>(n).fill(0);
    while (stack.length) {
      const w = stack.pop()!;
      for (const v of pred[w]!) {
        delta[v]! += (sigma[v]! / sigma[w]!) * (1 + delta[w]!);
      }
      if (w !== s) cb[w]! += delta[w]!;
    }
  }
  return new Map(nodes.map((s, i) => [s, cb[i]! / 2]));
}

const GLOBAL_ONLY = () => process.env.TOPIC_METRICS_SCOPE === "global";

export interface MetricScope {
  developerId: string;
  slugs: string[];
}

async function persisted(
  graph: Graph,
  prop: "foundation_rank" | "bridge_score",
): Promise<MetricResult> {
  const rows =
    (await cypher(
      graph,
      `persisted ${prop}`,
      `MATCH (t:Topic) WHERE t.${prop} IS NOT NULL RETURN t.slug AS slug, t.${prop} AS score`,
    )) ?? [];
  return {
    scores: new Map(rows.map((r) => [str(r.slug), num(r.score)])),
    source: rows.length ? "persisted (whole taxonomy)" : "none",
    live: false,
  };
}

async function globalPageRank(graph: Graph): Promise<WithMeta> {
  const shape = await taxonomyShape(graph);
  if (shape.topics >= 2 && shape.builds + shape.related > 0) {
    const type = shape.builds > 0 ? "BUILDS_ON" : "RELATED_TOPIC";
    const live = await cypher(
      graph,
      `live pageRank ${type}`,
      `CALL algo.pageRank('Topic', '${type}') YIELD node, score
       RETURN node.slug AS slug, score`,
    );
    if (live?.length) {
      return withMeta(
        {
          scores: new Map(live.map((r) => [str(r.slug), num(r.score)])),
          source: `algo.pageRank('Topic', '${type}') over the whole shared taxonomy`,
          live: true,
        },
        {
          scope: "global",
          nodes: live.length,
          builds: shape.builds,
          related: shape.related,
          note: "Includes topics that are not yours.",
        },
      );
    }
  }
  const p = await persisted(graph, "foundation_rank");
  return withMeta(p, {
    scope: p.scores.size ? "persisted" : "none",
    nodes: p.scores.size,
    builds: shape.builds,
    related: shape.related,
    note: "Stored values from the last analysis; may be stale.",
  });
}

async function globalBetweenness(graph: Graph): Promise<WithMeta> {
  const shape = await taxonomyShape(graph);
  const types = relTypes(shape);
  if (shape.topics >= 2 && types.length) {
    const live = await cypher(
      graph,
      "live betweenness",
      `CALL algo.betweenness({nodeLabels: ['Topic'], relationshipTypes: ${JSON.stringify(types)}})
       YIELD node, score
       RETURN node.slug AS slug, score`,
    );
    if (live?.length) {
      return withMeta(
        {
          scores: new Map(live.map((r) => [str(r.slug), num(r.score)])),
          source: `algo.betweenness(${types.join("|")}) over the whole shared taxonomy`,
          live: true,
        },
        {
          scope: "global",
          nodes: live.length,
          builds: shape.builds,
          related: shape.related,
          note: "Includes topics that are not yours.",
        },
      );
    }
  }
  const p = await persisted(graph, "bridge_score");
  return withMeta(p, {
    scope: p.scores.size ? "persisted" : "none",
    nodes: p.scores.size,
    builds: shape.builds,
    related: shape.related,
    note: "Stored values from the last analysis; may be stale.",
  });
}

export async function computePageRank(
  graph: Graph,
  scope?: MetricScope,
): Promise<MetricResult> {
  if (scope && !GLOBAL_ONLY()) {
    const sub = await scopedSubgraph(graph, scope.developerId, scope.slugs);
    if (sub) {
      const meta = {
        nodes: sub.slugs.length,
        builds: sub.builds.length,
        related: sub.related.length,
      };
      if (!sub.builds.length) {
        return withMeta(
          { scores: new Map(), source: "none", live: false },
          {
            scope: "developer",
            ...meta,
            note: "No BUILDS_ON edges among your topics, so no foundation ranking is possible.",
          },
        );
      }
      return withMeta(
        {
          scores: pageRankLocal(sub.slugs, sub.builds),
          source: `PageRank over BUILDS_ON in your topic subgraph (${meta.nodes} topics, ${meta.builds} edges)`,
          live: true,
        },
        {
          scope: "developer",
          ...meta,
          note: "Counts only your topics and the foundations they stand on.",
        },
      );
    }
  }
  return globalPageRank(graph);
}

export async function computeBetweenness(
  graph: Graph,
  scope?: MetricScope,
): Promise<MetricResult> {
  if (scope && !GLOBAL_ONLY()) {
    const sub = await scopedSubgraph(graph, scope.developerId, scope.slugs);
    if (sub) {
      const edges = [...sub.builds, ...sub.related];
      const meta = {
        nodes: sub.slugs.length,
        builds: sub.builds.length,
        related: sub.related.length,
      };
      if (!edges.length) {
        return withMeta(
          { scores: new Map(), source: "none", live: false },
          {
            scope: "developer",
            ...meta,
            note: "No edges among your topics, so no bridges exist.",
          },
        );
      }
      return withMeta(
        {
          scores: betweennessLocal(sub.slugs, edges),
          source: `betweenness over BUILDS_ON + RELATED_TOPIC in your topic subgraph (${meta.nodes} topics, ${edges.length} edges)`,
          live: true,
        },
        {
          scope: "developer",
          ...meta,
          note: "Shortest paths between your topics and their foundations only.",
        },
      );
    }
  }
  return globalBetweenness(graph);
}

export function graphOrder(pr: Map<string, number>, bt: Map<string, number>) {
  return (
    a: { slug: string; name: string },
    b: { slug: string; name: string },
  ) =>
    (pr.get(b.slug) ?? -1) - (pr.get(a.slug) ?? -1) ||
    (bt.get(b.slug) ?? -1) - (bt.get(a.slug) ?? -1) ||
    a.name.localeCompare(b.name);
}

export const maxOf = (m: Map<string, number>): number => {
  let max = 0;
  for (const v of m.values()) if (v > max) max = v;
  return max;
};

export function topicItem(t: DevTopic, note?: string): TopicItem {
  return {
    slug: t.slug,
    name: t.name,
    level: t.level,
    score: t.score,
    assessed: true,
    note,
  };
}

export function refItem(
  by: Map<string, DevTopic>,
  slug: string,
  name?: string,
  note?: string,
): TopicItem {
  const t = by.get(slug);
  if (t) return topicItem(t, note);
  return {
    slug,
    name: name || humanize(slug),
    level: null,
    score: null,
    assessed: false,
    note,
  };
}

export const bySlugMap = (topics: DevTopic[]): Map<string, DevTopic> =>
  new Map(topics.map((t) => [t.slug, t]));

export function notFound(text: string): ToolResult {
  return {
    summary: `No topic matching "${text}" is visible in this developer's graph.`,
    facts: { error: "topic_not_found", query: text },
    blocks: [
      {
        type: "callout",
        tone: "warn",
        title: "Topic not found",
        text: `I couldn't find a topic called "${text}" in your graph. Try the exact name from the constellation.`,
      },
    ],
    slugs: [],
  };
}

export function noAnalysis(): ToolResult {
  return {
    summary: "The developer has no assessed topics yet.",
    facts: { error: "no_topics" },
    blocks: [
      {
        type: "callout",
        tone: "warn",
        title: "No topics yet",
        text: "Run the analysis first, then I can answer questions about your graph.",
      },
    ],
    slugs: [],
  };
}
