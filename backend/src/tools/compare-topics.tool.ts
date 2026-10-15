import { readTopicPath } from "../graph/depth-analyzer-graph.js";
import { humanize, LEVEL_LABEL, notFound, round, uniq } from "./shared.js";
import type { TopicTool } from "./types.js";
import type { UiBlock } from "./ui.js";


export const compareTopicsTool: TopicTool<{ topics: string }> = {
  name: "compare_topics",
  title: "Compare topics",
  description:
    "Side-by-side comparison of 2 or 3 assessed topics: level, score, authenticity, confidence, evidence volume, PageRank, betweenness and how the first two connect in the taxonomy.",
  whenToUse: "Compare X and Y, X vs Y, which is stronger, difference between my X and Y skills.",
  features: ["DepthAssessment reads", "algo.pageRank", "algo.betweenness", "Cypher shortestPath"],
  params: {
    topics: {
      type: "string",
      description: "2 or 3 topic names or slugs separated by commas",
      required: true,
    },
  },
  async run(ctx, args) {
    const parts = args.topics.split(/,|\band\b|\bvs\.?\b|\bversus\b/i).map((s) => s.trim()).filter(Boolean).slice(0, 3);
    const resolved = [];
    for (const p of parts) {
      const r = await ctx.resolveTopic(p);
      if (!r) return notFound(p);
      resolved.push(r);
    }
    const unique = uniq(resolved.map((r) => r.slug));
    if (unique.length < 2) return notFound(args.topics);

    const [topics, pr, bt] = await Promise.all([ctx.topics(), ctx.pageRank(), ctx.betweenness()]);
    const cols = unique.map((slug) => topics.find((t) => t.slug === slug)).filter((t): t is NonNullable<typeof t> => Boolean(t));
    if (cols.length < 2) {
      return {
        summary: "At least two of the requested topics must be assessed to compare them.",
        facts: { error: "not_enough_assessed" },
        blocks: [{ type: "callout", tone: "warn", title: "Can't compare yet", text: "Only assessed topics can be compared. Pick two topics from the constellation." }],
        slugs: [],
      };
    }

    const best = (vals: number[]): number | undefined => {
      const max = Math.max(...vals);
      const idx = vals.indexOf(max);
      return vals.filter((v) => v === max).length === 1 && max > 0 ? idx : undefined;
    };
    const rows = [
      { label: "Level", values: cols.map((t) => LEVEL_LABEL[t.level] ?? t.level), best: best(cols.map((t) => t.levelRank)) },
      { label: "Score", values: cols.map((t) => String(t.score)), best: best(cols.map((t) => t.score)) },
      { label: "Authenticity", values: cols.map((t) => humanize(t.authenticity)) },
      { label: "Confidence", values: cols.map((t) => humanize(t.confidence)) },
      { label: "Files", values: cols.map((t) => String(t.files)), best: best(cols.map((t) => t.files)) },
      { label: "Commits", values: cols.map((t) => String(t.commits)), best: best(cols.map((t) => t.commits)) },
      { label: "Repos", values: cols.map((t) => String(t.repos)), best: best(cols.map((t) => t.repos)) },
      { label: "Active days", values: cols.map((t) => String(t.activeDays)), best: best(cols.map((t) => t.activeDays)) },
      { label: "Last seen", values: cols.map((t) => t.lastSeen || "–") },
      { label: "PageRank", values: cols.map((t) => String(round(pr.scores.get(t.slug) ?? 0, 4))), best: best(cols.map((t) => pr.scores.get(t.slug) ?? 0)) },
      { label: "Betweenness", values: cols.map((t) => String(round(bt.scores.get(t.slug) ?? 0, 4))), best: best(cols.map((t) => bt.scores.get(t.slug) ?? 0)) },
    ];

    const blocks: UiBlock[] = [
      {
        type: "compare",
        title: cols.map((c) => c.name).join(" vs "),
        columns: cols.map((t) => ({ slug: t.slug, name: t.name, level: t.level })),
        rows,
      },
    ];
    const chain = await readTopicPath(ctx.graph, cols[0]!.slug, cols[1]!.slug).catch(() => []);
    if (chain.length >= 2) {
      blocks.push({
        type: "callout",
        tone: "info",
        title: "How they connect",
        text: `${cols[0]!.name} and ${cols[1]!.name} are ${chain.length - 1} hop(s) apart in the taxonomy.`,
      });
    }

    return {
      summary: `Compared ${cols.map((c) => `${c.name} (${c.level})`).join(", ")}.`,
      facts: {
        topics: cols.map((t) => ({
          topic: t.name,
          level: t.level,
          score: t.score,
          authenticity: t.authenticity,
          files: t.files,
          commits: t.commits,
          pageRank: round(pr.scores.get(t.slug) ?? 0, 4),
          betweenness: round(bt.scores.get(t.slug) ?? 0, 4),
        })),
        hopsApart: chain.length >= 2 ? chain.length - 1 : null,
      },
      blocks,
      slugs: cols.map((t) => t.slug),
    };
  },
};
