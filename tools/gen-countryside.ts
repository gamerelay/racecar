// Generator for Countryside's Valley layout (v3: v2's lap re-laid for drifting). A lap through pine
// forest either side of a river, in order:
//
//   the Village         start/finish on the asphalt river road, traffic, then a flowing S through
//                       the village square (the Barn shortcut goes straight through the barn instead)
//   the Covered Bridge  a long left onto the bridge over the river, then two sweepers
//   the Switchbacks     dirt, up the ridge's flank: three hairpins, each leg with a flick in it
//   the Ridge           dirt along the top: sweepers over crests and two kickers; Logger's Leap
//                       jumps off the edge to cut the corner onto the Descent
//   the Descent         asphalt S-bends down the mountain, then the Trestle, a timber bridge high
//                       over the gorge (and over the river road you started on), after a curve
//   Pine Hollow         dirt hairpins down to the flats (the Creek Bed cuts across the stream),
//                       then a kink onto the river road, under the Trestle, to the line
//
// v3 (SPEC "Valley v3"): v2 was mostly straights and 90° corners on a narrow road. Now corners
// are sweepers and S-bends to hold a drift through, the road is wider (more so in the corners),
// and corners bank into the turn (smoothed, so an S rolls over rather than flips).
//
// After this the layout is edited in the editor; rerunning overwrites it.
//
//   bun tools/gen-countryside.ts

import { writeFileSync } from 'node:fs';
import type { BranchDef, TrackLayout, TrackPoint, Vec3 } from '../src/core/content';
import { bakeTrack } from '../src/core/track/bake';
import { newHit, projectGlobal, sampleAt } from '../src/core/track/query';
import { straightenSections } from '../src/core/track/validate';
import surfaces from '../content/surfaces.json';

/** A corner of the lap: r is its radius (none: a plain point). Bank: unset banks into the turn. */
type Node = { x: number; z: number; y: number; w: number; r?: number; surface: 'asphalt' | 'dirt'; shoulder: number; bank?: number };

const A = (x: number, z: number, y: number, r?: number, more: Partial<Node> = {}): Node => ({ x, z, y, w: 14.5, r, surface: 'asphalt', shoulder: 3, ...more });
const D = (x: number, z: number, y: number, r?: number, more: Partial<Node> = {}): Node => ({ x, z, y, w: 13, r, surface: 'dirt', shoulder: 2.5, ...more });

/** Drift corners (sweepers, not hairpins or kinks) are this much wider. */
const DRIFT_WIDTH = 1.5;
/** Bank into a corner (radians): hairpins a little, sweepers more. */
const bankFor = (r: number) => (r < 35 ? 0.06 : 0.1);

const nodes: Node[] = [
  // The river road north from the line, and the village S (left, right, right, left).
  A(0, -40, 0),
  A(0, 60, 0.5, 55),
  A(-40, 125, 1.5, 55),
  A(-40, 185, 1.5, 55),
  A(0, 250, 1, 55),
  // A long right onto the covered bridge, then two sweepers on up the valley side.
  A(0, 345, 1.5, 40),
  A(125, 312, 3, 70),
  A(195, 352, 5, 60),
  // The Switchbacks: legs south and north, each a step east and up the ridge, with a flick.
  D(255, 345, 6, 25),
  D(273, 262, 10, 70, { bank: 0 }),
  D(255, 180, 14, 25),
  D(305, 180, 17, 25),
  D(323, 255, 21, 70, { bank: 0 }),
  D(305, 330, 26, 25),
  D(355, 330, 29, 25),
  D(373, 250, 33, 70, { bank: 0 }),
  D(355, 170, 38, 30),
  // Onto the ridge, and south along its top: sweepers over the crests.
  D(415, 145, 48, 40),
  D(445, 70, 50, 90),
  D(412, -20, 52, 90),
  D(440, -105, 52, 80),
  // The Descent: asphalt S-bends down to the Trestle.
  A(430, -170, 50, 40),
  A(340, -150, 43, 55),
  A(290, -215, 36, 55),
  A(215, -235, 30, 55),
  // A curve onto the Trestle, which runs west, straight, over the gorge and the river road.
  A(165, -270, 27, 110),
  // Pine Hollow: dirt hairpins down to the flats.
  D(-125, -285, 18, 35),
  D(-135, -365, 13, 35),
  D(-205, -375, 10, 30),
  D(-210, -450, 5, 35),
  D(-90, -478, 2, 70),
  // A kink onto the river road home.
  A(-15, -400, 0.5, 70),
  A(0, -300, 0, 150),
];

// Crests to fly off: a bump in the height (meters) centered on the road nearest (x, z), over a length.
const crests = [
  { x: 440, z: 60, h: 3.2, len: 46 },
  { x: 420, z: -50, h: 2.6, len: 40 },
  { x: -10, z: -360, h: 1.6, len: 50 },
];

