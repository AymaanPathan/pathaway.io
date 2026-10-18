import type { Graph } from "../db/falkordb.js";
import { listTopicCatalog } from "../graph/depth-analyzer-graph.js";
import {
  buildGoalGraph,
  storeNextMove,
  type EvidenceItem,
  type GoalGraphResult,
  type NextMoveStored,
  type Resolution,
  type TopicLink,
} from "../graph/goal-graph.js";
import { cerebras, CEREBRAS_MODEL } from "../ai-models/cerebras.js";
import { gptOssNvidia } from "../ai-models/gpt-oss-nvidia.js";

type Row = Record<string, any>;

const LOG_PREFIX = "[goal-agent]";
function log(message: string, detail?: Row): void {
  if (detail !== undefined) console.log(`${LOG_PREFIX} ${message}`, detail);
  else console.log(`${LOG_PREFIX} ${message}`);
}

const str = (v: unknown, fallback = ""): string =>
  v == null || typeof v === "object" ? fallback : String(v).trim();
const uniq = <T>(items: T[]): T[] => [...new Set(items)];
const clip = (s: string, n: number): string =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
const strList = (v: unknown, max = 6): string[] =>
  (Array.isArray(v) ? v : [])
    .map((x) => str(x))
    .filter(Boolean)
    .slice(0, max);
const envInt = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/* ========================================================================== */
/* LLM CLIENT                                                                 */
/* ========================================================================== */

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  json?: boolean;
  signal?: AbortSignal;
}
export interface LlmClient {
  complete(req: LlmRequest): Promise<string>;
}

export function cerebrasClient(): LlmClient {
  return {
    async complete(req: LlmRequest): Promise<string> {
      const json = req.json ?? false;

      const response = await cerebras.chat.completions.create(
        {
          model: CEREBRAS_MODEL,
          temperature: 0.3,
          max_tokens: req.maxTokens,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          ...(json
            ? { response_format: { type: "json_object" as const } }
            : {}),
          // less hidden reasoning = far fewer tokens and much faster.
          // Remove this line if your SDK rejects the field.
          ...({ reasoning_effort: "low" } as object),
        },
        { signal: req.signal },
      );

      return response.choices[0]?.message?.content ?? "";
    },
  };
}

export function gptOssNvidiaClient(): LlmClient {
  return {
    async complete(req: LlmRequest): Promise<string> {
      if (!process.env.NVIDIA_API_KEY) {
        throw new Error("NVIDIA_API_KEY is missing from backend/.env");
      }

      const response = await gptOssNvidia.chat.completions.create(
        {
          model: process.env.NVIDIA_MODEL || "openai/gpt-oss-20b",
          temperature: 0.3,
          top_p: 1,
          max_tokens: req.maxTokens,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          // Remove this line if your SDK rejects the field.
          ...({ reasoning_effort: "low" } as object),
        },
        {
          signal: req.signal,
          maxRetries: 1,
        },
      );

      return response.choices[0]?.message?.content ?? "";
    },
  };
}

/* ========================================================================== */
/* TRANSPORT ERRORS + RETRIES (model request failed; not about the answer)    */
/* ========================================================================== */

export type LlmFailureKind =
  | "timeout"
  | "network"
  | "rate_limit"
  | "server"
  | "cancelled"
  | "permanent";

export class LlmError extends Error {
  attempts = 1;
  constructor(
    readonly kind: LlmFailureKind,
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
    cause?: unknown,
  ) {
    super(message);
    this.name = "LlmError";
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
  get transient(): boolean {
    return (
      this.kind === "timeout" ||
      this.kind === "network" ||
      this.kind === "rate_limit" ||
      this.kind === "server"
    );
  }
}

const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function parseRetryAfter(headers: unknown): number | undefined {
  const h = headers as any;
  const v =
    typeof h?.get === "function" ? h.get("retry-after") : h?.["retry-after"];
  if (v == null) return undefined;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(String(v));
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/** Turns anything the SDK throws into an LlmError. Verify the field names against your SDK. */
export function classifyLlmError(
  error: unknown,
  ctx: { timedOut: boolean; timeoutMs: number; callerAborted: boolean },
): LlmError {
  if (error instanceof LlmError) return error;
  if (ctx.callerAborted)
    return new LlmError(
      "cancelled",
      "cancelled by caller",
      undefined,
      undefined,
      error,
    );
  if (ctx.timedOut)
    return new LlmError(
      "timeout",
      `no response within ${ctx.timeoutMs}ms`,
      undefined,
      undefined,
      error,
    );

  const e = error as any;
  const name = String(e?.name ?? "");
  const msg = error instanceof Error ? error.message : String(error);
  const status: number | undefined =
    typeof e?.status === "number"
      ? e.status
      : typeof e?.statusCode === "number"
        ? e.statusCode
        : undefined;
  const retryAfter = parseRetryAfter(e?.headers);

  if (status === 429)
    return new LlmError(
      "rate_limit",
      "provider rate limit",
      status,
      retryAfter,
      error,
    );
  if (status === 408)
    return new LlmError(
      "timeout",
      "provider timeout",
      status,
      retryAfter,
      error,
    );
  if (status !== undefined && status >= 500)
    return new LlmError(
      "server",
      `provider error ${status}`,
      status,
      retryAfter,
      error,
    );
  if (status !== undefined && status >= 400)
    return new LlmError(
      "permanent",
      `provider rejected the request (${status})`,
      status,
      undefined,
      error,
    );
  if (/timeout/i.test(name))
    return new LlmError("timeout", "SDK timeout", undefined, undefined, error);
  if (
    NETWORK_CODES.has(String(e?.code ?? e?.cause?.code ?? "")) ||
    /connection|abort/i.test(name) ||
    /fetch failed|socket hang up|network/i.test(msg)
  )
    return new LlmError(
      "network",
      "network failure talking to the provider",
      undefined,
      undefined,
      error,
    );
  return new LlmError(
    "permanent",
    "unexpected LLM error",
    undefined,
    undefined,
    error,
  );
}

/** One request, one attempt: fresh AbortController, timeout cleaned up in finally. */
async function callLlm(
  llm: LlmClient,
  req: Omit<LlmRequest, "signal">,
  timeoutMs: number,
  callerSignal?: AbortSignal,
): Promise<string> {
  if (callerSignal?.aborted)
    throw new LlmError("cancelled", "cancelled by caller");
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCaller = () => controller.abort();
  callerSignal?.addEventListener("abort", onCaller, { once: true });
  try {
    return await llm.complete({ ...req, signal: controller.signal });
  } catch (error) {
    throw classifyLlmError(error, {
      timedOut,
      timeoutMs,
      callerAborted: Boolean(callerSignal?.aborted),
    });
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCaller);
  }
}

export interface RetryOptions {
  timeoutMs: number; // per request
  maxRetries: number; // transport retries only
  budgetMs: number; // total time for all attempts + waits
  signal?: AbortSignal;
  label: string;
  notes: string[];
  baseDelayMs?: number; // tests set this to ~1
}
const MIN_ATTEMPT_MS = 5_000;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const t = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });

