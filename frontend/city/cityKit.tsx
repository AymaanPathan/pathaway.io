/* eslint-disable react-refresh/only-export-components */
import { type ReactNode } from "react";
import * as THREE from "three";
import { HUB_POSITION } from "./mockGraph";
import { INK } from "./Theme";

export const BUILDING_W = 3.0;
export const BUILDING_GAP = 7.5; // clear space between towers (was 2.6)
export const BUILDING_SPACING = BUILDING_W + BUILDING_GAP;

export const MIN_RING_RADIUS = 15;

export const HUB_RADIUS = 3.2;
export const HUB_PODIUM_H = 1.1;

export const BRIDGE_Y = HUB_PODIUM_H + 0.03;
export const BRIDGE_W = 0.95;
export const DECK_THICKNESS = 0.14;

export const LANDING_DEPTH = 0.7;

export const MIN_BUILDING_H = 4.4;

export const MAX_FLOORS = 6;
export const LOBBY_H = BRIDGE_Y + 1.6;
export const FLOOR_H = 1.2;
export const ROOF_PAD = 0.2;

export function getRingRadius(total: number): number {
  if (total <= 1) return MIN_RING_RADIUS;
  return Math.max(MIN_RING_RADIUS, (total * BUILDING_SPACING) / (2 * Math.PI));
}

export function getBuildingAngle(index: number, total: number): number {
  return Math.PI / 4 + (index / Math.max(total, 1)) * Math.PI * 2;
}

export function getBuildingHeight(
  skillCount?: number | null,
  evidenceCount?: number | null,
): number {
  const floors = Math.min(Math.max(skillCount ?? 2, 1), MAX_FLOORS);
  const evidence = Math.min(Math.max(evidenceCount ?? 0, 0), 200) / 200;
  return LOBBY_H + floors * FLOOR_H + ROOF_PAD + evidence * 1.4;
}

export interface BridgeSpan {
  start: [number, number, number];
  end: [number, number, number];
  length: number;
  angleY: number;
  ux: number;
  uz: number;
}

export function getBridgeSpan(
  buildingPos: [number, number, number],
): BridgeSpan {
  const dx = buildingPos[0] - HUB_POSITION[0];
  const dz = buildingPos[2] - HUB_POSITION[2];
  const dist = Math.hypot(dx, dz) || 1;
  const ux = dx / dist;
  const uz = dz / dist;

  const startR = HUB_RADIUS - 0.15;
  const endR = dist - BUILDING_W / 2 - LANDING_DEPTH;
  const y = HUB_POSITION[1] + BRIDGE_Y;

  return {
    start: [HUB_POSITION[0] + ux * startR, y, HUB_POSITION[2] + uz * startR],
    end: [HUB_POSITION[0] + ux * endR, y, HUB_POSITION[2] + uz * endR],
    length: Math.max(0.1, endR - startR),
    angleY: Math.atan2(ux, uz),
    ux,
    uz,
  };
}

export function computeRoomLayout(count: number): [number, number, number][] {
  if (count <= 0) return [];
  const radius = getRingRadius(count);
  const out: [number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const a = getBuildingAngle(i, count);
    out.push([
      HUB_POSITION[0] + Math.cos(a) * radius,
      HUB_POSITION[1],
      HUB_POSITION[2] + Math.sin(a) * radius,
    ]);
  }
  return out;
}

export function buildCurve(
  fromPos: [number, number, number],
  toPos: [number, number, number],
): THREE.QuadraticBezierCurve3 {
  const start = new THREE.Vector3(...fromPos);
  const end = new THREE.Vector3(...toPos);
  const mid = start.clone().lerp(end, 0.5);
  mid.y += 0.15;
  return new THREE.QuadraticBezierCurve3(start, mid, end);
}

let celGradient: THREE.DataTexture | null = null;
function getCelGradient(): THREE.DataTexture {
  if (!celGradient) {
    const data = new Uint8Array([
      120, 120, 120, 255, 190, 190, 190, 255, 238, 238, 238, 255,
    ]);
    const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    celGradient = tex;
  }
  return celGradient;
}

