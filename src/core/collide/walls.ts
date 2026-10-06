// Walls run along both edges of every spline, a shoulder's width beyond the road, except where the
// layout opens a gap (and where branches leave and rejoin). A car's reach toward a wall is its
// box's lateral extent, so a car sliding sideways hits sooner than one driving straight.

import { cancelDrift, recentAttacker, wreckCar } from '../car/physics';
import { TUNING as T } from '../car/tuning';
import { Cause, Ev } from '../events';
import type { SimState } from '../state';
import { sampleAt } from '../track/query';
import { atan2, cos, sin } from '../math';

export function collideWalls(sim: SimState, i: number): void {
  const cars = sim.cars;
  if (cars.junctionFree[i]) return;
  const sp = sim.track.splines[cars.spline[i]];
  const hit = sampleAt(sp, cars.s[i], sim.hitA);
  const cls = sim.classes[cars.cls[i]];
  const rel = cars.h[i] - atan2(hit.tx, hit.tz);
  const reach = Math.abs(cos(rel)) * cls.size[0] + Math.abs(sin(rel)) * cls.size[1];
  const wall = hit.width / 2 + hit.shoulder;
  // Lateral measured fresh: the car moved since it was located this tick.
  const lat = (cars.x[i] - hit.cx) * -hit.tz + (cars.z[i] - hit.cz) * hit.tx;
  // Only when grounded-ish: flying well above the wall top (1.2 m) clears it, and on open ground
  // a car well under it (down in the bay under a bridge's rail) never meets it.
  // Under a ceiling (a tunnel) the wall goes up to it: flying across one, cars passed over its rail
  // and out into the rock, onto the hill over it.
  const g = sim.track.ground;
  const p = g ? (g.pieces.at(sp.index)?.[Math.min(sp.n - 1, Math.max(0, Math.round(cars.s[i] / sp.step)))] ?? -1) : -1;
  const ceiling = p >= 0 ? g!.pieces.list[p].ceiling : NaN;
  if (cars.y[i] > hit.cy + 1.2 + 0.5 && !(cars.y[i] < hit.cy + ceiling)) return;
  if (sim.track.ground && cars.y[i] < hit.cy - 2) return;
  let side = 0;
  // On open ground a wall is a rail with ground past it too (a bridge's, near its ends): a car that
  // was outside it last tick stays outside, pushed back out. On a lap, past a wall is out of bounds.
  const was = sim.track.ground ? (cars.px[i] - hit.cx) * -hit.tz + (cars.pz[i] - hit.cz) * hit.tx : 0;
  if (sim.track.ground && Math.abs(was) > wall) {
    const out = was > 0 ? 1 : -1;
    if (!(out > 0 ? hit.wallR : hit.wallL) || Math.abs(lat) - reach >= wall) return;
    const depth = wall - (Math.abs(lat) - reach);
    // Pushed out: away from the road.
    bounce(sim, i, -hit.tz * -out, hit.tx * -out, depth, reach, out);
    return;
  }
  if (lat + reach > wall && hit.wallR) side = 1;
  else if (lat - reach < -wall && hit.wallL) side = -1;
  if (side === 0) return;

  const depth = side > 0 ? lat + reach - wall : -wall - (lat - reach);
  // Outward direction (toward the wall), world space: side · right, right = (-tz, tx).
  bounce(sim, i, -hit.tz * side, hit.tx * side, depth, reach, side);
}

/** A car meeting a rock face on open ground, into it along (ox, oz) (physics.ts meetFace): a wall. */
export function hitFace(sim: SimState, i: number, ox: number, oz: number): void {
  bounce(sim, i, ox, oz, 0, sim.classes[sim.cars.cls[i]].size[1], 0);
}

/** A car `depth` m into a wall it's moving into along (ox, oz): out of it, bounced and scraped, maybe wrecked. `reach`: how far from its middle it touched; `side`: the road's side (0: none). */
export function bounce(sim: SimState, i: number, ox: number, oz: number, depth: number, reach: number, side: number): void {
  const cars = sim.cars;
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
  // A real knock ends a drift, and a chain (mid-drift or between two).
  if ((cars.drift[i] || cars.chainT[i] > 0) && vOut > 6) cancelDrift(sim, i);
  if (vOut > T.wallWreck && cars.ghostT[i] <= 0) {
    wreckCar(sim, i, Cause.Wall, -ox * vOut * 0.3, -oz * vOut * 0.3, recentAttacker(sim, i, 60));
  }
}
