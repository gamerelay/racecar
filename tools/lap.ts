// The AI lap report's engine (SPEC §6): AI drivers race a layout and report lap times, section
// times, crashes and where they happened. The CLI is tools/lap-report.ts; validate and the tests
// call this directly.

import { CLASSES as classes, SURFACES as surfaces } from './content';
import type { CarClass, TrackLayout } from '../src/core/content';
import { neutralControls } from '../src/core/controls';
import { Cause, Ev } from '../src/core/events';
import { Sim } from '../src/core/sim';
import { bakeTrack } from '../src/core/track/bake';

const CAUSE: Record<number, string> = Object.fromEntries(Object.entries(Cause).map(([k, v]) => [v, k.toLowerCase()]));

export interface LapReport {
  layout: string;
  km: number;
  laps: number[];
  lapFloor: number | null;
  sections: number[];
  wrecks: { cause: string; spline: number; s: number }[];
  topKmh: number;
  finished: boolean;
  field?: { place: number; car: string; difficulty: number; time: number; wrecks: number; takedowns: number }[];
}

export interface LapOptions {
  /** 8 AI with traffic and hazards, as a race (else one hard AI alone, the lap floor). */
  field?: boolean;
  /** The room's seed. */
  seed?: number;
  laps?: number;
  /** A field's mayhem (default normal; a solo lap has none). */
  mayhem?: 'normal' | 'chaos';
  /** Rain (snow on a map where it snows), with the map's allowed weather; default clear. */
  weather?: 'clear' | 'rain';
  weatherAllowed?: string[];
}

/** A race of `car` (solo) or a field on `layout`, reported. */
export function lapReport(key: string, layout: TrackLayout, car = 'coupe', opts: LapOptions = {}): LapReport {
  const { field = false, seed = 7, laps = 3, mayhem = 'normal', weather = 'clear', weatherAllowed } = opts;
  const track = bakeTrack(layout, surfaces);
  const sim = new Sim(track, classes, surfaces, { seed, slowmo: 'wreck', traffic: field ? 1 : 0, mayhem: field ? mayhem : 'off', weather, weatherAllowed });
  const cars = field ? 8 : 1;
  for (let k = 0; k < cars; k++) sim.addCar({ cls: field ? classes[k % classes.length].id : car, racer: { difficulty: field ? ((k % 3) as 0 | 1 | 2) : 2 } });
  sim.startRace(laps, 0.1);
  const out: LapReport = { layout: key, km: +(track.main.length / 1000).toFixed(2), laps: [], lapFloor: null, sections: [], wrecks: [], topKmh: 0, finished: false };
  let cursor = 0;
  let cpTick = 0;
  const limit = 60 * 60 * 3 * laps;
  while (sim.tick < limit) {
    sim.step([]);
    const c = sim.cars;
    out.topKmh = Math.max(out.topKmh, Math.hypot(c.vx[0], c.vz[0]) * 3.6);
    cursor = sim.events.read(cursor, (e) => {
      if (e.type === Ev.Wreck) out.wrecks.push({ cause: CAUSE[e.b] ?? String(e.b), spline: c.spline[e.car], s: Math.round(c.s[e.car]) });
      if (e.car !== 0) return;
      if (e.type === Ev.Lap) out.laps.push(+e.a.toFixed(2));
      if (e.type === Ev.Checkpoint && out.laps.length === 0) {
        out.sections.push(+((e.tick - cpTick) / 60).toFixed(1));
        cpTick = e.tick;
      }
    });
    if (field ? sim.race.finishedCount === cars : c.finished[0]) {
      out.finished = true;
      break;
    }
  }
  if (!field && out.laps.length) out.lapFloor = Math.min(...out.laps);
  if (field) {
    const c = sim.cars;
    out.field = Array.from({ length: cars }, (_, i) => ({ place: c.place[i], car: classes[c.cls[i]].id, difficulty: i % 3, time: +c.finishTime[i].toFixed(1), wrecks: c.wrecks[i], takedowns: c.takedowns[i] })).sort((a, b) => (a.place || 99) - (b.place || 99));
  }
  out.topKmh = Math.round(out.topKmh);
  return out;
}

/** Seconds from a standstill to 100 km/h on the flat, full throttle, no boost. */
export function zeroTo100(cls: CarClass): number {
  const layout: TrackLayout = { id: 'strip', name: 'Strip', main: { points: [0, 1, 2, 3].map((k) => ({ p: [0, 0, k * 400] as [number, number, number], width: 30 })) } };
  const sim = new Sim(bakeTrack(layout, surfaces), classes, surfaces, { seed: 1 });
  const i = sim.addCar({ cls: cls.id, human: true });
  sim.placeCar(i, 0, 20, 0, 0);
  const c = { ...neutralControls(), throttle: 1 };
  for (let t = 0; t < 60 * 20; t++) {
    sim.step([c]);
    if (Math.hypot(sim.cars.vx[i], sim.cars.vz[i]) * 3.6 >= 100) return +(t / 60).toFixed(2);
  }
  return Infinity;
}
