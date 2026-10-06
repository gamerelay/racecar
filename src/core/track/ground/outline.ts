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

/**
 * A gallery's windows (PieceDef.gallery): one every `every` m along it, `open` m of it open, from
 * `sill` m over the road to where its wall starts to lean in (0.55 of the ceiling, the outline's
 * second point). Each opening's middle `every` / 2 on from the gallery's start.
 */
export const GALLERY = { every: 9, open: 6, sill: 0.9 };

/** How far (m) `s` is inside one of `gallery`'s openings along it (negative: in the pier between two, or off the gallery). */
export function windowIn(gallery: { s: [number, number] }, s: number): number {
  if (s < gallery.s[0] || s > gallery.s[1]) return -Infinity;
  // (Only whole openings: none cut off by the gallery's end.)
  const n = Math.floor((s - gallery.s[0]) / GALLERY.every);
  if (gallery.s[0] + (n + 0.5) * GALLERY.every + GALLERY.open / 2 > gallery.s[1]) return -Infinity;
  const u = s - gallery.s[0] - n * GALLERY.every;
  return GALLERY.open / 2 - Math.abs(u - GALLERY.every / 2);
}
