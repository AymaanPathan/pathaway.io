import type { ToolContext, ToolResult, TopicTool } from "./types.js";

/** Runs an existing tool and tags the result with the tool it came from. */
export async function tagged(
  ctx: ToolContext,
  tool: TopicTool<any>,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const r = await tool.run(ctx, args as any);
  return {
    ...r,
    facts: {
      ...((r.facts ?? {}) as Record<string, unknown>),
      sourceTool: tool.name,
    },
  };
}

export const pickView = (
  v: unknown,
  allowed: readonly string[],
  fallback: string,
): string => (typeof v === "string" && allowed.includes(v) ? v : fallback);

export const featuresOf = (tools: Array<TopicTool<any>>): string[] => [
  ...new Set(tools.flatMap((t) => t.features)),
];
