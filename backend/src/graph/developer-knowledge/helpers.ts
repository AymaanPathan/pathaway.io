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
import { Domain as _queries } from './queries.js';
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
import CAPABILITIES = _queries.CAPABILITIES;
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

export function positiveIntegerEnv(
  name: string,
  fallback: number,
  minimum = 1,
): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    log(`Invalid ${name}; using default`, { value: raw, fallback });
    return fallback;
  }
  return parsed;
}

export const MAX_SNIPPET_CHARS = 700;

export const SNIPPET_LINES_BEFORE = 2;

export const SNIPPET_LINES_AFTER = 8;

export const RECENT_DAYS = 60;

export const HISTORICAL_DAYS = 180;

export function log(message: string, detail?: AnyObject): void {
  if (detail !== undefined) console.log(`${LOG_PREFIX} ${message}`, detail);
  else console.log(`${LOG_PREFIX} ${message}`);
}

export function safeString(value: unknown): string {
  return value == null ? "" : String(value);
}

export function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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

export async function queryRows(
  graph: Graph,
  query: string,
  params: AnyObject = {},
): Promise<AnyObject[]> {
  const result = await graph.query(query, { params });
  return (result.data ?? []) as AnyObject[];
}

export async function runCounted(
  graph: Graph,
  label: string,
  query: string,
  rows: object[],
  params: AnyObject | boolean = {},
  strict = false,
): Promise<number> {
  // Preserve concise call sites: a boolean fifth argument means strict mode.
  if (typeof params === "boolean") {
    strict = params;
    params = {};
  }

  let written = 0;

  for (const batch of chunkArray(rows, DB_BATCH_SIZE)) {
    const result = await graph.query(query, {
      params: { ...params, batch: asQueryParams(batch) },
    });
    written += safeNumber(((result.data ?? []) as AnyObject[])[0]?.n);
  }

  if (written < rows.length) {
    const detail = {
      label,
      expected: rows.length,
      written,
      missing: rows.length - written,
    };
    log(
      `${label}: ${detail.missing} of ${rows.length} rows matched nothing`,
      detail,
    );
    if (strict) {
      throw new Error(
        `${label} was incomplete (${written}/${rows.length}); refusing to continue to stale-data cleanup`,
      );
    }
  }

  return written;
}

export const domain = (
  id: string,
  name: string,
  description: string,
): CapabilityDefinition => ({ id, name, parentId: null, description });

export const capability = (
  id: string,
  name: string,
  parentId: string,
  description: string,
): CapabilityDefinition => ({ id, name, parentId, description });

export const CAPABILITY_BY_ID = new Map(CAPABILITIES.map((c) => [c.id, c]));

export const ENGINEERING_CONTEXTS: EngineeringContextDefinition[] = [
  {
    id: "background_processing",
    name: "Background processing",
    pattern:
      /(?:^|\/)(?:workers?|jobs?|queues?|consumers?|cron|tasks?|processors?|schedulers?)(?:\/|\.|-)/i,
  },
  {
    id: "request_pipeline",
    name: "Request pipeline (routes, controllers, middleware)",
    pattern:
      /(?:^|\/)(?:routes?|controllers?|handlers?|middlewares?|api|endpoints?)(?:\/|\.|-)/i,
  },
  {
    id: "realtime_layer",
    name: "Real-time layer",
    pattern:
      /(?:^|\/)(?:sockets?|realtime|ws|gateway|sse|streams?)(?:\/|\.|-)/i,
  },
  {
    id: "data_layer",
    name: "Data layer",
    pattern:
      /(?:^|\/)(?:db|database|models?|repositor(?:y|ies)|migrations?|prisma|schema|dao|graph)(?:\/|\.|-)/i,
  },
  {
    id: "integration_layer",
    name: "External integrations",
    pattern:
      /(?:^|\/)(?:integrations?|clients?|adapters?|providers?|sdk|connectors?|webhooks?)(?:\/|\.|-)/i,
  },
  {
    id: "ui_layer",
    name: "UI layer",
    pattern:
      /(?:^|\/)(?:components?|pages|app|views?|ui|hooks|layouts?)(?:\/|\.)|\.(?:tsx|jsx|vue|svelte)$/i,
  },
  {
    id: "infrastructure",
    name: "Infrastructure & scripts",
    pattern:
      /(?:^|\/)(?:infra|deploy|docker|k8s|terraform|scripts?|\.github)(?:\/|\.)|(?:^|\/)Dockerfile/i,
  },
  { id: "application_logic", name: "Application logic", pattern: null },
];

export const DEFAULT_CONTEXT = ENGINEERING_CONTEXTS[ENGINEERING_CONTEXTS.length - 1];

