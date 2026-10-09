// Generator for the getaway's city (docs/CHASE_MODE.md): San Francisco-ish, not a grid. Built on
// Caldera's open ground, laid out in world space; north is -z. In the lobby (alpha-1.44), or from a link,
// `?mode=race&map=heist/city&seats=p`. A race of your own on it is a getaway; online, a race round the loop.
//
// Round the outside, the main road (a loop, traffic both ways):
//   Bay Street        along the north
//   The Embarcadero   down the waterfront on the east, curving, past the Ferry Building
//   The Freeway       west along the south, up on a deck, ramps down at either end; under it, a
//                     street along its foot
//   Van Ness          north up the west side
// Inside, districts, each a grid of its own at its own angle, built up to the pavement:
//   North of Market   one grid, square to the compass: the Financial District (towers, the Bank)
//                     in the east, Chinatown (narrow streets, alleys everywhere) in the middle, the
//                     Hills (Nob, Russian, Telegraph) in the west and north
//   SoMa              south of Market, its grid turned to Market's line: big blocks, warehouses
//   The Mission       south-west, its grid turned another way, a hill at Dolores
// And the streets that cut across them: Market Street corner to corner, from Van Ness to the
// Ferry Building (every grid's streets end on it: odd crossings, five ways where two grids meet
// it), and Columbus Avenue across North of Market.
//
// The city's ground (features/city.ts) is paved, with the hills under it and every crossing level
// (the crest at each, a hill jump); the buildings are houses (solid). The cops find their way by
// the layout's `getaway` streets: every street as a line, a node wherever two cross.
//
//   bun tools/gen-heist.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import type { CityDef, GetawayDef, Hill, HouseDef, PadDef, RollingDef, TrackLayout } from '../src/core/content';
import { hash01, Rng } from '../src/core/rng';
import { bakeTrack } from '../src/core/track/bake';
import { cityHeight, insideLoop } from '../src/core/track/features/city';
import { rollingSwell } from '../src/core/track/features/rolling';
import { SEAWALL_FACE } from '../src/core/track/features/seawall';
import { newHit, projectGlobal } from '../src/core/track/query';
import { Streets } from '../src/core/world/streets';
import surfaces from '../content/surfaces.json';
import { type Node, lapPoints, r1 } from './lib/lap';

const DIR = 'content/maps/heist';
type P = [number, number];
type Line = { a: P; b: P; width: number; name: string; through?: boolean };

// ---- The main road ----

/** The Freeway: along z, up on its deck between `deck` (x, west to east), `y` m up, its ramps down to the ground at `foot`. */
const FREEWAY = { z: 470, deck: [-330, 330] as P, foot: [-395, 385] as P, y: 11, width: 18 };
const road = (w: number) => (x: number, z: number, r?: number, y = 0): Node => ({ x, z, y, w, r, surface: 'asphalt', shoulder: 3, bank: 0, lanes: 4 });
const BAY = road(16);
const EMBARCADERO = road(20);
const FWY = road(FREEWAY.width);
const VAN_NESS = road(18);
// Clockwise from the start on Bay Street, heading east: the city on the right.
const nodes: Node[] = [
  BAY(0, -460),
  BAY(420, -460, 70),
  EMBARCADERO(590, -250, 120),
  EMBARCADERO(575, 60, 200),
  EMBARCADERO(600, 280, 150),
  EMBARCADERO(470, FREEWAY.z, 70),
  FWY(FREEWAY.foot[1], FREEWAY.z),
  FWY(250, FREEWAY.z, undefined, FREEWAY.y),
  FWY(-250, FREEWAY.z, undefined, FREEWAY.y),
  FWY(FREEWAY.foot[0], FREEWAY.z),
  VAN_NESS(-560, FREEWAY.z, 70),
  VAN_NESS(-560, -460, 70),
];
const mainPoints = lapPoints(nodes, [], { bankFor: () => 0, sigma: { height: 30, width: 10, bank: 12 } });

// ---- The city's lines ----

/** Market Street: from Van Ness to the Ferry Building on the Embarcadero. */
const MARKET: Line = { a: [-560, 300], b: [583, -60], width: 22, name: 'Market Street' };
/** Columbus Avenue: across North of Market, from near Market up to Bay Street. */
const COLUMBUS: Line = { a: [215, -10], b: [-140, -460], width: 16, name: 'Columbus Avenue' };
/** Where SoMa ends and the Mission starts: a street from Market south to the Freeway. */
const DIVISION: Line = { a: [-134, 158], b: [-215, FREEWAY.z], width: 16, name: 'Division Street' };
/** Under the Freeway, along its foot (the deck's ground). */
const UNDER: Line = { a: [FREEWAY.deck[0], FREEWAY.z], b: [FREEWAY.deck[1], FREEWAY.z], width: 14, name: 'under the Freeway' };

/** Which side of a line (x, z) is (+ to its right, going from a to b), and how far (m). */
const side = (l: Line, x: number, z: number) => {
  const [ax, az] = l.a;
  const [bx, bz] = l.b;
  const len = Math.hypot(bx - ax, bz - az);
  return ((x - ax) * -(bz - az) + (z - az) * (bx - ax)) / len;
};
/** How far (x, z) is from a line's segment. */
const off = (l: Line, x: number, z: number) => {
  const [ax, az] = l.a;
  const [bx, bz] = l.b;
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
};
// (Market's start is on Van Ness and its end at the Ferry Building: its line is where it runs. The
// Division's top is north of Market, so its line crosses it.)
const northOfMarket = (x: number, z: number) => side(MARKET, x, z) < 0;
const westOfDivision = (x: number, z: number) => side(DIVISION, x, z) > 0;

/**
 * A district: its grid (lines `u` m along `angle` from `origin`, and `v` m across it), what its
 * blocks are built up with, and where it is. Its streets are `street` m wide; a share `alleys` of
 * its blocks have an alley through them, `alley` m wide; its buildings' frontages (m) and storeys
 * are ranges.
 */
interface District {
  name: string;
  origin: P;
  angle: number;
  u: number[];
  v: number[];
  street: number;
  alley: number;
  alleys: number;
  lot: P;
  storeys: P;
  /** How its buildings are drawn (the skin's city looks: render/skins/greybox/heist.ts). */
  look: string;
  /** A share of its buildings with a neon sign over the pavement, and the words they say. */
  neon: { share: number; words: string[] };
  /** What stands along its pavements: a street tree every `trees` m (0: none), a shrub by a door every `shrubs` m. */
  green: { trees: number; shrubs: number };
  in: (x: number, z: number) => boolean;
  /** Its grid lines' names, as `u` and `v` ('': none), on its crossings' street signs (a grid's first district's). */
  names?: { u: string[]; v: string[] };
  /** Its grid's streets run over all of this (districts sharing a grid share it), not just the district. */
  grid?: (x: number, z: number) => boolean;
}
/** Evenly spaced from `from` by `step`, `n` of them. */
const every = (from: number, step: number, n: number) => Array.from({ length: n }, (_, k) => from + k * step);
const MARKET_ANGLE = Math.atan2(MARKET.b[1] - MARKET.a[1], MARKET.b[0] - MARKET.a[0]);

/** North of Market's grid (square to the compass): its lines, its districts by x. */
// (Its outer lines past the main road, so the blocks along the edge are built up to it too.)
const NORTH_X = [-580, -490, -405, -320, -235, -150, -78, -8, 62, 132, 192, 252, 312, 372, 432, 492, 548, 640];
const NORTH_Z = [-480, -385, -305, -230, -160, -95, -30, 35, 100, 165, 230, 300];
const DISTRICTS: District[] = [
  {
    name: 'the Financial District',
    origin: [0, 0],
    angle: 0,
    u: NORTH_X,
    v: NORTH_Z,
    street: 14,
    alley: 7,
    alleys: 0.3,
    lot: [18, 34],
    storeys: [9, 23],
    look: 'tower',
    neon: { share: 0.12, words: ['HOTEL', 'BAR', 'DELI', 'CAFE', 'DINER'] },
    green: { trees: 0, shrubs: 40 },
    in: (x, z) => northOfMarket(x, z) && x > 230,
    grid: northOfMarket,
    // (San Francisco's, west to east and north to south, a few left out: the city's smaller.)
    names: {
      u: ['', 'POLK ST', 'LARKIN ST', 'HYDE ST', 'LEAVENWORTH ST', 'JONES ST', 'MASON ST', 'STOCKTON ST', 'GRANT AV', 'KEARNY ST', 'MONTGOMERY ST', 'SANSOME ST', 'BATTERY ST', 'FRONT ST', 'DAVIS ST', 'DRUMM ST', 'STEUART ST', ''],
      v: ['', 'CHESTNUT ST', 'LOMBARD ST', 'BROADWAY', 'JACKSON ST', 'CLAY ST', 'CALIFORNIA ST', 'BUSH ST', 'SUTTER ST', 'POST ST', 'GEARY ST', "O'FARRELL ST"],
    },
  },
  {
    name: 'Chinatown',
    origin: [0, 0],
    angle: 0,
    u: NORTH_X,
    v: NORTH_Z,
    street: 10,
    alley: 6,
    alleys: 0.9,
    lot: [8, 14],
    storeys: [3, 6],
    look: 'chinatown',
    neon: { share: 0.45, words: ['NOODLES', 'DIM SUM', 'TEA', 'JADE', 'LUCKY', 'BAR', 'HOTEL', 'OPEN', 'DRAGON', 'GIFTS'] },
    green: { trees: 0, shrubs: 0 },
    in: (x, z) => northOfMarket(x, z) && x > -60 && x <= 230,
    grid: northOfMarket,
  },
  {
    name: 'the Hills',
    origin: [0, 0],
    angle: 0,
    u: NORTH_X,
    v: NORTH_Z,
    street: 14,
    alley: 6,
    alleys: 0.4,
    lot: [10, 16],
    storeys: [3, 5],
    look: 'victorian',
    neon: { share: 0.06, words: ['CAFE', 'BAR', 'LIQUOR', 'BOOKS'] },
    green: { trees: 26, shrubs: 18 },
    in: (x, z) => northOfMarket(x, z) && x <= -60,
    grid: northOfMarket,
  },
  {
    name: 'SoMa',
    origin: MARKET.b,
    angle: MARKET_ANGLE,
    // (Along Market, back from the Ferry Building; across it, south.)
    u: every(-1300, 125, 12),
    v: every(-60, 92, 8),
    street: 16,
    alley: 8,
    alleys: 0.45,
    lot: [24, 48],
    storeys: [2, 4],
    look: 'warehouse',
    neon: { share: 0.18, words: ['CLUB', 'BAR', 'JAZZ', 'PAWN', 'TATTOO', 'MOTEL', 'DINER'] },
    green: { trees: 22, shrubs: 0 },
    in: (x, z) => !northOfMarket(x, z) && !westOfDivision(x, z),
    // (Along Market back from the Ferry Building, the numbered streets; across it, south.)
    names: {
      u: ['9TH ST', '8TH ST', '7TH ST', '6TH ST', '5TH ST', '4TH ST', '3RD ST', '2ND ST', '1ST ST', 'BEALE ST', 'SPEAR ST', ''],
      v: ['', 'MISSION ST', 'HOWARD ST', 'FOLSOM ST', 'HARRISON ST', 'BRYANT ST', 'BRANNAN ST', 'TOWNSEND ST'],
    },
  },
  {
    name: 'the Mission',
    origin: [-380, 380],
    angle: 0.12,
    u: every(-260, 82, 9),
    v: every(-300, 70, 8),
    street: 14,
    alley: 6,
    alleys: 0.5,
    lot: [9, 14],
    storeys: [2, 4],
    look: 'victorian',
    neon: { share: 0.25, words: ['TAQUERIA', 'CAFE', 'BAR', 'LIQUOR', 'TACOS', 'BAKERY'] },
    green: { trees: 16, shrubs: 22 },
    in: (x, z) => !northOfMarket(x, z) && westOfDivision(x, z),
    names: {
      u: ['CHURCH ST', 'DOLORES ST', 'GUERRERO ST', 'VALENCIA ST', 'MISSION ST', 'CAPP ST', 'S VAN NESS AV', 'SHOTWELL ST', 'FOLSOM ST'],
      v: ['14TH ST', '15TH ST', '16TH ST', '17TH ST', '18TH ST', '19TH ST', '20TH ST', '21ST ST'],
    },
  },
];

