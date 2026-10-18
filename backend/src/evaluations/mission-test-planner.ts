import type { MissionCriterion, MissionSpec } from "../graph/mission-graph.js";
import type {
  ChangedFile,
  CommitReport,
  CriterionPlan,
  EvalMode,
  ExecutionPlan,
  MissionTestPlan,
  RepoProfile,
  ServiceSetup,
  StrategyId,
} from "./types.js";
import { STRATEGIES, strategyAvailability } from "./test-strategy-registry.js";
import { SRC_FILE, TEST_FILE, libraryToken } from "./utils.js";

const DOC_FILE =
  /(^|\/)(docs?\/|LICENSE|CHANGELOG|CONTRIBUTING|CODE_OF_CONDUCT)|\.(md|mdx|txt|rst|adoc)$/i;
const CONFIG_FILE =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|package\.json|tsconfig[^/]*\.json|vitest\.config\.[cm]?[tj]s|jest\.config\.[cm]?[tj]s|\.eslintrc[^/]*|eslint\.config\.[cm]?[tj]s|\.prettierrc[^/]*|\.gitignore|\.npmrc|\.nvmrc|\.editorconfig|\.env(\.[\w.]+)?|\.github\/.*)$/i;

const names = (xs: string[]): string =>
  xs.slice(0, 4).join(", ") +
  (xs.length > 4 ? ` and ${xs.length - 4} more` : "");

