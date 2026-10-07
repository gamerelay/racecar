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
import type { HouseDef, LandmarkDef, PadDef, TrackLayout, TrackPoint } from '../src/core/content';
import { padDistance } from '../src/core/track/features/pad';
import { newContact, obbOverlap } from '../src/core/collide/obb';
import { Rng } from '../src/core/rng';
import { bakeTrack } from '../src/core/track/bake';
import { newHit, offRoad, projectGlobal, sampleAt } from '../src/core/track/query';
import { smoothstep } from '../src/core/math';
import { across } from '../src/core/track/frame';
import { TUBE_H } from '../src/core/track/ground';
import surfaces from '../content/surfaces.json';
import island from '../content/maps/paradise/island.track.json';

const DIR = 'content/maps/paradise-open';

/**
 * The bulge (the owner, 2026-10-06, on the west coast past the beach umbrellas: "this road go a
 * little deeper towards the mountain", and "if this little turn could be a bulge that you could
 * drift around that would be awesome"; a round D, not a hairpin): the island's road from `from` to
 * `to` m (a little right-left jog off the beach) becomes one round bulge inland toward the
 * volcano's foot: a right off the coast (`enter`: its radius and how far it turns), a short
 * straight, one long left round its apex (`round`, banked into itself: BANKS), a short straight,
 * and a right back onto the island's road (as far as it takes to head as that does). The two
 * straights as long as it takes to meet it. A point every `every` m, as wide as `width`; its
 * heights from the island road's at its ends, eased between them. (Waypoints through a spline
 * first: a kink where it met the island's road and a lumpy left.)
 */
