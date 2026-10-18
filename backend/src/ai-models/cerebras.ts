/* eslint-disable @typescript-eslint/no-explicit-any */
import "dotenv/config";
import OpenAI from "openai";


export const CEREBRAS_MODEL = process.env.CEREBRAS_MODEL || "gpt-oss-120b";

const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;

if (!CEREBRAS_API_KEY) {
  throw new Error("Missing CEREBRAS_API_KEY");
}

export const cerebras = new OpenAI({
  apiKey: CEREBRAS_API_KEY,
  baseURL: "https://api.cerebras.ai/v1",
});

/* ========================================================================== */
/* Rate limits (from the Cerebras "Limits" page of this organization)         */
/* ========================================================================== */

export interface ModelLimits {
  /** requests per minute */
  rpm: number;
  /** UNCACHED tokens per minute (stricter than the total-tokens limit) */
  tpm: number;
}

export const CEREBRAS_LIMITS: Record<string, ModelLimits> = {
  "qwen-3.8-27b": { rpm: 450, tpm: 150_000 },
  "gpt-oss-120b": { rpm: 5, tpm: 30_000 },
};

/** Unknown models get a conservative budget unless CEREBRAS_RPM / CEREBRAS_TPM say otherwise. */
const UNKNOWN_MODEL_LIMITS: ModelLimits = { rpm: 30, tpm: 30_000 };

const WINDOW_MS = 60_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const envPositive = (name: string): number | null => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function limitsFor(model: string): ModelLimits {
  const base = CEREBRAS_LIMITS[model] ?? UNKNOWN_MODEL_LIMITS;
  return {
    rpm: envPositive("CEREBRAS_RPM") ?? base.rpm,
    tpm: envPositive("CEREBRAS_TPM") ?? base.tpm,
  };
}

function safetyFactor(): number {
  const n = Number(process.env.CEREBRAS_RATE_SAFETY);
  return Number.isFinite(n) && n >= 0.3 && n <= 1 ? n : 0.8;
}

interface Ticket {
  at: number;
  tokens: number;
}

/**
 * Client-side limiter shared by EVERY caller of a model in this process (depth
 * agent, explainer, topic chat). It spends only a safe fraction of the real
 * limits, spaces requests out, reserves prompt + max completion tokens before
 * a call and settles to the real usage afterwards, so the API is never asked
 * for more than it will give. A 429 that still slips through (for example from
 * another process using the same key) pauses everyone and tightens the budget.
 */
export class RateGovernor {
  private events: Ticket[] = [];
  private blockedUntil = 0;
  private lastStart = 0;
  private tail: Promise<void> = Promise.resolve();
  private rawRpm: number;
  private rawTpm: number;
  private safety: number;
  private counters = { requests: 0, waitedMs: 0, penalties: 0 };

  constructor(
    readonly model: string,
    limits: ModelLimits,
    safety: number,
  ) {
    this.rawRpm = limits.rpm;
    this.rawTpm = limits.tpm;
    this.safety = safety;
  }

  private get rpmBudget(): number {
    return Math.max(1, Math.floor(this.rawRpm * this.safety));
  }
  private get tpmBudget(): number {
    return Math.max(1_000, Math.floor(this.rawTpm * this.safety));
  }

  setTokenBudget(tokensPerMinute: number): void {
    if (tokensPerMinute > 0) this.rawTpm = tokensPerMinute;
  }

  stats() {
    return {
      model: this.model,
      rpmBudget: this.rpmBudget,
      tpmBudget: this.tpmBudget,
      requests: this.counters.requests,
      waitedMs: this.counters.waitedMs,
      penalties: this.counters.penalties,
    };
  }

  /** FIFO mutex: callers are admitted one at a time, in order. */
  private lock(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const prev = this.tail;
    this.tail = prev.then(() => next);
    return prev.then(() => release);
  }

  private rpmWait(now: number): number {
    const budget = this.rpmBudget;
    if (this.events.length < budget) return 0;
    const idx = this.events.length - budget;
    return this.events[idx].at + WINDOW_MS - now + 20;
  }

