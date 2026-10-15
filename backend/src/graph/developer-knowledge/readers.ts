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
import { Domain as _types } from './types.js';
import { Domain as _writers } from './writers.js';

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
import storeEngineeringExperiences = _writers.storeEngineeringExperiences;
import cleanupStaleExperiences = _writers.cleanupStaleExperiences;
import ensureGoalIndexes = _writers.ensureGoalIndexes;
import ensureCapabilityGraph = _writers.ensureCapabilityGraph;
import registerConcepts = _writers.registerConcepts;
import clearDeveloperGoal = _writers.clearDeveloperGoal;
import ensureDemonstrationIndexes = _writers.ensureDemonstrationIndexes;
import storeCapabilities = _writers.storeCapabilities;
import storeEngineeringContexts = _writers.storeEngineeringContexts;
import storeDemonstrations = _writers.storeDemonstrations;
import storeDemonstrationUsage = _writers.storeDemonstrationUsage;
import storeDeveloperCapabilities = _writers.storeDeveloperCapabilities;
import cleanupStale = _writers.cleanupStale;
import storeSkillRepositoryRelations = _writers.storeSkillRepositoryRelations;
import buildOverviewIntelligenceGraph = _writers.buildOverviewIntelligenceGraph;
import removeLegacyConceptPatternGraph = _writers.removeLegacyConceptPatternGraph;

export const isLearnableCapability = (id: string): boolean =>
  CAPABILITY_BY_ID.get(id)?.parentId != null;

export function evaluateCapabilityCompletion(
  capabilityId: string,
  demos: Demonstration[],
): CapabilityCompletion {
  const specs = COMPLETION_CRITERIA_BY_CAPABILITY.get(capabilityId) ?? [];

  const techniques = specs.map((spec): TechniqueCompletion => {
    const own = demos.filter((d) => d.ruleId === spec.ruleId);
    const observed = new Set(own.flatMap((d) => d.modifiers ?? []));
    const best = own.reduce(
      (rank, d) => Math.max(rank, DEPTH_RANK[d.depth] ?? 0),
      0,
    );
    const depthReached = best >= DEPTH_RANK[spec.minimumDepth];

    const safeguards = spec.safeguards.map((s) => ({
      id: s.id,
      name: s.name,
      required: s.required,
      observed: observed.has(s.modifierLabel),
    }));
    const missingRequired = safeguards
      .filter((s) => s.required && !s.observed)
      .map((s) => s.name);

    return {
      specId: spec.id,
      name: spec.name,
      ruleId: spec.ruleId,
      met: own.length > 0 && depthReached && missingRequired.length === 0,
      depthReached,
      safeguards,
      missingRequired,
    };
  });

  return {
    capabilityId,
    complete: techniques.some((t) => t.met),
    techniques,
  };
}

export function hashExperienceFingerprint(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

export async function getEngineeringExperiences(
  graph: Graph,
  developerId: string,
  limit = 50,
): Promise<Array<AnyObject>> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 200);
  return queryRows(
    graph,
    `
    MATCH (d:Developer {id: $developer_id})-[:EXPERIENCED]->(e:Experience)
    OPTIONAL MATCH (e)-[:SOLVES]->(p:Problem)
    OPTIONAL MATCH (e)-[:DEMONSTRATES_CAPABILITY]->(c:Capability)
    OPTIONAL MATCH (e)-[:USES_TECHNIQUE]->(t:Technique)
    OPTIONAL MATCH (e)-[:USES_TECHNOLOGY]->(tech:Technology)
    OPTIONAL MATCH (e)-[:OCCURS_IN]->(r:Repository)
    OPTIONAL MATCH (e)-[:IN_CONTEXT]->(ctx:EngineeringContext)
    RETURN e.id AS id,
           e.fingerprint AS fingerprint,
           e.summary AS summary,
           p.statement AS problem,
           c.id AS capability_id,
           c.name AS capability,
           collect(DISTINCT t.name) AS techniques,
           collect(DISTINCT tech.name) AS technologies,
           collect(DISTINCT r.full_name) AS repositories,
           collect(DISTINCT ctx.name) AS contexts,
           e.evidence_count AS evidence_count,
           e.commit_count AS commit_count,
           e.repo_count AS repo_count,
           e.best_depth AS best_depth,
           e.first_seen AS first_seen,
           e.last_seen AS last_seen
    ORDER BY evidence_count DESC, last_seen DESC
    LIMIT ${safeLimit}
    `,
    { developer_id: developerId },
  );
}

