// Generator for Coastal's Riviera layout (docs/COASTAL.md): a harbour town on a headland, built on
// Caldera from the start, laid out in world space. North is -z; the sea is south and west. A lap,
// in order:
//
//   The Quay           the start on the harbour front, heading east to the harbour mouth
//   The Harbour Bridge over the harbour on a deck, a drawbridge in its middle (lifts once or twice a race)
//   The Old Town       up the hill, a bend each way, to the top of the town
//   The Mountain Road  on up in big S-bends to the top of the mountain, through a spur (a cutting; a rock tunnel later)
//   The Descent        five long switchbacks down the mountainside over the sea, rows stacked down the slope
//   Lighthouse Point   down the Corniche along the cliffs, a loop round the cape and the lighthouse (the Rocks across it), down to the sea
//   The Beach          along the sea wall, a chicane by the pool, and the Promenade back onto the Quay
//
// In the lobby as *Riviera* (the owner, 2026-10-05: out of experimental; the map's id stays
// `coastal`, so links and fingerprints keep working).
//
//   bun tools/gen-coastal.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import type { HouseDef, LandmarkDef, TrackLayout, TrackPoint } from '../src/core/content';
import { newContact, obbOverlap } from '../src/core/collide/obb';
import { Rng } from '../src/core/rng';
import { bakeTrack, COLUMN } from '../src/core/track/bake';
import { hillHeight } from '../src/core/track/features/hills';
import { SEAWALL_FACE } from '../src/core/track/features/seawall';
import { newHit, offRoad, projectGlobal, sampleAt } from '../src/core/track/query';
import surfaces from '../content/surfaces.json';
import { type Crest, type Node, lapPoints, onLap } from './lib/lap';

const DIR = 'content/maps/coastal';

const node = (w: number, surface: string, shoulder: number, verge?: string) => (x: number, z: number, y: number, r?: number, more: Partial<Node> = {}): Node => ({ x, z, y, w, r, surface, shoulder, verge, ...more });
/** The Quay, the bridge and the Promenade: wide. */
const Q = node(16, 'asphalt', 3);
/**
 * The home straight, the Promenade's end onto the Quay: the Riviera's waterfront boulevard (the
 * owner, 2026-10-05), four lanes, the sea one side and the town the other, pavements both sides.
 * (Two-way traffic on 16 m boxed the AI in: it's in the outer lanes here, the middle two for racing.)
 */
const H = (x: number, z: number, y: number, r?: number): Node => ({ ...node(20, 'asphalt', 3, 'sidewalk')(x, z, y, r), lanes: 4 });
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

/**
 * The Rock Tunnel (COASTAL.md): where the Mountain Road runs through the spur (between its corners
 * either side, `from` and `to`), the stretch the spur's rock stands at least `clear` m over the
 * road is a tunnel, `ceiling` m high (the main road's rock kept over it: ground/land.ts).
 */
const TUNNEL = { from: [310, -120], to: [170, -400], clear: 18, ceiling: 7.5 };

/**
 * The sea wall (the owner, 2026-10-05, with the photo of Villefranche: water on the right, not a
 * beach, against a retaining wall): on the sea side of the waterfront, from the lighthouse
 * hairpin's way out (`from`, x and z on it) along the Beach, the Promenade and the Quay to where
 * the bridge's deck starts. A stone wall stands along it (the rock rails' parapet, a ledge to the
 * quay's edge) with the sea `floor` m deep against it, and the coast runs along it `out` m past
 * the road's verge, at the sea face.
 */
const SEAWALL = { from: [-772, 394], floor: SEA - 10, out: SEAWALL_FACE };

/**
 * Lighthouse Point: the Corniche's way in (`in`), out to the cape's west side (`west`) and round
 * its tip (`tip`), each corner `r` m, then east along the shore. The lighthouse stands inside the
 * loop at `light`.
 */
const POINT = { in: [-700, 175], west: [-800, 255], tip: [-788, 388], r: 16, light: [-758, 318] };

/**
 * The cove (the owner, 2026-10-06: the Sand's new home, below the Descent): a bay in the cliffs
 * under the Corniche with a beach at its head. The road comes down to it at `y` m and swings inland
 * round the beach club (its corner at `club`, x and z; the club itself at `inside`) in a chicane;
 * the coast runs along `shore`.
 */
const COVE = { y: 4, club: [-640, 80], inside: [-690, 85] as [number, number], shore: [[-776, -40], [-776, 20], [-774, 90], [-772, 150], [-792, 190]] as [number, number][] };

/**
 * The Old Town's switchbacks: rows across the hillside between `east` and `west` (x), the first at
 * `z`, each `step` m further north (up the slope) and `rise` m higher, joined by hairpins of two
 * `r` m corners (as the Descent's, so the radius holds). The way in turns off the far quay's climb.
 */
const OLD_TOWN = { east: 495, west: 345, z: 258, step: 66, y: 7, rise: 7, r: 14 };
function oldTown(): Node[] {
  const o = OLD_TOWN;
  const [z1, z2, z3] = [o.z, o.z - o.step, o.z - 2 * o.step];
  return [
    // In off the climb from the quay, turning west along the first row.
    T(455, z1 + 4, o.y, 24),
    // The first hairpin, at the west end: up and back east.
    T(o.west, z1, o.y + o.rise / 2, o.r),
    T(o.west, z2, o.y + o.rise, o.r),
    // The second, at the east end: up and back west.
    T(o.east, z2, o.y + (3 * o.rise) / 2, o.r),
    T(o.east, z3, o.y + 2 * o.rise, o.r),
    // Off the third row, turning north up the hill.
    T(380, z3 - 4, o.y + (5 * o.rise) / 2, 30),
  ];
}

