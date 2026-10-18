import type { Graph } from "../db/falkordb.js";
import type { Demonstration } from "../graph/developer-knowledge-graph.js";
import {
  extractEvidence,
  type LearningContext,
  type LearningFileChange,
} from "./evidence-extractor.js";
import {
  assessDemonstrations,
  cerebrasLearningReasoner,
  type LearningReasoner,
} from "./learning-agent.js";
import {
  validateEvidence,
  validateSourceEntities,
} from "./evidence-validator.js";
import {
  classifyExistingDemonstrations,
  reconcileDemonstrationRelationships,
  writeDemonstrationNodes,
} from "./graph-updater.js";
import { updateExperiences } from "./experience-updater.js";
import { recalculateCapabilities } from "./capability-recalculator.js";
import { withLock } from "./operation-state.js";
import type { VerificationDecision } from "./verification-gate.js";

export type PipelineStage =
  | "evidence_written"
  | "relationships_reconciled"
  | "aggregates_rebuilt";

export interface LearningPipelineInput {
  graph: Graph;
  developerId: string;
  fileChanges: LearningFileChange[];
  /** Keyed by `${repositoryId}:${commitSha}`. */
  contextByCommit: Map<string, LearningContext>;
  reasoner?: LearningReasoner;
  buildId?: string;
  /** Verified mission evidence is retained across full GitHub graph rebuilds. */
  source?: "github" | "mission";
  missionId?: string;
  /** Evaluation that verified this batch (mission source only). */
  evaluationId?: string;
  /**
   * REQUIRED for source "mission": the decision from verifyMissionOutcome(). The pipeline
   * refuses to run without a passing decision AND a verified, non-retracted Evaluation node.
   */
  verification?: VerificationDecision;
  /**
   * Provenance the evidence must match exactly (the evaluated commit and repository).
   * Detected demonstrations pointing anywhere else are rejected, never written.
   */
  expected?: { commitSha: string; repositoryId: string };
  /** Rebuild aggregates even when nothing was detected. Mission retries set this. */
  forceReconcile?: boolean;
  /** Detector override. Defaults to Pathway's deterministic extractEvidence. */
  extractor?: (
    fileChanges: LearningFileChange[],
    contextByCommit: Map<string, LearningContext>,
  ) => Demonstration[];
  /** Called after each stage completes so callers can persist progress. */
  onStage?: (stage: PipelineStage) => Promise<void>;
}
export interface LearningPipelineResult {
  detected: number;
  reviewed: number;
  accepted: number;
  /** Already-persisted, owned demonstrations. */
  skippedExisting: number;
  /** Already-persisted demonstrations whose nodes/edges were re-asserted. */
  repairedExisting: number;
  rejected: Array<{ demonstrationId: string; reason: string }>;
  experiencesUpdated: number;
  capabilityRollupsUpdated: number;
  reconciled: boolean;
}

/** Rebuilds every derived aggregate for a developer. Serialised per developer. */
export async function reconcileDeveloperAggregates(
  graph: Graph,
  developerId: string,
): Promise<{ experiencesUpdated: number; capabilityRollupsUpdated: number }> {
  return withLock(`aggregates:${developerId}`, async () => {
    const experiencesUpdated = await updateExperiences(graph, developerId);
    const capabilityRollupsUpdated = await recalculateCapabilities(
      graph,
      developerId,
    );
    return { experiencesUpdated, capabilityRollupsUpdated };
  });
}

/**
 * The pipeline-level enforcement of the verification gate. Callers passing a decision
 * is not enough: the persisted Evaluation must also be verified, not retracted, and for
 * the commit being learned from.
 */
async function assertMissionEvidenceAllowed(
  input: LearningPipelineInput,
): Promise<void> {
  const { graph, developerId, missionId, evaluationId, verification } = input;
  if (!missionId || !evaluationId)
    throw new Error("Mission evidence requires missionId and evaluationId");
  if (!verification?.verified)
    throw new Error(
      `Mission evidence refused: verification gate did not pass (${verification?.reasons?.join("; ") || "no decision supplied"})`,
    );
  const result = await graph.query(
    `MATCH (:Developer {id:$developer_id})-[:ASSIGNED]->(:Mission {id:$mission_id})-[:EVALUATED_AS]->(e:Evaluation {id:$evaluation_id})
     RETURN e.verified AS verified, coalesce(e.retracted, false) AS retracted,
       coalesce(e.head_commit, "") AS head`,
    {
      params: {
        developer_id: developerId,
        mission_id: missionId,
        evaluation_id: evaluationId,
      },
    },
  );
  const row = (result.data ?? [])[0] as
    | { verified?: unknown; retracted?: unknown; head?: unknown }
    | undefined;
  if (!row)
    throw new Error(
      `Mission evidence refused: evaluation ${evaluationId} not found for this developer's mission`,
    );
  if (row.verified !== true)
    throw new Error(
      `Mission evidence refused: evaluation ${evaluationId} is not verified`,
    );
  if (row.retracted === true)
    throw new Error(
      `Mission evidence refused: evaluation ${evaluationId} is retracted`,
    );
  if (input.expected && String(row.head ?? "") !== input.expected.commitSha)
    throw new Error(
      `Mission evidence refused: evaluation head ${String(row.head)} does not match ${input.expected.commitSha}`,
    );
}

