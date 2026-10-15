import { createHash, randomUUID } from "node:crypto";
import type { Graph } from "../../db/falkordb.js";
import {
  SKILL_TAXONOMY,
  matchesSkill,
  type SkillDefinition,
} from "../skill-insights/runtime.js";




import { Domain as _constants } from './constants.js';
import { Domain as _helpers_extra } from './helpers-extra.js';
import { Domain as _helpers_extra2 } from './helpers-extra2.js';
import { Domain as _helpers } from './helpers.js';
import { Domain as _queries } from './queries.js';
import { Domain as _readers } from './readers.js';
import { Domain as _types } from './types.js';

export namespace Domain {
import LOG_PREFIX = _constants.LOG_PREFIX;
import DB_BATCH_SIZE = _constants.DB_BATCH_SIZE;
import EVIDENCE_PAGE_SIZE = _constants.EVIDENCE_PAGE_SIZE;
import LEARNABLE_CAPABILITIES = _constants.LEARNABLE_CAPABILITIES;
import CATEGORY_CAPABILITIES = _constants.CATEGORY_CAPABILITIES;
import DEPTH_RANK = _constants.DEPTH_RANK;
import CAPABILITY_DEFINITIONS_VERSION = _constants.CAPABILITY_DEFINITIONS_VERSION;
import CAPABILITY_SCHEMA_NODE_ID = _constants.CAPABILITY_SCHEMA_NODE_ID;
import LEVEL_RANK = _constants.LEVEL_RANK;
import COMPLETION_CRITERIA_BY_CAPABILITY = _helpers_extra.COMPLETION_CRITERIA_BY_CAPABILITY;
import TECHNOLOGY_NAMES = _helpers_extra.TECHNOLOGY_NAMES;
import normalizeExperiencePart = _helpers_extra.normalizeExperiencePart;
import experienceFingerprintFor = _helpers_extra.experienceFingerprintFor;
import problemFingerprintFor = _helpers_extra.problemFingerprintFor;
import techniqueIdFor = _helpers_extra.techniqueIdFor;
import representativeProblemFor = _helpers_extra.representativeProblemFor;
import buildExperienceSummary = _helpers_extra.buildExperienceSummary;
import buildEngineeringExperiences = _helpers_extra.buildEngineeringExperiences;
import groupDemonstrationsIntoExperiences = _helpers_extra.groupDemonstrationsIntoExperiences;
import EVIDENCE_STATE_BY_LEVEL = _helpers_extra.EVIDENCE_STATE_BY_LEVEL;
import PREREQUISITE_SATISFIED_BY = _helpers_extra.PREREQUISITE_SATISFIED_BY;
import evidenceStateFor = _helpers_extra.evidenceStateFor;
import levelsInStates = _helpers_extra.levelsInStates;
import commitKey = _helpers_extra.commitKey;
import recencyFor = _helpers_extra.recencyFor;
import summarise = _helpers_extra.summarise;
import rollUpDemonstrations = _helpers_extra.rollUpDemonstrations;
import GOAL_INDEXES = _helpers_extra.GOAL_INDEXES;
import CAPABILITY_DEPENDENCIES = _helpers_extra.CAPABILITY_DEPENDENCIES;
import prerequisite = _helpers_extra.prerequisite;
import related = _helpers_extra.related;
import DECLARED_PREREQUISITES = _helpers_extra.DECLARED_PREREQUISITES;
import DECLARED_RELATIONS = _helpers_extra.DECLARED_RELATIONS;
import CAPABILITY_GRAPH_RELATIONSHIPS = _helpers_extra.CAPABILITY_GRAPH_RELATIONSHIPS;
import MAX_PREREQUISITE_DEPTH = _helpers_extra.MAX_PREREQUISITE_DEPTH;
import validateCompletionCriteria = _helpers_extra.validateCompletionCriteria;
import validateCapabilityGraph = _helpers_extra.validateCapabilityGraph;
import conceptKey = _helpers_extra.conceptKey;
import resolveConceptProposals = _helpers_extra.resolveConceptProposals;
import setDeveloperGoal = _helpers_extra.setDeveloperGoal;
import DEMONSTRATION_INDEXES = _helpers_extra.DEMONSTRATION_INDEXES;
import collectSkillRepositoryEvidence = _helpers_extra.collectSkillRepositoryEvidence;
import parseTechniques = _helpers_extra.parseTechniques;
import byLevelThenEvidence = _helpers_extra.byLevelThenEvidence;
import parseAddedLines = _helpers_extra2.parseAddedLines;
import COMMENT_LINE = _helpers_extra2.COMMENT_LINE;
import TEST_PATH = _helpers_extra2.TEST_PATH;
import dedent = _helpers_extra2.dedent;
import depthFor = _helpers_extra2.depthFor;
import buildPermalink = _helpers_extra2.buildPermalink;
import extractDemonstrations = _helpers_extra2.extractDemonstrations;
import slugify = _helpers_extra2.slugify;
import techniqueSpec = _helpers_extra2.techniqueSpec;
import COMPLETION_CRITERIA = _helpers_extra2.COMPLETION_CRITERIA;
import positiveIntegerEnv = _helpers.positiveIntegerEnv;
import MAX_SNIPPET_CHARS = _helpers.MAX_SNIPPET_CHARS;
import SNIPPET_LINES_BEFORE = _helpers.SNIPPET_LINES_BEFORE;
import SNIPPET_LINES_AFTER = _helpers.SNIPPET_LINES_AFTER;
import RECENT_DAYS = _helpers.RECENT_DAYS;
import HISTORICAL_DAYS = _helpers.HISTORICAL_DAYS;
import log = _helpers.log;
import safeString = _helpers.safeString;
import safeNumber = _helpers.safeNumber;
import chunkArray = _helpers.chunkArray;
import asQueryParams = _helpers.asQueryParams;
import queryRows = _helpers.queryRows;
import runCounted = _helpers.runCounted;
import domain = _helpers.domain;
import capability = _helpers.capability;
import CAPABILITY_BY_ID = _helpers.CAPABILITY_BY_ID;
import ENGINEERING_CONTEXTS = _helpers.ENGINEERING_CONTEXTS;
import DEFAULT_CONTEXT = _helpers.DEFAULT_CONTEXT;
import CHANGE_INTENTS = _helpers.CHANGE_INTENTS;
import deriveContext = _helpers.deriveContext;
import imp = _helpers.imp;
import SIGNAL_RULES = _helpers.SIGNAL_RULES;
import CAPABILITIES = _queries.CAPABILITIES;
import isLearnableCapability = _readers.isLearnableCapability;
import evaluateCapabilityCompletion = _readers.evaluateCapabilityCompletion;
import hashExperienceFingerprint = _readers.hashExperienceFingerprint;
import getEngineeringExperiences = _readers.getEngineeringExperiences;
import capabilityDefinitionsVersion = _readers.capabilityDefinitionsVersion;
import isCapabilityGraphCurrent = _readers.isCapabilityGraphCurrent;
import getDeveloperGoal = _readers.getDeveloperGoal;
import findCapabilityGaps = _readers.findCapabilityGaps;
import loadRepositoryNames = _readers.loadRepositoryNames;
import loadCommitMessages = _readers.loadCommitMessages;
import fetchEvidencePage = _readers.fetchEvidencePage;
import fetchDeveloperSkills = _readers.fetchDeveloperSkills;
import loadDemonstrationRows = _readers.loadDemonstrationRows;
import getCapabilityProfile = _readers.getCapabilityProfile;
import getCapabilityEvidence = _readers.getCapabilityEvidence;
import getOverviewGraphSnapshot = _readers.getOverviewGraphSnapshot;
import AnyObject = _types.AnyObject;
import ProgressFn = _types.ProgressFn;
import QueryPrimitive = _types.QueryPrimitive;
import QueryParamObject = _types.QueryParamObject;
import CapabilityDefinition = _types.CapabilityDefinition;
import EngineeringContextDefinition = _types.EngineeringContextDefinition;
import DemonstrationDepth = _types.DemonstrationDepth;
import ModifierRule = _types.ModifierRule;
import UsesRule = _types.UsesRule;
import SignalRule = _types.SignalRule;
import AddedLine = _types.AddedLine;
import EvidenceInput = _types.EvidenceInput;
import EvidenceContext = _types.EvidenceContext;
import Demonstration = _types.Demonstration;
import SafeguardDefinition = _types.SafeguardDefinition;
import TechniqueSpecDefinition = _types.TechniqueSpecDefinition;
import SafeguardTuple = _types.SafeguardTuple;
import SafeguardStatus = _types.SafeguardStatus;
import TechniqueCompletion = _types.TechniqueCompletion;
import CapabilityCompletion = _types.CapabilityCompletion;
import EngineeringExperience = _types.EngineeringExperience;
import CapabilityLevel = _types.CapabilityLevel;
import Recency = _types.Recency;
import EvidenceState = _types.EvidenceState;
import CapabilityRollup = _types.CapabilityRollup;
import GoalDefinition = _types.GoalDefinition;
import GoalRequirement = _types.GoalRequirement;
import DeveloperGoal = _types.DeveloperGoal;
import CapabilityGap = _types.CapabilityGap;
import CapabilityRelationship = _types.CapabilityRelationship;
import CapabilityDependency = _types.CapabilityDependency;
import CapabilityGraphProblem = _types.CapabilityGraphProblem;
import ConceptProposal = _types.ConceptProposal;
import RegisteredConcept = _types.RegisteredConcept;
import StoredSkillRow = _types.StoredSkillRow;
import SkillRepositoryAggregate = _types.SkillRepositoryAggregate;
import OverviewGraphBuildResult = _types.OverviewGraphBuildResult;
import CapabilityProfileEntry = _types.CapabilityProfileEntry;
import DomainProfile = _types.DomainProfile;
import DemonstrationEvidence = _types.DemonstrationEvidence;
import OverviewGraphSnapshot = _types.OverviewGraphSnapshot;

export async function storeEngineeringExperiences(
  graph: Graph,
  developerId: string,
  buildId: string,
  demos: Demonstration[],
): Promise<EngineeringExperience[]> {
  const experiences = buildEngineeringExperiences(demos, buildId, developerId);
  const scope = { developer_id: developerId };

  // 1) Experience nodes.
  await runCounted(
    graph,
    "Experience nodes",
    `
    UNWIND $batch AS item
    MERGE (e:Experience {id: item.id})
    SET e.fingerprint = item.fingerprint,
        e.summary = item.summary,
        e.problem_statement = item.problem_statement,
        e.capability_id = item.capability_id,
        e.technique = item.technique,
        e.evidence_count = item.evidence_count,
        e.commit_count = item.commit_count,
        e.repo_count = item.repo_count,
        e.active_days = item.active_days,
        e.best_depth = item.best_depth,
        e.first_seen = item.first_seen,
        e.last_seen = item.last_seen,
        e.build_id = item.build_id,
        e.developer_id = $developer_id
    RETURN count(e) AS n
    `,
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
      build_id: buildId,
    })),
    scope,
    true,
  );

  // 2) Developer -> Experience.
  await runCounted(
    graph,
    "EXPERIENCED edges",
    `
    UNWIND $batch AS item
    MATCH (d:Developer {id: $developer_id})
    MATCH (e:Experience {id: item.experience_id})
    MERGE (d)-[r:EXPERIENCED]->(e)
    RETURN count(r) AS n
    `,
    experiences.map((e) => ({ experience_id: e.id })),
    scope,
    true,
  );

  // 3) Experience -> Capability.
  await runCounted(
    graph,
    "DEMONSTRATES_CAPABILITY edges",
    `
    UNWIND $batch AS item
    MATCH (e:Experience {id: item.experience_id})
    MATCH (c:Capability {id: item.capability_id})
    MERGE (e)-[r:DEMONSTRATES_CAPABILITY]->(c)
    RETURN count(r) AS n
    `,
    experiences.map((e) => ({
      experience_id: e.id,
      capability_id: e.capabilityId,
    })),
    true,
  );

  // 4) Experience -> Technique (shared taxonomy node, name only).
  await runCounted(
    graph,
    "USES_TECHNIQUE edges",
    `
    UNWIND $batch AS item
    MATCH (e:Experience {id: item.experience_id})
    MERGE (t:Technique {id: item.technique_id})
    SET t.name = item.technique
    MERGE (e)-[r:USES_TECHNIQUE]->(t)
    RETURN count(r) AS n
    `,
    experiences.map((e) => ({
      experience_id: e.id,
      technique_id: techniqueIdFor(e.technique),
      technique: e.technique,
    })),
    true,
  );

  // 5) Experience -> Problem (developer-scoped: statement comes from this
  //    developer's commit subjects).
  await runCounted(
    graph,
    "SOLVES edges",
    `
    UNWIND $batch AS item
    MATCH (e:Experience {id: item.experience_id})
    MERGE (p:Problem {id: item.problem_id})
    SET p.statement = item.problem_statement,
        p.capability_id = item.capability_id,
        p.developer_id = $developer_id
    MERGE (e)-[r:SOLVES]->(p)
    RETURN count(r) AS n
    `,
    experiences.map((e) => ({
      experience_id: e.id,
      problem_id: e.problemId,
      problem_statement: e.problemStatement,
      capability_id: e.capabilityId,
    })),
    scope,
    true,
  );

  // 6) Experience -> EngineeringContext.
  await runCounted(
    graph,
    "IN_CONTEXT edges",
    `
    UNWIND $batch AS item
    MATCH (e:Experience {id: item.experience_id})
    MATCH (ctx:EngineeringContext {id: item.context_id})
    MERGE (e)-[r:IN_CONTEXT]->(ctx)
    RETURN count(r) AS n
    `,
    experiences.flatMap((e) =>
      e.contextIds.map((contextId) => ({
        experience_id: e.id,
        context_id: contextId,
      })),
    ),
    true,
  );

  // 7) Experience -> Demonstration. Built straight from each experience's own
  //    id lists, so there is no per-row lookup into `demos`.
  await runCounted(
    graph,
    "SUPPORTED_BY edges",
    `
    UNWIND $batch AS item
    MATCH (e:Experience {id: item.experience_id})
    MATCH (x:Demonstration {id: item.demonstration_id})
    MERGE (e)-[r:SUPPORTED_BY]->(x)
    RETURN count(r) AS n
    `,
    experiences.flatMap((e) =>
      e.demonstrationIds.map((demonstrationId) => ({
        experience_id: e.id,
        demonstration_id: demonstrationId,
      })),
    ),
    true,
  );

  // 8) Experience -> FileChange.
  await runCounted(
    graph,
    "Experience EVIDENCED_BY edges",
    `
    UNWIND $batch AS item
    MATCH (e:Experience {id: item.experience_id})
    MATCH (fc:FileChange {id: item.file_change_id})
    MERGE (e)-[r:EVIDENCED_BY]->(fc)
    RETURN count(r) AS n
    `,
    experiences.flatMap((e) =>
      e.fileChangeIds.map((fileChangeId) => ({
        experience_id: e.id,
        file_change_id: fileChangeId,
      })),
    ),
    true,
  );

  // 9) Experience -> Repository.
  await runCounted(
    graph,
    "OCCURS_IN edges",
    `
    UNWIND $batch AS item
    MATCH (e:Experience {id: item.experience_id})
    MATCH (r:Repository {id: item.repository_id})
    MERGE (e)-[o:OCCURS_IN]->(r)
    RETURN count(o) AS n
    `,
    experiences.flatMap((e) =>
      e.repositoryIds.map((repositoryId) => ({
        experience_id: e.id,
        repository_id: repositoryId,
      })),
    ),
    true,
  );

  // 10) Experience -> Technology (allowlisted).
  await runCounted(
    graph,
    "USES_TECHNOLOGY edges",
    `
    UNWIND $batch AS item
    MATCH (e:Experience {id: item.experience_id})
    MERGE (t:Technology {id: item.technology_id})
    SET t.name = item.technology_name
    MERGE (e)-[r:USES_TECHNOLOGY]->(t)
    RETURN count(r) AS n
    `,
    experiences.flatMap((e) =>
      e.technologyIds.map((technologyId) => ({
        experience_id: e.id,
        technology_id: technologyId,
        technology_name: TECHNOLOGY_NAMES[technologyId],
      })),
    ),
    true,
  );

  return experiences;
}

