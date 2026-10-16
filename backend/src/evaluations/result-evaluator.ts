import { extractJson, type LlmClient } from "../agents/goal-agent.js";
import type { MissionSpec, Row } from "../graph/mission-graph.js";
import type {
  ChangedFile,
  CommitReport,
  CriterionOutcome,
  CriterionPlan,
  CriterionStatus,
  EvalIssue,
  EvaluationOutcome,
  MissionTestPlan,
  OutcomeCause,
  ProjectTestInfo,
  RepoProfile,
  SandboxFacts,
  TestCase,
} from "./types.js";
import { TEST_FILE, ask, clip, escapeRe, txt } from "./utils.js";

/**
 * Reads the vitest JSON report. `ids` are the criterion ids the test file was
 * asked to use as describe titles; a test belongs to the id its title starts with.
 */
export function parseVitestResults(
  raw: string | null,
  ids: string[] = [],
): {
  cases: TestCase[];
  parsed: boolean;
  suiteError: string;
} {
  if (!raw) return { cases: [], parsed: false, suiteError: "" };

  const idOf = (name: string): string | null => {
    for (const id of ids)
      if (new RegExp(`^\\s*${escapeRe(id)}(?![\\w])`, "i").test(name))
        return id;
    for (const id of ids)
      if (new RegExp(`(^|[^\\w])${escapeRe(id)}(?![\\w])`, "i").test(name))
        return id;
    return /\b(AC\d+)\b/i.exec(name)?.[1]?.toUpperCase() ?? null;
  };

  try {
    const j = JSON.parse(raw);
    const cases: TestCase[] = [];
    let suiteError = "";
    for (const file of j.testResults ?? []) {
      const assertions = file.assertionResults ?? [];
      if (!assertions.length && file.status === "failed")
        suiteError = clip(String(file.message ?? ""), 1500);
      for (const a of assertions) {
        const name = String(a.fullName ?? a.title ?? "");
        const status =
          a.status === "passed"
            ? "passed"
            : a.status === "failed"
              ? "failed"
              : "skipped";
        cases.push({
          id: idOf(name),
          name: clip(name, 200),
          status,
          message: clip(String((a.failureMessages ?? []).join("\n")), 700),
        });
      }
    }
    return { cases, parsed: true, suiteError };
  } catch {
    return { cases: [], parsed: false, suiteError: "" };
  }
}

/* ------------------------------------------------------------------ */
/* judge: only suggests a fix for criteria that FAILED                 */
/* ------------------------------------------------------------------ */

export interface JudgeInput {
  spec: MissionSpec;
  testPlan: MissionTestPlan;
  changed: ChangedFile[];
  code: Map<string, string>;
  tests: TestCase[];
  staticTests: TestCase[];
  facts: SandboxFacts;
  timeoutMs?: number;
}

export interface JudgedCriterion {
  id: string;
  fix: string;
}

export interface Judged {
  criteria: JudgedCriterion[];
}

const JUDGE_SYSTEM = `You help a developer fix a mission. The platform already ran its own tests and decided pass or fail. You do NOT decide anything and you do NOT restate results.

For every acceptance criterion whose tests FAILED, give ONE concrete instruction for what to change in the developer's code (file and behaviour), based on the failing test name and its error message and on the code you are given. Stay strictly inside the acceptance criteria: never ask for anything the criteria do not state. Never mention writing tests or a test script; the platform owns the tests. Skip criteria that passed.

Reply with JSON only: {"criteria":[{"id":"AC1","fix":""}]}`;

