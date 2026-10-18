import type { Graph } from "../db/falkordb.js";
import {
  rollUpDemonstrations,
  type Demonstration,
} from "../graph/developer-knowledge-graph.js";

/** HAS_CAPABILITY edges written by this module are tagged so stale ones can be pruned safely. */
export const ROLLUP_EDGE_OWNER = "learning-rollup";

/** Every active demonstration for the developer, in the shape the roll-up needs. */
export async function loadRollupInputs(
  graph: Graph,
  developerId: string,
): Promise<Demonstration[]> {
  const result = await graph.query(
    `
    MATCH (:Developer {id:$developer_id})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability)
    RETURN x.id AS id, c.id AS capabilityId, x.technique AS technique,
      x.depth AS depth, x.repository_id AS repositoryId,
      x.commit_sha AS commitSha, x.created_at AS createdAt`,
    { params: { developer_id: developerId } },
  );
  return ((result.data ?? []) as any[]).map((row) => ({
    id: String(row.id ?? ""),
    capabilityId: String(row.capabilityId ?? ""),
    technique: String(row.technique ?? ""),
    depth: (row.depth || "usage") as Demonstration["depth"],
    repositoryId: String(row.repositoryId ?? ""),
    commitSha: String(row.commitSha ?? ""),
    createdAt: String(row.createdAt ?? ""),
  })) as Demonstration[];
}

/**
 * Recompute roll-ups from all stored demonstrations, not just this sync batch,
 * then remove roll-up edges whose capability no longer has any supporting evidence.
 */
export async function recalculateCapabilities(
  graph: Graph,
  developerId: string,
): Promise<number> {
  const demos = await loadRollupInputs(graph, developerId);
  const rollups = rollUpDemonstrations(demos);
  const updatedAt = new Date().toISOString();
  for (const item of rollups) {
    await graph.query(
      `
      MATCH (d:Developer {id:$developer_id}), (c:Capability {id:$capability_id})
      MERGE (d)-[r:HAS_CAPABILITY]->(c)
      SET r.level=$level, r.recency=$recency, r.best_depth=$best_depth,
          r.evidence_count=$evidence_count, r.commit_count=$commit_count,
          r.repo_count=$repo_count, r.technique_count=$technique_count,
          r.active_days=$active_days, r.first_seen=$first_seen,
          r.last_seen=$last_seen, r.techniques_json=$techniques_json,
          r.derived_by=$owner, r.updated_at=$updated_at
      RETURN c.id AS id`,
      {
        params: {
          developer_id: developerId,
          capability_id: item.capabilityId,
          level: item.level,
          recency: item.recency,
          best_depth: item.bestDepth,
          evidence_count: item.evidenceCount,
          commit_count: item.commitCount,
          repo_count: item.repoCount,
          technique_count: item.techniqueCount,
          active_days: item.activeDays,
          first_seen: item.firstSeen,
          last_seen: item.lastSeen,
          techniques_json: item.techniquesJson,
          owner: ROLLUP_EDGE_OWNER,
          updated_at: updatedAt,
        },
      },
    );
  }

  // Retraction: drop roll-up edges (and only roll-up edges) with no remaining evidence.
  await graph.query(
    `
    MATCH (d:Developer {id:$developer_id})-[r:HAS_CAPABILITY]->(c:Capability)
    WHERE (r.derived_by = $owner OR r.techniques_json IS NOT NULL)
      AND NOT c.id IN $keep
    DELETE r`,
    {
      params: {
        developer_id: developerId,
        owner: ROLLUP_EDGE_OWNER,
        keep: rollups.map((item) => item.capabilityId),
      },
    },
  );
  return rollups.length;
}
