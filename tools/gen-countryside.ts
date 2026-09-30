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
// The lap-laying (arcs, banks, smoothing, crests) is shared with the other maps, in tools/lib/lap.ts.
//
// After this the layout is edited in the editor; rerunning overwrites it.
//
//   bun tools/gen-countryside.ts

import { writeFileSync } from 'node:fs';
import type { BranchDef, TrackLayout } from '../src/core/content';
import { bakeTrack } from '../src/core/track/bake';
import { straightenSections } from '../src/core/track/validate';
import surfaces from '../content/surfaces.json';
import { type Node, lapPoints, onLap, r1, span, wallGaps } from './lib/lap';

const A = (x: number, z: number, y: number, r?: number, more: Partial<Node> = {}): Node => ({ x, z, y, w: 14.5, r, surface: 'asphalt', shoulder: 3, ...more });
const D = (x: number, z: number, y: number, r?: number, more: Partial<Node> = {}): Node => ({ x, z, y, w: 13, r, surface: 'dirt', shoulder: 2.5, ...more });

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

const pts = lapPoints(nodes, crests);

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
const { sAt, yAt, fork } = onLap(baked);

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
const walled: [number, number][] = [
  span(sAt(-10, 60), sAt(-10, 250)), // the village square
  span(sAt(35, 338), sAt(95, 322)), // the covered bridge
  span(sAt(255, 320, 7), sAt(355, 200, 36)), // the switchbacks
  span(sAt(-60, -284, 20), sAt(150, -262, 27)), // the trestle
];
layout.walls = { gaps: wallGaps(walled, L) };

// ---- traffic on the asphalt, hazards, water ----
// The home stretch's traffic starts past the Trestle's legs: appearing among them, in the lane the
// field threads them in, it was half of the Valley's wrecks.
const sections: [number, number][] = [
  [sAt(0, -180), sAt(0, 50)],
  [sAt(215, -236, 30), sAt(-110, -285, 19)],
];
layout.traffic = { density: 5, lanes: [{ pos: 0.5, dir: 1, speed: 16, sections }, { pos: -0.5, dir: -1, speed: 14, sections }] };
layout.hazards = [
  { use: 'log-truck', s: [sAt(0, -300), sAt(0, 40)], params: { every: 60 } },
];
// No falling sign: on the home straight at 200 km/h (or anywhere else on this lap) it wrecked the
// field 1–2 more times a race, and a city's sign never belonged in the country.
// Landmarks (PLAN phase 6): in the village, a giant fibreglass cow by the start (in front of the
// houses, which line the road: behind them it was hidden) and a water tower
// with the town's name; a scarecrow in a patch of corn off the home straight, and a windpump across
// the river from it; a drive-in on the flats below Pine Hollow, facing the road down onto them; and
// a hot-air balloon drifting over the Ridge.
layout.landmarks = [
  { kind: 'cow', at: [-25, 30], rot: Math.PI / 2, r: 10, params: { scale: 1.3 } },
  { kind: 'water-tower', at: [-90, 200], r: 8, label: 'MILLBROOK' },
  { kind: 'scarecrow', at: [-26, -125], rot: Math.PI / 2, r: 13 },
  { kind: 'windmill', at: [95, -150], rot: -Math.PI / 2, r: 12, params: { scale: 1.4 } },
  { kind: 'drive-in', at: [-30, -525], r: 54 },
  { kind: 'balloon', at: [380, 0], r: 0, params: { alt: 70, radius: 50 } },
];
// Smashables: hay bales through the village S, mailboxes along the home straight and the start.
layout.smashables = [
  { kind: 'hay-bale', s: [130, 280], every: 24 },
  { kind: 'mailbox', s: [2800, 2915], every: 28, side: 1 },
  { kind: 'mailbox', s: [15, 110], every: 28, side: -1 },
];
// The Trestle crosses the home stretch: drivers going under it thread its legs.
layout.trestles = true;
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
writeFileSync(new URL('../content/maps/backroads/valley.track.json', import.meta.url), JSON.stringify(layout, null, 1) + '\n');
const final = bakeTrack(layout, surfaces);
console.log(
  `main ${final.main.length.toFixed(0)} m, ${pts.length} points; ` +
    final.splines
      .slice(1)
      .map((sp) => `${sp.id} ${sp.length.toFixed(0)} m`)
      .join(', '),
);
