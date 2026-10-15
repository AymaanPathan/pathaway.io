import type { Graph } from "../../db/falkordb.js";




import { Domain as _constants } from './constants.js';
import { Domain as _helpers_extra } from './helpers-extra.js';
import { Domain as _helpers } from './helpers.js';
import { Domain as _queries } from './queries.js';
import { Domain as _readers_extra2 } from './readers-extra2.js';
import { Domain as _readers } from './readers.js';
import { Domain as _types } from './types.js';

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

export function ensureDepthSchema(
  graph: Graph,
  options: { force?: boolean } = {},
): Promise<void> {
  if (_constants.schemaReady && !options.force) return _constants.schemaReady;

  const pending: Promise<void> = setupSchema(graph).catch((error) => {
    if (_constants.schemaReady === pending) _constants.schemaReady = null;
    throw error;
  });
  _constants.schemaReady = pending;
  return pending;
}

export function ensureTexts(f: FileRecord): void {
  if (f.symbolText !== undefined) return;
  f.symbolText = [...f.symbols, ...f.symbolsModified]
    .map((s) =>
      symbolName(s)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ""),
    )
    .join(" ");
  f.pathText = f.path.toLowerCase().replace(/[^a-z0-9/]+/g, "");
}

export async function writeTopicMetric(
  graph: Graph,
  prop: string,
  items: Array<{ id: string; value: number }>,
  metadata: { computedAt: string; buildId: string },
): Promise<number> {
  if (!TOPIC_METRIC_PROPS.has(prop))
    throw new Error(`unsafe topic property ${prop}`);
  return runCounted(
    graph,
    `Topic.${prop}`,
    `
    UNWIND $batch AS item
    MATCH (t:Topic {id: item.id})
    SET t.${prop} = item.value,
        t.computed_at = $computed_at,
        t.build_id = $build_id
    RETURN count(t) AS n
    `,
    items,
    {
      params: { computed_at: metadata.computedAt, build_id: metadata.buildId },
    },
  );
}

export async function refreshTopicGraphMetrics(
  graph: Graph,
  options: { buildId?: string; now?: string } = {},
): Promise<TopicGraphMetrics> {
  try {
    return await refreshTopicGraphMetricsImpl(graph, options);
  } finally {
    invalidateTaxonomyCache(graph);
  }
}

