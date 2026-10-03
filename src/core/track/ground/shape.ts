// What the layout adds to the ground off the road (GroundDef): long swells, rough snow, mogul
// fields, canyons, and the walls rising at its edges, by where a point is along and across the
// main road. (Feature modules take these over in step 2, placed in world space.)

import type { GroundDef } from '../../content';
import { cos, smoothstep as smooth } from '../../math';
import { hash01 } from '../../rng';

/** Off the road, the rough snow comes in over this many meters past the shoulder (and the land does, from the road's own height). */
export const ROUGH_IN = 10;
/** Mogul fields and canyons ease in at their edges over this many meters. */
const EDGE = 6;

/** Smooth value noise, 0–1, at (x, z) in cells of `size` m (seeded by the grid, so the same everywhere). */
export function noise(x: number, z: number, size: number, seed = 91): number {
  const u = x / size;
  const v = z / size;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const su = fu * fu * (3 - 2 * fu);
  const sv = fv * fv * (3 - 2 * fv);
  const a = hash01(seed, i, j);
  const b = hash01(seed, i + 1, j);
  const c = hash01(seed, i, j + 1);
  const d = hash01(seed, i + 1, j + 1);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

/** How deep a canyon is `d` m from its middle: a flat floor, then a quarter-circle wall (radius 2 × depth, about 60° at the lip). */
export function canyonDepth(d: number, floor: number, depth: number): number {
  const half = floor / 2;
  if (d <= half) return depth;
  const r = 2 * depth;
  const reach = Math.sqrt(2 * r * depth - depth * depth);
  const x = d - half;
  if (x >= reach) return 0;
  return depth - (r - Math.sqrt(r * r - x * x));
}

/** How far down in a canyon `s` m along the main road and `lat` m across it is (0: in none). */
export function canyonAt(def: GroundDef, s: number, lat: number): number {
  let h = 0;
  for (const c of def.canyons ?? []) {
    if (s < c.s[0] || s > c.s[1]) continue;
    const ease = smooth(0, c.ease, Math.min(s - c.s[0], c.s[1] - s));
    h += canyonDepth(Math.abs(lat - c.lateral), c.floor, c.depth * ease);
  }
  return h;
}

/** What `def` adds to the road's height at `s` m along the main road and `lat` m across it (road half width `half`, shoulder `shoulder`). */
export function groundShape(def: GroundDef, s: number, lat: number, half: number, shoulder: number, x: number, z: number): number {
  const a = Math.abs(lat);
  let h = 0;
  // Swell: long, low rolls everywhere, the piste too (it tilts you a little, side to side).
  if (def.swell) h += def.swell.height * (noise(x, z, def.swell.size, 37) - 0.5);
  if (def.rough) h += def.rough.height * noise(x, z, def.rough.size) * smooth(half + shoulder, half + shoulder + ROUGH_IN, a);
  for (const m of def.moguls ?? []) {
    if (s < m.s[0] || s > m.s[1] || lat < m.lateral[0] || lat > m.lateral[1]) continue;
    const fade = smooth(0, EDGE, Math.min(s - m.s[0], m.s[1] - s, lat - m.lateral[0], m.lateral[1] - lat));
    // Bumps on a grid, flat between them; every other row offset half a bump, like skied moguls.
    const row = Math.floor(s / m.spacing);
    const off = row % 2 ? m.spacing / 2 : 0;
    const bu = 0.5 - 0.5 * cos((2 * Math.PI * s) / m.spacing);
    const bv = 0.5 - 0.5 * cos((2 * Math.PI * (lat + off)) / m.spacing);
    h += m.height * bu * bv * fade;
  }
  h -= canyonAt(def, s, lat);
  if (a > def.wallFrom) h += (a - def.wallFrom) * def.wallRise;
  return h;
}