const toonCache = new Map<string, THREE.MeshToonMaterial>();
export function getToonMaterial(
  color: string,
  emissive?: string,
  emissiveIntensity = 0,
): THREE.MeshToonMaterial {
  const key = `${color}|${emissive ?? ""}|${emissiveIntensity}`;
  let m = toonCache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: getCelGradient() });
    if (emissive) {
      m.emissive = new THREE.Color(emissive);
      m.emissiveIntensity = emissiveIntensity;
    }
    toonCache.set(key, m);
  }
  return m;
}

const outlineCache = new Map<string, THREE.MeshBasicMaterial>();
export function getOutlineMaterial(color: string): THREE.MeshBasicMaterial {
  let m = outlineCache.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
    outlineCache.set(color, m);
  }
  return m;
}

const flatCache = new Map<string, THREE.MeshLambertMaterial>();
export function getFlatMaterial(
  color: string,
  emissive?: string,
  emissiveIntensity = 0,
): THREE.MeshLambertMaterial {
  const key = `${color}|${emissive ?? ""}|${emissiveIntensity}`;
  let m = flatCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    if (emissive) {
      m.emissive = new THREE.Color(emissive);
      m.emissiveIntensity = emissiveIntensity;
    }
    flatCache.set(key, m);
  }
  return m;
}

const basicCache = new Map<string, THREE.MeshBasicMaterial>();
export function getBasicMaterial(
  color: string,
  opacity?: number,
): THREE.MeshBasicMaterial {
  const key = `${color}|${opacity ?? 1}`;
  let m = basicCache.get(key);
  if (!m) {
    const translucent = opacity !== undefined && opacity < 1;
    m = new THREE.MeshBasicMaterial({
      color,
      toneMapped: false,
      transparent: translucent,
      opacity: opacity ?? 1,
      depthWrite: !translucent,
    });
    basicCache.set(key, m);
  }
  return m;
}

export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

const geoCache = new Map<string, THREE.BufferGeometry>();
export function cachedCylinder(
  args: [number, number, number, number],
): THREE.CylinderGeometry {
  const key = `cyl:${args.join(",")}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(...args);
    geoCache.set(key, g);
  }
  return g as THREE.CylinderGeometry;
}
export function cachedSphere(
  args: [number, number, number, number, number, number, number],
): THREE.SphereGeometry {
  const key = `sph:${args.join(",")}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.SphereGeometry(...args);
    geoCache.set(key, g);
  }
  return g as THREE.SphereGeometry;
}

export const noRaycast = (): void => undefined;

interface BaseProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  color: string;
  outline?: string;
  thickness?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  emissive?: string;
  emissiveIntensity?: number;
}

export function OutlinedBox({
  args,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  color,
  outline = INK,
  thickness = 1.06,
  castShadow = true,
  receiveShadow = true,
  emissive,
  emissiveIntensity = 0,
}: BaseProps & { args: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh
        geometry={UNIT_BOX}
        material={getToonMaterial(color, emissive, emissiveIntensity)}
        scale={args}
        castShadow={castShadow}
        receiveShadow={receiveShadow}
      />
      <mesh
        geometry={UNIT_BOX}
        material={getOutlineMaterial(outline)}
        scale={[args[0] * thickness, args[1] * thickness, args[2] * thickness]}
      />
    </group>
  );
}

export function OutlinedCylinder({
  args,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  color,
  outline = INK,
  thickness = 1.06,
  castShadow = true,
  receiveShadow = true,
}: BaseProps & { args: [number, number, number, number] }) {
  const geo = cachedCylinder(args);
  return (
    <group position={position} rotation={rotation}>
      <mesh
        geometry={geo}
        material={getToonMaterial(color)}
        castShadow={castShadow}
        receiveShadow={receiveShadow}
      />
      <mesh
        geometry={geo}
        material={getOutlineMaterial(outline)}
        scale={[thickness, thickness, thickness]}
      />
    </group>
  );
}

