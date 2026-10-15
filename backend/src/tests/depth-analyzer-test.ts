/**
 * Pathway depth-graph behavior test (read/diagnose only, except schema/index
 * initialization performed by depth-analyzer-graph helpers).
 *
 * Purpose: understand what the depth graph can reliably tell a future goal
 * graph/agent: developer state, depth assessments, evidence provenance, topic
 * dependencies, and missing/disconnected graph paths. This test DOES NOT
 * create goals, missions, recommendations, or modify developer assessments.
 *
 * Run from backend:
 *   npx tsx tests/developer-understanding.test.ts
 *
 * Optional environment variables:
 *   DEVELOPER_ID=118355098
 *   DEPTH_TEST_TOPIC=rate_limit_handling
 *   DEPTH_TEST_VERBOSE=1
 */
import assert from "node:assert/strict";
import { getGraphForDeveloper } from "../db/falkordb.js";
import {
  listTopicCatalog,
  readDeveloperTopicProfile,
  readEvidenceAtlas,
  readStoredTopicSpec,
  readTopicContext,
  readTopicDepthDetail,
  readTopicPath,
} from "../graph/depth-analyzer-graph.js";

const DEVELOPER_ID = process.env.DEVELOPER_ID?.trim() || "118355098";
const TARGET_TOPIC =
  process.env.DEPTH_TEST_TOPIC?.trim() || "rate_limit_handling";
const VERBOSE = process.env.DEPTH_TEST_VERBOSE === "1";
type Row = Record<string, any>;
type Graph = Awaited<ReturnType<typeof getGraphForDeveloper>>;

const failures: string[] = [];
const warnings: string[] = [];
const observations: Array<{
  check: string;
  status: "PASS" | "WARN" | "FAIL";
  detail: string;
}> = [];

function record(
  check: string,
  status: "PASS" | "WARN" | "FAIL",
  detail: string,
): void {
  observations.push({ check, status, detail });
  const line = `[${status}] ${check}: ${detail}`;
  if (status === "FAIL") failures.push(line);
  if (status === "WARN") warnings.push(line);
  console.log(line);
}

function count(rows: Row[] | undefined, key = "count"): number {
  return Number(rows?.[0]?.[key] ?? 0);
}

async function queryRows(
  graph: Graph,
  query: string,
  params: Record<string, string | number | boolean> = {},
): Promise<Row[]> {
  const result = await graph.query(query, { params });
  return (result.data ?? []) as Row[];
}

