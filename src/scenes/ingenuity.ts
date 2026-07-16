/**
 * Ingenuity helicopter model for the Flight Deck replay.
 *
 * Loads NASA's public-domain Ingenuity glTF (public/models/ingenuity.glb —
 * NASA/JPL-Caltech, Draco-compressed, decoded with the bundled offline decoder
 * in public/draco/) once and caches it. Each replay mount clones the cached
 * scene, normalizes its scale/pose, and spins the two coaxial rotor assemblies
 * around vertical (counter-rotating) — the GLB carries no animation rig, so the
 * spin + flight motion are ours. If the GLB (or its decoder) can't load, a
 * faithful procedural Ingenuity is built instead, so replay always shows a
 * helicopter and the app stays offline-safe.
 *
 * Verified offline (headless render): the model loads upright — solar panel on
 * top, four splayed legs, two 2-blade coaxial rotors deployed — and the rotor
 * nodes spin correctly about world-Y via rotateOnWorldAxis.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

/** Rotor-span footprint in scene metres (the loaded model is scaled to this). */
const TARGET_SPAN_M = 18;
const UP = new THREE.Vector3(0, 1, 0);
/**
 * Rotor angular speed (rad/s) — a calm, watchable rate, deliberately decoupled
 * from the true ~2400 rpm (which strobes into a blur). ~1.2 rad/s is roughly one
 * revolution every 5 s, so a blade sweeps ~70°/s and stays easy to track. Tune here.
 */
const ROTOR_RAD_PER_SEC = 1.2;

export interface IngenuityInstance {
  /** Root group — the caller sets position (path point) and rotation.y (yaw). */
  group: THREE.Group;
  /** Advance the coaxial rotors one frame at a calm fixed rate (counter-rotating). */
  spin(dt: number): void;
  /** Dispose per-mount resources (procedural fallback only; the cached GLB is left alive). */
  dispose(): void;
  /** true when built procedurally because the GLB was unavailable. */
  procedural: boolean;
}

function base(): string {
  return (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
}

let cache: Promise<THREE.Group | null> | null = null;
let resolved: THREE.Group | null = null;

/** Load the NASA Ingenuity GLB once (cached). Resolves null on any failure. */
export function loadIngenuityModel(): Promise<THREE.Group | null> {
  if (!cache) cache = doLoad();
  return cache;
}

/** Synchronously read the cached root (null until loaded / when unavailable). */
export function getIngenuityModel(): THREE.Group | null {
  return resolved;
}

async function doLoad(): Promise<THREE.Group | null> {
  try {
    const draco = new DRACOLoader();
    draco.setDecoderPath(`${base()}draco/`);
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    const gltf = await loader.loadAsync(`${base()}models/ingenuity.glb`);
    draco.dispose();
    const root = gltf.scene;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
    resolved = root;
    return root;
  } catch {
    return null;
  }
}

/**
 * Prepare a scene-ready Ingenuity from the cached root (or the procedural
 * fallback when `root` is null). Clones the cached scene so each mount is
 * independent; the clone shares geometry/materials with the cache, so the
 * caller must remove the group from the scene BEFORE disposing the deck (a
 * scene-wide dispose would free the shared cached buffers).
 */
export function prepareIngenuity(root: THREE.Group | null): IngenuityInstance {
  if (!root) return buildIngenuityFallback();

  const model = root.clone(true);
  // Normalize: center horizontally on the hub, drop so the legs sit at y=0,
  // and scale the rotor span to a consistent scene footprint.
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const span = Math.max(size.x, size.z) || 1;
  model.position.set(-center.x, -box.min.y, -center.z);

  const inner = new THREE.Group();
  inner.add(model);
  inner.scale.setScalar(TARGET_SPAN_M / span);

  const group = new THREE.Group();
  group.name = 'ingenuity';
  group.add(inner);

  // The two coaxial rotor assemblies (rotors_01 upper, rotors_02 lower).
  const rotors: THREE.Object3D[] = [];
  model.traverse((o) => {
    if (/rotor/i.test(o.name) && o.children.length > 0) rotors.push(o);
  });

  return {
    group,
    procedural: false,
    spin(dt) {
      const step = dt * ROTOR_RAD_PER_SEC;
      rotors.forEach((r, i) => r.rotateOnWorldAxis(UP, i % 2 === 0 ? step : -step));
    },
    dispose() {
      // Nothing to free: geometry/materials belong to the cached GLB and are
      // intentionally kept alive for the next mount. The clone wrappers are GC'd.
    },
  };
}

/**
 * Procedural Ingenuity — gold fuselage, dark solar panel on a mast, four splayed
 * carbon legs, two coaxial counter-rotating 2-blade rotors. Used only when the
 * real GLB can't load, so replay always shows a recognizable helicopter.
 */
export function buildIngenuityFallback(): IngenuityInstance {
  const group = new THREE.Group();
  group.name = 'ingenuity-fallback';
  const own: (THREE.BufferGeometry | THREE.Material)[] = [];
  const track = <T extends THREE.BufferGeometry | THREE.Material>(x: T): T => {
    own.push(x);
    return x;
  };
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => {
    const mm = new THREE.Mesh(track(g), track(m));
    mm.castShadow = true;
    return mm;
  };

  const gold = new THREE.MeshStandardMaterial({ color: 0xbfa15a, metalness: 0.7, roughness: 0.35 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x1c1f26, metalness: 0.2, roughness: 0.6 });
  const leg = new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.7 });

  // fuselage (the avionics box), scaled ~ to TARGET_SPAN_M / typical span ratio
  const bodyH = 5;
  const body = mesh(new THREE.BoxGeometry(4.5, bodyH, 3.6), gold);
  body.position.y = bodyH / 2 + 5;
  group.add(body);

  // mast + solar panel on top
  const mast = mesh(new THREE.CylinderGeometry(0.35, 0.35, 6, 8), leg);
  mast.position.y = bodyH + 8;
  group.add(mast);
  const panel = mesh(new THREE.BoxGeometry(7, 0.3, 4.5), carbon);
  panel.position.y = bodyH + 11;
  group.add(panel);

  // four splayed legs
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const l = mesh(new THREE.CylinderGeometry(0.18, 0.18, 11, 6), leg);
    l.position.set(Math.cos(a) * 4.5, 0, Math.sin(a) * 4.5);
    l.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    group.add(l);
  }

  // two coaxial 2-blade rotors
  const makeRotor = (y: number): THREE.Group => {
    const r = new THREE.Group();
    r.position.y = y;
    const bladeGeo = track(new THREE.BoxGeometry(TARGET_SPAN_M, 0.12, 0.9));
    const bladeMat = track(new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.5 }));
    const b1 = new THREE.Mesh(bladeGeo, bladeMat);
    const b2 = new THREE.Mesh(bladeGeo, bladeMat);
    b2.rotation.y = Math.PI / 2;
    b1.castShadow = b2.castShadow = true;
    const hub = mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.5, 10), leg);
    r.add(b1, b2, hub);
    return r;
  };
  const upper = makeRotor(bodyH + 6.5);
  const lower = makeRotor(bodyH + 5.3);
  group.add(upper, lower);

  return {
    group,
    procedural: true,
    spin(dt) {
      const step = dt * ROTOR_RAD_PER_SEC;
      upper.rotateOnWorldAxis(UP, step);
      lower.rotateOnWorldAxis(UP, -step);
    },
    dispose() {
      for (const o of own) o.dispose();
    },
  };
}