export async function cleanupStaleExperiences(
  graph: Graph,
  developerId: string,
  buildId: string,
): Promise<void> {
  await graph.query(
    `
    MATCH (d:Developer {id: $developer_id})-[:EXPERIENCED]->(e:Experience)
    WHERE coalesce(e.build_id, "") <> $build_id
    DETACH DELETE e
    `,
    { params: { developer_id: developerId, build_id: buildId } },
  );

  // Only this developer's Problems, plus un-scoped legacy ones, and only when
  // no Experience references them.
  await graph.query(
    `
    MATCH (p:Problem)
    WHERE coalesce(p.developer_id, $developer_id) = $developer_id
      AND NOT (p)<-[:SOLVES]-(:Experience)
    DELETE p
    `,
    { params: { developer_id: developerId } },
  );
}

export async function ensureGoalIndexes(graph: Graph): Promise<void> {
  for (const { label, property } of GOAL_INDEXES) {
    try {
      await graph.query(`CREATE INDEX FOR (n:${label}) ON (n.${property})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/already\s+(exists|indexed)/i.test(message)) {
        log(`index creation failed for ${label}.${property}`, { message });
      }
    }
  }
}

export async function ensureCapabilityGraph(
  graph: Graph,
  relationships: readonly CapabilityRelationship[] = CAPABILITY_GRAPH_RELATIONSHIPS,
): Promise<void> {
  const problems = [
    ...validateCapabilityGraph(relationships),
    ...validateCompletionCriteria(),
  ];
  if (problems.length > 0) {
    throw new Error(
      `Invalid capability graph:\n${problems
        .map((p) => `- [${p.code}] ${p.message}`)
        .join("\n")}`,
    );
  }

  const nodeRows = CAPABILITIES.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    parent_id: c.parentId ?? "",
  }));

  
  await runCounted(
    graph,
    "Capability nodes",
    `
    UNWIND $batch AS item
    MERGE (c:Capability {id: item.id})
    SET c.name = item.name,
        c.description = item.description,
        c.parent_id = item.parent_id
    RETURN count(c) AS n
    `,
    nodeRows,
    true,
  );

  await runCounted(
    graph,
    "SPECIALIZES edges",
    `
    UNWIND $batch AS item
    MATCH (c:Capability {id: item.id})
    MATCH (p:Capability {id: item.parent_id})
    MERGE (c)-[r:SPECIALIZES]->(p)
    SET r.weight = 1,
        r.basis = "declared"
    RETURN count(r) AS n
    `,
    nodeRows.filter((r) => r.parent_id),
    true,
  );

  
  const edgeRow = (r: CapabilityRelationship) => ({
    from: r.from,
    to: r.to,
    weight: r.weight,
    reason: r.reason,
  });

  await runCounted(
    graph,
    "PREREQUISITE_OF edges",
    `
    UNWIND $batch AS item
    MATCH (a:Capability {id: item.from})
    MATCH (b:Capability {id: item.to})
    MERGE (a)-[r:PREREQUISITE_OF]->(b)
    SET r.weight = item.weight,
        r.basis = "declared",
        r.reason = item.reason
    RETURN count(r) AS n
    `,
    relationships.filter((r) => r.type === "PREREQUISITE_OF").map(edgeRow),
    true,
  );

  await runCounted(
    graph,
    "RELATED_TO edges",
    `
    UNWIND $batch AS item
    MATCH (a:Capability {id: item.from})
    MATCH (b:Capability {id: item.to})
    MERGE (a)-[r:RELATED_TO]->(b)
    SET r.weight = item.weight,
        r.basis = "declared",
        r.reason = item.reason
    MERGE (b)-[reverse:RELATED_TO]->(a)
    SET reverse.weight = item.weight,
        reverse.basis = "declared",
        reverse.reason = item.reason
    RETURN count(reverse) AS n
    `,
    relationships.filter((r) => r.type === "RELATED_TO").map(edgeRow),
    true,
  );

  
  
  
  const specRows = COMPLETION_CRITERIA.map((s) => ({
    id: s.id,
    capability_id: s.capabilityId,
    rule_id: s.ruleId,
    name: s.name,
    description: s.description,
    minimum_depth: s.minimumDepth,
  }));

  const safeguardRows = COMPLETION_CRITERIA.flatMap((s) =>
    s.safeguards.map((g) => ({
      id: g.id,
      spec_id: s.id,
      name: g.name,
      why: g.why,
      modifier_label: g.modifierLabel,
      required: g.required,
    })),
  );

  await runCounted(
    graph,
    "TechniqueSpec nodes",
    `
    UNWIND $batch AS item
    MERGE (t:TechniqueSpec {id: item.id})
    SET t.capability_id = item.capability_id,
        t.rule_id = item.rule_id,
        t.name = item.name,
        t.description = item.description,
        t.minimum_depth = item.minimum_depth
    RETURN count(t) AS n
    `,
    specRows,
    true,
  );

  await runCounted(
    graph,
    "HAS_TECHNIQUE_SPEC edges",
    `
    UNWIND $batch AS item
    MATCH (c:Capability {id: item.capability_id})
    MATCH (t:TechniqueSpec {id: item.id})
    MERGE (c)-[r:HAS_TECHNIQUE_SPEC]->(t)
    SET r.basis = "declared"
    RETURN count(r) AS n
    `,
    specRows,
    true,
  );

  await runCounted(
    graph,
    "Safeguard nodes",
    `
    UNWIND $batch AS item
    MERGE (g:Safeguard {id: item.id})
    SET g.name = item.name,
        g.why = item.why,
        g.modifier_label = item.modifier_label,
        g.required = item.required
    RETURN count(g) AS n
    `,
    safeguardRows,
    true,
  );

  await runCounted(
    graph,
    "HAS_SAFEGUARD edges",
    `
    UNWIND $batch AS item
    MATCH (t:TechniqueSpec {id: item.spec_id})
    MATCH (g:Safeguard {id: item.id})
    MERGE (t)-[r:HAS_SAFEGUARD]->(g)
    SET r.basis = "declared",
        r.required = item.required
    RETURN count(r) AS n
    `,
    safeguardRows,
    true,
  );

  
  const declared: Array<[string, string[]]> = [
    [
      "PREREQUISITE_OF",
      relationships
        .filter((r) => r.type === "PREREQUISITE_OF")
        .map((r) => `${r.from}>${r.to}`),
    ],
    [
      "RELATED_TO",
      relationships
        .filter((r) => r.type === "RELATED_TO")
        .flatMap((r) => [`${r.from}>${r.to}`, `${r.to}>${r.from}`]),
    ],
    [
      "SPECIALIZES",
      CAPABILITIES.filter((c) => c.parentId).map(
        (c) => `${c.id}>${c.parentId}`,
      ),
    ],
  ];

  for (const [type, keys] of declared) {
    await graph.query(
      `
      MATCH (a:Capability)-[r:${type}]->(b:Capability)
      WHERE NOT (a.id + ">" + b.id) IN $keys
        AND coalesce(r.basis, "") <> "inferred"
      DELETE r
      `,
      { params: { keys } },
    );
  }

  // Specs and safeguards that are no longer declared (renamed or removed in
  // COMPLETION_CRITERIA) must not linger and keep shaping completion checks.
  await graph.query(
    `MATCH (t:TechniqueSpec) WHERE NOT t.id IN $ids DETACH DELETE t`,
    { params: { ids: specRows.map((s) => s.id) } },
  );
  await graph.query(
    `MATCH (g:Safeguard) WHERE NOT g.id IN $ids DETACH DELETE g`,
    { params: { ids: safeguardRows.map((g) => g.id) } },
  );

  // 4) Stamp LAST: it only exists once everything above succeeded.
  await graph.query(
    `
    MERGE (s:CapabilitySchema {id: $id})
    SET s.version = $version,
        s.updated_at = $updated_at
    `,
    {
      params: {
        id: CAPABILITY_SCHEMA_NODE_ID,
        version: capabilityDefinitionsVersion(relationships),
        updated_at: new Date().toISOString(),
      },
    },
  );
}

export async function registerConcepts(
  graph: Graph,
  goalId: string,
  proposals: ConceptProposal[],
): Promise<RegisteredConcept[]> {
  const { reuse, create } = resolveConceptProposals(proposals);
  const out: RegisteredConcept[] = reuse.map((r) => ({
    id: r.id,
    name: r.name,
    created: false,
    existing: "capability" as const,
  }));

  await ensureGoalIndexes(graph);

  for (const c of create) {
    const now = new Date().toISOString();
    const id = `concept:${c.key}`;

    const rows = await queryRows(
      graph,
      `
      MATCH (g:Goal {id: $goal_id})
      MATCH (parent:Capability {id: $parent_id})
      MERGE (k:Concept {id: $id})
      ON CREATE SET k.name = $name,
                    k.description = $description,
                    k.basis = "inferred",
                    k.source = "goal_text",
                    k.created_at = $now
      MERGE (g)-[m:MENTIONS]->(k)
      ON CREATE SET m.basis = "inferred"
      MERGE (k)-[r:CANDIDATE_FOR]->(parent)
      ON CREATE SET r.basis = "inferred"
      RETURN k.created_at = $now AS created
      `,
      {
        goal_id: goalId,
        parent_id: c.parentId,
        id,
        name: c.name,
        description: c.description,
        now,
      },
    );

    // No row = the goal or the parent capability does not exist. Nothing saved.
    if (rows.length === 0) continue;

    const created = rows[0]?.created === true;
    out.push({
      id,
      name: c.name,
      created,
      existing: created ? null : ("concept" as const),
    });
  }

  return out;
}

export async function clearDeveloperGoal(
  graph: Graph,
  developerId: string,
): Promise<void> {
  await graph.query(
    `
    MATCH (d:Developer {id: $developer_id})-[r:HAS_GOAL]->(g:Goal)
    DELETE r
    `,
    { params: { developer_id: developerId } },
  );
}

export async function ensureDemonstrationIndexes(graph: Graph): Promise<void> {
  for (const { label, property } of DEMONSTRATION_INDEXES) {
    try {
      await graph.query(`CREATE INDEX FOR (n:${label}) ON (n.${property})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/already\s+(exists|indexed)/i.test(message)) {
        log(`index creation failed for ${label}.${property}`, { message });
      }
    }
  }

  // Full-text over what was done and the code that shows it: for direct text matching against demonstrations.
  try {
    await graph.query(
      `CALL db.idx.fulltext.createNodeIndex('Demonstration', 'summary', 'snippet', 'commit_subject')`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already\s+(exists|indexed)/i.test(message)) {
      log("fulltext index creation failed for Demonstration", { message });
    }
  }
}

