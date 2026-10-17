import type { Graph } from "../db/falkordb.js";
import { cerebras, CEREBRAS_MODEL } from "../ai-models/cerebras.js";
import {
  DEPTH_BANDS,
  DEPTH_RANK,
  asAuthenticity,
  asConfidence,
  asDepthLevel,
  asTopicDomain,
  ensureDepthSchema,
  findTopicsByText,
  gatherTopicEvidence,
  isSpecificRationale,
  levelForScore,
  listTopicCatalog,
  probeAtlas,
  probeKeywords,
  readDeveloperTopicProfile,
  readEvidenceAtlas,
  readStoredTopicSpec,
  readTopicDepthDetail,
  refreshTopicGraphMetrics,
  slugify,
  storeDepthAssessments,
  storeDepthProfileSummary,
  writeTopicRelations,
  type ApproachRecord,
  type ApproachSpec,
  type Authenticity,
  type Confidence,
  type DepthAssessmentRecord,
  type DepthLevel,
  type DepthProfileSummary,
  type EvidenceAtlas,
  type EvidenceRef,
  type ImplementationNote,
  type ProgressFn,
  type RelationDetail,
  type StoreDepthResult,
  type TopicCatalogEntry,
  type TopicDomain,
  type TopicEvidence,
  type TopicFootprint,
  type TopicGraphMetrics,
  type TopicRelationInput,
  type TopicSpec,
} from "../graph/depth-analyzer-graph.js";

type Row = Record<string, any>;

const LOG_PREFIX = "[depth-agent]";
function log(message: string, detail?: Row): void {
  if (detail !== undefined) console.log(`${LOG_PREFIX} ${message}`, detail);
  else console.log(`${LOG_PREFIX} ${message}`);
}

const asStr = (v: unknown, max = 400): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const asNum = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const asBool = (v: unknown): boolean => v === true || v === "true";
const asList = (v: unknown, max = 10, itemMax = 200): string[] =>
  Array.isArray(v)
    ? v
        .map((x) => asStr(x, itemMax))
        .filter(Boolean)
        .slice(0, max)
    : [];
const asObjects = (v: unknown): Row[] =>
  Array.isArray(v)
    ? v.filter((x) => x && typeof x === "object" && !Array.isArray(x))
    : [];
const uniq = <T>(items: T[]): T[] => [...new Set(items)];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const envNum = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 && process.env[name] !== undefined
    ? n
    : fallback;
};

export interface DepthLlmRequest {
  stage: "discover" | "judge" | "synthesize" | "explain";
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

export interface DepthLlm {
  readonly model: string;
  completeJson(request: DepthLlmRequest): Promise<unknown>;
}

export class LlmTransportError extends Error {}

export class LlmOutputError extends Error {
  constructor(
    message: string,
    readonly empty: boolean,
    readonly truncated: boolean,
  ) {
    super(message);
  }
}

function repairJson(s: string): string {
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  let safe = -1;
  let safeStack: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === "}" || c === "]") {
      stack.pop();
      safe = i + 1;
      safeStack = [...stack];
      if (stack.length === 0) break;
    }
  }
  if (safe === -1) throw new Error("unrepairable JSON");
  const body = s
    .slice(0, safe)
    .replace(/,\s*$/, "")
    .replace(/,(\s*[}\]])/g, "$1");
  return body + safeStack.reverse().join("");
}

