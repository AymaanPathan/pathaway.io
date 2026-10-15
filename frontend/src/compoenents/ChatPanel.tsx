/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Check,
  ChevronRight,
  Copy,
  Database,
  ExternalLink,
  Loader2,
  Timer,
  Wrench,
  X,
} from "lucide-react";

const YELLOW = "#F5C542";
const CORAL = "#F2704F";
const GREEN = "#3FA24A";
const LAVENDER = "#D8D0F2";
const CREAM = "#FBF3D6";
const INK = "#101210";
const LINE = "#DAD6CC";
const DISPLAY_FONT = '"Space Grotesk", "Arial Black", sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const border = { border: `2px solid ${INK}` };
const shadow = (n = 4) => `${n}px ${n}px 0 0 ${INK}`;

/** Append this to the page's <style> string. */
export const CHAT_CSS = `
@keyframes pw-blink { 0%,49% { opacity:1 } 50%,100% { opacity:0 } }
.pw-blink { animation: pw-blink 1s steps(1) infinite; }
@keyframes pw-spin { to { transform: rotate(360deg) } }
.pw-spin { animation: pw-spin .9s linear infinite; }
@keyframes pw-pulse-bar { 0%,100% { opacity:.55 } 50% { opacity:1 } }
.pw-pulse-bar { animation: pw-pulse-bar 1.1s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .pw-blink, .pw-spin, .pw-pulse-bar { animation: none; } }
`;

const TONE_COLORS = {
  win: [GREEN, "#fff"],
  info: [LAVENDER, INK],
  error: [CORAL, "#fff"],
} as const;

const LEVEL_LABEL: Record<string, string> = {
  missing: "Not in your code yet",
  insufficient_evidence: "Barely seen",
  usage: "Used once or twice",
  repeated_usage: "Used repeatedly",
  implementation: "Built it yourself",
  strong: "Strong",
};

// ============================================================
// TYPES
// ============================================================

/** One operation line of a GRAPH.EXPLAIN / GRAPH.PROFILE plan. */
export type PlanNode = {
  depth: number;
  op: string;
  detail: string;
  records?: number;
  ms?: number;
};

/** One graph.query() call made by a tool. Mirrors QueryTrace in tools.index.ts. */
export type QueryTrace = {
  id: string;
  query: string;
  params?: unknown;
  ms: number;
  internalMs?: number;
  cached?: boolean;
  rows: number;
  error?: string;
  explain?: PlanNode[];
  profile?: PlanNode[];
  planError?: string;
};

export type DbStats = { queries: number; ms: number; traces?: QueryTrace[] };

/** What the page asks the server for: nothing, the plan, or the plan with timings. */
export type PlanMode = "explain" | "profile";

export type ToolCall = {
  name: string;
  summary?: string;
  input?: unknown;
  output?: unknown;
  ms?: number;
};

export type AgentAction =
  | { type: "mission"; capabilityId: string; name: string }
  | { type: "rescan" }
  | { type: "setGoal"; text: string }
  /** re-read the learning frontier from the backend */
  | { type: "refreshFrontier" };

/**
 * The authoritative learning frontier, as the goal page last read it from
 * the backend. `eligible` is null when the frontier is unavailable: in that
 * case no mission action may be offered.
 */
export type ChatFrontier = {
  eligible: Map<string, { name: string; canStart: boolean }> | null;
  onRefresh?: () => void;
};

export const ChatFrontierContext = createContext<ChatFrontier>({
  eligible: null,
});

export type ToolRun = {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  startedAt: number;
  ms?: number;
  db?: DbStats;
  result?: unknown;
  /** one-line note for tool cards that did not come from the registry */
  summary?: string;
};

export type ChatMeta = {
  totalMs: number;
  steps: number;
  tools: number;
  dbMs: number;
  queries: number;
  model: string;
};

export type ChatMsg = {
  id: string;
  role: "user" | "agent";
  text: string;
  /** live tool calls from the streaming agent */
  runs?: ToolRun[];
  /** older, non-streamed tool cards (set_goal, rescan_github, ...) */
  tools?: ToolCall[];
  actions?: AgentAction[];
  tone?: "win" | "info" | "error";
  pending?: boolean;
  streaming?: boolean;
  meta?: ChatMeta;
};

/** Mirrors ChatEvent in goal-chat-agent.ts. */
export type ChatEvent =
  | { type: "start"; model: string }
  | { type: "step"; step: number }
  | {
      type: "tool_start";
      id: string;
      tool: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_end";
      id: string;
      tool: string;
      args: Record<string, unknown>;
      result: unknown;
      ms: number;
      db?: DbStats;
    }
  | { type: "plans"; id: string; traces: QueryTrace[] }
  | { type: "token"; text: string }
  | { type: "reset" }
  | {
      type: "done";
      reply: string;
      actions: AgentAction[];
      focusCapabilityId?: string;
      stage?: string;
      meta?: ChatMeta;
    }
  | { type: "error"; message: string };

// ============================================================
// STREAMING CLIENT
// ============================================================

export class ChatHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function parseBlock(block: string): ChatEvent | null {
  let name = "";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!name) return null;
  try {
    const payload = data.length ? JSON.parse(data.join("\n")) : {};
    return { type: name, ...payload } as ChatEvent;
  } catch {
    return null;
  }
}

/**
 * POST /api/agent/chat/stream and call onEvent for every server event.
 * Token events are batched (about every 40 ms) so React is not re-rendered
 * once per token. Pass `plans` to get EXPLAIN / PROFILE for every query.
 */
