import type { LlmClient } from "../agents/goal-agent.js";
import type { MissionSpec } from "../graph/mission-graph.js";
import type {
  ChangedFile,
  ExecutionPlan,
  MissionTestPlan,
  MockPlan,
  RepoProfile,
  StrategyId,
  TestCase,
} from "./types.js";
import {
  PROVISIONABLE_STORES,
  TEST_FILE,
  ask,
  clip,
  escapeRe,
} from "./utils.js";

export const RUNNER_SUPPORTS_BROWSER = false;

export interface Availability {
  ok: boolean;
  reason: string;
}

export interface StrategyDef {
  id: StrategyId;
  label: string;
  where: "inline" | "sandbox";
  summary: string;
  /** rules given to the LLM that writes the test file (sandbox strategies only) */
  guide: string;
  availability: (profile: RepoProfile) => Availability;
}

const OK: Availability = { ok: true, reason: "" };

const canBoot = (p: RepoProfile): Availability =>
  p.startCommand
    ? OK
    : {
        ok: false,
        reason:
          "package.json has no start or dev script, so the server cannot be booted for HTTP tests.",
      };

export const STRATEGIES: Record<StrategyId, StrategyDef> = {
  static: {
    id: "static",
    label: "Static check",
    where: "inline",
    summary:
      "Reads the pushed code: the implementation files changed and the required library is really imported.",
    guide: "",
    availability: () => OK,
  },
  unit: {
    id: "unit",
    label: "Unit test",
    where: "sandbox",
    summary: "Imports the developer's function and calls it directly.",
    guide:
      "UNIT: import the exported function/class with a relative path and call it. Mock collaborators with vi.mock or injected fakes. Assert return values, thrown errors and call counts.",
    availability: () => OK,
  },
  integration: {
    id: "integration",
    label: "Integration test (mocked client)",
    where: "sandbox",
    summary:
      "Imports the developer's code and replaces the contract library's client with a mock, then asserts the interaction.",
    guide:
      'INTEGRATION: mock the contract library with vi.mock("<package>", ...) or an injected fake and assert the calls it received (keys written, values read back, TTLs, deletions). A test a plain in-memory Map would pass is invalid.',
    availability: () => OK,
  },
  http: {
    id: "http",
    label: "HTTP / API test",
    where: "sandbox",
    summary: "Boots the server and calls its endpoints with fetch.",
    guide:
      "HTTP: call the running server with fetch(`${process.env.MISSION_BASE_URL}/path`). Assert status codes, JSON bodies and headers. Do not import the developer's code. Use unique ids per test so tests are independent.",
    availability: canBoot,
  },
  database: {
    id: "database",
    label: "Database test (through the API)",
    where: "sandbox",
    summary:
      "Boots the server with a provisioned database and checks persistence by writing and reading back over HTTP.",
    guide:
      "DATABASE: a real database is provisioned and the server is connected to it. Through HTTP only: write data, read it back, update, delete, and assert it persists across separate requests. Never connect to the database directly. Use unique ids per test.",
    availability: (p) => {
      const boot = canBoot(p);
      if (!boot.ok) return boot;
      if (!p.dataStores.length)
        return {
          ok: false,
          reason: "No database client was detected in dependencies.",
        };
      const bad = p.dataStores.filter(
        (s) => !PROVISIONABLE_STORES.includes(s.kind),
      );
      if (bad.length)
        return {
          ok: false,
          reason: `The sandbox cannot provision ${bad.map((s) => s.kind).join(", ")} yet.`,
        };
      return OK;
    },
  },
  browser: {
    id: "browser",
    label: "Browser / E2E test",
    where: "sandbox",
    summary: "Drives a real browser against the running app.",
    guide: "BROWSER: not generated yet.",
    availability: (p) =>
      RUNNER_SUPPORTS_BROWSER
        ? canBoot(p)
        : {
            ok: false,
            reason:
              "Browser/E2E checks need a headless browser, which the sandbox runner does not provide yet.",
          },
  },
};

export const strategyAvailability = (
  id: StrategyId,
  profile: RepoProfile,
): Availability => STRATEGIES[id].availability(profile);

