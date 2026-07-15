/**
 * Flight Deck terrain — real Jezero when baked, procedural stand-in otherwise.
 *
 * `heightAt` is the single source of truth for BOTH the ground mesh and the
 * flight-path reconstruction. When a real Jezero heightfield has been loaded
 * (scripts/bake_dem.py → public/terrain/, wired in by FlightDeck via
 * setHeightfield), heightAt samples the actual USGS Mars 2020 CTX DEM;
 * otherwise it falls back to the original deterministic procedural relief, so
 * the app renders with or without the baked assets.
 *
 * Local frame: meters; x = east, z = south, y = up; origin = MSRH base station
 * (Octavia E. Butler Landing when the real DEM is loaded, ~18.44 N / 77.45 E).
 */
import * as THREE from 'three';
import type { Heightfield } from './heightfield';
import { fbm2, lerp } from './rng';

export const TERRAIN_SEED = 0x4a505a; // "JPZ" — fixed so every session matches
export const TERRAIN_SIZE_M = 2600; // procedural square extent
export const TERRAIN_SEGMENTS = 160;

/** Real DEM relief (~255 m over 10 km) reads flat at 1:1; lift it for legibility. */
export const VERTICAL_EXAGGERATION = 2.0;
/** Higher tessellation for the real DEM so its relief resolves. */
const DEM_SEGMENTS = 256;

// Module-global active heightfield (set once by FlightDeck after the async load).
let field: Heightfield | null = null;
let originH = 0;

/** Install (or clear) the real Jezero heightfield. Idempotent. */
export function setHeightfield(hf: Heightfield | null): void {
  field = hf;
  originH = hf ? hf.sample(0, 0) : 0;
}

/** The active square extent in meters (DEM window when loaded, else procedural). */
export function activeTerrainSizeM(): number {
  return field ? field.sizeM : TERRAIN_SIZE_M;
}

/** Procedural fallback relief (unchanged): gentle so flight AGL dominates. */
function proceduralHeight(x: number, z: number): number {
  const nx = x / 900;
  const nz = z / 900;
  let h = (fbm2(nx + 10, nz + 10, TERRAIN_SEED) - 0.5) * 12;
  const scarp = Math.max(0, -(x + z) / 1400 - 0.25);
  h += Math.min(1, scarp) * 26 * (0.7 + 0.3 * fbm2(nx * 2, nz * 2, TERRAIN_SEED + 7));
  const craters: [number, number, number][] = [
    [520, -380, 130],
    [-640, 540, 170],
    [180, 760, 90],
  ];
  for (const [cx, cz, r] of craters) {
    const d = Math.hypot(x - cx, z - cz) / r;
    if (d < 1.6) {
      const rim = Math.exp(-((d - 1) * (d - 1)) * 8) * 3.2;
      const bowl = d < 1 ? -(1 - d * d) * 4.5 : 0;
      h += rim + bowl;
    }
  }
  const baseDist = Math.hypot(x, z);
  const flatten = Math.min(1, baseDist / 220);
  return h * flatten;
}

/** Terrain height (m) at local (x, z): real Jezero DEM if loaded, else procedural. */
export function heightAt(x: number, z: number): number {
  if (field) return (field.sample(x, z) - originH) * VERTICAL_EXAGGERATION;
  return proceduralHeight(x, z);
}

/** Regolith color ramp by height + noise (procedural fallback surface only). */
function terrainColor(x: number, z: number, h: number): THREE.Color {
  const dust = fbm2(x / 260 + 40, z / 260 + 40, TERRAIN_SEED + 55);
  const t = Math.max(0, Math.min(1, (h + 8) / 34));
  const r = lerp(0.34, 0.62, t) + dust * 0.06;
  const g = lerp(0.2, 0.36, t) + dust * 0.035;
  const b = lerp(0.14, 0.24, t) + dust * 0.02;
  return new THREE.Color(r, g, b);
}

/** Elevation tint for the real DEM when no ortho texture is available. */
function demColor(hNorm: number): THREE.Color {
  // dark rust lows → tan-ochre highs (Mars regolith)
  const r = lerp(0.32, 0.7, hNorm);
  const g = lerp(0.19, 0.5, hNorm);
  const b = lerp(0.13, 0.34, hNorm);
  return new THREE.Color(r, g, b);
}

/**
 * Build the terrain mesh. With the real DEM loaded, a higher-res displaced plane
 * with the draped CTX ortho texture (or an elevation tint if no texture);
 * otherwise the original vertex-colored procedural mesh. Receives shadows.
 */
export function buildTerrainMesh(texture?: THREE.Texture | null): THREE.Mesh {
  const size = activeTerrainSizeM();
  const segments = field ? DEM_SEGMENTS : TERRAIN_SEGMENTS;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2); // plane XY → ground XZ (default UVs: north=top, east=right)
  const pos = geo.attributes.position as THREE.BufferAttribute;

  let mat: THREE.Material;
  if (field && texture) {
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
    }
    mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.97, metalness: 0 });
  } else {
    // vertex-colored (real DEM without texture → elevation tint; else procedural ramp)
    const colors = new Float32Array(pos.count * 3);
    const span = field ? Math.max(1e-6, (field.heightMaxM - field.heightMinM) * VERTICAL_EXAGGERATION) : 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = heightAt(x, z);
      pos.setY(i, h);
      const hn = Math.max(0, Math.min(1, h / span + 0.5));
      const c = field ? demColor(hn) : terrainColor(x, z, h);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    mat = field
      ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
      : new THREE.MeshLambertMaterial({ vertexColors: true });
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  return mesh;
}