export function extractJson(text: string): unknown {
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const lastClose = cleaned.toLowerCase().lastIndexOf("</think>");
  if (lastClose !== -1) cleaned = cleaned.slice(lastClose + "</think>".length);
  cleaned = cleaned
    .replace(/<think>[\s\S]*$/i, "")
    .replace(/```(?:json)?/gi, "")
    .trim();

  const start = cleaned.indexOf("{");
  if (start === -1) throw new Error("no JSON object in LLM output");
  const end = cleaned.lastIndexOf("}");
  if (end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      // fall through to repair
    }
  }
  return JSON.parse(repairJson(cleaned.slice(start)));
}

function retryAfterMs(err: any): number | null {
  const h = err?.headers;
  const raw = h?.get?.("retry-after") ?? h?.["retry-after"];
  const secs = Number(raw);
  return Number.isFinite(secs) && secs > 0 ? secs * 1000 : null;
}

type LlmFactoryOptions = {
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  jsonMode?: boolean;
  thinking?: boolean;
  systemPrefix?: string;
};

function createOpenAiLlm(
  client: typeof cerebras,
  defaultModel: string,
  options: {
    model?: string;
    timeoutMs?: number;
    maxRetries?: number;
    jsonMode?: boolean;
    thinking?: boolean;
    systemPrefix?: string;
  } = {},
): DepthLlm {
  const model = options.model ?? process.env.DEPTH_LLM_MODEL ?? defaultModel;
  const timeoutMs = options.timeoutMs ?? envNum("DEPTH_LLM_TIMEOUT_MS", 90_000);
  const maxRetries = options.maxRetries ?? envNum("DEPTH_LLM_RETRIES", 3);
  const jsonMode =
    options.jsonMode ?? process.env.DEPTH_LLM_JSON_MODE === "true";
  const thinking =
    options.thinking ?? process.env.DEPTH_LLM_THINKING === "true";
  const systemPrefix =
    options.systemPrefix ?? process.env.DEPTH_LLM_SYSTEM_PREFIX ?? "";

  return {
    model,
    async completeJson(request) {
      const startedAt = Date.now();
      let text = "";
      let finish: string | null | undefined;
      let hasReasoning = false;

      for (let attempt = 0; ; attempt++) {
        try {
          const body: Row = {
            model,
            temperature: request.temperature ?? 0.1,
            max_tokens: request.maxTokens ?? 4000,
            ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
            ...(thinking
              ? {}
              : { chat_template_kwargs: { enable_thinking: false } }),
            messages: [
              {
                role: "system",
                content: systemPrefix
                  ? `${systemPrefix}\n${request.system}`
                  : request.system,
              },
              { role: "user", content: request.user },
            ],
          };
          const res = await client.chat.completions.create(body as any, {
            timeout: timeoutMs,
            maxRetries: 0,
          });
          const choice = res.choices?.[0];
          const message = (choice?.message ?? {}) as Row;
          text = String(message.content ?? "");
          finish = choice?.finish_reason;
          hasReasoning = Boolean(
            message.reasoning_content ?? message.reasoning,
          );
          break;
        } catch (err: any) {
          const status: number | undefined = err?.status;
          const retryable =
            status === undefined || status === 429 || status >= 500;
          if (!retryable || attempt >= maxRetries) {
            throw new LlmTransportError(
              `LLM ${status ?? "network"}: ${String(err?.message ?? err).slice(0, 300)}`,
            );
          }
          const delay =
            retryAfterMs(err) ??
            Math.min(30_000, 3_000 * 2 ** attempt) +
              Math.floor(Math.random() * 1_000);
          log(`${request.stage} ${status ?? "network"} - retry in ${delay}ms`, {
            attempt: attempt + 1,
            reason: String(err?.message ?? err).slice(0, 120),
          });
          await sleep(delay);
        }
      }

      const ms = Date.now() - startedAt;
      try {
        const out = extractJson(text);
        log(`${request.stage} ok`, { ms, chars: text.length, finish });
        return out;
      } catch {
        const empty = text.trim().length === 0;
        const truncated = finish === "length";
        log(`${request.stage} unusable output`, {
          ms,
          finish,
          chars: text.length,
          hasReasoning,
          head: text.slice(0, 160),
        });
        throw new LlmOutputError(
          empty
            ? hasReasoning
              ? "model returned only reasoning and no answer (thinking is eating the token budget)"
              : "model returned an empty answer"
            : truncated
              ? "answer was cut off by max_tokens and held no JSON"
              : "no JSON object in LLM output",
          empty,
          truncated,
        );
      }
    },
  };
}

export function createCerebrasLlm(options: LlmFactoryOptions = {}): DepthLlm {
  return createOpenAiLlm(cerebras, CEREBRAS_MODEL, options);
}

export function createDepthLlmFromEnv(): DepthLlm {
  return createCerebrasLlm();
}

class LlmGateway {
  calls = 0;
  failures: string[] = [];
  private active = 0;
  private waiters: Array<() => void> = [];
  private window: Array<{ at: number; tokens: number }> = [];
  private consecutiveFailures = 0;
  private announcedOpen = false;

  constructor(
    private readonly llm: DepthLlm,
    private readonly concurrency = 4,
    private readonly tpm = 0,
    private readonly breaker = 3,
  ) {}

  get model(): string {
    return this.llm.model;
  }

  get open(): boolean {
    return this.breaker > 0 && this.consecutiveFailures >= this.breaker;
  }

  private async acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active--;
  }

  private async reserve(tokens: number): Promise<void> {
    if (!this.tpm) return;
    while (true) {
      const now = Date.now();
      this.window = this.window.filter((w) => now - w.at < 60_000);
      const used = this.window.reduce((s, w) => s + w.tokens, 0);
      if (this.window.length === 0 || used + tokens <= this.tpm) {
        this.window.push({ at: now, tokens });
        return;
      }
      await sleep(Math.max(250, this.window[0].at + 60_000 - now + 50));
    }
  }

  private noteFailure(stage: string, message: string): void {
    this.consecutiveFailures += 1;
    if (this.open && !this.announcedOpen) {
      this.announcedOpen = true;
      log(
        `LLM circuit OPEN after ${this.consecutiveFailures} failures in a row: remaining steps use graph baselines only`,
        { lastStage: stage, lastError: message },
      );
    }
  }

  async json(request: DepthLlmRequest): Promise<Row | null> {
    if (this.open) return null;

    await this.acquire();
    try {
      let current = request;
      for (let attempt = 1; attempt <= 2; attempt++) {
        if (this.open) return null;

        const estimate = Math.ceil(
          (current.system.length + current.user.length) / 3.5 +
            (current.maxTokens ?? 4000) * 0.5,
        );
        await this.reserve(estimate);
        this.calls += 1;

        try {
          const out = await this.llm.completeJson(current);
          if (out && typeof out === "object" && !Array.isArray(out)) {
            this.consecutiveFailures = 0;
            return out as Row;
          }
          this.noteFailure(request.stage, "JSON was not an object");
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          log(`${request.stage} attempt ${attempt} failed`, { message });
          this.noteFailure(request.stage, message);

          const reAsk =
            error instanceof LlmOutputError &&
            (!error.empty || error.truncated) &&
            attempt === 1;
          if (!reAsk) {
            this.failures.push(`${request.stage}: ${message}`);
            return null;
          }
          current = {
            ...request,
            temperature: 0,
            maxTokens:
              error instanceof LlmOutputError && error.truncated
                ? Math.ceil((request.maxTokens ?? 4000) * 1.6)
                : request.maxTokens,
            user: `${request.user}\n\nYour previous answer was not valid JSON. Return ONLY one compact, complete JSON object, no prose, no code fences.`,
          };
          continue;
        }

        if (attempt === 2) break;
        current = {
          ...request,
          temperature: 0,
          user: `${request.user}\n\nReturn ONLY one compact JSON object, no prose, no code fences.`,
        };
      }
      this.failures.push(`${request.stage}: no usable JSON`);
      return null;
    } finally {
      this.release();
    }
  }
}

function makeGateway(options: DepthAnalyzerOptions): LlmGateway {
  return new LlmGateway(
    options.llm,
    Math.max(1, options.llmConcurrency ?? envNum("DEPTH_LLM_CONCURRENCY", 4)),
    options.llmTpm ?? envNum("DEPTH_LLM_TPM", 0),
    options.llmBreaker ?? envNum("DEPTH_LLM_BREAKER", 3),
  );
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const loop = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, loop),
  );
  return results;
}

type InferableDomain = Exclude<TopicDomain, "general">;

const DOMAIN_ORDER: InferableDomain[] = [
  "mobile",
  "ai_ml",
  "database",
  "infrastructure",
  "frontend",
  "backend",
];

const DOMAIN_TERMS: Record<InferableDomain, string[]> = {
  mobile: [
    "reactnative",
    "expo",
    "flutter",
    "swift",
    "swiftui",
    "kotlin",
    "android",
    "ios",
    "xcode",
    "capacitor",
    "ionic",
    "nativewind",
  ],
  ai_ml: [
    "openai",
    "anthropic",
    "langchain",
    "llamaindex",
    "llm",
    "llms",
    "embedding",
    "embeddings",
    "rag",
    "tensorflow",
    "pytorch",
    "torch",
    "transformers",
    "huggingface",
    "sklearn",
    "scikit",
    "nvidia",
    "nemotron",
    "prompt",
    "prompts",
    "agent",
    "agents",
    "inference",
    "vector",
    "onnx",
    "mlflow",
    "ollama",
    "gemini",
    "completion",
    "completions",
  ],
  database: [
    "postgres",
    "postgresql",
    "pg",
    "mysql",
    "mongodb",
    "mongoose",
    "sqlite",
    "redis",
    "falkordb",
    "neo4j",
    "prisma",
    "drizzle",
    "typeorm",
    "sequelize",
    "knex",
    "sql",
    "cypher",
    "orm",
    "migration",
    "migrations",
    "ddl",
    "dynamodb",
    "supabase",
    "cassandra",
  ],
  infrastructure: [
    "docker",
    "dockerfile",
    "kubernetes",
    "k8s",
    "terraform",
    "pulumi",
    "ansible",
    "nginx",
    "helm",
    "cicd",
    "deploy",
    "deployment",
    "vercel",
    "cloudflare",
    "aws",
    "gcp",
    "azure",
    "s3",
    "lambda",
    "cloudformation",
    "devops",
    "monitoring",
    "observability",
    "prometheus",
    "grafana",
    "opentelemetry",
  ],
  frontend: [
    "react",
    "next",
    "nextjs",
    "vue",
    "nuxt",
    "svelte",
    "angular",
    "tailwind",
    "tailwindcss",
    "css",
    "html",
    "dom",
    "jsx",
    "redux",
    "zustand",
    "vite",
    "webpack",
    "framer",
    "three",
    "threejs",
    "canvas",
    "webgl",
    "a11y",
    "accessibility",
    "radix",
    "shadcn",
    "storybook",
    "ui",
  ],
  backend: [
    "express",
    "fastify",
    "hono",
    "koa",
    "nestjs",
    "trpc",
    "graphql",
    "rest",
    "api",
    "jwt",
    "jsonwebtoken",
    "bcrypt",
    "oauth",
    "passport",
    "middleware",
    "server",
    "zod",
    "cors",
    "websocket",
    "ws",
    "socketio",
    "queue",
    "bullmq",
    "cron",
    "webhook",
    "authentication",
    "auth",
    "session",
    "route",
    "routes",
  ],
};

const DOMAIN_MIN_SCORE = 2;

function tokenSet(texts: string[]): Set<string> {
  const out = new Set<string>();
  for (const text of texts) {
    const tokens = text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2);
    for (const t of tokens) out.add(t);
    for (let i = 0; i + 1 < tokens.length; i++)
      out.add(tokens[i] + tokens[i + 1]);
    const joined = text.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (joined.length >= 2 && joined.length <= 40) out.add(joined);
  }
  return out;
}

export interface DomainEvidence {
  name?: string;
  description?: string;
  packages?: string[];
  signals?: string[];
  keywords?: string[];
  capabilityNames?: string[];
  technologies?: string[];
}

export function inferDomain(e: DomainEvidence): TopicDomain {
  const groups: Array<{ tokens: Set<string>; weight: number }> = [
    { tokens: tokenSet(e.packages ?? []), weight: 3 },
    { tokens: tokenSet(e.signals ?? []), weight: 2 },
    { tokens: tokenSet(e.capabilityNames ?? []), weight: 2 },
    { tokens: tokenSet(e.technologies ?? []), weight: 2 },
    { tokens: tokenSet(e.keywords ?? []), weight: 1 },
    {
      tokens: tokenSet([e.name ?? "", e.description ?? ""].filter(Boolean)),
      weight: 1,
    },
  ];

  let best: TopicDomain = "general";
  let bestScore = 0;
  for (const domain of DOMAIN_ORDER) {
    const terms = DOMAIN_TERMS[domain];
    let score = 0;
    for (const g of groups) {
      for (const term of terms) if (g.tokens.has(term)) score += g.weight;
    }
    if (score > bestScore) {
      best = domain;
      bestScore = score;
    }
  }
  return bestScore >= DOMAIN_MIN_SCORE ? best : "general";
}

const DISCOVER_SYSTEM = `You are the topic cartographer of Pathway, a developer-memory system.
You receive an EVIDENCE ATLAS built from ONE developer's real GitHub code: packages they import, code-signal counters, domain vocabulary taken from their own symbol and file names, groups of atoms that are used together, capabilities/experiences already detected, skills and repository descriptions.

Decide which TOPICS this developer has actually touched and, inside each topic, which distinct APPROACHES they used. Discovery only: do NOT judge quality here.

RULES
1. A topic is an engineering concept a person can know with depth, in ANY domain (caching, authentication, state management, real-time sync, 3D rendering, CI/CD, data modeling, accessibility, LLM tool calling, testing strategy, payments, search, ...). Do not limit yourself to backend or frontend.
2. A tool is NOT a topic. Redis, React, Docker are technologies that appear INSIDE topics as approaches. A tool becomes a topic only if the code shows a concept around it (for example "graph data modeling" for FalkorDB).
3. An approach is a distinct way the topic was done: caching -> in-memory LRU, Redis, HTTP/CDN caching; authentication -> JWT sessions, OAuth provider login, password hashing. Give 1 to 4 approaches. If the atlas supports only one, return only one. Never invent an approach no atom supports.
4. GROUNDING. Every entry in "packages", "signals" and "capability_ids" MUST be copied exactly from the atlas lists. "keywords" MUST come from the atlas "vocabulary" list or be a word of a package, signal or capability name in the atlas: lowercase single words. Keywords that are not in the atlas are discarded. A topic or approach without any supporting atom is dropped.
5. DOMAIN. "domain" MUST be exactly one of: frontend, backend, database, infrastructure, ai_ml, mobile, general. Use "general" only when the evidence does not point to one of the others.
6. REUSE. If a topic in existingTopicCatalog is the same concept, reuse its slug exactly and set "reuses_existing" to true. Otherwise invent a stable lowercase snake_case slug.
7. COVERAGE. A developer with many packages, signals and capabilities has MANY topics. Return AT LEAST "minTopics" topics (never more than "topicLimit") whenever the atlas supports them. Never collapse the whole atlas into one topic. Every capability in the atlas should be covered by some topic through "capability_ids". If "alreadyFound" is non-empty, return ONLY additional, distinct topics that are not in it. Order topics by how much evidence supports them.
8. RELATIONS. "builds_on" (up to 3): foundations this topic stands on. "related" (up to 4): sibling topics that are worked on together. EVERY entry is an object {"slug","reason","strength"}. "reason" is ONE concrete sentence of at least 8 words saying WHY, naming the real mechanism (for example "the store holds server responses that the caching layer invalidates after a mutation"). Never write "X builds on Y" as a reason. "strength" is "required" or "helpful". Use slugs from your own answer, "alreadyFound" or the catalog only. Connect every topic to at least one other topic when a real link exists. "builds_on" is ONLY for a real prerequisite (you cannot do A well without B). Topics that merely appear together belong in "related", never in "builds_on".
9. Signals such as async_await or error_handling are generic and fire in almost every file: do not use them as the only support of a topic.
10. OUTPUT SIZE: be compact. Descriptions are one short sentence. Max 8 keywords per topic and 6 per approach. Output minified JSON on one line, no indentation, no commentary. Do not think out loud: answer with the JSON object only.

Return ONLY this JSON:
{"topics":[{"slug":"","name":"","domain":"frontend|backend|database|infrastructure|ai_ml|mobile|general","description":"one sentence","aliases":[],"reuses_existing":false,"keywords":[],"packages":[],"signals":[],"capability_ids":[],"builds_on":[{"slug":"","reason":"","strength":"required|helpful"}],"related":[{"slug":"","reason":""}],"approaches":[{"slug":"","name":"","description":"one sentence","packages":[],"signals":[],"keywords":[]}]}]}`;

const PROMPT_CAPABILITY_LIMIT = 40;

function atlasForPrompt(
  atlas: EvidenceAtlas,
  catalog: TopicCatalogEntry[],
  maxTopics: number,
  hints: {
    minTopics: number;
    alreadyFound: Array<{ slug: string; name: string }>;
  },
): string {
  return JSON.stringify({
    topicLimit: maxTopics,
    minTopics: hints.minTopics,
    alreadyFound: hints.alreadyFound,
    developer: atlas.totals,
    existingTopicCatalog: catalog
      .slice(0, 80)
      .map((c) => ({ slug: c.slug, name: c.name, domain: c.domain })),
    packages: atlas.packages.slice(0, 60).map((p) => ({
      name: p.name,
      files: p.files,
      commits: p.commits,
      repos: p.repos,
    })),
    signals: atlas.signals
      .slice(0, 24)
      .map((s) => ({ name: s.name, files: s.files, commits: s.commits })),
    vocabulary: atlas.vocabulary
      .slice(0, 40)
      .map((v) => `${v.term}:${v.files}`),
    usedTogether: atlas.clusters
      .slice(0, 10)
      .map((c) => ({ id: c.id, members: c.members, commits: c.commits })),
    capabilities: atlas.capabilities
      .slice(0, PROMPT_CAPABILITY_LIMIT)
      .map((c) => ({
        id: c.id,
        name: c.name,
        level: c.level,
        evidence: c.evidence,
      })),
    experiences: atlas.experiences.slice(0, 18).map((e) => ({
      technique: e.technique,
      capability_id: e.capabilityId,
      depth: e.depth,
      evidence: e.evidence,
      technologies: e.technologies,
    })),
    skills: atlas.skills
      .slice(0, 15)
      .map((s) => ({ name: s.name, level: s.level })),
    repositories: atlas.repositories.slice(0, 10).map((r) => ({
      name: r.name,
      description: asStr(r.description, 120),
      language: r.language,
      topics: r.topics,
    })),
  });
}

const cleanKeywords = (list: string[], max = 12): string[] =>
  uniq(
    list
      .map((k) => k.toLowerCase().replace(/[^a-z0-9]+/g, ""))
      .filter((k) => k.length >= 3),
  ).slice(0, max);

function buildEvidenceVocabulary(atlas: EvidenceAtlas): Set<string> {
  const vocab = new Set<string>();
  const add = (text: string) => {
    const lower = text.toLowerCase();
    for (const t of lower.split(/[^a-z0-9]+/)) {
      if (t.length >= 3) vocab.add(t);
    }
    const joined = lower.replace(/[^a-z0-9]+/g, "");
    if (joined.length >= 3 && joined.length <= 40) vocab.add(joined);
  };
  for (const v of atlas.vocabulary) add(v.term);
  for (const p of atlas.packages) add(p.name);
  for (const s of atlas.signals) add(s.name);
  for (const c of atlas.capabilities) {
    add(c.id);
    add(c.name);
  }
  for (const e of atlas.experiences) {
    add(e.technique);
    for (const t of e.technologies) add(t);
  }
  for (const s of atlas.skills) add(s.name);
  for (const r of atlas.repositories) {
    for (const t of r.topics) add(t);
  }
  return vocab;
}

function keywordGrounded(keyword: string, vocab: Set<string>): boolean {
  if (vocab.has(keyword)) return true;
  if (keyword.length < 5) return false;
  for (const v of vocab) {
    if (v.length >= 5 && (v.startsWith(keyword) || keyword.startsWith(v))) {
      return true;
    }
  }
  return false;
}

export interface CoverageReport {
  atlasCapabilities: number;
  mappedCapabilities: number;
  unmappedCapabilityIds: string[];
  topicsWithoutCapability: string[];
  topicCount: number;
  topicLimit: number;
  topicLimitReached: boolean;
  complete: boolean;
  notes: string[];
}

export interface SanitizeResult {
  topics: TopicSpec[];
  dropped: Array<{ slug: string; reason: string }>;
  rejectedCapabilityIds: Array<{ topic: string; capabilityIds: string[] }>;
  rejectedKeywords: Array<{ topic: string; keywords: string[] }>;
  domainCorrections: Array<{
    slug: string;
    proposed: string;
    assigned: TopicDomain;
    inferred: boolean;
  }>;
}

export interface DiscoveryResult extends SanitizeResult {
  coverage: CoverageReport;
}

export function computeCoverage(
  atlas: EvidenceAtlas,
  specs: TopicSpec[],
  maxTopics: number,
  discovered?: TopicSpec[],
): CoverageReport {
  const atlasIds = uniq(atlas.capabilities.map((c) => c.id).filter(Boolean));
  const atlasSet = new Set(atlasIds);
  const mapped = new Set<string>();
  for (const s of specs) {
    for (const id of s.capabilityIds) if (atlasSet.has(id)) mapped.add(id);
  }
  const unmapped = atlasIds.filter((id) => !mapped.has(id));
  const topicsWithoutCapability = specs
    .filter((s) => !s.capabilityIds.some((id) => atlasSet.has(id)))
    .map((s) => s.slug);
  const limitReached = specs.length >= maxTopics;
  const notes: string[] = [];

  if (unmapped.length > 0 && limitReached) {
    notes.push(
      `topic limit (${maxTopics}) reached: ${unmapped.length} atlas capabilities have no topic. Coverage is NOT complete; raise maxTopics to cover them.`,
    );
  } else if (unmapped.length > 0) {
    notes.push(
      `${unmapped.length} atlas capabilities have no topic even though the topic limit (${maxTopics}) was not reached.`,
    );
  }
  if (discovered) {
    const before = new Set(discovered.flatMap((s) => s.capabilityIds));
    const lost = [...before].filter(
      (id) => atlasSet.has(id) && !mapped.has(id),
    );
    if (lost.length > 0) {
      notes.push(
        `${lost.length} capabilities lost their topic because the graph found no authored code for it.`,
      );
    }
  }
  if (topicsWithoutCapability.length > 0) {
    notes.push(
      `${topicsWithoutCapability.length} topics have no validated capability mapping.`,
    );
  }

  const report: CoverageReport = {
    atlasCapabilities: atlasIds.length,
    mappedCapabilities: mapped.size,
    unmappedCapabilityIds: unmapped,
    topicsWithoutCapability,
    topicCount: specs.length,
    topicLimit: maxTopics,
    topicLimitReached: limitReached,
    complete: unmapped.length === 0,
    notes,
  };
  if (!report.complete || notes.length) {
    log("capability coverage", report as unknown as Row);
  }
  return report;
}

export function sanitizeDiscovery(
  raw: Row,
  atlas: EvidenceAtlas,
  catalog: TopicCatalogEntry[],
  maxTopics: number,
  prior: TopicSpec[] = [],
): SanitizeResult {
  const knownPackages = new Set(atlas.packages.map((p) => p.name));
  const knownSignals = new Set(atlas.signals.map((s) => s.name));
  const knownCaps = new Set(atlas.capabilities.map((c) => c.id));
  const capNameById = new Map(atlas.capabilities.map((c) => [c.id, c.name]));
  const evidenceVocab = buildEvidenceVocabulary(atlas);

  const capByKey = new Map<string, string | null>();
  for (const c of atlas.capabilities) {
    const key = slugify(c.id);
    if (!key) continue;
    capByKey.set(key, capByKey.has(key) ? null : c.id);
  }

  const catalogByKey = new Map<string, string>();
  for (const c of catalog) {
    catalogByKey.set(slugify(c.slug), c.slug);
    catalogByKey.set(slugify(c.name), c.slug);
    for (const alias of c.aliases) catalogByKey.set(slugify(alias), c.slug);
  }
  const rawTopics = asObjects(raw.topics);
  const discoveredByKey = new Map<string, string>();

  for (const p of prior) {
    discoveredByKey.set(slugify(p.slug), p.slug);
    discoveredByKey.set(slugify(p.name), p.slug);
  }
  for (const t of rawTopics) {
    const name = asStr(t.name, 80);
    const proposed = slugify(asStr(t.slug, 80) || name);
    const canonical =
      catalogByKey.get(slugify(proposed)) ??
      catalogByKey.get(slugify(name)) ??
      proposed;
    if (canonical) {
      discoveredByKey.set(slugify(proposed), canonical);
      discoveredByKey.set(slugify(name), canonical);
      for (const alias of asList(t.aliases, 10, 80)) {
        discoveredByKey.set(slugify(alias), canonical);
      }
    }
  }
  const resolveTopic = (value: string): string | null => {
    const key = slugify(value);
    return catalogByKey.get(key) ?? discoveredByKey.get(key) ?? null;
  };

  const resolveRelationDetails = (
    value: unknown,
    sourceSlug: string,
    max: number,
  ): RelationDetail[] => {
    const out = new Map<string, RelationDetail>();
    for (const x of (Array.isArray(value) ? value : []).slice(0, max)) {
      const o = (x && typeof x === "object" ? x : {}) as Row;
      const label =
        typeof x === "string" ? asStr(x, 80) : asStr(o.slug ?? o.name, 80);
      if (!label) continue;
      const target = resolveTopic(label);
      if (!target) {
        console.warn("[depth-agent] unresolved relationship target", {
          source: sourceSlug,
          target: label,
        });
        continue;
      }
      if (target === sourceSlug || out.has(target)) continue;
      const reason = typeof x === "string" ? "" : asStr(o.reason, 300);
      out.set(target, {
        slug: target,
        reason,
        confidence: isSpecificRationale(reason) ? 0.7 : 0.3,
        strength: asStr(o.strength, 20) === "required" ? "required" : "helpful",
        basis: "llm_inferred",
      });
    }
    return [...out.values()];
  };

  const dropped: SanitizeResult["dropped"] = [];
  const rejectedCapabilityIds: SanitizeResult["rejectedCapabilityIds"] = [];
  const rejectedKeywords: SanitizeResult["rejectedKeywords"] = [];
  const domainCorrections: SanitizeResult["domainCorrections"] = [];
  const topics: TopicSpec[] = [];
  const seen = new Set<string>(prior.map((p) => p.slug));

  const atoms = (o: Row, label: string) => {
    const proposedKeywords = cleanKeywords(asList(o.keywords, 16, 40));
    const keywords = proposedKeywords.filter((k) =>
      keywordGrounded(k, evidenceVocab),
    );
    const rejected = proposedKeywords.filter(
      (k) => !keywordGrounded(k, evidenceVocab),
    );
    if (rejected.length) {
      rejectedKeywords.push({ topic: label, keywords: rejected });
      log("rejected keywords not found in atlas evidence", {
        topic: label,
        keywords: rejected,
      });
    }
    return {
      packages: uniq(
        asList(o.packages, 20, 120)
          .map((p) => p.toLowerCase())
          .filter((p) => knownPackages.has(p)),
      ),
      signals: uniq(
        asList(o.signals, 12, 80).filter((s) => knownSignals.has(s)),
      ),
      keywords,
    };
  };

  for (const t of rawTopics) {
    const name = asStr(t.name, 80);
    let slug = slugify(asStr(t.slug, 80) || name);
    if (!slug || !name) {
      dropped.push({ slug: slug || "(none)", reason: "missing slug or name" });
      continue;
    }
    slug =
      catalogByKey.get(slug) ??
      catalogByKey.get(slugify(name)) ??
      discoveredByKey.get(slug) ??
      discoveredByKey.get(slugify(name)) ??
      slug;
    if (seen.has(slug)) {
      dropped.push({ slug, reason: "duplicate topic" });
      continue;
    }

    const topicAtoms = atoms(t, slug);

    const capabilityIds: string[] = [];
    const rejectedCaps: string[] = [];
    for (const id of asList(t.capability_ids, 8, 80)) {
      const hit = knownCaps.has(id) ? id : capByKey.get(slugify(id));
      if (hit) capabilityIds.push(hit);
      else rejectedCaps.push(id);
    }
    const capIds = uniq(capabilityIds);
    if (rejectedCaps.length) {
      rejectedCapabilityIds.push({ topic: slug, capabilityIds: rejectedCaps });
      log("rejected unknown capability ids", {
        topic: slug,
        unknownCapabilityIds: rejectedCaps,
      });
    }

    const approaches: ApproachSpec[] = [];
    const approachSeen = new Set<string>();
    for (const a of asObjects(t.approaches).slice(0, 5)) {
      const aName = asStr(a.name, 80);
      const aSlug = slugify(asStr(a.slug, 80) || aName);
      if (!aSlug || !aName || approachSeen.has(aSlug)) continue;
      const aAtoms = atoms(a, `${slug}/${aSlug}`);
      if (
        !aAtoms.packages.length &&
        !aAtoms.signals.length &&
        !aAtoms.keywords.length
      ) {
        continue;
      }
      approachSeen.add(aSlug);
      approaches.push({
        slug: aSlug,
        name: aName,
        description: asStr(a.description, 240),
        ...aAtoms,
      });
    }

    const grounded =
      topicAtoms.packages.length ||
      topicAtoms.signals.length ||
      topicAtoms.keywords.length ||
      capIds.length ||
      approaches.length;
    if (!grounded) {
      dropped.push({
        slug,
        reason:
          "no supporting evidence remains after validating packages, signals, keywords and capability ids against the atlas",
      });
      continue;
    }

    if (approaches.length === 0) {
      approaches.push({
        slug: "general",
        name: "General usage",
        description: "",
        packages: topicAtoms.packages,
        signals: topicAtoms.signals,
        keywords: topicAtoms.keywords,
      });
    }

    const proposedDomain = asStr(t.domain, 40);
    const normalizedDomain = asTopicDomain(proposedDomain);
    let domain: TopicDomain;
    let inferred = false;
    if (normalizedDomain && normalizedDomain !== "general") {
      domain = normalizedDomain;
    } else {
      domain = inferDomain({
        name,
        description: asStr(t.description, 300),
        packages: [
          ...topicAtoms.packages,
          ...approaches.flatMap((a) => a.packages),
        ],
        signals: [
          ...topicAtoms.signals,
          ...approaches.flatMap((a) => a.signals),
        ],
        keywords: [
          ...topicAtoms.keywords,
          ...approaches.flatMap((a) => a.keywords),
        ],
        capabilityNames: capIds.flatMap((id) => [
          id,
          capNameById.get(id) ?? "",
        ]),
      });
      inferred = true;
    }
    if (inferred || domain !== proposedDomain) {
      domainCorrections.push({
        slug,
        proposed: proposedDomain,
        assigned: domain,
        inferred,
      });
    }

    const buildsOnDetail = resolveRelationDetails(t.builds_on, slug, 6);
    const relatedDetail = resolveRelationDetails(t.related, slug, 8);

    seen.add(slug);
    topics.push({
      slug,
      name,
      domain,
      description: asStr(t.description, 300),
      aliases: asList(t.aliases, 6, 60),
      keywords: topicAtoms.keywords,
      packages: topicAtoms.packages,
      signals: topicAtoms.signals,
      capabilityIds: capIds,
      approaches,
      buildsOn: buildsOnDetail.map((d) => d.slug),
      related: relatedDetail.map((d) => d.slug),
      buildsOnDetail,
      relatedDetail,
      pinnedFileIds: [],
    });
    if (topics.length + prior.length >= maxTopics) break;
  }

  return {
    topics,
    dropped,
    rejectedCapabilityIds,
    rejectedKeywords,
    domainCorrections,
  };
}

export function fallbackTopics(
  atlas: EvidenceAtlas,
  limit: number,
  existing: TopicSpec[] = [],
): TopicSpec[] {
  const out: TopicSpec[] = [];
  const takenSlugs = new Set(existing.map((t) => t.slug));
  const coveredCaps = new Set(existing.flatMap((t) => t.capabilityIds));

  const pkgsFor = (techs: string[]): string[] => {
    const wanted = uniq(
      techs.map((t) => t.toLowerCase()).filter((t) => t.length >= 3),
    );
    return atlas.packages
      .map((p) => p.name)
      .filter((n) =>
        wanted.some((t) => n === t || n.startsWith(`${t}/`) || n.includes(t)),
      )
      .slice(0, 12);
  };

  for (const cap of atlas.capabilities) {
    if (existing.length + out.length >= limit) break;
    if (coveredCaps.has(cap.id)) continue;

    let slug = slugify(cap.id) || "capability";
    if (takenSlugs.has(slug)) slug = `${slug}_capability`.slice(0, 60);
    if (takenSlugs.has(slug)) continue;

    const exps = atlas.experiences.filter((e) => e.capabilityId === cap.id);
    const words = cleanKeywords(cap.name.split(/\W+/), 6);
    const approaches: ApproachSpec[] = exps.slice(0, 4).map((e) => ({
      slug: slugify(e.technique) || "general",
      name: e.technique || "General usage",
      description: e.summary,
      packages: pkgsFor(e.technologies),
      signals: [],
      keywords: cleanKeywords(e.technique.split(/\W+/), 6),
    }));
    if (approaches.length === 0) {
      approaches.push({
        slug: "general",
        name: "General usage",
        description: "",
        packages: [],
        signals: [],
        keywords: words,
      });
    }
    const packages = uniq(approaches.flatMap((a) => a.packages));
    takenSlugs.add(slug);
    coveredCaps.add(cap.id);
    out.push({
      slug,
      name: cap.name,
      domain: inferDomain({
        name: cap.name,
        description: cap.description,
        packages,
        keywords: words,
        capabilityNames: [cap.id, cap.name],
        technologies: exps.flatMap((e) => e.technologies),
      }),
      description: cap.description,
      aliases: [],
      keywords: words,
      packages,
      signals: [],
      capabilityIds: [cap.id],
      approaches,
      buildsOn: [],
      related: [],
      pinnedFileIds: [],
    });
  }
  return out;
}

async function discoverTopics(
  gateway: LlmGateway,
  atlas: EvidenceAtlas,
  catalog: TopicCatalogEntry[],
  maxTopics: number,
  usedFallback: string[],
): Promise<DiscoveryResult> {
  const target = Math.min(
    maxTopics,
    Math.max(
      8,
      Math.min(
        24,
        atlas.capabilities.length + Math.ceil(atlas.packages.length / 4),
      ),
    ),
  );
  const result: SanitizeResult = {
    topics: [],
    dropped: [],
    rejectedCapabilityIds: [],
    rejectedKeywords: [],
    domainCorrections: [],
  };
  const hasAtoms =
    atlas.packages.length || atlas.signals.length || atlas.capabilities.length;

  if (hasAtoms) {
    for (let round = 1; round <= 2 && result.topics.length < target; round++) {
      if (gateway.open) break;
      const raw = await gateway.json({
        stage: "discover",
        system: DISCOVER_SYSTEM,
        user: `EVIDENCE ATLAS:\n${atlasForPrompt(atlas, catalog, maxTopics, {
          minTopics: target,
          alreadyFound: result.topics.map((t) => ({
            slug: t.slug,
            name: t.name,
          })),
        })}`,
        maxTokens: 8000,
      });
      if (!raw) break;

      const before = result.topics.length;
      const r = sanitizeDiscovery(
        raw,
        atlas,
        catalog,
        maxTopics,
        result.topics,
      );
      result.topics.push(...r.topics);
      result.dropped.push(...r.dropped);
      result.rejectedCapabilityIds.push(...r.rejectedCapabilityIds);
      result.rejectedKeywords.push(...r.rejectedKeywords);
      result.domainCorrections.push(...r.domainCorrections);
      log("discover round", {
        round,
        target,
        rawTopics: asObjects(raw.topics).length,
        kept: r.topics.length,
        dropped: r.dropped,
        rejectedCapabilityIds: r.rejectedCapabilityIds.length,
        rejectedKeywords: r.rejectedKeywords.length,
        total: result.topics.length,
      });
      if (result.topics.length === before) break;
    }
  }

  const extra = fallbackTopics(atlas, maxTopics, result.topics);
  if (extra.length) {
    usedFallback.push(
      `capability gap-fill: ${extra.length} topics for capabilities no discovered topic covered`,
    );
    result.topics.push(...extra);
  }

  const coverage = computeCoverage(atlas, result.topics, maxTopics);
  return { ...result, coverage };
}

const JUDGE_SYSTEM = `You are the depth analyzer of Pathway. You judge how deeply ONE developer knows ONE topic, using ONLY the evidence you are given. The evidence was extracted from their own authored code by graph queries; short refs (S1, D1, E1, C1) point to concrete code samples, detector demonstrations, grouped experiences and commits.

DEPTH LEVELS
- none: no real evidence.
- surface: touched, imported or configured; a single sighting, copied boilerplate, or library defaults with no decisions of their own.
- working: used correctly in real features, repeated, but relying on defaults; no design decisions of their own visible.
- proficient: deliberate decisions are visible (configuration, error paths, invalidation or cleanup, limits), seen in several contexts or commits, with signs of iteration or tests.
- deep: they built or composed the mechanism themselves, hardened it, evolved it after problems (fix/perf/refactor follow-ups), tested it, or combined several approaches with visible trade-offs.

AUTHENTICITY (is it real, or there "for the sake of it"?)
- genuine_implementation: they implemented the mechanism or made real design decisions.
- working_usage: they use it properly but do not build or tune it.
- incidental: it appears as a side effect (a transitive helper, a one-off call).
- boilerplate: scaffold, template or copied starter code; large first commits; dependency declared but never used.
- insufficient_evidence: not enough to say.
Signals that something is only there for the sake of it: one commit, files that never change again, big scaffold commits (scaffold.share), dependency declared in manifests but never imported (declaredOnly), added then removed (dependencyEvents), no own definitions, no tests, no follow-up fixes.
Signals of real depth: own definitions that match the topic (definedSymbols), hardening behaviours, revisited files, fix/perf/refactor follow-ups after the first version, related tests, several repositories, long active span.

APPROACHES. For each approach that has evidence, judge its depth and authenticity separately and explain HOW it was implemented in one or two plain sentences grounded in the samples. Say which approach is primary (most used / most mature).

THREE KINDS OF STATEMENT (never blur them)
- OBSERVED: the code itself shows it. You MUST cite the ref (S1, D1, E1, C1) of the sample, detection, experience or commit that shows it, and say what that code does (for example "S2 defines its own token-bucket limiter with a reset timer").
- INFERRED: a reasonable conclusion that no single ref shows (for example "likely understands cache invalidation because it fixed stale reads in C3"). Mark it with the word "inferred".
- ASSOCIATION: the topic or capability is merely linked to something else in the taxonomy, or only a package is present. Mark it with the word "associated". An association is NEVER evidence of skill and never raises the level.
In "rationale" write short sentences that start with "Observed:", "Inferred:" or "Associated:" so a reader can tell them apart. Prefer observed claims; give at most one or two inferred ones.

CONFIDENCE reflects BOTH strength and diversity of the evidence, not only quantity. High needs several kinds of evidence (code samples, detector hits, grouped experiences, commits), more than one repository, repeated work over time, and signs of iteration or tests. One repository, one kind of evidence, one burst of commits, or no follow-up work means medium at best. Thin or single-sighting evidence is low.

RULES
- Judge only from the evidence. Never claim a behaviour you cannot point to. Cite refs for every observed claim.
- baseline is a deterministic prior computed from counts. You may go above or below it, but explain why in the rationale. You cannot go more than one level above it.
- Evidence of absence is weak: say what you cannot see instead of assuming.
- Detectors are heuristics. A pattern match is not proof of quality: read the samples.
- If evidence is too thin to judge, say so with low confidence and set needs_more_evidence. Only ask when you can name exact packages (from "knownPackages") or keywords that would reveal the missing code.
- Keep verdict to 2-3 plain sentences a developer would find fair. Keep rationale under 160 words.
- Output minified JSON on one line, no indentation, no commentary. Do not think out loud: answer with the JSON object only.

Return ONLY this JSON:
{"level":"none|surface|working|proficient|deep","score":0-100,"authenticity":"genuine_implementation|working_usage|incidental|boilerplate|insufficient_evidence","confidence":"high|medium|low","verdict":"","rationale":"","strengths":[],"gaps":[],"approaches":[{"slug":"","depth":"none|surface|working|proficient|deep","authenticity":"...","is_primary":false,"how_implemented":"","hardening":[],"gaps":[],"evidence":["S1"]}],"evidence":["S1","D1"],"needs_more_evidence":{"needed":false,"packages":[],"keywords":[],"why":""}}`;

function evidencePayload(
  ev: TopicEvidence,
  atlas: EvidenceAtlas,
  maxChars = 14_000,
): string {
  const build = (excerpt: number, demos: number, commits: number): string =>
    JSON.stringify({
      topic: {
        slug: ev.spec.slug,
        name: ev.spec.name,
        domain: ev.spec.domain,
        description: ev.spec.description,
      },
      approaches: ev.approaches.map((a) => ({
        slug: a.slug,
        name: a.name,
        description:
          ev.spec.approaches.find((s) => s.slug === a.slug)?.description ?? "",
        files: a.files,
        commits: a.commits,
        repos: a.repos,
        activeDays: a.activeDays,
        firstSeen: a.firstSeen,
        lastSeen: a.lastSeen,
        testFiles: a.testFiles,
        revisitedFiles: a.revisitedFiles,
        packages: a.matchedPackages,
        signals: a.matchedSignals,
        definedSymbols: a.definedSymbols.slice(0, 12),
        baseline: { score: a.baseline.score, level: a.baseline.level },
      })),
      totals: ev.totals,
      unattributedFiles: ev.unattributedFiles,
      maturation: ev.maturation,
      scaffold: ev.scaffold,
      declaredOnly: ev.declaredOnly,
      dependencyEvents: ev.dependencyEvents,
      hardeningObserved: ev.hardening,
      timeline: ev.timeline,
      baseline: ev.baseline,
      capabilityRollups: ev.capabilityRollups.map((c) => ({
        id: c.id,
        level: c.level,
        evidence: c.evidence,
        commits: c.commits,
      })),
      topicGraph: ev.context
        ? {
            foundationRank: ev.context.foundationRank,
            bridgeScore: ev.context.bridgeScore,
            foundations: ev.context.foundations,
          }
        : null,
      samples: ev.samples.map((s) => ({
        ref: s.ref,
        approach: s.approach,
        repo: s.repository,
        path: s.path,
        commit: s.commitSubject,
        date: s.date,
        matched: s.matched,
        code: s.excerpt.slice(0, excerpt),
      })),
      demonstrations: ev.demonstrations.slice(0, demos).map((d) => ({
        ref: d.ref,
        technique: d.technique,
        depth: d.depth,
        modifiers: d.modifiers,
        repo: d.repository,
        path: d.path,
        commit: d.commitSubject,
      })),
      experiences: ev.experiences.map((e) => ({
        ref: e.ref,
        technique: e.technique,
        depth: e.depth,
        evidence: e.evidenceCount,
        commits: e.commitCount,
        repos: e.repoCount,
        technologies: e.technologies,
        summary: e.summary,
      })),
      commits: ev.commits.slice(0, commits).map((c) => ({
        ref: c.ref,
        subject: c.subject,
        type: c.type,
        day: c.day,
        files: c.filesCount,
        scaffold: c.scaffold,
      })),
      knownPackages: atlas.packages.slice(0, 40).map((p) => p.name),
    });

  for (const [excerpt, demos, commits] of [
    [700, 8, 10],
    [480, 6, 8],
    [300, 4, 6],
    [180, 3, 4],
  ] as const) {
    const out = build(excerpt, demos, commits);
    if (out.length <= maxChars) return out;
  }
  return build(120, 2, 3);
}

interface Judgement {
  level: DepthLevel;
  score: number;
  authenticity: Authenticity;
  confidence: Confidence;
  verdict: string;
  rationale: string;
  strengths: string[];
  gaps: string[];
  approaches: Array<{
    slug: string;
    depth: DepthLevel;
    authenticity: Authenticity;
    isPrimary: boolean;
    howImplemented: string;
    hardening: string[];
    gaps: string[];
    evidence: string[];
  }>;
  evidence: string[];
  needsMore: {
    needed: boolean;
    packages: string[];
    keywords: string[];
    why: string;
  };
}

function parseJudgement(raw: Row): Judgement {
  const need = (raw.needs_more_evidence ?? {}) as Row;
  return {
    level: asDepthLevel(raw.level),
    score: Math.max(0, Math.min(100, Math.round(asNum(raw.score)))),
    authenticity: asAuthenticity(raw.authenticity),
    confidence: asConfidence(raw.confidence),
    verdict: asStr(raw.verdict, 700),
    rationale: asStr(raw.rationale, 1500),
    strengths: asList(raw.strengths, 6, 220),
    gaps: asList(raw.gaps, 6, 220),
    approaches: asObjects(raw.approaches).map((a) => ({
      slug: slugify(asStr(a.slug, 80)),
      depth: asDepthLevel(a.depth),
      authenticity: asAuthenticity(a.authenticity),
      isPrimary: asBool(a.is_primary),
      howImplemented: asStr(a.how_implemented, 600),
      hardening: asList(a.hardening, 8, 120),
      gaps: asList(a.gaps, 5, 200),
      evidence: asList(a.evidence, 8, 12),
    })),
    evidence: asList(raw.evidence, 16, 12),
    needsMore: {
      needed: asBool(need.needed),
      packages: asList(need.packages, 8, 120),
      keywords: asList(need.keywords, 8, 40),
      why: asStr(need.why, 300),
    },
  };
}

const MAX_LEVEL_BY_AUTHENTICITY: Record<Authenticity, DepthLevel> = {
  genuine_implementation: "deep",
  working_usage: "proficient",
  incidental: "working",
  boilerplate: "surface",
  insufficient_evidence: "surface",
};

const CONFIDENCE_RANK: Record<Confidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const rankToLevel = (rank: number): DepthLevel =>
  (["none", "surface", "working", "proficient", "deep"] as DepthLevel[])[
    Math.max(0, Math.min(4, rank))
  ];

const minLevel = (a: DepthLevel, b: DepthLevel): DepthLevel =>
  DEPTH_RANK[a] <= DEPTH_RANK[b] ? a : b;

function clampScore(level: DepthLevel, score: number): number {
  const [lo, hi] = DEPTH_BANDS[level];
  return Math.max(lo, Math.min(hi, Math.round(score)));
}

function fallbackAuthenticity(ev: TopicEvidence): Authenticity {
  if (!ev.matched) return "insufficient_evidence";
  if (ev.scaffold.share >= 0.7) return "boilerplate";
  const built =
    ev.baseline.components.ownImplementation !== undefined &&
    ev.baseline.components.ownImplementation >= 10;
  if (built) return "genuine_implementation";
  if (ev.totals.commits >= 2) return "working_usage";
  return "incidental";
}

/**
 * How strong AND how varied the evidence is. Confidence is capped by this, so
 * a model saying "high" on a single repository or a single kind of evidence is
 * brought back down. Everything here is read from graph counts, never invented.
 */
interface EvidenceStrength {
  ratio: number;
  kinds: number;
  cap: Confidence;
  reasons: string[];
}

function evidenceStrength(ev: TopicEvidence): EvidenceStrength {
  const t = ev.totals;
  const step = (v: number, steps: number[]) =>
    steps.filter((s) => v >= s).length;

  const files = step(t.files, [3, 8, 20]);
  const commits = step(t.commits, [2, 5, 12]);
  const repos = step(t.repos, [2, 3]);
  const kindFlags: Array<[string, boolean]> = [
    ["code samples", ev.samples.length > 0],
    ["detector hits", ev.demonstrations.length > 0],
    ["grouped experiences", ev.experiences.length > 0],
    ["commits", ev.commits.length > 0],
  ];
  const kindNames = kindFlags.filter(([, on]) => on).map(([n]) => n);
  const kinds = kindNames.length;
  const tests = ev.approaches.some((a) => a.testFiles > 0) ? 1 : 0;
  const revisits = ev.approaches.some((a) => a.revisitedFiles > 0) ? 1 : 0;
  const hardening = Math.min(2, ev.hardening.length);
  const own = ev.baseline.components.ownImplementation ?? 0;
  const built = own >= 10 ? 2 : own >= 6 ? 1 : 0;
  const scaffoldPenalty = ev.scaffold.share >= 0.5 ? 2 : 0;

  // max: files 3 + commits 3 + repos 2 + kinds 4 + tests 1 + revisits 1 + hardening 2 + built 2
  const total =
    files + commits + repos + kinds + tests + revisits + hardening + built;
  const ratio = Math.max(0, total - scaffoldPenalty) / 18;

  let cap: Confidence =
    ratio >= 0.6 && kinds >= 3 && t.commits >= 5
      ? "high"
      : ratio >= 0.35
        ? "medium"
        : "low";
  if (t.repos < 2 && cap === "high") cap = "medium";

  const reasons: string[] = [
    `${t.files} file${t.files === 1 ? "" : "s"}, ${t.commits} commit${t.commits === 1 ? "" : "s"}, ${t.repos} repositor${t.repos === 1 ? "y" : "ies"}`,
    `${kinds} of 4 evidence kinds${kinds ? ` (${kindNames.join(", ")})` : ""}`,
  ];
  if (!tests) reasons.push("no related tests seen");
  if (!revisits) reasons.push("no file revisited after first write");
  if (scaffoldPenalty) reasons.push("much of the evidence is scaffold-like");
  if (t.repos < 2) reasons.push("single-repository evidence cannot be high");

  return { ratio, kinds, cap, reasons };
}

function reconcile(
  ev: TopicEvidence,
  judgement: Judgement | null,
  model: string,
): DepthAssessmentRecord {
  void model;
  const baseline = ev.baseline;
  const guards: string[] = [];
  const refByKey = new Map(ev.refs.map((r) => [r.key, r]));

  let level: DepthLevel;
  let score: number;
  let authenticity: Authenticity;
  let confidence: Confidence;
  let verdict: string;
  let rationale: string;
  let strengths: string[] = [];
  let gaps: string[] = [];
  const fallback = judgement === null;

  if (!ev.matched) {
    level = "none";
    score = 0;
    authenticity = "insufficient_evidence";
    confidence = "low";
    verdict = `No code authored by this developer matches ${ev.spec.name}.`;
    rationale = "The graph found no matching files, so nothing can be judged.";
  } else if (!judgement) {
    level = baseline.level;
    authenticity = fallbackAuthenticity(ev);
    level = minLevel(level, MAX_LEVEL_BY_AUTHENTICITY[authenticity]);
    score = clampScore(level, baseline.score);
    confidence = "low";
    verdict = `Estimated from graph statistics only (${ev.totals.files} files, ${ev.totals.commits} commits, ${ev.totals.repos} repositories); no model judgement was available.`;
    rationale =
      [...baseline.reasons, ...baseline.caps].join("; ") ||
      "No further signals.";
  } else {
    level = judgement.level;
    authenticity = judgement.authenticity;
    confidence = judgement.confidence;
    verdict = judgement.verdict;
    rationale = judgement.rationale;
    strengths = judgement.strengths;
    gaps = judgement.gaps;

    const ceiling = rankToLevel(DEPTH_RANK[baseline.level] + 1);
    if (DEPTH_RANK[level] > DEPTH_RANK[ceiling]) {
      guards.push(
        `level lowered from ${level} to ${ceiling}: more than one level above the graph baseline (${baseline.level})`,
      );
      level = ceiling;
    }

    const built =
      ev.baseline.components.ownImplementation !== undefined &&
      ev.baseline.components.ownImplementation >= 6;
    if (
      authenticity === "genuine_implementation" &&
      !built &&
      ev.totals.files < 3
    ) {
      guards.push(
        "authenticity lowered to working_usage: no own definitions, no built mechanism, fewer than 3 files",
      );
      authenticity = "working_usage";
    }
    if (ev.scaffold.share >= 0.7 && authenticity !== "boilerplate") {
      guards.push(
        "authenticity set to boilerplate: most evidence is in scaffold-like commits",
      );
      authenticity = "boilerplate";
    }

    const authCap = MAX_LEVEL_BY_AUTHENTICITY[authenticity];
    if (DEPTH_RANK[level] > DEPTH_RANK[authCap]) {
      guards.push(
        `level lowered from ${level} to ${authCap}: ${authenticity} cannot be ${level}`,
      );
      level = authCap;
    }

    score = clampScore(level, judgement.score || baseline.score);
    if (!judgement.verdict)
      verdict = `${ev.spec.name}: ${level} (${authenticity}).`;
  }

  // Confidence: the model may lower it, never raise it above what the
  // strength AND diversity of the evidence supports.
  let confidenceNote = "";
  if (ev.matched) {
    const strength = evidenceStrength(ev);
    if (ev.totals.files < 3 || ev.totals.commits < 2) {
      confidence = "low";
    } else if (CONFIDENCE_RANK[strength.cap] < CONFIDENCE_RANK[confidence]) {
      guards.push(
        `confidence lowered from ${confidence} to ${strength.cap}: evidence is not strong and varied enough`,
      );
      confidence = strength.cap;
    }
    confidenceNote = `[Confidence ${confidence}: ${strength.reasons.join("; ")}]`;
  }
  if (guards.length)
    rationale = `${rationale}${rationale ? " " : ""}[Guard-rails: ${guards.join("; ")}]`;
  if (confidenceNote)
    rationale = `${rationale}${rationale ? " " : ""}${confidenceNote}`;

  const judged = new Map((judgement?.approaches ?? []).map((a) => [a.slug, a]));
  const withEvidence = ev.approaches.filter((a) => a.files > 0);

  const records: ApproachRecord[] = withEvidence.map((a) => {
    const spec = ev.spec.approaches.find((s) => s.slug === a.slug);
    const j = judged.get(a.slug);
    const ruleAuth: Authenticity =
      a.definedSymbols.length > 0 ||
      a.baseline.components.ownImplementation >= 10
        ? "genuine_implementation"
        : a.commits >= 2
          ? "working_usage"
          : "incidental";
    let approachAuth = j?.authenticity ?? ruleAuth;
    if (!j && ev.scaffold.share >= 0.7) approachAuth = "boilerplate";
    let depth = j?.depth ?? a.baseline.level;
    depth = minLevel(depth, rankToLevel(DEPTH_RANK[a.baseline.level] + 1));
    depth = minLevel(depth, MAX_LEVEL_BY_AUTHENTICITY[approachAuth]);
    if (DEPTH_RANK[depth] > DEPTH_RANK[level] && level !== "none")
      depth = level;

    const cited = (j?.evidence ?? []).filter((k) => refByKey.has(k));
    const fromSamples = ev.samples
      .filter((s) => s.approach === a.slug)
      .map((s) => s.ref);
    return {
      slug: a.slug,
      name: a.name,
      description: spec?.description ?? "",
      files: a.files,
      commits: a.commits,
      repos: a.repos,
      firstSeen: a.firstSeen,
      lastSeen: a.lastSeen,
      depth,
      authenticity: approachAuth,
      isPrimary: j?.isPrimary ?? false,
      howImplemented:
        j?.howImplemented ||
        `${a.files} files across ${a.commits} commits${a.matchedPackages.length ? ` using ${a.matchedPackages.slice(0, 4).join(", ")}` : ""}.`,
      hardening: j?.hardening ?? [],
      gaps: j?.gaps ?? [],
      evidenceRefs: uniq([...cited, ...fromSamples]).slice(0, 6),
    };
  });

  if (records.length === 0 && ev.matched) {
    records.push({
      slug: "general",
      name: "General usage",
      description: "",
      files: ev.totals.files,
      commits: ev.totals.commits,
      repos: ev.totals.repos,
      firstSeen: ev.totals.firstSeen,
      lastSeen: ev.totals.lastSeen,
      depth: level,
      authenticity,
      isPrimary: true,
      howImplemented: "",
      hardening: ev.hardening.slice(0, 4).map((h) => h.label),
      gaps: [],
      evidenceRefs: ev.samples.slice(0, 2).map((s) => s.ref),
    });
  }
  if (records.length && !records.some((r) => r.isPrimary)) {
    const top = [...records].sort(
      (a, b) => b.files - a.files || b.commits - a.commits,
    )[0];
    top.isPrimary = true;
  } else if (records.filter((r) => r.isPrimary).length > 1) {
    let seenPrimary = false;
    for (const r of [...records].sort((a, b) => b.files - a.files)) {
      if (r.isPrimary && seenPrimary) r.isPrimary = false;
      if (r.isPrimary) seenPrimary = true;
    }
  }

  let citedKeys = uniq([
    ...(judgement?.evidence ?? []),
    ...records.flatMap((r) => r.evidenceRefs),
  ]).filter((k) => refByKey.has(k));
  if (citedKeys.length === 0) {
    citedKeys = uniq([
      ...ev.samples.slice(0, 3).map((s) => s.ref),
      ...ev.demonstrations.slice(0, 2).map((d) => d.ref),
    ]);
  }
  const evidence: EvidenceRef[] = citedKeys
    .slice(0, 14)
    .map((k) => refByKey.get(k))
    .filter((r): r is EvidenceRef => Boolean(r));
  const implementations: ImplementationNote[] = ev.demonstrations
    .filter(
      (d) =>
        d.matchedBy === "capability" &&
        d.depth.toLowerCase() !== "usage" &&
        refByKey.has(d.ref),
    )
    .slice(0, 8)
    .map((d) => ({
      ref: d.ref,
      what: d.technique || d.snippet,
      repository: d.repository,
      path: d.path,
      permalink: refByKey.get(d.ref)?.permalink ?? "",
    }));
  const safeguards = uniq([
    ...ev.hardening.map((h) => h.label),
    ...(judgement?.approaches ?? []).flatMap((a) => a.hardening),
  ]).slice(0, 10);

  return {
    slug: ev.spec.slug,
    name: ev.spec.name,
    topic: {
      slug: ev.spec.slug,
      name: ev.spec.name,
      domain: ev.spec.domain,
      description: ev.spec.description,
      aliases: ev.spec.aliases,
    },
    level,
    score,
    baselineScore: baseline.score,
    baselineLevel: baseline.level,
    confidence,
    authenticity,
    verdict,
    rationale,
    strengths,
    gaps,
    safeguards,
    implementations,
    approaches: records,
    evidence,
    stats: ev.totals,
    spec: ev.spec,
    fallback,
  };
}

const isThinEvidence = (ev: TopicEvidence): boolean =>
  ev.totals.files <= 1 && ev.totals.commits <= 1;

async function judgeTopic(
  graph: Graph,
  gateway: LlmGateway,
  atlas: EvidenceAtlas,
  initial: TopicEvidence,
  maxRefinements: number,
  onProgress: ProgressFn,
): Promise<{
  evidence: TopicEvidence;
  judgement: Judgement | null;
  refined: number;
}> {
  let evidence = initial;
  let refined = 0;

  while (true) {
    if (!evidence.matched) return { evidence, judgement: null, refined };
    if (isThinEvidence(evidence)) return { evidence, judgement: null, refined };
    if (gateway.open) return { evidence, judgement: null, refined };

    const raw = await gateway.json({
      stage: "judge",
      system: JUDGE_SYSTEM,
      user: `Judge this developer's depth in the topic below.\n\nEVIDENCE:\n${evidencePayload(evidence, atlas)}`,
      maxTokens: 4000,
    });
    if (!raw) return { evidence, judgement: null, refined };
    const judgement = parseJudgement(raw);

    const wantsMore =
      judgement.needsMore.needed &&
      refined < maxRefinements &&
      (evidence.totals.files < 8 || judgement.confidence === "low");
    if (!wantsMore) return { evidence, judgement, refined };

    const verified = probeAtlas(atlas, {
      packages: judgement.needsMore.packages,
      keywords: judgement.needsMore.keywords,
    });
    const probes = await probeKeywords(
      graph,
      atlas.developerId,
      judgement.needsMore.keywords,
    );

    const spec = evidence.spec;
    const newPackages = verified.packages.filter(
      (p) => !spec.packages.includes(p),
    );
    const probedKeywords = probes.map((p) => p.keyword);
    const newKeywords = uniq([...verified.keywords, ...probedKeywords]).filter(
      (k) => !spec.keywords.includes(k),
    );
    const pinned = probes.flatMap((p) => p.fileIds);
    const newPinned = pinned.filter((id) => !spec.pinnedFileIds.includes(id));

    if (!newPackages.length && !newKeywords.length && !newPinned.length) {
      return { evidence, judgement, refined };
    }

    refined += 1;
    onProgress("depth_refining", {
      topic: spec.slug,
      packages: newPackages,
      keywords: newKeywords,
      pinned: newPinned.length,
    });
    evidence = await gatherTopicEvidence(graph, atlas, {
      ...spec,
      packages: uniq([...spec.packages, ...newPackages]),
      keywords: uniq([...spec.keywords, ...newKeywords]).slice(0, 20),
      pinnedFileIds: uniq([...spec.pinnedFileIds, ...newPinned]).slice(0, 200),
    });
  }
}

