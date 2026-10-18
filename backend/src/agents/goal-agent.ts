import type { Graph } from "../db/falkordb.js";
import { groq, GROQ_MODEL } from "../ai-models/groq.js";
import { listTopicCatalog } from "../graph/depth-analyzer-graph.js";
import {
  briefForAgent,
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
        },
        {
          signal: req.signal,
          maxRetries: 2,
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
  /** per LLM request (default LLM_TIMEOUT_MS or 60s) */
  timeoutMs?: number;
  /** transport retries per request (default LLM_MAX_RETRIES or 2, max 5) */
  maxRetries?: number;
  /** total LLM time budget for one call including retries (default LLM_TOTAL_BUDGET_MS or 120s) */
  budgetMs?: number;
  /** caller cancellation */
  signal?: AbortSignal;
}

/* ========================================================================== */
/* PROMPT                                                                     */
/* ========================================================================== */

const SYSTEM = `You are the decision maker of a developer-growth agent. A knowledge graph gives you DATA about one developer: topics, related topics, groups of topics, assessed depth, what they built, safeguards, capabilities with demonstration counts, and real code. The graph never chooses. You do.

Your job: decide the ONE next engineering move that moves this developer toward their goal, then turn it into a concrete task, and explain the choice so a reader can check it against the evidence.

How to decide:
1. Read what the developer has actually built (evidence + code) and how deep it is.
2. Look at related topics, groups and capabilities for the real options: deepen a mechanism they already built, fix a failure you can see, or extend into a related topic.
3. Weigh at least two alternatives against the move you choose.
4. Do NOT choose because a number is high (files, commits, repos, relevance). Those only describe volume.
5. "0 demonstrations" or "not assessed" means no evidence was found. It is NOT a proven weakness.
6. The developer named a topic (see resolvedBy.seeds). Your focusSlug MUST be one of those seed topics, unless resolvedBy.method is "domain". Related topics are context: use them in buildsOnSlugs or gapSlugs, never as the focus. Evidence with no capability or technique is still real authored code: you may start from it.
7. Reason approach by approach. Each topic lists its approaches with their own depth, authenticity, hardening and gaps. Pick the approach your move changes (decision.approachSlug, copied from the data). Only when the move adds an approach that does not exist yet, set approachSlug to null and give its name in decision.newApproach (it must differ from every listed approach).
8. Separate what you know. basis.observed: what the data and code show, citing evidence ids. basis.inferred: what you conclude from it. basis.missing: what has no evidence yet. Missing evidence is not proof of weakness; never state a weakness as fact unless the code shows it.
9. completedMoves lists missions this developer already verified. Do not repeat or lightly reword one.
10. Reuse before you add. If the CODE or evidence already contains a server, client, store, route or module that can carry the new behaviour, EXTEND it. List the evidence ids of the existing code you extend in decision.reuses, and say in decision.builds what is reused, what changes, and what new behaviour the task introduces.
11. Compare candidates. decision.considered needs at least two real alternatives. For each give the evidence ids that support or limit it, the trade-off, and why you did not take it. At least one alternative must be based on DIFFERENT code than your move (an evidence id that is not in decision.reuses) and must fix a failure you can see there. An alternative that is just a smaller version of your own move does not count.
12. decision.whyOverAlternatives must cite evidence ids and state what would change your choice. Do not claim your move is "best", "optimal" or "most important".
13. decision.progression: "existing" lists capabilities that already exist (cite E# ids), "change" is the proposed new behaviour, "verified" is the observable result that will be checked.
14. FIX A FAILURE YOU CAN SEE. challenge.failureScenario must describe a concrete situation (an input, event or state) in which the code shown in CODE behaves wrongly, and what happens instead of the right behaviour. Good gap types: code that exists but is never called; a failure path with no handling; a hard-coded value that breaks a real case; two code paths that disagree. NOT allowed: adding an optional parameter, strategy, option or configuration "for flexibility", learning exercises, or anything justified by practice, extensibility or "only supports X". If the first excerpt shows no failure, read the other excerpts before choosing.
15. HISTORY. Only claim past work that appears in "history", previousMove or completedMoves. If history.verifiedMissions is 0 and previousMoveForThisGoal is false, nothing was done before: never write "previous move", "earlier mission" or "already addressed".
16. ESTIMATED ASSESSMENTS. A topic with assessmentEstimated true has a level guessed from counts, with no model judgement. Do not use that level as a reason. Cite code instead.
17. Evidence marked newerVersionExists has no code on purpose: a newer version of that file is listed as its own evidence item. Start from evidence with hasCode true.
18. observedInCode must be copied exactly from the code, with no ellipsis and no added words.

Reply with JSON only, exactly this shape:
{
 "decision": {
  "focusSlug": "<topic slug from the data>",
  "capabilityId": "<capability id from the data or null>",
  "approachSlug": "<approach slug of the focus topic from the data that this move changes, or null when adding a new approach>",
  "newApproach": "<name of the new approach when approachSlug is null, else empty>",
  "buildsOnSlugs": ["<proven topic slugs this builds on>"],
  "gapSlugs": ["<topic slugs whose gap this closes, may be empty>"],
  "why": "<2-3 sentences: why THIS move, citing evidence ids like E4>",
  "evidenceIds": ["E#", "..."],
  "reuses": ["<E# of existing code this move extends; each must also be in evidenceIds>"],
  "builds": {
   "reused": "<what existing code/mechanism is reused, citing E#>",
   "changes": "<what in that code changes>",
   "newBehavior": "<the new behaviour the task introduces>"
  },
  "basis": {"observed": "<what the data and code show, citing E# ids>", "inferred": "<what you conclude from it>", "missing": "<what has no evidence yet, or empty>"},
  "considered": [{"option": "<alternative you weighed>", "evidenceIds": ["E#"], "tradeoff": "<what it would give and cost>", "whyNot": "<why you did not take it>"}],
  "whyOverAlternatives": "<why this move over the alternatives, citing E# ids, and what would change the choice>",
  "progression": {"existing": ["<existing capability, citing E#>"], "change": "<proposed change>", "verified": "<observable outcome that will be checked>"}
 },
 "challenge": {
  "mechanism": "<the exact mechanism being changed or added, one sentence>",
  "existingEvidenceId": "<E# of code you are starting from; must have code in CODE and be in decision.reuses>",
  "observedInCode": "<VERBATIM fragment, 12-140 chars, copied from that evidence's code, where the problem shows>",
  "limitation": "<what that code does wrong or leaves unhandled, 1-2 sentences, behaviour not 'no tests' and not 'only supports X'>",
  "failureScenario": "<a concrete situation where the shown code misbehaves and what happens instead, 40+ chars>"
 },
 "task": {
  "objective": "<starts with a verb, 12-120 chars, names the specific mechanism>",
  "startPath": "<exactly the path of existingEvidenceId>",
  "steps": ["<3 to 5 specific steps; step 1 opens startPath and names functions/behaviour from the code>"],
  "doneWhen": "<ONE observable condition a test, command or review can check>"
 }
}
Rules:
- Use only slugs, capability ids and evidence ids that appear in the data. Every slug in buildsOnSlugs needs at least one of its evidence ids in decision.evidenceIds.
- Do not invent files, functions or capabilities. Only reference code shown in CODE.
- Do not repeat something already built (see evidence techniques), the previousMove or a completedMoves entry.
- Forbidden phrases: "one level deeper", "add a test for the new case", "close this gap", "best practices", generic refactors.`;

