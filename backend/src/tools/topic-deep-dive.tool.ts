import { compareTopicsTool } from "./compare-topics.tool.js";
import { explainTopicTool } from "./explain-topic.tool.js";
import { featuresOf, tagged } from "./facade.js";
import { notFound } from "./shared.js";
import type { TopicTool } from "./types.js";

export const topicDeepDiveTool: TopicTool<{ topic?: string; topics?: string }> =
  {
    name: "topic_deep_dive",
    title: "Topic deep dive",
    description:
      "Everything about ONE topic (level, score, evidence confidence, approaches, what it builds on), or a side-by-side comparison of 2 to 3 topics.",
    whenToUse:
      "Explain topic X, why is X rated this way, tell me about X, compare X and Y, X versus Y.",
    features: featuresOf([explainTopicTool, compareTopicsTool]),
    params: {
      topic: {
        type: "string",
        description: "One topic slug to explain.",
        defaultSelected: true,
      },
      topics: {
        type: "string",
        description:
          "2 to 3 topic slugs, comma separated, to compare. Takes priority over topic.",
      },
    },
    async run(ctx, args) {
      const list = String(args.topics ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.length >= 2)
        return tagged(ctx, compareTopicsTool, {
          topics: list.slice(0, 3).join(", "),
        });
      if (args.topic)
        return tagged(ctx, explainTopicTool, { topic: args.topic });
      return notFound("that topic");
    },
  };
