// The racing AI (SPEC §10: its only memory is what it can rebuild from the car's pose and the
// track in one tick, so a host change loses nothing). Per spline, once: a racing line (out, in at
// the apex, out) and a speed profile from the car's own steering model, with braking points found
// by a backward pass. Per tick: pure pursuit on the line, throttle and brake to the profile, a
// lateral offset to get round traffic, hazards and slower cars, boost on straights, a seeded
// choice of shortcuts, and mild catch-up toward the human leader.

import { TUNING as T } from '../car/tuning';
import type { CanyonDef, CarClass, SlalomGate } from '../content';
import type { Controls } from '../controls';
import { atan2, clamp, cos, hypot, sin, smoothstep, sq, wrapAngle } from '../math';
import { hash01 } from '../rng';
import type { SimState } from '../state';
import { mainDistance, signedGap, wrap, type BakedSpline, type Track } from '../track/bake';
import type { Street } from '../track/graph';
import { newHit, sampleAt, type TrackHit } from '../track/query';
import { laneActive, TRAFFIC_KINDS } from '../world/traffic';

export type Difficulty = 0 | 1 | 2;

export interface RacerDriver {
  difficulty: Difficulty;
}

/** How much less often the AI takes a secret shortcut than a signed one. */
const SECRET_TAKE = 0.35;
/** How much less often it rides a canyon (open ground) than takes a signed shortcut. */
const CANYON_TAKE = 0.5;
/**
 * Onto a canyon's floor over this far, by where its walls start to rise (cutting in late, over a
 * rim, flies you across it); and out up its side over this far, before its floor rises at the end
 * (that's a kicker: down the wall after the first canyon it threw cars 35 m up, into the pines).
 */
const CANYON_IN = 250;
const CANYON_OUT = 180;

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
/** The least braking (m/s²) the AI plans on, however steep the slope it's braking down. */
const BRAKE_LEFT = 8;

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
    const a = atan2(sp.tx[at(i - w)], sp.tz[at(i - w)]);
    const b = atan2(sp.tx[at(i + w)], sp.tz[at(i + w)]);
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
  threadProps(track, sp, offset, at);
  // Speed: what the corner allows (the line is wider than the centerline: ~1.25× the radius).
  const speed = new Float64Array(n);
  // The line is wider than the centerline on a wide road; on a narrow one there's no room to widen it.
  for (let i = 0; i < n; i++) speed[i] = cornerSpeed((1 + clamp((sp.width[i] - 8) / 30, 0, 0.3)) / Math.max(1e-4, Math.abs(k[i])), 2.4);
  // A branch slower than its curves say (the Stairs): no faster than its limit.
  const limit = sp.index > 0 ? track.layout.branches?.[sp.index - 1]?.limit : undefined;
  if (limit !== undefined) for (let i = 0; i < n; i++) speed[i] = Math.min(speed[i], limit);
  // Crests: don't fly off a drop into a corner. (Air is fine; the braking pass handles the rest.)
  // Braking: work backwards so every corner is reachable from the one before. On sliding snow the
  // slope takes some of the brakes downhill (and adds to them uphill): plan with what's left.
  const brake = new Float64Array(n).fill(22);
  if (track.ground) {
    for (let i = 0; i < n; i++) {
      const slide = track.surfaces[sp.surface[i]].slide ?? 0;
      const drop = (sp.py[at(i - 2)] - sp.py[at(i + 2)]) / (4 * sp.step);
      if (slide > 0) brake[i] = clamp(22 - T.gravity * slide * drop, BRAKE_LEFT, 30);
    }
  }
  // An open road (one run) ends: stop by its end, in the run-out past the finish.
  if (!sp.closed && sp.index === 0) speed[n - 1] = 0;
  // A branch rejoins its road (the main road, or another branch) at what that road's line allows
  // there, so its braking sees a corner just past the rejoin (out of the Lava Tube flat out, into
  // the rim road's bend).
  if (sp.index > 0) {
    const rejoin = track.splines[sp.toRoad];
    speed[n - 1] = Math.min(speed[n - 1], lineAt(rejoin, sp.toS, racingLine(track, rejoin).speed));
  }
  for (let pass = 0; pass < (sp.closed ? 2 : 1); pass++) {
    for (let i = n - 2; i >= 0; i--) speed[i] = Math.min(speed[i], Math.sqrt(sq(speed[i + 1]) + 2 * brake[i] * sp.step));
    if (sp.closed) speed[n - 1] = Math.min(speed[n - 1], Math.sqrt(sq(speed[0]) + 2 * brake[n - 1] * sp.step));
  }
  const line = { offset, speed };
  perTrack.set(sp.index, line);
  return line;
}

/**
 * Moves the line through a gap between the solid props on this spline (the Boulevard's colonnade,
 * the Trestle's legs), eased in and out over PROP_EASE m: swerving at the last moment round a post
 * is how the AI ended up across a traffic lane.
 */
