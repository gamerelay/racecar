// Cars against breakable walls (core/world/breakables.ts): a panel met slower than its `breaks` is a
// wall (bounced off, scraped, a wreck if hard enough, as a road's wall); met faster, it bursts and
// the car goes through, a little slower (and scores). A respawning ghost goes through.

import { Ev } from '../events';
import type { SimState } from '../state';
import { BREAK_POINTS, BREAK_SLOW, PANEL_THICK, type Breakables } from '../world/breakables';
import { cos, sin } from '../math';
import { newContact, obbOverlap } from './obb';
import { bounce } from './walls';

const contact = newContact();
/** A car this far (m) past a panel's thickness into it is let through it rather than pushed out. */
const DEEP = 0.4;

/** Car `i` against the standing panels at race time `t`. */
export function collideBreakables(sim: SimState, i: number, br: Breakables, t: number): void {
  const c = sim.cars;
  if (c.ghostT[i] > 0) return;
  const cls = sim.classes[c.cls[i]];
  // Judged on how it came in: slowed by one panel it went on through the next it was already
  // into (on a seam, just over `breaks`, it broke one and bounced off the other).
  const vx = c.vx[i];
  const vz = c.vz[i];
  for (let k = 0; k < br.n; k++) {
    // (Cheap first: near it, at its height, and standing.)
    const dx = br.x[k] - c.x[i];
    const dz = br.z[k] - c.z[i];
    const near = br.half[k] + cls.size[1] + 1;
    if (dx > near || dx < -near || dz > near || dz < -near) continue;
    if (c.y[i] > br.y[k] + br.height[k] + 0.3 || c.y[i] < br.y[k] - 2 || !br.standing(k, t)) continue;
    if (!obbOverlap(c.x[i], c.z[i], c.h[i], cls.size[0], cls.size[1], br.x[k], br.z[k], br.h[k], PANEL_THICK / 2, br.half[k], contact)) continue;
    // How fast it's going through the wall's line (across it, whichever way), not into the panel
    // where they touch: a wide car through a one-panel hole meets the next panels on their ends,
    // and wedged there, slowly, it never broke them.
    const closing = Math.abs(vx * cos(br.h[k]) - vz * sin(br.h[k]));
    if (closing < br.breaks[k]) {
      // Deep in it (a panel standing again round a car in its hole, a ghost's time up halfway
      // through): through, not thrown out along the wall (each panel pushed it on to the next).
      if (contact.depth > PANEL_THICK + DEEP) continue;
      bounce(sim, i, contact.nx, contact.nz, contact.depth, cls.size[1], 0);
      continue;
    }
    br.brokenAt[k] = t;
    sim.events.push(sim.tick, Ev.WallBreak, i, br.x[k], br.y[k] + br.height[k] / 2, br.z[k], closing, k, -1);
    if (c.wreck[i]) continue;
    c.vx[i] *= BREAK_SLOW;
    c.vz[i] *= BREAK_SLOW;
    c.score[i] += BREAK_POINTS;
  }
}
