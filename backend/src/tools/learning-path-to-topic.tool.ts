import {
  bySlugMap,
  cypher,
  notFound,
  num,
  str,
} from "./shared.js";
import type { TopicTool } from "./types.js";
import { asDepthLevel } from "../graph/depth-analyzer-graph.js";


export const learningPathToTopicTool: TopicTool<{ topic: string }> = {
  name: "learning_path_to_topic",
  title: "Learning path to a topic",
  description:
    "Builds an ordered prerequisite roadmap for a target topic by traversing BUILDS_ON up to 4 hops and marking which prerequisites the developer already shows. Foundations come first.",
  whenToUse:
    "How do I get to / learn X, prerequisites of X, roadmap to X, what do I need before X.",
  features: ["Cypher BUILDS_ON*1..4 traversal", "KNOWS_TOPIC join"],
  params: {
    topic: {
      type: "string",
      description: "Target topic name or slug",
      required: true,
      defaultSelected: true,
    },
  },
  async run(ctx, args) {
    const target = await ctx.resolveTopic(args.topic);
    if (!target) return notFound(args.topic);
    const topics = await ctx.topics();
    const by = bySlugMap(topics);
    const pr = await ctx.pageRank();

    const rows =
      (await cypher(
        ctx.graph,
        "prerequisites",
        `
        MATCH path = (t:Topic {slug: $slug})-[:BUILDS_ON*1..4]->(f:Topic)
        WITH f, min(length(path)) AS hops
        OPTIONAL MATCH (:Developer {id: $dev})-[k:KNOWS_TOPIC]->(f)
        RETURN f.slug AS slug, f.name AS name, hops,
               coalesce(k.level, "") AS level, coalesce(k.level_rank, -1) AS rank
        `,
        { slug: target.slug, dev: ctx.developerId },
      )) ?? [];

    const prereqs = rows
      .map((r) => ({
        slug: str(r.slug),
        name: str(r.name),
        hops: num(r.hops, 1),
        level: str(r.level),
        rank: num(r.rank, -1),
      }))
      
      .sort(
        (a, b) =>
          b.hops - a.hops ||
          (pr.scores.get(b.slug) ?? 0) - (pr.scores.get(a.slug) ?? 0) ||
          a.name.localeCompare(b.name),
      );

    const targetCard = by.get(target.slug);
    type Step = {
      order: number; slug: string; name: string; why: string;
      assessed: boolean; level: ReturnType<typeof asDepthLevel> | null;
      status: "known" | "todo" | "target";
    };
    const steps: Step[] = prereqs.map((p, i) => {
      const known = p.rank >= 3;
      return {
        order: i + 1,
        slug: p.slug,
        name: p.name,
        assessed: p.rank >= 0,
        level: p.rank >= 0 ? asDepthLevel(p.level) : null,
        status: known ? "known" : "todo",
        why: known
          ? `You already show this (${p.level}).`
          : p.rank >= 0
            ? `Only ${p.level} so far. ${p.hops} hop${p.hops === 1 ? "" : "s"} below ${target.name}.`
            : `Not assessed yet. ${p.hops} hop${p.hops === 1 ? "" : "s"} below ${target.name}.`,
      };
    });
    steps.push({
      order: steps.length + 1,
      slug: target.slug,
      name: target.name,
      assessed: Boolean(targetCard),
      level: targetCard?.level ?? null,
      status: "target",
      why: targetCard
        ? `Your current level: ${targetCard.level}.`
        : "Not assessed yet.",
    });

    const todo = prereqs.filter((p) => p.rank < 3);
    return {
      summary: prereqs.length
        ? `${target.name} has ${prereqs.length} prerequisite topic(s); ${todo.length} still need work.`
        : `${target.name} has no recorded prerequisites in the taxonomy.`,
      facts: {
        target: target.name,
        prerequisites: prereqs.map((p) => ({
          topic: p.name,
          hops: p.hops,
          level: p.rank >= 0 ? p.level : "not assessed",
        })),
        stillToLearn: todo.map((p) => p.name),
      },
      blocks: prereqs.length
        ? [
            {
              type: "roadmap",
              title: `Path to ${target.name}`,
              steps,
            },
          ]
        : [
            {
              type: "callout",
              tone: "info",
              title: `No prerequisites for ${target.name}`,
              text: "The taxonomy has no BUILDS_ON edges below this topic, so there is nothing to learn first.",
            },
          ],
      slugs: steps.map((s) => s.slug),
    };
  },
};