const SYNTH_SYSTEM = `You write a descriptive DEPTH PROFILE from per-topic assessments. Be concrete and fair. Never invent topics.
Describe observed patterns only. Choose which topics belong in each list; the code orders the lists afterwards from the assessment data (depth, confidence, evidence volume). Do not rank topics yourself. Graph-wide topic ranking and recommendations belong exclusively to FalkorDB graph algorithms and graph traversal; these summary lists are descriptive, not a replacement for that ranking.
Output minified JSON on one line, no commentary. Do not think out loud: answer with the JSON object only.
Return ONLY this JSON:
{"headline":"one sentence","pattern":"2-4 sentences","strongest":["topic_slug"],"broad_but_shallow":["topic_slug"],"deepening":[{"slug":"topic_slug","why":"one sentence"}]}`;

const evidenceVolume = (r: DepthAssessmentRecord): number =>
  r.stats.files + 2 * r.stats.commits + 3 * r.stats.repos;

const nameOrder = (a: DepthAssessmentRecord, b: DepthAssessmentRecord) =>
  a.topic.name.localeCompare(b.topic.name);

export const byStrength = (
  a: DepthAssessmentRecord,
  b: DepthAssessmentRecord,
) =>
  DEPTH_RANK[b.level] - DEPTH_RANK[a.level] ||
  CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] ||
  evidenceVolume(b) - evidenceVolume(a) ||
  b.score - a.score ||
  nameOrder(a, b);

