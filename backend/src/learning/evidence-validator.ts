import type { Graph } from "../db/falkordb.js";
import type { Demonstration } from "../graph/developer-knowledge-graph.js";
import type { EvidenceAssessment } from "./learning-agent.js";

export interface ValidationResult {
  valid: Demonstration[];
  rejected: Array<{ demonstrationId: string; reason: string }>;
}

const DEPTHS = new Set(["usage", "implementation", "strong"]);
const configuredConfidence = Number(
  process.env.LEARNING_EVIDENCE_MIN_CONFIDENCE ?? 0.65,
);
const MIN_CONFIDENCE = Number.isFinite(configuredConfidence)
  ? Math.min(1, Math.max(0, configuredConfidence))
  : 0.65;

/**
 * Structural checks against the graph only (no model verdict). Used for brand-new
 * candidates after assessment AND for already-persisted demonstrations that are
 * being repaired on retry, so retries never need another LLM call.
 */
export async function validateSourceEntities(
  graph: Graph,
  developerId: string,
  candidates: Demonstration[],
): Promise<ValidationResult> {
  if (!candidates.length) return { valid: [], rejected: [] };

  const result = await graph.query(
    `MATCH (dev:Developer {id: $developer_id})
     WITH dev
     OPTIONAL MATCH (c:Capability)
       WHERE c.id IN $capability_ids
     WITH dev, collect(DISTINCT c.id) AS capabilities
     OPTIONAL MATCH (fc:FileChange)
       WHERE fc.id IN $file_change_ids
         AND coalesce(fc.developer_id, $developer_id) = $developer_id
     WITH dev, capabilities,
       collect(DISTINCT {id: fc.id, repository_id: fc.repository_id}) AS file_changes
     OPTIONAL MATCH (r:Repository)
       WHERE r.id IN $repository_ids
     RETURN capabilities, file_changes, collect(DISTINCT r.id) AS repositories`,
    {
      params: {
        developer_id: developerId,
        capability_ids: [
          ...new Set(candidates.map((demo) => demo.capabilityId)),
        ],
        file_change_ids: [
          ...new Set(candidates.map((demo) => demo.fileChangeId)),
        ],
        repository_ids: [
          ...new Set(candidates.map((demo) => demo.repositoryId)),
        ],
      },
    },
  );
  const row = (result.data ?? [])[0] as any;
  if (!row) {
    return {
      valid: [],
      rejected: candidates.map((demo) => ({
        demonstrationId: demo.id,
        reason: "developer node not found",
      })),
    };
  }
  const capabilities = new Set(
    (row.capabilities ?? []).filter(Boolean).map(String),
  );
  const fileChanges = new Map<string, string>(
    (row.file_changes ?? [])
      .filter((item: any) => item?.id != null)
      .map((item: any) => [String(item.id), String(item.repository_id ?? "")]),
  );
  const repositories = new Set(
    (row.repositories ?? []).filter(Boolean).map(String),
  );

  const valid: Demonstration[] = [];
  const rejected: ValidationResult["rejected"] = [];
  for (const demo of candidates) {
    const fileRepoId = fileChanges.get(demo.fileChangeId);
    const reason = !capabilities.has(demo.capabilityId)
      ? "capability node not found"
      : fileRepoId === undefined
        ? "FileChange node not found or belongs to another developer"
        : fileRepoId && fileRepoId !== demo.repositoryId
          ? "FileChange repository does not match evidence repository"
          : !repositories.has(demo.repositoryId)
            ? "Repository node not found"
            : "";
    if (reason) rejected.push({ demonstrationId: demo.id, reason });
    else valid.push(demo);
  }
  return { valid, rejected };
}

/** Validate detector output, model verdict, and source entities before writing anything. */
export async function validateEvidence(
  graph: Graph,
  developerId: string,
  demonstrations: Demonstration[],
  assessments: EvidenceAssessment[],
): Promise<ValidationResult> {
  const rejected: ValidationResult["rejected"] = [];
  const assessmentById = new Map(
    assessments.map((assessment) => [assessment.demonstrationId, assessment]),
  );
  const candidates: Demonstration[] = [];

  for (const demo of demonstrations) {
    const assessment = assessmentById.get(demo.id);
    let reason = "";
    if (!developerId) reason = "missing developerId";
    else if (
      !demo.id ||
      !demo.fileChangeId ||
      !demo.repositoryId ||
      !demo.commitSha
    )
      reason = "missing source provenance";
    else if (!demo.capabilityId || !demo.technique || !demo.snippet.trim())
      reason = "missing capability, technique, or code snippet";
    else if (!DEPTHS.has(demo.depth)) reason = "invalid depth";
    else if (!assessment) reason = "no learning-agent assessment";
    else if (!assessment.accepted)
      reason = assessment.rationale || "rejected by learning agent";
    else if (
      !Number.isFinite(assessment.confidence) ||
      assessment.confidence < MIN_CONFIDENCE ||
      assessment.confidence > 1
    )
      reason = "assessment confidence outside threshold";
    if (reason) rejected.push({ demonstrationId: demo.id, reason });
    else candidates.push(demo);
  }
  if (!candidates.length) return { valid: [], rejected };

  const sources = await validateSourceEntities(graph, developerId, candidates);
  return {
    valid: sources.valid,
    rejected: [...rejected, ...sources.rejected],
  };
}
