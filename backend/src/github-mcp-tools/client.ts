import type { Client } from "@modelcontextprotocol/client";

export type GithubMcpCall = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export function clientCall(client: Client): GithubMcpCall {
  return async (name, args) =>
    client.callTool({
      name,
      arguments: args,
    });
}