  /** smooth spacing: 450 rpm is enforced as ~7 requests per second, not a burst */
  private gapWait(now: number): number {
    return this.lastStart + WINDOW_MS / this.rpmBudget - now;
  }

  private tokenWait(tokens: number, now: number): number {
    const budget = this.tpmBudget;
    let used = this.events.reduce((s, e) => s + e.tokens, 0);
    if (this.events.length === 0 || used + tokens <= budget) return 0;
    let i = 0;
    while (i < this.events.length && used + tokens > budget) {
      used -= this.events[i].tokens;
      i += 1;
    }
    return this.events[i - 1].at + WINDOW_MS - now + 20;
  }

  async acquire(tokens: number): Promise<Ticket> {
    const started = Date.now();
    const release = await this.lock();
    try {
      for (;;) {
        const now = Date.now();
        this.events = this.events.filter((e) => now - e.at < WINDOW_MS);
        const wait = Math.max(
          this.blockedUntil - now,
          this.rpmWait(now),
          this.gapWait(now),
          this.tokenWait(tokens, now),
        );
        if (wait <= 0) break;
        await sleep(Math.min(wait, WINDOW_MS));
      }
      const ticket: Ticket = { at: Date.now(), tokens };
      this.events.push(ticket);
      this.lastStart = ticket.at;
      this.counters.requests += 1;
      this.counters.waitedMs += ticket.at - started;
      return ticket;
    } finally {
      release();
    }
  }

  /** replace the reservation by what the call really used */
  settle(ticket: Ticket, actualTokens: number): void {
    ticket.tokens = Math.max(0, Math.round(actualTokens));
  }

  /** the API said "slow down": stop everyone and be more careful afterwards */
  penalize(ms: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + ms);
    this.safety = Math.max(0.4, this.safety * 0.9);
    this.counters.penalties += 1;
  }
}

const governors = new Map<string, RateGovernor>();

export function governorFor(model: string): RateGovernor {
  let g = governors.get(model);
  if (!g) {
    g = new RateGovernor(model, limitsFor(model), safetyFactor());
    governors.set(model, g);
  }
  return g;
}

/* ========================================================================== */
/* One chat call: governed, retried, and tolerant of unsupported parameters   */
/* ========================================================================== */

export class CerebrasRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface CerebrasChatOptions {
  model?: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
  timeoutMs?: number;
  jsonMode?: boolean;
  /** true: let a reasoning model think (costs tokens and time) */
  thinking?: boolean;
  /** retries for network errors / 5xx */
  retries?: number;
  /** retries after a 429 (waits for retry-after, never hammers) */
  rateRetries?: number;
  /** retries when the model returns an empty answer (default 2) */
  emptyRetries?: number;
  label?: string;
  /** abort signal of the caller (per-attempt timeouts still apply) */
  signal?: AbortSignal;
  log?: (message: string, detail?: Record<string, unknown>) => void;
}

export interface CerebrasChatResult {
  text: string;
  finish: string | null | undefined;
  hasReasoning: boolean;
  usage: { prompt: number; cached: number; completion: number } | null;
}

function retryAfterMs(err: any): number | null {
  const h = err?.headers;
  const raw = h?.get?.("retry-after") ?? h?.["retry-after"];
  const secs = Number(raw);
  return Number.isFinite(secs) && secs > 0 ? Math.ceil(secs * 1000) : null;
}

const isGptOss = (model: string) => /gpt-oss/i.test(model);

/** parameters a given model may reject; the ones it rejects are dropped once and remembered */
const droppedParams = new Map<string, Set<string>>();
function droppedFor(model: string): Set<string> {
  let s = droppedParams.get(model);
  if (!s) {
    s = new Set();
    droppedParams.set(model, s);
  }
  return s;
}

function optionalParams(
  model: string,
  jsonMode: boolean,
  thinking: boolean,
): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (jsonMode) p.response_format = { type: "json_object" };
  if (isGptOss(model)) p.reasoning_effort = thinking ? "medium" : "low";
  else if (!thinking) p.chat_template_kwargs = { enable_thinking: false };
  try {
    const extra = process.env.CEREBRAS_EXTRA_PARAMS;
    if (extra) Object.assign(p, JSON.parse(extra));
  } catch {
    /* ignore malformed CEREBRAS_EXTRA_PARAMS */
  }
  return p;
}

