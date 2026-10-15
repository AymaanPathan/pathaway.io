import { createHash } from "node:crypto";
import type { Graph } from "../../db/falkordb.js";




import { Domain as _helpers } from './helpers.js';
import { Domain as _queries } from './queries.js';
import { Domain as _readers } from './readers.js';
import { Domain as _types } from './types.js';
import { Domain as _writers } from './writers.js';

export namespace Domain {
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
import Row = _types.Row;
import GraphTraceEntry = _types.GraphTraceEntry;
import ExplanationEvidence = _types.ExplanationEvidence;
import GapCheck = _types.GapCheck;
import MissionExplanation = _types.MissionExplanation;
import TraceSpec = _types.TraceSpec;
import MissionStatus = _types.MissionStatus;
import SavedEvidence = _types.SavedEvidence;
import SavedMove = _types.SavedMove;
import MissionCriterion = _types.MissionCriterion;
import MissionContract = _types.MissionContract;
import MissionSpec = _types.MissionSpec;
import MissionRepoPin = _types.MissionRepoPin;
import StoredMission = _types.StoredMission;
import MissionStored = _types.MissionStored;
import CriterionResult = _types.CriterionResult;
import EvaluationRecord = _types.EvaluationRecord;
import storeMission = _writers.storeMission;
import markStarted = _writers.markStarted;
import markSubmitted = _writers.markSubmitted;
import markAbandoned = _writers.markAbandoned;
import recordEvaluation = _writers.recordEvaluation;
import saveWorkspace = _writers.saveWorkspace;

export const LOG_PREFIX = "[mission-graph]";

export const STEP_ORDER = [
  "goal_and_move",
  "capability",
  "focus",
  "start_file",
  "strengths",
  "gaps",
  "evidence",
  "evidence_files",
];
}
