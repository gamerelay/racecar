// Open ground drawn (docs/AVALANCHE.md): the track's heightfield (core/track/ground.ts), exactly the
// ground the car drives on, in tiles the camera culls (a 6 km run's ground is far more than it
// sees). Colored by what's under it: the road's own surface on the road (groomed snow on the piste,
// asphalt on a road), the verge's past it (powder), and grey rock where it's too steep for snow to
// sit (a canyon's lip, the walls at the edges). A road that isn't snow gets its lines painted on.
// The pines are the track's own list (core/track/pines.ts), each drawn where its collider stands.

import { BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, IcosahedronGeometry, InstancedMesh, LOD, Matrix4, Mesh, Quaternion, Vector3, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VERGE_DEFAULT, type Track } from '../../../core/track/bake';
import { noise } from '../../../core/track/ground';
import { TREE_PINE } from '../../../core/track/pines';
import { hash01 } from '../../../core/rng';
import { toon } from './toon';

/** Steeper than this (rise per meter), it's rock. */
const ROCK = 1.1;
const ROCK_COLOR = new Color('#7d8796');
/** A tile's side, in cells. */
const TILE = 64;
/**
 * Each tile in less detail further off (docs/AVALANCHE.md, item 9): every `stride`-th grid point
 * from `from` m (tile middle to camera). Looking down the run from the top, the whole mountain to
 * the far plane was 750 thousand triangles; a phone's budget is a fraction of that.
 */
const DETAIL = [
  { stride: 1, from: 0 },
  { stride: 2, from: 700 },
  { stride: 4, from: 1600 },
];
/** A skirt hangs this far down every tile's edge, so where a coarser tile meets a finer one there's snow in the gap, not sky. */
const SKIRT = 6;
/** The lines' lift off the ground: clear of it, under the skids. */
const LIFT = 0.05;

/** An island's ground (GroundDef.coast, docs/PARADISE.md): sand along the water, grass inland, black lava rock up the volcano. */
const SAND = new Color('#f3e8c8');
const SAND_WET = new Color('#d9c79a');
const LAVA_ROCK = new Color('#3a3336');
const LAVA_ROCK_2 = new Color('#463c3d');
const FOREST = new Color('#2a6b33');
const CRAG = new Color('#3f383b');
const smooth01 = (t: number) => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

