import type { Graph } from "../../db/falkordb.js";





import { Domain as _constants } from './constants.js';
import { Domain as _helpers_extra } from './helpers-extra.js';
import { Domain as _helpers } from './helpers.js';
import { Domain as _queries } from './queries.js';
import { Domain as _readers_extra2 } from './readers-extra2.js';
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

export function isSpecificRationale(reason: string): boolean {
  const r = reason.trim();
  if (r.length < 24) return false;
  const words = r.split(/\s+/).length;
  if (words < 5) return false;
  if (words <= 9 && GENERIC_RELATION_TEMPLATE.test(r)) return false;
  return true;
}

export const isoDay = (ts: number): string =>
  ts ? new Date(ts).toISOString().slice(0, 10) : "";

export async function fetchFileRecords(
  graph: Graph,
  developerId: string,
  onProgress: ProgressFn,
): Promise<FileRecord[]> {
  const out: FileRecord[] = [];
  let after = "";

  while (true) {
    const page = await rows(
      graph,
      `
      MATCH (d:Developer {id: $dev})-[:AUTHORED_CODE]->(fc:FileChange)
      WHERE fc.id > $after
      RETURN fc.id AS id,
             coalesce(fc.path, "") AS path,
             coalesce(fc.language, "") AS language,
             coalesce(fc.file_role, "source") AS role,
             coalesce(fc.is_test, false) AS is_test,
             coalesce(fc.additions, 0) AS additions,
             coalesce(fc.deletions, 0) AS deletions,
             coalesce(fc.commit_sha, "") AS commit_sha,
             coalesce(fc.repository_id, "") AS repository_id,
             coalesce(fc.created_at, "") AS created_at,
             coalesce(fc.imports_added_json, "[]") AS imports_added,
             coalesce(fc.imports_removed_json, "[]") AS imports_removed,
             coalesce(fc.symbols_added_json, "[]") AS symbols_added,
             coalesce(fc.symbols_modified_json, "[]") AS symbols_modified,
             coalesce(fc.code_signals_json, "{}") AS code_signals,
             coalesce(fc.dependency_changes_json, "") AS dependency_changes
      ORDER BY fc.id
      LIMIT ${FILE_PAGE_SIZE}
      `,
      { dev: developerId, after },
    );

    for (const r of page) {
      const createdAt = str(r.created_at);
      const ts = Date.parse(createdAt);
      const repositoryId = str(r.repository_id);
      const commitSha = str(r.commit_sha);
      const dep = parseJson<Row | null>(r.dependency_changes, null);

      out.push({
        id: str(r.id),
        path: str(r.path),
        repositoryId,
        commitSha,
        commitId: `${repositoryId}:commit:${commitSha}`,
        createdAt,
        ts: Number.isFinite(ts) ? ts : 0,
        language: str(r.language),
        role: str(r.role, "source"),
        isTest: bool(r.is_test),
        additions: num(r.additions),
        deletions: num(r.deletions),
        packages: strList(parseJson<unknown>(r.imports_added, [])).map((p) =>
          p.toLowerCase(),
        ),
        packagesRemoved: strList(parseJson<unknown>(r.imports_removed, [])).map(
          (p) => p.toLowerCase(),
        ),
        signals: Object.fromEntries(
          Object.entries(parseJson<Row>(r.code_signals, {})).map(([k, v]) => [
            k,
            num(v),
          ]),
        ),
        symbols: strList(parseJson<unknown>(r.symbols_added, [])),
        symbolsModified: strList(parseJson<unknown>(r.symbols_modified, [])),
        depChanges: dep
          ? {
              added: mapList(dep.added).map((x) => str(x.name).toLowerCase()),
              removed: mapList(dep.removed).map((x) =>
                str(x.name).toLowerCase(),
              ),
              changed: mapList(dep.changed).map((x) =>
                str(x.name).toLowerCase(),
              ),
            }
          : null,
      });
    }

    onProgress("depth_files_scanned", { scanned: out.length });
    if (page.length < FILE_PAGE_SIZE) break;
    const last = str(page[page.length - 1]?.id);
    if (!last || last === after) break;
    after = last;
  }

  return out;
}

