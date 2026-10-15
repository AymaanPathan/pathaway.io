import type { Graph } from "../../db/falkordb.js";




import { Domain as _constants } from './constants.js';
import { Domain as _helpers } from './helpers.js';
import { Domain as _queries } from './queries.js';
import { Domain as _types } from './types.js';
import { Domain as _writers } from './writers.js';

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
import ensureSkillIndexes = _writers.ensureSkillIndexes;
import storeSkillCategories = _writers.storeSkillCategories;
import storeSkillDefinitions = _writers.storeSkillDefinitions;
import storeDeveloperSkills = _writers.storeDeveloperSkills;
import storeSkillUsage = _writers.storeSkillUsage;
import storeCoOccurrence = _writers.storeCoOccurrence;

export const FETCH_PAGE_SIZE = Math.max(
  100,
  Number(process.env.SKILL_AGENT_PAGE_SIZE ?? 1000),
);

export async function fetchFileChangeEvidence(
  graph: Graph,
  developerId: string,
  onProgress: ProgressFn,
): Promise<FileChangeEvidenceRow[]> {
  const rows: FileChangeEvidenceRow[] = [];
  let skip = 0;
  let page = 0;

  const startedAt = nowMs();
  log("fetching FileChange evidence — start", {
    developerId,
    pageSize: FETCH_PAGE_SIZE,
  });

  while (true) {
    const pageStartedAt = nowMs();

    const result = await graph.query(
      `
      MATCH (d:Developer {id: $developer_id})-[:AUTHORED_CODE]->(fc:FileChange)
      RETURN
        fc.id AS id,
        fc.path AS path,
        fc.language AS language,
        fc.added_code AS added_code,
        fc.additions AS additions,
        fc.deletions AS deletions,
        fc.commit_sha AS commit_sha,
        fc.repository_id AS repository_id,
        fc.created_at AS created_at
      ORDER BY fc.id
      SKIP ${skip}
      LIMIT ${FETCH_PAGE_SIZE}
      `,
      { params: { developer_id: developerId } },
    );

    const pageRows = (result.data ?? []) as AnyObject[];
    page += 1;

    for (const row of pageRows) {
      rows.push({
        id: safeString(row.id),
        path: safeString(row.path),
        language: safeString(row.language),
        added_code: safeString(row.added_code).slice(0, MAX_CODE_SCAN_CHARS),
        additions: safeNumber(row.additions),
        deletions: safeNumber(row.deletions),
        commit_sha: safeString(row.commit_sha),
        repository_id: safeString(row.repository_id),
        created_at: safeString(row.created_at),
      });
    }

    log(`evidence page ${page} fetched`, {
      pageRows: pageRows.length,
      totalSoFar: rows.length,
      pageDurationMs: elapsedMs(pageStartedAt),
    });

    onProgress("skill_evidence_page", { fetched: rows.length });

    if (pageRows.length < FETCH_PAGE_SIZE) {
      break;
    }

    skip += FETCH_PAGE_SIZE;
  }

  log("fetching FileChange evidence — done", {
    developerId,
    totalRows: rows.length,
    pages: page,
    durationMs: elapsedMs(startedAt),
  });

  return rows;
}

