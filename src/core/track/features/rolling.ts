// Rolling parkland (GroundDef.features; the getaway's Presidio, the owner 2026-10-09: "the ground
// should have some soft hills and mogul like bumps"): over a closed area, soft hills (two sizes of
// smooth noise) and, in patches over them, bumps on a grid, every other row offset half a bump, like
// skied moguls. All of it eases in from the area's edge. A road through it is laid on the hills
// (`rollingSwell`): the ground eases to the road over its verge, so the bumps stop short of it.

import type { RollingDef } from '../../content';
import { cos, smoothstep as smooth } from '../../math';
import { noise } from '../ground/shape';
import { loopDistance } from '../island';
import type { Feature } from '.';

/** The bumps come in patches this many metres across, where the patches' noise is over PATCHY. */
const PATCH = 70;
const PATCHY = 0.52;

/** The area's soft hills (no bumps) and how far in it is (0 at its edge, 1 `ease` m in): a road through it is laid on these. */
export function rollingSwell(r: RollingDef): (x: number, z: number) => { y: number; fade: number } {
  // (Signed, positive inside: 0 at its edge and outside it.)
  const dist = loopDistance(r.area);
  const out = { y: 0, fade: 0 };
  return (x, z) => {
    out.fade = smooth(0, r.ease, dist(x, z));
    out.y = out.fade > 0 ? r.height * (0.7 * noise(x, z, r.size, 67) + 0.3 * noise(x, z, r.size * 0.4, 71)) * out.fade : 0;
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