export async function refreshTopicGraphMetricsImpl(
  graph: Graph,
  options: { buildId?: string; now?: string },
): Promise<TopicGraphMetrics> {
  await ensureDepthSchema(graph);
  const computedAt = options.now ?? new Date().toISOString();
  const metricBuildId =
    options.buildId?.trim() || `topic-metrics:${computedAt}`;
  const metricMetadata = { computedAt, buildId: metricBuildId };
  const metrics: TopicGraphMetrics = {
    topics: 0,
    relations: 0,
    pageRank: 0,
    betweenness: 0,
    communities: 0,
    components: 0,
    fallbacks: [],
    status: "failed",
    algorithmsRun: [],
    failures: [],
  };
  const fail = (message: string) => {
    metrics.failures.push(message);
    metrics.fallbacks.push(message);
  };

  // Count each relationship type independently. FalkorDB graph algorithms
  // can reject a configuration containing a relationship type absent from
  // the current graph (for example BUILDS_ON when only RELATED_TOPIC exists).
  const counts = await tryRows(
    graph,
    "topic relationship counts",
    `
    MATCH (t:Topic)
    WITH count(t) AS topics
    OPTIONAL MATCH (:Topic)-[b:BUILDS_ON]->(:Topic)
    WITH topics, count(b) AS buildsOnEdges
    OPTIONAL MATCH (:Topic)-[r:RELATED_TOPIC]->(:Topic)
    RETURN topics, buildsOnEdges, count(r) AS relatedEdges
    `,
  );

  if (!counts) {
    fail("topic relationship counts unavailable");
    log("topic graph metrics unavailable", metrics as unknown as Row);
    return metrics;
  }

  const countRow = counts[0] ?? {};
  metrics.topics = num(countRow.topics);
  let buildsOnEdges = num(countRow.buildsOnEdges);
  let relatedEdges = num(countRow.relatedEdges);

  // Validate relationship types against what the database actually knows.
  const typeRows = await tryRows(
    graph,
    "relationship types",
    `CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType`,
  );
  if (typeRows) {
    const dbTypes = new Set(typeRows.map((r) => str(r.relationshipType)));
    if (!dbTypes.has("BUILDS_ON") && buildsOnEdges > 0) {
      fail("BUILDS_ON edges counted but the type is unknown to the database");
      buildsOnEdges = 0;
    }
    if (!dbTypes.has("RELATED_TOPIC") && relatedEdges > 0) {
      fail(
        "RELATED_TOPIC edges counted but the type is unknown to the database",
      );
      relatedEdges = 0;
    }
  }
  metrics.relations = buildsOnEdges + relatedEdges;

  if (metrics.topics < 2 || metrics.relations === 0) {
    metrics.status = "empty_graph";
    fail(
      `graph ranking unavailable: ${metrics.topics} topics and ${metrics.relations} usable taxonomy edges; nothing was ranked`,
    );
    // nothing to rank: previous ranks no longer describe this taxonomy
    await tryRows(
      graph,
      "clear topic metrics",
      `MATCH (t:Topic)
       REMOVE t.foundation_rank, t.bridge_score, t.cluster_id, t.component_id,
              t.computed_at, t.build_id
       RETURN count(t) AS n`,
    );
    log("graph ranking unavailable: topic taxonomy has no connected edges", {
      ...metrics,
      buildsOnEdges,
      relatedEdges,
    });
    return metrics;
  }

  const runMetric = async (
    label: string,
    query: string,
    prop: string,
    valueKey: string,
  ): Promise<number> => {
    const result = await tryRows(graph, label, query);
    if (!result || result.length === 0) {
      fail(`${prop}: ${label} returned no results; no proxy ranking used`);
      return 0;
    }
    try {
      const items = result.map((r) => ({
        id: str(r.id),
        value: round(num(r[valueKey]), 6),
      }));
      const written = await writeTopicMetric(
        graph,
        prop,
        items,
        metricMetadata,
      );
      if (written < items.length) {
        fail(
          `${prop}: only ${written}/${items.length} ${label} results matched persisted Topic nodes`,
        );
      }
      if (written > 0) {
        metrics.algorithmsRun.push(label);
        // drop this metric from topics the fresh run did not return
        await tryRows(
          graph,
          `clear stale ${prop}`,
          `MATCH (t:Topic)
           WHERE NOT t.id IN $ids AND t.${prop} IS NOT NULL
           REMOVE t.${prop}
           RETURN count(t) AS n`,
          { ids: items.map((i) => i.id) },
        );
      }
      return written;
    } catch (error) {
      fail(
        `${prop}: writing ${label} results failed (${error instanceof Error ? error.message : String(error)})`,
      );
      return 0;
    }
  };

  // Prefer dependency edges for foundation PageRank; when there are none yet,
  // rank the existing RELATED_TOPIC graph instead. Both are FalkorDB PageRank.
  const pageRankType = buildsOnEdges > 0 ? "BUILDS_ON" : "RELATED_TOPIC";
  metrics.pageRank = await runMetric(
    `algo.pageRank (${pageRankType})`,
    `CALL algo.pageRank('Topic', '${pageRankType}')
     YIELD node, score
     RETURN node.id AS id, score`,
    "foundation_rank",
    "score",
  );

  // Pass only relationship types that exist and have edges.
  const traversalTypes: string[] = [];
  if (buildsOnEdges > 0) traversalTypes.push("BUILDS_ON");
  if (relatedEdges > 0) traversalTypes.push("RELATED_TOPIC");
  const traversalTypesCypher = JSON.stringify(traversalTypes);

  metrics.betweenness = await runMetric(
    "algo.betweenness",
    `
    CALL algo.betweenness({
      nodeLabels: ['Topic'],
      relationshipTypes: ${traversalTypesCypher}
    })
    YIELD node, score
    RETURN node.id AS id, score
    `,
    "bridge_score",
    "score",
  );

  // Communities are meaningful only on the RELATED_TOPIC subgraph.
  if (relatedEdges > 0) {
    metrics.communities = await runMetric(
      "algo.labelPropagation",
      `
      CALL algo.labelPropagation({
        nodeLabels: ['Topic'],
        relationshipTypes: ['RELATED_TOPIC'],
        maxIterations: 10
      })
      YIELD node, communityId
      RETURN node.id AS id, communityId
      `,
      "cluster_id",
      "communityId",
    );
  } else {
    await tryRows(
      graph,
      "clear cluster_id",
      `MATCH (t:Topic) WHERE t.cluster_id IS NOT NULL REMOVE t.cluster_id RETURN count(t) AS n`,
    );
  }

  metrics.components = await runMetric(
    "algo.WCC",
    `
    CALL algo.WCC({
      nodeLabels: ['Topic'],
      relationshipTypes: ${traversalTypesCypher}
    })
    YIELD node, componentId
    RETURN node.id AS id, componentId
    `,
    "component_id",
    "componentId",
  );

  const expected = 3 + (relatedEdges > 0 ? 1 : 0);
  metrics.status =
    metrics.failures.length === 0 && metrics.algorithmsRun.length === expected
      ? "ok"
      : metrics.algorithmsRun.length > 0
        ? "partial"
        : "failed";

  log("topic graph metrics refreshed", {
    ...metrics,
    buildsOnEdges,
    relatedEdges,
    pageRankRelationship: pageRankType,
    traversalRelationshipTypes: traversalTypes,
  } as unknown as Row);
  return metrics;
}

