// Baking turns a layout (control points, SPEC §5) into what the sim queries every tick: a table
// sampled every meter of arc length (center, tangent, width, height, bank, surface, walls), the
// branches mapped onto the main spline's distance, checkpoints, zones, ramps and render chunks.

import type { BranchDef, SurfaceDef, TrackLayout, TrackPoint, Vec3, ZoneDef } from '../content';
import { sampleDense, type DenseSample } from './spline';

/** Samples per meter of arc length. */
export const STEP = 1;
/** Render chunk length in meters. */
export const CHUNK = 60;
const DEFAULT_SHOULDER = 4;

export interface BakedZone {
  s0: number;
  s1: number;
  l0: number;
  l1: number;
  surface: number;
  when: 0 | 1 | 2; // 0 always, 1 wet only, 2 dry only
}

export interface BakedSpline {
  id: string;
  index: number;
  closed: boolean;
  length: number;
  /** Actual spacing (length / samples), about STEP. */
  step: number;
  n: number;
  px: Float64Array;
  py: Float64Array;
  pz: Float64Array;
  /** Unit tangent in the xz plane. */
  tx: Float64Array;
  tz: Float64Array;
  width: Float64Array;
  bank: Float64Array;
  shoulder: Float64Array;
  /** Extra ground height from ramps. */
  ramp: Float64Array;
  lanes: Uint8Array;
  surface: Uint8Array;
  /** 1 where there's a wall on that side. */
  wallL: Uint8Array;
  wallR: Uint8Array;
  zones: BakedZone[];
  /** For branches: the main-spline distances it leaves and rejoins at. */
  mainFrom: number;
  mainTo: number;
  /**
   * 1 where that side's curb and verge are open because another road runs through them: a branch's
   * mouth across the main road's verge, and a branch's own edge while it's still on the main road.
   */
  openL: Uint8Array;
  openR: Uint8Array;
  /** For branches: 1 where the branch lies on the main road (its deck is the main road's), fading to 0. */
  merge: Float64Array;
  /** Chunk boundaries (sample indices): chunk k covers [chunks[k], chunks[k+1]]. */
  chunks: number[];
}

export interface BakedProp {
  kind: string;
  x: number;
  y: number;
  z: number;
  /** Half extents. */
  hx: number;
  hy: number;
  hz: number;
  heading: number;
  /** On the road (a pillar): cars collide with it. Beyond the wall: scenery only. */
  solid: boolean;
  /** Where along its spline, for the AI. */
  spline: number;
  s: number;
  lateral: number;
}

export interface Track {
  layout: TrackLayout;
  splines: BakedSpline[];
  main: BakedSpline;
  surfaces: SurfaceDef[];
  surfaceIndex: Map<string, number>;
  /** Main-spline distances of the checkpoints, in order; the finish line is s = 0. */
  checkpoints: number[];
  props: BakedProp[];
  /** A stable hash of the layout JSON, carried in reports so a replay uses the same track. */
  version: string;
}

