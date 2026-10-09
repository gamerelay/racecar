// The tick pipeline (SPEC §3). One `step` runs every system in the table's order at a fixed 60 Hz:
// clock, weather, traffic, hazards, own and AI cars, broadphase, collisions (walls, cars, world),
// rules (progress, laps, the race), then the tick's events are in the queue for everyone else.

import { driveCop, type CopDriver } from './ai/cop';
import { driveFollow, type FollowDriver } from './ai/follow';
import { driveRacer, type RacerDriver } from './ai/racer';
import { collideLifts } from './collide/lifts';
import { stepCar, wreckCar } from './car/physics';
import { createCarPool, restoreCars, snapshotCars, type CarPool } from './car/pool';
import { TUNING } from './car/tuning';
import { collideCars } from './collide/cars';
import { SpatialGrid } from './collide/grid';
import { collideWalls } from './collide/walls';
import { collideWorld, hazardsWreckTraffic, type WorldCtx } from './collide/world';
import type { CarClass, SurfaceDef } from './content';
import { neutralControls, quantizeControls, type Controls } from './controls';
import { Cause, Ev, EventQueue } from './events';
import { atan2, damp, hypot } from './math';
import { Rng, hash01 } from './rng';
import { positions, updateProgress } from './rules/progress';
import type { RaceState, SimState } from './state';
import { mainDistance, type Track } from './track/bake';
import { locateCar } from './track/locate';
import { newHit, projectGlobal, sampleAt } from './track/query';
import { Hazards, type Mayhem } from './world/hazards';
import { buildLifts, type Lifts } from './world/lifts';
import { Traffic, laneActive } from './world/traffic';
import { Breakables } from './world/breakables';
import { Smashables } from './world/smash';
import { AVALANCHE_UNDER, Avalanche } from './world/avalanche';
import { Slalom } from './rules/slalom';
import type { Getaway } from './rules/getaway';
import { planWeather, weatherAt, type Fall, type WeatherOption, type WeatherPlan, type WeatherState } from './world/weather';

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
  /** A cop, after the getaway car (rules/getaway.ts adds these). */
  cop?: CopDriver;
  /** Another player's car online: its pose comes from them (`setPose`), not from this sim's physics. */
  remote?: boolean;
}

/** What another player's car looks like right now (net/cars.ts gives it to `setPose` before each step). */
export interface RemotePose {
  x: number;
  y: number;
  z: number;
  h: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  roll: number;
  rx: number;
  rz: number;
  grounded: boolean;
  drift: boolean;
  boosting: boolean;
  wreck: boolean;
  /** Just respawned and passing through others (on its own screen too). */
  ghost: boolean;
}

