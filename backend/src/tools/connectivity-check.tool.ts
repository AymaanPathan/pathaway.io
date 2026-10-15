import {
  componentsLocal,
  graphOrder,
  metricMeta,
  scopedSubgraph,
  topicItem,
} from "./shared.js";
import type { DevTopic, TopicTool } from "./types.js";


export const connectivityCheckTool: TopicTool<Record<string, never>> = {
  name: "connectivity_check",
  title: "Isolated topics",
  description:
    "Finds which of the developer's topics belong to the main connected body of their knowledge and which are isolated islands with no link to their other topics or to the foundations they stand on.",
  whenToUse:
    "Isolated, disconnected, islands, orphan topics, what does not connect to anything, is my graph connected.",
  features: ["Connected components over your topic subgraph"],
  params: {},
  async run(ctx) {
    const [topics, pr, bt] = await Promise.all([
      ctx.topics(),
      ctx.pageRank(),
      ctx.betweenness(),
    ]);
    const sub = await scopedSubgraph(
      ctx.graph,
      ctx.developerId,
      topics.map((t) => t.slug),
    );

    let source: string;
    let comp: (t: DevTopic) => number | null;
    let edgeTotal = 0;
    let how: string[];
    if (sub) {
      const edges = [...sub.builds, ...sub.related];
      edgeTotal = edges.length;
      const ids = componentsLocal(sub.slugs, edges);
      comp = (t) => ids.get(t.slug) ?? null;
      source = `components over your topic subgraph (${sub.slugs.length} topics, ${edgeTotal} links)`;
      how = [
        `Built a subgraph of ${sub.slugs.length} topic(s) (yours plus their foundations) with ${sub.builds.length} BUILDS_ON and ${sub.related.length} RELATED_TOPIC link(s).`,
        "Grouped topics that are reachable from each other through those links, ignoring direction.",
      ];
    } else {
      comp = (t) => t.componentId;
      source = "persisted Topic.component_id (whole taxonomy)";
      how = [
        "Could not load your topic subgraph, so it used the stored component ids from the last analysis.",
        "Those ids are computed over the whole shared taxonomy, so a topic linked only to someone else's topic counts as connected.",
      ];
    }

    const buckets = new Map<number, DevTopic[]>();
    for (const t of topics) {
      const c = comp(t);
      if (c == null) continue;
      buckets.set(c, [...(buckets.get(c) ?? []), t]);
    }
    if (!buckets.size) {
      return {
        summary: "Connected components are unavailable.",
        facts: { source },
        blocks: [
          {
            type: "callout",
            tone: "info",
            title: "No component data",
            text: "The taxonomy has no edges yet, so every topic is trivially its own island. Re-run the analysis.",
          },
        ],
        slugs: [],
        how,
      };
    }

    const order = graphOrder(pr.scores, bt.scores);
    const comps = [...buckets.values()].sort((a, b) => b.length - a.length);
    const main = comps[0]!;
    const islands = comps.slice(1).flat().sort(order);
    const scoped = metricMeta(pr).scope === "developer" || Boolean(sub);

    return {
      summary: `${comps.length} group(s); the main body holds ${main.length} of ${topics.length} topic(s) and ${islands.length} topic(s) are isolated. Source: ${source}.`,
      facts: {
        source,
        components: comps.length,
        mainBody: main.length,
        isolated: islands.map((t) => t.name),
        links: edgeTotal,
      },
      blocks: [
        {
          type: "stats",
          items: [
            { label: "Groups", value: comps.length },
            { label: "Main body", value: main.length, hint: "topics" },
            { label: "Isolated", value: islands.length, hint: "topics" },
          ],
        },
        islands.length
          ? {
              type: "topics",
              title: "Isolated topics",
              subtitle: scoped
                ? "No link to your other topics or to the foundations they stand on"
                : "No known relation to the rest of the taxonomy",
              items: islands.map((t) => topicItem(t)),
            }
          : {
              type: "callout",
              tone: "good",
              title: "Fully connected",
              text: "Every one of your topics is linked into one connected body of knowledge.",
            },
      ],
      slugs: islands.map((t) => t.slug),
      how: [
        ...how,
        `Found ${comps.length} group(s): the largest holds ${main.length} of your ${topics.length} topic(s); ${islands.length} sit outside it.`,
      ],
    };
  },
};
