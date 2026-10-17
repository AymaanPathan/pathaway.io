/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Graph } from "../db/falkordb.js";
import type { ChatLlm } from "../ai-models/cerebras.js";
import {
  ALL_TOOLS,
  TOOL_BY_NAME,
  createToolContext,
  describeTools,
  parseToolArgs,
  runTool,
  type DevTopic,
  type ToolRun,
  type UiBlock,
} from "../tools/index.js";

type Row = Record<string, any>;
const LOG = "[topic-chat]";

/** Hard cap on tool runs per question (round 1 + dependent round 2). */
const MAX_TOOL_CALLS = 5;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/* ========================================================================== */
/* TYPES                                                                      */
/* ========================================================================== */

export type TraceEvent =
  | {
      type: "stage";
      stage: "planning" | "running" | "composing";
      agent: string;
      label: string;
    }
  | {
      type: "plan";
      by: "llm" | "rules";
      model: string | null;
      ms: number;
      calls: Array<{ tool: string; title: string; why: string; args: Row }>;
      skipped: Array<{ term: string; tool: string; reason: string }>;
    }
  /** round 2: tools chosen BECAUSE of what round 1 found */
  | {
      type: "followup";
      calls: Array<{
        tool: string;
        title: string;
        why: string;
        dependsOn: string;
      }>;
    }
  | { type: "tool_start"; tool: string; title: string }
  | {
      type: "tool_done";
      tool: string;
      ok: boolean;
      ms: number;
      miss: boolean;
      note: string | null;
    }
  | { type: "compose_done"; usedLlm: boolean; ms: number }
  | { type: "answer_start" }
  | { type: "answer_delta"; text: string };

export interface TopicChatInput {
  graph: Graph;
  developerId: string;
  message: string;
  history?: ChatTurn[];

  selectedTopic?: string | null;

  llm: ChatLlm | null;

  emit?: (event: TraceEvent) => void;
}

/** success = ran and returned data; empty = ran, nothing matched; partial = returned data but some graph queries failed; failed = tool error */
export type StepStatus = "success" | "empty" | "partial" | "failed";

export interface InvestigationStep {
  id: string;
  tool: string;
  title: string;
  purpose: string;
  status: StepStatus;
  summary: string;
  findingIds: string[];
  round: 1 | 2;
  /** tool whose result caused this step (round 2 only) */
  dependsOn: string | null;
  ms: number;
}

/* ---- the four measures. They are different things and never share a field. ---- */

/** PROFICIENCY: assessed depth of the developer's skill in one topic. */
export interface Proficiency {
  level: string; // none | surface | working | proficient | deep | "not assessed"
  score: number | null; // 0..100, null when unknown
  /** CONFIDENCE: strength of the evidence behind this assessment (not the skill itself) */
  confidence: "low" | "medium" | "high" | null;
  assessed: boolean;
  /** model = judged from evidence; heuristic = graph-statistics estimate; unknown = not reported */
  source: "model" | "heuristic" | "unknown";
}

/** GRAPH IMPORTANCE: structural role in the topic graph. Says nothing about skill. */
export interface Importance {
  metric: "pagerank_lift";
  value: number | null;
  note: string;
}

/** GAP PRIORITY: why this gap should be addressed before the others. */
export interface GapPriority {
  rank: number;
  of: number;
  reason: string;
}

/** Direct prerequisite (1 hop) vs multi-hop dependency (2+ hops). */
export interface Dependency {
  relation: "direct" | "multi_hop";
  hops: number;
}

export interface Finding {
  id: string;
  tool: string;
  /** summary = tool-level overview; gap = one concrete weak-foundation gap; result = any other tool result */
  kind: "summary" | "gap" | "result";
  claim: string;
  evidence: string[];
  /** how reliable THIS tool result is (query health + caveats). Not a skill rating. */
  reliability?: "low" | "medium" | "high";
  /** strength of evidence behind the assessments this finding relies on. Not a skill rating. */
  confidence?: "low" | "medium" | "high" | null;
  proficiency?: { topic: Proficiency; foundation: Proficiency };
  importance?: Importance;
  priority?: GapPriority;
  dependency?: Dependency;
  limitations?: string[];
  slugs: string[];
  /** the graph path that proves this finding */
  pathId?: string;
}

export interface PathNode {
  slug: string | null;
  name: string;
  proficiency: Proficiency | null;
}

export interface PathEdge {
  from: string;
  to: string;
  /** raw edge type from the graph, e.g. BUILDS_ON */
  type: string;
  label: string;
  relation: "direct" | "multi_hop";
  hops: number;
}

export interface GraphPath {
  id: string;
  tool: string;
  /** canonical finding this path proves (one finding, many views) */
  findingId: string | null;
  nodes: string[];
  relationships: string[];
  steps: PathNode[];
  edges: PathEdge[];
  meaning: string;
}

export interface NextAction {
  title: string;
  reason: string;
  /**
   * "mission" is part of the contract but this agent never emits it:
   * creating missions is a deterministic, authorised action outside the chat agent.
   */
  type: "investigate" | "learn" | "mission";
  /** question the UI sends back to the agent when the button is pressed */
  prompt?: string;
  slug?: string | null;
  /** canonical finding that justifies this action */
  findingId?: string | null;
}

/** Insight-first view: the diagnosis, one action, the strongest proof. Everything else is on demand. */
export interface Insight {
  diagnosis: {
    findingId: string;
    headline: string;
    detail: string;
    tone: "gap" | "info";
  } | null;
  nextAction: NextAction | null;
  keyEvidence: string[];
  keyPathId: string | null;
  /** findings that are NOT the diagnosis (shown collapsed, each references its own path) */
  otherFindingIds: string[];
}

export interface TopicChatToolInfo {
  name: string;
  title: string;
  description: string;
  features: string[];
  why: string;
  args: Row;
  ms: number;
  ok: boolean;

  miss: boolean;
  skipped: boolean;
  error: string | null;
  summary: string | null;

  contribution: string | null;

  how: string[];

  status: StepStatus;
  round: 1 | 2;
  dependsOn: string | null;
  /** labels of graph queries that failed during this tool run */
  degraded: string[];
  limitations: string[];
}

export interface TopicChatResponse {
  answer: string;
  blocks: UiBlock[];

  topics: string[];
  followups: string[];
  tools: TopicChatToolInfo[];

  investigation: {
    status: "complete" | "partial" | "failed";
    steps: InvestigationStep[];
  };
  findings: Finding[];
  graphPaths: GraphPath[];
  nextActions: NextAction[];
  insight: Insight;

  meta: {
    mode: "llm" | "rules" | "direct";
    model: string | null;
    plannerUsedLlm: boolean;
    composerUsedLlm: boolean;
    plannerMs: number;
    toolsMs: number;
    composeMs: number;
    durationMs: number;
    rounds: 1 | 2;
  };
}

interface PlannedCall {
  tool: string;
  args: Row;
  why?: string;
  dependsOn?: string;
}

interface AgentRun extends ToolRun {
  why: string;
  miss: boolean;
  skipped: boolean;
  round: 1 | 2;
  dependsOn: string | null;
  limitations: string[];
}

