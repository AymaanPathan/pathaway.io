import { createHash } from "node:crypto";
import type { Graph } from "../../db/falkordb.js";




import { Domain as _constants } from './constants.js';
import { Domain as _queries } from './queries.js';
import { Domain as _readers } from './readers.js';
import { Domain as _types } from './types.js';
import { Domain as _writers } from './writers.js';

export namespace Domain {
import LOG_PREFIX = _constants.LOG_PREFIX;
import STEP_ORDER = _constants.STEP_ORDER;
import loadSavedMove = _readers.loadSavedMove;
import loadMission = _readers.loadMission;
import listGoalMissions = _readers.listGoalMissions;
import loadLatestEvaluation = _readers.loadLatestEvaluation;
import Row = _types.Row;
import GraphTraceEntry = _types.GraphTraceEntry;
import ExplanationEvidence = _types.ExplanationEvidence;
import GapCheck = _types.GapCheck;
import MissionExplanation = _types.MissionExplanation;
import TraceSpec = _types.TraceSpec;
import MissionStatus = _types.MissionStatus;
import SavedEvidence = _types.SavedEvidence;
import SavedMove = _types.SavedMove;
import MissionCriterion = _types.MissionCriterion;
import MissionContract = _types.MissionContract;
import MissionSpec = _types.MissionSpec;
import MissionRepoPin = _types.MissionRepoPin;
import StoredMission = _types.StoredMission;
import MissionStored = _types.MissionStored;
import CriterionResult = _types.CriterionResult;
import EvaluationRecord = _types.EvaluationRecord;
import storeMission = _writers.storeMission;
import markStarted = _writers.markStarted;
import markSubmitted = _writers.markSubmitted;
import markAbandoned = _writers.markAbandoned;
import recordEvaluation = _writers.recordEvaluation;
import saveWorkspace = _writers.saveWorkspace;

export function log(message: string, detail?: Row): void {
  if (detail !== undefined) console.log(`${LOG_PREFIX} ${message}`, detail);
  else console.log(`${LOG_PREFIX} ${message}`);
}

export const str = (v: unknown, fallback = ""): string =>
  v == null || typeof v === "object" ? fallback : String(v).trim();

export const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const sha8 = (s: string): string =>
  createHash("sha1").update(s).digest("hex").slice(0, 8);

export const clipText = (s: string, n: number): string =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

export function parseJson<T>(v: unknown, fallback: T): T {
  try {
    const parsed = JSON.parse(str(v));
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function describeParams(params: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string")
      out[k] = {
        type: "string",
        length: v.length,
        value: v.length > 80 ? `${v.slice(0, 80)}…` : v,
      };
    else if (Array.isArray(v)) out[k] = { type: "array", length: v.length };
    else out[k] = { type: typeof v, value: v };
  }
  return out;
}

export function sampleOf(rows: Row[]): string[] {
  return rows
    .slice(0, 6)
    .map((r) => clipText(str(Object.values(r)[0]), 80))
    .filter(Boolean);
}

export async function query(
  graph: Graph,
  label: string,
  cypher: string,
  params: Row = {},
  tr?: TraceSpec,
): Promise<Row[] | null> {
  const t0 = Date.now();
  const compact = cypher.replace(/\s+/g, " ").trim();
  const traceParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params))
    traceParams[k] = typeof v === "string" ? clipText(v, 80) : String(v);

  try {
    const result = await graph.query(cypher, { params });
    const rows = (result.data ?? []) as Row[];
    if (tr)
      tr.trace.push({
        step: tr.step,
        label,
        relationship: tr.relationship,
        cypher: clipText(compact, 500),
        params: traceParams,
        rows: rows.length,
        ms: Date.now() - t0,
        sample: sampleOf(rows),
      });
    if (process.env.MISSION_DEBUG === "1")
      log(`${label} ok`, {
        rows: rows.length,
        ms: Date.now() - t0,
        params: describeParams(params),
      });
    return rows;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (tr)
      tr.trace.push({
        step: tr.step,
        label,
        relationship: tr.relationship,
        cypher: clipText(compact, 500),
        params: traceParams,
        rows: null,
        ms: Date.now() - t0,
        sample: [],
        error: message,
      });
    log(`${label} FAILED`, {
      error: message,
      ms: Date.now() - t0,
      params: describeParams(params),
      cypher: compact.slice(0, 300),
    });
    return null;
  }
}

