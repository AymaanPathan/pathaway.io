import type { Graph } from "../db/falkordb.js";
import type { DeveloperOverview } from "../agents/overview-agent.js";

type AnyObject = Record<string, any>;

const LOG_PREFIX = "[overview-storage]";

function log(message: string, detail?: AnyObject): void {
  console.log(`${LOG_PREFIX} ${message}`, detail ?? "");
}

function safeString(value: unknown): string {
  return value == null ? "" : String(value);
}

/**
 * The graph is the source of truth. This cache stores only the generated
 * narrative/profile layer so we never persist a second copy of the graph.
 */
export interface StoredOverviewRecord {
  overview: DeveloperOverview;
  model: string;
  generatedAt: string;
  graphSignature: string;
}

async function queryOne(
  graph: Graph,
  query: string,
  developerId: string,
): Promise<AnyObject | undefined> {
  const result = await graph.query(query, {
    params: { developer_id: developerId },
  });
  return ((result.data ?? [])[0] as AnyObject) ?? undefined;
}

/**
 * Cheap signature used only to decide whether generated narrative is stale.
 * It deliberately does NOT represent developer memory; FalkorDB remains the
 * authoritative source for all facts, counts, relationships and evidence.
 */
export async function computeOverviewGraphSignature(
  graph: Graph,
  developerId: string,
): Promise<string> {
  const row = await queryOne(
    graph,
    `
    MATCH (d:Developer {id: $developer_id})
    OPTIONAL MATCH (d)-[:AUTHORED_CODE]->(fc:FileChange)
    OPTIONAL MATCH (d)-[:HAS_SKILL]->(s:Skill)
    OPTIONAL MATCH (d)-[:EXPERIENCED]->(e:Experience)
    OPTIONAL MATCH (d)-[:HAS_CAPABILITY]->(c:Capability)
    OPTIONAL MATCH (d)-[:EXPERIENCED]->(e2:Experience)-[:SUPPORTED_BY]->(demo:Demonstration)
    RETURN
      count(DISTINCT fc) AS file_changes,
      max(fc.created_at) AS last_file_change_at,
      count(DISTINCT s) AS skills,
      count(DISTINCT e) AS experiences,
      count(DISTINCT c) AS capabilities,
      count(DISTINCT demo) AS demonstrations
    `,
    developerId,
  );

  return [
    safeString(row?.file_changes),
    safeString(row?.last_file_change_at),
    safeString(row?.skills),
    safeString(row?.experiences),
    safeString(row?.capabilities),
    safeString(row?.demonstrations),
  ].join("|");
}

let indexEnsured = false;

async function ensureOverviewIndex(graph: Graph): Promise<void> {
  if (indexEnsured) return;

  try {
    await graph.query(
      `CREATE INDEX FOR (n:DeveloperOverview) ON (n.developerId)`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already\s+(exists|indexed)/i.test(message)) {
      log("index_creation_failed", { message });
    }
  } finally {
    indexEnsured = true;
  }
}

export async function getStoredOverview(
  graph: Graph,
  developerId: string,
): Promise<StoredOverviewRecord | null> {
  const result = await graph.query(
    `
    MATCH (d:Developer {id: $developer_id})-[:HAS_OVERVIEW]->(o:DeveloperOverview)
    RETURN
      o.data AS data,
      o.model AS model,
      o.generated_at AS generated_at,
      o.graph_signature AS graph_signature
    LIMIT 1
    `,
    { params: { developer_id: developerId } },
  );

  const row = ((result.data ?? [])[0] as AnyObject) ?? undefined;
  if (!row?.data) return null;

  try {
    const overview = JSON.parse(safeString(row.data)) as DeveloperOverview;
    const graphSignature = safeString(row.graph_signature);

    if (!graphSignature) return null;

    return {
      overview,
      model: safeString(row.model),
      generatedAt: safeString(row.generated_at),
      graphSignature,
    };
  } catch (error) {
    log("stored_overview_parse_failed", {
      developerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Persist only the generated overview/narrative artifact. Do not read this as
 * the developer's memory: all graph facts are recomputed from FalkorDB.
 */
export async function saveOverview(
  graph: Graph,
  developerId: string,
  overview: DeveloperOverview,
  model: string,
  graphSignature: string,
): Promise<string> {
  await ensureOverviewIndex(graph);

  const generatedAt = new Date().toISOString();

  await graph.query(
    `
    MATCH (d:Developer {id: $developer_id})
    MERGE (d)-[:HAS_OVERVIEW]->(o:DeveloperOverview {developerId: $developer_id})
    SET
      o.data = $data,
      o.model = $model,
      o.generated_at = $generated_at,
      o.graph_signature = $graph_signature
    `,
    {
      params: {
        developer_id: developerId,
        data: JSON.stringify(overview),
        model,
        generated_at: generatedAt,
        graph_signature: graphSignature,
      },
    },
  );

  log("narrative_saved", {
    developerId,
    generatedAt,
    graphSignature,
  });

  return generatedAt;
}

export async function invalidateOverview(
  graph: Graph,
  developerId: string,
): Promise<void> {
  await graph.query(
    `
    MATCH (d:Developer {id: $developer_id})-[:HAS_OVERVIEW]->(o:DeveloperOverview)
    DETACH DELETE o
    `,
    { params: { developer_id: developerId } },
  );

  log("narrative_invalidated", { developerId });
}
