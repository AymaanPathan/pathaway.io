import type { Graph } from "../db/falkordb.js";
import { extractJson, type LlmClient } from "../agents/goal-agent.js";
import { planMission } from "../agents/plan-mission-agent.js";
import {
  listGoalMissions,
  loadLatestEvaluation,
  loadMission,
  loadSavedMove,
  markAbandoned,
  markStarted,
  newMissionId,
  recordEvaluation,
  saveWorkspace,
  storeMission,
  type CriterionResult,
  type EvaluationRecord,
  type ExplanationEvidence,
  type GapCheck,
  type MissionExplanation,
  type MissionSpec,
  type MissionStored,
  type Row,
  type SavedMove,
  type StoredMission,
} from "../graph/mission-graph.js";
import {
  deriveGapTerms,
  inspectRepository,
  locateEvidence,
  mechanismToken,
  type CiState,
  type CompareCommit,
  type RepoInspection,
  type RepoInspector,
} from "./mission-repo.service.js";

export interface MissionDeps {
  graph: Graph;
  llm: LlmClient | null;
  /** reads the repository (server token is fine) */
  inspector: RepoInspector;
}

export interface CreateMissionInput {
  developerId: string;
  goalId: string;
  timeoutMs?: number;
}

export interface CreateMissionResult {
  status:
    | "created"
    | "existing"
    | "goal_not_found"
    | "needs_replan"
    | "repository_unavailable"
    | "llm_unavailable"
    | "generation_failed"
    | "store_failed";
  mission: StoredMission | null;
  reason: string;
  errors: string[];
  stored: MissionStored | null;
  llmCalls: number;
  notes: string[];
  timingsMs: {
    graph: number;
    repo: number;
    llm: number;
    store: number;
    total: number;
  };
}

const str = (v: unknown): string =>
  v == null || typeof v === "object" ? "" : String(v).trim();

const clip = (s: string, n: number): string =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

const LOG = "[mission-service]";
const slog = (msg: string, detail?: unknown): void =>
  detail !== undefined
    ? console.log(`${LOG} ${msg}`, detail)
    : console.log(`${LOG} ${msg}`);

const TEST_FILE_PATH =
  /(^|\/)(__tests__|__mocks__)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;

function gapCheckOf(probe: RepoInspection["gapProbe"]): GapCheck {
  const status: GapCheck["status"] = probe.contradictingTerms.length
    ? "contradicted"
    : probe.dependencyHits.length || probe.pathHits.length
      ? "weak_signal"
      : probe.manifestScanned
        ? "not_found_in_scope"
        : "unverified";
  return {
    terms: probe.terms,
    status,
    dependencyHits: probe.dependencyHits,
    startFileHits: probe.startFileHits,
    pathHits: probe.pathHits,
    contradictingTerms: probe.contradictingTerms,
    scope: probe.manifestScanned
      ? "package.json dependencies, the start file text and repository file paths. Other files were not read."
      : "No package.json was found or readable, so dependencies were not scanned. Only the start file text and file paths were checked.",
  };
}

