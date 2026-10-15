import type { Graph } from "../../db/falkordb.js";




import { Domain as _constants } from './constants.js';
import { Domain as _queries } from './queries.js';
import { Domain as _readers } from './readers.js';
import { Domain as _types } from './types.js';
import { Domain as _writers } from './writers.js';

export namespace Domain {
import LOG_PREFIX = _constants.LOG_PREFIX;
import SKILL_CATEGORIES = _constants.SKILL_CATEGORIES;
import DB_BATCH_SIZE = _constants.DB_BATCH_SIZE;
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
import ensureSkillIndexes = _writers.ensureSkillIndexes;
import storeSkillCategories = _writers.storeSkillCategories;
import storeSkillDefinitions = _writers.storeSkillDefinitions;
import storeDeveloperSkills = _writers.storeDeveloperSkills;
import storeSkillUsage = _writers.storeSkillUsage;
import storeCoOccurrence = _writers.storeCoOccurrence;

export function log(message: string, detail?: AnyObject): void {
  if (detail !== undefined) {
    console.log(`${LOG_PREFIX} ${message}`, detail);
  } else {
    console.log(`${LOG_PREFIX} ${message}`);
  }
}

export function logError(message: string, error: unknown): void {
  console.error(`${LOG_PREFIX} ${message}`, error);
}

export function nowMs(): number {
  return Date.now();
}

export function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

export function language(
  id: string,
  name: string,
  ...langs: string[]
): SkillDefinition {
  return {
    id,
    name,
    category: "languages",
    matchLanguages: langs,
    strongLanguage: true,
  };
}

export const IMPLIES: Record<string, string[]> = {
  nextjs: ["react"],
  react_native: ["react"],
  r3f: ["react", "threejs"],
  express: ["nodejs"],
  fastify: ["nodejs"],
  nestjs: ["nodejs"],
  bullmq: ["redis", "nodejs"],
  trpc: ["typescript"],
  falkordb: ["cypher"],
  tailwind: ["css"],
  langgraph: ["langchain"],
  go_backend: ["go"],
  flutter: ["dart"],
  ios_native: ["swift"],
};

export const RELATED: Record<string, string[]> = {
  typescript: ["nodejs", "react", "zod", "testing"],
  javascript: ["typescript", "nodejs", "react"],
  python: ["fastapi", "ml_frameworks", "testing"],
  react: [
    "nextjs",
    "redux",
    "react_query",
    "tailwind",
    "vite",
    "framer_motion",
  ],
  nextjs: ["react", "tailwind", "react_query", "auth"],
  tailwind: ["react", "css", "framer_motion"],
  redux: ["react", "react_query"],
  react_query: ["react", "rest_api"],
  nodejs: ["express", "fastify", "nestjs", "bullmq", "docker"],
  express: ["zod", "auth", "rest_api", "testing", "redis"],
  fastify: ["zod", "rest_api", "opentelemetry"],
  nestjs: ["typescript", "postgres", "auth", "testing"],
  rest_api: ["zod", "auth", "testing", "websockets"],
  graphql: ["typescript", "react_query"],
  trpc: ["zod", "nextjs"],
  zod: ["typescript", "rest_api", "llm_apis"],
  auth: ["rest_api", "zod", "redis"],
  websockets: ["redis", "react", "rest_api"],
  bullmq: ["redis", "opentelemetry", "message_brokers"],
  message_brokers: ["bullmq", "docker", "opentelemetry"],
  postgres: ["prisma", "sql", "redis", "drizzle"],
  prisma: ["postgres", "typescript", "zod"],
  drizzle: ["postgres", "typescript"],
  mongodb: ["nodejs", "express"],
  redis: ["bullmq", "postgres", "websockets"],
  sql: ["postgres", "prisma"],
  falkordb: ["cypher", "redis", "llm_apis"],
  cypher: ["falkordb"],
  llm_apis: [
    "langgraph",
    "ai_agents",
    "vector_search",
    "prompt_engineering",
    "mcp",
    "zod",
  ],
  langchain: ["langgraph", "llm_apis", "vector_search"],
  langgraph: ["llm_apis", "ai_agents", "opentelemetry", "bullmq"],
  ai_agents: ["langgraph", "llm_apis", "mcp", "opentelemetry"],
  mcp: ["llm_apis", "ai_agents", "typescript"],
  prompt_engineering: ["llm_apis", "ai_agents"],
  vector_search: ["llm_apis", "postgres"],
  docker: ["kubernetes", "ci_cd", "terraform", "aws"],
  kubernetes: ["docker", "terraform", "opentelemetry"],
  ci_cd: ["docker", "testing", "terraform"],
  terraform: ["aws", "kubernetes"],
  aws: ["terraform", "docker", "kubernetes"],
  opentelemetry: ["monitoring", "docker", "kubernetes", "bullmq"],
  monitoring: ["opentelemetry"],
  testing: ["e2e_testing", "ci_cd"],
  e2e_testing: ["testing", "ci_cd"],
  vite: ["react", "typescript"],
  monorepo: ["vite", "ci_cd"],
  threejs: ["r3f", "shaders", "webgl"],
  r3f: ["threejs", "shaders", "react", "framer_motion"],
  d3: ["react", "webgl"],
  webgl: ["threejs", "shaders"],
  shaders: ["threejs", "webgl", "r3f"],
  react_native: ["react", "typescript"],
  solidity: ["web3"],
  web3: ["solidity", "react"],
};

for (const def of SKILL_TAXONOMY) {
  def.implies = IMPLIES[def.id] ?? [];
  def.related = RELATED[def.id] ?? [];
}

export const DEF_BY_ID = new Map(SKILL_TAXONOMY.map((def) => [def.id, def]));

export const CATEGORY_BY_ID = new Map(SKILL_CATEGORIES.map((cat) => [cat.id, cat]));

export const IMPLIED_BY = new Map<string, string[]>();

for (const def of SKILL_TAXONOMY) {
  for (const target of def.implies ?? []) {
    const list = IMPLIED_BY.get(target) ?? [];
    list.push(def.id);
    IMPLIED_BY.set(target, list);
  }
}

(function validateTaxonomy(): void {
  const seen = new Set<string>();
  for (const def of SKILL_TAXONOMY) {
    if (seen.has(def.id)) log("taxonomy: duplicate skill id", { id: def.id });
    seen.add(def.id);
    if (!CATEGORY_BY_ID.has(def.category)) {
      log("taxonomy: unknown category", { id: def.id, category: def.category });
    }
    for (const ref of [...(def.implies ?? []), ...(def.related ?? [])]) {
      if (!DEF_BY_ID.has(ref)) {
        log("taxonomy: reference to unknown skill", { id: def.id, ref });
      }
    }
  }
  for (const key of [...Object.keys(IMPLIES), ...Object.keys(RELATED)]) {
    if (!DEF_BY_ID.has(key)) log("taxonomy: map key is not a skill", { key });
  }
})();

export const DAY_MS = 24 * 60 * 60 * 1000;

export const SCORE_WEIGHTS = {
  volume: 24, 
  breadth: 22, 
  commits: 20, 
  repos: 10, 
  sustained: 24, 
};

export const BREADTH_CAP_FILES = 40;

export const COMMITS_CAP = 80;

export const REPOS_CAP = 6;

export const SUSTAIN_DAYS_CAP = 30;

export const SUSTAIN_SPAN_CAP_DAYS = 180;

export const WEAK_WEIGHT = 0.35;

export const MAX_LINES_PER_CHANGE = 1200;

export const MAX_CODE_SCAN_CHARS = 40_000;

export const RECENT_WINDOW_DAYS = 90;

export const DORMANT_AFTER_DAYS = 270;

export const MIN_COOCCURRENCE = 2;

export const MAX_COOCCURRENCE_EDGES = 400;

export const ACTIVITY_MONTHS = 18;

export function levelForScore(score: number): SkillLevel {
  if (score >= 81) return "expert";
  if (score >= 61) return "advanced";
  if (score >= 36) return "proficient";
  if (score >= 16) return "familiar";
  return "novice";
}

export function safeString(value: unknown): string {
  return value == null ? "" : String(value);
}

export function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function asQueryParams<T extends object>(items: T[]): QueryParamObject[] {
  return items.map((item) => {
    const params: QueryParamObject = {};
    for (const [key, value] of Object.entries(item)) {
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        params[key] = value;
      } else {
        throw new TypeError(
          `Unsupported FalkorDB query parameter for "${key}": ${typeof value}`,
        );
      }
    }
    return params;
  });
}

