import type { Graph } from "../db/falkordb.js";
import type { Demonstration } from "../graph/developer-knowledge-graph.js";
import type { EvidenceAssessment } from "./learning-agent.js";

export interface ValidationResult {
  valid: Demonstration[];
  rejected: Array<{ demonstrationId: string; reason: string }>;
}

const DEPTHS = new Set(["usage", "implementation", "strong"]);
const MIN_CONFIDENCE = Number(
  process.env.LEARNING_EVIDENCE_MIN_CONFIDENCE ?? 0.65,
);

/** Validate shape, agent verdict, and that source entities already exist in FalkorDB. */
export async function validateEvidence(
  graph: Graph,
  developerId: string,
  demonstrations: Demonstration[],
  assessments: EvidenceAssessment[],
): Promise<ValidationResult> {
  const rejected: ValidationResult["rejected"] = [];
  const assessmentById = new Map(
    assessments.map((a) => [a.demonstrationId, a]),
  );
  const candidates: Demonstration[] = [];

  for (const d of demonstrations) {
    const a = assessmentById.get(d.id);
    let reason = "";
    if (!developerId) reason = "missing developerId";
    else if (!d.id || !d.fileChangeId || !d.repositoryId || !d.commitSha)
      reason = "missing source provenance";
    else if (!d.capabilityId || !d.technique || !d.snippet.trim())
      reason = "missing capability, technique, or code snippet";
    else if (!DEPTHS.has(d.depth)) reason = "invalid depth";
    else if (!a) reason = "no learning-agent assessment";
    else if (!a.accepted) reason = a.rationale || "rejected by learning agent";
    else if (
      !Number.isFinite(a.confidence) ||
      a.confidence < MIN_CONFIDENCE ||
      a.confidence > 1
    )
      reason = "assessment confidence outside threshold";
    if (reason) rejected.push({ demonstrationId: d.id, reason });
    else candidates.push(d);
  }
  if (!candidates.length) return { valid: [], rejected };

  const ids = [...new Set(candidates.map((d) => d.capabilityId))];
  const fileChangeIds = [...new Set(candidates.map((d) => d.fileChangeId))];
  const repoIds = [...new Set(candidates.map((d) => d.repositoryId))];
  const result = await graph.query(
    `MATCH (dev:Developer {id: $developer_id})
     WITH dev
     OPTIONAL MATCH (c:Capability) WHERE c.id IN $capability_ids
     WITH dev, collect(DISTINCT c.id) AS capabilities
     OPTIONAL MATCH (fc:FileChange) WHERE fc.id IN $file_change_ids
     WITH dev, capabilities, collect(DISTINCT fc.id) AS file_changes
     OPTIONAL MATCH (r:Repository) WHERE r.id IN $repository_ids
     RETURN capabilities, file_changes, collect(DISTINCT r.id) AS repositories`,
    {
      params: {
        developer_id: developerId,
        capability_ids: ids,
        file_change_ids: fileChangeIds,
        repository_ids: repoIds,
      },
    },
  );
  const row = (result.data ?? [])[0] as any;
  if (!row)
    return {
      valid: [],
      rejected: candidates.map((d) => ({
        demonstrationId: d.id,
        reason: "developer node not found",
      })),
    };
  const capabilities = new Set((row.capabilities ?? []).map(String));
  const fileChanges = new Set((row.file_changes ?? []).map(String));
  const repositories = new Set((row.repositories ?? []).map(String));
  const valid: Demonstration[] = [];
  for (const d of candidates) {
    const reason = !capabilities.has(d.capabilityId)
      ? "capability node not found"
      : !fileChanges.has(d.fileChangeId)
        ? "FileChange node not found"
        : !repositories.has(d.repositoryId)
          ? "Repository node not found"
          : "";
    if (reason) rejected.push({ demonstrationId: d.id, reason });
    else valid.push(d);
  }
  return { valid, rejected };
}
