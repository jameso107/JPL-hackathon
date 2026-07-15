/**
 * Procedural Mars-like terrain (Jezero-delta-flavored stand-in).
 *
 * A pure height function shared by the scene mesh and the flight-path builder,
 * plus a mesh builder with vertex-colored regolith shading. Deterministic —
 * same seed, same terrain. Phase-2 close-out swaps in a real HiRISE DEM baked
 * by scripts/bake_dem.py (heightmap PNG + metadata); the height function and
 * mesh builder keep the same interface either way.
 *
 * Local frame: meters; x = east, z = south, y = up; origin = MSRH base station.
 * Anchored notionally at the Jezero delta (~18.44° N, 77.45° E).
 */
import * as THREE from 'three';
import { fbm2, lerp } from './rng';

export const TERRAIN_SEED = 0x4a505a; // "JPZ" — fixed so every session matches
export const TERRAIN_SIZE_M = 2600; // square extent
export const TERRAIN_SEGMENTS = 160;

/** Terrain height (m) at local (x, z). Gentle relief so flight AGL dominates. */
export function heightAt(x: number, z: number): number {
  const nx = x / 900;
  const nz = z / 900;
  // base rolling relief ±6 m
  let h = (fbm2(nx + 10, nz + 10, TERRAIN_SEED) - 0.5) * 12;
  // delta scarp rising to the northwest (negative x, negative z)
  const scarp = Math.max(0, -(x + z) / 1400 - 0.25);
  h += Math.min(1, scarp) * 26 * (0.7 + 0.3 * fbm2(nx * 2, nz * 2, TERRAIN_SEED + 7));
  // a few soft craters (fixed positions, deterministic)
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
  // keep the landing zone around the base station flat-ish
  const baseDist = Math.hypot(x, z);
  const flatten = Math.min(1, baseDist / 220);
  return h * flatten;
}

/** Regolith color ramp by height + noise: dark basalt lows → dusty ochre highs. */
function terrainColor(x: number, z: number, h: number): THREE.Color {
  const dust = fbm2(x / 260 + 40, z / 260 + 40, TERRAIN_SEED + 55);
  const t = Math.max(0, Math.min(1, (h + 8) / 34));
  const r = lerp(0.34, 0.62, t) + dust * 0.06;
  const g = lerp(0.2, 0.36, t) + dust * 0.035;
  const b = lerp(0.14, 0.24, t) + dust * 0.02;
  return new THREE.Color(r, g, b);
}

/** Build the vertex-colored terrain mesh (double-sided off; receives shadows). */
export function buildTerrainMesh(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(
    TERRAIN_SIZE_M,
    TERRAIN_SIZE_M,
    TERRAIN_SEGMENTS,
    TERRAIN_SEGMENTS,
  );
  geo.rotateX(-Math.PI / 2); // plane XY → ground XZ
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const c = terrainColor(x, z, h);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  return mesh;
}