function section(title: string, value: unknown): void {
  console.log(`\n--- ${title} ---`);
  if (VERBOSE)
    console.dir(value, { depth: 5, colors: true, maxArrayLength: 30 });
  else console.log(JSON.stringify(value, null, 2));
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

async function main(): Promise<void> {
  console.log("\n============================================================");
  console.log("PATHWAY DEPTH GRAPH — BEHAVIOR & GOAL-GRAPH READINESS");
  console.log(`Developer: ${DEVELOPER_ID} | Target topic: ${TARGET_TOPIC}`);
  console.log("Read-only investigation; no goal or mission generation.");
  console.log("============================================================\n");

  const graph = await getGraphForDeveloper(DEVELOPER_ID);

  // 1. Database and developer identity: true prerequisites, so these fail hard.
  const ping = await queryRows(graph, "RETURN 1 AS ok");
  assert.equal(Number(ping[0]?.ok), 1, "FalkorDB query/ping failed");
  record(
    "FalkorDB connection",
    "PASS",
    "A parameterized Cypher query executed.",
  );

  const developerRows = await queryRows(
    graph,
    `MATCH (d:Developer {id: $developerId})
     RETURN d.id AS id, labels(d) AS labels, keys(d) AS properties,
            coalesce(d.topic_depth_summary_json, "") AS hasDepthSummary
     LIMIT 1`,
    { developerId: DEVELOPER_ID },
  );
  assert.equal(
    String(developerRows[0]?.id ?? ""),
    DEVELOPER_ID,
    `Developer ${DEVELOPER_ID} does not exist in the selected FalkorDB graph`,
  );
  section("Developer identity and available properties", developerRows[0]);
  record("Developer identity", "PASS", "Developer node exists.");

  // 2. Count direct graph relationships. These are observations, not assumed counts.
  const direct = await queryRows(
    graph,
    `MATCH (d:Developer {id: $developerId})-[r]->(n)
     RETURN type(r) AS relationship, labels(n) AS targetLabels, count(*) AS count
     ORDER BY count DESC, relationship`,
    { developerId: DEVELOPER_ID },
  );
  const nodeCounts = await queryRows(
    graph,
    `MATCH (d:Developer {id: $developerId})
     OPTIONAL MATCH (d)-[:ASSESSED]->(a:DepthAssessment)
     WITH d, count(a) AS assessments
     OPTIONAL MATCH (d)-[:KNOWS_TOPIC]->(t:Topic)
     WITH d, assessments, count(t) AS knownTopics
     OPTIONAL MATCH (d)-[:HAS_CAPABILITY]->(c:Capability)
     WITH d, assessments, knownTopics, count(c) AS capabilities
     OPTIONAL MATCH (d)-[:DEMONSTRATED]->(x:Demonstration)
     WITH d, assessments, knownTopics, capabilities, count(x) AS demonstrations
     OPTIONAL MATCH (d)-[:AUTHORED_CODE]->(f:FileChange)
     RETURN assessments, knownTopics, capabilities, demonstrations, count(f) AS fileChanges`,
    { developerId: DEVELOPER_ID },
  );
  section("Developer direct outgoing relationships", direct);
  section("Developer profile counts", nodeCounts[0] ?? {});
  const rawCounts = nodeCounts[0] ?? {};
  const assessmentCount = Number(rawCounts.assessments ?? 0);
  record(
    "Depth assessment coverage",
    assessmentCount > 0 ? "PASS" : "WARN",
    `${assessmentCount} assessment(s) are directly connected to the developer.`,
  );

  // 3. Use the actual production read path, then compare its output to raw graph data.
  const profile = await readDeveloperTopicProfile(graph, DEVELOPER_ID);
  const catalog = await listTopicCatalog(graph, 500);
  assert.equal(
    profile.developerId,
    DEVELOPER_ID,
    "Profile returned the wrong developer ID",
  );
  assert.ok(Array.isArray(profile.topics), "Profile topics must be an array");
  assert.ok(Array.isArray(profile.domains), "Profile domains must be an array");
  section("Production depth-profile summary", {
    topics: profile.topics.length,
    domains: profile.domains,
    clusters: profile.clusters,
    summary: profile.summary,
    topicLevels: profile.topics.map((t) => ({
      slug: t.slug,
      name: t.name,
      domain: t.domain,
      level: t.level,
      score: t.score,
      baselineScore: t.baselineScore,
      confidence: t.confidence,
      authenticity: t.authenticity,
      fallback: t.fallback,
      files: t.files,
      commits: t.commits,
      repos: t.repos,
      activeDays: t.activeDays,
      approaches: t.approaches.length,
    })),
  });
  record(
    "Production profile read",
    "PASS",
    `readDeveloperTopicProfile returned ${profile.topics.length} assessed topic(s) across ${profile.domains.length} domain(s).`,
  );

  // 4. Validate assessment/profile semantics without hardcoding expected levels or counts.
  const invalidScores = profile.topics.filter(
    (t) => !isFiniteNumber(t.score) || t.score < 0 || t.score > 100,
  );
  const invalidBaselines = profile.topics.filter(
    (t) =>
      !isFiniteNumber(t.baselineScore) ||
      t.baselineScore < 0 ||
      t.baselineScore > 100,
  );
  const missingSlugs = profile.topics.filter((t) => !t.slug);
  const duplicateSlugs = profile.topics
    .map((t) => t.slug)
    .filter((slug, i, all) => all.indexOf(slug) !== i);
  const emptyDomainTopics = profile.topics.filter((t) => !t.domain);
  const scoreProblems =
    invalidScores.length +
    invalidBaselines.length +
    missingSlugs.length +
    duplicateSlugs.length;
  record(
    "Assessment shape and score bounds",
    scoreProblems === 0 ? "PASS" : "FAIL",
    `${invalidScores.length} invalid score(s), ${invalidBaselines.length} invalid baseline(s), ${missingSlugs.length} missing slug(s), ${duplicateSlugs.length} duplicate profile slug(s).`,
  );
  if (emptyDomainTopics.length)
    record(
      "Topic domain completeness",
      "WARN",
      `${emptyDomainTopics.length} assessed topic(s) have no domain; profile groups them under 'other'.`,
    );

  const assessmentConsistency = await queryRows(
    graph,
    `MATCH (d:Developer {id: $developerId})-[:ASSESSED]->(a:DepthAssessment)
     OPTIONAL MATCH (a)-[:OF_TOPIC]->(t:Topic)
     RETURN count(a) AS assessments,
            sum(CASE WHEN t IS NULL THEN 1 ELSE 0 END) AS withoutTopic,
            sum(CASE WHEN coalesce(a.topic_slug, "") = "" THEN 1 ELSE 0 END) AS withoutTopicSlug,
            sum(CASE WHEN t IS NOT NULL AND a.topic_slug <> t.slug THEN 1 ELSE 0 END) AS slugMismatch,
            sum(CASE WHEN a.score IS NULL THEN 1 ELSE 0 END) AS withoutScore,
            sum(CASE WHEN a.level IS NULL OR a.level = "" THEN 1 ELSE 0 END) AS withoutLevel`,
    { developerId: DEVELOPER_ID },
  );
  const consistency = assessmentConsistency[0] ?? {};
  section("Raw assessment-to-topic integrity", consistency);
  const brokenAssessmentLinks = [
    "withoutTopic",
    "withoutTopicSlug",
    "slugMismatch",
    "withoutScore",
    "withoutLevel",
  ].reduce((sum, key) => sum + Number(consistency[key] ?? 0), 0);
  record(
    "Assessment-to-topic integrity",
    brokenAssessmentLinks === 0 ? "PASS" : "WARN",
    `${brokenAssessmentLinks} missing/mismatched assessment field(s) across ${Number(consistency.assessments ?? 0)} assessment(s).`,
  );

  // 5. Trace depth assessments to the exact evidence objects they claim support them.
  const evidenceLinks = await queryRows(
    graph,
    `MATCH (d:Developer {id: $developerId})-[:ASSESSED]->(a:DepthAssessment)
     OPTIONAL MATCH (a)-[r:BACKED_BY]->(e)
     RETURN a.topic_slug AS topic, a.level AS level, a.score AS score,
            count(r) AS backingEdges,
            collect(DISTINCT labels(e)) AS evidenceNodeLabels,
            collect(DISTINCT type(r)) AS evidenceRelationships
     ORDER BY backingEdges DESC, topic`,
    { developerId: DEVELOPER_ID },
  );
  const evidenceCoverage = await queryRows(
    graph,
    `MATCH (d:Developer {id: $developerId})-[:ASSESSED]->(a:DepthAssessment)
     OPTIONAL MATCH (a)-[:BACKED_BY]->(e)
     RETURN count(DISTINCT a) AS assessments,
            count(DISTINCT CASE WHEN e IS NOT NULL THEN a END) AS withBackingEdges,
            count(DISTINCT e) AS backingNodes`,
    { developerId: DEVELOPER_ID },
  );
  section("Assessment → BACKED_BY evidence paths", evidenceLinks);
  section("Evidence traceability coverage", evidenceCoverage[0] ?? {});
  const ev = evidenceCoverage[0] ?? {};
  const assessed = Number(ev.assessments ?? 0);
  const backed = Number(ev.withBackingEdges ?? 0);
  record(
    "Assessment evidence traceability",
    assessed === 0 || backed === assessed ? "PASS" : "WARN",
    `${backed}/${assessed} assessments have a BACKED_BY edge; ${Number(ev.backingNodes ?? 0)} distinct backing node(s). A missing edge may mean evidence is stored only in assessment JSON, so inspect both representations.`,
  );

  const jsonEvidence = await queryRows(
    graph,
    `MATCH (d:Developer {id: $developerId})-[:ASSESSED]->(a:DepthAssessment)
     RETURN a.topic_slug AS topic,
            size(coalesce(a.evidence_json, "")) AS evidenceJsonChars,
            size(coalesce(a.strengths_json, "")) AS strengthsJsonChars,
            size(coalesce(a.gaps_json, "")) AS gapsJsonChars,
            size(coalesce(a.approaches_json, "")) AS approachesJsonChars,
            size(coalesce(a.spec_json, "")) AS specJsonChars
     ORDER BY topic`,
    { developerId: DEVELOPER_ID },
  );
  section(
    "Assessment payload availability (JSON stored on nodes)",
    jsonEvidence,
  );

  // 6. Validate approach modelling and compare the edge representation with stored JSON.
  const approaches = await queryRows(
    graph,
    `MATCH (d:Developer {id: $developerId})-[:ASSESSED]->(a:DepthAssessment)
     OPTIONAL MATCH (a)-[ua:USES_APPROACH]->(ap:Approach)
     OPTIONAL MATCH (ap)-[:APPROACH_OF]->(t:Topic)
     RETURN a.topic_slug AS topic, count(DISTINCT ap) AS approachNodes,
            count(ua) AS approachEdges,
            collect(DISTINCT ap.slug) AS approachSlugs,
            collect(DISTINCT t.slug) AS linkedTopicSlugs
     ORDER BY topic`,
    { developerId: DEVELOPER_ID },
  );
  section("Assessment → Approach → Topic paths", approaches);
  const brokenApproaches = approaches.filter(
    (r) =>
      Number(r.approachEdges ?? 0) > 0 && !Array.isArray(r.linkedTopicSlugs),
  );
  if (brokenApproaches.length)
    record(
      "Approach graph links",
      "WARN",
      `${brokenApproaches.length} topic(s) have approach edges but no returned topic links.`,
    );
  else
    record(
      "Approach graph links",
      "PASS",
      "Approach paths were inspected; zero-edge topics are retained as useful diagnostics.",
    );

  // 7. Evidence atlas shows what the analyzer can actually observe before topic matching.
  const atlas = await readEvidenceAtlas(graph, DEVELOPER_ID);
  assert.ok(atlas, "readEvidenceAtlas returned null for an existing developer");
  section("Evidence atlas coverage", {
    generatedAt: atlas.generatedAt,
    totals: atlas.totals,
    packageAtoms: atlas.packages.length,
    signalAtoms: atlas.signals.length,
    vocabularyAtoms: atlas.vocabulary.length,
    clusters: atlas.clusters.length,
    capabilities: atlas.capabilities.length,
    experiences: atlas.experiences.length,
    skills: atlas.skills.length,
    repositories: atlas.repositories.length,
    indexedFiles: atlas.index.files.length,
    samplePackages: atlas.packages.slice(0, 15),
    sampleSignals: atlas.signals.slice(0, 15),
    sampleClusters: atlas.clusters.slice(0, 10),
  });
  record(
    "Evidence atlas",
    "PASS",
    `${atlas.index.files.length} indexed file record(s), ${atlas.packages.length} package atom(s), ${atlas.signals.length} signal atom(s), ${atlas.repositories.length} repository record(s).`,
  );
  if (atlas.totals.files > 0 && atlas.index.files.length === 0) {
    record(
      "Atlas index consistency",
      "FAIL",
      "Atlas reports files but exposes an empty in-memory file index.",
    );
  }
  if (atlas.totals.files === 0)
    record(
      "Atlas evidence volume",
      "WARN",
      "No file evidence is available; topic depth may be limited or based on stored assessments only.",
    );

  // 8. Topic taxonomy is shared graph structure: inspect direction, edge quality, coverage.
  const taxonomyCounts = await queryRows(
    graph,
    `MATCH (a:Topic)-[r]->(b:Topic)
     WHERE type(r) IN ['BUILDS_ON', 'RELATED_TOPIC', 'PREREQUISITE_OF']
     RETURN type(r) AS relationship, count(*) AS count`,
  );
  const taxonomyEdges = await queryRows(
    graph,
    `MATCH (a:Topic)-[r:BUILDS_ON|RELATED_TOPIC|PREREQUISITE_OF]->(b:Topic)
     RETURN coalesce(a.slug, a.id, a.name, '') AS fromTopic,
            type(r) AS relationship,
            coalesce(b.slug, b.id, b.name, '') AS toTopic
     ORDER BY relationship, fromTopic, toTopic`,
  );
  const taxonomyIntegrity = await queryRows(
    graph,
    `MATCH (a:Topic)-[r:BUILDS_ON|RELATED_TOPIC|PREREQUISITE_OF]->(b:Topic)
     RETURN count(r) AS edges,
            sum(CASE WHEN a = b THEN 1 ELSE 0 END) AS selfLoops,
            sum(CASE WHEN coalesce(a.slug, "") = "" OR coalesce(b.slug, "") = "" THEN 1 ELSE 0 END) AS missingEndpointSlug,
            sum(CASE WHEN type(r) = 'BUILDS_ON' AND (a.slug IS NULL OR b.slug IS NULL) THEN 1 ELSE 0 END) AS invalidBuildsOnEndpoints`,
  );
  section("Shared topic taxonomy counts", taxonomyCounts);
  section(
    "All topic taxonomy edges (advanced -> foundation for BUILDS_ON)",
    taxonomyEdges,
  );
  section("Taxonomy structural integrity", taxonomyIntegrity[0] ?? {});
  const ti = taxonomyIntegrity[0] ?? {};
  const taxonomyProblems =
    Number(ti.selfLoops ?? 0) + Number(ti.missingEndpointSlug ?? 0);
  record(
    "Taxonomy structural integrity",
    taxonomyProblems === 0 ? "PASS" : "WARN",
    `${Number(ti.edges ?? 0)} taxonomy edges, ${Number(ti.selfLoops ?? 0)} self-loop(s), ${Number(ti.missingEndpointSlug ?? 0)} edge(s) with missing endpoint slug.`,
  );
  const buildsOnCount = taxonomyCounts
    .filter((r) => r.relationship === "BUILDS_ON")
    .reduce((n, r) => n + Number(r.count ?? 0), 0);
  if (catalog.length > 1 && buildsOnCount === 0) {
    record(
      "Foundation graph readiness",
      "WARN",
      `${catalog.length} topics exist but no BUILDS_ON edges exist; prerequisite-based goal paths cannot be derived from that relation yet.`,
    );
  } else {
    record(
      "Foundation graph readiness",
      "PASS",
      `${catalog.length} catalog topic(s), ${buildsOnCount} BUILDS_ON edge(s).`,
    );
  }

  // 9. Probe the chosen topic through the production readers. This explains what is
  // available to a future planner without making the goal itself part of this test.
  const targetCatalogEntry = catalog.find((t) => t.slug === TARGET_TOPIC);
  const targetSummary = profile.topics.find((t) => t.slug === TARGET_TOPIC);
  const targetDetail = await readTopicDepthDetail(
    graph,
    DEVELOPER_ID,
    TARGET_TOPIC,
  );
  const targetSpec = await readStoredTopicSpec(
    graph,
    DEVELOPER_ID,
    TARGET_TOPIC,
  );
  const targetContext = await readTopicContext(
    graph,
    DEVELOPER_ID,
    TARGET_TOPIC,
  );
  section(`Target topic: ${TARGET_TOPIC}`, {
    existsInCatalog: Boolean(targetCatalogEntry),
    assessedForDeveloper: Boolean(targetSummary),
    catalog: targetCatalogEntry ?? null,
    assessment: targetSummary ?? null,
    detail: targetDetail
      ? {
          rationale: targetDetail.rationale,
          strengths: targetDetail.strengths,
          gaps: targetDetail.gaps,
          baselineLevel: targetDetail.baselineLevel,
          stats: targetDetail.stats,
          evidence: targetDetail.evidence,
          approaches: targetDetail.approaches,
          foundations: targetDetail.context?.foundations ?? [],
          unlocks: targetDetail.unlocks,
          related: targetDetail.related,
        }
      : null,
    storedSpec: targetSpec
      ? {
          slug: targetSpec.slug,
          name: targetSpec.name,
          domain: targetSpec.domain,
          aliases: targetSpec.aliases,
          keywords: targetSpec.keywords,
          packages: targetSpec.packages,
          signals: targetSpec.signals,
          capabilityIds: targetSpec.capabilityIds,
          approaches: targetSpec.approaches,
          buildsOn: targetSpec.buildsOn,
          related: targetSpec.related,
          pinnedFileIds: targetSpec.pinnedFileIds,
        }
      : null,
    context: targetContext,
  });
  if (!targetCatalogEntry)
    record(
      "Target topic catalog presence",
      "WARN",
      `Topic '${TARGET_TOPIC}' is not in the shared Topic catalog.`,
    );
  else
    record(
      "Target topic catalog presence",
      "PASS",
      `Topic '${TARGET_TOPIC}' exists in the shared taxonomy.`,
    );
  if (!targetSummary)
    record(
      "Target developer assessment",
      "WARN",
      `No stored assessment for '${TARGET_TOPIC}'; this is unknown/unassessed, not proof of missing skill.`,
    );
  else
    record(
      "Target developer assessment",
      "PASS",
      `Stored level=${targetSummary.level}, score=${targetSummary.score}, confidence=${targetSummary.confidence}, fallback=${targetSummary.fallback}.`,
    );
  if (targetDetail) {
    const evidenceCount = targetDetail.evidence.length;
    record(
      "Target assessment explainability",
      targetDetail.rationale && evidenceCount > 0 ? "PASS" : "WARN",
      `Rationale present=${Boolean(targetDetail.rationale)}; structured evidence refs=${evidenceCount}; strengths=${targetDetail.strengths.length}; gaps=${targetDetail.gaps.length}; approaches=${targetDetail.approaches.length}.`,
    );
    const malformedEvidence = targetDetail.evidence.filter(
      (e) => !e.kind || !e.id || !e.label,
    );
    if (malformedEvidence.length)
      record(
        "Target evidence reference shape",
        "WARN",
        `${malformedEvidence.length} evidence reference(s) are missing kind, id, or label.`,
      );
  }

  // 10. Inspect several assessed topics to understand depth/context variance, not just one example.
  const topicSamples = profile.topics.slice(0, 8);
  const topicDetails = await Promise.all(
    topicSamples.map(async (t) => {
      const [detail, spec] = await Promise.all([
        readTopicDepthDetail(graph, DEVELOPER_ID, t.slug),
        readStoredTopicSpec(graph, DEVELOPER_ID, t.slug),
      ]);
      return {
        slug: t.slug,
        level: t.level,
        score: t.score,
        baselineScore: t.baselineScore,
        fallback: t.fallback,
        approaches: t.approaches.length,
        rationalePresent: Boolean(detail?.rationale),
        evidenceRefs: detail?.evidence.length ?? 0,
        strengths: detail?.strengths.length ?? 0,
        gaps: detail?.gaps.length ?? 0,
        foundationCount: detail?.context?.foundations.length ?? 0,
        unlockCount: detail?.unlocks.length ?? 0,
        relatedCount: detail?.related.length ?? 0,
        storedSpecPresent: Boolean(spec),
        specApproachCount: spec?.approaches.length ?? 0,
      };
    }),
  );
  section("Depth behavior across representative assessed topics", topicDetails);

  // 11. Compare profile-level KNOWS_TOPIC roll-ups with the assessment records.
  const rollup = await queryRows(
    graph,
    `MATCH (d:Developer {id: $developerId})-[k:KNOWS_TOPIC]->(t:Topic)
     OPTIONAL MATCH (d)-[:ASSESSED]->(a:DepthAssessment)-[:OF_TOPIC]->(t)
     RETURN t.slug AS topic, k.level AS rolledLevel, k.score AS rolledScore,
            count(a) AS matchingAssessments,
            collect(DISTINCT a.level) AS assessmentLevels,
            collect(DISTINCT a.score) AS assessmentScores
     ORDER BY topic`,
    { developerId: DEVELOPER_ID },
  );
  section("KNOWS_TOPIC roll-up versus DepthAssessment", rollup);
  const rollupMismatches = rollup.filter(
    (r) =>
      Number(r.matchingAssessments ?? 0) > 0 &&
      Array.isArray(r.assessmentLevels) &&
      r.assessmentLevels.length > 0 &&
      !r.assessmentLevels.includes(r.rolledLevel),
  );
  record(
    "Developer topic roll-up",
    rollupMismatches.length === 0 ? "PASS" : "WARN",
    `${rollup.length} KNOWS_TOPIC edge(s); ${rollupMismatches.length} level mismatch(es) versus matching assessment(s). Scores/levels can differ by design only if the write path documents that distinction.`,
  );

  // 12. Demonstrate actual graph path availability between topic pairs. This is
  // topology inspection only: path existence is not the same as learning readiness.
  const pathPairs: Array<[string, string]> = [];
  if (profile.topics.length >= 2) {
    pathPairs.push([profile.topics[0].slug, profile.topics[1].slug]);
    const different = profile.topics.find(
      (t) =>
        t.slug !== profile.topics[0].slug &&
        t.domain !== profile.topics[0].domain,
    );
    if (different) pathPairs.push([profile.topics[0].slug, different.slug]);
  }
  const paths = await Promise.all(
    pathPairs.map(async ([from, to]) => ({
      from,
      to,
      path: await readTopicPath(graph, from, to),
    })),
  );
  section("Representative topic-to-topic paths", paths);
  record(
    "Topic path traversal",
    "PASS",
    `${paths.length} representative pair(s) queried; empty paths indicate disconnected topics under supported relation types.`,
  );

  // 13. A goal-graph readiness summary, derived only from observed graph behavior.
  const readiness = {
    developer: DEVELOPER_ID,
    assessedTopics: profile.topics.length,
    domains: profile.domains.length,
    catalogTopics: catalog.length,
    buildsOnEdges: buildsOnCount,
    relatedEdges: taxonomyCounts
      .filter((r) => r.relationship === "RELATED_TOPIC")
      .reduce((n, r) => n + Number(r.count ?? 0), 0),
    evidenceAtlasFiles: atlas.index.files.length,
    evidenceAtlasRepositories: atlas.repositories.length,
    assessmentsWithBackingEdges: backed,
    assessmentsTotal: assessed,
    targetTopicExists: Boolean(targetCatalogEntry),
    targetTopicAssessed: Boolean(targetSummary),
    targetTopicHasStoredSpec: Boolean(targetSpec),
    targetTopicHasStructuredEvidence: (targetDetail?.evidence.length ?? 0) > 0,
    targetTopicHasFoundations: (targetContext?.foundations.length ?? 0) > 0,
    warnings: warnings.length,
    failures: failures.length,
  };
  section(
    "Goal-graph design inputs (observed; no goal planning performed)",
    readiness,
  );
  console.log("\nInterpretation guide:");
  console.log(
    "- DepthAssessment describes observed developer depth; it is not itself a learning path.",
  );
  console.log(
    "- EvidenceAtlas shows the code/work signals available to evaluate a proposed topic.",
  );
  console.log(
    "- Topic + BUILDS_ON defines prerequisite direction (advanced topic -> foundation).",
  );
  console.log(
    "- RELATED_TOPIC expresses association, not necessarily a prerequisite.",
  );
  console.log(
    "- KNOWS_TOPIC is a developer-specific roll-up; compare it with the underlying assessment.",
  );
  console.log(
    "- Empty/missing evidence means unproven or unavailable, not automatically unskilled.",
  );
  console.log(
    "- A future goal graph can combine a goal target with this observed state and taxonomy; this file intentionally does not do that.",
  );

  console.log("\n================ FINAL RESULT ================");
  console.table(observations);
  console.log(`Warnings: ${warnings.length} | Failures: ${failures.length}`);
  if (failures.length) {
    console.error("\nFAILED INVARIANTS:");
    for (const failure of failures) console.error(failure);
    throw new Error(`${failures.length} depth-graph invariant(s) failed`);
  }
  console.log(
    "PASS  Critical invariants hold. Review WARN findings as graph-data/coverage questions.",
  );
  console.log("==============================================\n");
}

main().catch((error: unknown) => {
  console.error("\nFAIL  Pathway depth-graph behavior test failed:");
  console.error(error);
  process.exitCode = 1;
});
