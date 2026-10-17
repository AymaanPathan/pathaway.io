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
  HelpCircle,
  Layers,
  MessageCircle,
  Play,
  RefreshCw,
  Route as RouteIcon,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  AiMessage,
  Blocks,
  ToolTrace,
  type LiveStep,
  type TraceEvent,
} from "../compoenents/ChatBlock";

/* ========================================================================== */
/* DESIGN TOKENS (same theme as before)                                       */
/* ========================================================================== */

const DISPLAY_FONT = '"Space Grotesk", "Arial Black", sans-serif';
const BODY_FONT = '"Inter", "Helvetica Neue", sans-serif';
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

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

const PREREQ_STYLE: Record<
  string,
  { label: string; bg: string; color: string }
> = {
  demonstrated: { label: "Backed by your code", bg: GREEN, color: WHITE },
  weak: { label: "Shallow foundation", bg: YELLOW, color: INK },
  unverified: { label: "Foundation not assessed", bg: LAVENDER, color: INK },
};
const CONF_COLOR: Record<string, string> = {
  high: GREEN,
  medium: YELLOW,
  low: CORAL,
};
const AUTH_LABEL: Record<string, string> = {
  genuine_implementation: "Built it themselves",
  working_usage: "Working usage",
  incidental: "Incidental",
  boilerplate: "Boilerplate",
  insufficient_evidence: "Insufficient evidence",
};

/* kinds of node that can appear in a topic's evidence graph */
const KIND_META: Record<string, { label: string; color: string }> = {
  topic: { label: "Topic", color: INK },
  approach: { label: "Approach", color: LAVENDER },
  capability: { label: "Capability", color: SKY },
  repository: { label: "Repository", color: YELLOW },
  file: { label: "File", color: "#6FC3B2" },
  code: { label: "Code", color: "#6FC3B2" },
  commit: { label: "Commit", color: CORAL },
  demonstration: { label: "Detected build", color: GREEN },
  experience: { label: "Experience", color: "#E58AB4" },
  evidence: { label: "Evidence", color: GREEN },
  mission: { label: "Mission", color: PURPLE },
  build: { label: "Real work", color: PURPLE },
  assessment: { label: "Assessment", color: YELLOW },
  developer: { label: "You", color: PAPER },
};
const kindMeta = (k: string) =>
  KIND_META[k] ?? { label: humanize(k), color: "#d1d5db" };
const EDGE_LABEL: Record<string, string> = {
  BUILDS_ON: "builds on",
  RELATED_TOPIC: "goes with",
  MAPS_TO: "maps to",
  USES_APPROACH: "uses approach",
  BACKED_BY: "backed by",
  OF_TOPIC: "about",
  ASSESSED: "assessed",
  KNOWS_TOPIC: "knows",
};
const edgeLabel = (t: string) =>
  EDGE_LABEL[t] ?? t.toLowerCase().replace(/_/g, " ");

/* ========================================================================== */
/* HELPERS                                                                    */
/* ========================================================================== */

type Obj = Record<string, any>;

const asString = (v: unknown, fallback = "") =>
  v == null ? fallback : String(v);
const asArray = <T = unknown,>(v: unknown): T[] =>
  Array.isArray(v) ? (v as T[]) : [];
const asObjects = (v: unknown): Obj[] =>
  asArray<unknown>(v).filter(
    (x): x is Obj => !!x && typeof x === "object" && !Array.isArray(x),
  );
const num = (v: unknown, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const cut = (s: string, n: number) =>
  s.length <= n ? s : `${s.slice(0, n - 1)}…`;
function humanize(s: string) {
  return s
    ? s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
    : "Other";
}
const fix = (v: unknown, d = 3) =>
  v == null || !Number.isFinite(Number(v)) ? "–" : Number(v).toFixed(d);
const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

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

/** Streams the chat endpoint (live tool status + streamed answer). Falls back to the plain endpoint. */
async function chatRequest(body: unknown, onEvent: (e: TraceEvent) => void) {
  try {
    const r = await fetch("/api/topics/chat/stream", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.status === 429)
      return {
        ok: false,
        status: 429,
        data: (await r.json().catch(() => ({}))) as Obj,
      };
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
            /* partial line */
          }
        }
      }
      if (final) return { ok: true, status: 200, data: final };
      if (err) return { ok: false, status: 500, data: { error: err } as Obj };
    }
  } catch {
    /* fall back below */
  }
  return call("/api/topics/chat", "POST", body);
}

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

interface EvItem {
  kind: string;
  title: string;
  path: string;
  repository: string;
  commit: string;
  permalink: string;
  snippet: string;
  when: string;
}
const toEv = (e: Obj): EvItem => ({
  kind: asString(e.kind),
  title: asString(
    e.title ?? e.subject ?? e.technique ?? e.label ?? e.what ?? "",
  ),
  path: asString(e.path),
  repository: asString(e.repository ?? e.repo),
  commit: asString(e.commit ?? e.commitSubject),
  permalink: asString(e.permalink),
  snippet: asString(e.snippet ?? e.code ?? e.excerpt),
  when: asString(e.createdAt ?? e.date ?? e.when),
});
const hasEv = (e: EvItem) =>
  Boolean(e.title || e.path || e.permalink || e.snippet || e.commit);
function dedupeEv(list: EvItem[]): EvItem[] {
  const seen = new Set<string>();
  return list.filter((e) => {
    if (!hasEv(e)) return false;
    const key =
      e.permalink || [e.repository, e.path, e.title, e.commit].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function approachEvidence(a: Obj, all: Obj[]): EvItem[] {
  const own = asObjects(
    a.evidence ?? a.evidenceItems ?? a.citations ?? a.cited,
  ).map(toEv);
  const slug = asString(a.slug);
  const linked = all
    .filter(
      (e) =>
        asString(e.approach) === slug ||
        asArray<string>(e.approaches).includes(slug),
    )
    .map(toEv);
  return dedupeEv([...own, ...linked]);
}
function claimsOf(detail: Obj | null) {
  const c = (detail?.trace?.claims ?? {}) as Obj;
  return {
    observed: asObjects(c.observed),
    inferred: asObjects(c.inferred),
    unknown: asObjects(c.unknown),
  };
}

/* ========================================================================== */
/* MAIN KNOWLEDGE GRAPH LAYOUTS                                               */
/* ========================================================================== */

const GW = 1000;
const GH = 600;
const PADX = 110;
const PADY = 70;
type Pt = { x: number; y: number };

/** "areas": force layout, pulled toward an anchor per engineering domain. */
function layoutAreas(nodes: Obj[], edges: Obj[]) {
  const n = nodes.length;
  const out = new Map<string, Pt>();
  if (!n) return out;
  const domains = [...new Set(nodes.map((x) => asString(x.domain)))];
  const anchor = new Map<string, Pt>();
  domains.forEach((d, i) => {
    const a = (i / Math.max(1, domains.length)) * Math.PI * 2 - Math.PI / 2;
    anchor.set(d, {
      x: GW / 2 + Math.cos(a) * GW * 0.3,
      y: GH / 2 + Math.sin(a) * GH * 0.3,
    });
  });
  const ids = nodes.map((x) => asString(x.id));
  const pos = new Map<string, Pt & { vx: number; vy: number }>();
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
    for (let i = 0; i < n; i++)
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
  for (const [k, p] of pos)
    out.set(k, {
      x: rx < 1 ? GW / 2 : PADX + ((p.x - minX) / rx) * (GW - PADX * 2),
      y: ry < 1 ? GH / 2 : PADY + ((p.y - minY) / ry) * (GH - PADY * 2),
    });
  return out;
}

/** "layers": rows by depth level (deep on top), sorted by area inside each row. */
function layoutLayers(nodes: Obj[]) {
  const out = new Map<string, Pt>();
  const rank = (n: Obj) =>
    n.assessed ? (LEVEL_RANK[asString(n.level)] ?? 0) : -1;
  const ranks = [...new Set(nodes.map(rank))].sort((a, b) => b - a);
  const bands: Array<{ rank: number; y: number }> = [];
  ranks.forEach((r, ri) => {
    const y =
      ranks.length === 1 ? GH / 2 : 80 + (ri / (ranks.length - 1)) * (GH - 160);
    bands.push({ rank: r, y });
    const row = nodes
      .filter((n) => rank(n) === r)
      .sort(
        (a, b) =>
          asString(a.domain).localeCompare(asString(b.domain)) ||
          asString(a.label).localeCompare(asString(b.label)),
      );
    row.forEach((n, i) => {
      const x =
        row.length === 1 ? GW / 2 : 150 + (i / (row.length - 1)) * (GW - 230);
      out.set(asString(n.id), { x, y: y + (i % 2 ? 14 : -14) });
    });
  });
  return { pos: out, bands };
}

/* ========================================================================== */
/* PER-TOPIC EVIDENCE GRAPH (topic in the middle, everything it touches around) */
/* ========================================================================== */

interface GNode {
  id: string;
  label: string;
  kind: string;
  hop: number;
  level?: string;
  note?: string;
  permalink?: string;
  slug?: string;
  assessed?: boolean;
}
interface GEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  note?: string;
}

/** Builds the ego graph from the graph payload, or from the topic detail if the payload is unavailable. */
function buildEgo(
  slug: string,
  detail: Obj,
  payload: Obj | null,
): { nodes: GNode[]; edges: GEdge[]; centerId: string } {
  const centerId = `topic:${slug}`;
  const name = asString(detail.topic?.name) || humanize(slug);
  const nodes = new Map<string, GNode>();
  const edges: GEdge[] = [];
  const addNode = (n: GNode) => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
  };
  const addEdge = (source: string, target: string, type: string, note = "") => {
    const id = `${type}:${source}>${target}`;
    if (!edges.some((e) => e.id === id))
      edges.push({ id, source, target, type, note });
  };

  const pNodes = asObjects(payload?.nodes);
  const pEdges = asObjects(payload?.edges);
  if (pNodes.length > 1 && pEdges.length > 0) {
    const centerGuess =
      pNodes.find((n) => asString(n.id) === centerId) ??
      pNodes.find(
        (n) => asString(n.slug) === slug && asString(n.kind) === "topic",
      ) ??
      pNodes.find((n) => asString(n.slug) === slug);
    const cid = centerGuess ? asString(centerGuess.id) : centerId;
    for (const n of pNodes) {
      const id = asString(n.id);
      if (!id) continue;
      addNode({
        id,
        label: asString(n.label ?? n.name ?? id.replace(/^[a-z_]+:/, "")),
        kind: asString(n.kind, id.includes(":") ? id.split(":")[0] : "topic"),
        hop: 99,
        level: asString(n.level) || undefined,
        note: asString(n.note ?? n.description) || undefined,
        permalink: asString(n.permalink) || undefined,
        slug:
          asString(n.slug) ||
          (id.startsWith("topic:") ? id.slice(6) : undefined),
        assessed: n.assessed === true,
      });
    }
    if (!nodes.has(cid))
      addNode({ id: cid, label: name, kind: "topic", hop: 0, slug });
    for (const e of pEdges) {
      const s = asString(e.source);
      const t = asString(e.target);
      if (nodes.has(s) && nodes.has(t) && s !== t)
        addEdge(s, t, asString(e.type, "LINKED"), asString(e.note ?? e.reason));
    }
    return finishEgo(nodes, edges, cid, detail);
  }

  /* fallback: assemble the neighbourhood from the topic detail */
  addNode({
    id: centerId,
    label: name,
    kind: "topic",
    hop: 0,
    slug,
    level: asString(detail.topic?.level),
    assessed: true,
  });
  for (const a of asObjects(detail.approaches)) {
    const id = `approach:${asString(a.slug)}`;
    addNode({
      id,
      label: asString(a.name ?? a.slug),
      kind: "approach",
      hop: 1,
      level: asString(a.depth),
      note: asString(a.howImplemented),
    });
    addEdge(centerId, id, "USES_APPROACH");
  }
  const g = (detail.graph ?? {}) as Obj;
  for (const f of asObjects(g.foundations)) {
    const id = `topic:${asString(f.slug)}`;
    addNode({
      id,
      label: asString(f.name ?? f.slug),
      kind: "topic",
      hop: 1,
      slug: asString(f.slug),
      level: asString(f.level),
      assessed: f.assessed !== false,
    });
    addEdge(centerId, id, "BUILDS_ON", asString(f.reason));
  }
  for (const f of asObjects(g.unlocks)) {
    const id = `topic:${asString(f.slug)}`;
    addNode({
      id,
      label: asString(f.name ?? f.slug),
      kind: "topic",
      hop: 1,
      slug: asString(f.slug),
      level: asString(f.level),
      assessed: f.assessed !== false,
    });
    addEdge(id, centerId, "BUILDS_ON", asString(f.reason));
  }
  for (const f of asObjects(g.related)) {
    const id = `topic:${asString(f.slug)}`;
    addNode({
      id,
      label: asString(f.name ?? f.slug),
      kind: "topic",
      hop: 1,
      slug: asString(f.slug),
      level: asString(f.level),
      assessed: f.assessed !== false,
    });
    addEdge(centerId, id, "RELATED_TOPIC", asString(f.reason));
  }
  for (const c of asObjects(detail.capabilityPaths)) {
    const id = `capability:${asString(c.capabilityId ?? c.capability)}`;
    addNode({
      id,
      label: asString(c.capability ?? c.capabilityId),
      kind: "capability",
      hop: 1,
    });
    addEdge(centerId, id, "MAPS_TO");
  }
  for (const e of asObjects(detail.trace?.supportingEvidence).slice(0, 10)) {
    const id = `evidence:${asString(e.evidenceId)}`;
    addNode({
      id,
      label: cut(asString(e.source), 40),
      kind: asString(e.kind, "evidence"),
      hop: 2,
      permalink: asString(e.permalink) || undefined,
      note: asString(e.supports),
    });
    addEdge(centerId, id, "BACKED_BY");
  }
  return finishEgo(nodes, edges, centerId, detail);
}

function finishEgo(
  nodes: Map<string, GNode>,
  edges: GEdge[],
  centerId: string,
  detail: Obj,
) {
  const center = nodes.get(centerId);
  if (center) {
    center.hop = 0;
    center.kind = "topic";
    center.level = asString(detail.topic?.level) || center.level;
    center.assessed = true;
  }
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
    adj.set(e.target, [...(adj.get(e.target) ?? []), e.source]);
  }
  const seen = new Set([centerId]);
  let frontier = [centerId];
  let hop = 0;
  while (frontier.length && hop < 3) {
    hop++;
    const next: string[] = [];
    for (const id of frontier)
      for (const m of adj.get(id) ?? []) {
        if (seen.has(m)) continue;
        seen.add(m);
        const nd = nodes.get(m);
        if (nd) nd.hop = hop;
        next.push(m);
      }
    frontier = next;
  }
  /* keep the picture readable: closest nodes first, cap at 44 */
  const kept = [...nodes.values()]
    .filter((n) => n.hop <= 3)
    .sort((a, b) => a.hop - b.hop || a.kind.localeCompare(b.kind))
    .slice(0, 44);
  const keep = new Set(kept.map((n) => n.id));
  return {
    nodes: kept,
    edges: edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
    centerId,
  };
}

