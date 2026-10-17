/**
 * Shared helpers for the graph tests.
 *
 * Put every *.test.ts file and this helper in the SAME folder as the graph
 * files (the ones that import "../db/falkordb.js").
 *
 * Environment:
 *   TEST_DEVELOPER_ID      developer to test with        (default 118355098)
 *   FALKORDB_URL           redis://host:port             (default redis://localhost:6379)
 *   FALKORDB_GRAPH         graph name                    (default pathway)
 *   PATHWAY_TEST_WRITES=1  also run the tests that WRITE to the graph
 *   TEST_SKIP_DB=1         run only the pure (no database) tests
 */
import { FalkorDB } from "falkordb";
import type { Graph } from "../db/falkordb.js";

export const DEV_ID = process.env.TEST_DEVELOPER_ID ?? "118355098";
export const WRITES = process.env.PATHWAY_TEST_WRITES === "1";
export const SKIP_DB = process.env.TEST_SKIP_DB === "1";

export type Row = Record<string, any>;

let client: any = null;
let graphPromise: Promise<Graph> | null = null;

export function getTestGraph(): Promise<Graph> {
  graphPromise ??= (async () => {
    client = await FalkorDB.connect({
      url: process.env.FALKORDB_URL ?? "redis://localhost:6379",
    } as any);
    return client.selectGraph(process.env.FALKORDB_GRAPH ?? "pathway") as Graph;
  })();
  return graphPromise;
}

export async function closeTestGraph(): Promise<void> {
  if (client) await client.close();
  client = null;
  graphPromise = null;
}

/** Plain Cypher read used to cross-check what the graph functions return. */
export async function q(
  graph: Graph,
  cypher: string,
  params: Row = {},
): Promise<Row[]> {
  const result = await graph.query(cypher, { params });
  return (result.data ?? []) as Row[];
}

export async function developerExists(graph: Graph): Promise<boolean> {
  const r = await q(
    graph,
    `MATCH (d:Developer {id: $d}) RETURN count(d) AS n`,
    {
      d: DEV_ID,
    },
  );
  return Number(r[0]?.n) > 0;
}

/** Slugs of the topics this developer has a depth assessment for, best first. */
export async function assessedTopicSlugs(
  graph: Graph,
  n = 5,
): Promise<string[]> {
  const r = await q(
    graph,
    `MATCH (:Developer {id: $d})-[:ASSESSED]->(a:DepthAssessment)
     RETURN a.topic_slug AS slug ORDER BY a.score DESC LIMIT ${n}`,
    { d: DEV_ID },
  );
  return r.map((x) => String(x.slug)).filter(Boolean);
}

/** Fails when any number anywhere inside `value` is NaN or Infinity. */
export function findBadNumbers(value: unknown, path = "$", out: string[] = []) {
  if (typeof value === "number" && !Number.isFinite(value)) out.push(path);
  else if (Array.isArray(value))
    value.forEach((v, i) => findBadNumbers(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value))
      findBadNumbers(v, `${path}.${k}`, out);
  return out;
}

/** true when the directed edge list has no cycle (Kahn's algorithm). */
export function isAcyclic(edges: Array<{ from: string; to: string }>): boolean {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    indeg.set(e.from, indeg.get(e.from) ?? 0);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  }
  const queue = [...indeg].filter(([, d]) => d === 0).map(([n]) => n);
  let seen = 0;
  while (queue.length) {
    const n = queue.pop() as string;
    seen += 1;
    for (const m of adj.get(n) ?? []) {
      indeg.set(m, (indeg.get(m) as number) - 1);
      if (indeg.get(m) === 0) queue.push(m);
    }
  }
  return seen === indeg.size;
}

export const isSortedBy = <T>(
  items: T[],
  key: (t: T) => number,
  dir: "asc" | "desc",
) =>
  items.every(
    (t, i) =>
      i === 0 ||
      (dir === "desc"
        ? key(items[i - 1]) >= key(t)
        : key(items[i - 1]) <= key(t)),
  );
