/* eslint-disable react-refresh/only-export-components */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Trophy, X } from "lucide-react";

const YELLOW = "#F5C542";
const GREEN = "#3FA24A";
const INK = "#101210";
const PAPER = "#F1EEE7";
const MUTED = "#6f6b61";
const DISPLAY = '"Space Grotesk", "Arial Black", sans-serif';
const MONO = '"JetBrains Mono", "Fira Code", ui-monospace, Menlo, monospace';
const border = { border: `2px solid ${INK}` };
const shadow = (n = 3) => `${n}px ${n}px 0 0 ${INK}`;

/* ---------- types (mirror service/mission-completion.ts) ---------- */
export type NodeState = "created" | "updated" | "existing";
export type CompletionNode = {
  id: string;
  kind:
    | "developer"
    | "mission"
    | "demonstration"
    | "capability"
    | "domain"
    | "repository"
    | "skill"
    | "goal";
  label: string;
  state: NodeState;
};
export type CompletionEdge = {
  from: string;
  to: string;
  type: string;
  state: NodeState;
};
type LevelState = { level: string; evidenceCount: number };
export type MissionCompletionResult = {
  fresh: boolean;
  completedAt: string;
  sha: string;
  commitMessage: string;
  checks: number;
  capability: {
    id: string;
    name: string;
    domainId: string;
    domainName: string;
    before: LevelState;
    after: LevelState;
    depth: "implementation" | "strong";
  };
  goal: {
    name: string;
    metBefore: number;
    metAfter: number;
    total: number;
  } | null;
  delta: { nodes: CompletionNode[]; edges: CompletionEdge[] };
  counts: { nodesCreated: number; relationshipsWritten: number };
  nextGap: {
    capabilityId: string;
    capabilityName: string;
    reason: string;
  } | null;
};

export const LEVEL_LABEL: Record<string, string> = {
  missing: "Not demonstrated",
  insufficient_evidence: "One sighting",
  usage: "Usage",
  repeated_usage: "Repeated usage",
  implementation: "Implementation",
  strong: "Strong",
};
const LEVEL_RANK: Record<string, number> = {
  missing: 0,
  insufficient_evidence: 1,
  usage: 2,
  repeated_usage: 3,
  implementation: 4,
  strong: 5,
};

export const CELEBRATION_CSS = `
@keyframes mc-pop{0%{transform:scale(.4);opacity:0}60%{transform:scale(1.12);opacity:1}100%{transform:scale(1);opacity:1}}
@keyframes mc-draw{to{stroke-dashoffset:0}}
@keyframes mc-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes mc-ring{0%{transform:scale(1);opacity:.7}100%{transform:scale(2.4);opacity:0}}
@keyframes mc-fill{from{width:var(--from)}to{width:var(--to)}}
@keyframes mc-backdrop{from{opacity:0}to{opacity:1}}
@keyframes pm-pop{0%{transform:scale(.97);opacity:.6}60%{transform:scale(1.015)}100%{transform:scale(1);opacity:1}}
.pm-pop{animation:pm-pop .5s ease-out both}
@media (prefers-reduced-motion:reduce){
  .mc-anim,.mc-anim *,.pm-pop{animation-duration:.01ms!important;animation-delay:0s!important}
}
`;

/* ---------- small hooks / effects ---------- */
function useCountUp(target: number, delay: number, ms = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now() + delay;
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - t0) / ms));
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, delay, ms]);
  return v;
}

function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      c.width = window.innerWidth * dpr;
      c.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const colors = [YELLOW, GREEN, INK, "#ffffff", "#e8705b"];
    const parts = Array.from({ length: 150 }, () => ({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 240,
      y: window.innerHeight * 0.32,
      vx: (Math.random() - 0.5) * 15,
      vy: -Math.random() * 14 - 4,
      w: 6 + Math.random() * 6,
      h: 4 + Math.random() * 5,
      r: Math.random() * 6.28,
      vr: (Math.random() - 0.5) * 0.4,
      c: colors[(Math.random() * colors.length) | 0],
    }));
    const LIFE = 3200;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      if (t >= LIFE) return;
      for (const p of parts) {
        p.vy += 0.35;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - t / LIFE);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[60] h-full w-full"
    />
  );
}

