/* eslint-disable react-hooks/set-state-in-effect */

import React, { useEffect, useState } from "react";
import { useWorld } from "./WorldContext";
import { INK, DISPLAY_FONT, BODY_FONT } from "./Theme";
import type {
  SkillDetail,
  SkillInsight,
  SkillInsightBuiltThing,
} from "../src/types";

/* ──────────────────────────────────────────────────────────────
   Design tokens (local to the panel so the rest of the theme
   stays untouched)
   ────────────────────────────────────────────────────────────── */

const PANEL_WIDTH = 400;
const SHOW_INSIGHT_TAB = false; // flip to true to bring the AI tab back
const PROOF_PREVIEW = 6;

const C = {
  panel: "#FAF6EA",
  card: "#FFFFFF",
  sunken: "#F6F0DE",
  border: "#E9E0C5",
  hairline: "#F1EAD3",
  ink: INK,
  text2: "#4B4736",
  muted: "#7B7358",
  accent: "#E5A91A",
  green: "#2A9D6E",
  orange: "#D9782A",
  red: "#C2453A",
};

const MONO =
  'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace';

const LEVEL_COLOR: Record<string, string> = {
  novice: "#8A8466",
  familiar: "#3E8FC0",
  proficient: "#2A9D6E",
  advanced: "#D9902A",
  expert: "#7C5CD1",
};

const LEVEL_LABEL: Record<string, string> = {
  novice: "Novice",
  familiar: "Familiar",
  proficient: "Proficient",
  advanced: "Advanced",
  expert: "Expert",
};

const CONFIDENCE_LABEL: Record<string, string> = {
  low: "Low confidence",
  medium: "Medium confidence",
  high: "High confidence",
};

const TREND_LABEL: Record<string, string> = {
  rising: "▲ Rising",
  steady: "● Steady",
  cooling: "▼ Cooling",
  dormant: "◌ Dormant",
};

const TREND_COLOR: Record<string, string> = {
  rising: C.green,
  steady: C.muted,
  cooling: C.orange,
  dormant: C.muted,
};

type TabId = "overview" | "insight";

/* ──────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────── */

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function shortSha(sha: string): string {
  return sha ? sha.slice(0, 7) : "—";
}

function num(n: number | undefined | null): string {
  return typeof n === "number" ? n.toLocaleString() : "—";
}

function recencyLabel(days: number | undefined): string {
  if (days === undefined || days < 0) return "—";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 60) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  if (!y || !mo) return m;
  return new Date(y, mo - 1, 1).toLocaleDateString(undefined, {
    month: "short",
    year: "2-digit",
  });
}

/* Shared micro-styles */
const eyebrow: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: 0.7,
  textTransform: "uppercase",
  color: C.muted,
};

const PANEL_CSS = `
.sep-scroll{scrollbar-width:thin;scrollbar-color:#D9CDA3 transparent}
.sep-scroll::-webkit-scrollbar{width:8px}
.sep-scroll::-webkit-scrollbar-thumb{background:#D9CDA3;border-radius:8px;border:2px solid ${C.panel}}
.sep-close{transition:background .15s,border-color .15s}
.sep-close:hover{background:${C.sunken};border-color:${C.muted}}
.sep-chip{transition:background .15s,border-color .15s,transform .1s}
.sep-chip:not(:disabled):hover{background:${C.sunken};border-color:${C.accent}}
.sep-chip:not(:disabled):active{transform:scale(.97)}
.sep-row{transition:background .15s,border-color .15s}
.sep-row:hover{background:${C.sunken}}
.sep-bar{transition:opacity .15s}
.sep-bar:hover{opacity:.75}
.sep-btn{transition:background .15s,border-color .15s}
.sep-btn:not(:disabled):hover{background:${C.sunken};border-color:${C.muted}}
.sep-link{text-decoration:none;color:inherit}
.sep-link:hover .sep-path{text-decoration:underline}
`;

/* ──────────────────────────────────────────────────────────────
   Panel shell
   ────────────────────────────────────────────────────────────── */