const EMPTY_INSIGHT: Insight = {
  diagnosis: null,
  nextAction: null,
  keyEvidence: [],
  keyPathId: null,
  otherFindingIds: [],
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

async function streamAnswer(
  text: string,
  emit?: (e: TraceEvent) => void,
): Promise<void> {
  if (!emit || !text) return;
  emit({ type: "answer_start" });
  const parts = text.match(/\S+\s*|\s+/g) ?? [text];
  let buf = "";
  let count = 0;
  for (const p of parts) {
    buf += p;
    count += 1;
    if (count % 6 === 0) {
      emit({ type: "answer_delta", text: buf });
      buf = "";
      await sleep(8);
    }
  }
  if (buf) emit({ type: "answer_delta", text: buf });
}

/* ========================================================================== */
/* LLM plumbing                                                               */
/* ========================================================================== */

let llmFails = 0;
let llmPausedUntil = 0;
const noteLlm = (ok: boolean): void => {
  if (ok) {
    llmFails = 0;
    return;
  }
  llmFails += 1;
  if (llmFails >= 3) {
    llmFails = 0;
    llmPausedUntil = Date.now() + 60_000;
    console.warn(
      `${LOG} LLM paused for 60s after repeated failures; rules mode`,
    );
  }
};

const LLM_HARD_MS = Number(process.env.TOPIC_CHAT_HARD_MS) || 12_000;

function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

async function askJson(
  llm: ChatLlm | null,
  stage: "discover" | "synthesize",
  system: string,
  user: string,
  maxTokens: number,
): Promise<Row | null> {
  if (!llm || Date.now() < llmPausedUntil) return null;
  try {
    const out = await withDeadline(
      llm.completeJson({
        stage,
        system,
        user,
        maxTokens,
        temperature: stage === "discover" ? 0.1 : 0.3,
      }),
      LLM_HARD_MS,
      stage,
    );
    if (out && typeof out === "object" && !Array.isArray(out)) {
      noteLlm(true);
      return out as Row;
    }
    noteLlm(false);
    return null;
  } catch (error) {
    console.warn(
      `${LOG} ${stage} failed:`,
      error instanceof Error ? error.message : error,
    );
    noteLlm(false);
    return null;
  }
}

const asText = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/* ========================================================================== */
/* TOPIC RESOLUTION                                                           */
/* ========================================================================== */

const STOP = new Set([
  "and",
  "the",
  "for",
  "with",
  "of",
  "in",
  "to",
  "a",
  "an",
]);
const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const tokens = (s: string): string[] =>
  norm(s)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t));

function resolveTopic(raw: string, topics: DevTopic[]): string | null {
  const q = norm(raw);
  if (!q || !topics.length) return null;

  for (const t of topics) {
    if (norm(t.slug) === q || norm(t.name) === q) return t.slug;
  }

  const qt = tokens(raw);
  let best: { slug: string; score: number } | null = null;
  for (const t of topics) {
    const name = norm(t.name);
    const nt = tokens(t.name);
    let score = 0;
    if (q.length > 2 && (name.includes(q) || q.includes(name))) score += 3;
    for (const w of qt) {
      if (nt.includes(w)) score += 2;
      else if (
        w.length > 3 &&
        nt.some((x) => x.startsWith(w) || w.startsWith(x))
      )
        score += 1;
    }
    if (score > 0 && (!best || score > best.score))
      best = { slug: t.slug, score };
  }
  return best ? best.slug : null;
}

const TOPIC_ARGS = new Set(["topic", "from", "to"]);

function resolveCalls(
  calls: PlannedCall[],
  topics: DevTopic[],
  selected: string | null,
): {
  calls: PlannedCall[];
  skipped: Array<{ term: string; tool: string; reason: string }>;
} {
  const out: PlannedCall[] = [];
  const skipped: Array<{ term: string; tool: string; reason: string }> = [];

  for (const c of calls) {
    const args: Row = { ...(c.args ?? {}) };
    let dropped: string | null = null;

    for (const [k, v] of Object.entries(args)) {
      if (typeof v !== "string" || !v.trim()) continue;
      if (TOPIC_ARGS.has(k)) {
        if (selected && v === selected) continue;
        const slug = resolveTopic(v, topics);
        if (slug) args[k] = slug;
        else {
          dropped = v;
          break;
        }
      } else if (k === "topics") {
        const parts = v
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        const slugs = parts
          .map((p) => resolveTopic(p, topics))
          .filter((x): x is string => Boolean(x));
        if (slugs.length < 2) {
          dropped = parts.find((p) => !resolveTopic(p, topics)) ?? v;
          break;
        }
        args[k] = [...new Set(slugs)].join(", ");
      }
    }

    if (dropped) {
      skipped.push({
        term: dropped,
        tool: c.tool,
        reason: `No topic in your graph matches "${dropped}"`,
      });
    } else {
      out.push({ ...c, args });
    }
  }

  if (!out.length && skipped.length) {
    out.push({
      tool: "search_topics",
      args: { query: skipped[0].term },
      why: `"${skipped[0].term}" isn't a topic name, so I searched your graph for related topics instead.`,
    });
  }
  return { calls: out, skipped };
}

/* ========================================================================== */
/* CANONICAL PROFICIENCY (one source of truth, so scores never contradict)    */
/* ========================================================================== */

const LEVEL_RANK: Record<string, number> = {
  "not assessed": -1,
  none: 0,
  surface: 1,
  working: 2,
  proficient: 3,
  deep: 4,
};
const levelRank = (p: Proficiency): number =>
  p.assessed ? (LEVEL_RANK[p.level] ?? 0) : -1;
const normLevel = (s: unknown): string =>
  typeof s === "string" ? s.trim().toLowerCase() : "";
const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
const CONF_RANK = { low: 0, medium: 1, high: 2 } as const;

const HEURISTIC_RE = /graph statistics only|no model judg/i;

/** Field names are guesses, since DevTopic wasn't visible. Adjust here only. */
function sourceOf(t: any): Proficiency["source"] {
  const tag = normLevel(
    t?.assessmentSource ?? t?.judgedBy ?? t?.method ?? t?.source,
  );
  if (/heuristic|statistic|baseline|estimate|fallback/.test(tag))
    return "heuristic";
  if (/model|llm|judge/.test(tag)) return "model";
  const text = [t?.verdict, t?.rationale, t?.summary]
    .filter((s) => typeof s === "string")
    .join(" ");
  return HEURISTIC_RE.test(text) ? "heuristic" : "unknown";
}

interface ProfRef {
  slug: string | null;
  name: string;
  prof: Proficiency;
  /** set when a tool's stated level disagrees with the assessment on file */
  conflict: string | null;
}

/**
 * Looks a topic up in the developer's topic list and returns ONE proficiency
 * object. If a tool reported a different level, the stored assessment wins and
 * the disagreement is recorded as a limitation instead of being shown twice.
 */
function profOf(topics: DevTopic[], ref: string, toolLevel?: unknown): ProfRef {
  const slug = resolveTopic(ref, topics);
  const t: any = slug ? topics.find((x) => x.slug === slug) : null;
  const name: string = (t?.name as string) || ref;
  const canon = normLevel(t?.level ?? t?.developerLevel);
  const given = normLevel(toolLevel);
  const level = canon || given || "not assessed";

  let conflict: string | null = null;
  if (canon && given && given !== "not assessed" && canon !== given)
    conflict = `${name}: a tool reported ${given}, but the stored assessment says ${canon}. Showing ${canon}.`;

  const n = Number(t?.score);
  const c = normLevel(t?.confidence);
  return {
    slug,
    name,
    conflict,
    prof: {
      level,
      score: Number.isFinite(n) && t?.score != null ? n : null,
      confidence: c === "low" || c === "medium" || c === "high" ? c : null,
      assessed: level !== "not assessed",
      source: sourceOf(t),
    },
  };
}

const fmtProf = (p: Proficiency): string =>
  !p.assessed
    ? "Not assessed"
    : `${cap(p.level)}${p.score != null ? ` (${p.score}/100)` : ""}${p.source === "heuristic" ? " · estimate" : ""}`;

/* ========================================================================== */
/* ROUND 1 PLANNER                                                            */
/* ========================================================================== */

