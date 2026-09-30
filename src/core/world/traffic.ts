// Traffic (SPEC §4, category D): every traffic car's position is a closed-form function of the
// room seed and race time. Cars drive their lane of the main spline at the lane's speed, so none
// ever overtakes another and nothing is sent over the network. Each tick only the cars near some
// racer are posed into a small pool (LOD); the rest are a formula nobody evaluates.
//
// A wrecked traffic car (rammed, checked, caught in a hazard) is hidden from its wreck time until
// it's due back; the renderer tumbles a cosmetic copy (category L).
//
// Nothing pops: a car's visibility (0–1) is a formula too. It fades in over FADE meters of road
// before its lane's section starts and out over FADE after it ends, out of and back into the start
// grid's clear zone, and back in over a second after a wreck. Only a fully visible car is posed for
// the sim (collisions, near misses, the AI); the renderer draws the fading ones dithered.

import type { TrafficLaneDef } from '../content';
import { hash01 } from '../rng';
import type { Track } from '../track/bake';
import { sampleAt, type TrackHit } from '../track/query';
import { newHit } from '../track/query';
import { signedGap, wrap } from '../track/bake';

export interface TrafficKind {
  id: string;
  hw: number;
  hl: number;
  hh: number;
  /** Too big to check out of the way, even boosting. */
  big: boolean;
  weight: number;
}

export const TRAFFIC_KINDS: TrafficKind[] = [
  { id: 'sedan', hw: 0.95, hl: 2.25, hh: 0.75, big: false, weight: 5 },
  { id: 'compact', hw: 0.9, hl: 1.95, hh: 0.75, big: false, weight: 3 },
  { id: 'van', hw: 1.0, hl: 2.5, hh: 1.1, big: false, weight: 2 },
  { id: 'truck', hw: 1.2, hl: 3.8, hh: 1.5, big: true, weight: 1 },
  { id: 'bus', hw: 1.25, hl: 5.2, hh: 1.5, big: true, weight: 0.6 },
];
export const TRUCK = 3;

/** How close (along the road, or in a straight line) a traffic car must be to a racer to be posed this tick. */
const LOD = 350;
export const LOD_STRAIGHT = 250;
/** Meters of road a car fades over entering or leaving traffic; seconds a returning wreck takes. */
export const FADE = 45;
export const FADE_BACK = 1;
/** Seconds a wrecked traffic car stays gone. */
export const TRAFFIC_RESPAWN = 12;
/** No traffic within this much of the start line for the first seconds of a race. */
export const GRID_CLEAR = { behind: 160, ahead: 60, seconds: 10 };
const POOL = 128;

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
  readonly lanes: TrafficLaneDef[];
  readonly count: number;
  /** Per traffic car (static for the race): lane, start distance, kind. */
  readonly lane: Uint8Array;
  readonly s0: Float64Array;
  readonly kind: Uint8Array;
  /** Race time the car was wrecked (-1: never). Part of the sim snapshot. */
  readonly wreckedAt: Float64Array;

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
  private readonly hit: TrackHit = newHit();
  private readonly renderHit: TrackHit = newHit();
  private readonly scratch: TrafficPose = newTrafficPose();

  constructor(
    private readonly track: Track,
    seed: number,
    density = 1,
  ) {
    const def = track.layout.traffic;
    this.lanes = def?.lanes ?? [];
    const L = track.main.length;
    // Cars loop the whole lap but only appear in their lane's sections, so size the fleet so the
    // sections get `density` cars per km.
    const perLane = this.lanes.map(() => Math.max(0, Math.round((L / 1000) * (def?.density ?? 0) * density)));
    this.count = perLane.reduce((a, b) => a + b, 0);
    this.lane = new Uint8Array(this.count);
    this.s0 = new Float64Array(this.count);
    this.kind = new Uint8Array(this.count);
    this.wreckedAt = new Float64Array(this.count).fill(-1);
    const totalWeight = TRAFFIC_KINDS.reduce((a, k) => a + k.weight, 0);
    let k = 0;
    perLane.forEach((n, l) => {
      const spacing = L / Math.max(1, n);
      for (let j = 0; j < n; j++, k++) {
        this.lane[k] = l;
        this.s0[k] = wrap(j * spacing + (hash01(seed, k, 1) - 0.5) * spacing * 0.5, L);
        let r = hash01(seed, k, 2) * totalWeight;
        let kind = 0;
        while (kind < TRAFFIC_KINDS.length - 1 && r > TRAFFIC_KINDS[kind].weight) r -= TRAFFIC_KINDS[kind++].weight;
        this.kind[k] = kind;
      }
    });
  }

  /** Main-spline distance of traffic car k at race time t (pure). */
  sAt(k: number, t: number): number {
    const lane = this.lanes[this.lane[k]];
    return wrap(this.s0[k] + lane.dir * lane.speed * t, this.track.main.length);
  }

  /**
   * How visible car k is at time t, 0–1 (pure): 1 inside its lane's sections, fading over FADE
   * meters either side; faded out of the start grid's clear zone early on; back over FADE_BACK
   * seconds after a wreck.
   */
  visibility(k: number, t: number): number {
    const w = this.wreckedAt[k];
    let v = 1;
    if (w >= 0 && t >= w) {
      if (t < w + TRAFFIC_RESPAWN) return 0;
      v = Math.min(1, (t - w - TRAFFIC_RESPAWN) / FADE_BACK);
    }
    const lane = this.lanes[this.lane[k]];
    const s = this.sAt(k, t);
    const L = this.track.main.length;
    if (lane.sections && !laneActive(lane, s)) {
      // Road still to go to the next section's start, or already gone past the last one's end.
      let best = 0;
      for (const [a, b] of lane.sections) {
        const entry = lane.dir > 0 ? a : b;
        const exit = lane.dir > 0 ? b : a;
        best = Math.max(best, 1 - wrap((entry - s) * lane.dir, L) / FADE, 1 - wrap((s - exit) * lane.dir, L) / FADE);
      }
      v = Math.min(v, best);
    }
    if (t < GRID_CLEAR.seconds + FADE_BACK) {
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
    const s = this.sAt(k, t);
    const at = sampleAt(this.track.main, s, hit);
    const lat = (lane.pos * at.width) / 2;
    out.s = s;
    out.lat = lat;
    out.x = at.cx - at.tz * lat;
    out.z = at.cz + at.tx * lat;
    out.y = at.cy - lat * Math.tan(at.bank);
    const h = Math.atan2(at.tx, at.tz);
    out.h = lane.dir > 0 ? h : h + Math.PI;
    out.vx = at.tx * lane.dir * lane.speed;
    out.vz = at.tz * lane.dir * lane.speed;
    return out;
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
        for (let j = 0; j < n && !close; j++) close = (o.x - nearX[j]) ** 2 + (o.z - nearZ[j]) ** 2 < LOD_STRAIGHT * LOD_STRAIGHT;
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
      if ((o.x - x) ** 2 + (o.z - z) ** 2 <= range * range) fn(k, v, o);
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
