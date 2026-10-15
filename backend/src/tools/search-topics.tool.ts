import { findTopicsByText } from "../graph/depth-analyzer-graph.js";
import { bySlugMap, refItem, round } from "./shared.js";
import type { TopicTool } from "./types.js";
import type { TopicItem } from "./ui.js";


export const searchTopicsTool: TopicTool<{ query: string }> = {
  name: "search_topics",
  title: "Search topics",
  description:
    "Full-text search (FalkorDB fulltext index) over topic names, descriptions and aliases, limited to topics visible in the developer's graph.",
  whenToUse: "Do I have anything about X, find topics mentioning X, which topics cover X.",
  features: ["db.idx.fulltext.queryNodes('Topic')"],
  params: { query: { type: "string", description: "Words to search for", required: true } },
  async run(ctx, args) {
    const [topics, neighbors] = await Promise.all([ctx.topics(), ctx.neighbors()]);
    const by = bySlugMap(topics);
    const hits = await findTopicsByText(ctx.graph, args.query, 20).catch(() => []);
    let engine = "fulltext index";
    let items: TopicItem[] = hits
      .filter((h) => by.has(h.slug) || neighbors.has(h.slug))
      .map((h) => ({ ...refItem(by, h.slug, neighbors.get(h.slug)?.name), note: `match ${round(h.score, 2)}` }));

    if (!items.length) {
      engine = "substring";
      const needle = args.query.toLowerCase();
      items = [
        ...topics.filter((t) => `${t.name} ${t.slug} ${t.domain}`.toLowerCase().includes(needle)).map((t) => refItem(by, t.slug)),
        ...[...neighbors.entries()].filter(([s, n]) => `${n.name} ${s}`.toLowerCase().includes(needle)).map(([s, n]) => refItem(by, s, n.name)),
      ].slice(0, 12);
    }

    return {
      summary: items.length ? `${items.length} topic(s) match "${args.query}" (${engine}).` : `No topic matches "${args.query}".`,
      facts: { query: args.query, matches: items.map((i) => `${i.name}${i.assessed ? ` (${i.level})` : " (not assessed)"}`) },
      blocks: items.length
        ? [{ type: "topics", title: `Matches for "${args.query}"`, subtitle: "Dashed = related but not assessed", items }]
        : [{ type: "callout", tone: "info", title: "No matches", text: `Nothing in your graph matches "${args.query}".` }],
      slugs: items.filter((i) => i.assessed).map((i) => i.slug),
    };
  },
};