export function capabilityDefinitionsVersion(
  relationships: readonly CapabilityRelationship[] = CAPABILITY_GRAPH_RELATIONSHIPS,
): string {
  const payload = JSON.stringify({
    capabilities: CAPABILITIES,
    relationships,
    criteria: COMPLETION_CRITERIA,
  });
  return createHash("sha1").update(payload).digest("hex").slice(0, 16);
}

export async function isCapabilityGraphCurrent(
  graph: Graph,
  relationships: readonly CapabilityRelationship[] = CAPABILITY_GRAPH_RELATIONSHIPS,
): Promise<boolean> {
  const rows = await queryRows(
    graph,
    `
    MATCH (s:CapabilitySchema {id: $id})
    RETURN s.version AS version
    `,
    { id: CAPABILITY_SCHEMA_NODE_ID },
  );
  return (
    safeString(rows[0]?.version) === capabilityDefinitionsVersion(relationships)
  );
}

export async function getDeveloperGoal(
  graph: Graph,
  developerId: string,
): Promise<DeveloperGoal | null> {
  const rows = await queryRows(
    graph,
    `
    MATCH (d:Developer {id: $developer_id})-[:HAS_GOAL]->(g:Goal)
    OPTIONAL MATCH (g)-[req:REQUIRES]->(c:Capability)
    OPTIONAL MATCH (d)-[cap:HAS_CAPABILITY]->(c)
    RETURN g.id AS goal_id,
           g.name AS goal_name,
           coalesce(g.description, "") AS goal_description,
           c.id AS capability_id,
           coalesce(c.name, "") AS capability_name,
           coalesce(req.priority, 0) AS priority,
           coalesce(req.reason, "") AS reason,
           coalesce(cap.level, "missing") AS level,
           coalesce(cap.evidence_count, 0) AS evidence_count,
           coalesce(cap.last_seen, "") AS last_seen
    ORDER BY priority DESC, capability_name ASC
    `,
    { developer_id: developerId },
  );

  if (rows.length === 0) return null;

  const first = rows[0];
  return {
    id: safeString(first.goal_id),
    name: safeString(first.goal_name),
    description: safeString(first.goal_description),
    requirements: rows
      .filter((row) => safeString(row.capability_id))
      .map((row) => ({
        capabilityId: safeString(row.capability_id),
        capabilityName: safeString(row.capability_name),
        priority: safeNumber(row.priority),
        reason: safeString(row.reason),
        level: (safeString(row.level) || "missing") as
          | CapabilityLevel
          | "missing",
        evidenceCount: safeNumber(row.evidence_count),
        lastSeen: safeString(row.last_seen),
      })),
  };
}

