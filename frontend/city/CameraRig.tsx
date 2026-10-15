import { useEffect, useRef, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useWorld } from "./WorldContext";
import { HUB_POSITION } from "./mockGraph";
import { getBridgeSpan, getBuildingHeight, getRingRadius } from "./cityKit";

const OVERVIEW_DIRECTION = new THREE.Vector3(0.55, 0.8, 1).normalize();
const FLY_DURATION_MS = 850;

function overviewDistance(count: number): number {
  return Math.max(26, getRingRadius(count) * 2.3 + 12);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function CameraRig(): ReactNode {
  const { camera } = useThree();
  const { focusedAreaId, areaMap, areas } = useWorld();

  
  const controlsRef = useRef<any>(null);
  
  
  const lastKeyRef = useRef<string>("__uninitialized__");
  const flying = useRef<boolean>(false);
  const flyStart = useRef<number>(0);
  const flyFromPos = useRef(new THREE.Vector3());
  const flyFromTarget = useRef(new THREE.Vector3());
  const flyToPos = useRef(new THREE.Vector3());
  const flyToTarget = useRef(new THREE.Vector3());

  
  
  
  
  
  const focusKey = focusedAreaId ?? `__overview__:${areas.length}`;

  useEffect(() => {
    if (focusKey === lastKeyRef.current) return;

    const controls = controlsRef.current;
    if (!controls) return;
    lastKeyRef.current = focusKey;

    flyFromPos.current.copy(camera.position);
    flyFromTarget.current.copy(controls.target);

    const area = focusedAreaId ? areaMap[focusedAreaId] : undefined;

    if (area) {
      const [ax, ay, az] = area.position;
      const h = getBuildingHeight(area.skillCount, area.evidenceCount);
      const { ux, uz } = getBridgeSpan(area.position);
      
      const px = -uz;
      const pz = ux;

      
      const back = 5.5 + h * 0.5;
      flyToTarget.current.set(ax, ay + h * 0.5, az);
      flyToPos.current.set(
        ax - ux * back + px * 1.8,
        ay + h * 0.62 + 3.2,
        az - uz * back + pz * 1.8,
      );
    } else {
      const dist = overviewDistance(areas.length);
      flyToPos.current
        .set(...HUB_POSITION)
        .addScaledVector(OVERVIEW_DIRECTION, dist);
      flyToTarget.current.set(
        HUB_POSITION[0],
        HUB_POSITION[1] + 2.2,
        HUB_POSITION[2],
      );
    }

    flyStart.current = performance.now();
    flying.current = true;
  }, [focusKey, focusedAreaId, areaMap, areas.length, camera]);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    if (flying.current) {
      const t = Math.min(
        (performance.now() - flyStart.current) / FLY_DURATION_MS,
        1,
      );
      const eased = easeOutCubic(t);
      camera.position.lerpVectors(flyFromPos.current, flyToPos.current, eased);
      controls.target.lerpVectors(
        flyFromTarget.current,
        flyToTarget.current,
        eased,
      );
      if (t >= 1) flying.current = false;
    }

    controls.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.6}
      panSpeed={0.8}
      zoomSpeed={0.8}
      minDistance={3.5}
      maxDistance={Math.max(70, overviewDistance(areas.length) * 2)}
      maxPolarAngle={Math.PI / 2.02}
      target={[HUB_POSITION[0], HUB_POSITION[1] + 2.2, HUB_POSITION[2]]}
    />
  );
}
