/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ExternalLink,
  RefreshCw,
  Rocket,
  Target,
} from "lucide-react";

// ============================================================
// THEME
// ============================================================

const YELLOW = "#F5C542";
const CORAL = "#F2704F";
const SOFT_CORAL = "#FFE3DA";
const GREEN = "#3FA24A";
const MINT = "#BFE3C4";
const LIGHT_GREEN = "#E4F3E5";
const LAVENDER = "#D8D0F2";
const CREAM = "#FBF3D6";
const INK = "#101210";
const PAPER = "#F1EEE7";
const LINE = "#DAD6CC";
const DISPLAY_FONT = '"Space Grotesk", "Arial Black", sans-serif';
const BODY_FONT = '"Inter", "Helvetica Neue", sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const border = { border: `2px solid ${INK}` };
const shadow = (n = 4) => `${n}px ${n}px 0 0 ${INK}`;

/* the mission page lives at /mission in App.tsx */
const MISSION_ROUTE = "/mission";

// ============================================================
// Shows ONE goal and how the graph + agent reached it.
// The goal is already built and saved here, so "Start mission" only
// redirects to the mission page with the saved goal id; the mission page
// creates (or reopens) the mission for it.
// Result comes from router state ({ state: { result } }) or sessionStorage.
// Needs explanation.graph.{topicNodes, links, context, ranking} and
// explanation.trace from the route.
// ============================================================

type Level = "none" | "surface" | "working" | "proficient" | "deep";
const LEVEL_ORDER: Level[] = [
  "none",
  "surface",
  "working",
  "proficient",
  "deep",
];
const LEVEL_META: Record<
  Level,
  { label: string; fill: string; color: string }
> = {
  none: { label: "Not in your code", fill: "#fff", color: INK },
  surface: { label: "Surface", fill: SOFT_CORAL, color: INK },
  working: { label: "Working", fill: YELLOW, color: INK },
  proficient: { label: "Proficient", fill: LAVENDER, color: INK },
  deep: { label: "Deep", fill: GREEN, color: "#fff" },
};

type OpStatus = "ok" | "empty" | "failed" | "fallback";
type Op = {
  id: string;
  kind: string;
  purpose: string;
  status: OpStatus;
  result: string;
  durationMs: number;
};
type Evidence = {
  id: string;
  repository: string;
  path: string;
  technique: string;
  depth: string;
  commit: string;
  permalink: string;
};
type TNode = {
  slug: string;
  name: string;
  domain: string;
  role: string;
  hops: number;
  relevance: number;
  level: Level;
  assessed: boolean;
  authenticity: string;
};
type TLink = {
  a: string;
  b: string;
  type: string;
  reason: string;
  weight: number;
};
type CNode = { key: string; kind: string; label: string; score: number };
type CEdge = { from: string; to: string; type: string; weight: number };

// ---- decision trace (graph-backed explanation of the choice) ----
type TStep = {
  kind: string;
  label: string;
  slug: string;
  level: Level;
  detail: string;
  edgeType: string;
  edgeReason: string;
  relevance: number;
};
type TPath = {
  evidenceId: string;
  role: string;
  hops: number;
  steps: TStep[];
};
type TNeighbour = {
  slug: string;
  name: string;
  domain: string;
  linkType: string;
  reason: string;
  weight: number;
  level: Level;
  assessed: boolean;
  relevance: number;
};
type TBuilt = {
  id: string;
  repository: string;
  path: string;
  permalink: string;
  technique: string;
  depth: string;
  commit: string;
  what: string;
  excerpt: string;
};
type TAlt = {
  option: string;
  whyNot: string;
  tradeoff: string;
  evidence: Array<{ id: string; path: string }>;
};
type Trace = {
  seeds: string[];
  paths: TPath[];
  neighbours: TNeighbour[];
  built: TBuilt[];
  builds: { reused: string; changes: string; newBehavior: string };
  chosen: { title: string; why: string; evidenceIds: string[] };
  alternatives: TAlt[];
  progression: { existing: string[]; change: string; verified: string };
  basis: { observed: string; inferred: string; missing: string };
  verifyFirst: string;
};

type Goal = {
  id: string | null;
  title: string;
  why: string;
  focus: { slug: string; name: string; domain: string; level: Level };
  targetCapability: { id: string; name: string } | null;
  limitation: string;
  evidenceIds: string[];
  saved: boolean;
};
type Explanation = {
  understoodAs: {
    method: string;
    confidence: string;
    seeds: Array<{ slug: string; name: string; domain: string }>;
  };
  evidence: Evidence[];
  alternatives: Array<{ option: string; whyNot: string }>;
  trace: Trace | null;
  graph: {
    seeds: string[];
    topics: number;
    evidence: number;
    codeExcerpts: number;
    operations: Op[];
    topicNodes: TNode[];
    links: TLink[];
    context: { nodes: CNode[]; edges: CEdge[] };
    ranking: CNode[];
  } | null;
  source: string;
  llmCalls: number;
  timingsMs: { graph: number; llm: number; store: number; total: number };
  notes: string[];
};
type Result =
  | { kind: "goal"; goal: Goal; ex: Explanation }
  | {
      kind: "blocked";
      status: string;
      message: string;
      suggestions: Array<{ slug: string; name: string; domain: string }>;
      errors: string[];
      ex: Explanation;
    };

// ============================================================
// HELPERS
// ============================================================

