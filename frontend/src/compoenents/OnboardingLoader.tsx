/* eslint-disable react-refresh/only-export-components */
import { useState } from "react";
import {
  Check,
  Loader2,
  Lock,
  ChevronRight,
  ChevronDown,
} from "lucide-react";

const DISPLAY_FONT = '"Space Grotesk", "Arial Black", sans-serif';
const BODY_FONT = '"Inter", "Helvetica Neue", sans-serif';
const MONO_FONT = '"IBM Plex Mono", "SF Mono", monospace';

const YELLOW = "#F5C542";
const CORAL = "#F2704F";
const GREEN = "#3FA24A";
const SKY = "#5FA0D8";
const INK = "#101210";
const PAPER = "#F1EEE7";
const LINE = "#DAD6CC";
const CARD = "#E9E5DB";

const hardShadow = (size = 4) => `${size}px ${size}px 0 0 ${INK}`;
const cartoonBorder = { border: `2px solid ${INK}` };

export interface OnboardingStage {
  key: string;
  label: string;
  status: "pending" | "active" | "done" | "error";
  detail?: string;
}

export interface OnboardingStats {
  repositories: number;
  commitsDiscovered: number;
  commitsProcessed: number;
  filesAnalyzed: number;
}

export interface EvidenceItem {
  id: string;
  repo: string;
  sha: string;
  message: string;
  files: number;
}

const STAGE_ORDER: Array<{ key: string; label: string }> = [
  { key: "sync:connecting", label: "Connecting to GitHub" },
  { key: "sync:repos_found", label: "Listing repositories" },
  { key: "sync:commits_discovered", label: "Discovering commits & PRs" },
  { key: "sync:sync_progress", label: "Pulling code evidence" },
  { key: "sync:writing", label: "Writing evidence to the graph" },
  { key: "skills:loading_evidence", label: "Loading authored code" },
  { key: "skills:classifying", label: "Detecting technology signals" },
  { key: "skills:scoring", label: "Scoring depth of evidence" },
  { key: "skills:saving", label: "Saving your skill graph" },
];

export function stagesFromEvents(
  seenStages: Set<string>,
  currentStage: string | null,
  errored: boolean,
): OnboardingStage[] {
  const currentIndex = STAGE_ORDER.findIndex((s) => s.key === currentStage);

  return STAGE_ORDER.map((s, i) => {
    let status: OnboardingStage["status"] = "pending";
    if (errored && s.key === currentStage) status = "error";
    else if (seenStages.has(s.key) && i < currentIndex) status = "done";
    else if (s.key === currentStage) status = "active";
    else if (currentIndex === -1 && seenStages.has(s.key)) status = "done";
    return { key: s.key, label: s.label, status };
  });
}

type Phase = {
  id: string;
  stageKeys: string[];
  title: string;
  shortReason: string;
  reason: string;
  fields: Array<{ name: string; why: string }>;
  resultLine: (stats: OnboardingStats) => string | null;
};

