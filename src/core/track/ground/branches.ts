// The branches shape the ground off the main road: their own height on them, cut into a slope or
// built up over a dip. Not where a piece carries them (a deck or a gap): there the ground stays as
// it is, over a tunnel or under a bridge. And where the slope comes down into an enclosed piece's
// space, its mouth, the ground is opened.

import { hypot, smoothstep as smooth } from '../../math';
import type { BakedSpline } from '../bake';
import { along } from '../frame';
import type { Land } from './land';
import type { Pieces } from './pieces';
import { planeOf } from './plane';
import { ROUGH_IN } from './shape';

/** Per grid point: on a branch (2 its road, 1 its verge and a little past: no trees, 0 off it), that road's surface, and 1 where the ground's opened at a tunnel's mouth. */
export interface BranchMarks {
  onBranch: Uint8Array;
  branchSurface: Uint8Array;
  hole: Uint8Array;
}

/** Shapes `land.h` round the branches (in place), and marks where they are. */
export function shapeBranches(land: Land, main: BakedSpline, branches: readonly BakedSpline[], pieces: Pieces): BranchMarks {
  const { x0, z0, cell, nx, nz, h, lateral, near } = land;
  const onBranch = new Uint8Array(nx * nz);
  const branchSurface = new Uint8Array(nx * nz);
  const hole = new Uint8Array(nx * nz);
  const bestD = new Float32Array(nx * nz).fill(Infinity);
  const bestY = new Float32Array(nx * nz);
  const bestEdge = new Float32Array(nx * nz);
  const bestHalf = new Float32Array(nx * nz);
  const each = (sp: BakedSpline, i: number, reach: number, fn: (g: number, x: number, z: number, d: number) => void) => {
    const gx0 = Math.max(0, Math.floor((sp.px[i] - reach - x0) / cell));
    const gx1 = Math.min(nx - 1, Math.ceil((sp.px[i] + reach - x0) / cell));
    const gz0 = Math.max(0, Math.floor((sp.pz[i] - reach - z0) / cell));
    const gz1 = Math.min(nz - 1, Math.ceil((sp.pz[i] + reach - z0) / cell));
    for (let gz = gz0; gz <= gz1; gz++)
      for (let gx = gx0; gx <= gx1; gx++) {
        const x = x0 + gx * cell;
        const z = z0 + gz * cell;
        const d = hypot(x - sp.px[i], z - sp.pz[i]);
        if (d < reach) fn(gz * nx + gx, x, z, d);
      }
  };
  // Each grid point near a branch takes its nearest sample's plane, eased out past its edge into
  // what's there (a cutting into a slope). Not on the main road: it has the junctions.
  for (const sp of branches) {
    for (let i = 0; i < sp.n; i++) {
      const edge = sp.width[i] / 2 + sp.shoulder[i];
      if (pieces.covers(sp.index, i)) continue;
      each(sp, i, edge + ROUGH_IN, (g, x, z, d) => {
        if (d >= bestD[g]) return;
        bestD[g] = d;
        bestY[g] = planeOf(sp, i, x, z);
        bestEdge[g] = edge;
        bestHalf[g] = sp.width[i] / 2;
        branchSurface[g] = sp.surface[i];
      });
    }
  }
  for (let g = 0; g < nx * nz; g++) {
    const d = bestD[g];
    if (d === Infinity) continue;
    const i = near[g];
    if (Math.abs(lateral[g]) < main.width[i] / 2 + main.shoulder[i]) continue;
    h[g] += (bestY[g] - h[g]) * (1 - smooth(bestEdge[g], bestEdge[g] + ROUGH_IN, d));
    onBranch[g] = d <= bestHalf[g] ? 2 : d <= bestEdge[g] + 3 ? 1 : 0;
  }
  // An enclosed piece's mouth: where the slope comes down into the space over its floor (after the
  // cuttings are shaped: one's floor at the road's height isn't). No trees there.
  for (const sp of branches) {
    const at = pieces.at(sp.index);
    if (!at) continue;
    for (let i = 0; i < sp.n; i++) {
      const ceiling = at[i] >= 0 ? pieces.list[at[i]].ceiling : NaN;
      if (!(ceiling > 0)) continue;
      const road = sp.py[i];
      each(sp, i, sp.width[i] / 2 + sp.shoulder[i], (g, x, z) => {
        // Only across this sample's own strip of road (not spilling back onto a cutting behind
        // the first), and never in the main road: a mouth stays clear of it.
        if (Math.abs(along(sp, i, x, z)) > sp.step * 0.75) return;
        if (Math.abs(lateral[g]) < main.width[near[g]] / 2 + main.shoulder[near[g]] + 2) return;
        // Over the road and under its ceiling: not a cutting's floor at the road's height, nor
        // the slope over the mouth (its arch frames the edge).
        if (h[g] > road + 0.8 && h[g] < road + ceiling) hole[g] = 1;
      });
    }
  }
  // A main-road tunnel's mouths the same (its rock kept over it: land.ts). Its rock rises sheer 4 m
  // in (TUNNEL_MOUTH), so this marks little but the slivers of shoulder at the face.
  const mainAt = pieces.at(main.index);
  if (mainAt)
    for (let i = 0; i < main.n; i++) {
      const p = mainAt[i] >= 0 ? pieces.list[mainAt[i]] : undefined;
      if (!p || !(p.ceiling > 0) || p.building) continue;
      const road = main.py[i];
      each(main, i, main.width[i] / 2 + main.shoulder[i], (g, x, z) => {
        if (Math.abs(along(main, i, x, z)) > main.step * 0.75) return;
        if (h[g] > road + 0.8 && h[g] < road + p.ceiling) hole[g] = 1;
      });
    }
  return { onBranch, branchSurface, hole };
}