const nodes: Node[] = [
  // The Quay: east along the harbour front to the bridge.
  H(-210, 322, 3),
  H(20, 322, 3.5),
  // The Harbour Bridge: straight over the mouth.
  Q(BRIDGE.from, BRIDGE.z, BRIDGE.y),
  Q(BRIDGE.to, BRIDGE.z, BRIDGE.y),
  // The far quay, and left up into the Old Town.
  Q(430, 318, 4, 40),
  // The Old Town (the owner, 2026-10-05: real switchbacks, tight and slow between the houses):
  // west across the slope, a hairpin, back east, a hairpin, west again (OLD_TOWN), then up to the
  // foot of the S. The Stairs cut straight up from the first row to the second (STAIRS).
  ...oldTown(),
  T(400, 45, 25, 40),
  T(470, -15, 28, 45),
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
  // The Corniche: down the last of the cliffs above the sea, into the cove (COVE): off the cliff
  // to the beach, inland round the beach club in a chicane, and out to Lighthouse Point. The Sand
  // runs straight along the waterline past it (SAND).
  C(-735, -30, 11, 55),
  C(-725, 45, COVE.y + 1, 25),
  C(COVE.club[0] - 15, COVE.club[1] - 30, COVE.y, 18),
  C(COVE.club[0] + 5, COVE.club[1] + 20, COVE.y, 16),
  C(-700, 120, COVE.y, 22),
  // Lighthouse Point (the owner's sketch: a tight hairpin round the lighthouse at the cape's tip):
  // out to the tip and round it, the lighthouse on its rock inside the loop (POINT), then back
  // along the shore and down to the sea. The Rocks cut straight across the loop's neck (ROCKS).
  C(POINT.in[0], POINT.in[1], 8, 40),
  C(POINT.west[0], POINT.west[1], 7, POINT.r),
  C(POINT.tip[0], POINT.tip[1], 5, POINT.r),
  C(-610, 300, 5, 60, { verge: 'sidewalk' }),
  // The Beach: along the sea wall, the chicane by the pool, and the Promenade onto the Quay
  // (pavements from here round to the Quay: the waterfront's).
  Q(-470, 352, 3, 80, { verge: 'sidewalk' }),
  H(-360, 345, 3, 40),
  H(-285, 335, 3, 45),
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
  // (Then west along the sea wall to the cape: SEAWALL, filled in once the road's baked.)
  // The cape: Lighthouse Point, out round the loop's tip (from the sea wall's start, west).
  [-835, 405],
  [-842, 250],
  // The cove (COVE), and the jagged cliffs under the Corniche north of it: headlands and coves.
  ...[...COVE.shore].reverse(),
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
  { x: 294, z: -170, h: 100, r: 110 },
  { x: 256, z: -229, h: 104, r: 110 },
  { x: 225, z: -290, h: 110, r: 110 },
  { x: 120, z: -760, h: 185, r: 360 },
  { x: 620, z: -560, h: 140, r: 330 },
  // The lighthouse's knoll, inside Lighthouse Point's loop.
  { x: POINT.light[0], z: POINT.light[1], h: 8, r: 28 },
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
/** The Old Town on the lap: from the far quay's corner to the top of its climb. */
const OLD_TOWN_S: [number, number] = [sAt(430, 318), sAt(470, -15)];

/** The bridge's deck: from where it leaves the quay to where it lands. */
const deck: [number, number] = [sAt(BRIDGE.from - 25, BRIDGE.z), sAt(BRIDGE.to + 25, BRIDGE.z)];
/** The sea wall: from the hairpin's way out, through the lap's end, to the deck. */
const seawall: [number, number] = [sAt(SEAWALL.from[0], SEAWALL.from[1]), deck[0]];
{
  // The coast along it, west from the deck to its start, every 10 m (into COAST after the harbour's west side).
  const hit = newHit();
  const along: [number, number][] = [];
  for (let s = seawall[1]; s > seawall[0] - L; s -= 10) {
    sampleAt(baked.main, (s + L) % L, hit);
    const off = hit.width / 2 + hit.shoulder + SEAWALL.out;
    along.push([Math.round((hit.cx - hit.tz * off) * 10) / 10, Math.round((hit.cz + hit.tx * off) * 10) / 10]);
  }
  COAST.splice(COAST.findIndex(([x, z]) => x === HARBOUR.west && z === 368) + 1, 0, ...along);
}
/**
 * The drawbridge (COASTAL.md, "The drawbridge"): two leaves over the harbour's middle, each half the
 * span, hinged at its own end. Lifted once or twice a race (the owner): a warning, rising to `angle`,
 * up while a boat passes, down. Up to `wall` a leaf is a ramp to jump off; steeper, a wall. The
 * boat waits at the harbour's head (left of the road, north) and sails out to sea under the first
 * lift, back in under a second.
 */
const LIFT = { width: 60, angle: 1.2, wall: 0.52, warn: 4, rise: 6, up: 8, fall: 6, first: [45, 110] as [number, number], again: [80, 130] as [number, number], twice: 0.5, boat: [-125, 120] as [number, number] };
const mid = sAt((HARBOUR.west + HARBOUR.east) / 2, BRIDGE.z);
const { width, ...lift } = LIFT;
// The Rock Tunnel: through the spur where its rock stands well over the road (the hills are set
// below, HILLS: the same ones the ground's shaped by).
const tunnel = ((): [number, number] => {
  const hit = newHit();
  const [a, b] = [sAt(TUNNEL.from[0], TUNNEL.from[1]), sAt(TUNNEL.to[0], TUNNEL.to[1])];
  let from = Infinity;
  let to = -Infinity;
  for (let s = a; s <= b; s += 2) {
    sampleAt(baked.main, s, hit);
    if (hillHeight(HILLS, hit.cx, hit.cz) - hit.cy < TUNNEL.clear) continue;
    from = Math.min(from, s);
    to = Math.max(to, s);
  }
  return [from, to];
})();
layout.pieces = [
  { id: 'harbour-bridge', s: deck, under: { floor: SEA - 6, ease: 20, reach: 15 }, lift: { ...lift, s: [mid - width / 2, mid + width / 2] } },
  { id: 'rock-tunnel', s: tunnel, ceiling: TUNNEL.ceiling, indoor: 'tunnel' },
];
/**
 * Rock rails (the owner, 2026-10-05: rails on the tight corners up top, rock-themed): a stone
 * parapet on the outside of every corner tighter than `radius` m from the middle of the Old Town to
 * Lighthouse Point (`from`–`to`, x and z of a point on each), `run` m on past each end. The straights
 * between stay open: run wide there and you're off onto the row below, or into the sea.
 */
const RAILS = { radius: 110, run: 15, from: [OLD_TOWN.west + 60, OLD_TOWN.z], to: [POINT.tip[0] + 30, POINT.tip[1] - 4] };
/** Where the walls stand, per main-road sample and side: the bridge's rails, the tunnel's walls, the rock rails; open elsewhere. */
const walled = (() => {
  const n = baked.main.n;
  const step = baked.main.step;
  const left = new Uint8Array(n);
  const right = new Uint8Array(n);
  const mark = (a: number, b: number, side: Uint8Array) => {
    for (let i = Math.max(0, Math.ceil(a / step)); i <= Math.min(n - 1, Math.floor(b / step)); i++) side[i] = 1;
  };
  for (const [a, b] of [deck, tunnel]) {
    mark(a, b, left);
    mark(a, b, right);
  }
  // The sea wall, through the lap's end.
  mark(seawall[0], L, right);
  mark(0, seawall[1], right);
  const [a, b] = [sAt(RAILS.from[0], RAILS.from[1]), sAt(RAILS.to[0], RAILS.to[1])];
  const m = baked.main;
  const w = Math.round(10 / step);
  for (let i = Math.ceil(a / step) + w; i < Math.floor(b / step) - w; i++) {
    // The turn over ±10 m: toward the right (its tangent moving onto the right, (-tz, tx)) or the left.
    const turn = (m.tx[i + w] - m.tx[i - w]) * -m.tz[i] + (m.tz[i + w] - m.tz[i - w]) * m.tx[i];
    const radius = (2 * w * step) / Math.max(1e-6, Math.abs(turn));
    if (radius < RAILS.radius) mark(i * step - RAILS.run, i * step + RAILS.run, turn > 0 ? left : right);
  }
  return { left, right };
})();
// Gaps wherever a side has no wall.
const gaps: { s: [number, number]; side: 'left' | 'right' }[] = [];
for (const [side, on] of [['left', walled.left], ['right', walled.right]] as const) {
  for (let i = 0; i < on.length; ) {
    if (on[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < on.length && !on[j + 1]) j++;
    // (Up to the last open sample: the bake clears a gap's ends too, and the first walled one was lost.)
    gaps.push({ s: [i * baked.main.step, j === on.length - 1 ? Math.ceil(L) : j * baked.main.step], side });
    i = j + 1;
  }
}
layout.walls = { gaps };
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
  // Steeper than 45° is rock: a wall, not a slope to be lifted up (off the road by the Rock Tunnel's
  // mouth, cars went straight up the cliff beside it onto the hill).
  face: 1,
  features: [
    { kind: 'seawall', s: seawall, side: 'right', floor: SEAWALL.floor },
    // The cove's beach, from the road out to the sea (and inside the chicane, round the club).
    { kind: 'beach', s: [sAt(-735, -30), sAt(POINT.in[0], POINT.in[1])], side: 'right' },
  ],
  pines: { kind: 'tropic', look: 'riviera', seed: 41, spacing: 9, clear: 8, thicken: 30, density: 0.25, glade: 80 },
};

/**
 * The Basin Road (COASTAL.md, "The detour"): round the inner harbour's head when the bridge is up,
 * always open. Off the Quay to the left before the bridge, up the harbour's west side, a hairpin
 * round its head by the fish market, down its east side and back onto the far quay. Slow and safe:
 * a clean bridge beats it by a few seconds, and a lift doesn't ruin a race. Its corners (x, z),
 * between the main road at `from` and `to` (x along the Quay's line).
 */
const BASIN = { from: -45, to: 392, width: 11, shoulder: 2, rise: 4, corners: [
  [12, 302],
  [62, 276],
  [94, 236],
  [100, 190],
  [110, 156],
  [145, 140],
  [205, 136],
  [265, 140],
  [300, 156],
  [310, 190],
  [316, 236],
  [340, 276],
  [365, 302],
] as [number, number][] };
{
  const g = bakeTrack(layout, surfaces);
  const hit = newHit();
  const from = sAt(BASIN.from, BRIDGE.z);
  const to = sAt(BASIN.to, BRIDGE.z);
  // Its ends a little in off the main road, to the left (north), so it forks off gently.
  const end = (s: number): [number, number] => (sampleAt(g.main, s, hit), [hit.cx + hit.tz * 5, hit.cz - hit.tx * 5]);
  const corners = [end(from + 14), ...BASIN.corners, end(to - 14)];
  // Its corners rounded off (Chaikin: each pass cuts every corner at a quarter and three quarters).
  let line: [number, number][] = corners;
  for (let pass = 0; pass < 4; pass++)
    line = [line[0], ...line.slice(0, -1).flatMap(([ax, az], k) => {
      const [bx, bz] = line[k + 1];
      return [[0.75 * ax + 0.25 * bx, 0.75 * az + 0.25 * bz], [0.25 * ax + 0.75 * bx, 0.25 * az + 0.75 * bz]] as [number, number][];
    }), line[line.length - 1]];
  // Every 8 m along them. A harbour road, low along the water: from the quay's height up a
  // few metres round the head and down again (the land behind it rises to the Mountain Road, so
  // it's cut into the slope there; branches shape the ground to their own heights).
  const along: [number, number][] = [];
  let left = 0;
  for (let k = 0; k + 1 < line.length; k++) {
    const [ax, az] = line[k];
    const [bx, bz] = line[k + 1];
    const len = Math.hypot(bx - ax, bz - az);
    for (; left < len; left += 8) along.push([ax + ((bx - ax) * left) / len, az + ((bz - az) * left) / len]);
    left -= len;
  }
  along.push(line[line.length - 1]);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const points: TrackPoint[] = along.map(([x, z], k) => ({
    p: [r1(x), r1(BRIDGE.y - 3.5 + BASIN.rise * Math.sin((Math.PI * k) / (along.length - 1))), r1(z)],
    width: BASIN.width,
    lanes: 2,
    shoulder: BASIN.shoulder,
    surface: 'asphalt',
  }));
  layout.branches = [{ id: 'basin-road', from, to, kind: 'alternate', points }];
  // Open, as every road here but the bridge.
  layout.walls = { gaps: [...(layout.walls?.gaps ?? []), { spline: 'basin-road', s: [0, 1e4], side: 'both' }] };
}

/**
 * Side streets (COASTAL.md, "Traffic from side streets"; the owner: so traffic doesn't pop in and
 * out on the main road): short loops off the main road and back, round behind where the houses
 * will stand, that the traffic comes and goes by. Each is [id, from, to (main distances), side
 * (+1 right, -1 left)]. A lane's streets are on its own side, so nobody turns across the other
 * lane: with the lap (eastbound on the Promenade) on the right, against it on the left. Open to
 * drive; the AI keeps to the main road.
 */
const STREETS: [string, number, number, 1 | -1, { depth?: number; lead?: number; straight?: boolean; climb?: boolean }?][] = [
  // Round the line on the home straight, from the end of the Promenade onto the Quay: two streets
  // up into the town. Straight between them (the traffic once ran through the Promenade's kink, and
  // the AI's line there cut into the oncoming lane: head-ons; MAPS.md's rule, no traffic through
  // fast bends); short of the Basin Road's turn. The sea side is the sea wall's, so no streets
  // there (the lido's and the harbour's car parks went with the beach, 2026-10-05), and only the
  // town-side lane has traffic: the lap's own lane is the racers'.
  // (The Old Town's come with its houses, COASTAL's step 6: its road bends too much for loops.)
  // (Round behind the casino's square: out deep and straight along its back, its corners wide enough
  // for the traffic, CASINO.)
  ['rue-du-port', 25, 155, -1, { depth: 72, lead: 15, straight: true }],
  // (Out and straight along the hotel's front, under its terrace: HOTEL.)
  ['rue-des-pins', L - 250, L - 110, -1, { lead: 15, straight: true }],
  // Rue Haute (the owner, 2026-10-06: "a second row of buildings and a back street behind the
  // village", so the town isn't one row deep): up behind the waterfront's houses, round the hotel,
  // and back down short of the line (no street crosses it: the line's a node of the road graph, and
  // rue-du-port behind the casino starts just past it). Up on the hill (`climb`: its own height,
  // the ground's there); a way through for traffic both ways (HAUTE), never a shortcut.
  ['rue-haute', L - 420, L - 35, -1, { depth: 100, lead: 45, climb: true }],
];
/** Rue Haute's traffic, both ways along it, over its back stretch (m in from each end: off the legs down to the boulevard, out of sight round the houses); its steepest grade. */
const HAUTE = { trim: 75, speed: 11, grade: 0.07 };
/** How far off the main road's middle a street runs (m, unless it says), how wide it is, and the traffic on it. */
const STREET = { depth: 32, width: 8, shoulder: 1.5, speed: 14, density: 8, every: 6 };
{
  const g = bakeTrack(layout, surfaces);
  const hit = newHit();
  for (const [id, from, to, side, shape = {}] of STREETS) {
    const depth = shape.depth ?? STREET.depth;
    const lead = shape.lead ?? 25;
    // Out from just past the main road's verge 30 m along, across to `depth`, along, and back in.
    const at = (s: number, lat: number): [number, number] => (sampleAt(g.main, s, hit), [hit.cx - hit.tz * lat * side, hit.cz + hit.tx * lat * side]);
    const edge = () => hit.width / 2 + hit.shoulder + STREET.width / 2 + 1;
    sampleAt(g.main, from + 30, hit);
    const near = edge();
    const corners: [number, number][] = [at(from + 30, near), at(from + 30 + lead, depth)];
    // (`straight`: one straight along the back, not a corner every 25 m following the main road's bends.)
    // (Deep in, inside a bend of the boulevard, its corners crowd together and turn back on each
    // other: rue Haute bent round 7 m there. Further apart, and none that turns back.)
    const every = shape.climb ? 50 : 25;
    if (!shape.straight) for (let s = from + 30 + lead + every; s < to - 30 - lead - every / 2; s += every) corners.push(at(s, depth));
    corners.push(at(to - 30 - lead, depth));
    for (let k = corners.length - 2; k >= 2 && shape.climb; k--) {
      const [ax, az] = corners[k - 1];
      const [bx, bz] = corners[k];
      const [cx, cz] = corners[k + 1];
      if ((bx - ax) * (cx - bx) + (bz - az) * (cz - bz) < 0.5 * Math.hypot(bx - ax, bz - az) * Math.hypot(cx - bx, cz - bz)) corners.splice(k, 1);
    }
    sampleAt(g.main, to - 30, hit);
    corners.push(at(to - 30, edge()));
    let line = corners;
    for (let pass = 0; pass < 3; pass++)
      line = [line[0], ...line.slice(0, -1).flatMap(([ax, az], k) => {
        const [bx, bz] = line[k + 1];
        return [[0.75 * ax + 0.25 * bx, 0.75 * az + 0.25 * bz], [0.25 * ax + 0.75 * bx, 0.25 * az + 0.75 * bz]] as [number, number][];
      }), line[line.length - 1]];
    // Every 6 m, at the main road's height beside it (the ground is cut and filled to it).
    const points: TrackPoint[] = [];
    let left = 0;
    for (let k = 0; k + 1 < line.length; k++) {
      const [ax, az] = line[k];
      const [bx, bz] = line[k + 1];
      const len = Math.hypot(bx - ax, bz - az);
      for (; left < len; left += STREET.every) points.push(streetPoint(ax + ((bx - ax) * left) / len, az + ((bz - az) * left) / len));
      left -= len;
    }
    points.push(streetPoint(...line[line.length - 1]));
    if (shape.climb) {
      // Up on the hill, its heights its own: the ground's height there (before the streets cut it),
      // and where the bake holds it to the boulevard's surface (`merge` in a trial bake: as the
      // Sand; a guess at where was a 0.4 m step), the boulevard's; up from there no steeper than
      // HAUTE.grade, smoothed.
      const trial = bakeTrack({ ...layout, branches: [...layout.branches!, { id, from, to, kind: 'street', points, heights: 'own' }] }, surfaces);
      const tsp = trial.splines.find((x) => x.id === id)!;
      const n = points.length;
      const pinned: boolean[] = [];
      const y = points.map(({ p: [x, , z] }, k) => {
        projectGlobal(tsp, x, z, hit);
        const i = Math.min(tsp.n - 1, Math.round(hit.s / tsp.step));
        // Held where the bake holds it to the boulevard (an own-heights branch: merge 1) and at its
        // end points (they stop short of the junction: the bake runs it on to it, on the
        // boulevard), on the boulevard's surface carried out sideways, banked, as the bake has it
        // (joinBranch); between, from that toward the ground as it pulls clear. (Held wherever it
        // was half on, it crested 0.4 m where the bake lets it go; held only at merge 1, it
        // climbed 13% into the last few meters before the end.)
        const m = k === 0 || k === n - 1 ? 1 : tsp.merge[i];
        pinned[k] = m >= 1;
        const ground = g.ground!.height(x, z);
        if (m <= 0) return ground;
        projectGlobal(g.main, x, z, hit);
        return ground + (hit.cy - hit.lateral * Math.tan(hit.bank) - ground) * m;
      });
      const hold = () => {
        for (let k = 1; k < n; k++) y[k] = Math.min(y[k], y[k - 1] + STREET.every * HAUTE.grade);
        for (let k = n - 2; k >= 0; k--) y[k] = Math.min(y[k], y[k + 1] + STREET.every * HAUTE.grade);
      };
      hold();
      for (let pass = 0; pass < 3; pass++) for (let k = 1; k < n - 1; k++) if (!pinned[k]) y[k] = (y[k - 1] + 2 * y[k] + y[k + 1]) / 4;
      hold();
      for (let k = 0; k < n; k++) points[k].p[1] = Math.round(y[k] * 100) / 100;
    }
    function streetPoint(x: number, z: number): TrackPoint {
      const s = sAt(x, z);
      sampleAt(g.main, s, hit);
      return { p: [Math.round(x * 10) / 10, Math.round(hit.cy * 10) / 10, Math.round(z * 10) / 10], width: STREET.width, lanes: 2, shoulder: STREET.shoulder, surface: 'asphalt' };
    }
    // (A climbing street's heights its own: the bake holds it to the boulevard only while it's on
    // it, as `flat` above, with no blend to undo.)
    layout.branches!.push({ id, from, to, kind: 'street', points, ...(shape.climb ? { heights: 'own' as const } : {}) });
    layout.walls!.gaps!.push({ spline: id, s: [0, 1e4], side: 'both' });
  }
  // A lane against the lap, on the left (in by the first street, out by the second).
  // (In the boulevard's outer lane; a street's two lanes are narrower: the same fraction of it.)
  const lane = (dir: 1 | -1, streets: string[]) => ({ pos: dir * 0.7, dir, speed: STREET.speed, streets });
  // And up and down rue Haute, its back stretch (each on its own right, as on the boulevard).
  const haute = layout.branches!.find((b) => b.id === 'rue-haute')!;
  const len = bakeTrack(layout, surfaces).splines.find((x) => x.id === haute.id)!.length;
  const span: [number, number] = [HAUTE.trim, Math.round(len - HAUTE.trim)];
  const along = (dir: 1 | -1) => ({ pos: dir * 0.7, dir, speed: HAUTE.speed, road: haute.id, span });
  layout.traffic = { density: STREET.density, lanes: [lane(-1, ['rue-du-port', 'rue-des-pins']), along(1), along(-1)] };
}

/**
 * The Stairs (COASTAL.md, the Old Town's risky cut): stone steps straight up the hill from the first
 * row to the second, skipping the first hairpin, and across the second at a crossroads on up to the
 * third, skipping the other. Halfway up the first flight an arm forks off across the slope onto the
 * second row further along (CALDERA 6e: a lane off a branch): the gentler way out. Narrow, steep,
 * each step a `riser` m lip every `tread` m on the climb (their own heights, so the bake doesn't
 * smooth them away), on stone that grips less than the road. Each flight runs up at `x` (the first)
 * and `x2` (the second); the arm comes out on the second row at `arm`.
 */
const STAIRS = { x: 425, x2: 460, arm: 470, width: 8, shoulder: 0.5, tread: 4, riser: 0.25, surface: 'sidewalk', limit: 24 };
{
  const g = bakeTrack(layout, surfaces);
  const hit = newHit();
  const o = OLD_TOWN;
  const [z1, z2, z3] = [o.z, o.z - o.step, o.z - 2 * o.step];
  const r1 = (v: number) => Math.round(v * 100) / 100;
  /** A flight's points along `line` (x, z), every metre, its heights from `y0` to `y1` in steps. */
  const flight = (corners: [number, number][], y0: number, y1: number): TrackPoint[] => {
    let line = corners;
    // Its corners rounded off (Chaikin, as the Basin Road's, over pieces of 6 m at most so only
    // the corners round and the flights between stay straight), then a point every metre.
    line = line.slice(0, -1).flatMap(([ax, az], k) => {
      const [bx, bz] = line[k + 1];
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 6);
      return Array.from({ length: n }, (_, j) => [ax + ((bx - ax) * j) / n, az + ((bz - az) * j) / n] as [number, number]);
    }).concat([line[line.length - 1]]);
    for (let pass = 0; pass < 3; pass++)
      line = [line[0], ...line.slice(0, -1).flatMap(([ax, az], k) => {
        const [bx, bz] = line[k + 1];
        return [[0.75 * ax + 0.25 * bx, 0.75 * az + 0.25 * bz], [0.25 * ax + 0.75 * bx, 0.25 * az + 0.75 * bz]] as [number, number][];
      }), line[line.length - 1]];
    const along: [number, number][] = [];
    for (let k = 0; k + 1 < line.length; k++) {
      const [ax, az] = line[k];
      const [bx, bz] = line[k + 1];
      const len = Math.hypot(bx - ax, bz - az);
      for (let u = 0; u < len; u += 1) along.push([ax + ((bx - ax) * u) / len, az + ((bz - az) * u) / len]);
    }
    along.push(line[line.length - 1]);
    // The climb straight between the ends, a lip every tread on top of it (a step, not a slope).
    return along.map(([x, z], k) => {
      const u = k / (along.length - 1);
      const lip = STAIRS.riser * ((k % STAIRS.tread) / STAIRS.tread - 0.5);
      return { p: [r1(x), r1(y0 + (y1 - y0) * u - lip), r1(z)], width: STAIRS.width, lanes: 1, shoulder: STAIRS.shoulder, surface: STAIRS.surface };
    });
  };
  const yAt = (s: number) => (sampleAt(g.main, s, hit), hit.cy);
  // The first flight: off the first row (heading west) to its right, up, onto the second (heading east).
  const a = sAt(STAIRS.x + 22, z1);
  const c = sAt(STAIRS.x + 18, z2);
  const up: [number, number][] = [[STAIRS.x + 10, z1 - 7], [STAIRS.x, z1 - 18], [STAIRS.x, z2 + 18], [STAIRS.x + 8, z2 + 7]];
  // The second: off the second row at the same spot (one node: the crossroads), up, onto the third
  // (heading west).
  const d = sAt(STAIRS.x2 - 24, z3);
  const top: [number, number][] = [[STAIRS.x2 - 5, z2 - 6], [STAIRS.x2, z2 - 18], [STAIRS.x2, z3 + 18], [STAIRS.x2 - 12, z3 + 5]];
  layout.branches!.push(
    { id: 'stairs', kind: 'shortcut', from: Math.round(a), to: Math.round(c), heights: 'own', limit: STAIRS.limit, points: flight(up, yAt(a), yAt(c)) },
    { id: 'stairs-top', kind: 'shortcut', from: Math.round(c) + 0.5, to: Math.round(d), heights: 'own', limit: STAIRS.limit, points: flight(top, yAt(c), yAt(d)) },
  );
  // The arm: from halfway up the first flight (where it is between the rows, on the flight as
  // baked), across the slope onto the second row at `arm`.
  const stairs = bakeTrack(layout, surfaces).splines.find((x) => x.id === 'stairs')!;
  const zf = (z1 + z2) / 2;
  projectGlobal(stairs, STAIRS.x, zf, hit);
  const mid = Math.round(hit.s);
  sampleAt(stairs, mid, hit);
  const e = sAt(STAIRS.arm, z2);
  const arm: [number, number][] = [[STAIRS.x + 7, zf - 15], [STAIRS.arm - 22, z2 + 10], [STAIRS.arm - 12, z2 + 4]];
  layout.branches!.push({ id: 'stairs-arm', kind: 'shortcut', leaves: 'stairs', from: mid, to: Math.round(e), heights: 'own', limit: STAIRS.limit, points: flight(arm, hit.cy, yAt(e)) });
  for (const id of ['stairs', 'stairs-top', 'stairs-arm']) layout.walls!.gaps!.push({ spline: id, s: [0, 1e4], side: 'both' });
}

