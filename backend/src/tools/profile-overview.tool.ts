import { readDeveloperTopicProfile } from "../graph/depth-analyzer-graph.js";
import { graphOrder, humanize, noAnalysis, topicItem } from "./shared.js";
import type { TopicTool } from "./types.js";
import type { UiBlock } from "./ui.js";


export const profileOverviewTool: TopicTool<Record<string, never>> = {
  name: "profile_overview",
  title: "Profile overview",
  description:
    "High-level summary of the developer: how many topics, depth mix, domains with their topics, and the stored headline and pattern from the last analysis.",
  whenToUse: "Summary, overview, who am I as a developer, how many topics, my profile, general question about my skills.",
  features: ["DepthAssessment roll-up", "algo.pageRank", "algo.betweenness"],
  params: {},
  async run(ctx) {
    const [topics, pr, bt, profile] = await Promise.all([
      ctx.topics(),
      ctx.pageRank(),
      ctx.betweenness(),
      readDeveloperTopicProfile(ctx.graph, ctx.developerId),
    ]);
    if (!topics.length) return noAnalysis();

    const order = graphOrder(pr.scores, bt.scores);
    const levelCount = (l: string) => topics.filter((t) => t.level === l).length;
    const built = topics.filter((t) => t.authenticity === "genuine_implementation").length;
    const domains = new Map<string, typeof topics>();
    for (const t of topics) domains.set(t.domain, [...(domains.get(t.domain) ?? []), t]);

    const blocks: UiBlock[] = [];
    if (profile.summary?.headline)
      blocks.push({ type: "callout", tone: "info", title: profile.summary.headline, text: profile.summary.pattern || "" });
    blocks.push({
      type: "stats",
      items: [
        { label: "Topics", value: topics.length },
        { label: "Domains", value: domains.size },
        { label: "Deep", value: levelCount("deep") },
        { label: "Proficient", value: levelCount("proficient") },
        { label: "Built yourself", value: built },
      ],
    });
    blocks.push({
      type: "groups",
      title: "By domain",
      groups: [...domains.entries()]
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
        .slice(0, 8)
        .map(([d, list]) => ({
          key: d,
          label: humanize(d),
          note: `${list.length} topic${list.length === 1 ? "" : "s"}`,
          items: [...list].sort(order).map((t) => topicItem(t)),
        })),
    });

    return {
      summary: `${topics.length} topics across ${domains.size} domains: ${levelCount("deep")} deep, ${levelCount("proficient")} proficient, ${levelCount("working")} working, ${levelCount("surface")} surface; ${built} built by the developer.`,
      facts: {
        topics: topics.length,
        domains: [...domains.keys()],
        deep: levelCount("deep"),
        proficient: levelCount("proficient"),
        working: levelCount("working"),
        surface: levelCount("surface"),
        builtYourself: built,
        headline: profile.summary?.headline ?? null,
        pattern: profile.summary?.pattern ?? null,
      },
      blocks,
      slugs: [],
    };
  },
};
