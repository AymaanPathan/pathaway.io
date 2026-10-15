import { Router } from "express";
import { getGraphForDeveloper } from "../db/falkordb.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import {
  analyzeDeveloperSkills,
  buildSkillInsights,
  getDeveloperSkillProfile,
  getSkillDetail,
  getSkillGraph,
  SKILL_CATEGORIES,
  SKILL_TAXONOMY,
} from "../graph/skill-category-graph.js";
import { buildOverviewIntelligenceGraph } from "../graph/developer-knowledge-graph.js";
import {
  getDeveloperInfo,
  humanizeOverviewStage,
  humanizeSkillStage,
  num,
  overviewJobs,
  resetOverviewIntelligenceGraph,
  serializeSkillGroup,
  skillRebuildLocks,
  sleep,
} from "./route-context.js";

export const graphSkillRouter = Router();
graphSkillRouter.get(
  "/api/graph/raw-summary",
  requireAuth,
  async (req: AuthedRequest, res) => {
    try {
      const developerId = req.developer!.developerId,
        graph = await getGraphForDeveloper(developerId);
      const result = await graph.query(
        `MATCH (d:Developer {id: $developerId}) OPTIONAL MATCH (d)-[:MADE]->(c:Commit) RETURN d.id AS developerId, d.username AS username, d.avatar_url AS avatarUrl, count(DISTINCT c) AS commits`,
        { params: { developerId } },
      );
      res.json(result.data?.[0] ?? null);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load raw graph summary" });
    }
  },
);
graphSkillRouter.get(
  "/api/graph/summary",
  requireAuth,
  async (req: AuthedRequest, res) => {
    try {
      const developerId = req.developer!.developerId,
        graph = await getGraphForDeveloper(developerId),
        [developer, groups] = await Promise.all([
          getDeveloperInfo(graph, developerId),
          getDeveloperSkillProfile(graph, developerId),
        ]);
      res.json({
        developer,
        categories: groups.map(serializeSkillGroup),
        insights: buildSkillInsights(groups),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load graph summary" });
    }
  },
);
graphSkillRouter.get(
  "/api/graph/regenerate",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const developerId = req.developer!.developerId;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const send = (stage: string, detail: Record<string, unknown> = {}) => {
      if (!res.writableEnded)
        res.write(`data: ${JSON.stringify({ stage, ...detail })}\n\n`);
    };
    if (skillRebuildLocks.has(developerId)) {
      send("error", { message: "A graph rebuild is already running." });
      res.end();
      return;
    }
    skillRebuildLocks.add(developerId);
    try {
      const graph = await getGraphForDeveloper(developerId);
      send("resetting");
      await graph.query(
        `MATCH (d:Developer {id: $id})-[r:HAS_SKILL]->() DELETE r`,
        { params: { id: developerId } },
      );
      await resetOverviewIntelligenceGraph(graph, developerId);
      await analyzeDeveloperSkills(graph, developerId, (stage, detail) =>
        send(`skills:${stage}`, {
          ...(detail ?? {}),
          message: humanizeSkillStage(stage, detail ?? {}),
        }),
      );
      await buildOverviewIntelligenceGraph(
        graph,
        developerId,
        (stage, detail) =>
          send(`overview-graph:${stage}`, {
            ...(detail ?? {}),
            message: humanizeOverviewStage(stage, detail ?? {}),
          }),
      );
      const groups = await getDeveloperSkillProfile(graph, developerId);
      send("areas_total", { count: groups.length });
      for (const group of groups) {
        send("area_ready", { area: serializeSkillGroup(group) });
        await sleep(150);
      }
      overviewJobs.set(developerId, { status: "idle" });
      send("complete", {
        developer: await getDeveloperInfo(graph, developerId),
        insights: buildSkillInsights(groups),
      });
    } catch (err) {
      console.error(err);
      send("error", {
        message:
          err instanceof Error ? err.message : "Failed to regenerate graph",
      });
    } finally {
      skillRebuildLocks.delete(developerId);
      res.end();
    }
  },
);
graphSkillRouter.get(
  "/api/skills/graph",
  requireAuth,
  async (req: AuthedRequest, res) => {
    try {
      const id = req.developer!.developerId,
        graph = await getGraphForDeveloper(id);
      res.json(
        await getSkillGraph(graph, id, {
          includeRepositories:
            req.query.repos === "1" || req.query.repos === "true",
        }),
      );
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load skill graph" });
    }
  },
);
graphSkillRouter.get(
  "/api/skills/insights",
  requireAuth,
  async (req: AuthedRequest, res) => {
    try {
      const id = req.developer!.developerId,
        graph = await getGraphForDeveloper(id);
      res.json(buildSkillInsights(await getDeveloperSkillProfile(graph, id)));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load skill insights" });
    }
  },
);
graphSkillRouter.get("/api/skills/taxonomy", requireAuth, (_req, res) =>
  res.json({
    categories: SKILL_CATEGORIES,
    skills: SKILL_TAXONOMY.map((skill) => ({
      id: skill.id,
      name: skill.name,
      category: skill.category,
      implies: skill.implies ?? [],
      related: skill.related ?? [],
    })),
  }),
);
graphSkillRouter.get(
  "/api/skills/:slug",
  requireAuth,
  async (req: AuthedRequest, res) => {
    try {
      const id = req.developer!.developerId,
        detail = await getSkillDetail(
          await getGraphForDeveloper(id),
          id,
          String(req.params.slug),
        );
      if (!detail)
        return res
          .status(404)
          .json({ error: "Skill not found for this developer" });
      res.json(detail);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load skill detail" });
    }
  },
);
graphSkillRouter.get(
  "/api/graph/debug-intelligence",
  requireAuth,
  async (req: AuthedRequest, res) => {
    try {
      const developerId = req.developer!.developerId,
        graph = await getGraphForDeveloper(developerId);
      const [skills, capabilities, demonstrations, relationships] =
        await Promise.all([
          graph.query(
            `MATCH (d:Developer {id: $developerId})-[hs:HAS_SKILL]->(s:Skill) RETURN s.id AS id, s.name AS name, coalesce(hs.depth_score, 0) AS score, coalesce(hs.level, "") AS level, coalesce(hs.trend, "") AS trend, coalesce(hs.confidence, "") AS confidence, coalesce(hs.evidence_quality, 0) AS evidenceQuality, coalesce(hs.files_touched, 0) AS filesTouched, coalesce(hs.strong_files, 0) AS strongFiles, coalesce(hs.commits_count, 0) AS commitCount, coalesce(hs.repos_count, 0) AS repositoryCount, coalesce(hs.recency_days, -1) AS recencyDays`,
            { params: { developerId } },
          ),
          graph.query(
            `MATCH (d:Developer {id: $developerId})-[hc:HAS_CAPABILITY]->(c:Capability) RETURN c.id AS id, c.name AS name, coalesce(c.parent_id, "") AS parentId, coalesce(hc.level, "") AS level, coalesce(hc.recency, "") AS recency, coalesce(hc.best_depth, "") AS bestDepth, coalesce(hc.evidence_count, 0) AS evidenceCount, coalesce(hc.commit_count, 0) AS commitCount, coalesce(hc.repo_count, 0) AS repositoryCount, coalesce(hc.technique_count, 0) AS techniqueCount, coalesce(hc.last_seen, "") AS lastSeen ORDER BY evidenceCount DESC`,
            { params: { developerId } },
          ),
          graph.query(
            `MATCH (d:Developer {id: $developerId})-[:DEMONSTRATED]->(x:Demonstration) RETURN count(x) AS demonstrationCount, count(DISTINCT x.rule_id) AS ruleCount, count(DISTINCT x.technique) AS techniqueCount, count(DISTINCT x.commit_sha) AS commitCount`,
            { params: { developerId } },
          ),
          graph.query(
            `MATCH (d:Developer {id: $developerId})-[:HAS_SKILL]->(s:Skill) OPTIONAL MATCH (s)-[co:CO_OCCURS]-(:Skill) OPTIONAL MATCH (s)-[u:USED_IN]->(:Repository) RETURN count(DISTINCT s) AS skills, count(DISTINCT co) AS coOccursEdges, count(DISTINCT u) AS usedInEdges`,
            { params: { developerId } },
          ),
        ]);
      const totals = (demonstrations.data?.[0] ?? {}) as Record<
          string,
          unknown
        >,
        relation = (relationships.data?.[0] ?? {}) as Record<string, unknown>;
      res.json({
        developerId,
        skills: skills.data ?? [],
        capabilities: capabilities.data ?? [],
        skillRelationships: {
          skills: num(relation.skills),
          coOccursEdges: num(relation.coOccursEdges),
          usedInEdges: num(relation.usedInEdges),
        },
        demonstrations: {
          demonstrationCount: num(totals.demonstrationCount),
          ruleCount: num(totals.ruleCount),
          techniqueCount: num(totals.techniqueCount),
          commitCount: num(totals.commitCount),
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        error: "Failed to debug intelligence graph",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },
);
