import type { GithubMcpCall } from "./client.js";

export function getMe(call: GithubMcpCall): Promise<any> {
  return call("get_me", {});
}
