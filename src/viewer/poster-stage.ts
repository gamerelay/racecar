// The poster studio's stage (see poster.ts): a real track's scene, cars posed along paths and run
// forward on a fixed step, and a renderer that draws it at an exact size through the game's post
// pass and ink, then the title treatment.

import { type Fog, PerspectiveCamera, type PointsMaterial, Scene, Vector3, WebGLRenderer, type DirectionalLight } from 'three';
import type { CarClass, PaintDef } from '../core/content';
import { ALL_MAPS, CLASSES, LAYOUTS, MAPS, PAINTS, SURFACES } from '../content';
import { Sim } from '../core/sim';
import { bakeTrack, type Track } from '../core/track/bake';
import { newHit, project, sampleAt, type TrackHit } from '../core/track/query';
import { TRAFFIC_KINDS } from '../core/world/traffic';
import type { CarVisual, TrackVisual, WorldVisual } from '../render/skin';
import { indoorAt } from '../render/camera';
import { Particles } from '../render/fx';
import { InkPass } from '../render/ink';
import { PostPass } from '../render/post';
import { Skids } from '../render/skids';
import { GreyboxSkin } from '../render/skins/greybox';
import { disposeTree } from '../render/skins/greybox/dispose';

// ---------------------------------------------------------------------------------------------
// Determinism: every shot runs on its own seeded Math.random (wreck debris, shards, particles,
// flame flicker all draw from it). Swapped in for the poster page only.

