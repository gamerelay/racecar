// The race's clock online (SPEC §4, the shared race clock): green on the server's clock, and each
// screen's race time following it, so traffic, weather, hazards and smashables (all functions of
// `sim.time`) are the same everywhere. NetCars runs it before each step.

import type { Sim } from '../core/sim';

/** Seconds until the lights go green at `at` (the server's clock, ms), seen at `now`: none once it's passed, and nothing silly from a bad clock. */
export function startDelay(at: number, now: number): number {
  return Math.min(30, Math.max(0, (at - now) / 1000));
}

/** Behind the server's clock by more than this (s: steps dropped, the editor open), the race jumps to it. */
export const CLOCK_SNAP = 0.25;
/** Otherwise this much of the difference is made up each step (about a second to close it). */
const CLOCK_SLEW = 0.05;

/**
 * The race's time on the server's clock (SPEC §4, the shared race clock). Traffic, weather, hazards
 * and smashables are functions of `sim.time`, so every screen must have the same one: green is at
 * `sim.race.goTime` and on the server's clock at `at` (ms), and `sim.time` follows the server's
 * clock from those. In the countdown it's set outright (nothing moves yet); racing, a small
 * difference is slewed out, never going back more than half a step, and a big lag jumped.
 */
export function syncClock(sim: Sim, at: number, now: number): void {
  if (sim.race.phase === 'free') return;
  if (sim.race.phase === 'countdown') {
    sim.time = sim.race.goTime - startDelay(at, now);
    return;
  }
  const want = sim.race.goTime + (now - at) / 1000;
  const off = want - sim.time;
  if (off > CLOCK_SNAP) sim.time = want;
  else sim.time += Math.max(-sim.dt / 2, off * CLOCK_SLEW);
}
