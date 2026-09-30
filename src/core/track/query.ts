// Per-tick track queries: where is this point along a spline (s, lateral), how high is the ground,
// what surface is it, is there a wall. Results go into a caller-owned `TrackHit` so nothing
// allocates in the tick.

import { wrap, type BakedSpline, type Track } from './bake';

export interface TrackHit {
  spline: number;
  s: number;
  /** Signed distance from the centerline; positive is to the right of the direction of travel. */
  lateral: number;
  /** Center point and unit tangent at s. */
  cx: number;
  cy: number;
  cz: number;
  tx: number;
  tz: number;
  width: number;
  shoulder: number;
  bank: number;
  /** Ground height at (s, lateral), ramps and bank included. */
  ground: number;
  surface: number;
  wallL: boolean;
  wallR: boolean;
}

export const newHit = (): TrackHit => ({
  spline: 0,
  s: 0,
  lateral: 0,
  cx: 0,
  cy: 0,
  cz: 0,
  tx: 0,
  tz: 1,
  width: 10,
  shoulder: 4,
  bank: 0,
  ground: 0,
  surface: 0,
  wallL: true,
  wallR: true,
});

/** Fills `out` with the spline's interpolated state at distance s (lateral and ground at lateral 0). */
export function sampleAt(sp: BakedSpline, s: number, out: TrackHit): TrackHit {
  s = sp.closed ? wrap(s, sp.length) : Math.max(0, Math.min(sp.length, s));
  const u = s / sp.step;
  let i0 = Math.floor(u);
  let f = u - i0;
  let i1: number;
  if (sp.closed) {
    i0 %= sp.n;
    i1 = (i0 + 1) % sp.n;
  } else {
    if (i0 >= sp.n - 1) {
      i0 = sp.n - 2;
      f = 1;
    }
    i1 = i0 + 1;
  }
  const g = 1 - f;
  out.spline = sp.index;
  out.s = s;
  out.cx = sp.px[i0] * g + sp.px[i1] * f;
  out.cy = sp.py[i0] * g + sp.py[i1] * f + (sp.ramp[i0] * g + sp.ramp[i1] * f);
  out.cz = sp.pz[i0] * g + sp.pz[i1] * f;
  let tx = sp.tx[i0] * g + sp.tx[i1] * f;
  let tz = sp.tz[i0] * g + sp.tz[i1] * f;
  const tl = Math.hypot(tx, tz) || 1;
  out.tx = tx / tl;
  out.tz = tz / tl;
  out.width = sp.width[i0] * g + sp.width[i1] * f;
  out.shoulder = sp.shoulder[i0] * g + sp.shoulder[i1] * f;
  out.bank = sp.bank[i0] * g + sp.bank[i1] * f;
  const near = f < 0.5 ? i0 : i1;
  out.surface = sp.surface[near];
  out.wallL = sp.wallL[near] === 1;
  out.wallR = sp.wallR[near] === 1;
  out.lateral = 0;
  out.ground = out.cy;
  return out;
}

/**
 * Projects the point (x, z) onto a spline, starting from a nearby distance `hint`. A few Newton
 * steps along the tangent; converges from anywhere within about a corner's radius. Returns the
 * distance from the centerline (use `projectGlobal` when the hint may be far off).
 */
export function project(sp: BakedSpline, x: number, z: number, hint: number, out: TrackHit): number {
  let s = hint;
  for (let k = 0; k < 6; k++) {
    sampleAt(sp, s, out);
    const d = (x - out.cx) * out.tx + (z - out.cz) * out.tz;
    s = out.s + d;
    if (Math.abs(d) < 0.01) break;
  }
  sampleAt(sp, s, out);
  finishProjection(out, x, z);
  return Math.abs(out.lateral);
}

/** Projects with a coarse search over the whole spline first. For spawns and teleports, not every tick. */
export function projectGlobal(sp: BakedSpline, x: number, z: number, out: TrackHit): number {
  let best = 0;
  let bestD = Infinity;
  const stride = Math.max(1, Math.round(8 / sp.step));
  for (let i = 0; i < sp.n; i += stride) {
    const d = (sp.px[i] - x) ** 2 + (sp.pz[i] - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return project(sp, x, z, best * sp.step, out);
}

function finishProjection(out: TrackHit, x: number, z: number): void {
  // right = (-tz, tx)
  out.lateral = (x - out.cx) * -out.tz + (z - out.cz) * out.tx;
  out.ground = out.cy - out.lateral * Math.tan(out.bank);
}

/**
 * Surface under (spline, s, lateral): dynamic zones first (not in milestone 1), then authored zones,
 * then the road's own surface on the asphalt and the shoulder's beyond it.
 */
export function surfaceAt(track: Track, hit: TrackHit, wet: boolean, shoulderSurface: number): number {
  const sp = track.splines[hit.spline];
  for (const z of sp.zones) {
    if (z.when === 1 && !wet) continue;
    if (z.when === 2 && wet) continue;
    const inS = z.s0 <= z.s1 ? hit.s >= z.s0 && hit.s <= z.s1 : hit.s >= z.s0 || hit.s <= z.s1;
    if (inS && hit.lateral >= z.l0 && hit.lateral <= z.l1) return z.surface;
  }
  if (Math.abs(hit.lateral) > hit.width / 2) return shoulderSurface;
  return hit.surface;
}
