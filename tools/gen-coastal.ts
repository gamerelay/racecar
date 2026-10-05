// Generator for Coastal's Riviera layout (docs/COASTAL.md): a harbour town on a headland, built on
// Caldera from the start, laid out in world space. North is -z; the sea is south and west. A lap,
// in order:
//
//   The Quay           the start on the harbour front, heading east to the harbour mouth
//   The Harbour Bridge over the harbour mouth on a deck (the drawbridge, COASTAL's step 3: fixed for now)
//   The Old Town       up the hill in switchbacks to the top of the town
//   The Cape Tunnel    west along the hillside and through the cape's ridge (a cutting for now)
//   The Corniche       south along the cliffs high over the sea, fast sweepers
//   Lighthouse Point   a hairpin round the lighthouse on the cape's tip, then down to the sea
//   The Beach          along the beach, a chicane by the pool, and the Promenade back onto the Quay
//
// Experimental (map.json), so it's out of the lobby: open it from a link,
// `?mode=free&map=coastal/riviera`.
//
//   bun tools/gen-coastal.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import type { TrackLayout } from '../src/core/content';
import { bakeTrack } from '../src/core/track/bake';
import surfaces from '../content/surfaces.json';
import { type Crest, type Node, lapPoints, onLap } from './lib/lap';

const DIR = 'content/maps/coastal';

const node = (w: number, surface: string, shoulder: number, verge?: string) => (x: number, z: number, y: number, r?: number, more: Partial<Node> = {}): Node => ({ x, z, y, w, r, surface, shoulder, verge, ...more });
/** The Quay, the bridge and the Promenade: wide. */
const Q = node(16, 'asphalt', 3);
/** The Old Town: narrower, between the houses. */
const T = node(13, 'asphalt', 2);
/** The hillside, the cutting and the Corniche: a fast road. */
const C = node(15, 'asphalt', 3);

/** The sea's level. */
const SEA = 0;
/**
 * The harbour: its sides (x) and its head (z), open to the sea to the south. Wide, since the coast
 * is smoothed and the sea only gets deep well out from it: a narrow channel was a sandy creek.
 */
const HARBOUR = { west: 120, east: 290, head: 170 };
/** The bridge over its mouth, along the Quay's line (z): where its deck starts and ends (x), and how high. */
const BRIDGE = { z: 322, from: 95, to: 315, y: 7 };

const nodes: Node[] = [
  // The Quay: east along the harbour front to the bridge.
  Q(-210, 322, 3),
  Q(20, 322, 3.5),
  // The Harbour Bridge: straight over the mouth.
  Q(BRIDGE.from, BRIDGE.z, BRIDGE.y),
  Q(BRIDGE.to, BRIDGE.z, BRIDGE.y),
  // The far quay, and left up into the Old Town.
  Q(420, 318, 3.5, 45),
  // The Old Town: up the hill in switchbacks.
  T(440, 165, 11, 32),
  T(305, 125, 18, 32),
  T(290, -15, 27, 32),
  T(450, -55, 35, 34),
  T(470, -205, 43, 50),
  // The hillside west, and the cutting through the cape's ridge.
  C(160, -265, 46, 140),
  C(-160, -235, 46, 160),
  C(-470, -205, 44, 95),
  // The Corniche: south along the cliffs.
  C(-640, -60, 40, 110),
  C(-605, 150, 34, 100),
  C(-665, 330, 26, 85),
  // Lighthouse Point: the hairpin round the lighthouse, and down to the sea.
  C(-690, 455, 17, 28),
  C(-560, 440, 8, 60),
  // The Beach: along it, the chicane by the pool, and the Promenade onto the Quay.
  Q(-440, 392, 3, 80),
  Q(-345, 352, 3, 40),
  Q(-285, 335, 3, 45),
];

const crests: Crest[] = [];

const pts = lapPoints(nodes, crests, { driftWidth: 2 });

/** The land: a closed loop, the sea outside it. Clockwise from the north-east, round the harbour and the cape. */
const COAST: [number, number][] = [
  [950, -950],
  [950, 380],
  [520, 372],
  [HARBOUR.east, 368],
  [HARBOUR.east, HARBOUR.head + 10],
  [HARBOUR.east - 12, HARBOUR.head],
  [HARBOUR.west + 12, HARBOUR.head],
  [HARBOUR.west, HARBOUR.head + 10],
  [HARBOUR.west, 368],
  [-150, 370],
  [-300, 395],
  [-450, 430],
  [-580, 480],
  [-690, 525],
  [-760, 490],
  [-750, 330],
  [-715, 140],
  [-715, -80],
  [-740, -400],
  [-780, -950],
];

/** The hills: the town's, the cape's ridge (two, end to end), and the land behind. */
const HILLS = [
  { x: 380, z: -80, h: 52, r: 300 },
  { x: -270, z: -270, h: 78, r: 210 },
  { x: -420, z: -330, h: 70, r: 200 },
  { x: 0, z: -620, h: 70, r: 420 },
  { x: 650, z: -500, h: 60, r: 380 },
];

const layout: TrackLayout = {
  id: 'riviera',
  name: 'Riviera',
  main: { points: pts },
  branches: [],
  zones: [],
  walls: { gaps: [] },
  ramps: [],
  checkpoints: 'auto',
  props: [],
  takedownSpots: [],
  shoulderSurface: 'grass',
};

const baked = bakeTrack(layout, surfaces);
const L = baked.main.length;
const { sAt } = onLap(baked);

/** The bridge's deck: from where it leaves the quay to where it lands. */
const deck: [number, number] = [sAt(BRIDGE.from - 25, BRIDGE.z), sAt(BRIDGE.to + 25, BRIDGE.z)];
layout.pieces = [{ id: 'harbour-bridge', s: deck, under: { floor: SEA - 6, ease: 20, reach: 15 } }];
// Open everywhere but the bridge, which has its rails.
layout.walls = {
  gaps: [
    { s: [0, deck[0]], side: 'both' },
    { s: [deck[1], Math.ceil(L)], side: 'both' },
  ],
};
layout.takedownSpots = [
  { s: sAt(BRIDGE.from + 70, BRIDGE.z), name: 'The Harbour Bridge' },
  { s: sAt(-640, -60), name: 'The Corniche' },
];
layout.ground = {
  cell: 2.5,
  // No walls: the coast is the edge, and past it deep water (a respawn).
  wallFrom: 200,
  wallRise: 0,
  swell: { height: 0.6, size: 70 },
  rough: { height: 0.6, size: 18 },
  sea: SEA,
  coast: COAST,
  hills: HILLS,
  pines: { kind: 'tropic', seed: 41, spacing: 9, clear: 8, thicken: 30, density: 0.25, glade: 80 },
};

mkdirSync(DIR, { recursive: true });
writeFileSync(`${DIR}/riviera.track.json`, `${JSON.stringify(layout)}\n`);
writeFileSync(`${DIR}/map.json`, `${JSON.stringify({ id: 'coastal', name: 'Coastal', layouts: ['riviera'], palette: 'tropic', sunset: 'sunset', weather: ['clear', 'rain', 'shower', 'rare'], experimental: true })}\n`);
const track = bakeTrack(layout, surfaces);
console.log(`coastal/riviera: ${Math.round(track.main.length)} m, ${pts.length} points, ground ${track.ground!.nx}×${track.ground!.nz}, bridge deck ${deck.join('–')} m`);