/** Retries transport failures only. It never looks at the model's answer. */
export async function callLlmWithRetry(
  llm: LlmClient,
  req: Omit<LlmRequest, "signal">,
  o: RetryOptions,
): Promise<{ text: string; attempts: number }> {
  const startedAt = Date.now();
  const base = o.baseDelayMs ?? 500;
  let attempts = 0;
  for (;;) {
    attempts += 1;
    const remaining = o.budgetMs - (Date.now() - startedAt);
    try {
      const text = await callLlm(
        llm,
        req,
        Math.min(o.timeoutMs, Math.max(1_000, remaining)),
        o.signal,
      );
      if (attempts > 1)
        o.notes.push(`${o.label}: succeeded on attempt ${attempts}`);
      return { text, attempts };
    } catch (error) {
      const err =
        error instanceof LlmError
          ? error
          : classifyLlmError(error, {
              timedOut: false,
              timeoutMs: o.timeoutMs,
              callerAborted: false,
            });
      err.attempts = attempts;
      const retriesUsed = attempts - 1;
      const backoff = Math.min(8_000, base * 2 ** retriesUsed);
      const jittered = backoff / 2 + Math.random() * (backoff / 2);
      const delay = Math.max(jittered, err.retryAfterMs ?? 0);
      const left = o.budgetMs - (Date.now() - startedAt) - delay;
      const detail = `${err.kind}${err.status ? ` ${err.status}` : ""}`;
      const cause = (err as { cause?: unknown }).cause;
      log(`${o.label} attempt ${attempts} failed`, {
        kind: err.kind,
        status: err.status,
        cause: cause instanceof Error ? cause.message : String(cause ?? ""),
      });

      if (
        !err.transient ||
        retriesUsed >= o.maxRetries ||
        left < MIN_ATTEMPT_MS
      ) {
        o.notes.push(
          `${o.label}: gave up after ${attempts} attempt${attempts === 1 ? "" : "s"} (${detail}${!err.transient ? ", not retryable" : retriesUsed >= o.maxRetries ? ", retry limit" : ", time budget"})`,
        );
        throw err;
      }
      o.notes.push(
        `${o.label}: attempt ${attempts} failed (${detail}), retrying in ${Math.round(delay)}ms`,
      );
      await sleep(delay, o.signal);
    }
  }
}

export function extractJson(text: string): Row | null {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const body = cleaned.slice(start, end + 1);
  for (const candidate of [body, body.replace(/,\s*([}\]])/g, "$1")]) {
    try {
      const v = JSON.parse(candidate);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Row;
    } catch {}
  }
  return null;
}

/* ========================================================================== */
/* TYPES                                                                      */
/* ========================================================================== */

/** An alternative the agent weighed, with the evidence behind it and its trade-off. */
export interface ConsideredOption {
  option: string;
  /** why it was not taken */
  whyNot: string;
  /** what taking it would have given and cost */
  tradeoff: string;
  /** evidence ids that support or limit this alternative (may be empty: then it is unevidenced) */
  evidenceIds: string[];
}

export interface Decision {
  focusSlug: string;
  capabilityId: string | null;
  /** the approach of the focus topic this move changes; null when it adds an approach not yet built */
  approachSlug: string | null;
  /** name of the new approach when approachSlug is null (must not already exist) */
  newApproach: string | null;
  /** what the graph shows, what the agent infers, and what has no evidence */
  basis: { observed: string; inferred: string; missing: string };

  buildsOnSlugs: string[];

  gapSlugs: string[];
  why: string;
  evidenceIds: string[];

  /** evidence ids of EXISTING code this move extends instead of rebuilding */
  reuses: string[];
  /** what is reused, what changes, and what new behaviour the task introduces */
  builds: { reused: string; changes: string; newBehavior: string };
  /** why this move over the alternatives, citing evidence, without claiming it is "best" */
  whyOverAlternatives: string;
  /** existing capabilities -> proposed change -> what will be verified */
  progression: { existing: string[]; change: string; verified: string };

  considered: ConsideredOption[];
}

interface Draft {
  decision: Decision;
  challenge: {
    mechanism: string;
    existingEvidenceId: string;
    observedInCode: string;
    limitation: string;
    /** a concrete situation in which the shown code misbehaves, and what happens instead */
    failureScenario: string;
  };
  task: {
    objective: string;
    startPath: string;
    steps: string[];
    doneWhen: string;
  };
}

/* ---- decision trace: built from the graph in code, never by the LLM ------- */

export interface TraceStep {
  kind: "topic" | "assessment" | "capability" | "evidence";
  label: string;
  slug: string;
  level: string;
  detail: string;
  /** relationship that connects this step to the previous one */
  edgeType: string;
  edgeReason: string;
  relevance: number;
}

export interface TracePath {
  evidenceId: string;
  role: "reused" | "cited" | "alternative";
  /** topic hops from the nearest seed to the topic that owns this evidence */
  hops: number;
  steps: TraceStep[];
}

export interface TraceNeighbour {
  slug: string;
  name: string;
  domain: string;
  linkType: string;
  reason: string;
  weight: number;
  level: string;
  assessed: boolean;
  relevance: number;
}

export interface TraceBuilt {
  id: string;
  repository: string;
  path: string;
  permalink: string;
  technique: string;
  depth: string;
  commit: string;
  what: string;
  excerpt: string;
}

