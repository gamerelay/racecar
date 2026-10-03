// Generator for Paradise Open (docs/PARADISE.md), step 0: a road over the ground. Today's island
// lap, as open ground (docs/AVALANCHE.md's heightfield) instead of a road between walls, with the
// Freeway as a deck over the bay: no barriers, so you can drive off it into the water (deep water
// respawns you). The routes, the coast and the volcano come in the next steps; this is the deck,
// tried on the bridge it's for.
//
// Experimental (map.json), so it's out of the lobby: open it from a link,
// `?mode=free&map=paradise-open/open`.
//
//   bun tools/gen-paradise-open.ts

import { writeFileSync, mkdirSync } from 'node:fs';
import type { TrackLayout } from '../src/core/content';
import { bakeTrack } from '../src/core/track/bake';
import { newHit, projectGlobal } from '../src/core/track/query';
import surfaces from '../content/surfaces.json';
import island from '../content/maps/paradise/island.track.json';

const DIR = 'content/maps/paradise-open';

/** The Freeway: where it leaves the land on its ramp up, and where it comes back down to it. */
const FREEWAY: [number, number] = [1200, 2060];

/**
 * Banked turns to drift into (the owner): off the Freeway, the right-hander into the jungle and
 * the left-hander after it, each banked steeply into itself (TUNING.bankHold holds you into the
 * bank). A bank in radians, positive low on the right, flat over `s`, eased in and out over `ease`.
 */
const BANKS: { s: [number, number]; bank: number; ease: [number, number] }[] = [
  { s: [2190, 2345], bank: 0.25, ease: [50, 29] },
  { s: [2395, 2500], bank: -0.25, ease: [21, 40] },
];
const smooth = (t: number) => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};
const bankAt = (s: number): number | undefined => {
  for (const b of BANKS) {
    if (s < b.s[0] - b.ease[0] || s > b.s[1] + b.ease[1]) continue;
    return b.bank * (s < b.s[0] ? smooth((s - b.s[0] + b.ease[0]) / b.ease[0]) : s > b.s[1] ? smooth((b.s[1] + b.ease[1] - s) / b.ease[1]) : 1);
  }
  return undefined;
};

const src = structuredClone(island) as unknown as TrackLayout;
const baked = bakeTrack(src, surfaces);
// The main road's length, for the one wall gap that opens it all.
const length = baked.main.length;
const hit = newHit();
for (const p of src.main.points) {
  projectGlobal(baked.main, p.p[0], p.p[2], hit, p.p[1]);
  const bank = bankAt(hit.s);
  if (bank !== undefined) p.bank = Math.round(bank * 1000) / 1000;
}

const layout: TrackLayout = {
  ...src,
  id: 'open',
  name: 'Open',
  // The shortcuts are branches off the road; on open ground they come back as routes (step 2).
  branches: [],
  zones: (src.zones ?? []).filter((z) => !z.spline),
  ramps: (src.ramps ?? []).filter((r) => !r.spline),
  walls: { gaps: [{ s: [0, length], side: 'both' }] },
  // The island's dressing stands on its own terrain; it comes back on this ground in step 8.
  landmarks: [],
  scenery: undefined,
  terrain: undefined,
  ground: {
    cell: 2.5,
    // Room either side of the road, then the edges rise (the coast replaces them in step 1).
    wallFrom: 140,
    wallRise: 0.35,
    swell: { height: 1, size: 60 },
    rough: { height: 0.8, size: 18 },
    decks: [{ s: FREEWAY, floor: -6, ease: 80, reach: 90 }],
    sea: 0,
  },
};
delete layout.scenery;
delete layout.terrain;

mkdirSync(DIR, { recursive: true });
writeFileSync(`${DIR}/open.track.json`, `${JSON.stringify(layout)}\n`);
writeFileSync(`${DIR}/map.json`, `${JSON.stringify({ id: 'paradise-open', name: 'Paradise Open', layouts: ['open'], palette: 'tropic', sunset: 'sunset', weather: ['clear', 'rain', 'shower'], experimental: true })}\n`);
const track = bakeTrack(layout, surfaces);
console.log(`paradise-open/open: ${Math.round(track.main.length)} m, ground ${track.ground!.nx}×${track.ground!.nz}, deck ${FREEWAY.join('–')} m`);
