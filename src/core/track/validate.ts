// Layout checks (SPEC §5, "Validation"): shape first, then gameplay. The editor shows these on
// the map as you edit, and CI runs them over every layout. Milestone 2 adds the AI lap checks.

import type { CarClass, SurfaceDef, TrackLayout } from '../content';
import { bakeTrack, wrap } from './bake';

export interface Problem {
  level: 'error' | 'warning';
  message: string;
  /** Where on the track, for the editor to point at. */
  spline?: string;
  s?: number;
}

const GRID_LENGTH = 50;

export function validateLayout(layout: TrackLayout, surfaces: SurfaceDef[], classes: CarClass[]): Problem[] {
  const out: Problem[] = [];
  const err = (message: string, spline?: string, s?: number) => out.push({ level: 'error', message, spline, s });
  const warn = (message: string, spline?: string, s?: number) => out.push({ level: 'warning', message, spline, s });

  if (!layout.id) err('layout has no id');
  if (!layout.main?.points || layout.main.points.length < 4) {
    err('the main spline needs at least 4 points');
    return out;
  }
  const surfaceIds = new Set(surfaces.map((s) => s.id));
  const checkPoints = (pts: TrackLayout['main']['points'], name: string) => {
    pts.forEach((p, k) => {
      if (!Array.isArray(p.p) || p.p.length !== 3 || p.p.some((n) => !Number.isFinite(n))) err(`${name} point ${k}: position must be [x, y, z]`, name);
      if (!(p.width > 0)) err(`${name} point ${k}: width must be positive`, name);
      if (p.surface && !surfaceIds.has(p.surface)) err(`${name} point ${k}: unknown surface "${p.surface}"`, name);
    });
  };
  checkPoints(layout.main.points, 'main');
  for (const b of layout.branches ?? []) checkPoints(b.points, b.id);
  for (const z of layout.zones ?? []) if (!surfaceIds.has(z.surface)) err(`zone: unknown surface "${z.surface}"`);
  if (out.some((p) => p.level === 'error')) return out;

  const track = bakeTrack(layout, surfaces);
  const L = track.main.length;

  // Roads that cross (an overpass, a lap that loops over itself) need headroom; roads that meet at
  // one level must be a junction (a branch's ends), not two roads running through each other.
  {
    const CLEAR = 7;
    const pts: { sp: number; s: number; x: number; y: number; z: number; r: number }[] = [];
    for (const sp of track.splines) for (let i = 0; i < sp.n; i += 4) pts.push({ sp: sp.index, s: i * sp.step, x: sp.px[i], y: sp.py[i], z: sp.pz[i], r: sp.width[i] / 2 + sp.shoulder[i] });
    const near = (a: number, b: number, len: number) => Math.abs(wrap(a - b + len / 2, len) - len / 2);
    const reported = new Set<string>();
    for (let a = 0; a < pts.length; a++) {
      for (let b = a + 1; b < pts.length; b++) {
        const A = pts[a];
        const B = pts[b];
        if (Math.abs(A.x - B.x) > A.r + B.r || Math.abs(A.z - B.z) > A.r + B.r) continue;
        if (Math.hypot(A.x - B.x, A.z - B.z) > A.r + B.r || Math.abs(A.y - B.y) >= CLEAR) continue;
        if (A.sp === B.sp) {
          const sp = track.splines[A.sp];
          if ((sp.closed ? near(A.s, B.s, sp.length) : Math.abs(A.s - B.s)) < 3 * (A.r + B.r) + 20) continue;
        } else {
          // A branch meets the main road at its ends.
          const br = track.splines[Math.max(A.sp, B.sp)];
          const other = A.sp === 0 ? A : B.sp === 0 ? B : null;
          const self = A.sp === br.index ? A : B;
          if (self.s < 90 || self.s > br.length - 90) continue;
          if (other && (near(other.s, br.mainFrom, L) < 120 || near(other.s, br.mainTo, L) < 120)) continue;
        }
        const key = `${A.sp}:${Math.round(A.s / 50)}`;
        if (reported.has(key)) continue;
        reported.add(key);
        err(`roads overlap with ${Math.abs(A.y - B.y).toFixed(1)} m between them (${track.splines[A.sp].id} ${A.s.toFixed(0)} m and ${track.splines[B.sp].id} ${B.s.toFixed(0)} m); cross with ${CLEAR} m of headroom or not at all`, track.splines[A.sp].id, A.s);
      }
    }
  }
  const widest = Math.max(...classes.map((c) => c.size[0] * 2));
  const minWidth = widest * 2 + 1;
  for (const sp of track.splines) {
    for (let i = 0; i < sp.n; i += 5) {
      if (sp.width[i] < minWidth) {
        err(`road narrower than ${minWidth.toFixed(1)} m (two of the widest car plus a meter)`, sp.id, i * sp.step);
        break;
      }
    }
    // Corners too tight for the width: the inside edge would fold over itself.
    for (let i = 2; i < sp.n - 2; i += 2) {
      const a = Math.atan2(sp.tx[i - 2], sp.tz[i - 2]);
      const b = Math.atan2(sp.tx[i + 2], sp.tz[i + 2]);
      const turn = Math.abs(wrap(b - a + Math.PI, Math.PI * 2) - Math.PI);
      const radius = (4 * sp.step) / Math.max(turn, 1e-6);
      if (radius < sp.width[i] / 2 + sp.shoulder[i]) {
        warn(`corner radius ${radius.toFixed(1)} m is tighter than half the road plus shoulder; the inside edge folds`, sp.id, i * sp.step);
        i += 20;
      }
    }
  }

  // The start grid: a fairly straight run behind the line.
  const g0 = Math.round(wrap(-GRID_LENGTH, L) / track.main.step);
  const g1 = track.main.n - 1;
  const h0 = Math.atan2(track.main.tx[g0], track.main.tz[g0]);
  const h1 = Math.atan2(track.main.tx[g1], track.main.tz[g1]);
  if (Math.abs(wrap(h1 - h0 + Math.PI, Math.PI * 2) - Math.PI) > 0.35) err('the start grid (50 m behind the line) should be straight', 'main', L - GRID_LENGTH);

  // Branches rejoin forward, and don't skip a checkpoint without a replacement.
  for (const sp of track.splines.slice(1)) {
    const span = wrap(sp.mainTo - sp.mainFrom, L);
    if (span <= 0 || span > L / 2) err(`branch ${sp.id} must rejoin ahead of where it leaves`, sp.id);
    for (const cp of track.checkpoints) {
      if (wrap(cp - sp.mainFrom, L) < span) err(`branch ${sp.id} skips checkpoint at ${cp.toFixed(0)} m; move the checkpoints (or list them in "checkpoints")`, 'main', cp);
    }
    if (sp.length > span) warn(`branch ${sp.id} is longer (${sp.length.toFixed(0)} m) than what it skips (${span.toFixed(0)} m), so it isn't a shortcut`, sp.id);
  }

  if (track.checkpoints.length < 5) warn(`only ${track.checkpoints.length} checkpoints after moving them off shortcuts; list them in "checkpoints"`);
  for (const r of layout.ramps ?? []) if (r.s < 0 || r.s > L) err(`ramp at ${r.s} is off the main spline (0–${L.toFixed(0)})`);
  for (const z of layout.zones ?? []) if (z.s[0] < 0 || z.s[1] > L) warn(`zone ${z.surface} runs past the spline's length`);
  if (L < 2000) warn(`lap is ${L.toFixed(0)} m; full layouts aim for 3,500–5,000 m (70–100 s)`);
  // Traffic appears where its section starts and vanishes where it ends (oncoming traffic the other
  // way round). Popping in mid-corner, round a blind bend, is a wreck nobody could see coming.
  {
    const main = track.main;
    const turnAt = (s: number) => {
      const i = Math.round(wrap(s, L) / main.step) % main.n;
      const a = (i - 20 + main.n) % main.n;
      const b = (i + 20) % main.n;
      return Math.abs(wrap(Math.atan2(main.tx[b], main.tz[b]) - Math.atan2(main.tx[a], main.tz[a]) + Math.PI, Math.PI * 2) - Math.PI);
    };
    const seen = new Set<number>();
    for (const lane of layout.traffic?.lanes ?? []) {
      for (const [a, b] of lane.sections ?? []) {
        for (const s of [a, b]) {
          if (seen.has(s)) continue;
          seen.add(s);
          if (turnAt(s) > (8 * Math.PI) / 180) warn(`traffic section ends at ${s.toFixed(0)} m, in a corner: traffic pops in and out there; end it on a straight`, 'main', s);
        }
      }
    }
  }

  return out;
}

