// Centripetal Catmull-Rom, the curve every track is drawn with (SPEC §5). It passes through each
// control point and doesn't loop or cusp on uneven spacing, which is what an editor needs.

import type { Vec3 } from '../content';
import { hypot } from '../math';

const EPS = 1e-4;

/** Point on the centripetal Catmull-Rom segment p1→p2 at t ∈ [0, 1], written into `out`. */
export function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number, out: Vec3): Vec3 {
  const k = (a: Vec3, b: Vec3, prev: number) =>
    prev + Math.max(EPS, Math.sqrt(hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])));
  const t0 = 0;
  const t1 = k(p0, p1, t0);
  const t2 = k(p1, p2, t1);
  const t3 = k(p2, p3, t2);
  const u = t1 + (t2 - t1) * t;
  for (let i = 0; i < 3; i++) {
    const a1 = ((t1 - u) / (t1 - t0)) * p0[i] + ((u - t0) / (t1 - t0)) * p1[i];
    const a2 = ((t2 - u) / (t2 - t1)) * p1[i] + ((u - t1) / (t2 - t1)) * p2[i];
    const a3 = ((t3 - u) / (t3 - t2)) * p2[i] + ((u - t2) / (t3 - t2)) * p3[i];
    const b1 = ((t2 - u) / (t2 - t0)) * a1 + ((u - t0) / (t2 - t0)) * a2;
    const b2 = ((t3 - u) / (t3 - t1)) * a2 + ((u - t1) / (t3 - t1)) * a3;
    out[i] = ((t2 - u) / (t2 - t1)) * b1 + ((u - t1) / (t2 - t1)) * b2;
  }
  return out;
}

export interface DenseSample {
  x: number;
  y: number;
  z: number;
  /** Arc length from the start. */
  s: number;
  /** Control segment index and the parameter within it, for interpolating per-point attributes. */
  seg: number;
  t: number;
}

/**
 * Samples a spline densely (about every `spacing` meters of chord) and measures arc length.
 * `closed` joins the last point back to the first. For open splines the end tangents come from
 * `before`/`after` if given (e.g. the main road a branch leaves from), else they're mirrored.
 */
export function sampleDense(points: Vec3[], closed: boolean, spacing = 0.25, before?: Vec3, after?: Vec3): DenseSample[] {
  const n = points.length;
  const segs = closed ? n : n - 1;
  const at = (i: number): Vec3 => {
    if (closed) return points[((i % n) + n) % n];
    if (i < 0) return before ?? mirror(points[0], points[1]);
    if (i >= n) return after ?? mirror(points[n - 1], points[n - 2]);
    return points[i];
  };
  const out: DenseSample[] = [];
  const p: Vec3 = [0, 0, 0];
  let s = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const chord = hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
    const steps = Math.max(4, Math.ceil(chord / spacing));
    const last = i === segs - 1 && !closed;
    for (let j = 0; j < steps + (last ? 1 : 0); j++) {
      const t = j / steps;
      catmullRom(p0, p1, p2, p3, t, p);
      if (out.length) s += hypot(p[0] - px, p[1] - py, p[2] - pz);
      out.push({ x: p[0], y: p[1], z: p[2], s, seg: i, t });
      px = p[0];
      py = p[1];
      pz = p[2];
    }
  }
  if (closed) {
    // Close the loop: the distance from the last sample back to the first.
    const f = out[0];
    s += hypot(f.x - px, f.y - py, f.z - pz);
    out.push({ x: f.x, y: f.y, z: f.z, s, seg: segs - 1, t: 1 });
  }
  return out;
}

const mirror = (a: Vec3, b: Vec3): Vec3 => [2 * a[0] - b[0], 2 * a[1] - b[1], 2 * a[2] - b[2]];
