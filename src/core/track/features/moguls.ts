// A mogul field (GroundDef.features, Avalanche): bumps on a grid over a stretch beside or across
// the piste, every other row offset half a bump, like skied moguls.

import type { MogulsDef } from '../../content';
import { cos, smoothstep as smooth } from '../../math';
import type { Feature } from '.';

/** It eases in at its edges over this many meters. */
const EDGE = 6;
/** No trees within this far of it. */
const CLEAR = 6;

export function mogulsFeature(m: MogulsDef): Feature {
  return {
    kind: 'moguls',
    def: m,
    rise(p) {
      const { s, lat } = p;
      if (s < m.s[0] || s > m.s[1] || lat < m.lateral[0] || lat > m.lateral[1]) return 0;
      const fade = smooth(0, EDGE, Math.min(s - m.s[0], m.s[1] - s, lat - m.lateral[0], m.lateral[1] - lat));
      // Bumps on a grid, flat between them; every other row offset half a bump.
      const row = Math.floor(s / m.spacing);
      const off = row % 2 ? m.spacing / 2 : 0;
      const bu = 0.5 - 0.5 * cos((2 * Math.PI * s) / m.spacing);
      const bv = 0.5 - 0.5 * cos((2 * Math.PI * (lat + off)) / m.spacing);
      return m.height * bu * bv * fade;
    },
    bare(s, lat) {
      return s > m.s[0] - CLEAR && s < m.s[1] + CLEAR && lat > m.lateral[0] - CLEAR && lat < m.lateral[1] + CLEAR;
    },
  };
}