const PLAN_SYSTEM = `You are the router of Pathway's topic assistant. A developer asks about THEIR OWN skill graph (topics, depth levels, foundations, gaps, relations). You choose which graph tools to run. You never answer from memory.

RULES
1. Choose 1 to 3 tools from "tools" that best answer the question. Prefer fewer. Never repeat a tool. A second round of tools is chosen automatically from what the first round finds, so do not try to chain tools yourself.
2. Pass only arguments listed in the tool's "params". Topic arguments MUST be a slug copied from "topics". If the user names a technology that is not in "topics" (for example "JavaScript" or "CSS"), pick the closest matching topics from the list, or use search_topics with the user's words. Never invent a topic.
3. If the user says "this topic", "it" or "that one" and "selectedTopic" is set, use selectedTopic.
4. Use the conversation "history" to resolve follow-ups such as "and what about its gaps?".
5. For each call add "why": one short sentence (max 18 words) saying what this tool will tell the developer.
6. If the message is a greeting, thanks, or unrelated to skills and topics, return no calls and put a short friendly reply in "direct_answer".
7. Output minified JSON on one line, no commentary. Do not think out loud.

Return ONLY: {"calls":[{"tool":"","args":{},"why":""}],"direct_answer":""}`;

async function planWithLlm(
  llm: ChatLlm | null,
  message: string,
  history: ChatTurn[],
  selected: string | null,
  topics: DevTopic[],
): Promise<{ calls: PlannedCall[]; direct: string | null } | null> {
  const raw = await askJson(
    llm,
    "discover",
    PLAN_SYSTEM,
    JSON.stringify({
      question: message,
      selectedTopic: selected,
      topics: topics.slice(0, 120).map((t) => ({ slug: t.slug, name: t.name })),
      history: history
        .slice(-6)
        .map((h) => ({ role: h.role, content: h.content.slice(0, 300) })),
      tools: describeTools().map((t) => ({
        name: t.name,
        use: t.use,
        params: t.params,
      })),
    }),
    800,
  );
  if (!raw) return null;

  const calls: PlannedCall[] = [];
  if (Array.isArray(raw.calls)) {
    for (const c of raw.calls.slice(0, 3)) {
      if (c && typeof c === "object" && typeof (c as Row).tool === "string") {
        calls.push({
          tool: (c as Row).tool,
          args: ((c as Row).args ?? {}) as Row,
          why: asText((c as Row).why, 160) || undefined,
        });
      }
    }
  }
  const direct = asText(raw.direct_answer, 500) || null;
  if (!calls.length && !direct) return null;
  return { calls, direct };
}

const stem = (w: string) => (w.length > 3 ? w.replace(/s$/, "") : w);
const sameWord = (a: string, b: string) => {
  const x = stem(a);
  const y = stem(b);
  return (
    x === y ||
    (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)))
  );
};

/** Exact name first, then token match ("rest api" -> REST API design, "backoffs" -> Retry with backoff). */
function mentionedTopics(message: string, topics: DevTopic[]): string[] {
  const lower = message.toLowerCase();
  const words = tokens(message);
  return topics
    .map((t) => {
      const names = [t.name.toLowerCase(), t.slug.replace(/_/g, " ")];
      const exact = Math.min(
        ...names.map((n) => (lower.includes(n) ? lower.indexOf(n) : Infinity)),
      );
      if (Number.isFinite(exact)) return { slug: t.slug, at: exact };

      const nt = tokens(t.name);
      if (!nt.length) return { slug: t.slug, at: Infinity };
      const hits = nt
        .map((n) => words.findIndex((w) => sameWord(w, n)))
        .filter((i) => i >= 0);
      const need =
        nt.length === 1 ? 1 : Math.max(2, Math.ceil(nt.length * 0.6));
      if (hits.length < need) return { slug: t.slug, at: Infinity };
      return {
        slug: t.slug,
        at: Math.max(0, lower.indexOf(words[Math.min(...hits)])),
      };
    })
    .filter((x) => Number.isFinite(x.at))
    .sort((a, b) => a.at - b.at)
    .map((x) => x.slug);
}

function routeByRules(
  message: string,
  topics: DevTopic[],
  selected: string | null,
): PlannedCall[] {
  const s = message.toLowerCase();
  const has = (re: RegExp) => re.test(s);
  const m = mentionedTopics(message, topics);
  const calls: PlannedCall[] = [];
  const push = (tool: string, args: Row = {}) => {
    if (!calls.some((c) => c.tool === tool)) calls.push({ tool, args });
  };
  const asksHops = has(/\bhops?\b|how far|distance|separat/);

  if (m.length >= 2 && has(/compare|versus|\bvs\b|difference|stronger/))
    push("compare_topics", { topics: m.slice(0, 3).join(", ") });
  else if (
    m.length >= 2 &&
    (asksHops || has(/connect|path|between|relat|link|route|lead/))
  )
    push("connect_topics", { from: m[0], to: m[1] });
  else if (
    m.length &&
    has(
      /path to|roadmap to|how (do|can) i (get|learn|reach)|prerequisite|prereq|before i/,
    )
  )
    push("learning_path_to_topic", { topic: m[0] });
  else if (
    (m.length || selected) &&
    has(
      /around|neighbou?r|surround|depends|dependenc|multi.?hop|unlock|what builds/,
    )
  )
    push("explore_neighborhood", { topic: m[0] ?? selected });

  if (has(/gap|weak|missing|lack|improve|shallow|worst|hold(ing)? me/))
    push("find_gaps");
  if (
    has(/next|learn|roadmap|should i|frontier|focus|grow/) &&
    !calls.some((c) => c.tool === "learning_path_to_topic")
  )
    push("recommend_next_topics");
  if (has(/foundation|core|fundamental|base skills|depend on/))
    push("rank_foundations");
  if (has(/bridge|transfer|cross|connector/)) push("find_bridges");
  if (has(/communit|cluster|group|areas?|theme/)) push("knowledge_communities");
  if (has(/isolat|island|disconnect|orphan|component/))
    push("connectivity_check");
  if (has(/built|boilerplate|genuine|authentic|trust|confidence|real\b/))
    push("audit_authenticity");
  if (has(/recent|lately|latest|stale|rusty|quiet|working on/))
    push("recent_activity");
  if (has(/strong|best|deep|good at|expert|top skill/))
    push("strongest_topics");
  if (
    has(
      /summary|overview|about me|profile|how many (topics|skills|domains)|who am i/,
    )
  )
    push("profile_overview");
  if (!calls.length && has(/search|find|which topics|do i have|related/))
    push("search_topics", {
      query:
        message
          .replace(
            /search|find|which topics|do i have|related to|show me topics/gi,
            "",
          )
          .trim() || message,
    });

  if (!calls.length) {
    if (m.length) push("explain_topic", { topic: m[0] });
    else if (selected && has(/\b(this|it|that)\b/))
      push("explain_topic", { topic: selected });
    else push("profile_overview");
  }
  return calls.slice(0, 3);
}

/* ========================================================================== */
/* EXECUTION                                                                  */
/* ========================================================================== */

const NOT_FOUND = /not found|couldn'?t find|no topic (called|named|matching)/i;