export async function findCapabilityGaps(
  graph: Graph,
  developerId: string,
  limit = 20,
): Promise<CapabilityGap[]> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 100);

  // FalkorDB only supports DIRECTED shortestPath, so we search both
  // directions and keep the shorter path.
  const rows = await queryRows(
    graph,
    `
    MATCH (d:Developer {id: $developer_id})-[:HAS_GOAL]->(g:Goal)
    MATCH (g)-[req:REQUIRES]->(target:Capability)
    OPTIONAL MATCH (d)-[hc:HAS_CAPABILITY]->(target)
    OPTIONAL MATCH (d)-[:HAS_CAPABILITY]->(have:Capability)
    WHERE have.id <> target.id AND have.parent_id <> ""
    WITH target, req, hc, have,
         shortestPath(
           (have)-[:SPECIALIZES|PREREQUISITE_OF|RELATED_TO*1..4]->(target)
         ) AS forward_path,
         shortestPath(
           (have)<-[:SPECIALIZES|PREREQUISITE_OF|RELATED_TO*1..4]-(target)
         ) AS reverse_path
    WITH target, req, hc, have, forward_path, reverse_path,
         CASE
           WHEN forward_path IS NULL THEN reverse_path
           WHEN reverse_path IS NULL THEN forward_path
           WHEN length(forward_path) <= length(reverse_path) THEN forward_path
           ELSE reverse_path
         END AS p
    RETURN target.id AS capability_id,
           target.name AS capability_name,
           req.priority AS priority,
           coalesce(req.reason, "") AS reason,
           coalesce(hc.level, "missing") AS current_level,
           coalesce(hc.evidence_count, 0) AS evidence_count,
           CASE WHEN p IS NULL THEN 99 ELSE length(p) END AS graph_distance,
           CASE
             WHEN p IS NULL THEN []
             ELSE [n IN nodes(p) | n.id]
           END AS capability_path,
           CASE
             WHEN p IS NULL THEN []
             ELSE [r IN relationships(p) | type(r)]
           END AS path_relationships
    `,
    { developer_id: developerId },
  );

  const bestByTarget = new Map<string, AnyObject>();

  for (const row of rows) {
    const capabilityId = safeString(row.capability_id);
    if (!capabilityId) continue;

    let path: string[] = Array.isArray(row.capability_path)
      ? row.capability_path.map(safeString).filter(Boolean)
      : [];
    let rels: string[] = Array.isArray(row.path_relationships)
      ? row.path_relationships.map(safeString).filter(Boolean)
      : [];

    // Always orient the path: demonstrated capability first, target last.
    if (path.length > 1 && path[0] === capabilityId) {
      path = [...path].reverse();
      rels = [...rels].reverse();
    }
    const distance = safeNumber(row.graph_distance) || 99;
    const evidenceCount = safeNumber(row.evidence_count);
    const level = (safeString(row.current_level) || "missing") as
      | CapabilityLevel
      | "missing";

    // Direct evidence closes the gap. Weak evidence still leaves a smaller
    // gap than no evidence, while a nearby demonstrated capability gives the
    // recommendation a graph-grounded bridge.
    const levelPenalty: Record<CapabilityLevel | "missing", number> = {
      missing: 1,
      insufficient_evidence: 0.9,
      usage: 0.7,
      repeated_usage: 0.45,
      implementation: 0.2,
      strong: 0,
    };

    const distancePenalty = distance >= 99 ? 0.15 : 1 / (distance + 1);
    const gapScore =
      safeNumber(row.priority) * 0.4 +
      levelPenalty[level] * 0.45 +
      distancePenalty * 0.15;

    const candidate = {
      ...row,
      path,
      rels,
      distance,
      gapScore,
    };

    // One row per (target, nearby capability). Keep the highest-scoring one,
    // which is the closest demonstrated capability.
    const existing = bestByTarget.get(capabilityId);
    if (!existing || candidate.gapScore > existing.gapScore) {
      bestByTarget.set(capabilityId, candidate);
    }
  }

  const capabilityNameById = new Map(CAPABILITIES.map((c) => [c.id, c.name]));

  return [...bestByTarget.values()]
    .filter((candidate) => candidate.current_level !== "strong")
    .sort((a, b) => b.gapScore - a.gapScore)
    .slice(0, safeLimit)
    .map((candidate) => {
      const path = candidate.path as string[];

      // Bridge = closest specific skill before the target, not a broad group.
      let bridgeId = "";
      for (let i = path.length - 2; i >= 0; i--) {
        if (CAPABILITY_BY_ID.get(path[i])?.parentId) {
          bridgeId = path[i];
          break;
        }
      }
      if (!bridgeId && path.length >= 2) bridgeId = path[path.length - 2];

      return {
        capabilityId: safeString(candidate.capability_id),
        capabilityName: safeString(candidate.capability_name),
        priority: safeNumber(candidate.priority),
        reason: safeString(candidate.reason),
        currentLevel: candidate.current_level as CapabilityLevel | "missing",
        evidenceCount: safeNumber(candidate.evidence_count),
        graphDistance: safeNumber(candidate.distance),
        capabilityPath: path,
        pathRelationships: candidate.rels as string[],
        bridgeCapabilityId: bridgeId,
        bridgeCapabilityName: capabilityNameById.get(bridgeId) ?? bridgeId,
        gapScore: safeNumber(candidate.gapScore),
      };
    });
}

export async function loadRepositoryNames(
  graph: Graph,
  developerId: string,
): Promise<Map<string, string>> {
  const rows = await queryRows(
    graph,
    `
    MATCH (d:Developer {id: $developer_id})-[:AUTHORED_CODE]->(fc:FileChange)
    WITH DISTINCT fc.repository_id AS repository_id
    MATCH (r:Repository {id: repository_id})
    RETURN r.id AS id, coalesce(r.full_name, r.name, "") AS full_name
    `,
    { developer_id: developerId },
  );

  return new Map(rows.map((r) => [safeString(r.id), safeString(r.full_name)]));
}