export function bakeTrack(layout: TrackLayout, surfaces: SurfaceDef[]): Track {
  const surfaceIndex = new Map(surfaces.map((s, i) => [s.id, i]));
  const main = bakeSpline(layout.id, 0, layout.main.points, true, surfaceIndex);
  const splines = [main];
  for (const b of layout.branches ?? []) splines.push(bakeBranch(b, splines.length, main, surfaceIndex));

  for (const sp of splines.slice(1)) joinBranch(main, sp);

  const gapsAuto: { spline: BakedSpline; s0: number; s1: number; side: -1 | 0 | 1 }[] = [];
  for (const sp of splines.slice(1)) {
    // Where a branch leaves and rejoins, open the main road's wall on the branch's side, and
    // leave the branch's own ends open where it overlaps the main road.
    const departSide = sideOf(main, sp, Math.min(30, sp.length / 3), sp.mainFrom);
    const rejoinSide = sideOf(main, sp, Math.max(0, sp.length - Math.min(30, sp.length / 3)), sp.mainTo);
    gapsAuto.push({ spline: main, s0: sp.mainFrom - 5, s1: sp.mainFrom + 70, side: departSide });
    gapsAuto.push({ spline: main, s0: sp.mainTo - 70, s1: sp.mainTo + 5, side: rejoinSide });
    gapsAuto.push({ spline: sp, s0: 0, s1: 40, side: 0 });
    gapsAuto.push({ spline: sp, s0: sp.length - 40, s1: sp.length, side: 0 });
  }
  const byId = new Map(splines.map((s) => [s.id, s]));
  const pick = (id?: string) => (id ? byId.get(id) : main);
  for (const g of layout.walls?.gaps ?? []) {
    const sp = pick(g.spline);
    if (sp) gapsAuto.push({ spline: sp, s0: g.s[0], s1: g.s[1], side: g.side === 'left' ? -1 : g.side === 'right' ? 1 : 0 });
  }
  for (const g of gapsAuto) {
    forRange(g.spline, g.s0, g.s1, (i) => {
      if (g.side <= 0) g.spline.wallL[i] = 0;
      if (g.side >= 0) g.spline.wallR[i] = 0;
    });
  }

  for (const r of layout.ramps ?? []) {
    const sp = pick(r.spline);
    if (!sp) continue;
    forRange(sp, r.s, r.s + r.length, (i, s) => {
      const u = (s - r.s) / r.length;
      sp.ramp[i] = Math.max(sp.ramp[i], r.height * u);
    });
  }

  for (const z of layout.zones ?? []) {
    const sp = pick(z.spline);
    if (sp) sp.zones.push(bakeZone(z, surfaceIndex));
  }

  const L = main.length;
  let checkpoints: number[];
  // A checkpoint on the line itself would be taken just after the lap counts, halving the laps:
  // the line is the lap, so drop any within 20 m of it.
  if (Array.isArray(layout.checkpoints)) checkpoints = layout.checkpoints.map((c) => (c >= 0 && c < L ? c : wrap(c, L))).filter((c) => c > 20 && c < L - 20).sort((a, b) => a - b);
  else {
    // Every 1/8 of the lap, stepped past any shortcut's span so no branch can skip one.
    checkpoints = Array.from({ length: 7 }, (_, k) => {
      let cp = ((k + 1) * L) / 8;
      for (const sp of splines.slice(1)) {
        const span = wrap(sp.mainTo - sp.mainFrom, L);
        if (wrap(cp - sp.mainFrom, L) < span) cp = wrap(sp.mainTo + 10, L);
      }
      return cp;
    });
    checkpoints.sort((a, b) => a - b);
    // Two stepped past the same shortcut land on the same spot: keep one.
    checkpoints = checkpoints.filter((cp, k) => k === 0 || cp - checkpoints[k - 1] > 20);
  }

  const props: BakedProp[] = [];
  for (const p of layout.props ?? []) {
    const sp = pick(p.spline);
    if (!sp) continue;
    const i = sampleIndex(sp, p.s);
    const rx = -sp.tz[i];
    const rz = sp.tx[i];
    const onRoad = p.lateral !== undefined;
    const lat = onRoad ? p.lateral! : (sp.width[i] / 2 + sp.shoulder[i] + (p.offset ?? 2) + p.size[0] / 2) * (p.side ?? 1);
    props.push({
      kind: p.kind,
      solid: onRoad,
      spline: sp.index,
      s: p.s,
      lateral: lat,
      x: sp.px[i] + rx * lat,
      y: sp.py[i],
      z: sp.pz[i] + rz * lat,
      hx: p.size[0] / 2,
      hy: p.size[1] / 2,
      hz: p.size[2] / 2,
      heading: Math.atan2(sp.tx[i], sp.tz[i]),
    });
  }

  return { layout, splines, main, surfaces, surfaceIndex, checkpoints, props, version: layoutVersion(layout) };
}

