// Generator for City's Downtown layout (v2, after the first playtest: wider roads, a lap about a
// quarter shorter, and much more up and down). The lap, in order:
//
//   the Boulevard   start/finish, four lanes north, traffic, a colonnade of pillars under
//                   the Skyway (which crosses overhead)
//   the Climb       right onto the avenue and up a ramp onto the Skyway
//   the Skyway      12 m up: a long banked right-hand sweeper round the towers, then the
//                   straight west, straight over the Boulevard you started on
//   the Market      down off the Skyway into tight two-lane streets: a dog-leg, a hump bridge
//                   to fly off, and the Alley shortcut straight through the middle of it
//   the Underpass   down into a trench and a covered tunnel under the plaza, then up and out
//                   over a crest just before the line
//
// After this the layout is edited in the editor; rerunning overwrites it.
//
//   bun tools/gen-city.ts

import { writeFileSync } from 'node:fs';
import type { BranchDef, TrackLayout, TrackPoint, Vec3 } from '../src/core/content';
import { bakeTrack } from '../src/core/track/bake';
import { projectGlobal, newHit } from '../src/core/track/query';
import { straightenSections } from '../src/core/track/validate';
import surfaces from '../content/surfaces.json';

type V = { x: number; z: number; y: number; w: number; lanes: number; r?: number; bank?: number };

// The circuit as a polygon of street corners; r is the corner radius (none: a plain point), bank
// tilts the corner (positive drops the right edge, for right-handers).
const corners: V[] = [
  { x: 0, z: 0, y: 0, w: 26, lanes: 4 },
  { x: 0, z: 440, y: 0, w: 26, lanes: 4, r: 48 },
  { x: 240, z: 440, y: 0, w: 20, lanes: 3, r: 36 },
  { x: 240, z: 620, y: 5, w: 20, lanes: 3, r: 42 },
  { x: 560, z: 620, y: 12, w: 20, lanes: 2, r: 95, bank: 0.12 },
  { x: 560, z: 250, y: 12, w: 20, lanes: 2, r: 80, bank: 0.1 },
  { x: -220, z: 250, y: 12, w: 20, lanes: 2, r: 45, bank: -0.06 },
  { x: -220, z: 110, y: 2.5, w: 17, lanes: 2, r: 28 },
  { x: -120, z: 110, y: 0, w: 17, lanes: 2, r: 26 },
  { x: -120, z: -30, y: 0, w: 17, lanes: 2, r: 26 },
  // The Market crest: a hump bridge.
  { x: -200, z: -30, y: 5.5, w: 17, lanes: 2 },
  { x: -280, z: -30, y: 0, w: 17, lanes: 2, r: 32 },
  { x: -280, z: -190, y: -6, w: 20, lanes: 2, r: 42 },
  { x: 0, z: -190, y: -6, w: 26, lanes: 4, r: 48 },
  // Up out of the tunnel and over a crest just before the line.
  { x: 0, z: -75, y: 1.2, w: 26, lanes: 4 },
];

const pts: TrackPoint[] = [];
const r1 = (n: number) => Math.round(n * 10) / 10;
const push = (x: number, y: number, z: number, v: V, bank = 0) => pts.push({ p: [r1(x), r1(y), r1(z)] as Vec3, width: v.w, lanes: v.lanes, ...(bank ? { bank } : {}) });

for (let i = 0; i < corners.length; i++) {
  const c = corners[i];
  const prev = corners[(i - 1 + corners.length) % corners.length];
  const next = corners[(i + 1) % corners.length];
  if (!c.r) {
    push(c.x, c.y, c.z, c);
  } else {
    const inLen = Math.hypot(c.x - prev.x, c.z - prev.z);
    const outLen = Math.hypot(next.x - c.x, next.z - c.z);
    const ix = (prev.x - c.x) / inLen;
    const iz = (prev.z - c.z) / inLen;
    const ox = (next.x - c.x) / outLen;
    const oz = (next.z - c.z) / outLen;
    const bx = c.x + (ix + ox) * c.r * 0.29;
    const bz = c.z + (iz + oz) * c.r * 0.29;
    // Bank eases in and out: half at the corner's ends, full at its apex.
    push(c.x + ix * c.r, c.y, c.z + iz * c.r, c, (c.bank ?? 0) / 2);
    push(bx, c.y, bz, c, c.bank ?? 0);
    push(c.x + ox * c.r, c.y, c.z + oz * c.r, c, (c.bank ?? 0) / 2);
  }
  // Points along long edges carry the elevation between corners.
  const len = Math.hypot(next.x - c.x, next.z - c.z);
  const inner = Math.floor((len - (c.r ?? 0) - (next.r ?? 0)) / 120);
  for (let k = 1; k <= inner; k++) {
    const t = k / (inner + 1);
    push(c.x + (next.x - c.x) * t, c.y + (next.y - c.y) * t, c.z + (next.z - c.z) * t, t < 0.5 ? c : next);
  }
}

