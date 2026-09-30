// Re-runs an F8 report headless (SPEC §14): rebuilds the sim from the report's layout, cars, seed
// and tuning, restores the snapshot at the start of the window, feeds back every recorded input,
// and prints what happened, tick by tick around the events, plus whether the replay ended where
// the game did.
//
//   bun tools/replay.ts                         the latest report
//   bun tools/replay.ts telemetry/reports/x.json
//   add --trace to print the focus car every 10 ticks

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TUNING } from '../src/core/car/tuning';
import type { CarClass, SurfaceDef } from '../src/core/content';
import { neutralControls, unpackControls, type Controls } from '../src/core/controls';
import { EV_NAMES } from '../src/core/events';
import { Sim } from '../src/core/sim';
import { bakeTrack } from '../src/core/track/bake';
import type { Report } from '../src/telemetry/telemetry';

const root = join(import.meta.dir, '..');
const args = process.argv.slice(2);
const trace = args.includes('--trace');
let file = args.find((a) => a.endsWith('.json'));
if (!file) {
  const dir = join(root, 'telemetry', 'reports');
  const all = existsSync(dir) ? readdirSync(dir).map((f) => join(dir, f)) : [];
  file = all.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs).pop();
}
if (!file) {
  console.log('No reports yet: press F8 in the game.');
  process.exit(0);
}

const report = JSON.parse(readFileSync(file, 'utf8')) as Report;
const surfaces = JSON.parse(readFileSync(join(root, 'content', 'surfaces.json'), 'utf8')) as SurfaceDef[];
const classes = ['coupe', 'muscle', 'hatch', 'van'].map((id) => JSON.parse(readFileSync(join(root, 'content', 'cars', `${id}.json`), 'utf8')) as CarClass);
Object.assign(TUNING, report.tuning);

const sim = new Sim(bakeTrack(report.layout, surfaces), classes, surfaces, { ...(report.options ?? {}), seed: report.seed, slowmo: report.options?.slowmo ?? 'world' });
for (const spec of report.cars) sim.addCar(spec);
sim.restore(report.start);

const focus = report.cars.findIndex((c) => c.human);
const inputs: (Controls | undefined)[] = report.cars.map((c) => (c.human ? neutralControls() : undefined));
const byTick = new Map<number, Report['inputs']>();
for (const x of report.inputs) byTick.set(x.tick, [...(byTick.get(x.tick) ?? []), x]);

console.log(`${file.replace(root + '/', '')}`);
console.log(`"${report.note || '(no note)'}"  ${report.createdAt} · ${report.build} · layout ${report.layout.id} ${report.layoutVersion}`);
console.log(`replaying ticks ${report.start.tick}–${report.end.tick} (${((report.end.tick - report.start.tick) / 60).toFixed(1)} s), ${report.cars.length} cars, focus car ${focus}`);

let cursor = sim.events.head;
while (sim.tick < report.end.tick) {
  for (const x of byTick.get(sim.tick) ?? []) unpackControls(x.c, inputs[x.car]!);
  sim.step(inputs);
  cursor = sim.events.read(cursor, (e) => {
    if (e.car !== focus && e.other !== focus) return;
    const c = inputs[focus]!;
    console.log(
      `  ${((e.tick - report.start.tick) / 60).toFixed(2).padStart(6)} s  ${EV_NAMES[e.type].padEnd(12)} a=${e.a.toFixed(2)} b=${e.b}${e.other >= 0 ? ` other=${e.other}` : ''}   input steer ${c.steer.toFixed(2)} thr ${c.throttle} brk ${c.brake}${c.drift ? ' drift' : ''}${c.boost ? ' boost' : ''}`,
    );
  });
  if (trace && sim.tick % 10 === 0) {
    const k = sim.cars;
    console.log(`  t=${((sim.tick - report.start.tick) / 60).toFixed(2)} v=${(Math.hypot(k.vx[focus], k.vz[focus]) * 3.6).toFixed(0)} km/h s=${k.s[focus].toFixed(1)} lat=${k.lateral[focus].toFixed(2)} slip=${k.slip[focus].toFixed(2)} yaw=${k.yaw[focus].toFixed(2)} drift=${k.drift[focus]} stage=${k.driftStage[focus]}`);
  }
}
const k = sim.cars;
const dx = Math.hypot(k.x[focus] - report.end.x, k.z[focus] - report.end.z);
console.log(`end: replay is ${dx.toFixed(3)} m from where the game was${dx < 0.01 ? ' (exact)' : dx < 1 ? ' (close)' : ' (diverged: different engine, or state outside the snapshot)'}`);
