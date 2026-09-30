// Draws the sim: car visuals interpolated between the last two ticks, the chase camera (speed FOV,
// boost pull-back, shake, look-back, wreck orbit), particles from the event queue, and the post
// pass. Reads core state; never writes it.

import { type Fog, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import type { PaintDef } from '../core/content';
import { Ev, type GameEvent } from '../core/events';
import { clamp, damp, wrapAngle } from '../core/math';
import type { Sim } from '../core/sim';
import { Particles } from './fx';
import { PostPass } from './post';
import type { CarVisual, Skin, TrackVisual, WorldVisual } from './skin';

const STAGE_COLORS = [0xffffff, 0x35a8ff, 0xff8a1a, 0xff2e88];

export interface RenderOptions {
  post: boolean;
  /** Ink outlines (in the post pass). */
  outline: boolean;
  pixelRatio: number;
}

export class GameRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(62, 1, 0.1, 3000);
  private readonly post: PostPass;
  private readonly fx = new Particles();
  private readonly visuals: CarVisual[] = [];
  private readonly spin: number[] = [];
  private trackVisual: TrackVisual;
  private worldVisual: WorldVisual;
  private cursor = 0;
  private time = 0;
  private shake = 0;
  private impact = 0;
  private boostVis = 0;
  private camHeading = 0;
  private camPos = new Vector3();
  private look = new Vector3();
  private orbit = 0;
  private lastWreck = false;
  opts: RenderOptions;
  focus = 0;
  lookBack = false;
  /** Frames per second, smoothed, and the last frame's draw calls, for the HUD and telemetry. */
  fps = 60;
  drawCalls = 0;

  constructor(
    container: HTMLElement,
    private readonly skin: Skin,
    private readonly sim: Sim,
    private readonly paints: PaintDef[],
    palette: string,
    opts: Partial<RenderOptions> = {},
  ) {
    this.opts = { post: true, outline: true, pixelRatio: Math.min(window.devicePixelRatio || 1, 2), ...opts };
    this.renderer = new WebGLRenderer({ antialias: !this.opts.post, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.opts.pixelRatio);
    container.appendChild(this.renderer.domElement);
    this.post = new PostPass(1, 1);
    skin.environment(this.scene, palette);
    if (skin.ink !== undefined) this.post.uniforms.uInk.value.setHex(skin.ink);
    this.trackVisual = skin.track(sim.track, sim.seed);
    for (const c of this.trackVisual.chunks) this.scene.add(c);
    for (const e of this.trackVisual.extras) this.scene.add(e);
    this.scene.add(this.trackVisual.debug);
    this.scene.add(this.fx.points);
    this.worldVisual = skin.world(this.scene, sim);
    this.syncCars();
    this.resize();
    this.snapCamera();
  }

  /** Swaps in a rebuilt track (the editor after an edit). */
  setTrack(): void {
    for (const c of this.trackVisual.chunks) this.scene.remove(c);
    for (const e of this.trackVisual.extras) this.scene.remove(e);
    this.scene.remove(this.trackVisual.debug);
    this.trackVisual.dispose();
    this.trackVisual = this.skin.track(this.sim.track, this.sim.seed);
    for (const c of this.trackVisual.chunks) this.scene.add(c);
    for (const e of this.trackVisual.extras) this.scene.add(e);
    this.scene.add(this.trackVisual.debug);
  }

  set debug(on: boolean) {
    this.trackVisual.debug.visible = on;
  }

  get debug(): boolean {
    return this.trackVisual.debug.visible;
  }

  /** Creates visuals for cars added since the last call. */
  syncCars(): void {
    const cars = this.sim.cars;
    for (let i = this.visuals.length; i < cars.count; i++) {
      const v = this.skin.car(this.sim.classes[cars.cls[i]], this.paints[cars.paint[i] % this.paints.length]);
      this.scene.add(v.root);
      this.visuals.push(v);
      this.spin.push(0);
    }
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.setSize(Math.floor(w * this.opts.pixelRatio), Math.floor(h * this.opts.pixelRatio), 1.5 * this.opts.pixelRatio);
  }

  snapCamera(): void {
    const c = this.sim.cars;
    const i = this.focus;
    this.camHeading = c.h[i];
    this.camPos.set(c.x[i] - Math.sin(c.h[i]) * 8, c.y[i] + 2.7, c.z[i] - Math.cos(c.h[i]) * 8);
    this.camera.position.copy(this.camPos);
  }

  /** Draws one frame. `alpha` is how far between the last two ticks we are; `dt` real seconds since the last frame. */
  frame(alpha: number, dt: number, steer: number[], braking: boolean[]): void {
    this.time += dt;
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
    this.cursor = this.sim.events.read(this.cursor, this.onEvent);
    this.syncCars();
    const cars = this.sim.cars;
    for (let i = 0; i < cars.count; i++) {
      const v = this.visuals[i];
      if (!cars.active[i]) {
        v.root.visible = false;
        continue;
      }
      v.root.visible = true;
      const x = cars.px[i] + (cars.x[i] - cars.px[i]) * alpha;
      const y = cars.py[i] + (cars.y[i] - cars.py[i]) * alpha;
      const z = cars.pz[i] + (cars.z[i] - cars.pz[i]) * alpha;
      const h = cars.ph[i] + wrapAngle(cars.h[i] - cars.ph[i]) * alpha;
      const pitch = cars.ppitch[i] + (cars.pitch[i] - cars.ppitch[i]) * alpha + cars.prx[i] + (cars.rx[i] - cars.prx[i]) * alpha;
      const roll = cars.proll[i] + (cars.roll[i] - cars.proll[i]) * alpha + cars.prz[i] + (cars.rz[i] - cars.prz[i]) * alpha;
      v.root.position.set(x, y, z);
      v.root.rotation.set(pitch, h, roll, 'YXZ');
      const speed = Math.hypot(cars.vx[i], cars.vz[i]);
      const fwd = cars.vx[i] * Math.sin(cars.h[i]) + cars.vz[i] * Math.cos(cars.h[i]);
      this.spin[i] += (fwd / 0.38) * dt * this.sim.timeScale;
      v.update(this.spin[i], steer[i] ?? 0, braking[i] ?? false, cars.boosting[i] === 1 || cars.miniT[i] > 0, cars.grounded[i] === 1 && !cars.wreck[i]);
      // Ghosted after a respawn: blink.
      if (cars.ghostT[i] > 0) v.root.visible = Math.floor(this.time * 12) % 2 === 0;
      this.carParticles(i, x, y, z, h, speed, dt);
    }
    this.fx.update(dt * this.sim.timeScale);
    this.updateCamera(dt);
    this.worldVisual.update(dt * this.sim.timeScale, this.camera.position);
    this.skin.update?.(this.time, this.camera.position.x, this.camera.position.y, this.camera.position.z, this.sim.wetness);

    const u = this.post.uniforms;
    const fs = this.focusSpeed();
    u.uTime.value = this.time;
    u.uSpeed.value = clamp((fs - 20) / 50, 0, 1);
    u.uBoost.value = this.boostVis;
    u.uImpact.value = this.impact;
    u.uSlow.value = clamp((1 - this.sim.timeScale) / 0.7, 0, 1);
    u.uOutline.value = this.opts.outline ? 1 : 0;
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    const fog = this.scene.fog as Fog | null;
    if (fog) {
      u.uFogNear.value = fog.near;
      u.uFogFar.value = fog.far;
    }
    this.impact *= Math.exp(-dt * 4);
    if (this.opts.post) {
      this.renderer.setRenderTarget(this.post.target);
      this.renderer.render(this.scene, this.camera);
      this.drawCalls = this.renderer.info.render.calls;
      this.post.render(this.renderer);
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
      this.drawCalls = this.renderer.info.render.calls;
    }
  }

  private focusSpeed(): number {
    const c = this.sim.cars;
    return Math.hypot(c.vx[this.focus], c.vz[this.focus]);
  }

  private updateCamera(dt: number): void {
    const c = this.sim.cars;
    const i = this.focus;
    const car = this.visuals[i].root.position;
    const speed = this.focusSpeed();
    const boosting = c.boosting[i] === 1 || c.miniT[i] > 0;
    this.boostVis += ((boosting ? 1 : 0) - this.boostVis) * damp(5, dt);
    const cam = this.camera;
    if (c.wreck[i]) {
      if (!this.lastWreck) this.orbit = c.h[i] + Math.PI * 0.6;
      this.orbit += dt * 0.7;
      cam.position.set(car.x + Math.sin(this.orbit) * 10, car.y + 3.5, car.z + Math.cos(this.orbit) * 10);
      this.look.copy(car);
      this.camPos.copy(cam.position);
      this.camHeading = c.h[i];
    } else {
      // Follow where the car is going more than where it points, so a drift reads as a drift.
      const vdir = speed > 3 ? Math.atan2(c.vx[i], c.vz[i]) : c.h[i];
      const want = c.h[i] + wrapAngle(vdir - c.h[i]) * 0.55;
      this.camHeading += wrapAngle(want - this.camHeading) * damp(6, dt);
      const fx = Math.sin(this.camHeading);
      const fz = Math.cos(this.camHeading);
      if (this.lookBack) {
        cam.position.set(car.x + fx * 5, car.y + 2.4, car.z + fz * 5);
        this.look.set(car.x - fx * 20, car.y + 1, car.z - fz * 20);
      } else {
        const dist = 7.2 + this.boostVis * 1.6 + speed * 0.015;
        const tx = car.x - fx * dist;
        const tz = car.z - fz * dist;
        const ty = car.y + 2.7 - this.boostVis * 0.3;
        const k = damp(10, dt);
        this.camPos.x += (tx - this.camPos.x) * k;
        this.camPos.z += (tz - this.camPos.z) * k;
        this.camPos.y += (ty - this.camPos.y) * damp(5, dt);
        cam.position.copy(this.camPos);
        this.look.set(car.x + fx * 12, car.y + 1.1, car.z + fz * 12);
      }
    }
    this.lastWreck = c.wreck[i] === 1;
    cam.position.x += (Math.random() - 0.5) * this.shake;
    cam.position.y += (Math.random() - 0.5) * this.shake * 0.6;
    this.shake *= Math.exp(-dt * 6);
    cam.lookAt(this.look);
    const fov = 62 + clamp((speed - 20) / 50, 0, 1) * 12 + this.boostVis * 12;
    cam.fov += (fov - cam.fov) * damp(3, dt);
    cam.updateProjectionMatrix();
  }

  private carParticles(i: number, x: number, y: number, z: number, h: number, speed: number, dt: number): void {
    const c = this.sim.cars;
    if (c.wreck[i]) {
      if (Math.random() < dt * 20) this.fx.emit(x, y + 0.6, z, (Math.random() - 0.5) * 2, 2, (Math.random() - 0.5) * 2, 1.2, 0x554466, -1, 1);
      return;
    }
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const rx = -fz;
    const rz = fx;
    const cls = this.sim.classes[c.cls[i]];
    const back = cls.size[1] - 0.6;
    if (c.drift[i] && c.grounded[i]) {
      const stage = c.driftStage[i];
      for (const s of [-1, 1]) {
        const wx = x - fx * back + rx * s * cls.size[0];
        const wz = z - fz * back + rz * s * cls.size[0];
        if (Math.random() < dt * 40) this.fx.emit(wx, y + 0.3, wz, (Math.random() - 0.5) * 2, 1.2, (Math.random() - 0.5) * 2, 0.9, 0x6a6080, -2, 2);
        if (stage > 0 && Math.random() < dt * 60) {
          this.fx.emit(wx, y + 0.15, wz, (Math.random() - 0.5) * 5 - fx * 3, Math.random() * 3, (Math.random() - 0.5) * 5 - fz * 3, 0.25, STAGE_COLORS[stage], 20, 1);
        }
      }
    }
    if (c.boosting[i] || c.miniT[i] > 0) {
      const color = c.miniT[i] > 0 ? STAGE_COLORS[c.miniStage[i]] : Math.random() < 0.5 ? 0xff7a1a : 0x35f0ff;
      for (let k = 0; k < 2; k++) {
        const s = k ? -0.4 : 0.4;
        this.fx.emit(x - fx * (back + 0.5) + rx * s, y + 0.55, z - fz * (back + 0.5) + rz * s, -fx * speed * 0.3 + (Math.random() - 0.5), Math.random(), -fz * speed * 0.3 + (Math.random() - 0.5), 0.15 + Math.random() * 0.1, color, 0, 0);
      }
    }
  }

  private readonly onEvent = (e: GameEvent): void => {
    const mine = e.car === this.focus || e.other === this.focus;
    switch (e.type) {
      case Ev.WallHit:
        this.fx.burst(e.x, e.y, e.z, Math.min(30, 4 + e.a * 1.5), 5 + e.a * 0.2, 0xffa040);
        if (mine) {
          this.shake = Math.max(this.shake, Math.min(1, e.a / 20));
          this.impact = Math.max(this.impact, Math.min(0.5, e.a / 40));
        }
        break;
      case Ev.CarContact:
        this.fx.burst(e.x, e.y, e.z, Math.min(40, 6 + e.a * 2), 6 + e.a * 0.2, 0xffc060);
        if (mine) this.shake = Math.max(this.shake, Math.min(1, e.a / 15));
        break;
      case Ev.Wreck:
        this.fx.burst(e.x, e.y + 0.8, e.z, 80, 11, 0xffa040);
        this.fx.burst(e.x, e.y + 1, e.z, 40, 8, 0x9ff3ff);
        if (mine) {
          this.impact = 1;
          this.shake = 1;
        }
        break;
      case Ev.Land:
        if (e.a > 0.4) this.fx.burst(e.x, e.y + 0.2, e.z, 20, 4, 0xbba4d8);
        if (mine && e.b > 6) this.shake = Math.max(this.shake, Math.min(0.6, e.b / 25));
        break;
      case Ev.MiniTurbo:
        this.fx.burst(e.x, e.y + 0.5, e.z, 30, 7, STAGE_COLORS[e.b]);
        if (mine) this.impact = Math.max(this.impact, 0.15 * e.b);
        break;
      case Ev.DriftStage:
        this.fx.burst(e.x, e.y + 0.3, e.z, 12, 4, STAGE_COLORS[e.b]);
        break;
      case Ev.Respawn:
        if (e.car === this.focus) this.snapCamera();
        break;
    }
  };
}