export function assessCommit(
  changed: ChangedFile[],
  spec: MissionSpec,
  libToken: string,
): CommitReport {
  const scope = new Set(
    [
      spec.scope.startPath,
      ...spec.scope.modifyPaths,
      ...spec.scope.createPaths,
      ...(spec.verify.testFile ? [spec.verify.testFile] : []),
    ].map((p) => p.toLowerCase()),
  );

  const direct: string[] = [];
  const related: string[] = [];
  const tests: string[] = [];
  const config: string[] = [];
  const docs: string[] = [];

  for (const c of changed) {
    const p = c.path;
    if (scope.has(p.toLowerCase())) direct.push(p);
    else if (TEST_FILE.test(p) || /(^|\/)__tests__\//.test(p)) tests.push(p);
    else if (CONFIG_FILE.test(p)) {
      // adding the contract library to package.json is real progress
      const addsLib =
        libToken !== "" &&
        /(^|\/)package\.json$/.test(p) &&
        c.patch
          .split("\n")
          .some((l) => l.startsWith("+") && l.toLowerCase().includes(libToken));
      if (addsLib) related.push(p);
      else config.push(p);
    } else if (DOC_FILE.test(p)) docs.push(p);
    else if (SRC_FILE.test(p)) related.push(p);
    else config.push(p);
  }

  const relevance: CommitReport["relevance"] = direct.length
    ? "direct"
    : related.length
      ? "related"
      : tests.length
        ? "tests_only"
        : config.length
          ? "config_only"
          : docs.length
            ? "docs_only"
            : "none";

  const n = changed.length;
  const summary =
    relevance === "direct"
      ? `This push changes ${n} file${n === 1 ? "" : "s"} since the mission's base commit, ${direct.length} of them inside the mission scope (${names(direct)}).`
      : relevance === "related"
        ? `This push changes source files (${names(related)}) but none of the files the mission points to (${spec.scope.startPath}).`
        : relevance === "tests_only"
          ? `This push only adds or changes test files (${names(tests)}). There is no implementation change yet.`
          : relevance === "config_only"
            ? `This push only changes configuration or dependency files (${names(config)}). No implementation code changed.`
            : relevance === "docs_only"
              ? `This push only changes documentation (${names(docs)}). It contains no implementation change for this mission.`
              : "No file changes were found since the mission's base commit.";

  return {
    relevance,
    relevant:
      relevance === "direct" ||
      relevance === "related" ||
      relevance === "tests_only",
    changedCount: n,
    direct,
    related,
    ignored: [...config, ...docs],
    summary,
  };
}

/* ------------------------------------------------------------------ */
/* strategy selection                                                  */
/* ------------------------------------------------------------------ */

const BROWSER =
  /\b(browser|playwright|cypress|e2e|end-to-end|clicks?|clicking|navigates? to|page loads?)\b/i;
const DATABASE =
  /\b(database|sql|migrations?|schema|prisma|postgres(ql)?|mysql|mongo(db)?|persist(s|ed|ence)?)\b/i;
/** verbs are case-sensitive on purpose: "get the value" is not an HTTP GET */
const HTTP_VERB = /\b(GET|POST|PUT|PATCH|DELETE)\s+\/[\w/:.-]*/;
const HTTP_WORDS =
  /\bstatus code\b|\bHTTP\s?\d{3}\b|\bendpoints?\b|\broutes?\b|\brespon(ds?|se) (with|status)\b|\b[245]\d\d\b status|\bstatus [245]\d\d\b/i;
/** files that actually serve HTTP; a util or service file is tested by calling it */
const SERVER_PATH =
  /(^|\/)(routes?|controllers?|handlers?|api|server|app|middleware|endpoints?)(\/|\.|$)/i;
export function classifyCriterion(
  c: MissionCriterion,
  profile: RepoProfile,
  libToken: string,
  scopePaths: string[] = [],
): { strategy: StrategyId; reason: string } {
  const text = `${c.description} ${c.how}`;
  const lower = text.toLowerCase();
  const http =
    HTTP_VERB.test(text) ||
    (HTTP_WORDS.test(text) && scopePaths.some((p) => SERVER_PATH.test(p)));

  if (c.check === "review")
    return {
      strategy: "static",
      reason:
        "Review criterion: verified from the pushed code, not by running it.",
    };
  if (BROWSER.test(text))
    return {
      strategy: "browser",
      reason: "The criterion describes behaviour in a browser.",
    };
  if (http && DATABASE.test(text) && profile.dataStores.length)
    return {
      strategy: "database",
      reason: "The criterion describes persistence behind an HTTP endpoint.",
    };
  if (http)
    return {
      strategy: "http",
      reason: "The criterion describes an HTTP endpoint or status code.",
    };
  if (libToken && lower.includes(libToken))
    return {
      strategy: "integration",
      reason: `The criterion depends on the ${libToken} client, so it is checked with that client mocked.`,
    };
  return {
    strategy: "unit",
    reason: "Plain behaviour of a function or module.",
  };
}

export function planMissionTests(
  spec: MissionSpec,
  profile: RepoProfile,
  changed: ChangedFile[],
): MissionTestPlan {
  const libToken = libraryToken(spec.contract?.library);
  const commit = assessCommit(changed, spec, libToken);
  const scopePaths = [
    spec.scope.startPath,
    ...spec.scope.modifyPaths,
    ...spec.scope.createPaths,
  ];

  const criteria: CriterionPlan[] = spec.criteria.map((c) => {
    const { strategy, reason } = classifyCriterion(
      c,
      profile,
      libToken,
      scopePaths,
    );

    const av = strategyAvailability(strategy, profile);
    const text = `${c.description} ${c.how}`.toLowerCase();
    return {
      id: c.id,
      description: c.description,
      check: c.check,
      strategy,
      reason,
      needsMechanism:
        c.check === "review" || (libToken !== "" && text.includes(libToken)),
      library: spec.contract?.library ?? null,
      available: av.ok,
      unavailableReason: av.ok ? "" : av.reason,
    };
  });

  const sandboxCriteria = criteria
    .filter((c) => c.available && STRATEGIES[c.strategy].where === "sandbox")
    .map((c) => c.id);
  const staticCriteria = criteria
    .filter((c) => c.available && STRATEGIES[c.strategy].where === "inline")
    .map((c) => c.id);
  const blockedCriteria = criteria.filter((c) => !c.available).map((c) => c.id);

  const wantsServer = criteria.some(
    (c) => c.available && (c.strategy === "http" || c.strategy === "database"),
  );
  const mode: EvalMode = wantsServer ? "http" : "module";

  const notes: string[] = [];
  if (
    mode === "http" &&
    criteria.some(
      (c) =>
        c.available && (c.strategy === "unit" || c.strategy === "integration"),
    )
  )
    notes.push(
      "Mixed mission: it runs in HTTP mode, so every sandboxed criterion is checked through the running server.",
    );
  if (blockedCriteria.length)
    notes.push(
      `${blockedCriteria.join(", ")} cannot be checked with the current runner and will be reported as blocked.`,
    );

  return {
    mode,
    commit,
    criteria,
    sandboxCriteria,
    staticCriteria,
    blockedCriteria,
    notes,
  };
}

/* ------------------------------------------------------------------ */
/* execution plan for the Daytona runner                               */
/* ------------------------------------------------------------------ */

export function buildExecutionPlan(
  profile: RepoProfile,
  testPlan: MissionTestPlan,
  opts: { services?: ServiceSetup[]; allowSecretDummies?: boolean } = {},
): ExecutionPlan {
  const mode = testPlan.mode;
  const services = opts.services ?? [];
  const resultsFile =
    mode === "http" ? "results.json" : "__mission__/results.json";
  const reporters = "--reporter=default --reporter=json";
  const testCommand =
    mode === "http"
      ? `npx vitest run ${reporters} --outputFile.json=${resultsFile}`
      : `npx vitest run --root . --config __mission__/vitest.config.mts ${reporters} --outputFile.json=${resultsFile}`;

  return {
    allowSecretDummies: opts.allowSecretDummies ?? false,
    root: profile.root,
    language: profile.language,
    packageManager: profile.packageManager,
    installCommand: profile.installCommand,
    startCommand: profile.startCommand,
    services: services.map((s) => s.name),
    serviceSetup: services,
    track: profile.track,
    mode,
    bootEnv: {},
    testCommand,
    resultsFile,
    projectTestCommand: profile.projectTest.command,
  };
}