export async function streamChat(opts: {
  message: string;
  history: Array<{ role: string; text: string }>;
  plans?: PlanMode;
  onEvent: (e: ChatEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const res = await fetch("/api/agent/chat/stream", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      message: opts.message,
      history: opts.history,
      plans: opts.plans,
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new ChatHttpError(
      res.status,
      (body as { error?: string }).error ?? "The agent could not answer",
    );
  }

  let pending = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let finished = false;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending) {
      opts.onEvent({ type: "token", text: pending });
      pending = "";
    }
  };

  const dispatch = (e: ChatEvent) => {
    if (e.type === "token") {
      pending += e.text;
      if (!timer) timer = setTimeout(flush, 40);
      return;
    }
    flush();
    if (e.type === "done" || e.type === "error") finished = true;
    opts.onEvent(e);
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let cut: number;
      while ((cut = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        const ev = parseBlock(block);
        if (ev) dispatch(ev);
      }
    }
  } finally {
    flush();
  }

  if (!finished) {
    opts.onEvent({
      type: "error",
      message: "The connection closed before the answer finished.",
    });
  }
}

/** Folds one server event into the message it belongs to. */
export function applyChatEvent(m: ChatMsg, e: ChatEvent): ChatMsg {
  switch (e.type) {
    case "start":
    case "step":
      return m;

    case "tool_start":
      return {
        ...m,
        runs: [
          ...(m.runs ?? []),
          {
            id: e.id,
            tool: e.tool,
            args: e.args ?? {},
            status: "running",
            startedAt: Date.now(),
          },
        ],
      };

    case "tool_end":
      return {
        ...m,
        runs: (m.runs ?? []).map((r) =>
          r.id === e.id
            ? {
                ...r,
                args: e.args ?? r.args,
                status: isErrorResult(e.result) ? "error" : "done",
                ms: e.ms,
                db: e.db,
                result: e.result,
              }
            : r,
        ),
      };

    // EXPLAIN / PROFILE arrive after tool_end and replace the plain traces.
    case "plans":
      return {
        ...m,
        runs: (m.runs ?? []).map((r) =>
          r.id === e.id
            ? {
                ...r,
                db: {
                  queries: r.db?.queries ?? e.traces.length,
                  ms: r.db?.ms ?? 0,
                  traces: e.traces,
                },
              }
            : r,
        ),
      };

    case "token":
      return { ...m, text: m.text + e.text };

    case "reset":
      return { ...m, text: "" };

    case "done":
      return {
        ...m,
        streaming: false,
        text: e.reply || "I could not find anything in your graph for that.",
        actions: e.actions,
        meta: e.meta,
      };

    case "error":
      return {
        ...m,
        streaming: false,
        tone: "error",
        text: e.message,
        runs: (m.runs ?? []).map((r) =>
          r.status === "running" ? { ...r, status: "error" } : r,
        ),
      };
  }
}

// ============================================================
// HELPERS
// ============================================================

function isErrorResult(v: unknown): boolean {
  return !!v && typeof v === "object" && !Array.isArray(v) && "error" in v;
}

function fmtMs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "";
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms * 100) / 100} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function asList(v: unknown): any[] {
  return Array.isArray(v) ? v : [];
}

function argSummary(args: Record<string, unknown>): string {
  const parts = Object.entries(args ?? {}).map(([k, v]) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return `${k}=${s.length > 28 ? `${s.slice(0, 27)}…` : s}`;
  });
  return parts.join(" · ");
}

function pretty(value: unknown): string {
  let s: string;
  try {
    s = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    s = String(value);
  }
  return s.length > 4000 ? `${s.slice(0, 4000)}\n…` : s;
}

/** The tool whose result decides what is eligible. Everything else is context. */
const FRONTIER_TOOL = "get_learning_frontier";

/** What each registry tool is, and which FalkorDB feature it uses. */
const TOOL_META: Record<
  string,
  { label: string; asks: string; engine: string; authoritative?: boolean }
> = {
  get_learning_frontier: {
    label: "Learning frontier",
    asks: "Which capabilities can I work on now? FalkorDB decides from the prerequisites you have met.",
    engine: "Cypher · prerequisite check",
    authoritative: true,
  },
  find_gaps: {
    label: "Capability diagnostics (legacy)",
    asks: "Which goal skills have little evidence yet? Scores are diagnostics only: they do not decide what you can start.",
    engine: "Cypher",
  },
  rank_leverage: {
    label: "Graph diagnostics (legacy)",
    asks: "How connected is each skill in the graph? Context only: it does not rank what to do next.",
    engine: "algo.BFS · pageRank · betweenness",
  },
  find_bridge_path: {
    label: "Find bridge path",
    asks: "What is the closest route from work you built?",
    engine: "algo.SPpaths",
  },
  search_capabilities: {
    label: "Search skills",
    asks: "Which skills match this text?",
    engine: "Full-text index",
  },
  get_evidence: {
    label: "Get evidence",
    asks: "Which code proves this skill?",
    engine: "Cypher",
  },
};

function engineOf(run: ToolRun): string {
  const r: any = run.result;
  const dynamic =
    (r && !Array.isArray(r) && typeof r.engine === "string" && r.engine) ||
    (Array.isArray(r) && typeof r[0]?.engine === "string" && r[0].engine) ||
    "";
  if (dynamic) return dynamic;
  return TOOL_META[run.tool]?.engine ?? "";
}

function toRuns(m: ChatMsg): ToolRun[] {
  if (m.runs && m.runs.length > 0) return m.runs;
  return (m.tools ?? []).map((t, i) => ({
    id: `legacy-${i}`,
    tool: t.name,
    args: (t.input && typeof t.input === "object"
      ? (t.input as Record<string, unknown>)
      : {}) as Record<string, unknown>,
    status: "done" as const,
    startedAt: 0,
    ms: t.ms,
    result: t.output,
    summary: t.summary,
  }));
}

// ============================================================
// SMALL PIECES
// ============================================================

