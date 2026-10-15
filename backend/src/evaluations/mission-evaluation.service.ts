import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";

import { getMission, type MissionDeps } from "../service/mission.service.js";
import { runInSandbox } from "../service/daytona.service.js";
import {
  MissionError,
  analyzeRepository,
  buildEnvironment,
  buildExecutionPlan,
  finalizeVerdict,
  generateMissionTest,
  judgeMission,
  noSandboxFacts,
  parseVitestResults,
  planMissionTests,
  resolveEnv,
  runStaticChecks,
  type ChangedFile,
  type CommitReport,
  type EvalStepId,
  type EvaluationOutcome,
  type ProjectTestInfo,
  type SandboxFacts,
  type SandboxOutcome,
  type StepStatus,
  type StrategyId,
} from "./mission-evaluation-agent.js";
import type { LlmClient } from "../agents/goal-agent.js";
import type { MissionRepoPin, MissionSpec } from "../graph/mission-graph.js";

export const STEP_ORDER: EvalStepId[] = [
  "fetch",
  "analyze",
  "plan",
  "generate",
  "sandbox",
  "install",
  "extras",
  "server",
  "test",
  "judge",
];

const STEP_LABEL: Record<EvalStepId, string> = {
  fetch: "Download your push",
  analyze: "Analyze the repository",
  plan: "Plan the run",
  generate: "Write the mission tests",
  sandbox: "Create the sandbox",
  install: "Install dependencies",
  extras: "Prepare the test runner",
  devtests: "Run your own tests",
  server: "Start your server",
  test: "Run the mission tests",
  judge: "Check the results",
};

export interface StepView {
  id: EvalStepId;
  label: string;
  status: StepStatus;
  detail: string;
  command: string;
}

export interface CriterionPlanView {
  id: string;
  strategy: StrategyId;
  available: boolean;
  reason: string;
}

export interface RunView {
  runId: string;
  missionId: string;
  status: "running" | "needs_env" | "done" | "error";
  head: string;
  headSha: string;
  steps: StepView[];
  /** blocking env vars the developer must provide (status "needs_env") */
  envRequest: Array<{ name: string; reason: string }>;
  envInfo: { filled: string[]; provided: string[] };
  /** what the push changed and whether it touches the mission */
  commit: CommitReport | null;
  /** which strategy checks each acceptance criterion */
  criteriaPlan: CriterionPlanView[];
  /** whether the project's own `npm test` is real, a placeholder, or missing */
  projectTest: ProjectTestInfo | null;
  outcome: EvaluationOutcome | null;
  testCode: string;
  /** true when the failure looks like our environment, not the developer's code */
  infra: boolean;
  error: string;
  log: string;
  startedAt: string;
  durationMs: number;
}

interface EnvAnswer {
  env: Record<string, string>;
  allowDummy: boolean;
}

interface Run extends RunView {
  developerId: string;
  missingNames: string[];
  waiter: ((a: EnvAnswer) => void) | null;
  createdMs: number;
}

export type StartResult =
  | { status: "started" | "already_running"; run: RunView }
  | {
      status:
        | "not_found"
        | "not_evaluable"
        | "no_workspace"
        | "llm_unavailable"
        | "bad_head";
      message: string;
    };

export type EnvResult =
  | { status: "ok"; run: RunView }
  | { status: "not_found" | "not_waiting"; message: string }
  | { status: "missing_keys"; message: string; missing: string[] };

export interface RecordInput {
  developerId: string;
  missionId: string;
  headSha: string;
  outcome: EvaluationOutcome;
}

export type EvaluationRecorder = (r: RecordInput) => Promise<void>;
let recorder: EvaluationRecorder | null = null;
export const setEvaluationRecorder = (fn: EvaluationRecorder | null): void => {
  recorder = fn;
};

/* ------------------------------------------------------------------ */
/* run store                                                           */
/* ------------------------------------------------------------------ */

const RUN_TTL_MS = 2 * 60 * 60 * 1000;
const ENV_WAIT_MS = 10 * 60 * 1000;
const LOG_KEEP = 60_000;
/** one retry when the sandbox fails for a reason that looks like our environment */
const SANDBOX_ATTEMPTS = 2;

