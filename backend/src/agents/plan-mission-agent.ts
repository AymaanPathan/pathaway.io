import { extractJson, type LlmClient } from "./goal-agent.js";
import type {
  MissionContract,
  MissionSpec,
  Row,
  SavedMove,
  StoredMission,
} from "../graph/mission-graph.js";
import {
  mechanismToken,
  type RepoInspection,
} from "../service/mission-repo.service.js";
import { validateMission } from "../evaluations/mission-validator.service.js";



export interface PlanMissionInput {
  saved: SavedMove;
  inspection: RepoInspection;
  previousMissions: StoredMission[];
  timeoutMs?: number;
}

export interface MissionPlan {
  status: "planned" | "llm_unavailable" | "generation_failed";
  spec: MissionSpec | null;
  source: "llm" | "llm_repaired" | "none";
  errors: string[];
  llmCalls: number;
  notes: string[];
}

const MAX_ATTEMPTS = 3;
const clip = (s: string, n: number): string =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;
const text = (v: unknown): string =>
  v == null || typeof v === "object" ? "" : String(v).trim();

const TEST_PATH =
  /(^|\/)(__tests__|__mocks__|tests?|specs?)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;
const TEST_STEP = /\b(test|tests|spec|vitest|jest|mocha)\b/i;

const SYSTEM = `You are the Mission Agent of a developer-growth platform. A goal agent already decided ONE next move for this developer. Turn that saved move into ONE implementation-ready mission in the developer's real repository. You do not change the goal, the focus or the capability.

You receive: the saved move, the capability it advances, the evidence the developer already built (E# ids), and a fresh inspection of the repository (pinned commit, current code around the starting point, nearby files, and a gapCheck).

IMPORTANT: the developer writes IMPLEMENTATION ONLY. The developer does NOT write, create or run tests, and does NOT set up a test runner. The platform writes its own tests from your acceptance criteria and runs them in a sandbox against the developer's files. Never ask the developer to create a test file, add vitest/jest, or add a "test" script.

How to write the mission:
1. Carry out the saved move. Start from the starting file and the mechanism named in the challenge.
2. Scope: at most 5 files in total, all IMPLEMENTATION files. modifyPaths are EXISTING files from the repository (must include startPath). createPaths are NEW implementation files the developer must create (for example a new module or client wrapper). Never put a test file, spec file or __tests__ path in either list. Any non-test file you mention in a step or criterion that is not in the repository listing MUST be in createPaths. Name exact file paths and, for each file, say in the steps what must change in it.
3. Write exactly 3 acceptance criteria. Each is a TEST CASE that the platform will run, written as an observable behaviour (status code, returned shape, thrown error, logged event, retried call). All 3 have check "test". "how" describes the test we run: the setup (given), the action (when) and the assertion (then), in one or two sentences. Never use check "review" or "command".
4. The criteria must PROVE THE MECHANISM, not just the result. A criterion that a trivial implementation (for example a local Map or a stub that skips the required library or service) could satisfy is invalid. When the move requires a library or service, our tests assert the interaction with it (calls received by a mock or fake of its client, keys written, values read back, deletions issued), and at least 2 criteria must name that library or service explicitly. Tests must not need a deployed server unless the move says so.
5. Steps: 3 to 5, all about implementation. Step 1 opens startPath and names functions or behaviour from the code. The last step tells the developer to commit and push the branch. No step mentions tests.
6. State what is out of scope (up to 4 short items). Keep deployment, unrelated integrations and writing tests out of scope.
7. grounding.observedNow is a VERBATIM fragment (12-140 chars) copied from the current code excerpt. grounding.gapStillOpen explains why the gap still exists today, using ONLY the evidence and the gapCheck you were given. If gapCheck.dependencyHits or gapCheck.pathHits is non-empty, do not claim the library or capability is missing; say what the code actually shows.
8. contract: the decisions the developer must not have to guess, because our tests rely on them. "library" is the npm package the move requires, or null when none. "decisions" has 3 to 8 items covering, as far as they apply: the library or mechanism, exported function names and signatures our tests will import, the data or key format, serialization, lifetime/TTL, who owns the connection or resource lifecycle, error behaviour, and what any clear/reset/delete operation means. Each decision is concrete (a format, a value, a rule), not advice.
9. expectedSkills says what in the diff will show the capability.
Do not invent files, functions, endpoints or capabilities. Do not repeat what the developer already built or an earlier mission. Forbidden phrases: "one level deeper", "add a test for the new case", "close this gap", "best practices", generic refactors. Never write a shell command.

Reply with JSON only, exactly this shape:
{
 "mission": {
  "title": "<12-120 chars, names the mechanism>",
  "objective": "<20-220 chars, starts with a verb>",
  "summary": "<2-3 sentences: why this mission follows from the saved move, citing evidence ids like E2>",
  "scope": {
   "startPath": "<exactly the starting file path>",
   "modifyPaths": ["<existing implementation paths, must include startPath>"],
   "createPaths": ["<new implementation paths, may be empty, never tests>"],
   "outOfScope": ["<up to 4 short items>"]
  },
  "implementation": ["<3 to 5 implementation steps>"],
  "acceptanceCriteria": [
   {"id": "AC1", "description": "<observable behaviour>", "check": "test", "how": "<given / when / then of the test we run, and what it asserts about the mechanism>"},
   {"id": "AC2", "description": "...", "check": "test", "how": "..."},
   {"id": "AC3", "description": "...", "check": "test", "how": "..."}
  ],
  "contract": {
   "library": "<package name or null>",
   "decisions": [{"topic": "<short topic>", "decision": "<concrete choice>"}]
  },
  "verify": {"testFile": null},
  "expectedSkills": [{"capabilityId": "<capability id or null>", "evidence": "<what in the diff shows it>"}],
  "grounding": {
   "evidenceIds": ["E#"],
   "observedNow": "<verbatim fragment from the current code>",
   "gapStillOpen": "<why the gap still exists in the current code>"
  },
  "estimatedMinutes": 60
 }
}`;