export function SkillEvidencePanel() {
  const {
    selectedSkillSlug,
    skillDetail,
    isSkillLoading,
    skillError,
    clearSelectedSkill,

    skillInsight,
    isInsightLoading,
    insightError,
    loadInsight,
  } = useWorld();

  const [cachedDetail, setCachedDetail] = useState<SkillDetail | null>(
    skillDetail,
  );
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  useEffect(() => {
    if (skillDetail) setCachedDetail(skillDetail);
  }, [skillDetail]);

  useEffect(() => {
    setActiveTab("overview");
  }, [selectedSkillSlug]);

  useEffect(() => {
    if (
      activeTab === "insight" &&
      selectedSkillSlug &&
      !skillInsight &&
      !isInsightLoading &&
      !insightError
    ) {
      loadInsight();
    }
  }, [
    activeTab,
    selectedSkillSlug,
    skillInsight,
    isInsightLoading,
    insightError,
    loadInsight,
  ]);

  const isOpen = !!selectedSkillSlug;
  const detail = skillDetail ?? cachedDetail;

  return (
    <aside
      aria-hidden={!isOpen}
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: PANEL_WIDTH,
        maxWidth: "94vw",
        background: C.panel,
        borderLeft: `1px solid ${C.border}`,
        boxShadow: isOpen ? "-16px 0 40px rgba(27,27,34,0.12)" : "none",
        transform: isOpen ? "translateX(0)" : `translateX(${PANEL_WIDTH}px)`,
        transition: "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        zIndex: 40,
        display: "flex",
        flexDirection: "column",
        fontFamily: BODY_FONT,
        color: C.ink,
      }}
    >
      <style>{PANEL_CSS}</style>

      {/* Header */}
      <header
        style={{
          padding: "20px 20px 0",
          background: C.panel,
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            {detail?.categoryName && (
              <div style={{ ...eyebrow, marginBottom: 6 }}>
                {detail.categoryName}
              </div>
            )}
            <h2
              style={{
                fontFamily: DISPLAY_FONT,
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                margin: 0,
                lineHeight: 1.15,
                wordBreak: "break-word",
              }}
            >
              {detail?.skillName ?? "—"}
            </h2>
          </div>

          <button
            type="button"
            className="sep-close"
            onClick={clearSelectedSkill}
            aria-label="Close panel"
            style={{
              width: 32,
              height: 32,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              fontSize: 18,
              lineHeight: 1,
              color: C.text2,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ display: "flex", gap: 20, marginTop: 16 }}>
          <TabButton
            label="Overview"
            isActive={activeTab === "overview"}
            onClick={() => setActiveTab("overview")}
          />
          {SHOW_INSIGHT_TAB && (
            <TabButton
              label="AI insight"
              isActive={activeTab === "insight"}
              onClick={() => setActiveTab("insight")}
            />
          )}
        </div>
      </header>

      {/* Body */}
      <div
        className="sep-scroll"
        style={{ flex: 1, overflowY: "auto", padding: "16px 20px 32px" }}
      >
        {isSkillLoading && !detail && activeTab === "overview" && (
          <SkeletonBlock />
        )}

        {skillError && activeTab === "overview" && (
          <div
            style={{
              fontSize: 13,
              color: C.red,
              lineHeight: 1.5,
              background: "#FBEDEA",
              border: `1px solid #F1C9C3`,
              borderRadius: 12,
              padding: "12px 14px",
            }}
          >
            Couldn't load skill analysis: {skillError}
          </div>
        )}

        {activeTab === "overview" && detail && <OverviewTab detail={detail} />}

        {activeTab === "insight" && (
          <InsightTab
            insight={skillInsight}
            isLoading={isInsightLoading}
            error={insightError}
            onRegenerate={() => loadInsight(true)}
          />
        )}
      </div>
    </aside>
  );
}

/* ──────────────────────────────────────────────────────────────
   Primitives
   ────────────────────────────────────────────────────────────── */

function Card({
  children,
  padding = 16,
}: {
  children: React.ReactNode;
  padding?: number | string;
}) {
  return (
    <section
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding,
        marginBottom: 12,
      }}
    >
      {children}
    </section>
  );
}

function SectionHeader({
  title,
  meta,
}: {
  title: string;
  meta?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 10,
        marginBottom: 12,
      }}
    >
      <span style={eyebrow}>{title}</span>
      {meta && <span style={{ fontSize: 11.5, color: C.muted }}>{meta}</span>}
    </div>
  );
}

