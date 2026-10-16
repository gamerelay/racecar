// Traffic (SPEC §4, category D): every traffic car's position is a closed-form function of the
// room seed and race time. Cars drive their lane of the main spline at the lane's speed, so none
// ever overtakes another and nothing is sent over the network. Each tick only the cars near some
// racer are posed into a small pool (LOD); the rest are a formula nobody evaluates.
//
// A wrecked traffic car (rammed, checked, caught in a hazard) is hidden from its wreck time until
// it's due back; the renderer tumbles a cosmetic copy (category L).
//
// Nothing pops: a car's visibility (0–1) is a formula too. It fades in over FADE meters of road
// before its lane's section starts and out over FADE after it ends, and back in over a second after
// a wreck. Only a fully visible car is posed for the sim (collisions, near misses, the AI); the
// renderer draws the fading ones dithered. The start grid is kept clear by where the cars start, not
// by a fade: each lane's cars are spaced round the part of its loop from which none comes near the
// grid while it's clear (`gridSlots`), so nobody watches a car fade in on the first straight.
//
// A lane may come and go by side streets instead (TrafficLaneDef.streets, docs/COASTAL.md): each
// pair of its streets is a route, in up the far half of one, along the main road, out by the near
// half of the next. Its cars go round the route and a short stretch out of sight (HIDDEN) in turn,
// fading at the streets' middles, and are blended from street to main road and back over JOIN m.
// Still a formula of the seed and the race time, still no overtaking.
//
// Or a lane loops a path through open ground's streets (TrafficLaneDef.path, the getaway's city):
// corners rounded, resampled every PATH_STEP m, each sample's main distance and offset found once
// at load. Its cars cruise round it on the ground and are met where they are (not by main distance).

import type { TrafficLaneDef } from '../content';
import { hash01 } from '../rng';
import type { BakedSpline, Track } from '../track/bake';
import { projectGlobal, sampleAt, type TrackHit } from '../track/query';
import { newHit } from '../track/query';
import { mainDistance, signedGap, wrap } from '../track/bake';
import { atan2, hypot, smoothstep, sq, tan } from '../math';

export interface TrafficKind {
  id: string;
  hw: number;
  hl: number;
  hh: number;
  /** Too big to check out of the way, even boosting. */
  big: boolean;
  /** How often it's picked for a lane of any kind (0: only a lane that names it, TrafficLaneDef.kinds). */
  weight: number;
  /**
   * An animal (Sahara's camels): never wrecked, never a wreck. Hit, it scatters (gone as a wrecked
   * car is, back as one comes back) and the car loses a little speed; nothing tumbles.
   */
  animal?: boolean;
}

export const TRAFFIC_KINDS: TrafficKind[] = [
  { id: 'sedan', hw: 0.95, hl: 2.25, hh: 0.75, big: false, weight: 5 },
  { id: 'compact', hw: 0.9, hl: 1.95, hh: 0.75, big: false, weight: 3 },
  { id: 'van', hw: 1.0, hl: 2.5, hh: 1.1, big: false, weight: 2 },
  { id: 'truck', hw: 1.2, hl: 3.8, hh: 1.5, big: true, weight: 1 },
  { id: 'bus', hw: 1.25, hl: 5.2, hh: 1.5, big: true, weight: 0.6 },
  // A camel in a caravan (Sahara's Caravan Road): only in a lane that names it.
  { id: 'camel', hw: 0.45, hl: 1.5, hh: 1.05, big: false, weight: 0, animal: true },
];
/** A car hitting an animal keeps this much of its speed. */
export const ANIMAL_SLOW = 0.8;
export const TRUCK = 3;

/** How close (along the road, or in a straight line) a traffic car must be to a racer to be posed this tick. */
const LOD = 350;
export const LOD_STRAIGHT = 250;
/** Meters of road a car fades over entering or leaving traffic; seconds a returning wreck takes. */
export const FADE = 45;
export const FADE_BACK = 1;
/** Seconds a wrecked traffic car stays gone. */
export const TRAFFIC_RESPAWN = 12;
/**
 * No traffic within this much of the start line (and FADE more either side) for the first
 * `seconds` of sim time (the countdown and just after green): the cars start where they won't come
 * near it in that time. A lane that can't (its whole loop does) fades out of it instead, as all did.
 * (Animals only keep off the grid behind the line.)
 */
export const GRID_CLEAR = { behind: 160, ahead: 60, seconds: 10 };
const POOL = 128;
/** A route's cars are out of sight for this much (m) of their loop, between leaving and coming back. */
const HIDDEN = 60;
/** Over this much (m) a route's car is blended from a street onto the main road, and back off it. */
export const JOIN = 24;
/** Over this much (m) of a street's middle a route's car fades in or out (not FADE: on a short street, that reached back toward the main road). */
export const STREET_FADE = 20;
/** A path lane's samples are this far apart (m), and its corners rounded over this much either side. */
const PATH_STEP = 2;
const PATH_CORNER = 7;
/**
 * A path lane's car stops this far (m) before a stop corner's middle (the line before the
 * crosswalk), slowing at STOP_DECEL m/s² and pulling away as hard, standing STOP_WAIT s.
 */
const STOP_BACK = 13;
const STOP_DECEL = 3.5;
export const STOP_WAIT = 2;
/** No path lane's car within this much (m) of the getaway's start in the start grid's clear time (it'd pull up on the parked car). */
const PATH_CLEAR = 110;

/**
 * A path lane's loop, resampled (TrafficLaneDef.path): positions, headings, main distances and
 * offsets, every PATH_STEP m; and where round it its cars stop (`stops`, m, ascending, each with
 * room to slow and pull away inside the loop), the time a car reaches each one's slowing (`tin`, s
 * round the loop), and the time once round (`T`) at the lane's speed `v`.
 */
