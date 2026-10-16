/* eslint-disable react-hooks/preserve-manual-memoization */
/* eslint-disable react-hooks/immutability */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/set-state-in-effect */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  CheckCircle2,
  ChevronRight,
  Flame,
  Layers,
  MessageCircle,
  Play,
  RefreshCw,
  Route as RouteIcon,
  Send,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import {
  AiMessage,
  Blocks,
  ToolTrace,
  type LiveStep,
  type TraceEvent,
} from "../compoenents/ChatBlock";

/* -------------------------------------------------------------------------- */
/* DESIGN TOKENS                                                              */
/* -------------------------------------------------------------------------- */

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

const GUTTER = "px-4 sm:px-6 lg:px-8";
const border = { border: `2px solid ${INK}` };
const shadow = (n = 3) => `${n}px ${n}px 0 0 ${INK}`;
const clamp = (n: number): CSSProperties => ({
  display: "-webkit-box",
  WebkitLineClamp: n,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
});

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
const LEVEL_RANK: Record<string, number> = {
  none: 0,
  surface: 1,
  working: 2,
  proficient: 3,
  deep: 4,
};
const LEVEL_ORDER = ["deep", "proficient", "working", "surface", "none"];
const PALETTE = [
  SKY,
  CORAL,
  GREEN,
  PURPLE,
  YELLOW,
  LAVENDER,
  "#E58AB4",
  "#6FC3B2",
];
const PAGE = 8;

/* -------------------------------------------------------------------------- */
/* HELPERS                                                                    */
/* -------------------------------------------------------------------------- */

type Obj = Record<string, any>;

const asString = (v: unknown, fallback = "") =>
  v == null ? fallback : String(v);
const asArray = <T = unknown,>(v: unknown): T[] =>
  Array.isArray(v) ? (v as T[]) : [];
