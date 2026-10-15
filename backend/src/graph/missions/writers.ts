import { createHash } from "node:crypto";
import type { Graph } from "../../db/falkordb.js";




import { Domain as _constants } from './constants.js';
import { Domain as _helpers } from './helpers.js';
import { Domain as _queries } from './queries.js';
import { Domain as _readers } from './readers.js';
import { Domain as _types } from './types.js';

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

export async function storeMission(
  graph: Graph,
  saved: SavedMove,
  missionId: string,
  spec: MissionSpec,
  pin: MissionRepoPin,
  explanation: MissionExplanation | null = null,
): Promise<MissionStored> {
  const rejected: string[] = [];
  const links = {
    goal: 0,
    developer: 0,
    move: 0,
    capability: 0,
    focus: 0,
    startFile: 0,
    demonstrations: 0,
    repository: 0,
  };
  const empty: MissionStored = { stored: false, missionId, links, rejected };
  const now = new Date().toISOString();

  const capabilityId =
    saved.capability &&
    spec.expectedSkills.every(
      (s) => !s.capabilityId || s.capabilityId === saved.capability?.id,
    )
      ? saved.capability.id
      : "";

  const created = await query(
    graph,
    "create mission",
    `
    MATCH (d:Developer {id: $dev})
    MATCH (g:Goal {id: $goal_id})
    MERGE (m:Mission {id: $id})
    SET m.developer_id = $dev, m.goal_id = $goal_id,
        m.next_move_id = $move_id, m.move_version = $version,
        m.move_title = $move_title, m.move_done_when = $move_done_when,
        m.status = "proposed",
        m.title = $title, m.objective = $objective, m.summary = $summary,
        m.repository = $repo, m.branch = $branch, m.base_commit = $base,
        m.start_path = $start, m.test_command = $test_command,
        m.capability_id = $capability_id, m.focus_slug = $focus,
        m.spec_json = $spec, m.pin_json = $pin,
        m.explanation_json = $explanation,
        m.created_at = $now, m.updated_at = $now
    MERGE (g)-[:HAS_MISSION]->(m)
    MERGE (d)-[:ASSIGNED]->(m)
    RETURN count(m) AS n
    `,
    {
      dev: saved.developerId,
      goal_id: saved.goalId,
      id: missionId,
      move_id: saved.nextMoveId,
      version: saved.moveVersion,
      move_title: saved.title.slice(0, 200),
      move_done_when: saved.doneWhen.slice(0, 400),
      title: spec.title.slice(0, 200),
      objective: spec.objective.slice(0, 400),
      summary: spec.summary.slice(0, 1200),
      repo: pin.repository,
      branch: pin.branch,
      base: pin.baseCommit,
      start: spec.scope.startPath,
      test_command: pin.testCommand ?? "",
      capability_id: capabilityId,
      focus: saved.focusSlug ?? "",
      spec: JSON.stringify(spec),
      pin: JSON.stringify(pin),
      explanation: explanation ? JSON.stringify(explanation) : "",
      now,
    },
  );
  if (!created || num(created[0]?.n) === 0) {
    rejected.push("Developer or Goal node not found, nothing was written");
    return empty;
  }
  links.goal = 1;
  links.developer = 1;

  links.move = await count(
    graph,
    "FROM_MOVE",
    `MATCH (m:Mission {id: $id}) MATCH (n:NextMove {id: $move_id})
     MERGE (m)-[r:FROM_MOVE]->(n) RETURN count(r) AS n`,
    { id: missionId, move_id: saved.nextMoveId },
  );

  if (capabilityId)
    links.capability = await count(
      graph,
      "ADVANCES",
      `MATCH (m:Mission {id: $id}) MATCH (c:Capability {id: $cid})
       MERGE (m)-[r:ADVANCES]->(c) RETURN count(r) AS n`,
      { id: missionId, cid: capabilityId },
    );
  else if (saved.capability)
    rejected.push(
      "capability not linked: expectedSkills disagree with the move",
    );

  if (saved.focusSlug)
    links.focus = await count(
      graph,
      "FOCUSES_ON",
      `MATCH (m:Mission {id: $id}) MATCH (t:Topic {slug: $slug})
       MERGE (m)-[r:FOCUSES_ON]->(t) RETURN count(r) AS n`,
      { id: missionId, slug: saved.focusSlug },
    );

  if (saved.startFileChangeId)
    links.startFile = await count(
      graph,
      "STARTS_AT",
      `MATCH (m:Mission {id: $id}) MATCH (f:FileChange {id: $fid})
       MERGE (m)-[r:STARTS_AT]->(f) RETURN count(r) AS n`,
      { id: missionId, fid: saved.startFileChangeId },
    );

  const cited = new Set(spec.grounding.evidenceIds);
  const batch = saved.evidence
    .filter((e) => cited.has(e.ref) && e.demonstrationId)
    .map((e) => ({ id: e.demonstrationId, ref: e.ref }));
  if (batch.length)
    links.demonstrations = await count(
      graph,
      "BACKED_BY",
      `UNWIND $batch AS item
       MATCH (m:Mission {id: $id})
       MATCH (x:Demonstration {id: item.id})
       MERGE (m)-[r:BACKED_BY]->(x)
       SET r.ref = item.ref
       RETURN count(r) AS n`,
      { id: missionId, batch },
    );
  if (links.demonstrations < batch.length)
    rejected.push(
      `${batch.length - links.demonstrations} cited demonstration(s) no longer exist in the graph`,
    );

  links.repository = await count(
    graph,
    "IN_REPOSITORY",
    `MATCH (m:Mission {id: $id})
     MATCH (r:Repository)
     WHERE r.full_name = $repo OR r.name = $repo
     WITH m, r LIMIT 1
     MERGE (m)-[e:IN_REPOSITORY]->(r)
     RETURN count(e) AS n`,
    { id: missionId, repo: pin.repository },
  );

  log("mission stored", { missionId, ...links, rejected: rejected.length });
  return { stored: true, missionId, links, rejected };
}

