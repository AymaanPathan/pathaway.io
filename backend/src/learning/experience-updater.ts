import { createHash } from "node:crypto";
import type { Graph } from "../db/falkordb.js";
import {
  groupDemonstrationsIntoExperiences,
  type Demonstration,
} from "../graph/developer-knowledge-graph.js";

function techniqueIdFor(technique: string): string {
  const normalized = technique
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return `technique:${createHash("sha1").update(normalized).digest("hex").slice(0, 16)}`;
}

/** Rebuild developer-scoped experience aggregates from all current linked evidence. */
export async function updateExperiences(
  graph: Graph,
  developerId: string,
): Promise<number> {
  const result = await graph.query(
    `
    MATCH (:Developer {id:$developer_id})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability)
    OPTIONAL MATCH (x)-[:IN_CONTEXT]->(ctx:EngineeringContext)
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

  const demos = ((result.data ?? []) as any[]).map((row) => ({
    id: String(row.id ?? ""),
    ruleId: String(row.ruleId ?? ""),
    capabilityId: String(row.capabilityId ?? ""),
    technique: String(row.technique ?? ""),
    modifiers: String(row.modifiers ?? "")
      .split(" | ")
      .filter(Boolean),
    depth: (row.depth || "usage") as Demonstration["depth"],
    summary: String(row.summary ?? ""),
    fileChangeId: String(row.fileChangeId ?? ""),
    repositoryId: String(row.repositoryId ?? ""),
    commitSha: String(row.commitSha ?? ""),
    path: String(row.path ?? ""),
    language: String(row.language ?? ""),
    startLine: Number(row.startLine ?? 0),
    endLine: Number(row.endLine ?? 0),
    snippet: String(row.snippet ?? ""),
    permalink: String(row.permalink ?? ""),
    intent: String(row.intent ?? "change"),
    commitSubject: String(row.commitSubject ?? ""),
    createdAt: String(row.createdAt ?? ""),
    layerId: Array.isArray(row.contexts)
      ? String(row.contexts.find(Boolean) ?? "")
      : "",
    layerName: "",
    usesSkillIds: Array.isArray(row.skills)
      ? row.skills.filter(Boolean).map(String)
      : [],
  })) as Demonstration[];

  if (!demos.length) return 0;
  const experiences = groupDemonstrationsIntoExperiences(demos, developerId);
  const batch = async (
    query: string,
    rows: Array<Record<string, string | number | null>>,
  ) => {
    const size = 200;
    for (let i = 0; i < rows.length; i += size) {
      await graph.query(query, {
        params: { developer_id: developerId, rows: rows.slice(i, i + size) },
      });
    }
  };

  await batch(
    `UNWIND $rows AS item MERGE (e:Experience {id:item.id})
    SET e.fingerprint=item.fingerprint, e.summary=item.summary,
      e.problem_statement=item.problem_statement, e.capability_id=item.capability_id,
      e.technique=item.technique, e.evidence_count=item.evidence_count,
      e.commit_count=item.commit_count, e.repo_count=item.repo_count,
      e.active_days=item.active_days, e.best_depth=item.best_depth,
      e.first_seen=item.first_seen, e.last_seen=item.last_seen, e.developer_id=$developer_id
    RETURN count(e) AS n`,
    experiences.map((e) => ({
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
    })),
  );

  await batch(
    `UNWIND $rows AS item MATCH (d:Developer {id:$developer_id})
    MATCH (e:Experience {id:item.experience_id}) MERGE (d)-[:EXPERIENCED]->(e) RETURN count(e) AS n`,
    experiences.map((e) => ({ experience_id: e.id })),
  );
  await batch(
    `UNWIND $rows AS item MATCH (e:Experience {id:item.experience_id})
    MATCH (c:Capability {id:item.capability_id}) MERGE (e)-[:DEMONSTRATES_CAPABILITY]->(c) RETURN count(e) AS n`,
    experiences.map((e) => ({
      experience_id: e.id,
      capability_id: e.capabilityId,
    })),
  );
  await batch(
    `UNWIND $rows AS item MATCH (e:Experience {id:item.experience_id})
    MERGE (p:Problem {id:item.problem_id}) SET p.statement=item.problem_statement,
      p.capability_id=item.capability_id, p.developer_id=$developer_id
    MERGE (e)-[:SOLVES]->(p) RETURN count(e) AS n`,
    experiences.map((e) => ({
      experience_id: e.id,
      problem_id: e.problemId,
      problem_statement: e.problemStatement,
      capability_id: e.capabilityId,
    })),
  );
  await batch(
    `UNWIND $rows AS item MATCH (e:Experience {id:item.experience_id})
    MERGE (t:Technique {id:item.technique_id}) SET t.name=item.technique
    MERGE (e)-[:USES_TECHNIQUE]->(t) RETURN count(e) AS n`,
    experiences.map((e) => ({
      experience_id: e.id,
      technique_id: techniqueIdFor(e.technique),
      technique: e.technique,
    })),
  );

  const relationshipRows = <T extends string>(
    items: T[],
    experienceId: string,
    key: string,
  ) =>
    [...new Set(items.filter(Boolean))].map((id) => ({
      experience_id: experienceId,
      [key]: id,
    }));
  for (const e of experiences) {
    await batch(
      `UNWIND $rows AS item MATCH (e:Experience {id:item.experience_id})
      MATCH (x:Demonstration {id:item.demonstration_id}) MERGE (e)-[:SUPPORTED_BY]->(x) RETURN count(e) AS n`,
      relationshipRows(e.demonstrationIds, e.id, "demonstration_id"),
    );
    await batch(
      `UNWIND $rows AS item MATCH (e:Experience {id:item.experience_id})
      MATCH (fc:FileChange {id:item.file_change_id}) MERGE (e)-[:EVIDENCED_BY]->(fc) RETURN count(e) AS n`,
      relationshipRows(e.fileChangeIds, e.id, "file_change_id"),
    );
    await batch(
      `UNWIND $rows AS item MATCH (e:Experience {id:item.experience_id})
      MATCH (r:Repository {id:item.repository_id}) MERGE (e)-[:OCCURS_IN]->(r) RETURN count(e) AS n`,
      relationshipRows(e.repositoryIds, e.id, "repository_id"),
    );
    await batch(
      `UNWIND $rows AS item MATCH (e:Experience {id:item.experience_id})
      MATCH (ctx:EngineeringContext {id:item.context_id}) MERGE (e)-[:IN_CONTEXT]->(ctx) RETURN count(e) AS n`,
      relationshipRows(e.contextIds, e.id, "context_id"),
    );
    const technologyNames: Record<string, string> = {
      redis: "Redis",
      postgres: "PostgreSQL",
      postgresql: "PostgreSQL",
      sql: "SQL",
      prisma: "Prisma",
      mongodb: "MongoDB",
      falkordb: "FalkorDB",
      nodejs: "Node.js",
      express: "Express",
      nextjs: "Next.js",
      react: "React",
    };
    await batch(
      `UNWIND $rows AS item MATCH (e:Experience {id:item.experience_id})
      MERGE (t:Technology {id:item.technology_id}) SET t.name=item.technology_name
      MERGE (e)-[:USES_TECHNOLOGY]->(t) RETURN count(e) AS n`,
      e.technologyIds
        .filter((id) => technologyNames[id])
        .map((id) => ({
          experience_id: e.id,
          technology_id: id,
          technology_name: technologyNames[id] ?? id,
        })),
    );
  }
  return experiences.length;
}
