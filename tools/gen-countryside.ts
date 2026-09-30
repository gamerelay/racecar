// Generator for Countryside's Valley layout (v2, after City v2: tighter, more up and down, and
// mostly dirt). A lap through pine forest either side of a river, in order:
//
//   the Village         start/finish on the asphalt river road, traffic, then an S through the
//                       village square (the Barn shortcut goes straight through the barn instead)
//   the Covered Bridge  right over the river
//   the Switchbacks     dirt, up the ridge's flank: four hairpins, 45 m of climb
//   the Ridge           dirt along the top: crests and two kickers; Logger's Leap jumps off the
//                       edge to cut the corner onto the Descent
//   the Descent         asphalt S-bends down the mountain, then the Trestle, a timber bridge high
//                       over the gorge (and over the river road you started on)
//   Pine Hollow         dirt hairpins down to the flats (the Creek Bed cuts across the stream),
//                       then north along the river, under the Trestle, to the line
//
// After this the layout is edited in the editor; rerunning overwrites it.
//
//   bun tools/gen-countryside.ts

import { writeFileSync } from 'node:fs';
import type { BranchDef, TrackLayout, TrackPoint, Vec3 } from '../src/core/content';
import { bakeTrack } from '../src/core/track/bake';
import { newHit, projectGlobal } from '../src/core/track/query';
import { straightenSections } from '../src/core/track/validate';
import surfaces from '../content/surfaces.json';

/** A corner of the lap: r is its radius (none: a plain point). */
type Node = { x: number; z: number; y: number; w: number; r?: number; surface: 'asphalt' | 'dirt'; shoulder: number; bank?: number };

const A = (x: number, z: number, y: number, r?: number, more: Partial<Node> = {}): Node => ({ x, z, y, w: 13, r, surface: 'asphalt', shoulder: 3, ...more });
const D = (x: number, z: number, y: number, r?: number, more: Partial<Node> = {}): Node => ({ x, z, y, w: 11, r, surface: 'dirt', shoulder: 2.5, ...more });

const nodes: Node[] = [
  // The river road north from the line, and the village S (left, then right).
  A(0, -40, 0),
  A(0, 70, 0.5, 24),
  A(-38, 120, 1.5, 22),
  A(-38, 190, 1.5, 22),
  A(0, 240, 1, 24),
  // Right over the covered bridge, and on up the valley side.
  A(0, 320, 1.5, 30),
  // The Switchbacks: legs south and north, each a step east and up the ridge.
  D(240, 330, 6, 20),
  D(240, 180, 14, 17),
  D(282, 180, 17, 17),
  D(282, 330, 26, 17),
  D(324, 330, 29, 17),
  D(324, 170, 38, 17),
  // Onto the ridge, and south along its top.
  D(410, 150, 48, 38, { bank: 0.05 }),
  D(430, -150, 52, 45, { bank: 0.06 }),
  // The Descent: asphalt S-bends down to the Trestle.
  A(300, -170, 42, 40, { bank: -0.05 }),
  A(220, -280, 30, 40, { bank: 0.05 }),
  // The Trestle runs west from here, over the gorge and the river road.
  A(-120, -280, 18, 22),
  // Pine Hollow: dirt hairpins down to the flats.
  D(-120, -360, 13, 18),
  D(-190, -360, 10, 18),
  D(-190, -440, 5, 18),
  D(0, -460, 0, 28),
];

// Crests to fly off: a bump in the height (meters) centered near a point, over a length.
const crests = [
  { x: 420, z: 60, h: 3.2, len: 46 },
  { x: 424, z: -50, h: 2.6, len: 40 },
  { x: 0, z: -360, h: 1.6, len: 50 },
];

// ---- the path: filleted corners, sampled every few meters ----

