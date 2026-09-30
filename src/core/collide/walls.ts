// Walls run along both edges of every spline, a shoulder's width beyond the road, except where the
// layout opens a gap (and where branches leave and rejoin). A car's reach toward a wall is its
// box's lateral extent, so a car sliding sideways hits sooner than one driving straight.

import { wreckCar } from '../car/physics';
import { TUNING as T } from '../car/tuning';
import { Cause, Ev } from '../events';
import type { SimState } from '../state';
import { sampleAt } from '../track/query';

export function collideWalls(sim: SimState, i: number): void {
  const cars = sim.cars;
  if (cars.junctionFree[i]) return;
  const sp = sim.track.splines[cars.spline[i]];
  const hit = sampleAt(sp, cars.s[i], sim.hitA);
  const cls = sim.classes[cars.cls[i]];
  const rel = cars.h[i] - Math.atan2(hit.tx, hit.tz);
  const reach = Math.abs(Math.cos(rel)) * cls.size[0] + Math.abs(Math.sin(rel)) * cls.size[1];
  const wall = hit.width / 2 + hit.shoulder;
  // Lateral measured fresh: the car moved since it was located this tick.
  const lat = (cars.x[i] - hit.cx) * -hit.tz + (cars.z[i] - hit.cz) * hit.tx;
  let side = 0;
  if (lat + reach > wall && hit.wallR) side = 1;
  else if (lat - reach < -wall && hit.wallL) side = -1;
  if (side === 0) return;
  // Only when grounded-ish: flying well above the wall top (1.2 m) clears it.
  if (cars.y[i] > hit.cy + 1.2 + 0.5) return;

  const depth = side > 0 ? lat + reach - wall : -wall - (lat - reach);
  // Outward direction (toward the wall), world space: side · right, right = (-tz, tx).
  const ox = -hit.tz * side;
  const oz = hit.tx * side;
  cars.x[i] -= ox * depth;
  cars.z[i] -= oz * depth;
  const vOut = cars.vx[i] * ox + cars.vz[i] * oz;
  if (vOut <= 0) return;
  // Bounce the normal part, scrape the tangential part.
  cars.vx[i] -= (1 + T.wallRestitution) * vOut * ox;
  cars.vz[i] -= (1 + T.wallRestitution) * vOut * oz;
  const scrape = 1 - T.wallScrape * Math.min(1, vOut / 10);
  cars.vx[i] *= scrape;
  cars.vz[i] *= scrape;
  const fresh = cars.wallT[i] <= 0;
  cars.wallT[i] = 0.3;
  if (cars.wreck[i]) {
    cars.wy[i] *= -0.6;
    return;
  }
  const px = cars.x[i] + ox * reach;
  const pz = cars.z[i] + oz * reach;
  // One event per knock, not one per tick of grinding along the wall.
  if (vOut > 2 || (fresh && vOut > 0.5)) sim.events.push(sim.tick, Ev.WallHit, i, px, cars.y[i] + 0.5, pz, vOut, side);
  if (cars.drift[i] && vOut > 6) {
    cars.drift[i] = 0;
    cars.driftChain[i] = 0;
    sim.events.push(sim.tick, Ev.DriftEnd, i, cars.x[i], cars.y[i], cars.z[i], cars.driftT[i], 0);
  }
  if (vOut > T.wallWreck && cars.ghostT[i] <= 0) {
    const by = cars.lastHitT[i] > 0 && sim.tick - cars.lastHitT[i] < 60 ? cars.lastHitBy[i] : -1;
    wreckCar(sim, i, Cause.Wall, -ox * vOut * 0.3, -oz * vOut * 0.3, by);
  }
}
