// Car against car: boxes from the grid, pushed apart by mass, an impulse along the contact normal,
// and the takedown rule (SPEC §9): the car being hit wrecks when the closing speed is high enough
// (lower if the attacker is boosting or heavier), or when it's shoved into a wall.

import { wreckCar } from '../car/physics';
import { TUNING as T } from '../car/tuning';
import { Cause, Ev } from '../events';
import type { SimState } from '../state';
import { newContact, obbOverlap } from './obb';
import type { SpatialGrid } from './grid';

const contact = newContact();
const near = new Int32Array(64);

export function collideCars(sim: SimState, grid: SpatialGrid): void {
  const cars = sim.cars;
  for (let a = 0; a < cars.count; a++) {
    if (!cars.active[a] || cars.ghostT[a] > 0) continue;
    const n = grid.near(cars.x[a], cars.z[a], near);
    for (let k = 0; k < n; k++) {
      const b = near[k];
      if (b <= a || !cars.active[b] || cars.ghostT[b] > 0) continue;
      // Two other players' cars touching is for their screens to settle.
      if (cars.remote[a] && cars.remote[b]) continue;
      if (Math.abs(cars.y[a] - cars.y[b]) > 1.6) continue;
      const ca = sim.classes[cars.cls[a]];
      const cb = sim.classes[cars.cls[b]];
      if (!obbOverlap(cars.x[a], cars.z[a], cars.h[a], ca.size[0], ca.size[1], cars.x[b], cars.z[b], cars.h[b], cb.size[0], cb.size[1], contact)) continue;
      resolve(sim, a, b, ca.mass, cb.mass);
    }
  }
}

function resolve(sim: SimState, a: number, b: number, ma: number, mb: number): void {
  const cars = sim.cars;
  const { nx, nz, depth } = contact;
  const ia = 1 / ma;
  const ib = 1 / mb;
  // Another player's car stays where they say it is: yours takes all of the push apart (and only
  // its own share of the bump: theirs is on their screen).
  const wa = cars.remote[a] ? 0 : cars.remote[b] ? 1 : ia / (ia + ib);
  const wb = cars.remote[a] ? 1 : cars.remote[b] ? 0 : ib / (ia + ib);
  cars.x[a] -= nx * depth * wa;
  cars.z[a] -= nz * depth * wa;
  cars.x[b] += nx * depth * wb;
  cars.z[b] += nz * depth * wb;

  // Closing speed along the normal (a toward b).
  const vna = cars.vx[a] * nx + cars.vz[a] * nz;
  const vnb = cars.vx[b] * nx + cars.vz[b] * nz;
  const closing = vna - vnb;
  if (closing <= 0) return;
  const j = ((1 + T.carRestitution) * closing) / (ia + ib);
  // Side swipes shove harder sideways, which is what knocks cars into walls.
  if (!cars.remote[a]) {
    cars.vx[a] -= j * ia * nx;
    cars.vz[a] -= j * ia * nz;
  }
  if (!cars.remote[b]) {
    cars.vx[b] += j * ib * nx;
    cars.vz[b] += j * ib * nz;
  }
  const tick = sim.tick;
  // Who hit whom: the one moving into the other harder is the attacker.
  const aAttacks = vna > -vnb;
  // b: which was the attacker (1 car a, 2 the other), and the impulse, for the net layer (net/contact.ts).
  if (closing > 1.5) sim.events.push(tick, Ev.CarContact, a, contact.x, (cars.y[a] + cars.y[b]) / 2 + 0.5, contact.z, closing, aAttacks ? 1 : 2, b);
  cars.lastHitBy[a] = b;
  cars.lastHitT[a] = tick;
  cars.lastHitBy[b] = a;
  cars.lastHitT[b] = tick;
  const s = aAttacks ? 1 : -1;
  takedownCheck(sim, aAttacks ? a : b, aAttacks ? b : a, closing, nx * s, nz * s);
}

/**
 * The takedown rule: car `att` hit car `vic` at `closing` m/s along (nx, nz) (from the attacker to
 * the victim). Wrecks the victim if that's hard enough (less if the attacker boosts, drifts or is
 * heavier), or if it's shoved into a wall. Another player's car wrecks on their screen, not here
 * (SPEC §10: the victim decides): online, their screen runs this on a bump it didn't see itself.
 */
export function takedownCheck(sim: SimState, att: number, vic: number, closing: number, nx: number, nz: number): void {
  const cars = sim.cars;
  if (cars.wreck[vic] || cars.remote[vic]) return;
  const mAtt = sim.classes[cars.cls[att]].mass;
  const mVic = sim.classes[cars.cls[vic]].mass;
  let threshold = cars.boosting[att] ? T.takedownBoosting : T.takedown;
  threshold *= Math.sqrt(mVic / mAtt);
  // A drift through a pack hits like a heavier car.
  if (cars.drift[att]) threshold /= 1.3;
  const shovedIntoWall = cars.wallT[vic] > 0 && closing > threshold * 0.5;
  if (closing > threshold || shovedIntoWall) wreckCar(sim, vic, Cause.Car, nx * closing * 0.4, nz * closing * 0.4, att);
}
