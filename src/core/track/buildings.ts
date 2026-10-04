// Buildings (docs/CALDERA.md step 3c; PieceDef.building): an enclosed piece built on the ground, a
// hall a road runs through, not a tunnel dug through rock. Its walls stand along the road's edges,
// solid from both sides for every car: a car in the hall meets them as the road's walls (which are
// off along it), and one outside, off the road beside it, meets them too. They're solid props
// (BakedProp) on no road, so the AI's line and a respawn don't step round them as if they were on it.

import type { BakedProp, BakedSpline } from './bake';
import type { Pieces } from './ground/pieces';
import { atan2 } from '../math';
import { newHit, sampleAt } from './query';

/** How thick a building's walls are (m), out from its road's edge. */
export const BUILDING_WALL = 0.8;
/** How far its walls stand over its ceiling (m): its roof. */
export const BUILDING_ROOF = 1.2;
/** Its walls are boxes this long (m) along the road, overlapping a little, so they follow a bend. */
const CHUNK = 4;
const OVERLAP = 0.2;

/**
 * The walls of the buildings among `pieces`, as solid props (kind 'building-wall', spline -1): from
 * its first sample to its last, as the skin draws them, overlapping each other a little.
 */
export function buildingWalls(pieces: Pieces, splines: readonly BakedSpline[]): BakedProp[] {
  const out: BakedProp[] = [];
  const at = newHit();
  for (const p of pieces.list) {
    if (!p.building) continue;
    const sp = splines[p.spline];
    const a = Math.ceil(p.s[0] / sp.step) * sp.step;
    const b = Math.min(sp.n - 1, Math.floor(p.s[1] / sp.step)) * sp.step;
    const n = Math.max(1, Math.round((b - a) / CHUNK));
    for (let c = 0; c < n; c++) {
      // (Overlapping the next only between them: its ends are its first and last samples.)
      const lo = a + ((b - a) * c) / n - (c > 0 ? OVERLAP : 0);
      const hi = a + ((b - a) * (c + 1)) / n + (c < n - 1 ? OVERLAP : 0);
      const s = (lo + hi) / 2;
      sampleAt(sp, s, at);
      const out0 = at.width / 2 + at.shoulder + BUILDING_WALL / 2;
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
          x: at.cx - at.tz * lat,
          y: at.cy,
          z: at.cz + at.tx * lat,
          hx: BUILDING_WALL / 2,
          hy: (p.ceiling + BUILDING_ROOF) / 2,
          hz: (hi - lo) / 2,
          heading: atan2(at.tx, at.tz),
        });
      }
    }
  }
  return out;
}
