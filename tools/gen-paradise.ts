// Generator for Paradise's Island layout (PLAN phase 5). A clockwise lap of a tropical island,
// with the volcano in the middle and the sea all round, in order:
//
//   Harbor Town        the start on the harbour front, two-way traffic, then a flowing S out of town
//   Coconut Coast      a wide beach road up the west shore: long banked sweepers round a headland
//                      (the Sandbar shortcut runs straight on along the waterline, on loose sand)
//   the Freeway        a ramp up to a deck 10–14 m over the bay, one long banked sweep round the
//                      north shore with traffic, the whole island in view
//   Jungle Switchbacks down off the deck into the jungle: wide hairpins on red earth
//   Volcano Rim        the climb round the cone's flank on black lava rock, over crests (the Lava
//                      Tube shortcut cuts through the shoulder), and a jump off the rim
//   Lighthouse Point   the descent past the lighthouse onto the cliff road, and a flowing S home
//
// The lap-laying (arcs, banks, smoothing, crests) is shared with the other maps, in tools/lib/lap.ts.
// The land comes from `terrain`: the coastline, the sea's level and the volcano.
//
// After this the layout is edited in the editor; rerunning overwrites it.
//
//   bun tools/gen-paradise.ts

import { writeFileSync } from 'node:fs';
import type { BranchDef, TrackLayout } from '../src/core/content';
import { bakeTrack } from '../src/core/track/bake';
import { straightenSections } from '../src/core/track/validate';
import surfaces from '../content/surfaces.json';
import { type Crest, type Node, lapPoints, onLap, r1, span, wallGaps } from './lib/lap';

const node = (w: number, surface: string, shoulder: number) => (x: number, z: number, y: number, r?: number, more: Partial<Node> = {}): Node => ({ x, z, y, w, r, surface, shoulder, ...more });
/** Harbor Town and Lighthouse Point: asphalt, with a wide verge to run out onto. */
const T = node(15, 'asphalt', 4);
/** Coconut Coast: the wide beach road, with the beach right beside it. */
const C = node(18.5, 'asphalt', 5);
/** The Freeway: a deck, with a verge inside its barriers wide enough to drift out onto. */
const F = node(18, 'asphalt', 3);
/** Jungle Switchbacks: red earth, wide for the hairpins. */
const J = node(17, 'red-earth', 4);
/** Volcano Rim: lava rock. */
const V = node(15, 'lava-rock', 3.5);

/** The volcano: its middle, the crater's radius, and the lip's height. */
const VOLCANO = { x: 150, z: 60, crater: 55, h: 95, r: 330 };
/** A point on a circle round the volcano's middle (degrees clockwise from east, as seen from above). */
const rim = (deg: number, radius: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [r1(VOLCANO.x + Math.cos(a) * radius), r1(VOLCANO.z + Math.sin(a) * radius)];
};

const nodes: Node[] = [
  // Harbor Town: the line on the harbour front heading west, then a deep S out of town.
  T(160, 430, 2),
  T(-30, 430, 2, 80),
  T(-150, 372, 2.5, 60),
  T(-275, 434, 2.5, 55),
  // Coconut Coast: north up the west shore, then an S over the headland and back to the water.
  C(-425, 300, 3, 90),
  C(-405, 185, 3.5, 70),
  C(-290, 92, 5, 60),
  C(-335, -8, 5, 60),
  C(-430, -95, 4, 80),
  // The Freeway: up the ramp and round the bay on the deck.
  F(-440, -235, 9, 130),
  F(-260, -410, 12.5, 150),
  F(0, -440, 13, 170),
  F(215, -385, 11, 120),
  // Jungle Switchbacks: off the deck and down the slope in two open hairpins (each two corners,
  // so its radius holds: one node turning 150° gets filleted into a much tighter arc).
  J(425, -372, 8, 50),
  J(452, -278, 9, 50),
  J(290, -232, 10, 70, { bank: 0 }),
  J(128, -246, 11, 50),
  J(134, -150, 12, 50),
  // Volcano Rim: round the cone's flank, clockwise, climbing, swinging in and out.
  V(...rim(-72, 215), 17, 70),
  V(...rim(-45, 194), 24, 90),
  V(...rim(-12, 218), 32, 80),
  V(...rim(28, 204), 38, 80),
  V(...rim(62, 190), 40, 90),
  // Lighthouse Point: down off the rim (a jump), round the point in two corners, along the cliff, and the S into town.
  T(335, 330, 24, 70),
  T(440, 372, 15, 60),
  T(432, 455, 10, 60),
  T(330, 472, 6, 70),
  T(240, 432, 3, 80),
];

