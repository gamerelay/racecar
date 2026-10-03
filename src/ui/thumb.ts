// A map's thumbnail for the lobby list and the lobby's map card: the lap and its shortcuts as SVG
// paths, fitted to a box the same way as the minimap (`fitBox`). Pure (strings in, strings out),
// so it's tested without a DOM, and cheap: it reads the layout's control points, no baking.

import type { TrackLayout } from '../core/content';

export interface Thumb {
  /** The main lap, closed; one run (layout.run) open, top to bottom. */
  main: string;
  /** One run's finish, where it's drawn. */
  finish?: [number, number];
  /** Each shortcut or alternate (not the secret ones). */
  branches: string[];
  /** The lap's length through its control points, in km (a touch under the baked length); one run's, start to finish. */
  km: number;
}

/**
 * World (x, z) to a `size` × `size` box with `pad` px spare on every side, centred whichever way
 * the bounds are longer, as seen from above: x to the right and z down the screen (z up would be
 * the world's mirror image: a lap driven clockwise drawn anticlockwise). The thumbnail and the
 * minimap both use it.
 */
export function fitBox(x0: number, x1: number, z0: number, z1: number, size: number, pad: number): (x: number, z: number) => [number, number] {
  const span = Math.max(x1 - x0, z1 - z0, 1);
  const k = (size - pad * 2) / span;
  const ox = pad + (size - pad * 2 - (x1 - x0) * k) / 2;
  const oz = pad + (size - pad * 2 - (z1 - z0) * k) / 2;
  return (x, z) => [ox + (x - x0) * k, oz + (z - z0) * k];
}

/** `layout` drawn into a `size` × `size` box with `pad` px spare on every side. */
export function thumb(layout: TrackLayout, size = 64, pad = 4): Thumb {
  const all = [layout.main, ...(layout.branches ?? [])].flatMap((s) => s.points);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const { p } of all) {
    x0 = Math.min(x0, p[0]);
    x1 = Math.max(x1, p[0]);
    z0 = Math.min(z0, p[2]);
    z1 = Math.max(z1, p[2]);
  }
  const at = fitBox(x0, x1, z0, z1, size, pad);
  const path = (pts: { p: [number, number, number] }[], closed: boolean) =>
    pts
      .map(({ p }, i) => {
        const [x, y] = at(p[0], p[2]);
        return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join('') + (closed ? 'Z' : '');
  const pts = layout.main.points;
  const run = layout.run;
  // Along the control points: the whole loop, or one run's road (its finish, on the way).
  let m = 0;
  let finish: [number, number] | undefined;
  for (let i = 0; i < pts.length - (run ? 1 : 0); i++) {
    const a = pts[i].p;
    const b = pts[(i + 1) % pts.length].p;
    // (A run's finish is in the road's meters, along its slope: down a mountain that's more than across the map.)
    const d = run ? Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) : Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (run && !finish && m + d >= run.finish) {
      const t = (run.finish - m) / d;
      finish = at(a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t);
    }
    m += d;
  }
  const branches = (layout.branches ?? []).filter((b) => !b.secret).map((b) => path(b.points, false));
  // (A run's length is its own, in the main road's meters: start line to finish line.)
  return run ? { main: path(pts, false), finish, branches, km: (run.finish - run.start) / 1000 } : { main: path(pts, true), branches, km: m / 1000 };
}

/** The thumbnail as an `<svg>`. */
export function thumbSvg(layout: TrackLayout | undefined, size = 64): string {
  if (!layout) return `<svg class="thumb" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"></svg>`;
  const t = thumb(layout, size);
  const finish = t.finish ? `<circle class="end" cx="${t.finish[0].toFixed(1)}" cy="${t.finish[1].toFixed(1)}" r="${(size / 16).toFixed(1)}"/>` : '';
  return `<svg class="thumb" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><path class="lap" d="${t.main}"/>${t.branches.map((d) => `<path class="cut" d="${d}"/>`).join('')}${finish}</svg>`;
}