const BULGE = { from: 600, to: 1075, enter: { r: 55, deg: 120 }, round: { r: 140, deg: 145 }, leave: { r: 55 }, every: 11, width: 21.5 };
/** The island's lap with the bulge in it, how much longer it is (m: every main distance past it moves on by that much, `S`), and its long left (main distances). */
const { lap: islandLap, longer: BULGE_LONGER, arc: BULGE_ARC } = (() => {
  const lap = structuredClone(island) as unknown as TrackLayout;
  const before = bakeTrack(lap, surfaces).main;
  const hit = newHit();
  const pts = lap.main.points;
  const sOf = (k: number) => (projectGlobal(before, pts[k].p[0], pts[k].p[2], hit, pts[k].p[1]), hit.s);
  // The island's points either side: the last before it and the first after.
  let k0 = 0;
  while (sOf(k0 + 1) < BULGE.from) k0++;
  let k1 = k0 + 1;
  while (sOf(k1) <= BULGE.to) k1++;
  const a = pts[k0];
  const b = pts[k1];
  // Headings there, the island road's (radians in x-z: x = cos, z = sin; a right turn adds).
  const heading = (k: number) => (sampleAt(before, sOf(k), hit), Math.atan2(hit.tz, hit.tx));
  const h0 = heading(k0);
  const h1 = heading(k1);
  const deg = Math.PI / 180;
  const A = BULGE.enter.deg * deg;
  const B = BULGE.round.deg * deg;
  // (The right out turns what's left to head as the island's road does there.)
  const C = ((h1 - h0 - A + B + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  /** Its centreline, a point every metre, the straights `l1` and `l2` m long; where it ends. */
  const walk = (l1: number, l2: number, out?: [number, number][]) => {
    let [x, z, h] = [a.p[0], a.p[2], h0];
    const arc = (r: number, turn: number) => {
      const n = Math.max(1, Math.ceil(Math.abs(turn) * r));
      for (let i = 0; i < n; i++) {
        const d = turn / n;
        x += Math.cos(h + d / 2) * r * Math.abs(d);
        z += Math.sin(h + d / 2) * r * Math.abs(d);
        h += d;
        out?.push([x, z]);
      }
    };
    const line = (l: number) => {
      const n = Math.max(1, Math.ceil(l));
      for (let i = 0; i < n; i++) {
        x += (Math.cos(h) * l) / n;
        z += (Math.sin(h) * l) / n;
        out?.push([x, z]);
      }
    };
    arc(BULGE.enter.r, A);
    line(l1);
    arc(BULGE.round.r, -B);
    line(l2);
    arc(BULGE.leave.r, C);
    return [x, z];
  };
  // The straights: the end is linear in them, so two walks more solve for them.
  const [x0, z0] = walk(0, 0);
  const [xu, zu] = walk(1, 0);
  const [xv, zv] = walk(0, 1);
  const [ex, ez, ux, uz, vx, vz] = [b.p[0] - x0, b.p[2] - z0, xu - x0, zu - z0, xv - x0, zv - z0];
  const det = ux * vz - uz * vx;
  const l1 = (ex * vz - ez * vx) / det;
  const l2 = (ux * ez - uz * ex) / det;
  if (!(l1 > 5 && l2 > 5)) throw new Error(`the bulge's straights come out ${l1.toFixed(1)} and ${l2.toFixed(1)} m: turn its arcs`);
  const line: [number, number][] = [[a.p[0], a.p[2]]];
  walk(l1, l2, line);
  // A point every BULGE.every m along it (not its ends: the island's own).
  const total = line.length - 1;
  const n = Math.round(total / BULGE.every);
  const out: typeof pts = [];
  for (let j = 1; j < n; j++) {
    const u = j / n;
    const [x, z] = line[Math.round(u * total)];
    const y = a.p[1] + (b.p[1] - a.p[1]) * smoothstep(0, 1, u);
    out.push({ ...a, p: [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(z * 10) / 10], width: BULGE.width, bank: 0 });
  }
  // Its long left: from where the right in ends past the first straight to the second's start.
  const arcAt = [BULGE.enter.r * A + l1, BULGE.enter.r * A + l1 + BULGE.round.r * B].map((m) => line[Math.round(m)]);
  lap.main.points = [...pts.slice(0, k0 + 1), ...out, ...pts.slice(k1)];
  const after = bakeTrack(lap, surfaces).main;
  const longer = Math.round(after.length - before.length);
  const arc = arcAt.map(([x, z]) => (projectGlobal(after, x, z, hit), Math.round(hit.s))) as [number, number];
  // Everything the island places by main distance past it, moved on.
  const on = (s: number) => (s > BULGE.to ? s + longer : s);
  const span = (r: [number, number]): [number, number] => [on(r[0]), on(r[1])];
  for (const h of lap.hazards ?? []) h.s = typeof h.s === 'number' ? on(h.s) : span(h.s);
  for (const r of lap.ramps ?? []) if (!r.spline) r.s = on(r.s);
  for (const z of lap.zones ?? []) if (!z.spline) z.s = span(z.s);
  for (const d of lap.smashables ?? []) if (!d.spline && !d.at) d.s = span(d.s);
  for (const t of lap.takedownSpots ?? []) t.s = on(t.s);
  for (const l of lap.traffic?.lanes ?? []) if (l.sections) l.sections = l.sections.map(span);
  if (Array.isArray(lap.checkpoints)) lap.checkpoints = lap.checkpoints.map(on);
  return { lap, longer, arc };
})();
/** A main distance on the island's lap, on this one (past the bulge, moved on by how much longer it made the lap). */
const S = (s: number) => (s > BULGE.to ? s + BULGE_LONGER : s);

/** The Freeway: where it leaves the land on its ramp up, and where it comes back down to it. */
const FREEWAY: [number, number] = [S(1200), S(2060)];

/** The berm's flat stretch along the rim road (m): where the tube's road meets its lip. */
const EXIT_BERM: [number, number] = [S(3215), S(3255)];
/**
 * Banked turns to drift into (the owner): off the Freeway, the right-hander into the jungle and
 * the left-hander after it, each banked steeply into itself (TUNING.bankHold holds you into the
 * bank). A bank in radians, positive low on the right, flat over `s`, eased in and out over `ease`.
 */
const BANKS: { s: [number, number]; bank: number; ease: [number, number] }[] = [
  // The bulge's long left round its apex (BULGE), banked into itself, to drift round.
  { s: BULGE_ARC, bank: -0.2, ease: [35, 35] },
  { s: [S(2190), S(2345)], bank: 0.25, ease: [50, 29] },
  { s: [S(2395), S(2500)], bank: -0.25, ease: [21, 40] },
  // The berm at the Lava Tube's exit (the owner): the left-hander at the top of the rim banked into
  // itself like the jungle's, so it's a berm going round, and its high outside edge the lip that
  // throws cars coming out of the tube (EXIT_KICK) across it.
  { s: [EXIT_BERM[0], EXIT_BERM[1]], bank: -0.25, ease: [30, 55] },
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
/** The jungle's mud (the owner: "a little uneven"): lumps this high peak to trough (m), this wide. */
const MUD = { height: 0.35, size: 7 };
/** Where the main road is red earth (the jungle), each stretch from and to (m), rounded. */
const redEarth = (): [number, number][] => {
  const out: [number, number][] = [];
  let from = -1;
  for (let i = 0; i <= main.n; i++) {
    const on = i < main.n && surfaces[main.surface[i]]?.id === 'red-earth';
    if (on && from < 0) from = i;
    if (!on && from >= 0) {
      out.push([Math.round(from * main.step), Math.round((i - 1) * main.step)]);
      from = -1;
    }
  }
  return out;
};
/** Steeper than this is a rock face, a wall (GroundDef.face): the volcano's round the tube's mouths. */
const FACE = 1;
/**
 * The lava stream (a feature, docs/CALDERA.md's "A feature, end to end"; the owner: without it you
 * cross the volcano from the village too easily): out of the south-west flank below the rim road,
 * down to the sea by the bay, wandering a little. Its channel's floor `width` m across, `depth` m
 * deep. The one way down that crosses no road (the main road rings the volcano): it keeps at least
 * LAVA_CLEAR m from every road's edge.
 */
const LAVA = { bearing: 230, from: 100, width: 6, depth: 4 };
const LAVA_CLEAR = 25;
const lavaStream = (): [number, number][] => {
  const path: [number, number][] = [];
  for (let r = LAVA.from; ; r += 15) {
    const a = ((LAVA.bearing + 3 * Math.sin(r / 60) + 1.2 * Math.sin(r / 23)) * Math.PI) / 180;
    const x = Math.round((VOLCANO.x + Math.cos(a) * r) * 10) / 10;
    const z = Math.round((VOLCANO.z + Math.sin(a) * r) * 10) / 10;
    path.push([x, z]);
    // Into the sea a little, so it meets the water.
    if (inSea(x, z)) return path;
    if (r > 900) throw new Error('the lava stream never reaches the sea');
  }
};
/** Out past the coast (the island's outline, the sea outside it) by more than 8 m. */
const inSea = (x: number, z: number) => {
  const c = island.terrain.island as [number, number][];
  let inside = false;
  let near = Infinity;
  for (let a = 0, b = c.length - 1; a < c.length; b = a++) {
    const [ax, az] = c[a];
    const [bx, bz] = c[b];
    if (az > z !== bz > z && x < ax + ((z - az) * (bx - ax)) / (bz - az)) inside = !inside;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    near = Math.min(near, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return !inside && near > 8;
};
/**
 * The Lava Tube (the owner: climbing the mountain is slow; a tube down into the volcano, over the
 * lava on a jagged rock bridge and out the other side). It leaves the rim road where it runs
 * at the volcano, as the road turns away round it, and rejoins it at the top of the rim, where
 * the road turns to run straight away (later, the two ran over each other: a hump at its exit).
 */
const TUBE = { from: S(2685), to: S(3255), bridge: VOLCANO.lava + 4, width: 12, shoulder: 1.5 };
/**
 * The jump over the lava, in the middle of the crossing: the gap (m), and the kicker up to its edge
 * (its length and its lip's height over the bridge).
 */
const JUMP = { gap: 40, kicker: 12, lift: 2.5 };
// (40 m takes 150 km/h off the lip, the bus 160: flat out, the slowest car gets there at 175. Off
// the throttle, or off a wall, it's the lava.)
/**
 * Harbor Town's market street: where it leaves the harbour front and rejoins it (m), the hall on it
 * (its length and ceiling, m, and what its floor drives as), its road, and the glass across the hall's doors (how tall, the speed
 * that smashes it, m/s, and how far in from each end, m).
 */
const MARKET = { from: 170, to: 455, hall: 80, ceiling: 7, width: 12, shoulder: 1.5, floor: 'sand', glass: { height: 4, breaks: 8, in: 1.5 } };
/** The barricade across the tube's first mouth: this far in past it (m), this tall, broken by a car meeting it at this (m/s, about 43 km/h). */
const BOARDS = { in: 4, height: 3, breaks: 12 };
/** Its tunnels run where the volcano is at least this far over the road (the ceiling and a roof). */
const TUBE_COVER = TUBE_H + 1.5;

const src = islandLap;
const baked = bakeTrack(src, surfaces);
/**
 * The rim road's descent off the volcano, smoothed: it levelled off and then dropped 25% over a
 * crest, which only mattered at the speed nobody had coming round the rim. Out of the Lava Tube
 * flat out, it threw cars off the crest into the bend below. One even fall from the top of the
 * rim to the bend instead.
 */
const DESCENT: [number, number] = [S(3250), S(3420)];
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

/**
 * The bulge's lava (the owner: "have the lava stream coming down the face of the mountain so you see
 * it here"): a second stream, down the volcano's west face from `from` m out, to a pool (`pool` m
 * round, LAVA_CLEAR m past the road's verge) just past the bulge's apex (where its road comes
 * nearest the volcano): you drift round the bulge's long left with the lava ahead of you. Narrower
 * than the first, wandering a little; it crosses no road (the first's the barrier, LAVA).
 */
const LAVA_WEST = { from: 100, width: 5, depth: 3, pool: 10 };
const lavaWest = (() => {
  const hit = newHit();
  let best = { d: Infinity, s: 0 };
  for (let s = BULGE.from; s <= BULGE.to + BULGE_LONGER; s += 2) {
    sampleAt(main, s, hit);
    const d = Math.hypot(hit.cx - VOLCANO.x, hit.cz - VOLCANO.z);
    if (d < best.d) best = { d, s };
  }
  sampleAt(main, best.s, hit);
  const verge = hit.width / 2 + hit.shoulder;
  const out = verge + LAVA_CLEAR + LAVA_WEST.pool;
  const [dx, dz] = [(VOLCANO.x - hit.cx) / best.d, (VOLCANO.z - hit.cz) / best.d];
  const end: [number, number] = [hit.cx + dx * out, hit.cz + dz * out];
  const bearing = Math.atan2(end[1] - VOLCANO.z, end[0] - VOLCANO.x);
  const reach = Math.hypot(end[0] - VOLCANO.x, end[1] - VOLCANO.z);
  const path: [number, number][] = [];
  for (let r = LAVA_WEST.from; r < reach - 8; r += 15) {
    // (Wandering less toward its end, so it ends where it's meant to.)
    const a = bearing + (((2.5 * Math.sin(r / 50) + Math.sin(r / 19)) * Math.PI) / 180) * Math.min(1, (reach - r) / 60);
    path.push([Math.round((VOLCANO.x + Math.cos(a) * r) * 10) / 10, Math.round((VOLCANO.z + Math.sin(a) * r) * 10) / 10]);
  }
  path.push([Math.round(end[0] * 10) / 10, Math.round(end[1] * 10) / 10]);
  return path;
})();

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
  // (`tilt`: the rim road's bank carried across the tube's way, for a tube point there to lie in
  // its plane: the tangent of the bank the tube needs, given its own direction.)
  return { y: main.py[k] - lat * Math.tan(main.bank[k]), clear: Math.abs(lat) - verge - TUBE.width / 2, k };
};
/**
 * The way out onto the berm: the tube's road climbs all the way out of its tunnel to the berm's lip
 * (the rim road's banked edge, its outside high), still rising at `rise` (a grade) as it gets
 * there, so it crests on the lip and the banked road falls away beyond it: a kicker coming out, a
 * berm going round. (Its points every `step` m there, so the lip is where it's meant to be.)
 */
const EXIT_KICK = { rise: 0.12, step: 4, tilt: 12 };
/** Within this far of the rim road's verge, the tube runs at the rim road's ground. */
const LAND = 10;
const tubePoints: { p: [number, number, number]; width: number; lanes: number; shoulder: number; surface: string; verge: string }[] = [];
for (const [k, [p, q]] of legs.entries()) {
  const len = Math.hypot(q.x - p.x, q.z - p.z);
  const n = Math.ceil(len / (k === 2 ? EXIT_KICK.step : 15));
  const pts: ({ x: number; z: number; fromMid: number } & ReturnType<typeof beside>)[] = [];
  for (let j = k === 0 ? 0 : 1; j <= n; j++) {
    const t = j / n;
    const x = p.x + (q.x - p.x) * t;
    const z = p.z + (q.z - p.z) * t;
    pts.push({ x, z, fromMid: Math.hypot(x - C.x, z - C.z), ...beside(x, z, k === 0 ? TUBE.from : TUBE.to) });
  }
  const point = (x: number, y: number, z: number, bank?: number) =>
    tubePoints.push({ p: [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(z * 10) / 10], width: TUBE.width, lanes: 1, shoulder: TUBE.shoulder, surface: 'lava-rock', verge: 'ash', ...(bank ? { bank: Math.round(bank * 1000) / 1000 } : {}) });
  // Out onto the berm, the tube's road tilts into the rim road's banked plane (easing in over
  // EXIT_KICK.tilt m before its edge reaches the verge), so it meets it flush across its width.
  const tiltAt = (pt: (typeof pts)[number]): number => {
    if (k !== 2 || pt.clear > EXIT_KICK.tilt) return 0;
    const m = pt.k;
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const l = Math.hypot(dx, dz);
    // The tube's right (-tz, tx) against the rim road's.
    const across = (-dz / l) * -main.tz[m] + (dx / l) * main.tx[m];
    return Math.atan(Math.tan(main.bank[m]) * across) * smoothstep(0, 1, (EXIT_KICK.tilt - pt.clear) / EXIT_KICK.tilt);
  };
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
  let land = held.length ? held.reduce((a, b) => (b.fromMid < a.fromMid ? b : a)) : pts[k === 0 ? 0 : pts.length - 1];
  const next = pts[pts.indexOf(land) + (k === 0 ? -1 : 1)] ?? land;
  let grade = next === land ? 0 : (next.y - land.y) / (next.fromMid - land.fromMid);
  // On the way out, it lands where the bake starts holding it to the rim road's banked plane (its
  // edge at the verge: joinBranch), on that plane, still climbing: that's the berm's lip.
  if (k === 2) {
    const out = pts.filter((pt) => pt.clear >= 0);
    land = out.reduce((a, b) => (b.clear < a.clear ? b : a));
    grade = EXIT_KICK.rise;
  }
  const span = land.fromMid - flat;
  for (const pt of pts) {
    let y = pt.y;
    if (pt.fromMid < land.fromMid) {
      const u = Math.min(1, Math.max(0, (pt.fromMid - flat) / span));
      y = (2 * u ** 3 - 3 * u ** 2 + 1) * TUBE.bridge + (3 * u ** 2 - 2 * u ** 3) * land.y + (u ** 3 - u ** 2) * span * grade;
    }
    point(pt.x, y, pt.z, tiltAt(pt));
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
  // (Driven costs: the island's 'line' is its own call, not this map's.)
  aiCosts: undefined,
  // The Freeway: a deck over the bay, the ground falling away to the sea bed under it.
  pieces: [{ id: 'freeway', s: FREEWAY, under: { floor: -6, ease: 80, reach: 40 } }],
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
    features: [
      ...BEACHES.map((b) => ({ kind: 'beach' as const, ...b })),
      // The jungle's red-earth road a little uneven (the owner): lumps a few tenths high.
      ...redEarth().map((s) => ({ kind: 'uneven' as const, s, height: MUD.height, size: MUD.size })),
      { kind: 'lava-stream' as const, path: lavaStream(), width: LAVA.width, depth: LAVA.depth },
      // (Its pool's floor once the ground's there: below.)
      { kind: 'lava-stream' as const, path: lavaWest, width: LAVA_WEST.width, depth: LAVA_WEST.depth, pool: { r: LAVA_WEST.pool, floor: 0 } },
    ],
    pines: { kind: 'tropic', seed: 23, spacing: 7, clear: 7, thicken: 30, density: 0.4, glade: 70 },
  },
};
delete layout.scenery;
delete layout.terrain;
delete layout.aiCosts;

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
  { id: 'lava-tube-in', road: 'lava-tube', s: [Math.round(portalIn - 6), lip], ceiling: TUBE_H, indoor: 'lava' },
  { id: 'lava-jump', road: 'lava-tube', s: [lip, far], floor: false },
  { id: 'lava-tube-out', road: 'lava-tube', s: [far, Math.round(portalOut + 6)], ceiling: TUBE_H, indoor: 'lava' },
];

// The tube's boarded up (CALDERA step 3b): a barricade of planks across its first mouth, just in
// under the arch. The first car in at speed smashes it open, for the rest of the race; slower, it's
// a wall. Wall to wall across the road and its shoulders, on the road.
{
  const k = Math.round((portalIn + BOARDS.in) / tube.step);
  const edge = tube.width[k] / 2 + tube.shoulder[k];
  const foot = (lat: number): [number, number, number] => [
    +(tube.px[k] - tube.tz[k] * lat).toFixed(2),
    +(tube.py[k] + tube.ramp[k] - lat * Math.tan(tube.bank[k])).toFixed(2),
    +(tube.pz[k] + tube.tx[k] * lat).toFixed(2),
  ];
  layout.breakables = [{ id: 'lava-tube-boards', look: 'boards', from: foot(-edge), to: foot(edge), height: BOARDS.height, breaks: BOARDS.breaks }];
}

// Harbor Town's market hall (CALDERA step 3c; the owner: a mall waits for another map): off the
// harbour front a street straight on through the town, where the road dips south round it, and
// through a market hall on the way (PieceDef.building): its own walls and roof, lanterns inside,
// and shopfront glass across both its doors, smashed by the first car through each (slower than
// `glass.breaks` m/s, it's a wall). Straight on where the road bends round, a little quicker for the
// first car through the glass, a second for the rest.
{
  const street = { id: 'market-street', from: MARKET.from, to: MARKET.to };
  const roads = bakeTrack(layout, surfaces);
  const g = roads.ground!;
  const a = sampleAt(roads.main, street.from + 12, newHit());
  const b = sampleAt(roads.main, street.to - 12, newHit());
  const len = Math.hypot(b.cx - a.cx, b.cz - a.cz);
  const n = Math.ceil(len / 10);
  // Its heights the town's ground's, evened out over 30 m (the island's swell, not its bumps).
  const ground = (x: number, z: number) => {
    let sum = 0;
    for (let d = -15; d <= 15; d += 5) sum += g.height(x + ((b.cx - a.cx) / len) * d, z + ((b.cz - a.cz) / len) * d);
    return sum / 7;
  };
  const points = Array.from({ length: n + 1 }, (_, j) => {
    const x = a.cx + ((b.cx - a.cx) * j) / n;
    const z = a.cz + ((b.cz - a.cz) * j) / n;
    return { p: [+x.toFixed(1), +ground(x, z).toFixed(1), +z.toFixed(1)] as [number, number, number], width: MARKET.width, lanes: 2, shoulder: MARKET.shoulder, surface: 'asphalt', verge: 'sidewalk' };
  });
  layout.branches = [...(layout.branches ?? []), { ...street, kind: 'shortcut', points }];
  // Open, as every road on the island but the Freeway (the hall has its own walls): its road walls
  // were invisible rails along the beach either side of the hall (the owner ran into both).
  layout.walls = { gaps: [...(layout.walls?.gaps ?? []), { spline: street.id, s: [0, 1e4], side: 'both' }] };
  const sp = bakeTrack(layout, surfaces).splines.find((r) => r.id === street.id)!;
  // The hall in its middle.
  const h0 = Math.round((sp.length - MARKET.hall) / 2);
  const h1 = h0 + MARKET.hall;
  layout.pieces = [...(layout.pieces ?? []), { id: 'market-hall', road: street.id, s: [h0, h1], ceiling: MARKET.ceiling, building: 'market' }];
  // Its floor's sand blown in off the beach (the owner: through it flat out was a little too good):
  // wall to wall, door to door.
  const edge = MARKET.width / 2 + MARKET.shoulder;
  layout.zones = [...(layout.zones ?? []), { spline: street.id, s: [h0, h1], lateral: [-edge, edge], surface: MARKET.floor }];
  // Its glass doors: wall to wall across the road and its shoulders, just inside each end.
  const door = (s: number) => {
    const k = Math.round(s / sp.step);
    const edge = sp.width[k] / 2 + sp.shoulder[k];
    const foot = (lat: number): [number, number, number] => [+(sp.px[k] - sp.tz[k] * lat).toFixed(2), +(sp.py[k] - lat * Math.tan(sp.bank[k])).toFixed(2), +(sp.pz[k] + sp.tx[k] * lat).toFixed(2)];
    return { from: foot(-edge), to: foot(edge) };
  };
  layout.breakables = [
    ...(layout.breakables ?? []),
    { id: 'market-hall-in', look: 'glass', ...door(h0 + MARKET.glass.in), height: MARKET.glass.height, breaks: MARKET.glass.breaks },
    { id: 'market-hall-out', look: 'glass', ...door(h1 - MARKET.glass.in), height: MARKET.glass.height, breaks: MARKET.glass.breaks },
  ];
  console.log(`  market street: ${Math.round(sp.length)} m (the road round: ${street.to - street.from} m), the hall ${h0}–${h1} m`);
}

/**
 * Harbor Town's streets (the owner, 2026-10-06: "two sets of roads, the main front road which we
 * have, then some side roads for cars to spawn on and move from", toward "a beach with a parking
 * lot"; Hawaii; Riviera's side streets, COASTAL.md step 4, and its back street, step 8h). Loops off
 * the front road (the main road along the shore, round the line) and back: [id, from, to (main
 * distances), side (+1 right, inland: the town; -1 left, the beach), depth (m off the main road's
 * middle), lead (m along to get there), and how far along its ends are from its junctions (FORK)]. A traffic lane's streets are on its own side (nobody turns
 * across the other lane), so the beach's car parks are the way against the lap's; the town's
 * streets have their own traffic, never on the front road. Open to drive; the AI keeps to the main
 * road. None crosses the line (the validator: a node of the road graph, and a car round it would
 * never cross the finish), so the town is two blocks, a back street up the hill behind each,
 * either side of the square at the line.
 */
/** A street's width and shoulder; its traffic's speed; a point every `every` m; no steeper than `grade`. */
const STREET = { width: 8, shoulder: 1.5, speed: 12, every: 6, grade: 0.12 };
/**
 * The beach's car parks (the owner, after the first ones: they "don't look that good", bays strung
 * along a curved loop on a lumpy dune): each a level paved pad (PadDef) on the sand beside the front
 * road, `gap` m past its verge and `rise` m over the road's height there, its aisle (the lot's
 * street) straight down its middle with a row of bays either side, `bay` m apart and `deep` m deep,
 * nose in. Its driveways leave the front road at `from` and rejoin it at `to` (main distances),
 * their ends `fork` m along from there, `lead` m more out to the aisle. `fill` of the bays taken,
 * by the traffic's cars (look 'parked': compact, sedan, van; across, long, high).
 */
const LOTS = {
  list: [
    { id: 'lot-mauka', from: S(3670), to: S(3792) },
    { id: 'lot-makai', from: 45, to: 162 },
  ],
  gap: 2,
  rise: 0.2,
  bay: 2.8,
  deep: 6,
  fork: 28,
  lead: 8,
  fill: 0.75,
  cars: [
    [1.8, 3.9, 1.5],
    [1.9, 4.5, 1.5],
    [2, 5, 2],
  ] as [number, number, number][],
};
/** A lot's aisle's half width (the street's, with its shoulder), its pad's depth, and where its middle is (m off the front road's middle, at its middle). */
const lotAisle = () => STREET.width / 2 + STREET.shoulder;
const lotDepth = () => 2 * (lotAisle() + LOTS.deep);
const lotAt = (from: number, to: number) => {
  const hit = newHit();
  const mid = (from + ((to - from + main.length) % main.length) / 2) % main.length;
  sampleAt(main, mid, hit);
  return { mid, lat: hit.width / 2 + hit.shoulder + LOTS.gap + lotDepth() / 2 };
};
const TOWN_STREETS: [string, number, number, 1 | -1, number, number, number?][] = [
  // Waine'e Street and Luakini Street, the back streets: up the hill behind the town, each a block
  // up from the front road.
  ['waine-e', S(3575), S(3765), 1, 62, 40],
  ['luakini', 22, 182, 1, 54, 28],
  // The beach's car parks, on the sand between the road and the sea: the way against the lap's.
  ...LOTS.list.map(({ id, from, to }): [string, number, number, 1 | -1, number, number, number] => [id, from, to, -1, lotAt(from, to).lat, LOTS.lead, LOTS.fork]),
];
/** The back streets' traffic: m in from each end (off their legs down to the front road, out of sight round the houses), and its speed (m/s). */
const BACK_TRAFFIC = { trim: 60, speed: 9 };
/** A street's first and last points this far along from where it meets the front road (m, unless it says): it forks off gently. */
const FORK = 40;
// The car parks' pads, before their streets (which take the ground's heights): level, beside the
// front road, along it at their middles.
for (const { from, to } of LOTS.list) {
  const { mid, lat } = lotAt(from, to);
  const hit = sampleAt(main, mid, newHit());
  const straight = ((to - from + main.length) % main.length) - 2 * (LOTS.fork + LOTS.lead);
  layout.ground!.features!.push({
    kind: 'pad',
    at: [Math.round((hit.cx + hit.tz * lat) * 10) / 10, Math.round((hit.cz - hit.tx * lat) * 10) / 10],
    size: [Math.round(straight + 12), Math.round(lotDepth() * 10) / 10],
    rot: Math.round(Math.atan2(hit.tx, hit.tz) * 1000) / 1000,
    y: Math.round((hit.cy + LOTS.rise) * 100) / 100,
  });
}
{
  const L = main.length;
  for (const [id, from, to, side, depth, lead, IN = FORK] of TOWN_STREETS) {
    const g = bakeTrack(layout, surfaces);
    const hit = newHit();
    const at = (s: number, lat: number): [number, number] => (sampleAt(g.main, ((s % L) + L) % L, hit), [hit.cx - hit.tz * lat * side, hit.cz + hit.tx * lat * side]);
    const len = (to - from + L) % L;
    const edge = () => hit.width / 2 + hit.shoulder + STREET.width / 2 + 1;
    sampleAt(g.main, (from + IN) % L, hit);
    const corners: [number, number][] = [at(from + IN, edge()), at(from + IN + lead, depth)];
    // (Along a car park's aisle a corner every 8 m, so the rounding keeps it straight down its pad.)
    const every = LOTS.list.some((l) => l.id === id) ? 8 : 30;
    for (let u = IN + lead + every; u < len - IN - lead - every / 2; u += every) corners.push(at(from + u, depth));
    corners.push(at(from + len - IN - lead, depth));
    sampleAt(g.main, (from + len - IN) % L, hit);
    corners.push(at(from + len - IN, edge()));
    // Its corners rounded (Chaikin, as Riviera's), then a point every `every` m.
    let line = corners;
    for (let pass = 0; pass < 3; pass++)
      line = [line[0], ...line.slice(0, -1).flatMap(([ax, az], k) => {
        const [bx, bz] = line[k + 1];
        return [[0.75 * ax + 0.25 * bx, 0.75 * az + 0.25 * bz], [0.25 * ax + 0.75 * bx, 0.25 * az + 0.75 * bz]] as [number, number][];
      }), line[line.length - 1]];
    const xz: [number, number][] = [];
    let left = 0;
    for (let k = 0; k + 1 < line.length; k++) {
      const [ax, az] = line[k];
      const [bx, bz] = line[k + 1];
      const d = Math.hypot(bx - ax, bz - az);
      for (; left < d; left += STREET.every) xz.push([ax + ((bx - ax) * left) / d, az + ((bz - az) * left) / d]);
      left -= d;
    }
    xz.push(line[line.length - 1]);
    const points: TrackPoint[] = xz.map(([x, z]) => ({ p: [Math.round(x * 10) / 10, 0, Math.round(z * 10) / 10], width: STREET.width, lanes: 2, shoulder: STREET.shoulder, surface: 'asphalt' }));
    // Its own heights, on the hillside (Riviera's rue Haute): where the bake holds it to the front
    // road (`merge` in a trial bake), the front road's surface carried out sideways; clear of it,
    // the ground's own; between, blended; no steeper than STREET.grade; smoothed.
    const def = { id, from, to, kind: 'street' as const, heights: 'own' as const, points };
    const trial = bakeTrack({ ...layout, branches: [...layout.branches!, def] }, surfaces);
    const tsp = trial.splines.find((x) => x.id === id)!;
    const n = points.length;
    const pinned: boolean[] = [];
    const y = xz.map(([x, z], k) => {
      projectGlobal(tsp, x, z, hit);
      const i = Math.min(tsp.n - 1, Math.round(hit.s / tsp.step));
      const m = k === 0 || k === n - 1 ? 1 : tsp.merge[i];
      pinned[k] = m >= 1;
      const ground = g.ground!.height(x, z);
      if (m <= 0) return ground;
      projectGlobal(g.main, x, z, hit);
      return ground + (hit.cy - hit.lateral * Math.tan(hit.bank) - ground) * m;
    });
    const hold = () => {
      for (let k = 1; k < n; k++) y[k] = Math.min(y[k], y[k - 1] + STREET.every * STREET.grade);
      for (let k = n - 2; k >= 0; k--) y[k] = Math.min(y[k], y[k + 1] + STREET.every * STREET.grade);
    };
    hold();
    for (let pass = 0; pass < 4; pass++) for (let k = 1; k < n - 1; k++) if (!pinned[k]) y[k] = (y[k - 1] + 2 * y[k] + y[k + 1]) / 4;
    hold();
    for (let k = 0; k < n; k++) points[k].p[1] = Math.round(y[k] * 100) / 100;
    layout.branches!.push(def);
    layout.walls!.gaps!.push({ spline: id, s: [0, 1e4], side: 'both' });
  }
  // The town's traffic: against the lap out of one car park, along the front road over the line,
  // and into the other; and up and down the back streets, their back stretches, never on the front
  // road. (Not the lap's way down Waine'e and onto the front road: pulling out at 12 m/s in front of
  // the field, just short of the line and into the grid, it was 35 wrecks in 24 races there. Riviera
  // the same: the racers' own lane is theirs.) The Freeway's as it was.
  const g = bakeTrack(layout, surfaces);
  const lane = (dir: 1 | -1, streets: string[]) => ({ pos: dir * 0.6, dir, speed: STREET.speed, streets });
  const along = (road: string, dir: 1 | -1) => {
    const len = g.splines.find((x) => x.id === road)!.length;
    return { pos: dir * 0.6, dir, speed: BACK_TRAFFIC.speed, road, span: [BACK_TRAFFIC.trim, Math.round(len - BACK_TRAFFIC.trim)] as [number, number] };
  };
  layout.traffic = {
    density: layout.traffic!.density,
    lanes: [...layout.traffic!.lanes.filter((l) => l.sections?.every(([a]) => a > FREEWAY[0] && a < FREEWAY[1])), lane(-1, ['lot-makai', 'lot-mauka']), ...['waine-e', 'luakini'].flatMap((road) => [along(road, 1), along(road, -1)])],
  };
  for (const id of TOWN_STREETS.map(([id]) => id)) console.log(`  ${id}: ${Math.round(g.splines.find((x) => x.id === id)!.length)} m`);
}

/**
 * The beach line (the owner, 2026-10-07: the beach run to the Freeway, its packed-sand line "across
 * the bulge"; PARADISE's Sandbar-style beach road): a shortcut on the packed `beach` (grip 0.80,
 * drag 0.20) through the soft sand round it (0.64, 0.30), along the water's edge from just before
 * the bulge to just after it. Its surface `packed-sand`: the beach's grip and drag, drawn damper and
 * darker than the loose sand, with ruts down it (the skin's), so it reads at speed. The bulge is the asphalt, banked drift; this is shorter and looser.
 * It leaves the front road at `from` and rejoins it at `to` (main distances), out to the sand
 * `water` m in from the coast, along it (every `keep`th point of it, smoothed), a point every `every`
 * m; `width` m across.
 */
const BEACH_LINE = { from: 540, to: S(1135), water: 30, every: 8, keep: 9, width: 9, shoulder: 1.5 };
{
  const g = bakeTrack(layout, surfaces);
  const ground = g.ground!;
  const hit = newHit();
  // Off the front road gently: its first point 30 m along, just past the verge (left: the sea's side).
  const fork = (s: number, along: number): [number, number] => {
    sampleAt(g.main, s + along, hit);
    const lat = hit.width / 2 + hit.shoulder + BEACH_LINE.width / 2 + 1;
    return [hit.cx + hit.tz * lat, hit.cz - hit.tx * lat];
  };
  const start = fork(BEACH_LINE.from, 30);
  const end = fork(BEACH_LINE.to, -30);
  // Along the water: from where the sand's BEACH_LINE.water m from the coast off the start, round
  // the coast's contour that far in, until it's level with the end.
  const contour: [number, number][] = [];
  let [x, z] = start;
  // (Seaward from the start to the contour.)
  for (let k = 0; k < 400 && ground.coast(x, z) > BEACH_LINE.water; k++) {
    const e = 0.5;
    const [gx, gz] = [ground.coast(x + e, z) - ground.coast(x - e, z), ground.coast(x, z + e) - ground.coast(x, z - e)];
    const l = Math.hypot(gx, gz) || 1;
    [x, z] = [x - (gx / l) * 2, z - (gz / l) * 2];
  }
  const toEnd = () => Math.hypot(end[0] - x, end[1] - z);
  sampleAt(g.main, BEACH_LINE.from + 30, hit);
  let [dx, dz] = [hit.tx, hit.tz];
  for (let k = 0; k < 400; k++) {
    contour.push([x, z]);
    const e = 0.5;
    const [gx, gz] = [ground.coast(x + e, z) - ground.coast(x - e, z), ground.coast(x, z + e) - ground.coast(x, z - e)];
    const l = Math.hypot(gx, gz) || 1;
    // Along the contour (the way we were going), pulled back onto it.
    let [tx, tz] = [-gz / l, gx / l];
    if (tx * dx + tz * dz < 0) [tx, tz] = [-tx, -tz];
    const back = (ground.coast(x, z) - BEACH_LINE.water) * 0.5;
    [x, z] = [x + tx * BEACH_LINE.every - (gx / l) * back, z + tz * BEACH_LINE.every - (gz / l) * back];
    [dx, dz] = [tx, tz];
    // Done when the end's inland of here, no further along the coast than it.
    projectGlobal(g.main, x, z, hit);
    if (toEnd() < 120 && (end[0] - x) * tx + (end[1] - z) * tz < 30) break;
  }
  // (Its contour every BEACH_LINE.keep points only, the first and last dropped, so it's a smooth sweep
  // along the water, not every wiggle of the coast: following them it was 661 m, about the road's.)
  const keep = contour.filter((_, k) => k > 0 && k < contour.length - 1 && k % BEACH_LINE.keep === 0);
  let line: [number, number][] = [start, ...keep, end];
  for (let pass = 0; pass < 3; pass++)
    line = [line[0], ...line.slice(0, -1).flatMap(([ax, az], k) => {
      const [bx, bz] = line[k + 1];
      return [[0.75 * ax + 0.25 * bx, 0.75 * az + 0.25 * bz], [0.25 * ax + 0.75 * bx, 0.25 * az + 0.75 * bz]] as [number, number][];
    }), line[line.length - 1]];
  // A point every BEACH_LINE.every m along it, on the sand.
  const points: TrackPoint[] = [];
  let left = 0;
  for (let k = 0; k + 1 < line.length; k++) {
    const [ax, az] = line[k];
    const [bx, bz] = line[k + 1];
    const d = Math.hypot(bx - ax, bz - az);
    for (; left < d; left += BEACH_LINE.every) {
      const [px, pz] = [ax + ((bx - ax) * left) / d, az + ((bz - az) * left) / d];
      points.push({ p: [Math.round(px * 10) / 10, Math.round(ground.height(px, pz) * 10) / 10, Math.round(pz * 10) / 10], width: BEACH_LINE.width, lanes: 1, shoulder: BEACH_LINE.shoulder, surface: 'packed-sand', verge: 'sand' });
    }
    left -= d;
  }
  const [lx, lz] = line[line.length - 1];
  points.push({ p: [Math.round(lx * 10) / 10, Math.round(ground.height(lx, lz) * 10) / 10, Math.round(lz * 10) / 10], width: BEACH_LINE.width, lanes: 1, shoulder: BEACH_LINE.shoulder, surface: 'packed-sand', verge: 'sand' });
  layout.branches!.push({ id: 'beach-line', from: BEACH_LINE.from, to: BEACH_LINE.to, kind: 'shortcut', points });
  layout.walls!.gaps!.push({ spline: 'beach-line', s: [0, 1e4], side: 'both' });
  const sp = bakeTrack(layout, surfaces).splines.find((x) => x.id === 'beach-line')!;
  console.log(`  beach line: ${Math.round(sp.length)} m (the road round: ${Math.round(BEACH_LINE.to - BEACH_LINE.from)} m)`);
}

/**
 * Harbor Town's buildings (the owner: Hawaii; Lahaina's Front Street): along the front road's town
 * side, a row of wooden shopfronts facing it (look 'shop': false fronts over a veranda), and behind
 * them plantation cottages (look 'plantation': board walls, tin hip roofs, a lanai) in rows up the
 * hill and along both sides of the back streets. `stretch` from and to (main distances), `rows`
 * deep, each row `row` m further back, the first `front` m past the road's verge; `clear` m off
 * every road's verge. Sizes m across, deep, and storeys (`storey` m each).
 */
const TOWN = { stretch: [S(3560), 205] as [number, number], rows: 5, row: 14, front: 4, clear: 2.5, storey: 3.4, shop: { width: [8, 12], depth: [9, 11], storeys: [1, 2] }, home: { width: [7, 10], depth: [7, 10], storeys: [1, 1.6] } };
/** The square at the line (the town's middle, between its two blocks): `s` along, its middle `lat` m to the right, `r` across, kept clear, its banyan in the middle (`trunk` m thick, `high` to its crown). */
const SQUARE = { s: 0, lat: 34, r: 20, trunk: 3.5, high: 13 };
/** Tiki torches along the front road through town: from and to (main distances, round the line), one every `every` m, `lateral` m past the road's edge (on its shoulder). */
const TORCHES = { from: S(3765), to: 160, every: 16, lateral: 2.5 };
/** Palms along the town's streets: one every `every` m down each back street (the front road's between its torches), `out` m past the verge, kept `house` m off a house's walls; round the grid (`before` the line to `after` it), `clear` m off the front road's verge; none where a street turns more than `turn` (radians) over `over` m either side (the front road, `main` m). */
const PALMS = { every: 14, out: 1.6, house: 1.5, grid: { before: 150, after: 120, clear: 6 }, corner: { over: 10, main: 25, turn: 0.25 } };
/** The surf shack on the beach by the west car park: `s` along, `lat` m to the left, its size. */
const SHACK = { s: 165, lat: 34, size: [8, 6, 3.4] as [number, number, number] };
{
  const g = bakeTrack(layout, surfaces);
  const ground = g.ground!;
  const L = g.main.length;
  const hit = newHit();
  const contact = newContact();
  let rng = Rng.stream(7, 'harbor-town');
  const range = ([lo, hi]: readonly number[]) => lo + (hi - lo) * rng.next();
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const houses: HouseDef[] = [];
  const add = (x: number, z: number, w: number, d: number, high: number, rot: number, look: string) =>
    houses.push({ at: [r1(x), r1(z)], size: [r1(w), r1(d), r1(high)], rot: Math.round(rot * 1000) / 1000, look });
  // The square's middle.
  sampleAt(g.main, SQUARE.s, hit);
  const square: [number, number] = [hit.cx - hit.tz * SQUARE.lat, hit.cz + hit.tx * SQUARE.lat];
  /** Whether a footprint (its corners and middle) is clear of every road's verge by `clear` (`own`: its own road by `near`), of the water and the square, and of the houses so far. */
  const free = (x: number, z: number, w: number, d: number, rot: number, clear = TOWN.clear, own?: string, near = 0) => {
    const fx = Math.sin(rot);
    const fz = Math.cos(rot);
    for (const [a, b] of [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const px = x + (a * w * fz) / 2 + (b * d * fx) / 2;
      const pz = z - (a * w * fx) / 2 + (b * d * fz) / 2;
      if (ground.coast(px, pz) < 6 || ground.height(px, pz) < 1) return false;
      for (const sp of g.splines) {
        projectGlobal(sp, px, pz, hit);
        if (offRoad(sp, px, pz, hit) < hit.width / 2 + hit.shoulder + (sp.id === own ? near : clear)) return false;
      }
    }
    if (Math.hypot(x - square[0], z - square[1]) < SQUARE.r + Math.max(w, d) / 2) return false;
    return houses.every((h) => !obbOverlap(x, z, rot, w / 2 - 0.2, d / 2 - 0.2, h.at[0], h.at[1], h.rot, h.size[0] / 2 - 0.2, h.size[1] / 2 - 0.2, contact));
  };
  // The banyan in the square (a solid trunk; its crown the skin's), and the surf shack on the sand.
  add(square[0], square[1], SQUARE.trunk, SQUARE.trunk, SQUARE.high, 0, 'banyan');
  // (The shack's the landmark's, standing in a solid block: look 'landmark'.) Facing the road.
  sampleAt(g.main, SHACK.s, hit);
  const [sx, sz, srot] = [hit.cx + hit.tz * SHACK.lat, hit.cz - hit.tx * SHACK.lat, Math.atan2(-hit.tz, hit.tx)];
  add(sx, sz, ...SHACK.size, srot, 'landmark');
  const shack = { kind: 'surf-shack', at: [r1(sx), r1(sz)] as [number, number], rot: Math.round(srot * 1000) / 1000, r: 0 };
  // Rows along a road, facing it: `sp` from `u0` to `u1` (m along it), on its side `sd` (+1 right).
  const rows = (sp: (typeof g.splines)[number], u0: number, u1: number, sd: 1 | -1, n: number, kind: (row: number) => typeof TOWN.shop, look: (row: number) => string) => {
    const len = sp === g.main ? (u1 - u0 + L) % L : u1 - u0;
    for (let row = 0; row < n; row++)
      for (let u = 0; u < len; ) {
        const k = kind(row);
        const w = range(k.width);
        const d = range(k.depth);
        const storeys = range(k.storeys);
        sampleAt(sp, sp === g.main ? (u0 + u + w / 2) % L : u0 + u + w / 2, hit);
        const off = hit.width / 2 + hit.shoulder + TOWN.front + row * TOWN.row + d / 2 + range([0, 2]);
        const x = hit.cx - hit.tz * off * sd;
        const z = hit.cz + hit.tx * off * sd;
        const rot = Math.atan2(hit.tz * sd, -hit.tx * sd);
        if (free(x, z, w, d, rot)) add(x, z, w, d, storeys * TOWN.storey, rot, look(row));
        u += w + range([1.5, 4]);
      }
  };
  // The front road's shops first, then the cottages behind, then along the back streets.
  rows(g.main, TOWN.stretch[0], TOWN.stretch[1], 1, 1, () => TOWN.shop, () => 'shop');
  rng = Rng.stream(7, 'harbor-town-homes');
  for (const id of ['waine-e', 'luakini']) {
    const sp = g.splines.find((x) => x.id === id)!;
    for (const sd of [-1, 1] as const) rows(sp, 8, sp.length - 8, sd, 1, () => TOWN.home, () => 'plantation');
  }
  rows(g.main, TOWN.stretch[0], TOWN.stretch[1], 1, TOWN.rows, () => TOWN.home, () => 'plantation');
  // The car parks: a row of bays either side of each lot's aisle, down its straight (along the
  // front road, where it's level on its pad), cars nose in, some empty; drawn by a landmark each
  // (the bays' lines, a kerb, palms, a sign), on its pad.
  rng = Rng.stream(7, 'harbor-town-lots');
  const lots: LandmarkDef[] = [];
  for (const { id, from, to } of LOTS.list) {
    const { mid, lat } = lotAt(from, to);
    const len = (to - from + L) % L;
    const straight = len - 2 * (LOTS.fork + LOTS.lead);
    // (The rounding of its driveways' corners takes about 6 m off each end of the aisle's straight.)
    const bays = Math.floor((straight - 12) / LOTS.bay);
    const aisle = lotAisle();
    // (Its own hit: `free` projects into `hit`.)
    const at = newHit();
    for (let j = 0; j < bays; j++) {
      const s = (mid + (j - (bays - 1) / 2) * LOTS.bay + L) % L;
      sampleAt(g.main, s, at);
      for (const sd of [-1, 1] as const) {
        const [cw, cl, ch] = LOTS.cars[Math.floor(rng.next() * LOTS.cars.length)];
        const taken = rng.next() < LOTS.fill;
        // Its front at the aisle's edge and a little: `sd` -1 the bays toward the front road, 1 the sea's.
        const off = lat + sd * (aisle + 1.2 + cl / 2);
        const x = at.cx + at.tz * off;
        const z = at.cz - at.tx * off;
        // Nose in: facing the aisle (toward the front road from the sea's row, away from it from the road's).
        const rot = Math.atan2(at.tz * sd, -at.tx * sd);
        if (taken && free(x, z, cw, cl, rot, 1.05, id, 1.05)) add(x, z, cw, cl, ch, rot, 'parked');
      }
    }
    sampleAt(g.main, mid, hit);
    lots.push({ kind: 'car-park', at: [r1(hit.cx + hit.tz * lat), r1(hit.cz - hit.tx * lat)], rot: Math.round(Math.atan2(hit.tx, hit.tz) * 1000) / 1000, r: 0, params: { length: Math.round(straight + 12), depth: r1(lotDepth()), aisle: r1(aisle), bays, bay: LOTS.bay } });
  }
  layout.houses = houses;
  // Palms along the streets (the owner, 2026-10-07: "palms along the town streets"): planted trees,
  // solid as the rest (PinesDef.plant). Down both sides of the front road through town, between the
  // tiki torches, and of each back street, PALMS.out m past the verge; none where another road comes
  // within a metre (a junction's mouth, a driveway), on a pad, in the square, or within
  // PALMS.house m of a house's walls.
  const pads = layout.ground!.features!.filter((f): f is PadDef => f.kind === 'pad').map(padDistance);
  const palms: [number, number][] = [];
  const plant = (sp: (typeof g.splines)[number], s: number, sd: 1 | -1) => {
    // (Not on a corner: a racer shoved onto Luakini off the start ran wide round its bends, and the
    // field cut the front road's bend into town.)
    {
      const over = sp === g.main ? PALMS.corner.main : PALMS.corner.over;
      const wrap = (u: number) => (sp === g.main ? ((u % sp.length) + sp.length) % sp.length : Math.max(0, Math.min(sp.length, u)));
      const [p, q] = [sampleAt(sp, wrap(s - over), newHit()), sampleAt(sp, wrap(s + over), newHit())];
      if (Math.acos(Math.min(1, p.tx * q.tx + p.tz * q.tz)) > PALMS.corner.turn) return;
    }
    sampleAt(sp, ((s % sp.length) + sp.length) % sp.length, hit);
    const off = hit.width / 2 + hit.shoulder + PALMS.out;
    const x = hit.cx - hit.tz * off * sd;
    const z = hit.cz + hit.tx * off * sd;
    if (ground.coast(x, z) < 6 || Math.hypot(x - square[0], z - square[1]) < SQUARE.r + 2 || pads.some((d) => d(x, z) < 2)) return;
    for (const other of g.splines) {
      projectGlobal(other, x, z, hit);
      const off = offRoad(other, x, z, hit) - hit.width / 2 - hit.shoulder;
      if (off < 1) return;
      // (Round the grid, well off the front road: shoved wide off the start, a racer hit the palm
      // by Luakini's mouth every race.)
      if (other === g.main && off < PALMS.grid.clear && (hit.s > L - PALMS.grid.before || hit.s < PALMS.grid.after)) return;
    }
    for (const h of houses) {
      const [dx, dz] = [x - h.at[0], z - h.at[1]];
      const [fx, fz] = [Math.sin(h.rot), Math.cos(h.rot)];
      if (Math.abs(dx * fz - dz * fx) < h.size[0] / 2 + PALMS.house && Math.abs(dx * fx + dz * fz) < h.size[1] / 2 + PALMS.house) return;
    }
    palms.push([r1(x), r1(z)]);
  };
  const town = (TOWN.stretch[1] - TOWN.stretch[0] + L) % L;
  for (let u = TORCHES.every / 2; u < town; u += TORCHES.every) for (const sd of [-1, 1] as const) plant(g.main, TOWN.stretch[0] + u, sd);
  for (const id of ['waine-e', 'luakini']) {
    const sp = g.splines.find((x) => x.id === id)!;
    for (let u = PALMS.every / 2; u < sp.length; u += PALMS.every) for (const sd of [-1, 1] as const) plant(sp, u, sd);
  }
  layout.ground!.pines = { ...layout.ground!.pines!, plant: palms };
  // Tiki torches along the front road through town, both sides, over the line (two rows: a row
  // doesn't run round it).
  const torches = (s: [number, number]) => ({ kind: 'tiki-torch', s, every: TORCHES.every, lateral: TORCHES.lateral });
  layout.smashables = [...(layout.smashables ?? []), torches([TORCHES.from, Math.floor(L)]), torches([0, TORCHES.to])];
  layout.landmarks = [...(layout.landmarks ?? []), ...lots, shack];
  const count = (look: string) => houses.filter((h) => h.look === look).length;
  console.log(`  harbor town: ${count('shop')} shops, ${count('plantation')} cottages, ${count('parked')} parked cars, ${palms.length} palms`);
}

/**
 * The beach run's dressing (the owner: "the beach run to the Freeway"): lifeguard towers on the
 * sand between the beach line and the water, at `towers` of its length, `out` m seaward of its
 * verge, facing the sea (solid: a house, look 'landmark', the landmark standing in it); and racks
 * of surfboards (smashables) beside it, a pair at each of `racks` of its length, `rack` m off its
 * verge either side.
 */
const BEACH_DRESS = { towers: [0.22, 0.5, 0.78], out: 9, tower: [3.4, 3, 5] as [number, number, number], racks: [0.12, 0.36, 0.64, 0.88], rack: 3 };
{
  const g = bakeTrack(layout, surfaces);
  const ground = g.ground!;
  const sp = g.splines.find((x) => x.id === 'beach-line')!;
  const hit = newHit();
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const side = (u: number, off: number, sd: 1 | -1) => {
    sampleAt(sp, u * sp.length, hit);
    const lat = (hit.width / 2 + hit.shoulder + off) * sd;
    return [hit.cx - hit.tz * lat, hit.cz + hit.tx * lat] as [number, number];
  };
  // The sea's side of the line: whichever side the coast is nearer.
  const [ax, az] = side(0.5, 5, 1);
  const [bx, bz] = side(0.5, 5, -1);
  const sea: 1 | -1 = ground.coast(ax, az) < ground.coast(bx, bz) ? 1 : -1;
  for (const u of BEACH_DRESS.towers) {
    const [x, z] = side(u, BEACH_DRESS.out, sea);
    // Facing the sea: down the coast's slope.
    const e = 0.5;
    const rot = Math.atan2(-(ground.coast(x + e, z) - ground.coast(x - e, z)), -(ground.coast(x, z + e) - ground.coast(x, z - e)));
    layout.houses!.push({ at: [r1(x), r1(z)], size: BEACH_DRESS.tower, rot: Math.round(rot * 1000) / 1000, look: 'landmark' });
    layout.landmarks!.push({ kind: 'lifeguard-tower', at: [r1(x), r1(z)], rot: Math.round(rot * 1000) / 1000, r: 0 });
  }
  const at: [number, number][] = [];
  for (const u of BEACH_DRESS.racks) for (const sd of [-1, 1] as const) at.push(side(u, BEACH_DRESS.rack, sd).map(r1) as [number, number]);
  layout.smashables!.push({ kind: 'surf-rack', s: [0, 0], every: 0, at });
  console.log(`  beach run: ${BEACH_DRESS.towers.length} lifeguard towers, ${at.length} surfboard racks`);
}

// The bulge's pool's floor: the ground at the stream's end, its channel cut (the pool's floor level there).
{
  const west = layout.ground!.features!.find((f) => f.kind === 'lava-stream' && f.pool)!;
  if (west.kind !== 'lava-stream') throw new Error('no west stream');
  const [ex, ez] = west.path[west.path.length - 1];
  const trial = bakeTrack({ ...layout, ground: { ...layout.ground!, features: layout.ground!.features!.map((f) => (f === west ? { ...west, pool: undefined } : f)) } }, surfaces);
  west.pool!.floor = Math.round(trial.ground!.height(ex, ez) * 100) / 100;
}

// The lava streams keep clear of every road: their paths (and the pool's edge) LAVA_CLEAR m from
// every road's edge (the validator wants less: their rock and bare ground, LAVA_REACH m past their
// floors, off every shoulder).
{
  const roads = bakeTrack(layout, surfaces).splines;
  for (const stream of layout.ground!.features!) {
    if (stream.kind !== 'lava-stream') continue;
    let clear = Infinity;
    const [ex, ez] = stream.path[stream.path.length - 1];
    for (const [x, z] of stream.path)
      for (const sp of roads) for (let i = 0; i < sp.n; i++) clear = Math.min(clear, Math.hypot(sp.px[i] - x, sp.pz[i] - z) - sp.width[i] / 2 - sp.shoulder[i] - (stream.pool && x === ex && z === ez ? stream.pool.r : 0));
    if (clear < LAVA_CLEAR - 0.5) throw new Error(`a lava stream comes within ${clear.toFixed(1)} m of a road (want ${LAVA_CLEAR})`);
    console.log(`  lava stream: ${stream.path.length} points${stream.pool ? `, a pool ${stream.pool.r} m round at ${stream.pool.floor} m` : ''}, ${clear.toFixed(0)} m from the nearest road`);
  }
}

mkdirSync(DIR, { recursive: true });
writeFileSync(`${DIR}/open.track.json`, `${JSON.stringify(layout)}\n`);
writeFileSync(`${DIR}/map.json`, `${JSON.stringify({ id: 'paradise-open', name: 'Paradise Open', layouts: ['open'], palette: 'tropic', sunset: 'sunset', weather: ['clear', 'rain', 'shower'], experimental: true })}\n`);
const track = bakeTrack(layout, surfaces);
console.log(`paradise-open/open: ${Math.round(track.main.length)} m, ground ${track.ground!.nx}×${track.ground!.nz}, deck ${FREEWAY.join('–')} m`);
console.log(`  lava tube: ${Math.round(tube.length)} m (the road round: ${TUBE.to - TUBE.from} m), tunnels ${Math.round(portalIn)}–${Math.round(shaftIn)} and ${Math.round(shaftOut)}–${Math.round(portalOut)} m, bridge ${Math.round(shaftIn)}–${Math.round(shaftOut)} m, the jump ${lip}–${far} m`);