export async function storeCapabilities(graph: Graph): Promise<void> {
  await ensureCapabilityGraph(graph);
}

export async function storeEngineeringContexts(graph: Graph): Promise<void> {
  const rows = ENGINEERING_CONTEXTS.map((c) => ({ id: c.id, name: c.name }));

  await graph.query(
    `
    UNWIND $batch AS item
    MERGE (e:EngineeringContext {id: item.id})
    SET e.name = item.name
    `,
    { params: { batch: asQueryParams(rows) } },
  );
}

export async function storeDemonstrations(
  graph: Graph,
  developerId: string,
  buildId: string,
  demos: Demonstration[],
): Promise<void> {
  const scope = { developer_id: developerId, build_id: buildId };

  // 1) Demonstration nodes (the only place the large snippet is sent).
  await runCounted(
    graph,
    "Demonstration nodes",
    `
    UNWIND $batch AS item
    MERGE (x:Demonstration {id: item.id})
    SET x.rule_id = item.rule_id,
        x.technique = item.technique,
        x.summary = item.summary,
        x.modifiers = item.modifiers,
        x.depth = item.depth,
        x.depth_rank = item.depth_rank,
        x.commit_sha = item.commit_sha,
        x.file_change_id = item.file_change_id,
        x.repository_id = item.repository_id,
        x.path = item.path,
        x.language = item.language,
        x.start_line = item.start_line,
        x.end_line = item.end_line,
        x.snippet = item.snippet,
        x.permalink = item.permalink,
        x.change_intent = item.change_intent,
        x.commit_subject = item.commit_subject,
        x.created_at = item.created_at,
        x.developer_id = $developer_id,
        x.build_id = $build_id
    RETURN count(x) AS n
    `,
    demos.map((x) => ({
      id: x.id,
      rule_id: x.ruleId,
      technique: x.technique,
      summary: x.summary,
      modifiers: x.modifiers.join(" | "),
      depth: x.depth,
      depth_rank: DEPTH_RANK[x.depth],
      file_change_id: x.fileChangeId,
      repository_id: x.repositoryId,
      commit_sha: x.commitSha,
      path: x.path,
      language: x.language,
      start_line: x.startLine,
      end_line: x.endLine,
      snippet: x.snippet,
      permalink: x.permalink,
      change_intent: x.intent,
      commit_subject: x.commitSubject,
      created_at: x.createdAt,
    })),
    scope,
    true,
  );

  // Slim rows for the edge queries: ids only, no snippets.
  const edgeRows = demos.map((x) => ({
    id: x.id,
    capability_id: x.capabilityId,
    file_change_id: x.fileChangeId,
    repository_id: x.repositoryId,
    layer_id: x.layerId,
  }));

  await runCounted(
    graph,
    "DEMONSTRATED edges",
    `
    UNWIND $batch AS item
    MATCH (d:Developer {id: $developer_id})
    MATCH (x:Demonstration {id: item.id})
    MERGE (d)-[r:DEMONSTRATED]->(x)
    RETURN count(r) AS n
    `,
    edgeRows,
    { developer_id: developerId },
    true,
  );

  await runCounted(
    graph,
    "OF_CAPABILITY edges",
    `
    UNWIND $batch AS item
    MATCH (x:Demonstration {id: item.id})
    MATCH (c:Capability {id: item.capability_id})
    MERGE (x)-[r:OF_CAPABILITY]->(c)
    RETURN count(r) AS n
    `,
    edgeRows,
    true,
  );

  await runCounted(
    graph,
    "Demonstration EVIDENCED_BY edges",
    `
    UNWIND $batch AS item
    MATCH (x:Demonstration {id: item.id})
    MATCH (fc:FileChange {id: item.file_change_id})
    MERGE (x)-[r:EVIDENCED_BY]->(fc)
    RETURN count(r) AS n
    `,
    edgeRows,
    true,
  );

  await runCounted(
    graph,
    "PRODUCED edges",
    `
    UNWIND $batch AS item
    MATCH (x:Demonstration {id: item.id})
    MATCH (fc:FileChange {id: item.file_change_id})
    MERGE (fc)-[r:PRODUCED]->(x)
    RETURN count(r) AS n
    `,
    edgeRows,
    true,
  );

  await runCounted(
    graph,
    "IN_REPOSITORY edges",
    `
    UNWIND $batch AS item
    MATCH (x:Demonstration {id: item.id})
    MATCH (r:Repository {id: item.repository_id})
    MERGE (x)-[e:IN_REPOSITORY]->(r)
    RETURN count(e) AS n
    `,
    edgeRows,
    true,
  );

  await runCounted(
    graph,
    "Demonstration IN_CONTEXT edges",
    `
    UNWIND $batch AS item
    MATCH (x:Demonstration {id: item.id})
    MATCH (e:EngineeringContext {id: item.layer_id})
    MERGE (x)-[r:IN_CONTEXT]->(e)
    RETURN count(r) AS n
    `,
    edgeRows,
    true,
  );
}

