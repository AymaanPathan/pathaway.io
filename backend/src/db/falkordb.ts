import { FalkorDB, type Graph } from "falkordb";

const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6379";

const GRAPH_NAME = process.env.FALKORDB_GRAPH ?? "pathway";

let clientPromise: ReturnType<typeof FalkorDB.connect> | null = null;

async function getClient() {
  if (!clientPromise) {
    clientPromise = FalkorDB.connect({
      url: FALKORDB_URL,
    });
  }

  return clientPromise;
}

export async function getGraph(): Promise<Graph> {
  const client = await getClient();
  return client.selectGraph(GRAPH_NAME);
}

export async function getGraphForDeveloper(
  _developerId: string,
): Promise<Graph> {
  return getGraph();
}

export type { Graph };
