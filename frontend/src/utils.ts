// Small shared helpers used across the scene.
import * as THREE from "three";

interface MaterialProperties {
  roughness: number;
  metalness: number;
  flatShading: boolean;
}

// Default material for structural surfaces — a clean, soft-matte
// "product render" finish (think Linear/Notion 3D illustrations), not
// the shinier metal/glass look this used to have.
export const materialProps: MaterialProperties = {
  roughness: 0.42,
  metalness: 0.12,
  flatShading: false,
};

// Slightly rougher variant for matte panels (screens, floor trim).
export const matteProps: MaterialProperties = {
  roughness: 0.8,
  metalness: 0.04,
  flatShading: false,
};

// Deterministic PRNG so scattered props don't re-shuffle on every render.
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpVec3(
  out: number[],
  a: number[],
  b: number[],
  t: number,
): number[] {
  out[0] = lerp(a[0], b[0], t);
  out[1] = lerp(a[1], b[1], t);
  out[2] = lerp(a[2], b[2], t);
  return out;
}

export function hexToRgba(hex: string, alpha: number = 1): string {
  const h = hex.replace("#", "");
  const bigint = parseInt(
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h,
    16,
  );
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const textureCache = new Map<string, THREE.CanvasTexture>();

interface GlyphTextureOptions {
  glyph?: string;
  accent?: string;
  bg?: string;
  size?: number;
  fontSize?: number;
}

export function makeGlyphTexture({
  glyph = "</>",
  accent = "#4f6df5",
  bg = "rgba(255, 255, 255, 0.96)",
  size = 128,
  fontSize = 52,
}: GlyphTextureOptions = {}): THREE.CanvasTexture {
  const key = `${glyph}|${accent}|${bg}|${size}|${fontSize}`;
  if (textureCache.has(key)) return textureCache.get(key)!;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2D context from canvas");

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, size - 12, size - 12);
  ctx.fillStyle = accent;
  ctx.font = `600 ${fontSize}px "IBM Plex Mono", "SFMono-Regular", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(glyph, size / 2, size / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  textureCache.set(key, texture);
  return texture;
}
