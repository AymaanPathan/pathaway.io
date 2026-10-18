import type { Graph } from "../db/falkordb.js";
import type { Demonstration } from "../graph/developer-knowledge-graph.js";

const DEPTH_RANK: Record<string, number> = {
  usage: 1,
  implementation: 2,
  strong: 3,
};
const BATCH_SIZE = 200;
type Param = string | number | boolean | null;

export interface UpsertOptions {
  source?: "github" | "mission";
  missionId?: string;
  /** Evaluation that verified this evidence, e.g. `evaluation:${missionId}:${headSha}`. */
  evaluationId?: string;
}

/**
 * Cypher predicate (variable `x`) for demonstrations that may feed aggregates:
 * GitHub evidence, GitHub-backed evidence, or mission evidence that a mission still verifies.
 * Mission-sourced nodes with no verification edge (partial writes, unverified promotions)
 * never count.
 */
export const ACTIVE_DEMONSTRATION_PREDICATE = `(coalesce(x.source, "github") <> "mission" OR coalesce(x.github_backed, false) = true OR (x)-[:VERIFIED_BY_MISSION]->(:Mission))`;

/** Runs the query per batch and returns the sum of the `n` column it returns. */
async function writeBatches(
  graph: Graph,
  query: string,
  rows: Array<Record<string, Param>>,
  extra: Record<string, unknown> = {},
): Promise<number> {
  let total = 0;
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const result = await graph.query(query, {
      params: { ...extra, batch: rows.slice(index, index + BATCH_SIZE) },
    });
    total += Number((result.data?.[0] as { n?: unknown } | undefined)?.n ?? 0);
  }
  return total;
}

/**
 * Canonical evidence identity: the detector-produced Demonstration id.
 * A mission never mints its own proof node; it VERIFIES existing/new demonstrations
 * through (Demonstration)-[:VERIFIED_BY_MISSION]->(Mission), so one verified change
 * has exactly one representation no matter how many sources vouch for it.
 *
 * A node owned by another developer is never overwritten: the write is skipped by the
 * query and this function throws, so the caller cannot believe it succeeded.
 */
export async function writeDemonstrationNodes(
  graph: Graph,
  developerId: string,
  demonstrations: Demonstration[],
  buildId: string,
  options: UpsertOptions = {},
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
  const written = await writeBatches(
    graph,
    `
    UNWIND $batch AS item
    MERGE (x:Demonstration {id: item.id})
    WITH x, item
    WHERE x.developer_id IS NULL OR x.developer_id = $developer_id
    SET x.github_backed = CASE
          WHEN item.source = "github" THEN true
          WHEN x.github_backed IS NOT NULL THEN x.github_backed
          ELSE coalesce(x.source, "") = "github"
        END,
        x.source = CASE
          WHEN item.source = "mission" OR x.source = "mission" THEN "mission"
          ELSE "github"
        END,
        x.mission_id = coalesce(item.mission_id, x.mission_id),
        x.rule_id = item.rule_id, x.technique = item.technique,
        x.summary = item.summary, x.modifiers = item.modifiers,
        x.depth = item.depth, x.depth_rank = item.depth_rank,
        x.commit_sha = item.commit_sha, x.file_change_id = item.file_change_id,
        x.repository_id = item.repository_id, x.path = item.path,
        x.language = item.language, x.start_line = item.start_line,
        x.end_line = item.end_line, x.snippet = item.snippet,
        x.permalink = item.permalink, x.change_intent = item.change_intent,
        x.commit_subject = item.commit_subject, x.created_at = item.created_at,
        x.developer_id = $developer_id, x.build_id = $build_id
    RETURN count(x) AS n`,
    nodeRows,
    { developer_id: developerId, build_id: buildId },
  );
  if (written < nodeRows.length)
    throw new Error(
      `Demonstration write skipped ${nodeRows.length - written} node(s): id owned by another developer`,
    );
  return written;
}

/**
 * Re-asserts every edge a Demonstration must have. Pure MERGE, so safe to repeat.
 * Throws when a required edge cannot be created (missing Developer, Capability,
 * FileChange, Repository or Mission) so a partial write is reported, never swallowed.
 */
