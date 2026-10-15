import type { Graph } from "../db/falkordb.js";
import { findTopicsByText, slugify } from "../graph/depth-analyzer-graph.js";
import {
  computeBetweenness,
  computePageRank,
  loadDeveloperTopics,
  loadNeighbors,
} from "./shared.js";
import type {
  DevTopic,
  MetricResult,
  ResolvedTopic,
  ToolContext,
} from "./types.js";


export function createToolContext(
  graph: Graph,
  developerId: string,
  selectedTopic: string | null,
): ToolContext {
  let topicsP: Promise<DevTopic[]> | null = null;
  let neighborsP: Promise<
    Map<string, { name: string; domain: string }>
  > | null = null;
  let prP: Promise<MetricResult> | null = null;
  let btP: Promise<MetricResult> | null = null;

  const scope = async () => ({
    developerId,
    slugs: (await ctx.topics()).map((t) => t.slug),
  });

  const ctx: ToolContext = {
    graph,
    developerId,
    selectedTopic,
    topics: () => (topicsP ??= loadDeveloperTopics(graph, developerId)),
    neighbors: () =>
      (neighborsP ??= ctx.topics().then((t) =>
        loadNeighbors(
          graph,
          t.map((x) => x.slug),
        ),
      )),
    
    pageRank: () => (prP ??= scope().then((s) => computePageRank(graph, s))),
    betweenness: () =>
      (btP ??= scope().then((s) => computeBetweenness(graph, s))),
    resolveTopic: (text) => resolveTopic(ctx, text),
  };
  return ctx;
}

async function resolveTopic(
  ctx: ToolContext,
  text: string,
): Promise<ResolvedTopic | null> {
  const raw = text.trim();
  if (!raw) return null;
  const key = slugify(raw);
  const topics = await ctx.topics();

  const exact = topics.find((t) => t.slug === key || slugify(t.name) === key);
  if (exact) return { slug: exact.slug, name: exact.name, assessed: true };

  if (key.length >= 3) {
    const partial = topics.find((t) => {
      const n = slugify(t.name);
      return n.includes(key) || key.includes(n);
    });
    if (partial)
      return { slug: partial.slug, name: partial.name, assessed: true };
  }

  const neighbors = await ctx.neighbors();
  const direct = neighbors.get(key);
  if (direct) return { slug: key, name: direct.name, assessed: false };

  
  const hits = await findTopicsByText(ctx.graph, raw, 8).catch(() => []);
  for (const h of hits) {
    const mine = topics.find((t) => t.slug === h.slug);
    if (mine) return { slug: mine.slug, name: mine.name, assessed: true };
    const n = neighbors.get(h.slug);
    if (n) return { slug: h.slug, name: n.name, assessed: false };
  }
  return null;
}
