/* eslint-disable react-hooks/purity */
/* eslint-disable react-hooks/set-state-in-effect */
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFrame, useThree, type RootState } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { HUB_POSITION } from "./mockGraph";
import { useWorld, CONSTRUCTION_DURATION_MS } from "./WorldContext";
import {
  BRIDGE_W,
  BRIDGE_Y,
  BUILDING_W,
  CategorySetDressing,
  DECK_THICKNESS,
  HUB_PODIUM_H,
  HUB_RADIUS,
  LANDING_DEPTH,
  LOBBY_H,
  MAX_FLOORS,
  OutlinedBox,
  OutlinedCylinder,
  cachedCylinder,
  cachedSphere,
  getOutlineMaterial,
  getToonMaterial,
  getBridgeSpan,
  getBuildingAngle,
  getBuildingHeight,
  getRingRadius,
  getRoomArchetype,
} from "./cityKit";
import {
  BODY_FONT,
  DISPLAY_FONT,
  GRASS_DARK,
  HOME_CORE,
  INK,
  MUTED,
  PATH_STONE,
  YELLOW,
  getRoomTheme,
  type RoomHue,
} from "./Theme";
import { BuildingFloors, getFloorPlan } from "./BuildingFloors";
import type { Area, SkillEvidence } from "../src/types";

const GITHUB_PATH: string =
  "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z";

const FALLBACK_LOGIN = "aymaan pathan";
const ROAD_COLOR = "#5A5A66";

function hash01(a: number, b: number, c: number, d: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7 + d * 269.5) * 43758.5453;
  return s - Math.floor(s);
}

function useGithubTexture(): THREE.CanvasTexture {
  return useMemo(() => {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2D context");

    const grad = ctx.createRadialGradient(
      size / 2,
      size / 2,
      8,
      size / 2,
      size / 2,
      size / 2,
    );
    grad.addColorStop(0, "#2b2f36");
    grad.addColorStop(1, "#12151a");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();

    const path = new Path2D(GITHUB_PATH);
    const scale = (size * 0.6) / 16;
    ctx.save();
    ctx.translate((size - 16 * scale) / 2, (size - 16 * scale) / 2);
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff";
    ctx.fill(path);
    ctx.restore();

    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }, []);
}

function useAvatarTexture(url: string | null): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    if (!url) {
      setTex(null);
      return;
    }
    let cancelled = false;
    let loaded: THREE.Texture | null = null;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      url,
      (t) => {
        if (cancelled) {
          t.dispose();
          return;
        }
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        loaded = t;
        setTex(t);
      },
      undefined,
      () => {
        if (!cancelled) setTex(null);
      },
    );
    return () => {
      cancelled = true;
      loaded?.dispose();
    };
  }, [url]);

  return tex;
}

function CityFloor({ radius }: { radius: number }): ReactNode {
  const plazaR = radius + BUILDING_W / 2 + 1.1;
  const roadIn = plazaR + 0.25;
  const roadOut = roadIn + 2.0;
  const roadMid = (roadIn + roadOut) / 2;

  return (
    <group position={[HUB_POSITION[0], HUB_POSITION[1], HUB_POSITION[2]]}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.02, 0]}
        receiveShadow
      >
        <circleGeometry args={[plazaR, 72]} />
        <meshStandardMaterial color={PATH_STONE} roughness={0.9} />
      </mesh>

      {}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[plazaR, roadIn, 96]} />
        <meshStandardMaterial color={INK} roughness={0.8} />
      </mesh>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.045, 0]}
        receiveShadow
      >
        <ringGeometry args={[roadIn, roadOut, 96]} />
        <meshStandardMaterial color={ROAD_COLOR} roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.07, 0]}>
        <ringGeometry args={[roadMid - 0.05, roadMid + 0.05, 96]} />
        <meshStandardMaterial
          color={YELLOW}
          emissive={YELLOW}
          emissiveIntensity={0.25}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[roadOut, roadOut + 0.14, 96]} />
        <meshStandardMaterial color={INK} roughness={0.8} />
      </mesh>
    </group>
  );
}

interface TreeItem {
  pos: [number, number, number];
  s: number;
}