function compactForPrompt(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    const limit = /excerpt|code/i.test(key)
      ? 350
      : /description|summary|reason|history/i.test(key)
        ? 180
        : 120;

    return clip(value, limit);
  }

  if (Array.isArray(value)) {
    const limit = /code/i.test(key)
      ? 4
      : /evidence/i.test(key)
        ? 14
        : /link/i.test(key)
          ? 10
          : /completedMoves|history/i.test(key)
            ? 5
            : /approaches|strengths|gaps|topics|seeds/i.test(key)
              ? 8
              : 8;

    return value.slice(0, limit).map((item) => compactForPrompt(item, key));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        compactForPrompt(v, k),
      ]),
    );
  }

  return value;
}

function renderUser(brief: Row): string {
  const { code, ...data } = brief;

  const compactData = compactForPrompt(data);

  const blocks = (
    Array.isArray(code)
      ? (code as Array<{
          evidenceId: string;
          path: string;
          excerpt: string;
        }>)
      : []
  )
    .slice(0, 4)
    .map(
      (c) =>
        `[${c.evidenceId}] ${c.path}\n\`\`\`\n${clip(c.excerpt, 350)}\n\`\`\``,
    )
    .join("\n\n");

  return `DATA:\n${JSON.stringify(compactData)}\n\nCODE (the only code you may quote):\n${blocks || "(none)"}`;
}

/* ========================================================================== */
/* VALIDATION                                                                 */
/* ========================================================================== */

