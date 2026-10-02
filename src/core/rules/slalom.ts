// Slalom gates (docs/AVALANCHE.md, item 5): pairs of flags across a piste (layout.slalom; the flags
// are smashables, world/smash.ts). Between a gate's flags pays a little boost and points, more for
// gates in a row; missing one costs nothing but the streak. They mark the fast line and reward
// driving it cleanly.

import { TUNING as T } from '../car/tuning';
import { earnBoost } from '../car/physics';
import { Ev } from '../events';
import type { SimState } from '../state';

/** The streak's points stop growing at this many gates in a row. */
const STREAK_MAX = 5;

export class Slalom {
  /** Per car: the last gate it passed or missed (-1: none yet), and gates through in a row. */
  private readonly last: Int32Array;
  private readonly streak: Int32Array;

  constructor(cars: number) {
    this.last = new Int32Array(cars).fill(-1);
    this.streak = new Int32Array(cars);
  }

  /** Car `i` went from `prev` to `now` m down the main road this tick: through any gate it crossed? */
  cross(sim: SimState, i: number, prev: number, now: number): void {
    const gates = sim.track.layout.slalom;
    const c = sim.cars;
    // Forward, a tick's drive (not a respawn), and on the main road (its lateral is the main road's).
    if (!gates || now <= prev || now - prev > 10 || c.spline[i] !== 0 || c.wreck[i]) return;
    for (let g = 0; g < gates.length; g++) {
      const gate = gates[g];
      if (prev >= gate.s || now < gate.s) continue;
      const through = Math.abs(c.lateral[i] - gate.lateral) < gate.gap / 2 - 0.3;
      this.streak[i] = through ? (this.last[i] === g - 1 ? this.streak[i] : 0) + 1 : 0;
      this.last[i] = g;
      if (!through) continue;
      const n = this.streak[i];
      const paid = earnBoost(sim, i, T.boostFromGate);
      c.score[i] += T.gatePoints * Math.min(n, STREAK_MAX);
      sim.events.push(sim.tick, Ev.Gate, i, c.x[i], c.y[i], c.z[i], paid, n, g);
    }
  }

  /** A car back at the top (a new race, another run): no streak. */
  reset(i: number): void {
    this.last[i] = -1;
    this.streak[i] = 0;
  }
}
