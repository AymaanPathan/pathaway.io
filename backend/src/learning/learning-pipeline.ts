import type { Graph } from "../db/falkordb.js";
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
import { validateEvidence } from "./evidence-validator.js";
import {
  findExistingDemonstrationIds,
  markDemonstrationsAsMissionEvidence,
  upsertDemonstrations,
} from "./graph-updater.js";
import { updateExperiences } from "./experience-updater.js";
import { recalculateCapabilities } from "./capability-recalculator.js";

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
}
export interface LearningPipelineResult {
  detected: number;
  reviewed: number;
  accepted: number;
  skippedExisting: number;
  rejected: Array<{ demonstrationId: string; reason: string }>;
  experiencesUpdated: number;
  capabilityRollupsUpdated: number;
}

/** Run after sync has persisted FileChange, Commit, Repository and Developer nodes. */
export async function runLearningPipeline(
  input: LearningPipelineInput,
): Promise<LearningPipelineResult> {
  const { graph, developerId } = input;
  if (!developerId) throw new Error("Learning pipeline requires developerId");
  const buildId = input.buildId ?? `learning-${Date.now()}`;
  const detected = extractEvidence(input.fileChanges, input.contextByCommit);
  if (!detected.length) {
    return {
      detected: 0,
      reviewed: 0,
      accepted: 0,
      skippedExisting: 0,
      rejected: [],
      experiencesUpdated: 0,
      capabilityRollupsUpdated: 0,
    };
  }

  const existing = await findExistingDemonstrationIds(
    graph,
    detected.map((demo) => demo.id),
  );
  const candidates = detected.filter((demo) => !existing.has(demo.id));
  if (input.source === "mission" && input.missionId && existing.size) {
    await markDemonstrationsAsMissionEvidence(
      graph,
      [...existing],
      input.missionId,
    );
  }
  if (!candidates.length) {
    return {
      detected: detected.length,
      reviewed: 0,
      accepted: 0,
      skippedExisting: detected.length,
      rejected: [],
      experiencesUpdated: 0,
      capabilityRollupsUpdated: 0,
    };
  }

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
  if (validation.valid.length) {
    await upsertDemonstrations(graph, developerId, validation.valid, buildId, {
      source: input.source,
      missionId: input.missionId,
    });
  }

  // Aggregates are rebuilt from graph evidence, so repeated syncs don't inflate counts.
  const experiencesUpdated = validation.valid.length
    ? await updateExperiences(graph, developerId)
    : 0;
  const capabilityRollupsUpdated = validation.valid.length
    ? await recalculateCapabilities(graph, developerId)
    : 0;
  return {
    detected: detected.length,
    reviewed: candidates.length,
    accepted: validation.valid.length,
    skippedExisting: existing.size,
    rejected: validation.rejected,
    experiencesUpdated,
    capabilityRollupsUpdated,
  };
}
