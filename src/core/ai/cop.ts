// A cop (docs/CHASE_MODE.md, step 1): after one car, the getaway's. In sight it drives at you, aimed
// a little ahead of where you're going (further each heat); out of sight it finds its way to you
// round the city's buildings along its streets (world/streets.ts), cutting the corners it can see
// across. Steering is the pace car's pure pursuit (ai/follow.ts) on that point; its speed is what it
// can stop or turn from in time, up to a heat's top speed. The rules (rules/getaway.ts) set its heat,
// call it out, and bring it back out of sight when it wrecks or sticks.

import type { Controls } from '../controls';
import { atan2, clamp, hypot, lerp, wrapAngle } from '../math';
import type { SimState } from '../state';
import type { Streets } from '../world/streets';

export interface CopDriver {
  streets: Streets;
  /** The car it's after. */
  target: number;
  /** The getaway's heat (1 up), set by the rules. */
  heat: number;
  /** Its way to you, as street nodes, how many, and the one it's heading for. */
  path: Int32Array;
  pathLen: number;
  pathAt: number;
  /** Whether it can see you (rechecked every LOOK s), and the world time it next looks and plans. */
  seen: boolean;
  lookAt: number;
  planAt: number;
  /** The getaway's over: it pulls up. */
  stop: boolean;
}

/** How often (s) a cop looks for you, and plans its way to you when it can't see you. */
const LOOK = 0.25;
const PLAN = 0.5;
/** Pulling up on you stopped: its middle this far from yours (m), a car's length and a little. */
const BOX = 5.5;
/** It sees you this far off (m), with nothing in the way. */
const SIGHT = 160;
/** Within this far (m) of the next node on its way, it's there: on to the one after. */
const REACHED = 9;
/** How hard it reckons it can brake (m/s²): its speed now is what it can slow from to the next corner's in time. */
const BRAKING = 15;
/** The slowest it takes a square corner (m/s). */
const CORNER = 11;
/** Its top speed, as a share of the getaway car's, at heat 1, 2, 3…; past the list, a little more each heat. */
const PACE = [0.74, 0.84, 0.94, 1.02, 1.07, 1.11];
const PACE_MORE = 0.03;
/** Out of sight and further than this (m), it's quicker by CATCH_UP (CALDERA's "catch-up, honestly": never so close it's cheating). */
const CATCH_UP_FROM = 120;
const CATCH_UP = 1.12;
/** From heat 2, out of sight it heads for where you'll be (at most this many seconds on), not where you are. */
const INTERCEPT = 4;

export function newCop(streets: Streets, target: number): CopDriver {
  return { streets, target, heat: 1, path: new Int32Array(64), pathLen: 0, pathAt: 0, seen: false, lookAt: 0, planAt: 0, stop: false };
}

/** A cop's top speed (m/s) at a heat, after a car whose class tops out at `top`. */
export function copPace(heat: number, top: number): number {
  const k = heat <= PACE.length ? PACE[heat - 1] : PACE[PACE.length - 1] + (heat - PACE.length) * PACE_MORE;
  return top * k;
}

