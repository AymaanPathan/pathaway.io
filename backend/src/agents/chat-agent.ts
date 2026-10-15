import type { Graph } from "../db/falkordb.js";
import type { DepthLlm } from "./depth-analyzer-agent.js";
import {
  ALL_TOOLS,
  TOOL_BY_NAME,
  createToolContext,
  describeTools,
  parseToolArgs,
  runTool,
  type DevTopic,
  type ToolRun,
  type UiBlock,
} from "../tools/index.js";



type Row = Record<string, any>;
const LOG = "[topic-chat]";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export type TraceEvent =
  | {
      type: "stage";
      stage: "planning" | "running" | "composing";
      agent: string;
      label: string;
    }
  | {
      type: "plan";
      by: "llm" | "rules";
      model: string | null;
      ms: number;
      calls: Array<{ tool: string; title: string; why: string; args: Row }>;
      skipped: Array<{ term: string; tool: string; reason: string }>;
    }
  | { type: "tool_start"; tool: string; title: string }
  | {
      type: "tool_done";
      tool: string;
      ok: boolean;
      ms: number;
      miss: boolean;
      note: string | null;
    }
  | { type: "compose_done"; usedLlm: boolean; ms: number }
  | { type: "answer_start" }
  | { type: "answer_delta"; text: string };

export interface TopicChatInput {
  graph: Graph;
  developerId: string;
  message: string;
  history?: ChatTurn[];
  
  selectedTopic?: string | null;
  
  llm: DepthLlm | null;
  
  emit?: (event: TraceEvent) => void;
}

export interface TopicChatToolInfo {
  name: string;
  title: string;
  description: string;
  features: string[];
  why: string;
  args: Row;
  ms: number;
  ok: boolean;
  
  miss: boolean;
  skipped: boolean;
  error: string | null;
  summary: string | null;
  
  contribution: string | null;
  
  how: string[];
}

export interface TopicChatResponse {
  answer: string;
  blocks: UiBlock[];
  
  topics: string[];
  followups: string[];
  tools: TopicChatToolInfo[];
  meta: {
    mode: "llm" | "rules" | "direct";
    model: string | null;
    plannerUsedLlm: boolean;
    composerUsedLlm: boolean;
    plannerMs: number;
    toolsMs: number;
    composeMs: number;
    durationMs: number;
  };
}

interface PlannedCall {
  tool: string;
  args: Row;
  why?: string;
}

interface AgentRun extends ToolRun {
  why: string;
  miss: boolean;
  skipped: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));


async function streamAnswer(
  text: string,
  emit?: (e: TraceEvent) => void,
): Promise<void> {
  if (!emit || !text) return;
  emit({ type: "answer_start" });
  const parts = text.match(/\S+\s*|\s+/g) ?? [text];
  let buf = "";
  let count = 0;
  for (const p of parts) {
    buf += p;
    count += 1;
    if (count % 3 === 0) {
      emit({ type: "answer_delta", text: buf });
      buf = "";
      await sleep(22);
    }
  }
  if (buf) emit({ type: "answer_delta", text: buf });
}



let llmFails = 0;
let llmPausedUntil = 0;
const noteLlm = (ok: boolean): void => {
  if (ok) {
    llmFails = 0;
    return;
  }
  llmFails += 1;
  if (llmFails >= 3) {
    llmFails = 0;
    llmPausedUntil = Date.now() + 60_000;
    console.warn(
      `${LOG} LLM paused for 60s after repeated failures; rules mode`,
    );
  }
};

async function askJson(
  llm: DepthLlm | null,
  stage: "discover" | "synthesize",
  system: string,
  user: string,
  maxTokens: number,
): Promise<Row | null> {
  if (!llm || Date.now() < llmPausedUntil) return null;
  try {
    const out = await llm.completeJson({
      stage,
      system,
      user,
      maxTokens,
      temperature: stage === "discover" ? 0.1 : 0.3,
    });
    if (out && typeof out === "object" && !Array.isArray(out)) {
      noteLlm(true);
      return out as Row;
    }
    noteLlm(false);
    return null;
  } catch (error) {
    console.warn(
      `${LOG} ${stage} failed:`,
      error instanceof Error ? error.message : error,
    );
    noteLlm(false);
    return null;
  }
}

const asText = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";





