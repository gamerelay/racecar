// Open ground (docs/AVALANCHE.md): a heightfield the car drives on everywhere, the same one the
// renderer draws, for a layout with `ground`, and the pieces over and under it (docs/CALDERA.md,
// "The core idea: pieces"): decks, tunnels, gaps. All of it is yours to drive, ridges and
// mountainsides too: out of bounds is only off the grid, where the ground ends.
//
// What's under a point is one question, `cast`: the highest floor at or below it (a piece's or the
// ground), which piece, the ground, and the space it's in (open, inside an enclosed piece, or in the
// rock). The physics, the camera and the tools all ask it.
//
//   land.ts      the heightfield: the road, the land between, then the features (track/features)
//   shape.ts     what the layout adds off the road: swell, rough, moguls, canyons, walls
//   branches.ts  the branches' cuttings, and the tunnels' mouths opened in the slope
//   pieces.ts    the pieces: which samples they carry, how they shape the ground, their floors
//   plane.ts     a road's plane carried out from a sample
//   search.ts    the main road's sample nearest a point
//
// Pure arithmetic from the layout, so every screen builds the same ground.

import type { GroundDef, PieceDef } from '../../content';
import type { BakedSpline } from '../bake';
import { shapeBranches } from './branches';
import { buildLand } from './land';
import { DECK_CATCH, definePieces, floorQuery, type Pieces } from './pieces';
import { groundKinds } from './surface';
import { groundFeatures, type Feature, type Hazard } from '../features';
import type { Override } from '../overrides';

export { DECK_CATCH, DECK_SLACK, type Piece, type Pieces } from './pieces';
export { canyonDepth, groundShape, noise } from './shape';
export { BEACH_FADE } from '../features/beach';
export { OUTLINE_POINTS, outlineAt } from './outline';
export type { Feature, Hazard } from '../features';
export { KIND_BEACH, KIND_BRANCH, KIND_ROAD, KIND_SAND, KIND_SHORE, KIND_VERGE, surfaceNoise } from './surface';

/** A tunnel's usual ceiling over its road (m): the Lava Tube's (PieceDef.ceiling). */
export const TUBE_H = 7;

/** Where a point is: open air, inside an enclosed piece (under its ceiling), or in the rock. */
export type Space = 'open' | 'enclosed' | 'rock';

/** What a cast down from a point found (Ground.cast). Filled in place: the caller owns it. */
export interface Cast {
  /** What something there stands on: the highest floor at or below it, a piece's or the ground's. */
  floor: number;
  /** The piece it stands on (its index in `pieces.list`), -1 for the ground. */
  piece: number;
  /** The ground's height there. */
  ground: number;
  /** The floor of a piece there at or below the point (by DECK_CATCH), stood on or not (NaN: none): a tunnel's road under a car on the slope over it. */
  over: number;
  /** That piece's ceiling (its height, m), NaN if it's open or there's none. Under it, from its floor (by DECK_CATCH) up, is `enclosed`. */
  ceiling: number;
  space: Space;
}

export const newCast = (): Cast => ({ floor: 0, piece: -1, ground: 0, over: NaN, ceiling: NaN, space: 'open' });