function Pill({
  children,
  fill = "#fff",
  color = INK,
  dashed = false,
}: {
  children: React.ReactNode;
  fill?: string;
  color?: string;
  dashed?: boolean;
}) {
  return (
    <span
      style={{
        backgroundColor: fill,
        color,
        border: `1.5px ${dashed ? "dashed" : "solid"} ${INK}`,
      }}
      className="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold leading-snug"
    >
      {children}
    </span>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);
  return <>{fmtMs(now - since)}</>;
}

function Meter({
  value,
  max,
  fill = GREEN,
}: {
  value: number;
  max: number;
  fill?: string;
}) {
  return (
    <div
      style={{ border: `1.5px solid ${INK}`, backgroundColor: LINE }}
      className="mt-1 h-2 overflow-hidden rounded-full"
    >
      <div
        style={{
          width: `${Math.max(4, (value / Math.max(0.0001, max)) * 100)}%`,
          backgroundColor: fill,
          height: "100%",
        }}
      />
    </div>
  );
}

// ============================================================
// MARKDOWN
// ============================================================

const mdComponents: Components = {
  h1: ({ children }) => (
    <h3
      style={{ fontFamily: DISPLAY_FONT }}
      className="mt-4 text-[18px] font-bold leading-tight first:mt-0"
    >
      {children}
    </h3>
  ),
  h2: ({ children }) => (
    <h3
      style={{ fontFamily: DISPLAY_FONT }}
      className="mt-4 text-[18px] font-bold leading-tight first:mt-0"
    >
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h4
      style={{ borderBottom: `1.5px solid ${LINE}` }}
      className="mb-1 mt-4 pb-1 text-[11px] font-bold uppercase tracking-wider text-neutral-500 first:mt-0"
    >
      {children}
    </h4>
  ),
  h4: ({ children }) => (
    <h5 className="mt-3 text-[13px] font-bold first:mt-0">{children}</h5>
  ),
  p: ({ children }) => (
    <p className="mt-2 text-[14px] leading-relaxed first:mt-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] leading-relaxed marker:text-neutral-400">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-2 list-decimal space-y-1 pl-5 text-[14px] leading-relaxed">
      {children}
    </ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  strong: ({ children }) => <strong className="font-bold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  hr: () => <hr style={{ borderColor: LINE }} className="my-3" />,
  blockquote: ({ children }) => (
    <blockquote
      style={{ borderLeft: `3px solid ${YELLOW}` }}
      className="mt-2 pl-3 text-[13px] text-neutral-700"
    >
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-0.5 font-semibold underline decoration-2 underline-offset-2"
    >
      {children}
      <ExternalLink size={11} aria-hidden />
    </a>
  ),
  code: ({ children }) => (
    <code
      style={{ fontFamily: MONO, border: `1px solid ${LINE}` }}
      className="break-words rounded bg-[#F8F6F0] px-1 py-px text-[12px]"
    >
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre
      style={{ fontFamily: MONO, border: `1.5px solid ${LINE}` }}
      className="mt-2 max-h-48 overflow-auto rounded-lg bg-[#F8F6F0] p-2.5 text-[12px] leading-snug [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0"
    >
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div style={border} className="mt-2 overflow-x-auto rounded-xl bg-white">
      <table className="w-full border-collapse text-left text-[12px]">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead style={{ backgroundColor: CREAM }}>{children}</thead>
  ),
  th: ({ children }) => (
    <th
      style={{ borderBottom: `2px solid ${INK}` }}
      className="whitespace-nowrap px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider"
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td
      style={{ borderTop: `1px solid ${LINE}` }}
      className="px-2.5 py-1.5 align-top"
    >
      {children}
    </td>
  ),
};

function Markdown({ source }: { source: string }) {
  return (
    <div className="min-w-0 break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {source}
      </ReactMarkdown>
    </div>
  );
}

// ============================================================
// TOOL RESULT VIEWS
// ============================================================

function NoteView({ note }: { note: string }) {
  return <p className="text-[12px] italic text-neutral-600">{note}</p>;
}

/**
 * The authoritative learning frontier. Every eligible capability is shown as
 * an equal alternative: no rank, no score, no "best" one. The order is the
 * order the backend returned (by name).
 */
function FrontierView({ result }: { result: any }) {
  const { eligible } = useContext(ChatFrontierContext);
  const steps = asList(result?.nextSteps).filter(
    (s) => s && typeof s === "object",
  );
  const p = result?.progress;
  const criteria = asList(result?.criteria).filter(
    (item) => item && typeof item === "object",
  );

  return (
    <div className="space-y-2.5">
      {p && typeof p === "object" && (
        <div
          style={{ ...border, backgroundColor: CREAM }}
          className="rounded-xl p-2.5"
        >
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-600">
                Goal progress
              </div>
              <div style={{ fontFamily: DISPLAY_FONT }} className="mt-1 text-[18px] font-bold">
                {num(p.demonstrated)} / {num(p.total)} demonstrated
              </div>
            </div>
            <Pill fill={num(p.goalComplete) ? GREEN : YELLOW} color={num(p.goalComplete) ? "#fff" : INK}>
              {num(p.goalComplete) ? "Complete" : `${num(p.eligible)} open now`}
            </Pill>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px] font-semibold text-neutral-600">
            <span>Blocked: {num(p.blocked)}</span>
            <span>In progress: {num(p.inProgress)}</span>
          </div>
        </div>
      )}

      {steps.length === 0 ? (
        <NoteView
          note={
            p?.goalComplete
              ? "Goal complete: every capability on the path is demonstrated."
              : p && num(p.total) > 0
                ? "Nothing is eligible yet. Earlier prerequisites must be demonstrated first."
                : "The frontier returned no eligible capabilities."
          }
        />
      ) : (
        <>
          <p className="text-[11px] text-neutral-600">
            {steps.length} eligible{" "}
            {steps.length === 1 ? "capability" : "capabilities"}. They are equal
            alternatives, listed in the order returned. None is preferred.
          </p>
          <ul className="space-y-2">
            {steps.map((s, i) => {
              const id = String(s.capabilityId ?? "");
              const prereqs = asList(s.prerequisites).filter(
                (x) => x && typeof x === "object",
              );
              const route = asList(asList(s.paths)[0]?.steps)
                .map((x) => String(x?.name ?? ""))
                .filter(Boolean);
              const unlocks = asList(s.unlocks)
                .map((u) => String(u))
                .filter(Boolean);
              const evidence = [
                ...asList(s.evidence),
                ...asList(s.built),
              ].filter((e) => e && typeof e === "object");
              const entry = eligible?.get(id);

              return (
                <li
                  key={id || i}
                  style={{ border: `1.5px solid ${INK}` }}
                  className="rounded-lg bg-white p-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="text-[12px] font-bold">
                      {String(s.name ?? id)}
                    </span>
                    <Pill fill={YELLOW}>Eligible</Pill>
                  </div>
                  {s.reason && (
                    <p className="mt-1 text-[11.5px] leading-snug text-neutral-700">
                      {String(s.reason)}
                    </p>
                  )}
                  {prereqs.length > 0 && (
                    <div className="mt-1.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                        Direct prerequisites
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {prereqs.map((x, j) => (
                          <Pill
                            key={`${String(x.name)}-${j}`}
                            fill={x.satisfied ? GREEN : "#fff"}
                            color={x.satisfied ? "#fff" : INK}
                            dashed={!x.satisfied}
                          >
                            {String(x.name)}
                            {x.level
                              ? ` · ${LEVEL_LABEL[String(x.level)] ?? String(x.level)}`
                              : ""}
                          </Pill>
                        ))}
                      </div>
                    </div>
                  )}
                  {route.length > 1 && (
                    <div
                      style={{ fontFamily: MONO }}
                      className="mt-1.5 break-words text-[10.5px] text-neutral-600"
                    >
                      Path: {route.join(" → ")}
                    </div>
                  )}
                  {unlocks.length > 0 && (
                    <div className="mt-1 text-[11px] text-neutral-700">
                      Unlocks: <b>{unlocks.join(", ")}</b>
                    </div>
                  )}
                  {evidence.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {evidence.slice(0, 3).map((e, j) => (
                        <li key={j} className="text-[11px] text-neutral-700">
                          <span className="font-semibold">
                            {String(e.technique ?? "Your code")}
                          </span>
                          {e.repository ? ` · ${String(e.repository)}` : ""}
                          {e.path ? ` · ${String(e.path)}` : ""}
                          {e.permalink && (
                            <a
                              href={String(e.permalink)}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-1 inline-flex items-center gap-0.5 font-semibold underline"
                            >
                              GitHub <ExternalLink size={10} />
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {entry?.canStart && (
                    <Link
                      to={`/mission?capability=${id}`}
                      style={{
                        ...border,
                        backgroundColor: GREEN,
                        color: "#fff",
                      }}
                      className="pw-btn mt-2 inline-flex items-center gap-1 rounded-full px-3 py-0.5 text-[11px] font-bold"
                    >
                      Start mission <ChevronRight size={12} />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
          {criteria.length > 0 && (
            <div
              style={{ border: `1.5px solid ${INK}`, backgroundColor: "#fff" }}
              className="rounded-xl p-2.5"
            >
              <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                Completion criteria
              </div>
              <ul className="mt-1.5 space-y-1">
                {criteria.slice(0, 4).map((criterion, index) => (
                  <li
                    key={String(criterion.capabilityId ?? index)}
                    className="flex items-start gap-1.5 text-[11px]"
                  >
                    <span
                      aria-hidden
                      style={{ color: criterion.met ? GREEN : CORAL }}
                      className="font-bold"
                    >
                      {criterion.met ? "✓" : "!"}
                    </span>
                    <span>
                      <b>{String(criterion.name ?? criterion.capabilityId)}</b>
                      {!criterion.met &&
                        asList(criterion.unmet).length > 0 &&
                        ` — ${String(asList(criterion.unmet)[0])}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Legacy find_gaps result. Scores are diagnostics: no rank, no winner. */
function GapsView({ rows }: { rows: any[] }) {
  return (
    <div>
      <NoteView note="These are eligible alternatives from the graph. They are not ranked; use the learning frontier as the source of truth." />
      <ul className="mt-2 space-y-2.5">
        {rows.map((r, i) => (
          <li key={r.capability_id ?? i} className="text-[12px]">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold">{r.name}</span>
              <Pill fill={YELLOW}>Eligible</Pill>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <Pill>
                {LEVEL_LABEL[String(r.level)] ?? String(r.level || "unknown")}
              </Pill>
              <span className="text-[11px] text-neutral-600">
                {num(r.evidence_count)} places
                {r.readiness_anchor ? ` · near ${r.readiness_anchor}` : ""}
                {asList(r.linked_goal_skills).length > 0
                  ? ` · near ${asList(r.linked_goal_skills).length} goal skills`
                  : ""}
              </span>
            </div>
            {asList(r.prerequisites).length > 0 && (
              <div className="mt-1 text-[11px] text-neutral-600">
                Prerequisites:{" "}
                {asList(r.prerequisites)
                  .map((p) => String(p.name ?? ""))
                  .filter(Boolean)
                  .join(", ")}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Legacy rank_leverage result: graph metrics, context only. */
function LeverageView({ rows }: { rows: any[] }) {
  return (
    <div>
      <NoteView note="Graph metrics for context. They never decide eligibility or which capability to start." />
      <ul className="mt-2 space-y-2.5">
        {rows.map((r, i) => (
          <li key={r.capability_id ?? i} className="text-[12px]">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold">{r.name}</span>
              <Pill fill={CREAM}>Graph context</Pill>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <Pill fill={CREAM}>unlocks {num(r.unlock_count)}</Pill>
              <Pill fill="#fff">PageRank {num(r.pagerank).toFixed(3)}</Pill>
              <Pill fill="#fff">
                Betweenness {num(r.betweenness).toFixed(3)}
              </Pill>
            </div>
            {asList(r.unlocks_goal_skills).length > 0 && (
              <div className="mt-0.5 text-[11px] text-neutral-600">
                Also near: {asList(r.unlocks_goal_skills).join(", ")}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BridgeView({ result }: { result: any }) {
  const routes = asList(result.routes);
  if (routes.length === 0) {
    return (
      <NoteView note={String(result.note ?? "No route found within 4 hops.")} />
    );
  }
  return (
    <div>
      <div className="mb-1.5 text-[12px]">
        Target: <b>{String(result.target ?? "")}</b>
      </div>
      <ul className="space-y-2">
        {routes.map((r, i) => (
          <li
            key={i}
            style={{ border: `1.5px solid ${LINE}` }}
            className="rounded-lg bg-white p-2"
          >
            <div className="flex flex-wrap items-center gap-1">
              <Pill fill={GREEN} color="#fff">
                {String(r.from_skill)}
              </Pill>
              <ChevronRight size={12} aria-hidden />
              <Pill fill={CORAL} color="#fff">
                {String(result.target ?? "target")}
              </Pill>
              <span className="ml-auto text-[11px] text-neutral-600">
                {num(r.hops)} {num(r.hops) === 1 ? "hop" : "hops"} · cost{" "}
                {num(r.cost).toFixed(2)}
              </span>
            </div>
            <div
              style={{ fontFamily: MONO }}
              className="mt-1.5 break-words text-[11px] leading-snug"
            >
              {String(r.route)}
            </div>
            <div className="mt-1 text-[11px] text-neutral-500">
              {LEVEL_LABEL[String(r.from_level)] ?? String(r.from_level)} ·{" "}
              {num(r.from_evidence)} places
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SearchView({ rows }: { rows: any[] }) {
  const max = Math.max(0.0001, ...rows.map((r) => num(r.score)));
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={r.capability_id ?? i} className="text-[12px]">
          <div className="flex justify-between gap-2">
            <span className="font-bold">{String(r.name)}</span>
            <span style={{ fontFamily: MONO }}>{num(r.score).toFixed(3)}</span>
          </div>
          <Meter value={num(r.score)} max={max} fill={LAVENDER} />
          <div
            style={{ fontFamily: MONO }}
            className="mt-0.5 text-[10.5px] text-neutral-500"
          >
            {String(r.capability_id)}
          </div>
        </li>
      ))}
    </ul>
  );
}

function EvidenceView({ result }: { result: any }) {
  const demos = asList(result.demonstrations);
  const guards = asList(result.safeguards);
  return (
    <div className="space-y-2.5">
      <div className="text-[12px]">
        Skill: <b>{String(result.capability ?? "")}</b>
      </div>
      {demos.length === 0 && (
        <NoteView note="No code found for this skill in the synced repositories." />
      )}
      {demos.map((d, i) => (
        <div
          key={i}
          style={{ border: `1.5px solid ${LINE}` }}
          className="rounded-lg bg-white p-2"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-[12px] font-bold">{String(d.technique)}</span>
            <Pill
              fill={d.depth === "usage" ? "#fff" : GREEN}
              color={d.depth === "usage" ? INK : "#fff"}
            >
              {String(d.depth)}
            </Pill>
          </div>
          <div className="mt-0.5 text-[11px] text-neutral-600">
            {String(d.repository)}
            {d.path ? ` · ${String(d.path)}` : ""}
          </div>
          {d.snippet && (
            <pre
              style={{ fontFamily: MONO, border: `1.5px solid ${LINE}` }}
              className="mt-1.5 max-h-28 overflow-auto rounded-md bg-[#F8F6F0] p-1.5 text-[10.5px] leading-snug"
            >
              {String(d.snippet)}
            </pre>
          )}
          {asList(d.habits_shown).length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {asList(d.habits_shown).map((h) => (
                <Pill key={String(h)} fill="#E4F3E5">
                  {String(h)}
                </Pill>
              ))}
            </div>
          )}
          {d.permalink && (
            <a
              href={String(d.permalink)}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold underline"
            >
              Open on GitHub <ExternalLink size={10} />
            </a>
          )}
        </div>
      ))}
      {guards.map((g, i) => (
        <div key={i} className="text-[11px]">
          <div className="font-bold">{String(g.technique)}</div>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {asList(g.have).map((s) => (
              <Pill key={`h-${String(s)}`} fill={GREEN} color="#fff">
                {String(s)}
              </Pill>
            ))}
            {asList(g.missing).map((s) => (
              <Pill key={`m-${String(s)}`} dashed>
                {String(s)}
              </Pill>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ResultView({ run }: { run: ToolRun }) {
  const { onRefresh } = useContext(ChatFrontierContext);
  const r: any = run.result;

  if (run.status === "running") {
    return <NoteView note="Waiting for FalkorDB…" />;
  }

  if (isErrorResult(r)) {
    const isFrontier = run.tool === FRONTIER_TOOL;
    return (
      <div className="text-[12px]">
        {isFrontier && (
          <div className="mb-1 font-bold">
            The learning frontier is unavailable, so no recommendation is shown.
          </div>
        )}
        <div style={{ color: CORAL }} className="font-bold">
          {String(r.error)}
        </div>
        {r.hint && (
          <div className="mt-0.5 text-neutral-600">{String(r.hint)}</div>
        )}
        {isFrontier && onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            style={{ ...border, backgroundColor: YELLOW }}
            className="pw-btn mt-2 rounded-full px-3 py-0.5 text-[11px] font-bold"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  if (
    r &&
    !Array.isArray(r) &&
    typeof r === "object" &&
    typeof r.note === "string" &&
    Object.keys(r).length === 1
  ) {
    return <NoteView note={r.note} />;
  }

  switch (run.tool) {
    case FRONTIER_TOOL:
      if (r && typeof r === "object") return <FrontierView result={r} />;
      break;
    case "find_gaps":
      if (Array.isArray(r)) return <GapsView rows={r} />;
      break;
    case "rank_leverage":
      if (Array.isArray(r)) return <LeverageView rows={r} />;
      break;
    case "find_bridge_path":
      if (r && typeof r === "object") return <BridgeView result={r} />;
      break;
    case "search_capabilities":
      if (Array.isArray(r)) return <SearchView rows={r} />;
      break;
    case "get_evidence":
      if (r && typeof r === "object") return <EvidenceView result={r} />;
      break;
  }

  return (
    <div>
      {run.summary && (
        <p className="mb-1.5 text-[12px] text-neutral-700">{run.summary}</p>
      )}
      {r !== undefined && (
        <pre
          style={{ fontFamily: MONO }}
          className="max-h-40 overflow-auto whitespace-pre-wrap text-[11px]"
        >
          {pretty(r)}
        </pre>
      )}
    </div>
  );
}

// ============================================================
// QUERY VIEW (Cypher, EXPLAIN, PROFILE)
// ============================================================

/**
 * One plan, drawn as an indented tree. In a PROFILE plan each operation gets
 * a bar sized against the slowest operation, which is drawn in coral.
 */
function PlanTree({ nodes }: { nodes: PlanNode[] }) {
  const max = Math.max(0, ...nodes.map((n) => n.ms ?? 0));
  const slowest = nodes.findIndex((n) => (n.ms ?? -1) === max && max > 0);

  return (
    <ul
      style={{ border: `1.5px solid ${LINE}` }}
      className="mt-1 space-y-1 rounded-md bg-[#F8F6F0] p-2"
    >
      {nodes.map((n, i) => (
        <li
          key={i}
          style={{ paddingLeft: n.depth * 12, fontFamily: MONO }}
          className="text-[10.5px] leading-snug"
        >
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="font-bold">{n.op}</span>
            {n.detail && (
              <span className="break-all text-neutral-500">{n.detail}</span>
            )}
            {n.ms !== undefined && (
              <span
                className="ml-auto shrink-0"
                style={{ color: i === slowest ? CORAL : undefined }}
              >
                {n.records ?? 0} rows · {fmtMs(n.ms)}
              </span>
            )}
          </div>
          {n.ms !== undefined && (
            <Meter
              value={n.ms}
              max={max}
              fill={i === slowest ? CORAL : GREEN}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

function QueriesView({ run }: { run: ToolRun }) {
  const traces = run.db?.traces ?? [];

  if (run.status === "running") {
    return <NoteView note="Waiting for FalkorDB…" />;
  }
  if (traces.length === 0) {
    return <NoteView note="This tool made no FalkorDB queries." />;
  }

  return (
    <ul className="space-y-2.5">
      {traces.map((q, i) => (
        <li
          key={q.id}
          style={{ border: `1.5px solid ${q.error ? CORAL : LINE}` }}
          className="rounded-lg bg-white p-2"
        >
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[11px] font-bold">Query {i + 1}</span>
            <Pill fill={CREAM}>wall {fmtMs(q.ms)}</Pill>
            {q.internalMs !== undefined && (
              <Pill>engine {fmtMs(q.internalMs)}</Pill>
            )}
            {q.cached !== undefined && (
              <Pill
                fill={q.cached ? GREEN : "#fff"}
                color={q.cached ? "#fff" : INK}
              >
                {q.cached ? "plan cached" : "plan compiled"}
              </Pill>
            )}
            <Pill>{q.rows} rows</Pill>
            {q.error && (
              <Pill fill={CORAL} color="#fff">
                failed
              </Pill>
            )}
          </div>

          {q.error && (
            <p style={{ color: CORAL }} className="mt-1 text-[11px] font-bold">
              {q.error}
            </p>
          )}

          <pre
            style={{ fontFamily: MONO, border: `1.5px solid ${LINE}` }}
            className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-[#F8F6F0] p-1.5 text-[10.5px] leading-snug"
          >
            {q.query}
          </pre>

          {q.params !== undefined && q.params !== null && (
            <div
              style={{ fontFamily: MONO }}
              className="mt-1 break-words text-[10.5px] text-neutral-500"
            >
              params {pretty(q.params).replace(/\s+/g, " ")}
            </div>
          )}

          {q.planError && (
            <NoteView note={`Plan unavailable: ${q.planError}`} />
          )}

          {q.profile && q.profile.length > 0 ? (
            <>
              <div className="mt-2 text-[11px] font-bold text-neutral-500">
                Profile (query was executed)
              </div>
              <PlanTree nodes={q.profile} />
            </>
          ) : q.explain && q.explain.length > 0 ? (
            <>
              <div className="mt-2 text-[11px] font-bold text-neutral-500">
                Execution plan
              </div>
              <PlanTree nodes={q.explain} />
            </>
          ) : !q.planError ? (
            <p className="mt-1.5 text-[11px] italic text-neutral-500">
              No plan for this query. Turn on Explain or Profile to see one.
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// ============================================================
// TOOL TIMELINE
// ============================================================

type RunTab = "result" | "queries" | "args" | "raw";

function RunRow({
  run,
  maxMs,
  open,
  onToggle,
}: {
  run: ToolRun;
  maxMs: number;
  open: boolean;
  onToggle: () => void;
}) {
  const [tab, setTab] = useState<RunTab>("result");
  const meta = TOOL_META[run.tool];
  const engine = engineOf(run);
  const running = run.status === "running";
  const failed = run.status === "error";
  const wall = run.ms ?? 0;
  const db = run.db?.ms ?? 0;
  const queryCount = run.db?.traces?.length ?? 0;

  return (
    <li
      style={{
        border: `1.5px solid ${INK}`,
        backgroundColor: running ? CREAM : "#fff",
      }}
      className="rounded-xl"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="pw-btn flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left"
      >
        <span
          style={{
            border: `1.5px solid ${INK}`,
            backgroundColor: running ? YELLOW : failed ? CORAL : GREEN,
            color: running ? INK : "#fff",
          }}
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
        >
          {running ? (
            <Loader2 size={11} className="pw-spin" aria-label="Running" />
          ) : failed ? (
            <X size={11} aria-label="Failed" />
          ) : (
            <Check size={11} aria-label="Done" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2">
            <span
              style={{ fontFamily: MONO }}
              className="text-[12px] font-bold"
            >
              {run.tool}
            </span>
            {meta?.authoritative && <Pill fill={YELLOW}>Authoritative</Pill>}
            {engine && (
              <span className="text-[10.5px] text-neutral-500">{engine}</span>
            )}
          </span>
          <span className="block truncate text-[11px] text-neutral-600">
            {argSummary(run.args) || meta?.asks || run.summary || ""}
          </span>

          {(running || run.ms !== undefined) && (
            <span
              style={{ border: `1.5px solid ${INK}`, backgroundColor: LINE }}
              className="mt-1.5 block h-2 overflow-hidden rounded-full"
              title={`Total ${fmtMs(wall)} · FalkorDB ${fmtMs(db)}`}
            >
              {running ? (
                <span
                  style={{ backgroundColor: YELLOW, width: "100%" }}
                  className="pw-pulse-bar block h-full"
                />
              ) : (
                <span
                  style={{
                    width: `${Math.max(6, (wall / Math.max(1, maxMs)) * 100)}%`,
                    backgroundColor: LAVENDER,
                  }}
                  className="block h-full"
                >
                  <span
                    style={{
                      width: `${wall > 0 ? Math.min(100, (db / wall) * 100) : 0}%`,
                      backgroundColor: GREEN,
                    }}
                    className="block h-full"
                  />
                </span>
              )}
            </span>
          )}
        </span>

        <span className="shrink-0 text-right text-[11px] leading-tight">
          <span style={{ fontFamily: MONO }} className="block font-bold">
            {running ? <Elapsed since={run.startedAt} /> : fmtMs(run.ms)}
          </span>
          {run.db && run.db.queries > 0 && (
            <span
              style={{ fontFamily: MONO }}
              className="block text-neutral-500"
            >
              db {fmtMs(run.db.ms)} · {run.db.queries}q
            </span>
          )}
        </span>
      </button>

      {open && (
        <div
          style={{ borderTop: `1.5px solid ${LINE}` }}
          className="px-2.5 pb-2.5 pt-2"
        >
          {meta && (
            <p className="mb-1.5 text-[11px] text-neutral-600">
              <b>{meta.label}.</b> {meta.asks}
            </p>
          )}
          <div role="tablist" className="mb-2 flex flex-wrap gap-1">
            {(["result", "queries", "args", "raw"] as RunTab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                style={{
                  border: `1.5px solid ${INK}`,
                  backgroundColor: tab === t ? YELLOW : "#fff",
                }}
                className="pw-btn rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize"
              >
                {t === "queries" ? `queries (${queryCount})` : t}
              </button>
            ))}
          </div>

          {tab === "result" && <ResultView run={run} />}
          {tab === "queries" && <QueriesView run={run} />}
          {tab === "args" && (
            <pre
              style={{ fontFamily: MONO }}
              className="max-h-40 overflow-auto whitespace-pre-wrap text-[11px]"
            >
              {pretty(run.args)}
            </pre>
          )}
          {tab === "raw" && (
            <pre
              style={{ fontFamily: MONO, border: `1.5px solid ${LINE}` }}
              className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-[#F8F6F0] p-2 text-[10.5px]"
            >
              {pretty(run.result)}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}

function ToolTimeline({ runs }: { runs: ToolRun[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  const maxMs = useMemo(
    () => Math.max(1, ...runs.map((r) => r.ms ?? 0)),
    [runs],
  );

  const doneRuns = runs.filter((r) => r.status !== "running");
  const wall = doneRuns.reduce((s, r) => s + (r.ms ?? 0), 0);
  const dbMs = doneRuns.reduce((s, r) => s + (r.db?.ms ?? 0), 0);
  const queries = doneRuns.reduce((s, r) => s + (r.db?.queries ?? 0), 0);

  return (
    <div className="mb-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
          <Wrench size={11} aria-hidden /> Tool registry · {runs.length}{" "}
          {runs.length === 1 ? "call" : "calls"}
        </span>
        {doneRuns.length > 0 && (
          <>
            <span
              style={{ fontFamily: MONO }}
              className="inline-flex items-center gap-1 text-[11px] text-neutral-600"
            >
              <Timer size={11} aria-hidden /> {fmtMs(wall)}
            </span>
            <span
              style={{ fontFamily: MONO }}
              className="inline-flex items-center gap-1 text-[11px] text-neutral-600"
            >
              <Database size={11} aria-hidden /> FalkorDB {fmtMs(dbMs)} ·{" "}
              {queries} {queries === 1 ? "query" : "queries"}
            </span>
          </>
        )}
      </div>

      <ul className="space-y-1.5">
        {runs.map((r) => (
          <RunRow
            key={r.id}
            run={r}
            maxMs={maxMs}
            open={openId === r.id}
            onToggle={() => setOpenId(openId === r.id ? null : r.id)}
          />
        ))}
      </ul>

      <div className="mt-1.5 flex items-center gap-3 text-[10px] text-neutral-500">
        <span className="inline-flex items-center gap-1">
          <span
            style={{ backgroundColor: GREEN, border: `1px solid ${INK}` }}
            className="inline-block h-2 w-2 rounded-sm"
          />
          FalkorDB time
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            style={{ backgroundColor: LAVENDER, border: `1px solid ${INK}` }}
            className="inline-block h-2 w-2 rounded-sm"
          />
          Rest of the tool
        </span>
      </div>
    </div>
  );
}

// ============================================================
// MESSAGE
// ============================================================

function StatusLine({ label }: { label: string }) {
  return (
    <div
      className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-neutral-600"
      role="status"
      aria-live="polite"
    >
      <Loader2 size={12} className="pw-spin" aria-hidden />
      {label}
    </div>
  );
}

function Footer({ meta, text }: { meta?: ChatMeta; text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: nothing to do */
    }
  };

  return (
    <div
      style={{ borderTop: `1.5px solid ${LINE}` }}
      className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-[11px] text-neutral-500"
    >
      {meta && (
        <>
          <span style={{ fontFamily: MONO }}>{fmtMs(meta.totalMs)} total</span>
          <span style={{ fontFamily: MONO }}>
            {meta.tools} {meta.tools === 1 ? "tool" : "tools"}
          </span>
          <span style={{ fontFamily: MONO }}>
            FalkorDB {fmtMs(meta.dbMs)} · {meta.queries}q
          </span>
          <span style={{ fontFamily: MONO }} className="hidden sm:inline">
            {meta.model}
          </span>
        </>
      )}
      <button
        type="button"
        onClick={copy}
        className="pw-btn ml-auto inline-flex items-center gap-1 font-semibold text-neutral-700"
      >
        {copied ? (
          <Check size={12} aria-hidden />
        ) : (
          <Copy size={12} aria-hidden />
        )}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function MessageView({
  msg,
  onAction,
}: {
  msg: ChatMsg;
  onAction: (a: AgentAction) => void;
}) {
  // Mission actions are only offered for capabilities the goal page has read
  // as eligible from the authoritative frontier.
  const { eligible } = useContext(ChatFrontierContext);

  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div
          style={{ backgroundColor: INK, color: "#fff" }}
          className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md px-3.5 py-2 text-[14px] leading-relaxed"
        >
          {msg.text}
        </div>
      </div>
    );
  }

  const [bg, fg] = msg.tone ? TONE_COLORS[msg.tone] : (["#fff", INK] as const);
  const runs = toRuns(msg);
  const querying = runs.some((r) => r.status === "running");
  const phase = querying
    ? "Querying FalkorDB"
    : msg.text
      ? "Writing the answer"
      : runs.length > 0
        ? "Reading the results"
        : "Thinking";
  const done = !msg.streaming && !msg.pending;

  return (
    <div className="flex items-start gap-2">
      <span
        aria-hidden
        style={{ ...border, backgroundColor: YELLOW, fontFamily: DISPLAY_FONT }}
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold"
      >
        P
      </span>

      <div
        style={{ ...border, backgroundColor: bg, color: fg }}
        className="min-w-0 flex-1 rounded-2xl rounded-tl-md px-3.5 py-3"
      >
        {msg.pending ? (
          <StatusLine label="Reading your graph" />
        ) : (
          <>
            {msg.streaming && <StatusLine label={phase} />}

            {runs.length > 0 && <ToolTimeline runs={runs} />}

            {msg.text &&
              (msg.tone ? (
                <p className="whitespace-pre-wrap text-[14px] leading-relaxed">
                  {msg.text}
                </p>
              ) : (
                <>
                  <Markdown source={msg.text} />
                  {msg.streaming && (
                    <span
                      aria-hidden
                      style={{ backgroundColor: INK }}
                      className="pw-blink ml-0.5 inline-block h-[14px] w-[7px] align-middle"
                    />
                  )}
                </>
              ))}

            {msg.actions && msg.actions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {msg.actions.map((a, i) => {
                  if (a.type === "mission") {
                    const entry = eligible?.get(a.capabilityId);

                    if (entry?.canStart) {
                      return (
                        <Link
                          key={i}
                          to={`/mission?capability=${a.capabilityId}`}
                          style={{
                            ...border,
                            backgroundColor: GREEN,
                            color: "#fff",
                            boxShadow: shadow(2),
                          }}
                          className="pw-btn inline-flex items-center gap-1 rounded-full px-4 py-1.5 text-[13px] font-bold"
                        >
                          Start the {a.name} mission
                          <ChevronRight size={14} />
                        </Link>
                      );
                    }

                    const why =
                      eligible === null
                        ? "The learning frontier is not loaded, so no mission can be offered."
                        : entry
                          ? "Pathway cannot verify this skill with an automated check yet."
                          : "Only capabilities the frontier marks as eligible can start a mission.";

                    return (
                      <span
                        key={i}
                        title={why}
                        style={{
                          border: `2px dashed ${INK}`,
                          backgroundColor: "#fff",
                          color: INK,
                          opacity: 0.7,
                        }}
                        className="inline-flex items-center gap-1 rounded-full px-4 py-1.5 text-[13px] font-bold"
                      >
                        {a.name}: mission unavailable
                      </span>
                    );
                  }
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => onAction(a)}
                      style={{
                        ...border,
                        backgroundColor: YELLOW,
                        color: INK,
                        boxShadow: shadow(2),
                      }}
                      className="pw-btn rounded-full px-4 py-1.5 text-[13px] font-bold"
                    >
                      {a.type === "rescan"
                        ? "Re-scan my code"
                        : a.type === "refreshFrontier"
                          ? "Refresh the frontier"
                          : "Use this as my goal"}
                    </button>
                  );
                })}
              </div>
            )}

            {done && msg.text && !msg.tone && (
              <Footer meta={msg.meta} text={msg.text} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
