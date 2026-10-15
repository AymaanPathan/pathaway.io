import type { Graph } from "../../db/falkordb.js";





import { Domain as _constants } from './constants.js';
import { Domain as _helpers_extra } from './helpers-extra.js';
import { Domain as _helpers } from './helpers.js';
import { Domain as _queries } from './queries.js';
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

export async function listTopicCatalog(
  graph: Graph,
  limit = 200,
): Promise<TopicCatalogEntry[]> {
  await ensureDepthSchema(graph);
  const n = Math.min(Math.max(Math.floor(limit), 1), 500);
  const result = await tryRows(
    graph,
    "topic catalog",
    `
    MATCH (t:Topic)
    RETURN t.slug AS slug, coalesce(t.name, "") AS name, coalesce(t.domain, "") AS domain,
           coalesce(t.aliases_text, "") AS aliases, t.foundation_rank AS foundation_rank,
           t.cluster_id AS cluster_id
    ORDER BY coalesce(t.foundation_rank, 0) DESC, t.name
    LIMIT ${n}
    `,
  );
  return (result ?? []).map((r) => ({
    slug: str(r.slug),
    name: str(r.name),
    domain: str(r.domain),
    aliases: str(r.aliases)
      .split("|")
      .map((a) => a.trim())
      .filter(Boolean),
    foundationRank: r.foundation_rank == null ? null : num(r.foundation_rank),
    clusterId: r.cluster_id == null ? null : num(r.cluster_id),
  }));
}

export async function listCapabilityCatalog(
  graph: Graph,
): Promise<CapabilityCatalogEntry[]> {
  const result = await tryRows(
    graph,
    "capability catalog",
    `
    MATCH (c:Capability)
    WHERE coalesce(c.parent_id, "") <> ""
    RETURN c.id AS id, coalesce(c.name, "") AS name, coalesce(c.description, "") AS description
    ORDER BY c.id
    `,
  );
  return (result ?? [])
    .map((r) => ({
      id: str(r.id),
      name: str(r.name),
      description: str(r.description),
    }))
    .filter((c) => c.id);
}

export async function findTopicsByText(
  graph: Graph,
  text: string,
  limit = 8,
): Promise<Array<{ slug: string; name: string; score: number }>> {
  await ensureDepthSchema(graph);
  const tokens = unique(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).slice(
    0,
    10,
  );
  if (!tokens.length) return [];
  const q = tokens.map((t) => (t.length >= 4 ? `${t}*` : t)).join("|");
  const result = await tryRows(
    graph,
    "topic fulltext",
    `
    CALL db.idx.fulltext.queryNodes('Topic', $q) YIELD node, score
    RETURN node.slug AS slug, node.name AS name, score
    ORDER BY score DESC
    LIMIT ${Math.min(Math.max(Math.floor(limit), 1), 20)}
    `,
    { q },
  );
  return (result ?? []).map((r) => ({
    slug: str(r.slug),
    name: str(r.name),
    score: num(r.score),
  }));
}

export async function readTaxonomyEdges(
  graph: Graph,
  type: TopicRelationType,
  options: { fresh?: boolean } = {},
): Promise<TaxonomyEdge[]> {
  if (!(SUPPORTED_TOPIC_RELATIONS as readonly string[]).includes(type)) {
    throw new Error(`unsupported taxonomy relation ${type}`);
  }
  const cache = taxCache(graph);
  const hit = cache.edges.get(type);
  if (!options.fresh && hit && Date.now() - hit.at < TAXONOMY_TTL_MS) {
    return hit.rows;
  }
  const result = await tryRows(
    graph,
    `taxonomy edges ${type}`,
    `
    MATCH (a:Topic)-[r:${type}]->(b:Topic)
    RETURN a.slug AS from_slug, b.slug AS to_slug,
           coalesce(r.reason, "") AS reason,
           coalesce(r.confidence, 0) AS confidence,
           coalesce(r.strength, "helpful") AS strength,
           coalesce(r.basis, "") AS basis,
           coalesce(r.build_id, "") AS build_id,
           coalesce(r.model, "") AS model,
           coalesce(r.updated_at, "") AS updated_at
    LIMIT 10000
    `,
  );
  const mapped = (result ?? [])
    .map((r) => ({
      from: str(r.from_slug),
      to: str(r.to_slug),
      type,
      reason: str(r.reason),
      confidence: round(num(r.confidence), 2),
      strength: (str(r.strength) === "required"
        ? "required"
        : "helpful") as RelationStrength,
      basis: str(r.basis),
      buildId: str(r.build_id),
      model: str(r.model),
      updatedAt: str(r.updated_at),
    }))
    .filter((e) => e.from && e.to);
  if (result) cache.edges.set(type, { at: Date.now(), rows: mapped });
  return mapped;
}