interface Sample {
  x: number;
  z: number;
  n: Node;
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
    if (!k.t) out.push({ x: c.x, z: c.z, n: c, anchor: c.y });
    else {
      // The arc, centered off the incoming tangent toward the turn.
      const r = k.t / Math.tan(k.theta / 2);
      const sgn = k.cr > 0 ? 1 : -1;
      const cx = k.t1[0] - k.di[1] * r * sgn;
      const cz = k.t1[1] + k.di[0] * r * sgn;
      const a0 = Math.atan2(k.t1[1] - cz, k.t1[0] - cx);
      const steps = Math.max(2, Math.ceil((r * k.theta) / 7));
      for (let j = 0; j <= steps; j++) {
        const a = a0 + sgn * k.theta * (j / steps);
        out.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, n: c, anchor: j === Math.floor(steps / 2) ? c.y : undefined });
      }
    }
    // The straight on to the next corner.
    const q = ns[(i + 1) % N];
    const f = k.t2;
    const g = corner[(i + 1) % N].t1;
    const steps = Math.floor(Math.hypot(g[0] - f[0], g[1] - f[1]) / 22);
    for (let j = 1; j < steps; j++) {
      const u = j / steps;
      out.push({ x: f[0] + (g[0] - f[0]) * u, z: f[1] + (g[1] - f[1]) * u, n: u < 0.5 ? c : q });
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
const heights = samples.map((s, k) => {
  let sum = 0;
  let wsum = 0;
  for (let j = -8; j <= 8; j++) {
    const m = (k + j + S) % S;
    const w = Math.exp(-(gap(m, k) ** 2) / (2 * 14 * 14));
    sum += raw[m] * w;
    wsum += w;
  }
  let y = sum / wsum;
  for (const c of crests) {
    const d = Math.hypot(s.x - c.x, s.z - c.z);
    if (d < c.len / 2) y += c.h * 0.5 * (1 + Math.cos((Math.PI * d) / (c.len / 2)));
  }
  return y;
});

const r1 = (n: number) => Math.round(n * 10) / 10;
const pts: TrackPoint[] = samples.map((s, k) => ({
  p: [r1(s.x), r1(heights[k]), r1(s.z)] as Vec3,
  width: s.n.w,
  lanes: 2,
  shoulder: s.n.shoulder,
  ...(s.n.surface !== 'asphalt' ? { surface: s.n.surface } : {}),
  ...(s.n.bank ? { bank: s.n.bank } : {}),
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

// ---- shortcuts ----

// The Barn: straight on up the river road instead of the village S, through the barn.
const barn: BranchDef = {
  id: 'barn',
  kind: 'shortcut',
  from: sAt(0, 40),
  to: sAt(0, 270),
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
  from: sAt(428, -40, 52),
  to: sAt(350, -168, 45),
  points: [
    { p: [407, r1(yAt(428, -60, 52) - 0.3), -70], width: 9, lanes: 1, shoulder: 1.5, surface: 'dirt' },
    { p: [396, r1(yAt(428, -80, 52) - 1), -106], width: 9, lanes: 1, shoulder: 1.5, surface: 'dirt' },
    { p: [384, r1(yAt(360, -168, 45) + 1.5), -145], width: 10, lanes: 1, shoulder: 2, surface: 'dirt' },
  ],
};
// The Creek Bed: off the Hollow's westbound leg, straight down across the stream inside the
// last hairpin, onto the run home.
const creek: BranchDef = {
  id: 'creek',
  kind: 'shortcut',
  from: sAt(-150, -360, 11),
  to: sAt(-45, -458, 1),
  points: [
    { p: [-160, r1(yAt(-150, -360, 11) - 1.5), -388], width: 9, lanes: 1, shoulder: 2, surface: 'dirt' },
    { p: [-140, r1(yAt(-150, -360, 11) - 5), -418], width: 10, lanes: 1, shoulder: 2, surface: 'dirt' },
    { p: [-102, r1(yAt(-45, -458, 1) + 1.2), -447], width: 9, lanes: 1, shoulder: 2, surface: 'dirt' },
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
  { s: sAt(420, 60, 52) - 12, height: 1.6, length: 12 },
  { s: sAt(424, -50, 54) - 10, height: 1.4, length: 10 },
  { spline: 'leap', s: Math.round(leapSp.length * 0.35), height: 2.2, length: 12 },
];

// ---- walls: the village, the bridges and the switchbacks' drops; open country elsewhere ----
const span = (a: number, b: number): [number, number] => [Math.min(a, b), Math.max(a, b)];
const walled: [number, number][] = [
  span(sAt(-10, 60), sAt(-10, 250)), // the village square
  span(sAt(30, 320), sAt(100, 322)), // the covered bridge
  span(sAt(236, 320), sAt(324, 180, 37)), // the switchbacks
  span(sAt(-60, -280, 20) + 10, sAt(150, -280, 27) - 10), // the trestle
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
  [sAt(0, -440), sAt(0, 50)],
  [sAt(290, -190, 41), sAt(150, -280, 27)],
];
layout.traffic = { density: 5, lanes: [{ pos: 0.5, dir: 1, speed: 16, sections }, { pos: -0.5, dir: -1, speed: 14, sections }] };
layout.hazards = [
  { use: 'log-truck', s: [sAt(0, -420), sAt(0, 40)], params: { every: 60 } },
  { use: 'falling-sign', s: sAt(-38, 160) },
];
layout.takedownSpots = [
  { s: sAt(20, -280, 24), name: 'The Trestle' },
  { s: sAt(60, 320), name: 'The Covered Bridge' },
];
const puddle = (x: number, z: number, y: number, len: number, l0: number, l1: number) => {
  const s0 = sAt(x, z, y);
  return { s: [s0, s0 + len] as [number, number], lateral: [l0, l1] as [number, number], surface: 'puddle', when: 'wet' as const };
};
layout.zones = [
  // The ford in the Creek Bed is always wet.
  { spline: 'creek', s: [Math.round(creekSp.length * 0.42), Math.round(creekSp.length * 0.62)], lateral: [-5, 5], surface: 'puddle' },
  // Rain puddles: a Hollow hairpin, the village, a switchback.
  puddle(-190, -380, 9, 26, -5, 3),
  puddle(-30, 120, 1.5, 22, -2, 6),
  puddle(282, 200, 17, 22, -4, 4),
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
