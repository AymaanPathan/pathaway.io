import type { Graph } from "../../db/falkordb.js";




import { Domain as _constants } from './constants.js';
import { Domain as _helpers } from './helpers.js';
import { Domain as _queries } from './queries.js';
import { Domain as _readers } from './readers.js';
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
import ensureSkillIndexes = _writers.ensureSkillIndexes;
import storeSkillCategories = _writers.storeSkillCategories;
import storeSkillDefinitions = _writers.storeSkillDefinitions;
import storeDeveloperSkills = _writers.storeDeveloperSkills;
import storeSkillUsage = _writers.storeSkillUsage;
import storeCoOccurrence = _writers.storeCoOccurrence;

export type AnyObject = Record<string, any>;

export type ProgressFn = (stage: string, detail?: AnyObject) => void;

export interface SkillDefinition {
  id: string;
  name: string;
  category: string;
  /** File language(s) (lowercase) that count as evidence. */
  matchLanguages?: string[];
  /** When true, a language match is strong evidence (e.g. TypeScript). */
  strongLanguage?: boolean;
  /** Definitive path patterns (Dockerfile, schema.prisma ...). */
  pathPatterns?: RegExp[];
  /** Weak path hints (.tsx, pages/ ...). */
  hintPathPatterns?: RegExp[];
  /** Patterns run against the added code. Always strong. */
  codePatterns?: RegExp[];
  /** Skills that this skill proves a little of (Next.js -> React). */
  implies?: string[];
  /** Skills that usually sit next to this one. Used for "what next". */
  related?: string[];
}

export interface SkillCategoryDefinition {
  id: string;
  name: string;
}

export type SkillLevel =
  | "novice"
  | "familiar"
  | "proficient"
  | "advanced"
  | "expert";

export type SkillTrend = "rising" | "steady" | "cooling" | "dormant";

export type SkillConfidence = "high" | "medium" | "low";

export type QueryPrimitive = string | number | boolean | null;

export type QueryParamObject = Record<string, QueryPrimitive>;

export interface FileChangeEvidenceRow {
  id: string;
  path: string;
  language: string;
  added_code: string;
  additions: number;
  deletions: number;
  commit_sha: string;
  repository_id: string;
  created_at: string;
}

export interface SkillEvidenceLike {
  path: string;
  language: string;
  added_code: string;
}

export type SignalStrength = 0 | 1 | 2;

export interface RowMatch {
  strength: 1 | 2;
  implied: boolean;
}

export interface RepoUsage {
  files: Set<string>;
  commits: Set<string>;
  lines: number;
  lastTs: number;
}

export interface SkillAggregate {
  skillId: string;
  filePaths: Set<string>;
  strongFilePaths: Set<string>;
  commitShas: Set<string>;
  recentShas: Set<string>;
  priorShas: Set<string>;
  repositoryIds: Set<string>;
  activeDayKeys: Set<string>;
  monthCommits: Map<string, Set<string>>;
  repoUsage: Map<string, RepoUsage>;
  linesAdded: number;
  linesDeleted: number;
  weightedLines: number;
  firstSeenTs: number;
  lastSeenTs: number;
}

export interface CoOccurrence {
  a: string;
  b: string;
  commits: number;
  affinity: number;
}

export interface ClassificationResult {
  aggregates: Map<string, SkillAggregate>;
  coOccurrence: CoOccurrence[];
  ignoredFiles: number;
  unmatchedFiles: number;
}

export interface ActivityPoint {
  month: string;
  count: number;
}

export interface SkillProfileEntry {
  skillId: string;
  skillName: string;
  categoryId: string;
  categoryName: string;
  depthScore: number;
  level: SkillLevel;
  filesTouched: number;
  strongFiles: number;
  commitsCount: number;
  reposCount: number;
  linesAdded: number;
  linesDeleted: number;
  activeDays: number;
  activeMonths: number;
  firstSeen: string;
  lastSeen: string;
  recencyDays: number;
  recentCommits: number;
  priorCommits: number;
  trend: SkillTrend;
  confidence: SkillConfidence;
  evidenceQuality: number;
  activity: ActivityPoint[];
}

export interface SkillAnalysisResult {
  developerId: string;
  filesAnalyzed: number;
  filesIgnored: number;
  skillsFound: number;
  profile: SkillProfileEntry[];
}

export interface CategorySkillGroup {
  categoryId: string;
  categoryName: string;
  /** Mean depth score of the category's top 3 skills. */
  categoryScore: number;
  skills: Array<{
    skillId: string;
    skillName: string;
    depthScore: number;
    level: SkillLevel;
    filesTouched: number;
    strongFiles: number;
    commitsCount: number;
    reposCount: number;
    linesAdded: number;
    linesDeleted: number;
    activeDays: number;
    firstSeen: string;
    lastSeen: string;
    recencyDays: number;
    trend: SkillTrend;
    confidence: SkillConfidence;
    evidenceQuality: number;
    activity: ActivityPoint[];
  }>;
}

export interface SkillGraphNode {
  id: string;
  type: "category" | "skill" | "repository";
  label: string;
  categoryId?: string;
  score?: number;
  level?: SkillLevel;
  trend?: SkillTrend;
  confidence?: SkillConfidence;
  commits?: number;
}

export interface SkillGraphEdge {
  source: string;
  target: string;
  type: "contains" | "co_occurs" | "implies" | "used_in";
  weight: number;
}

export interface SkillGraphView {
  nodes: SkillGraphNode[];
  edges: SkillGraphEdge[];
}

export interface InsightSkill {
  skillId: string;
  skillName: string;
  categoryName: string;
  depthScore: number;
  level: SkillLevel;
  trend: SkillTrend;
  confidence: SkillConfidence;
}

export interface SkillInsights {
  headline: {
    totalSkills: number;
    advancedOrExpert: number;
    averageScore: number;
    strongestCategory: string;
    freshestSkill: string;
  };
  strengths: InsightSkill[];
  rising: InsightSkill[];
  cooling: InsightSkill[];
  thinEvidence: InsightSkill[];
  adjacent: Array<{
    skillId: string;
    skillName: string;
    categoryName: string;
    because: string[];
  }>;
  categoryBalance: Array<{
    categoryId: string;
    categoryName: string;
    score: number;
    skills: number;
  }>;
}

export interface SkillProofItem {
  path: string;
  repositoryId: string;
  repositoryName: string;
  commitSha: string;
  commitUrl: string;
  additions: number;
  deletions: number;
  createdAt: string;
  strength: "strong" | "weak";
  implied: boolean;
}

export interface SkillDetail {
  skillId: string;
  skillName: string;
  categoryId: string;
  categoryName: string;
  depthScore: number;
  level: SkillLevel;
  filesTouched: number;
  strongFiles: number;
  commitsCount: number;
  reposCount: number;
  linesAdded: number;
  linesDeleted: number;
  activeDays: number;
  firstSeen: string;
  lastSeen: string;
  recencyDays: number;
  recentCommits: number;
  priorCommits: number;
  trend: SkillTrend;
  confidence: SkillConfidence;
  evidenceQuality: number;
  activity: ActivityPoint[];
  repositories: Array<{
    repositoryId: string;
    name: string;
    files: number;
    commits: number;
    lines: number;
  }>;
  related: Array<{
    skillId: string;
    skillName: string;
    commits: number;
    affinity: number;
  }>;
  implies: Array<{ skillId: string; skillName: string }>;
  impliedBy: Array<{ skillId: string; skillName: string }>;
  nextSteps: Array<{ skillId: string; skillName: string }>;
  proof: SkillProofItem[];
}
}