export async function readTopicMeta(
  graph: Graph,
  options: { fresh?: boolean } = {},
): Promise<Map<string, TopicMeta>> {
  const cache = taxCache(graph);
  if (
    !options.fresh &&
    cache.meta &&
    Date.now() - cache.meta.at < TAXONOMY_TTL_MS
  ) {
    return cache.meta.map;
  }
  const result = await tryRows(
    graph,
    "topic meta",
    `
    MATCH (t:Topic)
    RETURN t.slug AS slug, coalesce(t.name, "") AS name, coalesce(t.domain, "") AS domain,
           coalesce(t.description, "") AS description,
           t.foundation_rank AS foundation_rank, t.bridge_score AS bridge_score,
           t.cluster_id AS cluster_id
    LIMIT 5000
    `,
  );
  const out = new Map<string, TopicMeta>();
  for (const r of result ?? []) {
    const slug = str(r.slug);
    if (!slug) continue;
    out.set(slug, {
      slug,
      name: str(r.name) || slug,
      domain: str(r.domain),
      description: str(r.description),
      foundationRank: r.foundation_rank == null ? null : num(r.foundation_rank),
      bridgeScore: r.bridge_score == null ? null : num(r.bridge_score),
      clusterId: r.cluster_id == null ? null : num(r.cluster_id),
    });
  }
  if (result) cache.meta = { at: Date.now(), map: out };
  return out;
}

export async function readDeveloperDepthMap(
  graph: Graph,
  developerId: string,
  slugs: string[],
): Promise<Map<string, DeveloperTopicDepth>> {
  const out = new Map<string, DeveloperTopicDepth>();
  const wanted = unique(slugs.filter(Boolean));
  for (const part of chunk(wanted, 400)) {
    const result = await tryRows(
      graph,
      "developer depth map",
      `
      MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment)
      WHERE a.topic_slug IN $slugs
      RETURN a.topic_slug AS slug, a.level AS level, a.score AS score,
             a.confidence AS confidence, a.authenticity AS authenticity,
             coalesce(a.verdict, "") AS verdict,
             coalesce(a.files, 0) AS files, coalesce(a.commits, 0) AS commits,
             coalesce(a.repos, 0) AS repos,
             coalesce(a.safeguards_json, "[]") AS safeguards,
             coalesce(a.evidence_json, "[]") AS evidence
      `,
      { dev: developerId, slugs: part },
    );
    for (const r of result ?? []) {
      const slug = str(r.slug);
      out.set(slug, {
        slug,
        level: asDepthLevel(r.level),
        score: num(r.score),
        confidence: asConfidence(r.confidence),
        authenticity: asAuthenticity(r.authenticity),
        verdict: str(r.verdict),
        files: num(r.files),
        commits: num(r.commits),
        repos: num(r.repos),
        safeguards: strList(parseJson<unknown>(r.safeguards, [])).slice(0, 8),
        evidence: parseEvidenceBrief(r.evidence),
      });
    }
  }
  return out;
}

export const isPrereqMet = (d: DeveloperTopicDepth | null | undefined): boolean =>
  Boolean(d) && DEPTH_RANK[(d as DeveloperTopicDepth).level] >= PREREQ_MET_RANK;

export async function readTopicContext(
  graph: Graph,
  developerId: string,
  slug: string,
): Promise<TopicContext | null> {
  // head comes from the cached topic meta: no query per topic
  const meta = await readTopicMeta(graph);
  const head = meta.get(slug);
  if (!head) return null;

  const builds = await readTaxonomyEdges(graph, "BUILDS_ON");
  const walked = walkBuildsOn(builds, "out", slug, 3);
  const depth = walked.length
    ? await readDeveloperDepthMap(
        graph,
        developerId,
        walked.map((n) => n.slug),
      )
    : new Map<string, DeveloperTopicDepth>();

  const foundations = walked
    .map((n) => {
      const m = meta.get(n.slug);
      const d = depth.get(n.slug);
      return {
        slug: n.slug,
        name: m?.name ?? n.slug,
        hops: n.hops,
        developerLevel: d?.level ?? "none",
        developerScore: d?.score ?? 0,
        reason: n.edge.reason,
        confidence: n.edge.confidence,
        strength: n.edge.strength,
        basis: n.edge.basis,
        via: n.via,
        developerConfidence: d?.confidence,
        developerAuthenticity: d?.authenticity,
        verdict: d?.verdict,
        files: d?.files,
        commits: d?.commits,
        evidence: d?.evidence,
      };
    })
    .sort((a, b) => a.hops - b.hops || a.name.localeCompare(b.name))
    .slice(0, 12);

  return {
    foundationRank: head.foundationRank,
    bridgeScore: head.bridgeScore,
    clusterId: head.clusterId,
    foundations,
  };
}