export async function count(
  graph: Graph,
  label: string,
  cypher: string,
  params: Row,
): Promise<number> {
  const rows = await query(graph, label, cypher, params);
  return num(rows?.[0]?.n);
}

export const EVALUABLE: MissionStatus[] = [
  "proposed",
  "in_progress",
  "submitted",
  "needs_work",
];

export async function diagnoseSavedMove(
  graph: Graph,
  dev: string,
  goal: string,
): Promise<void> {
  const p = { dev, goal_id: goal };
  const n = async (label: string, cypher: string) => {
    const rows = await query(graph, `diagnose ${label}`, cypher, p);
    return rows === null ? "QUERY ERROR" : rows.length;
  };
  const report = {
    developerExists: await n(
      "developer",
      `MATCH (d:Developer {id: $dev}) RETURN d.id AS id`,
    ),
    goalExists: await n(
      "goal",
      `MATCH (g:Goal {id: $goal_id}) RETURN g.id AS id`,
    ),
    developerOwnsGoal: await n(
      "has_goal",
      `MATCH (:Developer {id: $dev})-[:HAS_GOAL]->(g:Goal {id: $goal_id}) RETURN g.id AS id`,
    ),
    goalHasMove: await n(
      "proposes",
      `MATCH (g:Goal {id: $goal_id})-[:PROPOSES]->(m:NextMove) RETURN m.id AS id`,
    ),
  };
  const ownedGoals = await query(
    graph,
    "diagnose owned goals",
    `MATCH (:Developer {id: $dev})-[:HAS_GOAL]->(g:Goal) RETURN g.id AS id LIMIT 10`,
    p,
  );
  log("saved move NOT FOUND, link check", {
    params: describeParams(p),
    ...report,
    goalsOwnedByThisDeveloper: (ownedGoals ?? []).map((r) => r.id),
  });
}

export const MISSION_COLS = `
  m.id AS id, coalesce(m.goal_id, "") AS goal_id,
  coalesce(m.developer_id, "") AS developer_id,
  coalesce(m.next_move_id, "") AS next_move_id,
  coalesce(m.move_version, "") AS move_version,
  coalesce(m.status, "proposed") AS status,
  coalesce(m.capability_id, "") AS capability_id,
  coalesce(m.focus_slug, "") AS focus_slug,
  coalesce(m.spec_json, "") AS spec, coalesce(m.pin_json, "") AS pin,
  coalesce(m.explanation_json, "") AS explanation,
  coalesce(m.fork_repository, "") AS fork_repository,
  coalesce(m.work_branch, "") AS work_branch,
  coalesce(m.created_at, "") AS created_at,
  coalesce(m.started_at, "") AS started_at,
  coalesce(m.submitted_head, "") AS submitted_head,
  coalesce(m.completed_at, "") AS completed_at
`;

export function rowToMission(r: Row): StoredMission | null {
  const spec = parseJson<MissionSpec | null>(r.spec, null);
  const pin = parseJson<MissionRepoPin | null>(r.pin, null);
  if (!spec || !pin) {
    log("mission row skipped: spec_json or pin_json missing/invalid", {
      id: str(r.id),
      hasSpec: Boolean(spec),
      hasPin: Boolean(pin),
    });
    return null;
  }
  return {
    id: str(r.id),
    goalId: str(r.goal_id),
    developerId: str(r.developer_id),
    nextMoveId: str(r.next_move_id),
    moveVersion: str(r.move_version),
    status: (str(r.status) || "proposed") as MissionStatus,
    capabilityId: str(r.capability_id) || null,
    focusSlug: str(r.focus_slug) || null,
    spec,
    pin,
    explanation: parseJson<MissionExplanation | null>(r.explanation, null),
    forkRepository: str(r.fork_repository),
    workBranch: str(r.work_branch),
    createdAt: str(r.created_at),
    startedAt: str(r.started_at),
    submittedHead: str(r.submitted_head),
    completedAt: str(r.completed_at),
  };
}

export function newMissionId(
  goalId: string,
  moveVersion: string,
  sequence: number,
): string {
  return `mission:${goalId}:${moveVersion}:${sequence}`;
}
}