/**
 * Moves every traffic section's ends inward (the start forward, the end back) until each sits on
 * a straight with 40 m of straight road leading to it, so traffic appears and leaves where drivers
 * can see it coming. Sections that shrink to nothing are dropped. Returns the layout, changed.
 */
export function straightenSections(layout: TrackLayout, surfaces: SurfaceDef[]): TrackLayout {
  const track = bakeTrack(layout, surfaces);
  const main = track.main;
  const L = main.length;
  const straightAt = (s: number) => {
    for (let d = -40; d <= 40; d += 10) {
      const i = Math.round(wrap(s + d, L) / main.step) % main.n;
      const a = (i - 20 + main.n) % main.n;
      const b = (i + 20) % main.n;
      const turn = Math.abs(wrap(Math.atan2(main.tx[b], main.tz[b]) - Math.atan2(main.tx[a], main.tz[a]) + Math.PI, Math.PI * 2) - Math.PI);
      if (turn > (5 * Math.PI) / 180) return false;
    }
    return true;
  };
  for (const lane of layout.traffic?.lanes ?? []) {
    if (!lane.sections) continue;
    lane.sections = lane.sections
      .map(([a, b]) => {
        const len = wrap(b - a, L);
        let lo = 0;
        let hi = len;
        while (lo < hi && !straightAt(a + lo)) lo += 5;
        while (hi > lo && !straightAt(a + hi)) hi -= 5;
        return hi - lo < 80 ? null : ([Math.round(wrap(a + lo, L)), Math.round(wrap(a + hi, L))] as [number, number]);
      })
      .filter((x): x is [number, number] => x !== null);
  }
  return layout;
}
