// Golden fingerprints (docs/CALDERA.md, step 0): what a layout bakes to and how cars drive on it,
// hashed to the last bit. A clean-up must leave every map's fingerprint identical; a change meant
// to move a map re-records it (`bun tools/fingerprint.ts --update`), and the diff says which part
// moved. test/golden.test.ts checks them.
//
// They fingerprint behaviour, not how it's stored: the ground by the answers to its questions
// (asked along every road and over a grid), so moving decks onto pieces (step 1a) can keep them
// identical while the data's shape changes. One recording for every platform: the sim does its own
// math (src/core/math.ts), so the bits don't depend on the OS or CPU.

import type { CarClass, SurfaceDef, TrackLayout } from '../core/content';
import type { Ground } from '../core/track/ground';
import { CAR_FIELDS } from '../core/car/pool';
import { Ev } from '../core/events';
import { Sim } from '../core/sim';
import { bakeTrack, type Track } from '../core/track/bake';
import { newHit, sampleAt, surfaceAt } from '../core/track/query';
import { Hasher, hashOf } from './hash';

/** The fixed drive: the hard AI in a coupe, alone, no traffic or hazards, clear, this long. */
export const DRIVE_SECONDS = 40;
/** And down each branch, from its start, this long. */
export const BRANCH_SECONDS = 15;
const SEED = 7;

export interface Fingerprint {
  /** The roads the bake made (every sample of every spline), the checkpoints, props and trees. */
  track: string;
  /**
   * The open ground, by its answers: height, slope, decks, what's on top at a few heights, the
   * coast, the lava, in bounds; along every road (at its middle, edges and past its shoulder) and
   * over a grid. Null for a layout without one.
   */
  ground: string | null;
  /** Every field of the car, every tick of the fixed drive. */
  drive: string;
  /** The same, for a drive down each branch from its start (null with none). */
  branches: string | null;
  /** Where the car was every 10 s of the fixed drive (rounded: a readable hint at what moved). */
  marks: { t: number; s: number; x: number; y: number; z: number; kmh: number }[];
  wrecks: number;
}

export function fingerprint(layout: TrackLayout, classes: CarClass[], surfaces: SurfaceDef[]): Fingerprint {
  const track = bakeTrack(layout, surfaces);
  const marks: Fingerprint['marks'] = [];
  const main = drive(track, classes, surfaces, 0, DRIVE_SECONDS, marks);
  let branches: string | null = null;
  if (track.splines.length > 1) {
    const h = new Hasher();
    for (let b = 1; b < track.splines.length; b++) h.str(drive(track, classes, surfaces, b, BRANCH_SECONDS).hash);
    branches = h.hex();
  }
  return {
    track: hashOf({ splines: track.splines, checkpoints: track.checkpoints, props: track.props, pines: track.pines, run: track.run }, ['ground']),
    ground: track.ground ? groundHash(track) : null,
    drive: main.hash,
    branches,
    marks,
    wrecks: main.wrecks,
  };
}

/** The hard AI from the grid (`spline` 0), or from a branch's start, hashed every tick. */
function drive(track: Track, classes: CarClass[], surfaces: SurfaceDef[], spline: number, seconds: number, marks?: Fingerprint['marks']): { hash: string; wrecks: number } {
  const sim = new Sim(track, classes, surfaces, { seed: SEED, traffic: 0, mayhem: 'off', weather: 'clear' });
  sim.addCar({ cls: 'coupe', racer: { difficulty: 2 } });
  sim.startRace(3, 0.1);
  if (spline > 0) {
    // Through the countdown first, then onto the branch, moving.
    while (sim.race.phase === 'countdown') sim.step([]);
    sim.placeCar(0, spline, 2, 0, 25);
  }
  const h = new Hasher();
  const c = sim.cars;
  let wrecks = 0;
  let cursor = 0;
  const ticks = seconds * 60;
  for (let t = 1; t <= ticks; t++) {
    sim.step([]);
    for (const f of CAR_FIELDS) h.typed(c[f].subarray(0, c.count));
    cursor = sim.events.read(cursor, (e) => {
      if (e.type === Ev.Wreck) wrecks++;
    });
    if (marks && t % 600 === 0) {
      const r = (v: number) => Math.round(v * 100) / 100;
      marks.push({ t: t / 60, s: r(c.s[0]), x: r(c.x[0]), y: r(c.y[0]), z: r(c.z[0]), kmh: r(Math.hypot(c.vx[0], c.vz[0]) * 3.6) });
    }
  }
  return { hash: h.hex(), wrecks };
}

/** Points across the ground (each way) where its questions are asked, besides along the roads. */
const QUERY_GRID = 128;
/** Along each road, every this many meters. */
const ROAD_STEP = 1;

/** The ground's answers (see `Fingerprint.ground`). */
export function groundHash(track: Track): string {
  const g = track.ground!;
  const h = new Hasher();
  h.num(g.sea ?? NaN);
  h.num(g.face ?? NaN);
  const slope = { x: 0, z: 0 };
  const hit = newHit();
  const shoulder = track.surfaceIndex.get(track.layout.shoulderSurface ?? 'sidewalk') ?? 0;
  // Along every road: its middle, its edges, and past its shoulder on both sides, a little over
  // it and well over it (a car in the air, or on a slope over a tunnel).
  for (const sp of track.splines)
    for (let s = 0; s <= sp.length; s += ROAD_STEP) {
      const k = Math.min(sp.n - 1, Math.round(s / sp.step));
      const half = sp.width[k] / 2;
      const edge = half + sp.shoulder[k];
      sampleAt(sp, s, hit);
      for (const l of [0, -half, half, -edge - 1, edge + 1]) {
        const x = sp.px[k] - sp.tz[k] * l;
        const z = sp.pz[k] + sp.tx[k] * l;
        for (const up of [0.3, 3]) ask(g, h, x, sp.py[k] + up, z, slope);
        // And what a car there drives on, dry and wet (the beaches, the verges).
        hit.lateral = l;
        h.num(surfaceAt(track, hit, false, shoulder));
        h.num(surfaceAt(track, hit, true, shoulder));
      }
    }
  // And over a grid, a third of the way between its points (off the heightfield's own points, so
  // the bilinear heights and the decks' planes are asked between them).
  const w = g.nx * g.cell;
  const d = g.nz * g.cell;
  for (let a = 0; a < QUERY_GRID; a++)
    for (let b = 0; b < QUERY_GRID; b++) {
      const x = g.x0 + ((a + 0.33) / QUERY_GRID) * w;
      const z = g.z0 + ((b + 0.33) / QUERY_GRID) * d;
      ask(g, h, x, g.height(x, z) + 1, z, slope);
    }
  return h.hex();
}

/** Everything the ground answers about one point, for something at height `y`. */
function ask(g: Ground, h: Hasher, x: number, y: number, z: number, slope: { x: number; z: number }): void {
  h.num(g.height(x, z));
  g.slope(x, z, slope);
  h.num(slope.x);
  h.num(slope.z);
  h.num(g.deck(x, z));
  h.num(g.deck(x, z, 2, y));
  h.num(g.deckUnder(x, z, y));
  h.num(g.top(x, z));
  h.num(g.top(x, z, y));
  g.topSlope(x, z, y, slope);
  h.num(slope.x);
  h.num(slope.z);
  h.num(g.coast(x, z));
  h.byte(g.outside(x, z) ? 1 : 0);
  h.byte(g.inLava(x, z, y) ? 1 : 0);
  h.byte(g.inLava(x, z, g.height(x, z)) ? 1 : 0);
}
