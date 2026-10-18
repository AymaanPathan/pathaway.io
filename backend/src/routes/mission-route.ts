import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import {
  abandonMission,
  createMission,
  getLatestEvaluation,
  getMission,
  listBranchCommits,
  prepareWorkspace,
  startMission,
  submitMission,
  type MissionDeps,
} from "../service/mission.service.js";
import {
  getRun,
  latestRun,
  startEvaluation,
  submitRunEnv,
} from "../evaluations/mission-evaluation.service.js";
import { retractMissionEvidence } from "../learning/mission-retraction.js";
import { githubInspector } from "../service/mission-repo.service.js";
import { getGithubToken } from "../auth/github-oauth.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { onTopicsChanged } from "./topics-route.js";

const LOG = "[mission-routes]";
const IS_PROD = process.env.NODE_ENV === "production";

function log(rid: string, msg: string, detail?: unknown): void {
  const line = `${LOG} ${rid} ${msg}`;
  if (detail !== undefined) console.log(line, detail);
  else console.log(line);
}

function describeId(v: unknown) {
  const s = typeof v === "string" ? v : String(v);
  return {
    value: s,
    type: typeof v,
    length: s.length,
    hasEdgeWhitespace: s !== s.trim(),
    prefix: /^(goal|nextmove|mission):/.test(s) ? s.split(":")[0] : null,
  };
}

function getDeveloperId(req: Request): string | null {
  const r = req as AuthedRequest;
  const raw = r.developer?.developerId;

  if (raw === undefined || raw === null || raw === "") return null;
  return String(raw).trim();
}

/**
 * The client polls a run many times. Graph learning must be logged and the
 * topics cache dropped once per run, not once per poll.
 */
const learningReported = new Set<string>();
function markLearningReported(runId: string): boolean {
  if (learningReported.has(runId)) return false;
  if (learningReported.size > 500) learningReported.clear();
  learningReported.add(runId);
  return true;
}

const STATUS_HTTP: Record<string, number> = {
  created: 201,
  existing: 200,
  goal_not_found: 404,
  needs_replan: 409,
  repository_unavailable: 502,
  llm_unavailable: 503,
  generation_failed: 422,
  store_failed: 500,
};

const EVAL_HTTP: Record<string, number> = {
  completed: 200,
  needs_work: 200,
  not_found: 404,
  not_evaluable: 409,
  repository_unavailable: 502,
  llm_unavailable: 503,
  generation_failed: 502,
  ci_pending: 202,
  ci_required: 409,
};

const COMMITS_HTTP: Record<string, number> = {
  ok: 200,
  not_found: 404,
  no_workspace: 409,
  repository_unavailable: 502,
};

// POST /:id/evaluate
const RUN_START_HTTP: Record<string, number> = {
  started: 202,
  already_running: 200,
  bad_head: 400,
  not_found: 404,
  not_evaluable: 409,
  no_workspace: 409,
  llm_unavailable: 503,
};

// POST /:id/evaluate/:runId/env
const RUN_ENV_HTTP: Record<string, number> = {
  ok: 200,
  not_found: 404,
  not_waiting: 409,
  missing_keys: 422,
};

