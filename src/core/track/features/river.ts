// A river (GroundDef.features; docs/SAHARA.md's oasis river): a channel cut along a path in world
// space, its water at a level that falls from the path's start to its end, shallow enough to drive
// through (slow going: the `river` surface), green banks either side. Unlike a lava stream it may
// cross a road: off the roads it's cut, and where a road crosses it the road says how (a ford: the
// road dips under the water, its `ford` zone; a bridge: a deck piece over it, the ground under it
// fallen to the channel's floor, PieceDef.under). Nothing in it wrecks a car.

import type { RiverDef } from '../../content';
import { hypot, smoothstep as smooth } from '../../math';
import { KIND_OASIS, KIND_WATER } from '../ground/surface';
import type { Feature } from '.';
import { pathDistance } from './lava-stream';

/** Its banks ease out over this many meters past its floor. */
export const RIVER_BANK = 9;
/**
 * Its banks stand at least this far over its water (m), so it never runs above the ground round it
 * (a levee, on low ground), fading out over RIVER_LEVEE_OUT m past its banks.
 */
const RIVER_LEVEE = 0.5;
const RIVER_LEVEE_OUT = 10;
/** Off a road, its cut comes in over this many meters past the road's shoulder. */
const RIVER_IN = 6;
/** Green ground (the oasis's) out this far past its banks (m), wandering with the surface noise. */
const OASIS_OUT = 10;
const OASIS_WANDER = 8;

/**
 * Along a river's path: the distance (m) from (x, z) to it, within `reach`, else Infinity, and its
 * water's level there (m) into `out.level`, by how far along the path its nearest point is.
 */
export function riverAt(f: RiverDef, reach: number): (x: number, z: number, out: { level: number }) => number {
  const near = { x: 0, z: 0 };
  const dist = pathDistance(f.path, reach, near);
  const n = f.path.length;
  // How far along each point is, and the whole length.
  const at = new Float64Array(n);
  for (let k = 1; k < n; k++) at[k] = at[k - 1] + hypot(f.path[k][0] - f.path[k - 1][0], f.path[k][1] - f.path[k - 1][1]);
  const total = at[n - 1] || 1;
  return (x, z, out) => {
    const d = dist(x, z);
    if (d === Infinity) return d;
    // The nearest point's distance along (on its segment: the nearest of the segments' ends' spans).
    let best = Infinity;
    let along = 0;
    for (let k = 0; k < n - 1; k++) {
      const [ax, az] = f.path[k];
      const [bx, bz] = f.path[k + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((near.x - ax) * dx + (near.z - az) * dz) / (dx * dx + dz * dz || 1)));
      const e = hypot(ax + dx * t - near.x, az + dz * t - near.z);
      if (e < best) {
        best = e;
        along = at[k] + (at[k + 1] - at[k]) * t;
      }
    }
    out.level = f.level[0] + (f.level[1] - f.level[0]) * (along / total);
    return d;
  };
}

export function riverFeature(f: RiverDef): Feature {
  const half = f.width / 2;
  const reach = half + RIVER_BANK + Math.max(OASIS_OUT + OASIS_WANDER, RIVER_LEVEE_OUT);
  const at = riverAt(f, reach);
  const w = { level: 0 };
  return {
    kind: 'river',
    def: f,
    shape(p, y) {
      const d = at(p.x, p.z, w);
      if (d === Infinity) return y;
      // Its floor `depth` under the water, its banks easing up to the ground (at least a levee over
      // the water); cut back to a road.
      const floor = w.level - f.depth;
      const top = y + Math.max(0, w.level + RIVER_LEVEE - y) * (1 - smooth(half + RIVER_BANK, half + RIVER_BANK + RIVER_LEVEE_OUT, d));
      const cut = floor + (top - floor) * smooth(half, half + RIVER_BANK, d);
      return y + (cut - y) * smooth(p.edge, p.edge + RIVER_IN, p.d);
    },
    surface(x, z, h, n) {
      const d = at(x, z, w);
      if (d === Infinity) return -1;
      // Under its water: water. Its banks and a strip past them: the oasis's green.
      if (h < w.level - 0.05) return KIND_WATER;
      return d <= half + RIVER_BANK + OASIS_OUT + OASIS_WANDER * (n - 0.5) ? KIND_OASIS : -1;
    },
    bare(_s, _lat, x, z) {
      return at(x, z, w) <= half + RIVER_BANK;
    },
  };
}