async function buildExplanation(
  deps: MissionDeps,
  saved: SavedMove,
  inspection: RepoInspection,
  spec: MissionSpec,
  observedInCode: string,
  anchorRef: string,
): Promise<MissionExplanation> {
  const cited = new Set(spec.grounding.evidenceIds.map((x) => x.toUpperCase()));
  const evidence: ExplanationEvidence[] = [];
  let checkedFiles = 0;

  for (const e of saved.evidence) {
    const isCited = cited.has(e.ref.toUpperCase());
    let verifiedAtCommit: boolean | null = null;
    let excerpt = "";
    // bounded: only cited evidence, at most 3 file reads
    if (isCited && checkedFiles < 3 && e.repository && e.commitSha && e.path) {
      checkedFiles += 1;
      try {
        const body = await deps.inspector.readFile(
          e.repository,
          e.commitSha,
          e.path,
        );
        if (body === null) verifiedAtCommit = false;
        else if (e.ref.toUpperCase() === anchorRef) {
          const hit = locateEvidence(body, observedInCode);
          verifiedAtCommit = hit.found;
          excerpt = hit.excerpt;
        } else {
          // no fragment to match: only the file's existence at that commit is established
          verifiedAtCommit = null;
          excerpt = "";
        }
      } catch (error) {
        slog("evidence read FAILED", {
          ref: e.ref,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    evidence.push({
      ref: e.ref,
      cited: isCited,
      repository: e.repository,
      path: e.path,
      commitSha: e.commitSha,
      permalink: e.permalink,
      technique: e.technique,
      summary: e.summary,
      fileChangeId: e.fileChangeId,
      demonstrationId: e.demonstrationId,
      verifiedAtCommit,
      excerpt,
    });
  }

  const gapCheck = gapCheckOf(inspection.gapProbe);
  const decision = (saved.details.decision ?? {}) as Row;
  const anchor = evidence.find((e) => e.ref.toUpperCase() === anchorRef);

  const proves: string[] = [];
  if (anchor?.verifiedAtCommit === true)
    proves.push(
      `${anchor.path} at ${anchor.commitSha.slice(0, 7)} contained the code the goal was built on (the file was fetched and the fragment found).`,
    );
  if (inspection.observedStillPresent)
    proves.push(
      `${inspection.startPath} at the pinned commit ${inspection.pin.baseCommit.slice(0, 7)} still contains that code.`,
    );
  proves.push(
    `The graph returned ${saved.evidence.length} demonstration(s) and ${saved.strengthSlugs.length} strength topic(s) linked to the saved move.`,
  );

  const doesNotProve: string[] = [
    `That the developer has never used this capability anywhere else: ${gapCheck.scope}`,
    "That this was the best of all possible next missions: the goal agent saved only the chosen move, so no competing candidates were compared.",
  ];
  if (anchor?.verifiedAtCommit === null)
    doesNotProve.push(
      "That the cited evidence still looks the same today: it was not re-read for the anchor fragment.",
    );
  if (gapCheck.status === "weak_signal")
    doesNotProve.push(
      "That the gap is fully open: related dependencies or paths exist and the mission may overlap with them.",
    );

  return {
    generatedAt: new Date().toISOString(),
    trace: saved.trace,
    evidence,
    gapCheck,
    selection: {
      goal: saved.wish,
      moveTitle: saved.title,
      moveWhy: str(decision.why) || saved.summary,
      capability: saved.capability,
      focusSlug: saved.focusSlug,
      builtOn: saved.strengthSlugs,
      gapTopics: saved.gapSlugs,
      startFileChangeId: saved.startFileChangeId,
      alternatives: "not_recorded",
      note: "The goal agent chose this move before the mission was written. Its competing candidates were not saved, so no ranking or comparison is shown.",
    },
    proves,
    doesNotProve,
  };
}

export async function createMission(
  deps: MissionDeps,
  input: CreateMissionInput,
): Promise<CreateMissionResult> {
  const started = Date.now();
  const notes: string[] = [];
  const timings = { graph: 0, repo: 0, llm: 0, store: 0, total: 0 };
  let llmCalls = 0;

  slog("createMission start", {
    developerId: JSON.stringify(input.developerId),
    goalId: JSON.stringify(input.goalId),
  });

  const done = (
    p: Partial<CreateMissionResult> & Pick<CreateMissionResult, "status">,
  ): CreateMissionResult => {
    timings.total = Date.now() - started;
    slog(`createMission finished: ${p.status}`, {
      reason: p.reason ?? "",
      timingsMs: timings,
    });
    return {
      mission: null,
      reason: "",
      errors: [],
      stored: null,
      llmCalls,
      notes,
      timingsMs: timings,
      ...p,
    };
  };

  // 1) saved goal and move
  let t0 = Date.now();
  const saved = await loadSavedMove(
    deps.graph,
    input.developerId,
    input.goalId,
  );
  const previous = saved
    ? await listGoalMissions(deps.graph, input.developerId, input.goalId)
    : [];
  timings.graph += Date.now() - t0;
  slog("saved move lookup", {
    found: Boolean(saved),
    previousMissions: previous.length,
    ms: Date.now() - t0,
  });
  if (!saved)
    return done({
      status: "goal_not_found",
      reason:
        "No saved goal with a NextMove exists for this developer and goal id. Run planGoal first.",
    });

  // idempotent: one live mission per version of the move
  const sameMove = previous.filter((m) => m.moveVersion === saved.moveVersion);
  const live = sameMove.find((m) => m.status !== "abandoned");
  slog("idempotency", {
    moveVersion: saved.moveVersion,
    sameMove: sameMove.length,
    live: live?.id ?? null,
  });
  if (live) return done({ status: "existing", mission: live });

  // 2) where the move starts
  const challenge = (saved.details.challenge ?? {}) as Row;
  const start = (saved.details.startingPoint ?? {}) as Row;
  const anchorRef = str(challenge.existingEvidenceId).toUpperCase();
  const anchor = saved.evidence.find((e) => e.ref === anchorRef);
  const repository = str(start.repository) || anchor?.repository || "";
  const startPath = str(start.path) || anchor?.path || "";
  const observedInCode = str(challenge.observedInCode);
  slog("start point", {
    repository,
    startPath,
    observedInCode: observedInCode.slice(0, 60),
    anchorFound: Boolean(anchor),
  });
  if (!repository || !startPath || !observedInCode)
    return done({
      status: "needs_replan",
      reason:
        "The saved move has no repository, starting file or observed code. Run planGoal again.",
    });

  // 3) inspect the real repository at its current head
  const gapTerms = deriveGapTerms([
    saved.capability?.name,
    saved.capability?.id,
    saved.focusSlug,
    ...saved.gapSlugs,
  ]);
  t0 = Date.now();
  let inspection;
  try {
    inspection = await inspectRepository(deps.inspector, {
      repository,
      startPath,
      observedInCode,
      gapTerms,
    });
  } catch (error) {
    timings.repo += Date.now() - t0;
    slog("inspection FAILED", error);
    return done({
      status: "repository_unavailable",
      reason: `Could not read ${repository}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  timings.repo += Date.now() - t0;
  slog("inspection", {
    baseCommit: inspection.pin.baseCommit.slice(0, 7),
    branch: inspection.pin.branch,
    startFileExists: inspection.startFileExists,
    observedStillPresent: inspection.observedStillPresent,
    testRunner: inspection.pin.testRunner,
    testFiles: inspection.testFiles.length,
    gapTerms,
    gapDependencyHits: inspection.gapProbe.dependencyHits,
    gapContradicting: inspection.gapProbe.contradictingTerms,
    ms: Date.now() - t0,
  });

  if (!inspection.startFileExists)
    return done({
      status: "needs_replan",
      reason: `${startPath} no longer exists in ${repository} at ${inspection.pin.baseCommit.slice(0, 7)}. The goal is stale: run planGoal again.`,
    });
  if (!inspection.observedStillPresent)
    return done({
      status: "needs_replan",
      reason: `The code the goal was built on is no longer in ${startPath}. The goal is stale: run planGoal again.`,
    });
  // the capability looks already present: do not invent a weakness
  if (inspection.gapProbe.contradictingTerms.length)
    return done({
      status: "needs_replan",
      reason: `The repository already depends on and uses ${inspection.gapProbe.contradictingTerms.join(", ")} (${inspection.gapProbe.dependencyHits.slice(0, 3).join(", ")} in package.json, referenced in ${inspection.startPath}). The gap this goal assumed is not supported. Run planGoal again.`,
    });
  if (inspection.gapProbe.dependencyHits.length)
    notes.push(
      `gap check: package.json already lists ${inspection.gapProbe.dependencyHits.slice(0, 3).join(", ")}; the gap may be partly closed`,
    );

  // 4) the Mission Agent writes it (implementation files + the test cases WE run)
  t0 = Date.now();
  const plan = await planMission(deps.llm, {
    saved,
    inspection,
    previousMissions: previous,
    timeoutMs: input.timeoutMs,
  });
  llmCalls += plan.llmCalls;
  notes.push(...plan.notes);
  timings.llm += Date.now() - t0;
  slog("plan", {
    status: plan.status,
    source: plan.source,
    llmCalls: plan.llmCalls,
    errors: plan.errors,
    notes: plan.notes,
    ms: Date.now() - t0,
  });
  if (plan.status === "llm_unavailable")
    return done({ status: "llm_unavailable", reason: plan.notes[0] ?? "" });
  if (plan.status !== "planned" || !plan.spec)
    return done({
      status: "generation_failed",
      reason:
        "The Mission Agent could not produce a mission that passed validation.",
      errors: plan.errors,
    });

  // 5) explanation: executed queries + code that was actually re-read
  t0 = Date.now();
  const explanation = await buildExplanation(
    deps,
    saved,
    inspection,
    plan.spec,
    observedInCode,
    anchorRef,
  );
  timings.repo += Date.now() - t0;

  // 6) persist
  t0 = Date.now();
  const id = newMissionId(saved.goalId, saved.moveVersion, sameMove.length + 1);
  const stored = await storeMission(
    deps.graph,
    saved,
    id,
    plan.spec,
    inspection.pin,
    explanation,
  );
  timings.store += Date.now() - t0;
  slog("store", {
    missionId: id,
    stored: stored.stored,
    links: stored.links,
    rejected: stored.rejected,
    ms: Date.now() - t0,
  });
  if (!stored.stored)
    return done({
      status: "store_failed",
      reason:
        stored.rejected.join("; ") ||
        "The mission could not be written to the graph.",
      stored,
    });
  notes.push(...stored.rejected.map((r) => `store: ${r}`));

  const mission = await loadMission(deps.graph, input.developerId, id);
  slog("mission reloaded", { id, found: Boolean(mission) });
  return done({ status: "created", mission, stored });
}

export async function getMission(
  deps: MissionDeps,
  developerId: string,
  missionId: string,
): Promise<StoredMission | null> {
  return loadMission(deps.graph, developerId, missionId);
}

export async function getLatestEvaluation(
  deps: MissionDeps,
  developerId: string,
  missionId: string,
): Promise<EvaluationRecord | null> {
  return loadLatestEvaluation(deps.graph, developerId, missionId);
}

export async function startMission(
  deps: MissionDeps,
  developerId: string,
  missionId: string,
): Promise<{ ok: boolean; reason: string; mission: StoredMission | null }> {
  const mission = await loadMission(deps.graph, developerId, missionId);
  if (!mission)
    return { ok: false, reason: "mission not found", mission: null };
  if (mission.status !== "proposed")
    return {
      ok: false,
      reason: `mission is ${mission.status}, only a proposed mission can be started`,
      mission,
    };
  await markStarted(deps.graph, developerId, missionId);
  return {
    ok: true,
    reason: "",
    mission: await loadMission(deps.graph, developerId, missionId),
  };
}

export async function abandonMission(
  deps: MissionDeps,
  developerId: string,
  missionId: string,
): Promise<boolean> {
  const mission = await loadMission(deps.graph, developerId, missionId);
  if (!mission || mission.status === "completed") return false;
  return markAbandoned(deps.graph, developerId, missionId);
}

// ------------------------------------------------------------
// workspace: fork + branch for the developer
// ------------------------------------------------------------

export interface WorkspaceResult {
  ok: boolean;
  reason: string;
  forkRepository: string;
  branch: string;
  baseCommit: string;
  cloneUrl: string;
  compareUrl: string;
  /** implementation files the developer should edit / create, straight from the mission */
  modifyPaths: string[];
  createPaths: string[];
  /** always null now: the developer writes no tests, the platform does */
  testFile: string | null;
  testCommand: string | null;
  commands: string[];
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "mission";

export function workspaceBranchName(mission: StoredMission): string {
  return `mission/${slug(mission.spec.title)}-${mission.id.split(":").pop() ?? "1"}`;
}

export async function prepareWorkspace(
  deps: MissionDeps,
  input: {
    developerId: string;
    missionId: string;
    userInspector: RepoInspector;
  },
): Promise<WorkspaceResult> {
  const fail = (reason: string): WorkspaceResult => ({
    ok: false,
    reason,
    forkRepository: "",
    branch: "",
    baseCommit: "",
    cloneUrl: "",
    compareUrl: "",
    modifyPaths: [],
    createPaths: [],
    testFile: null,
    testCommand: null,
    commands: [],
  });

  const mission = await loadMission(
    deps.graph,
    input.developerId,
    input.missionId,
  );
  if (!mission) return fail("mission not found");
  if (mission.status === "abandoned" || mission.status === "completed")
    return fail(`mission is ${mission.status}`);

  const { repository, baseCommit } = mission.pin;
  const branchName = workspaceBranchName(mission);

  try {
    const fork = await input.userInspector.forkRepo(repository);
    const branch = await input.userInspector.createBranch(
      fork,
      branchName,
      baseCommit,
    );
    await saveWorkspace(deps.graph, input.developerId, input.missionId, {
      forkRepository: fork,
      branch,
    });
    if (mission.status === "proposed")
      await markStarted(deps.graph, input.developerId, input.missionId);

    const cloneUrl = `https://github.com/${fork}.git`;
    const dir = fork.split("/")[1] ?? "repo";
    slog("workspace ready", { missionId: mission.id, fork, branch });
    return {
      ok: true,
      reason: "",
      forkRepository: fork,
      branch,
      baseCommit,
      cloneUrl,
      compareUrl: `https://github.com/${fork}/compare/${branch}?expand=1`,
      modifyPaths: mission.spec.scope.modifyPaths,
      createPaths: mission.spec.scope.createPaths,
      testFile: null,
      testCommand: null,
      commands: [
        `git clone ${cloneUrl}`,
        `cd ${dir}`,
        `git checkout ${branch}`,
      ],
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    slog("workspace FAILED", reason);
    return fail(reason);
  }
}

export interface BranchCommit {
  sha: string;
  /** first line of the commit message */
  message: string;
  author: string;
  date: string;
  url: string;
}

export interface BranchCommitsResult {
  ok: boolean;
  status: "ok" | "not_found" | "no_workspace" | "repository_unavailable";
  reason: string;
  forkRepository: string;
  branch: string;
  baseCommit: string;
  aheadBy: number;
  compareUrl: string;
  /** newest first */
  commits: BranchCommit[];
}

export async function listBranchCommits(
  deps: MissionDeps,
  input: { developerId: string; missionId: string },
): Promise<BranchCommitsResult> {
  const empty = (
    status: BranchCommitsResult["status"],
    reason: string,
    extra: Partial<BranchCommitsResult> = {},
  ): BranchCommitsResult => ({
    ok: false,
    status,
    reason,
    forkRepository: "",
    branch: "",
    baseCommit: "",
    aheadBy: 0,
    compareUrl: "",
    commits: [],
    ...extra,
  });

  const mission = await loadMission(
    deps.graph,
    input.developerId,
    input.missionId,
  );
  if (!mission) return empty("not_found", "mission not found");

  const fork = mission.forkRepository;
  if (!fork)
    return empty(
      "no_workspace",
      "no workspace yet: create the branch first (POST /:id/workspace)",
    );

  const branch = workspaceBranchName(mission);
  const { baseCommit } = mission.pin;

  let cmp;
  try {
    cmp = await deps.inspector.compare(fork, baseCommit, branch);
  } catch (error) {
    const reason = `Could not read ${branch} on ${fork}: ${error instanceof Error ? error.message : String(error)}`;
    slog("commits compare FAILED", reason);
    return empty("repository_unavailable", reason, {
      forkRepository: fork,
      branch,
      baseCommit,
    });
  }

  const commits: BranchCommit[] = cmp.commits
    .slice()
    .reverse()
    .map((c: CompareCommit) => ({
      sha: c.sha,
      message: c.message,
      author: c.author,
      date: c.date,
      url: c.url,
    }));

  return {
    ok: true,
    status: "ok",
    reason: "",
    forkRepository: fork,
    branch,
    baseCommit,
    aheadBy: cmp.aheadBy,
    compareUrl: `https://github.com/${fork}/compare/${encodeURIComponent(baseCommit)}...${branch}`,
    commits,
  };
}

export type SubmitStatus =
  | "completed"
  | "needs_work"
  | "not_found"
  | "not_evaluable"
  | "repository_unavailable"
  | "llm_unavailable"
  | "generation_failed"
  | "ci_pending"
  | "ci_required";

export interface CriterionVerdict {
  id: string;
  description: string;
  met: boolean;
  /** true when the judge's quote was found in the added lines of the diff */
  verified: boolean;
  evidence: string;
}

export interface SubmitMissionInput {
  developerId: string;
  missionId: string;
  /** pushed branch or commit sha in the developer's fork */
  head: string;
  timeoutMs?: number;
}

export interface SubmitResult {
  status: SubmitStatus;
  reason: string;
  /** same text as `reason`, the field the UI reads */
  message: string;
  head: { sha: string; subject: string; aheadBy: number } | null;
  ci: CiState | null;
  criteria: CriterionVerdict[];
  evaluation: EvaluationRecord | null;
  demonstrationId: string | null;
  changedFiles: Array<{
    path: string;
    status: string;
    additions: number;
    deletions: number;
  }>;
  errors: string[];
  notes: string[];
  llmCalls: number;
  timingsMs: { repo: number; llm: number; total: number };
}

const JUDGE_SYSTEM = `You are the evaluator of a developer-growth platform. A developer pushed an implementation for a mission. CI is green. Judge each acceptance criterion ONLY from the diff you are given.
A criterion is met only if the diff clearly implements the behaviour. The developer does not write tests; the platform tests the implementation. If the mission has a contract library, an implementation that skips that library (for example a local Map) does NOT meet a criterion about that library: the code must call the library's client. If you cannot see it in the diff, it is not met.
For every criterion give "quote": ONE line copied verbatim from the ADDED lines of the diff (without the leading +) that shows the behaviour. If you cannot quote a line, set met to false and quote to "".
Reply with JSON only, exactly this shape:
{"criteria":[{"id":"AC1","met":true,"quote":"<verbatim added line>","reasoning":"<one sentence naming the function or code path>"}]}
Include every criterion id you were given.`;

const addedLines = (patch: string): string[] =>
  patch
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));
const squash = (s: string): string =>
  s.replace(/\s+/g, " ").trim().toLowerCase();

export async function submitMission(
  deps: MissionDeps,
  input: SubmitMissionInput,
): Promise<SubmitResult> {
  const started = Date.now();
  const notes: string[] = [];
  const timings = { repo: 0, llm: 0, total: 0 };
  let llmCalls = 0;

  const done = (
    p: Partial<SubmitResult> & Pick<SubmitResult, "status">,
  ): SubmitResult => {
    timings.total = Date.now() - started;
    slog(`submit finished: ${p.status}`, {
      reason: p.reason ?? "",
      timingsMs: timings,
    });
    const out: SubmitResult = {
      reason: "",
      message: "",
      head: null,
      ci: null,
      criteria: [],
      evaluation: null,
      demonstrationId: null,
      changedFiles: [],
      errors: [],
      notes,
      llmCalls,
      timingsMs: timings,
      ...p,
    };
    out.message = out.reason;
    return out;
  };

  const mission = await loadMission(
    deps.graph,
    input.developerId,
    input.missionId,
  );
  if (!mission)
    return done({ status: "not_found", reason: "mission not found" });
  if (mission.status === "abandoned" || mission.status === "completed")
    return done({
      status: "not_evaluable",
      reason: `mission is ${mission.status}`,
    });

  const fork = mission.forkRepository;
  if (!fork)
    return done({
      status: "not_evaluable",
      reason:
        "no workspace yet: create the fork and branch first (POST /:id/workspace)",
    });

  const { baseCommit } = mission.pin;
  const spec = mission.spec;

  // 1) what changed since the pinned base commit
  let t0 = Date.now();
  let cmp;
  try {
    cmp = await deps.inspector.compare(fork, baseCommit, input.head);
  } catch (error) {
    timings.repo += Date.now() - t0;
    slog("compare FAILED", error);
    return done({
      status: "repository_unavailable",
      reason: `Could not compare ${fork} at ${input.head}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  timings.repo += Date.now() - t0;

  const changedFiles = cmp.files.map((f) => ({
    path: f.path,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
  }));
  const head = {
    sha: cmp.headSha,
    subject: cmp.headSubject,
    aheadBy: cmp.aheadBy,
  };
  slog("compare", { fork, head, files: changedFiles.length });
  if (cmp.truncated) notes.push("diff was truncated by GitHub (300+ files)");

  if (cmp.aheadBy === 0 || !cmp.files.length)
    return done({
      status: "needs_work",
      reason: `No commits on ${input.head} beyond the base commit. Commit and push your work first.`,
      head,
      changedFiles,
    });

  // 2) cheap gates. The developer writes NO tests: the platform tests the implementation.
  const problems: string[] = [];
  const startFile = cmp.files.find((f) => f.path === spec.scope.startPath);
  if (!startFile) problems.push(`${spec.scope.startPath} was not changed`);

  // the contract names a library: the implementation files must reference it,
  // otherwise a local stand-in could satisfy every check
  const token = mechanismToken(spec.contract?.library);
  if (token) {
    const implFiles = cmp.files.filter((f) => !TEST_FILE_PATH.test(f.path));
    const used = implFiles.some((f) =>
      squash(addedLines(f.patch).join("\n")).includes(token),
    );
    if (!used)
      problems.push(
        `none of your changed files use ${spec.contract?.library} (the mission contract requires it)`,
      );
  }
  if (problems.length)
    return done({
      status: "needs_work",
      reason: problems.join("; "),
      head,
      changedFiles,
    });

  const allowed = new Set(
    [...spec.scope.modifyPaths, ...spec.scope.createPaths].map((p) =>
      p.toLowerCase(),
    ),
  );
  const outside = cmp.files.filter((f) => !allowed.has(f.path.toLowerCase()));
  const scopeWarnings = outside.length
    ? [
        `files outside the mission scope: ${outside
          .slice(0, 5)
          .map((f) => f.path)
          .join(", ")}`,
      ]
    : [];
  notes.push(...scopeWarnings);

  // 3) CI is the real test run
  const ci = await deps.inspector.ciState(fork, cmp.headSha);
  slog("ci", { fork, sha: cmp.headSha.slice(0, 7), ci });
  if (ci === "pending")
    return done({
      status: "ci_pending",
      reason:
        "CI is still running on your latest commit. Submit again when it finishes.",
      head,
      ci,
      changedFiles,
    });
  if (ci === "none")
    return done({
      status: "ci_required",
      reason:
        "No CI run found on your fork. Forks have GitHub Actions disabled by default: enable Actions on your fork and make sure a workflow runs, then push again.",
      head,
      ci,
      changedFiles,
    });
  if (ci === "failure")
    return done({
      status: "needs_work",
      reason:
        "CI failed on your latest commit. Fix the failing checks and push again.",
      head,
      ci,
      changedFiles,
    });

  // 4) the LLM judges the criteria against the diff
  if (!deps.llm)
    return done({
      status: "llm_unavailable",
      reason: "no LLM configured: criteria cannot be judged",
      head,
      ci,
      changedFiles,
    });

  const diff = clip(
    cmp.files
      .map(
        (f) =>
          `### ${f.path} (${f.status} +${f.additions} -${f.deletions})\n${clip(f.patch, 3000)}`,
      )
      .join("\n\n"),
    16_000,
  );
  const user = `MISSION: ${spec.title}\nOBJECTIVE: ${spec.objective}\n\nCONTRACT:\n${JSON.stringify(spec.contract ?? null)}\n\nACCEPTANCE CRITERIA:\n${spec.criteria
    .map((c) => `${c.id} [${c.check}] ${c.description} (proof: ${c.how})`)
    .join("\n")}\n\nDIFF:\n${diff}`;

  const timeoutMs =
    input.timeoutMs ?? Number(process.env.LLM_TIMEOUT_MS ?? 30_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  t0 = Date.now();
  let raw = "";
  try {
    llmCalls += 1;
    raw = await deps.llm.complete({
      system: JUDGE_SYSTEM,
      user,
      maxTokens: 1800,
      json: true,
      signal: controller.signal,
    });
  } catch (error) {
    timings.llm += Date.now() - t0;
    return done({
      status: "generation_failed",
      reason: `The evaluator call failed: ${error instanceof Error ? error.message : String(error)}`,
      head,
      ci,
      changedFiles,
    });
  } finally {
    clearTimeout(timer);
  }
  timings.llm += Date.now() - t0;

  const parsed = extractJson(raw);
  const list = (
    Array.isArray(parsed?.criteria) ? parsed.criteria : []
  ) as Row[];
  const answered = spec.criteria.every((c) =>
    list.some((x) => str(x?.id).toUpperCase() === c.id.toUpperCase()),
  );
  if (!answered)
    return done({
      status: "generation_failed",
      reason: "The evaluator did not return a verdict for every criterion.",
      errors: [`raw: ${clip(raw.trim(), 200) || "empty"}`],
      head,
      ci,
      changedFiles,
    });

  // a judgement only counts when its quote really is an added line of the diff
  const addedText = squash(
    cmp.files.flatMap((f) => addedLines(f.patch)).join("\n"),
  );
  const results: CriterionResult[] = [];
  const verdicts: CriterionVerdict[] = spec.criteria.map((c) => {
    const v = list.find((x) => str(x?.id).toUpperCase() === c.id.toUpperCase());
    const quote = str(v?.quote).replace(/^\+\s?/, "");
    const reasoning = str(v?.reasoning) || str(v?.evidence);
    const quoteFound = quote.length >= 8 && addedText.includes(squash(quote));
    const claimed = v?.met === true;
    const met = claimed && quoteFound;
    results.push({
      id: c.id,
      met,
      verified: quoteFound,
      quote: quoteFound ? quote : "",
      reasoning:
        claimed && !quoteFound
          ? `${reasoning || "The evaluator judged this met"}, but its quote was not found in the added lines, so it does not count.`
          : reasoning || (met ? "Met." : "Not shown in the diff."),
    });
    return {
      id: c.id,
      description: c.description,
      met,
      verified: quoteFound,
      evidence: reasoning,
    };
  });

  const unmet = verdicts.filter((v) => !v.met);
  slog("verdicts", {
    met: verdicts.length - unmet.length,
    unmet: unmet.length,
  });

  const completed = unmet.length === 0 && ci === "success";
  const summary = completed
    ? "All acceptance criteria are met, each backed by a line in your diff, and CI is green."
    : `Not yet met: ${unmet.map((v) => v.id).join(", ")}.`;

  const capabilityId = mission.capabilityId;
  const record: EvaluationRecord = {
    missionId: mission.id,
    developerId: mission.developerId,
    headCommit: cmp.headSha,
    verdict: completed ? "completed" : "needs_work",
    ciState: ci,
    results,
    scopeWarnings,
    changedFiles: changedFiles.map((f) => f.path),
    summary,
    demonstration:
      completed && capabilityId
        ? {
            capabilityId,
            technique: spec.expectedSkills[0]?.evidence || spec.title,
            summary: spec.objective,
            depth: "working",
            path: spec.scope.startPath,
            permalink: `https://github.com/${fork}/commit/${cmp.headSha}`,
            commitSubject: cmp.headSubject,
          }
        : null,
  };

  let demonstrationId: string | null = null;
  try {
    const rec = await recordEvaluation(deps.graph, mission, record);
    demonstrationId = rec.demonstrationId;
    if (!rec.stored)
      notes.push("the evaluation could not be saved to the graph");
  } catch (error) {
    slog("recordEvaluation FAILED", error);
    notes.push("the evaluation could not be saved to the graph");
  }

  return done({
    status: completed ? "completed" : "needs_work",
    reason: summary,
    head,
    ci,
    criteria: verdicts,
    evaluation: record,
    demonstrationId,
    changedFiles,
  });
}