/** The hills under the city (as GroundDef's): Nob Hill, Russian Hill, Telegraph Hill, and Dolores in the Mission. */
const HILLS: Hill[] = [
  { x: -200, z: -190, h: 30, r: 210 },
  { x: -390, z: -300, h: 34, r: 165 },
  { x: 150, z: -385, h: 22, r: 110 },
  { x: -420, z: 340, h: 16, r: 150 },
];

/** Pavement between a street's edge and the buildings (m); between two buildings in a row. */
const SIDEWALK = 3;
const GAP = 0.8;
/** The Bank: the corner of North of Market nearest here, its block's building on the street out front, this many storeys. */
const BANK = { near: [320, -95] as P, storeys: 16 };
/**
 * Broadway: North of Market's grid line at `z`, wider than the rest (`width` m), and between
 * `strip` (x) its clubs, bars and strip joints, every one lit up (look 'broadway': a marquee over its door, neon
 * over that), from Chinatown's west edge on past Columbus into the Financial District.
 */
const BROADWAY = {
  z: -230,
  width: 22,
  strip: [-70, 340] as P,
  storeys: [3, 6] as P,
  // (The owner, 2026-10-08: "some light XXX themes": North Beach's strip clubs, by their signs.)
  words: ['XXX', 'GIRLS', 'LIVE GIRLS', 'PEEP SHOW', 'ADULT', 'BURLESQUE', 'XXX', 'GO GO', 'CABARET', 'JAZZ', 'COMEDY', 'LOUNGE', 'BOOKS', 'BAR'],
};
/** Grant Avenue: Chinatown's main street, North of Market's line at `x`; the Dragon Gate across its south end, `gate` m north of the crossing at `z`. */
const GRANT = { x: 62, z: 35, gate: 22, post: 1.4, high: 11 };

// ---- Baked once without the city, to place things by the main road ----

const layout: TrackLayout = {
  id: 'heist-city',
  name: 'The City',
  main: { points: mainPoints },
  branches: [],
  zones: [],
  walls: { gaps: [] },
  ramps: [],
  checkpoints: 'auto',
  props: [],
  takedownSpots: [],
  shoulderSurface: 'sidewalk',
};
const bare = bakeTrack(layout, surfaces);
const main = bare.main;
const L = main.length;
const hit = newHit();
/** The main road's s at the Freeway's deck's ends and its feet. */
const sAt = (x: number, z: number) => (projectGlobal(main, x, z, hit), hit.s);
const DECK_S: P = [sAt(FREEWAY.deck[1], FREEWAY.z), sAt(FREEWAY.deck[0], FREEWAY.z)];
const FOOT_S: P = [sAt(FREEWAY.foot[1], FREEWAY.z), sAt(FREEWAY.foot[0], FREEWAY.z)];
/** How far (x, z) is inside the main road's edge (its shoulder's, m): negative on it or outside it. */
const inside = (x: number, z: number) => {
  projectGlobal(main, x, z, hit, 0);
  // (The city's on the right.)
  return hit.lateral - hit.width / 2 - hit.shoulder;
};
/** The main road's middle, as a closed loop of points every few metres; and its outer edge, the city's outline. */
const loop: P[] = [];
const outline: P[] = [];
for (let i = 0; i < main.n; i += 2) {
  loop.push([main.px[i], main.pz[i]]);
  const o = main.width[i] / 2 + main.shoulder[i];
  outline.push([r1(main.px[i] + main.tz[i] * o), r1(main.pz[i] - main.tx[i] * o)]);
}
const inCity = (x: number, z: number) => insideLoop(loop, x, z);

// ---- The streets: each district's grid, clipped to the district ----

/** A district's grid line, through `at` along `dir` (unit), cut to the runs of it inside the district; each run's ends a little past its edge, so it meets what bounds it. */
function clip(d: District, at: P, dir: P, width: number, name: string): Line[] {
  const out: Line[] = [];
  const reach = 1600;
  const step = 2;
  let run: number | null = null;
  const pt = (t: number): P => [at[0] + dir[0] * t, at[1] + dir[1] * t];
  const ok = (t: number) => {
    const [x, z] = pt(t);
    return inCity(x, z) && (d.grid ?? d.in)(x, z);
  };
  for (let t = -reach; t <= reach + step; t += step) {
    const yes = t <= reach && ok(t);
    if (yes && run === null) run = t;
    if (!yes && run !== null) {
      const end = t - step;
      // (Long enough to be a street: a block's worth.)
      if (end - run > 30) out.push({ a: pt(run - 4), b: pt(end + 4), width, name });
      run = null;
    }
  }
  return out;
}

const streets: Line[] = [];
const gridsDone = new Set<unknown>();
for (const d of DISTRICTS) {
  // (A grid's streets once, whichever of its districts comes first; at the widest street of them, for now.)
  if (d.grid && gridsDone.has(d.grid)) continue;
  gridsDone.add(d.grid);
  const u: P = [Math.cos(d.angle), Math.sin(d.angle)];
  const v: P = [-u[1], u[0]];
  for (const a of d.u) streets.push(...clip(d, [d.origin[0] + u[0] * a, d.origin[1] + u[1] * a], v, lineWidth(d, 'u', a), d.grid === northOfMarket && a === GRANT.x ? 'Grant Avenue' : `${d.name} ${a}`));
  for (const b of d.v) streets.push(...clip(d, [d.origin[0] + v[0] * b, d.origin[1] + v[1] * b], u, lineWidth(d, 'v', b), d.grid === northOfMarket && b === BROADWAY.z ? 'Broadway' : `${d.name} ${b}`));
}
/**
 * A district's grid line's street width: its grid's (the first of the districts sharing it: its
 * streets are drawn and painted that wide), but Broadway's.
 */
function lineWidth(d: District, axis: 'u' | 'v', at: number): number {
  if (d.grid === northOfMarket && axis === 'v' && at === BROADWAY.z) return BROADWAY.width;
  return (d.grid ? DISTRICTS.find((q) => q.grid === d.grid)! : d).street;
}

// ---- The buildings ----

const rng = new Rng(0x5f2026);
/** The neon signs' own draw (so adding them didn't move a building). */
const signs = new Rng(0x7e0);
const houses: HouseDef[] = [];
const alleys: Line[] = [];
const cutters = [MARKET, COLUMBUS, DIVISION];

/** Whether a building's corners (and its sides' middles) are all clear: of the main road, the streets that cut across, and in its district. */
function clear(d: District, pts: P[]): boolean {
  return pts.every(([x, z]) => {
    if (!d.in(x, z) || inside(x, z) < SIDEWALK) return false;
    for (const l of cutters) if (off(l, x, z) < l.width / 2 + SIDEWALK) return false;
    return true;
  });
}

/**
 * A district's block between its grid lines u0..u1 and v0..v1 (its local m), built up: two rows of
 * buildings back to back along its long way, or either side of an alley.
 */
