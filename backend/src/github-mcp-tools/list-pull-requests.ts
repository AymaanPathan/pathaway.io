import type { GithubMcpCall } from "./client.js";

export function listPullRequests(
  call: GithubMcpCall,
  args: Record<string, unknown>,
): Promise<any> {
  return call("list_pull_requests", args);
}