const runs = new Map<string, Run>();
const sweep = setInterval(
  () => {
    const now = Date.now();
    for (const [id, r] of runs)
      if (now - r.createdMs > RUN_TTL_MS && r.status !== "running")
        runs.delete(id);
  },
  10 * 60 * 1000,
);
sweep.unref?.();

const view = (r: Run): RunView => {
  const { developerId, missingNames, waiter, createdMs, ...pub } = r;
  void developerId;
  void missingNames;
  void waiter;
  void createdMs;
  return { ...pub, durationMs: r.durationMs || Date.now() - createdMs };
};

const owned = (developerId: string, missionId: string, runId: string) => {
  const r = runs.get(runId);
  return r && r.developerId === developerId && r.missionId === missionId
    ? r
    : null;
};

export const getRun = (
  developerId: string,
  missionId: string,
  runId: string,
): RunView | null => {
  const r = owned(developerId, missionId, runId);
  return r ? view(r) : null;
};

export const latestRun = (
  developerId: string,
  missionId: string,
): RunView | null => {
  let best: Run | null = null;
  for (const r of runs.values())
    if (
      r.developerId === developerId &&
      r.missionId === missionId &&
      (!best || r.createdMs > best.createdMs)
    )
      best = r;
  return best ? view(best) : null;
};

/* ------------------------------------------------------------------ */
/* GitHub snapshot: commit sha, tarball, text files, diff              */
/* ------------------------------------------------------------------ */

const GH = "https://api.github.com";
const MAX_TARBALL = 80 * 1024 * 1024;
const MAX_FILE = 400_000;
const SKIP_DIRS =
  /(^|\/)(node_modules|\.git|dist|build|\.next|coverage|\.turbo)\//;
const LOCKFILE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/;

const ghHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "pathway-mission-evaluator",
});

