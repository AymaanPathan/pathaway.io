/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-refresh/only-export-components */
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  BUILDING_W,
  LOBBY_H,
  MAX_FLOORS,
  OutlinedBox,
  SkillProp,
  UNIT_BOX,
  getBasicMaterial,
  getFlatMaterial,
  noRaycast,
} from "./cityKit";
import { INK, ROOM_PALETTE, type RoomHue } from "./Theme";
import type { SkillEvidence } from "../src/types";

const W = BUILDING_W;
const WALL_T = 0.12;
const INNER_W = W - WALL_T * 2;
const LINTEL_H = 0.42;

const DEPTH_RANK: Record<string, number> = {
  insufficient_evidence: 0,
  surface: 1,
  usage: 2,
  repeated_usage: 3,
  implementation: 4,
  strong: 5,

  novice: 1,
  familiar: 2,
  proficient: 3,
  advanced: 4,
  expert: 5,
};

export interface Floor {
  key: string;
  slug: string;
  name: string;
  depth: string;
  rank: number;
  score: number;
  trend: string;
  confidence: string;
  activity: number[];
  y0: number;
  h: number;
}

export function getFloorPlan(
  skills: SkillEvidence[] | null | undefined,
  height: number,
): Floor[] {
  const list: SkillEvidence[] = Array.isArray(skills) ? skills : [];
  if (list.length === 0) return [];

  const ranked = list
    .map((s: any) => {
      const label = (s.level ?? s.depth ?? "") as string;
      return {
        s,
        label,
        rank: DEPTH_RANK[label] ?? 0,
        score: Number(s.depthScore ?? 0),
      };
    })

    .sort((a, b) => b.score - a.score || b.rank - a.rank)
    .slice(0, MAX_FLOORS);

  const space = Math.max(0.6, height - LOBBY_H);
  const h = space / ranked.length;

  return ranked.map(({ s, label, rank, score }, i) => ({
    key: `${s.slug}-${i}`,
    slug: s.slug,
    name: s.name,
    depth: label,
    rank,
    score,
    trend: (s.trend ?? "steady") as string,
    confidence: (s.confidence ?? "medium") as string,
    activity: (s.activity ?? []).slice(-12).map((p: any) => p.count),
    y0: LOBBY_H + i * h,
    h,
  }));
}

const SIGN_GEO = new THREE.PlaneGeometry(1, 1);
const signCache = new Map<string, THREE.MeshBasicMaterial>();

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

const TREND_GLYPH: Record<string, { glyph: string; color: string }> = {
  rising: { glyph: "▲", color: "#2FAE7A" },
  cooling: { glyph: "▼", color: "#E8862E" },
  dormant: { glyph: "zz", color: "#8b7a4d" },
};