export function runStaticChecks(
  spec: MissionSpec,
  testPlan: MissionTestPlan,
  code: Map<string, string>,
  changed: ChangedFile[],
): TestCase[] {
  const cases: TestCase[] = [];
  const changedPaths = new Set(
    changed.filter((c) => c.status !== "removed").map((c) => c.path),
  );
  const scopePaths = [
    spec.scope.startPath,
    ...spec.scope.modifyPaths,
    ...spec.scope.createPaths,
  ];
  const sources = [...code.entries()].filter(([p]) => !TEST_FILE.test(p));
  const lib = spec.contract?.library ?? null;

  for (const c of testPlan.criteria) {
    if (c.strategy !== "static" || !c.available) continue;

    const touched = scopePaths.filter((p) => changedPaths.has(p));
    cases.push({
      id: c.id,
      name: `${c.id} static: implementation files changed`,
      status: touched.length ? "passed" : "failed",
      message: touched.length
        ? ""
        : `None of ${scopePaths.slice(0, 4).join(", ")} changed in this push.`,
    });

    if (lib && c.needsMechanism) {
      const re = new RegExp(
        `(from\\s+|require\\(\\s*|import\\(\\s*)["']${escapeRe(lib)}(/[^"']*)?["']`,
      );
      const hit = sources.find(([, body]) => re.test(body));
      cases.push({
        id: c.id,
        name: `${c.id} static: ${lib} is imported`,
        status: hit ? "passed" : "failed",
        message: hit ? "" : `No source file imports ${lib}.`,
      });
    }
  }
  return cases;
}

/* ------------------------------------------------------------------ */
/* sandbox strategies: LLM writes one vitest file                      */
/* ------------------------------------------------------------------ */

export interface GenerateInput {
  spec: MissionSpec;
  plan: ExecutionPlan;
  testPlan: MissionTestPlan;
  profile: RepoProfile;
  mocks: MockPlan[];
  /** pushed code: path -> content (changed + scope files) */
  code: Map<string, string>;
  changed: ChangedFile[];
  timeoutMs?: number;
}

const BASE_RULES = `You write ONE vitest test file that verifies a developer's mission, based ONLY on the mission's acceptance criteria and the developer's pushed code.

Rules:
1. Import { describe, it, expect, vi, beforeEach, afterEach } from "vitest". TypeScript.
2. Create exactly one top-level describe per criterion listed in DATA.criteria, titled "AC1: <short behaviour>", "AC2: ...". Every test for that criterion lives inside it. The AC id MUST be the first token of the title. Do not write tests for criteria that are not listed.
3. Follow the strategy given for each criterion (see STRATEGY RULES). Test the BEHAVIOUR in the criterion and PROVE THE MECHANISM: when the contract names a library or service, mock that library's client or inject a fake and assert the calls it received. A test that a plain in-memory Map would pass is invalid.
4. Use only the exported functions, classes, routes and names that really exist in the pushed code you are given. Never invent an API. If the code exposes a factory or accepts an injected client, use that.
5. No real network, no real credentials, no child_process, no process.exit, no fs writes. Use vi.useFakeTimers() for TTL/time behaviour when needed. For timing behaviour, NEVER call vi.runAllTimers() or vi.runAllTimersAsync() before asserting an intermediate-time condition: they drain future timers and destroy the timing window. Advance only the intended interval with await vi.advanceTimersByTimeAsync(ms), then assert. Flush immediate promise microtasks with await Promise.resolve() only when needed; do not drain future timers to make a promise settle.
6. In "module" mode: the file lives at <packageRoot>/__mission__/mission.test.ts. Import the developer's code with a relative path such as "../src/foo" (no extension). Use vi.resetModules() and dynamic import() inside tests when mocks must be registered before the module loads. Packages listed in DATA.mocks must be mocked, never called for real. Set no env yourself; the harness provides placeholder env values.
7. In "http" mode: the server is already running (with DATA.services provisioned). Call it with fetch using process.env.MISSION_BASE_URL (never a hard-coded host). Do not import the developer's code. Every criterion is checked through HTTP.
8. Keep each test fast (< 5s), independent, and deterministic. At least 2 tests per criterion that has check "test" or "command", 1 or more for "review".
9. Do NOT read or import the developer's own test file.

Reply with ONLY the TypeScript file in a single \`\`\`ts code block. No explanation.`;

function systemPrompt(testPlan: MissionTestPlan): string {
  const used = new Set(
    testPlan.criteria
      .filter((c) => testPlan.sandboxCriteria.includes(c.id))
      .map((c) => c.strategy),
  );
  const guides = [...used]
    .map((s) => STRATEGIES[s].guide)
    .filter(Boolean)
    .join("\n");
  return `${BASE_RULES}\n\nSTRATEGY RULES:\n${guides}`;
}

