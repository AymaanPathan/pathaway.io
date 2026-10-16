import type { Graph } from "../../db/falkordb.js";
import type { Demonstration } from "../developer-knowledge-graph.js";
import { extractEvidence, type LearningContext, type LearningFileChange } from "./evidence-extractor.js";
import { assessDemonstrations, type LearningReasoner } from "./learning-agent.js";
import { validateEvidence } from "./evidence-validator.js";
import { upsertDemonstrations } from "./graph-updater.js";
import { updateExperiences } from "./experience-updater.js";
import { recalculateCapabilities } from "./capability-recalculator.js";

export interface LearningPipelineInput {
  graph: Graph;
  developerId: string;
  fileChanges: LearningFileChange[];
  /** Map keyed by `${repositoryId}:${commitSha}`; each context contains repository full name and commit message. */
  contextByCommit: Map<string, LearningContext>;
  reasoner: LearningReasoner;
  buildId?: string;
}
export interface LearningPipelineResult {
  extracted: number;
  accepted: number;
  rejected: Array<{ demonstrationId: string; reason: string }>;
  experiencesUpdated: number;
  capabilityRollupsUpdated: number;
}

/** Run after GitHub sync has persisted FileChange, Commit, Repository and Developer nodes. */
export async function runLearningPipeline(input: LearningPipelineInput): Promise<LearningPipelineResult> {
  const { graph, developerId, reasoner } = input;
  if (!developerId) throw new Error("Learning pipeline requires developerId");
  const buildId = input.buildId ?? `learning-${Date.now()}`;
  const extracted = extractEvidence(input.fileChanges, input.contextByCommit);
  if (!extracted.length) return { extracted: 0, accepted: 0, rejected: [], experiencesUpdated: 0, capabilityRollupsUpdated: 0 };

  const assessments = await assessDemonstrations(extracted, reasoner);
  const validation = await validateEvidence(graph, developerId, extracted, assessments);
  if (validation.valid.length) {
    await upsertDemonstrations(graph, developerId, validation.valid, buildId);
  }
  // Rebuild aggregate memory from graph evidence so repeated syncs don't inflate counts.
  const experiencesUpdated = await updateExperiences(graph, developerId);
  const capabilityRollupsUpdated = await recalculateCapabilities(graph, developerId);
  return {
    extracted: extracted.length,
    accepted: validation.valid.length,
    rejected: validation.rejected,
    experiencesUpdated,
    capabilityRollupsUpdated,
  };
}