const EGO_W = 1000;
const EGO_H = 620;

function egoLayout(nodes: GNode[], edges: GEdge[], centerId: string) {
  const out = new Map<string, Pt & { angle: number }>();
  const cx = EGO_W / 2;
  const cy = EGO_H / 2;
  out.set(centerId, { x: cx, y: cy, angle: 0 });
  const ring: Record<number, [number, number]> = {
    1: [250, 165],
    2: [430, 262],
    3: [470, 285],
  };
  const byHop = (h: number) =>
    nodes
      .filter((n) => n.hop === h)
      .sort(
        (a, b) =>
          a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label),
      );

  const first = byHop(1);
  first.forEach((n, i) => {
    const a = (i / Math.max(1, first.length)) * Math.PI * 2 - Math.PI / 2;
    out.set(n.id, {
      x: cx + Math.cos(a) * ring[1][0],
      y: cy + Math.sin(a) * ring[1][1],
      angle: a,
    });
  });

  for (const h of [2, 3]) {
    const layer = byHop(h);
    const kids = new Map<string, GNode[]>();
    for (const n of layer) {
      const parent =
        edges
          .map((e) =>
            e.source === n.id ? e.target : e.target === n.id ? e.source : null,
          )
          .find((id) => id && nodes.find((x) => x.id === id)?.hop === h - 1) ??
        centerId;
      kids.set(parent, [...(kids.get(parent) ?? []), n]);
    }
    let orphan = 0;
    for (const [parent, list] of kids) {
      const base = out.get(parent)?.angle ?? -Math.PI / 2 + orphan++ * 0.7;
      const spread = Math.min(0.9, 0.2 * list.length);
      list.forEach((n, i) => {
        const a =
          list.length === 1
            ? base
            : base - spread / 2 + (i / (list.length - 1)) * spread;
        out.set(n.id, {
          x: cx + Math.cos(a) * ring[h][0],
          y: cy + Math.sin(a) * ring[h][1],
          angle: a,
        });
      });
    }
  }
  /* anything unreachable sits on the outer ring */
  nodes
    .filter((n) => !out.has(n.id))
    .forEach((n, i, arr) => {
      const a = (i / Math.max(1, arr.length)) * Math.PI * 2;
      out.set(n.id, {
        x: cx + Math.cos(a) * 470,
        y: cy + Math.sin(a) * 285,
        angle: a,
      });
    });
  return out;
}

