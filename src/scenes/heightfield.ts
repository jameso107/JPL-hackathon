/**
 * Real Jezero terrain loader for the Flight Deck.
 *
 * Fetches the baked assets in public/terrain/ (heightmap.png + meta.json,
 * produced offline by scripts/bake_dem.py from the public-domain USGS Mars 2020
 * CTX DEM) and returns a bilinear elevation sampler + the draped CTX texture.
 * Everything here is browser-only and best-effort: if the assets are absent or
 * fail to load, the caller falls back to the procedural heightfield, so the app
 * stays offline-safe. The pure math (buildHeightfield/sampler) is unit-tested.
 */
import * as THREE from 'three';

export interface Landmark {
  name: string;
  x: number;
  z: number;
}

export interface Heightfield {
  sizeM: number;
  heightMinM: number;
  heightMaxM: number;
  landmarks: Landmark[];
  credit: string;
  /** absolute elevation (m) at local (x=east, z=south); origin = terrain centre */
  sample(x: number, z: number): number;
}

export interface TerrainMeta {
  sizeM: number;
  heightMinM: number;
  heightMaxM: number;
  hasTexture?: boolean;
  credit?: string;
  landmarks?: Landmark[];
}

/**
 * Pure sampler builder — no DOM. `heights` is a row-major n×n grid of absolute
 * metres, row 0 = north edge, col 0 = west edge (matching the bake). Bilinear,
 * clamped at the edges. Kept separate from the loader so it's testable.
 */
export function buildHeightfield(heights: Float32Array, n: number, meta: TerrainMeta): Heightfield {
  const size = meta.sizeM;
  const sample = (x: number, z: number): number => {
    const fx = Math.max(0, Math.min(n - 1, (x / size + 0.5) * (n - 1)));
    const fz = Math.max(0, Math.min(n - 1, (z / size + 0.5) * (n - 1)));
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const x1 = Math.min(n - 1, x0 + 1);
    const z1 = Math.min(n - 1, z0 + 1);
    const tx = fx - x0;
    const tz = fz - z0;
    const h00 = heights[z0 * n + x0];
    const h01 = heights[z0 * n + x1];
    const h10 = heights[z1 * n + x0];
    const h11 = heights[z1 * n + x1];
    return (h00 * (1 - tx) + h01 * tx) * (1 - tz) + (h10 * (1 - tx) + h11 * tx) * tz;
  };
  return {
    sizeM: size,
    heightMinM: meta.heightMinM,
    heightMaxM: meta.heightMaxM,
    landmarks: meta.landmarks ?? [],
    credit: meta.credit ?? '',
    sample,
  };
}

/** Decode the R+G-packed 16-bit heightmap RGBA buffer into absolute metres. */
export function decodeHeights(rgba: Uint8ClampedArray | Uint8Array, n: number, meta: TerrainMeta): Float32Array {
  const span = meta.heightMaxM - meta.heightMinM;
  const out = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const u16 = rgba[i * 4] * 256 + rgba[i * 4 + 1];
    out[i] = meta.heightMinM + (u16 / 65535) * span;
  }
  return out;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

export interface LoadedTerrain {
  heightfield: Heightfield;
  texture: THREE.Texture | null;
}

let cache: Promise<LoadedTerrain | null> | null = null;
let resolved: LoadedTerrain | null = null;

/** Load the baked Jezero terrain once (cached). Resolves null when unavailable. */
export function loadJezeroTerrain(): Promise<LoadedTerrain | null> {
  if (!cache) cache = doLoad();
  return cache;
}

/** Synchronously read the resolved terrain (null until loaded / when unavailable). */
export function getLoadedTerrain(): LoadedTerrain | null {
  return resolved;
}

async function doLoad(): Promise<LoadedTerrain | null> {
  try {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
    const metaRes = await fetch(`${base}terrain/meta.json`);
    if (!metaRes.ok) return null;
    const meta = (await metaRes.json()) as TerrainMeta;

    const img = await loadImage(`${base}terrain/heightmap.png`);
    const n = img.width;
    const canvas = document.createElement('canvas');
    canvas.width = n;
    canvas.height = n;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const rgba = ctx.getImageData(0, 0, n, n).data;
    const heights = decodeHeights(rgba, n, meta);
    const heightfield = buildHeightfield(heights, n, meta);

    let texture: THREE.Texture | null = null;
    if (meta.hasTexture) {
      texture = await new Promise<THREE.Texture | null>((resolve) => {
        new THREE.TextureLoader().load(
          `${base}terrain/texture.png`,
          (t) => {
            t.colorSpace = THREE.SRGBColorSpace;
            t.anisotropy = 8;
            resolve(t);
          },
          undefined,
          () => resolve(null),
        );
      });
    }
    resolved = { heightfield, texture };
    return resolved;
  } catch {
    return null;
  }
}
