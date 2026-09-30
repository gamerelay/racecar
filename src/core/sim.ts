// The tick pipeline (SPEC §3). One `step` runs every system in the table's order at a fixed 60 Hz.
// Milestone 1 has: clock, own/AI cars, broadphase, collisions, rules. Weather, traffic and hazards
// slot in at their rows in milestone 2.

import { driveFollow, type FollowDriver } from './ai/follow';
import { stepCar } from './car/physics';
import { createCarPool, restoreCars, snapshotCars, type CarPool } from './car/pool';
import { TUNING } from './car/tuning';
import { collideCars } from './collide/cars';
import { SpatialGrid } from './collide/grid';
import { collideWalls } from './collide/walls';
import type { CarClass, SurfaceDef } from './content';
import { neutralControls, type Controls } from './controls';
import { EventQueue } from './events';
import { damp } from './math';
import { Rng } from './rng';
import { updateProgress } from './rules/progress';
import type { SimState } from './state';
import type { Track } from './track/bake';
import { newHit, projectGlobal, sampleAt } from './track/query';

export const TICK_RATE = 60;
export const MAX_CARS = 16;

export interface SimOptions {
  seed: number;
  slowmo?: 'world' | 'wreck';
}

export interface CarSpec {
  cls: string;
  paint?: number;
  human?: boolean;
  /** A lane-following driver (pace car). Humans leave this out. */
  follow?: FollowDriver;
}

export class Sim implements SimState {
  track: Track;
  readonly cars: CarPool;
  readonly classes: CarClass[];
  readonly surfaces: SurfaceDef[];
  readonly events = new EventQueue(2048);
  readonly dt = 1 / TICK_RATE;
  readonly slowmo: 'world' | 'wreck';
  readonly seed: number;
  readonly rng: Rng;
  readonly hitA = newHit();
  readonly hitB = newHit();
  readonly shoulderSurface: number;
  readonly drivers: (FollowDriver | null)[] = [];
  readonly controls: Controls[];
  tick = 0;
  timeScale = 1;
  weatherGrip = 1;
  wet = false;
  private readonly grid = new SpatialGrid(16, 1024, MAX_CARS);
  private readonly isActive = (i: number) => this.cars.active[i] === 1;

  constructor(track: Track, classes: CarClass[], surfaces: SurfaceDef[], opts: SimOptions) {
    this.track = track;
    this.classes = classes;
    this.surfaces = surfaces;
    this.cars = createCarPool(MAX_CARS);
    this.seed = opts.seed >>> 0;
    this.rng = Rng.stream(this.seed, 'sim');
    this.slowmo = opts.slowmo ?? 'world';
    this.shoulderSurface = track.surfaceIndex.get('sidewalk') ?? 0;
    this.controls = Array.from({ length: MAX_CARS }, neutralControls);
  }

  /** Adds a car on the start grid (2 wide, 8 m rows, behind the line) and returns its index. */
  addCar(spec: CarSpec): number {
    const i = this.cars.count++;
    const cls = this.classes.findIndex((c) => c.id === spec.cls);
    if (cls < 0) throw new Error(`unknown car class ${spec.cls}`);
    const c = this.cars;
    c.active[i] = 1;
    c.cls[i] = cls;
    c.paint[i] = spec.paint ?? i;
    c.human[i] = spec.human ? 1 : 0;
    this.drivers[i] = spec.follow ?? null;
    const row = Math.floor(i / 2);
    const col = i % 2 === 0 ? -1 : 1;
    const main = this.track.main;
    const at = sampleAt(main, main.length - 10 - row * 9, this.hitA);
    // Everyone starts in a grid slot; pace cars merge into their lane once moving.
    const lat = col * at.width * 0.22;
    this.placeCar(i, 0, at.s, lat);
    c.lap[i] = 0;
    c.nextCp[i] = 0;
    c.progress[i] = at.s - main.length;
    c.lapStartTick[i] = this.tick;
    c.boost[i] = 0.3;
    return i;
  }

