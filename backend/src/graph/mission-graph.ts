import { createHash } from "node:crypto";
import type { Graph } from "../db/falkordb.js";

/**
 * Mission graph layer.
 *
 * Reads the saved Goal + NextMove (written by goal-graph.ts), stores the Mission
 * built from it, and records the evaluation of the developer's submission.
 * Cypher lives here only. Agents and services never write queries.
 *
 * Written by this file:
 *   (Goal)-[:HAS_MISSION]->(Mission)            (Developer)-[:ASSIGNED]->(Mission)
 *   (Mission)-[:FROM_MOVE]->(NextMove)          (Mission)-[:ADVANCES]->(Capability)
 *   (Mission)-[:FOCUSES_ON]->(Topic)            (Mission)-[:STARTS_AT]->(FileChange)
 *   (Mission)-[:BACKED_BY {ref}]->(Demonstration)
 *   (Mission)-[:IN_REPOSITORY]->(Repository)
 *   (Mission)-[:EVALUATED_AS]->(Evaluation)
 *   (Developer)-[:DEMONSTRATED]->(Demonstration {source:"mission"})-[:OF_CAPABILITY]->(Capability)
 *
 * A Mission keeps a full snapshot of the move it came from, because
 * storeNextMove() replaces the NextMove of a goal when a new one is planned.
 *
 * The queries that load the saved move are recorded as a GraphTraceEntry list
 * (what really ran, with real row counts). The trace is stored on the Mission
 * (explanation_json) and shown to the developer. Nothing in it is reconstructed
 * afterwards.
 *
 * Set MISSION_DEBUG=1 to log every successful query too (failures always log).
 */

export type Row = Record<string, any>;

const LOG_PREFIX = "[mission-graph]";
function log(message: string, detail?: Row): void {
  if (detail !== undefined) console.log(`${LOG_PREFIX} ${message}`, detail);
  else console.log(`${LOG_PREFIX} ${message}`);
}

const str = (v: unknown, fallback = ""): string =>
  v == null || typeof v === "object" ? fallback : String(v).trim();
const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const sha8 = (s: string): string =>
  createHash("sha1").update(s).digest("hex").slice(0, 8);
const clipText = (s: string, n: number): string =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

function parseJson<T>(v: unknown, fallback: T): T {
  try {
    const parsed = JSON.parse(str(v));
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** Shows type and length so "118355098" vs 118355098 vs " 118355098" is visible. */
function describeParams(params: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string")
      out[k] = {
        type: "string",
        length: v.length,
        value: v.length > 80 ? `${v.slice(0, 80)}…` : v,
      };
    else if (Array.isArray(v)) out[k] = { type: "array", length: v.length };
    else out[k] = { type: typeof v, value: v };
  }
  return out;
}

// ------------------------------------------------------------
// trace + explanation types
// ------------------------------------------------------------

/** One query that really ran against FalkorDB while loading the saved move. */
export interface GraphTraceEntry {
  step: string;
  label: string;
  /** the relationship pattern the query walks, e.g. (NextMove)-[:ADVANCES]->(Capability) */
  relationship: string;
  /** compacted Cypher text (whitespace collapsed, clipped) */
  cypher: string;
  /** string params only (ids), clipped */
  params: Record<string, string>;
  /** null when the query itself failed */
  rows: number | null;
  ms: number;
  /** first column of the first rows, to show what came back */
  sample: string[];
  error?: string;
}

export interface ExplanationEvidence {
  ref: string;
  cited: boolean;
  repository: string;
  path: string;
  commitSha: string;
  permalink: string;
  technique: string;
  summary: string;
  fileChangeId: string;
  demonstrationId: string;
  /** true: the observed code was found in the file at that commit; false: not found; null: not checked */
  verifiedAtCommit: boolean | null;
  excerpt: string;
}

export interface GapCheck {
  terms: string[];
  status: "contradicted" | "weak_signal" | "not_found_in_scope" | "unverified";
  dependencyHits: string[];
  startFileHits: string[];
  pathHits: string[];
  contradictingTerms: string[];
  /** what was actually scanned, so "not found" is not read as "does not exist" */
  scope: string;
}

export interface MissionExplanation {
  generatedAt: string;
  trace: GraphTraceEntry[];
  evidence: ExplanationEvidence[];
  gapCheck: GapCheck;
  selection: {
    goal: string;
    moveTitle: string;
    moveWhy: string;
    capability: { id: string; name: string } | null;
    focusSlug: string | null;
    builtOn: string[];
    gapTopics: string[];
    startFileChangeId: string | null;
    /** the goal agent saves only the chosen move, so there is nothing to compare against */
    alternatives: "not_recorded";
    note: string;
  };
  proves: string[];
  doesNotProve: string[];
}

interface TraceSpec {
  trace: GraphTraceEntry[];
  step: string;
  relationship: string;
}

const STEP_ORDER = [
  "goal_and_move",
  "capability",
  "focus",
  "start_file",
  "strengths",
  "gaps",
  "evidence",
  "evidence_files",
];

function sampleOf(rows: Row[]): string[] {
  return rows
    .slice(0, 6)
    .map((r) => clipText(str(Object.values(r)[0]), 80))
    .filter(Boolean);
}

/**
 * Runs a query. Returns null when the query itself fails (and logs why).
 * An empty result is [], never null, so callers can tell "no match" from "error".
 * When `tr` is given, the query is also recorded in the trace.
 */
async function query(
  graph: Graph,
  label: string,
  cypher: string,
  params: Row = {},
  tr?: TraceSpec,
): Promise<Row[] | null> {
  const t0 = Date.now();
  const compact = cypher.replace(/\s+/g, " ").trim();
  const traceParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params))
    traceParams[k] = typeof v === "string" ? clipText(v, 80) : String(v);

  try {
    const result = await graph.query(cypher, { params });
    const rows = (result.data ?? []) as Row[];
    if (tr)
      tr.trace.push({
        step: tr.step,
        label,
        relationship: tr.relationship,
        cypher: clipText(compact, 500),
        params: traceParams,
        rows: rows.length,
        ms: Date.now() - t0,
        sample: sampleOf(rows),
      });
    if (process.env.MISSION_DEBUG === "1")
      log(`${label} ok`, {
        rows: rows.length,
        ms: Date.now() - t0,
        params: describeParams(params),
      });
    return rows;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (tr)
      tr.trace.push({
        step: tr.step,
        label,
        relationship: tr.relationship,
        cypher: clipText(compact, 500),
        params: traceParams,
        rows: null,
        ms: Date.now() - t0,
        sample: [],
        error: message,
      });
    log(`${label} FAILED`, {
      error: message,
      ms: Date.now() - t0,
      params: describeParams(params),
      cypher: compact.slice(0, 300),
    });
    return null;
  }
}

