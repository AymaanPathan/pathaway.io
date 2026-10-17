import type { GithubMcpCall } from "./client.js";

export function searchIssues(
  call: GithubMcpCall,
  args: Record<string, unknown>,
): Promise<any> {
  return call("search_issues", args);
}