export async function readTopicPath(
  graph: Graph,
  fromSlug: string,
  toSlug: string,
): Promise<string[]> {
  const query = `
    MATCH (a:Topic {slug: $a}), (b:Topic {slug: $b})
    WITH shortestPath((a)-[:BUILDS_ON|RELATED_TOPIC*1..6]->(b)) AS p
    RETURN CASE WHEN p IS NULL THEN [] ELSE [n IN nodes(p) | n.slug] END AS slugs
  `;
  const forward = await tryRows(graph, "topic path", query, {
    a: fromSlug,
    b: toSlug,
  });
  const f = strList(forward?.[0]?.slugs);
  if (f.length) return f;
  const backward = await tryRows(graph, "topic path (reverse)", query, {
    a: toSlug,
    b: fromSlug,
  });
  return strList(backward?.[0]?.slugs).reverse();
}

export async function readTopicPathDetailed(
  graph: Graph,
  fromSlug: string,
  toSlug: string,
): Promise<{ slugs: string[]; hops: TopicPathHop[] }> {
  const query = `
    MATCH (a:Topic {slug: $a}), (b:Topic {slug: $b})
    WITH shortestPath((a)-[:BUILDS_ON|RELATED_TOPIC*1..6]->(b)) AS p
    RETURN CASE WHEN p IS NULL THEN [] ELSE [n IN nodes(p) | n.slug] END AS slugs,
           CASE WHEN p IS NULL THEN [] ELSE [r IN relationships(p) | type(r)] END AS types
  `;
  const build = (slugs: string[], types: string[]) => ({
    slugs,
    hops: slugs.slice(0, -1).map((s, i) => ({
      from: s,
      to: slugs[i + 1] as string,
      type: (types[i] === "BUILDS_ON"
        ? "BUILDS_ON"
        : "RELATED_TOPIC") as TopicPathHop["type"],
    })),
  });
  const fwd = await tryRows(graph, "topic path", query, {
    a: fromSlug,
    b: toSlug,
  });
  const fs = strList(fwd?.[0]?.slugs);
  if (fs.length) return build(fs, strList(fwd?.[0]?.types));
  const back = await tryRows(graph, "topic path (reverse)", query, {
    a: toSlug,
    b: fromSlug,
  });
  const bs = strList(back?.[0]?.slugs);
  return bs.length
    ? build([...bs].reverse(), [...strList(back?.[0]?.types)].reverse())
    : { slugs: [], hops: [] };
}

export async function readTopicEvidenceTraversal(
  graph: Graph,
  developerId: string,
  slug: string,
): Promise<TopicEvidencePath[]> {
  const result = await tryRows(
    graph,
    "topic evidence traversal",
    `
    MATCH (t:Topic {slug: $slug})-[m:MAPS_TO]->(c:Capability)
    OPTIONAL MATCH (:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c)
    RETURN c.id AS id, coalesce(c.name, "") AS name, count(DISTINCT x) AS demonstrations,
           m.weight AS weight, coalesce(m.reason, "") AS reason
    ORDER BY demonstrations DESC, name
    `,
    { slug, dev: developerId },
  );
  return (result ?? []).map((r) => ({
    capabilityId: str(r.id),
    capability: str(r.name),
    demonstrations: num(r.demonstrations),
    weight: r.weight == null ? null : round(num(r.weight), 2),
    reason: str(r.reason),
  }));
}

