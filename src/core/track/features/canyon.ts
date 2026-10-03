// A canyon (GroundDef.features, Avalanche): a trench beside the piste, a flat floor and walls
// curving up, easing in and out at its ends. Down in it the avalanche goes over you; the AI may run
// its floor (ai/racer.ts reads its `def`).

import type { CanyonDef } from '../../content';
import { smoothstep as smooth } from '../../math';
import { canyonDepth } from '../ground/shape';
import type { Feature } from '.';

/** No trees this far along past its ends (its mouth, between it and the piste), and this far past its lip. */
const MOUTH = 40;
const LIP = 4;

export function canyonFeature(c: CanyonDef): Feature {
  /** How far down in it `s` m along the main road and `lat` across it is (0: not in it). */
  const depth = (s: number, lat: number) => {
    if (s < c.s[0] || s > c.s[1]) return 0;
    const ease = smooth(0, c.ease, Math.min(s - c.s[0], c.s[1] - s));
    return canyonDepth(Math.abs(lat - c.lateral), c.floor, c.depth * ease);
  };
  return {
    kind: 'canyon',
    def: c,
    rise: (p) => -depth(p.s, p.lat),
    sunk: depth,
    bare(s, lat) {
      if (depth(s, lat) > 0.2) return true;
      if (s < c.s[0] - MOUTH || s > c.s[1] + MOUTH || Math.sign(lat) !== Math.sign(c.lateral)) return false;
      return Math.abs(lat) < Math.abs(c.lateral) + c.floor / 2 + 2 * c.depth + LIP;
    },
  };
}
