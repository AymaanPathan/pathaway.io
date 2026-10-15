import type { Graph } from "../../db/falkordb.js";




import { Domain as _constants } from './constants.js';
import { Domain as _helpers } from './helpers.js';
import { Domain as _queries } from './queries.js';
import { Domain as _readers } from './readers.js';
import { Domain as _writers } from './writers.js';

export namespace Domain {
import LOG_PREFIX = _constants.LOG_PREFIX;
import ALL_LEVELS = _constants.ALL_LEVELS;
import LEVEL_RANK = _constants.LEVEL_RANK;
import DEPTH_BY_RANK = _constants.DEPTH_BY_RANK;
import schemaReady = _constants.schemaReady;
import log = _helpers.log;
import str = _helpers.str;
import num = _helpers.num;
import strList = _helpers.strList;
import mapList = _helpers.mapList;
import rows = _helpers.rows;
import tryRows = _helpers.tryRows;
import asLevel = _helpers.asLevel;
import evidenceStateFor = _helpers.evidenceStateFor;
import levelsInStates = _helpers.levelsInStates;
import MAX_PREREQUISITE_DEPTH = _helpers.MAX_PREREQUISITE_DEPTH;
import PREREQUISITE_SATISFIED_BY = _helpers.PREREQUISITE_SATISFIED_BY;
import MIN_DETECTIONS_FOR_CONFIDENCE = _helpers.MIN_DETECTIONS_FOR_CONFIDENCE;
import MIN_COMMITS_FOR_CONFIDENCE = _helpers.MIN_COMMITS_FOR_CONFIDENCE;
import GRAPH_MODEL = _helpers.GRAPH_MODEL;
import CAPABILITY_KEYWORDS = _helpers.CAPABILITY_KEYWORDS;
import ignoreExists = _helpers.ignoreExists;
import setupSearch = _helpers.setupSearch;
import STOPWORDS = _helpers.STOPWORDS;
import fulltextQuery = _helpers.fulltextQuery;
import EXPERIENCE_DETAIL = _helpers.EXPERIENCE_DETAIL;
import EXPERIENCE_MAP = _helpers.EXPERIENCE_MAP;
import toExperience = _helpers.toExperience;
import toProof = _helpers.toProof;
import deriveStrengths = _helpers.deriveStrengths;
import summariseDomains = _helpers.summariseDomains;
import badRepo = _helpers.badRepo;
import plural = _helpers.plural;
import explainSelf = _helpers.explainSelf;
import explainCapabilities = _helpers.explainCapabilities;
import explainProof = _helpers.explainProof;
import explainStrengths = _helpers.explainStrengths;
import explainTimeline = _helpers.explainTimeline;
import explainRepositories = _helpers.explainRepositories;
import explainCoverage = _helpers.explainCoverage;
import explainWhole = _helpers.explainWhole;
import buildLimitations = _helpers.buildLimitations;
import deriveFrontierStatus = _helpers.deriveFrontierStatus;
import byNameThenId = _helpers.byNameThenId;
import PREREQUISITE_CHECK = _queries.PREREQUISITE_CHECK;
import FRONTIER_QUERY = _queries.FRONTIER_QUERY;
import asStatus = _queries.asStatus;
import findCapabilitiesForText = _readers.findCapabilitiesForText;
import readTopExperiences = _readers.readTopExperiences;
import readSelf = _readers.readSelf;
import readExperiencesByCapability = _readers.readExperiencesByCapability;
import readProofs = _readers.readProofs;
import readCapabilityProofs = _readers.readCapabilityProofs;
import readCapabilityRows = _readers.readCapabilityRows;
import readBuiltCapabilities = _readers.readBuiltCapabilities;
import readTimeline = _readers.readTimeline;
import readJourneyRepositories = _readers.readJourneyRepositories;
import readCoverage = _readers.readCoverage;
import readCapabilityTrace = _readers.readCapabilityTrace;
import readRepositoryTrace = _readers.readRepositoryTrace;
import readJourney = _readers.readJourney;
import evaluateCapabilityCriteria = _readers.evaluateCapabilityCriteria;
import isGoalComplete = _readers.isGoalComplete;
import readFrontier = _readers.readFrontier;
import readFrontierChecked = _readers.readFrontierChecked;
import eligibleNextSteps = _readers.eligibleNextSteps;
import readDirections = _readers.readDirections;
import ensureJourneySchema = _writers.ensureJourneySchema;

export type Row = Record<string, any>;

export type CapLevel =
  | "missing"
  | "insufficient_evidence"
  | "usage"
  | "repeated_usage"
  | "implementation"
  | "strong";

export type EvidenceState =
  | "demonstrated"
  | "partial"
  | "unverified"
  | "missing";

export interface ProofRef {
  repository: string;
  path: string;
  startLine: number;
  endLine: number;
  permalink: string;
  snippet: string;
  commitSubject: string;
  depth: string;
  modifiers: string[];
}

export interface ExperienceBrief {
  id: string;
  technique: string;
  summary: string;
  problem: string;
  capabilityId: string;
  depth: string;
  evidenceCount: number;
  commitCount: number;
  repoCount: number;
  activeDays: number;
  firstSeen: string;
  lastSeen: string;
  repositories: string[];
  technologies: string[];
  contexts: string[];
  proof: ProofRef | null;
}

export interface SelfReadout {
  name: string;
  username: string;
  avatarUrl: string;
  totals: {
    repositories: number;
    commits: number;
    fileChanges: number;
    demonstrations: number;
    experiences: number;
    capabilities: number;
  };
  topExperiences: ExperienceBrief[];
  layers: Array<{ name: string; experiences: number; evidence: number }>;
  intents: Array<{ name: string; count: number }>;
  technologies: Array<{ name: string; experiences: number; evidence: number }>;
  habits: Array<{ label: string; count: number }>;
  repositories: Array<{
    name: string;
    experiences: number;
    evidence: number;
    techniques: string[];
  }>;
  depthMix: Array<{ depth: string; count: number }>;
  skills: Array<{ name: string; level: string; score: number }>;
  activity: Array<{ month: string; count: number }>;
}

export interface Coverage {
  /** false when coverage could not be determined: treat as unknown, not as "fine" */
  known: boolean;
  /** which graph path produced the numbers */
  source: "file_changes" | "contributed_to" | "none";
  repositories: number;
  incomplete: number;
  incompleteNames: string[];
}

export interface BuiltTechnique {
  ruleId: string;
  technique: string;
  timesBuilt: number;
  bestDepth: string;
  /** hardening behaviours actually observed in their code, most frequent first */
  hardening: Array<{ label: string; count: number }>;
}

export interface BuiltCapability {
  capabilityId: string;
  name: string;
  description: string;
  domainId: string;
  domain: string;
  level: CapLevel;
  state: EvidenceState;
  recency: string;
  bestDepth: string;
  evidenceCount: number;
  commitCount: number;
  repoCount: number;
  activeDays: number;
  firstSeen: string;
  lastSeen: string;
  techniques: BuiltTechnique[];
  /** engineering experiences grouped from the demonstrations (filled by readJourney) */
  experiences: ExperienceBrief[];
  /** strongest concrete demonstrations: the proof (filled by readJourney) */
  proofs: ProofRef[];
}

export type StrengthTier = "core" | "solid" | "emerging";

export interface JourneyStrength {
  capabilityId: string;
  name: string;
  domain: string;
  tier: StrengthTier;
  level: CapLevel;
  evidenceCount: number;
  commitCount: number;
  repoCount: number;
  activeDays: number;
  /** true when the evidence is thin (few detections or a single commit) */
  tentative: boolean;
  /** the numbers behind the tier, in plain words */
  reason: string;
}

export interface DomainSummary {
  domainId: string;
  domain: string;
  /** capabilities in this domain with any evidence */
  touched: number;
  /** of those, built (implementation or strong) */
  built: number;
  evidence: number;
  bestLevel: CapLevel;
}

export interface TimelinePoint {
  month: string;
  capabilityId: string;
  name: string;
  count: number;
  bestDepth: string;
}

export interface JourneyRepository {
  name: string;
  experiences: number;
  evidence: number;
  capabilities: string[];
  techniques: string[];
}

export interface GraphStep {
  section: string;
  /** the question this section answers */
  question: string;
  /** the graph path walked, in Cypher-style notation */
  pattern: string;
  rows: number;
  /** why this traversal answers that part of the journey */
  why: string;
  /** PLAIN ENGLISH: what FalkorDB actually did, with this developer's real numbers */
  explanation: string;
  /** the FalkorDB capabilities this step leaned on */
  falkordb: string[];
}

export interface Journey {
  developerId: string;
  self: SelfReadout;
  summary: {
    capabilitiesWithEvidence: number;
    built: number;
    partial: number;
    strengths: number;
    /** repositories in which detectors found evidence */
    repositories: number;
    /** repositories the developer committed to at all (from FileChange nodes) */
    repositoriesTouched: number;
  };
  /** every capability with evidence, strongest first, with techniques, experiences and proof */
  capabilities: BuiltCapability[];
  /** what they are good at: decided by deterministic rules over the graph */
  strengths: JourneyStrength[];
  domains: DomainSummary[];
  timeline: TimelinePoint[];
  repositories: JourneyRepository[];
  coverage: Coverage;
  /** the whole story in words: how FalkorDB turned commits into this journey */
  howFalkorDBAnswered: string;
  /** honest limits of what this journey can claim */
  limitations: string[];
  /** how each section was read from FalkorDB, step by step, in words */
  provenance: GraphStep[];
}

export interface CapabilityTrace {
  capabilityId: string;
  name: string;
  level: CapLevel;
  state: EvidenceState;
  evidenceCount: number;
  experiences: ExperienceBrief[];
  demonstrations: Array<{
    id: string;
    capabilityId: string;
    technique: string;
    depth: string;
    modifiers: string[];
    repository: string;
    path: string;
    startLine: number;
    endLine: number;
    permalink: string;
    commitSubject: string;
    changeIntent: string;
    layer: string;
    snippet: string;
    skills: string[];
    createdAt: string;
  }>;
}

export interface RepositoryTrace {
  query: string;
  matches: Array<{
    repository: string;
    experiences: Array<{
      id: string;
      technique: string;
      capabilityId: string;
      capability: string;
      depth: string;
      evidenceCount: number;
      firstSeen: string;
      lastSeen: string;
    }>;
  }>;
}

export interface CapabilityHit {
  capabilityId: string;
  name: string;
  score: number;
}

export type FrontierStatus = "demonstrated" | "eligible" | "blocked";

export interface PrerequisiteReadout {
  capabilityId: string;
  name: string;
  level: CapLevel;
  state: EvidenceState;
  /** true when this prerequisite's state is in PREREQUISITE_SATISFIED_BY */
  satisfied: boolean;
  evidenceCount: number;
  experiences: ExperienceBrief[];
}

export interface SafeguardCriterion {
  label: string;
  seen: boolean;
}

export interface TechniqueCriterion {
  ruleId: string;
  technique: string;
  built: number;
  bestDepth: string;
  permalink: string;
  path: string;
  safeguards: SafeguardCriterion[];
}

export interface FrontierNode {
  capabilityId: string;
  name: string;
  description: string;
  domain: string;
  status: FrontierStatus;
  state: EvidenceState;
  level: CapLevel;
  evidenceCount: number;
  commitCount: number;
  repoCount: number;
  activeDays: number;
  firstSeen: string;
  lastSeen: string;
  recency: string;
  requiredByGoal: boolean;
  priority: number;
  reason: string;
  criteriaMet: boolean;
  unmetCriteria: string[];
  prerequisites: PrerequisiteReadout[];
  unlocks: string[];
  routes: Array<{
    goalCapabilityId: string;
    goalCapabilityName: string;
    ids: string[];
    names: string[];
  }>;
}

export interface DirectionMove {
  capabilityId: string;
  name: string;
  kind: "deepen" | "extend";
  state: EvidenceState;
  level: CapLevel;
  builtOn: Array<{ id: string; name: string; level: CapLevel }>;
  unlocks: string[];
}

export interface DirectionReadout {
  domainId: string;
  domain: string;
  moves: DirectionMove[];
}
}
