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
import { TEST_FILE, ask, clip, norm, txt } from "./utils.js";

export function parseVitestResults(raw: string | null): {
  cases: TestCase[];
  parsed: boolean;
  suiteError: string;
} {
  if (!raw) return { cases: [], parsed: false, suiteError: "" };
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
        const id = /\b(AC\d+)\b/i.exec(name)?.[1]?.toUpperCase() ?? null;
        const status =
          a.status === "passed"
            ? "passed"
            : a.status === "failed"
              ? "failed"
              : "skipped";
        cases.push({
          id,
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
/* judge (LLM: evidence + explanation only)                            */
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
  mechanismPresent: boolean;
  quote: string;
  reasoning: string;
  fix: string;
}

export interface Judged {
  summary: string;
  criteria: JudgedCriterion[];
  issues: EvalIssue[];
  nextSteps: string[];
}

const JUDGE_SYSTEM = `You are the evaluator of a developer mission. Tests were already executed and their results are given. You do NOT decide pass/fail; code does. Your job is to find evidence and explain.

You describe the CURRENT STATE of the developer's code against the acceptance criteria. DATA.commit says what the push changed. Never imply that the push broke something unless a test result says so; you have no earlier results to compare with. If DATA.commit.relevant is false, say there is no relevant implementation change yet.

IMPORTANT: The platform generates and runs its own private mission tests. The developer is NOT required to add test files or a package.json test script. Never report missing developer tests, recommend adding tests, or treat the absence of a test script as a problem. Only discuss actual mission-test failures or implementation problems.

For each acceptance criterion:
- mechanismPresent: does the developer's diff/code really implement the mechanism the criterion and contract require (the named library or service actually used, not a stub, local Map or hard-coded value)?
- quote: ONE verbatim fragment (12-200 chars) copied from the DIFF or CODE you were given that shows it. Empty string if there is none. Never invent a quote.
- reasoning: 1-3 sentences, concrete, referencing failing test names and error messages when tests failed.
- fix: when the criterion is not satisfied, ONE concrete instruction for what to change (file + behaviour). Empty when it is fine.

Also return: summary (2-4 sentences, plain language to the developer, about the current state), issues (up to 6, each {title, detail, file?}, most important first, only real problems: failing tests, missing pieces, sandbox problems that are the developer's fault), nextSteps (up to 5 imperative steps, empty when everything passed).
If the sandbox failed to install or boot, explain the most likely cause from the log tail and say whether it looks like the developer's project or the environment. A criterion with status "blocked" could not be checked: do not call it a failure of the developer's code.

Reply with JSON only:
{"summary":"","criteria":[{"id":"AC1","mechanismPresent":true,"quote":"","reasoning":"","fix":""}],"issues":[{"title":"","detail":"","file":""}],"nextSteps":[""]}`;

function renderJudgeUser(input: JudgeInput): string {
  const { spec, testPlan, changed, code, tests, staticTests, facts } = input;
  let budget = 22_000;
  const diff = changed
    .map((c) => {
      const body = clip(c.patch || "(no textual patch)", 3500);
      budget -= body.length;
      return budget > 0 ? `DIFF ${c.status} ${c.path}\n${body}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
  const data = {
    objective: spec.objective,
    criteria: spec.criteria,
    strategies: testPlan.criteria.map((c) => ({
      id: c.id,
      strategy: c.strategy,
      available: c.available,
      unavailableReason: c.unavailableReason,
    })),
    commit: testPlan.commit,
    contract: spec.contract ?? null,
    outOfScope: spec.scope.outOfScope,
    missionTests: [...staticTests, ...tests].map((t) => ({
      ac: t.id,
      test: t.name,
      status: t.status,
      error: t.message,
    })),
    missionTestRan: facts.missionTestRan,
    suiteError: facts.suiteError,
    sandboxFailedAt: facts.failedAt ?? null,
    sandboxLooksLikeEnvironment: facts.infra,
    timedOut: facts.timedOut,
    developerTests: {
      ran: facts.devTests.ran,
      exit: facts.devTests.exit,
      outputTail: clip(
        facts.devTests.out.split("\n").slice(-25).join("\n"),
        1800,
      ),
    },
    logTail: facts.failedAt ? clip(facts.logTail, 2500) : "",
    filesWithCode: [...code.keys()].slice(0, 12),
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
      2600,
      true,
      timeoutMs,
    );
    const root = (extractJson(raw) ?? {}) as Row;
    const criteria = (Array.isArray(root.criteria) ? root.criteria : []).map(
      (c: Row) => ({
        id: txt(c.id).toUpperCase(),
        mechanismPresent: c.mechanismPresent === true,
        quote: txt(c.quote),
        reasoning: clip(txt(c.reasoning), 500),
        fix: clip(txt(c.fix), 300),
      }),
    );
    const issues = (Array.isArray(root.issues) ? root.issues : [])
      .slice(0, 6)
      .map((i: Row) => ({
        title: clip(txt(i.title), 120),
        detail: clip(txt(i.detail), 400),
        ...(txt(i.file) ? { file: txt(i.file) } : {}),
      }))
      .filter((i: EvalIssue) => i.title);
    const nextSteps = (Array.isArray(root.nextSteps) ? root.nextSteps : [])
      .slice(0, 5)
      .map((s: unknown) => clip(txt(s), 200))
      .filter(Boolean);
    return {
      summary: clip(txt(root.summary), 700),
      criteria,
      issues,
      nextSteps,
    };
  } catch {
    return null;
  }
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
/* verdict (code decides)                                              */
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
  judged: Judged | null;
  headSha: string;
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
 * Errors that mean the developer's own file is broken when the generated test loads it.
 * "Cannot find module" is deliberately not here: it can equally be a wrong import in the
 * generated test, so it is reported as blocked.
 */
const DEV_LOAD_ERROR =
  /(does not provide an export|SyntaxError|ReferenceError|Unexpected token|Transform failed)/i;
const ENGINE_ERROR =
  /(vitest\.config|__mission__\/vitest|Cannot find package 'vitest')/i;

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
  const judgeAvailable = input.judged !== null;
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
    // with a contract library the import check above already proves the mechanism;
    // a review criterion without one needs the judge's verified quote
    if (cp.needsMechanism && !cp.library && !mechanismOk) {
      if (!judgeAvailable) {
        lines.push(
          "The evaluator could not review the code this time. Run the evaluation again.",
        );
        return done("blocked", "judge_unavailable");
      }
      lines.push("The code does not show what this criterion requires.");
      return done("failed", "mechanism_missing");
    }
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
      const devFault =
        DEV_LOAD_ERROR.test(facts.suiteError) &&
        !ENGINE_ERROR.test(facts.suiteError);
      lines.push(
        devFault
          ? `The mission tests could not load your code: ${clip(facts.suiteError.split("\n")[0], 200)}`
          : `The mission test file could not run: ${clip(facts.suiteError.split("\n")[0], 200)}. This may be a mismatch between the generated test and your exports, or the environment.`,
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
  if (cp.needsMechanism && !mechanismOk) {
    if (!judgeAvailable) {
      lines.push(
        "The tests passed, but the evaluator could not verify the mechanism in your code this time. Run the evaluation again.",
      );
      return done("blocked", "judge_unavailable");
    }
    lines.push(
      `The code does not show the required mechanism${cp.library ? ` (${cp.library})` : ""}.`,
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

  const evidenceText = norm(
    [...changed.map((c) => c.patch), ...[...code.values()]].join("\n"),
  );

  /* ---- per criterion ---- */
  const results: CriterionOutcome[] = testPlan.criteria.map((cp) => {
    const j = judged?.criteria.find((x) => x.id === cp.id);
    const quote = j?.quote ?? "";
    const quoteFound = quote.length >= 8 && evidenceText.includes(norm(quote));
    const mechanismOk = Boolean(j?.mechanismPresent) && quoteFound;

    const { status, cause, lines } = classify(cp, input, mechanismOk);
    if (j?.reasoning && commit.relevant) lines.push(j.reasoning);
    if (status !== "passed" && j?.fix && commit.relevant)
      lines.push(`Fix: ${j.fix}`);

    const met = status === "passed";
    return {
      id: cp.id,
      met,
      verified: met && (cp.needsMechanism ? quoteFound : true),
      quote: quoteFound ? quote : "",
      reasoning: clip(lines.join("\n"), 900),
      status,
      strategy: cp.strategy,
      cause,
    };
  });

  /* ---- gates ---- */
  const developerTestWritten = changed.some(
    (c) =>
      c.status !== "removed" &&
      (c.path === spec.verify.testFile || TEST_FILE.test(c.path)),
  );
  // npm's placeholder script is not a test run: it is never counted, pass or fail
  const devRan =
    facts.devTests.ran &&
    (projectTest.status === "configured" || projectTest.source === "direct");
  const developerTestsPassed = devRan ? facts.devTests.exit === 0 : null;

  /* ---- issues ---- */
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
  const evaluatorOwnedTestIssue =
    /no test file was added|add (?:your )?tests|no working test script|no ["']?test["']? script/i;
  for (const i of judged?.issues ?? [])
    if (
      !evaluatorOwnedTestIssue.test(i.title) &&
      !evaluatorOwnedTestIssue.test(i.detail) &&
      !issues.some((x) => x.title === i.title)
    )
      issues.push(i);
  // A missing package.json test script is informational only. The platform
  // generates and runs its own mission test file, so do not ask the developer
  // to add a test script or report it as a mission failure.

  /* ---- verdict ---- */
  const count = (s: CriterionStatus) =>
    results.filter((r) => r.status === s).length;
  const passedN = count("passed");
  const failedN = count("failed");
  const blockedN = count("blocked");

  const allPassed = results.length > 0 && passedN === results.length;
  // The platform owns mission tests. Developer-authored test files and a
  // package.json test script are not requirements and must never gate completion.
  const completed = allPassed;

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
      ? judged?.summary ||
          `All ${results.length} acceptance criteria passed and the mechanism is visible in your code.`
      : [
          commit.summary,
          repositoryState,
          overall === "blocked"
            ? "Some checks could not run because of the evaluation environment, not your code."
            : "",
          commit.relevant ? judged?.summary : "",
        ]
          .filter(Boolean)
          .join(" "),
    1100,
  );

  const derived: string[] = [];
  if (!commit.relevant)
    derived.push(
      `Implement the mission in ${spec.scope.startPath}, commit and push to your branch.`,
    );
  for (const r of results.filter((x) => x.status === "failed"))
    derived.push(
      `Make ${r.id} pass: ${clip(r.reasoning.split("\n").pop() ?? "", 160)}`,
    );
  if (overall === "blocked")
    derived.push(
      "Run the evaluation again; the failure came from the environment.",
    );
  const nextSteps = completed
    ? []
    : (judged?.nextSteps.length && commit.relevant
        ? judged.nextSteps.filter((step) => !evaluatorOwnedTestIssue.test(step))
        : derived
      ).slice(0, 5);

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
    nextSteps,
    summary,
    repositoryState,
  };
}