export async function storeDemonstrationUsage(
  graph: Graph,
  demos: Demonstration[],
): Promise<void> {
  await runCounted(
    graph,
    "USES edges",
    `
    UNWIND $batch AS item
    MATCH (x:Demonstration {id: item.demonstration_id})
    MATCH (s:Skill {id: item.skill_id})
    MERGE (x)-[r:USES]->(s)
    RETURN count(r) AS n
    `,
    demos.flatMap((x) =>
      x.usesSkillIds.map((skillId) => ({
        demonstration_id: x.id,
        skill_id: skillId,
      })),
    ),
  );
}

export async function storeDeveloperCapabilities(
  graph: Graph,
  developerId: string,
  rollups: CapabilityRollup[],
): Promise<void> {
  const updatedAt = new Date().toISOString();

  await runCounted(
    graph,
    "HAS_CAPABILITY edges",
    `
    UNWIND $batch AS item
    MATCH (d:Developer {id: item.developer_id})
    MATCH (c:Capability {id: item.capability_id})
    MERGE (d)-[r:HAS_CAPABILITY]->(c)
    SET r.level = item.level,
        r.recency = item.recency,
        r.best_depth = item.best_depth,
        r.evidence_count = item.evidence_count,
        r.commit_count = item.commit_count,
        r.repo_count = item.repo_count,
        r.technique_count = item.technique_count,
        r.active_days = item.active_days,
        r.first_seen = item.first_seen,
        r.last_seen = item.last_seen,
        r.techniques_json = item.techniques_json,
        r.updated_at = item.updated_at
    RETURN count(r) AS n
    `,
    rollups.map((r) => ({
      developer_id: developerId,
      capability_id: r.capabilityId,
      level: r.level,
      recency: r.recency,
      best_depth: r.bestDepth,
      evidence_count: r.evidenceCount,
      commit_count: r.commitCount,
      repo_count: r.repoCount,
      technique_count: r.techniqueCount,
      active_days: r.activeDays,
      first_seen: r.firstSeen,
      last_seen: r.lastSeen,
      techniques_json: r.techniquesJson,
      updated_at: updatedAt,
    })),
    true,
  );
}