function bakeSpline(id: string, index: number, pts: TrackPoint[], closed: boolean, surfaceIndex: Map<string, number>, before?: Vec3, after?: Vec3): BakedSpline {
  const dense = sampleDense(
    pts.map((p) => p.p),
    closed,
    0.25,
    before,
    after,
  );
  const total = dense[dense.length - 1].s;
  const n = closed ? Math.max(8, Math.round(total / STEP)) : Math.max(2, Math.round(total / STEP) + 1);
  const step = closed ? total / n : total / (n - 1);
  const sp = emptySpline(id, index, closed, total, step, n);

  let d = 0;
  for (let i = 0; i < n; i++) {
    const s = i * step;
    while (d < dense.length - 2 && dense[d + 1].s < s) d++;
    const a = dense[d];
    const b = dense[Math.min(d + 1, dense.length - 1)];
    const f = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    sp.px[i] = a.x + (b.x - a.x) * f;
    sp.py[i] = a.y + (b.y - a.y) * f;
    sp.pz[i] = a.z + (b.z - a.z) * f;
    const { seg, t } = attrAt(a, b, f);
    const p0 = pts[seg % pts.length];
    const p1 = pts[(seg + 1) % pts.length];
    sp.width[i] = p0.width + (p1.width - p0.width) * t;
    sp.bank[i] = (p0.bank ?? 0) + ((p1.bank ?? 0) - (p0.bank ?? 0)) * t;
    sp.shoulder[i] = (p0.shoulder ?? DEFAULT_SHOULDER) + ((p1.shoulder ?? DEFAULT_SHOULDER) - (p0.shoulder ?? DEFAULT_SHOULDER)) * t;
    sp.lanes[i] = (t < 0.5 ? p0.lanes : p1.lanes) ?? 2;
    sp.surface[i] = surfaceIndex.get((t < 0.5 ? p0.surface : p1.surface) ?? 'asphalt') ?? 0;
    sp.wallL[i] = 1;
    sp.wallR[i] = 1;
  }
  for (let i = 0; i < n; i++) {
    const prev = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
    const next = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    const dx = sp.px[next] - sp.px[prev];
    const dz = sp.pz[next] - sp.pz[prev];
    const len = Math.hypot(dx, dz) || 1;
    sp.tx[i] = dx / len;
    sp.tz[i] = dz / len;
  }
  const perChunk = Math.max(1, Math.round(CHUNK / step));
  for (let i = 0; i < n; i += perChunk) sp.chunks.push(i);
  sp.chunks.push(closed ? n : n - 1);
  return sp;
}

/** How far along the main road a branch runs beside it before turning off (and before rejoining). */
const SLIP = 24;

function bakeBranch(b: BranchDef, index: number, main: BakedSpline, surfaceIndex: Map<string, number>): BakedSpline {
  // The branch starts and ends exactly on the main road. A slip point on each end keeps it running
  // along the main road's heading for a stretch, so it forks off gently rather than at an angle.
  const start = mainPoint(main, b.from);
  const end = mainPoint(main, b.to);
  const before = mainPoint(main, b.from - 20).p;
  const after = mainPoint(main, b.to + 20).p;
  const first = b.points[0];
  const last = b.points[b.points.length - 1];
  const lead = first && slipPoint(main, b.from, first, 1);
  const lag = last && slipPoint(main, b.to, last, -1);
  const pts: TrackPoint[] = [
    { ...start, width: first?.width ?? start.width },
    ...(lead ? [lead] : []),
    ...b.points,
    ...(lag ? [lag] : []),
    { ...end, width: last?.width ?? end.width },
  ];
  const sp = bakeSpline(b.id, index, pts, false, surfaceIndex, before, after);
  sp.mainFrom = wrap(b.from, main.length);
  sp.mainTo = wrap(b.to, main.length);
  return sp;
}

/**
 * The slip point between a branch's end on the main road (at main distance `s`) and its nearest
 * authored point `p`, `dir` 1 leaving and -1 rejoining: on along the main road, and only part of
 * the way out toward `p`, so the curve leaves along the main road's heading. None when `p` is too
 * close along the road to fit one.
 */
