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
  /** When each one's lifts start (its warning), s of race time. */
  readonly starts: readonly (readonly number[])[];
  /** Lift `k`'s angle (rad) at time `t`: 0 down. */
  angle(k: number, t: number): number;
  /** Where lift `k` is in its cycle at `t`. */
  phase(k: number, t: number): LiftPhase;
  /** Every leaf's angle at `t`, onto the ground (before the cars step). */
  update(t: number): void;
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
  /** The cycle running at `t` (its start), or NaN. */
  const current = (k: number, t: number) => {
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
      return t0 === t0 ? liftAngleAt(defs[k], t - t0) : 0;
    },
    phase(k, t) {
      const t0 = current(k, t);
      return t0 === t0 ? phaseAt(defs[k], t - t0) : 'down';
    },
    update(t) {
      if (!g) return;
      for (let k = 0; k < pieces.length; k++) g.setLift(pieces[k], this.angle(k, t));
    },
  };
}
