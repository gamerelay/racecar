// Validates every layout under content/maps (SPEC §5, "Validation"). Exits non-zero on errors,
// so CI fails on a broken track.
//
//   bun tools/validate.ts

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CarClass, SurfaceDef, TrackLayout } from '../src/core/content';
import { bakeTrack } from '../src/core/track/bake';
import { validateLayout } from '../src/core/track/validate';

const root = join(import.meta.dir, '..', 'content');
const surfaces = JSON.parse(readFileSync(join(root, 'surfaces.json'), 'utf8')) as SurfaceDef[];
const classes = readdirSync(join(root, 'cars'))
  .filter((f) => f.endsWith('.json') && f !== 'paints.json')
  .map((f) => JSON.parse(readFileSync(join(root, 'cars', f), 'utf8')) as CarClass);

let errors = 0;
for (const map of readdirSync(join(root, 'maps'))) {
  for (const f of readdirSync(join(root, 'maps', map)).filter((x) => x.endsWith('.track.json'))) {
    const layout = JSON.parse(readFileSync(join(root, 'maps', map, f), 'utf8')) as TrackLayout;
    const problems = validateLayout(layout, surfaces, classes);
    const L = problems.some((p) => p.level === 'error') ? 0 : bakeTrack(layout, surfaces).main.length;
    console.log(`${map}/${f}: ${L ? `${(L / 1000).toFixed(2)} km, ` : ''}${problems.length ? `${problems.length} problem(s)` : 'ok'}`);
    for (const p of problems) {
      console.log(`  ${p.level === 'error' ? '✗' : '!'} ${p.message}${p.s !== undefined ? ` (${p.spline} @ ${p.s.toFixed(0)} m)` : ''}`);
      if (p.level === 'error') errors++;
    }
  }
}
process.exit(errors ? 1 : 0);
