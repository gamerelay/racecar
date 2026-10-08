// Generator for Sahara (docs/SAHARA.md): a desert lap on open ground (docs/AVALANCHE.md's
// heightfield), made to drift: corners every 100 m or so, S-chains, berms in the hairpins, jumps off
// the dunes and a touch of height. In order:
//
//   the Caravan Road   the start, asphalt north along the oasis, a sweeper and a flick into the dunes
//   the Dune Sea       packed sand east over the dunes: an S-chain, a crest to fly off every leg
//   the Berm           a hairpin banked hard, round onto the plateau
//   Giza               asphalt round the Great Pyramid's west face; the Pyramid Run, a shortcut
//                      straight up its north face, over its top and down its south face
//   the Wadi           a dry riverbed west, narrow and quick: flicks left and right
//   the Mesa           switchbacks up onto the mesa, berms in them, across its top, and the Mesa Drop
//                      off its north edge onto the Caravan Road home
//
// In the lobby since alpha-1.38 (the owner, 2026-10-07: "this map is good enough to merge, deploy and tag").
//
//   bun tools/gen-sahara.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import type { BranchDef, FeatureDef, PyramidDef, RampDef, RiverDef, TrackLayout } from '../src/core/content';
import { smoothstep } from '../src/core/math';
import { bakeTrack } from '../src/core/track/bake';
import { pyramidHeight } from '../src/core/track/features/pyramid';
import { newHit, offRoad, projectGlobal, sampleAt } from '../src/core/track/query';
import { Rng } from '../src/core/rng';
import { noise } from '../src/core/track/ground';
import { RIVER_BANK, riverAt } from '../src/core/track/features/river';
import surfaces from '../content/surfaces.json';
import { type Node, lapPoints, onLap, r1, wallGaps } from './lib/lap';

const DIR = 'content/maps/sahara';

/** Asphalt (the Caravan Road, Giza) and packed sand (the dunes, the wadi, the mesa), and their widths. */
const A = (x: number, z: number, y: number, r?: number, more: Partial<Node> = {}): Node => ({ x, z, y, w: 16, r, surface: 'asphalt', shoulder: 3, ...more });
const D = (x: number, z: number, y: number, r?: number, more: Partial<Node> = {}): Node => ({ x, z, y, w: 15, r, surface: 'packed-sand', shoulder: 3, ...more });
/** The wadi's narrower: commitment. */
const W = (x: number, z: number, y: number, r?: number) => D(x, z, y, r, { w: 12, shoulder: 2 });

const nodes: Node[] = [
  // The Caravan Road: north from the line along the oasis, a long right, a left and a right into the dunes.
  A(-280, -80, 3),
  A(-280, 80, 3, 70),
  A(-200, 170, 5, 45),
  A(-215, 270, 7, 35),
  // The Dune Sea: an S-chain east, a crest on every leg.
  D(-110, 350, 9, 45),
  D(-20, 280, 10, 45),
  D(70, 355, 11, 45),
  D(160, 280, 11, 45),
  D(250, 355, 12, 45),
  D(340, 300, 12, 40),
  // The Berm: a hairpin, round to head back west.
  D(440, 320, 12, 30),
  D(450, 210, 12, 30),
  // The Oasis Bends, west: sweepers.
  D(330, 170, 11, 60),
  D(210, 215, 10, 70),
  D(90, 160, 9, 55),
  D(-20, 200, 8, 50),
  // A second hairpin, round to head east again, up onto the plateau.
  D(-110, 170, 8, 28),
  D(-100, 80, 9, 30),
  A(20, 40, 10, 70),
  A(140, -20, 12, 60),
  A(260, 40, 14, 60),
  // Giza: a right onto the road south, then an S out round the Great Pyramid's west face (the
  // Pyramid Run goes straight on, over it).
  A(420, 40, 16, 40),
  A(425, -5, 16, 50),
  A(270, -110, 16, 60),
  A(450, -200, 15, 50),
  // Down off the plateau, and the Wadi west: flicks.
  D(450, -280, 13, 40),
  W(360, -330, 11, 40),
  W(260, -260, 9, 40),
  W(160, -330, 8, 40),
  W(60, -265, 8, 40),
  // The Mesa: switchbacks up (berms), across its top, and the Mesa Drop off its north edge.
  D(-30, -320, 10, 30),
  D(-20, -410, 16, 28),
  D(-140, -430, 22, 50),
  D(-280, -390, 25, 60),
  // The Mesa Drop: its lip, and the foot of its face, on the way home.
  D(-280, -240, 24),
  A(-280, -180, 4),
];

