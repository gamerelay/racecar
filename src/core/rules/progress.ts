// Race progress (SPEC §5): laps, checkpoints and positions, all measured on the main spline.
// Checkpoints stop a shortcut back across the finish line from counting as a lap.

import { Ev } from '../events';
import type { SimState } from '../state';
import { mainDistance, wrap } from '../track/bake';

export function updateProgress(sim: SimState, i: number): void {
  const cars = sim.cars;
  const track = sim.track;
  const L = track.main.length;
  const cps = track.checkpoints;
  const sMain = mainDistance(track, cars.spline[i], cars.s[i]);
  const lap = cars.lap[i];
  const next = cars.nextCp[i];
  const prevProgress = cars.progress[i];
  const prevS = wrap(prevProgress, L);

  if (next < cps.length) {
    const cp = cps[next];
    if (crossed(prevS, sMain, cp, L)) {
      cars.nextCp[i] = next + 1;
      sim.events.push(sim.tick, Ev.Checkpoint, i, cars.x[i], cars.y[i], cars.z[i], next, lap);
    }
  } else if (crossed(prevS, sMain, 0, L)) {
    const time = (sim.tick - cars.lapStartTick[i]) * sim.dt;
    cars.lap[i] = lap + 1;
    cars.nextCp[i] = 0;
    cars.lastLap[i] = time;
    if (cars.bestLap[i] === 0 || time < cars.bestLap[i]) cars.bestLap[i] = time;
    cars.lapStartTick[i] = sim.tick;
    sim.events.push(sim.tick, Ev.Lap, i, cars.x[i], cars.y[i], cars.z[i], time, lap + 1);
  }
  // Progress keeps counting forward through the finish line so positions sort across it.
  const base = cars.lap[i] * L;
  let p = base + sMain;
  if (cars.nextCp[i] === 0 && sMain > L / 2) p -= L; // just before the line on a new lap
  if (cars.nextCp[i] >= cps.length && sMain < L / 2) p += L; // just past the line, lap not yet counted
  cars.progress[i] = p;
}

/** True if moving forward from a to b (a short step, wrapping at L) passes point c. */
function crossed(a: number, b: number, c: number, L: number): boolean {
  const step = wrap(b - a, L);
  if (step > L / 2) return false; // moved backwards
  const toC = wrap(c - a, L);
  return toC > 0 && toC <= step;
}

/** Car indices sorted by progress, leader first. Writes into `out`. */
export function positions(sim: SimState, out: number[]): number[] {
  out.length = 0;
  for (let i = 0; i < sim.cars.count; i++) if (sim.cars.active[i]) out.push(i);
  out.sort((a, b) => sim.cars.progress[b] - sim.cars.progress[a]);
  return out;
}
