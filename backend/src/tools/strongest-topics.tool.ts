import { graphOrder, humanize, topicItem } from "./shared.js";
import type { TopicTool } from "./types.js";


export const strongestTopicsTool: TopicTool<{ minLevel?: string }> = {
  name: "strongest_topics",
  title: "Strongest topics",
  description:
    "Lists the developer's proficient and deep topics grouped by level, and flags which ones they implemented themselves. Ordering inside a level follows graph importance (PageRank, then betweenness).",
  whenToUse:
    "What am I strongest at, best skills, expert topics, what am I good at, deepest topics.",
  features: ["KNOWS_TOPIC reads", "algo.pageRank", "algo.betweenness"],
  params: {
    minLevel: {
      type: "string",
      description: "Lowest level to include (default proficient)",
      enum: ["working", "proficient", "deep"],
    },
  },
  async run(ctx, args) {
    const min = args.minLevel === "deep" ? 4 : args.minLevel === "working" ? 2 : 3;
    const [topics, pr, bt] = await Promise.all([ctx.topics(), ctx.pageRank(), ctx.betweenness()]);
    const order = graphOrder(pr.scores, bt.scores);
    const levels = ["deep", "proficient", "working"] as const;
    const rank = { deep: 4, proficient: 3, working: 2 };

    const groups = levels
      .filter((l) => rank[l] >= min)
      .map((l) => ({
        key: l,
        label: humanize(l),
        note: undefined as string | undefined,
        items: topics
          .filter((t) => t.level === l)
          .sort(order)
          .map((t) =>
            topicItem(t, t.authenticity === "genuine_implementation" ? "built it yourself" : undefined),
          ),
      }))
      .filter((g) => g.items.length);

    if (!groups.length) {
      return {
        summary: "No topics reach the requested level yet.",
        facts: { minLevel: args.minLevel ?? "proficient" },
        blocks: [
          {
            type: "callout",
            tone: "info",
            title: "Nothing at that level yet",
            text: "No topic reaches proficient depth yet. Deepen what you already use by building more of it yourself.",
          },
        ],
        slugs: [],
      };
    }
    const all = groups.flatMap((g) => g.items);
    return {
      summary: `${all.length} topic(s) at ${groups.map((g) => g.label.toLowerCase()).join(" or ")} level; ${all.filter((i) => i.note).length} implemented by the developer.`,
      facts: {
        byLevel: Object.fromEntries(groups.map((g) => [g.key, g.items.map((i) => i.name)])),
        builtYourself: all.filter((i) => i.note).map((i) => i.name),
      },
      blocks: [{ type: "groups", title: "Your strongest topics", subtitle: "Ordered by graph importance within each level", groups }],
      slugs: all.map((i) => i.slug).slice(0, 12),
    };
  },
};
