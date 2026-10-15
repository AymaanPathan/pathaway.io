import type { Graph } from "../../db/falkordb.js";




import { Domain as _constants } from './constants.js';
import { Domain as _helpers } from './helpers.js';
import { Domain as _queries } from './queries.js';
import { Domain as _readers } from './readers.js';
import { Domain as _types } from './types.js';

export namespace Domain {
import LOG_PREFIX = _constants.LOG_PREFIX;
import ALL_LEVELS = _constants.ALL_LEVELS;
import LEVEL_RANK = _constants.LEVEL_RANK;
import DEPTH_BY_RANK = _constants.DEPTH_BY_RANK;
import schemaReady = _constants.schemaReady;
import log = _helpers.log;
import str = _helpers.str;
import num = _helpers.num;
import strList = _helpers.strList;
import mapList = _helpers.mapList;
import rows = _helpers.rows;
import tryRows = _helpers.tryRows;
import asLevel = _helpers.asLevel;
import evidenceStateFor = _helpers.evidenceStateFor;
import levelsInStates = _helpers.levelsInStates;
import MAX_PREREQUISITE_DEPTH = _helpers.MAX_PREREQUISITE_DEPTH;
import PREREQUISITE_SATISFIED_BY = _helpers.PREREQUISITE_SATISFIED_BY;
import MIN_DETECTIONS_FOR_CONFIDENCE = _helpers.MIN_DETECTIONS_FOR_CONFIDENCE;
import MIN_COMMITS_FOR_CONFIDENCE = _helpers.MIN_COMMITS_FOR_CONFIDENCE;
import GRAPH_MODEL = _helpers.GRAPH_MODEL;
import CAPABILITY_KEYWORDS = _helpers.CAPABILITY_KEYWORDS;
import ignoreExists = _helpers.ignoreExists;
import setupSearch = _helpers.setupSearch;
import STOPWORDS = _helpers.STOPWORDS;
import fulltextQuery = _helpers.fulltextQuery;
import EXPERIENCE_DETAIL = _helpers.EXPERIENCE_DETAIL;
import EXPERIENCE_MAP = _helpers.EXPERIENCE_MAP;
import toExperience = _helpers.toExperience;
import toProof = _helpers.toProof;
import deriveStrengths = _helpers.deriveStrengths;
import summariseDomains = _helpers.summariseDomains;
import badRepo = _helpers.badRepo;
import plural = _helpers.plural;
import explainSelf = _helpers.explainSelf;
import explainCapabilities = _helpers.explainCapabilities;
import explainProof = _helpers.explainProof;
import explainStrengths = _helpers.explainStrengths;
import explainTimeline = _helpers.explainTimeline;
import explainRepositories = _helpers.explainRepositories;
import explainCoverage = _helpers.explainCoverage;
import explainWhole = _helpers.explainWhole;
import buildLimitations = _helpers.buildLimitations;
import deriveFrontierStatus = _helpers.deriveFrontierStatus;
import byNameThenId = _helpers.byNameThenId;
import PREREQUISITE_CHECK = _queries.PREREQUISITE_CHECK;
import FRONTIER_QUERY = _queries.FRONTIER_QUERY;
import asStatus = _queries.asStatus;
import findCapabilitiesForText = _readers.findCapabilitiesForText;
import readTopExperiences = _readers.readTopExperiences;
import readSelf = _readers.readSelf;
import readExperiencesByCapability = _readers.readExperiencesByCapability;
import readProofs = _readers.readProofs;
import readCapabilityProofs = _readers.readCapabilityProofs;
import readCapabilityRows = _readers.readCapabilityRows;
import readBuiltCapabilities = _readers.readBuiltCapabilities;
import readTimeline = _readers.readTimeline;
import readJourneyRepositories = _readers.readJourneyRepositories;
import readCoverage = _readers.readCoverage;
import readCapabilityTrace = _readers.readCapabilityTrace;
import readRepositoryTrace = _readers.readRepositoryTrace;
import readJourney = _readers.readJourney;
import evaluateCapabilityCriteria = _readers.evaluateCapabilityCriteria;
import isGoalComplete = _readers.isGoalComplete;
import readFrontier = _readers.readFrontier;
import readFrontierChecked = _readers.readFrontierChecked;
import eligibleNextSteps = _readers.eligibleNextSteps;
import readDirections = _readers.readDirections;
import Row = _types.Row;
import CapLevel = _types.CapLevel;
import EvidenceState = _types.EvidenceState;
import ProofRef = _types.ProofRef;
import ExperienceBrief = _types.ExperienceBrief;
import SelfReadout = _types.SelfReadout;
import Coverage = _types.Coverage;
import BuiltTechnique = _types.BuiltTechnique;
import BuiltCapability = _types.BuiltCapability;
import StrengthTier = _types.StrengthTier;
import JourneyStrength = _types.JourneyStrength;
import DomainSummary = _types.DomainSummary;
import TimelinePoint = _types.TimelinePoint;
import JourneyRepository = _types.JourneyRepository;
import GraphStep = _types.GraphStep;
import Journey = _types.Journey;
import CapabilityTrace = _types.CapabilityTrace;
import RepositoryTrace = _types.RepositoryTrace;
import CapabilityHit = _types.CapabilityHit;
import FrontierStatus = _types.FrontierStatus;
import PrerequisiteReadout = _types.PrerequisiteReadout;
import SafeguardCriterion = _types.SafeguardCriterion;
import TechniqueCriterion = _types.TechniqueCriterion;
import FrontierNode = _types.FrontierNode;
import DirectionMove = _types.DirectionMove;
import DirectionReadout = _types.DirectionReadout;

export function ensureJourneySchema(
  graph: Graph,
  options: { force?: boolean } = {},
): Promise<void> {
  if (_constants.schemaReady && !options.force) return _constants.schemaReady;

  const pending: Promise<void> = setupSearch(graph).catch((error) => {
    if (_constants.schemaReady === pending) _constants.schemaReady = null;
    throw error;
  });
  _constants.schemaReady = pending;
  return pending;
}
}