async function count(
  graph: Graph,
  label: string,
  cypher: string,
  params: Row,
): Promise<number> {
  const rows = await query(graph, label, cypher, params);
  return num(rows?.[0]?.n);
}

// ------------------------------------------------------------
// types
// ------------------------------------------------------------

export type MissionStatus =
  | "proposed"
  | "in_progress"
  | "submitted"
  | "completed"
  | "needs_work"
  | "abandoned";

/** Statuses from which a submission may be (re-)evaluated. */
export const EVALUABLE: MissionStatus[] = [
  "proposed",
  "in_progress",
  "submitted",
  "needs_work",
];

export interface SavedEvidence {
  /** the id the goal agent cited, e.g. "E2" */
  ref: string;
  demonstrationId: string;
  fileChangeId: string;
  repository: string;
  path: string;
  commitSha: string;
  technique: string;
  summary: string;
  permalink: string;
}

/** The goal + NextMove as saved by the goal agent. The mission never re-decides any of it. */
export interface SavedMove {
  developerId: string;
  goalId: string;
  wish: string;
  nextMoveId: string;
  /** identifies this version of the NextMove (it is replaced when a new one is planned) */
  moveVersion: string;
  title: string;
  summary: string;
  doneWhen: string;
  createdAt: string;
  /** details_json: decision, challenge, startingPoint, steps */
  details: Row;
  focusSlug: string | null;
  capability: { id: string; name: string } | null;
  startFileChangeId: string | null;
  strengthSlugs: string[];
  gapSlugs: string[];
  evidence: SavedEvidence[];
  /** the queries that really ran to load this move */
  trace: GraphTraceEntry[];
}

export interface MissionCriterion {
  id: string;
  description: string;
  check: "test" | "command" | "review";
  how: string;
}

/** Decisions the developer must not have to guess (library, formats, lifecycle, errors). */
export interface MissionContract {
  /** the package the move requires, or null when no external library is involved */
  library: string | null;
  decisions: Array<{ topic: string; decision: string }>;
}

