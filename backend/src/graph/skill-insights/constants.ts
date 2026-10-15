import type { Graph } from "../../db/falkordb.js";




import { Domain as _helpers } from './helpers.js';
import { Domain as _queries } from './queries.js';
import { Domain as _readers } from './readers.js';
import { Domain as _types } from './types.js';
import { Domain as _writers } from './writers.js';

export namespace Domain {
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
import ensureSkillIndexes = _writers.ensureSkillIndexes;
import storeSkillCategories = _writers.storeSkillCategories;
import storeSkillDefinitions = _writers.storeSkillDefinitions;
import storeDeveloperSkills = _writers.storeDeveloperSkills;
import storeSkillUsage = _writers.storeSkillUsage;
import storeCoOccurrence = _writers.storeCoOccurrence;

export const LOG_PREFIX = "[skill-agent]";

export const SKILL_CATEGORIES: SkillCategoryDefinition[] = [
  { id: "languages", name: "Languages" },
  { id: "frontend", name: "Frontend" },
  { id: "backend", name: "Backend" },
  { id: "database", name: "Database & Storage" },
  { id: "ai", name: "AI & LLM" },
  { id: "devops", name: "DevOps & Infrastructure" },
  { id: "testing", name: "Testing & QA" },
  { id: "tooling", name: "Build & Tooling" },
  { id: "graphics", name: "3D, Graphics & Data Viz" },
  { id: "mobile", name: "Mobile" },
  { id: "blockchain", name: "Blockchain" },
];

export const DB_BATCH_SIZE = Math.max(
  1,
  Number(process.env.FALKORDB_BATCH_SIZE ?? 500),
);
}
