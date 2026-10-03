// Per-tick track queries: where is this point along a spline (s, lateral), how high is the ground,
// what surface is it, is there a wall. Results go into a caller-owned `TrackHit` so nothing
// allocates in the tick.

import { VERGE_DEFAULT, wrap, type BakedSpline, type Track } from './bake';
import { hypot, sq, tan } from '../math';

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
  /** The ramp's height at s (in `cy`), and how far past the road's edge its sides run out (0: never). */
  ramp: number;
  rampFlank: number;
  surface: number;
  /** The surface past the road's edge (VERGE_DEFAULT: the layout's shoulderSurface). */
  verge: number;
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
  ramp: 0,
  rampFlank: 0,
  surface: 0,
  verge: VERGE_DEFAULT,
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
  out.ramp = sp.ramp[i0] * g + sp.ramp[i1] * f;
  out.cy = sp.py[i0] * g + sp.py[i1] * f + out.ramp;
  out.cz = sp.pz[i0] * g + sp.pz[i1] * f;
  let tx = sp.tx[i0] * g + sp.tx[i1] * f;
  let tz = sp.tz[i0] * g + sp.tz[i1] * f;
  const tl = hypot(tx, tz) || 1;
  out.tx = tx / tl;
  out.tz = tz / tl;
  out.width = sp.width[i0] * g + sp.width[i1] * f;
  out.shoulder = sp.shoulder[i0] * g + sp.shoulder[i1] * f;
  out.bank = sp.bank[i0] * g + sp.bank[i1] * f;
  const near = f < 0.5 ? i0 : i1;
  out.surface = sp.surface[near];
  out.verge = sp.verge[near];
  out.wallL = sp.wallL[near] === 1;
  out.wallR = sp.wallR[near] === 1;
  out.rampFlank = Math.max(sp.rampFlank[i0], sp.rampFlank[i1]);
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
  finishProjection(sp, out, x, z);
  return Math.abs(out.lateral);
}

/**
 * Projects with a coarse search over the whole spline first. For spawns and teleports, not every
 * tick. Give `y` where a lap crosses over itself, so the search picks the level you're on.
 */
export function projectGlobal(sp: BakedSpline, x: number, z: number, out: TrackHit, y?: number): number {
  let best = 0;
  let bestD = Infinity;
  const stride = Math.max(1, Math.round(8 / sp.step));
  for (let i = 0; i < sp.n; i += stride) {
    let d = sq(sp.px[i] - x) + sq(sp.pz[i] - z);
    if (y !== undefined) d += 16 * sq(sp.py[i] - y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return project(sp, x, z, best * sp.step, out);
}

function finishProjection(sp: BakedSpline, out: TrackHit, x: number, z: number): void {
  // right = (-tz, tx)
  out.lateral = (x - out.cx) * -out.tz + (z - out.cz) * out.tx;
  out.ground = sp.ground ? sp.ground.top(x, z, out.cy + 0.5) : out.cy - out.lateral * tan(out.bank) - flankDrop(out);
}

/** How far a ramp's height has run out at the hit's lateral: past the road's edge and shoulder, over its flank. */
export function flankDrop(hit: TrackHit): number {
  if (hit.rampFlank <= 0 || hit.ramp <= 0) return 0;
  const over = Math.abs(hit.lateral) - hit.width / 2 - hit.shoulder;
  return over <= 0 ? 0 : hit.ramp * Math.min(1, over / hit.rampFlank);
}

/**
 * Surface under (spline, s, lateral): dynamic zones first (not in milestone 1), then authored zones,
 * then the road's own surface on the asphalt and the verge's beyond it (the stretch's own, or the
 * layout's shoulder surface).
 */
export function surfaceAt(track: Track, hit: TrackHit, wet: boolean, shoulderSurface: number): number {
  const sp = track.splines[hit.spline];
  for (let k = 0; k < sp.zones.length; k++) {
    const z = sp.zones[k];
    if (z.when === 1 && !wet) continue;
    if (z.when === 2 && wet) continue;
    const inS = z.s0 <= z.s1 ? hit.s >= z.s0 && hit.s <= z.s1 : hit.s >= z.s0 || hit.s <= z.s1;
    if (inS && hit.lateral >= z.l0 && hit.lateral <= z.l1) return z.surface;
  }
  if (Math.abs(hit.lateral) > hit.width / 2) {
    // On a beach's side of the main road (GroundDef.beaches), sand down to the sea.
    const b = hit.spline === 0 ? track.ground?.beach[Math.round(hit.s / sp.step) % sp.n] : 0;
    if (b && b * hit.lateral > 0 && Math.abs(b) >= 0.5) return track.surfaceIndex.get('sand') ?? hit.surface;
    return hit.verge === VERGE_DEFAULT ? shoulderSurface : hit.verge;
  }
  return hit.surface;
}