export interface MissionSpec {
  title: string;
  objective: string;
  summary: string;
  scope: {
    startPath: string;
    modifyPaths: string[];
    createPaths: string[];
    outOfScope: string[];
  };
  steps: string[];
  criteria: MissionCriterion[];
  /** command is derived by code from the inspected repository, never written by the agent */
  verify: { testFile: string | null; command: string | null };
  expectedSkills: Array<{ capabilityId: string | null; evidence: string }>;
  grounding: {
    evidenceIds: string[];
    observedNow: string;
    gapStillOpen: string;
  };
  /** implementation contract; missing on missions created before it existed */
  contract?: MissionContract;
  estimatedMinutes: number;
}

export interface MissionRepoPin {
  repository: string;
  branch: string;
  baseCommit: string;
  packageRoot: string;
  packageManager: "npm" | "pnpm" | "yarn" | "bun";
  testRunner: "vitest" | "jest" | "mocha" | "unknown";
  /** null when the package has no test script */
  testCommand: string | null;
}

export interface StoredMission {
  id: string;
  goalId: string;
  developerId: string;
  nextMoveId: string;
  moveVersion: string;
  status: MissionStatus;
  capabilityId: string | null;
  focusSlug: string | null;
  spec: MissionSpec;
  pin: MissionRepoPin;
  /** why this mission was selected, from executed queries and inspected code; null on older missions */
  explanation: MissionExplanation | null;
  /** the developer's fork ("owner/name"), "" until the workspace is prepared */
  forkRepository: string;
  /** the working branch created in the fork, "" until the workspace is prepared */
  workBranch: string;
  createdAt: string;
  startedAt: string;
  submittedHead: string;
  completedAt: string;
}

export interface MissionStored {
  stored: boolean;
  missionId: string;
  links: {
    goal: number;
    developer: number;
    move: number;
    capability: number;
    focus: number;
    startFile: number;
    demonstrations: number;
    repository: number;
  };
  rejected: string[];
}

export interface CriterionResult {
  id: string;
  met: boolean;
  /** true only when the quote was found in the diff and the check's preconditions held */
  verified: boolean;
  quote: string;
  reasoning: string;
}

export interface EvaluationRecord {
  missionId: string;
  developerId: string;
  headCommit: string;
  verdict: "completed" | "needs_work";
  ciState: "success" | "failure" | "pending" | "none";
  results: CriterionResult[];
  scopeWarnings: string[];
  changedFiles: string[];
  summary: string;
  /** written only when verdict is "completed" */
  demonstration: {
    capabilityId: string;
    technique: string;
    summary: string;
    depth: "working";
    path: string;
    permalink: string;
    commitSubject: string;
  } | null;
}

// ------------------------------------------------------------
// read: the saved goal + move
// ------------------------------------------------------------

/** Runs only when the saved-move lookup returns nothing; reports which link is missing. */
async function diagnoseSavedMove(
  graph: Graph,
  dev: string,
  goal: string,
): Promise<void> {
  const p = { dev, goal_id: goal };
  const n = async (label: string, cypher: string) => {
    const rows = await query(graph, `diagnose ${label}`, cypher, p);
    return rows === null ? "QUERY ERROR" : rows.length;
  };
  const report = {
    developerExists: await n(
      "developer",
      `MATCH (d:Developer {id: $dev}) RETURN d.id AS id`,
    ),
    goalExists: await n(
      "goal",
      `MATCH (g:Goal {id: $goal_id}) RETURN g.id AS id`,
    ),
    developerOwnsGoal: await n(
      "has_goal",
      `MATCH (:Developer {id: $dev})-[:HAS_GOAL]->(g:Goal {id: $goal_id}) RETURN g.id AS id`,
    ),
    goalHasMove: await n(
      "proposes",
      `MATCH (g:Goal {id: $goal_id})-[:PROPOSES]->(m:NextMove) RETURN m.id AS id`,
    ),
  };
  const ownedGoals = await query(
    graph,
    "diagnose owned goals",
    `MATCH (:Developer {id: $dev})-[:HAS_GOAL]->(g:Goal) RETURN g.id AS id LIMIT 10`,
    p,
  );
  log("saved move NOT FOUND, link check", {
    params: describeParams(p),
    ...report,
    goalsOwnedByThisDeveloper: (ownedGoals ?? []).map((r) => r.id),
  });
}