/** Crests to fly off (the dunes): a bump in the height (m) on the road nearest (x, z), over a length. */
const crests = [
  { x: -65, z: 315, h: 2.4, len: 34 },
  { x: 25, z: 318, h: 2.8, len: 34 },
  { x: 115, z: 318, h: 3.0, len: 34 },
  { x: 205, z: 318, h: 3.2, len: 34 },
  { x: 310, z: -295, h: 1.6, len: 28 },
  { x: 110, z: -298, h: 1.8, len: 28 },
];

// Hairpins bank hard (berms), sweepers less, flicks a little.
const bankFor = (r: number) => (r < 35 ? 0.26 : r < 50 ? 0.14 : 0.1);

const mainPoints = lapPoints(nodes, crests, { bankFor, drift: [28, 110] });

/**
 * The oasis river: it rises south of the Wadi, runs north under the Wadi's bridge, through the
 * basin between the plateau and the Caravan Road, west across the Caravan Road at the ford and
 * out into the low ground past it. Its water falls from `level[0]` to `level[1]` along it, `depth`
 * over a floor `width` wide. Where it crosses the lap it crosses square, `square` m either side of
 * the road's middle and on toward `far` times that. The ford: the road dips to `under` m beneath the water over `dip` (m along the
 * road either side: under it within the first, back to its own height by the second), its points
 * `every` m apart there so the water's edge is where it's drawn; driven as `ford`. The bridge: a
 * deck `span` m long over the gorge.
 */
