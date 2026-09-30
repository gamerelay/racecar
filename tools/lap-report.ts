// The AI lap report (SPEC §6): AI drivers race a layout and report lap times, section times,
// crashes and where they happened, so lap length and difficulty are numbers, not guesses. The
// fastest clean hard lap alone on an empty track is the layout's lap floor (for leaderboards).
//
//   bun tools/lap-report.ts                       every layout
//   bun tools/lap-report.ts city/downtown         one
//   --laps 3  --field (8 AI with traffic and hazards, as a race)  --seed 7  --json
//   --cars                                        every class's hard lap floor per layout (balance)
//   --car rally                                   the solo lap in that class

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CarClass, SurfaceDef, TrackLayout } from '../src/core/content';
import { neutralControls } from '../src/core/controls';
import { Cause, Ev } from '../src/core/events';
import { Sim } from '../src/core/sim';
import { bakeTrack } from '../src/core/track/bake';

const root = join(import.meta.dir, '..', 'content');
const args = process.argv.slice(2);
const json = args.includes('--json');
const field = args.includes('--field') && import.meta.main;
const laps = Number(args[args.indexOf('--laps') + 1]) || 3;
const seed = args.includes('--seed') ? Number(args[args.indexOf('--seed') + 1]) : 7;
const only = args.find((a) => a.includes('/') && !a.startsWith('-'));
const surfaces = JSON.parse(readFileSync(join(root, 'surfaces.json'), 'utf8')) as SurfaceDef[];
// The game's order (src/content.ts): the field is built from it.
const classes = ['coupe', 'muscle', 'hatch', 'van', 'sedan', 'rally', 'bus'].map((id) => JSON.parse(readFileSync(join(root, 'cars', `${id}.json`), 'utf8')) as CarClass);
const soloCar = args.includes('--car') ? args[args.indexOf('--car') + 1] : 'coupe';
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

export function lapReport(key: string, layout: TrackLayout, car = soloCar): LapReport {
  const track = bakeTrack(layout, surfaces);
  const sim = new Sim(track, classes, surfaces, { seed, slowmo: 'wreck', traffic: field ? 1 : 0, mayhem: field ? 'normal' : 'off' });
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
function zeroTo100(cls: CarClass): number {
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

if (import.meta.main && args.includes('--cars')) {
  // Balance: every class's hard solo lap on every layout, against the field's mean.
  const keys: [string, TrackLayout][] = [];
  for (const map of readdirSync(join(root, 'maps')))
    for (const f of readdirSync(join(root, 'maps', map)).filter((x) => x.endsWith('.track.json'))) {
      const key = `${map}/${f.replace('.track.json', '')}`;
      if (!only || key === only) keys.push([key, JSON.parse(readFileSync(join(root, 'maps', map, f), 'utf8'))]);
    }
  const rows = classes.map((cls) => ({ cls, runs: keys.map(([key, layout]) => lapReport(key, layout, cls.id)) }));
  for (let m = 0; m < keys.length; m++) {
    const floors = rows.map((r) => r.runs[m].lapFloor ?? Infinity);
    const mean = floors.filter(Number.isFinite).reduce((a, b, _, all) => a + b / all.length, 0);
    console.log(`${keys[m][0]} (mean floor ${mean.toFixed(1)} s)`);
    for (const r of rows) {
      const run = r.runs[m];
      const f = run.lapFloor;
      console.log(`  ${r.cls.id.padEnd(7)} floor ${f ? f.toFixed(1).padStart(5) : '  DNF'} s ${f ? `${((f / mean - 1) * 100).toFixed(1).padStart(5)}%` : '      '}  top ${String(run.topKmh).padStart(3)} km/h  wrecks ${run.wrecks.length}`);
    }
  }
  console.log('0–100 km/h: ' + classes.map((c) => `${c.id} ${zeroTo100(c)} s`).join(' · '));
} else if (import.meta.main) {
  const reports: LapReport[] = [];
  for (const map of readdirSync(join(root, 'maps'))) {
    for (const f of readdirSync(join(root, 'maps', map)).filter((x) => x.endsWith('.track.json'))) {
      const key = `${map}/${f.replace('.track.json', '')}`;
      if (only && key !== only) continue;
      reports.push(lapReport(key, JSON.parse(readFileSync(join(root, 'maps', map, f), 'utf8'))));
    }
  }
  if (json) console.log(JSON.stringify(reports, null, 2));
  else
    for (const r of reports) {
      console.log(`${r.layout} (${r.km} km): ${r.finished ? 'finished' : 'DID NOT FINISH'}, laps ${r.laps.join(', ') || '–'}${r.lapFloor ? `, floor ${r.lapFloor} s` : ''}, top ${r.topKmh} km/h`);
      if (r.sections.length) console.log(`  sections (lap 1): ${r.sections.join(' · ')} s`);
      if (r.wrecks.length) console.log(`  wrecks: ${r.wrecks.map((w) => `${w.cause} @ ${w.spline ? `spline ${w.spline} ` : ''}${w.s}`).join(', ')}`);
      if (r.field) for (const f of r.field) console.log(`  ${f.place || '–'}. ${f.car} (${['easy', 'normal', 'hard'][f.difficulty]}) ${f.time || '–'} s, ${f.wrecks} wrecks, ${f.takedowns} takedowns`);
    }
}