export interface TraceAlternative {
  option: string;
  whyNot: string;
  tradeoff: string;
  evidence: Array<{ id: string; path: string }>;
}

export interface DecisionTrace {
  seeds: string[];
  paths: TracePath[];
  neighbours: TraceNeighbour[];
  built: TraceBuilt[];
  builds: Decision["builds"];
  chosen: { title: string; why: string; evidenceIds: string[] };
  alternatives: TraceAlternative[];
  progression: Decision["progression"];
  basis: Decision["basis"];
  /** what code inspection must confirm before the task is worth doing */
  verifyFirst: string;
}

export interface PlannedTask {
  title: string;
  decision: Decision;
  challenge: Draft["challenge"];
  startingPoint: {
    repository: string;
    path: string;
    permalink: string;
    commit: string;
  };
  steps: string[];

  doneWhen: string;
  why: string;
  focus: { slug: string; name: string; domain: string; level: string };
  /** the assessed approach this move builds on, with its own depth and authenticity */
  approach: {
    slug: string;
    name: string;
    depth: string;
    authenticity: string;
  } | null;
  targetCapability: { id: string; name: string } | null;
  evidence: Array<{
    id: string;
    repository: string;
    path: string;
    technique: string;
    depth: string;
    commit: string;
    permalink: string;
  }>;
  evidenceIds: string[];
  strengthSlugs: string[];
  gapSlugs: string[];
  /** graph-backed explanation of why this move was chosen */
  trace: DecisionTrace;
}

export interface GoalPlan {
  status:
    | "planned"
    | "needs_clarification"
    | "needs_evidence"
    | "generation_failed"
    | "llm_unavailable";
  wish: string;
  resolution: Resolution;
  task: PlannedTask | null;
  source: "llm" | "llm_repaired" | "none";
  stored: NextMoveStored | null;
  clarification:
    | GoalGraphResult["clarification"]
    | { reason: string; suggestions: [] }
    | null;

  errors: string[];

  graph: {
    seeds: string[];
    topics: number;
    evidence: number;
    codeExcerpts: number;
    operations: GoalGraphResult["operations"];

    topicNodes: Array<{
      slug: string;
      name: string;
      domain: string;
      role: string;
      hops: number;
      relevance: number;
      level: string;
      assessed: boolean;
      authenticity: string;
    }>;

    links: GoalGraphResult["links"];

    context: GoalGraphResult["context"];

    ranking: GoalGraphResult["ranking"];
  } | null;
  llmCalls: number;
  /** extra requests made only because the transport failed (not validation repairs) */
  llmRetries: number;
  /** why generation_failed happened: infrastructure ("transport") or rejected output ("validation") */
  failure: {
    stage: "transport" | "validation";
    kind?: LlmFailureKind;
    transient: boolean;
    attempts: number;
  } | null;
  timingsMs: { graph: number; llm: number; store: number; total: number };
  notes: string[];
}

export interface PlanGoalInput {
  developerId: string;
  wish: string;
  goalTopics?: string[];
  persist?: boolean;
  /** per LLM request (default LLM_TIMEOUT_MS or 25s) */
  timeoutMs?: number;
  /** transport retries per request (default LLM_MAX_RETRIES or 1, max 5) */
  maxRetries?: number;
  /** total LLM time budget for one call including retries (default LLM_TOTAL_BUDGET_MS or 45s) */
  budgetMs?: number;
  /** caller cancellation */
  signal?: AbortSignal;
}

/* ========================================================================== */
/* PROMPT (small input, compact output; the server expands it into a Draft)   */
/* ========================================================================== */

const SYSTEM = `You choose ONE next engineering move for a developer from DATA and CODE. Reply with JSON only.
Rules:
- focusSlug must be one of "seeds" (unless method is "domain").
- Fix a failure VISIBLE in CODE: unhandled error, dead code, hard-coded value that breaks a real case, two paths that disagree. Not options, flexibility, practice or tests-for-completeness.
- reuseId is an evidence id with hasCode=true. observedInCode is copied verbatim (12-140 chars) from that code.
- Use only slugs, capability ids and evidence ids from DATA. Do not repeat "done" or "previous". Only mention past work if "hasHistory" is true.
- approachSlug is the approach of the focus topic your move changes (from DATA), or null plus newApproach.
Shape:
{"focusSlug":"","capabilityId":null,"approachSlug":null,"newApproach":"","buildsOnSlugs":[],"gapSlugs":[],
"why":"2 sentences citing E#","reuseId":"E#","evidenceIds":["E#"],
"observedInCode":"","limitation":"what that code does wrong","failureScenario":"concrete input/state where it misbehaves and what happens instead",
"objective":"verb first, 12-120 chars","steps":["3-4 specific steps, step 1 opens the file"],"doneWhen":"one checkable condition",
"alternative":{"option":"","evidenceId":"E#","whyNot":""}}`;

function renderUser(result: GoalGraphResult): string {
  const seeds = new Set(result.resolution.seeds.map((s) => s.slug));
  const codeIds = new Set(result.code.map((c) => c.evidenceId));

  const topics = [...result.topics]
    .sort(
      (a, b) =>
        Number(seeds.has(b.slug)) - Number(seeds.has(a.slug)) ||
        b.relevance - a.relevance,
    )
    .slice(0, 6);
  const topicSlugs = new Set(topics.map((t) => t.slug));

  const evidence = result.evidence
    .filter((e) => codeIds.has(e.id) || topicSlugs.has(e.topicSlug))
    .sort((a, b) => Number(codeIds.has(b.id)) - Number(codeIds.has(a.id)))
    .slice(0, 8);

  const data = {
    goal: clip(result.wish, 200),
    seeds: [...seeds],
    method: result.resolution.method,
    topics: topics.map((t) => ({
      slug: t.slug,
      name: t.name,
      level:
        t.depth.assessed && !t.depth.estimated ? t.depth.level : "unassessed",
      gaps: t.depth.gaps.slice(0, 2).map((g) => clip(g, 100)),
      approaches: t.depth.approaches
        .slice(0, 3)
        .map((a) => ({ slug: a.slug, name: a.name, depth: a.depth })),
    })),
    capabilities: result.coverage
      .filter((c) => seeds.has(c.topicSlug))
      .slice(0, 8)
      .map((c) => ({
        id: c.capabilityId,
        name: c.capability,
        demos: c.demonstrations,
      })),
    evidence: evidence.map((e) => ({
      id: e.id,
      topic: e.topicSlug,
      path: e.path,
      capabilityId: e.capabilityId || null,
      technique: clip(e.technique, 60),
      hasCode: codeIds.has(e.id),
    })),
    done: result.completedMoves.slice(0, 5).map((m) => clip(m.title, 80)),
    previous: result.previousMove?.title ?? null,
    hasHistory:
      Boolean(result.previousMove) || result.completedMoves.length > 0,
  };

  const blocks = result.code
    .slice(0, 3)
    .map(
      (c) =>
        `[${c.evidenceId}] ${c.path}\n\`\`\`\n${clip(c.excerpt, 600)}\n\`\`\``,
    )
    .join("\n\n");

  return `DATA:\n${JSON.stringify(data)}\n\nCODE (only code you may quote):\n${blocks || "(none)"}`;
}