function block(d: District, u0: number, u1: number, v0: number, v1: number): void {
  const u: P = [Math.cos(d.angle), Math.sin(d.angle)];
  const v: P = [-u[1], u[0]];
  const world = (a: number, b: number): P => [d.origin[0] + u[0] * a + v[0] * b, d.origin[1] + u[1] * a + v[1] * b];
  const setback = (axis: 'u' | 'v', at: number) => lineWidth(d, axis, at) / 2 + SIDEWALK;
  if (park.some((q) => insideLoop(q, ...world((u0 + u1) / 2, (v0 + v1) / 2)))) return;
  const [a0, a1, b0, b1] = [u0 + setback('u', u0), u1 - setback('u', u1), v0 + setback('v', v0), v1 - setback('v', v1)];
  if (a1 - a0 < 10 || b1 - b0 < 10) return;
  const alley = rng.next() < d.alleys && Math.max(a1 - a0, b1 - b0) > 40;
  const half = alley ? d.alley / 2 : GAP / 2;
  // (Its rows along its long way; along Broadway on its strip, so its clubs front it.)
  const mid = world((u0 + u1) / 2, (v0 + v1) / 2);
  const onBroadway = d.grid === northOfMarket && (v0 === BROADWAY.z || v1 === BROADWAY.z) && mid[0] > BROADWAY.strip[0] && mid[0] < BROADWAY.strip[1];
  const alongU = onBroadway || a1 - a0 >= b1 - b0;
  /** One building, a..b along u by c..e along v (local), its front to the street on its `face` side (+v, -v, +u, -u). */
  const build = (a: number, b: number, c: number, e: number, face: number) => {
    const corners = [world(a, c), world(b, c), world(a, e), world(b, e), world((a + b) / 2, c), world((a + b) / 2, e), world(a, (c + e) / 2), world(b, (c + e) / 2)];
    if (b - a < 6 || e - c < 6 || !clear(d, corners)) return;
    const [x, z] = world((a + b) / 2, (c + e) / 2);
    // (On Broadway's strip, fronting it: a club, lower, lit up.)
    const broadway = d.grid === northOfMarket && face < 2 && [v1, v0][face] === BROADWAY.z && x > BROADWAY.strip[0] && x < BROADWAY.strip[1];
    const storeys = Math.round(broadway ? rng.range(BROADWAY.storeys[0], BROADWAY.storeys[1]) : rng.range(d.storeys[0], d.storeys[1]));
    // (Turned to face it: the same box either way round, its shopfronts and signs on the street's side.)
    const turn = [0, Math.PI, Math.PI / 2, -Math.PI / 2][face];
    const rot = Math.atan2(Math.sin(turn - d.angle), Math.cos(turn - d.angle));
    const size: [number, number, number] = face < 2 ? [r1(b - a), r1(e - c), r1(storeys * 3.4)] : [r1(e - c), r1(b - a), r1(storeys * 3.4)];
    const house: HouseDef = { at: [r1(x), r1(z)], size, rot: Math.round(rot * 1000) / 1000, look: broadway ? 'broadway' : d.look };
    if (broadway) house.label = BROADWAY.words[Math.floor(signs.next() * BROADWAY.words.length)];
    else if (signs.next() < d.neon.share) house.label = d.neon.words[Math.floor(signs.next() * d.neon.words.length)];
    houses.push(house);
  };
  /** A row of lots along u (a..b), c..e deep; or along v. */
  const row = (a: number, b: number, c: number, e: number, u: boolean, face: number) => {
    let x = u ? a : c;
    const end = u ? b : e;
    while (end - x > d.lot[0] * 0.6) {
      const w = rng.range(d.lot[0], d.lot[1]);
      const to = end - (x + w) < d.lot[0] * 0.6 ? end : x + w;
      if (u) build(x, to - GAP, c, e, face);
      else build(a, b, x, to - GAP, face);
      x = to;
    }
  };
  if (alongU) {
    const m = (b0 + b1) / 2;
    row(a0, a1, b0, m - half, true, 1);
    row(a0, a1, m + half, b1, true, 0);
    if (alley) alleyIn(d, world(u0 - 2, m), world(u1 + 2, m));
  } else {
    const m = (a0 + a1) / 2;
    row(a0, m - half, b0, b1, false, 3);
    row(m + half, a1, b0, b1, false, 2);
    if (alley) alleyIn(d, world(m, v0 - 2), world(m, v1 + 2));
  }
}

/** An alley from a to b (each a street's middle), if both ends are in the district and the city: else it runs on out of it, and isn't one. */
function alleyIn(d: District, a: P, b: P): void {
  if ([a, b].every(([x, z]) => d.in(x, z) && inCity(x, z) && inside(x, z) > -2)) alleys.push({ a, b, width: d.alley, name: `${d.name} alley` });
}

// ---- Dolores Park: the Mission's blocks nearest the top of its hill, two of them, lawn and palms ----

const park: P[][] = [];
{
  const d = DISTRICTS.find((q) => q.name === 'the Mission')!;
  const hill = HILLS[3];
  const u: P = [Math.cos(d.angle), Math.sin(d.angle)];
  const v: P = [-u[1], u[0]];
  const world = (a: number, b: number): P => [d.origin[0] + u[0] * a + v[0] * b, d.origin[1] + u[1] * a + v[1] * b];
  // (The block whose middle is nearest the hill's top, and the one east of it.)
  let best = [0, 0, Infinity];
  for (let a = 0; a < d.u.length - 2; a++)
    for (let b = 0; b < d.v.length - 1; b++) {
      const [x, z] = world((d.u[a] + d.u[a + 2]) / 2, (d.v[b] + d.v[b + 1]) / 2);
      const dist = Math.hypot(x - hill.x, z - hill.z);
      if (dist < best[2] && d.in(x, z)) best = [a, b, dist];
    }
  const [a, b] = best;
  const inset = d.street / 2 + 1;
  for (const [a0, a1] of [[d.u[a], d.u[a + 1]], [d.u[a + 1], d.u[a + 2]]]) {
    const [p0, p1, q0, q1] = [a0 + inset, a1 - inset, d.v[b] + inset, d.v[b + 1] - inset];
    park.push([world(p0, q0), world(p1, q0), world(p1, q1), world(p0, q1)].map(([x, z]) => [r1(x), r1(z)] as P));
    // Palms round its edge, every 14 m or so, and a few across it (solid: a trunk's a crash).
    const rot = Math.round(-d.angle * 1000) / 1000;
    const palm = (pa: number, pb: number) => {
      const [x, z] = world(pa, pb);
      houses.push({ at: [r1(x), r1(z)], size: [0.9, 0.9, r1(rng.range(8, 11))], rot, look: 'palm' });
    };
    for (let t = p0 + 3; t <= p1 - 3; t += 14) palm(t, q0 + 2), palm(t, q1 - 2);
    for (let k = 0; k < 4; k++) palm(rng.range(p0 + 12, p1 - 12), rng.range(q0 + 12, q1 - 12));
  }
}

// ---- Telegraph Hill's top: Pioneer Park (lawn) and Coit Tower in it; the Transamerica Pyramid's block ----

/** The north grid's block (between its lines u0..u1 and v0..v1) as a rectangle `inset` m in from its streets' middles. */
const northBlock = (u0: number, u1: number, v0: number, v1: number, inset: number): P[] => [
  [u0 + inset, v0 + inset],
  [u1 - inset, v0 + inset],
  [u1 - inset, v1 - inset],
  [u0 + inset, v1 - inset],
];
/** Coit Tower, in the middle of Pioneer Park: the block just off Telegraph Hill's top. */
const COIT = { block: [132, 192, -385, -305], tower: 20, high: 64 };
park.push(northBlock(COIT.block[0], COIT.block[1], COIT.block[2], COIT.block[3], 8));
const COIT_AT: P = [(COIT.block[0] + COIT.block[1]) / 2, (COIT.block[2] + COIT.block[3]) / 2];
/** The Transamerica Pyramid: the block across the street from the Bank, where Columbus Avenue comes into the Financial District. */
const PYRAMID = { block: [252, 312, -95, -30], base: 38 };
const PYRAMID_AT: P = [(PYRAMID.block[0] + PYRAMID.block[1]) / 2, (PYRAMID.block[2] + PYRAMID.block[3]) / 2];
park.push(northBlock(PYRAMID.block[0], PYRAMID.block[1], PYRAMID.block[2], PYRAMID.block[3], 10));

for (const d of DISTRICTS)
  for (let a = 0; a < d.u.length - 1; a++)
    for (let b = 0; b < d.v.length - 1; b++) {
      // (Only blocks with some of the district in them.)
      const u: P = [Math.cos(d.angle), Math.sin(d.angle)];
      const v: P = [-u[1], u[0]];
      const mu = (d.u[a] + d.u[a + 1]) / 2;
      const mv = (d.v[b] + d.v[b + 1]) / 2;
      const corners = [[d.u[a], d.v[b]], [d.u[a + 1], d.v[b]], [d.u[a], d.v[b + 1]], [d.u[a + 1], d.v[b + 1]], [mu, mv]].map(([p, q]) => [d.origin[0] + u[0] * p + v[0] * q, d.origin[1] + u[1] * p + v[1] * q]);
      if (corners.some(([x, z]) => d.in(x, z) && inCity(x, z))) block(d, d.u[a], d.u[a + 1], d.v[b], d.v[b + 1]);
    }
// The Condor: Broadway's club nearest where Columbus crosses it (its corner), its sign the dancer in
// neon (the skin's: a club labelled CONDOR).
{
  const cx = COLUMBUS.a[0] + ((COLUMBUS.b[0] - COLUMBUS.a[0]) * (BROADWAY.z - COLUMBUS.a[1])) / (COLUMBUS.b[1] - COLUMBUS.a[1]);
  let best = -1;
  for (let k = 0; k < houses.length; k++) if (houses[k].look === 'broadway' && (best < 0 || Math.hypot(houses[k].at[0] - cx, houses[k].at[1] - BROADWAY.z) < Math.hypot(houses[best].at[0] - cx, houses[best].at[1] - BROADWAY.z))) best = k;
  if (best < 0) throw new Error('no club on Broadway for the Condor');
  houses[best].label = 'CONDOR';
}
// (The pyramid's block was kept clear as a "park": it's its plaza, not a lawn. Each landmark's own
// solid base: the drawn landmark stands in it, house look 'landmark'.)
park.pop();
houses.push({ at: PYRAMID_AT, size: [PYRAMID.base, PYRAMID.base, 24], rot: 0, look: 'landmark' });
houses.push({ at: COIT_AT, size: [COIT.tower, COIT.tower, COIT.high], rot: 0, look: 'landmark' });
// The Dragon Gate: across Grant Avenue's south end, its two great posts on the pavements (solid),
// the rest of it (its roofs, over the street and the pavements) the landmark's.
const GATE_AT: P = [GRANT.x, GRANT.z - GRANT.gate];
const GATE_SPAN = 2 * (lineWidth(DISTRICTS[1], 'u', GRANT.x) / 2 + SIDEWALK / 2);
for (const s of [-1, 1]) houses.push({ at: [r1(GATE_AT[0] + (s * GATE_SPAN) / 2), GATE_AT[1]], size: [GRANT.post, GRANT.post, GRANT.high - 3], rot: 0, look: 'landmark' });