export function OutlinedSphere({
  args,
  position = [0, 0, 0],
  color,
  outline = INK,
  thickness = 1.06,
  castShadow = true,
  receiveShadow = true,
}: BaseProps & {
  args: [number, number, number, number, number, number, number];
}) {
  const geo = cachedSphere(args);
  return (
    <group position={position}>
      <mesh
        geometry={geo}
        material={getToonMaterial(color)}
        castShadow={castShadow}
        receiveShadow={receiveShadow}
      />
      <mesh
        geometry={geo}
        material={getOutlineMaterial(outline)}
        scale={[thickness, thickness, thickness]}
      />
    </group>
  );
}

export type RoomArchetype =
  | "frontend"
  | "backend"
  | "devops"
  | "data"
  | "design"
  | "mobile"
  | "ai"
  | "generic";

interface ArchetypeRule {
  archetype: RoomArchetype;
  keywords: string[];
}

const ARCHETYPE_RULES: ArchetypeRule[] = [
  {
    archetype: "ai",
    keywords: ["ai", "ml", "machine learning", "llm", "nlp", "model"],
  },
  {
    archetype: "devops",
    keywords: [
      "devops",
      "infra",
      "infrastructure",
      "ci/cd",
      "ci ",
      "cd ",
      "docker",
      "kubernetes",
      "k8s",
      "deploy",
      "cloud",
      "aws",
      "gcp",
      "azure",
    ],
  },
  {
    archetype: "data",
    keywords: [
      "data",
      "database",
      "sql",
      "postgres",
      "mongo",
      "redis",
      "warehouse",
      "etl",
      "pipeline",
    ],
  },
  {
    archetype: "mobile",
    keywords: ["mobile", "ios", "android", "flutter", "react native"],
  },
  {
    archetype: "design",
    keywords: ["design", "ux", "ui/ux", "figma"],
  },
  {
    archetype: "backend",
    keywords: ["backend", "back-end", "server", "api", "node", "service"],
  },
  {
    archetype: "frontend",
    keywords: ["frontend", "front-end", "client", "react", "css", "web ui"],
  },
];

export function getRoomArchetype(categoryLabel: string): RoomArchetype {
  const normalized = ` ${categoryLabel.trim().toLowerCase()} `;
  if (normalized.trim().length === 0) return "generic";

  for (const rule of ARCHETYPE_RULES) {
    if (rule.keywords.some((kw) => normalized.includes(kw))) {
      return rule.archetype;
    }
  }

  return "generic";
}

export type SkillPropShape = "orbit" | "cylinder" | "crate" | "generic";

interface SkillRule {
  shape: SkillPropShape;
  keywords: string[];
}

const SKILL_RULES: SkillRule[] = [
  {
    shape: "orbit",
    keywords: [
      "react",
      "vue",
      "angular",
      "svelte",
      "next.js",
      "nextjs",
      "graphql",
    ],
  },
  {
    shape: "cylinder",
    keywords: [
      "sql",
      "postgres",
      "mysql",
      "mongo",
      "redis",
      "database",
      "dynamo",
      "sqlite",
    ],
  },
  {
    shape: "crate",
    keywords: [
      "docker",
      "kubernetes",
      "k8s",
      "aws",
      "gcp",
      "azure",
      "ci/cd",
      "jenkins",
      "terraform",
    ],
  },
];

export function getSkillPropShape(skillName: string): SkillPropShape {
  const normalized = ` ${skillName.trim().toLowerCase()} `;
  if (normalized.trim().length === 0) return "generic";

  for (const rule of SKILL_RULES) {
    if (rule.keywords.some((kw) => normalized.includes(kw))) {
      return rule.shape;
    }
  }

  return "generic";
}

interface DressingProps {
  accent: string;
}

function ServerRack({ accent }: DressingProps): ReactNode {
  return (
    <group>
      <OutlinedBox
        args={[0.34, 0.86, 0.3]}
        position={[0, 0.43, 0]}
        color="#ffffff"
        thickness={1.03}
      />
      {[0.16, 0.34, 0.52, 0.7].map((y, i) => (
        <mesh key={i} position={[0, y, 0.155]}>
          <boxGeometry args={[0.05, 0.035, 0.01]} />
          <meshStandardMaterial
            color={accent}
            emissive={accent}
            emissiveIntensity={0.7}
          />
        </mesh>
      ))}
    </group>
  );
}

