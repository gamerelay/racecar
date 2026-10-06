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
//   --t s  race time: the world then (a drawbridge up, its seed 7's)  --traffic  with its traffic (seed 7's)
//   --palette name  another palette than the map's (its sunset, say)

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

// Every flag first, then what's left is the layout (so it can come anywhere on the line).
const a = args();
const s = a.str('s');
const road = a.str('road');
const lat = a.num('lat') ?? 0;
const cls = a.str('class') ?? 'coupe';
const camName = a.str('cam') ?? 'chase';
if (!CAMS[camName]) throw new Error(`--cam is one of ${Object.keys(CAMS).join(', ')}`);
const cam = { ...CAMS[camName] };
for (const k of ['back', 'up', 'side', 'ahead', 'fov'] as const) cam[k] = a.num(k) ?? cam[k];
const size = { w: a.num('w'), h: a.num('h') };
const outFlag = a.str('out');
const port = a.str('port') ?? '5178';
const t = a.num('t');
const traffic = a.has('traffic');
const palette = a.str('palette');
const key = a.rest()[0];
if (!key || !s) {
  console.error('usage: bun tools/shot.ts <map/layout> --s m[,m…] [--road id] [--lat m] [--cam chase|high|side|top|front] [--out file] [--port 5178]');
  process.exit(2);
}
const track = bakeTrack(layout(key), SURFACES);
const spline = roadIndex(track, road);
const q = new URLSearchParams({ scout: key, s, spline: String(spline), lat: String(lat), cls });
for (const [k, v] of Object.entries(cam)) q.set(k, String(v));
for (const [k, v] of Object.entries(size)) if (v !== undefined) q.set(k, String(v));
if (t !== undefined) q.set('t', String(t));
if (traffic) q.set('traffic', '1');
if (palette) q.set('palette', palette);
const out = outFlag ?? join('telemetry', 'shots', `${key.replace('/', '-')}-${s.split(',')[0]}.png`);
const r = spawnSync('bun', [join(import.meta.dir, 'poster.ts'), '--url', `poster.html?${q}`, '--out', out, '--port', port], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
const wrote = r.stdout.includes(`wrote ${out}`);
console.log(wrote ? out : r.stdout);
process.exit(wrote ? 0 : 1);
