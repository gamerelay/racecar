// The arcade car (SPEC §9): grip that swings velocity round to the heading, a hold-to-drift with
// an angle band and a three-stage mini-turbo, boost, real air off crests and ramps, and a wreck
// body with aftertouch. One car per call; collisions happen after every car has moved.

import type { Controls } from '../controls';
import { Cause, Ev } from '../events';
import { approach, clamp, damp, lerp, sign, wrapAngle } from '../math';
import type { SimState } from '../state';
import { locateCar } from '../track/locate';
import { sampleAt } from '../track/query';
import { TUNING as T } from './tuning';

export function stepCar(sim: SimState, i: number, c: Controls, dt: number): void {
  const cars = sim.cars;
  const tick = sim.tick;
  cars.px[i] = cars.x[i];
  cars.py[i] = cars.y[i];
  cars.pz[i] = cars.z[i];
  cars.ph[i] = cars.h[i];
  cars.ppitch[i] = cars.pitch[i];
  cars.proll[i] = cars.roll[i];
  cars.prx[i] = cars.rx[i];
  cars.prz[i] = cars.rz[i];

  if (cars.ghostT[i] > 0) cars.ghostT[i] = Math.max(0, cars.ghostT[i] - dt);
  if (cars.resetCooldown[i] > 0) cars.resetCooldown[i] -= dt;
  if (cars.driftCooldown[i] > 0) cars.driftCooldown[i] -= dt;
  if (cars.wallT[i] > 0) cars.wallT[i] -= dt;
  if (cars.chainT[i] > 0) {
    cars.chainT[i] -= dt;
    if (cars.chainT[i] <= 0) cars.driftChain[i] = 0;
  }

  if (cars.wreck[i]) {
    stepWreck(sim, i, c, dt);
    return;
  }
  if (c.reset && cars.resetCooldown[i] <= 0) {
    wreckCar(sim, i, Cause.Reset, 0, 0, -1);
    return;
  }

  const cls = sim.classes[cars.cls[i]];
  // Stuck: flooring it and going nowhere (drivers use this to reset).
  if (c.throttle > 0.5 && Math.hypot(cars.vx[i], cars.vz[i]) < 2) cars.stuckT[i] += dt;
  else cars.stuckT[i] = 0;
  locateCar(sim, i);
  const surf = sim.surfaces[cars.surface[i]];
  const grip = surf.grip * sim.weatherGrip * cls.grip;

  let vx = cars.vx[i];
  let vz = cars.vz[i];
  let h = cars.h[i];
  let speed = Math.hypot(vx, vz);
  let vdir = speed > 0.5 ? Math.atan2(vx, vz) : h;
  const fx = Math.sin(h);
  const fz = Math.cos(h);
  const fwd = vx * fx + vz * fz;
  const grounded = cars.grounded[i] === 1;

  // Boost and mini-turbo.
  const wantBoost = c.boost && cars.boost[i] > 0.001;
  if (wantBoost !== (cars.boosting[i] === 1)) {
    cars.boosting[i] = wantBoost ? 1 : 0;
    sim.events.push(tick, wantBoost ? Ev.BoostStart : Ev.BoostEnd, i, cars.x[i], cars.y[i], cars.z[i]);
  }
  if (wantBoost) cars.boost[i] = Math.max(0, cars.boost[i] - dt / cls.boostCapacity);
  if (cars.miniT[i] > 0) cars.miniT[i] = Math.max(0, cars.miniT[i] - dt);
  const boosting = cars.boosting[i] === 1;
  const mini = cars.miniT[i] > 0;
  const top = cls.topSpeed * (boosting ? T.boostTop : 1) * (mini ? T.miniTurboTop : 1);

  // Spin-out: no control until it settles.
  if (cars.spinT[i] > 0) {
    cars.spinT[i] -= dt;
    cars.yaw[i] *= 1 - damp(1.5, dt);
    h += cars.yaw[i] * dt;
    const k = 1 - damp(1.8, dt);
    vx *= k;
    vz *= k;
  } else if (grounded) {
    // Longitudinal.
    let a = 0;
    if (c.throttle > 0) a += fwd < top ? cls.accel * c.throttle * Math.max(0.08, 1 - (fwd / top) ** 2) : -(fwd - top) * 0.8;
    if (boosting && fwd < top) a += T.boostAccel * (1 - fwd / (top * 1.05));
    if (mini) a += T.miniTurboAccel * (cars.miniStage[i] / 3 + 0.34);
    if (c.brake > 0) {
      if (fwd > 0.5) a -= cls.brake * c.brake;
      else if (fwd > -T.reverseSpeed) a -= cls.accel * 0.5 * c.brake;
    }
    a -= T.airDrag * fwd * Math.abs(fwd) + T.rolling * sign(fwd) * Math.min(1, Math.abs(fwd)) + surf.drag * fwd;

    // Drift entry.
    const drifting = cars.drift[i] === 1;
    if (!drifting && c.drift && Math.abs(c.steer) > T.driftMinSteer && speed > T.driftMinSpeed && cars.driftCooldown[i] <= 0) {
      cars.drift[i] = 1;
      cars.driftDir[i] = sign(c.steer);
      cars.driftT[i] = 0;
      cars.driftCharge[i] = 0;
      cars.driftStage[i] = 0;
      cars.slip[i] = wrapAngle(h - vdir);
      cars.vy[i] = T.driftHop;
      cars.grounded[i] = 0;
      sim.events.push(tick, Ev.DriftStart, i, cars.x[i], cars.y[i], cars.z[i], speed, cars.driftDir[i]);
    }

    if (cars.drift[i] === 1) {
      const dir = cars.driftDir[i];
      const tight = clamp((c.steer * dir + 1) / 2, 0, 1);
      // Turning right lowers the heading (right = (-cos h, sin h)); the nose points into the turn.
      const targetSlip = -dir * lerp(T.driftAngleMin, T.driftAngleMax, tight);
      const arc = -dir * lerp(T.driftArcMin, T.driftArcMax, tight) * (cls.turn / 2.4) * clamp(1.5 - speed / 80, 0.6, 1.2);
      vdir += arc * dt;
      let slip = wrapAngle(h - vdir);
      slip = approach(slip, targetSlip, T.driftSettle * cls.driftRotation * surf.looseness ** 0.3 * dt);
      const newH = vdir + slip;
      cars.yaw[i] = wrapAngle(newH - h) / dt;
      h = newH;
      cars.slip[i] = slip;
      // Keep the speed along the arc; throttle holds it, the angle scrubs it.
      speed = Math.max(0, speed + (a * 0.8 - speed * T.driftScrub * Math.abs(slip)) * dt);
      vx = Math.sin(vdir) * speed;
      vz = Math.cos(vdir) * speed;
      // Charge, points, boost.
      // Normalized so a full-angle drift at 40 m/s in a reference car reaches the stages on time.
      const angleFrac = Math.min(1, Math.abs(slip) / T.driftAngleMax);
      const pace = clamp(speed / 40, 0.5, 1);
      cars.driftT[i] += dt;
      cars.driftCharge[i] += dt * angleFrac * pace * surf.driftCharge * cls.drift;
      const stage = cars.driftCharge[i] >= T.driftStages[2] ? 3 : cars.driftCharge[i] >= T.driftStages[1] ? 2 : cars.driftCharge[i] >= T.driftStages[0] ? 1 : 0;
      if (stage > cars.driftStage[i]) {
        cars.driftStage[i] = stage;
        sim.events.push(tick, Ev.DriftStage, i, cars.x[i], cars.y[i], cars.z[i], cars.driftT[i], stage);
      }
      cars.boost[i] = Math.min(1, cars.boost[i] + T.boostFromDrift * dt);
      cars.score[i] += T.driftPoints * angleFrac * pace * dt * (1 + cars.driftChain[i] * 0.25);
      if (Math.abs(slip) > T.spinAngle) spinOut(sim, i);
      else if (!c.drift || speed < 10) endDrift(sim, i, c.drift ? 0 : cars.driftStage[i]);
    } else {
      // Normal grip: yaw from steering, velocity swings round toward the heading.
      const falloff = speed / T.steerFalloff;
      let yawTarget = -c.steer * cls.turn * clamp(Math.abs(fwd) / 6, 0, 1) / (1 + falloff * falloff * 0.9);
      if (fwd < -0.5) yawTarget = -yawTarget;
      cars.yaw[i] = approach(cars.yaw[i], yawTarget, T.steerResponse * dt * cls.turn);
      h += cars.yaw[i] * dt;
      const slip = wrapAngle(h - vdir);
      const reversing = fwd < -0.5;
      const target = reversing ? wrapAngle(h + Math.PI) : h;
      const off = wrapAngle(target - vdir);
      const turnBy = clamp(off, -T.gripAlign * grip * dt, T.gripAlign * grip * dt);
      vdir += speed > 0.5 ? turnBy : off;
      speed *= 1 - Math.min(0.5, Math.abs(reversing ? 0 : slip) * T.slipScrub * dt);
      cars.slip[i] = reversing ? 0 : slip;
      vx = Math.sin(vdir) * speed;
      vz = Math.cos(vdir) * speed;
      // Engine and brakes push along the heading.
      vx += Math.sin(h) * a * dt;
      vz += Math.cos(h) * a * dt;
    }
  } else {
    // In the air: a little yaw control, no traction.
    cars.yaw[i] = approach(cars.yaw[i], -c.steer * 0.8, 3 * dt);
    h += cars.yaw[i] * dt;
    cars.airT[i] += dt;
    cars.boost[i] = Math.min(1, cars.boost[i] + T.boostFromAir * dt);
    if (cars.drift[i] === 1) {
      // The hop at the start of a drift: keep the drift going through it.
      cars.driftT[i] += dt;
    }
  }

  cars.h[i] = wrapAngle(h);
  cars.vx[i] = vx;
  cars.vz[i] = vz;
  cars.x[i] += vx * dt;
  cars.z[i] += vz * dt;
  followGround(sim, i, dt);
}