export const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertSafeIdentifier(value: string): string {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(
      `Refusing to interpolate unsafe identifier into Cypher: "${value}"`,
    );
  }
  return value;
}

export function dayKey(iso: string): string | null {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString().slice(0, 10);
}

export function monthKey(iso: string): string | null {
  const key = dayKey(iso);
  return key ? key.slice(0, 7) : null;
}

export async function runBatches(
  graph: Graph,
  label: string,
  query: string,
  rows: QueryParamObject[],
): Promise<void> {
  if (rows.length === 0) return;
  const batches = chunkArray(rows, DB_BATCH_SIZE);
  const startedAt = nowMs();
  for (const batch of batches) {
    await graph.query(query, { params: { batch } });
  }
  log(`${label} written`, {
    rows: rows.length,
    batches: batches.length,
    durationMs: elapsedMs(startedAt),
  });
}

export const SKILL_INDEXES: Array<{ label: string; property: string }> = [
  { label: "Skill", property: "id" },
  { label: "SkillCategory", property: "id" },
];

export const NOISE_PATH_PATTERNS: RegExp[] = [
  /(^|\/)(node_modules|vendor|\.next|\.nuxt|\.turbo|\.cache|__pycache__)\//,
  /^(dist|build|out|target|coverage)\//,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|Pipfile\.lock|Gemfile\.lock|composer\.lock|go\.sum)$/,
  /\.(min\.(js|css)|map|snap|lock|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|pdf|mp4|zip)$/i,
  /\.d\.ts$/,
  /(^|\/)__generated__\//,
  /\.generated\./,
];

