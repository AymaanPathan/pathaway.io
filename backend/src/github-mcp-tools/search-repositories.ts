import type { GithubMcpCall } from "./client.js";

export function searchRepositories(
  call: GithubMcpCall,
  args: Record<string, unknown>,
): Promise<any> {
  return call("search_repositories", args);
}
