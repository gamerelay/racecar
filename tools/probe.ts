// What's at a point (docs/CALDERA.md, "Developer tools"; src/dev/probe.ts): the road nearest and
// where on it, the surface, and on open ground the heights there, decks, a tunnel's mouth, lava.
//
//   bun tools/probe.ts paradise-open/open --at 129,-127          a point (x,z), what a car dropped there lands on
//   bun tools/probe.ts paradise-open/open --at 129,-127,20       at a height (x,z,y): a car up there
//   bun tools/probe.ts paradise-open/open --road lava-tube --s 250 --lat 0   a spot on a road
//   add --json for machine-readable output

import { newHit, sampleAt } from '../src/core/track/query';
import { bakeTrack } from '../src/core/track/bake';
import { describeProbe, probe } from '../src/dev/probe';
import { roadIndex } from '../src/dev/drive';
import { args, point } from './lib/args';
import { SURFACES, layout } from './content';

const a = args();
const at = a.str('at');
const road = a.str('road');
const s = a.num('s');
const lat = a.num('lat') ?? 0;
const y = a.num('y');
const json = a.has('json');
const key = a.rest()[0];
if (!key || (!at && s === undefined)) {
  console.error('usage: bun tools/probe.ts <map/layout> (--at x,z[,y] | [--road id] --s m [--lat m] [--y m]) [--json]');
  process.exit(2);
}
const track = bakeTrack(layout(key), SURFACES);
let x: number;
let z: number;
let yy = y;
if (at) [x, z, yy = y as number] = point(at);
else {
  const hit = sampleAt(track.splines[roadIndex(track, road)], s!, newHit());
  x = hit.cx - hit.tz * lat;
  z = hit.cz + hit.tx * lat;
  yy ??= hit.cy;
}
const p = probe(track, x, z, yy);
console.log(json ? JSON.stringify(p, null, 1) : describeProbe(p));