export const CHANGE_INTENTS: Array<{ id: string; pattern: RegExp }> = [
  {
    id: "performance",
    pattern:
      /^\s*perf\b|\b(?:perf(?:ormance)?|speed\s*up|optimi[sz]\w*|latency|slow(?:er|ness)?|n\+1|throughput)\b/i,
  },
  {
    id: "reliability",
    pattern:
      /\b(?:retry|retries|timeout|rate[\s-]?limit\w*|race(?:\s+condition)?|deadlock|duplicate\w*|idempoten\w*|flak(?:y|iness)|crash\w*|resilien\w*|backoff|stale)\b/i,
  },
  {
    id: "bugfix",
    pattern:
      /^\s*(?:fix|bugfix|hotfix)\b|\b(?:fix(?:es|ed)?|bug|regression|broken)\b/i,
  },
  {
    id: "refactor",
    pattern: /^\s*(?:refactor|chore|cleanup)\b|\b(?:refactor\w*|clean\s*up)\b/i,
  },
  {
    id: "feature",
    pattern:
      /^\s*feat\b|\b(?:add(?:s|ed)?|implement\w*|introduce\w*|support(?:s|ed)?|new)\b/i,
  },
];

export function deriveContext(
  path: string,
  commitMessage: string,
): { layerId: string; layerName: string; intent: string; subject: string } {
  const layer =
    ENGINEERING_CONTEXTS.find((c) => c.pattern?.test(path)) ?? DEFAULT_CONTEXT;

  const subject = commitMessage.split("\n")[0].trim().slice(0, 140);
  const intent =
    CHANGE_INTENTS.find((i) => i.pattern.test(subject))?.id ?? "change";

  return { layerId: layer.id, layerName: layer.name, intent, subject };
}

export const imp = (pkgs: string): RegExp =>
  new RegExp(
    `(?:from\\s+|require\\(\\s*|import\\(\\s*|import\\s+)['"](?:${pkgs})(?:/[^'"]*)?['"]`,
  );