export async function reconcileDemonstrationRelationships(
  graph: Graph,
  developerId: string,
  demonstrations: Demonstration[],
  options: UpsertOptions = {},
): Promise<number> {
  if (!demonstrations.length) return 0;

  const expected = new Set(demonstrations.map((demo) => demo.id)).size;
  const edgeRows = demonstrations.map((demo) => ({
    id: demo.id,
    capability_id: demo.capabilityId,
    file_change_id: demo.fileChangeId,
    repository_id: demo.repositoryId,
    commit_sha: demo.commitSha,
    layer_id: demo.layerId || "",
  }));
  const required: Array<[string, string]> = [
    [
      "DEMONSTRATED",
      `UNWIND $batch AS item MATCH (d:Developer {id:$developer_id}) MATCH (x:Demonstration {id:item.id}) MERGE (d)-[:DEMONSTRATED]->(x) RETURN count(x) AS n`,
    ],
    [
      "OF_CAPABILITY",
      `UNWIND $batch AS item MATCH (x:Demonstration {id:item.id}) MATCH (c:Capability {id:item.capability_id}) MERGE (x)-[:OF_CAPABILITY]->(c) RETURN count(x) AS n`,
    ],
    [
      "EVIDENCED_BY/PRODUCED",
      `UNWIND $batch AS item MATCH (x:Demonstration {id:item.id}) MATCH (fc:FileChange {id:item.file_change_id}) MERGE (x)-[:EVIDENCED_BY]->(fc) MERGE (fc)-[:PRODUCED]->(x) RETURN count(x) AS n`,
    ],
    [
      "IN_REPOSITORY",
      `UNWIND $batch AS item MATCH (x:Demonstration {id:item.id}) MATCH (r:Repository {id:item.repository_id}) MERGE (x)-[:IN_REPOSITORY]->(r) RETURN count(x) AS n`,
    ],
  ];
  for (const [name, query] of required) {
    const linked = await writeBatches(graph, query, edgeRows, {
      developer_id: developerId,
    });
    if (linked < expected)
      throw new Error(
        `Demonstration relationships incomplete: ${name} linked ${linked}/${expected}`,
      );
  }

  // The verification edge is written LAST: until it exists, mission evidence is
  // excluded from every aggregate (see ACTIVE_DEMONSTRATION_PREDICATE).
  if (options.source === "mission" && options.missionId) {
    const verified = await writeBatches(
      graph,
      `UNWIND $batch AS item MATCH (x:Demonstration {id:item.id}) MATCH (m:Mission {id:$mission_id})
       MERGE (x)-[v:VERIFIED_BY_MISSION]->(m)
       SET v.evaluation_id = $evaluation_id, v.head_sha = item.commit_sha
       RETURN count(x) AS n`,
      edgeRows,
      {
        mission_id: options.missionId,
        evaluation_id: options.evaluationId ?? "",
      },
    );
    if (verified < expected)
      throw new Error(
        `VERIFIED_BY_MISSION not written for ${expected - verified} demonstration(s): Mission ${options.missionId} not found`,
      );
  }

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

/** Idempotently upsert detector-produced demonstrations and all of their evidence edges. */
export async function upsertDemonstrations(
  graph: Graph,
  developerId: string,
  demonstrations: Demonstration[],
  buildId: string,
  options: UpsertOptions = {},
): Promise<number> {
  const written = await writeDemonstrationNodes(
    graph,
    developerId,
    demonstrations,
    buildId,
    options,
  );
  await reconcileDemonstrationRelationships(
    graph,
    developerId,
    demonstrations,
    options,
  );
  return written;
}

/**
 * Splits already-persisted ids by owner. A node with no developer_id is treated as
 * claimable (legacy). Ids owned by someone else must never be reviewed or rewritten.
 */
export async function classifyExistingDemonstrations(
  graph: Graph,
  developerId: string,
  ids: string[],
): Promise<{ owned: Set<string>; foreign: Set<string> }> {
  const owned = new Set<string>();
  const foreign = new Set<string>();
  for (let index = 0; index < ids.length; index += BATCH_SIZE) {
    const batch = ids.slice(index, index + BATCH_SIZE);
    const result = await graph.query(
      `MATCH (x:Demonstration) WHERE x.id IN $ids
       RETURN x.id AS id, x.developer_id AS owner`,
      { params: { ids: batch } },
    );
    for (const row of (result.data ?? []) as Array<{
      id?: unknown;
      owner?: unknown;
    }>) {
      if (row.id == null) continue;
      const owner = row.owner == null ? "" : String(row.owner);
      if (!owner || owner === developerId) owned.add(String(row.id));
      else foreign.add(String(row.id));
    }
  }
  return { owned, foreign };
}

/** Every id that already exists, regardless of owner. Prefer classifyExistingDemonstrations. */
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

/**
 * Promote previously accepted evidence when its exact commit is later verified by a mission.
 * Remembers that the evidence was GitHub-backed so retracting the mission can't delete it.
 * Pass developerId so another developer's evidence can never be promoted.
 */
export async function markDemonstrationsAsMissionEvidence(
  graph: Graph,
  ids: string[],
  missionId: string,
  evaluationId = "",
  developerId = "",
): Promise<number> {
  if (!ids.length || !missionId) return 0;
  let updated = 0;
  for (let index = 0; index < ids.length; index += BATCH_SIZE) {
    const batch = ids.slice(index, index + BATCH_SIZE);
    const result = await graph.query(
      `MATCH (x:Demonstration) WHERE x.id IN $ids
         AND ($developer_id = "" OR x.developer_id = $developer_id)
       MATCH (m:Mission {id: $mission_id})
       SET x.github_backed = CASE
             WHEN x.github_backed IS NOT NULL THEN x.github_backed
             ELSE coalesce(x.source, "github") <> "mission"
           END,
           x.source = "mission", x.mission_id = $mission_id
       MERGE (x)-[v:VERIFIED_BY_MISSION]->(m)
       SET v.evaluation_id = $evaluation_id, v.head_sha = x.commit_sha
       RETURN count(x) AS n`,
      {
        params: {
          ids: batch,
          mission_id: missionId,
          evaluation_id: evaluationId,
          developer_id: developerId,
        },
      },
    );
    updated += Number(
      (result.data?.[0] as { n?: unknown } | undefined)?.n ?? 0,
    );
  }
  return updated;
}
