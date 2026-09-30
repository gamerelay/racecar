// The AI lap report (SPEC §6): AI drivers race a layout and report lap times, section times,
// crashes and where they happened, so lap length and difficulty are numbers, not guesses. The
// fastest clean hard lap alone on an empty track is the layout's lap floor (for leaderboards).
//
//   bun tools/lap-report.ts                       every layout
//   bun tools/lap-report.ts city/downtown         one
//   --laps 3  --field (8 AI with traffic and hazards, as a race)  --json

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CarClass, SurfaceDef, TrackLayout } from '../src/core/content';
import { Cause, Ev } from '../src/core/events';
import { Sim } from '../src/core/sim';
import { bakeTrack } from '../src/core/track/bake';

const root = join(import.meta.dir, '..', 'content');
const args = process.argv.slice(2);
const json = args.includes('--json');
const field = args.includes('--field') && import.meta.main;
const laps = Number(args[args.indexOf('--laps') + 1]) || 3;
const only = args.find((a) => a.includes('/') && !a.startsWith('-'));
const surfaces = JSON.parse(readFileSync(join(root, 'surfaces.json'), 'utf8')) as SurfaceDef[];
const classes = ['coupe', 'muscle', 'hatch', 'van'].map((id) => JSON.parse(readFileSync(join(root, 'cars', `${id}.json`), 'utf8')) as CarClass);
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

export function lapReport(key: string, layout: TrackLayout): LapReport {
  const track = bakeTrack(layout, surfaces);
  const sim = new Sim(track, classes, surfaces, { seed: 7, slowmo: 'wreck', traffic: field ? 1 : 0, mayhem: field ? 'normal' : 'off' });
  const cars = field ? 8 : 1;
  for (let k = 0; k < cars; k++) sim.addCar({ cls: field ? classes[k % 4].id : 'coupe', racer: { difficulty: field ? ((k % 3) as 0 | 1 | 2) : 2 } });
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

if (import.meta.main) {
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