const PROP_CLEAR = 2.1;
const PROP_CLEAR_OPEN = 1.5;
const HOLD_OPEN = 30;
/** Heading into the slope's sideways pull (rad per unit of cross slope). */
const UPHILL_AIM = 0.5;
const SLOPE = { x: 0, z: 0 };
const PROP_EASE = 40;
function threadProps(track: Track, sp: BakedSpline, offset: Float64Array, at: (i: number) => number): void {
  const mine = track.props.filter((p) => p.solid && p.spline === sp.index);
  if (!mine.length) return;
  const n = sp.n;
  const reach = 12;
  // On open ground (rocks on a piste, taken flat out over swells) the line keeps further off.
  const margin = PROP_CLEAR + (track.ground ? PROP_CLEAR_OPEN : 0);
  // How far across a prop reaches: a rock on a piste is set along it (a ridge's hz is its length).
  const across = (p: (typeof mine)[number]) => (track.ground ? p.hx : Math.max(p.hx, p.hz));
  const clear = (lat: number, s: number) => mine.every((p) => Math.abs(p.s - s) > Math.max(reach, p.hz) || Math.abs(p.lateral - lat) > across(p) + margin);
  const shift = new Float64Array(n);
  const weight = new Float64Array(n);
  const ease = Math.round(PROP_EASE / sp.step);
  for (const p of mine) {
    const j = at(Math.round(p.s / sp.step));
    if (clear(offset[j], p.s)) continue;
    // The nearest clear line at this post.
    const edge = sp.width[j] / 2 - 1.4;
    let best = NaN;
    for (let lat = -edge; lat <= edge; lat += 0.25) if (clear(lat, p.s) && !(Math.abs(lat - offset[j]) >= Math.abs(best - offset[j]))) best = lat;
    if (Number.isNaN(best)) continue;
    // On open ground, flat out at a rock: clear of it well before (the whole shift by HOLD_OPEN m
    // short of it, held past it), eased in over twice as long.
    const hold = track.ground ? Math.round((p.hz + HOLD_OPEN) / sp.step) : 0;
    const span = track.ground ? ease * 2 : ease;
    for (let d = -span - hold; d <= span + hold; d++) {
      const i = at(j + d);
      const w = 1 - smoothstep(0, span, Math.abs(d) - hold);
      if (w > weight[i]) {
        weight[i] = w;
        shift[i] = best - offset[j];
      }
    }
  }
  for (let i = 0; i < n; i++) offset[i] += shift[i] * weight[i];
}

/**
 * Open ground: off the line (round another car) with a rock ahead, back to the line only on the
 * side of the rock you're on. Heading back diagonally is how a car met it head on.
 */
function passRocks(sim: SimState, i: number, sp: BakedSpline, target: number, speed: number): number {
  const c = sim.cars;
  const lat = c.lateral[i];
  for (const p of sim.track.props) {
    if (!p.solid || p.spline !== sp.index) continue;
    const ds = p.s - c.s[i];
    if (ds < -p.hz || ds > p.hz + 10 + speed * 1.6) continue;
    const reach = p.hx + PROP_CLEAR + PROP_CLEAR_OPEN;
    const side = Math.sign(lat - p.lateral) || 1;
    // The target beyond the rock from here, or on it: keep to this side.
    if ((target - p.lateral) * side < reach) target = p.lateral + side * reach;
  }
  return target;
}

/** The track's canyons (canyon features), found once per track. */
const canyonsOf = new WeakMap<Track, CanyonDef[]>();
const trackCanyons = (track: Track): CanyonDef[] => {
  let list = canyonsOf.get(track);
  if (!list) canyonsOf.set(track, (list = (track.ground?.features ?? []).flatMap((f) => (f.def?.kind === 'canyon' ? [f.def] : []))));
  return list;
};
const canyonOut = { lateral: 0, floor: 0, w: 0 };

/**
 * Whether car `i` rides a canyon at `s` m down the main road (a seeded choice per car and canyon,
 * as often as `take` allows), and how far into it: w from 0 (the line) to 1 (the canyon's floor).
 */
function canyonLine(sim: SimState, i: number, canyons: readonly CanyonDef[], s: number, take: number): typeof canyonOut | null {
  for (let k = 0; k < canyons.length; k++) {
    const cy = canyons[k];
    const out = cy.s[1] - cy.ease;
    if (s < cy.s[0] - CANYON_IN || s > out) continue;
    if (hash01(sim.seed, i * 131 + 977 + k, sim.cars.lap[i]) >= take * CANYON_TAKE) return null;
    canyonOut.lateral = cy.lateral;
    canyonOut.floor = cy.floor;
    canyonOut.w = Math.min(smoothstep(cy.s[0] - CANYON_IN, cy.s[0], s), 1 - smoothstep(out - CANYON_OUT, out, s));
    return canyonOut;
  }
  return null;
}

/** How far outside a gate (m) a hard driver will still bend its line to go through it. */
const GATE_REACH = 5;

/** `target` moved inside the next gate's flags, if one's coming up and it's within reach. */
function intoGate(gates: readonly SlalomGate[], s: number, speed: number, target: number): number {
  for (const g of gates) {
    const ds = g.s - s;
    if (ds < 0 || ds > 12 + speed * 1.4) continue;
    const half = g.gap / 2 - 1.8;
    const off = target - g.lateral;
    if (Math.abs(off) > half && Math.abs(off) < half + GATE_REACH) return g.lateral + Math.sign(off) * half;
    return target;
  }
  return target;
}

const look: TrackHit = newHit();
const probe: TrackHit = newHit();