const STOP = new Set([
  "and",
  "the",
  "for",
  "with",
  "of",
  "in",
  "to",
  "a",
  "an",
]);
const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const tokens = (s: string): string[] =>
  norm(s)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t));


function resolveTopic(raw: string, topics: DevTopic[]): string | null {
  const q = norm(raw);
  if (!q || !topics.length) return null;

  for (const t of topics) {
    if (norm(t.slug) === q || norm(t.name) === q) return t.slug;
  }

  const qt = tokens(raw);
  let best: { slug: string; score: number } | null = null;
  for (const t of topics) {
    const name = norm(t.name);
    const nt = tokens(t.name);
    let score = 0;
    if (q.length > 2 && (name.includes(q) || q.includes(name))) score += 3;
    for (const w of qt) {
      if (nt.includes(w)) score += 2;
      else if (
        w.length > 3 &&
        nt.some((x) => x.startsWith(w) || w.startsWith(x))
      )
        score += 1;
    }
    if (score > 0 && (!best || score > best.score))
      best = { slug: t.slug, score };
  }
  return best ? best.slug : null;
}

const TOPIC_ARGS = new Set(["topic", "from", "to"]);

function resolveCalls(
  calls: PlannedCall[],
  topics: DevTopic[],
  selected: string | null,
): {
  calls: PlannedCall[];
  skipped: Array<{ term: string; tool: string; reason: string }>;
} {
  const out: PlannedCall[] = [];
  const skipped: Array<{ term: string; tool: string; reason: string }> = [];

  for (const c of calls) {
    const args: Row = { ...(c.args ?? {}) };
    let dropped: string | null = null;

    for (const [k, v] of Object.entries(args)) {
      if (typeof v !== "string" || !v.trim()) continue;
      if (TOPIC_ARGS.has(k)) {
        if (selected && v === selected) continue;
        const slug = resolveTopic(v, topics);
        if (slug) args[k] = slug;
        else {
          dropped = v;
          break;
        }
      } else if (k === "topics") {
        const parts = v
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        const slugs = parts
          .map((p) => resolveTopic(p, topics))
          .filter((x): x is string => Boolean(x));
        if (slugs.length < 2) {
          dropped = parts.find((p) => !resolveTopic(p, topics)) ?? v;
          break;
        }
        args[k] = [...new Set(slugs)].join(", ");
      }
    }

    if (dropped) {
      skipped.push({
        term: dropped,
        tool: c.tool,
        reason: `No topic in your graph matches "${dropped}"`,
      });
    } else {
      out.push({ ...c, args });
    }
  }

  if (!out.length && skipped.length) {
    out.push({
      tool: "search_topics",
      args: { query: skipped[0].term },
      why: `"${skipped[0].term}" isn't a topic name, so I searched your graph for related topics instead.`,
    });
  }
  return { calls: out, skipped };
}





const PLAN_SYSTEM = `You are the router of Pathway's topic assistant. A developer asks about THEIR OWN skill graph (topics, depth levels, foundations, gaps, relations). You choose which graph tools to run. You never answer from memory.

RULES
1. Choose 1 to 3 tools from "tools" that best answer the question. Prefer fewer. Never repeat a tool.
2. Pass only arguments listed in the tool's "params". Topic arguments MUST be a slug copied from "topics". If the user names a technology that is not in "topics" (for example "JavaScript" or "CSS"), pick the closest matching topics from the list, or use search_topics with the user's words. Never invent a topic.
3. If the user says "this topic", "it" or "that one" and "selectedTopic" is set, use selectedTopic.
4. Use the conversation "history" to resolve follow-ups such as "and what about its gaps?".
5. For each call add "why": one short sentence (max 18 words) saying what this tool will tell the developer.
6. If the message is a greeting, thanks, or unrelated to skills and topics, return no calls and put a short friendly reply in "direct_answer".
7. Output minified JSON on one line, no commentary. Do not think out loud.

Return ONLY: {"calls":[{"tool":"","args":{},"why":""}],"direct_answer":""}`;