function ShippingCrateStack({ accent }: DressingProps): ReactNode {
  return (
    <group>
      <OutlinedBox
        args={[0.4, 0.32, 0.4]}
        position={[0, 0.16, 0]}
        color={accent}
        thickness={1.03}
      />
      <OutlinedBox
        args={[0.28, 0.26, 0.28]}
        position={[0.07, 0.48, 0.03]}
        color="#ffffff"
        thickness={1.03}
      />

      <mesh position={[0, 0.02, 0.28]}>
        <boxGeometry args={[0.5, 0.03, 0.1]} />
        <meshStandardMaterial color={INK} roughness={0.6} />
      </mesh>
    </group>
  );
}

function DataCylinderStack({ accent }: DressingProps): ReactNode {
  return (
    <group>
      <OutlinedCylinder
        args={[0.22, 0.22, 0.13, 16]}
        position={[0, 0.085, 0]}
        color="#ffffff"
        thickness={1.03}
      />
      <OutlinedCylinder
        args={[0.19, 0.19, 0.13, 16]}
        position={[0, 0.225, 0]}
        color={accent}
        thickness={1.03}
      />
      <OutlinedCylinder
        args={[0.16, 0.16, 0.13, 16]}
        position={[0, 0.365, 0]}
        color="#ffffff"
        thickness={1.03}
      />
    </group>
  );
}

function EaselCanvas({ accent }: DressingProps): ReactNode {
  return (
    <group>
      <OutlinedBox
        args={[0.035, 0.5, 0.035]}
        position={[-0.15, 0.25, 0]}
        rotation={[0, 0, 0.22]}
        color={INK}
        thickness={1.02}
      />
      <OutlinedBox
        args={[0.035, 0.5, 0.035]}
        position={[0.15, 0.25, 0]}
        rotation={[0, 0, -0.22]}
        color={INK}
        thickness={1.02}
      />
      <OutlinedBox
        args={[0.34, 0.26, 0.02]}
        position={[0, 0.42, 0.02]}
        color={accent}
        thickness={1.02}
      />
    </group>
  );
}

function PhoneStand({ accent }: DressingProps): ReactNode {
  return (
    <group>
      <OutlinedBox
        args={[0.22, 0.44, 0.03]}
        position={[0, 0.26, 0]}
        color="#ffffff"
        outline={INK}
        thickness={1.05}
      />
      <OutlinedBox
        args={[0.18, 0.36, 0.01]}
        position={[0, 0.26, 0.02]}
        color={accent}
        thickness={1.0}
        emissive={accent}
        emissiveIntensity={0.5}
        castShadow={false}
        receiveShadow={false}
      />
    </group>
  );
}

function NodeCluster({ accent }: DressingProps): ReactNode {
  const nodes: [number, number, number][] = [
    [0, 0.3, 0],
    [0.16, 0.16, 0.08],
    [-0.15, 0.14, -0.07],
    [0.02, 0.12, -0.16],
  ];
  return (
    <group>
      {nodes.map((pos, i) => (
        <OutlinedSphere
          key={i}
          args={[0.08, 14, 12, 0, Math.PI * 2, 0, Math.PI]}
          position={pos}
          color={i === 0 ? accent : "#ffffff"}
        />
      ))}
    </group>
  );
}

export function CategorySetDressing({
  archetype,
  position = [0, 0, 0],
  rotationY = 0,
  accent,
}: {
  archetype: RoomArchetype;
  position?: [number, number, number];
  rotationY?: number;
  accent: string;
}): ReactNode {
  let body: ReactNode;

  switch (archetype) {
    case "backend":
      body = <ServerRack accent={accent} />;
      break;
    case "devops":
      body = <ShippingCrateStack accent={accent} />;
      break;
    case "data":
      body = <DataCylinderStack accent={accent} />;
      break;
    case "design":
      body = <EaselCanvas accent={accent} />;
      break;
    case "mobile":
      body = <PhoneStand accent={accent} />;
      break;
    case "ai":
      body = <NodeCluster accent={accent} />;
      break;
    case "frontend":
    case "generic":
    default:
      return null;
  }

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {body}
    </group>
  );
}

