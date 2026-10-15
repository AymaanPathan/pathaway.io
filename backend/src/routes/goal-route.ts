import { Router } from "express";
import { getGraphForDeveloper } from "../db/falkordb.js";
import {
  cerebrasClient,
  planGoal,
  type GoalPlan,
  type LlmClient,
} from "../agents/goal-agent.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";

export const goalRouter = Router();

const llmClient: LlmClient = cerebrasClient();
function getLlm(): LlmClient | null {
  return llmClient;
}

function explain(plan: GoalPlan) {
  const task = plan.task;
  return {
    understoodAs: {
      method: plan.resolution.method,
      confidence: plan.resolution.confidence,
      seeds: plan.resolution.seeds,
    },
    evidence: (task?.evidence ?? []).map((e) => ({
      id: e.id,
      repository: e.repository,
      path: e.path,
      technique: e.technique,
      depth: e.depth,
      commit: e.commit,
      permalink: e.permalink,
    })),
    alternatives: task?.decision.considered ?? [],
    challenge: task?.challenge ?? null,
    graph: plan.graph
      ? {
          seeds: plan.graph.seeds,
          topics: plan.graph.topics,
          evidence: plan.graph.evidence,
          codeExcerpts: plan.graph.codeExcerpts,
          operations: plan.graph.operations,
          topicNodes: plan.graph.topicNodes,
          links: plan.graph.links,
          context: plan.graph.context,
          ranking: plan.graph.ranking,
        }
      : null,
    source: plan.source,
    llmCalls: plan.llmCalls,
    timingsMs: plan.timingsMs,
    notes: plan.notes,
  };
}

goalRouter.post("/api/goal", requireAuth, async (req: AuthedRequest, res) => {
  const developerId = req.developer!.developerId;
  const raw =
    typeof req.body?.wish === "string"
      ? req.body.wish
      : typeof req.body?.goal === "string"
        ? req.body.goal
        : "";
  const wish = raw.trim();
  if (wish.length > 500)
    return res
      .status(400)
      .json({ error: "goal must be at most 500 characters" });
  if (wish.length > 0 && wish.length < 3)
    return res.status(400).json({
      error: "goal must be 3-500 characters, or empty for an automatic goal",
    });

  try {
    const graph = await getGraphForDeveloper(developerId);
    const plan = await planGoal(graph, getLlm(), { developerId, wish });

    switch (plan.status) {
      case "needs_clarification":
        return res.json({
          status: "needs_clarification",
          message:
            plan.clarification?.reason ??
            "I could not tie that to a topic in your knowledge graph.",
          suggestions: plan.clarification?.suggestions ?? [],
          explanation: explain(plan),
        });

      case "needs_evidence":
        return res.json({
          status: "needs_evidence",
          message:
            plan.clarification?.reason ??
            "The graph has no readable code for this topic yet.",
          explanation: explain(plan),
        });

      case "llm_unavailable":
        return res.status(503).json({
          status: "llm_unavailable",
          message: "The goal agent is not available right now.",
          explanation: explain(plan),
        });

      case "generation_failed":
        return res.status(502).json({
          status: "generation_failed",
          message:
            "The agent could not produce a verified goal. Try rephrasing it.",
          errors: plan.errors,
          explanation: explain(plan),
        });

      case "planned":
        break;
    }

    const t = plan.task;
    if (!t) {
      return res.status(500).json({ error: "could not generate a goal" });
    }

    return res.json({
      status: "goal",
      goal: {
        id: plan.stored?.goalId ?? null,
        title: t.title,
        steps: t.steps,
        doneWhen: t.doneWhen,
        why: t.why,
        focus: t.focus,
        targetCapability: t.targetCapability,
        startingPoint: t.startingPoint,
        challenge: t.challenge,
        evidenceIds: t.evidenceIds,
        saved: plan.stored?.stored ?? false,
      },
      explanation: explain(plan),
    });
  } catch (error) {
    console.error("[goal-route] failed", error);
    return res.status(500).json({ error: "could not generate a goal" });
  }
});
