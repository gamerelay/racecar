// A pyramid (GroundDef.features; docs/SAHARA.md's Giza): a square stone pyramid in world space, its
// faces flat planes up to a small flat top, driven up from any side (sandstone: the slope's ground,
// GroundDef.face unset). Off the roads it stands whole; cut back to the main road over PYRAMID_IN m,
// as a hill is, and a branch across it (Sahara's Pyramid Run) shapes its own way over it.

import type { PyramidDef } from '../../content';
import { cos, sin, smoothstep as smooth } from '../../math';
import { KIND_STONE } from '../ground/surface';
import type { Feature } from '.';

/** Off the main road, a pyramid's side comes in over this many meters past its edge. */
const PYRAMID_IN = 12;

/** A pyramid's height over its foot at (x, z) (m; 0 off it). */
export function pyramidHeight(p: PyramidDef): (x: number, z: number) => number {
  const [cx, cz] = p.at;
  const fx = sin(p.rot);
  const fz = cos(p.rot);
  const run = Math.max(1e-6, p.half - p.top);
  return (x, z) => {
    const dx = x - cx;
    const dz = z - cz;
    // How far out it is, square: the farther of along and across.
    const m = Math.max(Math.abs(dx * fx + dz * fz), Math.abs(dx * fz - dz * fx));
    return m >= p.half ? 0 : p.h * Math.min(1, (p.half - m) / run);
  };
}

export function pyramidFeature(p: PyramidDef): Feature {
  const height = pyramidHeight(p);
  return {
    kind: 'pyramid',
    def: p,
    shape(q, y) {
      const h = height(q.x, q.z);
      if (h <= 0) return y;
      const top = p.y + h;
      return top > y ? y + (top - y) * smooth(q.edge, q.edge + PYRAMID_IN, q.d) : y;
    },
    surface(x, z) {
      return height(x, z) > 0.05 ? KIND_STONE : -1;
    },
    bare(_s, _lat, x, z) {
      return height(x, z) > 0;
    },
  };
}
