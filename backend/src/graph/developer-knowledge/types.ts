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

export type AnyObject = Record<string, any>;

export type ProgressFn = (stage: string, detail?: AnyObject) => void;

export type QueryPrimitive = string | number | boolean | null;

export type QueryParamObject = Record<string, QueryPrimitive>;

export interface CapabilityDefinition {
  id: string;
  name: string;
  parentId: string | null;
  description: string;
}

export interface EngineeringContextDefinition {
  id: string;
  name: string;
  pattern: RegExp | null;
}

export type DemonstrationDepth = "usage" | "implementation" | "strong";

export interface ModifierRule {
  label: string;
  pattern: RegExp;
}

export interface UsesRule {
  skillId: string; // must match a Skill.id from SKILL_TAXONOMY
  when?: RegExp; // tested against `${path}\n${addedCode}`
}

export interface SignalRule {
  id: string;
  capabilityId: string;
  technique: string;
  tier: "usage" | "implementation";
  allOf: RegExp[][];
  anchor: RegExp; // single-line regex used to locate the snippet
  pathPatterns?: RegExp[];
  excludeIf?: RegExp[];
  modifierWindow?: number;
  modifiers?: ModifierRule[];
  uses?: UsesRule[];
}

export interface AddedLine {
  line: number; 
  text: string;
}

export interface EvidenceInput {
  id: string; 
  path: string;
  language: string;
  patch: string;
  addedCode: string; 
  commitSha: string;
  repositoryId: string;
  createdAt: string;
}

export interface EvidenceContext {
  repositoryFullName: string;
  commitMessage: string;
}

export interface Demonstration {
  id: string;
  ruleId: string;
  capabilityId: string;
  technique: string;
  modifiers: string[];
  depth: DemonstrationDepth;
  summary: string;

  fileChangeId: string;
  repositoryId: string;
  commitSha: string;
  path: string;
  language: string;
  startLine: number;
  endLine: number;
  snippet: string;
  permalink: string;

  layerId: string;
  layerName: string;
  intent: string;
  commitSubject: string;

  usesSkillIds: string[];
  createdAt: string;
}

export interface SafeguardDefinition {
  id: string;
  name: string;
  /** Why this safeguard matters: the failure it prevents. */
  why: string;
  /** Exact label of a modifier on the technique's SIGNAL_RULE. */
  modifierLabel: string;
  required: boolean;
}

export interface TechniqueSpecDefinition {
  id: string;
  capabilityId: string;
  /** The SIGNAL_RULE whose demonstrations are the only evidence for this spec. */
  ruleId: string;
  name: string;
  description: string;
  minimumDepth: DemonstrationDepth;
  safeguards: SafeguardDefinition[];
}

export type SafeguardTuple = [modifierLabel: string, why: string, required: boolean];

export interface SafeguardStatus {
  id: string;
  name: string;
  required: boolean;
  observed: boolean;
}

export interface TechniqueCompletion {
  specId: string;
  name: string;
  ruleId: string;
  met: boolean;
  depthReached: boolean;
  safeguards: SafeguardStatus[];
  missingRequired: string[];
}

export interface CapabilityCompletion {
  capabilityId: string;
  complete: boolean;
  techniques: TechniqueCompletion[];
}

export interface EngineeringExperience {
  id: string;
  fingerprint: string;
  summary: string;
  problemStatement: string;
  problemId: string;
  capabilityId: string;
  technique: string;
  technologyIds: string[];
  repositoryIds: string[];
  contextIds: string[];
  evidenceCount: number;
  commitCount: number;
  repoCount: number;
  activeDays: number;
  bestDepth: DemonstrationDepth;
  firstSeen: string;
  lastSeen: string;
  demonstrationIds: string[];
  fileChangeIds: string[];
  buildId?: string;
}

export type CapabilityLevel =
  | "insufficient_evidence"
  | "usage"
  | "repeated_usage"
  | "implementation"
  | "strong";

export type Recency = "recent" | "historical" | "inactive";

export type EvidenceState = "demonstrated" | "partial" | "unverified";

export interface CapabilityRollup {
  capabilityId: string;
  level: CapabilityLevel;
  recency: Recency;
  bestDepth: DemonstrationDepth;
  evidenceCount: number;
  commitCount: number;
  repoCount: number;
  techniqueCount: number;
  activeDays: number;
  firstSeen: string;
  lastSeen: string;
  techniquesJson: string;
}

export interface GoalDefinition {
  id: string;
  name: string;
  description: string;
  /**
   * Parts of the goal text the capability list cannot express. A goal with
   * anything unsupported can never be reported complete: Pathway cannot judge it.
   */
  unsupported?: string[];
}

export interface GoalRequirement {
  capabilityId: string;
  priority?: number;
  reason?: string;
}

