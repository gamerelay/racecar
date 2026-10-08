// A getaway (docs/CHASE_MODE.md): a map whose race is a run from the cops, not laps (its layout's
// `getaway`). You're away on green with two cruisers behind you; the heat goes up a level every
// minute and never comes down, and each level calls out another cop (a pool of cars added at the
// start, out of the race until they're called) and makes them all quicker and harder (ai/cop.ts).
// Your first wreck is the end of it, whatever wrecked you; so is being stopped with a cop on you
// for BUSTED s. The score is how long you lasted. A cop that wrecks or sticks comes back out of your
// sight; one that's fallen far behind is brought up closer.

import { newCop, type CopDriver } from '../ai/cop';
import { Ev } from '../events';
import { atan2, cos, hypot, sin } from '../math';
import { Rng } from '../rng';
import type { Sim } from '../sim';
import { Streets } from '../world/streets';

/** The heat goes up a level every this many seconds. */
export const HEAT_EVERY = 60;
/** How many cops are out at each heat: one more than the heat, up to the pool. */
const COPS_FOR = (heat: number) => heat + 1;
/** The cars kept for cops (the getaway car and these fill MAX_CARS with room to spare). */
export const COP_POOL = 10;
/** A new cop is called out at most this often (s), so the heat's cops don't all turn up at once. */
const CALL_EVERY = 3;
/**
 * Where cops are called out: this far from you (m), at a crossing out of your sight; behind you at
 * heat 1, and from heat 2 ahead of you too, but never nearer than CALL_AHEAD (m) ahead (CHASE_MODE's
 * "fair, not cheap").
 */
const CALL_NEAR = 150;
const CALL_FAR = 340;
const CALL_AHEAD = 220;
/** The first two start this far behind you on the road (m), one after the other. */
const START_BEHIND = [130, 150];
/** Stopped (under BUSTED_SPEED m/s) with a cop within BUSTED_NEAR m for BUSTED s: busted. */
export const BUSTED = 2;
const BUSTED_SPEED = 2.5;
const BUSTED_NEAR = 7.5;
/** A wrecked cop comes back (out of sight) this long after (s), a stuck one after this long stuck, a cop further than FAR m off is brought closer. */
const COP_WRECK = 1.4;
const COP_STUCK = 2.5;
const FAR = 320;
/** Cops' boost fills this much a second (from heat 3 they use it to close in). */
const COP_BOOST = 0.06;

/** How a run ended: wrecked (a crash of any kind), or busted (stopped with the cops on you). */
export type GetawayEnd = 'wrecked' | 'busted';

export class Getaway {
  /** The heat now (1 up; 0 before the green light). */
  heat = 0;
  /** How long you've lasted (s): the score. */
  time = 0;
  /** How close you are to being busted (0..1). */
  busted = 0;
  /** How it ended, once it has. */
  end: GetawayEnd | null = null;
  readonly cops: number[];
  private readonly drivers: CopDriver[];
  private readonly streets: Streets;
  private readonly rng: Rng;
  private calledAt = -Infinity;

  /**
   * The getaway on `sim` for car `player` (a race on a map with one): its cops added to the sim
   * (out of the race until called) and the rules in place. Before the race starts.
   */
  constructor(
    private readonly sim: Sim,
    readonly player: number,
  ) {
    const def = sim.track.layout.getaway!;
    this.streets = new Streets(def, sim.track.layout.houses ?? []);
    this.rng = Rng.stream(sim.seed, 'getaway');
    this.drivers = [];
    this.cops = [];
    for (let k = 0; k < COP_POOL; k++) {
      const cop = newCop(this.streets, player);
      const i = sim.addCar({ cls: 'police', cop });
      sim.cars.active[i] = 0;
      this.cops.push(i);
      this.drivers.push(cop);
    }
    sim.getaway = this;
  }

  /** The rules, once a tick (sim.ts's rules system), after the cars have moved. */
  step(dt: number): void {
    const sim = this.sim;
    const c = sim.cars;
    const p = this.player;
    if (sim.race.phase !== 'racing' || this.end) return;
    // Green: away, with the first two behind you.
    if (this.heat === 0) {
      this.heat = 1;
      this.startCops();
    }
    this.time = sim.time - sim.race.goTime;
    const heat = 1 + Math.floor(this.time / HEAT_EVERY);
    if (heat > this.heat) {
      this.heat = heat;
      sim.events.push(sim.tick, Ev.Heat, p, c.x[p], c.y[p], c.z[p], heat);
    }
    for (const d of this.drivers) d.heat = this.heat;
    // Any crash is the end of it (a reset too: there's no road back to put you on).
    if (c.wreck[p]) return this.over('wrecked');
    // Stopped with a cop on you.
    const speed = hypot(c.vx[p], c.vz[p]);
    let near = false;
    for (const i of this.cops) if (c.active[i] && !c.wreck[i] && hypot(c.x[i] - c.x[p], c.z[i] - c.z[p]) < BUSTED_NEAR) near = true;
    this.busted = near && speed < BUSTED_SPEED ? this.busted + dt / BUSTED : Math.max(0, this.busted - (dt * 2) / BUSTED);
    if (this.busted >= 1) return this.over('busted');
    // The cops: the heat's number of them out, and any wrecked, stuck or far behind back in the chase.
    let out = 0;
    for (let k = 0; k < this.cops.length; k++) {
      const i = this.cops[k];
      if (!c.active[i]) continue;
      out++;
      c.boost[i] = Math.min(1, c.boost[i] + COP_BOOST * dt);
      const far = hypot(c.x[i] - c.x[p], c.z[i] - c.z[p]) > FAR;
      if ((c.wreck[i] && c.wreckT[i] > COP_WRECK) || c.stuckT[i] > COP_STUCK || far) this.callOut(k);
    }
    if (out < Math.min(COPS_FOR(this.heat), this.cops.length) && sim.time - this.calledAt > CALL_EVERY) {
      const k = this.cops.findIndex((i) => !c.active[i]);
      if (k >= 0) this.callOut(k);
    }
  }