const crests: Crest[] = [
  // A rise on the coast road over the headland.
  { x: -350, z: 60, h: 1.8, len: 44 },
  // Over the rim's shoulder, and the jump off the rim onto the descent.
  { ...xz(rim(5, 182)), h: 2.4, len: 40 },
  { x: 305, z: 300, h: 3, len: 46 },
];
function xz([x, z]: [number, number]) {
  return { x, z };
}

// Sweepers 3 m wider than the road around them, for drifting (the other maps' 1.5 m felt narrow here).
const pts = lapPoints(nodes, crests, { driftWidth: 3 });

const layout: TrackLayout = {
  id: 'paradise-island',
  name: 'Island',
  main: { points: pts },
  branches: [],
  zones: [],
  walls: { gaps: [] },
  ramps: [],
  checkpoints: 'auto',
  props: [],
  takedownSpots: [],
  scenery: 'island',
  shoulderSurface: 'sand',
};

const baked = bakeTrack(layout, surfaces);
const L = baked.main.length;
const { sAt, yAt, fork } = onLap(baked);

// ---- shortcuts ----

// The Sandbar: straight on along the waterline instead of round the headland, on loose sand.
// It forks where the coast road still runs straight down the shore, before the road bends inland
// round the headland, and rejoins where the road comes back to the water: straight on along the
// waterline, so it's quick to take (a Sandbar that zigzagged out and back had the AIs taking it
// braking to 120 km/h in the fast line, and the field running into them).
const sandFrom = sAt(-414, 230);
const sandTo = sAt(-440, -120);
const sandbar: BranchDef = {
  id: 'sandbar',
  kind: 'shortcut',
  from: sandFrom,
  to: sandTo,
  points: [
    fork(sandFrom, 30, -3, -0.4, 11, 'sand'),
    ...([[-431, 100], [-434, 0]] as [number, number][]).map(([x, z]) => ({ p: [x, r1(yAt(-410, z) - 1.4), z] as [number, number, number], width: 11, lanes: 1, shoulder: 2, surface: 'sand' })),
    fork(sandTo, -30, -3, -0.4, 11, 'sand'),
  ],
};
// The Lava Tube: through the cone's shoulder, inside the rim road, a chord across two corners.
const [tx0, tz0] = rim(-50, 190);
const [tx1, tz1] = rim(40, 182);
const tubeFrom = sAt(tx0, tz0, 24);
const tubeTo = sAt(tx1, tz1, 38);
const [mx, mz] = rim(-5, 150);
const tube: BranchDef = {
  id: 'lava-tube',
  kind: 'shortcut',
  from: tubeFrom,
  to: tubeTo,
  points: [
    fork(tubeFrom, 26, 7, 0.2, 11, 'lava-rock'),
    { p: [mx, r1((yAt(tx0, tz0, 24) + yAt(tx1, tz1, 38)) / 2), mz], width: 10, lanes: 1, shoulder: 1, surface: 'lava-rock' },
    fork(tubeTo, -26, 7, 0.2, 11, 'lava-rock'),
  ],
};
layout.branches = [sandbar, tube];
const withBranches = bakeTrack(layout, surfaces);
const sandSp = withBranches.splines[1];

// ---- jumps: a dune on the Sandbar, and the kicker off the rim ----
layout.ramps = [
  { spline: 'sandbar', s: Math.round(sandSp.length * 0.45), height: 1.6, length: 11 },
  { s: sAt(305, 300, 30) - 12, height: 1.6, length: 12 },
];

// ---- walls: the harbour front, the freeway deck, the rim's drop; open beach and jungle elsewhere ----
// The harbour front and the rim have a wall on the drop's side only (the sea on the left, the
// rim's edge on the left: the cone is on the right); the inland side runs out onto the land.
const harbour = span(sAt(150, 430), sAt(-110, 400));
const rimSpan = span(sAt(...rim(-40, 186), 28), sAt(...rim(50, 186), 40));
const walled: [number, number][] = [harbour, span(sAt(-420, -200, 8), sAt(240, -370, 11)), rimSpan];
layout.walls = { gaps: [...wallGaps(walled, L), { s: harbour, side: 'right' }, { s: rimSpan, side: 'right' }] };

