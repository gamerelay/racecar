// Buildings (docs/CALDERA.md step 3c; PieceDef.building): an enclosed piece built on the ground, a
// hall a road runs through, not a tunnel dug through rock. Its walls stand along the road's edges,
// solid from both sides for every car: a car in the hall meets them as the road's walls (which are
// off along it), and one outside, off the road beside it, meets them too. They're solid props
// (BakedProp) on no road, so the AI's line and a respawn don't step round them as if they were on it.

import type { BakedProp, BakedSpline } from './bake';
import type { Pieces } from './ground/pieces';
import { atan2 } from '../math';

/** How thick a building's walls are (m), out from its road's edge. */
export const BUILDING_WALL = 0.8;
/** How far its walls stand over its ceiling (m): its roof. */
export const BUILDING_ROOF = 1.2;
/** Its walls are boxes this long (m) along the road, overlapping a little, so they follow a bend. */
const CHUNK = 4;
const OVERLAP = 0.2;

/** The walls of the buildings among `pieces`, as solid props (kind 'building-wall', spline -1). */
export function buildingWalls(pieces: Pieces, splines: readonly BakedSpline[]): BakedProp[] {
  const out: BakedProp[] = [];
  for (const p of pieces.list) {
    if (!p.building) continue;
    const sp = splines[p.spline];
    const len = p.s[1] - p.s[0];
    const n = Math.max(1, Math.round(len / CHUNK));
    for (let c = 0; c < n; c++) {
      const s = p.s[0] + (len * (c + 0.5)) / n;
      const k = Math.min(sp.n - 1, Math.max(0, Math.round(s / sp.step)));
      const out0 = sp.width[k] / 2 + sp.shoulder[k] + BUILDING_WALL / 2;
      for (const side of [-1, 1]) {
        const lat = side * out0;
        // right = (-tz, tx)
        out.push({
          kind: 'building-wall',
          solid: true,
          wall: true,
          spline: -1,
          s,
          lateral: lat,
          x: sp.px[k] - sp.tz[k] * lat,
          y: sp.py[k],
          z: sp.pz[k] + sp.tx[k] * lat,
          hx: BUILDING_WALL / 2,
          hy: (p.ceiling + BUILDING_ROOF) / 2,
          hz: len / n / 2 + OVERLAP,
          heading: atan2(sp.tx[k], sp.tz[k]),
        });
      }
    }
  }
  return out;
}