export async function cleanupStale(
  graph: Graph,
  developerId: string,
  buildId: string,
  capabilityIds: string[],
): Promise<void> {
  await graph.query(
    `
    MATCH (d:Developer {id: $developer_id})-[:DEMONSTRATED]->(x:Demonstration)
    WHERE coalesce(x.build_id, "") <> $build_id AND coalesce(x.source, "") <> "mission"
    DETACH DELETE x
    `,
    { params: { developer_id: developerId, build_id: buildId } },
  );

  await graph.query(
    `
    MATCH (d:Developer {id: $developer_id})-[r:HAS_CAPABILITY]->(c:Capability)
    WHERE NOT c.id IN $capability_ids
    DELETE r
    `,
    { params: { developer_id: developerId, capability_ids: capabilityIds } },
  );
}

export async function storeSkillRepositoryRelations(
  graph: Graph,
  developerId: string,
  buildId: string,
  aggregates: Map<string, SkillRepositoryAggregate>,
  skills: StoredSkillRow[],
  repositoryIds: string[],
): Promise<number> {
  const scoreBySkill = new Map(skills.map((s) => [s.skillId, s.score]));

  const rows = Array.from(aggregates.values()).map((a) => ({
    skill_id: a.skillId,
    repository_id: a.repositoryId,
    evidence_count: a.evidenceCount,
    commit_count: a.commitShas.size,
    first_seen: Number.isFinite(a.firstSeenTs)
      ? new Date(a.firstSeenTs).toISOString()
      : "",
    last_seen: a.lastSeenTs ? new Date(a.lastSeenTs).toISOString() : "",
    evidence_path: a.evidencePath,
    commit_sha: a.evidenceCommitSha,
    skill_score: scoreBySkill.get(a.skillId) ?? 0,
  }));

  // The relationship identity includes developer_id, so each developer owns
  // their own Skill -> Repository edge.
  const written = await runCounted(
    graph,
    "DEMONSTRATED_IN edges",
    `
    UNWIND $batch AS item
    MATCH (s:Skill {id: item.skill_id})
    MATCH (r:Repository {id: item.repository_id})
    MERGE (s)-[sr:DEMONSTRATED_IN {developer_id: $developer_id}]->(r)
    SET sr.evidence_count = item.evidence_count,
        sr.commit_count = item.commit_count,
        sr.first_seen = item.first_seen,
        sr.last_seen = item.last_seen,
        sr.evidence_path = item.evidence_path,
        sr.commit_sha = item.commit_sha,
        sr.skill_score = item.skill_score,
        sr.build_id = $build_id
    RETURN count(sr) AS n
    `,
    rows,
    { developer_id: developerId, build_id: buildId },
  );

  // Remove this developer's edges that were not re-confirmed this build,
  // including legacy edges that have no developer_id yet. Keyed on the edge's
  // developer and repositories, NOT on HAS_SKILL, so a skill the developer no
  // longer has cannot leave a stale edge behind.
  await graph.query(
    `
    MATCH (s:Skill)-[sr:DEMONSTRATED_IN]->(r:Repository)
    WHERE r.id IN $repository_ids
      AND coalesce(sr.developer_id, $developer_id) = $developer_id
      AND coalesce(sr.build_id, "") <> $build_id
    DELETE sr
    `,
    {
      params: {
        developer_id: developerId,
        repository_ids: repositoryIds,
        build_id: buildId,
      },
    },
  );

  return written;
}

