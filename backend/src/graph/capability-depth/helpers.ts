import type { Graph } from "../../db/falkordb.js";




import { Domain as _constants } from './constants.js';
import { Domain as _helpers_extra } from './helpers-extra.js';
import { Domain as _queries } from './queries.js';
import { Domain as _readers_extra2 } from './readers-extra2.js';
import { Domain as _readers } from './readers.js';
import { Domain as _types } from './types.js';
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
import Row = _types.Row;
import ProgressFn = _types.ProgressFn;
import Primitive = _types.Primitive;
import DepthLevel = _types.DepthLevel;
import Authenticity = _types.Authenticity;
import Confidence = _types.Confidence;
import TopicDomain = _types.TopicDomain;
import TopicRelationType = _types.TopicRelationType;
import RelationStrength = _types.RelationStrength;
import RelationBasis = _types.RelationBasis;
import FileRecord = _types.FileRecord;
import DemoRow = _types.DemoRow;
import FileIndex = _types.FileIndex;
import PackageAtom = _types.PackageAtom;
import SignalAtom = _types.SignalAtom;
import VocabAtom = _types.VocabAtom;
import AtomCluster = _types.AtomCluster;
import AtlasCapability = _types.AtlasCapability;
import AtlasExperience = _types.AtlasExperience;
import AtlasSkill = _types.AtlasSkill;
import AtlasRepository = _types.AtlasRepository;
import EvidenceAtlas = _types.EvidenceAtlas;
import ApproachSpec = _types.ApproachSpec;
import CapabilityMappingSpec = _types.CapabilityMappingSpec;
import RelationDetail = _types.RelationDetail;
import TopicSpec = _types.TopicSpec;
import EvidenceTotals = _types.EvidenceTotals;
import EvidenceRef = _types.EvidenceRef;
import BaselineDepth = _types.BaselineDepth;
import ApproachEvidence = _types.ApproachEvidence;
import CodeSample = _types.CodeSample;
import DemoNote = _types.DemoNote;
import ExperienceNote = _types.ExperienceNote;
import CommitNote = _types.CommitNote;
import EvidenceBrief = _types.EvidenceBrief;
import DeveloperTopicDepth = _types.DeveloperTopicDepth;
import TopicContext = _types.TopicContext;
import TopicFootprint = _types.TopicFootprint;
import TopicEvidence = _types.TopicEvidence;
import Acc = _types.Acc;
import Compiled = _types.Compiled;
import MatchInfo = _types.MatchInfo;
import BaselineInput = _types.BaselineInput;
import GatherOptions = _types.GatherOptions;
import TopicCatalogEntry = _types.TopicCatalogEntry;
import CapabilityCatalogEntry = _types.CapabilityCatalogEntry;
import TaxonomyEdge = _types.TaxonomyEdge;
import TopicMeta = _types.TopicMeta;
import TaxonomyCache = _types.TaxonomyCache;
import WalkNode = _types.WalkNode;
import TopicPathHop = _types.TopicPathHop;
import TopicEvidencePath = _types.TopicEvidencePath;
import LearningEdge = _types.LearningEdge;
import LearningNode = _types.LearningNode;
import RelatedLearningNode = _types.RelatedLearningNode;
import TopicLearningGraph = _types.TopicLearningGraph;
import LearningFrontierEntry = _types.LearningFrontierEntry;
import TopicGraphMetrics = _types.TopicGraphMetrics;
import ApproachRecord = _types.ApproachRecord;
import ImplementationNote = _types.ImplementationNote;
import DepthAssessmentRecord = _types.DepthAssessmentRecord;
import TopicRelationInput = _types.TopicRelationInput;
import TopicRelationRejection = _types.TopicRelationRejection;
import StoreDepthInput = _types.StoreDepthInput;
import StoreDepthResult = _types.StoreDepthResult;
import TopicMetadataInput = _types.TopicMetadataInput;
import TopicCapabilityMapping = _types.TopicCapabilityMapping;
import BackfillTopicRow = _types.BackfillTopicRow;
import DepthProfileSummary = _types.DepthProfileSummary;
import OrphanReport = _types.OrphanReport;
import TopicDepthSummary = _types.TopicDepthSummary;
import DeveloperTopicProfile = _types.DeveloperTopicProfile;
import TopicDepthDetail = _types.TopicDepthDetail;
import DeveloperKnowledgeNode = _types.DeveloperKnowledgeNode;
import DeveloperKnowledgeEdge = _types.DeveloperKnowledgeEdge;
import DeveloperKnowledgeGraph = _types.DeveloperKnowledgeGraph;
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

export function log(message: string, detail?: Row): void {
  if (detail !== undefined) console.log(`${LOG_PREFIX} ${message}`, detail);
  else console.log(`${LOG_PREFIX} ${message}`);
}

export const raw = (v: unknown): string =>
  v == null || typeof v === "object" ? "" : String(v);

export const str = (v: unknown, fallback = ""): string =>
  v == null || typeof v === "object" ? fallback : String(v).trim();

export const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const bool = (v: unknown): boolean => v === true || v === "true" || v === 1;

export const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : [];

export const mapList = (v: unknown): Row[] =>
  Array.isArray(v)
    ? v.filter((x) => x && typeof x === "object" && !Array.isArray(x))
    : [];

export const unique = <T>(items: T[]): T[] => [...new Set(items)];

