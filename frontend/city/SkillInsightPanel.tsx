import { useState, type ReactNode } from "react";
import { useWorld } from "./WorldContext";
import {
  BODY_FONT,
  DISPLAY_FONT,
  INK,
  MUTED,
  PAPER_LIGHT,
  YELLOW,
} from "./Theme";
import type { InsightSkill } from "../src/types";





function Group({
  title,
  color,
  skills,
  onPick,
}: {
  title: string;
  color: string;
  skills: InsightSkill[];
  onPick: (slug: string) => void;
}): ReactNode {
  if (skills.length === 0) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: 0.5,
          textTransform: "uppercase",
          color,
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {skills.map((s) => (
          <button
            key={s.skillId}
            type="button"
            onClick={() => onPick(s.skillId)}
            title={`${s.categoryName} · ${s.level} · ${s.depthScore}/100`}
            style={{
              fontFamily: BODY_FONT,
              fontSize: 11.5,
              fontWeight: 600,
              color: INK,
              background: "#fff",
              border: `1.5px solid ${INK}`,
              borderRadius: 999,
              padding: "3px 10px",
              cursor: "pointer",
            }}
          >
            {s.skillName} · {s.depthScore}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SkillInsightsPanel(): ReactNode {
  const {
    insights,
    areas,
    viewMode,
    selectedSkillSlug,
    focusArea,
    selectSkill,
  } = useWorld();
  const [open, setOpen] = useState(true);

  if (viewMode !== "skills" || selectedSkillSlug || !insights) return null;

  const pick = (slug: string) => {
    const area = areas.find((a) => a.skills.some((s) => s.slug === slug));
    if (area) focusArea(area.id);
    selectSkill(slug);
  };

  const h = insights.headline;

  return (
    <div
      style={{
        position: "fixed",
        left: 20,
        bottom: 24,
        zIndex: 10,
        width: 300,
        maxWidth: "86vw",
        maxHeight: "60vh",
        overflowY: "auto",
        fontFamily: BODY_FONT,
        color: INK,
        background: PAPER_LIGHT,
        border: `1.5px solid ${INK}`,
        borderRadius: 16,
        boxShadow: "0 4px 0 rgba(27,27,34,0.1)",
        padding: "12px 14px 14px",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "flex",
          width: "100%",
          justifyContent: "space-between",
          alignItems: "center",
          fontFamily: DISPLAY_FONT,
          fontSize: 14,
          fontWeight: 700,
        }}
      >
        <span>Skill insights</span>
        <span style={{ color: MUTED }}>{open ? "–" : "+"}</span>
      </button>

      {open && (
        <>
          <p
            style={{
              fontSize: 12,
              color: MUTED,
              margin: "6px 0 0",
              lineHeight: 1.5,
            }}
          >
            {h.totalSkills} skills · {h.advancedOrExpert} advanced or expert ·
            avg {h.averageScore}/100
            {h.strongestCategory ? ` · strongest: ${h.strongestCategory}` : ""}
          </p>

          <Group
            title="Strongest"
            color={INK}
            skills={insights.strengths}
            onPick={pick}
          />
          <Group
            title="Rising"
            color="#2FAE7A"
            skills={insights.rising}
            onPick={pick}
          />
          <Group
            title="Cooling off"
            color="#E8862E"
            skills={insights.cooling}
            onPick={pick}
          />
          <Group
            title="Thin evidence"
            color={MUTED}
            skills={insights.thinEvidence}
            onPick={pick}
          />

          {insights.adjacent.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  color: MUTED,
                  marginBottom: 6,
                  borderBottom: `2px solid ${YELLOW}`,
                  paddingBottom: 4,
                }}
              >
                Learn next
              </div>
              {insights.adjacent.slice(0, 5).map((a) => (
                <div
                  key={a.skillId}
                  style={{ fontSize: 12, lineHeight: 1.45, padding: "3px 0" }}
                >
                  <strong>{a.skillName}</strong>
                  <span style={{ color: MUTED }}>
                    {" "}
                    — pairs with {a.because.join(", ")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
