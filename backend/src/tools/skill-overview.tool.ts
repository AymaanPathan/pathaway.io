import { auditAuthenticityTool } from "./audit-authenticity.tool.js";
import { profileOverviewTool } from "./profile-overview.tool.js";
import { recentActivityTool } from "./recent-activity.tool.js";
import { searchTopicsTool } from "./search-topics.tool.js";
import { strongestTopicsTool } from "./strongest-topics.tool.js";
import { featuresOf, pickView, tagged } from "./facade.js";
import type { TopicTool } from "./types.js";

const VIEWS = [
  "overview",
  "strongest",
  "recent",
  "authenticity",
  "search",
] as const;

export const skillOverviewTool: TopicTool<{ view?: string; query?: string }> = {
  name: "skill_overview",
  title: "Skill overview",
  description:
    "Whole-profile questions: totals and domains (overview), deepest topics (strongest), what was touched lately (recent), which ratings rest on genuine own implementations (authenticity), or finding topics by words (search).",
  whenToUse:
    "Summary, who am I as a developer, what am I strongest at, what did I work on lately, what have I built myself, do I have anything about X.",
  features: featuresOf([
    profileOverviewTool,
    strongestTopicsTool,
    recentActivityTool,
    auditAuthenticityTool,
    searchTopicsTool,
  ]),
  params: {
    view: {
      type: "string",
      description:
        "overview (default) | strongest | recent | authenticity | search",
      enum: [...VIEWS],
    },
    query: {
      type: "string",
      description: "Words to look for. Only used when view = search.",
    },
  },
  async run(ctx, args) {
    const view = pickView(args.view, VIEWS, "overview");
    switch (view) {
      case "strongest":
        return tagged(ctx, strongestTopicsTool, {});
      case "recent":
        return tagged(ctx, recentActivityTool, {});
      case "authenticity":
        return tagged(ctx, auditAuthenticityTool, {});
      case "search":
        return args.query
          ? tagged(ctx, searchTopicsTool, { query: args.query })
          : tagged(ctx, profileOverviewTool, {});
      default:
        return tagged(ctx, profileOverviewTool, {});
    }
  },
};