function InstancedBatch({
  geometry,
  material,
  items,
  yOffset,
  mult,
  castShadow = false,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  items: TreeItem[];
  yOffset: number;
  mult: number;
  castShadow?: boolean;
}): ReactNode {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    items.forEach((it, i) => {
      dummy.position.set(it.pos[0], it.pos[1] + yOffset * it.s, it.pos[2]);
      dummy.scale.setScalar(it.s * mult);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [items, yOffset, mult]);

  if (items.length === 0) return null;

  return (
    <instancedMesh
      key={items.length}
      ref={ref}
      args={[geometry, material, items.length]}
      castShadow={castShadow}
      receiveShadow={castShadow}
      frustumCulled={false}
    />
  );
}

function CityTrees({
  radius,
  count,
}: {
  radius: number;
  count: number;
}): ReactNode {
  const trees = useMemo<TreeItem[]>(() => {
    const n = Math.max(count, 6);
    const plazaR = radius + BUILDING_W / 2 + 1.1;
    const outerR = plazaR + 0.25 + 2.0 + 1.7;
    const out: TreeItem[] = [];

    for (let i = 0; i < n; i++) {
      const a = getBuildingAngle(i + 0.5, n);
      out.push({
        pos: [
          HUB_POSITION[0] + Math.cos(a) * radius,
          HUB_POSITION[1],
          HUB_POSITION[2] + Math.sin(a) * radius,
        ],
        s: 1.0 + hash01(i, 1, 2, 3) * 0.4,
      });
    }

    for (let i = 0; i < n; i++) {
      const a = getBuildingAngle(i + 0.25, n);
      out.push({
        pos: [
          HUB_POSITION[0] + Math.cos(a) * outerR,
          HUB_POSITION[1],
          HUB_POSITION[2] + Math.sin(a) * outerR,
        ],
        s: 1.2 + hash01(i, 4, 5, 6) * 0.7,
      });
    }
    return out;
  }, [radius, count]);

  const trunkGeo = cachedCylinder([0.07, 0.09, 0.5, 8]);
  const crownGeo = cachedSphere([0.4, 14, 12, 0, Math.PI * 2, 0, Math.PI]);
  const trunkMat = getToonMaterial("#8B5A2B");
  const crownMat = getToonMaterial(GRASS_DARK);
  const ink = getOutlineMaterial(INK);

  return (
    <group>
      <InstancedBatch
        geometry={trunkGeo}
        material={trunkMat}
        items={trees}
        yOffset={0.25}
        mult={1}
        castShadow
      />
      <InstancedBatch
        geometry={trunkGeo}
        material={ink}
        items={trees}
        yOffset={0.25}
        mult={1.05}
      />
      <InstancedBatch
        geometry={crownGeo}
        material={crownMat}
        items={trees}
        yOffset={0.78}
        mult={1}
        castShadow
      />
      <InstancedBatch
        geometry={crownGeo}
        material={ink}
        items={trees}
        yOffset={0.78}
        mult={1.06}
      />
    </group>
  );
}

function AvatarBadge({
  y,
  texture,
}: {
  y: number;
  texture: THREE.Texture;
}): ReactNode {
  const ref = useRef<THREE.Group>(null);
  const orbitRef = useRef<THREE.Group>(null);
  const { camera } = useThree();

  useFrame(({ clock }: RootState) => {
    if (ref.current) {
      ref.current.quaternion.copy(camera.quaternion);
      ref.current.position.y = y + Math.sin(clock.elapsedTime * 1.2) * 0.08;
    }
    if (orbitRef.current) {
      orbitRef.current.rotation.z = clock.elapsedTime * 0.7;
    }
  });

  return (
    <group ref={ref} position={[0, y, 0]}>
      <mesh position={[0, 0, -0.01]}>
        <circleGeometry args={[1.0, 48]} />
        <meshBasicMaterial color={INK} side={THREE.DoubleSide} />
      </mesh>
      <mesh>
        <circleGeometry args={[0.9, 48]} />
        <meshBasicMaterial
          map={texture}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <group ref={orbitRef}>
        {[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((a) => (
          <mesh key={a} position={[Math.cos(a) * 1.22, Math.sin(a) * 1.22, 0]}>
            <sphereGeometry args={[0.075, 12, 10]} />
            <meshStandardMaterial
              color={YELLOW}
              emissive={YELLOW}
              emissiveIntensity={0.9}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function CityHub(): ReactNode {
  const { developer } = useWorld();
  const displayName = developer?.username ?? FALLBACK_LOGIN;

  const avatarUrl = useMemo(() => {
    const explicit = (developer as unknown as { avatarUrl?: string } | null)
      ?.avatarUrl;
    if (explicit) return explicit;
    const u = developer?.username;
    return u && /^[A-Za-z0-9-]+$/.test(u)
      ? `https://github.com/${u}.png?size=256`
      : null;
  }, [developer]);

  const fallback = useGithubTexture();
  const avatar = useAvatarTexture(avatarUrl);

  const pedestalH = 2.4;
  const topY = HUB_PODIUM_H + pedestalH;

  return (
    <group position={HUB_POSITION}>
      <OutlinedCylinder
        args={[HUB_RADIUS, HUB_RADIUS + 0.12, HUB_PODIUM_H, 48]}
        position={[0, HUB_PODIUM_H / 2, 0]}
        color={PATH_STONE}
        thickness={1.015}
      />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, HUB_PODIUM_H + 0.012, 0]}
      >
        <ringGeometry args={[2.3, 2.6, 56]} />
        <meshStandardMaterial
          color={YELLOW}
          emissive={YELLOW}
          emissiveIntensity={0.35}
        />
      </mesh>

      <OutlinedCylinder
        args={[0.8, 1.0, pedestalH, 28]}
        position={[0, HUB_PODIUM_H + pedestalH / 2, 0]}
        color={HOME_CORE}
        thickness={1.04}
      />
      <OutlinedCylinder
        args={[0.92, 0.92, 0.16, 28]}
        position={[0, topY + 0.08, 0]}
        color={INK}
        thickness={1.04}
      />

      <AvatarBadge y={topY + 1.55} texture={avatar ?? fallback} />

      <Html
        position={[0, topY + 3.2, 0]}
        center
        distanceFactor={12}
        style={{ pointerEvents: "none" }}
      >
        <div className="hub-label">
          <span className="hub-label__name">{displayName}</span>
          <span className="hub-label__meta">developer city</span>
        </div>
      </Html>
    </group>
  );
}

function Bridge({ area, index }: { area: Area; index: number }): ReactNode {
  const { constructions, focusedAreaId } = useWorld();
  const hue = getRoomTheme(index);
  const span = useMemo(() => getBridgeSpan(area.position), [area.position]);
  const buildStart = constructions[area.id];
  const isFocused = focusedAreaId === area.id;

  const growRef = useRef<THREE.Group>(null);
  const laneRef = useRef<THREE.Mesh>(null);

  const L = span.length;
  const deckY = BRIDGE_Y - DECK_THICKNESS / 2;
  const pierH = BRIDGE_Y - DECK_THICKNESS;
  const pierCount = Math.max(0, Math.floor(L / 3.2));

  useFrame(() => {
    if (growRef.current) {
      const t = buildStart
        ? Math.min(
            Math.max(
              (Date.now() - buildStart - CONSTRUCTION_DURATION_MS * 0.45) /
                (CONSTRUCTION_DURATION_MS * 0.55),
              0,
            ),
            1,
          )
        : 1;
      const eased = 1 - Math.pow(1 - t, 3);
      growRef.current.scale.set(1, 1, Math.max(0.001, eased));
    }
    if (laneRef.current) {
      const mat = laneRef.current.material as THREE.MeshStandardMaterial;
      const target = isFocused ? 1.1 : 0.45;
      mat.emissiveIntensity += (target - mat.emissiveIntensity) * 0.12;
    }
  });

  return (
    <group
      position={[span.start[0], HUB_POSITION[1], span.start[2]]}
      rotation={[0, span.angleY, 0]}
    >
      <group ref={growRef}>
        <OutlinedBox
          args={[BRIDGE_W, DECK_THICKNESS, L]}
          position={[0, deckY, L / 2]}
          color="#ffffff"
          thickness={1.03}
        />

        <mesh ref={laneRef} position={[0, BRIDGE_Y + 0.006, L / 2]}>
          <boxGeometry args={[0.2, 0.012, Math.max(0.1, L - 0.4)]} />
          <meshStandardMaterial
            color={hue.roof}
            emissive={hue.roof}
            emissiveIntensity={0.45}
            toneMapped={false}
          />
        </mesh>

        {[-1, 1].map((side) => (
          <mesh
            key={side}
            castShadow
            position={[side * (BRIDGE_W / 2 - 0.03), BRIDGE_Y + 0.15, L / 2]}
          >
            <boxGeometry args={[0.06, 0.3, L]} />
            <meshStandardMaterial color={INK} roughness={0.6} />
          </mesh>
        ))}

        {Array.from({ length: pierCount }).map((_, i) => (
          <OutlinedCylinder
            key={i}
            args={[0.15, 0.2, pierH, 10]}
            position={[0, pierH / 2, (L * (i + 1)) / (pierCount + 1)]}
            color="#ffffff"
            thickness={1.06}
          />
        ))}
      </group>
    </group>
  );
}

const WINDOW_STEP = 0.85;

const FRONT_START = BRIDGE_Y + 1.5;

interface WindowSlot {
  pos: [number, number, number];
  rotY: number;
  lit: boolean;
}

interface WindowFace {
  rotY: number;
  minY: number;
  place: (c: number, y: number) => [number, number, number];
}

function stepRows(height: number): number[] {
  const rows: number[] = [];
  for (let y = 0.8; y <= height - 0.6; y += WINDOW_STEP) rows.push(y);
  return rows;
}

function BuildingWindows({
  hue,
  seed,
  rowYs,
  showFront,
}: {
  hue: RoomHue;
  seed: number;
  rowYs: number[];
  showFront: boolean;
}): ReactNode {
  const ref = useRef<THREE.InstancedMesh>(null);

  const slots = useMemo<WindowSlot[]>(() => {
    const half = BUILDING_W / 2 + 0.008;
    const cols = [-0.9, 0, 0.9];
    const faces: WindowFace[] = [
      { rotY: Math.PI, minY: 0, place: (c, y) => [-c, y, -half] },
      { rotY: Math.PI / 2, minY: 0, place: (c, y) => [half, y, c] },
      { rotY: -Math.PI / 2, minY: 0, place: (c, y) => [-half, y, -c] },
    ];
    if (showFront) {
      faces.unshift({
        rotY: 0,
        minY: FRONT_START,
        place: (c, y) => [c, y, half],
      });
    }

    const out: WindowSlot[] = [];
    faces.forEach((face, fi) => {
      rowYs.forEach((y, row) => {
        if (y < face.minY) return;
        cols.forEach((c, ci) => {
          out.push({
            pos: face.place(c, y),
            rotY: face.rotY,
            lit: hash01(seed, fi, ci, row) > 0.3,
          });
        });
      });
    });
    return out;
  }, [rowYs, seed, showFront]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const lit = new THREE.Color(hue.window);
    const dark = new THREE.Color(hue.body).multiplyScalar(0.72);

    slots.forEach((s, i) => {
      dummy.position.set(...s.pos);
      dummy.rotation.set(0, s.rotY, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, s.lit ? lit : dark);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [slots, hue.window, hue.body]);

  if (slots.length === 0) return null;

  return (
    <instancedMesh
      key={slots.length}
      ref={ref}
      args={[undefined, undefined, slots.length]}
      frustumCulled={false}
    >
      <planeGeometry args={[0.5, 0.42]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

function RoofLandmark({
  archetype,
  accent,
  y,
}: {
  archetype: ReturnType<typeof getRoomArchetype>;
  accent: string;
  y: number;
}): ReactNode {
  if (archetype === "frontend" || archetype === "generic") {
    return (
      <group position={[0, y, 0]}>
        <OutlinedCylinder
          args={[0.035, 0.05, 1.2, 8]}
          position={[0.5, 0.6, -0.4]}
          color={INK}
          thickness={1.2}
        />
        <mesh position={[0.5, 1.25, -0.4]}>
          <sphereGeometry args={[0.08, 12, 10]} />
          <meshStandardMaterial
            color={accent}
            emissive={accent}
            emissiveIntensity={0.9}
            toneMapped={false}
          />
        </mesh>
        <OutlinedBox
          args={[0.6, 0.35, 0.6]}
          position={[-0.5, 0.175, 0.3]}
          color="#ffffff"
          thickness={1.05}
        />
      </group>
    );
  }
  return (
    <group position={[0, y, 0]} scale={1.5}>
      <CategorySetDressing archetype={archetype} accent={accent} />
    </group>
  );
}

interface BuildingBodyProps {
  area: Area;
  index: number;
  height: number;
  hue: RoomHue;
  archetype: ReturnType<typeof getRoomArchetype>;
  isFocused: boolean;
  selectedSlug: string | null;
  onSelectSkill: (slug: string) => void;
}

const BuildingBody = memo(function BuildingBody({
  area,
  index,
  height,
  hue,
  archetype,
  isFocused,
  selectedSlug,
  onSelectSkill,
}: BuildingBodyProps): ReactNode {
  const floors = useMemo(() => {
    const list: SkillEvidence[] = Array.isArray(area.skills) ? area.skills : [];
    return getFloorPlan(list, height);
  }, [area.skills, height]);

  const hasFloors = floors.length > 0;

  const rowYs = useMemo<number[]>(
    () =>
      hasFloors
        ? [1.35, ...floors.map((f) => f.y0 + f.h * 0.42)]
        : stepRows(height),
    [floors, hasFloors, height],
  );

  const upperH = Math.max(0.2, height - LOBBY_H);

  const showSolidUpper = !hasFloors || !isFocused;

  return (
    <>
      <OutlinedBox
        args={[BUILDING_W + 1.8, 0.1, BUILDING_W + 1.8]}
        position={[0, 0.05, 0]}
        color={PATH_STONE}
        thickness={1.015}
      />

      <OutlinedBox
        args={[BUILDING_W, LOBBY_H, BUILDING_W]}
        position={[0, LOBBY_H / 2, 0]}
        color={hue.body}
        thickness={1.02}
      />
      <OutlinedBox
        args={[BUILDING_W + 0.08, 0.5, BUILDING_W + 0.08]}
        position={[0, 0.25, 0]}
        color={hue.roof}
        thickness={1.03}
      />

      {showSolidUpper && (
        <OutlinedBox
          args={[BUILDING_W, upperH, BUILDING_W]}
          position={[0, LOBBY_H + upperH / 2, 0]}
          color={hue.body}
          thickness={1.02}
        />
      )}

      <BuildingFloors
        floors={floors}
        hue={hue}
        isFocused={isFocused}
        selectedSlug={selectedSlug}
        onSelect={onSelectSkill}
      />

      <BuildingWindows
        hue={hue}
        seed={index + 1}
        rowYs={rowYs}
        showFront={!(hasFloors && isFocused)}
      />

      <OutlinedBox
        args={[BUILDING_W + 0.3, 0.2, BUILDING_W + 0.3]}
        position={[0, height + 0.1, 0]}
        color={hue.roof}
        thickness={1.04}
      />
      <RoofLandmark archetype={archetype} accent={hue.roof} y={height + 0.2} />

      <OutlinedBox
        args={[1.5, DECK_THICKNESS, LANDING_DEPTH + 0.05]}
        position={[
          0,
          BRIDGE_Y - DECK_THICKNESS / 2,
          BUILDING_W / 2 + LANDING_DEPTH / 2,
        ]}
        color="#ffffff"
        thickness={1.03}
      />
      <mesh position={[0, BRIDGE_Y + 0.5, BUILDING_W / 2 + 0.02]}>
        <boxGeometry args={[0.6, 1.0, 0.04]} />
        <meshStandardMaterial color={INK} roughness={0.6} />
      </mesh>
      <mesh position={[0, BRIDGE_Y + 0.5, BUILDING_W / 2 + 0.045]}>
        <planeGeometry args={[0.44, 0.84]} />
        <meshStandardMaterial
          color={hue.window}
          emissive={hue.window}
          emissiveIntensity={0.6}
        />
      </mesh>
      <OutlinedBox
        args={[1.2, 0.08, 0.5]}
        position={[0, BRIDGE_Y + 1.15, BUILDING_W / 2 + 0.25]}
        color={hue.roof}
        thickness={1.05}
      />
    </>
  );
});

function Building({ area, index }: { area: Area; index: number }): ReactNode {
  const {
    focusArea,
    focusedAreaId,
    pulses,
    constructions,
    selectedSkillSlug,
    selectSkill,
  } = useWorld();
  const hue = getRoomTheme(index);
  const archetype = getRoomArchetype(area.label);
  const isFocused = focusedAreaId === area.id;
  const buildStart = constructions[area.id];

  const height = getBuildingHeight(area.skillCount, area.evidenceCount);
  const span = useMemo(() => getBridgeSpan(area.position), [area.position]);

  const facingY = span.angleY + Math.PI;

  const [hovered, setHovered] = useState(false);
  const scaleRef = useRef<THREE.Group>(null);
  const hoverScale = useRef(1);

  useFrame(() => {
    if (!scaleRef.current) return;
    const t = buildStart
      ? Math.min(
          Math.max((Date.now() - buildStart) / CONSTRUCTION_DURATION_MS, 0),
          1,
        )
      : 1;
    const eased = 1 - Math.pow(1 - t, 3);
    hoverScale.current +=
      ((hovered && !isFocused ? 1.025 : 1) - hoverScale.current) * 0.15;
    scaleRef.current.scale.set(
      hoverScale.current,
      Math.max(0.001, eased),
      hoverScale.current,
    );
  });

  const [, setTick] = useState(0);
  const pulseTs = pulses[area.id] || 0;
  const showPulse = pulseTs > 0 && Date.now() - pulseTs < 1300;
  useEffect(() => {
    if (!pulseTs) return;
    const left = 1350 - (Date.now() - pulseTs);
    if (left <= 0) return;
    const id = window.setTimeout(() => setTick((n) => n + 1), left);
    return () => window.clearTimeout(id);
  }, [pulseTs]);

  const labelY = height + 2.2;

  const handleSelectSkill = useCallback(
    (slug: string) => selectSkill(slug),
    [selectSkill],
  );

  return (
    <group position={area.position}>
      <group ref={scaleRef} rotation={[0, facingY, 0]}>
        <group
          onClick={(e) => {
            e.stopPropagation();
            if (!isFocused) focusArea(area.id);
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(true);
            if (!isFocused) document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            setHovered(false);
            document.body.style.cursor = "auto";
          }}
        >
          <BuildingBody
            area={area}
            index={index}
            height={height}
            hue={hue}
            archetype={archetype}
            isFocused={isFocused}
            selectedSlug={isFocused ? selectedSkillSlug : null}
            onSelectSkill={handleSelectSkill}
          />
        </group>
      </group>

      {isFocused || hovered ? (
        <Html
          position={[0, labelY, 0]}
          center
          distanceFactor={13}
          style={{ pointerEvents: "none" }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              fontFamily: BODY_FONT,
              padding: "6px 14px",
              borderRadius: 999,
              whiteSpace: "nowrap",
              background: "#ffffff",
              border: `2px solid ${hue.roof}`,
              boxShadow: `0 4px 0 ${hue.roof}55`,
            }}
          >
            <span
              style={{
                fontFamily: DISPLAY_FONT,
                fontSize: 13,
                fontWeight: 700,
                color: INK,
              }}
            >
              {area.label.toUpperCase()}
            </span>
            {typeof area.skillCount === "number" && (
              <span style={{ fontSize: 10, fontWeight: 600, color: MUTED }}>
                {area.skillCount} SKILL{area.skillCount === 1 ? "" : "S"}
                {typeof area.score === "number" && area.score > 0
                  ? ` · ${area.score}/100`
                  : ""}
                {area.skillCount > MAX_FLOORS
                  ? ` · TOP ${MAX_FLOORS} SHOWN`
                  : ""}
              </span>
            )}
          </div>
        </Html>
      ) : (
        <Html
          position={[0, labelY - 0.4, 0]}
          center
          distanceFactor={13}
          style={{ pointerEvents: "none" }}
        >
          <div
            title={area.label}
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: hue.roof,
              border: `1.5px solid ${INK}`,
            }}
          />
        </Html>
      )}

      {showPulse && (
        <Html
          position={[0, labelY + 0.9, 0]}
          center
          distanceFactor={13}
          style={{ pointerEvents: "none" }}
        >
          <div key={pulseTs} className="delivery-pop">
            <span className="delivery-pop__icon" style={{ color: hue.roof }}>
              ↑
            </span>
            <span className="delivery-pop__text" style={{ color: INK }}>
              +KNOWLEDGE
            </span>
          </div>
        </Html>
      )}
    </group>
  );
}

export function DeveloperCity(): ReactNode {
  const { viewMode, areas } = useWorld();
  if (viewMode !== "skills") return null;

  const radius = getRingRadius(areas.length);

  return (
    <group>
      <CityFloor radius={radius} />
      <CityTrees radius={radius} count={areas.length} />
      <CityHub />

      {areas.map((area: Area, i: number) => (
        <Bridge key={`bridge-${area.id}`} area={area} index={i} />
      ))}
      {areas.map((area: Area, i: number) => (
        <Building key={area.id} area={area} index={i} />
      ))}
    </group>
  );
}

export const DeveloperHome = DeveloperCity;
