import { maxOf, round } from "./shared.js";
import type { TopicTool } from "./types.js";


export const rankFoundationsTool: TopicTool<{ limit?: number }> = {
  name: "rank_foundations",
  title: "Rank foundation topics",
  description:
    "Runs algo.pageRank over the BUILDS_ON taxonomy and ranks the developer's topics by how many other topics build on them. High = a foundation worth being solid in.",
  whenToUse:
    "Foundations, core skills, fundamentals, what everything else depends on, most important base topics.",
  features: ["algo.pageRank('Topic', 'BUILDS_ON')"],
  params: {
    limit: {
      type: "number",
      description: "How many topics to show (default 8)",
      min: 1,
      max: 15,
    },
  },
  async run(ctx, args) {
    const limit = args.limit ?? 8;
    const [topics, pr] = await Promise.all([ctx.topics(), ctx.pageRank()]);
    const max = maxOf(pr.scores) || 1;
    const ranked = topics
      .map((t) => ({ t, v: pr.scores.get(t.slug) ?? 0 }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v || a.t.name.localeCompare(b.t.name))
      .slice(0, limit);

    if (!ranked.length) {
      return {
        summary: "PageRank produced no scores for this developer's topics.",
        facts: { source: pr.source },
        blocks: [
          {
            type: "callout",
            tone: "info",
            title: "No foundation ranking yet",
            text: "The taxonomy has no BUILDS_ON edges yet, so PageRank has nothing to rank. Re-run the analysis to build them.",
          },
        ],
        slugs: [],
      };
    }

    return {
      summary: `Top foundation: ${ranked[0]!.t.name}. Computed with ${pr.source}.`,
      facts: {
        algorithm: pr.source,
        foundations: ranked.map((x) => ({
          topic: x.t.name,
          level: x.t.level,
          pageRank: round(x.v, 4),
        })),
      },
      blocks: [
        {
          type: "ranking",
          title: "Your foundations",
          subtitle: "PageRank over BUILDS_ON: many topics stand on these",
          metric: "PageRank",
          items: ranked.map((x) => ({
            slug: x.t.slug,
            name: x.t.name,
            value: x.v,
            norm: round(x.v / max, 3),
            display: round(x.v, 4).toString(),
            level: x.t.level,
            note: x.t.levelRank <= 2 ? "foundation not yet deep" : undefined,
          })),
        },
      ],
      slugs: ranked.map((x) => x.t.slug),
    };
  },
};
