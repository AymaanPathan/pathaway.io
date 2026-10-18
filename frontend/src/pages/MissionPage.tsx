/* eslint-disable react-hooks/immutability */
/* eslint-disable react-hooks/refs */
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Check,
  Copy,
  GitBranch,
  GitCommit,
  Play,
  RefreshCw,
  Send,
  Trash2,
  X,
  Sparkles,
  ArrowRight,
} from "lucide-react";

/* ---------- tokens ---------- */
const YELLOW = "#F5C542";
const GREEN = "#3FA24A";
const LIGHT_GREEN = "#E4F3E5";
const SOFT_CORAL = "#FFE3DA";
const CREAM = "#FBF3D6";
const LAVENDER = "#D8D0F2";
const RED = "#a12c10";
const INK = "#101210";
const PAPER = "#F1EEE7";
const LINE = "#DAD6CC";
const MUTED = "#6f6b61";
const DISPLAY = '"Space Grotesk", "Arial Black", sans-serif';
const BODY = '"Inter", "Helvetica Neue", sans-serif';
const MONO = '"JetBrains Mono", "Fira Code", ui-monospace, Menlo, monospace';
const border = { border: `2px solid ${INK}` };
const shadow = (n = 3) => `${n}px ${n}px 0 0 ${INK}`;

/* routes (App.tsx): the goal page lives at /next */
const GOAL_ROUTE = "/goal";
const GOAL_STORE_KEY = "pathway:goal-result";
const API = "/api/missions";
const COMMIT_POLL_MS = 15_000;
const RUN_POLL_MS = 1_500;

/* editor palette */
const ED = {
  bg: "#0f1420",
  num: "#46506a",
  text: "#d6deeb",
  comment: "#6b7694",
  string: "#C3E88D",
  keyword: "#C792EA",
  fn: "#82AAFF",
  number: "#F78C6C",
};

/* ---------- API types (mirror the backend) ---------- */
type Status =
  | "proposed"
  | "in_progress"
  | "submitted"
  | "completed"
  | "needs_work"
  | "abandoned";

type Criterion = {
  id: string;
  description: string;
  check: "test" | "command" | "review";
  how: string;
};

type Contract = {
  library: string | null;
  decisions: Array<{ topic: string; decision: string }>;
};

type Spec = {
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
  criteria: Criterion[];
  verify: { testFile: string | null; command: string | null };
  expectedSkills: Array<{ capabilityId: string | null; evidence: string }>;
  grounding: {
    evidenceIds: string[];
    observedNow: string;
    gapStillOpen: string;
  };
  contract?: Contract;
  estimatedMinutes: number;
};

type Pin = {
  repository: string;
  branch: string;
  baseCommit: string;
  packageRoot: string;
  packageManager: string;
  testRunner: string;
  testCommand: string | null;
};

type TraceEntry = {
  step: string;
  label: string;
  relationship: string;
  cypher: string;
  params: Record<string, string>;
  rows: number | null;
  ms: number;
  sample: string[];
  error?: string;
};

type ExplEvidence = {
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
  verifiedAtCommit: boolean | null;
  excerpt: string;
};

type GapCheck = {
  terms: string[];
  status: "contradicted" | "weak_signal" | "not_found_in_scope" | "unverified";
  dependencyHits: string[];
  startFileHits: string[];
  pathHits: string[];
  contradictingTerms: string[];
  scope: string;
};

type Explanation = {
  generatedAt: string;
  trace: TraceEntry[];
  evidence: ExplEvidence[];
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
    alternatives: "not_recorded";
    note: string;
  };
  proves: string[];
  doesNotProve: string[];
};

type Mission = {
  id: string;
  goalId: string;
  status: Status;
  capabilityId: string | null;
  focusSlug: string | null;
  spec: Spec;
  pin: Pin;
  explanation: Explanation | null;
  forkRepository?: string | null;
  createdAt: string;
  startedAt: string;
  submittedHead: string;
  completedAt: string;
};

type CriterionResult = {
  id: string;
  met: boolean;
  verified: boolean;
  quote: string;
  reasoning: string;
};

/** Persisted evaluation (GET /:id/evaluation), used for the Test cases tab after a reload. */
type Evaluation = {
  missionId: string;
  headCommit: string;
  verdict: "completed" | "needs_work";
  ciState: "success" | "failure" | "pending" | "none";
  results: CriterionResult[];
  scopeWarnings: string[];
  changedFiles: string[];
  summary: string;
};

/* ---- sandbox evaluation run ---- */
type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

type RunStep = {
  id: string;
  label: string;
  status: StepStatus;
  detail: string;
  command: string;
};

type TestCase = {
  id: string | null;
  name: string;
  status: "passed" | "failed" | "skipped";
  message: string;
};

type Outcome = {
  verdict: "completed" | "needs_work";
  results: CriterionResult[];
  tests: TestCase[];
  gates: {
    missionTestRan: boolean;
    developerTestWritten: boolean;
    developerTestsPassed: boolean | null;
  };
  issues: Array<{ title: string; detail: string; file?: string }>;
  nextSteps: string[];
  summary: string;
};

type GraphUpdateState = {
  status: "running" | "completed" | "failed";
  stagesCompleted: string[];
  failedStage: string | null;
  attempts: number;
  lastError: string;
};

type LearningPipelineResult = {
  detected: number;
  reviewed: number;
  accepted: number;
  skippedExisting: number;
  repairedExisting?: number;
  rejected: Array<{ demonstrationId: string; reason: string }>;
  experiencesUpdated: number;
  capabilityRollupsUpdated: number;
};

type MissionLearningResult = {
  evaluationStored: boolean;
  verification?: { verified: boolean; reasons: string[] };
  evidenceStatus:
    | "updated"
    | "not_verified"
    | "no_evidence"
    | "repository_missing"
    | "graph_update_failed";
  learning: LearningPipelineResult | null;
  graphUpdate?: GraphUpdateState | null;
};

type RunView = {
  runId: string;
  missionId: string;
  status: "running" | "needs_env" | "done" | "error";
  head: string;
  headSha: string;
  steps: RunStep[];
  envRequest: Array<{ name: string; reason: string }>;
  envInfo: { filled: string[]; provided: string[] };
  outcome: Outcome | null;
  /** Backend result from the verified mission-to-knowledge-graph pipeline. */
  learning?: MissionLearningResult | null;
  testCode: string;
  infra: boolean;
  error: string;
  log: string;
  startedAt: string;
  durationMs: number;
};

type RunResponse = {
  status: string;
  message?: string;
  run?: RunView;
  missing?: string[];
};

type CreateResponse = {
  status: string;
  mission: Mission | null;
  reason: string;
  errors: string[];
};

type Workspace = { forkRepository: string; branch: string };

type WorkspaceResponse = {
  ok: boolean;
  reason: string;
  forkRepository: string;
  branch: string;
  error?: string;
};

type BranchCommit = {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
};

type CommitsResponse = {
  ok: boolean;
  status: string;
  reason: string;
  forkRepository: string;
  branch: string;
  baseCommit: string;
  aheadBy: number;
  compareUrl: string;
  commits: BranchCommit[];
};

type Phase = "loading" | "generating" | "ready" | "empty" | "error";
type Tab = "checks" | "steps" | "why" | "commits" | "evaluate";
const TAB_ORDER: Tab[] = ["checks", "steps", "why", "commits", "evaluate"];
const TAB_LABEL: Record<Tab, string> = {
  checks: "Test cases",
  steps: "Steps",
  why: "Why this mission",
  commits: "Commits",
  evaluate: "Evaluation",
};

type PageError = {
  title: string;
  reason: string;
  errors: string[];
  retry: boolean;
};

const CREATE_ERROR: Record<string, { title: string; retry: boolean }> = {
  goal_not_found: { title: "Goal not found", retry: false },
  needs_replan: { title: "This goal is out of date", retry: false },
  repository_unavailable: {
    title: "Couldn't read your repository",
    retry: true,
  },
  llm_unavailable: { title: "The mission agent is unavailable", retry: true },
  generation_failed: {
    title: "Couldn't write a verified mission",
    retry: true,
  },
  store_failed: { title: "Couldn't save the mission", retry: true },
};

const STATUS_META: Record<Status, { label: string; fill: string }> = {
  proposed: { label: "Ready to start", fill: YELLOW },
  in_progress: { label: "In progress", fill: LAVENDER },
  submitted: { label: "Submitted", fill: CREAM },
  completed: { label: "Completed", fill: LIGHT_GREEN },
  needs_work: { label: "Needs work", fill: SOFT_CORAL },
  abandoned: { label: "Discarded", fill: "#fff" },
};

const GAP_META: Record<GapCheck["status"], { label: string; fill: string }> = {
  contradicted: { label: "Contradicted by the repo", fill: SOFT_CORAL },
  weak_signal: { label: "Related code exists", fill: CREAM },
  not_found_in_scope: {
    label: "Not found in scanned scope",
    fill: LIGHT_GREEN,
  },
  unverified: { label: "Unverified", fill: CREAM },
};

const CSS = `
.pm-btn:focus-visible,.pm-link:focus-visible,.pm-input:focus-visible{outline:3px solid ${INK};outline-offset:2px}
.pm-btn:disabled{opacity:.5;cursor:not-allowed}
.pm-code::-webkit-scrollbar{height:10px;width:10px}
.pm-code::-webkit-scrollbar-thumb{background:#2b3550;border-radius:6px}
details > summary{list-style:none}
details > summary::-webkit-details-marker{display:none}
details > summary::before{content:"▸ ";}
details[open] > summary::before{content:"▾ ";}
@keyframes pm-pop{0%{transform:scale(.97);opacity:0}60%{transform:scale(1.01)}100%{transform:none;opacity:1}}
.pm-pop{animation:pm-pop .45s ease-out both}
@keyframes pm-reveal{0%{transform:translateX(-6px);opacity:0}100%{transform:none;opacity:1}}
.pm-reveal{animation:pm-reveal .35s ease-out both}
@keyframes gr-backdrop{from{opacity:0}to{opacity:1}}
@keyframes gr-draw{to{stroke-dashoffset:0}}
@keyframes gr-node{0%{opacity:0;transform:scale(.6)}65%{opacity:1;transform:scale(1.06)}100%{opacity:1;transform:scale(1)}}
@keyframes gr-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes gr-ring{0%{transform:scale(1);opacity:.7}100%{transform:scale(1.9);opacity:0}}
.gr-backdrop{animation:gr-backdrop .25s ease-out both}
.gr-edge{stroke-dasharray:1;stroke-dashoffset:1;animation:gr-draw .55s ease-out forwards}
.gr-node{opacity:0;transform-box:fill-box;transform-origin:center;animation:gr-node .45s cubic-bezier(.2,1.3,.4,1) forwards}
.gr-rise{opacity:0;animation:gr-rise .45s ease-out forwards}
.gr-ring{transform-box:fill-box;transform-origin:center;animation:gr-ring 1.4s ease-out 2}
@media (prefers-reduced-motion: reduce){.pm-pop,.pm-reveal,.gr-backdrop,.gr-edge,.gr-node,.gr-rise,.gr-ring{animation:none!important;opacity:1;stroke-dashoffset:0}}
`;

/* ---------- helpers ---------- */
const short = (sha: string) => sha.slice(0, 7);
const pretty = (s: string) => s.replace(/[_-]+/g, " ");
const isLive = (r: RunView | null) =>
  r?.status === "running" || r?.status === "needs_env";

function ago(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: T | null }> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = (await res.json().catch(() => null)) as T | null;
  return { ok: res.ok, status: res.status, body };
}