export const nativeRandom = Math.random;
export function seedRandom(seed: number): void {
  let a = seed >>> 0 || 1;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// Poses and paths.

export interface Pose {
  x: number;
  y: number;
  z: number;
  /** Heading: forward is (sin h, cos h). */
  h: number;
  pitch: number;
  roll: number;
}
export type PoseFn = (t: number) => Pose;

const GRAVITY = 20;
const STEP = 1 / 120;

/** A pose `right`, `up`, `fwd` metres from a pose, in its frame (heading only). */
export function offset(p: Pose, right: number, up: number, fwd: number): Vector3 {
  const fx = Math.sin(p.h);
  const fz = Math.cos(p.h);
  // right = (-fz, fx) in this game's frame (positive lateral is to the right of travel).
  return new Vector3(p.x + fx * fwd - fz * right, p.y + up, p.z + fz * fwd + fx * right);
}

interface ActorOpts {
  pose: PoseFn;
  /** Forward speed (m/s), for wheel spin and particles. */
  speed?: number;
  boost?: boolean | ((t: number) => boolean);
  brake?: boolean;
  steer?: number;
  /** Lays skid marks and drift smoke. 0–3 is the drift stage's spark color. */
  drift?: number;
  /** When and where it's hit. */
  wreck?: { t: number; dx: number; dz: number; strength: number; sparks?: number };
  /** In the air (no beam, no shadow, no skids) at time t. */
  air?: (t: number) => boolean;
  /** Kicks up dirt (off the asphalt). */
  dust?: boolean;
  size: [number, number, number];
}

interface Actor extends ActorOpts {
  v: CarVisual;
  spin: number;
  wrecked: boolean;
  key: number;
}

const STAGE_COLORS = [0xffffff, 0x35a8ff, 0xff8a1a, 0xff2e88];
const TRAFFIC_COLORS = [0xf2f2f2, 0x3a86ff, 0xffbe0b, 0x8338ec, 0x06d6a0, 0xef476f, 0x2a2a3a, 0xff7b00, 0x9bf6ff, 0xc9c1d9];

const emits = (rate: number, dt: number): number => {
  const n = rate * dt;
  return Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
};

// ---------------------------------------------------------------------------------------------
// The stage: one track's scene with its sky, world and cars.

export class Stage {
  readonly scene = new Scene();
  readonly skin = new GreyboxSkin();
  readonly sim: Sim;
  readonly track: Track;
  readonly fx = new Particles();
  readonly skids = new Skids();
  readonly actors: Actor[] = [];
  private trackVisual: TrackVisual;
  private worldVisual: WorldVisual;
  private readonly hit: TrackHit = newHit();
  time = 0;
  /** Wet roads (0–1): the skin's sheen and the post pass's reflections. */
  wet = 0;

  constructor(
    readonly mapKey: string,
    palette?: string,
    /** Traffic's density (0: none, the posters'). */
    traffic = 0,
  ) {
    const layout = structuredClone(LAYOUTS[mapKey]);
    const map = ALL_MAPS.find((m) => mapKey.startsWith(m.id + '/')) ?? MAPS[0];
    this.track = bakeTrack(layout, SURFACES);
    this.sim = new Sim(this.track, CLASSES, SURFACES, { seed: 7, weather: 'clear', mayhem: 'off', traffic });
    this.skin.environment(this.scene, palette ?? map.palette);
    this.trackVisual = this.skin.track(this.track, this.sim.seed);
    for (const c of this.trackVisual.chunks) this.scene.add(c);
    for (const e of this.trackVisual.extras) this.scene.add(e);
    this.trackVisual.debug.visible = false;
    this.scene.add(this.fx.points);
    this.scene.add(this.skids.mesh);
    this.worldVisual = this.skin.world(this.scene, this.sim, this.trackVisual);
    // Sparks and flames a touch bigger than in play: a still has to show them without motion.
    (this.fx.points.material as PointsMaterial).size = knob('fx', 0.6);
  }

  get sun(): DirectionalLight | undefined {
    return (this.skin as unknown as { sun?: DirectionalLight }).sun;
  }

  /** The road at distance s along a spline, `lat` metres right of its centre line. */
  at(s: number, lat = 0, spline = 0, yaw = 0): Pose {
    const sp = this.track.splines[spline];
    const h = sampleAt(sp, s, this.hit);
    const x = h.cx - h.tz * lat;
    const z = h.cz + h.tx * lat;
    project(sp, x, z, s, h);
    return { x, y: h.ground, z, h: Math.atan2(h.tx, h.tz) + yaw, pitch: 0, roll: h.bank };
  }

  /** Length of a spline. */
  length(spline = 0): number {
    return this.track.splines[spline].length;
  }

  /** Driving along the road: at `s0` at t = 0, `speed` m/s, drifting `lat` by `latRate` a second. */
  drive(s0: number, lat: number, speed: number, o: { spline?: number; yaw?: number; latRate?: number; lift?: number; pitch?: number; roll?: number } = {}): PoseFn {
    return (t) => {
      const p = this.at(s0 + speed * t, lat + (o.latRate ?? 0) * t, o.spline ?? 0, o.yaw ?? 0);
      p.y += o.lift ?? 0;
      p.pitch += o.pitch ?? 0;
      p.roll += o.roll ?? 0;
      return p;
    };
  }

  /** Ballistic from time `t0` on: the base pose's velocity plus a kick, spinning at `w` (pitch, yaw, roll rad/s). */
  tumble(base: PoseFn, t0: number, kick: { up: number; right?: number; fwd?: number }, w: [number, number, number]): PoseFn {
    const p0 = base(t0);
    const p1 = base(t0 + 0.01);
    const vx0 = (p1.x - p0.x) / 0.01;
    const vz0 = (p1.z - p0.z) / 0.01;
    const k = offset({ ...p0, x: 0, y: 0, z: 0 }, kick.right ?? 0, kick.up, kick.fwd ?? 0);
    return (t) => {
      if (t <= t0) return base(t);
      const d = t - t0;
      return {
        x: p0.x + (vx0 + k.x) * d,
        y: p0.y + k.y * d - 0.5 * GRAVITY * d * d,
        z: p0.z + (vz0 + k.z) * d,
        h: p0.h + w[1] * d,
        pitch: p0.pitch + w[0] * d,
        roll: p0.roll + w[2] * d,
      };
    };
  }

  /** A car: a player class by id, or a traffic design at its traffic size. */
  car(id: string, paint: PaintDef | string | number, o: Omit<ActorOpts, 'size'>): Actor {
    const cls: Pick<CarClass, 'id' | 'size'> = CLASSES.find((c) => c.id === id) ?? { id, size: kindSize(id) };
    const p = typeof paint === 'object' ? paint : typeof paint === 'number' ? trafficPaint(paint) : (PAINTS.find((x) => x.id === paint) ?? PAINTS[0]);
    const v = this.skin.car(cls as CarClass, p);
    this.scene.add(v.root);
    const a: Actor = { ...o, size: cls.size as [number, number, number], v, spin: 0, wrecked: false, key: this.actors.length };
    this.actors.push(a);
    this.place(a, 0);
    // Settle the wreck's own velocity tracking at the first pose.
    v.update(0, 0, false, false, true, 0);
    return a;
  }

  private place(a: Actor, t: number): Pose {
    const p = a.pose(t);
    a.v.root.position.set(p.x, p.y, p.z);
    a.v.root.rotation.set(p.pitch, p.h, p.roll, 'YXZ');
    return p;
  }

  /** Runs the scene from `t0` to `t1` on the fixed step. */
  run(t0: number, t1: number, camera: Vector3): void {
    for (let t = t0; t < t1 - 1e-9; t += STEP) this.step(t + STEP, STEP, camera);
  }

  private step(t: number, dt: number, camera: Vector3): void {
    for (const a of this.actors) {
      const p = this.place(a, t);
      if (a.wreck && !a.wrecked && t >= a.wreck.t) {
        a.wrecked = true;
        a.v.wreck?.(a.wreck.dx, a.wreck.dz, a.wreck.strength);
        const at = offset(p, -a.wreck.dx * a.size[0], 0.8, a.wreck.dz * a.size[1]);
        const n = a.wreck.sparks ?? 1;
        // Carried along at the car's speed (in play they stay put, which a still shows as a trail of blobs).
        const q = a.pose(t - 0.01);
        const vx = (p.x - q.x) / 0.01;
        const vz = (p.z - q.z) / 0.01;
        this.fx.burst(at.x, at.y, at.z, 80 * n, 11, 0xffa040, vx, vz);
        this.fx.burst(at.x, at.y + 0.2, at.z, 40 * n, 8, 0x9ff3ff, vx, vz);
      }
      const speed = a.speed ?? 0;
      a.spin += (speed / 0.38) * dt;
      const boosting = typeof a.boost === 'function' ? a.boost(t) : !!a.boost;
      const onRoad = !a.wrecked && !(a.air?.(t) ?? false);
      a.v.update(a.spin, a.steer ?? 0, a.brake ?? false, boosting, onRoad, dt);
      this.particles(a, p, speed, boosting, dt, t);
    }
    this.fx.update(dt);
    const fog = this.scene.fog as Fog | null;
    this.skids.update(dt, fog?.near, fog?.far);
    this.time = t;
    this.trackVisual.update?.(t, dt, camera);
  }

  private particles(a: Actor, p: Pose, speed: number, boosting: boolean, dt: number, t: number): void {
    const fx = Math.sin(p.h);
    const fz = Math.cos(p.h);
    const rx = -fz;
    const rz = fx;
    const back = a.size[1] - 0.6;
    if (a.wrecked) {
      for (let n = emits(20, dt); n > 0; n--) this.fx.emit(p.x, p.y + 0.6, p.z, (Math.random() - 0.5) * 2, 2, (Math.random() - 0.5) * 2, 1.2, 0x554466, -1, 1);
      return;
    }
    const air = a.air?.(t) ?? false;
    if (a.dust && !air && speed > 6) {
      for (let s = -1; s <= 1; s += 2) {
        const n = emits(0.55 * speed * (a.drift !== undefined ? 2.2 : 1), dt);
        const wx = p.x - fx * back + rx * s * a.size[0];
        const wz = p.z - fz * back + rz * s * a.size[0];
        const kick = speed * 0.08;
        for (let e = 0; e < n; e++)
          this.fx.emit(wx, p.y + 0.35, wz, -fx * kick + (Math.random() - 0.5) * 2.5, 0.6 + Math.random() * 1.4, -fz * kick + (Math.random() - 0.5) * 2.5, 1.2 + Math.random() * 0.8, Math.random() < 0.5 ? 0xb39670 : 0x9c7f5a, -1.2, 2.2);
      }
    }
    if (a.drift !== undefined && !air) {
      const stage = a.drift;
      for (let s = -1; s <= 1; s += 2) {
        const wx = p.x - fx * back + rx * s * a.size[0];
        const wz = p.z - fz * back + rz * s * a.size[0];
        for (let n = emits(40, dt); n > 0; n--) this.fx.emit(wx, p.y + 0.3, wz, (Math.random() - 0.5) * 2, 1.2, (Math.random() - 0.5) * 2, 0.9, 0x6a6080, -2, 2);
        for (let n = stage > 0 ? emits(60, dt) : 0; n > 0; n--)
          this.fx.emit(wx, p.y + 0.15, wz, (Math.random() - 0.5) * 5 - fx * 3, Math.random() * 3, (Math.random() - 0.5) * 5 - fz * 3, 0.25, STAGE_COLORS[stage], 20, 1);
        // Rubber under the rear wheels.
        const lat = s * (a.size[0] - 0.2);
        const sx = p.x - fx * back - fz * lat;
        const sz = p.z - fz * back + fx * lat;
        project(this.track.main, sx, sz, 0, this.hit);
        this.skids.mark(a.key * 2 + (s > 0 ? 1 : 0), sx, p.y, sz, 0.4, 0.3, 0.28, 0.34, 0.75);
      }
    }
    if (boosting) {
      for (let k = 0; k < 2; k++) {
        const s = k ? -0.4 : 0.4;
        for (let n = emits(60, dt); n > 0; n--) {
          const color = Math.random() < 0.5 ? 0xff7a1a : 0x35f0ff;
          this.fx.emit(p.x - fx * (back + 0.5) + rx * s, p.y + 0.55, p.z - fz * (back + 0.5) + rz * s, -fx * speed * 0.3 + (Math.random() - 0.5), Math.random(), -fz * speed * 0.3 + (Math.random() - 0.5), 0.15 + Math.random() * 0.1, color, 0, 0);
        }
      }
    }
  }

  /** Sparks where two things meet. */
  sparks(p: Vector3, n: number, speed = 7): void {
    this.fx.burst(p.x, p.y, p.z, n, speed, 0xffc060);
  }

  /** Particles nearer the camera than this (m) are dropped: up close they're blurry blobs over the frame. */
  clearNear = 7;

  finish(camera: PerspectiveCamera): void {
    const pos = this.fx.points.geometry.attributes.position;
    const c = camera.position;
    for (let i = 0; i < pos.count; i++) {
      if (Math.hypot(pos.getX(i) - c.x, pos.getY(i) - c.y, pos.getZ(i) - c.z) < this.clearNear) pos.setY(i, -1e4);
    }
    pos.needsUpdate = true;
    this.worldVisual.update(0, camera.position, this.time);
    // A still: fully indoors inside an enclosed piece, as the game is once it's eased in.
    const g = this.track.ground;
    const inside = g ? indoorAt(g, camera.position.x, camera.position.y, camera.position.z) : null;
    this.skin.update(this.time, camera.position.x, camera.position.y, camera.position.z, this.wet, false, { amount: inside ? 1 : 0, look: inside?.indoor ?? 'tunnel' });
  }

  dispose(): void {
    for (const a of this.actors) {
      this.scene.remove(a.v.root);
      a.v.dispose();
    }
    this.worldVisual.dispose();
    this.trackVisual.dispose();
    disposeTree([this.scene]);
  }
}

function kindSize(id: string): [number, number, number] {
  const k = TRAFFIC_KINDS.find((x) => x.id === id);
  return k ? [k.hw, k.hl, k.hh] : [0.95, 2.25, 0.72];
}

function trafficPaint(i: number): PaintDef {
  const c = TRAFFIC_COLORS[i % TRAFFIC_COLORS.length];
  return { id: `traffic${i}`, name: 'Traffic', color: `#${c.toString(16).padStart(6, '0')}`, finish: 'gloss' } as PaintDef;
}

// ---------------------------------------------------------------------------------------------
// Rendering: at an exact size, supersampled, through the game's post pass and ink.

const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
const post = new PostPass(1, 1);
const inkPass = new InkPass(1, 1);
post.uniforms.tInk.value = inkPass.target.texture;
post.uniforms.tInkDepth.value = inkPass.target.depthTexture;

export interface Look {
  /** Post pass feel: speed blur at the edges, boost streaks, impact flash (0–1 each). */
  speed?: number;
  boost?: number;
  impact?: number;
  /** Ink line width in output pixels. */
  line?: number;
  /** Film grain (the game's is 1; stills default to 0). */
  grain?: number;
}

export function render(stage: Stage, camera: PerspectiveCamera, w: number, h: number, ss: number, look: Look): HTMLCanvasElement {
  const W = Math.round(w * ss);
  const H = Math.round(h * ss);
  renderer.setSize(W, H, false);
  post.setSize(W, H, (look.line ?? 1.6) * ss);
  inkPass.setSize(W, H);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  stage.finish(camera);
  post.uniforms.uInk.value.setHex(stage.skin.ink);
  const u = post.uniforms;
  u.uTime.value = 12.345;
  u.uSpeed.value = look.speed ?? 0;
  u.uBoost.value = look.boost ?? 0;
  u.uImpact.value = look.impact ?? 0;
  u.uSlow.value = 0;
  // No film grain by default: it's noise at poster sizes (and doubles a PNG's size).
  u.uGrain.value = look.grain ?? knob('grain', 0);
  u.uOutline.value = 1;
  u.uNear.value = camera.near;
  u.uFar.value = camera.far;
  const fog = stage.scene.fog as Fog | null;
  if (fog) {
    u.uFogNear.value = fog.near;
    u.uFogFar.value = fog.far;
    u.uSky.value.copy(fog.color);
  }
  u.uWet.value = stage.wet;
  u.uWater.value = (stage as unknown as { trackVisual: TrackVisual }).trackVisual.water ? 1 : 0;
  u.uProj.value.copy(camera.projectionMatrix);
  u.uInvProj.value.copy(camera.projectionMatrixInverse);
  u.uView.value.copy(camera.matrixWorldInverse);
  u.uCarInk.value = 1;
  inkPass.render(renderer, stage.scene, camera);
  renderer.setRenderTarget(post.target);
  renderer.render(stage.scene, camera);
  post.render(renderer);
  // Down to the output size by halves, so every source pixel counts.
  let src: HTMLCanvasElement = renderer.domElement;
  let sw = W;
  let sh = H;
  while (sw / 2 >= w * 1.01) {
    const c = document.createElement('canvas');
    c.width = Math.round(sw / 2);
    c.height = Math.round(sh / 2);
    const g = c.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, c.width, c.height);
    src = c;
    sw = c.width;
    sh = c.height;
  }
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const g = out.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  return out;
}