/* ========================================================================== */
/* VALIDATION: auto-fix what code can fix, reject only what it cannot         */
/* ========================================================================== */

const GENERIC =
  /one level deeper|add a test for the new case|close this gap|best practices?|refactor for (clarity|readability)|improve (the )?(error handling|performance|code quality)/i;
const CHECKABLE =
  /\b(test|asserts?|returns?|responds?|status|header|logs?|emits?|throws?|rejects?|retries|retried|fails?|passes|exits?|calls?|equals?|within|at most|at least|exactly)\b/i;
const PATH_TOKEN = /[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.[A-Za-z0-9]{1,6}/g;
/** reasons that describe a nice-to-have or a learning exercise, not a failure */
const NICE_TO_HAVE =
  /\b(practice|exercise|learn(ing)?|extensib(le|ility)|flexib(le|ility)|nice[- ]to[- ]have|future[- ]?proof|might want|may want|in case|for completeness)\b/i;
/** "the code lacks an option" is not a failure */
const ABSENT_OPTION =
  /\b(only supports?|no way to (choose|configure|select|switch)|cannot be configured|not configurable|no option to|hard[- ]?coded to a single)\b/i;
/** a claim about earlier work */
const HISTORY_CLAIM =
  /\b(previous|earlier|last|prior) (move|mission|goal|task)s?\b/i;

function nameTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/&/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );
}
export function nearDuplicate(a: string, b: string): boolean {
  const A = nameTokens(a);
  const B = nameTokens(b);
  if (!A.size || !B.size) return false;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared += 1;
  return shared / Math.min(A.size, B.size) >= 0.8;
}

type Finalized =
  | { ok: true; draft: Draft; fixes: string[] }
  | { ok: false; errors: string[] };

