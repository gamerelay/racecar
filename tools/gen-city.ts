// One-off generator for the first City layout: a street-grid circuit with rounded corners, a
// hairpin, a hill with a crest, S-bends, a ramp, and an alley shortcut across the hairpin. After
// this the layout is edited in the editor; rerunning overwrites it.
//
//   bun tools/gen-city.ts

import { writeFileSync } from 'node:fs';
import type { BranchDef, TrackLayout, TrackPoint, Vec3 } from '../src/core/content';
import { bakeTrack } from '../src/core/track/bake';
import { projectGlobal, newHit } from '../src/core/track/query';
import surfaces from '../content/surfaces.json';

type V = { x: number; z: number; y: number; w: number; lanes: number; r?: number };

// The circuit as a polygon of street corners; r is the corner radius.
const corners: V[] = [
  { x: 0, z: 0, y: 0, w: 22, lanes: 4, r: 0 },
  { x: 0, z: 650, y: 0, w: 22, lanes: 4, r: 38 },
  { x: 250, z: 650, y: 0, w: 16, lanes: 3, r: 30 },
  { x: 250, z: 930, y: 2, w: 14, lanes: 2, r: 26 },
  { x: 410, z: 930, y: 2, w: 14, lanes: 2, r: 26 },
  { x: 410, z: 720, y: 6, w: 16, lanes: 2, r: 0 },
  { x: 410, z: 500, y: 0, w: 16, lanes: 2, r: 45 },
  { x: 700, z: 500, y: 0, w: 18, lanes: 3, r: 40 },
  { x: 820, z: 360, y: -2, w: 16, lanes: 2, r: 50 },
  { x: 760, z: 210, y: -4, w: 16, lanes: 2, r: 50 },
  { x: 880, z: 60, y: -4, w: 18, lanes: 3, r: 50 },
  { x: 880, z: -300, y: -2, w: 18, lanes: 3, r: 40 },
  { x: 500, z: -300, y: 0, w: 16, lanes: 2, r: 30 },
  { x: 500, z: -150, y: 0, w: 14, lanes: 2, r: 26 },
  { x: 200, z: -150, y: 0, w: 14, lanes: 2, r: 26 },
  { x: 200, z: -320, y: 0, w: 16, lanes: 2, r: 34 },
  { x: 0, z: -320, y: 0, w: 22, lanes: 4, r: 38 },
];

const pts: TrackPoint[] = [];
const push = (x: number, y: number, z: number, v: V) => pts.push({ p: [r1(x), r1(y), r1(z)] as Vec3, width: v.w, lanes: v.lanes });
const r1 = (n: number) => Math.round(n * 10) / 10;

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
    push(c.x + ix * c.r, c.y, c.z + iz * c.r, c);
    push(bx, c.y, bz, c);
    push(c.x + ox * c.r, c.y, c.z + oz * c.r, c);
  }
  // Points along long edges carry the elevation between corners.
  const len = Math.hypot(next.x - c.x, next.z - c.z);
  const inner = Math.floor((len - (c.r ?? 0) - (next.r ?? 0)) / 140);
  for (let k = 1; k <= inner; k++) {
    const t = k / (inner + 1);
    push(c.x + (next.x - c.x) * t, c.y + (next.y - c.y) * t, c.z + (next.z - c.z) * t, t < 0.5 ? c : next);
  }
}

// The hill: a crest on the run south from the hairpin (y peaks mid-way; at speed you fly).
for (const p of pts) {
  if (Math.abs(p.p[0] - 410) < 1 && p.p[2] < 900 && p.p[2] > 520) p.p[1] = r1(2 + 9 * Math.sin(((900 - p.p[2]) / 380) * Math.PI));
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

// Bake once to find main distances for the branch ends, ramps and gaps.
const baked = bakeTrack(layout, surfaces);
const hit = newHit();
const sAt = (x: number, z: number) => (projectGlobal(baked.main, x, z, hit), Math.round(hit.s));

const alley: BranchDef = {
  id: 'alley',
  kind: 'shortcut',
  from: sAt(250, 770),
  to: sAt(410, 770),
  points: [
    { p: [262, 2, 800], width: 9, lanes: 1, shoulder: 1.5 },
    { p: [285, 2, 812], width: 8, lanes: 1, shoulder: 1.5 },
    { p: [330, 2, 814], width: 8, lanes: 1, shoulder: 1.5 },
    { p: [375, 2, 812], width: 8, lanes: 1, shoulder: 1.5 },
    { p: [398, 2, 800], width: 9, lanes: 1, shoulder: 1.5 },
  ],
};
layout.branches = [alley];
layout.ramps = [{ s: sAt(880, -120), height: 1.6, length: 16 }];
layout.takedownSpots = [{ s: sAt(0, 400), name: 'Boulevard' }];

writeFileSync(new URL('../content/maps/city/downtown.track.json', import.meta.url), JSON.stringify(layout, null, 1) + '\n');
const final = bakeTrack(layout, surfaces);
console.log(`main ${final.main.length.toFixed(0)} m, ${pts.length} points; alley ${final.splines[1].length.toFixed(0)} m from ${alley.from} to ${alley.to}`);
