// Validates every layout under content/maps (SPEC §5, "Validation"). Exits non-zero on errors,
// so CI fails on a broken track.
//
//   bun tools/validate.ts

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CLASS_ORDER } from '../src/core/content';
import { bakeTrack } from '../src/core/track/bake';
import { validateLayout } from '../src/core/track/validate';
import { CLASSES, CONTENT, EXPERIMENTAL_KEYS, LAYOUT_KEYS, SURFACES, layout } from './content';
import { lapReport } from './lap';

// --ai also has the hard AI drive every layout (SPEC §5): it must finish, and its lap (the lap
// floor, the fastest anyone should manage) is printed; under 55 s is a warning (people lap ~15%
// slower, and full layouts aim for 70–100 s).
const ai = process.argv.includes('--ai');

let errors = 0;
// Every car file is a class the game loads (CLASS_ORDER), and every class has a file.
const files = readdirSync(join(CONTENT, 'cars'))
  .filter((f) => f.endsWith('.json') && f !== 'paints.json')
  .map((f) => f.replace('.json', ''))
  .sort();
if (files.join() !== [...CLASS_ORDER].sort().join()) {
  console.log(`✗ content/cars (${files.join(', ')}) doesn't match CLASS_ORDER (${CLASS_ORDER.join(', ')}) in src/core/content.ts`);
  errors++;
}
// The experimental maps too: Paradise Open is where the engine's pieces, features and walls are.
for (const key of [...LAYOUT_KEYS, ...EXPERIMENTAL_KEYS]) {
  const track = layout(key);
  const problems = validateLayout(track, SURFACES, CLASSES);
  const L = problems.some((p) => p.level === 'error') ? 0 : bakeTrack(track, SURFACES).main.length;
  console.log(`${key}: ${L ? `${(L / 1000).toFixed(2)} km, ` : ''}${problems.length ? `${problems.length} problem(s)` : 'ok'}`);
  if (ai && !problems.some((p) => p.level === 'error')) {
    const r = lapReport(key, track);
    if (!r.finished) problems.push({ level: 'error', message: `the AI couldn't finish 3 laps` });
    else {
      console.log(`  AI lap floor ${r.lapFloor} s (hard AI, every shortcut, empty track)`);
      if (r.lapFloor! < 55) problems.push({ level: 'warning', message: `lap floor ${r.lapFloor} s is short: people will lap in ~${Math.round(r.lapFloor! * 1.15)} s; full layouts aim for 70–100 s` });
    }
  }
  // Every override, with its reason: each is a to-do for the engine (docs/CALDERA.md, "Overrides").
  for (const o of track.overrides ?? []) console.log(`  override ${o.id}: ${o.reason}`);
  for (const p of problems) {
    console.log(`  ${p.level === 'error' ? '✗' : '!'} ${p.message}${p.s !== undefined ? ` (${p.spline} @ ${p.s.toFixed(0)} m)` : ''}`);
    if (p.level === 'error') errors++;
  }
}
process.exit(errors ? 1 : 0);
