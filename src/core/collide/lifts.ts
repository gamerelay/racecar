// Cars against a raised drawbridge (core/world/lifts.ts, PieceDef.lift): past its `wall` angle a
// leaf is no ramp but a wall across the road at its hinge, as tall as its tip is high. A car
// driving into it bounces off as off a road's wall (a wreck if hard enough). The leaves are the
// sim's, set this tick before the cars stepped: the same on every screen.

import type { SimState } from '../state';
import { cos, sin } from '../math';
import { newHit, sampleAt } from '../track/query';
import { bounce } from './walls';

const at = newHit();
/** A car further into a leaf's footprint than this (m) is on it or over it, not driving into it. */
const DEEP = 4;

/** Car `i` against every raised leaf. */
export function collideLifts(sim: SimState, i: number): void {
  const lifts = sim.world?.lifts;
  const g = sim.track.ground;
  if (!lifts || !g || !lifts.pieces.length) return;
  const c = sim.cars;
  if (c.spline[i] !== 0 || c.ghostT[i] > 0) return;
  const reach = sim.classes[c.cls[i]].size[1];
  for (let k = 0; k < lifts.pieces.length; k++) {
    const def = lifts.defs[k];
    const th = g.pieces.angle[lifts.pieces[k]];
    if (th <= def.wall) continue;
    const half = (def.s[1] - def.s[0]) / 2;
    const foot = half * cos(th);
    const s = c.s[i];
    if (s + reach < def.s[0] - 1 || s - reach > def.s[1] + 1) continue;
    sampleAt(sim.track.main, def.s[0], at);
    if (Math.abs(c.lateral[i]) > at.width / 2 + at.shoulder + reach) continue;
    if (c.y[i] > at.cy + half * sin(th) + 0.5 || c.y[i] < at.cy - 2) continue;
    // The near leaf, met coming along the road; the far one, coming the other way.
    const near = s + reach - def.s[0];
    const far = def.s[1] - (s - reach);
    if (near > 0 && near < DEEP && s - reach < def.s[0] + foot) bounce(sim, i, at.tx, at.tz, near, reach, 0);
    else if (far > 0 && far < DEEP && s + reach > def.s[1] - foot) {
      sampleAt(sim.track.main, def.s[1], at);
      bounce(sim, i, -at.tx, -at.tz, far, reach, 0);
    }
  }
}
