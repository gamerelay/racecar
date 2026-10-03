// A beach (GroundDef.features, Paradise Open): off one side of the main road over a stretch, the
// ground from the road down to the sea is sand, wandering in at its ends, with tufts of the verge
// by the road. Palms grow on it.

import type { BeachDef } from '../../content';
import { smoothstep as smooth } from '../../math';
import type { BakedSpline } from '../bake';
import { KIND_BEACH } from '../ground/surface';
import type { Feature } from '.';

/** Its ends fade in over this many meters. */
export const BEACH_FADE = 40;

export function beachFeature(b: BeachDef, main: BakedSpline): Feature {
  // Per main-road sample, its side times how far in from its ends.
  const at = new Float32Array(main.n);
  const len = (((b.s[1] - b.s[0]) % main.length) + main.length) % main.length;
  const side = b.side === 'left' ? -1 : 1;
  for (let d = 0; d <= len; d += main.step) {
    const i = Math.round((((b.s[0] + d) % main.length) + main.length) % main.length / main.step) % main.n;
    at[i] = side * smooth(0, BEACH_FADE, Math.min(d, len - d));
  }
  return {
    kind: 'beach',
    def: b,
    side: (i) => at[i],
    surface(_x, _z, _h, n, i, lat) {
      const off = Math.abs(lat) - main.width[i] / 2;
      return at[i] * lat > 0 && Math.abs(at[i]) > 0.2 + 0.6 * n && !(off < 3 + 4 * n && n > 0.6) ? KIND_BEACH : -1;
    },
  };
}