export const byBreadth = (a: DepthAssessmentRecord, b: DepthAssessmentRecord) =>
  evidenceVolume(b) - evidenceVolume(a) ||
  b.stats.files - a.stats.files ||
  nameOrder(a, b);

const gapText = (r: DepthAssessmentRecord): string | undefined =>
  r.gaps[0] ?? r.approaches.find((a) => a.gaps.length > 0)?.gaps[0];

export const byDeepening = (
  a: DepthAssessmentRecord,
  b: DepthAssessmentRecord,
) =>
  Number(Boolean(gapText(b))) - Number(Boolean(gapText(a))) ||
  evidenceVolume(b) - evidenceVolume(a) ||
  DEPTH_RANK[b.level] - DEPTH_RANK[a.level] ||
  nameOrder(a, b);

export function deterministicSummary(
  records: DepthAssessmentRecord[],
): DepthProfileSummary {
  const strongest = records
    .filter((r) => DEPTH_RANK[r.level] >= 3)
    .sort(byStrength)
    .slice(0, 5)
    .map((r) => ({
      slug: r.topic.slug,
      name: r.topic.name,
      level: r.level,
      score: r.score,
    }));
  const broadButShallow = records
    .filter((r) => DEPTH_RANK[r.level] <= 2 && r.stats.files >= 5)
    .sort(byBreadth)
    .slice(0, 5)
    .map((r) => ({ slug: r.topic.slug, name: r.topic.name }));
  const deepening = records
    .filter((r) => r.level === "working" || r.level === "proficient")
    .sort(byDeepening)
    .slice(0, 4)
    .map((r) => ({
      slug: r.topic.slug,
      name: r.topic.name,
      why:
        gapText(r) ??
        `Currently ${r.level}; the next step is building more of it yourself.`,
    }));
  const deep = records.filter((r) => r.level === "deep").length;
  const builds = records.filter(
    (r) => r.authenticity === "genuine_implementation",
  ).length;
  return {
    headline: `${records.length} topics assessed, ${deep} at deep level, ${builds} with their own implementations.`,
    pattern: strongest.length
      ? `Strongest in ${strongest.map((s) => s.name).join(", ")}.`
      : "No topic reaches proficient depth yet.",
    strongest,
    broadButShallow,
    deepening,
    generatedBy: "deterministic",
  };
}