const DEPTH_SCALE: Record<string, number> = {
  insufficient_evidence: 0.65,
  surface: 0.8,
  usage: 0.95,
  repeated_usage: 1.1,
  implementation: 1.3,
  strong: 1.5,
  novice: 0.7,
  familiar: 0.85,
  proficient: 1.0,
  advanced: 1.3,
  expert: 1.5,
};

function depthScale(depth?: string): number {
  return DEPTH_SCALE[depth ?? ""] ?? 0.8;
}

function OrbitProp({
  accent,
  scale,
}: {
  accent: string;
  scale: number;
}): ReactNode {
  const r = 0.12 * scale;
  return (
    <group position={[0, r + 0.02, 0]} rotation={[Math.PI / 2.6, 0, 0]}>
      <mesh castShadow>
        <torusGeometry args={[r, 0.014, 8, 24]} />
        <meshStandardMaterial
          color={accent}
          emissive={accent}
          emissiveIntensity={0.4}
          roughness={0.3}
        />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 3]} castShadow>
        <torusGeometry args={[r, 0.014, 8, 24]} />
        <meshStandardMaterial
          color={accent}
          emissive={accent}
          emissiveIntensity={0.4}
          roughness={0.3}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.045 * scale, 12, 10]} />
        <meshStandardMaterial color="#ffffff" roughness={0.4} />
      </mesh>
    </group>
  );
}

function CylinderProp({
  accent,
  scale,
}: {
  accent: string;
  scale: number;
}): ReactNode {
  const h = 0.16 * scale;
  return (
    <group>
      <OutlinedCylinder
        args={[0.075 * scale, 0.075 * scale, h, 14]}
        position={[0, h / 2, 0]}
        color="#ffffff"
        thickness={1.05}
      />
      <OutlinedCylinder
        args={[0.06 * scale, 0.06 * scale, 0.03, 14]}
        position={[0, h + 0.015, 0]}
        color={accent}
        thickness={1.05}
      />
    </group>
  );
}

function CrateProp({
  accent,
  scale,
}: {
  accent: string;
  scale: number;
}): ReactNode {
  const s = 0.16 * scale;
  return (
    <OutlinedBox
      args={[s, s, s]}
      position={[0, s / 2, 0]}
      color={accent}
      thickness={1.05}
    />
  );
}

function GenericProp({
  accent,
  scale,
}: {
  accent: string;
  scale: number;
}): ReactNode {
  const h = 0.16 * scale + 0.06;
  return (
    <group>
      <OutlinedCylinder
        args={[0.045, 0.06, h, 8]}
        position={[0, h / 2, 0]}
        color="#ffffff"
        thickness={1.06}
      />
      <mesh position={[0, h + 0.05, 0]} castShadow>
        <sphereGeometry args={[0.05 * scale, 12, 10]} />
        <meshStandardMaterial
          color={accent}
          emissive={accent}
          emissiveIntensity={0.5}
          roughness={0.3}
        />
      </mesh>
    </group>
  );
}

export function SkillProp({
  position,
  accent,
  depth,
  name,
}: {
  position: [number, number, number];
  accent: string;
  depth?: string;
  name: string;
}): ReactNode {
  const scale = depthScale(depth);
  const shape = getSkillPropShape(name);

  let body: ReactNode;
  switch (shape) {
    case "orbit":
      body = <OrbitProp accent={accent} scale={scale} />;
      break;
    case "cylinder":
      body = <CylinderProp accent={accent} scale={scale} />;
      break;
    case "crate":
      body = <CrateProp accent={accent} scale={scale} />;
      break;
    default:
      body = <GenericProp accent={accent} scale={scale} />;
  }

  return <group position={position}>{body}</group>;
}