function EvidenceGraph({
  slug,
  detail,
  onPick,
}: {
  slug: string;
  detail: Obj;
  onPick: (slug: string) => void;
}) {
  const [payload, setPayload] = useState<Obj | null>(null);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    setLoading(true);
    setActive(null);
    getJson(`/api/topics/${encodeURIComponent(slug)}/graph`)
      .then((p) => live && setPayload(p))
      .catch(() => live && setPayload(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [slug]);

  const ego = useMemo(
    () => buildEgo(slug, detail, payload),
    [slug, detail, payload],
  );
  const visibleNodes = useMemo(
    () => ego.nodes.filter((n) => n.hop === 0 || !hiddenKinds.has(n.kind)),
    [ego, hiddenKinds],
  );
  const visibleIds = useMemo(
    () => new Set(visibleNodes.map((n) => n.id)),
    [visibleNodes],
  );
  const visibleEdges = useMemo(
    () =>
      ego.edges.filter(
        (e) => visibleIds.has(e.source) && visibleIds.has(e.target),
      ),
    [ego, visibleIds],
  );
  const pos = useMemo(
    () => egoLayout(visibleNodes, visibleEdges, ego.centerId),
    [visibleNodes, visibleEdges, ego.centerId],
  );

  const kindCounts = useMemo(() => {
    const m: Record<string, number> = {};
    ego.nodes
      .filter((n) => n.hop > 0)
      .forEach((n) => (m[n.kind] = (m[n.kind] ?? 0) + 1));
    return m;
  }, [ego]);

  const focus = hover ?? active;
  const focusSet = useMemo(() => {
    if (!focus) return null;
    const s = new Set([focus]);
    for (const e of visibleEdges) {
      if (e.source === focus) s.add(e.target);
      if (e.target === focus) s.add(e.source);
    }
    return s;
  }, [focus, visibleEdges]);

  const activeNode = ego.nodes.find((n) => n.id === active) ?? null;
  const activeEdges = activeNode
    ? visibleEdges.filter(
        (e) => e.source === activeNode.id || e.target === activeNode.id,
      )
    : [];
  const nameOf = (id: string) =>
    ego.nodes.find((n) => n.id === id)?.label ?? id;
  const hoverNode = hover ? ego.nodes.find((n) => n.id === hover) : null;
  const hp = hover ? pos.get(hover) : null;
  const maxHop = Math.max(0, ...ego.nodes.map((n) => n.hop));

  const toggleKind = (k: string) =>
    setHiddenKinds((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <div
      className="rounded-2xl"
      style={{ backgroundColor: WHITE, ...border, boxShadow: shadow(4) }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <div>
          <h3
            className="text-[16px] font-black"
            style={{ fontFamily: DISPLAY_FONT }}
          >
            Evidence graph
          </h3>
          <p className="text-[12px] font-semibold text-neutral-700">
            {visibleNodes.length - 1} connected nodes, up to {maxHop} step
            {maxHop === 1 ? "" : "s"} from {asString(detail.topic?.name)}. Tap
            any node.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(kindCounts).map(([k, n]) => {
            const off = hiddenKinds.has(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggleKind(k)}
                className="press inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-bold"
                style={{
                  backgroundColor: off ? CARD : WHITE,
                  opacity: off ? 0.55 : 1,
                  ...border,
                }}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor: kindMeta(k).color,
                    border: `1.5px solid ${INK}`,
                  }}
                />
                {kindMeta(k).label} {n}
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative mt-1 h-[520px] overflow-hidden sm:h-[600px]">
        {loading && (
          <div className="absolute left-4 top-2 z-10 flex items-center gap-2 text-[12px] font-bold">
            <RefreshCw size={13} className="animate-spin" /> reading the graph…
          </div>
        )}
        <svg
          viewBox={`0 0 ${EGO_W} ${EGO_H}`}
          className="absolute inset-0 h-full w-full"
          role="group"
          aria-label="Evidence graph for this topic"
        >
          <defs>
            <pattern
              id="egrid"
              width="32"
              height="32"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="1" cy="1" r="1" fill={INK} opacity=".12" />
            </pattern>
            <marker
              id="earrow"
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
          <rect width={EGO_W} height={EGO_H} fill="url(#egrid)" />
          {[1, 2, 3]
            .filter((h) => h <= maxHop)
            .map((h) => (
              <ellipse
                key={h}
                cx={EGO_W / 2}
                cy={EGO_H / 2}
                rx={[0, 250, 430, 470][h]}
                ry={[0, 165, 262, 285][h]}
                fill="none"
                stroke={INK}
                strokeOpacity=".12"
                strokeDasharray="4 6"
              />
            ))}

          {visibleEdges.map((e, i) => {
            const a = pos.get(e.source);
            const b = pos.get(e.target);
            const na = visibleNodes.find((n) => n.id === e.source);
            const nb = visibleNodes.find((n) => n.id === e.target);
            if (!a || !b || !na || !nb) return null;
            const ra = na.hop === 0 ? 38 : na.hop === 1 ? 24 : 17;
            const rb = nb.hop === 0 ? 38 : nb.hop === 1 ? 24 : 17;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d = Math.max(Math.hypot(dx, dy), 1);
            const x1 = a.x + (dx / d) * ra;
            const y1 = a.y + (dy / d) * ra;
            const x2 = b.x - (dx / d) * (rb + 4);
            const y2 = b.y - (dy / d) * (rb + 4);
            const touch = focus && (e.source === focus || e.target === focus);
            const dim = focusSet && !touch;
            const directed =
              e.type === "BUILDS_ON" ||
              e.type === "USES_APPROACH" ||
              e.type === "BACKED_BY";
            return (
              <g
                key={e.id}
                style={{
                  opacity: dim ? 0.07 : touch ? 1 : 0.5,
                  transition: "opacity .3s ease",
                }}
              >
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={touch ? CORAL : INK}
                  strokeWidth={touch ? 3 : 1.5}
                  strokeDasharray={
                    e.type === "RELATED_TOPIC" ? "5 5" : undefined
                  }
                  markerEnd={directed ? "url(#earrow)" : undefined}
                  pathLength={1}
                  style={{
                    transition: "stroke-width .2s ease",
                    animation: `odraw .8s ${Math.min(i, 30) * 0.03}s ease-out both`,
                  }}
                />
                {touch && (
                  <text
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 - 6}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight={800}
                    fontFamily={BODY_FONT}
                    style={{
                      fill: INK,
                      paintOrder: "stroke",
                      stroke: WHITE,
                      strokeWidth: 4,
                    }}
                  >
                    {edgeLabel(e.type)}
                  </text>
                )}
              </g>
            );
          })}

          {visibleNodes.map((n, i) => {
            const p = pos.get(n.id);
            if (!p) return null;
            const r = n.hop === 0 ? 38 : n.hop === 1 ? 24 : 17;
            const fill =
              n.kind === "topic"
                ? (LEVEL_COLOR[n.level ?? ""] ?? (n.hop === 0 ? INK : CARD))
                : kindMeta(n.kind).color;
            const dim = focusSet ? !focusSet.has(n.id) : false;
            const sel = active === n.id;
            const unassessed =
              n.kind === "topic" && n.hop > 0 && n.assessed === false;
            return (
              <g
                key={n.id}
                tabIndex={0}
                role="button"
                aria-label={`${kindMeta(n.kind).label}: ${n.label}`}
                onClick={() => setActive(sel ? null : n.id)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    setActive(sel ? null : n.id);
                  }
                }}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(n.id)}
                onBlur={() => setHover(null)}
                style={{
                  cursor: "pointer",
                  opacity: dim ? 0.15 : 1,
                  transition: "opacity .3s ease",
                }}
              >
                <g
                  style={{
                    transformOrigin: `${p.x}px ${p.y}px`,
                    animation: `opop .5s ${Math.min(i, 40) * 0.025}s cubic-bezier(.2,1.4,.4,1) both`,
                  }}
                >
                  {n.hop === 0 && (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={r + 9}
                      fill="none"
                      stroke={CORAL}
                      strokeWidth="3"
                      style={{ animation: "oring 2.4s ease-out infinite" }}
                    />
                  )}
                  {sel && (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={r + 7}
                      fill="none"
                      stroke={YELLOW}
                      strokeWidth="4"
                    />
                  )}
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={r}
                    fill={fill}
                    strokeDasharray={unassessed ? "4 3" : undefined}
                    style={{
                      stroke: INK,
                      strokeWidth: sel || n.hop === 0 ? 4 : 2.5,
                      filter: "drop-shadow(2px 3px 0 rgba(16,18,16,.9))",
                      transition: "stroke-width .2s ease",
                    }}
                  />
                  <text
                    x={p.x}
                    y={n.hop === 0 ? p.y + r + 20 : p.y + r + 14}
                    textAnchor="middle"
                    fontSize={n.hop === 0 ? 16 : n.hop === 1 ? 12 : 11}
                    fontWeight={n.hop === 0 ? 900 : 700}
                    fontFamily={n.hop === 0 ? DISPLAY_FONT : BODY_FONT}
                    style={{
                      fill: INK,
                      paintOrder: "stroke",
                      stroke: "#FFFDF8",
                      strokeWidth: 5,
                      strokeLinejoin: "round",
                    }}
                  >
                    {cut(n.label, n.hop === 0 ? 28 : 20)}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>

        {hoverNode && hp && (
          <div
            className="pointer-events-none absolute z-20 max-w-[220px] rounded-xl px-2.5 py-1.5 text-[12px] leading-4"
            style={{
              left: `${(hp.x / EGO_W) * 100}%`,
              top: `${(hp.y / EGO_H) * 100}%`,
              transform: `translate(${hp.x > EGO_W * 0.65 ? "-110%" : "14px"}, -50%)`,
              backgroundColor: INK,
              color: PAPER,
            }}
          >
            <div className="font-black">{hoverNode.label}</div>
            <div className="opacity-80">
              {kindMeta(hoverNode.kind).label}
              {hoverNode.level
                ? ` · ${LEVEL_LABEL[hoverNode.level] ?? hoverNode.level}`
                : ""}
              {hoverNode.hop > 0
                ? ` · ${hoverNode.hop} step${hoverNode.hop === 1 ? "" : "s"} away`
                : ""}
            </div>
          </div>
        )}
      </div>

      <div
        className="px-4 pb-4 pt-2"
        style={{ borderTop: `1px solid ${LINE}` }}
      >
        {activeNode ? (
          <div
            className="flex flex-wrap items-start justify-between gap-3"
            style={{ animation: "oslide .25s ease-out both" }}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Chip
                  text={kindMeta(activeNode.kind).label}
                  background={kindMeta(activeNode.kind).color}
                  color={
                    activeNode.kind === "topic" && activeNode.hop === 0
                      ? WHITE
                      : INK
                  }
                />
                <span
                  className="text-[15px] font-black"
                  style={{ fontFamily: DISPLAY_FONT }}
                >
                  {activeNode.label}
                </span>
              </div>
              {activeNode.note && (
                <p className="mt-1 max-w-2xl text-[13px] leading-5 text-neutral-900">
                  {cut(activeNode.note, 240)}
                </p>
              )}
              <ul className="mt-1.5 space-y-0.5">
                {activeEdges.slice(0, 6).map((e) => (
                  <li key={e.id} className="text-[12px] leading-4">
                    <b>{nameOf(e.source)}</b>{" "}
                    <span
                      className="rounded-full px-1.5 text-[10px] font-black"
                      style={{
                        backgroundColor: LAVENDER,
                        border: `1.5px solid ${INK}`,
                      }}
                    >
                      {edgeLabel(e.type)}
                    </span>{" "}
                    <b>{nameOf(e.target)}</b>
                    {e.note ? (
                      <span className="text-neutral-700">
                        {" "}
                        · {cut(e.note, 90)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-wrap gap-2">
              {activeNode.kind === "topic" &&
                activeNode.slug &&
                activeNode.hop > 0 &&
                activeNode.assessed !== false && (
                  <Btn
                    onClick={() => onPick(activeNode.slug as string)}
                    bg={YELLOW}
                  >
                    Open topic <ChevronRight size={12} strokeWidth={3} />
                  </Btn>
                )}
              {activeNode.permalink && (
                <a
                  href={activeNode.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="press inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-black"
                  style={{ backgroundColor: GREEN, color: WHITE, ...border }}
                >
                  View the code
                </a>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] font-semibold">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-5" style={{ backgroundColor: INK }} />{" "}
              arrow = depends on / uses / backed by
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="h-0.5 w-5"
                style={{ borderTop: `2px dashed ${INK}` }}
              />{" "}
              goes with
            </span>
            <span className="text-neutral-700">
              Rings show distance from the topic. Filter by kind with the chips
              above.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ========================================================================== */
/* CHAT (local fallback only)                                                 */
/* ========================================================================== */

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
  pending?: boolean;
  steps?: LiveStep[];
};
type ChatCtx = { nodes: Obj[]; sel: string | null; detail: Obj | null };

function localAnswer(q: string, c: ChatCtx): { text: string; slugs: string[] } {
  const s = q.toLowerCase();
  const assessed = c.nodes
    .filter((n) => n.assessed)
    .sort(
      (a, b) =>
        (LEVEL_RANK[asString(b.level)] ?? 0) -
          (LEVEL_RANK[asString(a.level)] ?? 0) || num(b.score) - num(a.score),
    );
  const named = assessed.find((n) => {
    const l = asString(n.label).toLowerCase();
    return l.length > 2 && s.includes(l);
  });
  const focus = named ? asString(named.slug) : c.sel;
  const d = focus && c.sel === focus ? c.detail : null;
  const focusName = asString(
    assessed.find((n) => asString(n.slug) === focus)?.label ??
      d?.topic?.name ??
      focus,
  );
  const slugs = focus ? [focus] : [];
  if (/evidence|support|why|proof|code|unproven|unknown|infer/.test(s)) {
    if (!d)
      return {
        text: focus
          ? `Open ${focusName} first so I can read its evidence.`
          : "Select a topic and I can show the evidence behind it.",
        slugs,
      };
    const k = claimsOf(d);
    let text = `${focusName} is rated ${LEVEL_LABEL[asString(d.topic?.level)] ?? ""} with ${asString(d.trace?.assessment?.confidence)} confidence. ${asString(d.verdict)}`;
    text += k.observed.length
      ? ` Seen in code: ${k.observed
          .slice(0, 2)
          .map((x) => cut(asString(x.text), 100))
          .join("; ")}.`
      : " Nothing is seen in cited code yet.";
    return { text, slugs };
  }
  if (/prereq|foundation|depends|builds on/.test(s) && d) {
    const f = asArray<Obj>(d.graph?.foundations);
    return {
      text: f.length
        ? `${focusName} builds on ${f
            .slice(0, 5)
            .map((x) => asString(x.name))
            .join(", ")}.`
        : `No confirmed foundation is recorded for ${focusName}.`,
      slugs: [...slugs, ...f.map((x) => asString(x.slug)).filter(Boolean)],
    };
  }
  if (named)
    return {
      text: `${asString(named.label)} sits at ${LEVEL_LABEL[asString(named.level)] ?? ""} level. Open it for the full story.`,
      slugs: [asString(named.slug)],
    };
  if (/strong|best|deep|good at/.test(s)) {
    const top = assessed.slice(0, 5);
    return {
      text: top.length
        ? `Deepest topics: ${top.map((x) => asString(x.label)).join(", ")}.`
        : "No topics assessed yet.",
      slugs: top.map((x) => asString(x.slug)),
    };
  }
  return {
    text: "Ask what supports a topic, what is proven versus assumed, or what it builds on.",
    slugs: [],
  };
}

/* ========================================================================== */
/* MAIN                                                                       */
/* ========================================================================== */

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
  | "depth"
  | "groups"
  | "foundations"
  | "topics"
  | "paths"
  | "hood";
type SideTab = "ask" | "topic";

const LENSES: Array<{ id: Lens; label: string }> = [
  { id: "highlights", label: "Highlights" },
  { id: "depth", label: "Depth map" },
  { id: "groups", label: "Groups" },
  { id: "foundations", label: "Foundations" },
  { id: "topics", label: "All topics" },
  { id: "paths", label: "Paths" },
  { id: "hood", label: "Graph algorithms" },
];

const WELCOME =
  "Select a topic to see why Pathway rated it that way, or ask me anything about your graph. Topics I mention glow on the map.";
const EVIDENCE_ID = "topic-evidence";
const scrollToEvidence = () =>
  window.setTimeout(
    () =>
      document
        .getElementById(EVIDENCE_ID)
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    80,
  );

export default function OverviewPage() {
  const [model, setModel] = useState<Obj | null>(null);
  const [overview, setOverview] = useState<Obj | null>(null);
  const [groups, setGroups] = useState<Obj | null>(null);
  const [relations, setRelations] = useState<Obj | null>(null);
  const [graph, setGraph] = useState<Obj | null>(null);
  const [algos, setAlgos] = useState<Obj | null>(null);
  const [integrity, setIntegrity] = useState<Obj | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [partial, setPartial] = useState<string[]>([]);

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [qDraft, setQDraft] = useState("");
  const [job, setJob] = useState<Obj | null>(null);
  const [jobErr, setJobErr] = useState<string | null>(null);

  const [sel, setSel] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<Obj | null>(null);
  const [detail, setDetail] = useState<Obj | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTick, setDetailTick] = useState(0);

  const [sideTab, setSideTab] = useState<SideTab>("ask");
  const [lens, setLens] = useState<Lens>("highlights");
  const [colorBy, setColorBy] = useState("level");
  const [layoutMode, setLayoutMode] = useState<"areas" | "layers">("areas");
  const [showNeighbors, setShowNeighbors] = useState(true);
  const [pathFrom, setPathFrom] = useState("");
  const [pathTo, setPathTo] = useState("");
  const [pathRes, setPathRes] = useState<Obj | null>(null);
  const [pathErr, setPathErr] = useState<string | null>(null);
  const [groupDim, setGroupDim] = useState("domain");

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
      const [m, g, r, gr, a, ig] = await Promise.all([
        safe("model", getJson("/api/topics/model")),
        safe("groups", getJson(`/api/topics/groups${f}`)),
        safe("relations", getJson(`/api/topics/relations${f}`)),
        safe("graph", getJson(`/api/topics/graph${gq}`)),
        safe("algorithms", getJson(`/api/topics/algorithms${f}`)),
        safe("integrity", getJson(`/api/topics/integrity${f}`)),
      ]);
      if (m) setModel(m);
      if (g) setGroups(g);
      if (r) setRelations(r);
      if (gr) setGraph(gr);
      if (a) setAlgos(a);
      if (ig) setIntegrity(ig);
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
    const t = window.setTimeout(() => loadOverview().catch(() => {}), 200);
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
        setSelEdge(null);
        setSideTab("ask");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, sideTab]);

  /* ---------------- derived ---------------- */

  const nodes = useMemo(() => asArray<Obj>(graph?.nodes), [graph]);
  const edges = useMemo(() => asArray<Obj>(graph?.edges), [graph]);
  const layered = useMemo(() => layoutLayers(nodes), [nodes]);
  const areaPos = useMemo(() => layoutAreas(nodes, edges), [nodes, edges]);
  const positions = layoutMode === "layers" ? layered.pos : areaPos;
  const nodeBySlug = useMemo(
    () => new Map(nodes.map((n) => [asString(n.slug), n] as [string, Obj])),
    [nodes],
  );
  const pathIds = useMemo(
    () =>
      new Set<string>(
        asArray<Obj>(pathRes?.steps).map((s) => asString(s.slug)),
      ),
    [pathRes],
  );

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

  const selEdges = useMemo(() => {
    if (!sel) return { out: [] as Obj[], inc: [] as Obj[] };
    return {
      out: edges.filter((e) => e.source === sel),
      inc: edges.filter((e) => e.target === sel),
    };
  }, [edges, sel]);

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

  const pick = (slug: string) => {
    if (!slug) return;
    setSel(slug);
    setSelEdge(null);
    setSideTab("topic");
    if (
      typeof window !== "undefined" &&
      !window.matchMedia("(min-width: 1280px)").matches
    )
      window.setTimeout(
        () =>
          asideRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          }),
        60,
      );
  };

  const closeTopic = () => {
    setSel(null);
    setSelEdge(null);
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
          (b): b is Obj & { type: string } => typeof b.type === "string",
        );
        if (answer || blocks.length)
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
      } else if (r.status === 429) {
        reply = {
          text: asString(r.data.error, "Slow down a little."),
          slugs: [],
          local: false,
        };
      }
    } catch {
      /* local answer below */
    }
    if (!reply)
      reply = { ...localAnswer(text, { nodes, sel, detail }), local: true };
    const final = reply;
    const slugs = [...new Set(final.slugs.filter(Boolean))];
    setHighlight(new Set(slugs));
    patch((m) => ({ ...m, ...final, slugs, pending: false, steps: undefined }));
    setThinking(false);
  };

  const askAbout = (name: string) => {
    setSideTab("ask");
    setDraft(`Why does Pathway think I understand ${name} at this level?`);
  };

  /* ---------------- screens ---------------- */

  if (loading && !overview)
    return (
      <Screen>
        <InlineLoading label="Reading your knowledge graph…" />
      </Screen>
    );
  if (error && !overview)
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
          <div className="mt-5 flex justify-center">
            <Btn
              bg={YELLOW}
              onClick={() => {
                setError(null);
                setLoading(true);
                refreshAll().finally(() => setLoading(false));
              }}
            >
              Try again
            </Btn>
          </div>
        </div>
      </Screen>
    );
  if (!overview) return null;

  const topName = asString(
    asArray<Obj>(overview.highlights?.strongest)[0]?.name,
  );
  const builtName = asString(
    asArray<Obj>(overview.highlights?.builds)[0]?.name,
  );
  const prompts = [
    topName
      ? `Why does Pathway think I understand ${topName} deeply?`
      : "What am I strongest at?",
    builtName
      ? `Show me the code behind my ${builtName}`
      : "What have I built myself?",
    "Which topics are inferred rather than seen in code?",
  ];

  const highlightRows = (
    [
      ["strongest", "Strongest", GREEN, "Deepest assessed topics"],
      ["builds", "Built yourself", PURPLE, "Own implementation behind them"],
      ["topFoundations", "Foundations", SKY, "Highest PageRank in the graph"],
      ["topBridges", "Bridges", CORAL, "Highest betweenness in the graph"],
      ["recentlyActive", "Recently active", YELLOW, "Touched lately"],
      ["broadButShallow", "Broad but shallow", "#9ca3af", "Wide, not deep"],
      ["lowConfidence", "Thin evidence", "#d1d5db", "Little code behind them"],
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

  const integrityFailed = asArray<Obj>(integrity?.checks).filter(
    (c) => !c.passed,
  ).length;
  const evidenceTotal = Object.values(
    (stats.evidence?.byKind ?? {}) as Record<string, number>,
  ).reduce((n, v) => n + num(v), 0);
  const gstats = (graph?.stats ?? {}) as Obj;

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
        html { scroll-behavior: smooth; }
        .press { transition: transform .16s cubic-bezier(.2,.8,.2,1), box-shadow .16s ease, background-color .2s ease, opacity .2s ease; }
        .press:hover:not(:disabled) { transform: translateY(-2px); }
        .press:active:not(:disabled) { transform: translateY(1px) scale(.97); }
        button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 3px solid ${SKY}; outline-offset: 2px; }
        svg g:focus-visible { outline: 3px solid ${SKY}; outline-offset: 2px; }
        details > summary { list-style: none; }
        details > summary::-webkit-details-marker { display: none; }
        @keyframes ostripe { to { background-position: 28px 0; } }
        @keyframes oblink { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
        @keyframes oring { 0% { r: 0; opacity: .9; } 100% { r: 46; opacity: 0; } }
        @keyframes osweep { to { transform: rotate(360deg); } }
        @keyframes opop { from { opacity: 0; transform: scale(.2); } to { opacity: 1; transform: scale(1); } }
        @keyframes oslide { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes ofloat { 0%,100% { transform: translate(0,0); } 50% { transform: translate(0,-3px); } }
        @keyframes odraw { from { stroke-dasharray: 1; stroke-dashoffset: 1; } to { stroke-dasharray: 1; stroke-dashoffset: 0; } }
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
                className="press rounded-full px-3 py-1.5 text-[13px] font-bold"
              >
                Skill graph
              </Link>
              <Link
                to="/builds"
                className="press rounded-full px-3 py-1.5 text-[13px] font-bold"
              >
                Builds
              </Link>
            </nav>
          </div>
          <Btn
            onClick={() => void refreshAll(true)}
            disabled={refreshing}
            bg={YELLOW}
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />{" "}
            Refresh
          </Btn>
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
        {status.outdated && (
          <div
            className="mb-3 rounded-xl p-2.5 text-[13px] font-bold"
            style={{ backgroundColor: YELLOW, ...border }}
          >
            These assessments come from an older analysis version. Re-run the
            analysis to refresh them.
          </div>
        )}

        {/* 1. HEADLINE */}
        <section className="mb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 lg:max-w-[60%]">
              <p className="text-[12px] font-black uppercase tracking-[.14em] text-neutral-700">
                Your engineering knowledge graph
              </p>
              <h1
                className="mt-0.5 text-[20px] font-black leading-[1.2] tracking-tight sm:text-[24px]"
                style={{ fontFamily: DISPLAY_FONT, ...clamp(2) }}
                title={asString(summary?.headline)}
              >
                {summary?.headline
                  ? asString(summary.headline)
                  : analyzed
                    ? "What you know, how deeply, and the evidence behind it."
                    : "No topics yet. Run the analysis to map what you know."}
              </h1>
              {summary?.pattern && (
                <p className="mt-1 text-[13px] leading-5 text-neutral-800">
                  {asString(summary.pattern)}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {running ? (
                <RunMini job={job} step={stepOf(job)} model={model} />
              ) : (
                <>
                  {status.lastAnalyzedAt && (
                    <span className="text-[12px] font-semibold text-neutral-700">
                      analyzed {timeAgo(asString(status.lastAnalyzedAt))}
                    </span>
                  )}
                  <Btn onClick={() => void startAnalysis()} bg={YELLOW}>
                    <Play size={12} />{" "}
                    {analyzed ? "Re-run analysis" : "Run analysis"}
                  </Btn>
                </>
              )}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              value={num(stats.topics)}
              label="Topics analyzed"
              hint="Concepts found in your code"
            />
            <Tile
              value={num(stats.deepTopics)}
              label="Deep understanding"
              hint="Built, hardened and evolved by you"
            />
            <Tile
              value={num(stats.ownImplementations)}
              label="Built yourself"
              hint="Your own implementation is cited"
            />
            <Tile
              value={evidenceTotal}
              label="Evidence items"
              hint="Code and commits cited in the graph"
            />
          </div>

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
                    <Dot color={LEVEL_COLOR[l]} />
                    {levelMix[l]} {LEVEL_LABEL[l].toLowerCase()}
                  </span>
                ))}
              </div>
            </div>
          )}
          {jobErr && (
            <p className="mt-2 text-[13px] font-bold" style={{ color: CORAL }}>
              {jobErr}
            </p>
          )}
        </section>

        {/* 2. KNOWLEDGE GRAPH + SIDE PANEL */}
        <div className="grid gap-4 xl:h-[calc(100vh-300px)] xl:min-h-[640px] xl:grid-cols-[minmax(0,1fr)_420px] xl:grid-rows-[minmax(0,1fr)]">
          <section
            className="flex h-[620px] min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl xl:h-full"
            style={{
              backgroundColor: "#F8F6F1",
              backgroundImage:
                "radial-gradient(circle at 50% 38%, #FFFDF8 0%, #F4F1E9 55%, #ECE8DD 100%)",
              ...border,
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-2.5">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h2
                  className="text-[16px] font-black"
                  style={{ fontFamily: DISPLAY_FONT }}
                >
                  Knowledge graph
                </h2>
                <span className="text-[12px] font-semibold text-neutral-800">
                  size = depth · ring = score · tap a topic or a line
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div
                  className="flex rounded-full p-0.5"
                  style={{ backgroundColor: WHITE, ...border }}
                >
                  {(
                    [
                      ["areas", "By area"],
                      ["layers", "By depth"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setLayoutMode(k)}
                      className="press rounded-full px-2.5 py-0.5 text-[12px] font-black"
                      style={{
                        backgroundColor:
                          layoutMode === k ? YELLOW : "transparent",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <select
                  value={colorBy}
                  onChange={(e) => setColorBy(e.target.value)}
                  aria-label="Colour by"
                  className="press rounded-full bg-white px-2.5 py-1 text-[12px] font-bold outline-none"
                  style={border}
                >
                  <option value="level">Colour: depth</option>
                  <option value="domain">Colour: area</option>
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

            {nodes.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 px-4 pb-1 pt-1.5 text-[12px] font-bold text-neutral-800">
                <span>{num(gstats.assessedNodes)} assessed</span>
                <span>{num(gstats.externalNodes)} unassessed neighbours</span>
                <span>{num(gstats.buildsOn)} “builds on” links</span>
                <span>{num(gstats.related)} “goes with” links</span>
                <span>
                  {
                    asArray<Obj>(dims.find((d) => d.id === "community")?.groups)
                      .length
                  }{" "}
                  communities
                </span>
              </div>
            )}

            {nodes.length ? (
              <>
                <div className="relative min-h-[240px] flex-1 overflow-hidden">
                  <TopicGraph
                    nodes={nodes}
                    edges={edges}
                    pos={positions}
                    bands={layoutMode === "layers" ? layered.bands : null}
                    colorBy={colorBy}
                    selected={sel}
                    selectedEdge={asString(selEdge?.id)}
                    glow={highlight}
                    pathIds={pathIds}
                    running={running}
                    onSelect={(n) =>
                      n.assessed ? pick(asString(n.slug)) : undefined
                    }
                    onEdge={(e) => setSelEdge(e)}
                  />
                </div>
                <RelationInspector
                  sel={sel}
                  selName={asString(nodeBySlug.get(sel ?? "")?.label)}
                  edge={selEdge}
                  out={selEdges.out}
                  inc={selEdges.inc}
                  nodeBySlug={nodeBySlug}
                  onEdge={setSelEdge}
                />
              </>
            ) : (
              <div className="p-5 pt-2">
                <Empty text="No topic graph yet. Run the analysis to build it." />
              </div>
            )}
          </section>

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
                <div
                  role="tablist"
                  aria-label="Side panel"
                  className="flex items-center gap-1 rounded-full p-0.5"
                  style={{ backgroundColor: WHITE, ...border }}
                >
                  {(
                    [
                      [
                        "ask",
                        "Ask your graph",
                        <MessageCircle key="a" size={13} />,
                      ],
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
                        className="press inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-black disabled:opacity-40"
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
                  <Dot color={GREEN} /> grounded in your graph
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
                            className="press rounded-full px-2.5 py-1 text-left text-[12px] font-bold"
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
                        aria-label="Ask about your knowledge graph"
                        className="min-w-0 flex-1 rounded-full bg-white px-4 py-2 text-[13px] font-semibold outline-none"
                        style={border}
                      />
                      <button
                        type="submit"
                        disabled={!draft.trim() || thinking}
                        aria-label="Send"
                        className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
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

        {/* 3. TOPIC EVIDENCE: graph first, details after */}
        {sel && detail && (
          <TopicEvidence
            key={sel}
            slug={sel}
            detail={detail}
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
                className="press shrink-0 rounded-full p-1.5"
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

        {/* 4. EXPLORE */}
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
                className="press -mb-[2px] px-1 pb-2 pt-1 text-[14px] font-black"
                style={{
                  borderBottom: `4px solid ${lens === l.id ? CORAL : "transparent"}`,
                  color: lens === l.id ? INK : "#33362f",
                }}
              >
                {l.label}
                {l.id === "hood" && integrityFailed > 0 && (
                  <span
                    className="ml-1.5 rounded-full px-1.5 text-[11px]"
                    style={{ backgroundColor: CORAL, color: WHITE }}
                  >
                    {integrityFailed}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div
            key={lens}
            className="pt-4"
            style={{ animation: "oslide .25s ease-out both" }}
          >
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

            {lens === "depth" &&
              (domainGroups.length ? (
                <div
                  className="rounded-2xl p-4"
                  style={{ backgroundColor: WHITE, ...border }}
                >
                  <p className="mb-3 text-[13px] leading-5 text-neutral-800">
                    Rows are engineering areas, columns are depth. Each topic
                    lands where its evidence puts it.
                  </p>
                  <div className="overflow-x-auto">
                    <div
                      className="grid min-w-[640px] gap-2"
                      style={{
                        gridTemplateColumns: "140px repeat(4, minmax(0, 1fr))",
                      }}
                    >
                      <div />
                      {["surface", "working", "proficient", "deep"].map((l) => (
                        <div
                          key={l}
                          className="flex items-center gap-1.5 px-1 pb-1 text-[13px] font-black"
                        >
                          <Dot color={LEVEL_COLOR[l]} /> {LEVEL_LABEL[l]}
                        </div>
                      ))}
                      {domainGroups.map((g) => (
                        <DepthRow key={asString(g.key)} g={g} onPick={pick} />
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <Empty text="The depth map appears once topics are assessed." />
              ))}

            {lens === "groups" &&
              (activeDim ? (
                <div>
                  <div className="mb-2 flex flex-wrap gap-2">
                    {dims.map((x) => (
                      <button
                        key={asString(x.id)}
                        type="button"
                        onClick={() => setGroupDim(asString(x.id))}
                        className="press rounded-full px-3 py-1 text-[13px] font-black"
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
                          {g.internalLinks != null
                            ? ` · ${num(g.internalLinks)} links inside`
                            : ""}
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

            {lens === "foundations" &&
              (relations ? (
                <div className="grid gap-5 lg:grid-cols-2">
                  <div>
                    <div className="mb-2 text-[13px] font-black">
                      Strong topics on weak or unverified foundations
                    </div>
                    <div className="space-y-2.5">
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
                          className="press block w-full pl-3 text-left"
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
                  <div>
                    <div className="mb-2 text-[13px] font-black">
                      Topics that build on what you know
                    </div>
                    <div className="space-y-2.5">
                      {asArray<Obj>(relations.frontier).length === 0 && (
                        <span className="text-[13px] text-neutral-800">
                          No unassessed topic builds on your assessed ones yet.
                        </span>
                      )}
                      {asArray<Obj>(relations.frontier).map((f) => (
                        <div
                          key={asString(f.slug)}
                          className="pl-3"
                          style={{ borderLeft: `4px solid ${SKY}` }}
                        >
                          <div className="text-[13px] font-black">
                            {asString(f.name)}
                          </div>
                          <p className="text-[12px] leading-4 text-neutral-800">
                            {asString(f.message)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <Empty text="Relations could not be loaded." />
              ))}

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
                        className="press flex w-full items-center gap-3 py-2.5 text-left hover:bg-black/[.04]"
                        style={{
                          borderBottom: `1px solid ${LINE}`,
                          backgroundColor:
                            sel === c.slug ? `${YELLOW}55` : undefined,
                        }}
                      >
                        <Dot color={LEVEL_COLOR[asString(c.level)] ?? CARD} />
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
                          {num(c.score)} · {asString(c.confidence)} conf.
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

            {lens === "paths" && (
              <div>
                <p className="mb-3 text-[13px] text-neutral-800">
                  Pick two topics to see the shortest route through the graph.
                  Each hop says whether it is a foundation or just an
                  association.
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
                  <div
                    className="mt-4 flex flex-wrap items-center gap-2"
                    style={{ animation: "oslide .25s ease-out both" }}
                  >
                    {asArray<Obj>(pathRes.steps).map((s, i) => {
                      const seg = asArray<Obj>(pathRes.segments)[i - 1];
                      return (
                        <span
                          key={i}
                          className="inline-flex items-center gap-2"
                        >
                          {seg && (
                            <span
                              className="rounded-full px-2 py-0.5 text-[11px] font-black"
                              style={{
                                backgroundColor:
                                  seg.type === "BUILDS_ON" ? SKY : LAVENDER,
                                ...border,
                              }}
                            >
                              {seg.type === "BUILDS_ON"
                                ? "builds on"
                                : "goes with"}
                            </span>
                          )}
                          <TopicChip
                            t={s}
                            onClick={() =>
                              s.assessed ? pick(asString(s.slug)) : undefined
                            }
                          />
                        </span>
                      );
                    })}
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

            {lens === "hood" && (
              <div className="space-y-4">
                <p className="text-[13px] leading-5 text-neutral-800">
                  FalkorDB runs graph algorithms over the shared topic map. They
                  describe how topics are structured. Your skill level always
                  comes from your code, never from these scores.
                </p>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {asArray<Obj>(algos?.algorithms)
                    .filter((a) => a.engine !== "in-process")
                    .map((a) => (
                      <AlgoCard key={asString(a.id)} a={a} onPick={pick} />
                    ))}
                </div>
                {!algos && (
                  <Empty text="Algorithm details could not be loaded." />
                )}

                {integrity && (
                  <div
                    className="rounded-2xl p-3"
                    style={{ backgroundColor: WHITE, ...border }}
                  >
                    <div className="flex items-center gap-2 text-[14px] font-black">
                      <ShieldCheck
                        size={16}
                        color={integrity.passed ? GREEN : CORAL}
                      />
                      Graph health
                      <Chip
                        text={
                          integrity.passed
                            ? "all checks pass"
                            : `${integrityFailed} need attention`
                        }
                        background={integrity.passed ? GREEN : CORAL}
                        color={WHITE}
                      />
                    </div>
                    <ul className="mt-2 grid gap-1.5 md:grid-cols-2">
                      {asArray<Obj>(integrity.checks).map((c) => (
                        <li
                          key={asString(c.id)}
                          className="flex items-start gap-2 text-[12px] leading-4"
                        >
                          <span className="mt-0.5">
                            <Dot color={c.passed ? GREEN : CORAL} small />
                          </span>
                          <span>
                            <b>{humanize(asString(c.id))}:</b>{" "}
                            {asString(c.detail)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <Fold title="How ratings are protected from inflation">
                  <ul className="grid gap-2 md:grid-cols-2">
                    {asArray<string>(model?.scoring?.guardRails).map((g, i) => (
                      <li
                        key={i}
                        className="pl-3 text-[13px] leading-5 text-neutral-900"
                        style={{ borderLeft: `3px solid ${LINE}` }}
                      >
                        {g}
                      </li>
                    ))}
                  </ul>
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
        className="press fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full px-4 py-3 text-[13px] font-black xl:hidden"
        style={{ backgroundColor: YELLOW, ...border, boxShadow: shadow(3) }}
      >
        <MessageCircle size={16} /> Ask
      </button>
    </div>
  );
}

/* ========================================================================== */
/* DEPTH MAP ROW                                                              */
/* ========================================================================== */

function DepthRow({ g, onPick }: { g: Obj; onPick: (slug: string) => void }) {
  const topics = asArray<Obj>(g.topics);
  return (
    <>
      <div className="flex flex-col justify-center px-1">
        <span
          className="text-[13px] font-black"
          style={{ fontFamily: DISPLAY_FONT }}
        >
          {asString(g.label)}
        </span>
        <span className="text-[11px] text-neutral-700">
          {num(g.count)} topics
        </span>
      </div>
      {["surface", "working", "proficient", "deep"].map((l) => {
        const cell = topics.filter((t) => asString(t.level) === l);
        return (
          <div
            key={l}
            className="flex min-h-[54px] flex-wrap content-center gap-1 rounded-xl p-1.5"
            style={{
              backgroundColor: cell.length ? `${LEVEL_COLOR[l]}2A` : "#F7F4EC",
              border: `1.5px ${cell.length ? "solid" : "dashed"} ${cell.length ? LEVEL_COLOR[l] : LINE}`,
            }}
          >
            {cell.map((t) => (
              <button
                key={asString(t.slug)}
                type="button"
                onClick={() => onPick(asString(t.slug))}
                className="press rounded-full px-2 py-0.5 text-[11px] font-bold"
                style={{ backgroundColor: WHITE, ...border }}
              >
                {cut(asString(t.name), 20)}
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}

/* ========================================================================== */
/* ALGORITHM CARD (what FalkorDB computed, in plain words)                    */
/* ========================================================================== */

function AlgoCard({ a, onPick }: { a: Obj; onPick: (slug: string) => void }) {
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
  const chips: Obj[] =
    a.id === "pagerank"
      ? asArray<Obj>(f.topFoundations)
      : a.id === "betweenness"
        ? asArray<Obj>(f.topBridges)
        : [];
  return (
    <div
      className="rounded-2xl p-3.5"
      style={{
        backgroundColor: WHITE,
        ...border,
        borderTop: `6px solid ${engineBg}`,
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="text-[14px] font-black"
          style={{ fontFamily: DISPLAY_FONT }}
        >
          {asString(a.name)}
        </span>
        <Chip text={asString(a.engine)} background={engineBg} />
      </div>
      <p className="mt-1 text-[13px] font-bold leading-5">{asString(a.role)}</p>
      <p className="mt-0.5 text-[12px] leading-4 text-neutral-700">
        {a.affectsAssessment
          ? "Also feeds the confidence of each rating."
          : "Describes structure only."}
      </p>
      {st && (
        <div className="mt-2 flex items-center gap-2 text-[12px] font-bold text-neutral-800">
          <span
            className="relative inline-block h-2 flex-1 overflow-hidden rounded-full"
            style={{ backgroundColor: CARD, border: `1.5px solid ${INK}` }}
          >
            <span
              className="absolute inset-y-0 left-0"
              style={{
                width: `${num(st.coverage) * 100}%`,
                backgroundColor: st.computed ? GREEN : CORAL,
                transition: "width .6s ease",
              }}
            />
          </span>
          {Math.round(num(st.coverage) * 100)}% of topics
        </div>
      )}
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((x) => (
            <TopicChip
              key={asString(x.topic?.slug)}
              t={x.topic}
              onClick={() => onPick(asString(x.topic?.slug))}
            />
          ))}
        </div>
      )}
      {a.id === "label_propagation" && (
        <p className="mt-2 text-[12px] font-bold">
          {num(f.communities)} communities
          {f.largest ? ` · largest: ${asString(f.largest.label)}` : ""}
        </p>
      )}
      {a.id === "wcc" && (
        <p className="mt-2 text-[12px] font-bold">
          {num(f.components)} components · main body {num(f.mainSize)} topics
        </p>
      )}
    </div>
  );
}

/* ========================================================================== */
/* RELATIONSHIP INSPECTOR                                                     */
/* ========================================================================== */

const REL_LABEL = (type: string) =>
  type === "BUILDS_ON" ? "builds on" : "goes with";

function RelationInspector({
  sel,
  selName,
  edge,
  out,
  inc,
  nodeBySlug,
  onEdge,
}: {
  sel: string | null;
  selName: string;
  edge: Obj | null;
  out: Obj[];
  inc: Obj[];
  nodeBySlug: Map<string, Obj>;
  onEdge: (e: Obj | null) => void;
}) {
  const nameOf = (slug: string) =>
    asString(nodeBySlug.get(slug)?.label) || humanize(slug);
  const pill = (type: string, text: string) => (
    <span
      className="mr-1 rounded-full px-1.5 py-px text-[10px] font-black"
      style={{
        backgroundColor: type === "BUILDS_ON" ? SKY : LAVENDER,
        border: `1.5px solid ${INK}`,
      }}
    >
      {text}
    </span>
  );
  const row = (e: Obj, other: string, label: string) => (
    <li key={asString(e.id)} className="text-[12px] leading-4">
      <button
        type="button"
        onClick={() => onEdge(e)}
        className="press text-left"
      >
        {pill(asString(e.type), label)}
        <b>{nameOf(other)}</b>
      </button>
      {asString(e.reason) && (
        <span className="text-neutral-700">
          {" "}
          — {cut(asString(e.reason), 80)}
        </span>
      )}
    </li>
  );
  return (
    <div
      className="max-h-[170px] shrink-0 overflow-y-auto px-4 py-2.5 text-[12px]"
      style={{ borderTop: `1px solid ${LINE}`, color: INK }}
    >
      {edge ? (
        <div
          className="flex items-start justify-between gap-3"
          style={{ animation: "oslide .25s ease-out both" }}
        >
          <div>
            <div className="text-[13px] font-black">
              {nameOf(asString(edge.source))}{" "}
              {pill(asString(edge.type), REL_LABEL(asString(edge.type)))}{" "}
              {nameOf(asString(edge.target))}
            </div>
            <p className="mt-1 text-[13px] leading-5 text-neutral-900">
              {asString(edge.reason) ||
                "The graph records this link without a stated reason."}
            </p>
            <p className="text-[11px] leading-4 text-neutral-700">
              {edge.type === "BUILDS_ON"
                ? edge.trusted === false
                  ? "No stated reason, so it is ignored for prerequisites."
                  : "The first topic stands on the second."
                : "Often used together. Not a prerequisite and not proof of skill."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onEdge(null)}
            aria-label="Close connection"
            className="press shrink-0 rounded-full p-1"
            style={{ backgroundColor: WHITE, ...border }}
          >
            <X size={12} />
          </button>
        </div>
      ) : sel ? (
        out.length + inc.length === 0 ? (
          <p className="font-semibold text-neutral-800">
            {selName || humanize(sel)} has no recorded link to other topics.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 font-black text-neutral-700">
                Outgoing from {selName || humanize(sel)}
              </div>
              <ul className="space-y-1">
                {out.length === 0 && <li className="text-neutral-700">None</li>}
                {out
                  .slice(0, 5)
                  .map((e) =>
                    row(e, asString(e.target), REL_LABEL(asString(e.type))),
                  )}
              </ul>
            </div>
            <div>
              <div className="mb-1 font-black text-neutral-700">
                Incoming to {selName || humanize(sel)}
              </div>
              <ul className="space-y-1">
                {inc.length === 0 && <li className="text-neutral-700">None</li>}
                {inc
                  .slice(0, 5)
                  .map((e) =>
                    row(
                      e,
                      asString(e.source),
                      `${REL_LABEL(asString(e.type))} it`,
                    ),
                  )}
              </ul>
            </div>
          </div>
        )
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-semibold">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-5" style={{ backgroundColor: INK }} />{" "}
            builds on (arrow to the foundation)
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-0.5 w-5"
              style={{ borderTop: `2px dashed ${INK}` }}
            />{" "}
            goes with
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-3 w-3 rounded-full"
              style={{ border: `3px solid ${SKY}` }}
            />{" "}
            foundation
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-3 w-3 rounded-full"
              style={{ border: `3px dashed ${CORAL}` }}
            />{" "}
            bridge
          </span>
          <span className="ml-auto text-neutral-800">
            Click a topic to light up its links, or a line to see why it exists.
          </span>
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */
/* RUN PROGRESS                                                               */
/* ========================================================================== */

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
          const cx = 40 + Math.cos(a) * r;
          const cy = 40 + Math.sin(a) * r;
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r="2.6"
              fill={i % 2 ? CORAL : SKY}
              style={{
                transformOrigin: `${cx}px ${cy}px`,
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
                className="h-1.5 flex-1 rounded-full transition-colors duration-500"
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

/* ========================================================================== */
/* KNOWLEDGE GRAPH VIEW                                                       */
/* ========================================================================== */

const radiusOf = (n: Obj) => Math.min(24, Math.max(9, num(n.size, 16) * 0.5));

function nodeFill(n: Obj, colorBy: string): string {
  if (!n.assessed) return "#D9D5CA";
  const byLevel = LEVEL_COLOR[asString(n.level)] ?? CARD;
  if (colorBy === "level") return byLevel;
  const v =
    colorBy === "domain"
      ? (n.domain ?? n.domainLabel)
      : (n.cluster ?? n.clusterId);
  if (v == null || v === "") return byLevel;
  return PALETTE[hash(asString(v)) % PALETTE.length];
}

function TopicGraph({
  nodes,
  edges,
  pos,
  bands,
  colorBy,
  selected,
  selectedEdge,
  glow,
  pathIds,
  running,
  onSelect,
  onEdge,
}: {
  nodes: Obj[];
  edges: Obj[];
  pos: Map<string, Pt>;
  bands: Array<{ rank: number; y: number }> | null;
  colorBy: string;
  selected: string | null;
  selectedEdge: string;
  glow: Set<string>;
  pathIds: Set<string>;
  running: boolean;
  onSelect: (n: Obj) => void;
  onEdge: (e: Obj) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const byId = useMemo(
    () => new Map(nodes.map((n) => [asString(n.id), n] as [string, Obj])),
    [nodes],
  );
  const focusId = hover ?? selected;
  const focusSet = useMemo(() => {
    if (!focusId) return null;
    const s = new Set<string>([focusId]);
    for (const e of edges) {
      if (e.source === focusId) s.add(asString(e.target));
      if (e.target === focusId) s.add(asString(e.source));
    }
    return s;
  }, [focusId, edges]);

  /* soft hulls around each engineering area (areas layout only) */
  const hulls = useMemo(() => {
    if (bands) return [];
    const by = new Map<string, Obj[]>();
    nodes
      .filter((n) => n.assessed)
      .forEach((n) =>
        by.set(asString(n.domain), [...(by.get(asString(n.domain)) ?? []), n]),
      );
    return [...by.entries()]
      .filter(([, list]) => list.length >= 2)
      .map(([domain, list]) => {
        const pts = list
          .map((n) => pos.get(asString(n.id)))
          .filter((p): p is Pt => !!p);
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        const r =
          Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy))) + 52;
        return { domain, cx, cy, r };
      });
  }, [nodes, pos, bands]);

  const hn = hover ? byId.get(hover) : null;
  const hp = hover ? pos.get(hover) : null;

  return (
    <>
      <svg
        viewBox={`0 0 ${GW} ${GH}`}
        className="absolute inset-0 block h-full w-full"
        role="group"
        aria-label="Graph of your engineering topics"
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

        {bands?.map((b) => (
          <g key={b.rank}>
            <line
              x1={60}
              x2={GW - 20}
              y1={b.y}
              y2={b.y}
              stroke={INK}
              strokeOpacity=".1"
              strokeDasharray="3 6"
            />
            <text
              x={14}
              y={b.y + 4}
              fontSize="12"
              fontWeight={900}
              fontFamily={DISPLAY_FONT}
              style={{
                fill:
                  b.rank < 0
                    ? "#6b7280"
                    : (LEVEL_COLOR[LEVEL_ORDER[4 - b.rank]] ?? INK),
              }}
            >
              {b.rank < 0
                ? "Not assessed"
                : LEVEL_LABEL[LEVEL_ORDER[4 - b.rank]]}
            </text>
          </g>
        ))}
        {hulls.map((h, i) => (
          <g key={h.domain} style={{ pointerEvents: "none" }}>
            <circle
              cx={h.cx}
              cy={h.cy}
              r={h.r}
              fill={PALETTE[hash(h.domain) % PALETTE.length]}
              fillOpacity=".1"
              stroke={INK}
              strokeOpacity=".25"
              strokeDasharray="5 6"
              style={{
                animation: `opop .6s ${i * 0.06}s ease-out both`,
                transformOrigin: `${h.cx}px ${h.cy}px`,
              }}
            />
            <text
              x={h.cx}
              y={h.cy - h.r - 6}
              textAnchor="middle"
              fontSize="12"
              fontWeight={900}
              fontFamily={DISPLAY_FONT}
              style={{ fill: INK, opacity: 0.55 }}
            >
              {humanize(h.domain)}
            </text>
          </g>
        ))}

        {edges.map((e) => {
          const a = pos.get(asString(e.source));
          const b = pos.get(asString(e.target));
          const na = byId.get(asString(e.source));
          const nb = byId.get(asString(e.target));
          if (!a || !b || !na || !nb) return null;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.max(Math.hypot(dx, dy), 1);
          const x1 = a.x + (dx / d) * (radiusOf(na) + 3);
          const y1 = a.y + (dy / d) * (radiusOf(na) + 3);
          const x2 = b.x - (dx / d) * (radiusOf(nb) + 6);
          const y2 = b.y - (dy / d) * (radiusOf(nb) + 6);
          const onPath =
            pathIds.has(asString(e.source)) && pathIds.has(asString(e.target));
          const touch =
            focusId && (e.source === focusId || e.target === focusId);
          const isSel = selectedEdge !== "" && selectedEdge === asString(e.id);
          const untrusted = e.type === "BUILDS_ON" && e.trusted === false;
          const op = focusSet
            ? touch
              ? 0.95
              : 0.06
            : onPath
              ? 1
              : untrusted
                ? 0.2
                : 0.4;
          return (
            <g key={asString(e.id)}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={onPath || isSel ? CORAL : INK}
                strokeWidth={onPath || isSel ? 4 : touch ? 2.5 : 1.5}
                strokeDasharray={e.directed && !untrusted ? undefined : "4 5"}
                opacity={isSel ? 1 : op}
                markerEnd={e.directed ? "url(#tarrow)" : undefined}
                style={{
                  transition: "opacity .3s ease, stroke-width .2s ease",
                }}
              />
              {touch && (
                <text
                  x={(x1 + x2) / 2}
                  y={(y1 + y2) / 2 - 5}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight={800}
                  fontFamily={BODY_FONT}
                  style={{
                    fill: INK,
                    paintOrder: "stroke",
                    stroke: "#F8F6F1",
                    strokeWidth: 4,
                    pointerEvents: "none",
                  }}
                >
                  {REL_LABEL(asString(e.type))}
                </text>
              )}
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="transparent"
                strokeWidth={14}
                style={{ cursor: "pointer" }}
                onClick={() => onEdge(e)}
              >
                <title>{`${asString(na.label)} ${REL_LABEL(asString(e.type))} ${asString(nb.label)}`}</title>
              </line>
            </g>
          );
        })}

        {nodes.map((n, i) => {
          const p = pos.get(asString(n.id));
          if (!p) return null;
          const r = radiusOf(n);
          const id = asString(n.id);
          const sel = selected === n.slug;
          const dim = focusSet ? !focusSet.has(id) : false;
          const roles = asArray<string>(n.roles);
          const showLabel = n.assessed || hover === id;
          const above = nodes.length > 8 && i % 2 === 1;
          const arc = 2 * Math.PI * (r + 4);
          const score = n.assessed
            ? Math.max(0, Math.min(100, num(n.score)))
            : 0;
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
                transition: "opacity .3s ease",
                animation: `ofloat ${5 + (i % 4)}s ${-(i % 7) * 0.8}s ease-in-out infinite`,
              }}
            >
              {glow.has(id) && (
                <>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={r + 13}
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
                  r={r + 9}
                  fill="none"
                  stroke={SKY}
                  strokeWidth="3.5"
                />
              )}
              {roles.includes("bridge") && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r + (roles.includes("foundation") ? 15 : 9)}
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
                  r={r + 20}
                  fill="none"
                  stroke={CORAL}
                  strokeWidth="3"
                />
              )}
              {n.assessed && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r + 4}
                  fill="none"
                  stroke={INK}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={`${(score / 100) * arc} ${arc}`}
                  transform={`rotate(-90 ${p.x} ${p.y})`}
                  opacity=".85"
                  style={{ transition: "stroke-dasharray .6s ease" }}
                />
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={r}
                fill={nodeFill(n, colorBy)}
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
                  y={above ? p.y - r - 12 : p.y + r + 18}
                  textAnchor="middle"
                  fontSize={n.assessed ? 13 : 11}
                  fontWeight={n.assessed ? 800 : 600}
                  fontFamily={BODY_FONT}
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

      {hn && hp && (
        <div
          className="pointer-events-none absolute z-20 w-[210px] rounded-xl p-2.5 text-[12px] leading-4"
          style={{
            left: `${(hp.x / GW) * 100}%`,
            top: `${(hp.y / GH) * 100}%`,
            transform: `translate(${hp.x > GW * 0.65 ? "-112%" : "16px"}, -50%)`,
            backgroundColor: INK,
            color: PAPER,
            animation: "oslide .15s ease-out both",
          }}
        >
          <div className="text-[13px] font-black">{asString(hn.label)}</div>
          {hn.assessed ? (
            <>
              <div className="mt-0.5 opacity-80">
                {LEVEL_LABEL[asString(hn.level)] ?? ""} · score {num(hn.score)}{" "}
                · {asString(hn.confidence)} confidence
              </div>
              <div className="opacity-80">
                {num(hn.files)} files · {num(hn.commits)} commits
              </div>
              {asArray<string>(hn.roles).length > 0 && (
                <div className="mt-0.5 font-bold" style={{ color: YELLOW }}>
                  {asArray<string>(hn.roles).map(humanize).join(" + ")}
                </div>
              )}
            </>
          ) : (
            <div className="mt-0.5 opacity-80">
              Linked in the topic map, not assessed yet
            </div>
          )}
        </div>
      )}
    </>
  );
}

/* ========================================================================== */
/* TOPIC PANEL (side)                                                         */
/* ========================================================================== */

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
  const tr = (detail?.trace ?? {}) as Obj;
  const level = asString(t.level);
  const band = asArray<number>(sc.band);
  const name = asString(t.name) || humanize(slug);
  const k = useMemo(() => claimsOf(detail), [detail]);
  const flags = asArray<string>(tr.contradictions);

  return (
    <div
      className="space-y-4"
      style={{ animation: "oslide .25s ease-out both" }}
    >
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
            {asString(t.domainLabel)} ·{" "}
            {AUTH_LABEL[asString(t.authenticity)] ??
              asString(t.authenticityLabel)}{" "}
            · {asString(t.confidence)} confidence
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="press shrink-0 rounded-full p-1.5"
          style={{ backgroundColor: WHITE, ...border }}
        >
          <X size={14} />
        </button>
      </div>

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
          {flags.length > 0 && (
            <div
              className="rounded-xl p-2.5 text-[12px] leading-4"
              style={{ backgroundColor: `${CORAL}22`, ...border }}
            >
              <b>Evidence conflicts with the rating:</b> {flags[0]}
              {flags.length > 1 ? ` (+${flags.length - 1} more below)` : ""}
            </div>
          )}
          <div>
            <div className="flex items-center justify-between text-[13px] font-black">
              <span>Score {num(sc.score)}</span>
              {band.length === 2 && (
                <span className="text-neutral-700">
                  band {band[0]}–{band[1]}
                </span>
              )}
            </div>
            <div
              className="mt-1.5 h-3 overflow-hidden rounded-full"
              style={{ backgroundColor: CARD, border: `1.5px solid ${INK}` }}
            >
              <div
                className="h-full transition-all duration-700"
                style={{
                  width: `${num(sc.score)}%`,
                  backgroundColor: LEVEL_COLOR[level] ?? SKY,
                }}
              />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <MiniStat label="Files" value={num(t.evidence?.files)} />
            <MiniStat label="Commits" value={num(t.evidence?.commits)} />
            <MiniStat label="Repos" value={num(t.evidence?.repos)} />
            <MiniStat
              label="Evidence"
              value={asArray(tr.supportingEvidence).length}
            />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {(
              [
                ["Observed", k.observed.length, GREEN, WHITE],
                ["Inferred", k.inferred.length, YELLOW, INK],
                ["Unknown", k.unknown.length, CORAL, WHITE],
              ] as const
            ).map(([label, n, bg, fg]) => (
              <div
                key={label}
                className="rounded-xl py-2"
                style={{ backgroundColor: bg, color: fg, ...border }}
              >
                <div
                  className="text-[18px] font-black leading-none"
                  style={{ fontFamily: DISPLAY_FONT }}
                >
                  {n}
                </div>
                <div className="mt-0.5 text-[11px] font-black uppercase">
                  {label}
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={onEvidence}
            className="press flex w-full items-center justify-between rounded-xl px-3 py-2 text-[13px] font-black"
            style={{ backgroundColor: YELLOW, ...border }}
          >
            <span>See the evidence graph below</span>
            <ChevronRight size={14} strokeWidth={3} />
          </button>
          <Block title="Why this confidence">
            <ConfidenceBox c={detail.confidence} />
          </Block>
          <Fold title="How it connects" open>
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
                title="Builds on"
                list={asArray<Obj>(g.foundations)}
                onPick={onPick}
              />
              <RefList
                title="Built on top of it"
                list={asArray<Obj>(g.unlocks)}
                onPick={onPick}
              />
              <RefList
                title="Goes with"
                list={asArray<Obj>(g.related)}
                onPick={onPick}
              />
              {g.community && (
                <RefList
                  title="Same community"
                  list={asArray<Obj>(g.community.peers)}
                  onPick={onPick}
                />
              )}
              {!asArray(g.foundations).length &&
                !asArray(g.unlocks).length &&
                !asArray(g.related).length && (
                  <p className="text-[13px] leading-5 text-neutral-800">
                    The graph records no connection for this topic.
                  </p>
                )}
            </div>
          </Fold>
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
              className="press rounded-full px-2.5 py-0.5 text-[12px] font-bold"
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

/* ========================================================================== */
/* TOPIC EVIDENCE: graph first, then the details behind it                    */
/* ========================================================================== */

function EvidenceRow({ e }: { e: EvItem }) {
  const where = [e.repository, e.path].filter(Boolean).join(" · ");
  const label =
    e.title ||
    cut(e.commit, 90) ||
    (e.snippet ? cut(e.snippet, 70) : "") ||
    e.path ||
    "Cited work";
  const kindLabel =
    e.kind === "implementation" || e.kind === "demonstration"
      ? "Implementation"
      : e.kind === "commit"
        ? "Change"
        : e.kind === "experience"
          ? "Experience"
          : "Code";
  return (
    <li
      className="rounded-lg p-2"
      style={{ backgroundColor: PAPER, border: `1.5px solid ${INK}` }}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <span
          className="rounded-full px-1.5 text-[10px] font-black uppercase"
          style={{ backgroundColor: WHITE, border: `1.5px solid ${INK}` }}
        >
          {kindLabel}
        </span>
        <span className="font-bold">{cut(label, 90)}</span>
        {e.when && (
          <span className="text-[11px] text-neutral-700">
            {timeAgo(e.when)}
          </span>
        )}
      </div>
      {e.snippet && (
        <pre
          className="mt-1 overflow-x-auto rounded-md p-1.5 text-[11px] leading-4"
          style={{
            backgroundColor: WHITE,
            border: `1px solid ${LINE}`,
            fontFamily: MONO,
          }}
        >
          {cut(e.snippet, 500)}
        </pre>
      )}
      {where && (
        <div className="mt-0.5 break-all text-[11px] leading-4 text-neutral-700">
          {cut(where, 110)}
        </div>
      )}
      {e.permalink && (
        <a
          href={e.permalink}
          target="_blank"
          rel="noreferrer"
          className="mt-0.5 block text-[11px] font-bold underline"
        >
          View the code
        </a>
      )}
    </li>
  );
}

function TopicEvidence({
  slug,
  detail,
  onPick,
  onAsk,
}: {
  slug: string;
  detail: Obj;
  onPick: (slug: string) => void;
  onAsk: (question: string) => void;
}) {
  const [story, setStory] = useState<Obj | null>(null);
  const [storySrc, setStorySrc] = useState("");
  const [busy, setBusy] = useState(false);
  const [storyErr, setStoryErr] = useState<string | null>(null);

  const tr = (detail.trace ?? {}) as Obj;
  const name = asString(detail.topic?.name) || humanize(slug);
  const k = useMemo(() => claimsOf(detail), [detail]);
  const evById = useMemo(
    () =>
      new Map(
        asObjects(tr.supportingEvidence).map(
          (e) => [asString(e.evidenceId), e] as [string, Obj],
        ),
      ),
    [tr],
  );
  const approaches = asObjects(detail.approaches);
  const all = useMemo(
    () =>
      asObjects(detail.evidence?.byKind?.code)
        .concat(asObjects(detail.evidence?.byKind?.demonstration))
        .concat(asObjects(detail.evidence?.byKind?.experience)),
    [detail],
  );
  const prereqs = asObjects(detail.prerequisitePaths);
  const structure = (tr.structure ?? {}) as Obj;
  const flags = asArray<string>(tr.contradictions);
  const roles = asArray<string>(structure.taxonomyImportance?.roles);

  const explain = async () => {
    setBusy(true);
    setStoryErr(null);
    const r = await call(
      `/api/topics/${encodeURIComponent(slug)}/explain`,
      "POST",
      {},
    );
    if (r.ok && r.data.story) {
      setStory(r.data.story as Obj);
      setStorySrc(asString(r.data.source));
    } else
      setStoryErr(asString(r.data.error, "Could not write the explanation."));
    setBusy(false);
  };

  const columns = [
    {
      key: "observed",
      title: "Observed",
      hint: "Backed by cited code or recorded evidence",
      color: GREEN,
      icon: <CheckCircle2 size={14} color={GREEN} />,
      claims: k.observed,
      empty: "Nothing is observed in cited code yet.",
    },
    {
      key: "inferred",
      title: "Inferred",
      hint: "A conclusion; no code matched directly",
      color: YELLOW,
      icon: <HelpCircle size={14} color="#b8860b" />,
      claims: k.inferred,
      empty: "Nothing is only inferred.",
    },
    {
      key: "unknown",
      title: "Unknown",
      hint: "Not enough evidence to claim either way",
      color: CORAL,
      icon: <Flame size={14} color={CORAL} />,
      claims: k.unknown,
      empty: "No open unknowns are recorded.",
    },
  ];

  const measure = (
    title: string,
    sub: string,
    color: string,
    value: string,
    note: string,
  ) => (
    <div
      className="rounded-xl p-3"
      style={{
        backgroundColor: WHITE,
        border: `2px solid ${INK}`,
        borderTop: `6px solid ${color}`,
      }}
    >
      <div className="text-[12px] font-black text-neutral-700">{title}</div>
      <div
        className="mt-0.5 text-[20px] font-black leading-none"
        style={{ fontFamily: DISPLAY_FONT }}
      >
        {value}
      </div>
      <div className="mt-1 text-[12px] leading-4 text-neutral-700">{sub}</div>
      <div className="mt-0.5 text-[12px] font-bold leading-4">{note}</div>
    </div>
  );

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
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-black uppercase tracking-[.14em] text-neutral-700">
            Why Pathway believes this
          </p>
          <h2
            className="text-[24px] font-black leading-tight"
            style={{ fontFamily: DISPLAY_FONT }}
          >
            {name}
          </h2>
          <p className="mt-0.5 text-[13px] font-semibold text-neutral-800">
            {LEVEL_LABEL[asString(detail.topic?.level)] ?? ""} ·{" "}
            {asString(tr.assessment?.confidence)} confidence ·{" "}
            {num(detail.topic?.evidence?.files)} files across{" "}
            {num(detail.topic?.evidence?.repos)} repositor
            {num(detail.topic?.evidence?.repos) === 1 ? "y" : "ies"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn
            onClick={() =>
              onAsk(`Show me the code that demonstrates my ${name}`)
            }
            bg={LAVENDER}
          >
            <MessageCircle size={13} /> Ask for the code
          </Btn>
          <Btn onClick={() => void explain()} bg={YELLOW} disabled={busy}>
            <Sparkles size={13} />{" "}
            {busy ? "Writing…" : "Explain in plain English"}
          </Btn>
        </div>
      </div>

      {/* THE GRAPH: topic in the middle, everything the graph connects to it around it */}
      <EvidenceGraph slug={slug} detail={detail} onPick={onPick} />

      {/* three separate answers */}
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {measure(
          "Developer proficiency",
          "Judged from cited evidence, checked by guard-rails",
          PURPLE,
          LEVEL_LABEL[asString(structure.proficiency?.level)] ?? "–",
          `Score ${num(structure.proficiency?.score)} · ${AUTH_LABEL[asString(structure.proficiency?.authenticity)] ?? ""}`,
        )}
        {measure(
          "Assessment confidence",
          "How strong and varied the evidence is",
          GREEN,
          humanize(asString(structure.confidence?.level) || "–"),
          asString(structure.confidence?.stored) !==
            asString(structure.confidence?.level)
            ? `Stored as ${asString(structure.confidence?.stored)}, lowered to match evidence`
            : "Matches the evidence",
        )}
        {measure(
          "Taxonomy importance",
          "Role in the shared topic map. Not your skill.",
          SKY,
          roles.length ? roles.map(humanize).join(" + ") : "Specialised",
          `PageRank ${fix(structure.taxonomyImportance?.foundationRank)} · Betweenness ${fix(structure.taxonomyImportance?.bridgeScore)}`,
        )}
      </div>

      {flags.length > 0 && (
        <div
          className="mt-3 rounded-xl p-3"
          style={{ backgroundColor: `${CORAL}22`, ...border }}
        >
          <div className="text-[13px] font-black">
            Where the evidence conflicts or is out of date
          </div>
          <ul className="mt-1 space-y-1">
            {flags.map((f, i) => (
              <li key={i} className="text-[13px] leading-5">
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {columns.map((c) => (
          <div
            key={c.key}
            className="rounded-xl p-3"
            style={{
              backgroundColor: WHITE,
              border: `2px solid ${INK}`,
              borderTop: `6px solid ${c.color}`,
            }}
          >
            <div className="flex items-center gap-1.5 text-[14px] font-black">
              {c.icon} {c.title}
              <span className="ml-auto text-[12px] text-neutral-700">
                {c.claims.length}
              </span>
            </div>
            <div className="text-[12px] text-neutral-700">{c.hint}</div>
            {c.claims.length ? (
              <ul className="mt-2 space-y-1.5">
                {c.claims.slice(0, 6).map((x, i) => (
                  <li key={i} className="text-[13px] leading-5">
                    {cut(asString(x.text), 200)}
                    {asArray<string>(x.evidenceIds).map((id) => (
                      <span
                        key={id}
                        title={asString(evById.get(id)?.source)}
                        className="ml-1 rounded-full px-1.5 text-[10px] font-black"
                        style={{
                          backgroundColor: LAVENDER,
                          border: `1.5px solid ${INK}`,
                        }}
                      >
                        {id}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[13px] leading-5 text-neutral-700">
                {c.empty}
              </p>
            )}
          </div>
        ))}
      </div>

      {approaches.length > 0 && (
        <div
          className="mt-4 rounded-xl p-3"
          style={{ backgroundColor: WHITE, ...border }}
        >
          <div className="text-[14px] font-black">
            Approaches demonstrated ({approaches.length})
          </div>
          <p className="text-[12px] text-neutral-700">
            Each approach is judged on its own evidence.
          </p>
          <div className="mt-2 grid gap-3 lg:grid-cols-2">
            {approaches.map((a, i) => {
              const ev = approachEvidence(a, all);
              const hardening = asArray<string>(a.hardening).filter(Boolean);
              const gaps = asArray<string>(a.gaps).filter(Boolean);
              const depth = asString(a.depth);
              return (
                <div
                  key={`${asString(a.slug)}-${i}`}
                  className="rounded-xl p-3"
                  style={{
                    backgroundColor: PAPER,
                    border: `2px solid ${INK}`,
                    borderLeft: `6px solid ${LEVEL_COLOR[depth] ?? LINE}`,
                  }}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[14px] font-black">
                      {asString(a.name ?? a.slug)}
                    </span>
                    <Chip
                      text={LEVEL_LABEL[depth] ?? depth}
                      background={LEVEL_COLOR[depth] ?? CARD}
                      color={depth && depth !== "none" ? WHITE : INK}
                    />
                    {a.isPrimary && <Chip text="primary" background={YELLOW} />}
                  </div>
                  {a.howImplemented && (
                    <p className="mt-1.5 text-[13px] leading-5 text-neutral-900">
                      {cut(asString(a.howImplemented), 240)}
                    </p>
                  )}
                  {hardening.length > 0 && (
                    <p className="mt-1 text-[12px] leading-4 text-neutral-800">
                      <b>Hardening seen:</b> {hardening.slice(0, 3).join("; ")}
                    </p>
                  )}
                  {gaps.length > 0 && (
                    <p
                      className="mt-1 text-[12px] font-bold leading-4"
                      style={{ color: CORAL }}
                    >
                      Not shown: {gaps.slice(0, 2).join("; ")}
                    </p>
                  )}
                  {ev.length > 0 && (
                    <Fold
                      title={`${ev.length} cited example${ev.length === 1 ? "" : "s"}`}
                      small
                    >
                      <ul className="space-y-1.5">
                        {ev.slice(0, 3).map((e, j) => (
                          <EvidenceRow key={j} e={e} />
                        ))}
                      </ul>
                    </Fold>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div
          className="rounded-xl p-3"
          style={{ backgroundColor: WHITE, ...border }}
        >
          <div className="mb-1 text-[14px] font-black">Foundation paths</div>
          <PrereqPaths paths={prereqs} onPick={onPick} />
        </div>
        <div
          className="rounded-xl p-3"
          style={{ backgroundColor: WHITE, ...border }}
        >
          <div className="mb-1 text-[14px] font-black">
            Why this confidence level
          </div>
          <ConfidenceBox c={detail.confidence} />
        </div>
      </div>

      {(story || storyErr) && (
        <div
          className="mt-4 rounded-xl p-4"
          style={{
            backgroundColor: WHITE,
            ...border,
            animation: "oslide .25s ease-out both",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-[13px] font-black">
              <Sparkles size={14} /> In plain English
            </span>
            {story && (
              <span className="text-[12px] font-bold text-neutral-700">
                {storySrc === "llm"
                  ? "Written by the Pathway agent, numbers checked against your graph"
                  : "Summary built from your graph"}
              </span>
            )}
          </div>
          {storyErr && (
            <p className="mt-2 text-[13px] font-bold" style={{ color: CORAL }}>
              {storyErr}
            </p>
          )}
          {story && (
            <>
              <h3
                className="mt-2 text-[17px] font-black leading-snug"
                style={{ fontFamily: DISPLAY_FONT }}
              >
                {asString(story.headline)}
              </h3>
              <p className="mt-1 text-[14px] leading-6 text-neutral-900">
                {asString(story.summary)}
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div
                  className="rounded-xl p-3"
                  style={{
                    backgroundColor: `${GREEN}22`,
                    border: `2px solid ${INK}`,
                  }}
                >
                  <div className="text-[12px] font-black uppercase">
                    What it means
                  </div>
                  <p className="mt-1 text-[13px] leading-5">
                    {asString(story.meaning)}
                  </p>
                </div>
                <div
                  className="rounded-xl p-3"
                  style={{
                    backgroundColor: `${CORAL}22`,
                    border: `2px solid ${INK}`,
                  }}
                >
                  <div className="text-[12px] font-black uppercase">
                    What is not proven
                  </div>
                  <p className="mt-1 text-[13px] leading-5">
                    {asString(story.caveat)}
                  </p>
                </div>
              </div>
              {asArray<string>(story.followups).length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-black text-neutral-700">
                    Ask the agent:
                  </span>
                  {asArray<string>(story.followups)
                    .slice(0, 3)
                    .map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => onAsk(q)}
                        className="press rounded-full px-3 py-1 text-[12px] font-bold"
                        style={{ backgroundColor: LAVENDER, ...border }}
                      >
                        {q}
                      </button>
                    ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/* ========================================================================== */
/* FOUNDATIONS + CONFIDENCE                                                   */
/* ========================================================================== */

function PrereqPaths({
  paths,
  onPick,
}: {
  paths: Obj[];
  onPick?: (slug: string) => void;
}) {
  if (!paths.length)
    return (
      <p className="text-[13px] leading-5 text-neutral-800">
        No confirmed foundation is recorded for this topic. Related topics are
        associations, not prerequisites.
      </p>
    );
  return (
    <div className="space-y-2.5">
      {paths.slice(0, 6).map((p, i) => {
        const st = PREREQ_STYLE[asString(p.status)] ?? PREREQ_STYLE.unverified;
        const steps = asArray<Obj>(p.steps);
        const reasons = asArray<string>(p.reasons);
        return (
          <div
            key={i}
            className="rounded-lg p-2.5"
            style={{ backgroundColor: PAPER, border: `1.5px solid ${INK}` }}
          >
            <Chip text={st.label} background={st.bg} color={st.color} />
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {steps.map((s, j) => {
                const assessed = s.assessed !== false && s.level != null;
                const canOpen = assessed && j > 0 && !!onPick;
                return (
                  <span key={j} className="inline-flex items-center gap-1">
                    {j > 0 && <ChevronRight size={12} strokeWidth={3} />}
                    <button
                      type="button"
                      onClick={() =>
                        canOpen ? onPick?.(asString(s.slug)) : undefined
                      }
                      className="press inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-bold"
                      style={{
                        backgroundColor: assessed ? WHITE : CARD,
                        border: `2px ${assessed ? "solid" : "dashed"} ${INK}`,
                        cursor: canOpen ? "pointer" : "default",
                      }}
                    >
                      <Dot
                        color={LEVEL_COLOR[asString(s.level)] ?? "#d1d5db"}
                        small
                      />
                      {asString(s.name)}
                    </button>
                  </span>
                );
              })}
            </div>
            {reasons[0] && (
              <p className="mt-1.5 text-[12px] leading-4 text-neutral-800">
                {cut(reasons[0], 170)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ConfidenceBox({ c }: { c: Obj | null | undefined }) {
  if (!c) return null;
  const eff = asString(c.effective);
  const factors = asArray<Obj>(c.factors);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Chip
          text={`${eff} confidence`}
          background={CONF_COLOR[eff] ?? CARD}
          color={eff === "high" ? WHITE : INK}
        />
        {asString(c.stated) !== eff && (
          <span className="text-[12px] leading-4 text-neutral-800">
            Stored as {asString(c.stated)}; current evidence supports{" "}
            {asString(c.derived)}.
          </span>
        )}
      </div>
      <div className="mt-2 space-y-1.5">
        {factors.map((f) => (
          <div key={asString(f.id)}>
            <div className="flex items-center gap-2 text-[12px]">
              <span className="w-32 shrink-0 font-black">
                {asString(f.label)}
              </span>
              <div
                className="h-2 flex-1 overflow-hidden rounded-full"
                style={{ backgroundColor: CARD, border: `1.5px solid ${INK}` }}
              >
                <div
                  className="h-full transition-all duration-700"
                  style={{
                    width: `${(num(f.value) / Math.max(1, num(f.max))) * 100}%`,
                    backgroundColor: SKY,
                  }}
                />
              </div>
              <span className="w-9 text-right font-bold">
                {num(f.value)}/{num(f.max)}
              </span>
            </div>
            <div className="pl-[8.5rem] text-[11px] leading-4 text-neutral-700">
              {asString(f.note)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ========================================================================== */
/* SMALL PIECES                                                               */
/* ========================================================================== */

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

function Dot({ color, small = false }: { color: string; small?: boolean }) {
  const s = small ? 9 : 12;
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{
        width: s,
        height: s,
        backgroundColor: color,
        border: `1.5px solid ${INK}`,
      }}
    />
  );
}

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
      style={{ backgroundColor: WHITE, ...border, boxShadow: shadow(2) }}
    >
      <div
        className="text-[26px] font-black leading-none"
        style={{ fontFamily: DISPLAY_FONT }}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div className="mt-1 text-[13px] font-black">{label}</div>
      <div className="text-[12px] leading-4 text-neutral-700">{hint}</div>
    </div>
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
        className={`press flex cursor-pointer items-center gap-1.5 font-black ${small ? "mt-1.5 text-[12px] text-neutral-700" : "py-2.5 text-[13px]"}`}
      >
        <ChevronRight
          size={small ? 12 : 14}
          strokeWidth={3}
          className="transition-transform duration-200 group-open:rotate-90"
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
      className="press max-w-[210px] rounded-full bg-white px-3 py-1.5 text-[13px] font-bold outline-none"
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
      className="press rounded-full bg-white px-3 py-1.5 text-[13px] font-bold outline-none"
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
  return (
    <button
      type="button"
      onClick={onClick}
      className="press inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-bold"
      style={{ backgroundColor: WHITE, ...border }}
    >
      <Dot color={LEVEL_COLOR[asString(t?.level)] ?? CARD} small />
      {asString(t?.name ?? t?.label)}
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
      className="press inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-black disabled:opacity-50"
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
