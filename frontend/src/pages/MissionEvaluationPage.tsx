/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable react-refresh/only-export-components */
/* eslint-disable @typescript-eslint/no-explicit-any */
// Place next to MissionPage.tsx.
//
// Everything about getting from "I have a mission" to "my commit is graded":
//   useMissionEvaluation  fork/branch setup, commits, live evaluation stream,
//                         the stored graph completion, and the uploaded env file
//   WorkspaceBrief        "Your branch" + "Your commits" (left column)
//   EvaluationActions     Fork / Run tests / Open branch (left column footer)
//   EnvUpload             upload a .env file (right column)
//   ResultsPanel          live pipeline, verdict, failure reason, per-check reasons
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, GitBranch, Play, RefreshCw } from "lucide-react";
import {
  LEVEL_LABEL,
  type MissionCompletionResult,
} from "./MissionCelebration";

const YELLOW = "#F5C542";
const INK = "#101210";
const LINE = "#DAD6CC";
const MUTED = "#6f6b61";
const GREEN = "#3FA24A";
const RED = "#a12c10";
const MONO = '"JetBrains Mono", "Fira Code", ui-monospace, Menlo, monospace';
const DISPLAY = '"Space Grotesk", "Arial Black", sans-serif';
const border = { border: `2px solid ${INK}` };
const shadow = (n = 3) => `${n}px ${n}px 0 0 ${INK}`;
const CODE_BG = "#0f1420";
const CODE_FG = "#d6deeb";
const MAX_ENV_CHARS = 100_000;

/* ---------- types (mirror the backend) ---------- */

export type MissionWorkspace = {
  forkFullName: string;
  forkUrl: string;
  cloneUrl: string;
  branchName: string;
  branchUrl: string;
  baseBranch: string;
  forked: boolean;
};

export type Commit = {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
};

export type CheckStatus = "passed" | "failed" | "unknown";

export type EvalStep = {
  id: string;
  title: string;
  status: "pending" | "running" | "done" | "failed" | "skipped" | "paused";
  detail?: string;
  command?: string;
  ms?: number;
};

export type Evaluation = {
  runId: string;
  status: "running" | "passed" | "failed" | "error";
  stage: string;
  stages?: string[];
  steps?: EvalStep[];
  sha: string;
  commitMessage?: string;
  commitCount?: number;
  startedAt: number;
  finishedAt?: number;
  plan?: {
    framework: string;
    root: string;
    packageManager: string;
    notes: string[];
    warnings: string[];
  };
  checks: { title: string; status: CheckStatus; message?: string }[];
  history?: { sha: string; status: "passed" | "failed" }[];
  diagnosis?: {
    kind: string;
    headline: string;
    hint?: string;
    explanation?: string;
  };
  /** set once a passing run has been written to the graph */
  completion?: MissionCompletionResult;
  log: string;
  error?: string;
};

const FALLBACK_STAGES = [
  "Finding your latest commit",
  "Reading your repository",
  "Checking what your server needs to boot",
  "Starting sandbox",
  "Installing dependencies",
  "Running the tests",
];

/* ---------- hook ---------- */