  /** Swaps in a rebaked track (the editor) and finds every car on it again. */
  setTrack(track: Track): void {
    this.track = track;
    const c = this.cars;
    for (let i = 0; i < c.count; i++) {
      c.spline[i] = 0;
      projectGlobal(track.main, c.x[i], c.z[i], this.hitA);
      c.s[i] = this.hitA.s;
      c.lastSpline[i] = 0;
      c.lastS[i] = this.hitA.s;
      c.lastLat[i] = 0;
    }
  }

  /** Puts car i on a spline at (s, lateral), facing along it, stopped. */
  placeCar(i: number, spline: number, s: number, lateral: number, speed = 0): void {
    const c = this.cars;
    const at = sampleAt(this.track.splines[spline], s, this.hitA);
    c.x[i] = at.cx - at.tz * lateral;
    c.z[i] = at.cz + at.tx * lateral;
    c.y[i] = at.cy;
    c.h[i] = Math.atan2(at.tx, at.tz);
    c.vx[i] = at.tx * speed;
    c.vz[i] = at.tz * speed;
    c.vy[i] = 0;
    c.yaw[i] = 0;
    c.grounded[i] = 1;
    c.wreck[i] = 0;
    c.drift[i] = 0;
    c.spline[i] = spline;
    c.s[i] = at.s;
    c.lastSpline[i] = spline;
    c.lastS[i] = at.s;
    c.lastLat[i] = lateral;
    c.px[i] = c.x[i];
    c.py[i] = c.y[i];
    c.pz[i] = c.z[i];
    c.ph[i] = c.h[i];
  }

  /** One fixed step. `input[i]` drives car i (humans); drivers fill in the rest. */
  step(input: readonly (Controls | undefined)[]): void {
    const dt = this.dt * this.timeScale;
    const cars = this.cars;
    // Systems 7–8: own and AI cars.
    for (let i = 0; i < cars.count; i++) {
      if (!cars.active[i]) continue;
      const d = this.drivers[i];
      const c = d ? driveFollow(this, i, d, this.controls[i]) : (input[i] ?? this.controls[i]);
      stepCar(this, i, c, dt);
    }
    // Systems 10–11: broadphase and collisions.
    this.grid.rebuild(cars.count, cars.x, cars.z, this.isActive);
    for (let i = 0; i < cars.count; i++) if (cars.active[i]) collideWalls(this, i);
    collideCars(this, this.grid);
    // System 12: rules.
    for (let i = 0; i < cars.count; i++) if (cars.active[i]) updateProgress(this, i);
    // Single-player slow-mo: a human's fresh wreck slows the world.
    if (this.slowmo === 'world') {
      let slow = false;
      for (let i = 0; i < cars.count; i++) if (cars.human[i] && cars.wreck[i] && cars.wreckT[i] < TUNING.wreckSlowTime * TUNING.wreckSlowScale) slow = true;
      const target = slow ? TUNING.wreckSlowScale : 1;
      this.timeScale += (target - this.timeScale) * damp(slow ? 30 : 6, this.dt);
    }
    this.tick++;
  }

  snapshot(): SimSnapshot {
    return {
      tick: this.tick,
      timeScale: this.timeScale,
      rng: this.rng.state,
      weatherGrip: this.weatherGrip,
      wet: this.wet,
      cars: snapshotCars(this.cars),
    };
  }

  restore(s: SimSnapshot): void {
    this.tick = s.tick;
    this.timeScale = s.timeScale;
    this.rng.state = s.rng;
    this.weatherGrip = s.weatherGrip;
    this.wet = s.wet;
    restoreCars(this.cars, s.cars);
  }
}

export interface SimSnapshot {
  tick: number;
  timeScale: number;
  rng: number;
  weatherGrip: number;
  wet: boolean;
  cars: ReturnType<typeof snapshotCars>;
}
