import { createHash, randomUUID } from "node:crypto";
import type { Graph } from "../db/falkordb.js";
import {
  SKILL_TAXONOMY,
  matchesSkill,
  type SkillDefinition,
} from "./skill-category-graph.js";

type AnyObject = Record<string, any>;
export type ProgressFn = (stage: string, detail?: AnyObject) => void;

export interface AddedLine {
  // was: interface AddedLine
  line: number;
  text: string;
}

const LOG_PREFIX = "[overview-graph]";

function positiveIntegerEnv(
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

const DB_BATCH_SIZE = positiveIntegerEnv("FALKORDB_BATCH_SIZE", 500);
const EVIDENCE_PAGE_SIZE = positiveIntegerEnv(
  "DEMONSTRATION_PAGE_SIZE",
  200,
  10,
);

// Patches / added code are cut inside the database so huge diffs never cross
// the wire. Signal rules only need the first part of a diff.
const MAX_PATCH_SCAN_CHARS = 60_000;

const MAX_SNIPPET_CHARS = 700;
const SNIPPET_LINES_BEFORE = 2;
const SNIPPET_LINES_AFTER = 8;

const RECENT_DAYS = 60;
const HISTORICAL_DAYS = 180;

// ============================================================
// SMALL HELPERS (extract into a shared graph-utils.ts when convenient)
// ============================================================

function log(message: string, detail?: AnyObject): void {
  if (detail !== undefined) console.log(`${LOG_PREFIX} ${message}`, detail);
  else console.log(`${LOG_PREFIX} ${message}`);
}

function safeString(value: unknown): string {
  return value == null ? "" : String(value);
}

function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

type QueryPrimitive = string | number | boolean | null;
type QueryParamObject = Record<string, QueryPrimitive>;

function asQueryParams<T extends object>(items: T[]): QueryParamObject[] {
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

async function queryRows(
  graph: Graph,
  query: string,
  params: AnyObject = {},
): Promise<AnyObject[]> {
  const result = await graph.query(query, { params });
  return (result.data ?? []) as AnyObject[];
}

/**
 * Runs one write query over `rows` in batches and returns how many rows it
 * actually wrote.
 *
 * The query MUST end with `RETURN count(<var>) AS n` and take its rows from
 * `$batch`. Every query passed here should do ONE job (one edge type, or one
 * node upsert). Keeping them separate is the point: in a long
 * `MATCH ... MATCH ... MERGE` chain a single failed MATCH silently drops the
 * row for every later step. Here a miss only affects that one write, and the
 * shortfall is logged instead of vanishing.
 */
async function runCounted(
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

// ============================================================
// CAPABILITY TAXONOMY  (what was demonstrated)
//
// Two kinds of node, and the difference matters for recommendations:
//
//   LEARNABLE capability  parentId !== null. A specific, evidence-checkable
//                         engineering ability. Developer evidence
//                         (HAS_CAPABILITY) is produced for these by SIGNAL_RULES.
//                         Only these take part in PREREQUISITE_OF / RELATED_TO,
//                         can be required by a Goal, and can be recommended.
//
//   CATEGORY (domain)     parentId === null. A label that groups learnable
//                         capabilities through SPECIALIZES. It has no rule of
//                         its own, so it can never be "demonstrated" and must
//                         never be a prerequisite. rollUpDemonstrations() still
//                         writes a HAS_CAPABILITY roll-up on a domain, but that
//                         is for the profile view only.
//
//   CONCEPT               (:Concept) created from goal text by registerConcepts().
//                         basis = "inferred". It has no rule, so it can never be
//                         demonstrated and never gates a prerequisite. It only
//                         shows up as a connected opportunity.
//
// VERIFIED vs INFERRED
//   verified  HAS_CAPABILITY / DEMONSTRATED edges, produced from the
//             developer's own code. Nothing else counts as evidence.
//   declared  structural edges written in this file (basis = "declared").
//   inferred  anything guessed from goal text or similarity (basis = "inferred").
// ============================================================

export interface CapabilityDefinition {
  id: string;
  name: string;
  parentId: string | null;
  description: string;
}

const domain = (
  id: string,
  name: string,
  description: string,
): CapabilityDefinition => ({ id, name, parentId: null, description });

const capability = (
  id: string,
  name: string,
  parentId: string,
  description: string,
): CapabilityDefinition => ({ id, name, parentId, description });

export const CAPABILITIES: CapabilityDefinition[] = [
  domain(
    "concurrency_control",
    "Concurrency & Consistency",
    "Keeping shared state correct under concurrent access.",
  ),
  capability(
    "distributed_locking",
    "Distributed locking",
    "concurrency_control",
    "Mutual exclusion across processes or nodes.",
  ),
  capability(
    "transactional_integrity",
    "Transactional integrity",
    "concurrency_control",
    "Atomic multi-step writes and row-level locking.",
  ),
  capability(
    "optimistic_concurrency",
    "Optimistic concurrency",
    "concurrency_control",
    "Version-checked updates that detect lost writes.",
  ),
  capability(
    "idempotent_operations",
    "Idempotent operations",
    "concurrency_control",
    "Operations that are safe to repeat.",
  ),

  domain(
    "async_processing",
    "Asynchronous Processing",
    "Moving work off the request path and across service boundaries.",
  ),
  capability(
    "job_queues",
    "Job queues & workers",
    "async_processing",
    "Producer/consumer background job processing.",
  ),
  capability(
    "event_messaging",
    "Broker-based messaging",
    "async_processing",
    "Publishing and consuming events through a broker.",
  ),
  capability(
    "webhook_handling",
    "Webhook handling",
    "async_processing",
    "Receiving third-party callbacks safely.",
  ),

  domain(
    "reliability",
    "Reliability & Resilience",
    "Behaving well when dependencies are slow, limited, or failing.",
  ),
  capability(
    "retry_backoff",
    "Retry with backoff",
    "reliability",
    "Bounded, spaced retries of failing calls.",
  ),
  capability(
    "rate_limit_handling",
    "Rate-limit handling",
    "reliability",
    "Detecting and respecting upstream rate limits.",
  ),
  capability(
    "timeouts_cancellation",
    "Timeouts & cancellation",
    "reliability",
    "Bounding and aborting slow operations.",
  ),

  domain(
    "caching",
    "Caching & Performance",
    "Trading memory for latency without serving wrong data.",
  ),
  capability(
    "application_caching",
    "Application caching",
    "caching",
    "Cache with expiry, invalidation, and stampede protection.",
  ),

  domain(
    "realtime",
    "Real-time Delivery",
    "Pushing state to clients as it changes.",
  ),
  capability(
    "websocket_channels",
    "WebSocket channels",
    "realtime",
    "Bidirectional connections with rooms, auth, and scaling.",
  ),

  domain(
    "api_engineering",
    "API Design & Security",
    "Building trustworthy request boundaries.",
  ),
  capability(
    "api_design",
    "REST API design",
    "api_engineering",
    "Resource-oriented HTTP endpoints with a clear request/response contract.",
  ),
  capability(
    "input_validation",
    "Input validation",
    "api_engineering",
    "Schema validation at trust boundaries.",
  ),
  capability(
    "authn_authz",
    "Authentication & authorization",
    "api_engineering",
    "Token/session auth, password hashing, permission checks.",
  ),
  capability(
    "rate_limiting",
    "Server-side rate limiting",
    "api_engineering",
    "Protecting endpoints from excessive use.",
  ),

  domain(
    "data_layer",
    "Data Layer Engineering",
    "Schema evolution, bulk writes, and query design.",
  ),
  capability(
    "schema_migrations",
    "Schema migrations",
    "data_layer",
    "Evolving a database schema safely.",
  ),
  capability(
    "batched_writes",
    "Batched bulk writes",
    "data_layer",
    "Writing many records without per-row round trips.",
  ),
  capability(
    "graph_modeling",
    "Graph modeling & traversal",
    "data_layer",
    "Relationship-centric data models and Cypher traversal.",
  ),

  domain(
    "frontend_delivery",
    "Frontend Delivery",
    "How pages are rendered, cached, and made discoverable.",
  ),
  capability(
    "rendering_strategies",
    "Rendering strategies",
    "frontend_delivery",
    "SSG/ISR/SSR/streaming choices in a framework.",
  ),
];

export const CAPABILITY_BY_ID = new Map(CAPABILITIES.map((c) => [c.id, c]));

/** The nodes that can be demonstrated, required by a goal, and recommended. */
export const LEARNABLE_CAPABILITIES = CAPABILITIES.filter(
  (c) => c.parentId !== null,
);

/** Category nodes: grouping labels only. Never a prerequisite, never a target. */
export const CATEGORY_CAPABILITIES = CAPABILITIES.filter(
  (c) => c.parentId === null,
);

export const isLearnableCapability = (id: string): boolean =>
  CAPABILITY_BY_ID.get(id)?.parentId != null;

// ============================================================
// ENGINEERING CONTEXT  (where in the system + why it changed)
// ============================================================

export interface EngineeringContextDefinition {
  id: string;
  name: string;
  pattern: RegExp | null;
}

// First match wins, so keep specific layers above generic ones.
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

const DEFAULT_CONTEXT = ENGINEERING_CONTEXTS[ENGINEERING_CONTEXTS.length - 1];

const CHANGE_INTENTS: Array<{ id: string; pattern: RegExp }> = [
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

// ============================================================
// SIGNAL RULES  (how it is detected)
//
// A rule is NOT a keyword. It is a composition:
//   - allOf: every group must match; inside a group any regex may match
//     (AND of ORs), so "worker" alone never fires — an import AND a
//     consumer/producer call AND ... must co-occur.
//   - excludeIf: if ANY of these match the added code, the rule does not fire.
//     Use it when another capability's code looks like this one (for example
//     a Redis-backed rate limiter calls `.consume()`, which is not broker
//     messaging).
//   - matching runs on ADDED, NON-COMMENT lines of non-test files only.
//   - tier:  "usage"          = a primitive is used
//            "implementation" = a composed mechanism is built
//   - modifiers: hardening behaviours actually observed in the same diff.
//     Every two raise the depth one step, capped at "strong"
//     (usage + 2 -> implementation, usage + 4 or implementation + 2 -> strong).
//   - modifierWindow: when set, modifiers only count if they appear within
//     this many lines of the anchor line. Without it a modifier can come from
//     unrelated code elsewhere in the same file diff (for example an HTTP
//     retry loop being credited to a lock). Set it on rules whose modifiers
//     are easy to confuse with neighbouring code.
//
// To extend: add one rule. Keep regexes free of the `g` flag. Every modifier
// label is a candidate safeguard in COMPLETION_CRITERIA below.
// ============================================================

export type DemonstrationDepth = "usage" | "implementation" | "strong";

interface ModifierRule {
  label: string;
  pattern: RegExp;
}

interface UsesRule {
  skillId: string; // must match a Skill.id from SKILL_TAXONOMY
  when?: RegExp; // tested against `${path}\n${addedCode}`
}

export interface SignalRule {
  id: string;
  capabilityId: string;
  technique: string;
  tier: "usage" | "implementation";
  allOf: RegExp[][];
  anchor: RegExp; // single-line regex used to locate the snippet
  pathPatterns?: RegExp[];
  excludeIf?: RegExp[];
  modifierWindow?: number;
  modifiers?: ModifierRule[];
  uses?: UsesRule[];
}

// Matches: from "pkg", require("pkg"), import("pkg"), import "pkg"
const imp = (pkgs: string): RegExp =>
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

  // ---------------- Caching ----------------
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

  // ---------------- Real-time ----------------
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

  // ---------------- API design & security ----------------
  {
    id: "rest_route_handlers",
    capabilityId: "api_design",
    technique: "REST route handlers",
    tier: "implementation",
    allOf: [
      // a server framework (or a Next.js route-handler export) ...
      [
        imp(
          "express|fastify|hono|koa|@koa/router|@hapi/hapi|@nestjs/common|next/server",
        ),
        /\bexport\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)\b/,
      ],
      // ... with HTTP-verb routes ...
      [
        /\b(?:router|app|fastify|server|api)\.(?:get|post|put|patch|delete)\s*\(\s*['"`]\//,
        /@(?:Get|Post|Put|Patch|Delete)\s*\(/,
        /\bexport\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)\b/,
      ],
      // ... that actually answer the request.
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

  // ---------------- Data layer ----------------
  {
    id: "migration_files",
    capabilityId: "schema_migrations",
    technique: "Schema migration",
    tier: "usage",
    pathPatterns: [/(?:^|\/)(?:migrations?|migrate)\//i, /\.sql$/i],
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

  // ---------------- Frontend delivery ----------------
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

export function parseAddedLines(patch: string): AddedLine[] {
  const out: AddedLine[] = [];
  let newLine = 0;

  for (const raw of patch.replace(/\r\n/g, "\n").split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }

    if (newLine === 0) continue; // anything before the first hunk header

    if (raw.startsWith("+")) {
      out.push({ line: newLine, text: raw.slice(1) });
      newLine += 1;
    } else if (raw.startsWith("-") || raw.startsWith("\\")) {
      // deleted line / "\ No newline at end of file": new-file counter unchanged
    } else {
      newLine += 1; // context line
    }
  }

  return out;
}

const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*\/|\*(?!\w)|#(?![[!])|--\s|<!--)/;

const TEST_PATH =
  /(?:^|\/)(?:__tests__|__mocks__|tests?|specs?|e2e|fixtures?|mocks?|stories)\/|\.(?:test|spec|stories)\.[cm]?[jt]sx?$/i;

function dedent(lines: string[]): string {
  const indents = lines
    .filter((l) => l.trim().length > 0)
    .map((l) => (/^\s*/.exec(l) as RegExpExecArray)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join("\n");
}

/** Added lines of a non-test file, comments and blanks removed. Shared by the detectors and the LLM scout. */
export function eligibleAddedLines(
  fc: Pick<EvidenceInput, "path" | "patch">,
): AddedLine[] {
  if (!fc.patch || TEST_PATH.test(fc.path)) return [];
  return parseAddedLines(fc.patch).filter(
    (l) => l.text.trim().length > 0 && !COMMENT_LINE.test(l.text),
  );
}

// ============================================================
// EXTRACTION  (FileChange -> Demonstrations)
// ============================================================

export interface EvidenceInput {
  id: string; // FileChange.id
  path: string;
  language: string;
  patch: string;
  addedCode: string; // FileChange.added_code, used for skill -> repository attribution
  commitSha: string;
  repositoryId: string;
  createdAt: string;
}

export interface EvidenceContext {
  repositoryFullName: string;
  commitMessage: string;
}

export interface Demonstration {
  id: string;
  ruleId: string;
  capabilityId: string;
  technique: string;
  modifiers: string[];
  depth: DemonstrationDepth;
  summary: string;

  fileChangeId: string;
  repositoryId: string;
  commitSha: string;
  path: string;
  language: string;
  startLine: number;
  endLine: number;
  snippet: string;
  permalink: string;

  layerId: string;
  layerName: string;
  intent: string;
  commitSubject: string;

  usesSkillIds: string[];
  createdAt: string;
}

const DEPTH_RANK: Record<DemonstrationDepth, number> = {
  usage: 1,
  implementation: 2,
  strong: 3,
};

function depthFor(
  tier: SignalRule["tier"],
  modifierCount: number,
): DemonstrationDepth {
  // tier sets the floor; every two hardening behaviours raise it one step.
  const rank = Math.min(
    3,
    (tier === "usage" ? 1 : 2) + Math.floor(modifierCount / 2),
  );
  return rank >= 3 ? "strong" : rank === 2 ? "implementation" : "usage";
}

/** A usable range is two positive integers with start <= end; otherwise null. */
export function validLineRange(
  start: unknown,
  end: unknown,
): { start: number; end: number } | null {
  const a = Number(start);
  const b = Number(end);
  if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
  if (a < 1 || b < a) return null;
  return { start: a, end: b };
}

function buildPermalink(
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
  const added = eligibleAddedLines(fc);
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

    const rawWindow = added.slice(
      Math.max(0, anchorIndex - SNIPPET_LINES_BEFORE),
      anchorIndex + SNIPPET_LINES_AFTER,
    );
    // Keep only the run around the anchor whose line numbers are close, so a
    // snippet never spans separate hunks and the range matches the text shown.
    const anchorPos = rawWindow.findIndex((l) => l === added[anchorIndex]);
    let lo = anchorPos;
    let hi = anchorPos;
    const GAP = 3;
    while (lo > 0 && rawWindow[lo].line - rawWindow[lo - 1].line <= GAP)
      lo -= 1;
    while (
      hi < rawWindow.length - 1 &&
      rawWindow[hi + 1].line - rawWindow[hi].line <= GAP
    )
      hi += 1;
    const windowLines = rawWindow.slice(lo, hi + 1);
    const range = validLineRange(
      windowLines[0].line,
      windowLines[windowLines.length - 1].line,
    );
    // An invalid range means no line anchor: skip the demonstration rather
    // than store start_line 0 or end < start.
    if (!range) continue;
    const startLine = range.start;
    const endLine = range.end;

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


// ------------------------------------------------------------
// LLM-DISCOVERED DEMONSTRATIONS
//
// The model only proposes a claim. The Demonstration is rebuilt here from the
// REAL added lines, so snippet, range, permalink, commit, repository and
// FileChange come from stored data, never from model text.
//   - capability must be an existing LEARNABLE capability
//   - range must be valid, <= MAX_DISCOVERED_SPAN, and contain added lines
//   - the quote must appear verbatim (whitespace-insensitive) in those lines
//   - technique is the capability name (stable identity, no free text)
//   - modifiers are empty and ruleId is "llm_discovery:<capability>", so these
//     never satisfy a COMPLETION_CRITERIA safeguard (those need real rules)
//   - depth is capped at "implementation", never "strong"
// ------------------------------------------------------------

export const LLM_RULE_PREFIX = "llm_discovery:";
const MAX_DISCOVERED_SPAN = 40;
const squash = (s: string): string => s.replace(/\s+/g, " ").trim();

export interface DiscoveredClaimInput {
  capabilityId: string;
  startLine: number;
  endLine: number;
  quote: string;
  depth?: string;
  rationale?: string;
}

export function buildDiscoveredDemonstration(
  fc: EvidenceInput,
  ctx: EvidenceContext,
  claim: DiscoveredClaimInput,
): Demonstration | null {
  const cap = CAPABILITY_BY_ID.get(claim.capabilityId);
  if (!cap || cap.parentId === null) return null;

  const range = validLineRange(claim.startLine, claim.endLine);
  if (!range || range.end - range.start + 1 > MAX_DISCOVERED_SPAN) return null;

  const lines = eligibleAddedLines(fc).filter(
    (l) => l.line >= range.start && l.line <= range.end,
  );
  if (lines.length === 0) return null;

  const quote = squash(claim.quote);
  if (quote.length < 8) return null;
  if (!squash(lines.map((l) => l.text).join("\n")).includes(quote)) return null;

  const startLine = lines[0].line;
  const endLine = lines[lines.length - 1].line;
  let snippet = dedent(lines.map((l) => l.text)).trim();
  if (snippet.length > MAX_SNIPPET_CHARS) {
    snippet = `${snippet.slice(0, MAX_SNIPPET_CHARS)}\n…`;
  }

  const context = deriveContext(fc.path, ctx.commitMessage);
  const rationale = squash(claim.rationale ?? "").slice(0, 200);

  return {
    id: `${fc.id}::llm:${cap.id}`,
    ruleId: `${LLM_RULE_PREFIX}${cap.id}`,
    capabilityId: cap.id,
    technique: cap.name,
    modifiers: [],
    depth: claim.depth === "implementation" ? "implementation" : "usage",
    summary: rationale ? `${cap.name} — ${rationale}` : cap.name,

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

    usesSkillIds: [],
    createdAt: fc.createdAt,
  };
}

// ============================================================
// COMPLETION CRITERIA  (what "done well" looks like, per technique)
//
// A SIGNAL_RULE says a mechanism was SEEN. A TechniqueSpec says what a
// SUCCESSFUL implementation of that mechanism contains, and each Safeguard is
// one hardening behaviour that must (required) or should (optional) be
// observed. Every safeguard points at the label of a rule modifier, so it is
// always checkable against real code evidence: a criterion nothing can observe
// would make a capability impossible to complete, and validateCompletionCriteria()
// rejects it.
//
// This is the single source of truth for the TechniqueSpec / Safeguard nodes.
// The journey-graph schema seeder should read COMPLETION_CRITERIA from here
// instead of keeping its own copy, and should key its seeding stamp on
// CAPABILITY_DEFINITIONS_VERSION (defined with the capability graph below).
//
// COMPLETION SEMANTICS (evaluateCapabilityCompletion)
//   - A technique is met when a demonstration of ITS rule reached
//     minimumDepth AND every required safeguard was observed in demonstrations
//     of that rule. Evidence from another rule never counts: a retry loop
//     proves retry_with_backoff, it does not prove a lock.
//   - A capability is complete when AT LEAST ONE of its techniques is met
//     (techniques of one capability are alternative ways to do it).
//   - Optional safeguards never block completion; they are reported so the
//     developer can see how to strengthen the work.
// ============================================================

export interface SafeguardDefinition {
  id: string;
  name: string;
  /** Why this safeguard matters: the failure it prevents. */
  why: string;
  /** Exact label of a modifier on the technique's SIGNAL_RULE. */
  modifierLabel: string;
  required: boolean;
}

export interface TechniqueSpecDefinition {
  id: string;
  capabilityId: string;
  /** The SIGNAL_RULE whose demonstrations are the only evidence for this spec. */
  ruleId: string;
  name: string;
  description: string;
  minimumDepth: DemonstrationDepth;
  safeguards: SafeguardDefinition[];
}

type SafeguardTuple = [modifierLabel: string, why: string, required: boolean];

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

function techniqueSpec(
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

export const COMPLETION_CRITERIA_BY_CAPABILITY = new Map<
  string,
  TechniqueSpecDefinition[]
>(
  LEARNABLE_CAPABILITIES.map((c) => [
    c.id,
    COMPLETION_CRITERIA.filter((spec) => spec.capabilityId === c.id),
  ]),
);

export interface SafeguardStatus {
  id: string;
  name: string;
  required: boolean;
  observed: boolean;
}

export interface TechniqueCompletion {
  specId: string;
  name: string;
  ruleId: string;
  met: boolean;
  depthReached: boolean;
  safeguards: SafeguardStatus[];
  missingRequired: string[];
}

export interface CapabilityCompletion {
  capabilityId: string;
  complete: boolean;
  techniques: TechniqueCompletion[];
}

/**
 * Pure. Decides whether a capability is complete from demonstrations that
 * carry `ruleId`, `depth` and `modifiers`. Only demonstrations of a spec's own
 * rule are considered for that spec.
 */
export function evaluateCapabilityCompletion(
  capabilityId: string,
  demos: Demonstration[],
): CapabilityCompletion {
  const specs = COMPLETION_CRITERIA_BY_CAPABILITY.get(capabilityId) ?? [];

  const techniques = specs.map((spec): TechniqueCompletion => {
    const own = demos.filter((d) => d.ruleId === spec.ruleId);
    const observed = new Set(own.flatMap((d) => d.modifiers ?? []));
    const best = own.reduce(
      (rank, d) => Math.max(rank, DEPTH_RANK[d.depth] ?? 0),
      0,
    );
    const depthReached = best >= DEPTH_RANK[spec.minimumDepth];

    const safeguards = spec.safeguards.map((s) => ({
      id: s.id,
      name: s.name,
      required: s.required,
      observed: observed.has(s.modifierLabel),
    }));
    const missingRequired = safeguards
      .filter((s) => s.required && !s.observed)
      .map((s) => s.name);

    return {
      specId: spec.id,
      name: spec.name,
      ruleId: spec.ruleId,
      met: own.length > 0 && depthReached && missingRequired.length === 0,
      depthReached,
      safeguards,
      missingRequired,
    };
  });

  return {
    capabilityId,
    complete: techniques.some((t) => t.met),
    techniques,
  };
}

// ============================================================
// ENGINEERING EXPERIENCE  (Demonstrations -> grouped engineering memory)
//
// Demonstrations are atomic evidence. Experiences are the durable memory
// object built by grouping demonstrations that represent the same engineering
// mechanism. The grouping is deterministic and stable across syncs: capability
// + technique form the candidate identity. Engineering context is attached as
// a relationship on the Experience rather than defining its identity, so the
// same engineering experience can span application logic, request pipelines,
// services, etc. We intentionally do not include repository or commit, so
// repeated work across repositories strengthens one experience instead of
// creating duplicate experiences.
//
// IDENTITY IS DEVELOPER-SCOPED. The fingerprint (capability + technique) is
// the same for every developer, but the node id is
// `exp:<developerId>:<fingerprint>` so two developers never share (and never
// overwrite or delete) one Experience node. Problem nodes are scoped the same
// way because their statement is derived from that developer's commit
// subjects. Technique / Technology / Capability nodes carry only taxonomy
// names, so they stay shared.
//
// Experience graph:
//   Developer -[:EXPERIENCED]-> Experience
//   Experience -[:SOLVES]-> Problem
//   Experience -[:DEMONSTRATES_CAPABILITY]-> Capability
//   Experience -[:USES_TECHNIQUE]-> Technique
//   Experience -[:USES_TECHNOLOGY]-> Technology
//   Experience -[:OCCURS_IN]-> Repository
//   Experience -[:IN_CONTEXT]-> EngineeringContext
//   Experience -[:EVIDENCED_BY]-> FileChange
//   Experience -[:SUPPORTED_BY]-> Demonstration
//
// No LLM is required for grouping. This keeps the memory graph reproducible,
// inspectable, and safe to rebuild on every GitHub sync.
// ============================================================

export interface EngineeringExperience {
  id: string;
  fingerprint: string;
  summary: string;
  problemStatement: string;
  problemId: string;
  capabilityId: string;
  technique: string;
  technologyIds: string[];
  repositoryIds: string[];
  contextIds: string[];
  evidenceCount: number;
  commitCount: number;
  repoCount: number;
  activeDays: number;
  bestDepth: DemonstrationDepth;
  firstSeen: string;
  lastSeen: string;
  demonstrationIds: string[];
  fileChangeIds: string[];
  buildId?: string;
}

// Only map technologies we can identify from the existing skill matcher.
// A skill is not automatically a technology; this allowlist is deliberately
// conservative and avoids inventing technologies from generic skill labels.
const TECHNOLOGY_NAMES: Record<string, string> = {
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

function normalizeExperiencePart(value: string): string {
  return safeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function hashExperienceFingerprint(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

function experienceFingerprintFor(d: Demonstration): string {
  const raw = [
    normalizeExperiencePart(d.capabilityId),
    normalizeExperiencePart(d.technique),
  ].join("|");
  return hashExperienceFingerprint(raw);
}

function problemFingerprintFor(d: Demonstration): string {
  return hashExperienceFingerprint(
    [
      normalizeExperiencePart(d.capabilityId),
      normalizeExperiencePart(d.intent || "change"),
    ].join("|"),
  );
}

function techniqueIdFor(technique: string): string {
  return `technique:${hashExperienceFingerprint(normalizeExperiencePart(technique))}`;
}

function representativeProblemFor(
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

function buildExperienceSummary(demos: Demonstration[]): string {
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

function buildEngineeringExperiences(
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

/**
 * Writes Experiences and all their edges.
 *
 * Every node upsert and every edge type is its own query (see runCounted), so
 * a missing Repository / FileChange / Demonstration / EngineeringContext only
 * skips that one edge and is logged, instead of silently dropping the row
 * from every step after it.
 */
async function storeEngineeringExperiences(
  graph: Graph,
  developerId: string,
  buildId: string,
  demos: Demonstration[],
): Promise<EngineeringExperience[]> {
  const experiences = buildEngineeringExperiences(demos, buildId, developerId);
  const scope = { developer_id: developerId };

  // 1) Experience nodes.
  await runCounted(
    graph,
    "Experience nodes",
    `
    UNWIND $batch AS item
    MERGE (e:Experience {id: item.id})
    SET e.fingerprint = item.fingerprint,
        e.summary = item.summary,
        e.problem_statement = item.problem_statement,
        e.capability_id = item.capability_id,
        e.technique = item.technique,
        e.evidence_count = item.evidence_count,
        e.commit_count = item.commit_count,
        e.repo_count = item.repo_count,
        e.active_days = item.active_days,
        e.best_depth = item.best_depth,
        e.first_seen = item.first_seen,
        e.last_seen = item.last_seen,
        e.build_id = item.build_id,
        e.developer_id = $developer_id
    RETURN count(e) AS n
    `,
    experiences.map((e) => ({
      id: e.id,
      fingerprint: e.fingerprint,
      summary: e.summary,
      problem_statement: e.problemStatement,
      capability_id: e.capabilityId,
      technique: e.technique,
      evidence_count: e.evidenceCount,
      commit_count: e.commitCount,
      repo_count: e.repoCount,
      active_days: e.activeDays,
      best_depth: e.bestDepth,
      first_seen: e.firstSeen,
      last_seen: e.lastSeen,
      build_id: buildId,
    })),
    scope,
    true,
  );

  // 2) Developer -> Experience.
  await runCounted(
    graph,
    "EXPERIENCED edges",
    `
    UNWIND $batch AS item
    MATCH (d:Developer {id: $developer_id})
    MATCH (e:Experience {id: item.experience_id})
    MERGE (d)-[r:EXPERIENCED]->(e)
    RETURN count(r) AS n
    `,
    experiences.map((e) => ({ experience_id: e.id })),
    scope,
    true,
  );

  // 3) Experience -> Capability.
  await runCounted(
    graph,
    "DEMONSTRATES_CAPABILITY edges",
    `
    UNWIND $batch AS item
    MATCH (e:Experience {id: item.experience_id})
    MATCH (c:Capability {id: item.capability_id})
    MERGE (e)-[r:DEMONSTRATES_CAPABILITY]->(c)
    RETURN count(r) AS n
    `,
    experiences.map((e) => ({
      experience_id: e.id,
      capability_id: e.capabilityId,
    })),
    true,
  );

  // 4) Experience -> Technique (shared taxonomy node, name only).
  await runCounted(
    graph,
    "USES_TECHNIQUE edges",
    `
    UNWIND $batch AS item
    MATCH (e:Experience {id: item.experience_id})
    MERGE (t:Technique {id: item.technique_id})
    SET t.name = item.technique
    MERGE (e)-[r:USES_TECHNIQUE]->(t)
    RETURN count(r) AS n
    `,
    experiences.map((e) => ({
      experience_id: e.id,
      technique_id: techniqueIdFor(e.technique),
      technique: e.technique,
    })),
    true,
  );

  // 5) Experience -> Problem (developer-scoped: statement comes from this
  //    developer's commit subjects).
  await runCounted(
    graph,
    "SOLVES edges",
    `
    UNWIND $batch AS item
    MATCH (e:Experience {id: item.experience_id})
    MERGE (p:Problem {id: item.problem_id})
    SET p.statement = item.problem_statement,
        p.capability_id = item.capability_id,
        p.developer_id = $developer_id
    MERGE (e)-[r:SOLVES]->(p)
    RETURN count(r) AS n
    `,
    experiences.map((e) => ({
      experience_id: e.id,
      problem_id: e.problemId,
      problem_statement: e.problemStatement,
      capability_id: e.capabilityId,
    })),
    scope,
    true,
  );

  // 6) Experience -> EngineeringContext.
  await runCounted(
    graph,
    "IN_CONTEXT edges",
    `
    UNWIND $batch AS item
    MATCH (e:Experience {id: item.experience_id})
    MATCH (ctx:EngineeringContext {id: item.context_id})
    MERGE (e)-[r:IN_CONTEXT]->(ctx)
    RETURN count(r) AS n
    `,
    experiences.flatMap((e) =>
      e.contextIds.map((contextId) => ({
        experience_id: e.id,
        context_id: contextId,
      })),
    ),
    true,
  );

  // 7) Experience -> Demonstration. Built straight from each experience's own
  //    id lists, so there is no per-row lookup into `demos`.
  await runCounted(
    graph,
    "SUPPORTED_BY edges",
    `
    UNWIND $batch AS item
    MATCH (e:Experience {id: item.experience_id})
    MATCH (x:Demonstration {id: item.demonstration_id})
    MERGE (e)-[r:SUPPORTED_BY]->(x)
    RETURN count(r) AS n
    `,
    experiences.flatMap((e) =>
      e.demonstrationIds.map((demonstrationId) => ({
        experience_id: e.id,
        demonstration_id: demonstrationId,
      })),
    ),
    true,
  );

  // 8) Experience -> FileChange.
  await runCounted(
    graph,
    "Experience EVIDENCED_BY edges",
    `
    UNWIND $batch AS item
    MATCH (e:Experience {id: item.experience_id})
    MATCH (fc:FileChange {id: item.file_change_id})
    MERGE (e)-[r:EVIDENCED_BY]->(fc)
    RETURN count(r) AS n
    `,
    experiences.flatMap((e) =>
      e.fileChangeIds.map((fileChangeId) => ({
        experience_id: e.id,
        file_change_id: fileChangeId,
      })),
    ),
    true,
  );

  // 9) Experience -> Repository.
  await runCounted(
    graph,
    "OCCURS_IN edges",
    `
    UNWIND $batch AS item
    MATCH (e:Experience {id: item.experience_id})
    MATCH (r:Repository {id: item.repository_id})
    MERGE (e)-[o:OCCURS_IN]->(r)
    RETURN count(o) AS n
    `,
    experiences.flatMap((e) =>
      e.repositoryIds.map((repositoryId) => ({
        experience_id: e.id,
        repository_id: repositoryId,
      })),
    ),
    true,
  );

  // 10) Experience -> Technology (allowlisted).
  await runCounted(
    graph,
    "USES_TECHNOLOGY edges",
    `
    UNWIND $batch AS item
    MATCH (e:Experience {id: item.experience_id})
    MERGE (t:Technology {id: item.technology_id})
    SET t.name = item.technology_name
    MERGE (e)-[r:USES_TECHNOLOGY]->(t)
    RETURN count(r) AS n
    `,
    experiences.flatMap((e) =>
      e.technologyIds.map((technologyId) => ({
        experience_id: e.id,
        technology_id: technologyId,
        technology_name: TECHNOLOGY_NAMES[technologyId],
      })),
    ),
    true,
  );

  return experiences;
}

/**
 * Removes this developer's Experiences from older builds (this also retires
 * any legacy un-scoped `exp:<fingerprint>` nodes the developer was linked to),
 * then removes Problem nodes nothing points at any more.
 */
async function cleanupStaleExperiences(
  graph: Graph,
  developerId: string,
  buildId: string,
): Promise<void> {
  await graph.query(
    `
    MATCH (d:Developer {id: $developer_id})-[:EXPERIENCED]->(e:Experience)
    WHERE coalesce(e.build_id, "") <> $build_id
    DETACH DELETE e
    `,
    { params: { developer_id: developerId, build_id: buildId } },
  );

  // Only this developer's Problems, plus un-scoped legacy ones, and only when
  // no Experience references them.
  await graph.query(
    `
    MATCH (p:Problem)
    WHERE coalesce(p.developer_id, $developer_id) = $developer_id
      AND NOT (p)<-[:SOLVES]-(:Experience)
    DELETE p
    `,
    { params: { developer_id: developerId } },
  );
}

export async function getEngineeringExperiences(
  graph: Graph,
  developerId: string,
  limit = 50,
): Promise<Array<AnyObject>> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 200);
  return queryRows(
    graph,
    `
    MATCH (d:Developer {id: $developer_id})-[:EXPERIENCED]->(e:Experience)
    OPTIONAL MATCH (e)-[:SOLVES]->(p:Problem)
    OPTIONAL MATCH (e)-[:DEMONSTRATES_CAPABILITY]->(c:Capability)
    OPTIONAL MATCH (e)-[:USES_TECHNIQUE]->(t:Technique)
    OPTIONAL MATCH (e)-[:USES_TECHNOLOGY]->(tech:Technology)
    OPTIONAL MATCH (e)-[:OCCURS_IN]->(r:Repository)
    OPTIONAL MATCH (e)-[:IN_CONTEXT]->(ctx:EngineeringContext)
    RETURN e.id AS id,
           e.fingerprint AS fingerprint,
           e.summary AS summary,
           p.statement AS problem,
           c.id AS capability_id,
           c.name AS capability,
           collect(DISTINCT t.name) AS techniques,
           collect(DISTINCT tech.name) AS technologies,
           collect(DISTINCT r.full_name) AS repositories,
           collect(DISTINCT ctx.name) AS contexts,
           e.evidence_count AS evidence_count,
           e.commit_count AS commit_count,
           e.repo_count AS repo_count,
           e.best_depth AS best_depth,
           e.first_seen AS first_seen,
           e.last_seen AS last_seen
    ORDER BY evidence_count DESC, last_seen DESC
    LIMIT ${safeLimit}
    `,
    { developer_id: developerId },
  );
}

// ============================================================
// ROLL-UP  (Demonstrations -> per-capability level)
//
// No blended score. Level is read off the strongest observed behaviour
// and whether it was repeated, exactly as raw counts sit beside it.
// ============================================================

export type CapabilityLevel =
  | "insufficient_evidence"
  | "usage"
  | "repeated_usage"
  | "implementation"
  | "strong";

export type Recency = "recent" | "historical" | "inactive";

// ============================================================
// EVIDENCE STATE  (what a roll-up level means for progress)
//
//   demonstrated  the developer built it: level implementation or strong.
//   partial       evidence exists, but only as use of a primitive:
//                 level usage or repeated_usage. Real, and not yet enough.
//   unverified    nothing found, or a single lone sighting
//                 (insufficient_evidence). This means "Pathway cannot tell",
//                 never "the developer cannot do it".
//
// Only the states in PREREQUISITE_SATISFIED_BY unlock the capabilities that
// depend on a capability. It is "demonstrated" only, so partial evidence never
// unlocks a next step by itself. Change it here and the frontier follows.
// Skills do not expire: recency is shown to the developer, never used to
// revoke a demonstrated capability.
//
// "demonstrated" is NOT "goal complete". Completion needs explicit criteria
// (TechniqueSpec + Safeguard nodes, defined by COMPLETION_CRITERIA above and
// judged by evaluateCapabilityCompletion()): see isGoalComplete() in
// developer-journey-graph.ts.
// ============================================================

export type EvidenceState = "demonstrated" | "partial" | "unverified";

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

/** Unknown or stale level strings count as unverified, never as achieved. */
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

export interface CapabilityRollup {
  capabilityId: string;
  level: CapabilityLevel;
  recency: Recency;
  bestDepth: DemonstrationDepth;
  evidenceCount: number;
  commitCount: number;
  repoCount: number;
  techniqueCount: number;
  activeDays: number;
  firstSeen: string;
  lastSeen: string;
  techniquesJson: string;
}

const commitKey = (d: Demonstration): string =>
  `${d.repositoryId}:${d.commitSha}`;

function recencyFor(lastSeenTs: number, now: number): Recency {
  if (!lastSeenTs) return "historical";
  const days = (now - lastSeenTs) / 86_400_000;
  if (days <= RECENT_DAYS) return "recent";
  if (days <= HISTORICAL_DAYS) return "historical";
  return "inactive";
}

function summarise(
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

/** Rolls demonstrations up per capability AND per parent domain. */
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

export interface GoalDefinition {
  id: string;
  name: string;
  description: string;
  /**
   * Parts of the goal text the capability list cannot express. A goal with
   * anything unsupported can never be reported complete: Pathway cannot judge it.
   */
  unsupported?: string[];
}

export interface GoalRequirement {
  capabilityId: string;
  priority?: number;
  reason?: string;
}

export interface DeveloperGoal {
  id: string;
  name: string;
  description: string;
  requirements: Array<{
    capabilityId: string;
    capabilityName: string;
    priority: number;
    reason: string;
    level: CapabilityLevel | "missing";
    evidenceCount: number;
    lastSeen: string;
  }>;
}

export interface CapabilityGap {
  capabilityId: string;
  capabilityName: string;
  priority: number;
  reason: string;
  currentLevel: CapabilityLevel | "missing";
  evidenceCount: number;
  graphDistance: number;
  capabilityPath: string[];
  pathRelationships: string[];
  bridgeCapabilityId: string;
  bridgeCapabilityName: string;
  gapScore: number;
}

const GOAL_INDEXES: Array<{ label: string; property: string }> = [
  { label: "Goal", property: "id" },
  { label: "Concept", property: "id" },
];

export interface CapabilityRelationship {
  from: string;
  to: string;
  type: "PREREQUISITE_OF" | "RELATED_TO";
  weight: number;
  /** Required for PREREQUISITE_OF (why it is a real dependency). Optional note for RELATED_TO. */
  reason: string;
}

// ------------------------------------------------------------
// DEPENDENCY AUDIT
//
// One entry per LEARNABLE capability. `requires` lists its real prerequisites
// with the reason each is necessary. An empty list is a valid, deliberate
// answer and must say why (`noPrerequisiteReason`).
//
// "Demonstrable" is not written by hand: validateCapabilityGraph() fails if a
// prerequisite has no SIGNAL_RULE, because a prerequisite nothing can
// demonstrate would block its dependents forever.
//
// Decisions worth knowing (each was a prerequisite or a RELATED_TO before):
//   - input_validation, authn_authz: used on CLI input, env, webhooks and
//     server components too, so they do not need a REST API first. RELATED_TO.
//   - websocket_channels: auth is a hardening safeguard of a socket server
//     (COMPLETION_CRITERIA), not something a socket cannot exist without.
//   - optimistic_concurrency: one conditional UPDATE; it needs no transaction.
//   - retry_backoff / rate_limit_handling / timeouts_cancellation: retrying
//     works on error responses with no timeout, and a 429 wait works with a
//     fixed Retry-After sleep. They reinforce each other; none blocks another.
//   - application_caching and distributed_locking: stampede protection can use
//     a lock, but a cache without one is a complete cache. RELATED_TO only.
// ------------------------------------------------------------

export interface CapabilityDependency {
  requires: Array<{ capabilityId: string; reason: string }>;
  noPrerequisiteReason?: string;
}

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

const prerequisite = (
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

const related = (
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

/** PREREQUISITE_OF edges, derived from the audit so the two cannot disagree. */
const DECLARED_PREREQUISITES: CapabilityRelationship[] = Object.entries(
  CAPABILITY_DEPENDENCIES,
).flatMap(([capabilityId, dep]) =>
  dep.requires.map((req) =>
    prerequisite(req.capabilityId, capabilityId, req.reason),
  ),
);

/** Contextual links only. None of these affects eligibility. */
const DECLARED_RELATIONS: CapabilityRelationship[] = [
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

/** Longest prerequisite chain the frontier query will follow. */
export const MAX_PREREQUISITE_DEPTH = 10;

/**
 * Fingerprint of every definition that ends up in the graph (taxonomy,
 * relationships with reasons, completion criteria). Store it as the seeding
 * stamp: a seeder that sees the same version already written can skip, and one
 * that sees a different version knows the stored graph is stale.
 */
export function capabilityDefinitionsVersion(
  relationships: readonly CapabilityRelationship[] = CAPABILITY_GRAPH_RELATIONSHIPS,
): string {
  const payload = JSON.stringify({
    capabilities: CAPABILITIES,
    relationships,
    criteria: COMPLETION_CRITERIA,
  });
  return createHash("sha1").update(payload).digest("hex").slice(0, 16);
}

export const CAPABILITY_DEFINITIONS_VERSION = capabilityDefinitionsVersion();

const CAPABILITY_SCHEMA_NODE_ID = "capability-graph";

export interface CapabilityGraphProblem {
  code:
    | "unknown_capability"
    | "self_loop"
    | "category_endpoint"
    | "duplicate_edge"
    | "conflicting_edge_types"
    | "prerequisite_cycle"
    | "path_too_deep"
    | "no_evidence_rule"
    | "missing_reason"
    | "invalid_parent"
    | "dependency_audit_missing"
    | "dependency_audit_invalid"
    | "criteria_unknown_rule"
    | "criteria_unknown_safeguard"
    | "criteria_missing"
    | "criteria_depth_unreachable"
    | "criteria_duplicate";
  message: string;
}

/**
 * Pure check of the completion criteria against the detection rules. A
 * safeguard must point at a real modifier of its own rule, and the depth a
 * technique asks for must be reachable with the modifiers that exist.
 */
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

/**
 * Pure check of a relationship list against the taxonomy, the dependency audit
 * and the detection rules. Returns every problem found; an empty list means
 * the map is safe to write and safe to traverse.
 */
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

export async function ensureGoalIndexes(graph: Graph): Promise<void> {
  for (const { label, property } of GOAL_INDEXES) {
    try {
      await graph.query(`CREATE INDEX FOR (n:${label}) ON (n.${property})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/already\s+(exists|indexed)/i.test(message)) {
        log(`index creation failed for ${label}.${property}`, { message });
      }
    }
  }
}

/**
 * True when the graph was last fully seeded from exactly these definitions.
 * Only a COMPLETE seeding writes the stamp (it is the last write), so an
 * interrupted run leaves it stale and the next call re-seeds.
 */
export async function isCapabilityGraphCurrent(
  graph: Graph,
  relationships: readonly CapabilityRelationship[] = CAPABILITY_GRAPH_RELATIONSHIPS,
): Promise<boolean> {
  const rows = await queryRows(
    graph,
    `
    MATCH (s:CapabilitySchema {id: $id})
    RETURN s.version AS version
    `,
    { id: CAPABILITY_SCHEMA_NODE_ID },
  );
  return (
    safeString(rows[0]?.version) === capabilityDefinitionsVersion(relationships)
  );
}

/**
 * Makes the stored capability map equal to the one in this file:
 *   1. taxonomy nodes and SPECIALIZES (domain membership) are upserted,
 *   2. PREREQUISITE_OF / RELATED_TO edges are upserted (with reasons),
 *   3. any structural edge that is no longer declared is DELETED,
 *   4. a version stamp is written LAST.
 *
 * Idempotent: every write is a MERGE + SET, so running it twice, or after a
 * crash half-way, converges on the same graph. Nothing is cached here, so a
 * failure is simply retried by calling it again.
 *
 * Step 3 matters: MERGE alone never removes anything, so an edge removed or
 * corrected in this file would otherwise keep shaping recommendations forever.
 * Only structural edges are removed; edges with basis = "inferred" (written by
 * other code) are left alone. Legacy edges with no basis count as stale.
 *
 * Writes are strict (runCounted): a row that matches nothing aborts the run
 * before cleanup and before the stamp, so a half-seeded graph is never
 * mistaken for a current one.
 *
 * An invalid map (see validateCapabilityGraph / validateCompletionCriteria) is
 * rejected before any write.
 */
export async function ensureCapabilityGraph(
  graph: Graph,
  relationships: readonly CapabilityRelationship[] = CAPABILITY_GRAPH_RELATIONSHIPS,
): Promise<void> {
  const problems = [
    ...validateCapabilityGraph(relationships),
    ...validateCompletionCriteria(),
  ];
  if (problems.length > 0) {
    throw new Error(
      `Invalid capability graph:\n${problems
        .map((p) => `- [${p.code}] ${p.message}`)
        .join("\n")}`,
    );
  }

  const nodeRows = CAPABILITIES.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    parent_id: c.parentId ?? "",
  }));

  // 1) Taxonomy nodes, then domain membership.
  await runCounted(
    graph,
    "Capability nodes",
    `
    UNWIND $batch AS item
    MERGE (c:Capability {id: item.id})
    SET c.name = item.name,
        c.description = item.description,
        c.parent_id = item.parent_id
    RETURN count(c) AS n
    `,
    nodeRows,
    true,
  );

  await runCounted(
    graph,
    "SPECIALIZES edges",
    `
    UNWIND $batch AS item
    MATCH (c:Capability {id: item.id})
    MATCH (p:Capability {id: item.parent_id})
    MERGE (c)-[r:SPECIALIZES]->(p)
    SET r.weight = 1,
        r.basis = "declared"
    RETURN count(r) AS n
    `,
    nodeRows.filter((r) => r.parent_id),
    true,
  );

  // 2) Prerequisites and related links, one query per edge type.
  const edgeRow = (r: CapabilityRelationship) => ({
    from: r.from,
    to: r.to,
    weight: r.weight,
    reason: r.reason,
  });

  await runCounted(
    graph,
    "PREREQUISITE_OF edges",
    `
    UNWIND $batch AS item
    MATCH (a:Capability {id: item.from})
    MATCH (b:Capability {id: item.to})
    MERGE (a)-[r:PREREQUISITE_OF]->(b)
    SET r.weight = item.weight,
        r.basis = "declared",
        r.reason = item.reason
    RETURN count(r) AS n
    `,
    relationships.filter((r) => r.type === "PREREQUISITE_OF").map(edgeRow),
    true,
  );

  await runCounted(
    graph,
    "RELATED_TO edges",
    `
    UNWIND $batch AS item
    MATCH (a:Capability {id: item.from})
    MATCH (b:Capability {id: item.to})
    MERGE (a)-[r:RELATED_TO]->(b)
    SET r.weight = item.weight,
        r.basis = "declared",
        r.reason = item.reason
    MERGE (b)-[reverse:RELATED_TO]->(a)
    SET reverse.weight = item.weight,
        reverse.basis = "declared",
        reverse.reason = item.reason
    RETURN count(reverse) AS n
    `,
    relationships.filter((r) => r.type === "RELATED_TO").map(edgeRow),
    true,
  );

  // 2b) Technique specs and safeguards: what "done well" looks like.
  //     Shared taxonomy nodes (no developer data), seeded from
  //     COMPLETION_CRITERIA, which is the single source of truth.
  const specRows = COMPLETION_CRITERIA.map((s) => ({
    id: s.id,
    capability_id: s.capabilityId,
    rule_id: s.ruleId,
    name: s.name,
    description: s.description,
    minimum_depth: s.minimumDepth,
  }));

  const safeguardRows = COMPLETION_CRITERIA.flatMap((s) =>
    s.safeguards.map((g) => ({
      id: g.id,
      spec_id: s.id,
      name: g.name,
      why: g.why,
      modifier_label: g.modifierLabel,
      required: g.required,
    })),
  );

  await runCounted(
    graph,
    "TechniqueSpec nodes",
    `
    UNWIND $batch AS item
    MERGE (t:TechniqueSpec {id: item.id})
    SET t.capability_id = item.capability_id,
        t.rule_id = item.rule_id,
        t.name = item.name,
        t.description = item.description,
        t.minimum_depth = item.minimum_depth
    RETURN count(t) AS n
    `,
    specRows,
    true,
  );

  await runCounted(
    graph,
    "HAS_TECHNIQUE_SPEC edges",
    `
    UNWIND $batch AS item
    MATCH (c:Capability {id: item.capability_id})
    MATCH (t:TechniqueSpec {id: item.id})
    MERGE (c)-[r:HAS_TECHNIQUE_SPEC]->(t)
    SET r.basis = "declared"
    RETURN count(r) AS n
    `,
    specRows,
    true,
  );

  await runCounted(
    graph,
    "Safeguard nodes",
    `
    UNWIND $batch AS item
    MERGE (g:Safeguard {id: item.id})
    SET g.name = item.name,
        g.why = item.why,
        g.modifier_label = item.modifier_label,
        g.required = item.required
    RETURN count(g) AS n
    `,
    safeguardRows,
    true,
  );

  await runCounted(
    graph,
    "HAS_SAFEGUARD edges",
    `
    UNWIND $batch AS item
    MATCH (t:TechniqueSpec {id: item.spec_id})
    MATCH (g:Safeguard {id: item.id})
    MERGE (t)-[r:HAS_SAFEGUARD]->(g)
    SET r.basis = "declared",
        r.required = item.required
    RETURN count(r) AS n
    `,
    safeguardRows,
    true,
  );

  // 3) Remove what is no longer declared.
  const declared: Array<[string, string[]]> = [
    [
      "PREREQUISITE_OF",
      relationships
        .filter((r) => r.type === "PREREQUISITE_OF")
        .map((r) => `${r.from}>${r.to}`),
    ],
    [
      "RELATED_TO",
      relationships
        .filter((r) => r.type === "RELATED_TO")
        .flatMap((r) => [`${r.from}>${r.to}`, `${r.to}>${r.from}`]),
    ],
    [
      "SPECIALIZES",
      CAPABILITIES.filter((c) => c.parentId).map(
        (c) => `${c.id}>${c.parentId}`,
      ),
    ],
  ];

  for (const [type, keys] of declared) {
    await graph.query(
      `
      MATCH (a:Capability)-[r:${type}]->(b:Capability)
      WHERE NOT (a.id + ">" + b.id) IN $keys
        AND coalesce(r.basis, "") <> "inferred"
      DELETE r
      `,
      { params: { keys } },
    );
  }

  // Specs and safeguards that are no longer declared (renamed or removed in
  // COMPLETION_CRITERIA) must not linger and keep shaping completion checks.
  await graph.query(
    `MATCH (t:TechniqueSpec) WHERE NOT t.id IN $ids DETACH DELETE t`,
    { params: { ids: specRows.map((s) => s.id) } },
  );
  await graph.query(
    `MATCH (g:Safeguard) WHERE NOT g.id IN $ids DETACH DELETE g`,
    { params: { ids: safeguardRows.map((g) => g.id) } },
  );

  // 4) Stamp LAST: it only exists once everything above succeeded.
  await graph.query(
    `
    MERGE (s:CapabilitySchema {id: $id})
    SET s.version = $version,
        s.updated_at = $updated_at
    `,
    {
      params: {
        id: CAPABILITY_SCHEMA_NODE_ID,
        version: capabilityDefinitionsVersion(relationships),
        updated_at: new Date().toISOString(),
      },
    },
  );
}

// ============================================================
// CONCEPT DISCOVERY  (goal text -> inferred nodes, no duplicates)
//
// A goal can name something the taxonomy has no node for (for example
// "refresh token rotation" under authentication). Resolution order:
//   1. an existing Capability with the same id or name  -> reuse, create nothing
//   2. an existing Concept with the same key            -> reuse, create nothing
//   3. otherwise create ONE (:Concept) with basis = "inferred"
//
// A Concept has no SIGNAL_RULE, so it can never be demonstrated and never
// gates a prerequisite. It appears as a "goal_concept" opportunity only.
// The goal can therefore never be called complete just because a concept
// was found: unsupported parts still block completion.
// ============================================================

export interface ConceptProposal {
  name: string;
  /** must be an existing LEARNABLE capability this concept refines */
  parentId: string;
  description?: string;
}

export interface RegisteredConcept {
  id: string;
  name: string;
  /** true only when this call created a new Concept node */
  created: boolean;
  /** which existing node it resolved to, or null when it was newly created */
  existing: "capability" | "concept" | null;
}

export const conceptKey = (name: string): string =>
  safeString(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "_");

/**
 * Pure dedupe + resolution against the taxonomy. Exported so tests can check
 * that an existing capability is reused instead of duplicated.
 */
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

/**
 * Saves the concepts a goal mentions. Call it AFTER setDeveloperGoal(), since
 * the Goal node has to exist. setDeveloperGoal() clears the old MENTIONS edges,
 * so concepts never pile up across goals.
 */
export async function registerConcepts(
  graph: Graph,
  goalId: string,
  proposals: ConceptProposal[],
): Promise<RegisteredConcept[]> {
  const { reuse, create } = resolveConceptProposals(proposals);
  const out: RegisteredConcept[] = reuse.map((r) => ({
    id: r.id,
    name: r.name,
    created: false,
    existing: "capability" as const,
  }));

  await ensureGoalIndexes(graph);

  for (const c of create) {
    const now = new Date().toISOString();
    const id = `concept:${c.key}`;

    const rows = await queryRows(
      graph,
      `
      MATCH (g:Goal {id: $goal_id})
      MATCH (parent:Capability {id: $parent_id})
      MERGE (k:Concept {id: $id})
      ON CREATE SET k.name = $name,
                    k.description = $description,
                    k.basis = "inferred",
                    k.source = "goal_text",
                    k.created_at = $now
      MERGE (g)-[m:MENTIONS]->(k)
      ON CREATE SET m.basis = "inferred"
      MERGE (k)-[r:CANDIDATE_FOR]->(parent)
      ON CREATE SET r.basis = "inferred"
      RETURN k.created_at = $now AS created
      `,
      {
        goal_id: goalId,
        parent_id: c.parentId,
        id,
        name: c.name,
        description: c.description,
        now,
      },
    );

    // No row = the goal or the parent capability does not exist. Nothing saved.
    if (rows.length === 0) continue;

    const created = rows[0]?.created === true;
    out.push({
      id,
      name: c.name,
      created,
      existing: created ? null : ("concept" as const),
    });
  }

  return out;
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

export async function clearDeveloperGoal(
  graph: Graph,
  developerId: string,
): Promise<void> {
  await graph.query(
    `
    MATCH (d:Developer {id: $developer_id})-[r:HAS_GOAL]->(g:Goal)
    DELETE r
    `,
    { params: { developer_id: developerId } },
  );
}

/**
 * Get the active goal plus the evidence-backed state of its requirements.
 */
export async function getDeveloperGoal(
  graph: Graph,
  developerId: string,
): Promise<DeveloperGoal | null> {
  const rows = await queryRows(
    graph,
    `
    MATCH (d:Developer {id: $developer_id})-[:HAS_GOAL]->(g:Goal)
    OPTIONAL MATCH (g)-[req:REQUIRES]->(c:Capability)
    OPTIONAL MATCH (d)-[cap:HAS_CAPABILITY]->(c)
    RETURN g.id AS goal_id,
           g.name AS goal_name,
           coalesce(g.description, "") AS goal_description,
           c.id AS capability_id,
           coalesce(c.name, "") AS capability_name,
           coalesce(req.priority, 0) AS priority,
           coalesce(req.reason, "") AS reason,
           coalesce(cap.level, "missing") AS level,
           coalesce(cap.evidence_count, 0) AS evidence_count,
           coalesce(cap.last_seen, "") AS last_seen
    ORDER BY priority DESC, capability_name ASC
    `,
    { developer_id: developerId },
  );

  if (rows.length === 0) return null;

  const first = rows[0];
  return {
    id: safeString(first.goal_id),
    name: safeString(first.goal_name),
    description: safeString(first.goal_description),
    requirements: rows
      .filter((row) => safeString(row.capability_id))
      .map((row) => ({
        capabilityId: safeString(row.capability_id),
        capabilityName: safeString(row.capability_name),
        priority: safeNumber(row.priority),
        reason: safeString(row.reason),
        level: (safeString(row.level) || "missing") as
          | CapabilityLevel
          | "missing",
        evidenceCount: safeNumber(row.evidence_count),
        lastSeen: safeString(row.last_seen),
      })),
  };
}

/**
 * @deprecated Ranks capabilities by `gapScore`. It must NOT decide what
 * Pathway recommends next: use readFrontier() in developer-journey-graph.ts,
 * which follows PREREQUISITE_OF and developer evidence. Kept only until every
 * caller outside this file has moved over; then delete it with gap-score.ts.
 */
export async function findCapabilityGaps(
  graph: Graph,
  developerId: string,
  limit = 20,
): Promise<CapabilityGap[]> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 100);

  // FalkorDB only supports DIRECTED shortestPath, so we search both
  // directions and keep the shorter path.
  const rows = await queryRows(
    graph,
    `
    MATCH (d:Developer {id: $developer_id})-[:HAS_GOAL]->(g:Goal)
    MATCH (g)-[req:REQUIRES]->(target:Capability)
    OPTIONAL MATCH (d)-[hc:HAS_CAPABILITY]->(target)
    OPTIONAL MATCH (d)-[:HAS_CAPABILITY]->(have:Capability)
    WHERE have.id <> target.id AND have.parent_id <> ""
    WITH target, req, hc, have,
         shortestPath(
           (have)-[:SPECIALIZES|PREREQUISITE_OF|RELATED_TO*1..4]->(target)
         ) AS forward_path,
         shortestPath(
           (have)<-[:SPECIALIZES|PREREQUISITE_OF|RELATED_TO*1..4]-(target)
         ) AS reverse_path
    WITH target, req, hc, have, forward_path, reverse_path,
         CASE
           WHEN forward_path IS NULL THEN reverse_path
           WHEN reverse_path IS NULL THEN forward_path
           WHEN length(forward_path) <= length(reverse_path) THEN forward_path
           ELSE reverse_path
         END AS p
    RETURN target.id AS capability_id,
           target.name AS capability_name,
           req.priority AS priority,
           coalesce(req.reason, "") AS reason,
           coalesce(hc.level, "missing") AS current_level,
           coalesce(hc.evidence_count, 0) AS evidence_count,
           CASE WHEN p IS NULL THEN 99 ELSE length(p) END AS graph_distance,
           CASE
             WHEN p IS NULL THEN []
             ELSE [n IN nodes(p) | n.id]
           END AS capability_path,
           CASE
             WHEN p IS NULL THEN []
             ELSE [r IN relationships(p) | type(r)]
           END AS path_relationships
    `,
    { developer_id: developerId },
  );

  const bestByTarget = new Map<string, AnyObject>();

  for (const row of rows) {
    const capabilityId = safeString(row.capability_id);
    if (!capabilityId) continue;

    let path: string[] = Array.isArray(row.capability_path)
      ? row.capability_path.map(safeString).filter(Boolean)
      : [];
    let rels: string[] = Array.isArray(row.path_relationships)
      ? row.path_relationships.map(safeString).filter(Boolean)
      : [];

    // Always orient the path: demonstrated capability first, target last.
    if (path.length > 1 && path[0] === capabilityId) {
      path = [...path].reverse();
      rels = [...rels].reverse();
    }
    const distance = safeNumber(row.graph_distance) || 99;
    const evidenceCount = safeNumber(row.evidence_count);
    const level = (safeString(row.current_level) || "missing") as
      | CapabilityLevel
      | "missing";

    // Direct evidence closes the gap. Weak evidence still leaves a smaller
    // gap than no evidence, while a nearby demonstrated capability gives the
    // recommendation a graph-grounded bridge.
    const levelPenalty: Record<CapabilityLevel | "missing", number> = {
      missing: 1,
      insufficient_evidence: 0.9,
      usage: 0.7,
      repeated_usage: 0.45,
      implementation: 0.2,
      strong: 0,
    };

    const distancePenalty = distance >= 99 ? 0.15 : 1 / (distance + 1);
    const gapScore =
      safeNumber(row.priority) * 0.4 +
      levelPenalty[level] * 0.45 +
      distancePenalty * 0.15;

    const candidate = {
      ...row,
      path,
      rels,
      distance,
      gapScore,
    };

    // One row per (target, nearby capability). Keep the highest-scoring one,
    // which is the closest demonstrated capability.
    const existing = bestByTarget.get(capabilityId);
    if (!existing || candidate.gapScore > existing.gapScore) {
      bestByTarget.set(capabilityId, candidate);
    }
  }

  const capabilityNameById = new Map(CAPABILITIES.map((c) => [c.id, c.name]));

  return [...bestByTarget.values()]
    .filter((candidate) => candidate.current_level !== "strong")
    .sort((a, b) => b.gapScore - a.gapScore)
    .slice(0, safeLimit)
    .map((candidate) => {
      const path = candidate.path as string[];

      // Bridge = closest specific skill before the target, not a broad group.
      let bridgeId = "";
      for (let i = path.length - 2; i >= 0; i--) {
        if (CAPABILITY_BY_ID.get(path[i])?.parentId) {
          bridgeId = path[i];
          break;
        }
      }
      if (!bridgeId && path.length >= 2) bridgeId = path[path.length - 2];

      return {
        capabilityId: safeString(candidate.capability_id),
        capabilityName: safeString(candidate.capability_name),
        priority: safeNumber(candidate.priority),
        reason: safeString(candidate.reason),
        currentLevel: candidate.current_level as CapabilityLevel | "missing",
        evidenceCount: safeNumber(candidate.evidence_count),
        graphDistance: safeNumber(candidate.distance),
        capabilityPath: path,
        pathRelationships: candidate.rels as string[],
        bridgeCapabilityId: bridgeId,
        bridgeCapabilityName: capabilityNameById.get(bridgeId) ?? bridgeId,
        gapScore: safeNumber(candidate.gapScore),
      };
    });
}
// ============================================================
// INDEXES
// ============================================================

const DEMONSTRATION_INDEXES: Array<{ label: string; property: string }> = [
  { label: "Capability", property: "id" },
  { label: "CapabilitySchema", property: "id" },
  { label: "Demonstration", property: "id" },
  { label: "Topic", property: "id" },
  { label: "Approach", property: "id" },
  { label: "EngineeringContext", property: "id" },
  { label: "Experience", property: "id" },
  { label: "Experience", property: "fingerprint" },
  { label: "Problem", property: "id" },
  { label: "Technique", property: "id" },
  { label: "Technology", property: "id" },
  { label: "TechniqueSpec", property: "id" },
  { label: "Safeguard", property: "id" },
];

// Index creation is idempotent but costs ~12 round trips, so it runs once per
// process. A failed attempt is not cached, so the next run retries.
let demonstrationIndexesReady: Promise<void> | null = null;

function ensureDemonstrationIndexes(graph: Graph): Promise<void> {
  if (!demonstrationIndexesReady) {
    const pending: Promise<void> = createDemonstrationIndexes(graph).catch(
      (error) => {
        if (demonstrationIndexesReady === pending) {
          demonstrationIndexesReady = null;
        }
        throw error;
      },
    );
    demonstrationIndexesReady = pending;
  }
  return demonstrationIndexesReady;
}

async function createDemonstrationIndexes(graph: Graph): Promise<void> {
  for (const { label, property } of DEMONSTRATION_INDEXES) {
    try {
      await graph.query(`CREATE INDEX FOR (n:${label}) ON (n.${property})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/already\s+(exists|indexed)/i.test(message)) {
        log(`index creation failed for ${label}.${property}`, { message });
      }
    }
  }

  // Full-text over what was done and the code that shows it: for direct text matching against demonstrations.
  try {
    await graph.query(
      `CALL db.idx.fulltext.createNodeIndex('Demonstration', 'summary', 'snippet', 'commit_subject')`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already\s+(exists|indexed)/i.test(message)) {
      log("fulltext index creation failed for Demonstration", { message });
    }
  }
}

// ============================================================
// TAXONOMY WRITES
// ============================================================

/**
 * Seeds the capability taxonomy and the capability map. ensureCapabilityGraph
 * owns every write (nodes, SPECIALIZES, PREREQUISITE_OF, RELATED_TO, stale
 * cleanup, stamp) so there is exactly one definition of what gets written.
 *
 * ensureCapabilityGraph writes its version stamp LAST, so "current" means a
 * complete seeding of exactly these definitions already exists and the ~25
 * write queries can be skipped.
 */
async function storeCapabilities(graph: Graph): Promise<void> {
  if (await isCapabilityGraphCurrent(graph)) return;
  await ensureCapabilityGraph(graph);
}

async function storeEngineeringContexts(graph: Graph): Promise<void> {
  const rows = ENGINEERING_CONTEXTS.map((c) => ({ id: c.id, name: c.name }));

  await graph.query(
    `
    UNWIND $batch AS item
    MERGE (e:EngineeringContext {id: item.id})
    SET e.name = item.name
    `,
    { params: { batch: asQueryParams(rows) } },
  );
}

// ============================================================
// EVIDENCE LOADING  (paged, streamed — patches are large)
// ============================================================

async function loadRepositoryNames(
  graph: Graph,
  developerId: string,
): Promise<Map<string, string>> {
  const rows = await queryRows(
    graph,
    `
    MATCH (d:Developer {id: $developer_id})-[:AUTHORED_CODE]->(fc:FileChange)
    WITH DISTINCT fc.repository_id AS repository_id
    MATCH (r:Repository {id: repository_id})
    RETURN r.id AS id, coalesce(r.full_name, r.name, "") AS full_name
    `,
    { developer_id: developerId },
  );

  return new Map(rows.map((r) => [safeString(r.id), safeString(r.full_name)]));
}

async function loadCommitMessages(
  graph: Graph,
  developerId: string,
): Promise<Map<string, string>> {
  const rows = await queryRows(
    graph,
    `
    MATCH (d:Developer {id: $developer_id})-[:MADE]->(c:Commit)
    RETURN c.repository_id AS repository_id, c.sha AS sha, c.message AS message
    `,
    { developer_id: developerId },
  );

  return new Map(
    rows.map((r) => [
      `${safeString(r.repository_id)}:${safeString(r.sha)}`,
      safeString(r.message),
    ]),
  );
}

/**
 * Keyset pagination (WHERE id > afterId) instead of SKIP: SKIP re-scans every
 * skipped row on each page, so later pages get slower and slower. Patch and
 * added_code are truncated inside the database so huge diffs never cross the
 * wire.
 */
async function fetchEvidencePage(
  graph: Graph,
  developerId: string,
  afterId: string,
): Promise<EvidenceInput[]> {
  const rows = await queryRows(
    graph,
    `
    MATCH (d:Developer {id: $developer_id})-[:AUTHORED_CODE]->(fc:FileChange)
    WHERE fc.id > $after_id
    RETURN fc.id AS id,
           fc.path AS path,
           fc.language AS language,
           substring(coalesce(fc.patch, ""), 0, ${MAX_PATCH_SCAN_CHARS}) AS patch,
           substring(coalesce(fc.added_code, ""), 0, ${MAX_PATCH_SCAN_CHARS}) AS added_code,
           fc.commit_sha AS commit_sha,
           fc.repository_id AS repository_id,
           fc.created_at AS created_at
    ORDER BY fc.id
    LIMIT ${EVIDENCE_PAGE_SIZE}
    `,
    { developer_id: developerId, after_id: afterId },
  );

  return rows.map((row) => ({
    id: safeString(row.id),
    path: safeString(row.path),
    language: safeString(row.language),
    patch: safeString(row.patch),
    addedCode: safeString(row.added_code),
    commitSha: safeString(row.commit_sha),
    repositoryId: safeString(row.repository_id),
    createdAt: safeString(row.created_at),
  }));
}

// ============================================================
// DEMONSTRATION WRITES
//
// Node upsert first, then ONE query per edge type (see runCounted). A missing
// Repository / FileChange / EngineeringContext now costs exactly one edge and
// a log line, never the Demonstration's other edges.
// ============================================================

async function storeDemonstrations(
  graph: Graph,
  developerId: string,
  buildId: string,
  demos: Demonstration[],
): Promise<void> {
  const scope = { developer_id: developerId, build_id: buildId };

  // 1) Demonstration nodes (the only place the large snippet is sent).
  await runCounted(
    graph,
    "Demonstration nodes",
    `
    UNWIND $batch AS item
    MERGE (x:Demonstration {id: item.id})
    SET x.rule_id = item.rule_id,
        x.technique = item.technique,
        x.summary = item.summary,
        x.modifiers = item.modifiers,
        x.depth = item.depth,
        x.depth_rank = item.depth_rank,
        x.commit_sha = item.commit_sha,
        x.file_change_id = item.file_change_id,
        x.repository_id = item.repository_id,
        x.path = item.path,
        x.language = item.language,
        x.start_line = item.start_line,
        x.end_line = item.end_line,
        x.snippet = item.snippet,
        x.permalink = item.permalink,
        x.change_intent = item.change_intent,
        x.commit_subject = item.commit_subject,
        x.created_at = item.created_at,
        x.developer_id = $developer_id,
        x.build_id = $build_id
    RETURN count(x) AS n
    `,
    demos.map((x) => ({
      id: x.id,
      rule_id: x.ruleId,
      technique: x.technique,
      summary: x.summary,
      modifiers: x.modifiers.join(" | "),
      depth: x.depth,
      depth_rank: DEPTH_RANK[x.depth],
      file_change_id: x.fileChangeId,
      repository_id: x.repositoryId,
      commit_sha: x.commitSha,
      path: x.path,
      language: x.language,
      start_line: x.startLine,
      end_line: x.endLine,
      snippet: x.snippet,
      permalink: x.permalink,
      change_intent: x.intent,
      commit_subject: x.commitSubject,
      created_at: x.createdAt,
    })),
    scope,
    true,
  );

  // Slim rows for the edge queries: ids only, no snippets.
  const edgeRows = demos.map((x) => ({
    id: x.id,
    capability_id: x.capabilityId,
    file_change_id: x.fileChangeId,
    repository_id: x.repositoryId,
    layer_id: x.layerId,
  }));

  await runCounted(
    graph,
    "DEMONSTRATED edges",
    `
    UNWIND $batch AS item
    MATCH (d:Developer {id: $developer_id})
    MATCH (x:Demonstration {id: item.id})
    MERGE (d)-[r:DEMONSTRATED]->(x)
    RETURN count(r) AS n
    `,
    edgeRows,
    { developer_id: developerId },
    true,
  );

  await runCounted(
    graph,
    "OF_CAPABILITY edges",
    `
    UNWIND $batch AS item
    MATCH (x:Demonstration {id: item.id})
    MATCH (c:Capability {id: item.capability_id})
    MERGE (x)-[r:OF_CAPABILITY]->(c)
    RETURN count(r) AS n
    `,
    edgeRows,
    true,
  );

  await runCounted(
    graph,
    "Demonstration EVIDENCED_BY edges",
    `
    UNWIND $batch AS item
    MATCH (x:Demonstration {id: item.id})
    MATCH (fc:FileChange {id: item.file_change_id})
    MERGE (x)-[r:EVIDENCED_BY]->(fc)
    RETURN count(r) AS n
    `,
    edgeRows,
    true,
  );

  await runCounted(
    graph,
    "PRODUCED edges",
    `
    UNWIND $batch AS item
    MATCH (x:Demonstration {id: item.id})
    MATCH (fc:FileChange {id: item.file_change_id})
    MERGE (fc)-[r:PRODUCED]->(x)
    RETURN count(r) AS n
    `,
    edgeRows,
    true,
  );

  await runCounted(
    graph,
    "IN_REPOSITORY edges",
    `
    UNWIND $batch AS item
    MATCH (x:Demonstration {id: item.id})
    MATCH (r:Repository {id: item.repository_id})
    MERGE (x)-[e:IN_REPOSITORY]->(r)
    RETURN count(e) AS n
    `,
    edgeRows,
    true,
  );

  await runCounted(
    graph,
    "Demonstration IN_CONTEXT edges",
    `
    UNWIND $batch AS item
    MATCH (x:Demonstration {id: item.id})
    MATCH (e:EngineeringContext {id: item.layer_id})
    MERGE (x)-[r:IN_CONTEXT]->(e)
    RETURN count(r) AS n
    `,
    edgeRows,
    true,
  );
}

// ============================================================
// DEMONSTRATION -> TOPIC / APPROACH EVIDENCE LINKS
//
// A Demonstration is one concrete piece of implementation evidence. These
// links attach it to the canonical Topic (and, when it can be attributed, the
// Approach) it is evidence for, so a topic reaches code WITHOUT depending on
// the broad Topic -[:MAPS_TO]-> Capability hop at read time.
//
//   (Demonstration)-[:EVIDENCE_FOR_TOPIC {source}]->(Topic)
//   (Demonstration)-[:DEMONSTRATES_APPROACH {source}]->(Approach)
//
// Every edge carries reason, confidence, source, build_id and developer_id.
// There is one edge per (demonstration, target, source), so the depth
// pipeline ("depth_assessment") and this file ("capability_mapping",
// "technique_match") never overwrite each other.
//
// Attribution rules:
//   - only implementation / strong demonstrations are linked; a "usage"
//     match (an import, a config line) is never proof of a topic;
//   - confidence = mapping weight x depth factor, so a loose mapping stays a
//     low-confidence link that readers can threshold;
//   - an approach link needs the demonstration's technique to name the
//     approach exactly; the depth pipeline adds the cited, LLM-judged links.
// ============================================================

const TOPIC_LINK_MIN_WEIGHT = 0.3;
const TOPIC_LINK_SOURCES = ["capability_mapping", "technique_match"];

export interface TopicLinkResult {
  topicLinks: number;
  approachLinks: number;
  removedStale: number;
}

export async function linkDemonstrationsToTopics(
  graph: Graph,
  developerId: string,
  buildId: string,
): Promise<TopicLinkResult> {
  const now = new Date().toISOString();
  const result: TopicLinkResult = {
    topicLinks: 0,
    approachLinks: 0,
    removedStale: 0,
  };

  try {
    // 1) Demonstration -> Topic through the validated capability mapping.
    const linked = await queryRows(
      graph,
      `
      MATCH (d:Developer {id: $developer_id})-[:DEMONSTRATED]->(x:Demonstration)
            -[:OF_CAPABILITY]->(c:Capability)<-[m:MAPS_TO]-(t:Topic)
      WHERE coalesce(x.depth_rank, 0) >= 2 AND coalesce(m.weight, 0) >= $min_weight
      MERGE (x)-[r:EVIDENCE_FOR_TOPIC {source: "capability_mapping"}]->(t)
      SET r.developer_id = $developer_id,
          r.topic_slug = t.slug,
          r.capability_id = c.id,
          r.confidence = m.weight * CASE WHEN x.depth_rank >= 3 THEN 1.0 ELSE 0.8 END,
          r.reason = CASE WHEN coalesce(m.reason, "") <> "" THEN m.reason
                          ELSE "Capability " + c.id + " maps to topic " + t.slug END,
          r.build_id = $build_id,
          r.updated_at = $now
      RETURN count(r) AS n
      `,
      {
        developer_id: developerId,
        build_id: buildId,
        min_weight: TOPIC_LINK_MIN_WEIGHT,
        now,
      },
    );
    result.topicLinks = safeNumber(linked[0]?.n);

    // 2) Demonstration -> Approach where the technique names the approach.
    const candidates = await queryRows(
      graph,
      `
      MATCH (x:Demonstration)-[e:EVIDENCE_FOR_TOPIC {source: "capability_mapping"}]->(t:Topic)
            <-[:APPROACH_OF]-(ap:Approach)
      WHERE e.developer_id = $developer_id AND e.build_id = $build_id
      RETURN x.id AS id, x.technique AS technique, ap.id AS approach_id,
             ap.slug AS approach_slug, ap.name AS approach_name,
             t.slug AS topic_slug, e.confidence AS confidence
      `,
      { developer_id: developerId, build_id: buildId },
    );
    const approachRows = candidates
      .filter((r) => {
        const technique = slugify(safeString(r.technique));
        return (
          technique !== "" &&
          (technique === safeString(r.approach_slug) ||
            technique === slugify(safeString(r.approach_name)))
        );
      })
      .map((r) => ({
        id: safeString(r.id),
        approach_id: safeString(r.approach_id),
        topic_slug: safeString(r.topic_slug),
        confidence: Math.min(0.7, safeNumber(r.confidence)),
        reason: `Technique "${safeString(r.technique)}" matches approach "${safeString(r.approach_name)}"`,
      }));
    if (approachRows.length) {
      result.approachLinks = await runCounted(
        graph,
        "DEMONSTRATES_APPROACH (technique match)",
        `
        UNWIND $batch AS item
        MATCH (x:Demonstration {id: item.id})
        MATCH (ap:Approach {id: item.approach_id})
        MERGE (x)-[r:DEMONSTRATES_APPROACH {source: "technique_match"}]->(ap)
        SET r.developer_id = $developer_id, r.topic_slug = item.topic_slug,
            r.confidence = item.confidence, r.reason = item.reason,
            r.build_id = $build_id, r.updated_at = $now
        RETURN count(r) AS n
        `,
        approachRows,
        { developer_id: developerId, build_id: buildId, now },
      );
    }

    // 3) Stale links from earlier builds (only the sources written here).
    const removed = await queryRows(
      graph,
      `
      MATCH (x:Demonstration)-[r:EVIDENCE_FOR_TOPIC|DEMONSTRATES_APPROACH]->()
      WHERE r.developer_id = $developer_id
        AND r.source IN $sources
        AND coalesce(r.build_id, "") <> $build_id
      DELETE r
      RETURN count(r) AS n
      `,
      {
        developer_id: developerId,
        build_id: buildId,
        sources: TOPIC_LINK_SOURCES,
      },
    );
    result.removedStale = safeNumber(removed[0]?.n);
  } catch (error) {
    // Links are derived data. A failure must not fail the evidence build.
    log("topic evidence linking failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  log("topic evidence links written", result as unknown as AnyObject);
  return result;
}

async function storeDemonstrationUsage(
  graph: Graph,
  demos: Demonstration[],
): Promise<void> {
  await runCounted(
    graph,
    "USES edges",
    `
    UNWIND $batch AS item
    MATCH (x:Demonstration {id: item.demonstration_id})
    MATCH (s:Skill {id: item.skill_id})
    MERGE (x)-[r:USES]->(s)
    RETURN count(r) AS n
    `,
    demos.flatMap((x) =>
      x.usesSkillIds.map((skillId) => ({
        demonstration_id: x.id,
        skill_id: skillId,
      })),
    ),
  );
}

export async function storeDeveloperCapabilities(
  graph: Graph,
  developerId: string,
  rollups: CapabilityRollup[],
): Promise<void> {
  const updatedAt = new Date().toISOString();

  await runCounted(
    graph,
    "HAS_CAPABILITY edges",
    `
    UNWIND $batch AS item
    MATCH (d:Developer {id: item.developer_id})
    MATCH (c:Capability {id: item.capability_id})
    MERGE (d)-[r:HAS_CAPABILITY]->(c)
    SET r.level = item.level,
        r.recency = item.recency,
        r.best_depth = item.best_depth,
        r.evidence_count = item.evidence_count,
        r.commit_count = item.commit_count,
        r.repo_count = item.repo_count,
        r.technique_count = item.technique_count,
        r.active_days = item.active_days,
        r.first_seen = item.first_seen,
        r.last_seen = item.last_seen,
        r.techniques_json = item.techniques_json,
        r.updated_at = item.updated_at
    RETURN count(r) AS n
    `,
    rollups.map((r) => ({
      developer_id: developerId,
      capability_id: r.capabilityId,
      level: r.level,
      recency: r.recency,
      best_depth: r.bestDepth,
      evidence_count: r.evidenceCount,
      commit_count: r.commitCount,
      repo_count: r.repoCount,
      technique_count: r.techniqueCount,
      active_days: r.activeDays,
      first_seen: r.firstSeen,
      last_seen: r.lastSeen,
      techniques_json: r.techniquesJson,
      updated_at: updatedAt,
    })),
    true,
  );
}

/**
 * Build-stamped cleanup: new demonstrations are written first, then anything
 * from an older build is removed. An interrupted run never leaves the
 * developer with an empty profile.
 */
async function cleanupStale(
  graph: Graph,
  developerId: string,
  buildId: string,
  capabilityIds: string[],
): Promise<void> {
  await graph.query(
    `
    MATCH (d:Developer {id: $developer_id})-[:DEMONSTRATED]->(x:Demonstration)
    WHERE coalesce(x.build_id, "") <> $build_id AND coalesce(x.source, "") <> "mission"
    DETACH DELETE x
    `,
    { params: { developer_id: developerId, build_id: buildId } },
  );

  await graph.query(
    `
    MATCH (d:Developer {id: $developer_id})-[r:HAS_CAPABILITY]->(c:Capability)
    WHERE NOT c.id IN $capability_ids
    DELETE r
    `,
    { params: { developer_id: developerId, capability_ids: capabilityIds } },
  );
}

// ============================================================
// SKILL -> REPOSITORY EVIDENCE
//
// Uses the SAME matcher that produced the skill graph (matchesSkill), so a
// skill is only "demonstrated in" a repository where it actually matched
// code.
//
// Skill nodes are global, so the DEMONSTRATED_IN edge carries `developer_id`
// to keep two developers who touch the same repository from overwriting each
// other's evidence. Readers of DEMONSTRATED_IN must filter on
// `sr.developer_id = $developer_id`.
// ============================================================

interface StoredSkillRow {
  skillId: string;
  skillName: string;
  score: number;
}

async function fetchDeveloperSkills(
  graph: Graph,
  developerId: string,
): Promise<StoredSkillRow[]> {
  const rows = await queryRows(
    graph,
    `
    MATCH (d:Developer {id: $developer_id})-[r:HAS_SKILL]->(s:Skill)
    RETURN s.id AS skill_id,
           s.name AS skill_name,
           coalesce(r.depth_score, 0) AS score
    ORDER BY score DESC
    `,
    { developer_id: developerId },
  );

  return rows.map((row) => ({
    skillId: safeString(row.skill_id),
    skillName: safeString(row.skill_name),
    score: safeNumber(row.score),
  }));
}

interface SkillRepositoryAggregate {
  skillId: string;
  repositoryId: string;
  evidenceCount: number;
  commitShas: Set<string>;
  firstSeenTs: number;
  lastSeenTs: number;
  evidencePath: string;
  evidenceCommitSha: string;
}

function collectSkillRepositoryEvidence(
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

async function storeSkillRepositoryRelations(
  graph: Graph,
  developerId: string,
  buildId: string,
  aggregates: Map<string, SkillRepositoryAggregate>,
  skills: StoredSkillRow[],
  repositoryIds: string[],
): Promise<number> {
  const scoreBySkill = new Map(skills.map((s) => [s.skillId, s.score]));

  const rows = Array.from(aggregates.values()).map((a) => ({
    skill_id: a.skillId,
    repository_id: a.repositoryId,
    evidence_count: a.evidenceCount,
    commit_count: a.commitShas.size,
    first_seen: Number.isFinite(a.firstSeenTs)
      ? new Date(a.firstSeenTs).toISOString()
      : "",
    last_seen: a.lastSeenTs ? new Date(a.lastSeenTs).toISOString() : "",
    evidence_path: a.evidencePath,
    commit_sha: a.evidenceCommitSha,
    skill_score: scoreBySkill.get(a.skillId) ?? 0,
  }));

  // The relationship identity includes developer_id, so each developer owns
  // their own Skill -> Repository edge.
  const written = await runCounted(
    graph,
    "DEMONSTRATED_IN edges",
    `
    UNWIND $batch AS item
    MATCH (s:Skill {id: item.skill_id})
    MATCH (r:Repository {id: item.repository_id})
    MERGE (s)-[sr:DEMONSTRATED_IN {developer_id: $developer_id}]->(r)
    SET sr.evidence_count = item.evidence_count,
        sr.commit_count = item.commit_count,
        sr.first_seen = item.first_seen,
        sr.last_seen = item.last_seen,
        sr.evidence_path = item.evidence_path,
        sr.commit_sha = item.commit_sha,
        sr.skill_score = item.skill_score,
        sr.build_id = $build_id
    RETURN count(sr) AS n
    `,
    rows,
    { developer_id: developerId, build_id: buildId },
  );

  // Remove this developer's edges that were not re-confirmed this build,
  // including legacy edges that have no developer_id yet. Keyed on the edge's
  // developer and repositories, NOT on HAS_SKILL, so a skill the developer no
  // longer has cannot leave a stale edge behind.
  await graph.query(
    `
    MATCH (s:Skill)-[sr:DEMONSTRATED_IN]->(r:Repository)
    WHERE r.id IN $repository_ids
      AND coalesce(sr.developer_id, $developer_id) = $developer_id
      AND coalesce(sr.build_id, "") <> $build_id
    DELETE sr
    `,
    {
      params: {
        developer_id: developerId,
        repository_ids: repositoryIds,
        build_id: buildId,
      },
    },
  );

  return written;
}

// ============================================================
// PUBLIC BUILD API
// ============================================================

export interface OverviewGraphBuildResult {
  developerId: string;
  fileChangesAnalyzed: number;
  repositoriesFound: number;
  skillsFound: number;
  demonstrationsFound: number;
  experiencesFound: number;
  capabilitiesFound: number;
  domainsFound: number;
  capabilityLevels: Record<string, number>;
  skillRepositoryRelations: number;
}

/**
 * Loads stored demonstrations. Besides what rollUpDemonstrations reads, it
 * returns `ruleId` and `modifiers` so evaluateCapabilityCompletion() can judge
 * technique specs and safeguards against stored evidence.
 */
export async function loadDemonstrationRows(
  graph: Graph,
  developerId: string,
  onlyMission = false,
): Promise<Demonstration[]> {
  const rows = await queryRows(
    graph,
    `
    MATCH (d:Developer {id: $developer_id})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability)
    WHERE $only_mission = false OR x.source = "mission"
    RETURN x.id AS id,
           c.id AS capability_id,
           x.rule_id AS rule_id,
           x.technique AS technique,
           x.modifiers AS modifiers,
           x.depth AS depth,
           x.repository_id AS repository_id,
           x.commit_sha AS commit_sha,
           x.created_at AS created_at
    `,
    { developer_id: developerId, only_mission: onlyMission },
  );

  // Only the fields the roll-up and completion check read.
  return rows.map(
    (r) =>
      ({
        id: safeString(r.id),
        capabilityId: safeString(r.capability_id),
        ruleId: safeString(r.rule_id),
        technique: safeString(r.technique),
        modifiers: safeString(r.modifiers).split(" | ").filter(Boolean),
        depth: (safeString(r.depth) || "usage") as DemonstrationDepth,
        repositoryId: safeString(r.repository_id),
        commitSha: safeString(r.commit_sha),
        createdAt: safeString(r.created_at),
      }) as unknown as Demonstration,
  );
}

export async function buildOverviewIntelligenceGraph(
  graph: Graph,
  developerId: string,
  onProgress: ProgressFn = () => {},
): Promise<OverviewGraphBuildResult> {
  if (!developerId) throw new Error("Missing developerId");

  const startedAt = Date.now();
  const buildId = `${startedAt}-${randomUUID()}`;

  log("=== overview intelligence graph: START ===", { developerId, buildId });
  onProgress("overview_graph_start", { developerId });

  await ensureDemonstrationIndexes(graph);
  await ensureGoalIndexes(graph);
  await storeCapabilities(graph);
  await storeEngineeringContexts(graph);

  const [skills, repositoryNames, commitMessages] = await Promise.all([
    fetchDeveloperSkills(graph, developerId),
    loadRepositoryNames(graph, developerId),
    loadCommitMessages(graph, developerId),
  ]);

  // The skill graph decides WHICH skills the developer has; the matcher is
  // only used to attribute them to repositories. It never rescores anything.
  const definitionsById = new Map(SKILL_TAXONOMY.map((def) => [def.id, def]));
  const skillTargets = skills.flatMap((skill) => {
    const def = definitionsById.get(skill.skillId);
    return def ? [{ skill, def }] : [];
  });

  const demonstrations: Demonstration[] = [];
  const skillRepositoryAggregates = new Map<string, SkillRepositoryAggregate>();
  const repositoryIds = new Set<string>();

  let scanned = 0;
  let lastId = "";

  // One paged pass over the evidence feeds both derivations, so patches are
  // never all in memory at once.
  while (true) {
    const page = await fetchEvidencePage(graph, developerId, lastId);

    for (const fc of page) {
      if (fc.repositoryId) repositoryIds.add(fc.repositoryId);

      demonstrations.push(
        ...extractDemonstrations(fc, {
          repositoryFullName: repositoryNames.get(fc.repositoryId) ?? "",
          commitMessage:
            commitMessages.get(`${fc.repositoryId}:${fc.commitSha}`) ?? "",
        }),
      );
    }

    collectSkillRepositoryEvidence(
      page,
      skillTargets,
      skillRepositoryAggregates,
    );

    scanned += page.length;
    onProgress("overview_graph_evidence_scanned", {
      scanned,
      demonstrations: demonstrations.length,
    });

    if (page.length < EVIDENCE_PAGE_SIZE) break;
    lastId = page[page.length - 1].id;
  }

  onProgress("overview_graph_evidence_loaded", {
    fileChanges: scanned,
    repositories: repositoryNames.size,
    skills: skills.length,
  });

  const missionDemos = await loadDemonstrationRows(graph, developerId, true);
  const rollups = rollUpDemonstrations([...demonstrations, ...missionDemos]);

  await storeDemonstrations(graph, developerId, buildId, demonstrations);
  await storeDemonstrationUsage(graph, demonstrations);

  const experiences = await storeEngineeringExperiences(
    graph,
    developerId,
    buildId,
    demonstrations,
  );

  await storeDeveloperCapabilities(graph, developerId, rollups);
  await cleanupStale(
    graph,
    developerId,
    buildId,
    rollups.map((r) => r.capabilityId),
  );
  await cleanupStaleExperiences(graph, developerId, buildId);

  // Attach implementation evidence to canonical topics / approaches. Topic
  // nodes come from the depth pipeline, so on a first run this finds nothing
  // and the links appear on the next build (or when the depth pipeline calls
  // linkDemonstrationsToTopics after writing its mappings).
  const topicLinks = await linkDemonstrationsToTopics(
    graph,
    developerId,
    buildId,
  );
  onProgress("overview_graph_topic_links", { ...topicLinks });

  const skillRepositoryRelations = await storeSkillRepositoryRelations(
    graph,
    developerId,
    buildId,
    skillRepositoryAggregates,
    skills,
    Array.from(repositoryIds),
  );

  const leafRollups = rollups.filter(
    (r) => CAPABILITY_BY_ID.get(r.capabilityId)?.parentId,
  );

  const result: OverviewGraphBuildResult = {
    developerId,
    fileChangesAnalyzed: scanned,
    repositoriesFound: repositoryNames.size,
    skillsFound: skills.length,
    demonstrationsFound: demonstrations.length,
    experiencesFound: experiences.length,
    capabilitiesFound: leafRollups.length,
    domainsFound: rollups.length - leafRollups.length,
    capabilityLevels: leafRollups.reduce<Record<string, number>>((acc, r) => {
      acc[r.level] = (acc[r.level] ?? 0) + 1;
      return acc;
    }, {}),
    skillRepositoryRelations,
  };

  onProgress("overview_graph_complete", result);
  log("=== overview intelligence graph: COMPLETE ===", {
    ...result,
    durationMs: Date.now() - startedAt,
  });

  return result;
}

// ============================================================
// READ API
// ============================================================

const LEVEL_RANK: Record<CapabilityLevel, number> = {
  insufficient_evidence: 0,
  usage: 1,
  repeated_usage: 2,
  implementation: 3,
  strong: 4,
};

export interface CapabilityProfileEntry {
  capabilityId: string;
  name: string;
  description: string;
  level: CapabilityLevel;
  recency: Recency;
  bestDepth: DemonstrationDepth;
  evidenceCount: number;
  commitCount: number;
  repoCount: number;
  techniqueCount: number;
  activeDays: number;
  firstSeen: string;
  lastSeen: string;
  topTechniques: Array<{ technique: string; count: number }>;
}

export interface DomainProfile extends CapabilityProfileEntry {
  capabilities: CapabilityProfileEntry[];
}

function parseTechniques(
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

function byLevelThenEvidence(
  a: CapabilityProfileEntry,
  b: CapabilityProfileEntry,
): number {
  return (
    LEVEL_RANK[b.level] - LEVEL_RANK[a.level] ||
    b.evidenceCount - a.evidenceCount
  );
}

export async function getCapabilityProfile(
  graph: Graph,
  developerId: string,
): Promise<DomainProfile[]> {
  const rows = await queryRows(
    graph,
    `
    MATCH (d:Developer {id: $developer_id})-[r:HAS_CAPABILITY]->(c:Capability)
    RETURN c.id AS id,
           c.name AS name,
           coalesce(c.description, "") AS description,
           coalesce(c.parent_id, "") AS parent_id,
           r.level AS level,
           r.recency AS recency,
           r.best_depth AS best_depth,
           r.evidence_count AS evidence_count,
           r.commit_count AS commit_count,
           r.repo_count AS repo_count,
           r.technique_count AS technique_count,
           r.active_days AS active_days,
           r.first_seen AS first_seen,
           r.last_seen AS last_seen,
           r.techniques_json AS techniques_json
    `,
    { developer_id: developerId },
  );

  const toEntry = (row: AnyObject): CapabilityProfileEntry => ({
    capabilityId: safeString(row.id),
    name: safeString(row.name),
    description: safeString(row.description),
    level: (safeString(row.level) ||
      "insufficient_evidence") as CapabilityLevel,
    recency: (safeString(row.recency) || "historical") as Recency,
    bestDepth: (safeString(row.best_depth) || "usage") as DemonstrationDepth,
    evidenceCount: safeNumber(row.evidence_count),
    commitCount: safeNumber(row.commit_count),
    repoCount: safeNumber(row.repo_count),
    techniqueCount: safeNumber(row.technique_count),
    activeDays: safeNumber(row.active_days),
    firstSeen: safeString(row.first_seen),
    lastSeen: safeString(row.last_seen),
    topTechniques: parseTechniques(row.techniques_json),
  });

  const domains = new Map<string, DomainProfile>();

  for (const row of rows) {
    if (!safeString(row.parent_id)) {
      domains.set(safeString(row.id), { ...toEntry(row), capabilities: [] });
    }
  }

  for (const row of rows) {
    const parentId = safeString(row.parent_id);
    if (parentId) domains.get(parentId)?.capabilities.push(toEntry(row));
  }

  const result = Array.from(domains.values());
  for (const d of result) d.capabilities.sort(byLevelThenEvidence);
  return result.sort(byLevelThenEvidence);
}

export interface DemonstrationEvidence {
  id: string;
  capabilityId: string;
  technique: string;
  summary: string;
  modifiers: string[];
  depth: DemonstrationDepth;
  repository: string;
  path: string;
  startLine: number;
  endLine: number;
  permalink: string;
  commitSha: string;
  commitSubject: string;
  changeIntent: string;
  layer: string;
  snippet: string;
  usesSkills: string[];
  createdAt: string;
}

/**
 * The "proof": concrete demonstrations, strongest first, each with
 * what / how / where / context and the code. Pass a capability id (or a
 * domain id) to scope it; pass "" for the strongest across everything.
 */
export async function getCapabilityEvidence(
  graph: Graph,
  developerId: string,
  capabilityId = "",
  limit = 10,
): Promise<DemonstrationEvidence[]> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 50);

  const rows = await queryRows(
    graph,
    `
    MATCH (d:Developer {id: $developer_id})-[:DEMONSTRATED]->(x:Demonstration)-[:OF_CAPABILITY]->(c:Capability)
    WHERE $capability_id = "" OR c.id = $capability_id OR c.parent_id = $capability_id

    MATCH (x)-[:IN_REPOSITORY]->(r:Repository)
    OPTIONAL MATCH (x)-[:IN_CONTEXT]->(e:EngineeringContext)
    OPTIONAL MATCH (x)-[:USES]->(s:Skill)

    WITH x, c, r, e, collect(DISTINCT s.name) AS skills

    RETURN x.id AS id,
           c.id AS capability_id,
           x.technique AS technique,
           x.summary AS summary,
           x.modifiers AS modifiers,
           x.depth AS depth,
           x.depth_rank AS depth_rank,
           coalesce(r.full_name, r.name, "") AS repository,
           x.path AS path,
           x.start_line AS start_line,
           x.end_line AS end_line,
           x.permalink AS permalink,
           x.commit_sha AS commit_sha,
           x.commit_subject AS commit_subject,
           x.change_intent AS change_intent,
           coalesce(e.name, "") AS layer,
           x.snippet AS snippet,
           skills,
           x.created_at AS created_at

    ORDER BY depth_rank DESC, created_at DESC
    LIMIT ${safeLimit}
    `,
    { developer_id: developerId, capability_id: capabilityId },
  );

  return rows.map((row) => ({
    id: safeString(row.id),
    capabilityId: safeString(row.capability_id),
    technique: safeString(row.technique),
    summary: safeString(row.summary),
    modifiers: safeString(row.modifiers).split(" | ").filter(Boolean),
    depth: (safeString(row.depth) || "usage") as DemonstrationDepth,
    repository: safeString(row.repository),
    path: safeString(row.path),
    startLine: validLineRange(row.start_line, row.end_line)?.start ?? 0,
    endLine: validLineRange(row.start_line, row.end_line)?.end ?? 0,
    permalink: validLineRange(row.start_line, row.end_line)
      ? safeString(row.permalink)
      : "",
    commitSha: safeString(row.commit_sha),
    commitSubject: safeString(row.commit_subject),
    changeIntent: safeString(row.change_intent),
    layer: safeString(row.layer),
    snippet: safeString(row.snippet),
    usesSkills: Array.isArray(row.skills) ? row.skills.map(safeString) : [],
    createdAt: safeString(row.created_at),
  }));
}

// ============================================================
// SNAPSHOT / READ API
// ============================================================

export interface OverviewGraphSnapshot {
  developer: {
    id: string;
    name: string;
    username: string;
    avatarUrl: string;
  };

  /** Domain -> capability profile: level, recency, raw counts, top techniques. */
  domains: DomainProfile[];

  /** Strongest concrete demonstrations across all capabilities (the proof). */
  evidence: DemonstrationEvidence[];

  /** Active developer goal and its evidence-backed capability requirements. */
  goal: DeveloperGoal | null;

  skills: Array<{
    id: string;
    name: string;
    category: string;
    score: number;
    level: string;
    filesTouched: number;
    commitsCount: number;
    reposCount: number;
    activeDays: number;
    firstSeen: string;
    lastSeen: string;
  }>;

  repositories: Array<{
    id: string;
    name: string;
    fullName: string;
    description: string;
    language: string;
    url: string;
    fileChangeCount: number;
    commitCount: number;
    firstEvidenceAt: string;
    lastEvidenceAt: string;
  }>;

  relationships: Array<{
    from: string;
    to: string;
    type: string;
    level: string;
    evidenceCount: number;
    score: number;
    commitCount: number;
    firstSeen: string;
    lastSeen: string;
  }>;
}

export async function getOverviewGraphSnapshot(
  graph: Graph,
  developerId: string,
  evidenceLimit = 40,
): Promise<OverviewGraphSnapshot> {
  if (!developerId) throw new Error("Missing developerId");

  const [
    developerRows,
    domains,
    evidence,
    goal,
    skillRows,
    repositoryRows,
    relationshipRows,
  ] = await Promise.all([
    queryRows(
      graph,
      `
      MATCH (d:Developer)
      WHERE d.id = $developer_id
      RETURN d.id AS id,
             d.name AS name,
             d.username AS username,
             d.avatar_url AS avatar_url
      `,
      { developer_id: developerId },
    ),

    getCapabilityProfile(graph, developerId),

    getCapabilityEvidence(graph, developerId, "", evidenceLimit),

    getDeveloperGoal(graph, developerId),

    queryRows(
      graph,
      `
      MATCH (d:Developer)-[r:HAS_SKILL]->(s:Skill)
      WHERE d.id = $developer_id
      OPTIONAL MATCH (c:SkillCategory)-[:CONTAINS]->(s)
      RETURN s.id AS id,
             s.name AS name,
             coalesce(c.name, "") AS category,
             coalesce(r.depth_score, 0) AS score,
             coalesce(r.level, "") AS level,
             coalesce(r.files_touched, 0) AS files_touched,
             coalesce(r.commits_count, 0) AS commits_count,
             coalesce(r.repos_count, 0) AS repos_count,
             coalesce(r.active_days, 0) AS active_days,
             coalesce(r.first_seen, "") AS first_seen,
             coalesce(r.last_seen, "") AS last_seen
      ORDER BY score DESC
      `,
      { developer_id: developerId },
    ),

    queryRows(
      graph,
      `
      MATCH (d:Developer)-[:AUTHORED_CODE]->(fc:FileChange)
      WHERE d.id = $developer_id
      WITH fc.repository_id AS repository_id,
           count(DISTINCT fc) AS file_change_count,
           count(DISTINCT fc.commit_sha) AS commit_count,
           min(fc.created_at) AS first_evidence_at,
           max(fc.created_at) AS last_evidence_at
      WHERE repository_id IS NOT NULL AND repository_id <> ""
      MATCH (r:Repository {id: repository_id})
      RETURN r.id AS id,
             r.name AS name,
             r.full_name AS full_name,
             r.description AS description,
             r.language AS language,
             r.url AS url,
             file_change_count,
             commit_count,
             first_evidence_at,
             last_evidence_at
      ORDER BY file_change_count DESC, last_evidence_at DESC
      `,
      { developer_id: developerId },
    ),

    queryRows(
      graph,
      `
      MATCH (d:Developer)-[r]->(x)
      WHERE d.id = $developer_id
        AND type(r) IN ["HAS_SKILL", "HAS_CAPABILITY"]
      RETURN d.id AS from_id,
             x.id AS to_id,
             type(r) AS relationship_type,
             coalesce(r.level, "") AS level,
             coalesce(r.evidence_count, r.files_touched, 0) AS evidence_count,
             coalesce(r.depth_score, 0) AS score,
             coalesce(r.commit_count, r.commits_count, 0) AS commit_count,
             coalesce(r.first_seen, "") AS first_seen,
             coalesce(r.last_seen, "") AS last_seen
      `,
      { developer_id: developerId },
    ),
  ]);

  const developer = developerRows[0] ?? {};

  return {
    developer: {
      id: safeString(developer.id),
      name: safeString(developer.name),
      username: safeString(developer.username),
      avatarUrl: safeString(developer.avatar_url),
    },

    domains,
    evidence,
    goal,

    skills: skillRows.map((row) => ({
      id: safeString(row.id),
      name: safeString(row.name),
      category: safeString(row.category),
      score: safeNumber(row.score),
      level: safeString(row.level),
      filesTouched: safeNumber(row.files_touched),
      commitsCount: safeNumber(row.commits_count),
      reposCount: safeNumber(row.repos_count),
      activeDays: safeNumber(row.active_days),
      firstSeen: safeString(row.first_seen),
      lastSeen: safeString(row.last_seen),
    })),

    repositories: repositoryRows.map((row) => ({
      id: safeString(row.id),
      name: safeString(row.name),
      fullName: safeString(row.full_name),
      description: safeString(row.description),
      language: safeString(row.language),
      url: safeString(row.url),
      fileChangeCount: safeNumber(row.file_change_count),
      commitCount: safeNumber(row.commit_count),
      firstEvidenceAt: safeString(row.first_evidence_at),
      lastEvidenceAt: safeString(row.last_evidence_at),
    })),

    relationships: relationshipRows.map((row) => ({
      from: safeString(row.from_id),
      to: safeString(row.to_id),
      type: safeString(row.relationship_type),
      level: safeString(row.level),
      evidenceCount: safeNumber(row.evidence_count),
      score: safeNumber(row.score),
      commitCount: safeNumber(row.commit_count),
      firstSeen: safeString(row.first_seen),
      lastSeen: safeString(row.last_seen),
    })),
  };
}

// ============================================================
// ONE-TIME MIGRATION
//
// Deletes the old one-word Concept / Pattern layer for ALL developers:
// OverviewConcept, OverviewPattern, OverviewCategory and every relationship
// attached to them (DEMONSTRATES_CONCEPT, DEMONSTRATES_PATTERN,
// SUPPORTS_CONCEPT, SUPPORTED_BY, and their DEMONSTRATED_IN edges).
//
// It is NOT called automatically. Run it once, after nothing reads those nodes any more.
// ============================================================

export async function removeLegacyConceptPatternGraph(
  graph: Graph,
): Promise<Record<string, number>> {
  const removed: Record<string, number> = {};

  for (const label of [
    "OverviewConcept",
    "OverviewPattern",
    "OverviewCategory",
  ]) {
    const rows = await queryRows(
      graph,
      `MATCH (n:${label}) RETURN count(n) AS n`,
    );
    removed[label] = safeNumber(rows[0]?.n);
    await graph.query(`MATCH (n:${label}) DETACH DELETE n`);
  }

  log("legacy concept/pattern graph removed", removed);
  return removed;
}
