/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Flame,
  Loader2,
  Wrench,
  XCircle,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

/**
 * Renders the `blocks` returned by POST /api/topics/chat(/stream), and the
 * chat message itself: streamed answer, tools used, evidence, and how the
 * answer was reached. Every block is built by a backend tool from FalkorDB
 * results, so this file only decides how things LOOK. It never interprets or
 * invents data.
 */

const YELLOW = "#F5C542";
const CORAL = "#F2704F";
const SKY = "#5FA0D8";
const GREEN = "#3FA24A";
const PURPLE = "#8B72D9";
const LAVENDER = "#D8D0F2";
const INK = "#101210";
const LINE = "#DAD6CC";
const CARD = "#E9E5DB";
const WHITE = "#FFFDF8";
const DISPLAY_FONT = '"Space Grotesk", "Arial Black", sans-serif';
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const border: CSSProperties = { border: `2px solid ${INK}` };

const LEVEL_COLOR: Record<string, string> = {
  none: "#9ca3af",
  surface: "#f59e0b",
  working: "#3b82f6",
  proficient: PURPLE,
  deep: "#10b981",
};
const LEVEL_LABEL: Record<string, string> = {
  none: "None",
  surface: "Surface",
  working: "Working",
  proficient: "Proficient",
  deep: "Deep",
};
const TONE: Record<string, string> = {
  info: SKY,
  good: GREEN,
  warn: YELLOW,
  bad: CORAL,
};
const SEVERITY: Record<string, string> = {
  high: CORAL,
  medium: YELLOW,
  low: SKY,
};

export type UiBlock = { type: string } & Record<string, any>;
type Obj = Record<string, any>;

export type TraceEvent =
  | {
      type: "stage";
      stage: "planning" | "running" | "composing";
      agent: string;
      label: string;
    }
  | {
      type: "plan";
      by: "llm" | "rules";
      model: string | null;
      ms: number;
      calls: Array<{ tool: string; title: string; why: string; args: Obj }>;
      skipped: Array<{ term: string; tool: string; reason: string }>;
    }
  | { type: "tool_start"; tool: string; title: string }
  | {
      type: "tool_done";
      tool: string;
      ok: boolean;
      ms: number;
      miss: boolean;
      note: string | null;
    }
  | { type: "compose_done"; usedLlm: boolean; ms: number }
  | { type: "answer_start" }
  | { type: "answer_delta"; text: string };

/** a tool chip shown while the answer is still being produced */
export type LiveStep = {
  tool: string;
  title: string;
  state: "run" | "done" | "miss";
  ms?: number;
};

const s = (v: unknown, d = "") => (v == null ? d : String(v));
const n = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const fmtMs = (v: unknown) => {
  const x = n(v);
  return x >= 1000 ? `${(x / 1000).toFixed(1)}s` : `${Math.round(x)}ms`;
};

/** blocks that need the full width on the wide "answer stage" */
const FULL = new Set([
  "compare",
  "path",
  "roadmap",
  "groups",
  "issues",
  "stats",
  "callout",
]);

export function Blocks({
  blocks,
  onPick,
  wide = false,
}: {
  blocks: UiBlock[];
  onPick: (slug: string) => void;
  wide?: boolean;
}) {
  if (!blocks.length) return null;
  return (
    <div className={wide ? "grid gap-4 lg:grid-cols-2" : "space-y-2.5"}>
      {blocks.map((b, i) => (
        <div
          key={`${b.type}-${i}`}
          className={wide && FULL.has(b.type) ? "lg:col-span-2" : ""}
        >
          <BlockView block={b} onPick={onPick} wide={wide} />
        </div>
      ))}
    </div>
  );
}

