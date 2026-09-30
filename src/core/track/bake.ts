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
  if (Array.isArray(layout.checkpoints)) checkpoints = [...layout.checkpoints].sort((a, b) => a - b);
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
  }

  const props: BakedProp[] = [];
  for (const p of layout.props ?? []) {
    const sp = pick(p.spline);
    if (!sp) continue;
    const i = sampleIndex(sp, p.s);
    const rx = -sp.tz[i];
    const rz = sp.tx[i];
    const edge = sp.width[i] / 2 + sp.shoulder[i] + (p.offset ?? 2) + p.size[0] / 2;
    props.push({
      kind: p.kind,
      x: sp.px[i] + rx * edge * p.side,
      y: sp.py[i],
      z: sp.pz[i] + rz * edge * p.side,
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

function bakeBranch(b: BranchDef, index: number, main: BakedSpline, surfaceIndex: Map<string, number>): BakedSpline {
  // The branch starts and ends exactly on the main road, and its end tangents follow it.
  const start = mainPoint(main, b.from);
  const end = mainPoint(main, b.to);
  const before = mainPoint(main, b.from - 20).p;
  const after = mainPoint(main, b.to + 20).p;
  const pts: TrackPoint[] = [{ ...start, width: b.points[0]?.width ?? start.width }, ...b.points, { ...end, width: b.points[b.points.length - 1]?.width ?? end.width }];
  const sp = bakeSpline(b.id, index, pts, false, surfaceIndex, before, after);
  sp.mainFrom = wrap(b.from, main.length);
  sp.mainTo = wrap(b.to, main.length);
  return sp;
}

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
    chunks: [],
  };
}

export const wrap = (s: number, L: number): number => ((s % L) + L) % L;

/** Nearest sample index to distance `s` (wrapped on closed splines, clamped on open ones). */
export function sampleIndex(sp: BakedSpline, s: number): number {
  if (sp.closed) return Math.round(wrap(s, sp.length) / sp.step) % sp.n;
  return Math.max(0, Math.min(sp.n - 1, Math.round(s / sp.step)));
}

/** Calls `fn` for each sample index in the distance range [s0, s1] (wrapping on closed splines). */
export function forRange(sp: BakedSpline, s0: number, s1: number, fn: (i: number, s: number) => void): void {
  const count = Math.max(0, Math.round((s1 - s0) / sp.step));
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
