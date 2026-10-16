/* eslint-disable react-hooks/purity */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { materialProps, matteProps, mulberry32 } from "../src/utils";
import { useWorld } from "./WorldContext";
import {
  INK,
  PAPER,
  PAPER_LIGHT,
  LINE,
  YELLOW,
  SKY,
  SKY_FOG,
  GRASS,
  GRASS_DARK,
} from "./Theme";
import type { Vec3 } from "../src/types";

export function LabAtmosphere() {
  return (
    <>
      <color attach="background" args={[PAPER]} />
      <fog attach="fog" args={[PAPER, 46, 130]} />
      <hemisphereLight args={["#ffffff", "#c9c2ae", 0.6]} />
      <ambientLight intensity={0.42} />
      <directionalLight
        position={[18, 32, 16]}
        intensity={1.55}
        color="#fff6e8"
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-camera-left={-45}
        shadow-camera-right={45}
        shadow-camera-top={45}
        shadow-camera-bottom={-45}
        shadow-camera-near={1}
        shadow-camera-far={120}
        shadow-bias={-0.0012}
      />
      <directionalLight
        position={[-20, 18, -18]}
        intensity={0.28}
        color="#e7dfc9"
      />
      <pointLight
        position={[0, 5, 0]}
        color={YELLOW}
        intensity={0.22}
        distance={26}
      />
    </>
  );
}

export function LabFloor() {
  const gridTexture = useMemo(() => {
    const size = 1024;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = "rgba(16, 18, 16, 0.055)";
    ctx.lineWidth = 1;
    const step = 32;
    for (let x = 0; x <= size; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    for (let y = 0; y <= size; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(16, 18, 16, 0.1)";
    ctx.lineWidth = 1.4;
    for (let x = 0; x <= size; x += step * 4) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    for (let y = 0; y <= size; y += step * 4) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(16, 18, 16, 0.2)";
    for (let x = 0; x <= size; x += step * 4) {
      for (let y = 0; y <= size; y += step * 4) {
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(14, 14);
    tex.anisotropy = 16;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }, []);

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -0.02, 0]}
      receiveShadow
    >
      <circleGeometry args={[70, 72]} />
      <meshStandardMaterial
        map={gridTexture}
        color={PAPER}
        roughness={0.88}
        metalness={0}
      />
    </mesh>
  );
}

export function LabPerimeter() {
  return null;
}

export function HomeAtmosphere() {
  return (
    <>
      <color attach="background" args={[SKY]} />
      <fog attach="fog" args={[SKY_FOG, 70, 190]} />
      <hemisphereLight args={["#fff6e0", GRASS_DARK, 0.55]} />
      <ambientLight intensity={0.38} />
      <directionalLight
        position={[16, 30, 14]}
        intensity={1.0}
        color="#fff3d0"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-camera-near={1}
        shadow-camera-far={140}
        shadow-bias={-0.0012}
        shadow-normalBias={0.04}
      />
      <directionalLight
        position={[-18, 16, -16]}
        intensity={0.18}
        color="#ffe9b0"
      />
    </>
  );
}

export function HomeGround() {
  const texture = useMemo(() => {
    const size = 1024;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = GRASS;
    ctx.fillRect(0, 0, size, size);

    const rand = mulberry32(7);
    ctx.fillStyle = GRASS_DARK;
    for (let i = 0; i < 900; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 2 + rand() * 4;
      ctx.globalAlpha = 0.22 + rand() * 0.1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(18, 18);
    tex.anisotropy = 4;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }, []);

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -0.02, 0]}
      receiveShadow
    >
      <circleGeometry args={[110, 64]} />
      <meshStandardMaterial map={texture} color={GRASS} roughness={0.95} />
    </mesh>
  );
}

interface SoftShadowProps {
  position?: Vec3;
  radius?: number;
  opacity?: number;
}

export function SoftShadow({
  position = [0, 0, 0],
  radius = 2.2,
  opacity = 0.14,
}: SoftShadowProps) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[position[0], 0.005, position[2]]}
    >
      <circleGeometry args={[radius, 32]} />
      <meshBasicMaterial
        color={INK}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </mesh>
  );
}

interface HoloDiscProps {
  position?: Vec3;
  radius?: number;
  color?: string;
}

