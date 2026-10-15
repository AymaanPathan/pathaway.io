import type { CriterionResult } from "../graph/mission-graph.js";

export class MissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissionError";
  }
}

export type EvalStepId =
  | "fetch"
  | "analyze"
  | "plan"
  | "generate"
  | "sandbox"
  | "install"
  | "extras"
  | "devtests"
  | "server"
  | "test"
  | "judge";

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

/** http: tests call the booted server. module: tests import the code and mock clients. */
export type EvalMode = "http" | "module";

export type StrategyId =
  | "static"
  | "unit"
  | "integration"
  | "http"
  | "database"
  | "browser";

/**
 * passed:  the criterion was checked and is satisfied
 * failed:  the criterion was checked (or the developer's project broke the check) and is not satisfied
 * blocked: the criterion could not be checked (nothing to test yet, environment problem, unsupported strategy)
 */
export type CriterionStatus = "passed" | "failed" | "blocked";

export type OutcomeCause =
  | "ok"
  | "tests_failed"
  | "static_failed"
  | "mechanism_missing"
  | "no_tests"
  | "no_relevant_change"
  | "strategy_unavailable"
  | "project_setup"
  | "project_load"
  | "sandbox_infra"
  | "suite_error"
  | "judge_unavailable";

export type DataStoreKind =
  | "postgres"
  | "mysql"
  | "mongodb"
  | "redis"
  | "sqlite";

export type TestTool =
  | "vitest"
  | "jest"
  | "mocha"
  | "playwright"
  | "cypress"
  | "supertest";

export interface ChangedFile {
  path: string;
  status: string;
  patch: string;
}

/* ------------------------------------------------------------------ */
/* 1. repository analyzer                                              */
/* ------------------------------------------------------------------ */

export interface DataStore {
  kind: DataStoreKind;
  /** the package (or "prisma") that revealed it */
  via: string;
}

export interface ProjectTestInfo {
  /**
   * configured:  package.json has a real test script
   * placeholder: package.json still has npm's default `echo "Error: no test specified" && exit 1`
   * none:        no test script at all
   */
  status: "configured" | "placeholder" | "none";
  script: string;
  /** what the sandbox should run as "your own tests"; null = nothing to run */
  command: string | null;
  /** script: the package.json script. direct: the developer's test file run with the detected runner. none: nothing. */
  source: "script" | "direct" | "none";
}

export interface RepoProfile {
  /** package root inside the repo ("" = repo root) */
  root: string;
  language: "typescript" | "javascript";
  packageManager: "npm" | "pnpm" | "yarn";
  lockfile: string;
  framework: string;
  track: "backend" | "frontend";
  deps: string[];
  scripts: Record<string, string>;
  testTools: TestTool[];
  installCommand: string;
  /** "" when no way to boot was found */
  startCommand: string;
  dataStores: DataStore[];
  usesPrisma: boolean;
  /** third-party SDK packages found in dependencies (openai, stripe, ...) */
  externalServices: string[];
  projectTest: ProjectTestInfo;
  sourceFileCount: number;
  notes: string[];
}

/* ------------------------------------------------------------------ */
/* 2. mission test planner                                             */
/* ------------------------------------------------------------------ */

export type Relevance =
  | "direct"
  | "related"
  | "tests_only"
  | "config_only"
  | "docs_only"
  | "none";

/** What the push changed compared with the mission's base commit, and whether it touches the mission. */
export interface CommitReport {
  relevance: Relevance;
  /** true when there is implementation (or test) work that can be evaluated */
  relevant: boolean;
  changedCount: number;
  /** files inside the mission scope */
  direct: string[];
  /** other source files */
  related: string[];
  /** docs, lockfiles, configs, workflows */
  ignored: string[];
  summary: string;
}

export interface CriterionPlan {
  id: string;
  description: string;
  check: "test" | "command" | "review";
  strategy: StrategyId;
  /** why this strategy was chosen */
  reason: string;
  /** the criterion requires the contract library to be visibly used */
  needsMechanism: boolean;
  library: string | null;
  available: boolean;
  unavailableReason: string;
}

export interface MissionTestPlan {
  mode: EvalMode;
  commit: CommitReport;
  criteria: CriterionPlan[];
  /** criteria checked by generated tests inside the sandbox */
  sandboxCriteria: string[];
  /** criteria checked in-process from the pushed code */
  staticCriteria: string[];
  /** criteria that cannot be checked with the current runner */
  blockedCriteria: string[];
  notes: string[];
}

/* ------------------------------------------------------------------ */
/* 3. environment resolver                                             */
/* ------------------------------------------------------------------ */

