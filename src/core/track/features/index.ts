// Feature modules (docs/CALDERA.md step 2, "The types, sketched"): a map's features (a volcano, a
// coast, later lava streams and a drawbridge), each placed in world space and each saying, through
// a few optional hooks, what it does to the ground, what the ground is, and what's dangerous there.
// The ground (track/ground) runs every feature's hooks in order (`groundFeatures`'); it knows
// features only by these hooks. (A feature may use the ground's constants and its kinds.)
//
// Hooks run at load (shape, surface), or per query (hazard, a pure function of position and time:
// no allocation, deterministic). The renderer's part stays out of core: today the skin still draws
// the volcano and the coast from the layout; a `draw` hook comes with the first feature that needs
// one (the lava stream).

import type { GroundDef } from '../../content';
import { coastFeature } from './coast';
import { volcanoFeature } from './volcano';

/** What's dangerous at a point: lava wrecks a car (the volcano's lake). */
export type Hazard = 'none' | 'lava';

/**
 * Where a grid point is, for `shape`: its place, and where it is by the main road (its nearest
 * sample): `s` along it, `lat` across (m, + right; by distance, so it doesn't jump between
 * stretches), `d` = |lat|, its half width and shoulder there and `edge` (the two summed), and how
 * much of what the layout adds the ground keeps there (`keep`, 0–1: none where a deck's floor
 * starts). One object, refilled for each point: don't keep it.
 */
export interface ShapePoint {
  x: number;
  z: number;
  s: number;
  lat: number;
  d: number;
  half: number;
  shoulder: number;
  edge: number;
  keep: number;
}

export interface Feature {
  /** What it is ('volcano', 'coast'). */
  readonly kind: string;
  /** The ground's height at `p` after this feature, given its height `y` so far (at load). */
  shape?(p: ShapePoint, y: number): number;
  /**
   * What the ground is at a grid point off the roads (a KIND_*, ground/surface.ts), or -1 to leave
   * it to the next (at load; `n` the surface noise there). (A kind, which the renderer colours and
   * `surfaceAt` drives: a feature with a surface of its own, the lava stream's rock banks, adds a
   * kind, or this becomes a surface id then.)
   */
  surface?(x: number, z: number, h: number, n: number): number;
  /** What's dangerous at (x, y, z) at time `t` (s into the race), if anything ('none' to leave it to the next). */
  hazard?(x: number, y: number, z: number, t: number): Hazard;
  /** Signed distance to the coast, positive inland: the coast's own query (trees and the sea's colour ask it), not a pattern for others. */
  coast?(x: number, z: number): number;
}

/**
 * The features of a layout's ground, in the order they shape it. Today they come from GroundDef's
 * `volcano` and `coast`, in that order (the coast then falls into the sea round the volcano); a
 * layout's own `features` list, in its order, comes with the first new one.
 */
export function groundFeatures(def: GroundDef): Feature[] {
  const out: Feature[] = [];
  if (def.volcano) out.push(volcanoFeature(def.volcano, def.sea ?? 0));
  if (def.coast && def.coast.length > 2) out.push(coastFeature(def.coast, def.sea ?? 0));
  return out;
}
