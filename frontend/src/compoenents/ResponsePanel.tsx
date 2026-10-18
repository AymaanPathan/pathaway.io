/* eslint-disable no-useless-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Database,
  HelpCircle,
  Loader2,
  MessageSquareText,
  Sparkles,
  Split,
  Wrench,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";

type Obj = Record<string, any>;

const YELLOW = "#F5C542";
const CORAL = "#F0776B";
const SKY = "#5FA0D8";
const GREEN = "#3FA24A";
const LAVENDER = "#D8D0F2";
const INK = "#101210";
const PAPER = "#FBF7EA";
const LINE = "#E4E0D4";
const CARD = "#F1ECDC";
const WHITE = "#FFFFFF";
const DISPLAY_FONT = '"Space Grotesk", "Arial Black", sans-serif';
const MONO = '"IBM Plex Mono", "SF Mono", ui-monospace, monospace';
const border = { border: `2px solid ${INK}` };

const s = (v: unknown, d = "") => (v == null ? d : String(v));
const n = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => s(x)).filter(Boolean) : [];
const cut = (t: string, max: number) =>
  t.length > max ? `${t.slice(0, max - 1)}…` : t;
const fmtMs = (v: unknown) => {
  const x = n(v);
  return x >= 1000 ? `${(x / 1000).toFixed(1)}s` : `${Math.round(x)}ms`;
};

type DotState = "run" | "done" | "miss" | "partial" | "fail";

function dotOf(t: Obj): DotState {
  if (t.skipped === true || t.miss === true) return "miss";
  if (t.ok === false) return "fail";
  if (s(t.status) === "partial") return "partial";
  return "done";
}

function Dot({ state }: { state: DotState }) {
  const bg =
    state === "done"
      ? GREEN
      : state === "run" || state === "partial"
        ? YELLOW
        : state === "miss"
          ? LINE
          : CORAL;
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
      style={{ backgroundColor: bg, border: `1.5px solid ${INK}` }}
    >
      {state === "run" ? (
        <Loader2 size={11} className="animate-spin" strokeWidth={3} />
      ) : state === "done" ? (
        <CheckCircle2 size={11} />
      ) : state === "partial" ? (
        <AlertTriangle size={11} />
      ) : state === "miss" ? (
        <CircleDashed size={11} />
      ) : (
        <XCircle size={11} />
      )}
    </span>
  );
}

function Badge({
  text,
  bg = WHITE,
  mono = false,
}: {
  text: string;
  bg?: string;
  mono?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-px text-[10px] font-black uppercase"
      style={{
        backgroundColor: bg,
        border: `1.5px solid ${INK}`,
        fontFamily: mono ? MONO : undefined,
      }}
    >
      {text}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* One step of the flow                                                 */
/* ------------------------------------------------------------------ */