async function planWithLlm(
  llm: DepthLlm | null,
  message: string,
  history: ChatTurn[],
  selected: string | null,
  topics: DevTopic[],
): Promise<{ calls: PlannedCall[]; direct: string | null } | null> {
  const raw = await askJson(
    llm,
    "discover",
    PLAN_SYSTEM,
    JSON.stringify({
      question: message,
      selectedTopic: selected,
      topics: topics.slice(0, 120).map((t) => ({ slug: t.slug, name: t.name })),
      history: history
        .slice(-6)
        .map((h) => ({ role: h.role, content: h.content.slice(0, 300) })),
      tools: describeTools().map((t) => ({
        name: t.name,
        use: t.use,
        params: t.params,
      })),
    }),
    800,
  );
  if (!raw) return null;

  const calls: PlannedCall[] = [];
  if (Array.isArray(raw.calls)) {
    for (const c of raw.calls.slice(0, 3)) {
      if (c && typeof c === "object" && typeof (c as Row).tool === "string") {
        calls.push({
          tool: (c as Row).tool,
          args: ((c as Row).args ?? {}) as Row,
          why: asText((c as Row).why, 160) || undefined,
        });
      }
    }
  }
  const direct = asText(raw.direct_answer, 500) || null;
  if (!calls.length && !direct) return null;
  return { calls, direct };
}



function mentionedTopics(message: string, topics: DevTopic[]): string[] {
  const s = message.toLowerCase();
  return topics
    .map((t) => {
      const names = [t.name.toLowerCase(), t.slug.replace(/_/g, " ")];
      const at = Math.min(
        ...names.map((n) => (s.includes(n) ? s.indexOf(n) : Infinity)),
      );
      return { t, at };
    })
    .filter((x) => Number.isFinite(x.at))
    .sort((a, b) => a.at - b.at)
    .map((x) => x.t.slug);
}

function routeByRules(
  message: string,
  topics: DevTopic[],
  selected: string | null,
): PlannedCall[] {
  const s = message.toLowerCase();
  const has = (re: RegExp) => re.test(s);
  const m = mentionedTopics(message, topics);
  const calls: PlannedCall[] = [];
  const push = (tool: string, args: Row = {}) => {
    if (!calls.some((c) => c.tool === tool)) calls.push({ tool, args });
  };

  if (m.length >= 2 && has(/compare|versus|\bvs\b|difference|stronger/))
    push("compare_topics", { topics: m.slice(0, 3).join(", ") });
  else if (m.length >= 2 && has(/connect|path|between|relat|link|route|lead/))
    push("connect_topics", { from: m[0], to: m[1] });
  else if (
    m.length &&
    has(
      /path to|roadmap to|how (do|can) i (get|learn|reach)|prerequisite|prereq|before i/,
    )
  )
    push("learning_path_to_topic", { topic: m[0] });
  else if (
    (m.length || selected) &&
    has(/around|neighbou?r|surround|depends|unlock|what builds/)
  )
    push("explore_neighborhood", { topic: m[0] ?? selected });

  if (has(/gap|weak|missing|lack|improve|shallow|worst|hold(ing)? me/))
    push("find_gaps");
  if (
    has(/next|learn|roadmap|should i|frontier|focus|grow/) &&
    !calls.some((c) => c.tool === "learning_path_to_topic")
  )
    push("recommend_next_topics");
  if (has(/foundation|core|fundamental|base skills|depend on/))
    push("rank_foundations");
  if (has(/bridge|transfer|cross|connector/)) push("find_bridges");
  if (has(/communit|cluster|group|areas?|theme/)) push("knowledge_communities");
  if (has(/isolat|island|disconnect|orphan|component/))
    push("connectivity_check");
  if (has(/built|boilerplate|genuine|authentic|trust|confidence|real\b/))
    push("audit_authenticity");
  if (has(/recent|lately|latest|stale|rusty|quiet|working on/))
    push("recent_activity");
  if (has(/strong|best|deep|good at|expert|top skill/))
    push("strongest_topics");
  if (has(/summary|overview|about me|profile|how many|who am i/))
    push("profile_overview");
  if (!calls.length && has(/search|find|which topics|do i have|related/))
    push("search_topics", {
      query:
        message
          .replace(
            /search|find|which topics|do i have|related to|show me topics/gi,
            "",
          )
          .trim() || message,
    });

  if (!calls.length) {
    if (m.length) push("explain_topic", { topic: m[0] });
    else if (selected && has(/\b(this|it|that)\b/))
      push("explain_topic", { topic: selected });
    else push("profile_overview");
  }
  return calls.slice(0, 3);
}





