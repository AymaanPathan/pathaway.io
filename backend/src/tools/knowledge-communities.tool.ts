import {
  cypher,
  graphOrder,
  humanize,
  num,
  str,
  taxonomyShape,
  topicItem,
  uniq,
} from "./shared.js";
import type { TopicTool } from "./types.js";


export const knowledgeCommunitiesTool: TopicTool<Record<string, never>> = {
  name: "knowledge_communities",
  title: "Knowledge communities",
  description:
    "Groups the developer's topics into communities of closely related topics with algo.labelPropagation over RELATED_TOPIC. Communities often cut across engineering domains and show what the developer actually works on together.",
  whenToUse:
    "Clusters, communities, areas of knowledge, how my skills group, what goes together, themes.",
  features: ["algo.labelPropagation (RELATED_TOPIC)"],
  params: {},
  async run(ctx) {
    const [topics, pr, bt, shape] = await Promise.all([
      ctx.topics(),
      ctx.pageRank(),
      ctx.betweenness(),
      taxonomyShape(ctx.graph),
    ]);

    let source = "persisted Topic.cluster_id";
    const live = new Map<string, number>();
    if (shape.related > 0) {
      const rows = await cypher(
        ctx.graph,
        "live labelPropagation",
        `
        CALL algo.labelPropagation({
          nodeLabels: ['Topic'],
          relationshipTypes: ['RELATED_TOPIC'],
          maxIterations: 10
        })
        YIELD node, communityId
        RETURN node.slug AS slug, communityId
        `,
      );
      for (const r of rows ?? []) live.set(str(r.slug), num(r.communityId));
      if (live.size) source = "algo.labelPropagation (RELATED_TOPIC)";
    }
    const clusterOf = (slug: string, fallback: number | null) =>
      live.size ? (live.get(slug) ?? null) : fallback;

    const buckets = new Map<number, typeof topics>();
    const loose: typeof topics = [];
    for (const t of topics) {
      const c = clusterOf(t.slug, t.clusterId);
      if (c == null) loose.push(t);
      else buckets.set(c, [...(buckets.get(c) ?? []), t]);
    }

    const order = graphOrder(pr.scores, bt.scores);
    const multi = [...buckets.entries()]
      .filter(([, list]) => list.length >= 2)
      .map(([id, list]) => {
        const sorted = [...list].sort(order);
        const domains = uniq(sorted.map((t) => t.domain));
        return {
          id,
          anchor: sorted[0]!,
          list: sorted,
          domains,
        };
      })
      .sort((a, b) => b.list.length - a.list.length);
    const singles = [...buckets.values()].filter((l) => l.length === 1).flat();
    const unclustered = [...loose, ...singles];

    if (!multi.length) {
      return {
        summary: "No multi-topic communities were found.",
        facts: { source },
        blocks: [
          {
            type: "callout",
            tone: "info",
            title: "No communities yet",
            text: "There are not enough RELATED_TOPIC links between your topics to form communities.",
          },
        ],
        slugs: [],
      };
    }

    return {
      summary: `${multi.length} knowledge communit${multi.length === 1 ? "y" : "ies"} found with ${source}; ${unclustered.length} topic(s) stand alone.`,
      facts: {
        algorithm: source,
        communities: multi.map((c) => ({
          around: c.anchor.name,
          topics: c.list.map((t) => t.name),
          domains: c.domains,
          crossDomain: c.domains.length > 1,
        })),
        standalone: unclustered.map((t) => t.name),
      },
      blocks: [
        {
          type: "groups",
          title: "Knowledge communities",
          subtitle: "Topics that belong together (label propagation)",
          groups: [
            ...multi.map((c) => ({
              key: String(c.id),
              label: `Around ${c.anchor.name}`,
              note:
                c.domains.length > 1
                  ? `Cross-domain: ${c.domains.map(humanize).join(", ")}`
                  : humanize(c.domains[0] ?? "other"),
              items: c.list.map((t) => topicItem(t)),
            })),
            ...(unclustered.length
              ? [
                  {
                    key: "standalone",
                    label: "Standalone",
                    note: "No related-topic links",
                    items: unclustered.map((t) => topicItem(t)),
                  },
                ]
              : []),
          ],
        },
      ],
      slugs: multi.flatMap((c) => c.list.map((t) => t.slug)).slice(0, 12),
    };
  },
};
