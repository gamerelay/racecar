// Generator for Avalanche's Slope (docs/AVALANCHE.md): one run down a mountain, top
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
import type { PropDef, RampDef, SlalomGate, TrackLayout, TrackPoint } from '../src/core/content';
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
  [180, 0.42, "the ski jump's in-run"],
  [26, 0, "the ski jump's lip"],
  [260, 0.5, 'the landing hill'],
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
/** The ski jump: from the in-run's foot to the landing hill's top, where the road is sharp, straight and level across. */
const jumpAt = (name: string) => starts[STRETCHES.findIndex(([, , what]) => what === name)];
const LIP = [jumpAt("the ski jump's lip"), jumpAt('the landing hill')] as const;
/** How far `s` is from the lip (0 on it). */
const fromLip = (s: number) => Math.max(0, LIP[0] - s, s - LIP[1]);
/** The grade smoothed over about ±`sigma` m: pitches ease in and out. At the lip, hardly at all: an edge to fly off. */
const smoothGrade = (s: number, sigma = 3 + 25 * Math.min(1, fromLip(s) / 60)) => {
  let sum = 0;
  let w = 0;
  for (let u = -3 * sigma; u <= 3 * sigma; u += sigma < 10 ? 0.5 : 2) {
    const k = Math.exp(-(u * u) / (2 * sigma * sigma));
    sum += gradeAt(Math.min(total, Math.max(0, s + u))) * k;
    w += k;
  }
  return sum / w;
};
/** The heading (radians, 0 is +z) at `s`: slow winds, straight on the start pad and in the valley. */
const heading = (s: number) => winding(straightJump(s));
/**
 * The ski jump runs straight: the heading holds from 80 m above the in-run (the crest's kicker
 * launches down it too) to 40 m past the landing hill's top.
 */
const JUMP_STRAIGHT = [jumpAt("the ski jump's in-run") - 80, LIP[1] + 40] as const;
const straightJump = (s: number) => (s < JUMP_STRAIGHT[0] ? s : s < JUMP_STRAIGHT[1] ? JUMP_STRAIGHT[0] : s - (JUMP_STRAIGHT[1] - JUMP_STRAIGHT[0]));
const winding = (s: number) => {
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
  // Denser over the jump, so the lip stays an edge.
  if (s % EVERY === 0 || s === total || (fromLip(s) < 30 && s % 4 === 0)) {
    const turn = (heading(s + 5) - heading(s - 5)) / 10;
    // Into its turns (a right turn is the heading falling: its right edge down), and a small tilt
    // between them that switches side to side; none on the start pad or in the valley.
    // (And none down the ski jump's in-run, over its lip and where you land: level across, so you fly straight.)
    const jump = Math.max(0, jumpAt("the ski jump's in-run") - s, s - LIP[1] - 60);
    const calm = Math.max(0, Math.min(1, (s - 60) / 200, (total - s - 150) / 300, jump / 80));
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
// The ski jump: its lip's edge and the landing hill, and a judges' tower beside the lip (a solid
// prop; snow.ts draws it).
const lip = stretch("the ski jump's lip")[1];
layout.skiJump = { lip, landing: stretch('the landing hill')[1] - lip };
const tower: PropDef = { kind: 'jump-tower', s: lip - 12, lateral: -(baked.width[Math.round((lip - 12) / baked.step)] / 2 + 9), size: [5, 16, 5] };
layout.props = [
  tower,
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
// Slalom gates (core/rules/slalom.ts) down the bunny slopes and the winding stretch: weaving left
// and right of the line into the turn ahead, a little wider on the bunny slopes, none within 30 m of
// a rock or in the moguls across the second bunny slope.
const inside = (s: number) => {
  // How far the road ahead (40 m on) lies to this point's right: the turn's inside.
  const i = Math.round(s / baked.step);
  const j = Math.min(baked.n - 1, i + Math.round(40 / baked.step));
  return (baked.px[j] - baked.px[i]) * -baked.tz[i] + (baked.pz[j] - baked.pz[i]) * baked.tx[i];
};
const gates = (name: string, at: number[], gap: number): SlalomGate[] =>
  at.map((from, k) => {
    const s = stretch(name)[0] + from;
    const room = baked.width[Math.round(s / baked.step)] / 2 - gap / 2 - 2;
    const lateral = Math.max(-room, Math.min(room, inside(s) * 0.5 + (k % 2 ? 4 : -4)));
    return { s, lateral: Math.round(lateral * 10) / 10, gap };
  });
layout.slalom = [
  ...gates('a bunny slope', [70, 120, 170, 270, 320], 14),
  ...gates('the long winding stretch', [50, 100, 150, 260, 310, 360, 410, 560, 610, 660], 11),
  ...gates('a bunny slope, moguls across it', [330, 380, 430], 13),
];
// The avalanche, at chaos (core/world/avalanche.ts): it breaks away 80 m above the start line 4 s
// after the green light. At 56 m/s on a 20% slope it buries a car that's wrecked behind it (about
// one a race in the lap report's chaos field) and not the bus at the back on a clean run.
layout.avalanche = { behind: 70, delay: 7, speed: 65 };
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
  // Pines off the piste (core/track/pines.ts), sparse (the owner: a tenth of the first forest, so the
  // slopes stay open to drive up): none within 8 m of its edge, more 40 m on and up the walls, in
  // groups about 90 m across.
  pines: { seed: 17, spacing: 7, clear: 8, thicken: 40, density: 0.06, glade: 90 },
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
  JSON.stringify({ id: 'avalanche', name: 'Avalanche', layouts: ['slope'], palette: 'alpine', weather: ['clear', 'snow'] }) + '\n',
);
const drop = points[0].p[1] - points[points.length - 1].p[1];
console.log(`slope: one run, ${(L / 1000).toFixed(2)} km, ${drop.toFixed(0)} m of drop, ${points.length} points; start ${layout.run.start} m, finish ${layout.run.finish} m`);
