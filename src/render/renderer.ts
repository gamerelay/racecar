// Draws the sim: car visuals interpolated between the last two ticks, the chase camera (speed FOV,
// boost pull-back, shake, look-back, wreck orbit), particles from the event queue, and the post
// pass. Reads core state; never writes it.

import { type Fog, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import type { PaintDef } from '../core/content';
import { Cause, Ev, type GameEvent } from '../core/events';
import { clamp, damp, wrapAngle } from '../core/math';
import type { Sim } from '../core/sim';
import { newHit, project, sampleAt } from '../core/track/query';
import { Particles } from './fx';
import { chaseOffset, GROUND_CLEAR, lookBackOffset, slopeRise, slopeView, type ChaseOffset } from './camera';
import { InkPass } from './ink';
import { PostPass } from './post';
import { Showroom } from './showroom';
import type { CarPlate, CarVisual, SceneLive, Skin, TrackVisual, WorldVisual } from './skin';
import { positions } from '../core/rules/progress';
import { SMASH_IDS } from '../core/world/smash';
import { Skids } from './skids';

const STAGE_COLORS = [0xffffff, 0x35a8ff, 0xff8a1a, 0xff2e88];
/** How many particles to emit this frame for `rate` a second: whole ones, and the fraction by chance (so it holds at any frame rate). */
const emits = (rate: number, dt: number): number => {
  const n = rate * dt;
  return Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
};
/** Cars further from the camera than this (m) make no particles (they're in the fog, and would crowd out the near ones). */
const FX_RANGE = 400;
/** Skid marks: how far from the camera cars lay them (m), how wide, and the tint each multiplies the ground by. */
const SKID_RANGE = 220;
const SKID_WIDTH = 0.4;
const SKID_ROAD = [0.3, 0.28, 0.34] as const;
const SKID_DIRT = [0.55, 0.42, 0.3] as const;
const SKID_GRASS = [0.5, 0.62, 0.36] as const;
/**
 * Tracks in snow (docs/AVALANCHE.md): every wheel on a snow surface leaves one, not just a slide,
 * and they last the whole run: faint and narrow on the groomed piste, deep and wide in powder.
 */
const TRACK_SEGMENTS = 24000;
const TRACK_LIFE = 900;
const TRACK_STEP = 1.2;
const TRACK_GROOMED = [0.8, 0.85, 0.94] as const;
const TRACK_POWDER = [0.6, 0.68, 0.84] as const;

export interface RenderOptions {
  post: boolean;
  /** Ink outlines (in the post pass). */
  outline: boolean;
  pixelRatio: number;
  /** Each car's license plate, by car index (none: blank plates). */
  plates?: (CarPlate | undefined)[];
}

/** A smashed prop's burst, in its colour. */
const SMASH_BURST: Record<string, number> = { cone: 0xff7a1a, 'newspaper-box': 0x3a86ff, 'hay-bale': 0xe2c36a, mailbox: 0xb8bcc4, 'beach-umbrella': 0xff2e88, 'fruit-stand': 0xffd23f };

/** What a ground throws up under a car: per meter per second of speed, a puff on running onto it, how it flies. */
interface Dust {
  rate: number;
  puff: number;
  colors: number[];
  /** Thrown back at this fraction of the car's speed, and this much sideways. */
  kick: number;
  spread: number;
  y: number;
  /** Up: at least [0], plus up to [1] more. Likewise its life (s). */
  up: [number, number];
  life: [number, number];
  gravity: number;
  drag: number;
  /** Only in a slide or a drift (groomed snow: on the road, a carve throws it up, cruising doesn't). */
  sliding?: boolean;
}
const DUST: Record<string, Dust> = {
  // A low cloud that hangs behind.
  dirt: { rate: 0.55, puff: 6, colors: [0xb39670, 0x9c7f5a], kick: 0.08, spread: 2.5, y: 0.35, up: [0.6, 1.4], life: [1.2, 0.8], gravity: -1.2, drag: 2.2 },
  'red-earth': { rate: 0.55, puff: 6, colors: [0xa0704c, 0x8a5f40, 0xb8865c], kick: 0.08, spread: 2.5, y: 0.35, up: [0.6, 1.4], life: [1.2, 0.8], gravity: -1.2, drag: 2.2 },
  // Clods and leaves, thrown up and falling back.
  grass: { rate: 0.25, puff: 8, colors: [0x4d6a2e], kick: 0.2, spread: 2, y: 0.2, up: [2, 2], life: [0.5, 0], gravity: 22, drag: 0.5 },
  undergrowth: { rate: 0.32, puff: 10, colors: [0x4d6a2e, 0x6a8a34, 0x5a4630], kick: 0.2, spread: 2.5, y: 0.25, up: [2, 2.5], life: [0.55, 0.25], gravity: 20, drag: 0.6 },
  // A spray of sand, kicked high, that falls fast; a little haze with it.
  sand: { rate: 0.6, puff: 14, colors: [0xe8d8a8, 0xd8c08a, 0xf2e6c4], kick: 0.18, spread: 3, y: 0.25, up: [2.2, 2.6], life: [0.55, 0.35], gravity: 16, drag: 0.9 },
  beach: { rate: 0.5, puff: 14, colors: [0xe8d8a8, 0xd8c08a, 0xf2e6c4], kick: 0.18, spread: 3, y: 0.25, up: [2.2, 2.6], life: [0.55, 0.35], gravity: 16, drag: 0.9 },
  shore: { rate: 0.6, puff: 14, colors: [0xcfe4e8, 0xe8d8a8], kick: 0.2, spread: 3, y: 0.2, up: [2.6, 2.4], life: [0.45, 0.3], gravity: 18, drag: 0.8 },
  // Ash: a grey haze that rises a little and lingers.
  ash: { rate: 0.5, puff: 10, colors: [0x8a8288, 0x6f686e], kick: 0.06, spread: 3, y: 0.4, up: [0.8, 1.4], life: [1.6, 1], gravity: -0.8, drag: 2.4 },
  // Powder: a big white spray, thrown high, falling slowly, a fine mist with it. Groomed snow: a
  // smaller one off a carve.
  powder: { rate: 0.9, puff: 22, colors: [0xffffff, 0xf2f7fc, 0xdde8f4], kick: 0.22, spread: 4, y: 0.3, up: [2.6, 3.2], life: [0.7, 0.6], gravity: 7, drag: 1.4 },
  snow: { rate: 0.45, puff: 0, colors: [0xffffff, 0xe6eef7], kick: 0.16, spread: 3, y: 0.2, up: [1.6, 2], life: [0.5, 0.4], gravity: 9, drag: 1.6, sliding: true },
};

export class GameRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(62, 1, 0.1, 3000);
  private readonly post: PostPass;
  private readonly ink = new InkPass(1, 1);
  private readonly fx = new Particles();
  private readonly skids = new Skids();
  /** Tracks in snow, made the first time a map has snow to leave them in (they're a big ring). */
  private snowTracks: Skids | null = null;
  private readonly skidHit = newHit();
  private readonly scenicHit = newHit();
  /** Where the car select's camera is along the lap (m). */
  private scenicS = -1;
  private readonly visuals: CarVisual[] = [];
  private readonly spin: number[] = [];
  /** Each car's surface last frame (a puff of dust as it runs off the road). */
  private readonly lastSurface: number[] = [];
  private trackVisual: TrackVisual;
  private worldVisual: WorldVisual;
  private cursor = 0;
  /** Real seconds (post effects, blinking), and world seconds (scenery): slowed in slow-mo, stopped when paused. */
  private time = 0;
  private worldTime = 0;
  /** What of the race the scenery shows, refreshed each frame. */
  private readonly live: SceneLive = { raceTime: 0, leader: null, wetness: 0 };
  private readonly order: number[] = [];
  private shake = 0;
  private impact = 0;
  private boostVis = 0;
  private camHeading = 0;
  private camPos = new Vector3();
  /** On open ground: the ground ahead's height over the ground under the focus car, smoothed (camera.ts slopeView). */
  private slopeRise = 0;
  private readonly offset: ChaseOffset = { dist: 0, height: 0, ahead: 0, lookUp: 0 };
  /** Paused: the camera still settles, but nothing in the world moves (smoke, wheels, debris). */
  paused = false;
  /** Smoothed distance behind the car (the camera follows in the car's frame, so speed doesn't stretch it). */
  private camDist = 4.7;
  private look = new Vector3();
  private orbit = 0;
  private lastWreck = false;
  opts: RenderOptions;
  focus = 0;
  lookBack = false;
  /** Dev: leave the camera where it was put (fly-overs, screenshots). */
  freeCamera = false;
  /** The car select's turntable, drawn over the world while it's visible (the lobby). */
  readonly showroom: Showroom;
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
    this.post.uniforms.tInk.value = this.ink.target.texture;
    this.post.uniforms.tInkDepth.value = this.ink.target.depthTexture;
    skin.environment(this.scene, palette);
    this.applyLook();
    this.trackVisual = skin.track(sim.track, sim.seed);
    for (const c of this.trackVisual.chunks) this.scene.add(c);
    for (const e of this.trackVisual.extras) this.scene.add(e);
    this.scene.add(this.trackVisual.debug);
    this.scene.add(this.fx.points);
    this.scene.add(this.skids.mesh);
    this.worldVisual = skin.world(this.scene, sim, this.trackVisual);
    this.showroom = new Showroom(skin);
    this.scene.add(this.showroom.root);
    this.syncCars();
    this.resize();
    this.snapCamera();
  }

  /** Swaps in a rebuilt track (the editor after an edit). */
  setTrack(): void {
    for (const c of this.trackVisual.chunks) this.scene.remove(c);
    for (const e of this.trackVisual.extras) this.scene.remove(e);
    this.scene.remove(this.trackVisual.debug);
    const debug = this.trackVisual.debug.visible;
    this.trackVisual.dispose();
    this.trackVisual = this.skin.track(this.sim.track, this.sim.seed);
    for (const c of this.trackVisual.chunks) this.scene.add(c);
    for (const e of this.trackVisual.extras) this.scene.add(e);
    this.trackVisual.debug.visible = debug;
    this.scene.add(this.trackVisual.debug);
    // Marks lie on the old road.
    this.skids.clear();
    this.snowTracks?.clear();
    // Gantries and the like are placed from the track, so the world visual is rebuilt too.
    this.worldVisual.dispose();
    this.worldVisual = this.skin.world(this.scene, this.sim, this.trackVisual);
  }

  /** Another map behind the menu: its sky and light, then its track (the sim has the new one already). */
  setMap(palette: string): void {
    this.skin.environment(this.scene, palette);
    this.applyLook();
    this.setTrack();
  }

  /** The skin's ink and grade for this map, into the post pass. */
  private applyLook(): void {
    const u = this.post.uniforms;
    if (this.skin.ink !== undefined) u.uInk.value.setHex(this.skin.ink);
    const g = this.skin.grade;
    u.uSat.value = g?.saturation ?? 1;
    u.uContrast.value = g?.contrast ?? 1;
    u.uShadow.value.setHex(g?.shadow ?? 0xffffff);
    u.uVignette.value = g?.vignette ?? 0.5;
  }

  /** New plates (another map prints another region on them): every car's visual is built again. */
  setPlates(plates: (CarPlate | undefined)[]): void {
    for (const v of this.visuals) {
      this.scene.remove(v.root);
      v.dispose();
    }
    this.visuals.length = 0;
    this.spin.length = 0;
    this.opts.plates = plates;
    this.syncCars();
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
      const v = this.skin.car(this.sim.classes[cars.cls[i]], this.paints[cars.paint[i] % this.paints.length], this.opts.plates?.[i]);
      this.scene.add(v.root);
      this.visuals.push(v);
      this.spin.push(0);
    }
  }

  /**
   * The Settings panel's graphics, at once: `resolution` is a share of the screen's own pixel
   * ratio (at most 2×). Antialiasing is fixed when the renderer is made (it's on only without the
   * post pass), so turning post effects off mid-race leaves it without until the next race.
   */
  setQuality(q: { resolution: number; post: boolean; outline: boolean }): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2) * q.resolution;
    this.opts.post = q.post;
    this.opts.outline = q.outline;
    if (ratio !== this.opts.pixelRatio) {
      this.opts.pixelRatio = ratio;
      this.renderer.setPixelRatio(ratio);
      this.resize();
    }
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.setSize(Math.floor(w * this.opts.pixelRatio), Math.floor(h * this.opts.pixelRatio), 1.5 * this.opts.pixelRatio);
    this.ink.setSize(Math.floor(w * this.opts.pixelRatio), Math.floor(h * this.opts.pixelRatio));
  }

  snapCamera(): void {
    if (this.freeCamera) return;
    const c = this.sim.cars;
    const i = this.focus;
    this.camHeading = c.h[i];
    // Where the chase camera settles for this car at rest (outside even the bus).
    const o = chaseOffset(this.sim.classes[c.cls[i]].size, 0, 0, this.offset);
    this.camDist = o.dist;
    this.camPos.set(c.x[i] - Math.sin(c.h[i]) * o.dist, c.y[i] + o.height, c.z[i] - Math.cos(c.h[i]) * o.dist);
    this.camera.position.copy(this.camPos);
  }

  /**
   * Back after a stretch it didn't see (an online race goes on in a hidden tab, and its events are
   * skipped: EventQueue.skip): a car wrecked then but on its wheels now is mended (its respawn went
   * by unseen). One wrecked now stays as it is, uncrumpled until its respawn.
   */
  catchUp(): void {
    for (let i = 0; i < this.visuals.length; i++) if (!this.sim.cars.wreck[i]) this.visuals[i]?.repair?.();
    this.snapCamera();
  }

  /** Draws one frame. `alpha` is how far between the last two ticks we are; `dt` real seconds since the last frame. */
  frame(alpha: number, dt: number, steer: number[], braking: boolean[]): void {
    this.time += dt;
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
    this.cursor = this.sim.events.read(this.cursor, this.onEvent);
    this.syncCars();
    const cars = this.sim.cars;
    // World time since the last frame: slowed in slow-mo, stopped while paused.
    const sdt = this.paused ? 0 : dt * this.sim.timeScale;
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
      this.spin[i] += (fwd / 0.38) * sdt;
      v.update(this.spin[i], steer[i] ?? 0, braking[i] ?? false, cars.boosting[i] === 1 || cars.miniT[i] > 0, cars.grounded[i] === 1 && !cars.wreck[i], sdt);
      // Ghosted after a respawn: blink.
      if (cars.ghostT[i] > 0) v.root.visible = Math.floor(this.time * 12) % 2 === 0;
      if (!this.paused) {
        if (Math.hypot(x - this.camera.position.x, z - this.camera.position.z) < FX_RANGE) this.carParticles(i, x, y, z, h, speed, dt);
        this.skidMarks(i, x, z, h, speed, fwd, braking[i] ?? false);
      }
    }
    this.fx.update(sdt);
    const haze = this.scene.fog as Fog | null;
    this.skids.update(sdt, haze?.near, haze?.far);
    this.snowTracks?.update(sdt, haze?.near, haze?.far);
    this.updateCamera(dt);
    // The turntable rides in front of the camera, so it's placed once the camera has moved.
    if (this.showroom.visible) {
      this.camera.updateMatrixWorld();
      this.showroom.update(dt, this.camera);
    } else this.showroom.hide();
    // The world is drawn at the same moment as the cars: between the last two ticks.
    this.worldVisual.update(sdt, this.camera.position, this.sim.time - (1 - alpha) * this.sim.dt * this.sim.timeScale);
    // Scenery (the city's cars, searchlights, birds, smoke) runs on world time: it stops when
    // paused and slows in slow-mo, like everything else in the world.
    this.worldTime += sdt;
    const race = this.sim.race;
    this.live.raceTime = race.phase === 'racing' ? Math.max(0, this.sim.time - race.goTime) : 0;
    this.live.leader = this.opts.plates?.[positions(this.sim, this.order)[0]]?.text ?? null;
    this.live.wetness = this.sim.wetness;
    this.trackVisual.update?.(this.worldTime, sdt, this.camera.position, this.live);
    this.skin.update?.(this.worldTime, this.camera.position.x, this.camera.position.y, this.camera.position.z, this.sim.wetness, this.sim.snowing);

    const stage = this.showroom.visible ? this.showroom : null;
    if (stage) {
      // Behind the car select the world stays calm: no speed blur, boost, flash or slow-mo grade.
      this.boostVis = this.impact = this.shake = 0;
    }
    const u = this.post.uniforms;
    const fs = stage ? 0 : this.focusSpeed();
    u.uTime.value = this.time;
    u.uSpeed.value = clamp((fs - 20) / 50, 0, 1);
    u.uBoost.value = this.boostVis;
    u.uImpact.value = this.impact;
    u.uSlow.value = stage ? 0 : clamp((1 - this.sim.timeScale) / 0.7, 0, 1);
    u.uOutline.value = this.opts.outline ? 1 : 0;
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    const fog = this.scene.fog as Fog | null;
    if (fog) {
      u.uFogNear.value = fog.near;
      u.uFogFar.value = fog.far;
      u.uSky.value.copy(fog.color);
    }
    // Snowfall doesn't wet the road (no sheen on the snow).
    u.uWet.value = this.sim.snowing ? 0 : this.sim.wetness;
    u.uWater.value = this.trackVisual.water ? 1 : 0;
    this.camera.updateMatrixWorld();
    u.uProj.value.copy(this.camera.projectionMatrix);
    u.uInvProj.value.copy(this.camera.projectionMatrixInverse);
    u.uView.value.copy(this.camera.matrixWorldInverse);
    this.impact *= Math.exp(-dt * 4);
    if (this.opts.post) {
      u.uCarInk.value = this.opts.outline ? 1 : 0;
      if (this.opts.outline) this.ink.render(this.renderer, this.scene, this.camera);
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
    if (this.freeCamera) return;
    if (this.showroom.visible) return this.scenicCamera(dt);
    this.scenicS = -1;
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
      const size = this.sim.classes[c.cls[i]].size;
      if (this.lookBack) {
        const o = lookBackOffset(size, this.offset);
        cam.position.set(car.x + fx * o.dist, car.y + o.height, car.z + fz * o.dist);
        this.look.set(car.x - fx * o.ahead, car.y + o.lookUp, car.z - fz * o.ahead);
      } else {
        const o = chaseOffset(size, speed, this.boostVis, this.offset);
        // Smooth the distance, not the world position: chasing a world point lags by about speed/rate
        // meters, which tugged the camera ~5 m back under acceleration. Heading smoothing above still
        // gives the swing through corners.
        this.camDist += (o.dist - this.camDist) * damp(4, dt);
        this.camPos.x = car.x - fx * this.camDist;
        this.camPos.z = car.z - fz * this.camDist;
        let height = o.height;
        let lookUp = o.lookUp;
        const ground = this.sim.track.ground;
        if (ground) {
          // The ground a look-distance and two ahead, against the ground under the car (not the car:
          // in the air off a kicker the view stays on the slope).
          const rise = slopeRise(ground, car.x, car.y, car.z, fx, fz, o.ahead);
          this.slopeRise += (rise - this.slopeRise) * damp(3, dt);
          const v = slopeView(this.slopeRise);
          height += v.lift;
          lookUp += v.look;
        }
        this.camPos.y += (car.y + height - this.camPos.y) * damp(5, dt);
        if (ground) this.camPos.y = Math.max(this.camPos.y, ground.top(this.camPos.x, this.camPos.z, this.camPos.y) + GROUND_CLEAR);
        cam.position.copy(this.camPos);
        this.look.set(car.x + fx * o.ahead, car.y + lookUp, car.z + fz * o.ahead);
      }
    }
    this.lastWreck = c.wreck[i] === 1;
    cam.position.x += (Math.random() - 0.5) * this.shake;
    cam.position.y += (Math.random() - 0.5) * this.shake * 0.6;
    this.shake *= Math.exp(-dt * 6);
    cam.lookAt(this.look);
    const fov = 60 + clamp((speed - 20) / 50, 0, 1) * 4 + this.boostVis * 3.5;
    cam.fov += (fov - cam.fov) * damp(3, dt);
    cam.updateProjectionMatrix();
  }

  /**
   * Behind the car select: a slow crane down the lap, over the left edge of the road and above
   * the traffic, so the racers and traffic pass under it rather than a chase camera filling the
   * screen. It starts behind the grid, looking up the straight.
   */
  private scenicCamera(dt: number): void {
    const main = this.sim.track.main;
    if (this.scenicS < 0) this.scenicS = main.length - 60;
    this.scenicS = (this.scenicS + dt * 6) % main.length;
    const a = sampleAt(main, this.scenicS, this.scenicHit);
    const lat = -(a.width / 2 - 1);
    const cam = this.camera;
    cam.position.set(a.cx - a.tz * lat, a.cy + 5.5, a.cz + a.tx * lat);
    const b = sampleAt(main, this.scenicS + 45, this.scenicHit);
    this.look.set(b.cx, b.cy + 1.5, b.cz);
    cam.lookAt(this.look);
    cam.fov = 60;
    cam.updateProjectionMatrix();
  }

  private carParticles(i: number, x: number, y: number, z: number, h: number, speed: number, dt: number): void {
    const c = this.sim.cars;
    if (c.wreck[i]) {
      for (let n = emits(20, dt); n > 0; n--) this.fx.emit(x, y + 0.6, z, (Math.random() - 0.5) * 2, 2, (Math.random() - 0.5) * 2, 1.2, 0x554466, -1, 1);
      return;
    }
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const rx = -fz;
    const rz = fx;
    const cls = this.sim.classes[c.cls[i]];
    const back = cls.size[1] - 0.6;
    // Off the asphalt: what the ground throws up (DUST: dust off dirt, a spray of sand, leaves and
    // clods, a haze of ash), thicker in a slide, and a puff the moment you run off the road.
    const surf = this.sim.surfaces[c.surface[i]];
    const was = this.lastSurface[i];
    this.lastSurface[i] = c.surface[i];
    const d = surf && (DUST[surf.id] ?? (surf.offroad ? DUST.dirt : undefined));
    const sliding = c.drift[i] === 1 || Math.abs(c.slip[i]) > 0.15;
    if (d && (!d.sliding || sliding) && c.grounded[i] && speed > 6) {
      const ranOff = was !== undefined && was !== c.surface[i] && !this.sim.surfaces[was]?.offroad && speed > 14;
      const rate = d.rate * speed * (sliding ? 2.2 : 1);
      for (let s = -1; s <= 1; s += 2) {
        const n = emits(rate, dt) + (ranOff ? Math.round(d.puff * Math.min(1.6, speed / 25)) : 0);
        if (!n) continue;
        const wx = x - fx * back + rx * s * cls.size[0];
        const wz = z - fz * back + rz * s * cls.size[0];
        const kick = speed * d.kick;
        for (let e = 0; e < n; e++) {
          const color = d.colors[Math.floor(Math.random() * d.colors.length)];
          this.fx.emit(wx, y + d.y, wz, -fx * kick + (Math.random() - 0.5) * d.spread, d.up[0] + Math.random() * d.up[1], -fz * kick + (Math.random() - 0.5) * d.spread, d.life[0] + Math.random() * d.life[1], color, d.gravity, d.drag);
        }
      }
    }
    // Tire smoke while drifting, and while the slide carries on after it.
    if ((c.drift[i] || (c.driftExit[i] > 0 && Math.abs(c.slip[i]) > 0.15)) && c.grounded[i]) {
      const stage = c.driftStage[i];
      for (let s = -1; s <= 1; s += 2) {
        const wx = x - fx * back + rx * s * cls.size[0];
        const wz = z - fz * back + rz * s * cls.size[0];
        for (let n = emits(40, dt); n > 0; n--) this.fx.emit(wx, y + 0.3, wz, (Math.random() - 0.5) * 2, 1.2, (Math.random() - 0.5) * 2, 0.9, 0x6a6080, -2, 2);
        for (let n = stage > 0 ? emits(60, dt) : 0; n > 0; n--) {
          this.fx.emit(wx, y + 0.15, wz, (Math.random() - 0.5) * 5 - fx * 3, Math.random() * 3, (Math.random() - 0.5) * 5 - fz * 3, 0.25, STAGE_COLORS[stage], 20, 1);
        }
      }
    }
    if (c.boosting[i] || c.miniT[i] > 0) {
      const color = c.miniT[i] > 0 ? STAGE_COLORS[c.miniStage[i]] : Math.random() < 0.5 ? 0xff7a1a : 0x35f0ff;
      for (let k = 0; k < 2; k++) {
        // About 60 a second from each pipe, whatever the frame rate.
        const s = k ? -0.4 : 0.4;
        for (let n = emits(60, dt); n > 0; n--)
          this.fx.emit(x - fx * (back + 0.5) + rx * s, y + 0.55, z - fz * (back + 0.5) + rz * s, -fx * speed * 0.3 + (Math.random() - 0.5), Math.random(), -fz * speed * 0.3 + (Math.random() - 0.5), 0.15 + Math.random() * 0.1, color, 0, 0);
      }
    }
  }

  /**
   * Rubber under the rear wheels while the car slides (a drift, the slide out of one, a spin) or
   * brakes hard: dark on asphalt, churned on dirt and grass, none in water or the air. Cars near
   * the camera only, so the ring holds the marks that can be seen.
   */
  private skidMarks(i: number, x: number, z: number, h: number, speed: number, fwd: number, braking: boolean): void {
    const c = this.sim.cars;
    const slip = Math.abs(c.slip[i]);
    const sliding = c.drift[i] === 1 || c.spinT[i] > 0 || (c.driftExit[i] > 0 && slip > 0.12) || slip > 0.3;
    const stopping = braking && fwd > 18;
    const surf = this.sim.surfaces[c.surface[i]];
    const near = Math.hypot(x - this.camera.position.x, z - this.camera.position.z) < SKID_RANGE;
    const down = near && c.grounded[i] === 1 && !c.wreck[i] && speed > 4;
    // In snow, tracks instead of rubber: always, deeper in a slide.
    const snow = !!surf?.slide;
    if (snow || this.snowTracks) this.snowMarks(i, x, z, h, down && snow, surf?.offroad ? 1 : 0, sliding);
    const on = down && !snow && (sliding || stopping) && surf?.id !== 'puddle';
    const cls = this.sim.classes[c.cls[i]];
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const back = cls.size[1] - 0.6;
    const [r, g, b] = surf?.id === 'grass' ? SKID_GRASS : surf?.offroad ? SKID_DIRT : SKID_ROAD;
    const alpha = sliding ? clamp(0.35 + slip * 0.8, 0.4, 0.8) : 0.35;
    for (let side = -1; side <= 1; side += 2) {
      const key = i * 2 + (side > 0 ? 1 : 0);
      if (!on) {
        this.skids.lift(key);
        continue;
      }
      const lat = side * (cls.size[0] - 0.2);
      const wx = x - fx * back - fz * lat;
      const wz = z - fz * back + fx * lat;
      // On the road's surface under the wheel (banked, ramped), not the car's middle.
      project(this.sim.track.splines[c.spline[i]], wx, wz, c.s[i], this.skidHit);
      this.skids.mark(key, wx, this.skidHit.ground, wz, SKID_WIDTH, r, g, b, alpha);
    }
  }

  /** Car `i`'s rear wheels' tracks in snow while `on`: `deep` 1 in powder, 0 on the groomed piste. */
  private snowMarks(i: number, x: number, z: number, h: number, on: boolean, deep: number, sliding: boolean): void {
    if (!this.snowTracks) {
      if (!on) return;
      this.snowTracks = new Skids(TRACK_SEGMENTS, TRACK_LIFE, TRACK_STEP);
      this.scene.add(this.snowTracks.mesh);
    }
    const tracks = this.snowTracks;
    const c = this.sim.cars;
    const cls = this.sim.classes[c.cls[i]];
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const back = cls.size[1] - 0.6;
    const [r, g, b] = deep ? TRACK_POWDER : TRACK_GROOMED;
    const alpha = (deep ? 0.7 : 0.45) + (sliding ? 0.2 : 0);
    for (let side = -1; side <= 1; side += 2) {
      const key = i * 2 + (side > 0 ? 1 : 0);
      if (!on) {
        tracks.lift(key);
        continue;
      }
      const lat = side * (cls.size[0] - 0.2);
      const wx = x - fx * back - fz * lat;
      const wz = z - fz * back + fx * lat;
      project(this.sim.track.splines[c.spline[i]], wx, wz, c.s[i], this.skidHit);
      tracks.mark(key, wx, this.skidHit.ground, wz, deep ? 0.6 : 0.45, r, g, b, alpha);
    }
  }

  /** Tells the car's visual where it was hit: toward the other car, or the nose for walls and the like. */
  private wreckVisual(e: GameEvent): void {
    const v = this.visuals[e.car];
    if (!v?.wreck || e.b === Cause.Reset) return;
    const c = this.sim.cars;
    const h = c.h[e.car];
    let dx = 0;
    let dz = 1;
    if (e.b === Cause.Car && e.other >= 0 && e.other < c.count) {
      const wx = c.x[e.other] - c.x[e.car];
      const wz = c.z[e.other] - c.z[e.car];
      dx = wx * Math.cos(h) - wz * Math.sin(h);
      dz = wx * Math.sin(h) + wz * Math.cos(h);
    } else {
      // Mostly the nose, pulled toward the side the car was sliding to.
      const lx = c.vx[e.car] * Math.cos(h) - c.vz[e.car] * Math.sin(h);
      dx = clamp(lx / 15, -0.7, 0.7);
    }
    v.wreck(dx, dz, clamp(0.35 + e.a / 25, 0.35, 1));
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
      case Ev.Smash:
        this.fx.burst(e.x, e.y, e.z, 28, 5 + Math.min(8, e.a * 0.12), SMASH_BURST[SMASH_IDS[e.b]] ?? 0xffffff);
        if (mine) this.shake = Math.max(this.shake, 0.12);
        break;
      case Ev.CarContact:
        this.fx.burst(e.x, e.y, e.z, Math.min(40, 6 + e.a * 2), 6 + e.a * 0.2, 0xffc060);
        if (mine) this.shake = Math.max(this.shake, Math.min(1, e.a / 15));
        break;
      case Ev.Wreck:
        this.wreckVisual(e);
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
        this.visuals[e.car]?.repair?.();
        if (e.car === this.focus) this.snapCamera();
        break;
    }
  };
}