function finalize(raw: Row | null, result: GoalGraphResult): Finalized {
  if (!raw) return { ok: false, errors: ["the reply was not valid JSON"] };
  const fixes: string[] = [];
  const topics = new Map(result.topics.map((t) => [t.slug, t]));
  const evidence = new Map(result.evidence.map((e) => [e.id, e]));
  const codeBy = new Map(result.code.map((c) => [c.evidenceId, c]));
  const seeds = result.resolution.seeds.map((s) => s.slug);
  const ids = (v: unknown) => strList(v, 8).map((x) => x.toUpperCase());

  // reuse evidence: must have code, otherwise pick one ourselves
  let reuseId = str(raw.reuseId ?? raw.existingEvidenceId).toUpperCase();
  if (!codeBy.has(reuseId)) {
    const fb =
      result.code.find((c) =>
        seeds.includes(evidence.get(c.evidenceId)?.topicSlug ?? ""),
      ) ?? result.code[0];
    if (!fb) return { ok: false, errors: ["no code excerpt available"] };
    fixes.push(`reuseId "${reuseId}" has no code, used ${fb.evidenceId}`);
    reuseId = fb.evidenceId;
  }
  const code = codeBy.get(reuseId)!;
  const anchor = evidence.get(reuseId)!;

  // focus
  let focus = str(raw.focusSlug);
  const needSeed = result.resolution.method !== "domain";
  if (!topics.has(focus) || (needSeed && !seeds.includes(focus))) {
    const next = seeds.includes(anchor.topicSlug)
      ? anchor.topicSlug
      : (seeds.find((s) => topics.has(s)) ?? seeds[0] ?? "");
    fixes.push(`focusSlug "${focus}" replaced by ${next}`);
    focus = next;
  }
  if (!topics.has(focus))
    return { ok: false, errors: ["no valid focus topic"] };

  // approach
  const approaches = topics.get(focus)!.depth.approaches;
  let approachSlug = str(raw.approachSlug);
  if (
    approachSlug === "null" ||
    !approaches.some((a) => a.slug === approachSlug)
  )
    approachSlug = "";
  let newApproach = str(raw.newApproach);
  if (newApproach === "null") newApproach = "";
  if (
    !approachSlug &&
    approaches.length &&
    (newApproach.length < 10 ||
      approaches.some(
        (a) => nearDuplicate(a.name, newApproach) || a.slug === newApproach,
      ))
  ) {
    approachSlug = (approaches.find((a) => a.isPrimary) ?? approaches[0]!).slug;
    newApproach = "";
  }

  const evidenceIds = uniq(
    [reuseId, ...ids(raw.evidenceIds)].filter((id) => evidence.has(id)),
  );
  const buildsOnSlugs = strList(raw.buildsOnSlugs, 4).filter(
    (s) =>
      topics.has(s) &&
      evidenceIds.some((id) => evidence.get(id)?.topicSlug === s),
  );
  const gapSlugs = strList(raw.gapSlugs, 4).filter((s) => topics.has(s));
  const capRaw = str(raw.capabilityId);
  const capabilityId = result.coverage.some((c) => c.capabilityId === capRaw)
    ? capRaw
    : null;

  // verbatim quote: take a real line from the code if the model's is not exact
  let observed = str(raw.observedInCode).replace(/(…|\.\.\.)+\s*$/, "");
  if (
    norm(observed).length < 12 ||
    !norm(code.excerpt).includes(norm(observed))
  ) {
    const line = code.excerpt
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length >= 12 && !/^(\/\/|\/\*|\*|import )/.test(l));
    observed = (line ?? code.excerpt.trim()).slice(0, 140);
    fixes.push("observedInCode replaced by a real line from the code");
  }

  const why = str(raw.why);
  const limitation = str(raw.limitation);
  const failureScenario = str(raw.failureScenario);
  const objective = clip(str(raw.objective).replace(/\s+/g, " "), 140);
  const steps = strList(raw.steps, 5);
  const doneWhen = str(raw.doneWhen);

  const errors: string[] = [];
  if (why.length < 30) errors.push("why is missing or too short");
  if (limitation.length < 20)
    errors.push("limitation must say what the code does wrong");
  if (failureScenario.length < 40)
    errors.push(
      "failureScenario must be a concrete situation where the code misbehaves (40+ chars)",
    );
  if (ABSENT_OPTION.test(limitation) || ABSENT_OPTION.test(failureScenario))
    errors.push(
      '"the code lacks an option" is not a failure; describe a wrong result or dropped error',
    );
  if (NICE_TO_HAVE.test(limitation) || NICE_TO_HAVE.test(failureScenario))
    errors.push(
      "the reasoning rests on practice/flexibility; choose a failure visible in the code",
    );
  if (objective.length < 12) errors.push("objective is missing or too short");
  if (steps.length < 3 || steps.some((s) => s.length < 20))
    errors.push("steps needs 3-5 specific steps (20+ chars each)");
  if (doneWhen.length < 30 || !CHECKABLE.test(doneWhen))
    errors.push("doneWhen must be one observable, checkable condition");
  if ([objective, doneWhen, ...steps].some((s) => GENERIC.test(s)))
    errors.push("generic phrase used; name the specific mechanism");

  const known = result.evidence
    .map((e) => e.path.toLowerCase())
    .filter(Boolean);
  const stray = (
    [objective, ...steps, doneWhen].join(" ").match(PATH_TOKEN) ?? []
  ).filter((tok) => {
    const x = tok.toLowerCase();
    return !known.some((k) => k.endsWith(x) || x.endsWith(k) || k.includes(x));
  });
  if (stray.length)
    errors.push(`files not in the evidence: ${stray.slice(0, 3).join(", ")}`);

  if (
    !result.previousMove &&
    result.completedMoves.length === 0 &&
    [why, limitation].some((s) => HISTORY_CLAIM.test(s))
  )
    errors.push("do not mention previous/earlier moves: there is no history");
  if (
    result.evidence.some(
      (e) => e.technique && nearDuplicate(objective, e.technique),
    )
  )
    errors.push(
      "objective repeats a technique already demonstrated; propose new behaviour",
    );
  if (
    result.previousMove?.title &&
    nearDuplicate(objective, result.previousMove.title)
  )
    errors.push("objective repeats the previous move");
  const repeated = result.completedMoves.find(
    (m) => m.title && nearDuplicate(objective, m.title),
  );
  if (repeated)
    errors.push(
      `objective repeats a verified mission ("${clip(repeated.title, 80)}")`,
    );

  if (errors.length) return { ok: false, errors };

  const a = (raw.alternative ?? {}) as Row;
  const considered: ConsideredOption[] =
    str(a.option) && str(a.whyNot) && !nearDuplicate(str(a.option), objective)
      ? [
          {
            option: str(a.option),
            whyNot: str(a.whyNot),
            tradeoff: "",
            evidenceIds: ids([a.evidenceId]).filter((id) => evidence.has(id)),
          },
        ]
      : [];

  const draft: Draft = {
    decision: {
      focusSlug: focus,
      capabilityId,
      approachSlug: approachSlug || null,
      newApproach: approachSlug ? null : newApproach || null,
      basis: {
        observed: `${reuseId}: ${observed}`,
        inferred: why,
        missing: "",
      },
      buildsOnSlugs,
      gapSlugs,
      why,
      evidenceIds,
      reuses: [reuseId],
      builds: {
        reused: `Extends ${code.path} (${reuseId})`,
        changes: limitation,
        newBehavior: objective,
      },
      whyOverAlternatives: `${why} (${reuseId})`,
      progression: {
        existing: [
          `${anchor.capability || anchor.technique || code.path} (${reuseId})`,
        ],
        change: objective,
        verified: doneWhen,
      },
      considered,
    },
    challenge: {
      mechanism: clip(objective, 140),
      existingEvidenceId: reuseId,
      observedInCode: observed,
      limitation,
      failureScenario,
    },
    task: { objective, startPath: code.path, steps, doneWhen },
  };
  return { ok: true, draft, fixes };
}

/* ========================================================================== */
/* DECISION TRACE (deterministic: derived from the graph result, not the LLM) */
/* ========================================================================== */

const EXCERPT_CHARS = 700;
const MAX_TRACE_PATHS = 8;

/**
 * Shortest route from any seed topic to `target` over the retrieved topic
 * links (BFS, stronger links first). Each hop keeps the link that was used so
 * the UI can show relationship type and reason.
 */
function topicRoute(
  result: GoalGraphResult,
  target: string,
): Array<{ slug: string; via: TopicLink | null }> {
  const seeds = result.resolution.seeds.map((s) => s.slug);
  if (seeds.includes(target)) return [{ slug: target, via: null }];

  const adj = new Map<string, Array<{ to: string; link: TopicLink }>>();
  const push = (from: string, to: string, link: TopicLink) => {
    const list = adj.get(from) ?? [];
    list.push({ to, link });
    adj.set(from, list);
  };
  for (const l of result.links) {
    push(l.a, l.b, l);
    push(l.b, l.a, l);
  }
  for (const list of adj.values())
    list.sort((x, y) => y.link.weight - x.link.weight);

  const parent = new Map<string, { prev: string; link: TopicLink } | null>();
  const queue: string[] = [];
  for (const s of seeds) {
    parent.set(s, null);
    queue.push(s);
  }
  while (queue.length && !parent.has(target)) {
    const cur = queue.shift() as string;
    for (const { to, link } of adj.get(cur) ?? []) {
      if (parent.has(to)) continue;
      parent.set(to, { prev: cur, link });
      queue.push(to);
    }
  }
  if (!parent.has(target)) return [{ slug: target, via: null }];

  const out: Array<{ slug: string; via: TopicLink | null }> = [];
  let cur: string = target;
  for (;;) {
    const p = parent.get(cur);
    out.push({ slug: cur, via: p ? p.link : null });
    if (!p) break;
    cur = p.prev;
  }
  return out.reverse();
}