export async function readTopicLearningGraph(
  graph: Graph,
  developerId: string,
  slug: string,
  options: { maxHops?: number; maxUnlockHops?: number } = {},
): Promise<TopicLearningGraph | null> {
  await ensureDepthSchema(graph);
  const maxHops = Math.min(Math.max(options.maxHops ?? 3, 1), 6);
  const maxUnlockHops = Math.min(Math.max(options.maxUnlockHops ?? 2, 1), 4);

  const meta = await readTopicMeta(graph);
  const head = meta.get(slug);
  if (!head) return null;

  const [builds, relatedEdges] = await Promise.all([
    readTaxonomyEdges(graph, "BUILDS_ON"),
    readTaxonomyEdges(graph, "RELATED_TOPIC"),
  ]);
  const prereqWalk = walkBuildsOn(builds, "out", slug, maxHops);
  const unlockWalk = walkBuildsOn(builds, "in", slug, maxUnlockHops);
  const relatedOut = relatedEdges
    .filter((e) => e.from === slug)
    .sort((a, b) => b.confidence - a.confidence || a.to.localeCompare(b.to))
    .slice(0, 12);

  const [depth, capabilityPaths] = await Promise.all([
    readDeveloperDepthMap(graph, developerId, [
      slug,
      ...prereqWalk.map((n) => n.slug),
      ...unlockWalk.map((n) => n.slug),
      ...relatedOut.map((e) => e.to),
    ]),
    readTopicEvidenceTraversal(graph, developerId, slug),
  ]);

  const prerequisites = buildLearningNodes(prereqWalk, meta, depth).sort(
    (a, b) => a.hops - b.hops || a.name.localeCompare(b.name),
  );
  const unlocks = buildLearningNodes(unlockWalk, meta, depth).sort(
    (a, b) => a.hops - b.hops || a.name.localeCompare(b.name),
  );
  const related: RelatedLearningNode[] = relatedOut.map((e) => {
    const m = meta.get(e.to);
    return {
      slug: e.to,
      name: m?.name ?? e.to,
      domain: m?.domain ?? "",
      clusterId: m?.clusterId ?? null,
      edge: toLearningEdge(e),
      developer: depth.get(e.to) ?? null,
    };
  });

  const blocking = prerequisites.filter((n) => n.blocking);
  const unmetRequired = prerequisites
    .filter((n) => n.hops === 1 && n.blocking)
    .map((n) => n.slug);
  const learningOrder = [...blocking]
    .sort(
      (a, b) =>
        b.hops - a.hops ||
        (b.foundationRank ?? 0) - (a.foundationRank ?? 0) ||
        a.slug.localeCompare(b.slug),
    )
    .map((n) => n.slug);

  return {
    topic: {
      slug: head.slug,
      name: head.name,
      domain: head.domain,
      description: head.description,
      foundationRank: head.foundationRank,
      bridgeScore: head.bridgeScore,
      clusterId: head.clusterId,
    },
    developer: depth.get(slug) ?? null,
    prerequisites,
    unlocks,
    related,
    capabilityPaths,
    readiness: {
      ready: unmetRequired.length === 0,
      unmetRequired,
      learningOrder,
      metPrerequisites: prerequisites.filter((n) => n.met).map((n) => n.slug),
    },
  };
}

export async function readLearningFrontier(
  graph: Graph,
  developerId: string,
  options: { limit?: number; belowLevel?: DepthLevel } = {},
): Promise<LearningFrontierEntry[]> {
  await ensureDepthSchema(graph);
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 25), 1), 200);
  const belowRank = DEPTH_RANK[options.belowLevel ?? "proficient"];

  const meta = await readTopicMeta(graph);
  if (meta.size === 0) return [];
  const builds = await readTaxonomyEdges(graph, "BUILDS_ON");
  const depth = await readDeveloperDepthMap(graph, developerId, [
    ...meta.keys(),
  ]);

  const outgoing = new Map<string, TaxonomyEdge[]>();
  const unlockCount = new Map<string, number>();
  for (const e of builds) {
    outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e]);
    unlockCount.set(e.to, (unlockCount.get(e.to) ?? 0) + 1);
  }

  const entries: LearningFrontierEntry[] = [];
  for (const m of meta.values()) {
    const d = depth.get(m.slug) ?? null;
    if (d && DEPTH_RANK[d.level] >= belowRank) continue;

    const prerequisites = (outgoing.get(m.slug) ?? [])
      .map((e) => {
        const pm = meta.get(e.to);
        const pd = depth.get(e.to) ?? null;
        return {
          slug: e.to,
          name: pm?.name ?? e.to,
          strength: e.strength,
          reason: e.reason,
          confidence: e.confidence,
          met: isPrereqMet(pd),
          developer: pd,
        };
      })
      .sort(
        (a, b) =>
          Number(a.met) - Number(b.met) ||
          b.confidence - a.confidence ||
          a.slug.localeCompare(b.slug),
      );
    const blockedBy = prerequisites
      .filter((p) => p.strength === "required" && !p.met)
      .map((p) => p.slug);
    const unlocks = unlockCount.get(m.slug) ?? 0;
    const ready = blockedBy.length === 0;

    const state = d
      ? `currently ${d.level} (${d.authenticity})`
      : "not yet demonstrated in the developer's code";
    entries.push({
      topic: {
        slug: m.slug,
        name: m.name,
        domain: m.domain,
        foundationRank: m.foundationRank,
        bridgeScore: m.bridgeScore,
        clusterId: m.clusterId,
      },
      developer: d,
      ready,
      prerequisites,
      blockedBy,
      unlocks,
      why: ready
        ? `${m.name} is ${state}; no required prerequisite is missing${unlocks ? `, and ${unlocks} topic(s) build on it` : ""}.`
        : `${m.name} is ${state}; first needs ${blockedBy.join(", ")}.`,
    });
  }

  entries.sort(
    (a, b) =>
      Number(b.ready) - Number(a.ready) ||
      (b.topic.foundationRank ?? 0) - (a.topic.foundationRank ?? 0) ||
      b.unlocks - a.unlocks ||
      (b.developer?.score ?? 0) - (a.developer?.score ?? 0) ||
      a.topic.slug.localeCompare(b.topic.slug),
  );
  return entries.slice(0, limit);
}