export async function loadCommitMessages(
  graph: Graph,
  developerId: string,
): Promise<Map<string, string>> {
  const rows = await queryRows(
    graph,
    `
    MATCH (d:Developer {id: $developer_id})-[:MADE]->(c:Commit)
    RETURN c.repository_id AS repository_id, c.sha AS sha, c.message AS message
    `,
    { developer_id: developerId },
  );

  return new Map(
    rows.map((r) => [
      `${safeString(r.repository_id)}:${safeString(r.sha)}`,
      safeString(r.message),
    ]),
  );
}

export async function fetchEvidencePage(
  graph: Graph,
  developerId: string,
  skip: number,
): Promise<EvidenceInput[]> {
  const safeSkip = Math.max(0, Math.floor(skip));

  const rows = await queryRows(
    graph,
    `
    MATCH (d:Developer {id: $developer_id})-[:AUTHORED_CODE]->(fc:FileChange)
    RETURN fc.id AS id,
           fc.path AS path,
           fc.language AS language,
           fc.patch AS patch,
           fc.added_code AS added_code,
           fc.commit_sha AS commit_sha,
           fc.repository_id AS repository_id,
           fc.created_at AS created_at
    ORDER BY fc.id
    SKIP ${safeSkip}
    LIMIT ${EVIDENCE_PAGE_SIZE}
    `,
    { developer_id: developerId },
  );

  return rows.map((row) => ({
    id: safeString(row.id),
    path: safeString(row.path),
    language: safeString(row.language),
    patch: safeString(row.patch),
    addedCode: safeString(row.added_code),
    commitSha: safeString(row.commit_sha),
    repositoryId: safeString(row.repository_id),
    createdAt: safeString(row.created_at),
  }));
}

export async function fetchDeveloperSkills(
  graph: Graph,
  developerId: string,
): Promise<StoredSkillRow[]> {
  const rows = await queryRows(
    graph,
    `
    MATCH (d:Developer {id: $developer_id})-[r:HAS_SKILL]->(s:Skill)
    RETURN s.id AS skill_id,
           s.name AS skill_name,
           coalesce(r.depth_score, 0) AS score
    ORDER BY score DESC
    `,
    { developer_id: developerId },
  );

  return rows.map((row) => ({
    skillId: safeString(row.skill_id),
    skillName: safeString(row.skill_name),
    score: safeNumber(row.score),
  }));
}

export async function loadDemonstrationRows(
  graph: Graph,
  developerId: string,
  onlyMission = false,
): Promise<Demonstration[]> {
  const rows = await queryRows(
    graph,
    `
    MATCH (d:Developer {id: $developer_id})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability)
    WHERE $only_mission = false OR x.source = "mission"
    RETURN x.id AS id,
           c.id AS capability_id,
           x.rule_id AS rule_id,
           x.technique AS technique,
           x.modifiers AS modifiers,
           x.depth AS depth,
           x.repository_id AS repository_id,
           x.commit_sha AS commit_sha,
           x.created_at AS created_at
    `,
    { developer_id: developerId, only_mission: onlyMission },
  );

  // Only the fields the roll-up and completion check read.
  return rows.map(
    (r) =>
      ({
        id: safeString(r.id),
        capabilityId: safeString(r.capability_id),
        ruleId: safeString(r.rule_id),
        technique: safeString(r.technique),
        modifiers: safeString(r.modifiers).split(" | ").filter(Boolean),
        depth: (safeString(r.depth) || "usage") as DemonstrationDepth,
        repositoryId: safeString(r.repository_id),
        commitSha: safeString(r.commit_sha),
        createdAt: safeString(r.created_at),
      }) as unknown as Demonstration,
  );
}