// An alley only where it's open end to end: none whose line a building stands across (its ends in another district's blocks).
{
  const st = new Streets({ nodes: [], links: [] }, houses);
  for (let k = alleys.length - 1; k >= 0; k--) if (!st.clear(alleys[k].a[0], alleys[k].a[1], alleys[k].b[0], alleys[k].b[1])) alleys.splice(k, 1);
}

// A wall along the Freeway's outer side, under its deck: past it is out of the city.
houses.push({ at: [0, FREEWAY.z + FREEWAY.width / 2 + 3 + 4], size: [FREEWAY.deck[1] - FREEWAY.deck[0] + 20, 3, 7], rot: 0, look: 'wall' });

// ---- The bay: north of Bay Street and east of the Embarcadero, behind a sea wall ----

/** The sea's level (m): the city's 3 m over it. */
const SEA = -3;
/**
 * The sea wall on the main road's bay side (its left): from the top of Van Ness, round its corner,
 * along Bay Street through the start, down the Embarcadero and round its corner to the Freeway's
 * foot. Past it, water out to the horizon; the land is west of Van Ness and south of the Freeway.
 */
const BAY_S: P = [sAt(-560, -420), sAt(420, FREEWAY.z)];
/** The piers stand off this much of it: Bay Street's west end to China Basin. */
const PIER_S: P = [sAt(-470, -460), sAt(598, 300)];
/** Alcatraz, out in the bay off Bay Street; the Golden Gate Bridge west of it, from the land past Van Ness north to Marin (landmarks: the skin's). */
const ALCATRAZ: P = [200, -980];
const GOLDEN_GATE: P = [-900, -930];
/** The Bay Bridge: from just off the Embarcadero past the south piers, out east (its local -z) to Yerba Buena Island. */
const BAY_BRIDGE: P = [700, 330];
/**
 * The Ferry Building: on its own land out past the Embarcadero where Market meets it (no sea wall
 * `land` m either side of it), `long` m along the road, `deep` m deep, `out` m past the road's
 * edge, its clock tower in the middle (the skin's).
 */
const FERRY = { s: sAt(MARKET.b[0], MARKET.b[1]), land: 75, long: 130, deep: 24, out: 10, high: 14, quay: 48 };
/** The piers: out into the bay off the sea wall, every `every` m along it, `long` m out and `wide` m across; none within `clear` m of the Ferry Building's land or the wall's ends. */
const PIERS = { every: 85, long: 110, wide: 26, clear: 45 };
/** The main road's sample at `s`, and its outward normal there (its left: the bay's side). */
const at = (s: number) => {
  const i = ((Math.round(s / main.step) % main.n) + main.n) % main.n;
  return { x: main.px[i], z: main.pz[i], nx: main.tz[i], nz: -main.tx[i], edge: main.width[i] / 2 + main.shoulder[i], i };
};
/** How far along the main road from a to b, forward (m). */
const ahead = (a: number, b: number) => (((b - a) % L) + L) % L;
const coast: P[] = [];
let ferryLand: PadDef | null = null;
{
  const span = ahead(BAY_S[0], BAY_S[1]);
  for (let d = 0; d <= span; ) {
    const s = (BAY_S[0] + d) % L;
    const q = at(s);
    // (Round the Ferry Building's land, out past it: closer together there, to keep its corners.)
    const from = Math.min(ahead(s, FERRY.s), ahead(FERRY.s, s));
    d += from < FERRY.land + 40 ? 8 : 40;
    const land = 1 - Math.min(1, Math.max(0, (from - FERRY.land) / 10));
    // (A little inside its paving: the pad's edge, not the coast's sand, meets the water.)
    const o = q.edge + SEAWALL_FACE + land * (FERRY.quay - 6 - SEAWALL_FACE);
    coast.push([r1(q.x + q.nx * o), r1(q.z + q.nz * o)]);
  }
  // Round the land to the south and west, far out, and back in at the top of Van Ness.
  const last = coast[coast.length - 1];
  // (North of Van Ness, the Presidio's shore out to where the Golden Gate comes ashore.)
  coast.push([last[0], 1700], [-1700, 1700], [-1700, -560], [-830, -560], [-700, -500]);
  // The piers.
  let n = 0;
  const north: number[] = [];
  const south: number[] = [];
  for (let d = PIERS.clear + 20; d <= ahead(PIER_S[0], PIER_S[1]) - PIERS.clear; d += PIERS.every) {
    const s = (PIER_S[0] + d) % L;
    if (Math.min(ahead(s, FERRY.s), ahead(FERRY.s, s)) < FERRY.land + PIERS.clear) continue;
    (ahead(PIER_S[0], s) < ahead(PIER_S[0], FERRY.s) ? north : south).push(s);
  }
  // (Odd numbers north of the Ferry Building, up to Pier 39 at the wharf; even south of it.)
  const label = (s: number) => {
    const k = north.indexOf(s);
    if (k >= 0) return 2 * Math.round(((north.length - 1 - k) / Math.max(1, north.length - 1)) * 19) + 1;
    return 2 * (south.indexOf(s) * 4 + 7);
  };
  for (const s of [...north, ...south]) {
    const q = at(s);
    const o = q.edge + SEAWALL_FACE + 1 + PIERS.long / 2;
    // (Its front, the shed's doors, toward the road.)
    houses.push({ at: [r1(q.x + q.nx * o), r1(q.z + q.nz * o)], size: [PIERS.wide, PIERS.long, 24], rot: Math.round(Math.atan2(-q.nx, -q.nz) * 1000) / 1000, look: 'pier', label: `PIER ${label(s)}` });
    n++;
  }
  const q = at(FERRY.s);
  const o = q.edge + FERRY.out + FERRY.deep / 2;
  houses.push({ at: [r1(q.x + q.nx * o), r1(q.z + q.nz * o)], size: [FERRY.long, FERRY.deep, FERRY.high], rot: Math.round(Math.atan2(-q.nx, -q.nz) * 1000) / 1000, look: 'ferry' });
  // Its land paved, a quay out to the water (not the coast's beach).
  // (Out to the coast round it: `quay` m past the road's edge.)
  const deep = FERRY.quay + 2;
  ferryLand = { kind: 'pad', at: [r1(q.x + q.nx * (q.edge + deep / 2)), r1(q.z + q.nz * (q.edge + deep / 2))], size: [2 * FERRY.land + 10, deep], rot: Math.round(Math.atan2(main.tx[q.i], main.tz[q.i]) * 1000) / 1000, y: 0 };
  console.log(`  the bay: ${n} piers, the Ferry Building at ${Math.round(FERRY.s)} m`);
}

// ---- The Presidio: open parkland past Van Ness, a winding drive through it, its woods ----

/**
 * The owner, 2026-10-08: "more open areas like the presidio that have more curvy roads to drift".
 * Van Ness's west side open (no wall) between `open` (z, south to north), onto lawn: out to a hedge
 * along `west` (x) and `south` (z), the bay's beach to the north. Through it, Presidio Drive: off
 * Van Ness near its foot and back on near its top, swinging west and back east between `zig`
 * (corners, Chaikin-rounded into sweepers and two hairpins), `width` m. Groves of trees about the
 * lawns (smashables: knocked flat, not a wreck), and brush.
 *
 * Then, 2026-10-09: "the ground should have some soft hills and mogul like bumps, we can add some of
 * the grass effects, also maybe make it go deeper with a real wooded area with crashable trees". The
 * lawns roll (`ground`: features/rolling.ts), and the drive rides the hills. South of `woods.north`
 * the park runs on west past the old hedge to `woods.west`: a wood of cypress and eucalyptus every
 * `woods.every` m or so (smashables, the eucalyptus costlier), the drive winding through it.
 */
