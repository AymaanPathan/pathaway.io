import type { Graph } from "../../db/falkordb.js";




import { Domain as _constants } from './constants.js';
import { Domain as _helpers } from './helpers.js';
import { Domain as _readers } from './readers.js';
import { Domain as _types } from './types.js';
import { Domain as _writers } from './writers.js';

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
import ensureJourneySchema = _writers.ensureJourneySchema;

export const PREREQUISITE_CHECK = (carry: string) => `
  OPTIONAL MATCH (p:Capability)-[:PREREQUISITE_OF]->(c)
  OPTIONAL MATCH (d)-[pc:HAS_CAPABILITY]->(p)
  WITH ${carry},
       CASE WHEN p IS NULL THEN null
            ELSE {
              id: p.id,
              name: p.name,
              level: coalesce(pc.level, "missing"),
              evidence: coalesce(pc.evidence_count, 0),
              met: coalesce(pc.level, "missing") IN $satisfying
            } END AS pre
  WITH ${carry}, collect(pre) AS prereqs
`;

export const FRONTIER_QUERY = `
  MATCH (d:Developer {id: $dev})
  OPTIONAL MATCH (d)-[done_edge:HAS_CAPABILITY]->(done_cap:Capability)
  WHERE done_edge.level IN $demonstrated
  WITH d, collect(done_cap.id) AS done

  MATCH (d)-[:HAS_GOAL]->(:Goal)-[req:REQUIRES]->(r:Capability)
  OPTIONAL MATCH (leaf:Capability)-[:SPECIALIZES*1..3]->(r)
  WITH d, done, req,
       CASE WHEN r.parent_id = "" THEN leaf ELSE r END AS goal_cap
  WHERE goal_cap IS NOT NULL

  MATCH path = (c:Capability)-[:PREREQUISITE_OF*0..${MAX_PREREQUISITE_DEPTH}]->(goal_cap)
  WHERE size([n IN nodes(path)[1..] WHERE n.id IN done]) = 0
  WITH d, c, goal_cap, req, length(path) AS hops,
       [n IN nodes(path) | n.id] AS route_ids,
       [n IN nodes(path) | n.name] AS route_names
  ORDER BY hops ASC
  WITH d, c,
       collect({
         goal_id: goal_cap.id,
         goal_name: goal_cap.name,
         priority: coalesce(req.priority, 0.0),
         reason: coalesce(req.reason, ""),
         ids: route_ids,
         names: route_names
       }) AS routes

  OPTIONAL MATCH (d)-[hc:HAS_CAPABILITY]->(c)
  WITH d, c, routes,
       coalesce(hc.level, "missing") AS lvl,
       coalesce(hc.evidence_count, 0) AS ev,
       coalesce(hc.commit_count, 0) AS cm,
       coalesce(hc.repo_count, 0) AS rp,
       coalesce(hc.active_days, 0) AS ad,
       coalesce(hc.first_seen, "") AS fs,
       coalesce(hc.last_seen, "") AS ls,
       coalesce(hc.recency, "") AS rec
  ${PREREQUISITE_CHECK("d, c, routes, lvl, ev, cm, rp, ad, fs, ls, rec")}
  OPTIONAL MATCH (c)-[:SPECIALIZES]->(dom:Capability)
  RETURN c.id AS capability_id,
         c.name AS name,
         coalesce(c.description, "") AS description,
         coalesce(dom.name, "") AS domain,
         lvl AS level,
         ev AS evidence_count,
         cm AS commit_count,
         rp AS repo_count,
         ad AS active_days,
         fs AS first_seen,
         ls AS last_seen,
         rec AS recency,
         any(route IN routes WHERE route.goal_id = c.id) AS required_by_goal,
         coalesce(head([route IN routes WHERE route.goal_id = c.id | route.priority]), 0.0) AS priority,
         coalesce(head([route IN routes WHERE route.goal_id = c.id | route.reason]), "") AS reason,
         prereqs,
         routes,
         CASE WHEN lvl IN $demonstrated THEN "demonstrated"
              WHEN size([x IN prereqs WHERE NOT x.met]) = 0 THEN "eligible"
              ELSE "blocked" END AS status
`;

export const asStatus = (v: unknown): FrontierStatus => {
  const s = str(v);
  return s === "demonstrated" || s === "eligible" ? s : "blocked";
};
}
