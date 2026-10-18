import type { Graph } from "../db/falkordb.js";
import { reconcileDeveloperAggregates } from "./learning-pipeline.js";
import { missionLockKey, withLock } from "./operation-state.js";

export type RetractionScope =
  | { kind: "all"; exceptEvaluationId?: string }
  | { kind: "superseded"; keepHeadSha: string; keepEvaluationId: string };

export interface RetractionInput {
  graph: Graph;
  developerId: string;
  missionId: string;
  reason: string;
  scope?: RetractionScope;
}

export interface RetractionResult {
  /** Demonstrations deleted because nothing else supports them. */
  retractedDemonstrations: number;
  /** Demonstrations kept because another mission still verifies them. */
  keptSharedDemonstrations: number;
  /** Demonstrations kept because GitHub sync independently produced them. */
  keptGithubBackedDemonstrations: number;
  removedFileChanges: number;
  removedCommits: number;
  experiencesUpdated: number;
  capabilityRollupsUpdated: number;
}

async function rows(
  graph: Graph,
  query: string,
  params: Parameters<Graph["query"]>[1] extends { params?: infer P } | undefined
    ? NonNullable<P>
    : never,
): Promise<any[]> {
  const result = await graph.query(query, { params });
  return (result.data ?? []) as any[];
}

export async function retractMissionEvidence(
  input: RetractionInput,
): Promise<RetractionResult> {
  return withLock(missionLockKey(input.developerId, input.missionId), () =>
    retractMissionEvidenceUnlocked(input),
  );
}

/**
 * Same as retractMissionEvidence but WITHOUT taking the mission lock. Only call this
 * from code that already holds missionLockKey(developerId, missionId) (e.g.
 * processMissionEvaluation); otherwise use retractMissionEvidence.
 */
