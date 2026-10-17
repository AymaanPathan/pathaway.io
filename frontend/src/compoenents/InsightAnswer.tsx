/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, type ReactNode } from "react";
import { ChevronRight, ArrowDown } from "lucide-react";
import { Blocks, ToolTrace } from "./ChatBlock";

type Obj = Record<string, any>;

const DISPLAY_FONT = '"Space Grotesk", "Arial Black", sans-serif';
const MONO = '"IBM Plex Mono", "SF Mono", ui-monospace, monospace';
const YELLOW = "#F5C542";
const CORAL = "#F0776B";
const SKY = "#5FA0D8";
const GREEN = "#3FA24A";
const PURPLE = "#8B72D9";
const LAVENDER = "#D8D0F2";
const INK = "#101210";
const PAPER = "#FBF7EA";
const LINE = "#E4E0D4";
const CARD = "#F1ECDC";
const WHITE = "#FFFFFF";
const border = { border: `2px solid ${INK}` };

const LEVEL_COLOR: Record<string, string> = {
  none: "#9ca3af",
  surface: "#f59e0b",
  working: "#3b82f6",
  proficient: PURPLE,
  deep: "#10b981",
};
const CONF_COLOR: Record<string, string> = {
  high: GREEN,
  medium: YELLOW,
  low: CORAL,
};

const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const fmtProf = (p?: Obj | null) =>
  !p || !p.assessed
    ? "Not assessed"
    : `${cap(String(p.level))}${p.score != null ? ` (${p.score}/100)` : ""}${p.source === "heuristic" ? " · estimate" : ""}`;

/* ------------------------------------------------------------------ */
/* The four measures, each with its own label so they can't be confused */
/* ------------------------------------------------------------------ */

function Measure({
  name,
  meaning,
  color,
  children,
}: {
  name: string;
  meaning: string;
  color: string;
  children: ReactNode;
}) {
  return (
    <div
      className="rounded-xl p-2.5"
      style={{
        backgroundColor: WHITE,
        ...border,
        borderTop: `5px solid ${color}`,
      }}
    >
      <div
        className="text-[10px] font-bold tracking-[0.14em] text-neutral-500"
        style={{ fontFamily: MONO }}
      >
        {name.toUpperCase()}
      </div>
      <div className="mt-1 text-[14px] font-bold leading-tight">{children}</div>
      <div className="mt-1 text-[11px] leading-4 text-neutral-600">
        {meaning}
      </div>
    </div>
  );
}

