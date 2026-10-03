// Open ground (docs/AVALANCHE.md): a heightfield the car drives on everywhere, the same one the
// renderer draws, for a layout with `ground`. Built once from the main road: on the road and its
// shoulder, the road's own height; off it, the land between the roads (relaxed smooth, so two
// stretches meet in a slope, not a cliff); then whatever the layout adds by where the point is
// along and across the road: rough snow off the road, mogul fields, canyons, and walls rising at the
// edges. All of it is yours to drive, ridges and mountainsides too: out of bounds is only off the
// grid, where the ground ends.
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
  /** Per point, the main road's sample nearest it. */
  readonly near: Int32Array;
  /** Off the grid, where the ground ends: out of bounds (anywhere drawn is in bounds). */
  outside(x: number, z: number): boolean;
}

/** Off the road, the rough snow comes in over this many meters past the shoulder. */
const ROUGH_IN = 10;
/** Mogul fields and canyons ease in at their edges over this many meters. */
const EDGE = 6;
/** Past the walls' foot (`wallFrom`), the grid reaches this far up them, and 20 m more, at its narrowest (GroundDef.wallOut). */
const WALL_OUT = 25;
/** The land between the roads is relaxed on a grid this coarse (m), this many passes. */
const BASE_CELL = 8;
const RELAX = 300;

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Smooth value noise, 0–1, at (x, z) in cells of `size` m (seeded by the grid, so the same everywhere). */
export function noise(x: number, z: number, size: number, seed = 91): number {
  const u = x / size;
  const v = z / size;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const su = fu * fu * (3 - 2 * fu);
  const sv = fv * fv * (3 - 2 * fv);
  const a = hash01(seed, i, j);
  const b = hash01(seed, i + 1, j);
  const c = hash01(seed, i, j + 1);
  const d = hash01(seed, i + 1, j + 1);
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

/** How far down in a canyon `s` m along the main road and `lat` m across it is (0: in none). */
export function canyonAt(def: GroundDef, s: number, lat: number): number {
  let h = 0;
  for (const c of def.canyons ?? []) {
    if (s < c.s[0] || s > c.s[1]) continue;
    const ease = smooth(0, c.ease, Math.min(s - c.s[0], c.s[1] - s));
    h += canyonDepth(Math.abs(lat - c.lateral), c.floor, c.depth * ease);
  }
  return h;
}

/** What `def` adds to the road's height at `s` m along the main road and `lat` m across it (road half width `half`, shoulder `shoulder`). */
export function groundShape(def: GroundDef, s: number, lat: number, half: number, shoulder: number, x: number, z: number): number {
  const a = Math.abs(lat);
  let h = 0;
  // Swell: long, low rolls everywhere, the piste too (it tilts you a little, side to side).
  if (def.swell) h += def.swell.height * (noise(x, z, def.swell.size, 37) - 0.5);
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
  h -= canyonAt(def, s, lat);
  if (a > def.wallFrom) h += (a - def.wallFrom) * def.wallRise;
  return h;
}

/** The search's coarse samples: one in this many of the road's. */
const COARSE = 8;

/**
 * The nearest of `main`'s samples to a point, exactly, bucketed `B` m. Per bucket, once: every
 * coarse sample (one in COARSE) that could be nearest to a point in it, by rings of buckets out
 * from it. Per point: the nearest of those, then every sample near any of them that could still
 * beat it (a sample is at most COARSE/2 samples from the coarse one it rounds to). Searching every
 * sample in rings for every point was 1.7 s of Avalanche's 2 s bake, nearly all of it in empty
 * buckets far off the road.
 */
function sampleSearch(main: BakedSpline, x0: number, z0: number, w: number, d: number, B: number) {
  const bx = Math.ceil(w / B);
  const bz = Math.ceil(d / B);
  const half = COARSE / 2;
  const slack = half * main.step;
  // The coarse samples, each standing for the samples within `half` of it.
  const reps: number[] = [];
  for (let j = 0; j - half <= main.n - 1; j += COARSE) reps.push(Math.min(j, main.n - 1));
  const buckets: number[][] = Array.from({ length: bx * bz }, () => []);
  for (let k = 0; k < reps.length; k++) {
    const i = reps[k];
    buckets[Math.floor((main.pz[i] - z0) / B) * bx + Math.floor((main.px[i] - x0) / B)].push(k);
  }
  const reach = Math.max(bx, bz);
  const dist2 = (i: number, x: number, z: number) => (main.px[i] - x) ** 2 + (main.pz[i] - z) ** 2;
  /** Every coarse sample in rings of buckets out from bucket (cx, cz), while a ring could hold one within `limit()` m of (x, z). */
  const rings = (cx: number, cz: number, x: number, z: number, limit: () => number, visit: (k: number, e: number) => void) => {
    for (let r = 0; r <= reach && Math.max(0, r - 1) * B < limit(); r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const ux = cx + dx;
          const uz = cz + dz;
          if (ux < 0 || uz < 0 || ux >= bx || uz >= bz) continue;
          for (const k of buckets[uz * bx + ux]) visit(k, dist2(reps[k], x, z));
        }
      }
    }
  };
  // A point in a bucket is within `rho` of its middle, so its nearest is within 2 rho (and the
  // slack) of the middle's nearest.
  const rho = (B * Math.SQRT2) / 2;
  const lists: (Int32Array | undefined)[] = new Array(bx * bz);
  const candidates = (cx: number, cz: number) => {
    const x = x0 + (cx + 0.5) * B;
    const z = z0 + (cz + 0.5) * B;
    let mid = Infinity;
    rings(cx, cz, x, z, () => Math.sqrt(mid), (_k, e) => (mid = Math.min(mid, e)));
    const within = Math.sqrt(mid) + 2 * rho + slack;
    const out: number[] = [];
    rings(cx, cz, x, z, () => within, (k, e) => {
      if (e <= within * within) out.push(k);
    });
    return Int32Array.from(out);
  };
  const found = { i: 0, d: Infinity };
  let best = -1;
  let bestD = Infinity;
  let px = 0;
  let pz = 0;
  /** The samples coarse sample `k` stands for, against the best so far. */
  const refine = (k: number) => {
    const lo = Math.max(0, k * COARSE - half);
    const hi = Math.min(main.n - 1, Math.max(reps[k], k * COARSE + half));
    for (let i = lo; i <= hi; i++) {
      const e = dist2(i, px, pz);
      if (e < bestD || (e === bestD && i < best)) {
        bestD = e;
        best = i;
      }
    }
  };
  return (x: number, z: number) => {
    const cx = Math.min(bx - 1, Math.max(0, Math.floor((x - x0) / B)));
    const cz = Math.min(bz - 1, Math.max(0, Math.floor((z - z0) / B)));
    const list = (lists[cz * bx + cx] ??= candidates(cx, cz));
    // The nearest coarse sample, then every sample that could beat what's found near it.
    let coarse = list[0];
    let coarseD = Infinity;
    for (let n = 0; n < list.length; n++) {
      const e = dist2(reps[list[n]], x, z);
      if (e < coarseD) {
        coarseD = e;
        coarse = list[n];
      }
    }
    px = x;
    pz = z;
    best = -1;
    bestD = Infinity;
    refine(coarse);
    const bound = (Math.sqrt(bestD) + slack) ** 2;
    for (let n = 0; n < list.length; n++) if (list[n] !== coarse && dist2(reps[list[n]], x, z) <= bound) refine(list[n]);
    found.i = best;
    found.d = Math.sqrt(bestD);
    return found;
  };
}

