// Pines on open ground (docs/AVALANCHE.md, item 6): a forest on the snow off the piste, every tree
// solid. Scattered once at bake time from the layout's seed (so every screen has the same forest),
// into a list the sim collides with and the renderer draws: what you see is what you hit. Thin by
// the piste and thick up the walls, in glades, and never on the piste or its edge, in a canyon or
// its mouth, in a mogul field, or beside a kicker.
//
// On an island (`kind: 'tropic'`, docs/PARADISE.md) the same list is palms along the coast and
// jungle trees inland: thickest by the jungle's roads, sparse on the volcano's ash and never up
// its bare top or in its crater, and nothing in the sea.

import type { PinesDef, TrackLayout } from '../content';
import { hash01 } from '../rng';
import type { BakedSpline } from './bake';
import { canyonAt, noise, type Ground } from './ground';

/** The lookup grid's cell (m). */
const CELL = 16;

export interface Pines {
  readonly n: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  /** Its collider's half width (m): the trunk and the low branches, a square at the foot. */
  readonly r: Float32Array;
  /** How tall it stands (m). */
  readonly h: Float32Array;
  /** What it is: TREE_PINE, TREE_PALM or TREE_JUNGLE. */
  readonly kind: Uint8Array;
  /** Calls `fn` with every tree within the grid cells round (x, z). */
  near(x: number, z: number, fn: (k: number) => void): void;
}

export const TREE_PINE = 0;
export const TREE_PALM = 1;
export const TREE_JUNGLE = 2;
/** Within this far (m) of the coast an island's trees are palms. */
const PALM_COAST = 70;
/** On an island, how thick the trees grow by the verge of the road they're nearest: the jungle's thickest. */
const TROPIC_THICK: Record<string, number> = { undergrowth: 1.7, 'red-earth': 1.7, beach: 0.55, sand: 0.4, ash: 0.25 };

const smooth = (e0: number, e1: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function buildPines(def: PinesDef, layout: TrackLayout, main: BakedSpline, ground: Ground, verge?: (i: number) => string): Pines {
  const g = layout.ground!;
  const out: [number, number, number, number, number, number][] = [];
  const tropic = def.kind === 'tropic';
  const sea = g.sea ?? 0;
  const v = g.volcano;
  const span = g.wallFrom + (g.wallOut ?? 25) - 4;
  const step = def.spacing;
  const x1 = ground.x0 + (ground.nx - 1) * ground.cell;
  const z1 = ground.z0 + (ground.nz - 1) * ground.cell;
  for (let iz = 0; ground.z0 + iz * step < z1; iz++) {
    for (let ix = 0; ground.x0 + ix * step < x1; ix++) {
      const x = ground.x0 + (ix + hash01(def.seed, ix, iz * 2)) * step;
      const z = ground.z0 + (iz + hash01(def.seed, ix, iz * 2 + 1)) * step;
      if (ground.outside(x, z)) continue;
      const gx = Math.round((x - ground.x0) / ground.cell);
      const gz = Math.round((z - ground.z0) / ground.cell);
      const k = gz * ground.nx + gx;
      // Not on a branch or its verge, nor in a tunnel's mouth.
      if (ground.onBranch[k] || ground.hole[k]) continue;
      const lat = ground.lateral[k];
      const i = ground.near[k];
      const s = i * main.step;
      const half = main.width[i] / 2 + main.shoulder[i];
      const d = Math.abs(lat) - half;
      if (d < def.clear || Math.abs(lat) > span || s < 10 || s > main.length - 10) continue;
      if (blocked(layout, s, lat, d)) continue;
      const y = ground.height(x, z);
      let thick = 1;
      let kind = TREE_PINE;
      if (tropic) {
        // Nothing in the sea or on the wet sand; nothing up the volcano's bare top or in its crater.
        if (y < sea + 0.8) continue;
        if (v && Math.hypot(x - v.x, z - v.z) < v.r * 0.62) continue;
        thick = TROPIC_THICK[verge?.(i) ?? ''] ?? 1;
        kind = ground.coast(x, z) < PALM_COAST ? TREE_PALM : TREE_JUNGLE;
      }
      // Thicker away from the piste and up the walls, and in glades, not an even carpet.
      const p = def.density * thick * smooth(def.clear, def.clear + def.thicken, d) ** 0.7 * (0.35 + 0.9 * noise(x, z, def.glade, def.seed));
      if (hash01(def.seed + 1, ix, iz) >= p) continue;
      const h = 7 + 7 * hash01(def.seed + 2, ix, iz);
      // A palm's collider is its slim trunk; a jungle tree's and a pine's, the trunk and low branches.
      out.push([x, y, z, kind === TREE_PALM ? 0.5 : 0.9 + 0.04 * h, h, kind]);
    }
  }
  const n = out.length;
  const pick = (c: number) => Float32Array.from(out, (t) => t[c]);
  const x = pick(0);
  const z = pick(2);
  // The grid: each cell's trees, by counting sort.
  const gx0 = ground.x0;
  const gz0 = ground.z0;
  const cols = Math.ceil((x1 - gx0) / CELL) + 1;
  const rows = Math.ceil((z1 - gz0) / CELL) + 1;
  const cellOf = (k: number) => Math.min(rows - 1, Math.max(0, Math.floor((z[k] - gz0) / CELL))) * cols + Math.min(cols - 1, Math.max(0, Math.floor((x[k] - gx0) / CELL)));
  const start = new Int32Array(cols * rows + 1);
  for (let k = 0; k < n; k++) start[cellOf(k) + 1]++;
  for (let c = 0; c < cols * rows; c++) start[c + 1] += start[c];
  const fill = start.slice(0, cols * rows);
  const items = new Int32Array(n);
  for (let k = 0; k < n; k++) items[fill[cellOf(k)]++] = k;
  return {
    n,
    x,
    y: pick(1),
    z,
    r: pick(3),
    h: pick(4),
    kind: Uint8Array.from(out, (t) => t[5]),
    near(px, pz, fn) {
      const cx = Math.floor((px - gx0) / CELL);
      const cz = Math.floor((pz - gz0) / CELL);
      for (let r = Math.max(0, cz - 1); r <= Math.min(rows - 1, cz + 1); r++)
        for (let c = Math.max(0, cx - 1); c <= Math.min(cols - 1, cx + 1); c++) {
          const cell = r * cols + c;
          for (let m = start[cell]; m < start[cell + 1]; m++) fn(items[m]);
        }
    },
  };
}

/** Where no tree grows: a canyon and its mouth (between it and the piste), a mogul field, beside a kicker. */
function blocked(layout: TrackLayout, s: number, lat: number, d: number): boolean {
  const g = layout.ground!;
  if (canyonAt(g, s, lat) > 0.2) return true;
  for (const c of g.canyons ?? []) {
    if (s < c.s[0] - 40 || s > c.s[1] + 40 || Math.sign(lat) !== Math.sign(c.lateral)) continue;
    if (Math.abs(lat) < Math.abs(c.lateral) + c.floor / 2 + 2 * c.depth + 4) return true;
  }
  for (const m of g.moguls ?? []) if (s > m.s[0] - 6 && s < m.s[1] + 6 && lat > m.lateral[0] - 6 && lat < m.lateral[1] + 6) return true;
  for (const r of layout.ramps ?? []) if (Math.abs(s - r.s) < r.length + (r.back ?? 0) + 12 && d < (r.flank ?? 8) + 8) return true;
  return false;
}