function renderGenerateUser(input: GenerateInput): string {
  const { spec, plan, testPlan, profile, mocks, code, changed } = input;
  const files = [...code.entries()]
    .filter(([p]) => !TEST_FILE.test(p))
    .slice(0, 6)
    .map(([p, c]) => `FILE ${p}\n\`\`\`\n${clip(c, 7000)}\n\`\`\``)
    .join("\n\n");
  const ids = new Set(testPlan.sandboxCriteria);
  const data = {
    mode: plan.mode,
    track: plan.track,
    framework: profile.framework,
    packageRoot: plan.root || "(repository root)",
    objective: spec.objective,
    criteria: spec.criteria
      .filter((c) => ids.has(c.id))
      .map((c) => ({
        ...c,
        strategy:
          testPlan.criteria.find((x) => x.id === c.id)?.strategy ?? "unit",
      })),
    contract: spec.contract ?? null,
    scope: spec.scope,
    changedFiles: changed.map((c) => `${c.status} ${c.path}`),
    mocks:
      plan.mode === "module"
        ? mocks.filter((m) => m.kind === "module-mock").map((m) => m.name)
        : [],
    services: plan.mode === "http" ? plan.serviceSetup.map((s) => s.name) : [],
  };
  return `DATA:\n${JSON.stringify(data)}\n\nPUSHED CODE\n${files || "(no source files found)"}`;
}

export function extractTestCode(raw: string): string {
  const m = /```(?:ts|typescript|tsx)?\s*\n([\s\S]*?)```/.exec(raw);
  return (m ? m[1] : raw).trim();
}

export function validateTestCode(
  code: string,
  spec: MissionSpec,
  plan: ExecutionPlan,
  sandboxIds: string[],
  needsMechanism: boolean,
): string[] {
  const errors: string[] = [];
  if (code.length < 200) errors.push("test file is too short");
  if (code.length > 40_000) errors.push("test file is too long");
  if (!/from\s+["']vitest["']/.test(code))
    errors.push('must import from "vitest"');
  for (const id of sandboxIds)
    if (!new RegExp(`describe\\(\\s*["'\`]${id}\\b`).test(code))
      errors.push(`missing describe("${id}: ...")`);
  if (/child_process|process\.exit|execSync|spawnSync|writeFileSync/.test(code))
    errors.push("forbidden API (child_process / process.exit / fs writes)");
  if (/fetch\(\s*["'`]https?:\/\/(?!127\.0\.0\.1|localhost)/.test(code))
    errors.push("external network call");
  if (plan.mode === "http" && !code.includes("MISSION_BASE_URL"))
    errors.push("http mode tests must use process.env.MISSION_BASE_URL");
  // A common false-negative source: runAllTimersAsync drains the entire fake
  // timer queue, so a test cannot then assert that something is still pending
  // at an intermediate timestamp.
  if (
    /vi\.useFakeTimers\s*\(/.test(code) &&
    /vi\.runAllTimers(?:Async)?\s*\(/.test(code)
  ) {
    errors.push(
      "timing tests must not drain all fake timers before intermediate-time assertions; use await vi.advanceTimersByTimeAsync(ms) for each intended interval",
    );
  }
  const lib = spec.contract?.library;
  if (lib && plan.mode === "module" && needsMechanism) {
    const token = lib.toLowerCase().replace(/^@[^/]+\//, "");
    if (!code.toLowerCase().includes(token))
      errors.push(`tests never mention the required library "${lib}"`);
    if (!/vi\.mock\(|vi\.fn\(|vi\.spyOn\(/.test(code))
      errors.push("tests must mock or spy on the library client");
  }
  return errors;
}

/** Writes the vitest file for every sandbox criterion of the plan. Returns code null after 3 rejected attempts. */
export async function generateMissionTest(
  llm: LlmClient,
  input: GenerateInput,
): Promise<{ code: string | null; attempts: number; errors: string[] }> {
  const timeoutMs =
    input.timeoutMs ?? Number(process.env.LLM_TIMEOUT_MS ?? 60_000);
  const system = systemPrompt(input.testPlan);
  const user = renderGenerateUser(input);
  const needsMechanism = input.testPlan.criteria.some(
    (c) => input.testPlan.sandboxCriteria.includes(c.id) && c.needsMechanism,
  );
  let errors: string[] = [];
  let previous = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const prompt =
      attempt === 0
        ? user
        : `${user}\n\nYour previous file was rejected:\n${errors.map((e) => `- ${e}`).join("\n")}\n\nReturn the corrected full file only.`;
    try {
      previous = await ask(llm, system, prompt, 6000, false, timeoutMs);
    } catch (e) {
      errors = [
        `LLM call failed: ${e instanceof Error ? e.message : String(e)}`,
      ];
      break;
    }
    const code = extractTestCode(previous);
    errors = validateTestCode(
      code,
      input.spec,
      input.plan,
      input.testPlan.sandboxCriteria,
      needsMechanism,
    );
    if (errors.length === 0) return { code, attempts: attempt + 1, errors: [] };
  }
  return { code: null, attempts: 3, errors };
}