const NOT_FOUND = /not found|couldn'?t find|no topic (called|named|matching)/i;


function isMiss(r: ToolRun): boolean {
  if (!r.ok || !r.result) return false;
  const blocks = r.result.blocks ?? [];
  if (!blocks.length) return NOT_FOUND.test(r.result.summary ?? "");
  return blocks.every(
    (b: any) =>
      b.type === "callout" &&
      NOT_FOUND.test(`${b.title ?? ""} ${b.text ?? ""}`),
  );
}

async function executePlan(
  ctx: ReturnType<typeof createToolContext>,
  calls: PlannedCall[],
  selected: string | null,
  skipped: Array<{ term: string; tool: string; reason: string }>,
  emit?: (e: TraceEvent) => void,
): Promise<AgentRun[]> {
  const seen = new Set<string>();
  const jobs: Array<Promise<AgentRun>> = [];

  for (const c of calls) {
    const tool = TOOL_BY_NAME.get(c.tool);
    if (!tool) {
      console.warn(`${LOG} planner asked for unknown tool "${c.tool}"`);
      continue;
    }
    const why = c.why ?? tool.whenToUse ?? tool.description ?? "";
    const parsed = parseToolArgs(tool, c.args, selected);
    if (!parsed.ok) {
      jobs.push(
        Promise.resolve({
          tool: tool.name,
          title: tool.title,
          description: tool.description,
          features: tool.features,
          args: c.args ?? {},
          ok: false,
          ms: 0,
          result: null,
          error: parsed.error,
          how: [],
          why,
          miss: true,
          skipped: false,
        }),
      );
      continue;
    }
    const key = `${tool.name}:${JSON.stringify(parsed.args)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    emit?.({ type: "tool_start", tool: tool.name, title: tool.title });
    jobs.push(
      runTool(ctx, tool, parsed.args).then((r) => {
        const run: AgentRun = { ...r, why, miss: isMiss(r), skipped: false };
        emit?.({
          type: "tool_done",
          tool: r.tool,
          ok: r.ok,
          ms: r.ms,
          miss: run.miss,
          note: r.result?.summary?.slice(0, 160) ?? r.error,
        });
        return run;
      }),
    );
  }

  const runs = await Promise.all(jobs);

  
  for (const s of skipped) {
    const tool = TOOL_BY_NAME.get(s.tool);
    if (!tool) continue;
    runs.push({
      tool: tool.name,
      title: tool.title,
      description: tool.description,
      features: tool.features,
      args: {},
      ok: false,
      ms: 0,
      result: null,
      error: s.reason,
      how: [],
      why: "",
      miss: true,
      skipped: true,
    });
  }
  return runs;
}





const COMPOSE_SYSTEM = `You write the chat reply for Pathway's topic assistant. The interface already shows tables, rankings and lists built from the tool results, so DO NOT repeat every item.
Write 2 to 4 plain sentences that interpret the result for the developer: the key takeaway, one notable detail, and one concrete next step. Name in plain words which graph analysis produced the key finding (for example "the betweenness ranking" or "the BUILDS_ON traversal"). Use ONLY the supplied facts. Never invent topics, levels, numbers or relationships. Address the developer as "you". No markdown, no bullet lists, no headings.
If the developer asked about something the graph has no topic for, say so plainly in one sentence and use the closest topics the tools did return.
Also give:
- "tool_notes": an object mapping each tool name you were given to ONE short sentence (max 20 words) saying what that tool's result contributed to the answer.
- "followups": up to 3 short follow-up questions the tools can answer (gaps, what to learn next, a path to a topic, comparing topics, explaining a topic, foundations, bridges, communities).
Output minified JSON on one line, no commentary. Do not think out loud.

Return ONLY: {"answer":"","tool_notes":{"tool_name":""},"followups":[""]}`;

function fitFacts(runs: AgentRun[], budget = 6500): Row[] {
  const full = runs.map((r) => ({
    tool: r.tool,
    ok: r.ok,
    summary: r.result?.summary ?? r.error,
    facts: r.result?.facts ?? null,
  }));
  if (JSON.stringify(full).length <= budget) return full;
  return full.map((r, i) => (i === 0 ? r : { ...r, facts: null }));
}

const FOLLOWUPS: Record<string, string[]> = {
  find_gaps: [
    "What should I learn next?",
    "Which of my topics are foundations?",
  ],
  recommend_next_topics: ["Where are my gaps?", "What have I built myself?"],
  learning_path_to_topic: ["Where are my gaps?", "What should I learn next?"],
  rank_foundations: ["Which topics bridge my skills?", "Where are my gaps?"],
  find_bridges: [
    "How do my skills group together?",
    "What should I learn next?",
  ],
  knowledge_communities: [
    "Which topics are isolated?",
    "Which topics bridge my skills?",
  ],
  connectivity_check: [
    "How do my skills group together?",
    "Where are my gaps?",
  ],
  connect_topics: ["What should I learn next?", "Where are my gaps?"],
  explore_neighborhood: ["Where are my gaps?", "What should I learn next?"],
  explain_topic: ["Where are my gaps?", "What builds on this topic?"],
  compare_topics: ["Where are my gaps?", "What should I learn next?"],
  search_topics: ["What am I strongest at?", "Where are my gaps?"],
  audit_authenticity: ["What am I strongest at?", "Where are my gaps?"],
  recent_activity: ["What am I strongest at?", "What should I learn next?"],
  profile_overview: [
    "What am I strongest at?",
    "Where are my gaps?",
    "What should I learn next?",
  ],
  strongest_topics: [
    "Where are my gaps?",
    "What have I built myself?",
    "What should I learn next?",
  ],
};
const DEFAULT_FOLLOWUPS = [
  "What am I strongest at?",
  "Where are my gaps?",
  "What should I learn next?",
];

function followupsFor(runs: AgentRun[]): string[] {
  const out: string[] = [];
  for (const r of runs)
    for (const f of FOLLOWUPS[r.tool] ?? []) if (!out.includes(f)) out.push(f);
  return (out.length ? out : DEFAULT_FOLLOWUPS).slice(0, 3);
}

async function compose(
  llm: DepthLlm | null,
  message: string,
  runs: AgentRun[],
): Promise<{
  answer: string;
  followups: string[];
  notes: Record<string, string>;
  usedLlm: boolean;
}> {
  const good = runs.filter((r) => r.ok && r.result && !r.miss);
  const usable = good.length ? good : runs.filter((r) => r.ok && r.result);
  const fallback = usable.length
    ? usable
        .map((r) => r.result!.summary)
        .join(" ")
        .slice(0, 700)
    : "I couldn't find anything in your graph for that. Try a topic name from the constellation, or ask what you're strongest at.";

  if (!usable.length)
    return {
      answer: fallback,
      followups: DEFAULT_FOLLOWUPS,
      notes: {},
      usedLlm: false,
    };

  const raw = await askJson(
    llm,
    "synthesize",
    COMPOSE_SYSTEM,
    JSON.stringify({ question: message, results: fitFacts(usable) }),
    900,
  );
  const answer = asText(raw?.answer, 900);
  if (!answer)
    return {
      answer: fallback,
      followups: followupsFor(usable),
      notes: {},
      usedLlm: false,
    };

  const followups = Array.isArray(raw?.followups)
    ? (raw!.followups as unknown[])
        .map((f) => asText(f, 90))
        .filter(Boolean)
        .slice(0, 3)
    : [];

  const notes: Record<string, string> = {};
  if (raw?.tool_notes && typeof raw.tool_notes === "object") {
    for (const [k, v] of Object.entries(raw.tool_notes as Row)) {
      const t = asText(v, 200);
      if (t) notes[k] = t;
    }
  }
  return {
    answer,
    followups: followups.length ? followups : followupsFor(usable),
    notes,
    usedLlm: true,
  };
}





function mergeBlocks(runs: AgentRun[]): UiBlock[] {
  const anyGood = runs.some((r) => r.ok && r.result && !r.miss);
  const seen = new Set<string>();
  const blocks: UiBlock[] = [];
  for (const r of runs) {
    if (anyGood && r.miss) continue; 
    for (const b of r.result?.blocks ?? []) {
      const key = `${b.type}:${"title" in b ? (b.title ?? "") : ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      blocks.push(b);
    }
  }
  return blocks.slice(0, 7);
}