export function buildSnow(track: Track, green?: Color): Object3D[] {
  // (The palette's grass, softened toward the forest: on its own it's a lawn.)
  const grass = green?.clone().lerp(FOREST, 0.3);
  const g = track.ground!;
  const main = track.main;
  const { nx, nz, cell, x0, z0, h, lateral, near } = g;
  const isle = !!track.layout.ground?.coast;
  const volcano = track.layout.ground?.volcano;
  const sea = g.sea ?? 0;
  const grass2 = grass?.clone().offsetHSL(0.03, 0.05, 0.04);
  const vergeColor = new Color(track.surfaces[track.surfaceIndex.get(track.layout.shoulderSurface ?? 'powder') ?? 0].color);
  const surfaceColors = track.surfaces.map((s) => new Color(s.color));
  const at = (gx: number, gz: number) => h[Math.min(nz - 1, Math.max(0, gz)) * nx + Math.min(nx - 1, Math.max(0, gx))];
  const material = toon({ vertexColors: true });
  const out: Object3D[] = [];
  const c = new Color();
  for (let tz = 0; tz < nz - 1; tz += TILE) {
    for (let tx = 0; tx < nx - 1; tx += TILE) {
      const w = Math.min(TILE, nx - 1 - tx) + 1;
      const d = Math.min(TILE, nz - 1 - tz) + 1;
      const pos = new Float32Array(w * d * 3);
      const nor = new Float32Array(w * d * 3);
      const col = new Float32Array(w * d * 3);
      for (let vz = 0; vz < d; vz++) {
        for (let vx = 0; vx < w; vx++) {
          const gx = tx + vx;
          const gz = tz + vz;
          const k = gz * nx + gx;
          const o = (vz * w + vx) * 3;
          pos[o] = x0 + gx * cell;
          pos[o + 1] = h[k];
          pos[o + 2] = z0 + gz * cell;
          // Normals from the whole grid, so tiles meet without a seam in the shading.
          const hx = (at(gx + 1, gz) - at(gx - 1, gz)) / (2 * cell);
          const hz = (at(gx, gz + 1) - at(gx, gz - 1)) / (2 * cell);
          const n = 1 / Math.hypot(hx, 1, hz);
          nor[o] = -hx * n;
          nor[o + 1] = n;
          nor[o + 2] = -hz * n;
          const i = near[k];
          // (Under a deck it's the ground, not the road: the road's up on the deck.)
          const road = (Math.abs(lateral[k]) <= main.width[i] / 2 && !g.deckSample[i]) || g.onBranch[k] === 2;
          // Off it, the stretch's own verge (the volcano's ash, the jungle's undergrowth), else the layout's.
          // (A branch's road is its own surface.)
          c.copy(g.onBranch[k] === 2 ? surfaceColors[g.branchSurface[k]] : road ? surfaceColors[main.surface[i]] : main.verge[i] === VERGE_DEFAULT ? vergeColor : surfaceColors[main.verge[i]]);
          const steep = Math.hypot(hx, hz);
          if (isle && !road) {
            const x = pos[o];
            const z = pos[o + 2];
            // Smooth noise, so the edges between them wander instead of stepping cell by cell.
            const n = noise(x, z, 23, 7);
            const verge = main.verge[i] === VERGE_DEFAULT ? -1 : main.verge[i];
            if (h[k] < sea + 0.4) c.copy(SAND_WET);
            else if (g.coast(x, z) < 12 + 12 * n && h[k] < sea + 4) c.copy(SAND);
            // Inland of the beach, the island's green (the jungle's own undergrowth by its roads),
            // darkening into forest away from the roads.
            else if (grass && verge < 0) {
              c.copy(grass).lerp(grass2!, smooth01((n - 0.45) * 4));
              c.lerp(FOREST, 0.6 * smooth01((Math.abs(lateral[k]) - 25) / 60) * (0.5 + 0.5 * n));
            }
            // Black lava rock up the volcano, blended in at its edge.
            if (volcano) {
              const up = (0.62 + 0.1 * noise(x, z, 40, 9)) * volcano.r - Math.hypot(x - volcano.x, z - volcano.z);
              if (up > -12) c.lerp(n > 0.5 ? LAVA_ROCK : LAVA_ROCK_2, smooth01((up + 12) / 24));
            }
          }
          // (An island's crags are dark volcanic rock, not the mountains' grey.)
          if (steep > ROCK) c.lerp(isle ? CRAG : ROCK_COLOR, Math.min(1, (steep - ROCK) * 2));
          col[o] = c.r;
          col[o + 1] = c.g;
          col[o + 2] = c.b;
        }
      }
      // The skirt: the edge's points again, SKIRT lower (the edge goes round the tile once).
      const edge: number[] = [];
      for (let vx = 0; vx < w; vx++) edge.push(vx);
      for (let vz = 1; vz < d; vz++) edge.push(vz * w + w - 1);
      for (let vx = w - 2; vx >= 0; vx--) edge.push((d - 1) * w + vx);
      for (let vz = d - 2; vz > 0; vz--) edge.push(vz * w);
      const all = w * d;
      const edgeAt = new Map(edge.map((k, e) => [k, all + e]));
      const skirt = (k: number) => edgeAt.get(k)!;
      const P = new Float32Array((all + edge.length) * 3);
      const N = new Float32Array(P.length);
      const C = new Float32Array(P.length);
      P.set(pos);
      N.set(nor);
      C.set(col);
      edge.forEach((k, e) => {
        for (let a = 0; a < 3; a++) {
          P[(all + e) * 3 + a] = pos[k * 3 + a] - (a === 1 ? SKIRT : 0);
          N[(all + e) * 3 + a] = nor[k * 3 + a];
          C[(all + e) * 3 + a] = col[k * 3 + a];
        }
      });
      // Relative to the tile's middle, so the detail can go by its distance.
      const cx = x0 + (tx + (w - 1) / 2) * cell;
      const cz = z0 + (tz + (d - 1) / 2) * cell;
      for (let v = 0; v < P.length; v += 3) {
        P[v] -= cx;
        P[v + 2] -= cz;
      }
      const position = new Float32BufferAttribute(P, 3);
      const normal = new Float32BufferAttribute(N, 3);
      const color = new Float32BufferAttribute(C, 3);
      const lod = new LOD();
      lod.position.set(cx, 0, cz);
      lod.updateMatrix();
      lod.matrixAutoUpdate = false;
      for (const { stride, from } of DETAIL) {
        // Every stride-th point across and down, and always the last, so every level has the same edge.
        const xs: number[] = [];
        for (let vx = 0; vx < w - 1; vx += stride) xs.push(vx);
        xs.push(w - 1);
        const zs: number[] = [];
        for (let vz = 0; vz < d - 1; vz += stride) zs.push(vz);
        zs.push(d - 1);
        const index: number[] = [];
        for (let j = 0; j < zs.length - 1; j++) {
          for (let i = 0; i < xs.length - 1; i++) {
            const a = zs[j] * w + xs[i];
            const b = zs[j + 1] * w + xs[i];
            const a1 = zs[j] * w + xs[i + 1];
            const b1 = zs[j + 1] * w + xs[i + 1];
            // Not over a tunnel's mouth: the slope's open there (Ground.hole).
            if (g.hole[(tz + zs[j]) * nx + tx + xs[i]] || g.hole[(tz + zs[j + 1]) * nx + tx + xs[i]] || g.hole[(tz + zs[j]) * nx + tx + xs[i + 1]] || g.hole[(tz + zs[j + 1]) * nx + tx + xs[i + 1]]) continue;
            index.push(a, b, a1, a1, b, b1);
          }
        }
        // The skirt along this level's edge, both faces (it's seen from either side).
        const ring = [...xs.map((x) => x), ...zs.slice(1).map((z) => z * w + w - 1), ...xs.slice(0, -1).reverse().map((x) => (d - 1) * w + x), ...zs.slice(1, -1).reverse().map((z) => z * w)];
        for (let r = 0; r < ring.length; r++) {
          const p = ring[r];
          const q = ring[(r + 1) % ring.length];
          const ps = skirt(p);
          const qs = skirt(q);
          index.push(p, ps, q, q, ps, qs, p, q, ps, q, qs, ps);
        }
        const geo = new BufferGeometry();
        geo.setAttribute('position', position);
        geo.setAttribute('normal', normal);
        geo.setAttribute('color', color);
        geo.setIndex(new BufferAttribute(Uint32Array.from(index), 1));
        geo.computeBoundingSphere();
        const mesh = new Mesh(geo, material);
        mesh.matrixAutoUpdate = false;
        lod.addLevel(mesh, from);
      }
      out.push(lod);
    }
  }
  const lines = roadLines(track);
  if (lines) out.push(lines);
  const rocks = buildRocks(track);
  if (rocks) out.push(rocks);
  const gates = buildGates(track);
  if (gates) out.push(gates);
  const tower = buildTower(track);
  if (tower) out.push(tower);
  out.push(...buildPines(track));
  return out;
}