export function skillSignal(
  def: SkillDefinition,
  row: SkillEvidenceLike,
): SignalStrength {
  if (def.pathPatterns?.some((pattern) => pattern.test(row.path))) return 2;

  if (
    row.added_code &&
    def.codePatterns?.some((pattern) => pattern.test(row.added_code))
  ) {
    return 2;
  }

  if (def.matchLanguages?.length && def.matchLanguages.includes(row.language)) {
    return def.strongLanguage ? 2 : 1;
  }

  if (def.hintPathPatterns?.some((pattern) => pattern.test(row.path))) return 1;

  return 0;
}

export function matchesSkill(
  def: SkillDefinition,
  row: SkillEvidenceLike,
): boolean {
  return skillSignal(def, row) > 0;
}

export function classifyRow(row: SkillEvidenceLike): Map<string, RowMatch> {
  const matches = new Map<string, RowMatch>();

  for (const def of SKILL_TAXONOMY) {
    const strength = skillSignal(def, row);
    if (strength > 0) {
      matches.set(def.id, { strength: strength as 1 | 2, implied: false });
    }
  }

  for (const [id, match] of [...matches]) {
    if (match.strength !== 2) continue;
    for (const target of DEF_BY_ID.get(id)?.implies ?? []) {
      if (!matches.has(target)) {
        matches.set(target, { strength: 1, implied: true });
      }
    }
  }

  return matches;
}

