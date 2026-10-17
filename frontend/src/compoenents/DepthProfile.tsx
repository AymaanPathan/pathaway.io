/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ReactNode } from "react";

type Obj = Record<string, any>;

const INK = "#101210";
const PAPER = "#FBF7EA";
const WHITE = "#FFFFFF";
const LINE = "#E4E0D4";
const YELLOW = "#F5C542";
const CORAL = "#F0776B";
const DISPLAY = '"Space Grotesk", "Arial Black", sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';
const border = { border: `2px solid ${INK}` };

const LEVEL_COLOR: Record<string, string> = {
  surface: "#f59e0b",
  working: "#3b82f6",
  proficient: "#8B72D9",
  deep: "#10b981",
};
const STARTS = [0, 20, 40, 65];
const ENDS = [20, 40, 65, 100];

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function Card({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        backgroundColor: WHITE,
        ...border,
        boxShadow: `2px 2px 0 0 ${INK}`,
      }}
    >
      <div className="text-[15px] font-bold" style={{ fontFamily: DISPLAY }}>
        {title}
      </div>
      {sub && <div className="text-[12px] text-neutral-600">{sub}</div>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

export default function DepthProfile({
  p,
  name,
}: {
  p: Obj | null | undefined;
  name: string;
}) {
  if (!p) return null;
  const ladder: Obj[] = Array.isArray(p.ladder) ? p.ladder : [];
  const comps: Obj[] = (Array.isArray(p.components) ? p.components : [])
    .slice()
    .sort(
      (a: Obj, b: Obj) =>
        n(b.value) / Math.max(1, n(b.max)) - n(a.value) / Math.max(1, n(a.max)),
    );
  const kinds = (p.evidenceKinds ?? null) as Record<string, number> | null;
  const timeline: Obj[] = Array.isArray(p.timeline) ? p.timeline : [];
  const hardening: Obj[] = Array.isArray(p.hardening) ? p.hardening : [];
  const caps: string[] = Array.isArray(p.caps) ? p.caps : [];
  const maxFiles = Math.max(1, ...timeline.map((t) => n(t.files)));
  const score = Math.max(0, Math.min(100, n(p.score)));
  const baseline = Math.max(0, Math.min(100, n(p.baseline)));

  return (
    <div className="mt-6 space-y-4">
      {(p.fallback || !p.hasBreakdown) && (
        <div
          className="rounded-xl p-3 text-[13px] font-bold"
          style={{ backgroundColor: `${YELLOW}55`, ...border }}
        >
          {p.fallback
            ? "No model reviewed this topic, so depth comes from graph counts only. Re-judge it for a full assessment."
            : "This assessment was stored by an older analysis, so the breakdown below is empty. Re-run the analysis to fill it."}
        </div>
      )}

      <Card
        title={`How deep is ${name}?`}
        sub={
          p.nextLevel
            ? `Score ${score}. ${n(p.pointsToNextLevel)} more points to reach ${p.nextLevel}.`
            : `Score ${score}. This is the top level.`
        }
      >
        <div className="relative pt-5">
          <div
            className="flex h-6 overflow-hidden rounded-full"
            style={{ ...border, backgroundColor: PAPER }}
          >
            {ladder.map((l, i) => {
              const reached = score >= STARTS[i];
              return (
                <div
                  key={l.id}
                  title={`${l.label}: ${l.min}-${l.max}`}
                  style={{
                    width: `${ENDS[i] - STARTS[i]}%`,
                    backgroundColor: LEVEL_COLOR[l.id],
                    opacity: reached ? 1 : 0.22,
                    borderRight: i < ladder.length - 1 ? `2px solid ${INK}` : 0,
                  }}
                />
              );
            })}
          </div>
          <div
            className="absolute top-0 -translate-x-1/2 text-[11px] font-bold"
            style={{ left: `${score}%`, fontFamily: MONO }}
          >
            ▼ {score}
          </div>
          <div
            className="absolute bottom-6 h-8 w-0 -translate-x-1/2"
            style={{ left: `${baseline}%`, borderLeft: `2px dashed ${CORAL}` }}
            title={`Graph baseline ${baseline}`}
          />
          <div className="relative mt-1 flex text-[11px] font-bold text-neutral-600">
            {ladder.map((l, i) => (
              <div key={l.id} style={{ width: `${ENDS[i] - STARTS[i]}%` }}>
                {l.label}
              </div>
            ))}
          </div>
          <div className="mt-1 text-[11px] text-neutral-600">
            Dashed line = deterministic graph baseline ({baseline}). The final
            score is the baseline adjusted by the model and guard-rails.
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="What the score is made of"
          sub="Each bar is one capped component of the baseline"
        >
          {p.hasBreakdown ? (
            <ul className="space-y-2">
              {comps.map((c) => (
                <li key={c.id}>
                  <div className="flex items-center justify-between text-[12px] font-bold">
                    <span>{c.meaning}</span>
                    <span style={{ fontFamily: MONO }}>
                      {n(c.value)}/{n(c.max)}
                    </span>
                  </div>
                  <div
                    className="mt-1 h-2.5 overflow-hidden rounded-full"
                    style={{ backgroundColor: LINE }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(n(c.value) / Math.max(1, n(c.max))) * 100}%`,
                        backgroundColor: INK,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-neutral-600">
              Not stored for this assessment yet.
            </p>
          )}
          {caps.length > 0 && (
            <ul className="mt-3 space-y-1">
              {caps.map((c, i) => (
                <li
                  key={i}
                  className="text-[12px] font-bold"
                  style={{ color: "#b8392a" }}
                >
                  Reduced: {c}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Evidence behind it" sub="What the graph found, by kind">
            {kinds ? (
              <div className="grid grid-cols-4 gap-2 text-center">
                {(
                  ["code", "demonstration", "experience", "commit"] as const
                ).map((k) => (
                  <div
                    key={k}
                    className="rounded-lg py-2"
                    style={{
                      backgroundColor: n(kinds[k]) ? PAPER : WHITE,
                      ...border,
                    }}
                  >
                    <div
                      className="text-[20px] font-bold leading-none"
                      style={{ fontFamily: DISPLAY }}
                    >
                      {n(kinds[k])}
                    </div>
                    <div
                      className="mt-1 text-[10px] font-bold"
                      style={{ fontFamily: MONO }}
                    >
                      {k.toUpperCase()}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-neutral-600">
                Not stored for this assessment yet.
              </p>
            )}
          </Card>

          <Card title="Activity over time" sub="Matched files per month">
            {timeline.length ? (
              <div className="flex h-24 items-end gap-1">
                {timeline.map((t) => (
                  <div
                    key={t.month}
                    className="flex h-full flex-1 flex-col items-center justify-end"
                    title={`${t.month}: ${n(t.files)} files`}
                  >
                    <div
                      className="w-full rounded-t"
                      style={{
                        height: `${(n(t.files) / maxFiles) * 80}%`,
                        minHeight: 3,
                        backgroundColor: INK,
                      }}
                    />
                    <div
                      className="mt-1 text-[9px] text-neutral-600"
                      style={{ fontFamily: MONO }}
                    >
                      {String(t.month).slice(5)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-neutral-600">
                No dated activity stored.
              </p>
            )}
          </Card>

          {hardening.length > 0 && (
            <Card
              title="Hardening seen"
              sub="Behaviours that show design decisions"
            >
              <div className="flex flex-wrap gap-1.5">
                {hardening.map((h) => (
                  <span
                    key={h.label}
                    className="rounded-full px-2.5 py-0.5 text-[12px] font-bold"
                    style={{ backgroundColor: PAPER, ...border }}
                  >
                    {h.label} ×{n(h.count)}
                  </span>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
