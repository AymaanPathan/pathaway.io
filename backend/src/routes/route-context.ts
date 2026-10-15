import express from "express";
import { getGraphForDeveloper } from "../db/falkordb.js";
import { type CategorySkillGroup } from "../graph/skill-category-graph.js";

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
