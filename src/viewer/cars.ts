// The garage: every car on a stretch of road under the greybox sky, with the game's post pass, so
// car art can be worked on without driving. Dev tool; state lives in the URL so a view can be shared.
//
//   1–4 class · 0 lineup · P paint · V view · C compare with the old boxes · M palette
//   O ink · F post · hold B brake · hold Space boost · ←/→ steer · S stop the road

import { BoxGeometry, type Fog, Group, Mesh, PerspectiveCamera, PlaneGeometry, Scene, Vector3, WebGLRenderer } from 'three';
import { CLASSES, PAINTS } from '../content';
import type { CarVisual } from '../render/skin';
import { PostPass } from '../render/post';
import { GreyboxSkin } from '../render/skins/greybox';
import { buildLegacyCar } from '../render/skins/greybox/car/legacy';
import { toon } from '../render/skins/greybox/toon';

const VIEWS = ['chase', 'orbit', 'rear34', 'side', 'front34', 'top'] as const;
type View = (typeof VIEWS)[number];
const PALETTE_NAMES = ['dusk', 'midnight', 'golden'];

const q = new URLSearchParams(location.search);
const state = {
  cls: q.get('cls') ?? 'coupe',
  paint: q.get('paint') ?? 'hot-pink',
  view: (q.get('view') as View) ?? 'chase',
  compare: q.get('compare') === '1',
  palette: q.get('palette') ?? 'dusk',
  ink: q.get('ink') !== '0',
  post: q.get('post') !== '0',
  moving: q.get('still') !== '1',
};

const keys = new Set<string>();
const stage = document.getElementById('stage')!;
const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
const ratio = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(ratio);
stage.appendChild(renderer.domElement);
const post = new PostPass(1, 1);
const camera = new PerspectiveCamera(62, 1, 0.1, 3000);

let scene: Scene;
let skin: GreyboxSkin;
let cars: { v: CarVisual; x: number }[] = [];
let road: Group;
let spin = 0;
let steer = 0;
let orbit = 0.6;
let time = 0;
let dragging = false;

const hud = document.createElement('div');
hud.style.cssText =
  'position:fixed;left:16px;bottom:16px;font:600 13px/1.5 "Chakra Petch",sans-serif;color:#f5f1ff;background:rgba(18,10,32,.72);border:2px solid #f5f1ff;padding:10px 14px;pointer-events:none;white-space:pre';
document.body.append(hud);
document.body.style.cssText = 'margin:0;overflow:hidden;background:#120a20';

function buildRoad(): Group {
  const g = new Group();
  const asphalt = new Mesh(new PlaneGeometry(22, 2000), toon({ color: 0x2c2548 }));
  asphalt.rotation.x = -Math.PI / 2;
  g.add(asphalt);
  const walk = toon({ color: 0x4a4278 });
  for (const s of [-1, 1]) {
    const curb = new Mesh(new BoxGeometry(5, 0.2, 2000), walk);
    curb.position.set(s * 13.5, 0.1, 0);
    g.add(curb);
  }
  const dashes = new Group();
  dashes.name = 'dashes';
  const white = toon({ color: 0xd8d4f0, emissive: 0x3a3460 });
  const yellow = toon({ color: 0xffd23f, emissive: 0x4a3a00 });
  for (let z = -300; z < 300; z += 9) {
    for (const x of [-7.3, -3.6, 3.6, 7.3]) {
      const d = new Mesh(new PlaneGeometry(0.16, 3.5), white);
      d.rotation.x = -Math.PI / 2;
      d.position.set(x, 0.02, z);
      dashes.add(d);
    }
  }
  g.add(dashes);
  for (const x of [-0.18, 0.18]) {
    const l = new Mesh(new PlaneGeometry(0.14, 2000), yellow);
    l.rotation.x = -Math.PI / 2;
    l.position.set(x, 0.02, 0);
    g.add(l);
  }
  // A few blocks either side for scale and ink.
  const blocks = [0x3b2a5c, 0x2e3b63, 0x5a2f55, 0x24324a, 0x46345e];
  for (let i = 0; i < 40; i++) {
    for (const s of [-1, 1]) {
      const h = 14 + ((i * 37 + (s > 0 ? 11 : 0)) % 23) * 1.6;
      const b = new Mesh(new BoxGeometry(12, h, 16), toon({ color: blocks[(i + (s > 0 ? 2 : 0)) % blocks.length] }));
      b.position.set(s * 23, h / 2, -300 + i * 18);
      g.add(b);
    }
  }
  return g;
}

function rebuild(): void {
  for (const c of cars) c.v.dispose();
  scene = new Scene();
  skin = new GreyboxSkin();
  skin.environment(scene, state.palette);
  post.uniforms.uInk.value.setHex(skin.ink);
  road = buildRoad();
  scene.add(road);
  const paint = PAINTS.find((p) => p.id === state.paint) ?? PAINTS[0];
  const classes = state.cls === 'all' ? CLASSES : CLASSES.filter((c) => c.id === state.cls);
  cars = [];
  const place = (v: CarVisual, x: number) => {
    v.root.position.x = x;
    scene.add(v.root);
    cars.push({ v, x });
  };
  if (state.cls === 'all') {
    classes.forEach((c, i) => place(skin.car(c, PAINTS[(PAINTS.indexOf(paint) + i) % PAINTS.length]), (i - 1.5) * 3.6));
  } else if (state.compare) {
    // +x is screen-left from behind: old on the left, new on the right.
    place(buildLegacyCar(classes[0], paint), 1.8);
    place(skin.car(classes[0], paint), -1.8);
  } else place(skin.car(classes[0], paint), 0);
  const url = new URL(location.href);
  url.search = new URLSearchParams({
    cls: state.cls,
    paint: state.paint,
    view: state.view,
    palette: state.palette,
    ...(state.compare ? { compare: '1' } : {}),
    ...(state.ink ? {} : { ink: '0' }),
    ...(state.post ? {} : { post: '0' }),
    ...(state.moving ? {} : { still: '1' }),
  }).toString();
  history.replaceState(null, '', url);
}

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post.setSize(Math.floor(w * ratio), Math.floor(h * ratio), 1.5 * ratio);
}