export async function loadSavedMove(
  graph: Graph,
  developerId: string,
  goalId: string,
): Promise<SavedMove | null> {
  const trace: GraphTraceEntry[] = [];
  const spec = (step: string, relationship: string): TraceSpec => ({
    trace,
    step,
    relationship,
  });

  const head = await query(
    graph,
    "saved move",
    `
    MATCH (:Developer {id: $dev})-[:HAS_GOAL]->(g:Goal {id: $goal_id})-[:PROPOSES]->(m:NextMove)
    RETURN m.id AS id, g.wish AS wish, coalesce(m.title, "") AS title,
           coalesce(m.summary, "") AS summary, coalesce(m.done_when, "") AS done_when,
           coalesce(m.created_at, "") AS created_at,
           coalesce(m.details_json, "{}") AS details
    LIMIT 1
    `,
    { dev: developerId, goal_id: goalId },
    spec(
      "goal_and_move",
      "(Developer)-[:HAS_GOAL]->(Goal)-[:PROPOSES]->(NextMove)",
    ),
  );
  if (head === null) {
    // the query itself failed (see the "saved move FAILED" log above);
    // do not report that as "goal not found"
    throw new Error(
      "loadSavedMove: graph query failed, see [mission-graph] logs",
    );
  }
  const h = head[0];
  if (!h) {
    await diagnoseSavedMove(graph, developerId, goalId);
    return null;
  }
  const moveId = str(h.id);

  const [focus, cap, start, strengths, gaps, demos, files] = await Promise.all([
    query(
      graph,
      "move focus",
      `MATCH (:NextMove {id: $id})-[:FOCUSES_ON]->(t:Topic) RETURN t.slug AS slug LIMIT 1`,
      { id: moveId },
      spec("focus", "(NextMove)-[:FOCUSES_ON]->(Topic)"),
    ),
    query(
      graph,
      "move capability",
      `MATCH (:NextMove {id: $id})-[:ADVANCES]->(c:Capability)
       RETURN c.id AS id, coalesce(c.name, c.id) AS name LIMIT 1`,
      { id: moveId },
      spec("capability", "(NextMove)-[:ADVANCES]->(Capability)"),
    ),
    query(
      graph,
      "move start file",
      `MATCH (:NextMove {id: $id})-[:STARTS_AT]->(f:FileChange) RETURN f.id AS id LIMIT 1`,
      { id: moveId },
      spec("start_file", "(NextMove)-[:STARTS_AT]->(FileChange)"),
    ),
    query(
      graph,
      "move strengths",
      `MATCH (:NextMove {id: $id})-[:LEVERAGES]->(t:Topic) RETURN t.slug AS slug`,
      { id: moveId },
      spec("strengths", "(NextMove)-[:LEVERAGES]->(Topic)"),
    ),
    query(
      graph,
      "move gaps",
      `MATCH (:NextMove {id: $id})-[:CLOSES_GAP_IN]->(t:Topic) RETURN t.slug AS slug`,
      { id: moveId },
      spec("gaps", "(NextMove)-[:CLOSES_GAP_IN]->(Topic)"),
    ),
    query(
      graph,
      "move demonstrations",
      `
      MATCH (:NextMove {id: $id})-[b:BACKED_BY]->(x:Demonstration)
      OPTIONAL MATCH (x)-[:IN_REPOSITORY]->(r:Repository)
      RETURN coalesce(b.ref, "") AS ref, x.id AS id,
             coalesce(r.full_name, r.name, "") AS repository,
             coalesce(x.path, "") AS path,
             coalesce(x.commit_sha, "") AS commit_sha,
             coalesce(x.technique, "") AS technique,
             coalesce(x.summary, "") AS summary,
             coalesce(x.permalink, "") AS permalink
      `,
      { id: moveId },
      spec(
        "evidence",
        "(NextMove)-[:BACKED_BY]->(Demonstration)-[:IN_REPOSITORY]->(Repository)",
      ),
    ),
    query(
      graph,
      "move file changes",
      `MATCH (:NextMove {id: $id})-[b:BACKED_BY]->(f:FileChange)
       RETURN coalesce(b.ref, "") AS ref, f.id AS id`,
      { id: moveId },
      spec("evidence_files", "(NextMove)-[:BACKED_BY]->(FileChange)"),
    ),
  ]);

  log("saved move loaded", {
    goalId,
    nextMoveId: moveId,
    focus: focus?.[0]?.slug ?? null,
    capability: cap?.[0]?.id ?? null,
    startFile: start?.[0]?.id ?? null,
    strengths: strengths?.length ?? 0,
    gaps: gaps?.length ?? 0,
    demonstrations: demos?.length ?? 0,
    fileChanges: files?.length ?? 0,
  });

  trace.sort((a, b) => STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step));

  const fileByRef = new Map((files ?? []).map((r) => [str(r.ref), str(r.id)]));
  const createdAt = str(h.created_at);
  const title = str(h.title);

  return {
    developerId,
    goalId,
    wish: str(h.wish),
    nextMoveId: moveId,
    moveVersion: sha8(`${moveId}|${createdAt}|${title}`),
    title,
    summary: str(h.summary),
    doneWhen: str(h.done_when),
    createdAt,
    details: parseJson<Row>(h.details, {}),
    focusSlug: focus?.[0] ? str(focus[0].slug) : null,
    capability: cap?.[0]
      ? { id: str(cap[0].id), name: str(cap[0].name) }
      : null,
    startFileChangeId: start?.[0] ? str(start[0].id) : null,
    strengthSlugs: (strengths ?? []).map((r) => str(r.slug)).filter(Boolean),
    gapSlugs: (gaps ?? []).map((r) => str(r.slug)).filter(Boolean),
    evidence: (demos ?? []).map((r) => ({
      ref: str(r.ref),
      demonstrationId: str(r.id),
      fileChangeId: fileByRef.get(str(r.ref)) ?? "",
      repository: str(r.repository),
      path: str(r.path),
      commitSha: str(r.commit_sha),
      technique: str(r.technique),
      summary: str(r.summary).slice(0, 300),
      permalink: str(r.permalink),
    })),
    trace,
  };
}

