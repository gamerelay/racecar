// Which spline a car is on, and where along it. Near a junction the car could be on the main road
// or a branch; it's on whichever one it's more inside of (with a little hysteresis). While it's
// inside both roads, neither road's wall applies (`junctionFree`).

import type { SimState } from '../state';
import { mainDistance, wrap } from './bake';
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
  const L = track.main.length;
  if (track.splines.length > 1) {
    const curInside = Math.abs(cur.lateral) - cur.width / 2;
    let bestInside = curInside;
    let bestSpline = -1;
    let bestS = 0;
    if (sp.index === 0) {
      for (let b = 1; b < track.splines.length; b++) {
        const br = track.splines[b];
        const dFrom = wrap(cur.s - br.mainFrom + L / 2, L) - L / 2;
        const dTo = wrap(cur.s - br.mainTo + L / 2, L) - L / 2;
        let hint = -1;
        if (dFrom > -WINDOW && dFrom < WINDOW) hint = Math.max(0, dFrom);
        else if (dTo > -WINDOW && dTo < WINDOW) hint = Math.min(br.length, br.length + dTo);
        if (hint < 0) continue;
        project(br, cars.x[i], cars.z[i], hint, alt);
        if (alt.s <= 0.01 || alt.s >= br.length - 0.01) continue; // off the end of the branch
        const inside = Math.abs(alt.lateral) - alt.width / 2;
        if (inside <= alt.shoulder && curInside <= cur.shoulder) free = 1;
        if (inside < bestInside - HYSTERESIS) {
          bestInside = inside;
          bestSpline = b;
          bestS = alt.s;
        }
      }
    } else if (cur.s < WINDOW || cur.s > sp.length - WINDOW || cur.s <= 0.01 || cur.s >= sp.length - 0.01) {
      project(track.main, cars.x[i], cars.z[i], mainDistance(track, sp.index, cur.s), alt);
      const inside = Math.abs(alt.lateral) - alt.width / 2;
      if (inside <= alt.shoulder && curInside <= cur.shoulder) free = 1;
      const offEnd = cur.s <= 0.01 || cur.s >= sp.length - 0.01;
      if (offEnd || inside < bestInside - HYSTERESIS) {
        bestSpline = 0;
        bestS = alt.s;
      }
    }
    if (bestSpline >= 0) {
      project(track.splines[bestSpline], cars.x[i], cars.z[i], bestS, cur);
    }
  }

  cars.spline[i] = cur.spline;
  cars.s[i] = cur.s;
  cars.lateral[i] = cur.lateral;
  cars.junctionFree[i] = free;
  cars.surface[i] = surfaceAt(track, cur, sim.wet, sim.shoulderSurface);
  return cur;
}
