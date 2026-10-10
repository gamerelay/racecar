// A getaway (docs/CHASE_MODE.md): a map whose race is a run from the cops, not laps (its layout's
// `getaway`). You're away on green with two cruisers behind you; the heat goes up a level every
// minute and never comes down, and each level calls out another cop (a pool of cars added at the
// start, out of the race until they're called) and makes them all quicker and harder (ai/cop.ts).
// Your first wreck is the end of it, whatever wrecked you; so is being stopped with a cop on you
// for BUSTED s. The score is how long you lasted. A cop that wrecks or sticks comes back out of your
// sight; one that's fallen far behind is brought up closer.
//
// Online (the owner, 2026-10-09: "competitive survival and we add more cops"): a run for each
// runner, each with their own pool of cops; a cop goes for any runner near it, not only its own,
// and any cop on you counts toward busted. Each runner's own screen says when they're out (another
// screen's runner ends by `endRemote`, from their car's entity: net/cars.ts), and the room's host
// drives every cop (net/cops.ts): a cop that's the host's (`remote`) isn't called out here.

import { newCop, type CopDriver } from '../ai/cop';
import { Ev } from '../events';
import { atan2, cos, hypot, sin } from '../math';
import { Rng } from '../rng';
import { MAX_CARS, type Sim } from '../sim';
import { newHit, projectGlobal } from '../track/query';
import { Streets } from '../world/streets';

/** The heat goes up a level every this many seconds. */
export const HEAT_EVERY = 60;
/** How many cops are out at each heat: one more than the heat, up to the pool. */
const COPS_FOR = (heat: number) => heat + 1;
/** The cars kept for each runner's cops, at most (a lone getaway car and these fill MAX_CARS with room to spare). */
export const COP_POOL = 10;
/** Each runner's cops: the pool, or as many as fit with every runner in MAX_CARS. */
export const poolFor = (runners: number): number => Math.min(COP_POOL, Math.floor((MAX_CARS - runners) / runners));
/** A new cop is called out at most this often (s), so the heat's cops don't all turn up at once. */
const CALL_EVERY = 3;
/**
 * Where cops are called out: this far from you (m), at a crossing out of your sight; behind you at
 * heat 1, and from heat 2 ahead of you too, but never nearer than CALL_AHEAD (m) ahead (CHASE_MODE's
 * "fair, not cheap").
 */
const CALL_NEAR = 150;
const CALL_FAR = 300;
const CALL_AHEAD = 220;
/** The first two start this far behind you on the road (m), one after the other. */
const START_BEHIND = [130, 150];
/** Online, runners start in pairs this far either side of the Bank's spot (m), a row this far back for each pair. */
const START_SIDE = 2.4;
const START_ROW = 7;
/** Stopped (under BUSTED_SPEED m/s) with a cop within BUSTED_NEAR m for BUSTED s: busted. */
export const BUSTED = 2;
const BUSTED_SPEED = 2.5;
const BUSTED_NEAR = 7.5;
/** A cop goes for another runner this near (m) in its sight, and back to its own once they're 1.5 times as far, or out of sight. */
export const NEAR_TARGET = 40;
/** A wrecked cop comes back (out of sight) this long after (s), a stuck one after this long stuck, a cop further than FAR m off is brought closer. */
const COP_WRECK = 1.4;
const COP_STUCK = 2.5;
const FAR = 320;
/** Cops' boost fills this much a second (from heat 3 they use it to close in). */
const COP_BOOST = 0.06;

/** How a run ended: wrecked (a crash of any kind), or busted (stopped with the cops on you). */
export type GetawayEnd = 'wrecked' | 'busted';

/** One runner's run: their car, their cops, how it's going. */
export interface Run {
  car: number;
  /** Their cops (car indexes), and the cops' drivers, in the same order. */
  cops: number[];
  drivers: CopDriver[];
  /** How long they've lasted (s): the score. */
  time: number;
  /** How close they are to being busted (0..1). */
  busted: number;
  /** How it ended, once it has. */
  end: GetawayEnd | null;
  /** When their last new cop was called out (sim time). */
  calledAt: number;
}

export class Getaway {
  /** The heat now (1 up; 0 before the green light): the race's, every runner's. */
  heat = 0;
  readonly runs: Run[];
  /** The runners' cars, in seat order. */
  readonly runners: readonly number[];
  /** Every cop, run by run: the same order on every screen (net/cops.ts names them by it). */
  readonly cops: number[];
  /** This screen's runner (the first not driven from another screen), or the first. */
  readonly player: number;
  private readonly streets: Streets;
  private readonly rng: Rng;
  private readonly hit = newHit();

