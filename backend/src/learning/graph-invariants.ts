import { createHash } from "node:crypto";
import type { Graph } from "../db/falkordb.js";
import {
  groupDemonstrationsIntoExperiences,
  rollUpDemonstrations,
} from "../graph/developer-knowledge-graph.js";
import { loadRollupInputs, ROLLUP_EDGE_OWNER } from "./capability-recalculator.js";
import { loadDemonstrations } from "./experience-updater.js";

export interface InvariantViolation {
  invariant: string;
  detail: string;
}

export class GraphInvariantError extends Error {
  constructor(public readonly violations: InvariantViolation[]) {
    super(
      `Graph invariants violated (${violations.length}): ` +
        violations
          .slice(0, 10)
          .map((v) => `[${v.invariant}] ${v.detail}`)
          .join("; "),
    );
    this.name = "GraphInvariantError";
  }
}

async function rows(
  graph: Graph,
  query: string,
  params: Record<string, unknown>,
): Promise<any[]> {
  const result = await graph.query(query, { params });
  return (result.data ?? []) as any[];
}

/** Returns every violated invariant for one developer. Empty array = healthy graph. */
export async function checkGraphInvariants(
  graph: Graph,
  developerId: string,
): Promise<InvariantViolation[]> {
  const violations: InvariantViolation[] = [];
  const add = (invariant: string, detail: string) =>
    violations.push({ invariant, detail });
  const params = { developer_id: developerId };

  // 1 + 2. Active demonstrations point at Developer, Capability, FileChange, Repository,
  //        and agree with their FileChange on repository and commit.
  const demoRows = await rows(
    graph,
    `MATCH (x:Demonstration {developer_id:$developer_id})
     OPTIONAL MATCH (d:Developer {id:$developer_id})-[:DEMONSTRATED]->(x)
     OPTIONAL MATCH (x)-[:OF_CAPABILITY]->(c:Capability)
     OPTIONAL MATCH (x)-[:EVIDENCED_BY]->(fc:FileChange)
     OPTIONAL MATCH (x)-[:IN_REPOSITORY]->(r:Repository)
     RETURN x.id AS id, x.repository_id AS repositoryId, x.commit_sha AS sha,
       count(DISTINCT d) AS developers, count(DISTINCT c) AS capabilities,
       collect(DISTINCT fc.repository_id) AS fcRepos,
       collect(DISTINCT fc.commit_sha) AS fcShas,
       collect(DISTINCT r.id) AS repos`,
    params,
  );
  for (const row of demoRows) {
    const id = String(row.id);
    const fcRepos = ((row.fcRepos ?? []) as unknown[]).filter(Boolean).map(String);
    const fcShas = ((row.fcShas ?? []) as unknown[]).filter(Boolean).map(String);
    const repos = ((row.repos ?? []) as unknown[]).filter(Boolean).map(String);
    if (Number(row.developers) !== 1)
      add("demonstration-has-developer", `${id} has ${row.developers} DEMONSTRATED edges`);
    if (Number(row.capabilities) < 1)
      add("demonstration-has-capability", `${id} has no OF_CAPABILITY edge`);
    if (!fcRepos.length && !fcShas.length)
      add("demonstration-has-filechange", `${id} has no EVIDENCED_BY FileChange`);
    if (!repos.includes(String(row.repositoryId)))
      add("demonstration-has-repository", `${id} is not linked to repository ${row.repositoryId}`);
    if (fcRepos.some((repo) => repo !== String(row.repositoryId)))
      add("demonstration-matches-filechange-repo", `${id} repository differs from its FileChange`);
    if (fcShas.some((sha) => sha !== String(row.sha)))
      add("demonstration-matches-filechange-commit", `${id} commit differs from its FileChange`);
  }

  // 3. Capability roll-ups equal what the canonical active demonstrations derive.
  const expectedRollups = new Map(
    rollUpDemonstrations(await loadRollupInputs(graph, developerId)).map(
      (item) => [item.capabilityId, item],
    ),
  );
  const actualRollups = await rows(
    graph,
    `MATCH (:Developer {id:$developer_id})-[r:HAS_CAPABILITY]->(c:Capability)
     WHERE r.derived_by = $owner OR r.techniques_json IS NOT NULL
     RETURN c.id AS id, r.evidence_count AS evidenceCount, r.commit_count AS commitCount,
       r.repo_count AS repoCount, r.technique_count AS techniqueCount,
       r.best_depth AS bestDepth, r.active_days AS activeDays`,
    { ...params, owner: ROLLUP_EDGE_OWNER },
  );
  const seenCapabilities = new Set<string>();
  for (const row of actualRollups) {
    const id = String(row.id);
    seenCapabilities.add(id);
    const expected = expectedRollups.get(id);
    if (!expected) {
      add("capability-rollup-supported", `HAS_CAPABILITY ${id} has no supporting demonstrations`);
      continue;
    }
    const pairs: Array<[string, unknown, unknown]> = [
      ["evidence_count", row.evidenceCount, expected.evidenceCount],
      ["commit_count", row.commitCount, expected.commitCount],
      ["repo_count", row.repoCount, expected.repoCount],
      ["technique_count", row.techniqueCount, expected.techniqueCount],
      ["active_days", row.activeDays, expected.activeDays],
      ["best_depth", row.bestDepth, expected.bestDepth],
    ];
    for (const [name, actual, want] of pairs) {
      if (String(actual) !== String(want))
        add("capability-rollup-matches-evidence", `${id}.${name} is ${actual}, expected ${want}`);
    }
  }
  for (const id of expectedRollups.keys())
    if (!seenCapabilities.has(id))
      add("capability-rollup-present", `capability ${id} has evidence but no HAS_CAPABILITY roll-up`);

  // 4. Experience aggregates match their current supporting evidence.
  const demos = await loadDemonstrations(graph, developerId);
  const expectedExperiences = new Map(
    (demos.length ? groupDemonstrationsIntoExperiences(demos, developerId) : []).map(
      (e) => [e.id, e],
    ),
  );
  const actualExperiences = await rows(
    graph,
    `MATCH (e:Experience {developer_id:$developer_id})
     OPTIONAL MATCH (e)-[:SUPPORTED_BY]->(x:Demonstration)
     RETURN e.id AS id, e.evidence_count AS evidenceCount, e.commit_count AS commitCount,
       e.repo_count AS repoCount, count(DISTINCT x) AS supported`,
    params,
  );
  const seenExperiences = new Set<string>();
  for (const row of actualExperiences) {
    const id = String(row.id);
    seenExperiences.add(id);
    const expected = expectedExperiences.get(id);
    if (!expected) {
      add("experience-supported", `Experience ${id} has no current supporting evidence`);
      continue;
    }
    if (String(row.evidenceCount) !== String(expected.evidenceCount))
      add("experience-matches-evidence", `${id}.evidence_count is ${row.evidenceCount}, expected ${expected.evidenceCount}`);
    if (String(row.commitCount) !== String(expected.commitCount))
      add("experience-matches-evidence", `${id}.commit_count is ${row.commitCount}, expected ${expected.commitCount}`);
    if (String(row.repoCount) !== String(expected.repoCount))
      add("experience-matches-evidence", `${id}.repo_count is ${row.repoCount}, expected ${expected.repoCount}`);
    const wantedSupport = new Set(expected.demonstrationIds.filter(Boolean)).size;
    if (Number(row.supported) !== wantedSupport)
      add("experience-matches-evidence", `${id} has ${row.supported} SUPPORTED_BY edges, expected ${wantedSupport}`);
  }
  for (const id of expectedExperiences.keys())
    if (!seenExperiences.has(id))
      add("experience-present", `Experience ${id} is missing`);

  // 5. Mission evidence must be backed by a passed, verified, non-retracted evaluation.
  const unverifiedMission = await rows(
    graph,
    `MATCH (x:Demonstration {developer_id:$developer_id, source:"mission"})
     OPTIONAL MATCH (x)-[:VERIFIED_BY_MISSION]->(:Mission)-[:EVALUATED_AS]->(e:Evaluation)
     WHERE coalesce(e.retracted, false) = false
       AND coalesce(e.verified, e.overall = "passed" AND e.verdict = "completed") = true
     WITH x, count(e) AS good
     WHERE good = 0
     RETURN x.id AS id`,
    params,
  );
  for (const row of unverifiedMission)
    add("mission-evidence-verified", `${row.id} is mission evidence without a verified evaluation`);

  const staleLinks = await rows(
    graph,
    `MATCH (x:Demonstration {developer_id:$developer_id})-[v:VERIFIED_BY_MISSION]->(:Mission)
     MATCH (e:Evaluation) WHERE e.id = v.evaluation_id
       AND (coalesce(e.verified, true) = false OR coalesce(e.retracted, false) = true)
     RETURN x.id AS id, e.id AS evaluation`,
    params,
  );
  for (const row of staleLinks)
    add("no-link-from-unverified-evaluation", `${row.id} is linked from unverified/retracted ${row.evaluation}`);

  return violations;
}

