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
import type { TrackLayout, TrackPoint } from '../src/core/content';
import { bakeTrack } from '../src/core/track/bake';
import { hillHeight } from '../src/core/track/features/hills';
import { newHit, sampleAt } from '../src/core/track/query';
import surfaces from '../content/surfaces.json';
import { type Crest, type Node, lapPoints, onLap } from './lib/lap';

const DIR = 'content/maps/coastal';

const node = (w: number, surface: string, shoulder: number, verge?: string) => (x: number, z: number, y: number, r?: number, more: Partial<Node> = {}): Node => ({ x, z, y, w, r, surface, shoulder, verge, ...more });
/** The Quay, the bridge and the Promenade: wide. */
const Q = node(16, 'asphalt', 3);
/** The home straight, the Promenade's end onto the Quay: wider, for its traffic both ways (two-way on 16 m, the AI was boxed in). */
const H = node(20, 'asphalt', 3);
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

const nodes: Node[] = [
  // The Quay: east along the harbour front to the bridge.
  H(-210, 322, 3),
  H(20, 322, 3.5),
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
  { x: 294, z: -170, h: 100, r: 110 },
  { x: 256, z: -229, h: 104, r: 110 },
  { x: 225, z: -290, h: 110, r: 110 },
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
const RAILS = { radius: 110, run: 15, from: [395, 85], to: [-755, 255] };
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
  pines: { kind: 'tropic', seed: 41, spacing: 9, clear: 8, thicken: 30, density: 0.25, glade: 80 },
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
const STREETS: [string, number, number, 1 | -1][] = [
  // Round the line on the home straight, from the end of the Promenade onto the Quay: the lido's car
  // park and the harbour's on the sea side, two streets up into the town. Straight between them (the
  // traffic once ran through the Promenade's kink, and the AI's line there cut into the oncoming
  // lane: head-ons; MAPS.md's rule, no traffic through fast bends); short of the Basin Road's turn.
  // (The Old Town's come with its houses, COASTAL's step 6: its road bends too much for loops.)
  ['lido', 4775, 4895, 1],
  ['quai-sud', 30, 150, 1],
  ['rue-du-port', 30, 150, -1],
  ['rue-des-pins', 4775, 4895, -1],
];
/** How far off the main road's middle a street runs (m), how wide it is, and the traffic on it. */
const STREET = { depth: 32, width: 8, shoulder: 1.5, speed: 14, density: 8 };
{
  const g = bakeTrack(layout, surfaces);
  const hit = newHit();
  for (const [id, from, to, side] of STREETS) {
    // Out from just past the main road's verge 30 m along, across to `depth`, along, and back in.
    const at = (s: number, lat: number): [number, number] => (sampleAt(g.main, s, hit), [hit.cx - hit.tz * lat * side, hit.cz + hit.tx * lat * side]);
    const edge = () => hit.width / 2 + hit.shoulder + STREET.width / 2 + 1;
    sampleAt(g.main, from + 30, hit);
    const near = edge();
    const corners: [number, number][] = [at(from + 30, near), at(from + 55, STREET.depth)];
    for (let s = from + 80; s < to - 55; s += 25) corners.push(at(s, STREET.depth));
    corners.push(at(to - 55, STREET.depth));
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
      for (; left < len; left += 6) points.push(streetPoint(ax + ((bx - ax) * left) / len, az + ((bz - az) * left) / len));
      left -= len;
    }
    points.push(streetPoint(...line[line.length - 1]));
    function streetPoint(x: number, z: number): TrackPoint {
      const s = sAt(x, z);
      sampleAt(g.main, s, hit);
      return { p: [Math.round(x * 10) / 10, Math.round(hit.cy * 10) / 10, Math.round(z * 10) / 10], width: STREET.width, lanes: 2, shoulder: STREET.shoulder, surface: 'asphalt' };
    }
    layout.branches!.push({ id, from, to, kind: 'street', points });
    layout.walls!.gaps!.push({ spline: id, s: [0, 1e4], side: 'both' });
  }
  // A lane each way: with the lap on the right (in by the first street, out by the second),
  // against it on the left.
  const lane = (dir: 1 | -1, streets: string[]) => ({ pos: dir * 0.5, dir, speed: STREET.speed, streets });
  layout.traffic = { density: STREET.density, lanes: [lane(1, ['lido', 'quai-sud']), lane(-1, ['rue-du-port', 'rue-des-pins'])] };
}

mkdirSync(DIR, { recursive: true });
writeFileSync(`${DIR}/riviera.track.json`, `${JSON.stringify(layout)}\n`);
writeFileSync(`${DIR}/map.json`, `${JSON.stringify({ id: 'coastal', name: 'Coastal', layouts: ['riviera'], palette: 'tropic', sunset: 'sunset', weather: ['clear', 'rain', 'shower', 'rare'], experimental: true })}\n`);
const track = bakeTrack(layout, surfaces);
console.log(`coastal/riviera: ${Math.round(track.main.length)} m, ${pts.length} points, ground ${track.ground!.nx}×${track.ground!.nz}, bridge deck ${deck.join('–')} m (the drawbridge ${mid - width / 2}–${mid + width / 2} m), the Rock Tunnel ${tunnel.join('–')} m, the Basin Road ${Math.round(track.splines[1].length)} m (${layout.branches![0].from}–${layout.branches![0].to} m)`);
