// What a racer's chase camera can see (SPEC "Traffic that doesn't pop"): a point is in sight when
// it's in front, within SEEN m, and not behind the open ground, a crest of the main road or a tall
// prop. Only the sim's world is known here: buildings and hills the skin draws (Downtown's blocks,
// Backroads' hills) aren't, so off open ground a view is clearer here than in the game.
//
// Its use: where a lane's section ends, its cars fade in or out over FADE m of road; a fade seen is
// a car materializing in plain view. `fadeExposure` is how much road a racer can see an end's fade
// from, and `hideSections` moves each end to where that's least.

import type { SurfaceDef, TrackLayout } from '../content';
import { atan2, cos, hypot, sin } from '../math';
import { FADE } from '../world/traffic';
import { bakeTrack, signedGap, wrap, type Track } from './bake';
import { newHit, sampleAt, type TrackHit } from './query';

/** How far (m) a fading car reads as one from the chase camera (a car is a few pixels tall past it). */
export const SEEN = 250;
/** Half the camera's view across (rad): 62° tall at 16:9 is about 94° across. */
export const HALF_FOV = (47 * Math.PI) / 180;
/** The chase camera: this far behind its car and above the road (m). */
export const CAM_BACK = 6;
export const CAM_UP = 2.5;
/** A car's middle, above the road (m). */
export const CAR_UP = 1;
/** Line of sight is checked every this many meters. */
const SIGHT_STEP = 4;

/** The props tall enough to hide a car behind (a building, a trestle's leg). */
export function tallProps(track: Track): Track['props'] {
  return track.props.filter((p) => p.hy >= 2);
}

/**
 * Whether a straight line from a (main distance `as`) to b (`bs`) is clear: of the open ground,
 * of the main road's own surface between them (a crest, where there's no open ground), and of
 * `tall` props (a prop's y is its base, hy half its height).
 */
export function lineClear(track: Track, ax: number, ay: number, az: number, as: number, bx: number, by: number, bz: number, bs: number, tall: Track['props'], hit: TrackHit = newHit()): boolean {
  const d = hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / SIGHT_STEP));
  const L = track.main.length;
  const gap = signedGap(bs, as, L);
  const alongRoad = Math.abs(gap) < d * 1.5 + 20;
  for (let i = 1; i < n; i++) {
    const f = i / n;
    const x = ax + (bx - ax) * f;
    const y = ay + (by - ay) * f;
    const z = az + (bz - az) * f;
    if (track.ground) {
      if (track.ground.height(x, z) > y + 0.3) return false;
    } else if (alongRoad && sampleAt(track.main, wrap(as + gap * f, L), hit).cy > y + 0.3) return false;
  }
  const dx = bx - ax;
  const dz = bz - az;
  for (const p of tall) {
    // Its footprint in its own frame (across: (cos h, −sin h); along: (sin h, cos h)), crossed below its top.
    const c = cos(p.heading);
    const s = sin(p.heading);
    const ox = ax - p.x;
    const oz = az - p.z;
    const lo0 = ox * c - oz * s;
    const lo1 = ox * s + oz * c;
    const ld0 = dx * c - dz * s;
    const ld1 = dx * s + dz * c;
    let t0 = 0;
    let t1 = 1;
    let inside = true;
    for (const [lo, ld, half] of [
      [lo0, ld0, p.hx],
      [lo1, ld1, p.hz],
    ]) {
      if (Math.abs(ld) < 1e-9) {
        if (Math.abs(lo) > half) inside = false;
      } else {
        const e0 = (-half - lo) / ld;
        const e1 = (half - lo) / ld;
        t0 = Math.max(t0, Math.min(e0, e1));
        t1 = Math.min(t1, Math.max(e0, e1));
        if (t0 > t1) inside = false;
      }
      if (!inside) break;
    }
    const top = p.y + 2 * p.hy;
    if (inside && ay + (by - ay) * t0 < top && ay + (by - ay) * t1 < top) return false;
  }
  return true;
}

/**
 * Whether a chase camera behind a car at (x, y, z) heading `h` (main distance s) sees the point
 * (px, py, pz) (main distance ps): in front, within SEEN, in clear sight.
 */
export function inSight(track: Track, x: number, y: number, z: number, h: number, s: number, px: number, py: number, pz: number, ps: number, tall: Track['props'], hit?: TrackHit): boolean {
  const fx = sin(h);
  const fz = cos(h);
  const ex = x - fx * CAM_BACK;
  const ez = z - fz * CAM_BACK;
  const dx = px - ex;
  const dz = pz - ez;
  const d = hypot(dx, dz);
  if (d > SEEN || d < 1) return false;
  if (Math.abs(atan2(dx * fz - dz * fx, dx * fx + dz * fz)) > HALF_FOV) return false;
  return lineClear(track, ex, y + CAM_UP, ez, s, px, py + CAR_UP, pz, ps, tall, hit);
}

/** Where racers are looked from, along the road before a fade: every this many meters. */
const VIEW_STEP = 5;

