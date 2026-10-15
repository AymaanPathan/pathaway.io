import type { Graph } from "../../db/falkordb.js";




import { Domain as _constants } from './constants.js';
import { Domain as _helpers } from './helpers.js';
import { Domain as _queries } from './queries.js';
import { Domain as _readers } from './readers.js';
import { Domain as _writers } from './writers.js';

export namespace Domain {
import LOG_PREFIX = _constants.LOG_PREFIX;
import LEVELS = _constants.LEVELS;
import levelRank = _constants.levelRank;
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
import writeBatch = _writers.writeBatch;
import storeNextMove = _writers.storeNextMove;

export type Row = Record<string, any>;

export type DepthLevel = "none" | "surface" | "working" | "proficient" | "deep";

export interface GraphOperation {
  id: string;
  kind: "fulltext" | "cypher" | "personalized_pagerank" | "rules";
  purpose: string;
  status: "ok" | "empty" | "failed";
  /** what it actually returned for this request */
  result: string;
  durationMs: number;
}

export interface Approach {
  name: string;
  isPrimary: boolean;
  depth: DepthLevel;
  howImplemented: string;
}

export interface DeveloperDepth {
  assessed: boolean;
  level: DepthLevel;
  score: number | null;
  confidence: string;
  authenticity: string;
  verdict: string;
  strengths: string[];
  gaps: string[];
  files: number;
  commits: number;
  repos: number;
  lastSeen: string;
  approaches: Approach[];
  /** hardening behaviours observed in the developer's code (limits, cleanup, validation...) */
  safeguards: string[];
  /** concrete things the assessment says the developer built */
  built: Array<{ what: string; path: string }>;
  /** the assessor's reasoning for the level */
  rationale: string;
}

export type TopicRole = "seed" | "related" | "cluster";

export interface GraphTopic {
  slug: string;
  name: string;
  domain: string;
  description: string;
  role: TopicRole;
  /** hops from the nearest seed (0 for seeds) */
  hops: number;
  foundationRank: number | null;
  clusterId: number | null;
  /** Personalized PageRank score of this topic, 0..1 relative to the best topic */
  relevance: number;
  depth: DeveloperDepth;
}

export interface TopicLink {
  a: string;
  b: string;
  type: "RELATED_TOPIC" | "SAME_CLUSTER";
  reason: string;
  weight: number;
}

export interface CapabilityCoverage {
  topicSlug: string;
  capabilityId: string;
  capability: string;
  weight: number;
  demonstrations: number;
}

export interface EvidenceItem {
  /** stable id the agent cites, e.g. "E3" */
  id: string;
  topicSlug: string;
  capabilityId: string;
  capability: string;
  demonstrationId: string;
  technique: string;
  summary: string;
  depth: string;
  repository: string;
  path: string;
  commitSha: string;
  commitSubject: string;
  permalink: string;
  fileChangeId: string;
  /** hardening behaviours the detector saw on this demonstration */
  hardening: string[];
  isTest: boolean;
}

export interface CodeContext {
  evidenceId: string;
  path: string;
  excerpt: string;
}

export type ContextKind =
  | "topic"
  | "assessment"
  | "capability"
  | "demonstration"
  | "file"
  | "repository";

export interface ContextNode {
  key: string;
  kind: ContextKind;
  label: string;
  /** Personalized PageRank score (sums to 1 over all nodes) */
  score: number;
}

export interface ContextEdge {
  from: string;
  to: string;
  type: string;
  weight: number;
}

export interface Signal {
  slug: string;
  name: string;
  domain: string;
  level: DepthLevel;
  relevance: number;
  /** plain-words facts from the graph */
  reasons: string[];
  /** evidence ids (E1...) that belong to this topic */
  evidenceIds: string[];
  /** strengths this topic is directly related to */
  nearStrengths: string[];
  /** capabilities mapped to the topic with zero demonstrations */
  missingCapabilities: string[];
}

export type ResolutionMethod =
  | "agent_topics"
  | "exact_name"
  | "domain"
  | "full_text"
  | "none";

export interface Resolution {
  method: ResolutionMethod;
  confidence: "high" | "medium" | "none";
  needsClarification: boolean;
  tokens: string[];
  seeds: Array<{ slug: string; name: string; domain: string }>;
}

export interface GoalGraphResult {
  developerId: string;
  wish: string;
  resolution: Resolution;
  topics: GraphTopic[];
  links: TopicLink[];
  coverage: CapabilityCoverage[];
  evidence: EvidenceItem[];
  /** the retrieved subgraph, for the UI */
  context: { nodes: ContextNode[]; edges: ContextEdge[] };
  /** top nodes by Personalized PageRank (context order, not a decision) */
  ranking: ContextNode[];
  signals: {
    strengths: Signal[];
    unproven: Signal[];
    opportunities: Signal[];
  };
  operations: GraphOperation[];
  /** code excerpts for the strongest evidence (the only code the agent may quote) */
  code: CodeContext[];
  /** the NextMove currently stored for this goal, so the agent does not repeat it */
  previousMove: { title: string; doneWhen: string } | null;
  clarification: {
    reason: string;
    suggestions: Array<{ slug: string; name: string; domain: string }>;
  } | null;
  truncated: boolean;
}

export interface GoalGraphInput {
  developerId: string;
  /** what the developer typed */
  wish: string;
  /** topics the goal agent extracted (slugs or names). Checked against the graph. */
  goalTopics?: string[];
}

export interface SeedRow {
  slug: string;
  name: string;
  domain: string;
}

export interface NextMoveInput {
  title: string;
  summary: string;
  /** topic the move is about; null when it introduces something new */
  focusSlug: string | null;
  /** strengths the move builds on. Each needs cited evidence from that topic. */
  strengthSlugs: string[];
  /** unproven topics the move closes */
  gapSlugs: string[];
  /** evidence ids (E1...) from this GoalGraphResult */
  evidenceIds: string[];
  /** capability the move advances (Capability.id), when it targets one */
  capabilityId?: string | null;
  /** FileChange the task starts from (FileChange.id) */
  startFileChangeId?: string | null;
  /** objectively checkable completion condition */
  doneWhen?: string;
  /** why this move was selected: selection facts, challenge, steps (stored as JSON) */
  details?: Row;
}

export interface NextMoveStored {
  stored: boolean;
  goalId: string;
  nextMoveId: string;
  links: {
    targets: number;
    focus: number;
    leverages: number;
    closesGap: number;
    demonstrations: number;
    fileChanges: number;
    assessments: number;
    capability: number;
    startsAt: number;
  };
  /** things the agent claimed that the graph result did not support */
  rejected: string[];
}
}