export async function fetchDemonstrations(
  graph: Graph,
  developerId: string,
): Promise<DemoRow[] | null> {
  const result = await tryRows(
    graph,
    "atlas demonstrations",
    `
    MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability)
    OPTIONAL MATCH (x)-[:IN_REPOSITORY]->(r:Repository)
    RETURN x.id AS id, c.id AS capability_id,
           coalesce(x.technique, "") AS technique,
           coalesce(x.summary, "") AS summary,
           coalesce(x.depth, "usage") AS depth,
           coalesce(x.depth_rank, 1) AS depth_rank,
           coalesce(x.modifiers, "") AS modifiers,
           coalesce(r.full_name, r.name, "") AS repository,
           coalesce(x.path, "") AS path,
           coalesce(x.permalink, "") AS permalink,
           coalesce(x.commit_subject, "") AS commit_subject,
           coalesce(x.snippet, "") AS snippet
    ORDER BY depth_rank DESC
    LIMIT ${DEMO_LIMIT}
    `,
    { dev: developerId },
  );
  if (!result) return null;
  return result.map((r) => ({
    id: str(r.id),
    capabilityId: str(r.capability_id),
    technique: str(r.technique),
    techniqueLower: str(r.technique).toLowerCase(),
    summaryLower: str(r.summary).toLowerCase(),
    depth: str(r.depth, "usage"),
    depthRank: num(r.depth_rank, 1),
    modifiers: str(r.modifiers),
    repository: str(r.repository),
    path: str(r.path),
    permalink: str(r.permalink),
    commitSubject: str(r.commit_subject),
    snippet: raw(r.snippet).slice(0, 500),
  }));
}