export async function retractMissionEvidenceUnlocked(
  input: RetractionInput,
): Promise<RetractionResult> {
  const { graph, developerId, missionId, reason } = input;
  const scope: RetractionScope = input.scope ?? { kind: "all" };
  const now = new Date().toISOString();
  const keepSha = scope.kind === "superseded" ? scope.keepHeadSha : "";
  const keepEval =
    scope.kind === "superseded"
      ? scope.keepEvaluationId
      : (scope.exceptEvaluationId ?? "");

  // 1. Everything this mission verified (edge-based, plus legacy mission_id-only nodes).
  const viaEdge =
    scope.kind === "all"
      ? await rows(
          graph,
          `MATCH (x:Demonstration {developer_id:$developer_id})-[:VERIFIED_BY_MISSION]->(:Mission {id:$mission_id})
           RETURN x.id AS id`,
          { developer_id: developerId, mission_id: missionId },
        )
      : await rows(
          graph,
          `MATCH (x:Demonstration {developer_id:$developer_id})-[v:VERIFIED_BY_MISSION]->(:Mission {id:$mission_id})
           WHERE coalesce(v.evaluation_id, "") <> $keep_eval
           RETURN x.id AS id`,
          {
            developer_id: developerId,
            mission_id: missionId,
            keep_eval: keepEval,
          },
        );
  const viaProperty = await rows(
    graph,
    `MATCH (x:Demonstration {developer_id:$developer_id, source:"mission", mission_id:$mission_id})
     WHERE $keep_sha = "" OR coalesce(x.commit_sha, "") <> $keep_sha
     RETURN x.id AS id`,
    { developer_id: developerId, mission_id: missionId, keep_sha: keepSha },
  );
  const affected = [
    ...new Set([...viaEdge, ...viaProperty].map((row) => String(row.id))),
  ];

  // 2. Remove this mission's (matching) verification edges.
  await graph.query(
    `MATCH (:Demonstration {developer_id:$developer_id})-[v:VERIFIED_BY_MISSION]->(:Mission {id:$mission_id})
     WHERE $keep_eval = "" OR coalesce(v.evaluation_id, "") <> $keep_eval
     DELETE v`,
    {
      params: {
        developer_id: developerId,
        mission_id: missionId,
        keep_eval: scope.kind === "superseded" ? keepEval : "",
      },
    },
  );

  // 3. Classify what is left supporting each affected demonstration.
  const keepShared: Array<{ id: string; mission_id: string }> = [];
  const demoteToGithub: string[] = [];
  const remove: string[] = [];
  if (affected.length) {
    const state = await rows(
      graph,
      `UNWIND $ids AS id
       MATCH (x:Demonstration {id:id})
       OPTIONAL MATCH (x)-[:VERIFIED_BY_MISSION]->(m:Mission)
       WITH x, collect(DISTINCT m.id) AS missions
       OPTIONAL MATCH (x)-[:EVIDENCED_BY]->(fc:FileChange)
       RETURN x.id AS id, missions, coalesce(x.github_backed, false) AS backed,
         collect(DISTINCT fc.source) AS fc_sources`,
      { ids: affected },
    );
    for (const row of state) {
      const id = String(row.id);
      const missions = ((row.missions ?? []) as unknown[])
        .filter(Boolean)
        .map(String);
      const githubBacked =
        Boolean(row.backed) ||
        ((row.fc_sources ?? []) as unknown[])
          .map(String)
          .includes("github_mcp");
      if (missions.length) keepShared.push({ id, mission_id: missions[0] });
      else if (githubBacked) demoteToGithub.push(id);
      else remove.push(id);
    }
  }

  if (keepShared.length)
    await graph.query(
      `UNWIND $rows AS item MATCH (x:Demonstration {id:item.id})
       SET x.mission_id = item.mission_id`,
      { params: { rows: keepShared } },
    );
  if (demoteToGithub.length)
    await graph.query(
      `MATCH (x:Demonstration) WHERE x.id IN $ids
       SET x.source = "github", x.mission_id = null, x.github_backed = true`,
      { params: { ids: demoteToGithub } },
    );
  if (remove.length)
    await graph.query(
      `MATCH (x:Demonstration) WHERE x.id IN $ids DETACH DELETE x`,
      { params: { ids: remove } },
    );

  // 4. Mission-created source rows that no demonstration needs any more.
  const shaRows = await rows(
    graph,
    `MATCH (:Mission {id:$mission_id})-[:EVALUATED_AS]->(e:Evaluation)
     RETURN e.head_commit AS sha`,
    { mission_id: missionId },
  );
  const shas = shaRows
    .map((row) => String(row.sha ?? ""))
    .filter((sha) => sha && sha !== keepSha);

  const removedFiles = await rows(
    graph,
    `MATCH (fc:FileChange {developer_id:$developer_id, source:"mission", mission_id:$mission_id})
     WHERE $keep_sha = "" OR coalesce(fc.commit_sha, "") <> $keep_sha
     OPTIONAL MATCH (fc)-[:PRODUCED]->(x:Demonstration)
     WITH fc, count(x) AS produced
     WHERE produced = 0
     WITH fc, fc.id AS id
     DETACH DELETE fc
     RETURN count(id) AS n`,
    { developer_id: developerId, mission_id: missionId, keep_sha: keepSha },
  );
  // Only commits this module created (no evidence_status: GitHub sync always sets one).
  const removedCommits = shas.length
    ? await rows(
        graph,
        `MATCH (c:Commit {developer_id:$developer_id, source:"mission"})
         WHERE c.sha IN $shas AND c.evidence_status IS NULL
           AND NOT (c)-[:CHANGED]->(:FileChange)
         WITH c, c.id AS id
         DETACH DELETE c
         RETURN count(id) AS n`,
        { developer_id: developerId, shas },
      )
    : [];

  // 5. Keep the audit trail but flag the affected evaluations as retracted.
  await graph.query(
    `MATCH (:Mission {id:$mission_id})-[:EVALUATED_AS]->(e:Evaluation)
     WHERE e.id <> $keep_eval AND ($keep_sha = "" OR coalesce(e.head_commit, "") <> $keep_sha)
     SET e.retracted = true, e.retracted_at = $now, e.retraction_reason = $reason`,
    {
      params: {
        mission_id: missionId,
        keep_eval: keepEval,
        keep_sha: keepSha,
        now,
        reason: reason.slice(0, 500),
      },
    },
  );
  if (scope.kind === "all") {
    // A retracted mission must not keep looking verified or completed.
    await graph.query(
      `MATCH (m:Mission {id:$mission_id})
       SET m.evidence_retracted_at = $now, m.updated_at = $now,
           m.verified = false, m.completed_at = "",
           m.verification_state = CASE WHEN m.verification_state = "verified" THEN "evaluated" ELSE m.verification_state END,
           m.status = CASE WHEN m.status = "completed" THEN "needs_work" ELSE m.status END`,
      { params: { mission_id: missionId, now } },
    );
  }

  // 6. Recompute every derived aggregate from what is still supported.
  const aggregates = await reconcileDeveloperAggregates(graph, developerId);

  return {
    retractedDemonstrations: remove.length,
    keptSharedDemonstrations: keepShared.length,
    keptGithubBackedDemonstrations: demoteToGithub.length,
    removedFileChanges: Number(removedFiles[0]?.n ?? 0),
    removedCommits: Number(removedCommits[0]?.n ?? 0),
    experiencesUpdated: aggregates.experiencesUpdated,
    capabilityRollupsUpdated: aggregates.capabilityRollupsUpdated,
  };
}
