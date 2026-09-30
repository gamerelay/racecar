// The tick pipeline (SPEC §3). One `step` runs every system in the table's order at a fixed 60 Hz:
// clock, weather, traffic, hazards, own and AI cars, broadphase, collisions (walls, cars, world),
// rules (progress, laps, the race), then the tick's events are in the queue for everyone else.

import { driveFollow, type FollowDriver } from './ai/follow';
import { driveRacer, type RacerDriver } from './ai/racer';
import { stepCar } from './car/physics';
import { createCarPool, restoreCars, snapshotCars, type CarPool } from './car/pool';
import { TUNING } from './car/tuning';
import { collideCars } from './collide/cars';
import { SpatialGrid } from './collide/grid';
import { collideWalls } from './collide/walls';
import { collideWorld, hazardsWreckTraffic, type WorldCtx } from './collide/world';
import type { CarClass, SurfaceDef } from './content';
import { neutralControls, quantizeControls, type Controls } from './controls';
import { Cause, Ev, EventQueue } from './events';
import { damp } from './math';
import { Rng, hash01 } from './rng';
import { positions, updateProgress } from './rules/progress';
import type { RaceState, SimState } from './state';
import { mainDistance, type Track } from './track/bake';
import { newHit, projectGlobal, sampleAt } from './track/query';
import { Hazards, type Mayhem } from './world/hazards';
import { Traffic } from './world/traffic';
import { planWeather, weatherAt, type WeatherOption, type WeatherPlan, type WeatherState } from './world/weather';

export const TICK_RATE = 60;
export const MAX_CARS = 16;

export interface SimOptions {
  seed: number;
  slowmo?: 'world' | 'wreck';
  weather?: WeatherOption;
  /** The map's allowed weather (from map.json). */
  weatherAllowed?: string[];
  mayhem?: Mayhem;
  /** Multiplies the layout's traffic density (0 = no traffic). */
  traffic?: number;
}

export interface CarSpec {
  cls: string;
  paint?: number;
  human?: boolean;
  /** A lane-following driver (pace car). */
  follow?: FollowDriver;
  /** A racing driver (the AI). */
  racer?: RacerDriver;
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
  readonly racers: (RacerDriver | null)[] = [];
  readonly controls: Controls[];
  readonly options: SimOptions;
  tick = 0;
  time = 0;
  timeScale = 1;
  weatherGrip = 1;
  wet = false;
  wetness = 0;
  weatherPlan: WeatherPlan;
  readonly weatherState: WeatherState = { wetness: 0, grip: 1, wet: false, visibility: 1 };
  world: { traffic: Traffic; hazards: Hazards };
  race: RaceState = { phase: 'free', goTime: 0, laps: 3, finishedCount: 0 };
  private readonly grid = new SpatialGrid(16, 1024, MAX_CARS);
  private readonly isActive = (i: number) => this.cars.active[i] === 1;
  private readonly nearS = new Float64Array(MAX_CARS);
  /** This tick's finishers, before they're placed. */
  private readonly finishers = new Int32Array(MAX_CARS);
  private readonly crossedAgo = new Float64Array(MAX_CARS);
  /** Race order, leader first (each tick's ranks; reused, so the tick doesn't allocate). */
  private readonly order: number[] = [];
  private readonly nearX = new Float64Array(MAX_CARS);
  private readonly nearZ = new Float64Array(MAX_CARS);
  private readonly ctx: WorldCtx;

  constructor(track: Track, classes: CarClass[], surfaces: SurfaceDef[], opts: SimOptions) {
    this.track = track;
    this.classes = classes;
    this.surfaces = surfaces;
    this.options = opts;
    this.cars = createCarPool(MAX_CARS);
    this.seed = opts.seed >>> 0;
    this.rng = Rng.stream(this.seed, 'sim');
    this.slowmo = opts.slowmo ?? 'world';
    this.shoulderSurface = track.surfaceIndex.get(track.layout.shoulderSurface ?? 'sidewalk') ?? 0;
    this.controls = Array.from({ length: MAX_CARS }, neutralControls);
    this.weatherPlan = planWeather(opts.weather ?? 'clear', this.seed, opts.weatherAllowed);
    this.world = this.buildWorld(track);
    this.ctx = { traffic: this.world.traffic, hazards: this.world.hazards, t: 0, tPrev: 0, prevMain: new Float64Array(MAX_CARS) };
    this.applyWeather();
  }

