import type { Graph } from "../../db/falkordb.js";




import { Domain as _constants } from './constants.js';
import { Domain as _helpers_extra } from './helpers-extra.js';
import { Domain as _helpers } from './helpers.js';
import { Domain as _queries } from './queries.js';
import { Domain as _readers_extra2 } from './readers-extra2.js';
import { Domain as _readers } from './readers.js';
import { Domain as _writers } from './writers.js';

export namespace Domain {
import LOG_PREFIX = _constants.LOG_PREFIX;
import FILE_PAGE_SIZE = _constants.FILE_PAGE_SIZE;
import DB_BATCH_SIZE = _constants.DB_BATCH_SIZE;
import DEMO_LIMIT = _constants.DEMO_LIMIT;
import TAXONOMY_TTL_MS = _constants.TAXONOMY_TTL_MS;
import DEPTH_ANALYSIS_VERSION = _constants.DEPTH_ANALYSIS_VERSION;
import DEPTH_RANK = _constants.DEPTH_RANK;
import DEPTH_LEVELS = _constants.DEPTH_LEVELS;
import DEPTH_BANDS = _constants.DEPTH_BANDS;
import TOPIC_DOMAINS = _constants.TOPIC_DOMAINS;
import PREREQ_MET_RANK = _constants.PREREQ_MET_RANK;
import schemaReady = _constants.schemaReady;
import NON_CODE_ROLES = _helpers_extra.NON_CODE_ROLES;
import GENERIC_SIGNALS = _helpers_extra.GENERIC_SIGNALS;
import GENERIC_SIGNAL_MIN = _helpers_extra.GENERIC_SIGNAL_MIN;
import DEFINING_KINDS = _helpers_extra.DEFINING_KINDS;
import VOCAB_STOPWORDS = _helpers_extra.VOCAB_STOPWORDS;
import splitIdentifier = _helpers_extra.splitIdentifier;
import symbolName = _helpers_extra.symbolName;
import symbolKind = _helpers_extra.symbolKind;
import newAcc = _helpers_extra.newAcc;
import touch = _helpers_extra.touch;
import propagateLabels = _helpers_extra.propagateLabels;
import buildClusters = _helpers_extra.buildClusters;
import parseDeclared = _helpers_extra.parseDeclared;
import atlasCache = _helpers_extra.atlasCache;
import invalidateAtlasCache = _helpers_extra.invalidateAtlasCache;
import normalizeKeyword = _helpers_extra.normalizeKeyword;
import compileAtoms = _helpers_extra.compileAtoms;
import packageMatches = _helpers_extra.packageMatches;
import matchFile = _helpers_extra.matchFile;
import totalsFor = _helpers_extra.totalsFor;
import definedSymbolsFor = _helpers_extra.definedSymbolsFor;
import revisitStats = _helpers_extra.revisitStats;
import computeBaselineDepth = _helpers_extra.computeBaselineDepth;
import SCAFFOLD_SUBJECT = _helpers_extra.SCAFFOLD_SUBJECT;
import SCAFFOLD_FILE_COUNT = _helpers_extra.SCAFFOLD_FILE_COUNT;
import excerptAround = _helpers_extra.excerptAround;
import gatherTopicEvidence = _helpers_extra.gatherTopicEvidence;
import probeAtlas = _helpers_extra.probeAtlas;
import probeKeywords = _helpers_extra.probeKeywords;
import taxCaches = _helpers_extra.taxCaches;
import taxCache = _helpers_extra.taxCache;
import invalidateTaxonomyCache = _helpers_extra.invalidateTaxonomyCache;
import wouldCreateBuildsOnCycle = _helpers_extra.wouldCreateBuildsOnCycle;
import parseEvidenceBrief = _helpers_extra.parseEvidenceBrief;
import walkBuildsOn = _helpers_extra.walkBuildsOn;
import toLearningEdge = _helpers_extra.toLearningEdge;
import buildLearningNodes = _helpers_extra.buildLearningNodes;
import TOPIC_METRIC_PROPS = _helpers_extra.TOPIC_METRIC_PROPS;
import topicId = _helpers_extra.topicId;
import approachId = _helpers_extra.approachId;
import assessmentId = _helpers_extra.assessmentId;
import repairTopicEdges = _helpers_extra.repairTopicEdges;
import log = _helpers.log;
import raw = _helpers.raw;
import str = _helpers.str;
import num = _helpers.num;
import bool = _helpers.bool;
import strList = _helpers.strList;
import mapList = _helpers.mapList;
import unique = _helpers.unique;
import round = _helpers.round;
import clamp01 = _helpers.clamp01;
import parseJson = _helpers.parseJson;
import chunk = _helpers.chunk;
import slugify = _helpers.slugify;
import envInt = _helpers.envInt;
import DAY_MS = _helpers.DAY_MS;
import toParams = _helpers.toParams;
import rows = _helpers.rows;
import tryRows = _helpers.tryRows;
import runCounted = _helpers.runCounted;
import ignoreExists = _helpers.ignoreExists;
import levelForScore = _helpers.levelForScore;
import asDepthLevel = _helpers.asDepthLevel;
import AUTHENTICITY = _helpers.AUTHENTICITY;
import asAuthenticity = _helpers.asAuthenticity;
import asConfidence = _helpers.asConfidence;
import DOMAIN_SYNONYMS = _helpers.DOMAIN_SYNONYMS;
import asTopicDomain = _helpers.asTopicDomain;
import SUPPORTED_TOPIC_RELATIONS = _helpers.SUPPORTED_TOPIC_RELATIONS;
import MIN_MAPPING_WEIGHT = _helpers.MIN_MAPPING_WEIGHT;
import GENERIC_RELATION_TEMPLATE = _helpers.GENERIC_RELATION_TEMPLATE;
import setupSchema = _helpers.setupSchema;
import listTopicCatalog = _readers_extra2.listTopicCatalog;
import listCapabilityCatalog = _readers_extra2.listCapabilityCatalog;
import findTopicsByText = _readers_extra2.findTopicsByText;
import readTaxonomyEdges = _readers_extra2.readTaxonomyEdges;
import readTopicMeta = _readers_extra2.readTopicMeta;
import readDeveloperDepthMap = _readers_extra2.readDeveloperDepthMap;
import isPrereqMet = _readers_extra2.isPrereqMet;
import readTopicContext = _readers_extra2.readTopicContext;
import readTopicPath = _readers_extra2.readTopicPath;
import readTopicPathDetailed = _readers_extra2.readTopicPathDetailed;
import readTopicEvidenceTraversal = _readers_extra2.readTopicEvidenceTraversal;
import readTopicLearningGraph = _readers_extra2.readTopicLearningGraph;
import readLearningFrontier = _readers_extra2.readLearningFrontier;
import readTopicsForBackfill = _readers_extra2.readTopicsForBackfill;
import readOrphanReport = _readers_extra2.readOrphanReport;
import readDeveloperTopicProfile = _readers_extra2.readDeveloperTopicProfile;
import readTopicDepthDetail = _readers_extra2.readTopicDepthDetail;
import readStoredTopicSpec = _readers_extra2.readStoredTopicSpec;
import readDeveloperKnowledgeGraph = _readers_extra2.readDeveloperKnowledgeGraph;
import readDeveloperTopicEvidenceGraph = _readers_extra2.readDeveloperTopicEvidenceGraph;
import isSpecificRationale = _readers.isSpecificRationale;
import isoDay = _readers.isoDay;
import fetchFileRecords = _readers.fetchFileRecords;
import fetchDemonstrations = _readers.fetchDemonstrations;
import readEvidenceAtlas = _readers.readEvidenceAtlas;
import ensureDepthSchema = _writers.ensureDepthSchema;
import ensureTexts = _writers.ensureTexts;
import writeTopicMetric = _writers.writeTopicMetric;
import refreshTopicGraphMetrics = _writers.refreshTopicGraphMetrics;
import refreshTopicGraphMetricsImpl = _writers.refreshTopicGraphMetricsImpl;
import writeTopicMetadata = _writers.writeTopicMetadata;
import writeTopicCapabilityMappings = _writers.writeTopicCapabilityMappings;
import writeTopicRelations = _writers.writeTopicRelations;
import writeTopicRelationsImpl = _writers.writeTopicRelationsImpl;
import storeDepthAssessments = _writers.storeDepthAssessments;
import storeDepthProfileSummary = _writers.storeDepthProfileSummary;
import deleteWhere = _writers.deleteWhere;
import cleanupOrphans = _writers.cleanupOrphans;

export type Row = Record<string, any>;

export type ProgressFn = (stage: string, detail?: Row) => void;

export type Primitive = string | number | boolean | null;

export type DepthLevel = "none" | "surface" | "working" | "proficient" | "deep";

export type Authenticity =
  | "genuine_implementation"
  | "working_usage"
  | "incidental"
  | "boilerplate"
  | "insufficient_evidence";

export type Confidence = "high" | "medium" | "low";

export type TopicDomain = (typeof TOPIC_DOMAINS)[number];

export type TopicRelationType = (typeof SUPPORTED_TOPIC_RELATIONS)[number];

export type RelationStrength = "required" | "helpful";

export type RelationBasis = "llm_inferred" | "evidence_overlap" | "curated";

export interface FileRecord {
  id: string;
  path: string;
  repositoryId: string;
  commitSha: string;
  commitId: string;
  createdAt: string;
  ts: number;
  language: string;
  role: string;
  isTest: boolean;
  additions: number;
  deletions: number;
  packages: string[];
  packagesRemoved: string[];
  signals: Record<string, number>;
  /** "kind:name" for symbols DEFINED in the added lines */
  symbols: string[];
  symbolsModified: string[];
  depChanges: { added: string[]; removed: string[]; changed: string[] } | null;
  /** lazily computed lowercase search text (matching runs once per topic x file) */
  symbolText?: string;
  pathText?: string;
}

export interface DemoRow {
  id: string;
  capabilityId: string;
  technique: string;
  techniqueLower: string;
  summaryLower: string;
  depth: string;
  depthRank: number;
  modifiers: string;
  repository: string;
  path: string;
  permalink: string;
  commitSubject: string;
  snippet: string;
}

export interface FileIndex {
  files: FileRecord[];
  repoNames: Map<string, string>;
  /** packages declared in a repository's manifests (Repository.dependencies_json) */
  repoDeclared: Map<string, Set<string>>;
  commitFileCount: Map<string, number>;
  /** commit metadata cache shared by every topic of one atlas (no repeated queries) */
  commitMeta?: Map<string, Row>;
  /** all developer demonstrations, or null when the preload failed */
  demos?: DemoRow[] | null;
}

export interface PackageAtom {
  name: string;
  files: number;
  commits: number;
  repos: number;
  activeDays: number;
  firstSeen: string;
  lastSeen: string;
}

export interface SignalAtom {
  name: string;
  files: number;
  commits: number;
  occurrences: number;
}

export interface VocabAtom {
  term: string;
  files: number;
}

export interface AtomCluster {
  id: string;
  members: string[];
  commits: number;
  cohesion: number;
}

export interface AtlasCapability {
  id: string;
  name: string;
  description: string;
  level: string;
  evidence: number;
  commits: number;
  repos: number;
}

export interface AtlasExperience {
  id: string;
  capabilityId: string;
  technique: string;
  summary: string;
  depth: string;
  evidence: number;
  commits: number;
  repos: number;
  technologies: string[];
  repositories: string[];
}

export interface AtlasSkill {
  id: string;
  name: string;
  level: string;
  score: number;
}

export interface AtlasRepository {
  id: string;
  name: string;
  description: string;
  language: string;
  topics: string[];
}

export interface EvidenceAtlas {
  developerId: string;
  generatedAt: string;
  totals: {
    files: number;
    codeFiles: number;
    commits: number;
    repositories: number;
    activeDays: number;
    firstSeen: string;
    lastSeen: string;
  };
  packages: PackageAtom[];
  signals: SignalAtom[];
  vocabulary: VocabAtom[];
  clusters: AtomCluster[];
  capabilities: AtlasCapability[];
  experiences: AtlasExperience[];
  skills: AtlasSkill[];
  repositories: AtlasRepository[];
  /** in memory only, never serialised */
  index: FileIndex;
}

export interface ApproachSpec {
  slug: string;
  name: string;
  description: string;
  packages: string[];
  signals: string[];
  keywords: string[];
}

export interface CapabilityMappingSpec {
  id: string;
  /** 0..1: how strongly the capability belongs to the topic */
  weight: number;
  reason: string;
}

export interface RelationDetail {
  slug: string;
  reason: string;
  confidence: number;
  strength?: RelationStrength;
  basis?: RelationBasis;
}

export interface TopicSpec {
  slug: string;
  name: string;
  /** one of TOPIC_DOMAINS; classified by the agent from evidence */
  domain: string;
  description: string;
  aliases: string[];
  keywords: string[];
  packages: string[];
  signals: string[];
  /** capability ids already validated against the Capability catalog */
  capabilityIds: string[];
  /** weighted, explained version of capabilityIds (optional for old stored specs) */
  capabilityMappings?: CapabilityMappingSpec[];
  approaches: ApproachSpec[];
  /** canonical topic slugs once resolved by the agent */
  buildsOn: string[];
  related: string[];
  /** rationale-carrying versions of buildsOn / related (optional for old stored specs) */
  buildsOnDetail?: RelationDetail[];
  relatedDetail?: RelationDetail[];
  /** FileChange ids confirmed by a full-text probe (code content matches) */
  pinnedFileIds: string[];
}

export interface EvidenceTotals {
  files: number;
  commits: number;
  repos: number;
  activeDays: number;
  spanDays: number;
  additions: number;
  deletions: number;
  testFiles: number;
  firstSeen: string;
  lastSeen: string;
}

export interface EvidenceRef {
  key: string;
  kind: "code" | "demonstration" | "experience" | "commit";
  id: string;
  label: string;
  repository: string;
  path: string;
  permalink: string;
  snippet: string;
}

export interface BaselineDepth {
  score: number;
  level: DepthLevel;
  components: Record<string, number>;
  reasons: string[];
  caps: string[];
}

export interface ApproachEvidence {
  slug: string;
  name: string;
  files: number;
  commits: number;
  repos: number;
  activeDays: number;
  firstSeen: string;
  lastSeen: string;
  additions: number;
  testFiles: number;
  matchedPackages: string[];
  matchedSignals: Record<string, number>;
  definedSymbols: string[];
  revisitedFiles: number;
  baseline: BaselineDepth;
}

export interface CodeSample {
  ref: string;
  approach: string;
  repository: string;
  path: string;
  commitSubject: string;
  date: string;
  matched: string[];
  excerpt: string;
}

export interface DemoNote {
  ref: string;
  capabilityId: string;
  /** "capability": reached through a mapped capability; "keyword": text match only */
  matchedBy: "capability" | "keyword";
  technique: string;
  depth: string;
  modifiers: string[];
  repository: string;
  path: string;
  commitSubject: string;
  snippet: string;
}

export interface ExperienceNote {
  ref: string;
  capabilityId: string;
  technique: string;
  summary: string;
  depth: string;
  evidenceCount: number;
  commitCount: number;
  repoCount: number;
  technologies: string[];
  repositories: string[];
}

export interface CommitNote {
  ref: string;
  id: string;
  subject: string;
  type: string;
  day: string;
  filesCount: number;
  scaffold: boolean;
}

export interface EvidenceBrief {
  ref: string;
  kind: string;
  label: string;
  repository: string;
  path: string;
  permalink: string;
}

export interface DeveloperTopicDepth {
  slug: string;
  level: DepthLevel;
  score: number;
  confidence: Confidence;
  authenticity: Authenticity;
  verdict: string;
  files: number;
  commits: number;
  repos: number;
  safeguards: string[];
  evidence: EvidenceBrief[];
}

export interface TopicContext {
  foundationRank: number | null;
  bridgeScore: number | null;
  clusterId: number | null;
  foundations: Array<{
    slug: string;
    name: string;
    hops: number;
    developerLevel: string;
    developerScore: number;
    /** why the first hop of the path exists */
    reason?: string;
    confidence?: number;
    strength?: RelationStrength;
    basis?: string;
    /** slugs from the topic (excluded) to this foundation (included) */
    via?: string[];
    developerConfidence?: string;
    developerAuthenticity?: string;
    verdict?: string;
    files?: number;
    commits?: number;
    evidence?: EvidenceBrief[];
  }>;
}

export interface TopicFootprint {
  commitIds: string[];
  repoIds: string[];
  /** "<repositoryId>:<directory>" of every matched file */
  dirs: string[];
}

export interface TopicEvidence {
  spec: TopicSpec;
  matched: boolean;
  totals: EvidenceTotals;
  approaches: ApproachEvidence[];
  unattributedFiles: number;
  maturation: {
    revisitedFiles: number;
    revisitRatio: number;
    followUpCommits: number;
    commitTypes: Record<string, number>;
  };
  scaffold: { commits: number; share: number };
  declaredOnly: string[];
  dependencyEvents: Array<{
    package: string;
    event: "added" | "removed" | "changed";
    day: string;
    repository: string;
  }>;
  capabilityRollups: AtlasCapability[];
  demonstrations: DemoNote[];
  experiences: ExperienceNote[];
  samples: CodeSample[];
  commits: CommitNote[];
  timeline: Array<{ month: string; files: number }>;
  hardening: Array<{ label: string; count: number }>;
  baseline: BaselineDepth;
  refs: EvidenceRef[];
  context: TopicContext | null;
  footprint?: TopicFootprint;
}

export interface Acc {
  files: number;
  commits: Set<string>;
  repos: Set<string>;
  days: Set<string>;
  first: number;
  last: number;
  count: number;
}

export interface Compiled {
  packages: Set<string>;
  signals: Set<string>;
  keywords: string[];
  pinned: Set<string>;
}

export interface MatchInfo {
  strength: number;
  packages: string[];
  signals: string[];
  keywords: string[];
}

export interface BaselineInput {
  files: number;
  commits: number;
  repos: number;
  activeDays: number;
  spanDays: number;
  additions: number;
  testFiles: number;
  definedSymbols: number;
  demoBestRank: number; // 0 none, 1 usage, 2 implementation, 3 strong
  hardeningCount: number;
  revisitRatio: number;
  followUpCommits: number;
  approachesWithEvidence: number;
  scaffoldShare: number;
}

export interface GatherOptions {
  maxSamples?: number;
  maxDemos?: number;
}

export interface TopicCatalogEntry {
  slug: string;
  name: string;
  domain: string;
  aliases: string[];
  foundationRank: number | null;
  clusterId: number | null;
}

export interface CapabilityCatalogEntry {
  id: string;
  name: string;
  description: string;
}

export interface TaxonomyEdge {
  from: string;
  to: string;
  type: TopicRelationType;
  reason: string;
  confidence: number;
  strength: RelationStrength;
  basis: string;
  buildId: string;
  model: string;
  updatedAt: string;
}

export interface TopicMeta {
  slug: string;
  name: string;
  domain: string;
  description: string;
  foundationRank: number | null;
  bridgeScore: number | null;
  clusterId: number | null;
}

export interface TaxonomyCache {
  edges: Map<string, { at: number; rows: TaxonomyEdge[] }>;
  meta: { at: number; map: Map<string, TopicMeta> } | null;
}

export interface WalkNode {
  slug: string;
  hops: number;
  via: string[];
  edge: TaxonomyEdge;
  requiredPath: boolean;
}

export interface TopicPathHop {
  from: string;
  to: string;
  type: "BUILDS_ON" | "RELATED_TOPIC";
}

export interface TopicEvidencePath {
  capabilityId: string;
  capability: string;
  demonstrations: number;
  /** how strongly the capability belongs to the topic (0..1), when recorded */
  weight: number | null;
  /** why the capability was mapped to the topic */
  reason: string;
}

export interface LearningEdge {
  reason: string;
  confidence: number;
  strength: RelationStrength;
  basis: string;
  buildId: string;
  model: string;
  updatedAt: string;
}

export interface LearningNode {
  slug: string;
  name: string;
  domain: string;
  hops: number;
  /** slugs from the topic (excluded) to this node (included) */
  via: string[];
  /** the edge that connects this node to the previous one on `via` */
  edge: LearningEdge;
  /** every edge on the path is "required" */
  requiredPath: boolean;
  foundationRank: number | null;
  developer: DeveloperTopicDepth | null;
  /** the developer shows at least working depth here */
  met: boolean;
  /** required, on a required path, and not met */
  blocking: boolean;
}

export interface RelatedLearningNode {
  slug: string;
  name: string;
  domain: string;
  clusterId: number | null;
  edge: LearningEdge;
  developer: DeveloperTopicDepth | null;
}

export interface TopicLearningGraph {
  topic: {
    slug: string;
    name: string;
    domain: string;
    description: string;
    foundationRank: number | null;
    bridgeScore: number | null;
    clusterId: number | null;
  };
  developer: DeveloperTopicDepth | null;
  /** BUILDS_ON*1..maxHops: what must be understood first */
  prerequisites: LearningNode[];
  /** reverse BUILDS_ON: what this topic opens up */
  unlocks: LearningNode[];
  related: RelatedLearningNode[];
  /** taxonomy capabilities with weights, reasons and this developer's demonstration counts */
  capabilityPaths: TopicEvidencePath[];
  readiness: {
    /** no direct required prerequisite is unmet */
    ready: boolean;
    unmetRequired: string[];
    /** unmet required foundations, deepest first: the order to learn them in */
    learningOrder: string[];
    metPrerequisites: string[];
  };
}

export interface LearningFrontierEntry {
  topic: {
    slug: string;
    name: string;
    domain: string;
    foundationRank: number | null;
    bridgeScore: number | null;
    clusterId: number | null;
  };
  developer: DeveloperTopicDepth | null;
  /** every direct required prerequisite is met (or there are none) */
  ready: boolean;
  /** direct prerequisites with edge rationale and the developer's depth in each */
  prerequisites: Array<{
    slug: string;
    name: string;
    strength: RelationStrength;
    reason: string;
    confidence: number;
    met: boolean;
    developer: DeveloperTopicDepth | null;
  }>;
  blockedBy: string[];
  /** number of topics that directly build on this one */
  unlocks: number;
  why: string;
}

export interface TopicGraphMetrics {
  topics: number;
  relations: number;
  pageRank: number;
  betweenness: number;
  communities: number;
  components: number;
  /** human-readable reasons a metric is absent (kept for older callers) */
  fallbacks: string[];
  /** ok: every expected algorithm ran and wrote every row; partial/failed/empty_graph otherwise */
  status: "ok" | "partial" | "failed" | "empty_graph";
  algorithmsRun: string[];
  failures: string[];
}

export interface ApproachRecord {
  slug: string;
  name: string;
  description: string;
  files: number;
  commits: number;
  repos: number;
  firstSeen: string;
  lastSeen: string;
  depth: DepthLevel;
  authenticity: Authenticity;
  isPrimary: boolean;
  howImplemented: string;
  hardening: string[];
  gaps: string[];
  evidenceRefs: string[];
}

export interface ImplementationNote {
  ref: string;
  what: string;
  repository: string;
  path: string;
  permalink: string;
}

export interface DepthAssessmentRecord {
  slug: any;
  name: any;
  topic: {
    slug: string;
    name: string;
    domain: string;
    description: string;
    aliases: string[];
  };
  level: DepthLevel;
  score: number;
  baselineScore: number;
  baselineLevel: DepthLevel;
  confidence: Confidence;
  authenticity: Authenticity;
  verdict: string;
  rationale: string;
  strengths: string[];
  gaps: string[];
  /** hardening behaviours (limits, error paths, cleanup, validation...) actually observed */
  safeguards: string[];
  /** what was built, each tied to a cited code or detector reference */
  implementations: ImplementationNote[];
  approaches: ApproachRecord[];
  /** only the evidence that was actually cited */
  evidence: EvidenceRef[];
  stats: EvidenceTotals;
  spec: TopicSpec;
  /** true when the LLM was unavailable and the baseline decided */
  fallback: boolean;
}

export interface TopicRelationInput {
  from: string;
  to: string;
  type: TopicRelationType;
  /** specific rationale: why the edge exists. Generic templates are rejected. */
  reason: string;
  /** 0..1 (default 0.6) */
  confidence?: number;
  /** BUILDS_ON only (default "helpful") */
  strength?: RelationStrength;
  /** default "llm_inferred" */
  basis?: RelationBasis;
}

export interface TopicRelationRejection {
  from: string;
  to: string;
  type: string;
  reason: string;
}

export interface StoreDepthInput {
  developerId: string;
  buildId: string;
  model: string;
  assessments: DepthAssessmentRecord[];
  relations: TopicRelationInput[];
  /** true: remove this developer's assessments that are not in this build */
  replaceAll: boolean;
  /**
   * true: Topic -[:MAPS_TO]-> Capability edges of the written topics that this
   * build did not re-assert are removed (the topic was deliberately remapped).
   * Only edges created by this pipeline (basis "agent_validated") are touched.
   */
  pruneStaleMappings?: boolean;
}

export interface StoreDepthResult {
  topics: number;
  assessments: number;
  approaches: number;
  evidenceEdges: number;
  mappings: number;
  unresolvedMappings: Array<{
    topic: string;
    capabilityId: string;
    reason: string;
  }>;
  relationsRequested: number;
  relations: number;
  rejectedRelations: TopicRelationRejection[];
  /** nodes deleted because they lost their anchor during this write */
  orphansRemoved: { assessments: number; approaches: number; topics: number };
}

export interface TopicMetadataInput {
  slug: string;
  name: string;
  domain: string;
  description: string;
  aliases: string[];
}

export interface TopicCapabilityMapping {
  topicSlug: string;
  capabilityId: string;
  /** 0..1 (default 0.5). Mappings under MIN_MAPPING_WEIGHT are not persisted. */
  weight?: number;
  /** why this capability belongs to this topic */
  reason?: string;
}

export interface BackfillTopicRow {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  description: string;
  aliases: string[];
  /** every stored TopicSpec (any developer) that produced an assessment of this topic */
  specs: TopicSpec[];
  /** id does not follow the canonical `topic:<slug>` form */
  nonCanonicalId: boolean;
}

export interface DepthProfileSummary {
  headline: string;
  pattern: string;
  strongest: Array<{
    slug: string;
    name: string;
    level: DepthLevel;
    score: number;
  }>;
  broadButShallow: Array<{ slug: string; name: string }>;
  deepening: Array<{ slug: string; name: string; why: string }>;
  generatedBy: "llm" | "deterministic";
}

export interface OrphanReport {
  /** Topics no assessment points at */
  topicsWithoutAssessment: string[];
  /** Topics with no BUILDS_ON / RELATED_TOPIC edge in either direction */
  topicsWithoutRelations: string[];
  /** Topics with no MAPS_TO -> Capability edge */
  topicsWithoutCapability: string[];
  assessmentsWithoutTopic: number;
  approachesWithoutTopic: number;
}

export interface TopicDepthSummary {
  slug: string;
  name: string;
  domain: string;
  level: DepthLevel;
  score: number;
  baselineScore: number;
  confidence: Confidence;
  authenticity: Authenticity;
  verdict: string;
  files: number;
  commits: number;
  repos: number;
  activeDays: number;
  firstSeen: string;
  lastSeen: string;
  foundationRank: number | null;
  clusterId: number | null;
  fallback: boolean;
  approaches: Array<{
    slug: string;
    name: string;
    depth: DepthLevel;
    authenticity: Authenticity;
    isPrimary: boolean;
    files: number;
    commits: number;
    howImplemented: string;
  }>;
}

export interface DeveloperTopicProfile {
  developerId: string;
  topics: TopicDepthSummary[];
  domains: Array<{
    domain: string;
    topics: number;
    bestLevel: DepthLevel;
    averageScore: number;
  }>;
  clusters: Array<{ clusterId: number; topics: string[] }>;
  summary: DepthProfileSummary | null;
}

export interface TopicDepthDetail {
  summary: TopicDepthSummary;
  rationale: string;
  strengths: string[];
  gaps: string[];
  safeguards: string[];
  implementations: ImplementationNote[];
  approaches: ApproachRecord[];
  evidence: EvidenceRef[];
  stats: EvidenceTotals | null;
  baselineLevel: DepthLevel;
  context: TopicContext | null;
  /** topics that build on this one, each with the reason the edge exists */
  unlocks: Array<{
    slug: string;
    name: string;
    reason: string;
    confidence: number;
    strength: RelationStrength;
  }>;
  related: Array<{
    slug: string;
    name: string;
    reason: string;
    confidence: number;
  }>;
  /** taxonomy capabilities of the topic with weights, reasons and THIS developer's demonstration counts */
  capabilityPaths: TopicEvidencePath[];
  /** full prerequisite / unlock traversal with developer depth and evidence */
  learning: TopicLearningGraph | null;
}

export interface DeveloperKnowledgeNode {
  id: string;
  label: string;
  name: string;
  properties: Row;
}

export interface DeveloperKnowledgeEdge {
  from: string;
  to: string;
  type: string;
  properties: Row;
}

export interface DeveloperKnowledgeGraph {
  developerId: string;
  nodes: DeveloperKnowledgeNode[];
  edges: DeveloperKnowledgeEdge[];
  counts: { nodes: number; edges: number; evidenceNodes: number };
}
}