export interface EnvKey {
  name: string;
  /** the code or .env.example already gives it a default */
  hasFallback: boolean;
  /** "auto": a fake value is fine. "external": a real third-party credential. "unknown": no idea. */
  kind: "auto" | "external" | "unknown";
  dummy: string;
  /** true only when the app cannot boot without a real value */
  blocking: boolean;
  reason: string;
}

export interface EnvReport {
  keys: EnvKey[];
  blocking: EnvKey[];
  mode: EvalMode;
}

export interface ResolvedEnv {
  env: Record<string, string>;
  /** blocking keys the user did not supply (and did not allow dummies for) */
  missing: EnvKey[];
  /** keys filled with fake or provisioned values */
  filled: string[];
  /** keys the user supplied (names only, never values) */
  provided: string[];
}

/** A database or cache the sandbox starts for the project. */
export interface ServiceSetup {
  name: string;
  kind: DataStoreKind;
  /** shell commands to install and start it, run before the server boots */
  setup: string[];
  /** exits 0 when the service accepts connections */
  ready: string;
  /** shell commands to run after dependencies are installed (e.g. prisma db push) */
  postInstall: string[];
  env: Record<string, string>;
}

export interface MockPlan {
  name: string;
  kind: "module-mock" | "dummy-credential";
  note: string;
}

export interface EnvironmentPlan {
  report: EnvReport;
  services: ServiceSetup[];
  mocks: MockPlan[];
  /** env values that come from provisioned services */
  serviceEnv: Record<string, string>;
  /** stores that were detected but cannot be provisioned */
  unprovisioned: DataStoreKind[];
  notes: string[];
}

export interface ExecutionPlan {
  /** fake values may be used for real third-party credentials */
  allowSecretDummies: boolean;
  /** package root inside the repo ("" = repo root) */
  root: string;
  language: "typescript" | "javascript";
  packageManager: "npm" | "pnpm" | "yarn";
  installCommand: string;
  /** "" when no way to boot was found (only needed in http mode) */
  startCommand: string;
  /** names of the services the sandbox must start */
  services: string[];
  /** how to start those services (setup, readiness, post-install steps) */
  serviceSetup: ServiceSetup[];
  track: "backend" | "frontend";
  mode: EvalMode;
  bootEnv: Record<string, string>;
  /** run in runnerDir (http) or projectDir (module); see sandbox */
  testCommand: string;
  /** relative to the directory the test command runs in */
  resultsFile: string;
  /** the developer's own test command, null when there is nothing real to run */
  projectTestCommand: string | null;
}

/** What the Daytona runner hands back. Optional fields are filled by runners that support them. */
export interface SandboxOutcome {
  infra: boolean;
  failedAt?: "install" | "extras" | "server" | "services";
  timedOut: boolean;
  resultsRaw: string | null;
  log: string;
  devTests: { ran: boolean; exit: number | null; out: string };
  /** exit code of the mission test process */
  missionExit?: number | null;
}

/* ------------------------------------------------------------------ */
/* 6. result evaluator                                                 */
/* ------------------------------------------------------------------ */

export interface TestCase {
  /** "AC1" etc., null when the test name does not carry an AC id */
  id: string | null;
  name: string;
  status: "passed" | "failed" | "skipped";
  message: string;
}

export interface EvalIssue {
  title: string;
  detail: string;
  file?: string;
}

export interface CriterionOutcome extends CriterionResult {
  status: CriterionStatus;
  strategy: StrategyId;
  cause: OutcomeCause;
}

export interface SandboxFacts {
  sandboxRan: boolean;
  failedAt?: "install" | "extras" | "server" | "services";
  /** the failure looks like our environment, not the developer's project */
  infra: boolean;
  timedOut: boolean;
  missionTestRan: boolean;
  missionExit: number | null;
  suiteError: string;
  devTests: { ran: boolean; exit: number | null; out: string };
  logTail: string;
}

export interface EvaluationOutcome {
  /** what gets stored on the mission */
  verdict: "completed" | "needs_work";
  /** passed: all done. failed: the developer has something to fix. blocked: we could not check, do not penalise. */
  overall: "passed" | "failed" | "blocked";
  results: CriterionOutcome[];
  tests: TestCase[];
  gates: {
    missionTestRan: boolean;
    developerTestWritten: boolean;
    developerTestsPassed: boolean | null;
  };
  commit: CommitReport;
  projectTest: ProjectTestInfo;
  issues: EvalIssue[];
  nextSteps: string[];
  /** what this push did */
  summary: string;
  /** where the repository stands against the acceptance criteria, independent of this push */
  repositoryState: string;
}