export function HoloDisc({
  position = [0, 0, 0],
  radius = 1.6,
  color = YELLOW,
}: HoloDiscProps) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      const mat = ref.current.material as THREE.MeshStandardMaterial;
      mat.opacity = 0.16 + Math.sin(clock.elapsedTime * 1.1) * 0.04;
    }
  });
  return (
    <group>
      <SoftShadow position={position} radius={radius * 1.15} opacity={0.06} />
      <mesh
        ref={ref}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[position[0], 0.012, position[2]]}
      >
        <ringGeometry args={[radius * 0.55, radius, 48]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.22}
          transparent
          opacity={0.18}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

interface DataPillarProps {
  position?: Vec3;
  scale?: number;
  hue?: string;
}

export function DataPillar({
  position = [0, 0, 0],
  scale = 1,
  hue = YELLOW,
}: DataPillarProps) {
  const ringRef = useRef<THREE.Group>(null);
  const spin = useRef<number>(Math.random() * Math.PI * 2);
  useFrame(({ clock }) => {
    if (ringRef.current) {
      ringRef.current.rotation.y = clock.elapsedTime * 0.5 + spin.current;
    }
  });
  return (
    <group position={position} scale={scale}>
      <SoftShadow position={[0, 0, 0]} radius={0.5} opacity={0.08} />
      <mesh castShadow position={[0, 0.55, 0]}>
        <cylinderGeometry args={[0.045, 0.06, 1.1, 8]} />
        <meshStandardMaterial color={PAPER_LIGHT} {...materialProps} />
      </mesh>
      <group ref={ringRef} position={[0, 1.15, 0]}>
        <mesh>
          <torusGeometry args={[0.3, 0.018, 8, 24]} />
          <meshStandardMaterial
            color={hue}
            emissive={hue}
            emissiveIntensity={0.55}
            {...materialProps}
          />
        </mesh>
      </group>
      <mesh position={[0, 1.15, 0]}>
        <sphereGeometry args={[0.07, 10, 10]} />
        <meshStandardMaterial
          color={hue}
          emissive={hue}
          emissiveIntensity={0.9}
          {...materialProps}
        />
      </mesh>
    </group>
  );
}

interface TechCrateProps {
  position?: Vec3;
  scale?: number;
  rotationY?: number;
}

export function TechCrate({
  position = [0, 0, 0],
  scale = 1,
  rotationY = 0,
}: TechCrateProps) {
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={scale}>
      <SoftShadow position={[0, 0, 0]} radius={0.4} opacity={0.08} />
      <mesh castShadow receiveShadow position={[0, 0.24, 0]}>
        <boxGeometry args={[0.5, 0.48, 0.42]} />
        <meshStandardMaterial
          color={PAPER_LIGHT}
          roughness={0.6}
          metalness={0.03}
        />
      </mesh>
      {[0.1, 0.3].map((y, i) => (
        <mesh key={i} position={[0.26, y, 0]}>
          <boxGeometry args={[0.02, 0.03, 0.3]} />
          <meshStandardMaterial
            color={YELLOW}
            emissive={YELLOW}
            emissiveIntensity={0.5}
          />
        </mesh>
      ))}
    </group>
  );
}

interface ConsoleBenchProps {
  position?: Vec3;
  rotationY?: number;
}

export function ConsoleBench({
  position = [0, 0, 0],
  rotationY = 0,
}: ConsoleBenchProps) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <SoftShadow position={[0, 0, 0]} radius={0.75} opacity={0.08} />
      <mesh castShadow position={[0, 0.3, 0]}>
        <boxGeometry args={[1.1, 0.08, 0.4]} />
        <meshStandardMaterial
          color={PAPER_LIGHT}
          roughness={0.65}
          metalness={0.02}
        />
      </mesh>
      <mesh castShadow position={[0, 0.52, -0.16]} rotation={[-0.25, 0, 0]}>
        <boxGeometry args={[1.1, 0.32, 0.04]} />
        <meshStandardMaterial
          color={INK}
          emissive={YELLOW}
          emissiveIntensity={0.06}
          {...matteProps}
        />
      </mesh>
      {[-0.45, 0.45].map((x) => (
        <mesh key={x} castShadow position={[x, 0.15, 0]}>
          <boxGeometry args={[0.06, 0.3, 0.36]} />
          <meshStandardMaterial
            color={LINE}
            roughness={0.65}
            metalness={0.02}
          />
        </mesh>
      ))}
    </group>
  );
}

interface LabBeaconProps {
  position?: Vec3;
  hue?: string;
}

