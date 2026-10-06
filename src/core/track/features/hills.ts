// Hills (docs/COASTAL.md; GroundDef.hills): round hills off the roads, in world space. Coastal's
// town on its hillside and the ridge along its cape. Where hills overlap, the higher one is the
// ground. Off a road each is cut back to it, as the volcano is (a cutting, not a cliff), so a road
// across one runs in a valley of its own.

import type { GroundDef } from '../../content';
import { hypot, smoothstep as smooth } from '../../math';
import type { Feature } from '.';

/** Off a road, a hill's side comes in over this many metres past its edge. */
const HILL_IN = 40;

/** The highest of `hills` at (x, z), over the sea (m): each a smooth dome `h` high, `r` across its foot's radius, or a ridge (GroundDef's Hill). */
export function hillHeight(hills: NonNullable<GroundDef['hills']>, x: number, z: number): number {
  let best = 0;
  for (let k = 0; k < hills.length; k++) {
    const hl = hills[k];
    if (hl.to) {
      // A ridge: the nearest point on its crest, its height there, and which side it falls to.
      const dx = hl.to[0] - hl.x;
      const dz = hl.to[1] - hl.z;
      const len = hypot(dx, dz);
      const tx = dx / len;
      const tz = dz / len;
      const t = Math.min(len, Math.max(0, (x - hl.x) * tx + (z - hl.z) * tz));
      const d = hypot(x - hl.x - tx * t, z - hl.z - tz * t);
      const r = (x - hl.x) * -tz + (z - hl.z) * tx > 0 ? (hl.r2 ?? hl.r) : hl.r;
      if (d < r) best = Math.max(best, (hl.h + ((hl.h2 ?? hl.h) - hl.h) * (t / len)) * (1 - smooth(0, r, d)));
      continue;
    }
    const d = hypot(x - hl.x, z - hl.z);
    if (d < hl.r) best = Math.max(best, hl.h * (1 - smooth(0, hl.r, d)));
  }
  return best;
}

export function hillsFeature(hills: NonNullable<GroundDef['hills']>, sea: number): Feature {
  return {
    kind: 'hills',
    shape(p, y) {
      const top = sea + hillHeight(hills, p.x, p.z);
      // (Over a main-road tunnel, uncut: the road runs under it.)
      return top > y ? y + (top - y) * (p.rock ? 1 : smooth(p.edge, p.edge + HILL_IN, p.d)) : y;
    },
  };
}
