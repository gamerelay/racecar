// Which spline a car is on, and where along it. Near a node of the road graph (core/track/graph.ts,
// step 6b) the car could be on any road that meets there; it's on whichever one it's more inside of
// (with a little hysteresis). While it's inside two, neither road's wall applies (`junctionFree`).

import type { SimState } from '../state';
import { signedGap } from './bake';
import { project, projectGlobal, surfaceAt, type TrackHit } from './query';

const WINDOW = 90;
const HYSTERESIS = 0.5;

/** Updates the car's spline, s, lateral, surface and junctionFree; leaves the chosen hit in `sim.hitA`. */
export function locateCar(sim: SimState, i: number): TrackHit {
  const { track, cars } = sim;
  const cur = sim.hitA;
  const alt = sim.hitB;
  const sp = track.splines[cars.spline[i]];
  project(sp, cars.x[i], cars.z[i], cars.s[i], cur);
  // A stale hint (a teleport, a wreck flung across a corner) projects badly: search again.
  if (Math.abs(cur.lateral) > cur.width / 2 + cur.shoulder + 60) projectGlobal(sp, cars.x[i], cars.z[i], cur, cars.y[i]);

  let free = 0;
  const links = track.graph.links[sp.index];
  if (links.length) {
    const curInside = Math.abs(cur.lateral) - cur.width / 2;
    // Off the end of a branch (it stops at a node): it's on another road there, however far inside it
    // is. (Not an open main road: past a run's end it's still the main road.)
    const offEnd = sp.index > 0 && (cur.s <= 0.01 || cur.s >= sp.length - 0.01);
    let bestInside = curInside;
    let bestSpline = -1;
    let bestS = 0;
    let tried = -1;
    for (let k = 0; k < links.length; k++) {
      const link = links[k];
      // (One look at each other road: at the first of its nodes in reach.)
      if (link.other === tried) continue;
      const gap = sp.closed ? signedGap(cur.s, link.s, sp.length) : cur.s - link.s;
      if (gap <= -WINDOW || gap >= WINDOW) continue;
      tried = link.other;
      const other = track.splines[link.other];
      // As far past the node on it as the car is past it on this one, scaled (held to its ends).
      const hint = other.closed ? link.os + gap * link.scale : Math.min(other.length, Math.max(0, link.os + gap * link.scale));
      project(other, cars.x[i], cars.z[i], hint, alt);
      if (!other.closed && (alt.s <= 0.01 || alt.s >= other.length - 0.01)) continue; // off the end of it
      const inside = Math.abs(alt.lateral) - alt.width / 2;
      if (inside <= alt.shoulder && curInside <= cur.shoulder) free = 1;
      if ((offEnd && bestSpline < 0) || inside < bestInside - HYSTERESIS) {
        bestInside = inside;
        bestSpline = link.other;
        bestS = alt.s;
      }
    }
    if (bestSpline >= 0) project(track.splines[bestSpline], cars.x[i], cars.z[i], bestS, cur);
  }

  cars.spline[i] = cur.spline;
  cars.s[i] = cur.s;
  cars.lateral[i] = cur.lateral;
  cars.junctionFree[i] = free;
  cars.surface[i] = surfaceAt(track, cur, cars.x[i], cars.y[i], cars.z[i], sim.wet, sim.shoulderSurface);
  return cur;
}
