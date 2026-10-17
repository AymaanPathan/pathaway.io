import type { GithubMcpCall } from "./client.js";

export function getCommit(
  call: GithubMcpCall,
  args: Record<string, unknown>,
): Promise<any> {
  return call("get_commit", args);
}