function buildTrace(
  result: GoalGraphResult,
  decision: Decision,
  challenge: Draft["challenge"],
  objective: string,
): DecisionTrace {
  const topics = new Map(result.topics.map((t) => [t.slug, t]));
  const evById = new Map(result.evidence.map((e) => [e.id, e]));
  const codeBy = new Map(result.code.map((c) => [c.evidenceId, c.excerpt]));

  const pathFor = (e: EvidenceItem, role: TracePath["role"]): TracePath => {
    const route = topicRoute(result, e.topicSlug);
    const steps: TraceStep[] = route.map((r, i) => {
      const t = topics.get(r.slug);
      return {
        kind: "topic",
        label: t?.name ?? r.slug,
        slug: r.slug,
        level: t?.depth.level ?? "none",
        detail: t ? (i === 0 && t.role === "seed" ? "seed topic" : t.role) : "",
        edgeType: r.via?.type ?? "",
        edgeReason: r.via?.reason ?? "",
        relevance: t?.relevance ?? 0,
      };
    });
    const owner = topics.get(e.topicSlug);
    steps.push(
      owner?.depth.assessed
        ? {
            kind: "assessment",
            label: `${owner.depth.level} · ${owner.depth.authenticity || "authenticity unknown"}${owner.depth.estimated ? " · estimated" : ""}`,
            slug: owner.slug,
            level: owner.depth.level,
            detail: `${owner.depth.files} files · ${owner.depth.commits} commits · ${owner.depth.repos} repos${owner.depth.estimated ? " · level estimated from counts, not judged" : ""}`,
            edgeType: "ASSESSED → OF_TOPIC",
            edgeReason: owner.depth.verdict,
            relevance: 0,
          }
        : {
            kind: "assessment",
            label: "not assessed",
            slug: e.topicSlug,
            level: "none",
            detail: "no assessment exists for this topic",
            edgeType: "",
            edgeReason: "",
            relevance: 0,
          },
    );
    if (e.capabilityId)
      steps.push({
        kind: "capability",
        label: e.capability || e.capabilityId,
        slug: e.capabilityId,
        level: "none",
        detail: "capability mapped to the topic",
        edgeType: "MAPS_TO",
        edgeReason: "",
        relevance: 0,
      });
    steps.push({
      kind: "evidence",
      label: `${e.id} · ${e.path || e.technique || "evidence"}`,
      slug: e.id,
      level: "none",
      detail: e.technique || e.summary.slice(0, 120),
      edgeType: e.capabilityId
        ? "OF_CAPABILITY"
        : e.demonstrationId
          ? "EVIDENCED_BY"
          : "BACKED_BY",
      edgeReason: "",
      relevance: 0,
    });
    return {
      evidenceId: e.id,
      role,
      hops: Math.max(0, route.length - 1),
      steps,
    };
  };

  const reusedIds = uniq(decision.reuses).filter((id) => evById.has(id));
  const citedIds = uniq(decision.evidenceIds).filter(
    (id) => evById.has(id) && !reusedIds.includes(id),
  );
  const altIds = uniq(decision.considered.flatMap((c) => c.evidenceIds)).filter(
    (id) => evById.has(id) && !reusedIds.includes(id) && !citedIds.includes(id),
  );
  const paths: TracePath[] = [
    ...reusedIds.map((id) => pathFor(evById.get(id) as EvidenceItem, "reused")),
    ...citedIds.map((id) => pathFor(evById.get(id) as EvidenceItem, "cited")),
    ...altIds.map((id) =>
      pathFor(evById.get(id) as EvidenceItem, "alternative"),
    ),
  ].slice(0, MAX_TRACE_PATHS);

  const neighbours: TraceNeighbour[] = result.links
    .filter((l) => l.a === decision.focusSlug || l.b === decision.focusSlug)
    .sort((x, y) => y.weight - x.weight)
    .slice(0, 10)
    .map((l) => {
      const slug = l.a === decision.focusSlug ? l.b : l.a;
      const t = topics.get(slug);
      return {
        slug,
        name: t?.name ?? slug,
        domain: t?.domain ?? "",
        linkType: l.type,
        reason: l.reason,
        weight: l.weight,
        level: t?.depth.level ?? "none",
        assessed: t?.depth.assessed ?? false,
        relevance: t?.relevance ?? 0,
      };
    });

  const built: TraceBuilt[] = reusedIds.map((id) => {
    const e = evById.get(id) as EvidenceItem;
    return {
      id: e.id,
      repository: e.repository,
      path: e.path,
      permalink: e.permalink,
      technique: e.technique,
      depth: e.depth,
      commit: e.commitSubject,
      what: e.technique || e.summary,
      excerpt: clip(codeBy.get(id) ?? "", EXCERPT_CHARS),
    };
  });

  const alternatives: TraceAlternative[] = decision.considered.map((c) => ({
    option: c.option,
    whyNot: c.whyNot,
    tradeoff: c.tradeoff,
    evidence: c.evidenceIds
      .filter((id) => evById.has(id))
      .map((id) => ({ id, path: (evById.get(id) as EvidenceItem).path })),
  }));

  return {
    seeds: result.resolution.seeds.map((s) => s.name),
    paths,
    neighbours,
    built,
    builds: decision.builds,
    chosen: {
      title: objective,
      why: decision.whyOverAlternatives,
      evidenceIds: decision.evidenceIds,
    },
    alternatives,
    progression: decision.progression,
    basis: decision.basis,
    verifyFirst: `Open ${evById.get(challenge.existingEvidenceId)?.path ?? "the starting file"} and confirm this failure still happens in the current version: ${challenge.failureScenario}`,
  };
}

/* ========================================================================== */
/* WISH -> TOPICS                                                             */
/* ========================================================================== */