const RIVER = { width: 12, depth: 1.1, level: [6.5, 2.5] as [number, number], square: 26, far: 2.4, ford: { under: 0.35, dip: [4, 22] as [number, number], every: 3, zone: 9 }, bridge: { span: 44 } };
/** Where it crosses the lap: the bridge on the Wadi (over its crest), then the ford on the Caravan Road. */
const BRIDGE_AT: [number, number] = [110, -298];
const FORD_AT: [number, number] = [-207, 215];
/** The main road's nearest point to (x, z) as laid, and its direction across (right of the way). */
const crossing = ([x, z]: [number, number]) => {
  let k = 0;
  for (let j = 1; j < mainPoints.length; j++) if (Math.hypot(mainPoints[j].p[0] - x, mainPoints[j].p[2] - z) < Math.hypot(mainPoints[k].p[0] - x, mainPoints[k].p[2] - z)) k = j;
  const a = mainPoints[(k - 1 + mainPoints.length) % mainPoints.length].p;
  const b = mainPoints[(k + 1) % mainPoints.length].p;
  const l = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const [tx, tz] = [(b[0] - a[0]) / l, (b[2] - a[2]) / l];
  return { x, z, rx: -tz, rz: tx };
};
const across = (c: ReturnType<typeof crossing>, side: number): [number, number] => [r1(c.x + c.rx * RIVER.square * side), r1(c.z + c.rz * RIVER.square * side)];
const bridgeX = crossing(BRIDGE_AT);
const fordX = crossing(FORD_AT);
// (Which side of each road it comes from: the bridge's from the south, the ford's from the east.)
// (And on square well past it, `far` times as far, so it bends to it, not round a kink at it.)
const square = (c: ReturnType<typeof crossing>, first: (p: [number, number], q: [number, number]) => boolean): [number, number][] => {
  const sd = first(across(c, 1), across(c, -1)) ? 1 : -1;
  return [across(c, sd * RIVER.far), across(c, sd), across(c, -sd), across(c, -sd * RIVER.far)];
};
const bridgeSquare = square(bridgeX, (p, q) => p[1] < q[1]);
const fordSquare = square(fordX, (p, q) => p[0] > q[0]);
/** A course through `pts`, its corners cut `rounds` times (Chaikin's), its ends kept: a river's bends, not a polyline's kinks. */
const rounded = (pts: [number, number][], rounds = 4): [number, number][] => {
  let out = pts;
  for (let r = 0; r < rounds; r++) {
    const next: [number, number][] = [out[0]];
    for (let k = 0; k < out.length - 1; k++) {
      const [a, b] = [out[k], out[k + 1]];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  // (Thinned to a point every few metres: the ground asks its distance at every grid point.)
  const thin: [number, number][] = [out[0]];
  for (const q of out) if (Math.hypot(q[0] - thin[thin.length - 1][0], q[1] - thin[thin.length - 1][1]) >= 6) thin.push(q);
  thin.push(out[out.length - 1]);
  return thin.map(([x, z]) => [r1(x), r1(z)]);
};
const RIVER_DEF: RiverDef = {
  kind: 'river',
  path: rounded([[60, -480], ...bridgeSquare, [-20, -115], [-110, -45], [-160, 40], [-160, 150], ...fordSquare, [-320, 232], [-420, 245], [-540, 240]]),
  width: RIVER.width,
  depth: RIVER.depth,
  level: RIVER.level,
};
/** The water's level at the ford, and the road's there. */
const FORD_Y = (() => {
  const w = { level: 0 };
  riverAt(RIVER_DEF, 50)(FORD_AT[0], FORD_AT[1], w);
  return w.level - RIVER.ford.under;
})();
// The ford's points: closer together over the dip (between the laid ones, on the straight), and down to it.
{
  const near = (p: { p: number[] }) => Math.hypot(p.p[0] - FORD_AT[0], p.p[2] - FORD_AT[1]);
  const out: typeof mainPoints = [];
  for (let k = 0; k < mainPoints.length; k++) {
    const a = mainPoints[k];
    out.push(a);
    const b = mainPoints[(k + 1) % mainPoints.length];
    if (k === mainPoints.length - 1 || Math.min(near(a), near(b)) > RIVER.ford.dip[1] + 10) continue;
    const n = Math.max(1, Math.round(Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]) / RIVER.ford.every));
    for (let j = 1; j < n; j++) {
      const u = j / n;
      out.push({ ...a, p: [r1(a.p[0] + (b.p[0] - a.p[0]) * u), r1(a.p[1] + (b.p[1] - a.p[1]) * u), r1(a.p[2] + (b.p[2] - a.p[2]) * u)], width: r1(a.width + (b.width - a.width) * u), ...(a.bank !== undefined || b.bank !== undefined ? { bank: Math.round(((a.bank ?? 0) + ((b.bank ?? 0) - (a.bank ?? 0)) * u) * 1000) / 1000 } : {}) });
    }
  }
  for (const q of out) {
    const k = smoothstep(RIVER.ford.dip[0], RIVER.ford.dip[1], near(q));
    if (k < 1) q.p = [q.p[0], r1(FORD_Y + (q.p[1] - FORD_Y) * k), q.p[2]];
  }
  mainPoints.splice(0, mainPoints.length, ...out);
}

const layout: TrackLayout = {
  id: 'sahara-dunes',
  name: 'Dunes',
  main: { points: mainPoints },
  branches: [],
  zones: [],
  walls: { gaps: [] },
  ramps: [],
  checkpoints: 'auto',
  props: [],
  takedownSpots: [],
  // (Drawn as a desert: render/skins/greybox/snow.ts's dunes, ripples and pyramid stone.)
  scenery: 'desert',
  shoulderSurface: 'sand',
};

let baked = bakeTrack(layout, surfaces);
const { sAt } = onLap(baked);
const L = baked.main.length;

const hit = newHit();
/** The main road's point `s` m along it, `lat` m to its right. */
const onMain = (s: number, lat = 0): [number, number] => (sampleAt(baked.main, ((s % L) + L) % L, hit), [hit.cx - hit.tz * lat, hit.cz + hit.tx * lat]);