  /**
   * The getaway car where the layout says it starts (outside the Bank), facing its way, stopped:
   * after the grid's put it on the main road (sim.ts's startRace).
   */
  atStart(): void {
    const start = this.sim.track.layout.getaway!.start;
    if (start) this.put(this.player, start.at[0], start.at[1], start.heading);
  }

  /** The two at the start: behind you (in the streets if you start in them, else on the road), facing your way. */
  private startCops(): void {
    const sim = this.sim;
    const c = sim.cars;
    const p = this.player;
    const main = sim.track.main;
    if (sim.track.layout.getaway!.start) {
      // The crossings behind you, the nearest first past START_BEHIND[0].
      const st = this.streets;
      const hx = sin(c.h[p]);
      const hz = cos(c.h[p]);
      const behind = Array.from({ length: st.n }, (_, n) => n)
        .filter((n) => (st.x(n) - c.x[p]) * hx + (st.z(n) - c.z[p]) * hz < 0 && hypot(st.x(n) - c.x[p], st.z(n) - c.z[p]) > START_BEHIND[0] * 0.7)
        .sort((a, b) => hypot(st.x(a) - c.x[p], st.z(a) - c.z[p]) - hypot(st.x(b) - c.x[p], st.z(b) - c.z[p]));
      for (let k = 0; k < 2 && k < behind.length; k++) {
        const n = behind[k];
        this.put(this.cops[k], st.x(n), st.z(n), atan2(c.x[p] - st.x(n), c.z[p] - st.z(n)));
        c.active[this.cops[k]] = 1;
      }
      this.calledAt = sim.time;
      return;
    }
    START_BEHIND.forEach((back, k) => {
      const i = this.cops[k];
      sim.placeCar(i, 0, (((c.s[p] - back) % main.length) + main.length) % main.length, c.lateral[p], 0);
      c.active[i] = 1;
      c.boost[i] = 0;
    });
    this.calledAt = sim.time;
  }

  /**
   * Cop `k` (of the pool) out at a crossing out of your sight, CALL_NEAR to CALL_FAR m from you,
   * behind you if there's one, facing you; anywhere far enough if none is out of sight.
   */
  private callOut(k: number): void {
    const sim = this.sim;
    const c = sim.cars;
    const p = this.player;
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
      // Out of sight, not too far, behind you at first (ahead later, not too close), and a little luck.
      const ahead = dx * hx + dz * hz > 0;
      if (ahead && d < CALL_AHEAD) continue;
      let score = this.rng.next() * 40 - Math.max(0, d - CALL_FAR);
      if (this.heat <= 1 ? !ahead : ahead) score += 60;
      if (!st.clear(c.x[p], c.z[p], st.x(n), st.z(n))) score += 100;
      // Not on top of another cop.
      for (const j of this.cops) if (c.active[j] && hypot(c.x[j] - st.x(n), c.z[j] - st.z(n)) < 12) score -= 200;
      if (score > bestScore) (bestScore = score), (best = n);
    }
    if (best < 0) return;
    const i = this.cops[k];
    const x = st.x(best);
    const z = st.z(best);
    this.put(i, x, z, atan2(c.x[p] - x, c.z[p] - z));
    c.active[i] = 1;
    c.boost[i] = 0;
    // (A new way to you, planned on its next tick.)
    this.drivers[k].pathLen = 0;
    this.drivers[k].planAt = 0;
    this.drivers[k].lookAt = 0;
    this.calledAt = sim.time;
  }

  /** Car `i` at (x, z) on the ground, facing `h`, stopped: everything about it reset (placeCar), then where it really is. */
  private put(i: number, x: number, z: number, h: number): void {
    const sim = this.sim;
    const c = sim.cars;
    sim.placeCar(i, 0, 0, 0, 0);
    const ground = sim.track.ground;
    c.x[i] = c.px[i] = x;
    c.z[i] = c.pz[i] = z;
    c.y[i] = c.py[i] = ground ? ground.height(x, z) : 0;
    c.h[i] = c.ph[i] = h;
  }

  private over(end: GetawayEnd): void {
    const sim = this.sim;
    const c = sim.cars;
    const p = this.player;
    this.end = end;
    this.time = sim.time - sim.race.goTime;
    c.finished[p] = 1;
    c.finishTime[p] = this.time;
    c.place[p] = 1;
    sim.race.finishedCount = 1;
    for (const d of this.drivers) d.stop = true;
    sim.events.push(sim.tick, Ev.Busted, p, c.x[p], c.y[p], c.z[p], this.time, end === 'busted' ? 1 : 0);
  }
}