/** Pines are grouped into chunks this big (m), so the camera culls the ones out of view. */
const PINE_CHUNK = 200;

/** One snow-laden pine, 10 m tall, its foot at the origin: a trunk, three tiers, snow on each. */
function pineModel(): BufferGeometry {
  const part = (geo: BufferGeometry, color: number, y: number) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.translate(0, y, 0);
    const c = new Color(color);
    const n = g.getAttribute('position').count;
    g.setAttribute('color', new Float32BufferAttribute(Array.from({ length: n * 3 }, (_, k) => [c.r, c.g, c.b][k % 3]), 3));
    g.deleteAttribute('uv');
    g.computeVertexNormals();
    return g;
  };
  const parts = [part(new CylinderGeometry(0.22, 0.3, 2.2, 6), 0x5a3f2c, 1.1)];
  // Tiers [radius, height, middle]: the snow on each a shallower cone at the same tip, so it shows.
  for (const [r, h, y] of [
    [3, 4, 3.4],
    [2.3, 3.4, 5.6],
    [1.5, 3, 7.7],
  ]) {
    parts.push(part(new ConeGeometry(r, h, 7), 0x2c5644, y));
    parts.push(part(new ConeGeometry(r * 0.62, h * 0.5, 7), 0xf3f7fc, y + h * 0.25 + 0.02));
  }
  return mergeGeometries(parts)!;
}

