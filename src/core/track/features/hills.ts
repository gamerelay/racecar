// Hills (docs/COASTAL.md; GroundDef.hills): round hills off the roads, in world space. Coastal's
// town on its hillside and the ridge along its cape. Where hills overlap, the higher one is the
// ground. Off a road each is cut back to it, as the volcano is (a cutting, not a cliff), so a road
// across one runs in a valley of its own.

import type { GroundDef } from '../../content';
import { hypot, smoothstep as smooth } from '../../math';
import type { Feature } from '.';

/** Off a road, a hill's side comes in over this many metres past its edge. */
const HILL_IN = 40;

/** The highest of `hills` at (x, z), over the sea (m): each a smooth dome `h` high, `r` across its foot's radius. */
export function hillHeight(hills: NonNullable<GroundDef['hills']>, x: number, z: number): number {
  let best = 0;
  for (let k = 0; k < hills.length; k++) {
    const hl = hills[k];
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
