// The racing AI (SPEC §10: its only memory is what it can rebuild from the car's pose and the
// track in one tick, so a host change loses nothing). Per spline, once: a racing line (out, in at
// the apex, out) and a speed profile from the car's own steering model, with braking points found
// by a backward pass. Per tick: pure pursuit on the line, throttle and brake to the profile, a
// lateral offset to get round traffic, hazards and slower cars, boost on straights, a seeded
// choice of shortcuts, and mild catch-up toward the human leader.

import { TUNING as T } from '../car/tuning';
import type { Controls } from '../controls';
import { clamp, wrapAngle } from '../math';
import { hash01 } from '../rng';
import type { SimState } from '../state';
import { mainDistance, wrap, type BakedSpline, type Track } from '../track/bake';
import { newHit, sampleAt, type TrackHit } from '../track/query';
import { TRAFFIC_KINDS } from '../world/traffic';

export type Difficulty = 0 | 1 | 2;
export const DIFFICULTY_NAMES = ['easy', 'normal', 'hard'] as const;

export interface RacerDriver {
  difficulty: Difficulty;
}

const SKILL = [
  { pace: 0.84, brake: 18, shortcut: 0.15, look: 0.5, boost: false, catchup: 1, ownSide: 12 },
  { pace: 0.93, brake: 22, shortcut: 0.5, look: 0.45, boost: true, catchup: 0.8, ownSide: 6 },
  { pace: 1.0, brake: 26, shortcut: 0.85, look: 0.42, boost: true, catchup: 0.35, ownSide: 1 },
];

interface Line {
  /** Lateral offset of the racing line per sample. */
  offset: Float64Array;
  /** Target speed per sample (m/s) for the reference car at full pace. */
  speed: Float64Array;
}

const lines = new WeakMap<Track, Map<number, Line>>();

/** Fastest speed at which a car with steering `turn` can hold a corner of radius R (the yaw model in physics.ts). */
function cornerSpeed(radius: number, turn: number): number {
  let lo = 5;
  let hi = 120;
  for (let k = 0; k < 24; k++) {
    const v = (lo + hi) / 2;
    const f = v / T.steerFalloff;
    const yaw = turn / (1 + f * f * 0.9);
    if (yaw * radius >= v) lo = v;
    else hi = v;
  }
  return lo;
}

export function racingLine(track: Track, sp: BakedSpline): Line {
  let perTrack = lines.get(track);
  if (!perTrack) lines.set(track, (perTrack = new Map()));
  const cached = perTrack.get(sp.index);
  if (cached) return cached;
  const n = sp.n;
  const at = (i: number) => (sp.closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i)));
  // Signed curvature (positive turns left: heading grows), over ±6 m.
  const curv = new Float64Array(n);
  const w = Math.max(1, Math.round(6 / sp.step));
  for (let i = 0; i < n; i++) {
    const a = Math.atan2(sp.tx[at(i - w)], sp.tz[at(i - w)]);
    const b = Math.atan2(sp.tx[at(i + w)], sp.tz[at(i + w)]);
    curv[i] = wrapAngle(b - a) / (2 * w * sp.step);
  }
  const smooth = (src: Float64Array, meters: number, passes: number) => {
    let a = src;
    const r = Math.max(1, Math.round(meters / sp.step));
    for (let p = 0; p < passes; p++) {
      const b = new Float64Array(n);
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += a[at(i)];
      for (let i = 0; i < n; i++) {
        b[i] = acc / (2 * r + 1);
        acc += a[at(i + r + 1)] - a[at(i - r)];
      }
      a = b;
    }
    return a;
  };
  const k = smooth(curv, 8, 2);
  // Toward the inside of each corner (left turn → negative lateral), then smoothed wide so the
  // car swings out before and after: out, in, out.
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) raw[i] = -clamp(k[i] * 55, -1, 1) * Math.max(0, sp.width[i] / 2 - 2.2);
  const offset = smooth(raw, 30, 2);
  for (let i = 0; i < n; i++) offset[i] = clamp(offset[i], -(sp.width[i] / 2 - 1.6), sp.width[i] / 2 - 1.6);
  // Speed: what the corner allows (the line is wider than the centerline: ~1.25× the radius).
  const speed = new Float64Array(n);
  // The line is wider than the centerline on a wide road; on a narrow one there's no room to widen it.
  for (let i = 0; i < n; i++) speed[i] = cornerSpeed((1 + clamp((sp.width[i] - 8) / 30, 0, 0.3)) / Math.max(1e-4, Math.abs(k[i])), 2.4);
  // Crests: don't fly off a drop into a corner. (Air is fine; the braking pass handles the rest.)
  // Braking: work backwards so every corner is reachable from the one before.
  const brake = 22;
  for (let pass = 0; pass < (sp.closed ? 2 : 1); pass++) {
    for (let i = n - 2; i >= 0; i--) speed[i] = Math.min(speed[i], Math.sqrt(speed[i + 1] ** 2 + 2 * brake * sp.step));
    if (sp.closed) speed[n - 1] = Math.min(speed[n - 1], Math.sqrt(speed[0] ** 2 + 2 * brake * sp.step));
  }
  const line = { offset, speed };
  perTrack.set(sp.index, line);
  return line;
}