function useTicker(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function useMissionEvaluation(
  mission: { workspace?: MissionWorkspace } | null,
  onMission: (m: any) => void,
) {
  const enabled = !!mission?.workspace;

  const [commits, setCommits] = useState<Commit[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [storedCompletion, setStoredCompletion] =
    useState<MissionCompletionResult | null>(null);
  const [live, setLive] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [envKeys, setEnvKeys] = useState<string[]>([]);
  const [envError, setEnvError] = useState<string | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const reqId = useRef(0);

  const loadCommits = useCallback(async () => {
    const id = ++reqId.current;
    try {
      const res = await fetch("/api/mission/commits", {
        credentials: "include",
      });
      if (!res.ok || id !== reqId.current) return; // ignore out-of-order replies
      setCommits((await res.json()).commits ?? []);
      setLoaded(true);
    } catch {
      /* offline: keep what we have */
    }
  }, []);

  const loadEvaluation = useCallback(async () => {
    try {
      const r = await fetch("/api/mission/evaluation", {
        credentials: "include",
      });
      const b = r.ok ? await r.json() : null;
      if (b?.evaluation) setEvaluation(b.evaluation);
    } catch {
      /* ignore */
    }
  }, []);

  /** Restores the result after a server restart or page reload. */
  const loadCompletion = useCallback(async () => {
    try {
      const r = await fetch("/api/mission/completion", {
        credentials: "include",
      });
      const b = r.ok ? await r.json() : null;
      setStoredCompletion(b?.completion ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  /** Names of the variables in the uploaded env file (never the values). */
  const loadEnv = useCallback(async () => {
    try {
      const r = await fetch("/api/mission/env", { credentials: "include" });
      const b = r.ok ? await r.json() : null;
      setEnvKeys(b?.keys ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      // new / discarded mission: drop everything from the previous one
      setCommits([]);
      setLoaded(false);
      setEvaluation(null);
      setStoredCompletion(null);
      setEnvKeys([]);
      return;
    }
    loadCommits();
    loadEvaluation();
    loadCompletion();
    loadEnv();

    const es = new EventSource("/api/mission/events", {
      withCredentials: true,
    });
    es.onopen = () => {
      setLive(true);
      loadCommits(); // catch up on anything missed while disconnected
      loadEvaluation();
    };
    es.onerror = () => setLive(false);
    es.addEventListener("commit", () => loadCommits());
    es.addEventListener("evaluation", (e) => {
      try {
        const next: Evaluation = JSON.parse((e as MessageEvent).data);
        setEvaluation({ ...next });
        if (next.status !== "running") loadCommits();
      } catch {
        /* malformed event */
      }
    });

    // Fallback when the webhook can't reach this server (e.g. localhost).
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") loadCommits();
    }, 20000);
    const onVisible = () => {
      if (document.visibilityState === "visible") loadCommits();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      es.close();
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, loadCommits, loadEvaluation, loadCompletion, loadEnv]);

  /** Fork the repo and create the mission branch. */
  const setup = useCallback(async () => {
    setSettingUp(true);
    setSetupError(null);
    try {
      const res = await fetch("/api/mission/workspace", {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(body.error ?? "Could not set up the workspace");
      onMission(body.mission);
    } catch (e) {
      setSetupError(
        e instanceof Error ? e.message : "Could not set up the workspace",
      );
    } finally {
      setSettingUp(false);
    }
  }, [onMission]);

  /** Evaluate the latest commit on the branch. Resolves true when a run started. */
  const run = useCallback(async () => {
    setRunError(null);
    try {
      const res = await fetch("/api/mission/evaluate", {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not start the tests");
      setEvaluation(body.evaluation);
      return true;
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Could not start the tests");
      return false;
    }
  }, []);

  /** Send the text of the uploaded .env file. The backend parses it. */
  const uploadEnv = useCallback(async (content: string) => {
    setEnvError(null);
    if (content.length > MAX_ENV_CHARS) {
      setEnvError("That file is too large to be an env file.");
      return false;
    }
    try {
      const res = await fetch("/api/mission/env", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not read the env file");
      setEnvKeys(body.keys ?? []);
      return true;
    } catch (e) {
      setEnvError(
        e instanceof Error ? e.message : "Could not read the env file",
      );
      return false;
    }
  }, []);

  const removeEnv = useCallback(async () => {
    setEnvError(null);
    try {
      await fetch("/api/mission/env", {
        method: "DELETE",
        credentials: "include",
      });
      setEnvKeys([]);
    } catch {
      setEnvError("Could not remove the env file");
    }
  }, []);

  // a crashed run has no real verdict, so don't show it on the checks
  const finished =
    evaluation &&
    evaluation.status !== "running" &&
    evaluation.status !== "error"
      ? evaluation
      : null;

  return {
    commits,
    loaded,
    evaluation,
    live,
    runError,
    envKeys,
    envError,
    uploadEnv,
    removeEnv,
    settingUp,
    setupError,
    setup,
    run,
    refreshCommits: loadCommits,
    running: evaluation?.status === "running",
    noCommits: loaded && commits.length === 0,
    latestSha: commits[0]?.sha,
    /** live result of the current run, else the one stored in the graph */
    completion: (evaluation?.completion ??
      storedCompletion) as MissionCompletionResult | null,
    statusFor: (title: string): CheckStatus | undefined =>
      finished?.checks.find((c) => c.title === title)?.status,
    messageFor: (title: string): string | undefined =>
      finished?.checks.find((c) => c.title === title)?.message,
  };
}

export type MissionEvaluationApi = ReturnType<typeof useMissionEvaluation>;

/* ---------- small helpers ---------- */

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
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

/* ---------- left column: branch + commits ---------- */

export function CommitList({
  commits,
  evaluation,
  live,
}: {
  commits: Commit[];
  evaluation: Evaluation | null;
  live: boolean;
}) {
  if (!commits.length) {
    return (
      <p className="text-[13.5px] leading-relaxed text-neutral-700">
        No commits of yours on this branch yet. Push your work and it will
        appear here{live ? " right away." : " within 20 seconds."}
      </p>
    );
  }

  const verdicts = new Map(
    (evaluation?.history ?? []).map((h) => [h.sha, h.status]),
  );
  const stateOf = (sha: string) =>
    evaluation?.status === "running" && evaluation.sha === sha
      ? "testing"
      : verdicts.get(sha);

  const shown = commits.slice(0, 6);
  const total = evaluation?.commitCount ?? commits.length;

  return (
    <div>
      <ul className="space-y-2">
        {shown.map((c) => {
          const state = stateOf(c.sha);
          return (
            <li key={c.sha} className="flex items-baseline gap-2 text-[13px]">
              <a
                href={c.url}
                target="_blank"
                rel="noreferrer"
                className="pm-link shrink-0 underline"
                style={{ fontFamily: MONO }}
              >
                {c.sha.slice(0, 7)}
              </a>
              <span className="min-w-0 flex-1 truncate">
                {c.message || "(no message)"}
              </span>
              {state && (
                <span
                  className="shrink-0 font-bold"
                  style={{
                    color:
                      state === "passed"
                        ? GREEN
                        : state === "failed"
                          ? RED
                          : MUTED,
                  }}
                >
                  {state === "testing" ? "testing…" : state}
                </span>
              )}
              <span className="shrink-0 text-[12px]" style={{ color: MUTED }}>
                {ago(c.date)}
              </span>
            </li>
          );
        })}
      </ul>
      {total > shown.length && (
        <p className="mt-2 text-[12px]" style={{ color: MUTED }}>
          +{total - shown.length} older commits on your branch
        </p>
      )}
    </div>
  );
}

/** "Your branch" and "Your commits" sections. Renders nothing before the fork exists. */
export function WorkspaceBrief({
  workspace,
  ev,
}: {
  workspace?: MissionWorkspace;
  ev: MissionEvaluationApi;
}) {
  if (!workspace) return null;
  return (
    <>
      <Section title="Your branch">
        <p className="text-[13.5px] leading-relaxed text-neutral-700">
          {workspace.forked ? "Forked to " : "Created on "}
          <a
            href={workspace.forkUrl}
            target="_blank"
            rel="noreferrer"
            className="pm-link font-bold underline"
          >
            {workspace.forkFullName}
          </a>
          . Push your solution to this branch.
        </p>
        <pre
          className="mt-2 overflow-x-auto rounded-lg p-3 text-[12px] leading-[1.7]"
          style={{ fontFamily: MONO, backgroundColor: CODE_BG, color: CODE_FG }}
        >
          {`git clone ${workspace.cloneUrl}
cd ${workspace.forkFullName.split("/")[1]}
git checkout ${workspace.branchName}`}
        </pre>
      </Section>

      <Section title="Your commits">
        <CommitList
          commits={ev.commits}
          evaluation={ev.evaluation}
          live={ev.live}
        />
      </Section>
    </>
  );
}

/** Left column footer: Fork & branch, or Run tests + Open branch. */
export function EvaluationActions({
  workspace,
  ev,
  onStarted,
}: {
  workspace?: MissionWorkspace;
  ev: MissionEvaluationApi;
  /** called after a run starts, e.g. to switch to the Results tab */
  onStarted?: () => void;
}) {
  if (!workspace) {
    return (
      <>
        <button
          type="button"
          onClick={ev.setup}
          disabled={ev.settingUp}
          style={{ ...border, backgroundColor: GREEN, color: "#fff" }}
          className="pm-btn inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[14px] font-bold disabled:opacity-60"
        >
          <GitBranch size={14} />
          {ev.settingUp
            ? "Forking and creating branch…"
            : "Fork repo & create branch"}
        </button>
        {ev.setupError && (
          <p role="alert" className="mt-2 text-[12.5px]" style={{ color: RED }}>
            {ev.setupError}
          </p>
        )}
      </>
    );
  }

  const start = async () => {
    if (await ev.run()) onStarted?.();
  };

  return (
    <>
      <button
        type="button"
        onClick={start}
        disabled={ev.running || ev.noCommits}
        style={{ ...border, backgroundColor: YELLOW, boxShadow: shadow() }}
        className="pm-btn inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[14px] font-bold disabled:opacity-60"
      >
        {ev.running ? (
          <RefreshCw size={14} className="animate-spin" />
        ) : (
          <Play size={14} />
        )}
        {ev.running ? "Running tests…" : "Run tests"}
      </button>
      {ev.noCommits && !ev.running && (
        <p className="mt-2 text-[12.5px]" style={{ color: MUTED }}>
          Push a commit to {workspace.branchName} first.
        </p>
      )}
      {ev.runError && (
        <p role="alert" className="mt-2 text-[12.5px]" style={{ color: RED }}>
          {ev.runError}
        </p>
      )}
      <a
        href={workspace.branchUrl}
        target="_blank"
        rel="noreferrer"
        style={{ ...border, backgroundColor: GREEN, color: "#fff" }}
        className="pm-link mt-2.5 block w-full rounded-full px-5 py-2.5 text-center text-[14px] font-bold"
      >
        Open your branch on GitHub
      </a>
    </>
  );
}

/* ---------- right column: results ---------- */

const mark = (status: CheckStatus, running: boolean) =>
  running ? "○" : status === "passed" ? "✓" : status === "failed" ? "✕" : "?";
const markColor = (status: CheckStatus) =>
  status === "passed" ? GREEN : status === "failed" ? RED : MUTED;

function StepIcon({ status }: { status: EvalStep["status"] }) {
  const box = "flex h-[18px] w-[18px] shrink-0 items-center justify-center";
  if (status === "done")
    return (
      <span className={box}>
        <Check size={15} style={{ color: GREEN }} />
      </span>
    );
  if (status === "running")
    return (
      <span className={box}>
        <RefreshCw size={14} className="animate-spin" />
      </span>
    );
  if (status === "failed")
    return (
      <span className={box} style={{ color: RED, fontWeight: 700 }}>
        ✕
      </span>
    );
  return (
    <span className={box} style={{ color: MUTED }}>
      {status === "skipped" ? "–" : "○"}
    </span>
  );
}

function StepTimeline({ steps }: { steps: EvalStep[] }) {
  return (
    <ol>
      {steps.map((s, i) => {
        const dim = s.status === "pending" || s.status === "skipped";
        return (
          <li key={s.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <StepIcon status={s.status} />
              {i < steps.length - 1 && (
                <span
                  className="mt-1 w-px flex-1"
                  style={{ backgroundColor: LINE }}
                />
              )}
            </div>
            <div className="min-w-0 flex-1 pb-4">
              <div
                className="flex items-baseline gap-2 text-[14px]"
                style={{
                  color: dim ? MUTED : INK,
                  fontWeight: s.status === "running" ? 700 : 600,
                }}
              >
                {s.title}
                {s.ms !== undefined && (
                  <span
                    className="text-[12px] font-normal"
                    style={{ color: MUTED }}
                  >
                    {(s.ms / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
              {s.detail && (
                <p
                  className="mt-0.5 text-[13px] leading-relaxed"
                  style={{ color: s.status === "failed" ? RED : "#444" }}
                >
                  {s.detail}
                </p>
              )}
              {s.command && (
                <code
                  className="mt-1 block break-all rounded px-2 py-1 text-[11.5px]"
                  style={{
                    fontFamily: MONO,
                    backgroundColor: "#efece3",
                    color: INK,
                  }}
                >
                  $ {s.command}
                </code>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- env file upload (no key/value inputs) ---------- */

function EnvUpload({ env }: { env: MissionEvaluationApi }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-uploading the same file
    if (!file) return;
    setBusy(true);
    try {
      await env.uploadEnv(await file.text());
    } finally {
      setBusy(false);
    }
  };

  const has = env.envKeys.length > 0;

  return (
    <div
      className="rounded-xl p-4"
      style={{ ...border, backgroundColor: "#fff" }}
    >
      <div
        style={{ fontFamily: DISPLAY }}
        className="mb-1 text-[14px] font-bold"
      >
        Environment file (optional)
      </div>
      <p className="mb-3 text-[12.5px] leading-snug" style={{ color: MUTED }}>
        If your server needs values to start (database URL, secrets), upload
        your <code style={{ fontFamily: MONO }}>.env</code> file. Pathway reads
        the variables from it, then press Run tests.
      </p>

      {has && (
        <p
          className="mb-3 break-words text-[12.5px] leading-snug"
          style={{ fontFamily: MONO }}
        >
          <b>{env.envKeys.length} variables loaded:</b> {env.envKeys.join(", ")}
        </p>
      )}

      {env.envError && (
        <p role="alert" className="mb-2 text-[12.5px]" style={{ color: RED }}>
          {env.envError}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={pick}
        aria-label="Upload env file"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || env.running}
          onClick={() => inputRef.current?.click()}
          style={{ ...border, backgroundColor: YELLOW, boxShadow: shadow() }}
          className="pm-btn rounded-full px-5 py-2 text-[14px] font-bold disabled:opacity-60"
        >
          {busy ? "Reading…" : has ? "Replace .env file" : "Upload .env file"}
        </button>
        {has && (
          <button
            type="button"
            disabled={busy || env.running}
            onClick={env.removeEnv}
            style={{ ...border, backgroundColor: "#fff" }}
            className="pm-btn rounded-full px-5 py-2 text-[14px] font-bold disabled:opacity-60"
          >
            Remove
          </button>
        )}
      </div>

      <p className="mt-3 text-[12px] leading-snug" style={{ color: MUTED }}>
        Values are used only inside the temporary sandbox for this mission and
        are hidden from the logs and from this page. Use a throwaway or dev
        database, never production credentials. PORT is ignored.
      </p>
    </div>
  );
}

export function ResultsPanel({
  evaluation,
  latestSha,
  env,
  completion,
  onReview,
}: {
  evaluation: Evaluation | null;
  latestSha?: string;
  /** pass the object returned by useMissionEvaluation to enable env upload */
  env?: MissionEvaluationApi;
  /** the graph update written when this mission passed */
  completion?: MissionCompletionResult | null;
  /** replay the celebration */
  onReview?: () => void;
}) {
  const running = evaluation?.status === "running";
  const now = useTicker(!!running);

  if (!evaluation) {
    return (
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        {completion && (
          <CompletionCard completion={completion} onReview={onReview} />
        )}
        <div className="text-[14px]" style={{ color: MUTED }}>
          Push your solution to your branch, then press Run tests. Pushes are
          tested automatically once the GitHub webhook is set up.
        </div>
        {env && <EnvUpload env={env} />}
      </div>
    );
  }

  const failing = evaluation.checks.filter((c) => c.status === "failed").length;
  const headline = running
    ? `${evaluation.stage}…`
    : evaluation.status === "error"
      ? (evaluation.diagnosis?.headline ??
        evaluation.error ??
        "The run stopped.")
      : (evaluation.diagnosis?.headline ??
        (evaluation.status === "passed"
          ? `All ${evaluation.checks.length} checks pass.`
          : `${failing} of ${evaluation.checks.length} checks failing.`));
  const color = evaluation.status === "passed" ? GREEN : running ? INK : RED;

  const stages = evaluation.stages?.length
    ? evaluation.stages
    : FALLBACK_STAGES;
  const stageIdx = Math.max(0, stages.indexOf(evaluation.stage));
  const seconds = Math.max(
    0,
    Math.round(((evaluation.finishedAt ?? now) - evaluation.startedAt) / 1000),
  );
  const stale =
    !running && !!latestSha && !!evaluation.sha && latestSha !== evaluation.sha;

  const plan = evaluation.plan;
  const diagnosis = evaluation.diagnosis;
  const showDiagnosis =
    !running &&
    diagnosis &&
    diagnosis.kind !== "passed" &&
    (diagnosis.hint || diagnosis.explanation);

  // the server could not start (or the run errored): let the user upload an env file
  const showEnvUpload =
    !!env &&
    !running &&
    (evaluation.status === "error" ||
      evaluation.diagnosis?.kind === "server" ||
      env.envKeys.length > 0);

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
      {completion && (
        <CompletionCard completion={completion} onReview={onReview} />
      )}

      <div>
        <h2
          style={{ fontFamily: DISPLAY, color }}
          className="text-[20px] font-bold"
          aria-live="polite"
        >
          {headline}
        </h2>
        {evaluation.sha && (
          <p
            className="mt-1 truncate text-[12px]"
            style={{ fontFamily: MONO, color: MUTED }}
          >
            commit {evaluation.sha.slice(0, 7)}
            {evaluation.commitMessage ? ` · ${evaluation.commitMessage}` : ""}
            {!running && evaluation.finishedAt ? ` · ${seconds}s` : ""}
          </p>
        )}
        {plan && (
          <p
            className="mt-0.5 truncate text-[12px]"
            style={{ fontFamily: MONO, color: MUTED }}
          >
            {plan.framework} · {plan.root ? `${plan.root}/` : "repo root"} ·{" "}
            {plan.packageManager}
          </p>
        )}
      </div>

      {stale && (
        <p
          className="rounded-lg px-3 py-2 text-[13px]"
          style={{ backgroundColor: "#fff7dd", border: `1px solid ${LINE}` }}
        >
          You pushed newer commits since this run. Press Run tests to check your
          latest.
        </p>
      )}

      {showDiagnosis && (
        <div
          className="rounded-xl p-4 text-[13.5px] leading-relaxed"
          style={{ ...border, borderColor: RED, backgroundColor: "#fff" }}
        >
          <div
            style={{ fontFamily: DISPLAY }}
            className="mb-1 text-[14px] font-bold"
          >
            Why it failed
          </div>
          {diagnosis?.hint && (
            <p className="whitespace-pre-wrap break-words">{diagnosis.hint}</p>
          )}
          {diagnosis?.explanation && (
            <p className="mt-2 whitespace-pre-wrap text-neutral-700">
              {diagnosis.explanation}
            </p>
          )}
        </div>
      )}

      {showEnvUpload && <EnvUpload env={env!} />}

      {evaluation.steps?.length ? (
        <details open={running || evaluation.status !== "passed"}>
          <summary
            style={{ fontFamily: DISPLAY }}
            className="mb-3 cursor-pointer text-[14px] font-bold"
          >
            What the agent did, step by step
          </summary>
          <StepTimeline steps={evaluation.steps} />
        </details>
      ) : (
        running && (
          <ol className="space-y-1.5 text-[14px]">
            {stages.map((s, i) => (
              <li
                key={s}
                className="flex items-center gap-2"
                style={{ color: i > stageIdx ? MUTED : INK }}
              >
                {i < stageIdx ? (
                  <Check size={14} style={{ color: GREEN }} />
                ) : i === stageIdx ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <span aria-hidden className="w-[14px] text-center">
                    ○
                  </span>
                )}
                {s}
              </li>
            ))}
          </ol>
        )
      )}

      {plan?.warnings && plan.warnings.length > 0 && !running && (
        <ul className="space-y-1 text-[12.5px]" style={{ color: MUTED }}>
          {plan.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}

      {evaluation.status !== "error" && (
        <ul className="space-y-2 text-[14px]">
          {evaluation.checks.map((c) => (
            <li key={c.title}>
              <div className="flex gap-2">
                <span aria-hidden style={{ color: markColor(c.status) }}>
                  {mark(c.status, !!running)}
                </span>
                {c.title}
              </div>
              {!running && c.status === "failed" && c.message && (
                <p
                  className="ml-6 mt-0.5 text-[12.5px] leading-snug"
                  style={{ fontFamily: MONO, color: RED }}
                >
                  {c.message}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {evaluation.log && (
        <details open={evaluation.status === "error"}>
          <summary
            style={{ fontFamily: DISPLAY }}
            className="cursor-pointer text-[14px] font-bold"
          >
            Test output
          </summary>
          <pre
            className="pm-code mt-2 max-h-[420px] overflow-auto rounded-lg p-3 text-[12px] leading-[1.6]"
            style={{
              fontFamily: MONO,
              backgroundColor: CODE_BG,
              color: CODE_FG,
              border: `1px solid ${LINE}`,
            }}
          >
            {evaluation.log}
          </pre>
        </details>
      )}
    </div>
  );
}

/** "Recorded in your graph" summary with a replay button. */
function CompletionCard({
  completion,
  onReview,
}: {
  completion: MissionCompletionResult;
  onReview?: () => void;
}) {
  return (
    <div
      className="pm-pop rounded-xl p-4"
      style={{ ...border, borderColor: GREEN, backgroundColor: "#fff" }}
    >
      <div style={{ fontFamily: DISPLAY }} className="text-[15px] font-bold">
        Recorded in your graph
      </div>
      <p className="mt-1 text-[13px] leading-relaxed">
        {completion.capability.name}:{" "}
        {LEVEL_LABEL[completion.capability.before.level] ??
          completion.capability.before.level}{" "}
        →{" "}
        <b>
          {LEVEL_LABEL[completion.capability.after.level] ??
            completion.capability.after.level}
        </b>{" "}
        · {completion.counts.nodesCreated} nodes,{" "}
        {completion.counts.relationshipsWritten} relationships
      </p>
      {onReview && (
        <button
          type="button"
          onClick={onReview}
          style={{ ...border, backgroundColor: YELLOW }}
          className="pm-btn mt-2 rounded-full px-4 py-1 text-[12px] font-bold"
        >
          Replay what changed
        </button>
      )}
    </div>
  );
}