export function driveRacer(sim: SimState, i: number, d: RacerDriver, out: Controls): Controls {
  const c = sim.cars;
  const track = sim.track;
  const skill = SKILL[d.difficulty];
  const cls = sim.classes[c.cls[i]];
  const speed = hypot(c.vx[i], c.vz[i]);
  const L = track.main.length;

  // Which spline to follow: the one we're on, or a shortcut we've chosen to take.
  let sp = track.splines[c.spline[i]];
  let s = c.s[i];
  // At a node of the road graph ahead on its road (core/track/graph.ts, step 6d; on any road, 6e),
  // the quickest way it knows on to the finish: on along this road, a detour (the Basin Road), or a
  // shortcut it knows of (its roll).
  {
    const g = track.graph;
    const costs = wayCosts(track, cls);
    const links = g.links[sp.index];
    for (const k of g.route.streets) {
      const st = g.streets[k];
      // (A way off is a branch: the main road is the way on, or where a branch comes back to.)
      if (st.spline === sp.index || st.spline === 0) continue;
      // Where its node is on our road (none: not a way off this one).
      let at = -1;
      for (const l of links) if (l.node === st.from) at = l.s;
      if (at < 0) continue;
      const br = track.splines[st.spline];
      // Approaching the node, or just past it but not yet more on the other road than on this one.
      const past = sp.closed ? wrap(s - at, L) : s - at;
      const toFrom = past >= 0 && past < 60 ? -past : sp.closed ? wrap(at - s, L) : at - s;
      if (toFrom >= 70 || toFrom <= -60) continue;
      // A detour every driver knows. A shortcut, now and then (its skill), a secret one seldom: now
      // and then a rival vanishes into the trees, and you learn it's there. (A side street's not on
      // the route: never.)
      // Against this road's way on from the same node (none: our road ends there, no choice to make),
      // and what it would wait there for.
      const node = g.nodes[st.from];
      let stay = -1;
      for (const m of node.out) if (g.streets[m].spline === sp.index) stay = m;
      if (stay < 0) continue;
      const detour = sim.track.layout.branches?.[br.index - 1]?.kind === 'alternate';
      if (!detour && !(hash01(sim.seed, i * 131 + br.index, c.lap[i]) < skill.shortcut * (br.secret ? SECRET_TAKE : 1))) continue;
      const mine = costs.time[k] + costs.toGo[st.to];
      const theirs = costs.time[stay] + costs.toGo[g.streets[stay].to] + (sp.index === 0 ? liftWait(sim, i, speed, d.difficulty, g.streets[stay]) : 0);
      if (mine < theirs) {
        sp = br;
        // (From where the street starts on its road: a lane's stretch of a branch starts partway.)
        s = st.s0 - toFrom;
        break;
      }
    }
  }
  const line = racingLine(track, sp);

  // Lateral target: the line, nudged round anything in the way.
  const ahead = 8 + speed * skill.look;
  let target = lineAt(sp, s + ahead, line.offset);
  // A hard driver steers for a slalom gate its line would just miss (any driver takes the ones it passes through).
  if (d.difficulty === 2 && sp.index === 0 && track.layout.slalom) target = intoGate(track.layout.slalom, s, speed, target);
  // On a two-way road, easier drivers keep their line on their own side.
  const world = sim.world;
  // Only where that lane has traffic: an empty street's wrong side is just a road.
  if (world && sp.index === 0 && skill.ownSide > 2) {
    const here = mainDistance(sim.track, c.spline[i], c.s[i]);
    for (let l = 0; l < world.traffic.lanes.length; l++) {
      const lane = world.traffic.lanes[l];
      if (lane.dir < 0 && laneActive(lane, here)) target = lane.pos < 0 ? Math.max(target, skill.ownSide > 8 ? 1 : -0.5) : Math.min(target, skill.ownSide > 8 ? -1 : 0.5);
    }
  }
  // Down a canyon's floor, now and then (open ground): out to it, along it and back.
  const canyons = sp.index === 0 ? trackCanyons(track) : null;
  const canyon = canyons?.length ? canyonLine(sim, i, canyons, s + ahead, skill.shortcut) : null;
  if (canyon) target += (canyon.lateral - target) * canyon.w;
  const lineTarget = target;
  // Holding a line round something: keep it until the hold runs out.
  // (World time, like the physics: slow-mo slows these too.)
  if (c.aiHold[i] > 0) {
    c.aiHold[i] -= sim.dt * sim.timeScale;
    target = c.aiLat[i];
  }
  // Round anything in the way: across the road, or across the canyon's floor when it's there.
  const inCanyon = canyon && canyon.w > 0.5 ? canyon : null;
  target = avoid(sim, i, sp, s, target, speed, skill, lineTarget, inCanyon?.lateral ?? 0, inCanyon ? inCanyon.floor / 2 - 1.4 : undefined);
  if (track.ground) target = passRocks(sim, i, sp, target, speed);
  if (aiDebug) aiDebug[i] = { line: lineTarget, target, tTarget: lastT, cap: avoidCap, cand: Array.from(candTime) };

  // Path tracking (a Stanley-style controller) rather than pure pursuit: pure pursuit aims at a point
  // ahead and cuts every corner, which on a two-way road means the oncoming lane. Match the road's
  // heading and curvature a moment ahead, and steer out the sideways error.
  const lead = 2 + speed * 0.15;
  const onBranchAhead = s + lead >= 0;
  // (Before the fork: the road it's on, the main road or a branch it leaves.)
  const path = onBranchAhead ? sp : track.splines[c.spline[i]];
  const ps = onBranchAhead ? s + lead : c.s[i] + lead;
  sampleAt(path, ps, look);
  sampleAt(path, ps + 6, probe);
  const pathH = atan2(look.tx, look.tz);
  const curv = wrapAngle(atan2(probe.tx, probe.tz) - pathH) / 6;
  // Sideways error from where we want to be (positive: we're right of the target).
  const cross = (c.x[i] - look.cx) * -look.tz + (c.z[i] - look.cz) * look.tx - target;
  let want = pathH + atan2(1.6 * cross, speed + 4);
  // On sliding snow the slope pulls you sideways down every bank and swell, and the line drifts a
  // few meters downhill of where it should be (into a rock): aim up the slope against it.
  if (track.ground && sim.surfaces[c.surface[i]].slide && c.grounded[i]) {
    const g = track.ground.slope(c.x[i], c.z[i], SLOPE);
    // The rise per meter to the car's right (right is (-cos h, sin h)); rising right, it pulls you left.
    const rising = -g.x * cos(c.h[i]) + g.z * sin(c.h[i]);
    want -= clamp(rising * UPHILL_AIM, -0.15, 0.15);
  }
  const err = wrapAngle(want - c.h[i]);
  const f = speed / T.steerFalloff;
  const maxYaw = (cls.turn * Math.min(1, speed / 6)) / (1 + f * f * 0.9);
  // Feed-forward: the yaw the curve needs; feedback: the heading error. Heading grows to the left,
  // so a left turn (curv > 0, err > 0) means steer negative.
  const ff = (curv * speed) / Math.max(0.2, maxYaw);
  out.steer = clamp(-(ff + err * (2.2 + speed / 30)) - c.yaw[i] * 0.05, -1, 1);

  // Speed: the profile a little ahead (so braking starts in time), scaled by skill and catch-up.
  const brakeAt = s + speed * 0.35 + 4;
  let v = lineAt(sp, brakeAt, line.speed);
  // Short of a fork it's chosen: the road's speed there, braking in time for the branch's start
  // (as its line brakes for a corner), not down to it from the moment it chose it (65 m short of the
  // Stairs it slowed to their limit, the pack behind it at 140 km/h).
  if (brakeAt < 0) {
    const road = track.splines[c.spline[i]];
    v = Math.min(lineAt(road, c.s[i] + speed * 0.35 + 4, racingLine(track, road).speed), Math.sqrt(sq(line.speed[0]) - 2 * COST_BRAKE * brakeAt));
  }
  v *= skill.pace;
  // Getting round something ahead in its line (a car, traffic, a hazard).
  const avoiding = avoidCap < v;
  if (avoiding) v = avoidCap;
  // As fast as the car can go: boosting, in a slipstream, and the straight-line build too. Down
  // sliding snow the slope takes it past that: let it, and brake only for what's ahead.
  const surf = sim.surfaces[c.surface[i]];
  const sliding = !!surf.slide && c.grounded[i] === 1;
  const top = cls.topSpeed * (c.boosting[i] ? T.boostTop : 1) * (1 + T.slipTop * c.draft[i] + (c.slingT[i] > 0 ? T.slingTop : 0)) * (1 + T.cruiseTop * c.cruise[i]);
  let vb = sliding ? v : Math.min(v, top);
  v = Math.min(v, top);
  // Catch-up, and slower on loose or wet ground.
  const grip = surf.grip * sim.weatherGrip;
  const k = catchup(sim, i, skill.catchup) * (grip < 0.95 ? 0.75 + 0.25 * grip : 1);
  v *= k;
  vb *= k;
  // A drawbridge ahead (core/world/lifts.ts): down when it gets there and while it crosses, on;
  // a hard driver also jumps it early in a lift, at speed; otherwise stop short of it and wait.
  const lift = liftCap(sim, i, speed, d.difficulty, sp);
  if (lift < v) {
    v = lift;
    vb = Math.min(vb, lift);
  }
  out.throttle = speed < v - 1 ? 1 : speed < v + 1 ? 0.35 : 0;
  out.brake = speed > vb + 2.5 ? clamp((speed - vb) / 8, 0.2, 1) : 0;
  // Stopped (or all but) for a drawbridge, or in the queue for it: held there, not creeping on
  // toward it (pressing on into the car ahead, the AI read itself as pinned and reversed out at
  // speed into the car behind).
  if (lift < LIFT_HOLD || (lift < Infinity && speed < LIFT_HOLD * 2)) {
    out.throttle = 0;
    // Braking while it still rolls forward, then nothing: held at a standstill, the brake is reverse
    // (cars backed out of the queue into the ones behind).
    out.brake = c.vx[i] * sin(c.h[i]) + c.vz[i] * cos(c.h[i]) > 0.3 ? 1 : 0;
  }
  out.drift = false;

  // Boost on long fast stretches.
  let straight = true;
  for (let dd = 20; dd <= 160; dd += 35) if (lineAt(sp, s + dd, line.speed) < cls.topSpeed * 0.95) straight = false;
  // Not into something it's getting round (a car or traffic ahead in its line): that's a wreck.
  out.boost = skill.boost && straight && !avoiding && c.boost[i] > 0.25 && c.wreck[i] === 0 && Math.abs(out.steer) < 0.3;

  // Pinned against something: back off for a moment, steering the other way, then try again.
  // (Not while wrecked: stuckT is frozen then, and a respawn clears it.)
  if (c.aiBack[i] < 0) c.aiBack[i] = Math.min(0, c.aiBack[i] + sim.dt * sim.timeScale);
  if (c.aiBack[i] === 0 && c.stuckT[i] > 0.6 && !c.wreck[i]) c.aiBack[i] = 1.1;
  if (c.aiBack[i] > 0) {
    c.aiBack[i] -= sim.dt * sim.timeScale;
    if (c.aiBack[i] <= 0) {
      c.aiBack[i] = -2;
      // Then try the other side of the road: straight back in on the same line meets whatever
      // stopped us (a fallen sign between the Trestle's legs pinned cars there until they reset).
      c.aiLat[i] = -Math.sign(c.lateral[i] || 1) * Math.max(1.5, Math.abs(c.lateral[i]) * 0.6);
      c.aiHold[i] = BACK_HOLD;
    }
    out.throttle = 0;
    out.brake = 1;
    out.steer = -out.steer;
    out.boost = false;
  }
  out.reset = c.wreck[i] === 0 && (c.stuckT[i] > 2.5 || (c.aiBack[i] <= 0 && wrongWay(sim, i)));
  out.lookBack = false;
  out.horn = false;
  return out;
}