function Pill({
  children,
  color = C.muted,
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: 0.3,
        textTransform: "uppercase",
        color,
        background: `${color}14`,
        border: `1px solid ${color}33`,
        borderRadius: 999,
        padding: "3px 9px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function SkillChip({
  label,
  count,
  onClick,
  muted,
}: {
  label: string;
  count?: number;
  onClick?: () => void;
  muted?: boolean;
}) {
  const clickable = !!onClick;
  return (
    <button
      type="button"
      className="sep-chip"
      onClick={onClick}
      disabled={!clickable}
      style={{
        fontFamily: BODY_FONT,
        fontSize: 12,
        fontWeight: 600,
        color: muted ? C.text2 : C.ink,
        background: muted ? C.sunken : C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: "5px 10px",
        cursor: clickable ? "pointer" : "default",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      {label}
      {typeof count === "number" && (
        <span style={{ color: C.muted, fontWeight: 500 }}>{count}</span>
      )}
    </button>
  );
}

function ChipGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 7 }}>
        {label}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {children}
      </div>
    </div>
  );
}

function KeyValueRow({
  label,
  value,
  valueColor,
  hint,
  last,
}: {
  label: string;
  value: React.ReactNode;
  valueColor?: string;
  hint?: string;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 0",
        borderBottom: last ? "none" : `1px solid ${C.hairline}`,
      }}
    >
      <div>
        <div style={{ fontSize: 13, color: C.text2 }}>{label}</div>
        {hint && (
          <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>
            {hint}
          </div>
        )}
      </div>
      <div
        style={{
          fontFamily: DISPLAY_FONT,
          fontSize: 15,
          fontWeight: 700,
          color: valueColor ?? C.ink,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function TabButton({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        borderBottom: `2px solid ${isActive ? C.accent : "transparent"}`,
        padding: "6px 0 10px",
        fontFamily: BODY_FONT,
        fontSize: 12,
        fontWeight: 700,
        color: isActive ? C.ink : C.muted,
        cursor: "pointer",
        textTransform: "uppercase",
        letterSpacing: 0.6,
      }}
    >
      {label}
    </button>
  );
}

function SkeletonBlock() {
  const bar = (w: string, h = 14): React.CSSProperties => ({
    width: w,
    height: h,
    borderRadius: 8,
    background: C.sunken,
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ ...bar("100%", 96), borderRadius: 14 }} />
      <div style={{ ...bar("100%", 72), borderRadius: 14 }} />
      <div style={{ ...bar("100%", 140), borderRadius: 14 }} />
      <div style={{ fontSize: 12.5, color: C.muted }}>
        Loading skill analysis…
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Visuals
   ────────────────────────────────────────────────────────────── */

function ScoreRing({ score, color }: { score: number; color: string }) {
  const size = 84;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={`${score} of 100`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={C.hairline}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circ * pct} ${circ}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1,
        }}
      >
        <span
          style={{ fontFamily: DISPLAY_FONT, fontSize: 24, fontWeight: 700 }}
        >
          {score}
        </span>
        <span style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>
          / 100
        </span>
      </div>
    </div>
  );
}

