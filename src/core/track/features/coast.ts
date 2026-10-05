// An island's coast (docs/PARADISE.md; GroundDef.coast): the land falls away into the sea round its
// coastline, a beach along it; the sand along the water is sand, wet at the water's edge.

import { smoothstep as smooth } from '../../math';
import { ROUGH_IN } from '../ground/shape';
import { KIND_SAND, KIND_SHORE } from '../ground/surface';
import { curve, loopDistance } from '../island';
import type { Feature } from '.';

/** The beach: the ground's height at the waterline over the sea, how steeply it rises inland of it (1:x), and the sea bed's depth (as the lapped island's land, terrain.ts). */
const SHORE = 1.2;
const SHORE_RISE = 0.6;
const SEA_BED = 9;

export function coastFeature(line: [number, number][], sea: number): Feature {
  const loop = curve([...line, line[0]], 12);
  const coast = loopDistance(loop);
  return {
    kind: 'coast',
    coast,
    shape(p, y) {
      // Off the roads (on them, the road's own height).
      const sd = coast(p.x, p.z);
      let isle = y;
      if (sd > 20) isle = Math.max(isle, sea + SHORE);
      isle = Math.min(isle, sea - SEA_BED + (SEA_BED + SHORE) * smooth(-90, 2, sd) + Math.max(0, sd - 2) * SHORE_RISE);
      return y + (isle - y) * smooth(p.edge, p.edge + ROUGH_IN, p.d);
    },
    surface(x, z, h, n) {
      // Wet sand just over the sea; dry within a wandering 12–24 m of the coast, up to 4 m over the
      // sea. (Its distance, a scan of its segments, only where it's low enough to matter.)
      if (h < sea + 0.4) return KIND_SHORE;
      if (h < sea + 4 && coast(x, z) < 12 + 12 * n) return KIND_SAND;
      return -1;
    },
  };
}