  private buildWorld(track: Track): { traffic: Traffic; hazards: Hazards } {
    const traffic = new Traffic(track, this.seed, this.options.traffic ?? 1);
    return { traffic, hazards: new Hazards(track, traffic, this.seed, this.options.mayhem ?? 'normal') };
  }

  private applyWeather(): void {
    weatherAt(this.weatherPlan, this.time, this.weatherState);
    this.weatherGrip = this.weatherState.grip;
    this.wet = this.weatherState.wet;
    this.wetness = this.weatherState.wetness;
  }

  /** Adds a car on the start grid (2 wide, 9 m rows, behind the line) and returns its index. */
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
    this.racers[i] = spec.racer ?? null;
    this.gridCar(i);
    return i;
  }

  /**
   * Places the `n` cars that finished this tick, in the order they crossed the line: whoever is
   * furthest past it for their speed crossed first (a photo finish isn't decided by car index).
   */
  private finish(n: number): void {
    const cars = this.cars;
    const line = this.race.laps * this.track.main.length;
    for (let k = 0; k < n; k++) {
      const i = this.finishers[k];
      this.crossedAgo[k] = (cars.progress[i] - line) / Math.max(1, Math.hypot(cars.vx[i], cars.vz[i]));
    }
    // Insertion sort, longest ago first (a handful at most, and no allocation).
    for (let a = 1; a < n; a++) {
      const i = this.finishers[a];
      const ago = this.crossedAgo[a];
      let b = a - 1;
      while (b >= 0 && this.crossedAgo[b] < ago) {
        this.finishers[b + 1] = this.finishers[b];
        this.crossedAgo[b + 1] = this.crossedAgo[b];
        b--;
      }
      this.finishers[b + 1] = i;
      this.crossedAgo[b + 1] = ago;
    }
    for (let k = 0; k < n; k++) {
      const i = this.finishers[k];
      cars.finished[i] = 1;
      cars.finishTime[i] = this.time - this.race.goTime;
      cars.place[i] = ++this.race.finishedCount;
      this.events.push(this.tick, Ev.Finish, i, cars.x[i], cars.y[i], cars.z[i], cars.finishTime[i], cars.place[i]);
    }
  }

  /** Puts car i in its grid slot, lap 0. */
  private gridCar(i: number): void {
    const c = this.cars;
    const row = Math.floor(i / 2);
    const col = i % 2 === 0 ? -1 : 1;
    const main = this.track.main;
    const at = sampleAt(main, main.length - 10 - row * 9, this.hitA);
    this.placeCar(i, 0, at.s, col * at.width * 0.22);
    c.lap[i] = 0;
    c.nextCp[i] = 0;
    c.progress[i] = at.s - main.length;
    c.lapStartTime[i] = this.time;
    c.boost[i] = TUNING.startBoost;
    c.finished[i] = 0;
    c.finishTime[i] = 0;
    c.place[i] = 0;
    c.startPress[i] = -1;
    c.score[i] = 0;
    c.takedowns[i] = 0;
    c.wrecks[i] = 0;
    c.bestLap[i] = 0;
    c.lastLap[i] = 0;
  }

  /** Puts everyone back on the grid and starts a countdown: the lights go green in `seconds`. */
  startRace(laps: number, seconds = 3): void {
    for (let i = 0; i < this.cars.count; i++) if (this.cars.active[i]) this.gridCar(i);
    // At least a lap (0 would finish everyone on the first tick), and no slow-mo left running.
    this.race = { phase: 'countdown', goTime: this.time + seconds, laps: Math.max(1, Math.floor(laps) || 1), finishedCount: 0 };
    this.timeScale = 1;
  }

  /** Swaps in a rebaked track (the editor) and finds every car on it again. */
  setTrack(track: Track): void {
    this.track = track;
    this.world = this.buildWorld(track);
    this.ctx.traffic = this.world.traffic;
    this.ctx.hazards = this.world.hazards;
    const c = this.cars;
    for (let i = 0; i < c.count; i++) {
      c.spline[i] = 0;
      projectGlobal(track.main, c.x[i], c.z[i], this.hitA, c.y[i]);
      c.s[i] = this.hitA.s;
      c.lastSpline[i] = 0;
      c.lastS[i] = this.hitA.s;
      c.lastLat[i] = 0;
    }
  }

  /** Puts car i on a spline at (s, lateral), facing along it. */
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
    c.spinT[i] = 0;
    // Nothing transient carries over a teleport: drift recovery, mini-turbo, stall, streaks.
    c.driftExit[i] = c.driftBank[i] = c.driftChain[i] = c.chainT[i] = c.chainPts[i] = 0;
    c.miniT[i] = c.stallT[i] = c.boosting[i] = c.oncomingT[i] = c.wreckT[i] = 0;
    c.aiHold[i] = c.aiBack[i] = 0;
    c.lastTakenBy[i] = 0;
    // Nor timers, the air, the body's tilt or who hit it last.
    c.ghostT[i] = c.resetCooldown[i] = c.stuckT[i] = c.wallT[i] = c.driftCooldown[i] = c.airT[i] = 0;
    c.pitch[i] = c.roll[i] = c.ppitch[i] = c.proll[i] = 0;
    c.miniStage[i] = 0;
    c.lastHitBy[i] = c.lastHitT[i] = 0;
    c.rx[i] = c.rz[i] = c.prx[i] = c.prz[i] = c.slip[i] = 0;
    c.spline[i] = spline;
    c.s[i] = at.s;
    c.lateral[i] = lateral;
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
    const ctx = this.ctx;
    const { traffic, hazards } = this.world;
    // System 2: clock.
    ctx.tPrev = this.time;
    this.time += dt;
    ctx.t = this.time;
    for (let i = 0; i < cars.count; i++) ctx.prevMain[i] = mainDistance(this.track, cars.spline[i], cars.s[i]);
    // Systems 3–5: weather, traffic, hazards (all functions of the seed and time).
    this.applyWeather();
    let n = 0;
    for (let i = 0; i < cars.count; i++) {
      if (!cars.active[i]) continue;
      this.nearS[n] = ctx.prevMain[i];
      this.nearX[n] = cars.x[i];
      this.nearZ[n++] = cars.z[i];
    }
    traffic.update(this.time, this.nearS, this.nearX, this.nearZ, n);
    hazards.update(this.time, this.events, this.tick);
    hazardsWreckTraffic(this, ctx);

    // The countdown: cars wait on the grid; holding throttle into "GO" earns a start boost.
    if (this.race.phase === 'countdown') {
      for (let i = 0; i < cars.count; i++) {
        if (!cars.active[i]) continue;
        const c = this.controlsFor(i, input);
        if (c.throttle > 0.5) {
          if (cars.startPress[i] < 0) cars.startPress[i] = this.time;
        } else cars.startPress[i] = -1;
      }
      if (this.time >= this.race.goTime) this.go();
      this.tick++;
      return;
    }

    // Systems 7–8: own and AI cars.
    for (let i = 0; i < cars.count; i++) {
      if (!cars.active[i]) continue;
      stepCar(this, i, this.controlsFor(i, input), dt);
    }
    // Systems 10–11: broadphase and collisions.
    this.grid.rebuild(cars.count, cars.x, cars.z, this.isActive);
    for (let i = 0; i < cars.count; i++) if (cars.active[i]) collideWalls(this, i);
    collideCars(this, this.grid);
    for (let i = 0; i < cars.count; i++) collideWorld(this, i, ctx);
    // System 12: rules.
    let nf = 0;
    for (let i = 0; i < cars.count; i++) {
      if (!cars.active[i]) continue;
      updateProgress(this, i);
      const sMain = mainDistance(this.track, cars.spline[i], cars.s[i]);
      // Triggers sit on the main road: a car on a shortcut passing the same mapped distance is
      // somewhere else (it used to drop the Valley's sign on the cars still on the main road).
      if (!cars.wreck[i] && cars.spline[i] === 0) hazards.crossTriggers(i, ctx.prevMain[i], sMain, this.time, this.events, this.tick);
      if (this.race.phase === 'racing' && !cars.finished[i] && cars.lap[i] >= this.race.laps) this.finishers[nf++] = i;
    }
    this.finish(nf);
    positions(this, this.order);
    for (let k = 0; k < this.order.length; k++) cars.rank[this.order[k]] = k;
    // Single-player slow-mo: a human's fresh wreck slows the world.
    if (this.slowmo === 'world') {
      let slow = false;
      // (Not a reset: that's asked for, and there's nothing to watch.)
      for (let i = 0; i < cars.count; i++) if (cars.human[i] && cars.wreck[i] && cars.wreckCause[i] !== Cause.Reset && cars.wreckT[i] < TUNING.wreckSlowTime * TUNING.wreckSlowScale) slow = true;
      const target = slow ? TUNING.wreckSlowScale : 1;
      this.timeScale += (target - this.timeScale) * damp(slow ? 30 : 6, this.dt);
    }
    this.tick++;
  }

  private controlsFor(i: number, input: readonly (Controls | undefined)[]): Controls {
    const f = this.drivers[i];
    if (f) return driveFollow(this, i, f, this.controls[i]);
    const r = this.racers[i];
    if (r) {
      const c = driveRacer(this, i, r, this.controls[i]);
      // The AI's start: throttle a moment before green, a touch less well on easier settings.
      if (this.race.phase === 'countdown') {
        const lead = 0.15 + hash01(this.seed, i, 7) * (0.35 + (2 - r.difficulty) * 0.5);
        c.throttle = this.race.goTime - this.time <= lead ? 1 : 0;
      }
      return c;
    }
    // A person's input, at the precision it's recorded at (see quantizeControls).
    const human = input[i];
    return human ? quantizeControls(human, this.controls[i]) : this.controls[i];
  }

  /** Green light: start boosts and stalls, lap timers start. */
  private go(): void {
    const cars = this.cars;
    this.race.phase = 'racing';
    this.events.push(this.tick, Ev.RaceStart, -1);
    for (let i = 0; i < cars.count; i++) {
      if (!cars.active[i]) continue;
      cars.lapStartTime[i] = this.time;
      const press = cars.startPress[i];
      if (press < 0) continue;
      const lead = this.race.goTime - press;
      if (lead <= TUNING.startBoostWindow) {
        cars.miniT[i] = TUNING.miniTurboTimes[2];
        cars.miniStage[i] = 2;
        this.events.push(this.tick, Ev.StartBoost, i, cars.x[i], cars.y[i], cars.z[i], lead, 1);
      } else if (lead > TUNING.stallEarly) {
        cars.stallT[i] = 0.8;
        this.events.push(this.tick, Ev.StartBoost, i, cars.x[i], cars.y[i], cars.z[i], lead, 0);
      }
      cars.startPress[i] = -1;
    }
  }

  snapshot(): SimSnapshot {
    return {
      tick: this.tick,
      time: this.time,
      timeScale: this.timeScale,
      rng: this.rng.state,
      race: { ...this.race },
      trafficWrecked: Array.from(this.world.traffic.wreckedAt),
      triggered: this.world.hazards.triggered.map((x) => [...x] as [number, number, number, number]),
      cars: snapshotCars(this.cars),
    };
  }

  restore(s: SimSnapshot): void {
    this.tick = s.tick;
    this.time = s.time ?? 0;
    this.timeScale = s.timeScale;
    this.rng.state = s.rng;
    if (s.race) this.race = { ...s.race };
    if (s.trafficWrecked) this.world.traffic.wreckedAt.set(s.trafficWrecked);
    this.world.hazards.restoreTriggered(s.triggered ?? [], this.time);
    restoreCars(this.cars, s.cars);
    this.applyWeather();
  }
}

export interface SimSnapshot {
  tick: number;
  time: number;
  timeScale: number;
  rng: number;
  race: RaceState;
  trafficWrecked: number[];
  triggered: [number, number, number, number][];
  cars: ReturnType<typeof snapshotCars>;
}
