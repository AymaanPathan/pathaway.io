import { createHash } from "node:crypto";
import type { Graph } from "../db/falkordb.js";
import {
  groupDemonstrationsIntoExperiences,
  type Demonstration,
} from "../graph/developer-knowledge-graph.js";

function fingerprint(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

/** Rebuild developer-scoped experience aggregates from all currently linked evidence. */
export async function updateExperiences(
  graph: Graph,
  developerId: string,
): Promise<number> {
  const result = await graph.query(
    `
    MATCH (:Developer {id:$developer_id})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability)
    OPTIONAL MATCH (x)-[:IN_CONTEXT]->(ctx:EngineeringContext)
    OPTIONAL MATCH (x)-[:IN_REPOSITORY]->(r:Repository)
    OPTIONAL MATCH (x)-[:USES]->(s:Skill)
    RETURN x.id AS id, x.rule_id AS ruleId, c.id AS capabilityId,
      x.technique AS technique, x.modifiers AS modifiers, x.depth AS depth,
      x.summary AS summary, x.file_change_id AS fileChangeId,
      x.repository_id AS repositoryId, x.commit_sha AS commitSha, x.path AS path,
      x.language AS language, x.start_line AS startLine, x.end_line AS endLine,
      x.snippet AS snippet, x.permalink AS permalink, x.change_intent AS intent,
      x.commit_subject AS commitSubject, x.created_at AS createdAt,
      collect(DISTINCT ctx.id) AS contexts, collect(DISTINCT s.id) AS skills`,
    { params: { developer_id: developerId } },
  );
  const demos = ((result.data ?? []) as any[]).map((r) => ({
    id: String(r.id ?? ""),
    ruleId: String(r.ruleId ?? ""),
    capabilityId: String(r.capabilityId ?? ""),
    technique: String(r.technique ?? ""),
    modifiers: String(r.modifiers ?? "")
      .split(" | ")
      .filter(Boolean),
    depth: (r.depth || "usage") as Demonstration["depth"],
    summary: String(r.summary ?? ""),
    fileChangeId: String(r.fileChangeId ?? ""),
    repositoryId: String(r.repositoryId ?? ""),
    commitSha: String(r.commitSha ?? ""),
    path: String(r.path ?? ""),
    language: String(r.language ?? ""),
    startLine: Number(r.startLine ?? 0),
    endLine: Number(r.endLine ?? 0),
    snippet: String(r.snippet ?? ""),
    permalink: String(r.permalink ?? ""),
    intent: String(r.intent ?? "change"),
    commitSubject: String(r.commitSubject ?? ""),
    createdAt: String(r.createdAt ?? ""),
    layerId: Array.isArray(r.contexts) ? String(r.contexts[0] ?? "") : "",
    layerName: "",
    usesSkillIds: Array.isArray(r.skills) ? r.skills.map(String) : [],
  })) as Demonstration[];
  if (!demos.length) return 0;

  const experiences = groupDemonstrationsIntoExperiences(demos, developerId);
  for (const e of experiences) {
    await graph.query(
      `
      MERGE (e:Experience {id:$id})
      SET e.fingerprint=$fingerprint, e.summary=$summary,
          e.problem_statement=$problem_statement, e.capability_id=$capability_id,
          e.technique=$technique, e.evidence_count=$evidence_count,
          e.commit_count=$commit_count, e.repo_count=$repo_count,
          e.active_days=$active_days, e.best_depth=$best_depth,
          e.first_seen=$first_seen, e.last_seen=$last_seen,
          e.developer_id=$developer_id
      RETURN e.id AS id`,
      {
        params: {
          id: e.id,
          fingerprint: e.fingerprint,
          summary: e.summary,
          problem_statement: e.problemStatement,
          capability_id: e.capabilityId,
          technique: e.technique,
          evidence_count: e.evidenceCount,
          commit_count: e.commitCount,
          repo_count: e.repoCount,
          active_days: e.activeDays,
          best_depth: e.bestDepth,
          first_seen: e.firstSeen,
          last_seen: e.lastSeen,
          developer_id: developerId,
        },
      },
    );

    await graph.query(
      `MATCH (d:Developer {id:$developer_id}), (e:Experience {id:$experience_id}) MERGE (d)-[:EXPERIENCED]->(e)`,
      { params: { developer_id: developerId, experience_id: e.id } },
    );
    await graph.query(
      `MATCH (e:Experience {id:$experience_id}), (c:Capability {id:$capability_id}) MERGE (e)-[:DEMONSTRATES_CAPABILITY]->(c)`,
      { params: { experience_id: e.id, capability_id: e.capabilityId } },
    );

    const evidenceIds = [...new Set(e.demonstrationIds)];
    if (evidenceIds.length)
      await graph.query(
        `UNWIND $ids AS id MATCH (e:Experience {id:$experience_id}), (x:Demonstration {id:id}) MERGE (e)-[:SUPPORTED_BY]->(x)`,
        { params: { ids: evidenceIds, experience_id: e.id } },
      );
    const fileIds = [...new Set(e.fileChangeIds)];
    if (fileIds.length)
      await graph.query(
        `UNWIND $ids AS id MATCH (e:Experience {id:$experience_id}), (fc:FileChange {id:id}) MERGE (e)-[:EVIDENCED_BY]->(fc)`,
        { params: { ids: fileIds, experience_id: e.id } },
      );
    const repositoryIds = [...new Set(e.repositoryIds)];
    if (repositoryIds.length)
      await graph.query(
        `UNWIND $ids AS id MATCH (e:Experience {id:$experience_id}), (r:Repository {id:id}) MERGE (e)-[:OCCURS_IN]->(r)`,
        { params: { ids: repositoryIds, experience_id: e.id } },
      );
    const contextIds = [...new Set(e.contextIds)];
    if (contextIds.length)
      await graph.query(
        `UNWIND $ids AS id MATCH (e:Experience {id:$experience_id}), (ctx:EngineeringContext {id:id}) MERGE (e)-[:IN_CONTEXT]->(ctx)`,
        { params: { ids: contextIds, experience_id: e.id } },
      );
    await graph.query(
      `MERGE (t:Technique {id:$id}) SET t.name=$name WITH t MATCH (e:Experience {id:$experience_id}) MERGE (e)-[:USES_TECHNIQUE]->(t)`,
      {
        params: {
          id: `technique:${fingerprint(
            e.technique
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, " ")
              .trim()
              .replace(/\s+/g, " "),
          )}`,
          name: e.technique,
          experience_id: e.id,
        },
      },
    );
  }
  return experiences.length;
}