/** The pines (track.pines), instanced, a mesh per chunk of ground; each scaled to its height and turned its own way. */
function buildPines(track: Track): InstancedMesh[] {
  const p = track.pines;
  if (!p || !p.n) return [];
  const chunks = new Map<string, number[]>();
  for (let k = 0; k < p.n; k++) {
    // (An island's palms and jungle are openIsland.ts's.)
    if (p.kind[k] !== TREE_PINE) continue;
    const key = `${Math.floor(p.x[k] / PINE_CHUNK)},${Math.floor(p.z[k] / PINE_CHUNK)}`;
    let list = chunks.get(key);
    if (!list) chunks.set(key, (list = []));
    list.push(k);
  }
  const geo = pineModel();
  const material = toon({ vertexColors: true });
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const at = new Vector3();
  const sc = new Vector3();
  const out: InstancedMesh[] = [];
  for (const list of chunks.values()) {
    const mesh = new InstancedMesh(geo, material, list.length);
    list.forEach((k, j) => {
      const size = p.h[k] / 10;
      // Sunk a little, so a tree on a slope doesn't stand on one edge of its trunk.
      m.compose(at.set(p.x[k], p.y[k] - 0.3, p.z[k]), q.setFromAxisAngle(up, hash01(29, k, 0) * Math.PI * 2), sc.set(size, size, size));
      mesh.setMatrixAt(j, m);
    });
    mesh.computeBoundingSphere();
    mesh.matrixAutoUpdate = false;
    out.push(mesh);
  }
  return out;
}

/** A box into `pos`/`col`: centered on `c`, `hu` along the unit `u` (level), `hv` up, `hw` across both. */
function pushBox(pos: number[], col: number[], c: number[], u: number[], hu: number, hv: number, hw: number, color: Color): void {
  const w = [-u[2], 0, u[0]];
  const corner = (a: number, b: number, d: number) => [c[0] + u[0] * hu * a + w[0] * hw * d, c[1] + hv * b, c[2] + u[2] * hu * a + w[2] * hw * d];
  // Each face as two triangles, wound to face out.
  const faces: [number, number, number][][] = [
    [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]],
    [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]],
    [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]],
    [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]],
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
    [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]],
  ];
  for (const f of faces) {
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(...corner(...f[k]));
      col.push(color.r, color.g, color.b);
    }
  }
}

