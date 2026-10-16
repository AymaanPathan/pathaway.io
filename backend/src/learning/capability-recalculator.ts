import type { Graph } from "../db/falkordb.js";
import {
  rollUpDemonstrations,
  type Demonstration,
} from "../graph/developer-knowledge-graph.js";

/** Recompute capability roll-ups from the complete valid evidence set, not only this sync batch. */
export async function recalculateCapabilities(
  graph: Graph,
  developerId: string,
): Promise<number> {
  const result = await graph.query(
    `
    MATCH (:Developer {id:$developer_id})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability)
    RETURN x.id AS id, c.id AS capabilityId, x.technique AS technique,
      x.depth AS depth, x.repository_id AS repositoryId,
      x.commit_sha AS commitSha, x.created_at AS createdAt`,
    { params: { developer_id: developerId } },
  );
  const rows = (result.data ?? []) as any[];
  const demos = rows.map((r) => ({
    id: String(r.id ?? ""),
    capabilityId: String(r.capabilityId ?? ""),
    technique: String(r.technique ?? ""),
    depth: (r.depth || "usage") as Demonstration["depth"],
    repositoryId: String(r.repositoryId ?? ""),
    commitSha: String(r.commitSha ?? ""),
    createdAt: String(r.createdAt ?? ""),
  })) as Demonstration[];
  const rollups = rollUpDemonstrations(demos);

  for (const item of rollups) {
    await graph.query(
      `
      MATCH (d:Developer {id:$developer_id}), (c:Capability {id:$capability_id})
      MERGE (d)-[r:HAS_CAPABILITY]->(c)
      SET r.level=$level, r.recency=$recency, r.best_depth=$best_depth,
          r.evidence_count=$evidence_count, r.commit_count=$commit_count,
          r.repo_count=$repo_count, r.technique_count=$technique_count,
          r.active_days=$active_days, r.first_seen=$first_seen,
          r.last_seen=$last_seen, r.techniques_json=$techniques_json
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
        },
      },
    );
  }
  return rollups.length;
}
