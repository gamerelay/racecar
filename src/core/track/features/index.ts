// Feature modules (docs/CALDERA.md step 2, "The types, sketched"): a map's features (a volcano, a
// coast, later lava streams and a drawbridge), each placed in world space and each saying, through
// a few optional hooks, what it does to the ground, what the ground is, and what's dangerous there.
// The ground (track/ground) runs every feature's hooks in the layout's order; a feature never
// reaches into the ground's code, nor it into the feature's.
//
// Hooks run at load (shape, surface), or per query (hazard, a pure function of position: no
// allocation, deterministic). The renderer's part stays out of core (a feature's look is drawn by
// the skin, by its kind).

import type { GroundDef } from '../../content';
import { coastFeature } from './coast';
import { volcanoFeature } from './volcano';

/** What's dangerous at a point: lava wrecks a car (the volcano's lake). */
export type Hazard = 'none' | 'lava';

/** Where a grid point is, for `shape`: its place, and how far it is from the main road's middle (`d`) and its edge there (`edge`), so a feature can ease off the road. */
export interface ShapePoint {
  x: number;
  z: number;
  d: number;
  edge: number;
}

export interface Feature {
  /** What it is ('volcano', 'coast'): the skin draws it by this. */
  readonly kind: string;
  /** The ground's height at `p` after this feature, given its height `y` so far (at load). */
  shape?(p: ShapePoint, y: number): number;
  /** What the ground is at a grid point off the roads (a KIND_*, ground/surface.ts), or -1 to leave it to the next (at load; `n` the surface noise there). */
  surface?(x: number, z: number, h: number, n: number): number;
  /** What's dangerous at (x, y, z), if anything ('none' to leave it to the next). */
  hazard?(x: number, y: number, z: number): Hazard;
  /** Signed distance to the coast, positive inland (the coast's own; trees and the sea's colour ask it). */
  coast?(x: number, z: number): number;
}

/**
 * The features of a layout's ground, in the order they shape it. Today they come from GroundDef's
 * `volcano` and `coast` (the volcano first: the coast then falls into the sea round it).
 */
export function groundFeatures(def: GroundDef): Feature[] {
  const out: Feature[] = [];
  if (def.volcano) out.push(volcanoFeature(def.volcano, def.sea ?? 0));
  if (def.coast && def.coast.length > 2) out.push(coastFeature(def.coast, def.sea ?? 0));
  return out;
}