const PRESIDIO = {
  open: [392, -378] as P,
  west: -800,
  south: 392,
  hedge: { thick: 2.4, high: 3.4 },
  width: 12,
  zig: [[-600, 345], [-690, 362], [-800, 350], [-850, 374], [-912, 352], [-975, 344], [-1005, 264], [-948, 192], [-1002, 118], [-954, 46], [-886, 4], [-810, 22], [-742, -24], [-650, -46], [-606, -104], [-650, -172], [-742, -184], [-766, -256], [-722, -322], [-640, -334], [-604, -334]] as P[],
  groves: 26,
  brush: 70,
  woods: { west: -1040, north: -150, every: 8, keep: 0.86, gums: 0.55, brush: 90 },
  ground: { height: 9, size: 110, ease: 60, bumps: { height: 1.4, spacing: 13 } },
};
/** The bay's shore past Van Ness's top, west to the Golden Gate (the coast's own corners, below). */
const SHORE: P[] = [[-830, -560], [-700, -500], [-575, -420]];
const shoreZ = (x: number) => {
  for (let k = 0; k + 1 < SHORE.length; k++) if (x <= SHORE[k + 1][0]) return SHORE[k][1] + ((SHORE[k + 1][1] - SHORE[k][1]) * (x - SHORE[k][0])) / (SHORE[k + 1][0] - SHORE[k][0]);
  return SHORE[SHORE.length - 1][1];
};
/** Presidio Drive's middle, every few metres, from Van Ness and back to it. */
const presidio: P[] = [];
const PRESIDIO_ID = 'presidio-drive';
const groveTrees: P[] = [];
const gumTrees: P[] = [];
const presidioLawn: P[] = [];
const brush: P[] = [];
let presidioGround: RollingDef;
{
  // (Van Ness's middle where the drive leaves and rejoins it: 30 m before its first point, 30 m past its last.)
  const vanNess = (z: number): P => [main.px[at(sAt(-560, z)).i], z];
  const edge = (z: number): P => [vanNess(z)[0] - (VAN_NESS(0, 0).w / 2 + 3 + PRESIDIO.width / 2 + 1), z];
  const { woods } = PRESIDIO;
  // The lawns: from the hedges to Van Ness's verge, down to the beach; south of the woods' hedge, on west to theirs.
  const verge = vanNess(0)[0] - (VAN_NESS(0, 0).w / 2 + 3 + 0.5);
  presidioLawn.push(...[PRESIDIO.west, -700, verge].map((x): P => [r1(x), r1(shoreZ(x) + 14)]), [r1(verge), PRESIDIO.south], [woods.west, PRESIDIO.south], [woods.west, woods.north], [PRESIDIO.west, woods.north]);
  presidioGround = { kind: 'rolling', area: presidioLawn, ...PRESIDIO.ground };
  const swell = rollingSwell(presidioGround);
  const first = PRESIDIO.zig[0][1] + 20;
  const last = PRESIDIO.zig[PRESIDIO.zig.length - 1][1] - 20;
  let line: P[] = [edge(first), ...PRESIDIO.zig, edge(last)];
  for (let pass = 0; pass < 3; pass++)
    line = [line[0], ...line.slice(0, -1).flatMap(([ax, az], k) => {
      const [bx, bz] = line[k + 1];
      return [[0.75 * ax + 0.25 * bx, 0.75 * az + 0.25 * bz], [0.25 * ax + 0.75 * bx, 0.25 * az + 0.75 * bz]] as P[];
    }), line[line.length - 1]];
  // Every 6 m.
  let left = 0;
  for (let k = 0; k + 1 < line.length; k++) {
    const [ax, az] = line[k];
    const [bx, bz] = line[k + 1];
    const len = Math.hypot(bx - ax, bz - az);
    for (; left < len; left += 6) presidio.push([r1(ax + ((bx - ax) * left) / len), r1(az + ((bz - az) * left) / len)]);
    left -= len;
  }
  presidio.push(line[line.length - 1]);
  const from = Math.round(sAt(-560, first + 30));
  const to = Math.round(sAt(-560, last - 30));
  // (Laid on the hills, not the bumps: the ground eases to it over its verge.)
  layout.branches = [
    { id: PRESIDIO_ID, from, to, kind: 'street', points: presidio.map(([x, z]) => ({ p: [x, r1(swell(x, z).y * 10) / 10, z], width: PRESIDIO.width, lanes: 2, shoulder: 2, surface: 'asphalt', verge: 'undergrowth' })) },
  ];
  // The hedges: along the west from the water to the woods', that west to the woods' own, down it,
  // and the south one from there east to Van Ness's wall.
  const { thick, high } = PRESIDIO.hedge;
  const northEnd = shoreZ(PRESIDIO.west) - 20;
  const eastEnd = vanNess(PRESIDIO.south)[0] - (VAN_NESS(0, 0).w / 2 + 3 + 1.6);
  houses.push({ at: [PRESIDIO.west, r1((northEnd + woods.north) / 2)], size: [thick, r1(woods.north - northEnd + thick), high], rot: 0, look: 'hedge' });
  houses.push({ at: [r1((woods.west + PRESIDIO.west) / 2), woods.north], size: [r1(PRESIDIO.west - woods.west + thick), thick, high], rot: 0, look: 'hedge' });
  houses.push({ at: [woods.west, r1((woods.north + PRESIDIO.south) / 2)], size: [thick, r1(PRESIDIO.south - woods.north + thick), high], rot: 0, look: 'hedge' });
  houses.push({ at: [r1((woods.west + eastEnd) / 2), PRESIDIO.south], size: [r1(eastEnd - woods.west), thick, high], rot: 0, look: 'hedge' });
  // Groves and brush on the lawns: clear of the drive, Van Ness, the hedges and the beach.
  const rng = new Rng(0x9e5);
  const offDrive = (x: number, z: number, r: number) => presidio.every(([px, pz]) => Math.hypot(px - x, pz - z) > PRESIDIO.width / 2 + 2 + r);
  const inPark = (x: number, z: number) =>
    z < PRESIDIO.south - 6 && x < -560 - (9 + 3 + 10) && z > shoreZ(x) + 26 && (x > PRESIDIO.west + 6 || (x > woods.west + 6 && z > woods.north + 6));
  const clearAt = (x: number, z: number, r: number) => inPark(x, z) && offDrive(x, z, r);
  for (let g = 0; g < PRESIDIO.groves; g++) {
    const [cx, cz] = [rng.range(PRESIDIO.west + 20, -600), rng.range(shoreZ(-700) + 40, PRESIDIO.south - 20)];
    const n = Math.round(rng.range(7, 16));
    for (let k = 0; k < n; k++) {
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * 22;
      const [x, z] = [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
      if (clearAt(x, z, 3) && groveTrees.every(([tx, tz]) => Math.hypot(tx - x, tz - z) > 4.5)) groveTrees.push([r1(x), r1(z)]);
    }
  }
  for (let k = 0; k < PRESIDIO.brush; k++) {
    const [x, z] = [rng.range(PRESIDIO.west, -580), rng.range(shoreZ(-700), PRESIDIO.south)];
    if (clearAt(x, z, 2) && groveTrees.every(([tx, tz]) => Math.hypot(tx - x, tz - z) > 3)) brush.push([r1(x), r1(z)]);
  }
  // The woods: a tree every few metres (jittered), thinning out over the lawn's first 40 m past the
  // old hedge's line; the drive's verge kept clear, close up to it.
  const wood = new Rng(0x3d00d);
  const trees = [...groveTrees];
  for (let x = woods.west + 6; x < PRESIDIO.west + 40; x += woods.every)
    for (let z = woods.north + 6; z < PRESIDIO.south - 6; z += woods.every) {
      const [px, pz] = [x + wood.range(-3, 3), z + wood.range(-3, 3)];
      const thin = Math.max(0, (px - PRESIDIO.west) / 40);
      const keep = wood.next() < woods.keep * (1 - thin);
      const gum = wood.next() < woods.gums;
      if (!keep || !clearAt(px, pz, 1.2) || trees.some(([tx, tz]) => Math.abs(tx - px) < 4 && Math.abs(tz - pz) < 4)) continue;
      trees.push([r1(px), r1(pz)]);
      (gum ? gumTrees : groveTrees).push([r1(px), r1(pz)]);
    }
  for (let k = 0; k < woods.brush; k++) {
    const [x, z] = [wood.range(woods.west, PRESIDIO.west), wood.range(woods.north, PRESIDIO.south)];
    if (clearAt(x, z, 2) && trees.every(([tx, tz]) => Math.hypot(tx - x, tz - z) > 3)) brush.push([r1(x), r1(z)]);
  }
  console.log(`  the Presidio: its drive ${Math.round(presidio.length * 6)} m (${from}–${to} m on Van Ness), open ${PRESIDIO.open.join(' to ')}; ${groveTrees.length} cypresses, ${gumTrees.length} eucalyptus, ${brush.length} bushes`);
}

/**
 * Every line (the main road where it's on the ground, as a run of short lines; under the Freeway;
 * the cutting streets; each district's streets; the alleys) and a node wherever two cross; the
 * Freeway's deck a street from one foot to the other, crossing nothing.
 */
function graph(): GetawayDef {
  const lines: Line[] = [];
  // The main road on the ground: from the east foot of the Freeway round to its west foot.
  const onGround = (s: number) => !(s > FOOT_S[0] && s < FOOT_S[1]);
  let prev: P | null = null;
  for (let s = 0; s <= L; s += 30) {
    const at = Math.min(s, L);
    if (!onGround(at)) {
      prev = null;
      continue;
    }
    const i = Math.round(at / main.step) % main.n;
    const p: P = [main.px[i], main.pz[i]];
    if (prev) lines.push({ a: prev, b: p, width: 18, name: 'main' });
    prev = p;
  }
  const footE: P = [main.px[Math.round(FOOT_S[0] / main.step)], main.pz[Math.round(FOOT_S[0] / main.step)]];
  const footW: P = [main.px[Math.round(FOOT_S[1] / main.step)], main.pz[Math.round(FOOT_S[1] / main.step)]];
  lines.push({ a: footE, b: footW, width: FREEWAY.width, name: 'the Freeway', through: false });
  lines.push(UNDER, MARKET, COLUMBUS, DIVISION, ...streets, ...alleys);
  // Presidio Drive, a line every 24 m or so, and in from Van Ness's middle at each end (a little past
  // it, to be sure to cross it).
  const drive = presidio.filter((_, k) => k % 4 === 0 || k === presidio.length - 1);
  const mouth = ([x, z]: P): P => {
    const q = at(sAt(x, z));
    const len = Math.hypot(q.x - x, q.z - z);
    return [q.x + ((q.x - x) / len) * 3, q.z + ((q.z - z) / len) * 3];
  };
  const way = [mouth(drive[0]), ...drive, mouth(drive[drive.length - 1])];
  for (let k = 0; k + 1 < way.length; k++) lines.push({ a: way[k], b: way[k + 1], width: PRESIDIO.width, name: 'Presidio Drive' });

  const nodes: P[] = [];
  const nodeAt = (x: number, z: number) => {
    let k = nodes.findIndex(([nx, nz]) => Math.hypot(nx - x, nz - z) < 5);
    if (k < 0) k = nodes.push([r1(x), r1(z)]) - 1;
    return k;
  };
  // (Each link, and the width it's painted for: its street's, none for the main road, the Freeway or an alley.)
  const links = new Map<string, number>();
  for (const l of lines) {
    const [ax, az] = l.a;
    const [bx, bz] = l.b;
    const at: number[] = [0, 1];
    if (l.through !== false)
      for (const m of lines) {
        if (m === l || m.through === false) continue;
        const [cx0, cz0] = m.a;
        const [cx1, cz1] = m.b;
        const den = (bx - ax) * (cz1 - cz0) - (bz - az) * (cx1 - cx0);
        if (Math.abs(den) < 1e-9) continue;
        const t = ((cx0 - ax) * (cz1 - cz0) - (cz0 - az) * (cx1 - cx0)) / den;
        const u = ((cx0 - ax) * (bz - az) - (cz0 - az) * (bx - ax)) / den;
        if (t > -1e-6 && t < 1 + 1e-6 && u > -1e-6 && u < 1 + 1e-6) at.push(Math.min(1, Math.max(0, t)));
      }
    at.sort((p, q) => p - q);
    let prevK = -1;
    for (const t of at) {
      const k = nodeAt(ax + (bx - ax) * t, az + (bz - az) * t);
      if (prevK >= 0 && prevK !== k) {
        const id = prevK < k ? `${prevK},${k}` : `${k},${prevK}`;
        const paint = l.name === 'main' || l.name === 'Presidio Drive' || l.through === false || alleys.includes(l) ? 0 : l.width;
        links.set(id, Math.max(links.get(id) ?? 0, paint));
      }
      prevK = k;
    }
  }
  // (A street's run past its end, to meet what bounds it, leaves a stub node where it met nothing: let it be.)
  return { nodes, links: [...links.keys()].map((l) => l.split(',').map(Number) as [number, number]), paint: [...links.values()] };
}
const getaway = graph();

// ---- Lombard Street: the Hills' steepest east-west block, a zigzag down it between planters ----

/** Its planters: `thick` m along the street, reaching across it from alternate sides to leave `gap` m, every `every` m; `high` m (a car hits them, it doesn't hop them). */
const LOMBARD = { thick: 2.6, gap: 7.5, every: 11, high: 1.4, clear: 13 };
{
  const hills = DISTRICTS.find((q) => q.name === 'the Hills')!;
  const raw = cityHeight({ kind: 'city', outline, y: 0, hills: HILLS, level: [] });
  let best: { a: P; b: P; grade: number } | null = null;
  for (const [a, b] of getaway.links) {
    const [p, q] = [getaway.nodes[a], getaway.nodes[b]];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (Math.abs(q[1] - p[1]) > 1 || len < 60 || len > 110) continue;
    if (![p, q].every(([x, z]) => hills.in(x, z) && inside(x, z) > 40)) continue;
    const grade = Math.abs(raw(q[0], q[1]) - raw(p[0], p[1])) / len;
    if (!best || grade > best.grade) best = { a: p, b: q, grade };
  }
  if (!best) throw new Error('no block for Lombard Street');
  const { a, b } = best;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dir: P = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const across: P = [-dir[1], dir[0]];
  const face = hills.street / 2 + SIDEWALK;
  const reach = 2 * face - LOMBARD.gap + 1;
  let side = 1;
  let n = 0;
  for (let t = LOMBARD.clear; t <= len - LOMBARD.clear; t += LOMBARD.every, side = -side, n++) {
    // (From just inside one row of buildings out across the street.)
    const lat = side * (face + 0.5 - reach / 2);
    const x = a[0] + dir[0] * t + across[0] * lat;
    const z = a[1] + dir[1] * t + across[1] * lat;
    houses.push({ at: [r1(x), r1(z)], size: [r1(reach), LOMBARD.thick, LOMBARD.high], rot: Math.round(Math.atan2(dir[0], dir[1]) * 1000) / 1000, look: 'planter' });
  }
  console.log(`  Lombard Street: ${a.join(',')} – ${b.join(',')}, ${(best.grade * 100).toFixed(0)}% down, ${n} bends`);
}

// ---- The Bank, and the start outside it ----
{
  // The crossing nearest BANK.near, and the street west from it: the start 35 m along it, facing the crossing.
  const st = new Streets(getaway, houses);
  const n = st.nearest(BANK.near[0], BANK.near[1]);
  const west = getaway.links.flatMap(([a, b]) => (a === n ? [b] : b === n ? [a] : [])).find((m) => st.x(m) < st.x(n) - 20 && Math.abs(st.z(m) - st.z(n)) < 2);
  if (west === undefined) throw new Error(`no street west from the Bank's crossing ${getaway.nodes[n]}: to ${getaway.links.flatMap(([a, b]) => (a === n ? [b] : b === n ? [a] : [])).map((m) => getaway.nodes[m].join(',')).join(' ')}`);
  const len = Math.hypot(st.x(n) - st.x(west), st.z(n) - st.z(west));
  const k = 35 / len;
  const at: P = [r1(st.x(n) + (st.x(west) - st.x(n)) * k), r1(st.z(n) + (st.z(west) - st.z(n)) * k)];
  getaway.start = { at, heading: Math.round(Math.atan2(st.x(n) - at[0], st.z(n) - at[1]) * 1000) / 1000 };
  // The building on the street's north side there: the Bank, taller.
  let bank = -1;
  for (let h = 0; h < houses.length; h++) if (houses[h].at[1] < at[1] && Math.abs(houses[h].at[0] - at[0]) < houses[h].size[0] / 2 && (bank < 0 || houses[h].at[1] > houses[bank].at[1])) bank = h;
  if (bank >= 0) houses[bank] = { ...houses[bank], size: [houses[bank].size[0], houses[bank].size[1], BANK.storeys * 3.4], look: 'bank' };
}

// ---- The city's ground, and the layout ----

const city: CityDef = {
  kind: 'city',
  outline,
  y: 0,
  hills: HILLS,
  // Every crossing level, and a little past the street's edge (none on the main road: it's level of its own).
  // Every crossing of two streets or more (an alley's mouth isn't one: levelling those too stepped the hills), a little past its middle.
  level: getaway.nodes
    .filter(([x, z], k) => inside(x, z) > 0 && getaway.links.filter(([a, b], j) => (a === k || b === k) && getaway.paint![j] > 0).length >= 3)
    .map(([x, z]) => [x, z, 6] as [number, number, number])
    // (And Telegraph Hill's top, where Coit Tower stands on its terrace: as a crossing, wider.)
    .concat([[COIT_AT[0], COIT_AT[1], 16]]),
  cut: 50,
  // (And the Presidio's lawns and woods: from its hedges to Van Ness's verge, down to the beach.)
  parks: [...park, presidioLawn],
};
layout.ground = {
  // (2.5 m: the sea wall's ledge is a cell's diagonal; and the crossings' crests are sharp.)
  cell: 2.5,
  // No walls: the bay and the land round it lie flat out to the grid's edge (it reaches this far past the main road, and 45 m more).
  wallFrom: 200,
  wallRise: 0,
  // (Out past the Presidio's hedge: the Golden Gate's approach comes down beyond it.)
  wallOut: 60,
  // (And on west under the Presidio's woods, to past their hedge.)
  reach: [PRESIDIO.woods.west - 60, PRESIDIO.woods.north, PRESIDIO.west, PRESIDIO.south],
  sea: SEA,
  coast,
  features: [
    city,
    // (The Presidio's hills and bumps, out past the city.)
    presidioGround!,
    ferryLand!,
    // (Either side of the Ferry Building's land; through the start, the first.)
    { kind: 'seawall', s: [BAY_S[0], (FERRY.s - FERRY.land + L) % L], side: 'left', floor: SEA - 10 },
    { kind: 'seawall', s: [(FERRY.s + FERRY.land) % L, BAY_S[1]], side: 'left', floor: SEA - 10 },
  ],
};
// Walled on the main road's outer side; open on the city's, but for the Freeway (walled both sides, up on its ramps and its deck).
layout.walls = {
  gaps: [
    { s: [0, FOOT_S[0]], side: 'right' },
    { s: [FOOT_S[1], L], side: 'right' },
    // Van Ness's west side, onto the Presidio's lawns.
    { s: [Math.round(sAt(-560, PRESIDIO.open[0])), Math.round(sAt(-560, PRESIDIO.open[1]))], side: 'left' },
    { spline: PRESIDIO_ID, s: [0, 1e4], side: 'both' },
  ],
};
// The Freeway's deck, the ground under it at the city's level (its street).
layout.pieces = [{ id: 'freeway', s: DECK_S, under: { floor: 0, ease: 30, reach: 30 } }];
layout.houses = houses;
layout.landmarks = [
  { kind: 'alcatraz', at: ALCATRAZ, rot: 0.35, r: 0 },
  { kind: 'golden-gate', at: GOLDEN_GATE, rot: 0.2, r: 0 },
  { kind: 'bay-bridge', at: BAY_BRIDGE, rot: -1.45, r: 0 },
  { kind: 'transamerica', at: PYRAMID_AT, rot: 0, r: 0, params: { base: PYRAMID.base } },
  { kind: 'coit-tower', at: COIT_AT, rot: 0, r: 0, params: { high: COIT.high } },
  { kind: 'chinatown-gate', at: GATE_AT, rot: 0, r: 0, params: { span: GATE_SPAN, high: GRANT.high, post: GRANT.post } },
];
layout.traffic = {
  lanes: [
    { pos: 0.3, dir: 1, speed: 14 },
    { pos: 0.75, dir: 1, speed: 18 },
    { pos: -0.3, dir: -1, speed: 14 },
    { pos: -0.75, dir: -1, speed: 18 },
  ],
  density: 8,
};
layout.getaway = getaway;
/**
 * Round the city: the bridges' approaches, each closed by the police where it comes down (behind
 * the main road's wall: you see the roadblock, you can't reach it). The Golden Gate's comes off its
 * south end through the Presidio and down beside Van Ness; the Bay Bridge's off its west anchorage,
 * over the Embarcadero's corner and alongside the Freeway, merging at its deck's height.
 */
getaway.scenery = {
  approaches: [
    {
      // (On down to the ground and along it to Van Ness's wall: closed at the wall.)
      // (Down past the Presidio's hedge, closed there: seen over it from the drive.)
      path: [[-803, -450, 41], [-815, -395, 35], [-824, -340, 24], [-829, -285, 12], [-831, -240, 3], [-831, -205, 0.5], [-831, -180, 0.5]],
      width: 16,
      cars: [[-826, -192, 0.3], [-836, -192, -0.4], [-831, -200, 0]],
      barrier: [[-839, -184], [-823, -184]],
    },
    {
      path: [[680, 332, 49], [604, 350, 46], [540, 420, 38], [500, 492, 29], [400, 492, 18], [310, 492, 12.5], [240, 492, 11.2], [160, 492, 11.2]],
      width: 16,
      cars: [[172, 488, 1.2], [172, 497, 1.9], [182, 492, 1.57]],
      barrier: [[190, 484], [190, 500]],
    },
  ],
  // (Its woods past the hedge: inside it, the lawns and groves are the layout's.)
  presidio: [-1400, -545, PRESIDIO.west - 6, 460],
  // (Not over the woods inside the hedges: those trees are the layout's.)
  presidioWoods: [PRESIDIO.woods.west - 6, PRESIDIO.woods.north - 6, PRESIDIO.west, PRESIDIO.south + 6],
};

// Every street the cops are given is one a car fits down: nothing built across it (the Freeway's
// deck is over everything, and checked by its own road).
{
  const st = new Streets(getaway, houses);
  const deck = (a: number, b: number) => Math.abs(getaway.nodes[a][1] - FREEWAY.z) < 2 && Math.abs(getaway.nodes[b][1] - FREEWAY.z) < 2;
  const blocked = getaway.links.filter(([a, b]) => !deck(a, b) && !st.clear(st.x(a), st.z(a), st.x(b), st.z(b)));
  if (blocked.length) console.warn(`  ${blocked.length} streets with a building across them, dropped: ${blocked.slice(0, 6).map(([a, b]) => `${getaway.nodes[a].join(',')} – ${getaway.nodes[b].join(',')}`).join('; ')}`);
  // (Still streets, painted and paved: Lombard's crooked block, its planters across it.)
  getaway.scenery!.painted = getaway.links.flatMap(([a, b], k) => (blocked.includes(getaway.links[k]) && getaway.paint![k] > 0 ? [[...getaway.nodes[a], ...getaway.nodes[b], getaway.paint![k]] as [number, number, number, number, number]] : []));
  getaway.paint = getaway.paint!.filter((_, k) => !blocked.includes(getaway.links[k]));
  getaway.links = getaway.links.filter((l) => !blocked.includes(l));
  // Only the streets joined to the rest: the biggest part of the graph, its nodes renumbered.
  const adj = getaway.nodes.map(() => [] as number[]);
  for (const [a, b] of getaway.links) adj[a].push(b), adj[b].push(a);
  const part = new Int32Array(getaway.nodes.length).fill(-1);
  const sizes: number[] = [];
  for (let k = 0; k < part.length; k++) {
    if (part[k] >= 0) continue;
    const id = sizes.push(0) - 1;
    const stack = [k];
    part[k] = id;
    while (stack.length) {
      const n = stack.pop()!;
      sizes[id]++;
      for (const m of adj[n]) if (part[m] < 0) (part[m] = id), stack.push(m);
    }
  }
  const big = sizes.indexOf(Math.max(...sizes));
  const renum = new Int32Array(part.length).fill(-1);
  const kept: P[] = [];
  getaway.nodes.forEach((p, k) => {
    if (part[k] === big) renum[k] = kept.push(p) - 1;
  });
  console.log(`  the cops' streets: ${getaway.nodes.length - kept.length} nodes off on their own, dropped`);
  getaway.paint = getaway.paint!.filter((_, k) => part[getaway.links[k][0]] === big);
  getaway.links = getaway.links.filter(([a]) => part[a] === big).map(([a, b]) => [renum[a], renum[b]]);
  getaway.nodes = kept;
}

// ---- Chinatown's lanterns: strung across its streets (the skin's; here each street's middle line, node to node, and its width) ----
{
  const china = DISTRICTS.find((q) => q.name === 'Chinatown')!;
  getaway.scenery!.lanterns = getaway.links.flatMap(([a, b], k) => {
    const [p, q] = [getaway.nodes[a], getaway.nodes[b]];
    const w = getaway.paint![k];
    // (Chinatown's own streets: not Broadway, Columbus or Market, and south of Broadway: north of
    // it is North Beach and Telegraph Hill.)
    const [mx, mz] = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    if (w !== DISTRICTS[0].street || !china.in(mx, mz) || mz < BROADWAY.z) return [];
    // (Nor a piece of one ending on Columbus: its crossings are wide and askew, strings over them hang over nothing.)
    if ([p, q].some(([x, z]) => off(COLUMBUS, x, z) < COLUMBUS.width / 2 + 4)) return [];
    return [[p[0], p[1], q[0], q[1], w] as [number, number, number, number, number]];
  });
  console.log(`  Chinatown: ${getaway.scenery!.lanterns.length} streets hung with lanterns, the Dragon Gate at ${GATE_AT.join(', ')}`);
}

// ---- Street signs: on a corner of every crossing of two named streets, a post and a blade for each ----
{
  const deg = new Uint16Array(getaway.nodes.length);
  getaway.links.forEach(([a, b], k) => {
    if (getaway.paint![k] > 0) deg[a]++, deg[b]++;
  });
  const signs: [number, number, number, string, string][] = [];
  const painted: Line[] = getaway.links.flatMap(([a, b], k) => (getaway.paint![k] > 0 ? [{ a: getaway.nodes[a], b: getaway.nodes[b], width: getaway.paint![k], name: '' }] : []));
  const grids = new Set<unknown>();
  for (const d of DISTRICTS) {
    if (!d.names || (d.grid && grids.has(d.grid))) continue;
    grids.add(d.grid);
    const u: P = [Math.cos(d.angle), Math.sin(d.angle)];
    const v: P = [-u[1], u[0]];
    const world = (a: number, b: number): P => [d.origin[0] + u[0] * a + v[0] * b, d.origin[1] + u[1] * a + v[1] * b];
    const own = d.grid ? DISTRICTS.filter((q) => q.grid === d.grid) : [d];
    d.u.forEach((a, i) =>
      d.v.forEach((b, j) => {
        const [uName, vName] = [d.names!.u[i], d.names!.v[j]];
        if (!uName || !vName) return;
        const [x, z] = world(a, b);
        if (!own.some((q) => q.in(x, z)) || inside(x, z) < 20) return;
        // (Only where both streets are there: a crossing of the cops' streets, three ways or more.)
        const n = getaway.nodes.findIndex(([nx, nz]) => Math.hypot(nx - x, nz - z) < 4);
        if (n < 0 || deg[n] < 3) return;
        // On a corner (which, by the crossing; the next round if a street cutting across is over it), just in from the kerbs.
        const first = Math.floor(hash01(i, j, 61) * 4);
        for (let c = 0; c < 4; c++) {
          const q = (first + c) % 4;
          const [su, sv] = [q & 1 ? 1 : -1, q & 2 ? 1 : -1];
          const [px, pz] = world(a + su * (lineWidth(d, 'u', a) / 2 + 1.2), b + sv * (lineWidth(d, 'v', b) / 2 + 1.2));
          if (!painted.every((l) => off(l, px, pz) > l.width / 2 + 0.8)) continue;
          // (The blade along u names the street that runs along u: the v line's.)
          signs.push([r1(px), r1(pz), Math.round(d.angle * 1000) / 1000, vName, uName]);
          break;
        }
      }),
    );
  }
  getaway.scenery!.signs = signs;
  console.log(`  street signs: ${signs.length}, ${new Set(signs.flatMap((q) => [q[3], q[4]])).size} names`);
}

// ---- Cars cruising the streets: a few loops through the city, a few cars round each ----

/**
 * The owner, 2026-10-08: "a little bit of traffic on the inner city roads, not a lot, but just some
 * cars cruising around". Each loop: out from a crossing to one `reach` m off by the streets (the
 * shortest way, each street's length jittered per loop so the loops differ), and back by other streets
 * (those it took out cost CRUISE.other times as much). Only proper streets (painted: no alley, the
 * main road, the Freeway), and no crossing on the main road. On the right of the street.
 */
const CRUISE = { loops: 9, cars: [2, 4] as P, speed: [8.5, 12] as P, reach: [300, 650] as P, other: 6, keep: 2.6 };
{
  const cruise = new Rng(0xc0a57);
  const N = getaway.nodes.length;
  const ok = getaway.nodes.map(([x, z]) => inside(x, z) > 6);
  const adj: { to: number; len: number }[][] = getaway.nodes.map(() => []);
  getaway.links.forEach(([a, b], k) => {
    if (!getaway.paint![k] || !ok[a] || !ok[b]) return;
    const len = Math.hypot(getaway.nodes[a][0] - getaway.nodes[b][0], getaway.nodes[a][1] - getaway.nodes[b][1]);
    adj[a].push({ to: b, len });
    adj[b].push({ to: a, len });
  });
  const key = (a: number, b: number) => (a < b ? a * N + b : b * N + a);
  /** The cheapest way from a to b (Dijkstra), each street's cost its length times `cost`; the nodes after a up to b. */
  const way = (a: number, b: number, cost: (a: number, b: number) => number): number[] | null => {
    const dist = new Float64Array(N).fill(Infinity);
    const from = new Int32Array(N).fill(-1);
    const done = new Uint8Array(N);
    dist[a] = 0;
    for (;;) {
      let u = -1;
      for (let k = 0; k < N; k++) if (!done[k] && dist[k] < Infinity && (u < 0 || dist[k] < dist[u])) u = k;
      if (u < 0) return null;
      if (u === b) break;
      done[u] = 1;
      for (const e of adj[u]) {
        const d = dist[u] + e.len * cost(u, e.to);
        if (d < dist[e.to]) (dist[e.to] = d), (from[e.to] = u);
      }
    }
    const out: number[] = [];
    for (let k = b; k !== a; k = from[k]) out.unshift(k);
    return out;
  };
  const lanes: NonNullable<TrackLayout['traffic']>['lanes'] = [];
  const usable = getaway.nodes.flatMap((_, k) => (adj[k].length >= 2 ? [k] : []));
  for (let tries = 0; lanes.length < CRUISE.loops && tries < 200; tries++) {
    const a = usable[Math.floor(cruise.next() * usable.length)];
    const far = cruise.range(CRUISE.reach[0], CRUISE.reach[1]);
    const b = usable.find((k) => Math.abs(Math.hypot(getaway.nodes[k][0] - getaway.nodes[a][0], getaway.nodes[k][1] - getaway.nodes[a][1]) - far) < 40 && cruise.next() < 0.3);
    if (b === undefined) continue;
    const jitter = new Map<number, number>();
    const j = (u: number, v: number) => {
      const id = key(u, v);
      if (!jitter.has(id)) jitter.set(id, cruise.range(0.7, 1.5));
      return jitter.get(id)!;
    };
    const out = way(a, b, j);
    if (!out) continue;
    const taken = new Set<number>();
    let prev = a;
    for (const k of out) taken.add(key(prev, k)), (prev = k);
    const back = way(b, a, (u, v) => j(u, v) * (taken.has(key(u, v)) ? CRUISE.other : 1));
    if (!back) continue;
    const loop = [a, ...out, ...back.slice(0, -1)];
    // (No loop that's mostly the same streets out and back: it'd be a U-turn.)
    const shared = back.filter((k, q) => taken.has(key(q ? back[q - 1] : b, k))).length;
    if (shared > back.length / 3) continue;
    const n = Math.round(cruise.range(CRUISE.cars[0], CRUISE.cars[1] + 0.99));
    // Its stops: every turn, and most crossings it goes straight over (three streets or more; the
    // same ones whichever loop comes by: a stop sign is the crossing's).
    const painted = (k: number) => getaway.links.filter(([a, b], j) => (a === k || b === k) && getaway.paint![j] > 0).length;
    const stops = loop.flatMap((k, q) => {
      const [px, pz] = getaway.nodes[loop[(q + loop.length - 1) % loop.length]];
      const [cx, cz] = getaway.nodes[k];
      const [nx, nz] = getaway.nodes[loop[(q + 1) % loop.length]];
      const turn = Math.abs(Math.atan2((cx - px) * (nz - cz) - (cz - pz) * (nx - cx), (cx - px) * (nx - cx) + (cz - pz) * (nz - cz)));
      return turn > 0.5 || (painted(k) >= 3 && ((k * 2654435761) >>> 0) % 4 !== 0) ? [q] : [];
    });
    lanes.push({ pos: CRUISE.keep, dir: 1, speed: Math.round(cruise.range(CRUISE.speed[0], CRUISE.speed[1]) * 10) / 10, path: loop.map((k) => getaway.nodes[k]), count: n, kinds: ['sedan', 'sedan', 'compact', 'compact', 'van'], stops });
  }
  layout.traffic!.lanes.push(...lanes);
  console.log(`  cruising the streets: ${lanes.length} loops, ${lanes.reduce((a, l) => a + (l.count ?? 0), 0)} cars, ${lanes.reduce((a, l) => a + (l.stops?.length ?? 0), 0)} stops`);
}

// ---- Along the pavements: street lamps at the kerb, street trees, shrubs by the doors ----
// (Smashables: knocked flat, a little speed lost, never a wreck. Not within `clear` m of a crossing, so its corners stay open.)

const FURNITURE = { lamp: 34, kerb: 0.7, tree: 1.4, shrub: 2.4, clear: 14 };
/** A plaza's cell (m): the leftover lots are found, and paved, this square at a time. */
const PLAZA = 4;
{
  const lamps: P[] = [];
  const trees: P[] = [];
  const shrubs: P[] = [];
  /** Whether (x, z) is within `r` m of a building. */
  const inHouse = (x: number, z: number, r: number) =>
    houses.some((h) => {
      const dx = x - h.at[0];
      const dz = z - h.at[1];
      // (Its corners reach its half diagonal, turned.)
      const reach = Math.hypot(h.size[0], h.size[1]) / 2 + r;
      if (Math.abs(dx) > reach || Math.abs(dz) > reach) return false;
      const [c, sn] = [Math.cos(h.rot), Math.sin(h.rot)];
      return Math.abs(dx * c - dz * sn) < h.size[0] / 2 + r && Math.abs(dx * sn + dz * c) < h.size[1] / 2 + r;
    });
  const painted = getaway.links.map(([a, b], k) => ({ a: getaway.nodes[a], b: getaway.nodes[b], w: getaway.paint![k] })).filter((l) => l.w > 0);
  /** Whether (x, z) is out on some street but `own` (its carriageway), or the main road. */
  const onStreet = (x: number, z: number, own: (typeof painted)[number]) =>
    inside(x, z) < 1 || painted.some((l) => l !== own && off({ a: l.a, b: l.b, width: 0, name: '' }, x, z) < l.w / 2 + 0.4);
  const place = (list: P[], x: number, z: number, r: number, own: (typeof painted)[number]) => {
    if (!onStreet(x, z, own) && !inHouse(x, z, r)) list.push([r1(x), r1(z)]);
  };
  for (const l of painted) {
    const len = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]);
    const [dx, dz] = [(l.b[0] - l.a[0]) / len, (l.b[1] - l.a[1]) / len];
    const at = (t: number, lat: number): P => [l.a[0] + dx * t - dz * lat, l.a[1] + dz * t + dx * lat];
    const mid = at(len / 2, 0);
    const d = DISTRICTS.find((q) => q.in(mid[0], mid[1]));
    for (const side of [-1, 1]) {
      // Lamps staggered side to side.
      for (let t = FURNITURE.clear + (side > 0 ? 0 : FURNITURE.lamp / 2); t <= len - FURNITURE.clear; t += FURNITURE.lamp) place(lamps, ...at(t, side * (l.w / 2 + FURNITURE.kerb)), 0.3, l);
      if (d?.green.trees) for (let t = FURNITURE.clear + 6; t <= len - FURNITURE.clear; t += d.green.trees) place(trees, ...at(t, side * (l.w / 2 + FURNITURE.tree)), 0.5, l);
      // (Up against the walls: only clear of them, not a car's width off.)
      if (d?.green.shrubs) for (let t = FURNITURE.clear + 3 + rng.range(0, 6); t <= len - FURNITURE.clear; t += d.green.shrubs * rng.range(0.7, 1.3)) place(shrubs, ...at(t, side * (l.w / 2 + FURNITURE.shrub)), 0.05, l);
    }
  }
  // Plazas: what's left over between the streets and the buildings, where a street cutting across
  // a grid (Market, Columbus, Division) left lots too odd to build on, or a block's corner was
  // left empty: paved (the skin's: GetawayScenery.plazas, a PLAZA m square each), a tree in the
  // middle of the bigger ones, a shrub now and then.
  // (The streets as laid out, and as the cops' streets run node to node and are painted: a crossing
  // merged into a nearby one leaves a street a little off its line.)
  const lines = [...streets, ...alleys, MARKET, COLUMBUS, DIVISION, UNDER, ...painted.map((l) => ({ a: l.a, b: l.b, width: l.w, name: '' })), ...getaway.scenery!.painted!.map(([x0, z0, x1, z1, w]): Line => ({ a: [x0, z0], b: [x1, z1], width: w, name: '' }))];
  const plazas: P[] = [];
  const isLot = (x: number, z: number) =>
    inCity(x, z) &&
    inside(x, z) > 1 &&
    // (Up to the kerbs: a cell's corner, askew to a street, reaches 2.9 m. Over the pavements, the
    // same stone: so the corners where a street meets another askew, its pavement cut off square, are paved.)
    lines.every((l) => off(l, x, z) > l.width / 2 + PLAZA * 0.71 + 0.1) &&
    !park.some((q) => insideLoop(q, x, z)) &&
    !inHouse(x, z, 0.6);
  const [minX, maxX, minZ, maxZ] = [Math.min(...outline.map((p) => p[0])), Math.max(...outline.map((p) => p[0])), Math.min(...outline.map((p) => p[1])), Math.max(...outline.map((p) => p[1]))];
  const lot = new Set<string>();
  for (let x = Math.ceil(minX / PLAZA) * PLAZA; x <= maxX; x += PLAZA)
    for (let z = Math.ceil(minZ / PLAZA) * PLAZA; z <= maxZ; z += PLAZA)
      if (isLot(x, z)) {
        plazas.push([x, z]);
        lot.add(`${x},${z}`);
      }
  // (A tree where the lot's open all round it, every other cell; a shrub at some of the rest.)
  const open = (x: number, z: number) => [-1, 0, 1].every((i) => [-1, 0, 1].every((j) => lot.has(`${x + i * PLAZA},${z + j * PLAZA}`)));
  for (const [x, z] of plazas) {
    const h = hash01(x, z, 71);
    if (open(x, z) && (x / PLAZA + z / PLAZA) % 2 === 0 && h < 0.7) trees.push([x, z]);
    else if (h < 0.12 && !inHouse(x, z, 1)) shrubs.push([x, z]);
  }
  getaway.scenery!.plazas = plazas;
  console.log(`  plazas: ${plazas.length} cells (${Math.round(plazas.length * PLAZA * PLAZA)} m²)`);
  layout.smashables = [
    { kind: 'street-lamp', s: [0, 0], every: 0, at: lamps },
    { kind: 'street-tree', s: [0, 0], every: 0, at: trees },
    { kind: 'shrub', s: [0, 0], every: 0, at: shrubs },
    { kind: 'grove-tree', s: [0, 0], every: 0, at: groveTrees },
    { kind: 'gum-tree', s: [0, 0], every: 0, at: gumTrees },
    { kind: 'bush', s: [0, 0], every: 0, at: brush },
  ];
  console.log(`  along the pavements: ${lamps.length} lamps, ${trees.length} trees, ${shrubs.length} shrubs; ${houses.filter((h) => h.label && h.look !== 'pier').length} neon signs`);
}

const baked = bakeTrack(layout, surfaces);
const height = cityHeight(city);
const top = Math.max(...getaway.nodes.map(([x, z]) => height(x, z)));
mkdirSync(DIR, { recursive: true });
writeFileSync(`${DIR}/city.track.json`, `${JSON.stringify(layout)}\n`);
writeFileSync(`${DIR}/map.json`, `${JSON.stringify({ id: 'heist', name: 'Heist', layouts: ['city'], palette: 'dusk', weather: ['clear', 'rain'] })}\n`);
console.log(`heist/city: the main road ${Math.round(L)} m (the Freeway's deck ${DECK_S.map(Math.round).join('–')} m), ground ${baked.ground!.nx}×${baked.ground!.nz}`);
for (const d of DISTRICTS) console.log(`  ${d.name}: ${houses.filter((h) => d.in(h.at[0], h.at[1])).length} buildings`);
console.log(`  ${houses.length} buildings, ${streets.length} streets, ${alleys.length} alleys; the cops' streets ${getaway.nodes.length} nodes / ${getaway.links.length} links; the highest crossing ${top.toFixed(1)} m; the start ${getaway.start!.at.join(', ')}`);