export interface TrafficPath {
  n: number;
  /** Where round it (s, its time round the loop) a wrecked car comes back (TrafficLaneDef.back); -1: where it is. */
  backTau: number;
  /** Where it runs along the main road against the lap, on it (main distances), and which side (sign of lat): oncoming traffic to a racer there. */
  against: [number, number][];
  side: number;
  stops: Float64Array;
  tin: Float64Array;
  T: number;
  v: number;
  x: Float64Array;
  z: Float64Array;
  tx: Float64Array;
  tz: Float64Array;
  s: Float64Array;
  lat: Float64Array;
}

/**
 * A loop's corners rounded (a curve PATH_CORNER m in from each), resampled every PATH_STEP m, moved
 * `pos` m to its right; its stops STOP_BACK m before the `stops` corners, and the loop's start moved
 * to the middle of the longest run between two stops (so none slows across it).
 */
function pathLoop(track: Track, line: readonly [number, number][], pos: number, speed: number, stopAt: readonly number[] = [], back = -1): TrafficPath {
  const pts: [number, number][] = [];
  const m = line.length;
  // Over to its right first (each corner where its two streets' offset lines meet), so it's spaced
  // evenly along where it's driven: moved after, a left turn's outside ran 60% fast.
  const corners = line.map(([cx, cz], k): [number, number] => {
    const [px, pz] = line[(k + m - 1) % m];
    const [nx, nz] = line[(k + 1) % m];
    const la = hypot(cx - px, cz - pz) || 1;
    const lb = hypot(nx - cx, nz - cz) || 1;
    // Each street's right: (-tz, tx).
    const ax = -(cz - pz) / la;
    const az = (cx - px) / la;
    const bx = -(nz - cz) / lb;
    const bz = (nx - cx) / lb;
    const f = pos / Math.max(0.3, 1 + ax * bx + az * bz);
    return [cx + (ax + bx) * f, cz + (az + bz) * f];
  });
  for (let k = 0; k < m; k++) {
    const [px, pz] = corners[(k + m - 1) % m];
    const [cx, cz] = corners[k];
    const [nx, nz] = corners[(k + 1) % m];
    const a = Math.min(PATH_CORNER, hypot(cx - px, cz - pz) / 2);
    const b = Math.min(PATH_CORNER, hypot(nx - cx, nz - cz) / 2);
    const la = hypot(cx - px, cz - pz) || 1;
    const lb = hypot(nx - cx, nz - cz) || 1;
    // In from the previous corner to `a` short of this one, a quadratic round it to `b` past it.
    const p0: [number, number] = [cx - ((cx - px) / la) * a, cz - ((cz - pz) / la) * a];
    const p2: [number, number] = [cx + ((nx - cx) / lb) * b, cz + ((nz - cz) / lb) * b];
    for (let q = 0; q <= 4; q++) {
      const t = q / 4;
      pts.push([(1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * cx + t * t * p2[0], (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * cz + t * t * p2[1]]);
    }
  }
  // Resampled by length round the closed loop.
  const cum = [0];
  for (let k = 1; k <= pts.length; k++) cum.push(cum[k - 1] + hypot(pts[k % pts.length][0] - pts[k - 1][0], pts[k % pts.length][1] - pts[k - 1][1]));
  const R = cum[pts.length];
  const n = Math.max(3, Math.round(R / PATH_STEP));
  const out: TrafficPath = { n, backTau: -1, against: [], side: 0, stops: new Float64Array(0), tin: new Float64Array(0), T: 0, v: speed, x: new Float64Array(n), z: new Float64Array(n), tx: new Float64Array(n), tz: new Float64Array(n), s: new Float64Array(n), lat: new Float64Array(n) };
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const d = (i / n) * R;
    while (cum[seg + 1] < d) seg++;
    const [ax, az] = pts[seg];
    const [bx, bz] = pts[(seg + 1) % pts.length];
    const f = (d - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
    out.x[i] = ax + (bx - ax) * f;
    out.z[i] = az + (bz - az) * f;
  }
  // The sample nearest a corner.
  const nearest = (c: number): number => {
    let best = 0;
    for (let i = 1; i < n; i++) if (hypot(out.x[i] - corners[c][0], out.z[i] - corners[c][1]) < hypot(out.x[best] - corners[c][0], out.z[best] - corners[c][1])) best = i;
    return best;
  };
  // The stops: the sample nearest each stop corner, STOP_BACK before it (samples, round the loop).
  let stops = stopAt
    .filter((c) => c >= 0 && c < m)
    .map((c) => (nearest(c) - Math.round(STOP_BACK / PATH_STEP) + n) % n)
    .sort((a, b) => a - b);
  // (Where a wrecked car comes back: found before the samples are turned, and turned with them.)
  let backAt = back >= 0 && back < m ? nearest(back) : -1;
  // Start the loop in the middle of the longest run between stops: rotate the samples.
  if (stops.length) {
    let gap = -1;
    let mid = 0;
    for (let q = 0; q < stops.length; q++) {
      const a = stops[q];
      const b = q + 1 < stops.length ? stops[q + 1] : stops[0] + n;
      if (b - a > gap) (gap = b - a), (mid = Math.round((a + b) / 2) % n);
    }
    for (const arr of [out.x, out.z]) {
      const copy = Float64Array.from(arr);
      for (let i = 0; i < n; i++) arr[i] = copy[(i + mid) % n];
    }
    stops = stops.map((i) => (i - mid + n) % n).sort((a, b) => a - b);
    if (backAt >= 0) backAt = (backAt - mid + n) % n;
  }
  // Each with room to slow and pull away (b m either side), clear of the last and of the loop's ends.
  const ramp = (speed * speed) / (2 * STOP_DECEL);
  const kept: number[] = [];
  for (const i of stops) {
    const d = i * PATH_STEP;
    if (d - ramp < 0 || d + ramp > n * PATH_STEP) continue;
    if (kept.length && d - kept[kept.length - 1] < 2 * ramp + PATH_STEP) continue;
    kept.push(d);
  }
  out.stops = Float64Array.from(kept);
  // The time at each one's slowing: cruising to it, and each before it took v/a + STOP_WAIT longer than cruising.
  const extra = speed / STOP_DECEL + STOP_WAIT;
  out.tin = Float64Array.from(kept, (d, k) => (d - ramp) / speed + k * extra);
  out.T = (n * PATH_STEP) / speed + kept.length * extra;
  if (backAt >= 0) {
    // Its time round the loop there: cruising to it, plus each stop's slowing and standing before it.
    const d = backAt * PATH_STEP;
    out.backTau = d / speed + kept.filter((x) => x < d).length * extra;
  }
  const hit = newHit();
  for (let i = 0; i < n; i++) {
    const dx = out.x[(i + 1) % n] - out.x[(i + n - 1) % n];
    const dz = out.z[(i + 1) % n] - out.z[(i + n - 1) % n];
    const len = hypot(dx, dz) || 1;
    out.tx[i] = dx / len;
    out.tz[i] = dz / len;
  }
  // Where it is by the main road; and where it's on it, going against the lap (Sahara's caravan down
  // the Caravan Road's edge), as runs of main distance.
  let run = -1;
  let side = 0;
  for (let i = 0; i <= n; i++) {
    let on = false;
    if (i < n) {
      projectGlobal(track.main, out.x[i], out.z[i], hit);
      out.s[i] = hit.s;
      out.lat[i] = hit.lateral;
      on = Math.abs(hit.lateral) < hit.width / 2 + hit.shoulder && out.tx[i] * hit.tx + out.tz[i] * hit.tz < -0.7;
      if (on) side += hit.lateral;
    }
    if (on && run < 0) run = i;
    if (!on && run >= 0) {
      // (Against the lap: its last sample is the run's start along the main road.)
      if (i - run > 2) out.against.push([out.s[i - 1], out.s[run]]);
      run = -1;
    }
  }
  out.side = Math.sign(side);
  return out;
}

/**
 * A route (TrafficLaneDef.streets): in up `inSp` from its middle, along the main road from `on` to
 * `off` (main distances, the lane's way), out by `outSp` to its middle. `a`, `b`, `c` are those
 * three parts' lengths, `R` the route's, `C` its loop's (with the stretch out of sight). A lane
 * along one street (TrafficLaneDef.road) is a route of `road` alone, from `from` over `R` m of it.
 */
export interface TrafficRoute {
  inSp: BakedSpline;
  outSp: BakedSpline;
  on: number;
  off: number;
  a: number;
  b: number;
  c: number;
  R: number;
  C: number;
  road?: BakedSpline;
  from?: number;
  path?: TrafficPath;
}

/**
 * The lanes as the traffic runs them: a lane by side streets is one per route (consecutive streets),
 * each with its main stretch as its section (so `laneActive` and everything reading sections holds),
 * and its route; any other lane as it is, with no route.
 */
export function trafficLanes(track: Track, defs: readonly TrafficLaneDef[]): { lanes: TrafficLaneDef[]; routes: (TrafficRoute | null)[] } {
  const lanes: TrafficLaneDef[] = [];
  const routes: (TrafficRoute | null)[] = [];
  const L = track.main.length;
  for (const def of defs) {
    if (def.path) {
      // Round its loop through the streets, never on the main road's lanes.
      if (!track.ground || def.path.length < 3) continue;
      const path = pathLoop(track, def.path, def.pos, def.speed, def.stops, def.back);
      const R = path.n * PATH_STEP;
      lanes.push({ ...def, sections: [] });
      routes.push({ inSp: track.main, outSp: track.main, on: 0, off: 0, a: R, b: 0, c: 0, R, C: R, path });
      continue;
    }
    if (def.road !== undefined) {
      // Along one street: never on the main road (no sections: no main road's lane is it).
      const sp = track.splines.find((x) => x.id === def.road);
      if (!sp) continue;
      const [a, b] = def.span ?? [0, sp.length];
      const R = b - a;
      lanes.push({ ...def, sections: [] });
      routes.push({ inSp: sp, outSp: sp, on: 0, off: 0, a: R, b: 0, c: 0, R, C: R + HIDDEN, road: sp, from: a });
      continue;
    }
    if (!def.streets) {
      lanes.push(def);
      routes.push(null);
      continue;
    }
    for (let q = 0; q + 1 < def.streets.length; q++) {
      const inSp = track.splines.find((sp) => sp.id === def.streets![q]);
      const outSp = track.splines.find((sp) => sp.id === def.streets![q + 1]);
      if (!inSp || !outSp) continue;
      // With the road, onto it where the first street rejoins and off where the next leaves; against
      // it, onto it where the first leaves (it's driven backwards) and off where the next rejoins.
      const on = def.dir > 0 ? inSp.mainTo : inSp.mainFrom;
      const off = def.dir > 0 ? outSp.mainFrom : outSp.mainTo;
      const a = inSp.length / 2;
      const b = wrap((off - on) * def.dir, L);
      const c = outSp.length / 2;
      const R = a + b + c;
      // (Its count, if it gives one, shared between its routes; its kinds as given.)
      const count = def.count !== undefined ? def.count / (def.streets.length - 1) : undefined;
      lanes.push({ pos: def.pos, dir: def.dir, speed: def.speed, sections: [def.dir > 0 ? [on, off] : [off, on]], ...(count !== undefined ? { count } : {}), ...(def.kinds ? { kinds: def.kinds } : {}) });
      routes.push({ inSp, outSp, on, off, a, b, c, R, C: R + HIDDEN });
    }
  }
  return { lanes, routes };
}

/** Whether a lane has traffic at main distance s (inside one of its sections, or it has none). */
export function laneActive(lane: TrafficLaneDef, s: number): boolean {
  const sections = lane.sections;
  if (!sections) return true;
  for (let j = 0; j < sections.length; j++) {
    const a = sections[j][0];
    const b = sections[j][1];
    if (a <= b ? s >= a && s <= b : s >= a || s <= b) return true;
  }
  return false;
}

export interface TrafficPose {
  s: number;
  lat: number;
  x: number;
  y: number;
  z: number;
  h: number;
  vx: number;
  vz: number;
}

export const newTrafficPose = (): TrafficPose => ({ s: 0, lat: 0, x: 0, y: 0, z: 0, h: 0, vx: 0, vz: 0 });

export class Traffic {
  /** The lanes as run (trafficLanes): one per route for a lane by side streets. */
  readonly lanes: TrafficLaneDef[];
  /** Each lane's route, or null (it runs the whole lap, seen in its sections). */
  readonly routes: (TrafficRoute | null)[];
  readonly count: number;
  /** Per traffic car (static for the race): lane, start distance, kind. */
  readonly lane: Uint8Array;
  readonly s0: Float64Array;
  readonly kind: Uint8Array;
  /** Race time the car was wrecked (-1: never). Part of the sim snapshot. */
  readonly wreckedAt: Float64Array;
  /** Per lane: whether its cars fade out of the start grid's clear zone (no start kept them out of it). */
  readonly gridFade: readonly boolean[];

  /** Posed this tick: traffic index and pose. */
  posed = 0;
  readonly idx = new Int32Array(POOL);
  readonly x = new Float64Array(POOL);
  readonly y = new Float64Array(POOL);
  readonly z = new Float64Array(POOL);
  readonly h = new Float64Array(POOL);
  readonly vx = new Float64Array(POOL);
  readonly vz = new Float64Array(POOL);
  readonly s = new Float64Array(POOL);
  readonly lat = new Float64Array(POOL);
  /** Its speed along the main road (m/s, the main road's way): its lane's, or on a street, what of it is along the road. */
  readonly along = new Float64Array(POOL);
  /**
   * Where the AI reckons it is (main distance, across): where it is, but a car on its way in from a
   * side street already in its lane, where it'll be when it joins (it pulled out under racers'
   * noses: a driver sees a car about to pull out). Only the AI reads these: a hit is where it is.
   */
  readonly seenS = new Float64Array(POOL);
  readonly seenLat = new Float64Array(POOL);
  private readonly hit: TrackHit = newHit();
  /** A route's car's second road, while it's blended between two, and the main road beside it. */
  private readonly joinHit: TrackHit = newHit();
  private readonly mainHit: TrackHit = newHit();
  private readonly renderHit: TrackHit = newHit();
  private readonly scratch: TrafficPose = newTrafficPose();

  constructor(
    private readonly track: Track,
    seed: number,
    density = 1,
  ) {
    const def = track.layout.traffic;
    const run = trafficLanes(track, def?.lanes ?? []);
    this.lanes = run.lanes;
    this.routes = run.routes;
    const L = track.main.length;
    // Cars loop the whole lap but only appear in their lane's sections, so size the fleet so the
    // sections get `density` cars per km. A route's cars loop the route: `density` per km of it.
    const wanted = this.lanes.map((lane, l) => Math.max(0, Math.round(lane.count !== undefined ? lane.count * density : ((this.routes[l]?.R ?? L) / 1000) * (def?.density ?? 0) * density)));
    // Kept off the start grid (gridSlots): spaced round the loop's slots clear of it, as many fewer
    // as there's less loop, so the road's as busy as ever (none: as ever, faded out of it instead).
    const slotsOf = this.lanes.map((lane, l) => (wanted[l] > 0 ? this.gridSlots(l, lane.string?.[0] ?? 1, lane.string?.[1] ?? 0, this.routes[l]?.C ?? L) : null));
    this.gridFade = slotsOf.map((slots) => slots?.length === 0);
    const perLane = wanted.map((n, l) => {
      const slots = slotsOf[l];
      return slots?.length ? Math.round((n * slots.length) / Math.ceil(this.routes[l]?.C ?? L)) : n;
    });
    this.count = perLane.reduce((a, b) => a + b, 0);
    this.lane = new Uint8Array(this.count);
    this.s0 = new Float64Array(this.count);
    this.kind = new Uint8Array(this.count);
    this.wreckedAt = new Float64Array(this.count).fill(-1);
    // (Every kind with a weight, in order; a lane naming its kinds draws from those, evenly.)
    const anyKind = TRAFFIC_KINDS.flatMap((x, n) => (x.weight > 0 ? [n] : []));
    let k = 0;
    // (Each car's numbers hashed by where it'd be among `wanted`: a lane with fewer leaves the rest as they were.)
    let hk = 0;
    perLane.forEach((n, l) => {
      const h0 = hk;
      hk += wanted[l];
      // (A route's car's s0 is where it is round its loop, not a main distance.)
      const loop = this.routes[l]?.C ?? L;
      const lane = this.lanes[l];
      const pool = lane.kinds ? lane.kinds.map((id) => TRAFFIC_KINDS.findIndex((x) => x.id === id)).filter((x) => x >= 0) : anyKind;
      const weight = (x: number) => (lane.kinds ? 1 : TRAFFIC_KINDS[x].weight);
      const totalWeight = pool.reduce((a, x) => a + weight(x), 0);
      // In strings (a caravan, TrafficLaneDef.string): each string's head spaced round the loop as
      // a car would be, the rest nose to tail behind it, `gap` m apart.
      const [per, gap] = lane.string ?? [1, 0];
      const heads = Math.max(1, Math.ceil(n / per));
      const spacing = loop / heads;
      // (Off the start grid: spaced as ever round a loop of its slots alone. A loop all clear is untouched.)
      const slots = slotsOf[l];
      for (let j = 0; j < n; j++, k++) {
        this.lane[k] = l;
        const head = Math.floor(j / per);
        const q = h0 + j;
        if (slots?.length) {
          const u = wrap(per > 1 ? head * spacing + (hash01(seed, q - (j % per), 1) - 0.5) * spacing * 0.5 : j * spacing + (hash01(seed, q, 1) - 0.5) * spacing * 0.5, loop);
          const f = (u / loop) * slots.length;
          const at = Math.min(slots.length - 1, Math.floor(f));
          this.s0[k] = wrap((slots[at] + (f - at)) * (loop / Math.ceil(loop)) - lane.dir * (j % per) * gap, loop);
        } else
          this.s0[k] = per > 1 ? wrap(head * spacing + (hash01(seed, q - (j % per), 1) - 0.5) * spacing * 0.5 - lane.dir * (j % per) * gap, loop) : wrap(j * spacing + (hash01(seed, q, 1) - 0.5) * spacing * 0.5, loop);
        let r = hash01(seed, q, 2) * totalWeight;
        let at = 0;
        while (at < pool.length - 1 && r > weight(pool[at])) r -= weight(pool[at++]);
        this.kind[k] = pool[at];
      }
    });
  }

  /**
   * Where round lane l's loop (s0, in steps of loop / ⌈loop⌉, from the first after one that isn't) a
   * string of `per` cars `gap` apart may start its head so that none of it comes near the start
   * grid's clear zone (GRID_CLEAR, and FADE more either side) in the clear time, where it could be
   * seen. Null: anywhere (no part of the loop is near it). Empty: nowhere.
   */
  private gridSlots(l: number, per: number, gap: number, loop: number): number[] | null {
    const lane = this.lanes[l];
    const r = this.routes[l];
    const L = this.track.main.length;
    const N = Math.ceil(loop);
    const step = loop / N;
    const getaway = this.track.layout.getaway?.start;
    if (r?.path && !getaway) return null;
    // A lane of animals (Sahara's caravan, at the road's edge, never a wreck) keeps off the grid
    // itself but not the road ahead of it: it'd be gone from the opening straight on the first lap.
    const animals = !!lane.kinds?.length && lane.kinds.every((id) => TRAFFIC_KINDS.find((x) => x.id === id)?.animal);
    const ahead = animals ? 0 : GRID_CLEAR.ahead + FADE;
    // Whether a car at loop position q is somewhere it'd be seen near the grid.
    const near = (q: number): boolean => {
      if (r?.path) {
        const i = Math.floor(this.pathD(r.path, (q / r.C) * r.path.T) / PATH_STEP) % r.path.n;
        return hypot(r.path.x[i] - getaway!.at[0], r.path.z[i] - getaway!.at[1]) < PATH_CLEAR + FADE;
      }
      let s = wrap(q, L);
      if (r) {
        if (q <= 0 || q >= r.R) return false;
        s = this.routePose(r, lane, q, this.sScratch, this.sHit).s;
      } else if (this.sectionFade(lane, s) <= 0) return false;
      return s > L - GRID_CLEAR.behind - FADE || s < ahead;
    };
    const bad = new Uint8Array(N);
    let any = false;
    for (let i = 0; i < N; i++) any = (bad[i] = near(i * step) ? 1 : 0) === 1 || any;
    if (!any) return null;
    // Its head at u: its cars from u to u − dir·(per−1)·gap, each moving `adv` (s0 per second) for
    // the clear time. Bad if any of that is.
    const adv = r?.path ? r.C / r.path.T : r ? lane.speed : lane.dir * lane.speed;
    const tail = -lane.dir * (per - 1) * gap;
    const sweep = adv * GRID_CLEAR.seconds;
    const lo = Math.floor((Math.min(0, tail) + Math.min(0, sweep)) / step);
    const hi = Math.ceil((Math.max(0, tail) + Math.max(0, sweep)) / step);
    if (hi - lo + 1 >= N) return [];
    const sum = new Int32Array(2 * N + 1);
    for (let i = 0; i < 2 * N; i++) sum[i + 1] = sum[i] + bad[i % N];
    const ok = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const a = (((i + lo) % N) + N) % N;
      ok[i] = sum[a + hi - lo + 1] - sum[a] === 0 ? 1 : 0;
    }
    let first = -1;
    for (let i = 0; i < N && first < 0; i++) if (ok[i] && !ok[(i + N - 1) % N]) first = i;
    if (first < 0) return [];
    const slots: number[] = [];
    for (let j = 0; j < N; j++) if (ok[(first + j) % N]) slots.push(first + j);
    return slots;
  }

  /** Lane `lane`'s visibility at main distance s by its sections: 1 inside one, fading over FADE either side, 0 away from them. */
  private sectionFade(lane: TrafficLaneDef, s: number): number {
    if (!lane.sections || laneActive(lane, s)) return 1;
    const L = this.track.main.length;
    // Road still to go to the next section's start, or already gone past the last one's end.
    let best = 0;
    for (let q = 0; q < lane.sections.length; q++) {
      const a = lane.sections[q][0];
      const b = lane.sections[q][1];
      const entry = lane.dir > 0 ? a : b;
      const exit = lane.dir > 0 ? b : a;
      best = Math.max(best, 1 - wrap((entry - s) * lane.dir, L) / FADE, 1 - wrap((s - exit) * lane.dir, L) / FADE);
    }
    return best;
  }

  /** Main-spline distance of traffic car k at race time t (pure). On a street, the street's main distance there (mainDistance). */
  sAt(k: number, t: number): number {
    const lane = this.lanes[this.lane[k]];
    const r = this.routes[this.lane[k]];
    // (The pose's own s, blend and all: an s that differed from the pool's flipped a near miss's
    // order every tick at a street's mouth, paying it out again and again.)
    if (r?.path) return r.path.s[this.pathIndex(k, t)];
    if (r) return this.routePose(r, lane, this.dAt(k, t), this.sScratch, this.sHit).s;
    return wrap(this.s0[k] + lane.dir * lane.speed * t, this.track.main.length);
  }

  private readonly sScratch: TrafficPose = newTrafficPose();
  private readonly sHit: TrackHit = newHit();

  /** A path lane's car's sample at race time t (the one before it). */
  private pathIndex(k: number, t: number): number {
    const r = this.routes[this.lane[k]]!;
    return Math.floor(this.dAt(k, t) / PATH_STEP) % r.path!.n;
  }

  /** How far round its route's loop car k is at race time t (a route's car only). Round a path, with its stops (and its speed there, `pathV`). */
  private dAt(k: number, t: number): number {
    const l = this.lane[k];
    const r = this.routes[l]!;
    if (r.path) return this.pathD(r.path, wrap((this.s0[k] / r.C) * r.path.T + t, r.path.T));
    return wrap(this.s0[k] + this.lanes[l].speed * t, r.C);
  }

  /**
   * How far car k has gone by race time t, not wrapped round its loop (m): for the renderer, so a
   * camel's legs keep up with it (slowing and standing at a path's stops too). Pure, like poseAt.
   */
  walked(k: number, t: number): number {
    const r = this.routes[this.lane[k]];
    if (!r?.path) return this.lanes[this.lane[k]].speed * t;
    const laps = Math.floor(((this.s0[k] / r.C) * r.path.T + t) / r.path.T);
    return laps * r.C + this.dAt(k, t);
  }

  /** Its speed at the last pathD (m/s). */
  private pathV = 0;

  /** How far round a path a car is `tau` s round its loop: cruising, slowing to each stop, standing, pulling away. */
  private pathD(p: TrafficPath, tau: number): number {
    const v = p.v;
    const ramp = (v * v) / (2 * STOP_DECEL);
    const tr = v / STOP_DECEL;
    // The last stop whose slowing it's reached (a few per loop: a scan).
    let k = -1;
    while (k + 1 < p.stops.length && p.tin[k + 1] <= tau) k++;
    this.pathV = v;
    if (k < 0) return v * tau;
    const u = tau - p.tin[k];
    const at = p.stops[k];
    if (u < tr) {
      this.pathV = v - STOP_DECEL * u;
      return at - ramp + v * u - (STOP_DECEL * u * u) / 2;
    }
    if (u < tr + STOP_WAIT) {
      this.pathV = 0;
      return at;
    }
    if (u < 2 * tr + STOP_WAIT) {
      const w = u - tr - STOP_WAIT;
      this.pathV = STOP_DECEL * w;
      return at + (STOP_DECEL * w * w) / 2;
    }
    return at + ramp + v * (u - 2 * tr - STOP_WAIT);
  }

  /** Where `d` round route `r` is: its road (0 the street in, 1 the main road, 2 the street out, 3 out of sight) and the distance along that road. */
  private routeAt(r: TrafficRoute, lane: TrafficLaneDef, d: number, out: { road: number; s: number }): void {
    const L = this.track.main.length;
    if (r.road) {
      // Along its street: from the span's start its way, from its end against it.
      // (Out of sight past its end: still posed on it, at its end.)
      out.road = 0;
      out.s = lane.dir > 0 ? r.from! + d : r.from! + r.R - d;
      return;
    }
    if (d < r.a) {
      out.road = 0;
      out.s = lane.dir > 0 ? r.a + d : r.a - d;
    } else if (d < r.a + r.b) {
      out.road = 1;
      out.s = wrap(r.on + (d - r.a) * lane.dir, L);
    } else if (d <= r.R) {
      out.road = 2;
      out.s = lane.dir > 0 ? d - r.a - r.b : r.outSp.length - (d - r.a - r.b);
    } else {
      out.road = 3;
      out.s = 0;
    }
  }

  private readonly at = { road: 0, s: 0 };

  /**
   * Which side of the main road lane l's traffic comes the other way at main distance s, for a racer
   * to keep off (sign of lateral; 0: none there): an oncoming lane's, where it has traffic; a path's
   * where it runs along the road against the lap.
   */
  oncoming(l: number, s: number): number {
    const path = this.routes[l]?.path;
    if (path) {
      for (const [a, b] of path.against) if (a <= b ? s >= a && s <= b : s >= a || s <= b) return path.side;
      return 0;
    }
    const lane = this.lanes[l];
    return lane.dir < 0 && laneActive(lane, s) ? Math.sign(lane.pos) : 0;
  }

  /** Whether car k comes and goes by side streets. */
  onRoute(k: number): boolean {
    return this.routes[this.lane[k]] !== null;
  }

  /**
   * How visible car k is at time t, 0–1 (pure): 1 inside its lane's sections, fading over FADE
   * meters either side; back over FADE_BACK seconds after a wreck. (Faded out of the start grid's
   * clear zone early on only in a lane whose start couldn't keep it out: `gridFade`.)
   */
  visibility(k: number, t: number): number {
    const w = this.wreckedAt[k];
    let v = 1;
    const lane = this.lanes[this.lane[k]];
    const r = this.routes[this.lane[k]];
    if (w >= 0 && t >= w) {
      if (t < w + TRAFFIC_RESPAWN) return 0;
      if (r?.path && r.path.backTau >= 0) {
        // Round a path with a corner out of sight: gone until it next passes that, then in there.
        const p = r.path;
        const t0 = w + TRAFFIC_RESPAWN;
        const back = t0 + wrap(p.backTau - wrap((this.s0[k] / r.C) * p.T + t0, p.T), p.T);
        if (t < back) return 0;
        v = Math.min(1, (t - back) / FADE_BACK);
      } else if (r && !r.path) {
        // By side streets: gone until it next comes round to the first street's middle (back on
        // the main road where it was hit would be the pop this is all to avoid), then in as ever.
        const lap = r.C / lane.speed;
        let back = w + (r.C - this.dAt(k, w)) / lane.speed;
        if (back < w + TRAFFIC_RESPAWN) back += Math.ceil((w + TRAFFIC_RESPAWN - back) / lap) * lap;
        if (t < back) return 0;
      } else v = Math.min(1, (t - w - TRAFFIC_RESPAWN) / FADE_BACK);
    }
    if (r?.path) {
      // Round its loop, always there; but kept off the getaway's start while the grid's clear (a
      // car rolling into the parked getaway car), fading back in as the rest do.
      const start = this.track.layout.getaway?.start;
      if (start && this.gridFade[this.lane[k]] && t < GRID_CLEAR.seconds + FADE_BACK) {
        const i = this.pathIndex(k, t);
        const away = hypot(r.path.x[i] - start.at[0], r.path.z[i] - start.at[1]);
        v = Math.min(v, Math.max(Math.min(1, Math.max(0, (away - PATH_CLEAR) / FADE)), (t - GRID_CLEAR.seconds) / FADE_BACK));
      }
      return Math.max(0, v);
    }
    const s = this.sAt(k, t);
    const L = this.track.main.length;
    if (r) {
      // In from the first street's middle, out at the next one's, and gone in between.
      const d = this.dAt(k, t);
      v = d >= r.R ? 0 : Math.min(v, d / STREET_FADE, (r.R - d) / STREET_FADE);
    } else v = Math.min(v, this.sectionFade(lane, s));
    if (this.gridFade[this.lane[k]] && t < GRID_CLEAR.seconds + FADE_BACK) {
      // The clear zone runs from `behind` before the line to `ahead` after it; fade by distance
      // to it, then all back in over FADE_BACK once the time's up.
      const outside = Math.min(wrap(s - GRID_CLEAR.ahead, L), wrap(L - GRID_CLEAR.behind - s, L));
      const inZone = s > L - GRID_CLEAR.behind || s < GRID_CLEAR.ahead;
      const zone = inZone ? 0 : Math.min(1, outside / FADE);
      v = Math.min(v, Math.max(zone, (t - GRID_CLEAR.seconds) / FADE_BACK));
    }
    return Math.max(0, v);
  }

  /** Whether car k is solid at time t (fully visible): only these collide, count and get posed. */
  present(k: number, t: number): boolean {
    return this.visibility(k, t) >= 1;
  }

  /**
   * Pose of traffic car k at time t (pure; its own scratch, so the renderer can pose between ticks
   * without touching sim state).
   */
  poseAt(k: number, t: number, out: TrafficPose, hit = this.renderHit): TrafficPose {
    const lane = this.lanes[this.lane[k]];
    const r = this.routes[this.lane[k]];
    if (r?.path) {
      const d = this.dAt(k, t);
      return this.pathPose(r.path, this.pathV, d, out);
    }
    if (r) return this.routePose(r, lane, this.dAt(k, t), out, hit);
    const s = this.sAt(k, t);
    const at = sampleAt(this.track.main, s, hit);
    const lat = (lane.pos * at.width) / 2;
    out.s = s;
    out.lat = lat;
    out.x = at.cx - at.tz * lat;
    out.z = at.cz + at.tx * lat;
    out.y = at.cy - lat * tan(at.bank);
    const h = atan2(at.tx, at.tz);
    out.h = lane.dir > 0 ? h : h + Math.PI;
    out.vx = at.tx * lane.dir * lane.speed;
    out.vz = at.tz * lane.dir * lane.speed;
    return out;
  }

  /** The pose of a car `d` m round a path lane's loop: between its samples, on the ground. */
  private pathPose(p: TrafficPath, speed: number, d: number, out: TrafficPose): TrafficPose {
    const f = d / PATH_STEP;
    const i = Math.floor(f) % p.n;
    const j = (i + 1) % p.n;
    const u = f - Math.floor(f);
    out.x = p.x[i] + (p.x[j] - p.x[i]) * u;
    out.z = p.z[i] + (p.z[j] - p.z[i]) * u;
    out.y = this.track.ground!.height(out.x, out.z);
    const tx = p.tx[i] + (p.tx[j] - p.tx[i]) * u;
    const tz = p.tz[i] + (p.tz[j] - p.tz[i]) * u;
    const n = hypot(tx, tz) || 1;
    out.h = atan2(tx / n, tz / n);
    out.vx = (tx / n) * speed;
    out.vz = (tz / n) * speed;
    out.s = p.s[i];
    out.lat = p.lat[i];
    return out;
  }

  /** The pose of a car `d` round route `r`: on its road, blended over JOIN from a street onto the main road and back off it. */
  private routePose(r: TrafficRoute, lane: TrafficLaneDef, d: number, out: TrafficPose, hit: TrackHit): TrafficPose {
    const L = this.track.main.length;
    const at = this.at;
    this.routeAt(r, lane, Math.min(d, r.R), at);
    // The road it's on, and (near a join) the other: the main road ahead of where it comes on, or
    // past where it goes off.
    const road = at.road === 0 ? r.inSp : at.road === 2 ? r.outSp : this.track.main;
    const on = this.lanePose(road, at.s, lane, hit);
    let w = 0;
    let joinS = 0;
    if (r.road) {
      // (Never onto the main road.)
    } else if (at.road === 0 && d > r.a - JOIN) {
      w = smoothstep(r.a - JOIN, r.a, d);
      joinS = wrap(r.on - (r.a - d) * lane.dir, L);
      this.lanePose(this.track.main, joinS, lane, this.joinHit);
    } else if (at.road === 2 && d < r.a + r.b + JOIN) {
      w = 1 - smoothstep(r.a + r.b, r.a + r.b + JOIN, d);
      joinS = wrap(r.off + (d - r.a - r.b) * lane.dir, L);
      this.lanePose(this.track.main, joinS, lane, this.joinHit);
    }
    const j = this.joinHit;
    out.x = on.cx + (j.cx - on.cx) * w;
    out.y = on.cy + (j.cy - on.cy) * w;
    out.z = on.cz + (j.cz - on.cz) * w;
    // Its way: along each road the lane's way, blended.
    let tx = (on.tx + (j.tx - on.tx) * w) * lane.dir;
    let tz = (on.tz + (j.tz - on.tz) * w) * lane.dir;
    const n = hypot(tx, tz) || 1;
    tx /= n;
    tz /= n;
    out.h = atan2(tx, tz);
    out.vx = tx * lane.speed;
    out.vz = tz * lane.speed;
    // Where it is on the main road: there (on it), or the main distance of where it is on the street.
    out.s = at.road === 1 ? at.s : w >= 0.5 ? joinS : mainDistance(this.track, road.index, at.s);
    const m = sampleAt(this.track.main, out.s, this.mainHit);
    out.lat = (out.x - m.cx) * -m.tz + (out.z - m.cz) * m.tx;
    return out;
  }

  /** `hit` set to road `sp` at `s`, its middle moved across to the lane (cx, cy, cz), tangent along the road. */
  private lanePose(sp: BakedSpline, s: number, lane: TrafficLaneDef, hit: TrackHit): TrackHit {
    sampleAt(sp, s, hit);
    // The lane's side in the road's own frame (as on the main road: an oncoming lane's on its left).
    const lat = (lane.pos * hit.width) / 2;
    hit.cx -= hit.tz * lat;
    hit.cz += hit.tx * lat;
    hit.cy -= lat * tan(hit.bank);
    return hit;
  }

  /** Pose of traffic car k at time t into slot `p` of the posed pool. */
  private pose(k: number, t: number, p: number): void {
    const o = this.poseAt(k, t, this.scratch, this.hit);
    this.idx[p] = k;
    this.s[p] = o.s;
    this.lat[p] = o.lat;
    this.x[p] = o.x;
    this.z[p] = o.z;
    this.y[p] = o.y;
    this.h[p] = o.h;
    this.vx[p] = o.vx;
    this.vz[p] = o.vz;
    const lane = this.lanes[this.lane[k]];
    const r = this.routes[this.lane[k]];
    this.seenS[p] = o.s;
    this.seenLat[p] = o.lat;
    if (!r) this.along[p] = lane.dir * lane.speed;
    else {
      const m = this.mainHit;
      const d = this.dAt(k, t);
      if (!r.road && !r.path && d < r.a) {
        // On its way in: on the main road already, as far before where it joins as it is up the street.
        this.seenS[p] = wrap(r.on - (r.a - d) * lane.dir, this.track.main.length);
        sampleAt(this.track.main, this.seenS[p], m);
        this.seenLat[p] = (lane.pos * m.width) / 2;
        this.along[p] = lane.dir * lane.speed;
      } else {
        sampleAt(this.track.main, o.s, m);
        this.along[p] = o.vx * m.tx + o.vz * m.tz;
      }
    }
  }

  /**
   * Poses the solid cars near any racer: within LOD along the road, or LOD_STRAIGHT in a straight
   * line (a lap that folds back or crosses itself). `nearS`, `nearX`, `nearZ` hold the racers' main
   * distances and positions (only the first `n` are read).
   */
  update(t: number, nearS: Float64Array, nearX: Float64Array, nearZ: Float64Array, n: number): void {
    const L = this.track.main.length;
    let p = 0;
    for (let k = 0; k < this.count && p < POOL; k++) {
      if (!this.present(k, t)) continue;
      const s = this.sAt(k, t);
      let close = false;
      for (let j = 0; j < n && !close; j++) close = Math.abs(signedGap(s, nearS[j], L)) < LOD;
      if (!close) {
        const o = this.poseAt(k, t, this.scratch, this.hit);
        for (let j = 0; j < n && !close; j++) close = sq(o.x - nearX[j]) + sq(o.z - nearZ[j]) < LOD_STRAIGHT * LOD_STRAIGHT;
      }
      if (close) this.pose(k, t, p++);
    }
    this.posed = p;
  }

  /**
   * Calls `fn` for every car with any visibility within `range` (straight line) of (x, z) at time
   * t, with its visibility and pose (reused: copy what you keep). What the renderer draws: it
   * doesn't depend on the sim's pool, which only holds solid cars near a racer.
   */
  visibleNear(t: number, x: number, z: number, range: number, fn: (k: number, visibility: number, pose: TrafficPose) => void): void {
    const o = this.scratch;
    for (let k = 0; k < this.count; k++) {
      const v = this.visibility(k, t);
      if (v <= 0) continue;
      this.poseAt(k, t, o, this.renderHit);
      if (sq(o.x - x) + sq(o.z - z) <= range * range) fn(k, v, o);
    }
  }

  /** Every traffic car's pose at time t, regardless of LOD (the editor's scrubber, tests). */
  poseAll(t: number): { x: number; z: number; h: number; kind: number }[] {
    const out: { x: number; z: number; h: number; kind: number }[] = [];
    for (let k = 0; k < this.count; k++) {
      if (!this.present(k, t)) continue;
      // Its own scratch: slot 0 of the pool is live (the AI and collisions read it).
      const o = this.poseAt(k, t, this.scratch, this.renderHit);
      out.push({ x: o.x, z: o.z, h: o.h, kind: this.kind[k] });
    }
    return out;
  }
}
