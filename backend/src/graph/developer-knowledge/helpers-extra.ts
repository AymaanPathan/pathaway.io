import { createHash, randomUUID } from "node:crypto";
import type { Graph } from "../../db/falkordb.js";
import {
  SKILL_TAXONOMY,
  matchesSkill,
  type SkillDefinition,
} from "../skill-insights/runtime.js";




import { Domain as _constants } from './constants.js';
import { Domain as _helpers_extra2 } from './helpers-extra2.js';
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

export const COMPLETION_CRITERIA_BY_CAPABILITY = new Map<
  string,
  TechniqueSpecDefinition[]
>(
  LEARNABLE_CAPABILITIES.map((c) => [
    c.id,
    COMPLETION_CRITERIA.filter((spec) => spec.capabilityId === c.id),
  ]),
);

export const TECHNOLOGY_NAMES: Record<string, string> = {
  redis: "Redis",
  postgres: "PostgreSQL",
  postgresql: "PostgreSQL",
  sql: "SQL",
  prisma: "Prisma",
  mongodb: "MongoDB",
  falkordb: "FalkorDB",
  nodejs: "Node.js",
  express: "Express",
  nextjs: "Next.js",
  react: "React",
};

export function normalizeExperiencePart(value: string): string {
  return safeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function experienceFingerprintFor(d: Demonstration): string {
  const raw = [
    normalizeExperiencePart(d.capabilityId),
    normalizeExperiencePart(d.technique),
  ].join("|");
  return hashExperienceFingerprint(raw);
}

export function problemFingerprintFor(d: Demonstration): string {
  return hashExperienceFingerprint(
    [
      normalizeExperiencePart(d.capabilityId),
      normalizeExperiencePart(d.intent || "change"),
    ].join("|"),
  );
}

export function techniqueIdFor(technique: string): string {
  return `technique:${hashExperienceFingerprint(normalizeExperiencePart(technique))}`;
}

export function representativeProblemFor(
  demos: Demonstration[],
  capabilityId: string,
): string {
  const meaningful = demos
    .map((d) => d.commitSubject.trim())
    .filter((subject) => subject.length > 3)
    .filter(
      (subject) => !/^(?:update|changes?|chore|misc|wip|work)$/i.test(subject),
    );

  if (meaningful.length > 0) {
    return meaningful.sort((a, b) => b.length - a.length)[0].slice(0, 240);
  }

  return (
    CAPABILITY_BY_ID.get(capabilityId)?.description ??
    `The system needed to support ${capabilityId.replace(/_/g, " ")}.`
  );
}

export function buildExperienceSummary(demos: Demonstration[]): string {
  const first = demos[0];
  if (!first) return "Engineering experience";

  const modifierCounts = new Map<string, number>();
  for (const d of demos) {
    for (const modifier of d.modifiers) {
      modifierCounts.set(modifier, (modifierCounts.get(modifier) ?? 0) + 1);
    }
  }

  const topModifiers = Array.from(modifierCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([modifier]) => modifier);

  return topModifiers.length > 0
    ? `${first.technique} — ${topModifiers.join(", ")}`
    : first.technique;
}

export function buildEngineeringExperiences(
  demos: Demonstration[],
  buildId?: string,
  developerId?: string,
): EngineeringExperience[] {
  const groups = new Map<string, Demonstration[]>();

  for (const demo of demos) {
    const key = experienceFingerprintFor(demo);
    const list = groups.get(key);
    if (list) list.push(demo);
    else groups.set(key, [demo]);
  }

  // Ids are developer-scoped whenever a developer is known. The un-scoped form
  // only exists for the pure/exported grouping helper, which never writes.
  const scope = developerId ? `${developerId}:` : "";

  return Array.from(groups.entries()).map(([fingerprint, group]) => {
    const sorted = [...group].sort((a, b) => {
      const depthDiff = DEPTH_RANK[b.depth] - DEPTH_RANK[a.depth];
      if (depthDiff !== 0) return depthDiff;
      return Date.parse(b.createdAt || "") - Date.parse(a.createdAt || "");
    });

    const representative = sorted[0];
    const commits = new Set(
      group.map((d) => `${d.repositoryId}:${d.commitSha}`),
    );
    const repositories = new Set(
      group.map((d) => d.repositoryId).filter(Boolean),
    );
    const activeDays = new Set<string>();
    const technologyIds = new Set<string>();
    const contextIds = new Set<string>();
    const fileChangeIds = new Set<string>();

    let firstSeenTs = Number.POSITIVE_INFINITY;
    let lastSeenTs = 0;
    let bestDepth: DemonstrationDepth = "usage";

    for (const demo of group) {
      if (DEPTH_RANK[demo.depth] > DEPTH_RANK[bestDepth]) {
        bestDepth = demo.depth;
      }

      const ts = Date.parse(demo.createdAt || "");
      if (Number.isFinite(ts)) {
        firstSeenTs = Math.min(firstSeenTs, ts);
        lastSeenTs = Math.max(lastSeenTs, ts);
        activeDays.add(new Date(ts).toISOString().slice(0, 10));
      }

      if (demo.fileChangeId) fileChangeIds.add(demo.fileChangeId);
      if (demo.layerId) contextIds.add(demo.layerId);
      for (const skillId of demo.usesSkillIds) {
        if (TECHNOLOGY_NAMES[skillId]) technologyIds.add(skillId);
      }
    }

    const experienceId = `exp:${scope}${fingerprint}`;
    const problemId = `problem:${scope}${problemFingerprintFor(representative)}`;

    return {
      id: experienceId,
      fingerprint,
      summary: buildExperienceSummary(group),
      problemStatement: representativeProblemFor(
        group,
        representative.capabilityId,
      ),
      problemId,
      capabilityId: representative.capabilityId,
      technique: representative.technique,
      technologyIds: Array.from(technologyIds),
      repositoryIds: Array.from(repositories),
      contextIds: Array.from(contextIds),
      evidenceCount: group.length,
      commitCount: commits.size,
      repoCount: repositories.size,
      activeDays: activeDays.size,
      bestDepth,
      firstSeen: Number.isFinite(firstSeenTs)
        ? new Date(firstSeenTs).toISOString()
        : "",
      lastSeen: lastSeenTs ? new Date(lastSeenTs).toISOString() : "",
      demonstrationIds: group.map((d) => d.id),
      fileChangeIds: Array.from(fileChangeIds),
      buildId,
    };
  });
}

export function groupDemonstrationsIntoExperiences(
  demos: Demonstration[],
  developerId?: string,
): EngineeringExperience[] {
  return buildEngineeringExperiences(demos, undefined, developerId);
}

export const EVIDENCE_STATE_BY_LEVEL: Record<
  CapabilityLevel | "missing",
  EvidenceState
> = {
  strong: "demonstrated",
  implementation: "demonstrated",
  repeated_usage: "partial",
  usage: "partial",
  insufficient_evidence: "unverified",
  missing: "unverified",
};

export const PREREQUISITE_SATISFIED_BY: readonly EvidenceState[] = [
  "demonstrated",
];

export function evidenceStateFor(level: string): EvidenceState {
  return (
    EVIDENCE_STATE_BY_LEVEL[level as CapabilityLevel | "missing"] ??
    "unverified"
  );
}

export function levelsInStates(
  states: readonly EvidenceState[],
): Array<CapabilityLevel | "missing"> {
  return (
    Object.entries(EVIDENCE_STATE_BY_LEVEL) as Array<
      [CapabilityLevel | "missing", EvidenceState]
    >
  )
    .filter(([, state]) => states.includes(state))
    .map(([level]) => level);
}

export const commitKey = (d: Demonstration): string =>
  `${d.repositoryId}:${d.commitSha}`;

export function recencyFor(lastSeenTs: number, now: number): Recency {
  if (!lastSeenTs) return "historical";
  const days = (now - lastSeenTs) / 86_400_000;
  if (days <= RECENT_DAYS) return "recent";
  if (days <= HISTORICAL_DAYS) return "historical";
  return "inactive";
}

export function summarise(
  capabilityId: string,
  demos: Demonstration[],
  now: number,
): CapabilityRollup {
  const commits = new Set(demos.map(commitKey));
  const repos = new Set(demos.map((d) => d.repositoryId));
  const days = new Set<string>();
  const techniques = new Map<string, number>();

  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  let bestDepth: DemonstrationDepth = "usage";

  for (const d of demos) {
    techniques.set(d.technique, (techniques.get(d.technique) ?? 0) + 1);
    if (DEPTH_RANK[d.depth] > DEPTH_RANK[bestDepth]) bestDepth = d.depth;

    const ts = Date.parse(d.createdAt);
    if (Number.isFinite(ts)) {
      first = Math.min(first, ts);
      last = Math.max(last, ts);
      days.add(new Date(ts).toISOString().slice(0, 10));
    }
  }

  const implemented = demos.filter((d) => d.depth !== "usage");
  const implementedCommits = new Set(implemented.map(commitKey));
  const hasStrong = demos.some((d) => d.depth === "strong");

  let level: CapabilityLevel;
  if (hasStrong && implementedCommits.size >= 2) level = "strong";
  else if (implemented.length > 0) level = "implementation";
  else if (commits.size >= 2) level = "repeated_usage";
  else if (demos.length === 1) level = "insufficient_evidence";
  else level = "usage";

  const topTechniques = Array.from(techniques.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([technique, count]) => ({ technique, count }));

  return {
    capabilityId,
    level,
    recency: recencyFor(last, now),
    bestDepth,
    evidenceCount: demos.length,
    commitCount: commits.size,
    repoCount: repos.size,
    techniqueCount: techniques.size,
    activeDays: days.size,
    firstSeen: Number.isFinite(first) ? new Date(first).toISOString() : "",
    lastSeen: last ? new Date(last).toISOString() : "",
    techniquesJson: JSON.stringify(topTechniques),
  };
}

export function rollUpDemonstrations(
  demos: Demonstration[],
  now: number = Date.now(),
): CapabilityRollup[] {
  const groups = new Map<string, Demonstration[]>();

  const add = (id: string, d: Demonstration) => {
    const list = groups.get(id);
    if (list) list.push(d);
    else groups.set(id, [d]);
  };

  for (const d of demos) {
    add(d.capabilityId, d);
    const parentId = CAPABILITY_BY_ID.get(d.capabilityId)?.parentId;
    if (parentId) add(parentId, d);
  }

  return Array.from(groups.entries()).map(([id, list]) =>
    summarise(id, list, now),
  );
}

export const GOAL_INDEXES: Array<{ label: string; property: string }> = [
  { label: "Goal", property: "id" },
  { label: "Concept", property: "id" },
];

export const CAPABILITY_DEPENDENCIES: Record<string, CapabilityDependency> = {
  distributed_locking: {
    requires: [],
    noPrerequisiteReason:
      "Needs a shared store such as Redis, which is a technology, not another capability here.",
  },
  transactional_integrity: {
    requires: [],
    noPrerequisiteReason:
      "Built directly on the database; nothing comes before it.",
  },
  optimistic_concurrency: {
    requires: [],
    noPrerequisiteReason:
      "A single version-conditioned UPDATE detects a lost write; it is an alternative to a transaction, not built on one.",
  },
  idempotent_operations: {
    requires: [],
    noPrerequisiteReason:
      "A dedupe key plus an upsert; usable in any write path.",
  },
  job_queues: {
    requires: [],
    noPrerequisiteReason: "Needs a queue library, not a prior capability.",
  },
  event_messaging: {
    requires: [],
    noPrerequisiteReason: "Needs a broker client, not a prior capability.",
  },
  webhook_handling: {
    requires: [
      {
        capabilityId: "api_design",
        reason:
          "A webhook receiver is an HTTP endpoint that has to be routed and answered with correct status codes.",
      },
    ],
  },
  retry_backoff: {
    requires: [],
    noPrerequisiteReason:
      "Retries react to error responses; no timeout is needed to have something to retry.",
  },
  rate_limit_handling: {
    requires: [],
    noPrerequisiteReason:
      "Reading 429 / Retry-After and waiting does not require a general retry mechanism.",
  },
  timeouts_cancellation: {
    requires: [],
    noPrerequisiteReason:
      "Built on AbortController / timers; nothing comes before it.",
  },
  application_caching: {
    requires: [],
    noPrerequisiteReason:
      "A cache with expiry is complete without locks; stampede protection is a safeguard, not a prerequisite.",
  },
  websocket_channels: {
    requires: [],
    noPrerequisiteReason:
      "A socket server can be built first; handshake authentication is a required safeguard in its completion criteria.",
  },
  api_design: {
    requires: [],
    noPrerequisiteReason: "The base of the API-engineering domain.",
  },
  input_validation: {
    requires: [],
    noPrerequisiteReason:
      "Applies to any trust boundary (CLI, env, webhooks, server actions), not only REST endpoints.",
  },
  authn_authz: {
    requires: [],
    noPrerequisiteReason:
      "Applies to server components, sockets and CLIs too, not only REST endpoints.",
  },
  rate_limiting: {
    requires: [
      {
        capabilityId: "api_design",
        reason:
          "A server-side limiter is middleware on an endpoint; there is nothing to limit without one.",
      },
    ],
  },
  schema_migrations: {
    requires: [],
    noPrerequisiteReason: "Built directly on the database.",
  },
  batched_writes: {
    requires: [],
    noPrerequisiteReason: "Built directly on the database client.",
  },
  graph_modeling: {
    requires: [],
    noPrerequisiteReason: "Built directly on the graph database.",
  },
  rendering_strategies: {
    requires: [],
    noPrerequisiteReason: "Built directly on the framework.",
  },
};

export const prerequisite = (
  from: string,
  to: string,
  reason: string,
): CapabilityRelationship => ({
  from,
  to,
  type: "PREREQUISITE_OF",
  weight: 1,
  reason,
});

export const related = (
  a: string,
  b: string,
  reason = "",
): CapabilityRelationship => ({
  from: a,
  to: b,
  type: "RELATED_TO",
  weight: 2,
  reason,
});

export const DECLARED_PREREQUISITES: CapabilityRelationship[] = Object.entries(
  CAPABILITY_DEPENDENCIES,
).flatMap(([capabilityId, dep]) =>
  dep.requires.map((req) =>
    prerequisite(req.capabilityId, capabilityId, req.reason),
  ),
);

export const DECLARED_RELATIONS: CapabilityRelationship[] = [
  // reinforce each other, no required order
  related("transactional_integrity", "idempotent_operations"),
  related("transactional_integrity", "distributed_locking"),
  related("transactional_integrity", "optimistic_concurrency"),
  related("distributed_locking", "idempotent_operations"),
  related("job_queues", "event_messaging"),
  related("webhook_handling", "idempotent_operations"),
  related("webhook_handling", "job_queues"),
  related("event_messaging", "idempotent_operations"),
  related("retry_backoff", "idempotent_operations"),
  related("retry_backoff", "rate_limit_handling"),
  related("timeouts_cancellation", "retry_backoff"),
  related("api_design", "input_validation"),
  related("api_design", "authn_authz"),
  related("input_validation", "authn_authz"),
  related("authn_authz", "rate_limiting"),
  related("authn_authz", "websocket_channels"),
  related("rate_limit_handling", "rate_limiting"),
  related("batched_writes", "transactional_integrity"),
  related("graph_modeling", "transactional_integrity"),
  related("graph_modeling", "batched_writes"),
  // stampede protection can use a lock, but neither needs the other
  related("application_caching", "distributed_locking"),
  related("application_caching", "rendering_strategies"),
  related("websocket_channels", "event_messaging"),
];

export const CAPABILITY_GRAPH_RELATIONSHIPS: CapabilityRelationship[] = [
  ...DECLARED_PREREQUISITES,
  ...DECLARED_RELATIONS,
];

export const MAX_PREREQUISITE_DEPTH = 10;

export function validateCompletionCriteria(
  specs: readonly TechniqueSpecDefinition[] = COMPLETION_CRITERIA,
): CapabilityGraphProblem[] {
  const problems: CapabilityGraphProblem[] = [];
  const add = (code: CapabilityGraphProblem["code"], message: string) =>
    problems.push({ code, message });

  const seenSpecs = new Set<string>();
  const covered = new Set<string>();

  for (const spec of specs) {
    if (seenSpecs.has(spec.id)) {
      add("criteria_duplicate", `${spec.id}: listed twice`);
    }
    seenSpecs.add(spec.id);

    const rule = SIGNAL_RULES.find((r) => r.id === spec.ruleId);
    if (!rule) {
      add(
        "criteria_unknown_rule",
        `${spec.id}: no SIGNAL_RULE "${spec.ruleId}"`,
      );
      continue;
    }
    covered.add(rule.capabilityId);

    const labels = new Set((rule.modifiers ?? []).map((m) => m.label));
    const seenSafeguards = new Set<string>();
    for (const s of spec.safeguards) {
      if (!labels.has(s.modifierLabel)) {
        add(
          "criteria_unknown_safeguard",
          `${spec.id}: safeguard "${s.modifierLabel}" is not a modifier of rule ${rule.id}, so it can never be observed`,
        );
      }
      if (seenSafeguards.has(s.modifierLabel)) {
        add(
          "criteria_duplicate",
          `${spec.id}: safeguard "${s.modifierLabel}" listed twice`,
        );
      }
      seenSafeguards.add(s.modifierLabel);
    }

    const reachable = depthFor(rule.tier, labels.size);
    if (DEPTH_RANK[reachable] < DEPTH_RANK[spec.minimumDepth]) {
      add(
        "criteria_depth_unreachable",
        `${spec.id}: asks for ${spec.minimumDepth} but rule ${rule.id} can reach at most ${reachable}`,
      );
    }
  }

  for (const c of LEARNABLE_CAPABILITIES) {
    if (!covered.has(c.id)) {
      add(
        "criteria_missing",
        `${c.id} has no technique spec, so it can never be judged complete`,
      );
    }
  }

  return problems;
}

export function validateCapabilityGraph(
  relationships: readonly CapabilityRelationship[] = CAPABILITY_GRAPH_RELATIONSHIPS,
): CapabilityGraphProblem[] {
  const problems: CapabilityGraphProblem[] = [];
  const add = (code: CapabilityGraphProblem["code"], message: string) =>
    problems.push({ code, message });

  const seenEdges = new Set<string>();
  const typesByPair = new Map<string, Set<string>>();
  const prerequisiteTo = new Map<string, string[]>();
  const named = new Set<string>();
  const capabilitiesWithRules = new Set(
    SIGNAL_RULES.map((rule) => rule.capabilityId),
  );

  // SPECIALIZES comes from parentId: it must point at a real category.
  for (const c of CAPABILITIES) {
    if (c.parentId === null) continue;
    const parent = CAPABILITY_BY_ID.get(c.parentId);
    if (!parent || parent.parentId !== null) {
      add(
        "invalid_parent",
        `${c.id} -[SPECIALIZES]-> ${c.parentId}: parent must be an existing category`,
      );
    }
  }

  // Dependency audit: every learnable capability has an explicit answer.
  for (const c of LEARNABLE_CAPABILITIES) {
    const dep = CAPABILITY_DEPENDENCIES[c.id];
    if (!dep) {
      add(
        "dependency_audit_missing",
        `${c.id} has no CAPABILITY_DEPENDENCIES entry; an empty list is fine but must be explicit`,
      );
      continue;
    }
    if (
      dep.requires.length === 0 &&
      !safeString(dep.noPrerequisiteReason).trim()
    ) {
      add(
        "dependency_audit_invalid",
        `${c.id} has no prerequisites but gives no noPrerequisiteReason`,
      );
    }
    for (const req of dep.requires) {
      if (!safeString(req.reason).trim()) {
        add(
          "missing_reason",
          `${req.capabilityId} -[PREREQUISITE_OF]-> ${c.id}: a prerequisite needs a written reason`,
        );
      }
    }
  }
  for (const id of Object.keys(CAPABILITY_DEPENDENCIES)) {
    if (!isLearnableCapability(id)) {
      add(
        "dependency_audit_invalid",
        `${id} is in CAPABILITY_DEPENDENCIES but is not a learnable capability`,
      );
    }
  }

  for (const r of relationships) {
    const label = `${r.from} -[${r.type}]-> ${r.to}`;
    const a = CAPABILITY_BY_ID.get(r.from);
    const b = CAPABILITY_BY_ID.get(r.to);

    if (!a || !b) {
      add("unknown_capability", `${label}: not in CAPABILITIES`);
      continue;
    }
    if (r.from === r.to) {
      add("self_loop", `${label}: a capability cannot relate to itself`);
      continue;
    }
    if (a.parentId === null || b.parentId === null) {
      add(
        "category_endpoint",
        `${label}: a domain is a category, not a learnable capability. ` +
          `Point the edge at the specific capabilities instead.`,
      );
      continue;
    }
    if (r.type === "PREREQUISITE_OF" && !safeString(r.reason).trim()) {
      add("missing_reason", `${label}: a prerequisite needs a written reason`);
    }

    const pair = [r.from, r.to].sort().join("~");
    const edgeKey =
      r.type === "RELATED_TO"
        ? `RELATED_TO:${pair}`
        : `${r.type}:${r.from}>${r.to}`;
    if (seenEdges.has(edgeKey)) add("duplicate_edge", `${label}: listed twice`);
    seenEdges.add(edgeKey);

    const types = typesByPair.get(pair) ?? new Set<string>();
    types.add(r.type);
    typesByPair.set(pair, types);
    if (types.size > 1) {
      add(
        "conflicting_edge_types",
        `${r.from} and ${r.to} are both PREREQUISITE_OF and RELATED_TO: pick one`,
      );
    }

    named.add(r.from);
    named.add(r.to);
    if (r.type === "PREREQUISITE_OF") {
      const next = prerequisiteTo.get(r.from) ?? [];
      next.push(r.to);
      prerequisiteTo.set(r.from, next);
    }
  }

  // Cycles: a loop of prerequisites could never be satisfied.
  const colour = new Map<string, 1 | 2>(); // 1 = on the current path, 2 = done
  const stack: string[] = [];
  let cyclic = false;
  const visit = (id: string): void => {
    colour.set(id, 1);
    stack.push(id);
    for (const next of prerequisiteTo.get(id) ?? []) {
      const c = colour.get(next);
      if (c === 1) {
        cyclic = true;
        add(
          "prerequisite_cycle",
          `prerequisite cycle: ${[...stack.slice(stack.indexOf(next)), next].join(" -> ")}`,
        );
      } else if (c === undefined) {
        visit(next);
      }
    }
    stack.pop();
    colour.set(id, 2);
  };
  for (const id of prerequisiteTo.keys()) {
    if (!colour.has(id)) visit(id);
  }

  // Depth: the frontier query follows at most MAX_PREREQUISITE_DEPTH edges.
  if (!cyclic) {
    const height = new Map<string, number>();
    const heightOf = (id: string): number => {
      const known = height.get(id);
      if (known !== undefined) return known;
      const h = Math.max(
        0,
        ...(prerequisiteTo.get(id) ?? []).map((next) => heightOf(next) + 1),
      );
      height.set(id, h);
      return h;
    };
    const longest = Math.max(0, ...[...prerequisiteTo.keys()].map(heightOf));
    if (longest > MAX_PREREQUISITE_DEPTH) {
      add(
        "path_too_deep",
        `longest prerequisite chain is ${longest}, the frontier follows ${MAX_PREREQUISITE_DEPTH}`,
      );
    }
  }

  // Evidence: a capability nothing can demonstrate would block its dependents.
  for (const id of named) {
    if (!capabilitiesWithRules.has(id)) {
      add(
        "no_evidence_rule",
        `${id} has no SIGNAL_RULE, so it can never be demonstrated`,
      );
    }
  }

  return problems;
}

export const conceptKey = (name: string): string =>
  safeString(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "_");

export function resolveConceptProposals(proposals: ConceptProposal[]): {
  reuse: Array<{ id: string; name: string }>;
  create: Array<{
    key: string;
    name: string;
    parentId: string;
    description: string;
  }>;
} {
  const reuse: Array<{ id: string; name: string }> = [];
  const create: Array<{
    key: string;
    name: string;
    parentId: string;
    description: string;
  }> = [];
  const seen = new Set<string>();

  for (const p of proposals) {
    const key = conceptKey(p.name);
    if (!key || seen.has(key)) continue;
    if (!isLearnableCapability(p.parentId)) continue;
    seen.add(key);

    const cap = CAPABILITIES.find(
      (c) => c.id === key || conceptKey(c.name) === key,
    );
    if (cap) {
      reuse.push({ id: cap.id, name: cap.name });
      continue;
    }

    create.push({
      key,
      name: safeString(p.name).trim().slice(0, 80),
      parentId: p.parentId,
      description: safeString(p.description).slice(0, 200),
    });
  }

  return { reuse, create };
}

export async function setDeveloperGoal(
  graph: Graph,
  developerId: string,
  goal: GoalDefinition,
  requirements: GoalRequirement[],
): Promise<void> {
  if (!developerId) throw new Error("Missing developerId");
  if (!goal.id) throw new Error("Missing goal id");

  // A goal requires LEARNABLE capabilities. A category named by mistake is
  // expanded into its learnable children (so the intent is kept) instead of
  // asking the developer to "demonstrate" a label no evidence is tracked for.
  const learnableRequirements = new Map<string, GoalRequirement>();
  for (const r of requirements) {
    const cap = CAPABILITY_BY_ID.get(r.capabilityId);
    if (!cap) continue;
    const targets = cap.parentId
      ? [cap.id]
      : LEARNABLE_CAPABILITIES.filter((l) => l.parentId === cap.id).map(
          (l) => l.id,
        );
    for (const id of targets) {
      const prev = learnableRequirements.get(id);
      if (!prev || (r.priority ?? 0) > (prev.priority ?? 0)) {
        learnableRequirements.set(id, { ...r, capabilityId: id });
      }
    }
  }

  const validRequirements = [...learnableRequirements.values()].map((r) => ({
    capability_id: r.capabilityId,
    priority: Number.isFinite(r.priority) ? Math.max(0, r.priority ?? 0) : 0,
    reason: r.reason ?? "",
  }));

  await ensureGoalIndexes(graph);
  await ensureCapabilityGraph(graph);

  // 1) Remove any existing goal link. Its own query, so it is fine
  //    if there is nothing to remove.
  await graph.query(
    `
    MATCH (d:Developer {id: $developer_id})-[old:HAS_GOAL]->(:Goal)
    DELETE old
    `,
    { params: { developer_id: developerId } },
  );

  // 2) Create or update the goal and link it. This always runs.
  await graph.query(
    `
    MATCH (d:Developer {id: $developer_id})
    MERGE (g:Goal {id: $goal_id})
    SET g.name = $name,
        g.description = $description,
        g.unsupported = $unsupported,
        g.updated_at = $updated_at
    MERGE (d)-[:HAS_GOAL]->(g)
    `,
    {
      params: {
        developer_id: developerId,
        goal_id: goal.id,
        name: goal.name,
        description: goal.description,
        unsupported: (goal.unsupported ?? [])
          .map((s) => safeString(s).trim())
          .filter(Boolean)
          .join(" | "),
        updated_at: new Date().toISOString(),
      },
    },
  );

  // 3) Replace this goal's requirements and concept mentions.
  await graph.query(
    `
    MATCH (g:Goal {id: $goal_id})-[r:REQUIRES]->(:Capability)
    DELETE r
    `,
    { params: { goal_id: goal.id } },
  );

  await graph.query(
    `
    MATCH (g:Goal {id: $goal_id})-[r:MENTIONS]->(:Concept)
    DELETE r
    `,
    { params: { goal_id: goal.id } },
  );

  if (validRequirements.length === 0) return;

  await graph.query(
    `
    UNWIND $requirements AS item
    MATCH (g:Goal {id: $goal_id})
    MATCH (c:Capability {id: item.capability_id})
    MERGE (g)-[r:REQUIRES]->(c)
    SET r.priority = item.priority,
        r.reason = item.reason
    `,
    {
      params: {
        goal_id: goal.id,
        requirements: asQueryParams(validRequirements),
      },
    },
  );
}

export const DEMONSTRATION_INDEXES: Array<{ label: string; property: string }> = [
  { label: "Capability", property: "id" },
  { label: "CapabilitySchema", property: "id" },
  { label: "Demonstration", property: "id" },
  { label: "EngineeringContext", property: "id" },
  { label: "Experience", property: "id" },
  { label: "Experience", property: "fingerprint" },
  { label: "Problem", property: "id" },
  { label: "Technique", property: "id" },
  { label: "Technology", property: "id" },
  { label: "TechniqueSpec", property: "id" },
  { label: "Safeguard", property: "id" },
];

export function collectSkillRepositoryEvidence(
  rows: EvidenceInput[],
  targets: Array<{ skill: StoredSkillRow; def: SkillDefinition }>,
  into: Map<string, SkillRepositoryAggregate>,
): void {
  for (const row of rows) {
    if (!row.repositoryId) continue;

    const evidenceRow = {
      path: row.path,
      language: row.language,
      added_code: row.addedCode,
    };
    const ts = Date.parse(row.createdAt);

    for (const { skill, def } of targets) {
      if (!matchesSkill(def, evidenceRow)) continue;

      const key = `${skill.skillId}::${row.repositoryId}`;
      let agg = into.get(key);

      if (!agg) {
        agg = {
          skillId: skill.skillId,
          repositoryId: row.repositoryId,
          evidenceCount: 0,
          commitShas: new Set(),
          firstSeenTs: Number.POSITIVE_INFINITY,
          lastSeenTs: 0,
          evidencePath: row.path,
          evidenceCommitSha: row.commitSha,
        };
        into.set(key, agg);
      }

      agg.evidenceCount += 1;
      if (row.commitSha) agg.commitShas.add(row.commitSha);
      if (Number.isFinite(ts)) {
        agg.firstSeenTs = Math.min(agg.firstSeenTs, ts);
        agg.lastSeenTs = Math.max(agg.lastSeenTs, ts);
      }
    }
  }
}

export function parseTechniques(
  value: unknown,
): Array<{ technique: string; count: number }> {
  try {
    const parsed = JSON.parse(safeString(value) || "[]");
    return Array.isArray(parsed)
      ? parsed.map((x) => ({
          technique: safeString(x?.technique),
          count: safeNumber(x?.count),
        }))
      : [];
  } catch {
    return [];
  }
}

export function byLevelThenEvidence(
  a: CapabilityProfileEntry,
  b: CapabilityProfileEntry,
): number {
  return (
    LEVEL_RANK[b.level] - LEVEL_RANK[a.level] ||
    b.evidenceCount - a.evidenceCount
  );
}
}
