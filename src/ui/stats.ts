// The car select's stat bars (PLAN phase 4): speed, accel, handling, weight and boost from the
// class numbers, each against the range across the classes, so the slowest car still shows a
// sliver and the fastest a full bar. Pure, so it's tested without a DOM.

import type { CarClass } from '../core/content';

export interface Stat {
  name: string;
  /** 0–1 along the bar. */
  t: number;
}

const STATS: [string, (c: CarClass) => number][] = [
  ['Speed', (c) => c.topSpeed],
  ['Accel', (c) => c.accel],
  ['Handling', (c) => c.turn * c.grip],
  ['Weight', (c) => c.mass],
  ['Boost', (c) => c.boostCapacity],
];

/** `car`'s bars against `classes`; none for a car that isn't one of them. */
export function carStats(classes: readonly CarClass[], car: string): Stat[] {
  const c = classes.find((k) => k.id === car);
  if (!c) return [];
  return STATS.map(([name, f]) => {
    const vals = classes.map(f);
    // The bottom of the bar is a bit under the lowest, so every car has some.
    const lo = Math.min(...vals) * 0.8;
    const hi = Math.max(...vals);
    return { name, t: hi > lo ? (f(c) - lo) / (hi - lo) : 1 };
  });
}