/**
 * The Rocks (COASTAL.md, Lighthouse Point's cut): straight across the loop's neck instead of round
 * the cape, over the bare rock below the lighthouse. Off the way in (heading south-west) at `from`
 * (x, z on it), down past the lighthouse's foot, onto the shore road at `to`. Rough: `rock`, which
 * grips less than the road, its own heights lumpy by up to `lumps` m every few metres and a
 * `ridge` m ridge of rock across it at each of `ridges` (taken too fast, they throw you), and
 * `limit` the fastest the AI takes it.
 */
const ROCKS = { from: [-712, 187], to: [-652, 321], width: 7, shoulder: 0.5, lumps: 0.3, ridge: 1.2, ridges: [0.3, 0.48, 0.62], boulders: [5, 9], limit: 36, surface: 'rock' };
{
  const g = bakeTrack(layout, surfaces);
  const hit = newHit();
  const a = Math.round(sAt(ROCKS.from[0], ROCKS.from[1]));
  const b = Math.round(sAt(ROCKS.to[0], ROCKS.to[1]));
  const ya = (sampleAt(g.main, a, hit), hit.cy);
  const yb = (sampleAt(g.main, b, hit), hit.cy);
  // Down the neck, east of the lighthouse: across, then round onto the shore road heading east.
  let corners: [number, number][] = [[-722, 205], [-718, 250], [-713, 292], [-702, 316], [-684, 324]];
  // Rounded off at its bends (Chaikin over pieces of 8 m at most, as the Stairs').
  corners = corners.slice(0, -1).flatMap(([ax, az], k) => {
    const [bx, bz] = corners[k + 1];
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 8);
    return Array.from({ length: n }, (_, j) => [ax + ((bx - ax) * j) / n, az + ((bz - az) * j) / n] as [number, number]);
  }).concat([corners[corners.length - 1]]);
  for (let pass = 0; pass < 3; pass++)
    corners = [corners[0], ...corners.slice(0, -1).flatMap(([ax, az], k) => {
      const [bx, bz] = corners[k + 1];
      return [[0.75 * ax + 0.25 * bx, 0.75 * az + 0.25 * bz], [0.25 * ax + 0.75 * bx, 0.25 * az + 0.75 * bz]] as [number, number][];
    }), corners[corners.length - 1]];
  const rng = Rng.stream(11, 'riviera-rocks');
  const points: TrackPoint[] = corners.flatMap(([x, z], k) => {
    const [px, pz] = k ? corners[k - 1] : corners[0];
    const n = k ? Math.max(1, Math.round(Math.hypot(x - px, z - pz) / 4)) : 1;
    return Array.from({ length: n }, (_, j) => {
      const f = k ? (j + 1) / n : 0;
      const [qx, qz] = [px + (x - px) * f, pz + (z - pz) * f];
      const u = (k - 1 + f) / (corners.length - 1);
      // Rough all the way, and a ridge of rock across it at each of `ridges` (fractions of the way).
      const ridge = ROCKS.ridges.reduce((m, r) => Math.max(m, ROCKS.ridge * Math.max(0, 1 - Math.abs(u - r) * 40)), 0);
      const lump = k && !(k === corners.length - 1 && j === n - 1) ? ROCKS.lumps * (rng.next() - 0.5) * 2 + ridge : 0;
      return { p: [Math.round(qx * 10) / 10, Math.round((ya + (yb - ya) * Math.max(0, u) + lump) * 100) / 100, Math.round(qz * 10) / 10] as [number, number, number], width: ROCKS.width, lanes: 1, shoulder: ROCKS.shoulder, surface: ROCKS.surface };
    });
  });
  layout.branches!.push({ id: 'rocks', kind: 'shortcut', from: a, to: b, heights: 'own', limit: ROCKS.limit, points });
  // Boulders along both sides just off its verge, solid: thrown off line by a ridge, you hit one.
  // (Never on another road: by its ends the Rocks still run beside the main road.)
  const baked = bakeTrack(layout, surfaces);
  const sp = baked.splines.find((x) => x.id === 'rocks')!;
  const on = newHit();
  for (const side of [-1, 1])
    for (let u = 14 + rng.next() * 4; u < sp.length - 14; u += ROCKS.boulders[0] + rng.next() * (ROCKS.boulders[1] - ROCKS.boulders[0])) {
      const size = 1.4 + rng.next() * 1.4;
      const lateral = side * (ROCKS.width / 2 + ROCKS.shoulder + 0.3 + size / 2 + rng.next() * 0.6);
      sampleAt(sp, u, hit);
      const [x, z] = [hit.cx - hit.tz * lateral, hit.cz + hit.tx * lateral];
      // (Past another road's end, from its end: offRoad. Across rue Haute's first sample's line, far
      // up the hill, boulders went missing off the Rocks' far end.)
      if (baked.splines.some((o) => o !== sp && (projectGlobal(o, x, z, on), offRoad(o, x, z, on) < on.width / 2 + on.shoulder + size + 2))) continue;
      layout.props!.push({ kind: 'rock', spline: 'rocks', s: Math.round(u * 10) / 10, lateral: Math.round(lateral * 10) / 10, size: [Math.round(size * 10) / 10, Math.round(size * 0.7 * 10) / 10, Math.round(size * 10) / 10] });
    }
  layout.walls!.gaps!.push({ spline: 'rocks', s: [0, 1e4], side: 'both' });
}

