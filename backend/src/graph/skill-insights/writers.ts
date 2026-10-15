import type { Graph } from "../../db/falkordb.js";




import { Domain as _constants } from './constants.js';
import { Domain as _helpers } from './helpers.js';
import { Domain as _queries } from './queries.js';
import { Domain as _readers } from './readers.js';
import { Domain as _types } from './types.js';

export namespace Domain {
import LOG_PREFIX = _constants.LOG_PREFIX;
import SKILL_CATEGORIES = _constants.SKILL_CATEGORIES;
import DB_BATCH_SIZE = _constants.DB_BATCH_SIZE;
import log = _helpers.log;
import logError = _helpers.logError;
import nowMs = _helpers.nowMs;
import elapsedMs = _helpers.elapsedMs;
import language = _helpers.language;
import IMPLIES = _helpers.IMPLIES;
import RELATED = _helpers.RELATED;
import DEF_BY_ID = _helpers.DEF_BY_ID;
import CATEGORY_BY_ID = _helpers.CATEGORY_BY_ID;
import IMPLIED_BY = _helpers.IMPLIED_BY;
import DAY_MS = _helpers.DAY_MS;
import SCORE_WEIGHTS = _helpers.SCORE_WEIGHTS;
import BREADTH_CAP_FILES = _helpers.BREADTH_CAP_FILES;
import COMMITS_CAP = _helpers.COMMITS_CAP;
import REPOS_CAP = _helpers.REPOS_CAP;
import SUSTAIN_DAYS_CAP = _helpers.SUSTAIN_DAYS_CAP;
import SUSTAIN_SPAN_CAP_DAYS = _helpers.SUSTAIN_SPAN_CAP_DAYS;
import WEAK_WEIGHT = _helpers.WEAK_WEIGHT;
import MAX_LINES_PER_CHANGE = _helpers.MAX_LINES_PER_CHANGE;
import MAX_CODE_SCAN_CHARS = _helpers.MAX_CODE_SCAN_CHARS;
import RECENT_WINDOW_DAYS = _helpers.RECENT_WINDOW_DAYS;
import DORMANT_AFTER_DAYS = _helpers.DORMANT_AFTER_DAYS;
import MIN_COOCCURRENCE = _helpers.MIN_COOCCURRENCE;
import MAX_COOCCURRENCE_EDGES = _helpers.MAX_COOCCURRENCE_EDGES;
import ACTIVITY_MONTHS = _helpers.ACTIVITY_MONTHS;
import levelForScore = _helpers.levelForScore;
import safeString = _helpers.safeString;
import safeNumber = _helpers.safeNumber;
import round = _helpers.round;
import chunkArray = _helpers.chunkArray;
import asQueryParams = _helpers.asQueryParams;
import SAFE_IDENTIFIER = _helpers.SAFE_IDENTIFIER;
import assertSafeIdentifier = _helpers.assertSafeIdentifier;
import dayKey = _helpers.dayKey;
import monthKey = _helpers.monthKey;
import runBatches = _helpers.runBatches;
import SKILL_INDEXES = _helpers.SKILL_INDEXES;
import NOISE_PATH_PATTERNS = _helpers.NOISE_PATH_PATTERNS;
import skillSignal = _helpers.skillSignal;
import matchesSkill = _helpers.matchesSkill;
import classifyRow = _helpers.classifyRow;
import newAggregate = _helpers.newAggregate;
import addToAggregate = _helpers.addToAggregate;
import classifyEvidence = _helpers.classifyEvidence;
import computeTrend = _helpers.computeTrend;
import computeConfidence = _helpers.computeConfidence;
import computeDepth = _helpers.computeDepth;
import activitySeries = _helpers.activitySeries;
import analyzeDeveloperSkills = _helpers.analyzeDeveloperSkills;
import parseActivity = _helpers.parseActivity;
import skillRef = _helpers.skillRef;
import SKILL_TAXONOMY = _queries.SKILL_TAXONOMY;
import FETCH_PAGE_SIZE = _readers.FETCH_PAGE_SIZE;
import fetchFileChangeEvidence = _readers.fetchFileChangeEvidence;
import isNoiseFile = _readers.isNoiseFile;
import buildSkillProfile = _readers.buildSkillProfile;
import getDeveloperSkillProfile = _readers.getDeveloperSkillProfile;
import getSkillGraph = _readers.getSkillGraph;
import buildSkillInsights = _readers.buildSkillInsights;
import getSkillInsights = _readers.getSkillInsights;
import fetchStoredSkillMetrics = _readers.fetchStoredSkillMetrics;
import fetchRepositoryNames = _readers.fetchRepositoryNames;
import fetchCoOccurring = _readers.fetchCoOccurring;
import fetchOwnedSkillIds = _readers.fetchOwnedSkillIds;
import getSkillDetail = _readers.getSkillDetail;
import AnyObject = _types.AnyObject;
import ProgressFn = _types.ProgressFn;
import SkillDefinition = _types.SkillDefinition;
import SkillCategoryDefinition = _types.SkillCategoryDefinition;
import SkillLevel = _types.SkillLevel;
import SkillTrend = _types.SkillTrend;
import SkillConfidence = _types.SkillConfidence;
import QueryPrimitive = _types.QueryPrimitive;
import QueryParamObject = _types.QueryParamObject;
import FileChangeEvidenceRow = _types.FileChangeEvidenceRow;
import SkillEvidenceLike = _types.SkillEvidenceLike;
import SignalStrength = _types.SignalStrength;
import RowMatch = _types.RowMatch;
import RepoUsage = _types.RepoUsage;
import SkillAggregate = _types.SkillAggregate;
import CoOccurrence = _types.CoOccurrence;
import ClassificationResult = _types.ClassificationResult;
import ActivityPoint = _types.ActivityPoint;
import SkillProfileEntry = _types.SkillProfileEntry;
import SkillAnalysisResult = _types.SkillAnalysisResult;
import CategorySkillGroup = _types.CategorySkillGroup;
import SkillGraphNode = _types.SkillGraphNode;
import SkillGraphEdge = _types.SkillGraphEdge;
import SkillGraphView = _types.SkillGraphView;
import InsightSkill = _types.InsightSkill;
import SkillInsights = _types.SkillInsights;
import SkillProofItem = _types.SkillProofItem;
import SkillDetail = _types.SkillDetail;

export async function ensureSkillIndexes(graph: Graph): Promise<void> {
  log("ensuring skill indexes", {
    indexes: SKILL_INDEXES.map((i) => `${i.label}(${i.property})`),
  });

  for (const { label, property } of SKILL_INDEXES) {
    const safeLabel = assertSafeIdentifier(label);
    const safeProperty = assertSafeIdentifier(property);

    try {
      await graph.query(
        `CREATE INDEX FOR (n:${safeLabel}) ON (n.${safeProperty})`,
      );
      log(`index ready: ${safeLabel}(${safeProperty})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/already\s+(exists|indexed)/i.test(message)) {
        log(`index already exists: ${safeLabel}(${safeProperty})`);
      } else {
        logError(
          `failed to create index on :${safeLabel}(${safeProperty})`,
          message,
        );
      }
    }
  }
}

export async function storeSkillCategories(graph: Graph): Promise<void> {
  const startedAt = nowMs();
  log("writing skill categories", { count: SKILL_CATEGORIES.length });

  await graph.query(
    `
    UNWIND $batch AS item
    MERGE (c:SkillCategory {id: item.id})
    SET c.name = item.name
    `,
    { params: { batch: asQueryParams(SKILL_CATEGORIES) } },
  );

  log("skill categories written", { durationMs: elapsedMs(startedAt) });
}

export async function storeSkillDefinitions(graph: Graph): Promise<void> {
  const rows = SKILL_TAXONOMY.map((def) => ({
    id: def.id,
    name: def.name,
    category_id: def.category,
  }));

  await runBatches(
    graph,
    "skill definitions",
    `
    UNWIND $batch AS item
    MERGE (s:Skill {id: item.id})
    SET s.name = item.name,
        s.category_id = item.category_id

    WITH s, item
    MATCH (c:SkillCategory {id: item.category_id})
    MERGE (c)-[:CONTAINS]->(s)
    `,
    asQueryParams(rows),
  );

  // Static structure: (Skill)-[:IMPLIES]->(Skill) and ADJACENT_TO.
  // ADJACENT_TO is deliberately not RELATED_TO so it can never leak into
  // the Capability graph algorithms.
  const impliesRows = SKILL_TAXONOMY.flatMap((def) =>
    (def.implies ?? []).map((to) => ({ from: def.id, to })),
  );
  await runBatches(
    graph,
    "skill IMPLIES edges",
    `
    UNWIND $batch AS item
    MATCH (a:Skill {id: item.from})
    MATCH (b:Skill {id: item.to})
    MERGE (a)-[:IMPLIES]->(b)
    `,
    asQueryParams(impliesRows),
  );

  const adjacentRows = SKILL_TAXONOMY.flatMap((def) =>
    (def.related ?? []).map((to) => ({ from: def.id, to })),
  );
  await runBatches(
    graph,
    "skill ADJACENT_TO edges",
    `
    UNWIND $batch AS item
    MATCH (a:Skill {id: item.from})
    MATCH (b:Skill {id: item.to})
    MERGE (a)-[:ADJACENT_TO]->(b)
    `,
    asQueryParams(adjacentRows),
  );
}

export async function storeDeveloperSkills(
  graph: Graph,
  developerId: string,
  profile: SkillProfileEntry[],
  updatedAt: string,
): Promise<void> {
  const rows = profile.map((entry) => ({
    developer_id: developerId,
    skill_id: entry.skillId,
    depth_score: entry.depthScore,
    level: entry.level,
    files_touched: entry.filesTouched,
    strong_files: entry.strongFiles,
    commits_count: entry.commitsCount,
    repos_count: entry.reposCount,
    lines_added: entry.linesAdded,
    lines_deleted: entry.linesDeleted,
    active_days: entry.activeDays,
    active_months: entry.activeMonths,
    first_seen: entry.firstSeen,
    last_seen: entry.lastSeen,
    recency_days: entry.recencyDays,
    recent_commits: entry.recentCommits,
    prior_commits: entry.priorCommits,
    trend: entry.trend,
    confidence: entry.confidence,
    evidence_quality: entry.evidenceQuality,
    activity_json: JSON.stringify(entry.activity),
    updated_at: updatedAt,
  }));

  log("writing developer HAS_SKILL edges", {
    developerId,
    totalEdges: rows.length,
    updatedAt,
  });

  await runBatches(
    graph,
    "developer HAS_SKILL edges",
    `
    UNWIND $batch AS item
    MATCH (d:Developer {id: item.developer_id})
    MATCH (s:Skill {id: item.skill_id})
    MERGE (d)-[r:HAS_SKILL]->(s)
    SET
      r.depth_score = item.depth_score,
      r.level = item.level,
      r.files_touched = item.files_touched,
      r.strong_files = item.strong_files,
      r.commits_count = item.commits_count,
      r.repos_count = item.repos_count,
      r.lines_added = item.lines_added,
      r.lines_deleted = item.lines_deleted,
      r.active_days = item.active_days,
      r.active_months = item.active_months,
      r.first_seen = item.first_seen,
      r.last_seen = item.last_seen,
      r.recency_days = item.recency_days,
      r.recent_commits = item.recent_commits,
      r.prior_commits = item.prior_commits,
      r.trend = item.trend,
      r.confidence = item.confidence,
      r.evidence_quality = item.evidence_quality,
      r.activity_json = item.activity_json,
      r.updated_at = item.updated_at
    `,
    asQueryParams(rows),
  );

  // Skills no longer supported by current evidence must disappear.
  await graph.query(
    `
    MATCH (d:Developer {id: $developer_id})-[r:HAS_SKILL]->(:Skill)
    WHERE r.updated_at IS NULL OR r.updated_at <> $updated_at
    DELETE r
    `,
    { params: { developer_id: developerId, updated_at: updatedAt } },
  );
}

export async function storeSkillUsage(
  graph: Graph,
  aggregates: Map<string, SkillAggregate>,
  updatedAt: string,
): Promise<void> {
  const rows: QueryParamObject[] = [];

  for (const agg of aggregates.values()) {
    for (const [repositoryId, usage] of agg.repoUsage) {
      rows.push({
        skill_id: agg.skillId,
        repository_id: repositoryId,
        files: usage.files.size,
        commits: usage.commits.size,
        lines: usage.lines,
        last_seen: usage.lastTs ? new Date(usage.lastTs).toISOString() : "",
        updated_at: updatedAt,
      });
    }
  }

  await runBatches(
    graph,
    "skill USED_IN edges",
    `
    UNWIND $batch AS item
    MATCH (s:Skill {id: item.skill_id})
    MATCH (r:Repository {id: item.repository_id})
    MERGE (s)-[u:USED_IN]->(r)
    SET u.files = item.files,
        u.commits = item.commits,
        u.lines = item.lines,
        u.last_seen = item.last_seen,
        u.updated_at = item.updated_at
    `,
    rows,
  );

  await graph.query(
    `
    MATCH (:Skill)-[u:USED_IN]->(:Repository)
    WHERE u.updated_at IS NULL OR u.updated_at <> $updated_at
    DELETE u
    `,
    { params: { updated_at: updatedAt } },
  );
}

export async function storeCoOccurrence(
  graph: Graph,
  edges: CoOccurrence[],
  updatedAt: string,
): Promise<void> {
  await runBatches(
    graph,
    "skill CO_OCCURS edges",
    `
    UNWIND $batch AS item
    MATCH (a:Skill {id: item.a})
    MATCH (b:Skill {id: item.b})
    MERGE (a)-[r:CO_OCCURS]->(b)
    SET r.commits = item.commits,
        r.affinity = item.affinity,
        r.updated_at = item.updated_at
    `,
    asQueryParams(edges.map((edge) => ({ ...edge, updated_at: updatedAt }))),
  );

  await graph.query(
    `
    MATCH (:Skill)-[r:CO_OCCURS]->(:Skill)
    WHERE r.updated_at IS NULL OR r.updated_at <> $updated_at
    DELETE r
    `,
    { params: { updated_at: updatedAt } },
  );
}
}