const look: TrackHit = newHit();
const probe: TrackHit = newHit();

export function driveRacer(sim: SimState, i: number, d: RacerDriver, out: Controls): Controls {
  const c = sim.cars;
  const track = sim.track;
  const skill = SKILL[d.difficulty];
  const cls = sim.classes[c.cls[i]];
  const speed = Math.hypot(c.vx[i], c.vz[i]);
  const L = track.main.length;

  // Which spline to follow: the one we're on, or a shortcut we've chosen to take.
  let sp = track.splines[c.spline[i]];
  let s = c.s[i];
  if (sp.index === 0) {
    for (let b = 1; b < track.splines.length; b++) {
      const br = track.splines[b];
      // Approaching the branch, or just past its start but not yet more on it than on the main road.
      const past = wrap(s - br.mainFrom, L);
      const toFrom = past < 60 ? -past : wrap(br.mainFrom - s, L);
      if (toFrom < 70 && hash01(sim.seed, i * 131 + b, c.lap[i]) < skill.shortcut) {
        sp = br;
        s = -toFrom;
        break;
      }
    }
  }
  const line = racingLine(track, sp);
  const lineAt = (dist: number, arr: Float64Array) => {
    const idx = sp.closed ? Math.round(wrap(dist, sp.length) / sp.step) % sp.n : Math.max(0, Math.min(sp.n - 1, Math.round(dist / sp.step)));
    return arr[idx];
  };

  // Lateral target: the line, nudged round anything in the way.
  const ahead = 8 + speed * skill.look;
  let target = lineAt(s + ahead, line.offset);
  // On a two-way road, easier drivers keep their line on their own side.
  const world = sim.world;
  if (world && sp.index === 0 && skill.ownSide > 2) {
    for (const lane of world.traffic.lanes) {
      if (lane.dir < 0) target = lane.pos < 0 ? Math.max(target, skill.ownSide > 8 ? 1 : -0.5) : Math.min(target, skill.ownSide > 8 ? -1 : 0.5);
    }
  }
  const lineTarget = target;
  // Holding a line round something: keep it until the hold runs out.
  if (c.aiHold[i] > 0) {
    c.aiHold[i] -= sim.dt;
    target = c.aiLat[i];
  }
  target = avoid(sim, i, sp, s, target, speed, skill, lineTarget);
  if (aiDebug) aiDebug[i] = { line: lineTarget, target, tTarget: lastT, cap: avoidCap, cand: Array.from(candTime) };

  // Path tracking (a Stanley-style controller) rather than pure pursuit: pure pursuit aims at a point
  // ahead and cuts every corner, which on a two-way road means the oncoming lane. Match the road's
  // heading and curvature a moment ahead, and steer out the sideways error.
  const lead = 2 + speed * 0.15;
  const onBranchAhead = s + lead >= 0;
  const path = onBranchAhead ? sp : track.main;
  const ps = onBranchAhead ? s + lead : c.s[i] + lead;
  sampleAt(path, ps, look);
  sampleAt(path, ps + 6, probe);
  const pathH = Math.atan2(look.tx, look.tz);
  const curv = wrapAngle(Math.atan2(probe.tx, probe.tz) - pathH) / 6;
  // Sideways error from where we want to be (positive: we're right of the target).
  const cross = (c.x[i] - look.cx) * -look.tz + (c.z[i] - look.cz) * look.tx - target;
  const want = pathH + Math.atan2(1.6 * cross, speed + 4);
  const err = wrapAngle(want - c.h[i]);
  const f = speed / T.steerFalloff;
  const maxYaw = (cls.turn * Math.min(1, speed / 6)) / (1 + f * f * 0.9);
  // Feed-forward: the yaw the curve needs; feedback: the heading error. Heading grows to the left,
  // so a left turn (curv > 0, err > 0) means steer negative.
  const ff = (curv * speed) / Math.max(0.2, maxYaw);
  out.steer = clamp(-(ff + err * (2.2 + speed / 30)) - c.yaw[i] * 0.05, -1, 1);

  // Speed: the profile a little ahead (so braking starts in time), scaled by skill and catch-up.
  let v = lineAt(s + speed * 0.35 + 4, line.speed) * skill.pace;
  if (avoidCap < v) v = avoidCap;
  v = Math.min(v, cls.topSpeed * (c.boosting[i] ? T.boostTop : 1));
  v *= catchup(sim, i, skill.catchup);
  // Surfaces: slower on loose or wet ground.
  const grip = sim.surfaces[c.surface[i]].grip * sim.weatherGrip;
  if (grip < 0.95) v *= 0.75 + 0.25 * grip;
  out.throttle = speed < v - 1 ? 1 : speed < v + 1 ? 0.35 : 0;
  out.brake = speed > v + 2.5 ? clamp((speed - v) / 8, 0.2, 1) : 0;
  out.drift = false;

  // Boost on long fast stretches.
  let straight = true;
  for (let dd = 20; dd <= 160; dd += 35) if (lineAt(s + dd, line.speed) < cls.topSpeed * 0.95) straight = false;
  out.boost = skill.boost && straight && c.boost[i] > 0.25 && c.wreck[i] === 0 && Math.abs(out.steer) < 0.3;

  out.reset = c.wreck[i] === 0 && (c.stuckT[i] > 2.5 || wrongWay(sim, i));
  out.lookBack = false;
  out.horn = false;
  return out;
}

