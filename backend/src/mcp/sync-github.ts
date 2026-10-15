import "dotenv/config";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { Graph } from "../db/falkordb.js";
import { GithubSync } from "./sync-core.js";
import { getFrequentlyCoChangedFiles, getFileHotspots } from "./sync-analytics.js";
import type { ProgressFn, SyncStats } from "./sync-types.js";

export { getFrequentlyCoChangedFiles, getFileHotspots };
export type {
  FileChangeRecord,
  FileRole,
  ProgressFn,
  RepoContext,
  SyncStats,
} from "./sync-types.js";
export type { CoChangePair, FileHotspot } from "./sync-analytics.js";

export async function syncDeveloperGithubData(opts: {
  developerId: string;
  username: string;
  accessToken: string;
  graph: Graph;
  onProgress?: ProgressFn;
}): Promise<SyncStats> {
  if (!opts.developerId) {
    throw new Error("Missing developerId");
  }

  if (!opts.username) {
    throw new Error("Missing GitHub username");
  }

  if (!opts.accessToken) {
    throw new Error("Missing GitHub access token");
  }

  const transport = new StdioClientTransport({
    command: "docker",

    args: [
      "run",
      "-i",
      "--rm",

      "-e",
      `GITHUB_PERSONAL_ACCESS_TOKEN=${opts.accessToken}`,

      "-e",
      "GITHUB_TOOLS=get_me,search_repositories,search_issues,list_pull_requests,pull_request_read,list_commits,get_commit,get_file_contents",

      "ghcr.io/github/github-mcp-server:latest",
    ],
  });

  const client = new Client({
    name: "pathway-sync",
    version: "4.0.0",
  });

  await client.connect(transport);

  try {
    const syncer = new GithubSync(
      client,
      opts.graph,
      opts.username,
      opts.developerId,
      opts.onProgress ?? (() => {}),
    );

    return await syncer.run();
  } finally {
    await client.close();
  }
}