export async function answerTopicQuestion(
  input: TopicChatInput,
): Promise<TopicChatResponse> {
  const started = Date.now();
  const emit = input.emit;
  const selected = input.selectedTopic?.trim() || null;
  const history = input.history ?? [];
  const ctx = createToolContext(input.graph, input.developerId, selected);
  const topics = await ctx.topics().catch(() => [] as DevTopic[]);

  
  emit?.({
    type: "stage",
    stage: "planning",
    agent: "Search",
    label: "Choosing which graph tools can answer this",
  });
  const t0 = Date.now();
  const planned = await planWithLlm(
    input.llm,
    input.message,
    history,
    selected,
    topics,
  );

  if (planned && !planned.calls.length && planned.direct) {
    const plannerMs = Date.now() - t0;
    emit?.({
      type: "plan",
      by: "llm",
      model: input.llm?.model ?? null,
      ms: plannerMs,
      calls: [],
      skipped: [],
    });
    await streamAnswer(planned.direct, emit);
    return {
      answer: planned.direct,
      blocks: [],
      topics: [],
      followups: DEFAULT_FOLLOWUPS,
      tools: [],
      meta: {
        mode: "direct",
        model: input.llm?.model ?? null,
        plannerUsedLlm: true,
        composerUsedLlm: false,
        plannerMs,
        toolsMs: 0,
        composeMs: 0,
        durationMs: Date.now() - started,
      },
    };
  }

  let rawCalls = planned?.calls ?? [];
  if (!rawCalls.length)
    rawCalls = routeByRules(input.message, topics, selected);

  const { calls, skipped } = resolveCalls(rawCalls, topics, selected);
  const plannerMs = Date.now() - t0;
  console.log(`${LOG} plan`, {
    by: planned ? "llm" : "rules",
    calls: calls.map((c) => c.tool),
    skipped: skipped.map((s) => s.term),
  });
  emit?.({
    type: "plan",
    by: planned ? "llm" : "rules",
    model: planned ? (input.llm?.model ?? null) : null,
    ms: plannerMs,
    calls: calls.map((c) => ({
      tool: c.tool,
      title: TOOL_BY_NAME.get(c.tool)?.title ?? c.tool,
      why: c.why ?? TOOL_BY_NAME.get(c.tool)?.whenToUse ?? "",
      args: c.args,
    })),
    skipped,
  });

  
  emit?.({
    type: "stage",
    stage: "running",
    agent: "Graph tools",
    label: "Running FalkorDB algorithms and traversals",
  });
  const t1 = Date.now();
  const runs = await executePlan(ctx, calls, selected, skipped, emit);
  const toolsMs = Date.now() - t1;

  
  emit?.({
    type: "stage",
    stage: "composing",
    agent: "Answer",
    label: "Writing the answer from tool results",
  });
  const t2 = Date.now();
  const { answer, followups, notes, usedLlm } = await compose(
    input.llm,
    input.message,
    runs,
  );
  const composeMs = Date.now() - t2;
  emit?.({ type: "compose_done", usedLlm, ms: composeMs });

  
  await streamAnswer(answer, emit);

  const blocks = mergeBlocks(runs);
  const anyGood = runs.some((r) => r.ok && r.result && !r.miss);
  const topicSlugs = [
    ...new Set(
      runs
        .filter((r) => !anyGood || !r.miss)
        .flatMap((r) => r.result?.slugs ?? []),
    ),
  ].slice(0, 12);

  return {
    answer,
    blocks,
    topics: topicSlugs,
    followups,
    tools: runs.map((r) => ({
      name: r.tool,
      title: r.title,
      description: r.description ?? "",
      features: r.features,
      why: r.why,
      args: r.args ?? {},
      ms: r.ms,
      ok: r.ok,
      miss: r.miss,
      skipped: r.skipped,
      error: r.error,
      summary: r.result?.summary ?? null,
      contribution:
        notes[r.tool] ??
        (r.ok && r.result?.summary ? r.result.summary.slice(0, 180) : null),
      how: r.how ?? [],
    })),
    meta: {
      mode: planned || usedLlm ? "llm" : "rules",
      model: input.llm?.model ?? null,
      plannerUsedLlm: Boolean(planned),
      composerUsedLlm: usedLlm,
      plannerMs,
      toolsMs,
      composeMs,
      durationMs: Date.now() - started,
    },
  };
}

export { ALL_TOOLS };
