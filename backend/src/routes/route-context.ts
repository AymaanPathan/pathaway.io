import express from "express";
import { getGraphForDeveloper } from "../db/falkordb.js";
import { type CategorySkillGroup } from "../graph/skill-category-graph.js";
import {
  analyzeDeveloperDepth,
  createDepthLlmFromEnv,
} from "../agents/depth-analyzer-agent.js";
import {
  DEPTH_ANALYSIS_VERSION,
  ensureDepthSchema,
} from "../graph/depth-analyzer-graph.js";
import { onTopicsChanged } from "./topics-route.js";

export type GraphHandle = Awaited<ReturnType<typeof getGraphForDeveloper>>;
export const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";

export type OverviewJobStatus =
  | "idle"
  | "preparing"
  | "running"
  | "complete"
  | "error";
export const overviewJobs = new Map<
  string,
  {
    status: OverviewJobStatus;
    error?: string;
    startedAt?: number;
    completedAt?: number;
  }
>();
export const overviewSubscribers = new Map<string, Set<express.Response>>();
export const overviewEventHistory = new Map<string, OverviewStreamEvent[]>();
export const skillRebuildLocks = new Set<string>();
export const goalSetLocks = new Set<string>();
export const goalRescanLocks = new Set<string>();

export type OverviewStreamEvent = {
  event: "stage" | "section" | "complete" | "error";
  data: Record<string, unknown>;
};