const STORE_KEY = "pathway:goal-result";

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const str = (v: unknown, fb = ""): string => (typeof v === "string" ? v : fb);
const num = (v: unknown, fb = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fb;
const strs = (v: unknown): string[] =>
  arr<unknown>(v).filter((x): x is string => typeof x === "string");
const lvl = (l: unknown): Level =>
  typeof l === "string" && (LEVEL_ORDER as string[]).includes(l)
    ? (l as Level)
    : "none";
const trunc = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s;
const pick = (n: number, one: string, many: string) => (n === 1 ? one : many);

function normOps(v: unknown): Op[] {
  return arr<unknown>(v)
    .map(rec)
    .map((o) => ({
      id: str(o.id),
      kind: str(o.kind, "cypher"),
      purpose: str(o.purpose),
      status: (["ok", "empty", "failed", "fallback"].includes(str(o.status))
        ? str(o.status)
        : "ok") as OpStatus,
      result: str(o.result),
      durationMs: num(o.durationMs),
    }))
    .filter((o) => o.id);
}

function normTrace(v: unknown): Trace | null {
  const t = rec(v);
  if (!v || !Object.keys(t).length) return null;
  const b = rec(t.builds);
  const c = rec(t.chosen);
  const p = rec(t.progression);
  const basis = rec(t.basis);
  return {
    seeds: strs(t.seeds),
    paths: arr<unknown>(t.paths)
      .map(rec)
      .map((x) => ({
        evidenceId: str(x.evidenceId),
        role: str(x.role, "cited"),
        hops: num(x.hops),
        steps: arr<unknown>(x.steps)
          .map(rec)
          .map((s) => ({
            kind: str(s.kind, "topic"),
            label: str(s.label),
            slug: str(s.slug),
            level: lvl(s.level),
            detail: str(s.detail),
            edgeType: str(s.edgeType),
            edgeReason: str(s.edgeReason),
            relevance: num(s.relevance),
          }))
          .filter((s) => s.label),
      }))
      .filter((x) => x.steps.length > 0),
    neighbours: arr<unknown>(t.neighbours)
      .map(rec)
      .map((n) => ({
        slug: str(n.slug),
        name: str(n.name, str(n.slug)),
        domain: str(n.domain),
        linkType: str(n.linkType, "RELATED_TOPIC"),
        reason: str(n.reason),
        weight: num(n.weight, 0.5),
        level: lvl(n.level),
        assessed: n.assessed === true,
        relevance: num(n.relevance),
      }))
      .filter((n) => n.slug),
    built: arr<unknown>(t.built)
      .map(rec)
      .map((e) => ({
        id: str(e.id),
        repository: str(e.repository),
        path: str(e.path),
        permalink: str(e.permalink),
        technique: str(e.technique),
        depth: str(e.depth),
        commit: str(e.commit),
        what: str(e.what),
        excerpt: str(e.excerpt),
      }))
      .filter((e) => e.id),
    builds: {
      reused: str(b.reused),
      changes: str(b.changes),
      newBehavior: str(b.newBehavior),
    },
    chosen: {
      title: str(c.title),
      why: str(c.why),
      evidenceIds: strs(c.evidenceIds),
    },
    alternatives: arr<unknown>(t.alternatives)
      .map(rec)
      .map((a) => ({
        option: str(a.option),
        whyNot: str(a.whyNot),
        tradeoff: str(a.tradeoff),
        evidence: arr<unknown>(a.evidence)
          .map(rec)
          .map((e) => ({ id: str(e.id), path: str(e.path) }))
          .filter((e) => e.id),
      }))
      .filter((a) => a.option),
    progression: {
      existing: strs(p.existing),
      change: str(p.change),
      verified: str(p.verified),
    },
    basis: {
      observed: str(basis.observed),
      inferred: str(basis.inferred),
      missing: str(basis.missing),
    },
    verifyFirst: str(t.verifyFirst),
  };
}

function normExplanation(v: unknown): Explanation {
  const ex = rec(v);
  const u = rec(ex.understoodAs);
  const g = ex.graph ? rec(ex.graph) : null;
  const t = rec(ex.timingsMs);
  const ctx = rec(g?.context);
  const cnode = (x: unknown): CNode => {
    const n = rec(x);
    return {
      key: str(n.key),
      kind: str(n.kind),
      label: str(n.label),
      score: num(n.score),
    };
  };
  return {
    understoodAs: {
      method: str(u.method, "none"),
      confidence: str(u.confidence, "none"),
      seeds: arr<unknown>(u.seeds)
        .map(rec)
        .map((s) => ({
          slug: str(s.slug),
          name: str(s.name, str(s.slug)),
          domain: str(s.domain),
        }))
        .filter((s) => s.slug),
    },
    evidence: arr<unknown>(ex.evidence)
      .map(rec)
      .map((e) => ({
        id: str(e.id),
        repository: str(e.repository),
        path: str(e.path),
        technique: str(e.technique),
        depth: str(e.depth),
        commit: str(e.commit),
        permalink: str(e.permalink),
      }))
      .filter((e) => e.id),
    alternatives: arr<unknown>(ex.alternatives)
      .map(rec)
      .map((a) => ({ option: str(a.option), whyNot: str(a.whyNot) }))
      .filter((a) => a.option),
    trace: normTrace(ex.trace),
    graph: g
      ? {
          seeds: strs(g.seeds),
          topics: num(g.topics),
          evidence: num(g.evidence),
          codeExcerpts: num(g.codeExcerpts),
          operations: normOps(g.operations),
          topicNodes: arr<unknown>(g.topicNodes)
            .map(rec)
            .map((n) => ({
              slug: str(n.slug),
              name: str(n.name, str(n.slug)),
              domain: str(n.domain),
              role: str(n.role, "related"),
              hops: num(n.hops),
              relevance: num(n.relevance),
              level: lvl(n.level),
              assessed: n.assessed === true,
              authenticity: str(n.authenticity),
            }))
            .filter((n) => n.slug),
          links: arr<unknown>(g.links)
            .map(rec)
            .map((l) => ({
              a: str(l.a),
              b: str(l.b),
              type: str(l.type, "RELATED_TOPIC"),
              reason: str(l.reason),
              weight: num(l.weight, 0.5),
            }))
            .filter((l) => l.a && l.b),
          context: {
            nodes: arr<unknown>(ctx.nodes).map(cnode),
            edges: arr<unknown>(ctx.edges)
              .map(rec)
              .map((e) => ({
                from: str(e.from),
                to: str(e.to),
                type: str(e.type),
                weight: num(e.weight),
              })),
          },
          ranking: arr<unknown>(g.ranking).map(cnode),
        }
      : null,
    source: str(ex.source, "none"),
    llmCalls: num(ex.llmCalls),
    timingsMs: {
      graph: num(t.graph),
      llm: num(t.llm),
      store: num(t.store),
      total: num(t.total),
    },
    notes: strs(ex.notes),
  };
}

function normalize(raw: unknown): Result | null {
  const r = rec(raw);
  const ex = normExplanation(r.explanation);
  const status = str(r.status);

  if (status === "goal") {
    const g = rec(r.goal);
    const f = rec(g.focus);
    const tc = rec(g.targetCapability);
    if (!g.title) return null;
    return {
      kind: "goal",
      ex,
      goal: {
        id: typeof g.id === "string" ? g.id : null,
        title: str(g.title),
        why: str(g.why),
        focus: {
          slug: str(f.slug),
          name: str(f.name, str(f.slug)),
          domain: str(f.domain),
          level: lvl(f.level),
        },
        targetCapability: tc.id
          ? { id: str(tc.id), name: str(tc.name, str(tc.id)) }
          : null,
        limitation: str(rec(g.challenge).limitation),
        evidenceIds: strs(g.evidenceIds),
        saved: g.saved === true,
      },
    };
  }

  if (
    [
      "needs_clarification",
      "needs_evidence",
      "generation_failed",
      "llm_unavailable",
    ].includes(status)
  ) {
    return {
      kind: "blocked",
      status,
      message: str(r.message, "No goal could be generated."),
      suggestions: arr<unknown>(r.suggestions)
        .map(rec)
        .map((s) => ({
          slug: str(s.slug),
          name: str(s.name, str(s.slug)),
          domain: str(s.domain),
        }))
        .filter((s) => s.slug),
      errors: strs(r.errors),
      ex,
    };
  }
  return null;
}

function readStored(): Result | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
function store(raw: unknown) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(raw));
  } catch {
    /* optional */
  }
}

function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") && p.length > 2 ? (
          <code
            key={i}
            style={{ fontFamily: MONO, backgroundColor: LAVENDER }}
            className="rounded px-1 py-[1px] text-[0.92em]"
          >
            {p.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

const METHOD_LABEL: Record<string, string> = {
  agent_topics: "Agent topics",
  exact_name: "Exact name",
  domain: "Area match",
  full_text: "Full-text index",
  none: "No match",
};

const KIND_FILL: Record<string, string> = {
  topic: YELLOW,
  assessment: LAVENDER,
  capability: MINT,
  demonstration: SOFT_CORAL,
  file: CREAM,
  repository: "#fff",
};

// Same interaction language as the Overview page:
//   .press  soft squeeze on click
//   .hard   hard-shadow button that lifts on hover and sinks on click
//   .lift   cards rise a little on hover
//   .pw-reveal / .pw-in  scroll-in fade + slide
const CSS = `
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
.press { transition: transform .12s ease, background-color .2s ease, opacity .2s ease; -webkit-tap-highlight-color: transparent; }
.press:active:not(:disabled) { transform: translateY(1px) scale(.98); }
.hard { box-shadow: 2px 2px 0 0 ${INK}; transition: transform .12s ease, box-shadow .12s ease, background-color .2s ease, opacity .2s ease; -webkit-tap-highlight-color: transparent; user-select: none; }
.hard:hover:not(:disabled) { transform: translate(-1px,-1px); box-shadow: 3px 3px 0 0 ${INK}; }
.hard:active:not(:disabled) { transform: translate(2px,2px); box-shadow: 0 0 0 0 ${INK}; }
.hard-lg { box-shadow: 3px 3px 0 0 ${INK}; transition: transform .12s ease, box-shadow .12s ease, background-color .2s ease, opacity .2s ease; -webkit-tap-highlight-color: transparent; user-select: none; }
.hard-lg:hover:not(:disabled) { transform: translate(-2px,-2px); box-shadow: 5px 5px 0 0 ${INK}; }
.hard-lg:active:not(:disabled) { transform: translate(3px,3px); box-shadow: 0 0 0 0 ${INK}; }
.lift { transition: transform .18s ease; }
.lift:hover { transform: translateY(-3px); }
button:disabled { opacity: .5; cursor: not-allowed; }
button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 3px solid ${INK}; outline-offset: 2px; }
svg g:focus-visible { outline: 2px solid ${INK}; outline-offset: 2px; }
.pw-code::-webkit-scrollbar { height: 10px; width: 10px; }
@keyframes pw-rise { from { opacity:0; transform:translateY(14px) } to { opacity:1; transform:none } }
.pw-rise { animation: pw-rise .5s ease-out both; }
@keyframes pw-slide { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:none } }
.pw-slide { animation: pw-slide .25s ease-out both; }
@keyframes pw-pulse { 0%,100% { opacity:1 } 50% { opacity:.45 } }
.pw-pulse { animation: pw-pulse 1.4s ease-in-out infinite; }
@keyframes pw-dash { to { stroke-dashoffset: -24 } }
.pw-flow { stroke-dasharray: 6 6; animation: pw-dash 1.2s linear infinite; }
@keyframes pw-stripe { to { background-position: 28px 0; } }
.pw-reveal { opacity: 0; transform: translateY(18px); transition: opacity .5s ease, transform .5s ease; }
.pw-reveal.pw-in { opacity: 1; transform: none; }
.pw-node { cursor: pointer; transition: opacity .25s ease; }
.pw-node .nm { transition: stroke-width .2s ease; }
.pw-node:hover .nm, .pw-node:focus-visible .nm { stroke-width: 4.5px; }
.pw-snode { transition: opacity .2s ease; }
.pw-snode:hover rect.sn { stroke-width: 4px; }
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  .pw-rise, .pw-slide, .pw-pulse, .pw-flow { animation: none; }
  .pw-reveal { opacity: 1; transform: none; transition: none; }
  .press, .hard, .hard-lg, .lift { transition: none; }
}
`;

// ============================================================
// MOTION HELPERS
// ============================================================

/** Fades and slides a block in the first time it scrolls into view. */
function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.04 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`pw-reveal ${shown ? "pw-in" : ""} ${className}`}
      style={{ transitionDelay: shown ? `${delay}ms` : "0ms" }}
    >
      {children}
    </div>
  );
}

