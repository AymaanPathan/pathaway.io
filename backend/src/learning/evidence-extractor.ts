import {
  extractDemonstrations,
  type Demonstration,
  type EvidenceContext,
  type EvidenceInput,
} from "../graph/developer-knowledge-graph.js";

export type LearningFileChange = EvidenceInput;
export type LearningContext = EvidenceContext;

/** Reuses Pathway's deterministic detectors; this module does not define a second taxonomy. */
export function extractEvidence(
  fileChanges: LearningFileChange[],
  contextByCommit: Map<string, LearningContext>,
): Demonstration[] {
  const byId = new Map<string, Demonstration>();
  for (const change of fileChanges) {
    const context = contextByCommit.get(
      `${change.repositoryId}:${change.commitSha}`,
    );
    if (!context) continue;
    for (const demonstration of extractDemonstrations(change, context)) {
      byId.set(demonstration.id, demonstration);
    }
  }
  return [...byId.values()];
}