export async function assertGraphInvariants(
  graph: Graph,
  developerId: string,
): Promise<void> {
  const violations = await checkGraphInvariants(graph, developerId);
  if (violations.length) throw new GraphInvariantError(violations);
}

/**
 * Stable digest of the learning-derived graph state for one developer. Excludes
 * timestamps, build ids and time-dependent roll-up fields (level, recency), so
 * replaying the same operation must return the identical fingerprint.
 */
export async function graphFingerprint(
  graph: Graph,
  developerId: string,
): Promise<string> {
  const params = { developer_id: developerId };
  const demos = await rows(
    graph,
    `MATCH (x:Demonstration {developer_id:$developer_id})
     RETURN x.id AS id, x.source AS source, x.mission_id AS missionId,
       x.github_backed AS githubBacked, x.depth AS depth, x.technique AS technique
     ORDER BY id`,
    params,
  );
  const demoEdges = await rows(
    graph,
    `MATCH (x:Demonstration {developer_id:$developer_id})-[r]->()
     RETURN type(r) AS type, count(r) AS n ORDER BY type`,
    params,
  );
  const experiences = await rows(
    graph,
    `MATCH (e:Experience {developer_id:$developer_id})
     RETURN e.id AS id, e.evidence_count AS evidenceCount, e.commit_count AS commitCount,
       e.repo_count AS repoCount, e.best_depth AS bestDepth ORDER BY id`,
    params,
  );
  const experienceEdges = await rows(
    graph,
    `MATCH (e:Experience {developer_id:$developer_id})-[r]->()
     RETURN type(r) AS type, count(r) AS n ORDER BY type`,
    params,
  );
  const capabilities = await rows(
    graph,
    `MATCH (:Developer {id:$developer_id})-[r:HAS_CAPABILITY]->(c:Capability)
     RETURN c.id AS id, r.evidence_count AS evidenceCount, r.commit_count AS commitCount,
       r.repo_count AS repoCount, r.technique_count AS techniqueCount,
       r.best_depth AS bestDepth, r.active_days AS activeDays ORDER BY id`,
    params,
  );
  const counts = await rows(
    graph,
    `MATCH (f:FileChange {developer_id:$developer_id})
     WITH count(f) AS fileChanges
     OPTIONAL MATCH (c:Commit {developer_id:$developer_id})
     RETURN fileChanges, count(c) AS commits`,
    params,
  );
  return createHash("sha1")
    .update(
      JSON.stringify({
        demos,
        demoEdges,
        experiences,
        experienceEdges,
        capabilities,
        counts,
      }),
    )
    .digest("hex");
}
