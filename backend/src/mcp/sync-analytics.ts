import type { Graph } from "../db/falkordb.js";
import { safeNumber, safeString } from "./sync-analysis.js";
import type { FileRole } from "./sync-types.js";

export interface CoChangePair {
  pathA: string;
  pathB: string;
  coChanges: number;
}

export async function getFrequentlyCoChangedFiles(
  graph: Graph,
  developerId: string,
  minCoChanges = 5,
): Promise<CoChangePair[]> {
  const result = await graph.query(
    `
    MATCH (d:Developer {id: $developer_id})-[:AUTHORED_CODE]->(fc1:FileChange)
          <-[:CHANGED]-(c:Commit)-[:CHANGED]->(fc2:FileChange)
    WHERE fc1.path < fc2.path
    WITH fc1.path AS pathA, fc2.path AS pathB, count(DISTINCT c) AS co_changes
    WHERE co_changes >= $min_co_changes
    RETURN pathA, pathB, co_changes
    ORDER BY co_changes DESC
    LIMIT 50
    `,
    {
      params: {
        developer_id: developerId,
        min_co_changes: minCoChanges,
      },
    },
  );

  const rows = (result.data ?? []) as Array<{
    pathA?: unknown;
    pathB?: unknown;
    co_changes?: unknown;
  }>;

  return rows.map((row) => ({
    pathA: safeString(row.pathA),
    pathB: safeString(row.pathB),
    coChanges: safeNumber(row.co_changes),
  }));
}

export interface FileHotspot {
  path: string;
  language: string;
  commits: number;
  additions: number;
  deletions: number;
}

export async function getFileHotspots(
  graph: Graph,
  developerId: string,
  limit = 50,
): Promise<FileHotspot[]> {
  const result = await graph.query(
    `
    MATCH (d:Developer {id: $developer_id})-[:AUTHORED_CODE]->(fc:FileChange)
    RETURN
      fc.path AS path,
      fc.language AS language,
      count(DISTINCT fc.commit_sha) AS commits,
      sum(fc.additions) AS additions,
      sum(fc.deletions) AS deletions
    ORDER BY commits DESC
    LIMIT $limit
    `,
    { params: { developer_id: developerId, limit } },
  );

  const rows = (result.data ?? []) as Array<{
    path?: unknown;
    language?: unknown;
    commits?: unknown;
    additions?: unknown;
    deletions?: unknown;
  }>;

  return rows.map((row) => ({
    path: safeString(row.path),
    language: safeString(row.language),
    commits: safeNumber(row.commits),
    additions: safeNumber(row.additions),
    deletions: safeNumber(row.deletions),
  }));
}
