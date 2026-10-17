/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router, type Response } from "express";
import { getGraphForDeveloper } from "../db/falkordb.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { createCerebrasChatLlm, type ChatLlm } from "../ai-models/cerebras.js";
import {
  answerTopicQuestion,
  type ChatTurn,
  type TraceEvent,
} from "../agents/chat-agent.js";
import { describeTools } from "../tools/index.js";

export const topicsChatRouter = Router();

const MAX_MESSAGE = 800;
const RATE_LIMIT = 20; // requests
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function limited(developerId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(developerId) ?? []).filter(
    (t) => now - t < RATE_WINDOW_MS,
  );
  if (recent.length >= RATE_LIMIT) {
    hits.set(developerId, recent);
    return true;
  }
  recent.push(now);
  hits.set(developerId, recent);
  return false;
}

/** Cerebras gpt-oss-120b for chat. null = rules mode (answers still come from the graph). */
let llm: ChatLlm | null | undefined;
function chatLlm(): ChatLlm | null {
  if (llm !== undefined) return llm;
  try {
    llm = createCerebrasChatLlm();
  } catch (error) {
    console.warn(
      "[topics-chat] LLM unavailable, using rules mode:",
      error instanceof Error ? error.message : error,
    );
    llm = null;
  }
  return llm;
}

function cleanHistory(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((h): ChatTurn | null => {
      if (!h || typeof h !== "object") return null;
      const role =
        (h as any).role === "assistant"
          ? "assistant"
          : (h as any).role === "user"
            ? "user"
            : null;
      const content =
        typeof (h as any).content === "string"
          ? (h as any).content.trim().slice(0, 600)
          : "";
      return role && content ? { role, content } : null;
    })
    .filter((h): h is ChatTurn => h !== null)
    .slice(-8);
}

/** Shared validation for both endpoints. Returns null after sending an error response. */
function prepare(req: AuthedRequest, res: Response) {
  const developerId = req.developer!.developerId;
  const message =
    typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) {
    res.status(400).json({ error: "Provide a non-empty message." });
    return null;
  }
  if (message.length > MAX_MESSAGE) {
    res.status(400).json({
      error: `Message is too long (max ${MAX_MESSAGE} characters).`,
    });
    return null;
  }
  if (limited(developerId)) {
    res
      .status(429)
      .json({ error: "Too many questions. Wait a moment and try again." });
    return null;
  }
  const topic =
    typeof req.body?.topic === "string" &&
    /^[a-z0-9_]{1,60}$/.test(req.body.topic)
      ? req.body.topic
      : null;
  return {
    developerId,
    message,
    topic,
    history: cleanHistory(req.body?.history),
  };
}

topicsChatRouter.get("/api/topics/chat/tools", requireAuth, (_req, res) => {
  res.json({ tools: describeTools() });
});

/** Plain JSON endpoint (fallback). */
topicsChatRouter.post(
  "/api/topics/chat",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const p = prepare(req, res);
    if (!p) return;
    try {
      const graph = await getGraphForDeveloper(p.developerId);
      const response = await answerTopicQuestion({
        graph,
        developerId: p.developerId,
        message: p.message,
        history: p.history,
        selectedTopic: p.topic,
        llm: chatLlm(),
      });
      return res.json(response);
    } catch (error) {
      console.error("POST /api/topics/chat failed:", error);
      return res
        .status(500)
        .json({ error: "Failed to answer. Please try again." });
    }
  },
);

/** Streaming endpoint: newline-delimited JSON, one TraceEvent per line, then {type:"done"}. */
topicsChatRouter.post(
  "/api/topics/chat/stream",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const p = prepare(req, res);
    if (!p) return;

    res.status(200);
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    let closed = false;
    res.on("close", () => {
      closed = true;
    });
    const send = (obj: unknown) => {
      if (!closed) res.write(`${JSON.stringify(obj)}\n`);
    };

    try {
      const graph = await getGraphForDeveloper(p.developerId);
      const response = await answerTopicQuestion({
        graph,
        developerId: p.developerId,
        message: p.message,
        history: p.history,
        selectedTopic: p.topic,
        llm: chatLlm(),
        emit: (e: TraceEvent) => send(e),
      });
      send({ type: "done", response });
    } catch (error) {
      console.error("POST /api/topics/chat/stream failed:", error);
      send({ type: "error", error: "Failed to answer. Please try again." });
    } finally {
      res.end();
    }
  },
);

export default topicsChatRouter;