/**
 * The Sand (COASTAL.md, the cove's cut; the owner, 2026-10-06: in the cove below the Descent):
 * straight along the beach by the waterline instead of inland round the beach club. Off the road
 * coming down into the cove at `from` (x, z on it), along `line` (x, z) on packed sand, back onto
 * the road at `to` before Lighthouse Point. Its own heights, the beach's; `limit` the fastest the
 * AI takes it.
 */
const SAND = { from: [-731, 5], to: [-701, 162], line: [[-738, 30], [-752, 60], [-752, 95], [-738, 120], [-710, 140]] as [number, number][], width: 9, shoulder: 2, y: 3.5, grade: 0.09, bend: 25, limit: undefined as number | undefined, surface: 'beach' };
{
  const hit = newHit();
  const a = Math.round(sAt(SAND.from[0], SAND.from[1]));
  const b = Math.round(sAt(SAND.to[0], SAND.to[1]));
  // (Its ends are the road's: the bake joins it there.)
  let corners: [number, number][] = [...SAND.line];
  // Rounded off at its bends (Chaikin over pieces of 8 m at most, as the Rocks').
  corners = corners.slice(0, -1).flatMap(([ax, az], k) => {
    const [bx, bz] = corners[k + 1];
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 8);
    return Array.from({ length: n }, (_, j) => [ax + ((bx - ax) * j) / n, az + ((bz - az) * j) / n] as [number, number]);
  }).concat([corners[corners.length - 1]]);
  for (let pass = 0; pass < 3; pass++)
    corners = [corners[0], ...corners.slice(0, -1).flatMap(([ax, az], k) => {
      const [bx, bz] = corners[k + 1];
      return [[0.75 * ax + 0.25 * bx, 0.75 * az + 0.25 * bz], [0.25 * ax + 0.75 * bx, 0.25 * az + 0.75 * bz]] as [number, number][];
    }), corners[corners.length - 1]];
  // Down off the road onto the beach and back up at `grade`, from where it leaves the road's verge.
  // The bake gives a branch the road's banked surface while it's on the road's verge and its own
  // heights past that, with nothing between: own heights that didn't start from the road's there
  // left a ledge, and every car flew 40 m off it. So: bake it once, find where the bake hands over
  // at each end and the road's height there, and start the slope from those.
  const flat = corners.map(([x, z]) => ({ p: [x, SAND.y, z] as [number, number, number], width: SAND.width, lanes: 1, shoulder: SAND.shoulder, surface: SAND.surface }));
  const trial = bakeTrack({ ...layout, branches: [...layout.branches!, { id: 'sand', kind: 'shortcut', from: a, to: b, heights: 'own', points: flat }] }, surfaces);
  const sp = trial.splines.find((x) => x.id === 'sand')!;
  let i0 = 0;
  while (i0 + 1 < sp.n && sp.merge[i0 + 1] >= 1) i0++;
  let i1 = sp.n - 1;
  while (i1 - 1 > 0 && sp.merge[i1 - 1] >= 1) i1--;
  const [s0, s1, y0, y1] = [i0 * sp.step, i1 * sp.step, sp.py[i0], sp.py[i1]];
  // From each end: on at the road's height and slope there, bending to `grade` over `bend` m (a
  // vertical curve: going straight from the road's gentle fall to 9% made a crest that threw cars
  // at 170 km/h), down to the beach. The stretches still on the road's verge are the bake's.
  const slope = (i: number, dir: number) => (sp.py[Math.max(0, Math.min(sp.n - 1, i))] - sp.py[Math.max(0, Math.min(sp.n - 1, i - dir * 4))]) / (4 * sp.step);
  const fall = (y: number, g0: number, d: number) => {
    const L = SAND.bend;
    const k = (-SAND.grade - g0) / L;
    return d < L ? y + g0 * d + (k * d * d) / 2 : y + g0 * L + (k * L * L) / 2 - SAND.grade * (d - L);
  };
  const [g0, g1] = [slope(i0, 1), slope(i1, -1)];
  const at = corners.map(([x, z]) => (projectGlobal(sp, x, z, hit), hit.s));
  const points: TrackPoint[] = corners.map(([x, z], k) => {
    const u = at[k];
    const y = u <= s0 || u >= s1 ? sp.py[Math.round(u / sp.step)] : Math.max(SAND.y, fall(y0, g0, u - s0), fall(y1, g1, s1 - u));
    return { p: [Math.round(x * 10) / 10, Math.round(y * 100) / 100, Math.round(z * 10) / 10] as [number, number, number], width: SAND.width, lanes: 1, shoulder: SAND.shoulder, surface: SAND.surface };
  });
  layout.branches!.push({ id: 'sand', kind: 'shortcut', from: a, to: b, heights: 'own', ...(SAND.limit ? { limit: SAND.limit } : {}), points });
  layout.walls!.gaps!.push({ spline: 'sand', s: [0, 1e4], side: 'both' });
  // No rock rail on the beach side between its ends (the branch's own gaps stop 70 m in from each:
  // a few metres of the chicane's corner rails stood alone on the sand inside the loop).
  layout.walls!.gaps!.push({ s: [a, b], side: 'right' });
  // Beach umbrellas along its sea side, out of the way (a car run wide knocks them flying).
  layout.smashables = [...(layout.smashables ?? []), { kind: 'beach-umbrella', spline: 'sand', s: [55, 135], every: 8, side: 1, lateral: 4 }];
}