export function driveCop(sim: SimState, i: number, d: CopDriver, out: Controls): Controls {
  const c = sim.cars;
  const j = d.target;
  const x = c.x[i];
  const z = c.z[i];
  const speed = hypot(c.vx[i], c.vz[i]);
  const dist = hypot(c.x[j] - x, c.z[j] - z);
  const st = d.streets;
  if (d.stop) {
    out.steer = 0;
    out.throttle = 0;
    out.brake = speed > 0.5 ? 1 : 0;
    out.boost = out.drift = out.reset = out.lookBack = out.horn = false;
    return out;
  }
  if (sim.time >= d.lookAt) {
    d.lookAt = sim.time + LOOK;
    d.seen = dist < SIGHT && st.clear(x, z, c.x[j], c.z[j]);
  }
  let tx: number;
  let tz: number;
  /** How sharply it turns at the point it's aiming for, toward what's after it (0 straight on). */
  let turn = 0;
  if (d.seen) {
    // At you, a little ahead of where you're going: none at heat 1 (it follows), more each heat (it cuts you off).
    const lead = Math.min(1.2, 0.3 * (d.heat - 1)) * clamp(dist / 40, 0, 1);
    tx = c.x[j] + c.vx[j] * lead;
    tz = c.z[j] + c.vz[j] * lead;
    d.pathLen = 0;
  } else {
    // (Its way used up, it heads straight at you till the next plan: not a plan every tick.)
    if (sim.time >= d.planAt) {
      d.planAt = sim.time + PLAN;
      // (From heat 2, where you'll be by the time it gets there, as near as it can tell.)
      const ahead = d.heat >= 2 ? Math.min(INTERCEPT, dist / Math.max(20, speed)) : 0;
      d.pathLen = st.path(st.nearest(x, z), st.nearest(c.x[j] + c.vx[j] * ahead, c.z[j] + c.vz[j] * ahead), d.path);
      d.pathAt = 0;
      // (The first node may be behind it, the nearest one it can see: past it if the next's in sight.)
      if (d.pathLen > 1 && st.clear(x, z, st.x(d.path[1]), st.z(d.path[1]))) d.pathAt = 1;
    }
    // On to the next node once it's there, or once the one after is in sight close by (it cuts the corner).
    while (d.pathAt < d.pathLen) {
      const k = d.path[d.pathAt];
      const here = hypot(st.x(k) - x, st.z(k) - z);
      const after = d.pathAt + 1 < d.pathLen ? d.path[d.pathAt + 1] : -1;
      if (here < REACHED || (after >= 0 && here < 25 && st.clear(x, z, st.x(after), st.z(after)))) d.pathAt++;
      else break;
    }
    if (d.pathAt < d.pathLen) {
      const k = d.path[d.pathAt];
      tx = st.x(k);
      tz = st.z(k);
      if (d.pathAt + 1 < d.pathLen) {
        const n = d.path[d.pathAt + 1];
        turn = Math.abs(wrapAngle(atan2(st.x(n) - tx, st.z(n) - tz) - atan2(tx - x, tz - z)));
      }
    } else {
      // Nowhere to go on the streets (it's at your node): straight at you.
      tx = c.x[j];
      tz = c.z[j];
    }
  }
  const want = atan2(tx - x, tz - z);
  const err = wrapAngle(want - c.h[i]);
  // err > 0: the target is to the left (heading grows to the left), so steer negative.
  out.steer = clamp(-err * 2.4, -1, 1);
  const top = copPace(d.heat, sim.classes[c.cls[j]].topSpeed) * (!d.seen && dist > CATCH_UP_FROM ? CATCH_UP : 1);
  const ahead = hypot(tx - x, tz - z);
  // What it can still slow to the corner's speed from, in the distance left; and slow while it's pointed the wrong way.
  const corner = lerp(top, CORNER, clamp(turn / 1.6, 0, 1));
  let target = Math.min(top, Math.sqrt(corner * corner + 2 * BRAKING * Math.max(0, ahead - 6)));
  target = Math.min(target, lerp(top, CORNER, clamp((Math.abs(err) - 0.3) / 0.9, 0, 1)));
  // Coming up on you without seeing you (round a corner), or at heat 1 at all, no faster than it
  // could still pull up behind you from; right on you at heat 1, it sits on your bumper instead of ramming you.
  const youSpeed = hypot(c.vx[j], c.vz[j]);
  if (!d.seen || d.heat <= 1) target = Math.min(target, Math.sqrt(youSpeed * youSpeed + 2 * BRAKING * Math.max(0, dist - 12)));
  if (d.seen && d.heat <= 1 && dist < 14) target = Math.min(target, Math.max(0, youSpeed - 0.5));
  // You've stopped: close by, it creeps up to BOX m and stops there, boxing you in (busted within
  // rules/getaway.ts's 7.5 m), rather than shove you down the street; at any heat (at heat 1 it
  // had stopped at 12 m, too far to bust you: a safe place to park).
  if (youSpeed < 4 && dist < 14) target = Math.min(top, Math.max(0, (dist - BOX) * 0.8));
  out.throttle = speed < target ? 1 : 0;
  out.brake = speed > target + 3 ? 0.7 : 0;
  // From heat 3, boost to close a gap on a straight while it can see you.
  out.boost = d.heat >= 3 && d.seen && dist > 25 && Math.abs(err) < 0.15 && c.boost[i] > 0.15;
  out.drift = false;
  out.reset = false;
  out.lookBack = false;
  out.horn = false;
  return out;
}
