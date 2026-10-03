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
import { smoothstep } from '../src/core/math';
import { across } from '../src/core/track/frame';
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
const bankAt = (s: number): number | undefined => {
  for (const b of BANKS) {
    if (s < b.s[0] - b.ease[0] || s > b.s[1] + b.ease[1]) continue;
    return b.bank * (s < b.s[0] ? smoothstep(0, 1, (s - b.s[0] + b.ease[0]) / b.ease[0]) : s > b.s[1] ? smoothstep(0, 1, (b.s[1] + b.ease[1] - s) / b.ease[1]) : 1);
  }
  return undefined;
};

/** The volcano: today's cone, its crater a shaft down to a lava lake (the Lava Tube crosses it). */
const VOLCANO = { ...island.terrain.volcano, pit: 12, lava: 14 };
/**
 * Beaches (beach features, the owner): from Harbor Town's west end to the Freeway, the sea side
 * of the road is sand down to the water (it was grass, with a strip of sand at the water's edge).
 */
const BEACHES: { s: [number, number]; side: 'left' | 'right' }[] = [{ s: [-260, FREEWAY[0]], side: 'left' }];
/** Steeper than this is a rock face, a wall (GroundDef.face): the volcano's round the tube's mouths. */
const FACE = 1;
/**
 * The Lava Tube (the owner: climbing the mountain is slow; a tube down into the volcano, over the
 * lava on a jagged rock bridge and out the other side). It leaves the rim road where it runs
 * at the volcano, as the road turns away round it, and rejoins it at the top of the rim, where
 * the road turns to run straight away (later, the two ran over each other: a hump at its exit).
 */
const TUBE = { from: 2685, to: 3255, bridge: VOLCANO.lava + 4, width: 12, shoulder: 1.5 };
/**
 * The jump over the lava, in the middle of the crossing: the gap (m), and the kicker up to its edge
 * (its length and its lip's height over the bridge).
 */
const JUMP = { gap: 40, kicker: 12, lift: 2.5 };
// (40 m takes 150 km/h off the lip, the bus 160: flat out, the slowest car gets there at 175. Off
// the throttle, or off a wall, it's the lava.)
/** Its tunnels run where the volcano is at least this far over the road (the ceiling and a roof). */
const TUBE_COVER = TUBE_H + 1.5;

const src = structuredClone(island) as unknown as TrackLayout;
const baked = bakeTrack(src, surfaces);
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
  return yAt(DESCENT[0]) + (yAt(DESCENT[1]) - yAt(DESCENT[0])) * smoothstep(0, 1, t);
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

// The Lava Tube's road: in toward the crater, straight across its shaft (level, and the jump over
// the lava in its middle), and out. Its two bends are in the tunnels, out of the shaft: with one bend
// in the middle (27°, over 20 m), a jump there flew straight on off the side.
const at = (s: number) => {
  const h = sampleAt(main, s, newHit());
  return { x: h.cx, z: h.cz, y: h.cy };
};
const A = at(TUBE.from);
const B = at(TUBE.to);
const C = { x: VOLCANO.x, z: VOLCANO.z, y: TUBE.bridge };
/** How far either side of the crater's middle the crossing runs straight (past its lip, in the rock). */
const CROSS = VOLCANO.crater + 10;
const cross = (() => {
  const a = Math.hypot(C.x - A.x, C.z - A.z);
  const b = Math.hypot(B.x - C.x, B.z - C.z);
  const x = (C.x - A.x) / a + (B.x - C.x) / b;
  const z = (C.z - A.z) / a + (B.z - C.z) / b;
  const l = Math.hypot(x, z);
  return { x: x / l, z: z / l };
})();
const C1 = { x: C.x - cross.x * CROSS, z: C.z - cross.z * CROSS, y: TUBE.bridge };
const C2 = { x: C.x + cross.x * CROSS, z: C.z + cross.z * CROSS, y: TUBE.bridge };
const legs: [typeof A, typeof A][] = [
  [A, C1],
  [C1, C2],
  [C2, B],
];
/**
 * The main road's ground beside (x, z) (its plane carried out sideways), and how far the tube's
 * edge there is past the main road's verge (m), searched along the main road near `s`. (`clear`
 * is joinBranch's test, bake.ts: at 0 or less the bake holds the tube to that ground.)
 */
