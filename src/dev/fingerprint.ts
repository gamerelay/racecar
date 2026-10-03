// Golden fingerprints (docs/CALDERA.md, step 0): what a layout bakes to and how a fixed drive on
// it goes, hashed to the last bit. A clean-up must leave every map's fingerprint identical; a
// change meant to move a map re-records it (`bun tools/fingerprint.ts --update`), and the diff
// says which part moved. test/golden.test.ts checks them.

import type { CarClass, SurfaceDef, TrackLayout } from '../core/content';
import { CAR_FIELDS } from '../core/car/pool';
import { Ev } from '../core/events';
import { Sim } from '../core/sim';
import { bakeTrack } from '../core/track/bake';
import { Hasher, hashOf } from './hash';

/** The fixed drive: the hard AI in a coupe, alone, no traffic or hazards, clear, this long. */
export const DRIVE_SECONDS = 40;
const SEED = 7;

export interface Fingerprint {
  /** Everything the bake made but the ground: every road's samples, checkpoints, zones, pines… */
  track: string;
  /** The open ground (heights, decks, holes, beaches…), or null for a layout without one. */
  ground: string | null;
  /** Every field of the car, every tick of the drive. */
  drive: string;
  /** Where the car was every 10 s (rounded: a readable hint at what moved when `drive` does). */
  marks: { t: number; s: number; x: number; y: number; z: number; kmh: number }[];
  wrecks: number;
}

export function fingerprint(layout: TrackLayout, classes: CarClass[], surfaces: SurfaceDef[]): Fingerprint {
  const track = bakeTrack(layout, surfaces);
  const sim = new Sim(track, classes, surfaces, { seed: SEED, traffic: 0, mayhem: 'off', weather: 'clear' });
  sim.addCar({ cls: 'coupe', racer: { difficulty: 2 } });
  sim.startRace(3, 0.1);
  const h = new Hasher();
  const c = sim.cars;
  const marks: Fingerprint['marks'] = [];
  let wrecks = 0;
  let cursor = 0;
  const ticks = DRIVE_SECONDS * 60;
  for (let t = 1; t <= ticks; t++) {
    sim.step([]);
    for (const f of CAR_FIELDS) h.typed(c[f].subarray(0, c.count));
    cursor = sim.events.read(cursor, (e) => {
      if (e.type === Ev.Wreck) wrecks++;
    });
    if (t % 600 === 0) {
      const r = (v: number) => Math.round(v * 100) / 100;
      marks.push({ t: t / 60, s: r(c.s[0]), x: r(c.x[0]), y: r(c.y[0]), z: r(c.z[0]), kmh: r(Math.hypot(c.vx[0], c.vz[0]) * 3.6) });
    }
  }
  return {
    track: hashOf(track, ['ground', 'layout']),
    ground: track.ground ? hashOf(track.ground) : null,
    drive: h.hex(),
    marks,
    wrecks,
  };
}
