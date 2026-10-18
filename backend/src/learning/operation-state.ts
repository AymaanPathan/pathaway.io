import type { Graph } from "../db/falkordb.js";

/**
 * Persisted, inspectable state for one graph update, keyed by mission + head SHA.
 * Evaluation outcome and graph-update outcome are tracked separately:
 *   evaluation: passed  +  graph update: failed  is a valid, visible state.
 */
export const UPDATE_STAGES = [
  "audit_stored",
  "evidence_written",
  "relationships_reconciled",
  "aggregates_rebuilt",
] as const;

export type UpdateStage = (typeof UPDATE_STAGES)[number];
export type UpdateStatus = "running" | "completed" | "failed";

export interface GraphUpdateState {
  id: string;
  missionId: string;
  headSha: string;
  status: UpdateStatus;
  stagesCompleted: UpdateStage[];
  failedStage: UpdateStage | null;
  attempts: number;
  lastError: string;
  updatedAt: string;
}

export function graphUpdateId(missionId: string, headSha: string): string {
  return `graph-update:${missionId}:${headSha}`;
}

/** First stage that has not completed yet; null when all are done. */
export function nextStage(completed: UpdateStage[]): UpdateStage | null {
  return UPDATE_STAGES.find((stage) => !completed.includes(stage)) ?? null;
}

/** Lock key for per-mission serialisation (shared by evaluation and retraction). */
export function missionLockKey(developerId: string, missionId: string): string {
  return `mission:${developerId}:${missionId}`;
}

const locks = new Map<string, Promise<unknown>>();

/** Serialises async work per key inside this process. Cross-process safety comes from idempotent MERGEs. */
export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  locks.set(key, tail);
  try {
    return await run;
  } finally {
    if (locks.get(key) === tail) locks.delete(key);
  }
}

function parseStages(raw: unknown): UpdateStage[] {
  try {
    const parsed = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(parsed)
      ? parsed.filter((s): s is UpdateStage =>
          (UPDATE_STAGES as readonly string[]).includes(String(s)),
        )
      : [];
  } catch {
    return [];
  }
}

function toState(row: any): GraphUpdateState {
  return {
    id: String(row.id ?? ""),
    missionId: String(row.missionId ?? ""),
    headSha: String(row.headSha ?? ""),
    status: (String(row.status ?? "running") as UpdateStatus) || "running",
    stagesCompleted: parseStages(row.stages),
    failedStage: row.failedStage
      ? (String(row.failedStage) as UpdateStage)
      : null,
    attempts: Number(row.attempts ?? 0),
    lastError: String(row.lastError ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

const RETURN_STATE = `
  RETURN u.id AS id, u.mission_id AS missionId, u.head_sha AS headSha,
    u.status AS status, u.stages_json AS stages, u.failed_stage AS failedStage,
    u.attempts AS attempts, u.last_error AS lastError, u.updated_at AS updatedAt`;

export async function getGraphUpdate(
  graph: Graph,
  id: string,
): Promise<GraphUpdateState | null> {
  const result = await graph.query(
    `MATCH (u:GraphUpdate {id: $id}) ${RETURN_STATE}`,
    { params: { id } },
  );
  const row = (result.data ?? [])[0];
  return row ? toState(row) : null;
}

/** Starts (or restarts) an update. Previously completed stages are kept for inspection. */
export async function beginGraphUpdate(
  graph: Graph,
  developerId: string,
  missionId: string,
  headSha: string,
): Promise<GraphUpdateState> {
  const id = graphUpdateId(missionId, headSha);
  const now = new Date().toISOString();
  await graph.query(
    `MERGE (u:GraphUpdate {id: $id})
     ON CREATE SET u.created_at = $now, u.attempts = 0, u.stages_json = "[]"
     SET u.mission_id = $mission_id, u.developer_id = $developer_id,
         u.head_sha = $head_sha, u.status = "running",
         u.attempts = coalesce(u.attempts, 0) + 1,
         u.failed_stage = "", u.last_error = "", u.updated_at = $now`,
    {
      params: {
        id,
        now,
        mission_id: missionId,
        developer_id: developerId,
        head_sha: headSha,
      },
    },
  );
  await graph.query(
    `MATCH (m:Mission {id: $mission_id}), (u:GraphUpdate {id: $id})
     MERGE (m)-[:HAS_GRAPH_UPDATE]->(u)`,
    { params: { id, mission_id: missionId } },
  );
  const state = await getGraphUpdate(graph, id);
  if (!state) throw new Error(`Could not create graph update ${id}`);
  return state;
}

export async function markStageComplete(
  graph: Graph,
  id: string,
  stage: UpdateStage,
): Promise<void> {
  const current = await getGraphUpdate(graph, id);
  const stages = new Set(current?.stagesCompleted ?? []);
  stages.add(stage);
  await graph.query(
    `MATCH (u:GraphUpdate {id: $id})
     SET u.stages_json = $stages, u.updated_at = $now`,
    {
      params: {
        id,
        stages: JSON.stringify(UPDATE_STAGES.filter((s) => stages.has(s))),
        now: new Date().toISOString(),
      },
    },
  );
}

export async function failGraphUpdate(
  graph: Graph,
  id: string,
  stage: UpdateStage | null,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await graph.query(
    `MATCH (u:GraphUpdate {id: $id})
     SET u.status = "failed", u.failed_stage = $stage,
         u.last_error = $message, u.updated_at = $now`,
    {
      params: {
        id,
        stage: stage ?? "",
        message: message.slice(0, 1000),
        now: new Date().toISOString(),
      },
    },
  );
}

export async function completeGraphUpdate(
  graph: Graph,
  id: string,
): Promise<void> {
  await graph.query(
    `MATCH (u:GraphUpdate {id: $id})
     SET u.status = "completed", u.failed_stage = "", u.last_error = "",
         u.updated_at = $now`,
    { params: { id, now: new Date().toISOString() } },
  );
}
