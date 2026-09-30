// Traffic (SPEC §4, category D): every traffic car's position is a closed-form function of the
// room seed and race time. Cars drive their lane of the main spline at the lane's speed, so none
// ever overtakes another and nothing is sent over the network. Each tick only the cars near some
// racer are posed into a small pool (LOD); the rest are a formula nobody evaluates.
//
// A wrecked traffic car (rammed, checked, caught in a hazard) is hidden from its wreck time until
// it's due back; the renderer tumbles a cosmetic copy (category L).

import type { TrafficLaneDef } from '../content';
import { hash01 } from '../rng';
import type { Track } from '../track/bake';
import { sampleAt, type TrackHit } from '../track/query';
import { newHit } from '../track/query';
import { wrap } from '../track/bake';

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

/** How close (along the road) a traffic car must be to a racer to be posed this tick. */
const LOD = 350;
/** Seconds a wrecked traffic car stays gone. */
export const TRAFFIC_RESPAWN = 12;
/** No traffic within this much of the start line for the first seconds of a race. */
const GRID_CLEAR = { behind: 160, ahead: 60, seconds: 10 };
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

  /** Whether car k is on the road at time t: not wrecked, and not on the start grid early on. */
  present(k: number, t: number): boolean {
    const w = this.wreckedAt[k];
    if (w >= 0 && t >= w && t < w + TRAFFIC_RESPAWN) return false;
    if (!laneActive(this.lanes[this.lane[k]], this.sAt(k, t))) return false;
    if (t < GRID_CLEAR.seconds) {
      const s = this.sAt(k, t);
      const L = this.track.main.length;
      if (s > L - GRID_CLEAR.behind || s < GRID_CLEAR.ahead) return false;
    }
    return true;
  }

  /** Pose of traffic car k at time t into slot `p` of the posed pool. */
  private pose(k: number, t: number, p: number): void {
    const lane = this.lanes[this.lane[k]];
    const s = this.sAt(k, t);
    const at = sampleAt(this.track.main, s, this.hit);
    const lat = (lane.pos * at.width) / 2;
    this.idx[p] = k;
    this.s[p] = s;
    this.lat[p] = lat;
    this.x[p] = at.cx - at.tz * lat;
    this.z[p] = at.cz + at.tx * lat;
    this.y[p] = at.cy - lat * Math.tan(at.bank);
    const h = Math.atan2(at.tx, at.tz);
    this.h[p] = lane.dir > 0 ? h : h + Math.PI;
    this.vx[p] = at.tx * lane.dir * lane.speed;
    this.vz[p] = at.tz * lane.dir * lane.speed;
  }

  /**
   * Poses the cars within LOD of any of the given main-spline distances. `near` holds racers'
   * distances (only the first `n` are read).
   */
  update(t: number, near: Float64Array, n: number): void {
    const L = this.track.main.length;
    let p = 0;
    for (let k = 0; k < this.count && p < POOL; k++) {
      if (!this.present(k, t)) continue;
      const s = this.sAt(k, t);
      let close = false;
      for (let j = 0; j < n; j++) {
        const d = Math.abs(wrap(s - near[j] + L / 2, L) - L / 2);
        if (d < LOD) {
          close = true;
          break;
        }
      }
      if (close) this.pose(k, t, p++);
    }
    this.posed = p;
  }

  /** Every traffic car's pose at time t, regardless of LOD (the editor's scrubber, tests). */
  poseAll(t: number): { x: number; z: number; h: number; kind: number }[] {
    const out: { x: number; z: number; h: number; kind: number }[] = [];
    for (let k = 0; k < this.count; k++) {
      if (!this.present(k, t)) continue;
      this.pose(k, t, 0);
      out.push({ x: this.x[0], z: this.z[0], h: this.h[0], kind: this.kind[k] });
    }
    return out;
  }
}