export async function getCapabilityProfile(
  graph: Graph,
  developerId: string,
): Promise<DomainProfile[]> {
  const rows = await queryRows(
    graph,
    `
    MATCH (d:Developer {id: $developer_id})-[r:HAS_CAPABILITY]->(c:Capability)
    RETURN c.id AS id,
           c.name AS name,
           coalesce(c.description, "") AS description,
           coalesce(c.parent_id, "") AS parent_id,
           r.level AS level,
           r.recency AS recency,
           r.best_depth AS best_depth,
           r.evidence_count AS evidence_count,
           r.commit_count AS commit_count,
           r.repo_count AS repo_count,
           r.technique_count AS technique_count,
           r.active_days AS active_days,
           r.first_seen AS first_seen,
           r.last_seen AS last_seen,
           r.techniques_json AS techniques_json
    `,
    { developer_id: developerId },
  );

  const toEntry = (row: AnyObject): CapabilityProfileEntry => ({
    capabilityId: safeString(row.id),
    name: safeString(row.name),
    description: safeString(row.description),
    level: (safeString(row.level) ||
      "insufficient_evidence") as CapabilityLevel,
    recency: (safeString(row.recency) || "historical") as Recency,
    bestDepth: (safeString(row.best_depth) || "usage") as DemonstrationDepth,
    evidenceCount: safeNumber(row.evidence_count),
    commitCount: safeNumber(row.commit_count),
    repoCount: safeNumber(row.repo_count),
    techniqueCount: safeNumber(row.technique_count),
    activeDays: safeNumber(row.active_days),
    firstSeen: safeString(row.first_seen),
    lastSeen: safeString(row.last_seen),
    topTechniques: parseTechniques(row.techniques_json),
  });

  const domains = new Map<string, DomainProfile>();

  for (const row of rows) {
    if (!safeString(row.parent_id)) {
      domains.set(safeString(row.id), { ...toEntry(row), capabilities: [] });
    }
  }

  for (const row of rows) {
    const parentId = safeString(row.parent_id);
    if (parentId) domains.get(parentId)?.capabilities.push(toEntry(row));
  }

  const result = Array.from(domains.values());
  for (const d of result) d.capabilities.sort(byLevelThenEvidence);
  return result.sort(byLevelThenEvidence);
}

export async function getCapabilityEvidence(
  graph: Graph,
  developerId: string,
  capabilityId = "",
  limit = 10,
): Promise<DemonstrationEvidence[]> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 50);

  const rows = await queryRows(
    graph,
    `
    MATCH (d:Developer {id: $developer_id})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability)
    WHERE $capability_id = "" OR c.id = $capability_id OR c.parent_id = $capability_id

    MATCH (x)-[:IN_REPOSITORY]->(r:Repository)
    OPTIONAL MATCH (x)-[:IN_CONTEXT]->(e:EngineeringContext)
    OPTIONAL MATCH (x)-[:USES]->(s:Skill)

    WITH x, c, r, e, collect(DISTINCT s.name) AS skills

    RETURN x.id AS id,
           c.id AS capability_id,
           x.technique AS technique,
           x.summary AS summary,
           x.modifiers AS modifiers,
           x.depth AS depth,
           x.depth_rank AS depth_rank,
           coalesce(r.full_name, r.name, "") AS repository,
           x.path AS path,
           x.start_line AS start_line,
           x.end_line AS end_line,
           x.permalink AS permalink,
           x.commit_sha AS commit_sha,
           x.commit_subject AS commit_subject,
           x.change_intent AS change_intent,
           coalesce(e.name, "") AS layer,
           x.snippet AS snippet,
           skills,
           x.created_at AS created_at

    ORDER BY depth_rank DESC, created_at DESC
    LIMIT ${safeLimit}
    `,
    { developer_id: developerId, capability_id: capabilityId },
  );

  return rows.map((row) => ({
    id: safeString(row.id),
    capabilityId: safeString(row.capability_id),
    technique: safeString(row.technique),
    summary: safeString(row.summary),
    modifiers: safeString(row.modifiers).split(" | ").filter(Boolean),
    depth: (safeString(row.depth) || "usage") as DemonstrationDepth,
    repository: safeString(row.repository),
    path: safeString(row.path),
    startLine: safeNumber(row.start_line),
    endLine: safeNumber(row.end_line),
    permalink: safeString(row.permalink),
    commitSha: safeString(row.commit_sha),
    commitSubject: safeString(row.commit_subject),
    changeIntent: safeString(row.change_intent),
    layer: safeString(row.layer),
    snippet: safeString(row.snippet),
    usesSkills: Array.isArray(row.skills) ? row.skills.map(safeString) : [],
    createdAt: safeString(row.created_at),
  }));
}

