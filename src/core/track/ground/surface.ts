// What the ground is, per grid point (docs/CALDERA.md step 1d): one rule for what's drawn and what's
// driven. The renderer colours each kind (with its own shading and noise on top); the physics, off
// the road's asphalt, drives on it. Before this the sand the coast painted drove as the verge
// beside it (grass), and the beaches were decided twice, once for each.

import type { BakedSpline } from '../bake';
import type { Feature } from '../features';
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
/** Dry sand along an island's coast. */
export const KIND_SAND = 3;
/** Wet sand at the water's edge (the `shore` surface). */
export const KIND_SHORE = 4;
/** A beach's sand (a beach feature): drives as sand, drawn a little damper in patches. */
export const KIND_BEACH = 5;

/** The noise the sand's edges wander by (the renderer's grass and beach shading use it too). */
export const surfaceNoise = (x: number, z: number) => noise(x, z, 23, 7);

/**
 * Per grid point of `land`, what the ground is (a KIND_*): the roads; off them, what a feature says
 * (the coast's sand, a beach's: track/features), the first that does; else the verge.
 */
export function groundKinds(land: Land, main: BakedSpline, marks: BranchMarks, pieces: Pieces, features: readonly Feature[]): Uint8Array {
  const { x0, z0, cell, nx, nz, h, lateral, near } = land;
  const decks = pieces.floors(main.index);
  const say = features.filter((f) => f.surface);
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
      let said = -1;
      for (let f = 0; f < say.length && said < 0; f++) said = say[f].surface!(x, z, h[k], n, i, lateral[k]);
      kind[k] = said >= 0 ? said : KIND_VERGE;
    }
  return kind;
}