const MAP_SYSTEM = `Pick the topics from the list that best match the developer's goal.
Reply with JSON only: {"slugs":["slug1","slug2"]}
Use ONLY slugs from the list. At most 4. If nothing fits, reply {"slugs":[]}.`;

async function mapWishWithLlm(
  graph: Graph,
  llm: LlmClient,
  wish: string,
  retry: Omit<RetryOptions, "label">,
  stats: { calls: number },
  notes: string[],
): Promise<string[]> {
  const catalog = await listTopicCatalog(graph, 60);
  if (!catalog.length) return [];
  const known = new Map<string, string>();
  for (const t of catalog) {
    known.set(t.slug.toLowerCase(), t.slug);
    known.set(t.name.toLowerCase(), t.slug);
  }
  const list = catalog
    .map((t) => `${t.slug} | ${t.name} (${t.domain || "general"})`)
    .join("\n");
  try {
    const { text, attempts } = await callLlmWithRetry(
      llm,
      {
        system: MAP_SYSTEM,
        user: `Goal: ${clip(wish, 200)}\n\nTopics:\n${list}`,
        maxTokens: 200,
        json: true,
      },
      { ...retry, label: "topic mapping" },
    );
    stats.calls += attempts;
    const raw = extractJson(text)?.slugs;
    const slugs = uniq(
      (Array.isArray(raw) ? raw : [])
        .map((s: unknown) => known.get(str(s).toLowerCase()))
        .filter((s): s is string => Boolean(s)),
    );
    notes.push(`LLM mapped the wish to: ${slugs.join(", ") || "nothing"}`);
    return slugs.slice(0, 4);
  } catch (error) {
    if (error instanceof LlmError) stats.calls += error.attempts;
    notes.push(
      `topic mapping failed (${error instanceof LlmError ? error.kind : "error"})`,
    );
    return [];
  }
}

/* ========================================================================== */
/* PLAN                                                                       */
/* ========================================================================== */

/** validation-repair budget: only rejected model OUTPUT spends this, never a transport failure */
const MAX_ATTEMPTS = 2;

