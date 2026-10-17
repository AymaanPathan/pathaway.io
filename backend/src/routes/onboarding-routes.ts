import { Router } from "express";
import { getGraphForDeveloper } from "../db/falkordb.js";
import { syncDeveloperGithubData } from "../mcp/sync-github.js";
import { analyzeDeveloperSkills } from "../graph/skill-category-graph.js";
import { buildOverviewIntelligenceGraph } from "../graph/developer-knowledge-graph.js";
import {
  ensureJourneySchema,
  readJourney,
} from "../graph/developer-journey-graph.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import {
  getGithubAccessToken,
  humanizeSkillStage,
  humanizeOverviewStage,
} from "./route-context.js";

export const onboardingRouter = Router();

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

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

    // Topic analysis can sit on a slow LLM call for a while: keep proxies from
    // closing an idle stream.
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

      // 3. Knowledge graph
      await buildOverviewIntelligenceGraph(
        graph,
        developer.developerId,
        (stage, detail) =>
          send(`overview-graph:${stage}`, {
            ...(detail ?? {}),
            message: humanizeOverviewStage(stage, detail ?? {}),
          }),
      );

      // 4. Journey graph preparation
      send("journey-graph:schema", {
        message: "Preparing journey search index on capabilities",
      });
      try {
        await ensureJourneySchema(graph);
        send("journey-graph:schema_ready", {
          message: "Journey search index ready",
        });
      } catch (err) {
        console.error("[onboarding] journey schema failed", err);
        send("journey-graph:warning", {
          message: `Journey search index could not be prepared: ${errorMessage(err)}`,
        });
      }

      // 5. Verify journey layer
      send("journey-graph:verify", {
        message: "Verifying journey graph (capabilities, experiences, proof)",
      });
      try {
        const journey = await readJourney(graph, developer.developerId);
        if (!journey) {
          send("journey-graph:warning", {
            message: "Journey could not be read: Developer node not found",
          });
        } else {
          send("journey-graph:ready", {
            message: `Journey ready: ${journey.summary.capabilitiesWithEvidence} capabilities, ${journey.summary.strengths} strengths, ${journey.summary.repositories} repositories with evidence`,
            capabilities: journey.summary.capabilitiesWithEvidence,
            built: journey.summary.built,
            partial: journey.summary.partial,
            strengths: journey.summary.strengths,
            repositories: journey.summary.repositories,
            repositoriesTouched: journey.summary.repositoriesTouched,
            experiences: journey.self.totals.experiences,
            demonstrations: journey.self.totals.demonstrations,
            coverageKnown: journey.coverage.known,
            incompleteRepositories: journey.coverage.incomplete,
          });
        }
      } catch (err) {
        console.error("[onboarding] journey verify failed", err);
        send("journey-graph:warning", {
          message: `Journey verification failed: ${errorMessage(err)}`,
        });
      }

      send("depth-graph:verify", {
        message:
          "Verifying depth graph (code DNA, rhythm, collaboration, hotspots, stack)",
      });

      send("complete", {
        message:
          "GitHub data synced and the knowledge, journey, depth and topic graphs are ready.",
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