// ------------------------------------------------------------
// missions: read
// ------------------------------------------------------------

const MISSION_COLS = `
  m.id AS id, coalesce(m.goal_id, "") AS goal_id,
  coalesce(m.developer_id, "") AS developer_id,
  coalesce(m.next_move_id, "") AS next_move_id,
  coalesce(m.move_version, "") AS move_version,
  coalesce(m.status, "proposed") AS status,
  coalesce(m.capability_id, "") AS capability_id,
  coalesce(m.focus_slug, "") AS focus_slug,
  coalesce(m.spec_json, "") AS spec, coalesce(m.pin_json, "") AS pin,
  coalesce(m.explanation_json, "") AS explanation,
  coalesce(m.fork_repository, "") AS fork_repository,
  coalesce(m.work_branch, "") AS work_branch,
  coalesce(m.created_at, "") AS created_at,
  coalesce(m.started_at, "") AS started_at,
  coalesce(m.submitted_head, "") AS submitted_head,
  coalesce(m.completed_at, "") AS completed_at
`;

function rowToMission(r: Row): StoredMission | null {
  const spec = parseJson<MissionSpec | null>(r.spec, null);
  const pin = parseJson<MissionRepoPin | null>(r.pin, null);
  if (!spec || !pin) {
    log("mission row skipped: spec_json or pin_json missing/invalid", {
      id: str(r.id),
      hasSpec: Boolean(spec),
      hasPin: Boolean(pin),
    });
    return null;
  }
  return {
    id: str(r.id),
    goalId: str(r.goal_id),
    developerId: str(r.developer_id),
    nextMoveId: str(r.next_move_id),
    moveVersion: str(r.move_version),
    status: (str(r.status) || "proposed") as MissionStatus,
    capabilityId: str(r.capability_id) || null,
    focusSlug: str(r.focus_slug) || null,
    spec,
    pin,
    explanation: parseJson<MissionExplanation | null>(r.explanation, null),
    forkRepository: str(r.fork_repository),
    workBranch: str(r.work_branch),
    createdAt: str(r.created_at),
    startedAt: str(r.started_at),
    submittedHead: str(r.submitted_head),
    completedAt: str(r.completed_at),
  };
}

export async function loadMission(
  graph: Graph,
  developerId: string,
  missionId: string,
): Promise<StoredMission | null> {
  const rows = await query(
    graph,
    "load mission",
    `MATCH (:Developer {id: $dev})-[:ASSIGNED]->(m:Mission {id: $id})
     RETURN ${MISSION_COLS} LIMIT 1`,
    { dev: developerId, id: missionId },
  );
  return rows?.[0] ? rowToMission(rows[0]) : null;
}

/** All missions of a goal, newest first (used for idempotency and duplicate checks). */
export async function listGoalMissions(
  graph: Graph,
  developerId: string,
  goalId: string,
): Promise<StoredMission[]> {
  const rows = await query(
    graph,
    "list goal missions",
    `MATCH (:Goal {id: $goal_id})-[:HAS_MISSION]->(m:Mission)
     WHERE m.developer_id = $dev
     RETURN ${MISSION_COLS}
     ORDER BY m.created_at DESC`,
    { dev: developerId, goal_id: goalId },
  );
  return (rows ?? [])
    .map(rowToMission)
    .filter((m): m is StoredMission => m !== null);
}

// ------------------------------------------------------------
// missions: write
// ------------------------------------------------------------