const GENERIC =
  /one level deeper|add a test for the new case|close this gap|best practices?|refactor for (clarity|readability)|improve (the )?(error handling|performance|code quality)/i;
const CHECKABLE =
  /\b(test|asserts?|returns?|responds?|status|header|logs?|emits?|throws?|rejects?|retries|retried|fails?|passes|exits?|calls?|equals?|within|at most|at least|exactly)\b/i;
const PATH_TOKEN = /[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.[A-Za-z0-9]{1,6}/g;
const SUPERLATIVE =
  /\b(the best|best option|best choice|optimal|most important|clearly better|obviously)\b/i;
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

function readDraft(raw: Row | null): Draft | null {
  if (!raw) return null;
  const d = (raw.decision ?? {}) as Row;
  const c = (raw.challenge ?? {}) as Row;
  const t = (raw.task ?? {}) as Row;
  const b = (d.builds ?? {}) as Row;
  const p = (d.progression ?? {}) as Row;
  const considered: ConsideredOption[] = (
    Array.isArray(d.considered) ? d.considered : []
  )
    .map((x: Row) => ({
      option: str(x?.option),
      whyNot: str(x?.whyNot),
      tradeoff: str(x?.tradeoff),
      evidenceIds: strList(x?.evidenceIds, 6).map((id) => id.toUpperCase()),
    }))
    .filter((x: ConsideredOption) => x.option && x.whyNot)
    .slice(0, 4);
  return {
    decision: {
      focusSlug: str(d.focusSlug),
      capabilityId:
        str(d.capabilityId) && str(d.capabilityId) !== "null"
          ? str(d.capabilityId)
          : null,
      approachSlug:
        str(d.approachSlug) && str(d.approachSlug) !== "null"
          ? str(d.approachSlug)
          : null,
      newApproach:
        str(d.newApproach) && str(d.newApproach) !== "null"
          ? str(d.newApproach)
          : null,
      basis: {
        observed: str((d.basis as Row | undefined)?.observed),
        inferred: str((d.basis as Row | undefined)?.inferred),
        missing: str((d.basis as Row | undefined)?.missing),
      },
      buildsOnSlugs: strList(d.buildsOnSlugs, 4),
      gapSlugs: strList(d.gapSlugs, 4),
      why: str(d.why),
      evidenceIds: strList(d.evidenceIds, 8).map((x) => x.toUpperCase()),
      reuses: strList(d.reuses, 6).map((x) => x.toUpperCase()),
      builds: {
        reused: str(b.reused),
        changes: str(b.changes),
        newBehavior: str(b.newBehavior ?? b.new_behavior),
      },
      whyOverAlternatives: str(d.whyOverAlternatives),
      progression: {
        existing: strList(p.existing, 5),
        change: str(p.change),
        verified: str(p.verified),
      },
      considered,
    },
    challenge: {
      mechanism: str(c.mechanism),
      existingEvidenceId: str(c.existingEvidenceId).toUpperCase(),
      observedInCode: str(c.observedInCode),
      limitation: str(c.limitation),
      failureScenario: str(c.failureScenario),
    },
    task: {
      objective: clip(str(t.objective).replace(/\s+/g, " "), 140),
      startPath: str(t.startPath),
      steps: strList(t.steps, 6),
      doneWhen: str(t.doneWhen ?? t.done_when),
    },
  };
}

function validate(
  raw: Row | null,
  result: GoalGraphResult,
): { ok: true; draft: Draft } | { ok: false; errors: string[] } {
  const draft = readDraft(raw);
  if (!draft) return { ok: false, errors: ["the reply was not valid JSON"] };
  const errors: string[] = [];
  const { decision: d, challenge: c, task: t } = draft;

  const topics = new Map(result.topics.map((x) => [x.slug, x]));
  const evidence = new Map(result.evidence.map((e) => [e.id, e]));
  const codeBy = new Map(result.code.map((x) => [x.evidenceId, x]));
  const capabilities = new Set(result.coverage.map((x) => x.capabilityId));

  if (!topics.has(d.focusSlug))
    errors.push(
      `decision.focusSlug "${d.focusSlug}" is not a topic slug in the data`,
    );

  const seedSlugs = result.resolution.seeds.map((s) => s.slug);
  if (
    result.resolution.method !== "domain" &&
    topics.has(d.focusSlug) &&
    !seedSlugs.includes(d.focusSlug)
  )
    errors.push(
      `decision.focusSlug must be one of the topics the developer asked about (${seedSlugs.join(", ")}); use related topics only in buildsOnSlugs or gapSlugs`,
    );

  if (d.capabilityId && !capabilities.has(d.capabilityId))
    errors.push(
      `decision.capabilityId "${d.capabilityId}" is not a capability id in the data (use null if none)`,
    );
  for (const s of d.buildsOnSlugs)
    if (!topics.has(s))
      errors.push(`buildsOnSlugs "${s}" is not a topic slug in the data`);
  for (const s of d.gapSlugs)
    if (!topics.has(s))
      errors.push(`gapSlugs "${s}" is not a topic slug in the data`);

  const badIds = d.evidenceIds.filter((id) => !evidence.has(id));
  if (badIds.length)
    errors.push(`evidenceIds not in the data: ${badIds.join(", ")}`);
  if (!d.evidenceIds.length)
    errors.push("decision.evidenceIds must cite at least one evidence id");
  for (const s of d.buildsOnSlugs) {
    if (!topics.has(s)) continue;
    const backed = d.evidenceIds.some(
      (id) => evidence.get(id)?.topicSlug === s,
    );
    if (!backed)
      errors.push(
        `buildsOnSlugs "${s}" has no evidence id from that topic in decision.evidenceIds`,
      );
  }
  if (d.why.length < 30) errors.push("decision.why is missing or too short");

  // ---- approach: name the one you change, or name a genuinely new one ----
  const focusApproaches = topics.get(d.focusSlug)?.depth.approaches ?? [];
  if (d.approachSlug) {
    if (!focusApproaches.some((a) => a.slug === d.approachSlug))
      errors.push(
        `decision.approachSlug "${d.approachSlug}" is not an approach of ${d.focusSlug} in the data (${focusApproaches.map((a) => a.slug).join(", ") || "none assessed"}); use null and decision.newApproach when adding a new approach`,
      );
  } else if (focusApproaches.length) {
    const fresh = d.newApproach ?? "";
    if (fresh.length < 10)
      errors.push(
        `decision.approachSlug is null: set decision.newApproach to the name of the approach you add. Existing approaches: ${focusApproaches.map((a) => `${a.slug} (${a.name})`).join(", ")}. If your move changes one of them, set approachSlug to it instead`,
      );
    else if (
      focusApproaches.some(
        (a) => nearDuplicate(a.name, fresh) || a.slug === fresh,
      )
    )
      errors.push(
        `decision.newApproach "${clip(fresh, 40)}" matches an existing approach; set decision.approachSlug to that approach instead`,
      );
  }

  // observed vs inferred vs missing, with evidence ids behind the observation
  const observedIds = (d.basis.observed.match(/\bE\d+\b/gi) ?? []).map((x) =>
    x.toUpperCase(),
  );
  if (d.basis.observed.length < 20 || !observedIds.length)
    errors.push(
      "decision.basis.observed must state what the data shows and cite at least one evidence id (E#)",
    );
  else if (observedIds.some((id) => !evidence.has(id)))
    errors.push(
      "decision.basis.observed cites an evidence id that is not in the data",
    );
  if (d.basis.inferred.length < 15)
    errors.push(
      "decision.basis.inferred must state what you conclude from the observation",
    );

  // ---- reuse: extend what exists instead of rebuilding it ----
  if (!d.reuses.length)
    errors.push(
      "decision.reuses must list the evidence ids of the existing code this move extends",
    );
  else {
    const badReuse = d.reuses.filter((id) => !evidence.has(id));
    if (badReuse.length)
      errors.push(`decision.reuses not in the data: ${badReuse.join(", ")}`);
    const notCited = d.reuses.filter(
      (id) => evidence.has(id) && !d.evidenceIds.includes(id),
    );
    if (notCited.length)
      errors.push(
        `decision.evidenceIds must include every reuses id (missing: ${notCited.join(", ")})`,
      );
    if (c.existingEvidenceId && !d.reuses.includes(c.existingEvidenceId))
      errors.push(
        `decision.reuses must include challenge.existingEvidenceId (${c.existingEvidenceId}): the task starts from code that already exists`,
      );
  }
  if (
    d.builds.reused.length < 15 ||
    d.builds.changes.length < 15 ||
    d.builds.newBehavior.length < 15
  )
    errors.push(
      "decision.builds needs reused, changes and newBehavior, each a real sentence (15+ chars)",
    );

  // ---- candidate comparison ----
  if (d.considered.length < 2)
    errors.push(
      "decision.considered must list at least two real alternatives you weighed",
    );
  for (const alt of d.considered) {
    const bad = alt.evidenceIds.filter((id) => !evidence.has(id));
    if (bad.length)
      errors.push(
        `alternative "${clip(alt.option, 40)}" cites evidence ids not in the data: ${bad.join(", ")}`,
      );
    if (alt.tradeoff.length < 20)
      errors.push(
        `alternative "${clip(alt.option, 40)}" needs a tradeoff (what it would give and cost)`,
      );
    if (alt.whyNot.length < 15)
      errors.push(`alternative "${clip(alt.option, 40)}" needs a real whyNot`);
    if (nearDuplicate(alt.option, t.objective))
      errors.push(
        `alternative "${clip(alt.option, 40)}" repeats the chosen move; list a genuinely different option`,
      );
  }
  if (
    d.considered.length >= 2 &&
    result.evidence.length > d.reuses.length &&
    !d.considered.some((alt) =>
      alt.evidenceIds.some((id) => evidence.has(id) && !d.reuses.includes(id)),
    )
  )
    errors.push(
      "at least one alternative must cite evidence that is NOT in decision.reuses: compare your move against a fix in different code, not a smaller version of itself",
    );
  const whyIds = (d.whyOverAlternatives.match(/\bE\d+\b/gi) ?? []).map((x) =>
    x.toUpperCase(),
  );
  if (d.whyOverAlternatives.length < 40 || !whyIds.length)
    errors.push(
      "decision.whyOverAlternatives must explain the choice over the alternatives and cite at least one evidence id (E#)",
    );
  else if (whyIds.some((id) => !evidence.has(id)))
    errors.push(
      "decision.whyOverAlternatives cites an evidence id that is not in the data",
    );
  if (SUPERLATIVE.test(d.whyOverAlternatives))
    errors.push(
      'decision.whyOverAlternatives must not claim the move is "best" or "optimal"; state what the evidence supports and what would change the choice',
    );

  // ---- history: only claim past work that exists in the graph ----
  const hasHistory =
    Boolean(result.previousMove) || result.completedMoves.length > 0;
  if (!hasHistory) {
    const claims = [
      d.why,
      d.whyOverAlternatives,
      d.basis.inferred,
      ...d.considered.flatMap((x) => [x.option, x.whyNot, x.tradeoff]),
    ];
    const hit = claims.find((s) => HISTORY_CLAIM.test(s));
    if (hit)
      errors.push(
        `the text refers to a previous/earlier/last move ("${clip(hit, 80)}") but history shows no earlier move or verified mission for this developer; remove that claim`,
      );
  }

  // ---- progression ----
  if (!d.progression.existing.length)
    errors.push(
      "decision.progression.existing must list at least one capability that already exists",
    );
  if (d.progression.change.length < 15 || d.progression.verified.length < 15)
    errors.push(
      "decision.progression needs change and verified, each a real sentence",
    );

  // ---- the problem must be visible in the code ----
  const code = codeBy.get(c.existingEvidenceId);
  if (!code)
    errors.push(
      `challenge.existingEvidenceId must be one of the ids that have code: ${result.code.map((x) => x.evidenceId).join(", ") || "none"}`,
    );
  else {
    const quote = norm(c.observedInCode.replace(/(…|\.\.\.)+\s*$/, ""));
    if (quote.length < 12 || !norm(code.excerpt).includes(quote))
      errors.push(
        `challenge.observedInCode must be a verbatim fragment (12-140 chars) copied from ${c.existingEvidenceId}'s code, with no ellipsis; "${clip(c.observedInCode, 60)}" does not appear in it`,
      );
    if (t.startPath.toLowerCase() !== code.path.toLowerCase())
      errors.push(
        `task.startPath must be exactly "${code.path}" (the path of ${c.existingEvidenceId})`,
      );
    if (!d.evidenceIds.includes(c.existingEvidenceId))
      errors.push(`decision.evidenceIds must include ${c.existingEvidenceId}`);
  }
  if (c.mechanism.length < 15) errors.push("challenge.mechanism is missing");
  if (c.limitation.length < 20)
    errors.push(
      "challenge.limitation must describe what the existing code does wrong or leaves unhandled",
    );
  if (c.failureScenario.length < 40)
    errors.push(
      "challenge.failureScenario must describe a concrete situation in which the code shown misbehaves, and what happens instead (40+ chars)",
    );
  if (ABSENT_OPTION.test(c.limitation) || ABSENT_OPTION.test(c.failureScenario))
    errors.push(
      'the limitation is "the code lacks an option". That is not a failure. Describe a situation where the current code gives a wrong result, drops an error, or ignores something it already has',
    );
  if (
    [d.why, c.limitation, c.failureScenario, t.objective].some((s) =>
      NICE_TO_HAVE.test(s),
    )
  )
    errors.push(
      "the reasoning rests on practice, learning, flexibility or extensibility. Choose a move justified by a failure visible in the code",
    );

  if (t.objective.length < 12)
    errors.push("task.objective is missing or too short");
  if (t.steps.length < 3) errors.push("task.steps needs 3 to 5 steps");
  if (t.steps.some((s) => s.length < 20))
    errors.push("every step must be specific (20+ chars)");
  if (t.doneWhen.length < 30 || !CHECKABLE.test(t.doneWhen))
    errors.push(
      "task.doneWhen must be an observable condition a test, command or review can check",
    );
  if ([t.objective, t.doneWhen, ...t.steps].some((s) => GENERIC.test(s)))
    errors.push(
      "the task uses a generic phrase; name the specific mechanism and behaviour instead",
    );

  const known = result.evidence
    .map((e) => e.path.toLowerCase())
    .filter(Boolean);
  const stray = (
    [t.objective, ...t.steps, t.doneWhen].join(" ").match(PATH_TOKEN) ?? []
  ).filter((tok) => {
    const x = tok.toLowerCase();
    return !known.some((k) => k.endsWith(x) || x.endsWith(k) || k.includes(x));
  });
  if (stray.length)
    errors.push(
      `files mentioned that are not in the evidence: ${stray.slice(0, 3).join(", ")}`,
    );

  if (
    result.evidence.some(
      (e) => e.technique && nearDuplicate(t.objective, e.technique),
    )
  )
    errors.push(
      "the objective repeats a technique the developer already demonstrated; propose new behaviour",
    );
  if (
    result.previousMove?.title &&
    nearDuplicate(t.objective, result.previousMove.title)
  )
    errors.push("the objective repeats the previously proposed move");
  const repeated = result.completedMoves.find(
    (m) => m.title && nearDuplicate(t.objective, m.title),
  );
  if (repeated)
    errors.push(
      `the objective repeats a mission the developer already verified ("${clip(repeated.title, 80)}")`,
    );

  return errors.length ? { ok: false, errors } : { ok: true, draft };
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
  const catalog = await listTopicCatalog(graph, 120);
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
        maxTokens: 300,
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
const MAX_ATTEMPTS = 4;

export async function planGoal(
  graph: Graph,
  llm: LlmClient | null,
  input: PlanGoalInput,
): Promise<GoalPlan> {
  const started = Date.now();
  const timeoutMs = input.timeoutMs ?? envInt("LLM_TIMEOUT_MS", 60_000);
  const maxRetries =
    input.maxRetries ?? Math.min(envInt("LLM_MAX_RETRIES", 2), 5);
  const budgetMs = input.budgetMs ?? envInt("LLM_TOTAL_BUDGET_MS", 120_000);
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
  const user = renderUser(briefForAgent(result));
  let previous = "";
  let errors: string[] = [];
  let draft: Draft | undefined;
  let repaired = false;
  let validationUsed = 0; // only rejected model output spends this
  let transportError: LlmError | null = null;
  t0 = Date.now();
  while (validationUsed < MAX_ATTEMPTS) {
    const prompt =
      validationUsed === 0
        ? user
        : `${user}\n\nYour previous reply was rejected for these reasons:\n${errors.map((e) => `- ${e}`).join("\n")}\n\nPrevious reply:\n${clip(previous, 1600)}\n\nReturn corrected JSON only. Keep the decision if it is sound; fix only what was rejected. If the rejection says the reasoning is not a visible failure, choose a different move.`;
    try {
      const r = await callLlmWithRetry(
        llm,
        { system: SYSTEM, user: prompt, maxTokens: 3000, json: true },
        { ...retryBase, label: `goal generation (repair ${validationUsed})` },
      );
      stats.calls += r.attempts;
      llmRetries += r.attempts - 1;
      previous = r.text;
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
    const checked = validate(extractJson(previous), result);
    if (checked.ok) {
      draft = checked.draft;
      repaired = validationUsed > 0;
      break;
    }
    errors = checked.errors;
    validationUsed += 1;
    notes.push(
      `validation attempt ${validationUsed} rejected: ${errors.join(" | ")}${errors[0]?.includes("not valid JSON") ? ` (raw: ${clip(previous.trim(), 200) || "empty"})` : ""}`,
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
