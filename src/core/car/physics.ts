// The arcade car (SPEC §9): grip that swings velocity round to the heading, a hold-to-drift with
// an angle band and a three-stage mini-turbo, boost, real air off crests and ramps, and a wreck
// body with aftertouch. One car per call; collisions happen after every car has moved.

import type { Controls } from '../controls';
import { Cause, Ev } from '../events';
import { approach, clamp, damp, lerp, sign, smoothstep, wrapAngle } from '../math';
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
  // The chain's window runs between drifts: out, and the chain pays its pop (two or more).
  if (cars.chainT[i] > 0 && cars.drift[i] !== 1) {
    cars.chainT[i] -= dt;
    if (cars.chainT[i] <= 0) endChain(sim, i);
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
  // Offroad tyres (cls.offroad) win back part of what dirt and grass take.
  const rough = surf.offroad ? (cls.offroad ?? 0) : 0;
  const grip = lerp(surf.grip, 1, rough) * sim.weatherGrip * cls.grip;

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
    if (cars.stallT[i] > 0) cars.stallT[i] -= dt;
    else if (c.throttle > 0) a += fwd < top ? cls.accel * c.throttle * Math.max(0.08, 1 - (fwd / top) ** 2) : -(fwd - top) * 0.8;
    if (boosting && fwd < top) a += T.boostAccel * (1 - fwd / (top * 1.05));
    if (mini) a += T.miniTurboAccel * (cars.miniStage[i] / 3 + 0.34);
    if (c.brake > 0) {
      if (fwd > 0.5) a -= cls.brake * c.brake;
      else if (fwd > -T.reverseSpeed) a -= cls.accel * 0.5 * c.brake;
    }
    a -= T.airDrag * fwd * Math.abs(fwd) + T.rolling * sign(fwd) * Math.min(1, Math.abs(fwd)) + surf.drag * (1 - rough) * fwd;

    // Drift entry.
    const drifting = cars.drift[i] === 1;
    if (!drifting && c.drift && Math.abs(c.steer) > T.driftMinSteer && speed > T.driftMinSpeed && cars.driftCooldown[i] <= 0) {
      cars.drift[i] = 1;
      cars.driftDir[i] = sign(c.steer);
      cars.driftT[i] = 0;
      cars.driftCharge[i] = 0;
      cars.driftStage[i] = 0;
      cars.slip[i] = wrapAngle(h - vdir);
      cars.driftTight[i] = clamp((c.steer * cars.driftDir[i] + 1) / 2, 0, 1);
      cars.driftExit[i] = 0;
      cars.driftBank[i] = 0;
      // Outside a chain's window, this drift starts a new one.
      if (cars.driftChain[i] === 0) cars.chainPts[i] = 0;
      cars.vy[i] = T.driftHop;
      cars.grounded[i] = 0;
      sim.events.push(tick, Ev.DriftStart, i, cars.x[i], cars.y[i], cars.z[i], speed, cars.driftDir[i]);
    }

    if (cars.drift[i] === 1) {
      const dir = cars.driftDir[i];
      // Steering eases the tightness rather than setting it, and the arc builds up after entry:
      // both keep the drift from snapping (playtest).
      const tight = (cars.driftTight[i] = approach(cars.driftTight[i], clamp((c.steer * dir + 1) / 2, 0, 1), T.driftSteerRate * dt));
      const ease = smoothstep(0, T.driftEase, cars.driftT[i]);
      // Turning right lowers the heading (right = (-cos h, sin h)); the nose points into the turn.
      const targetSlip = -dir * lerp(T.driftAngleMin, T.driftAngleMax, tight);
      const arc = -dir * lerp(T.driftArcMin, T.driftArcMax, tight) * ease * (cls.turn / 2.4) * clamp(1.5 - speed / 80, 0.6, 1.2);
      // The body turns with the arc; the assist only closes the angle.
      let slip = wrapAngle(h - vdir);
      vdir += arc * dt;
      // Rate-limited going in, easing out near the target, so the rotation doesn't stop dead.
      const settle = T.driftSettle * cls.driftRotation * surf.looseness ** 0.3 * dt;
      slip = approach(slip, targetSlip, Math.min(settle, Math.abs(targetSlip - slip) * damp(5, dt)));
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
      if (T.miniTurbo) cars.driftCharge[i] += dt * angleFrac * pace * surf.driftCharge * cls.drift;
      const stage = cars.driftCharge[i] >= T.driftStages[2] ? 3 : cars.driftCharge[i] >= T.driftStages[1] ? 2 : cars.driftCharge[i] >= T.driftStages[0] ? 1 : 0;
      if (stage > cars.driftStage[i]) {
        cars.driftStage[i] = stage;
        sim.events.push(tick, Ev.DriftStage, i, cars.x[i], cars.y[i], cars.z[i], cars.driftT[i], stage);
      }
      cars.driftBank[i] += T.boostFromDrift * angleFrac * pace * surf.driftCharge * cls.drift * dt * chainBoost(cars.driftChain[i]);
      const pts = T.driftPoints * angleFrac * pace * dt * (1 + cars.driftChain[i] * T.chainPoints);
      cars.score[i] += pts;
      cars.chainPts[i] += pts;
      if (Math.abs(slip) > T.spinAngle) spinOut(sim, i);
      else if (!c.drift || speed < 10) endDrift(sim, i, c.drift ? 0 : cars.driftStage[i]);
    } else {
      // Normal grip: yaw from steering, velocity swings round toward the heading. Just out of a
      // drift, grip comes back gradually (1 → 0 over driftExit), so the car carries its slide.
      if (cars.driftExit[i] > 0) cars.driftExit[i] = Math.max(0, cars.driftExit[i] - dt);
      // driftCarry (per car) stretches all of it: longer, looser and slower to straighten.
      const carry = cls.driftCarry ?? 1;
      const exit = smoothstep(0, 1, cars.driftExit[i] / (T.driftExit * carry));
      const falloff = speed / T.steerFalloff;
      let yawTarget = -c.steer * cls.turn * clamp(Math.abs(fwd) / 6, 0, 1) / (1 + falloff * falloff * 0.9);
      if (fwd < -0.5) yawTarget = -yawTarget;
      cars.yaw[i] = approach(cars.yaw[i], yawTarget, T.steerResponse * dt * cls.turn * lerp(1, 0.25, exit));
      h += cars.yaw[i] * dt;
      // Recovering: the nose swings back toward the travel as well, so the car keeps going the way
      // the slide was taking it instead of whipping round to where it pointed.
      if (exit > 0 && speed > 3) h = vdir + approach(wrapAngle(h - vdir), 0, (T.driftExitStraighten / carry) * exit * dt);
      const slip = wrapAngle(h - vdir);
      // Reversing, or about to: brake held from a standstill backs the car up (else the grip snap
      // below keeps it pointing forward and it never moves).
      const reversing = fwd < -0.5 || (fwd <= 0.5 && c.brake > 0 && c.throttle === 0);
      const target = reversing ? wrapAngle(h + Math.PI) : h;
      const off = wrapAngle(target - vdir);
      const align = T.gripAlign * grip * lerp(1, T.driftExitGrip / carry, exit) * dt;
      const turnBy = clamp(off, -align, align);
      vdir += speed > 0.5 ? turnBy : off;
      speed *= 1 - Math.min(0.5, Math.abs(reversing ? 0 : slip) * T.slipScrub * lerp(1, T.driftExitScrub, exit) * dt);
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
    if (cars.boosting[i]) cars.superT[i] += dt;
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
      cars.superT[i] = 0;
      sim.events.push(sim.tick, Ev.Takeoff, i, cars.x[i], cars.y[i], cars.z[i], Math.hypot(cars.vx[i], cars.vz[i]));
    }
    cars.grounded[i] = 0;
    cars.y[i] = yBall;
    cars.vy[i] = vyBall;
  } else {
    if (!wasGrounded) {
      const air = cars.airT[i];
      sim.events.push(sim.tick, Ev.Land, i, cars.x[i], ground, cars.z[i], air, -vyBall);
      // A clean landing after real air time pays.
      if (air >= T.airMin && !cars.wreck[i]) {
        // Boosted through the air: a Superman, paid extra (`other` 1 on the event says so).
        const superman = cars.superT[i] >= T.supermanMin;
        const paid = earnBoost(sim, i, T.boostFromAir * air * (superman ? T.supermanPay : 1));
        cars.score[i] += Math.round(T.airPoints * air * (superman ? T.supermanPay : 1));
        sim.events.push(sim.tick, Ev.AirBoost, i, cars.x[i], ground, cars.z[i], paid, air, superman ? 1 : 0);
      }
      cars.airT[i] = 0;
      cars.superT[i] = 0;
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
  cars.driftExit[i] = T.driftExit * (sim.classes[cars.cls[i]].driftCarry ?? 1);
  // A clean finish pays the drift's banked boost into the meter.
  const bank = cars.driftBank[i];
  cars.driftBank[i] = 0;
  if (bank >= T.driftBankMin && cars.boost[i] < 1) {
    const paid = earnBoost(sim, i, bank);
    sim.events.push(sim.tick, Ev.DriftBoost, i, cars.x[i], cars.y[i], cars.z[i], paid);
  }
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

/**
 * Ends a drift with nothing paid: the bank and the chain are lost (a spin-out, a wreck, a wall).
 * The cooldown stops a held drift button from starting another one on the next tick.
 */
export function cancelDrift(sim: SimState, i: number): void {
  const cars = sim.cars;
  // Mid-chain (a second drift on, or in the window after one), the chain is lost with it.
  const drifts = cars.driftChain[i] + (cars.drift[i] === 1 ? 1 : 0);
  if (drifts >= 2 && (cars.drift[i] === 1 || cars.chainT[i] > 0)) sim.events.push(sim.tick, Ev.ChainLost, i, cars.x[i], cars.y[i], cars.z[i], cars.chainPts[i], drifts);
  cars.driftBank[i] = 0;
  endDrift(sim, i, 0);
  cars.driftChain[i] = 0;
  cars.chainT[i] = 0;
  cars.chainPts[i] = 0;
}

/** A drift's banked boost multiplier with `links` drifts before it in the chain. */
export const chainBoost = (links: number): number => Math.min(T.chainBoostMax, 1 + links * T.chainBoost);

/** A chain's time between drifts ran out: two drifts or more pay their pop; either way it's over. */
function endChain(sim: SimState, i: number): void {
  const cars = sim.cars;
  if (cars.driftChain[i] >= 2) sim.events.push(sim.tick, Ev.DriftChain, i, cars.x[i], cars.y[i], cars.z[i], cars.chainPts[i], cars.driftChain[i]);
  cars.driftChain[i] = 0;
  cars.chainT[i] = 0;
}

/** Who hit car i within the last `ticks` ticks, or -1: the credit for a takedown. */
export function recentAttacker(sim: SimState, i: number, ticks: number): number {
  const cars = sim.cars;
  return cars.lastHitT[i] > 0 && sim.tick - cars.lastHitT[i] < ticks ? cars.lastHitBy[i] : -1;
}

function spinOut(sim: SimState, i: number): void {
  const cars = sim.cars;
  cancelDrift(sim, i);
  cars.spinT[i] = T.spinTime;
  cars.driftExit[i] = 0;
  cars.yaw[i] = sign(cars.slip[i]) * 5;
  sim.events.push(sim.tick, Ev.SpinOut, i, cars.x[i], cars.y[i], cars.z[i]);
}

/** Turns a car into a wreck body. `ix, iz` is the impact velocity change, `by` who did it (-1: nobody). */
export function wreckCar(sim: SimState, i: number, cause: number, ix: number, iz: number, by: number): void {
  const cars = sim.cars;
  if (cars.wreck[i]) return;
  cancelDrift(sim, i);
  cars.boosting[i] = 0;
  cars.miniT[i] = 0;
  cars.wreck[i] = 1;
  cars.wreckT[i] = 0;
  cars.wreckCause[i] = cause;
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
  cars.wrecks[i]++;
  sim.events.push(sim.tick, Ev.Wreck, i, cars.x[i], cars.y[i], cars.z[i], Math.hypot(ix, iz), cause, by);
  if (by >= 0 && by !== i && cause !== Cause.Reset) {
    // A takedown: boost for the attacker (TUNING.takedownBoost), points, and "revenge" on whoever last got them.
    const revenge = cars.lastTakenBy[by] === i + 1;
    if (revenge) cars.lastTakenBy[by] = 0;
    cars.lastTakenBy[i] = by + 1;
    cars.takedowns[by]++;
    cars.boost[by] = Math.min(1, cars.boost[by] + T.takedownBoost);
    const pts = T.takedownPoints * (revenge ? 1.5 : 1);
    cars.score[by] += pts;
    sim.events.push(sim.tick, Ev.Takedown, by, cars.x[i], cars.y[i], cars.z[i], pts, revenge ? 1 : 0, i);
  }
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

/**
 * Adds boost earned by a move (a drift, air, a near miss), scaled by race position (TUNING
 * boostPlaceLead…boostPlaceLast) while racing, and capped at a full meter; returns what was paid.
 */
export function earnBoost(sim: SimState, i: number, amount: number): number {
  const cars = sim.cars;
  let scale = 1;
  if (sim.race.phase === 'racing' && !cars.finished[i]) {
    let n = 0;
    for (let k = 0; k < cars.count; k++) if (cars.active[k]) n++;
    if (n > 1) scale = lerp(T.boostPlaceLead, T.boostPlaceLast, clamp(cars.rank[i] / (n - 1), 0, 1));
  }
  const paid = Math.max(0, Math.min(amount * scale, 1 - cars.boost[i]));
  cars.boost[i] += paid;
  return paid;
}

/** Pays a wrecked car's catch-up boost (see TUNING.respawnBoost); returns how much. */
function catchUp(sim: SimState, i: number): number {
  const cars = sim.cars;
  if (sim.race.phase !== 'racing' || cars.finished[i] || cars.wreckCause[i] === Cause.Reset) return 0;
  let lead = cars.progress[i];
  for (let k = 0; k < cars.count; k++) if (cars.active[k] && cars.progress[k] > lead) lead = cars.progress[k];
  const behind = clamp((lead - cars.progress[i]) / T.respawnBoostGap, 0, 1);
  const paid = Math.max(0, Math.min(T.respawnBoost + behind * T.respawnBoostBehind, 1 - cars.boost[i]));
  cars.boost[i] += paid;
  return paid;
}

export function respawn(sim: SimState, i: number): void {
  const cars = sim.cars;
  const sp = sim.track.splines[cars.lastSpline[i]];
  const at = sampleAt(sp, cars.lastS[i], sim.hitA);
  const half = at.width / 2 - 2;
  let lat = clamp(cars.lastLat[i], -half, half);
  // Not on top of a pillar: step sideways until clear of every solid prop nearby.
  for (let tries = 0; tries < 4; tries++) {
    let blocked = false;
    for (const pr of sim.track.props) {
      if (pr.solid && pr.spline === sp.index && Math.abs(pr.s - at.s) < 20 && Math.abs(pr.lateral - lat) < Math.max(pr.hx, pr.hz) + 2.5) blocked = true;
    }
    if (!blocked) break;
    lat = clamp(lat + (lat >= 0 ? 1 : -1) * 3, -half, half);
  }
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
  cars.driftExit[i] = 0;
  cars.slip[i] = 0;
  cars.spline[i] = sp.index;
  cars.s[i] = at.s;
  cars.ghostT[i] = T.ghostTime;
  cars.resetCooldown[i] = T.resetCooldown;
  // Not still stuck, nor backing out, nor holding a line from before the wreck.
  cars.stuckT[i] = cars.aiBack[i] = cars.aiHold[i] = 0;
  // No interpolation across the teleport.
  cars.px[i] = cars.x[i];
  cars.py[i] = cars.y[i];
  cars.pz[i] = cars.z[i];
  cars.ph[i] = cars.h[i];
  cars.prx[i] = cars.prz[i] = 0;
  sim.events.push(sim.tick, Ev.Respawn, i, cars.x[i], cars.y[i], cars.z[i], catchUp(sim, i));
}
