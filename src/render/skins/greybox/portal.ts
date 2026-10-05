// Portals (docs/CALDERA.md, "Portals"): where the ground comes down over an enclosed piece (the Lava
// Tube's mouths, and where it comes out into the volcano's shaft), the ground is drawn cut to the
// piece's own outline (core's `outlineAt`, the same one the tube's walls are built on), so the two
// meet along one line: no whole grid squares cut out round the mouth, no staircase to the sky, no
// shroud over it. Only the drawing: the sim's ground is untouched (a car in there is in the
// piece's space by the cast).
//
// The cut is by a signed distance to the outline (negative inside it), taken across the piece at
// the point's place along it, the outline blended between the two samples either side as the
// tube's walls are. A grid cell near the outline has its two triangles split finer, and each small
// triangle is clipped to the outside of the outline, its cut points found by bisection.

import { tan } from '../../../core/math';
import type { BakedSpline, Track } from '../../../core/track/bake';
import { across, along } from '../../../core/track/frame';
import { OUTLINE_POINTS, TUBE_H, outlineAt } from '../../../core/track/ground';

/** Up to this far over the road the ground stays: the cutting's floor, at the road's height (give or take a float's rounding), under the tube's road (drawn 0.04 m up). */
const KEEP = 0.03;
/** A cell with a corner within this far of the outline, or inside it, is cut. */
const NEAR = 0.6;
/** A cut cell's triangles are split this many times along each side, so the cut follows the outline's curve. */
const SUB = 4;
/** Bisection steps for a cut point (a 2.5 m cell split in four: about a millimetre). */
const BISECT = 10;
/**
 * A clipped triangle with a side through the outline is split again, up to this many times: up a
 * sheer face (Coastal's Rock Tunnel, 30 m up in a cell) one ran from under the road to over the
 * ceiling, across the mouth. Through it is this far (m) inside it, past a chord's sag on its curve.
 */
const THROUGH = 0.05;
const SPLITS = 6;

/** How far each way along the tube a mouth's arch reaches (tube.ts): past a tube's open end the cut goes on this far, inside it. */
export const ARCH_DEPTH = 1.5;

/**
 * Which samples of `sp` start a stretch of tube (1): an enclosed piece (a floor and a ceiling) at
 * it, a floor at the next sample, and the ground over its road. tube.ts builds walls on these and
 * the cut follows them, so the two can't disagree. Null if `sp` has none.
 */
export function tubeSegments(track: Track, sp: BakedSpline): Uint8Array | null {
  const g = track.ground;
  const at = g?.pieces.at(sp.index);
  const floors = g?.pieces.floors(sp.index);
  if (!g || !at || !floors) return null;
  const seg = new Uint8Array(sp.n);
  let any = false;
  for (let k = 0; k + 1 < sp.n; k++) {
    const p = at[k] >= 0 ? g.pieces.list[at[k]] : undefined;
    // (Not a building: it stands on the ground, which isn't cut for it.)
    if (p && p.ceiling > 0 && !p.building && floors[k + 1] === 1 && g.height(sp.px[k], sp.pz[k]) > sp.py[k] - 0.5) {
      seg[k] = 1;
      any = true;
    }
  }
  return any ? seg : null;
}

/** The ceiling of the enclosed piece at sample `k` of `sp` (TUBE_H if none says): what its walls and its arch are built to. */
export function tubeCeiling(track: Track, sp: BakedSpline, k: number): number {
  const g = track.ground!;
  const at = g.pieces.at(sp.index);
  const c = at && at[k] >= 0 ? g.pieces.list[at[k]].ceiling : NaN;
  return c > 0 ? c : TUBE_H;
}

/** A vertex as the terrain carries it: position, normal, colour. */
export const VERTEX = 9;

export interface Portals {
  /** Per grid cell (by its first corner's index, gz × nx + gx), 1 where the ground's cut to a piece's outline. */
  readonly cells: Uint8Array;
  /** The signed distance (m) from (x, y, z) to the nearest enclosed piece's outline, across it: negative inside. */
  dist(x: number, y: number, z: number): number;
  /**
   * The triangle (a, b, c: VERTEX floats each) clipped to outside the outlines, split finer first:
   * its vertices appended to `verts`, its triangles (as indices into `verts`, by vertex) to `tris`.
   */
  clip(a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>, verts: number[], tris: number[]): void;
}