const beside = (x: number, z: number, s: number) => {
  let k = 0;
  let best = Infinity;
  for (let i = Math.round((s - 150) / main.step); i <= Math.round((s + 150) / main.step); i++) {
    const d = (main.px[i] - x) ** 2 + (main.pz[i] - z) ** 2;
    if (d < best) [best, k] = [d, i];
  }
  const lat = across(main, k, x, z);
  const verge = main.width[k] / 2 + main.shoulder[k];
  return { y: main.py[k] - lat * Math.tan(main.bank[k]), clear: Math.abs(lat) - verge - TUBE.width / 2 };
};
/** Within this far of the rim road's verge, the tube runs at the rim road's ground. */
const LAND = 10;
const tubePoints: { p: [number, number, number]; width: number; lanes: number; shoulder: number; surface: string }[] = [];
for (const [k, [p, q]] of legs.entries()) {
  const len = Math.hypot(q.x - p.x, q.z - p.z);
  const n = Math.ceil(len / 15);
  const pts = [];
  for (let j = k === 0 ? 0 : 1; j <= n; j++) {
    const t = j / n;
    const x = p.x + (q.x - p.x) * t;
    const z = p.z + (q.z - p.z) * t;
    pts.push({ x, z, fromMid: Math.hypot(x - C.x, z - C.z), ...beside(x, z, k === 0 ? TUBE.from : TUBE.to) });
  }
  const point = (x: number, y: number, z: number) =>
    tubePoints.push({ p: [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(z * 10) / 10], width: TUBE.width, lanes: 1, shoulder: TUBE.shoulder, surface: 'lava-rock' });
  if (k === 1) {
    for (const pt of pts) point(pt.x, TUBE.bridge, pt.z);
    continue;
  }
  // Level over the shaft (inside the lip), then one smooth curve that lands on the main road's
  // ground near it (LAND), at that ground's own grade, so nothing crests on the way out. The tube
  // has its own heights (BranchDef.heights): the bake keeps these. (Its own climb to its end, then
  // dragged up 8 m onto the rim road over its last 25 m, was a 45% hump out of the exit tunnel that
  // launched you at full speed; a smaller one going in.)
  const flat = CROSS;
  const held = pts.filter((pt) => pt.clear <= LAND);
  const land = held.length ? held.reduce((a, b) => (b.fromMid < a.fromMid ? b : a)) : pts[k === 0 ? 0 : pts.length - 1];
  const next = pts[pts.indexOf(land) + (k === 0 ? -1 : 1)] ?? land;
  const grade = next === land ? 0 : (next.y - land.y) / (next.fromMid - land.fromMid);
  const span = land.fromMid - flat;
  for (const pt of pts) {
    let y = pt.y;
    if (pt.fromMid < land.fromMid) {
      const u = Math.min(1, Math.max(0, (pt.fromMid - flat) / span));
      y = (2 * u ** 3 - 3 * u ** 2 + 1) * TUBE.bridge + (3 * u ** 2 - 2 * u ** 3) * land.y + (u ** 3 - u ** 2) * span * grade;
    }
    point(pt.x, y, pt.z);
  }
}
// It leaves the road a little before its first point and rejoins a little past its last (the
// validator's gentle fork: each end point along the road from where it meets it).
const tubeDef = { id: 'lava-tube', kind: 'shortcut' as const, heights: 'own' as const, from: TUBE.from - 12, to: TUBE.to + 12, points: tubePoints };
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
      { s: [FREEWAY[1], main.length], side: 'both' },
    ],
  },
  // Out at sea, where nothing drives (the island's own on land need colliders first).
  landmarks: (src.landmarks ?? []).filter((m) => ['shipwreck', 'whale', 'seaplanes'].includes(m.kind)),
  scenery: undefined,
  terrain: undefined,
  // The Freeway: a deck over the bay, the ground falling away to the sea bed under it.
  pieces: [{ id: 'freeway', s: FREEWAY, under: { floor: -6, ease: 80, reach: 90 } }],
  ground: {
    cell: 2.5,
    // No walls: the island's coast is its edge, and past it deep water (a respawn).
    wallFrom: 200,
    wallRise: 0,
    swell: { height: 1, size: 60 },
    rough: { height: 0.8, size: 18 },
    sea: island.terrain.sea,
    coast: island.terrain.island as [number, number][],
    volcano: VOLCANO,
    face: FACE,
    features: BEACHES.map((b) => ({ kind: 'beach' as const, ...b })),
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
// The jump (the owner: it's too good a shortcut for nothing): the bridge broken over the middle of
// the shaft, a kicker up to its edge, and nothing under the gap but the lava.
let mid = 0;
for (let i = 0, best = Infinity; i < tube.n; i++) {
  const d = Math.hypot(tube.px[i] - C.x, tube.pz[i] - C.z);
  if (d < best) [best, mid] = [d, i * tube.step];
}
const lip = Math.round(mid - JUMP.gap / 2);
const far = Math.round(mid + JUMP.gap / 2);
layout.ramps = [...(layout.ramps ?? []), { spline: 'lava-tube', s: lip - JUMP.kicker, length: JUMP.kicker, height: JUMP.lift }];
layout.pieces = [
  ...(layout.pieces ?? []),
  { id: 'lava-tube-in', road: 'lava-tube', s: [Math.round(portalIn - 6), lip], ceiling: TUBE_H },
  { id: 'lava-jump', road: 'lava-tube', s: [lip, far], floor: false },
  { id: 'lava-tube-out', road: 'lava-tube', s: [far, Math.round(portalOut + 6)], ceiling: TUBE_H },
];


mkdirSync(DIR, { recursive: true });
writeFileSync(`${DIR}/open.track.json`, `${JSON.stringify(layout)}\n`);
writeFileSync(`${DIR}/map.json`, `${JSON.stringify({ id: 'paradise-open', name: 'Paradise Open', layouts: ['open'], palette: 'tropic', sunset: 'sunset', weather: ['clear', 'rain', 'shower'], experimental: true })}\n`);
const track = bakeTrack(layout, surfaces);
console.log(`paradise-open/open: ${Math.round(track.main.length)} m, ground ${track.ground!.nx}×${track.ground!.nz}, deck ${FREEWAY.join('–')} m`);
console.log(`  lava tube: ${Math.round(tube.length)} m (the road round: ${TUBE.to - TUBE.from} m), tunnels ${Math.round(portalIn)}–${Math.round(shaftIn)} and ${Math.round(shaftOut)}–${Math.round(portalOut)} m, bridge ${Math.round(shaftIn)}–${Math.round(shaftOut)} m, the jump ${lip}–${far} m`);