async function synthesize(
  gateway: LlmGateway,
  records: DepthAssessmentRecord[],
): Promise<DepthProfileSummary> {
  const base = deterministicSummary(records);
  if (records.length === 0 || gateway.open) return base;

  const raw = await gateway.json({
    stage: "synthesize",
    system: SYNTH_SYSTEM,
    user: JSON.stringify(
      records.map((r) => ({
        slug: r.topic.slug,
        name: r.topic.name,
        domain: r.topic.domain,
        level: r.level,
        authenticity: r.authenticity,
        confidence: r.confidence,
        files: r.stats.files,
        commits: r.stats.commits,
        approaches: r.approaches.map((a) => `${a.name}:${a.depth}`),
        gaps: r.gaps.slice(0, 2),
      })),
    ),
    maxTokens: 1500,
  });
  if (!raw) return base;

  const byslug = new Map(records.map((r) => [r.topic.slug, r]));
  const pick = (v: unknown, n: number) =>
    uniq(
      asList(v, n, 80)
        .map((s) => byslug.get(slugify(s)))
        .filter((r): r is DepthAssessmentRecord => Boolean(r)),
    );

  const strongest = pick(raw.strongest, 6)
    .sort(byStrength)
    .map((r) => ({
      slug: r.topic.slug,
      name: r.topic.name,
      level: r.level,
      score: r.score,
    }));
  const deepening = asObjects(raw.deepening)
    .map((d) => ({
      record: byslug.get(slugify(asStr(d.slug, 80))),
      why: asStr(d.why, 260),
    }))
    .filter((d): d is { record: DepthAssessmentRecord; why: string } =>
      Boolean(d.record),
    )
    .sort((a, b) => byDeepening(a.record, b.record))
    .slice(0, 5)
    .map((d) => ({
      slug: d.record.topic.slug,
      name: d.record.topic.name,
      why: d.why,
    }));

  return {
    headline: asStr(raw.headline, 240) || base.headline,
    pattern: asStr(raw.pattern, 900) || base.pattern,
    strongest: strongest.length ? strongest : base.strongest,
    broadButShallow: pick(raw.broad_but_shallow, 6)
      .sort(byBreadth)
      .map((r) => ({
        slug: r.topic.slug,
        name: r.topic.name,
      })),
    deepening: deepening.length ? deepening : base.deepening,
    generatedBy: "llm",
  };
}

