import {
  extractDemonstrations,
  type Demonstration,
  type EvidenceContext,
  type EvidenceInput,
} from "../graph/developer-knowledge-graph.js";

export interface LearningFileChange extends EvidenceInput {}
export interface LearningContext extends EvidenceContext {}

/** Reuses Pathway's existing deterministic detector rules; no second taxonomy is created. */
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
      // Stable detector IDs make repeat processing idempotent.
      byId.set(demonstration.id, demonstration);
    }
  }
  return [...byId.values()];
}