/** Thin reading-progress bar plus a back-to-top button. */
function ScrollChrome() {
  const bar = useRef<HTMLDivElement>(null);
  const [showTop, setShowTop] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const max = Math.max(1, doc.scrollHeight - window.innerHeight);
      const p = Math.min(1, Math.max(0, window.scrollY / max));
      if (bar.current) bar.current.style.transform = `scaleX(${p})`;
      setShowTop(window.scrollY > 700);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-[-2px] h-[3px]"
      >
        <div
          ref={bar}
          style={{
            height: "100%",
            backgroundColor: CORAL,
            transformOrigin: "left",
            transform: "scaleX(0)",
            transition: "transform .1s linear",
          }}
        />
      </div>
      <button
        type="button"
        aria-label="Back to top"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        style={{
          ...border,
          backgroundColor: YELLOW,
          opacity: showTop ? 1 : 0,
          pointerEvents: showTop ? "auto" : "none",
          transform: showTop ? undefined : "translateY(10px)",
        }}
        className="hard fixed bottom-4 right-4 z-30 flex h-10 w-10 items-center justify-center rounded-full"
      >
        <ArrowUp size={16} aria-hidden />
      </button>
    </>
  );
}

// ============================================================
// SMALL PIECES
// ============================================================

function Label({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
      {children}
    </div>
  );
}

function Chip({
  children,
  fill = "#fff",
  color = INK,
  dashed = false,
}: {
  children: ReactNode;
  fill?: string;
  color?: string;
  dashed?: boolean;
}) {
  return (
    <span
      style={{
        backgroundColor: fill,
        color,
        border: `1.5px ${dashed ? "dashed" : "solid"} ${INK}`,
      }}
      className="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold leading-snug"
    >
      {children}
    </span>
  );
}

function LevelChip({ level }: { level: Level }) {
  const m = LEVEL_META[level];
  return (
    <Chip fill={m.fill} color={m.color} dashed={level === "none"}>
      {m.label}
    </Chip>
  );
}

const STATUS_FILL: Record<OpStatus, string> = {
  ok: MINT,
  fallback: YELLOW,
  empty: "#fff",
  failed: CORAL,
};

function Section({
  id,
  eyebrow,
  title,
  blurb,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  blurb?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28">
      <Reveal>
        <Label>{eyebrow}</Label>
        <h2
          style={{ fontFamily: DISPLAY_FONT }}
          className="mt-1 text-[26px] font-bold leading-tight sm:text-[30px]"
        >
          {title}
        </h2>
        {blurb && (
          <p className="mt-1.5 max-w-[70ch] text-[13px] leading-relaxed text-neutral-600">
            {blurb}
          </p>
        )}
      </Reveal>
      <Reveal delay={80} className="mt-5">
        {children}
      </Reveal>
    </section>
  );
}

const opsOf = (ops: Op[], ids: string[]) =>
  ops.filter((o) => ids.some((i) => o.id === i || o.id.startsWith(i)));

// ============================================================
// 1. HERO
// ============================================================

const NAV: Array<[string, string]> = [
  ["why", "Why this goal"],
  ["reach", "How we reached it"],
  ["topics", "Topic graph"],
  ["graph", "FalkorDB"],
  ["algorithms", "Algorithms"],
  ["evidence", "Evidence"],
];

/**
 * The goal is already decided and saved. This only hands its id to the mission
 * page, which creates the mission (or reopens the live one for this goal).
 */
function StartMission({ goal }: { goal: Goal }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const goalId = goal.id;
  const ready = goal.saved && !!goalId;
  const go = () => {
    if (!goalId || busy) return;
    setBusy(true);
    // a short beat so the click feels registered before the page changes
    window.setTimeout(
      () => navigate(`${MISSION_ROUTE}?goalId=${encodeURIComponent(goalId)}`),
      220,
    );
  };
  return (
    <div
      style={{ ...border, backgroundColor: YELLOW }}
      className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3"
    >
      <div className="min-w-0 flex-1">
        <div
          style={{ fontFamily: DISPLAY_FONT }}
          className="text-[16px] font-bold leading-tight"
        >
          Turn this goal into a mission
        </div>
        <p className="mt-0.5 text-[12.5px] leading-snug">
          {ready
            ? "Pathway reads your repository again and writes one coding task with three checks you can verify."
            : "This goal was not saved, so a mission cannot be built from it. Set the goal again from the Overview."}
        </p>
      </div>
      <button
        type="button"
        onClick={go}
        disabled={!ready || busy}
        style={{ ...border, backgroundColor: "#fff" }}
        className="hard-lg inline-flex shrink-0 items-center gap-2 rounded-full px-5 py-2 text-[14px] font-bold"
      >
        {busy ? (
          <RefreshCw size={15} className="animate-spin" aria-hidden />
        ) : (
          <Rocket size={15} aria-hidden />
        )}
        {busy ? "Opening mission…" : "Start mission"}
      </button>
    </div>
  );
}

function Hero({ goal, ex }: { goal: Goal; ex: Explanation }) {
  return (
    <div
      style={{ ...border, backgroundColor: CREAM, boxShadow: shadow(5) }}
      className="pw-rise rounded-3xl p-5 sm:p-8"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          style={{ ...border, backgroundColor: YELLOW }}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold"
        >
          <Target size={13} aria-hidden /> Your goal
        </span>
        <Chip>{goal.focus.name}</Chip>
        {goal.focus.domain && <Chip fill={LAVENDER}>{goal.focus.domain}</Chip>}
        <LevelChip level={goal.focus.level} />
        <Chip fill={goal.saved ? LIGHT_GREEN : "#fff"} dashed={!goal.saved}>
          {goal.saved ? "Saved in FalkorDB" : "Not saved"}
        </Chip>
      </div>

      <h1
        style={{ fontFamily: DISPLAY_FONT }}
        className="mt-4 text-[30px] font-bold leading-[1.1] sm:text-[42px]"
      >
        {goal.title}
      </h1>

      <p className="mt-3 max-w-[70ch] text-[14.5px] leading-relaxed">
        <Inline text={goal.why} />
      </p>

      {goal.limitation && (
        <div
          style={{ ...border, backgroundColor: SOFT_CORAL }}
          className="pw-slide mt-4 rounded-2xl px-4 py-3"
        >
          <Label>Gap found in your code</Label>
          <p className="mt-1 text-[13px] leading-relaxed">
            <Inline text={goal.limitation} />
          </p>
        </div>
      )}

      <div
        style={{ borderTop: `2px solid ${INK}` }}
        className="mt-5 grid grid-cols-2 gap-4 pt-4 sm:grid-cols-4"
      >
        <Stat label="Capability" value={goal.targetCapability?.name ?? "n/a"} />
        <Stat
          label="Evidence cited"
          value={goal.evidenceIds.join(", ") || "none"}
        />
        <Stat
          label="Topic matched by"
          value={METHOD_LABEL[ex.understoodAs.method] ?? ex.understoodAs.method}
        />
        <Stat
          label="Decided by"
          value={
            ex.source === "llm_repaired"
              ? "LLM (repaired)"
              : ex.source === "llm"
                ? "LLM"
                : ex.source
          }
        />
      </div>

      <StartMission goal={goal} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      <div className="mt-0.5 break-words text-[14px] font-bold leading-snug">
        {value}
      </div>
    </div>
  );
}