const PHASES: Phase[] = [
  {
    id: "repos",
    stageKeys: ["sync:connecting", "sync:repos_found"],
    title: "Finding what you've built",
    shortReason: "Listing every repository you own",
    reason:
      "We start by listing every repository you own. This defines the full scope of evidence we'll draw from, not just one project you might link manually.",
    fields: [
      { name: "Repository name & description", why: "identify each project" },
      { name: "Primary language & stars", why: "weight relevance, not vanity" },
      {
        name: "Created / pushed timestamps",
        why: "separate active work from archived",
      },
    ],
    resultLine: (s) =>
      s.repositories > 0
        ? `Found ${s.repositories} repositor${s.repositories === 1 ? "y" : "ies"} to read from.`
        : null,
  },
  {
    id: "commits",
    stageKeys: ["sync:commits_discovered"],
    title: "Finding your commits",
    shortReason: "Every commit is verifiable proof you wrote it",
    reason:
      "Every commit is a timestamped, verifiable record that you personally wrote it. This is what lets us measure real depth instead of inferring it from a bio or resume.",
    fields: [
      { name: "Commit SHA & message", why: "unique, tamper-evident reference" },
      { name: "Author + timestamp", why: "confirm it's you, and when" },
      { name: "Pull requests you opened", why: "collaboration context only" },
    ],
    resultLine: (s) =>
      s.commitsDiscovered > 0
        ? `Discovered ${s.commitsDiscovered} commits authored by you.`
        : null,
  },
  {
    id: "diffs",
    stageKeys: ["sync:sync_progress"],
    title: "Reading the actual code",
    shortReason: "Reading added/removed lines, not just filenames",
    reason:
      "We don't just note which files changed — we read the added and removed lines themselves. That's the difference between 'touched a file' and 'built the feature'.",
    fields: [
      {
        name: "Line-level diffs (added/removed)",
        why: "the actual evidence of skill",
      },
      {
        name: "File path & language",
        why: "attribute evidence to a technology",
      },
      { name: "Additions / deletions count", why: "gauge scale of the change" },
    ],
    resultLine: (s) =>
      s.commitsProcessed > 0
        ? `Analyzed ${s.commitsProcessed} commits, ${s.filesAnalyzed} files of authored code.`
        : null,
  },
  {
    id: "graph",
    stageKeys: ["sync:writing"],
    title: "Saving it as memory, not a snapshot",
    shortReason: "Writing evidence into a persistent, traceable graph",
    reason:
      "This evidence gets written into a persistent graph. Every skill we later show you can be traced back to the exact commit that proves it — nothing is summarized away.",
    fields: [
      {
        name: "README & manifest (package.json, etc.)",
        why: "product context only, never scored",
      },
      { name: "Graph relationships", why: "commit → file → repository → you" },
    ],
    resultLine: () => null,
  },
  {
    id: "skills",
    stageKeys: [
      "skills:loading_evidence",
      "skills:classifying",
      "skills:scoring",
      "skills:saving",
    ],
    title: "Turning evidence into skills",
    shortReason: "Scoring depth from what you actually shipped",
    reason:
      "Finally, we classify the languages and patterns in your diffs and score how deep your experience actually goes in each one — grounded entirely in what you shipped, not what you claim.",
    fields: [
      {
        name: "Technology signals per diff",
        why: "classify what was actually used",
      },
      {
        name: "Depth score per skill",
        why: "weighted by volume + recency of evidence",
      },
    ],
    resultLine: () => null,
  },
];

function phaseStatus(
  phase: Phase,
  stages: OnboardingStage[],
): "pending" | "active" | "done" | "error" {
  const relevant = stages.filter((s) => phase.stageKeys.includes(s.key));
  if (relevant.some((s) => s.status === "error")) return "error";
  if (relevant.some((s) => s.status === "active")) return "active";
  if (relevant.length > 0 && relevant.every((s) => s.status === "done"))
    return "done";
  return "pending";
}

