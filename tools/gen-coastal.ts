// Generator for Coastal's Riviera layout (docs/COASTAL.md): a harbour town on a headland, built on
// Caldera from the start, laid out in world space. North is -z; the sea is south and west. A lap,
// in order:
//
//   The Quay           the start on the harbour front, heading east to the harbour mouth
//   The Harbour Bridge over the harbour on a deck, a drawbridge in its middle (lifts once or twice a race)
//   The Old Town       up the hill, a bend each way, to the top of the town
//   The Mountain Road  on up in big S-bends to the top of the mountain, through a spur (a cutting; a rock tunnel later)
//   The Descent        five long switchbacks down the mountainside over the sea, rows stacked down the slope
//   Lighthouse Point   down the Corniche along the cliffs to a hairpin round the lighthouse, then down to the sea
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

/**
 * The Descent: rows across the mountainside from `east` to `west` (x), the first at `z` heading
 * west and `top` m up, each `step` m further south (down the slope) and `drop` m lower (half of it
 * along the row, half round its hairpin), every row winding `wind` m north and back at its middle.
 */
const DESCENT = { east: -400, west: -655, z: -545, step: 100, top: 130, drop: 24, rows: 5, r: 28, wind: 18 };
function descent(): Node[] {
  const d = DESCENT;
  const out: Node[] = [];
  let y = d.top;
  for (let k = 0; k < d.rows; k++) {
    const z = d.z + k * d.step;
    // West along even rows, east along odd ones; the hairpin at the row's far end.
    const [from, to] = k % 2 ? [d.west, d.east] : [d.east, d.west];
    out.push(C(from, z, y, d.r));
    // Its middle, bowed out along the contour (a bend each way, not a straight).
    out.push(C((from + to) / 2, z - d.wind * (k % 2 ? -1 : 1), y - d.drop / 4, 160));
    y -= d.drop / 2;
    if (k < d.rows - 1) {
      out.push(C(to, z, y, d.r));
      y -= d.drop / 2;
    }
  }
  return out;
}

/** Where the Mountain Road runs through the spur (its corners either side): a cutting now, a rock tunnel when the main road takes a ceiling (COASTAL.md). */
const TUNNEL = { from: [310, -120], to: [170, -400] };

const nodes: Node[] = [
  // The Quay: east along the harbour front to the bridge.
  Q(-210, 322, 3),
  Q(20, 322, 3.5),
  // The Harbour Bridge: straight over the mouth.
  Q(BRIDGE.from, BRIDGE.z, BRIDGE.y),
  Q(BRIDGE.to, BRIDGE.z, BRIDGE.y),
  // The far quay, and left up into the Old Town.
  Q(430, 318, 4, 40),
  // The Old Town: up the hill between the houses, a bend each way, to the foot of the S.
  T(475, 190, 12, 45),
  T(395, 85, 19, 40),
  T(470, -15, 27, 45),
  // The Mountain Road (the owner, 2026-10-05: the top should wind like an S and climb): S-bends
  // up the hillside to the top of the mountain, each bend the other way, through the spur (TUNNEL).
  C(470, -230, 42, 70),
  C(310, -120, 55, 75),
  C(170, -400, 72, 75),
  C(-10, -150, 86, 75),
  C(-190, -300, 102, 65),
  C(-110, -470, 118, 60),
  // The Descent (the owner: Bond's switchbacks down a mountainside above the sea, long and
  // winding): rows across the slope, each a hairpin (two corners, so its radius holds) and
  // DESCENT.drop lower than the last, the ground falling steeply between them. Run wide at a
  // hairpin and you're off onto the row below.
  ...descent(),
  // The Corniche: down the last of the cliffs above the sea to Lighthouse Point.
  C(-735, -30, 20, 55),
  C(-665, 100, 14, 55),
  // The hairpin round the lighthouse, and down to the sea.
  C(-755, 255, 7, 30),
  C(-610, 300, 5, 60),
  // The Beach: along it, the chicane by the pool, and the Promenade onto the Quay.
  Q(-470, 352, 3, 80),
  Q(-360, 345, 3, 40),
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
  [-450, 400],
  [-590, 380],
  [-700, 350],
  // The cape: Lighthouse Point.
  [-800, 320],
  [-815, 230],
  // The jagged cliffs under the Corniche: headlands and coves.
  [-785, 150],
  [-805, 60],
  [-770, -30],
  [-795, -130],
  [-765, -230],
  [-800, -360],
  [-790, -520],
  [-830, -950],
];

/**
 * The hills: the town's, the mountain over the Descent, the spur the Mountain Road runs through
 * (TUNNEL), and the land behind. Off them the land between the roads is the roads' own heights,
 * relaxed, so the S's bands make a slope up to the top and the Descent's rows a steep one down.
 */
const HILLS = [
  { x: 380, z: -80, h: 45, r: 260 },
  { x: -520, z: -700, h: 190, r: 380 },
  { x: 260, z: -250, h: 100, r: 110 },
  { x: 120, z: -760, h: 185, r: 360 },
  { x: 620, z: -560, h: 140, r: 330 },
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
/**
 * The drawbridge (COASTAL.md, "The drawbridge"): two leaves over the harbour's middle, each half the
 * span, hinged at its own end. Lifted once or twice a race (the owner): a warning, rising to `angle`,
 * up while a boat passes, down. Up to `wall` a leaf is a ramp to jump off; steeper, a wall.
 */
const LIFT = { width: 60, angle: 1.2, wall: 0.52, warn: 4, rise: 6, up: 8, fall: 6, first: [45, 110] as [number, number], again: [80, 130] as [number, number], twice: 0.5 };
const mid = sAt((HARBOUR.west + HARBOUR.east) / 2, BRIDGE.z);
const { width, ...lift } = LIFT;
layout.pieces = [{ id: 'harbour-bridge', s: deck, under: { floor: SEA - 6, ease: 20, reach: 15 }, lift: { ...lift, s: [mid - width / 2, mid + width / 2] } }];
// Open everywhere but the bridge, which has its rails.
layout.walls = {
  gaps: [
    { s: [0, deck[0]], side: 'both' },
    { s: [deck[1], Math.ceil(L)], side: 'both' },
  ],
};
layout.takedownSpots = [
  { s: sAt(BRIDGE.from + 70, BRIDGE.z), name: 'The Harbour Bridge' },
  { s: sAt(-545, DESCENT.z + DESCENT.step), name: 'The Descent' },
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
const spur = [sAt(TUNNEL.from[0], TUNNEL.from[1]), sAt(TUNNEL.to[0], TUNNEL.to[1])];
console.log(`coastal/riviera: ${Math.round(track.main.length)} m, ${pts.length} points, ground ${track.ground!.nx}×${track.ground!.nz}, bridge deck ${deck.join('–')} m (the drawbridge ${mid - width / 2}–${mid + width / 2} m), the spur (a tunnel later) ${spur.join('–')} m`);
