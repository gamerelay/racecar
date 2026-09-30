// Smashables (PLAN phase 6): small props on the verge (cones, newspaper boxes, hay bales,
// mailboxes, beach umbrellas, fruit stands) that burst when a car hits them and pay a pinch of
// boost. Cheap pieces in the sim, like hazard pieces, so they're the same online: where they stand
// comes from the layout (rows along stretches of road), and when each was broken is state, saved
// in snapshots. A broken one stands again SMASH_RESPAWN s later.
//
// They never wreck anyone: a hit costs a little speed, the bigger the prop the more.

import type { SmashDef } from '../content';
import { hash01 } from '../rng';
import type { Track } from '../track/bake';
import { newHit, sampleAt } from '../track/query';

export interface SmashKind {
  id: string;
  /** Radius (m) a car touches it within, and its height. */
  r: number;
  h: number;
  /** A car's speed is multiplied by this when it hits one. */
  slow: number;
  /** Boost paid (0..1 of a bar), before the boost-by-position scale, and points. */
  boost: number;
  points: number;
}

export const SMASH_KINDS: readonly SmashKind[] = [
  { id: 'cone', r: 0.35, h: 0.8, slow: 0.99, boost: 0.02, points: 50 },
  { id: 'newspaper-box', r: 0.5, h: 1.2, slow: 0.97, boost: 0.03, points: 100 },
  { id: 'hay-bale', r: 0.9, h: 1.4, slow: 0.94, boost: 0.04, points: 150 },
  { id: 'mailbox', r: 0.35, h: 1.3, slow: 0.98, boost: 0.03, points: 100 },
  { id: 'beach-umbrella', r: 0.6, h: 2.6, slow: 0.99, boost: 0.03, points: 100 },
  { id: 'fruit-stand', r: 1.3, h: 1.8, slow: 0.93, boost: 0.05, points: 200 },
];
export const SMASH_IDS = SMASH_KINDS.map((k) => k.id);

/** Seconds a smashed prop stays down. */
export const SMASH_RESPAWN = 30;

export class Smashables {
  readonly n: number;
  readonly kind: Uint8Array;
  readonly spline: Uint8Array;
  readonly s: Float64Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float64Array;
  /** World time each was last smashed (-Infinity: never). */
  readonly brokenAt: Float64Array;

  constructor(track: Track) {
    const hit = newHit();
    const out: { kind: number; spline: number; s: number; x: number; y: number; z: number }[] = [];
    for (const d of track.layout.smashables ?? []) {
      const kind = SMASH_IDS.indexOf(d.kind);
      const sp = d.spline ? track.splines.find((x) => x.id === d.spline) : track.main;
      if (kind < 0 || !sp || !(d.every > 0)) continue;
      const k = SMASH_KINDS[kind];
      let n = 0;
      for (let s = d.s[0]; s <= d.s[1]; s += d.every, n++) {
        for (const side of d.side ? [d.side] : [-1, 1]) {
          // A little along-the-road jitter, the same every race, so a row isn't a picket fence.
          const at = sampleAt(sp, s + (hash01(kind * 7919 + n, side + 2, out.length) - 0.5) * d.every * 0.4, hit);
          const room = at.shoulder;
          if (room < k.r * 2 + 0.4) continue;
          // On the verge: out past the road's edge, a little under halfway to the wall.
          const lat = side * (at.width / 2 + (d.lateral ?? Math.min(room * 0.45, room - k.r - 0.3)));
          out.push({ kind, spline: sp.index, s: at.s, x: at.cx - at.tz * lat, y: at.cy - lat * Math.tan(at.bank), z: at.cz + at.tx * lat });
        }
      }
    }
    this.n = out.length;
    this.kind = Uint8Array.from(out, (p) => p.kind);
    this.spline = Uint8Array.from(out, (p) => p.spline);
    this.s = Float64Array.from(out, (p) => p.s);
    this.x = Float64Array.from(out, (p) => p.x);
    this.y = Float64Array.from(out, (p) => p.y);
    this.z = Float64Array.from(out, (p) => p.z);
    this.brokenAt = new Float64Array(this.n).fill(-Infinity);
  }

  standing(k: number, t: number): boolean {
    return t - this.brokenAt[k] >= SMASH_RESPAWN;
  }

  /** The ones down at `t`, as [index, time smashed] (for snapshots). */
  broken(t: number): [number, number][] {
    const out: [number, number][] = [];
    for (let k = 0; k < this.n; k++) if (!this.standing(k, t)) out.push([k, this.brokenAt[k]]);
    return out;
  }

  restore(list: readonly [number, number][]): void {
    this.brokenAt.fill(-Infinity);
    for (const [k, t] of list) if (k >= 0 && k < this.n) this.brokenAt[k] = t;
  }
}