// ---- traffic: two-way in town; the freeway is one-way, both lanes running with the race ----
const town: [number, number][] = [[sAt(240, 432), sAt(-60, 430)]];
// (The freeway's bend at the middle of the bay is left clear: traffic in a fast corner at the
// apex was most of the field's wrecks.)
const freeway: [number, number][] = [
  [sAt(-230, -412, 12), sAt(-60, -433, 12)],
  [sAt(50, -428, 12), sAt(180, -394, 12)],
];
layout.traffic = {
  density: 5,
  lanes: [
    { pos: 0.5, dir: 1, speed: 16, sections: town },
    { pos: -0.5, dir: -1, speed: 14, sections: town },
    { pos: 0.5, dir: 1, speed: 20, sections: freeway },
    { pos: -0.5, dir: 1, speed: 24, sections: freeway },
  ],
};
// Placed by sweeping the field report (MAPS.md): bombs on the rim's last stretch before the
// jump, where the Lava Tube skips them (0.13 hazard wrecks a race here against 0.5–1.25 further
// up the rim), and coconuts on the beach road before the Sandbar, which hop you but never wreck.
layout.hazards = [
  { use: 'volcano-bombs', s: [sAt(...rim(0, 210), 35), sAt(...rim(33, 210), 35)], params: { every: 45 } },
  { use: 'coconuts', s: sAt(-372, 346) },
];
// Landmarks (PLAN phase 6; the lighthouse is the island's own scenery, and its beam shows through a
// shower): a wreck in the shallows off Coconut Coast and a whale breaching beyond it; a surf shack
// on the coast road's beach; a tiki head at the Lava Tube's mouth, facing the cars coming at it; and
// seaplanes on the lagoon under the Freeway, one flying circuits over the bay.
{
  const facing = (s: number) => {
    const a = onLap(withBranches).fork(s, 0, 0, 0, 1).p;
    const b = onLap(withBranches).fork(s, 5, 0, 0, 1).p;
    return Math.round(Math.atan2(a[0] - b[0], a[2] - b[2]) * 1000) / 1000;
  };
  const tiki = fork(tubeFrom, -4, 20, 0, 1).p;
  const shackS = sAt(-406, 298);
  const shack = fork(shackS, 0, -30, 0, 1).p;
  layout.landmarks = [
    { kind: 'shipwreck', at: [-490, 180], rot: 0.5, r: 14, params: { scale: 1.6 } },
    { kind: 'whale', at: [-600, 120], r: 0, params: { every: 80, scale: 1.5 } },
    { kind: 'surf-shack', at: [shack[0], shack[2]], rot: Math.round((facing(shackS) - Math.PI / 2) * 1000) / 1000, r: 8 },
    { kind: 'tiki-head', at: [tiki[0], tiki[2]], rot: facing(tubeFrom), r: 5, params: { scale: 1.3 } },
    { kind: 'seaplanes', at: [40, -392], r: 0, params: { radius: 160, alt: 55 } },
  ];
}
// Smashables: beach umbrellas on the coast road's sea side, fruit stands through Harbor Town.
layout.smashables = [
  { kind: 'beach-umbrella', s: [sAt(-406, 298), sAt(-400, 200)], every: 16, side: -1 },
  { kind: 'fruit-stand', s: [30, 170], every: 45 },
  { kind: 'fruit-stand', s: [sAt(241, 434), sAt(176, 430)], every: 60, side: 1 },
];
layout.takedownSpots = [
  { s: sAt(0, -440, 13), name: 'The Freeway' },
  { s: sAt(60, 430), name: 'The Harbour' },
];
// The waterline on the Sandbar is always wet; rain puddles in town, a hairpin and the cliff road.
const puddle = (x: number, z: number, y: number, len: number, l0: number, l1: number) => {
  const s0 = sAt(x, z, y);
  return { s: [s0, s0 + len] as [number, number], lateral: [l0, l1] as [number, number], surface: 'puddle', when: 'wet' as const };
};
layout.zones = [
  { spline: 'sandbar', s: [Math.round(sandSp.length * 0.62), Math.round(sandSp.length * 0.86)], lateral: [-5.5, -1], surface: 'shore' },
  puddle(-150, 392, 2.5, 22, -4, 3),
  puddle(110, -245, 11, 20, -4, 4),
  puddle(390, 450, 12, 22, -3, 5),
];
layout.terrain = {
  sea: 0,
  // The coastline, clockwise from the harbour: the bay the freeway crosses, the point at the lighthouse.
  island: [
    [120, 482],
    [-120, 490],
    [-330, 486],
    [-470, 400],
    [-468, 220],
    [-462, 60],
    [-470, -120],
    [-490, -250],
    [-420, -345],
    [-250, -345],
    [-40, -365],
    [150, -345],
    [270, -440],
    [470, -420],
    [520, -120],
    [510, 180],
    [540, 400],
    [470, 500],
    [300, 520],
  ],
  volcano: VOLCANO,
};

straightenSections(layout, surfaces);
writeFileSync(new URL('../content/maps/paradise/island.track.json', import.meta.url), JSON.stringify(layout, null, 1) + '\n');
const final = bakeTrack(layout, surfaces);
console.log(
  `main ${final.main.length.toFixed(0)} m, ${pts.length} points; ` +
    final.splines
      .slice(1)
      .map((sp) => `${sp.id} ${sp.length.toFixed(0)} m`)
      .join(', '),
);
