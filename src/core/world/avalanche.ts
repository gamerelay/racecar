// The avalanche (docs/AVALANCHE.md, item 4): at chaos on a one-run map whose layout has one, a wall
// of snow comes down the run behind the field. Like traffic it's closed-form in time, so every
// screen has it in the same place with nothing to sync: its front's distance down the main road is
// a function of the time since the green light. It goes faster on the steep pitches and slower on
// the flats and climbs: overall a little slower than the leaders, a little faster than the back.
// A car it reaches is buried (a hazard wreck) and respawns ahead of it, unless it's down in a
// canyon: the avalanche runs the piste, and a canyon's floor is below it. It runs out on the
// valley floor short of the finish (AVALANCHE_STOP), so a car ahead of it can always finish.

import type { AvalancheDef } from '../content';
import type { Track } from '../track/bake';

/** Down in a canyon this deep (m), on its floor or low on its walls, a car is under the avalanche: safe. */
export const AVALANCHE_UNDER = 4;
/** A buried car respawns this far ahead of the front (m), and never closer to the finish than AVALANCHE_LINE. */
export const AVALANCHE_AHEAD = 150;
export const AVALANCHE_LINE = 15;
/** It stops this far above the finish line (m). */
export const AVALANCHE_STOP = 50;

export class Avalanche {
  /** Where it breaks away (m along the main road), and how long after the green light. */
  readonly start: number;
  readonly delay: number;
  /** Seconds from breaking away to reaching each main-road sample from `start` on. */
  private readonly arrive: Float64Array;
  private readonly first: number;
  private readonly step: number;

  constructor(track: Track, def: AvalancheDef) {
    const main = track.main;
    const run = track.run!;
    this.start = Math.max(0, run.start - def.behind);
    this.delay = def.delay;
    this.step = main.step;
    this.first = Math.round(this.start / main.step);
    const last = Math.min(main.n - 1, Math.round((run.finish - AVALANCHE_STOP) / main.step));
    this.arrive = new Float64Array(Math.max(2, last - this.first + 1));
    // The grade over about ±20 m (drop per meter; negative climbs), and the speed it makes.
    const m = Math.max(1, Math.round(20 / main.step));
    let t = 0;
    for (let k = this.first; k < this.first + this.arrive.length; k++) {
      this.arrive[k - this.first] = t;
      const a = Math.max(0, k - m);
      const b = Math.min(main.n - 1, k + m);
      const grade = (main.py[a] - main.py[b]) / ((b - a) * main.step || 1);
      t += main.step / avalancheSpeed(def.speed, grade);
    }
  }

  /** The front's distance down the main road at `u` seconds after the green light; -Infinity before it breaks away. */
  front(u: number): number {
    const t = u - this.delay;
    if (t < 0) return -Infinity;
    const arr = this.arrive;
    if (t >= arr[arr.length - 1]) return this.start + (arr.length - 1) * this.step;
    // The last sample it's reached, then between it and the next.
    let lo = 0;
    let hi = arr.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= t) lo = mid;
      else hi = mid;
    }
    return this.start + (lo + (t - arr[lo]) / (arr[hi] - arr[lo])) * this.step;
  }
}

/** Its speed (m/s) at `grade`: `base` on a 20% slope, faster down the pitches, slower on the flats and climbs. */
export function avalancheSpeed(base: number, grade: number): number {
  return base * Math.min(1.9, Math.max(0.5, 0.7 + 1.5 * grade));
}
