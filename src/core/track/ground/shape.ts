// What the layout adds to the ground off the road (GroundDef): long swells, rough snow, what the
// features add (mogul fields, canyons: track/features), and the walls rising at its edges.

import type { GroundDef } from '../../content';
import { smoothstep as smooth } from '../../math';
import type { Feature, ShapePoint } from '../features';
import { hash01 } from '../../rng';

/** Off the road, the rough snow comes in over this many meters past the shoulder (and the land does, from the road's own height). */
export const ROUGH_IN = 10;

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

/**
 * What `def` adds to the road's height at `p` (its swell and rough), with what the features add
 * (`risers`, in order: mogul fields, canyons), and the walls rising at its edges.
 */
export function groundShape(def: GroundDef, p: ShapePoint, risers: readonly Feature[]): number {
  const { x, z, d: a, half, shoulder } = p;
  let h = 0;
  // Swell: long, low rolls everywhere, the piste too (it tilts you a little, side to side).
  if (def.swell) h += def.swell.height * (noise(x, z, def.swell.size, 37) - 0.5);
  if (def.rough) h += def.rough.height * noise(x, z, def.rough.size) * smooth(half + shoulder, half + shoulder + ROUGH_IN, a);
  for (const f of risers) h += f.rise!(p);
  if (a > def.wallFrom) h += (a - def.wallFrom) * def.wallRise;
  return h;
}