/** Keeps a grounded car on the road, or launches it when the road falls away faster than gravity. */
function followGround(sim: SimState, i: number, dt: number): void {
  const cars = sim.cars;
  const hit = locateCar(sim, i);
  const ground = hit.ground;
  const wasGrounded = cars.grounded[i] === 1;
  const vyBall = cars.vy[i] - T.gravity * dt;
  const yBall = cars.y[i] + vyBall * dt;
  if (yBall > ground + 0.02) {
    if (wasGrounded) {
      cars.airT[i] = 0;
      sim.events.push(sim.tick, Ev.Takeoff, i, cars.x[i], cars.y[i], cars.z[i], Math.hypot(cars.vx[i], cars.vz[i]));
    }
    cars.grounded[i] = 0;
    cars.y[i] = yBall;
    cars.vy[i] = vyBall;
  } else {
    if (!wasGrounded) {
      sim.events.push(sim.tick, Ev.Land, i, cars.x[i], ground, cars.z[i], cars.airT[i], -vyBall);
      cars.airT[i] = 0;
    }
    cars.grounded[i] = 1;
    cars.vy[i] = (ground - cars.y[i]) / dt;
    // A hard landing can't launch you again next tick.
    if (cars.vy[i] > 8) cars.vy[i] = 8;
    cars.y[i] = ground;
  }
  // Body pitch and roll follow the road (for the camera and render).
  const ahead = sim.hitB;
  const sp = sim.track.splines[hit.spline];
  sampleAt(sp, hit.s + 2, ahead);
  const aheadY = ahead.cy;
  sampleAt(sp, hit.s - 2, ahead);
  const slope = (aheadY - ahead.cy) / 4;
  const rel = cars.h[i] - Math.atan2(hit.tx, hit.tz);
  const targetPitch = cars.grounded[i] ? -Math.atan(slope) * Math.cos(rel) : cars.pitch[i];
  const targetRoll = cars.grounded[i] ? hit.bank * Math.cos(rel) : cars.roll[i];
  cars.pitch[i] += (targetPitch - cars.pitch[i]) * damp(12, dt);
  cars.roll[i] += (targetRoll - cars.roll[i]) * damp(12, dt);
  // Remember the last good spot for respawns.
  if (cars.grounded[i] && Math.abs(hit.lateral) < hit.width / 2 && cars.spinT[i] <= 0) {
    cars.lastSpline[i] = hit.spline;
    cars.lastS[i] = hit.s;
    cars.lastLat[i] = hit.lateral;
  }
  if (Math.abs(hit.lateral) > hit.width / 2 + hit.shoulder + T.outOfBounds || cars.y[i] < ground - 20) {
    wreckCar(sim, i, Cause.OutOfBounds, 0, 0, -1);
    // Nothing to watch: respawn after a second.
    cars.wreckT[i] = T.wreckTime - 1;
  }
}