/**
 * The Pyramid Run (a shortcut): where the Giza road bends away west round the Great Pyramid, straight
 * on south, up its north face, over its top and down its south face, back onto the road below. The
 * pyramid stands square on the run's line, `at` of the way along it, `half` m from its middle to its foot, `slope`
 * up (rise over run) to a flat top `top` m from its middle each way. Sandstone, `width` m wide.
 */
const RUN = { from: sAt(424, 10), to: sAt(452, -235), at: 0.42, half: 38, slope: 0.42, top: 4, width: 10, every: 3 };
const [ax, az] = onMain(RUN.from);
const [bx, bz] = onMain(RUN.to);
const runLength = Math.hypot(bx - ax, bz - az);
const runRot = Math.atan2(bx - ax, bz - az);
/** The Great Pyramid, on the Pyramid Run (its foot's height set below, from the ground there). */
const GREAT: PyramidDef = { kind: 'pyramid', at: [r1(ax + (bx - ax) * RUN.at), r1(az + (bz - az) * RUN.at)], half: RUN.half, top: RUN.top, h: r1((RUN.half - RUN.top) * RUN.slope), y: 0, rot: Math.round(runRot * 1000) / 1000 };
/** Two queens' pyramids off the road, to drive up for the fun of it (and to see at speed). */
const QUEENS: PyramidDef[] = [
  { kind: 'pyramid', at: [225, 112], half: 22, top: 2.5, h: 8, y: 0, rot: 0.2 },
  { kind: 'pyramid', at: [150, -150], half: 26, top: 3, h: 10, y: 0, rot: -0.15 },
];
/**
 * Diamonds (the owner: "you probably won't drive them unless you can approach at an angle and use a
 * side as a jump"): small pyramids on the outside of corners, turned 45° to the road, a corner
 * `clear` m off its shoulder: run wide out of the corner and you're up a face at an angle, off over
 * its ridge. Each `half` m to its foot, its faces `slope` up. (The near corner's cut back to the
 * road, so the face comes up out of the run-off.)
 */
const DIAMONDS = { at: [150, 1500, 2150, 3640], half: 13, slope: 0.55, top: 1, clear: 2 };
/** Which side of the road is the outside of the corner `s` m along it (-1 left, 1 right). */
const outside = (s: number) => {
  sampleAt(baked.main, ((s - 40 + L) % L), hit);
  const [ax, az] = [hit.tx, hit.tz];
  sampleAt(baked.main, (s + 10) % L, hit);
  // (A right turn, the cross product positive, has its outside on the left.)
  return ax * hit.tz - az * hit.tx > 0 ? -1 : 1;
};
const diamonds: PyramidDef[] = DIAMONDS.at.map((s) => {
  const side = outside(s);
  sampleAt(baked.main, s, hit);
  const off = (hit.width / 2 + hit.shoulder + DIAMONDS.clear + DIAMONDS.half * Math.SQRT2) * side;
  const rot = Math.atan2(hit.tx, hit.tz) + Math.PI / 4;
  return { kind: 'pyramid', at: [r1(hit.cx - hit.tz * off), r1(hit.cz + hit.tx * off)], half: DIAMONDS.half, top: DIAMONDS.top, h: r1((DIAMONDS.half - DIAMONDS.top) * DIAMONDS.slope), y: 0, rot: Math.round(rot * 1000) / 1000 };
});
const PYRAMIDS = [GREAT, ...QUEENS, ...diamonds];
/** Off the road by this much (m past its shoulder, to its foot), so none is cut back to the road (a diamond's its own). */
const PYRAMID_CLEAR = 15;

/** Kickers off the road's own crests and straights (rounded, launchable from their sides). */
const kicker = (x: number, z: number, height: number): RampDef => ({ s: sAt(x, z), height, length: 12, back: 8, flank: 6 });
/** The Mesa Drop's lip: its kicker. */
const MESA_LIP = sAt(-280, -244);