  /**
   * The getaway on `sim` for the car or cars `runners` (a race on a map with one): each one's cops
   * added to the sim (out of the race until called) and the rules in place. Before the race starts.
   */
  constructor(
    private readonly sim: Sim,
    runners: number | readonly number[],
  ) {
    const def = sim.track.layout.getaway!;
    this.streets = new Streets(def, sim.track.layout.houses ?? []);
    this.rng = Rng.stream(sim.seed, 'getaway');
    this.runners = typeof runners === 'number' ? [runners] : [...runners];
    const pool = poolFor(this.runners.length);
    this.runs = this.runners.map((car) => {
      const run: Run = { car, cops: [], drivers: [], time: 0, busted: 0, end: null, calledAt: -Infinity };
      for (let k = 0; k < pool; k++) {
        const cop = newCop(this.streets, car);
        const i = sim.addCar({ cls: 'police', cop });
        sim.cars.active[i] = 0;
        run.cops.push(i);
        run.drivers.push(cop);
      }
      return run;
    });
    this.cops = this.runs.flatMap((r) => r.cops);
    this.player = this.runners.find((i) => !sim.cars.remote[i]) ?? this.runners[0];
    sim.getaway = this;
  }

  /** Car `car`'s run, if it's a runner. */
  runOf(car: number): Run | undefined {
    return this.runs.find((r) => r.car === car);
  }

  private get mine(): Run {
    return this.runOf(this.player)!;
  }

  /** How long this screen's runner has lasted (s). */
  get time(): number {
    return this.mine.time;
  }

  /** How close this screen's runner is to being busted (0..1). */
  get busted(): number {
    return this.mine.busted;
  }

  /** How this screen's runner's run ended, once it has. */
  get end(): GetawayEnd | null {
    return this.mine.end;
  }

  /** How many runners are still going. */
  get going(): number {
    let n = 0;
    for (const r of this.runs) if (!r.end) n++;
    return n;
  }

  /** Every run's over. */
  get allOut(): boolean {
    return this.going === 0;
  }

  /** The rules, once a tick (sim.ts's rules system), after the cars have moved. */
  step(dt: number): void {
    const sim = this.sim;
    const c = sim.cars;
    if (sim.race.phase !== 'racing' || this.allOut) return;
    // Green: away, each with the first two behind them.
    if (this.heat === 0) {
      this.heat = 1;
      for (const run of this.runs) this.startCops(run);
    }
    const time = sim.time - sim.race.goTime;
    const heat = 1 + Math.floor(time / HEAT_EVERY);
    if (heat > this.heat) {
      this.heat = heat;
      const p = this.player;
      sim.events.push(sim.tick, Ev.Heat, p, c.x[p], c.y[p], c.z[p], heat);
    }
    for (const run of this.runs) for (const d of run.drivers) d.heat = this.heat;
    for (const run of this.runs) if (!run.end) this.stepRun(run, time, dt);
  }

  /** Another screen's runner is out, as their car's entity says (net/cars.ts), after `time` s. */
  endRemote(car: number, end: GetawayEnd, time: number): void {
    const run = this.runOf(car);
    if (!run || run.end || !this.sim.cars.remote[car]) return;
    this.over(run, end, time);
  }

  /** One run's tick: is it over, which runner each of its cops is after, and its cops out and back. */
  private stepRun(run: Run, time: number, dt: number): void {
    const sim = this.sim;
    const c = sim.cars;
    const p = run.car;
    run.time = time;
    // Another screen's runner: their own screen says when they're out (endRemote).
    if (!c.remote[p]) {
      // Any crash is the end of it (a reset too: there's no road back to put you on).
      if (c.wreck[p]) return this.over(run, 'wrecked', time);
      // Stopped with a cop on you: any cop, whoever it's after.
      const speed = hypot(c.vx[p], c.vz[p]);
      let near = false;
      for (const i of this.cops) if (c.active[i] && !c.wreck[i] && hypot(c.x[i] - c.x[p], c.z[i] - c.z[p]) < BUSTED_NEAR) near = true;
      run.busted = near && speed < BUSTED_SPEED ? run.busted + dt / BUSTED : Math.max(0, run.busted - (dt * 2) / BUSTED);
      if (run.busted >= 1) return this.over(run, 'busted', time);
    }
    this.retarget(run);
    // The heat's number of them out, and any wrecked, stuck or far behind back in the chase.
    let out = 0;
    for (let k = 0; k < run.cops.length; k++) {
      const i = run.cops[k];
      if (!c.active[i]) continue;
      out++;
      // The host's to drive (net/cops.ts): it calls them out and brings them back.
      if (c.remote[i]) continue;
      c.boost[i] = Math.min(1, c.boost[i] + COP_BOOST * dt);
      const far = hypot(c.x[i] - c.x[p], c.z[i] - c.z[p]) > FAR;
      if ((c.wreck[i] && c.wreckT[i] > COP_WRECK) || c.stuckT[i] > COP_STUCK || far) this.callOut(run, k);
    }
    if (out < Math.min(COPS_FOR(this.heat), run.cops.length) && sim.time - run.calledAt > CALL_EVERY) {
      const k = run.cops.findIndex((i) => !c.active[i] && !c.remote[i]);
      // (Only a new cop starts the wait for the next: bringing one back doesn't.)
      if (k >= 0) this.callOut(run, k), (run.calledAt = sim.time);
    }
  }

