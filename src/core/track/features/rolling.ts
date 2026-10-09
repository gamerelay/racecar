// Rolling parkland (GroundDef.features; the getaway's Presidio, the owner 2026-10-09: "the ground
// should have some soft hills and mogul like bumps"): over a closed area, soft hills (two sizes of
// smooth noise) and, in patches over them, bumps on a grid, every other row offset half a bump, like
// skied moguls. All of it eases in from the area's edge. A road through it is laid on the hills
// (`rollingSwell`): the ground eases to the road over its verge, so the bumps stop short of it.

import type { RollingDef } from '../../content';
import { cos, hypot, smoothstep as smooth } from '../../math';
import { noise } from '../ground/shape';
import { inLoop } from './city';
import type { Feature } from '.';

/** The bumps come in patches this many metres across, where the patches' noise is over PATCHY. */
const PATCH = 70;
const PATCHY = 0.52;

/** How far (x, z) is from the loop's nearest edge (m). */
function edgeDistance(loop: readonly [number, number][], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [ax, az] = loop[j];
    const [bx, bz] = loop[i];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

/** The area's soft hills (no bumps) and how far in it is (0 at its edge, 1 `ease` m in): a road through it is laid on these. */
export function rollingSwell(r: RollingDef): (x: number, z: number) => { y: number; fade: number } {
  const inside = inLoop(r.area);
  let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, z] of r.area) [x0, z0, x1, z1] = [Math.min(x0, x), Math.min(z0, z), Math.max(x1, x), Math.max(z1, z)];
  const out = { y: 0, fade: 0 };
  return (x, z) => {
    out.y = 0;
    out.fade = 0;
    if (x < x0 || x > x1 || z < z0 || z > z1 || !inside(x, z)) return out;
    out.fade = smooth(0, r.ease, edgeDistance(r.area, x, z));
    if (out.fade <= 0) return out;
    out.y = r.height * (0.7 * noise(x, z, r.size, 67) + 0.3 * noise(x, z, r.size * 0.4, 71)) * out.fade;
    return out;
  };
}

/** The area's height over the ground under it at (x, z): its hills and its bumps. */
export function rollingHeight(r: RollingDef): (x: number, z: number) => number {
  const swell = rollingSwell(r);
  return (x, z) => {
    const { y, fade } = swell(x, z);
    if (fade <= 0 || !r.bumps) return y;
    const patch = smooth(PATCHY, PATCHY + 0.15, noise(x, z, PATCH, 73));
    if (patch <= 0) return y;
    const sp = r.bumps.spacing;
    const off = Math.floor(z / sp) % 2 ? sp / 2 : 0;
    const bu = 0.5 - 0.5 * cos((2 * Math.PI * (x + off)) / sp);
    const bv = 0.5 - 0.5 * cos((2 * Math.PI * z) / sp);
    return y + r.bumps.height * bu * bv * patch * fade;
  };
}

export function rollingFeature(r: RollingDef): Feature {
  const height = rollingHeight(r);
  return {
    kind: 'rolling',
    def: r,
    rise(p) {
      return height(p.x, p.z);
    },
  };
}