export function endDrift(sim: SimState, i: number, stage: number): void {
  const cars = sim.cars;
  if (cars.drift[i] !== 1) return;
  cars.drift[i] = 0;
  cars.driftCooldown[i] = 0.15;
  sim.events.push(sim.tick, Ev.DriftEnd, i, cars.x[i], cars.y[i], cars.z[i], cars.driftT[i], stage);
  if (stage > 0) {
    cars.miniT[i] = T.miniTurboTimes[stage];
    cars.miniStage[i] = stage;
    sim.events.push(sim.tick, Ev.MiniTurbo, i, cars.x[i], cars.y[i], cars.z[i], T.miniTurboTimes[stage], stage);
  }
  if (stage > 0 || cars.driftT[i] > 0.6) {
    cars.driftChain[i] += 1;
    cars.chainT[i] = T.chainWindow;
  }
}

function spinOut(sim: SimState, i: number): void {
  const cars = sim.cars;
  endDrift(sim, i, 0);
  cars.driftChain[i] = 0;
  cars.spinT[i] = T.spinTime;
  cars.yaw[i] = sign(cars.slip[i]) * 5;
  sim.events.push(sim.tick, Ev.SpinOut, i, cars.x[i], cars.y[i], cars.z[i]);
}

/** Turns a car into a wreck body. `ix, iz` is the impact velocity change, `by` who did it (-1: nobody). */
export function wreckCar(sim: SimState, i: number, cause: number, ix: number, iz: number, by: number): void {
  const cars = sim.cars;
  if (cars.wreck[i]) return;
  endDrift(sim, i, 0);
  cars.driftChain[i] = 0;
  cars.boosting[i] = 0;
  cars.miniT[i] = 0;
  cars.wreck[i] = 1;
  cars.wreckT[i] = 0;
  cars.grounded[i] = 0;
  const r = sim.rng;
  const hard = cause === Cause.Wall || cause === Cause.Car;
  cars.vx[i] = cars.vx[i] * (hard ? 0.55 : 0.3) + ix;
  cars.vz[i] = cars.vz[i] * (hard ? 0.55 : 0.3) + iz;
  cars.vy[i] = hard ? r.range(6, 10) : 2;
  cars.wx[i] = r.range(-5, 5);
  cars.wy[i] = r.range(-3, 3);
  cars.wz[i] = r.range(-7, 7);
  if (by >= 0) {
    cars.lastHitBy[i] = by;
    cars.lastHitT[i] = sim.tick;
  }
  sim.events.push(sim.tick, Ev.Wreck, i, cars.x[i], cars.y[i], cars.z[i], Math.hypot(ix, iz), cause, by);
}