export interface DepthAnalyzerOptions {
  llm: DepthLlm;
  maxTopics?: number;
  gatherConcurrency?: number;
  judgeConcurrency?: number;
  llmConcurrency?: number;
  llmTpm?: number;
  llmBreaker?: number;
  maxRefinements?: number;
  synthesize?: boolean;
  persist?: boolean;
  refreshMetrics?: boolean;
  force?: boolean;
  onProgress?: ProgressFn;
}

export interface RelationRejection {
  from: string;
  to: string;
  type: "BUILDS_ON" | "RELATED_TOPIC";
  reason: string;
}

export interface RelationReport {
  relations: TopicRelationInput[];
  rejected: RelationRejection[];
}

export interface DepthDiagnostics {
  rejectedCapabilityIds: Array<{ topic: string; capabilityIds: string[] }>;
  rejectedKeywords: Array<{ topic: string; keywords: string[] }>;
  domainCorrections: SanitizeResult["domainCorrections"];
  discoveryCoverage: CoverageReport;
  coverage: CoverageReport;
  rejectedRelations: RelationRejection[];
  storage: {
    mappings: number;
    unresolvedMappings: StoreDepthResult["unresolvedMappings"];
    relationsRequested: number;
    relationsPersisted: number;
    rejectedRelations: StoreDepthResult["rejectedRelations"];
  } | null;
}

export interface DepthAnalysisResult {
  developerId: string;
  buildId: string;
  model: string;
  topicsDiscovered: number;
  topicsAssessed: number;
  dropped: Array<{ slug: string; reason: string }>;
  assessments: DepthAssessmentRecord[];
  summary: DepthProfileSummary;
  metrics: TopicGraphMetrics | null;
  diagnostics: DepthDiagnostics;
  llmCalls: number;
  llmFailures: string[];
  llmCircuitOpen: boolean;
  usedFallback: string[];
  refinements: number;
  durationMs: number;
}