function slipPoint(main: BakedSpline, s: number, p: TrackPoint, dir: 1 | -1): TrackPoint | null {
  const i = sampleIndex(main, s);
  const along = ((p.p[0] - main.px[i]) * main.tx[i] + (p.p[2] - main.pz[i]) * main.tz[i]) * dir;
  if (along < 20) return null;
  const lat = (p.p[0] - main.px[i]) * -main.tz[i] + (p.p[2] - main.pz[i]) * main.tx[i];
  const j = Math.min(SLIP, along * 0.4);
  const m = mainPoint(main, s + j * dir);
  const k = sampleIndex(main, s + j * dir);
  const l = lat * (j / along) * 0.5;
  return {
    ...p,
    p: [m.p[0] - main.tz[k] * l, m.p[1] - l * Math.tan(main.bank[k]), m.p[2] + main.tx[k] * l],
    bank: main.bank[k],
  };
}

/**
 * Where a branch overlaps the main road, it must be the main road: the same ground (height and
 * bank) under its centerline, fading to its own as it pulls clear (JOIN_FADE). Also marks the curbs
 * and verges the two roads' decks run through (openL/openR), which the renderer leaves out.
 */
function joinBranch(main: BakedSpline, sp: BakedSpline): void {
  // From each end inward, until the branch has pulled clear (a branch may pass near some other
  // part of the main road in between: that's not a join).
  for (const [from, dir] of [[0, 1], [sp.n - 1, -1]] as const) {
    let hint = dir > 0 ? sp.mainFrom : sp.mainTo;
    for (let i = from; i >= 0 && i < sp.n; i += dir) {
      const k = nearestSample(main, sp.px[i], sp.pz[i], hint);
      hint = k * main.step;
      const rx = -main.tz[k];
      const rz = main.tx[k];
      const lat = (sp.px[i] - main.px[k]) * rx + (sp.pz[i] - main.pz[k]) * rz;
      const mh = main.width[k] / 2;
      const verge = mh + main.shoulder[k];
      const bh = sp.width[i] / 2;
      const w = 1 - smoothstep(0, JOIN_FADE, Math.abs(lat) - verge - bh);
      if (w <= 0) break;
      const ground = main.py[k] - lat * Math.tan(main.bank[k]);
      sp.py[i] += (ground - sp.py[i]) * w;
      sp.bank[i] += (main.bank[k] - sp.bank[i]) * w;
      sp.merge[i] = Math.max(sp.merge[i], w);
      // The branch's own edges: open while they're on the main road or its verge.
      const flip = sp.tx[i] * main.tx[k] + sp.tz[i] * main.tz[k] < 0 ? -1 : 1;
      if (Math.abs(lat - bh * flip) < verge) sp.openL[i] = 1;
      if (Math.abs(lat + bh * flip) < verge) sp.openR[i] = 1;
      // The main road's verge on the branch's side, where the branch's deck crosses it.
      if (Math.abs(lat) + bh > mh && Math.abs(lat) - bh < verge) {
        const open = lat < 0 ? main.openL : main.openR;
        for (let d = -2; d <= 2; d++) open[(k + d + main.n) % main.n] = 1;
      }
    }
  }
}

/** How far (m) a branch's ground fades from the main road's to its own once it's clear of it. */
const JOIN_FADE = 20;

/** The main-road sample nearest (x, z), searched within 60 m of main distance `hint`. */
function nearestSample(main: BakedSpline, x: number, z: number, hint: number): number {
  const i0 = sampleIndex(main, hint);
  const reach = Math.round(60 / main.step);
  let best = i0;
  let bestD = Infinity;
  for (let d = -reach; d <= reach; d++) {
    const i = (i0 + d + main.n) % main.n;
    const dd = (main.px[i] - x) ** 2 + (main.pz[i] - z) ** 2;
    if (dd < bestD) {
      bestD = dd;
      best = i;
    }
  }
  return best;
}

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function mainPoint(main: BakedSpline, s: number): TrackPoint {
  const i = sampleIndex(main, s);
  return { p: [main.px[i], main.py[i], main.pz[i]], width: main.width[i], bank: main.bank[i], shoulder: main.shoulder[i], lanes: main.lanes[i] };
}

