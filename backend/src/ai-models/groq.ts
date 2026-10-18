/* eslint-disable @typescript-eslint/no-explicit-any */
import "dotenv/config";
import OpenAI from "openai";

/**
 * Groq-backed chat LLM for the topic/chat agent.
 *
 * Environment:
 *   GROQ_API_KEY=...
 *   GROQ_MODEL=openai/gpt-oss-120b   # optional
 */
export const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!GROQ_API_KEY) {
  throw new Error("Missing GROQ_API_KEY");
}

export const groq = new OpenAI({
  apiKey: GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

export interface GroqChatLlm {
  model: string;
  completeJson(args: {
    stage: "discover" | "synthesize";
    system: string;
    user: string;
    maxTokens: number;
    temperature?: number;
  }): Promise<unknown>;
}

const CHAT_TIMEOUT_MS = Number(process.env.TOPIC_CHAT_TIMEOUT_MS) || 20_000;

function parseJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        // Fall through to the useful error below.
      }
    }
    return null;
  }
}

function errorStatus(error: unknown): number | undefined {
  const e = error as any;
  return typeof e?.status === "number" ? e.status : undefined;
}

export function createGroqChatLlm(): GroqChatLlm {
  return {
    model: GROQ_MODEL,

    async completeJson({ stage, system, user, maxTokens }) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);

      try {
        const response = await groq.chat.completions.create(
          {
            model: GROQ_MODEL,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            max_completion_tokens: maxTokens,
            response_format: { type: "json_object" },
          } as any,
          {
            signal: controller.signal,
            maxRetries: 2,
            timeout: CHAT_TIMEOUT_MS,
          },
        );

        const content = response.choices[0]?.message?.content;
        const text = typeof content === "string" ? content : "";
        const parsed = parseJson(text);

        if (parsed === null) {
          throw new Error(
            `Groq (${GROQ_MODEL}) returned no parseable JSON for stage "${stage}"`,
          );
        }

        return parsed;
      } catch (error) {
        const status = errorStatus(error);
        const message = error instanceof Error ? error.message : String(error);

        console.error("[groq-chat] request failed", {
          model: GROQ_MODEL,
          status,
          message,
        });

        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
