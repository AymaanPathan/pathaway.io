import { findGapsTool } from "./find-gaps.tool.js";
import { learningPathToTopicTool } from "./learning-path-to-topic.tool.js";
import { recommendNextTopicsTool } from "./recommend-next-topics.tool.js";
import { featuresOf, pickView, tagged } from "./facade.js";
import { cypher, notFound, str } from "./shared.js";
import type { TopicTool } from "./types.js";

const VIEWS = ["gaps", "next", "path"] as const;

export const gapAnalysisTool: TopicTool<{ view?: string; topic?: string }> = {
  name: "gap_analysis",
  title: "Gaps and next steps",
  description:
    "gaps: strong topics that stand on weak or unassessed foundations, with the full BUILDS_ON chain for each. next: topics worth learning because you already know what they build on. path: the prerequisite roadmap to one target topic.",
  whenToUse:
    "Where are my gaps, what is holding me back, what should I learn next, what should I fix first, how do I get to X, what do I need before X.",
  features: featuresOf([
    findGapsTool,
    recommendNextTopicsTool,
    learningPathToTopicTool,
  ]),
  params: {
    view: {
      type: "string",
      description: "gaps (default) | next | path",
      enum: [...VIEWS],
    },
    topic: {
      type: "string",
      description: "Target topic slug. Required when view = path.",
      defaultSelected: true,
    },
  },
  async run(ctx, args) {
    const view = pickView(args.view, VIEWS, "gaps");

    if (view === "next") return tagged(ctx, recommendNextTopicsTool, {});
    if (view === "path") {
      if (!args.topic) return notFound("that topic");
      return tagged(ctx, learningPathToTopicTool, { topic: args.topic });
    }

    const base = await tagged(ctx, findGapsTool, {});
    const facts = (base.facts ?? {}) as Record<string, any>;
    const gaps: any[] = Array.isArray(facts.foundationGaps)
      ? facts.foundationGaps
      : [];
    if (!gaps.length) return base;

    /* add the full chain, so multi-hop gaps show every intermediate topic */
    const enriched = await Promise.all(
      gaps.map(async (g) => {
        const rows = await cypher(
          ctx.graph,
          "gap chain",
          `
          MATCH (a:Topic {name: $a}), (b:Topic {name: $b})
          MATCH p = shortestPath((a)-[:BUILDS_ON*1..6]->(b))
          RETURN [n IN nodes(p) | n.name] AS chain
          `,
          { a: str(g.topic), b: str(g.foundation) },
        );
        const chain = rows?.[0]?.chain;
        return Array.isArray(chain) && chain.length >= 2
          ? { ...g, chain: chain.map((x: unknown) => str(x)) }
          : g;
      }),
    );
    return { ...base, facts: { ...facts, foundationGaps: enriched } };
  },
};
