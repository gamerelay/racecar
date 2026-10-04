// Pieces (docs/CALDERA.md, "The core idea: pieces"): what you can drive on that isn't the ground,
// from the layout's `pieces`. Until the road graph (step 6) a piece carries a stretch of a road, so
// its floor is that road's plane, and it's found by where a point is along and across the road:
// for the main road from the ground grid's nearest sample, for a branch by its piece samples
// bucketed. A car is on the highest floor at or below it.

import type { PieceDef } from '../../content';
import { smoothstep as smooth, sq } from '../../math';
import type { BakedSpline } from '../bake';
import { across, along } from '../frame';
import { planeOf } from './plane';

/** On a floor: a car this far under it still drives on it (a hard landing); further down, it's under it. */
export const DECK_CATCH = 1;

/** A wheel past a deck's edge, with the car's middle still on it, still stands on the deck's plane this far out (m). */
export const DECK_SLACK = 2;

/** A piece, resolved against the baked roads. */
export interface Piece {
  id: string;
  /** Its place in `Pieces.list`. */
  index: number;
  /** The road it carries, by spline index, and from and to along it (m). */
  spline: number;
  s: [number, number];
  /** Whether it has a floor: false is a gap. */
  floor: boolean;
  /** Its ceiling's height over its floor (m), NaN if it's open. */
  ceiling: number;
  /** How it's lit and sounds inside (PieceDef.indoor), an enclosed piece's ('tunnel' by default); '' if it's open. */
  indoor: string;
  /** How the ground under it falls away (PieceDef.under), if it says. */
  under?: { floor: number; ease: number; reach: number };
}

/** The pieces, and per road, which of its samples they're on. */
export interface Pieces {
  readonly list: readonly Piece[];
  /** Per sample of the road (by spline index), 1 where a piece with a floor carries it; undefined if none is on that road. */
  floors(spline: number): Uint8Array | undefined;
  /** Per sample of the road, 1 in a gap (a piece without a floor); undefined if it has none. */
  gaps(spline: number): Uint8Array | undefined;
  /** Per sample of the road, the piece with a floor carrying it (its index), -1 for none. */
  at(spline: number): Int16Array | undefined;
  /** Whether a piece of the road has a floor or a gap at sample `i`: either way, a branch doesn't shape the ground there. */
  covers(spline: number, i: number): boolean;
}

/** The layout's pieces against its baked roads (`splines[0]` the main road). */
export function definePieces(defs: readonly PieceDef[], splines: readonly BakedSpline[]): Pieces {
  const floors = new Map<number, Uint8Array>();
  const gaps = new Map<number, Uint8Array>();
  const at = new Map<number, Int16Array>();
  const list: Piece[] = [];
  for (const def of defs) {
    const sp = def.road === undefined ? splines[0] : splines.find((b) => b.id === def.road && b.index !== 0);
    if (!sp) continue;
    const p: Piece = { id: def.id, index: list.length, spline: sp.index, s: def.s, floor: def.floor !== false, ceiling: def.ceiling ?? NaN, indoor: def.ceiling !== undefined ? (def.indoor ?? 'tunnel') : '', under: def.under };
    list.push(p);
    const masks = p.floor ? floors : gaps;
    let m = masks.get(sp.index);
    if (!m) masks.set(sp.index, (m = new Uint8Array(sp.n)));
    let who = at.get(sp.index);
    if (!who) at.set(sp.index, (who = new Int16Array(sp.n).fill(-1)));
    for (let i = Math.max(0, Math.ceil(p.s[0] / sp.step)); i <= Math.min(sp.n - 1, Math.floor(p.s[1] / sp.step)); i++) {
      m[i] = 1;
      if (p.floor) who[i] = p.index;
    }
  }
  return {
    list,
    floors: (k) => floors.get(k),
    gaps: (k) => gaps.get(k),
    at: (k) => at.get(k),
    covers: (k, i) => !!(floors.get(k)?.[i] || gaps.get(k)?.[i]),
  };
}

/** The ground's swell and bumps fade out over this many meters of road before a piece that shapes the ground under it, so the road meets its floor at its own height. */
const RUN_IN = 30;

/**
 * How much of what the layout adds (swell, bumps) the ground keeps `s` m along the main road and
 * `d` m from its middle (0–1): none where a main-road piece with `under` starts or ends, on the
 * road and out to its reach, so a car rolls onto its floor at the height it is, not a step up or
 * down (a step of more than DECK_CATCH would take it under the floor).
 */
export function runIn(pieces: Pieces, s: number, d: number, edge: number): number {
  let keep = 1;
  for (const p of pieces.list) {
    if (p.spline !== 0 || !p.under) continue;
    const out = s < p.s[0] ? p.s[0] - s : s > p.s[1] ? s - p.s[1] : 0;
    if (out >= RUN_IN) continue;
    const near = 1 - smooth(edge, edge + p.under.reach, d);
    keep = Math.min(keep, 1 - (1 - smooth(0, RUN_IN, out)) * near);
  }
  return keep;
}

/** How far toward `p`'s `under.floor` the ground `s` m along the main road and `d` m from its middle is pulled (0–1; the road's edge `edge` m out). */
export function pull(p: Piece, s: number, d: number, edge: number): number {
  const u = p.under!;
  if (s < p.s[0] || s > p.s[1]) return 0;
  return smooth(0, u.ease, Math.min(s - p.s[0], p.s[1] - s)) * (1 - smooth(edge, edge + u.reach, d));
}