/** A drawbridge further ahead than this (m) is none of the AI's business yet. */
const LIFT_LOOK = 300;
/** A hard driver jumps a leaf only up to this angle (rad) when it gets there, and only this fast (m/s). */
const LIFT_JUMP = 0.33;
const LIFT_JUMP_SPEED = 28;
/** Allowed less than this (m/s) for a drawbridge, it holds where it is on the brakes. */
const LIFT_HOLD = 1.5;
/** It stops this far (m) short of the hinge, braking this hard (m/s²). */
const LIFT_STOP = 8;
const LIFT_BRAKE = 8;

/** Whether a car is waiting (slow) between car `i` and a drawbridge's hinge at `hinge`, `ds` m ahead: then nobody jumps it (hard drivers went for the leaf as it came down, into the cars still waiting for it). */
function waiting(sim: SimState, i: number, hinge: number, ds: number): boolean {
  const c = sim.cars;
  const L = sim.track.main.length;
  for (let j = 0; j < c.count; j++) {
    if (j === i || !c.active[j]) continue;
    if (wrap(hinge - mainDistance(sim.track, c.spline[j], c.s[j]), L) < ds && sq(c.vx[j]) + sq(c.vz[j]) < sq(LIFT_JUMP_SPEED)) return true;
  }
  return false;
}