// ---- the path: filleted corners, sampled every few meters ----

interface Sample {
  x: number;
  z: number;
  n: Node;
  /** Width and bank before smoothing: a corner's own on its arc, the plain road's elsewhere. */
  w: number;
  bank: number;
  /** On a corner's middle sample: the road is at the node's height there. */
  anchor?: number;
}

function path(ns: Node[]): Sample[] {
  const N = ns.length;
  const corner = ns.map((c, i) => {
    const p = ns[(i - 1 + N) % N];
    const q = ns[(i + 1) % N];
    const inLen = Math.hypot(c.x - p.x, c.z - p.z);
    const outLen = Math.hypot(q.x - c.x, q.z - c.z);
    const di = [(c.x - p.x) / inLen, (c.z - p.z) / inLen];
    const dO = [(q.x - c.x) / outLen, (q.z - c.z) / outLen];
    const cr = di[0] * dO[1] - di[1] * dO[0];
    const theta = Math.acos(Math.max(-1, Math.min(1, di[0] * dO[0] + di[1] * dO[1])));
    const t = c.r && theta > 0.02 ? Math.min(c.r * Math.tan(theta / 2), inLen * 0.48, outLen * 0.48) : 0;
    return { di, dO, cr, theta, t, t1: [c.x - di[0] * t, c.z - di[1] * t], t2: [c.x + dO[0] * t, c.z + dO[1] * t] };
  });
  const out: Sample[] = [];
  for (let i = 0; i < N; i++) {
    const c = ns[i];
    const k = corner[i];
    if (!k.t) out.push({ x: c.x, z: c.z, n: c, anchor: c.y, w: c.w, bank: c.bank ?? 0 });
    else {
      // The arc, centered off the incoming tangent toward the turn.
      const r = k.t / Math.tan(k.theta / 2);
      const sgn = k.cr > 0 ? 1 : -1;
      const cx = k.t1[0] - k.di[1] * r * sgn;
      const cz = k.t1[1] + k.di[0] * r * sgn;
      const a0 = Math.atan2(k.t1[1] - cz, k.t1[0] - cx);
      const steps = Math.max(2, Math.ceil((r * k.theta) / 7));
      // The lap's right is (-z, x) of its heading, so a positive cross product is a right turn,
      // and a positive bank lowers the right: into the turn.
      const drift = r >= 35 && r <= 110 && k.theta > 0.35;
      const w = c.w + (drift ? DRIFT_WIDTH : 0);
      const bank = c.bank ?? (k.theta > 0.2 ? sgn * bankFor(r) : 0);
      for (let j = 0; j <= steps; j++) {
        const a = a0 + sgn * k.theta * (j / steps);
        out.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, n: c, anchor: j === Math.floor(steps / 2) ? c.y : undefined, w, bank });
      }
    }
    // The straight on to the next corner.
    const q = ns[(i + 1) % N];
    const f = k.t2;
    const g = corner[(i + 1) % N].t1;
    const steps = Math.floor(Math.hypot(g[0] - f[0], g[1] - f[1]) / 22);
    for (let j = 1; j < steps; j++) {
      const u = j / steps;
      const n = u < 0.5 ? c : q;
      out.push({ x: f[0] + (g[0] - f[0]) * u, z: f[1] + (g[1] - f[1]) * u, n, w: n.w, bank: 0 });
    }
  }
  return out;
}

const samples = path(nodes);
const S = samples.length;
const dist: number[] = [0];
for (let k = 1; k <= S; k++) dist.push(dist[k - 1] + Math.hypot(samples[k % S].x - samples[k - 1].x, samples[k % S].z - samples[k - 1].z));
const L0 = dist[S];
const gap = (a: number, b: number) => Math.abs(((dist[a] - dist[b] + L0 * 1.5) % L0) - L0 / 2);
// Height: linear in distance between the corners' anchors, smoothed (~30 m), plus the crests.
const anchors = samples.flatMap((s, k) => (s.anchor === undefined ? [] : [{ k, y: s.anchor }]));
const raw = samples.map((_, k) => {
  let j = anchors.findIndex((a) => a.k > k);
  if (j < 0) j = 0;
  const b = anchors[j];
  const a = anchors[(j - 1 + anchors.length) % anchors.length];
  const da = (dist[k] - dist[a.k] + L0) % L0;
  const ab = (dist[b.k] - dist[a.k] + L0) % L0 || 1;
  return a.y + (b.y - a.y) * (da / ab);
});
/** `v` (one value per sample) at distance d along the lap, linear between samples. */
const valueAt = (v: number[], d: number) => {
  d = ((d % L0) + L0) % L0;
  let lo = 0;
  let hi = S;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (dist[mid] <= d) lo = mid;
    else hi = mid;
  }
  const f = (d - dist[lo]) / (dist[lo + 1] - dist[lo] || 1);
  return v[lo] + (v[(lo + 1) % S] - v[lo]) * f;
};
/** A value along the lap, smoothed with a Gaussian of `sigma` meters (by distance, however sparse the samples). */
const smoothed = (v: number[], sigma: number) =>
  v.map((_, k) => {
    let sum = 0;
    let wsum = 0;
    for (let u = -3 * sigma; u <= 3 * sigma; u += 1) {
      const w = Math.exp(-(u * u) / (2 * sigma * sigma));
      sum += valueAt(v, dist[k] + u) * w;
      wsum += w;
    }
    return sum / wsum;
  });