function offendingParams(err: any, params: Record<string, unknown>): string[] {
  const text =
    `${String(err?.message ?? "")} ${JSON.stringify(err?.error ?? {})}`.toLowerCase();
  return Object.keys(params).filter(
    (k) =>
      text.includes(k.toLowerCase()) ||
      (k === "chat_template_kwargs" && text.includes("enable_thinking")),
  );
}

export async function cerebrasChat(
  opts: CerebrasChatOptions,
): Promise<CerebrasChatResult> {
  const model = opts.model ?? CEREBRAS_MODEL;
  const gov = governorFor(model);
  const label = opts.label ?? "call";
  const log =
    opts.log ??
    ((message: string, detail?: Record<string, unknown>) =>
      detail
        ? console.log(`[cerebras] ${message}`, detail)
        : console.log(`[cerebras] ${message}`));
  const timeout = opts.timeoutMs ?? 45_000;
  const maxRetries = opts.retries ?? 3;
  const maxRateRetries = opts.rateRetries ?? 8;
  const maxEmptyRetries = opts.emptyRetries ?? 2;
  const jsonMode = opts.jsonMode ?? true;
  const thinking = opts.thinking ?? false;
  const dropped = droppedFor(model);
  let transient = 0;
  let rateHits = 0;
  let emptyRetries = 0;

  for (;;) {
    // after one empty answer, stop forcing JSON mode: it is a common cause of empty replies
    const optional = optionalParams(
      model,
      jsonMode && emptyRetries < 2,
      thinking,
    );
    for (const k of dropped) delete optional[k];

    // a reasoning model that cannot be told to stay short needs room to think
    const thinkingStuck =
      !isGptOss(model) && !thinking && dropped.has("chat_template_kwargs");
    const headroom = isGptOss(model) ? 800 : thinkingStuck ? 6_000 : 0;
    const maxOut = opts.maxTokens + headroom + emptyRetries * 4_000;
    const estimate =
      Math.ceil((opts.system.length + opts.user.length) / 3.2) + maxOut;

    const ticket = await gov.acquire(estimate);
    try {
      const res: any = await cerebras.chat.completions.create(
        {
          model,
          temperature: opts.temperature ?? 0.1,
          max_completion_tokens: maxOut,
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
          ...optional,
        } as any,
        { timeout, maxRetries: 0, signal: opts.signal },
      );

      const u = res?.usage;
      const prompt = Number(u?.prompt_tokens ?? 0);
      const cached = Number(u?.prompt_tokens_details?.cached_tokens ?? 0);
      const completion = Number(u?.completion_tokens ?? 0);
      gov.settle(
        ticket,
        u ? Math.max(0, prompt - cached) + completion : ticket.tokens,
      );

      const choice = res?.choices?.[0];
      const message = (choice?.message ?? {}) as Record<string, any>;
      const text = String(message.content ?? "");
      const hasReasoning = Boolean(
        message.reasoning_content ?? message.reasoning,
      );

      // empty answer: usually the model spent the whole budget thinking. Try again with more room.
      if (!text.trim() && emptyRetries < maxEmptyRetries) {
        emptyRetries += 1;
        log(
          `${label}: empty answer (finish=${choice?.finish_reason}, reasoning=${hasReasoning}, completion_tokens=${completion}) - retry ${emptyRetries} with a bigger budget`,
        );
        continue;
      }

      return {
        text,
        finish: choice?.finish_reason,
        hasReasoning,
        usage: u ? { prompt, cached, completion } : null,
      };
    } catch (err: any) {
      const status: number | undefined = err?.status;
      const message = String(err?.message ?? err).slice(0, 300);

      // 1) the model rejects an optional parameter: drop ONLY the one named in the error
      if ((status === 400 || status === 422) && Object.keys(optional).length) {
        gov.settle(ticket, 0);
        const bad = offendingParams(err, optional);
        if (bad.length) {
          for (const k of bad) dropped.add(k);
          log(
            `${label}: ${model} rejected ${bad.join(", ")} - retrying without`,
            { message: message.slice(0, 160) },
          );
          continue;
        }
        // no parameter named: it is a real 400 (prompt too long, bad limit...). Fall through and throw.
      }

      // 2) rate limited: pause EVERY caller, then try again
      if (status === 429) {
        rateHits += 1;
        if (rateHits > maxRateRetries) {
          throw new CerebrasRequestError(
            `LLM 429: still rate limited after ${rateHits - 1} waits (${message})`,
            429,
          );
        }
        const wait = retryAfterMs(err) ?? Math.min(30_000, 3_000 * rateHits);
        gov.penalize(wait);
        log(`${label}: 429 - all calls paused ${wait}ms, budget tightened`, {
          attempt: rateHits,
          governor: gov.stats(),
        });
        continue;
      }

      // 3) network errors / 5xx: short exponential backoff
      const retryable = status === undefined || status >= 500;
      if (!retryable || transient >= maxRetries) {
        throw new CerebrasRequestError(
          `LLM ${status ?? "network"}: ${message}`,
          status,
        );
      }
      const delay =
        Math.min(8_000, 1_000 * 2 ** transient) +
        Math.floor(Math.random() * 500);
      transient += 1;
      log(`${label}: ${status ?? "network"} - retry in ${delay}ms`, {
        attempt: transient,
        reason: message.slice(0, 120),
      });
      await sleep(delay);
    }
  }
}