function isMiss(r: ToolRun): boolean {
  if (!r.ok || !r.result) return false;
  const blocks = r.result.blocks ?? [];
  if (!blocks.length) return NOT_FOUND.test(r.result.summary ?? "");
  return blocks.every(
    (b: any) =>
      b.type === "callout" &&
      NOT_FOUND.test(`${b.title ?? ""} ${b.text ?? ""}`),
  );
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Caveats that must travel with a result so the answer never over-claims. */
function limitationsOf(r: ToolRun): string[] {
  const out: string[] = [];
  const f = (r.result?.facts ?? {}) as Row;
  const failed = [...new Set(r.degraded ?? [])];
  if (failed.length)
    out.push(
      `${failed.length} graph ${plural(failed.length, "query", "queries")} failed (${failed.slice(0, 3).join(", ")}), so this result may be incomplete or came from a fallback.`,
    );
  if (f.verifiable === false)
    out.push(
      "No BUILDS_ON links were available to check, so finding no gaps is not evidence that none exist.",
    );
  if (f.uniformRatings === true)
    out.push(
      "Ratings are unusually uniform; the model judge can be generous, so open the cited evidence before relying on these levels.",
    );
  if (f.confidence === "low")
    out.push("This topic's rating has low confidence.");
  if (f.error === "not_enough_assessed")
    out.push("Fewer than two of the requested topics have been assessed.");
  return out;
}

function statusOf(r: AgentRun): StepStatus {
  if (r.skipped) return "empty";
  if (!r.ok) return "failed";
  if (r.miss) return "empty";
  if (r.degraded?.length) return "partial";
  return "success";
}

async function executePlan(
  ctx: ReturnType<typeof createToolContext>,
  calls: PlannedCall[],
  selected: string | null,
  skipped: Array<{ term: string; tool: string; reason: string }>,
  seen: Set<string>,
  round: 1 | 2,
  emit?: (e: TraceEvent) => void,
): Promise<AgentRun[]> {
  const jobs: Array<Promise<AgentRun>> = [];

  for (const c of calls) {
    const tool = TOOL_BY_NAME.get(c.tool);
    if (!tool) {
      console.warn(`${LOG} planner asked for unknown tool "${c.tool}"`);
      continue;
    }
    const why = c.why ?? tool.whenToUse ?? tool.description ?? "";
    const dependsOn = c.dependsOn ?? null;
    const parsed = parseToolArgs(tool, c.args, selected);
    if (!parsed.ok) {
      jobs.push(
        Promise.resolve({
          tool: tool.name,
          title: tool.title,
          description: tool.description,
          features: tool.features,
          args: c.args ?? {},
          ok: false,
          ms: 0,
          result: null,
          error: parsed.error,
          degraded: [],
          how: [],
          why,
          miss: true,
          skipped: false,
          round,
          dependsOn,
          limitations: [],
        }),
      );
      continue;
    }
    const key = `${tool.name}:${JSON.stringify(parsed.args)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    emit?.({ type: "tool_start", tool: tool.name, title: tool.title });
    jobs.push(
      runTool(ctx, tool, parsed.args).then((r) => {
        const run: AgentRun = {
          ...r,
          why,
          miss: isMiss(r),
          skipped: false,
          round,
          dependsOn,
          limitations: limitationsOf(r),
        };
        emit?.({
          type: "tool_done",
          tool: r.tool,
          ok: r.ok,
          ms: r.ms,
          miss: run.miss,
          note: r.result?.summary?.slice(0, 160) ?? r.error,
        });
        return run;
      }),
    );
  }

  const runs = await Promise.all(jobs);

  for (const s of skipped) {
    const tool = TOOL_BY_NAME.get(s.tool);
    if (!tool) continue;
    runs.push({
      tool: tool.name,
      title: tool.title,
      description: tool.description,
      features: tool.features,
      args: {},
      ok: false,
      ms: 0,
      result: null,
      error: s.reason,
      degraded: [],
      how: [],
      why: "",
      miss: true,
      skipped: true,
      round,
      dependsOn: null,
      limitations: [],
    });
  }
  return runs;
}

/* ========================================================================== */
/* GAP RANKING (single place that decides which gap comes first)              */
/* ========================================================================== */

interface RankedGap {
  g: Row;
  top: ProfRef;
  fo: ProfRef;
  hops: number;
  lift: number | null;
}

/**
 * Order: (1) depth of the parent topic that rests on the weak base, deepest first,
 * (2) direct prerequisites before multi-hop dependencies, (3) foundation weight.
 * Used by follow-ups, findings, paths and next actions so they always agree.
 */
function rankedGaps(f: Row, topics: DevTopic[]): RankedGap[] {
  const raw: Row[] = Array.isArray(f.foundationGaps) ? f.foundationGaps : [];
  return raw
    .map((g) => {
      const lift = Number(g.foundationLift);
      return {
        g,
        top: profOf(topics, String(g.topic), g.topicLevel),
        fo: profOf(topics, String(g.foundation), g.foundationLevel),
        hops: Math.max(1, Number(g.hops) || 1),
        lift: Number.isFinite(lift) && g.foundationLift != null ? lift : null,
      };
    })
    .sort(
      (a, b) =>
        levelRank(b.top.prof) - levelRank(a.top.prof) ||
        a.hops - b.hops ||
        (b.lift ?? -1) - (a.lift ?? -1),
    );
}

/* ========================================================================== */
/* ROUND 2: follow-ups that depend on what round 1 FOUND                      */
/* ========================================================================== */

/**
 * Deterministic, not LLM-chosen: a second tool runs only when a first result
 * leaves a concrete open question (a flagged topic to inspect, a recommended
 * topic whose prerequisites are unknown). Never "because another tool exists".
 */
function planFollowUps(runs: AgentRun[], topics: DevTopic[]): PlannedCall[] {
  const out: PlannedCall[] = [];
  const ran = new Set(runs.map((r) => r.tool));
  const add = (c: PlannedCall) => {
    if (
      out.length < 2 &&
      !ran.has(c.tool) &&
      !out.some((x) => x.tool === c.tool)
    )
      out.push(c);
  };

  for (const r of runs) {
    if (!r.ok || r.miss || r.skipped || !r.result) continue;
    const f = (r.result.facts ?? {}) as Row;

    if (r.tool === "find_gaps") {
      const top = rankedGaps(f, topics)[0];
      const upper = top?.top.slug ?? null;
      if (top && upper) {
        add({
          tool: "explain_topic",
          args: { topic: upper },
          why: `Find_gaps flagged ${top.top.name} as resting on a weak foundation; checking how it was rated and on what evidence.`,
          dependsOn: "find_gaps",
        });
        add({
          tool: "learning_path_to_topic",
          args: { topic: upper },
          why: `Showing which prerequisites of ${top.top.name} are still weak or unassessed.`,
          dependsOn: "find_gaps",
        });
      }
    }

    if (r.tool === "recommend_next_topics") {
      const n = Array.isArray(f.learnNext) ? f.learnNext[0] : null;
      if (n?.topic) {
        add({
          tool: "learning_path_to_topic",
          args: { topic: String(n.topic) },
          why: `Checking the prerequisite chain for ${n.topic}, the top recommendation.`,
          dependsOn: "recommend_next_topics",
        });
      }
    }
  }
  return out;
}

/* ========================================================================== */
/* STRUCTURED INVESTIGATION (built from tool output, never from the LLM)      */
/* ========================================================================== */

/** Plain-text evidence lines taken straight from the tool's UI blocks. */
function evidenceLines(r: AgentRun): string[] {
  const lines: string[] = [];
  const blocks = (r.result?.blocks ?? []) as any[];
  const names = (items: any[]) =>
    items
      .map((i) => String(i?.name ?? ""))
      .filter(Boolean)
      .slice(0, 8)
      .join(", ");
  for (const b of blocks) {
    switch (b.type) {
      case "issues":
        for (const it of b.items ?? []) lines.push(`${it.title}: ${it.detail}`);
        break;
      case "callout":
        if (b.text) lines.push(`${b.title}: ${b.text}`);
        break;
      case "ranking":
        for (const it of b.items ?? [])
          lines.push(
            `${it.name}: ${it.display}${it.note ? ` (${it.note})` : ""}`,
          );
        break;
      case "topics":
        if ((b.items ?? []).length)
          lines.push(`${b.title ?? "Topics"}: ${names(b.items)}`);
        break;
      case "bullets":
        for (const it of b.items ?? []) lines.push(`${b.title}: ${it}`);
        break;
      case "approaches":
        for (const a of b.items ?? [])
          lines.push(`${a.name}: ${a.depth}, ${a.authenticity}`);
        break;
      case "roadmap":
        for (const st of b.steps ?? []) lines.push(`${st.name}: ${st.why}`);
        break;
      case "path":
        lines.push((b.steps ?? []).map((st: any) => st.name).join(" → "));
        break;
      case "stats":
        lines.push(
          (b.items ?? []).map((i: any) => `${i.label} ${i.value}`).join(", "),
        );
        break;
      case "groups":
        for (const g of b.groups ?? [])
          lines.push(`${g.label}: ${names(g.items ?? [])}`);
        break;
      case "compare":
        for (const row of b.rows ?? [])
          lines.push(`${row.label}: ${(row.values ?? []).join(" vs ")}`);
        break;
      case "timeline":
        for (const it of b.items ?? [])
          lines.push(`${it.label}: ${it.display}`);
        break;
      default:
        break;
    }
  }
  return lines
    .filter(Boolean)
    .map((l) => clip(l, 220))
    .slice(0, 8);
}

/** Topics whose explain output says the score is a graph-statistics estimate. */
function heuristicSlugs(runs: AgentRun[], topics: DevTopic[]): Set<string> {
  const out = new Set<string>();
  for (const r of runs) {
    if (!r.ok || !r.result) continue;
    const f = (r.result.facts ?? {}) as Row;
    const text = [
      r.result.summary,
      ...evidenceLines(r),
      String(f.verdict ?? ""),
    ].join(" ");
    if (!HEURISTIC_RE.test(text)) continue;
    const slug = resolveTopic(String(f.topic ?? ""), topics);
    if (slug) out.add(slug);
  }
  return out;
}

/** Reliability of a TOOL RESULT (query health). This is not skill confidence. */
function resultReliability(r: AgentRun): "low" | "medium" | "high" {
  if (r.degraded?.length) return "low";
  if (r.limitations.length) return "medium";
  return "high";
}

function minConfidence(
  list: Array<Proficiency["confidence"]>,
): Proficiency["confidence"] {
  const known = list.filter((c): c is "low" | "medium" | "high" => c != null);
  if (!known.length) return null;
  return known.reduce((a, b) => (CONF_RANK[b] < CONF_RANK[a] ? b : a));
}

function buildInvestigation(runs: AgentRun[], topics: DevTopic[]) {
  const steps: InvestigationStep[] = [];
  const findings: Finding[] = [];
  const gapPaths: GraphPath[] = [];
  const mainByTool = new Map<string, string>();
  /** every evidence line appears in exactly one finding */
  const usedEvidence = new Set<string>();
  const uniqueEvidence = (lines: string[]) =>
    lines.filter((l) => {
      const key = l.toLowerCase();
      if (usedEvidence.has(key)) return false;
      usedEvidence.add(key);
      return true;
    });

  let fid = 0;
  let pid = 0;
  const newId = () => `f${++fid}`;
  const newPathId = () => `p${++pid}`;

  runs.forEach((r, i) => {
    const status = statusOf(r);
    const findingIds: string[] = [];

    if ((status === "success" || status === "partial") && r.result) {
      const f = (r.result.facts ?? {}) as Row;
      const gaps = r.tool === "find_gaps" ? rankedGaps(f, topics) : [];

      if (gaps.length) {
        /* one canonical finding per gap; the tool-level summary is not repeated */
        gaps.slice(0, 3).forEach((x, idx) => {
          const id = newId();
          const pathId = newPathId();
          findingIds.push(id);
          mainByTool.set(`${r.tool}#${idx}`, id);
          if (idx === 0) mainByTool.set(r.tool, id);

          const direct = x.hops === 1;
          const unassessed = !x.fo.prof.assessed;
          const depLabel = direct
            ? "direct prerequisite"
            : `multi-hop dependency, ${x.hops} hops`;

          const evidence = uniqueEvidence([
            `${x.top.name}: ${fmtProf(x.top.prof)}${x.top.prof.confidence ? `, ${x.top.prof.confidence} evidence confidence` : ""}`,
            unassessed
              ? `${x.fo.name}: no assessment on file`
              : `${x.fo.name}: ${fmtProf(x.fo.prof)}${x.fo.prof.confidence ? `, ${x.fo.prof.confidence} evidence confidence` : ""}`,
            `${x.top.name} BUILDS_ON ${x.fo.name} (${depLabel})`,
            ...(x.lift != null
              ? [
                  `Graph importance of ${x.fo.name}: PageRank lift ${x.lift}. This is structure, not skill.`,
                ]
              : []),
          ]);

          const limitations = [...r.limitations];
          if (unassessed)
            limitations.push(
              "The foundation has not been assessed; this is missing evidence, not proven weakness.",
            );
          if (!direct)
            limitations.push(
              `Intermediate topics on this ${x.hops}-hop path are not listed by the graph tool; only the two endpoints are shown.`,
            );
          if (x.top.prof.source === "heuristic")
            limitations.push(
              `${x.top.name}'s level is an estimate from graph statistics, not a model judgement.`,
            );
          if (x.fo.prof.source === "heuristic")
            limitations.push(
              `${x.fo.name}'s level is an estimate from graph statistics, not a model judgement.`,
            );
          for (const c of [x.top.conflict, x.fo.conflict])
            if (c) limitations.push(c);

          findings.push({
            id,
            tool: r.tool,
            kind: "gap",
            claim: `${x.top.name} (${fmtProf(x.top.prof)}) stands on ${unassessed ? "an unassessed" : "a weak"} ${direct ? "direct prerequisite" : "multi-hop dependency"}: ${x.fo.name} (${fmtProf(x.fo.prof)}).`,
            evidence,
            reliability: resultReliability(r),
            confidence: unassessed
              ? null
              : minConfidence([x.top.prof.confidence, x.fo.prof.confidence]),
            proficiency: { topic: x.top.prof, foundation: x.fo.prof },
            importance: {
              metric: "pagerank_lift",
              value: x.lift,
              note: "How much of the graph rests on this topic. Not a skill rating.",
            },
            dependency: {
              relation: direct ? "direct" : "multi_hop",
              hops: x.hops,
            },
            priority: {
              rank: idx + 1,
              of: gaps.length,
              reason:
                `Ranked by parent depth, then proximity, then foundation weight. ` +
                `${x.top.name} is ${x.top.prof.level}, so a weak base under it costs the most; ` +
                (direct
                  ? `it is a direct prerequisite, so fixing it helps the parent immediately`
                  : `it is ${x.hops} hops down, so nearer links should be fixed first`) +
                (x.lift != null ? `; foundation weight ${x.lift}.` : "."),
            },
            limitations: limitations.length ? limitations : undefined,
            slugs: [x.top.slug, x.fo.slug].filter((s): s is string => !!s),
            pathId,
          });

          gapPaths.push({
            id: pathId,
            tool: r.tool,
            findingId: id,
            nodes: [x.top.name, x.fo.name],
            relationships: [
              direct ? "BUILDS_ON" : `BUILDS_ON (${x.hops} hops)`,
            ],
            steps: [
              { slug: x.top.slug, name: x.top.name, proficiency: x.top.prof },
              { slug: x.fo.slug, name: x.fo.name, proficiency: x.fo.prof },
            ],
            edges: [
              {
                from: x.top.name,
                to: x.fo.name,
                type: "BUILDS_ON",
                label: "builds on",
                relation: direct ? "direct" : "multi_hop",
                hops: x.hops,
              },
            ],
            meaning: `${x.top.name} is ${fmtProf(x.top.prof)}, but the topic it builds on is ${fmtProf(x.fo.prof)}.`,
          });
        });
      } else {
        const mainId = newId();
        findingIds.push(mainId);
        mainByTool.set(r.tool, mainId);
        findings.push({
          id: mainId,
          tool: r.tool,
          kind: "result",
          claim: r.result.summary,
          evidence: uniqueEvidence(evidenceLines(r)),
          reliability: resultReliability(r),
          limitations: r.limitations.length ? r.limitations : undefined,
          slugs: (r.result.slugs ?? []).slice(0, 8),
        });
      }
    }

    const summary =
      status === "failed"
        ? `Failed: ${r.error ?? "unknown error"}`
        : status === "empty"
          ? r.skipped
            ? (r.error ?? "No matching topic in your graph.")
            : "Nothing in your graph matched this check."
          : (r.result?.summary ?? "");

    steps.push({
      id: `step-${i + 1}`,
      tool: r.tool,
      title: r.title,
      purpose: r.why,
      status,
      summary: clip(summary, 280),
      findingIds,
      round: r.round,
      dependsOn: r.dependsOn,
      ms: r.ms,
    });
  });

  const usable = steps.filter(
    (s) => s.status === "success" || s.status === "partial",
  ).length;
  const status: "complete" | "partial" | "failed" =
    usable === 0
      ? "failed"
      : steps.every((s) => s.status === "success")
        ? "complete"
        : "partial";

  return {
    steps,
    findings,
    status,
    gapPaths,
    mainByTool,
    nextPathId: newPathId,
  };
}

