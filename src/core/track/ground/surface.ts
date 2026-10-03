// What the ground is, per grid point (docs/CALDERA.md step 1d): one rule for what's drawn and what's
// driven. The renderer colours each kind (with its own shading and noise on top); the physics, off
// the road's asphalt, drives on it. Before this the sand the coast painted drove as the verge
// beside it (grass), and the beaches were decided twice, once for each.

import type { GroundDef } from '../../content';
import type { BakedSpline } from '../bake';
import type { BranchMarks } from './branches';
import type { Land } from './land';
import type { Pieces } from './pieces';
import { noise } from './shape';

/** The main road's own surface (on its asphalt, not under a deck). */
export const KIND_ROAD = 0;
/** A branch's road: its own surface (BranchMarks.branchSurface). */
export const KIND_BRANCH = 1;
/** The verge of the road beside it: the stretch's own, else the layout's shoulder surface. */
export const KIND_VERGE = 2;
/** Dry sand: along an island's coast, and on a beach (GroundDef.beaches). */
export const KIND_SAND = 3;
/** Wet sand at the water's edge (the `shore` surface). */
export const KIND_SHORE = 4;

/** The noise the sand's edges wander by (the renderer's grass and beach shading use it too). */
export const surfaceNoise = (x: number, z: number) => noise(x, z, 23, 7);

/**
 * Per grid point of `land`, what the ground is (a KIND_*). On an island (`def.coast`): wet sand just
 * over the sea, dry sand within a wandering 12–24 m of the coast (up to 4 m over the sea). On a
 * beach's side of the main road, sand from the road down, wandering in at its ends, with tufts of
 * the verge by the road.
 */
export function groundKinds(def: GroundDef, land: Land, main: BakedSpline, marks: BranchMarks, pieces: Pieces, beach: Float32Array): Uint8Array {
  const { x0, z0, cell, nx, nz, h, lateral, near } = land;
  const decks = pieces.floors(main.index);
  const sea = def.sea ?? 0;
  const isle = !!def.coast;
  const kind = new Uint8Array(nx * nz);
  for (let gz = 0; gz < nz; gz++)
    for (let gx = 0; gx < nx; gx++) {
      const k = gz * nx + gx;
      const i = near[k];
      if (marks.onBranch[k] === 2) {
        kind[k] = KIND_BRANCH;
        continue;
      }
      // (Under a deck it's the ground, not the road: the road's up on the deck.)
      if (Math.abs(lateral[k]) <= main.width[i] / 2 && !decks?.[i]) {
        kind[k] = KIND_ROAD;
        continue;
      }
      const x = x0 + gx * cell;
      const z = z0 + gz * cell;
      const n = surfaceNoise(x, z);
      const off = Math.abs(lateral[k]) - main.width[i] / 2;
      if (isle && h[k] < sea + 0.4) kind[k] = KIND_SHORE;
      else if (isle && land.coast(x, z) < 12 + 12 * n && h[k] < sea + 4) kind[k] = KIND_SAND;
      else if (beach[i] * lateral[k] > 0 && Math.abs(beach[i]) > 0.2 + 0.6 * n && !(off < 3 + 4 * n && n > 0.6)) kind[k] = KIND_SAND;
      else kind[k] = KIND_VERGE;
    }
  return kind;
}
