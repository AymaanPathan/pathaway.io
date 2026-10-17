import type { GithubMcpCall } from "./client.js";

export function readPullRequest(
  call: GithubMcpCall,
  args: Record<string, unknown>,
): Promise<any> {
  return call("pull_request_read", args);
}