export function deriveEvidenceRelations(
  specs: TopicSpec[],
  footprints: Map<string, TopicFootprint>,
  maxPerTopic = 4,
): TopicRelationInput[] {
  const common = <T>(x: T[] = [], y: T[] = []): T[] => {
    const s = new Set(y);
    return x.filter((v) => s.has(v));
  };
  type Pair = { a: TopicSpec; b: TopicSpec; score: number; reason: string };
  const pairs: Pair[] = [];

  for (let i = 0; i < specs.length; i++) {
    for (let j = i + 1; j < specs.length; j++) {
      const a = specs[i];
      const b = specs[j];
      const fa = footprints.get(a.slug);
      const fb = footprints.get(b.slug);
      const commits = common(fa?.commitIds, fb?.commitIds).length;
      const dirs = common(fa?.dirs, fb?.dirs);
      const caps = common(a.capabilityIds, b.capabilityIds);
      const pkgs = common(a.packages, b.packages);
      const score =
        Math.min(commits, 6) +
        Math.min(dirs.length, 4) * 1.5 +
        caps.length * 2 +
        Math.min(pkgs.length, 3);
      if (score < 2) continue;

      const parts: string[] = [];
      if (commits)
        parts.push(
          `changed together in ${commits} commit${commits === 1 ? "" : "s"}`,
        );
      if (dirs.length)
        parts.push(
          `worked on in the same folder (${dirs[0].split(":").slice(1).join(":")})`,
        );
      if (caps.length) parts.push(`share the capability ${caps[0]}`);
      if (pkgs.length) parts.push(`both use ${pkgs.slice(0, 3).join(", ")}`);
      pairs.push({
        a,
        b,
        score,
        reason: `${a.name} and ${b.name} ${parts.join("; ")} in your own code.`,
      });
    }
  }

  pairs.sort((x, y) => y.score - x.score || x.a.slug.localeCompare(y.a.slug));
  const degree = new Map<string, number>();
  const taken = new Set<Pair>();
  const chosen: Pair[] = [];
  const take = (p: Pair) => {
    taken.add(p);
    chosen.push(p);
    degree.set(p.a.slug, (degree.get(p.a.slug) ?? 0) + 1);
    degree.set(p.b.slug, (degree.get(p.b.slug) ?? 0) + 1);
  };
  for (const p of pairs) {
    if (
      (degree.get(p.a.slug) ?? 0) < maxPerTopic &&
      (degree.get(p.b.slug) ?? 0) < maxPerTopic
    )
      take(p);
  }

  for (const s of specs) {
    if ((degree.get(s.slug) ?? 0) > 0) continue;
    const best = pairs.find(
      (p) => !taken.has(p) && (p.a.slug === s.slug || p.b.slug === s.slug),
    );
    if (best) take(best);
  }

  return chosen.map((p) => ({
    from: p.a.slug,
    to: p.b.slug,
    type: "RELATED_TOPIC" as const,
    reason: p.reason,
    confidence: Math.round(Math.min(0.9, 0.35 + p.score * 0.07) * 100) / 100,
    basis: "evidence_overlap" as const,
  }));
}

export function buildRelationsReport(
  specs: TopicSpec[],
  catalog: TopicCatalogEntry[],
  footprints: Map<string, TopicFootprint> = new Map(),
): RelationReport {
  const known = new Set([
    ...specs.map((s) => s.slug),
    ...catalog.map((c) => c.slug),
  ]);
  const out: TopicRelationInput[] = [];
  const rejected: RelationRejection[] = [];
  const buildsKeys = new Set<string>();
  const buildsAdj = new Map<string, Set<string>>();
  const relatedFirstDirection = new Map<string, string>();

  const reaches = (from: string, to: string): boolean => {
    const stack = [from];
    const visited = new Set<string>();
    while (stack.length) {
      const node = stack.pop() as string;
      if (node === to) return true;
      if (visited.has(node)) continue;
      visited.add(node);
      for (const next of buildsAdj.get(node) ?? []) stack.push(next);
    }
    return false;
  };
  const reject = (
    from: string,
    to: string,
    type: RelationRejection["type"],
    reason: string,
  ) => rejected.push({ from, to, type, reason });

  for (const spec of specs) {
    for (const target of spec.buildsOn) {
      if (target === spec.slug) {
        reject(spec.slug, target, "BUILDS_ON", "self-reference");
        continue;
      }
      if (!known.has(target)) {
        reject(spec.slug, target, "BUILDS_ON", "unknown target");
        continue;
      }
      const detail = (spec.buildsOnDetail ?? []).find((d) => d.slug === target);
      const reason = detail?.reason ?? "";
      if (!isSpecificRationale(reason)) {
        reject(
          spec.slug,
          target,
          "BUILDS_ON",
          "no specific reason from the model",
        );
        continue;
      }
      const key = `${spec.slug}>${target}`;
      if (buildsKeys.has(key)) {
        reject(spec.slug, target, "BUILDS_ON", "duplicate");
        continue;
      }
      if (buildsKeys.has(`${target}>${spec.slug}`)) {
        reject(
          spec.slug,
          target,
          "BUILDS_ON",
          "conflicts with the opposite BUILDS_ON edge",
        );
        continue;
      }
      if (reaches(target, spec.slug)) {
        reject(
          spec.slug,
          target,
          "BUILDS_ON",
          "would create a BUILDS_ON cycle",
        );
        continue;
      }
      buildsKeys.add(key);
      const adj = buildsAdj.get(spec.slug) ?? new Set<string>();
      adj.add(target);
      buildsAdj.set(spec.slug, adj);
      out.push({
        from: spec.slug,
        to: target,
        type: "BUILDS_ON",
        reason,
        confidence: detail?.confidence ?? 0.7,
        strength: detail?.strength ?? "helpful",
        basis: "llm_inferred",
      });
    }
  }

  for (const spec of specs) {
    for (const target of spec.related) {
      if (target === spec.slug) {
        reject(spec.slug, target, "RELATED_TOPIC", "self-reference");
        continue;
      }
      if (!known.has(target)) {
        reject(spec.slug, target, "RELATED_TOPIC", "unknown target");
        continue;
      }
      if (
        buildsKeys.has(`${spec.slug}>${target}`) ||
        buildsKeys.has(`${target}>${spec.slug}`)
      ) {
        reject(
          spec.slug,
          target,
          "RELATED_TOPIC",
          "already linked by BUILDS_ON",
        );
        continue;
      }
      const detail = (spec.relatedDetail ?? []).find((d) => d.slug === target);
      const reason = detail?.reason ?? "";
      if (!isSpecificRationale(reason)) {
        reject(
          spec.slug,
          target,
          "RELATED_TOPIC",
          "no specific reason from the model",
        );
        continue;
      }
      const key = [spec.slug, target].sort().join("~");
      const first = relatedFirstDirection.get(key);
      if (first !== undefined) {
        reject(
          spec.slug,
          target,
          "RELATED_TOPIC",
          first === `${spec.slug}>${target}`
            ? "duplicate"
            : "reciprocal (RELATED_TOPIC is stored symmetric already)",
        );
        continue;
      }
      relatedFirstDirection.set(key, `${spec.slug}>${target}`);
      out.push({
        from: spec.slug,
        to: target,
        type: "RELATED_TOPIC",
        reason,
        confidence: detail?.confidence ?? 0.7,
        basis: "llm_inferred",
      });
    }
  }

  let fromEvidence = 0;
  for (const r of deriveEvidenceRelations(specs, footprints)) {
    const key = [r.from, r.to].sort().join("~");
    if (relatedFirstDirection.has(key)) continue;
    if (
      buildsKeys.has(`${r.from}>${r.to}`) ||
      buildsKeys.has(`${r.to}>${r.from}`)
    )
      continue;
    relatedFirstDirection.set(key, `${r.from}>${r.to}`);
    out.push(r);
    fromEvidence += 1;
  }

  console.log("[depth-agent] canonical topic relations", {
    specs: specs.length,
    catalogTopics: catalog.length,
    buildsOn: out.filter((r) => r.type === "BUILDS_ON").length,
    related: out.filter((r) => r.type === "RELATED_TOPIC").length,
    fromEvidence,
    rejected: rejected.length,
  });
  return { relations: out, rejected };
}

export function buildRelations(
  specs: TopicSpec[],
  catalog: TopicCatalogEntry[],
  footprints: Map<string, TopicFootprint> = new Map(),
): TopicRelationInput[] {
  return buildRelationsReport(specs, catalog, footprints).relations;
}

const discoveryCache = new Map<
  string,
  { fp: string; discovery: DiscoveryResult }
>();
const judgementCache = new Map<
  string,
  { fp: string; evidence: TopicEvidence; judgement: Judgement }
>();

const atlasFingerprint = (a: EvidenceAtlas): string =>
  [
    a.totals.files,
    a.totals.commits,
    a.totals.lastSeen,
    a.packages.length,
    a.capabilities.length,
  ].join("|");

const evidenceFingerprint = (ev: TopicEvidence): string =>
  JSON.stringify([
    ev.spec.slug,
    ev.spec.packages.join(","),
    ev.spec.keywords.join(","),
    ev.totals,
    ev.approaches.map((a) => [a.slug, a.files, a.commits]),
    ev.demonstrations.length,
    ev.baseline.score,
  ]);

export async function analyzeDeveloperDepth(
  graph: Graph,
  developerId: string,
  options: DepthAnalyzerOptions,
): Promise<DepthAnalysisResult> {
  if (!developerId) throw new Error("Missing developerId");
  const startedAt = Date.now();
  const buildId = `${startedAt}-${Math.random().toString(36).slice(2, 10)}`;
  const onProgress = options.onProgress ?? (() => {});
  const maxTopics = Math.min(Math.max(options.maxTopics ?? 12, 1), 30);
  const gateway = makeGateway(options);
  const usedFallback: string[] = [];

  log("=== depth analysis: START ===", {
    developerId,
    buildId,
    model: gateway.model,
    maxTopics,
    force: options.force === true,
  });
  onProgress("depth_start", { developerId });

  await ensureDepthSchema(graph);

  const atlas = await readEvidenceAtlas(graph, developerId, onProgress);
  if (!atlas) throw new Error(`Unknown developer ${developerId}`);
  const catalog = await listTopicCatalog(graph, 200);

  onProgress("depth_discovering", { packages: atlas.packages.length });
  const discoveryKey = `${developerId}:${maxTopics}`;
  const fp = atlasFingerprint(atlas);
  const cachedDiscovery = options.force
    ? undefined
    : discoveryCache.get(discoveryKey);
  let discovery: DiscoveryResult;
  if (cachedDiscovery && cachedDiscovery.fp === fp) {
    discovery = cachedDiscovery.discovery;
    log("discovery reused (code unchanged)", {
      topics: discovery.topics.length,
    });
  } else {
    discovery = await discoverTopics(
      gateway,
      atlas,
      catalog,
      maxTopics,
      usedFallback,
    );
    if (discovery.topics.length > 0 && gateway.failures.length === 0)
      discoveryCache.set(discoveryKey, { fp, discovery });
  }
  onProgress("depth_topics_proposed", { count: discovery.topics.length });

  const gathered = await mapPool(
    discovery.topics,
    options.gatherConcurrency ?? 6,
    async (spec) => {
      const evidence = await gatherTopicEvidence(graph, atlas, spec);
      onProgress("depth_evidence_gathered", {
        topic: spec.slug,
        files: evidence.totals.files,
        baseline: evidence.baseline.level,
      });
      return evidence;
    },
  );

  const dropped = [...discovery.dropped];
  const live: TopicEvidence[] = [];
  for (const ev of gathered) {
    if (ev.matched) live.push(ev);
    else
      dropped.push({
        slug: ev.spec.slug,
        reason: "the graph found no matching authored code",
      });
  }

  live.sort((a, b) => b.totals.files - a.totals.files);

  let refinements = 0;
  const footprints = new Map<string, TopicFootprint>();
  const assessments = await mapPool(
    live,
    options.judgeConcurrency ?? 4,
    async (ev): Promise<DepthAssessmentRecord> => {
      const key = `${developerId}:${ev.spec.slug}`;
      const evFp = evidenceFingerprint(ev);
      const hit = options.force ? undefined : judgementCache.get(key);
      let judged: {
        evidence: TopicEvidence;
        judgement: Judgement | null;
        refined: number;
      };
      if (hit && hit.fp === evFp) {
        judged = {
          evidence: hit.evidence,
          judgement: hit.judgement,
          refined: 0,
        };
      } else {
        judged = await judgeTopic(
          graph,
          gateway,
          atlas,
          ev,
          options.maxRefinements ?? 1,
          onProgress,
        );
        if (judged.judgement)
          judgementCache.set(key, {
            fp: evFp,
            evidence: judged.evidence,
            judgement: judged.judgement,
          });
      }
      refinements += judged.refined;
      if (!judged.judgement) usedFallback.push(`judge: ${ev.spec.slug}`);
      if (judged.evidence.footprint)
        footprints.set(ev.spec.slug, judged.evidence.footprint);
      const record = reconcile(
        judged.evidence,
        judged.judgement,
        gateway.model,
      );
      onProgress("depth_topic_assessed", {
        topic: record.topic.slug,
        level: record.level,
        score: record.score,
        authenticity: record.authenticity,
      });
      return record;
    },
  );

  assessments.sort((a, b) => a.topic.name.localeCompare(b.topic.name));

  const finalSpecs = assessments.map((a) => a.spec);
  const coverage = computeCoverage(
    atlas,
    finalSpecs,
    maxTopics,
    discovery.topics,
  );

  const relationReport = buildRelationsReport(finalSpecs, catalog, footprints);

  const summaryPromise: Promise<DepthProfileSummary> =
    options.synthesize === false
      ? Promise.resolve(deterministicSummary(assessments))
      : synthesize(gateway, assessments);

  let metrics: TopicGraphMetrics | null = null;
  let storage: DepthDiagnostics["storage"] = null;
  let summary: DepthProfileSummary;
  if (options.persist !== false && assessments.length > 0) {
    const [s, stored] = await Promise.all([
      summaryPromise,
      storeDepthAssessments(graph, {
        developerId,
        buildId,
        model: gateway.model,
        assessments,
        relations: relationReport.relations,
        replaceAll: true,
      }),
    ]);
    summary = s;
    storage = {
      mappings: stored.mappings,
      unresolvedMappings: stored.unresolvedMappings,
      relationsRequested: stored.relationsRequested,
      relationsPersisted: stored.relations,
      rejectedRelations: stored.rejectedRelations,
    };
    await storeDepthProfileSummary(graph, developerId, summary);
    if (options.refreshMetrics !== false) {
      metrics = await refreshTopicGraphMetrics(graph);
    }
  } else {
    summary = await summaryPromise;
  }

  const diagnostics: DepthDiagnostics = {
    rejectedCapabilityIds: discovery.rejectedCapabilityIds,
    rejectedKeywords: discovery.rejectedKeywords,
    domainCorrections: discovery.domainCorrections,
    discoveryCoverage: discovery.coverage,
    coverage,
    rejectedRelations: relationReport.rejected,
    storage,
  };

  const result: DepthAnalysisResult = {
    developerId,
    buildId,
    model: gateway.model,
    topicsDiscovered: discovery.topics.length,
    topicsAssessed: assessments.length,
    dropped,
    assessments,
    summary,
    metrics,
    diagnostics,
    llmCalls: gateway.calls,
    llmFailures: gateway.failures,
    llmCircuitOpen: gateway.open,
    usedFallback,
    refinements,
    durationMs: Date.now() - startedAt,
  };
  onProgress("depth_complete", {
    topics: assessments.length,
    llmCalls: gateway.calls,
    durationMs: result.durationMs,
  });
  log("=== depth analysis: COMPLETE ===", {
    topics: assessments.length,
    dropped: dropped.length,
    llmCalls: gateway.calls,
    llmFailures: gateway.failures.length,
    circuitOpen: gateway.open,
    fallbacks: usedFallback.length,
    capabilitiesMapped: `${coverage.mappedCapabilities}/${coverage.atlasCapabilities}`,
    coverageComplete: coverage.complete,
    rejectedCapabilityIds: diagnostics.rejectedCapabilityIds.length,
    rejectedKeywordTopics: diagnostics.rejectedKeywords.length,
    mappingsWritten: storage?.mappings ?? null,
    relationsPersisted: storage?.relationsPersisted ?? null,
    durationMs: result.durationMs,
  });
  return result;
}