/** The most recent Evaluation of a mission (demonstration is not stored on the node, so it is null). */
export async function loadLatestEvaluation(
  graph: Graph,
  developerId: string,
  missionId: string,
): Promise<EvaluationRecord | null> {
  const rows = await query(
    graph,
    "latest evaluation",
    `MATCH (:Developer {id: $dev})-[:ASSIGNED]->(:Mission {id: $id})-[:EVALUATED_AS]->(e:Evaluation)
     RETURN coalesce(e.verdict, "needs_work") AS verdict,
            coalesce(e.head_commit, "") AS head,
            coalesce(e.ci_state, "none") AS ci,
            coalesce(e.summary, "") AS summary,
            coalesce(e.results_json, "[]") AS results,
            coalesce(e.scope_warnings_json, "[]") AS warnings,
            coalesce(e.changed_files_json, "[]") AS files
     ORDER BY e.created_at DESC
     LIMIT 1`,
    { dev: developerId, id: missionId },
  );
  const r = rows?.[0];
  if (!r) return null;
  return {
    missionId,
    developerId,
    headCommit: str(r.head),
    verdict: str(r.verdict) === "completed" ? "completed" : "needs_work",
    ciState: (str(r.ci) || "none") as EvaluationRecord["ciState"],
    results: parseJson<CriterionResult[]>(r.results, []),
    scopeWarnings: parseJson<string[]>(r.warnings, []),
    changedFiles: parseJson<string[]>(r.files, []),
    summary: str(r.summary),
    demonstration: null,
  };
}

export function newMissionId(
  goalId: string,
  moveVersion: string,
  sequence: number,
): string {
  return `mission:${goalId}:${moveVersion}:${sequence}`;
}

/**
 * Persists the Mission and links it to the goal, the move it came from, the
 * capability it advances, the code it starts from and the evidence it cites.
 * Only ids that exist in the saved move are linked; anything else is reported.
 * `explanation` is stored as-is: it must contain only executed queries and
 * inspected code.
 */
