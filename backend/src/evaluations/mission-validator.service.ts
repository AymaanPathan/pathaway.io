import type {
  MissionCriterion,
  MissionSpec,
  Row,
  SavedMove,
  StoredMission,
} from "../graph/mission-graph.js";
import type { RepoInspection } from "../service/mission-repo.service.js";

export interface ValidationContext {
  saved: SavedMove;
  inspection: RepoInspection;
  previousMissions: StoredMission[];
}

export type ValidationResult =
  | { ok: true; spec: MissionSpec; warnings: string[] }
  | { ok: false; errors: string[] };

const MAX_FILES = 5;
const s = (v: unknown, d = ""): string =>
  typeof v === "string" ? v.trim() : d;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] =>
  arr(v)
    .map((x) => s(x))
    .filter(Boolean);
const clip = (t: string, n: number): string =>
  t.length > n ? t.slice(0, n) : t;
const uniq = <T>(a: T[]): T[] => [...new Set(a)];
const norm = (t: string): string =>
  t
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_$]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const PATH_IN_TEXT =
  /\b[\w.-]+(?:\/[\w.-]+)+\.(?:tsx?|jsx?|mjs|cjs|json|md)\b/g;

/** The developer never writes tests: test and spec paths are never part of the scope. */
const TEST_PATH =
  /(^|\/)(__tests__|__mocks__|tests?|specs?)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;
const TEST_STEP = /\b(test|tests|spec|vitest|jest|mocha)\b/i;

export function validateMission(
  raw: unknown,
  ctx: ValidationContext,
): ValidationResult {
  const root = raw as Row | null;
  const m = (
    root && typeof root === "object" ? (root.mission ?? root) : null
  ) as Row | null;
  if (!m || typeof m !== "object" || Array.isArray(m))
    return {
      ok: false,
      errors: ['reply is not valid JSON with a top-level "mission" object'],
    };

  const { saved, inspection, previousMissions } = ctx;
  const errors: string[] = [];
  const warnings: string[] = [];

  // ---- text fields ----
  const title = clip(s(m.title), 120);
  const objective = clip(s(m.objective), 220);
  const summary = clip(s(m.summary), 1200);
  if (title.length < 12)
    errors.push("title must be at least 12 chars and name the mechanism");
  if (objective.length < 20)
    errors.push("objective must be at least 20 chars and start with a verb");
  if (summary.length < 20) errors.push("summary is missing");
  if (
    title &&
    previousMissions.some(
      (p) => p.status !== "abandoned" && norm(p.spec.title) === norm(title),
    )
  )
    errors.push("title repeats an earlier mission, pick a different task");

  // ---- steps (implementation only) ----
  const allSteps = strs(m.implementation ?? m.steps).slice(0, 6);
  const implSteps = allSteps.filter((x) => !TEST_STEP.test(x));
  const steps = implSteps.length >= 3 ? implSteps : allSteps;
  if (steps.length < 3)
    errors.push("implementation needs 3 to 5 concrete steps");
  if (implSteps.length < allSteps.length)
    warnings.push("removed steps that asked the developer to write tests");

  // ---- criteria: each one is a test case WE run ----
  const rawCriteria = arr(m.acceptanceCriteria ?? m.criteria) as Row[];
  if (rawCriteria.length < 3)
    errors.push("exactly 3 acceptance criteria are required");
  const criteria: MissionCriterion[] = rawCriteria.slice(0, 3).map((c, i) => ({
    // ids are fixed: the test file titles every describe "AC1", "AC2", "AC3"
    id: `AC${i + 1}`,
    description: clip(s(c?.description), 300),
    check: "test" as const,
    how: clip(
      s(c?.how) || "covered by the test the platform runs in the sandbox",
      300,
    ),
  }));
  criteria.forEach((c) => {
    if (c.description.length < 15)
      errors.push(
        `criterion ${c.id} needs a description of an observable behaviour`,
      );
  });
  if (rawCriteria.slice(0, 3).some((c) => s(c?.check).toLowerCase() !== "test"))
    warnings.push("set every criterion to check=test (the platform runs them)");

  // ---- scope / paths ----
  const files = new Set(inspection.files);
  const scope = (m.scope ?? {}) as Row;
  const startPath = inspection.startPath;

  let modify = strs(scope.modifyPaths);
  let create = strs(scope.createPaths);
  const moved = modify.filter((p) => !files.has(p));
  modify = modify.filter((p) => files.has(p));
  create = uniq([...create, ...moved]).filter((p) => !files.has(p));
  if (!modify.includes(startPath)) modify.unshift(startPath);

  // no test files in scope, ever
  const beforeCount = modify.length + create.length;
  modify = modify.filter((p) => p === startPath || !TEST_PATH.test(p));
  create = create.filter((p) => !TEST_PATH.test(p));
  if (modify.length + create.length < beforeCount)
    warnings.push("removed test files from the scope");

  // any implementation file named in the text that does not exist becomes a file to create
  const text = [
    ...steps,
    ...criteria.map((c) => `${c.description} ${c.how}`),
  ].join("\n");
  for (const p of uniq(text.match(PATH_IN_TEXT) ?? [])) {
    if (TEST_PATH.test(p)) continue;
    if (files.has(p) || create.includes(p) || modify.includes(p)) continue;
    create.push(p);
    warnings.push(`${p} was mentioned but missing, moved to createPaths`);
  }

  modify = uniq(modify);
  create = uniq(create);
  if (modify.length + create.length > MAX_FILES)
    errors.push(
      `scope touches ${modify.length + create.length} files, the maximum is ${MAX_FILES}`,
    );

  // ---- grounding ----
  const g = (m.grounding ?? {}) as Row;
  const refs = saved.evidence.map((e) => e.ref).filter(Boolean);
  let evidenceIds = strs(g.evidenceIds)
    .map((x) => x.toUpperCase())
    .filter((x) => refs.includes(x));
  if (!evidenceIds.length && refs.length) evidenceIds = [refs[0] as string];

  let observedNow = clip(s(g.observedNow), 140);
  const haystack = norm(inspection.startFileText || inspection.excerpt);
  if (observedNow.length < 12 || !haystack.includes(norm(observedNow))) {
    const line = inspection.excerpt
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length >= 12);
    if (line) {
      observedNow = clip(line, 140);
      warnings.push("observedNow replaced with a real line from the code");
    }
  }
  const gapStillOpen =
    clip(s(g.gapStillOpen), 600) ||
    "The saved move's gap is still present in the current code.";

  if (errors.length) return { ok: false, errors };

  const spec: MissionSpec = {
    title,
    objective,
    summary,
    scope: {
      startPath,
      modifyPaths: modify,
      createPaths: create,
      outOfScope: strs(scope.outOfScope).slice(0, 4),
    },
    steps,
    criteria,
    // the platform writes and runs the tests, the developer has none
    verify: { testFile: null, command: null },
    expectedSkills: (arr(m.expectedSkills) as Row[]).slice(0, 3).map((e) => ({
      capabilityId: saved.capability?.id ?? null,
      evidence: clip(
        s(e?.evidence) || "the implementation change in the starting file",
        300,
      ),
    })),
    grounding: { evidenceIds, observedNow, gapStillOpen },
    estimatedMinutes: Math.min(
      240,
      Math.max(20, Math.round(Number(m.estimatedMinutes) || 60)),
    ),
  };
  if (!spec.expectedSkills.length)
    spec.expectedSkills = [
      {
        capabilityId: saved.capability?.id ?? null,
        evidence: "the implementation change in the starting file",
      },
    ];

  return { ok: true, spec, warnings };
}