/**
 * The town (the owner, 2026-10-05: the Riviera, Villefranche from the water): houses stacked up the
 * hill on the town side of the waterfront boulevard, from the end of the Promenade along the Quay to
 * the harbour, and both sides of the Old Town's climb. Each stretch is [from, to] (main distances,
 * through the lap's end if `from` > `to`), the side (+1 right, -1 left, 0 both) and how many rows
 * deep. A house faces the road; it keeps `clear` m off every road's verge (streets and the Basin
 * Road too), off the water and off its neighbours. The sea side stays the sea's.
 */
const TOWN = {
  stretches: [
    // (From the shore road past the Rocks, so none stand by them.)
    [sAt(-610, 300), 270, -1, 5],
    [OLD_TOWN_S[0], OLD_TOWN_S[1], 0, 3],
    // Behind the casino (the owner: "looks a little barren"), the town on up the hill past
    // rue-du-port's loop: rows 6 to 8, facing the sea over it (no taller than 7 storeys).
    [10, 170, -1, 8, 5],
  ] as [number, number, number, number, number?][],
  /** The first row's front this far past the road's verge (a pavement), each row this much further back. */
  front: 5,
  row: 14,
  clear: 3,
  /** Off the Stairs' edge: close (their walls line them; the validator keeps a metre). */
  stairs: 1.05,
  /** Width across its front, depth, and storeys (3.2 m each); the rows further back a storey taller. */
  width: [7, 12],
  depth: [10, 13],
  storeys: [3, 5],
};
/**
 * Houses along the back streets: `road`, its side (-1 its left, uphill from the boulevard; 0 both),
 * rows deep, and their sizes (m across, deep; storeys, the uphill side's a storey taller). (Behind
 * the casino, the town's own rows go on up past rue-du-port: TOWN.stretches.)
 */