export interface DeveloperGoal {
  id: string;
  name: string;
  description: string;
  requirements: Array<{
    capabilityId: string;
    capabilityName: string;
    priority: number;
    reason: string;
    level: CapabilityLevel | "missing";
    evidenceCount: number;
    lastSeen: string;
  }>;
}

export interface CapabilityGap {
  capabilityId: string;
  capabilityName: string;
  priority: number;
  reason: string;
  currentLevel: CapabilityLevel | "missing";
  evidenceCount: number;
  graphDistance: number;
  capabilityPath: string[];
  pathRelationships: string[];
  bridgeCapabilityId: string;
  bridgeCapabilityName: string;
  gapScore: number;
}

export interface CapabilityRelationship {
  from: string;
  to: string;
  type: "PREREQUISITE_OF" | "RELATED_TO";
  weight: number;
  /** Required for PREREQUISITE_OF (why it is a real dependency). Optional note for RELATED_TO. */
  reason: string;
}

export interface CapabilityDependency {
  requires: Array<{ capabilityId: string; reason: string }>;
  noPrerequisiteReason?: string;
}

export interface CapabilityGraphProblem {
  code:
    | "unknown_capability"
    | "self_loop"
    | "category_endpoint"
    | "duplicate_edge"
    | "conflicting_edge_types"
    | "prerequisite_cycle"
    | "path_too_deep"
    | "no_evidence_rule"
    | "missing_reason"
    | "invalid_parent"
    | "dependency_audit_missing"
    | "dependency_audit_invalid"
    | "criteria_unknown_rule"
    | "criteria_unknown_safeguard"
    | "criteria_missing"
    | "criteria_depth_unreachable"
    | "criteria_duplicate";
  message: string;
}

export interface ConceptProposal {
  name: string;
  /** must be an existing LEARNABLE capability this concept refines */
  parentId: string;
  description?: string;
}

export interface RegisteredConcept {
  id: string;
  name: string;
  /** true only when this call created a new Concept node */
  created: boolean;
  /** which existing node it resolved to, or null when it was newly created */
  existing: "capability" | "concept" | null;
}

export interface StoredSkillRow {
  skillId: string;
  skillName: string;
  score: number;
}

export interface SkillRepositoryAggregate {
  skillId: string;
  repositoryId: string;
  evidenceCount: number;
  commitShas: Set<string>;
  firstSeenTs: number;
  lastSeenTs: number;
  evidencePath: string;
  evidenceCommitSha: string;
}

export interface OverviewGraphBuildResult {
  developerId: string;
  fileChangesAnalyzed: number;
  repositoriesFound: number;
  skillsFound: number;
  demonstrationsFound: number;
  experiencesFound: number;
  capabilitiesFound: number;
  domainsFound: number;
  capabilityLevels: Record<string, number>;
  skillRepositoryRelations: number;
}

export interface CapabilityProfileEntry {
  capabilityId: string;
  name: string;
  description: string;
  level: CapabilityLevel;
  recency: Recency;
  bestDepth: DemonstrationDepth;
  evidenceCount: number;
  commitCount: number;
  repoCount: number;
  techniqueCount: number;
  activeDays: number;
  firstSeen: string;
  lastSeen: string;
  topTechniques: Array<{ technique: string; count: number }>;
}

export interface DomainProfile extends CapabilityProfileEntry {
  capabilities: CapabilityProfileEntry[];
}

export interface DemonstrationEvidence {
  id: string;
  capabilityId: string;
  technique: string;
  summary: string;
  modifiers: string[];
  depth: DemonstrationDepth;
  repository: string;
  path: string;
  startLine: number;
  endLine: number;
  permalink: string;
  commitSha: string;
  commitSubject: string;
  changeIntent: string;
  layer: string;
  snippet: string;
  usesSkills: string[];
  createdAt: string;
}

export interface OverviewGraphSnapshot {
  developer: {
    id: string;
    name: string;
    username: string;
    avatarUrl: string;
  };

  /** Domain -> capability profile: level, recency, raw counts, top techniques. */
  domains: DomainProfile[];

  /** Strongest concrete demonstrations across all capabilities (the proof). */
  evidence: DemonstrationEvidence[];

  /** Active developer goal and its evidence-backed capability requirements. */
  goal: DeveloperGoal | null;

  skills: Array<{
    id: string;
    name: string;
    category: string;
    score: number;
    level: string;
    filesTouched: number;
    commitsCount: number;
    reposCount: number;
    activeDays: number;
    firstSeen: string;
    lastSeen: string;
  }>;

  repositories: Array<{
    id: string;
    name: string;
    fullName: string;
    description: string;
    language: string;
    url: string;
    fileChangeCount: number;
    commitCount: number;
    firstEvidenceAt: string;
    lastEvidenceAt: string;
  }>;

  relationships: Array<{
    from: string;
    to: string;
    type: string;
    level: string;
    evidenceCount: number;
    score: number;
    commitCount: number;
    firstSeen: string;
    lastSeen: string;
  }>;
}
}