export async function readTopicsForBackfill(
  graph: Graph,
): Promise<BackfillTopicRow[]> {
  await ensureDepthSchema(graph);
  const topicRows =
    (await tryRows(
      graph,
      "backfill topics",
      `
      MATCH (t:Topic)
      RETURN t.id AS id, t.slug AS slug, coalesce(t.name, "") AS name,
             t.domain AS domain, coalesce(t.description, "") AS description,
             coalesce(t.aliases_text, "") AS aliases
      ORDER BY t.id
      `,
    )) ?? [];
  const specRows =
    (await tryRows(
      graph,
      "backfill specs",
      `
      MATCH (a:DepthAssessment)-[:OF_TOPIC]->(t:Topic)
      RETURN t.id AS id, a.spec_json AS spec
      `,
    )) ?? [];

  const specsById = new Map<string, TopicSpec[]>();
  for (const r of specRows) {
    const spec = parseJson<TopicSpec | null>(r.spec, null);
    if (!spec || !spec.slug) continue;
    const list = specsById.get(str(r.id)) ?? [];
    list.push({
      ...spec,
      aliases: strList(spec.aliases),
      keywords: strList(spec.keywords),
      packages: strList(spec.packages),
      signals: strList(spec.signals),
      capabilityIds: strList(spec.capabilityIds),
      buildsOn: strList(spec.buildsOn),
      related: strList(spec.related),
      approaches: mapList(spec.approaches).map((a) => ({
        slug: str(a.slug),
        name: str(a.name),
        description: str(a.description),
        packages: strList(a.packages),
        signals: strList(a.signals),
        keywords: strList(a.keywords),
      })),
      pinnedFileIds: [],
    });
    specsById.set(str(r.id), list);
  }

  return topicRows.map((r) => {
    const id = str(r.id);
    const slug = str(r.slug) || id.replace(/^topic:/, "");
    return {
      id,
      slug,
      name: str(r.name),
      domain: r.domain == null ? null : str(r.domain),
      description: str(r.description),
      aliases: str(r.aliases)
        .split("|")
        .map((a) => a.trim())
        .filter(Boolean),
      specs: specsById.get(id) ?? [],
      nonCanonicalId: !slug || id !== topicId(slug),
    };
  });
}

export async function readOrphanReport(graph: Graph): Promise<OrphanReport> {
  const slugs = async (label: string, query: string): Promise<string[]> =>
    ((await tryRows(graph, label, query)) ?? [])
      .map((r) => str(r.slug))
      .filter(Boolean);
  const count = async (label: string, query: string): Promise<number> =>
    num(((await tryRows(graph, label, query)) ?? [])[0]?.n);

  const [noAssessment, noRelations, noCapability, badAssess, badApproach] =
    await Promise.all([
      slugs(
        "topics without assessment",
        `MATCH (t:Topic) WHERE NOT ()-[:OF_TOPIC]->(t) RETURN t.slug AS slug LIMIT 500`,
      ),
      slugs(
        "topics without relations",
        `MATCH (t:Topic)
         WHERE NOT (t)-[:BUILDS_ON]-() AND NOT (t)-[:RELATED_TOPIC]-()
         RETURN t.slug AS slug LIMIT 500`,
      ),
      slugs(
        "topics without capability",
        `MATCH (t:Topic) WHERE NOT (t)-[:MAPS_TO]->(:Capability) RETURN t.slug AS slug LIMIT 500`,
      ),
      count(
        "assessments without topic",
        `MATCH (a:DepthAssessment) WHERE NOT (a)-[:OF_TOPIC]->(:Topic) RETURN count(a) AS n`,
      ),
      count(
        "approaches without topic",
        `MATCH (ap:Approach) WHERE NOT (ap)-[:APPROACH_OF]->(:Topic) RETURN count(ap) AS n`,
      ),
    ]);

  return {
    topicsWithoutAssessment: noAssessment,
    topicsWithoutRelations: noRelations,
    topicsWithoutCapability: noCapability,
    assessmentsWithoutTopic: badAssess,
    approachesWithoutTopic: badApproach,
  };
}