/** What `floorQuery` needs of the ground grid: its extent, and per point the main road's sample nearest it. */
export interface GridRef {
  readonly x0: number;
  readonly z0: number;
  readonly cell: number;
  readonly nx: number;
  readonly nz: number;
  readonly near: Int32Array;
}

/** The branches' floor samples are bucketed this big (m), to find the one over a point. */
const BUCKET = 8;

/**
 * The pieces' floors as a query: `floor(x, z, slack, top)` is the floor of a piece over (x, z),
 * within `slack` m past its edges (the road and its shoulder), the highest at or below `top` (by
 * DECK_CATCH) if there's more than one; NaN if none. `found()` is that floor's piece (-1 for none).
 */
export function floorQuery(pieces: Pieces, main: BakedSpline, branches: readonly BakedSpline[], grid: GridRef) {
  const { x0, z0, cell, nx, nz, near } = grid;
  const mainFloor = pieces.floors(main.index);
  const mainAt = pieces.at(main.index);
  const hasMain = !!mainFloor && mainFloor.some((v) => v === 1);
  // The branches' floor samples, bucketed.
  const bx = Math.ceil((nx * cell) / BUCKET);
  const bz = Math.ceil((nz * cell) / BUCKET);
  const buckets = new Map<number, number[]>();
  const floored = branches.filter((b) => pieces.floors(b.index));
  floored.forEach((sp, k) => {
    const m = pieces.floors(sp.index)!;
    for (let i = 0; i < sp.n; i++) {
      if (!m[i]) continue;
      const key = Math.floor((sp.pz[i] - z0) / BUCKET) * bx + Math.floor((sp.px[i] - x0) / BUCKET);
      let list = buckets.get(key);
      if (!list) buckets.set(key, (list = []));
      list.push(k * 65536 + i);
    }
  });
  const near2 = new Float64Array(floored.length);
  const nearI = new Int32Array(floored.length);
  let found = -1;
  let branchFound = -1;
  /** The highest of the branches' floors over (x, z) within `slack`, at or below `top`. */
  const branchFloor = (x: number, z: number, slack: number, top: number) => {
    branchFound = -1;
    if (!floored.length) return NaN;
    near2.fill(Infinity);
    const r = Math.ceil((12 + slack) / BUCKET);
    const cx = Math.floor((x - x0) / BUCKET);
    const cz = Math.floor((z - z0) / BUCKET);
    for (let a = Math.max(0, cz - r); a <= Math.min(bz - 1, cz + r); a++)
      for (let b = Math.max(0, cx - r); b <= Math.min(bx - 1, cx + r); b++) {
        const list = buckets.get(a * bx + b);
        if (!list) continue;
        for (const v of list) {
          const k = v >> 16;
          const i = v & 65535;
          const sp = floored[k];
          const e = sq(sp.px[i] - x) + sq(sp.pz[i] - z);
          if (e < near2[k]) {
            near2[k] = e;
            nearI[k] = i;
          }
        }
      }
    let best = NaN;
    for (let k = 0; k < floored.length; k++) {
      if (near2[k] === Infinity) continue;
      const sp = floored[k];
      const i = nearI[k];
      // Past the floor's end it isn't over it (its nearest floor sample is its last one).
      if (Math.abs(along(sp, i, x, z)) > sp.step || Math.abs(across(sp, i, x, z)) > sp.width[i] / 2 + sp.shoulder[i] + slack) continue;
      const y = planeOf(sp, i, x, z);
      if (y <= top + DECK_CATCH && !(y <= best)) {
        best = y;
        branchFound = pieces.at(sp.index)![i];
      }
    }
    return best;
  };
  const d2 = (i: number, x: number, z: number) => sq(main.px[i] - x) + sq(main.pz[i] - z);
  const next = (i: number, by: number) => (main.closed ? (i + by + main.n) % main.n : Math.min(main.n - 1, Math.max(0, i + by)));
  const floor = (x: number, z: number, slack = 0, top = Infinity): number => {
    const other = branchFloor(x, z, slack, top);
    found = branchFound;
    if (!hasMain) return other;
    const gx = Math.min(nx - 1, Math.max(0, Math.round((x - x0) / cell)));
    const gz = Math.min(nz - 1, Math.max(0, Math.round((z - z0) / cell)));
    // The grid point's nearest sample, then down the road to the point's own.
    let i = near[gz * nx + gx];
    let e = d2(i, x, z);
    for (let by = 1; by >= -1; by -= 2) {
      for (let k = 0; k < 8; k++) {
        const j = next(i, by);
        const f = d2(j, x, z);
        if (f >= e) break;
        i = j;
        e = f;
      }
    }
    if (!mainFloor![i]) return other;
    if (Math.abs(across(main, i, x, z)) > main.width[i] / 2 + main.shoulder[i] + slack) return other;
    const mine = planeOf(main, i, x, z);
    if (mine > top + DECK_CATCH) return other;
    if (other > mine) return other;
    found = mainAt![i];
    return mine;
  };
  return { floor, found: () => found };
}
