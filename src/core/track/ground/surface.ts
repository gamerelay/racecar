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
/** Rock: a lava stream's banks and floor (drives as `lava-rock`). */
export const KIND_LAVA_ROCK = 6;
/** Paved ground: a pad (features/pad.ts), drawn and driven as its surface (asphalt). */
export const KIND_PAVED = 7;
/** Dressed stone: a pyramid's faces (features/pyramid.ts), driven as `sandstone`. */
export const KIND_STONE = 8;

/** Over a main-road tunnel's road: ground this far (m) over it is the rock, not the road come up to meet it. */
const TUNNEL_OVER = 2;

/** The noise the sand's edges wander by (the renderer's grass and beach shading use it too). */
export const surfaceNoise = (x: number, z: number) => noise(x, z, 23, 7);

/**
 * Per grid point of `land`, what the ground is (a KIND_*): the roads; off them, what a feature says
 * (the coast's sand, a beach's: track/features), the first that does; else the verge.
 */
export function groundKinds(land: Land, main: BakedSpline, marks: BranchMarks, pieces: Pieces, features: readonly Feature[]): Uint8Array {
  const { x0, z0, cell, nx, nz, h, lateral, near } = land;
  const decks = pieces.floors(main.index);
  // (Those that say first before the rest: a pad's paving over the coast's sand.)
  const say = [...features.filter((f) => f.surface && f.first), ...features.filter((f) => f.surface && !f.first)];
  const kind = new Uint8Array(nx * nz);
  for (let gz = 0; gz < nz; gz++)
    for (let gx = 0; gx < nx; gx++) {
      const k = gz * nx + gx;
      const i = near[k];
      if (marks.onBranch[k] === 2) {
        kind[k] = KIND_BRANCH;
        continue;
      }
      // (Under a deck it's the ground, not the road: the road's up on the deck. Where the ground
      // comes up to the deck, at its ends, it's the road again: the two meet there. Over a tunnel's
      // road it's the rock: the road's down under it.)
      if (Math.abs(lateral[k]) <= main.width[i] / 2 && (!decks?.[i] || (h[k] > main.py[i] - 0.5 && h[k] < main.py[i] + TUNNEL_OVER))) {
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
