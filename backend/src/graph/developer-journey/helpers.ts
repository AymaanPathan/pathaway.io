import type { Graph } from "../../db/falkordb.js";




import { Domain as _constants } from './constants.js';
import { Domain as _queries } from './queries.js';
import { Domain as _readers } from './readers.js';
import { Domain as _types } from './types.js';
import { Domain as _writers } from './writers.js';

export namespace Domain {
import LOG_PREFIX = _constants.LOG_PREFIX;
import ALL_LEVELS = _constants.ALL_LEVELS;
import LEVEL_RANK = _constants.LEVEL_RANK;
import DEPTH_BY_RANK = _constants.DEPTH_BY_RANK;
import schemaReady = _constants.schemaReady;
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
import ensureJourneySchema = _writers.ensureJourneySchema;

export function log(message: string, detail?: Row): void {
  if (detail !== undefined) console.log(`${LOG_PREFIX} ${message}`, detail);
  else console.log(`${LOG_PREFIX} ${message}`);
}

export const str = (v: unknown, fallback = ""): string =>
  v === null || v === undefined || typeof v === "object"
    ? fallback
    : String(v).trim();

export const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : [];

export const mapList = (v: unknown): Row[] =>
  Array.isArray(v)
    ? v.filter((x) => x && typeof x === "object" && !Array.isArray(x))
    : [];

export async function rows(
  graph: Graph,
  query: string,
  params: Row = {},
): Promise<Row[]> {
  const result = await graph.query(query, { params });
  return (result.data ?? []) as Row[];
}

export async function tryRows(
  graph: Graph,
  label: string,
  query: string,
  params: Row = {},
): Promise<Row[] | null> {
  try {
    return await rows(graph, query, params);
  } catch (error) {
    log(`${label} failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export const asLevel = (v: unknown): CapLevel => {
  const s = str(v);
  return (ALL_LEVELS as string[]).includes(s) ? (s as CapLevel) : "missing";
};

export function evidenceStateFor(level: CapLevel): EvidenceState {
  if (level === "strong" || level === "implementation") return "demonstrated";
  if (level === "usage" || level === "repeated_usage") return "partial";
  if (level === "insufficient_evidence") return "unverified";
  return "missing";
}

export function levelsInStates(states: readonly EvidenceState[]): CapLevel[] {
  return ALL_LEVELS.filter((l) => states.includes(evidenceStateFor(l)));
}

export const MAX_PREREQUISITE_DEPTH = 10;

export const PREREQUISITE_SATISFIED_BY: readonly EvidenceState[] = ["demonstrated"];

export const MIN_DETECTIONS_FOR_CONFIDENCE = 3;

export const MIN_COMMITS_FOR_CONFIDENCE = 2;

export const GRAPH_MODEL = {
  summary:
    "One shared FalkorDB graph holds every developer. Each developer is a Developer node, and every journey query starts at that node, so it only follows that developer's own edges. GitHub history is turned into evidence by rule-based detectors, evidence is grouped into experiences, and experiences roll up into capability levels. The journey is a set of read-only traversals over that structure; every claim can be walked back to a file, a line range and a commit. The capabilities themselves are inferences from code patterns, not verified skills.",
  whyFalkorDB: [
    "A developer's history is naturally a web of connected things: a person wrote diffs, diffs sit in commits, commits sit in repositories, diffs show techniques, techniques prove skills. FalkorDB stores that web as it is: nodes for the things, edges for the connections.",
    "FalkorDB keeps edges as real stored connections, not as join tables. Walking from a Developer to their capabilities, or from a capability down to the exact code that supports it, is following stored links rather than searching and matching rows. The cost depends on how much you actually touch, not on how big the whole database is.",
    "Roll-ups live on the edges. The HAS_CAPABILITY edge between a developer and a skill stores level, evidence count, commit count, repository count and first/last seen. Answering 'what are they good at' is reading those edge properties, not recounting thousands of demonstrations.",
    "Every claim is one hop from its supporting code. Capability <- Demonstration -> Repository / FileChange means the same graph that answers 'what are they good at' also answers 'show me the code', with a GitHub permalink, so a reader can judge the evidence themselves.",
    "FalkorDB also provides a full-text index over capability names, descriptions and keywords, so a loose phrase like 'make my API safer' becomes real capability nodes, and graph algorithms (shortest path, PageRank, BFS) for relationships between skills.",
    "Every private-data query is anchored on one Developer node and follows that developer's own edges (DEMONSTRATED, EXPERIENCED, HAS_CAPABILITY, AUTHORED_CODE), so a journey only reads that developer's evidence even though the graph is shared. Only the capability taxonomy is shared.",
  ],
  nodes: [
    {
      label: "Developer",
      meaning: "The person. Root of every traversal.",
      createdBy: "GitHub sync",
    },
    {
      label: "Repository",
      meaning: "A project they contributed to.",
      createdBy: "GitHub sync",
    },
    {
      label: "Commit",
      meaning: "A commit they made. Its message gives the 'why'.",
      createdBy: "GitHub sync",
    },
    {
      label: "FileChange",
      meaning:
        "One file diff inside a commit. The raw material of all evidence.",
      createdBy: "GitHub sync",
    },
    {
      label: "Demonstration",
      meaning:
        "ATOMIC EVIDENCE: one place where code matched a detector for a mechanism (e.g. retry with backoff), with technique, depth, hardening modifiers, file, line range, permalink and snippet.",
      createdBy:
        "Signal rules run over added, non-comment, non-test lines of each FileChange",
    },
    {
      label: "Experience",
      meaning:
        "DURABLE MEMORY: demonstrations of the same capability + technique grouped into one engineering experience, with counts across commits, repositories and days.",
      createdBy: "Deterministic grouping (no LLM) on every sync",
    },
    {
      label: "Capability",
      meaning:
        "A learnable engineering ability (e.g. retry_backoff). Domains (reliability, data_layer ...) are category nodes that only group capabilities.",
      createdBy: "Capability taxonomy (owned outside this file)",
    },
    {
      label: "EngineeringContext",
      meaning:
        "Which layer of the system the work touched (request pipeline, data layer ...).",
      createdBy: "Path patterns",
    },
    {
      label: "Technique / Technology / Problem / Skill",
      meaning:
        "Names attached to experiences: how it was done, with what tools, and what problem the commits said they solved.",
      createdBy: "Experience build and skill graph",
    },
  ],
  relationships: [
    {
      type: "AUTHORED_CODE",
      from: "Developer",
      to: "FileChange",
      meaning: "The developer wrote this diff.",
      why: "Only the developer's own code can count as evidence.",
    },
    {
      type: "DEMONSTRATED",
      from: "Developer",
      to: "Demonstration",
      meaning: "This piece of evidence belongs to this developer.",
      why: "Ownership edge: stops two developers sharing evidence.",
    },
    {
      type: "OF_CAPABILITY",
      from: "Demonstration",
      to: "Capability",
      meaning: "The evidence points to this capability.",
      why: "Links raw code evidence to a named skill.",
    },
    {
      type: "IN_REPOSITORY",
      from: "Demonstration",
      to: "Repository",
      meaning: "Where the evidence lives.",
      why: "Answers 'where did you build this?'",
    },
    {
      type: "EVIDENCED_BY",
      from: "Demonstration",
      to: "FileChange",
      meaning: "The exact diff the evidence was extracted from.",
      why: "Lets every claim be opened on GitHub.",
    },
    {
      type: "EXPERIENCED",
      from: "Developer",
      to: "Experience",
      meaning: "The developer has this engineering experience.",
      why: "Entry point to 'what has this developer built'.",
    },
    {
      type: "SUPPORTED_BY",
      from: "Experience",
      to: "Demonstration",
      meaning: "The demonstrations the experience was grouped from.",
      why: "Experience -> proof snippet.",
    },
    {
      type: "DEMONSTRATES_CAPABILITY",
      from: "Experience",
      to: "Capability",
      meaning: "The experience points to this capability.",
      why: "Experience -> skill.",
    },
    {
      type: "OCCURS_IN",
      from: "Experience",
      to: "Repository",
      meaning: "The experience happened in this project.",
      why: "Project -> what was built there.",
    },
    {
      type: "IN_CONTEXT",
      from: "Experience",
      to: "EngineeringContext",
      meaning: "The system layer it touched.",
      why: "Shows breadth across layers.",
    },
    {
      type: "HAS_CAPABILITY",
      from: "Developer",
      to: "Capability",
      meaning:
        "ROLL-UP of all demonstrations of a capability: level, evidence/commit/repo/day counts, first/last seen. No blended score.",
      why: "One edge per skill = the fast answer to 'what have they demonstrated'.",
    },
    {
      type: "SPECIALIZES",
      from: "Capability",
      to: "Capability (domain)",
      meaning: "Capability belongs to a domain. Grouping only.",
      why: "Lets the journey summarise by domain.",
    },
    {
      type: "HAS_SKILL",
      from: "Developer",
      to: "Skill",
      meaning:
        "Technology skills (TypeScript, Express ...) from the skill graph.",
      why: "Tools they work with, complementary to capabilities.",
    },
  ],
  levels: {
    insufficient_evidence: "a single lone sighting; Pathway cannot tell yet",
    usage: "a primitive was used",
    repeated_usage:
      "a primitive was used in 2+ commits, but the mechanism was never built",
    implementation:
      "a composed mechanism was detected, or a primitive plus 2 hardening behaviours",
    strong:
      "detected with hardening in 2+ separate commits (a hardened mechanism, repeated)",
  } as Record<string, string>,
  paths: [
    {
      question: "What have they demonstrated, and how well?",
      pattern:
        "(Developer)-[HAS_CAPABILITY]->(Capability)-[SPECIALIZES]->(domain)",
      tool: "list_built_capabilities",
    },
    {
      question: "What supports a skill?",
      pattern:
        "(Capability)<-[OF_CAPABILITY]-(Demonstration)-[IN_REPOSITORY]->(Repository)",
      tool: "trace_capability",
    },
    {
      question: "What did they build in a project?",
      pattern:
        "(Repository)<-[OCCURS_IN]-(Experience)-[DEMONSTRATES_CAPABILITY]->(Capability)",
      tool: "trace_repository",
    },
    {
      question: "What are they good at?",
      pattern:
        "level + evidence/commit/repo/day counts on HAS_CAPABILITY, tiered by rules (core / solid / emerging)",
      tool: "get_developer_journey",
    },
    {
      question: "When did each skill grow?",
      pattern:
        "(Developer)-[DEMONSTRATED]->(Demonstration {created_at})-[OF_CAPABILITY]->(Capability), grouped by month",
      tool: "get_developer_journey / get_skill_evolution",
    },
  ],
};

export const CAPABILITY_KEYWORDS: Record<string, string> = {
  concurrency_control: "concurrency consistency shared state",
  async_processing: "asynchronous async background processing",
  reliability: "reliability resilience resilient fault tolerance",
  caching: "caching performance latency",
  realtime: "realtime real-time live delivery",
  api_engineering: "api design security secure",
  data_layer: "data layer database engineering",
  frontend_delivery: "frontend delivery rendering seo",

  distributed_locking:
    "lock locks locking mutex redlock mutual exclusion distributed",
  transactional_integrity:
    "transaction transactions acid atomic integrity consistency data backend",
  optimistic_concurrency:
    "optimistic concurrency race condition lost update conflict",
  idempotent_operations:
    "idempotent idempotency duplicate exactly once distributed payments",
  job_queues:
    "queue queues worker workers background job jobs bullmq cron backend scalable",
  event_messaging:
    "kafka rabbitmq broker pubsub messaging event driven events sqs distributed scalable system design",
  webhook_handling: "webhook webhooks callback callbacks integrations",
  retry_backoff:
    "retry retries backoff resilient resilience fault tolerant backend distributed",
  rate_limit_handling: "throttle throttling ratelimit 429 upstream",
  timeouts_cancellation: "timeout timeouts cancel cancellation abort deadline",
  application_caching:
    "cache caching latency performance fast backend scalable redis",
  websocket_channels:
    "websocket websockets socket realtime real-time live streaming chat",
  api_design:
    "api rest restful endpoint endpoints route routes http backend design",
  input_validation: "validation validate zod sanitize secure security input",
  authn_authz:
    "auth authentication authorization login jwt oauth security secure permission password backend",
  rate_limiting: "rate limiting limiter abuse secure security protect",
  schema_migrations: "migration migrations schema database evolve",
  batched_writes: "bulk batch batched insert performance database throughput",
  graph_modeling: "graph cypher neo4j falkordb traversal knowledge",
  rendering_strategies:
    "ssr ssg isr nextjs next rendering seo server components frontend",
};

export async function ignoreExists(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already\s+(exists|indexed)/i.test(message)) {
      log(`${label} failed`, { message });
    }
  }
}

export async function setupSearch(graph: Graph): Promise<void> {
  // Keywords only touch Capability nodes that already exist. Nothing is created.
  const keywordRows = Object.entries(CAPABILITY_KEYWORDS).map(
    ([id, keywords]) => ({ id, keywords }),
  );

  await ignoreExists("capability keywords", () =>
    graph.query(
      `
      UNWIND $batch AS item
      MATCH (c:Capability {id: item.id})
      SET c.keywords = item.keywords
      RETURN count(c) AS n
      `,
      { params: { batch: keywordRows } },
    ),
  );

  await ignoreExists("index Capability.id", () =>
    graph.query(`CREATE INDEX FOR (n:Capability) ON (n.id)`),
  );
  await ignoreExists("index Developer.id", () =>
    graph.query(`CREATE INDEX FOR (n:Developer) ON (n.id)`),
  );

  await ignoreExists("fulltext Capability", () =>
    graph.query(
      `CALL db.idx.fulltext.createNodeIndex('Capability', 'name', 'description', 'keywords')`,
    ),
  );

  log("journey search ready", { keywordRows: keywordRows.length });
}

export const STOPWORDS = new Set([
  "i",
  "me",
  "my",
  "we",
  "you",
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "want",
  "need",
  "like",
  "get",
  "become",
  "learn",
  "better",
  "more",
  "good",
  "great",
  "strong",
  "stronger",
  "skills",
  "skill",
  "engineer",
  "engineering",
  "developer",
  "software",
  "about",
  "into",
  "from",
  "have",
  "can",
  "able",
  "how",
  "build",
  "building",
  "work",
  "working",
  "level",
  "senior",
  "junior",
  "improve",
  "understand",
  "deep",
  "deeper",
  "stuff",
]);

export function fulltextQuery(text: string): string {
  const tokens = [
    ...new Set(
      (text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter(
        (t) => !STOPWORDS.has(t),
      ),
    ),
  ].slice(0, 12);

  return tokens.map((t) => (t.length >= 4 ? `${t}*` : t)).join("|");
}

export const EXPERIENCE_DETAIL = `
  OPTIONAL MATCH (e)-[:SOLVES]->(p:Problem)
  OPTIONAL MATCH (e)-[:OCCURS_IN]->(r:Repository)
  OPTIONAL MATCH (e)-[:USES_TECHNOLOGY]->(tech:Technology)
  OPTIONAL MATCH (e)-[:IN_CONTEXT]->(ctx:EngineeringContext)
`;

export const EXPERIENCE_MAP = `{
  id: e.id,
  technique: e.technique,
  summary: coalesce(e.summary, ""),
  problem: coalesce(p.statement, ""),
  capability_id: e.capability_id,
  depth: coalesce(e.best_depth, "usage"),
  evidence: coalesce(e.evidence_count, 0),
  commits: coalesce(e.commit_count, 0),
  repos_n: coalesce(e.repo_count, 0),
  active_days: coalesce(e.active_days, 0),
  first_seen: coalesce(e.first_seen, ""),
  last_seen: coalesce(e.last_seen, ""),
  repositories: repos,
  technologies: techs,
  contexts: ctxs
}`;

export function toExperience(m: Row): ExperienceBrief {
  return {
    id: str(m.id),
    technique: str(m.technique),
    summary: str(m.summary),
    problem: str(m.problem),
    capabilityId: str(m.capability_id),
    depth: str(m.depth) || "usage",
    evidenceCount: num(m.evidence),
    commitCount: num(m.commits),
    repoCount: num(m.repos_n),
    activeDays: num(m.active_days),
    firstSeen: str(m.first_seen),
    lastSeen: str(m.last_seen),
    repositories: strList(m.repositories),
    technologies: strList(m.technologies),
    contexts: strList(m.contexts),
    proof: null,
  };
}

export function toProof(p: Row): ProofRef {
  return {
    repository: str(p.repository),
    path: str(p.path),
    startLine: num(p.start_line),
    endLine: num(p.end_line),
    permalink: str(p.permalink),
    snippet: str(p.snippet),
    commitSubject: str(p.commit_subject),
    depth: str(p.depth) || "usage",
    modifiers: str(p.modifiers).split(" | ").filter(Boolean),
  };
}

export function deriveStrengths(caps: BuiltCapability[]): JourneyStrength[] {
  const tierRank: Record<StrengthTier, number> = {
    core: 3,
    solid: 2,
    emerging: 1,
  };
  const out: JourneyStrength[] = [];

  for (const c of caps) {
    const tier: StrengthTier | null =
      c.level === "strong"
        ? "core"
        : c.level === "implementation"
          ? "solid"
          : c.level === "repeated_usage"
            ? "emerging"
            : null;
    if (!tier) continue;

    const tentative =
      c.evidenceCount < MIN_DETECTIONS_FOR_CONFIDENCE ||
      c.commitCount < MIN_COMMITS_FOR_CONFIDENCE;

    const top = c.techniques[0];
    const base = `${c.evidenceCount} detection${c.evidenceCount === 1 ? "" : "s"} across ${c.commitCount} commit${c.commitCount === 1 ? "" : "s"} in ${c.repoCount} repositor${c.repoCount === 1 ? "y" : "ies"} over ${c.activeDays} active day${c.activeDays === 1 ? "" : "s"}`;
    const tail = top
      ? `; main technique: ${top.technique}${
          top.hardening.length
            ? ` (${top.hardening
                .slice(0, 3)
                .map((h) => h.label)
                .join(", ")})`
            : ""
        }`
      : "";
    const caveat =
      tier === "emerging"
        ? "; used repeatedly but the mechanism itself was not detected"
        : "";
    const thin = tentative
      ? "; thin evidence, treat as tentative until more code confirms it"
      : "";

    out.push({
      capabilityId: c.capabilityId,
      name: c.name,
      domain: c.domain,
      tier,
      level: c.level,
      evidenceCount: c.evidenceCount,
      commitCount: c.commitCount,
      repoCount: c.repoCount,
      activeDays: c.activeDays,
      tentative,
      reason: `${base}${tail}${caveat}${thin}.`,
    });
  }

  return out.sort(
    (a, b) =>
      tierRank[b.tier] - tierRank[a.tier] ||
      Number(a.tentative) - Number(b.tentative) ||
      b.evidenceCount - a.evidenceCount ||
      a.name.localeCompare(b.name),
  );
}

export function summariseDomains(caps: BuiltCapability[]): DomainSummary[] {
  const byDomain = new Map<string, DomainSummary>();
  for (const c of caps) {
    if (!c.domainId) continue;
    const d = byDomain.get(c.domainId) ?? {
      domainId: c.domainId,
      domain: c.domain,
      touched: 0,
      built: 0,
      evidence: 0,
      bestLevel: "missing" as CapLevel,
    };
    d.touched += 1;
    if (c.state === "demonstrated") d.built += 1;
    d.evidence += c.evidenceCount;
    if (LEVEL_RANK[c.level] > LEVEL_RANK[d.bestLevel]) d.bestLevel = c.level;
    byDomain.set(c.domainId, d);
  }
  return [...byDomain.values()].sort(
    (a, b) =>
      LEVEL_RANK[b.bestLevel] - LEVEL_RANK[a.bestLevel] ||
      b.evidence - a.evidence ||
      a.domain.localeCompare(b.domain),
  );
}

export function badRepo(r: Row): boolean {
  const status = str(r.status);
  const changes = num(r.changes);
  const noPatch = num(r.no_patch);
  return (
    status === "failed" ||
    status === "partial" ||
    (changes > 0 && noPatch / changes > 0.5)
  );
}

export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

export function explainSelf(self: SelfReadout): string {
  const t = self.totals;
  return (
    `FalkorDB started at your Developer node and followed AUTHORED_CODE edges out to ${plural(t.fileChanges, "FileChange node")} ` +
    `(${plural(t.commits, "commit")} across ${plural(t.repositories, "repository", "repositories")}). ` +
    `From the same starting node it followed DEMONSTRATED edges to ${plural(t.demonstrations, "Demonstration")} and EXPERIENCED edges to ${plural(t.experiences, "Experience")}. ` +
    `The layers, intents, technologies and repositories in this section come from one more hop each: from an Experience to its EngineeringContext, its Technology and its Repository. ` +
    `Every hop follows a stored edge, so FalkorDB only touched your own part of the graph and never had to search other people's data.`
  );
}

export function explainCapabilities(
  caps: BuiltCapability[],
  self: SelfReadout,
): string {
  const built = caps.filter((c) => c.state === "demonstrated").length;
  const partial = caps.filter((c) => c.state === "partial").length;
  const techniques = caps.reduce((n, c) => n + c.techniques.length, 0);
  return (
    `FalkorDB followed ${plural(caps.length, "HAS_CAPABILITY edge")} out of your Developer node. ` +
    `Each of those edges already stores the roll-up that was written at sync time: level, evidence count, commit count, repository count, active days, first and last seen. ` +
    `So the level of every skill (${built} with a mechanism detected, ${partial} only used) was read straight off the edge, not recomputed from your ${self.totals.demonstrations} detections. ` +
    `One more hop along SPECIALIZES gave each skill its domain. ` +
    `A second traversal, Developer to Demonstration to Capability, grouped the evidence by technique and collected the hardening habits seen in your code (${plural(techniques, "technique")} in total). ` +
    `The levels themselves were assigned at sync time by rule-based detectors, so they describe patterns found in your diffs, not a verified skill assessment.`
  );
}

export function explainProof(caps: BuiltCapability[], proofCount: number): string {
  const repos = new Set(
    caps.flatMap((c) => c.proofs.map((p) => p.repository)).filter(Boolean),
  );
  return (
    `For every skill, FalkorDB walked backwards from the Capability node along OF_CAPABILITY edges to the Demonstration nodes that support it, ` +
    `then one hop on IN_REPOSITORY to the repository. It ordered them by depth and recency and kept the strongest few: ${plural(proofCount, "example")} across ${plural(repos.size, "repository", "repositories")}. ` +
    `Each Demonstration stores the file path, line range, commit subject, snippet and GitHub permalink, so a claim like "strong at REST API design" is exactly one hop away from the code that triggered it. ` +
    `You can open those links and judge the code yourself; a detection shows a pattern was present, not that it was well designed. ` +
    `Experiences were reached the same way, through SUPPORTED_BY edges.`
  );
}

export function explainStrengths(strengths: JourneyStrength[]): string {
  const core = strengths.filter((s) => s.tier === "core").length;
  const solid = strengths.filter((s) => s.tier === "solid").length;
  const emerging = strengths.filter((s) => s.tier === "emerging").length;
  const tentative = strengths.filter((s) => s.tentative);
  return (
    `No new query ran here. The rules read the properties FalkorDB had already returned from the HAS_CAPABILITY edges: ` +
    `level "strong" means core (${core}), "implementation" means solid (${solid}), "repeated_usage" means emerging (${emerging}). ` +
    `No language model is involved, so the result is repeatable, but the rules judge detector output, so the tiers are only as good as the detectors. ` +
    (tentative.length
      ? `${plural(tentative.length, "strength")} (${tentative.map((s) => s.name).join(", ")}) rest on very little evidence and are marked tentative.`
      : `Every listed strength has at least ${MIN_DETECTIONS_FOR_CONFIDENCE} detections across ${MIN_COMMITS_FOR_CONFIDENCE} or more commits.`)
  );
}

export function explainTimeline(timeline: TimelinePoint[]): string {
  const months = new Set(timeline.map((t) => t.month)).size;
  return (
    `FalkorDB went from your Developer node along DEMONSTRATED edges to each Demonstration, read its created_at, hopped along OF_CAPABILITY to the skill, ` +
    `and grouped the results by month and skill inside the query itself (count and best depth). ` +
    `That produced ${plural(timeline.length, "month-and-skill point")} over ${plural(months, "month")}, showing when each skill was first detected and how deep it got.`
  );
}

export function explainRepositories(
  repos: JourneyRepository[],
  touched: number,
): string {
  const gap =
    touched > repos.length
      ? ` You committed to ${touched} repositories in total; the other ${touched - repos.length} produced no detected evidence, which means the detectors saw nothing there, not that no work happened.`
      : "";
  return (
    `Starting from your Experience nodes, FalkorDB followed OCCURS_IN to each Repository and DEMONSTRATES_CAPABILITY to each Capability, ` +
    `then grouped by repository. That gave ${plural(repos.length, "project")} with the skills and techniques detected inside each. ` +
    `It is the same graph read from the other side: from a project to its skills instead of from a skill to its projects.` +
    gap
  );
}

export function explainCoverage(cov: Coverage, touched: number): string {
  if (!cov.known) {
    return (
      `Coverage could not be determined: neither your FileChange nodes nor a CONTRIBUTED_TO edge returned any repositories to check, ` +
      `even though ${plural(touched, "repository", "repositories")} appear in your totals. ` +
      `So how much of your history was readable is unknown. Treat missing evidence as "not seen", never as "cannot do it".`
    );
  }
  const via =
    cov.source === "file_changes"
      ? "grouped your AUTHORED_CODE file changes by repository"
      : "followed CONTRIBUTED_TO edges to your repositories";
  return (
    `FalkorDB ${via}, giving ${plural(cov.repositories, "repository", "repositories")}, and counted how many file changes in each had a stored patch. ` +
    (cov.incomplete === 0
      ? `Every one had a readable patch for most of its changes, so gaps in the evidence are unlikely to come from unreadable data (they can still come from patterns the detectors do not know).`
      : `${plural(cov.incomplete, "repository", "repositories")} (${cov.incompleteNames.join(", ")}) were only partly readable, so gaps there mean "not seen", not "cannot do it".`)
  );
}

export function explainWhole(
  self: SelfReadout,
  caps: BuiltCapability[],
  strengths: JourneyStrength[],
): string {
  const t = self.totals;
  const core = strengths
    .filter((s) => s.tier === "core" && !s.tentative)
    .map((s) => s.name);
  return (
    `Your GitHub history is stored in FalkorDB as a graph, not as rows. ` +
    `${plural(t.commits, "commit")} became ${plural(t.fileChanges, "FileChange node")}; rule-based detectors then scanned the added code in them and recorded ${plural(t.demonstrations, "Demonstration node")} wherever a known pattern matched, ` +
    `each linked to a Capability, a Repository and the exact diff. Detections of the same skill and technique were grouped into ${plural(t.experiences, "Experience node")}, ` +
    `and everything for a skill was rolled up onto one HAS_CAPABILITY edge between you and that skill. ` +
    `This journey is read by walking those edges: from you to your ${plural(caps.length, "capability", "capabilities")}, from each capability down to the code that triggered it, ` +
    `and from each project to what was detected there. ` +
    (core.length
      ? `The skills marked core (${core.join(", ")}) are the ones where a hardened mechanism was detected in two or more separate commits. `
      : "") +
    `Levels, counts and tiers are stored properties produced by deterministic rules, so they are repeatable and every one can be followed to a file, a line range and a GitHub permalink. ` +
    `They are still inferences from code patterns, not a verdict on how well you build things; see limitations.`
  );
}

export function buildLimitations(
  self: SelfReadout,
  caps: BuiltCapability[],
  strengths: JourneyStrength[],
  repositories: JourneyRepository[],
  coverage: Coverage,
): string[] {
  const out: string[] = [];

  out.push(
    "Capabilities are inferred by pattern detectors over the added lines of your diffs. The rules are deterministic and repeatable, but they are heuristics: a pattern can match without the code being good, and good work written in a way the detectors do not recognise is not seen.",
  );
  out.push(
    "Levels (usage, implementation, strong) and tiers (core, solid, emerging) are Pathway's own thresholds, not an industry standard or a peer-reviewed assessment.",
  );

  const tentative = strengths.filter((s) => s.tentative);
  if (tentative.length) {
    out.push(
      `Tentative strengths with very little evidence: ${tentative
        .map(
          (s) =>
            `${s.name} (${s.evidenceCount} detection${s.evidenceCount === 1 ? "" : "s"}, ${s.commitCount} commit${s.commitCount === 1 ? "" : "s"})`,
        )
        .join("; ")}.`,
    );
  }

  const unverified = caps.filter((c) => c.state === "unverified");
  if (unverified.length) {
    out.push(
      `Single sightings that are not enough to judge: ${unverified.map((c) => c.name).join(", ")}.`,
    );
  }

  if (!coverage.known) {
    out.push(
      "Coverage could not be determined, so it is unknown how much of your history was readable.",
    );
  } else if (coverage.incomplete > 0) {
    out.push(
      `Some history was only partly readable (${coverage.incompleteNames.join(", ")}); evidence there may be missing.`,
    );
  }

  const touched = self.totals.repositories;
  if (touched > repositories.length) {
    out.push(
      `${touched} repositories were touched but only ${repositories.length} contain detected evidence. The rest are not evidence of absence.`,
    );
  }

  out.push(
    "Missing evidence always means 'not seen', never 'cannot do it'. Skills built outside GitHub, in private repositories that were not synced, or older than the sync window are not represented.",
  );

  return out;
}

export function deriveFrontierStatus(
  level: CapLevel,
  prerequisites: Array<{ level: CapLevel }>,
): FrontierStatus {
  if (levelsInStates(["demonstrated"]).includes(level)) return "demonstrated";
  const satisfying = new Set<string>(levelsInStates(PREREQUISITE_SATISFIED_BY));
  return prerequisites.every((p) => satisfying.has(p.level))
    ? "eligible"
    : "blocked";
}

export const byNameThenId = (
  a: { name: string; capabilityId: string },
  b: { name: string; capabilityId: string },
): number =>
  a.name.localeCompare(b.name) || a.capabilityId.localeCompare(b.capabilityId);
}
