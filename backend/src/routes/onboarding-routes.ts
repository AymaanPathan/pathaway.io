import { Router } from "express";
import { getGraphForDeveloper } from "../db/falkordb.js";
import { syncDeveloperGithubData } from "../mcp/sync-github.js";
import { analyzeDeveloperSkills } from "../graph/skill-category-graph.js";
import { buildOverviewIntelligenceGraph } from "../graph/developer-knowledge-graph.js";
import { ensureJourneySchema } from "../graph/developer-journey-graph.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import {
  getGithubAccessToken,
  humanizeSkillStage,
  humanizeOverviewStage,
  refreshDepthGraph,
} from "./route-context.js";

export const onboardingRouter = Router();

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

type Graph = Awaited<ReturnType<typeof getGraphForDeveloper>>;

async function one(
  graph: Graph,
  query: string,
  developerId: string,
): Promise<Record<string, any>> {
  const result = await graph.query(query, { params: { dev: developerId } });
  return ((result.data ?? []) as Record<string, any>[])[0] ?? {};
}

/** Cheap counts only. The full journey is read on demand by the journey API. */
async function readJourneyCounts(graph: Graph, developerId: string) {
  const [caps, exps, demos] = await Promise.all([
    one(
      graph,
      `MATCH (d:Developer {id: $dev})-[hc:HAS_CAPABILITY]->(c:Capability)
       WHERE c.parent_id <> ""
       RETURN count(c) AS capabilities,
              sum(CASE WHEN hc.level IN ["implementation","strong"] THEN 1 ELSE 0 END) AS built,
              sum(CASE WHEN hc.level IN ["usage","repeated_usage"] THEN 1 ELSE 0 END) AS partial`,
      developerId,
    ),
    one(
      graph,
      `MATCH (d:Developer {id: $dev})-[:EXPERIENCED]->(e:Experience)
       OPTIONAL MATCH (e)-[:OCCURS_IN]->(r:Repository)
       RETURN count(DISTINCT e) AS experiences, count(DISTINCT r) AS repositories`,
      developerId,
    ),
    one(
      graph,
      `MATCH (d:Developer {id: $dev})-[:DEMONSTRATED]->(x:Demonstration)
       RETURN count(x) AS n`,
      developerId,
    ),
  ]);

  return {
    capabilities: Number(caps.capabilities ?? 0),
    built: Number(caps.built ?? 0),
    partial: Number(caps.partial ?? 0),
    experiences: Number(exps.experiences ?? 0),
    repositories: Number(exps.repositories ?? 0),
    demonstrations: Number(demos.n ?? 0),
  };
}

onboardingRouter.get(
  "/api/onboard/stream",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const developer = req.developer!;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    const send = (stage: string, detail: Record<string, unknown> = {}) => {
      if (!res.writableEnded)
        res.write(`data: ${JSON.stringify({ stage, ...detail })}\n\n`);
    };

    // Keep proxies from closing an idle stream during slow steps.
    const keepAlive = setInterval(() => {
      if (!res.writableEnded) res.write(`: ping\n\n`);
    }, 15_000);

    try {
      const graph = await getGraphForDeveloper(developer.developerId);
      const accessToken = await getGithubAccessToken(
        graph,
        developer.developerId,
      );

      // 1. GitHub sync
      await syncDeveloperGithubData({
        developerId: developer.developerId,
        username: developer.githubLogin,
        accessToken,
        graph,
        onProgress: (stage, detail) => send(`sync:${stage}`, detail),
      });

      // 2. Skill graph
      await analyzeDeveloperSkills(
        graph,
        developer.developerId,
        (stage, detail) =>
          send(`skills:${stage}`, {
            ...(detail ?? {}),
            message: humanizeSkillStage(stage, detail ?? {}),
          }),
      );

      // 3. Knowledge graph (needs HAS_SKILL from step 2)
      await buildOverviewIntelligenceGraph(
        graph,
        developer.developerId,
        (stage, detail) =>
          send(`overview-graph:${stage}`, {
            ...(detail ?? {}),
            message: humanizeOverviewStage(stage, detail ?? {}),
          }),
      );

      // 4. Topic graph: topics, approaches and depth assessments backed by the
      // evidence above. Goal planning and topic chat read this. Skipped when
      // the developer's assessments are already current, so logging in again
      // does not re-run the model.
      const depth = await refreshDepthGraph(
        graph,
        developer.developerId,
        send,
        { force: false },
      );

      // 5 + 6. Journey index and a light verification, in parallel
      send("journey-graph:schema", {
        message: "Preparing journey search index on capabilities",
      });
      const [schemaResult, countsResult] = await Promise.allSettled([
        ensureJourneySchema(graph),
        readJourneyCounts(graph, developer.developerId),
      ]);

      if (schemaResult.status === "fulfilled") {
        send("journey-graph:schema_ready", {
          message: "Journey search index ready",
        });
      } else {
        console.error(
          "[onboarding] journey schema failed",
          schemaResult.reason,
        );
        send("journey-graph:warning", {
          message: `Journey search index could not be prepared: ${errorMessage(schemaResult.reason)}`,
        });
      }

      if (countsResult.status === "fulfilled") {
        const c = countsResult.value;
        send("journey-graph:ready", {
          message: `Journey ready: ${c.capabilities} capabilities, ${c.built} strengths, ${c.repositories} repositories with evidence`,
          capabilities: c.capabilities,
          built: c.built,
          partial: c.partial,
          strengths: c.built,
          repositories: c.repositories,
          experiences: c.experiences,
          demonstrations: c.demonstrations,
        });
      } else {
        console.error(
          "[onboarding] journey counts failed",
          countsResult.reason,
        );
        send("journey-graph:warning", {
          message: `Journey verification failed: ${errorMessage(countsResult.reason)}`,
        });
      }

      send("complete", {
        message:
          depth.status === "failed"
            ? "GitHub data synced and the knowledge and journey graphs are ready. Topic analysis did not finish; run it again from the topics page."
            : "GitHub data synced and the knowledge, journey, depth and topic graphs are ready.",
        depth: depth.status,
        topics: depth.status === "failed" ? 0 : depth.topics,
      });
    } catch (err) {
      console.error(err);
      send("error", {
        message: err instanceof Error ? err.message : "Onboarding failed",
      });
    } finally {
      clearInterval(keepAlive);
      res.end();
    }
  },
);