export default function OnboardingLoader({
  stages,
  liveDetail,
  isComplete,
  isError,
  errorMessage,
  stats,
  currentRepo,
  evidenceFeed = [],
}: {
  stages: OnboardingStage[];
  liveDetail: string;
  isComplete: boolean;
  isError: boolean;
  errorMessage?: string;
  stats: OnboardingStats;
  currentRepo?: string;
  evidenceFeed?: EvidenceItem[];
}) {
  const doneCount = stages.filter((s) => s.status === "done").length;
  const progressPct = isComplete
    ? 100
    : Math.round((doneCount / stages.length) * 100);

  const [expandedFields, setExpandedFields] = useState<string | null>(null);
  // Manually-expanded done/pending phases (user clicked to peek at them)
  const [manuallyExpanded, setManuallyExpanded] = useState<Set<string>>(
    () => new Set(),
  );

  const activePhase =
    PHASES.find((p) => phaseStatus(p, stages) === "active") ?? PHASES[0];

  const toggleManual = (id: string) => {
    setManuallyExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div
      style={{ fontFamily: BODY_FONT, color: INK, backgroundColor: PAPER }}
      className="min-h-screen"
    >
      <header
        style={{ borderBottom: `2px solid ${INK}`, backgroundColor: PAPER }}
        className="sticky top-0 z-10"
      >
        <div className="flex w-full items-center justify-between px-3 py-3">
          <div className="flex items-center gap-2">
            <PathwayMark />
            <span
              style={{ fontFamily: DISPLAY_FONT }}
              className="text-[16px] font-bold tracking-tight"
            >
              pathway.io
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-neutral-600">
            <span
              style={{
                backgroundColor: isComplete ? GREEN : isError ? CORAL : YELLOW,
              }}
              className={`h-1.5 w-1.5 rounded-full ${
                !isComplete && !isError ? "animate-pulse" : ""
              }`}
            />
            {isComplete ? "Synced" : isError ? "Failed" : "Syncing…"}
          </div>
        </div>
      </header>

      <main className="w-full px-3 py-4">
        {/* HERO — compact */}
        <div
          style={{
            ...cartoonBorder,
            backgroundColor: INK,
            boxShadow: hardShadow(4),
          }}
          className="rounded-2xl p-4 text-white lg:p-5"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 flex-1">
              <div
                className="flex items-center gap-2 text-[11px] font-bold tracking-wide"
                style={{ color: YELLOW }}
              >
                <span
                  style={{
                    backgroundColor: isComplete
                      ? GREEN
                      : isError
                        ? CORAL
                        : YELLOW,
                  }}
                  className="h-1.5 w-1.5 rounded-full"
                />
                {isComplete
                  ? "GRAPH READY"
                  : isError
                    ? "SOMETHING WENT WRONG"
                    : "BUILDING YOUR GRAPH"}
              </div>

              <h1
                style={{ fontFamily: DISPLAY_FONT }}
                className="mt-1.5 text-[22px] font-bold leading-tight lg:text-[27px]"
              >
                {isComplete
                  ? "Your skill graph is ready"
                  : isError
                    ? "Onboarding hit a snag"
                    : "Reading your GitHub history"}
              </h1>

              <p className="mt-1.5 max-w-[75ch] text-[12.5px] leading-relaxed text-neutral-200">
                {isError
                  ? errorMessage
                  : isComplete
                    ? "Taking you to your graph now."
                    : "Left: what's happening and why. Right: exactly what's being read, live. 1–3 minutes, no action needed."}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <div className="text-right">
                <div
                  style={{ fontFamily: DISPLAY_FONT }}
                  className="text-[28px] font-bold leading-none"
                >
                  {progressPct}
                  <span className="text-[14px] text-neutral-300">%</span>
                </div>
                <div className="mt-0.5 text-[10px] text-neutral-300">
                  step {Math.min(doneCount + 1, stages.length)}/{stages.length}
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              backgroundColor: "rgba(255,255,255,0.12)",
              border: `1.5px solid rgba(255,255,255,0.25)`,
            }}
            className="mt-3 h-2 w-full overflow-hidden rounded-full"
          >
            <div
              style={{
                backgroundColor: isError ? CORAL : YELLOW,
                width: `${progressPct}%`,
              }}
              className="h-full rounded-full transition-all duration-700 ease-out"
            />
          </div>
        </div>

        {/* TWO-COLUMN BODY */}
        <div className="mt-4 grid gap-4 lg:grid-cols-12">
          {/* LEFT — accordion journey: only the active phase is expanded */}
          <div className="lg:col-span-7">
            <div
              style={{
                ...cartoonBorder,
                backgroundColor: "#fff",
                boxShadow: hardShadow(4),
              }}
              className="rounded-2xl p-4 lg:p-5"
            >
              <h2
                style={{ fontFamily: DISPLAY_FONT }}
                className="text-[12.5px] font-bold uppercase tracking-wide text-neutral-500"
              >
                What's happening, step by step
              </h2>

              <div className="relative mt-3">
                {PHASES.map((phase, index) => {
                  const status = phaseStatus(phase, stages);
                  const resultLine = phase.resultLine(stats);
                  const isLast = index === PHASES.length - 1;
                  const fieldsOpen = expandedFields === phase.id;
                  const isExpanded =
                    status === "active" || manuallyExpanded.has(phase.id);

                  return (
                    <div key={phase.id} className="relative flex gap-3">
                      <div className="flex flex-col items-center">
                        <PhaseIcon status={status} />
                        {!isLast && (
                          <span
                            style={{
                              backgroundColor: status === "done" ? GREEN : LINE,
                            }}
                            className="mt-1 w-0.5 flex-1 rounded-full transition-colors duration-500"
                          />
                        )}
                      </div>

                      <div className="min-w-0 flex-1 pb-4">
                        {/* Row header — always visible, always high contrast */}
                        <button
                          onClick={() => toggleManual(phase.id)}
                          className="flex w-full items-start justify-between gap-3 pt-0.5 text-left"
                        >
                          <div className="min-w-0">
                            <h3
                              style={{ fontFamily: DISPLAY_FONT }}
                              className="text-[15px] font-bold leading-tight text-black"
                            >
                              {phase.title}
                            </h3>
                            {!isExpanded && (
                              <p className="mt-0.5 truncate text-[12px] font-medium text-neutral-600">
                                {resultLine ?? phase.shortReason}
                              </p>
                            )}
                          </div>

                          {status !== "active" && (
                            <ChevronDown
                              size={15}
                              className="mt-1 shrink-0 text-neutral-500"
                              style={{
                                transform: isExpanded
                                  ? "rotate(180deg)"
                                  : "rotate(0deg)",
                                transition: "transform 0.15s ease",
                              }}
                            />
                          )}
                        </button>

                        {/* Expanded content — only for active, or manually opened */}
                        {isExpanded && (
                          <div className="mt-1.5">
                            <p className="max-w-[62ch] text-[12.5px] font-medium leading-relaxed text-neutral-700">
                              {phase.reason}
                            </p>

                            {status === "active" && (
                              <div className="mt-2 flex items-center gap-2">
                                <Loader2
                                  size={12}
                                  className="shrink-0 animate-spin"
                                  style={{ color: "#B8860B" }}
                                />
                                <span
                                  style={{ fontFamily: MONO_FONT }}
                                  className="truncate text-[11.5px] font-medium text-neutral-600"
                                >
                                  {currentRepo
                                    ? `Reading ${currentRepo}…`
                                    : liveDetail || "Working…"}
                                </span>
                              </div>
                            )}

                            {resultLine && (
                              <div
                                style={{
                                  backgroundColor: CARD,
                                  ...cartoonBorder,
                                }}
                                className="mt-2.5 inline-flex items-center gap-2 rounded-full px-3 py-1.5"
                              >
                                <Check
                                  size={12}
                                  strokeWidth={3}
                                  style={{ color: GREEN }}
                                />
                                <span
                                  style={{ fontFamily: MONO_FONT }}
                                  className="text-[12px] font-bold text-black"
                                >
                                  {resultLine}
                                </span>
                              </div>
                            )}

                            <button
                              onClick={() =>
                                setExpandedFields(fieldsOpen ? null : phase.id)
                              }
                              className="mt-2 flex items-center gap-1 text-[11px] font-bold text-neutral-500 hover:text-black"
                            >
                              <ChevronRight
                                size={12}
                                style={{
                                  transform: fieldsOpen
                                    ? "rotate(90deg)"
                                    : "rotate(0deg)",
                                  transition: "transform 0.15s ease",
                                }}
                              />
                              {fieldsOpen ? "Hide" : "Show"} exact fields read
                            </button>

                            {fieldsOpen && (
                              <div
                                className="mt-2 space-y-1.5 border-l-2 pl-3"
                                style={{ borderColor: LINE }}
                              >
                                {phase.fields.map((f) => (
                                  <div key={f.name} className="text-[11.5px]">
                                    <span className="font-bold text-neutral-800">
                                      {f.name}
                                    </span>
                                    <span className="font-medium text-neutral-500">
                                      {" "}
                                      — {f.why}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div
              style={{
                ...cartoonBorder,
                backgroundColor: INK,
                boxShadow: hardShadow(3),
              }}
              className="mt-3 flex items-center gap-3 rounded-xl p-3.5 text-white"
            >
              <span
                style={{ backgroundColor: SKY, ...cartoonBorder }}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
              >
                <Lock size={12} color="#fff" />
              </span>
              <p className="text-[12px] font-medium leading-relaxed text-neutral-200">
                Read-only access the whole way through — nothing is ever pushed,
                edited, or deleted in your repos. Revoke anytime from GitHub
                settings.
              </p>
            </div>
          </div>

          {/* RIGHT — sticky ledger */}
          <div className="lg:col-span-5">
            <div className="flex flex-col gap-3 lg:sticky lg:top-[60px]">
              <div
                style={{
                  ...cartoonBorder,
                  backgroundColor: "#fff",
                  boxShadow: hardShadow(4),
                }}
                className="rounded-2xl p-4"
              >
                <h2
                  style={{ fontFamily: DISPLAY_FONT }}
                  className="text-[12.5px] font-bold uppercase tracking-wide text-neutral-500"
                >
                  Right now
                </h2>

                <p className="mt-1.5 text-[13.5px] font-bold leading-snug text-black">
                  {isComplete
                    ? "All evidence captured and scored."
                    : isError
                      ? "Sync stopped before finishing."
                      : activePhase.title}
                </p>

                {!isComplete && !isError && (
                  <p className="mt-1 text-[12px] font-medium leading-relaxed text-neutral-600">
                    {activePhase.shortReason}
                  </p>
                )}

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <MiniStat label="Repos" value={stats.repositories} />
                  <MiniStat
                    label="Commits found"
                    value={stats.commitsDiscovered}
                  />
                  <MiniStat
                    label="Commits read"
                    value={stats.commitsProcessed}
                  />
                  <MiniStat label="Files read" value={stats.filesAnalyzed} />
                </div>
              </div>

              <div
                style={{
                  ...cartoonBorder,
                  backgroundColor: INK,
                  boxShadow: hardShadow(4),
                }}
                className="overflow-hidden rounded-2xl"
              >
                <div
                  style={{ borderBottom: `1.5px solid rgba(255,255,255,0.2)` }}
                  className="flex items-center justify-between px-4 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-1.5 w-1.5 rounded-full animate-pulse"
                      style={{ backgroundColor: GREEN }}
                    />
                    <span
                      style={{ fontFamily: MONO_FONT, color: YELLOW }}
                      className="text-[11px] font-bold tracking-wide"
                    >
                      EVIDENCE, AS IT'S READ
                    </span>
                  </div>
                  <span className="text-[10.5px] font-medium text-neutral-300">
                    {evidenceFeed.length} captured
                  </span>
                </div>

                <div className="max-h-[300px] space-y-2.5 overflow-y-auto p-3.5">
                  {evidenceFeed.length === 0 ? (
                    <p
                      style={{ fontFamily: MONO_FONT }}
                      className="text-[12px] font-medium text-neutral-300"
                    >
                      Waiting for the first commit…
                    </p>
                  ) : (
                    evidenceFeed.map((item) => (
                      <div key={item.id} className="text-[11.5px]">
                        <div
                          style={{ fontFamily: MONO_FONT }}
                          className="flex items-center gap-2 text-neutral-300"
                        >
                          <span
                            style={{ color: SKY }}
                            className="font-semibold"
                          >
                            {item.repo}
                          </span>
                          <span>@</span>
                          <span
                            style={{ color: YELLOW }}
                            className="font-semibold"
                          >
                            {item.sha}
                          </span>
                          <span className="text-neutral-400">
                            · {item.files} file{item.files === 1 ? "" : "s"}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate font-medium text-neutral-100">
                          {item.message || "(no message)"}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div
                style={{
                  ...cartoonBorder,
                  backgroundColor: "#fff",
                  boxShadow: hardShadow(3),
                }}
                className="rounded-2xl p-3.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-bold text-black">
                    Raw pipeline steps
                  </span>
                  <span
                    style={{ backgroundColor: CARD, ...cartoonBorder }}
                    className="rounded-full px-2 py-0.5 text-[10px] font-bold text-black"
                  >
                    {doneCount}/{stages.length}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {stages.map((s) => (
                    <span
                      key={s.key}
                      style={{
                        backgroundColor:
                          s.status === "done"
                            ? GREEN
                            : s.status === "active"
                              ? YELLOW
                              : CARD,
                        color: s.status === "done" ? "#fff" : INK,
                        border: `1.5px solid ${INK}`,
                      }}
                      className="rounded-full px-2 py-1 text-[10px] font-bold"
                    >
                      {s.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{ backgroundColor: PAPER, ...cartoonBorder }}
      className="rounded-lg px-2.5 py-2"
    >
      <div
        style={{ fontFamily: DISPLAY_FONT }}
        className="text-[17px] font-bold leading-none text-black"
      >
        {value.toLocaleString()}
      </div>
      <div className="mt-1 text-[10px] font-semibold text-neutral-600">
        {label}
      </div>
    </div>
  );
}

function PhaseIcon({
  status,
}: {
  status: "pending" | "active" | "done" | "error";
}) {
  if (status === "done") {
    return (
      <span
        style={{ backgroundColor: GREEN, border: `2px solid ${INK}` }}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
      >
        <Check size={14} strokeWidth={3} color="#fff" />
      </span>
    );
  }
  if (status === "active") {
    return (
      <span
        style={{
          backgroundColor: YELLOW,
          border: `2px solid ${INK}`,
          boxShadow: hardShadow(2),
        }}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
      >
        <Loader2 size={14} className="animate-spin" style={{ color: INK }} />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span
        style={{ backgroundColor: CORAL, border: `2px solid ${INK}` }}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
      >
        !
      </span>
    );
  }
  // Pending — solid, readable outline, NOT dimmed via opacity.
  return (
    <span
      style={{ borderColor: INK, backgroundColor: "#fff" }}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2"
    >
      <span
        style={{ backgroundColor: LINE }}
        className="h-2 w-2 rounded-full"
      />
    </span>
  );
}

function PathwayMark() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <circle cx="5" cy="19" r="2.4" fill={INK} />
      <circle cx="19" cy="5" r="2.4" fill={INK} />
      <circle cx="19" cy="19" r="2.4" fill={YELLOW} />
      <path d="M5 19L19 5M19 19L5 19" stroke={INK} strokeWidth="1.6" />
    </svg>
  );
}