/** The goal page keeps its result in sessionStorage; use it when opened without params. */
function storedGoalId(): string {
  try {
    const raw = sessionStorage.getItem(GOAL_STORE_KEY);
    const id = raw ? JSON.parse(raw)?.goal?.id : "";
    return typeof id === "string" ? id : "";
  } catch {
    return "";
  }
}

/* ---------- tiny syntax highlighter ---------- */
const KEYWORDS =
  "import|from|export|default|const|let|var|function|async|await|return|if|else|for|while|new|class|extends|try|catch|throw|describe|it|test|expect|beforeEach|afterEach|beforeAll|afterAll|def|assert|with|as|in|not|and|or|None|True|False|null|undefined|true|false|self";
const TOKEN = new RegExp(
  `(\\/\\/.*|#.*)|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|\\b(${KEYWORDS})\\b|\\b(\\d+(?:\\.\\d+)?)\\b|([A-Za-z_$][\\w$]*)(?=\\()`,
  "g",
);

function highlight(line: string) {
  const out: { t: string; c: string }[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ t: line.slice(last, i), c: ED.text });
    const c = m[1]
      ? ED.comment
      : m[2]
        ? ED.string
        : m[3]
          ? ED.keyword
          : m[4]
            ? ED.number
            : ED.fn;
    out.push({ t: m[0], c });
    last = i + m[0].length;
  }
  if (last < line.length) out.push({ t: line.slice(last), c: ED.text });
  return out;
}

function CodeView({
  content,
  plain = false,
  maxH = 260,
  label = "Code",
}: {
  content: string;
  plain?: boolean;
  maxH?: number;
  label?: string;
}) {
  const lines = useMemo(
    () => content.replace(/\n$/, "").split("\n"),
    [content],
  );
  return (
    <pre
      className="pm-code m-0 overflow-auto rounded-lg py-3 text-[12.5px] leading-[1.7]"
      style={{
        fontFamily: MONO,
        backgroundColor: ED.bg,
        tabSize: 2,
        maxHeight: maxH,
      }}
      tabIndex={0}
      aria-label={label}
    >
      {lines.map((l, i) => (
        <div key={i} className="flex min-w-max">
          {!plain && (
            <span
              className="sticky left-0 shrink-0 select-none pl-3 pr-3 text-right"
              style={{ color: ED.num, backgroundColor: ED.bg, minWidth: "3ch" }}
            >
              {i + 1}
            </span>
          )}
          <code className={`whitespace-pre pr-5 ${plain ? "pl-4" : ""}`}>
            {l === "" ? (
              " "
            ) : plain ? (
              <span style={{ color: l.startsWith("#") ? ED.comment : ED.text }}>
                {l}
              </span>
            ) : (
              highlight(l).map((tk, j) => (
                <span key={j} style={{ color: tk.c }}>
                  {tk.t}
                </span>
              ))
            )}
          </code>
        </div>
      ))}
    </pre>
  );
}

/* ---------- pieces ---------- */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="py-4" style={{ borderTop: `1px solid ${LINE}` }}>
      <h3
        style={{ fontFamily: DISPLAY }}
        className="mb-2 text-[15px] font-bold"
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function Chip({
  children,
  fill = "#fff",
  mono = false,
}: {
  children: ReactNode;
  fill?: string;
  mono?: boolean;
}) {
  return (
    <span
      style={{
        backgroundColor: fill,
        border: `1.5px solid ${INK}`,
        fontFamily: mono ? MONO : undefined,
      }}
      className="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold leading-snug"
    >
      {children}
    </span>
  );
}

function StateCard({
  title,
  children,
  tone,
}: {
  title: string;
  children: ReactNode;
  tone?: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div
        style={{ ...border, backgroundColor: "#fff", boxShadow: shadow(5) }}
        className="w-full max-w-[560px] rounded-2xl p-8"
      >
        <h1
          style={{ fontFamily: DISPLAY, color: tone ?? INK }}
          className="text-[26px] font-bold leading-tight"
        >
          {title}
        </h1>
        {children}
      </div>
    </div>
  );
}

function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      style={border}
      className="pm-btn inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[12px] font-semibold"
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
      {done ? "Copied" : label}
    </button>
  );
}

