import type { Graph } from "../db/falkordb.js";
import type { Demonstration } from "../graph/developer-knowledge-graph.js";

const depthRank: Record<string, number> = { usage: 1, implementation: 2, strong: 3 };
const BATCH_SIZE = 250;

async function writeBatches(graph: Graph, query: string, rows: Record<string, string | number | boolean | null>[], extra: Record<string, unknown> = {}) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await graph.query(query, { params: { ...extra, batch: rows.slice(i, i + BATCH_SIZE) } });
  }
}

/** Idempotently upsert demonstrations and provenance edges using Pathway's existing schema. */
export async function upsertDemonstrations(
  graph: Graph,
  developerId: string,
  demonstrations: Demonstration[],
  buildId: string,
): Promise<number> {
  if (!demonstrations.length) return 0;
  await writeBatches(graph, `
    UNWIND $batch AS item
    MERGE (x:Demonstration {id: item.id})
    SET x.rule_id = item.rule_id, x.technique = item.technique,
        x.summary = item.summary, x.modifiers = item.modifiers,
        x.depth = item.depth, x.depth_rank = item.depth_rank,
        x.commit_sha = item.commit_sha, x.file_change_id = item.file_change_id,
        x.repository_id = item.repository_id, x.path = item.path,
        x.language = item.language, x.start_line = item.start_line,
        x.end_line = item.end_line, x.snippet = item.snippet,
        x.permalink = item.permalink, x.change_intent = item.change_intent,
        x.commit_subject = item.commit_subject, x.created_at = item.created_at,
        x.developer_id = $developer_id, x.build_id = $build_id
    RETURN count(x) AS n`, demonstrations.map((d) => ({
      id: d.id, rule_id: d.ruleId, technique: d.technique, summary: d.summary,
      modifiers: d.modifiers.join(" | "), depth: d.depth, depth_rank: depthRank[d.depth] ?? 1,
      commit_sha: d.commitSha, file_change_id: d.fileChangeId, repository_id: d.repositoryId,
      path: d.path, language: d.language, start_line: d.startLine, end_line: d.endLine,
      snippet: d.snippet, permalink: d.permalink, change_intent: d.intent,
      commit_subject: d.commitSubject, created_at: d.createdAt,
    })), { developer_id: developerId, build_id: buildId });

  const rows = demonstrations.map((d) => ({ id: d.id, capability_id: d.capabilityId,
    file_change_id: d.fileChangeId, repository_id: d.repositoryId, layer_id: d.layerId }));
  const edges: Array<{ query: string; label: string }> = [
    { label: "developer evidence", query: `UNWIND $batch AS item MATCH (d:Developer {id:$developer_id}) MATCH (x:Demonstration {id:item.id}) MERGE (d)-[:DEMONSTRATED]->(x) RETURN count(x) AS n` },
    { label: "capability evidence", query: `UNWIND $batch AS item MATCH (x:Demonstration {id:item.id}) MATCH (c:Capability {id:item.capability_id}) MERGE (x)-[:OF_CAPABILITY]->(c) RETURN count(x) AS n` },
    { label: "FileChange provenance", query: `UNWIND $batch AS item MATCH (x:Demonstration {id:item.id}) MATCH (fc:FileChange {id:item.file_change_id}) MERGE (x)-[:EVIDENCED_BY]->(fc) MERGE (fc)-[:PRODUCED]->(x) RETURN count(x) AS n` },
    { label: "repository provenance", query: `UNWIND $batch AS item MATCH (x:Demonstration {id:item.id}) MATCH (r:Repository {id:item.repository_id}) MERGE (x)-[:IN_REPOSITORY]->(r) RETURN count(x) AS n` },
    { label: "engineering context", query: `UNWIND $batch AS item WITH item WHERE item.layer_id <> '' MATCH (x:Demonstration {id:item.id}) MATCH (ctx:EngineeringContext {id:item.layer_id}) MERGE (x)-[:IN_CONTEXT]->(ctx) RETURN count(x) AS n` },
  ];
  for (const edge of edges) await writeBatches(graph, edge.query, rows, { developer_id: developerId });

  const skillRows = demonstrations.flatMap((d) => d.usesSkillIds.map((skill_id) => ({ id: d.id, skill_id })));
  if (skillRows.length) await writeBatches(graph,
    `UNWIND $batch AS item MATCH (x:Demonstration {id:item.id}) MATCH (s:Skill {id:item.skill_id}) MERGE (x)-[:USES]->(s) RETURN count(x) AS n`, skillRows);
  return demonstrations.length;
}
