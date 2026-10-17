import type { GithubMcpCall } from "./client.js";

export function listCommits(
  call: GithubMcpCall,
  args: Record<string, unknown>,
): Promise<any> {
  return call("list_commits", args);
}