/** Real paths pulled from tool output (gap paths are built with their findings above). */
function buildGraphPaths(
  runs: AgentRun[],
  topics: DevTopic[],
  mainByTool: Map<string, string>,
  newPathId: () => string,
): GraphPath[] {
  const out: GraphPath[] = [];
  const node = (name: string): PathNode => {
    const p = profOf(topics, name);
    return { slug: p.slug, name: p.name, proficiency: p.prof };
  };

  for (const r of runs) {
    if (!r.ok || r.miss || r.skipped || !r.result) continue;
    const f = (r.result.facts ?? {}) as Row;
    const blocks = (r.result.blocks ?? []) as any[];
    const findingId = mainByTool.get(r.tool) ?? null;

    if (r.tool === "connect_topics") {
      const pathBlock = blocks.find((b) => b.type === "path");
      const st: any[] = pathBlock?.steps ?? [];
      if (st.length >= 2) {
        const nodes = st.map((x) => node(String(x.name)));
        out.push({
          id: newPathId(),
          tool: r.tool,
          findingId,
          nodes: nodes.map((n) => n.name),
          relationships: st
            .slice(0, -1)
            .map((x) => String(x.edge ?? "linked to")),
          steps: nodes,
          edges: st.slice(0, -1).map((x, i) => {
            const raw = String(x.edge ?? "linked to");
            return {
              from: nodes[i].name,
              to: nodes[i + 1].name,
              type: raw.toUpperCase().replace(/\s+/g, "_"),
              label: raw,
              relation: "direct" as const,
              hops: 1,
            };
          }),
          meaning: `${st[0].name} reaches ${st[st.length - 1].name} in ${st.length - 1} ${plural(st.length - 1, "hop", "hops")} (${f.engine ?? "graph search"}).`,
        });
      }
    }

    if (r.tool === "explain_topic" && Array.isArray(f.buildsOn)) {
      for (const b of f.buildsOn.slice(0, 3)) {
        const raw = String(b);
        /* "Rate-limit handling (2 hops)" -> 2. No suffix means 1. */
        const hops = Math.max(1, Number(/(\d+)\s*hops?/i.exec(raw)?.[1]) || 1);
        const from = node(String(f.topic));
        const to = node(raw.replace(/\s*\(.*\)$/, ""));
        out.push({
          id: newPathId(),
          tool: r.tool,
          findingId,
          nodes: [from.name, to.name],
          relationships: [
            hops === 1 ? "BUILDS_ON" : `BUILDS_ON (${hops} hops)`,
          ],
          steps: [from, to],
          edges: [
            {
              from: from.name,
              to: to.name,
              type: "BUILDS_ON",
              label: "builds on",
              relation: hops === 1 ? "direct" : "multi_hop",
              hops,
            },
          ],
          meaning: `${from.name} builds on ${to.name}${hops > 1 ? ` (${hops} hops)` : ""}.`,
        });
      }
    }

    if (r.tool === "learning_path_to_topic") {
      const rm = blocks.find((b) => b.type === "roadmap");
      const st: any[] = rm?.steps ?? [];
      if (st.length >= 2) {
        const nodes = st.map((x) => node(String(x.name)));
        out.push({
          id: newPathId(),
          tool: r.tool,
          findingId,
          nodes: nodes.map((n) => n.name),
          relationships: st.slice(0, -1).map(() => "FOUNDATION_OF"),
          steps: nodes,
          edges: st.slice(0, -1).map((_, i) => ({
            from: nodes[i].name,
            to: nodes[i + 1].name,
            type: "FOUNDATION_OF",
            label: "is foundation of",
            relation: "direct" as const,
            hops: 1,
          })),
          meaning: r.result.summary,
        });
      }
    }
  }
  return out;
}

