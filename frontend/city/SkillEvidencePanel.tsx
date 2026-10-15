

import React, { useEffect, useState } from "react";
import { useWorld } from "./WorldContext";
import {
  INK,
  PAPER,
  PAPER_DARK,
  LINE,
  YELLOW,
  MUTED,
  DISPLAY_FONT,
  BODY_FONT,
} from "./Theme";
import type {
  SkillDetail,
  SkillInsight,
  SkillInsightBuiltThing,
} from "../src/types";

const PANEL_WIDTH = 380;

type TabId = "overview" | "insight";

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
    if (skillDetail) {
      setCachedDetail(skillDetail);
    }
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
        maxWidth: "92vw",
        background: PAPER,
        borderLeft: `1px solid ${LINE}`,
        boxShadow: isOpen ? "-12px 0 32px rgba(16,18,16,0.14)" : "none",
        transform: isOpen ? "translateX(0)" : `translateX(${PANEL_WIDTH}px)`,
        transition: "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        zIndex: 40,
        display: "flex",
        flexDirection: "column",
        fontFamily: BODY_FONT,
        color: INK,
      }}
    >
      
      <div
        style={{
          padding: "24px 24px 0",
          borderBottom: `1px solid ${LINE}`,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2
              style={{
                fontFamily: DISPLAY_FONT,
                fontSize: 22,
                fontWeight: 700,
                margin: 0,
                lineHeight: 1.2,
              }}
            >
              {detail?.skillName ?? "—"}
            </h2>

            {detail?.categoryName && (
              <span
                style={{
                  display: "inline-block",
                  fontSize: 13,
                  color: MUTED,
                  fontWeight: 500,
                  marginTop: 4,
                }}
              >
                {detail.categoryName}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={clearSelectedSkill}
            aria-label="Close panel"
            style={{
              background: "none",
              border: "none",
              fontSize: 22,
              lineHeight: 1,
              cursor: "pointer",
              color: MUTED,
              padding: 4,
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>

        
        <div style={{ display: "flex", gap: 4, marginTop: 18 }}>
          <TabButton
            label="Overview"
            isActive={activeTab === "overview"}
            onClick={() => setActiveTab("overview")}
          />
        </div>
      </div>

      
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px 24px 32px",
        }}
      >
        {isSkillLoading && !detail && activeTab === "overview" && (
          <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>
            Loading skill analysis…
          </p>
        )}

        {skillError && activeTab === "overview" && (
          <p
            style={{
              fontSize: 13,
              color: "#c0392b",
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            Couldn't load skill analysis: {skillError}
          </p>
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





const TREND_LABEL: Record<string, string> = {
  rising: "▲ Rising",
  steady: "● Steady",
  cooling: "▼ Cooling",
  dormant: "◌ Dormant",
};

const TREND_COLOR: Record<string, string> = {
  rising: "#2FAE7A",
  steady: MUTED,
  cooling: "#E8862E",
  dormant: MUTED,
};

function recencyLabel(days: number | undefined): string {
  if (days === undefined || days < 0) return "—";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 60) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

function Pill({
  children,
  color = MUTED,
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.3,
        color,
        border: `1px solid ${LINE}`,
        borderRadius: 999,
        padding: "3px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Sparkline({
  points,
}: {
  points: Array<{ month: string; count: number }>;
}) {
  if (points.length === 0) return null;

  const W = 300;
  const H = 56;
  const gap = 3;
  const max = Math.max(...points.map((p) => p.count), 1);
  const bw = Math.max(4, (W - gap * (points.length - 1)) / points.length);

  return (
    <svg
      viewBox={`0 0 ${W} ${H + 14}`}
      width="100%"
      role="img"
      aria-label="Commits per month"
      style={{ display: "block" }}
    >
      {points.map((p, i) => {
        const h = Math.max(3, (p.count / max) * H);
        return (
          <g key={p.month}>
            <title>{`${p.month}: ${p.count} commits`}</title>
            <rect
              x={i * (bw + gap)}
              y={H - h}
              width={bw}
              height={h}
              rx={2}
              fill={i === points.length - 1 ? YELLOW : INK}
              opacity={i === points.length - 1 ? 1 : 0.8}
            />
          </g>
        );
      })}
      <text x={0} y={H + 11} fontSize={9} fill={MUTED}>
        {points[0].month}
      </text>
      <text x={W} y={H + 11} fontSize={9} fill={MUTED} textAnchor="end">
        {points[points.length - 1].month}
      </text>
    </svg>
  );
}

function SkillChip({
  label,
  onClick,
  muted,
}: {
  label: string;
  onClick?: () => void;
  muted?: boolean;
}) {
  const clickable = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      style={{
        fontFamily: BODY_FONT,
        fontSize: 11.5,
        fontWeight: 600,
        color: muted ? MUTED : INK,
        background: "none",
        border: `1px ${muted ? "dashed" : "solid"} ${LINE}`,
        borderRadius: 999,
        padding: "4px 10px",
        cursor: clickable ? "pointer" : "default",
      }}
    >
      {label}
    </button>
  );
}

function OverviewTab({ detail }: { detail: SkillDetail }) {
  const { selectSkill } = useWorld();

  const trend = detail.trend ?? "steady";
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

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: YELLOW,
            flexShrink: 0,
          }}
        />

        <div
          style={{
            fontFamily: DISPLAY_FONT,
            fontSize: 15,
            fontWeight: 700,
          }}
        >
          {LEVEL_LABEL[detail.level] ?? detail.level} · {detail.depthScore}/100
        </div>
      </div>

      <div
        style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}
      >
        <Pill color={TREND_COLOR[trend]}>{TREND_LABEL[trend] ?? trend}</Pill>
        {detail.confidence && (
          <Pill>
            {CONFIDENCE_LABEL[detail.confidence] ?? detail.confidence}
          </Pill>
        )}
        {quality && <Pill>{quality} strong evidence</Pill>}
        <Pill>last used {recencyLabel(detail.recencyDays)}</Pill>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
          marginBottom: 20,
        }}
      >
        <StatCard label="files touched" value={String(detail.filesTouched)} />

        <StatCard label="commits" value={String(detail.commitsCount)} />

        <StatCard label="repositories" value={String(detail.reposCount)} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
          marginBottom: 20,
        }}
      >
        <EvidenceMetric value={`+${detail.linesAdded}`} label="lines added" />

        <EvidenceMetric
          value={`-${detail.linesDeleted}`}
          label="lines deleted"
        />

        <EvidenceMetric value={String(detail.activeDays)} label="active days" />

        <EvidenceMetric
          value={
            detail.recentCommits !== undefined
              ? `${detail.recentCommits} / ${detail.priorCommits ?? 0}`
              : formatDate(detail.lastSeen)
          }
          label={
            detail.recentCommits !== undefined
              ? "commits: last 90d / prior 90d"
              : "last seen"
          }
        />
      </div>

      {activity.length > 0 && (
        <>
          <Divider />
          <SectionLabel>Commits per month</SectionLabel>
          <div style={{ marginTop: 10 }}>
            <Sparkline points={activity} />
          </div>
        </>
      )}

      {repositories.length > 0 && (
        <>
          <Divider />
          <SectionLabel>Where you used it</SectionLabel>
          <div
            style={{
              marginTop: 10,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {repositories.slice(0, 5).map((repo) => (
              <div
                key={repo.repositoryId}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  fontSize: 12.5,
                }}
              >
                <span style={{ fontWeight: 600, wordBreak: "break-all" }}>
                  {repo.name || repo.repositoryId}
                </span>
                <span style={{ color: MUTED, whiteSpace: "nowrap" }}>
                  {repo.commits} commits · {repo.files} files
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {related.length > 0 && (
        <>
          <Divider />
          <SectionLabel>Usually changed together with</SectionLabel>
          <div
            style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}
          >
            {related.map((r) => (
              <SkillChip
                key={r.skillId}
                label={`${r.skillName} · ${r.commits}`}
                onClick={() => selectSkill(r.skillId)}
              />
            ))}
          </div>
        </>
      )}

      {(implies.length > 0 || impliedBy.length > 0) && (
        <>
          <Divider />
          {implies.length > 0 && (
            <>
              <SectionLabel>Also counts toward</SectionLabel>
              <div
                style={{
                  margin: "10px 0 12px",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                }}
              >
                {implies.map((r) => (
                  <SkillChip key={r.skillId} label={r.skillName} muted />
                ))}
              </div>
            </>
          )}
          {impliedBy.length > 0 && (
            <>
              <SectionLabel>Partly proven by</SectionLabel>
              <div
                style={{
                  marginTop: 10,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                }}
              >
                {impliedBy.map((r) => (
                  <SkillChip key={r.skillId} label={r.skillName} muted />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {nextSteps.length > 0 && (
        <>
          <Divider />
          <SectionLabel>Natural next skills</SectionLabel>
          <div
            style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}
          >
            {nextSteps.map((r) => (
              <SkillChip key={r.skillId} label={r.skillName} muted />
            ))}
          </div>
        </>
      )}

      <Divider />

      <SectionLabel>Proof from the commit history</SectionLabel>

      {detail.proof.length === 0 ? (
        <p
          style={{
            fontSize: 12.5,
            color: MUTED,
            margin: "10px 0 0",
          }}
        >
          No individual file evidence available.
        </p>
      ) : (
        <div
          style={{
            marginTop: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {detail.proof.map((item) => (
            <ProofRow
              key={`${item.repositoryId}-${item.commitSha}-${item.path}`}
              title={item.path}
              href={item.commitUrl || undefined}
              tag={
                item.implied
                  ? "implied"
                  : item.strength === "weak"
                    ? "weak"
                    : undefined
              }
              description={`${item.repositoryName || item.repositoryId} · ${shortSha(
                item.commitSha,
              )} · +${item.additions}/-${item.deletions} · ${formatDate(
                item.createdAt,
              )}`}
            />
          ))}
        </div>
      )}

      <p
        style={{
          fontSize: 11.5,
          lineHeight: 1.5,
          color: MUTED,
          margin: "18px 0 0",
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
      <div>
        <p
          style={{
            fontSize: 13,
            color: MUTED,
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          Reading your commits and figuring out what you actually built…
        </p>
      </div>
    );
  }

  if (error && !insight) {
    return (
      <div>
        <p
          style={{
            fontSize: 13,
            color: "#c0392b",
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          Couldn't generate an AI insight: {error}
        </p>

        <RetryButton onClick={onRegenerate} />
      </div>
    );
  }

  if (!insight) {
    return (
      <p
        style={{
          fontSize: 13,
          color: MUTED,
          margin: 0,
          lineHeight: 1.5,
        }}
      >
        No AI build insight available yet for this skill.
      </p>
    );
  }

  return (
    <>
      
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          marginBottom: 14,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: YELLOW,
            flexShrink: 0,
            marginTop: 6,
          }}
        />

        <div
          style={{
            fontFamily: DISPLAY_FONT,
            fontSize: 15,
            fontWeight: 700,
            lineHeight: 1.3,
          }}
        >
          {insight.headline}
        </div>
      </div>

      
      <div
        style={{
          background: PAPER_DARK,
          borderRadius: 10,
          padding: "14px 14px 15px",
          marginBottom: 20,
          borderLeft: `3px solid ${YELLOW}`,
        }}
      >
        <div
          style={{
            fontSize: 10.5,
            color: MUTED,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            marginBottom: 7,
          }}
        >
          What you built
        </div>

        <p
          style={{
            fontSize: 13.5,
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          {insight.whatYouBuilt}
        </p>
      </div>

      
      {insight.thingsBuilt?.length > 0 && (
        <>
          <SectionLabel>Things you built</SectionLabel>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              marginTop: 10,
            }}
          >
            {insight.thingsBuilt.map((thing, index) => (
              <BuiltThingCard key={`${thing.title}-${index}`} thing={thing} />
            ))}
          </div>

          <Divider />
        </>
      )}

      
      {insight.keyContributions.length > 0 && (
        <>
          <SectionLabel>Key contributions</SectionLabel>

          <ul
            style={{
              listStyle: "none",
              margin: "10px 0 0",
              padding: 0,
            }}
          >
            {insight.keyContributions.map((contribution, index) => (
              <li
                key={index}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 9,
                  fontSize: 13.5,
                  lineHeight: 1.45,
                  padding: "6px 0",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: YELLOW,
                    flexShrink: 0,
                    marginTop: 6,
                  }}
                />

                <span>{contribution}</span>
              </li>
            ))}
          </ul>

          <Divider />
        </>
      )}

      
      {insight.notableFiles.length > 0 && (
        <>
          <SectionLabel>Notable files</SectionLabel>

          <div
            style={{
              marginTop: 10,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {insight.notableFiles.map((file, index) => (
              <ProofRow
                key={index}
                title={file.path}
                description={`${file.repo} · ${file.note}`}
              />
            ))}
          </div>

          <Divider />
        </>
      )}

      
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: MUTED,
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          {CONFIDENCE_LABEL[insight.confidence] ?? insight.confidence}
        </span>

        <button
          type="button"
          onClick={onRegenerate}
          disabled={isLoading}
          style={{
            background: "none",
            border: `1px solid ${LINE}`,
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 11.5,
            fontWeight: 600,
            color: INK,
            cursor: isLoading ? "default" : "pointer",
            opacity: isLoading ? 0.5 : 1,
          }}
        >
          {isLoading ? "Regenerating…" : "Regenerate"}
        </button>
      </div>

      <p
        style={{
          fontSize: 11,
          lineHeight: 1.5,
          color: MUTED,
          margin: "12px 0 0",
        }}
      >
        {insight.cached ? "Cached from a previous run" : "Freshly generated"} ·{" "}
        {formatDate(insight.generatedAt)}
      </p>
    </>
  );
}





function BuiltThingCard({ thing }: { thing: SkillInsightBuiltThing }) {
  return (
    <div
      style={{
        border: `1px solid ${LINE}`,
        borderRadius: 10,
        overflow: "hidden",
        background: PAPER,
      }}
    >
      
      <div
        style={{
          padding: "12px 13px 11px",
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
            style={{
              fontFamily: DISPLAY_FONT,
              fontSize: 14,
              fontWeight: 700,
              lineHeight: 1.3,
            }}
          >
            {thing.title}
          </div>

          <ConfidenceBadge confidence={thing.confidence} />
        </div>

        <p
          style={{
            fontSize: 12.5,
            lineHeight: 1.55,
            margin: "7px 0 0",
            color: INK,
          }}
        >
          {thing.description}
        </p>
      </div>

      
      {thing.evidence?.length > 0 && (
        <div
          style={{
            borderTop: `1px solid ${LINE}`,
            background: PAPER_DARK,
            padding: "9px 11px 10px",
          }}
        >
          <div
            style={{
              fontSize: 9.5,
              color: MUTED,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: 7,
            }}
          >
            Evidence
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {thing.evidence.map((evidence, index) => (
              <div
                key={`${evidence.repo}-${evidence.file}-${evidence.commit}-${index}`}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 7,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: YELLOW,
                    flexShrink: 0,
                    marginTop: 5,
                  }}
                />

                <div
                  style={{
                    minWidth: 0,
                    fontSize: 10.5,
                    lineHeight: 1.4,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 700,
                      wordBreak: "break-all",
                    }}
                  >
                    {evidence.file}
                  </div>

                  <div
                    style={{
                      color: MUTED,
                      marginTop: 1,
                    }}
                  >
                    {evidence.repo} · {shortSha(evidence.commit)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}





function ConfidenceBadge({
  confidence,
}: {
  confidence: "low" | "medium" | "high";
}) {
  return (
    <span
      style={{
        flexShrink: 0,
        fontSize: 9.5,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.3,
        color: MUTED,
        border: `1px solid ${LINE}`,
        borderRadius: 999,
        padding: "3px 6px",
      }}
    >
      {confidence}
    </span>
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
        borderBottom: `2px solid ${isActive ? YELLOW : "transparent"}`,
        padding: "8px 4px 10px",
        marginRight: 18,
        fontSize: 12.5,
        fontWeight: 700,
        color: isActive ? INK : MUTED,
        cursor: "pointer",
        textTransform: "uppercase",
        letterSpacing: 0.4,
      }}
    >
      {label}
    </button>
  );
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        marginTop: 10,
        background: "none",
        border: `1px solid ${LINE}`,
        borderRadius: 8,
        padding: "6px 10px",
        fontSize: 11.5,
        fontWeight: 600,
        color: INK,
        cursor: "pointer",
      }}
    >
      Try again
    </button>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: PAPER_DARK,
        borderRadius: 10,
        padding: "10px 8px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontFamily: DISPLAY_FONT,
          fontSize: 17,
          fontWeight: 700,
        }}
      >
        {value}
      </div>

      <div
        style={{
          fontSize: 10.5,
          color: MUTED,
          marginTop: 2,
          textTransform: "uppercase",
          letterSpacing: 0.3,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function ProofRow({
  title,
  description,
  href,
  tag,
}: {
  title: string;
  description?: string;
  href?: string;
  tag?: string;
}) {
  const titleNode = (
    <div
      style={{
        fontSize: 12.5,
        fontWeight: 700,
        marginBottom: description ? 2 : 0,
        wordBreak: "break-all",
        color: INK,
      }}
    >
      {title}
      {tag && (
        <span
          style={{
            marginLeft: 6,
            fontSize: 9.5,
            fontWeight: 700,
            textTransform: "uppercase",
            color: MUTED,
            border: `1px solid ${LINE}`,
            borderRadius: 999,
            padding: "1px 6px",
          }}
        >
          {tag}
        </span>
      )}
    </div>
  );

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        padding: "10px 12px",
        background: PAPER_DARK,
        borderRadius: 9,
      }}
    >
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: PAPER,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        ✓
      </div>

      <div style={{ minWidth: 0 }}>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: "none" }}
          >
            {titleNode}
          </a>
        ) : (
          titleNode
        )}

        {description && (
          <div
            style={{
              fontSize: 11.5,
              lineHeight: 1.45,
              color: MUTED,
            }}
          >
            {description}
          </div>
        )}
      </div>
    </div>
  );
}

function EvidenceMetric({ value, label }: { value: string; label: string }) {
  return (
    <div
      style={{
        border: `1px solid ${LINE}`,
        borderRadius: 9,
        padding: "10px 11px",
      }}
    >
      <div
        style={{
          fontFamily: DISPLAY_FONT,
          fontSize: 16,
          fontWeight: 700,
        }}
      >
        {value}
      </div>

      <div
        style={{
          fontSize: 10.5,
          color: MUTED,
          marginTop: 2,
          textTransform: "uppercase",
          letterSpacing: 0.3,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: MUTED,
        textTransform: "uppercase",
        letterSpacing: 0.6,
      }}
    >
      {children}
    </span>
  );
}

function Divider() {
  return (
    <div
      style={{
        height: 1,
        background: LINE,
        margin: "18px 0",
      }}
    />
  );
}