  /**
   * Each of the run's cops after the nearest other runner within NEAR_TARGET it can see (kept while
   * they're within 1.5 times that), else its own runner. With one runner, always its own.
   */
  private retarget(run: Run): void {
    if (this.runs.length < 2) return;
    const c = this.sim.cars;
    const st = this.streets;
    for (let k = 0; k < run.cops.length; k++) {
      const i = run.cops[k];
      const d = run.drivers[k];
      if (!c.active[i] || c.remote[i]) continue;
      let to = run.car;
      let toD = Infinity;
      for (const other of this.runs) {
        if (other === run || other.end) continue;
        const j = other.car;
        const dist = hypot(c.x[i] - c.x[j], c.z[i] - c.z[j]);
        const reach = d.target === j ? NEAR_TARGET * 1.5 : NEAR_TARGET;
        if (dist < reach && dist < toD && st.clear(c.x[i], c.z[i], c.x[j], c.z[j])) (to = j), (toD = dist);
      }
      if (to === d.target) continue;
      d.target = to;
      // (A new way to them, planned on its next tick.)
      d.pathLen = 0;
      d.planAt = 0;
      d.lookAt = 0;
    }
  }

  /**
   * The runners where the layout says they start (outside the Bank), facing its way, stopped: after
   * the grid's put them on the main road (sim.ts's startRace). Online, in pairs either side of that
   * spot, a row back for each pair.
   */
  atStart(): void {
    const start = this.sim.track.layout.getaway!.start;
    if (!start) return;
    const [x0, z0] = start.at;
    const h = start.heading;
    const many = this.runs.length > 1;
    this.runs.forEach((run, r) => {
      const back = Math.floor(r / 2) * START_ROW;
      const side = many ? (r % 2 ? 1 : -1) * START_SIDE : 0;
      this.put(run.car, x0 - sin(h) * back + cos(h) * side, z0 - cos(h) * back - sin(h) * side, h);
    });
  }

  /** A run's two at the start: behind its runner (in the streets if they start in them, else on the road), facing their way. */
  private startCops(run: Run): void {
    const sim = this.sim;
    const c = sim.cars;
    const p = run.car;
    const main = sim.track.main;
    run.calledAt = sim.time;
    if (sim.track.layout.getaway!.start) {
      // The crossings behind them, the nearest first past START_BEHIND[0].
      const st = this.streets;
      const hx = sin(c.h[p]);
      const hz = cos(c.h[p]);
      const behind = Array.from({ length: st.n }, (_, n) => n)
        .filter((n) => (st.x(n) - c.x[p]) * hx + (st.z(n) - c.z[p]) * hz < 0 && hypot(st.x(n) - c.x[p], st.z(n) - c.z[p]) > START_BEHIND[0] * 0.7)
        .sort((a, b) => hypot(st.x(a) - c.x[p], st.z(a) - c.z[p]) - hypot(st.x(b) - c.x[p], st.z(b) - c.z[p]));
      // Two each, at crossings no other runner's cop has taken.
      for (let b = 0, k = 0; k < 2 && b < behind.length; b++) {
        const n = behind[b];
        if (this.cops.some((j) => c.active[j] && hypot(c.x[j] - st.x(n), c.z[j] - st.z(n)) < 12)) continue;
        const i = run.cops[k++];
        // The host's (net/cops.ts) are where it puts them.
        if (c.remote[i]) continue;
        this.put(i, st.x(n), st.z(n), atan2(c.x[p] - st.x(n), c.z[p] - st.z(n)));
        c.active[i] = 1;
      }
      return;
    }
    START_BEHIND.forEach((back, k) => {
      const i = run.cops[k];
      if (c.remote[i]) return;
      sim.placeCar(i, 0, (((c.s[p] - back) % main.length) + main.length) % main.length, c.lateral[p], 0);
      c.active[i] = 1;
      c.boost[i] = 0;
    });
  }

