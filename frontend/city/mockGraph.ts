import type { Vec3 } from "../src/types";

export const HUB_POSITION: Vec3 = [0, 0, 0];

const BASE_RADIUS = 11;





export function computeAreaPositions(count: number): Vec3[] {
  if (count <= 0) return [];
  const radius = Math.max(BASE_RADIUS, 6 + count * 2.2);
  const angleStep = (Math.PI * 2) / count;
  return Array.from(
    { length: count },
    (_, i): Vec3 => [
      Math.cos(angleStep * i) * radius,
      0,
      Math.sin(angleStep * i) * radius,
    ],
  );
}
