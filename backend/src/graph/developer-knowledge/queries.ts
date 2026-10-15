import { createHash, randomUUID } from "node:crypto";
import type { Graph } from "../../db/falkordb.js";
import {
  SKILL_TAXONOMY,
  matchesSkill,
  type SkillDefinition,
} from "../skill-insights/runtime.js";




import { Domain as _constants } from './constants.js';
import { Domain as _helpers_extra } from './helpers-extra.js';
import { Domain as _helpers_extra2 } from './helpers-extra2.js';
import { Domain as _helpers } from './helpers.js';
import { Domain as _readers } from './readers.js';
import { Domain as _types } from './types.js';
import { Domain as _writers } from './writers.js';

export namespace Domain {
import LOG_PREFIX = _constants.LOG_PREFIX;
import DB_BATCH_SIZE = _constants.DB_BATCH_SIZE;
import EVIDENCE_PAGE_SIZE = _constants.EVIDENCE_PAGE_SIZE;
import LEARNABLE_CAPABILITIES = _constants.LEARNABLE_CAPABILITIES;
import CATEGORY_CAPABILITIES = _constants.CATEGORY_CAPABILITIES;
import DEPTH_RANK = _constants.DEPTH_RANK;
import CAPABILITY_DEFINITIONS_VERSION = _constants.CAPABILITY_DEFINITIONS_VERSION;
import CAPABILITY_SCHEMA_NODE_ID = _constants.CAPABILITY_SCHEMA_NODE_ID;
import LEVEL_RANK = _constants.LEVEL_RANK;
import COMPLETION_CRITERIA_BY_CAPABILITY = _helpers_extra.COMPLETION_CRITERIA_BY_CAPABILITY;
import TECHNOLOGY_NAMES = _helpers_extra.TECHNOLOGY_NAMES;
import normalizeExperiencePart = _helpers_extra.normalizeExperiencePart;
import experienceFingerprintFor = _helpers_extra.experienceFingerprintFor;
import problemFingerprintFor = _helpers_extra.problemFingerprintFor;
import techniqueIdFor = _helpers_extra.techniqueIdFor;
import representativeProblemFor = _helpers_extra.representativeProblemFor;
import buildExperienceSummary = _helpers_extra.buildExperienceSummary;
import buildEngineeringExperiences = _helpers_extra.buildEngineeringExperiences;
import groupDemonstrationsIntoExperiences = _helpers_extra.groupDemonstrationsIntoExperiences;
import EVIDENCE_STATE_BY_LEVEL = _helpers_extra.EVIDENCE_STATE_BY_LEVEL;
import PREREQUISITE_SATISFIED_BY = _helpers_extra.PREREQUISITE_SATISFIED_BY;
import evidenceStateFor = _helpers_extra.evidenceStateFor;
import levelsInStates = _helpers_extra.levelsInStates;
import commitKey = _helpers_extra.commitKey;
import recencyFor = _helpers_extra.recencyFor;
import summarise = _helpers_extra.summarise;
import rollUpDemonstrations = _helpers_extra.rollUpDemonstrations;
import GOAL_INDEXES = _helpers_extra.GOAL_INDEXES;
import CAPABILITY_DEPENDENCIES = _helpers_extra.CAPABILITY_DEPENDENCIES;
import prerequisite = _helpers_extra.prerequisite;
import related = _helpers_extra.related;
import DECLARED_PREREQUISITES = _helpers_extra.DECLARED_PREREQUISITES;
import DECLARED_RELATIONS = _helpers_extra.DECLARED_RELATIONS;
import CAPABILITY_GRAPH_RELATIONSHIPS = _helpers_extra.CAPABILITY_GRAPH_RELATIONSHIPS;
import MAX_PREREQUISITE_DEPTH = _helpers_extra.MAX_PREREQUISITE_DEPTH;
import validateCompletionCriteria = _helpers_extra.validateCompletionCriteria;
import validateCapabilityGraph = _helpers_extra.validateCapabilityGraph;
import conceptKey = _helpers_extra.conceptKey;
import resolveConceptProposals = _helpers_extra.resolveConceptProposals;
import setDeveloperGoal = _helpers_extra.setDeveloperGoal;
import DEMONSTRATION_INDEXES = _helpers_extra.DEMONSTRATION_INDEXES;
import collectSkillRepositoryEvidence = _helpers_extra.collectSkillRepositoryEvidence;
import parseTechniques = _helpers_extra.parseTechniques;
import byLevelThenEvidence = _helpers_extra.byLevelThenEvidence;
import parseAddedLines = _helpers_extra2.parseAddedLines;
import COMMENT_LINE = _helpers_extra2.COMMENT_LINE;
import TEST_PATH = _helpers_extra2.TEST_PATH;
import dedent = _helpers_extra2.dedent;
import depthFor = _helpers_extra2.depthFor;
import buildPermalink = _helpers_extra2.buildPermalink;
import extractDemonstrations = _helpers_extra2.extractDemonstrations;
import slugify = _helpers_extra2.slugify;
import techniqueSpec = _helpers_extra2.techniqueSpec;
import COMPLETION_CRITERIA = _helpers_extra2.COMPLETION_CRITERIA;
import positiveIntegerEnv = _helpers.positiveIntegerEnv;
import MAX_SNIPPET_CHARS = _helpers.MAX_SNIPPET_CHARS;
import SNIPPET_LINES_BEFORE = _helpers.SNIPPET_LINES_BEFORE;
import SNIPPET_LINES_AFTER = _helpers.SNIPPET_LINES_AFTER;
import RECENT_DAYS = _helpers.RECENT_DAYS;
import HISTORICAL_DAYS = _helpers.HISTORICAL_DAYS;
import log = _helpers.log;
import safeString = _helpers.safeString;
import safeNumber = _helpers.safeNumber;
import chunkArray = _helpers.chunkArray;
import asQueryParams = _helpers.asQueryParams;
import queryRows = _helpers.queryRows;
import runCounted = _helpers.runCounted;
import domain = _helpers.domain;
import capability = _helpers.capability;
import CAPABILITY_BY_ID = _helpers.CAPABILITY_BY_ID;
import ENGINEERING_CONTEXTS = _helpers.ENGINEERING_CONTEXTS;
import DEFAULT_CONTEXT = _helpers.DEFAULT_CONTEXT;
import CHANGE_INTENTS = _helpers.CHANGE_INTENTS;
import deriveContext = _helpers.deriveContext;
import imp = _helpers.imp;
import SIGNAL_RULES = _helpers.SIGNAL_RULES;
import isLearnableCapability = _readers.isLearnableCapability;
import evaluateCapabilityCompletion = _readers.evaluateCapabilityCompletion;
import hashExperienceFingerprint = _readers.hashExperienceFingerprint;
import getEngineeringExperiences = _readers.getEngineeringExperiences;
import capabilityDefinitionsVersion = _readers.capabilityDefinitionsVersion;
import isCapabilityGraphCurrent = _readers.isCapabilityGraphCurrent;
import getDeveloperGoal = _readers.getDeveloperGoal;
import findCapabilityGaps = _readers.findCapabilityGaps;
import loadRepositoryNames = _readers.loadRepositoryNames;
import loadCommitMessages = _readers.loadCommitMessages;
import fetchEvidencePage = _readers.fetchEvidencePage;
import fetchDeveloperSkills = _readers.fetchDeveloperSkills;
import loadDemonstrationRows = _readers.loadDemonstrationRows;
import getCapabilityProfile = _readers.getCapabilityProfile;
import getCapabilityEvidence = _readers.getCapabilityEvidence;
import getOverviewGraphSnapshot = _readers.getOverviewGraphSnapshot;
import AnyObject = _types.AnyObject;
import ProgressFn = _types.ProgressFn;
import QueryPrimitive = _types.QueryPrimitive;
import QueryParamObject = _types.QueryParamObject;
import CapabilityDefinition = _types.CapabilityDefinition;
import EngineeringContextDefinition = _types.EngineeringContextDefinition;
import DemonstrationDepth = _types.DemonstrationDepth;
import ModifierRule = _types.ModifierRule;
import UsesRule = _types.UsesRule;
import SignalRule = _types.SignalRule;
import AddedLine = _types.AddedLine;
import EvidenceInput = _types.EvidenceInput;
import EvidenceContext = _types.EvidenceContext;
import Demonstration = _types.Demonstration;
import SafeguardDefinition = _types.SafeguardDefinition;
import TechniqueSpecDefinition = _types.TechniqueSpecDefinition;
import SafeguardTuple = _types.SafeguardTuple;
import SafeguardStatus = _types.SafeguardStatus;
import TechniqueCompletion = _types.TechniqueCompletion;
import CapabilityCompletion = _types.CapabilityCompletion;
import EngineeringExperience = _types.EngineeringExperience;
import CapabilityLevel = _types.CapabilityLevel;
import Recency = _types.Recency;
import EvidenceState = _types.EvidenceState;
import CapabilityRollup = _types.CapabilityRollup;
import GoalDefinition = _types.GoalDefinition;
import GoalRequirement = _types.GoalRequirement;
import DeveloperGoal = _types.DeveloperGoal;
import CapabilityGap = _types.CapabilityGap;
import CapabilityRelationship = _types.CapabilityRelationship;
import CapabilityDependency = _types.CapabilityDependency;
import CapabilityGraphProblem = _types.CapabilityGraphProblem;
import ConceptProposal = _types.ConceptProposal;
import RegisteredConcept = _types.RegisteredConcept;
import StoredSkillRow = _types.StoredSkillRow;
import SkillRepositoryAggregate = _types.SkillRepositoryAggregate;
import OverviewGraphBuildResult = _types.OverviewGraphBuildResult;
import CapabilityProfileEntry = _types.CapabilityProfileEntry;
import DomainProfile = _types.DomainProfile;
import DemonstrationEvidence = _types.DemonstrationEvidence;
import OverviewGraphSnapshot = _types.OverviewGraphSnapshot;
import storeEngineeringExperiences = _writers.storeEngineeringExperiences;
import cleanupStaleExperiences = _writers.cleanupStaleExperiences;
import ensureGoalIndexes = _writers.ensureGoalIndexes;
import ensureCapabilityGraph = _writers.ensureCapabilityGraph;
import registerConcepts = _writers.registerConcepts;
import clearDeveloperGoal = _writers.clearDeveloperGoal;
import ensureDemonstrationIndexes = _writers.ensureDemonstrationIndexes;
import storeCapabilities = _writers.storeCapabilities;
import storeEngineeringContexts = _writers.storeEngineeringContexts;
import storeDemonstrations = _writers.storeDemonstrations;
import storeDemonstrationUsage = _writers.storeDemonstrationUsage;
import storeDeveloperCapabilities = _writers.storeDeveloperCapabilities;
import cleanupStale = _writers.cleanupStale;
import storeSkillRepositoryRelations = _writers.storeSkillRepositoryRelations;
import buildOverviewIntelligenceGraph = _writers.buildOverviewIntelligenceGraph;
import removeLegacyConceptPatternGraph = _writers.removeLegacyConceptPatternGraph;

export const CAPABILITIES: CapabilityDefinition[] = [
  domain(
    "concurrency_control",
    "Concurrency & Consistency",
    "Keeping shared state correct under concurrent access.",
  ),
  capability(
    "distributed_locking",
    "Distributed locking",
    "concurrency_control",
    "Mutual exclusion across processes or nodes.",
  ),
  capability(
    "transactional_integrity",
    "Transactional integrity",
    "concurrency_control",
    "Atomic multi-step writes and row-level locking.",
  ),
  capability(
    "optimistic_concurrency",
    "Optimistic concurrency",
    "concurrency_control",
    "Version-checked updates that detect lost writes.",
  ),
  capability(
    "idempotent_operations",
    "Idempotent operations",
    "concurrency_control",
    "Operations that are safe to repeat.",
  ),

  domain(
    "async_processing",
    "Asynchronous Processing",
    "Moving work off the request path and across service boundaries.",
  ),
  capability(
    "job_queues",
    "Job queues & workers",
    "async_processing",
    "Producer/consumer background job processing.",
  ),
  capability(
    "event_messaging",
    "Broker-based messaging",
    "async_processing",
    "Publishing and consuming events through a broker.",
  ),
  capability(
    "webhook_handling",
    "Webhook handling",
    "async_processing",
    "Receiving third-party callbacks safely.",
  ),

  domain(
    "reliability",
    "Reliability & Resilience",
    "Behaving well when dependencies are slow, limited, or failing.",
  ),
  capability(
    "retry_backoff",
    "Retry with backoff",
    "reliability",
    "Bounded, spaced retries of failing calls.",
  ),
  capability(
    "rate_limit_handling",
    "Rate-limit handling",
    "reliability",
    "Detecting and respecting upstream rate limits.",
  ),
  capability(
    "timeouts_cancellation",
    "Timeouts & cancellation",
    "reliability",
    "Bounding and aborting slow operations.",
  ),

  domain(
    "caching",
    "Caching & Performance",
    "Trading memory for latency without serving wrong data.",
  ),
  capability(
    "application_caching",
    "Application caching",
    "caching",
    "Cache with expiry, invalidation, and stampede protection.",
  ),

  domain(
    "realtime",
    "Real-time Delivery",
    "Pushing state to clients as it changes.",
  ),
  capability(
    "websocket_channels",
    "WebSocket channels",
    "realtime",
    "Bidirectional connections with rooms, auth, and scaling.",
  ),

  domain(
    "api_engineering",
    "API Design & Security",
    "Building trustworthy request boundaries.",
  ),
  capability(
    "api_design",
    "REST API design",
    "api_engineering",
    "Resource-oriented HTTP endpoints with a clear request/response contract.",
  ),
  capability(
    "input_validation",
    "Input validation",
    "api_engineering",
    "Schema validation at trust boundaries.",
  ),
  capability(
    "authn_authz",
    "Authentication & authorization",
    "api_engineering",
    "Token/session auth, password hashing, permission checks.",
  ),
  capability(
    "rate_limiting",
    "Server-side rate limiting",
    "api_engineering",
    "Protecting endpoints from excessive use.",
  ),

  domain(
    "data_layer",
    "Data Layer Engineering",
    "Schema evolution, bulk writes, and query design.",
  ),
  capability(
    "schema_migrations",
    "Schema migrations",
    "data_layer",
    "Evolving a database schema safely.",
  ),
  capability(
    "batched_writes",
    "Batched bulk writes",
    "data_layer",
    "Writing many records without per-row round trips.",
  ),
  capability(
    "graph_modeling",
    "Graph modeling & traversal",
    "data_layer",
    "Relationship-centric data models and Cypher traversal.",
  ),

  domain(
    "frontend_delivery",
    "Frontend Delivery",
    "How pages are rendered, cached, and made discoverable.",
  ),
  capability(
    "rendering_strategies",
    "Rendering strategies",
    "frontend_delivery",
    "SSG/ISR/SSR/streaming choices in a framework.",
  ),
];
}