/**
 * Run after sync has persisted FileChange, Commit, Repository and Developer nodes.
 *
 * Retry-safe: demonstrations that already exist (and are owned by this developer) are NOT
 * skipped silently. Their nodes and edges are re-asserted (no LLM call), and aggregates are
 * always rebuilt from the graph, so reprocessing the same commit converges to the same state
 * even after a partial failure. Demonstrations owned by another developer are rejected.
 */
export async function runLearningPipeline(
  input: LearningPipelineInput,
): Promise<LearningPipelineResult> {
  const { graph, developerId } = input;
  if (!developerId) throw new Error("Learning pipeline requires developerId");
  if (input.source === "mission") await assertMissionEvidenceAllowed(input);

  const buildId = input.buildId ?? `learning-${Date.now()}`;
  const options = {
    source: input.source,
    missionId: input.missionId,
    evaluationId: input.evaluationId,
  };

  const rejected: LearningPipelineResult["rejected"] = [];
  const extract = input.extractor ?? extractEvidence;
  const extracted = extract(input.fileChanges, input.contextByCommit);

  // Provenance: evidence must point at exactly the evaluated commit and repository.
  const detected: Demonstration[] = [];
  for (const demo of extracted) {
    if (input.expected && demo.commitSha !== input.expected.commitSha)
      rejected.push({
        demonstrationId: demo.id,
        reason: "commit does not match the evaluated commit",
      });
    else if (
      input.expected &&
      demo.repositoryId !== input.expected.repositoryId
    )
      rejected.push({
        demonstrationId: demo.id,
        reason: "repository does not match the evaluated repository",
      });
    else detected.push(demo);
  }

  if (!detected.length && !input.forceReconcile) {
    return {
      detected: extracted.length,
      reviewed: 0,
      accepted: 0,
      skippedExisting: 0,
      repairedExisting: 0,
      rejected,
      experiencesUpdated: 0,
      capabilityRollupsUpdated: 0,
      reconciled: false,
    };
  }

  const ownership = detected.length
    ? await classifyExistingDemonstrations(
        graph,
        developerId,
        detected.map((demo) => demo.id),
      )
    : { owned: new Set<string>(), foreign: new Set<string>() };
  for (const id of ownership.foreign)
    rejected.push({
      demonstrationId: id,
      reason: "demonstration id is owned by another developer",
    });
  const existingDemos = detected.filter((demo) => ownership.owned.has(demo.id));
  const candidates = detected.filter(
    (demo) => !ownership.owned.has(demo.id) && !ownership.foreign.has(demo.id),
  );

  const writable: Demonstration[] = [];
  let repairedExisting = 0;
  let accepted = 0;
  let evidenceError: unknown = null;

  try {
    if (existingDemos.length) {
      const checked = await validateSourceEntities(
        graph,
        developerId,
        existingDemos,
      );
      rejected.push(...checked.rejected);
      if (checked.valid.length) {
        await writeDemonstrationNodes(
          graph,
          developerId,
          checked.valid,
          buildId,
          options,
        );
        writable.push(...checked.valid);
        repairedExisting = checked.valid.length;
      }
    }

    if (candidates.length) {
      const assessments = await assessDemonstrations(
        candidates,
        input.reasoner ?? cerebrasLearningReasoner,
      );
      const validation = await validateEvidence(
        graph,
        developerId,
        candidates,
        assessments,
      );
      rejected.push(...validation.rejected);
      if (validation.valid.length) {
        await writeDemonstrationNodes(
          graph,
          developerId,
          validation.valid,
          buildId,
          options,
        );
        writable.push(...validation.valid);
        accepted = validation.valid.length;
      }
    }
  } catch (error) {
    // An LLM/validation failure must not stop already-persisted evidence from being repaired.
    evidenceError = error;
  }

  if (!evidenceError) await input.onStage?.("evidence_written");

  await reconcileDemonstrationRelationships(
    graph,
    developerId,
    writable,
    options,
  );
  if (!evidenceError) await input.onStage?.("relationships_reconciled");

  const aggregates = await reconcileDeveloperAggregates(graph, developerId);
  if (evidenceError) throw evidenceError;
  await input.onStage?.("aggregates_rebuilt");

  return {
    detected: extracted.length,
    reviewed: candidates.length,
    accepted,
    skippedExisting: ownership.owned.size,
    repairedExisting,
    rejected,
    experiencesUpdated: aggregates.experiencesUpdated,
    capabilityRollupsUpdated: aggregates.capabilityRollupsUpdated,
    reconciled: true,
  };
}