function renderJudgeUser(input: JudgeInput): string {
  const { spec, changed, tests, staticTests, facts } = input;
  let budget = 18_000;
  const diff = changed
    .map((c) => {
      const body = clip(c.patch || "(no textual patch)", 3000);
      budget -= body.length;
      return budget > 0 ? `DIFF ${c.status} ${c.path}\n${body}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
  const data = {
    objective: spec.objective,
    criteria: spec.criteria,
    contract: spec.contract ?? null,
    failingTests: [...staticTests, ...tests]
      .filter((t) => t.status === "failed")
      .map((t) => ({ ac: t.id, test: t.name, error: clip(t.message, 500) })),
    suiteError: facts.suiteError,
  };
  return `DATA:\n${JSON.stringify(data)}\n\n${diff}`;
}

export async function judgeMission(
  llm: LlmClient,
  input: JudgeInput,
): Promise<Judged | null> {
  const timeoutMs =
    input.timeoutMs ?? Number(process.env.LLM_TIMEOUT_MS ?? 60_000);
  try {
    const raw = await ask(
      llm,
      JUDGE_SYSTEM,
      renderJudgeUser(input),
      1200,
      true,
      timeoutMs,
    );
    const root = (extractJson(raw) ?? {}) as Row;
    const criteria = (Array.isArray(root.criteria) ? root.criteria : [])
      .map((c: Row) => ({
        id: txt(c.id).toUpperCase(),
        fix: clip(txt(c.fix), 300),
      }))
      .filter((c: JudgedCriterion) => c.id && c.fix);
    return { criteria };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* audit: is a failing test fair to the developer?                     */
/* ------------------------------------------------------------------ */

export interface AuditInput {
  spec: MissionSpec;
  testPlan: MissionTestPlan;
  /** the mission test file that was run */
  testCode: string;
  code: Map<string, string>;
  changed: ChangedFile[];
  /** the failed cases, in the order they are numbered for the auditor */
  failures: TestCase[];
  timeoutMs?: number;
}

export interface AuditedFailure {
  /** index into AuditInput.failures */
  n: number;
  verdict: "code_wrong" | "test_wrong";
  reason: string;
  fix: string;
}

const AUDIT_SYSTEM = `A platform ran machine-written tests against a developer's pushed code and some tests FAILED. Machine-written tests are sometimes wrong, and a wrong test must never be blamed on the developer. For every failing test decide who is at fault by tracing the test line by line through the pushed code. Never decide from the error message alone.

Answer "test_wrong" when ANY of these holds:
- the test sets up a state the code cannot reach (for example entries that expire at birth because a TTL is 0, a capacity that makes the scenario impossible, a missing fake-timer advance, a precondition the earlier lines never create);
- the test waits for something its own later lines would settle (a timeout or deadlock), or reads a property that does not exist on the object it was attached to;
- it asserts something the criterion does not state (an invented string, an extra behaviour), or a spy count that is wrong when you recount it call by call;
- its decisive assertion contradicts the plain meaning of the criterion.

Answer "code_wrong" ONLY when the scenario is a fair, reachable test of the criterion AND you can name the specific behaviour in the pushed code that contradicts the criterion. Quote the offending line or function in "reason". If the code is missing the behaviour altogether, that is code_wrong.

A "Test timed out" error is either a deadlocked test or code that never settles: trace which one.

Reply with JSON only: {"failures":[{"n":0,"verdict":"test_wrong","reason":"one or two sentences","fix":"for test_wrong: how the test must change; empty for code_wrong"}]}`;

function renderAuditUser(input: AuditInput): string {
  const { spec, testPlan, testCode, code, failures } = input;
  const ids = new Set(testPlan.sandboxCriteria);
  const files = [...code.entries()]
    .filter(([p]) => !TEST_FILE.test(p))
    .slice(0, 8)
    .map(([p, c]) => `FILE ${p}\n\`\`\`\n${clip(c, 12000)}\n\`\`\``)
    .join("\n\n");
  const data = {
    objective: spec.objective,
    criteria: spec.criteria
      .filter((c) => ids.has(c.id))
      .map((c) => ({ id: c.id, description: c.description, how: c.how })),
    contract: spec.contract ?? null,
    failures: failures.map((t, n) => ({
      n,
      ac: t.id,
      test: t.name,
      error: clip(t.message, 600),
    })),
  };
  return `DATA:\n${JSON.stringify(data)}\n\nPUSHED CODE\n${files || "(no source files found)"}\n\nTEST FILE\n\`\`\`ts\n${clip(testCode, 16000)}\n\`\`\``;
}

/**
 * Returns one verdict per failing test, or null when the auditor is
 * unavailable (the results are then left exactly as they are). A test the
 * auditor does not mention, or calls test_wrong without a reason, stays the
 * developer's: only a stated reason can excuse a failure.
 */
export async function auditFailures(
  llm: LlmClient,
  input: AuditInput,
): Promise<AuditedFailure[] | null> {
  if (!input.failures.length) return [];
  const timeoutMs =
    input.timeoutMs ?? Number(process.env.LLM_TIMEOUT_MS ?? 60_000);
  try {
    const raw = await ask(
      llm,
      AUDIT_SYSTEM,
      renderAuditUser(input),
      1800,
      true,
      timeoutMs,
    );
    const root = (extractJson(raw) ?? {}) as Row;
    const list = Array.isArray(root.failures) ? (root.failures as Row[]) : [];
    return input.failures.map((_, n) => {
      const hit = list.find((f) => Number(f?.n) === n);
      const reason = clip(txt(hit?.reason), 400);
      const fix = clip(txt(hit?.fix), 400);
      const excused = txt(hit?.verdict) === "test_wrong" && reason !== "";
      return {
        n,
        verdict: excused ? "test_wrong" : "code_wrong",
        reason,
        fix,
      } as AuditedFailure;
    });
  } catch {
    return null;
  }
}

/**
 * Criteria whose every failing test was judged unfair. One genuinely failing
 * test keeps the criterion failed. Returns id -> why.
 */
export function disputedFrom(
  failures: TestCase[],
  audit: AuditedFailure[],
): Record<string, string> {
  const byId = new Map<string, AuditedFailure[]>();
  failures.forEach((t, n) => {
    if (!t.id) return;
    const v = audit.find((a) => a.n === n) ?? {
      n,
      verdict: "code_wrong" as const,
      reason: "",
      fix: "",
    };
    byId.set(t.id, [...(byId.get(t.id) ?? []), v]);
  });
  const out: Record<string, string> = {};
  for (const [id, vs] of byId)
    if (vs.every((v) => v.verdict === "test_wrong"))
      out[id] = clip(vs.map((v) => v.reason).join(" "), 500);
  return out;
}

/** What the test writer is told when its file was judged unfair. */
export function auditFeedback(
  failures: TestCase[],
  audit: AuditedFailure[],
): string {
  return audit
    .filter((a) => a.verdict === "test_wrong")
    .map((a) => {
      const t = failures[a.n];
      return `- ${t?.id ?? "?"} "${clip(t?.name ?? "", 90)}" failed with "${clip((t?.message ?? "").split("\n")[0], 160)}". Problem: ${a.reason}${a.fix ? ` Fix: ${a.fix}` : ""}`;
    })
    .join("\n")
    .slice(0, 1600);
}

/* ------------------------------------------------------------------ */
/* scope warnings                                                      */
/* ------------------------------------------------------------------ */

export function scopeWarnings(
  changed: ChangedFile[],
  spec: MissionSpec,
): string[] {
  const allowed = new Set([
    ...spec.scope.modifyPaths,
    ...spec.scope.createPaths,
  ]);
  const ignorable =
    /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|package\.json|tsconfig[^/]*\.json|vitest\.config\.[cm]?[tj]s)$/;
  const out: string[] = [];
  for (const c of changed)
    if (
      !allowed.has(c.path) &&
      !ignorable.test(c.path) &&
      !TEST_FILE.test(c.path)
    )
      out.push(`Changed ${c.path}, which is outside the mission scope.`);
  if (!changed.some((c) => c.path === spec.scope.startPath))
    out.push(`The starting file ${spec.scope.startPath} was not changed.`);
  return out.slice(0, 8);
}