function BlockView({
  block: b,
  onPick,
  wide,
}: {
  block: UiBlock;
  onPick: (slug: string) => void;
  wide: boolean;
}) {
  switch (b.type) {
    case "callout":
      return <Callout b={b} />;
    case "stats":
      return <Stats b={b} wide={wide} />;
    case "topics":
      return (
        <Frame title={s(b.title)} subtitle={s(b.subtitle)}>
          <div className="flex flex-wrap gap-1.5">
            {arr(b.items).map((t, i) => (
              <Pill key={`${t.slug}-${i}`} t={t} onPick={onPick} />
            ))}
          </div>
        </Frame>
      );
    case "ranking":
      return <Ranking b={b} onPick={onPick} />;
    case "path":
      return <PathView b={b} onPick={onPick} />;
    case "issues":
      return <Issues b={b} onPick={onPick} />;
    case "groups":
      return <Groups b={b} onPick={onPick} />;
    case "compare":
      return <Compare b={b} onPick={onPick} />;
    case "roadmap":
      return <Roadmap b={b} onPick={onPick} />;
    case "bullets":
      return <Bullets b={b} />;
    case "approaches":
      return <Approaches b={b} />;
    case "timeline":
      return <Timeline b={b} onPick={onPick} />;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ frame */

function Frame({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section
      className="rounded-xl p-3"
      style={{ backgroundColor: WHITE, ...border }}
    >
      {title && (
        <header className="mb-2">
          <h4
            className="text-[13px] font-black"
            style={{ fontFamily: DISPLAY_FONT }}
          >
            {title}
          </h4>
          {subtitle && (
            <p className="text-[12px] font-semibold text-neutral-700">
              {subtitle}
            </p>
          )}
        </header>
      )}
      {children}
    </section>
  );
}

function Dot({ level, size = 10 }: { level?: string | null; size?: number }) {
  return (
    <span
      className="shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        backgroundColor: level ? (LEVEL_COLOR[level] ?? CARD) : "transparent",
        border: `1.5px ${level ? "solid" : "dashed"} ${INK}`,
      }}
    />
  );
}

function Pill({ t, onPick }: { t: Obj; onPick: (slug: string) => void }) {
  const assessed = t.assessed !== false;
  return (
    <button
      type="button"
      title={s(t.note)}
      onClick={() => (assessed ? onPick(s(t.slug)) : undefined)}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-bold transition-transform hover:-translate-y-0.5"
      style={{
        backgroundColor: assessed ? WHITE : CARD,
        border: `2px ${assessed ? "solid" : "dashed"} ${INK}`,
        cursor: assessed ? "pointer" : "default",
      }}
    >
      <Dot level={t.level} />
      {s(t.name)}
      {t.note && (
        <span className="font-semibold text-neutral-700">· {s(t.note)}</span>
      )}
    </button>
  );
}

/* ---------------------------------------------------------------- callout */