function buildNextActions(
  runs: AgentRun[],
  topics: DevTopic[],
  findings: Finding[],
): NextAction[] {
  const out: NextAction[] = [];
  const push = (a: NextAction) => {
    if (out.length < 4 && !out.some((x) => x.title === a.title)) out.push(a);
  };
  const mainFinding = (tool: string, kind?: Finding["kind"]) =>
    findings.find((x) => x.tool === tool && (!kind || x.kind === kind))?.id ??
    null;

  for (const r of runs) {
    if (!r.ok || r.miss || r.skipped || !r.result) continue;
    const f = (r.result.facts ?? {}) as Row;

    if (r.tool === "find_gaps") {
      const x = rankedGaps(f, topics)[0];
      const fid =
        findings.find((q) => q.tool === r.tool && q.priority?.rank === 1)?.id ??
        mainFinding(r.tool);
      if (x) {
        if (!x.fo.prof.assessed)
          push({
            type: "investigate",
            title: `Check ${x.fo.name}`,
            reason: `${x.top.name} depends on it, but it has no assessment yet, so the gap is unconfirmed.`,
            prompt: `Search my graph for ${x.fo.name}`,
            slug: x.fo.slug,
            findingId: fid,
          });
        else
          push({
            type: "learn",
            title: `Strengthen ${x.fo.name}`,
            reason: `${x.top.name} is ${fmtProf(x.top.prof)}, but ${x.fo.name} is only ${fmtProf(x.fo.prof)}.`,
            prompt: `How do I get to ${x.fo.name}?`,
            slug: x.fo.slug,
            findingId: fid,
          });
      }
      const shallow = Array.isArray(f.broadButShallow)
        ? f.broadButShallow[0]
        : null;
      if (shallow)
        push({
          type: "investigate",
          title: `Deepen ${shallow}`,
          reason: "Lots of files, but still working level or below.",
          prompt: `Explain my ${shallow}`,
          slug: resolveTopic(String(shallow), topics),
          findingId: fid,
        });
    }

    if (r.tool === "recommend_next_topics") {
      const n = Array.isArray(f.learnNext) ? f.learnNext[0] : null;
      if (n)
        push({
          type: "learn",
          title: `Learn ${n.topic}`,
          reason: `You already show ${(n.buildsOnKnown ?? []).slice(0, 3).join(", ")} which it builds on.`,
          prompt: `How do I get to ${n.topic}?`,
          slug: null,
          findingId: mainFinding(r.tool),
        });
    }

    if (r.tool === "audit_authenticity") {
      const q = Array.isArray(f.questionable) ? f.questionable[0] : null;
      if (q)
        push({
          type: "investigate",
          title: `Re-check ${q}`,
          reason: "Its evidence is boilerplate, incidental or thin.",
          prompt: `Explain my ${q}`,
          slug: resolveTopic(String(q), topics),
          findingId: mainFinding(r.tool),
        });
    }
  }
  return out;
}

/** Insight first: one diagnosis, one action, the strongest proof. Everything else stays collapsed. */
function buildInsight(
  findings: Finding[],
  paths: GraphPath[],
  actions: NextAction[],
  answer: string,
): Insight {
  const primary =
    findings.find((f) => f.kind === "gap" && f.priority?.rank === 1) ??
    findings.find((f) => f.kind === "result" && f.evidence.length) ??
    findings[0];
  if (!primary) return { ...EMPTY_INSIGHT, nextAction: actions[0] ?? null };

  const nextAction =
    actions.find((a) => a.findingId === primary.id) ?? actions[0] ?? null;
  const keyPath =
    paths.find((p) => p.id === primary.pathId) ??
    paths.find((p) => p.findingId === primary.id) ??
    null;

  return {
    diagnosis: {
      findingId: primary.id,
      headline: primary.claim,
      detail: answer,
      tone: primary.kind === "gap" ? "gap" : "info",
    },
    nextAction,
    keyEvidence: primary.evidence.slice(0, 3),
    keyPathId: keyPath?.id ?? null,
    otherFindingIds: findings
      .filter((f) => f.id !== primary.id)
      .map((f) => f.id),
  };
}

