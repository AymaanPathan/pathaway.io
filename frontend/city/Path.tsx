
import { useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useWorld } from "./WorldContext";
import { buildCurve, getBridgeSpan } from "./cityKit";
import { YELLOW } from "./Theme";

interface PackageMoverProps {
  pkg: {
    id: string;
    startTime: number;
    duration: number;
    areaId: string;
  };
  areaPos: [number, number, number];
  onDelivered: (pkgId: string, areaId: string) => void;
}






export function Paths(): ReactNode {
  return null;
}








function easeInOutQuad(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

function PackageMover({
  pkg,
  areaPos,
  onDelivered,
}: PackageMoverProps): ReactNode {
  
  
  const curve: THREE.QuadraticBezierCurve3 = useMemo(() => {
    const span = getBridgeSpan(areaPos);
    return buildCurve(span.start, span.end);
  }, [areaPos]);
  const groupRef = useRef<THREE.Group>(null);
  const deliveredRef = useRef<boolean>(false);
  const point: THREE.Vector3 = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    if (!groupRef.current) return;
    const now = Date.now();

    if (now < pkg.startTime) {
      groupRef.current.visible = false;
      return;
    }

    const elapsed = now - pkg.startTime;
    const t = Math.min(elapsed / pkg.duration, 1);

    curve.getPoint(easeInOutQuad(t), point);
    groupRef.current.visible = true;
    groupRef.current.position.set(
      point.x,
      point.y + 0.3 + Math.sin(t * Math.PI) * 0.25,
      point.z,
    );
    groupRef.current.rotation.y += 0.05;

    if (t >= 1 && !deliveredRef.current) {
      deliveredRef.current = true;
      onDelivered(pkg.id, pkg.areaId);
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      <mesh castShadow>
        <icosahedronGeometry args={[0.14, 0]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive={YELLOW}
          emissiveIntensity={1.8}
          toneMapped={false}
          roughness={0.25}
          metalness={0.1}
        />
      </mesh>
    </group>
  );
}

export function DeliveryPackages(): ReactNode {
  const { packages, areaMap, deliverPackage } = useWorld();

  return (
    <group>
      {packages.map((pkg: any) => {
        const area = areaMap[pkg.areaId];
        if (!area) return null;
        return (
          <PackageMover
            key={pkg.id}
            pkg={pkg}
            areaPos={area.position}
            onDelivered={deliverPackage}
          />
        );
      })}
    </group>
  );
}
