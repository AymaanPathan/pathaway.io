/* eslint-disable @typescript-eslint/no-explicit-any */
import "dotenv/config";
import OpenAI from "openai";

export const CEREBRAS_MODEL = "gpt-oss-120b";

const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;

if (!CEREBRAS_API_KEY) {
  throw new Error("Missing CEREBRAS_API_KEY");
}

export const cerebras = new OpenAI({
  apiKey: CEREBRAS_API_KEY,
  baseURL: "https://api.cerebras.ai/v1",
});

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

/** gpt-oss-120b is a reasoning model; reasoning tokens count against the limit. */
const REASONING_HEADROOM = 500;

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
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CHAT_TIMEOUT_MS);
      try {
        const res = await cerebras.chat.completions.create(
          {
            model: CEREBRAS_MODEL,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            temperature: temperature ?? 0.2,
            max_completion_tokens: maxTokens + REASONING_HEADROOM,
            response_format: { type: "json_object" },
            reasoning_effort: "low",
          } as any,
          { signal: ctrl.signal, maxRetries: 0 },
        );
        const text = (res as any).choices?.[0]?.message?.content ?? "";
        const parsed = parseJson(String(text));
        if (!parsed) throw new Error("model returned no parseable JSON");
        return parsed;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
