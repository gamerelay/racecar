// An enclosed piece's cross-section (docs/CALDERA.md, "Portals"): the outline of the space over its
// floor, the same for whatever draws it and whatever cuts the ground to it. Where the ground comes
// down over the piece (a tunnel's mouth), the ground is cut to exactly this outline and meets the
// piece's walls along it: no whole grid squares cut out, no gap to the sky.

import { hash01 } from '../../rng';
import type { BakedSpline } from '../bake';

/** How many points an outline has: from its floor's left edge, up the wall, over the vault, down to its right edge. */
export const OUTLINE_POINTS = 6;

/**
 * The outline of an enclosed piece with ceiling `ceiling` at sample `k` of `sp`, into `out` as
 * (across, up) pairs (m, + right; up from the road's plane there): the floor's edges (the road and
 * its shoulder), walls leaning out a little to half the height, and a rough vault (it varies every
 * eight samples, by a hash of where it is, so it's the same everywhere).
 */
export function outlineAt(sp: BakedSpline, k: number, ceiling: number, out: Float64Array): Float64Array {
  const e = sp.width[k] / 2 + sp.shoulder[k];
  const bump = (a: number) => 0.4 * (hash01(sp.index, k >> 3, a) - 0.5);
  out[0] = -e;
  out[1] = 0;
  out[2] = -e - 0.6 + bump(1);
  out[3] = ceiling * 0.55;
  out[4] = -e * 0.55;
  out[5] = ceiling + bump(2);
  out[6] = e * 0.55;
  out[7] = ceiling + bump(3);
  out[8] = e + 0.6 + bump(4);
  out[9] = ceiling * 0.55;
  out[10] = e;
  out[11] = 0;
  return out;
}
