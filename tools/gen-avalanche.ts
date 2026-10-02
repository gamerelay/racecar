// Generator for Avalanche's Slope (experimental, docs/AVALANCHE.md): one run down a mountain, top
// to bottom, about 6 km and 1,200 m of drop. No laps: the main road is open (layout.run), the grid
// at the summit, the finish in the valley, a run-out past it.
//
// The run is a list of stretches, each a length and a grade (steep pitches, bunny slopes, short
// climbs to a crest), smoothed where they meet so a crest throws you and a pitch's foot doesn't
// slam. The piste winds (a sum of slow sines), banks into its turns, and tilts a little side to
// side between them, switching as it goes. Off it, the whole mountainside is snow to drive on
// (layout.ground): rough powder, long swells over everything, mogul fields, canyons, kickers you
// can hit from any angle, and walls at the edges. A few snow-capped rocks and ridges stand on the
// piste itself, to go round.
//
//   bun tools/gen-avalanche.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import type { PropDef, RampDef, TrackLayout, TrackPoint } from '../src/core/content';
import { bakeTrack } from '../src/core/track/bake';
import surfaces from '../content/surfaces.json';
import { wallGaps } from './lib/lap';

/** The run, top to bottom: [length (m), grade (drop per m; negative climbs), what it is]. */
const STRETCHES: [number, number, string][] = [
  [90, 0, 'the start pad'],
  [380, 0.08, 'a bunny slope'],
  [300, 0.45, 'the first pitch'],
  [250, 0.05, 'its run-out'],
  [120, -0.08, 'a climb to a crest'],
  [350, 0.55, 'the second pitch'],
  [500, 0.1, 'rollers, moguls on the right'],
  [320, 0.15, 'a canyon on the left'],
  [260, 0.7, 'the wall'],
  [300, 0.06, 'the wall\'s run-out'],
  [150, -0.1, 'a climb'],
  [700, 0.2, 'the long winding stretch'],
  [400, 0.5, 'the fourth pitch'],
  [480, 0.08, 'a bunny slope, moguls across it'],
  [400, 0.18, 'a canyon on the right'],
  [110, -0.07, 'a climb to a kicker'],
  [320, 0.4, 'the last pitch'],
  [350, 0.03, 'the valley'],
  [220, 0, 'the run-out'],
];
/** Past the finish, this much run-out (m). */
const RUN_OUT = 220;
/** Control points this far apart (m). */
const EVERY = 20;

const total = STRETCHES.reduce((a, [l]) => a + l, 0);
/** Where each stretch starts (m along the run). */
const starts = STRETCHES.map((_, k) => STRETCHES.slice(0, k).reduce((a, [l]) => a + l, 0));
const gradeAt = (s: number) => {
  let k = STRETCHES.length - 1;
  while (k > 0 && starts[k] > s) k--;
  return STRETCHES[k][1];
};
/** The grade smoothed over about ±`sigma` m: pitches ease in and out. */
const smoothGrade = (s: number, sigma = 28) => {
  let sum = 0;
  let w = 0;
  for (let u = -3 * sigma; u <= 3 * sigma; u += 2) {
    const k = Math.exp(-(u * u) / (2 * sigma * sigma));
    sum += gradeAt(Math.min(total, Math.max(0, s + u))) * k;
    w += k;
  }
  return sum / w;
};
/** The heading (radians, 0 is +z) at `s`: slow winds, straight on the start pad and in the valley. */
const heading = (s: number) => {
  const calm = Math.max(0, Math.min(1, (s - 60) / 300, (total - s - 150) / 300));
  return calm * (0.55 * Math.sin(s / 210) + 0.35 * Math.sin(s / 97 + 1.3) + 0.2 * Math.sin(s / 61 + 4));
};
/** The piste's width: 30–42 m, narrower on the steepest. */
const widthAt = (s: number) => Math.round(36 + 6 * Math.sin(s / 330) - 6 * Math.min(1, Math.max(0, smoothGrade(s) - 0.4) * 3));

// Walk the run: position from the heading, height from the grade.
const points: TrackPoint[] = [];
let x = 0;
let z = 0;
let y = 1300;
for (let s = 0; s <= total; s += 1) {
  if (s % EVERY === 0 || s === total) {
    const turn = (heading(s + 5) - heading(s - 5)) / 10;
    // Into its turns (a right turn is the heading falling: its right edge down), and a small tilt
    // between them that switches side to side; none on the start pad or in the valley.
    const calm = Math.max(0, Math.min(1, (s - 60) / 200, (total - s - 150) / 300));
    const bank = calm * Math.max(-0.2, Math.min(0.2, -turn * 45 + 0.06 * Math.sin(s / 83)));
    points.push({ p: [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(z * 10) / 10], width: widthAt(s), surface: 'snow', shoulder: 4, bank: Math.round(bank * 1000) / 1000 });
  }
  const h = heading(s);
  x += Math.sin(h);
  z += Math.cos(h);
  y -= smoothGrade(s);
}

