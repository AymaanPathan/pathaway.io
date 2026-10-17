import { auditAuthenticityTool } from "./audit-authenticity.tool.js";
import { compareTopicsTool } from "./compare-topics.tool.js";
import { connectTopicsTool } from "./connect-topics.tool.js";
import { connectivityCheckTool } from "./connectivity-check.tool.js";
import { exploreNeighborhoodTool } from "./explore-neighborhood.tool.js";
import { explainTopicTool } from "./explain-topic.tool.js";
import { findBridgesTool } from "./find-bridges.tool.js";
import { findGapsTool } from "./find-gaps.tool.js";
import { knowledgeCommunitiesTool } from "./knowledge-communities.tool.js";
import { learningPathToTopicTool } from "./learning-path-to-topic.tool.js";
import { profileOverviewTool } from "./profile-overview.tool.js";
import { rankFoundationsTool } from "./rank-foundations.tool.js";
import { recentActivityTool } from "./recent-activity.tool.js";
import { recommendNextTopicsTool } from "./recommend-next-topics.tool.js";
import { searchTopicsTool } from "./search-topics.tool.js";
import { strongestTopicsTool } from "./strongest-topics.tool.js";
import { clamp, queryHealth, type QueryHealth } from "./shared.js";
import type { Row, ToolContext, ToolResult, TopicTool } from "./types.js";

export type { DevTopic, ToolContext, ToolResult, TopicTool } from "./types.js";
export type { UiBlock, TopicItem } from "./ui.js";
export { createToolContext } from "./context.js";

export const ALL_TOOLS: TopicTool[] = [
  profileOverviewTool,
  strongestTopicsTool,
  findGapsTool,
  recommendNextTopicsTool,
  learningPathToTopicTool,
  rankFoundationsTool,
  findBridgesTool,
  knowledgeCommunitiesTool,
  connectivityCheckTool,
  connectTopicsTool,
  exploreNeighborhoodTool,
  explainTopicTool,
  compareTopicsTool,
  searchTopicsTool,
  auditAuthenticityTool,
  recentActivityTool,
];

export const TOOL_BY_NAME = new Map(ALL_TOOLS.map((t) => [t.name, t]));

export function describeTools() {
  return ALL_TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    use: t.whenToUse,
    description: t.description,
    features: t.features,
    params: Object.fromEntries(
      Object.entries(t.params).map(([k, p]) => [
        k,
        {
          type: p.type,
          description: p.description,
          required: Boolean(p.required),
          enum: p.enum,
        },
      ]),
    ),
  }));
}

export function parseToolArgs(
  tool: TopicTool,
  raw: unknown,
  selectedTopic: string | null,
): { ok: true; args: Row } | { ok: false; error: string } {
  const input: Row =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Row) : {};
  const args: Row = {};
  for (const [key, spec] of Object.entries(tool.params)) {
    let v: unknown = input[key];
    if ((v == null || v === "") && spec.defaultSelected && selectedTopic)
      v = selectedTopic;
    if (v == null || v === "") {
      if (spec.required)
        return { ok: false, error: `missing required argument "${key}"` };
      continue;
    }
    if (spec.type === "string") {
      const s = String(v).trim().slice(0, 160);
      if (spec.enum && !spec.enum.includes(s)) {
        if (spec.required)
          return {
            ok: false,
            error: `"${key}" must be one of ${spec.enum.join(", ")}`,
          };
        continue;
      }
      if (!s && spec.required)
        return { ok: false, error: `missing required argument "${key}"` };
      args[key] = s;
    } else if (spec.type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n)) {
        if (spec.required)
          return { ok: false, error: `"${key}" must be a number` };
        continue;
      }
      args[key] = clamp(n, spec.min ?? -1e9, spec.max ?? 1e9);
    } else {
      args[key] = v === true || v === "true";
    }
  }
  return { ok: true, args };
}

export interface ToolRun {
  tool: string;
  title: string;
  description: string;
  features: string[];
  args: Row;
  ok: boolean;
  ms: number;
  result: ToolResult | null;
  error: string | null;
  /** labels of graph queries that threw while this tool ran (empty = all queries succeeded) */
  degraded: string[];
  how: string[];
}

const TOOL_TIMEOUT_MS = 20_000;

const short = (v: unknown, max = 60): string => {
  const text = Array.isArray(v) ? v.join(", ") : String(v);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

function describeFact(key: string, v: unknown): string {
  if (Array.isArray(v)) return `${key}: ${v.length} item(s)`;
  if (v && typeof v === "object")
    return `${key}: ${Object.keys(v).length} field(s)`;
  return `${key}: ${short(v)}`;
}

function buildHow(tool: TopicTool, args: Row, result: ToolResult): string[] {
  const custom = (result as unknown as Row).how;
  if (Array.isArray(custom) && custom.length) {
    return custom.map((x) => String(x)).slice(0, 8);
  }

  const steps: string[] = [];
  const inputs = Object.entries(args).filter(([, v]) => v != null && v !== "");
  steps.push(
    inputs.length
      ? `Inputs: ${inputs.map(([k, v]) => `${k} = ${short(v)}`).join(", ")}.`
      : "No input needed; it read your whole topic graph.",
  );

  const facts = (result.facts ?? {}) as Row;
  const source = facts.algorithm ?? facts.source;
  if (typeof source === "string" && source) {
    steps.push(`Graph source: ${source}.`);
  } else if (tool.features.length) {
    steps.push(`Designed to read: ${tool.features.join(", ")}.`);
  }

  const keyed = Object.entries(facts)
    .filter(
      ([k, v]) =>
        k !== "algorithm" &&
        k !== "source" &&
        v != null &&
        !(Array.isArray(v) && v.length === 0),
    )
    .slice(0, 4);
  if (keyed.length) {
    steps.push(
      `Returned ${keyed.map(([k, v]) => describeFact(k, v)).join(" · ")}.`,
    );
  }
  return steps;
}

export async function runTool(
  ctx: ToolContext,
  tool: TopicTool,
  args: Row,
): Promise<ToolRun> {
  const started = Date.now();
  const base = {
    tool: tool.name,
    title: tool.title,
    description: tool.description,
    features: tool.features,
    args,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const health: QueryHealth = { total: 0, failed: [] };
  try {
    const result = await Promise.race<ToolResult>([
      queryHealth.run(health, () => tool.run(ctx, args)),
      new Promise<ToolResult>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${TOOL_TIMEOUT_MS}ms`)),
          TOOL_TIMEOUT_MS,
        );
      }),
    ]);
    return {
      ...base,
      ok: true,
      ms: Date.now() - started,
      result,
      error: null,
      degraded: [...health.failed],
      how: buildHow(tool, args, result),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[topic-tools] ${tool.name} failed:`, message);
    return {
      ...base,
      ok: false,
      ms: Date.now() - started,
      result: null,
      error: message,
      degraded: [...health.failed],
      how: [],
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
