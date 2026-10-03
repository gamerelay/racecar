// A picture of any spot, headless (docs/CALDERA.md, "Developer tools"): a car on a road, seen from a
// camera you choose, rendered by the game's own renderer through the poster studio's scout page
// (src/viewer/poster.ts) in headless Chrome. Needs the dev server running (`bun run dev`).
//
//   bun tools/shot.ts paradise-open/open --road lava-tube --s 60                 the tube's mouth, chase camera
//   bun tools/shot.ts paradise-open/open --road lava-tube --s 231 --cam high     the jump from above and behind
//   bun tools/shot.ts paradise-open/open --s 2600,2650,2700 --cam side           a contact sheet, one frame per s
//   bun tools/shot.ts avalanche/slope --s 1200 --cam top --out /tmp/top.png
//
//   --road id|index (default the main road)  --s m[,m…]  --lat m  --class coupe
//   --cam chase|high|side|top|front, or by hand: --back m --up m --side m --ahead m --fov deg
//   --w px --h px  --out file (default telemetry/shots/<map>-<s>.png)  --port 5178

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { bakeTrack } from '../src/core/track/bake';
import { roadIndex } from '../src/dev/drive';
import { args } from './lib/args';
import { SURFACES, layout } from './content';

/** Cameras, as the scout page takes them: meters behind the car, above it, beside it, and how far ahead it looks. */
const CAMS: Record<string, { back: number; up: number; side: number; ahead: number; fov: number }> = {
  chase: { back: 9, up: 3, side: 0, ahead: 20, fov: 55 },
  high: { back: 30, up: 18, side: 0, ahead: 15, fov: 55 },
  side: { back: 0, up: 4, side: 18, ahead: 0.1, fov: 55 },
  top: { back: 0.5, up: 90, side: 0, ahead: 1, fov: 50 },
  front: { back: -14, up: 3, side: 0, ahead: -20, fov: 55 },
};

const a = args();
const key = a.rest()[0];
const s = a.str('s');
if (!key || !s) {
  console.error('usage: bun tools/shot.ts <map/layout> --s m[,m…] [--road id] [--lat m] [--cam chase|high|side|top|front] [--out file] [--port 5178]');
  process.exit(2);
}
const track = bakeTrack(layout(key), SURFACES);
const spline = roadIndex(track, a.str('road'));
const cam = { ...CAMS[a.str('cam') ?? 'chase'] };
if (!CAMS[a.str('cam') ?? 'chase']) throw new Error(`--cam is one of ${Object.keys(CAMS).join(', ')}`);
for (const k of ['back', 'up', 'side', 'ahead', 'fov'] as const) cam[k] = a.num(k) ?? cam[k];
const q = new URLSearchParams({ scout: key, s, spline: String(spline), lat: String(a.num('lat') ?? 0), cls: a.str('class') ?? 'coupe' });
for (const [k, v] of Object.entries(cam)) q.set(k, String(v));
for (const k of ['w', 'h']) {
  const v = a.num(k);
  if (v !== undefined) q.set(k, String(v));
}
const out = a.str('out') ?? join('telemetry', 'shots', `${key.replace('/', '-')}-${s.split(',')[0]}.png`);
const port = a.str('port') ?? '5178';
const r = spawnSync('bun', [join(import.meta.dir, 'poster.ts'), '--url', `poster.html?${q}`, '--out', out, '--port', port], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
const wrote = r.stdout.includes(`wrote ${out}`);
console.log(wrote ? out : r.stdout);
process.exit(wrote ? 0 : 1);
