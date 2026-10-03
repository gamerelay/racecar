// Drive a car somewhere, headless, and see what happens (docs/CALDERA.md, "Developer tools";
// src/dev/drive.ts): place it, give it inputs, run it, print a trace and a summary.
//
//   bun tools/drive.ts paradise-open/open --road lava-tube --s 200 --kmh 170 --throttle 1 --seconds 4
//   bun tools/drive.ts paradise-open/open --s 2600 --ai --seconds 20 --every 1
//   bun tools/drive.ts avalanche/slope --at 0,400 --kmh 80 --steer -0.3 --drift
//
//   where:   [--road id|index] --s m [--lat m] [--reverse]   or   --at x,z[,y]
//   inputs:  --ai, or held: --throttle 0..1 --brake 0..1 --steer -1..1 --boost --drift
//   car:     --class coupe --kmh 0   run: --seconds 5 --every 0.25 --seed 7 --rivals 0 --traffic
//   output:  text, or --json

import { bakeTrack } from '../src/core/track/bake';
import { describeDrive, run, setup, type Inputs, type Spot } from '../src/dev/drive';
import { args, point } from './lib/args';
import { CLASSES, SURFACES, layout } from './content';

const a = args();
const at = a.str('at');
const spot: Spot = { road: a.str('road'), s: a.num('s'), lateral: a.num('lat'), reverse: a.has('reverse') };
if (at) [spot.x, spot.z, spot.y] = point(at);
const ai = a.has('ai');
const input: Inputs = ai
  ? 'ai'
  : { throttle: a.num('throttle') ?? 0, brake: a.num('brake') ?? 0, steer: a.num('steer') ?? 0, boost: a.has('boost'), drift: a.has('drift') };
const opts = { cls: a.str('class'), kmh: a.num('kmh'), seconds: a.num('seconds') ?? 5, every: a.num('every') ?? 0.25, seed: a.num('seed'), rivals: a.num('rivals'), traffic: a.has('traffic') };
const json = a.has('json');
const key = a.rest()[0];
if (!key || (!at && spot.s === undefined)) {
  console.error('usage: bun tools/drive.ts <map/layout> ([--road id] --s m [--lat m] | --at x,z[,y]) [inputs] [--kmh n] [--seconds n] [--json]');
  process.exit(2);
}
const track = bakeTrack(layout(key), SURFACES);
const sim = setup(track, CLASSES, SURFACES, spot, input, opts);
const d = run(sim, input, opts.seconds, opts.every);
console.log(json ? JSON.stringify(d, null, 1) : describeDrive(d));
