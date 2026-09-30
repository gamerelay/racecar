// A simple driver that follows a lane at a target speed: pure pursuit on a point ahead along the
// spline. It's milestone 1's pace car (something to race and ram); the real AI (milestone 2)
// builds on the same steering.

import type { Controls } from '../controls';
import { clamp, wrapAngle } from '../math';
import type { SimState } from '../state';
import { sampleAt, type TrackHit } from '../track/query';

export interface FollowDriver {
  lane: number;
  speed: number;
}

const look: TrackHit = {
  spline: 0,
  s: 0,
  lateral: 0,
  cx: 0,
  cy: 0,
  cz: 0,
  tx: 0,
  tz: 1,
  width: 10,
  shoulder: 4,
  bank: 0,
  ground: 0,
  surface: 0,
  wallL: true,
  wallR: true,
};

export function driveFollow(sim: SimState, i: number, d: FollowDriver, out: Controls): Controls {
  const cars = sim.cars;
  const speed = Math.hypot(cars.vx[i], cars.vz[i]);
  const sp = sim.track.splines[cars.spline[i]];
  const ahead = 8 + speed * 0.6;
  sampleAt(sp, cars.s[i] + ahead, look);
  const tx = look.cx - look.tz * d.lane;
  const tz = look.cz + look.tx * d.lane;
  const want = Math.atan2(tx - cars.x[i], tz - cars.z[i]);
  const err = wrapAngle(want - cars.h[i]);
  // err > 0: the target is to the left (heading grows to the left), so steer negative.
  out.steer = clamp(-err * 2.2, -1, 1);
  // Slow for corners: how much the road turns over the next stretch.
  sampleAt(sp, cars.s[i] + ahead * 2, look);
  const turn = Math.abs(wrapAngle(Math.atan2(look.tx, look.tz) - cars.h[i]));
  const target = d.speed * clamp(1.2 - turn, 0.45, 1);
  out.throttle = speed < target ? 1 : 0;
  out.brake = speed > target + 4 ? 0.6 : 0;
  out.boost = false;
  out.drift = false;
  out.reset = cars.wreck[i] === 0 && cars.stuckT[i] > 3;
  return out;
}
