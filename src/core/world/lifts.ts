// Drawbridges (docs/COASTAL.md, "The drawbridge"; PieceDef.lift): World authority, so each one's
// angle is a pure function of the room's seed and the race clock (docs/CALDERA.md, "Things that
// move"). The lift times are drawn once from the seed's own stream; after that nothing is stored
// and nothing is sent. Each tick, before the cars step, the sim sets every leaf's angle on the
// ground (`Ground.setLift`), so the floor under a car is the leaf at that moment.

import type { LiftDef } from '../content';
import { smoothstep } from '../math';
import { Rng } from '../rng';
import type { Track } from '../track/bake';

/** Where a lift is in its cycle at a moment. */
export type LiftPhase = 'down' | 'warn' | 'rising' | 'up' | 'falling';

export interface Lifts {
  /** The pieces with a lift (their index in `ground.pieces.list`), and each one's def. */
  readonly pieces: readonly number[];
  readonly defs: readonly LiftDef[];
  /** When each one's lifts start (its warning), s after the race's green (`origin`). */
  readonly starts: readonly (readonly number[])[];
  /** The sim's time at the race's green (RaceState.goTime), set by `update`: the lifts count from it. */
  readonly origin: number;
  /** Lift `k`'s angle (rad) at sim time `t`: 0 down. */
  angle(k: number, t: number): number;
  /** Where lift `k` is in its cycle at sim time `t`. */
  phase(k: number, t: number): LiftPhase;
  /** How far (s) lift `k` is into the cycle running at sim time `t`, from its warning; NaN while none runs. */
  since(k: number, t: number): number;
  /** Every leaf's angle at sim time `t`, onto the ground (before the cars step), the race having gone green at `origin`. */
  update(t: number, origin: number): void;
}

/** When a lift's cycles start, from the seed (each lift its own stream). */
export function liftStarts(def: LiftDef, seed: number, id: string): number[] {
  const r = Rng.stream(seed, `lift:${id}`);
  const first = r.range(def.first[0], def.first[1]);
  const twice = r.next() < def.twice;
  const again = first + r.range(def.again[0], def.again[1]);
  return twice ? [first, again] : [first];
}

/** A lift's angle (rad) `u` s after its cycle started (its warning). */
export function liftAngleAt(def: LiftDef, u: number): number {
  if (u < def.warn) return 0;
  u -= def.warn;
  if (u < def.rise) return def.angle * smoothstep(0, def.rise, u);
  u -= def.rise;
  if (u < def.up) return def.angle;
  u -= def.up;
  if (u < def.fall) return def.angle * (1 - smoothstep(0, def.fall, u));
  return 0;
}

function phaseAt(def: LiftDef, u: number): LiftPhase {
  if (u < 0) return 'down';
  if (u < def.warn) return 'warn';
  if (u < def.warn + def.rise) return 'rising';
  if (u < def.warn + def.rise + def.up) return 'up';
  if (u < def.warn + def.rise + def.up + def.fall) return 'falling';
  return 'down';
}

/** How long one cycle runs, warning to down. */
export const cycle = (def: LiftDef) => def.warn + def.rise + def.up + def.fall;

/**
 * Where a lift's boat is (LiftDef.boat; drawn only), `t` s after the race's green, its lifts
 * starting at `starts`: metres across the road (+ right), and which way it's heading (+1 toward
 * the right). Moored at `boat[0]` before the first lift; in each, it sails steadily across, under
 * the road halfway through the leaves' time up, to the other mooring, and the next lift brings it
 * back. NaN with no boat.
 */
export function boatAt(def: LiftDef, starts: readonly number[], t: number, out = { across: 0, dir: 0 }): { across: number; dir: number } {
  out.across = NaN;
  out.dir = 0;
  if (!def.boat) return out;
  let j = -1;
  while (j + 1 < starts.length && t >= starts[j + 1]) j++;
  if (j < 0) {
    out.across = def.boat[0];
    return out;
  }
  const from = def.boat[j % 2];
  const to = def.boat[(j + 1) % 2];
  // Under the road (across 0, a fraction `mid` of the way) at the middle of the leaves' time up,
  // and on at the same pace to the far mooring.
  const under = def.warn + def.rise + def.up / 2;
  const mid = from / (from - to);
  const k = ((t - starts[j]) / under) * (t - starts[j] < under ? mid : 1 - mid) + (t - starts[j] < under ? 0 : 2 * mid - 1);
  out.across = from + (to - from) * Math.min(1, Math.max(0, k));
  out.dir = k < 1 ? (to > from ? 1 : -1) : 0;
  return out;
}

export function buildLifts(track: Track, seed: number): Lifts {
  const g = track.ground;
  const pieces: number[] = [];
  const defs: LiftDef[] = [];
  const starts: number[][] = [];
  const layoutPieces = track.layout.pieces ?? [];
  if (g)
    for (const p of g.pieces.list) {
      const def = layoutPieces.find((d) => d.id === p.id)?.lift;
      if (!def) continue;
      pieces.push(p.index);
      defs.push(def);
      starts.push(liftStarts(def, seed, p.id));
    }
  let origin = 0;
  /** The cycle running at sim time `t` (its start, after green), or NaN. */
  const current = (k: number, t: number) => {
    t -= origin;
    const list = starts[k];
    for (let j = list.length - 1; j >= 0; j--) if (t >= list[j]) return t - list[j] < cycle(defs[k]) ? list[j] : NaN;
    return NaN;
  };
  return {
    pieces,
    defs,
    starts,
    angle(k, t) {
      const t0 = current(k, t);
      return t0 === t0 ? liftAngleAt(defs[k], t - origin - t0) : 0;
    },
    phase(k, t) {
      const t0 = current(k, t);
      return t0 === t0 ? phaseAt(defs[k], t - origin - t0) : 'down';
    },
    since(k, t) {
      return t - origin - current(k, t);
    },
    get origin() {
      return origin;
    },
    update(t, from) {
      origin = from;
      if (!g) return;
      for (let k = 0; k < pieces.length; k++) g.setLift(pieces[k], this.angle(k, t));
    },
  };
}
