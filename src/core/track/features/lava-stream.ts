// A lava stream (GroundDef.features; docs/CALDERA.md, "A feature, end to end"): a channel carved
// along a path in world space, the first feature placed there rather than by the main road. Its
// floor `width` m across and `depth` m down, its banks easing out over BANK m of rock, and lava
// FILL m deep in it: a car down in it wrecks, as in the crater's lake. A barrier to drive round, or
// a line to jump (the owner: without it you cross the volcano from the village too easily).

import type { LavaStreamDef } from '../../content';
import { hypot, smoothstep as smooth } from '../../math';
import { KIND_LAVA_ROCK } from '../ground/surface';
import type { Feature } from '.';
import { LAVA_SKIN } from './volcano';

/** Its banks ease out over this many meters past its floor (rock: steeper than 1 in 1 is a face, GroundDef.face). */
export const LAVA_BANK = 7;
/** How deep the lava is over its floor (m). */
export const LAVA_FILL = 0.6;
/** The lava reaches this far past the floor's edge (m), to meet the banks: drawn and felt. */
export const LAVA_EDGE = 0.8;
/** Past its banks, rock this much farther (m), and no trees a little farther still. */
const ROCK_OUT = 1.5;
const BARE_OUT = 5;
/** How far its rock and its bare ground reach past its floor's edge (m): the validator keeps roads past it. */
export const LAVA_REACH = LAVA_BANK + BARE_OUT;
/** At its source it comes out of the ground over this many meters: the channel deepening, the lava widening (a vent, not a pit). */
const LAVA_SOURCE = 25;
/** How far its rock's edge wanders with the surface noise (m), so it isn't stepped cell by cell. */
const ROCK_WANDER = 3;

/**
 * The distance (m) from (x, z) to a path's nearest point, within `reach` of it, else Infinity (a
 * box round the path first); within reach, that point into `near`, if given.
 */
export function pathDistance(path: readonly (readonly [number, number])[], reach: number, near?: { x: number; z: number }): (x: number, z: number) => number {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of path) {
    minX = Math.min(minX, x - reach);
    maxX = Math.max(maxX, x + reach);
    minZ = Math.min(minZ, z - reach);
    maxZ = Math.max(maxZ, z + reach);
  }
  const n = path.length;
  const ax = Float64Array.from(path, (p) => p[0]);
  const az = Float64Array.from(path, (p) => p[1]);
  return (x, z) => {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return Infinity;
    let best = Infinity;
    let bx = 0;
    let bz = 0;
    for (let k = 0; k < n - 1; k++) {
      const dx = ax[k + 1] - ax[k];
      const dz = az[k + 1] - az[k];
      const t = Math.max(0, Math.min(1, ((x - ax[k]) * dx + (z - az[k]) * dz) / (dx * dx + dz * dz || 1)));
      const px = ax[k] + dx * t;
      const pz = az[k] + dz * t;
      const d = (px - x) * (px - x) + (pz - z) * (pz - z);
      if (d < best) {
        best = d;
        bx = px;
        bz = pz;
      }
    }
    best = Math.sqrt(best);
    if (best > reach) return Infinity;
    if (near) {
      near.x = bx;
      near.z = bz;
    }
    return best;
  };
}

/** How much of itself a stream is `d` m from its source (0 to 1 over LAVA_SOURCE): the channel's depth, the lava's width. */
export const lavaSource = (d: number) => smooth(0, LAVA_SOURCE, d);

/**
 * How far (x, z) is from a stream's floor's middle, as its channel measures it (the floor within
 * width / 2), its pool's floor counted in (within its `r` of its end: that far less `r`, plus
 * width / 2), within `reach`, else Infinity; the nearest point on its path into `near`, or in its
 * pool, the point itself.
 */
export function streamDistance(f: LavaStreamDef, reach: number, near?: { x: number; z: number }): (x: number, z: number) => number {
  const half = f.width / 2;
  const path = pathDistance(f.path, reach, near);
  const pool = f.pool;
  if (!pool) return path;
  const [ex, ez] = f.path[f.path.length - 1];
  return (x, z) => {
    const e = hypot(x - ex, z - ez) - pool.r + half;
    const d = path(x, z);
    if (!(e < d) || e > reach) return d;
    if (near) {
      near.x = x;
      near.z = z;
    }
    return Math.max(0, e);
  };
}

export function lavaStreamFeature(f: LavaStreamDef): Feature {
  const half = f.width / 2;
  const near = { x: 0, z: 0 };
  const dist = streamDistance(f, half + LAVA_REACH, near);
  const [x0, z0] = f.path[0];
  const [ex, ez] = f.path[f.path.length - 1];
  const source = (x: number, z: number) => lavaSource(hypot(x - x0, z - z0));
  const pool = f.pool;
  /** In its pool's reach: how much of the pool's floor (1 on it, easing out over its banks). */
  const inPool = (x: number, z: number) => (pool ? 1 - smooth(pool.r, pool.r + LAVA_BANK, hypot(x - ex, z - ez)) : 0);
  return {
    kind: 'lava-stream',
    def: f,
    shape(p, y) {
      const d = dist(p.x, p.z);
      if (d === Infinity) return y;
      const cut = y - f.depth * source(p.x, p.z) * (1 - smooth(half, half + LAVA_BANK, d));
      // Its pool level, down to its floor (never filled up to it: downhill, the ground stays).
      const k = inPool(p.x, p.z);
      return k > 0 ? Math.min(cut, y + (pool!.floor - y) * k) : cut;
    },
    surface(x, z, _h, n) {
      return dist(x, z) <= half + LAVA_BANK + ROCK_OUT + ROCK_WANDER * (n - 0.5) ? KIND_LAVA_ROCK : -1;
    },
    hazard(x, y, z, _t, height) {
      // In the lava (as drawn: level across, at the floor's height on its path): not over it in
      // the air (a jump), nor under it (a tunnel). (The ground's own height off the path isn't
      // the floor: the grid's 2.5 m cells round the channel's edges.)
      if (!(dist(x, z) < (half + LAVA_EDGE) * source(x, z))) return 'none';
      const level = (pool && hypot(x - ex, z - ez) < pool.r + LAVA_EDGE ? pool.floor : height(near.x, near.z)) + LAVA_FILL;
      return y < level + LAVA_SKIN && y > level - LAVA_FILL - 3 ? 'lava' : 'none';
    },
    bare(_s, _lat, x, z) {
      return dist(x, z) !== Infinity;
    },
  };
}
