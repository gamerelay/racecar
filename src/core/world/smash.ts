// Smashables (PLAN phase 6): small props on the verge (cones, newspaper boxes, hay bales,
// mailboxes, beach umbrellas, fruit stands) that burst when a car hits them and pay a pinch of
// boost. Cheap pieces in the sim, like hazard pieces, so they're the same online: where they stand
// comes from the layout (rows along stretches of road), and when each was broken is state, saved
// in snapshots. A broken one stands again SMASH_RESPAWN s later.
//
// They never wreck anyone: a hit costs a little speed, the bigger the prop the more.

import { hash01 } from '../rng';
import type { Track } from '../track/bake';
import { newHit, projectGlobal, sampleAt } from '../track/query';
import { tan } from '../math';

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
  // A slalom gate's flags (rules/slalom.ts), red and blue gates in turn: a missed one is knocked flat, not a wreck.
  { id: 'gate-red', r: 0.25, h: 3.2, slow: 0.995, boost: 0.005, points: 25 },
  { id: 'gate-blue', r: 0.25, h: 3.2, slow: 0.995, boost: 0.005, points: 25 },
  // A bush on open ground (SmashDef.at): Coastal's hillsides, where you cut down between the switchbacks. Costly to plough through.
  { id: 'bush', r: 1.1, h: 1.5, slow: 0.82, boost: 0.01, points: 50 },
  // A tiki torch on Harbor Town's front road (Paradise Open): a bamboo pole, a flame on top.
  { id: 'tiki-torch', r: 0.25, h: 2.4, slow: 0.995, boost: 0.02, points: 75 },
  // A rack of surfboards on Paradise Open's beach line, upright in a frame.
  { id: 'surf-rack', r: 0.9, h: 2.4, slow: 0.95, boost: 0.04, points: 150 },
  // Sahara's market at Giza, either side of the Sphinx avenue: a stall under a striped awning, and clay pots stacked by it.
  { id: 'market-stall', r: 1.3, h: 2.6, slow: 0.93, boost: 0.05, points: 200 },
  { id: 'clay-pots', r: 0.6, h: 1.1, slow: 0.98, boost: 0.03, points: 100 },
  // The getaway's city (docs/CHASE_MODE.md): its street lamps at the kerb, its street trees, the shrubs by its doors.
  { id: 'street-lamp', r: 0.3, h: 5.2, slow: 0.97, boost: 0.03, points: 100 },
  { id: 'street-tree', r: 0.5, h: 6.5, slow: 0.9, boost: 0.02, points: 75 },
  { id: 'shrub', r: 0.6, h: 1.1, slow: 0.96, boost: 0.02, points: 50 },
  // A tree in one of the Presidio's groves (the getaway's): a cypress, tall and dark; drifted into, flattened, not a wreck.
  { id: 'grove-tree', r: 0.6, h: 9, slow: 0.88, boost: 0.02, points: 75 },
  // A eucalyptus in the Presidio's woods (the getaway's): tall, a pale trunk; a crash through it costs more than a cypress, still not a wreck.
  { id: 'gum-tree', r: 0.7, h: 15, slow: 0.8, boost: 0.03, points: 100 },
];
export const SMASH_IDS = SMASH_KINDS.map((k) => k.id);

/** The road of one on open ground (SmashDef.at): none; it's met wherever a car is. */
export const SMASH_OPEN = 255;

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
    const other = newHit();
    /** Whether (x, z) at height y is on some other road (a branch running alongside, the Sandbar by the beach road). */
    const onAnotherRoad = (x: number, y: number, z: number, own: number, r: number) =>
      track.splines.some((sp) => {
        if (sp.index === own) return false;
        projectGlobal(sp, x, z, other, y);
        return Math.abs(other.cy - y) < 4 && Math.abs(other.lateral) < other.width / 2 + other.shoulder + r;
      });
    const out: { kind: number; spline: number; s: number; x: number; y: number; z: number }[] = [];
    for (const d of track.layout.smashables ?? []) {
      const kind = SMASH_IDS.indexOf(d.kind);
      if (d.at) {
        if (kind < 0 || !track.ground) continue;
        for (const [x, z] of d.at) out.push({ kind, spline: SMASH_OPEN, s: 0, x, y: track.ground.top(x, z), z });
        continue;
      }
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
          const x = at.cx - at.tz * lat;
          const y = at.cy - lat * tan(at.bank);
          const z = at.cz + at.tx * lat;
          // Not where another road runs: a car on it couldn't hit it (only props on your own road count).
          if (onAnotherRoad(x, y, z, sp.index, k.r)) continue;
          out.push({ kind, spline: sp.index, s: at.s, x, y, z });
        }
      }
    }
    // A slalom gate's two flags, on the main road (and on open ground, on the ground).
    (track.layout.slalom ?? []).forEach((g, n) => {
      const kind = SMASH_IDS.indexOf(n % 2 ? 'gate-blue' : 'gate-red');
      const at = sampleAt(track.main, g.s, hit);
      for (const side of [-1, 1]) {
        const lat = g.lateral + (side * g.gap) / 2;
        const x = at.cx - at.tz * lat;
        const z = at.cz + at.tx * lat;
        const y = track.ground ? track.ground.top(x, z) : at.cy - lat * tan(at.bank);
        out.push({ kind, spline: 0, s: at.s, x, y, z });
      }
    });
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