export async function buildOverviewIntelligenceGraph(
  graph: Graph,
  developerId: string,
  onProgress: ProgressFn = () => {},
): Promise<OverviewGraphBuildResult> {
  if (!developerId) throw new Error("Missing developerId");

  const startedAt = Date.now();
  const buildId = `${startedAt}-${randomUUID()}`;

  log("=== overview intelligence graph: START ===", { developerId, buildId });
  onProgress("overview_graph_start", { developerId });

  await ensureDemonstrationIndexes(graph);
  await ensureGoalIndexes(graph);
  await storeCapabilities(graph);
  await storeEngineeringContexts(graph);

  const [skills, repositoryNames, commitMessages] = await Promise.all([
    fetchDeveloperSkills(graph, developerId),
    loadRepositoryNames(graph, developerId),
    loadCommitMessages(graph, developerId),
  ]);

  // The skill graph decides WHICH skills the developer has; the matcher is
  // only used to attribute them to repositories. It never rescores anything.
  const definitionsById = new Map(SKILL_TAXONOMY.map((def) => [def.id, def]));
  const skillTargets = skills.flatMap((skill) => {
    const def = definitionsById.get(skill.skillId);
    return def ? [{ skill, def }] : [];
  });

  const demonstrations: Demonstration[] = [];
  const skillRepositoryAggregates = new Map<string, SkillRepositoryAggregate>();
  const repositoryIds = new Set<string>();

  let scanned = 0;
  let skip = 0;

  // One paged pass over the evidence feeds both derivations, so patches are
  // never all in memory at once.
  while (true) {
    const page = await fetchEvidencePage(graph, developerId, skip);

    for (const fc of page) {
      if (fc.repositoryId) repositoryIds.add(fc.repositoryId);

      demonstrations.push(
        ...extractDemonstrations(fc, {
          repositoryFullName: repositoryNames.get(fc.repositoryId) ?? "",
          commitMessage:
            commitMessages.get(`${fc.repositoryId}:${fc.commitSha}`) ?? "",
        }),
      );
    }

    collectSkillRepositoryEvidence(
      page,
      skillTargets,
      skillRepositoryAggregates,
    );

    scanned += page.length;
    onProgress("overview_graph_evidence_scanned", {
      scanned,
      demonstrations: demonstrations.length,
    });

    if (page.length < EVIDENCE_PAGE_SIZE) break;
    skip += EVIDENCE_PAGE_SIZE;
  }

  onProgress("overview_graph_evidence_loaded", {
    fileChanges: scanned,
    repositories: repositoryNames.size,
    skills: skills.length,
  });

  const missionDemos = await loadDemonstrationRows(graph, developerId, true);
  const rollups = rollUpDemonstrations([...demonstrations, ...missionDemos]);

  await storeDemonstrations(graph, developerId, buildId, demonstrations);
  await storeDemonstrationUsage(graph, demonstrations);

  const experiences = await storeEngineeringExperiences(
    graph,
    developerId,
    buildId,
    demonstrations,
  );

  await storeDeveloperCapabilities(graph, developerId, rollups);
  await cleanupStale(
    graph,
    developerId,
    buildId,
    rollups.map((r) => r.capabilityId),
  );
  await cleanupStaleExperiences(graph, developerId, buildId);

  const skillRepositoryRelations = await storeSkillRepositoryRelations(
    graph,
    developerId,
    buildId,
    skillRepositoryAggregates,
    skills,
    Array.from(repositoryIds),
  );

  const leafRollups = rollups.filter(
    (r) => CAPABILITY_BY_ID.get(r.capabilityId)?.parentId,
  );

  const result: OverviewGraphBuildResult = {
    developerId,
    fileChangesAnalyzed: scanned,
    repositoriesFound: repositoryNames.size,
    skillsFound: skills.length,
    demonstrationsFound: demonstrations.length,
    experiencesFound: experiences.length,
    capabilitiesFound: leafRollups.length,
    domainsFound: rollups.length - leafRollups.length,
    capabilityLevels: leafRollups.reduce<Record<string, number>>((acc, r) => {
      acc[r.level] = (acc[r.level] ?? 0) + 1;
      return acc;
    }, {}),
    skillRepositoryRelations,
  };

  onProgress("overview_graph_complete", result);
  log("=== overview intelligence graph: COMPLETE ===", {
    ...result,
    durationMs: Date.now() - startedAt,
  });

  return result;
}

export async function removeLegacyConceptPatternGraph(
  graph: Graph,
): Promise<Record<string, number>> {
  const removed: Record<string, number> = {};

  for (const label of [
    "OverviewConcept",
    "OverviewPattern",
    "OverviewCategory",
  ]) {
    const rows = await queryRows(
      graph,
      `MATCH (n:${label}) RETURN count(n) AS n`,
    );
    removed[label] = safeNumber(rows[0]?.n);
    await graph.query(`MATCH (n:${label}) DETACH DELETE n`);
  }

  log("legacy concept/pattern graph removed", removed);
  return removed;
}
}