/** Which side of `main` (at main distance `mainS`) the branch sample at `branchS` lies on. */
function sideOf(main: BakedSpline, branch: BakedSpline, branchS: number, mainS: number): -1 | 1 {
  const i = sampleIndex(main, mainS);
  const j = sampleIndex(branch, branchS);
  const lat = (branch.px[j] - main.px[i]) * -main.tz[i] + (branch.pz[j] - main.pz[i]) * main.tx[i];
  return lat < 0 ? -1 : 1;
}

function bakeZone(z: ZoneDef, surfaceIndex: Map<string, number>): BakedZone {
  return {
    s0: z.s[0],
    s1: z.s[1],
    l0: Math.min(z.lateral[0], z.lateral[1]),
    l1: Math.max(z.lateral[0], z.lateral[1]),
    surface: surfaceIndex.get(z.surface) ?? 0,
    when: z.when === 'wet' ? 1 : z.when === 'dry' ? 2 : 0,
  };
}

function attrAt(a: DenseSample, b: DenseSample, f: number): { seg: number; t: number } {
  if (a.seg === b.seg) return { seg: a.seg, t: a.t + (b.t - a.t) * f };
  return f < 0.5 ? { seg: a.seg, t: a.t } : { seg: b.seg, t: b.t };
}

function emptySpline(id: string, index: number, closed: boolean, length: number, step: number, n: number): BakedSpline {
  const f = () => new Float64Array(n);
  const u = () => new Uint8Array(n);
  return {
    id,
    index,
    closed,
    length,
    step,
    n,
    px: f(),
    py: f(),
    pz: f(),
    tx: f(),
    tz: f(),
    width: f(),
    bank: f(),
    shoulder: f(),
    ramp: f(),
    lanes: u(),
    surface: u(),
    wallL: u(),
    wallR: u(),
    zones: [],
    mainFrom: 0,
    mainTo: 0,
    openL: u(),
    openR: u(),
    merge: f(),
    chunks: [],
  };
}

export const wrap = (s: number, L: number): number => ((s % L) + L) % L;

/** Signed distance from b to a along a closed loop of length L, in (-L/2, L/2]: ahead is positive. */
export const signedGap = (a: number, b: number, L: number): number => wrap(a - b + L / 2, L) - L / 2;

/** Nearest sample index to distance `s` (wrapped on closed splines, clamped on open ones). */
export function sampleIndex(sp: BakedSpline, s: number): number {
  if (sp.closed) return Math.round(wrap(s, sp.length) / sp.step) % sp.n;
  return Math.max(0, Math.min(sp.n - 1, Math.round(s / sp.step)));
}

/**
 * Calls `fn` for each sample index in the distance range [s0, s1]. On a closed spline a range that
 * ends before it starts runs through the line ([L - 20, 20] is 40 m), like zones and sections.
 */
export function forRange(sp: BakedSpline, s0: number, s1: number, fn: (i: number, s: number) => void): void {
  const span = sp.closed && s1 < s0 ? wrap(s1 - s0, sp.length) : s1 - s0;
  const count = Math.max(0, Math.round(span / sp.step));
  for (let k = 0; k <= count; k++) {
    const s = s0 + k * sp.step;
    if (!sp.closed && (s < 0 || s > sp.length)) continue;
    fn(sampleIndex(sp, s), s);
  }
}

/** Distance along the main spline for a point on any spline (branches map linearly onto their span). */
export function mainDistance(track: Track, spline: number, s: number): number {
  if (spline === 0) return s;
  const b = track.splines[spline];
  const span = wrap(b.mainTo - b.mainFrom, track.main.length);
  return wrap(b.mainFrom + (s / b.length) * span, track.main.length);
}

export function layoutVersion(layout: TrackLayout): string {
  const json = JSON.stringify(layout);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
