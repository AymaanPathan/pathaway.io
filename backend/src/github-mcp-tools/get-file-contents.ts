import type { GithubMcpCall } from "./client.js";

export function getFileContents(
  call: GithubMcpCall,
  args: Record<string, unknown>,
): Promise<any> {
  return call("get_file_contents", args);
}
