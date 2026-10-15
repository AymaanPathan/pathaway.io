import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

export type McpResult = { ok: boolean; data: any; text: string };
export type McpCall = (
  name: string,
  args: Record<string, unknown>,
) => Promise<McpResult>;

function parse(response: any): McpResult {
  const contents = Array.isArray(response?.content) ? response.content : [];
  const text = String(
    contents.find((c: any) => c?.type === "text")?.text ?? "",
  );
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { ok: !response?.isError, data, text };
}

export async function withGithubMcp<T>(
  token: string,
  tools: string[],
  fn: (call: McpCall) => Promise<T>,
): Promise<T> {
  const transport = new StdioClientTransport({
    command: "docker",
    args: [
      "run",
      "-i",
      "--rm",
      "-e",
      "GITHUB_PERSONAL_ACCESS_TOKEN",
      "-e",
      `GITHUB_TOOLS=${tools.join(",")}`,
      "ghcr.io/github/github-mcp-server:v1.11.0",
    ],
    env: {
      ...(process.env as Record<string, string>),
      GITHUB_PERSONAL_ACCESS_TOKEN: token,
    },
  });

  const client = new Client({ name: "pathway-mission", version: "1.0.0" });

  try {
    await client.connect(transport);
    const call: McpCall = async (name, args) => {
      try {
        return parse(await client.callTool({ name, arguments: args }));
      } catch (e) {
        return {
          ok: false,
          data: null,
          text: e instanceof Error ? e.message : String(e),
        };
      }
    };
    return await fn(call);
  } finally {
    await client.close().catch(() => {});
  }
}