const BACK = [
  { road: 'rue-haute', side: 0, rows: 1, width: [7, 12], depth: [10, 13], storeys: [3, 4], stream: 'riviera-haute' },
] as const;
/**
 * The grand casino (the owner, 2026-10-05: Monte Carlo's): on the town side of the boulevard just
 * past the line, in the square rue-du-port loops round. Its middle `s` m along the main road, `w`
 * across its front and `d` deep, `high` to its cornice; its front `front` m past the road's verge,
 * the garden between with a fountain in it (kept clear of houses).
 */
const CASINO = { s: 90, w: 34, d: 22, high: 15, front: 15 };
/**
 * The hotel (the owner, 2026-10-05: "a pull in hotel with a front terrace you drive under"): at the
 * back of rue-des-pins' loop off the boulevard, facing it, `w` across, `d` deep, `high` to its
 * cornice, its front `gap` m past the street's verge. Its terrace runs out over the street on
 * columns just past the street's near verge: `porch` m across, its underside `under` m up.
 */
const HOTEL = { w: 34, d: 16, high: 19.2, gap: 2, porch: 26, under: 6, columns: 4 };
{
  const g = bakeTrack(layout, surfaces);
  const ground = g.ground!;
  // The Stairs' rows first, then each stretch from a stream of its own (the waterfront's houses
  // moving, as the lap grew by the cove, re-rolled the Old Town's after them).
  let rng = Rng.stream(7, 'riviera-town');
  const range = ([lo, hi]: readonly number[]) => lo + (hi - lo) * rng.next();
  const hit = newHit();
  const houses: HouseDef[] = [];
  const contact = newContact();
  /** Whether a footprint (its corners and middle) is clear of every road's verge by `clear`, of the water, and of the houses so far. */
  // The casino first: its block facing the boulevard (left of the lap here), its garden in front.
  sampleAt(g.main, CASINO.s, hit);
  const verge = hit.width / 2 + hit.shoulder;
  const at = (lat: number): [number, number] => [hit.cx + hit.tz * lat, hit.cz - hit.tx * lat];
  const [cx, cz] = at(verge + CASINO.front + CASINO.d / 2);
  const crot = Math.round(Math.atan2(-hit.tz, hit.tx) * 1000) / 1000;
  houses.push({ at: [Math.round(cx * 10) / 10, Math.round(cz * 10) / 10], size: [CASINO.w, CASINO.d, CASINO.high], rot: crot, look: 'casino' });
  // The hotel, at the middle of rue-des-pins' straight back (STREET.depth off the road's middle),
  // its terrace from its front out over the street to just past the street's near verge.
  const pins = STREETS.find(([id]) => id === 'rue-des-pins')!;
  sampleAt(g.main, (pins[1] + pins[2]) / 2, hit);
  const street = STREET.width / 2 + STREET.shoulder;
  const hfront = STREET.depth + street + HOTEL.gap;
  const [hx, hz] = at(hfront + HOTEL.d / 2);
  const hrot = Math.round(Math.atan2(-hit.tz, hit.tx) * 1000) / 1000;
  // Its columns' faces a metre past the street's near verge (the boulevard's side) where it comes
  // furthest out across the terrace (as baked: the smoothed street bows toward the boulevard off its
  // middle, not along STREET.depth).
  const sp = g.splines.find((x) => x.id === 'rue-des-pins')!;
  let near = -Infinity;
  for (let i = 0; i < sp.n; i++) {
    const [dx, dz] = [sp.px[i] - hx, sp.pz[i] - hz];
    const lx = dx * Math.cos(hrot) - dz * Math.sin(hrot);
    const lz = dx * Math.sin(hrot) + dz * Math.cos(hrot);
    if (Math.abs(lx) < HOTEL.porch / 2 + 2 && lz > 0) near = Math.max(near, lz + sp.width[i] / 2 + sp.shoulder[i]);
  }
  // (A column's middle stands COLUMN + 0.3 in from the terrace's front: porchColumns.)
  const porch = { depth: Math.round((near + 1 + COLUMN - HOTEL.d / 2 + COLUMN + 0.3) * 10) / 10, width: HOTEL.porch, high: HOTEL.under, columns: HOTEL.columns };
  houses.push({ at: [Math.round(hx * 10) / 10, Math.round(hz * 10) / 10], size: [HOTEL.w, HOTEL.d, HOTEL.high], rot: hrot, look: 'hotel', porch });
  // The beach club (COVE), inside the chicane, facing the sea: a low block for now (its pool, terrace
  // and jetty come with the look).
  houses.push({ at: COVE.inside, size: [26, 14, 5.5], rot: -Math.PI / 2 });
  // (No house under its terrace: the hotel's box, out over its porch, as one.)
  const [px, pz] = at(hfront - porch.depth / 2);
  const terrace = { at: [px, pz] as [number, number], size: [HOTEL.porch, porch.depth], rot: hrot };
  sampleAt(g.main, CASINO.s, hit);
  const [fx, fz] = at(verge + CASINO.front / 2 + 1);
  const garden: [number, number, number] = [fx, fz, CASINO.front / 2 + 2];
  layout.landmarks = [...(layout.landmarks ?? []).filter((m) => m.kind !== 'fountain'), { kind: 'fountain', at: [Math.round(fx * 10) / 10, Math.round(fz * 10) / 10], rot: crot, r: 0, params: { r: 4, ring: 0 } }];
  const free = (x: number, z: number, w: number, d: number, rot: number) => {
    const fx = Math.sin(rot);
    const fz = Math.cos(rot);
    for (const [a, b] of [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const px = x + (a * w * fz) / 2 + (b * d * fx) / 2;
      const pz = z - (a * w * fx) / 2 + (b * d * fz) / 2;
      if (ground.coast(px, pz) < 6 || ground.height(px, pz) < SEA + 1.5) return false;
      for (const sp of g.splines) {
        projectGlobal(sp, px, pz, hit);
        // (The Stairs run between the houses' walls: off them is into one.)
        // (Across the road, or past an open road's end, from its end: across its last sample's line
        // reached far past it, and the Rocks' end kept houses off the hill well away from them.)
        if (offRoad(sp, px, pz, hit) < hit.width / 2 + hit.shoulder + (sp.id.startsWith('stairs') ? TOWN.stairs : TOWN.clear)) return false;
      }
    }
    // (Not in the casino's garden.)
    if (Math.hypot(x - garden[0], z - garden[1]) < garden[2] + Math.max(w, d) / 2) return false;
    // (Terraced: side by side is fine, overlapping isn't. Box against box, a hair smaller.)
    if (obbOverlap(x, z, rot, w / 2 - 0.2, d / 2 - 0.2, terrace.at[0], terrace.at[1], terrace.rot, terrace.size[0] / 2, terrace.size[1] / 2, contact)) return false;
    return houses.every((h) => !obbOverlap(x, z, rot, w / 2 - 0.2, d / 2 - 0.2, h.at[0], h.at[1], h.rot, h.size[0] / 2 - 0.2, h.size[1] / 2 - 0.2, contact));
  };
  // First a row along each side of the Stairs, facing them, their walls at the steps' edge.
  for (const sp of g.splines.filter((x) => x.id.startsWith('stairs')))
    for (const sd of [-1, 1])
      for (let u = 6; u < sp.length - 6; ) {
        const w = range(TOWN.width);
        const d = range(TOWN.depth);
        sampleAt(sp, u + w / 2, hit);
        const off = hit.width / 2 + hit.shoulder + TOWN.stairs + 0.2 + d / 2;
        const x = hit.cx - hit.tz * off * sd;
        const z = hit.cz + hit.tx * off * sd;
        const rot = Math.atan2(hit.tz * sd, -hit.tx * sd);
        // (Where one doesn't fit, a metre on: packed in wherever there's room.)
        if (!free(x, z, w, d, rot)) {
          u += 1;
          continue;
        }
        const storeys = Math.round(range(TOWN.storeys));
        houses.push({ at: [Math.round(x * 10) / 10, Math.round(z * 10) / 10], size: [Math.round(w * 10) / 10, Math.round(d * 10) / 10, Math.round(storeys * 3.2 * 10) / 10], rot: Math.round(rot * 1000) / 1000 });
        u += w + range([0.3, 1.5]);
      }
  for (const [k, [from, to, side, rows, first = 0]] of TOWN.stretches.entries()) {
    rng = Rng.stream(7, `riviera-town-${k}`);
    const len = (to - from + L) % L;
    for (const sd of side ? [side] : [-1, 1]) {
      for (let row = first; row < rows; row++) {
        for (let u = 0; u < len; ) {
          const w = range(TOWN.width);
          const d = range(TOWN.depth);
          sampleAt(g.main, (from + u + w / 2) % L, hit);
          const off = hit.width / 2 + hit.shoulder + TOWN.front + row * TOWN.row + d / 2 + range([0, 2]);
          const x = hit.cx - hit.tz * off * sd;
          const z = hit.cz + hit.tx * off * sd;
          // Facing the road.
          const rot = Math.atan2(hit.tz * sd, -hit.tx * sd);
          // (Its storeys drawn whether it fits or not: drawn only for one that fits, any change to
          // what fits re-laid every house after it in its stretch.)
          const storeys = Math.min(first ? 7 : Infinity, Math.round(range(TOWN.storeys)) + row);
          if (free(x, z, w, d, rot)) {
            houses.push({ at: [Math.round(x * 10) / 10, Math.round(z * 10) / 10], size: [Math.round(w * 10) / 10, Math.round(d * 10) / 10, Math.round(storeys * 3.2 * 10) / 10], rot: Math.round(rot * 1000) / 1000 });
          }
          u += w + range([0.3, 1.5]);
        }
      }
    }
  }
  // Along the back streets, facing them, each from a stream of its own: rue Haute's both sides
  // (the town's back row below it, a row up the hill above, a storey taller).
  for (const { road, side, rows, width, depth, storeys, stream } of BACK) {
    rng = Rng.stream(7, stream);
    const sp = g.splines.find((x) => x.id === road)!;
    for (const sd of side ? [side] : [-1, 1])
      for (let row = 0; row < rows; row++)
        for (let u = 8; u < sp.length - 8; ) {
          const w = range(width);
          const d = range(depth);
          sampleAt(sp, u + w / 2, hit);
          const off = hit.width / 2 + hit.shoulder + TOWN.front + row * TOWN.row + d / 2 + range([0, 1.5]);
          const x = hit.cx - hit.tz * off * sd;
          const z = hit.cz + hit.tx * off * sd;
          const rot = Math.atan2(hit.tz * sd, -hit.tx * sd);
          const n = Math.round(range(storeys)) + row + (sd < 0 ? 1 : 0);
          if (free(x, z, w, d, rot)) {
            houses.push({ at: [Math.round(x * 10) / 10, Math.round(z * 10) / 10], size: [Math.round(w * 10) / 10, Math.round(d * 10) / 10, Math.round(n * 3.2 * 10) / 10], rot: Math.round(rot * 1000) / 1000 });
          }
          u += w + range([0.3, 1.5]);
        }
  }
  layout.houses = houses;
}

/**
 * Landmarks you see the lap by: the lighthouse on its knoll inside Lighthouse Point's loop (`h` m
 * tall, seen from the Descent's switchbacks above), and the fort on the mountain's top (the owner:
 * "a little empty up there"; Villefranche's Fort du Mont Alban), at the highest ground near `near`.
 */
const LANDMARKS = { light: { h: 30, scale: 1.5 }, fort: { near: [-520, -700], look: 60, size: 56 } };
/**
 * The marina (COASTAL's look: yachts in the harbour): pontoons out from the harbour's west and east
 * sides at these z, each `length` m out from `back` m inside the waterline, with boats along both
 * sides; the channel between them clear for the drawbridge's boat.
 */
const MARINA = { z: [222, 276], length: 46, back: 5 };

function pontoons(ground: ReturnType<typeof bakeTrack>['ground'] & {}): LandmarkDef[] {
  const out: LandmarkDef[] = [];
  let seed = 1;
  for (const z of MARINA.z)
    for (const side of [-1, 1]) {
      // From the harbour's side in to its waterline, then back onto the quay a little.
      let x = side < 0 ? HARBOUR.west - 10 : HARBOUR.east + 10;
      while (ground.height(x, z) > SEA + 0.2) x -= side;
      x += side * MARINA.back;
      out.push({ kind: 'pontoon', at: [Math.round(x * 10) / 10, z], rot: side < 0 ? Math.PI / 2 : -Math.PI / 2, r: 0, params: { length: MARINA.length, seed: seed++ } });
    }
  return out;
}
{
  const ground = bakeTrack(layout, surfaces).ground!;
  let top = [LANDMARKS.fort.near[0], LANDMARKS.fort.near[1]];
  for (let x = -LANDMARKS.fort.look; x <= LANDMARKS.fort.look; x += 5)
    for (let z = -LANDMARKS.fort.look; z <= LANDMARKS.fort.look; z += 5) {
      const [px, pz] = [LANDMARKS.fort.near[0] + x, LANDMARKS.fort.near[1] + z];
      if (ground.height(px, pz) > ground.height(top[0], top[1])) top = [px, pz];
    }
  layout.landmarks = [
    ...(layout.landmarks ?? []),
    { kind: 'lighthouse', at: [POINT.light[0], POINT.light[1]], r: 10, params: { h: LANDMARKS.light.h, scale: LANDMARKS.light.scale } },
    { kind: 'fort', at: [top[0], top[1]], r: LANDMARKS.fort.size / 2 + 20, params: { size: LANDMARKS.fort.size } },
    ...pontoons(ground),
  ];
}

/**
 * The Descent's hillside (the owner, 2026-10-05: "you can jump off course and cut down, so maybe
 * rocks, bushes and some other obstacles would make this harder"): between and round its rows,
 * where a car leaves the road to drop to the row below. Solid limestone rocks you wreck on, and
 * bushes (smashables on open ground) that cost a fifth of your speed. Scattered on a jittered grid
 * `every` m, a rock or a bush with these chances, `clear` m past every road's verge (the AI never
 * meets them), not on the steep banks (`steep`, rise over run: rock faces there), and off the trees.
 */
const HILLSIDE = { x: [DESCENT.west - 30, DESCENT.east + 30], z: [DESCENT.z - 20, DESCENT.z + DESCENT.step * (DESCENT.rows - 1) + 20], every: 8, rock: 0.07, bush: 0.14, size: [1.3, 2.8], clear: 4, steep: 0.8, trees: 3 };
{
  const g = bakeTrack(layout, surfaces);
  const ground = g.ground!;
  const pines = g.pines!;
  const rng = Rng.stream(11, 'riviera-hillside');
  const on = newHit();
  const bushes: [number, number][] = [];
  const placed: [number, number, number][] = [];
  let rocks = 0;
  const m = g.main;
  // How far (x, z) is from a road's middle where it's nearest (not its lateral: off a street's end
  // that's across the street's line, however far away).
  const near = (x: number, z: number) => g.splines.some((sp) => (projectGlobal(sp, x, z, on), Math.hypot(x - on.cx, z - on.cz) < on.width / 2 + on.shoulder + HILLSIDE.clear + HILLSIDE.size[1]));
  for (let z = HILLSIDE.z[0]; z < HILLSIDE.z[1]; z += HILLSIDE.every)
    for (let x = HILLSIDE.x[0]; x < HILLSIDE.x[1]; x += HILLSIDE.every) {
      let [px, pz] = [x + rng.next() * HILLSIDE.every, z + rng.next() * HILLSIDE.every];
      const roll = rng.next();
      const size = HILLSIDE.size[0] + rng.next() * (HILLSIDE.size[1] - HILLSIDE.size[0]);
      if (roll >= HILLSIDE.rock + HILLSIDE.bush) continue;
      // A rock is a prop by the main road, placed at one of its samples and out across it (as the
      // bake places it): moved there first, then checked where it'll stand.
      const rock = roll < HILLSIDE.rock;
      let s = 0;
      let lateral = 0;
      if (rock) {
        projectGlobal(m, px, pz, on);
        const i = Math.round(on.s / m.step);
        s = i * m.step;
        lateral = Math.round(((px - m.px[i]) * -m.tz[i] + (pz - m.pz[i]) * m.tx[i]) * 10) / 10;
        [px, pz] = [m.px[i] - m.tz[i] * lateral, m.pz[i] + m.tx[i] * lateral];
      }
      const e = ground.cell;
      if (Math.hypot(ground.height(px + e, pz) - ground.height(px - e, pz), ground.height(px, pz + e) - ground.height(px, pz - e)) / (2 * e) > HILLSIDE.steep) continue;
      if (near(px, pz)) continue;
      let tree = false;
      pines.near(px, pz, (k) => (tree ||= Math.hypot(pines.x[k] - px, pines.z[k] - pz) < HILLSIDE.trees + size / 2));
      if (tree || (layout.landmarks ?? []).some((l) => Math.hypot(l.at[0] - px, l.at[1] - pz) < l.r + size)) continue;
      // Nor in another (spots in neighbouring cells can land together: bushes grew out of rocks).
      if (placed.some(([qx, qz, qr]) => Math.hypot(qx - px, qz - pz) < qr + (rock ? size / 2 : 1.1) + 1)) continue;
      placed.push([px, pz, rock ? size / 2 : 1.1]);
      if (!rock) {
        bushes.push([Math.round(px * 10) / 10, Math.round(pz * 10) / 10]);
        continue;
      }
      layout.props!.push({ kind: 'rock', s, lateral, size: [Math.round(size * 10) / 10, Math.round(size * 0.7 * 10) / 10, Math.round(size * 10) / 10] });
      rocks++;
    }
  layout.smashables = [...(layout.smashables ?? []), { kind: 'bush', s: [0, 0], every: 0, at: bushes }];
  console.log(`the Descent's hillside: ${rocks} rocks, ${bushes.length} bushes`);
}

mkdirSync(DIR, { recursive: true });
// Rue Haute last of the branches: a branch's index is in the AI's roll for whether it takes a cut
// (racer.ts), so one added among them re-rolled the rest (the Stairs went untaken).
layout.branches!.push(...layout.branches!.splice(layout.branches!.findIndex((b) => b.id === 'rue-haute'), 1));
writeFileSync(`${DIR}/riviera.track.json`, `${JSON.stringify(layout)}\n`);
writeFileSync(`${DIR}/map.json`, `${JSON.stringify({ id: 'coastal', name: 'Riviera', layouts: ['riviera'], palette: 'riviera', sunset: 'riviera-sunset', weather: ['clear', 'rain', 'shower', 'rare'] })}\n`);
const track = bakeTrack(layout, surfaces);
console.log(`coastal/riviera: ${Math.round(track.main.length)} m, ${pts.length} points, ground ${track.ground!.nx}×${track.ground!.nz}, bridge deck ${deck.join('–')} m (the drawbridge ${mid - width / 2}–${mid + width / 2} m), the Rock Tunnel ${tunnel.join('–')} m, the Basin Road ${Math.round(track.splines[1].length)} m (${layout.branches![0].from}–${layout.branches![0].to} m), ${layout.houses!.length} houses`);