function stepWreck(sim: SimState, i: number, c: Controls, dt: number): void {
  const cars = sim.cars;
  // Online, the wreck itself runs slow for everyone (SPEC §2, "Loop"); in single player the world slows instead.
  const scale = sim.slowmo === 'wreck' && cars.wreckT[i] < T.wreckSlowTime ? T.wreckSlowScale : 1;
  const wdt = dt * scale;
  cars.wreckT[i] += dt;
  const hit = locateCar(sim, i);
  // Aftertouch: steer the wreck sideways.
  const speed = Math.hypot(cars.vx[i], cars.vz[i]);
  if (speed > 1) {
    const k = (c.steer * T.aftertouch * wdt) / speed;
    const vx = cars.vx[i];
    cars.vx[i] += -cars.vz[i] * k;
    cars.vz[i] += vx * k;
  }
  cars.vy[i] -= T.gravity * wdt;
  cars.x[i] += cars.vx[i] * wdt;
  cars.y[i] += cars.vy[i] * wdt;
  cars.z[i] += cars.vz[i] * wdt;
  cars.h[i] = wrapAngle(cars.h[i] + cars.wy[i] * wdt);
  cars.rx[i] += cars.wx[i] * wdt;
  cars.rz[i] += cars.wz[i] * wdt;
  const floor = hit.ground + 0.5;
  if (cars.y[i] < floor) {
    cars.y[i] = floor;
    if (cars.vy[i] < 0) cars.vy[i] *= -0.35;
    const k = 0.8;
    cars.vx[i] *= k;
    cars.vz[i] *= k;
    cars.wx[i] *= 0.75;
    cars.wy[i] *= 0.75;
    cars.wz[i] *= 0.75;
  }
  if (cars.wreckT[i] >= T.wreckTime) respawn(sim, i);
}

export function respawn(sim: SimState, i: number): void {
  const cars = sim.cars;
  const sp = sim.track.splines[cars.lastSpline[i]];
  const at = sampleAt(sp, cars.lastS[i], sim.hitA);
  const half = at.width / 2 - 2;
  const lat = clamp(cars.lastLat[i], -half, half);
  // right = (-tz, tx)
  cars.x[i] = at.cx - at.tz * lat;
  cars.z[i] = at.cz + at.tx * lat;
  cars.y[i] = at.cy;
  cars.h[i] = Math.atan2(at.tx, at.tz);
  cars.vx[i] = at.tx * T.respawnSpeed;
  cars.vz[i] = at.tz * T.respawnSpeed;
  cars.vy[i] = 0;
  cars.yaw[i] = 0;
  cars.rx[i] = cars.rz[i] = 0;
  cars.wx[i] = cars.wy[i] = cars.wz[i] = 0;
  cars.pitch[i] = cars.roll[i] = 0;
  cars.wreck[i] = 0;
  cars.wreckT[i] = 0;
  cars.spinT[i] = 0;
  cars.grounded[i] = 1;
  cars.drift[i] = 0;
  cars.slip[i] = 0;
  cars.spline[i] = sp.index;
  cars.s[i] = at.s;
  cars.ghostT[i] = T.ghostTime;
  cars.resetCooldown[i] = T.resetCooldown;
  // No interpolation across the teleport.
  cars.px[i] = cars.x[i];
  cars.py[i] = cars.y[i];
  cars.pz[i] = cars.z[i];
  cars.ph[i] = cars.h[i];
  cars.prx[i] = cars.prz[i] = 0;
  sim.events.push(sim.tick, Ev.Respawn, i, cars.x[i], cars.y[i], cars.z[i]);
}