layout.ground = {
  cell: 2.5,
  wallFrom: 260,
  wallRise: 0.6,
  // The dunes: long rolls everywhere, the road too, and rougher off it.
  swell: { height: 2.4, size: 70 },
  rough: { height: 3.2, size: 28 },
  features: [],
};
// The ford: driven as shallow water across the road where it's under it.
{
  const at = sAt(FORD_AT[0], FORD_AT[1]);
  layout.zones = [{ s: [at - RIVER.ford.zone, at + RIVER.ford.zone], lateral: [-12, 12], surface: 'ford' }];
}
layout.walls = { gaps: wallGaps([], L) };
layout.ramps = [kicker(150, 188, 1.6), kicker(80, 10, 1.8), { s: MESA_LIP, height: 1.4, length: 12 }];

// Each pyramid's foot on the ground round it (without the pyramids: the dunes there, at its middle).
{
  const bare = bakeTrack(layout, surfaces).ground!;
  for (const p of PYRAMIDS) p.y = Math.round(bare.height(p.at[0], p.at[1]) * 10) / 10;
  layout.ground.features = [RIVER_DEF, ...PYRAMIDS] as FeatureDef[];
}
// The bridge: a deck over the river's gorge on the Wadi, the ground under it fallen to the river's floor.
{
  const at = sAt(BRIDGE_AT[0], BRIDGE_AT[1]);
  const w = { level: 0 };
  riverAt(RIVER_DEF, 50)(BRIDGE_AT[0], BRIDGE_AT[1], w);
  layout.pieces = [{ id: 'wadi-bridge', s: [at - RIVER.bridge.span / 2, at + RIVER.bridge.span / 2], under: { floor: r1(w.level - RIVER.depth), ease: 6, reach: 12 } }];
}
// The Pyramid Run's points: on the ground (the pyramid's faces) along its line, the road's at its ends.
{
  const g = bakeTrack(layout, surfaces).ground!;
  const n = Math.round(runLength / RUN.every);
  const points = [];
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    const x = ax + (bx - ax) * u;
    const z = az + (bz - az) * u;
    points.push({ p: [r1(x), r1(g.height(x, z)), r1(z)] as [number, number, number], width: RUN.width, lanes: 1, shoulder: 1.5, surface: 'sandstone' });
  }
  const run: BranchDef = { id: 'pyramid-run', kind: 'shortcut', from: RUN.from, to: RUN.to, points: points.slice(1, -1) };
  layout.branches = [run];
  // No walls along it, as none along the main road: it's a way over open ground, and you come at
  // the pyramid from any side (walled, its rails stood invisible 8 m either side of its middle).
  layout.walls!.gaps!.push({ spline: run.id, s: [0, 1e4], side: 'both' });
}
// None of the pyramids is near the main road (the Great Pyramid's run is its own way over it).
{
  const t = bakeTrack(layout, surfaces);
  const m = t.main;
  for (const p of PYRAMIDS) {
    const height = pyramidHeight(p);
    let clear = Infinity;
    let worst = 0;
    for (let i = 0; i < m.n; i++) {
      // Out from its middle, toward the road, to its foot.
      const d = Math.hypot(m.px[i] - p.at[0], m.pz[i] - p.at[1]);
      if (d > p.half * 1.5 + 60) continue;
      const [ux, uz] = [(m.px[i] - p.at[0]) / d, (m.pz[i] - p.at[1]) / d];
      let r = 0;
      while (height(p.at[0] + ux * r, p.at[1] + uz * r) > 0) r += 0.5;
      const c = d - r - m.width[i] / 2 - m.shoulder[i];
      if (c < clear) [clear, worst] = [c, i * m.step];
    }
    if (clear < (diamonds.includes(p) ? DIAMONDS.clear - 0.5 : PYRAMID_CLEAR)) throw new Error(`a pyramid at ${p.at.join(', ')} is ${clear.toFixed(1)} m off the road at ${Math.round(worst)} m, (${m.px[Math.round(worst / m.step)].toFixed(0)}, ${m.pz[Math.round(worst / m.step)].toFixed(0)}) (want ${PYRAMID_CLEAR})`);
    console.log(`  pyramid at ${p.at.join(', ')}: ${(p.half * 2).toFixed(0)} m across, ${p.h} m high on ${p.y} m, ${clear.toFixed(0)} m off the road`);
  }
}