// Crests sit on the road nearest their (x, z), measured along it.
const crestAt = crests.map((c) => {
  let best = 0;
  for (let k = 1; k < S; k++) if (Math.hypot(samples[k].x - c.x, samples[k].z - c.z) < Math.hypot(samples[best].x - c.x, samples[best].z - c.z)) best = k;
  return { ...c, k: best };
});
const heights = smoothed(raw, 14).map((y, k) => {
  for (const c of crestAt) {
    const d = gap(k, c.k);
    if (d < c.len / 2) y += c.h * 0.5 * (1 + Math.cos((Math.PI * d) / (c.len / 2)));
  }
  return y;
});
// Widths ease in and out of the corners; banks roll over an S instead of flipping.
const widths = smoothed(
  samples.map((s) => s.w),
  10,
);
const banks = smoothed(
  samples.map((s) => s.bank),
  12,
);

const r1 = (n: number) => Math.round(n * 10) / 10;
const pts: TrackPoint[] = samples.map((s, k) => ({
  p: [r1(s.x), r1(heights[k]), r1(s.z)] as Vec3,
  width: Math.round(widths[k] * 10) / 10,
  lanes: 2,
  shoulder: s.n.shoulder,
  ...(s.n.surface !== 'asphalt' ? { surface: s.n.surface } : {}),
  ...(Math.abs(banks[k]) > 0.002 ? { bank: Math.round(banks[k] * 1000) / 1000 } : {}),
}));

const layout: TrackLayout = {
  id: 'countryside-valley',
  name: 'Valley',
  main: { points: pts },
  branches: [],
  zones: [],
  walls: { gaps: [] },
  ramps: [],
  checkpoints: 'auto',
  props: [],
  takedownSpots: [],
  scenery: 'countryside',
  shoulderSurface: 'grass',
};

const baked = bakeTrack(layout, surfaces);
const L = baked.main.length;
const hit = newHit();
const sAt = (x: number, z: number, y?: number) => (projectGlobal(baked.main, x, z, hit, y), Math.round(hit.s));
const yAt = (x: number, z: number, y?: number) => (projectGlobal(baked.main, x, z, hit, y), hit.cy);
/**
 * A shortcut's first (or last) point: `along` m on from where it leaves the main road at `s` (or
 * back from where it rejoins), and `lat` m out to the side (right positive). Close in and shallow,
 * so it forks off gently.
 */
const fork = (s: number, along: number, lat: number, dy: number, width: number): TrackPoint => {
  sampleAt(baked.main, s + along, hit);
  return { p: [r1(hit.cx - hit.tz * lat), r1(hit.cy + dy), r1(hit.cz + hit.tx * lat)], width, lanes: 1, shoulder: 1.5, surface: 'dirt' };
};

// ---- shortcuts ----

// The Barn: straight on up the river road instead of the village S, through the barn.
const barn: BranchDef = {
  id: 'barn',
  kind: 'shortcut',
  from: sAt(0, 40),
  to: sAt(0, 275),
  points: [
    { p: [0, 0.8, 100], width: 8, lanes: 1, shoulder: 1.5, surface: 'dirt' },
    { p: [2, 1.2, 155], width: 7, lanes: 1, shoulder: 1, surface: 'dirt' },
    { p: [0, 1, 210], width: 8, lanes: 1, shoulder: 1.5, surface: 'dirt' },
  ],
};
// Logger's Leap: off the ridge's edge before the corner, a kicker, and down onto the Descent.
const leap: BranchDef = {
  id: 'leap',
  kind: 'shortcut',
  from: sAt(424, -70, 52),
  to: sAt(355, -157, 45),
  points: [
    fork(sAt(424, -70, 52), 30, -9, -0.3, 10),
    { p: [400, r1(yAt(424, -100, 52) - 1), -126], width: 10, lanes: 1, shoulder: 1.5, surface: 'dirt' },
    { p: [380, r1(yAt(360, -158, 45) + 1.5), -145], width: 11, lanes: 1, shoulder: 2, surface: 'dirt' },
  ],
};
// The Creek Bed: off the Hollow's westbound leg, straight down across the stream inside the
// last two hairpins, onto the run east.
const creek: BranchDef = {
  id: 'creek',
  kind: 'shortcut',
  from: sAt(-138, -352, 14),
  to: sAt(-118, -471, 2),
  points: [
    fork(sAt(-138, -352, 14), 28, 10, -0.8, 10),
    { p: [-166, r1(yAt(-168, -370, 11) - 5), -420], width: 11, lanes: 1, shoulder: 2, surface: 'dirt' },
    { p: [-150, r1(yAt(-118, -471, 2) + 1.2), -458], width: 10, lanes: 1, shoulder: 2, surface: 'dirt' },
  ],
};
layout.branches = [barn, leap, creek];
const withBranches = bakeTrack(layout, surfaces);
const leapSp = withBranches.splines[2];
const creekSp = withBranches.splines[3];