/** Sticky section bar. Highlights the section you are reading and scrolls smoothly on click. */
function SectionNav({ hasTrace }: { hasTrace: boolean }) {
  const items = useMemo(
    () => NAV.filter(([id]) => id !== "why" || hasTrace),
    [hasTrace],
  );
  const [active, setActive] = useState("");

  useEffect(() => {
    const onScroll = () => {
      let cur = "";
      for (const [id] of items) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 150) cur = id;
      }
      setActive(cur);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [items]);

  return (
    <nav
      aria-label="Sections"
      style={{ borderBottom: `1px solid ${LINE}`, backgroundColor: PAPER }}
      className="sticky top-[52px] z-10 w-full overflow-x-auto"
    >
      <div className="mx-auto flex w-full max-w-[1100px] gap-2 px-4 py-2 sm:px-8">
        {items.map(([id, label]) => {
          const on = active === id;
          return (
            <a
              key={id}
              href={`#${id}`}
              aria-current={on ? "true" : undefined}
              style={{
                ...border,
                backgroundColor: on ? YELLOW : "#fff",
              }}
              className="press shrink-0 rounded-full px-3.5 py-1 text-[12px] font-semibold"
            >
              {label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}

// ============================================================
// 1b. WHY THIS GOAL (decision trace)
// ============================================================

function Block({
  n,
  title,
  hint,
  children,
}: {
  n: number;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Reveal>
      <div
        style={{ ...border, backgroundColor: "#fff", boxShadow: shadow(3) }}
        className="rounded-2xl p-4 sm:p-5"
      >
        <div className="flex items-center gap-2.5">
          <span
            style={{
              ...border,
              fontFamily: DISPLAY_FONT,
              backgroundColor: YELLOW,
            }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold"
          >
            {n}
          </span>
          <h3
            style={{ fontFamily: DISPLAY_FONT }}
            className="text-[19px] font-bold leading-tight"
          >
            {title}
          </h3>
        </div>
        {hint && (
          <p className="mt-1.5 max-w-[75ch] text-[12.5px] leading-relaxed text-neutral-600">
            {hint}
          </p>
        )}
        <div className="mt-4">{children}</div>
      </div>
    </Reveal>
  );
}

const STEP_FILL: Record<string, string> = {
  assessment: LAVENDER,
  capability: MINT,
  evidence: CREAM,
};

const ROLE_LABEL: Record<string, string> = {
  reused: "Existing code the move extends",
  cited: "Evidence cited by the decision",
  alternative: "Evidence behind an alternative",
};

function PathRow({ p, index = 0 }: { p: TPath; index?: number }) {
  return (
    <li
      style={{
        border: `1.5px solid ${LINE}`,
        animationDelay: `${index * 70}ms`,
      }}
      className="pw-slide lift rounded-xl bg-white p-3"
    >
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span
          style={{ ...border, fontFamily: MONO, backgroundColor: LAVENDER }}
          className="rounded-full px-2 text-[11px] font-bold"
        >
          {p.evidenceId}
        </span>
        <Chip fill={p.role === "reused" ? LIGHT_GREEN : "#fff"}>
          {ROLE_LABEL[p.role] ?? p.role}
        </Chip>
        <Chip>
          {p.hops} {pick(p.hops, "hop", "hops")} from your topic
        </Chip>
      </div>
      <div className="flex flex-wrap items-center gap-y-2">
        {p.steps.map((s, i) => {
          const fill =
            s.kind === "topic" ? LEVEL_META[s.level].fill : STEP_FILL[s.kind];
          return (
            <span key={i} className="inline-flex items-center">
              {i > 0 && (
                <span
                  title={s.edgeReason || undefined}
                  className="mx-1.5 inline-flex items-center gap-1"
                >
                  <ArrowRight size={12} aria-hidden />
                  {s.edgeType && (
                    <span
                      style={{ fontFamily: MONO }}
                      className="text-[9.5px] font-bold text-neutral-600"
                    >
                      {s.edgeType}
                    </span>
                  )}
                </span>
              )}
              <span
                title={s.detail || s.label}
                style={{
                  backgroundColor: fill ?? "#fff",
                  color:
                    s.kind === "topic" && s.level === "deep" ? "#fff" : INK,
                  border: `1.5px ${s.level === "none" && s.kind !== "evidence" && s.kind !== "capability" ? "dashed" : "solid"} ${INK}`,
                }}
                className="inline-block max-w-[260px] truncate rounded-lg px-2 py-1 text-[11.5px] font-semibold"
              >
                {trunc(s.label, 44)}
                {s.kind === "topic" && s.detail === "seed topic" ? " ●" : ""}
              </span>
            </span>
          );
        })}
      </div>
    </li>
  );
}

function ThreeCols({ items }: { items: Array<[string, string, string]> }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {items.map(([label, text, fill]) => (
        <div
          key={label}
          style={{ ...border, backgroundColor: fill }}
          className="lift rounded-2xl p-3"
        >
          <Label>{label}</Label>
          <p className="mt-1 text-[13px] leading-relaxed">
            <Inline text={text} />
          </p>
        </div>
      ))}
    </div>
  );
}

function WhyThisGoal({ goal, ex }: { goal: Goal; ex: Explanation }) {
  const t = ex.trace;
  if (!t) return null;

  const reused = t.paths.filter((p) => p.role === "reused");
  const other = t.paths.filter((p) => p.role !== "reused");
  const pg = t.progression;

  return (
    <Section
      id="why"
      eyebrow="Decision trace"
      title="Why this goal?"
      blurb="Every claim below is read from your graph: the path from your topic to the code, what you already built, what the move reuses, and the alternatives that were weighed."
    >
      <div className="space-y-5">
        {/* 1. Graph reasoning */}
        <Block
          n={1}
          title="Graph reasoning"
          hint={`${t.seeds.join(", ") || goal.focus.name} → related topics → your assessments → code evidence. Arrows show the relationship type; hover a node or arrow for detail.`}
        >
          {t.paths.length === 0 ? (
            <p className="text-[13px] text-neutral-600">
              No graph path was recorded for this goal.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {[...reused, ...other].map((p, i) => (
                <PathRow key={`${p.role}-${p.evidenceId}`} p={p} index={i} />
              ))}
            </ul>
          )}

          {t.neighbours.length > 0 && (
            <div className="mt-4">
              <Label>Topics linked to {goal.focus.name}</Label>
              <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {t.neighbours.map((n) => (
                  <li
                    key={n.slug}
                    style={{ border: `1.5px solid ${LINE}` }}
                    className="lift rounded-xl px-3 py-1.5 text-[12px] leading-snug"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <b>{n.name}</b>
                      <span
                        style={{ fontFamily: MONO }}
                        className="text-[10.5px] text-neutral-500"
                      >
                        {n.linkType}
                      </span>
                      <LevelChip level={n.level} />
                      {!n.assessed && <Chip dashed>not assessed</Chip>}
                    </div>
                    {n.reason && (
                      <div className="mt-0.5 text-neutral-600">
                        {trunc(n.reason, 130)}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(
              [
                ["Observed in the data", t.basis.observed, MINT],
                ["Inferred by the agent", t.basis.inferred, LAVENDER],
                [
                  "No evidence yet",
                  t.basis.missing || "Nothing flagged as missing.",
                  "#fff",
                ],
              ] as Array<[string, string, string]>
            ).map(([label, text, fill]) => (
              <div
                key={label}
                style={{
                  ...border,
                  backgroundColor: fill,
                  borderStyle: label === "No evidence yet" ? "dashed" : "solid",
                }}
                className="lift rounded-2xl p-3"
              >
                <Label>{label}</Label>
                <p className="mt-1 text-[12.5px] leading-relaxed">
                  <Inline text={text} />
                </p>
              </div>
            ))}
          </div>
        </Block>

        {/* 2. What you've already built */}
        <Block
          n={2}
          title="What you've already built"
          hint="The existing code this move starts from. Open the source to check it yourself."
        >
          {t.built.length === 0 ? (
            <p className="text-[13px] text-neutral-600">
              No existing code was recorded for this move.
            </p>
          ) : (
            <ul className="space-y-3">
              {t.built.map((b) => (
                <li
                  key={b.id}
                  style={{ border: `1.5px solid ${LINE}` }}
                  className="lift rounded-xl p-3"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      style={{
                        ...border,
                        fontFamily: MONO,
                        backgroundColor: LAVENDER,
                      }}
                      className="rounded-full px-2 text-[11px] font-bold"
                    >
                      {b.id}
                    </span>
                    {b.depth && <Chip>{b.depth}</Chip>}
                    {b.repository && <Chip fill={CREAM}>{b.repository}</Chip>}
                  </div>
                  {b.what && (
                    <p className="mt-1.5 text-[13px] font-semibold leading-snug">
                      {b.what}
                    </p>
                  )}
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span
                      style={{ fontFamily: MONO }}
                      className="min-w-0 truncate text-[11px] text-neutral-500"
                      title={b.path}
                    >
                      {b.path}
                    </span>
                    {b.permalink && (
                      <a
                        href={b.permalink}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${b.id} on GitHub`}
                        className="press shrink-0 rounded-full p-1"
                      >
                        <ExternalLink size={14} aria-hidden />
                      </a>
                    )}
                  </div>
                  {b.commit && (
                    <p className="mt-0.5 text-[11.5px] text-neutral-500">
                      Commit: {trunc(b.commit, 120)}
                    </p>
                  )}
                  {b.excerpt && (
                    <pre
                      style={{
                        fontFamily: MONO,
                        backgroundColor: PAPER,
                        border: `1.5px solid ${LINE}`,
                      }}
                      className="pw-code mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg p-2.5 text-[11px] leading-snug"
                    >
                      {b.excerpt}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Block>

        {/* 3. What the next move builds */}
        <Block
          n={3}
          title="What the next move builds"
          hint="Reuse before adding: the move extends what exists instead of starting a second mechanism."
        >
          <ThreeCols
            items={[
              ["Reused", t.builds.reused, LIGHT_GREEN],
              ["Changes", t.builds.changes, YELLOW],
              ["New behaviour", t.builds.newBehavior, SOFT_CORAL],
            ]}
          />
          {t.verifyFirst && (
            <div
              style={{
                ...border,
                borderStyle: "dashed",
                backgroundColor: CREAM,
              }}
              className="mt-3 rounded-2xl px-4 py-2.5"
            >
              <Label>Check first</Label>
              <p className="mt-0.5 text-[12.5px] leading-relaxed">
                <Inline text={t.verifyFirst} />
              </p>
            </div>
          )}
        </Block>

        {/* 4. Why this goal over alternatives */}
        <Block
          n={4}
          title="Why this goal over alternatives"
          hint="What each option would give and cost, and the evidence behind it. This states what the evidence supports, not that the choice is the only good one."
        >
          <div
            style={{ ...border, backgroundColor: LIGHT_GREEN }}
            className="lift rounded-2xl p-3.5"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip fill={GREEN} color="#fff">
                Chosen
              </Chip>
              {t.chosen.evidenceIds.map((id) => (
                <span
                  key={id}
                  style={{ fontFamily: MONO }}
                  className="text-[11px] font-bold"
                >
                  {id}
                </span>
              ))}
            </div>
            <p className="mt-1.5 text-[14px] font-bold leading-snug">
              {t.chosen.title}
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed">
              <Inline text={t.chosen.why} />
            </p>
          </div>

          <ul className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {t.alternatives.map((a, i) => (
              <li
                key={i}
                style={{ ...border, backgroundColor: "#fff" }}
                className="lift rounded-2xl p-3.5"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip>Alternative</Chip>
                  {a.evidence.length === 0 ? (
                    <Chip dashed>no evidence linked</Chip>
                  ) : (
                    a.evidence.map((e) => (
                      <span
                        key={e.id}
                        title={e.path}
                        style={{
                          ...border,
                          fontFamily: MONO,
                          backgroundColor: LAVENDER,
                        }}
                        className="rounded-full px-2 text-[11px] font-bold"
                      >
                        {e.id}
                      </span>
                    ))
                  )}
                </div>
                <p className="mt-1.5 text-[13px] font-bold leading-snug">
                  {a.option}
                </p>
                {a.tradeoff && (
                  <p className="mt-1 text-[12px] leading-snug text-neutral-700">
                    <b>Trade-off:</b> {a.tradeoff}
                  </p>
                )}
                <p className="mt-1 text-[12px] leading-snug text-neutral-600">
                  <b>Not taken:</b> {a.whyNot}
                </p>
              </li>
            ))}
            {t.alternatives.length === 0 && (
              <li className="text-[13px] text-neutral-600">
                No alternatives were recorded.
              </li>
            )}
          </ul>
        </Block>

        {/* 5. Expected progression */}
        <Block
          n={5}
          title="Expected progression"
          hint="What exists today, what the task changes, and what will be verified."
        >
          <div className="grid grid-cols-1 items-stretch gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
            <div
              style={{ ...border, backgroundColor: LIGHT_GREEN }}
              className="lift rounded-2xl p-3"
            >
              <Label>Already exists</Label>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-[12.5px] leading-snug">
                {pg.existing.map((x, i) => (
                  <li key={i}>
                    <Inline text={x} />
                  </li>
                ))}
              </ul>
            </div>
            <ArrowRight
              size={18}
              aria-hidden
              className="hidden self-center lg:block"
            />
            <div
              style={{ ...border, backgroundColor: YELLOW }}
              className="lift rounded-2xl p-3"
            >
              <Label>Proposed change</Label>
              <p className="mt-1 text-[12.5px] leading-snug">
                <Inline text={pg.change} />
              </p>
            </div>
            <ArrowRight
              size={18}
              aria-hidden
              className="hidden self-center lg:block"
            />
            <div
              style={{ ...border, backgroundColor: LAVENDER }}
              className="lift rounded-2xl p-3"
            >
              <Label>Verified outcome</Label>
              <p className="mt-1 text-[12.5px] leading-snug">
                <Inline text={pg.verified} />
              </p>
            </div>
          </div>
        </Block>
      </div>
    </Section>
  );
}

// ============================================================
// 2. REACH  (pipeline as cards, numbers first)
// ============================================================

function Reach({ goal, ex }: { goal: Goal; ex: Explanation }) {
  const g = ex.graph;
  const ops = g?.operations ?? [];
  const sum = (ids: string[]) =>
    opsOf(ops, ids).reduce((n, o) => n + o.durationMs, 0);
  const dots = (ids: string[]) => opsOf(ops, ids);

  const seeds = g?.seeds.length ?? 0;
  const topics = g?.topics ?? 0;
  const demos = g?.evidence ?? 0;
  const scored = g?.context.nodes.length ?? 0;
  const excerpts = g?.codeExcerpts ?? 0;
  const cited = goal.evidenceIds.length;

  const stages: Array<{
    title: string;
    metric: number;
    unit: string;
    algo: string;
    ms: number;
    fill: string;
    ops: Op[];
  }> = [
    {
      title: "Match",
      metric: seeds,
      unit: pick(seeds, "seed topic", "seed topics"),
      algo: "Exact → full-text",
      ms: sum(["seed."]),
      fill: YELLOW,
      ops: dots(["seed."]),
    },
    {
      title: "Expand",
      metric: topics,
      unit: pick(topics, "topic", "topics"),
      algo: "BFS · 2 hops",
      ms: sum(["expand."]),
      fill: CREAM,
      ops: dots(["expand."]),
    },
    {
      title: "Read",
      metric: demos,
      unit: pick(demos, "demonstration", "demonstrations"),
      algo: "Cypher traversal",
      ms: sum(["depth", "evidence"]),
      fill: MINT,
      ops: dots(["depth", "evidence"]),
    },
    {
      title: "Rank",
      metric: scored,
      unit: pick(scored, "node scored", "nodes scored"),
      algo: "Personalized PageRank",
      ms: sum(["ppr"]),
      fill: LAVENDER,
      ops: dots(["ppr"]),
    },
    {
      title: "Code",
      metric: excerpts,
      unit: pick(excerpts, "excerpt", "excerpts"),
      algo: "FileChange read",
      ms: sum(["code"]),
      fill: SOFT_CORAL,
      ops: dots(["code"]),
    },
    {
      title: "Decide",
      metric: ex.llmCalls,
      unit: pick(ex.llmCalls, "LLM call", "LLM calls"),
      algo: "LLM + guardrails",
      ms: ex.timingsMs.llm,
      fill: LAVENDER,
      ops: [],
    },
    {
      title: "Goal",
      metric: cited,
      unit: "cited",
      algo: "Graph write",
      ms: ex.timingsMs.store,
      fill: CORAL,
      ops: [],
    },
  ];

  const t = ex.timingsMs;
  const parts = [
    { label: "Graph", ms: t.graph, fill: MINT },
    { label: "LLM", ms: t.llm, fill: LAVENDER },
    { label: "Store", ms: t.store, fill: YELLOW },
  ];
  const total = Math.max(
    1,
    parts.reduce((n, p) => n + p.ms, 0),
  );

  return (
    <Section
      id="reach"
      eyebrow="How we reached it"
      title="Seven steps, one graph"
      blurb="Each step narrows the graph until one goal is left. The dots under a step show whether its queries returned data."
    >
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {stages.map((s, i) => (
          <li
            key={s.title}
            className="pw-rise relative"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <div
              style={{
                ...border,
                backgroundColor: s.fill,
                boxShadow: shadow(3),
              }}
              className="lift h-full rounded-2xl p-3"
            >
              <div className="flex items-center justify-between">
                <span
                  style={{ ...border, fontFamily: DISPLAY_FONT }}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-[11px] font-bold"
                >
                  {i + 1}
                </span>
                <span
                  style={{ fontFamily: MONO }}
                  className="text-[10.5px] text-neutral-700"
                >
                  {s.ms} ms
                </span>
              </div>
              <div
                style={{ fontFamily: DISPLAY_FONT }}
                className="mt-2 text-[15px] font-bold leading-tight"
              >
                {s.title}
              </div>
              <div
                style={{ fontFamily: DISPLAY_FONT }}
                className="mt-1 text-[34px] font-bold leading-none"
              >
                {s.metric}
              </div>
              <div className="text-[11px] font-semibold">{s.unit}</div>
              <div
                style={{ borderTop: `1.5px dashed ${INK}` }}
                className="mt-2 pt-1.5 text-[10.5px] font-bold leading-tight"
              >
                {s.algo}
              </div>
              {s.ops.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {s.ops.map((o) => (
                    <span
                      key={o.id}
                      title={`${o.id}: ${o.result}`}
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 999,
                        border: `2px ${o.status === "empty" ? "dashed" : "solid"} ${INK}`,
                        backgroundColor: STATUS_FILL[o.status],
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
            {i < stages.length - 1 && (
              <ArrowRight
                size={14}
                aria-hidden
                className="absolute -right-[13px] top-1/2 z-10 hidden -translate-y-1/2 lg:block"
              />
            )}
          </li>
        ))}
      </ol>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-neutral-600">
        {(
          [
            ["ok", "returned data"],
            ["fallback", "used fallback"],
            ["empty", "returned nothing"],
            ["failed", "failed"],
          ] as Array<[OpStatus, string]>
        ).map(([k, label]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span
              style={{
                width: 11,
                height: 11,
                borderRadius: 999,
                border: `2px ${k === "empty" ? "dashed" : "solid"} ${INK}`,
                backgroundColor: STATUS_FILL[k],
              }}
            />
            {label}
          </span>
        ))}
      </div>

      <div
        style={{ ...border, backgroundColor: "#fff" }}
        className="mt-4 rounded-2xl p-4"
      >
        <div className="flex items-center justify-between">
          <Label>Time</Label>
          <span style={{ fontFamily: MONO }} className="text-[12px] font-bold">
            {t.total} ms
          </span>
        </div>
        <div
          style={{ border: `2px solid ${INK}` }}
          className="mt-2 flex h-5 overflow-hidden rounded-full"
        >
          {parts.map((p) => (
            <div
              key={p.label}
              title={`${p.label} ${p.ms} ms`}
              style={{
                width: `${(p.ms / total) * 100}%`,
                backgroundColor: p.fill,
                borderRight: p.ms ? `2px solid ${INK}` : undefined,
                transition: "width .6s ease",
              }}
            />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
          {parts.map((p) => (
            <span key={p.label} className="inline-flex items-center gap-1.5">
              <span
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: 3,
                  backgroundColor: p.fill,
                  border: `2px solid ${INK}`,
                }}
              />
              {p.label} <b>{p.ms} ms</b>
            </span>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ============================================================
// 4. FALKORDB: schema walked + subgraph + PageRank
// ============================================================

type SNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  fill: string;
  kind?: string;
  write?: boolean;
};
type SEdge = {
  pts: Array<[number, number]>;
  label: string[];
  lx: number;
  ly: number;
  dashed?: boolean;
};

const SW = 132;
const SH = 44;
const SVW = 980;
const SVH = 466;

const SCHEMA_NODES: SNode[] = [
  { id: "dev", label: "Developer", x: 90, y: 90, fill: "#fff" },
  {
    id: "dep",
    label: "DepthAssessment",
    x: 310,
    y: 90,
    fill: LAVENDER,
    kind: "assessment",
  },
  { id: "top", label: "Topic", x: 530, y: 90, fill: YELLOW, kind: "topic" },
  {
    id: "cap",
    label: "Capability",
    x: 750,
    y: 90,
    fill: MINT,
    kind: "capability",
  },
  {
    id: "dem",
    label: "Demonstration",
    x: 750,
    y: 230,
    fill: SOFT_CORAL,
    kind: "demonstration",
  },
  {
    id: "fil",
    label: "FileChange",
    x: 660,
    y: 370,
    fill: CREAM,
    kind: "file",
  },
  {
    id: "rep",
    label: "Repository",
    x: 860,
    y: 370,
    fill: "#fff",
    kind: "repository",
  },
  { id: "goal", label: "Goal", x: 90, y: 370, fill: CORAL, write: true },
  { id: "mov", label: "NextMove", x: 310, y: 370, fill: CORAL, write: true },
];

const SCHEMA_EDGES: SEdge[] = [
  {
    pts: [
      [156, 90],
      [244, 90],
    ],
    label: ["ASSESSED"],
    lx: 200,
    ly: 72,
  },
  {
    pts: [
      [376, 90],
      [464, 90],
    ],
    label: ["OF_TOPIC"],
    lx: 420,
    ly: 72,
  },
  {
    pts: [
      [596, 90],
      [684, 90],
    ],
    label: ["MAPS_TO"],
    lx: 640,
    ly: 72,
  },
  {
    pts: [
      [750, 208],
      [750, 112],
    ],
    label: ["OF_CAPABILITY"],
    lx: 750,
    ly: 160,
  },
  {
    pts: [
      [90, 112],
      [90, 218],
      [684, 218],
    ],
    label: ["DEMONSTRATED"],
    lx: 230,
    ly: 218,
    dashed: true,
  },
  {
    pts: [
      [720, 252],
      [660, 348],
    ],
    label: ["EVIDENCED_BY"],
    lx: 690,
    ly: 300,
  },
  {
    pts: [
      [780, 252],
      [860, 348],
    ],
    label: ["IN_REPOSITORY"],
    lx: 820,
    ly: 300,
  },
  {
    pts: [
      [156, 370],
      [244, 370],
    ],
    label: ["PROPOSES"],
    lx: 200,
    ly: 352,
  },
  {
    pts: [
      [330, 348],
      [500, 112],
    ],
    label: ["FOCUSES_ON", "LEVERAGES"],
    lx: 381,
    ly: 277,
  },
  {
    pts: [
      [376, 362],
      [684, 242],
    ],
    label: ["BACKED_BY", "ADVANCES"],
    lx: 545,
    ly: 296,
    dashed: true,
  },
];

function Pill({
  x,
  y,
  lines,
  fill = PAPER,
}: {
  x: number;
  y: number;
  lines: string[];
  fill?: string;
}) {
  const w = Math.max(...lines.map((l) => l.length)) * 6.1 + 14;
  const h = lines.length * 12 + 6;
  return (
    <g pointerEvents="none">
      <rect
        x={x - w / 2}
        y={y - h / 2}
        width={w}
        height={h}
        rx="6"
        fill={fill}
        stroke={INK}
        strokeWidth="1.4"
      />
      {lines.map((l, i) => (
        <text
          key={l}
          x={x}
          y={y - h / 2 + 12 + i * 12}
          textAnchor="middle"
          style={{
            fontFamily: MONO,
            fontSize: 9.5,
            fontWeight: 700,
            fill: INK,
          }}
        >
          {l}
        </text>
      ))}
    </g>
  );
}

function SchemaDiagram({ ex, saved }: { ex: Explanation; saved: boolean }) {
  const nodes = ex.graph?.context.nodes ?? [];
  const count = (kind?: string) =>
    kind ? nodes.filter((n) => n.kind === kind).length : 0;

  return (
    <div
      style={{ ...border, backgroundColor: PAPER, boxShadow: shadow(4) }}
      className="overflow-x-auto rounded-2xl"
    >
      <svg
        viewBox={`0 0 ${SVW} ${SVH}`}
        className="block h-auto w-full min-w-[760px]"
        role="img"
        aria-label="FalkorDB schema traversed"
      >
        <defs>
          <marker
            id="pw-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0 0 L10 5 L0 10 z" fill={INK} />
          </marker>
        </defs>

        {/* edges */}
        {SCHEMA_EDGES.map((e, i) => (
          <polyline
            key={i}
            points={e.pts.map((p) => p.join(",")).join(" ")}
            fill="none"
            stroke={INK}
            strokeWidth="2"
            strokeDasharray={e.dashed ? "6 5" : undefined}
            strokeLinejoin="round"
            markerEnd="url(#pw-arrow)"
          />
        ))}

        {/* Topic self-loop */}
        <path
          d="M 500 68 C 484 24, 576 24, 560 68"
          fill="none"
          stroke={INK}
          strokeWidth="2"
          markerEnd="url(#pw-arrow)"
        />

        {/* nodes */}
        {SCHEMA_NODES.map((n) => {
          const c = count(n.kind);
          const used = n.write ? saved : true;
          return (
            <g key={n.id} className="pw-snode" opacity={used ? 1 : 0.45}>
              <title>
                {n.label}
                {n.write ? " (written by this run)" : " (read by this run)"}
                {c > 0 ? `, ${c} pulled in` : ""}
              </title>
              <rect
                className="sn"
                x={n.x - SW / 2}
                y={n.y - SH / 2}
                width={SW}
                height={SH}
                rx="12"
                fill={n.fill}
                stroke={INK}
                strokeWidth="2.5"
                strokeDasharray={n.write ? "6 4" : undefined}
              />
              <text
                x={n.x}
                y={n.y + 5}
                textAnchor="middle"
                style={{
                  fontFamily: BODY_FONT,
                  fontSize: 13,
                  fontWeight: 700,
                  fill: INK,
                }}
              >
                {n.label}
              </text>
              {c > 0 && (
                <g>
                  <circle
                    cx={n.x + SW / 2 - 4}
                    cy={n.y - SH / 2 + 2}
                    r="12"
                    fill={INK}
                  />
                  <text
                    x={n.x + SW / 2 - 4}
                    y={n.y - SH / 2 + 6}
                    textAnchor="middle"
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      fontWeight: 700,
                      fill: "#fff",
                    }}
                  >
                    {c}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* edge labels on top of everything */}
        {SCHEMA_EDGES.map((e, i) => (
          <Pill key={i} x={e.lx} y={e.ly} lines={e.label} />
        ))}
        <Pill x={530} y={12} lines={["RELATED_TOPIC · BFS"]} />

        {/* legend */}
        <g transform="translate(90 436)">
          <rect
            x="0"
            y="-12"
            width="14"
            height="14"
            rx="3"
            fill="#fff"
            stroke={INK}
            strokeWidth="2"
          />
          <text
            x="20"
            y="0"
            style={{ fontFamily: BODY_FONT, fontSize: 11, fill: INK }}
          >
            read
          </text>
          <rect
            x="66"
            y="-12"
            width="14"
            height="14"
            rx="3"
            fill={CORAL}
            stroke={INK}
            strokeWidth="2"
            strokeDasharray="4 3"
          />
          <text
            x="86"
            y="0"
            style={{ fontFamily: BODY_FONT, fontSize: 11, fill: INK }}
          >
            written
          </text>
          <circle cx="170" cy="-5" r="8" fill={INK} />
          <text
            x="184"
            y="0"
            style={{ fontFamily: BODY_FONT, fontSize: 11, fill: INK }}
          >
            nodes pulled into this run
          </text>
        </g>
      </svg>
    </div>
  );
}

function RankBars({ ranking }: { ranking: CNode[] }) {
  const top = ranking.slice(0, 10);
  const max = Math.max(1e-9, ...top.map((n) => n.score));
  return (
    <div
      style={{ ...border, backgroundColor: "#fff" }}
      className="rounded-2xl p-4"
    >
      <Label>Personalized PageRank · top nodes</Label>
      <ul className="mt-3 space-y-1.5">
        {top.map((n, i) => (
          <li key={n.key} className="flex items-center gap-2">
            <span
              style={{ fontFamily: MONO }}
              className="w-4 text-right text-[10.5px] text-neutral-500"
            >
              {i + 1}
            </span>
            <span
              className="w-[38%] truncate text-[12px] font-semibold sm:w-[34%]"
              title={n.label}
            >
              {n.label}
            </span>
            <div
              style={{ border: `1.5px solid ${INK}`, backgroundColor: LINE }}
              className="h-3.5 flex-1 overflow-hidden rounded-full"
            >
              <div
                style={{
                  width: `${Math.max(3, (n.score / max) * 100)}%`,
                  height: "100%",
                  backgroundColor: KIND_FILL[n.kind] ?? "#fff",
                  borderRight: `1.5px solid ${INK}`,
                  transition: "width .6s ease",
                }}
              />
            </div>
            <span
              style={{ fontFamily: MONO }}
              className="w-14 text-right text-[10.5px] text-neutral-600"
            >
              {n.score.toFixed(3)}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {Object.entries(KIND_FILL).map(([k, f]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                backgroundColor: f,
                border: `2px solid ${INK}`,
              }}
            />
            {k}
          </span>
        ))}
      </div>
    </div>
  );
}

function EdgeTypes({ edges, nodes }: { edges: CEdge[]; nodes: CNode[] }) {
  const counts = new Map<string, number>();
  for (const e of edges) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  const list = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <div
      style={{ ...border, backgroundColor: CREAM }}
      className="rounded-2xl p-4"
    >
      <div className="flex items-end gap-6">
        <div>
          <Label>Nodes</Label>
          <div
            style={{ fontFamily: DISPLAY_FONT }}
            className="text-[34px] font-bold leading-none"
          >
            {nodes.length}
          </div>
        </div>
        <div>
          <Label>Edges</Label>
          <div
            style={{ fontFamily: DISPLAY_FONT }}
            className="text-[34px] font-bold leading-none"
          >
            {edges.length}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {list.map(([t, n]) => (
          <Chip key={t} fill="#fff">
            <span style={{ fontFamily: MONO }}>{t}</span> · {n}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function FalkorSection({ goal, ex }: { goal: Goal; ex: Explanation }) {
  const g = ex.graph;
  return (
    <Section
      id="graph"
      eyebrow="FalkorDB"
      title="What we walked in the graph"
      blurb="The schema this run read from (solid boxes) and wrote to (dashed coral). Badges show how many nodes of each type were pulled in."
    >
      <SchemaDiagram ex={ex} saved={goal.saved} />
      {g && g.context.nodes.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <EdgeTypes edges={g.context.edges} nodes={g.context.nodes} />
          <RankBars ranking={g.ranking} />
        </div>
      )}
    </Section>
  );
}

// ============================================================
// 5. ALGORITHMS
// ============================================================

function Algos({ ex }: { ex: Explanation }) {
  const ops = ex.graph?.operations ?? [];
  const ran = (id: string) => ops.some((o) => o.id.startsWith(id));
  const algos: Array<{
    name: string;
    line: string;
    fill: string;
    used: boolean;
  }> = [
    {
      name: "Exact match",
      line: "Topic.name / slug",
      fill: YELLOW,
      used: ran("seed.exact"),
    },
    {
      name: "Full-text index",
      line: "db.idx.fulltext.queryNodes",
      fill: YELLOW,
      used: ran("seed.fulltext"),
    },
    {
      name: "BFS · 2 hops",
      line: "RELATED_TOPIC, 1 query per hop",
      fill: CREAM,
      used: ran("expand.related"),
    },
    {
      name: "Community peers",
      line: "Topic.cluster_id · weight 0.25",
      fill: CREAM,
      used: ran("expand.cluster"),
    },
    {
      name: "Evidence trace",
      line: "Topic → Capability ← Demonstration",
      fill: MINT,
      used: ran("evidence"),
    },
    {
      name: "Personalized PageRank",
      line: "damping 0.85 · restart on seeds",
      fill: LAVENDER,
      used: ran("ppr"),
    },
    {
      name: "LLM + guardrails",
      line: "picks the move, code verifies it",
      fill: LAVENDER,
      used: ex.llmCalls > 0,
    },
  ];
  return (
    <Section
      id="algorithms"
      eyebrow="Algorithms"
      title="What did the work"
      blurb="Greyed-out steps were skipped for this goal."
    >
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {algos.map((a, i) => (
          <li
            key={a.name}
            className={`pw-rise ${a.used ? "lift" : ""} rounded-2xl p-3`}
            style={{
              ...border,
              backgroundColor: a.used ? a.fill : PAPER,
              boxShadow: a.used ? shadow(2) : undefined,
              opacity: a.used ? 1 : 0.55,
              animationDelay: `${i * 60}ms`,
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-bold leading-tight">
                {a.name}
              </span>
              <span
                title={a.used ? "ran" : "skipped"}
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  flexShrink: 0,
                  border: `2px ${a.used ? "solid" : "dashed"} ${INK}`,
                  backgroundColor: a.used ? GREEN : "#fff",
                }}
              />
            </div>
            <p
              style={{ fontFamily: MONO }}
              className="mt-1.5 text-[10.5px] leading-snug text-neutral-700"
            >
              {a.line}
            </p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ============================================================
// 6. EVIDENCE + REJECTED
// ============================================================

function EvidenceAndRejected({ goal, ex }: { goal: Goal; ex: Explanation }) {
  // when the decision trace is present, alternatives are shown there with
  // their evidence and trade-offs, so this section only lists evidence
  const showRejected = !ex.trace;
  return (
    <div
      className={
        showRejected
          ? "grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-8"
          : "grid grid-cols-1 gap-10"
      }
    >
      <Section
        id="evidence"
        eyebrow="Evidence"
        title="Cited code"
        blurb="Code from your repositories the goal is based on."
      >
        <ul
          className={
            showRejected
              ? "space-y-2.5"
              : "grid grid-cols-1 gap-2.5 lg:grid-cols-2"
          }
        >
          {ex.evidence.map((e) => (
            <li
              key={e.id}
              style={{
                ...border,
                backgroundColor: "#fff",
                boxShadow: shadow(2),
              }}
              className="lift rounded-2xl p-3"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  style={{
                    ...border,
                    fontFamily: MONO,
                    backgroundColor: LAVENDER,
                  }}
                  className="rounded-full px-2 text-[11px] font-bold"
                >
                  {e.id}
                </span>
                <Chip>{e.depth}</Chip>
                {goal.evidenceIds.includes(e.id) && (
                  <Chip fill={LIGHT_GREEN}>cited</Chip>
                )}
              </div>
              <p className="mt-1.5 text-[13px] font-semibold leading-snug">
                {e.technique}
              </p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span
                  style={{ fontFamily: MONO }}
                  className="min-w-0 truncate text-[11px] text-neutral-500"
                  title={e.path}
                >
                  {e.path}
                </span>
                {e.permalink && (
                  <a
                    href={e.permalink}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${e.id} on GitHub`}
                    className="press shrink-0 rounded-full p-1"
                  >
                    <ExternalLink size={14} aria-hidden />
                  </a>
                )}
              </div>
            </li>
          ))}
          {ex.evidence.length === 0 && (
            <li className="text-[13px] text-neutral-600">None recorded.</li>
          )}
        </ul>
      </Section>

      {showRejected && (
        <Section
          eyebrow="Weighed"
          title="Not chosen"
          blurb="Other moves the agent considered, and why it passed."
        >
          <ul className="space-y-2.5">
            {ex.alternatives.map((a, i) => (
              <li
                key={i}
                style={{ ...border, backgroundColor: "#fff" }}
                className="lift rounded-2xl p-3"
              >
                <p className="text-[13px] font-bold leading-snug">{a.option}</p>
                <p className="mt-1 text-[12px] leading-snug text-neutral-600">
                  {a.whyNot}
                </p>
              </li>
            ))}
            {ex.alternatives.length === 0 && (
              <li className="text-[13px] text-neutral-600">None recorded.</li>
            )}
          </ul>
        </Section>
      )}
    </div>
  );
}

// ============================================================
// SHELL
// ============================================================

function BackLink({ label = "Back to overview" }: { label?: string }) {
  return (
    <Link
      to="/overview"
      style={{ ...border, backgroundColor: "#fff" }}
      className="hard inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold"
    >
      <ArrowLeft size={14} aria-hidden /> {label}
    </Link>
  );
}

function Message({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[760px] px-4 py-16 sm:px-8">
      <div
        style={{ ...border, backgroundColor: CREAM, boxShadow: shadow(5) }}
        className="pw-rise rounded-3xl p-6 sm:p-8"
      >
        <h1
          style={{ fontFamily: DISPLAY_FONT }}
          className="text-[30px] font-bold leading-tight sm:text-[38px]"
        >
          {title}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-neutral-800">
          {body}
        </p>
        {children}
        <div className="mt-6">
          <BackLink label="Set a goal from the overview" />
        </div>
      </div>
    </div>
  );
}

const BLOCKED_TITLE: Record<string, string> = {
  needs_clarification: "Pathway needs a clearer topic",
  needs_evidence: "Not enough code to build a goal from",
  generation_failed: "The agent could not produce a verified goal",
  llm_unavailable: "The goal agent is unavailable",
};

export default function GoalPage() {
  const location = useLocation();
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const st = rec(location.state);
    const fromState = st.result ?? st.goal;
    if (fromState) {
      const r = normalize(fromState);
      if (r) {
        store(fromState);
        setResult(r);
        setLoading(false);
        return;
      }
    }
    setResult(readStored());
    setLoading(false);
  }, [location.state]);

  const shell = (body: ReactNode, subnav?: ReactNode) => (
    <div
      style={{ fontFamily: BODY_FONT, color: INK, backgroundColor: PAPER }}
      className="min-h-screen w-full"
    >
      <style>{CSS}</style>
      <header
        style={{
          borderBottom: `2px solid ${INK}`,
          backgroundColor: "rgba(241,238,231,.96)",
          backdropFilter: "blur(8px)",
        }}
        className="sticky top-0 z-20 flex h-[52px] w-full items-center justify-between px-4 sm:px-6"
      >
        <Link
          to="/"
          style={{ fontFamily: DISPLAY_FONT }}
          className="press text-[18px] font-bold"
        >
          pathway.io
        </Link>
        <BackLink />
        <ScrollChrome />
      </header>
      {subnav}
      {body}
    </div>
  );

  if (loading) {
    return shell(
      <p className="pw-pulse px-6 py-16 text-center text-[14px] text-neutral-500">
        Reading your goal…
      </p>,
    );
  }

  if (!result) {
    return shell(
      <Message
        title="No goal yet"
        body="Goals are set from the Overview page. Once one is decided it shows up here."
      />,
    );
  }

  if (result.kind === "blocked") {
    return shell(
      <Message
        title={BLOCKED_TITLE[result.status] ?? "No goal generated"}
        body={result.message}
      >
        {result.suggestions.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {result.suggestions.map((s) => (
              <li key={s.slug}>
                <Chip fill={LAVENDER}>{s.name}</Chip>
              </li>
            ))}
          </ul>
        )}
        {result.errors.length > 0 && (
          <ul
            style={{ ...border, backgroundColor: SOFT_CORAL }}
            className="mt-4 list-disc space-y-1 rounded-2xl py-3 pl-8 pr-4 text-[12.5px] leading-snug"
          >
            {result.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
      </Message>,
    );
  }

  const { goal, ex } = result;
  return shell(
    <main className="mx-auto w-full max-w-[1100px] space-y-14 px-4 py-8 sm:px-8 lg:py-10">
      <Hero goal={goal} ex={ex} />
      <WhyThisGoal goal={goal} ex={ex} />
      <Reach goal={goal} ex={ex} />
      <FalkorSection goal={goal} ex={ex} />
      <Algos ex={ex} />
      <EvidenceAndRejected goal={goal} ex={ex} />
      <footer
        style={{ borderTop: `2px solid ${INK}` }}
        className="flex flex-wrap items-center justify-between gap-3 pt-5"
      >
        <p className="text-[12px] text-neutral-500">
          Goals are set from the Overview. Use Start mission above to build it.
        </p>
        <BackLink />
      </footer>
    </main>,
    <SectionNav hasTrace={!!ex.trace} />,
  );
}
