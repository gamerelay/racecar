// A lava stream (GroundDef.features; docs/CALDERA.md, "A feature, end to end"): a channel carved
// along a path in world space, the first feature placed there rather than by the main road. Its
// floor `width` m across and `depth` m down, its banks easing out over BANK m of rock, and lava
// FILL m deep in it: a car down in it wrecks, as in the crater's lake. A barrier to drive round, or
// a line to jump (the owner: without it you cross the volcano from the village too easily).

import type { LavaStreamDef } from '../../content';
import { hypot, smoothstep as smooth } from '../../math';
import { KIND_LAVA_ROCK } from '../ground/surface';
import type { Feature } from '.';

/** Its banks ease out over this many meters past its floor (rock: steeper than 1 in 1 is a face, GroundDef.face). */
export const LAVA_BANK = 7;
/** How deep the lava is over its floor (m). */
export const LAVA_FILL = 0.6;
/** The lava's surface is this far over its level (m): a car's wheels in it are in it. */
const LAVA_SKIN = 0.3;
/** Past its banks, rock this much farther (m), and no trees a little farther still. */
const ROCK_OUT = 1.5;
const BARE_OUT = 5;
/** At its source it comes out of the ground over this many meters: the channel deepening, the lava widening (a vent, not a pit). */
export const LAVA_SOURCE = 25;
/** How far its rock's edge wanders with the surface noise (m), so it isn't stepped cell by cell. */
const ROCK_WANDER = 3;

/** The distance (m) from (x, z) to a path's nearest point, within `reach` of it, else Infinity. A box round the path first. */
export function pathDistance(path: readonly (readonly [number, number])[], reach: number): (x: number, z: number) => number {
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
    for (let k = 0; k < n - 1; k++) {
      const dx = ax[k + 1] - ax[k];
      const dz = az[k + 1] - az[k];
      const t = Math.max(0, Math.min(1, ((x - ax[k]) * dx + (z - az[k]) * dz) / (dx * dx + dz * dz || 1)));
      const ex = ax[k] + dx * t - x;
      const ez = az[k] + dz * t - z;
      best = Math.min(best, ex * ex + ez * ez);
    }
    best = Math.sqrt(best);
    return best <= reach ? best : Infinity;
  };
}

/** How much of itself a stream is `d` m from its source (0 to 1 over LAVA_SOURCE): the channel's depth, the lava's width. */
export const lavaSource = (d: number) => smooth(0, LAVA_SOURCE, d);

export function lavaStreamFeature(f: LavaStreamDef): Feature {
  const half = f.width / 2;
  const dist = pathDistance(f.path, half + LAVA_BANK + BARE_OUT);
  const [x0, z0] = f.path[0];
  const source = (x: number, z: number) => lavaSource(hypot(x - x0, z - z0));
  return {
    kind: 'lava-stream',
    def: f,
    shape(p, y) {
      const d = dist(p.x, p.z);
      return d === Infinity ? y : y - f.depth * source(p.x, p.z) * (1 - smooth(half, half + LAVA_BANK, d));
    },
    surface(x, z, _h, n) {
      return dist(x, z) <= half + LAVA_BANK + ROCK_OUT + ROCK_WANDER * (n - 0.5) ? KIND_LAVA_ROCK : -1;
    },
    hazard(x, y, z, _t, ground) {
      // Over its floor, in the lava: not over it in the air (a jump), nor under it (a tunnel).
      return y < ground + LAVA_FILL + LAVA_SKIN && y > ground - 3 && dist(x, z) < half * source(x, z) ? 'lava' : 'none';
    },
    bare(_s, _lat, x, z) {
      return dist(x, z) !== Infinity;
    },
  };
}