export async function markStarted(
  graph: Graph,
  developerId: string,
  missionId: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  return (
    (await count(
      graph,
      "mission started",
      `MATCH (:Developer {id: $dev})-[:ASSIGNED]->(m:Mission {id: $id})
       SET m.status = "in_progress", m.started_at = $now, m.updated_at = $now
       RETURN count(m) AS n`,
      { dev: developerId, id: missionId, now },
    )) > 0
  );
}

export async function markSubmitted(
  graph: Graph,
  developerId: string,
  missionId: string,
  head: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  return (
    (await count(
      graph,
      "mission submitted",
      `MATCH (:Developer {id: $dev})-[:ASSIGNED]->(m:Mission {id: $id})
       SET m.status = "submitted", m.submitted_head = $head,
           m.submitted_at = $now, m.updated_at = $now
       RETURN count(m) AS n`,
      { dev: developerId, id: missionId, head, now },
    )) > 0
  );
}

export async function markAbandoned(
  graph: Graph,
  developerId: string,
  missionId: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  return (
    (await count(
      graph,
      "mission abandoned",
      `MATCH (:Developer {id: $dev})-[:ASSIGNED]->(m:Mission {id: $id})
       SET m.status = "abandoned", m.updated_at = $now
       RETURN count(m) AS n`,
      { dev: developerId, id: missionId, now },
    )) > 0
  );
}