export async function readDeveloperTopicProfile(
  graph: Graph,
  developerId: string,
): Promise<DeveloperTopicProfile> {
  const [topicRows, approachRows, summaryRows] = await Promise.all([
    tryRows(
      graph,
      "topic profile",
      `
      MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment)-[:OF_TOPIC]->(t:Topic)
      RETURN t.slug AS slug, t.name AS name, coalesce(t.domain, "") AS domain,
             t.foundation_rank AS foundation_rank, t.cluster_id AS cluster_id,
             a.level AS level, a.score AS score, a.baseline_score AS baseline_score,
             a.confidence AS confidence, a.authenticity AS authenticity,
             coalesce(a.verdict, "") AS verdict, coalesce(a.files, 0) AS files,
             coalesce(a.commits, 0) AS commits, coalesce(a.repos, 0) AS repos,
             coalesce(a.active_days, 0) AS active_days,
             coalesce(a.first_seen, "") AS first_seen, coalesce(a.last_seen, "") AS last_seen,
             coalesce(a.fallback, false) AS fallback
      ORDER BY t.name
      `,
      { dev: developerId },
    ),
    tryRows(
      graph,
      "topic approaches",
      `
      MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment)-[u:USES_APPROACH]->(ap:Approach)
      RETURN a.topic_slug AS topic_slug, ap.slug AS slug, ap.name AS name,
             u.depth AS depth, u.authenticity AS authenticity, u.is_primary AS is_primary,
             coalesce(u.files, 0) AS files, coalesce(u.commits, 0) AS commits,
             coalesce(u.how_implemented, "") AS how
      ORDER BY u.depth_rank DESC, files DESC
      `,
      { dev: developerId },
    ),
    tryRows(
      graph,
      "depth summary",
      `MATCH (d:Developer {id: $dev}) RETURN d.topic_depth_summary_json AS summary LIMIT 1`,
      { dev: developerId },
    ),
  ]);

  const byTopic = new Map<string, TopicDepthSummary["approaches"]>();
  for (const r of approachRows ?? []) {
    const list = byTopic.get(str(r.topic_slug)) ?? [];
    list.push({
      slug: str(r.slug),
      name: str(r.name),
      depth: asDepthLevel(r.depth),
      authenticity: asAuthenticity(r.authenticity),
      isPrimary: bool(r.is_primary),
      files: num(r.files),
      commits: num(r.commits),
      howImplemented: str(r.how),
    });
    byTopic.set(str(r.topic_slug), list);
  }

  const topics: TopicDepthSummary[] = (topicRows ?? []).map((r) => ({
    slug: str(r.slug),
    name: str(r.name),
    domain: str(r.domain),
    level: asDepthLevel(r.level),
    score: num(r.score),
    baselineScore: num(r.baseline_score),
    confidence: asConfidence(r.confidence),
    authenticity: asAuthenticity(r.authenticity),
    verdict: str(r.verdict),
    files: num(r.files),
    commits: num(r.commits),
    repos: num(r.repos),
    activeDays: num(r.active_days),
    firstSeen: str(r.first_seen),
    lastSeen: str(r.last_seen),
    foundationRank: r.foundation_rank == null ? null : num(r.foundation_rank),
    clusterId: r.cluster_id == null ? null : num(r.cluster_id),
    fallback: bool(r.fallback),
    approaches: byTopic.get(str(r.slug)) ?? [],
  }));

  const domainMap = new Map<string, TopicDepthSummary[]>();
  for (const t of topics) {
    const key = t.domain || "other";
    domainMap.set(key, [...(domainMap.get(key) ?? []), t]);
  }
  const domains = [...domainMap.entries()]
    .map(([domain, list]) => ({
      domain,
      topics: list.length,
      bestLevel: list.reduce<DepthLevel>(
        (best, t) => (DEPTH_RANK[t.level] > DEPTH_RANK[best] ? t.level : best),
        "none",
      ),
      averageScore: Math.round(
        list.reduce((n, t) => n + t.score, 0) / list.length,
      ),
    }))
    .sort((a, b) => b.averageScore - a.averageScore);

  const clusterMap = new Map<number, string[]>();
  for (const t of topics) {
    if (t.clusterId == null) continue;
    clusterMap.set(t.clusterId, [
      ...(clusterMap.get(t.clusterId) ?? []),
      t.name,
    ]);
  }

  const summary = parseJson<DepthProfileSummary | null>(
    summaryRows?.[0]?.summary,
    null,
  );

  return {
    developerId,
    topics,
    domains,
    clusters: [...clusterMap.entries()]
      .map(([clusterId, names]) => ({ clusterId, topics: names }))
      .filter((c) => c.topics.length > 1),
    summary,
  };
}

