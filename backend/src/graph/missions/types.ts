import { createHash } from "node:crypto";
import type { Graph } from "../../db/falkordb.js";




import { Domain as _constants } from './constants.js';
import { Domain as _helpers } from './helpers.js';
import { Domain as _queries } from './queries.js';
import { Domain as _readers } from './readers.js';
import { Domain as _writers } from './writers.js';

export namespace Domain {
import LOG_PREFIX = _constants.LOG_PREFIX;
import STEP_ORDER = _constants.STEP_ORDER;
import log = _helpers.log;
import str = _helpers.str;
import num = _helpers.num;
import sha8 = _helpers.sha8;
import clipText = _helpers.clipText;
import parseJson = _helpers.parseJson;
import describeParams = _helpers.describeParams;
import sampleOf = _helpers.sampleOf;
import query = _helpers.query;
import count = _helpers.count;
import EVALUABLE = _helpers.EVALUABLE;
import diagnoseSavedMove = _helpers.diagnoseSavedMove;
import MISSION_COLS = _helpers.MISSION_COLS;
import rowToMission = _helpers.rowToMission;
import newMissionId = _helpers.newMissionId;
import loadSavedMove = _readers.loadSavedMove;
import loadMission = _readers.loadMission;
import listGoalMissions = _readers.listGoalMissions;
import loadLatestEvaluation = _readers.loadLatestEvaluation;
import storeMission = _writers.storeMission;
import markStarted = _writers.markStarted;
import markSubmitted = _writers.markSubmitted;
import markAbandoned = _writers.markAbandoned;
import recordEvaluation = _writers.recordEvaluation;
import saveWorkspace = _writers.saveWorkspace;

export type Row = Record<string, any>;

export interface GraphTraceEntry {
  step: string;
  label: string;
  /** the relationship pattern the query walks, e.g. (NextMove)-[:ADVANCES]->(Capability) */
  relationship: string;
  /** compacted Cypher text (whitespace collapsed, clipped) */
  cypher: string;
  /** string params only (ids), clipped */
  params: Record<string, string>;
  /** null when the query itself failed */
  rows: number | null;
  ms: number;
  /** first column of the first rows, to show what came back */
  sample: string[];
  error?: string;
}

export interface ExplanationEvidence {
  ref: string;
  cited: boolean;
  repository: string;
  path: string;
  commitSha: string;
  permalink: string;
  technique: string;
  summary: string;
  fileChangeId: string;
  demonstrationId: string;
  /** true: the observed code was found in the file at that commit; false: not found; null: not checked */
  verifiedAtCommit: boolean | null;
  excerpt: string;
}

export interface GapCheck {
  terms: string[];
  status: "contradicted" | "weak_signal" | "not_found_in_scope" | "unverified";
  dependencyHits: string[];
  startFileHits: string[];
  pathHits: string[];
  contradictingTerms: string[];
  /** what was actually scanned, so "not found" is not read as "does not exist" */
  scope: string;
}

export interface MissionExplanation {
  generatedAt: string;
  trace: GraphTraceEntry[];
  evidence: ExplanationEvidence[];
  gapCheck: GapCheck;
  selection: {
    goal: string;
    moveTitle: string;
    moveWhy: string;
    capability: { id: string; name: string } | null;
    focusSlug: string | null;
    builtOn: string[];
    gapTopics: string[];
    startFileChangeId: string | null;
    /** the goal agent saves only the chosen move, so there is nothing to compare against */
    alternatives: "not_recorded";
    note: string;
  };
  proves: string[];
  doesNotProve: string[];
}

export interface TraceSpec {
  trace: GraphTraceEntry[];
  step: string;
  relationship: string;
}

export type MissionStatus =
  | "proposed"
  | "in_progress"
  | "submitted"
  | "completed"
  | "needs_work"
  | "abandoned";

export interface SavedEvidence {
  /** the id the goal agent cited, e.g. "E2" */
  ref: string;
  demonstrationId: string;
  fileChangeId: string;
  repository: string;
  path: string;
  commitSha: string;
  technique: string;
  summary: string;
  permalink: string;
}

export interface SavedMove {
  developerId: string;
  goalId: string;
  wish: string;
  nextMoveId: string;
  /** identifies this version of the NextMove (it is replaced when a new one is planned) */
  moveVersion: string;
  title: string;
  summary: string;
  doneWhen: string;
  createdAt: string;
  /** details_json: decision, challenge, startingPoint, steps */
  details: Row;
  focusSlug: string | null;
  capability: { id: string; name: string } | null;
  startFileChangeId: string | null;
  strengthSlugs: string[];
  gapSlugs: string[];
  evidence: SavedEvidence[];
  /** the queries that really ran to load this move */
  trace: GraphTraceEntry[];
}

export interface MissionCriterion {
  id: string;
  description: string;
  check: "test" | "command" | "review";
  how: string;
}

export interface MissionContract {
  /** the package the move requires, or null when no external library is involved */
  library: string | null;
  decisions: Array<{ topic: string; decision: string }>;
}

export interface MissionSpec {
  title: string;
  objective: string;
  summary: string;
  scope: {
    startPath: string;
    modifyPaths: string[];
    createPaths: string[];
    outOfScope: string[];
  };
  steps: string[];
  criteria: MissionCriterion[];
  /** command is derived by code from the inspected repository, never written by the agent */
  verify: { testFile: string | null; command: string | null };
  expectedSkills: Array<{ capabilityId: string | null; evidence: string }>;
  grounding: {
    evidenceIds: string[];
    observedNow: string;
    gapStillOpen: string;
  };
  /** implementation contract; missing on missions created before it existed */
  contract?: MissionContract;
  estimatedMinutes: number;
}

export interface MissionRepoPin {
  repository: string;
  branch: string;
  baseCommit: string;
  packageRoot: string;
  packageManager: "npm" | "pnpm" | "yarn" | "bun";
  testRunner: "vitest" | "jest" | "mocha" | "unknown";
  /** null when the package has no test script */
  testCommand: string | null;
}

export interface StoredMission {
  id: string;
  goalId: string;
  developerId: string;
  nextMoveId: string;
  moveVersion: string;
  status: MissionStatus;
  capabilityId: string | null;
  focusSlug: string | null;
  spec: MissionSpec;
  pin: MissionRepoPin;
  /** why this mission was selected, from executed queries and inspected code; null on older missions */
  explanation: MissionExplanation | null;
  /** the developer's fork ("owner/name"), "" until the workspace is prepared */
  forkRepository: string;
  /** the working branch created in the fork, "" until the workspace is prepared */
  workBranch: string;
  createdAt: string;
  startedAt: string;
  submittedHead: string;
  completedAt: string;
}

export interface MissionStored {
  stored: boolean;
  missionId: string;
  links: {
    goal: number;
    developer: number;
    move: number;
    capability: number;
    focus: number;
    startFile: number;
    demonstrations: number;
    repository: number;
  };
  rejected: string[];
}

export interface CriterionResult {
  id: string;
  met: boolean;
  /** true only when the quote was found in the diff and the check's preconditions held */
  verified: boolean;
  quote: string;
  reasoning: string;
}

export interface EvaluationRecord {
  missionId: string;
  developerId: string;
  headCommit: string;
  verdict: "completed" | "needs_work";
  ciState: "success" | "failure" | "pending" | "none";
  results: CriterionResult[];
  scopeWarnings: string[];
  changedFiles: string[];
  summary: string;
  /** written only when verdict is "completed" */
  demonstration: {
    capabilityId: string;
    technique: string;
    summary: string;
    depth: "working";
    path: string;
    permalink: string;
    commitSubject: string;
  } | null;
}
}