function FlowStep({
  Icon,
  lane,
  color,
  title,
  index,
  last = false,
  children,
}: {
  Icon: LucideIcon;
  lane: string;
  color: string;
  title: string;
  index: number;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="flex gap-2.5"
      style={{
        animation: "rpslide .35s ease-out both",
        animationDelay: `${index * 90}ms`,
      }}
    >
      <div className="flex w-9 shrink-0 flex-col items-center">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-full"
          style={{ backgroundColor: color, ...border }}
        >
          <Icon size={15} strokeWidth={2.6} />
        </span>
        {!last && (
          <span
            className="mt-1 w-0.5 flex-1"
            style={{
              backgroundImage: `repeating-linear-gradient(to bottom, ${INK} 0 5px, transparent 5px 9px)`,
              minHeight: 14,
            }}
          />
        )}
      </div>
      <div className={`min-w-0 flex-1 ${last ? "" : "pb-3"}`}>
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className="text-[10px] font-black tracking-[0.14em] text-neutral-500"
            style={{ fontFamily: MONO }}
          >
            {lane}
          </span>
          <span
            className="text-[13px] font-black"
            style={{ fontFamily: DISPLAY_FONT }}
          >
            {title}
          </span>
        </div>
        <div
          className="mt-1 rounded-xl p-2.5 text-[12px] leading-[1.55] text-neutral-900"
          style={{ backgroundColor: WHITE, border: `1.5px solid ${INK}` }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** proportional bar: planner / tools / composer time */
function TimeBar({ meta, toolMs }: { meta: Obj; toolMs: number }) {
  const parts = [
    { label: "Planner", ms: n(meta.plannerMs), bg: YELLOW },
    { label: "Tools", ms: n(meta.toolsMs), bg: SKY },
    { label: "Composer", ms: n(meta.composeMs), bg: GREEN },
  ];
  const total = parts.reduce((a, b) => a + b.ms, 0) || 1;
  return (
    <div>
      <div
        className="flex h-3 overflow-hidden rounded-full"
        style={{ ...border, backgroundColor: CARD }}
      >
        {parts.map((p) => (
          <div
            key={p.label}
            title={`${p.label} ${fmtMs(p.ms)}`}
            style={{
              width: `${Math.max(3, (p.ms / total) * 100)}%`,
              backgroundColor: p.bg,
              borderRight: `1.5px solid ${INK}`,
            }}
          />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] font-bold text-neutral-700">
        {parts.map((p) => (
          <span key={p.label}>
            {p.label} {fmtMs(p.ms)}
          </span>
        ))}
        <span className="text-neutral-500">this tool {fmtMs(toolMs)}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The flow for the selected tool                                       */
/* ------------------------------------------------------------------ */

function ToolFlow({ m, t, onClose }: { m: Obj; t: Obj; onClose: () => void }) {
  const meta = (m.meta ?? {}) as Obj;
  const skipped = t.skipped === true;
  const miss = t.miss === true && !skipped;
  const failed = t.ok === false && !skipped && !miss;
  const round2 = n(t.round) === 2 && !!t.dependsOn;
  const args = Object.entries((t.args ?? {}) as Obj).filter(
    ([, v]) => v != null && v !== "",
  );
  const features = strs(t.features);
  const how = strs(t.how);
  const limits = strs(t.limitations);
  const degraded = strs(t.degraded);
  const myFindings = arr(m.findings).filter((f) => s(f.tool) === s(t.name));
  const myPaths = arr(m.graphPaths).filter((p) => s(p.tool) === s(t.name));
  const usedLlm = meta.composerUsedLlm === true;
  const plannedByLlm = meta.plannerUsedLlm === true;

  const status = skipped
    ? { text: "skipped", bg: LINE }
    : failed
      ? { text: "failed", bg: CORAL }
      : miss
        ? { text: "no match", bg: LINE }
        : s(t.status) === "partial"
          ? { text: "partial", bg: YELLOW }
          : { text: "used", bg: GREEN };

  let i = 0;
  return (
    <div
      className="rounded-2xl p-3"
      style={{
        backgroundColor: PAPER,
        ...border,
        animation: "rpslide .25s ease-out both",
      }}
    >
      <style>{`@keyframes rpslide{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div
            className="text-[10px] font-black tracking-[0.16em] text-neutral-500"
            style={{ fontFamily: MONO }}
          >
            HOW THIS TOOL REACHED THE ANSWER
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <h4
              className="text-[15px] font-black"
              style={{ fontFamily: DISPLAY_FONT }}
            >
              {s(t.title)}
            </h4>
            <Badge text={status.text} bg={status.bg} />
            {round2 && (
              <Badge
                text={`round 2 · after ${s(t.dependsOn).replace(/_/g, " ")}`}
                bg={LAVENDER}
              />
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close tool flow"
          className="shrink-0 rounded-full p-1"
          style={{ backgroundColor: WHITE, ...border }}
        >
          <X size={13} />
        </button>
      </div>

      <div className="mb-3">
        <TimeBar meta={meta} toolMs={n(t.ms)} />
      </div>

      {/* 1. question */}
      <FlowStep
        Icon={HelpCircle}
        lane="YOU"
        color={WHITE}
        title="Question"
        index={i++}
      >
        {m.question ? cut(s(m.question), 240) : "Your question"}
      </FlowStep>

      {/* 2. planner */}
      <FlowStep
        Icon={Split}
        lane="AGENT"
        color={YELLOW}
        title="Planner chose this tool"
        index={i++}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            text={
              round2
                ? "follow-up rule"
                : plannedByLlm
                  ? "LLM planner"
                  : "keyword router"
            }
            bg={round2 ? LAVENDER : WHITE}
          />
          {plannedByLlm && !round2 && meta.model && (
            <Badge text={s(meta.model)} mono />
          )}
          {!round2 && (
            <span className="font-bold">{fmtMs(meta.plannerMs)}</span>
          )}
        </div>
        <p className="mt-1">
          {round2
            ? `The first round found an open question, so this tool was added: ${s(t.why)}`
            : plannedByLlm
              ? s(t.why) || "Picked by the language model from the tool list."
              : `Rules matched your wording, so no model call was needed. ${s(t.why)}`}
        </p>
      </FlowStep>

      {/* 3. tool + inputs */}
      <FlowStep
        Icon={Wrench}
        lane="TOOL"
        color={SKY}
        title={s(t.title)}
        index={i++}
      >
        {t.description && <p>{s(t.description)}</p>}
        {args.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="text-[10px] font-black uppercase text-neutral-500">
              Inputs
            </span>
            {args.map(([k, v]) => (
              <code
                key={k}
                className="rounded px-1.5 py-px text-[11px]"
                style={{ backgroundColor: CARD, fontFamily: MONO }}
              >
                {k}={cut(s(v), 60)}
              </code>
            ))}
          </div>
        )}
      </FlowStep>

      {/* 4. falkordb */}
      {!skipped && (
        <FlowStep
          Icon={Database}
          lane="FALKORDB"
          color={LAVENDER}
          title="Graph operations"
          index={i++}
        >
          {features.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {features.map((f) => (
                <Badge key={f} text={f} bg={LAVENDER} mono />
              ))}
            </div>
          ) : (
            <p>Plain graph queries over your topic map.</p>
          )}
          {how.length > 0 && (
            <ol className="mt-2 space-y-1.5">
              {how.map((h, j) => (
                <li key={j} className="flex items-start gap-2">
                  <span
                    className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-black"
                    style={{
                      backgroundColor: CARD,
                      border: `1.5px solid ${INK}`,
                    }}
                  >
                    {j + 1}
                  </span>
                  <span>{h}</span>
                </li>
              ))}
            </ol>
          )}
        </FlowStep>
      )}

      {/* 5. result */}
      <FlowStep
        Icon={failed ? XCircle : miss || skipped ? CircleDashed : CheckCircle2}
        lane="TOOL"
        color={failed ? CORAL : miss || skipped ? LINE : GREEN}
        title="Result"
        index={i++}
      >
        {skipped ? (
          <p>
            {s(t.error)}. Nothing was run for it, so no wrong answer was shown.
          </p>
        ) : failed ? (
          <p style={{ color: CORAL }}>
            <b>Error: </b>
            {s(t.error)}
          </p>
        ) : miss ? (
          <p>
            Nothing in your graph matched, so this result was left out of the
            answer.
          </p>
        ) : (
          <p>{cut(s(t.summary), 320)}</p>
        )}
        {degraded.length > 0 && (
          <p className="mt-1.5">
            <b>Failed graph queries: </b>
            {degraded.join(", ")}
          </p>
        )}
        {limits.length > 0 && (
          <div
            className="mt-1.5 rounded-lg px-2 py-1.5"
            style={{
              backgroundColor: `${YELLOW}33`,
              border: `1.5px dashed ${INK}`,
            }}
          >
            <b>Caveats: </b>
            {limits.join(" ")}
          </div>
        )}
      </FlowStep>

      {/* 6. findings and paths */}
      {(myFindings.length > 0 || myPaths.length > 0) && (
        <FlowStep
          Icon={Sparkles}
          lane="AGENT"
          color={YELLOW}
          title="Findings built from the result"
          index={i++}
        >
          <div className="space-y-2">
            {myFindings.slice(0, 3).map((f) => (
              <div key={s(f.id)}>
                <p className="font-black">{cut(s(f.claim), 220)}</p>
                {strs(f.evidence)
                  .slice(0, 3)
                  .map((e, j) => (
                    <p
                      key={j}
                      className="mt-0.5 pl-2 text-[11px] text-neutral-700"
                      style={{ borderLeft: `3px solid ${LINE}` }}
                    >
                      {cut(e, 160)}
                    </p>
                  ))}
              </div>
            ))}
            {myPaths.slice(0, 3).map((p) => {
              const nodes = strs(p.nodes);
              const rels = strs(p.relationships);
              return (
                <div
                  key={s(p.id)}
                  className="flex flex-wrap items-center gap-y-1"
                >
                  {nodes.map((nm, j) => (
                    <span key={`${nm}-${j}`} className="flex items-center">
                      <span
                        className="rounded-full px-2 py-px text-[11px] font-bold"
                        style={{ backgroundColor: WHITE, ...border }}
                      >
                        {nm}
                      </span>
                      {j < nodes.length - 1 && (
                        <span className="mx-1 flex flex-col items-center text-[9px] font-black uppercase text-neutral-600">
                          <ArrowRight size={12} strokeWidth={3} />
                          {rels[j] ?? "linked to"}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        </FlowStep>
      )}

      {/* 7. composer */}
      <FlowStep
        Icon={MessageSquareText}
        lane="AGENT"
        color={GREEN}
        title="Answer written"
        index={i++}
        last
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            text={usedLlm ? "written by LLM" : "built from tool summaries"}
          />
          <span className="font-bold">{fmtMs(meta.composeMs)}</span>
        </div>
        {t.contribution && !skipped && !miss && (
          <p
            className="mt-1.5 rounded-lg px-2 py-1.5"
            style={{ backgroundColor: `${GREEN}22` }}
          >
            <b>This tool added: </b>
            {cut(s(t.contribution), 240)}
          </p>
        )}
        {(skipped || miss) && (
          <p className="mt-1.5">This tool contributed nothing to the answer.</p>
        )}
        {m.text && (
          <p className="mt-1.5 text-neutral-700">
            <b>Final answer: </b>
            {cut(s(m.text), 200)}
          </p>
        )}
        {usedLlm === false && (
          <p className="mt-1 text-[11px] text-neutral-600">
            The language model was skipped or its draft failed a safety check,
            so the plain tool summary was shown instead.
          </p>
        )}
      </FlowStep>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main: Response panel (left) + tool rail (right)                      */
/* ------------------------------------------------------------------ */

export default function ResponsePanel({
  m,
  children,
}: {
  m: Obj;
  children: ReactNode;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const pending = m.pending === true;
  const tools = arr(m.tools);
  const live = arr(m.steps);

  const rail = pending
    ? live.map((st, idx) => ({
        idx,
        title: s(st.title),
        state: (s(st.state) === "miss" ? "miss" : s(st.state)) as DotState,
        ms: st.ms,
        round2: !!st.dependsOn,
        clickable: false,
      }))
    : tools.map((t, idx) => ({
        idx,
        title: s(t.title),
        state: dotOf(t),
        ms: t.ms,
        round2: n(t.round) === 2,
        clickable: true,
      }));

  const active = sel != null && !pending ? tools[sel] : null;

  return (
    <div className="w-full space-y-2.5">
      <section
        className="overflow-hidden rounded-2xl"
        style={{ backgroundColor: WHITE, ...border }}
      >
        <div
          className="flex items-center justify-between gap-2 px-3 py-1.5"
          style={{ backgroundColor: CARD, borderBottom: `2px solid ${INK}` }}
        >
          <span
            className="text-[11px] font-black uppercase tracking-[.14em]"
            style={{ fontFamily: MONO }}
          >
            Response
          </span>
          {!pending && m.meta?.durationMs != null && (
            <span className="text-[11px] font-bold text-neutral-600">
              {fmtMs(m.meta.durationMs)}
              {n(m.meta.rounds) === 2 ? " · 2 rounds" : ""}
            </span>
          )}
        </div>

        <div className="grid sm:grid-cols-[minmax(0,1fr)_136px]">
          <div className="min-w-0 p-2.5">{children}</div>

          <aside
            className="p-2.5 sm:border-l-2"
            style={{ borderColor: INK, backgroundColor: PAPER }}
          >
            <div
              className="mb-1.5 flex items-center gap-1 text-[10px] font-black tracking-[0.14em] text-neutral-600"
              style={{ fontFamily: MONO }}
            >
              <Wrench size={11} strokeWidth={3} />
              TOOLS · {rail.length}
            </div>

            {rail.length === 0 ? (
              <p className="text-[11px] leading-4 text-neutral-600">
                {pending ? "Choosing tools…" : "No tool ran for this reply."}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {rail.map((r) => {
                  const on = sel === r.idx && !pending;
                  return (
                    <li key={`${r.title}-${r.idx}`}>
                      <button
                        type="button"
                        disabled={!r.clickable}
                        onClick={() => setSel(on ? null : r.idx)}
                        aria-pressed={on}
                        className="flex w-full items-start gap-1.5 rounded-xl p-1.5 text-left transition-transform enabled:hover:-translate-y-0.5 disabled:cursor-default"
                        style={{
                          backgroundColor: on ? YELLOW : WHITE,
                          border: `2px ${r.state === "miss" ? "dashed" : "solid"} ${INK}`,
                          boxShadow: on ? `2px 2px 0 0 ${INK}` : undefined,
                        }}
                      >
                        <Dot state={r.state} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12px] font-black leading-4">
                            {r.title}
                          </span>
                          <span className="block text-[10px] font-semibold text-neutral-700">
                            {r.round2 ? "round 2 · " : ""}
                            {r.ms != null && r.state !== "run"
                              ? fmtMs(r.ms)
                              : r.state === "run"
                                ? "running"
                                : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {!pending && rail.length > 0 && (
              <p className="mt-2 text-[10px] font-semibold leading-3 text-neutral-600">
                Tap a tool to see how it reached this answer.
              </p>
            )}
          </aside>
        </div>
      </section>

      {active && <ToolFlow m={m} t={active} onClose={() => setSel(null)} />}
    </div>
  );
}