  /**
   * A run's cop `k` out at a crossing out of its runner's sight, CALL_NEAR to CALL_FAR m from them,
   * behind them if there's one, facing them; anywhere far enough if none is out of sight.
   */
  private callOut(run: Run, k: number): void {
    const sim = this.sim;
    const c = sim.cars;
    const p = run.car;
    const st = this.streets;
    const hx = sin(c.h[p]);
    const hz = cos(c.h[p]);
    let best = -1;
    let bestScore = -Infinity;
    for (let n = 0; n < st.n; n++) {
      const dx = st.x(n) - c.x[p];
      const dz = st.z(n) - c.z[p];
      const d = hypot(dx, dz);
      if (d < CALL_NEAR) continue;
      // Out of sight, not too far, behind them at first (ahead later, not too close), and a little luck.
      const ahead = dx * hx + dz * hz > 0;
      if (ahead && d < CALL_AHEAD) continue;
      // (Never as far as FAR: it'd be far again at once, and called out again every tick.)
      if (d > FAR - 10) continue;
      let score = this.rng.next() * 40 - Math.max(0, d - CALL_FAR);
      if (this.heat <= 1 ? !ahead : ahead) score += 60;
      if (!st.clear(c.x[p], c.z[p], st.x(n), st.z(n))) score += 100;
      // Not on top of another cop.
      for (const j of this.cops) if (c.active[j] && hypot(c.x[j] - st.x(n), c.z[j] - st.z(n)) < 12) score -= 200;
      if (score > bestScore) (bestScore = score), (best = n);
    }
    // (None in the ring: the nearest crossing past CALL_NEAR, so a far cop is always brought back.)
    if (best < 0)
      for (let n = 0; n < st.n; n++) {
        const d = hypot(st.x(n) - c.x[p], st.z(n) - c.z[p]);
        if (d >= CALL_NEAR && (best < 0 || d < hypot(st.x(best) - c.x[p], st.z(best) - c.z[p]))) best = n;
      }
    if (best < 0) return;
    const i = run.cops[k];
    const x = st.x(best);
    const z = st.z(best);
    this.put(i, x, z, atan2(c.x[p] - x, c.z[p] - z));
    c.active[i] = 1;
    c.boost[i] = 0;
    // (Back after its own runner, on a new way to them planned on its next tick.)
    const d = run.drivers[k];
    d.target = p;
    d.pathLen = 0;
    d.planAt = 0;
    d.lookAt = 0;
  }

  /** Car `i` at (x, z) on the ground, facing `h`, stopped: everything about it reset (placeCar), then where it really is. */
  private put(i: number, x: number, z: number, h: number): void {
    const sim = this.sim;
    const c = sim.cars;
    // (On the main road where it's nearest, so its place along it, and a respawn, are near where it is.)
    projectGlobal(sim.track.main, x, z, this.hit);
    sim.placeCar(i, 0, this.hit.s, 0, 0);
    const ground = sim.track.ground;
    c.x[i] = c.px[i] = x;
    c.z[i] = c.pz[i] = z;
    c.y[i] = c.py[i] = ground ? ground.height(x, z) : 0;
    c.h[i] = c.ph[i] = h;
  }

  /** A run over: its time kept, its car finished, and its cops stopped (alone) or out of the city (online). */
  private over(run: Run, end: GetawayEnd, time: number): void {
    const sim = this.sim;
    const c = sim.cars;
    const p = run.car;
    run.end = end;
    run.time = time;
    c.finished[p] = 1;
    c.finishTime[p] = time;
    // The last out is first: one place behind everyone still going.
    c.place[p] = this.going + 1;
    sim.race.finishedCount++;
    if (this.runs.length === 1) for (const d of run.drivers) d.stop = true;
    // (The host's take theirs off: net/cops.ts.)
    else for (const i of run.cops) if (!c.remote[i]) c.active[i] = 0;
    sim.events.push(sim.tick, Ev.Busted, p, c.x[p], c.y[p], c.z[p], time, end === 'busted' ? 1 : 0);
  }
}