/**
 * Meters of road (the main road's middle, driven its way) from which a racer sees any of the fade
 * at a section end `e`: its cars fade over the FADE m outside the section, before `e` if it's the
 * section's start (`start`), after it if it's the end, at each of `lats` across the road.
 */
export function fadeExposure(track: Track, e: number, start: boolean, lats: readonly number[], tall = tallProps(track)): number {
  const L = track.main.length;
  const hit = newHit();
  const at = newHit();
  const zone: [number, number, number, number][] = [];
  const z0 = start ? e - FADE : e;
  for (let d = 0; d <= FADE; d += FADE / 6) {
    const s = wrap(z0 + d, L);
    sampleAt(track.main, s, at);
    for (const lat of lats) zone.push([at.cx - at.tz * lat * (at.width / 2), at.cy, at.cz + at.tx * lat * (at.width / 2), s]);
  }
  let seen = 0;
  // From SEEN + CAM_BACK before the fade's far end up to its far end (past it, it's behind).
  const far = z0 + FADE;
  for (let back = 0; back <= SEEN + CAM_BACK + FADE; back += VIEW_STEP) {
    const s = wrap(far - back, L);
    sampleAt(track.main, s, at);
    const h = atan2(at.tx, at.tz);
    let any = false;
    for (const [px, py, pz, ps] of zone) if ((any = inSight(track, at.cx, at.cy, at.cz, h, s, px, py, pz, ps, tall, hit))) break;
    if (any) seen += VIEW_STEP;
  }
  return seen;
}

/** The turn (rad) along the main road from s over `len` m (negative: back). */
function turnOver(track: Track, s: number, len: number): number {
  const main = track.main;
  const L = main.length;
  const i = Math.round(wrap(s, L) / main.step) % main.n;
  const j = Math.round(wrap(s + len, L) / main.step) % main.n;
  return Math.abs(wrap(atan2(main.tx[j], main.tz[j]) - atan2(main.tx[i], main.tz[i]) + Math.PI, Math.PI * 2) - Math.PI);
}

/** An end's inward END_RUN m (where its cars are solid) turn less than this: a car goes solid on a straight, not in a corner. */
export const END_TURN = (8 * Math.PI) / 180;
export const END_RUN = 40;
/** How far an end may move into its section, and out of it (m); none within PROP_CLEAR m (along the road) of a solid prop on it. */
export const HIDE_IN = 150;
export const HIDE_OUT = 40;
const PROP_CLEAR = 30;
/** An end moves only for at least this much less exposure (a fraction of it, and m). */
const GAIN = 0.3;
const GAIN_M = 50;

/**
 * Moves each traffic section's ends to where their fades are least seen (fadeExposure, at each of
 * its lanes' sides): in by up to a third of the section and HIDE_IN m, or out by up to HIDE_OUT m
 * (round the corner straightenSections took it off), every 5 m. Its cars still go solid on a
 * straight: the END_RUN m inward of the end turn less than END_TURN (in a corner the field met
 * them in the apex), and it stays PROP_CLEAR m from a solid prop (Backroads' traffic appearing
 * among the Trestle's legs was half its wrecks). It moves only when that's seen GAIN (and GAIN_M m)
 * less. Returns the layout, changed.
 */
export function hideSections(layout: TrackLayout, surfaces: SurfaceDef[]): TrackLayout {
  const track = bakeTrack(layout, surfaces);
  const L = track.main.length;
  const tall = tallProps(track);
  const solid = track.props.filter((p) => p.solid && p.spline === 0).map((p) => p.s);
  // A section shared by lanes (by its numbers): moved once, for all of them.
  const lats = new Map<string, number[]>();
  for (const lane of layout.traffic?.lanes ?? []) for (const sec of lane.sections ?? []) lats.set(sec.join(','), [...(lats.get(sec.join(',')) ?? []), lane.pos]);
  const moved = new Map<string, [number, number]>();
  for (const [id, pos] of lats) {
    const [a, b] = id.split(',').map(Number);
    const len = wrap(b - a, L);
    const inward = Math.min(HIDE_IN, len / 3);
    const best = (e: number, start: boolean, dirIn: number): number => {
      const here = fadeExposure(track, e, start, pos, tall);
      let at = e;
      let least = here;
      for (let d = -HIDE_OUT; d <= inward; d += 5) {
        if (d === 0) continue;
        const s = wrap(e + dirIn * d, L);
        if (turnOver(track, s, dirIn * END_RUN) > END_TURN) continue;
        if (solid.some((p) => Math.abs(signedGap(p, s, L)) < PROP_CLEAR)) continue;
        const x = fadeExposure(track, s, start, pos, tall);
        if (x < least) (least = x), (at = s);
      }
      return here - least >= Math.max(GAIN_M, GAIN * here) ? Math.round(at) : e;
    };
    moved.set(id, [best(a, true, 1), best(b, false, -1)]);
  }
  for (const lane of layout.traffic?.lanes ?? []) if (lane.sections) lane.sections = lane.sections.map((sec) => moved.get(sec.join(',')) ?? sec);
  return layout;
}
