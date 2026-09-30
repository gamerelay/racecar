// The garage: every car on a stretch of road under the greybox sky, with the game's post pass, so
// car art can be worked on without driving. Dev tool; state lives in the URL so a view can be shared.
//
//   1–8 class · 9, - compact, truck (traffic designs with no player class) · 0 lineup · T traffic lineup · P paint · V view · M palette
//   O ink · K car ink · F post · W wreck (R repairs) · hold B brake · hold Space boost · ←/→ steer
//   S stop the road

import { BoxGeometry, Color, type Fog, Group, InstancedMesh, Matrix4, Mesh, PerspectiveCamera, PlaneGeometry, Scene, Vector3, WebGLRenderer } from 'three';
import { PAINT_ALIASES, type CarClass } from '../core/content';
import { CLASSES, PAINTS } from '../content';
import type { CarVisual } from '../render/skin';
import { InkPass } from '../render/ink';
import { PostPass } from '../render/post';
import { GreyboxSkin } from '../render/skins/greybox';
import { disposeTree } from '../render/skins/greybox/dispose';
import { toon } from '../render/skins/greybox/toon';
import { trafficModels } from '../render/skins/greybox/car/traffic';
import { TRAFFIC_KINDS } from '../core/world/traffic';

const VIEWS = ['chase', 'orbit', 'rear34', 'side', 'front34', 'top'] as const;
type View = (typeof VIEWS)[number];
const PALETTE_NAMES = ['dusk', 'midnight', 'golden'];
/** Designs with no player class, at their traffic kind's size. */
const kind = (id: string) => TRAFFIC_KINDS.find((k) => k.id === id)!;
const sized = (id: string, name: string, size: [number, number, number]): CarClass => ({ ...CLASSES[2], id, name, size });
const SHOWN: CarClass[] = [
  ...CLASSES,
  sized('compact', 'Compact (traffic)', [kind('compact').hw, kind('compact').hl, kind('compact').hh]),
  sized('truck', 'Truck (traffic)', [kind('truck').hw, kind('truck').hl, kind('truck').hh]),
];
/** Class keys, in SHOWN order: the tenth is `-`, next to 0 on the keyboard. */
const CLASS_KEYS = '123456789-';