// ---- jumps: kickers on the ridge and at the leap ----
// Each kicker ends on its crest's top, so the road falls away under you (heading south, s grows
// as z falls).
layout.ramps = [
  { s: sAt(crests[0].x, crests[0].z, 52) - 12, height: 1.6, length: 12 },
  { s: sAt(crests[1].x, crests[1].z, 54) - 10, height: 1.4, length: 10 },
  { spline: 'leap', s: Math.round(leapSp.length * 0.35), height: 2.2, length: 12 },
];

// ---- walls: the village, the bridges and the switchbacks' drops; open country elsewhere ----
const span = (a: number, b: number): [number, number] => [Math.min(a, b), Math.max(a, b)];
const walled: [number, number][] = [
  span(sAt(-10, 60), sAt(-10, 250)), // the village square
  span(sAt(35, 338), sAt(95, 322)), // the covered bridge
  span(sAt(255, 320, 7), sAt(355, 200, 36)), // the switchbacks
  span(sAt(-60, -284, 20), sAt(150, -262, 27)), // the trestle
].sort((a, b) => a[0] - b[0]);
const gaps: { s: [number, number]; side: 'both' }[] = [];
let cursor = 0;
for (const [a, b] of walled) {
  if (a > cursor) gaps.push({ s: [cursor, a], side: 'both' });
  cursor = Math.max(cursor, b);
}
if (cursor < L) gaps.push({ s: [cursor, L], side: 'both' });
layout.walls = { gaps };

// ---- traffic on the asphalt, hazards, water ----
const sections: [number, number][] = [
  [sAt(0, -300), sAt(0, 50)],
  [sAt(215, -236, 30), sAt(-110, -285, 19)],
];
layout.traffic = { density: 5, lanes: [{ pos: 0.5, dir: 1, speed: 16, sections }, { pos: -0.5, dir: -1, speed: 14, sections }] };
layout.hazards = [
  { use: 'log-truck', s: [sAt(0, -300), sAt(0, 40)], params: { every: 60 } },
  { use: 'falling-sign', s: sAt(0, -255) },
];
layout.takedownSpots = [
  { s: sAt(20, -283, 24), name: 'The Trestle' },
  { s: sAt(60, 330), name: 'The Covered Bridge' },
];
const puddle = (x: number, z: number, y: number, len: number, l0: number, l1: number) => {
  const s0 = sAt(x, z, y);
  return { s: [s0, s0 + len] as [number, number], lateral: [l0, l1] as [number, number], surface: 'puddle', when: 'wet' as const };
};
layout.zones = [
  // The ford in the Creek Bed is always wet.
  { spline: 'creek', s: [Math.round(creekSp.length * 0.42), Math.round(creekSp.length * 0.62)], lateral: [-5, 5], surface: 'puddle' },
  // Rain puddles: a Hollow hairpin, the village, a switchback.
  puddle(-200, -400, 8, 26, -5, 3),
  puddle(-38, 135, 1.5, 22, -2, 6),
  puddle(305, 200, 17, 22, -4, 4),
];
layout.terrain = {
  river: [
    [48, -760],
    [44, -520],
    [34, -280],
    [46, 40],
    [60, 320],
    [70, 560],
    [60, 820],
  ],
  riverWidth: 22,
  riverY: -5,
};

straightenSections(layout, surfaces);
writeFileSync(new URL('../content/maps/countryside/valley.track.json', import.meta.url), JSON.stringify(layout, null, 1) + '\n');
const final = bakeTrack(layout, surfaces);
console.log(
  `main ${final.main.length.toFixed(0)} m, ${pts.length} points; ` +
    final.splines
      .slice(1)
      .map((sp) => `${sp.id} ${sp.length.toFixed(0)} m`)
      .join(', '),
);
