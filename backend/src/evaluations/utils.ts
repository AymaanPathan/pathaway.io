import type { LlmClient } from "../agents/goal-agent.js";
import type { DataStoreKind } from "./types.js";

export const clip = (s: string, n: number): string =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

export const txt = (v: unknown): string =>
  v == null || typeof v === "object" ? "" : String(v).trim();

export const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

export const escapeRe = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const TEST_FILE = /\.(test|spec)\.[tj]sx?$/;
export const SRC_FILE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/** "@upstash/redis" -> "redis", "ioredis" -> "ioredis". Lower-case, scope removed. */
export const libraryToken = (lib: string | null | undefined): string =>
  lib ? lib.toLowerCase().replace(/^@[^/]+\//, "") : "";

/** Data stores the sandbox can start for HTTP / database tests. */
export const PROVISIONABLE_STORES: DataStoreKind[] = [
  "postgres",
  "mysql",
  "redis",
  "sqlite",
];

/** One LLM call with its own timeout. */
export async function ask(
  llm: LlmClient,
  system: string,
  user: string,
  maxTokens: number,
  json: boolean,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await llm.complete({
      system,
      user,
      maxTokens,
      json,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