export function newAggregate(skillId: string): SkillAggregate {
  return {
    skillId,
    filePaths: new Set(),
    strongFilePaths: new Set(),
    commitShas: new Set(),
    recentShas: new Set(),
    priorShas: new Set(),
    repositoryIds: new Set(),
    activeDayKeys: new Set(),
    monthCommits: new Map(),
    repoUsage: new Map(),
    linesAdded: 0,
    linesDeleted: 0,
    weightedLines: 0,
    firstSeenTs: Number.POSITIVE_INFINITY,
    lastSeenTs: 0,
  };
}

export function addToAggregate(
  agg: SkillAggregate,
  row: FileChangeEvidenceRow,
  match: RowMatch,
  now: number,
): void {
  const lines = row.additions + row.deletions;
  const cappedLines = Math.min(lines, MAX_LINES_PER_CHANGE);
  const weight = match.strength === 2 ? 1 : WEAK_WEIGHT;

  agg.filePaths.add(row.path);
  if (match.strength === 2) agg.strongFilePaths.add(row.path);

  agg.linesAdded += row.additions;
  agg.linesDeleted += row.deletions;
  agg.weightedLines += cappedLines * weight;

  if (row.commit_sha) agg.commitShas.add(row.commit_sha);
  if (row.repository_id) agg.repositoryIds.add(row.repository_id);

  const ts = new Date(row.created_at).getTime();
  if (Number.isFinite(ts)) {
    agg.firstSeenTs = Math.min(agg.firstSeenTs, ts);
    agg.lastSeenTs = Math.max(agg.lastSeenTs, ts);

    const ageDays = (now - ts) / DAY_MS;
    if (row.commit_sha) {
      if (ageDays <= RECENT_WINDOW_DAYS) agg.recentShas.add(row.commit_sha);
      else if (ageDays <= RECENT_WINDOW_DAYS * 2) {
        agg.priorShas.add(row.commit_sha);
      }
    }
  }

  const day = dayKey(row.created_at);
  if (day) agg.activeDayKeys.add(day);

  const month = monthKey(row.created_at);
  if (month && row.commit_sha) {
    let set = agg.monthCommits.get(month);
    if (!set) {
      set = new Set();
      agg.monthCommits.set(month, set);
    }
    set.add(row.commit_sha);
  }

  if (row.repository_id) {
    let usage = agg.repoUsage.get(row.repository_id);
    if (!usage) {
      usage = { files: new Set(), commits: new Set(), lines: 0, lastTs: 0 };
      agg.repoUsage.set(row.repository_id, usage);
    }
    usage.files.add(row.path);
    if (row.commit_sha) usage.commits.add(row.commit_sha);
    usage.lines += lines;
    if (Number.isFinite(ts)) usage.lastTs = Math.max(usage.lastTs, ts);
  }
}

