import { bySlugMap, cypher, notFound, refItem, str } from "./shared.js";
import type { TopicTool } from "./types.js";


export const exploreNeighborhoodTool: TopicTool<{ topic: string; depth?: number }> = {
  name: "explore_neighborhood",
  title: "Explore a topic's neighbourhood",
  description:
    "Breadth-first search (algo.BFS) around one topic: its foundations (BUILDS_ON), the topics that depend on it, and its related siblings, each marked with the developer's level.",
  whenToUse:
    "What is around X, what does X depend on, what depends on X, what unlocks X, topics related to X.",
  features: ["algo.BFS", "Cypher incoming BUILDS_ON traversal"],
  params: {
    topic: { type: "string", description: "Topic name or slug", required: true, defaultSelected: true },
    depth: { type: "number", description: "Search depth (default 2)", min: 1, max: 3 },
  },
  async run(ctx, args) {
    const t = await ctx.resolveTopic(args.topic);
    if (!t) return notFound(args.topic);
    const depth = Math.round(args.depth ?? 2);
    const by = bySlugMap(await ctx.topics());

    const bfs = async (rel: "BUILDS_ON" | "RELATED_TOPIC") => {
      let rows = await cypher(
        ctx.graph,
        `BFS ${rel}`,
        `
        MATCH (t:Topic {slug: $slug})
        CALL algo.BFS(t, ${depth}, '${rel}') YIELD nodes
        UNWIND nodes AS n
        RETURN DISTINCT n.slug AS slug, n.name AS name
        `,
        { slug: t.slug },
      );
      let engine = "algo.BFS";
      if (!rows) {
        rows = await cypher(
          ctx.graph,
          `traversal ${rel}`,
          `
          MATCH (t:Topic {slug: $slug})-[:${rel}*1..${depth}]->(n:Topic)
          RETURN DISTINCT n.slug AS slug, n.name AS name
          `,
          { slug: t.slug },
        );
        engine = "Cypher traversal";
      }
      return {
        engine,
        list: (rows ?? [])
          .map((r) => ({ slug: str(r.slug), name: str(r.name) }))
          .filter((r) => r.slug && r.slug !== t.slug),
      };
    };

    const [foundations, siblings] = await Promise.all([
      bfs("BUILDS_ON"),
      bfs("RELATED_TOPIC"),
    ]);
    const dependents =
      (await cypher(
        ctx.graph,
        "dependents",
        `
        MATCH (n:Topic)-[:BUILDS_ON*1..${depth}]->(t:Topic {slug: $slug})
        RETURN DISTINCT n.slug AS slug, n.name AS name
        `,
        { slug: t.slug },
      )) ?? [];
    const dep = dependents
      .map((r) => ({ slug: str(r.slug), name: str(r.name) }))
      .filter((r) => r.slug !== t.slug);

    const toItems = (list: Array<{ slug: string; name: string }>) =>
      list.map((x) => refItem(by, x.slug, x.name));

    const groups = [
      { key: "foundations", label: "Builds on", note: `${foundations.engine}, ${depth} level(s)`, items: toItems(foundations.list) },
      { key: "dependents", label: "Unlocks", note: "Topics that build on it", items: toItems(dep) },
      { key: "related", label: "Related", note: siblings.engine, items: toItems(siblings.list) },
    ].filter((g) => g.items.length);

    if (!groups.length) {
      return {
        summary: `${t.name} has no neighbours within ${depth} hop(s).`,
        facts: { topic: t.name, neighbours: 0 },
        blocks: [
          {
            type: "callout",
            tone: "info",
            title: `${t.name} stands alone`,
            text: "No BUILDS_ON or RELATED_TOPIC links were found around this topic.",
          },
        ],
        slugs: [t.slug],
      };
    }

    return {
      summary: `${t.name}: ${foundations.list.length} foundation(s), ${dep.length} dependent(s), ${siblings.list.length} related topic(s).`,
      facts: {
        topic: t.name,
        buildsOn: foundations.list.map((x) => x.name),
        unlocks: dep.map((x) => x.name),
        related: siblings.list.map((x) => x.name),
      },
      blocks: [
        {
          type: "groups",
          title: `Around ${t.name}`,
          subtitle: `Breadth-first search, ${depth} level(s)`,
          groups,
        },
      ],
      slugs: [t.slug, ...groups.flatMap((g) => g.items.map((i) => i.slug))].slice(0, 12),
    };
  },
};