/* ========================================================================== */
/* Chat helper: what the topic chat agent needs from a model                  */
/* ========================================================================== */

export interface ChatLlm {
  model: string;
  completeJson(args: {
    stage: "discover" | "synthesize";
    system: string;
    user: string;
    maxTokens: number;
    temperature?: number;
  }): Promise<unknown>;
}

const CHAT_TIMEOUT_MS = Number(process.env.TOPIC_CHAT_TIMEOUT_MS) || 10_000;

function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1));
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

export function createCerebrasChatLlm(): ChatLlm {
  return {
    model: CEREBRAS_MODEL,
    async completeJson({ system, user, maxTokens, temperature }) {
      const r = await cerebrasChat({
        model: CEREBRAS_MODEL,
        system,
        user,
        maxTokens,
        temperature: temperature ?? 0.2,
        timeoutMs: CHAT_TIMEOUT_MS,
        jsonMode: true,
        retries: 1,
        rateRetries: 2,
        label: "chat",
      });
      const parsed = parseJson(r.text);
      if (!parsed) throw new Error("model returned no parseable JSON");
      return parsed;
    },
  };
}

/* ========================================================================== */
/* Adapter for the goal / mission agents: LlmClient.complete() -> string      */
/* ========================================================================== */

/**
 * Same shape as the LlmClient used by the mission and evaluation agents
 * (complete({system, user, maxTokens, json, signal}) -> string), but every call
 * goes through the shared rate governor and thinking is switched off, so a
 * reasoning model cannot spend the whole token budget and return an empty answer.
 *
 * An empty answer after all retries now throws with the real reason
 * (finish_reason and whether the model produced reasoning), instead of
 * returning "" and hiding the cause.
 */
export function createCerebrasLlmClient(model: string = CEREBRAS_MODEL) {
  return {
    async complete(args: {
      system: string;
      user: string;
      maxTokens?: number;
      json?: boolean;
      signal?: AbortSignal;
    }): Promise<string> {
      const r = await cerebrasChat({
        model,
        system: args.system,
        user: args.user,
        maxTokens: args.maxTokens ?? 2000,
        jsonMode: args.json === true,
        timeoutMs: Number(process.env.LLM_TIMEOUT_MS) || 60_000,
        signal: args.signal,
        label: "mission",
      });
      // also strips a <think> block that was never closed (output cut off while thinking)
      const text = r.text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, "").trim();
      if (!text)
        throw new Error(
          `empty completion (finish=${r.finish}, reasoning=${r.hasReasoning})`,
        );
      return text;
    },
  };
}
