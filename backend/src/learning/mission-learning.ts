import type { Graph } from "../db/falkordb.js";
import type { EvaluationOutcome } from "../evaluations/mission-evaluation-agent.js";
import type { Demonstration } from "../graph/developer-knowledge-graph.js";
import type {
  LearningContext,
  LearningFileChange,
} from "./evidence-extractor.js";
import type { LearningReasoner } from "./learning-agent.js";
import {
  runLearningPipeline,
  type LearningPipelineResult,
} from "./learning-pipeline.js";
import {
  evaluationCiState,
  verifyMissionOutcome,
  type VerificationDecision,
} from "./verification-gate.js";
import {
  beginGraphUpdate,
  completeGraphUpdate,
  failGraphUpdate,
  getGraphUpdate,
  graphUpdateId,
  markStageComplete,
  missionLockKey,
  nextStage,
  withLock,
  type GraphUpdateState,
  type UpdateStage,
} from "./operation-state.js";
import { assertGraphInvariants } from "./graph-invariants.js";

export interface MissionChangedFile {
  path: string;
  status: string;
  patch: string;
}

export interface MissionLearningInput {
  graph: Graph;
  developerId: string;
  missionId: string;
  repositoryFullName: string;
  headSha: string;
  commitMessage: string;
  changedFiles: MissionChangedFile[];
  outcome: EvaluationOutcome;
  /** Test/DI seams. Production callers leave these unset. */
  reasoner?: LearningReasoner;
  extractor?: (
    fileChanges: LearningFileChange[],
    contextByCommit: Map<string, LearningContext>,
  ) => Demonstration[];
  /** Defaults to on; set PATHWAY_ASSERT_INVARIANTS=0 to disable globally. */
  assertInvariants?: boolean;
}

export interface MissionLearningResult {
  /** Did the evaluation audit land in the graph? */
  evaluationStored: boolean;
  /** Result of the single shared verification gate. */
  verification: VerificationDecision;
  evidenceStatus:
    | "updated"
    | "not_verified"
    | "no_evidence"
    | "repository_missing"
    | "graph_update_failed";
  learning: LearningPipelineResult | null;
  /**
   * Graph-update state, reported separately from the evaluation verdict.
   * `evaluation passed` + `graphUpdate.status === "failed"` is a retryable state:
   * call processMissionEvaluation again with the same input.
   */
  graphUpdate: GraphUpdateState | null;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  rb: "Ruby",
  php: "PHP",
  cs: "C#",
  cpp: "C++",
  c: "C",
  h: "C",
  sql: "SQL",
  sh: "Shell",
  bash: "Shell",
  json: "JSON",
};

function languageFor(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGE_BY_EXTENSION[extension] ?? "";
}

function addedCodeFromPatch(patch: string): string {
  return patch
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
}

async function storeEvaluationAudit(
  input: MissionLearningInput,
  verification: VerificationDecision,
): Promise<boolean> {
  const { graph, developerId, missionId, headSha, outcome, changedFiles } =
    input;
  const now = new Date().toISOString();
  const result = await graph.query(
    `
    MATCH (d:Developer {id: $developer_id})-[:ASSIGNED]->(m:Mission {id: $mission_id})
    MERGE (e:Evaluation {id: $evaluation_id})
    SET e.mission_id = $mission_id,
        e.developer_id = $developer_id,
        e.verdict = $verdict,
        e.head_commit = $head_sha,
        e.ci_state = $ci_state,
        e.summary = $summary,
        e.results_json = $results_json,
        e.scope_warnings_json = $warnings_json,
        e.changed_files_json = $files_json,
        e.overall = $overall,
        e.verified = $verified,
        e.verification_reasons_json = $reasons_json,
        e.created_at = coalesce(e.created_at, $now),
        e.updated_at = $now
    MERGE (m)-[:EVALUATED_AS]->(e)
    SET m.status = $verdict,
        m.verified = $verified,
        m.submitted_head = $head_sha,
        m.updated_at = $now,
        m.completed_at = CASE WHEN $verdict = "completed" AND $verified THEN $now ELSE "" END
    RETURN count(e) AS n`,
    {
      params: {
        developer_id: developerId,
        mission_id: missionId,
        evaluation_id: evaluationIdFor(missionId, headSha),
        verdict: outcome.verdict,
        head_sha: headSha,
        ci_state: evaluationCiState(outcome),
        summary: outcome.summary.slice(0, 1200),
        results_json: JSON.stringify(outcome.results).slice(0, 8000),
        warnings_json: JSON.stringify(
          outcome.issues.map((issue) => `${issue.title}: ${issue.detail}`),
        ).slice(0, 3000),
        files_json: JSON.stringify(changedFiles.map((file) => file.path)).slice(
          0,
          4000,
        ),
        overall: outcome.overall,
        verified: verification.verified,
        reasons_json: JSON.stringify(verification.reasons).slice(0, 2000),
        now,
      },
    },
  );
  return Number((result.data?.[0] as { n?: unknown } | undefined)?.n ?? 0) > 0;
}

