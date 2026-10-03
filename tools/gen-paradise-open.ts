// Generator for Paradise Open (docs/PARADISE.md): today's island lap as open ground (docs/
// AVALANCHE.md's heightfield) instead of a road between walls. The island's coast round it and the
// volcano in the middle; the Freeway a deck over the bay, its rails on (deep water under it
// respawns you); the turns off it banked to drift into; and the Lava Tube, a shortcut through the
// volcano: into its flank where the rim road heads at it, out over the lava in its shaft on a rock
// bridge, and out the other side where the road heads away.
//
// Experimental (map.json), so it's out of the lobby: open it from a link,
// `?mode=free&map=paradise-open/open`.
//
//   bun tools/gen-paradise-open.ts

import { writeFileSync, mkdirSync } from 'node:fs';
import type { TrackLayout } from '../src/core/content';
import { bakeTrack } from '../src/core/track/bake';
import { newHit, projectGlobal, sampleAt } from '../src/core/track/query';
import { TUBE_H } from '../src/core/track/ground';
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

/** The volcano: today's cone, its crater a shaft down to a lava lake (the Lava Tube crosses it). */
const VOLCANO = { ...island.terrain.volcano, pit: 12, lava: 14 };
/**
 * The Lava Tube (the owner: climbing the mountain is slow; a tube down into the volcano, over the
 * lava on a jagged rock bridge and out the other side). It leaves the rim road where it runs
 * at the volcano, as the road turns away round it, and rejoins it where it runs straight away.
 */
const TUBE = { from: 2685, to: 3300, bridge: VOLCANO.lava + 4, width: 12, shoulder: 1.5 };
/** Its tunnels run where the volcano is at least this far over the road (the ceiling and a roof). */
const TUBE_COVER = TUBE_H + 1.5;

const src = structuredClone(island) as unknown as TrackLayout;
const baked = bakeTrack(src, surfaces);
// The main road's length, for the one wall gap that opens it all.
const length = baked.main.length;
/**
 * The rim road's descent off the volcano, smoothed: it levelled off and then dropped 25% over a
 * crest, which only mattered at the speed nobody had coming round the rim. Out of the Lava Tube
 * flat out, it threw cars off the crest into the bend below. One even fall from the top of the
 * rim to the bend instead.
 */
const DESCENT: [number, number] = [3250, 3420];
const yAt = (s: number) => sampleAt(baked.main, s, newHit()).cy;
const descent = (s: number) => {
  const t = (s - DESCENT[0]) / (DESCENT[1] - DESCENT[0]);
  return yAt(DESCENT[0]) + (yAt(DESCENT[1]) - yAt(DESCENT[0])) * smooth(t);
};
const hit = newHit();
for (const p of src.main.points) {
  projectGlobal(baked.main, p.p[0], p.p[2], hit, p.p[1]);
  const bank = bankAt(hit.s);
  if (bank !== undefined) p.bank = Math.round(bank * 1000) / 1000;
  if (hit.s > DESCENT[0] && hit.s < DESCENT[1]) p.p[1] = Math.round(descent(hit.s) * 10) / 10;
}
// (Baked again with the descent smoothed, for the Lava Tube's ends.)
const main = bakeTrack(src, surfaces).main;

