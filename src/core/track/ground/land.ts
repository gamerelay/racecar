// The heightfield (docs/AVALANCHE.md): built once from the main road. On the road and its
// shoulder, the road's own height; off it, the land between the roads (relaxed smooth, so two
// stretches meet in a slope, not a cliff); then what the layout adds (shape.ts), the features
// (track/features: the volcano, the coast falling into the sea), the ground falling away under
// a piece that says so (the bay under the Freeway), and rock over a main-road tunnel (Coastal's
// Rock Tunnel: there the road runs under the land, not the land down to the road).

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
/**
 * Over a main-road tunnel (an enclosed piece, not a building) the rock stands at least this far
 * (m) over its ceiling across its road and verge and this far past them either side (TUNNEL_SIDE),
 * then falls away at 45°, under whatever the land is (a hill, uncut).
 */
const TUNNEL_ROOF = 4;
const TUNNEL_SIDE = 3;
/**
 * And starts this far (m) in from each end: the rock's face stands inside the tunnel's own
 * outline, where the drawing cuts the ground to it (render's portal.ts), under the tube's vault.
 * (At its very end, the face fell within a grid cell short of the cut: a wall across the mouth.)
 */
const TUNNEL_MOUTH = 4;
/** In a tunnel, over its road and verge, the ground stands at least this far (m) over the road (under its floor, which a car's on). */
const MOUTH_CLEAR = 0.3;
/**
 * Past a gallery's wall (PieceDef.gallery) no rock is kept, and out to this far (m) past its road's
 * edge the ground's a ledge under the road: nothing outside stands in its windows.
 */
export const GALLERY_LEDGE = 4;

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
  const risers = features.filter((f) => f.rise);
  const at: ShapePoint = { x: 0, z: 0, s: 0, lat: 0, d: 0, half: 0, shoulder: 0, edge: 0, bank: 0, keep: 1, rock: 0 };
  const plane = (i: number, x: number, z: number) => planeOf(main, i, x, z);
  const shaping = pieces.list.filter((p) => p.spline === main.index && p.under);
  const tunnels = pieces.list.filter((p) => p.spline === main.index && p.ceiling > 0 && !p.building);

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
      at.x = x;
      at.z = z;
      at.s = s;
      at.lat = lat < 0 ? -d : d;
      at.d = d;
      at.half = half;
      at.shoulder = main.shoulder[i];
      at.edge = edge;
      at.bank = main.bank[i];
      at.keep = runIn(pieces, s, d, edge);
      // Over a main-road tunnel, near its road: in the rock (the features leave the land uncut).
      let roof = -Infinity;
      let ledge = 0;
      at.rock = 0;
      for (let t = 0; t < tunnels.length; t++) {
        const p = tunnels[t];
        if (s < p.s[0] + TUNNEL_MOUTH || s > p.s[1] - TUNNEL_MOUTH) continue;
        // Past a gallery's wall, no rock kept: the hill's own (cut back to the road), under a cliff
        // from the roof.
        const gallery = p.gallery && s >= p.gallery.s[0] && s <= p.gallery.s[1] && lat * p.gallery.side > 0;
        if (gallery) {
          if (d <= edge) {
            at.rock = 1;
            roof = Math.max(roof, road + p.ceiling + TUNNEL_ROOF);
          } else ledge = Math.max(ledge, d < edge + GALLERY_LEDGE ? 1 : 0);
          continue;
        }
        at.rock = 1;
        roof = Math.max(roof, road + p.ceiling + TUNNEL_ROOF - Math.max(0, d - edge - TUNNEL_SIDE));
      }
      let gy = y + groundShape(def, at, risers) * at.keep;
      // The features, in order (the volcano rising off the roads, the coast falling into the sea):
      // off the roads, the road's own height on them.
      for (const f of shapers) gy = f.shape!(at, gy);
      if (gy < roof) gy = roof;
      // In it, over its road, at least MOUTH_CLEAR over the road: the drawing cuts the ground to the
      // tube's outline but keeps it at the road's height (a cutting's floor), and the ground in its
      // mouths, eased to the road's (runIn), was kept, clipped into a slab across the tunnel. (A car
      // in there is on its floor; its wheels read the floor too, wheelGround.) Not in its last grid
      // cell at each end: the grid blended the rise out past the end, where there's no floor, and
      // cars hopped off it.
      for (let t = 0; t < tunnels.length; t++) {
        const p = tunnels[t];
        if (s >= p.s[0] + cell && s <= p.s[1] - cell && d < edge + TUNNEL_SIDE && gy < road + MOUTH_CLEAR) gy = road + MOUTH_CLEAR;
      }
      // (After it: past a gallery's wall, outside the tunnel, the ledge stays under the road.)
      if (ledge && gy > road - 0.5) gy = road - 0.5;
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
