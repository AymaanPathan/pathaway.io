import { Router } from "express";
import { getGraphForDeveloper } from "../db/falkordb.js";
import {
  planGoal,
  type GoalPlan,
  type LlmClient,
} from "../agents/goal-agent.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { goalSetLocks } from "./route-context.js";
import { gptOssNvidiaClient } from "../ai-models/gpt-oss-nvidia.js";

export const goalRouter = Router();

const SLUG = /^[a-z0-9_]{1,60}$/;
const MAX_GOAL_TOPICS = 4;

// Created on first use so a missing key surfaces as the agent's
// "llm_unavailable" status (HTTP 503) instead of failing at server start.
let llmClient: LlmClient | null | undefined;
function getLlm(): LlmClient | null {
  if (llmClient !== undefined) return llmClient;
  try {
    llmClient = gptOssNvidiaClient();
  } catch (error) {
    console.warn(
      "[goal-route] LLM unavailable:",
      error instanceof Error ? error.message : error,
    );
    llmClient = null;
  }
  return llmClient;
}

/** Topic slugs the client already resolved (for example a clarification suggestion). */
function cleanTopics(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim().toLowerCase())
        .filter((v) => SLUG.test(v)),
    ),
  ].slice(0, MAX_GOAL_TOPICS);
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
    // what the data showed, what the agent concluded, what has no evidence
    basis: task?.decision.basis ?? null,
    alternatives: (task?.decision.considered ?? []).map((c) => ({
      option: c.option,
      whyNot: c.whyNot,
    })),
    challenge: task?.challenge ?? null,
    // graph-backed decision trace: paths, reused code, alternatives, progression
    trace: task?.trace ?? null,
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

  const goalTopics = cleanTopics(req.body?.topics ?? req.body?.goalTopics);

  // planning replaces the stored NextMove for this goal, so never run two at once
  if (goalSetLocks.has(developerId))
    return res
      .status(409)
      .json({ error: "A goal is already being planned. Please wait." });
  goalSetLocks.add(developerId);

  try {
    const graph = await getGraphForDeveloper(developerId);
    const plan = await planGoal(graph, getLlm(), {
      developerId,
      wish,
      ...(goalTopics.length ? { goalTopics } : {}),
    });

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
        moveId: plan.stored?.nextMoveId ?? null,
        title: t.title,
        steps: t.steps,
        doneWhen: t.doneWhen,
        why: t.why,
        focus: t.focus,
        // the approach of the focus topic this move changes; null = adds a new one
        approach: t.approach,
        targetCapability: t.targetCapability,
        startingPoint: t.startingPoint,
        challenge: t.challenge,
        decision: {
          approachSlug: t.decision.approachSlug,
          capabilityId: t.decision.capabilityId,
          buildsOnSlugs: t.decision.buildsOnSlugs,
          gapSlugs: t.decision.gapSlugs,
          basis: t.decision.basis,
          reuses: t.decision.reuses,
          builds: t.decision.builds,
          whyOverAlternatives: t.decision.whyOverAlternatives,
          progression: t.decision.progression,
        },
        evidenceIds: t.evidenceIds,
        saved: plan.stored?.stored ?? false,
        saveIssues: plan.stored?.rejected ?? [],
      },
      explanation: explain(plan),
    });
  } catch (error) {
    console.error("[goal-route] failed", error);
    return res.status(500).json({ error: "could not generate a goal" });
  } finally {
    goalSetLocks.delete(developerId);
  }
});