function renderUser(input: PlanMissionInput): string {
  const { saved, inspection, previousMissions } = input;
  const challenge = (saved.details.challenge ?? {}) as Row;
  const decision = (saved.details.decision ?? {}) as Row;
  const data = {
    goal: saved.wish,
    savedMove: {
      title: saved.title,
      why: decision.why ?? saved.summary,
      mechanism: challenge.mechanism ?? "",
      limitation: challenge.limitation ?? "",
      doneWhen: saved.doneWhen,
      stepsFromGoalAgent: saved.details.steps ?? [],
      focusTopic: saved.focusSlug,
      gapTopics: saved.gapSlugs,
      builtOnTopics: saved.strengthSlugs,
    },
    capability: saved.capability,
    evidence: saved.evidence.map((e) => ({
      id: e.ref,
      repository: e.repository,
      path: e.path,
      commit: e.commitSha.slice(0, 7),
      technique: e.technique,
      summary: e.summary,
    })),
    gapCheck: {
      terms: inspection.gapProbe.terms,
      dependencyHits: inspection.gapProbe.dependencyHits,
      startFileHits: inspection.gapProbe.startFileHits,
      pathHits: inspection.gapProbe.pathHits,
      scope:
        "package.json dependencies, the start file text and file paths only",
    },
    repository: {
      name: inspection.pin.repository,
      branch: inspection.pin.branch,
      baseCommit: inspection.pin.baseCommit.slice(0, 7),
      packageRoot: inspection.pin.packageRoot || "(repository root)",
      startPath: inspection.startPath,
      nearbyFiles: inspection.nearbyFiles,
    },
    earlierMissions: previousMissions
      .filter((m) => m.status !== "abandoned")
      .map((m) => m.spec.title),
  };
  return `DATA:\n${JSON.stringify(data)}\n\nCURRENT CODE ${inspection.startPath} (the only code you may quote)\n\`\`\`\n${inspection.excerpt}\n\`\`\``;
}