const q = new URLSearchParams(location.search);
const state = {
  cls: q.get('cls') ?? 'coupe',
  paint: PAINT_ALIASES[q.get('paint') ?? ''] ?? q.get('paint') ?? 'pink',
  view: (q.get('view') as View) ?? 'chase',
  palette: q.get('palette') ?? 'dusk',
  ink: q.get('ink') !== '0',
  carInk: q.get('carink') !== '0',
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
const inkPass = new InkPass(1, 1);
post.uniforms.tInk.value = inkPass.target.texture;
post.uniforms.tInkDepth.value = inkPass.target.depthTexture;
const camera = new PerspectiveCamera(62, 1, 0.1, 3000);

let scene: Scene;
let skin: GreyboxSkin;
interface Shown {
  v: CarVisual;
  x: number;
  /** Where it sits along the road in a side-on lineup. */
  z: number;
  /** Viewer-only wreck tumble: seconds since the hit (−1: driving), velocity, spin. */
  t: number;
  vy: number;
  w: [number, number, number];
}
let cars: Shown[] = [];
let slow = 1;
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
  // The old scene's cars (their own dispose), then everything else in it: road, blocks, sky.
  for (const c of cars) {
    scene?.remove(c.v.root);
    c.v.dispose();
  }
  if (scene) disposeTree([scene]);
  scene = new Scene();
  skin = new GreyboxSkin();
  skin.environment(scene, state.palette);
  post.uniforms.uInk.value.setHex(skin.ink);
  road = buildRoad();
  scene.add(road);
  const paint = PAINTS.find((p) => p.id === state.paint) ?? PAINTS[0];
  const classes = state.cls === 'all' ? CLASSES : SHOWN.filter((c) => c.id === state.cls);
  cars = [];
  const place = (v: CarVisual, x: number, z = 0) => {
    v.root.position.x = x;
    scene.add(v.root);
    cars.push({ v, x, z, t: -1, vy: 0, w: [0, 0, 0] });
  };
  if (state.cls === 'traffic') {
    // Every traffic kind, side by side, in the colors traffic uses.
    const { geos, material } = trafficModels();
    const colors = [0xf2f2f2, 0x3a86ff, 0xffbe0b, 0x8338ec, 0xef476f];
    let x = 0;
    const widths = TRAFFIC_KINDS.map((k) => k.hw * 2 + 1.4);
    x = widths.reduce((a, b) => a + b, 0) / 2;
    TRAFFIC_KINDS.forEach((k, i) => {
      const mesh = new InstancedMesh(geos[k.id], material, 1);
      mesh.setMatrixAt(0, new Matrix4());
      mesh.setColorAt(0, new Color(colors[i % colors.length]));
      const root = new Group();
      root.add(mesh);
      x -= widths[i] / 2;
      place({ root, update() {}, dispose() {} }, x);
      x -= widths[i] / 2;
    });
  } else if (state.cls === 'all') {
    // Across the road for the chase views (closing up so ten stay off the curbs); nose to tail by
    // length for the side view.
    const gap = Math.min(3.6, 26 / (classes.length - 1));
    const total = classes.reduce((a, c) => a + c.size[1] * 2 + 1.2, -1.2);
    let z = total / 2;
    classes.forEach((c, i) => {
      z -= c.size[1];
      place(skin.car(c, PAINTS[(PAINTS.indexOf(paint) + i) % PAINTS.length]), (i - (classes.length - 1) / 2) * gap, z);
      z -= c.size[1] + 1.2;
    });
  } else place(skin.car(classes[0], paint), 0);
  const url = new URL(location.href);
  url.search = new URLSearchParams({
    cls: state.cls,
    paint: state.paint,
    view: state.view,
    palette: state.palette,
    ...(state.ink ? {} : { ink: '0' }),
    ...(state.carInk ? {} : { carink: '0' }),
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
  inkPass.setSize(Math.floor(w * ratio), Math.floor(h * ratio));
}

function placeCamera(): void {
  // Back off for a lineup, and for anything longer than the van (the bus), up as well as back.
  const one = SHOWN.find((c) => c.id === state.cls);
  const big = one ? Math.max(1, one.size[1] / 2.4) : 1;
  // Capped so the front34 camera stays out of the blocks at x = ±17.
  const wide = cars.length > 1 ? Math.min(3.2, (1.7 * cars.length) / 4) : big;
  const lift = cars.length > 1 ? 1 : big;
  const look = new Vector3(0, 0.8 * lift, 0);
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
  const real = Math.min(0.05, (now - (time || now)) / 1000 || 0.016);
  time = now;
  // Burnout slow-mo while anything is freshly wrecked.
  const fresh = cars.some((c) => c.t >= 0 && c.t < 1.4);
  slow += ((fresh ? 0.3 : 1) - slow) * Math.min(1, real * 6);
  const dt = real * slow;
  const wrecked = cars.some((c) => c.t >= 0);
  const speed = state.moving && !wrecked ? (keys.has(' ') ? 55 : 32) : 0;
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
    const r = c.v.root;
    if (c.t < 0) {
      r.position.set(along ? 0 : c.x, 0, along ? c.z : 0);
      r.rotation.set(0, steer * 0.08, -steer * 0.03);
    } else {
      // A cheap wreck body: up, over, down, settle.
      c.t += dt;
      c.vy -= 20 * dt;
      r.position.y += c.vy * dt;
      r.rotation.x += c.w[0] * dt;
      r.rotation.y += c.w[1] * dt;
      r.rotation.z += c.w[2] * dt;
      if (r.position.y < 0) {
        r.position.y = 0;
        c.vy = Math.abs(c.vy) * 0.25;
        for (let k = 0; k < 3; k++) c.w[k] *= 0.4;
        if (c.t > 1.2) r.rotation.x += (Math.round(r.rotation.x / Math.PI) * Math.PI - r.rotation.x) * 0.3;
        if (c.t > 1.2) r.rotation.z += (Math.round(r.rotation.z / Math.PI) * Math.PI - r.rotation.z) * 0.3;
      }
      if (c.t > 4) repair(c);
    }
    c.v.update(spin, steer, braking, boosting, c.t < 0, dt);
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
    u.uCarInk.value = state.ink && state.carInk ? 1 : 0;
    if (u.uCarInk.value) inkPass.render(renderer, scene, camera);
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
    `${state.cls === 'all' ? 'lineup' : state.cls} · ${state.paint} · ${state.view} · ${state.palette}   ${calls} draws\n` +
    `1–9, - class · 0 lineup · T traffic · P paint · V view · M palette · O ink${state.carInk ? '' : ' (car ink off: K)'} · K car ink · F post · S road\nW wreck · R repair · hold B brake · Space boost · ←/→ steer · drag to orbit`;
  requestAnimationFrame(frame);
}

function wreck(): void {
  const r = Math.random;
  for (const c of cars) {
    if (c.t >= 0) continue;
    const front = r() < 0.65;
    const dx = (r() - 0.5) * (front ? 0.8 : 2);
    const dz = front ? 1 : r() < 0.5 ? -1 : (r() - 0.5) * 0.6;
    c.v.wreck?.(dx, dz, 0.6 + r() * 0.4);
    c.t = 0;
    c.vy = 7 + r() * 3;
    c.w = [(r() - 0.5) * 6, (r() - 0.5) * 3, (r() - 0.5) * 8];
  }
}

function repair(c: Shown): void {
  c.t = -1;
  c.v.repair?.();
}

window.addEventListener('keydown', (e) => {
  keys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  const k = e.key.toLowerCase();
  const pick = CLASS_KEYS.indexOf(k);
  if (pick >= 0 && pick < SHOWN.length) state.cls = SHOWN[pick].id;
  else if (k === '0') state.cls = 'all';
  else if (k === 't') state.cls = 'traffic';
  else if (k === 'p') state.paint = PAINTS[(PAINTS.findIndex((p) => p.id === state.paint) + (e.shiftKey ? PAINTS.length - 1 : 1)) % PAINTS.length].id;
  else if (k === 'v') state.view = VIEWS[(VIEWS.indexOf(state.view) + 1) % VIEWS.length];
  else if (k === 'm') state.palette = PALETTE_NAMES[(PALETTE_NAMES.indexOf(state.palette) + 1) % PALETTE_NAMES.length];
  else if (k === 'o') state.ink = !state.ink;
  else if (k === 'f') state.post = !state.post;
  else if (k === 's') state.moving = !state.moving;
  else if (k === 'k') state.carInk = !state.carInk;
  else if (k === 'w') return wreck();
  else if (k === 'r') return cars.forEach(repair);
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
