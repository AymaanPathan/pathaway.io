import { daysSince, humanize, topicItem } from "./shared.js";
import type { TopicTool } from "./types.js";
import type { UiBlock } from "./ui.js";


export const recentActivityTool: TopicTool<{ months?: number }> = {
  name: "recent_activity",
  title: "Recent activity",
  description:
    "Shows which topics the developer touched recently (by last authored change) and which proficient or deep topics have gone quiet for over a year.",
  whenToUse: "Recent, lately, what have I been working on, stale skills, rusty topics, what went quiet.",
  features: ["DepthAssessment last_seen reads"],
  params: {
    months: { type: "number", description: "Window in months (default 6)", min: 1, max: 36 },
  },
  async run(ctx, args) {
    const months = Math.round(args.months ?? 6);
    const topics = await ctx.topics();
    const withAge = topics
      .map((t) => ({ t, age: daysSince(t.lastSeen) }))
      .filter((x): x is { t: typeof x.t; age: number } => x.age != null);

    const recent = withAge.filter((x) => x.age <= months * 30).sort((a, b) => a.age - b.age);
    const quiet = withAge.filter((x) => x.t.levelRank >= 3 && x.age > 365).sort((a, b) => b.age - a.age);
    const fmt = (d: number) => (d < 1 ? "today" : d < 30 ? `${d}d ago` : d < 365 ? `${Math.floor(d / 30)}mo ago` : `${Math.floor(d / 365)}y ago`);

    const blocks: UiBlock[] = [];
    if (recent.length) {
      const maxFiles = Math.max(...recent.map((x) => x.t.files), 1);
      blocks.push({
        type: "timeline",
        title: `Active in the last ${months} month${months === 1 ? "" : "s"}`,
        subtitle: "Most recently touched first",
        items: recent.slice(0, 10).map((x) => ({
          slug: x.t.slug,
          label: x.t.name,
          value: x.t.files / maxFiles,
          display: fmt(x.age),
          note: `${x.t.files} files · ${humanize(x.t.level)}`,
        })),
      });
    }
    if (quiet.length)
      blocks.push({
        type: "topics",
        title: "Strong but quiet",
        subtitle: "Proficient or deep, untouched for over a year",
        items: quiet.slice(0, 6).map((x) => topicItem(x.t, fmt(x.age))),
      });
    if (!blocks.length)
      blocks.push({ type: "callout", tone: "info", title: "No recent activity", text: `No topic was touched in the last ${months} month(s).` });

    return {
      summary: `${recent.length} topic(s) active in the last ${months} month(s); ${quiet.length} strong topic(s) quiet for over a year.`,
      facts: {
        windowMonths: months,
        active: recent.slice(0, 8).map((x) => `${x.t.name} (${fmt(x.age)})`),
        strongButQuiet: quiet.slice(0, 5).map((x) => `${x.t.name} (${fmt(x.age)})`),
      },
      blocks,
      slugs: [...recent.slice(0, 6), ...quiet.slice(0, 3)].map((x) => x.t.slug),
    };
  },
};