async function ghJson<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${GH}${path}`, { headers: ghHeaders(token) });
  if (!res.ok)
    throw new MissionError(
      res.status === 404
        ? "GitHub could not find your fork or branch. Did you push?"
        : res.status === 401 || res.status === 403
          ? "GitHub refused access. Reconnect GitHub and try again."
          : `GitHub answered HTTP ${res.status}.`,
    );
  return (await res.json()) as T;
}

/** Minimal tar reader: enough for GitHub tarballs (pax headers, long names). */
function untar(tar: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let off = 0;
  let paxPath = "";
  let longName = "";
  while (off + 512 <= tar.length) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const rd = (s: number, l: number) =>
      h.toString("utf8", s, s + l).replace(/\0[\s\S]*$/, "");
    let name = rd(0, 100);
    const prefix = rd(345, 155);
    if (prefix) name = `${prefix}/${name}`;
    const size = parseInt(rd(124, 12).trim() || "0", 8) || 0;
    const type = String.fromCharCode(h[156]);
    const body = tar.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;

    if (type === "g") continue;
    if (type === "x") {
      const m = /\d+ path=([^\n]+)\n/.exec(body.toString("utf8"));
      if (m) paxPath = m[1];
      continue;
    }
    if (type === "L") {
      longName = body.toString("utf8").replace(/\0[\s\S]*$/, "");
      continue;
    }
    if (paxPath) {
      name = paxPath;
      paxPath = "";
    } else if (longName) {
      name = longName;
      longName = "";
    }
    if (type !== "0" && type !== "\0") continue;

    const rel = name.split("/").slice(1).join("/");
    if (!rel || SKIP_DIRS.test(rel)) continue;
    if (size > MAX_FILE) {
      if (LOCKFILE.test(rel)) files.set(rel, ""); // existence is enough
      continue;
    }
    if (body.includes(0)) continue; // binary
    files.set(rel, body.toString("utf8"));
  }
  return files;
}

interface Snapshot {
  sha: string;
  tarball: Buffer;
  files: Map<string, string>;
  changed: ChangedFile[];
}

async function loadSnapshot(
  token: string,
  fork: string,
  head: string,
  baseCommit: string,
): Promise<Snapshot> {
  const commit = await ghJson<{ sha: string }>(
    token,
    `/repos/${fork}/commits/${encodeURIComponent(head)}`,
  );
  const sha = commit.sha;

  const res = await fetch(`${GH}/repos/${fork}/tarball/${sha}`, {
    headers: ghHeaders(token),
    redirect: "follow",
  });
  if (!res.ok)
    throw new MissionError(
      `Could not download your branch (HTTP ${res.status}).`,
    );
  const tarball = Buffer.from(await res.arrayBuffer());
  if (tarball.length > MAX_TARBALL)
    throw new MissionError(
      "Your repository is too large to evaluate (over 80 MB).",
    );

  const files = untar(gunzipSync(tarball));

  // everything pushed since the mission's base commit (not just the last commit)
  const cmp = await ghJson<{
    files?: Array<{ filename: string; status: string; patch?: string }>;
  }>(token, `/repos/${fork}/compare/${baseCommit}...${sha}`);
  const changed: ChangedFile[] = (cmp.files ?? []).map((f) => ({
    path: f.filename,
    status: f.status,
    patch: f.patch ?? "",
  }));

  return { sha, tarball, files, changed };
}

/* ------------------------------------------------------------------ */
/* start                                                               */
/* ------------------------------------------------------------------ */

const SAFE_HEAD = /^[A-Za-z0-9._\/-]{1,200}$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

export async function startEvaluation(
  deps: MissionDeps,
  input: {
    developerId: string;
    missionId: string;
    head: string;
    githubToken: string;
  },
): Promise<StartResult> {
  const { developerId, missionId, head, githubToken } = input;

  if (!SAFE_HEAD.test(head) || head.includes(".."))
    return { status: "bad_head", message: "That branch name is not valid." };

  const mission = (await getMission(deps, developerId, missionId)) as any;
  if (!mission) return { status: "not_found", message: "Mission not found." };
  if (["completed", "abandoned", "proposed"].includes(mission.status))
    return {
      status: "not_evaluable",
      message:
        mission.status === "proposed"
          ? "Start the mission and push your work first."
          : `This mission is ${mission.status}.`,
    };
  if (!mission.forkRepository)
    return {
      status: "no_workspace",
      message: "No fork yet. Press “Start mission & create branch” first.",
    };

  const llm = (deps as any).llm as LlmClient | undefined;
  if (!llm)
    return {
      status: "llm_unavailable",
      message: "The evaluation agent is not configured on the server.",
    };

  // one live run per mission
  for (const r of runs.values())
    if (
      r.developerId === developerId &&
      r.missionId === missionId &&
      (r.status === "running" || r.status === "needs_env")
    )
      return { status: "already_running", run: view(r) };

  const run: Run = {
    runId: randomUUID(),
    missionId,
    developerId,
    status: "running",
    head,
    headSha: "",
    steps: STEP_ORDER.map((id) => ({
      id,
      label: STEP_LABEL[id],
      status: "pending" as StepStatus,
      detail: "",
      command: "",
    })),
    envRequest: [],
    envInfo: { filled: [], provided: [] },
    commit: null,
    criteriaPlan: [],
    projectTest: null,
    outcome: null,
    testCode: "",
    infra: false,
    error: "",
    log: "",
    startedAt: new Date().toISOString(),
    durationMs: 0,
    missingNames: [],
    waiter: null,
    createdMs: Date.now(),
  };
  runs.set(run.runId, run);

  void execute(run, {
    llm,
    token: githubToken,
    fork: String(mission.forkRepository),
    spec: mission.spec as MissionSpec,
    pin: mission.pin as MissionRepoPin,
    baseCommit: String(mission.pin?.baseCommit ?? ""),
  });

  return { status: "started", run: view(run) };
}

/* ------------------------------------------------------------------ */
/* env handshake                                                       */
/* ------------------------------------------------------------------ */

export function submitRunEnv(
  developerId: string,
  missionId: string,
  runId: string,
  body: { env?: unknown; allowDummy?: unknown },
): EnvResult {
  const run = owned(developerId, missionId, runId);
  if (!run) return { status: "not_found", message: "Run not found." };
  if (run.status !== "needs_env" || !run.waiter)
    return {
      status: "not_waiting",
      message: "This run is not waiting for environment values.",
    };

  const env: Record<string, string> = {};
  if (body.env && typeof body.env === "object")
    for (const [k, v] of Object.entries(body.env as Record<string, unknown>))
      if (
        ENV_NAME.test(k) &&
        typeof v === "string" &&
        v.trim() &&
        v.length <= 4000
      )
        env[k] = v;

  const allowDummy = body.allowDummy === true;
  const missing = run.missingNames.filter((n) => !env[n]);
  if (missing.length && !allowDummy)
    return {
      status: "missing_keys",
      message: `Still missing: ${missing.join(", ")}. Fill them in or use placeholder values.`,
      missing,
    };

  run.waiter({ env, allowDummy }); // values live only in this closure, never on the run
  return { status: "ok", run: view(run) };
}

const waitForEnv = (run: Run) =>
  new Promise<EnvAnswer>((resolve, reject) => {
    const timer = setTimeout(() => {
      run.waiter = null;
      reject(new MissionError("Timed out waiting for the environment values."));
    }, ENV_WAIT_MS);
    run.waiter = (a) => {
      clearTimeout(timer);
      run.waiter = null;
      resolve(a);
    };
  });

/* ------------------------------------------------------------------ */
/* the pipeline                                                        */
/* ------------------------------------------------------------------ */

interface Ctx {
  llm: LlmClient;
  token: string;
  fork: string;
  spec: MissionSpec;
  pin: MissionRepoPin;
  baseCommit: string;
}

const TEST_FILE = /\.(test|spec)\.[tj]sx?$/;

function pickCode(
  files: Map<string, string>,
  changed: ChangedFile[],
  spec: MissionSpec,
): Map<string, string> {
  const wanted = new Set<string>([
    spec.scope.startPath,
    ...spec.scope.modifyPaths,
    ...spec.scope.createPaths,
    ...changed.filter((c) => c.status !== "removed").map((c) => c.path),
  ]);
  const out = new Map<string, string>();
  for (const p of wanted) {
    const c = files.get(p);
    if (c && !TEST_FILE.test(p)) out.set(p, c);
  }
  return out;
}

type RunInput = Parameters<typeof runInSandbox>[0];

/**
 * Runs the Daytona sandbox. When it fails for a reason that looks like our
 * environment (not the developer's project) it is tried once more.
 */
async function runSandbox(input: RunInput): Promise<SandboxOutcome> {
  let last: SandboxOutcome | null = null;
  for (let attempt = 1; attempt <= SANDBOX_ATTEMPTS; attempt++) {
    last = (await runInSandbox(input)) as unknown as SandboxOutcome;
    const transient = Boolean(last.infra && last.failedAt);
    if (!transient) break;
    console.warn(
      `[mission-eval] sandbox attempt ${attempt}/${SANDBOX_ATTEMPTS} failed at ${last.failedAt} (environment)`,
    );
  }
  return last as SandboxOutcome;
}

async function execute(run: Run, ctx: Ctx): Promise<void> {
  const { llm, spec, pin } = ctx;
  const t0 = Date.now();

  const step = (
    id: EvalStepId,
    status: StepStatus,
    detail?: string,
    command?: string,
  ) => {
    const s = run.steps.find((x) => x.id === id);
    if (!s) return;
    s.status = status;
    if (detail !== undefined) s.detail = detail;
    if (command !== undefined) s.command = command;
  };

  const finish = (status: "done" | "error") => {
    for (const s of run.steps) if (s.status === "pending") s.status = "skipped";
    run.status = status;
    run.durationMs = Date.now() - t0;
  };

  /** store the outcome and persist it, unless the run could not be checked */
  const conclude = async (outcome: EvaluationOutcome, sha: string) => {
    run.outcome = outcome;
    finish("done");
    if (!recorder || outcome.overall === "blocked") return;
    try {
      await recorder({
        developerId: run.developerId,
        missionId: run.missionId,
        headSha: sha,
        outcome,
      });
    } catch (e) {
      console.error("[mission-eval] recorder failed", e);
    }
  };

  try {
    /* ---- fetch ---- */
    step("fetch", "running", "Downloading your pushed branch from GitHub.");
    const snap = await loadSnapshot(
      ctx.token,
      ctx.fork,
      run.head,
      ctx.baseCommit,
    );
    run.headSha = snap.sha;
    step(
      "fetch",
      "done",
      `Commit ${snap.sha.slice(0, 7)}, ${snap.changed.length} file${snap.changed.length === 1 ? "" : "s"} changed since the mission's base commit.`,
    );

    /* ---- 1. repository analyzer ---- */
    step(
      "analyze",
      "running",
      "Reading package.json, scripts, dependencies and test tools.",
    );
    const profile = analyzeRepository(snap.files, spec, pin);
    run.projectTest = profile.projectTest;
    step(
      "analyze",
      "done",
      [
        profile.framework !== "none"
          ? profile.framework
          : "no framework detected",
        profile.language,
        profile.packageManager,
        profile.testTools.length
          ? `tests: ${profile.testTools.join(", ")}`
          : "no test tool",
        profile.dataStores.length
          ? `data: ${profile.dataStores.map((s) => s.kind).join(", ")}`
          : "",
        profile.projectTest.status === "placeholder"
          ? "test script is npm's placeholder"
          : "",
      ]
        .filter(Boolean)
        .join(" · "),
    );

    /* ---- 2. mission test planner ---- */
    step(
      "plan",
      "running",
      "Checking whether this push touches the mission and choosing a test strategy per criterion.",
    );
    const testPlan = planMissionTests(spec, profile, snap.changed);
    run.commit = testPlan.commit;
    run.criteriaPlan = testPlan.criteria.map((c) => ({
      id: c.id,
      strategy: c.strategy,
      available: c.available,
      reason: c.available ? c.reason : c.unavailableReason,
    }));

    const code = pickCode(snap.files, snap.changed, spec);

    // nothing to evaluate: report it, run nothing, blame nothing on this push
    if (!testPlan.commit.relevant) {
      step("plan", "done", `${testPlan.commit.summary} Nothing was run.`);
      step("judge", "done", "No relevant implementation changes to check.");
      const outcome = finalizeVerdict({
        spec,
        testPlan,
        profile,
        changed: snap.changed,
        code,
        tests: [],
        staticTests: [],
        facts: noSandboxFacts(),
        judged: null,
        headSha: snap.sha,
      });
      await conclude(outcome, snap.sha);
      return;
    }

    /* ---- 3. environment resolver ---- */
    const envPlan = buildEnvironment(snap.files, profile, testPlan.mode);
    let resolved = resolveEnv(envPlan.report, {}, false, envPlan.serviceEnv);
    let allowDummy = false;

    if (resolved.missing.length) {
      run.missingNames = resolved.missing.map((k) => k.name);
      run.envRequest = resolved.missing.map((k) => ({
        name: k.name,
        reason: k.reason,
      }));
      step(
        "plan",
        "running",
        "Your server needs real third-party credentials to boot. Waiting for you.",
      );
      run.status = "needs_env";
      const answer = await waitForEnv(run);
      run.status = "running";
      run.envRequest = [];
      allowDummy = answer.allowDummy;
      resolved = resolveEnv(
        envPlan.report,
        answer.env,
        answer.allowDummy,
        envPlan.serviceEnv,
      );
    }

    run.envInfo = { filled: resolved.filled, provided: resolved.provided };
    const plan = buildExecutionPlan(profile, testPlan, {
      services: envPlan.services,
      allowSecretDummies: allowDummy,
    });
    step(
      "plan",
      "done",
      [
        testPlan.commit.summary,
        `${plan.mode === "http" ? "HTTP tests against your running server" : "Module tests that call your code directly"}`,
        `${testPlan.sandboxCriteria.length} sandboxed, ${testPlan.staticCriteria.length} static, ${testPlan.blockedCriteria.length} blocked criteria`,
        envPlan.services.length
          ? `services: ${envPlan.services.map((s) => s.name).join(", ")}`
          : "",
        resolved.filled.length
          ? `${resolved.filled.length} env var${resolved.filled.length === 1 ? "" : "s"} filled automatically`
          : "",
      ]
        .filter(Boolean)
        .join(" · "),
    );

    /* ---- 4. test strategy registry: generate ---- */
    let testCode = "";
    if (testPlan.sandboxCriteria.length) {
      step(
        "generate",
        "running",
        "Writing a vitest file from the mission's acceptance criteria.",
      );
      const gen = await generateMissionTest(llm, {
        spec,
        plan,
        testPlan,
        profile,
        mocks: envPlan.mocks,
        code,
        changed: snap.changed,
      });
      if (!gen.code) {
        step(
          "generate",
          "failed",
          gen.errors.slice(0, 3).join(" · ") || "No valid test file.",
        );
        run.infra = true;
        run.error =
          "The evaluator could not produce a valid test file for this mission. This is not caused by your code. Try again.";
        finish("error");
        return;
      }
      testCode = gen.code;
      run.testCode = gen.code;
      const n = (gen.code.match(/\b(it|test)\s*\(/g) ?? []).length;
      step(
        "generate",
        "done",
        `${n} tests written${gen.attempts > 1 ? ` (after ${gen.attempts} attempts)` : ""}.`,
      );
    } else {
      step("generate", "skipped", "No criterion needs generated tests.");
    }
    const staticTests = runStaticChecks(spec, testPlan, code, snap.changed);

    /* ---- 5. daytona runner ---- */
    let sb: SandboxOutcome | null = null;
    if (testCode) {
      sb = await runSandbox({
        plan,
        tarball: snap.tarball,
        testContent: testCode,
        env: resolved.env,
        onStep: step,
        // the developer writes no tests: run only the mission test file
        skipDevTests: true,
      } as RunInput);
      run.infra = sb.infra && Boolean(sb.failedAt);
    } else {
      for (const id of [
        "sandbox",
        "install",
        "extras",
        "devtests",
        "server",
        "test",
      ] as const)
        step(id, "skipped", "Not needed: no sandboxed tests.");
    }

    /* ---- 6. result evaluator ---- */
    step(
      "judge",
      "running",
      "Reading the results and checking your code against the contract.",
    );
    const parsed = sb
      ? parseVitestResults(sb.resultsRaw)
      : { cases: [], parsed: false, suiteError: "" };
    const missionExit = sb?.missionExit ?? null;
    // a test process that exited non-zero without producing results is a suite error,
    // never a silent success
    const suiteError =
      parsed.suiteError ||
      (sb &&
      !sb.failedAt &&
      !parsed.cases.length &&
      missionExit !== null &&
      missionExit !== 0
        ? `The mission test process exited with code ${missionExit} and produced no results.\n${sb.log.slice(-600)}`
        : "");
    const facts: SandboxFacts = sb
      ? {
          sandboxRan: true,
          failedAt: sb.failedAt,
          infra: sb.infra,
          timedOut: sb.timedOut,
          missionTestRan: parsed.parsed && parsed.cases.length > 0,
          missionExit,
          suiteError,
          devTests: sb.devTests,
          logTail: sb.log.slice(-4000),
        }
      : noSandboxFacts();

    const judged = await judgeMission(llm, {
      spec,
      testPlan,
      changed: snap.changed,
      code,
      tests: parsed.cases,
      staticTests,
      facts,
    });
    const outcome = finalizeVerdict({
      spec,
      testPlan,
      profile,
      changed: snap.changed,
      code,
      tests: parsed.cases,
      staticTests,
      facts,
      judged,
      headSha: snap.sha,
    });
    run.log = sb ? sb.log.slice(-LOG_KEEP) : "";
    const passed = outcome.results.filter((r) => r.status === "passed").length;
    const blocked = outcome.results.filter(
      (r) => r.status === "blocked",
    ).length;
    step(
      "judge",
      "done",
      outcome.verdict === "completed"
        ? "Every check passed."
        : `${passed} of ${outcome.results.length} checks passed${blocked ? `, ${blocked} could not be checked` : ""}.`,
    );

    await conclude(outcome, snap.sha);
  } catch (e) {
    console.error("[mission-eval] run failed", run.runId, e);
    const running = run.steps.find((s) => s.status === "running");
    if (running) running.status = "failed";
    run.error =
      e instanceof MissionError
        ? e.message
        : "Something broke inside the evaluator. This is not caused by your code. Try again.";
    if (!(e instanceof MissionError) || /sandbox|Daytona/i.test(e.message))
      run.infra = true;
    run.waiter = null;
    run.envRequest = [];
    finish("error");
  }
}