export async function relinkTopicTaxonomy(
  graph: Graph,
  developerId: string,
  options: { onProgress?: ProgressFn } = {},
): Promise<{
  topics: number;
  relationsProposed: number;
  relationsPersisted: number;
  rejected: number;
  metricsStatus: string;
}> {
  const onProgress = options.onProgress ?? (() => {});
  await ensureDepthSchema(graph);

  const profile = await readDeveloperTopicProfile(graph, developerId);
  const specs = (
    await Promise.all(
      profile.topics.map((t) =>
        readStoredTopicSpec(graph, developerId, t.slug),
      ),
    )
  ).filter((s): s is TopicSpec => Boolean(s));
  if (specs.length === 0)
    return {
      topics: 0,
      relationsProposed: 0,
      relationsPersisted: 0,
      rejected: 0,
      metricsStatus: "no assessed topics",
    };

  const atlas = await readEvidenceAtlas(graph, developerId, onProgress, {
    cacheMs: 60_000,
  });
  if (!atlas) throw new Error(`Unknown developer ${developerId}`);

  const footprints = new Map<string, TopicFootprint>();
  await mapPool(specs, 6, async (spec) => {
    const ev = await gatherTopicEvidence(graph, atlas, spec);
    if (ev.footprint) footprints.set(spec.slug, ev.footprint);
  });

  const catalog = await listTopicCatalog(graph, 200);
  const report = buildRelationsReport(specs, catalog, footprints);
  const outcome = await writeTopicRelations(graph, report.relations, {
    now: new Date().toISOString(),
    buildId: `relink-${Date.now()}`,
    model: "evidence_overlap",
  });
  const metrics = await refreshTopicGraphMetrics(graph);
  log("topics relinked", {
    topics: specs.length,
    proposed: report.relations.length,
    persisted: outcome.persisted,
    rejected: outcome.rejected.length,
    metrics: metrics.status,
  });
  return {
    topics: specs.length,
    relationsProposed: report.relations.length,
    relationsPersisted: outcome.persisted,
    rejected: outcome.rejected.length + report.rejected.length,
    metricsStatus: metrics.status,
  };
}

export async function reanalyzeTopicDepth(
  graph: Graph,
  developerId: string,
  topicSlug: string,
  options: DepthAnalyzerOptions,
): Promise<DepthAssessmentRecord> {
  const onProgress = options.onProgress ?? (() => {});
  const gateway = makeGateway(options);
  const slug = slugify(topicSlug);

  await ensureDepthSchema(graph);
  const spec = await readStoredTopicSpec(graph, developerId, slug);
  if (!spec) throw new Error(`No stored assessment for topic "${slug}"`);

  const atlas = await readEvidenceAtlas(graph, developerId, onProgress);
  if (!atlas) throw new Error(`Unknown developer ${developerId}`);

  const evidence = await gatherTopicEvidence(graph, atlas, spec);
  const judged = await judgeTopic(
    graph,
    gateway,
    atlas,
    evidence,
    options.maxRefinements ?? 1,
    onProgress,
  );
  const record = reconcile(judged.evidence, judged.judgement, gateway.model);

  if (options.persist !== false) {
    await storeDepthAssessments(graph, {
      developerId,
      buildId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      model: gateway.model,
      assessments: [record],
      relations: [],
      replaceAll: false,
    });
    if (options.refreshMetrics !== false) await refreshTopicGraphMetrics(graph);
  }
  return record;
}

export {
  findTopicsByText,
  readDeveloperTopicProfile,
  readTopicDepthDetail,
  refreshTopicGraphMetrics,
};
export type {
  DepthAssessmentRecord,
  DepthLevel,
  DepthProfileSummary,
  Authenticity,
  Confidence,
  TopicSpec,
};
export { levelForScore };

// ============================================================
// PLAIN-LANGUAGE EXPLAINER (turns graph facts into a human story)
// ============================================================

export interface TopicExplanation {
  headline: string;
  summary: string;
  steps: Array<{ title: string; text: string }>;
  meaning: string;
  caveat: string;
  followups: string[];
  /** wording for "observed" proof-ledger entries, keyed by ledger id */
  items: Array<{ id: string; demonstrates: string; matters: string }>;
  prerequisiteSummary: string;
  confidenceNote: string;
}

const EXPLAIN_SYSTEM = `You are Pathway's explainer. You receive FACTS about ONE topic from a developer's own code and must explain them to a NON-TECHNICAL reader (a recruiter, a manager, or a junior developer).

RULES
1. Use ONLY the facts given. Never invent projects, numbers, skills, repositories, files or dates. If a fact is empty or zero, say plainly that nothing was found.
2. No jargon. Never use these words: PageRank, betweenness, centrality, Cypher, FalkorDB, node, edge, hop, traversal, taxonomy, algorithm, graph query. Say "skill", "real work", "project", "foundation", "related topic" instead.
3. Short sentences. Write to "you" (the developer) when natural.
4. Be fair and honest: say what is proven and what is NOT. Low confidence must be stated plainly.
5. "steps" are 3 or 4 items that walk the reader through the evidence in this order: what was found, which skills it covers, where it fits among other topics, where the work lives. Each text is 1-2 sentences. In the skills step, say how many skills are seen in your code, how many are only inferred and how many are only linked.
6. "meaning" explains in one sentence what the level means for this person. "caveat" is the single most important limit.
7. "followups" are 3 short questions the reader could ask next about THIS topic.
8. PROOF. "proofLedger" lists skills with a class: "observed" (seen in the developer's own code), "inferred" (concluded from the topic rating, no example matched) or "association" (only linked in the topic map). "cited" holds the real code titles, paths and projects. For every ledger entry whose class is "observed" write one item {"id","demonstrates","matters"}: "demonstrates" is ONE sentence saying what the cited work shows, using only the words in "cited" (name the project or file when given); "matters" is ONE sentence on why that is useful evidence. If "practiceOnly" is true say it comes from a practice mission, not from your own project. Do NOT write items for "inferred" or "association" entries, and never describe them as something the developer built or did.
9. PREREQUISITES. "prerequisitePaths" are genuine foundation chains (each step needs the next). "status" is demonstrated (backed by your code), weak (shallow) or unverified (not assessed). Write "prerequisiteSummary" in 1-2 sentences naming the chain and its weakest link. Never present "usedTogetherWith" as a prerequisite; related topics are only associations.
10. CONFIDENCE. "confidenceDetail" has the confidence level with its strengths and limits. Write "confidenceNote" as ONE sentence that says why confidence is at that level, using both the amount and the variety of evidence (projects, kinds of evidence, repeat work). Do not contradict the level.
11. Output minified JSON on one line. No commentary, no code fences.

Return ONLY this JSON:
{"headline":"one short sentence","summary":"2-3 plain sentences","steps":[{"title":"3-5 words","text":""}],"meaning":"","caveat":"","followups":["","",""],"items":[{"id":"","demonstrates":"","matters":""}],"prerequisiteSummary":"","confidenceNote":""}`;

const explainCache = new Map<string, { at: number; value: TopicExplanation }>();
const EXPLAIN_TTL_MS = 10 * 60_000;

export async function explainTopicEvidence(
  llm: DepthLlm,
  facts: Row,
  cacheKey: string,
): Promise<TopicExplanation | null> {
  const hit = explainCache.get(cacheKey);
  if (hit && Date.now() - hit.at < EXPLAIN_TTL_MS) return hit.value;

  const gateway = new LlmGateway(llm, 1, 0, 2);
  const raw = await gateway.json({
    stage: "explain",
    system: EXPLAIN_SYSTEM,
    user: `FACTS:\n${JSON.stringify(facts)}`,
    maxTokens: 2400,
    temperature: 0.2,
  });
  if (!raw) return null;

  const steps = asObjects(raw.steps)
    .slice(0, 4)
    .map((s) => ({ title: asStr(s.title, 80), text: asStr(s.text, 340) }))
    .filter((s) => s.title && s.text);

  // only ids that exist in the facts we sent, and only observed entries
  const observedIds = new Set(
    asObjects(facts.proofLedger)
      .filter((x) => x.class === "observed")
      .map((x) => asStr(x.id, 80)),
  );
  const items = asObjects(raw.items)
    .map((x) => ({
      id: asStr(x.id, 80),
      demonstrates: asStr(x.demonstrates, 320),
      matters: asStr(x.matters, 260),
    }))
    .filter((x) => x.id && observedIds.has(x.id));

  const out: TopicExplanation = {
    headline: asStr(raw.headline, 200),
    summary: asStr(raw.summary, 600),
    steps,
    meaning: asStr(raw.meaning, 300),
    caveat: asStr(raw.caveat, 300),
    followups: asList(raw.followups, 3, 140),
    items,
    prerequisiteSummary: asStr(raw.prerequisiteSummary, 360),
    confidenceNote: asStr(raw.confidenceNote, 300),
  };
  if (!out.headline || !out.summary || out.steps.length < 2) return null;

  explainCache.set(cacheKey, { at: Date.now(), value: out });
  if (explainCache.size > 200) {
    const oldest = explainCache.keys().next().value;
    if (oldest) explainCache.delete(oldest);
  }
  return out;
}
