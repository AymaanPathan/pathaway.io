import { createHash, randomUUID } from "node:crypto";
import type { Graph } from "../../db/falkordb.js";
import {
  SKILL_TAXONOMY,
  matchesSkill,
  type SkillDefinition,
} from "../skill-insights/runtime.js";





import { Domain as _constants } from './constants.js';
import { Domain as _helpers_extra } from './helpers-extra.js';
import { Domain as _helpers } from './helpers.js';
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

export function parseAddedLines(patch: string): AddedLine[] {
  const out: AddedLine[] = [];
  let newLine = 0;

  for (const raw of patch.replace(/\r\n/g, "\n").split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }

    if (newLine === 0) continue; 

    if (raw.startsWith("+")) {
      out.push({ line: newLine, text: raw.slice(1) });
      newLine += 1;
    } else if (raw.startsWith("-") || raw.startsWith("\\")) {
      
    } else {
      newLine += 1; 
    }
  }

  return out;
}

export const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*\/|\*(?!\w)|#(?![[!])|--\s|<!--)/;

export const TEST_PATH =
  /(?:^|\/)(?:__tests__|__mocks__|tests?|specs?|e2e|fixtures?|mocks?|stories)\/|\.(?:test|spec|stories)\.[cm]?[jt]sx?$/i;

