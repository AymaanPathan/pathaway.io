import { createHash } from "node:crypto";
import type { Graph } from "../../db/falkordb.js";




import { Domain as _constants } from './constants.js';
import { Domain as _helpers } from './helpers.js';
import { Domain as _queries } from './queries.js';
import { Domain as _types } from './types.js';
import { Domain as _writers } from './writers.js';

export namespace Domain {
import LOG_PREFIX = _constants.LOG_PREFIX;
import STEP_ORDER = _constants.STEP_ORDER;
import log = _helpers.log;
import str = _helpers.str;
import num = _helpers.num;
import sha8 = _helpers.sha8;
import clipText = _helpers.clipText;
import parseJson = _helpers.parseJson;
import describeParams = _helpers.describeParams;
import sampleOf = _helpers.sampleOf;
import query = _helpers.query;
import count = _helpers.count;
import EVALUABLE = _helpers.EVALUABLE;
import diagnoseSavedMove = _helpers.diagnoseSavedMove;
import MISSION_COLS = _helpers.MISSION_COLS;
import rowToMission = _helpers.rowToMission;
import newMissionId = _helpers.newMissionId;
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

export async function loadSavedMove(
  graph: Graph,
  developerId: string,
  goalId: string,
): Promise<SavedMove | null> {
  const trace: GraphTraceEntry[] = [];
  const spec = (step: string, relationship: string): TraceSpec => ({
    trace,
    step,
    relationship,
  });

  const head = await query(
    graph,
    "saved move",
    `
    MATCH (:Developer {id: $dev})-[:HAS_GOAL]->(g:Goal {id: $goal_id})-[:PROPOSES]->(m:NextMove)
    RETURN m.id AS id, g.wish AS wish, coalesce(m.title, "") AS title,
           coalesce(m.summary, "") AS summary, coalesce(m.done_when, "") AS done_when,
           coalesce(m.created_at, "") AS created_at,
           coalesce(m.details_json, "{}") AS details
    LIMIT 1
    `,
    { dev: developerId, goal_id: goalId },
    spec(
      "goal_and_move",
      "(Developer)-[:HAS_GOAL]->(Goal)-[:PROPOSES]->(NextMove)",
    ),
  );
  if (head === null) {
    // the query itself failed (see the "saved move FAILED" log above);
    // do not report that as "goal not found"
    throw new Error(
      "loadSavedMove: graph query failed, see [mission-graph] logs",
    );
  }
  const h = head[0];
  if (!h) {
    await diagnoseSavedMove(graph, developerId, goalId);
    return null;
  }
  const moveId = str(h.id);

  const [focus, cap, start, strengths, gaps, demos, files] = await Promise.all([
    query(
      graph,
      "move focus",
      `MATCH (:NextMove {id: $id})-[:FOCUSES_ON]->(t:Topic) RETURN t.slug AS slug LIMIT 1`,
      { id: moveId },
      spec("focus", "(NextMove)-[:FOCUSES_ON]->(Topic)"),
    ),
    query(
      graph,
      "move capability",
      `MATCH (:NextMove {id: $id})-[:ADVANCES]->(c:Capability)
       RETURN c.id AS id, coalesce(c.name, c.id) AS name LIMIT 1`,
      { id: moveId },
      spec("capability", "(NextMove)-[:ADVANCES]->(Capability)"),
    ),
    query(
      graph,
      "move start file",
      `MATCH (:NextMove {id: $id})-[:STARTS_AT]->(f:FileChange) RETURN f.id AS id LIMIT 1`,
      { id: moveId },
      spec("start_file", "(NextMove)-[:STARTS_AT]->(FileChange)"),
    ),
    query(
      graph,
      "move strengths",
      `MATCH (:NextMove {id: $id})-[:LEVERAGES]->(t:Topic) RETURN t.slug AS slug`,
      { id: moveId },
      spec("strengths", "(NextMove)-[:LEVERAGES]->(Topic)"),
    ),
    query(
      graph,
      "move gaps",
      `MATCH (:NextMove {id: $id})-[:CLOSES_GAP_IN]->(t:Topic) RETURN t.slug AS slug`,
      { id: moveId },
      spec("gaps", "(NextMove)-[:CLOSES_GAP_IN]->(Topic)"),
    ),
    query(
      graph,
      "move demonstrations",
      `
      MATCH (:NextMove {id: $id})-[b:BACKED_BY]->(x:Demonstration)
      OPTIONAL MATCH (x)-[:IN_REPOSITORY]->(r:Repository)
      RETURN coalesce(b.ref, "") AS ref, x.id AS id,
             coalesce(r.full_name, r.name, "") AS repository,
             coalesce(x.path, "") AS path,
             coalesce(x.commit_sha, "") AS commit_sha,
             coalesce(x.technique, "") AS technique,
             coalesce(x.summary, "") AS summary,
             coalesce(x.permalink, "") AS permalink
      `,
      { id: moveId },
      spec(
        "evidence",
        "(NextMove)-[:BACKED_BY]->(Demonstration)-[:IN_REPOSITORY]->(Repository)",
      ),
    ),
    query(
      graph,
      "move file changes",
      `MATCH (:NextMove {id: $id})-[b:BACKED_BY]->(f:FileChange)
       RETURN coalesce(b.ref, "") AS ref, f.id AS id`,
      { id: moveId },
      spec("evidence_files", "(NextMove)-[:BACKED_BY]->(FileChange)"),
    ),
  ]);

  log("saved move loaded", {
    goalId,
    nextMoveId: moveId,
    focus: focus?.[0]?.slug ?? null,
    capability: cap?.[0]?.id ?? null,
    startFile: start?.[0]?.id ?? null,
    strengths: strengths?.length ?? 0,
    gaps: gaps?.length ?? 0,
    demonstrations: demos?.length ?? 0,
    fileChanges: files?.length ?? 0,
  });

  trace.sort((a, b) => STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step));