// The Lava Tube's road: straight in to the crater's middle and out, level across the shaft.
const at = (s: number) => {
  const h = sampleAt(main, s, newHit());
  return { x: h.cx, z: h.cz, y: h.cy };
};
const A = at(TUBE.from);
const B = at(TUBE.to);
const C = { x: VOLCANO.x, z: VOLCANO.z, y: TUBE.bridge };
const legs: [typeof A, typeof A, number, number][] = [
  [A, C, A.y, TUBE.bridge],
  [C, B, TUBE.bridge, B.y],
];
const tubePoints: { p: [number, number, number]; width: number; lanes: number; shoulder: number; surface: string }[] = [];
for (const [k, [p, q, y0, y1]] of legs.entries()) {
  const len = Math.hypot(q.x - p.x, q.z - p.z);
  // Level over the shaft (inside the lip), climbing or falling along the rest of the leg.
  const flat = VOLCANO.crater + 4;
  const n = Math.ceil(len / 30);
  for (let j = k === 0 ? 0 : 1; j <= n; j++) {
    const t = j / n;
    const x = p.x + (q.x - p.x) * t;
    const z = p.z + (q.z - p.z) * t;
    const fromMid = Math.hypot(x - C.x, z - C.z);
    const out = Math.min(1, Math.max(0, (fromMid - flat) / (len - flat)));
    const y = TUBE.bridge + ((k === 0 ? y0 : y1) - TUBE.bridge) * out;
    tubePoints.push({ p: [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(z * 10) / 10], width: TUBE.width, lanes: 1, shoulder: TUBE.shoulder, surface: 'lava-rock' });
  }
}
// It leaves the road a little before its first point and rejoins a little past its last (the
// validator's gentle fork: each end point along the road from where it meets it).
const tubeDef = { id: 'lava-tube', kind: 'shortcut' as const, from: TUBE.from - 12, to: TUBE.to + 12, points: tubePoints };
const layout: TrackLayout = {
  ...src,
  id: 'open',
  name: 'Open',
  // Today's shortcuts come back as routes (step 2); the Lava Tube is new, through the volcano.
  branches: [tubeDef],
  zones: (src.zones ?? []).filter((z) => !z.spline),
  ramps: (src.ramps ?? []).filter((r) => !r.spline),
  // Open everywhere but the Freeway, which has its rails (the owner: rails on the bridge).
  walls: {
    gaps: [
      { s: [0, FREEWAY[0]], side: 'both' },
      { s: [FREEWAY[1], length], side: 'both' },
    ],
  },
  // Out at sea, where nothing drives (the island's own on land need colliders first).
  landmarks: (src.landmarks ?? []).filter((m) => ['shipwreck', 'whale', 'seaplanes'].includes(m.kind)),
  scenery: undefined,
  terrain: undefined,
  ground: {
    cell: 2.5,
    // No walls: the island's coast is its edge, and past it deep water (a respawn).
    wallFrom: 200,
    wallRise: 0,
    swell: { height: 1, size: 60 },
    rough: { height: 0.8, size: 18 },
    decks: [{ s: FREEWAY, floor: -6, ease: 80, reach: 90 }],
    sea: island.terrain.sea,
    coast: island.terrain.island as [number, number][],
    volcano: VOLCANO,
    pines: { kind: 'tropic', seed: 23, spacing: 7, clear: 7, thicken: 30, density: 0.4, glade: 70 },
  },
};
delete layout.scenery;
delete layout.terrain;

// Where the Lava Tube's a tunnel and where it's over the shaft, along it: against the ground as it
// is without it (the volcano eased down to the rim road near it), its mouths clear of the junctions.
const bare = bakeTrack({ ...layout, branches: [] }, surfaces).ground!;
const tube = bakeTrack(layout, surfaces).splines[1];
/** How far a mouth keeps from the branch's ends (the junctions with the rim road). */
const MOUTH_CLEAR = 45;
let portalIn = Infinity;
let portalOut = -Infinity;
let shaftIn = Infinity;
let shaftOut = -Infinity;
for (let i = 0; i < tube.n; i++) {
  const s = i * tube.step;
  if (s >= MOUTH_CLEAR && s <= tube.length - MOUTH_CLEAR && bare.height(tube.px[i], tube.pz[i]) - tube.py[i] >= TUBE_COVER) {
    portalIn = Math.min(portalIn, s);
    portalOut = Math.max(portalOut, s);
  }
  if (Math.hypot(tube.px[i] - C.x, tube.pz[i] - C.z) < VOLCANO.crater - 2) {
    shaftIn = Math.min(shaftIn, s);
    shaftOut = Math.max(shaftOut, s);
  }
}
// The tunnels have their rock walls; the cuttings and the bridge don't. The tube's a deck from a
// little before its first mouth to a little past its last.
layout.walls = {
  gaps: [
    ...(layout.walls?.gaps ?? []),
    { spline: 'lava-tube', s: [0, portalIn], side: 'both' },
    { spline: 'lava-tube', s: [shaftIn, shaftOut], side: 'both' },
    { spline: 'lava-tube', s: [portalOut, tube.length], side: 'both' },
  ],
};
layout.ground!.branchDecks = [{ spline: 'lava-tube', s: [Math.round(portalIn - 6), Math.round(portalOut + 6)] }];


mkdirSync(DIR, { recursive: true });
writeFileSync(`${DIR}/open.track.json`, `${JSON.stringify(layout)}\n`);
writeFileSync(`${DIR}/map.json`, `${JSON.stringify({ id: 'paradise-open', name: 'Paradise Open', layouts: ['open'], palette: 'tropic', sunset: 'sunset', weather: ['clear', 'rain', 'shower'], experimental: true })}\n`);
const track = bakeTrack(layout, surfaces);
console.log(`paradise-open/open: ${Math.round(track.main.length)} m, ground ${track.ground!.nx}×${track.ground!.nz}, deck ${FREEWAY.join('–')} m`);
console.log(`  lava tube: ${Math.round(tube.length)} m (the road round: ${TUBE.to - TUBE.from} m), tunnels ${Math.round(portalIn)}–${Math.round(shaftIn)} and ${Math.round(shaftOut)}–${Math.round(portalOut)} m, bridge ${Math.round(shaftIn)}–${Math.round(shaftOut)} m`);