const layout: TrackLayout = {
  id: 'avalanche-slope',
  name: 'Slope',
  main: { points },
  branches: [],
  zones: [],
  walls: { gaps: [] },
  ramps: [],
  checkpoints: 'auto',
  props: [],
  takedownSpots: [],
  scenery: 'snow',
  shoulderSurface: 'powder',
  run: { start: 70, finish: total },
};

const baked = bakeTrack(layout, surfaces).main;
const L = baked.length;
/** A run distance on the baked road (they differ a little: the road's length counts its drop). */
const at = (s: number) => Math.round((s / total) * L);
const stretch = (name: string): [number, number] => {
  const k = STRETCHES.findIndex(([, , what]) => what === name);
  return [at(starts[k]), at(starts[k] + STRETCHES[k][0])];
};

layout.run = { start: 70, finish: Math.round(L - RUN_OUT) };
// No walls anywhere: the ground's own walls are the bounds.
layout.walls = { gaps: wallGaps([], L) };
// Kickers with flanks, hit from any angle: on the top of two climbs, and one in the valley.
const kicker = (s: number, height: number): RampDef => ({ s, height, length: 14, back: 10, flank: 8 });
layout.ramps = [kicker(stretch('a climb to a crest')[1] - 30, 1.8), kicker(stretch('a climb to a kicker')[1] - 25, 2.4), kicker(stretch('the valley')[0] + 120, 1.5)];
// Snow-capped rocks and ridges on the piste, not many: go round left or right, or crash. A rock is
// a solid prop (size: across, high, along); a ridge is a long one. None on a kicker's approach or
// landing, in the moguls across the piste, or near the grid and the finish.
const rock = (name: string, from: number, lateral: number, across: number, high: number, along: number): PropDef => ({ kind: 'rock', s: stretch(name)[0] + from, lateral, size: [across, high, along] });
// A gate over the start and the finish: a post either side of the piste, just off it (solid, like
// any prop on the road's line: drive between them). The snow skin draws the arch and its banner.
const gate = (s: number): PropDef[] => {
  const half = baked.width[Math.round(s / baked.step)] / 2;
  return [-1, 1].map((side) => ({ kind: 'gate-post', s, lateral: side * (half + 1.5), size: [0.8, 7, 0.8] as [number, number, number] }));
};
layout.props = [
  ...gate(layout.run.start),
  ...gate(layout.run.finish),
  rock('a bunny slope', 220, 0, 5, 2.4, 5),
  rock('its run-out', 120, -12, 4.5, 2.2, 4.5),
  rock('its run-out', 128, 11, 4, 2, 4),
  rock('rollers, moguls on the right', 200, 3, 3.5, 2, 18),
  rock("the wall's run-out", 150, 6, 6, 3, 6),
  rock('the long winding stretch', 200, 0, 5, 2.6, 5.5),
  rock('the long winding stretch', 480, 4, 3.5, 2.2, 22),
  rock('a canyon on the right', 200, -5, 5, 2.4, 5),
  rock('the valley', 340, 0, 5.5, 2.6, 5),
];
const rollers = stretch('rollers, moguls on the right');
const across = stretch('a bunny slope, moguls across it');
layout.ground = {
  cell: 2.5,
  wallFrom: 80,
  wallRise: 0.9,
  swell: { height: 1.4, size: 45 },
  rough: { height: 2.6, size: 22 },
  moguls: [
    { s: [rollers[0] + 60, rollers[1] - 60], lateral: [6, 50], height: 1.6, spacing: 10 },
    { s: [across[0] + 80, across[0] + 300], lateral: [-30, 30], height: 1.4, spacing: 11 },
  ],
  canyons: [
    { s: stretch('a canyon on the left'), lateral: -48, floor: 12, depth: 6, ease: 40 },
    { s: stretch('a canyon on the right'), lateral: 50, floor: 12, depth: 6, ease: 40 },
  ],
};

const dir = new URL('../content/maps/avalanche/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('slope.track.json', dir), JSON.stringify(layout, null, 1) + '\n');
writeFileSync(
  new URL('map.json', dir),
  JSON.stringify({ id: 'avalanche', name: 'Avalanche', layouts: ['slope'], palette: 'alpine', weather: ['clear', 'snow'], experimental: true }) + '\n',
);
const drop = points[0].p[1] - points[points.length - 1].p[1];
console.log(`slope: one run, ${(L / 1000).toFixed(2)} km, ${drop.toFixed(0)} m of drop, ${points.length} points; start ${layout.run.start} m, finish ${layout.run.finish} m`);