/**
 * Giza dressed (the owner: "dress up Giza with the Sphinx and palms"). The Sphinx lies on the
 * plateau north of the road up to Giza, facing it across `front` m of open sand (its solid block a
 * house, the landmark standing in it); an obelisk either side of the road `obelisks` m along from
 * where it looks at it, `out` m past the road's shoulder.
 */
const GIZA = { sphinx: [340, 88] as [number, number], size: [13, 34, 12] as [number, number, number], obelisks: [-55, 55], out: 7, obelisk: [3.6, 3.6, 17] as [number, number, number] };
{
  const [x, z] = GIZA.sphinx;
  // Facing the road: toward its nearest point.
  const s = sAt(x, z);
  const [rx, rz] = onMain(s);
  const rot = Math.round(Math.atan2(rx - x, rz - z) * 1000) / 1000;
  layout.houses = [{ at: GIZA.sphinx, size: GIZA.size, rot, look: 'landmark' }];
  layout.landmarks = [{ kind: 'sphinx', at: GIZA.sphinx, rot, r: 0 }];
  for (const along of GIZA.obelisks)
    for (const side of [-1, 1]) {
      sampleAt(baked.main, s + along, hit);
      const off = (hit.width / 2 + hit.shoulder + GIZA.out) * side;
      const at: [number, number] = [r1(hit.cx - hit.tz * off), r1(hit.cz + hit.tx * off)];
      layout.houses.push({ at, size: GIZA.obelisk, rot: 0, look: 'landmark' });
      layout.landmarks.push({ kind: 'obelisk', at, rot: 0, r: 0 });
    }
  console.log(`  giza: the Sphinx at ${GIZA.sphinx.join(', ')}, ${Math.round(Math.hypot(rx - x, rz - z))} m from the road, and ${GIZA.obelisks.length * 2} obelisks`);
}

/**
 * The Sphinx avenue's market (docs/SAHARA.md, step 3): either side, past the shoulder, stalls every
 * `stalls` m, `out` m out, from `market` m along from where the Sphinx looks at the road, and clay
 * pots on the shoulder between them. (A ruined colonnade stood down its middle, solid, for a day:
 * the owner, 2026-10-07, "looks a little crowded, maybe we remove the columns from the middle of the road".)
 */
const AVENUE = { stalls: 14, out: 3.8, pots: 1.6, market: [-50, 46] as [number, number] };
{
  const s0 = sAt(GIZA.sphinx[0], GIZA.sphinx[1]);
  const market: [number, number] = [r1(s0 + AVENUE.market[0]), r1(s0 + AVENUE.market[1])];
  layout.smashables = [
    { kind: 'market-stall', s: market, every: AVENUE.stalls, lateral: AVENUE.out },
    { kind: 'clay-pots', s: [r1(market[0] + AVENUE.stalls / 2), market[1]], every: AVENUE.stalls, lateral: AVENUE.pots },
  ];
  console.log(`  the avenue: a market either side, ${market.join('–')} m`);
}

/**
 * Palms along the river (the oasis): both banks, one about every `every` m (jittered), `out` m
 * past its banks' foot (a range), in groves (none where the noise is low), none within `road` m of
 * any road's shoulder, on its water, on a pyramid or by a house. Planted (PinesDef.plant): solid.
 */
