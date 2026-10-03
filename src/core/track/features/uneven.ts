// An uneven road (GroundDef.features, the owner: Paradise Open's jungle mud): low, lumpy bumps over
// a stretch of the main road, on the road and its shoulder (off it, the layout's rough, if it has one),
// two sizes of smooth noise so it's lumpy rather than wavy. Felt and seen, not thrown at you: up to
// `height` peak to trough (typically less), easing in at its ends, and calmer on a banked turn (a drift leans on the bank).

import type { UnevenDef } from '../../content';
import { smoothstep as smooth } from '../../math';
import { noise, ROUGH_IN } from '../ground/shape';
import type { Feature } from '.';

/** It eases in at its ends over this many meters. */
const EASE = 25;
/** On a banked turn it calms to this much of itself (by a bank of BANKED rad): a drift still leans on the bank (at 0.7 it didn't: test/deck.test.ts's drift). */
const ON_BANK = 0.5;
const BANKED = 0.2;

export function unevenFeature(u: UnevenDef): Feature {
  return {
    kind: 'uneven',
    def: u,
    rise(p) {
      const { s } = p;
      if (s <= u.s[0] || s >= u.s[1]) return 0;
      const fade = smooth(0, EASE, Math.min(s - u.s[0], u.s[1] - s)) * (1 - smooth(p.edge, p.edge + ROUGH_IN, p.d)) * (1 - (1 - ON_BANK) * smooth(0, BANKED, Math.abs(p.bank)));
      if (fade <= 0) return 0;
      const lumps = 0.7 * (noise(p.x, p.z, u.size, 53) - 0.5) + 0.3 * (noise(p.x, p.z, u.size * 0.45, 59) - 0.5);
      return u.height * lumps * fade;
    },
  };
}