function Measures({ f }: { f: Obj }) {
  const top = f.proficiency?.topic as Obj | undefined;
  const fo = f.proficiency?.foundation as Obj | undefined;
  const dep = f.dependency as Obj | undefined;
  const conf = f.confidence as string | null | undefined;
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Measure
        name="Proficiency"
        meaning={
          top?.source === "heuristic"
            ? "Estimate from graph stats. No model judgement."
            : "Assessed depth of your skill"
        }
        color={PURPLE}
      >
        {top ? (
          <>
            <span>{fmtProf(top)}</span>
            {fo && (
              <span className="block text-[12px] font-semibold text-neutral-700">
                base: {fmtProf(fo)}
              </span>
            )}
          </>
        ) : (
          "–"
        )}
      </Measure>
      <Measure
        name="Confidence"
        meaning="How strong the evidence is. Not skill."
        color={CONF_COLOR[conf ?? ""] ?? LINE}
      >
        {conf ? `${cap(conf)} evidence` : "No evidence yet"}
      </Measure>
      <Measure
        name="Graph importance"
        meaning="How central the base is in the graph. Not skill."
        color={SKY}
      >
        {f.importance?.value != null
          ? `PageRank lift ${f.importance.value}`
          : "–"}
      </Measure>
      <Measure
        name="Gap priority"
        meaning="Why this one comes first"
        color={CORAL}
      >
        {f.priority ? `#${f.priority.rank} of ${f.priority.of}` : "–"}
        {dep && (
          <span className="block text-[12px] font-semibold text-neutral-700">
            {dep.relation === "direct"
              ? "direct prerequisite"
              : `multi-hop, ${dep.hops} hops`}
          </span>
        )}
      </Measure>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Exact graph path: node (level, score) -> edge type -> node           */
/* ------------------------------------------------------------------ */

function PathTrace({
  path,
  onPick,
}: {
  path: Obj;
  onPick: (slug: string) => void;
}) {
  const steps = arr(path.steps);
  const edges = arr(path.edges);
  return (
    <div
      className="rounded-xl p-3"
      style={{ backgroundColor: PAPER, ...border }}
    >
      <div className="flex flex-col items-stretch gap-1">
        {steps.map((s, i) => {
          const p = s.proficiency as Obj | null;
          const e = edges[i];
          const clickable = !!s.slug && p?.assessed;
          return (
            <div key={i} className="flex flex-col items-stretch gap-1">
              <button
                type="button"
                onClick={() => (clickable ? onPick(String(s.slug)) : undefined)}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left"
                style={{
                  backgroundColor: WHITE,
                  border: `2px ${p?.assessed ? "solid" : "dashed"} ${INK}`,
                  cursor: clickable ? "pointer" : "default",
                }}
              >
                <span
                  className="inline-block h-3 w-3 shrink-0 rounded-full"
                  style={{
                    backgroundColor: LEVEL_COLOR[String(p?.level)] ?? CARD,
                    border: `1.5px solid ${INK}`,
                  }}
                />
                <span className="text-[13px] font-bold">{s.name}</span>
                <span className="ml-auto text-[12px] font-bold text-neutral-700">
                  {fmtProf(p)}
                  {p?.confidence ? `, ${p.confidence} conf.` : ""}
                </span>
              </button>
              {e && (
                <div className="flex flex-wrap items-center gap-2 pl-5 text-[12px]">
                  <ArrowDown size={13} strokeWidth={3} />
                  <code
                    className="rounded px-1.5 py-px text-[11px] font-bold"
                    style={{
                      backgroundColor: LAVENDER,
                      border: `1.5px solid ${INK}`,
                      fontFamily: MONO,
                    }}
                  >
                    {e.type}
                  </code>
                  <span
                    className="rounded-full px-2 py-px text-[11px] font-bold"
                    style={{
                      backgroundColor: e.relation === "direct" ? SKY : YELLOW,
                      border: `1.5px solid ${INK}`,
                    }}
                  >
                    {e.relation === "direct"
                      ? "direct"
                      : `multi-hop, ${e.hops} hops`}
                  </span>
                  {e.relation === "multi_hop" && (
                    <span className="text-neutral-600">
                      intermediate topics not listed by the tool
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[12px] leading-4 text-neutral-700">
        {path.meaning}
      </p>
    </div>
  );
}

function Fold({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: string | number;
  children: ReactNode;
}) {
  return (
    <details className="group" style={{ borderTop: `1px solid ${LINE}` }}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 py-2.5 text-[13px] font-bold">
        <ChevronRight
          size={14}
          strokeWidth={3}
          className="transition-transform duration-200 group-open:rotate-90"
        />
        {title}
        {badge != null && (
          <span
            className="ml-1 rounded-full px-1.5 text-[11px]"
            style={{ backgroundColor: CARD, border: `1.5px solid ${INK}` }}
          >
            {badge}
          </span>
        )}
      </summary>
      <div className="pb-3">{children}</div>
    </details>
  );
}

function EvidenceList({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <ul className="space-y-1">
      {lines.map((l, i) => (
        <li
          key={i}
          className="pl-2.5 text-[12px] leading-4 text-neutral-800"
          style={{ borderLeft: `3px solid ${LINE}` }}
        >
          {l}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Main                                                                 */
/* ------------------------------------------------------------------ */

export default function InsightAnswer({
  m,
  onPick,
  onFollow,
  onOpen,
}: {
  m: Obj;
  onPick: (slug: string) => void;
  onFollow: (q: string) => void;
  onOpen?: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const insight = (m.insight ?? {}) as Obj;
  const diag = insight.diagnosis as Obj | null;
  const findings = arr(m.findings);
  const paths = arr(m.graphPaths);
  const primary = findings.find((f) => f.id === diag?.findingId) ?? null;
  const keyPath = paths.find((p) => p.id === insight.keyPathId) ?? null;
  const action = insight.nextAction as Obj | null;

  const others = findings.filter((f) => f.id !== diag?.findingId);
  const shownPathIds = new Set<string>(
    [insight.keyPathId, ...others.map((f) => f.pathId)].filter(Boolean),
  );
  const loosePaths = paths.filter((p) => !shownPathIds.has(p.id));
  const limitations = Array.from(
    new Set(
      findings.flatMap((f) =>
        Array.isArray(f.limitations) ? (f.limitations as string[]) : [],
      ),
    ),
  );
  const tools = arr(m.tools);

  /* nothing structured to lead with: plain text card */
  if (!diag) {
    return (
      <div
        className="w-full rounded-2xl px-3.5 py-3 text-[13px] leading-[1.65]"
        style={{ backgroundColor: PAPER, ...border, borderBottomLeftRadius: 4 }}
      >
        {m.text}
      </div>
    );
  }

  return (
    <div
      className="w-full space-y-3 rounded-2xl p-3.5"
      style={{ backgroundColor: PAPER, ...border, borderBottomLeftRadius: 4 }}
    >
      {/* 1. DIAGNOSIS */}
      <div>
        <div
          className="text-[10px] font-bold tracking-[0.16em] text-neutral-500"
          style={{ fontFamily: MONO }}
        >
          DIAGNOSIS
        </div>
        <h3
          className="mt-1 text-[16px] font-bold leading-snug"
          style={{ fontFamily: DISPLAY_FONT }}
        >
          {diag.headline}
        </h3>
        {diag.detail && diag.detail !== diag.headline && (
          <p className="mt-1.5 text-[13px] leading-5 text-neutral-800">
            {diag.detail}
          </p>
        )}
      </div>

      {primary?.kind === "gap" && <Measures f={primary} />}

      {/* 2. ONE NEXT ACTION */}
      {action && (
        <button
          type="button"
          onClick={() =>
            action.prompt ? onFollow(String(action.prompt)) : undefined
          }
          className="flex w-full items-start gap-2 rounded-xl p-3 text-left"
          style={{
            backgroundColor: YELLOW,
            ...border,
            boxShadow: `2px 2px 0 0 ${INK}`,
          }}
        >
          <ChevronRight size={16} strokeWidth={3} className="mt-0.5 shrink-0" />
          <span>
            <span
              className="block text-[10px] font-bold tracking-[0.14em]"
              style={{ fontFamily: MONO }}
            >
              NEXT ACTION
            </span>
            <span className="block text-[14px] font-bold">{action.title}</span>
            <span className="block text-[12px] leading-4">{action.reason}</span>
          </span>
        </button>
      )}

      {/* 3. STRONGEST PROOF: the exact path, then the evidence under it */}
      {keyPath && (
        <div>
          <div
            className="mb-1.5 text-[10px] font-bold tracking-[0.16em] text-neutral-500"
            style={{ fontFamily: MONO }}
          >
            GRAPH PATH BEHIND THIS
          </div>
          <PathTrace path={keyPath} onPick={onPick} />
        </div>
      )}
      {Array.isArray(insight.keyEvidence) && insight.keyEvidence.length > 0 && (
        <div>
          <div
            className="mb-1.5 text-[10px] font-bold tracking-[0.16em] text-neutral-500"
            style={{ fontFamily: MONO }}
          >
            EVIDENCE
          </div>
          <EvidenceList lines={insight.keyEvidence as string[]} />
        </div>
      )}

      {/* 4. EVERYTHING ELSE ON DEMAND */}
      <div style={{ borderBottom: `1px solid ${LINE}` }}>
        {primary?.priority && (
          <Fold title="Why this gap comes first">
            <p className="text-[12px] leading-5 text-neutral-800">
              {primary.priority.reason}
            </p>
          </Fold>
        )}

        {others.length > 0 && (
          <Fold title="Other findings" badge={others.length}>
            <div className="space-y-3">
              {others.map((f) => {
                const p = paths.find((x) => x.id === f.pathId);
                return (
                  <div
                    key={f.id}
                    className="rounded-xl p-2.5"
                    style={{ backgroundColor: WHITE, ...border }}
                  >
                    <p className="text-[13px] font-bold leading-5">{f.claim}</p>
                    {f.kind === "gap" && (
                      <div className="mt-2">
                        <Measures f={f} />
                      </div>
                    )}
                    {p && (
                      <div className="mt-2">
                        <PathTrace path={p} onPick={onPick} />
                      </div>
                    )}
                    <div className="mt-2">
                      <EvidenceList lines={(f.evidence as string[]) ?? []} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Fold>
        )}

        {loosePaths.length > 0 && (
          <Fold title="Other graph paths" badge={loosePaths.length}>
            <div className="space-y-2">
              {loosePaths.map((p) => (
                <PathTrace key={p.id} path={p} onPick={onPick} />
              ))}
            </div>
          </Fold>
        )}

        {limitations.length > 0 && (
          <Fold title="Limits of this answer" badge={limitations.length}>
            <ul className="space-y-1">
              {limitations.map((l, i) => (
                <li key={i} className="text-[12px] leading-4 text-neutral-800">
                  {l}
                </li>
              ))}
            </ul>
          </Fold>
        )}

        {Array.isArray(m.blocks) && m.blocks.length > 0 && (
          <Fold title="Tables and charts" badge={m.blocks.length}>
            <Blocks blocks={m.blocks} onPick={onPick} />
            {onOpen && (
              <button
                type="button"
                onClick={onOpen}
                className="press mt-2 rounded-full px-3 py-1 text-[12px] font-bold"
                style={{ backgroundColor: WHITE, ...border }}
              >
                Open full width
              </button>
            )}
          </Fold>
        )}

        {tools.length > 0 && (
          <Fold
            title="How this was computed (algorithms and tool runs)"
            badge={tools.length}
          >
            <ToolTrace tools={tools} meta={m.meta} />
          </Fold>
        )}
      </div>

      {Array.isArray(m.followups) && m.followups.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {(showAll ? m.followups : m.followups.slice(0, 3)).map(
            (q: string) => (
              <button
                key={q}
                type="button"
                onClick={() => onFollow(q)}
                className="press rounded-full px-2.5 py-1 text-left text-[12px] font-bold"
                style={{ backgroundColor: WHITE, ...border }}
              >
                {q}
              </button>
            ),
          )}
          {m.followups.length > 3 && !showAll && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="text-[12px] font-bold underline"
            >
              more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