export async function storeMission(
  graph: Graph,
  saved: SavedMove,
  missionId: string,
  spec: MissionSpec,
  pin: MissionRepoPin,
  explanation: MissionExplanation | null = null,
): Promise<MissionStored> {
  const rejected: string[] = [];
  const links = {
    goal: 0,
    developer: 0,
    move: 0,
    capability: 0,
    focus: 0,
    startFile: 0,
    demonstrations: 0,
    repository: 0,
  };
  const empty: MissionStored = { stored: false, missionId, links, rejected };
  const now = new Date().toISOString();

  const capabilityId =
    saved.capability &&
    spec.expectedSkills.every(
      (s) => !s.capabilityId || s.capabilityId === saved.capability?.id,
    )
      ? saved.capability.id
      : "";

  const created = await query(
    graph,
    "create mission",
    `
    MATCH (d:Developer {id: $dev})
    MATCH (g:Goal {id: $goal_id})
    MERGE (m:Mission {id: $id})
    SET m.developer_id = $dev, m.goal_id = $goal_id,
        m.next_move_id = $move_id, m.move_version = $version,
        m.move_title = $move_title, m.move_done_when = $move_done_when,
        m.status = "proposed",
        m.title = $title, m.objective = $objective, m.summary = $summary,
        m.repository = $repo, m.branch = $branch, m.base_commit = $base,
        m.start_path = $start, m.test_command = $test_command,
        m.capability_id = $capability_id, m.focus_slug = $focus,
        m.spec_json = $spec, m.pin_json = $pin,
        m.explanation_json = $explanation,
        m.created_at = $now, m.updated_at = $now
    MERGE (g)-[:HAS_MISSION]->(m)
    MERGE (d)-[:ASSIGNED]->(m)
    RETURN count(m) AS n
    `,
    {
      dev: saved.developerId,
      goal_id: saved.goalId,
      id: missionId,
      move_id: saved.nextMoveId,
      version: saved.moveVersion,
      move_title: saved.title.slice(0, 200),
      move_done_when: saved.doneWhen.slice(0, 400),
      title: spec.title.slice(0, 200),
      objective: spec.objective.slice(0, 400),
      summary: spec.summary.slice(0, 1200),
      repo: pin.repository,
      branch: pin.branch,
      base: pin.baseCommit,
      start: spec.scope.startPath,
      test_command: pin.testCommand ?? "",
      capability_id: capabilityId,
      focus: saved.focusSlug ?? "",
      spec: JSON.stringify(spec),
      pin: JSON.stringify(pin),
      explanation: explanation ? JSON.stringify(explanation) : "",
      now,
    },
  );
  if (!created || num(created[0]?.n) === 0) {
    rejected.push("Developer or Goal node not found, nothing was written");
    return empty;
  }
  links.goal = 1;
  links.developer = 1;

  links.move = await count(
    graph,
    "FROM_MOVE",
    `MATCH (m:Mission {id: $id}) MATCH (n:NextMove {id: $move_id})
     MERGE (m)-[r:FROM_MOVE]->(n) RETURN count(r) AS n`,
    { id: missionId, move_id: saved.nextMoveId },
  );

  if (capabilityId)
    links.capability = await count(
      graph,
      "ADVANCES",
      `MATCH (m:Mission {id: $id}) MATCH (c:Capability {id: $cid})
       MERGE (m)-[r:ADVANCES]->(c) RETURN count(r) AS n`,
      { id: missionId, cid: capabilityId },
    );
  else if (saved.capability)
    rejected.push(
      "capability not linked: expectedSkills disagree with the move",
    );

  if (saved.focusSlug)
    links.focus = await count(
      graph,
      "FOCUSES_ON",
      `MATCH (m:Mission {id: $id}) MATCH (t:Topic {slug: $slug})
       MERGE (m)-[r:FOCUSES_ON]->(t) RETURN count(r) AS n`,
      { id: missionId, slug: saved.focusSlug },
    );

  if (saved.startFileChangeId)
    links.startFile = await count(
      graph,
      "STARTS_AT",
      `MATCH (m:Mission {id: $id}) MATCH (f:FileChange {id: $fid})
       MERGE (m)-[r:STARTS_AT]->(f) RETURN count(r) AS n`,
      { id: missionId, fid: saved.startFileChangeId },
    );

  const cited = new Set(spec.grounding.evidenceIds);
  const batch = saved.evidence
    .filter((e) => cited.has(e.ref) && e.demonstrationId)
    .map((e) => ({ id: e.demonstrationId, ref: e.ref }));
  if (batch.length)
    links.demonstrations = await count(
      graph,
      "BACKED_BY",
      `UNWIND $batch AS item
       MATCH (m:Mission {id: $id})
       MATCH (x:Demonstration {id: item.id})
       MERGE (m)-[r:BACKED_BY]->(x)
       SET r.ref = item.ref
       RETURN count(r) AS n`,
      { id: missionId, batch },
    );
  if (links.demonstrations < batch.length)
    rejected.push(
      `${batch.length - links.demonstrations} cited demonstration(s) no longer exist in the graph`,
    );

  links.repository = await count(
    graph,
    "IN_REPOSITORY",
    `MATCH (m:Mission {id: $id})
     MATCH (r:Repository)
     WHERE r.full_name = $repo OR r.name = $repo
     WITH m, r LIMIT 1
     MERGE (m)-[e:IN_REPOSITORY]->(r)
     RETURN count(e) AS n`,
    { id: missionId, repo: pin.repository },
  );

  log("mission stored", { missionId, ...links, rejected: rejected.length });
  return { stored: true, missionId, links, rejected };
}

export async function markStarted(
  graph: Graph,
  developerId: string,
  missionId: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  return (
    (await count(
      graph,
      "mission started",
      `MATCH (:Developer {id: $dev})-[:ASSIGNED]->(m:Mission {id: $id})
       SET m.status = "in_progress", m.started_at = $now, m.updated_at = $now
       RETURN count(m) AS n`,
      { dev: developerId, id: missionId, now },
    )) > 0
  );
}

export async function markSubmitted(
  graph: Graph,
  developerId: string,
  missionId: string,
  head: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  return (
    (await count(
      graph,
      "mission submitted",
      `MATCH (:Developer {id: $dev})-[:ASSIGNED]->(m:Mission {id: $id})
       SET m.status = "submitted", m.submitted_head = $head,
           m.submitted_at = $now, m.updated_at = $now
       RETURN count(m) AS n`,
      { dev: developerId, id: missionId, head, now },
    )) > 0
  );
}

export async function markAbandoned(
  graph: Graph,
  developerId: string,
  missionId: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  return (
    (await count(
      graph,
      "mission abandoned",
      `MATCH (:Developer {id: $dev})-[:ASSIGNED]->(m:Mission {id: $id})
       SET m.status = "abandoned", m.updated_at = $now
       RETURN count(m) AS n`,
      { dev: developerId, id: missionId, now },
    )) > 0
  );
}

/**
 * Stores the Evaluation, updates the mission status and, only for a completed
 * mission, records one Demonstration so the developer's depth evidence grows.
 * The demonstration depth is always "working": a single mission never claims more.
 */
