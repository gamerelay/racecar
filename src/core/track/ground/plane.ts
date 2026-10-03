// A road's plane carried out from one of its samples: what the ground is on the road, what a deck's
// floor is, and what a branch cuts into the land.

import { tan } from '../../math';
import type { BakedSpline } from '../bake';
import { across, along } from '../frame';

/** The road's plane at (x, z) as `sp`'s sample `i` carries it out (its slope along, its bank across, a kicker's height over its flank). */
export function planeOf(sp: BakedSpline, i: number, x: number, z: number): number {
  const j = sp.closed ? (i + 1) % sp.n : Math.min(sp.n - 1, i + 1);
  const ahead = along(sp, i, x, z);
  const lat = across(sp, i, x, z);
  const rise = (sp.py[j] - sp.py[i]) / sp.step;
  // A kicker's height runs out past the road's edge over its flank (RampDef.flank; 8 m unset),
  // so it's a bump on the piste, not a ridge across the mountain.
  let ramp = 0;
  if (sp.ramp[i] > 0 || sp.ramp[j] > 0) {
    const over = Math.abs(lat) - sp.width[i] / 2 - sp.shoulder[i];
    const fade = over <= 0 ? 1 : Math.max(0, 1 - over / (sp.rampFlank[i] || 8));
    ramp = (sp.ramp[i] + ((sp.ramp[j] - sp.ramp[i]) * ahead) / sp.step) * fade;
  }
  return sp.py[i] + ramp + ahead * rise - lat * tan(sp.bank[i]);
}
