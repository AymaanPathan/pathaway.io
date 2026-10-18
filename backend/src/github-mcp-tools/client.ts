import type { Client } from "@modelcontextprotocol/client";

/**
 * A GitHub MCP tool caller. It may return either:
 *  - the RAW MCP result ({ content: [...], isError }): what clientCall returns,
 *    parsed later by parseToolResponse in the sync code, or
 *  - an already parsed { ok, text, data }: what withGithubMcp's call returns.
 * Wrappers just forward the result, so both work.
 */
export type GithubMcpCall = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

/** Raw MCP result. Do NOT parse here: sync-analysis.parseToolResponse expects the raw shape. */
export function clientCall(client: Client): GithubMcpCall {
  return async (name, args) =>
    client.callTool({
      name,
      arguments: args,
    });
}
