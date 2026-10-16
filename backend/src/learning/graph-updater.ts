import type { Graph } from "../db/falkordb.js";
import type { Demonstration } from "../graph/developer-knowledge-graph.js";

const DEPTH_RANK: Record<string, number> = {
  usage: 1,
  implementation: 2,
  strong: 3,
};
const BATCH_SIZE = 200;
type Param = string | number | boolean | null;

async function writeBatches(
  graph: Graph,
  query: string,
  rows: Array<Record<string, Param>>,
  extra: Record<string, unknown> = {},
): Promise<void> {
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    await graph.query(query, {
      params: { ...extra, batch: rows.slice(index, index + BATCH_SIZE) },
    });
  }
}

/** Idempotently upsert detector-produced demonstrations and Pathway's existing evidence edges. */
export async function upsertDemonstrations(
  graph: Graph,
  developerId: string,
  demonstrations: Demonstration[],
  buildId: string,
  options: { source?: "github" | "mission"; missionId?: string } = {},
): Promise<number> {
  if (!demonstrations.length) return 0;

  const nodeRows = demonstrations.map((demo) => ({
    id: demo.id,
    rule_id: demo.ruleId,
    technique: demo.technique,
    summary: demo.summary,
    modifiers: demo.modifiers.join(" | "),
    depth: demo.depth,
    depth_rank: DEPTH_RANK[demo.depth] ?? 1,
    commit_sha: demo.commitSha,
    file_change_id: demo.fileChangeId,
    repository_id: demo.repositoryId,
    path: demo.path,
    language: demo.language,
    start_line: demo.startLine,
    end_line: demo.endLine,
    snippet: demo.snippet,
    permalink: demo.permalink,
    change_intent: demo.intent,
    commit_subject: demo.commitSubject,
    created_at: demo.createdAt,
    source: options.source ?? "github",
    mission_id: options.missionId ?? null,
  }));
  await writeBatches(
    graph,
    `
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
        x.developer_id = $developer_id, x.build_id = $build_id,
        x.source = item.source, x.mission_id = item.mission_id
    RETURN count(x) AS n`,
    nodeRows,
    { developer_id: developerId, build_id: buildId },
  );

  const edgeRows = demonstrations.map((demo) => ({
    id: demo.id,
    capability_id: demo.capabilityId,
    file_change_id: demo.fileChangeId,
    repository_id: demo.repositoryId,
    layer_id: demo.layerId || "",
  }));
  const edges = [
    `UNWIND $batch AS item MATCH (d:Developer {id:$developer_id}) MATCH (x:Demonstration {id:item.id}) MERGE (d)-[:DEMONSTRATED]->(x) RETURN count(x) AS n`,
    `UNWIND $batch AS item MATCH (x:Demonstration {id:item.id}) MATCH (c:Capability {id:item.capability_id}) MERGE (x)-[:OF_CAPABILITY]->(c) RETURN count(x) AS n`,
    `UNWIND $batch AS item MATCH (x:Demonstration {id:item.id}) MATCH (fc:FileChange {id:item.file_change_id}) MERGE (x)-[:EVIDENCED_BY]->(fc) MERGE (fc)-[:PRODUCED]->(x) RETURN count(x) AS n`,
    `UNWIND $batch AS item MATCH (x:Demonstration {id:item.id}) MATCH (r:Repository {id:item.repository_id}) MERGE (x)-[:IN_REPOSITORY]->(r) RETURN count(x) AS n`,
  ];
  for (const query of edges)
    await writeBatches(graph, query, edgeRows, { developer_id: developerId });

  const contextRows = edgeRows.filter((row) => row.layer_id !== "");
  if (contextRows.length) {
    await writeBatches(
      graph,
      `UNWIND $batch AS item MATCH (x:Demonstration {id:item.id}) MATCH (ctx:EngineeringContext {id:item.layer_id}) MERGE (x)-[:IN_CONTEXT]->(ctx) RETURN count(x) AS n`,
      contextRows,
    );
  }
  const skillRows = demonstrations.flatMap((demo) =>
    demo.usesSkillIds.map((skill_id) => ({ id: demo.id, skill_id })),
  );
  if (skillRows.length) {
    await writeBatches(
      graph,
      `UNWIND $batch AS item MATCH (x:Demonstration {id:item.id}) MATCH (s:Skill {id:item.skill_id}) MERGE (x)-[:USES]->(s) RETURN count(x) AS n`,
      skillRows,
    );
  }
  return demonstrations.length;
}

/** Existing IDs are already persisted; do not spend LLM calls reviewing them on every overlapping sync. */
export async function findExistingDemonstrationIds(
  graph: Graph,
  ids: string[],
): Promise<Set<string>> {
  const existing = new Set<string>();
  for (let index = 0; index < ids.length; index += BATCH_SIZE) {
    const batch = ids.slice(index, index + BATCH_SIZE);
    const result = await graph.query(
      `MATCH (x:Demonstration) WHERE x.id IN $ids RETURN x.id AS id`,
      { params: { ids: batch } },
    );
    for (const row of (result.data ?? []) as Array<{ id?: unknown }>) {
      if (row.id != null) existing.add(String(row.id));
    }
  }
  return existing;
}

/** Promote previously accepted evidence when its exact commit is later verified by a mission. */
export async function markDemonstrationsAsMissionEvidence(
  graph: Graph,
  ids: string[],
  missionId: string,
): Promise<number> {
  if (!ids.length || !missionId) return 0;
  let updated = 0;
  for (let index = 0; index < ids.length; index += BATCH_SIZE) {
    const batch = ids.slice(index, index + BATCH_SIZE);
    const result = await graph.query(
      `MATCH (x:Demonstration) WHERE x.id IN $ids
       SET x.source = "mission", x.mission_id = $mission_id
       RETURN count(x) AS n`,
      { params: { ids: batch, mission_id: missionId } },
    );
    updated += Number(
      (result.data?.[0] as { n?: unknown } | undefined)?.n ?? 0,
    );
  }
  return updated;
}