/** The portals of `track`'s enclosed pieces, or null if it has none. */
export function buildPortals(track: Track): Portals | null {
  const g = track.ground;
  if (!g) return null;
  const { x0, z0, cell, nx, nz } = g;
  // Per enclosed road, which samples start a stretch of its tube (a segment to the next sample, the
  // ground over it: what tube.ts builds walls on), and each one's ceiling.
  const tubes: { sp: BakedSpline; seg: Uint8Array; ceiling: Float64Array }[] = [];
  for (const sp of track.splines) {
    const seg = tubeSegments(track, sp);
    if (!seg) continue;
    const ceiling = new Float64Array(sp.n);
    for (let k = 0; k < sp.n; k++) ceiling[k] = tubeCeiling(track, sp, k);
    tubes.push({ sp, seg, ceiling });
  }
  if (!tubes.length) return null;
  // Each tube's open ends: its first ring (the tube runs on, +1, from it) and its last.
  const ends: { t: number; k: number; dir: -1 | 1 }[] = [];
  tubes.forEach(({ sp, seg }, t) => {
    for (let k = 0; k < sp.n; k++) {
      if (seg[k] && !(k > 0 && seg[k - 1])) ends.push({ t, k, dir: -1 });
      if (k > 0 && seg[k - 1] && !seg[k]) ends.push({ t, k, dir: 1 });
    }
  });

  // The tube samples near each grid cell.
  const near = new Map<number, number[]>();
  tubes.forEach(({ sp, seg }, t) => {
    for (let k = 0; k < sp.n; k++) {
      if (!seg[k] && !(k > 0 && seg[k - 1])) continue;
      const r = sp.width[k] / 2 + sp.shoulder[k] + 3 + cell;
      const gx0 = Math.max(0, Math.floor((sp.px[k] - r - x0) / cell));
      const gx1 = Math.min(nx - 2, Math.floor((sp.px[k] + r - x0) / cell));
      const gz0 = Math.max(0, Math.floor((sp.pz[k] - r - z0) / cell));
      const gz1 = Math.min(nz - 2, Math.floor((sp.pz[k] + r - z0) / cell));
      for (let gz = gz0; gz <= gz1; gz++)
        for (let gx = gx0; gx <= gx1; gx++) {
          const key = gz * nx + gx;
          let list = near.get(key);
          if (!list) near.set(key, (list = []));
          list.push(t * 65536 + k);
        }
    }
  });

  const A = new Float64Array(OUTLINE_POINTS * 2);
  const B = new Float64Array(OUTLINE_POINTS * 2);
  const P = new Float64Array(OUTLINE_POINTS * 2);
  const dist = (x: number, y: number, z: number): number => {
    const gx = Math.floor((x - x0) / cell);
    const gz = Math.floor((z - z0) / cell);
    const list = near.get(gz * nx + gx);
    if (!list) return Infinity;
    let best = Infinity;
    let bt = -1;
    let bk = -1;
    for (const id of list) {
      const t = id >> 16;
      const k = id & 65535;
      const sp = tubes[t].sp;
      const e = (sp.px[k] - x) * (sp.px[k] - x) + (sp.pz[k] - z) * (sp.pz[k] - z);
      if (e < best) {
        best = e;
        bt = t;
        bk = k;
      }
    }
    let { sp, seg, ceiling } = tubes[bt];
    const a = along(sp, bk, x, z);
    let k0 = a >= 0 ? bk : bk - 1;
    // Where along the segment k0 → k0 + 1 (0 to 1), for its outline, and for the road's height
    // (which goes on climbing past an end).
    let f: number;
    let fRoad: number;
    if (k0 >= 0 && k0 + 1 < sp.n && seg[k0]) f = fRoad = Math.min(1, Math.max(0, a >= 0 ? a / sp.step : 1 + a / sp.step));
    else {
      // Just past a tube's open end (inside its arch), the end's outline carried out: the ground
      // standing in front of the opening is cut too. The nearest end whose arch the point's in,
      // along it and across it (another tube's end may be in line with the point, further off).
      let end: (typeof ends)[number] | undefined;
      let endD = Infinity;
      for (const n of ends) {
        const t = tubes[n.t].sp;
        const b = along(t, n.k, x, z);
        if (!(n.dir < 0 ? b < 0 && b > -ARCH_DEPTH : b > 0 && b < ARCH_DEPTH)) continue;
        const l = Math.abs(across(t, n.k, x, z));
        if (l > t.width[n.k] / 2 + t.shoulder[n.k] + 3 || l >= endD) continue;
        end = n;
        endD = l;
      }
      if (!end) return Infinity;
      ({ sp, seg, ceiling } = tubes[end.t]);
      const b = along(sp, end.k, x, z);
      k0 = end.dir < 0 ? end.k : end.k - 1;
      f = end.dir < 0 ? 0 : 1;
      fRoad = end.dir < 0 ? b / sp.step : 1 + b / sp.step;
    }
    const k1 = k0 + 1;
    outlineAt(sp, k0, ceiling[k0], A);
    outlineAt(sp, k1, ceiling[k1], B);
    for (let q = 0; q < P.length; q++) P[q] = A[q] + (B[q] - A[q]) * f;
    // The floor's points raised to KEEP: the cutting's floor under the tube's road stays.
    P[1] = P[P.length - 1] = KEEP;
    const l = across(sp, k0, x, z);
    const road = sp.py[k0] + sp.ramp[k0] + (sp.py[k1] + sp.ramp[k1] - sp.py[k0] - sp.ramp[k0]) * fRoad - l * tan(sp.bank[k0] + (sp.bank[k1] - sp.bank[k0]) * f);
    return polygonDistance(P, l, y - road);
  };

  // The cells to cut: anywhere on them inside the outline, or near it (on a 5 × 5 of points over
  // their two triangles: past a tube's open end its corners can be clear while its middle isn't).
  const cells = new Uint8Array(nx * nz);
  for (const key of near.keys()) {
    const gx = key % nx;
    const gz = (key - gx) / nx;
    const ha = g.h[key];
    const hb = g.h[key + nx];
    const ha1 = g.h[key + 1];
    const hb1 = g.h[key + nx + 1];
    let min = Infinity;
    for (let i = 0; i <= 4 && min >= NEAR; i++)
      for (let j = 0; j <= 4 && min >= NEAR; j++) {
        // u across the cell in x, v in z; its triangles (a, b, a1) and (a1, b, b1).
        const u = i / 4;
        const v = j / 4;
        const y = u + v <= 1 ? ha + (ha1 - ha) * u + (hb - ha) * v : hb1 + (hb - hb1) * (1 - u) + (ha1 - hb1) * (1 - v);
        min = Math.min(min, dist(x0 + (gx + u) * cell, y, z0 + (gz + v) * cell));
      }
    if (min < NEAR) cells[key] = 1;
  }

  // Scratch for clipping.
  const grid: number[][] = [];
  const fs: number[] = [];
  const mix = (p: ArrayLike<number>, q: ArrayLike<number>, t: number, out: number[] = []) => {
    for (let a = 0; a < VERTEX; a++) out[a] = p[a] + (q[a] - p[a]) * t;
    return out;
  };
  /** Where the outline crosses p→q (f(p) ≥ 0 > f(q) or the other way), the same whichever way round it's asked. */
  const cross = (p: number[], fp: number, q: number[], fq: number) => {
    // Canonical order, so two triangles sharing the edge find the same point.
    const swap = p[0] > q[0] || (p[0] === q[0] && p[2] > q[2]);
    const [u, fu, v] = swap ? [q, fq, p] : [p, fp, q];
    let lo = 0;
    let hi = 1;
    const outside = fu >= 0;
    for (let s = 0; s < BISECT; s++) {
      const m = (lo + hi) / 2;
      const r = mix(u, v, m);
      if (dist(r[0], r[1], r[2]) >= 0 === outside) lo = m;
      else hi = m;
    }
    return mix(u, v, (lo + hi) / 2);
  };
  const push = (verts: number[], v: number[]) => {
    for (let a = 0; a < VERTEX; a++) verts.push(v[a]);
    return verts.length / VERTEX - 1;
  };
  const small = (p: number[], fp: number, q: number[], fq: number, r: number[], fr: number, verts: number[], tris: number[], depth = 0) => {
    if (fp < 0 && fq < 0 && fr < 0) return;
    // Sutherland–Hodgman against the outside of the outline.
    const poly: number[][] = [];
    const ring: [number[], number][] = [
      [p, fp],
      [q, fq],
      [r, fr],
    ];
    for (let s = 0; s < 3; s++) {
      const [u, fu] = ring[s];
      const [v, fv] = ring[(s + 1) % 3];
      if (fu >= 0) poly.push(u);
      if (fu >= 0 !== fv >= 0) poly.push(cross(u, fu, v, fv));
    }
    // What's kept must be outside all over: a side of it through the outline (up a sheer face, from
    // under the road to over the ceiling, between its corners or its two cut points) and it's split
    // in four by its sides' middles, again.
    if (depth < SPLITS)
      for (let s = 0; s < poly.length; s++) {
        const m = mix(poly[s], poly[(s + 1) % poly.length], 0.5);
        if (dist(m[0], m[1], m[2]) >= -THROUGH) continue;
        const pq = mix(p, q, 0.5);
        const qr = mix(q, r, 0.5);
        const rp = mix(r, p, 0.5);
        const [fpq, fqr, frp] = [dist(pq[0], pq[1], pq[2]), dist(qr[0], qr[1], qr[2]), dist(rp[0], rp[1], rp[2])];
        small(p, fp, pq, fpq, rp, frp, verts, tris, depth + 1);
        small(pq, fpq, q, fq, qr, fqr, verts, tris, depth + 1);
        small(rp, frp, qr, fqr, r, fr, verts, tris, depth + 1);
        small(pq, fpq, qr, fqr, rp, frp, verts, tris, depth + 1);
        return;
      }
    const first = push(verts, poly[0]);
    let prev = push(verts, poly[1]);
    for (let s = 2; s < poly.length; s++) {
      const cur = push(verts, poly[s]);
      tris.push(first, prev, cur);
      prev = cur;
    }
  };
  const clip = (a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>, verts: number[], tris: number[]) => {
    // The triangle split SUB times along each side: grid[i][j] = a + (b - a)·i/SUB + (c - a)·j/SUB.
    let n = 0;
    for (let i = 0; i <= SUB; i++)
      for (let j = 0; j + i <= SUB; j++) {
        const v = (grid[n] ??= []);
        for (let q = 0; q < VERTEX; q++) v[q] = a[q] + ((b[q] - a[q]) * i) / SUB + ((c[q] - a[q]) * j) / SUB;
        fs[n] = dist(v[0], v[1], v[2]);
        n++;
      }
    const at = (i: number, j: number) => i * (SUB + 1) - (i * (i - 1)) / 2 + j;
    for (let i = 0; i < SUB; i++)
      for (let j = 0; j + i < SUB; j++) {
        const p = at(i, j);
        const q = at(i + 1, j);
        const r = at(i, j + 1);
        small(grid[p], fs[p], grid[q], fs[q], grid[r], fs[r], verts, tris);
        if (i + j < SUB - 1) {
          const s = at(i + 1, j + 1);
          small(grid[q], fs[q], grid[s], fs[s], grid[r], fs[r], verts, tris);
        }
      }
  };
  return { cells, dist, clip };
}

/** The signed distance from (x, y) to the closed polygon `p` (x, y pairs): negative inside. */
function polygonDistance(p: Float64Array, x: number, y: number): number {
  const n = p.length / 2;
  let best = Infinity;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = p[j * 2];
    const ay = p[j * 2 + 1];
    const bx = p[i * 2];
    const by = p[i * 2 + 1];
    if (by > y !== ay > y && x < ((ax - bx) * (y - by)) / (ay - by) + bx) inside = !inside;
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    const ex = ax + dx * t - x;
    const ey = ay + dy * t - y;
    best = Math.min(best, ex * ex + ey * ey);
  }
  return inside ? -Math.sqrt(best) : Math.sqrt(best);
}