async function callLlm(
  llm: LlmClient,
  user: string,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await llm.complete({
      system: SYSTEM,
      user,
      maxTokens: 3200,
      json: true,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}


function readContract(parsed: unknown): {
  contract: MissionContract | null;
  errors: string[];
} {
  const root = (parsed ?? {}) as Row;
  const m = (root.mission ?? root) as Row;
  const c = m.contract as Row | undefined;
  if (!c || typeof c !== "object")
    return { contract: null, errors: ["contract is missing"] };

  const library = text(c.library) || null;
  const raw = Array.isArray(c.decisions) ? (c.decisions as Row[]) : [];
  const decisions = raw
    .map((d) => ({
      topic: clip(text(d?.topic), 60),
      decision: clip(text(d?.decision), 240),
    }))
    .filter((d) => d.topic && d.decision)
    .slice(0, 8);
  if (decisions.length < 3)
    return {
      contract: null,
      errors: ["contract.decisions needs 3 to 8 concrete decisions"],
    };
  return { contract: { library, decisions }, errors: [] };
}


function criteriaNameMechanism(
  spec: MissionSpec,
  contract: MissionContract,
): string[] {
  const token = mechanismToken(contract.library);
  if (!token) return [];
  const naming = spec.criteria.filter((c) =>
    `${c.description} ${c.how}`.toLowerCase().includes(token),
  ).length;
  return naming >= 2
    ? []
    : [
        `at least 2 acceptance criteria must name "${contract.library}" and assert the interaction with it (found ${naming})`,
      ];
}


function stripTesting(spec: MissionSpec): MissionSpec {
  const modifyPaths = spec.scope.modifyPaths.filter((p) => !TEST_PATH.test(p));
  const createPaths = spec.scope.createPaths.filter((p) => !TEST_PATH.test(p));
  const cleaned = spec.steps.filter((s) => !TEST_STEP.test(s));
  const steps = cleaned.length >= 3 ? cleaned : spec.steps;
  return {
    ...spec,
    scope: { ...spec.scope, modifyPaths, createPaths },
    steps,
    verify: { testFile: null, command: null },
  };
}

export async function planMission(
  llm: LlmClient | null,
  input: PlanMissionInput,
): Promise<MissionPlan> {
  const notes: string[] = [];
  if (!llm)
    return {
      status: "llm_unavailable",
      spec: null,
      source: "none",
      errors: [],
      llmCalls: 0,
      notes: [
        "no LLM configured: the Mission Agent writes the task, so none was produced",
      ],
    };

  const timeoutMs =
    input.timeoutMs ?? Number(process.env.LLM_TIMEOUT_MS ?? 30_000);
  const user = renderUser(input);
  const ctx = {
    saved: input.saved,
    inspection: input.inspection,
    previousMissions: input.previousMissions,
  };

  let previous = "";
  let errors: string[] = [];
  let llmCalls = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const prompt =
      attempt === 0
        ? user
        : `${user}\n\nYour previous reply was rejected for these reasons:\n${errors.map((e) => `- ${e}`).join("\n")}\n\nPrevious reply:\n${clip(previous, 1200)}\n\nReturn corrected JSON only. Keep what is sound; fix only what was rejected. Remember: no test files, the developer writes implementation only.`;
    try {
      llmCalls += 1;
      previous = await callLlm(llm, prompt, timeoutMs);
    } catch (error) {
      errors = [
        `LLM call failed: ${error instanceof Error ? error.message : String(error)}`,
      ];
      notes.push(errors[0] as string);
      break;
    }
    const parsed = extractJson(previous);
    const checked = validateMission(parsed, ctx);
    if (checked.ok) {
      const { contract, errors: contractErrors } = readContract(parsed);
      const mechanismErrors = contract
        ? criteriaNameMechanism(checked.spec, contract)
        : [];
      const extra = [...contractErrors, ...mechanismErrors];
      if (extra.length === 0 && contract) {
        notes.push(...checked.warnings.map((w) => `validator: ${w}`));
        return {
          status: "planned",
          spec: stripTesting({ ...checked.spec, contract }),
          source: attempt > 0 ? "llm_repaired" : "llm",
          errors: [],
          llmCalls,
          notes,
        };
      }
      errors = extra;
      notes.push(`attempt ${attempt + 1} rejected: ${errors.join(" | ")}`);
      continue;
    }
    errors = checked.errors;
    notes.push(
      `attempt ${attempt + 1} rejected: ${errors.join(" | ")}${errors[0]?.includes("not valid JSON") ? ` (raw: ${clip(previous.trim(), 200) || "empty"})` : ""}`,
    );
  }
  return {
    status: "generation_failed",
    spec: null,
    source: "none",
    errors,
    llmCalls,
    notes,
  };
}
