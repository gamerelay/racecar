// Race progress (SPEC §5): laps, checkpoints and positions, all measured along the race's route
// through the road graph (core/track/graph.ts, step 6c), its checkpoints gates on it. Checkpoints
// stop a shortcut back across the finish line from counting as a lap.

import { Ev } from '../events';
import type { SimState } from '../state';
import { wrap } from '../track/bake';

export function updateProgress(sim: SimState, i: number): void {
  if (sim.track.run) return runProgress(sim, i);
  const cars = sim.cars;
  const route = sim.track.graph.route;
  const L = route.length;
  const gates = route.gates;
  // (The finish is the last gate: the checkpoints are the ones before it.)
  const cps = gates.length - 1;
  const d = sim.track.graph.along(cars.spline[i], cars.s[i]);
  const lap = cars.lap[i];
  const next = cars.nextCp[i];
  const prevProgress = cars.progress[i];
  const prevS = wrap(prevProgress, L);

  if (next < cps) {
    // A shortcut's exit can jump past more than one checkpoint in a tick.
    let n = next;
    while (n < cps && crossed(prevS, d, gates[n].at, L)) {
      sim.events.push(sim.tick, Ev.Checkpoint, i, cars.x[i], cars.y[i], cars.z[i], n, lap);
      n++;
    }
    cars.nextCp[i] = n;
  } else if (crossed(prevS, d, 0, L)) {
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
  let p = base + d;
  if (cars.nextCp[i] === 0 && d > L / 2) p -= L; // just before the line on a new lap
  if (cars.nextCp[i] >= cps && d < L / 2) p += L; // just past the line, lap not yet counted
  cars.progress[i] = p;
}

/**
 * One run (layout.run): progress is the distance along the route from its start, the checkpoints in
 * order, and crossing the finish after them is the run's one "lap". Nothing wraps.
 */
function runProgress(sim: SimState, i: number): void {
  const cars = sim.cars;
  const route = sim.track.graph.route;
  const gates = route.gates;
  const cps = gates.length - 1;
  const d = sim.track.graph.along(cars.spline[i], cars.s[i]);
  const prev = cars.progress[i];
  let n = cars.nextCp[i];
  // Only forward (a respawn, back on the road behind, isn't a crossing). A jump ahead counts what it
  // skipped: a respawn ahead of an avalanche, or a leap over a ridge onto a later stretch (open
  // ground is all in bounds), a shortcut you earned.
  const ahead = d > prev;
  while (ahead && n < cps && prev < gates[n].at && d >= gates[n].at) {
    sim.events.push(sim.tick, Ev.Checkpoint, i, cars.x[i], cars.y[i], cars.z[i], n, cars.lap[i]);
    n++;
  }
  cars.nextCp[i] = n;
  if (ahead && n >= cps && cars.lap[i] === 0 && prev < route.length && d >= route.length) {
    const time = sim.time - cars.lapStartTime[i];
    cars.lap[i] = 1;
    cars.lastLap[i] = time;
    if (cars.bestLap[i] === 0 || time < cars.bestLap[i]) cars.bestLap[i] = time;
    cars.lapStartTime[i] = sim.time;
    sim.events.push(sim.tick, Ev.Lap, i, cars.x[i], cars.y[i], cars.z[i], time, 1);
  }
  cars.progress[i] = d;
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