/* ------------------------------------------------------------------ */
/* verdict (code decides, from the test results only)                  */
/* ------------------------------------------------------------------ */

export interface VerdictInput {
  spec: MissionSpec;
  testPlan: MissionTestPlan;
  profile: RepoProfile;
  changed: ChangedFile[];
  code: Map<string, string>;
  /** results of the generated vitest file */
  tests: TestCase[];
  /** results of the in-process static checks */
  staticTests: TestCase[];
  facts: SandboxFacts;
  /** optional fix suggestions; never changes a verdict */
  judged: Judged | null;
  headSha: string;
  /** criteria whose failing tests were judged unfair (id -> why): reported as blocked, never as failed */
  disputed?: Record<string, string>;
}

/** An empty facts object for runs that never started a sandbox. */
export const noSandboxFacts = (): SandboxFacts => ({
  sandboxRan: false,
  infra: false,
  timedOut: false,
  missionTestRan: false,
  missionExit: null,
  suiteError: "",
  devTests: { ran: false, exit: null, out: "" },
  logTail: "",
});

/**
 * Errors that mean the developer's own code is why the test file could not load:
 * a missing export, a syntax error, or a relative import of a file the mission
 * asked the developer to create (imports of files that exist are checked before
 * the run). Anything else means the generated test file is at fault.
 */