export function sendSse(res: express.Response, event: OverviewStreamEvent) {
  if (res.writableEnded) return;
  res.write(`event: ${event.event}\n`);
  res.write(`data: ${JSON.stringify(event.data)}\n\n`);
}
export function emitOverviewEvent(
  developerId: string,
  event: OverviewStreamEvent,
) {
  const history = overviewEventHistory.get(developerId) ?? [];
  history.push(event);
  overviewEventHistory.set(developerId, history.slice(-50));
  for (const res of overviewSubscribers.get(developerId) ?? [])
    sendSse(res, event);
}
export function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
export function humanizeSkillStage(
  stage: string,
  detail?: Record<string, unknown>,
): string {
  switch (stage) {
    case "skill_analysis_start":
      return "Starting skill analysis...";
    case "skill_evidence_page":
      return `Loaded ${String(detail?.fetched ?? "")} file changes...`.replace(
        "  ",
        " ",
      );
    case "skill_evidence_loaded":
      return `Loaded ${String(detail?.files ?? "")} file changes. Classifying against the skill taxonomy...`.replace(
        "  ",
        " ",
      );
    case "skill_classified":
      return `Detected ${String(detail?.skillsFound ?? 0)} skills (${String(detail?.filesIgnored ?? 0)} lockfile/build/generated files ignored).`;
    case "skill_relationships":
      return `Linking skills: ${String(detail?.coOccurrence ?? 0)} co-usage relationships found.`;
    case "skill_analysis_complete":
      return `Skill graph ready: ${String(detail?.skillsFound ?? 0)} skills.`;
    default:
      return titleCase(stage.replace(/^skill_/, ""));
  }
}
export function humanizeOverviewStage(
  stage: string,
  detail?: Record<string, unknown>,
): string {
  if (stage === "overview_rebuild_start")
    return "Rebuilding your developer intelligence from scratch...";
  if (stage.startsWith("sync:")) {
    const inner = stage.slice(5);
    if (inner === "start") return "Syncing your latest GitHub activity...";
    if (inner.includes("complete") || inner.includes("done"))
      return "GitHub sync complete.";
    if (inner.includes("error") || inner.includes("failed"))
      return "GitHub sync failed.";
    return `Syncing GitHub — ${titleCase(inner)}...`;
  }
  if (stage.startsWith("skills:")) {
    const inner = stage.slice(7);
    if (inner === "start") return "Rebuilding your skill graph...";
    if (inner.includes("error") || inner.includes("failed"))
      return "Skill graph rebuild failed.";
    return humanizeSkillStage(inner, detail);
  }
  const messages: Record<string, string> = {
    overview_graph_start:
      "Reading your authored diffs for demonstrated capabilities...",
    overview_graph_evidence_loaded:
      "All code evidence loaded. Rolling up capability levels...",
    overview_graph_complete: "Capability graph built from your real code.",
    overview_snapshot_start: "Loading your capability graph.",
    overview_snapshot_loaded: "Graph evidence loaded.",
    overview_deterministic_start:
      "Computing skills, techniques and architecture tendencies from your graph...",
    overview_deterministic_ready: "Graph-derived profile ready.",
    overview_narrative_start: "Writing your engineering identity summary...",
    overview_narrative_ready: "Summary ready.",
    overview_agent_complete: "Developer intelligence is ready.",
  };
  if (messages[stage]) return messages[stage];
  if (stage.includes("error") || stage.includes("failed"))
    return "Developer overview generation failed.";
  return titleCase(
    stage.replace(/^overview_graph_/, "").replace(/^overview_/, ""),
  );
}
export function str(value: unknown, fallback = "") {
  return value == null ? fallback : String(value);
}
export function num(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
export function serializeSkillGroup(group: CategorySkillGroup) {
  return {
    id: group.categoryId,
    label: group.categoryName,
    score: group.categoryScore,
    skillCount: group.skills.length,
    evidenceCount: group.skills.reduce(
      (sum, skill) => sum + skill.filesTouched,
      0,
    ),
    skills: group.skills.map((skill) => ({
      slug: skill.skillId,
      name: skill.skillName,
      depthScore: skill.depthScore,
      level: skill.level,
      evidenceCount: skill.filesTouched,
      strongEvidenceCount: skill.strongFiles,
      commitsCount: skill.commitsCount,
      reposCount: skill.reposCount,
      activeDays: skill.activeDays,
      firstSeen: skill.firstSeen,
      lastSeen: skill.lastSeen,
      recencyDays: skill.recencyDays,
      trend: skill.trend,
      confidence: skill.confidence,
      evidenceQuality: skill.evidenceQuality,
      activity: skill.activity,
    })),
  };
}
export async function getGithubAccessToken(
  graph: GraphHandle,
  developerId: string,
): Promise<string> {
  const result = await graph.query(
    `MATCH (d:Developer {id: $developerId}) RETURN d.github_access_token AS token LIMIT 1`,
    { params: { developerId } },
  );
  const token = (result.data?.[0] as { token?: unknown } | undefined)?.token;
  if (!token || typeof token !== "string")
    throw new Error("No GitHub token on file. Reconnect GitHub.");
  return token;
}
export async function getDeveloperInfo(
  graph: GraphHandle,
  developerId: string,
) {
  const result = await graph.query(
    `MATCH (d:Developer {id: $id}) RETURN d.id AS developerId, d.username AS username, d.avatar_url AS avatarUrl`,
    { params: { id: developerId } },
  );
  return result.data?.[0] ?? null;
}
export async function resetOverviewIntelligenceGraph(
  graph: GraphHandle,
  developerId: string,
) {
  await graph.query(
    `MATCH (d:Developer {id: $developerId})-[:DEMONSTRATED]->(x:Demonstration) WHERE coalesce(x.source, "") <> "mission" DETACH DELETE x`,
    { params: { developerId } },
  );
  await graph.query(
    `MATCH (d:Developer {id: $developerId})-[r:HAS_CAPABILITY]->(:Capability) DELETE r`,
    { params: { developerId } },
  );
  await graph.query(
    `MATCH (d:Developer {id: $developerId})-[:AUTHORED_CODE]->(fc:FileChange) WITH DISTINCT fc.repository_id AS repository_id MATCH (:Skill)-[sr:DEMONSTRATED_IN]->(r:Repository {id: repository_id}) DELETE sr`,
    { params: { developerId } },
  );
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

const DEPTH_STAGE_MESSAGES: Record<string, string> = {
  depth_start: "Starting topic analysis...",
  depth_atlas_ready: "Evidence atlas ready.",
  depth_discovering: "Discovering the topics and approaches in your code...",
  depth_topics_proposed: "Topics proposed.",
  depth_evidence_gathered: "Gathering evidence per topic...",
  depth_refining: "Looking for more evidence...",
  depth_topic_assessed: "Judging depth...",
  depth_complete: "Topic graph ready.",
};
export function humanizeDepthStage(
  stage: string,
  detail?: Record<string, unknown>,
): string {
  if (stage === "depth_topic_assessed" && detail?.topic)
    return `Judged depth: ${String(detail.topic)}`;
  return DEPTH_STAGE_MESSAGES[stage] ?? titleCase(stage.replace(/^depth_/, ""));
}

export type DepthRefresh =
  | { status: "ready"; topics: number }
  | { status: "skipped"; topics: number }
  | { status: "failed"; error: string };

/**
 * Builds or refreshes the topic/approach graph (DepthAssessment, Approach, Topic).
 * Goal planning, topic chat and the topics API all read it, so every flow that
 * rebuilds the evidence it cites must run this afterwards.
 * force=false skips developers whose assessments are already at the current version.
 * Never throws: a failed depth step must not fail the surrounding flow.
 */
export async function refreshDepthGraph(
  graph: GraphHandle,
  developerId: string,
  send: (stage: string, detail?: Record<string, unknown>) => void,
  opts: { force: boolean },
): Promise<DepthRefresh> {
  try {
    await ensureDepthSchema(graph);
    if (!opts.force) {
      const res = await graph.query(
        `MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment)
         RETURN count(a) AS n, min(a.analysis_version) AS version`,
        { params: { dev: developerId } },
      );
      const row = (res.data?.[0] ?? {}) as Record<string, unknown>;
      const n = num(row.n);
      if (n > 0 && num(row.version) >= DEPTH_ANALYSIS_VERSION) {
        send("depth:skipped", {
          message: `Topic graph is up to date (${n} topics).`,
          topics: n,
        });
        return { status: "skipped", topics: n };
      }
    }
    const llm = createDepthLlmFromEnv();
    send("depth:start", { message: humanizeDepthStage("depth_start") });
    const result = await analyzeDeveloperDepth(graph, developerId, {
      llm,
      maxTopics: 16,
      synthesize: true,
      onProgress: (stage, detail) => {
        if (stage === "depth_files_scanned") return; // too chatty for a stream
        send(`depth:${stage}`, {
          ...(detail ?? {}),
          message: humanizeDepthStage(stage, detail ?? {}),
        });
      },
    });
    onTopicsChanged(developerId);
    send("depth:ready", {
      message: `Topic graph ready: ${result.topicsAssessed} topics assessed.`,
      topics: result.topicsAssessed,
    });
    return { status: "ready", topics: result.topicsAssessed };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[depth-refresh] failed", error);
    onTopicsChanged(developerId);
    send("depth:warning", { message: `Topic analysis failed: ${error}` });
    return { status: "failed", error };
  }
}