  const fileByRef = new Map((files ?? []).map((r) => [str(r.ref), str(r.id)]));
  const createdAt = str(h.created_at);
  const title = str(h.title);

  return {
    developerId,
    goalId,
    wish: str(h.wish),
    nextMoveId: moveId,
    moveVersion: sha8(`${moveId}|${createdAt}|${title}`),
    title,
    summary: str(h.summary),
    doneWhen: str(h.done_when),
    createdAt,
    details: parseJson<Row>(h.details, {}),
    focusSlug: focus?.[0] ? str(focus[0].slug) : null,
    capability: cap?.[0]
      ? { id: str(cap[0].id), name: str(cap[0].name) }
      : null,
    startFileChangeId: start?.[0] ? str(start[0].id) : null,
    strengthSlugs: (strengths ?? []).map((r) => str(r.slug)).filter(Boolean),
    gapSlugs: (gaps ?? []).map((r) => str(r.slug)).filter(Boolean),
    evidence: (demos ?? []).map((r) => ({
      ref: str(r.ref),
      demonstrationId: str(r.id),
      fileChangeId: fileByRef.get(str(r.ref)) ?? "",
      repository: str(r.repository),
      path: str(r.path),
      commitSha: str(r.commit_sha),
      technique: str(r.technique),
      summary: str(r.summary).slice(0, 300),
      permalink: str(r.permalink),
    })),
    trace,
  };
}

export async function loadMission(
  graph: Graph,
  developerId: string,
  missionId: string,
): Promise<StoredMission | null> {
  const rows = await query(
    graph,
    "load mission",
    `MATCH (:Developer {id: $dev})-[:ASSIGNED]->(m:Mission {id: $id})
     RETURN ${MISSION_COLS} LIMIT 1`,
    { dev: developerId, id: missionId },
  );
  return rows?.[0] ? rowToMission(rows[0]) : null;
}

export async function listGoalMissions(
  graph: Graph,
  developerId: string,
  goalId: string,
): Promise<StoredMission[]> {
  const rows = await query(
    graph,
    "list goal missions",
    `MATCH (:Goal {id: $goal_id})-[:HAS_MISSION]->(m:Mission)
     WHERE m.developer_id = $dev
     RETURN ${MISSION_COLS}
     ORDER BY m.created_at DESC`,
    { dev: developerId, goal_id: goalId },
  );
  return (rows ?? [])
    .map(rowToMission)
    .filter((m): m is StoredMission => m !== null);
}

export async function loadLatestEvaluation(
  graph: Graph,
  developerId: string,
  missionId: string,
): Promise<EvaluationRecord | null> {
  const rows = await query(
    graph,
    "latest evaluation",
    `MATCH (:Developer {id: $dev})-[:ASSIGNED]->(:Mission {id: $id})-[:EVALUATED_AS]->(e:Evaluation)
     RETURN coalesce(e.verdict, "needs_work") AS verdict,
            coalesce(e.head_commit, "") AS head,
            coalesce(e.ci_state, "none") AS ci,
            coalesce(e.summary, "") AS summary,
            coalesce(e.results_json, "[]") AS results,
            coalesce(e.scope_warnings_json, "[]") AS warnings,
            coalesce(e.changed_files_json, "[]") AS files
     ORDER BY e.created_at DESC
     LIMIT 1`,
    { dev: developerId, id: missionId },
  );
  const r = rows?.[0];
  if (!r) return null;
  return {
    missionId,
    developerId,
    headCommit: str(r.head),
    verdict: str(r.verdict) === "completed" ? "completed" : "needs_work",
    ciState: (str(r.ci) || "none") as EvaluationRecord["ciState"],
    results: parseJson<CriterionResult[]>(r.results, []),
    scopeWarnings: parseJson<string[]>(r.warnings, []),
    changedFiles: parseJson<string[]>(r.files, []),
    summary: str(r.summary),
    demonstration: null,
  };
}
}