export interface Ground {
  /** The ground's height at (x, z), bilinear between grid points. */
  height(x: number, z: number): number;
  /** Its slope at (x, z): the rise per meter along x and along z, into `out`. */
  slope(x: number, z: number, out: { x: number; z: number }): { x: number; z: number };
  /** The grid, for drawing it: heights and, per point, how far across the main road it lies (m, + right). */
  readonly x0: number;
  readonly z0: number;
  readonly cell: number;
  readonly nx: number;
  readonly nz: number;
  readonly h: Float32Array;
  readonly lateral: Float32Array;
  /** Per point, the main road's sample nearest it. */
  readonly near: Int32Array;
  /** Off the grid, where the ground ends: out of bounds (anywhere drawn is in bounds). */
  outside(x: number, z: number): boolean;
  /** The pieces (decks, tunnels, gaps), and which road samples they carry. */
  readonly pieces: Pieces;
  /** Per grid point: 2 on a branch's road, 1 on its verge (and a little past: no trees), 0 off it. */
  readonly onBranch: Uint8Array;
  /** Per grid point on a branch's road, its surface. */
  readonly branchSurface: Uint8Array;
  /** Per grid point, what the ground is (ground/surface.ts, a KIND_*): what's drawn there and what's driven. */
  readonly kind: Uint8Array;
  /** What the ground is at (x, z) (its nearest grid point's kind), -1 off the grid. */
  kindAt(x: number, z: number): number;
  /** Per grid point, 1 where the slope comes down into a tunnel's space at its mouth (no trees there; the drawing cuts the ground to the tunnel's own outline: render's portal.ts). */
  readonly hole: Uint8Array;
  /** The sea's level (GroundDef.sea), if the ground has one. */
  readonly sea?: number;
  /** Steeper than this is a rock face (GroundDef.face), if the ground has them. */
  readonly face?: number;
  /**
   * Per main-road sample, its beach (a beach feature): which side (-1 left, 1 right) times how
   * far in from the beach's ends (0 to 1 over BEACH_FADE m); 0 with none.
   */
  readonly beach: Float32Array;
  /** Signed distance to the coast (GroundDef.coast), positive inland; Infinity with none. */
  coast(x: number, z: number): number;
  /** The features shaping it (track/features), in order. */
  readonly features: readonly Feature[];
  /** How far the features have sunk the ground `s` m along the main road and `lat` across it (m: down in a canyon). */
  sunk(s: number, lat: number): number;
  /** Whether no tree grows `s` m along the main road and `lat` across it (a feature says so: a canyon, a mogul field). */
  bare(s: number, lat: number): boolean;
  /** What's dangerous at (x, y, z) at time `t` (s; default 0): a feature's say (the volcano's lava lake), else 'none'. */
  hazard(x: number, y: number, z: number, t?: number): Hazard;
  /**
   * A piece's floor at (x, z): its road's plane, if the point is over one, within `slack` m past
   * its edges (the road and its shoulder); the highest at or below `y` (by DECK_CATCH), if there's
   * more than one. NaN if there's none.
   */
  pieceFloor(x: number, z: number, slack?: number, y?: number): number;
  /** What's under (x, y, z) (y Infinity: from the sky), into `out`: see Cast. */
  cast(x: number, y: number, z: number, out: Cast): Cast;
  /** What's under (x, z) for something at height `y`: the highest floor at or below it (unset: the highest), else the ground. */
  top(x: number, z: number, y?: number): number;
  /** The slope of `top` at (x, z) for something at height `y`, into `out`. */
  topSlope(x: number, z: number, y: number, out: { x: number; z: number }): { x: number; z: number };
}

