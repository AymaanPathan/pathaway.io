import type { Graph } from "../db/falkordb.js";
import type { EvaluationOutcome } from "../evaluations/mission-evaluation-agent.js";
import {
  runLearningPipeline,
  type LearningPipelineResult,
} from "./learning-pipeline.js";

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
}

export interface MissionLearningResult {
  evaluationStored: boolean;
  evidenceStatus:
    | "updated"
    | "not_verified"
    | "no_evidence"
    | "repository_missing";
  learning: LearningPipelineResult | null;
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
): Promise<boolean> {
  const { graph, developerId, missionId, headSha, outcome, changedFiles } =
    input;
  const now = new Date().toISOString();
  const ciState =
    outcome.overall === "passed"
      ? "success"
      : outcome.overall === "blocked"
        ? "pending"
        : "failure";
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
        e.created_at = $now
    MERGE (m)-[:EVALUATED_AS]->(e)
    SET m.status = $verdict,
        m.submitted_head = $head_sha,
        m.updated_at = $now,
        m.completed_at = CASE WHEN $verdict = "completed" THEN $now ELSE "" END
    RETURN count(e) AS n`,
    {
      params: {
        developer_id: developerId,
        mission_id: missionId,
        evaluation_id: `evaluation:${missionId}:${headSha}`,
        verdict: outcome.verdict,
        head_sha: headSha,
        ci_state: ciState,
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
        now,
      },
    },
  );
  return Number((result.data?.[0] as { n?: unknown } | undefined)?.n ?? 0) > 0;
}

/**
 * New post-evaluation learning flow: persist the evaluation audit first, then
 * only convert code into durable capability evidence when the sandbox verdict
 * is passed. The same FileChange IDs/schema as GitHub sync are reused.
 */
export async function processMissionEvaluation(
  input: MissionLearningInput,
): Promise<MissionLearningResult> {
  const evaluationStored = await storeEvaluationAudit(input);
  if (!evaluationStored) {
    throw new Error(
      `Could not persist evaluation for mission ${input.missionId}; developer/mission graph link is missing`,
    );
  }

  if (
    input.outcome.overall !== "passed" ||
    input.outcome.verdict !== "completed"
  ) {
    return { evaluationStored, evidenceStatus: "not_verified", learning: null };
  }

  const repoResult = await input.graph.query(
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
      {
        missionId: input.missionId,
        repository: input.repositoryFullName,
      },
    );
    return {
      evaluationStored,
      evidenceStatus: "repository_missing",
      learning: null,
    };
  }

  const now = new Date().toISOString();
  const commitId = `${repositoryId}:commit:${input.headSha}`;
  await input.graph.query(
    `
    MERGE (c:Commit {id: $commit_id})
    SET c.sha = $sha, c.message = $message, c.subject = $subject,
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
        sha: input.headSha,
        message: input.commitMessage,
        subject: input.commitMessage.split("\n")[0].slice(0, 160),
        repository_id: repositoryId,
        developer_id: input.developerId,
        now,
      },
    },
  );

  const rows = input.changedFiles.map((file) => ({
    id: `${repositoryId}:commit:${input.headSha}:file:${file.path}`,
    path: file.path,
    language: languageFor(file.path),
    patch: file.patch ?? "",
    added_code: addedCodeFromPatch(file.patch ?? ""),
    status: file.status || "modified",
    commit_sha: input.headSha,
    commit_id: commitId,
    repository_id: repositoryId,
    developer_id: input.developerId,
    created_at: now,
    mission_id: input.missionId,
  }));

  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    await input.graph.query(
      `
      UNWIND $batch AS item
      MERGE (fc:FileChange {id: item.id})
      SET fc.path = item.path, fc.language = item.language,
          fc.patch = item.patch, fc.added_code = item.added_code,
          fc.status = item.status, fc.commit_sha = item.commit_sha,
          fc.repository_id = item.repository_id, fc.developer_id = item.developer_id,
          fc.created_at = coalesce(fc.created_at, item.created_at),
          fc.mission_id = item.mission_id,
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
  if (!fileChanges.length)
    return { evaluationStored, evidenceStatus: "no_evidence", learning: null };

  const contextByCommit = new Map([
    [
      `${repositoryId}:${input.headSha}`,
      {
        repositoryFullName: fullName,
        commitMessage: input.commitMessage,
      },
    ],
  ]);
  const learning = await runLearningPipeline({
    graph: input.graph,
    developerId: input.developerId,
    fileChanges,
    contextByCommit,
    source: "mission",
    missionId: input.missionId,
    buildId: `mission-learning:${input.missionId}:${input.headSha}`,
  });

  return {
    evaluationStored,
    evidenceStatus:
      learning.accepted > 0 || learning.skippedExisting > 0
        ? "updated"
        : "no_evidence",
    learning,
  };
}
