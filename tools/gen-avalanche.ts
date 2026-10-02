// Generator for Avalanche's Slope (experimental, docs/AVALANCHE.md step 1): open snow to drive on and
// tune how snow feels. A loop for now (the race as one run comes in step 3): a run down the
// mountain, then a plain road back up to the top on the far side of a ridge.
//
//   the run    a flat start pad, a bunny slope, a steep pitch and its run-out, a short climb to a
//              crest, a second steep pitch, a mogul field on its right, a canyon on its left (a
//              halfpipe to ride instead of the piste), and a gentle finish
//   the road   asphalt switchbacks back up (no slide: the slope doesn't pull you on it)
//
// The whole mountainside is ground you can drive on (layout.ground): the piste is groomed snow,
// everything else powder, rising into walls 70 m out. No walls, no traffic, no hazards yet.
//
//   bun tools/gen-avalanche.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import type { TrackLayout } from '../src/core/content';
import { bakeTrack } from '../src/core/track/bake';
import surfaces from '../content/surfaces.json';
import { type Node, lapPoints, onLap, wallGaps } from './lib/lap';

/** The piste: groomed snow, wide. */
const P = (x: number, z: number, y: number, r?: number): Node => ({ x, z, y, w: 30, r, surface: 'snow', shoulder: 4, bank: 0 });
/** The road back up. */
const R = (x: number, z: number, y: number, r?: number): Node => ({ x, z, y, w: 12, r, surface: 'asphalt', shoulder: 2 });

const nodes: Node[] = [
  // The start pad, flat, at the top.
  P(0, -40, 200),
  P(0, 60, 200),
  // A bunny slope (12%), then the first steep pitch (about 40%, 22°) and its run-out.
  P(40, 260, 176, 120),
  P(-30, 430, 104, 110),
  P(-20, 540, 96, 100),
  // A short climb to a crest (5 m up), then the second steep pitch (about 30%).
  P(40, 620, 101, 90),
  P(60, 700, 100, 120),
  P(0, 860, 48, 120),
  // Moguls (on the right) and the canyon (on the left), down a gentler stretch, then the finish.
  P(-40, 1010, 27, 140),
  P(0, 1170, 9, 140),
  P(40, 1300, 0),
  // The road back up, on the far side of the ridge.
  R(200, 1390, 0, 90),
  R(400, 1260, 10, 80),
  R(410, 700, 90),
  R(400, 300, 150),
  R(380, 0, 194, 80),
  R(250, -160, 200, 80),
  R(80, -175, 200, 70),
];

const layout: TrackLayout = {
  id: 'avalanche-slope',
  name: 'Slope',
  main: { points: lapPoints(nodes, [], { sigma: { height: 20, width: 10, bank: 12 }, driftWidth: 0 }) },
  branches: [],
  zones: [],
  walls: { gaps: [] },
  ramps: [],
  checkpoints: 'auto',
  props: [],
  takedownSpots: [],
  scenery: 'snow',
  shoulderSurface: 'powder',
};

const baked = bakeTrack(layout, surfaces);
const L = baked.main.length;
const { sAt } = onLap(baked);

// No walls anywhere: the ground's own walls are the bounds.
layout.walls = { gaps: wallGaps([], L) };

layout.ground = {
  cell: 2,
  wallFrom: 70,
  wallRise: 0.8,
  rough: { height: 1.2, size: 18 },
  moguls: [{ s: [sAt(-30, 960), sAt(-20, 1060)], lateral: [3, 40], height: 1.6, spacing: 10 }],
  canyons: [{ s: [sAt(-25, 1050), sAt(20, 1230)], lateral: -40, floor: 10, depth: 5, ease: 30 }],
};

const dir = new URL('../content/maps/avalanche/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('slope.track.json', dir), JSON.stringify(layout, null, 1) + '\n');
writeFileSync(
  new URL('map.json', dir),
  JSON.stringify({ id: 'avalanche', name: 'Avalanche', layouts: ['slope'], palette: 'alpine', weather: ['clear'], experimental: true }) + '\n',
);
console.log(`slope ${L.toFixed(0)} m, ${layout.main.points.length} points; moguls s ${layout.ground.moguls![0].s.join('–')}, canyon s ${layout.ground.canyons![0].s.join('–')}`);