/* ========================================================================== */
/* COMPOSE                                                                    */
/* ========================================================================== */

const COMPOSE_SYSTEM = `You write the chat reply for Pathway's topic assistant. The interface already shows tables, rankings, lists, evidence and graph paths built from the tool results, so DO NOT repeat every item.
Write 2 to 4 plain sentences that interpret the result for the developer: the key takeaway, one notable detail, and one concrete next step. Name in plain words which graph analysis produced the key finding (for example "the betweenness ranking" or "the BUILDS_ON traversal"). Use ONLY the supplied facts. Never invent topics, levels, numbers or relationships. Address the developer as "you". No markdown, no bullet lists, no headings.
Keep four ideas apart and never use one word for two of them: proficiency (how deep the developer's skill is), confidence (how strong the evidence behind a rating is; low confidence means thin evidence, NOT wrong code), graph importance (how central a topic is, not a skill), gap priority (why one gap comes first). If a proficiency is marked "estimate", say it is an estimate. Hop language comes ONLY from the "relationships" list: use its labels exactly and never infer or count hops from any other fact. If a relationship is not listed, do not call it direct or multi-hop. Never write tool names like explain_topic; say "the topic explanation" instead.
Each result may carry "limitations". If a limitation affects the conclusion, state it plainly in one clause. Never turn a limitation into a claim: for example never say no gaps exist when a result says it could not be verified, and never call a topic weak when its foundation is merely unassessed.
If the developer asked about something the graph has no topic for, say so plainly in one sentence and use the closest topics the tools did return.
Also give:
- "tool_notes": an object mapping each tool name you were given to ONE short sentence (max 20 words) saying what that tool's result contributed to the answer.
- "followups": up to 3 short follow-up questions the tools can answer (gaps, what to learn next, a path to a topic, comparing topics, explaining a topic, foundations, bridges, communities).
Output minified JSON on one line, no commentary. Do not think out loud.

Return ONLY: {"answer":"","tool_notes":{"tool_name":""},"followups":[""]}`;

function fitFacts(runs: AgentRun[], budget = 3500): Row[] {
  const full = runs.map((r) => ({
    tool: r.tool,
    ok: r.ok,
    status: statusOf(r),
    summary: r.result?.summary ?? r.error,
    limitations: r.limitations,
    facts: r.result?.facts ?? null,
  }));
  if (JSON.stringify(full).length <= budget) return full;
  return full.map((r, i) => (i === 0 ? r : { ...r, facts: null }));
}

const FOLLOWUPS: Record<string, string[]> = {
  find_gaps: [
    "What should I learn next?",
    "Which of my topics are foundations?",
  ],
  recommend_next_topics: ["Where are my gaps?", "What have I built myself?"],
  learning_path_to_topic: ["Where are my gaps?", "What should I learn next?"],
  rank_foundations: ["Which topics bridge my skills?", "Where are my gaps?"],
  find_bridges: [
    "How do my skills group together?",
    "What should I learn next?",
  ],
  knowledge_communities: [
    "Which topics are isolated?",
    "Which topics bridge my skills?",
  ],
  connectivity_check: [
    "How do my skills group together?",
    "Where are my gaps?",
  ],
  connect_topics: ["What should I learn next?", "Where are my gaps?"],
  explore_neighborhood: ["Where are my gaps?", "What should I learn next?"],
  explain_topic: ["Where are my gaps?", "What builds on this topic?"],
  compare_topics: ["Where are my gaps?", "What should I learn next?"],
  search_topics: ["What am I strongest at?", "Where are my gaps?"],
  audit_authenticity: ["What am I strongest at?", "Where are my gaps?"],
  recent_activity: ["What am I strongest at?", "What should I learn next?"],
  profile_overview: [
    "What am I strongest at?",
    "Where are my gaps?",
    "What should I learn next?",
  ],
  strongest_topics: [
    "Where are my gaps?",
    "What have I built myself?",
    "What should I learn next?",
  ],
};
const DEFAULT_FOLLOWUPS = [
  "What am I strongest at?",
  "Where are my gaps?",
  "What should I learn next?",
];

function followupsFor(runs: AgentRun[]): string[] {
  const out: string[] = [];
  for (const r of runs)
    for (const f of FOLLOWUPS[r.tool] ?? []) if (!out.includes(f)) out.push(f);
  return (out.length ? out : DEFAULT_FOLLOWUPS).slice(0, 3);
}

const PREREQ_TYPES = new Set(["BUILDS_ON", "FOUNDATION_OF"]);

/** Returns null when the prose makes a hop claim that no real path supports. */
function sanitizeAnswer(answer: string, paths: GraphPath[]): string | null {
  let out = answer;
  for (const t of ALL_TOOLS)
    out = out.split(t.name).join(t.title.toLowerCase());

  const edges = paths.flatMap((p) => p.edges);
  const allowed = new Set<number>([
    ...edges.map((e) => e.hops),
    ...paths.map((p) => p.edges.length),
  ]);
  const hasDirect = edges.some(
    (e) => e.relation === "direct" && PREREQ_TYPES.has(e.type),
  );
  const hasMulti =
    edges.some((e) => e.relation === "multi_hop") ||
    paths.some((p) => p.edges.length > 1);

  if (/direct prerequisite/i.test(out) && !hasDirect) return null;
  if (/multi-?hop/i.test(out) && !hasMulti) return null;
  for (const m of out.matchAll(/\b(\d+)[- ]hops?\b/gi))
    if (!allowed.has(Number(m[1]))) return null;
  return out;
}

async function compose(
  llm: ChatLlm | null,
  message: string,
  runs: AgentRun[],
  paths: GraphPath[],
): Promise<{
  answer: string;
  followups: string[];
  notes: Record<string, string>;
  usedLlm: boolean;
}> {
  const good = runs.filter((r) => r.ok && r.result && !r.miss);
  const usable = good.length ? good : runs.filter((r) => r.ok && r.result);
  const caveat = usable.flatMap((r) => r.limitations)[0];
  const fallback = usable.length
    ? `${usable.map((r) => r.result!.summary).join(" ")}${caveat ? ` Note: ${caveat}` : ""}`.slice(
        0,
        800,
      )
    : "I couldn't find anything in your graph for that. Try a topic name from the constellation, or ask what you're strongest at.";

  if (!usable.length)
    return {
      answer: fallback,
      followups: DEFAULT_FOLLOWUPS,
      notes: {},
      usedLlm: false,
    };

  const relationships = paths.flatMap((p) =>
    p.edges.map((e) => ({
      edge: `${e.from} ${e.type} ${e.to}`,
      label: PREREQ_TYPES.has(e.type)
        ? e.relation === "direct"
          ? "direct prerequisite"
          : `multi-hop dependency, ${e.hops} hops`
        : `${e.label} link (association, not a prerequisite)`,
    })),
  );

  const raw = await askJson(
    llm,
    "synthesize",
    COMPOSE_SYSTEM,
    JSON.stringify({
      question: message,
      results: fitFacts(usable),
      relationships,
    }),
    450,
  );
  const draft = asText(raw?.answer, 900);
  const answer = draft ? sanitizeAnswer(draft, paths) : null;
  if (!answer)
    return {
      answer: fallback,
      followups: followupsFor(usable),
      notes: {},
      usedLlm: false,
    };

  const followups = Array.isArray(raw?.followups)
    ? (raw!.followups as unknown[])
        .map((f) => asText(f, 90))
        .filter(Boolean)
        .slice(0, 3)
    : [];

  const notes: Record<string, string> = {};
  if (raw?.tool_notes && typeof raw.tool_notes === "object") {
    for (const [k, v] of Object.entries(raw.tool_notes as Row)) {
      const t = asText(v, 200);
      if (t) notes[k] = t;
    }
  }
  return {
    answer,
    followups: followups.length ? followups : followupsFor(usable),
    notes,
    usedLlm: true,
  };
}

