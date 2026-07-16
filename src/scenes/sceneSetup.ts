/**
 * Shared three.js scaffolding for the Flight Deck scenes: renderer, camera,
 * orbit controls, martian lighting, terrain mesh, base-station marker,
 * resize handling, render loop, and disposal.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getLoadedTerrain } from './heightfield';
import { activeTerrainSizeM, buildTerrainMesh, heightAt } from './terrain';

export interface DeckScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  /** register a per-frame callback (dt seconds); returns an unregister fn */
  onFrame: (cb: (dt: number) => void) => () => void;
  dispose: () => void;
}

// Mars daytime palette
const SKY_HORIZON = 0xe4b184; // butterscotch haze at the horizon
const SKY_ZENITH = 0xa8988c; // dustier tan overhead

/** Gradient sky dome (BackSide sphere) for a Mars daytime atmosphere. */
function buildSkyDome(radius: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(SKY_ZENITH) },
      bottom: { value: new THREE.Color(SKY_HORIZON) },
      exponent: { value: 0.7 },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = (modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform float exponent; varying vec3 vP;
      void main(){ float h = normalize(vP).y; float t = pow(max(h,0.0), exponent); gl_FragColor = vec4(mix(bottom, top, t), 1.0); }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  dome.name = 'sky';
  return dome;
}

export function createDeckScene(container: HTMLElement): DeckScene {
  const size = activeTerrainSizeM();
  const real = size > 4000; // real DEM window vs procedural stand-in
  const loaded = getLoadedTerrain();
  const terrainTexture = loaded?.texture ?? null;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_HORIZON);
  scene.fog = new THREE.Fog(SKY_HORIZON, size * 0.28, size * 1.45);

  const camera = new THREE.PerspectiveCamera(
    52,
    container.clientWidth / Math.max(1, container.clientHeight),
    1,
    size * 6,
  );
  camera.position.set(size * 0.14, size * 0.34, size * 0.24); // bird's-eye framing

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(real ? -size * 0.1 : 0, 0, real ? -size * 0.08 : 0); // look toward the delta
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49; // stay above the ground plane
  controls.minDistance = 60;
  controls.maxDistance = size * 1.6;

  scene.add(buildSkyDome(size * 2));

  // martian light: warm low raking sun (side-lights the delta) + dusty sky fill
  const sun = new THREE.DirectionalLight(0xffe0bd, 2.1);
  sun.position.set(-size * 0.5, size * 0.36, -size * 0.22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -size * 0.62;
  sc.right = size * 0.62;
  sc.top = size * 0.62;
  sc.bottom = -size * 0.62;
  sc.near = size * 0.1;
  sc.far = size * 2;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(sun.target);
  scene.add(new THREE.HemisphereLight(0xe0b58c, 0x3a2418, 0.7));
  scene.add(new THREE.AmbientLight(0xffffff, 0.12));

  const terrain = buildTerrainMesh(terrainTexture);
  scene.add(terrain);

  // base station marker
  const base = new THREE.Group();
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(16, 16, 1.2, 24),
    new THREE.MeshStandardMaterial({ color: 0x8892a6, roughness: 0.7 }),
  );
  pad.position.y = 0.6;
  pad.castShadow = true;
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 0.8, 22, 8),
    new THREE.MeshStandardMaterial({ color: 0xb9c2d4, roughness: 0.6 }),
  );
  mast.position.y = 11;
  mast.castShadow = true;
  base.add(pad, mast);
  base.name = 'base-station';
  base.position.y = heightAt(0, 0);
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