const PALMS = { every: 7, out: [-3, 9] as [number, number], road: 6, grove: 0.35, house: 4 };
{
  const t = bakeTrack(layout, surfaces);
  const g = t.ground!;
  const rng = new Rng(0x5a4a);
  const level = riverAt(RIVER_DEF, 80);
  const w = { level: 0 };
  const pyramid = PYRAMIDS.map(pyramidHeight);
  const roadHit = newHit();
  const palms: [number, number][] = [];
  const path = RIVER_DEF.path;
  let along = 0;
  for (let k = 1; k < path.length; k++) {
    const [ax, az] = path[k - 1];
    const [bx, bz] = path[k];
    const l = Math.hypot(bx - ax, bz - az);
    const [nx, nz] = [-(bz - az) / l, (bx - ax) / l];
    for (let u = 0; u < l; u++, along++) {
      if (along % PALMS.every !== 0) continue;
      for (const side of [-1, 1]) {
        const out = RIVER.width / 2 + RIVER_BANK + PALMS.out[0] + rng.next() * (PALMS.out[1] - PALMS.out[0]);
        const x = ax + (bx - ax) * (u / l) + nx * out * side + (rng.next() - 0.5) * 3;
        const z = az + (bz - az) * (u / l) + nz * out * side + (rng.next() - 0.5) * 3;
        if (noise(x, z, 60, 7) < PALMS.grove) continue;
        level(x, z, w);
        if (g.height(x, z) < w.level + 0.4 || pyramid.some((h) => h(x, z) > 0)) continue;
        if (layout.houses!.some((h) => Math.hypot(x - h.at[0], z - h.at[1]) < Math.max(h.size[0], h.size[1]) / 2 + PALMS.house)) continue;
        let clear = true;
        for (const sp of t.splines) {
          projectGlobal(sp, x, z, roadHit);
          if (offRoad(sp, x, z, roadHit) - roadHit.width / 2 - roadHit.shoulder < PALMS.road) clear = false;
        }
        if (clear) palms.push([r1(x), r1(z)]);
      }
    }
  }
  // (No trees of their own: only the planted palms.)
  layout.ground!.pines = { kind: 'tropic', seed: 31, spacing: 1000, clear: 1e4, thicken: 1, density: 0, glade: 50, plant: palms };
  console.log(`  oasis: ${palms.length} palms along the river`);
}

/**
 * Life on the Caravan Road (docs/SAHARA.md, step 5): a camel caravan walking toward you down its
 * left edge on the opening straight: strings of `camels`, `gap` m nose to nose, `speed` m/s, `pos`
 * of the way out from its middle (TrafficLaneDef.string, kinds 'camel': hit one and it scatters,
 * never a wreck), over `section` of it, a string about every `every` m round the lap (only those
 * on the section are seen). (One each way, the whole road to the ford, wrecked the field: bunched
 * on the first lap, a racer behind a caravan going its way braked and the next ran into it.) And dust devils (hazard `dust-devil`) wandering across the Dune Sea and the Mesa's top,
 * one about every `every` s on each.
 */
const CARAVAN = { section: [30, 120] as [number, number], camels: 5, gap: 3.6, speed: 2.2, pos: 0.95, every: 160 };
const DEVILS = [
  { s: [400, 1080] as [number, number], every: 18 },
  { s: [3480, 3840] as [number, number], every: 30 },
];
{
  const lane = { pos: -CARAVAN.pos, dir: -1 as const, speed: CARAVAN.speed, sections: [CARAVAN.section], kinds: ['camel'], string: [CARAVAN.camels, CARAVAN.gap] as [number, number] };
  layout.traffic = { lanes: [lane], density: r1((CARAVAN.camels * 1000) / CARAVAN.every) };
  layout.hazards = DEVILS.map((d) => ({ use: 'dust-devil', s: d.s, params: { every: d.every } }));
  console.log(`  life: caravans of ${CARAVAN.camels} camels toward you on the Caravan Road (${CARAVAN.section.join('–')} m), dust devils on ${DEVILS.map((d) => d.s.join('–')).join(' and ')} m`);
}

baked = bakeTrack(layout, surfaces);

mkdirSync(DIR, { recursive: true });
writeFileSync(`${DIR}/dunes.track.json`, `${JSON.stringify(layout)}\n`);
writeFileSync(`${DIR}/map.json`, `${JSON.stringify({ id: 'sahara', name: 'Sahara', layouts: ['dunes'], palette: 'sahara', sunset: 'sahara-sunset', weather: ['clear', 'sand'] })}\n`);
console.log(`sahara/dunes: ${Math.round(baked.main.length)} m, ground ${baked.ground!.nx}×${baked.ground!.nz}; the Pyramid Run ${Math.round(baked.splines[1].length)} m (${RUN.from}–${RUN.to} m round)`);