function mergeBlocks(runs: AgentRun[]): UiBlock[] {
  const anyGood = runs.some((r) => r.ok && r.result && !r.miss);
  const seen = new Set<string>();
  const blocks: UiBlock[] = [];
  for (const r of runs) {
    if (anyGood && r.miss) continue;
    for (const b of r.result?.blocks ?? []) {
      const key = `${b.type}:${"title" in b ? (b.title ?? "") : ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      blocks.push(b);
    }
  }
  return blocks.slice(0, 7);
}

/* ========================================================================== */
/* ENTRY POINT                                                                */
/* ========================================================================== */

export async function answerTopicQuestion(
  input: TopicChatInput,
): Promise<TopicChatResponse> {
  const started = Date.now();
  const emit = input.emit;
  const selected = input.selectedTopic?.trim() || null;
  const history = input.history ?? [];
  const ctx = createToolContext(input.graph, input.developerId, selected);
  const topics = await ctx.topics().catch(() => [] as DevTopic[]);

  /* start the heavy graph metrics now; they run while the planner thinks */
  void ctx.pageRank().catch(() => undefined);
  void ctx.betweenness().catch(() => undefined);

  emit?.({
    type: "stage",
    stage: "planning",
    agent: "Search",
    label: "Choosing which graph tools can answer this",
  });
  const t0 = Date.now();
  /*
   * Fast path: when the keyword router recognises the question, skip the
   * planner LLM call entirely (saves a whole model round trip). The LLM
   * planner only runs for vague questions or greetings.
   */
  const ruled = routeByRules(input.message, topics, selected);
  const OVERVIEW_RE =
    /summary|overview|about me|profile|how many (topics|skills|domains)|who am i/i;
  const vague =
    ruled.length === 1 &&
    ruled[0].tool === "profile_overview" &&
    !OVERVIEW_RE.test(input.message);
  const planned = vague
    ? await planWithLlm(input.llm, input.message, history, selected, topics)
    : null;

  if (planned && !planned.calls.length && planned.direct) {
    const plannerMs = Date.now() - t0;
    emit?.({
      type: "plan",
      by: "llm",
      model: input.llm?.model ?? null,
      ms: plannerMs,
      calls: [],
      skipped: [],
    });
    await streamAnswer(planned.direct, emit);
    return {
      answer: planned.direct,
      blocks: [],
      topics: [],
      followups: DEFAULT_FOLLOWUPS,
      tools: [],
      investigation: { status: "complete", steps: [] },
      findings: [],
      graphPaths: [],
      nextActions: [],
      insight: EMPTY_INSIGHT,
      meta: {
        mode: "direct",
        model: input.llm?.model ?? null,
        plannerUsedLlm: true,
        composerUsedLlm: false,
        plannerMs,
        toolsMs: 0,
        composeMs: 0,
        durationMs: Date.now() - started,
        rounds: 1,
      },
    };
  }

  let rawCalls = planned?.calls ?? [];
  if (!rawCalls.length) rawCalls = ruled;

  const { calls, skipped } = resolveCalls(rawCalls, topics, selected);
  const plannerMs = Date.now() - t0;
  console.log(`${LOG} plan`, {
    by: planned ? "llm" : "rules",
    calls: calls.map((c) => c.tool),
    skipped: skipped.map((s) => s.term),
  });
  emit?.({
    type: "plan",
    by: planned ? "llm" : "rules",
    model: planned ? (input.llm?.model ?? null) : null,
    ms: plannerMs,
    calls: calls.map((c) => ({
      tool: c.tool,
      title: TOOL_BY_NAME.get(c.tool)?.title ?? c.tool,
      why: c.why ?? TOOL_BY_NAME.get(c.tool)?.whenToUse ?? "",
      args: c.args,
    })),
    skipped,
  });

  emit?.({
    type: "stage",
    stage: "running",
    agent: "Graph tools",
    label: "Running FalkorDB algorithms and traversals",
  });
  const t1 = Date.now();
  const seen = new Set<string>();
  let runs = await executePlan(ctx, calls, selected, skipped, seen, 1, emit);

  /* round 2: only when round 1 left a concrete open question, within the call cap */
  let rounds: 1 | 2 = 1;
  const used = runs.filter((r) => !r.skipped).length;
  const follow = (
    process.env.TOPIC_CHAT_ROUND2 === "0" ? [] : planFollowUps(runs, topics)
  ).slice(0, Math.max(0, MAX_TOOL_CALLS - used));
  if (follow.length) {
    emit?.({
      type: "followup",
      calls: follow.map((c) => ({
        tool: c.tool,
        title: TOOL_BY_NAME.get(c.tool)?.title ?? c.tool,
        why: c.why ?? "",
        dependsOn: c.dependsOn ?? "",
      })),
    });
    const more = await executePlan(ctx, follow, selected, [], seen, 2, emit);
    runs = [...runs, ...more];
    rounds = 2;
  }
  const toolsMs = Date.now() - t1;

  /* build findings and paths first, so the composer can only use real labels */
  const heur = heuristicSlugs(runs, topics);
  const viewTopics = heur.size
    ? topics.map((t) =>
        heur.has(t.slug)
          ? ({ ...t, assessmentSource: "heuristic" } as DevTopic)
          : t,
      )
    : topics;
  const inv = buildInvestigation(runs, viewTopics);
  const otherPaths = buildGraphPaths(
    runs,
    viewTopics,
    inv.mainByTool,
    inv.nextPathId,
  );
  const graphPaths = [...inv.gapPaths, ...otherPaths].slice(0, 8);
  const nextActions = buildNextActions(runs, viewTopics, inv.findings);

  emit?.({
    type: "stage",
    stage: "composing",
    agent: "Answer",
    label: "Writing the answer from tool results",
  });
  const t2 = Date.now();
  const { answer, followups, notes, usedLlm } = await compose(
    input.llm,
    input.message,
    runs,
    graphPaths,
  );
  const composeMs = Date.now() - t2;
  emit?.({ type: "compose_done", usedLlm, ms: composeMs });

  await streamAnswer(answer, emit);

  const blocks = mergeBlocks(runs);
  const anyGood = runs.some((r) => r.ok && r.result && !r.miss);
  const topicSlugs = [
    ...new Set(
      runs
        .filter((r) => !anyGood || !r.miss)
        .flatMap((r) => r.result?.slugs ?? []),
    ),
  ].slice(0, 12);

  const insight = buildInsight(inv.findings, graphPaths, nextActions, answer);

  return {
    answer,
    blocks,
    topics: topicSlugs,
    followups,
    investigation: { status: inv.status, steps: inv.steps },
    findings: inv.findings,
    graphPaths,
    nextActions,
    insight,
    tools: runs.map((r) => ({
      name: r.tool,
      title: r.title,
      description: r.description ?? "",
      features: r.features,
      why: r.why,
      args: r.args ?? {},
      ms: r.ms,
      ok: r.ok,
      miss: r.miss,
      skipped: r.skipped,
      error: r.error,
      summary: r.result?.summary ?? null,
      contribution:
        notes[r.tool] ??
        (r.ok && r.result?.summary ? r.result.summary.slice(0, 180) : null),
      how: r.how ?? [],
      status: statusOf(r),
      round: r.round,
      dependsOn: r.dependsOn,
      degraded: r.degraded ?? [],
      limitations: r.limitations,
    })),
    meta: {
      mode: planned || usedLlm ? "llm" : "rules",
      model: input.llm?.model ?? null,
      plannerUsedLlm: Boolean(planned),
      composerUsedLlm: usedLlm,
      plannerMs,
      toolsMs,
      composeMs,
      durationMs: Date.now() - started,
      rounds,
    },
  };
}

export { ALL_TOOLS };