export function LabBeacon({
  position = [0, 0, 0],
  hue = YELLOW,
}: LabBeaconProps) {
  const glowRef = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    if (glowRef.current) {
      glowRef.current.intensity =
        0.22 + Math.sin(clock.elapsedTime * 1.6) * 0.04;
    }
  });
  return (
    <group position={position}>
      <SoftShadow position={[0, 0, 0]} radius={0.3} opacity={0.07} />
      <mesh castShadow position={[0, 0.9, 0]}>
        <cylinderGeometry args={[0.03, 0.04, 1.8, 8]} />
        <meshStandardMaterial
          color={PAPER_LIGHT}
          roughness={0.6}
          metalness={0.03}
        />
      </mesh>
      <mesh castShadow position={[0, 1.82, 0]}>
        <sphereGeometry args={[0.1, 10, 10]} />
        <meshStandardMaterial
          color={hue}
          emissive={hue}
          emissiveIntensity={0.5}
          {...materialProps}
        />
      </mesh>
      <pointLight
        ref={glowRef}
        position={[0, 1.82, 0]}
        color={hue}
        intensity={0.22}
        distance={4.5}
      />
    </group>
  );
}

interface StatusBannerProps {
  position?: Vec3;
  color?: string;
}

export function StatusBanner({
  position = [0, 0, 0],
  color = YELLOW,
}: StatusBannerProps) {
  const stripRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (stripRef.current) {
      const mat = stripRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.28 + Math.sin(clock.elapsedTime * 2.2) * 0.12;
    }
  });
  return (
    <group position={position}>
      <SoftShadow position={[0, 0, 0]} radius={0.3} opacity={0.06} />
      <mesh castShadow position={[0, 0.9, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 1.8, 6]} />
        <meshStandardMaterial
          color={PAPER_LIGHT}
          roughness={0.6}
          metalness={0.03}
        />
      </mesh>
      <mesh ref={stripRef} castShadow position={[0, 1.4, 0]}>
        <boxGeometry args={[0.045, 0.9, 0.045]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.28}
        />
      </mesh>
    </group>
  );
}

interface FloorDetailingProps {
  count?: number;
  seed?: number;
}

interface FloorDetailItem {
  x: number;
  z: number;
  scale: number;
  hue: string;
}

export function FloorDetailing({
  count = 0,
  seed = 4242,
}: FloorDetailingProps) {
  const { areas } = useWorld();

  const items = useMemo<FloorDetailItem[]>(() => {
    if (count <= 0) return [];
    const rand = mulberry32(seed);
    const areaCenters: [number, number, number][] = areas.map(
      (a: { position: [number, number, number] }) => a.position,
    );
    const out: FloorDetailItem[] = [];
    let tries = 0;
    while (out.length < count && tries < count * 8) {
      tries++;
      const angle = rand() * Math.PI * 2;
      const dist = 14 + rand() * 28;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const tooClose =
        dist < 8 ||
        areaCenters.some(([ax, , az]) => Math.hypot(x - ax, z - az) < 9);
      if (tooClose) continue;
      out.push({
        x,
        z,
        scale: 0.5 + rand() * 0.35,

        hue: rand() > 0.5 ? YELLOW : INK,
      });
    }
    return out;
  }, [count, seed, areas]);

  return (
    <group>
      {items.map((it, i) => (
        <DataPillar
          key={i}
          position={[it.x, 0, it.z]}
          scale={it.scale}
          hue={it.hue}
        />
      ))}
    </group>
  );
}

interface PodRingProps {
  center?: Vec3;
  innerRadius?: number;
  outerRadius?: number;
  seed?: number;
  hue?: string;
  count?: number;
}

interface PodRingItem {
  position: Vec3;
  scale: number;
}

export function PodRing({
  center = [0, 0, 0],
  innerRadius = 5.5,
  outerRadius = 7,
  seed = 1,
  hue = YELLOW,
  count = 3,
}: PodRingProps) {
  const items = useMemo<PodRingItem[]>(() => {
    const rand = mulberry32(seed * 9973 + 17);
    const out: PodRingItem[] = [];
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = innerRadius + rand() * (outerRadius - innerRadius);
      const x = center[0] + Math.cos(angle) * dist;
      const z = center[2] + Math.sin(angle) * dist;
      out.push({
        position: [x, 0, z],
        scale: 0.85 + rand() * 0.35,
      });
    }
    return out;
  }, [center[0], center[2], innerRadius, outerRadius, seed, count]);

  return (
    <group>
      {items.map((it, i) => (
        <DataPillar key={i} position={it.position} scale={it.scale} hue={hue} />
      ))}
    </group>
  );
}