function Callout({ b }: { b: Obj }) {
  return (
    <div
      className="rounded-xl p-3"
      style={{
        backgroundColor: WHITE,
        ...border,
        borderLeft: `8px solid ${TONE[s(b.tone)] ?? SKY}`,
      }}
    >
      <div
        className="text-[13px] font-black"
        style={{ fontFamily: DISPLAY_FONT }}
      >
        {s(b.title)}
      </div>
      {b.text && (
        <p className="mt-0.5 text-[13px] leading-5 text-neutral-900">
          {s(b.text)}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ stats */

function Stats({ b, wide }: { b: Obj; wide: boolean }) {
  const items = arr(b.items);
  return (
    <div
      className={`grid gap-2 ${wide ? "grid-cols-3 sm:grid-cols-6" : "grid-cols-3"}`}
    >
      {items.map((it, i) => (
        <div
          key={i}
          className="rounded-xl px-2 py-2 text-center"
          style={{ backgroundColor: WHITE, ...border }}
        >
          <div
            className="text-[17px] font-black leading-none"
            style={{ fontFamily: DISPLAY_FONT }}
          >
            {s(it.value)}
          </div>
          <div className="mt-1 text-[11px] font-bold uppercase text-neutral-700">
            {s(it.label)}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- ranking */

function Ranking({ b, onPick }: { b: Obj; onPick: (slug: string) => void }) {
  const color = s(b.metric).toLowerCase().includes("between") ? CORAL : SKY;
  return (
    <Frame title={s(b.title)} subtitle={s(b.subtitle)}>
      <div className="space-y-2">
        {arr(b.items).map((it, i) => (
          <div key={`${it.slug}-${i}`}>
            <div className="flex items-center justify-between gap-2 text-[12px]">
              <button
                type="button"
                onClick={() => onPick(s(it.slug))}
                className="flex min-w-0 items-center gap-1.5 font-black hover:underline"
              >
                <Dot level={it.level} />
                <span className="truncate">{s(it.name)}</span>
              </button>
              <span className="shrink-0 font-bold text-neutral-700">
                {s(it.display)}
              </span>
            </div>
            <div
              className="mt-1 h-2.5 overflow-hidden rounded-full"
              style={{ backgroundColor: CARD, border: `1.5px solid ${INK}` }}
            >
              <div
                className="h-full"
                style={{
                  width: `${Math.max(4, n(it.norm) * 100)}%`,
                  backgroundColor: color,
                }}
              />
            </div>
            {it.note && (
              <div className="mt-0.5 text-[11px] font-semibold text-neutral-700">
                {s(it.note)}
              </div>
            )}
          </div>
        ))}
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------- path */

function PathView({ b, onPick }: { b: Obj; onPick: (slug: string) => void }) {
  const steps = arr(b.steps);
  return (
    <Frame title={s(b.title)}>
      <div className="flex flex-wrap items-center gap-y-2">
        {steps.map((st, i) => (
          <div key={`${st.slug}-${i}`} className="flex items-center">
            <Pill t={st} onPick={onPick} />
            {i < steps.length - 1 && (
              <span className="mx-1.5 flex flex-col items-center text-[10px] font-black uppercase text-neutral-700">
                <ArrowRight size={14} strokeWidth={3} />
                {s(st.edge)}
              </span>
            )}
          </div>
        ))}
      </div>
    </Frame>
  );
}

/* ----------------------------------------------------------------- issues */

function Issues({ b, onPick }: { b: Obj; onPick: (slug: string) => void }) {
  return (
    <Frame title={s(b.title)}>
      <div className="space-y-2">
        {arr(b.items).map((it, i) => {
          const slug = s((it.slugs as string[] | undefined)?.[0]);
          return (
            <button
              key={i}
              type="button"
              onClick={() => slug && onPick(slug)}
              className="block w-full rounded-lg p-2 text-left hover:opacity-80"
              style={{
                backgroundColor: CARD,
                borderLeft: `6px solid ${SEVERITY[s(it.severity)] ?? SKY}`,
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="rounded-full px-2 py-px text-[10px] font-black uppercase"
                  style={{
                    backgroundColor: SEVERITY[s(it.severity)] ?? SKY,
                    ...border,
                  }}
                >
                  {s(it.severity)}
                </span>
                <span className="text-[13px] font-black">{s(it.title)}</span>
              </div>
              <p className="mt-1 text-[12px] leading-4 text-neutral-900">
                {s(it.detail)}
              </p>
            </button>
          );
        })}
      </div>
    </Frame>
  );
}

/* ----------------------------------------------------------------- groups */

function Groups({ b, onPick }: { b: Obj; onPick: (slug: string) => void }) {
  return (
    <Frame title={s(b.title)} subtitle={s(b.subtitle)}>
      <div className="space-y-2.5">
        {arr(b.groups).map((g, i) => (
          <div
            key={`${g.key}-${i}`}
            className="pb-2"
            style={{
              borderBottom:
                i < arr(b.groups).length - 1 ? `1px solid ${LINE}` : undefined,
            }}
          >
            <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
              <span
                className="text-[13px] font-black"
                style={{ fontFamily: DISPLAY_FONT }}
              >
                {s(g.label)}
              </span>
              {g.note && (
                <span className="text-[11px] font-semibold text-neutral-700">
                  {s(g.note)}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {arr(g.items).map((t, j) => (
                <Pill key={`${t.slug}-${j}`} t={t} onPick={onPick} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

/* ---------------------------------------------------------------- compare */

function Compare({ b, onPick }: { b: Obj; onPick: (slug: string) => void }) {
  const cols = arr(b.columns);
  return (
    <Frame title={s(b.title)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              <th className="py-1 pr-2 text-left" />
              {cols.map((c) => (
                <th key={s(c.slug)} className="px-1.5 py-1 text-left">
                  <button
                    type="button"
                    onClick={() => onPick(s(c.slug))}
                    className="inline-flex items-center gap-1.5 font-black hover:underline"
                  >
                    <Dot level={c.level} /> {s(c.name)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {arr(b.rows).map((r, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${LINE}` }}>
                <td className="py-1.5 pr-2 font-black text-neutral-700">
                  {s(r.label)}
                </td>
                {(r.values as string[]).map((v, j) => (
                  <td
                    key={j}
                    className="px-1.5 py-1.5 font-bold"
                    style={
                      r.best === j
                        ? { backgroundColor: `${GREEN}33` }
                        : undefined
                    }
                  >
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Frame>
  );
}

/* ---------------------------------------------------------------- roadmap */

function Roadmap({ b, onPick }: { b: Obj; onPick: (slug: string) => void }) {
  return (
    <Frame title={s(b.title)}>
      <ol className="space-y-2">
        {arr(b.steps).map((st, i) => {
          const status = s(st.status);
          const bg =
            status === "known"
              ? GREEN
              : status === "target"
                ? YELLOW
                : LAVENDER;
          return (
            <li key={`${st.slug}-${i}`} className="flex items-start gap-2.5">
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-black"
                style={{ backgroundColor: bg, ...border }}
              >
                {status === "known" ? <CheckCircle2 size={13} /> : s(st.order)}
              </span>
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => (st.assessed ? onPick(s(st.slug)) : undefined)}
                  className="text-[13px] font-black hover:underline"
                  style={{ opacity: status === "known" ? 0.65 : 1 }}
                >
                  {s(st.name)}
                  {status === "target" && " (target)"}
                </button>
                <p className="text-[12px] leading-4 text-neutral-800">
                  {s(st.why)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </Frame>
  );
}

/* ---------------------------------------------------------------- bullets */

function Bullets({ b }: { b: Obj }) {
  const good = s(b.tone) === "good";
  return (
    <Frame title={s(b.title)}>
      <ul className="space-y-1.5">
        {(b.items as string[]).map((it, i) => (
          <li key={i} className="flex items-start gap-2 text-[12px] leading-4">
            {good ? (
              <CheckCircle2
                size={14}
                color={GREEN}
                className="mt-px shrink-0"
              />
            ) : (
              <Flame size={14} color={CORAL} className="mt-px shrink-0" />
            )}
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

/* ------------------------------------------------------------- approaches */

function Approaches({ b }: { b: Obj }) {
  return (
    <Frame title={s(b.title)}>
      <div className="space-y-2">
        {arr(b.items).map((a, i) => (
          <div
            key={i}
            className="pl-3"
            style={{
              borderLeft: `4px solid ${LEVEL_COLOR[s(a.depth)] ?? LINE}`,
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-1.5 text-[12px]">
              <span className="font-black">{s(a.name)}</span>
              <span className="font-bold text-neutral-700">
                {a.primary ? "primary · " : ""}
                {LEVEL_LABEL[s(a.depth)] ?? s(a.depth)} · {s(a.authenticity)}
              </span>
            </div>
            {a.how && (
              <p className="text-[12px] leading-4 text-neutral-900">
                {s(a.how)}
              </p>
            )}
          </div>
        ))}
      </div>
    </Frame>
  );
}

/* --------------------------------------------------------------- timeline */

function Timeline({ b, onPick }: { b: Obj; onPick: (slug: string) => void }) {
  return (
    <Frame title={s(b.title)} subtitle={s(b.subtitle)}>
      <div className="space-y-1.5">
        {arr(b.items).map((it, i) => (
          <div
            key={`${it.slug}-${i}`}
            className="flex items-center gap-2 text-[12px]"
          >
            <span className="w-14 shrink-0 text-right font-bold text-neutral-700">
              {s(it.display)}
            </span>
            <div
              className="relative h-5 min-w-0 flex-1 overflow-hidden rounded-md"
              style={{ backgroundColor: CARD, border: `1.5px solid ${INK}` }}
            >
              <div
                className="absolute inset-y-0 left-0"
                style={{
                  width: `${Math.max(6, n(it.value) * 100)}%`,
                  backgroundColor: GREEN,
                  opacity: 0.55,
                }}
              />
              <button
                type="button"
                onClick={() => onPick(s(it.slug))}
                className="absolute inset-0 flex items-center px-2 text-left font-black hover:underline"
              >
                <span className="truncate">{s(it.label)}</span>
                <span className="ml-auto shrink-0 pl-2 font-semibold text-neutral-800">
                  {s(it.note)}
                </span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

/* ========================================================================== */
/* CHAT MESSAGE                                                               */
/*                                                                            */
/*   1. Answer            streamed text                                       */
/*   2. Tools used        chips (live while running)                          */
/*   3. Evidence          blocks built from graph results                     */
/*   4. How it was answered   per tool: inputs, graph operations, steps       */
/*   5. Ask next          follow-ups                                          */
/* ========================================================================== */

function Section({
  label,
  right,
  children,
  flush = false,
}: {
  label: string;
  right?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <section
      className="overflow-hidden rounded-2xl"
      style={{ backgroundColor: WHITE, ...border }}
    >
      <div
        className="flex items-center justify-between gap-2 px-3 py-1.5"
        style={{ backgroundColor: CARD, borderBottom: `2px solid ${INK}` }}
      >
        <span className="text-[11px] font-black uppercase tracking-[.14em] text-neutral-700">
          {label}
        </span>
        {right}
      </div>
      <div className={flush ? "" : "p-3"}>{children}</div>
    </section>
  );
}

function StateDot({ state }: { state: "run" | "done" | "miss" | "fail" }) {
  const bg =
    state === "done"
      ? GREEN
      : state === "run"
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
      ) : state === "miss" ? (
        <CircleDashed size={11} />
      ) : (
        <XCircle size={11} />
      )}
    </span>
  );
}

function ToolChip({
  title,
  state,
  ms,
}: {
  title: string;
  state: "run" | "done" | "miss" | "fail";
  ms?: unknown;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full py-0.5 pl-1 pr-2.5 text-[12px] font-bold"
      style={{
        backgroundColor: state === "run" ? `${YELLOW}55` : WHITE,
        border: `2px ${state === "miss" ? "dashed" : "solid"} ${INK}`,
      }}
    >
      <StateDot state={state} />
      {title}
      {ms != null && state !== "run" && (
        <span className="text-[11px] font-semibold text-neutral-600">
          {fmtMs(ms)}
        </span>
      )}
    </span>
  );
}

export function AiMessage({
  m,
  onPick,
  onFollow,
  onOpen,
}: {
  m: Obj;
  onPick: (slug: string) => void;
  onFollow: (q: string) => void;
  onOpen: () => void;
}) {
  const pending = m.pending === true;
  const text = s(m.text);
  const blocks = arr(m.blocks);
  const followups = (m.followups ?? []) as string[];
  const slugs = (m.slugs ?? []) as string[];
  const tools = arr(m.tools);
  const liveSteps = arr(m.steps) as LiveStep[];
  const ranTools = tools.filter((t) => !t.skipped);

  return (
    <div className="w-full space-y-2.5">
      {/* 1. ANSWER (streamed) */}
      <Section label="Answer">
        {text ? (
          <p className="whitespace-pre-wrap text-[13px] leading-[1.65] text-neutral-950">
            {text}
            {pending && (
              <span
                aria-hidden
                className="ml-0.5 inline-block h-[14px] w-[7px] translate-y-[2px]"
                style={{
                  backgroundColor: INK,
                  animation: "oblink 0.9s ease-in-out infinite",
                }}
              />
            )}
          </p>
        ) : pending ? (
          <div
            className="flex items-center gap-2 text-[13px] font-bold text-neutral-800"
            aria-live="polite"
          >
            <Loader2 size={14} className="animate-spin" strokeWidth={3} />
            {liveSteps.length
              ? "Reading your graph…"
              : "Working out which graph tools to use…"}
          </div>
        ) : (
          <p className="text-[13px] text-neutral-700">
            No answer was produced.
          </p>
        )}
        {m.local && (
          <p className="mt-2 text-[11px] font-bold text-neutral-600">
            Answered from the graph already loaded in your browser (live service
            unavailable).
          </p>
        )}
      </Section>

      {/* 2. TOOLS USED */}
      {(pending ? liveSteps.length > 0 : ranTools.length > 0) && (
        <div className="px-0.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[.14em] text-neutral-600">
            <Wrench size={12} strokeWidth={3} />
            {pending ? "Running" : "Tools used"}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {pending
              ? liveSteps.map((st) => (
                  <ToolChip
                    key={st.tool}
                    title={st.title}
                    state={st.state}
                    ms={st.ms}
                  />
                ))
              : ranTools.map((t, i) => (
                  <ToolChip
                    key={`${t.name}-${i}`}
                    title={s(t.title)}
                    state={!t.ok ? "fail" : t.miss ? "miss" : "done"}
                    ms={t.ms}
                  />
                ))}
          </div>
        </div>
      )}

      {/* 3. EVIDENCE */}
      {blocks.length > 0 && (
        <Section
          label="Evidence from your graph"
          right={
            <button
              type="button"
              onClick={onOpen}
              className="rounded-full px-2.5 py-0.5 text-[11px] font-black"
              style={{ backgroundColor: WHITE, ...border }}
            >
              Open full width
            </button>
          }
        >
          <Blocks blocks={blocks as UiBlock[]} onPick={onPick} />
        </Section>
      )}

      {/* local fallback: topics mentioned */}
      {slugs.length > 0 && !blocks.length && !pending && (
        <div className="flex flex-wrap gap-1.5 px-0.5">
          {slugs.slice(0, 8).map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => onPick(x)}
              className="rounded-full px-2.5 py-0.5 text-[12px] font-black"
              style={{ backgroundColor: WHITE, ...border }}
            >
              {x.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      )}

      {/* 4. HOW IT WAS ANSWERED */}
      {!pending && tools.length > 0 && (
        <div
          className="overflow-hidden rounded-2xl"
          style={{ backgroundColor: WHITE, ...border }}
        >
          <ToolTrace tools={tools} meta={m.meta} />
        </div>
      )}

      {/* 5. ASK NEXT */}
      {!pending && followups.length > 0 && (
        <div className="px-0.5">
          <div className="mb-1.5 text-[11px] font-black uppercase tracking-[.14em] text-neutral-600">
            Ask next
          </div>
          <div className="flex flex-wrap gap-1.5">
            {followups.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => onFollow(f)}
                className="rounded-full px-2.5 py-0.5 text-[12px] font-bold transition-transform hover:-translate-y-0.5"
                style={{ backgroundColor: LAVENDER, ...border }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */
/* TOOL TRACE: which tools ran and how each one reached its result            */
/* ========================================================================== */

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

function StepList({ steps }: { steps: string[] }) {
  return (
    <ol className="mt-1.5 space-y-1.5">
      {steps.map((st, i) => (
        <li key={i} className="flex items-start gap-2">
          <span
            className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-black"
            style={{ backgroundColor: CARD, border: `1.5px solid ${INK}` }}
          >
            {i + 1}
          </span>
          <span className="text-[12px] leading-[1.55] text-neutral-900">
            {st}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ToolCard({ t }: { t: Obj }) {
  const skipped = t.skipped === true;
  const miss = t.miss === true && !skipped;
  const failed = !t.ok && !skipped;
  const state: "done" | "miss" | "fail" = failed
    ? "fail"
    : skipped || miss
      ? "miss"
      : "done";
  const label = skipped
    ? "skipped"
    : failed
      ? "failed"
      : miss
        ? "no match"
        : "used";
  const args = Object.entries((t.args ?? {}) as Obj).filter(
    ([, v]) => v != null && v !== "",
  );
  const features = (Array.isArray(t.features) ? t.features : []) as string[];
  const how = (Array.isArray(t.how) ? t.how : []).map((x: unknown) => s(x));

  return (
    <div
      className="rounded-xl p-2.5"
      style={{
        backgroundColor: WHITE,
        border: `1.5px ${skipped ? "dashed" : "solid"} ${INK}`,
        opacity: skipped || miss ? 0.85 : 1,
      }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <StateDot state={state} />
        <span className="text-[13px] font-black">{s(t.title)}</span>
        <Badge
          text={label}
          bg={failed ? CORAL : skipped || miss ? LINE : GREEN}
        />
        {!skipped && (
          <span className="ml-auto text-[11px] font-bold text-neutral-600">
            {fmtMs(t.ms)}
          </span>
        )}
      </div>

      {skipped ? (
        <p className="mt-1.5 text-[12px] leading-4 text-neutral-800">
          {s(t.error)}. Nothing was run for it, so no wrong answer was shown.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {t.why && (
            <p className="text-[12px] leading-4 text-neutral-800">
              <span className="font-black">Why this tool: </span>
              {s(t.why)}
            </p>
          )}

          {(args.length > 0 || features.length > 0) && (
            <div className="flex flex-wrap items-center gap-1">
              {args.map(([k, v]) => (
                <code
                  key={k}
                  className="rounded px-1.5 py-px text-[11px]"
                  style={{ backgroundColor: CARD, fontFamily: MONO }}
                >
                  {k}={s(v)}
                </code>
              ))}
              {features.map((f) => (
                <Badge key={f} text={f} bg={LAVENDER} mono />
              ))}
            </div>
          )}

          {failed ? (
            <p className="text-[12px] leading-4" style={{ color: CORAL }}>
              <span className="font-black">Error: </span>
              {s(t.error)}
            </p>
          ) : miss ? (
            <p className="text-[12px] leading-4 text-neutral-800">
              Nothing in your graph matched, so this result was left out of the
              answer.
            </p>
          ) : (
            <>
              {how.length > 0 && (
                <div>
                  <div className="text-[10px] font-black uppercase tracking-wider text-neutral-600">
                    How it got there
                  </div>
                  <StepList steps={how} />
                </div>
              )}
              {t.contribution && (
                <p
                  className="rounded-lg px-2 py-1.5 text-[12px] leading-4"
                  style={{ backgroundColor: `${GREEN}22` }}
                >
                  <span className="font-black">Added to the answer: </span>
                  {s(t.contribution)}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ToolTrace({
  tools,
  meta,
}: {
  tools: Obj[];
  meta?: Obj | null;
}) {
  if (!tools.length) return null;
  const m = (meta ?? {}) as Obj;
  const ran = tools.filter((t) => !t.skipped);
  const used = ran.filter((t) => t.ok && !t.miss).length;

  return (
    <details className="group">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2.5 text-[12px] font-black">
        <ChevronRight
          size={14}
          strokeWidth={3}
          className="transition-transform group-open:rotate-90"
        />
        How this answer was reached
        <span className="font-bold text-neutral-700">
          · {used} graph tool{used === 1 ? "" : "s"} used
        </span>
        {m.durationMs != null && (
          <span className="ml-auto text-[11px] font-bold text-neutral-600">
            {fmtMs(m.durationMs)}
          </span>
        )}
      </summary>
      <div
        className="space-y-2 px-3 pb-3 pt-2"
        style={{ borderTop: `1.5px solid ${LINE}` }}
      >
        {tools.map((t, i) => (
          <ToolCard key={`${t.name}-${i}`} t={t} />
        ))}
      </div>
    </details>
  );
}
