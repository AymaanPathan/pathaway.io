import {
  bySlugMap,
  cypher,
  graphOrder,
  num,
  round,
  str,
  topicItem,
} from "./shared.js";
import type { TopicTool } from "./types.js";
import type { UiBlock } from "./ui.js";


export const recommendNextTopicsTool: TopicTool<{ limit?: number }> = {
  name: "recommend_next_topics",
  title: "Recommend what to learn next",
  description:
    "Finds topics the developer has not been assessed on whose BUILDS_ON foundations they already show, ordered by readiness, then live PageRank and betweenness. Also lists assessed topics worth deepening.",
  whenToUse:
    "What should I learn next, roadmap, where to grow, frontier, next steps, what to focus on.",
  features: [
    "Cypher BUILDS_ON traversal",
    "KNOWS_TOPIC join",
    "algo.pageRank",
    "algo.betweenness",
  ],
  params: {
    limit: {
      type: "number",
      description: "Maximum recommendations (default 6)",
      min: 1,
      max: 12,
    },
  },
  async run(ctx, args) {
    const limit = args.limit ?? 6;
    const [topics, pr, bt] = await Promise.all([
      ctx.topics(),
      ctx.pageRank(),
      ctx.betweenness(),
    ]);
    const by = bySlugMap(topics);
    const order = graphOrder(pr.scores, bt.scores);

    const rows =
      (await cypher(
        ctx.graph,
        "frontier",
        `
        MATCH (cand:Topic)-[:BUILDS_ON]->(f:Topic)
        OPTIONAL MATCH (:Developer {id: $dev})-[k:KNOWS_TOPIC]->(f)
        RETURN cand.slug AS slug, cand.name AS name,
               f.slug AS f_slug, f.name AS f_name,
               coalesce(k.level_rank, -1) AS f_rank
        LIMIT 3000
        `,
        { dev: ctx.developerId },
      )) ?? [];

    const cands = new Map<
      string,
      { slug: string; name: string; known: string[]; total: number }
    >();
    for (const r of rows) {
      const slug = str(r.slug);
      if (!slug || by.has(slug)) continue;
      const c = cands.get(slug) ?? {
        slug,
        name: str(r.name),
        known: [],
        total: 0,
      };
      c.total += 1;
      if (num(r.f_rank, -1) >= 2) c.known.push(str(r.f_name));
      cands.set(slug, c);
    }

    const ranked = [...cands.values()]
      .filter((c) => c.known.length > 0)
      .sort(
        (a, b) =>
          b.known.length / b.total - a.known.length / a.total || order(a, b),
      )
      .slice(0, limit);

    const deepen = topics
      .filter((t) => t.levelRank === 2 || t.levelRank === 3)
      .sort(order)
      .slice(0, 4);

    const blocks: UiBlock[] = [];
    if (ranked.length) {
      blocks.push({
        type: "roadmap",
        title: "Learn next",
        steps: ranked.map((c, i) => ({
          order: i + 1,
          slug: c.slug,
          name: c.name,
          why: `Builds on ${c.known.slice(0, 3).join(", ")}. You already show ${c.known.length} of ${c.total} foundation${c.total === 1 ? "" : "s"}.`,
          assessed: false,
          level: null,
          status: "todo" as const,
        })),
      });
    }
    if (deepen.length) {
      blocks.push({
        type: "topics",
        title: "Deepen what you already use",
        subtitle: "Working or proficient topics with the most graph influence",
        items: deepen.map((t) => topicItem(t, t.level)),
      });
    }
    if (!blocks.length) {
      blocks.push({
        type: "callout",
        tone: "info",
        title: "Nothing queued",
        text: "No unassessed topic in the taxonomy builds on what you already show. Re-run the analysis after more code is synced.",
      });
    }

    return {
      summary: `${ranked.length} new topic(s) are ready to learn; ${deepen.length} existing topic(s) are worth deepening.`,
      facts: {
        learnNext: ranked.map((c) => ({
          topic: c.name,
          buildsOnKnown: c.known,
          readiness: round(c.known.length / c.total, 2),
        })),
        deepen: deepen.map((t) => ({ topic: t.name, level: t.level })),
      },
      blocks,
      slugs: [...ranked.map((c) => c.slug), ...deepen.map((t) => t.slug)],
    };
  },
};