/* ---------- the graph ---------- */
const KIND_ORDER: CompletionNode["kind"][] = [
  "developer",
  "mission",
  "demonstration",
  "capability",
  "domain",
  "repository",
  "skill",
  "goal",
];
const FIXED: Record<string, { x: number; y: number }> = {
  developer: { x: 70, y: 190 },
  mission: { x: 210, y: 90 },
  demonstration: { x: 230, y: 290 },
  capability: { x: 400, y: 190 },
  domain: { x: 540, y: 90 },
  repository: { x: 400, y: 335 },
  goal: { x: 610, y: 200 },
};
const STATE_FILL: Record<NodeState, string> = {
  created: YELLOW,
  updated: GREEN,
  existing: "#ffffff",
};
const KIND_TAG: Record<CompletionNode["kind"], string> = {
  developer: "YOU",
  mission: "MISSION",
  demonstration: "PROOF",
  capability: "CAPABILITY",
  domain: "DOMAIN",
  repository: "REPO",
  skill: "SKILL",
  goal: "GOAL",
};
const STEP_MS = 200;
const BASE_MS = 300;

function GraphAnimation({
  nodes,
  edges,
}: {
  nodes: CompletionNode[];
  edges: CompletionEdge[];
}) {
  const { placed, delay } = useMemo(() => {
    const sorted = [...nodes].sort(
      (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
    );
    let skillIdx = 0;
    const placed = sorted.map((n) => {
      const pos =
        n.kind === "skill"
          ? {
              x: 500 + (skillIdx % 2) * 80,
              y: 285 + Math.floor(skillIdx++ / 2) * 55,
            }
          : FIXED[n.kind];
      return { ...n, ...pos };
    });
    const delay = new Map(
      placed.map((n, i) => [n.id, BASE_MS + i * STEP_MS] as const),
    );
    return { placed, delay };
  }, [nodes]);

  const byId = new Map(placed.map((n) => [n.id, n]));

  return (
    <svg
      viewBox="0 0 680 380"
      role="img"
      aria-label="Graph of the nodes and relationships this mission added"
      className="mc-anim h-auto w-full"
    >
      {edges.map((e, i) => {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        if (!a || !b) return null;
        const d = Math.max(delay.get(a.id) ?? 0, delay.get(b.id) ?? 0) + 120;
        const isNew = e.state === "created";
        return (
          <g key={i}>
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1}
              stroke={isNew ? GREEN : "#b9b4a8"}
              strokeWidth={isNew ? 3 : 2}
              strokeLinecap="round"
              style={{ animation: `mc-draw .55s ease-out ${d}ms forwards` }}
            />
            {isNew && (
              <text
                x={(a.x + b.x) / 2}
                y={(a.y + b.y) / 2 - 5}
                textAnchor="middle"
                fontSize="8.5"
                fill={MUTED}
                style={{
                  fontFamily: MONO,
                  opacity: 0,
                  animation: `mc-rise .4s ease-out ${d + 350}ms forwards`,
                }}
              >
                {e.type}
              </text>
            )}
          </g>
        );
      })}

      {placed.map((n) => {
        const d = delay.get(n.id) ?? 0;
        const label =
          n.label.length > 20 ? `${n.label.slice(0, 19)}…` : n.label;
        return (
          <g key={n.id}>
            {n.state !== "existing" && (
              <circle
                cx={n.x}
                cy={n.y}
                r={18}
                fill="none"
                stroke={n.state === "created" ? YELLOW : GREEN}
                strokeWidth={3}
                style={{
                  opacity: 0,
                  transformBox: "fill-box",
                  transformOrigin: "center",
                  animation: `mc-ring 1.2s ease-out ${d + 250}ms 2`,
                }}
              />
            )}
            <g
              style={{
                opacity: 0,
                transformBox: "fill-box",
                transformOrigin: "center",
                animation: `mc-pop .45s cubic-bezier(.2,1.4,.4,1) ${d}ms forwards`,
              }}
            >
              <circle
                cx={n.x}
                cy={n.y}
                r={18}
                fill={STATE_FILL[n.state]}
                stroke={INK}
                strokeWidth={2.5}
              />
              <text
                x={n.x}
                y={n.y + 3}
                textAnchor="middle"
                fontSize="8"
                fontWeight={700}
                fill={INK}
                style={{ fontFamily: MONO }}
              >
                {KIND_TAG[n.kind].slice(0, 4)}
              </text>
              <text
                x={n.x}
                y={n.y + 33}
                textAnchor="middle"
                fontSize="11"
                fontWeight={700}
                fill={INK}
                style={{ fontFamily: DISPLAY }}
              >
                {label}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- level meter ---------- */
function LevelMeter({
  before,
  after,
  delay,
}: {
  before: string;
  after: string;
  delay: number;
}) {
  const from = ((LEVEL_RANK[before] ?? 0) / 5) * 100;
  const to = ((LEVEL_RANK[after] ?? 0) / 5) * 100;
  return (
    <div>
      <div
        className="relative h-4 overflow-hidden rounded-full"
        style={{ ...border, backgroundColor: "#fff" }}
        role="img"
        aria-label={`${LEVEL_LABEL[before]} to ${LEVEL_LABEL[after]}`}
      >
        <div
          className="mc-anim h-full"
          style={
            {
              backgroundColor: GREEN,
              width: `${from}%`,
              "--from": `${from}%`,
              "--to": `${to}%`,
              animation: `mc-fill 1.1s cubic-bezier(.3,.9,.3,1) ${delay}ms forwards`,
            } as React.CSSProperties
          }
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[12px]">
        <span style={{ color: MUTED }}>{LEVEL_LABEL[before]}</span>
        <ArrowRight size={13} />
        <span className="font-bold">{LEVEL_LABEL[after]}</span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  delay,
}: {
  label: string;
  value: number;
  delay: number;
}) {
  const v = useCountUp(value, delay);
  return (
    <div
      className="mc-anim rounded-xl p-3 text-center"
      style={{
        ...border,
        backgroundColor: "#fff",
        opacity: 0,
        animation: `mc-rise .5s ease-out ${delay}ms forwards`,
      }}
    >
      <div
        style={{ fontFamily: DISPLAY }}
        className="text-[26px] font-bold leading-none"
      >
        {v}
      </div>
      <div
        className="mt-1 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: MUTED }}
      >
        {label}
      </div>
    </div>
  );
}

/* ---------- overlay ---------- */
export function MissionCelebration({
  completion,
  missionName,
  confetti = true,
  onClose,
  onNext,
}: {
  completion: MissionCompletionResult;
  missionName: string;
  confetti?: boolean;
  onClose: () => void;
  onNext: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const { nodes, edges } = completion.delta;
  const graphMs = BASE_MS + nodes.length * STEP_MS + 600;
  const c = completion.capability;

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

  const reveal = (ms: number): React.CSSProperties => ({
    opacity: 0,
    animation: `mc-rise .5s ease-out ${ms}ms forwards`,
  });

  return (
    <>
      <style>{CELEBRATION_CSS}</style>
      {confetti && <Confetti />}
      <div
        className="mc-anim fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{
          backgroundColor: "rgba(16,18,16,.62)",
          animation: "mc-backdrop .3s ease-out both",
        }}
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="mc-title"
          onClick={(e) => e.stopPropagation()}
          className="max-h-[94vh] w-full max-w-[980px] overflow-y-auto rounded-2xl"
          style={{ ...border, backgroundColor: PAPER, boxShadow: shadow(6) }}
        >
          <div
            className="flex items-center justify-between gap-3 px-5 py-3"
            style={{
              borderBottom: `2px solid ${INK}`,
              backgroundColor: YELLOW,
            }}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <Trophy size={22} />
              <div className="min-w-0">
                <h2
                  id="mc-title"
                  style={{ fontFamily: DISPLAY }}
                  className="text-[22px] font-bold leading-tight"
                >
                  Mission complete
                </h2>
                <p className="truncate text-[12.5px]">
                  {missionName} · {completion.checks} checks passed
                </p>
              </div>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={border}
              className="pm-btn rounded-full bg-white p-1.5"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid gap-5 p-5 lg:grid-cols-[1.5fr_1fr]">
            <section>
              <h3
                style={{ fontFamily: DISPLAY }}
                className="mb-1 text-[15px] font-bold"
              >
                Your graph just changed
              </h3>
              <div
                className="rounded-xl p-2"
                style={{ ...border, backgroundColor: "#fff" }}
              >
                <GraphAnimation nodes={nodes} edges={edges} />
              </div>
              <div
                className="mt-2 flex flex-wrap gap-3 text-[11.5px]"
                style={{ color: MUTED }}
              >
                {(
                  [
                    ["created", "New"],
                    ["updated", "Updated"],
                    ["existing", "Already there"],
                  ] as [NodeState, string][]
                ).map(([s, l]) => (
                  <span key={s} className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ ...border, backgroundColor: STATE_FILL[s] }}
                    />
                    {l}
                  </span>
                ))}
              </div>
            </section>

            <section className="flex flex-col gap-4">
              <div>
                <div
                  className="mb-1.5 text-[11px] font-bold uppercase tracking-wider"
                  style={{ color: MUTED }}
                >
                  {c.name}
                </div>
                <LevelMeter
                  before={c.before.level}
                  after={c.after.level}
                  delay={graphMs}
                />
                <p
                  className="mt-2 text-[12.5px] leading-snug"
                  style={{ color: MUTED }}
                >
                  {c.depth === "strong"
                    ? "A second verified mission on this capability counts as strong evidence."
                    : "Verified by passing tests on your own commit."}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Stat
                  label="Nodes"
                  value={completion.counts.nodesCreated}
                  delay={graphMs + 200}
                />
                <Stat
                  label="Relations"
                  value={completion.counts.relationshipsWritten}
                  delay={graphMs + 350}
                />
                <Stat
                  label="Checks"
                  value={completion.checks}
                  delay={graphMs + 500}
                />
              </div>

              {completion.goal && (
                <div className="mc-anim" style={reveal(graphMs + 650)}>
                  <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
                    <span className="font-bold">Goal progress</span>
                    <span style={{ fontFamily: MONO }}>
                      {completion.goal.metBefore}
                      {completion.goal.metAfter > completion.goal.metBefore &&
                        ` → ${completion.goal.metAfter}`}
                      {" / "}
                      {completion.goal.total}
                    </span>
                  </div>
                  <div
                    className="h-3 overflow-hidden rounded-full"
                    style={{ ...border, backgroundColor: "#fff" }}
                  >
                    <div
                      className="mc-anim h-full"
                      style={
                        {
                          backgroundColor: YELLOW,
                          "--from": `${(completion.goal.metBefore / Math.max(1, completion.goal.total)) * 100}%`,
                          "--to": `${(completion.goal.metAfter / Math.max(1, completion.goal.total)) * 100}%`,
                          width: `${(completion.goal.metBefore / Math.max(1, completion.goal.total)) * 100}%`,
                          animation: `mc-fill 1s ease-out ${graphMs + 700}ms forwards`,
                        } as React.CSSProperties
                      }
                    />
                  </div>
                </div>
              )}

              {completion.nextGap && (
                <div
                  className="mc-anim rounded-xl p-3"
                  style={{
                    ...border,
                    backgroundColor: "#fff",
                    ...reveal(graphMs + 900),
                  }}
                >
                  <div
                    className="text-[11px] font-bold uppercase tracking-wider"
                    style={{ color: MUTED }}
                  >
                    Next gap
                  </div>
                  <div
                    style={{ fontFamily: DISPLAY }}
                    className="text-[15px] font-bold"
                  >
                    {completion.nextGap.capabilityName}
                  </div>
                  {completion.nextGap.reason && (
                    <p className="mt-0.5 text-[12.5px] leading-snug text-neutral-700">
                      {completion.nextGap.reason}
                    </p>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={onNext}
                style={{
                  ...border,
                  backgroundColor: YELLOW,
                  boxShadow: shadow(),
                  ...reveal(graphMs + 1000),
                }}
                className="pm-btn mc-anim inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[14px] font-bold"
              >
                Continue to your goal
                <ArrowRight size={15} />
              </button>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