// ---------------------------------------------------------------------------------------------
// The title: the menu's "Racecar" (Bungee, sun yellow, ink stroke, a pink drop) and a HUD tag.

export interface TitleSpec {
  /** Where the title's anchor sits, as fractions of the frame. */
  x: number;
  y: number;
  /** Cap height as a fraction of the frame's height. */
  size: number;
  align?: 'left' | 'center' | 'right';
  tagline?: string;
  /** Tilt, degrees (arcade lean). */
  tilt?: number;
}

const INKC = '#120a20';
const SUN = '#ffd23f';
const PINK = '#ff2e88';
const CREAM = '#fff6ee';
const CYAN = '#35f0ff';

export async function fonts(): Promise<void> {
  await Promise.all([document.fonts.load('400 100px Bungee'), document.fonts.load('700 40px "Chakra Petch"')]);
}

export function drawTitle(canvas: HTMLCanvasElement, t: TitleSpec): void {
  const g = canvas.getContext('2d')!;
  const H = canvas.height;
  const size = t.size * H;
  const align = t.align ?? 'left';
  g.save();
  g.translate(t.x * canvas.width, t.y * H);
  g.transform(1, 0, -Math.tan(((t.tilt ?? 8) * Math.PI) / 180), 1, 0, 0);
  g.font = `400 ${size}px Bungee`;
  g.textAlign = align;
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  const word = 'RACECAR';
  const drop = size * 0.085;
  // A dark ink halo first, then the pink drop, the ink stroke and the fill.
  g.strokeStyle = INKC;
  g.lineWidth = size * 0.2;
  g.strokeText(word, drop, drop);
  g.fillStyle = PINK;
  g.fillText(word, drop, drop);
  g.lineWidth = size * 0.1;
  g.strokeText(word, 0, 0);
  g.fillStyle = SUN;
  g.fillText(word, 0, 0);
  // A hot highlight band across the top of the letters.
  g.save();
  g.beginPath();
  g.rect(-canvas.width, -size * 0.78, canvas.width * 3, size * 0.16);
  g.clip();
  g.fillStyle = '#fff3b0';
  g.fillText(word, 0, 0);
  g.restore();
  if (t.tagline) {
    const ts = size * 0.26;
    g.font = `700 ${ts}px "Chakra Petch"`;
    const tw = g.measureText(t.tagline).width;
    const padX = ts * 0.55;
    const bw = tw + padX * 2;
    const bh = ts * 1.45;
    const left = align === 'left' ? 0 : align === 'center' ? -bw / 2 : -bw;
    const shift = align === 'left' ? size * 0.05 : align === 'right' ? -size * 0.05 : 0;
    const top = size * 0.32;
    const lw = Math.max(2, ts * 0.09);
    g.fillStyle = INKC;
    g.fillRect(left + shift + lw * 2.2, top + lw * 2.2, bw, bh);
    g.fillStyle = 'rgba(18, 8, 38, 0.86)';
    g.fillRect(left + shift, top, bw, bh);
    g.strokeStyle = CREAM;
    g.lineWidth = lw;
    g.strokeRect(left + shift, top, bw, bh);
    g.fillStyle = CREAM;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    // Dots between words in cyan, like the HUD's accents.
    let x = left + shift + padX;
    const parts = t.tagline.split(/(·)/);
    for (const part of parts) {
      g.fillStyle = part === '·' ? CYAN : CREAM;
      g.fillText(part, x, top + bh / 2 + ts * 0.04);
      x += g.measureText(part).width;
    }
  }
  g.restore();
}

// ---------------------------------------------------------------------------------------------
// Shots.

export interface ShotResult {
  stage: Stage;
  camera: PerspectiveCamera;
  look?: Look;
}

export interface Shot {
  name: string;
  w: number;
  h: number;
  seed?: number;
  title?: TitleSpec;
  /** Formats: png unless it's big. */
  jpg?: boolean;
  build(): ShotResult;
}

export function cam(fov: number, pos: Vector3, look: Vector3): PerspectiveCamera {
  const c = new PerspectiveCamera(fov, 1, 0.1, 3000);
  c.position.copy(pos);
  c.lookAt(look);
  return c;
}


/** A number from the URL, for tuning a shot without editing it (`&cr=4.2`). */
export function knob(name: string, value: number): number {
  const v = new URLSearchParams(location.search).get(name);
  return v === null ? value : Number(v);
}
