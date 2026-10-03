// The heightfield (docs/AVALANCHE.md): built once from the main road. On the road and its
// shoulder, the road's own height; off it, the land between the roads (relaxed smooth, so two
// stretches meet in a slope, not a cliff); then what the layout adds (shape.ts), the features
// (track/features: the volcano, the coast falling into the sea), and the ground falling away under
// a piece that says so (the bay under the Freeway).

import type { GroundDef } from '../../content';
import { smoothstep as smooth } from '../../math';
import type { BakedSpline } from '../bake';
import type { Feature, ShapePoint } from '../features';
import { across, along } from '../frame';
import { pull, runIn, type Pieces } from './pieces';
import { planeOf } from './plane';
import { sampleSearch } from './search';
import { ROUGH_IN, groundShape } from './shape';

/** Past the walls' foot (`wallFrom`), the grid reaches this far up them, and 20 m more, at its narrowest (GroundDef.wallOut). */
const WALL_OUT = 25;
/** The land between the roads is relaxed on a grid this coarse (m), this many passes. */
const BASE_CELL = 8;
const RELAX = 300;

/** The heightfield on its grid, and per point how far across the main road it lies (m, + right) and the main road's sample nearest it. */
export interface Land {
  x0: number;
  z0: number;
  cell: number;
  nx: number;
  nz: number;
  h: Float32Array;
  lateral: Float32Array;
  near: Int32Array;
}

export function buildLand(def: GroundDef, main: BakedSpline, pieces: Pieces, features: readonly Feature[]): Land {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < main.n; i++) {
    minX = Math.min(minX, main.px[i]);
    maxX = Math.max(maxX, main.px[i]);
    minZ = Math.min(minZ, main.pz[i]);
    maxZ = Math.max(maxZ, main.pz[i]);
  }
  const wallOut = def.wallOut ?? WALL_OUT;
  const margin = def.wallFrom + wallOut + 20;
  const cell = def.cell;
  const x0 = Math.floor((minX - margin) / cell) * cell;
  const z0 = Math.floor((minZ - margin) / cell) * cell;
  const nx = Math.ceil((maxX + margin - x0) / cell) + 1;
  const nz = Math.ceil((maxZ + margin - z0) / cell) + 1;
  const nearest = sampleSearch(main, x0, z0, nx * cell, nz * cell, 24);
  const shapers = features.filter((f) => f.shape);
  const at: ShapePoint = { x: 0, z: 0, d: 0, edge: 0 };
  const plane = (i: number, x: number, z: number) => planeOf(main, i, x, z);
  const shaping = pieces.list.filter((p) => p.spline === main.index && p.under);

  // The land between the roads, on a coarse grid: the road's height on the road, and off it relaxed
  // smooth from the road's plane carried out. Carried out alone, the plane jumps where two stretches
  // are equally near (the ridge between the run and the road back, inside a switchback); relaxed,
  // they meet in a slope.
  const C = BASE_CELL;
  const cnx = Math.ceil(((nx - 1) * cell) / C) + 1;
  const cnz = Math.ceil(((nz - 1) * cell) / C) + 1;
  const base = new Float32Array(cnx * cnz);
  const fixed = new Uint8Array(cnx * cnz);
  for (let cz = 0; cz < cnz; cz++) {
    for (let cx = 0; cx < cnx; cx++) {
      const x = x0 + cx * C;
      const z = z0 + cz * C;
      const a = nearest(x, z);
      base[cz * cnx + cx] = plane(a.i, x, z);
      fixed[cz * cnx + cx] = a.d < main.width[a.i] / 2 + main.shoulder[a.i] ? 1 : 0;
    }
  }
  for (let it = 0; it < RELAX; it++) {
    for (let cz = 0; cz < cnz; cz++) {
      for (let cx = 0; cx < cnx; cx++) {
        const k = cz * cnx + cx;
        if (fixed[k]) continue;
        // Gauss–Seidel, the grid's edges mirrored.
        const l = base[k - (cx > 0 ? 1 : 0)];
        const r = base[k + (cx < cnx - 1 ? 1 : 0)];
        const u = base[k - (cz > 0 ? cnx : 0)];
        const d = base[k + (cz < cnz - 1 ? cnx : 0)];
        base[k] = (l + r + u + d) / 4;
      }
    }
  }
  const land = (x: number, z: number) => {
    const u = Math.min(cnx - 1.001, Math.max(0, (x - x0) / C));
    const v = Math.min(cnz - 1.001, Math.max(0, (z - z0) / C));
    const gx = Math.floor(u);
    const gz = Math.floor(v);
    const fu = u - gx;
    const fv = v - gz;
    const k = gz * cnx + gx;
    return base[k] + (base[k + 1] - base[k]) * fu + (base[k + cnx] - base[k]) * fv + (base[k] - base[k + 1] - base[k + cnx] + base[k + cnx + 1]) * fu * fv;
  };

  const h = new Float32Array(nx * nz);
  const lateral = new Float32Array(nx * nz);
  const near = new Int32Array(nx * nz);
  for (let gz = 0; gz < nz; gz++) {
    for (let gx = 0; gx < nx; gx++) {
      const x = x0 + gx * cell;
      const z = z0 + gz * cell;
      const g = gz * nx + gx;
      const { i, d } = nearest(x, z);
      const ahead = along(main, i, x, z);
      const lat = across(main, i, x, z);
      // On the road and its shoulder, the road exactly; out through the rough snow, the land.
      const half = main.width[i] / 2;
      const edge = half + main.shoulder[i];
      const road = plane(i, x, z);
      const y = road + (land(x, z) - road) * smooth(edge, edge + ROUGH_IN, d);
      // What the layout adds, by the distance across (not the lateral: that jumps between stretches).
      const s = i * main.step + ahead;
      let gy = y + groundShape(def, s, lat < 0 ? -d : d, half, main.shoulder[i], x, z) * runIn(pieces, s, d, edge);
      // The features, in order (the volcano rising off the roads, the coast falling into the sea):
      // off the roads, the road's own height on them.
      at.x = x;
      at.z = z;
      at.d = d;
      at.edge = edge;
      for (const f of shapers) gy = f.shape!(at, gy);
      // Under a piece that says so, the ground falls away to its floor.
      for (const p of shaping) {
        const k = pull(p, s, d, edge);
        if (k > 0 && p.under!.floor < gy) gy += (p.under!.floor - gy) * k;
      }
      h[g] = gy;
      lateral[g] = lat < 0 ? -d : d;
      near[g] = i;
    }
  }
  return { x0, z0, cell, nx, nz, h, lateral, near };
}