export async function planGoal(
  graph: Graph,
  llm: LlmClient | null,
  input: PlanGoalInput,
): Promise<GoalPlan> {
  const started = Date.now();
  const timeoutMs = input.timeoutMs ?? envInt("LLM_TIMEOUT_MS", 25_000);
  const maxRetries =
    input.maxRetries ?? Math.min(envInt("LLM_MAX_RETRIES", 1), 5);
  const budgetMs = input.budgetMs ?? envInt("LLM_TOTAL_BUDGET_MS", 45_000);
  const deadline = started + envInt("GOAL_DEADLINE_MS", 55_000);
  const notes: string[] = [];
  const timings = { graph: 0, llm: 0, store: 0, total: 0 };
  const stats = { calls: 0 };
  let llmRetries = 0;
  let wish = input.wish.trim();
  let goalTopics = input.goalTopics;
  const retryBase = {
    timeoutMs,
    maxRetries,
    budgetMs,
    signal: input.signal,
    notes,
  };

  const finishPlan = (
    p: Partial<GoalPlan> & Pick<GoalPlan, "status" | "wish" | "resolution">,
  ): GoalPlan => {
    timings.total = Date.now() - started;
    return {
      task: null,
      source: "none",
      stored: null,
      clarification: null,
      errors: [],
      graph: null,
      llmCalls: stats.calls,
      llmRetries,
      failure: null,
      timingsMs: timings,
      notes,
      ...p,
    };
  };

  if (!wish && !goalTopics?.length) {
    const rows = await graph.query(
      `MATCH (:Developer {id: $dev})-[:ASSESSED]->(a:DepthAssessment)-[:OF_TOPIC]->(t:Topic)
       RETURN t.slug AS slug ORDER BY coalesce(a.score, 0) DESC LIMIT 3`,
      { params: { dev: input.developerId } },
    );
    goalTopics = ((rows.data ?? []) as Row[])
      .map((r) => str(r.slug))
      .filter(Boolean);
    wish = "auto goal";
    notes.push(
      `no wish given: started from your strongest topics (${goalTopics.join(", ")})`,
    );
  }

  let t0 = Date.now();
  let result = await buildGoalGraph(graph, {
    developerId: input.developerId,
    wish,
    goalTopics,
  });
  timings.graph += Date.now() - t0;

  if (result.resolution.needsClarification && llm) {
    t0 = Date.now();
    const slugs = await mapWishWithLlm(
      graph,
      llm,
      wish,
      retryBase,
      stats,
      notes,
    );
    timings.llm += Date.now() - t0;
    if (slugs.length) {
      t0 = Date.now();
      result = await buildGoalGraph(graph, {
        developerId: input.developerId,
        wish,
        goalTopics: slugs,
      });
      timings.graph += Date.now() - t0;
    }
  }
  if (result.resolution.needsClarification)
    return finishPlan({
      status: "needs_clarification",
      wish: result.wish,
      resolution: result.resolution,
      clarification: result.clarification,
    });

  const graphInfo: GoalPlan["graph"] = {
    seeds: result.resolution.seeds.map((s) => s.slug),
    topics: result.topics.length,
    evidence: result.evidence.length,
    codeExcerpts: result.code.length,
    operations: result.operations,
    topicNodes: result.topics.map((t) => ({
      slug: t.slug,
      name: t.name,
      domain: t.domain,
      role: t.role,
      hops: t.hops,
      relevance: t.relevance,
      level: t.depth.level,
      assessed: t.depth.assessed,
      authenticity: t.depth.authenticity,
    })),
    links: result.links,
    context: result.context,
    ranking: result.ranking,
  };

  if (!result.code.length) {
    notes.push(
      result.evidence.length
        ? "evidence exists but none has readable, non-test code behind it"
        : "no demonstration, assessment-cited code or matching authored file is linked to this topic or its neighbourhood",
    );
    return finishPlan({
      status: "needs_evidence",
      wish: result.wish,
      resolution: result.resolution,
      graph: graphInfo,
      clarification: {
        reason: `The graph has no readable code for "${result.resolution.seeds.map((s) => s.name).join(", ")}" or its related topics to build a verified task from. Sync or analyse the relevant repositories, or name a topic you have already built.`,
        suggestions: [],
      },
    });
  }

  if (!llm)
    return finishPlan({
      status: "llm_unavailable",
      wish: result.wish,
      resolution: result.resolution,
      graph: graphInfo,
      notes: [
        ...notes,
        "no LLM configured: the agent makes the decision, so no task was produced",
      ],
    });

  // The graph is built once above and reused: a transport failure never rebuilds it.
  const user = renderUser(result);
  let errors: string[] = [];
  let draft: Draft | undefined;
  let repaired = false;
  let validationUsed = 0; // only rejected model output spends this
  let transportError: LlmError | null = null;
  t0 = Date.now();
  while (validationUsed < MAX_ATTEMPTS && Date.now() < deadline - 4_000) {
    const prompt =
      validationUsed === 0
        ? user
        : `${user}\n\nYour previous reply was rejected:\n${errors.map((e) => `- ${e}`).join("\n")}\nReturn corrected JSON only. If the problem is the reasoning, choose a different failure visible in CODE.`;
    let text = "";
    try {
      const r = await callLlmWithRetry(
        llm,
        { system: SYSTEM, user: prompt, maxTokens: 900, json: true },
        {
          ...retryBase,
          budgetMs: Math.max(5_000, Math.min(budgetMs, deadline - Date.now())),
          label: `goal generation (repair ${validationUsed})`,
        },
      );
      stats.calls += r.attempts;
      llmRetries += r.attempts - 1;
      text = r.text;
    } catch (error) {
      transportError =
        error instanceof LlmError
          ? error
          : classifyLlmError(error, {
              timedOut: false,
              timeoutMs,
              callerAborted: false,
            });
      stats.calls += transportError.attempts;
      llmRetries += transportError.attempts - 1;
      break; // transport is exhausted: do not burn repair attempts
    }
    const checked = finalize(extractJson(text), result);
    if (checked.ok) {
      draft = checked.draft;
      repaired = validationUsed > 0;
      if (checked.fixes.length)
        notes.push(`auto-fixed: ${checked.fixes.join(" | ")}`);
      break;
    }
    errors = checked.errors;
    validationUsed += 1;
    notes.push(
      `validation attempt ${validationUsed} rejected: ${errors.join(" | ")}`,
    );
  }
  timings.llm += Date.now() - t0;

  if (!draft)
    return finishPlan({
      status: "generation_failed",
      wish: result.wish,
      resolution: result.resolution,
      graph: graphInfo,
      errors: transportError ? [] : errors,
      failure: transportError
        ? {
            stage: "transport",
            kind: transportError.kind,
            transient: transportError.transient,
            attempts: transportError.attempts,
          }
        : { stage: "validation", transient: false, attempts: validationUsed },
    });

  const { decision, challenge, task: t } = draft;
  const topic = result.topics.find((x) => x.slug === decision.focusSlug)!;
  const anchor = result.evidence.find(
    (e) => e.id === challenge.existingEvidenceId,
  ) as EvidenceItem;
  const cap = decision.capabilityId
    ? result.coverage.find((c) => c.capabilityId === decision.capabilityId)
    : undefined;
  const evidenceIds = uniq(decision.evidenceIds);

  const task: PlannedTask = {
    title: t.objective,
    decision,
    challenge,
    startingPoint: {
      repository: anchor.repository,
      path: anchor.path,
      permalink: anchor.permalink,
      commit: anchor.commitSubject,
    },
    steps: t.steps,
    doneWhen: t.doneWhen,
    why: decision.why,
    focus: {
      slug: topic.slug,
      name: topic.name,
      domain: topic.domain,
      level: topic.depth.level,
    },
    approach: (() => {
      const a = topic.depth.approaches.find(
        (x) => x.slug === decision.approachSlug,
      );
      return a
        ? {
            slug: a.slug,
            name: a.name,
            depth: a.depth,
            authenticity: a.authenticity,
          }
        : null;
    })(),
    targetCapability: cap
      ? { id: cap.capabilityId, name: cap.capability }
      : null,
    evidence: evidenceIds
      .map((id) => result.evidence.find((e) => e.id === id))
      .filter((e): e is EvidenceItem => e !== undefined)
      .map((e) => ({
        id: e.id,
        repository: e.repository,
        path: e.path,
        technique: e.technique,
        depth: e.depth,
        commit: e.commitSubject,
        permalink: e.permalink,
      })),
    evidenceIds,
    strengthSlugs: decision.buildsOnSlugs,
    gapSlugs: decision.gapSlugs,
    trace: buildTrace(result, decision, challenge, t.objective),
  };

  // storeNextMove runs once, only after a fully validated draft, so retries never duplicate goals
  let stored: NextMoveStored | null = null;
  if (input.persist !== false) {
    t0 = Date.now();
    const summary = `${task.why}\n\nChallenge: ${challenge.limitation}\n\nFailure: ${challenge.failureScenario}\n\nSteps:\n${task.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\nDone when: ${task.doneWhen}`;
    stored = await storeNextMove(graph, result, {
      title: task.title,
      summary,
      focusSlug: task.focus.slug,
      strengthSlugs: task.strengthSlugs,
      gapSlugs: task.gapSlugs,
      evidenceIds: task.evidenceIds,
      capabilityId: task.targetCapability?.id ?? null,
      startFileChangeId: anchor.fileChangeId || null,
      doneWhen: task.doneWhen,
      details: {
        decision,
        challenge,
        startingPoint: task.startingPoint,
        steps: task.steps,
      },
    });
    timings.store = Date.now() - t0;
    if (stored.rejected.length)
      notes.push(...stored.rejected.map((r) => `store: ${r}`));
  }

  log("goal planned", {
    method: result.resolution.method,
    focus: task.focus.slug,
    capability: task.targetCapability?.id ?? null,
    reuses: decision.reuses,
    alternatives: decision.considered.length,
    llmCalls: stats.calls,
    llmRetries,
    ms: Date.now() - started,
  });

  return finishPlan({
    status: "planned",
    wish: result.wish,
    resolution: result.resolution,
    task,
    source: repaired ? "llm_repaired" : "llm",
    stored,
    graph: graphInfo,
  });
}
