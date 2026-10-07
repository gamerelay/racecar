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
// Experimental (from a link, `?mode=free&map=sahara/dunes`) until the owner's drive says otherwise.
//
//   bun tools/gen-sahara.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import type { BranchDef, FeatureDef, PyramidDef, RampDef, TrackLayout } from '../src/core/content';
import { bakeTrack } from '../src/core/track/bake';
import { pyramidHeight } from '../src/core/track/features/pyramid';
import { newHit, sampleAt } from '../src/core/track/query';
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

const layout: TrackLayout = {
  id: 'sahara-dunes',
  name: 'Dunes',
  main: { points: lapPoints(nodes, crests, { bankFor, drift: [28, 110] }) },
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
  { kind: 'pyramid', at: [300, 100], half: 22, top: 2.5, h: 8, y: 0, rot: 0.2 },
  { kind: 'pyramid', at: [150, -150], half: 26, top: 3, h: 10, y: 0, rot: -0.15 },
];
const PYRAMIDS = [GREAT, ...QUEENS];
/** Off the road by this much (m past its shoulder, to its foot), so none is cut back to the road. */
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
layout.walls = { gaps: wallGaps([], L) };
layout.ramps = [kicker(150, 188, 1.6), kicker(80, 10, 1.8), { s: MESA_LIP, height: 1.4, length: 12 }];

// Each pyramid's foot on the ground round it (without the pyramids: the dunes there, at its middle).
{
  const bare = bakeTrack(layout, surfaces).ground!;
  for (const p of PYRAMIDS) p.y = Math.round(bare.height(p.at[0], p.at[1]) * 10) / 10;
  layout.ground.features = PYRAMIDS as FeatureDef[];
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
    if (clear < PYRAMID_CLEAR) throw new Error(`a pyramid at ${p.at.join(', ')} is ${clear.toFixed(1)} m off the road at ${Math.round(worst)} m, (${m.px[Math.round(worst / m.step)].toFixed(0)}, ${m.pz[Math.round(worst / m.step)].toFixed(0)}) (want ${PYRAMID_CLEAR})`);
    console.log(`  pyramid at ${p.at.join(', ')}: ${(p.half * 2).toFixed(0)} m across, ${p.h} m high on ${p.y} m, ${clear.toFixed(0)} m off the road`);
  }
}

baked = bakeTrack(layout, surfaces);

mkdirSync(DIR, { recursive: true });
writeFileSync(`${DIR}/dunes.track.json`, `${JSON.stringify(layout)}\n`);
writeFileSync(`${DIR}/map.json`, `${JSON.stringify({ id: 'sahara', name: 'Sahara', layouts: ['dunes'], palette: 'sahara', weather: ['clear'], experimental: true })}\n`);
console.log(`sahara/dunes: ${Math.round(baked.main.length)} m, ground ${baked.ground!.nx}×${baked.ground!.nz}; the Pyramid Run ${Math.round(baked.splines[1].length)} m (${RUN.from}–${RUN.to} m round)`);