export function missionRoutes(deps: MissionDeps): Router {
  const router = Router();

  type Handler = (
    req: Request,
    res: Response,
    developerId: string,
    rid: string,
  ) => Promise<void>;

  const guard =
    (name: string, handler: Handler) =>
    async (req: Request, res: Response): Promise<void> => {
      const rid = randomUUID().slice(0, 8);
      const started = Date.now();

      res.on("finish", () =>
        log(
          rid,
          `${name} done: HTTP ${res.statusCode} in ${Date.now() - started}ms`,
        ),
      );

      // never log req.body here: evaluation env values can be secrets
      log(rid, `${name} ${req.method} ${req.originalUrl}`);

      try {
        const developerId = getDeveloperId(req);

        if (!developerId) {
          log(rid, `${name} 401: no authenticated developer`);
          res.status(401).json({ error: "Not authenticated" });
          return;
        }

        log(rid, `${name} developerId`, describeId(developerId));

        await handler(req, res, developerId, rid);
      } catch (error) {
        log(rid, `${name} THREW`, error);

        if (res.headersSent) return;

        res.status(500).json({
          error: "Internal error",
          ...(IS_PROD
            ? {}
            : {
                detail: error instanceof Error ? error.message : String(error),
              }),
        });
      }
    };

  // All mission endpoints use the existing session authentication.
  router.use(requireAuth);

  router.post(
    "/",
    guard("create", async (req, res, developerId, rid) => {
      const rawGoalId = req.body?.goalId;
      const goalId = typeof rawGoalId === "string" ? rawGoalId.trim() : "";

      log(rid, "create goalId received", describeId(rawGoalId));

      if (!goalId) {
        res.status(400).json({ error: "goalId is required" });
        return;
      }

      // Private repos (and repos the server token can't see) return 404 for
      // anonymous / server-token requests. Read the repository with the
      // developer's own GitHub token so their repos are visible.
      const userToken = await getGithubToken(developerId);
      let createDeps: MissionDeps = deps;

      if (userToken) {
        createDeps = {
          ...deps,
          inspector: githubInspector({ token: userToken }),
        };
        log(rid, "create using developer GitHub token");
      } else {
        log(
          rid,
          "create: no developer GitHub token, falling back to server inspector (private repos will 404)",
        );
      }

      const result = await createMission(createDeps, { developerId, goalId });

      log(rid, `create result status=${result.status}`, {
        reason: result.reason,
        errors: result.errors,
        notes: result.notes,
        timingsMs: result.timingsMs,
      });

      res.status(STATUS_HTTP[result.status] ?? 500).json(result);
    }),
  );

  router.get(
    "/:id",
    guard("get", async (req, res, developerId, rid) => {
      const id = String(req.params.id);
      const mission = await getMission(deps, developerId, id);

      log(rid, `get found=${Boolean(mission)}`);

      if (!mission) {
        res.status(404).json({ error: "mission not found" });
      } else {
        res.json({ mission });
      }
    }),
  );

  router.get(
    "/:id/evaluation",
    guard("evaluation", async (req, res, developerId) => {
      const id = String(req.params.id);
      const mission = await getMission(deps, developerId, id);

      if (!mission) {
        res.status(404).json({ error: "mission not found" });
        return;
      }

      const evaluation = await getLatestEvaluation(deps, developerId, id);

      res.json({ evaluation });
    }),
  );

  router.get(
    "/:id/commits",
    guard("commits", async (req, res, developerId, rid) => {
      const missionId = String(req.params.id);
      const out = await listBranchCommits(deps, { developerId, missionId });

      log(
        rid,
        `commits missionId=${missionId} status=${out.status} count=${out.commits.length}`,
      );

      res.status(COMMITS_HTTP[out.status] ?? 500).json(out);
    }),
  );

  router.post(
    "/:id/start",
    guard("start", async (req, res, developerId, rid) => {
      const id = String(req.params.id);
      const out = await startMission(deps, developerId, id);

      log(rid, `start missionId=${id} ok=${out.ok} reason=${out.reason}`);

      res.status(out.ok ? 200 : out.mission ? 409 : 404).json(out);
    }),
  );

  router.post(
    "/:id/workspace",
    guard("workspace", async (req, res, developerId, rid) => {
      // Retrieve the GitHub token from server-side storage.
      const token = await getGithubToken(developerId);

      if (!token) {
        log(rid, "workspace 401: GitHub token not found");
        res.status(401).json({
          error: "GitHub token not found. Reconnect GitHub.",
        });
        return;
      }

      const missionId = String(req.params.id);

      const result = await prepareWorkspace(deps, {
        developerId,
        missionId,
        userInspector: githubInspector({ token }),
      });

      log(
        rid,
        `workspace missionId=${missionId} ok=${result.ok} reason=${result.reason}`,
      );

      const code = result.ok
        ? 200
        : result.reason === "mission not found"
          ? 404
          : 409;

      res.status(code).json(result);
    }),
  );

  router.post(
    "/:id/evaluate",
    guard("evaluate", async (req, res, developerId, rid) => {
      const missionId = String(req.params.id);
      const head =
        typeof req.body?.head === "string" ? req.body.head.trim() : "";

      if (!head) {
        res.status(400).json({
          status: "bad_head",
          message: "head (the working branch) is required",
        });
        return;
      }

      const githubToken = await getGithubToken(developerId);
      if (!githubToken) {
        res.status(401).json({
          status: "github_token_missing",
          message: "GitHub token not found. Reconnect GitHub.",
        });
        return;
      }

      const out = await startEvaluation(deps, {
        developerId,
        missionId,
        head,
        githubToken,
        regenerate: req.body?.regenerate === true,
      });

      log(
        rid,
        `evaluate missionId=${missionId} status=${out.status}` +
          ("run" in out ? ` runId=${out.run.runId}` : ""),
      );

      res.status(RUN_START_HTTP[out.status] ?? 500).json(out);
    }),
  );

  // registered before "/:id/evaluate/:runId" so "latest" is not read as a run id
  router.get(
    "/:id/evaluate/latest",
    guard("evaluate-latest", async (req, res, developerId) => {
      const missionId = String(req.params.id);
      res.json({ run: latestRun(developerId, missionId) });
    }),
  );

  router.get(
    "/:id/evaluate/:runId",
    guard("evaluate-poll", async (req, res, developerId, rid) => {
      const run = getRun(
        developerId,
        String(req.params.id),
        String(req.params.runId),
      );
      if (!run) {
        res.status(404).json({ error: "run not found" });
        return;
      }

      // Only once the run is finished, and only once per run.
      if (
        run.learning &&
        (run.status === "done" || run.status === "error") &&
        markLearningReported(run.runId)
      ) {
        const l = run.learning;
        const pipeline = l.learning;
        const gu = l.graphUpdate;

        log(rid, "evaluation graph learning", {
          evidenceStatus: l.evidenceStatus,
          verified: l.verification.verified,
          graphUpdate: gu
            ? {
                status: gu.status,
                failedStage: gu.failedStage,
                attempts: gu.attempts,
                stagesCompleted: gu.stagesCompleted,
                lastError: gu.lastError,
              }
            : null,
          accepted: pipeline?.accepted ?? 0,
          skippedExisting: pipeline?.skippedExisting ?? 0,
          repairedExisting: pipeline?.repairedExisting ?? 0,
          experiencesUpdated: pipeline?.experiencesUpdated ?? 0,
          capabilityRollupsUpdated: pipeline?.capabilityRollupsUpdated ?? 0,
        });

        if (l.evidenceStatus === "graph_update_failed")
          log(rid, "evaluation passed but graph update FAILED (retryable)", {
            missionId: String(req.params.id),
            failedStage: gu?.failedStage ?? null,
          });

        // verified work changed the graph: drop the cached topics dossier so
        // the topics and goal views read the new evidence immediately
        if (
          l.evidenceStatus === "updated" ||
          (pipeline?.accepted ?? 0) > 0 ||
          (pipeline?.repairedExisting ?? 0) > 0
        )
          onTopicsChanged(developerId);
      }
      res.json({ run });
    }),
  );

  router.post(
    "/:id/evaluate/:runId/env",
    guard("evaluate-env", async (req, res, developerId, rid) => {
      const out = submitRunEnv(
        developerId,
        String(req.params.id),
        String(req.params.runId),
        {
          env: req.body?.env,
          allowDummy: req.body?.allowDummy,
        },
      );

      // names only, never values
      log(rid, `evaluate-env status=${out.status}`);

      res.status(RUN_ENV_HTTP[out.status] ?? 500).json(out);
    }),
  );

  /* ---- legacy: CI-based submit (kept so older clients still work) ---- */
  router.post(
    "/:id/submit",
    guard("submit", async (req, res, developerId, rid) => {
      const head =
        typeof req.body?.head === "string" ? req.body.head.trim() : "";

      if (!head) {
        res.status(400).json({
          error: "head (branch or commit sha) is required",
        });
        return;
      }

      const missionId = String(req.params.id);

      const result = await submitMission(deps, {
        developerId,
        missionId,
        head,
      });

      log(rid, `submit result status=${result.status}`, {
        notes: (result as any).notes,
        errors: (result as any).errors,
      });

      res.status(EVAL_HTTP[result.status] ?? 500).json(result);
    }),
  );

  router.post(
    "/:id/abandon",
    guard("abandon", async (req, res, developerId, rid) => {
      const missionId = String(req.params.id);
      const existing = await getMission(deps, developerId, missionId);

      if (!existing) {
        res.status(404).json({ ok: false, error: "mission not found" });
        return;
      }

      const ok = await abandonMission(deps, developerId, missionId);

      log(rid, `abandon missionId=${missionId} ok=${ok}`);

      if (!ok) {
        res.status(409).json({ ok });
        return;
      }

      // Abandoned work must not keep counting as capability evidence.
      // A retraction failure is logged but does not undo the abandon.
      try {
        const retraction = await retractMissionEvidence({
          graph: deps.graph,
          developerId,
          missionId,
          reason: "mission abandoned",
        });
        log(rid, "abandon retraction", retraction);
        onTopicsChanged(developerId);
      } catch (error) {
        log(rid, "abandon retraction FAILED", error);
      }

      res.status(200).json({ ok });
    }),
  );

  return router;
}
