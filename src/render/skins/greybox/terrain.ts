// The land under open-country layouts (scenery only: the sim drives on the road). A heightfield
// that meets every road at its edges, rises into hills away from them, and climbs into mountains
// toward the edge of the map; the river from the layout carved through it. Roads that run over
// the river or over another part of the lap are left out of the land's shape, so they come out as
// bridges: `deck` marks those samples for the track builder.
//
// An island (Paradise) has a coastline instead of valley walls: past it the land falls away under
// the sea, a beach band runs round it, and a volcano's cone rises where the layout puts it. Roads
// out over the water are decks too (the Freeway over the bay), and the sea is a plane out to the
// horizon, shallow and turquoise over the sand, deep blue further out.

import { BufferAttribute, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Mesh, NoBlending, ShaderMaterial, UniformsLib, UniformsUtils, type Object3D } from 'three';
import { smoothstep as smooth } from '../../../core/math';
import type { Track } from '../../../core/track/bake';
import { coneHeight, curve, loopDist } from '../../../core/track/island';
import { toon } from './toon';
import type { Palette } from './palettes';

export interface Terrain {
  /** Land height at (x, z), bilinear between grid points. */
  height(x: number, z: number): number;
  /** Distance to the river's middle (Infinity with no river). */
  river(x: number, z: number): number;
  /** Per spline: 1 where the road is a bridge (over the river, or over another road). */
  deck: Uint8Array[];
  /** The land mesh and the river's water. */
  objects: Object3D[];
  /** The river's water level, and half its width. */
  riverY: number;
  riverHalf: number;
  /** For animated water. */
  time: { value: number };
  /** On an island: the sea's level, and the signed distance to the coast (positive inland). */
  sea?: { y: number; coast(x: number, z: number): number };
}

const CELL = 6;
const MARGIN = 720;
const ISLAND_MARGIN = 160;
/** An island's beach: the land's height at the waterline above the sea, how steep the land rises inland of it (1:x), and the sea bed's depth. */
const SHORE = 1.2;
const SHORE_RISE = 0.6;
const SEA_BED = 9;
/** How far a road shapes the land around it. */
const REACH = 120;

/** Smooth value noise in [-1, 1]. */
function noise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const h = (a: number, b: number) => {
    let n = (a * 374761393 + b * 668265263 + seed * 144269) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = h(xi, zi) + (h(xi + 1, zi) - h(xi, zi)) * u;
  const b = h(xi, zi + 1) + (h(xi + 1, zi + 1) - h(xi, zi + 1)) * u;
  return (a + (b - a) * v) * 2 - 1;
}

const hills = (x: number, z: number, seed: number) => 26 * noise(x / 260, z / 260, seed) + 8 * noise(x / 85, z / 85, seed + 1) + 2 * noise(x / 28, z / 28, seed + 2);