export async function readEvidenceAtlas(
  graph: Graph,
  developerId: string,
  onProgress: ProgressFn = () => {},
  options: { cacheMs?: number } = {},
): Promise<EvidenceAtlas | null> {
  await ensureDepthSchema(graph);

  const cacheMs = options.cacheMs ?? 0;
  if (cacheMs > 0) {
    const hit = atlasCache.get(developerId);
    if (hit && Date.now() - hit.at < cacheMs) {
      onProgress("depth_atlas_ready", {
        files: hit.atlas.totals.files,
        cached: true,
      });
      return hit.atlas;
    }
  }

  const exists = await tryRows(
    graph,
    "developer exists",
    `MATCH (d:Developer {id: $dev}) RETURN d.id AS id LIMIT 1`,
    { dev: developerId },
  );
  if (!exists || exists.length === 0) return null;

  const files = await fetchFileRecords(graph, developerId, onProgress);
  const repoIds = unique(files.map((f) => f.repositoryId).filter(Boolean));

  const [capRows, expRows, skillRows, repoRows, demos] = await Promise.all([
    tryRows(
      graph,
      "atlas capabilities",
      `
      MATCH (d:Developer {id: $dev})-[hc:HAS_CAPABILITY]->(c:Capability)
      WHERE c.parent_id <> ""
      RETURN c.id AS id, c.name AS name, coalesce(c.description, "") AS description,
             coalesce(hc.level, "missing") AS level,
             coalesce(hc.evidence_count, 0) AS evidence,
             coalesce(hc.commit_count, 0) AS commits,
             coalesce(hc.repo_count, 0) AS repos
      ORDER BY evidence DESC
      `,
      { dev: developerId },
    ),
    tryRows(
      graph,
      "atlas experiences",
      `
      MATCH (d:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)
      OPTIONAL MATCH (e)-[:USES_TECHNOLOGY]->(t:Technology)
      OPTIONAL MATCH (e)-[:OCCURS_IN]->(r:Repository)
      RETURN e.id AS id,
             coalesce(e.capability_id, "") AS capability_id,
             coalesce(e.technique, "") AS technique,
             coalesce(e.summary, "") AS summary,
             coalesce(e.best_depth, "usage") AS depth,
             coalesce(e.evidence_count, 0) AS evidence,
             coalesce(e.commit_count, 0) AS commits,
             coalesce(e.repo_count, 0) AS repos,
             collect(DISTINCT t.name) AS techs,
             collect(DISTINCT coalesce(r.full_name, r.name)) AS repositories
      ORDER BY evidence DESC
      `,
      { dev: developerId },
    ),
    tryRows(
      graph,
      "atlas skills",
      `
      MATCH (d:Developer {id: $dev})-[hs:HAS_SKILL]->(s:Skill)
      RETURN s.id AS id, s.name AS name, coalesce(hs.level, "") AS level,
             coalesce(hs.depth_score, 0) AS score
      ORDER BY score DESC
      `,
      { dev: developerId },
    ),
    repoIds.length
      ? tryRows(
          graph,
          "atlas repositories",
          `
          MATCH (r:Repository)
          WHERE r.id IN $ids
          RETURN r.id AS id,
                 coalesce(r.full_name, r.name, "") AS full_name,
                 coalesce(r.description, "") AS description,
                 coalesce(r.language, "") AS language,
                 coalesce(r.topics_json, "[]") AS topics_json,
                 coalesce(r.dependencies_json, "{}") AS dependencies_json
          `,
          { ids: repoIds },
        )
      : Promise.resolve([] as Row[]),
    fetchDemonstrations(graph, developerId),
  ]);


  const pkg = new Map<string, Acc>();
  const sig = new Map<string, Acc>();
  const vocab = new Map<string, number>();
  const allCommits = new Set<string>();
  const allDays = new Set<string>();
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  let codeFiles = 0;
  const commitFileCount = new Map<string, number>();

  for (const f of files) {
    allCommits.add(f.commitId);
    commitFileCount.set(f.commitId, (commitFileCount.get(f.commitId) ?? 0) + 1);
    if (f.ts) {
      first = Math.min(first, f.ts);
      last = Math.max(last, f.ts);
      allDays.add(isoDay(f.ts));
    }
    if (f.isTest || NON_CODE_ROLES.has(f.role)) continue;
    codeFiles += 1;

    for (const p of f.packages) {
      const acc = pkg.get(p) ?? newAcc();
      touch(acc, f);
      pkg.set(p, acc);
    }
    for (const [s, c] of Object.entries(f.signals)) {
      if (c <= 0) continue;
      const acc = sig.get(s) ?? newAcc();
      touch(acc, f, c);
      sig.set(s, acc);
    }

    const terms = new Set<string>();
    for (const symbol of f.symbols) {
      for (const t of splitIdentifier(symbolName(symbol))) terms.add(t);
    }
    for (const segment of f.path.split("/")) {
      for (const t of splitIdentifier(segment.replace(/\.[a-z0-9]+$/i, ""))) {
        terms.add(t);
      }
    }
    for (const t of terms) vocab.set(t, (vocab.get(t) ?? 0) + 1);
  }

  const repoNames = new Map<string, string>();
  const repoDeclared = new Map<string, Set<string>>();
  const repositories: AtlasRepository[] = (repoRows ?? []).map((r) => {
    const id = str(r.id);
    repoNames.set(id, str(r.full_name));
    repoDeclared.set(id, parseDeclared(r.dependencies_json));
    return {
      id,
      name: str(r.full_name),
      description: str(r.description).slice(0, 240),
      language: str(r.language),
      topics: strList(parseJson<unknown>(r.topics_json, [])),
    };
  });

  const packages: PackageAtom[] = [...pkg.entries()]
    .map(([name, a]) => ({
      name,
      files: a.files,
      commits: a.commits.size,
      repos: a.repos.size,
      activeDays: a.days.size,
      firstSeen: isoDay(a.first),
      lastSeen: isoDay(a.last),
    }))
    .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));

  const signals: SignalAtom[] = [...sig.entries()]
    .map(([name, a]) => ({
      name,
      files: a.files,
      commits: a.commits.size,
      occurrences: a.count,
    }))
    .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));

  const vocabulary: VocabAtom[] = [...vocab.entries()]
    .filter(([, n]) => n >= 2)
    .map(([term, n]) => ({ term, files: n }))
    .sort((a, b) => b.files - a.files || a.term.localeCompare(b.term))
    .slice(0, 120);

  const capabilities: AtlasCapability[] = (capRows ?? []).map((r) => ({
    id: str(r.id),
    name: str(r.name),
    description: str(r.description),
    level: str(r.level),
    evidence: num(r.evidence),
    commits: num(r.commits),
    repos: num(r.repos),
  }));

  const experiences: AtlasExperience[] = (expRows ?? []).map((r) => ({
    id: str(r.id),
    capabilityId: str(r.capability_id),
    technique: str(r.technique),
    summary: str(r.summary),
    depth: str(r.depth),
    evidence: num(r.evidence),
    commits: num(r.commits),
    repos: num(r.repos),
    technologies: strList(r.techs),
    repositories: strList(r.repositories),
  }));

  const skills: AtlasSkill[] = (skillRows ?? []).map((r) => ({
    id: str(r.id),
    name: str(r.name),
    level: str(r.level),
    score: num(r.score),
  }));

  const atlas: EvidenceAtlas = {
    developerId,
    generatedAt: new Date().toISOString(),
    totals: {
      files: files.length,
      codeFiles,
      commits: allCommits.size,
      repositories: repoIds.length,
      activeDays: allDays.size,
      firstSeen: isoDay(Number.isFinite(first) ? first : 0),
      lastSeen: isoDay(last),
    },
    packages,
    signals,
    vocabulary,
    clusters: buildClusters(files),
    capabilities,
    experiences,
    skills,
    repositories,
    index: {
      files,
      repoNames,
      repoDeclared,
      commitFileCount,
      commitMeta: new Map(),
      demos,
    },
  };

  if (cacheMs > 0) atlasCache.set(developerId, { at: Date.now(), atlas });

  onProgress("depth_atlas_ready", {
    files: files.length,
    packages: packages.length,
    signals: signals.length,
    clusters: atlas.clusters.length,
  });
  return atlas;
}
}
