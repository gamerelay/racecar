// Blocks in the first Countryside layout (SPEC §8): a winding two-lane road through a valley,
// hills with crests, a village with walls, a bridge, grass shoulders and no walls elsewhere (more
// ways to fly off the road), a dirt cut through a barn across the hairpin, log trucks, and a
// falling sign in the village. Edited in the editor afterwards; rerunning overwrites it.
//
//   bun tools/gen-countryside.ts

import { writeFileSync } from 'node:fs';
import type { BranchDef, TrackLayout, TrackPoint, Vec3 } from '../src/core/content';
import { bakeTrack } from '../src/core/track/bake';
import { newHit, projectGlobal } from '../src/core/track/query';
import surfaces from '../content/surfaces.json';

type V = { x: number; z: number; y: number; w: number; r?: number; bank?: number };

const corners: V[] = [
  { x: 0, z: 0, y: 0, w: 13, r: 0 },
  { x: 0, z: 520, y: 2, w: 13, r: 90 },
  { x: -160, z: 800, y: 10, w: 12, r: 80, bank: -0.06 },
  { x: -60, z: 1060, y: 16, w: 12, r: 70 },
  { x: 200, z: 1160, y: 11, w: 12, r: 70 },
  { x: 460, z: 1090, y: 5, w: 12, r: 60 },
  { x: 520, z: 880, y: 1, w: 12, r: 45 },
  { x: 390, z: 770, y: 0, w: 12, r: 24 },
  { x: 560, z: 640, y: 5, w: 12, r: 60 },
  { x: 700, z: 410, y: 13, w: 12, r: 0 },
  { x: 750, z: 150, y: 5, w: 12, r: 80 },
  { x: 610, z: -110, y: 0, w: 12, r: 70, bank: 0.06 },
  { x: 350, z: -210, y: 2, w: 13, r: 90 },
  { x: 110, z: -200, y: 0, w: 13, r: 60 },
  { x: 0, z: -150, y: 0, w: 13, r: 50 },
];

const pts: TrackPoint[] = [];
const r1 = (n: number) => Math.round(n * 10) / 10;
const push = (x: number, y: number, z: number, v: V) => pts.push({ p: [r1(x), r1(y), r1(z)] as Vec3, width: v.w, lanes: 2, shoulder: 6, ...(v.bank ? { bank: v.bank } : {}) });

for (let i = 0; i < corners.length; i++) {
  const c = corners[i];
  const prev = corners[(i - 1 + corners.length) % corners.length];
  const next = corners[(i + 1) % corners.length];
  if (!c.r) push(c.x, c.y, c.z, c);
  else {
    const inLen = Math.hypot(c.x - prev.x, c.z - prev.z);
    const outLen = Math.hypot(next.x - c.x, next.z - c.z);
    const ix = (prev.x - c.x) / inLen;
    const iz = (prev.z - c.z) / inLen;
    const ox = (next.x - c.x) / outLen;
    const oz = (next.z - c.z) / outLen;
    const r = Math.min(c.r, inLen * 0.4, outLen * 0.4);
    push(c.x + ix * r, c.y, c.z + iz * r, c);
    push(c.x + (ix + ox) * r * 0.29, c.y, c.z + (iz + oz) * r * 0.29, c);
    push(c.x + ox * r, c.y, c.z + oz * r, c);
  }
  const len = Math.hypot(next.x - c.x, next.z - c.z);
  const inner = Math.floor((len - (c.r ?? 0) - (next.r ?? 0)) / 120);
  for (let k = 1; k <= inner; k++) {
    const t = k / (inner + 1);
    // Rolling hills: a little extra rise and fall along the long runs.
    const roll = Math.sin(t * Math.PI) * (len > 300 ? 3 : 0);
    push(c.x + (next.x - c.x) * t, c.y + (next.y - c.y) * t + roll, c.z + (next.z - c.z) * t, c);
  }
}

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
const sAt = (x: number, z: number) => (projectGlobal(baked.main, x, z, hit), Math.round(hit.s));

// The barn cut: dirt, straight down across the hairpin.
const barn: BranchDef = {
  id: 'barn',
  kind: 'shortcut',
  from: sAt(517, 930),
  to: sAt(545, 652),
  points: [
    { p: [522, 1, 860], width: 8, lanes: 1, shoulder: 3, surface: 'dirt' },
    { p: [522, 1, 800], width: 7, lanes: 1, shoulder: 2, surface: 'dirt' },
    { p: [526, 2, 730], width: 8, lanes: 1, shoulder: 3, surface: 'dirt' },
  ],
};
layout.branches = [barn];

// Walls only through the village (the top of the loop) and on the bridge; open country elsewhere.
const village: [number, number] = [sAt(-60, 1060), sAt(460, 1090)];
const bridge: [number, number] = [sAt(750, 230), sAt(740, 80)];
layout.walls = {
  gaps: [
    { s: [0, village[0]], side: 'both' },
    { s: [village[1], bridge[0]], side: 'both' },
    { s: [bridge[1], L], side: 'both' },
  ],
};
// The bridge: a narrow deck over the creek.
for (const p of layout.main.points) {
  const s = sAt(p.p[0], p.p[2]);
  if (s > bridge[0] && s < bridge[1]) {
    p.width = 10;
    p.shoulder = 1;
  }
  if (s > village[0] && s < village[1]) p.shoulder = 3;
}
layout.ramps = [{ s: sAt(700, 440), height: 1.2, length: 14 }];
// Traffic on the long runs: the start straight and the climb, and the back straight.
// (Not over the crests: landing blind into traffic isn't fair.)
const sections: [number, number][] = [
  [sAt(0, -120), sAt(0, 480)],
  [sAt(610, -110), sAt(110, -200)],
];
layout.traffic = { density: 5, lanes: [{ pos: 0.5, dir: 1, speed: 17, sections }, { pos: -0.5, dir: -1, speed: 15, sections }] };
layout.hazards = [
  { use: 'log-truck', s: [sAt(0, 20), sAt(0, 500)] },
  { use: 'log-truck', s: [sAt(610, -110), sAt(110, -200)], params: { every: 55 } },
  { use: 'falling-sign', s: sAt(200, 1160) },
];
layout.takedownSpots = [{ s: Math.round((bridge[0] + bridge[1]) / 2), name: 'The bridge' }];
layout.zones = [{ s: [sAt(390, 770) - 20, sAt(390, 770) + 25], lateral: [-6, 6], surface: 'puddle', when: 'wet' }];

writeFileSync(new URL('../content/maps/countryside/valley.track.json', import.meta.url), JSON.stringify(layout, null, 1) + '\n');
writeFileSync(
  new URL('../content/maps/countryside/map.json', import.meta.url),
  JSON.stringify({ id: 'countryside', name: 'Countryside', layouts: ['valley'], palette: 'golden', weather: ['clear', 'rain'] }) + '\n',
);
const final = bakeTrack(layout, surfaces);
console.log(`main ${final.main.length.toFixed(0)} m, ${pts.length} points; barn ${final.splines[1].length.toFixed(0)} m (${barn.from}→${barn.to})`);