/**
 * Offsets the lateral target round traffic, hazard pieces, props and slower cars. Threats are
 * judged by time to contact, not distance: an oncoming car at 150 m is closer than a parked one
 * at 60. Seven candidate lines across the road; take the one with the most time, near the line
 * and near where we are, on our own side of the road unless we're good. If no line has more time
 * than the one we're on, brake to stay behind what's there.
 */
function avoid(sim: SimState, i: number, sp: BakedSpline, s: number, target: number, speed: number, skill: (typeof SKILL)[number], line: number): number {
  const c = sim.cars;
  const world = sim.world;
  const L = sim.track.main.length;
  const half = sampleAt(sp, s + 20, probe).width / 2 - 1.4;
  const me = sim.classes[c.cls[i]].size[0];
  const n = CANDIDATES.length;
  for (let k = 0; k < n; k++) {
    candLat[k] = CANDIDATES[k] * half;
    candTime[k] = HORIZON;
  }
  let tTarget = HORIZON;
  let capDs = 0;
  let capV = 0;
  avoidCap = Infinity;
  /** A thing at lateral `lat` (half width hw), `ds` ahead, moving along the road at `v` (negative: toward us). */
  const mark = (lat: number, hw: number, ds: number, v: number) => {
    if (ds < -3 || ds > 260) return;
    const closing = speed - v;
    if (closing < 0.5 && ds > 4) return;
    const tc = Math.max(0, ds - 3) / Math.max(0.5, closing);
    if (tc >= HORIZON) return;
    const lo = lat - hw - me - 0.7;
    const hi = lat + hw + me + 0.7;
    if (target > lo && target < hi && tc < tTarget) {
      tTarget = tc;
      capDs = ds;
      capV = v;
    }
    for (let k = 0; k < n; k++) if (candLat[k] > lo && candLat[k] < hi) candTime[k] = Math.min(candTime[k], tc);
  };
  const sMain = mainDistance(sim.track, c.spline[i], c.s[i]);
  let oncomingSide = 0;
  if (world && sp.index === 0) {
    const tr = world.traffic;
    for (const lane of tr.lanes) if (lane.dir < 0) oncomingSide = Math.sign(lane.pos);
    for (let p = 0; p < tr.posed; p++) {
      const ds = wrap(tr.s[p] - sMain + L / 2, L) - L / 2;
      const k = tr.idx[p];
      const lane = tr.lanes[tr.lane[k]];
      mark(tr.lat[p], TRAFFIC_KINDS[tr.kind[k]].hw, ds, lane.dir * lane.speed);
    }
    const hz = world.hazards;
    for (let p = 0; p < hz.pieces; p++) {
      const ds = wrap(hz.pS[p] - sMain + L / 2, L) - L / 2;
      sampleAt(sim.track.main, hz.pS[p], probe);
      const lat = (hz.px[p] - probe.cx) * -probe.tz + (hz.pz[p] - probe.cz) * probe.tx;
      mark(lat, Math.max(hz.phw[p], hz.phl[p]), ds, 0);
    }
  }
  for (const pr of sim.track.props) {
    if (!pr.solid || pr.spline !== sp.index) continue;
    mark(pr.lateral, Math.max(pr.hx, pr.hz), pr.s - s, 0);
  }
  for (let j = 0; j < c.count; j++) {
    if (j === i || !c.active[j] || c.spline[j] !== c.spline[i]) continue;
    const vj = c.wreck[j] ? 0 : Math.hypot(c.vx[j], c.vz[j]);
    mark(c.lateral[j], sim.classes[c.cls[j]].size[0], c.s[j] - c.s[i], vj);
  }
  lastT = tTarget;
  if (tTarget >= HORIZON) return target;
  // Getting to a line means crossing the ones between here and there: it's only as clear as the
  // worst of them.
  let hereK = 0;
  for (let k = 1; k < n; k++) if (Math.abs(candLat[k] - c.lateral[i]) < Math.abs(candLat[hereK] - c.lateral[i])) hereK = k;
  for (let k = 0; k < n; k++) {
    let worst = candTime[k];
    // (Not counting the line we're on: that's the one we're leaving.)
    const step = k > hereK ? 1 : -1;
    // A line in between only matters if its threat arrives before we're across it (~4 m/s sideways).
    for (let j = hereK + step; j !== k + step && k !== hereK; j += step) {
      const across = Math.abs(candLat[j] - c.lateral[i]) / 4 + 0.3;
      if (candTime[j] < across) worst = Math.min(worst, candTime[j]);
    }
    candPath[k] = worst;
  }
  for (let k = 0; k < n; k++) candTime[k] = candPath[k];
  let best = 0;
  let bestScore = -Infinity;
  const here = c.lateral[i];
  for (let k = 0; k < n; k++) {
    // Scored against the racing line and where we are, not against the last decision (that dithers).
    let score = candTime[k] * 10 - Math.abs(candLat[k] - line) * 0.5 - Math.abs(candLat[k] - here) * 0.4;
    // Easier drivers keep to their own side of a two-way road.
    if (oncomingSide !== 0 && Math.sign(candLat[k]) === oncomingSide && Math.abs(candLat[k]) > 1) score -= skill.ownSide;
    if (score > bestScore) {
      bestScore = score;
      best = k;
    }
  }
  if (candTime[best] <= tTarget + 0.25) {
    // No better line: brake to arrive behind it at its speed, with a car length to spare.
    avoidCap = Math.max(4, Math.max(0, capV) + Math.sqrt(2 * 16 * Math.max(0, capDs - 9)));
    return target;
  }
  // Commit to it for a moment, so the next tick doesn't talk us back out of it.
  c.aiLat[i] = candLat[best];
  c.aiHold[i] = 0.8;
  return candLat[best];
}

