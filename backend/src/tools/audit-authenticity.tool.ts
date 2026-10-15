import { cypher, humanize, num, str, topicItem } from "./shared.js";
import type { TopicTool } from "./types.js";
import type { UiBlock } from "./ui.js";


export const auditAuthenticityTool: TopicTool<Record<string, never>> = {
  name: "audit_authenticity",
  title: "Authenticity audit",
  description:
    "Separates topics and approaches the developer genuinely implemented from boilerplate, incidental usage and thin evidence, using DepthAssessment authenticity, confidence and USES_APPROACH edges. Warns when almost every topic is rated the same.",
  whenToUse:
    "What have I built myself, what is real vs boilerplate, which skills are not genuine, how trustworthy is my profile, low confidence topics.",
  features: ["DepthAssessment reads", "USES_APPROACH edges"],
  params: {},
  async run(ctx) {
    const topics = await ctx.topics();
    const approaches =
      (await cypher(
        ctx.graph,
        "approach authenticity",
        `
        MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment)-[u:USES_APPROACH]->(ap:Approach)
        WHERE u.authenticity IN ["boilerplate", "incidental", "insufficient_evidence"]
        RETURN a.topic_slug AS topic, ap.name AS name, u.authenticity AS authenticity,
               coalesce(u.files, 0) AS files
        LIMIT 40
        `,
        { dev: ctx.developerId },
      )) ?? [];

    const counts: Record<string, number> = {};
    for (const t of topics)
      counts[t.authenticity] = (counts[t.authenticity] ?? 0) + 1;
    const built = topics.filter(
      (t) => t.authenticity === "genuine_implementation",
    );
    const weak = topics.filter((t) =>
      ["boilerplate", "incidental", "insufficient_evidence"].includes(
        t.authenticity,
      ),
    );
    const lowConf = topics.filter(
      (t) => t.confidence === "low" && t.files > 0 && !weak.includes(t),
    );
    const nameBy = new Map(topics.map((t) => [t.slug, t.name]));

    const strong = topics.filter((t) => t.levelRank >= 3).length;
    const uniform =
      topics.length >= 8 &&
      built.length / topics.length >= 0.8 &&
      strong / topics.length >= 0.7;

    const issues = [
      ...weak.map((t) => ({
        severity: (t.authenticity === "boilerplate" ? "high" : "medium") as
          | "high"
          | "medium",
        title: `${t.name}: ${humanize(t.authenticity)}`,
        detail:
          t.verdict ||
          "The evidence for this topic is mostly not authored implementation.",
        slugs: [t.slug],
      })),
      ...lowConf.map((t) => ({
        severity: "low" as const,
        title: `${t.name}: low confidence`,
        detail: `Only ${t.files} file(s) and ${t.commits} commit(s) back this rating.`,
        slugs: [t.slug],
      })),
      ...approaches.slice(0, 6).map((r) => ({
        severity: "low" as const,
        title: `${nameBy.get(str(r.topic)) ?? str(r.topic)} / ${str(r.name)}`,
        detail: `This approach is ${humanize(str(r.authenticity)).toLowerCase()} (${num(r.files)} file(s)).`,
        slugs: [str(r.topic)],
      })),
    ].slice(0, 10);

    const blocks: UiBlock[] = [
      {
        type: "stats",
        items: [
          { label: "Built it", value: counts.genuine_implementation ?? 0 },
          { label: "Working use", value: counts.working_usage ?? 0 },
          { label: "Incidental", value: counts.incidental ?? 0 },
          { label: "Boilerplate", value: counts.boilerplate ?? 0 },
        ],
      },
    ];
    if (uniform) {
      blocks.push({
        type: "callout",
        tone: "warn",
        title: "Ratings look unusually uniform",
        text: `${built.length} of ${topics.length} topics are rated genuine implementation and ${strong} are proficient or deep. The model judge can be generous, and topic discovery favours areas where you wrote the most code. Open the cited evidence before relying on these levels.`,
      });
    }
    if (built.length)
      blocks.push({
        type: "topics",
        title: "Genuinely implemented",
        subtitle: "You built the mechanism or made real design decisions",
        items: built.map((t) => topicItem(t)),
      });
    if (issues.length)
      blocks.push({
        type: "issues",
        title: "Worth a second look",
        items: issues,
      });
    else if (!uniform)
      blocks.push({
        type: "callout",
        tone: "good",
        title: "Looks solid",
        text: "No topic is boilerplate, incidental or thinly evidenced.",
      });

    return {
      summary: `${built.length} of ${topics.length} topic(s) genuinely implemented, ${weak.length} boilerplate/incidental/insufficient, ${lowConf.length} low confidence${uniform ? "; ratings are unusually uniform" : ""}.`,
      facts: {
        counts,
        built: built.map((t) => t.name),
        questionable: weak.map((t) => t.name),
        lowConfidence: lowConf.map((t) => t.name),
        uniformRatings: uniform,
      },
      blocks,
      slugs: [...built, ...weak, ...lowConf].map((t) => t.slug).slice(0, 12),
      how: [
        `Read the stored depth assessment of each of your ${topics.length} topic(s): authenticity, confidence, file and commit counts.`,
        `Counted ${built.length} genuine implementation(s), ${weak.length} boilerplate, incidental or insufficient, and ${lowConf.length} low-confidence topic(s).`,
        `Checked the approaches behind each assessment and found ${approaches.length} that are boilerplate, incidental or thinly evidenced.`,
        uniform
          ? `Flagged the profile as uniform: at least 80% genuine implementation and at least 70% proficient or deep.`
          : "Ratings are not uniform enough to trigger the generosity warning.",
      ],
    };
  },
};
