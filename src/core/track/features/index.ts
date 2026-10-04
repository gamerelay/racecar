// Feature modules (docs/CALDERA.md step 2, "The types, sketched"): a map's features (a volcano, a
// coast, mogul fields, canyons, beaches, lava streams; later a drawbridge), each placed in world
// space (the volcano, the coast, a lava stream) or along the main road (the rest), and each saying, through a few
// optional hooks, what it does to the ground, what the ground is, and what's dangerous there. The
// ground (track/ground) runs every feature's hooks in order (`groundFeatures`); it knows features
// only by these hooks. (A feature may use the ground's constants and its kinds.)
//
// Hooks run at load (rise, shape, surface, bare, side), or per query (hazard and sunk, every tick
// for the cars they concern: pure functions of position (and time), no allocation, deterministic). What
// a feature looks like past the ground's colours is the skin's (render/skins/greybox/features.ts,
// by kind): core has no Three.js.

import type { FeatureDef, GroundDef } from '../../content';
import type { BakedSpline } from '../bake';
import { beachFeature } from './beach';
import { canyonFeature } from './canyon';
import { coastFeature } from './coast';
import { lavaStreamFeature } from './lava-stream';
import { mogulsFeature } from './moguls';
import { unevenFeature } from './uneven';
import { volcanoFeature } from './volcano';

/** What's dangerous at a point: lava wrecks a car (the volcano's lake, a lava stream). */
export type Hazard = 'none' | 'lava';

/**
 * Where a grid point is, for `shape`: its place, and where it is by the main road (its nearest
 * sample): `s` along it, `lat` across (m, + right; by distance, so it doesn't jump between
 * stretches), `d` = |lat|, its half width and shoulder there and `edge` (the two summed), its bank
 * (radians, + low on the right), and how
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
  bank: number;
  keep: number;
}

export interface Feature {
  /** What it is ('volcano', 'coast', 'moguls', 'canyon', 'beach', 'uneven'). */
  readonly kind: string;
  /** The layout's own entry for it (GroundDef.features), for anything that reads its numbers (the AI's line down a canyon). */
  readonly def?: FeatureDef;
  /**
   * What it adds to the ground's height at `p` off the road (m; at load), with the layout's swell
   * and rough: kept only as much as they are by a deck's floor (`p.keep`), and before the walls.
   */
  rise?(p: ShapePoint): number;
  /** The ground's height at `p` after this feature, given its height `y` so far (at load: after every `rise`, in order). */
  shape?(p: ShapePoint, y: number): number;
  /**
   * What the ground is at a grid point off the roads (a KIND_*, ground/surface.ts), or -1 to leave
   * it to the next (at load; `n` the surface noise there, `i` the main road's nearest sample and
   * `lat` across it). (A kind, which the renderer colours and
   * `surfaceAt` drives: a feature with a surface of its own, the lava stream's rock banks, adds a
   * kind, or this becomes a surface id then.)
   */
  surface?(x: number, z: number, h: number, n: number, i: number, lat: number): number;
  /** What's dangerous at (x, y, z) at time `t` (s into the race), if anything ('none' to leave it to the next); `height` is the ground's (x, z). */
  hazard?(x: number, y: number, z: number, t: number, height: (x: number, z: number) => number): Hazard;
  /** How far it has sunk the ground `s` m along the main road and `lat` across it (m): down in a canyon, the avalanche goes over you. */
  sunk?(s: number, lat: number): number;
  /** Whether no tree grows `s` m along the main road and `lat` across it, at (x, z) (a canyon and its mouth, a mogul field, a lava stream). */
  bare?(s: number, lat: number, x: number, z: number): boolean;
  /** A beach's side at the main road's sample `i` (-1 left, 1 right) times how far in from its ends (0–1); 0 off it. */
  side?(i: number): number;
  /** Signed distance to the coast, positive inland: the coast's own query (trees and the sea's colour ask it), not a pattern for others. */
  coast?(x: number, z: number): number;
}

/**
 * The features of a layout's ground round `main`, in the order they shape it: GroundDef's `volcano`
 * and `coast` (the coast then falls into the sea round the volcano), then its `features` in their
 * order.
 */
export function groundFeatures(def: GroundDef, main: BakedSpline): Feature[] {
  const out: Feature[] = [];
  if (def.volcano) out.push(volcanoFeature(def.volcano, def.sea ?? 0));
  if (def.coast && def.coast.length > 2) out.push(coastFeature(def.coast, def.sea ?? 0));
  for (const f of def.features ?? []) {
    if (f.kind === 'moguls') out.push(mogulsFeature(f));
    else if (f.kind === 'canyon') out.push(canyonFeature(f));
    else if (f.kind === 'beach') out.push(beachFeature(f, main));
    else if (f.kind === 'uneven') out.push(unevenFeature(f));
    else if (f.kind === 'lava-stream') out.push(lavaStreamFeature(f));
  }
  return out;
}