/** Distance from (x, z) to a polyline. */
function polyDist(poly: [number, number][], x: number, z: number): number {
  let best = Infinity;
  for (let k = 0; k + 1 < poly.length; k++) {
    const [ax, az] = poly[k];
    const [bx, bz] = poly[k + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

// (The island's shapes live in the core, so open ground builds the same island: core/track/island.ts.)
export { coneHeight, loopDist };

export function buildTerrain(track: Track, palette: Palette, seed: number): Terrain {
  const spec = track.layout.terrain ?? {};
  const river = spec.river ? curve(spec.river) : null;
  const riverHalf = (spec.riverWidth ?? 20) / 2;
  const riverY = spec.riverY ?? -4;
  // Exact distance for the few road samples; the grid below answers it everywhere else.
  const riverExact = (x: number, z: number) => (river ? polyDist(river, x, z) : Infinity);
  // An island: the sea round a coastline, and maybe a volcano.
  const coastLoop = spec.island && spec.island.length > 2 ? curve([...spec.island, spec.island[0]], 12) : null;
  const seaY = spec.sea ?? 0;
  const coast = (x: number, z: number) => (coastLoop ? loopDist(coastLoop, x, z) : Infinity);
  const volcano = spec.volcano;

  // ---- road samples, and which are bridges ----
  interface S {
    x: number;
    z: number;
    y: number;
    half: number;
    walled: boolean;
    sp: number;
    i: number;
    /** The road's right, and the bank's slope along it: the land follows the banked surface. */
    rx: number;
    rz: number;
    tb: number;
  }
  const samples: S[] = [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, ySum = 0;
  for (const sp of track.splines) {
    for (let i = 0; i < sp.n; i += 3) {
      const s: S = { x: sp.px[i], z: sp.pz[i], y: sp.py[i], half: sp.width[i] / 2 + sp.shoulder[i], walled: sp.wallL[i] === 1 || sp.wallR[i] === 1, sp: sp.index, i, rx: -sp.tz[i], rz: sp.tx[i], tb: Math.tan(sp.bank[i]) };
      samples.push(s);
      x0 = Math.min(x0, s.x);
      x1 = Math.max(x1, s.x);
      z0 = Math.min(z0, s.z);
      z1 = Math.max(z1, s.z);
      ySum += s.y;
    }
  }
  const meanY = ySum / samples.length;
  const deck = track.splines.map((sp) => new Uint8Array(sp.n));
  // A spatial hash of samples, 20 m cells, for "is there a road under this one".
  const HC = 20;
  const hash = new Map<number, S[]>();
  const key = (cx: number, cz: number) => cx * 73856093 + cz * 19349663;
  for (const s of samples) {
    const k = key(Math.floor(s.x / HC), Math.floor(s.z / HC));
    let list = hash.get(k);
    if (!list) hash.set(k, (list = []));
    list.push(s);
  }
  const bridgeAt = (s: S) => {
    if (riverExact(s.x, s.z) < riverHalf + s.half + 4) return true;
    if (coastLoop && coast(s.x, s.z) < s.half + 6) return true;
    const cx = Math.floor(s.x / HC);
    const cz = Math.floor(s.z / HC);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (const o of hash.get(key(cx + a, cz + b)) ?? []) {
          if (o.y > s.y - 6) continue;
          if (Math.hypot(o.x - s.x, o.z - s.z) < o.half + s.half + 3) return true;
        }
      }
    }
    return false;
  };
  for (const s of samples) if (bridgeAt(s)) deck[s.sp].fill(1, Math.max(0, s.i - 1), Math.min(deck[s.sp].length, s.i + 2));
  // Grow each bridge a little at both ends (abutments), and drop slivers.
  for (const [k, sp] of track.splines.entries()) {
    const m = deck[k];
    const grow = Math.round(10 / sp.step);
    const out = new Uint8Array(m.length);
    for (let i = 0; i < m.length; i++) if (m[i]) out.fill(1, Math.max(0, i - grow), Math.min(m.length, i + grow + 1));
    let i = 0;
    while (i < out.length) {
      if (!out[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < out.length && out[j]) j++;
      if ((j - i) * sp.step < 24) out.fill(0, i, j);
      i = j;
    }
    deck[k] = out;
  }

  // ---- the heightfield ----
  // An island's land stops a little way out under the sea (the sea plane goes on to the horizon).
  const margin = coastLoop ? ISLAND_MARGIN : MARGIN;
  if (coastLoop) {
    for (const [x, z] of coastLoop) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
  }
  const gx0 = Math.floor((x0 - margin) / CELL) * CELL;
  const gz0 = Math.floor((z0 - margin) / CELL) * CELL;
  const nx = Math.ceil((x1 + margin - gx0) / CELL) + 1;
  const nz = Math.ceil((z1 + margin - gz0) / CELL) + 1;
  const wsum = new Float32Array(nx * nz);
  const wy = new Float32Array(nx * nz);
  const dmin = new Float32Array(nx * nz).fill(Infinity);
  // A sharper blend of nearby roads' heights: where two roads meet (the switchbacks' legs), the
  // land between them slopes from one to the other instead of stepping at the midline.
  const wsum2 = new Float32Array(nx * nz);
  const wy2 = new Float32Array(nx * nz);
  const flat = new Float32Array(nx * nz);
  // Under any road's footprint the land stays below that road (where two overlap, the lower wins).
  const cap = new Float32Array(nx * nz).fill(Infinity);
  const reachCells = Math.ceil(REACH / CELL);
  for (const s of samples) {
    if (deck[s.sp][s.i]) continue;
    const ci = Math.round((s.x - gx0) / CELL);
    const cj = Math.round((s.z - gz0) / CELL);
    for (let j = Math.max(0, cj - reachCells); j <= Math.min(nz - 1, cj + reachCells); j++) {
      for (let i = Math.max(0, ci - reachCells); i <= Math.min(nx - 1, ci + reachCells); i++) {
        const dx = gx0 + i * CELL - s.x;
        const dz = gz0 + j * CELL - s.z;
        const d = Math.hypot(dx, dz);
        if (d > REACH) continue;
        const e = Math.max(0, d - s.half);
        // The road's height across from here: banked, and level past its edge.
        const lat = Math.max(-s.half, Math.min(s.half, dx * s.rx + dz * s.rz));
        const y = s.y - lat * s.tb;
        const w = 1 / (1 + (e / 16) ** 2) ** 2;
        const k = j * nx + i;
        wsum[k] += w;
        wy[k] += w * y;
        const w2 = 1 / (1 + (e / 3) ** 2) ** 3;
        wsum2[k] += w2;
        wy2[k] += w2 * y;
        if (e < 1.5) cap[k] = Math.min(cap[k], y - 0.6);
        if (e < dmin[k]) {
          dmin[k] = e;
          flat[k] = s.walled ? 4 : 12;
        }
      }
    }
  }
  const h = new Float32Array(nx * nz);
  // On an island, each grid point's signed distance to the coast (for the land's colors).
  const cd = new Float32Array(nx * nz).fill(Infinity);
  // Distance to the river, splatted from points along it (only near it matters: past RIVER_REACH
  // it's Infinity).
  const RIVER_REACH = 60;
  const rd = new Float32Array(nx * nz).fill(Infinity);
  if (river) {
    const rc = Math.ceil(RIVER_REACH / CELL);
    for (let k = 0; k + 1 < river.length; k++) {
      const [ax, az] = river[k];
      const [bx, bz] = river[k + 1];
      const ci = Math.round((ax - gx0) / CELL);
      const cj = Math.round((az - gz0) / CELL);
      const dx = bx - ax;
      const dz = bz - az;
      const len2 = dx * dx + dz * dz || 1;
      for (let j = Math.max(0, cj - rc); j <= Math.min(nz - 1, cj + rc); j++) {
        for (let i = Math.max(0, ci - rc); i <= Math.min(nx - 1, ci + rc); i++) {
          const x = gx0 + i * CELL;
          const z = gz0 + j * CELL;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
          const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
          const kk = j * nx + i;
          if (d < rd[kk]) rd[kk] = d;
        }
      }
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = gx0 + i * CELL;
      const z = gz0 + j * CELL;
      const d = dmin[k];
      // (A faint prior toward the average road height keeps this continuous where the roads' reach ends.)
      const far = (wy[k] + meanY * 2e-3) / (wsum[k] + 2e-3);
      const near = wsum2[k] > 0 ? wy2[k] / wsum2[k] : far;
      // Away from the roads, hills; and the land climbs toward the map's edge (the valley walls).
      const fl = d === Infinity ? 12 : flat[k];
      const away = d === Infinity ? 1 : smooth(fl, fl + 40, d);
      // Only a little rise away from each road (so a ridge road still has land falling off it), and
      // mountains toward the map's edge.
      // (An island has no valley walls: the sea is at its edge.)
      const rise = 0.035 * Math.max(0, (d === Infinity ? REACH : d) - 30) + (coastLoop ? 0 : 0.1 * Math.min(600, distOutside(x, z)));
      let land = far + hills(x, z, seed) * smooth(fl, fl + 110, d === Infinity ? 999 : d) + rise;
      if (volcano) land = Math.max(land, seaY + coneHeight(volcano, x, z));
      let y = d === Infinity ? land : near - 0.6 + (land - (near - 0.6)) * away;
      if (coastLoop) {
        // The coast: inland, never under the sea; toward the water, down to the beach and under it.
        const sd = coast(x, z);
        if (sd > 20) y = Math.max(y, seaY + SHORE);
        const shore = seaY - SEA_BED + (SEA_BED + SHORE) * smooth(-90, 2, sd) + Math.max(0, sd - 2) * SHORE_RISE;
        y = Math.min(y, shore);
        cd[k] = sd;
      }
      // The river's channel.
      const r = rd[k];
      if (r < riverHalf + 24) {
        const bed = riverY - 2.2;
        const t = smooth(riverHalf - 4, riverHalf + 24, r);
        y = Math.min(y, bed + (Math.max(y, riverY + 1.2) - bed) * t);
      }
      h[k] = Math.min(y, cap[k]);
    }
  }
  function distOutside(x: number, z: number): number {
    const dx = Math.max(x0 - x, 0, x - x1);
    const dz = Math.max(z0 - z, 0, z - z1);
    return Math.hypot(dx, dz);
  }
  const height = (x: number, z: number) => {
    const fx = Math.min(nx - 1.001, Math.max(0, (x - gx0) / CELL));
    const fz = Math.min(nz - 1.001, Math.max(0, (z - gz0) / CELL));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const k = j * nx + i;
    const a = h[k] + (h[k + 1] - h[k]) * u;
    const b = h[k + nx] + (h[k + nx + 1] - h[k + nx]) * u;
    return a + (b - a) * v;
  };

  // ---- the land mesh: flat facets, colored by what the ground is ----
  const grass = new Color(palette.ground);
  const grass2 = new Color(palette.ground).offsetHSL(0.03, 0.05, 0.04);
  const forest = new Color(palette.ground).offsetHSL(0.02, -0.05, -0.08);
  const rock = new Color(0x7d7264);
  const rock2 = new Color(0x6a6155);
  const mud = new Color(0x8f7a55);
  const sand = new Color(0xf3e8c8);
  const sand2 = new Color(0xeadcb4);
  const lava = new Color(0x3a3336);
  const lava2 = new Color(0x463c3d);
  const c = new Color();
  const pos = new Float32Array((nx - 1) * (nz - 1) * 6 * 3);
  const col = new Float32Array(pos.length);
  let p = 0;
  const vert = (i: number, j: number) => {
    const k = j * nx + i;
    pos[p] = gx0 + i * CELL;
    pos[p + 1] = h[k];
    pos[p + 2] = gz0 + j * CELL;
    p += 3;
  };
  const tint = (from: number, i: number, j: number) => {
    // One color per triangle, from its steepness and what's near.
    const k = j * nx + i;
    const ax = pos[from], ay = pos[from + 1], az = pos[from + 2];
    const bx = pos[from + 3], by = pos[from + 4], bz = pos[from + 5];
    const cx = pos[from + 6], cy = pos[from + 7], cz = pos[from + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nxv = uy * vz - uz * vy;
    const nyv = uz * vx - ux * vz;
    const nzv = ux * vy - uy * vx;
    const steep = 1 - Math.abs(nyv) / Math.hypot(nxv, nyv, nzv);
    const n = noise(ax / 17, az / 17, seed + 5);
    const cone = volcano ? Math.hypot(ax - volcano.x, az - volcano.z) / volcano.r : 9;
    if (rd[k] < riverHalf + 5) c.copy(mud);
    else if (cd[k] < 14 + 6 * n && ay < seaY + 4) c.copy(n > 0 ? sand : sand2);
    else if (cone < 0.62 + 0.08 * n) c.copy(n > 0 ? lava : lava2);
    else if (steep > 0.45) c.copy(n > 0 ? rock : rock2);
    else if (dmin[k] > 30 && dmin[k] !== Infinity) c.copy(forest).lerp(grass, 0.3 + 0.3 * n);
    else c.copy(n > 0.2 ? grass2 : grass);
    for (let q = 0; q < 3; q++) col.set([c.r, c.g, c.b], from + q * 3);
  };
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      let from = p;
      vert(i, j);
      vert(i, j + 1);
      vert(i + 1, j);
      tint(from, i, j);
      from = p;
      vert(i + 1, j);
      vert(i, j + 1);
      vert(i + 1, j + 1);
      tint(from, i, j);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('color', new BufferAttribute(col, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const land = new Mesh(geo, toon({ vertexColors: true }));
  land.matrixAutoUpdate = false;
  const objects: Object3D[] = [land];

  const time = { value: 0 };
  if (river) objects.push(water(river, riverHalf + 2, riverY, time));
  if (coastLoop) objects.push(sea(seaY, gx0, gz0, nx, nz, h, time, palette.seaLight ?? 0xffffff));
  const riverAt = (x: number, z: number) => {
    const i = Math.round((x - gx0) / CELL);
    const j = Math.round((z - gz0) / CELL);
    if (i < 0 || j < 0 || i >= nx || j >= nz) return Infinity;
    return rd[j * nx + i];
  };
  return { height, river: riverAt, deck, objects, riverY, riverHalf, time, ...(coastLoop ? { sea: { y: seaY, coast } } : {}) };
}

/** How far the sea plane reaches past the land's grid: to the fog, and the horizon. */
const SEA_REACH = 2600;
/** The sea's grid, over the land: coarser than the land's (its depth only sets a tint). */
const SEA_CELL = 12;

/**
 * The sea: a grid over the land's extent, tinted by the depth of the land under it (turquoise over
 * the sand, deep blue further out, foam on the waterline), inside one big plane out to the horizon.
 * Its alpha is cleared like the river's, so the post pass mirrors the sky and the island in it.
 */
export function sea(y: number, gx0: number, gz0: number, nx: number, nz: number, h: Float32Array, time: { value: number }, light: number, cell = CELL): Mesh {
  const pos: number[] = [];
  const depth: number[] = [];
  const idx: number[] = [];
  const step = Math.max(1, Math.round(SEA_CELL / cell));
  const cols = Math.floor((nx - 1) / step) + 1;
  const rows = Math.floor((nz - 1) / step) + 1;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      pos.push(gx0 + i * step * cell, y, gz0 + j * step * cell);
      // The edge of the grid is deep, so it meets the plane round it seamlessly.
      const edge = i === 0 || j === 0 || i === cols - 1 || j === rows - 1;
      depth.push(edge ? SEA_BED : y - h[j * step * nx + i * step]);
    }
  }
  for (let j = 0; j + 1 < rows; j++) {
    for (let i = 0; i + 1 < cols; i++) {
      const a = j * cols + i;
      // Skip cells that are dry land all round (it hides them anyway), to save fill.
      if (Math.max(depth[a], depth[a + 1], depth[a + cols], depth[a + cols + 1]) < -1) continue;
      idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
    }
  }
  // The open sea round the grid: a ring of four quads out to SEA_REACH.
  const x0 = gx0;
  const z0 = gz0;
  const x1 = gx0 + (cols - 1) * step * cell;
  const z1 = gz0 + (rows - 1) * step * cell;
  const R = SEA_REACH;
  const ring = (ax: number, az: number, bx: number, bz: number) => {
    const base = pos.length / 3;
    pos.push(ax, y, az, bx, y, az, bx, y, bz, ax, y, bz);
    depth.push(SEA_BED, SEA_BED, SEA_BED, SEA_BED);
    idx.push(base, base + 3, base + 1, base + 1, base + 3, base + 2);
  };
  ring(x0 - R, z0 - R, x1 + R, z0);
  ring(x0 - R, z1, x1 + R, z1 + R);
  ring(x0 - R, z0, x0, z1);
  ring(x1, z0, x1 + R, z1);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('depth', new Float32BufferAttribute(depth, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const mat = new ShaderMaterial({
    uniforms: { ...UniformsUtils.clone(UniformsLib.fog), uTime: time, uLight: { value: new Color(light) } },
    fog: true,
    side: DoubleSide,
    blending: NoBlending,
    // Waves: a swell rolling in over the shallows, gone in the deep (and at the waterline, so the
    // sea never lifts off the beach).
    vertexShader: `attribute float depth;uniform float uTime;varying float vDepth;varying vec2 vXz;
      #include <fog_pars_vertex>
      void main(){vDepth=depth;vXz=position.xz;vec3 p=position;
      p.y+=0.22*sin(depth*1.6-uTime*1.6+sin(position.x*0.03)*2.0)*smoothstep(0.3,1.2,depth)*(1.0-smoothstep(3.0,7.0,depth));
      vec4 mvPosition=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime;uniform vec3 uLight;varying float vDepth;varying vec2 vXz;
      #include <fog_pars_fragment>
      void main(){
        // Turquoise over the sand, deep blue out past the reef (in the palette's light).
        vec3 col=mix(vec3(0.33,0.86,0.82),vec3(0.07,0.42,0.62),smoothstep(0.4,4.5,vDepth));
        col=mix(col,vec3(0.04,0.2,0.42),smoothstep(5.0,9.0,vDepth));
        // Foam on the waterline, pulsing up the beach, and a line of it breaking further out.
        float foam=1.0-smoothstep(0.0,0.35+0.2*sin(uTime*1.3+vXz.x*0.05+vXz.y*0.04),vDepth);
        float swell=sin(vDepth*5.0-uTime*1.6+sin(vXz.x*0.03)*2.0);
        foam=max(foam,step(0.93,swell)*(1.0-smoothstep(0.8,2.2,vDepth))*0.8);
        col=mix(col,vec3(0.95,0.98,0.96),foam)*uLight;
        // Alpha out where it's deep enough to mirror (the post pass's mask), none in the foam.
        float mirror=smoothstep(0.6,3.0,vDepth)*(1.0-foam);
        gl_FragColor=vec4(col,1.0-mirror*0.75);
        #include <fog_fragment>
      }`,
  });
  const mesh = new Mesh(g, mat);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * The river's water: a strip along its course with flowing streaks, foam at the banks, and a
 * cleared alpha, which the post pass reads as a mirror (reflections in any weather).
 */
export function water(path: [number, number][], half: number, y: number, time: { value: number }): Mesh {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let along = 0;
  for (let k = 0; k < path.length; k++) {
    const a = path[Math.max(0, k - 1)];
    const b = path[Math.min(path.length - 1, k + 1)];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    const rx = -dz / l;
    const rz = dx / l;
    if (k > 0) along += Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
    pos.push(path[k][0] - rx * half, y, path[k][1] - rz * half, path[k][0] + rx * half, y, path[k][1] + rz * half);
    uv.push(0, along, 1, along);
    if (k > 0) {
      const i = (k - 1) * 2;
      idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const mat = new ShaderMaterial({
    uniforms: { ...UniformsUtils.clone(UniformsLib.fog), uTime: time },
    fog: true,
    side: DoubleSide,
    // Opaque color, but the alpha channel is the post pass's mirror mask: written as given.
    blending: NoBlending,
    vertexShader: `varying vec2 vUv;
      #include <fog_pars_vertex>
      void main(){vUv=uv;vec4 mvPosition=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime;varying vec2 vUv;
      #include <fog_pars_fragment>
      float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
      void main(){
        float edge=min(vUv.x,1.0-vUv.x);
        // Streaks drifting downstream, broken up across the width.
        float lane=floor(vUv.x*9.0);
        float s=fract(vUv.y*0.045-uTime*(0.35+h(vec2(lane,1.0))*0.3)+h(vec2(lane,2.0)));
        float streak=step(0.9,s)*step(0.35,fract(vUv.x*9.0))*step(fract(vUv.x*9.0),0.6);
        float foam=1.0-smoothstep(0.0,0.07,edge);
        vec3 col=mix(vec3(0.16,0.33,0.38),vec3(0.1,0.22,0.3),smoothstep(0.1,0.5,edge));
        col=mix(col,vec3(0.78,0.88,0.86),max(streak*0.3,foam*0.7));
        // Alpha out in the middle: the post pass mirrors there (and in the rain as well).
        float mirror=smoothstep(0.06,0.2,edge)*(1.0-streak*0.6);
        gl_FragColor=vec4(col,1.0-mirror*0.9);
        #include <fog_fragment>
      }`,
  });
  const mesh = new Mesh(g, mat);
  mesh.renderOrder = 1;
  return mesh;
}
