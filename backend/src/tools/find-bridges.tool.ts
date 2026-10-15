import { cypher, maxOf, metricMeta, num, round, str, uniq } from "./shared.js";
import type { TopicTool } from "./types.js";


export const findBridgesTool: TopicTool<{ limit?: number }> = {
  name: "find_bridges",
  title: "Find bridge topics",
  description:
    "Computes betweenness over the developer's own topic subgraph and finds topics that sit on the shortest paths between otherwise separate areas of their skills, i.e. transferable knowledge. Also reports how many knowledge communities each bridge touches.",
  whenToUse:
    "Bridges, connectors, transferable skills, what links my different areas, cross-domain topics.",
  features: [
    "Betweenness over your topic subgraph",
    "Cypher neighbour cluster lookup",
  ],
  params: {
    limit: {
      type: "number",
      description: "How many bridges to show (default 6)",
      min: 1,
      max: 12,
    },
  },
  async run(ctx, args) {
    const limit = args.limit ?? 6;
    const [topics, bt] = await Promise.all([ctx.topics(), ctx.betweenness()]);
    const meta = metricMeta(bt);
    const max = maxOf(bt.scores) || 1;
    const ranked = topics
      .map((t) => ({ t, v: bt.scores.get(t.slug) ?? 0 }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v || a.t.name.localeCompare(b.t.name))
      .slice(0, limit);

    const edgeCount = meta.builds + meta.related;
    const baseHow = [
      `Built a subgraph of ${meta.nodes} topic(s) (yours plus their foundations) with ${meta.builds} BUILDS_ON and ${meta.related} RELATED_TOPIC link(s).`,
    ];

    if (!ranked.length) {
      return {
        summary: `Betweenness found no bridge topics (${edgeCount} link(s) among ${meta.nodes} topic(s)).`,
        facts: { source: bt.source, nodes: meta.nodes, links: edgeCount },
        blocks: [
          {
            type: "callout",
            tone: "info",
            title: "No bridge topics",
            text:
              edgeCount < 3
                ? `Only ${edgeCount} link(s) connect your topics, too few for any topic to sit between two areas.`
                : "Every topic sits inside a single area; no topic lies on a shortest path between two others.",
          },
        ],
        slugs: [],
        how: [
          ...baseHow,
          "Computed shortest paths between every pair of those topics; none of your topics lay on one.",
        ],
      };
    }

    const links =
      (await cypher(
        ctx.graph,
        "bridge communities",
        `
        MATCH (t:Topic)-[:BUILDS_ON|RELATED_TOPIC]-(n:Topic)
        WHERE t.slug IN $slugs AND n.cluster_id IS NOT NULL
        RETURN t.slug AS slug, collect(DISTINCT n.cluster_id) AS clusters
        `,
        { slugs: ranked.map((x) => x.t.slug) },
      )) ?? [];
    const communities = new Map(
      links.map((r) => [
        str(r.slug),
        uniq((Array.isArray(r.clusters) ? r.clusters : []).map(num)).length,
      ]),
    );

    const scoped = meta.scope === "developer";
    return {
      summary: `Top bridge: ${ranked[0]!.t.name}. ${scoped ? `Computed over ${meta.nodes} topics in your own graph.` : "Computed over the whole shared taxonomy, not only your topics."}`,
      facts: {
        source: bt.source,
        nodes: meta.nodes,
        links: edgeCount,
        bridges: ranked.map((x) => ({
          topic: x.t.name,
          betweenness: round(x.v, 2),
          communitiesLinked: communities.get(x.t.slug) ?? 0,
        })),
      },
      blocks: [
        {
          type: "ranking",
          title: "Bridge topics",
          subtitle: scoped
            ? "Betweenness among your own topics: they sit between separate areas"
            : "Betweenness over the whole taxonomy (includes topics that are not yours)",
          metric: "Betweenness",
          items: ranked.map((x) => ({
            slug: x.t.slug,
            name: x.t.name,
            value: x.v,
            norm: round(x.v / max, 3),
            display: `${round(x.v, 2)} paths`,
            level: x.t.level,
            note: `links ${communities.get(x.t.slug) ?? 0} communit${(communities.get(x.t.slug) ?? 0) === 1 ? "y" : "ies"}`,
          })),
        },
      ],
      slugs: ranked.map((x) => x.t.slug),
      how: [
        ...baseHow,
        "Counted, for every pair of those topics, how many shortest paths pass through each topic (links treated as undirected).",
        `${ranked.length} topic(s) lie on at least one shortest path; the top one carries ${round(ranked[0]!.v, 2)} pair-path(s).`,
        "Looked up the stored community of each bridge's neighbours to count how many communities it touches.",
      ],
    };
  },
};
