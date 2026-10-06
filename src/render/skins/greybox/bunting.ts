// Bunting across the town's streets (the owner, 2026-10-06: "party ribbons across the roof tops of
// the buildings", as the market hall has under its beams, building.ts): every so often along a road,
// where a house stands at its edge on both sides, a string of little flags slung from eave to eave,
// sagging over the street. Scenery only (the sim never sees it): high over every car.

import { DoubleSide, Mesh, type Object3D } from 'three';
import type { HouseDef } from '../../../core/content';
import { hash01 } from '../../../core/rng';
import type { Track } from '../../../core/track/bake';
import { Geo } from './track';
import { toon } from './toon';

/**
 * A string every `every` m along each road, from a house's wall within `reach` m of the road's edge
 * on each side (its eaves `under` m down from its top), the two no more than `step` m apart in
 * height; sagging `sag` of its length, a flag every `flag` m, `size` m across and deep. Where
 * there's a house on one side only (the waterfront, the sea across it), swagged along its fronts
 * from one string's end to the next, no more than `along` m.
 */
const BUNTING = { every: 14, reach: 12, under: 0.4, step: 5, sag: 0.08, flag: 1, size: 0.75, along: 24 };
const FLAGS = ['#e8433a', '#ffd23f', '#2f7fd8', '#f4efe6', '#3fae5a', '#ff5fa2', '#ff8a1a'];
const STRING = '#3a3340';
/** Houses with a look of their own (the casino, the beach club, the hotel) are left bare. */
const PLAIN = (h: HouseDef) => !h.look;

export function buildBunting(track: Track): Object3D[] {
  const defs = track.layout.houses ?? [];
  if (!defs.length || !track.ground) return [];
  const solid = track.props.filter((p) => p.kind === 'house');
  const base = defs.map((h, k) => solid[k]?.y ?? track.ground!.height(h.at[0], h.at[1]));
  // The houses near a spot, by a coarse grid (the town's a few hundred).
  const CELL = 40;
  const grid = new Map<string, number[]>();
  defs.forEach((h, k) => {
    if (!PLAIN(h)) return;
    const key = `${Math.floor(h.at[0] / CELL)},${Math.floor(h.at[1] / CELL)}`;
    (grid.get(key) ?? (grid.set(key, []), grid.get(key)!)).push(k);
  });
  /** The house whose footprint (a little proud of its walls) holds (x, z), or -1. */
  const houseAt = (x: number, z: number): number => {
    const gx = Math.floor(x / CELL);
    const gz = Math.floor(z / CELL);
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (const k of grid.get(`${gx + a},${gz + b}`) ?? []) {
          const h = defs[k];
          const fx = Math.sin(h.rot);
          const fz = Math.cos(h.rot);
          const dx = x - h.at[0];
          const dz = z - h.at[1];
          // Across its front (right of its facing) and along its depth.
          if (Math.abs(dx * fz - dz * fx) <= h.size[0] / 2 && Math.abs(dx * fx + dz * fz) <= h.size[1] / 2) return k;
        }
    return -1;
  };
  const geo = new Geo();
  let strings = 0;
  for (const sp of track.splines) {
    // The last end on each side (left, right), for swags along the fronts.
    const last: (number[] | null)[] = [null, null];
    for (let s = BUNTING.every / 2; s < sp.length; s += BUNTING.every) {
      const i = Math.min(sp.n - 1, Math.round(s / sp.step));
      const edge = sp.width[i] / 2 + sp.shoulder[i];
      // Out from the road's edge each side to the first wall.
      const ends: (number[] | null)[] = [null, null];
      [-1, 1].forEach((side, e) => {
        for (let l = edge; l <= edge + BUNTING.reach; l += 0.5) {
          const x = sp.px[i] - sp.tz[i] * l * side;
          const z = sp.pz[i] + sp.tx[i] * l * side;
          const k = houseAt(x, z);
          if (k < 0) continue;
          // (A little out from its wall, toward the road: along its front, a swag in the wall's
          // plane was hidden in it.)
          const o = Math.max(edge, l - 0.8);
          ends[e] = [sp.px[i] - sp.tz[i] * o * side, base[k] + defs[k].size[2] - BUNTING.under, sp.pz[i] + sp.tx[i] * o * side];
          break;
        }
      });
      const [l, r] = ends;
      if (l && r && Math.abs(l[1] - r[1]) <= BUNTING.step) sling(geo, l, r, strings++);
      else
        for (let e = 0; e < 2; e++) {
          const a = last[e];
          const b = ends[e];
          if (a && b && !ends[1 - e] && Math.hypot(b[0] - a[0], b[2] - a[2]) <= BUNTING.along && Math.abs(b[1] - a[1]) <= BUNTING.step / 2) sling(geo, a, b, strings++);
        }
      last[0] = l;
      last[1] = r;
    }
  }
  if (!geo.pos.length) return [];
  const mesh = new Mesh(geo.build(), toon({ vertexColors: true, side: DoubleSide }));
  mesh.matrixAutoUpdate = false;
  return [mesh];
}

/** A string of flags from `a` to `b`, sagging in the middle; `n` picks where its colours start. */
function sling(geo: Geo, a: number[], b: number[], n: number): void {
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const at = (t: number, down = 0) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - BUNTING.sag * len * 4 * t * (1 - t) - down, a[2] + (b[2] - a[2]) * t];
  // The string: a thin band, in short pieces along its curve.
  const pieces = Math.max(4, Math.round(len / 2));
  for (let p = 0; p < pieces; p++) {
    const [t0, t1] = [p / pieces, (p + 1) / pieces];
    geo.face(at(t0), at(t1), at(t1, 0.05), at(t0, 0.05), STRING);
  }
  // The flags, hanging under it in the string's own plane.
  const flags = Math.floor(len / BUNTING.flag);
  const start = Math.floor(hash01(n, 13, 5) * FLAGS.length);
  const half = BUNTING.size / 2 / len;
  for (let f = 1; f < flags; f++) {
    const t = f / flags;
    const tip = at(t, BUNTING.size);
    geo.face(at(t - half, 0.03), at(t + half, 0.03), tip, tip, FLAGS[(start + f) % FLAGS.length]);
  }
}
