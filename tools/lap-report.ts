// The AI lap report (SPEC §6): AI drivers race a layout and report lap times, section times,
// crashes and where they happened, so lap length and difficulty are numbers, not guesses. The
// fastest clean hard lap alone on an empty track is the layout's lap floor (for leaderboards).
//
//   bun tools/lap-report.ts                       every layout
//   bun tools/lap-report.ts downtown              one (a map id or a map/layout key)
//   --laps 3  --field (8 AI with traffic and hazards, as a race)  --chaos (the field at chaos)  --seed 7  --json
//   --cars                                        every class's hard lap floor per layout (balance)
//   --car rally                                   the solo lap in that class
//   --weather rain                                in the rain (snow where the map snows)

import { resolveLayout } from '../src/core/content';
import { ALL_MAPS, CLASSES as classes, EXPERIMENTAL_KEYS, LAYOUT_KEYS, layout } from './content';
import { lapReport, zeroTo100, type LapReport } from './lap';

const args = process.argv.slice(2);
/** A flag's value, if the flag is there and has one. */
const value = (flag: string): string | undefined => {
  const k = args.indexOf(flag);
  return k >= 0 && k + 1 < args.length && !args[k + 1].startsWith('--') ? args[k + 1] : undefined;
};
if (args.includes('--help') || args.includes('-h')) {
  console.log('bun tools/lap-report.ts [map/layout] [--laps N] [--field] [--chaos] [--seed N] [--json] [--cars] [--car id] [--weather rain]');
  process.exit(0);
}
const opts = { field: args.includes('--field') || args.includes('--chaos'), seed: Number(value('--seed') ?? 7), laps: Number(value('--laps') ?? 3), mayhem: args.includes('--chaos') ? ('chaos' as const) : ('normal' as const) };
const named = args.find((a, k) => !a.startsWith('-') && !(k > 0 && ['--laps', '--seed', '--car', '--weather'].includes(args[k - 1])));
// An experimental map's layouts only when named (docs/AVALANCHE.md): never in the every-layout run.
const only = named && (resolveLayout(named, [...LAYOUT_KEYS, ...EXPERIMENTAL_KEYS]) ?? named);
const car = value('--car') ?? 'coupe';
const keys = only ? [...LAYOUT_KEYS, ...EXPERIMENTAL_KEYS].filter((key) => key === only) : LAYOUT_KEYS;
if (!keys.length) {
  console.log(`No layout ${only}; there are: ${LAYOUT_KEYS.join(', ')}`);
  process.exit(1);
}

if (args.includes('--cars')) {
  // Balance: every class's hard solo lap on every layout, against the field's mean.
  const rows = classes.map((cls) => ({ cls, runs: keys.map((key) => lapReport(key, layout(key), cls.id, { laps: opts.laps })) }));
  for (let m = 0; m < keys.length; m++) {
    const floors = rows.map((r) => r.runs[m].lapFloor ?? Infinity);
    const mean = floors.filter(Number.isFinite).reduce((a, b, _, all) => a + b / all.length, 0);
    console.log(`${keys[m]} (mean floor ${mean.toFixed(1)} s)`);
    for (const r of rows) {
      const run = r.runs[m];
      const f = run.lapFloor;
      console.log(`  ${r.cls.id.padEnd(7)} floor ${f ? f.toFixed(1).padStart(5) : '  DNF'} s ${f ? `${((f / mean - 1) * 100).toFixed(1).padStart(5)}%` : '      '}  top ${String(run.topKmh).padStart(3)} km/h  wrecks ${run.wrecks.length}`);
    }
  }
  console.log('0–100 km/h: ' + classes.map((c) => `${c.id} ${zeroTo100(c)} s`).join(' · '));
} else {
  const weather = value('--weather') === 'rain' ? ('rain' as const) : ('clear' as const);
  const allowed = (key: string) => ALL_MAPS.find((m) => key.startsWith(m.id + '/'))?.weather;
  const reports: LapReport[] = keys.map((key) => lapReport(key, layout(key), car, { ...opts, weather, weatherAllowed: allowed(key) }));
  if (args.includes('--json')) console.log(JSON.stringify(reports, null, 2));
  else
    for (const r of reports) {
      console.log(`${r.layout} (${r.km} km): ${r.finished ? 'finished' : 'DID NOT FINISH'}, laps ${r.laps.join(', ') || '–'}${r.lapFloor ? `, floor ${r.lapFloor} s` : ''}, top ${r.topKmh} km/h`);
      if (r.sections.length) console.log(`  sections (lap 1): ${r.sections.join(' · ')} s`);
      if (r.wrecks.length) console.log(`  wrecks: ${r.wrecks.map((w) => `${w.cause} @ ${w.spline ? `spline ${w.spline} ` : ''}${w.s}`).join(', ')}`);
      if (r.field) for (const f of r.field) console.log(`  ${f.place || '–'}. ${f.car} (${['easy', 'normal', 'hard'][f.difficulty]}) ${f.time || '–'} s, ${f.wrecks} wrecks, ${f.takedowns} takedowns`);
    }
}