function placeCamera(): void {
  const wide = cars.length > 1 ? 1.7 : 1;
  const look = new Vector3(0, 0.8, 0);
  camera.fov = 62;
  switch (state.view) {
    case 'chase':
      camera.position.set(0, 2.35, -5.9 * wide);
      look.set(0, 1.1, 12);
      break;
    case 'orbit':
      camera.fov = 40;
      camera.position.set(Math.sin(orbit) * 9 * wide, 2.6, Math.cos(orbit) * 9 * wide);
      break;
    case 'rear34':
      camera.fov = 40;
      camera.position.set(4.8 * wide, 1.9, -6.5 * wide);
      break;
    case 'front34':
      camera.fov = 40;
      camera.position.set(-5 * wide, 1.7, 6.6 * wide);
      break;
    case 'side':
      camera.fov = cars.length > 1 ? 58 : 36;
      camera.position.set(cars.length > 1 ? 12.5 : 10, 1.2, 0);
      look.set(0, 0.8, 0);
      break;
    case 'top':
      camera.fov = 40;
      camera.position.set(0.01, 12 * wide, 0);
      look.set(0, 0, 0);
      break;
  }
  camera.lookAt(look);
  camera.updateProjectionMatrix();
}

function frame(now: number): void {
  const dt = Math.min(0.05, (now - (time || now)) / 1000 || 0.016);
  time = now;
  const speed = state.moving ? (keys.has(' ') ? 55 : 32) : 0;
  const boosting = keys.has(' ');
  const braking = keys.has('b');
  const want = keys.has('ArrowLeft') ? 1 : keys.has('ArrowRight') ? -1 : 0;
  steer += (want - steer) * Math.min(1, dt * 8);
  spin += (speed / 0.38) * dt;
  const dashes = road.getObjectByName('dashes')!;
  dashes.position.z = -((time / 1000) * speed) % 9;
  if (state.view === 'orbit' && !dragging) orbit += dt * 0.35;
  // Side on, a lineup spreads along the road instead of across it.
  const along = state.view === 'side' && cars.length > 1;
  for (const c of cars) {
    c.v.root.position.set(along ? 0 : c.x, 0, along ? c.x * 1.6 : 0);
    c.v.update(spin, steer, braking, boosting, true);
    c.v.root.rotation.y = steer * 0.08;
    c.v.root.rotation.z = -steer * 0.03;
  }
  skin.update(now / 1000, camera.position.x, camera.position.y, camera.position.z, 0);
  placeCamera();

  let calls = 0;
  const u = post.uniforms;
  u.uTime.value = now / 1000;
  u.uSpeed.value = state.view === 'chase' ? Math.min(1, speed / 60) * 0.5 : 0;
  u.uBoost.value += ((boosting && state.view === 'chase' ? 1 : 0) - u.uBoost.value) * Math.min(1, dt * 5);
  u.uOutline.value = state.ink ? 1 : 0;
  u.uNear.value = camera.near;
  u.uFar.value = camera.far;
  const fog = scene.fog as Fog | null;
  if (fog) {
    u.uFogNear.value = fog.near;
    u.uFogFar.value = fog.far;
  }
  if (state.post) {
    renderer.setRenderTarget(post.target);
    renderer.render(scene, camera);
    calls = renderer.info.render.calls;
    post.render(renderer);
  } else {
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    calls = renderer.info.render.calls;
  }
  hud.textContent =
    `${state.cls === 'all' ? 'lineup' : state.cls}${state.compare ? '  (old | new)' : ''} · ${state.paint} · ${state.view} · ${state.palette}   ${calls} draws\n` +
    `1–4 class · 0 lineup · P paint · V view · C compare · M palette · O ink · F post · S road\nhold B brake · Space boost · ←/→ steer · drag to orbit`;
  requestAnimationFrame(frame);
}

window.addEventListener('keydown', (e) => {
  keys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  const k = e.key.toLowerCase();
  const ids = CLASSES.map((c) => c.id);
  if (k >= '1' && k <= '4') state.cls = ids[Number(k) - 1];
  else if (k === '0') state.cls = 'all';
  else if (k === 'p') state.paint = PAINTS[(PAINTS.findIndex((p) => p.id === state.paint) + (e.shiftKey ? PAINTS.length - 1 : 1)) % PAINTS.length].id;
  else if (k === 'v') state.view = VIEWS[(VIEWS.indexOf(state.view) + 1) % VIEWS.length];
  else if (k === 'c') state.compare = !state.compare;
  else if (k === 'm') state.palette = PALETTE_NAMES[(PALETTE_NAMES.indexOf(state.palette) + 1) % PALETTE_NAMES.length];
  else if (k === 'o') state.ink = !state.ink;
  else if (k === 'f') state.post = !state.post;
  else if (k === 's') state.moving = !state.moving;
  else return;
  rebuild();
});
window.addEventListener('keyup', (e) => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
window.addEventListener('keydown', (e) => e.key === ' ' && e.preventDefault());
renderer.domElement.addEventListener('pointerdown', () => {
  dragging = true;
  state.view = 'orbit';
});
window.addEventListener('pointerup', () => (dragging = false));
window.addEventListener('pointermove', (e) => {
  if (dragging) orbit -= e.movementX * 0.01;
});
window.addEventListener('resize', resize);

rebuild();
resize();
requestAnimationFrame(frame);
