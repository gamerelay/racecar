// Layout checks (SPEC §5, "Validation"): shape first, then gameplay. The editor shows these on
// the map as you edit, and CI runs them over every layout. Milestone 2 adds the AI lap checks.

import { LANDMARK_KINDS, type CarClass, type SurfaceDef, type TrackLayout } from '../content';
import { KINDS } from '../world/hazards';
import { SMASH_IDS } from '../world/smash';
import { bakeTrack, sampleIndex, wrap } from './bake';
import { atan2, hypot } from '../math';

export interface Problem {
  level: 'error' | 'warning';
  message: string;
  /** Where on the track, for the editor to point at. */
  spline?: string;
  s?: number;
}

const GRID_LENGTH = 50;
/** The sharpest a branch may leave or rejoin the main road at, in degrees. */
const MAX_FORK = 35;

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
        if (hypot(A.x - B.x, A.z - B.z) > A.r + B.r || Math.abs(A.y - B.y) >= CLEAR) continue;
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
      const a = atan2(sp.tx[i - 2], sp.tz[i - 2]);
      const b = atan2(sp.tx[i + 2], sp.tz[i + 2]);
      const turn = Math.abs(wrap(b - a + Math.PI, Math.PI * 2) - Math.PI);
      const radius = (4 * sp.step) / Math.max(turn, 1e-6);
      if (radius < sp.width[i] / 2 + sp.shoulder[i]) {
        warn(`corner radius ${radius.toFixed(1)} m is tighter than half the road plus shoulder; the inside edge folds`, sp.id, i * sp.step);
        i += 20;
      }
    }
  }

  // The start grid: a fairly straight run behind the line (a lap's at the end of the loop, before
  // s = 0; one run's behind its start, at the top).
  const run = layout.run;
  if (run && !(run.start >= GRID_LENGTH && run.start < run.finish && run.finish <= L)) {
    err(`the run (${run.start}–${run.finish} m) must start at least ${GRID_LENGTH} m along the main road (its grid is behind the line) and finish ahead of that, by its end (${L.toFixed(0)} m)`, 'main', run.start);
    return out;
  }
  const lineAt = run ? run.start : L;
  const g0 = Math.round(wrap(lineAt - GRID_LENGTH, L) / track.main.step);
  const g1 = Math.min(track.main.n - 1, Math.round(lineAt / track.main.step));
  const h0 = atan2(track.main.tx[g0], track.main.tz[g0]);
  const h1 = atan2(track.main.tx[g1], track.main.tz[g1]);
  if (Math.abs(wrap(h1 - h0 + Math.PI, Math.PI * 2) - Math.PI) > 0.35) err('the start grid (50 m behind the line) should be straight', 'main', lineAt - GRID_LENGTH);
  if (run) checkRun(layout, track, err, warn);

  // Branches fork off and rejoin gently: an end's nearest point well along the road, not out to
  // the side (the baker adds a slip point when there's room; a sharp fork is a hard kink).
  for (const b of layout.branches ?? []) {
    const ends = [
      [b.from, b.points[0], 1],
      [b.to, b.points[b.points.length - 1], -1],
    ] as const;
    for (const [s, p, dir] of ends) {
      if (!p) continue;
      const i = sampleIndex(track.main, s);
      const m = track.main;
      const along = ((p.p[0] - m.px[i]) * m.tx[i] + (p.p[2] - m.pz[i]) * m.tz[i]) * dir;
      const lat = (p.p[0] - m.px[i]) * -m.tz[i] + (p.p[2] - m.pz[i]) * m.tx[i];
      const angle = (atan2(Math.abs(lat), along) * 180) / Math.PI;
      if (angle > MAX_FORK) warn(`branch ${b.id} ${dir > 0 ? 'leaves' : 'rejoins'} the main road at ${angle.toFixed(0)}°; put its ${dir > 0 ? 'first' : 'last'} point further along and closer in (under ${MAX_FORK}°)`, b.id, dir > 0 ? 0 : undefined);
    }
  }

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
  // Pieces (docs/CALDERA.md): on open ground, each on a road that's there, within it.
  const pieceIds = new Set<string>();
  for (const p of layout.pieces ?? []) {
    const name = `piece ${p.id}`;
    if (!layout.ground) err(`${name}: pieces need open ground ("ground")`);
    if (pieceIds.has(p.id)) err(`${name}: there's another piece with that id`);
    pieceIds.add(p.id);
    const sp = p.road === undefined ? track.main : track.splines.find((b) => b.id === p.road && b !== track.main);
    if (!sp) {
      err(`${name}: no branch "${p.road}"`);
      continue;
    }
    if (!(p.s[0] < p.s[1]) || p.s[0] < 0 || p.s[1] > sp.length) err(`${name}: s ${p.s[0]}–${p.s[1]} m isn't a stretch of ${sp === track.main ? 'the main road' : sp.id} (0–${sp.length.toFixed(0)})`, sp.id, p.s[0]);
    if (p.under && sp !== track.main) err(`${name}: "under" shapes the ground under the main road only, for now`, sp.id, p.s[0]);
    if (p.ceiling !== undefined && (p.floor === false || !(p.ceiling > 0))) err(`${name}: a ceiling needs a floor under it, and a height over it`, sp.id, p.s[0]);
  }
  for (const z of layout.zones ?? []) if (z.s[0] < 0 || z.s[1] > L) warn(`zone ${z.surface} runs past the spline's length`);
  for (const d of layout.smashables ?? []) {
    if (!SMASH_IDS.includes(d.kind)) err(`smashables: unknown kind "${d.kind}"`);
    else if (!(d.every >= 2)) err(`smashables ${d.kind}: "every" must be at least 2 m`);
    else if (d.spline && !(layout.branches ?? []).some((b) => b.id === d.spline)) err(`smashables ${d.kind}: no branch "${d.spline}"`);
  }
  // Landmarks stand clear of every road (to the back of its wall), by their footprint.
  for (const m of layout.landmarks ?? []) {
    if (!(LANDMARK_KINDS as readonly string[]).includes(m.kind)) {
      err(`landmark: unknown kind "${m.kind}"`);
      continue;
    }
    if (!(m.r > 0)) continue;
    let worst = Infinity;
    let at = { sp: '', s: 0 };
    for (const sp of track.splines) {
      for (let i = 0; i < sp.n; i += 2) {
        const gap = hypot(sp.px[i] - m.at[0], sp.pz[i] - m.at[1]) - (sp.width[i] / 2 + sp.shoulder[i] + 0.5);
        if (gap < worst) {
          worst = gap;
          at = { sp: sp.id, s: i * sp.step };
        }
      }
    }
    if (worst < m.r) err(`landmark ${m.kind} at [${m.at.join(', ')}] needs ${m.r} m clear of the road, and ${at.sp} ${at.s.toFixed(0)} m is ${Math.max(0, worst).toFixed(1)} m off`, at.sp, at.s);
  }
  if (!run && L < 2000) warn(`lap is ${L.toFixed(0)} m; full layouts aim for 3,500–5,000 m (70–100 s)`);
  if (layout.avalanche && !run) warn('an avalanche comes only down one run (layout.run): on a lap it never does');
  // Traffic appears where its section starts and vanishes where it ends (oncoming traffic the other
  // way round). Popping in mid-corner, round a blind bend, is a wreck nobody could see coming.
  {
    const main = track.main;
    const turnAt = (s: number) => {
      const i = Math.round(wrap(s, L) / main.step) % main.n;
      const a = (i - 20 + main.n) % main.n;
      const b = (i + 20) % main.n;
      return Math.abs(wrap(atan2(main.tx[b], main.tz[b]) - atan2(main.tx[a], main.tz[a]) + Math.PI, Math.PI * 2) - Math.PI);
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

  // Hazards: a kind that exists, placed where it can happen.
  for (const [k, h] of (layout.hazards ?? []).entries()) {
    const kind = KINDS[h.use];
    if (!kind) {
      err(`hazard ${k}: unknown kind "${h.use}" (it would never happen); kinds: ${Object.keys(KINDS).join(', ')}`);
      continue;
    }
    const [a, b] = typeof h.s === 'number' ? [h.s, h.s] : h.s;
    if ([a, b].some((s) => !(s >= 0 && s <= L))) err(`hazard ${h.use} at ${JSON.stringify(h.s)} is off the main spline (0–${L.toFixed(0)})`, 'main', a);
    if (kind.schedule === 'trigger' && typeof h.s !== 'number') err(`hazard ${h.use} is a trigger: it needs one point (s), not a range, or it never fires`, 'main', a);
  }
  // Traffic lanes: inside the road, one way or the other, moving.
  for (const [k, lane] of (layout.traffic?.lanes ?? []).entries()) {
    if (!(Math.abs(lane.pos) <= 1)) err(`traffic lane ${k}: pos ${lane.pos} is off the road (-1 to 1)`);
    if (lane.dir !== 1 && lane.dir !== -1) err(`traffic lane ${k}: dir must be 1 or -1`);
    if (!(lane.speed > 0)) err(`traffic lane ${k}: speed must be positive`);
    for (const [a, b] of lane.sections ?? []) if (!(a >= 0 && a <= L && b >= 0 && b <= L)) err(`traffic lane ${k}: section [${a}, ${b}] is off the main spline`, 'main', a);
  }

  return out;
}

/** Past the finish, at least this much road (m) to stop on: the AI plans to stop by its end. */
const RUN_OUT = 150;

/** One run's own checks (layout.run): the road past its finish, and what's on it in range. */
function checkRun(layout: TrackLayout, track: ReturnType<typeof bakeTrack>, err: (m: string, sp?: string, s?: number) => void, warn: (m: string, sp?: string, s?: number) => void): void {
  const run = layout.run!;
  const main = track.main;
  const L = main.length;
  if (L - run.finish < RUN_OUT) err(`only ${(L - run.finish).toFixed(0)} m of road past the finish; leave ${RUN_OUT} m to stop on`, 'main', run.finish);
  if (run.finish - run.start < 2000) warn(`the run is ${(run.finish - run.start).toFixed(0)} m; a full one aims for 70–100 s`);
  for (const cp of Array.isArray(layout.checkpoints) ? layout.checkpoints : []) {
    if (cp <= run.start || cp >= run.finish) warn(`checkpoint at ${cp} m is outside the run (${run.start}–${run.finish} m), so it's left out`, 'main', cp);
  }
  // Slalom gates: across the piste, inside the run.
  for (const [k, g] of (layout.slalom ?? []).entries()) {
    if (!(g.s > run.start && g.s < run.finish)) {
      err(`slalom gate ${k} at ${g.s} m is outside the run (${run.start}–${run.finish} m)`, 'main', g.s);
      continue;
    }
    const half = main.width[sampleIndex(main, g.s)] / 2;
    if (!(g.gap > 0) || Math.abs(g.lateral) + g.gap / 2 > half) err(`slalom gate ${k} at ${g.s} m: its flags (${g.gap} m apart, ${g.lateral} m across) must both stand on the piste (${half.toFixed(1)} m either side)`, 'main', g.s);
  }
  const jump = layout.skiJump;
  if (jump && !(jump.lip > run.start && jump.lip + jump.landing < run.finish)) err(`the ski jump (its lip at ${jump.lip} m, ${jump.landing} m of landing hill) must be inside the run`, 'main', jump.lip);
  const av = layout.avalanche;
  if (av) {
    if (!(av.speed > 0) || !(av.delay >= 0) || !(av.behind >= 0)) err('the avalanche needs a speed above 0, and a delay and a start behind the line of 0 or more');
    else if (av.behind > run.start) warn(`the avalanche breaks away ${av.behind} m above the line, but the road starts ${run.start} m above it: it starts at the road's top`);
  }
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
      const turn = Math.abs(wrap(atan2(main.tx[b], main.tz[b]) - atan2(main.tx[a], main.tz[a]) + Math.PI, Math.PI * 2) - Math.PI);
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
