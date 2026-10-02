// Open ground (docs/AVALANCHE.md): a heightfield the car drives on everywhere, the same one the
// renderer draws, for a layout with `ground`. Built once from the main road: each grid point takes
// the road's height at the nearest point of it (its slope and bank carried across), then whatever
// the layout adds by where the point is along and across the road: rough snow off the road, mogul
// fields, canyons, and walls rising at the edges (they're the map's bounds).
//
// Pure arithmetic from the layout, so every screen builds the same ground.

import type { GroundDef } from '../content';
import { hash01 } from '../rng';
import type { BakedSpline } from './bake';

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
  /** Per point, the main road's sample nearest it (-1: none in reach). */
  readonly near: Int32Array;
}

/** Off the road, the rough snow comes in over this many meters past the shoulder. */
const ROUGH_IN = 10;
/** Mogul fields and canyons ease in at their edges over this many meters. */
const EDGE = 6;
/** Where nothing of the road is within reach (the grid's far corners), the ground stands this high above the road's lowest. */
const BEYOND = 200;

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Smooth value noise, 0–1, at (x, z) in cells of `size` m (seeded by the grid, so the same everywhere). */
function noise(x: number, z: number, size: number): number {
  const u = x / size;
  const v = z / size;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const su = fu * fu * (3 - 2 * fu);
  const sv = fv * fv * (3 - 2 * fv);
  const a = hash01(91, i, j);
  const b = hash01(91, i + 1, j);
  const c = hash01(91, i, j + 1);
  const d = hash01(91, i + 1, j + 1);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

/** How deep a canyon is `d` m from its middle: a flat floor, then a quarter-circle wall (radius 2 × depth, about 60° at the lip). */
export function canyonDepth(d: number, floor: number, depth: number): number {
  const half = floor / 2;
  if (d <= half) return depth;
  const r = 2 * depth;
  const reach = Math.sqrt(2 * r * depth - depth * depth);
  const x = d - half;
  if (x >= reach) return 0;
  return depth - (r - Math.sqrt(r * r - x * x));
}

/** What `def` adds to the road's height at `s` m along the main road and `lat` m across it (road half width `half`, shoulder `shoulder`). */
export function groundShape(def: GroundDef, s: number, lat: number, half: number, shoulder: number, x: number, z: number): number {
  const a = Math.abs(lat);
  let h = 0;
  if (def.rough) h += def.rough.height * noise(x, z, def.rough.size) * smooth(half + shoulder, half + shoulder + ROUGH_IN, a);
  for (const m of def.moguls ?? []) {
    if (s < m.s[0] || s > m.s[1] || lat < m.lateral[0] || lat > m.lateral[1]) continue;
    const fade = smooth(0, EDGE, Math.min(s - m.s[0], m.s[1] - s, lat - m.lateral[0], m.lateral[1] - lat));
    // Bumps on a grid, flat between them; every other row offset half a bump, like skied moguls.
    const row = Math.floor(s / m.spacing);
    const off = row % 2 ? m.spacing / 2 : 0;
    const bu = 0.5 - 0.5 * Math.cos((2 * Math.PI * s) / m.spacing);
    const bv = 0.5 - 0.5 * Math.cos((2 * Math.PI * (lat + off)) / m.spacing);
    h += m.height * bu * bv * fade;
  }
  for (const c of def.canyons ?? []) {
    if (s < c.s[0] || s > c.s[1]) continue;
    const ease = smooth(0, c.ease, Math.min(s - c.s[0], c.s[1] - s));
    h -= canyonDepth(Math.abs(lat - c.lateral), c.floor, c.depth * ease);
  }
  if (a > def.wallFrom) h += (a - def.wallFrom) * def.wallRise;
  return h;
}

/** The ground for `def` round `main`. */
export function buildGround(def: GroundDef, main: BakedSpline): Ground {
  // The main road's samples, bucketed, for the nearest one to each grid point.
  const B = 24;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  for (let i = 0; i < main.n; i++) {
    minX = Math.min(minX, main.px[i]);
    maxX = Math.max(maxX, main.px[i]);
    minZ = Math.min(minZ, main.pz[i]);
    maxZ = Math.max(maxZ, main.pz[i]);
    minY = Math.min(minY, main.py[i]);
  }
  const margin = def.wallFrom + 40;
  const cell = def.cell;
  const x0 = Math.floor((minX - margin) / cell) * cell;
  const z0 = Math.floor((minZ - margin) / cell) * cell;
  const nx = Math.ceil((maxX + margin - x0) / cell) + 1;
  const nz = Math.ceil((maxZ + margin - z0) / cell) + 1;
  const bx = Math.ceil((nx * cell) / B);
  const bz = Math.ceil((nz * cell) / B);
  const buckets: number[][] = Array.from({ length: bx * bz }, () => []);
  for (let i = 0; i < main.n; i++) buckets[Math.floor((main.pz[i] - z0) / B) * bx + Math.floor((main.px[i] - x0) / B)].push(i);

  const h = new Float32Array(nx * nz);
  const lateral = new Float32Array(nx * nz);
  const near = new Int32Array(nx * nz).fill(-1);
  const reach = Math.ceil(margin / B) + 1;
  for (let gz = 0; gz < nz; gz++) {
    for (let gx = 0; gx < nx; gx++) {
      const x = x0 + gx * cell;
      const z = z0 + gz * cell;
      const cx = Math.floor((x - x0) / B);
      const cz = Math.floor((z - z0) / B);
      let best = -1;
      let bestD = Infinity;
      // Out in rings of buckets until one has a sample nearer than the next ring could.
      for (let r = 0; r <= reach && (best < 0 || bestD > ((r - 1) * B) ** 2); r++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const ux = cx + dx;
            const uz = cz + dz;
            if (ux < 0 || uz < 0 || ux >= bx || uz >= bz) continue;
            for (const i of buckets[uz * bx + ux]) {
              const d = (main.px[i] - x) ** 2 + (main.pz[i] - z) ** 2;
              if (d < bestD) {
                bestD = d;
                best = i;
              }
            }
          }
        }
      }
      const g = gz * nx + gx;
      if (best < 0) {
        h[g] = minY + BEYOND;
        lateral[g] = 1e4;
        continue;
      }
      const i = best;
      const j = main.closed ? (i + 1) % main.n : Math.min(main.n - 1, i + 1);
      const along = (x - main.px[i]) * main.tx[i] + (z - main.pz[i]) * main.tz[i];
      const lat = (x - main.px[i]) * -main.tz[i] + (z - main.pz[i]) * main.tx[i];
      const rise = (main.py[j] + main.ramp[j] - main.py[i] - main.ramp[i]) / main.step;
      const road = main.py[i] + main.ramp[i] + along * rise - lat * Math.tan(main.bank[i]);
      h[g] = road + groundShape(def, i * main.step + along, lat, main.width[i] / 2, main.shoulder[i], x, z);
      lateral[g] = lat;
      near[g] = i;
    }
  }

  const at = (gx: number, gz: number) => h[Math.min(nz - 1, Math.max(0, gz)) * nx + Math.min(nx - 1, Math.max(0, gx))];
  return {
    x0,
    z0,
    cell,
    nx,
    nz,
    h,
    lateral,
    near,
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
