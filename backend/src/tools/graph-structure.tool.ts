import { connectivityCheckTool } from "./connectivity-check.tool.js";
import { findBridgesTool } from "./find-bridges.tool.js";
import { knowledgeCommunitiesTool } from "./knowledge-communities.tool.js";
import { rankFoundationsTool } from "./rank-foundations.tool.js";
import { featuresOf, pickView, tagged } from "./facade.js";
import type { TopicTool } from "./types.js";

const VIEWS = [
  "foundations",
  "bridges",
  "communities",
  "connectivity",
] as const;

export const graphStructureTool: TopicTool<{ view?: string }> = {
  name: "graph_structure",
  title: "Graph structure",
  description:
    "How the topic map is shaped, using FalkorDB algorithms. foundations: PageRank. bridges: betweenness centrality. communities: label propagation (CDLP). connectivity: weakly connected components (WCC). These describe the shared map, never the developer's skill.",
  whenToUse:
    "Which topics are foundations, which topics bridge my skills, how do my skills group together, which topics are isolated.",
  features: featuresOf([
    rankFoundationsTool,
    findBridgesTool,
    knowledgeCommunitiesTool,
    connectivityCheckTool,
  ]),
  params: {
    view: {
      type: "string",
      description:
        "foundations (default) | bridges | communities | connectivity",
      enum: [...VIEWS],
    },
  },
  async run(ctx, args) {
    switch (pickView(args.view, VIEWS, "foundations")) {
      case "bridges":
        return tagged(ctx, findBridgesTool, {});
      case "communities":
        return tagged(ctx, knowledgeCommunitiesTool, {});
      case "connectivity":
        return tagged(ctx, connectivityCheckTool, {});
      default:
        return tagged(ctx, rankFoundationsTool, {});
    }
  },
};