function getSignMaterial(
  label: string,
  accent: string,
  trend: string,
): THREE.MeshBasicMaterial {
  const key = `${label}|${accent}|${trend}`;
  const hit = signCache.get(key);
  if (hit) return hit;

  const w = 512;
  const h = 128;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const mat = new THREE.MeshBasicMaterial({
    transparent: true,
    toneMapped: false,
    opacity: trend === "dormant" ? 0.7 : 1,
  });

  if (ctx) {
    roundRectPath(ctx, 6, 6, w - 12, h - 12, 40);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = INK;
    ctx.stroke();

    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(62, h / 2, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.stroke();

    ctx.fillStyle = INK;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    let size = 60;
    ctx.font = `700 ${size}px "Space Grotesk","Arial Black",sans-serif`;
    const badge = TREND_GLYPH[trend];
    const maxText = w - (badge ? 200 : 150);
    while (ctx.measureText(label).width > maxText && size > 20) {
      size -= 4;
      ctx.font = `700 ${size}px "Space Grotesk","Arial Black",sans-serif`;
    }
    ctx.fillText(label, 100, h / 2 + 3);

    if (badge) {
      ctx.font = `700 34px "Space Grotesk","Arial Black",sans-serif`;
      ctx.textAlign = "right";
      ctx.fillStyle = badge.color;
      ctx.fillText(badge.glyph, w - 36, h / 2 + 3);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    mat.map = tex;
  }

  signCache.set(key, mat);
  return mat;
}

function FloorBands({
  floors,
  hue,
}: {
  floors: Floor[];
  hue: RoomHue;
}): ReactNode {
  return (
    <>
      {floors.map((f) => (
        <group key={f.key}>
          <OutlinedBox
            args={[W + 0.14, 0.09, W + 0.14]}
            position={[0, f.y0, 0]}
            color={hue.roof}
            thickness={1.05}
          />
          <mesh
            geometry={SIGN_GEO}
            material={getSignMaterial(f.name, hue.roof, f.trend)}
            position={[0, f.y0 + f.h - LINTEL_H / 2, W / 2 + 0.03]}
            scale={[1.9, 0.38, 1]}
            raycast={noRaycast}
          />
        </group>
      ))}
    </>
  );
}

interface FloorRoomProps {
  floor: Floor;
  order: number;
  hue: RoomHue;
  selected: boolean;
  hovered: boolean;
  onSelect: (slug: string) => void;
  onHover: (slug: string | null) => void;
}

const FloorRoom = memo(function FloorRoom({
  floor,
  order,
  hue,
  selected,
  hovered,
  onSelect,
  onHover,
}: FloorRoomProps): ReactNode {
  const wallRef = useRef<THREE.Group>(null);
  const born = useRef<number>(performance.now());
  const done = useRef<boolean>(false);

  useFrame(() => {
    if (done.current || !wallRef.current) return;
    const t = Math.min(
      (performance.now() - born.current - order * 90) / 480,
      1,
    );
    if (t < 0) return;
    const eased = 1 - Math.pow(1 - t, 3);
    wallRef.current.scale.y = Math.max(0.001, 1 - eased);
    if (t >= 1) {
      wallRef.current.visible = false;
      done.current = true;
    }
  });

  const { h } = floor;
  const frontZ = W / 2 - WALL_T / 2;
  const frontWallH = Math.max(0.1, h - LINTEL_H - 0.1);

  const s = Math.min(1, Math.max(0.55, (h - 0.2) / 1.4));
  const ceilY = (h - 0.2) / s;

  const books = [0, 1, 2, 3, 4, 5].map((k) => ({
    y: 0.14 + Math.floor(k / 2) * 0.22,
    z: 0.0 + (k % 2) * 0.32,
    color: ROOM_PALETTE[(order + k) % ROOM_PALETTE.length].body,
  }));

  return (
    <group
      position={[0, floor.y0, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(floor.slug);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(floor.slug);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        onHover(null);
        document.body.style.cursor = "auto";
      }}
    >
      <OutlinedBox
        args={[INNER_W, h, WALL_T]}
        position={[0, h / 2, -(W / 2 - WALL_T / 2)]}
        color={hue.body}
        thickness={1.02}
      />
      <OutlinedBox
        args={[WALL_T, h, W]}
        position={[-(W / 2 - WALL_T / 2), h / 2, 0]}
        color={hue.body}
        thickness={1.02}
      />
      <OutlinedBox
        args={[WALL_T, h, W]}
        position={[W / 2 - WALL_T / 2, h / 2, 0]}
        color={hue.body}
        thickness={1.02}
      />
      <OutlinedBox
        args={[INNER_W, LINTEL_H, WALL_T]}
        position={[0, h - LINTEL_H / 2, frontZ]}
        color={hue.body}
        thickness={1.02}
        castShadow={false}
      />

      <group ref={wallRef} position={[0, 0.1, frontZ]}>
        <OutlinedBox
          args={[INNER_W, frontWallH, WALL_T]}
          position={[0, frontWallH / 2, 0]}
          color={hue.body}
          thickness={1.02}
          castShadow={false}
        />
      </group>

      <OutlinedBox
        args={[INNER_W, 0.1, INNER_W]}
        position={[0, 0.05, 0]}
        color={hue.window}
        thickness={1.02}
        castShadow={false}
        receiveShadow={false}
      />

      <group position={[0, 0.1, 0]} scale={s}>
        <mesh
          geometry={UNIT_BOX}
          material={getFlatMaterial(hue.body)}
          position={[0.1, 0.012, 0.25]}
          scale={[2.0, 0.024, 1.5]}
        />

        <OutlinedBox
          args={[1.5, 0.1, 0.62]}
          position={[0.3, 0.62, -0.95]}
          color="#ffffff"
          thickness={1.04}
          castShadow={false}
          receiveShadow={false}
        />
        <OutlinedBox
          args={[0.1, 0.5, 0.5]}
          position={[-0.38, 0.32, -0.95]}
          color={hue.roof}
          thickness={1.05}
          castShadow={false}
          receiveShadow={false}
        />
        <OutlinedBox
          args={[0.1, 0.5, 0.5]}
          position={[0.98, 0.32, -0.95]}
          color={hue.roof}
          thickness={1.05}
          castShadow={false}
          receiveShadow={false}
        />

        <OutlinedBox
          args={[0.62, 0.4, 0.05]}
          position={[0.1, 0.93, -1.14]}
          color={INK}
          thickness={1.04}
          castShadow={false}
          receiveShadow={false}
        />
        <mesh
          geometry={UNIT_BOX}
          material={getBasicMaterial(selected ? "#ffffff" : hue.window)}
          position={[0.1, 0.93, -1.11]}
          scale={[0.52, 0.3, 0.01]}
          raycast={noRaycast}
        />
        <mesh
          geometry={UNIT_BOX}
          material={getFlatMaterial(INK)}
          position={[0.1, 0.7, -1.14]}
          scale={[0.08, 0.14, 0.06]}
        />

        {floor.activity.length > 0 &&
          (() => {
            const max = Math.max(...floor.activity, 1);
            const n = floor.activity.length;
            return floor.activity.map((c, k) => {
              const bh = 0.03 + (c / max) * 0.2;
              return (
                <mesh
                  key={k}
                  geometry={UNIT_BOX}
                  material={getBasicMaterial(hue.roof)}
                  position={[
                    0.1 - 0.22 + k * (0.44 / Math.max(n - 1, 1)),
                    0.8 + bh / 2,
                    -1.095,
                  ]}
                  scale={[0.026, bh, 0.005]}
                  raycast={noRaycast}
                />
              );
            });
          })()}

        <group position={[0.85, 0.67, -0.9]} scale={2.4}>
          <SkillProp
            position={[0, 0, 0]}
            accent={hue.roof}
            depth={floor.depth}
            name={floor.name}
          />
        </group>

        <OutlinedBox
          args={[0.42, 0.07, 0.42]}
          position={[0.3, 0.36, -0.35]}
          color={hue.roof}
          thickness={1.05}
          castShadow={false}
          receiveShadow={false}
        />
        <OutlinedBox
          args={[0.42, 0.4, 0.07]}
          position={[0.3, 0.6, -0.12]}
          color={hue.roof}
          thickness={1.05}
          castShadow={false}
          receiveShadow={false}
        />
        <mesh
          geometry={UNIT_BOX}
          material={getFlatMaterial(INK)}
          position={[0.3, 0.18, -0.35]}
          scale={[0.06, 0.34, 0.06]}
        />

        <OutlinedBox
          args={[0.2, 0.9, 1.1]}
          position={[-1.22, 0.45, 0.3]}
          color={hue.roof}
          thickness={1.04}
          castShadow={false}
          receiveShadow={false}
        />
        {books.map((b, i) => (
          <mesh
            key={i}
            geometry={UNIT_BOX}
            material={getFlatMaterial(b.color)}
            position={[-1.09, b.y + 0.12, 0.05 + b.z]}
            scale={[0.1, 0.16, 0.14]}
          />
        ))}

        <OutlinedBox
          args={[1.7, 0.06, 0.36]}
          position={[0, 0.03, 1.12]}
          color="#ffffff"
          thickness={1.05}
          castShadow={false}
          receiveShadow={false}
        />
        {[0, 1, 2, 3, 4].map((k) => (
          <mesh
            key={k}
            geometry={UNIT_BOX}
            material={
              k < floor.rank
                ? getBasicMaterial(hue.roof)
                : getFlatMaterial("#d9d2bd")
            }
            position={[-0.6 + k * 0.3, 0.17, 1.12]}
            scale={[0.2, 0.16, 0.2]}
            raycast={noRaycast}
          />
        ))}

        <mesh
          geometry={UNIT_BOX}
          material={getBasicMaterial("#fff6dc")}
          position={[0.2, ceilY - 0.03, 0]}
          scale={[0.8, 0.05, 0.4]}
          raycast={noRaycast}
        />
      </group>

      {(selected || hovered) && (
        <mesh
          geometry={UNIT_BOX}
          material={getBasicMaterial(hue.roof, selected ? 0.24 : 0.12)}
          position={[0, h / 2, 0]}
          scale={[W + 0.3, h, W + 0.3]}
          raycast={noRaycast}
        />
      )}
    </group>
  );
});

function FloorShell({
  floors,
  hue,
  selectedSlug,
  onSelect,
}: {
  floors: Floor[];
  hue: RoomHue;
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
}): ReactNode {
  const [hover, setHover] = useState<string | null>(null);

  useEffect(
    () => () => {
      document.body.style.cursor = "auto";
    },
    [],
  );

  return (
    <group>
      {floors.map((f, i) => (
        <FloorRoom
          key={f.key}
          floor={f}
          order={i}
          hue={hue}
          selected={selectedSlug === f.slug}
          hovered={hover === f.slug}
          onSelect={onSelect}
          onHover={setHover}
        />
      ))}
    </group>
  );
}

interface BuildingFloorsProps {
  floors: Floor[];
  hue: RoomHue;
  isFocused: boolean;
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
}

export const BuildingFloors = memo(function BuildingFloors({
  floors,
  hue,
  isFocused,
  selectedSlug,
  onSelect,
}: BuildingFloorsProps): ReactNode {
  if (floors.length === 0) return null;
  return (
    <>
      <FloorBands floors={floors} hue={hue} />
      {isFocused && (
        <FloorShell
          floors={floors}
          hue={hue}
          selectedSlug={selectedSlug}
          onSelect={onSelect}
        />
      )}
    </>
  );
});