export function classifyEvidence(rows: FileChangeEvidenceRow[]): ClassificationResult {
  const startedAt = nowMs();
  const now = Date.now();

  log("classifying evidence against taxonomy — start", {
    fileChanges: rows.length,
    taxonomySize: SKILL_TAXONOMY.length,
  });

  const aggregates = new Map<string, SkillAggregate>();
  const commitSkills = new Map<string, Set<string>>();
  let ignoredFiles = 0;
  let unmatchedFiles = 0;
  let matchCount = 0;

  for (const row of rows) {
    if (isNoiseFile(row.path)) {
      ignoredFiles += 1;
      continue;
    }

    const matches = classifyRow(row);
    if (matches.size === 0) {
      unmatchedFiles += 1;
      continue;
    }

    for (const [skillId, match] of matches) {
      matchCount += 1;

      let agg = aggregates.get(skillId);
      if (!agg) {
        agg = newAggregate(skillId);
        aggregates.set(skillId, agg);
      }
      addToAggregate(agg, row, match, now);

      // Co-occurrence only from real (strong, non-implied, non-language)
      // evidence, otherwise every React file "co-occurs" with TypeScript.
      if (
        match.strength === 2 &&
        !match.implied &&
        row.commit_sha &&
        DEF_BY_ID.get(skillId)?.category !== "languages"
      ) {
        let set = commitSkills.get(row.commit_sha);
        if (!set) {
          set = new Set();
          commitSkills.set(row.commit_sha, set);
        }
        set.add(skillId);
      }
    }
  }

  const pairCounts = new Map<string, number>();
  for (const skills of commitSkills.values()) {
    if (skills.size < 2) continue;
    const ids = [...skills].sort();
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const key = `${ids[i]}|${ids[j]}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const coOccurrence: CoOccurrence[] = [];
  for (const [key, commits] of pairCounts) {
    if (commits < MIN_COOCCURRENCE) continue;
    const [a, b] = key.split("|") as [string, string];
    const smaller = Math.min(
      aggregates.get(a)?.commitShas.size ?? commits,
      aggregates.get(b)?.commitShas.size ?? commits,
    );
    coOccurrence.push({
      a,
      b,
      commits,
      affinity: round(Math.min(1, commits / Math.max(smaller, 1))),
    });
  }
  coOccurrence.sort((x, y) => y.commits - x.commits);
  coOccurrence.splice(MAX_COOCCURRENCE_EDGES);

  log("classifying evidence against taxonomy — done", {
    fileChanges: rows.length,
    skillsMatched: aggregates.size,
    totalSkillHits: matchCount,
    ignoredFiles,
    unmatchedFiles,
    coOccurrenceEdges: coOccurrence.length,
    durationMs: elapsedMs(startedAt),
  });

  if (unmatchedFiles > 0) {
    log("some files matched no skill in the taxonomy", {
      unmatchedFiles,
      hint: "extend SKILL_TAXONOMY if these should be recognized",
    });
  }

  return { aggregates, coOccurrence, ignoredFiles, unmatchedFiles };
}

export function computeTrend(agg: SkillAggregate, now: number): SkillTrend {
  const daysSince = agg.lastSeenTs
    ? (now - agg.lastSeenTs) / DAY_MS
    : Number.POSITIVE_INFINITY;
  if (daysSince > DORMANT_AFTER_DAYS) return "dormant";

  const recent = agg.recentShas.size;
  const prior = agg.priorShas.size;

  if (recent === 0) return "cooling";
  if (recent >= 2 && recent >= prior * 1.3) return "rising";
  if (recent * 1.3 < prior) return "cooling";
  return "steady";
}

export function computeConfidence(agg: SkillAggregate): SkillConfidence {
  const strong = agg.strongFilePaths.size;
  const commits = agg.commitShas.size;
  if (strong >= 10 && commits >= 5) return "high";
  if (strong >= 3 || commits >= 3) return "medium";
  return "low";
}

export function computeDepth(agg: SkillAggregate): {
  score: number;
  quality: number;
} {
  const files = agg.filePaths.size;
  const strongFiles = agg.strongFilePaths.size;
  const weakFiles = Math.max(0, files - strongFiles);
  const weightedFiles = strongFiles + WEAK_WEIGHT * weakFiles;

  const volume =
    Math.min(Math.log10(agg.weightedLines + 1) / 4.2, 1) * SCORE_WEIGHTS.volume;

  const breadth =
    Math.sqrt(Math.min(weightedFiles / BREADTH_CAP_FILES, 1)) *
    SCORE_WEIGHTS.breadth;

  const commits =
    Math.sqrt(Math.min(agg.commitShas.size / COMMITS_CAP, 1)) *
    SCORE_WEIGHTS.commits;

  const repos =
    Math.min(agg.repositoryIds.size / REPOS_CAP, 1) * SCORE_WEIGHTS.repos;

  const spanDays = Math.max(
    0,
    Number.isFinite(agg.firstSeenTs)
      ? (agg.lastSeenTs - agg.firstSeenTs) / DAY_MS
      : 0,
  );
  const sustained =
    (0.6 * Math.min(agg.activeDayKeys.size / SUSTAIN_DAYS_CAP, 1) +
      0.4 * Math.min(spanDays / SUSTAIN_SPAN_CAP_DAYS, 1)) *
    SCORE_WEIGHTS.sustained;

  // Evidence quality: a skill proven only by language / path hints
  // can reach at most 60% of its raw score.
  const strongRatio = files > 0 ? strongFiles / files : 0;
  const quality = 0.6 + 0.4 * strongRatio;

  const raw = volume + breadth + commits + repos + sustained;
  const score = Math.max(0, Math.min(100, Math.round(raw * quality)));

  return { score, quality: round(quality) };
}

export function activitySeries(agg: SkillAggregate): ActivityPoint[] {
  return [...agg.monthCommits.entries()]
    .map(([month, shas]) => ({ month, count: shas.size }))
    .sort((x, y) => x.month.localeCompare(y.month))
    .slice(-ACTIVITY_MONTHS);
}

export async function analyzeDeveloperSkills(
  graph: Graph,
  developerId: string,
  onProgress: ProgressFn = () => {},
): Promise<SkillAnalysisResult> {
  if (!developerId) {
    throw new Error("Missing developerId");
  }

  const runStartedAt = nowMs();
  log("=== skill graph build: START ===", { developerId });

  try {
    await ensureSkillIndexes(graph);

    onProgress("skill_analysis_start", { developerId });

    const rows = await fetchFileChangeEvidence(graph, developerId, onProgress);

    onProgress("skill_evidence_loaded", { files: rows.length });

    if (rows.length === 0) {
      log(
        "no FileChange evidence found for developer — skill graph will be empty",
        { developerId },
      );
    }

    const { aggregates, coOccurrence, ignoredFiles } = classifyEvidence(rows);
    const profile = buildSkillProfile(aggregates);

    onProgress("skill_classified", {
      skillsFound: profile.length,
      filesIgnored: ignoredFiles,
    });

    const updatedAt = new Date().toISOString();

    await storeSkillCategories(graph);
    await storeSkillDefinitions(graph);
    await storeDeveloperSkills(graph, developerId, profile, updatedAt);

    onProgress("skill_relationships", { coOccurrence: coOccurrence.length });

    await storeSkillUsage(graph, aggregates, updatedAt);
    await storeCoOccurrence(graph, coOccurrence, updatedAt);

    onProgress("skill_analysis_complete", {
      developerId,
      filesAnalyzed: rows.length - ignoredFiles,
      filesIgnored: ignoredFiles,
      skillsFound: profile.length,
    });

    log("=== skill graph build: COMPLETE ===", {
      developerId,
      filesAnalyzed: rows.length,
      filesIgnored: ignoredFiles,
      skillsFound: profile.length,
      totalDurationMs: elapsedMs(runStartedAt),
      levelBreakdown: profile.reduce<Record<string, number>>((acc, e) => {
        acc[e.level] = (acc[e.level] ?? 0) + 1;
        return acc;
      }, {}),
      trendBreakdown: profile.reduce<Record<string, number>>((acc, e) => {
        acc[e.trend] = (acc[e.trend] ?? 0) + 1;
        return acc;
      }, {}),
    });

    return {
      developerId,
      filesAnalyzed: rows.length - ignoredFiles,
      filesIgnored: ignoredFiles,
      skillsFound: profile.length,
      profile,
    };
  } catch (error) {
    logError("=== skill graph build: FAILED ===", error);
    log("skill graph build failure context", {
      developerId,
      durationMs: elapsedMs(runStartedAt),
    });
    throw error;
  }
}

export function parseActivity(value: unknown): ActivityPoint[] {
  const raw = safeString(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((p) => ({
        month: safeString(p?.month),
        count: safeNumber(p?.count),
      }))
      .filter((p) => /^\d{4}-\d{2}$/.test(p.month));
  } catch {
    return [];
  }
}

export const skillRef = (id: string) => ({
  skillId: id,
  skillName: DEF_BY_ID.get(id)?.name ?? id,
});
}
