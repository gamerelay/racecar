// Which of the main road's samples is nearest a point: how the ground knows where every grid point
// is along and across the road.

import { sq } from '../../math';
import type { BakedSpline } from '../bake';

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
export function sampleSearch(main: BakedSpline, x0: number, z0: number, w: number, d: number, B: number) {
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
  const dist2 = (i: number, x: number, z: number) => sq(main.px[i] - x) + sq(main.pz[i] - z);
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
    const bound = sq(Math.sqrt(bestD) + slack);
    for (let n = 0; n < list.length; n++) if (list[n] !== coarse && dist2(reps[list[n]], x, z) <= bound) refine(list[n]);
    found.i = best;
    found.d = Math.sqrt(bestD);
    return found;
  };
}
