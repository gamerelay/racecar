// Breakable walls (docs/CALDERA.md, step 3b): smashables grown into wall panels, placed in world
// space (TrackLayout.breakables). Each wall is cut into panels that break on their own: a panel is a
// wall to a car that meets it slower than its `breaks`, and bursts for one that meets it faster,
// which goes on through a little slower. Where each stands comes from the layout; when each broke is
// state, saved in snapshots. Down for the race, or standing again `standsAgain` s later.
//
// Online, a break changes where everyone can drive, so it's a trigger (net/breakables.ts): the
// screen whose car broke it claims it, and every screen has it down from the winner's time.

import type { BreakableDef } from '../content';
import { atan2, hypot } from '../math';

/** How thick a panel is (m): for the collision, and drawn so. */
export const PANEL_THICK = 0.3;
/** A panel's default width (m). */
export const PANEL_WIDTH = 2.5;
/** The most panels a wall is cut into. */
export const MAX_PANELS = 64;
/** A car through a panel keeps this much of its speed (per panel: two at once take a little more). */
export const BREAK_SLOW = 0.93;
/**
 * And scores this, per panel. No boost, unlike a smashable: a wall's across a line (the Lava Tube's
 * mouth, a shortcut already strong), and paid for breaking it, the line got faster.
 */
export const BREAK_POINTS = 150;

/** The look of panel `k`'s wall (BreakableDef.look: 'boards', 'glass'), for drawing and sound; '' if out of range. */
export function panelLook(defs: readonly BreakableDef[] | undefined, br: Breakables, k: number): string {
  return k >= 0 && k < br.n ? (defs?.[br.wall[k]]?.look ?? '') : '';
}

export class Breakables {
  /** The panels. */
  readonly n: number;
  /** Each one's wall (an index into the layout's `breakables`). */
  readonly wall: Uint16Array;
  /** Its middle at its foot, and its heading (along it: forward = (sin h, cos h)). */
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float64Array;
  readonly h: Float64Array;
  /** Half its width, along it. */
  readonly half: Float64Array;
  readonly height: Float64Array;
  /** The speed (m/s) that breaks it, and how long it stays down (Infinity: the race). */
  readonly breaks: Float64Array;
  readonly down: Float64Array;
  /** World time each was last broken (-Infinity: never). */
  readonly brokenAt: Float64Array;

  constructor(defs: readonly BreakableDef[]) {
    const out: { wall: number; x: number; y: number; z: number; h: number; half: number; height: number; breaks: number; down: number }[] = [];
    defs.forEach((d, w) => {
      const [x0, y0, z0] = d.from;
      const [x1, y1, z1] = d.to;
      const len = hypot(x1 - x0, z1 - z0);
      if (!(len > 0) || !(d.height > 0) || !(d.breaks > 0)) return;
      // (A panel of no width is the default's, and a wall at most MAX_PANELS: the validator says so.)
      const n = Math.min(MAX_PANELS, Math.max(1, Math.round(len / (d.panel !== undefined && d.panel > 0 ? d.panel : PANEL_WIDTH))));
      const h = atan2(x1 - x0, z1 - z0);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        out.push({ wall: w, x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, z: z0 + (z1 - z0) * t, h, half: len / n / 2, height: d.height, breaks: d.breaks, down: d.standsAgain ?? Infinity });
      }
    });
    this.n = out.length;
    this.wall = Uint16Array.from(out, (p) => p.wall);
    this.x = Float64Array.from(out, (p) => p.x);
    this.y = Float64Array.from(out, (p) => p.y);
    this.z = Float64Array.from(out, (p) => p.z);
    this.h = Float64Array.from(out, (p) => p.h);
    this.half = Float64Array.from(out, (p) => p.half);
    this.height = Float64Array.from(out, (p) => p.height);
    this.breaks = Float64Array.from(out, (p) => p.breaks);
    this.down = Float64Array.from(out, (p) => p.down);
    this.brokenAt = new Float64Array(this.n).fill(-Infinity);
  }

  standing(k: number, t: number): boolean {
    return !(t - this.brokenAt[k] < this.down[k]);
  }

  /** The ones down at `t`, as [index, time broken] (for snapshots). */
  broken(t: number): [number, number][] {
    const out: [number, number][] = [];
    for (let k = 0; k < this.n; k++) if (!this.standing(k, t)) out.push([k, this.brokenAt[k]]);
    return out;
  }

  restore(list: readonly [number, number][]): void {
    this.brokenAt.fill(-Infinity);
    for (const [k, t] of list) if (k >= 0 && k < this.n) this.brokenAt[k] = t;
  }
}