const layout: TrackLayout = {
  id: 'city-downtown',
  name: 'Downtown',
  main: { points: pts },
  branches: [],
  zones: [],
  walls: { gaps: [] },
  ramps: [],
  checkpoints: 'auto',
  traffic: { lanes: [], density: 0 },
  props: [],
  takedownSpots: [],
  scenery: 'city',
};

// Bake once to find main distances for the branch ends, ramps and gaps. Positions carry a height
// where the lap crosses itself, so the search finds the right level.
const baked = bakeTrack(layout, surfaces);
const hit = newHit();
const sAt = (x: number, z: number, y?: number) => (projectGlobal(baked.main, x, z, hit, y), Math.round(hit.s));

// The Alley: straight down the middle of the Market's dog-leg, narrow, with a kicker halfway.
const alley: BranchDef = {
  id: 'alley',
  kind: 'shortcut',
  from: sAt(-178, 110),
  to: sAt(-215, -30),
  points: [
    { p: [-162, 0, 102], width: 10, lanes: 1, shoulder: 1.5 },
    { p: [-154, 0, 82], width: 9, lanes: 1, shoulder: 1.5 },
    { p: [-152, 0, 45], width: 9, lanes: 1, shoulder: 1.5 },
    { p: [-155, 0, 10], width: 9, lanes: 1, shoulder: 1.5 },
    { p: [-168, 1.5, -16], width: 10, lanes: 1, shoulder: 1.5 },
  ],
};
layout.branches = [alley];
const alleySp = bakeTrack(layout, surfaces).splines[1];
layout.ramps = [{ spline: 'alley', s: Math.round(alleySp.length * 0.5), height: 1.2, length: 10 }];

// The colonnade: the Skyway's pillars stand in the Boulevard's median. Shove a rival into one.
const under = sAt(0, 250, 0);
layout.props = [-11, 0, 11].map((d) => ({ kind: 'pillar', s: under + d, lateral: 0, size: [2.2, 11, 2.2] as Vec3 }));
layout.takedownSpots = [{ s: under, name: 'The colonnade' }];

// Traffic: the Boulevard (out of the tunnel to the first corner), the Skyway straight (two-way,
// 12 m up), and the Underpass. None on the Climb, the sweeper or in the Market.
const sections: [number, number][] = [
  [sAt(0, -150, -4), sAt(0, 400, 0)],
  [sAt(480, 250, 12), sAt(-170, 250, 12)],
  [sAt(-230, -190, -6), sAt(-40, -190, -6)],
];
layout.traffic = {
  density: 8,
  lanes: [
    { pos: 0.5, dir: 1, speed: 19, sections },
    { pos: -0.5, dir: -1, speed: 17, sections },
  ],
};
layout.hazards = [
  { use: 'falling-sign', s: sAt(0, 380, 0) },
  { use: 'log-truck', s: [sAt(470, 250, 12), sAt(-150, 250, 12)] },
  { use: 'log-truck', s: [sAt(0, -120, -3), sAt(0, 380, 0)], params: { every: 70 } },
];
// Puddles, when it rains: the Market corners, the Boulevard's first corner, the tunnel mouth.
const puddle = (x: number, z: number, y: number, len: number, l0: number, l1: number) => {
  const s0 = sAt(x, z, y);
  return { s: [s0, s0 + len] as [number, number], lateral: [l0, l1] as [number, number], surface: 'puddle', when: 'wet' as const };
};
layout.zones = [puddle(-120, 90, 0, 25, -6, 2), puddle(-150, -30, 1, 25, -2, 6), puddle(0, 400, 0, 30, 2, 11), puddle(-280, -120, -3, 30, -7, 1)];

// Traffic must appear and leave on straights, where drivers see it.
straightenSections(layout, surfaces);
writeFileSync(new URL('../content/maps/city/downtown.track.json', import.meta.url), JSON.stringify(layout, null, 1) + '\n');
const final = bakeTrack(layout, surfaces);
console.log(`main ${final.main.length.toFixed(0)} m, ${pts.length} points; alley ${final.splines[1].length.toFixed(0)} m (${alley.from}→${alley.to})`);
