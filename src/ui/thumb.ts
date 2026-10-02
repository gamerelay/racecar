// A map's thumbnail for the lobby list and the lobby's map card: the lap and its shortcuts as SVG
// paths, fitted to a box, north up like the minimap. Pure (strings in, strings out), so it's
// tested without a DOM, and cheap: it reads the layout's control points, no baking.

import type { TrackLayout } from '../core/content';

export interface Thumb {
  /** The main lap, closed. */
  main: string;
  /** Each shortcut or alternate (not the secret ones). */
  branches: string[];
  /** The lap's length through its control points, in km (a touch under the baked length). */
  km: number;
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
  const span = Math.max(x1 - x0, z1 - z0, 1);
  const k = (size - pad * 2) / span;
  // Centred in the box, whichever way the lap is longer.
  const ox = pad + (size - pad * 2 - (x1 - x0) * k) / 2;
  const oz = pad + (size - pad * 2 - (z1 - z0) * k) / 2;
  const path = (pts: { p: [number, number, number] }[], closed: boolean) =>
    pts.map(({ p }, i) => `${i ? 'L' : 'M'}${(ox + (p[0] - x0) * k).toFixed(1)} ${(oz + (p[2] - z0) * k).toFixed(1)}`).join('') + (closed ? 'Z' : '');
  const pts = layout.main.points;
  let m = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i].p;
    const b = pts[(i + 1) % pts.length].p;
    m += Math.hypot(b[0] - a[0], b[2] - a[2]);
  }
  return { main: path(pts, true), branches: (layout.branches ?? []).filter((b) => !b.secret).map((b) => path(b.points, false)), km: m / 1000 };
}

/** The thumbnail as an `<svg>`. */
export function thumbSvg(layout: TrackLayout | undefined, size = 64): string {
  if (!layout) return `<svg class="thumb" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"></svg>`;
  const t = thumb(layout, size);
  return `<svg class="thumb" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><path class="lap" d="${t.main}"/>${t.branches.map((d) => `<path class="cut" d="${d}"/>`).join('')}</svg>`;
}
