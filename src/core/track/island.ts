// The island's shapes (Paradise): its coastline and its volcano, pure arithmetic shared by the
// land the renderer draws round a lapped island (render/skins/greybox/terrain.ts) and the open
// ground the car drives on (core/track/ground, docs/PARADISE.md), so both build the same island.

import { exp, hypot, pow, smoothstep as smooth, sq } from '../math';

/** Signed distance from (x, z) to a closed loop: positive inside it. */
export function loopDist(loop: [number, number][], x: number, z: number): number {
  let best = Infinity;
  let inside = false;
  for (let k = 0, j = loop.length - 1; k < loop.length; j = k++) {
    const [ax, az] = loop[j];
    const [bx, bz] = loop[k];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, hypot(x - ax - dx * t, z - az - dz * t));
    if (az > z !== bz > z && x < ax + ((z - az) * dx) / dz) inside = !inside;
  }
  return inside ? best : -best;
}

/** loopDistance's grid cell (m). */
const LOOP_CELL = 32;

/**
 * `loopDist` for one loop, many times (the ground asks it at every grid point): the same bits, from
 * only the segments that can matter. The nearest is the least of the segments' distances, found
 * ring by ring of a grid of them until no segment further out could be nearer; inside is the count
 * of the crossings to the right, from only the segments spanning the point's z. (Neither depends on
 * the order the segments are seen in.)
 */
export function loopDistance(loop: readonly (readonly [number, number])[]): (x: number, z: number) => number {
  const n = loop.length;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of loop) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const nx = Math.max(1, Math.ceil((maxX - minX) / LOOP_CELL));
  const nz = Math.max(1, Math.ceil((maxZ - minZ) / LOOP_CELL));
  const col = (x: number) => Math.min(nx - 1, Math.max(0, Math.floor((x - minX) / LOOP_CELL)));
  const row = (z: number) => Math.min(nz - 1, Math.max(0, Math.floor((z - minZ) / LOOP_CELL)));
  // Segment k runs from loop[j] to loop[k] (j the one before, as loopDist walks it). Each in every
  // cell its box touches; and in every row its z spans, for the crossings.
  const cells: number[][] = Array.from({ length: nx * nz }, () => []);
  const rows: number[][] = Array.from({ length: nz }, () => []);
  for (let k = 0, j = n - 1; k < n; j = k++) {
    const [ax, az] = loop[j];
    const [bx, bz] = loop[k];
    for (let r = row(Math.min(az, bz)); r <= row(Math.max(az, bz)); r++) {
      rows[r].push(k);
      for (let c = col(Math.min(ax, bx)); c <= col(Math.max(ax, bx)); c++) cells[r * nx + c].push(k);
    }
  }
  const seen = new Int32Array(n).fill(-1);
  let query = 0;
  return (x, z) => {
    query++;
    let best = Infinity;
    const near = (k: number) => {
      if (seen[k] === query) return;
      seen[k] = query;
      const [ax, az] = loop[k === 0 ? n - 1 : k - 1];
      const [bx, bz] = loop[k];
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      best = Math.min(best, hypot(x - ax - dx * t, z - az - dz * t));
    };
    // Rings of cells round the point's (its own, clamped onto the grid), until no cell further out
    // could hold a nearer one. A cell r rings out is r - 1 whole cells further than the point's own
    // along x or along z, past however far the point is off the grid along each.
    const cx = col(x);
    const cz = row(z);
    const offX = Math.max(0, minX - x, x - (minX + nx * LOOP_CELL));
    const offZ = Math.max(0, minZ - z, z - (minZ + nz * LOOP_CELL));
    for (let r = 0; r <= nx || r <= nz; r++) {
      const ring = (r - 1) * LOOP_CELL;
      if (r > 0 && best <= Math.min(hypot(offX + ring, offZ), hypot(offX, offZ + ring))) break;
      for (let a = cz - r; a <= cz + r; a++) {
        if (a < 0 || a >= nz) continue;
        const edge = a === cz - r || a === cz + r;
        for (let b = cx - r; b <= cx + r; b += edge ? 1 : 2 * r) {
          if (b >= 0 && b < nx) for (const k of cells[a * nx + b]) near(k);
          if (r === 0) break;
        }
      }
    }
    let inside = false;
    if (z >= minZ && z <= maxZ)
      for (const k of rows[row(z)]) {
        const [ax, az] = loop[k === 0 ? n - 1 : k - 1];
        const [bx, bz] = loop[k];
        if (az > z !== bz > z && x < ax + ((z - az) * (bx - ax)) / (bz - az)) inside = !inside;
      }
    return inside ? best : -best;
  };
}

/** A volcano's cone: its middle, the crater's radius, the lip's height over the sea, its foot's radius. */
export interface Volcano {
  x: number;
  z: number;
  crater: number;
  h: number;
  r: number;
}

/** A volcano's cone above the sea at (x, z): steepening to the lip, a bowl in the crater. */
export function coneHeight(v: Volcano, x: number, z: number): number {
  const rr = hypot(x - v.x, z - v.z);
  if (rr >= v.r) return 0;
  const u = Math.min(1, (v.r - rr) / (v.r - v.crater));
  const lip = 4 * exp(-sq((rr - v.crater) / 9));
  return v.h * pow(u, 1.6) + lip - (rr < v.crater ? 26 * smooth(v.crater, v.crater * 0.35, rr) : 0);
}

/** A crater's shaft (GroundDef.volcano.pit): inside the lip, its walls fall over this many meters to its floor. */
export const PIT_WALL = 18;

/** The cone at (x, z) with its crater a shaft down to `pit` (over the sea), if it has one. */
export function shaftHeight(v: Volcano & { pit?: number }, x: number, z: number): number {
  const cone = coneHeight(v, x, z);
  const rr = hypot(x - v.x, z - v.z);
  if (v.pit === undefined || rr >= v.crater) return cone;
  return v.pit + (cone - v.pit) * smooth(v.crater - PIT_WALL, v.crater, rr);
}

/** A polyline smoothed into a curve (Catmull-Rom), every few meters. */
export function curve(poly: [number, number][], step = 6): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < poly.length; k++) {
    const p0 = poly[Math.max(0, k - 1)];
    const p1 = poly[k];
    const p2 = poly[k + 1];
    const p3 = poly[Math.min(poly.length - 1, k + 2)];
    const n = Math.max(2, Math.ceil(hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let j = 0; j < n; j++) {
      const t = j / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(poly[poly.length - 1]);
  return out;
}