function ActivityChart({
  points,
}: {
  points: Array<{ month: string; count: number }>;
}) {
  if (points.length === 0) return null;

  const W = 340;
  const H = 96;
  const padL = 28;
  const gap = 4;
  const max = Math.max(...points.map((p) => p.count), 1);
  const bw = Math.max(
    4,
    (W - padL - gap * (points.length - 1)) / points.length,
  );
  const mid = Math.floor((points.length - 1) / 2);
  const labelIdx = new Set([0, mid, points.length - 1]);

  return (
    <svg
      viewBox={`0 0 ${W} ${H + 22}`}
      width="100%"
      role="img"
      aria-label="Commits per month"
      style={{ display: "block" }}
    >
      {[0, 0.5, 1].map((t) => {
        const y = H - t * H;
        return (
          <g key={t}>
            <line
              x1={padL}
              x2={W}
              y1={y}
              y2={y}
              stroke={C.hairline}
              strokeWidth={1}
              strokeDasharray={t === 0 ? undefined : "3 3"}
            />
            <text
              x={padL - 6}
              y={y + 3}
              fontSize={9}
              fill={C.muted}
              textAnchor="end"
            >
              {Math.round(max * t)}
            </text>
          </g>
        );
      })}

      {points.map((p, i) => {
        const h = Math.max(2, (p.count / max) * H);
        const x = padL + i * (bw + gap);
        const isLast = i === points.length - 1;
        return (
          <g key={p.month} className="sep-bar">
            <title>{`${monthLabel(p.month)}: ${p.count} commits`}</title>
            <rect
              x={x}
              y={H - h}
              width={bw}
              height={h}
              rx={3}
              fill={isLast ? C.accent : "#D9CDA3"}
            />
            {labelIdx.has(i) && (
              <text
                x={x + bw / 2}
                y={H + 15}
                fontSize={9.5}
                fill={C.muted}
                textAnchor={
                  i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"
                }
                dx={i === 0 ? -bw / 2 : i === points.length - 1 ? bw / 2 : 0}
              >
                {monthLabel(p.month)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ──────────────────────────────────────────────────────────────
   Overview
   ────────────────────────────────────────────────────────────── */

function OverviewTab({ detail }: { detail: SkillDetail }) {
  const { selectSkill } = useWorld();
  const [showAllProof, setShowAllProof] = useState(false);

  const trend = detail.trend ?? "steady";
  const levelColor = LEVEL_COLOR[detail.level] ?? C.accent;
  const activity = detail.activity ?? [];
  const repositories = detail.repositories ?? [];
  const related = detail.related ?? [];
  const implies = detail.implies ?? [];
  const impliedBy = detail.impliedBy ?? [];
  const nextSteps = detail.nextSteps ?? [];
  const quality =
    typeof detail.evidenceQuality === "number" && detail.evidenceQuality > 0
      ? `${Math.round(detail.evidenceQuality * 100)}%`
      : null;

  const hasTrendData = detail.recentCommits !== undefined;
  const recent = detail.recentCommits ?? 0;
  const prior = detail.priorCommits ?? 0;
  const delta = recent - prior;

  const peak = activity.reduce((m, p) => Math.max(m, p.count), 0);
  const total = activity.reduce((s, p) => s + p.count, 0);
  const maxRepoCommits = Math.max(...repositories.map((r) => r.commits), 1);

  const proof = detail.proof;
  const visibleProof = showAllProof ? proof : proof.slice(0, PROOF_PREVIEW);

  return (
    <>
      {/* Hero */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <ScoreRing score={detail.depthScore} color={levelColor} />
          <div style={{ minWidth: 0 }}>
            <div style={{ ...eyebrow, marginBottom: 4 }}>Skill depth</div>
            <div
              style={{
                fontFamily: DISPLAY_FONT,
                fontSize: 22,
                fontWeight: 700,
                color: levelColor,
                lineHeight: 1.1,
              }}
            >
              {LEVEL_LABEL[detail.level] ?? detail.level}
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
              Last used {recencyLabel(detail.recencyDays)}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginTop: 14,
            paddingTop: 14,
            borderTop: `1px solid ${C.hairline}`,
          }}
        >
          <Pill color={TREND_COLOR[trend] ?? C.muted}>
            {TREND_LABEL[trend] ?? trend}
          </Pill>
          {detail.confidence && (
            <Pill>
              {CONFIDENCE_LABEL[detail.confidence] ?? detail.confidence}
            </Pill>
          )}
          {quality && <Pill>{quality} strong evidence</Pill>}
        </div>
      </Card>

      {/* KPIs */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          marginBottom: 12,
        }}
      >
        {[
          { label: "Files", value: detail.filesTouched },
          { label: "Commits", value: detail.commitsCount },
          { label: "Repos", value: detail.reposCount },
        ].map((k, i) => (
          <div
            key={k.label}
            style={{
              padding: "14px 8px",
              textAlign: "center",
              borderLeft: i === 0 ? "none" : `1px solid ${C.hairline}`,
            }}
          >
            <div
              style={{
                fontFamily: DISPLAY_FONT,
                fontSize: 22,
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {num(k.value)}
            </div>
            <div style={{ ...eyebrow, marginTop: 4, fontSize: 10 }}>
              {k.label}
            </div>
          </div>
        ))}
      </section>

      {/* Code changes */}
      <Card>
        <SectionHeader title="Code changes" />
        <div>
          <KeyValueRow
            label="Lines added"
            value={`+${num(detail.linesAdded)}`}
            valueColor={C.green}
          />
          <KeyValueRow
            label="Lines deleted"
            value={`−${num(detail.linesDeleted)}`}
            valueColor={C.red}
          />
          <KeyValueRow label="Active days" value={num(detail.activeDays)} />
          {hasTrendData ? (
            <KeyValueRow
              label="Last 90 days"
              hint={`vs ${num(prior)} in the prior 90 days`}
              value={
                <>
                  {num(recent)}{" "}
                  {delta !== 0 && (
                    <span
                      style={{
                        fontSize: 11.5,
                        color: delta > 0 ? C.green : C.orange,
                      }}
                    >
                      {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
                    </span>
                  )}
                </>
              }
              last
            />
          ) : (
            <KeyValueRow
              label="Last seen"
              value={formatDate(detail.lastSeen)}
              last
            />
          )}
        </div>
      </Card>

      {/* Activity */}
      {activity.length > 0 && (
        <Card>
          <SectionHeader
            title="Commits per month"
            meta={`${num(total)} total · peak ${num(peak)}`}
          />
          <ActivityChart points={activity} />
        </Card>
      )}

      {/* Repositories */}
      {repositories.length > 0 && (
        <Card>
          <SectionHeader
            title="Where you used it"
            meta={`${repositories.length} repo${repositories.length === 1 ? "" : "s"}`}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {repositories.slice(0, 5).map((repo) => (
              <div key={repo.repositoryId}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 10,
                    marginBottom: 5,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      wordBreak: "break-all",
                    }}
                  >
                    {repo.name || repo.repositoryId}
                  </span>
                  <span
                    style={{
                      fontSize: 11.5,
                      color: C.muted,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {num(repo.commits)} commits · {num(repo.files)} files
                  </span>
                </div>
                <div
                  style={{
                    height: 6,
                    borderRadius: 6,
                    background: C.hairline,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.max(4, (repo.commits / maxRepoCommits) * 100)}%`,
                      background: levelColor,
                      borderRadius: 6,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Skill graph */}
      {(related.length > 0 ||
        implies.length > 0 ||
        impliedBy.length > 0 ||
        nextSteps.length > 0) && (
        <Card>
          <SectionHeader title="Connected skills" />
          <div style={{ marginTop: -12 }}>
            {related.length > 0 && (
              <ChipGroup label="Usually changed together with">
                {related.map((r) => (
                  <SkillChip
                    key={r.skillId}
                    label={r.skillName}
                    count={r.commits}
                    onClick={() => selectSkill(r.skillId)}
                  />
                ))}
              </ChipGroup>
            )}
            {implies.length > 0 && (
              <ChipGroup label="Also counts toward">
                {implies.map((r) => (
                  <SkillChip key={r.skillId} label={r.skillName} muted />
                ))}
              </ChipGroup>
            )}
            {impliedBy.length > 0 && (
              <ChipGroup label="Partly proven by">
                {impliedBy.map((r) => (
                  <SkillChip key={r.skillId} label={r.skillName} muted />
                ))}
              </ChipGroup>
            )}
            {nextSteps.length > 0 && (
              <ChipGroup label="Natural next skills">
                {nextSteps.map((r) => (
                  <SkillChip key={r.skillId} label={r.skillName} muted />
                ))}
              </ChipGroup>
            )}
          </div>
        </Card>
      )}

      {/* Proof */}
      <Card padding="16px 16px 8px">
        <SectionHeader
          title="Proof from commit history"
          meta={proof.length > 0 ? `${proof.length} files` : undefined}
        />
        {proof.length === 0 ? (
          <p style={{ fontSize: 12.5, color: C.muted, margin: "0 0 8px" }}>
            No individual file evidence available.
          </p>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {visibleProof.map((item) => (
                <ProofRow
                  key={`${item.repositoryId}-${item.commitSha}-${item.path}`}
                  path={item.path}
                  href={item.commitUrl || undefined}
                  tag={
                    item.implied
                      ? "implied"
                      : item.strength === "weak"
                        ? "weak"
                        : undefined
                  }
                  meta={`${item.repositoryName || item.repositoryId} · ${shortSha(
                    item.commitSha,
                  )} · ${formatDate(item.createdAt)}`}
                  additions={item.additions}
                  deletions={item.deletions}
                />
              ))}
            </div>
            {proof.length > PROOF_PREVIEW && (
              <button
                type="button"
                className="sep-btn"
                onClick={() => setShowAllProof((v) => !v)}
                style={{
                  width: "100%",
                  margin: "10px 0 8px",
                  fontFamily: BODY_FONT,
                  fontSize: 12,
                  fontWeight: 600,
                  color: C.text2,
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 9,
                  padding: "8px 10px",
                  cursor: "pointer",
                }}
              >
                {showAllProof ? "Show fewer" : `Show all ${proof.length} files`}
              </button>
            )}
          </>
        )}
      </Card>

      <p
        style={{
          fontSize: 11.5,
          lineHeight: 1.55,
          color: C.muted,
          margin: "16px 4px 0",
        }}
      >
        First seen {formatDate(detail.firstSeen)}. Depth combines volume,
        breadth, commit history, repo spread and sustained use, then is scaled
        by how much of the evidence is direct (imports, config, real usage)
        rather than inferred from file type. Lockfiles, build output and
        generated code are ignored.
      </p>
    </>
  );
}

function ProofRow({
  path,
  meta,
  href,
  tag,
  additions,
  deletions,
}: {
  path: string;
  meta?: string;
  href?: string;
  tag?: string;
  additions?: number;
  deletions?: number;
}) {
  const inner = (
    <div
      className="sep-row"
      style={{
        padding: "9px 11px",
        background: C.card,
        border: `1px solid ${C.hairline}`,
        borderRadius: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div
          className="sep-path"
          style={{
            fontFamily: MONO,
            fontSize: 11.5,
            fontWeight: 600,
            lineHeight: 1.45,
            wordBreak: "break-all",
            minWidth: 0,
          }}
        >
          {path}
        </div>
        {tag && (
          <span
            style={{
              flexShrink: 0,
              fontSize: 9.5,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              color: C.muted,
              background: C.sunken,
              borderRadius: 6,
              padding: "2px 6px",
            }}
          >
            {tag}
          </span>
        )}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          marginTop: 4,
          fontSize: 11,
          color: C.muted,
        }}
      >
        <span style={{ minWidth: 0 }}>{meta}</span>
        {typeof additions === "number" && typeof deletions === "number" && (
          <span
            style={{
              fontFamily: MONO,
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span style={{ color: C.green }}>+{num(additions)}</span>{" "}
            <span style={{ color: C.red }}>−{num(deletions)}</span>
          </span>
        )}
      </div>
    </div>
  );

  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="sep-link">
      {inner}
    </a>
  ) : (
    inner
  );
}

/* ──────────────────────────────────────────────────────────────
   AI insight tab
   ────────────────────────────────────────────────────────────── */

function InsightTab({
  insight,
  isLoading,
  error,
  onRegenerate,
}: {
  insight: SkillInsight | null;
  isLoading: boolean;
  error: string | null;
  onRegenerate: () => void;
}) {
  if (isLoading && !insight) {
    return (
      <Card>
        <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.5 }}>
          Reading your commits and figuring out what you actually built…
        </p>
      </Card>
    );
  }

  if (error && !insight) {
    return (
      <Card>
        <p style={{ fontSize: 13, color: C.red, lineHeight: 1.5, margin: 0 }}>
          Couldn't generate an AI insight: {error}
        </p>
        <button
          type="button"
          className="sep-btn"
          onClick={onRegenerate}
          style={btnStyle(false)}
        >
          Try again
        </button>
      </Card>
    );
  }

  if (!insight) {
    return (
      <Card>
        <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.5 }}>
          No AI build insight available yet for this skill.
        </p>
      </Card>
    );
  }

  const thingsBuilt = insight.thingsBuilt ?? [];

  return (
    <>
      <Card>
        <div style={{ ...eyebrow, marginBottom: 8 }}>Summary</div>
        <div
          style={{
            fontFamily: DISPLAY_FONT,
            fontSize: 17,
            fontWeight: 700,
            lineHeight: 1.3,
            marginBottom: 12,
          }}
        >
          {insight.headline}
        </div>
        <p
          style={{
            fontSize: 13.5,
            lineHeight: 1.6,
            color: C.text2,
            margin: 0,
          }}
        >
          {insight.whatYouBuilt}
        </p>
      </Card>

      {thingsBuilt.length > 0 && (
        <Card>
          <SectionHeader
            title="Things you built"
            meta={`${thingsBuilt.length}`}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {thingsBuilt.map((thing, index) => (
              <BuiltThingCard key={`${thing.title}-${index}`} thing={thing} />
            ))}
          </div>
        </Card>
      )}

      {insight.keyContributions.length > 0 && (
        <Card>
          <SectionHeader title="Key contributions" />
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {insight.keyContributions.map((contribution, index) => (
              <li
                key={index}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  padding: "8px 0",
                  borderTop: index === 0 ? "none" : `1px solid ${C.hairline}`,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: C.accent,
                    flexShrink: 0,
                    marginTop: 8,
                  }}
                />
                <span style={{ color: C.text2 }}>{contribution}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {insight.notableFiles.length > 0 && (
        <Card padding="16px 16px 10px">
          <SectionHeader title="Notable files" />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {insight.notableFiles.map((file, index) => (
              <ProofRow
                key={index}
                path={file.path}
                meta={`${file.repo} · ${file.note}`}
              />
            ))}
          </div>
        </Card>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          margin: "4px 2px 0",
        }}
      >
        <Pill>
          {CONFIDENCE_LABEL[insight.confidence] ?? insight.confidence}
        </Pill>
        <button
          type="button"
          className="sep-btn"
          onClick={onRegenerate}
          disabled={isLoading}
          style={{ ...btnStyle(isLoading), marginTop: 0 }}
        >
          {isLoading ? "Regenerating…" : "Regenerate"}
        </button>
      </div>
      <p
        style={{
          fontSize: 11,
          lineHeight: 1.5,
          color: C.muted,
          margin: "10px 2px 0",
        }}
      >
        {insight.cached ? "Cached from a previous run" : "Freshly generated"} ·{" "}
        {formatDate(insight.generatedAt)}
      </p>
    </>
  );
}

function btnStyle(disabled: boolean): React.CSSProperties {
  return {
    marginTop: 12,
    fontFamily: BODY_FONT,
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 9,
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: 600,
    color: C.ink,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

function BuiltThingCard({ thing }: { thing: SkillInsightBuiltThing }) {
  const evidence = thing.evidence ?? [];
  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        overflow: "hidden",
        background: C.card,
      }}
    >
      <div style={{ padding: "12px 13px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div
            style={{
              fontFamily: DISPLAY_FONT,
              fontSize: 14,
              fontWeight: 700,
              lineHeight: 1.3,
            }}
          >
            {thing.title}
          </div>
          <Pill>{thing.confidence}</Pill>
        </div>
        <p
          style={{
            fontSize: 12.5,
            lineHeight: 1.55,
            margin: "7px 0 0",
            color: C.text2,
          }}
        >
          {thing.description}
        </p>
      </div>

      {evidence.length > 0 && (
        <div
          style={{
            borderTop: `1px solid ${C.hairline}`,
            background: C.sunken,
            padding: "10px 13px 11px",
          }}
        >
          <div style={{ ...eyebrow, fontSize: 9.5, marginBottom: 7 }}>
            Evidence
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {evidence.map((e, index) => (
              <div
                key={`${e.repo}-${e.file}-${e.commit}-${index}`}
                style={{ minWidth: 0 }}
              >
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    fontWeight: 600,
                    lineHeight: 1.4,
                    wordBreak: "break-all",
                  }}
                >
                  {e.file}
                </div>
                <div style={{ fontSize: 10.5, color: C.muted, marginTop: 1 }}>
                  {e.repo} · {shortSha(e.commit)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