export async function writeTopicMetadata(
  graph: Graph,
  topics: TopicMetadataInput[],
  options: { now: string; createMissing?: boolean },
): Promise<number> {
  const items = topics
    .filter((t) => t.slug && t.name)
    .map((t) => ({
      id: topicId(t.slug),
      slug: t.slug,
      name: t.name,
      domain: asTopicDomain(t.domain) ?? "general",
      description: t.description ?? "",
      aliases_text: t.aliases.join(" | "),
    }));

  const setClause = `
    SET t.slug = item.slug,
        t.name = CASE WHEN item.name <> "" THEN item.name ELSE t.name END,
        t.domain = CASE WHEN item.domain = "general" AND coalesce(t.domain, "general") <> "general"
                        THEN t.domain ELSE item.domain END,
        t.description = CASE WHEN item.description <> "" THEN item.description
                             ELSE coalesce(t.description, "") END,
        t.aliases_text = CASE WHEN item.aliases_text <> "" THEN item.aliases_text
                              ELSE coalesce(t.aliases_text, "") END,
        t.updated_at = $now
    RETURN count(t) AS n`;

  const query =
    options.createMissing === false
      ? `UNWIND $batch AS item
         MATCH (t:Topic {id: item.id})
         ${setClause}`
      : `UNWIND $batch AS item
         MERGE (t:Topic {id: item.id})
         ON CREATE SET t.created_at = $now
         ${setClause}`;

  try {
    return await runCounted(graph, "Topic metadata", query, items, {
      params: { now: options.now },
      strict: options.createMissing !== false,
    });
  } finally {
    invalidateTaxonomyCache(graph);
  }
}