export async function readTopicDepthDetail(
  graph: Graph,
  developerId: string,
  slug: string,
): Promise<TopicDepthDetail | null> {
  const profile = await readDeveloperTopicProfile(graph, developerId);
  const summary = profile.topics.find((t) => t.slug === slug);
  if (!summary) return null;

  // unlocks / related come from the cached taxonomy: no extra queries
  const [
    rowsA,
    buildEdges,
    relatedEdges,
    meta,
    context,
    capabilityPaths,
    learning,
  ] = await Promise.all([
    tryRows(
      graph,
      "assessment detail",
      `
      MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment {topic_slug: $slug})
      RETURN a.rationale AS rationale, a.strengths_json AS strengths, a.gaps_json AS gaps,
             a.safeguards_json AS safeguards, a.implementations_json AS implementations,
             a.approaches_json AS approaches, a.evidence_json AS evidence,
             a.stats_json AS stats, a.baseline_level AS baseline_level
      LIMIT 1
      `,
      { dev: developerId, slug },
    ),
    readTaxonomyEdges(graph, "BUILDS_ON"),
    readTaxonomyEdges(graph, "RELATED_TOPIC"),
    readTopicMeta(graph),
    readTopicContext(graph, developerId, slug),
    readTopicEvidenceTraversal(graph, developerId, slug),
    readTopicLearningGraph(graph, developerId, slug),
  ]);

  const nameOf = (s: string) => meta.get(s)?.name ?? s;
  const unlocks = buildEdges
    .filter((e) => e.to === slug)
    .map((e) => ({
      slug: e.from,
      name: nameOf(e.from),
      reason: e.reason,
      confidence: round(e.confidence, 2),
      strength: e.strength,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 12);
  const related = relatedEdges
    .filter((e) => e.from === slug)
    .map((e) => ({
      slug: e.to,
      name: nameOf(e.to),
      reason: e.reason,
      confidence: round(e.confidence, 2),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 12);

  const a = rowsA?.[0] ?? {};
  return {
    summary,
    rationale: str(a.rationale),
    strengths: parseJson<string[]>(a.strengths, []),
    gaps: parseJson<string[]>(a.gaps, []),
    safeguards: parseJson<string[]>(a.safeguards, []),
    implementations: parseJson<ImplementationNote[]>(a.implementations, []),
    approaches: parseJson<ApproachRecord[]>(a.approaches, []),
    evidence: parseJson<EvidenceRef[]>(a.evidence, []),
    stats: parseJson<EvidenceTotals | null>(a.stats, null),
    baselineLevel: asDepthLevel(a.baseline_level),
    context,
    unlocks,
    related,
    capabilityPaths,
    learning,
  };
}

export async function readStoredTopicSpec(
  graph: Graph,
  developerId: string,
  slug: string,
): Promise<TopicSpec | null> {
  const result = await tryRows(
    graph,
    "stored topic spec",
    `
    MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment {topic_slug: $slug})
    RETURN a.spec_json AS spec LIMIT 1
    `,
    { dev: developerId, slug },
  );
  const spec = parseJson<TopicSpec | null>(result?.[0]?.spec, null);
  return spec && spec.slug ? spec : null;
}

export async function readDeveloperKnowledgeGraph(
  graph: Graph,
  developerId: string,
  options: { maxNodes?: number; maxHops?: number } = {},
): Promise<DeveloperKnowledgeGraph | null> {
  const maxNodes = Math.max(
    25,
    Math.min(1500, Math.floor(options.maxNodes ?? 500)),
  );
  // FalkorDB variable-length paths are bounded here to prevent accidental
  // graph-wide traversal. Keep this a literal because it is query syntax.
  const maxHops = Math.max(1, Math.min(3, Math.floor(options.maxHops ?? 3)));

  const exists = await tryRows(
    graph,
    "knowledge graph developer exists",
    `MATCH (d:Developer {id: $dev}) RETURN d.id AS id LIMIT 1`,
    { dev: developerId },
  );
  if (!exists?.length) return null;

  // Separate, bounded relationship queries are more robust than assuming every
  // optional label/relationship exists in every developer's graph build.
  const hopPattern = `-[*1..${maxHops}]-`;
  const nodeRows = await tryRows(
    graph,
    "developer knowledge graph nodes",
    `
    MATCH (d:Developer {id: $dev})${hopPattern}(n)
    WITH DISTINCT n LIMIT ${maxNodes}
    RETURN labels(n) AS labels,
           coalesce(n.id, n.slug, n.topic_slug, n.name, elementId(n)) AS id,
           coalesce(n.name, n.title, n.technique, n.summary, n.slug, n.topic_slug, "") AS name,
           properties(n) AS properties
    `,
    { dev: developerId },
  );
  if (!nodeRows) return null;

  const edgeRows = await tryRows(
    graph,
    "developer knowledge graph edges",
    `
    MATCH (d:Developer {id: $dev})${hopPattern}(a)-[r]-(b)
    WITH DISTINCT a, r, b LIMIT ${maxNodes * 3}
    RETURN coalesce(a.id, a.slug, a.topic_slug, a.name, elementId(a)) AS from_id,
           coalesce(b.id, b.slug, b.topic_slug, b.name, elementId(b)) AS to_id,
           type(r) AS type, properties(r) AS properties
    `,
    { dev: developerId },
  );

  const nodes: DeveloperKnowledgeNode[] = nodeRows.map((r) => {
    const labels = strList(r.labels);
    const properties =
      r.properties && typeof r.properties === "object"
        ? (r.properties as Row)
        : {};
    return {
      id: str(r.id),
      label: labels[0] ?? "Unknown",
      name: str(r.name),
      properties,
    };
  });
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: DeveloperKnowledgeEdge[] = (edgeRows ?? [])
    .map((r) => ({
      from: str(r.from_id),
      to: str(r.to_id),
      type: str(r.type),
      properties:
        r.properties && typeof r.properties === "object"
          ? (r.properties as Row)
          : {},
    }))
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  const evidenceLabels = new Set([
    "FileChange",
    "Commit",
    "Demonstration",
    "PullRequest",
    "Issue",
    "Experience",
    "Safeguard",
    "TechniqueSpec",
  ]);
  return {
    developerId,
    nodes,
    edges,
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      evidenceNodes: nodes.filter((n) => evidenceLabels.has(n.label)).length,
    },
  };
}

export async function readDeveloperTopicEvidenceGraph(
  graph: Graph,
  developerId: string,
  topicSlug: string,
  options: { limit?: number } = {},
): Promise<DeveloperKnowledgeGraph | null> {
  const limit = Math.max(10, Math.min(500, Math.floor(options.limit ?? 100)));
  const result = await tryRows(
    graph,
    "developer topic evidence graph",
    `
    MATCH (d:Developer {id: $dev})
    MATCH (t:Topic {slug: $slug})
    OPTIONAL MATCH (t)-[:MAPS_TO]->(c:Capability)
    WITH d, t, collect(DISTINCT c.id) AS capabilityIds
    MATCH (d)-[r1]-(e)
    WHERE (e:Demonstration AND EXISTS {
      MATCH (e)-[:OF_CAPABILITY]->(c2:Capability)
      WHERE c2.id IN capabilityIds
    })
       OR (e:Experience AND (e.capability_id IN capabilityIds OR
           toLower(coalesce(e.technique, "")) CONTAINS toLower($slug) OR
           toLower(coalesce(e.summary, "")) CONTAINS toLower($slug)))
       OR (e:DepthAssessment AND e.topic_slug = $slug)
    WITH d, t, e, r1 LIMIT ${limit}
    OPTIONAL MATCH (e)-[r2]-(support)
    WHERE support:Commit OR support:FileChange OR support:Repository
       OR support:TechniqueSpec OR support:Safeguard OR support:Technology
       OR support:EngineeringContext OR support:Problem OR support:Approach
    RETURN labels(e) AS evidence_labels,
           coalesce(e.id, e.topic_slug, elementId(e)) AS evidence_id,
           coalesce(e.name, e.technique, e.summary, e.title, "") AS evidence_name,
           type(r1) AS developer_relation,
           labels(support) AS support_labels,
           coalesce(support.id, support.slug, support.name, elementId(support)) AS support_id,
           coalesce(support.name, support.path, support.technique, support.summary, "") AS support_name,
           type(r2) AS support_relation,
           properties(e) AS evidence_properties,
           properties(support) AS support_properties
    LIMIT ${limit}
    `,
    { dev: developerId, slug: topicSlug },
  );
  if (!result) return null;

  const nodeMap = new Map<string, DeveloperKnowledgeNode>();
  const edges: DeveloperKnowledgeEdge[] = [];
  for (const row of result) {
    const evidenceId = str(row.evidence_id);
    if (evidenceId)
      nodeMap.set(evidenceId, {
        id: evidenceId,
        label: strList(row.evidence_labels)[0] ?? "Evidence",
        name: str(row.evidence_name),
        properties:
          row.evidence_properties && typeof row.evidence_properties === "object"
            ? (row.evidence_properties as Row)
            : {},
      });
    const supportId = str(row.support_id);
    if (supportId) {
      nodeMap.set(supportId, {
        id: supportId,
        label: strList(row.support_labels)[0] ?? "Evidence",
        name: str(row.support_name),
        properties:
          row.support_properties && typeof row.support_properties === "object"
            ? (row.support_properties as Row)
            : {},
      });
      if (evidenceId)
        edges.push({
          from: evidenceId,
          to: supportId,
          type: str(row.support_relation),
          properties: {},
        });
    }
    if (evidenceId)
      edges.push({
        from: developerId,
        to: evidenceId,
        type: str(row.developer_relation),
        properties: {},
      });
  }
  const nodes = [...nodeMap.values()];
  return {
    developerId,
    nodes,
    edges,
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      evidenceNodes: nodes.filter((n) =>
        [
          "Demonstration",
          "Experience",
          "DepthAssessment",
          "Commit",
          "FileChange",
          "PullRequest",
        ].includes(n.label),
      ).length,
    },
  };
}
}
