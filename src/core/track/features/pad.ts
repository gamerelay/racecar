// A paved pad (GroundDef.features; Paradise Open's beach car parks): a level rectangle of ground in
// world space, paved, its edges easing back to the ground round it over PAD_BANK m (cut into a
// slope, filled up off it). It drives as asphalt and is drawn as it; no trees on it. What stands on it (the bays' lines, parked cars) is the layout's (a landmark, houses).

import type { PadDef } from '../../content';
import { cos, hypot, sin, smoothstep as smooth } from '../../math';
import { KIND_PAVED } from '../ground/surface';
import type { Feature } from '.';

/** Its edges ease back to the ground round it over this many meters. */
export const PAD_BANK = 4;

/** How far (x, z) is outside a pad's rectangle (m; 0 on it). */
export function padDistance(p: PadDef): (x: number, z: number) => number {
  const [cx, cz] = p.at;
  const [hw, hd] = [p.size[0] / 2, p.size[1] / 2];
  // Its length along its heading (rot, as a landmark's: +z local toward (sin, cos)), its depth across.
  const fx = sin(p.rot);
  const fz = cos(p.rot);
  return (x, z) => {
    const dx = x - cx;
    const dz = z - cz;
    const along = dx * fx + dz * fz;
    const across = dx * fz - dz * fx;
    return hypot(Math.max(0, Math.abs(along) - hw), Math.max(0, Math.abs(across) - hd));
  };
}

export function padFeature(p: PadDef): Feature {
  const out = padDistance(p);
  return {
    kind: 'pad',
    def: p,
    first: true,
    shape(q, y) {
      const d = out(q.x, q.z);
      return d >= PAD_BANK ? y : y + (p.y - y) * (1 - smooth(0, PAD_BANK, d));
    },
    surface(x, z) {
      // (A cell's corner on its edge counts: its edges drawn where it is.)
      return out(x, z) <= 0.5 ? KIND_PAVED : -1;
    },
    bare(_s, _lat, x, z) {
      return out(x, z) < PAD_BANK + 2;
    },
  };
}
