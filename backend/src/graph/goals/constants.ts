import type { Graph } from "../../db/falkordb.js";

import { Domain as _helpers } from "./helpers.js";
import { Domain as _queries } from "./queries.js";
import { Domain as _readers } from "./readers.js";
import { Domain as _types } from "./types.js";
import { Domain as _writers } from "./writers.js";

export namespace Domain {
  import log = _helpers.log;
  import str = _helpers.str;
  import num = _helpers.num;
  import numOrNull = _helpers.numOrNull;
  import round = _helpers.round;
  import uniq = _helpers.uniq;
  import slugify = _helpers.slugify;
  import parseList = _helpers.parseList;
  import parseObjects = _helpers.parseObjects;
  import query = _helpers.query;
  import asLevel = _helpers.asLevel;
  import STOPWORDS = _helpers.STOPWORDS;
  import wishTokens = _helpers.wishTokens;
  import phraseVariants = _helpers.phraseVariants;
  import tokenCoverage = _helpers.tokenCoverage;
  import seedFrom = _helpers.seedFrom;
  import resolveSeeds = _helpers.resolveSeeds;
  import MAX_HOPS = _helpers.MAX_HOPS;
  import MAX_TOPICS = _helpers.MAX_TOPICS;
  import MAX_EVIDENCE = _helpers.MAX_EVIDENCE;
  import EVIDENCE_PER_TOPIC = _helpers.EVIDENCE_PER_TOPIC;
  import linkKey = _helpers.linkKey;
  import expandTopics = _helpers.expandTopics;
  import MISSING_DEPTH = _helpers.MISSING_DEPTH;
  import MAX_CODE = _helpers.MAX_CODE;
  import CODE_CHARS = _helpers.CODE_CHARS;
  import excerptAround = _helpers.excerptAround;
  import K = _helpers.K;
  import buildContext = _helpers.buildContext;
  import buildSignals = _helpers.buildSignals;
  import clarificationSuggestions = _helpers.clarificationSuggestions;
  import topicId = _helpers.topicId;
  import assessmentId = _helpers.assessmentId;
  import READY_RANK = _readers.READY_RANK;
  import readDepth = _readers.readDepth;
  import readCoverage = _readers.readCoverage;
  import readEvidence = _readers.readEvidence;
  import readCode = _readers.readCode;
  import personalizedPageRank = _readers.personalizedPageRank;
  import buildGoalGraph = _readers.buildGoalGraph;
  import briefForAgent = _readers.briefForAgent;
  import Row = _types.Row;
  import DepthLevel = _types.DepthLevel;
  import GraphOperation = _types.GraphOperation;
  import Approach = _types.Approach;
  import DeveloperDepth = _types.DeveloperDepth;
  import TopicRole = _types.TopicRole;
  import GraphTopic = _types.GraphTopic;
  import TopicLink = _types.TopicLink;
  import CapabilityCoverage = _types.CapabilityCoverage;
  import EvidenceItem = _types.EvidenceItem;
  import CodeContext = _types.CodeContext;
  import ContextKind = _types.ContextKind;
  import ContextNode = _types.ContextNode;
  import ContextEdge = _types.ContextEdge;
  import Signal = _types.Signal;
  import ResolutionMethod = _types.ResolutionMethod;
  import Resolution = _types.Resolution;
  import GoalGraphResult = _types.GoalGraphResult;
  import GoalGraphInput = _types.GoalGraphInput;
  import SeedRow = _types.SeedRow;
  import NextMoveInput = _types.NextMoveInput;
  import NextMoveStored = _types.NextMoveStored;
  import writeBatch = _writers.writeBatch;
  import storeNextMove = _writers.storeNextMove;

  export const LOG_PREFIX = "[goal-graph]";

  export const LEVELS: DepthLevel[] = [
    "none",
    "surface",
    "working",
    "proficient",
    "deep",
  ];

  export const levelRank = (l: DepthLevel): number => LEVELS.indexOf(l);
}