/** Whether a road round (`round`, a branch) skips main-road distance `s` (a lift's hinge). */
function skips(round: BakedSpline, s: number, L: number): boolean {
  return wrap(s - round.mainFrom, L) < wrap(round.mainTo - round.mainFrom, L);
}

/**
 * Whether drawbridge `k` stops car `i`, `ds` m short of its near hinge (arriving `later` s later
 * than now's pace says): not down when it gets there and while it crosses, and (a hard driver,
 * fast) not low enough to jump with nobody waiting.
 */
function liftStops(sim: SimState, i: number, speed: number, difficulty: number, k: number, ds: number, later = 0): boolean {
  const lifts = sim.world!.lifts;
  const span = lifts.defs[k].s;
  const pace = Math.max(speed, 12);
  const t = sim.time + ds / pace + later;
  const there = lifts.angle(k, t);
  const across = lifts.angle(k, t + (span[1] - span[0] + 20) / pace);
  if (there === 0 && across === 0) return false;
  return !(difficulty === 2 && speed >= LIFT_JUMP_SPEED && there <= LIFT_JUMP && across <= lifts.defs[k].wall && !waiting(sim, i, span[0], ds));
}

/** How far ahead (s) it looks for a drawbridge to come down, in steps of this. */
const WAIT_LOOK = 60;
const WAIT_STEP = 0.25;

/**
 * What stopping for a drawbridge costs on top of the wait (s): slowing short of the hinge and
 * pulling away again. Not a full stop's (braking from the bridge's 55-60 m/s to a standstill and
 * back is about 7 s): for a wait of a second or two a car only slows. Swept over the lift's cycle
 * for every class: the Basin Road (5.0-5.6 s slower than a clear bridge by `wayCosts`, 5.5-5.7 s
 * driven) is taken for a wait over about 2 s, the quicker way at every start time.
 */
const STOP_COST = 3.26;

/** How long (s) car `i` would wait at the drawbridges on main-road street `st` (0: none stop it), with stopping's cost; Infinity past WAIT_LOOK. */
function liftWait(sim: SimState, i: number, speed: number, difficulty: number, st: Street): number {
  const lifts = sim.world?.lifts;
  if (!lifts) return 0;
  const L = sim.track.main.length;
  const here = mainDistance(sim.track, sim.cars.spline[i], sim.cars.s[i]);
  let wait = 0;
  for (let k = 0; k < lifts.pieces.length; k++) {
    const hinge = lifts.defs[k].s[0];
    if (hinge < st.s0 || hinge >= st.s1) continue;
    const ds = wrap(hinge - here, L);
    if (!liftStops(sim, i, speed, difficulty, k, ds)) continue;
    let t = WAIT_STEP;
    while (t <= WAIT_LOOK && liftStops(sim, i, speed, difficulty, k, ds, t)) t += WAIT_STEP;
    if (t > WAIT_LOOK) return Infinity;
    // Down to a hundredth inside the last step (a step's worth either way moved who went round).
    let lo = t - WAIT_STEP;
    let hi = t;
    for (let n = 0; n < 5; n++) {
      const mid = (lo + hi) / 2;
      if (liftStops(sim, i, speed, difficulty, k, ds, mid)) lo = mid;
      else hi = mid;
    }
    wait = Math.max(wait, hi + STOP_COST);
  }
  return wait;
}

/** Per track and class: each street's time as driven (s), and from each node the quickest on to the finish by the route's streets. */
const costsByTrack = new WeakMap<Track, WeakMap<CarClass, WayCosts>>();
export interface WayCosts {
  time: Float64Array;
  toGo: Float64Array;
  /** Each road's speed as the class drives it (m/s per sample; the racing line's with `aiCosts: 'line'`). */
  speeds: Float64Array[];
}

/**
 * The quickest way on, as the class drives it: each road's racing line no faster than the class's
 * top speed, braked for as the line plans, and pulled away from as its engine allows (the sim's own
 * pull: less of it toward the top, air drag and rolling, a surface's drag). A branch starts at what
 * the road it leaves allows there (or its own line, if less) and charges that road the braking down
 * to it; it ends charging the road it rejoins the pull back up to that road's speed. By the racing
 * line alone (a corner's speed, braking, no pulling away and no top speed) short straights read as
 * near free: the AI skipped cuts it should take. A layout with `aiCosts: 'line'` keeps that (its
 * rivals take its slower shortcuts now and then).
 */
