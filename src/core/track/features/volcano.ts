// The volcano (docs/PARADISE.md): a cone off the roads, its crater a shaft down to a lava lake
// (GroundDef.volcano). The lake wrecks a car down in it.

import type { GroundDef } from '../../content';
import { hypot, smoothstep as smooth, sq } from '../../math';
import { shaftHeight } from '../island';
import type { Feature } from '.';

/** Off a road, the volcano's flank comes in over this many meters past its edge (a cutting, not a cliff). */
const CONE_IN = 40;
/** The lake's surface is this far over its level (m): a car's wheels in it are in it. */
const LAVA_SKIN = 0.3;

export function volcanoFeature(v: NonNullable<GroundDef['volcano']>, sea: number): Feature {
  return {
    kind: 'volcano',
    shape(p, y) {
      // It rises off the roads (cut back to them over CONE_IN); a shaft for a crater: inside the
      // lip the walls fall nearly sheer to its floor.
      const cone = sea + shaftHeight(v, p.x, p.z);
      const pit = v.pit !== undefined && hypot(p.x - v.x, p.z - v.z) < v.crater;
      return cone > y || pit ? y + (cone - y) * smooth(p.edge, p.edge + CONE_IN, p.d) : y;
    },
    hazard(x, y, z) {
      return sq(x - v.x) + sq(z - v.z) < sq(v.crater) && y < sea + v.lava + LAVA_SKIN ? 'lava' : 'none';
    },
  };
}
