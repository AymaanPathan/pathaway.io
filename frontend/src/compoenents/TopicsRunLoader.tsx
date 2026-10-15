/* eslint-disable react-refresh/only-export-components */
import { Sparkles } from "lucide-react";

const DISPLAY_FONT = '"Space Grotesk", "Arial Black", sans-serif';
const BODY_FONT = '"Inter", "Helvetica Neue", sans-serif';
const YELLOW = "#F5C542";
const CORAL = "#F2704F";
const SKY = "#5FA0D8";
const GREEN = "#3FA24A";
const PURPLE = "#8B72D9";
const LAVENDER = "#D8D0F2";
const INK = "#101210";
const PAPER = "#F1EEE7";
const LINE = "#DAD6CC";
const CARD = "#E9E5DB";
const WHITE = "#FFFDF8";
const border = { border: `2px solid ${INK}` };
const shadow = (n = 4) => `${n}px ${n}px 0 0 ${INK}`;

const LEVEL_COLOR: Record<string, string> = {
  none: "#9ca3af",
  surface: "#f59e0b",
  working: "#3b82f6",
  proficient: PURPLE,
  deep: "#10b981",
};

export type TopicsRun = {
  active: boolean;
  stage: string;
  message: string;
  proposed: number;
  gathered: number;
  assessed: number;
  latest: string | null;
  topics: Array<{ slug: string; level: string; score: number }>;
  done: boolean;
  warning?: string;
  metrics?: Record<string, unknown> | null;
};

export const EMPTY_TOPICS_RUN: TopicsRun = {
  active: false,
  stage: "",
  message: "",
  proposed: 0,
  gathered: 0,
  assessed: 0,
  latest: null,
  topics: [],
  done: false,
};

const STEPS = [
  { id: "atlas", title: "Evidence atlas", engine: "FalkorDB" },
  { id: "discover", title: "Discover topics", engine: "LLM" },
  { id: "gather", title: "Gather evidence", engine: "FalkorDB" },
  { id: "judge", title: "Judge depth", engine: "LLM" },
  { id: "reconcile", title: "Guard-rails", engine: "Rules" },
  { id: "store", title: "Persist to graph", engine: "FalkorDB" },
  { id: "synthesize", title: "Profile summary", engine: "LLM" },
  {
    id: "metrics",
    title: "PageRank · betweenness · communities",
    engine: "FalkorDB",
  },
];

function activeStep(run: TopicsRun): number {
  if (run.done) return 8;
  switch (run.stage) {
    case "topics:depth_start":
    case "topics:depth_atlas_ready":
      return 0;
    case "topics:depth_discovering":
    case "topics:depth_topics_proposed":
      return 1;
    case "topics:depth_evidence_gathered":
      return 2;
    case "topics:depth_refining":
    case "topics:depth_topic_assessed":
      return run.proposed > 0 && run.assessed >= run.proposed ? 5 : 3;
    case "topics:depth_complete":
      return 7;
    default:
      return 0;
  }
}

function percent(run: TopicsRun): number {
  if (run.done) return 100;
  if (run.proposed > 0)
    return Math.min(
      95,
      Math.round(
        25 +
          25 * Math.min(run.gathered / run.proposed, 1) +
          45 * Math.min(run.assessed / run.proposed, 1),
      ),
    );
  return run.stage ? 8 : 3;
}