export function wayCosts(track: Track, cls: CarClass): WayCosts {
  let perTrack = costsByTrack.get(track);
  if (!perTrack) costsByTrack.set(track, (perTrack = new WeakMap()));
  const had = perTrack.get(cls);
  if (had) return had;
  const g = track.graph;
  const byLine = track.layout.aiCosts === 'line';
  // (In order: a branch starts from the road it leaves, an earlier one.)
  const speeds: Float64Array[] = [];
  for (const sp of track.splines) speeds.push(byLine ? racingLine(track, sp).speed : drivenSpeed(track, sp, cls, speeds));
  const time = new Float64Array(g.streets.length);
  for (const st of g.streets) {
    const sp = track.splines[st.spline];
    const v = speeds[st.spline];
    for (let s = st.s0; s < st.s1; s += sp.step) time[st.index] += sp.step / Math.max(1, v[Math.min(sp.n - 1, Math.round(s / sp.step))]);
    if (byLine || sp.index === 0) continue;
    // Braking down to it on the road it leaves; pulling back up on the road it rejoins.
    if (st.s0 === 0) time[st.index] += brakeInto(track.splines[sp.fromRoad], speeds[sp.fromRoad], sp.fromS, v[0]);
    if (st.s1 === sp.length) time[st.index] += pullOut(track, track.splines[sp.toRoad], speeds[sp.toRoad], sp.toS, v[sp.n - 1], cls);
  }
  // Back from the finish over the route's streets (a lap's finish is its line, 0 there).
  const toGo = new Float64Array(g.nodes.length).fill(Infinity);
  toGo[g.route.finish] = 0;
  for (let pass = 0; pass < g.nodes.length; pass++)
    for (const k of g.route.streets) {
      const st = g.streets[k];
      if (st.from !== g.route.finish) toGo[st.from] = Math.min(toGo[st.from], time[k] + toGo[st.to]);
    }
  const out = { time, toGo, speeds };
  perTrack.set(cls, out);
  return out;
}

/** The braking the costs plan on (m/s²): the racing line's. */
const COST_BRAKE = 22;

/** What the class's engine adds at `v` (m/s²) on surface index `surface`, flat out: physics.ts's longitudinal pull. */
function pull(track: Track, cls: CarClass, v: number, surface: number): number {
  const surf = track.surfaces[surface];
  const rough = surf.offroad ? (cls.offroad ?? 0) : 0;
  return cls.accel * Math.max(0.08, 1 - sq(v / cls.topSpeed)) - T.airDrag * v * v - T.rolling * Math.min(1, v) - (surf.drag ?? 0) * (1 - rough) * v;
}

/** One road's speed as the class drives it (m/s per sample): its line, its top speed, braked for and pulled away from. */
function drivenSpeed(track: Track, sp: BakedSpline, cls: CarClass, before: Float64Array[]): Float64Array {
  const n = sp.n;
  const v = Float64Array.from(racingLine(track, sp).speed, (x) => Math.min(x, cls.topSpeed));
  // Braked for again (the top speed lowered some of what the line braked from).
  for (let pass = 0; pass < (sp.closed ? 2 : 1); pass++) {
    for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(sq(v[i + 1]) + 2 * COST_BRAKE * sp.step));
    if (sp.closed) v[n - 1] = Math.min(v[n - 1], Math.sqrt(sq(v[0]) + 2 * COST_BRAKE * sp.step));
  }
  // Pulling away: a run from a standstill at its start; a lap round from where it's slowest; a
  // branch from what the road it leaves allows where it leaves it (that road's done first: an
  // earlier one).
  let i0 = 0;
  if (sp.index === 0 && !sp.closed) v[(i0 = Math.min(n - 1, Math.round((track.layout.run?.start ?? 0) / sp.step)))] = 0;
  else if (sp.index > 0) v[0] = Math.min(v[0], lineAt(track.splines[sp.fromRoad], sp.fromS, before[sp.fromRoad]));
  if (sp.closed) for (let i = 1; i < n; i++) if (v[i] < v[i0]) i0 = i;
  for (let k = 1; k < (sp.closed ? n + 1 : n - i0); k++) {
    const i = (i0 + k) % n;
    const j = (i0 + k - 1) % n;
    v[i] = Math.min(v[i], Math.sqrt(Math.max(0, sq(v[j]) + 2 * pull(track, cls, v[j], sp.surface[j]) * sp.step)));
  }
  return v;
}

/** What braking from road `sp`'s speed `v` down to `to` (m/s) by `at` costs (s) over driving on at `v`. */
function brakeInto(sp: BakedSpline, v: Float64Array, at: number, to: number): number {
  let extra = 0;
  let u = to;
  for (let s = at - sp.step; s > at - sp.length; s -= sp.step) {
    const here = lineAt(sp, s, v);
    u = Math.sqrt(sq(u) + 2 * COST_BRAKE * sp.step);
    if (u >= here || (!sp.closed && s < 0)) break;
    extra += sp.step / Math.max(1, u) - sp.step / Math.max(1, here);
  }
  return extra;
}

/** What pulling away from `from` (m/s) at `at` on road `sp` costs (s) over that road's speed `v`, until it's back up to it. */
function pullOut(track: Track, sp: BakedSpline, v: Float64Array, at: number, from: number, cls: CarClass): number {
  let extra = 0;
  let u = from;
  for (let s = at; s < at + sp.length; s += sp.step) {
    if (!sp.closed && s >= sp.length) break;
    const here = lineAt(sp, s, v);
    if (u >= here) break;
    extra += sp.step / Math.max(1, u) - sp.step / Math.max(1, here);
    const i = Math.round(wrap(s, sp.length) / sp.step) % sp.n;
    u = Math.sqrt(Math.max(0, sq(u) + 2 * pull(track, cls, u, sp.surface[i]) * sp.step));
  }
  return extra;
}

/**
 * How fast car `i`, following `sp`, may go for the drawbridges ahead (Infinity: no limit). Each
 * leaf's angle is a function of the race clock, so the AI knows it ahead: it goes on if the bridge
 * is down when it gets there and while it crosses (a hard driver: low enough to jump, and it's
 * fast), round it on a detour it's taking, and otherwise slows to stop short of it.
 */
