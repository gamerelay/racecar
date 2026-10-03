// The heightfield (docs/AVALANCHE.md): built once from the main road. On the road and its
// shoulder, the road's own height; off it, the land between the roads (relaxed smooth, so two
// stretches meet in a slope, not a cliff); then what the layout adds (shape.ts), the volcano, the
// coast falling into the sea, and the ground falling away under a piece that says so (the bay
// under the Freeway).

import type { GroundDef } from '../../content';
import { hypot, smoothstep as smooth } from '../../math';
import type { BakedSpline } from '../bake';
import { across, along } from '../frame';
import { curve, loopDist, shaftHeight } from '../island';
import { pull, runIn, type Pieces } from './pieces';
import { planeOf } from './plane';
import { sampleSearch } from './search';
import { ROUGH_IN, groundShape } from './shape';

/** An island's beach: the ground's height at the waterline over the sea, how steeply it rises inland of it (1:x), and the sea bed's depth (as the lapped island's land, terrain.ts). */
const SHORE = 1.2;
const SHORE_RISE = 0.6;
const SEA_BED = 9;
/** Off a road, the volcano's flank comes in over this many meters past its edge (a cutting, not a cliff). */
const CONE_IN = 40;
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
  /** Signed distance to the coast (GroundDef.coast), positive inland; Infinity with none. */
  coast(x: number, z: number): number;
}

export function buildLand(def: GroundDef, main: BakedSpline, pieces: Pieces): Land {
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
  const sea = def.sea ?? 0;
  const coastLoop = def.coast && def.coast.length > 2 ? curve([...def.coast, def.coast[0]], 12) : null;
  const coast = (x: number, z: number) => (coastLoop ? loopDist(coastLoop, x, z) : Infinity);
  const volcano = def.volcano;
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
      // The volcano rises off the roads (cut back to them over CONE_IN), and the coast falls away
      // into the sea, a beach along it: off them, the road's own height on them.
      if (volcano) {
        // (A shaft for a crater: inside the lip the walls fall nearly sheer to its floor.)
        const cone = sea + shaftHeight(volcano, x, z);
        const pit = volcano.pit !== undefined && hypot(x - volcano.x, z - volcano.z) < volcano.crater;
        if (cone > gy || pit) gy += (cone - gy) * smooth(edge, edge + CONE_IN, d);
      }
      if (coastLoop) {
        const sd = coast(x, z);
        let isle = gy;
        if (sd > 20) isle = Math.max(isle, sea + SHORE);
        isle = Math.min(isle, sea - SEA_BED + (SEA_BED + SHORE) * smooth(-90, 2, sd) + Math.max(0, sd - 2) * SHORE_RISE);
        gy += (isle - gy) * smooth(edge, edge + ROUGH_IN, d);
      }
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
  return { x0, z0, cell, nx, nz, h, lateral, near, coast };
}