export function evaluationIdFor(missionId: string, headSha: string): string {
  return `evaluation:${missionId}:${headSha}`;
}

/**
 * Post-evaluation learning flow.
 *  1. One shared gate decides whether the outcome may create capability evidence.
 *  2. The evaluation audit is always stored.
 *  3. Verified outcomes write Commit/FileChange/Demonstration evidence through the
 *     retry-safe pipeline, with every stage persisted on a GraphUpdate node.
 * Calling this again with the same input (a retry, a duplicate submission, a concurrent
 * run) converges to the same graph state.
 */
export async function processMissionEvaluation(
  input: MissionLearningInput,
): Promise<MissionLearningResult> {
  return withLock(missionLockKey(input.developerId, input.missionId), () =>
    runMissionEvaluation(input),
  );
}

async function runMissionEvaluation(
  input: MissionLearningInput,
): Promise<MissionLearningResult> {
  const { graph, developerId, missionId, headSha } = input;
  const verification = verifyMissionOutcome({
    outcome: input.outcome,
    headSha,
    changedFilePaths: input.changedFiles.map((file) => file.path),
  });
  const updateId = graphUpdateId(missionId, headSha);
  const completed: UpdateStage[] = [];
  const finish = async (
    evidenceStatus: MissionLearningResult["evidenceStatus"],
    learning: LearningPipelineResult | null,
  ): Promise<MissionLearningResult> => ({
    evaluationStored: true,
    verification,
    evidenceStatus,
    learning,
    graphUpdate: await getGraphUpdate(graph, updateId),
  });

  await beginGraphUpdate(graph, developerId, missionId, headSha);

  const evaluationStored = await storeEvaluationAudit(input, verification);
  if (!evaluationStored) {
    const error = new Error(
      `Could not persist evaluation for mission ${missionId}; developer/mission graph link is missing`,
    );
    await failGraphUpdate(graph, updateId, "audit_stored", error);
    throw error;
  }
  await markStageComplete(graph, updateId, "audit_stored");
  completed.push("audit_stored");

  if (!verification.verified) {
    await completeGraphUpdate(graph, updateId);
    return finish("not_verified", null);
  }

  try {
    const repoResult = await graph.query(
      `
      MATCH (r:Repository)
      WHERE coalesce(r.full_name, "") = $repository
         OR coalesce(r.name, "") = $repository
      RETURN r.id AS id, coalesce(r.full_name, r.name, $repository) AS full_name
      LIMIT 1`,
      { params: { repository: input.repositoryFullName } },
    );
    const repoRow = (repoResult.data ?? [])[0] as
      | { id?: unknown; full_name?: unknown }
      | undefined;
    const repositoryId = repoRow?.id == null ? "" : String(repoRow.id);
    const fullName =
      repoRow?.full_name == null
        ? input.repositoryFullName
        : String(repoRow.full_name);
    if (!repositoryId) {
      console.warn(
        "[mission-learning] verified evaluation stored, but canonical repository node was not found",
        { missionId, repository: input.repositoryFullName },
      );
      await failGraphUpdate(
        graph,
        updateId,
        nextStage(completed),
        "canonical repository node not found; retry after the repository is synced",
      );
      return finish("repository_missing", null);
    }

    const now = new Date().toISOString();
    const commitId = `${repositoryId}:commit:${headSha}`;
    await graph.query(
      `
      MERGE (c:Commit {id: $commit_id})
      SET c.sha = $sha, c.message = coalesce(c.message, $message),
          c.subject = coalesce(c.subject, $subject),
          c.repository_id = $repository_id, c.developer_id = $developer_id,
          c.date = coalesce(c.date, $now), c.source = coalesce(c.source, "mission")
      WITH c
      MATCH (r:Repository {id: $repository_id})
      MERGE (c)-[:IN_REPOSITORY]->(r)
      WITH c
      MATCH (d:Developer {id: $developer_id})
      MERGE (d)-[:MADE]->(c)
      RETURN count(c) AS n`,
      {
        params: {
          commit_id: commitId,
          sha: headSha,
          message: input.commitMessage,
          subject: input.commitMessage.split("\n")[0].slice(0, 160),
          repository_id: repositoryId,
          developer_id: developerId,
          now,
        },
      },
    );

    const rows = input.changedFiles.map((file) => ({
      id: `${repositoryId}:commit:${headSha}:file:${file.path}`,
      path: file.path,
      language: languageFor(file.path),
      patch: file.patch ?? "",
      added_code: addedCodeFromPatch(file.patch ?? ""),
      status: file.status || "modified",
      commit_sha: headSha,
      commit_id: commitId,
      repository_id: repositoryId,
      developer_id: developerId,
      created_at: now,
      mission_id: missionId,
    }));

    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      // A FileChange already ingested from GitHub keeps its richer analysis fields;
      // the mission only fills in rows that are missing or mission-owned.
      await graph.query(
        `
        UNWIND $batch AS item
        MERGE (fc:FileChange {id: item.id})
        SET fc.path = item.path,
            fc.language = CASE WHEN fc.source IS NULL OR fc.source = "mission" THEN item.language ELSE fc.language END,
            fc.patch = CASE WHEN fc.source IS NULL OR fc.source = "mission" THEN item.patch ELSE fc.patch END,
            fc.added_code = CASE WHEN fc.source IS NULL OR fc.source = "mission" THEN item.added_code ELSE fc.added_code END,
            fc.status = CASE WHEN fc.source IS NULL OR fc.source = "mission" THEN item.status ELSE fc.status END,
            fc.mission_id = CASE WHEN fc.source IS NULL OR fc.source = "mission" THEN item.mission_id ELSE fc.mission_id END,
            fc.commit_sha = item.commit_sha,
            fc.repository_id = item.repository_id, fc.developer_id = item.developer_id,
            fc.created_at = coalesce(fc.created_at, item.created_at),
            fc.source = coalesce(fc.source, "mission")
        WITH fc, item
        MATCH (c:Commit {id: item.commit_id})
        MERGE (c)-[:CHANGED]->(fc)
        WITH fc, item
        MATCH (r:Repository {id: item.repository_id})
        MERGE (fc)-[:IN_REPOSITORY]->(r)
        WITH fc, item
        MATCH (d:Developer {id: item.developer_id})
        MERGE (d)-[:AUTHORED_CODE]->(fc)
        RETURN count(fc) AS n`,
        { params: { batch } },
      );
    }

    const fileChanges = rows.map((row) => ({
      id: row.id,
      path: row.path,
      language: row.language,
      patch: row.patch,
      addedCode: row.added_code,
      commitSha: row.commit_sha,
      repositoryId: row.repository_id,
      createdAt: row.created_at,
    }));
    if (!fileChanges.length) {
      await completeGraphUpdate(graph, updateId);
      return finish("no_evidence", null);
    }

    const contextByCommit = new Map([
      [
        `${repositoryId}:${headSha}`,
        { repositoryFullName: fullName, commitMessage: input.commitMessage },
      ],
    ]);
    const learning = await runLearningPipeline({
      graph,
      developerId,
      fileChanges,
      contextByCommit,
      reasoner: input.reasoner,
      extractor: input.extractor,
      source: "mission",
      missionId,
      evaluationId: evaluationIdFor(missionId, headSha),
      verification,
      expected: { commitSha: headSha, repositoryId },
      forceReconcile: true,
      buildId: `mission-learning:${missionId}:${headSha}`,
      onStage: async (stage) => {
        await markStageComplete(graph, updateId, stage);
        completed.push(stage);
      },
    });

    const shouldAssert =
      input.assertInvariants ?? process.env.PATHWAY_ASSERT_INVARIANTS !== "0";
    if (shouldAssert) await assertGraphInvariants(graph, developerId);

    await completeGraphUpdate(graph, updateId);
    return finish(
      learning.accepted > 0 ||
        learning.skippedExisting > 0 ||
        learning.repairedExisting > 0
        ? "updated"
        : "no_evidence",
      learning,
    );
  } catch (error) {
    // The evaluation audit is already durable. Record the failed stage and report it
    // separately instead of throwing, so callers can retry the graph update safely.
    console.error("[mission-learning] graph update failed:", error);
    await failGraphUpdate(
      graph,
      updateId,
      nextStage(completed) ?? "aggregates_rebuilt",
      error,
    );
    return finish("graph_update_failed", null);
  }
}