export async function writeTopicCapabilityMappings(
  graph: Graph,
  mappings: TopicCapabilityMapping[],
  options: { buildId: string; now: string; pruneStaleForTopics?: string[] },
): Promise<{
  written: number;
  unresolved: StoreDepthResult["unresolvedMappings"];
}> {
  const seen = new Set<string>();
  const wanted = mappings.filter((m) => {
    if (!m.topicSlug || !m.capabilityId) return false;
    const key = `${m.topicSlug}>${m.capabilityId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const existing = new Set<string>();
  for (const part of chunk(unique(wanted.map((m) => m.capabilityId)), 300)) {
    const found = await rows(
      graph,
      `MATCH (c:Capability) WHERE c.id IN $ids AND coalesce(c.parent_id, "") <> "" RETURN c.id AS id`,
      { ids: part },
    );
    for (const r of found) existing.add(str(r.id));
  }

  const unresolved: StoreDepthResult["unresolvedMappings"] = [];
  const valid = wanted.filter((m) => {
    if (!existing.has(m.capabilityId)) {
      unresolved.push({
        topic: m.topicSlug,
        capabilityId: m.capabilityId,
        reason: "capability does not exist in the graph or is not a leaf",
      });
      return false;
    }
    const weight = clamp01(m.weight ?? 0.5);
    if (weight < MIN_MAPPING_WEIGHT) {
      unresolved.push({
        topic: m.topicSlug,
        capabilityId: m.capabilityId,
        reason: `mapping weight ${round(weight)} is below ${MIN_MAPPING_WEIGHT}`,
      });
      return false;
    }
    return true;
  });

  const written = await runCounted(
    graph,
    "MAPS_TO edges",
    `
    UNWIND $batch AS item
    MATCH (t:Topic {id: item.topic_id})
    MATCH (c:Capability {id: item.capability_id})
    MERGE (t)-[r:MAPS_TO]->(c)
    ON CREATE SET r.created_at = $now
    SET r.basis = "agent_validated",
        r.reason = CASE WHEN item.reason <> "" THEN item.reason ELSE coalesce(r.reason, "") END,
        r.weight = CASE WHEN item.weight >= coalesce(r.weight, 0) THEN item.weight ELSE r.weight END,
        r.build_id = $build_id,
        r.updated_at = $now
    RETURN count(r) AS n
    `,
    valid.map((m) => ({
      topic_id: topicId(m.topicSlug),
      capability_id: m.capabilityId,
      weight: round(clamp01(m.weight ?? 0.5), 2),
      reason: (m.reason ?? "").slice(0, 300),
    })),
    { params: { build_id: options.buildId, now: options.now } },
  );

  const pruneTopics = options.pruneStaleForTopics ?? [];
  if (pruneTopics.length) {
    if (written === valid.length) {
      await graph.query(
        `
        MATCH (t:Topic)-[r:MAPS_TO]->(:Capability)
        WHERE t.id IN $ids
          AND coalesce(r.basis, "") = "agent_validated"
          AND coalesce(r.build_id, "") <> $build_id
        DELETE r
        `,
        {
          params: {
            ids: pruneTopics.map(topicId),
            build_id: options.buildId,
          },
        },
      );
    } else {
      log("MAPS_TO stale cleanup skipped: some mappings were not written", {
        expected: valid.length,
        written,
      });
    }
  }
  return { written, unresolved };
}

export async function writeTopicRelations(
  graph: Graph,
  relations: TopicRelationInput[],
  options: {
    now: string;
    buildId?: string;
    model?: string;
    requireRationale?: boolean;
  },
): Promise<{ persisted: number; rejected: TopicRelationRejection[] }> {
  try {
    return await writeTopicRelationsImpl(graph, relations, options);
  } finally {
    invalidateTaxonomyCache(graph);
  }
}

export async function writeTopicRelationsImpl(
  graph: Graph,
  relations: TopicRelationInput[],
  options: {
    now: string;
    buildId?: string;
    model?: string;
    requireRationale?: boolean;
  },
): Promise<{ persisted: number; rejected: TopicRelationRejection[] }> {
  const rejected: TopicRelationRejection[] = [];
  const supported = new Set<string>(SUPPORTED_TOPIC_RELATIONS);
  const requireRationale = options.requireRationale !== false;
  const buildId = options.buildId ?? "";
  const model = options.model ?? "";

  const endpoints = unique(
    relations.flatMap((r) => [r.from, r.to]).filter(Boolean),
  );
  const present = new Set<string>();
  for (const part of chunk(endpoints.map(topicId), 300)) {
    const found = await rows(
      graph,
      `MATCH (t:Topic) WHERE t.id IN $ids RETURN t.id AS id`,
      { ids: part },
    );
    for (const r of found) present.add(str(r.id));
  }

  // A foundation the model names but that has no assessment used to be rejected
  // with "target topic is not persisted", which silently dropped most BUILDS_ON
  // edges. Persist it as an unassessed taxonomy node (frontend draws it dashed).
  const SLUG_OK = /^[a-z0-9_]{1,60}$/;
  const stubSlugs = unique(
    relations
      .filter(
        (r) =>
          supported.has(r.type) &&
          r.from &&
          r.to &&
          r.from !== r.to &&
          (!requireRationale || isSpecificRationale(r.reason ?? "")),
      )
      .flatMap((r) => [r.from, r.to]),
  ).filter((s) => SLUG_OK.test(s) && !present.has(topicId(s)));
  if (stubSlugs.length) {
    await runCounted(
      graph,
      "Topic stubs",
      `
      UNWIND $batch AS item
      MERGE (t:Topic {id: item.id})
      ON CREATE SET t.slug = item.slug, t.name = item.name, t.domain = "general",
                    t.description = "", t.aliases_text = "", t.stub = true,
                    t.created_at = $now
      RETURN count(t) AS n
      `,
      stubSlugs.map((slug) => ({
        id: topicId(slug),
        slug,
        name: slug.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
      })),
      { params: { now: options.now } },
    );
    for (const slug of stubSlugs) present.add(topicId(slug));
    log("created unassessed foundation topics", { count: stubSlugs.length });
  }
  // fresh read: this decides a write (cycle detection must see every edge)
  const existingBuilds = await readTaxonomyEdges(graph, "BUILDS_ON", {
    fresh: true,
  });
  const buildsGraph: Array<{ from: string; to: string }> = existingBuilds.map(
    (e) => ({ from: e.from, to: e.to }),
  );
  const linkedByBuilds = new Set<string>(
    buildsGraph.map((e) => [e.from, e.to].sort().join("~")),
  );

  const ok: TopicRelationInput[] = [];
  const seen = new Set<string>();
  const precheck = (r: TopicRelationInput): string | null => {
    if (!supported.has(r.type)) return "unsupported relationship type";
    if (!r.from || !r.to || r.from === r.to)
      return "self-referential or empty edge";
    if (!present.has(topicId(r.from))) return "source topic is not persisted";
    if (!present.has(topicId(r.to))) return "target topic is not persisted";
    if (requireRationale && !isSpecificRationale(r.reason ?? ""))
      return "missing or generic rationale";
    return null;
  };

  // BUILDS_ON first so RELATED_TOPIC checks see every accepted prerequisite.
  for (const r of relations.filter((x) => x.type === "BUILDS_ON")) {
    const base = { from: r.from, to: r.to, type: r.type };
    const problem = precheck(r);
    if (problem) {
      rejected.push({ ...base, reason: problem });
      continue;
    }
    const key = `${r.type}:${r.from}>${r.to}`;
    if (seen.has(key)) continue;
    if (wouldCreateBuildsOnCycle(buildsGraph, r.from, r.to)) {
      rejected.push({
        ...base,
        reason: "would create a BUILDS_ON cycle with the existing taxonomy",
      });
      continue;
    }
    seen.add(key);
    buildsGraph.push({ from: r.from, to: r.to });
    linkedByBuilds.add([r.from, r.to].sort().join("~"));
    ok.push(r);
  }
  for (const r of relations.filter((x) => x.type !== "BUILDS_ON")) {
    const base = { from: r.from, to: r.to, type: r.type };
    const problem = precheck(r);
    if (problem) {
      rejected.push({ ...base, reason: problem });
      continue;
    }
    if (linkedByBuilds.has([r.from, r.to].sort().join("~"))) {
      rejected.push({ ...base, reason: "already linked by BUILDS_ON" });
      continue;
    }
    const key = `${r.type}:${[r.from, r.to].sort().join("~")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ok.push(r);
  }

  const toRows = (list: TopicRelationInput[]) =>
    list.map((r) => ({
      from_id: topicId(r.from),
      to_id: topicId(r.to),
      reason: (r.reason ?? "").trim().slice(0, 400),
      confidence: round(clamp01(r.confidence ?? 0.6), 2),
      strength: r.strength === "required" ? "required" : "helpful",
      basis: r.basis ?? "llm_inferred",
    }));
  const edgeParams = { now: options.now, build_id: buildId, model };

  // The rationale only moves when the new assertion is at least as confident
  // as the stored one (or nothing meaningful is stored yet).
  const edgeQuery = (type: TopicRelationType, reverse: boolean) => `
    UNWIND $batch AS item
    MATCH (a:Topic {id: item.from_id})
    MATCH (b:Topic {id: item.to_id})
    MERGE (${reverse ? "b" : "a"})-[r:${type}]->(${reverse ? "a" : "b"})
    ON CREATE SET r.created_at = $now, r.created_build_id = $build_id, r.created_model = $model
    WITH r, item, (coalesce(r.reason, "") = "" OR coalesce(r.confidence, 0) <= item.confidence) AS take
    SET r.reason = CASE WHEN take THEN item.reason ELSE r.reason END,
        r.confidence = CASE WHEN take THEN item.confidence ELSE r.confidence END,
        r.strength = CASE WHEN take THEN item.strength ELSE coalesce(r.strength, item.strength) END,
        r.basis = CASE WHEN take THEN item.basis ELSE coalesce(r.basis, item.basis) END,
        r.build_id = CASE WHEN take THEN $build_id ELSE coalesce(r.build_id, $build_id) END,
        r.model = CASE WHEN take THEN $model ELSE coalesce(r.model, $model) END,
        r.updated_at = $now
    RETURN count(r) AS n
  `;

  const builds = await runCounted(
    graph,
    "BUILDS_ON edges",
    edgeQuery("BUILDS_ON", false),
    toRows(ok.filter((r) => r.type === "BUILDS_ON")),
    { params: edgeParams },
  );

  const relatedList = toRows(ok.filter((r) => r.type === "RELATED_TOPIC"));
  const relatedForward = await runCounted(
    graph,
    "RELATED_TOPIC edges",
    edgeQuery("RELATED_TOPIC", false),
    relatedList,
    { params: edgeParams },
  );
  const relatedReverse = await runCounted(
    graph,
    "RELATED_TOPIC reverse edges",
    edgeQuery("RELATED_TOPIC", true),
    relatedList,
    { params: edgeParams },
  );

  const expected = ok.length;
  const persisted = builds + Math.min(relatedForward, relatedReverse);
  if (persisted < expected) {
    log("some topic relations were rejected by the database", {
      expected,
      persisted,
    });
  }
  if (rejected.length) {
    log("topic relations rejected before writing", {
      rejected: rejected.length,
      sample: rejected.slice(0, 5),
    });
  }
  return { persisted, rejected };
}

export async function storeDepthAssessments(
  graph: Graph,
  input: StoreDepthInput,
): Promise<StoreDepthResult> {
  await ensureDepthSchema(graph);
  const { developerId, buildId } = input;
  const now = new Date().toISOString();
  const result: StoreDepthResult = {
    topics: 0,
    assessments: 0,
    approaches: 0,
    evidenceEdges: 0,
    mappings: 0,
    unresolvedMappings: [],
    relationsRequested: input.relations.length,
    relations: 0,
    rejectedRelations: [],
    orphansRemoved: { assessments: 0, approaches: 0, topics: 0 },
  };
  const list = input.assessments;

  // 1) Topic nodes (SHARED taxonomy). Metadata is validated and refreshed on
  //    every write; created_at is preserved. No developer data lands here.
  result.topics = await writeTopicMetadata(
    graph,
    list.map((a) => a.topic),
    { now },
  );

  // 1b) Topic -> Capability taxonomy mappings (SHARED, existing capabilities only).
  const mappingInputs: TopicCapabilityMapping[] = list.flatMap((a) => {
    const detailed = a.spec.capabilityMappings ?? [];
    const detailedIds = new Set(detailed.map((m) => m.id));
    return [
      ...detailed.map((m) => ({
        topicSlug: a.topic.slug,
        capabilityId: m.id,
        weight: m.weight,
        reason: m.reason,
      })),
      ...unique(a.spec.capabilityIds)
        .filter((id) => !detailedIds.has(id))
        .map((capabilityId) => ({
          topicSlug: a.topic.slug,
          capabilityId,
          weight: 0.5,
          reason: "",
        })),
    ];
  });
  const mapped = await writeTopicCapabilityMappings(graph, mappingInputs, {
    buildId,
    now,
    pruneStaleForTopics: input.pruneStaleMappings
      ? list.map((a) => a.topic.slug)
      : [],
  });
  result.mappings = mapped.written;
  result.unresolvedMappings = mapped.unresolved;

  // 2) Approach nodes + APPROACH_OF.
  const approachRows = list.flatMap((a) =>
    a.approaches.map((ap) => ({
      id: approachId(a.topic.slug, ap.slug),
      slug: ap.slug,
      name: ap.name,
      description: ap.description,
      topic_slug: a.topic.slug,
      topic_id: topicId(a.topic.slug),
    })),
  );
  result.approaches = await runCounted(
    graph,
    "Approach nodes",
    `
    UNWIND $batch AS item
    MERGE (ap:Approach {id: item.id})
    SET ap.slug = item.slug, ap.name = item.name, ap.description = item.description,
        ap.topic_slug = item.topic_slug
    WITH ap, item
    MATCH (t:Topic {id: item.topic_id})
    MERGE (ap)-[r:APPROACH_OF]->(t)
    RETURN count(r) AS n
    `,
    approachRows,
    { strict: true },
  );

  // 3) DepthAssessment nodes (DEVELOPER-specific; id embeds the developer id,
  //    so one developer's run can never overwrite another's record).
  result.assessments = await runCounted(
    graph,
    "DepthAssessment nodes",
    `
    UNWIND $batch AS item
    MERGE (a:DepthAssessment {id: item.id})
    SET a.developer_id = $developer_id,
        a.topic_slug = item.topic_slug,
        a.topic_id = item.topic_id,
        a.level = item.level,
        a.level_rank = item.level_rank,
        a.score = item.score,
        a.baseline_score = item.baseline_score,
        a.baseline_level = item.baseline_level,
        a.confidence = item.confidence,
        a.authenticity = item.authenticity,
        a.verdict = item.verdict,
        a.rationale = item.rationale,
        a.strengths_json = item.strengths_json,
        a.gaps_json = item.gaps_json,
        a.safeguards_json = item.safeguards_json,
        a.implementations_json = item.implementations_json,
        a.approaches_json = item.approaches_json,
        a.evidence_json = item.evidence_json,
        a.evidence_refs_json = item.evidence_refs_json,
        a.stats_json = item.stats_json,
        a.spec_json = item.spec_json,
        a.files = item.files,
        a.commits = item.commits,
        a.repos = item.repos,
        a.active_days = item.active_days,
        a.approach_count = item.approach_count,
        a.first_seen = item.first_seen,
        a.last_seen = item.last_seen,
        a.fallback = item.fallback,
        a.analysis_version = $version,
        a.model = $model,
        a.build_id = $build_id,
        a.assessed_at = $now,
        a.updated_at = $now
    RETURN count(a) AS n
    `,
    list.map((a) => ({
      id: assessmentId(developerId, a.topic.slug),
      topic_slug: a.topic.slug,
      topic_id: topicId(a.topic.slug),
      level: a.level,
      level_rank: DEPTH_RANK[a.level],
      score: a.score,
      baseline_score: a.baselineScore,
      baseline_level: a.baselineLevel,
      confidence: a.confidence,
      authenticity: a.authenticity,
      verdict: a.verdict,
      rationale: a.rationale,
      strengths_json: JSON.stringify(a.strengths),
      gaps_json: JSON.stringify(a.gaps),
      safeguards_json: JSON.stringify(a.safeguards ?? []),
      implementations_json: JSON.stringify(a.implementations ?? []),
      approaches_json: JSON.stringify(a.approaches),
      evidence_json: JSON.stringify(a.evidence),
      evidence_refs_json: JSON.stringify(a.evidence.map((e) => e.key)),
      stats_json: JSON.stringify(a.stats),
      spec_json: JSON.stringify(a.spec),
      files: a.stats.files,
      commits: a.stats.commits,
      repos: a.stats.repos,
      active_days: a.stats.activeDays,
      approach_count: a.approaches.length,
      first_seen: a.stats.firstSeen,
      last_seen: a.stats.lastSeen,
      fallback: a.fallback,
    })),
    {
      params: {
        developer_id: developerId,
        version: DEPTH_ANALYSIS_VERSION,
        model: input.model,
        build_id: buildId,
        now,
      },
      strict: true,
    },
  );

  // 4) Ownership + topic edges.
  const owner = list.map((a) => ({
    assessment_id: assessmentId(developerId, a.topic.slug),
    topic_id: topicId(a.topic.slug),
  }));
  await runCounted(
    graph,
    "ASSESSED edges",
    `
    UNWIND $batch AS item
    MATCH (d:Developer {id: $developer_id})
    MATCH (a:DepthAssessment {id: item.assessment_id})
    MERGE (d)-[r:ASSESSED]->(a)
    RETURN count(r) AS n
    `,
    owner,
    { params: { developer_id: developerId }, strict: true },
  );
  await runCounted(
    graph,
    "OF_TOPIC edges",
    `
    UNWIND $batch AS item
    MATCH (a:DepthAssessment {id: item.assessment_id})
    MATCH (t:Topic {id: item.topic_id})
    MERGE (a)-[r:OF_TOPIC]->(t)
    RETURN count(r) AS n
    `,
    owner,
    { strict: true },
  );

  // 5) USES_APPROACH (the grouping: which way did this developer do it?).
  await runCounted(
    graph,
    "USES_APPROACH edges",
    `
    UNWIND $batch AS item
    MATCH (a:DepthAssessment {id: item.assessment_id})
    MATCH (ap:Approach {id: item.approach_id})
    MERGE (a)-[r:USES_APPROACH]->(ap)
    SET r.depth = item.depth, r.depth_rank = item.depth_rank,
        r.authenticity = item.authenticity, r.is_primary = item.is_primary,
        r.files = item.files, r.commits = item.commits, r.repos = item.repos,
        r.first_seen = item.first_seen, r.last_seen = item.last_seen,
        r.how_implemented = item.how_implemented,
        r.hardening_json = item.hardening_json, r.gaps_json = item.gaps_json,
        r.build_id = $build_id
    RETURN count(r) AS n
    `,
    list.flatMap((a) =>
      a.approaches.map((ap) => ({
        assessment_id: assessmentId(developerId, a.topic.slug),
        approach_id: approachId(a.topic.slug, ap.slug),
        depth: ap.depth,
        depth_rank: DEPTH_RANK[ap.depth],
        authenticity: ap.authenticity,
        is_primary: ap.isPrimary,
        files: ap.files,
        commits: ap.commits,
        repos: ap.repos,
        first_seen: ap.firstSeen,
        last_seen: ap.lastSeen,
        how_implemented: ap.howImplemented,
        hardening_json: JSON.stringify(ap.hardening),
        gaps_json: JSON.stringify(ap.gaps),
      })),
    ),
    { params: { build_id: buildId }, strict: true },
  );

  // 6) BACKED_BY: cited evidence. Targets can vanish when the evidence graph
  //    is rebuilt, so these are non-strict; evidence_json keeps a snapshot.
  const kinds: Array<[EvidenceRef["kind"], string]> = [
    ["code", "FileChange"],
    ["demonstration", "Demonstration"],
    ["experience", "Experience"],
    ["commit", "Commit"],
  ];
  for (const [kind, label] of kinds) {
    const targets = list.flatMap((a) =>
      a.evidence
        .filter((e) => e.kind === kind)
        .map((e) => ({
          assessment_id: assessmentId(developerId, a.topic.slug),
          target_id: e.id,
          ref: e.key,
          role: kind,
        })),
    );
    if (targets.length === 0) continue;
    result.evidenceEdges += await runCounted(
      graph,
      `BACKED_BY ${label}`,
      `
      UNWIND $batch AS item
      MATCH (a:DepthAssessment {id: item.assessment_id})
      MATCH (x:${label} {id: item.target_id})
      MERGE (a)-[r:BACKED_BY]->(x)
      SET r.ref = item.ref, r.role = item.role, r.build_id = $build_id
      RETURN count(r) AS n
      `,
      targets,
      { params: { build_id: buildId } },
    );
  }

  // 7) Developer -> Topic roll-up for fast reads and algorithms.
  await runCounted(
    graph,
    "KNOWS_TOPIC edges",
    `
    UNWIND $batch AS item
    MATCH (d:Developer {id: $developer_id})
    MATCH (t:Topic {id: item.topic_id})
    MERGE (d)-[r:KNOWS_TOPIC]->(t)
    SET r.level = item.level, r.level_rank = item.level_rank, r.score = item.score,
        r.confidence = item.confidence, r.authenticity = item.authenticity,
        r.approach_count = item.approach_count, r.files = item.files,
        r.commits = item.commits, r.last_seen = item.last_seen,
        r.build_id = $build_id, r.updated_at = $now
    RETURN count(r) AS n
    `,
    list.map((a) => ({
      topic_id: topicId(a.topic.slug),
      level: a.level,
      level_rank: DEPTH_RANK[a.level],
      score: a.score,
      confidence: a.confidence,
      authenticity: a.authenticity,
      approach_count: a.approaches.length,
      files: a.stats.files,
      commits: a.stats.commits,
      last_seen: a.stats.lastSeen,
    })),
    {
      params: { developer_id: developerId, build_id: buildId, now },
      strict: true,
    },
  );

  // 8) Taxonomy relations (SHARED, no developer data). Validated: only edges
  //    the database accepted are counted; everything else is reported.
  const relationOutcome = await writeTopicRelations(graph, input.relations, {
    now,
    buildId,
    model: input.model,
  });
  result.relations = relationOutcome.persisted;
  result.rejectedRelations = relationOutcome.rejected;

  log("taxonomy persistence complete", {
    topics: result.topics,
    mappings: result.mappings,
    unresolvedMappings: result.unresolvedMappings.length,
    relationsRequested: result.relationsRequested,
    relationsPersisted: result.relations,
    relationsRejected: result.rejectedRelations.length,
  });

  // 9) Stale cleanup. Only after every strict write above succeeded.
  await graph.query(
    `
    MATCH (a:DepthAssessment)-[r:BACKED_BY|USES_APPROACH]->()
    WHERE a.id IN $ids AND coalesce(r.build_id, "") <> $build_id
    DELETE r
    `,
    { params: { ids: owner.map((o) => o.assessment_id), build_id: buildId } },
  );

  if (input.replaceAll) {
    await graph.query(
      `
      MATCH (d:Developer {id: $developer_id})-[:ASSESSED]->(a:DepthAssessment)
      WHERE coalesce(a.build_id, "") <> $build_id
      DETACH DELETE a
      `,
      { params: { developer_id: developerId, build_id: buildId } },
    );
    await graph.query(
      `
      MATCH (d:Developer {id: $developer_id})-[k:KNOWS_TOPIC]->(:Topic)
      WHERE coalesce(k.build_id, "") <> $build_id
      DELETE k
      `,
      { params: { developer_id: developerId, build_id: buildId } },
    );
  }

  // 10) Orphan cleanup: assessments / approaches / topics that lost their anchor.
  result.orphansRemoved = await cleanupOrphans(graph);

  log("depth assessments stored", result as unknown as Row);
  return result;
}

export async function storeDepthProfileSummary(
  graph: Graph,
  developerId: string,
  summary: DepthProfileSummary,
): Promise<void> {
  await graph.query(
    `
    MATCH (d:Developer {id: $dev})
    SET d.topic_depth_summary_json = $summary, d.topic_depth_updated_at = $now
    `,
    {
      params: {
        dev: developerId,
        summary: JSON.stringify(summary),
        now: new Date().toISOString(),
      },
    },
  );
}

export async function deleteWhere(
  graph: Graph,
  label: string,
  match: string,
): Promise<number> {
  const found = await tryRows(
    graph,
    `count ${label}`,
    `${match} RETURN count(x) AS n`,
  );
  const n = num(found?.[0]?.n);
  if (n > 0)
    await tryRows(graph, `delete ${label}`, `${match} DETACH DELETE x`);
  return n;
}

export async function cleanupOrphans(graph: Graph): Promise<{
  assessments: number;
  approaches: number;
  topics: number;
}> {
  const assessments = await deleteWhere(
    graph,
    "orphan assessments",
    `MATCH (x:DepthAssessment)
     WHERE NOT ()-[:ASSESSED]->(x) OR NOT (x)-[:OF_TOPIC]->(:Topic)`,
  );
  const approaches = await deleteWhere(
    graph,
    "orphan approaches",
    `MATCH (x:Approach)
     WHERE NOT (x)<-[:USES_APPROACH]-(:DepthAssessment)
        OR NOT (x)-[:APPROACH_OF]->(:Topic)`,
  );
  const topics = await deleteWhere(
    graph,
    "orphan topics",
    `MATCH (x:Topic)
     WHERE NOT ()-[:OF_TOPIC]->(x)
       AND NOT ()-[:KNOWS_TOPIC]->(x)
       AND NOT (x)-[:BUILDS_ON]-()
       AND NOT (x)-[:RELATED_TOPIC]-()
       AND NOT (x)-[:MAPS_TO]->()`,
  );
  if (assessments || approaches || topics) {
    log("orphans removed", { assessments, approaches, topics });
  }
  if (topics) invalidateTaxonomyCache(graph);
  return { assessments, approaches, topics };
}
}