/** Boxes laid into `pos`/`col` as one toon mesh with vertex colors. */
function boxMesh(pos: number[], col: number[]): Mesh {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new Mesh(geo, toon({ vertexColors: true }));
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/**
 * A ski jump's judges' tower (a solid prop of kind `jump-tower`) beside its lip: four timber legs
 * as tall as the collider, a cabin with a window band on top, a roof, and striped banners down the
 * legs facing the run, to be seen from up the mountain.
 */
function buildTower(track: Track): Mesh | null {
  const t = track.props.find((p) => p.kind === 'jump-tower');
  if (!t) return null;
  const pos: number[] = [];
  const col: number[] = [];
  // Across the road (its right) and along it.
  const u = [-Math.cos(t.heading), 0, Math.sin(t.heading)];
  const along = [Math.sin(t.heading), 0, Math.cos(t.heading)];
  const top = t.y + 2 * t.hy;
  const legs = top - 4 - t.y + 1;
  for (const a of [-1, 1])
    for (const b of [-1, 1]) {
      const x = t.x + (u[0] * a + along[0] * b) * (t.hx - 0.3);
      const z = t.z + (u[2] * a + along[2] * b) * (t.hz - 0.3);
      pushBox(pos, col, [x, t.y - 1 + legs / 2, z], u, 0.3, legs / 2, 0.3, TIMBER);
    }
  // The cabin, its window band, the roof.
  pushBox(pos, col, [t.x, top - 2, t.z], u, t.hx, 2, t.hz, TIMBER_DARK);
  pushBox(pos, col, [t.x, top - 1.6, t.z], u, t.hx + 0.02, 0.6, t.hz + 0.02, new Color('#9fd3ff'));
  pushBox(pos, col, [t.x, top + 0.25, t.z], u, t.hx + 0.6, 0.25, t.hz + 0.6, BANNER);
  // Banners down the legs on the run's side, red and white.
  const side = t.lateral < 0 ? 1 : -1;
  for (let k = 0; k < 5; k++) {
    const y = top - 5 - k * 1.6;
    pushBox(pos, col, [t.x + u[0] * side * (t.hx + 0.05), y, t.z + u[2] * side * (t.hx + 0.05)], u, 0.05, 0.7, t.hz - 0.5, k % 2 ? BANNER_LIGHT : BANNER);
  }
  return boxMesh(pos, col);
}

const TIMBER = new Color('#6b4a32');
const TIMBER_DARK = new Color('#4f3524');
const BANNER = new Color('#e8433a');
const BANNER_LIGHT = new Color('#f4efe6');
const BANNER_DARK = new Color('#120a20');

/**
 * One run's gates (props of kind `gate-post`, a pair across the piste at its start and at its
 * finish): timber posts as tall as their colliders, a beam across their tops, and a banner under
 * it, striped red at the start and checkered at the finish, high enough to drive under.
 */
function buildGates(track: Track): Mesh | null {
  const posts = track.props.filter((p) => p.kind === 'gate-post');
  if (posts.length < 2 || !track.run) return null;
  const pos: number[] = [];
  const col: number[] = [];
  const box = (c: number[], u: number[], hu: number, hv: number, hw: number, color: Color) => pushBox(pos, col, c, u, hu, hv, hw, color);
  for (const s of [track.run.start, track.run.finish]) {
    const pair = posts.filter((p) => Math.abs(p.s - s) < 1);
    if (pair.length !== 2) continue;
    const [a, b] = pair;
    const top = Math.max(a.y, b.y) + 2 * Math.max(a.hy, b.hy);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const span = Math.hypot(dx, dz);
    const u = [dx / span, 0, dz / span];
    for (const p of pair) box([p.x, (p.y - 0.5 + top) / 2, p.z], u, p.hx, (top - p.y + 0.5) / 2, p.hz, TIMBER);
    const mid = [(a.x + b.x) / 2, top + 0.3, (a.z + b.z) / 2];
    box(mid, u, span / 2 + 0.6, 0.3, 0.35, TIMBER_DARK);
    // The banner: a strip under the beam, in cells.
    const finish = s === track.run.finish;
    const cells = Math.round(span / 1.4);
    for (let k = 0; k < cells; k++) {
      for (let row = 0; row < 2; row++) {
        const t = (k + 0.5) / cells - 0.5;
        const color = finish ? ((k + row) % 2 ? BANNER_DARK : BANNER_LIGHT) : row === 0 ? BANNER : k % 2 ? BANNER : BANNER_LIGHT;
        box([mid[0] + u[0] * span * t, top - 0.45 - row * 0.7, mid[2] + u[2] * span * t], u, span / cells / 2, 0.35, 0.08, color);
      }
    }
  }
  if (!pos.length) return null;
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new Mesh(geo, toon({ vertexColors: true }));
  mesh.matrixAutoUpdate = false;
  return mesh;
}

const CAP = new Color('#f7fbff');
const STONE = new Color('#4e5563');
const STONE_DARK = new Color('#3b404b');

/**
 * Rocks on the piste (solid props of kind `rock`): lumpy, snow-capped, half buried. Each fills its
 * collider (a box hx × hz across and along, 2 hy high): a little wider than the box's middle, as
 * high as its top, so what you see is what you hit.
 */
function buildRocks(track: Track): Mesh | null {
  const rocks = track.props.filter((p) => p.kind === 'rock');
  if (!rocks.length) return null;
  const pos: number[] = [];
  const col: number[] = [];
  const unit = new IcosahedronGeometry(1, 1);
  const u = unit.getAttribute('position');
  const c = new Color();
  rocks.forEach((p, r) => {
    const cos = Math.cos(p.heading);
    const sin = Math.sin(p.heading);
    // A rock's own lumps: each direction pushed in or out a little (the same on every screen).
    const lump = (x: number, y: number, z: number) => 0.82 + 0.3 * hash01(53 + r, Math.round(x * 3) * 7 + Math.round(z * 3), Math.round(y * 3));
    for (let k = 0; k < u.count; k += 3) {
      const tri: [number, number, number][] = [];
      for (let v = 0; v < 3; v++) {
        const x = u.getX(k + v);
        const y = u.getY(k + v);
        const z = u.getZ(k + v);
        const m = lump(x, y, z);
        // Across (x) and along (z) the road, turned to its heading (a rotation, so the faces keep facing out).
        const ax = x * p.hx * 1.2 * m;
        const az = z * p.hz * 1.2 * m;
        tri.push([p.x + ax * cos + az * sin, p.y + p.hy * 0.5 + Math.max(-0.6, y) * p.hy * 1.5 * m, p.z - ax * sin + az * cos]);
      }
      // Snow where it can sit (a face within about 35° of flat), rock on the steep sides, darker
      // where they overhang.
      const [a, b, d] = tri;
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const up = ny / (Math.hypot(nx, ny, nz) || 1);
      c.copy(up > 0.82 ? CAP : up > -0.05 ? STONE : STONE_DARK);
      for (const [x, y, z] of tri) {
        pos.push(x, y, z);
        col.push(c.r, c.g, c.b);
      }
    }
  });
  unit.dispose();
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new Mesh(geo, toon({ vertexColors: true }));
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/**
 * The main road's lines, painted on the ground: solid edges and a dashed yellow middle where the
 * road isn't snow (a piste has none), and the checkered finish across whatever it's on.
 */
function roadLines(track: Track): Mesh | null {
  const g = track.ground!;
  const main = track.main;
  const pos: number[] = [];
  const col: number[] = [];
  const white = new Color('#f4efe6');
  const yellow = new Color('#ffc93c');
  const black = new Color('#120a20');
  const quad = (i: number, l0: number, l1: number, color: Color) => {
    const j = main.closed ? (i + 1) % main.n : Math.min(main.n - 1, i + 1);
    const p = (k: number, l: number) => {
      const x = main.px[k] - main.tz[k] * l;
      const z = main.pz[k] + main.tx[k] * l;
      pos.push(x, g.top(x, z) + LIFT, z);
      col.push(color.r, color.g, color.b);
    };
    // Two triangles, facing up (right × along is up): (i, l0) (i, l1) (j, l0), then (i, l1) (j, l1) (j, l0).
    p(i, l0);
    p(i, l1);
    p(j, l0);
    p(i, l1);
    p(j, l1);
    p(j, l0);
  };
  const last = main.closed ? main.n : main.n - 1;
  // The finish line (a loop's is its start too); one run's start line, as checkered.
  const lines = track.run ? [track.run.start, track.run.finish] : [0];
  // A ski jump's landing hill: a blue line every 25 m of flight from 75 m, red at 150 m (its K-point).
  const jump = track.layout.skiJump;
  const marks = jump ? [75, 100, 125, 150, 175, 200, 225].filter((d) => d < jump.landing).map((d) => jump.lip + d) : [];
  const red = new Color('#e8433a');
  const blue = new Color('#2f6bff');
  for (let i = 0; i < last; i++) {
    const s = i * main.step;
    const wa = main.width[i] / 2;
    if (lines.some((at) => s >= at && s < at + 4)) {
      const cells = 12;
      for (let k = 0; k < cells; k++) quad(i, -wa + (k * 2 * wa) / cells, -wa + ((k + 1) * 2 * wa) / cells, (k + Math.floor(s)) % 2 === 0 ? white : black);
      continue;
    }
    const mark = marks.find((at) => s >= at && s < at + Math.max(2, main.step));
    if (mark !== undefined) {
      quad(i, -wa, wa, mark === jump!.lip + 150 ? red : blue);
      continue;
    }
    if (track.surfaces[main.surface[i]].slide) continue;
    quad(i, -wa + 0.35, -wa + 0.5, white);
    quad(i, wa - 0.5, wa - 0.35, white);
    if (s % 10 < 3.5) quad(i, -0.09, 0.09, yellow);
  }
  if (!pos.length) return null;
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new Mesh(geo, toon({ vertexColors: true }));
  mesh.matrixAutoUpdate = false;
  return mesh;
}