export function dedent(lines: string[]): string {
  const indents = lines
    .filter((l) => l.trim().length > 0)
    .map((l) => (/^\s*/.exec(l) as RegExpExecArray)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join("\n");
}

export function depthFor(
  tier: SignalRule["tier"],
  modifierCount: number,
): DemonstrationDepth {
  
  const rank = Math.min(
    3,
    (tier === "usage" ? 1 : 2) + Math.floor(modifierCount / 2),
  );
  return rank >= 3 ? "strong" : rank === 2 ? "implementation" : "usage";
}

export function buildPermalink(
  fullName: string,
  sha: string,
  path: string,
  start: number,
  end: number,
): string {
  if (!fullName || !sha) return "";
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${fullName}/blob/${sha}/${encodedPath}#L${start}-L${end}`;
}

export function extractDemonstrations(
  fc: EvidenceInput,
  ctx: EvidenceContext,
): Demonstration[] {
  if (!fc.patch || TEST_PATH.test(fc.path)) return [];

  const added = parseAddedLines(fc.patch).filter(
    (l) => l.text.trim().length > 0 && !COMMENT_LINE.test(l.text),
  );
  if (added.length === 0) return [];

  const code = added.map((l) => l.text).join("\n");
  const haystack = `${fc.path}\n${code}`;
  const context = deriveContext(fc.path, ctx.commitMessage);

  const found: Demonstration[] = [];

  for (const rule of SIGNAL_RULES) {
    if (rule.pathPatterns && !rule.pathPatterns.some((p) => p.test(fc.path))) {
      continue;
    }
    if (!rule.allOf.every((group) => group.some((p) => p.test(code)))) {
      continue;
    }
    if (rule.excludeIf?.some((p) => p.test(code))) {
      continue;
    }

    const anchorIndex = Math.max(
      0,
      added.findIndex((l) => rule.anchor.test(l.text)),
    );

    // Modifiers are hardening behaviours of THIS mechanism. When the rule asks
    // for it, only count the ones close to the anchor so an unrelated retry
    // loop or UUID elsewhere in the file is not credited to it.
    const windowSize = rule.modifierWindow;
    const anchorLine = added[anchorIndex].line;
    const modifierCode =
      windowSize == null
        ? code
        : added
            .filter((l) => Math.abs(l.line - anchorLine) <= windowSize)
            .map((l) => l.text)
            .join("\n");

    const modifiers = (rule.modifiers ?? [])
      .filter((m) => m.pattern.test(modifierCode))
      .map((m) => m.label);

    const windowLines = added.slice(
      Math.max(0, anchorIndex - SNIPPET_LINES_BEFORE),
      anchorIndex + SNIPPET_LINES_AFTER,
    );
    const startLine = windowLines[0].line;
    const endLine = windowLines[windowLines.length - 1].line;

    let snippet = dedent(windowLines.map((l) => l.text)).trim();
    if (snippet.length > MAX_SNIPPET_CHARS) {
      snippet = `${snippet.slice(0, MAX_SNIPPET_CHARS)}\n…`;
    }

    found.push({
      id: `${fc.id}::${rule.id}`,
      ruleId: rule.id,
      capabilityId: rule.capabilityId,
      technique: rule.technique,
      modifiers,
      depth: depthFor(rule.tier, modifiers.length),
      summary: modifiers.length
        ? `${rule.technique} — ${modifiers.join(", ")}`
        : rule.technique,

      fileChangeId: fc.id,
      repositoryId: fc.repositoryId,
      commitSha: fc.commitSha,
      path: fc.path,
      language: fc.language,
      startLine,
      endLine,
      snippet,
      permalink: buildPermalink(
        ctx.repositoryFullName,
        fc.commitSha,
        fc.path,
        startLine,
        endLine,
      ),

      layerId: context.layerId,
      layerName: context.layerName,
      intent: context.intent,
      commitSubject: context.subject,

      usesSkillIds: (rule.uses ?? [])
        .filter((u) => !u.when || u.when.test(haystack))
        .map((u) => u.skillId),
      createdAt: fc.createdAt,
    });
  }

  return found;
}

export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

export function techniqueSpec(
  ruleId: string,
  description: string,
  minimumDepth: DemonstrationDepth,
  safeguards: SafeguardTuple[],
): TechniqueSpecDefinition {
  const rule = SIGNAL_RULES.find((r) => r.id === ruleId);
  return {
    id: `spec:${ruleId}`,
    // An unknown rule is reported by validateCompletionCriteria().
    capabilityId: rule?.capabilityId ?? "",
    ruleId,
    name: rule?.technique ?? ruleId,
    description,
    minimumDepth,
    safeguards: safeguards.map(([modifierLabel, why, required]) => ({
      id: `safeguard:${ruleId}:${slugify(modifierLabel)}`,
      name: modifierLabel,
      why,
      modifierLabel,
      required,
    })),
  };
}

export const COMPLETION_CRITERIA: TechniqueSpecDefinition[] = [
  // ---- Concurrency & consistency ----
  techniqueSpec(
    "redis_ttl_lock",
    "A lock that cannot be held forever, cannot be released by someone else, and behaves deliberately under contention.",
    "implementation",
    [
      [
        "TTL-bounded (auto-expiry)",
        "Without expiry a crashed holder keeps the lock forever and everything behind it stalls.",
        true,
      ],
      [
        "unique owner token",
        "Without a per-holder token, a client whose lock expired can release the next holder's lock.",
        true,
      ],
      [
        "atomic Lua release (compare-and-delete)",
        "A separate GET then DEL is racy: the lock can change owner between the two calls.",
        true,
      ],
      [
        "retry / wait for lock",
        "Contention needs a defined outcome (bounded wait or fail fast), not an accidental one.",
        true,
      ],
    ],
  ),
  techniqueSpec(
    "row_level_locking",
    "Rows are locked inside a transaction so concurrent writers serialise on the same record.",
    "implementation",
    [
      [
        "SKIP LOCKED work-claiming",
        "Lets many workers claim distinct rows without blocking each other.",
        false,
      ],
      [
        "NOWAIT fail-fast",
        "Fails immediately on contention instead of queueing behind a long lock.",
        false,
      ],
    ],
  ),
  techniqueSpec(
    "db_transactions",
    "Related writes commit or fail together, with a defined failure path.",
    "implementation",
    [
      [
        "explicit rollback path",
        "Without a rollback path a mid-way failure leaves partial writes behind.",
        true,
      ],
      [
        "explicit isolation level",
        "Makes the assumed protection against concurrent writers visible.",
        false,
      ],
      [
        "handles serialization failure / deadlock",
        "Stronger isolation levels abort transactions; callers must retry or surface that.",
        false,
      ],
    ],
  ),
  techniqueSpec(
    "optimistic_version_check",
    "Updates are conditional on the version that was read, and a lost update is detected.",
    "implementation",
    [
      [
        "retries after conflict",
        "A detected conflict should be re-read and retried when the operation is safe to repeat.",
        false,
      ],
      [
        "surfaces conflict to caller",
        "A conflict that is swallowed silently is a lost write again.",
        false,
      ],
    ],
  ),
  techniqueSpec(
    "idempotent_writes",
    "Repeating a request with the same key has the same effect as sending it once.",
    "implementation",
    [
      [
        "stored-response replay",
        "Returning the original result makes a retry indistinguishable from the first call.",
        false,
      ],
      [
        "key expiry",
        "Unbounded key storage grows forever; expiry bounds it.",
        false,
      ],
      [
        "request-hash mismatch check",
        "Rejects a reused key with a different payload instead of returning a wrong answer.",
        false,
      ],
    ],
  ),

  // ---- Asynchronous processing ----
  techniqueSpec(
    "job_queue_workers",
    "Background work that retries sensibly, runs at a bounded rate, and does not lose failures.",
    "implementation",
    [
      [
        "retry policy",
        "Transient failures should be retried a bounded number of times.",
        true,
      ],
      [
        "bounded worker concurrency",
        "Unbounded concurrency overloads the database or the upstream API.",
        true,
      ],
      [
        "failed-job / dead-letter handling",
        "A job that always fails must land somewhere inspectable, not vanish or loop.",
        true,
      ],
      [
        "job de-duplication",
        "Prevents the same work being queued repeatedly.",
        false,
      ],
    ],
  ),
  techniqueSpec(
    "broker_messaging",
    "Messages are consumed with explicit acknowledgement so none are silently lost.",
    "implementation",
    [
      [
        "explicit ack / offset commit",
        "Auto-ack loses messages when a consumer crashes mid-processing.",
        true,
      ],
      [
        "dead-letter routing",
        "Poison messages need a place to go other than blocking the queue.",
        false,
      ],
      [
        "consumer groups",
        "Lets consumers scale horizontally without double-processing.",
        false,
      ],
      [
        "ordering / partition key",
        "Preserves order for related messages when order matters.",
        false,
      ],
    ],
  ),
  techniqueSpec(
    "webhook_verification",
    "Callbacks are authenticated against the raw body and cannot be replayed.",
    "implementation",
    [
      [
        "raw-body handling",
        "A signature is computed over the exact bytes; re-serialised JSON fails or is forged.",
        true,
      ],
      [
        "constant-time comparison",
        "A plain string comparison leaks the signature through timing.",
        true,
      ],
      [
        "replay-window check",
        "Without a timestamp tolerance a captured request can be replayed later.",
        true,
      ],
    ],
  ),

  // ---- Reliability ----
  techniqueSpec(
    "retry_with_backoff",
    "Retries that are spaced, bounded, and skip errors that will never succeed.",
    "implementation",
    [
      [
        "bounded attempts",
        "Unbounded retries turn an outage into an infinite loop.",
        true,
      ],
      [
        "capped delay",
        "Exponential growth without a cap produces absurd waits.",
        true,
      ],
      [
        "jittered",
        "Synchronised retries from many clients hammer a recovering service together.",
        true,
      ],
      [
        "non-retryable errors short-circuit",
        "Retrying a 4xx or a validation error only wastes time.",
        true,
      ],
    ],
  ),
  techniqueSpec(
    "rate_limit_aware_client",
    "The client reads the limit the server communicates and waits accordingly.",
    "usage",
    [
      [
        "honours rate-limit headers",
        "Guessing a delay is worse than using the one the server sent.",
        true,
      ],
      [
        "tracks rate-limited state",
        "Remembering the limited state avoids sending requests that will be rejected.",
        false,
      ],
      [
        "distinguishes secondary / abuse limits",
        "Secondary limits need a longer, different wait than the primary quota.",
        false,
      ],
    ],
  ),
  techniqueSpec(
    "request_timeouts",
    "Slow operations are bounded, actually cancelled, and cleaned up.",
    "implementation",
    [
      [
        "propagates cancellation signal to callee",
        "A timeout that only stops waiting leaves the underlying work running.",
        true,
      ],
      [
        "clears timer on completion",
        "A leaked timer keeps the process alive and fires late.",
        true,
      ],
      [
        "distinguishes timeout errors",
        "Callers need to tell a timeout from a real failure.",
        false,
      ],
    ],
  ),

  // ---- Caching ----
  techniqueSpec(
    "cache_with_expiry",
    "Cached data expires and can be invalidated when its source changes.",
    "implementation",
    [
      [
        "explicit invalidation",
        "Expiry alone serves stale data until the TTL runs out after a write.",
        true,
      ],
      [
        "stampede protection",
        "When a hot key expires, many callers recompute it at once.",
        false,
      ],
      [
        "namespaced cache keys",
        "Prevents collisions between different kinds of cached data.",
        false,
      ],
      [
        "stale-while-revalidate",
        "Serves fast while refreshing in the background.",
        false,
      ],
    ],
  ),

  // ---- Real-time ----
  techniqueSpec(
    "websocket_server",
    "Connections are authenticated at the handshake and cleaned up when they end.",
    "implementation",
    [
      [
        "handshake authentication",
        "An unauthenticated socket can subscribe to anything it can name.",
        true,
      ],
      [
        "cleanup on disconnect",
        "Leaked listeners and room memberships accumulate with every dropped client.",
        true,
      ],
      ["room / channel scoping", "Limits what each client receives.", false],
      [
        "heartbeat / liveness",
        "Detects half-open connections that never fire a close event.",
        false,
      ],
      [
        "multi-node adapter",
        "Broadcasts must reach clients connected to other server instances.",
        false,
      ],
    ],
  ),

  // ---- API design & security ----
  techniqueSpec(
    "rest_route_handlers",
    "Endpoints return deliberate status codes and route failures through one handler.",
    "implementation",
    [
      [
        "explicit status codes",
        "Clients rely on status codes to tell success from failure.",
        true,
      ],
      [
        "centralised error handling",
        "Per-route try/catch drifts; one handler gives one error contract.",
        true,
      ],
      [
        "resource paths with identifiers",
        "Resource-oriented paths are what makes the API REST.",
        false,
      ],
      ["pagination", "Unbounded list endpoints do not scale.", false],
      [
        "versioned routes",
        "Lets the contract evolve without breaking clients.",
        false,
      ],
      ["modular routers", "Keeps route groups separable.", false],
    ],
  ),
  techniqueSpec(
    "schema_validation",
    "External input is parsed against a schema and failures are reported in a structured way.",
    "implementation",
    [
      [
        "applied to request / env input",
        "A schema that never touches real input validates nothing.",
        true,
      ],
      [
        "structured error mapping",
        "Callers need field-level errors, not a thrown stack trace.",
        true,
      ],
      [
        "types inferred from schema",
        "One definition for runtime checks and static types cannot drift.",
        false,
      ],
      [
        "cross-field refinement",
        "Some rules span fields and cannot be expressed per field.",
        false,
      ],
    ],
  ),
  techniqueSpec(
    "token_auth",
    "Credentials are verified, expire, and are checked against permissions.",
    "implementation",
    [
      [
        "token expiry / rotation",
        "A token that never expires is a permanent credential once leaked.",
        true,
      ],
      [
        "role / permission enforcement",
        "Authentication says who; authorization decides what they may do.",
        true,
      ],
      [
        "pinned JWT algorithms",
        "Accepting any algorithm enables algorithm-confusion attacks.",
        false,
      ],
      [
        "password hashing",
        "Passwords must be stored with a slow, salted hash.",
        false,
      ],
      [
        "hardened cookie flags",
        "httpOnly and sameSite limit cookie theft and CSRF.",
        false,
      ],
    ],
  ),
  techniqueSpec(
    "server_rate_limiter",
    "Limits are applied per caller, not globally, and tell the client when to retry.",
    "implementation",
    [
      [
        "per-identity keying",
        "A single global counter lets one client lock out everyone.",
        true,
      ],
      [
        "advertises limits to clients",
        "Retry-After lets well-behaved clients back off correctly.",
        false,
      ],
      [
        "shared / distributed store",
        "In-memory counters are per-instance and reset on deploy.",
        false,
      ],
      [
        "sliding window",
        "Fixed windows allow a burst at each boundary.",
        false,
      ],
    ],
  ),

  // ---- Data layer ----
  techniqueSpec(
    "migration_files",
    "Schema changes enforce integrity at the database, not only in application code.",
    "implementation",
    [
      [
        "integrity constraints",
        "Constraints are the last defence when application code has a bug.",
        true,
      ],
      [
        "non-blocking index build",
        "A plain index build can lock a hot table.",
        false,
      ],
      [
        "data backfill",
        "New required columns need values for existing rows.",
        false,
      ],
      [
        "reversible (down migration)",
        "Allows a bad deploy to be rolled back.",
        false,
      ],
    ],
  ),
  techniqueSpec(
    "batched_bulk_writes",
    "Many records are written in bounded batches and re-running the write is safe.",
    "implementation",
    [
      [
        "conflict-safe (idempotent) writes",
        "A re-run after a partial failure must not duplicate or crash.",
        true,
      ],
      [
        "configurable batch size",
        "Batch size is a tuning knob that depends on the database.",
        false,
      ],
      [
        "sequential batches (backpressure)",
        "Firing all batches at once overloads the database.",
        false,
      ],
      ["transactional batch", "Makes each batch all-or-nothing.", false],
    ],
  ),
  techniqueSpec(
    "cypher_relationship_queries",
    "Graph queries are parameterised rather than built by string concatenation.",
    "implementation",
    [
      [
        "parameterised queries",
        "Interpolated values are an injection risk and defeat query caching.",
        true,
      ],
      [
        "id-keyed MERGE upserts",
        "Keying MERGE on id keeps writes idempotent.",
        false,
      ],
      [
        "multi-hop traversal",
        "Uses the graph for what a join table cannot do cheaply.",
        false,
      ],
      [
        "aggregation over paths",
        "Summarises relationships inside the database.",
        false,
      ],
      [
        "index-backed lookups",
        "Unindexed MATCH scans every node of a label.",
        false,
      ],
      ["variable-length paths", "Walks relationships of unknown depth.", false],
    ],
  ),

  // ---- Frontend delivery ----
  techniqueSpec(
    "next_rendering_strategy",
    "A rendering choice is made deliberately and paired with a way to keep content fresh.",
    "implementation",
    [
      [
        "on-demand revalidation",
        "Time-based revalidation alone cannot reflect a write immediately.",
        false,
      ],
      [
        "static params for dynamic routes",
        "Lets dynamic routes be pre-rendered.",
        false,
      ],
      [
        "streaming with Suspense",
        "Shows the shell before slow data arrives.",
        false,
      ],
      [
        "server action with validation",
        "Server actions are public endpoints and need input validation.",
        false,
      ],
      [
        "per-route metadata generation",
        "Makes each rendered page discoverable.",
        false,
      ],
    ],
  ),
];
}