function CriterionCard({
  index,
  criterion,
  result,
}: {
  index: number;
  criterion: Criterion;
  result?: CriterionResult;
}) {
  const passed = result?.met === true;
  const failed = result !== undefined && !passed;
  const mark = passed ? "✓" : failed ? "✕" : "○";
  return (
    <div
      style={{
        ...border,
        backgroundColor: "#fff",
        ...(passed && { borderColor: GREEN }),
        ...(failed && { borderColor: RED }),
      }}
      className={`rounded-xl p-4 ${passed ? "pm-pop" : ""}`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-label={passed ? "met" : failed ? "not met" : "not evaluated yet"}
          className="mt-0.5 text-[15px] font-bold"
          style={{ color: passed ? GREEN : failed ? RED : INK }}
        >
          {mark}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              style={{ fontFamily: DISPLAY }}
              className="text-[15px] font-bold"
            >
              Test case {index + 1}
            </span>
            <Chip fill={LAVENDER}>we run it</Chip>
          </div>
          <p className="mt-1 text-[14px] leading-snug">
            {criterion.description}
          </p>
          <p
            className="mt-1.5 text-[12px] leading-snug"
            style={{ color: MUTED }}
          >
            Test we run: {criterion.how}
          </p>
          {result && (
            <div className="mt-2.5 space-y-1.5">
              <p
                className="whitespace-pre-line text-[12.5px] leading-snug"
                style={{ color: passed ? "#2c6e34" : RED }}
              >
                {result.reasoning}
              </p>
              {result.quote && (
                <code
                  style={{
                    fontFamily: MONO,
                    backgroundColor: ED.bg,
                    color: ED.string,
                  }}
                  className="block overflow-x-auto whitespace-pre rounded-md px-3 py-2 text-[12px]"
                >
                  + {result.quote}
                </code>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Which files the developer works on: the implementation only, never tests. */
function FilesCard({ spec }: { spec: Spec }) {
  const rows = [
    ...spec.scope.modifyPaths.map((p) => ({ p, kind: "edit" as const })),
    ...spec.scope.createPaths.map((p) => ({ p, kind: "create" as const })),
  ];
  return (
    <div
      style={{ ...border, backgroundColor: "#fff" }}
      className="rounded-xl p-4"
    >
      <h3 style={{ fontFamily: DISPLAY }} className="text-[15px] font-bold">
        Files to work on
      </h3>
      <p className="mt-0.5 text-[12px]" style={{ color: MUTED }}>
        Implement the feature in these files. We run our own tests against them.
      </p>
      <ul className="mt-2 space-y-1.5">
        {rows.map(({ p, kind }) => (
          <li key={p} className="flex flex-wrap items-center gap-2">
            <Chip fill={kind === "create" ? LIGHT_GREEN : LAVENDER}>
              {kind}
            </Chip>
            <code className="text-[12.5px]" style={{ fontFamily: MONO }}>
              {p}
            </code>
            {p.toLowerCase() === spec.scope.startPath.toLowerCase() && (
              <span className="text-[12px]" style={{ color: MUTED }}>
                start here
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Delivery requirements are acceptance conditions of the whole push, not extra test cases. */
function DeliveryCard({ spec, pin }: { spec: Spec; pin: Pin }) {
  const items = [
    "You write implementation only. You do not write or run tests.",
    `Your branch starts from the pinned commit ${short(pin.baseCommit)}`,
    spec.contract?.library
      ? `Your code actually uses ${spec.contract.library}, not a local stand-in`
      : null,
    "You change only the files listed under “Files to work on”",
    "Commit and push your branch before pressing Evaluate",
  ].filter((x): x is string => Boolean(x));
  return (
    <div
      style={{ ...border, backgroundColor: CREAM }}
      className="rounded-xl p-4"
    >
      <h3 style={{ fontFamily: DISPLAY }} className="text-[15px] font-bold">
        Delivery requirements
      </h3>
      <p className="mt-0.5 text-[12px]" style={{ color: MUTED }}>
        Needed for the push to be evaluated. They are not counted as test cases.
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-snug">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

function ContractCard({ contract }: { contract: Contract }) {
  return (
    <div
      style={{ ...border, backgroundColor: "#fff" }}
      className="rounded-xl p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 style={{ fontFamily: DISPLAY }} className="text-[15px] font-bold">
          Implementation contract
        </h3>
        {contract.library && (
          <Chip fill={LAVENDER} mono>
            {contract.library}
          </Chip>
        )}
      </div>
      <p className="mt-0.5 text-[12px]" style={{ color: MUTED }}>
        Decisions already made, because our tests rely on them. You don't have
        to guess them.
      </p>
      <dl className="mt-2 space-y-2">
        {contract.decisions.map((d) => (
          <div key={d.topic}>
            <dt className="text-[12px] font-bold">{d.topic}</dt>
            <dd className="text-[13px] leading-snug">{d.decision}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function StepHeader({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        style={{ ...border, fontFamily: DISPLAY, backgroundColor: YELLOW }}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
      >
        {n}
      </span>
      <span
        className="text-[11px] font-bold uppercase tracking-wider"
        style={{ color: MUTED }}
      >
        {label}
      </span>
    </div>
  );
}

function WhyPanel({ mission }: { mission: Mission }) {
  const ex = mission.explanation;
  if (!ex)
    return (
      <p
        style={{ ...border, backgroundColor: CREAM }}
        className="rounded-xl px-4 py-3 text-[13.5px] leading-snug"
      >
        This mission was created before its reasoning was recorded, so there is
        nothing real to show. Regenerate the mission to see the queries and
        evidence behind it.
      </p>
    );

  const gap = GAP_META[ex.gapCheck.status];
  return (
    <div className="space-y-5">
      <p className="text-[12.5px] leading-snug" style={{ color: MUTED }}>
        Everything below was recorded when this mission was created. A hop
        count, algorithm name or ranking score is not shown because the backend
        did not compute one.
      </p>

      {/* 1 evidence */}
      <section
        style={{ ...border, backgroundColor: "#fff" }}
        className="space-y-3 rounded-xl p-4"
      >
        <StepHeader n={1} label="Source evidence" />
        {ex.evidence
          .filter((e) => e.cited)
          .map((e) => (
            <div key={e.ref} className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip fill={LAVENDER} mono>
                  {e.ref}
                </Chip>
                {e.commitSha && <Chip mono>@ {short(e.commitSha)}</Chip>}
                {e.verifiedAtCommit === true && (
                  <Chip fill={LIGHT_GREEN}>code found at that commit</Chip>
                )}
                {e.verifiedAtCommit === false && (
                  <Chip fill={SOFT_CORAL}>not found at that commit</Chip>
                )}
                {e.verifiedAtCommit === null && (
                  <Chip fill={CREAM}>not re-read</Chip>
                )}
              </div>
              <p className="text-[13px] leading-snug">
                {e.permalink ? (
                  <a
                    href={e.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="pm-link font-bold underline"
                    style={{ fontFamily: MONO }}
                  >
                    {e.repository ? `${e.repository}/` : ""}
                    {e.path}
                  </a>
                ) : (
                  <span style={{ fontFamily: MONO }} className="font-bold">
                    {e.repository ? `${e.repository}/` : ""}
                    {e.path}
                  </span>
                )}
                {e.technique ? ` · ${e.technique}` : ""}
              </p>
              {e.summary && (
                <p
                  className="text-[12.5px] leading-snug"
                  style={{ color: MUTED }}
                >
                  {e.summary}
                </p>
              )}
              {e.excerpt && (
                <CodeView
                  content={e.excerpt}
                  maxH={200}
                  label={`Code excerpt for ${e.ref}`}
                />
              )}
            </div>
          ))}
        <div>
          <h4
            className="mb-1.5 text-[11px] font-bold uppercase tracking-wider"
            style={{ color: MUTED }}
          >
            Same code at the pinned commit · {mission.spec.scope.startPath} @{" "}
            {short(mission.pin.baseCommit)}
          </h4>
          <CodeView
            content={mission.spec.grounding.observedNow}
            maxH={140}
            label="Observed code now"
          />
        </div>
      </section>

      {/* 2 traversal */}
      <section
        style={{ ...border, backgroundColor: "#fff" }}
        className="space-y-2.5 rounded-xl p-4"
      >
        <StepHeader n={2} label="Graph traversal (queries that ran)" />
        {ex.trace.map((t, i) => (
          <details key={`${t.step}-${i}`} className="rounded-lg px-1 py-1">
            <summary className="cursor-pointer text-[13px]">
              <span style={{ fontFamily: MONO }} className="text-[12px]">
                {t.relationship}
              </span>{" "}
              <span style={{ color: t.error ? RED : MUTED }}>
                {t.error ? "failed" : `${t.rows} row${t.rows === 1 ? "" : "s"}`}{" "}
                · {t.ms}ms
              </span>
            </summary>
            <div className="mt-1.5 space-y-1.5 pl-4">
              {t.sample.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {t.sample.map((s, j) => (
                    <Chip key={j} mono>
                      {s}
                    </Chip>
                  ))}
                </div>
              )}
              {t.error && (
                <p className="text-[12px]" style={{ color: RED }}>
                  {t.error}
                </p>
              )}
              <CodeView content={t.cypher} plain maxH={120} label="Cypher" />
            </div>
          </details>
        ))}
      </section>

      {/* 3 gap */}
      <section
        style={{ ...border, backgroundColor: "#fff" }}
        className="space-y-2.5 rounded-xl p-4"
      >
        <StepHeader n={3} label="Gap validation" />
        <div className="flex flex-wrap items-center gap-1.5">
          {ex.selection.capability && (
            <Chip fill={LAVENDER} mono>
              {ex.selection.capability.id}
            </Chip>
          )}
          {ex.selection.gapTopics.map((g) => (
            <Chip key={g} fill={CREAM}>
              gap · {pretty(g)}
            </Chip>
          ))}
          <Chip fill={gap.fill}>{gap.label}</Chip>
        </div>
        <p className="text-[13px] leading-snug">
          {mission.spec.grounding.gapStillOpen}
        </p>
        <p className="text-[12.5px] leading-snug" style={{ color: MUTED }}>
          Searched for: {ex.gapCheck.terms.join(", ") || "(no terms)"}.{" "}
          {ex.gapCheck.dependencyHits.length > 0 &&
            `Dependencies matching: ${ex.gapCheck.dependencyHits.join(", ")}. `}
          {ex.gapCheck.pathHits.length > 0 &&
            `Paths matching: ${ex.gapCheck.pathHits.join(", ")}. `}
          {ex.gapCheck.scope}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <h4
              className="mb-1 text-[11px] font-bold uppercase tracking-wider"
              style={{ color: GREEN }}
            >
              What this shows
            </h4>
            <ul className="list-disc space-y-1 pl-4 text-[12.5px] leading-snug">
              {ex.proves.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4
              className="mb-1 text-[11px] font-bold uppercase tracking-wider"
              style={{ color: RED }}
            >
              What it does not show
            </h4>
            <ul className="list-disc space-y-1 pl-4 text-[12.5px] leading-snug">
              {ex.doesNotProve.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 4 selection */}
      <section
        style={{ ...border, backgroundColor: "#fff" }}
        className="space-y-2 rounded-xl p-4"
      >
        <StepHeader n={4} label="Why this move" />
        <p className="text-[13px] leading-snug">
          <span className="font-bold">Goal:</span> {ex.selection.goal}
        </p>
        <p className="text-[13px] leading-snug">
          <span className="font-bold">Move:</span> {ex.selection.moveTitle}.{" "}
          {ex.selection.moveWhy}
        </p>
        {ex.selection.builtOn.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] font-bold">Already built on:</span>
            {ex.selection.builtOn.map((b) => (
              <Chip key={b} fill={LIGHT_GREEN}>
                {pretty(b)}
              </Chip>
            ))}
          </div>
        )}
        {ex.selection.focusSlug && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] font-bold">Focus:</span>
            <Chip fill={LAVENDER}>{pretty(ex.selection.focusSlug)}</Chip>
          </div>
        )}
        <p
          style={{ ...border, backgroundColor: CREAM }}
          className="rounded-lg px-3 py-2 text-[12.5px] leading-snug"
        >
          {ex.selection.note}
        </p>
      </section>
    </div>
  );
}

/* ---------- evaluation pieces ---------- */

function StepMark({ status }: { status: StepStatus }) {
  if (status === "running")
    return (
      <RefreshCw size={14} className="animate-spin" aria-label="running" />
    );
  const map: Record<Exclude<StepStatus, "running">, [string, string]> = {
    done: ["✓", GREEN],
    failed: ["✕", RED],
    skipped: ["–", MUTED],
    pending: ["○", MUTED],
  };
  const [ch, color] = map[status];
  return (
    <span aria-label={status} style={{ color }} className="font-bold">
      {ch}
    </span>
  );
}

function StepTimeline({ steps, open }: { steps: RunStep[]; open: boolean }) {
  return (
    <details
      open={open}
      style={{ ...border, backgroundColor: "#fff" }}
      className="rounded-xl px-4 py-3"
    >
      <summary
        style={{ fontFamily: DISPLAY }}
        className="cursor-pointer text-[14px] font-bold"
      >
        What the evaluator did
      </summary>
      <ol className="mt-3 space-y-2.5">
        {steps.map((s) => (
          <li
            key={s.id}
            className="flex items-start gap-2.5"
            style={{ opacity: s.status === "pending" ? 0.55 : 1 }}
          >
            <span className="mt-0.5 flex w-4 shrink-0 justify-center text-[13px]">
              <StepMark status={s.status} />
            </span>
            <div className="min-w-0 flex-1">
              <p
                className="text-[13px] font-semibold leading-snug"
                style={{ color: s.status === "failed" ? RED : INK }}
              >
                {s.label}
              </p>
              {s.detail && (
                <p
                  className="text-[12px] leading-snug"
                  style={{ color: MUTED }}
                >
                  {s.detail}
                </p>
              )}
              {s.command && s.status === "running" && (
                <code
                  style={{ fontFamily: MONO, color: MUTED }}
                  className="mt-0.5 block truncate text-[11px]"
                >
                  $ {s.command}
                </code>
              )}
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** Shown only when the project cannot boot without a real third-party secret. */
function EnvForm({
  keys,
  busy,
  note,
  onSubmit,
}: {
  keys: Array<{ name: string; reason: string }>;
  busy: boolean;
  note: string;
  onSubmit: (env: Record<string, string>, allowDummy: boolean) => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const filled = keys.every((k) => (vals[k.name] ?? "").trim() !== "");
  return (
    <div
      style={{ ...border, backgroundColor: CREAM, boxShadow: shadow(3) }}
      className="space-y-3 rounded-2xl p-4"
    >
      <div>
        <h3 style={{ fontFamily: DISPLAY }} className="text-[16px] font-bold">
          Your server needs {keys.length === 1 ? "a secret" : "some secrets"} to
          start
        </h3>
        <p className="mt-1 text-[13px] leading-snug">
          Everything else (database, local secrets, ports) was filled in
          automatically. These values are used only inside the throwaway
          sandbox, are hidden from the log, and are never stored.
        </p>
      </div>
      {keys.map((k) => (
        <label key={k.name} className="block">
          <span className="text-[12px] font-bold" style={{ fontFamily: MONO }}>
            {k.name}
          </span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={vals[k.name] ?? ""}
            onChange={(e) =>
              setVals((v) => ({ ...v, [k.name]: e.target.value }))
            }
            style={{ ...border, fontFamily: MONO }}
            className="pm-input mt-1 w-full rounded-lg bg-white px-3 py-2 text-[13px]"
          />
          <span className="text-[11.5px]" style={{ color: MUTED }}>
            {k.reason}
          </span>
        </label>
      ))}
      {note && (
        <p role="alert" className="text-[12.5px]" style={{ color: RED }}>
          {note}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !filled}
          onClick={() => onSubmit(vals, false)}
          style={{ ...border, backgroundColor: YELLOW, boxShadow: shadow(2) }}
          className="pm-btn inline-flex items-center gap-2 rounded-full px-5 py-2 text-[13px] font-bold"
        >
          <Play size={14} aria-hidden />
          Run with these values
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onSubmit({}, true)}
          style={border}
          className="pm-btn rounded-full bg-white px-4 py-2 text-[13px] font-semibold"
        >
          Use placeholder values instead
        </button>
      </div>
      <p className="text-[11.5px] leading-snug" style={{ color: MUTED }}>
        Placeholders work when the tests do not need the real service. If your
        code calls it for real, that test case will fail.
      </p>
    </div>
  );
}

/** One test case: its tests listed one by one, then the explanation. */
function CheckResult({
  index,
  criterion,
  result,
  tests,
  startDelay,
  animate,
}: {
  index: number;
  criterion: Criterion;
  result?: CriterionResult;
  tests: TestCase[];
  startDelay: number;
  animate: boolean;
}) {
  const passed = result?.met === true;
  // PASS/FAIL lines are shown from the structured tests; keep the rest of the explanation
  const notes = (result?.reasoning ?? "")
    .split("\n")
    .filter((l) => l.trim() && !/^(PASS|FAIL) /.test(l));
  return (
    <div
      style={{
        ...border,
        backgroundColor: "#fff",
        borderColor: passed ? GREEN : RED,
      }}
      className="rounded-xl p-4"
    >
      <div className="flex items-start gap-3">
        <span
          aria-label={passed ? "met" : "not met"}
          className="mt-0.5 text-[16px] font-bold"
          style={{ color: passed ? GREEN : RED }}
        >
          {passed ? "✓" : "✕"}
        </span>
        <div className="min-w-0 flex-1">
          <p style={{ fontFamily: DISPLAY }} className="text-[15px] font-bold">
            Test case {index + 1}
          </p>
          <p className="mt-0.5 text-[13.5px] leading-snug">
            {criterion.description}
          </p>

          {tests.length > 0 ? (
            <ul className="mt-2.5 space-y-1.5">
              {tests.map((t, i) => (
                <li
                  key={`${t.name}-${i}`}
                  className={animate ? "pm-reveal" : ""}
                  style={{ animationDelay: `${startDelay + i * 110}ms` }}
                >
                  <div className="flex items-start gap-2 text-[12.5px] leading-snug">
                    <span
                      className="font-bold"
                      style={{
                        color:
                          t.status === "passed"
                            ? GREEN
                            : t.status === "failed"
                              ? RED
                              : MUTED,
                      }}
                    >
                      {t.status === "passed"
                        ? "✓"
                        : t.status === "failed"
                          ? "✕"
                          : "–"}
                    </span>
                    <span style={{ fontFamily: MONO }} className="break-words">
                      {t.name.replace(/^AC\d+:?\s*/i, "")}
                    </span>
                  </div>
                  {t.status === "failed" && t.message && (
                    <pre
                      style={{
                        fontFamily: MONO,
                        backgroundColor: ED.bg,
                        color: "#ffb4a2",
                      }}
                      className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded-md px-3 py-2 text-[11.5px]"
                    >
                      {t.message}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12.5px]" style={{ color: MUTED }}>
              No test ran for this test case.
            </p>
          )}

          {notes.length > 0 && (
            <div
              className="mt-2.5 space-y-1 text-[12.5px] leading-snug"
              style={{ color: passed ? "#2c6e34" : RED }}
            >
              {notes.map((n, i) => (
                <p key={i}>{n}</p>
              ))}
            </div>
          )}
          {result?.quote && (
            <code
              style={{
                fontFamily: MONO,
                backgroundColor: ED.bg,
                color: ED.string,
              }}
              className="mt-2 block overflow-x-auto whitespace-pre rounded-md px-3 py-2 text-[12px]"
            >
              + {result.quote}
            </code>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultPanel({ run, spec }: { run: RunView; spec: Spec }) {
  const o = run.outcome;
  if (!o) return null;
  const done = o.verdict === "completed";
  const met = o.results.filter((r) => r.met).length;

  // cumulative delay so the tests of all test cases appear one after another
  let delay = 350;
  const delays = spec.criteria.map((c) => {
    const d = delay;
    delay += o.tests.filter((t) => t.id === c.id).length * 110 + 120;
    return d;
  });

  return (
    <div className="space-y-3">
      <div
        style={{
          ...border,
          backgroundColor: done ? LIGHT_GREEN : SOFT_CORAL,
          boxShadow: shadow(3),
        }}
        className={`rounded-2xl p-4 ${done ? "pm-pop" : ""}`}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            style={{ fontFamily: DISPLAY }}
            className="text-[22px] font-bold"
          >
            {done ? "Mission complete" : "Not there yet"}
          </span>
          {run.headSha && (
            <Chip fill="#fff" mono>
              {short(run.headSha)}
            </Chip>
          )}
          <Chip fill="#fff">
            {met} of {o.results.length} test cases passed
          </Chip>
        </div>
        <p className="mt-2 text-[14px] leading-relaxed">{o.summary}</p>
        {done && (
          <p
            className="mt-2 text-[13px] font-semibold"
            style={{ color: "#2c6e34" }}
          >
            Every test case passed in an isolated sandbox, and the required
            mechanism is visible in your code.
          </p>
        )}
        {run.infra && !done && (
          <p
            style={{ ...border, backgroundColor: "#fff" }}
            className="mt-2 rounded-lg px-3 py-2 text-[12.5px] leading-snug"
          >
            Part of this failure looks like a problem with the evaluation
            environment (network or installer), not your code. Running the
            evaluation again may fix it.
          </p>
        )}
      </div>

      {!done && o.issues.length > 0 && (
        <section
          style={{ ...border, backgroundColor: "#fff" }}
          className="rounded-xl p-4"
        >
          <h3 style={{ fontFamily: DISPLAY }} className="text-[15px] font-bold">
            What is wrong
          </h3>
          <ul className="mt-2 space-y-2.5">
            {o.issues.map((i, k) => (
              <li key={`${i.title}-${k}`} className="text-[13px] leading-snug">
                <p className="font-bold" style={{ color: RED }}>
                  {i.title}
                </p>
                <p>{i.detail}</p>
                {i.file && (
                  <code style={{ fontFamily: MONO }} className="text-[12px]">
                    {i.file}
                  </code>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!done && o.nextSteps.length > 0 && (
        <section
          style={{ ...border, backgroundColor: CREAM }}
          className="rounded-xl p-4"
        >
          <h3 style={{ fontFamily: DISPLAY }} className="text-[15px] font-bold">
            What to do next
          </h3>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[13px] leading-snug">
            {o.nextSteps.map((s, k) => (
              <li key={k}>{s}</li>
            ))}
          </ol>
        </section>
      )}

      <h3
        style={{ fontFamily: DISPLAY }}
        className="pt-1 text-[16px] font-bold"
      >
        Test cases, one by one
      </h3>
      {spec.criteria.map((c, i) => (
        <CheckResult
          key={c.id}
          index={i}
          criterion={c}
          result={o.results.find((r) => r.id === c.id)}
          tests={o.tests.filter((t) => t.id === c.id)}
          startDelay={delays[i]}
          animate={done}
        />
      ))}

      <section
        style={{ ...border, backgroundColor: "#fff" }}
        className="rounded-xl p-4"
      >
        <h3 style={{ fontFamily: DISPLAY }} className="text-[15px] font-bold">
          Evaluation gates
        </h3>
        <ul className="mt-2 space-y-1 text-[13px]">
          <li>
            <GateMark ok={o.gates.missionTestRan} /> Our tests ran against your
            files in the sandbox
          </li>
        </ul>
      </section>

      {run.testCode && (
        <details
          style={{ ...border, backgroundColor: "#fff" }}
          className="rounded-xl px-4 py-3"
        >
          <summary
            style={{ fontFamily: DISPLAY }}
            className="cursor-pointer text-[14px] font-bold"
          >
            The tests we ran against your files
          </summary>
          <div className="mt-2">
            <CodeView
              content={run.testCode}
              maxH={360}
              label="Generated tests"
            />
          </div>
        </details>
      )}

      {run.log && (
        <details
          style={{ ...border, backgroundColor: "#fff" }}
          className="rounded-xl px-4 py-3"
        >
          <summary
            style={{ fontFamily: DISPLAY }}
            className="cursor-pointer text-[14px] font-bold"
          >
            Sandbox log
          </summary>
          <div className="mt-2">
            <CodeView content={run.log} plain maxH={360} label="Sandbox log" />
          </div>
        </details>
      )}
    </div>
  );
}

/* ---------- post-mission graph reveal (Overview theme) ---------- */

const GRAPH_STAGES: Array<{ id: string; label: string; note: string }> = [
  {
    id: "audit_stored",
    label: "Evaluation stored",
    note: "Verdict, results and changed files saved on the mission.",
  },
  {
    id: "evidence_written",
    label: "Code evidence written",
    note: "Commit, file changes and detected demonstrations saved.",
  },
  {
    id: "relationships_reconciled",
    label: "Relationships linked",
    note: "Demonstrations tied to capability, file, repository and this mission.",
  },
  {
    id: "aggregates_rebuilt",
    label: "Aggregates rebuilt",
    note: "Experiences and capability rollups recomputed from verified evidence.",
  },
];

type GraphNode = {
  title: string;
  sub: string;
  tag: string;
  fill: string;
  show: boolean;
};

/** Full-screen explanation of how a passing mission feeds Pathway's graph. Only shows data that is non-zero. */
function GraphUpdateReveal({
  mission,
  run,
  onClose,
}: {
  mission: Mission;
  run: RunView;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const learning = run.learning ?? null;
  const result = learning?.learning ?? null;
  const gu = learning?.graphUpdate ?? null;
  const status = learning?.evidenceStatus ?? "";
  const updated = status === "updated";
  const failed = status === "graph_update_failed";
  const learned = updated || gu?.status === "completed";
  const verified = learning?.verification?.verified ?? null;
  const reasons = learning?.verification?.reasons ?? [];
  const headline = failed
    ? "Mission passed. The graph update failed."
    : learned
      ? "Your graph just learned from this mission"
      : "Mission complete";
  const doneStages = new Set(gu?.stagesCompleted ?? []);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const detected = result?.detected ?? 0;
  const accepted = result?.accepted ?? 0;
  const experiences = result?.experiencesUpdated ?? 0;
  const capabilities = result?.capabilityRollupsUpdated ?? 0;

  /* only nodes that have real data are drawn */
  const allNodes: GraphNode[] = [
    {
      title: "Developer",
      sub: "you",
      tag: "IDENTITY",
      fill: "#fff",
      show: true,
    },
    {
      title: "Commit",
      sub: short(run.headSha || run.head || "pushed"),
      tag: "SOURCE",
      fill: LIGHT_GREEN,
      show: Boolean(run.headSha || run.head),
    },
    {
      title: "FileChange",
      sub: `${detected} detected`,
      tag: "CODE",
      fill: LIGHT_GREEN,
      show: detected > 0,
    },
    {
      title: "Demonstration",
      sub: `${accepted} accepted`,
      tag: "PROOF",
      fill: YELLOW,
      show: accepted > 0,
    },
    {
      title: "Experience",
      sub: `${experiences} updated`,
      tag: "AGGREGATE",
      fill: LIGHT_GREEN,
      show: experiences > 0,
    },
    {
      title: "Capability",
      sub: `${capabilities} rollups`,
      tag: "GROWTH",
      fill: GREEN,
      show: capabilities > 0,
    },
  ];
  const visible = allNodes.filter((n) => n.show);
  const NW = 124;
  const NH = 58;
  const MARGIN = 80;
  const W = 960;
  const step = visible.length > 1 ? (W - MARGIN * 2) / (visible.length - 1) : 0;
  const nodes = visible.map((n, i) => ({
    ...n,
    x: visible.length > 1 ? MARGIN + step * i : W / 2,
    y: i % 2 === 0 ? 120 : 60,
  }));

  const tiles = [
    {
      label: "Detected",
      value: detected,
      note: "code changes with learnable patterns",
    },
    {
      label: "Accepted",
      value: accepted,
      note: "demonstrations written to the graph",
    },
    {
      label: "Experiences",
      value: experiences,
      note: "rebuilt from verified evidence",
    },
    {
      label: "Capabilities",
      value: capabilities,
      note: "rollups recalculated",
    },
  ].filter((t) => t.value > 0);

  return (
    <div
      className="gr-backdrop fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5"
      style={{ backgroundColor: "rgba(16,18,16,.62)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gr-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[94vh] w-full max-w-[1040px] overflow-y-auto rounded-2xl"
        style={{
          ...border,
          backgroundColor: PAPER,
          boxShadow: shadow(6),
          fontFamily: BODY,
          color: INK,
        }}
      >
        {/* header */}
        <div
          className="flex items-center justify-between gap-3 px-5 py-3"
          style={{
            borderBottom: `2px solid ${INK}`,
            backgroundColor: failed ? SOFT_CORAL : learned ? YELLOW : CREAM,
          }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <span
              style={{ ...border, backgroundColor: "#fff" }}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            >
              {learned ? <Sparkles size={20} /> : <Check size={20} />}
            </span>
            <div className="min-w-0">
              <p
                className="text-[10px] font-bold uppercase tracking-[0.18em]"
                style={{ fontFamily: MONO, color: MUTED }}
              >
                pathway.io · mission complete
              </p>
              <h2
                id="gr-title"
                style={{ fontFamily: DISPLAY }}
                className="text-[20px] font-bold leading-tight sm:text-[24px]"
              >
                {headline}
              </h2>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={border}
            className="pm-btn shrink-0 rounded-full bg-white p-1.5"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          {/* chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip fill={LIGHT_GREEN}>
              {run.outcome?.results.filter((r) => r.met).length ?? 0} of{" "}
              {run.outcome?.results.length ?? 0} test cases passed
            </Chip>
            <Chip fill="#fff">{mission.spec.title}</Chip>
            {run.headSha && (
              <Chip fill="#fff" mono>
                commit {short(run.headSha)}
              </Chip>
            )}
            {verified === true && <Chip fill={LIGHT_GREEN}>verified</Chip>}
            {verified === false && (
              <Chip fill={SOFT_CORAL}>not promoted as evidence</Chip>
            )}
          </div>

          {/* graph */}
          <section
            style={{ ...border, backgroundColor: "#fff", boxShadow: shadow(3) }}
            className="rounded-2xl p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3
                style={{ fontFamily: DISPLAY }}
                className="text-[17px] font-bold"
              >
                How your graph updated
              </h3>
            </div>
            <div className="mt-2 overflow-x-auto">
              <svg
                viewBox="0 0 960 190"
                role="img"
                aria-label={`Graph update path: ${nodes.map((n) => n.title).join(", ")}`}
                className="mx-auto h-auto w-full min-w-[720px]"
              >
                <defs>
                  <pattern
                    id="gr-grid"
                    width="32"
                    height="32"
                    patternUnits="userSpaceOnUse"
                  >
                    <circle cx="1" cy="1" r="1" fill={INK} opacity=".1" />
                  </pattern>
                  <marker
                    id="gr-arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M0,0 L10,5 L0,10 z" fill={INK} />
                  </marker>
                </defs>
                <rect width="960" height="190" fill="url(#gr-grid)" />
                {nodes.slice(0, -1).map((a, i) => {
                  const b = nodes[i + 1];
                  const x1 = a.x + NW / 2;
                  const x2 = b.x - NW / 2 - 4;
                  return (
                    <line
                      key={`${a.title}-${b.title}`}
                      x1={x1}
                      y1={a.y}
                      x2={x2}
                      y2={b.y}
                      pathLength={1}
                      stroke={INK}
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      markerEnd="url(#gr-arrow)"
                      className="gr-edge"
                      style={{ animationDelay: `${300 + i * 220}ms` }}
                    />
                  );
                })}
                {nodes.map((n, i) => (
                  <g
                    key={n.title}
                    className="gr-node"
                    style={{ animationDelay: `${150 + i * 220}ms` }}
                  >
                    {n.fill !== "#fff" && (
                      <rect
                        x={n.x - NW / 2}
                        y={n.y - NH / 2}
                        width={NW}
                        height={NH}
                        rx={14}
                        fill="none"
                        stroke={n.fill === GREEN ? GREEN : YELLOW}
                        strokeWidth={3}
                        className="gr-ring"
                        style={{ animationDelay: `${600 + i * 220}ms` }}
                      />
                    )}
                    <rect
                      x={n.x - NW / 2}
                      y={n.y - NH / 2}
                      width={NW}
                      height={NH}
                      rx={14}
                      fill={n.fill}
                      stroke={INK}
                      strokeWidth={2.5}
                    />
                    <text
                      x={n.x}
                      y={n.y - 3}
                      textAnchor="middle"
                      fontSize="13"
                      fontWeight={700}
                      fill={n.fill === GREEN ? "#fff" : INK}
                      style={{ fontFamily: DISPLAY }}
                    >
                      {n.title}
                    </text>
                    <text
                      x={n.x}
                      y={n.y + 14}
                      textAnchor="middle"
                      fontSize="10.5"
                      fontWeight={600}
                      fill={n.fill === GREEN ? "#fff" : MUTED}
                      style={{ fontFamily: MONO }}
                    >
                      {n.sub}
                    </text>
                    <text
                      x={n.x}
                      y={178}
                      textAnchor="middle"
                      fontSize="10"
                      fontWeight={700}
                      fill={MUTED}
                      style={{ fontFamily: MONO, letterSpacing: "0.12em" }}
                    >
                      {n.tag}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
          </section>

          <div
            className={`grid gap-4 ${tiles.length > 0 ? "lg:grid-cols-[1.1fr_1fr]" : ""}`}
          >
            {/* stages */}
            <section
              style={{ ...border, backgroundColor: "#fff" }}
              className="rounded-2xl p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h3
                  style={{ fontFamily: DISPLAY }}
                  className="text-[16px] font-bold"
                >
                  Graph update, stage by stage
                </h3>
                {gu && (
                  <Chip
                    fill={
                      gu.status === "completed"
                        ? LIGHT_GREEN
                        : gu.status === "failed"
                          ? SOFT_CORAL
                          : CREAM
                    }
                  >
                    {gu.status}
                    {gu.attempts > 1 ? ` · attempt ${gu.attempts}` : ""}
                  </Chip>
                )}
              </div>
              <ol className="mt-3 space-y-2.5">
                {GRAPH_STAGES.map((s, i) => {
                  const ok = doneStages.has(s.id);
                  const bad = gu?.failedStage === s.id && !ok;
                  const skipped = !ok && !bad && !learned && !failed;
                  return (
                    <li
                      key={s.id}
                      className="gr-rise flex items-start gap-2.5"
                      style={{
                        animationDelay: `${400 + i * 160}ms`,
                        opacity: skipped ? 0.5 : undefined,
                      }}
                    >
                      <span
                        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                        style={{
                          ...border,
                          backgroundColor: ok
                            ? LIGHT_GREEN
                            : bad
                              ? SOFT_CORAL
                              : "#fff",
                          color: ok ? GREEN : bad ? RED : MUTED,
                        }}
                      >
                        {ok ? "✓" : bad ? "✕" : "–"}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold leading-snug">
                          {s.label}
                        </p>
                        <p
                          className="text-[12px] leading-snug"
                          style={{ color: MUTED }}
                        >
                          {s.note}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
              {failed && (
                <p
                  role="alert"
                  style={{ ...border, backgroundColor: SOFT_CORAL }}
                  className="mt-3 rounded-lg px-3 py-2 text-[12.5px] leading-snug"
                >
                  <b>
                    Failed at{" "}
                    {gu?.failedStage
                      ? pretty(gu.failedStage)
                      : "an unknown stage"}
                    .
                  </b>{" "}
                  Your mission result is saved. Evaluating the same push again
                  retries only the graph update.
                  {gu?.lastError ? ` (${gu.lastError.slice(0, 160)})` : ""}
                </p>
              )}
            </section>

            {/* numbers (zero values are hidden) */}
            {tiles.length > 0 && (
              <section className="grid grid-cols-2 gap-3 self-start">
                {tiles.map((t, i) => (
                  <div
                    key={t.label}
                    className="gr-rise rounded-2xl p-3.5"
                    style={{
                      ...border,
                      backgroundColor: "#fff",
                      boxShadow: shadow(2),
                      animationDelay: `${500 + i * 120}ms`,
                    }}
                  >
                    <div
                      className="text-[10.5px] font-bold uppercase tracking-wider"
                      style={{ color: MUTED }}
                    >
                      {t.label}
                    </div>
                    <div
                      className="mt-1 text-[28px] font-bold leading-none"
                      style={{ fontFamily: DISPLAY, color: GREEN }}
                    >
                      {t.value}
                    </div>
                    <div
                      className="mt-1.5 text-[11.5px] leading-snug"
                      style={{ color: MUTED }}
                    >
                      {t.note}
                    </div>
                  </div>
                ))}
              </section>
            )}
          </div>

          {verified === false && reasons.length > 0 && (
            <section
              style={{ ...border, backgroundColor: CREAM }}
              className="rounded-2xl p-4"
            >
              <h3
                style={{ fontFamily: DISPLAY }}
                className="text-[15px] font-bold"
              >
                Why it was not promoted
              </h3>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px] leading-snug">
                {reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </section>
          )}

          {/* footer */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p
              className="max-w-xl text-[12px] leading-snug"
              style={{ color: MUTED }}
            >
              Only verified evidence reaches your capability model.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link
                to={GOAL_ROUTE}
                style={border}
                className="pm-btn inline-flex items-center rounded-full bg-white px-5 py-2.5 text-[13px] font-bold"
              >
                Back to goal
              </Link>
              <button
                type="button"
                onClick={onClose}
                style={{
                  ...border,
                  backgroundColor: YELLOW,
                  boxShadow: shadow(3),
                }}
                className="pm-btn inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-bold"
              >
                See mission results <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GateMark({ ok }: { ok: boolean | null }) {
  const [ch, color] =
    ok === true ? ["✓", GREEN] : ok === false ? ["✕", RED] : ["–", MUTED];
  return (
    <span className="mr-1 font-bold" style={{ color }}>
      {ch}
    </span>
  );
}

/* ---------- page ---------- */
export default function MissionPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const goalParam = params.get("goalId") ?? "";
  const missionParam = params.get("mission") ?? "";

  const [phase, setPhase] = useState<Phase>("loading");
  const [mission, setMission] = useState<Mission | null>(null);
  const [error, setError] = useState<PageError | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [tab, setTab] = useState<Tab>("checks");
  const [busy, setBusy] = useState<
    "" | "workspace" | "evaluate" | "env" | "reset"
  >("");
  const [note, setNote] = useState<string>("");

  /* sandbox evaluation run */
  const [run, setRun] = useState<RunView | null>(null);
  const [runNote, setRunNote] = useState("");
  const [envNote, setEnvNote] = useState("");

  /* workspace (fork + branch) and the commits collected from it */
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [wsChecked, setWsChecked] = useState(false);
  const [commits, setCommits] = useState<BranchCommit[]>([]);
  const [compareUrl, setCompareUrl] = useState("");
  const [commitsNote, setCommitsNote] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState("");
  const [showGraphReveal, setShowGraphReveal] = useState(false);
  /* re-reads the stored result; never starts an evaluation */
  const [refreshing, setRefreshing] = useState(false);

  const started = useRef(false);
  const celebratedRun = useRef("");
  const lastGoal = useRef("");

  const loadEvaluation = async (id: string) => {
    const res = await api<{ evaluation: Evaluation | null }>(
      `${API}/${encodeURIComponent(id)}/evaluation`,
    );
    setEvaluation(res.body?.evaluation ?? null);
  };

  const loadCommits = async (id: string) => {
    setSyncing(true);
    try {
      const res = await api<CommitsResponse>(
        `${API}/${encodeURIComponent(id)}/commits`,
      );
      const body = res.body;
      if (body?.ok) {
        setWorkspace({
          forkRepository: body.forkRepository,
          branch: body.branch,
        });
        setCommits(body.commits);
        setCompareUrl(body.compareUrl);
        setCommitsNote("");
        setSyncedAt(new Date().toLocaleTimeString());
      } else if (body?.status === "no_workspace") {
        setWorkspace(null);
        setCommits([]);
        setCommitsNote("");
      } else {
        setCommitsNote(
          res.status === 401
            ? "Your session has expired. Sign in again."
            : (body?.reason ?? "Could not read commits from GitHub."),
        );
      }
      setWsChecked(true);
    } catch {
      setCommitsNote("The server could not be reached.");
    }
    setSyncing(false);
  };

  const resetWorkspaceState = () => {
    setWorkspace(null);
    setWsChecked(false);
    setCommits([]);
    setCompareUrl("");
    setCommitsNote("");
    setSyncedAt("");
  };

  const open = async (id: string) => {
    const res = await api<{ mission: Mission }>(
      `${API}/${encodeURIComponent(id)}`,
    );
    if (!res.ok || !res.body?.mission) {
      setError({
        title: "Mission not found",
        reason:
          res.status === 401
            ? "Your session has expired. Sign in again."
            : "This mission does not exist or belongs to another account.",
        errors: [],
        retry: false,
      });
      setPhase("error");
      return;
    }
    const m = res.body.mission;
    setMission(m);
    await loadEvaluation(m.id);
    setTab("checks");
    setPhase("ready");
  };

  const create = async (goalId: string) => {
    lastGoal.current = goalId;
    setPhase("generating");
    setError(null);
    setEvaluation(null);
    setNote("");
    setRun(null);
    setRunNote("");
    setEnvNote("");
    resetWorkspaceState();
    try {
      const res = await api<CreateResponse>(API, {
        method: "POST",
        body: JSON.stringify({ goalId }),
      });
      const body = res.body;
      if (
        body?.mission &&
        (body.status === "created" || body.status === "existing")
      ) {
        setMission(body.mission);
        if (body.status === "existing") await loadEvaluation(body.mission.id);
        setTab("checks");
        setParams({ mission: body.mission.id }, { replace: true });
        setPhase("ready");
        return;
      }
      const meta = CREATE_ERROR[body?.status ?? ""] ?? {
        title: "Couldn't prepare the mission",
        retry: true,
      };
      setError({
        title: meta.title,
        reason:
          res.status === 401
            ? "Your session has expired. Sign in again."
            : (body?.reason ?? "Something went wrong."),
        errors: body?.errors ?? [],
        retry: meta.retry && res.status !== 401,
      });
      setPhase("error");
    } catch {
      setError({
        title: "Couldn't prepare the mission",
        reason: "The server could not be reached.",
        errors: [],
        retry: true,
      });
      setPhase("error");
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (missionParam) {
      void open(missionParam);
      return;
    }
    const goalId = goalParam || storedGoalId();
    if (goalId) void create(goalId);
    else setPhase("empty");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* collect commits from the working branch while the mission is live */
  const missionId = mission?.id ?? "";
  const missionStatus = mission?.status ?? "proposed";
  useEffect(() => {
    if (phase !== "ready" || !missionId) return;
    if (missionStatus === "proposed" || missionStatus === "abandoned") return;
    void loadCommits(missionId);
    if (missionStatus === "completed") return;
    const timer = setInterval(() => {
      if (!document.hidden) void loadCommits(missionId);
    }, COMMIT_POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, missionId, missionStatus]);

  const refresh = async (id: string) => {
    const res = await api<{ mission: Mission }>(
      `${API}/${encodeURIComponent(id)}`,
    );
    if (res.body?.mission) setMission(res.body.mission);
  };

  /* resume the newest run after a reload */
  useEffect(() => {
    if (phase !== "ready" || !missionId) return;
    let dead = false;
    void (async () => {
      const res = await api<{ run: RunView | null }>(
        `${API}/${encodeURIComponent(missionId)}/evaluate/latest`,
      );
      const latest = res.body?.run;
      if (!dead && latest) {
        setRun((prev) => prev ?? latest);
        if (latest.status === "needs_env") setTab("evaluate");
      }
    })();
    return () => {
      dead = true;
    };
  }, [phase, missionId]);

  /* poll a live run */
  const runId = run?.runId ?? "";
  const runStatus = run?.status ?? "done";

  /* Show the graph reveal once when a completed run arrives, including after reload. */
  useEffect(() => {
    if (!runId || runStatus !== "done" || run?.outcome?.verdict !== "completed")
      return;
    if (celebratedRun.current === runId) return;
    celebratedRun.current = runId;
    setShowGraphReveal(true);
  }, [runId, runStatus, run?.outcome?.verdict]);

  useEffect(() => {
    if (!missionId || !runId) return;
    if (runStatus !== "running" && runStatus !== "needs_env") return;
    const timer = setInterval(async () => {
      try {
        const res = await api<{ run: RunView }>(
          `${API}/${encodeURIComponent(missionId)}/evaluate/${encodeURIComponent(runId)}`,
        );
        if (res.body?.run) setRun(res.body.run);
        else if (res.status === 404) {
          setRun(null);
          setRunNote(
            "The evaluation was lost (the server restarted). Start it again.",
          );
        }
      } catch {
        /* transient, next tick retries */
      }
    }, RUN_POLL_MS);
    return () => clearInterval(timer);
  }, [missionId, runId, runStatus]);

  /* when a run finishes, refresh the persisted state */
  useEffect(() => {
    if (!missionId || !runId || runStatus !== "done") return;
    void refresh(missionId);
    void loadEvaluation(missionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId, runId, runStatus]);

  /** Start mission + create branch: forks the repo and creates the working branch. */
  const startWithBranch = async () => {
    if (!mission) return;
    setBusy("workspace");
    setNote("");
    try {
      const res = await api<WorkspaceResponse>(
        `${API}/${encodeURIComponent(mission.id)}/workspace`,
        { method: "POST" },
      );
      const body = res.body;
      if (body?.ok) {
        setWorkspace({
          forkRepository: body.forkRepository,
          branch: body.branch,
        });
        setWsChecked(true);
        setCommits([]);
        await refresh(mission.id);
        setTab("commits");
      } else {
        setNote(
          res.status === 401
            ? (body?.error ??
                "Your session or GitHub connection has expired. Sign in again.")
            : (body?.reason ?? body?.error ?? "Could not create the branch."),
        );
      }
    } catch {
      setNote("The server could not be reached.");
    }
    setBusy("");
  };

  /**
   * Re-read the stored result. Does NOT start an evaluation and never writes to
   * the graph: it only uses GET requests.
   */
  const refreshResult = async () => {
    if (!mission) return;
    setRefreshing(true);
    setRunNote("");
    try {
      const res = await api<{ run: RunView | null }>(
        `${API}/${encodeURIComponent(mission.id)}/evaluate/latest`,
      );
      if (res.body?.run) setRun(res.body.run);
      else
        setRunNote(
          "The detailed run is no longer on the server (a restart clears it). Showing the saved result instead.",
        );
      await Promise.all([loadEvaluation(mission.id), refresh(mission.id)]);
    } catch {
      setRunNote("The server could not be reached.");
    }
    setRefreshing(false);
  };

  /** Evaluate the latest push in the Daytona sandbox. */
  const startEvaluate = async () => {
    if (!mission || !workspace) return;
    // the same push was already evaluated: make the user confirm before re-running
    if (
      run?.headSha &&
      run.headSha === commits[0]?.sha &&
      !window.confirm(
        "This push was already evaluated. Evaluating again re-runs the tests and the graph update. Continue?",
      )
    )
      return;
    setBusy("evaluate");
    setRunNote("");
    setEnvNote("");
    setTab("evaluate");
    try {
      const res = await api<RunResponse>(
        `${API}/${encodeURIComponent(mission.id)}/evaluate`,
        { method: "POST", body: JSON.stringify({ head: workspace.branch }) },
      );
      const body = res.body;
      if (body?.run) setRun(body.run);
      else
        setRunNote(
          res.status === 401
            ? "Your session or GitHub connection has expired. Sign in again."
            : (body?.message ?? "Could not start the evaluation."),
        );
    } catch {
      setRunNote("The server could not be reached.");
    }
    setBusy("");
  };

  /** Answer the run's env request. */
  const submitEnv = async (
    env: Record<string, string>,
    allowDummy: boolean,
  ) => {
    if (!mission || !run) return;
    setBusy("env");
    setEnvNote("");
    try {
      const res = await api<RunResponse>(
        `${API}/${encodeURIComponent(mission.id)}/evaluate/${encodeURIComponent(run.runId)}/env`,
        { method: "POST", body: JSON.stringify({ env, allowDummy }) },
      );
      if (res.body?.run) setRun(res.body.run);
      else setEnvNote(res.body?.message ?? "Could not send the values.");
    } catch {
      setEnvNote("The server could not be reached.");
    }
    setBusy("");
  };

  const discard = async (then: "goal" | "regenerate") => {
    if (!mission) return;
    setBusy("reset");
    try {
      await api(`${API}/${encodeURIComponent(mission.id)}/abandon`, {
        method: "POST",
      });
    } finally {
      setBusy("");
    }
    if (then === "goal") navigate(GOAL_ROUTE);
    else await create(mission.goalId);
  };

  const ready = phase === "ready" && mission;
  const spec = mission?.spec;
  const pin = mission?.pin;
  const status = mission?.status ?? "proposed";
  const passedInSandbox = run?.outcome?.verdict === "completed";
  const finished = status === "completed" || passedInSandbox;
  const canWork = !!mission && !finished && status !== "abandoned";
  const needsWorkspace =
    status === "proposed" || (canWork && wsChecked && !workspace);
  const live = isLive(run);
  const results = run?.outcome?.results ?? evaluation?.results;

  const forkName = workspace?.forkRepository.split("/")[1] ?? "";
  const gitStart = workspace
    ? `git clone https://github.com/${workspace.forkRepository}.git\ncd ${forkName}\ngit checkout ${workspace.branch}`
    : "";

  const tabSuffix = (t: Tab) => {
    if (t === "commits" && commits.length > 0) return ` · ${commits.length}`;
    if (t === "evaluate" && run) {
      if (run.status === "needs_env") return " · needs input";
      if (run.status === "running") return " · running";
      if (run.status === "error") return " · failed";
      return run.outcome?.verdict === "completed" ? " · passed" : " · not yet";
    }
    return "";
  };

  const refreshButton = (
    <button
      type="button"
      onClick={() => void refreshResult()}
      disabled={refreshing || busy !== "" || live}
      style={border}
      className="pm-btn inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[13px] font-semibold"
    >
      <RefreshCw
        size={14}
        className={refreshing ? "animate-spin" : ""}
        aria-hidden
      />
      {refreshing ? "Refreshing…" : "Refresh result"}
    </button>
  );

  const evaluateButton = (
    <button
      type="button"
      onClick={startEvaluate}
      disabled={busy !== "" || live || !workspace || commits.length === 0}
      style={{ ...border, backgroundColor: YELLOW, boxShadow: shadow(2) }}
      className="pm-btn inline-flex items-center gap-2 rounded-full px-5 py-2 text-[13px] font-bold"
    >
      {busy === "evaluate" || live ? (
        <RefreshCw size={14} className="animate-spin" aria-hidden />
      ) : (
        <Send size={14} aria-hidden />
      )}
      {busy === "evaluate" || live
        ? "Evaluating…"
        : run
          ? "Evaluate latest push again"
          : "Evaluate latest push"}
    </button>
  );

  return (
    <div
      style={{ fontFamily: BODY, color: INK, backgroundColor: PAPER }}
      className="flex min-h-screen w-full flex-col lg:h-screen lg:overflow-hidden"
    >
      <style>{CSS}</style>

      <header
        style={{ borderBottom: `2px solid ${INK}`, backgroundColor: "#fff" }}
        className="flex w-full shrink-0 items-center justify-between gap-4 px-4 py-2.5 sm:px-6"
      >
        <div className="flex min-w-0 items-center gap-4">
          <span
            style={{ fontFamily: DISPLAY }}
            className="text-[18px] font-bold"
          >
            pathway.io
          </span>
          {ready && pin && (
            <span
              className="hidden truncate text-[13px] sm:inline"
              style={{ color: MUTED }}
            >
              Mission · {pin.repository}
            </span>
          )}
        </div>
        <Link
          to={GOAL_ROUTE}
          style={border}
          className="pm-btn shrink-0 rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold"
        >
          Back to goal
        </Link>
      </header>

      {phase === "loading" && (
        <div
          className="flex flex-1 items-center justify-center text-[14px]"
          style={{ color: MUTED }}
        >
          Loading…
        </div>
      )}

      {phase === "generating" && (
        <StateCard title="Preparing your mission…">
          <RefreshCw size={20} className="mt-4 animate-spin" />
          <p className="mt-3 text-[14px] leading-relaxed text-neutral-700">
            Checking that the code your goal was built on still exists, reading
            your repository, and writing a mission with the files to work on and
            three test cases we will run. This can take up to a minute.
          </p>
        </StateCard>
      )}

      {phase === "empty" && (
        <StateCard title="No mission started">
          <p className="mt-2 text-[14px] text-neutral-700">
            Open your goal and choose Start mission.
          </p>
          <Link
            to={GOAL_ROUTE}
            style={{ ...border, backgroundColor: YELLOW, boxShadow: shadow() }}
            className="pm-btn mt-5 inline-block rounded-full px-5 py-2 text-[14px] font-bold"
          >
            Go to goal
          </Link>
        </StateCard>
      )}

      {phase === "error" && error && (
        <StateCard title={error.title} tone={RED}>
          <p
            role="alert"
            className="mt-2 text-[14px] leading-relaxed text-neutral-700"
          >
            {error.reason}
          </p>
          {error.errors.length > 0 && (
            <ul
              style={{ ...border, backgroundColor: SOFT_CORAL }}
              className="mt-4 list-disc space-y-1 rounded-2xl py-3 pl-8 pr-4 text-[12.5px] leading-snug"
            >
              {error.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            {error.retry && lastGoal.current && (
              <button
                type="button"
                onClick={() => create(lastGoal.current)}
                style={{
                  ...border,
                  backgroundColor: YELLOW,
                  boxShadow: shadow(),
                }}
                className="pm-btn rounded-full px-5 py-2 text-[14px] font-bold"
              >
                Try again
              </button>
            )}
            <Link
              to={GOAL_ROUTE}
              style={border}
              className="pm-btn rounded-full bg-white px-5 py-2 text-[14px] font-semibold"
            >
              Back to goal
            </Link>
          </div>
        </StateCard>
      )}

      {phase === "ready" && mission && spec && pin && (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* LEFT: brief */}
          <aside
            style={{ borderColor: INK, backgroundColor: "#fff" }}
            className="flex w-full shrink-0 flex-col border-b-2 lg:w-[440px] lg:border-b-0 lg:border-r-2"
          >
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip
                  fill={
                    finished
                      ? STATUS_META.completed.fill
                      : STATUS_META[status].fill
                  }
                >
                  {finished
                    ? STATUS_META.completed.label
                    : STATUS_META[status].label}
                </Chip>
                <Chip>~{spec.estimatedMinutes} min</Chip>
                {mission.focusSlug && (
                  <Chip fill={LAVENDER}>{pretty(mission.focusSlug)}</Chip>
                )}
              </div>
              <h1
                style={{ fontFamily: DISPLAY }}
                className="mt-3 text-[28px] font-bold leading-[1.1]"
              >
                {spec.title}
              </h1>

              <dl className="mt-4 space-y-3.5">
                <div>
                  <dt
                    className="text-[11px] font-bold uppercase tracking-wider"
                    style={{ color: MUTED }}
                  >
                    Why this mission
                  </dt>
                  <dd className="mt-0.5 text-[14px] leading-snug">
                    {spec.summary}{" "}
                    <button
                      type="button"
                      onClick={() => setTab("why")}
                      className="pm-link text-[13px] font-semibold underline"
                    >
                      See the evidence
                    </button>
                  </dd>
                </div>
                <div>
                  <dt
                    className="text-[11px] font-bold uppercase tracking-wider"
                    style={{ color: MUTED }}
                  >
                    Your task
                  </dt>
                  <dd className="mt-0.5 text-[17px] font-semibold leading-snug">
                    {spec.objective}
                  </dd>
                </div>
                <div>
                  <dt
                    className="text-[11px] font-bold uppercase tracking-wider"
                    style={{ color: MUTED }}
                  >
                    Success
                  </dt>
                  <dd
                    className="mt-0.5 text-[14px] leading-snug"
                    style={
                      finished ? { color: GREEN, fontWeight: 700 } : undefined
                    }
                  >
                    {finished
                      ? status === "completed"
                        ? "Complete. Recorded in your graph."
                        : "Complete. All test cases passed in the sandbox."
                      : `All ${spec.criteria.length} test cases pass when we run our tests against your pushed implementation. You don't write any tests.`}
                  </dd>
                </div>
              </dl>

              <div className="mt-4">
                <Section title="Where to build it">
                  <div className="flex flex-wrap items-center gap-2">
                    <GitBranch size={16} aria-hidden />
                    <a
                      href={`https://github.com/${pin.repository}`}
                      target="_blank"
                      rel="noreferrer"
                      className="pm-link text-[15px] font-bold underline"
                    >
                      {pin.repository}
                    </a>
                    <Chip mono>@ {short(pin.baseCommit)}</Chip>
                  </div>

                  {workspace ? (
                    <div className="mt-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="text-[11px] font-bold uppercase tracking-wider"
                          style={{ color: MUTED }}
                        >
                          Your branch
                        </span>
                        <a
                          href={`https://github.com/${workspace.forkRepository}/tree/${workspace.branch}`}
                          target="_blank"
                          rel="noreferrer"
                          className="pm-link text-[12.5px] font-bold underline"
                          style={{ fontFamily: MONO }}
                        >
                          {workspace.forkRepository}
                        </a>
                        <Chip fill={LAVENDER} mono>
                          {workspace.branch}
                        </Chip>
                      </div>
                      <div className="mb-1.5 mt-3 flex items-center justify-between">
                        <span
                          className="text-[11px] font-bold uppercase tracking-wider"
                          style={{ color: MUTED }}
                        >
                          Quick start
                        </span>
                        <CopyButton text={gitStart} label="Copy commands" />
                      </div>
                      <CodeView
                        content={gitStart}
                        plain
                        maxH={120}
                        label="Git commands"
                      />
                      <p
                        className="mt-2 text-[12.5px] leading-snug"
                        style={{ color: MUTED }}
                      >
                        Implement, commit and push to this branch. Your commits
                        show up in the Commits tab after you push.
                      </p>
                    </div>
                  ) : (
                    <p
                      className="mt-2 text-[12.5px] leading-snug"
                      style={{ color: MUTED }}
                    >
                      Press the button below. Pathway forks the repository into
                      your GitHub account and creates your working branch from
                      this exact commit.
                    </p>
                  )}
                </Section>

                <Section title="Files to work on">
                  <ul
                    className="space-y-1 text-[12.5px]"
                    style={{ fontFamily: MONO }}
                  >
                    {spec.scope.modifyPaths.map((p) => (
                      <li key={p}>
                        <span style={{ color: MUTED }}>edit </span>
                        {p}
                        {p.toLowerCase() ===
                          spec.scope.startPath.toLowerCase() && (
                          <span style={{ color: MUTED }}> (start here)</span>
                        )}
                      </li>
                    ))}
                    {spec.scope.createPaths.map((p) => (
                      <li key={p}>
                        <span style={{ color: GREEN }}>create </span>
                        {p}
                      </li>
                    ))}
                  </ul>
                  {spec.scope.outOfScope.length > 0 && (
                    <>
                      <h4
                        className="mb-1 mt-3 text-[11px] font-bold uppercase tracking-wider"
                        style={{ color: MUTED }}
                      >
                        Out of scope
                      </h4>
                      <ul className="space-y-0.5 text-[13px] text-neutral-700">
                        {spec.scope.outOfScope.map((o) => (
                          <li key={o}>{o}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </Section>

                <details
                  className="py-4"
                  style={{ borderTop: `1px solid ${LINE}` }}
                >
                  <summary
                    style={{ fontFamily: DISPLAY }}
                    className="cursor-pointer text-[15px] font-bold"
                  >
                    What the mission is based on
                  </summary>
                  <p className="mt-3 text-[13.5px] leading-relaxed">
                    {spec.grounding.gapStillOpen}
                  </p>
                  <h4
                    className="mb-1.5 mt-3 text-[11px] font-bold uppercase tracking-wider"
                    style={{ color: MUTED }}
                  >
                    Your code today · {spec.scope.startPath}
                  </h4>
                  <CodeView
                    content={spec.grounding.observedNow}
                    maxH={160}
                    label="Observed code"
                  />
                  <p className="mt-2 text-[12px]" style={{ color: MUTED }}>
                    Evidence: {spec.grounding.evidenceIds.join(", ")}
                  </p>
                </details>
              </div>
            </div>

            <div
              className="shrink-0 px-6 py-4"
              style={{ borderTop: `2px solid ${INK}` }}
            >
              {needsWorkspace && (
                <button
                  type="button"
                  onClick={startWithBranch}
                  disabled={busy !== ""}
                  style={{
                    ...border,
                    backgroundColor: YELLOW,
                    boxShadow: shadow(),
                  }}
                  className="pm-btn inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[14px] font-bold"
                >
                  {busy === "workspace" ? (
                    <RefreshCw size={15} className="animate-spin" aria-hidden />
                  ) : (
                    <Play size={15} aria-hidden />
                  )}
                  {busy === "workspace"
                    ? "Creating your branch…"
                    : "Start mission & create branch"}
                </button>
              )}
              {canWork && !needsWorkspace && (
                <button
                  type="button"
                  onClick={() => setTab("commits")}
                  style={{
                    ...border,
                    backgroundColor: YELLOW,
                    boxShadow: shadow(),
                  }}
                  className="pm-btn inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[14px] font-bold"
                >
                  <GitCommit size={15} aria-hidden />
                  View your commits
                </button>
              )}
              {finished && (
                <Link
                  to={GOAL_ROUTE}
                  style={{
                    ...border,
                    backgroundColor: YELLOW,
                    boxShadow: shadow(),
                  }}
                  className="pm-btn inline-flex w-full items-center justify-center rounded-full px-5 py-2.5 text-[14px] font-bold"
                >
                  Back to goal
                </Link>
              )}
              {note && (
                <p
                  role="alert"
                  className="mt-2 text-[12.5px]"
                  style={{ color: RED }}
                >
                  {note}
                </p>
              )}
              {!finished && (
                <div className="mt-2.5 flex gap-2.5">
                  <button
                    type="button"
                    onClick={() => discard("regenerate")}
                    disabled={busy !== "" || live}
                    style={border}
                    className="pm-btn inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-white px-4 py-2 text-[13px] font-semibold"
                  >
                    <RefreshCw size={13} aria-hidden />
                    Regenerate
                  </button>
                  <button
                    type="button"
                    onClick={() => discard("goal")}
                    disabled={busy !== "" || live}
                    style={border}
                    className="pm-btn inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-white px-4 py-2 text-[13px] font-semibold"
                  >
                    <Trash2 size={13} aria-hidden />
                    Discard
                  </button>
                </div>
              )}
            </div>
          </aside>

          {/* RIGHT: test cases / steps / why / commits / evaluation */}
          <main
            className="flex min-h-[520px] min-w-0 flex-1 flex-col"
            style={{ backgroundColor: PAPER }}
          >
            <div
              className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-2"
              style={{
                backgroundColor: "#fff",
                borderBottom: `2px solid ${INK}`,
              }}
            >
              {TAB_ORDER.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  style={{
                    ...border,
                    backgroundColor:
                      tab === t
                        ? YELLOW
                        : t === "evaluate" && run?.status === "needs_env"
                          ? SOFT_CORAL
                          : "#fff",
                    color: INK,
                  }}
                  className="pm-btn rounded-full px-3.5 py-1 text-[12px] font-bold"
                >
                  {TAB_LABEL[t]}
                  {tabSuffix(t)}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              {tab === "checks" && (
                <>
                  <FilesCard spec={spec} />
                  <div className="flex items-baseline justify-between">
                    <h2
                      style={{ fontFamily: DISPLAY }}
                      className="text-[20px] font-bold"
                    >
                      Test cases we will run
                    </h2>
                    <span className="text-[12px]" style={{ color: MUTED }}>
                      {run?.outcome && run.headSha
                        ? `last evaluated at ${short(run.headSha)}`
                        : evaluation
                          ? `last evaluated at ${short(evaluation.headCommit)}`
                          : `${spec.criteria.length} test cases`}
                    </span>
                  </div>
                  {spec.criteria.map((c, i) => (
                    <CriterionCard
                      key={c.id}
                      index={i}
                      criterion={c}
                      result={results?.find((r) => r.id === c.id)}
                    />
                  ))}
                  <DeliveryCard spec={spec} pin={pin} />
                  <div
                    style={{ ...border, backgroundColor: "#fff" }}
                    className="rounded-xl p-4"
                  >
                    <h3
                      style={{ fontFamily: DISPLAY }}
                      className="text-[15px] font-bold"
                    >
                      How it is verified
                    </h3>
                    <p className="mt-1.5 text-[13px] leading-snug text-neutral-700">
                      You only implement the files above and push. When you
                      press Evaluate, Pathway downloads your push, runs our
                      prepared tests for these test cases in an isolated Daytona
                      sandbox, and checks that the required library is really
                      used in your code. Your code never runs on Pathway's
                      servers.
                    </p>
                  </div>
                </>
              )}

              {tab === "steps" && (
                <>
                  {spec.contract && <ContractCard contract={spec.contract} />}
                  <h2
                    style={{ fontFamily: DISPLAY }}
                    className="text-[20px] font-bold"
                  >
                    How to do it
                  </h2>
                  <ol className="space-y-2.5">
                    {spec.steps.map((s, i) => (
                      <li
                        key={i}
                        style={{ ...border, backgroundColor: "#fff" }}
                        className="flex gap-3 rounded-xl p-3.5"
                      >
                        <span
                          style={{
                            ...border,
                            fontFamily: DISPLAY,
                            backgroundColor: YELLOW,
                          }}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                        >
                          {i + 1}
                        </span>
                        <p className="text-[14px] leading-snug">{s}</p>
                      </li>
                    ))}
                  </ol>
                  <h3
                    style={{ fontFamily: DISPLAY }}
                    className="pt-3 text-[16px] font-bold"
                  >
                    Skills this will show
                  </h3>
                  <ul className="space-y-2">
                    {spec.expectedSkills.map((s, i) => (
                      <li
                        key={i}
                        style={{ ...border, backgroundColor: CREAM }}
                        className="rounded-xl p-3.5 text-[13.5px] leading-snug"
                      >
                        {s.capabilityId && (
                          <div className="mb-1">
                            <Chip fill="#fff" mono>
                              {s.capabilityId}
                            </Chip>
                          </div>
                        )}
                        {s.evidence}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {tab === "why" && (
                <>
                  <h2
                    style={{ fontFamily: DISPLAY }}
                    className="text-[20px] font-bold"
                  >
                    Why Pathway recommended this mission
                  </h2>
                  <WhyPanel mission={mission} />
                </>
              )}

              {tab === "commits" && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2
                      style={{ fontFamily: DISPLAY }}
                      className="text-[20px] font-bold"
                    >
                      Your commits
                    </h2>
                    {workspace && (
                      <div className="flex items-center gap-2">
                        {syncedAt && (
                          <span
                            className="text-[12px]"
                            style={{ color: MUTED }}
                          >
                            synced {syncedAt}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => void loadCommits(mission.id)}
                          disabled={syncing}
                          style={border}
                          className="pm-btn inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[12px] font-semibold"
                        >
                          <RefreshCw
                            size={13}
                            className={syncing ? "animate-spin" : ""}
                            aria-hidden
                          />
                          Refresh
                        </button>
                      </div>
                    )}
                  </div>

                  {!workspace && (
                    <p
                      style={{ ...border, backgroundColor: CREAM }}
                      className="rounded-xl px-4 py-3 text-[13.5px] leading-snug"
                    >
                      No branch yet. Press “Start mission &amp; create branch”
                      on the left. Your commits on that branch will be listed
                      here.
                    </p>
                  )}

                  {workspace && (
                    <>
                      <div
                        style={{ ...border, backgroundColor: "#fff" }}
                        className="flex flex-wrap items-center gap-2 rounded-xl px-4 py-3"
                      >
                        <GitBranch size={15} aria-hidden />
                        <Chip fill={LAVENDER} mono>
                          {workspace.branch}
                        </Chip>
                        <span
                          className="text-[12.5px]"
                          style={{ color: MUTED }}
                        >
                          {commits.length} commit
                          {commits.length === 1 ? "" : "s"} since{" "}
                          {short(pin.baseCommit)}
                        </span>
                        {compareUrl && (
                          <a
                            href={compareUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="pm-link ml-auto text-[12.5px] font-semibold underline"
                          >
                            Open on GitHub
                          </a>
                        )}
                      </div>

                      {commitsNote && (
                        <p
                          role="alert"
                          style={{ ...border, backgroundColor: SOFT_CORAL }}
                          className="rounded-xl px-4 py-3 text-[13px] leading-snug"
                        >
                          {commitsNote}
                        </p>
                      )}

                      {commits.length === 0 && !commitsNote && (
                        <p className="text-[13.5px] text-neutral-600">
                          No commits yet. Commit on this branch and run{" "}
                          <code style={{ fontFamily: MONO }}>
                            git push origin {workspace.branch}
                          </code>
                          . This page checks GitHub every{" "}
                          {COMMIT_POLL_MS / 1000}s.
                        </p>
                      )}

                      <ol className="space-y-2">
                        {commits.map((c, i) => (
                          <li
                            key={c.sha}
                            style={{ ...border, backgroundColor: "#fff" }}
                            className="flex items-start gap-3 rounded-xl p-3.5"
                          >
                            <GitCommit
                              size={16}
                              className="mt-0.5 shrink-0"
                              aria-hidden
                            />
                            <div className="min-w-0 flex-1">
                              <p className="break-words text-[14px] font-semibold leading-snug">
                                {c.message || "(no message)"}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px]">
                                {c.url ? (
                                  <a
                                    href={c.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="pm-link font-bold underline"
                                    style={{ fontFamily: MONO }}
                                  >
                                    {short(c.sha)}
                                  </a>
                                ) : (
                                  <span
                                    className="font-bold"
                                    style={{ fontFamily: MONO }}
                                  >
                                    {short(c.sha)}
                                  </span>
                                )}
                                {c.author && (
                                  <span style={{ color: MUTED }}>
                                    {c.author}
                                  </span>
                                )}
                                {c.date && (
                                  <span style={{ color: MUTED }}>
                                    · {ago(c.date)}
                                  </span>
                                )}
                                {i === 0 && (
                                  <Chip fill={LIGHT_GREEN}>latest</Chip>
                                )}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ol>

                      {canWork && (
                        <div
                          style={{ ...border, backgroundColor: "#fff" }}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4"
                        >
                          <p
                            className="min-w-0 flex-1 text-[12.5px] leading-snug"
                            style={{ color: MUTED }}
                          >
                            When your implementation is pushed, we run our tests
                            against it in a sandbox: {spec.criteria.length} test
                            cases.
                          </p>
                          {evaluateButton}
                        </div>
                      )}

                      {run && (
                        <p className="text-[12.5px]" style={{ color: MUTED }}>
                          Latest evaluation:{" "}
                          <button
                            type="button"
                            onClick={() => setTab("evaluate")}
                            className="pm-link font-semibold underline"
                          >
                            open the Evaluation tab
                          </button>
                          .
                        </p>
                      )}
                    </>
                  )}
                </>
              )}

              {tab === "evaluate" && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2
                      style={{ fontFamily: DISPLAY }}
                      className="text-[20px] font-bold"
                    >
                      Evaluation
                    </h2>
                    <div className="flex flex-wrap items-center gap-2">
                      {(run || evaluation) && refreshButton}
                      {canWork && workspace && evaluateButton}
                    </div>
                  </div>

                  {runNote && (
                    <p
                      role="alert"
                      style={{ ...border, backgroundColor: SOFT_CORAL }}
                      className="rounded-xl px-4 py-3 text-[13px] leading-snug"
                    >
                      {runNote}
                    </p>
                  )}

                  {!run && evaluation && (
                    <div
                      style={{ ...border, backgroundColor: "#fff" }}
                      className="space-y-2 rounded-xl p-4"
                    >
                      <p className="text-[13px] font-bold">
                        Saved result · commit {short(evaluation.headCommit)}
                      </p>
                      <p className="text-[13px] leading-snug">
                        {evaluation.summary}
                      </p>
                      <ul className="space-y-0.5 text-[13px]">
                        {evaluation.results.map((r) => (
                          <li key={r.id}>
                            <GateMark ok={r.met} /> {r.id}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {!run && !runNote && !evaluation && (
                    <div
                      style={{ ...border, backgroundColor: "#fff" }}
                      className="space-y-2 rounded-xl p-4"
                    >
                      <p className="text-[13.5px] leading-snug">
                        {workspace
                          ? commits.length > 0
                            ? "Press “Evaluate latest push”. Here is what happens:"
                            : "Push a commit to your branch first. Then press “Evaluate latest push”. Here is what happens:"
                          : "Create your branch first. Then push your implementation and evaluate it. Here is what happens:"}
                      </p>
                      <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-snug">
                        <li>
                          Pathway downloads your pushed commit from GitHub.
                        </li>
                        <li>
                          Our prepared tests for the {spec.criteria.length} test
                          cases are loaded. You don't write any tests.
                        </li>
                        <li>
                          Your project is installed and, when needed, started in
                          an isolated sandbox. Missing environment values are
                          filled in automatically. You are only asked when your
                          server needs a real third-party secret.
                        </li>
                        <li>
                          The tests run against your files. Code, not the agent,
                          decides pass or fail.
                        </li>
                        <li>
                          You get either “Mission complete” with every test
                          listed, or a clear explanation of what to fix in your
                          files.
                        </li>
                      </ol>
                    </div>
                  )}

                  {run && (
                    <>
                      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                        {run.headSha && (
                          <Chip mono>commit {short(run.headSha)}</Chip>
                        )}
                        <Chip mono>{run.head}</Chip>
                        <span style={{ color: MUTED }}>
                          started {ago(run.startedAt)}
                          {run.status === "done" || run.status === "error"
                            ? ` · took ${Math.round(run.durationMs / 1000)}s`
                            : ""}
                        </span>
                      </div>

                      {run.status === "needs_env" && (
                        <EnvForm
                          keys={run.envRequest}
                          busy={busy === "env"}
                          note={envNote}
                          onSubmit={submitEnv}
                        />
                      )}

                      {run.status === "running" && (
                        <p
                          style={{ ...border, backgroundColor: CREAM }}
                          className="rounded-xl px-4 py-3 text-[13px] leading-snug"
                        >
                          Running in a Daytona sandbox. Installing and booting a
                          project can take a few minutes. You can leave this
                          tab, the run continues.
                          {run.envInfo.filled.length > 0 &&
                            ` ${run.envInfo.filled.length} environment value${run.envInfo.filled.length === 1 ? " was" : "s were"} filled in automatically.`}
                        </p>
                      )}

                      {run.status === "error" && (
                        <div
                          style={{
                            ...border,
                            backgroundColor: SOFT_CORAL,
                            boxShadow: shadow(3),
                          }}
                          className="rounded-2xl p-4"
                        >
                          <h3
                            style={{ fontFamily: DISPLAY }}
                            className="text-[18px] font-bold"
                          >
                            The evaluation could not finish
                          </h3>
                          <p className="mt-1.5 text-[13.5px] leading-snug">
                            {run.error}
                          </p>
                          {run.infra && (
                            <p className="mt-1.5 text-[12.5px]">
                              This looks like a problem on our side, not in your
                              code. Try again in a moment.
                            </p>
                          )}
                        </div>
                      )}

                      {run.status === "done" && run.outcome && (
                        <ResultPanel run={run} spec={spec} />
                      )}

                      <StepTimeline
                        steps={run.steps}
                        open={run.status !== "done"}
                      />

                      {run.status === "done" &&
                        run.outcome?.verdict === "completed" && (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => setShowGraphReveal(true)}
                              style={{ ...border, backgroundColor: "#fff" }}
                              className="pm-btn inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-[14px] font-bold"
                            >
                              <Sparkles size={14} aria-hidden />
                              See what changed in your graph
                            </button>
                            <Link
                              to={GOAL_ROUTE}
                              style={{
                                ...border,
                                backgroundColor: YELLOW,
                                boxShadow: shadow(3),
                              }}
                              className="pm-btn pm-pop inline-block rounded-full px-5 py-2 text-[14px] font-bold"
                            >
                              Back to your goal
                            </Link>
                          </div>
                        )}
                    </>
                  )}
                </>
              )}
            </div>
          </main>
        </div>
      )}

      {showGraphReveal && mission && run?.outcome?.verdict === "completed" && (
        <GraphUpdateReveal
          mission={mission}
          run={run}
          onClose={() => setShowGraphReveal(false)}
        />
      )}
    </div>
  );
}