/** The ground for `def` round `main`. */
export function buildGround(def: GroundDef, main: BakedSpline): Ground {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < main.n; i++) {
    minX = Math.min(minX, main.px[i]);
    maxX = Math.max(maxX, main.px[i]);
    minZ = Math.min(minZ, main.pz[i]);
    maxZ = Math.max(maxZ, main.pz[i]);
  }
  const wallOut = def.wallOut ?? WALL_OUT;
  const margin = def.wallFrom + wallOut + 20;
  const cell = def.cell;
  const x0 = Math.floor((minX - margin) / cell) * cell;
  const z0 = Math.floor((minZ - margin) / cell) * cell;
  const nx = Math.ceil((maxX + margin - x0) / cell) + 1;
  const nz = Math.ceil((maxZ + margin - z0) / cell) + 1;
  const nearest = sampleSearch(main, x0, z0, nx * cell, nz * cell, 24);
  /** The road's plane at (x, z) as sample `i` carries it out (its slope along, its bank across). */
  const plane = (i: number, x: number, z: number) => {
    const j = main.closed ? (i + 1) % main.n : Math.min(main.n - 1, i + 1);
    const along = (x - main.px[i]) * main.tx[i] + (z - main.pz[i]) * main.tz[i];
    const lat = (x - main.px[i]) * -main.tz[i] + (z - main.pz[i]) * main.tx[i];
    const rise = (main.py[j] - main.py[i]) / main.step;
    // A kicker's height runs out past the road's edge over its flank (RampDef.flank; 8 m unset),
    // so it's a bump on the piste, not a ridge across the mountain.
    let ramp = 0;
    if (main.ramp[i] > 0 || main.ramp[j] > 0) {
      const over = Math.abs(lat) - main.width[i] / 2 - main.shoulder[i];
      const fade = over <= 0 ? 1 : Math.max(0, 1 - over / (main.rampFlank[i] || 8));
      ramp = (main.ramp[i] + ((main.ramp[j] - main.ramp[i]) * along) / main.step) * fade;
    }
    return main.py[i] + ramp + along * rise - lat * Math.tan(main.bank[i]);
  };

  // The land between the roads, on a coarse grid: the road's height on the road, and off it relaxed
  // smooth from the road's plane carried out. Carried out alone, the plane jumps where two stretches
  // are equally near (the ridge between the run and the road back, inside a switchback); relaxed,
  // they meet in a slope.
  const C = BASE_CELL;
  const cnx = Math.ceil(((nx - 1) * cell) / C) + 1;
  const cnz = Math.ceil(((nz - 1) * cell) / C) + 1;
  const base = new Float32Array(cnx * cnz);
  const fixed = new Uint8Array(cnx * cnz);
  for (let cz = 0; cz < cnz; cz++) {
    for (let cx = 0; cx < cnx; cx++) {
      const x = x0 + cx * C;
      const z = z0 + cz * C;
      const a = nearest(x, z);
      base[cz * cnx + cx] = plane(a.i, x, z);
      fixed[cz * cnx + cx] = a.d < main.width[a.i] / 2 + main.shoulder[a.i] ? 1 : 0;
    }
  }
  for (let it = 0; it < RELAX; it++) {
    for (let cz = 0; cz < cnz; cz++) {
      for (let cx = 0; cx < cnx; cx++) {
        const k = cz * cnx + cx;
        if (fixed[k]) continue;
        // Gauss–Seidel, the grid's edges mirrored.
        const l = base[k - (cx > 0 ? 1 : 0)];
        const r = base[k + (cx < cnx - 1 ? 1 : 0)];
        const u = base[k - (cz > 0 ? cnx : 0)];
        const d = base[k + (cz < cnz - 1 ? cnx : 0)];
        base[k] = (l + r + u + d) / 4;
      }
    }
  }
  const land = (x: number, z: number) => {
    const u = Math.min(cnx - 1.001, Math.max(0, (x - x0) / C));
    const v = Math.min(cnz - 1.001, Math.max(0, (z - z0) / C));
    const gx = Math.floor(u);
    const gz = Math.floor(v);
    const fu = u - gx;
    const fv = v - gz;
    const k = gz * cnx + gx;
    return base[k] + (base[k + 1] - base[k]) * fu + (base[k + cnx] - base[k]) * fv + (base[k] - base[k + 1] - base[k + cnx] + base[k + cnx + 1]) * fu * fv;
  };

  const h = new Float32Array(nx * nz);
  const lateral = new Float32Array(nx * nz);
  const near = new Int32Array(nx * nz);
  for (let gz = 0; gz < nz; gz++) {
    for (let gx = 0; gx < nx; gx++) {
      const x = x0 + gx * cell;
      const z = z0 + gz * cell;
      const g = gz * nx + gx;
      const { i, d } = nearest(x, z);
      const along = (x - main.px[i]) * main.tx[i] + (z - main.pz[i]) * main.tz[i];
      const lat = (x - main.px[i]) * -main.tz[i] + (z - main.pz[i]) * main.tx[i];
      // On the road and its shoulder, the road exactly; out through the rough snow, the land.
      const half = main.width[i] / 2;
      const edge = half + main.shoulder[i];
      const road = plane(i, x, z);
      const y = road + (land(x, z) - road) * smooth(edge, edge + ROUGH_IN, d);
      // What the layout adds, by the distance across (not the lateral: that jumps between stretches).
      h[g] = y + groundShape(def, i * main.step + along, lat < 0 ? -d : d, half, main.shoulder[i], x, z);
      lateral[g] = lat < 0 ? -d : d;
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
