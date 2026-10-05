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
/** Scratch for where the car was last tick. */
const before = newContact();
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
      // Deep in it and in it last tick too (a panel standing again round a car in its hole, a
      // ghost's time up halfway through): through, not thrown out along the wall (each panel
      // pushed it on to the next). Not a car that got that deep in one tick: that's a hit.
      if (contact.depth > PANEL_THICK + DEEP && obbOverlap(c.px[i], c.pz[i], c.ph[i], cls.size[0], cls.size[1], br.x[k], br.z[k], br.h[k], PANEL_THICK / 2, br.half[k], before)) continue;
      bounce(sim, i, contact.nx, contact.nz, contact.depth, cls.size[1], 0);
      continue;
    }
    // Through: a hole as wide as the car, at its angle to the wall. Every panel of this wall its
    // footprint covers goes now, not as its nose gets to each (angled into a seam, it reached the
    // second a tick later, already slowed by the first, and bounced off it).
    const ux = sin(br.h[k]);
    const uz = cos(br.h[k]);
    const rel = c.h[i] - br.h[k];
    const reach = cls.size[0] * Math.abs(sin(rel)) + cls.size[1] * Math.abs(cos(rel));
    const at = (c.x[i] - br.x[k]) * ux + (c.z[i] - br.z[k]) * uz;
    // And the wall it slides along while it crosses: through at a shallow angle, the hole its
    // footprint made fell behind it and it met the next panel's end, slowed and well under
    // `breaks` across the wall, and bounced off it (often a wreck). Those it sweeps past break
    // without slowing it: it's going by them, not into them.
    const depth = cls.size[0] * Math.abs(cos(rel)) + cls.size[1] * Math.abs(sin(rel));
    const slide = ((vx * ux + vz * uz) * (2 * depth + PANEL_THICK)) / closing;
    const lo = at - reach + Math.min(0, slide);
    const hi = at + reach + Math.max(0, slide);
    for (let j = 0; j < br.n; j++) {
      if (br.wall[j] !== br.wall[k] || !br.standing(j, t)) continue;
      const along = (br.x[j] - br.x[k]) * ux + (br.z[j] - br.z[k]) * uz;
      if (along + br.half[j] <= lo || along - br.half[j] >= hi) continue;
      br.brokenAt[j] = t;
      sim.events.push(sim.tick, Ev.WallBreak, i, br.x[j], br.y[j] + br.height[j] / 2, br.z[j], closing, j, -1);
      if (c.wreck[i]) continue;
      c.score[i] += BREAK_POINTS;
      if (Math.abs(along - at) >= br.half[j] + reach) continue;
      c.vx[i] *= BREAK_SLOW;
      c.vz[i] *= BREAK_SLOW;
    }
  }
}