export const round = (v: number, digits = 2): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export function parseJson<T>(value: unknown, fallback: T): T {
  try {
    const s = raw(value);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

export function envInt(name: string, fallback: number, min = 1, max = 1_000_000) {
  const parsed = Number(process.env[name]);
  const value =
    Number.isFinite(parsed) && process.env[name] ? parsed : fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export const DAY_MS = 86_400_000;

export function toParams(items: Row[]): Array<Record<string, Primitive>> {
  return items.map((item) => {
    const out: Record<string, Primitive> = {};
    for (const [key, value] of Object.entries(item)) {
      if (value === undefined || value === null) out[key] = null;
      else if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        out[key] = value;
      } else {
        throw new TypeError(
          `Unsupported FalkorDB query parameter for "${key}": ${typeof value}`,
        );
      }
    }
    return out;
  });
}

export async function rows(
  graph: Graph,
  query: string,
  params: Row = {},
): Promise<Row[]> {
  const result = await graph.query(query, { params });
  return (result.data ?? []) as Row[];
}

export async function tryRows(
  graph: Graph,
  label: string,
  query: string,
  params: Row = {},
): Promise<Row[] | null> {
  try {
    return await rows(graph, query, params);
  } catch (error) {
    log(`${label} failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function runCounted(
  graph: Graph,
  label: string,
  query: string,
  items: Row[],
  options: { params?: Row; strict?: boolean } = {},
): Promise<number> {
  let written = 0;
  for (const batch of chunk(items, DB_BATCH_SIZE)) {
    const result = await graph.query(query, {
      params: { ...(options.params ?? {}), batch: toParams(batch) },
    });
    written += num(((result.data ?? []) as Row[])[0]?.n);
  }
  if (written < items.length) {
    log(
      `${label}: ${items.length - written} of ${items.length} rows matched nothing`,
    );
    if (options.strict) {
      throw new Error(
        `${label} was incomplete (${written}/${items.length}); refusing to continue to stale-data cleanup`,
      );
    }
  }
  return written;
}

export async function ignoreExists(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already\s+(exists|indexed)/i.test(message)) {
      log(`${label} failed`, { message });
    }
  }
}

export function levelForScore(score: number): DepthLevel {
  if (score <= 0) return "none";
  if (score < 20) return "surface";
  if (score < 40) return "working";
  if (score < 65) return "proficient";
  return "deep";
}

export const asDepthLevel = (v: unknown, fallback: DepthLevel = "none") =>
  (DEPTH_LEVELS as string[]).includes(str(v))
    ? (str(v) as DepthLevel)
    : fallback;

export const AUTHENTICITY: Authenticity[] = [
  "genuine_implementation",
  "working_usage",
  "incidental",
  "boilerplate",
  "insufficient_evidence",
];

export const asAuthenticity = (
  v: unknown,
  fallback: Authenticity = "insufficient_evidence",
): Authenticity =>
  (AUTHENTICITY as string[]).includes(str(v))
    ? (str(v) as Authenticity)
    : fallback;

export const asConfidence = (v: unknown, fallback: Confidence = "low") =>
  ["high", "medium", "low"].includes(str(v))
    ? (str(v) as Confidence)
    : fallback;

export const DOMAIN_SYNONYMS: Record<string, TopicDomain> = {
  frontend: "frontend",
  front_end: "frontend",
  backend: "backend",
  back_end: "backend",
  database: "database",
  databases: "database",
  db: "database",
  infrastructure: "infrastructure",
  infra: "infrastructure",
  devops: "infrastructure",
  ai_ml: "ai_ml",
  aiml: "ai_ml",
  ai: "ai_ml",
  ml: "ai_ml",
  machine_learning: "ai_ml",
  mobile: "mobile",
  general: "general",
};

export function asTopicDomain(v: unknown): TopicDomain | null {
  const key = slugify(str(v));
  return key ? (DOMAIN_SYNONYMS[key] ?? null) : null;
}

export const SUPPORTED_TOPIC_RELATIONS = [
  "BUILDS_ON",
  "RELATED_TOPIC",
] as const;

export const MIN_MAPPING_WEIGHT = 0.3;

export const GENERIC_RELATION_TEMPLATE =
  /\b(builds on|relates to|is related to|related to|depends on)\b/i;

export async function setupSchema(graph: Graph): Promise<void> {
  // Every `WHERE x.id IN $ids` / `MATCH (x:Label {id: ...})` below is a full
  // label scan without an index, so each looked-up label gets one.
  const indexes: Array<[string, string]> = [
    ["Topic", "id"],
    ["Topic", "slug"],
    ["Approach", "id"],
    ["DepthAssessment", "id"],
    ["DepthAssessment", "developer_id"],
    ["DepthAssessment", "topic_slug"],
    ["Developer", "id"],
    ["Capability", "id"],
    ["Commit", "id"],
    ["FileChange", "id"],
    ["Repository", "id"],
    ["Demonstration", "id"],
    ["Experience", "id"],
  ];
  for (const [label, property] of indexes) {
    await ignoreExists(`index ${label}.${property}`, () =>
      graph.query(`CREATE INDEX FOR (n:${label}) ON (n.${property})`),
    );
  }
  await ignoreExists("fulltext Topic", () =>
    graph.query(
      `CALL db.idx.fulltext.createNodeIndex('Topic', 'name', 'description', 'aliases_text')`,
    ),
  );
}
}