const num = (v: unknown, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const cut = (s: string, n: number) =>
  s.length <= n ? s : `${s.slice(0, n - 1)}…`;
const humanize = (s: string) =>
  s ? s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Other";
const fix = (v: unknown, d = 3) =>
  v == null || !Number.isFinite(Number(v)) ? "–" : Number(v).toFixed(d);

function timeAgo(value?: string) {
  if (!value) return "";
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return value;
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} mo ago`;
  return `${Math.floor(days / 365)} yr ago`;
}

async function call(url: string, method = "GET", body?: unknown) {
  const r = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await r.json().catch(() => ({}))) as Obj;
  return { ok: r.ok, status: r.status, data };
}

async function getJson<T = Obj>(url: string): Promise<T> {
  const r = await call(url);
  if (!r.ok)
    throw new Error(
      asString(r.data.error ?? r.data.message, `Request failed: ${r.status}`),
    );
  return r.data as T;
}

/** Streams /api/topics/chat/stream (live tool status + streamed answer). Falls back to the plain endpoint. */
async function chatRequest(
  body: unknown,
  onEvent: (e: TraceEvent) => void,
): Promise<{ ok: boolean; status: number; data: Obj }> {
  try {
    const r = await fetch("/api/topics/chat/stream", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.status === 429) {
      return { ok: false, status: 429, data: await r.json().catch(() => ({})) };
    }
    if (r.ok && r.body) {
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let final: Obj | null = null;
      let err: string | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === "done") final = ev.response;
            else if (ev.type === "error") err = ev.error;
            else onEvent(ev as TraceEvent);
          } catch {
            /* ignore partial line */
          }
        }
      }
      if (final) return { ok: true, status: 200, data: final };
      if (err) return { ok: false, status: 500, data: { error: err } };
    }
  } catch {
    /* fall back below */
  }
  return call("/api/topics/chat", "POST", body);
}

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

function stepOf(job: Obj | null): number {
  if (!job) return -1;
  if (job.status === "completed") return 8;
  switch (asString(job.stage)) {
    case "depth_start":
    case "depth_files_scanned":
    case "depth_atlas_ready":
      return 0;
    case "depth_discovering":
    case "depth_topics_proposed":
      return 1;
    case "depth_evidence_gathered":
      return 2;
    case "depth_refining":
    case "depth_topic_assessed":
      return 3;
    default:
      return num(job.percent) >= 95 ? 5 : 3;
  }
}

/**
 * What is NOT established for a topic. Prefers the server's `limitations`
 * (built from the stored assessment); otherwise derives them from fields the
 * detail response already carries. Never invents evidence.
 */
function limitationsOf(detail: Obj | null): string[] {
  if (!detail) return [];
  const fromServer = asArray<string>(detail.limitations).filter(Boolean);
  if (fromServer.length) return fromServer;
  const out: string[] = [];
  out.push(...asArray<string>(detail.gaps));
  const t = (detail.topic ?? {}) as Obj;
  if (t.confidence === "low")
    out.push("Confidence is low: there is little evidence behind this level.");
  if (t.authenticity && t.authenticity !== "genuine_implementation")
    out.push(
      `Authenticity is "${humanize(asString(t.authenticity)).toLowerCase()}", so this is not shown as something the developer built.`,
    );
  if (t.fallback)
    out.push("No model judgement was available; the graph baseline decided.");
  if (num(t.evidence?.commits) <= 1 && num(t.evidence?.files) > 0)
    out.push("Only one commit touches this topic.");
  const paths = asArray<Obj>(detail.capabilityPaths);
  if (paths.length && paths.every((p) => num(p.demonstrations) === 0))
    out.push(
      "Mapped capabilities have no demonstrations for this developer; mappings are taxonomy, not proof.",
    );
  return out.slice(0, 8);
}

/* -------------------------------------------------------------------------- */
/* GRAPH LAYOUT: domain-anchored force layout, normalised to fill the canvas  */
/* -------------------------------------------------------------------------- */

const GW = 1000;
const GH = 600;
const PADX = 110;
const PADY = 70;

function layout(nodes: Obj[], edges: Obj[]) {
  const n = nodes.length;
  const out = new Map<string, { x: number; y: number }>();
  if (!n) return out;

  const domains = [...new Set(nodes.map((x) => asString(x.domain)))];
  const anchor = new Map<string, { x: number; y: number }>();
  domains.forEach((d, i) => {
    const a = (i / Math.max(1, domains.length)) * Math.PI * 2 - Math.PI / 2;
    anchor.set(d, {
      x: GW / 2 + Math.cos(a) * GW * 0.3,
      y: GH / 2 + Math.sin(a) * GH * 0.3,
    });
  });

  const ids = nodes.map((x) => asString(x.id));
  const pos = new Map<
    string,
    { x: number; y: number; vx: number; vy: number }
  >();
  nodes.forEach((nd, i) => {
    const an = anchor.get(asString(nd.domain))!;
    const h = hash(ids[i]);
    pos.set(ids[i], {
      x: an.x + ((h % 120) - 60),
      y: an.y + (((h >> 7) % 120) - 60),
      vx: 0,
      vy: 0,
    });
  });
  const links = edges.filter(
    (e) => pos.has(asString(e.source)) && pos.has(asString(e.target)),
  );

  const iters = 320;
  for (let it = 0; it < iters; it++) {
    const cool = 1 - it / iters;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos.get(ids[i])!;
        const b = pos.get(ids[j])!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = Math.max(dx * dx + dy * dy, 80);
        const d = Math.sqrt(d2);
        const f = (14000 / d2) * (0.35 + cool);
        a.vx += (dx / d) * f;
        a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f;
        b.vy -= (dy / d) * f;
      }
    }
    for (const e of links) {
      const a = pos.get(asString(e.source))!;
      const b = pos.get(asString(e.target))!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const f = (d - 150) * 0.02;
      a.vx += (dx / d) * f;
      a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f;
      b.vy -= (dy / d) * f;
    }
    nodes.forEach((nd, i) => {
      const p = pos.get(ids[i])!;
      const an = anchor.get(asString(nd.domain))!;
      p.vx += (an.x - p.x) * 0.02 + (GW / 2 - p.x) * 0.002;
      p.vy += (an.y - p.y) * 0.02 + (GH / 2 - p.y) * 0.002;
      p.vx *= 0.8;
      p.vy *= 0.8;
      p.x += p.vx;
      p.y += p.vy;
    });
  }

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of pos.values()) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const rx = maxX - minX;
  const ry = maxY - minY;
  for (const [k, p] of pos) {
    out.set(k, {
      x: rx < 1 ? GW / 2 : PADX + ((p.x - minX) / rx) * (GW - PADX * 2),
      y: ry < 1 ? GH / 2 : PADY + ((p.y - minY) / ry) * (GH - PADY * 2),
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* CHAT: local fallback answerer (used if /api/topics/chat isn't available)   */
/* Every answer is read from graph data already loaded; if the graph does not */
/* establish something, it says so.                                           */
/* -------------------------------------------------------------------------- */

type ChatMsg = {
  id: number;
  role: "user" | "ai";
  text: string;
  slugs?: string[];
  local?: boolean;
  question?: string;
  blocks?: Array<Obj & { type: string }>;
  followups?: string[];
  tools?: Obj[];
  mode?: string;
  meta?: Obj;
  /** answer is still streaming in */
  pending?: boolean;
  /** live tool chips while pending */
  steps?: LiveStep[];
};

type ChatCtx = {
  nodes: Obj[];
  overview: Obj | null;
  relations: Obj | null;
  sel: string | null;
  detail: Obj | null;
};

function rankNodes(nodes: Obj[]) {
  return nodes
    .filter((n) => n.assessed)
    .sort(
      (a, b) =>
        (LEVEL_RANK[asString(b.level)] ?? 0) -
          (LEVEL_RANK[asString(a.level)] ?? 0) ||
        num(b.score, num(b.size)) - num(a.score, num(a.size)),
    );
}

function localAnswer(q: string, c: ChatCtx): { text: string; slugs: string[] } {
  const s = q.toLowerCase();
  const assessed = rankNodes(c.nodes);
  const hl = (c.overview?.highlights ?? {}) as Obj;
  const stats = (c.overview?.stats ?? {}) as Obj;
  const summary = c.overview?.summary as Obj | null;
  const names = (list: Obj[]) =>
    list.map((x) => asString(x.name ?? x.label)).join(", ");
  const slugsOf = (list: Obj[]) =>
    list.map((x) => asString(x.slug)).filter(Boolean);

  // which topic is the question about: named in the text, else the selected one
  const named = assessed.find((n) => {
    const l = asString(n.label).toLowerCase();
    return l.length > 2 && s.includes(l);
  });
  const focusSlug = named ? asString(named.slug) : c.sel;
  const d = focusSlug && c.sel === focusSlug ? c.detail : null;
  const focusNode = assessed.find((n) => asString(n.slug) === focusSlug);
  const focusName = asString(focusNode?.label ?? d?.topic?.name ?? focusSlug);
  const focusSlugs = focusSlug ? [focusSlug] : [];

  const needDetail = (): { text: string; slugs: string[] } => ({
    text: focusSlug
      ? `Open ${focusName} in the Topic tab first so I can read its evidence from the graph.`
      : "Select a topic in the constellation and I can show the evidence behind it.",
    slugs: focusSlugs,
  });

  // evidence / why
  if (
    /evidence|support|why|prove|proof|demonstrat|justif|rated|rate\b/.test(s)
  ) {
    if (!d) return needDetail();
    const paths = asArray<Obj>(d.capabilityPaths).filter(
      (p) => num(p.demonstrations) > 0,
    );
    const impl = asArray<Obj>(d.implementations);
    const lvl =
      LEVEL_LABEL[asString(d.topic?.level)] ?? asString(d.topic?.level);
    let text = `${focusName} is assessed at ${lvl}. ${asString(d.verdict)}`;
    if (paths.length)
      text += ` Linked capabilities with demonstrations: ${paths
        .slice(0, 3)
        .map((p) => `${asString(p.capability)} (${num(p.demonstrations)})`)
        .join(", ")}.`;
    if (impl.length)
      text += ` Implementations cited: ${impl
        .slice(0, 3)
        .map((i) => cut(asString(i.what), 80))
        .join("; ")}.`;
    else text += " No specific implementation is cited for it.";
    const lim = limitationsOf(d);
    if (lim.length) text += ` Not established: ${lim[0]}`;
    return { text, slugs: focusSlugs };
  }

  // capabilities
  if (/capabilit/.test(s)) {
    if (!d) return needDetail();
    const paths = asArray<Obj>(d.capabilityPaths);
    return {
      text: paths.length
        ? `${focusName} maps to ${paths
            .slice(0, 5)
            .map(
              (p) =>
                `${asString(p.capability)} (${num(p.demonstrations)} demonstration${num(p.demonstrations) === 1 ? "" : "s"})`,
            )
            .join(
              ", ",
            )}. A mapping is taxonomy; only demonstrations show actual work.`
        : `The graph has no capability mapped to ${focusName}.`,
      slugs: focusSlugs,
    };
  }

  // unproven / limits
  if (
    /unproven|unknown|limit|not shown|missing|weak|gap|shallow|worst/.test(s)
  ) {
    if (d) {
      const lim = limitationsOf(d);
      return {
        text: lim.length
          ? `For ${focusName}, not established: ${lim.slice(0, 3).join(" ")}`
          : `The assessment of ${focusName} lists no explicit limitations.`,
        slugs: focusSlugs,
      };
    }
    const gaps = asArray<Obj>(c.relations?.foundationGaps).slice(0, 3);
    const shallow = asArray<Obj>(hl.broadButShallow).slice(0, 4);
    const parts: string[] = [];
    if (gaps.length) parts.push(gaps.map((g) => asString(g.message)).join(" "));
    if (shallow.length) parts.push(`Broad but shallow: ${names(shallow)}.`);
    return {
      text:
        parts.join(" ") ||
        "The graph shows no foundation gaps or broad-but-shallow topics right now.",
      slugs: [...gaps.map((g) => asString(g.topic?.slug)), ...slugsOf(shallow)],
    };
  }

  // prerequisites / related
  if (
    /prereq|foundation|depends|builds on|unlock|core|base|fundamental/.test(s)
  ) {
    if (d) {
      const f = asArray<Obj>(d.graph?.foundations);
      const u = asArray<Obj>(d.graph?.unlocks);
      const parts: string[] = [];
      parts.push(
        f.length
          ? `${focusName} builds on ${f
              .slice(0, 5)
              .map(
                (x) =>
                  `${asString(x.name)} (${LEVEL_LABEL[asString(x.developerLevel)] ?? "none"})`,
              )
              .join(", ")}.`
          : `The graph records no BUILDS_ON foundation for ${focusName}.`,
      );
      if (u.length) parts.push(`Built on top of it: ${names(u.slice(0, 5))}.`);
      return { text: parts.join(" "), slugs: [...focusSlugs, ...slugsOf(f)] };
    }
    const b = asArray<Obj>(hl.topFoundations).slice(0, 4);
    return {
      text: b.length
        ? `Highest PageRank over the topic graph: ${names(b)}. Many topics build on them, but rank alone does not prove skill.`
        : "No foundation ranking was computed yet.",
      slugs: slugsOf(b),
    };
  }
  if (/related|similar|connected|neighbo/.test(s)) {
    if (!d) return needDetail();
    const r = asArray<Obj>(d.graph?.related);
    return {
      text: r.length
        ? `Related to ${focusName} (association, not prerequisite): ${names(r.slice(0, 6))}.`
        : `No RELATED_TOPIC edge is recorded for ${focusName}.`,
      slugs: [...focusSlugs, ...slugsOf(r)],
    };
  }

  // a topic named without a specific intent: describe it
  if (named) {
    const slug = asString(named.slug);
    const nd = c.sel === slug ? c.detail : null;
    const lvl = LEVEL_LABEL[asString(named.level)] ?? asString(named.level);
    let text = `${asString(named.label)} sits at ${lvl} level${
      named.score != null ? ` (score ${num(named.score)})` : ""
    }.`;
    if (nd?.verdict) text += ` ${asString(nd.verdict)}`;
    else text += " Open it in the Topic tab to see the evidence behind it.";
    return { text, slugs: [slug] };
  }

  if (/strong|best|deep|good at|expert|top skill/.test(s)) {
    const top = assessed.slice(0, 5);
    return {
      text: top.length
        ? `Deepest assessed topics: ${names(top)}. Click one to see what supports the level.`
        : "No topics are assessed yet. Run the analysis first.",
      slugs: slugsOf(top),
    };
  }
  if (/built|build|own|project|implement/.test(s)) {
    const b = asArray<Obj>(hl.builds).slice(0, 6);
    return {
      text: b.length
        ? `Topics marked as genuine implementations: ${names(b)}.`
        : "No topic is marked as a genuine implementation yet.",
      slugs: slugsOf(b),
    };
  }
  if (/bridge|between|cross/.test(s)) {
    const b = asArray<Obj>(hl.topBridges).slice(0, 4);
    return {
      text: b.length
        ? `Highest betweenness: ${names(b)}. They sit on shortest paths between otherwise separate parts of the topic graph.`
        : "No bridge topics were computed yet.",
      slugs: slugsOf(b),
    };
  }
  if (/recent|lately|active|latest/.test(s)) {
    const b = asArray<Obj>(hl.recentlyActive).slice(0, 5);
    return {
      text: b.length
        ? `Most recently touched: ${names(b)}.`
        : "No recent activity was found.",
      slugs: slugsOf(b),
    };
  }
  if (/how many|count|total|number/.test(s)) {
    return {
      text: `${num(stats.topics)} topics assessed across ${num(stats.domains)} domains. ${num(stats.deepTopics)} are Deep and ${num(stats.ownImplementations)} are genuine implementations. Average score ${num(stats.averageScore)}.`,
      slugs: [],
    };
  }
  if (/who|about me|summary|overview|profile|me\b/.test(s)) {
    return {
      text:
        [summary?.headline, summary?.pattern]
          .filter(Boolean)
          .map((value) => asString(value))
          .join(" ") || "Run the analysis and I can summarise the profile.",
      slugs: [],
    };
  }
  return {
    text: "I can explain the evidence behind a topic's depth, its linked capabilities, what it builds on, which topics are related, which topics bridge areas, and what remains unproven. Select a topic or name one.",
    slugs: [],
  };
}

/* -------------------------------------------------------------------------- */
/* MAIN                                                                       */
/* -------------------------------------------------------------------------- */

type Filters = {
  domain: string;
  level: string;
  q: string;
  sort: string;
  order: string;
  page: number;
};
const DEFAULT_FILTERS: Filters = {
  domain: "",
  level: "",
  q: "",
  sort: "foundation",
  order: "desc",
  page: 0,
};

type Lens =
  | "highlights"
  | "foundations"
  | "groups"
  | "topics"
  | "paths"
  | "hood";
type SideTab = "ask" | "topic";

const LENSES: Array<{ id: Lens; label: string }> = [
  { id: "highlights", label: "Highlights" },
  { id: "foundations", label: "Foundations" },
  { id: "groups", label: "Groups" },
  { id: "topics", label: "All topics" },
  { id: "paths", label: "Paths" },
  { id: "hood", label: "Under the hood" },
];

const WELCOME =
  "Select a topic to see why Pathway rated it that way: the capabilities, implementations and graph relationships behind it. Ask me what supports a level, what a topic builds on, or what remains unproven. Topics I mention glow in the graph.";

const EVIDENCE_ID = "graph-evidence";
const scrollToEvidence = () =>
  window.setTimeout(
    () =>
      document
        .getElementById(EVIDENCE_ID)
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    80,
  );

export default function OverviewPage() {
  const navigate = useNavigate();

  const [model, setModel] = useState<Obj | null>(null);
  const [overview, setOverview] = useState<Obj | null>(null);
  const [groups, setGroups] = useState<Obj | null>(null);
  const [relations, setRelations] = useState<Obj | null>(null);
  const [graph, setGraph] = useState<Obj | null>(null);
  const [algos, setAlgos] = useState<Obj | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [partial, setPartial] = useState<string[]>([]);

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [qDraft, setQDraft] = useState("");

  const [job, setJob] = useState<Obj | null>(null);
  const [jobErr, setJobErr] = useState<string | null>(null);

  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<Obj | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTick, setDetailTick] = useState(0);

  const [sideTab, setSideTab] = useState<SideTab>("ask");
  const [lens, setLens] = useState<Lens>("highlights");

  const [colorBy, setColorBy] = useState("level");
  const [showNeighbors, setShowNeighbors] = useState(true);
  const [pathFrom, setPathFrom] = useState("");
  const [pathTo, setPathTo] = useState("");
  const [pathRes, setPathRes] = useState<Obj | null>(null);
  const [pathErr, setPathErr] = useState<string | null>(null);
  const [groupDim, setGroupDim] = useState("domain");

  // set a goal
  const [goalWish, setGoalWish] = useState("");
  const [goalBusy, setGoalBusy] = useState(false);
  const [goalErr, setGoalErr] = useState<string | null>(null);
  const [goalHelp, setGoalHelp] = useState<Obj | null>(null);

  // chat
  const [messages, setMessages] = useState<ChatMsg[]>([
    { id: 1, role: "ai", text: WELCOME },
  ]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [stage, setStage] = useState<ChatMsg | null>(null);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const msgId = useRef(2);
  const chatRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const jobRef = useRef<Obj | null>(null);

  /* ---------------- loading ---------------- */

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.domain) p.set("domain", filters.domain);
    if (filters.level) p.set("level", filters.level);
    if (filters.q) p.set("q", filters.q);
    p.set("sort", filters.sort);
    p.set("order", filters.order);
    p.set("limit", String(PAGE));
    p.set("offset", String(filters.page * PAGE));
    return p.toString();
  }, [filters]);

  const loadOverview = useCallback(
    async (fresh = false) => {
      const o = await getJson(`/api/topics?${qs}${fresh ? "&fresh=1" : ""}`);
      setOverview(o);
      if (o.status?.job && !jobRef.current) setJob(o.status.job);
    },
    [qs],
  );

  const loadSide = useCallback(
    async (fresh = false) => {
      const f = fresh ? "?fresh=1" : "";
      const gq = `?neighbors=${showNeighbors ? "1" : "0"}${fresh ? "&fresh=1" : ""}`;
      const missing: string[] = [];
      const safe = async <T,>(
        label: string,
        p: Promise<T>,
      ): Promise<T | null> => {
        try {
          return await p;
        } catch {
          missing.push(label);
          return null;
        }
      };
      const [m, g, r, gr, a] = await Promise.all([
        safe("model", getJson("/api/topics/model")),
        safe("groups", getJson(`/api/topics/groups${f}`)),
        safe("relations", getJson(`/api/topics/relations${f}`)),
        safe("graph", getJson(`/api/topics/graph${gq}`)),
        safe("algorithms", getJson(`/api/topics/algorithms${f}`)),
      ]);
      if (m) setModel(m);
      if (g) setGroups(g);
      if (r) setRelations(r);
      if (gr) setGraph(gr);
      if (a) setAlgos(a);
      setPartial(missing);
    },
    [showNeighbors],
  );

  useEffect(() => {
    jobRef.current = job;
  }, [job]);

  const refreshAll = useCallback(
    async (fresh = false) => {
      if (fresh) setRefreshing(true);
      try {
        await Promise.all([loadOverview(fresh), loadSide(fresh)]);
        setDetailTick((n) => n + 1);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load topics.");
      } finally {
        setRefreshing(false);
      }
    },
    [loadOverview, loadSide],
  );
  const refreshRef = useRef(refreshAll);
  useEffect(() => {
    refreshRef.current = refreshAll;
  }, [refreshAll]);

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([loadOverview(), loadSide()]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load topics.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const firstQs = useRef(true);
  useEffect(() => {
    if (firstQs.current) {
      firstQs.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      loadOverview().catch(() => {});
    }, 200);
    return () => window.clearTimeout(t);
  }, [qs, loadOverview]);

  const firstNb = useRef(true);
  useEffect(() => {
    if (firstNb.current) {
      firstNb.current = false;
      return;
    }
    getJson(`/api/topics/graph?neighbors=${showNeighbors ? "1" : "0"}`)
      .then(setGraph)
      .catch(() => {});
  }, [showNeighbors]);

  const running = job?.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(async () => {
      try {
        const j = await getJson("/api/topics/analyze/status");
        setJob(j);
        if (j.status !== "running") void refreshRef.current(true);
      } catch {
        /* keep polling */
      }
    }, 1500);
    return () => window.clearInterval(t);
  }, [running]);

  useEffect(() => {
    const t = window.setTimeout(
      () =>
        setFilters((f) => (f.q === qDraft ? f : { ...f, q: qDraft, page: 0 })),
      350,
    );
    return () => window.clearTimeout(t);
  }, [qDraft]);

  useEffect(() => {
    if (!sel) {
      setDetail(null);
      setDetailErr(null);
      return;
    }
    let live = true;
    setDetailLoading(true);
    getJson(`/api/topics/${encodeURIComponent(sel)}`)
      .then((d) => {
        if (!live) return;
        setDetail(d);
        setDetailErr(null);
      })
      .catch((e) => {
        if (!live) return;
        setDetail(null);
        setDetailErr(e instanceof Error ? e.message : "Failed to load topic.");
      })
      .finally(() => live && setDetailLoading(false));
    return () => {
      live = false;
    };
  }, [sel, detailTick]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setSel(null);
        setSideTab("ask");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sideTab]);

  /* ---------------- derived ---------------- */

  const nodes = useMemo(() => asArray<Obj>(graph?.nodes), [graph]);
  const edges = useMemo(() => asArray<Obj>(graph?.edges), [graph]);
  const positions = useMemo(() => layout(nodes, edges), [nodes, edges]);
  const pathSet = useMemo(
    () =>
      new Set<string>(
        asArray<Obj>(pathRes?.steps).map((s) => asString(s.slug)),
      ),
    [pathRes],
  );
  const slugToId = useMemo(() => {
    const m = new Map<string, string>();
    nodes.forEach((n) => m.set(asString(n.slug), asString(n.id)));
    return m;
  }, [nodes]);
  const glowIds = useMemo(() => {
    const s = new Set<string>();
    highlight.forEach((slug) => {
      const id = slugToId.get(slug);
      if (id) s.add(id);
    });
    return s;
  }, [highlight, slugToId]);
  const pathIds = useMemo(() => {
    const s = new Set<string>();
    pathSet.forEach((slug) => {
      const id = slugToId.get(slug);
      if (id) s.add(id);
    });
    return s;
  }, [pathSet, slugToId]);

  const levelMix = useMemo(() => {
    const m: Record<string, number> = {};
    nodes
      .filter((n) => n.assessed)
      .forEach((n) => {
        const l = asString(n.level, "none");
        m[l] = (m[l] ?? 0) + 1;
      });
    return m;
  }, [nodes]);
  const mixTotal = Object.values(levelMix).reduce((a, b) => a + b, 0);

  const items = asArray<Obj>(overview?.topics?.items);
  const total = num(overview?.topics?.total);
  const stats = (overview?.stats ?? {}) as Obj;
  const status = (overview?.status ?? {}) as Obj;
  const summary = overview?.summary as Obj | null;
  const dims = asArray<Obj>(groups?.dimensions);
  const domainGroups = asArray<Obj>(
    dims.find((x) => x.id === "domain")?.groups,
  );
  const activeDim = dims.find((x) => x.id === groupDim) ?? dims[0];
  const selCard = useMemo(
    () => items.find((c) => c.slug === sel) ?? null,
    [items, sel],
  );
  const analyzed = status.analyzed === true;

  /* ---------------- actions ---------------- */

  const startAnalysis = async () => {
    setJobErr(null);
    const r = await call("/api/topics/analyze", "POST", { maxTopics: 16 });
    if (r.status === 202 || r.status === 409) {
      setJob(r.data.job ?? null);
      if (r.status === 409) setJobErr("Already running.");
      return;
    }
    setJobErr(
      asString(r.data.detail || r.data.error, "Could not start analysis."),
    );
  };

  const reanalyze = async (slug: string) => {
    setJobErr(null);
    const r = await call(
      `/api/topics/${encodeURIComponent(slug)}/reanalyze`,
      "POST",
      {},
    );
    if (r.status === 202 || r.status === 409) {
      setJob(r.data.job ?? null);
      return;
    }
    setJobErr(
      asString(r.data.detail || r.data.error, "Could not start re-analysis."),
    );
  };

  /**
   * POST /api/goal { wish }
   *  - status "goal"                → open the read-only /goal page with the result
   *  - status "needs_clarification" → stay here, show the message + topic suggestions
   */
  const submitGoal = async () => {
    const wish = goalWish.trim();
    if (wish.length < 3 || goalBusy) return;
    setGoalBusy(true);
    setGoalErr(null);
    setGoalHelp(null);
    try {
      const r = await call("/api/goal", "POST", { wish });
      if (!r.ok) {
        setGoalErr(asString(r.data.error, "Could not generate a goal."));
        return;
      }
      if (r.data.status === "goal") {
        navigate("/goal", { state: { result: r.data } });
        return;
      }
      if (r.data.status === "needs_clarification") {
        setGoalHelp(r.data);
        return;
      }
      setGoalErr("Unexpected response from the goal service.");
    } catch {
      setGoalErr("Could not reach the goal service. Try again.");
    } finally {
      setGoalBusy(false);
    }
  };

  const pick = (slug: string) => {
    if (!slug) return;
    setSel(slug);
    setSideTab("topic");
    if (
      typeof window !== "undefined" &&
      !window.matchMedia("(min-width: 1280px)").matches
    ) {
      window.setTimeout(
        () =>
          asideRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          }),
        60,
      );
    }
  };

  const closeTopic = () => {
    setSel(null);
    setSideTab("ask");
  };

  const findPath = async () => {
    setPathErr(null);
    setPathRes(null);
    if (!pathFrom || !pathTo) return;
    const r = await call(
      `/api/topics/path?from=${encodeURIComponent(pathFrom)}&to=${encodeURIComponent(pathTo)}`,
    );
    if (r.ok) setPathRes(r.data);
    else setPathErr(asString(r.data.error, "No path found."));
  };

  const send = async (raw?: string) => {
    const text = (raw ?? draft).trim();
    if (!text || thinking) return;
    setDraft("");
    setSideTab("ask");
    const history = messages
      .filter((m) => m.text && !m.pending)
      .slice(-8)
      .map((m) => ({
        role: m.role === "ai" ? "assistant" : "user",
        content: m.text,
      }));

    // the assistant message exists from the first moment and fills in live
    const userId = msgId.current++;
    const aiId = msgId.current++;
    setMessages((m) => [
      ...m,
      { id: userId, role: "user", text },
      { id: aiId, role: "ai", text: "", pending: true, steps: [] },
    ]);
    setThinking(true);

    const patch = (fn: (m: ChatMsg) => ChatMsg) =>
      setMessages((ms) => ms.map((x) => (x.id === aiId ? fn(x) : x)));

    const onEvent = (e: TraceEvent) => {
      if (e.type === "plan") {
        patch((m) => ({
          ...m,
          steps: e.calls.map((c) => ({
            tool: c.tool,
            title: c.title,
            state: "run" as const,
          })),
        }));
      } else if (e.type === "tool_done") {
        patch((m) => ({
          ...m,
          steps: (m.steps ?? []).map((st) =>
            st.tool === e.tool
              ? {
                  ...st,
                  state:
                    e.ok && !e.miss ? ("done" as const) : ("miss" as const),
                  ms: e.ms,
                }
              : st,
          ),
        }));
      } else if (e.type === "answer_delta") {
        patch((m) => ({ ...m, text: m.text + e.text }));
      }
    };

    type Reply = Omit<ChatMsg, "id" | "role"> & { slugs: string[] };
    let reply: Reply | null = null;
    try {
      const r = await chatRequest(
        { message: text, history, topic: sel },
        onEvent,
      );
      if (r.ok) {
        const answer = asString(r.data.answer);
        const blocks = asArray<Obj>(r.data.blocks).filter(
          (block): block is Obj & { type: string } =>
            typeof block.type === "string",
        );
        if (answer || blocks.length) {
          reply = {
            text: answer,
            question: text,
            blocks,
            followups: asArray<string>(r.data.followups).slice(0, 3),
            tools: asArray<Obj>(r.data.tools),
            mode: asString(r.data.meta?.mode),
            meta: (r.data.meta ?? {}) as Obj,
            slugs: asArray<string>(r.data.topics).filter(Boolean),
            local: false,
          };
        }
      } else if (r.status === 429) {
        reply = {
          text: asString(r.data.error, "Slow down a little."),
          slugs: [],
          local: false,
        };
      }
    } catch {
      /* fall through to the local answer */
    }
    if (!reply) {
      const a = localAnswer(text, { nodes, overview, relations, sel, detail });
      reply = { ...a, local: true };
    }
    const final = reply;
    const slugs = [...new Set(final.slugs.filter(Boolean))];
    setHighlight(new Set(slugs));
    patch((m) => ({
      ...m,
      ...final,
      slugs,
      pending: false,
      steps: undefined,
    }));
    setThinking(false);
  };

  const askAbout = (name: string) => {
    setSideTab("ask");
    setDraft(`What evidence supports my ${name} depth?`);
  };

  /* ---------------- screens ---------------- */

  if (loading && !overview)
    return (
      <Screen>
        <InlineLoading label="Reading your topic graph…" />
      </Screen>
    );
  if (error && !overview) {
    return (
      <Screen>
        <div
          className="rounded-2xl p-7 text-center"
          style={{ backgroundColor: WHITE, ...border, boxShadow: shadow(4) }}
        >
          <h1
            className="text-[22px] font-black"
            style={{ fontFamily: DISPLAY_FONT }}
          >
            Couldn't load your topics
          </h1>
          <p className="mt-2 text-[13px] leading-5 text-neutral-800">{error}</p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setLoading(true);
              refreshAll().finally(() => setLoading(false));
            }}
            className="mt-5 rounded-full px-5 py-2.5 text-[13px] font-black"
            style={{ backgroundColor: YELLOW, ...border }}
          >
            Try again
          </button>
        </div>
      </Screen>
    );
  }
  if (!overview) return null;

  const prompts = [
    "What am I strongest at?",
    "Which topics bridge areas?",
    "What have I built myself?",
    "What remains unproven?",
    ...(sel && (selCard || detail)
      ? [
          `What evidence supports ${asString(detail?.topic?.name ?? selCard?.name ?? sel)}?`,
        ]
      : []),
  ];

  const highlightRows = (
    [
      ["strongest", "Strongest", GREEN, "Deepest assessed topics"],
      ["topFoundations", "Foundations", SKY, "Highest PageRank in the graph"],
      ["topBridges", "Bridges", CORAL, "Highest betweenness"],
      ["builds", "Built yourself", PURPLE, "Genuine implementations"],
      ["recentlyActive", "Recently active", YELLOW, "Touched lately"],
      ["broadButShallow", "Broad but shallow", "#9ca3af", "Wide, not deep"],
      [
        "lowConfidence",
        "Low confidence",
        "#d1d5db",
        "Thin evidence behind them",
      ],
    ] as const
  )
    .map(([key, label, color, hint]) => ({
      key,
      label,
      color,
      hint,
      list: asArray<Obj>(overview.highlights?.[key]),
    }))
    .filter((r) => r.list.length);

  return (
    <div
      className="min-h-screen w-full"
      style={{
        backgroundColor: PAPER,
        color: INK,
        fontFamily: BODY_FONT,
        fontWeight: 500,
      }}
    >
      <style>{`
        * { box-sizing: border-box; }
        button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 3px solid ${SKY}; outline-offset: 2px; }
        svg g:focus-visible { outline: 3px solid ${SKY}; outline-offset: 2px; }
        details > summary { list-style: none; }
        details > summary::-webkit-details-marker { display: none; }
        @keyframes ostripe { to { background-position: 28px 0; } }
        @keyframes oblink { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
        @keyframes oring { 0% { r: 0; opacity: .9; } 100% { r: 46; opacity: 0; } }
        @keyframes osweep { to { transform: rotate(360deg); } }
        @keyframes opop { from { opacity: 0; transform: scale(.2); } to { opacity: 1; transform: scale(1); } }
        @keyframes odot { 0%,80%,100% { transform: translateY(0); opacity: .35; } 40% { transform: translateY(-4px); opacity: 1; } }
        @keyframes oslide { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes ofloat { 0%,100% { transform: translate(0,0); } 50% { transform: translate(0,-3px); } }
        @keyframes ofade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes opulse { 0% { transform: scale(1); opacity: .8; } 100% { transform: scale(2.1); opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }
      `}</style>

      {/* HEADER */}
      <header
        className="sticky top-0 z-40"
        style={{
          backgroundColor: "rgba(241,238,231,.96)",
          borderBottom: `2px solid ${INK}`,
          backdropFilter: "blur(10px)",
        }}
      >
        <div className={`flex items-center justify-between py-2.5 ${GUTTER}`}>
          <div className="flex items-center gap-5">
            <Link to="/" className="flex items-center gap-2.5">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-xl"
                style={{ backgroundColor: YELLOW, ...border }}
              >
                <Sparkles size={16} />
              </div>
              <span
                className="text-[18px] font-black tracking-tight"
                style={{ fontFamily: DISPLAY_FONT }}
              >
                pathway.io
              </span>
            </Link>
            <nav className="hidden items-center gap-1 md:flex">
              <span
                className="rounded-full px-3 py-1.5 text-[13px] font-bold"
                style={{ backgroundColor: YELLOW }}
              >
                Overview
              </span>
              <Link
                to="/graph"
                className="rounded-full px-3 py-1.5 text-[13px] font-bold"
              >
                Skill graph
              </Link>
              <Link
                to="/builds"
                className="rounded-full px-3 py-1.5 text-[13px] font-bold"
              >
                Builds
              </Link>
            </nav>
          </div>
          <button
            type="button"
            onClick={() => void refreshAll(true)}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-bold transition-transform hover:-translate-y-0.5 disabled:opacity-50"
            style={{ backgroundColor: YELLOW, ...border }}
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </header>

      <main className={`w-full pb-20 pt-4 ${GUTTER}`}>
        {partial.length > 0 && (
          <div
            className="mb-3 rounded-xl p-2.5 text-[13px] font-bold"
            style={{ backgroundColor: WHITE, color: CORAL, ...border }}
          >
            Some data could not load ({partial.join(", ")}). Hit Refresh to
            retry.
          </div>
        )}

        {/* SLIM STRIP */}
        <section className="mb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 lg:max-w-[62%]">
              <p className="text-[12px] font-black uppercase tracking-[.14em] text-neutral-700">
                Your engineering knowledge graph
              </p>
              <h1
                className="mt-0.5 text-[19px] font-black leading-[1.2] tracking-tight sm:text-[22px]"
                style={{ fontFamily: DISPLAY_FONT, ...clamp(2) }}
                title={asString(summary?.headline)}
              >
                {summary?.headline
                  ? asString(summary.headline)
                  : analyzed
                    ? "Here's what you know, and the evidence behind it."
                    : "No topics yet. Run the analysis to map your skills."}
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {running ? (
                <RunMini job={job} step={stepOf(job)} model={model} />
              ) : (
                <>
                  <StatPill value={num(stats.topics)} label="topics" />
                  <StatPill value={num(stats.domains)} label="domains" />
                  <StatPill value={num(stats.deepTopics)} label="deep" />
                  <StatPill
                    value={num(stats.relations?.buildsOn)}
                    label="builds-on"
                  />
                  <Btn
                    onClick={() => void startAnalysis()}
                    bg={YELLOW}
                    disabled={running}
                  >
                    <Play size={12} /> {analyzed ? "Re-run" : "Run analysis"}
                  </Btn>
                </>
              )}
            </div>
          </div>

          {/* depth mix: thin bar */}
          {mixTotal > 0 && (
            <div className="mt-3 flex items-center gap-3">
              <div
                className="flex h-3 flex-1 overflow-hidden rounded-full"
                style={{ backgroundColor: CARD, ...border }}
              >
                {LEVEL_ORDER.filter((l) => levelMix[l]).map((l) => (
                  <div
                    key={l}
                    title={`${LEVEL_LABEL[l]}: ${levelMix[l]}`}
                    style={{
                      width: `${(levelMix[l] / mixTotal) * 100}%`,
                      backgroundColor: LEVEL_COLOR[l],
                      borderRight: `2px solid ${INK}`,
                    }}
                  />
                ))}
              </div>
              <div className="hidden shrink-0 items-center gap-3 sm:flex">
                {LEVEL_ORDER.filter((l) => levelMix[l]).map((l) => (
                  <span
                    key={l}
                    className="flex items-center gap-1.5 text-[12px] font-bold text-neutral-900"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{
                        backgroundColor: LEVEL_COLOR[l],
                        border: `1.5px solid ${INK}`,
                      }}
                    />
                    {levelMix[l]} {LEVEL_LABEL[l].toLowerCase()}
                  </span>
                ))}
              </div>
              {status.lastAnalyzedAt && (
                <span className="hidden shrink-0 text-[12px] font-semibold text-neutral-700 lg:block">
                  analyzed {timeAgo(asString(status.lastAnalyzedAt))}
                </span>
              )}
            </div>
          )}
          {jobErr && (
            <p className="mt-2 text-[13px] font-bold" style={{ color: CORAL }}>
              {jobErr}
            </p>
          )}

          {/* SET A GOAL: opens the read-only /goal page */}
          <GoalModule
            wish={goalWish}
            onWish={(v) => {
              setGoalWish(v);
              if (goalErr) setGoalErr(null);
            }}
            busy={goalBusy}
            err={goalErr}
            help={goalHelp}
            disabledReason={
              running
                ? "Analysis is running. Goals unlock when it finishes."
                : !analyzed
                  ? "Run the analysis first so a goal can be built on your graph."
                  : null
            }
            onSubmit={() => void submitGoal()}
            onSuggest={(name) => {
              setGoalWish(`I want to improve my ${name} skills`);
              setGoalHelp(null);
            }}
            onDismissHelp={() => setGoalHelp(null)}
          />
        </section>

        {/* WORKSPACE: constellation + chat/topic, fits one screen */}
        <div className="grid gap-4 xl:h-[calc(100vh-255px)] xl:min-h-[540px] xl:grid-cols-[minmax(0,1fr)_420px] xl:grid-rows-[minmax(0,1fr)]">
          {/* constellation */}
          <section
            className="flex h-[480px] min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl xl:h-full"
            style={{
              backgroundColor: "#F8F6F1",
              backgroundImage:
                "radial-gradient(circle at 50% 38%, #FFFDF8 0%, #F4F1E9 55%, #ECE8DD 100%)",
              ...border,
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <div className="flex items-baseline gap-3">
                <h2
                  className="text-[16px] font-black"
                  style={{ fontFamily: DISPLAY_FONT, color: INK }}
                >
                  Constellation
                </h2>
                <span className="text-[12px] font-semibold text-neutral-800">
                  bigger = deeper · click a star to see why
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={colorBy}
                  onChange={(e) => setColorBy(e.target.value)}
                  aria-label="Colour by"
                  className="rounded-full bg-white px-2.5 py-1 text-[12px] font-bold outline-none"
                  style={border}
                >
                  <option value="level">Colour: depth</option>
                  <option value="domain">Colour: domain</option>
                  <option value="cluster">Colour: community</option>
                </select>
                <Btn
                  onClick={() => setShowNeighbors((v) => !v)}
                  bg={showNeighbors ? YELLOW : CARD}
                >
                  {showNeighbors ? "Hide" : "Show"} unassessed
                </Btn>
                {highlight.size > 0 && (
                  <Btn onClick={() => setHighlight(new Set())} bg={GREEN}>
                    <X size={12} /> Clear glow
                  </Btn>
                )}
              </div>
            </div>

            {nodes.length ? (
              <>
                <div className="relative min-h-0 flex-1 overflow-hidden">
                  <TopicGraph
                    nodes={nodes}
                    edges={edges}
                    pos={positions}
                    colorBy={colorBy}
                    selected={sel}
                    glow={glowIds}
                    pathIds={pathIds}
                    running={running}
                    onSelect={(n) =>
                      n.assessed ? pick(asString(n.slug)) : undefined
                    }
                  />
                </div>
                <div
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-[12px] font-semibold"
                  style={{ borderTop: `1px solid ${LINE}`, color: INK }}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ border: `3px solid ${SKY}` }}
                    />
                    high PageRank
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ border: `3px dashed ${CORAL}` }}
                    />
                    high betweenness
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ border: `3px solid ${YELLOW}` }}
                    />
                    mentioned in chat
                  </span>
                  {graph?.stats && (
                    <span className="ml-auto text-neutral-800">
                      {num(graph.stats.nodes)} nodes ·{" "}
                      {num(graph.stats.buildsOn)} builds-on ·{" "}
                      {num(graph.stats.related)} related
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div className="p-5 pt-0">
                <p className="rounded-xl border-2 border-dashed border-neutral-400 p-5 text-[13px] text-neutral-800">
                  No topic graph yet. Run the analysis to light it up.
                </p>
              </div>
            )}
          </section>

          {/* chat + topic */}
          <aside ref={asideRef} className="min-h-0 min-w-0 xl:h-full">
            <section
              className="flex h-[620px] min-h-0 flex-col overflow-hidden rounded-2xl xl:h-full"
              style={{ backgroundColor: PAPER, ...border }}
            >
              <div
                className="flex items-center gap-2 px-3 py-2"
                style={{
                  borderBottom: `2px solid ${INK}`,
                  backgroundColor: CARD,
                }}
              >
                {/* segmented toggle: Ask / Topic */}
                <div
                  role="tablist"
                  aria-label="Side panel"
                  className="flex items-center gap-1 rounded-full p-0.5"
                  style={{ backgroundColor: WHITE, ...border }}
                >
                  {(
                    [
                      ["ask", "Ask", <MessageCircle key="a" size={13} />],
                      ["topic", "Topic", <Layers key="t" size={13} />],
                    ] as const
                  ).map(([k, label, icon]) => {
                    const active = sideTab === k;
                    return (
                      <button
                        key={k}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        disabled={k === "topic" && !sel}
                        onClick={() => setSideTab(k)}
                        className="relative inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-black transition-colors disabled:opacity-40"
                        style={{
                          backgroundColor: active ? YELLOW : "transparent",
                          border: `2px solid ${active ? INK : "transparent"}`,
                        }}
                      >
                        {icon} {label}
                      </button>
                    );
                  })}
                </div>
                <span className="ml-auto hidden items-center gap-1.5 text-[12px] font-bold text-neutral-800 sm:flex">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: GREEN }}
                  />
                  grounded in your graph
                </span>
              </div>

              {sideTab === "ask" ? (
                <>
                  <div
                    ref={chatRef}
                    className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3.5"
                  >
                    {messages.map((m) => (
                      <div
                        key={m.id}
                        className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                        style={{ animation: "oslide .25s ease-out both" }}
                      >
                        {m.role === "user" ? (
                          <div
                            className="max-w-[88%] rounded-2xl px-3.5 py-2 text-[13px] font-semibold leading-5"
                            style={{
                              backgroundColor: YELLOW,
                              ...border,
                              borderBottomRightRadius: 4,
                            }}
                          >
                            {m.text}
                          </div>
                        ) : m.blocks ||
                          m.pending ||
                          m.tools ||
                          m.local ||
                          m.followups ? (
                          <AiMessage
                            m={m}
                            onPick={pick}
                            onFollow={(q) => void send(q)}
                            onOpen={() => setStage(m)}
                          />
                        ) : (
                          <div
                            className="w-full rounded-2xl px-3.5 py-3 text-[13px] leading-[1.65]"
                            style={{
                              backgroundColor: WHITE,
                              ...border,
                              borderBottomLeftRadius: 4,
                            }}
                          >
                            {m.text}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div
                    className="space-y-2 p-3"
                    style={{
                      borderTop: `2px solid ${INK}`,
                      backgroundColor: WHITE,
                    }}
                  >
                    {messages.length <= 2 && (
                      <div className="flex flex-wrap gap-1.5">
                        {prompts.map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => void send(p)}
                            className="rounded-full px-2.5 py-1 text-[12px] font-bold transition-transform hover:-translate-y-0.5"
                            style={{ backgroundColor: LAVENDER, ...border }}
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    )}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void send();
                      }}
                      className="flex items-center gap-2"
                    >
                      <input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="Ask what supports a topic's depth…"
                        aria-label="Ask about your topics"
                        className="min-w-0 flex-1 rounded-full bg-white px-4 py-2 text-[13px] font-semibold outline-none"
                        style={border}
                      />
                      <button
                        type="submit"
                        disabled={!draft.trim() || thinking}
                        aria-label="Send"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform hover:-translate-y-0.5 disabled:opacity-40"
                        style={{ backgroundColor: YELLOW, ...border }}
                      >
                        <Send size={14} />
                      </button>
                    </form>
                  </div>
                </>
              ) : (
                <div
                  className="min-h-0 flex-1 overflow-y-auto p-4"
                  style={{ backgroundColor: WHITE }}
                >
                  {sel && (
                    <TopicPanel
                      slug={sel}
                      card={selCard}
                      detail={detail}
                      loading={detailLoading}
                      err={detailErr}
                      running={running}
                      onReanalyze={() => void reanalyze(sel)}
                      onPick={pick}
                      onAsk={askAbout}
                      onClose={closeTopic}
                      onEvidence={scrollToEvidence}
                    />
                  )}
                </div>
              )}
            </section>
          </aside>
        </div>

        {sel && (
          <TopicGraphEvidence
            key={sel}
            slug={sel}
            onPick={pick}
            onAsk={(q) => {
              window.scrollTo({ top: 0, behavior: "smooth" });
              void send(q);
            }}
          />
        )}

        {stage?.blocks && stage.blocks.length > 0 && (
          <section
            className="mt-6 rounded-2xl p-4"
            style={{
              backgroundColor: CARD,
              ...border,
              boxShadow: shadow(4),
              animation: "oslide .25s ease-out both",
            }}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] font-black uppercase tracking-[.14em] text-neutral-700">
                  Answer
                </p>
                <h2
                  className="text-[18px] font-black leading-tight"
                  style={{ fontFamily: DISPLAY_FONT }}
                >
                  {stage.question}
                </h2>
                {stage.text && (
                  <p className="mt-1 max-w-3xl text-[13px] leading-5 text-neutral-900">
                    {stage.text}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setStage(null)}
                aria-label="Close answer"
                className="shrink-0 rounded-full p-1.5"
                style={{ backgroundColor: WHITE, ...border }}
              >
                <X size={14} />
              </button>
            </div>
            <Blocks blocks={stage.blocks} onPick={pick} wide />
            {stage.tools && stage.tools.length > 0 && (
              <div
                className="mt-3 rounded-xl"
                style={{ backgroundColor: WHITE, ...border }}
              >
                <ToolTrace tools={stage.tools} meta={stage.meta} />
              </div>
            )}
          </section>
        )}

        {/* LENSES: flat, no card wall */}
        <section className="mt-8">
          <div
            className="flex flex-wrap gap-x-6 gap-y-1"
            style={{ borderBottom: `2px solid ${INK}` }}
          >
            {LENSES.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLens(l.id)}
                className="-mb-[2px] px-1 pb-2 pt-1 text-[14px] font-black"
                style={{
                  borderBottom: `4px solid ${lens === l.id ? CORAL : "transparent"}`,
                  color: lens === l.id ? INK : "#33362f",
                }}
              >
                {l.label}
              </button>
            ))}
          </div>

          <div
            key={lens}
            className="pt-4"
            style={{ animation: "oslide .25s ease-out both" }}
          >
            {/* HIGHLIGHTS */}
            {lens === "highlights" &&
              (highlightRows.length ? (
                <div>
                  {highlightRows.map((r) => (
                    <Row key={r.key}>
                      <div className="w-48 shrink-0">
                        <div className="flex items-center gap-2 text-[13px] font-black">
                          <span
                            className="h-3 w-3 rounded-sm"
                            style={{ backgroundColor: r.color, ...border }}
                          />
                          {r.label}
                        </div>
                        <div className="mt-0.5 pl-5 text-[12px] text-neutral-700">
                          {r.hint}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {r.list.slice(0, 8).map((t) => (
                          <TopicChip
                            key={asString(t.slug)}
                            t={t}
                            onClick={() => pick(asString(t.slug))}
                          />
                        ))}
                      </div>
                    </Row>
                  ))}
                </div>
              ) : (
                <Empty text="Highlights appear once topics are assessed." />
              ))}

            {/* FOUNDATIONS */}
            {lens === "foundations" &&
              (relations ? (
                <div className="space-y-5">
                  <p className="text-[13px] leading-5 text-neutral-800">
                    BUILDS_ON is a foundation dependency recorded in the topic
                    taxonomy. A foundation shown here as "not yet shown in code"
                    means the graph has no assessment for it, not that the
                    developer lacks the skill.
                  </p>
                  <div>
                    <div className="mb-2 text-[13px] font-black">
                      Foundations not yet shown in code
                    </div>
                    <div className="grid gap-x-6 gap-y-2.5 md:grid-cols-2">
                      {asArray<Obj>(relations.foundationGaps).length === 0 && (
                        <span className="text-[13px] text-neutral-800">
                          Every foundation of a proficient or deep topic has
                          assessed evidence.
                        </span>
                      )}
                      {asArray<Obj>(relations.foundationGaps).map((g, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => pick(asString(g.topic?.slug))}
                          className="block w-full pl-3 text-left hover:opacity-80"
                          style={{
                            borderLeft: `4px solid ${g.severity === "weak" ? CORAL : YELLOW}`,
                          }}
                        >
                          <div className="text-[12px] font-black uppercase text-neutral-700">
                            {g.severity === "weak"
                              ? "assessed, shallow"
                              : "not assessed"}
                          </div>
                          <p className="text-[13px] leading-5">
                            {asString(g.message)}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                  <Fold title="Hierarchy: what builds on what">
                    {asArray<Obj>(relations.hierarchy).length === 0 ? (
                      <p className="text-[13px] text-neutral-800">
                        No BUILDS_ON edge touches an assessed topic yet.
                      </p>
                    ) : (
                      <div className="grid gap-x-6 gap-y-2 md:grid-cols-2">
                        {asArray<Obj>(relations.hierarchy)
                          .slice(0, 12)
                          .map((h) => (
                            <div key={asString(h.topic?.slug)}>
                              <button
                                type="button"
                                className="text-[13px] font-black hover:underline"
                                onClick={() => pick(asString(h.topic?.slug))}
                              >
                                {asString(h.topic?.name)}
                              </button>
                              {asArray<Obj>(h.buildsOn).length > 0 && (
                                <p className="text-[12px] leading-4 text-neutral-800">
                                  builds on{" "}
                                  {asArray<Obj>(h.buildsOn)
                                    .map((x) => asString(x.name))
                                    .join(", ")}
                                </p>
                              )}
                            </div>
                          ))}
                      </div>
                    )}
                  </Fold>
                </div>
              ) : (
                <Empty text="Relations could not be loaded." />
              ))}

            {/* GROUPS */}
            {lens === "groups" &&
              (activeDim ? (
                <div>
                  <div className="mb-2 flex flex-wrap gap-2">
                    {dims.map((x) => (
                      <button
                        key={asString(x.id)}
                        type="button"
                        onClick={() => setGroupDim(asString(x.id))}
                        className="rounded-full px-3 py-1 text-[13px] font-black"
                        style={{
                          backgroundColor: activeDim?.id === x.id ? INK : WHITE,
                          color: activeDim?.id === x.id ? PAPER : INK,
                          ...border,
                        }}
                      >
                        {asString(x.title)}
                      </button>
                    ))}
                  </div>
                  <p className="mb-2 text-[13px] leading-5 text-neutral-700">
                    {asString(activeDim.method?.why)}
                  </p>
                  {asArray<Obj>(activeDim.groups).map((g) => (
                    <Row key={asString(g.key)}>
                      <div className="w-48 shrink-0">
                        <div
                          className="text-[13px] font-black"
                          style={{ fontFamily: DISPLAY_FONT }}
                        >
                          {asString(g.label)}
                        </div>
                        <div className="text-[12px] text-neutral-700">
                          {num(g.count)} topics · avg {num(g.averageScore)}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {asArray<Obj>(g.topics)
                          .slice(0, 8)
                          .map((t) => (
                            <TopicChip
                              key={asString(t.slug)}
                              t={t}
                              onClick={() => pick(asString(t.slug))}
                            />
                          ))}
                      </div>
                    </Row>
                  ))}
                </div>
              ) : (
                <Empty text="Groupings could not be loaded." />
              ))}

            {/* ALL TOPICS */}
            {lens === "topics" && (
              <div>
                <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <input
                    value={qDraft}
                    onChange={(e) => setQDraft(e.target.value)}
                    placeholder="Search topics…"
                    className="rounded-full bg-white px-3 py-1.5 text-[13px] font-bold outline-none"
                    style={border}
                  />
                  <FilterSelect
                    label="Domain"
                    value={filters.domain}
                    onChange={(v) =>
                      setFilters({ ...filters, domain: v, page: 0 })
                    }
                    options={domainGroups.map((g) => [
                      asString(g.key),
                      `${asString(g.label)} (${num(g.count)})`,
                    ])}
                  />
                  <FilterSelect
                    label="Level"
                    value={filters.level}
                    onChange={(v) =>
                      setFilters({ ...filters, level: v, page: 0 })
                    }
                    options={asArray<Obj>(model?.levels).map((l) => [
                      asString(l.id),
                      asString(l.label),
                    ])}
                  />
                  <FilterSelect
                    label="Sort"
                    value={filters.sort}
                    allowEmpty={false}
                    onChange={(v) =>
                      setFilters({ ...filters, sort: v, page: 0 })
                    }
                    options={[
                      ["foundation", "PageRank"],
                      ["bridge", "Betweenness"],
                      ["name", "Name"],
                      ["recent", "Recent"],
                    ]}
                  />
                </div>
                {items.length ? (
                  <div>
                    {items.map((c) => (
                      <button
                        key={asString(c.slug)}
                        type="button"
                        onClick={() => pick(asString(c.slug))}
                        className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-black/[.04]"
                        style={{
                          borderBottom: `1px solid ${LINE}`,
                          backgroundColor:
                            sel === c.slug ? `${YELLOW}55` : undefined,
                        }}
                      >
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              LEVEL_COLOR[asString(c.level)] ?? CARD,
                            border: `1.5px solid ${INK}`,
                          }}
                        />
                        <span
                          className="w-56 shrink-0 truncate text-[13px] font-black"
                          style={{ fontFamily: DISPLAY_FONT }}
                        >
                          {asString(c.name)}
                        </span>
                        <span className="hidden min-w-0 flex-1 truncate text-[13px] text-neutral-800 md:block">
                          {asString(c.verdict)}
                        </span>
                        <span className="ml-auto shrink-0 text-[12px] font-bold text-neutral-700">
                          {LEVEL_LABEL[asString(c.level)] ?? c.level} ·{" "}
                          {num(c.score)}
                        </span>
                      </button>
                    ))}
                    <div className="flex items-center justify-between pt-3">
                      <Btn
                        onClick={() =>
                          setFilters({
                            ...filters,
                            page: Math.max(0, filters.page - 1),
                          })
                        }
                        disabled={filters.page === 0}
                      >
                        Previous
                      </Btn>
                      <span className="text-[13px] font-bold text-neutral-800">
                        {filters.page * PAGE + 1}–
                        {filters.page * PAGE + items.length} of {total}
                      </span>
                      <Btn
                        onClick={() =>
                          setFilters({ ...filters, page: filters.page + 1 })
                        }
                        disabled={(filters.page + 1) * PAGE >= total}
                      >
                        Next
                      </Btn>
                    </div>
                  </div>
                ) : (
                  <Empty text="No topics match these filters." />
                )}
              </div>
            )}

            {/* PATHS */}
            {lens === "paths" && (
              <div>
                <p className="mb-3 text-[13px] text-neutral-800">
                  Pick two topics to see the shortest path through real graph
                  relationships. Each hop says whether it is a foundation
                  dependency (builds on) or an association (related). It glows
                  on the constellation. A path shows connection, not skill.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <RouteIcon size={15} />
                  <TopicSelect
                    value={pathFrom}
                    onChange={setPathFrom}
                    nodes={nodes}
                    placeholder="From…"
                  />
                  <ChevronRight size={14} strokeWidth={3} />
                  <TopicSelect
                    value={pathTo}
                    onChange={setPathTo}
                    nodes={nodes}
                    placeholder="To…"
                  />
                  <Btn
                    onClick={() => void findPath()}
                    bg={YELLOW}
                    disabled={!pathFrom || !pathTo}
                  >
                    Find path
                  </Btn>
                  {(pathRes || pathErr) && (
                    <Btn
                      onClick={() => {
                        setPathRes(null);
                        setPathErr(null);
                      }}
                    >
                      Clear
                    </Btn>
                  )}
                </div>
                {pathRes && (
                  <div className="mt-3 text-[13px] leading-5">
                    {asArray<Obj>(pathRes.segments).length > 0 ? (
                      <ol className="space-y-1">
                        {asArray<Obj>(pathRes.segments).map((sg, i) => (
                          <li key={i} className="font-bold">
                            {asString(sg.fromName)}{" "}
                            <span
                              className="rounded-full px-2 py-0.5 text-[11px] font-black"
                              style={{
                                backgroundColor:
                                  sg.type === "BUILDS_ON" ? SKY : LAVENDER,
                                ...border,
                              }}
                            >
                              {sg.type === "BUILDS_ON"
                                ? "builds on"
                                : "related to"}
                            </span>{" "}
                            {asString(sg.toName)}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="font-bold">{asString(pathRes.sentence)}</p>
                    )}
                    <span className="font-semibold text-neutral-700">
                      ({num(pathRes.hops)} hops)
                    </span>
                  </div>
                )}
                {pathErr && (
                  <p
                    className="mt-3 text-[13px] font-bold"
                    style={{ color: CORAL }}
                  >
                    {pathErr}
                  </p>
                )}
              </div>
            )}

            {/* UNDER THE HOOD */}
            {lens === "hood" && (
              <div className="space-y-4">
                <p className="text-[13px] leading-5 text-neutral-800">
                  FalkorDB runs the graph algorithms over the topic taxonomy, a
                  model judges depth from cited evidence, and rules keep it
                  honest. Centrality describes graph structure; it does not
                  prove expertise.
                </p>
                <div>
                  {asArray<Obj>(algos?.algorithms).map((a) => (
                    <AlgoRow key={asString(a.id)} a={a} onPick={pick} />
                  ))}
                </div>
                {!algos && (
                  <Empty text="Algorithm details could not be loaded." />
                )}
                <Fold title="How scores are decided">
                  <div className="grid gap-6 lg:grid-cols-2">
                    <Block title="Baseline components (capped at 100)">
                      <div className="space-y-1.5">
                        {asArray<Obj>(model?.scoring?.baselineComponents).map(
                          (c) => (
                            <div
                              key={asString(c.id)}
                              className="flex items-center gap-2 text-[13px]"
                            >
                              <span className="w-44 shrink-0 font-black">
                                {humanize(asString(c.id))}
                              </span>
                              <div
                                className="h-2.5 flex-1 overflow-hidden rounded-full"
                                style={{
                                  backgroundColor: CARD,
                                  border: `1.5px solid ${INK}`,
                                }}
                              >
                                <div
                                  className="h-full"
                                  style={{
                                    width: `${(num(c.max) / 20) * 100}%`,
                                    backgroundColor: SKY,
                                  }}
                                />
                              </div>
                              <span className="w-8 text-right font-bold">
                                {num(c.max)}
                              </span>
                            </div>
                          ),
                        )}
                      </div>
                    </Block>
                    <Block title="Guard-rails">
                      <ul className="space-y-1.5">
                        {asArray<string>(model?.scoring?.guardRails).map(
                          (g, i) => (
                            <li
                              key={i}
                              className="pl-3 text-[13px] leading-5 text-neutral-900"
                              style={{ borderLeft: `3px solid ${LINE}` }}
                            >
                              {g}
                            </li>
                          ),
                        )}
                      </ul>
                    </Block>
                  </div>
                </Fold>
              </div>
            )}
          </div>
        </section>
      </main>

      <button
        type="button"
        onClick={() =>
          asideRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          })
        }
        className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full px-4 py-3 text-[13px] font-black xl:hidden"
        style={{ backgroundColor: YELLOW, ...border, boxShadow: shadow(3) }}
      >
        <MessageCircle size={16} /> Ask
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* GOAL MODULE (compact "Set a goal" row; result opens on the /goal page)     */
/* -------------------------------------------------------------------------- */

function GoalModule({
  wish,
  onWish,
  busy,
  err,
  help,
  disabledReason,
  onSubmit,
  onSuggest,
  onDismissHelp,
}: {
  wish: string;
  onWish: (v: string) => void;
  busy: boolean;
  err: string | null;
  help: Obj | null;
  disabledReason: string | null;
  onSubmit: () => void;
  onSuggest: (name: string) => void;
  onDismissHelp: () => void;
}) {
  const locked = !!disabledReason;
  const ready = wish.trim().length >= 3 && !busy && !locked;
  const suggestions = asArray<Obj>(help?.suggestions).slice(0, 8);

  return (
    <div className="mt-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onSubmit();
        }}
        className="flex flex-col gap-2 rounded-2xl px-3 py-2 sm:flex-row sm:items-center"
        style={{ backgroundColor: WHITE, ...border, boxShadow: shadow(2) }}
      >
        <span
          className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-black"
          style={{ fontFamily: DISPLAY_FONT }}
        >
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full"
            style={{ backgroundColor: YELLOW, ...border }}
          >
            <Target size={14} aria-hidden />
          </span>
          Set a goal
        </span>
        <input
          value={wish}
          onChange={(e) => onWish(e.target.value)}
          maxLength={500}
          disabled={busy || locked}
          placeholder={
            locked
              ? disabledReason
              : "e.g. I want to improve my frontend engineering skills"
          }
          aria-label="Describe the goal you want"
          className="min-w-0 flex-1 rounded-full px-4 py-1.5 text-[13px] font-semibold outline-none disabled:opacity-60"
          style={{ backgroundColor: PAPER, ...border }}
        />
        <button
          type="submit"
          disabled={!ready}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-black transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
          style={{ backgroundColor: YELLOW, ...border }}
        >
          {busy ? (
            <>
              <RefreshCw size={13} className="animate-spin" /> Reading your
              graph…
            </>
          ) : (
            <>
              Build my goal <ChevronRight size={14} strokeWidth={3} />
            </>
          )}
        </button>
      </form>

      {err && (
        <p className="mt-2 text-[13px] font-bold" style={{ color: CORAL }}>
          {err}
        </p>
      )}

      {help && (
        <div
          className="mt-2 rounded-2xl p-3"
          style={{
            backgroundColor: LAVENDER,
            ...border,
            animation: "oslide .25s ease-out both",
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-[13px] font-bold leading-5">
              {asString(help.message, "Name a more specific topic or area.")}
            </p>
            <button
              type="button"
              onClick={onDismissHelp}
              aria-label="Dismiss"
              className="shrink-0 rounded-full p-1"
              style={{ backgroundColor: WHITE, ...border }}
            >
              <X size={12} />
            </button>
          </div>
          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] font-black text-neutral-800">
                Topics in your graph:
              </span>
              {suggestions.map((s) => (
                <button
                  key={asString(s.slug)}
                  type="button"
                  onClick={() => onSuggest(asString(s.name ?? s.slug))}
                  className="rounded-full px-2.5 py-0.5 text-[12px] font-bold transition-transform hover:-translate-y-0.5"
                  style={{ backgroundColor: WHITE, ...border }}
                >
                  {asString(s.name ?? s.slug)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* RUN MINI (inline radar while analysing)                                    */
/* -------------------------------------------------------------------------- */

function RunMini({
  job,
  step,
  model,
}: {
  job: Obj | null;
  step: number;
  model: Obj | null;
}) {
  const pct = num(job?.percent);
  const pipeline = asArray<Obj>(model?.pipeline);
  const events = asArray<Obj>(job?.events)
    .filter((e) => e.detail?.topic)
    .slice(-10);
  return (
    <div
      className="flex items-center gap-3 rounded-2xl py-1.5 pl-2 pr-4"
      style={{ backgroundColor: INK, color: PAPER, ...border }}
    >
      <svg viewBox="0 0 80 80" className="h-14 w-14 shrink-0" aria-hidden>
        <circle
          cx="40"
          cy="40"
          r="36"
          fill="none"
          stroke={PAPER}
          strokeOpacity=".3"
          strokeDasharray="3 4"
        />
        <circle
          cx="40"
          cy="40"
          r="20"
          fill="none"
          stroke={PAPER}
          strokeOpacity=".25"
          strokeDasharray="3 4"
        />
        <g
          style={{
            transformOrigin: "40px 40px",
            animation: "osweep 2.6s linear infinite",
          }}
        >
          <path
            d="M40 40 L76 40 A36 36 0 0 0 66 15 Z"
            fill={YELLOW}
            opacity=".35"
          />
          <line
            x1="40"
            y1="40"
            x2="76"
            y2="40"
            stroke={YELLOW}
            strokeWidth="2"
          />
        </g>
        {events.map((e, i) => {
          const h = hash(asString(e.detail?.topic));
          const a = (h % 360) * (Math.PI / 180);
          const r = 8 + (h % 26);
          return (
            <circle
              key={i}
              cx={40 + Math.cos(a) * r}
              cy={40 + Math.sin(a) * r}
              r="2.6"
              fill={i % 2 ? CORAL : SKY}
              style={{
                transformOrigin: `${40 + Math.cos(a) * r}px ${40 + Math.sin(a) * r}px`,
                animation: "opop .5s cubic-bezier(.2,1.4,.4,1) both",
              }}
            />
          );
        })}
      </svg>
      <div className="min-w-[170px]">
        <div
          className="text-[13px] font-black"
          style={{ animation: "oblink 1.2s ease-in-out infinite" }}
        >
          {asString(job?.stageLabel, "Scanning")}… {pct}%
        </div>
        <div
          className="mt-1.5 h-2 overflow-hidden rounded-full"
          style={{ backgroundColor: "#2a2d2a" }}
        >
          <div
            className="h-full transition-all duration-700"
            style={{
              width: `${pct}%`,
              backgroundColor: YELLOW,
              backgroundImage:
                "repeating-linear-gradient(45deg, rgba(16,18,16,.3) 0 6px, transparent 6px 12px)",
              backgroundSize: "24px 24px",
              animation: "ostripe .8s linear infinite",
            }}
          />
        </div>
        {pipeline.length > 0 && (
          <div className="mt-1.5 flex gap-1">
            {pipeline.map((s, i) => (
              <div
                key={asString(s.id)}
                title={asString(s.title)}
                className="h-1.5 flex-1 rounded-full"
                style={{
                  backgroundColor:
                    step > i ? GREEN : step === i ? YELLOW : "#3a3d3a",
                }}
              />
            ))}
          </div>
        )}
        <div className="mt-1 text-[11px] font-bold text-neutral-300">
          {num(job?.progress?.assessed)}/{num(job?.progress?.proposed)} judged
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* ALGORITHM ROW                                                              */
/* -------------------------------------------------------------------------- */

function AlgoRow({ a, onPick }: { a: Obj; onPick: (slug: string) => void }) {
  const st = a.status as Obj | null;
  const f = (a.findings ?? {}) as Obj;
  const engineBg =
    a.engine === "falkordb"
      ? SKY
      : a.engine === "cypher"
        ? LAVENDER
        : a.engine === "index"
          ? YELLOW
          : CARD;
  return (
    <div className="py-3" style={{ borderBottom: `1px solid ${LINE}` }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className="text-[14px] font-black"
          style={{ fontFamily: DISPLAY_FONT }}
        >
          {asString(a.name)}
        </span>
        <Chip text={asString(a.engine)} background={engineBg} />
        {st && (
          <span className="flex items-center gap-2 text-[12px] font-bold text-neutral-800">
            <span
              className="relative inline-block h-2 w-24 overflow-hidden rounded-full"
              style={{ backgroundColor: CARD, border: `1.5px solid ${INK}` }}
            >
              <span
                className="absolute inset-y-0 left-0"
                style={{
                  width: `${num(st.coverage) * 100}%`,
                  backgroundColor: st.computed ? GREEN : CORAL,
                }}
              />
            </span>
            {Math.round(num(st.coverage) * 100)}% coverage
          </span>
        )}
      </div>
      <p className="mt-1 text-[13px] leading-5 text-neutral-800">
        {asString(a.why)}
      </p>
      {a.id === "pagerank" && asArray<Obj>(f.topFoundations).length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {asArray<Obj>(f.topFoundations).map((x) => (
            <TopicChip
              key={asString(x.topic?.slug)}
              t={x.topic}
              onClick={() => onPick(asString(x.topic?.slug))}
            />
          ))}
        </div>
      )}
      {a.id === "betweenness" && asArray<Obj>(f.topBridges).length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {asArray<Obj>(f.topBridges).map((x) => (
            <TopicChip
              key={asString(x.topic?.slug)}
              t={x.topic}
              onClick={() => onPick(asString(x.topic?.slug))}
            />
          ))}
        </div>
      )}
      {a.id === "label_propagation" && (
        <p className="mt-1 text-[13px] font-bold">
          {num(f.communities)} communities
          {f.largest
            ? ` · largest: ${asString(f.largest.label)} (${num(f.largest.count)})`
            : ""}
        </p>
      )}
      {a.id === "wcc" && (
        <p className="mt-1 text-[13px] font-bold">
          {num(f.components)} components · main body {num(f.mainSize)} topics
        </p>
      )}
      <Fold title="Call and how to read it" small>
        <code
          className="block break-all rounded-lg p-2 text-[12px] leading-4"
          style={{
            backgroundColor: WHITE,
            ...border,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          {asString(a.call)}
        </code>
        <p className="mt-1.5 text-[13px] leading-5 text-neutral-900">
          {asString(a.howToRead)}
        </p>
      </Fold>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* GRAPH VIEW (dark constellation, fills its container)                       */
/* -------------------------------------------------------------------------- */

const radiusOf = (n: Obj) => Math.min(24, Math.max(9, num(n.size, 16) * 0.5));

function nodeFill(n: Obj, colorBy: string): string {
  if (!n.assessed) return "#D9D5CA";
  const byLevel = LEVEL_COLOR[asString(n.level)] ?? CARD;
  if (colorBy === "level") return byLevel;
  const v =
    colorBy === "domain"
      ? (n.domain ?? n.domainLabel)
      : (n.cluster ??
        n.clusterId ??
        n.community ??
        n.communityId ??
        n.communityLabel);
  if (v == null || v === "") return byLevel;
  return PALETTE[hash(asString(v)) % PALETTE.length];
}

function TopicGraph({
  nodes,
  edges,
  pos,
  colorBy,
  selected,
  glow,
  pathIds,
  running,
  onSelect,
}: {
  nodes: Obj[];
  edges: Obj[];
  pos: Map<string, { x: number; y: number }>;
  colorBy: string;
  selected: string | null;
  glow: Set<string>;
  pathIds: Set<string>;
  running: boolean;
  onSelect: (n: Obj) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const byId = useMemo(
    () => new Map(nodes.map((n) => [asString(n.id), n] as [string, Obj])),
    [nodes],
  );
  const hoverSet = useMemo(() => {
    if (!hover) return null;
    const s = new Set<string>([hover]);
    for (const e of edges) {
      if (e.source === hover) s.add(asString(e.target));
      if (e.target === hover) s.add(asString(e.source));
    }
    return s;
  }, [hover, edges]);

  return (
    <svg
      viewBox={`0 0 ${GW} ${GH}`}
      className="absolute inset-0 block h-full w-full"
      role="group"
      aria-label="Constellation of your topics"
    >
      <defs>
        <pattern
          id="dgrid"
          width="32"
          height="32"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="1" cy="1" r="1" fill={INK} opacity=".13" />
        </pattern>
        <marker
          id="tarrow"
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
      <rect width={GW} height={GH} fill="url(#dgrid)" />

      {edges.map((e) => {
        const a = pos.get(asString(e.source));
        const b = pos.get(asString(e.target));
        const na = byId.get(asString(e.source));
        const nb = byId.get(asString(e.target));
        if (!a || !b || !na || !nb) return null;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const ra = radiusOf(na) + 3;
        const rb = radiusOf(nb) + 6;
        const onPath =
          pathIds.has(asString(e.source)) && pathIds.has(asString(e.target));
        const touch = hover && (e.source === hover || e.target === hover);
        const op = hoverSet ? (touch ? 0.95 : 0.06) : onPath ? 1 : 0.4;
        return (
          <line
            key={asString(e.id)}
            x1={a.x + (dx / d) * ra}
            y1={a.y + (dy / d) * ra}
            x2={b.x - (dx / d) * rb}
            y2={b.y - (dy / d) * rb}
            stroke={onPath ? CORAL : INK}
            strokeWidth={onPath ? 4 : touch ? 2.5 : 1.5}
            strokeDasharray={e.directed ? undefined : "4 5"}
            opacity={op}
            markerEnd={e.directed ? "url(#tarrow)" : undefined}
          />
        );
      })}

      {nodes.map((n, i) => {
        const p = pos.get(asString(n.id));
        if (!p) return null;
        const r = radiusOf(n);
        const id = asString(n.id);
        const sel = selected === n.slug;
        const dim = hoverSet ? !hoverSet.has(id) : false;
        const roles = asArray<string>(n.roles);
        const showLabel = n.assessed || hover === id;
        const above = nodes.length > 8 && i % 2 === 1;
        return (
          <g
            key={id}
            tabIndex={0}
            role="button"
            aria-label={`Topic: ${asString(n.label)}`}
            aria-pressed={sel}
            onClick={() => onSelect(n)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                onSelect(n);
              }
            }}
            onMouseEnter={() => setHover(id)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(id)}
            onBlur={() => setHover(null)}
            style={{
              cursor: n.assessed ? "pointer" : "default",
              opacity: dim ? 0.15 : 1,
              transition: "opacity 260ms ease",
              animation: `ofloat ${5 + (i % 4)}s ${-(i % 7) * 0.8}s ease-in-out infinite`,
            }}
          >
            {glow.has(id) && (
              <>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r + 11}
                  fill="none"
                  stroke={YELLOW}
                  strokeWidth="3.5"
                />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r}
                  fill="none"
                  stroke={YELLOW}
                  strokeWidth="2"
                  style={{ animation: "oring 1.8s ease-out infinite" }}
                />
              </>
            )}
            {running && n.assessed && (
              <circle
                cx={p.x}
                cy={p.y}
                r={r}
                fill="none"
                stroke={SKY}
                strokeWidth="2"
                style={{
                  animation: `oring 2.4s ${(i % 6) * 0.35}s ease-out infinite`,
                }}
              />
            )}
            {roles.includes("foundation") && (
              <circle
                cx={p.x}
                cy={p.y}
                r={r + 6}
                fill="none"
                stroke={SKY}
                strokeWidth="3.5"
              />
            )}
            {roles.includes("bridge") && (
              <circle
                cx={p.x}
                cy={p.y}
                r={r + (roles.includes("foundation") ? 12 : 6)}
                fill="none"
                stroke={CORAL}
                strokeWidth="3"
                strokeDasharray="4 3"
              />
            )}
            {pathIds.has(id) && (
              <circle
                cx={p.x}
                cy={p.y}
                r={r + 17}
                fill="none"
                stroke={CORAL}
                strokeWidth="3"
              />
            )}
            <circle
              cx={p.x}
              cy={p.y}
              r={r}
              fill={nodeFill(n, colorBy)}
              stroke={PAPER}
              strokeWidth={sel ? 4.5 : 2.5}
              style={{
                stroke: INK,
                filter: "drop-shadow(2px 3px 0 rgba(16,18,16,.9))",
                transition: "stroke-width .25s ease",
              }}
              strokeDasharray={n.assessed ? undefined : "4 3"}
            />
            {showLabel && (
              <text
                x={p.x}
                y={above ? p.y - r - 10 : p.y + r + 16}
                textAnchor="middle"
                fontSize={n.assessed ? 13 : 11}
                fontWeight={n.assessed ? 800 : 600}
                fontFamily={BODY_FONT}
                fill={PAPER}
                style={{
                  fill: INK,
                  paintOrder: "stroke",
                  stroke: "#F8F6F1",
                  strokeWidth: 5,
                  strokeLinejoin: "round",
                }}
              >
                {cut(asString(n.label), 22)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* TOPIC PANEL: the explanation, in the order a judge asks the questions      */
/*   verdict -> capabilities -> implementations -> safeguards -> unproven     */
/*   -> graph relationships -> raw evidence                                   */
/* -------------------------------------------------------------------------- */

function TopicPanel({
  slug,
  card,
  detail,
  loading,
  err,
  running,
  onReanalyze,
  onPick,
  onAsk,
  onClose,
  onEvidence,
}: {
  slug: string;
  card: Obj | null;
  detail: Obj | null;
  loading: boolean;
  err: string | null;
  running: boolean;
  onReanalyze: () => void;
  onPick: (slug: string) => void;
  onAsk: (name: string) => void;
  onClose: () => void;
  onEvidence: () => void;
}) {
  const t = (detail?.topic ?? card ?? {}) as Obj;
  const sc = (detail?.scoring ?? {}) as Obj;
  const g = (detail?.graph ?? {}) as Obj;
  const level = asString(t.level);
  const band = asArray<number>(sc.band);
  const name = asString(t.name) || humanize(slug);
  const capPaths = asArray<Obj>(detail?.capabilityPaths);
  const impls = asArray<Obj>(detail?.implementations);
  const safeguards = asArray<string>(detail?.safeguards);
  const limits = limitationsOf(detail);
  const demoCount = capPaths.reduce((n, p) => n + num(p.demonstrations), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Chip
            text={LEVEL_LABEL[level] ?? "Topic"}
            background={LEVEL_COLOR[level] ?? CARD}
            color={level && level !== "none" ? WHITE : INK}
          />
          <h3
            className="mt-2 break-words text-[20px] font-black leading-tight"
            style={{ fontFamily: DISPLAY_FONT }}
          >
            {name}
          </h3>
          <p className="mt-0.5 text-[13px] font-semibold text-neutral-800">
            {asString(t.domainLabel)} · {asString(t.authenticityLabel)} ·{" "}
            {asString(t.confidence)} confidence
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="shrink-0 rounded-full p-1.5"
          style={{ backgroundColor: WHITE, ...border }}
        >
          <X size={14} />
        </button>
      </div>

      {/* jump to the full graph evidence section below the workspace */}
      <button
        type="button"
        onClick={onEvidence}
        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-[13px] font-black transition-transform hover:-translate-y-0.5"
        style={{ backgroundColor: YELLOW, ...border }}
      >
        <span>See the evidence map behind this rating</span>
        <ChevronRight size={14} strokeWidth={3} />
      </button>

      {loading && <InlineLoading label="Reading topic…" />}
      {err && (
        <p className="text-[13px] font-bold" style={{ color: CORAL }}>
          {err}
        </p>
      )}

      {detail && (
        <>
          <p className="text-[13px] leading-5 text-neutral-900">
            {asString(detail.verdict)}
          </p>

          <div>
            <div className="flex items-center justify-between text-[13px] font-black">
              <span>Score {num(sc.score)}</span>
              {band.length === 2 && (
                <span className="text-[13px] text-neutral-700">
                  band {band[0]}–{band[1]}
                </span>
              )}
            </div>
            <div
              className="mt-1.5 h-3 overflow-hidden rounded-full"
              style={{ backgroundColor: CARD, border: `1.5px solid ${INK}` }}
            >
              <div
                className="h-full"
                style={{
                  width: `${num(sc.score)}%`,
                  backgroundColor: LEVEL_COLOR[level] ?? SKY,
                }}
              />
            </div>
            <p className="mt-1.5 text-[12px] leading-4 text-neutral-700">
              Baseline {num(sc.baseline?.score)} ({asString(sc.baseline?.level)}
              ), adjustment {num(sc.adjustment) >= 0 ? "+" : ""}
              {num(sc.adjustment)}. Decided by {asString(sc.decidedBy)}. File
              and commit counts are inputs to the baseline, not proof of depth.
            </p>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <MiniStat label="Files" value={num(t.evidence?.files)} />
            <MiniStat label="Commits" value={num(t.evidence?.commits)} />
            <MiniStat label="Repos" value={num(t.evidence?.repos)} />
            <MiniStat label="Days" value={num(t.evidence?.activeDays)} />
          </div>

          {/* 1. why Pathway believes this */}
          <Block title="Why Pathway believes this">
            <p className="text-[13px] leading-5 text-neutral-900">
              {asString(detail.rationale) || "No rationale was stored."}
            </p>
          </Block>

          {/* 2. capabilities (taxonomy mapping + this developer's demonstrations) */}
          <Block
            title={`Capabilities demonstrated${
              capPaths.length
                ? ` (${demoCount} demonstration${demoCount === 1 ? "" : "s"})`
                : ""
            }`}
          >
            {capPaths.length ? (
              <div className="space-y-2">
                {capPaths.slice(0, 6).map((p, i) => {
                  const d = num(p.demonstrations);
                  return (
                    <div
                      key={`${asString(p.capabilityId)}-${i}`}
                      className="pl-3"
                      style={{
                        borderLeft: `3px solid ${d > 0 ? GREEN : LINE}`,
                      }}
                    >
                      <div className="flex items-center justify-between gap-2 text-[13px] font-black">
                        <span>{asString(p.capability)}</span>
                        <span className="text-[12px] text-neutral-700">
                          {d} demo{d === 1 ? "" : "s"}
                          {p.weight != null
                            ? ` · weight ${fix(p.weight, 2)}`
                            : ""}
                        </span>
                      </div>
                      {p.reason && (
                        <p className="text-[12px] leading-4 text-neutral-800">
                          {asString(p.reason)}
                        </p>
                      )}
                    </div>
                  );
                })}
                <p className="text-[12px] leading-4 text-neutral-700">
                  The mapping to a capability is taxonomy. Only the
                  demonstration count reflects this developer's actual work.
                </p>
              </div>
            ) : (
              <p className="text-[13px] leading-5 text-neutral-800">
                No capability is linked to this topic in the graph.
              </p>
            )}
          </Block>

          {/* 3. concrete implementations */}
          <Block
            title={`What was built${impls.length ? ` (${impls.length})` : ""}`}
          >
            {impls.length ? (
              <ul className="space-y-2">
                {impls.slice(0, 5).map((im, i) => (
                  <li key={i} className="text-[13px] leading-5">
                    <span className="font-bold">{asString(im.what)}</span>
                    {(im.path || im.repository) && (
                      <div className="break-all text-[12px] text-neutral-700">
                        {im.permalink ? (
                          <a
                            href={asString(im.permalink)}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                          >
                            {cut(asString(im.path || im.repository), 80)}
                          </a>
                        ) : (
                          cut(asString(im.path || im.repository), 80)
                        )}
                        {im.ref ? ` · ${asString(im.ref)}` : ""}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] leading-5 text-neutral-800">
                The assessment cites no specific implementation.
              </p>
            )}
          </Block>

          {safeguards.length > 0 && (
            <Block title="Hardening observed">
              <Bullets items={safeguards} ok />
            </Block>
          )}
          {asArray<string>(detail.strengths).length > 0 && (
            <Block title="Strengths">
              <Bullets items={asArray<string>(detail.strengths)} ok />
            </Block>
          )}

          {/* 4. what is NOT established */}
          <Block title="What remains unproven">
            {limits.length ? (
              <Bullets items={limits} />
            ) : (
              <p className="text-[13px] leading-5 text-neutral-800">
                The assessment lists no explicit limitations.
              </p>
            )}
          </Block>

          {asArray<Obj>(detail.approaches).length > 0 && (
            <Fold title={`Approaches (${asArray(detail.approaches).length})`}>
              <div className="space-y-2.5">
                {asArray<Obj>(detail.approaches).map((a, i) => (
                  <div
                    key={i}
                    className="pl-3"
                    style={{
                      borderLeft: `3px solid ${LEVEL_COLOR[asString(a.depth)] ?? LINE}`,
                    }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <span className="text-[13px] font-black">
                        {asString(a.name ?? a.slug)}
                      </span>
                      <span className="text-[12px] font-bold text-neutral-700">
                        {a.isPrimary ? "primary · " : ""}
                        {LEVEL_LABEL[asString(a.depth)] ?? asString(a.depth)}
                      </span>
                    </div>
                    {a.howImplemented && (
                      <p className="text-[13px] leading-5 text-neutral-900">
                        {asString(a.howImplemented)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Fold>
          )}

          {/* 5. graph relationships, kept separate by meaning */}
          <Fold title="Where it sits in the graph" open>
            <div className="space-y-2 text-[13px]">
              <div className="flex flex-wrap gap-1.5">
                <Chip
                  text={`PageRank ${fix(g.metrics?.foundationRank)}`}
                  background={SKY}
                />
                <Chip
                  text={`Betweenness ${fix(g.metrics?.bridgeScore)}`}
                  background={CORAL}
                />
              </div>
              <RefList
                title="Builds on (foundation dependency)"
                list={asArray<Obj>(g.foundations)}
                onPick={onPick}
              />
              <RefList
                title="Built on top of it"
                list={asArray<Obj>(g.unlocks)}
                onPick={onPick}
              />
              <RefList
                title="Related (association, not prerequisite)"
                list={asArray<Obj>(g.related)}
                onPick={onPick}
              />
              {g.community && (
                <RefList
                  title="Community peers"
                  list={asArray<Obj>(g.community.peers)}
                  onPick={onPick}
                />
              )}
              {!asArray(g.foundations).length &&
                !asArray(g.unlocks).length &&
                !asArray(g.related).length && (
                  <p className="text-[13px] leading-5 text-neutral-800">
                    The graph records no BUILDS_ON or RELATED_TOPIC edge for
                    this topic.
                  </p>
                )}
              <p className="text-[12px] leading-4 text-neutral-700">
                A relationship shows how topics connect. It does not prove the
                developer has the skill.
              </p>
            </div>
          </Fold>

          {num(detail.evidence?.total) > 0 && (
            <Fold title={`Evidence cited (${num(detail.evidence.total)})`}>
              <div className="space-y-2">
                {Object.entries(
                  (detail.evidence.byKind ?? {}) as Record<string, Obj[]>,
                ).map(([kind, list]) =>
                  list.length ? (
                    <div key={kind}>
                      <div className="text-[12px] font-black text-neutral-700">
                        {humanize(kind)} · {list.length}
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {list.slice(0, 5).map((e, i) => {
                          const text = cut(
                            asString(
                              e.path ??
                                e.title ??
                                e.subject ??
                                e.technique ??
                                e.label ??
                                e.ref ??
                                e.key,
                            ),
                            90,
                          );
                          return (
                            <li
                              key={i}
                              className="break-all text-[12px] leading-4 text-neutral-900"
                            >
                              {e.permalink ? (
                                <a
                                  href={asString(e.permalink)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline"
                                >
                                  {text}
                                </a>
                              ) : (
                                text
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null,
                )}
              </div>
            </Fold>
          )}

          <div className="flex flex-wrap gap-2">
            <Btn onClick={() => onAsk(name)} bg={LAVENDER}>
              <MessageCircle size={13} /> Ask about this
            </Btn>
            <Btn onClick={onReanalyze} bg={YELLOW} disabled={running}>
              <RefreshCw size={13} className={running ? "animate-spin" : ""} />{" "}
              Re-judge
            </Btn>
          </div>
        </>
      )}
    </div>
  );
}

function RefList({
  title,
  list,
  onPick,
}: {
  title: string;
  list: Obj[];
  onPick: (slug: string) => void;
}) {
  if (!list.length) return null;
  return (
    <div>
      <div className="text-[12px] font-black text-neutral-700">{title}</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {list.slice(0, 8).map((r, i) => {
          const slug = asString(r.slug);
          const lvl = r.level ?? r.developerLevel;
          const assessed =
            r.assessed !== false && lvl != null && lvl !== "none";
          return (
            <button
              key={`${slug}-${i}`}
              type="button"
              title={asString(r.reason)}
              onClick={() => (assessed ? onPick(slug) : undefined)}
              className="rounded-full px-2.5 py-0.5 text-[12px] font-bold"
              style={{
                backgroundColor: assessed ? WHITE : CARD,
                border: `2px ${assessed ? "solid" : "dashed"} ${INK}`,
                cursor: assessed ? "pointer" : "default",
              }}
            >
              {asString(r.name ?? r.slug)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Bullets({ items, ok = false }: { items: string[]; ok?: boolean }) {
  return (
    <ul className="space-y-1.5">
      {items.slice(0, 6).map((s, i) => (
        <li key={i} className="flex items-start gap-2 text-[13px] leading-5">
          {ok ? (
            <CheckCircle2 size={15} color={GREEN} className="mt-0.5 shrink-0" />
          ) : (
            <Flame size={15} color={CORAL} className="mt-0.5 shrink-0" />
          )}
          <span>{s}</span>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* SMALL PIECES                                                               */
/* -------------------------------------------------------------------------- */

function Row({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-6"
      style={{ borderBottom: `1px solid ${LINE}` }}
    >
      {children}
    </div>
  );
}

function StatPill({ value, label }: { value: number; label: string }) {
  return (
    <span
      className="inline-flex items-baseline gap-1.5 rounded-full px-3 py-1"
      style={{ backgroundColor: WHITE, ...border }}
    >
      <span
        className="text-[16px] font-black leading-none"
        style={{ fontFamily: DISPLAY_FONT }}
      >
        {value.toLocaleString()}
      </span>
      <span className="text-[12px] font-bold text-neutral-800">{label}</span>
    </span>
  );
}

function Fold({
  title,
  children,
  small = false,
  open = false,
}: {
  title: string;
  children: ReactNode;
  small?: boolean;
  open?: boolean;
}) {
  return (
    <details
      className="group"
      open={open}
      style={{
        borderTop: small ? undefined : `1px solid ${LINE}`,
        borderBottom: small ? undefined : `1px solid ${LINE}`,
      }}
    >
      <summary
        className={`flex cursor-pointer items-center gap-1.5 font-black ${small ? "mt-1.5 text-[12px] text-neutral-700" : "py-2.5 text-[13px]"}`}
      >
        <ChevronRight
          size={small ? 12 : 14}
          strokeWidth={3}
          className="transition-transform group-open:rotate-90"
        />
        {title}
      </summary>
      <div className={small ? "pt-1" : "pb-3"}>{children}</div>
    </details>
  );
}

function TopicSelect({
  value,
  onChange,
  nodes,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  nodes: Obj[];
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={placeholder}
      className="max-w-[210px] rounded-full bg-white px-3 py-1.5 text-[13px] font-bold outline-none"
      style={border}
    >
      <option value="">{placeholder}</option>
      {[...nodes]
        .sort((a, b) => asString(a.label).localeCompare(asString(b.label)))
        .map((n) => (
          <option key={asString(n.id)} value={asString(n.slug)}>
            {asString(n.label)}
            {n.assessed ? "" : " (not assessed)"}
          </option>
        ))}
    </select>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allowEmpty = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[][];
  allowEmpty?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="rounded-full bg-white px-3 py-1.5 text-[13px] font-bold outline-none"
      style={border}
    >
      {allowEmpty && <option value="">{label}: all</option>}
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {allowEmpty ? l : `${label}: ${l}`}
        </option>
      ))}
    </select>
  );
}

function TopicChip({ t, onClick }: { t: Obj; onClick: () => void }) {
  const level = asString(t?.level);
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-bold transition-transform hover:-translate-y-0.5"
      style={{ backgroundColor: WHITE, ...border }}
    >
      <span
        className="h-2.5 w-2.5 rounded-full"
        style={{
          backgroundColor: LEVEL_COLOR[level] ?? CARD,
          border: `1.5px solid ${INK}`,
        }}
      />
      {asString(t?.name)}
    </button>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="text-[13px] font-black text-neutral-800">{title}</div>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

function Btn({
  onClick,
  children,
  bg = CARD,
  disabled = false,
}: {
  onClick: () => void;
  children: ReactNode;
  bg?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-black transition-transform hover:-translate-y-0.5 disabled:opacity-50"
      style={{ backgroundColor: bg, color: INK, ...border }}
    >
      {children}
    </button>
  );
}

function Chip({
  text,
  background = CARD,
  color = INK,
}: {
  text: string;
  background?: string;
  color?: string;
}) {
  return (
    <span
      className="inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-black"
      style={{ backgroundColor: background, color, ...border }}
    >
      {text}
    </span>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div
        className="text-[18px] font-black leading-none"
        style={{ fontFamily: DISPLAY_FONT }}
      >
        {value.toLocaleString()}
      </div>
      <div className="mt-0.5 text-[11px] font-bold uppercase text-neutral-700">
        {label}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div
      className="rounded-xl border-2 border-dashed p-5 text-[13px] text-neutral-800"
      style={{ borderColor: LINE }}
    >
      {text}
    </div>
  );
}

function InlineLoading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <RefreshCw size={15} className="animate-spin" />
      <span className="text-[13px] font-bold">{label}</span>
    </div>
  );
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex min-h-screen items-center justify-center p-6"
      style={{
        backgroundColor: PAPER,
        color: INK,
        fontFamily: BODY_FONT,
        fontWeight: 500,
      }}
    >
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */
/* EVIDENCE MAP: plain-English story first, graph second, raw queries last    */
/* Data: GET /api/topics/:slug/graph  +  POST /api/topics/:slug/explain       */
/* -------------------------------------------------------------------------- */

const KIND_COLOR: Record<string, string> = {
  topic: YELLOW,
  capability: SKY,
  demonstration: GREEN,
  experience: PURPLE,
  repository: CORAL,
  topic_neighbor: LAVENDER,
};
const KIND_LABEL: Record<string, string> = {
  topic: "This topic",
  capability: "Skill it covers",
  demonstration: "Real work",
  experience: "Experience",
  repository: "Project",
  topic_neighbor: "Related topic",
};
const KIND_ORDER = [
  "capability",
  "demonstration",
  "experience",
  "repository",
  "topic_neighbor",
];
const REL_PLAIN: Record<string, string> = {
  MAPS_TO: "covers skill",
  OF_CAPABILITY: "shows skill",
  DEMONSTRATES_CAPABILITY: "shows skill",
  IN_REPOSITORY: "lives in",
  BUILDS_ON: "builds on",
  RELATED_TOPIC: "used with",
};
const EW = 780;
const EH = 560;
const RINGS = [105, 180, 250];

const nodeR = (n: Obj | undefined): number => {
  switch (n?.kind) {
    case "topic":
      return 26;
    case "capability":
      return 17;
    case "demonstration":
      return n?.meta?.mission ? 15 : 12;
    case "experience":
      return 13;
    case "repository":
      return 14;
    default:
      return 13;
  }
};

/** Rings by distance from the topic: centre, then outward. */
function evLayout(nodes: Obj[]) {
  const out = new Map<string, { x: number; y: number }>();
  const cx = EW / 2;
  const cy = EH / 2;
  for (let hop = 0; hop <= 3; hop++) {
    const ring = nodes
      .filter((n) => Math.min(3, num(n.hop)) === hop)
      .sort(
        (a, b) =>
          KIND_ORDER.indexOf(asString(a.kind)) -
            KIND_ORDER.indexOf(asString(b.kind)) ||
          asString(a.id).localeCompare(asString(b.id)),
      );
    ring.forEach((n, i) => {
      if (hop === 0) {
        out.set(asString(n.id), { x: cx, y: cy });
        return;
      }
      const a = (i / ring.length) * Math.PI * 2 - Math.PI / 2 + hop * 0.45;
      const r = RINGS[hop - 1];
      out.set(asString(n.id), {
        x: cx + Math.cos(a) * r * 1.35,
        y: cy + Math.sin(a) * r,
      });
    });
  }
  return out;
}

/** One edge, in a sentence a non-engineer can read. */
function relSentence(e: Obj, nm: (id: string) => string): string {
  const a = nm(asString(e.source));
  const b = nm(asString(e.target));
  switch (asString(e.type)) {
    case "MAPS_TO":
      return `${a} is part of the skill “${b}”.`;
    case "OF_CAPABILITY":
    case "DEMONSTRATES_CAPABILITY":
      return `“${a}” is real work that shows the skill “${b}”.`;
    case "IN_REPOSITORY":
      return `“${a}” lives in the project ${b}.`;
    case "BUILDS_ON":
      return `${a} builds on ${b}.`;
    case "RELATED_TOPIC":
      return `${a} is often used together with ${b}.`;
    default:
      return `${a} → ${b}`;
  }
}

/** The five graph algorithms, translated into questions a person would ask. */
const ALGO_PLAIN: Record<
  string,
  { title: string; question: string; read: (a: Obj, d: Obj) => string }
> = {
  pagerank: {
    title: "How foundational is it?",
    question: "Do many other topics depend on this one?",
    read: (_a, d) =>
      num(d.reach?.unlocks) > 0
        ? `${num(d.reach.unlocks)} other topic${num(d.reach.unlocks) === 1 ? " is" : "s are"} built on top of this one.`
        : "Nothing else is built on top of it. It is a specialised skill, not a foundation.",
  },
  betweenness: {
    title: "Does it connect different areas?",
    question: "Does this topic link separate parts of your skills?",
    read: (a) =>
      num(a.value) > 0
        ? `Yes. It links separate areas${a.position ? ` (ranks #${num(a.position)} of ${num(a.of)} of your topics)` : ""}, so it is knowledge that transfers.`
        : "No. It sits inside one area.",
  },
  label_propagation: {
    title: "Which group does it belong to?",
    question: "Which topics are usually used together with it?",
    read: (a) =>
      a.value == null
        ? "It is not part of a group yet."
        : `It belongs to a group of ${num(a.of)} related topics.`,
  },
  wcc: {
    title: "Is it connected to the rest?",
    question: "Is this topic linked to the main web of your skills?",
    read: (a) =>
      a.value == null
        ? "Not computed yet."
        : `It is linked to ${num(a.of)} topics in total.`,
  },
  traversal: {
    title: "How deep is its learning path?",
    question: "What does it stand on, and what stands on it?",
    read: (_a, d) =>
      `Stands on ${num(d.reach?.prerequisites)} foundation${num(d.reach?.prerequisites) === 1 ? "" : "s"}, has ${num(d.reach?.unlocks)} above it and ${num(d.reach?.related)} related.`,
  },
};

function Tile({
  value,
  label,
  hint,
}: {
  value: number | string;
  label: string;
  hint: string;
}) {
  return (
    <div
      className="rounded-xl p-3"
      style={{ backgroundColor: WHITE, ...border }}
    >
      <div
        className="text-[24px] font-black leading-none"
        style={{ fontFamily: DISPLAY_FONT }}
      >
        {value}
      </div>
      <div className="mt-1 text-[13px] font-black">{label}</div>
      <div className="text-[12px] leading-4 text-neutral-700">{hint}</div>
    </div>
  );
}

function TopicGraphEvidence({
  slug,
  onPick,
  onAsk,
}: {
  slug: string;
  onPick: (slug: string) => void;
  onAsk: (question: string) => void;
}) {
  const [data, setData] = useState<Obj | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lit, setLit] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Obj | null>(null);
  const [tech, setTech] = useState(false);
  const [story, setStory] = useState<Obj | null>(null);
  const [storySrc, setStorySrc] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setErr(null);
    setPicked(null);
    setLit(new Set());
    setStory(null);
    setStorySrc("");
    const enc = encodeURIComponent(slug);
    (async () => {
      try {
        const d = await getJson(`/api/topics/${enc}/graph`);
        if (!live) return;
        setData(d);
        // instant, always-available story; the agent upgrades it below
        setStory((d.plain?.story ?? null) as Obj | null);
        setStorySrc("graph");
        setLoading(false);
        setAiBusy(true);
        const r = await call(`/api/topics/${enc}/explain`, "POST", {});
        if (!live) return;
        if (r.ok && r.data.story) {
          setStory(r.data.story as Obj);
          setStorySrc(asString(r.data.source));
        }
      } catch (e) {
        if (live)
          setErr(
            e instanceof Error ? e.message : "Failed to load graph evidence.",
          );
      } finally {
        if (live) {
          setLoading(false);
          setAiBusy(false);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [slug]);

  const nodes = useMemo(() => asArray<Obj>(data?.nodes), [data]);
  const edges = useMemo(() => asArray<Obj>(data?.edges), [data]);
  const pos = useMemo(() => evLayout(nodes), [nodes]);
  const byId = useMemo(
    () => new Map(nodes.map((n) => [asString(n.id), n] as [string, Obj])),
    [nodes],
  );

  // duplicate names ("Retry with exponential backoff" x 9) get numbered
  const names = useMemo(() => {
    const count = new Map<string, number>();
    nodes.forEach((n) => {
      const l = asString(n.label);
      count.set(l, (count.get(l) ?? 0) + 1);
    });
    const seen = new Map<string, number>();
    const out = new Map<string, string>();
    nodes.forEach((n) => {
      const l = asString(n.label);
      if ((count.get(l) ?? 0) > 1) {
        const k = (seen.get(l) ?? 0) + 1;
        seen.set(l, k);
        out.set(asString(n.id), `${l} (${k})`);
      } else out.set(asString(n.id), l);
    });
    return out;
  }, [nodes]);
  const nm = (id: string) => names.get(id) ?? asString(byId.get(id)?.label);

  // picking a node fades everything that is not directly connected to it
  const focus = useMemo(() => {
    if (!picked) return null;
    const pid = asString(picked.id);
    const s = new Set<string>([pid]);
    edges.forEach((e) => {
      if (e.source === pid) s.add(asString(e.target));
      if (e.target === pid) s.add(asString(e.source));
    });
    return s;
  }, [picked, edges]);

  if (loading)
    return (
      <section
        id={EVIDENCE_ID}
        className="mt-6 rounded-2xl p-4"
        style={{ backgroundColor: CARD, ...border }}
      >
        <InlineLoading label="Collecting the evidence behind this rating…" />
      </section>
    );
  if (err || !data)
    return (
      <section
        id={EVIDENCE_ID}
        className="mt-6 rounded-2xl p-4"
        style={{ backgroundColor: CARD, ...border }}
      >
        <p className="text-[13px] font-bold" style={{ color: CORAL }}>
          {err ?? "No evidence available."}
        </p>
      </section>
    );

  const facts = (data.plain?.facts ?? {}) as Obj;
  const builds = asArray<Obj>(data.builds);
  const algos = asArray<Obj>(data.algorithms);
  const trace = asArray<Obj>(data.trace);
  const backedBy = asArray<Obj>(data.backedBy);
  const score = (data.score ?? {}) as Obj;
  const steps = asArray<Obj>(story?.steps);
  const followups = asArray<string>(story?.followups).slice(0, 3);
  const litOn = lit.size > 0;

  return (
    <section
      id={EVIDENCE_ID}
      className="mt-6 scroll-mt-20 rounded-2xl p-4"
      style={{
        backgroundColor: CARD,
        ...border,
        boxShadow: shadow(4),
        animation: "oslide .25s ease-out both",
      }}
    >
      {/* header */}
      <div className="mb-3">
        <p className="text-[12px] font-black uppercase tracking-[.14em] text-neutral-700">
          Evidence map
        </p>
        <h2
          className="text-[22px] font-black leading-tight"
          style={{ fontFamily: DISPLAY_FONT }}
        >
          {asString(data.topic?.name)}
        </h2>
      </div>

      {/* 1. THE AGENT, IN PLAIN ENGLISH */}
      <div
        className="rounded-2xl p-4"
        style={{ backgroundColor: WHITE, ...border }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full"
              style={{ backgroundColor: YELLOW, ...border }}
            >
              <Sparkles size={14} />
            </span>
            <span className="text-[13px] font-black">In plain English</span>
          </div>
          <span className="text-[12px] font-bold text-neutral-700">
            {aiBusy
              ? "Pathway agent is writing this in simple words…"
              : storySrc === "llm"
                ? "Written by the Pathway agent from your graph"
                : "Summary built from your graph"}
          </span>
        </div>

        {story ? (
          <>
            <h3
              className="mt-3 text-[18px] font-black leading-snug"
              style={{ fontFamily: DISPLAY_FONT }}
            >
              {asString(story.headline)}
            </h3>
            <p className="mt-1 text-[14px] leading-6 text-neutral-900">
              {asString(story.summary)}
            </p>

            <ol className="mt-3 grid gap-3 md:grid-cols-2">
              {steps.map((s, i) => (
                <li
                  key={i}
                  className="flex gap-3 rounded-xl p-3"
                  style={{ backgroundColor: PAPER, border: `2px solid ${INK}` }}
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-black"
                    style={{ backgroundColor: LAVENDER, ...border }}
                  >
                    {i + 1}
                  </span>
                  <div>
                    <div className="text-[13px] font-black">
                      {asString(s.title)}
                    </div>
                    <p className="text-[13px] leading-5 text-neutral-900">
                      {asString(s.text)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div
                className="rounded-xl p-3"
                style={{ backgroundColor: `${GREEN}22`, border: `2px solid ${INK}` }}
              >
                <div className="flex items-center gap-1.5 text-[12px] font-black uppercase tracking-wide">
                  <CheckCircle2 size={14} color={GREEN} /> What it means
                </div>
                <p className="mt-1 text-[13px] leading-5">
                  {asString(story.meaning)}
                </p>
              </div>
              <div
                className="rounded-xl p-3"
                style={{ backgroundColor: `${CORAL}22`, border: `2px solid ${INK}` }}
              >
                <div className="flex items-center gap-1.5 text-[12px] font-black uppercase tracking-wide">
                  <Flame size={14} color={CORAL} /> What is not proven
                </div>
                <p className="mt-1 text-[13px] leading-5">
                  {asString(story.caveat)}
                </p>
              </div>
            </div>

            {followups.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-black text-neutral-700">
                  Ask the agent:
                </span>
                {followups.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => onAsk(q)}
                    className="rounded-full px-3 py-1 text-[12px] font-bold transition-transform hover:-translate-y-0.5"
                    style={{ backgroundColor: LAVENDER, ...border }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="mt-3 text-[13px] text-neutral-800">
            No summary available for this topic yet.
          </p>
        )}
      </div>

      {/* 2. AT A GLANCE */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          value={num(facts.skillsCovered?.length)}
          label="Skills linked"
          hint="Wider skills this topic is part of"
        />
        <Tile
          value={num(facts.realWorkLinked)}
          label="Pieces of real work"
          hint="Code that shows it in action"
        />
        <Tile
          value={num(facts.missionsLinked)}
          label="Practice missions"
          hint="Guided exercises you completed"
        />
        <Tile
          value={num(facts.projectsInvolved)}
          label="Projects"
          hint="Repositories the work lives in"
        />
      </div>

      {/* 3. THE MAP */}
      <div
        className="mt-4 overflow-hidden rounded-xl"
        style={{ backgroundColor: WHITE, ...border }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div>
            <div className="text-[14px] font-black">How it all connects</div>
            <div className="text-[12px] text-neutral-700">
              Click any circle to see how it relates to this topic. Closer to the
              centre means more directly linked.
            </div>
          </div>
          <div className="flex items-center gap-2">
            {picked && (
              <Btn onClick={() => setPicked(null)}>
                <X size={12} /> Clear
              </Btn>
            )}
            <Btn onClick={() => setTech((v) => !v)} bg={tech ? YELLOW : CARD}>
              {tech ? "Hide" : "Show"} technical labels
            </Btn>
          </div>
        </div>

        <svg
          viewBox={`0 0 ${EW} ${EH}`}
          className="block h-auto w-full"
          role="group"
          aria-label="Evidence map"
        >
          <defs>
            <marker
              id="evarrow"
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
          {RINGS.map((r) => (
            <ellipse
              key={r}
              cx={EW / 2}
              cy={EH / 2}
              rx={r * 1.35}
              ry={r}
              fill="none"
              stroke={INK}
              strokeOpacity=".14"
              strokeDasharray="4 6"
            />
          ))}
          {["directly linked", "one step away", "two steps away"].map((t, i) => (
            <text
              key={t}
              x={EW / 2 + 6}
              y={EH / 2 - RINGS[i] - 4}
              fontSize="11"
              fontWeight={800}
              fill={INK}
              opacity=".5"
            >
              {t}
            </text>
          ))}

          {edges.map((e) => {
            const a = pos.get(asString(e.source));
            const b = pos.get(asString(e.target));
            if (!a || !b) return null;
            const sid = asString(e.source);
            const tid = asString(e.target);
            const on = lit.has(sid) && lit.has(tid);
            const touchesPick =
              !!picked && (sid === picked.id || tid === picked.id);
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d = Math.max(Math.hypot(dx, dy), 1);
            const ra = nodeR(byId.get(sid)) + 2;
            const rb = nodeR(byId.get(tid)) + 6;
            const op = litOn ? (on ? 1 : 0.08) : focus ? (touchesPick ? 1 : 0.06) : 0.55;
            const showText = tech || on || touchesPick;
            return (
              <g key={asString(e.id)} opacity={op}>
                <line
                  x1={a.x + (dx / d) * ra}
                  y1={a.y + (dy / d) * ra}
                  x2={b.x - (dx / d) * rb}
                  y2={b.y - (dy / d) * rb}
                  stroke={on || touchesPick ? CORAL : INK}
                  strokeWidth={on || touchesPick ? 3.2 : 1.3}
                  markerEnd="url(#evarrow)"
                />
                {showText && (
                  <text
                    x={(a.x + b.x) / 2}
                    y={(a.y + b.y) / 2 - 3}
                    textAnchor="middle"
                    fontSize="9.5"
                    fontWeight={800}
                    fill={INK}
                    style={{
                      paintOrder: "stroke",
                      stroke: WHITE,
                      strokeWidth: 3,
                    }}
                  >
                    {tech
                      ? asString(e.type)
                      : (REL_PLAIN[asString(e.type)] ?? asString(e.type))}
                  </text>
                )}
              </g>
            );
          })}

          {nodes.map((n) => {
            const p = pos.get(asString(n.id));
            if (!p) return null;
            const id = asString(n.id);
            const r = nodeR(n);
            const kind = asString(n.kind);
            const mission = n.meta?.mission === true;
            const faded = litOn ? !lit.has(id) : focus ? !focus.has(id) : false;
            return (
              <g
                key={id}
                tabIndex={0}
                role="button"
                aria-label={`${KIND_LABEL[kind] ?? kind}: ${nm(id)}`}
                onClick={() => setPicked(n)}
                onKeyDown={(ev) =>
                  (ev.key === "Enter" || ev.key === " ") && setPicked(n)
                }
                style={{
                  cursor: "pointer",
                  opacity: faded ? 0.15 : 1,
                  transition: "opacity .25s",
                }}
              >
                {lit.has(id) && (
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={r + 9}
                    fill="none"
                    stroke={YELLOW}
                    strokeWidth="3.5"
                  />
                )}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r}
                  fill={KIND_COLOR[kind] ?? CARD}
                  stroke={INK}
                  strokeWidth={picked?.id === id ? 4 : 2.2}
                  strokeDasharray={mission ? "4 3" : undefined}
                />
                <text
                  x={p.x}
                  y={p.y + r + 13}
                  textAnchor="middle"
                  fontSize="10.5"
                  fontWeight={800}
                  fill={INK}
                  style={{
                    paintOrder: "stroke",
                    stroke: WHITE,
                    strokeWidth: 4,
                    strokeLinejoin: "round",
                  }}
                >
                  {cut(nm(id), 24)}
                </text>
              </g>
            );
          })}
        </svg>

        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-[12px] font-semibold"
          style={{ borderTop: `1px solid ${LINE}` }}
        >
          {Object.entries(KIND_LABEL).map(([k, l]) => (
            <span key={k} className="flex items-center gap-1.5">
              <span
                className="h-3 w-3 rounded-full"
                style={{
                  backgroundColor: KIND_COLOR[k],
                  border: `1.5px solid ${INK}`,
                }}
              />
              {l}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span
              className="h-3 w-3 rounded-full"
              style={{ border: `2px dashed ${INK}` }}
            />
            practice mission
          </span>
        </div>

        <div className="px-3 pb-3 text-[13px]" style={{ borderTop: `1px solid ${LINE}` }}>
          {picked ? (
            <>
              <div className="pt-2 font-black">
                {KIND_LABEL[asString(picked.kind)] ?? asString(picked.kind)}:{" "}
                {nm(asString(picked.id))}
              </div>
              {edges
                .filter((e) => e.source === picked.id || e.target === picked.id)
                .slice(0, 6)
                .map((e) => (
                  <p
                    key={asString(e.id)}
                    className="text-[13px] leading-5 text-neutral-900"
                  >
                    • {relSentence(e, nm)}
                    {e.note ? ` Why: ${asString(e.note)}` : ""}
                  </p>
                ))}
              {picked.kind === "topic_neighbor" && picked.meta?.slug && (
                <button
                  type="button"
                  onClick={() => onPick(asString(picked.meta.slug))}
                  className="mt-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-black"
                  style={{ backgroundColor: YELLOW, ...border }}
                >
                  Open this topic
                </button>
              )}
            </>
          ) : (
            <p className="pt-2 text-[13px] text-neutral-700">
              Tip: click a circle to read, in a sentence, how it connects to this
              topic.
            </p>
          )}
        </div>
      </div>

      {/* 4. THE WORK BEHIND THE RATING */}
      <div
        className="mt-4 rounded-xl p-3"
        style={{ backgroundColor: WHITE, ...border }}
      >
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[14px] font-black">The work behind this rating</div>
          <span className="text-[12px] text-neutral-700">
            Hover a card to light up its path on the map
          </span>
        </div>
        {builds.length === 0 ? (
          <p className="text-[13px] leading-5 text-neutral-800">
            No piece of work is linked to this topic in the graph. That means
            nothing was connected, not that nothing was built.
          </p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {builds.map((b) => (
              <div
                key={asString(b.id)}
                onMouseEnter={() => setLit(new Set(asArray<string>(b.routeIds)))}
                onMouseLeave={() => setLit(new Set())}
                className="rounded-lg p-2.5"
                style={{ backgroundColor: PAPER, border: `2px solid ${INK}` }}
              >
                <div className="flex items-center justify-between gap-2">
                  <Chip
                    text={b.kind === "mission" ? "Practice mission" : "Real work"}
                    background={b.kind === "mission" ? PURPLE : GREEN}
                    color={WHITE}
                  />
                  <span className="text-[11px] font-bold text-neutral-700">
                    {timeAgo(asString(b.createdAt))}
                  </span>
                </div>
                <div className="mt-1 text-[13px] font-black leading-4">
                  {asString(b.title)}
                </div>
                {b.commitSubject && (
                  <div className="text-[12px] leading-4 text-neutral-700">
                    {cut(asString(b.commitSubject), 90)}
                  </div>
                )}
                <p className="mt-1 text-[12px] leading-4 text-neutral-800">
                  Shows the skill “{asString(b.capability)}”
                  {b.repository ? ` in ${asString(b.repository)}` : ""}.
                </p>
                {b.permalink && (
                  <a
                    href={asString(b.permalink)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block text-[12px] font-bold underline"
                  >
                    View the code
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 5. HOW STRONG, IN QUESTIONS */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div
          className="rounded-xl p-3"
          style={{ backgroundColor: WHITE, ...border }}
        >
          <div className="mb-2 text-[14px] font-black">Where it sits among your skills</div>
          <div className="space-y-3">
            {algos.map((a) => {
              const meta = ALGO_PLAIN[asString(a.id)];
              if (!meta) return null;
              return (
                <div key={asString(a.id)}>
                  <div className="text-[13px] font-black">{meta.title}</div>
                  <div className="text-[12px] text-neutral-700">
                    {meta.question}
                  </div>
                  {a.norm != null && (
                    <div
                      className="mt-1 h-2 overflow-hidden rounded-full"
                      style={{ backgroundColor: CARD, border: `1.5px solid ${INK}` }}
                    >
                      <div
                        className="h-full"
                        style={{
                          width: `${num(a.norm) * 100}%`,
                          backgroundColor: SKY,
                        }}
                      />
                    </div>
                  )}
                  <p className="mt-0.5 text-[13px] leading-5 text-neutral-900">
                    {meta.read(a, data)}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[12px] leading-4 text-neutral-700">
            These describe how topics connect. They do not prove skill on their
            own.
          </p>
        </div>

        <div
          className="rounded-xl p-3"
          style={{ backgroundColor: WHITE, ...border }}
        >
          <div className="mb-1 flex items-center justify-between text-[14px] font-black">
            <span>The rating</span>
            <span className="text-[13px]">{num(score.score)} / 100</span>
          </div>
          <div
            className="h-3 overflow-hidden rounded-full"
            style={{ backgroundColor: CARD, border: `1.5px solid ${INK}` }}
          >
            <div
              className="h-full"
              style={{
                width: `${num(score.score)}%`,
                backgroundColor: LEVEL_COLOR[asString(score.level)] ?? SKY,
              }}
            />
          </div>
          <p className="mt-2 text-[13px] leading-5 text-neutral-900">
            First, Pathway counted the activity in your code and got{" "}
            <b>{num(score.baseline)}</b>. Then the agent read the actual code
            and{" "}
            {num(score.adjustment) === 0
              ? "agreed with that number"
              : `moved it ${num(score.adjustment) > 0 ? "up" : "down"} by ${Math.abs(num(score.adjustment))}`}
            . Confidence is <b>{asString(score.confidence)}</b>
            {asString(score.confidence) === "low"
              ? ", because there is not much evidence yet."
              : "."}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {backedBy.length ? (
              backedBy.map((b) => (
                <Chip
                  key={asString(b.kind)}
                  text={`${num(b.count)} ${humanize(asString(b.kind)).toLowerCase()} cited`}
                  background={LAVENDER}
                />
              ))
            ) : (
              <span className="text-[12px] text-neutral-700">
                No specific code is cited for this rating.
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 6. ENGINEERS ONLY */}
      <div className="mt-4">
        <Fold title="Technical details (for engineers)">
          <p className="mb-2 text-[12px] leading-4 text-neutral-700">
            Everything above is computed from these FalkorDB queries and
            algorithms. You do not need this to understand the rating.
          </p>
          <div className="space-y-2">
            {algos.map((a) => (
              <div
                key={asString(a.id)}
                className="rounded-lg p-2 text-[12px]"
                style={{ backgroundColor: WHITE, border: `1.5px solid ${INK}` }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 font-black">
                  <span>{asString(a.name)}</span>
                  <span className="text-neutral-700">
                    {a.value == null
                      ? "–"
                      : fix(a.value, a.id === "traversal" ? 0 : 4)}
                    {a.position ? ` · #${num(a.position)} of ${num(a.of)}` : ""}
                  </span>
                </div>
                <div className="text-neutral-800">{asString(a.reading)}</div>
                <code className="block break-all text-[11px] text-neutral-600">
                  {asString(a.call)}
                </code>
              </div>
            ))}
            {trace.map((t, i) => (
              <div
                key={i}
                className="rounded-lg p-2 text-[12px]"
                style={{ backgroundColor: WHITE, border: `1.5px solid ${INK}` }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 font-black">
                  <span>{asString(t.name)}</span>
                  <span className="text-neutral-700">
                    {num(t.rows)} rows · {num(t.ms)} ms
                  </span>
                </div>
                <code className="block break-all text-[11px] text-neutral-700">
                  {asString(t.pattern)}
                </code>
                <span className="text-[11px] font-bold text-neutral-600">
                  {asString(t.algorithm)}
                </span>
              </div>
            ))}
          </div>
        </Fold>
      </div>
    </section>
  );
}