/** One run, in free drive: this long (s) past the finish, you're back at the top. */
const RUN_AGAIN = 4;

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
  shoulderSurface: number;
  readonly drivers: (FollowDriver | null)[] = [];
  readonly racers: (RacerDriver | null)[] = [];
  readonly cops: (CopDriver | null)[] = [];
  /** A getaway's rules (rules/getaway.ts), when this race is one: it sets itself here. */
  getaway: Getaway | null = null;
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
  world: { traffic: Traffic; hazards: Hazards; smash: Smashables; breakables: Breakables; lifts: Lifts };
  /** One run's avalanche, at chaos (world/avalanche.ts), and where its front is this tick. */
  avalanche: Avalanche | null = null;
  avalancheFront = -Infinity;
  /** Slalom gates' streaks (rules/slalom.ts), for this screen's own cars. */
  private readonly slalom = new Slalom(MAX_CARS);
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
    this.world.lifts.update(this.time, this.race.goTime);
    this.ctx = { traffic: this.world.traffic, hazards: this.world.hazards, smash: this.world.smash, breakables: this.world.breakables, t: 0, tPrev: 0, prevMain: new Float64Array(MAX_CARS) };
    this.applyWeather();
  }

  private buildWorld(track: Track): { traffic: Traffic; hazards: Hazards; smash: Smashables; breakables: Breakables; lifts: Lifts } {
    const def = track.layout.avalanche;
    this.avalanche = def && track.run && this.options.mayhem === 'chaos' ? new Avalanche(track, def) : null;
    const traffic = new Traffic(track, this.seed, this.options.traffic ?? 1);
    return { traffic, hazards: new Hazards(track, traffic, this.seed, this.options.mayhem ?? 'normal'), smash: new Smashables(track), breakables: new Breakables(track.ground ? (track.layout.breakables ?? []) : []), lifts: buildLifts(track, this.seed) };
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
    // Another player's car joins the race when it first shows up (net/cars.ts): one that never
    // does isn't a car parked on the grid.
    c.active[i] = spec.remote ? 0 : 1;
    c.cls[i] = cls;
    c.paint[i] = spec.paint ?? i;
    c.human[i] = spec.human ? 1 : 0;
    c.remote[i] = spec.remote ? 1 : 0;
    this.drivers[i] = spec.follow ?? null;
    this.racers[i] = spec.racer ?? null;
    this.cops[i] = spec.cop ?? null;
    this.gridCar(i);
    return i;
  }

  /**
   * Places the `n` cars that finished this tick, in the order they crossed the line: whoever is
   * furthest past it for their speed crossed first (a photo finish isn't decided by car index).
   */
  private finish(n: number): void {
    const cars = this.cars;
    const run = this.track.run;
    // (Along the race's route: core/track/graph.ts.)
    const route = this.track.graph.route;
    const line = run ? route.length : this.race.laps * route.length;
    for (let k = 0; k < n; k++) {
      const i = this.finishers[k];
      this.crossedAgo[k] = (cars.progress[i] - line) / Math.max(1, hypot(cars.vx[i], cars.vz[i]));
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
    this.slalom.reset(i);
    const c = this.cars;
    const row = Math.floor(i / 2);
    const col = i % 2 === 0 ? -1 : 1;
    const main = this.track.main;
    const run = this.track.run;
    if (run) {
      // One run: the grid behind the start, at the top.
      const at = sampleAt(main, run.start - 10 - row * 9, this.hitA);
      this.placeCar(i, 0, at.s, col * at.width * 0.22);
    } else if (this.gridOncoming()) {
      // Two-way traffic at the start: the whole grid is in the race's own half of the road, the
      // two columns staggered (half a row apart) to fit side by side, so nobody starts facing
      // oncoming cars.
      const at = sampleAt(main, main.length - 10 - row * 9 - (col > 0 ? 4.5 : 0), this.hitA);
      this.placeCar(i, 0, at.s, at.width * (col < 0 ? 0.12 : 0.36));
    } else {
      const at = sampleAt(main, main.length - 10 - row * 9, this.hitA);
      this.placeCar(i, 0, at.s, col * at.width * 0.22);
    }
    const at = this.hitA;
    c.lap[i] = 0;
    c.nextCp[i] = 0;
    // Behind the line on the route (a lap's grid is its last metres, one lap back).
    c.progress[i] = this.track.graph.along(0, at.s) - (run ? 0 : this.track.graph.route.length);
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

  /** Back to the top of the run (free drive), its times kept: in its own grid slot, so two cars finishing together don't land on each other. */
  private runAgain(i: number): void {
    const run = this.track.run!;
    const at = sampleAt(this.track.main, run.start - 10 - Math.floor(i / 2) * 9, this.hitA);
    this.placeCar(i, 0, at.s, (i % 2 === 0 ? -1 : 1) * at.width * 0.22);
    const c = this.cars;
    c.lap[i] = 0;
    c.nextCp[i] = 0;
    c.progress[i] = this.track.graph.along(0, at.s);
    c.lapStartTime[i] = this.time;
    this.slalom.reset(i);
  }

  /**
   * The avalanche buries every car of this screen's it has reached (its main-road distance behind
   * the front), unless it's down in a canyon. Respawns put them ahead of it.
   */
  private bury(): void {
    const cars = this.cars;
    const main = this.track.main;
    for (let i = 0; i < cars.count; i++) {
      if (!cars.active[i] || cars.remote[i] || cars.wreck[i] || cars.finished[i]) continue;
      const sMain = mainDistance(this.track, cars.spline[i], cars.s[i]);
      if (sMain >= this.avalancheFront) continue;
      const at = sampleAt(main, sMain, this.hitA);
      // Down in a canyon (and not in the air over it), it goes over you.
      const ground = this.track.ground;
      const lat = (cars.x[i] - at.cx) * -at.tz + (cars.z[i] - at.cz) * at.tx;
      if (ground && ground.sunk(sMain, lat) > AVALANCHE_UNDER && cars.y[i] < ground.height(cars.x[i], cars.z[i]) + 3) continue;
      // Thrown down the slope with it.
      wreckCar(this, i, Cause.Hazard, at.tx * 10, at.tz * 10, -1);
    }
  }

  /** Whether an oncoming traffic lane runs over the grid or just past the line. */
  private gridOncoming(): boolean {
    const L = this.track.main.length;
    // (The lanes as run: a lane by side streets is its routes, each with its main stretch.)
    return this.world.traffic.lanes.some((l) => l.dir < 0 && [L - 50, L - 10, 0, 30].some((s) => laneActive(l, s)));
  }

  /** Puts everyone back on the grid and starts a countdown: the lights go green in `seconds`. */
  startRace(laps: number, seconds = 3): void {
    for (let i = 0; i < this.cars.count; i++) if (this.cars.active[i]) this.gridCar(i);
    // At least a lap (0 would finish everyone on the first tick), and no slow-mo left running.
    // One run is one "lap", whatever the lobby asked for.
    this.race = { phase: 'countdown', goTime: this.time + seconds, laps: this.track.run ? 1 : Math.max(1, Math.floor(laps) || 1), finishedCount: 0 };
    this.timeScale = 1;
    // A getaway starts outside its Bank, not on the grid.
    this.getaway?.atStart();
  }

  /** Swaps in a rebaked track (the editor, or another map behind the menu) and finds every car on it again. */
  setTrack(track: Track): void {
    this.track = track;
    this.shoulderSurface = track.surfaceIndex.get(track.layout.shoulderSurface ?? 'sidewalk') ?? 0;
    this.world = this.buildWorld(track);
    this.ctx.traffic = this.world.traffic;
    this.ctx.hazards = this.world.hazards;
    this.ctx.smash = this.world.smash;
    this.ctx.breakables = this.world.breakables;
    this.world.lifts.update(this.time, this.race.goTime);
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

  /** It's snow that's falling, not rain (sim.wetness is how hard). */
  get snowing(): boolean {
    return !!this.weatherPlan.snow;
  }

  /** What's in the air when sim.wetness is up: rain, snow, or a sandstorm's sand. */
  get fall(): Fall {
    return this.weatherPlan.snow ? 'snow' : this.weatherPlan.sand ? 'sand' : 'rain';
  }

  /** Plans the weather again (another map behind the menu, which may not see rain). */
  setWeather(weather: WeatherOption, allowed?: string[]): void {
    this.weatherPlan = planWeather(weather, this.seed, allowed);
    this.applyWeather();
  }

  /** Puts car i on a spline at (s, lateral), facing along it. */
  placeCar(i: number, spline: number, s: number, lateral: number, speed = 0): void {
    const c = this.cars;
    const at = sampleAt(this.track.splines[spline], s, this.hitA);
    c.x[i] = at.cx - at.tz * lateral;
    c.z[i] = at.cz + at.tx * lateral;
    c.y[i] = at.cy;
    c.h[i] = atan2(at.tx, at.tz);
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
    c.draft[i] = c.draftT[i] = c.slingT[i] = c.cruise[i] = c.cruiseFull[i] = 0;
    c.aiHold[i] = c.aiBack[i] = c.aiMerge[i] = 0;
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

  /**
   * Another player's car, where they say it is: last pose kept for render interpolation, then the
   * new one. Its track position follows from it in the step (progress, laps, rank), but its physics
   * are theirs: this sim doesn't move it, wall it or wreck it.
   */
  setPose(i: number, p: RemotePose): void {
    const c = this.cars;
    c.px[i] = c.x[i];
    c.py[i] = c.y[i];
    c.pz[i] = c.z[i];
    c.ph[i] = c.h[i];
    c.ppitch[i] = c.pitch[i];
    c.proll[i] = c.roll[i];
    c.prx[i] = c.rx[i];
    c.prz[i] = c.rz[i];
    c.x[i] = p.x;
    c.y[i] = p.y;
    c.z[i] = p.z;
    c.h[i] = p.h;
    c.vx[i] = p.vx;
    c.vy[i] = p.vy;
    c.vz[i] = p.vz;
    c.yaw[i] = p.yaw;
    c.pitch[i] = p.pitch;
    c.roll[i] = p.roll;
    c.rx[i] = p.rx;
    c.rz[i] = p.rz;
    c.grounded[i] = p.grounded ? 1 : 0;
    c.drift[i] = p.drift ? 1 : 0;
    c.boosting[i] = p.boosting ? 1 : 0;
    c.wreck[i] = p.wreck ? 1 : 0;
    // Ghosted while it's said to be (this sim doesn't count it down: it doesn't step the car).
    c.ghostT[i] = p.ghost ? 1 : 0;
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
    // The drawbridges' leaves at this moment, before anything stands on them.
    this.world.lifts.update(this.time, this.race.goTime);
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
        if (!cars.active[i] || cars.remote[i]) continue;
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
      // Another player's car only needs finding on the track (its progress, laps and rank).
      if (cars.remote[i]) locateCar(this, i);
      else stepCar(this, i, this.controlsFor(i, input), dt);
    }
    // An override's own step, for each of your cars inside its region (track/overrides.ts).
    for (const o of this.track.overrides) {
      if (!o.step) continue;
      for (let i = 0; i < cars.count; i++) if (cars.active[i] && !cars.remote[i] && o.inside(cars.x[i], cars.z[i])) o.step(this, i);
    }
    // Systems 10–11: broadphase and collisions.
    this.grid.rebuild(cars.count, cars.x, cars.z, this.isActive);
    for (let i = 0; i < cars.count; i++) if (cars.active[i] && !cars.remote[i]) collideWalls(this, i);
    for (let i = 0; i < cars.count; i++) if (cars.active[i] && !cars.remote[i]) collideLifts(this, i);
    // Against another player's car too: yours takes its share of the bump (theirs, on their screen).
    collideCars(this, this.grid);
    for (let i = 0; i < cars.count; i++) if (!cars.remote[i]) collideWorld(this, i, ctx);
    this.avalancheFront = this.avalanche && this.race.phase === 'racing' ? this.avalanche.front(this.time - this.race.goTime) : -Infinity;
    if (this.avalancheFront > -Infinity) this.bury();
    // System 12: rules.
    let nf = 0;
    for (let i = 0; i < cars.count; i++) {
      if (!cars.active[i]) continue;
      updateProgress(this, i);
      // One run, in free drive: a few seconds past the finish, back to the top for another.
      if (this.track.run && this.race.phase === 'free' && !cars.remote[i] && cars.lap[i] > 0 && this.time - cars.lapStartTime[i] > RUN_AGAIN) this.runAgain(i);
      const sMain = mainDistance(this.track, cars.spline[i], cars.s[i]);
      // Triggers sit on the main road: a car on a shortcut passing the same mapped distance is
      // somewhere else (it used to drop the Valley's sign on the cars still on the main road).
      if (!cars.remote[i]) this.slalom.cross(this, i, ctx.prevMain[i], sMain);
      if (!cars.wreck[i] && cars.spline[i] === 0) hazards.crossTriggers(i, ctx.prevMain[i], sMain, this.time, this.events, this.tick);
      // (A getaway has no finish: it's over when the rules say.)
      if (this.race.phase === 'racing' && !this.getaway && !cars.finished[i] && cars.lap[i] >= this.race.laps) this.finishers[nf++] = i;
    }
    this.finish(nf);
    this.getaway?.step(dt);
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
    const cop = this.cops[i];
    if (cop) return driveCop(this, i, cop, this.controls[i]);
    // A getaway that's over: the car pulls up, whatever you press.
    if (this.getaway?.end && i === this.getaway.player) {
      const c = this.controls[i];
      c.steer = c.throttle = 0;
      c.brake = hypot(this.cars.vx[i], this.cars.vz[i]) > 0.5 ? 1 : 0;
      c.boost = c.drift = c.reset = c.lookBack = c.horn = false;
      return c;
    }
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
      smashed: this.world.smash.broken(this.time),
      wallsBroken: this.world.breakables.broken(this.time),
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
    this.world.smash.restore(s.smashed ?? []);
    this.world.breakables.restore(s.wallsBroken ?? []);
    restoreCars(this.cars, s.cars);
    this.applyWeather();
    this.world.lifts.update(this.time, this.race.goTime);
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
  /** Smashables down: [index, world time smashed]. */
  smashed?: [number, number][];
  /** Breakable walls' panels down: [index, world time broken]. */
  wallsBroken?: [number, number][];
  cars: ReturnType<typeof snapshotCars>;
}