export async function recordEvaluation(
  graph: Graph,
  mission: StoredMission,
  ev: EvaluationRecord,
): Promise<{
  stored: boolean;
  evaluationId: string;
  demonstrationId: string | null;
}> {
  const now = new Date().toISOString();
  const evaluationId = `evaluation:${mission.id}:${sha8(ev.headCommit)}`;

  const wrote = await count(
    graph,
    "create evaluation",
    `
    MATCH (m:Mission {id: $mid})
    MERGE (e:Evaluation {id: $eid})
    SET e.mission_id = $mid, e.developer_id = $dev, e.verdict = $verdict,
        e.head_commit = $head, e.ci_state = $ci, e.summary = $summary,
        e.results_json = $results, e.scope_warnings_json = $warnings,
        e.changed_files_json = $files, e.created_at = $now
    MERGE (m)-[:EVALUATED_AS]->(e)
    RETURN count(e) AS n
    `,
    {
      mid: mission.id,
      eid: evaluationId,
      dev: mission.developerId,
      verdict: ev.verdict,
      head: ev.headCommit,
      ci: ev.ciState,
      summary: ev.summary.slice(0, 1200),
      results: JSON.stringify(ev.results).slice(0, 8000),
      warnings: JSON.stringify(ev.scopeWarnings).slice(0, 2000),
      files: JSON.stringify(ev.changedFiles).slice(0, 4000),
      now,
    },
  );
  if (!wrote) return { stored: false, evaluationId, demonstrationId: null };

  await query(
    graph,
    "update mission status",
    `MATCH (m:Mission {id: $mid})
     SET m.status = $status, m.submitted_head = $head, m.updated_at = $now,
         m.completed_at = $completed
     RETURN count(m) AS n`,
    {
      mid: mission.id,
      status: ev.verdict,
      head: ev.headCommit,
      now,
      completed: ev.verdict === "completed" ? now : "",
    },
  );

  let demonstrationId: string | null = null;
  if (ev.verdict === "completed" && ev.demonstration) {
    const d = ev.demonstration;
    demonstrationId = `demo:${mission.id}`;
    const ok = await count(
      graph,
      "create demonstration",
      `
      MATCH (dev:Developer {id: $dev})
      MATCH (c:Capability {id: $cid})
      MERGE (x:Demonstration {id: $xid})
      SET x.technique = $technique, x.summary = $summary,
          x.depth = $depth, x.depth_rank = 2,
          x.path = $path, x.commit_sha = $sha, x.commit_subject = $subject,
          x.permalink = $permalink, x.modifiers = "",
          x.source = "mission", x.mission_id = $mid, x.created_at = $now
      MERGE (dev)-[:DEMONSTRATED]->(x)
      MERGE (x)-[:OF_CAPABILITY]->(c)
      RETURN count(x) AS n
      `,
      {
        dev: mission.developerId,
        cid: d.capabilityId,
        xid: demonstrationId,
        technique: d.technique.slice(0, 200),
        summary: d.summary.slice(0, 300),
        depth: d.depth,
        path: d.path,
        sha: ev.headCommit,
        subject: d.commitSubject.slice(0, 160),
        permalink: d.permalink,
        mid: mission.id,
        now,
      },
    );
    if (!ok) demonstrationId = null;
    else
      await query(
        graph,
        "demonstration repository",
        `MATCH (x:Demonstration {id: $xid})
         MATCH (r:Repository)
         WHERE r.full_name = $repo OR r.name = $repo
         WITH x, r LIMIT 1
         MERGE (x)-[e:IN_REPOSITORY]->(r)
         RETURN count(e) AS n`,
        { xid: demonstrationId, repo: mission.pin.repository },
      );
  }

  log("evaluation recorded", {
    missionId: mission.id,
    verdict: ev.verdict,
    demonstration: demonstrationId,
  });
  return { stored: true, evaluationId, demonstrationId };
}

/** Remembers the developer's fork + working branch on the Mission node. */
export async function saveWorkspace(
  graph: Graph,
  developerId: string,
  missionId: string,
  ws: { forkRepository: string; branch: string },
): Promise<boolean> {
  const now = new Date().toISOString();
  return (
    (await count(
      graph,
      "mission workspace",
      `MATCH (:Developer {id: $dev})-[:ASSIGNED]->(m:Mission {id: $id})
       SET m.fork_repository = $fork, m.work_branch = $branch, m.updated_at = $now
       RETURN count(m) AS n`,
      {
        dev: developerId,
        id: missionId,
        fork: ws.forkRepository,
        branch: ws.branch,
        now,
      },
    )) > 0
  );
}