export function isNoiseFile(path: string): boolean {
  return NOISE_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

export function buildSkillProfile(
  aggregates: Map<string, SkillAggregate>,
): SkillProfileEntry[] {
  const startedAt = nowMs();
  log("scoring skill profile — start", { skillsToScore: aggregates.size });

  const now = Date.now();
  const entries: SkillProfileEntry[] = [];

  for (const agg of aggregates.values()) {
    const def = DEF_BY_ID.get(agg.skillId);
    if (!def) {
      log("skipping aggregate for unknown skill id (not in taxonomy)", {
        skillId: agg.skillId,
      });
      continue;
    }

    const category = CATEGORY_BY_ID.get(def.category);
    const { score, quality } = computeDepth(agg);
    const activity = activitySeries(agg);

    entries.push({
      skillId: def.id,
      skillName: def.name,
      categoryId: def.category,
      categoryName: category?.name ?? def.category,
      depthScore: score,
      level: levelForScore(score),
      filesTouched: agg.filePaths.size,
      strongFiles: agg.strongFilePaths.size,
      commitsCount: agg.commitShas.size,
      reposCount: agg.repositoryIds.size,
      linesAdded: agg.linesAdded,
      linesDeleted: agg.linesDeleted,
      activeDays: agg.activeDayKeys.size,
      activeMonths: agg.monthCommits.size,
      firstSeen: Number.isFinite(agg.firstSeenTs)
        ? new Date(agg.firstSeenTs).toISOString()
        : "",
      lastSeen: agg.lastSeenTs ? new Date(agg.lastSeenTs).toISOString() : "",
      recencyDays: agg.lastSeenTs
        ? Math.max(0, Math.round((now - agg.lastSeenTs) / DAY_MS))
        : -1,
      recentCommits: agg.recentShas.size,
      priorCommits: agg.priorShas.size,
      trend: computeTrend(agg, now),
      confidence: computeConfidence(agg),
      evidenceQuality: quality,
      activity,
    });
  }

  entries.sort((a, b) => b.depthScore - a.depthScore);

  log("scoring skill profile — done", {
    skillsScored: entries.length,
    durationMs: elapsedMs(startedAt),
    topSkills: entries.slice(0, 10).map((e) => ({
      skillId: e.skillId,
      depthScore: e.depthScore,
      level: e.level,
      trend: e.trend,
      confidence: e.confidence,
    })),
  });

  return entries;
}

export async function getDeveloperSkillProfile(
  graph: Graph,
  developerId: string,
): Promise<CategorySkillGroup[]> {
  const result = await graph.query(
    `
    MATCH (d:Developer {id: $developer_id})-[r:HAS_SKILL]->(s:Skill)<-[:CONTAINS]-(c:SkillCategory)
    RETURN
      c.id AS category_id,
      c.name AS category_name,
      s.id AS skill_id,
      s.name AS skill_name,
      r.depth_score AS depth_score,
      r.level AS level,
      r.files_touched AS files_touched,
      r.strong_files AS strong_files,
      r.commits_count AS commits_count,
      r.repos_count AS repos_count,
      r.lines_added AS lines_added,
      r.lines_deleted AS lines_deleted,
      r.active_days AS active_days,
      r.first_seen AS first_seen,
      r.last_seen AS last_seen,
      r.recency_days AS recency_days,
      r.trend AS trend,
      r.confidence AS confidence,
      r.evidence_quality AS evidence_quality,
      r.activity_json AS activity_json
    ORDER BY c.name, r.depth_score DESC
    `,
    { params: { developer_id: developerId } },
  );

  const rows = (result.data ?? []) as AnyObject[];

  const groups = new Map<string, CategorySkillGroup>();

  for (const row of rows) {
    const categoryId = safeString(row.category_id);

    let group = groups.get(categoryId);
    if (!group) {
      group = {
        categoryId,
        categoryName: safeString(row.category_name),
        categoryScore: 0,
        skills: [],
      };
      groups.set(categoryId, group);
    }

    group.skills.push({
      skillId: safeString(row.skill_id),
      skillName: safeString(row.skill_name),
      depthScore: safeNumber(row.depth_score),
      level: (safeString(row.level) || "novice") as SkillLevel,
      filesTouched: safeNumber(row.files_touched),
      strongFiles: safeNumber(row.strong_files),
      commitsCount: safeNumber(row.commits_count),
      reposCount: safeNumber(row.repos_count),
      linesAdded: safeNumber(row.lines_added),
      linesDeleted: safeNumber(row.lines_deleted),
      activeDays: safeNumber(row.active_days),
      firstSeen: safeString(row.first_seen),
      lastSeen: safeString(row.last_seen),
      recencyDays: row.recency_days == null ? -1 : safeNumber(row.recency_days),
      trend: (safeString(row.trend) || "steady") as SkillTrend,
      confidence: (safeString(row.confidence) || "low") as SkillConfidence,
      evidenceQuality: safeNumber(row.evidence_quality),
      activity: parseActivity(row.activity_json),
    });
  }

  for (const group of groups.values()) {
    const top = group.skills
      .map((s) => s.depthScore)
      .sort((a, b) => b - a)
      .slice(0, 3);
    group.categoryScore = top.length
      ? Math.round(top.reduce((sum, v) => sum + v, 0) / top.length)
      : 0;
  }

  return Array.from(groups.values());
}

export async function getSkillGraph(
  graph: Graph,
  developerId: string,
  options: { includeRepositories?: boolean } = {},
): Promise<SkillGraphView> {
  const params = { developer_id: developerId };

  const [skillRes, coRes, impliesRes, repoRes] = await Promise.all([
    graph.query(
      `
      MATCH (d:Developer {id: $developer_id})-[r:HAS_SKILL]->(s:Skill)<-[:CONTAINS]-(c:SkillCategory)
      RETURN s.id AS id, s.name AS name, c.id AS category_id, c.name AS category_name,
             r.depth_score AS score, r.level AS level, r.trend AS trend,
             r.confidence AS confidence, r.commits_count AS commits
      `,
      { params },
    ),
    graph.query(
      `
      MATCH (d:Developer {id: $developer_id})-[:HAS_SKILL]->(a:Skill),
            (d)-[:HAS_SKILL]->(b:Skill),
            (a)-[r:CO_OCCURS]->(b)
      RETURN a.id AS a, b.id AS b, r.commits AS commits, r.affinity AS affinity
      `,
      { params },
    ),
    graph.query(
      `
      MATCH (d:Developer {id: $developer_id})-[:HAS_SKILL]->(a:Skill),
            (d)-[:HAS_SKILL]->(b:Skill),
            (a)-[:IMPLIES]->(b)
      RETURN a.id AS a, b.id AS b
      `,
      { params },
    ),
    options.includeRepositories
      ? graph.query(
          `
          MATCH (d:Developer {id: $developer_id})-[:HAS_SKILL]->(s:Skill)-[u:USED_IN]->(r:Repository)
          RETURN s.id AS skill_id, r.id AS repository_id,
                 coalesce(r.full_name, r.name, "") AS name,
                 u.files AS files, u.commits AS commits
          ORDER BY u.commits DESC
          LIMIT 120
          `,
          { params },
        )
      : Promise.resolve({ data: [] as AnyObject[] }),
  ]);

  const nodes = new Map<string, SkillGraphNode>();
  const edges: SkillGraphEdge[] = [];

  for (const row of (skillRes.data ?? []) as AnyObject[]) {
    const categoryId = safeString(row.category_id);
    const categoryNodeId = `category:${categoryId}`;
    const skillNodeId = `skill:${safeString(row.id)}`;

    if (!nodes.has(categoryNodeId)) {
      nodes.set(categoryNodeId, {
        id: categoryNodeId,
        type: "category",
        label: safeString(row.category_name),
        categoryId,
      });
    }

    nodes.set(skillNodeId, {
      id: skillNodeId,
      type: "skill",
      label: safeString(row.name),
      categoryId,
      score: safeNumber(row.score),
      level: (safeString(row.level) || "novice") as SkillLevel,
      trend: (safeString(row.trend) || "steady") as SkillTrend,
      confidence: (safeString(row.confidence) || "low") as SkillConfidence,
      commits: safeNumber(row.commits),
    });

    edges.push({
      source: categoryNodeId,
      target: skillNodeId,
      type: "contains",
      weight: 1,
    });
  }

  for (const row of (coRes.data ?? []) as AnyObject[]) {
    edges.push({
      source: `skill:${safeString(row.a)}`,
      target: `skill:${safeString(row.b)}`,
      type: "co_occurs",
      weight: safeNumber(row.affinity) || 0.1,
    });
  }

  for (const row of (impliesRes.data ?? []) as AnyObject[]) {
    edges.push({
      source: `skill:${safeString(row.a)}`,
      target: `skill:${safeString(row.b)}`,
      type: "implies",
      weight: 0.5,
    });
  }

  for (const row of (repoRes.data ?? []) as AnyObject[]) {
    const repoNodeId = `repo:${safeString(row.repository_id)}`;
    if (!nodes.has(repoNodeId)) {
      nodes.set(repoNodeId, {
        id: repoNodeId,
        type: "repository",
        label: safeString(row.name),
      });
    }
    edges.push({
      source: `skill:${safeString(row.skill_id)}`,
      target: repoNodeId,
      type: "used_in",
      weight: safeNumber(row.commits),
    });
  }

  return { nodes: [...nodes.values()], edges };
}

export function buildSkillInsights(
  groups: CategorySkillGroup[],
): SkillInsights {
  const all: InsightSkill[] = groups.flatMap((group) =>
    group.skills.map((s) => ({
      skillId: s.skillId,
      skillName: s.skillName,
      categoryName: group.categoryName,
      depthScore: s.depthScore,
      level: s.level,
      trend: s.trend,
      confidence: s.confidence,
    })),
  );

  const byScore = [...all].sort((a, b) => b.depthScore - a.depthScore);
  const have = new Set(all.map((s) => s.skillId));

  // "What next": skills adjacent to things the developer is already
  // proficient at, but which never show up in their code.
  const adjacency = new Map<string, Set<string>>();
  for (const skill of all) {
    if (skill.depthScore < 36) continue;
    for (const relatedId of DEF_BY_ID.get(skill.skillId)?.related ?? []) {
      if (have.has(relatedId)) continue;
      const set = adjacency.get(relatedId) ?? new Set<string>();
      set.add(skill.skillName);
      adjacency.set(relatedId, set);
    }
  }

  const adjacent = [...adjacency.entries()]
    .map(([skillId, because]) => {
      const def = DEF_BY_ID.get(skillId);
      return {
        skillId,
        skillName: def?.name ?? skillId,
        categoryName: CATEGORY_BY_ID.get(def?.category ?? "")?.name ?? "",
        because: [...because].slice(0, 4),
      };
    })
    .sort((a, b) => b.because.length - a.because.length)
    .slice(0, 8);

  const categoryBalance = groups
    .map((g) => ({
      categoryId: g.categoryId,
      categoryName: g.categoryName,
      score: g.categoryScore,
      skills: g.skills.length,
    }))
    .sort((a, b) => b.score - a.score);

  const freshest = [...all]
    .filter((s) => s.trend === "rising" || s.trend === "steady")
    .sort((a, b) => b.depthScore - a.depthScore)[0];

  return {
    headline: {
      totalSkills: all.length,
      advancedOrExpert: all.filter(
        (s) => s.level === "advanced" || s.level === "expert",
      ).length,
      averageScore: all.length
        ? Math.round(all.reduce((sum, s) => sum + s.depthScore, 0) / all.length)
        : 0,
      strongestCategory: categoryBalance[0]?.categoryName ?? "",
      freshestSkill: freshest?.skillName ?? "",
    },
    strengths: byScore
      .filter((s) => s.confidence !== "low" && s.depthScore >= 36)
      .slice(0, 6),
    rising: byScore.filter((s) => s.trend === "rising").slice(0, 6),
    cooling: byScore
      .filter(
        (s) =>
          (s.trend === "cooling" || s.trend === "dormant") &&
          s.depthScore >= 36,
      )
      .slice(0, 6),
    thinEvidence: byScore
      .filter((s) => s.confidence === "low" && s.depthScore >= 16)
      .slice(0, 6),
    adjacent,
    categoryBalance,
  };
}

export async function getSkillInsights(
  graph: Graph,
  developerId: string,
): Promise<SkillInsights> {
  return buildSkillInsights(await getDeveloperSkillProfile(graph, developerId));
}

export async function fetchStoredSkillMetrics(
  graph: Graph,
  developerId: string,
  skillId: string,
): Promise<AnyObject | null> {
  const result = await graph.query(
    `
    MATCH (d:Developer {id: $developer_id})-[r:HAS_SKILL]->(s:Skill {id: $skill_id})
    MATCH (c:SkillCategory)-[:CONTAINS]->(s)
    RETURN
      s.id AS skill_id,
      s.name AS skill_name,
      c.id AS category_id,
      c.name AS category_name,
      r.depth_score AS depth_score,
      r.level AS level,
      r.files_touched AS files_touched,
      r.strong_files AS strong_files,
      r.commits_count AS commits_count,
      r.repos_count AS repos_count,
      r.lines_added AS lines_added,
      r.lines_deleted AS lines_deleted,
      r.active_days AS active_days,
      r.first_seen AS first_seen,
      r.last_seen AS last_seen,
      r.recency_days AS recency_days,
      r.recent_commits AS recent_commits,
      r.prior_commits AS prior_commits,
      r.trend AS trend,
      r.confidence AS confidence,
      r.evidence_quality AS evidence_quality,
      r.activity_json AS activity_json
    `,
    { params: { developer_id: developerId, skill_id: skillId } },
  );

  const rows = (result.data ?? []) as AnyObject[];
  return rows[0] ?? null;
}

export async function fetchRepositoryNames(
  graph: Graph,
  ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;

  try {
    const result = await graph.query(
      `
      MATCH (r:Repository)
      WHERE r.id IN $ids
      RETURN r.id AS id, coalesce(r.full_name, r.name, "") AS name
      `,
      { params: { ids } },
    );
    for (const row of (result.data ?? []) as AnyObject[]) {
      out.set(safeString(row.id), safeString(row.name));
    }
  } catch (error) {
    logError("repository name lookup failed", error);
  }
  return out;
}

export async function fetchCoOccurring(
  graph: Graph,
  developerId: string,
  skillId: string,
): Promise<SkillDetail["related"]> {
  try {
    const result = await graph.query(
      `
      MATCH (d:Developer {id: $developer_id})-[:HAS_SKILL]->(s:Skill {id: $skill_id}),
            (d)-[:HAS_SKILL]->(o:Skill),
            (s)-[r:CO_OCCURS]-(o)
      RETURN o.id AS id, o.name AS name, r.commits AS commits, r.affinity AS affinity
      ORDER BY r.commits DESC
      LIMIT 8
      `,
      { params: { developer_id: developerId, skill_id: skillId } },
    );
    return ((result.data ?? []) as AnyObject[]).map((row) => ({
      skillId: safeString(row.id),
      skillName: safeString(row.name),
      commits: safeNumber(row.commits),
      affinity: safeNumber(row.affinity),
    }));
  } catch (error) {
    logError("co-occurrence lookup failed", error);
    return [];
  }
}

export async function fetchOwnedSkillIds(
  graph: Graph,
  developerId: string,
): Promise<Set<string>> {
  try {
    const result = await graph.query(
      `MATCH (:Developer {id: $developer_id})-[:HAS_SKILL]->(s:Skill) RETURN s.id AS id`,
      { params: { developer_id: developerId } },
    );
    return new Set(
      ((result.data ?? []) as AnyObject[]).map((row) => safeString(row.id)),
    );
  } catch (error) {
    logError("owned skills lookup failed", error);
    return new Set();
  }
}

export async function getSkillDetail(
  graph: Graph,
  developerId: string,
  skillId: string,
  proofLimit = 8,
): Promise<SkillDetail | null> {
  const def = DEF_BY_ID.get(skillId);
  if (!def) {
    log("getSkillDetail: unknown skillId (not in taxonomy)", { skillId });
    return null;
  }

  const metrics = await fetchStoredSkillMetrics(graph, developerId, skillId);
  if (!metrics) {
    log("getSkillDetail: no HAS_SKILL edge for developer + skill", {
      developerId,
      skillId,
    });
    return null;
  }

  const [rows, related, owned] = await Promise.all([
    fetchFileChangeEvidence(graph, developerId, () => {}),
    fetchCoOccurring(graph, developerId, skillId),
    fetchOwnedSkillIds(graph, developerId),
  ]);

  const matched = rows
    .filter((row) => !isNoiseFile(row.path))
    .map((row) => ({ row, match: classifyRow(row).get(skillId) }))
    .filter(
      (item): item is { row: FileChangeEvidenceRow; match: RowMatch } =>
        item.match !== undefined,
    );

  // Strong, non-implied evidence first, then biggest change.
  const rank = (m: RowMatch) => (m.implied ? 0 : m.strength);
  const lines = (r: FileChangeEvidenceRow) =>
    Math.min(r.additions + r.deletions, MAX_LINES_PER_CHANGE);

  const sorted = [...matched].sort(
    (a, b) => rank(b.match) - rank(a.match) || lines(b.row) - lines(a.row),
  );

  // Diversify: best change per repository first, then fill by rank.
  const picked: typeof sorted = [];
  const usedRepos = new Set<string>();
  const usedPaths = new Set<string>();
  for (const item of sorted) {
    if (picked.length >= proofLimit) break;
    if (usedRepos.has(item.row.repository_id)) continue;
    usedRepos.add(item.row.repository_id);
    usedPaths.add(`${item.row.repository_id}:${item.row.path}`);
    picked.push(item);
  }
  for (const item of sorted) {
    if (picked.length >= proofLimit) break;
    const key = `${item.row.repository_id}:${item.row.path}`;
    if (usedPaths.has(key)) continue;
    usedPaths.add(key);
    picked.push(item);
  }
  picked.sort(
    (a, b) => rank(b.match) - rank(a.match) || lines(b.row) - lines(a.row),
  );

  // Fresh per-repo and per-month breakdown from the same evidence.
  const repoStats = new Map<
    string,
    { files: Set<string>; commits: Set<string>; lines: number }
  >();
  const monthCommits = new Map<string, Set<string>>();
  for (const { row } of matched) {
    const stats = repoStats.get(row.repository_id) ?? {
      files: new Set<string>(),
      commits: new Set<string>(),
      lines: 0,
    };
    stats.files.add(row.path);
    if (row.commit_sha) stats.commits.add(row.commit_sha);
    stats.lines += row.additions + row.deletions;
    repoStats.set(row.repository_id, stats);

    const month = monthKey(row.created_at);
    if (month && row.commit_sha) {
      const set = monthCommits.get(month) ?? new Set<string>();
      set.add(row.commit_sha);
      monthCommits.set(month, set);
    }
  }

  const repoIds = [...repoStats.keys()].filter(Boolean);
  const repoNames = await fetchRepositoryNames(graph, repoIds);

  const repositories = [...repoStats.entries()]
    .map(([repositoryId, stats]) => ({
      repositoryId,
      name: repoNames.get(repositoryId) ?? "",
      files: stats.files.size,
      commits: stats.commits.size,
      lines: stats.lines,
    }))
    .sort((a, b) => b.commits - a.commits || b.lines - a.lines)
    .slice(0, 10);

  const proof: SkillProofItem[] = picked.map(({ row, match }) => {
    const repoName = repoNames.get(row.repository_id) ?? "";
    return {
      path: row.path,
      repositoryId: row.repository_id,
      repositoryName: repoName,
      commitSha: row.commit_sha,
      commitUrl:
        repoName && row.commit_sha
          ? `https://github.com/${repoName}/commit/${row.commit_sha}`
          : "",
      additions: row.additions,
      deletions: row.deletions,
      createdAt: row.created_at,
      strength: match.strength === 2 ? "strong" : "weak",
      implied: match.implied,
    };
  });

  const activity: ActivityPoint[] = [...monthCommits.entries()]
    .map(([month, shas]) => ({ month, count: shas.size }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-24);

  const nextSteps = (def.related ?? [])
    .filter((id) => !owned.has(id))
    .map(skillRef);

  log("getSkillDetail: resolved", {
    developerId,
    skillId,
    proofItems: proof.length,
    repositories: repositories.length,
    related: related.length,
  });

  return {
    skillId: safeString(metrics.skill_id),
    skillName: safeString(metrics.skill_name),
    categoryId: safeString(metrics.category_id),
    categoryName: safeString(metrics.category_name),
    depthScore: safeNumber(metrics.depth_score),
    level: (safeString(metrics.level) || "novice") as SkillLevel,
    filesTouched: safeNumber(metrics.files_touched),
    strongFiles: safeNumber(metrics.strong_files),
    commitsCount: safeNumber(metrics.commits_count),
    reposCount: safeNumber(metrics.repos_count),
    linesAdded: safeNumber(metrics.lines_added),
    linesDeleted: safeNumber(metrics.lines_deleted),
    activeDays: safeNumber(metrics.active_days),
    firstSeen: safeString(metrics.first_seen),
    lastSeen: safeString(metrics.last_seen),
    recencyDays:
      metrics.recency_days == null ? -1 : safeNumber(metrics.recency_days),
    recentCommits: safeNumber(metrics.recent_commits),
    priorCommits: safeNumber(metrics.prior_commits),
    trend: (safeString(metrics.trend) || "steady") as SkillTrend,
    confidence: (safeString(metrics.confidence) || "low") as SkillConfidence,
    evidenceQuality: safeNumber(metrics.evidence_quality),
    activity: activity.length ? activity : parseActivity(metrics.activity_json),
    repositories,
    related,
    implies: (def.implies ?? []).map(skillRef),
    impliedBy: (IMPLIED_BY.get(skillId) ?? []).map(skillRef),
    nextSteps,
    proof,
  };
}
}