const DEV_LOAD_ERROR =
  /(does not provide an export|SyntaxError|ReferenceError|Unexpected token|Transform failed|Failed to resolve import ["']\.{1,2}\/|Cannot find module ["']\.{1,2}\/)/i;
const ENGINE_ERROR =
  /(vitest\.config|__mission__\/vitest|Cannot find package 'vitest')/i;

export const isDevLoadFault = (message: string): boolean =>
  DEV_LOAD_ERROR.test(message) && !ENGINE_ERROR.test(message);

/** First line of the code that imports the contract library, or "" when none does. */
function libraryImportLine(lib: string, code: Map<string, string>): string {
  const re = new RegExp(
    `(from\\s+|require\\(\\s*|import\\(\\s*)["']${escapeRe(lib)}(/[^"']*)?["']`,
  );
  for (const [path, body] of code) {
    if (TEST_FILE.test(path)) continue;
    const line = body.split("\n").find((l) => re.test(l));
    if (line) return clip(line.trim(), 200);
  }
  return "";
}

interface Classified {
  status: CriterionStatus;
  cause: OutcomeCause;
  lines: string[];
}

function classify(
  cp: CriterionPlan,
  input: VerdictInput,
  mechanismOk: boolean,
): Classified {
  const { testPlan, staticTests, tests, facts } = input;
  const lines: string[] = [];
  const done = (status: CriterionStatus, cause: OutcomeCause): Classified => ({
    status,
    cause,
    lines,
  });

  if (!testPlan.commit.relevant) {
    lines.push(`${testPlan.commit.summary} Nothing was evaluated.`);
    return done("blocked", "no_relevant_change");
  }

  if (!cp.available) {
    lines.push(cp.unavailableReason);
    return done("blocked", "strategy_unavailable");
  }

  /* ---- static ---- */
  if (cp.strategy === "static") {
    const mine = staticTests.filter((t) => t.id === cp.id);
    for (const t of mine)
      lines.push(
        t.status === "passed"
          ? `PASS ${t.name}`
          : `FAIL ${t.name}${t.message ? `: ${clip(t.message, 200)}` : ""}`,
      );
    if (!mine.length) {
      lines.push("No static check ran for this criterion.");
      return done("blocked", "no_tests");
    }
    if (mine.some((t) => t.status !== "passed"))
      return done("failed", "static_failed");
    return done("passed", "ok");
  }

  /* ---- sandbox ---- */
  if (!facts.sandboxRan) {
    lines.push("The sandbox did not run.");
    return done("blocked", "sandbox_infra");
  }
  if (facts.failedAt) {
    lines.push(
      facts.infra
        ? `The sandbox stopped at "${facts.failedAt}" because of the evaluation environment, not your code.`
        : `The sandbox stopped at "${facts.failedAt}". This looks like a problem in your project, see the log.`,
    );
    return done(
      facts.infra ? "blocked" : "failed",
      facts.infra ? "sandbox_infra" : "project_setup",
    );
  }
  if (!facts.missionTestRan) {
    if (facts.suiteError) {
      const devFault = isDevLoadFault(facts.suiteError);
      const first = clip(facts.suiteError.split("\n")[0], 200);
      lines.push(
        devFault
          ? `The mission tests could not load your code: ${first}`
          : `The mission test file could not run: ${first}. This is a problem on the evaluator's side, not in your code. Run the evaluation again.`,
      );
      return done(
        devFault ? "failed" : "blocked",
        devFault ? "project_load" : "suite_error",
      );
    }
    lines.push(
      facts.missionExit !== null && facts.missionExit !== 0
        ? `The mission test process exited with code ${facts.missionExit} and produced no results.`
        : "Mission tests did not run.",
    );
    return done("blocked", "suite_error");
  }

  const mine = tests.filter((t) => t.id === cp.id);
  if (!mine.length) {
    lines.push(
      "The mission tests ran but none of them covered this criterion.",
    );
    return done("blocked", "no_tests");
  }
  const unfair = input.disputed?.[cp.id];
  if (unfair && mine.some((t) => t.status === "failed")) {
    lines.push(
      `The evaluator's own test for this criterion was reviewed and judged faulty: ${clip(unfair, 300)} This is not caused by your code. Run the evaluation again; the test will be rewritten.`,
    );
    return done("blocked", "test_invalid");
  }
  for (const t of mine)
    lines.push(
      t.status === "passed"
        ? `PASS ${t.name}`
        : t.status === "skipped"
          ? `SKIP ${t.name}`
          : `FAIL ${t.name}${t.message ? `: ${clip(t.message.split("\n")[0], 220)}` : ""}`,
    );
  if (mine.some((t) => t.status === "failed"))
    return done("failed", "tests_failed");
  if (!mine.some((t) => t.status === "passed"))
    return done("blocked", "no_tests");
  if (!mechanismOk) {
    lines.push(
      `The tests passed, but no source file imports the required library${cp.library ? ` (${cp.library})` : ""}.`,
    );
    return done("failed", "mechanism_missing");
  }
  return done("passed", "ok");
}

export function finalizeVerdict(input: VerdictInput): EvaluationOutcome {
  const {
    spec,
    testPlan,
    profile,
    changed,
    code,
    tests,
    staticTests,
    facts,
    judged,
    headSha,
  } = input;
  const commit: CommitReport = testPlan.commit;
  const projectTest: ProjectTestInfo = profile.projectTest;

  /* ---- per criterion ---- */
  const results: CriterionOutcome[] = testPlan.criteria.map((cp) => {
    const lib = cp.needsMechanism ? cp.library : null;
    const importLine = lib ? libraryImportLine(lib, code) : "";
    const mechanismOk = !lib || importLine !== "";

    const { status, cause, lines } = classify(cp, input, mechanismOk);
    const fix = judged?.criteria.find((x) => x.id === cp.id)?.fix ?? "";
    if (status === "failed" && fix && commit.relevant)
      lines.push(`Fix: ${fix}`);

    const met = status === "passed";
    return {
      id: cp.id,
      met,
      verified: met,
      quote: importLine,
      reasoning: clip(lines.join("\n"), 900),
      status,
      strategy: cp.strategy,
      cause,
    };
  });

  /* ---- gates (informational only, they never decide) ---- */
  const developerTestWritten = changed.some(
    (c) =>
      c.status !== "removed" &&
      (c.path === spec.verify.testFile || TEST_FILE.test(c.path)),
  );
  const devRan =
    facts.devTests.ran &&
    (projectTest.status === "configured" || projectTest.source === "direct");
  const developerTestsPassed = devRan ? facts.devTests.exit === 0 : null;

  /* ---- issues: built from the results, never from LLM opinion ---- */
  const issues: EvalIssue[] = [];
  if (!commit.relevant)
    issues.push({
      title: "No relevant implementation change",
      detail: commit.summary,
      file: spec.scope.startPath,
    });
  if (facts.failedAt)
    issues.push({
      title: `Sandbox stopped at: ${facts.failedAt}`,
      detail: facts.timedOut
        ? "The step timed out."
        : facts.infra
          ? "The failure looks like the evaluation environment, not your code. Run the evaluation again."
          : "See the sandbox log for the exact error.",
    });
  if (facts.suiteError)
    issues.push({
      title: "The mission test file could not run",
      detail: clip(facts.suiteError, 400),
    });
  for (const r of results.filter((x) => x.status === "failed"))
    issues.push({
      title: `${r.id} is not satisfied`,
      detail: clip(r.reasoning.split("\n").slice(0, 3).join(" "), 400),
    });
  for (const r of results.filter(
    (x) => x.status === "blocked" && x.cause !== "no_relevant_change",
  ))
    issues.push({
      title: `${r.id} could not be checked`,
      detail: clip(r.reasoning.split("\n").slice(0, 2).join(" "), 400),
    });

  /* ---- verdict ---- */
  const count = (s: CriterionStatus) =>
    results.filter((r) => r.status === s).length;
  const passedN = count("passed");
  const failedN = count("failed");
  const blockedN = count("blocked");

  const completed = results.length > 0 && passedN === results.length;

  const overall: EvaluationOutcome["overall"] = completed
    ? "passed"
    : failedN > 0 || !commit.relevant
      ? "failed"
      : blockedN > 0
        ? "blocked"
        : "failed";

  /* ---- reports ---- */
  const sha = headSha ? headSha.slice(0, 7) : "this commit";
  const unmet = results.filter((r) => r.status !== "passed");
  const repositoryState = !commit.relevant
    ? `At ${sha} the mission is not started: no implementation change exists yet, so no criterion was evaluated.`
    : `At ${sha} the repository satisfies ${passedN} of ${results.length} acceptance criteria.` +
      (unmet.length
        ? ` Not met: ${unmet.map((r) => `${r.id} (${r.status})`).join(", ")}.`
        : "");

  const summary = clip(
    completed
      ? `All ${results.length} acceptance criteria passed.`
      : [
          commit.summary,
          repositoryState,
          results.some(
            (r) => r.status === "blocked" && r.cause !== "no_relevant_change",
          )
            ? "Some checks could not be completed because of the evaluation itself, not your code."
            : "",
        ]
          .filter(Boolean)
          .join(" "),
    1100,
  );

  const nextSteps: string[] = [];
  if (!completed) {
    if (!commit.relevant)
      nextSteps.push(
        `Implement the mission in ${spec.scope.startPath}, commit and push to your branch.`,
      );
    for (const r of results.filter((x) => x.status === "failed")) {
      const fix = judged?.criteria.find((x) => x.id === r.id)?.fix;
      const firstFail =
        r.reasoning.split("\n").find((l) => !l.startsWith("PASS")) ?? "";
      nextSteps.push(
        fix ? `${r.id}: ${fix}` : `Make ${r.id} pass: ${clip(firstFail, 160)}`,
      );
    }
    if (results.some((r) => r.cause === "test_invalid"))
      nextSteps.push(
        "Run the evaluation again: the evaluator's own test was faulty and will be rewritten. Your code was not blamed.",
      );
    else if (overall === "blocked")
      nextSteps.push(
        "Run the evaluation again; the failure came from the environment.",
      );
  }

  return {
    verdict: completed ? "completed" : "needs_work",
    overall,
    results,
    tests: [...staticTests, ...tests],
    gates: {
      missionTestRan: facts.missionTestRan || staticTests.length > 0,
      developerTestWritten,
      developerTestsPassed,
    },
    commit,
    projectTest,
    issues: issues.slice(0, 8),
    nextSteps: nextSteps.slice(0, 5),
    summary,
    repositoryState,
  };
}