export async function recordEvaluation(
  graph: Graph,
  mission: StoredMission,
  ev: EvaluationRecord,
): Promise<{
  stored: boolean;
  evaluationId: string;
  demonstrationId: string | null;
}> {
  const now = new Date().toISOString();
  const evaluationId = `evaluation:${mission.id}:${sha8(ev.headCommit)}`;

  const wrote = await count(
    graph,
    "create evaluation",
    `
    MATCH (m:Mission {id: $mid})
    MERGE (e:Evaluation {id: $eid})
    SET e.mission_id = $mid, e.developer_id = $dev, e.verdict = $verdict,
        e.head_commit = $head, e.ci_state = $ci, e.summary = $summary,
        e.results_json = $results, e.scope_warnings_json = $warnings,
        e.changed_files_json = $files, e.created_at = $now
    MERGE (m)-[:EVALUATED_AS]->(e)
    RETURN count(e) AS n
    `,
    {
      mid: mission.id,
      eid: evaluationId,
      dev: mission.developerId,
      verdict: ev.verdict,
      head: ev.headCommit,
      ci: ev.ciState,
      summary: ev.summary.slice(0, 1200),
      results: JSON.stringify(ev.results).slice(0, 8000),
      warnings: JSON.stringify(ev.scopeWarnings).slice(0, 2000),
      files: JSON.stringify(ev.changedFiles).slice(0, 4000),
      now,
    },
  );
  if (!wrote) return { stored: false, evaluationId, demonstrationId: null };

  await query(
    graph,
    "update mission status",
    `MATCH (m:Mission {id: $mid})
     SET m.status = $status, m.submitted_head = $head, m.updated_at = $now,
         m.completed_at = $completed
     RETURN count(m) AS n`,
    {
      mid: mission.id,
      status: ev.verdict,
      head: ev.headCommit,
      now,
      completed: ev.verdict === "completed" ? now : "",
    },
  );

  let demonstrationId: string | null = null;
  if (ev.verdict === "completed" && ev.demonstration) {
    const d = ev.demonstration;
    demonstrationId = `demo:${mission.id}`;
    const ok = await count(
      graph,
      "create demonstration",
      `
      MATCH (dev:Developer {id: $dev})
      MATCH (c:Capability {id: $cid})
      MERGE (x:Demonstration {id: $xid})
      SET x.technique = $technique, x.summary = $summary,
          x.depth = $depth, x.depth_rank = 2,
          x.path = $path, x.commit_sha = $sha, x.commit_subject = $subject,
          x.permalink = $permalink, x.modifiers = "",
          x.source = "mission", x.mission_id = $mid, x.created_at = $now
      MERGE (dev)-[:DEMONSTRATED]->(x)
      MERGE (x)-[:OF_CAPABILITY]->(c)
      RETURN count(x) AS n
      `,
      {
        dev: mission.developerId,
        cid: d.capabilityId,
        xid: demonstrationId,
        technique: d.technique.slice(0, 200),
        summary: d.summary.slice(0, 300),
        depth: d.depth,
        path: d.path,
        sha: ev.headCommit,
        subject: d.commitSubject.slice(0, 160),
        permalink: d.permalink,
        mid: mission.id,
        now,
      },
    );
    if (!ok) demonstrationId = null;
    else
      await query(
        graph,
        "demonstration repository",
        `MATCH (x:Demonstration {id: $xid})
         MATCH (r:Repository)
         WHERE r.full_name = $repo OR r.name = $repo
         WITH x, r LIMIT 1
         MERGE (x)-[e:IN_REPOSITORY]->(r)
         RETURN count(e) AS n`,
        { xid: demonstrationId, repo: mission.pin.repository },
      );
  }

  log("evaluation recorded", {
    missionId: mission.id,
    verdict: ev.verdict,
    demonstration: demonstrationId,
  });
  return { stored: true, evaluationId, demonstrationId };
}

export async function saveWorkspace(
  graph: Graph,
  developerId: string,
  missionId: string,
  ws: { forkRepository: string; branch: string },
): Promise<boolean> {
  const now = new Date().toISOString();
  return (
    (await count(
      graph,
      "mission workspace",
      `MATCH (:Developer {id: $dev})-[:ASSIGNED]->(m:Mission {id: $id})
       SET m.fork_repository = $fork, m.work_branch = $branch, m.updated_at = $now
       RETURN count(m) AS n`,
      {
        dev: developerId,
        id: missionId,
        fork: ws.forkRepository,
        branch: ws.branch,
        now,
      },
    )) > 0
  );
}
}
