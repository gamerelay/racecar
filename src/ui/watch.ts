// An online getaway once you're out (the owner, 2026-10-09: "watch the rest then shared results"):
// who the camera follows, who's next, and the results' order. Pure: main.ts and race.ts use it.

import type { ResultRow } from '../lobby/lobby';
import type { Getaway } from '../core/rules/getaway';

/** Who to watch: the first runner still going (they all started on the same green, so any of them has lasted longest), or −1. */
export function leader(g: Getaway): number {
  return g.runs.find((r) => !r.end)?.car ?? -1;
}

/** The next runner still going after `from` (`dir` 1 on, −1 back), wrapping round; `from` if nobody's going. */
export function cycle(g: Getaway, from: number, dir: 1 | -1): number {
  const going = g.runs.filter((r) => !r.end).map((r) => r.car);
  const n = going.length;
  if (!n) return from;
  const at = going.indexOf(from);
  if (at >= 0) return going[(at + dir + n) % n];
  // (`from` out: the next one going after its seat, or before it going back, wrapping.)
  return dir > 0 ? (going.find((car) => car > from) ?? going[0]) : ([...going].reverse().find((car) => car < from) ?? going[n - 1]);
}

/** The getaway's results order: those still going first, then the longest run; each time the lobby's word where it has it. */
export function standings(g: Getaway, official: ReadonlyMap<number, ResultRow>): { car: number; time: number; going: boolean }[] {
  return g.runs
    .map((r) => ({ car: r.car, time: official.get(r.car)?.time ?? r.time, going: !r.end }))
    .sort((a, b) => Number(b.going) - Number(a.going) || b.time - a.time);
}
