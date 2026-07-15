/**
 * Shared three.js scaffolding for the Flight Deck scenes: renderer, camera,
 * orbit controls, martian lighting, terrain mesh, base-station marker,
 * resize handling, render loop, and disposal.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildTerrainMesh } from './terrain';

export interface DeckScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  /** register a per-frame callback (dt seconds); returns an unregister fn */
  onFrame: (cb: (dt: number) => void) => () => void;
  dispose: () => void;
}

export function createDeckScene(container: HTMLElement): DeckScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0d16);
  scene.fog = new THREE.Fog(0x0a0d16, 1800, 4200);

  const camera = new THREE.PerspectiveCamera(
    52,
    container.clientWidth / Math.max(1, container.clientHeight),
    1,
    12000,
  );
  camera.position.set(620, 460, 760);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49; // stay above the ground plane
  controls.minDistance = 60;
  controls.maxDistance = 3600;

  // martian light: warm low sun + dusty ambient
  const sun = new THREE.DirectionalLight(0xffd9b0, 2.0);
  sun.position.set(-900, 700, 500);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xc7906a, 0x2a1d16, 0.85));

  scene.add(buildTerrainMesh());

  // base station marker
  const base = new THREE.Group();
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(16, 16, 1.2, 24),
    new THREE.MeshLambertMaterial({ color: 0x8892a6 }),
  );
  pad.position.y = 0.6;
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 0.8, 22, 8),
    new THREE.MeshLambertMaterial({ color: 0xb9c2d4 }),
  );
  mast.position.y = 11;
  base.add(pad, mast);
  base.name = 'base-station';
  scene.add(base);

  const frameCbs = new Set<(dt: number) => void>();
  let last = performance.now();
  let raf = 0;
  let disposed = false;

  const loop = () => {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (const cb of frameCbs) cb(dt);
    controls.update();
    renderer.render(scene, camera);
  };
  loop();

  const resize = () => {
    const w = container.clientWidth;
    const h = Math.max(1, container.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  return {
    scene,
    camera,
    renderer,
    controls,
    onFrame: (cb) => {
      frameCbs.add(cb);
      return () => frameCbs.delete(cb);
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/**
 * Vertex-colored tube for a reconstructed flight path. Color per tubular ring
 * from the supplied per-sample RGB array. Returns the mesh; caller owns it.
 */
export function buildPathTube(
  points: { x: number; y: number; z: number }[],
  colors: [number, number, number][],
  radius: number,
): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p.x, p.y + 1.5, p.z)),
  );
  const tubularSegments = 140;
  const radialSegments = 6;
  const geo = new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false);
  const count = geo.attributes.position.count;
  const colorAttr = new Float32Array(count * 3);
  const ringSize = radialSegments + 1;
  for (let i = 0; i < count; i++) {
    const ring = Math.min(tubularSegments, Math.floor(i / ringSize));
    const t = ring / tubularSegments;
    const c = colors[Math.min(colors.length - 1, Math.round(t * (colors.length - 1)))];
    colorAttr[i * 3] = c[0];
    colorAttr[i * 3 + 1] = c[1];
    colorAttr[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colorAttr, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  return new THREE.Mesh(geo, mat);
}

/** Simple helicopter marker: body + spinning rotor disc. */
export function buildHelicopterMarker(): { group: THREE.Group; rotor: THREE.Mesh } {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(6, 4, 6),
    new THREE.MeshLambertMaterial({ color: 0xd8dee9 }),
  );
  body.position.y = 3;
  const legs = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 4.5, 3, 4, 1, true),
    new THREE.MeshLambertMaterial({ color: 0x6b7280, wireframe: true }),
  );
  legs.position.y = 0.8;
  const rotor = new THREE.Mesh(
    new THREE.CylinderGeometry(11, 11, 0.4, 24),
    new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.35 }),
  );
  rotor.position.y = 6.5;
  group.add(body, legs, rotor);
  return { group, rotor };
}