export async function getOverviewGraphSnapshot(
  graph: Graph,
  developerId: string,
  evidenceLimit = 40,
): Promise<OverviewGraphSnapshot> {
  if (!developerId) throw new Error("Missing developerId");

  const [
    developerRows,
    domains,
    evidence,
    goal,
    skillRows,
    repositoryRows,
    relationshipRows,
  ] = await Promise.all([
    queryRows(
      graph,
      `
      MATCH (d:Developer)
      WHERE d.id = $developer_id
      RETURN d.id AS id,
             d.name AS name,
             d.username AS username,
             d.avatar_url AS avatar_url
      `,
      { developer_id: developerId },
    ),

    getCapabilityProfile(graph, developerId),

    getCapabilityEvidence(graph, developerId, "", evidenceLimit),

    getDeveloperGoal(graph, developerId),

    queryRows(
      graph,
      `
      MATCH (d:Developer)-[r:HAS_SKILL]->(s:Skill)
      WHERE d.id = $developer_id
      OPTIONAL MATCH (c:SkillCategory)-[:CONTAINS]->(s)
      RETURN s.id AS id,
             s.name AS name,
             coalesce(c.name, "") AS category,
             coalesce(r.depth_score, 0) AS score,
             coalesce(r.level, "") AS level,
             coalesce(r.files_touched, 0) AS files_touched,
             coalesce(r.commits_count, 0) AS commits_count,
             coalesce(r.repos_count, 0) AS repos_count,
             coalesce(r.active_days, 0) AS active_days,
             coalesce(r.first_seen, "") AS first_seen,
             coalesce(r.last_seen, "") AS last_seen
      ORDER BY score DESC
      `,
      { developer_id: developerId },
    ),

    queryRows(
      graph,
      `
      MATCH (d:Developer)-[:AUTHORED_CODE]->(fc:FileChange)
      WHERE d.id = $developer_id
      WITH fc.repository_id AS repository_id,
           count(DISTINCT fc) AS file_change_count,
           count(DISTINCT fc.commit_sha) AS commit_count,
           min(fc.created_at) AS first_evidence_at,
           max(fc.created_at) AS last_evidence_at
      WHERE repository_id IS NOT NULL AND repository_id <> ""
      MATCH (r:Repository {id: repository_id})
      RETURN r.id AS id,
             r.name AS name,
             r.full_name AS full_name,
             r.description AS description,
             r.language AS language,
             r.url AS url,
             file_change_count,
             commit_count,
             first_evidence_at,
             last_evidence_at
      ORDER BY file_change_count DESC, last_evidence_at DESC
      `,
      { developer_id: developerId },
    ),

    queryRows(
      graph,
      `
      MATCH (d:Developer)-[r]->(x)
      WHERE d.id = $developer_id
        AND type(r) IN ["HAS_SKILL", "HAS_CAPABILITY"]
      RETURN d.id AS from_id,
             x.id AS to_id,
             type(r) AS relationship_type,
             coalesce(r.level, "") AS level,
             coalesce(r.evidence_count, r.files_touched, 0) AS evidence_count,
             coalesce(r.depth_score, 0) AS score,
             coalesce(r.commit_count, r.commits_count, 0) AS commit_count,
             coalesce(r.first_seen, "") AS first_seen,
             coalesce(r.last_seen, "") AS last_seen
      `,
      { developer_id: developerId },
    ),
  ]);

  const developer = developerRows[0] ?? {};

  return {
    developer: {
      id: safeString(developer.id),
      name: safeString(developer.name),
      username: safeString(developer.username),
      avatarUrl: safeString(developer.avatar_url),
    },

    domains,
    evidence,
    goal,

    skills: skillRows.map((row) => ({
      id: safeString(row.id),
      name: safeString(row.name),
      category: safeString(row.category),
      score: safeNumber(row.score),
      level: safeString(row.level),
      filesTouched: safeNumber(row.files_touched),
      commitsCount: safeNumber(row.commits_count),
      reposCount: safeNumber(row.repos_count),
      activeDays: safeNumber(row.active_days),
      firstSeen: safeString(row.first_seen),
      lastSeen: safeString(row.last_seen),
    })),

    repositories: repositoryRows.map((row) => ({
      id: safeString(row.id),
      name: safeString(row.name),
      fullName: safeString(row.full_name),
      description: safeString(row.description),
      language: safeString(row.language),
      url: safeString(row.url),
      fileChangeCount: safeNumber(row.file_change_count),
      commitCount: safeNumber(row.commit_count),
      firstEvidenceAt: safeString(row.first_evidence_at),
      lastEvidenceAt: safeString(row.last_evidence_at),
    })),

    relationships: relationshipRows.map((row) => ({
      from: safeString(row.from_id),
      to: safeString(row.to_id),
      type: safeString(row.relationship_type),
      level: safeString(row.level),
      evidenceCount: safeNumber(row.evidence_count),
      score: safeNumber(row.score),
      commitCount: safeNumber(row.commit_count),
      firstSeen: safeString(row.first_seen),
      lastSeen: safeString(row.last_seen),
    })),
  };
}
}
