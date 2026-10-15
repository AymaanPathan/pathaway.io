import {
  asDepthLevel,
  readTopicDepthDetail,
} from "../graph/depth-analyzer-graph.js";
import {
  bySlugMap,
  humanize,
  LEVEL_LABEL,
  notFound,
  refItem,
} from "./shared.js";
import type { TopicTool } from "./types.js";
import type { UiBlock } from "./ui.js";


export const explainTopicTool: TopicTool<{ topic: string }> = {
  name: "explain_topic",
  title: "Explain one topic",
  description:
    "Full dossier for one assessed topic: verdict, level, evidence counts, how each approach was implemented, strengths, gaps, and where it sits in the graph (foundations, unlocks, related).",
  whenToUse:
    "Tell me about X, explain my X skills, how good am I at X, why is X rated like this, details of a topic.",
  features: [
    "DepthAssessment reads",
    "USES_APPROACH edges",
    "BUILDS_ON*1..3 traversal",
    "KNOWS_TOPIC join",
  ],
  params: {
    topic: { type: "string", description: "Topic name or slug", required: true, defaultSelected: true },
  },
  async run(ctx, args) {
    const t = await ctx.resolveTopic(args.topic);
    if (!t || !t.assessed) return notFound(args.topic);
    const detail = await readTopicDepthDetail(ctx.graph, ctx.developerId, t.slug);
    if (!detail) return notFound(args.topic);
    const by = bySlugMap(await ctx.topics());
    const s = detail.summary;

    const tone = s.level === "deep" || s.level === "proficient" ? "good" : s.level === "working" ? "info" : "warn";
    const blocks: UiBlock[] = [
      {
        type: "callout",
        tone,
        title: `${s.name} · ${LEVEL_LABEL[s.level]} (${s.score}/100)`,
        text: s.verdict || detail.rationale || "No verdict recorded.",
      },
      {
        type: "stats",
        items: [
          { label: "Files", value: s.files },
          { label: "Commits", value: s.commits },
          { label: "Repos", value: s.repos },
          { label: "Active days", value: s.activeDays },
          { label: "Confidence", value: humanize(s.confidence) },
          { label: "Authenticity", value: humanize(s.authenticity) },
        ],
      },
    ];

    if (detail.approaches.length) {
      blocks.push({
        type: "approaches",
        title: "Approaches",
        items: detail.approaches.map((a) => ({
          name: a.name,
          depth: asDepthLevel(a.depth),
          primary: a.isPrimary,
          authenticity: humanize(a.authenticity),
          how: a.howImplemented,
        })),
      });
    }
    if (detail.strengths.length)
      blocks.push({ type: "bullets", title: "Strengths", tone: "good", items: detail.strengths.slice(0, 5) });
    if (detail.gaps.length)
      blocks.push({ type: "bullets", title: "Gaps", tone: "warn", items: detail.gaps.slice(0, 5) });

    const foundations = detail.context?.foundations ?? [];
    if (foundations.length)
      blocks.push({
        type: "topics",
        title: "Builds on",
        items: foundations.map((f) => refItem(by, f.slug, f.name, f.hops > 1 ? `${f.hops} hops` : undefined)),
      });
    if (detail.unlocks.length)
      blocks.push({
        type: "topics",
        title: "Unlocks",
        items: detail.unlocks.map((u) => refItem(by, u.slug, u.name)),
      });

    return {
      summary: `${s.name} is ${s.level} (${s.score}/100, ${s.authenticity}, ${s.confidence} confidence).`,
      facts: {
        topic: s.name,
        level: s.level,
        score: s.score,
        authenticity: s.authenticity,
        confidence: s.confidence,
        verdict: s.verdict,
        strengths: detail.strengths.slice(0, 3),
        gaps: detail.gaps.slice(0, 3),
        approaches: detail.approaches.map((a) => `${a.name}: ${a.depth}${a.isPrimary ? " (primary)" : ""}`),
        buildsOn: foundations.map((f) => `${f.name} (${f.developerLevel})`),
        unlocks: detail.unlocks.map((u) => u.name),
      },
      blocks,
      slugs: [s.slug, ...foundations.map((f) => f.slug)].slice(0, 8),
    };
  },
};