export const SIGNAL_RULES: SignalRule[] = [
  // ---------------- Concurrency & consistency ----------------
  {
    id: "redis_ttl_lock",
    capabilityId: "distributed_locking",
    technique: "Redis-based distributed lock",
    tier: "usage",
    allOf: [
      [/redis/i],
      [/\bsetnx\b/i, /['"]NX['"]/, /\bNX\s*:\s*true\b/],
      // SET NX is also how idempotency keys and one-shot guards are written.
      // Require lock vocabulary so those are not credited as locks.
      // (Matches lock, lockKey, acquireLock, mutex, redlock, lease; not "block"/"clock".)
      [/\b(?:lock\w*|\w*Lock\w*|mutex|redlock|lease\w*)\b/],
    ],
    anchor: /\bsetnx\b|['"]NX['"]|\bNX\s*:\s*true\b/i,
    modifierWindow: 60,
    modifiers: [
      {
        label: "TTL-bounded (auto-expiry)",
        pattern: /['"](?:PX|EX)['"]|\b(?:PX|EX)\s*:|\bpexpire\b|\bexpire\s*\(/,
      },
      {
        label: "atomic Lua release (compare-and-delete)",
        pattern: /\beval(?:sha)?\s*\(|redis\.call\(\s*['"]del['"]/i,
      },
      {
        label: "unique owner token",
        pattern: /\b(?:randomUUID|uuid(?:v4)?|nanoid|randomBytes)\b/,
      },
      {
        label: "retry / wait for lock",
        pattern:
          /\b(?:retryDelay|retryCount|waitForLock|acquireTimeout|tryLock)\b/i,
      },
    ],
    uses: [{ skillId: "redis" }],
  },
  {
    id: "row_level_locking",
    capabilityId: "transactional_integrity",
    technique: "Row-level locking inside a transaction",
    tier: "implementation",
    allOf: [
      [
        /\bFOR\s+(?:NO\s+KEY\s+)?UPDATE\b/i,
        /\.forUpdate\s*\(/,
        /\bLOCK\.UPDATE\b/,
      ],
      [
        /\bBEGIN\b/,
        /\$transaction\s*\(/,
        /\.transaction\s*\(/,
        /\btrx\b|\btx\b/,
      ],
    ],
    anchor:
      /\bFOR\s+(?:NO\s+KEY\s+)?UPDATE\b|\.forUpdate\s*\(|\bLOCK\.UPDATE\b/i,
    modifierWindow: 60,
    modifiers: [
      {
        label: "SKIP LOCKED work-claiming",
        pattern: /\bSKIP\s+LOCKED\b|\bskipLocked\b/i,
      },
      { label: "NOWAIT fail-fast", pattern: /\bNOWAIT\b|\bnoWait\b/i },
    ],
    uses: [{ skillId: "sql" }],
  },
  {
    id: "db_transactions",
    capabilityId: "transactional_integrity",
    technique: "Multi-statement database transaction",
    tier: "usage",
    allOf: [
      [
        /\$transaction\s*\(/,
        /\.transaction\s*\(/,
        /\bBEGIN\b[\s\S]{0,4000}?\b(?:COMMIT|ROLLBACK)\b/,
        /\bwithTransaction\b/,
      ],
      [
        /\b(?:prisma|knex|trx|tx|sequelize|typeorm|mongoose|pool|client|session)\b/i,
      ],
    ],
    anchor:
      /\$transaction\s*\(|\.transaction\s*\(|\bBEGIN\b|\bwithTransaction\b/,
    modifiers: [
      {
        label: "explicit rollback path",
        pattern: /\bROLLBACK\b|\.rollback\s*\(/i,
      },
      {
        label: "explicit isolation level",
        pattern:
          /isolationLevel|ISOLATION\s+LEVEL|\bSerializable\b|\bRepeatableRead\b/,
      },
      {
        label: "handles serialization failure / deadlock",
        pattern: /\b40001\b|\bP2034\b|serialization[_\s]failure|deadlock/i,
      },
    ],
    uses: [
      { skillId: "prisma", when: /\$transaction/ },
      { skillId: "sql", when: /\bBEGIN\b/ },
      { skillId: "mongodb", when: /startSession|mongoose/i },
    ],
  },
  {
    id: "optimistic_version_check",
    capabilityId: "optimistic_concurrency",
    technique: "Version-checked update (optimistic locking)",
    tier: "implementation",
    allOf: [
      [
        /\bversion\s*:\s*\{\s*increment\b/,
        /\bversion\s*=\s*version\s*\+\s*1\b/i,
        /\bWHERE\b[^;]{0,300}\bversion\s*=\s*[:$?@]/i,
        /\bversion\s*:\s*\w+\.version\b/,
      ],
      [
        /\b(?:count|rowCount|affectedRows|changes|modifiedCount|matchedCount)\b\s*(?:===?|!==?|<|<=)\s*[01]\b/,
        /\b(?:StaleObject|OptimisticLock|VersionConflict|ConflictError)\w*/i,
      ],
    ],
    anchor:
      /\bversion\s*:\s*\{\s*increment\b|\bversion\s*=\s*version\s*\+\s*1\b|\bversion\s*:\s*\w+\.version\b|\bWHERE\b[^;]*\bversion\b/i,
    modifiers: [
      {
        label: "retries after conflict",
        pattern: /\b(?:retry|retries|attempt)\b/i,
      },
      { label: "surfaces conflict to caller", pattern: /\b409\b|\bConflict\b/ },
    ],
  },
  {
    id: "idempotent_writes",
    capabilityId: "idempotent_operations",
    technique: "Idempotency-key guarded write",
    tier: "implementation",
    allOf: [
      [/idempoten/i],
      // A guarded write needs a dedupe primitive. Bare "unique" / "NX" are far
      // too common to count on their own.
      [
        /\b(?:upsert|onConflict|ON\s+CONFLICT|findUnique|MERGE|INSERT\s+IGNORE|setnx)\b|['"]NX['"]/i,
      ],
    ],
    anchor: /idempoten/i,
    modifiers: [
      {
        label: "stored-response replay",
        pattern:
          /\b(?:cachedResponse|storedResponse|replay|response_body|responseBody)\b/i,
      },
      { label: "key expiry", pattern: /\b(?:expires?_?at|expiresAt|ttl)\b/i },
      {
        label: "request-hash mismatch check",
        pattern: /\b(?:requestHash|request_hash|fingerprint|checksum)\b/i,
      },
    ],
    uses: [
      { skillId: "postgres", when: /ON\s+CONFLICT/i },
      { skillId: "redis", when: /redis/i },
      { skillId: "prisma", when: /\bupsert\b|findUnique/ },
    ],
  },

  // ---------------- Asynchronous processing ----------------
  {
    id: "job_queue_workers",
    capabilityId: "job_queues",
    technique: "Background job queue with workers",
    tier: "usage",
    allOf: [
      [imp("bullmq|bull|bee-queue|agenda|pg-boss|graphile-worker")],
      [
        /\bnew\s+Worker\s*\(/,
        /\.process\s*\(/,
        /\.work\s*\(/,
        /\bnew\s+Queue\s*\(/,
        /\.enqueue\s*\(/,
        /\.add\s*\(/,
      ],
    ],
    anchor:
      /\bnew\s+Worker\s*\(|\bnew\s+Queue\s*\(|\.process\s*\(|\.work\s*\(|\.enqueue\s*\(/,
    modifiers: [
      {
        label: "retry policy",
        pattern: /\battempts\s*:|\bretryLimit\b|\bretryDelay\b|\bbackoff\b/,
      },
      {
        label: "bounded worker concurrency",
        pattern: /\bconcurrency\s*:|\bteamSize\b|\bbatchSize\b/,
      },
      {
        label: "job de-duplication",
        pattern: /\bjobId\s*:|\bsingletonKey\b|\bdeduplicat/i,
      },
      {
        label: "failed-job / dead-letter handling",
        pattern:
          /\bremoveOnFail\b|\bdead[-_ ]?letter|\bDLQ\b|\.on\s*\(\s*['"]failed['"]/i,
      },
    ],
    uses: [
      { skillId: "redis", when: /redis|bullmq|\bbull\b/i },
      { skillId: "postgres", when: /pg-boss|graphile/i },
    ],
  },
  {
    id: "broker_messaging",
    capabilityId: "event_messaging",
    technique: "Broker-based publish / consume",
    tier: "usage",
    allOf: [
      [
        imp(
          "kafkajs|amqplib|@aws-sdk/client-sqs|@aws-sdk/client-sns|@google-cloud/pubsub|nats|ioredis|redis|@nestjs/microservices",
        ),
      ],
      [
        /\.(?:publish|produce|sendToQueue|sendMessage)\s*\(/,
        /\.(?:subscribe|psubscribe|consume|receiveMessage)\s*\(/,
        /\beachMessage\b/,
      ],
    ],
    // A Redis-backed rate limiter imports redis and calls `.consume()`; that is
    // rate limiting, not messaging.
    excludeIf: [
      /rate-limiter-flexible|express-rate-limit|@upstash\/ratelimit|@fastify\/rate-limit|\bnew\s+RateLimiter\w*\s*\(/,
    ],
    anchor:
      /\.(?:publish|produce|sendToQueue|sendMessage|subscribe|psubscribe|consume|receiveMessage)\s*\(|\beachMessage\b/,
    modifiers: [
      {
        label: "consumer groups",
        pattern: /\bgroupId\b|\bconsumer\s*group\b/i,
      },
      {
        label: "explicit ack / offset commit",
        pattern:
          /\.(?:ack|nack|commitOffsets|deleteMessage)\s*\(|\backnowledge/i,
      },
      {
        label: "dead-letter routing",
        pattern: /\bdead[-_ ]?letter|\bDLQ\b|\bdeadLetter/i,
      },
      {
        label: "ordering / partition key",
        pattern: /\bpartitionKey\b|\bMessageGroupId\b/,
      },
    ],
    uses: [{ skillId: "redis", when: /redis/i }],
  },
  {
    id: "webhook_verification",
    capabilityId: "webhook_handling",
    technique: "Webhook receiver with signature verification",
    tier: "implementation",
    allOf: [
      [/webhook/i],
      [
        /\b(?:createHmac|timingSafeEqual|constructEvent|verifySignature|verifyWebhook)\b/,
        /x-hub-signature|stripe-signature|svix/i,
      ],
    ],
    anchor:
      /\b(?:createHmac|timingSafeEqual|constructEvent|verifySignature|verifyWebhook)\b|x-hub-signature|stripe-signature|svix/i,
    modifiers: [
      { label: "constant-time comparison", pattern: /\btimingSafeEqual\b/ },
      {
        label: "replay-window check",
        pattern:
          /\btimestamp\b[\s\S]{0,120}\b(?:tolerance|window|maxAge|age)\b/i,
      },
      {
        label: "raw-body handling",
        pattern:
          /\brawBody\b|express\.raw\s*\(|bodyParser\.raw|req\.text\s*\(\)/,
      },
    ],
    uses: [{ skillId: "nodejs", when: /createHmac|timingSafeEqual/ }],
  },

  // ---------------- Reliability ----------------
  {
    id: "retry_with_backoff",
    capabilityId: "retry_backoff",
    technique: "Retry with exponential backoff",
    tier: "implementation",
    allOf: [
      [
        /\bbackoff\b/i,
        /\bMath\.pow\s*\(\s*2\s*,/,
        /\b2\s*\*\*\s*\(?\s*\w*(?:attempt|retry|tries|count)\b/i,
        /\bexponential\b/i,
      ],
      [/\b(?:retry|retries|attempt|attempts|tries)\b/i],
    ],
    anchor:
      /\bbackoff\b|\bMath\.pow\s*\(\s*2\s*,|\b2\s*\*\*\s*\(?\s*\w*(?:attempt|retry|tries|count)\b|\bexponential\b/i,
    modifiers: [
      { label: "jittered", pattern: /\bMath\.random\s*\(\s*\)|\bjitter\b/i },
      {
        label: "capped delay",
        pattern: /\bMath\.min\s*\(|\bmaxDelay\b|\bmaxBackoff\b|\bmax_delay\b/,
      },
      {
        label: "non-retryable errors short-circuit",
        pattern:
          /\b(?:isRetryable|shouldRetry|isRateLimit\w*|nonRetryable|non_retryable|retryable)\b|\bstatus\w*\s*(?:===|<|>=?)\s*4\d\d\b/i,
      },
      {
        label: "bounded attempts",
        pattern:
          /\b(?:maxRetries|max_retries|maxAttempts)\b|\battempt\s*(?:===?|>=?)\s*(?:retries|max\w*)/i,
      },
    ],
  },
  {
    id: "rate_limit_aware_client",
    capabilityId: "rate_limit_handling",
    technique: "Client-side rate-limit detection and handling",
    tier: "usage",
    allOf: [
      // The CLIENT side: comparing a response status to 429 or READING the
      // rate-limit headers. `res.status(429)` / `res.set("Retry-After")` are the
      // server side (see server_rate_limiter) and must not match here.
      [
        /\b(?:status|statusCode)\s*===?\s*429\b/,
        /\.headers?(?:\.get\s*\(|\[)\s*['"`](?:x-ratelimit-(?:remaining|reset)|retry-after)['"`]/i,
      ],
      [/\b(?:sleep|setTimeout|delay|backoff|wait)\b/i],
    ],
    anchor:
      /\b(?:status|statusCode)\s*===?\s*429\b|\.headers?(?:\.get\s*\(|\[)\s*['"`](?:x-ratelimit-(?:remaining|reset)|retry-after)['"`]/i,
    modifiers: [
      {
        label: "honours rate-limit headers",
        pattern:
          /\.headers?(?:\.get\s*\(|\[)\s*['"`](?:x-ratelimit-(?:remaining|reset)|retry-after)['"`]/i,
      },
      {
        label: "distinguishes secondary / abuse limits",
        pattern: /secondary\s+rate\s+limit|abuse\s+detection/i,
      },
      {
        label: "tracks rate-limited state",
        pattern: /\brateLimited\b|\brate_limited\b/,
      },
    ],
  },
  {
    id: "request_timeouts",
    capabilityId: "timeouts_cancellation",
    technique: "Timeouts and cancellation",
    tier: "usage",
    allOf: [
      [
        /\bAbortController\b/,
        /\bAbortSignal\.timeout\b/,
        /\bPromise\.race\s*\(/,
      ],
      [/\btimeout\b/i, /\.abort\s*\(/],
    ],
    anchor: /\bAbortController\b|\bAbortSignal\.timeout\b|\bPromise\.race\s*\(/,
    modifiers: [
      { label: "clears timer on completion", pattern: /\bclearTimeout\s*\(/ },
      {
        label: "propagates cancellation signal to callee",
        pattern: /\bsignal\s*:\s*(?:\w+\.signal|\w*[sS]ignal)\b/,
      },
      {
        label: "distinguishes timeout errors",
        pattern: /\b(?:AbortError|TimeoutError|ETIMEDOUT|ECONNABORTED)\b/,
      },
    ],
  },

  
  {
    id: "cache_with_expiry",
    capabilityId: "application_caching",
    technique: "Cache with expiry",
    tier: "usage",
    allOf: [
      [
        /\b(?:lru-cache|node-cache|cache-manager|keyv)\b/i,
        /\bgetOrSet\b/,
        /\bunstable_cache\b/,
        /\.setex\s*\(/,
        /\bcache\.(?:get|set|wrap)\s*\(/,
      ],
      [
        /\b(?:ttl|maxAge|expiresIn|expires?|revalidate|staleTime)\b/i,
        /['"](?:EX|PX)['"]/,
      ],
    ],
    anchor:
      /\b(?:lru-cache|node-cache|cache-manager|keyv)\b|\bgetOrSet\b|\bunstable_cache\b|\.setex\s*\(|\bcache\.(?:get|set|wrap)\s*\(/i,
    modifiers: [
      {
        label: "explicit invalidation",
        pattern:
          /\b(?:invalidate\w*|revalidateTag|revalidatePath|purge\w*)\b|\bcache\.(?:del|delete)\s*\(|\.unlink\s*\(/i,
      },
      {
        label: "stampede protection",
        pattern:
          /\b(?:singleflight|inflight|in-flight|dedupe|coalesc\w*|mutex|acquireLock)\b/i,
      },
      {
        label: "namespaced cache keys",
        pattern: /\b(?:cacheKey|keyPrefix|buildKey|makeKey)\b/,
      },
      {
        label: "stale-while-revalidate",
        pattern:
          /\bstale[-_ ]?while[-_ ]?revalidate\b|\bstaleWhileRevalidate\b/i,
      },
    ],
    uses: [
      { skillId: "redis", when: /redis|\.setex\s*\(|['"](?:EX|PX)['"]/i },
      { skillId: "nextjs", when: /unstable_cache|revalidate(?:Tag|Path)/ },
    ],
  },

  
  {
    id: "websocket_server",
    capabilityId: "websocket_channels",
    technique: "WebSocket server with event handlers",
    tier: "usage",
    allOf: [
      [imp("ws|socket\\.io|@nestjs/websockets|uWebSockets\\.js")],
      [
        /\.on\s*\(\s*['"](?:connection|message|connect)['"]/,
        /\.emit\s*\(/,
        /\bio\.to\s*\(|\.broadcast\b/,
      ],
    ],
    anchor:
      /\.on\s*\(\s*['"](?:connection|message|connect)['"]|\bio\.to\s*\(|\.broadcast\b/,
    modifiers: [
      {
        label: "room / channel scoping",
        pattern: /\.join\s*\(|\bio\.to\s*\(|\.to\s*\(\s*\w+\s*\)\.emit/,
      },
      {
        label: "handshake authentication",
        pattern: /\bhandshake\b|\bverifyClient\b|\bio\.use\s*\(/,
      },
      {
        label: "heartbeat / liveness",
        pattern: /\b(?:ping|pong|heartbeat)\b/i,
      },
      {
        label: "multi-node adapter",
        pattern: /\bcreateAdapter\b|@socket\.io\/redis-adapter/,
      },
      {
        label: "cleanup on disconnect",
        pattern: /\.on\s*\(\s*['"](?:close|disconnect|disconnecting)['"]/,
      },
    ],
    uses: [{ skillId: "redis", when: /redis-adapter|ioredis/i }],
  },

  
  {
    id: "rest_route_handlers",
    capabilityId: "api_design",
    technique: "REST route handlers",
    tier: "implementation",
    allOf: [
      
      [
        imp(
          "express|fastify|hono|koa|@koa/router|@hapi/hapi|@nestjs/common|next/server",
        ),
        /\bexport\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)\b/,
      ],
      
      [
        /\b(?:router|app|fastify|server|api)\.(?:get|post|put|patch|delete)\s*\(\s*['"`]\//,
        /@(?:Get|Post|Put|Patch|Delete)\s*\(/,
        /\bexport\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)\b/,
      ],
      
      [
        /\b(?:res|reply|c|ctx)\.(?:status|json|send|code)\s*\(/,
        /\b(?:NextResponse|Response)\.json\s*\(/,
        /\bnew\s+Response\s*\(/,
        /\bctx\.body\s*=/,
      ],
    ],
    anchor:
      /\b(?:router|app|fastify|server|api)\.(?:get|post|put|patch|delete)\s*\(\s*['"`]\/|@(?:Get|Post|Put|Patch|Delete)\s*\(|\bexport\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)\b/,
    modifiers: [
      {
        label: "explicit status codes",
        pattern:
          /\.status\s*\(\s*[245]\d\d\s*\)|\bstatus\s*:\s*[245]\d\d\b|\bHttpStatus\b|\.code\s*\(\s*[245]\d\d\s*\)/,
      },
      {
        label: "resource paths with identifiers",
        pattern: /['"`]\/[\w-]+\/:\w+|\[(?:id|slug)\]/,
      },
      {
        label: "pagination",
        pattern: /\b(?:pageSize|per_page|nextCursor|cursor|offset)\b/,
      },
      {
        label: "centralised error handling",
        pattern:
          /\berrorHandler\b|\bsetErrorHandler\b|@Catch\s*\(|\bonError\b|\bapp\.use\s*\(\s*\(\s*err\b/,
      },
      {
        label: "versioned routes",
        pattern: /['"`]\/(?:api\/)?v\d+\//,
      },
      {
        label: "modular routers",
        pattern: /\bRouter\s*\(\s*\)|\bfastify\.register\b|\bnew\s+Hono\b/,
      },
    ],
    uses: [
      { skillId: "express", when: /\bexpress\b/ },
      { skillId: "fastify", when: /\b(?:fastify|hono)\b/i },
      { skillId: "nextjs", when: /next\/server|NextResponse/ },
    ],
  },
  {
    id: "schema_validation",
    capabilityId: "input_validation",
    technique: "Schema validation at a trust boundary",
    tier: "usage",
    allOf: [
      [
        imp(
          "zod|joi|yup|valibot|ajv|class-validator|express-validator|@sinclair/typebox|superstruct|io-ts",
        ),
      ],
      [
        /\.(?:safeParse|parseAsync|parse|validate|validateAsync|safeParseAsync)\s*\(/,
        /\bz\.object\s*\(|\bJoi\.object\s*\(|\byup\.object\s*\(/,
        /@Is[A-Z]\w+\s*\(/,
      ],
    ],
    anchor:
      /\bz\.object\s*\(|\bJoi\.object\s*\(|\byup\.object\s*\(|\.(?:safeParse|parseAsync|validateAsync)\s*\(|@Is[A-Z]\w+\s*\(/,
    modifiers: [
      {
        label: "types inferred from schema",
        pattern: /\bz\.infer\s*<|\bInferType\s*<|\bStatic\s*</,
      },
      {
        label: "applied to request / env input",
        pattern:
          /\b(?:req\.(?:body|query|params)|request\.json\s*\(\)|searchParams|process\.env)\b/,
      },
      {
        label: "structured error mapping",
        pattern: /\b(?:ZodError|ValidationError)\b|\.flatten\s*\(|\.issues\b/,
      },
      {
        label: "cross-field refinement",
        pattern: /\.(?:refine|superRefine|transform)\s*\(/,
      },
    ],
  },
  {
    id: "token_auth",
    capabilityId: "authn_authz",
    technique: "Token / session authentication",
    tier: "usage",
    allOf: [
      [
        imp(
          "jsonwebtoken|jose|passport|passport-\\w+|next-auth|@auth/core|bcrypt|bcryptjs|argon2|@clerk/\\w+|lucia|iron-session",
        ),
      ],
      [
        /\.(?:verify|sign|compare|hash|authenticate)\s*\(/,
        /\bgetServerSession\b|\bjwtVerify\b|\bSignJWT\b|\bgetToken\s*\(/,
      ],
    ],
    anchor:
      /\.(?:verify|sign|compare|hash|authenticate)\s*\(|\bgetServerSession\b|\bjwtVerify\b|\bSignJWT\b|\bgetToken\s*\(/,
    modifiers: [
      { label: "pinned JWT algorithms", pattern: /\balgorithms\s*:\s*\[/ },
      { label: "password hashing", pattern: /\b(?:bcrypt|argon2)\b/i },
      {
        label: "role / permission enforcement",
        pattern:
          /\b(?:hasRole|requireRole|roles?\.includes|permissions?\.includes|authorize|isAdmin|checkPermission)\b/i,
      },
      {
        label: "token expiry / rotation",
        pattern: /\b(?:expiresIn|setExpirationTime|refreshToken|rotate\w*)\b/i,
      },
      {
        label: "hardened cookie flags",
        pattern: /\bhttpOnly\s*:\s*true\b|\bsameSite\b/i,
      },
    ],
  },
  {
    id: "server_rate_limiter",
    capabilityId: "rate_limiting",
    technique: "Server-side rate limiter",
    tier: "usage",
    allOf: [
      [
        imp(
          "express-rate-limit|rate-limiter-flexible|@upstash/ratelimit|@fastify/rate-limit|limiter",
        ),
      ],
      [
        /\brateLimit\s*\(/,
        /\bnew\s+Ratelimit\s*\(/,
        /\bnew\s+RateLimiter\w*\s*\(/,
        /\.consume\s*\(/,
        /\.limit\s*\(/,
      ],
    ],
    anchor:
      /\brateLimit\s*\(|\bnew\s+Ratelimit\s*\(|\bnew\s+RateLimiter\w*\s*\(|\.consume\s*\(/,
    modifiers: [
      {
        label: "sliding window",
        pattern: /sliding[-_ ]?window|slidingWindow/i,
      },
      {
        label: "per-identity keying",
        pattern: /\bkeyGenerator\b|\bkeyPrefix\b|req\.ip\b|x-forwarded-for/i,
      },
      {
        label: "shared / distributed store",
        pattern: /\bRedisStore\b|\bRateLimiterRedis\b|\bstore\s*:/,
      },
      {
        label: "advertises limits to clients",
        pattern: /\bRetry-After\b|standardHeaders/i,
      },
    ],
    uses: [
      { skillId: "redis", when: /redis/i },
      { skillId: "express", when: /express/i },
    ],
  },

  
  {
    id: "migration_files",
    capabilityId: "schema_migrations",
    technique: "Schema migration",
    tier: "usage",
    pathPatterns: [/(?:^|\/)(?:migrations?|migrate)\//],
    allOf: [
      [
        /\b(?:CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX|ADD\s+COLUMN|DROP\s+COLUMN)\b/i,
        /\.(?:createTable|alterTable)\s*\(/,
      ],
    ],
    anchor:
      /\b(?:CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX|ADD\s+COLUMN|DROP\s+COLUMN)\b|\.(?:createTable|alterTable)\s*\(/i,
    modifiers: [
      {
        label: "non-blocking index build",
        pattern:
          /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b|\bconcurrently\s*:\s*true\b/i,
      },
      {
        label: "integrity constraints",
        pattern:
          /\b(?:FOREIGN\s+KEY|REFERENCES|CHECK\s*\(|UNIQUE|NOT\s+NULL)\b/i,
      },
      { label: "data backfill", pattern: /\bUPDATE\b[\s\S]{0,300}?\bSET\b/i },
      {
        label: "reversible (down migration)",
        pattern: /\bexport\s+(?:async\s+)?function\s+down\b|\bdown\s*[:=(]/,
      },
    ],
    uses: [
      { skillId: "sql" },
      { skillId: "prisma", when: /prisma/i },
      {
        skillId: "postgres",
        when: /\b(?:jsonb|SERIAL|uuid_generate_v4|CONCURRENTLY)\b/i,
      },
    ],
  },
  {
    id: "batched_bulk_writes",
    capabilityId: "batched_writes",
    technique: "Batched bulk writes",
    tier: "usage",
    allOf: [
      [
        /\bUNWIND\s+\$\w+/i,
        /\b(?:insertMany|createMany|bulkWrite|bulkCreate|copyFrom)\s*\(/,
        /\bINSERT\s+INTO\b[^;]{0,400}?\bVALUES\b[^;]{0,200}?\)\s*,\s*\(/i,
      ],
      [/\b(?:chunk\w*|batch\w*|BATCH_SIZE)\b|\bslice\s*\(/i],
    ],
    anchor:
      /\bUNWIND\s+\$\w+|\b(?:insertMany|createMany|bulkWrite|bulkCreate|copyFrom)\s*\(|\bINSERT\s+INTO\b/i,
    modifiers: [
      {
        label: "conflict-safe (idempotent) writes",
        pattern:
          /\bskipDuplicates\b|\bON\s+CONFLICT\b|\bINSERT\s+IGNORE\b|\bMERGE\b|\bupsert\b/i,
      },
      {
        label: "configurable batch size",
        pattern: /\bBATCH_SIZE\b|process\.env\.\w*BATCH\w*/i,
      },
      {
        label: "sequential batches (backpressure)",
        pattern: /for\s*\(\s*const\s+\w+\s+of\s+chunk\w*\s*\(/,
      },
      { label: "transactional batch", pattern: /\$transaction|\bBEGIN\b/ },
    ],
    uses: [
      { skillId: "falkordb", when: /UNWIND|falkordb|graph\.query/i },
      { skillId: "prisma", when: /createMany/ },
      { skillId: "mongodb", when: /insertMany|bulkWrite/ },
      { skillId: "sql", when: /INSERT\s+INTO/i },
    ],
  },
  {
    id: "cypher_relationship_queries",
    capabilityId: "graph_modeling",
    technique: "Cypher relationship traversal",
    tier: "usage",
    allOf: [
      [/\b(?:MATCH|MERGE)\s*\(\s*\w*\s*:\s*\w+/],
      [/-\s*\[\s*\w*\s*:\s*[A-Z][A-Z_]+/],
    ],
    anchor: /-\s*\[\s*\w*\s*:\s*[A-Z][A-Z_]+/,
    modifiers: [
      { label: "parameterised queries", pattern: /\$[a-z_]\w*\b/ },
      {
        label: "multi-hop traversal",
        pattern: /-\[[^\]]*\]->?\([^)]*\)<?-\[/,
      },
      {
        label: "aggregation over paths",
        pattern: /\bcount\s*\(\s*DISTINCT\b|\bcollect\s*\(/i,
      },
      {
        label: "index-backed lookups",
        pattern: /\bCREATE\s+(?:VECTOR\s+)?INDEX\s+FOR\b|\bdb\.idx\.\w+/i,
      },
      {
        label: "variable-length paths",
        pattern: /-\[[^\]]*\*\s*\d*\s*\.\.\s*\d*[^\]]*\]-/,
      },
      {
        label: "id-keyed MERGE upserts",
        pattern: /\bMERGE\s*\(\s*\w+\s*:\s*\w+\s*\{\s*id\s*:/,
      },
    ],
    uses: [
      {
        skillId: "falkordb",
        when: /falkordb|GRAPH\.QUERY|selectGraph|graph\.query/i,
      },
    ],
  },

  
  {
    id: "next_rendering_strategy",
    capabilityId: "rendering_strategies",
    technique: "Next.js rendering strategy",
    tier: "usage",
    pathPatterns: [/(?:^|\/)(?:app|pages)\//],
    allOf: [
      [
        /\bexport\s+const\s+revalidate\b/,
        /\brevalidate\s*:\s*\d+/,
        /\bgenerateStaticParams\b/,
        /\bgetStaticProps\b/,
        /\bgetServerSideProps\b/,
        /\bunstable_cache\b/,
        /\bexport\s+const\s+dynamic\s*=/,
        /['"]use server['"]/,
        /\bnext\s*:\s*\{\s*(?:revalidate|tags)/,
      ],
    ],
    anchor:
      /\bexport\s+const\s+revalidate\b|\brevalidate\s*:\s*\d+|\bgenerateStaticParams\b|\bgetStaticProps\b|\bgetServerSideProps\b|\bunstable_cache\b|\bexport\s+const\s+dynamic\s*=|['"]use server['"]/,
    modifiers: [
      {
        label: "on-demand revalidation",
        pattern: /\brevalidate(?:Tag|Path)\b/,
      },
      { label: "streaming with Suspense", pattern: /\bSuspense\b/ },
      {
        label: "static params for dynamic routes",
        pattern: /\bgenerateStaticParams\b|\bgetStaticPaths\b/,
      },
      {
        label: "server action with validation",
        pattern: /['"]use server['"][\s\S]{0,800}\.(?:parse|safeParse)\s*\(/,
      },
      {
        label: "per-route metadata generation",
        pattern: /\bgenerateMetadata\b|\bexport\s+const\s+metadata\b/,
      },
    ],
    uses: [
      { skillId: "nextjs" },
      { skillId: "react", when: /\.(?:tsx|jsx)\b/ },
    ],
  },
];
}