function liftCap(sim: SimState, i: number, speed: number, difficulty: number, sp: BakedSpline): number {
  const lifts = sim.world?.lifts;
  if (!lifts || !lifts.pieces.length) return Infinity;
  const L = sim.track.main.length;
  const here = mainDistance(sim.track, sim.cars.spline[i], sim.cars.s[i]);
  let cap = Infinity;
  for (let k = 0; k < lifts.pieces.length; k++) {
    const span = lifts.defs[k].s;
    // Going round it (the Basin Road): not ours to stop for.
    if (sp.index > 0 && skips(sp, span[0], L)) continue;
    // Already on its span (past the near hinge): nothing to stop for now, on across. (Past the
    // hinge the distance to it wraps to nearly a lap: it read as no bridge at all.)
    if (wrap(here - span[0], L) < span[1] - span[0]) continue;
    const ds = wrap(span[0] - here, L);
    if (ds > LIFT_LOOK) continue;
    if (!liftStops(sim, i, speed, difficulty, k, ds)) continue;
    // Too close to stop short of its hinge, and down when we get there: on across, not stopped on a leaf.
    if (lifts.angle(k, sim.time + ds / Math.max(speed, 12)) === 0 && sq(speed) > 2 * LIFT_BRAKE * ds) continue;
    cap = Math.min(cap, Math.sqrt(2 * LIFT_BRAKE * Math.max(0, ds - LIFT_STOP)));
  }
  return cap;
}

/** The racing line's value at distance `dist` along `sp` (wrapping on a closed spline). */
export function lineAt(sp: BakedSpline, dist: number, arr: Float64Array): number {
  const idx = sp.closed ? Math.round(wrap(dist, sp.length) / sp.step) % sp.n : Math.max(0, Math.min(sp.n - 1, Math.round(dist / sp.step)));
  return arr[idx];
}

/** avoid()'s working state, module scratch so marking a threat doesn't allocate a closure per tick. */
const mk = { speed: 0, target: 0, here: 0, me: 0, len: 0, tTarget: 0, capDs: 0, capV: 0 };
/** How fast (m/s) an AI gets across the road toward its target, for where it'll be at a contact. */
const SIDEWAYS = 3;

/** A thing at lateral `lat` (half width hw), `ds` ahead, moving along the road at `v` (negative: toward us). */
function mark(lat: number, hw: number, ds: number, v: number): void {
  if (ds < -3 || ds > 260) return;
  const closing = mk.speed - v;
  const gap = ds - mk.len;
  if (closing < 0.5 && gap > 4) return;
  const tc = Math.max(0, gap - 1) / Math.max(0.5, closing);
  if (tc >= HORIZON) return;
  const lo = lat - hw - mk.me - 0.7;
  const hi = lat + hw + mk.me + 0.7;
  // Where we'll be when we get there: on the way to the target, not at it yet. (Judging the target
  // alone had the AI cut across a slower car's lane into its tail.)
  const move = mk.target - mk.here;
  const then = mk.here + Math.sign(move) * Math.min(Math.abs(move), SIDEWAYS * tc);
  if (((then > lo && then < hi) || (mk.target > lo && mk.target < hi)) && tc < mk.tTarget) {
    mk.tTarget = tc;
    mk.capDs = ds;
    mk.capV = v;
  }
  for (let k = 0; k < CANDIDATES.length; k++) if (candLat[k] > lo && candLat[k] < hi) candTime[k] = Math.min(candTime[k], tc);
}

/**
 * Offsets the lateral target round traffic, hazard pieces, props and slower cars. Threats are
 * judged by time to contact, not distance: an oncoming car at 150 m is closer than a parked one
 * at 60. Seven candidate lines across the road; take the one with the most time, near the line
 * and near where we are, on our own side of the road unless we're good. If no line has more time
 * than the one we're on, brake to stay behind what's there.
 */
function avoid(sim: SimState, i: number, sp: BakedSpline, s: number, target: number, speed: number, skill: (typeof SKILL)[number], line: number, mid = 0, across?: number): number {
  const c = sim.cars;
  const world = sim.world;
  const L = sim.track.main.length;
  const half = across ?? sampleAt(sp, s + 20, probe).width / 2 - 1.4;
  const me = sim.classes[c.cls[i]].size[0];
  const n = CANDIDATES.length;
  for (let k = 0; k < n; k++) {
    candLat[k] = mid + CANDIDATES[k] * half;
    candTime[k] = HORIZON;
  }
  // Merging off a branch, the mirror too (on the road it's on, not one it's turning off onto).
  if (sp.index === c.spline[i] && merging(sim, i)) target = mirror(sim, i, target, speed, me);
  mk.speed = speed;
  mk.target = target;
  mk.here = c.lateral[i];
  mk.me = me;
  mk.len = sim.classes[c.cls[i]].size[1];
  mk.tTarget = HORIZON;
  mk.capDs = 0;
  mk.capV = 0;
  avoidCap = Infinity;
  const sMain = mainDistance(sim.track, c.spline[i], c.s[i]);
  let oncomingSide = 0;
  // What's on the road the car is on: still the main road for the last stretch before a shortcut
  // it has picked (sp is where it's headed).
  if (world && c.spline[i] === 0) {
    const tr = world.traffic;
    for (let l = 0; l < tr.lanes.length; l++) if (tr.lanes[l].dir < 0 && laneActive(tr.lanes[l], sMain)) oncomingSide = Math.sign(tr.lanes[l].pos);
    for (let p = 0; p < tr.posed; p++) {
      // Where it's reckoned to be (a car about to pull out of a side street: in its lane already).
      mark(tr.seenLat[p], TRAFFIC_KINDS[tr.kind[tr.idx[p]]].hw, signedGap(tr.seenS[p], sMain, L), tr.along[p]);
    }
    const hz = world.hazards;
    for (let p = 0; p < hz.pieces; p++) {
      const ds = signedGap(hz.pS[p], sMain, L);
      sampleAt(sim.track.main, hz.pS[p], probe);
      const lat = (hz.px[p] - probe.cx) * -probe.tz + (hz.pz[p] - probe.cz) * probe.tx;
      mark(lat, Math.max(hz.phw[p], hz.phl[p]), ds, 0);
    }
  }
  const props = sim.track.props;
  for (let q = 0; q < props.length; q++) {
    const pr = props[q];
    if (!pr.solid || pr.spline !== sp.index) continue;
    mark(pr.lateral, sim.track.ground ? pr.hx : Math.max(pr.hx, pr.hz), sp.closed ? signedGap(pr.s, s, sp.length) : pr.s - s, 0);
  }
  for (let j = 0; j < c.count; j++) {
    if (j === i || !c.active[j] || c.spline[j] !== c.spline[i]) continue;
    const vj = c.wreck[j] ? 0 : hypot(c.vx[j], c.vz[j]);
    mark(c.lateral[j], sim.classes[c.cls[j]].size[0], sp.closed ? signedGap(c.s[j], c.s[i], sp.length) : c.s[j] - c.s[i], vj);
  }
  lastT = mk.tTarget;
  if (mk.tTarget >= HORIZON) return target;
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
    // A clear line beats one that's merely far off: braking keeps a blocked line's time up.
    if (candTime[k] >= HORIZON) score += 8;
    // Easier drivers keep to their own side of a two-way road.
    if (oncomingSide !== 0 && Math.sign(candLat[k]) === oncomingSide && Math.abs(candLat[k]) > 1) score -= skill.ownSide;
    if (score > bestScore) {
      bestScore = score;
      best = k;
    }
  }
  if (candTime[best] <= mk.tTarget + 0.25) {
    // No better line: brake to arrive behind it at its speed, with a car length to spare.
    avoidCap = Math.max(4, Math.max(0, mk.capV) + Math.sqrt(2 * 16 * Math.max(0, mk.capDs - mk.len - 5)));
    return target;
  }
  // Commit to it for a moment, so the next tick doesn't talk us back out of it.
  c.aiLat[i] = candLat[best];
  c.aiHold[i] = 0.8;
  return candLat[best];
}