/** The ground for `def` round `main`, its `branches` and the layout's `pieces`; `overrides` have the last word on its casts and hazards, inside their regions. */
export function buildGround(def: GroundDef, main: BakedSpline, branches: BakedSpline[] = [], pieceDefs: readonly PieceDef[] = [], overrides: readonly Override[] = []): Ground {
  const pieces = definePieces(pieceDefs, [main, ...branches]);
  const features = groundFeatures(def, main);
  const land = buildLand(def, main, pieces, features);
  const { x0, z0, cell, nx, nz, h } = land;
  const { onBranch, branchSurface, hole } = shapeBranches(land, main, branches, pieces);
  const floors = floorQuery(pieces, main, branches, land);
  // The beaches' sides, per main-road sample (for the palms, and the tools).
  const beach = new Float32Array(main.n);
  for (const f of features) if (f.side) for (let i = 0; i < main.n; i++) if (f.side(i)) beach[i] = f.side(i);
  const sunkers = features.filter((f) => f.sunk);
  const kind = groundKinds(land, main, { onBranch, branchSurface, hole }, pieces, features);
  const hazards = features.filter((f) => f.hazard);
  const coastOf = features.find((f) => f.coast);
  const casters = overrides.filter((o) => o.cast);
  const endangerers = overrides.filter((o) => o.hazard);
  const at = (gx: number, gz: number) => h[Math.min(nz - 1, Math.max(0, gz)) * nx + Math.min(nx - 1, Math.max(0, gx))];
  const scratch = newCast();
  return {
    x0,
    z0,
    cell,
    nx,
    nz,
    h,
    lateral: land.lateral,
    near: land.near,
    pieces,
    beach,
    onBranch,
    branchSurface,
    kind,
    kindAt(x, z) {
      const gx = Math.round((x - x0) / cell);
      const gz = Math.round((z - z0) / cell);
      return gx < 0 || gz < 0 || gx >= nx || gz >= nz ? -1 : kind[gz * nx + gx];
    },
    hole,
    sea: def.sea,
    face: def.face,
    features,
    coast: coastOf ? coastOf.coast! : () => Infinity,
    sunk(s, lat) {
      let d = 0;
      for (const f of sunkers) d += f.sunk!(s, lat);
      return d;
    },
    bare(s, lat) {
      return features.some((f) => f.bare?.(s, lat));
    },
    hazard(x, y, z, t = 0) {
      let h: Hazard = 'none';
      for (let f = 0; f < hazards.length && h === 'none'; f++) h = hazards[f].hazard!(x, y, z, t);
      for (const o of endangerers) if (o.inside(x, z)) h = o.hazard!(h, x, y, z, t);
      return h;
    },
    pieceFloor: floors.floor,
    cast(x, y, z, out) {
      const d = floors.floor(x, z, 0, y);
      const p = floors.found();
      const gh = this.height(x, z);
      out.ground = gh;
      out.over = d;
      out.ceiling = d === d ? d + pieces.list[p].ceiling : NaN;
      // A piece's floor is what it stands on over the ground (a bridge); under the ground by more
      // than a hard landing (a tunnel's roof over the car), too; and under it by less (a tunnel's
      // mouth, its slope rising off the road) for a car on the floor, within a hard landing of it:
      // the slope over the mouth rises off the road, and riding it carried cars up into the rock.
      const on = d === d && (d >= gh || gh > y + DECK_CATCH || (y !== Infinity && Math.abs(y - d) <= DECK_CATCH));
      out.floor = on ? d : gh;
      out.piece = on ? p : -1;
      // Inside from its floor (a car on it, or sunk into it by a hard landing) up to its ceiling.
      out.space = y >= d - DECK_CATCH && y < out.ceiling ? 'enclosed' : y < gh ? 'rock' : 'open';
      for (const o of casters) if (o.inside(x, z)) o.cast!(out, x, y, z);
      return out;
    },
    top(x, z, y = Infinity) {
      return this.cast(x, y, z, scratch).floor;
    },
    topSlope(x, z, y, out) {
      const c = this.cast(x, y, z, scratch);
      if (c.piece < 0) return this.slope(x, z, out);
      const d = c.floor;
      // The floor's own plane, a little past its edge if need be.
      const e = cell / 2;
      const on = (px: number, pz: number) => {
        const v = floors.floor(px, pz, e + 1, d + DECK_CATCH);
        return v === v ? v : d;
      };
      out.x = (on(x + e, z) - on(x - e, z)) / (2 * e);
      out.z = (on(x, z + e) - on(x, z - e)) / (2 * e);
      return out;
    },
    outside(x, z) {
      const gx = Math.round((x - x0) / cell);
      const gz = Math.round((z - z0) / cell);
      // (The owner: an invisible wall up a slope, with snow drawn on past it, was no fun. A ridge
      // between two stretches, a mountainside: drive it, jump off it.)
      return gx < 1 || gz < 1 || gx >= nx - 1 || gz >= nz - 1;
    },
    height(x, z) {
      const u = (x - x0) / cell;
      const v = (z - z0) / cell;
      const gx = Math.floor(u);
      const gz = Math.floor(v);
      const fu = u - gx;
      const fv = v - gz;
      const a = at(gx, gz);
      const b = at(gx + 1, gz);
      const c = at(gx, gz + 1);
      const d = at(gx + 1, gz + 1);
      return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
    },
    slope(x, z, out) {
      const e = cell / 2;
      out.x = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
      out.z = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
      return out;
    },
  };
}