const HORIZON = 3.2;
let lastT = HORIZON;
/** Set to an array to record each AI's last decision (tools and tests). */
export let aiDebug: { line: number; target: number; tTarget: number; cap: number; cand: number[] }[] | null = null;
export function debugAi(on: boolean): void {
  aiDebug = on ? [] : null;
}
const CANDIDATES = [-0.85, -0.55, -0.25, 0, 0.25, 0.55, 0.85];
const candLat = new Float64Array(CANDIDATES.length);
const candTime = new Float64Array(CANDIDATES.length);
const candPath = new Float64Array(CANDIDATES.length);

/** Set by `avoid`: a speed cap when every gap ahead is blocked. */
let avoidCap = Infinity;

/** Catch-up: a little faster when far behind the leading human, a little slower when far ahead. */
function catchup(sim: SimState, i: number, amount: number): number {
  const c = sim.cars;
  let lead = -Infinity;
  for (let j = 0; j < c.count; j++) if (c.human[j] && c.active[j]) lead = Math.max(lead, c.progress[j]);
  if (lead === -Infinity) return 1;
  const gap = lead - c.progress[i];
  return 1 + clamp(gap / 400, -1, 1) * 0.07 * amount;
}

function wrongWay(sim: SimState, i: number): boolean {
  const c = sim.cars;
  const sp = sim.track.splines[c.spline[i]];
  const at = sampleAt(sp, c.s[i], probe);
  const road = Math.atan2(at.tx, at.tz);
  const speed = Math.hypot(c.vx[i], c.vz[i]);
  return speed > 3 && Math.abs(wrapAngle(Math.atan2(c.vx[i], c.vz[i]) - road)) > 2.2;
}