/**
 * Where a branch rejoins a road, from `before` m before its rejoin (where it's on the road already)
 * to `after` m past it: a merge, where a car checks its mirror. A threat there is a car `behind` m
 * back at most, faster and `soon` s from alongside, or alongside already (`alongside` car lengths
 * behind, whatever its speed, to `ahead` m in front);
 * the merging car keeps `room` m between their sides.
 */
const MERGE = { before: 50, after: 90, behind: 70, ahead: 6, soon: 2.5, room: 2.5, alongside: 3 };
/**
 * Whether car `i` is merging: on a branch it notes it (c.aiMerge); back on the road the branch
 * rejoins, it's merging till it's MERGE.after m past the rejoin. (Only the car coming off the
 * branch: every car in the zone checking, the pack off Backroads' start through the Barn's rejoin
 * held its lines into each other, 80 -> 96 field wrecks in 72 races.)
 */
function merging(sim: SimState, i: number): boolean {
  const c = sim.cars;
  const here = c.spline[i];
  if (here !== 0 && sim.track.splines[here].toRoad !== undefined && sim.track.layout.branches?.[here - 1]) {
    c.aiMerge[i] = here;
    return false;
  }
  const from = c.aiMerge[i];
  if (!from) return false;
  const b = sim.track.splines[from];
  if (b.toRoad !== here) {
    c.aiMerge[i] = 0;
    return false;
  }
  const road = sim.track.splines[here];
  const d = road.closed ? signedGap(c.s[i], b.toS, road.length) : c.s[i] - b.toS;
  if (d > MERGE.after) {
    c.aiMerge[i] = 0;
    return false;
  }
  return d > -MERGE.before;
}

/**
 * The mirror at a merge: a faster car coming up behind (or alongside) on a line between here and
 * `target` holds us on this side of it until it's by. Ahead, avoid() looks; behind it never did,
 * and rivals off Paradise's beach line swung across the road onto the racing line in front of the
 * ones coming round on it (6–11 field wrecks in 72 races at the rejoin).
 */
function mirror(sim: SimState, i: number, target: number, speed: number, me: number): number {
  const c = sim.cars;
  const sp = sim.track.splines[c.spline[i]];
  const here = c.lateral[i];
  const len = sim.classes[c.cls[i]].size[1];
  for (let j = 0; j < c.count; j++) {
    if (j === i || !c.active[j] || c.wreck[j] || c.spline[j] !== c.spline[i]) continue;
    const ds = sp.closed ? signedGap(c.s[j], c.s[i], sp.length) : c.s[j] - c.s[i];
    if (ds > MERGE.ahead || ds < -MERGE.behind) continue;
    const closing = hypot(c.vx[j], c.vz[j]) - speed;
    // (Within `alongside` lengths behind, it's alongside, whatever its speed.)
    if (ds < -MERGE.alongside * len && (closing < 1 || Math.max(0, -ds - len) / closing > MERGE.soon)) continue;
    const lat = c.lateral[j];
    const band = sim.classes[c.cls[j]].size[0] + me + MERGE.room;
    if (here < lat && target > lat - band) target = Math.min(target, lat - band);
    else if (here > lat && target < lat + band) target = Math.max(target, lat + band);
  }
  return target;
}

const HORIZON = 3.2;
/** After backing out, how long (s) an AI holds the other side of the road. */
const BACK_HOLD = 2.5;
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
  const road = atan2(at.tx, at.tz);
  const speed = hypot(c.vx[i], c.vz[i]);
  return speed > 3 && Math.abs(wrapAngle(atan2(c.vx[i], c.vz[i]) - road)) > 2.2 && Math.abs(wrapAngle(c.h[i] - road)) > 1.6;
}