export default function TopicsRunLoader({
  run,
  isComplete,
}: {
  run: TopicsRun;
  isComplete: boolean;
}) {
  const step = isComplete ? 8 : activeStep(run);
  const pct = isComplete ? 100 : percent(run);
  const W = 420;
  const H = 320;
  const cx = W / 2;
  const cy = H / 2;
  const shown = run.topics.slice(-14);

  return (
    <div
      className="flex min-h-screen items-center justify-center p-4 sm:p-8"
      style={{ backgroundColor: PAPER, color: INK, fontFamily: BODY_FONT }}
    >
      <style>{`
        @keyframes tpop { from { opacity: 0; transform: scale(.2); } to { opacity: 1; transform: scale(1); } }
        @keyframes tspin { to { transform: rotate(360deg); } }
        @keyframes tspinr { to { transform: rotate(-360deg); } }
        @keyframes tpulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.06); } }
        @keyframes tstripe { to { background-position: 28px 0; } }
        @keyframes tblink { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
        @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; } }
      `}</style>

      <div
        className="w-full max-w-5xl rounded-3xl p-5 sm:p-8"
        style={{ backgroundColor: WHITE, ...border, boxShadow: shadow(6) }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl"
            style={{ backgroundColor: YELLOW, ...border }}
          >
            <Sparkles size={18} />
          </div>
          <div>
            <h1
              className="text-[26px] font-black leading-none tracking-tight sm:text-[32px]"
              style={{ fontFamily: DISPLAY_FONT }}
            >
              Mapping your topics
            </h1>
            <p className="mt-1 text-[13px] font-semibold text-neutral-600">
              {run.warning ??
                (run.message || "Reading your authored code through FalkorDB")}
            </p>
          </div>
        </div>

        <div
          className="mt-5 h-5 overflow-hidden rounded-full"
          style={{ backgroundColor: CARD, ...border }}
        >
          <div
            className="h-full transition-all duration-700"
            style={{
              width: `${pct}%`,
              backgroundColor: YELLOW,
              backgroundImage: isComplete
                ? undefined
                : `repeating-linear-gradient(45deg, rgba(16,18,16,.18) 0 7px, transparent 7px 14px)`,
              backgroundSize: "28px 28px",
              animation: isComplete ? undefined : "tstripe .8s linear infinite",
              borderRight: `2px solid ${INK}`,
            }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[12px] font-black">
          <span>{pct}%</span>
          <span className="text-neutral-600">
            {run.proposed > 0
              ? `${run.assessed}/${run.proposed} topics judged`
              : "warming up"}
          </span>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.1fr]">
          {/* pipeline */}
          <ol className="space-y-2">
            {STEPS.map((s, i) => {
              const done = i < step;
              const on = i === step && !isComplete;
              return (
                <li
                  key={s.id}
                  className="flex items-center gap-3 rounded-2xl p-2.5"
                  style={{
                    backgroundColor: on ? YELLOW : done ? CARD : WHITE,
                    ...border,
                    boxShadow: on ? shadow(3) : undefined,
                    animation: on
                      ? "tpulse 1.2s ease-in-out infinite"
                      : undefined,
                    opacity: !done && !on ? 0.55 : 1,
                  }}
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-black"
                    style={{ backgroundColor: done ? GREEN : WHITE, ...border }}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-[13px] font-black leading-4">
                    {s.title}
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-black"
                    style={{
                      backgroundColor:
                        s.engine === "FalkorDB"
                          ? SKY
                          : s.engine === "LLM"
                            ? LAVENDER
                            : CARD,
                      ...border,
                      animation: on
                        ? "tblink 1s ease-in-out infinite"
                        : undefined,
                    }}
                  >
                    {s.engine}
                  </span>
                </li>
              );
            })}
          </ol>

          {/* live graph */}
          <div>
            <div
              className="overflow-hidden rounded-2xl"
              style={{ backgroundColor: "#F8F6F1", ...border }}
            >
              <svg
                viewBox={`0 0 ${W} ${H}`}
                className="block h-auto w-full"
                aria-hidden="true"
              >
                <defs>
                  <pattern
                    id="tgrid"
                    width="30"
                    height="30"
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d="M 30 0 L 0 0 0 30"
                      fill="none"
                      stroke={LINE}
                      strokeWidth="1"
                    />
                  </pattern>
                </defs>
                <rect width={W} height={H} fill="url(#tgrid)" opacity=".6" />
                <g
                  style={{
                    transformOrigin: `${cx}px ${cy}px`,
                    animation: isComplete
                      ? undefined
                      : "tspin 14s linear infinite",
                  }}
                >
                  <circle
                    cx={cx}
                    cy={cy}
                    r={118}
                    fill="none"
                    stroke={INK}
                    strokeWidth="2"
                    strokeDasharray="4 8"
                    opacity=".35"
                  />
                </g>
                <g
                  style={{
                    transformOrigin: `${cx}px ${cy}px`,
                    animation: isComplete
                      ? undefined
                      : "tspinr 9s linear infinite",
                  }}
                >
                  <circle
                    cx={cx}
                    cy={cy}
                    r={60}
                    fill="none"
                    stroke={CORAL}
                    strokeWidth="2"
                    strokeDasharray="10 10"
                    opacity=".6"
                  />
                </g>
                {shown.map((t, i) => {
                  const a =
                    (i / Math.max(shown.length, 6)) * Math.PI * 2 - Math.PI / 2;
                  const r = i % 2 === 0 ? 118 : 90;
                  const x = cx + Math.cos(a) * r;
                  const y = cy + Math.sin(a) * r;
                  return (
                    <g key={t.slug}>
                      <line
                        x1={cx}
                        y1={cy}
                        x2={x}
                        y2={y}
                        stroke={INK}
                        strokeWidth="1.5"
                        opacity=".35"
                      />
                      <g
                        style={{
                          transformOrigin: `${x}px ${y}px`,
                          animation: "tpop .55s cubic-bezier(.2,1.4,.4,1) both",
                        }}
                      >
                        <circle
                          cx={x}
                          cy={y}
                          r={9 + Math.min(8, t.score / 14)}
                          fill={LEVEL_COLOR[t.level] ?? LAVENDER}
                          stroke={INK}
                          strokeWidth="2.5"
                        />
                        <text
                          x={x}
                          y={y + 24}
                          textAnchor="middle"
                          fontSize="8.5"
                          fontWeight={800}
                          fill={INK}
                          fontFamily={BODY_FONT}
                        >
                          {t.slug.replace(/_/g, " ").slice(0, 16)}
                        </text>
                      </g>
                    </g>
                  );
                })}
                <circle
                  cx={cx}
                  cy={cy}
                  r={22}
                  fill={YELLOW}
                  stroke={INK}
                  strokeWidth="3"
                  style={{
                    transformOrigin: `${cx}px ${cy}px`,
                    animation: isComplete
                      ? undefined
                      : "tpulse 1.4s ease-in-out infinite",
                  }}
                />
                <text
                  x={cx}
                  y={cy + 4}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight={900}
                  fill={INK}
                  fontFamily={BODY_FONT}
                >
                  YOU
                </text>
              </svg>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                ["Proposed", run.proposed],
                ["Evidence", run.gathered],
                ["Judged", run.assessed],
              ].map(([l, v]) => (
                <div
                  key={String(l)}
                  className="rounded-xl p-2.5"
                  style={{ backgroundColor: CARD, ...border }}
                >
                  <div className="text-[11px] font-bold">{l}</div>
                  <div
                    className="text-[22px] font-black leading-none"
                    style={{ fontFamily: DISPLAY_FONT }}
                  >
                    {v}
                  </div>
                </div>
              ))}
            </div>
            {run.latest && (
              <p className="mt-2 text-[12px] font-bold text-neutral-600">
                Latest:{" "}
                <span style={{ color: CORAL }}>
                  {run.latest.replace(/_/g, " ")}
                </span>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
