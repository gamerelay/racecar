// Race progress (SPEC §5): laps, checkpoints and positions, all measured on the main spline.
// Checkpoints stop a shortcut back across the finish line from counting as a lap.

import { Ev } from '../events';
import type { SimState } from '../state';
import { mainDistance, wrap } from '../track/bake';

export function updateProgress(sim: SimState, i: number): void {
  if (sim.track.run) return runProgress(sim, i, sim.track.run);
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
    // A shortcut's exit can jump past more than one checkpoint in a tick.
    let n = next;
    while (n < cps.length && crossed(prevS, sMain, cps[n], L)) {
      sim.events.push(sim.tick, Ev.Checkpoint, i, cars.x[i], cars.y[i], cars.z[i], n, lap);
      n++;
    }
    cars.nextCp[i] = n;
  } else if (crossed(prevS, sMain, 0, L)) {
    // World time, like the race clock: slow-mo stretches it for everyone alike.
    const time = sim.time - cars.lapStartTime[i];
    cars.lap[i] = lap + 1;
    cars.nextCp[i] = 0;
    cars.lastLap[i] = time;
    if (cars.bestLap[i] === 0 || time < cars.bestLap[i]) cars.bestLap[i] = time;
    cars.lapStartTime[i] = sim.time;
    sim.events.push(sim.tick, Ev.Lap, i, cars.x[i], cars.y[i], cars.z[i], time, lap + 1);
  }
  // Progress keeps counting forward through the finish line so positions sort across it.
  const base = cars.lap[i] * L;
  let p = base + sMain;
  if (cars.nextCp[i] === 0 && sMain > L / 2) p -= L; // just before the line on a new lap
  if (cars.nextCp[i] >= cps.length && sMain < L / 2) p += L; // just past the line, lap not yet counted
  cars.progress[i] = p;
}

/**
 * One run (layout.run): progress is the distance from the start, the checkpoints in order, and
 * crossing the finish after them is the run's one "lap". Nothing wraps.
 */
function runProgress(sim: SimState, i: number, run: { start: number; finish: number }): void {
  const cars = sim.cars;
  const cps = sim.track.checkpoints;
  const sMain = mainDistance(sim.track, cars.spline[i], cars.s[i]);
  const prevS = cars.progress[i] + run.start;
  let n = cars.nextCp[i];
  // Only forward (a respawn, back on the road behind, isn't a crossing). A jump ahead counts what it
  // skipped: a respawn ahead of an avalanche, or a leap over a ridge onto a later stretch (open
  // ground is all in bounds), a shortcut you earned.
  const ahead = sMain > prevS;
  while (ahead && n < cps.length && prevS < cps[n] && sMain >= cps[n]) {
    sim.events.push(sim.tick, Ev.Checkpoint, i, cars.x[i], cars.y[i], cars.z[i], n, cars.lap[i]);
    n++;
  }
  cars.nextCp[i] = n;
  if (ahead && n >= cps.length && cars.lap[i] === 0 && prevS < run.finish && sMain >= run.finish) {
    const time = sim.time - cars.lapStartTime[i];
    cars.lap[i] = 1;
    cars.lastLap[i] = time;
    if (cars.bestLap[i] === 0 || time < cars.bestLap[i]) cars.bestLap[i] = time;
    cars.lapStartTime[i] = sim.time;
    sim.events.push(sim.tick, Ev.Lap, i, cars.x[i], cars.y[i], cars.z[i], time, 1);
  }
  cars.progress[i] = sMain - run.start;
}

/** True if moving forward from a to b (a short step, wrapping at L) passes point c. */
function crossed(a: number, b: number, c: number, L: number): boolean {
  const step = wrap(b - a, L);
  if (step > L / 2) return false; // moved backwards
  const toC = wrap(c - a, L);
  return toC > 0 && toC <= step;
}

let ranking: SimState['cars'] | undefined;
/** Finished cars first, by place (they keep driving after the line); the rest by progress. */
const byPosition = (a: number, b: number): number => {
  const c = ranking!;
  return c.finished[b] - c.finished[a] || (c.finished[a] ? c.place[a] - c.place[b] : c.progress[b] - c.progress[a]);
};

/** Car indices in race order, leader first. Writes into `out`. */
export function positions(sim: SimState, out: number[]): number[] {
  out.length = 0;
  for (let i = 0; i < sim.cars.count; i++) if (sim.cars.active[i]) out.push(i);
  ranking = sim.cars;
  out.sort(byPosition);
  return out;
}
