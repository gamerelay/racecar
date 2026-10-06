// Open ground drawn (docs/AVALANCHE.md): the track's heightfield (core/track/ground), exactly the
// ground the car drives on, in tiles the camera culls (a 6 km run's ground is far more than it
// sees). Colored by what's under it: the road's own surface on the road (groomed snow on the piste,
// asphalt on a road), the verge's past it (powder), and grey rock where it's too steep for snow to
// sit (a canyon's lip, the walls at the edges). A road that isn't snow gets its lines painted on.
// The pines are the track's own list (core/track/pines.ts), each drawn where its collider stands.

import { BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, IcosahedronGeometry, InstancedMesh, LOD, Matrix4, Mesh, Quaternion, Vector3, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { smoothstep } from '../../../core/math';
import { VERGE_DEFAULT, type Track } from '../../../core/track/bake';
import { KIND_BEACH, KIND_BRANCH, KIND_LAVA_ROCK, KIND_ROAD, KIND_SAND, KIND_SHORE, noise, surfaceNoise } from '../../../core/track/ground';
import { TREE_PINE } from '../../../core/track/pines';
import { hash01 } from '../../../core/rng';
import { buildPortals, VERTEX } from './portal';
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
/** Where an island's road is uneven, it's laid over the ground in this many strips across (its lumps followed). */
const STRIPS = 6;

/** An island's ground (GroundDef.coast, docs/PARADISE.md): sand along the water, grass inland, black lava rock up the volcano. */
const SAND = new Color('#f3e8c8');
const SAND_WET = new Color('#d9c79a');
const LAVA_ROCK = new Color('#3a3336');
const LAVA_ROCK_2 = new Color('#463c3d');
const FOREST = new Color('#2a6b33');
const CRAG = new Color('#3f383b');
/** A coast's steep ground with no volcano (Coastal's Riviera): pale, warm limestone, not black crag. */
const LIMESTONE = new Color('#b9ad94');
/** Its darker beds, and the dry, olive scrub of a coast's grass in broad patches (the maquis). */
const LIMESTONE_BED = new Color('#9a8f78');
const SCRUB = new Color('#7f8f3e');
/** The volcano's lighter, ashier patches, and its warm earth. */
const ASH = new Color('#5e5558');
const EARTH = new Color('#4d3b31');
const rock = new Color();
const vergeC = new Color();

export function buildSnow(track: Track, green?: Color): Object3D[] {
  // (The palette's grass, softened toward the forest: on its own it's a lawn.)
  const grass = green?.clone().lerp(FOREST, 0.3);
  const g = track.ground!;
  const main = track.main;
  const { nx, nz, cell, x0, z0, h, lateral, near } = g;
  const isle = !!track.layout.ground?.coast;
  const volcano = track.layout.ground?.volcano;
  const grass2 = grass?.clone().offsetHSL(0.03, 0.05, 0.04);
  const vergeColor = new Color(track.surfaces[track.surfaceIndex.get(track.layout.shoulderSurface ?? 'powder') ?? 0].color);
  const surfaceColors = track.surfaces.map((s) => new Color(s.color));
  const at = (gx: number, gz: number) => h[Math.min(nz - 1, Math.max(0, gz)) * nx + Math.min(nx - 1, Math.max(0, gx))];
  const material = toon({ vertexColors: true });
  const out: Object3D[] = [];
  const c = new Color();
  // Where the ground comes down over a tunnel, it's cut to the tunnel's outline (portal.ts).
  const portals = buildPortals(track);
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
          const len = 1 / Math.hypot(hx, 1, hz);
          nor[o] = -hx * len;
          nor[o + 1] = len;
          nor[o + 2] = -hz * len;
          const i = near[k];
          // What the ground is (core's ground/surface.ts, the same the cars drive on): a road's own
          // surface; sand and wet sand; else the stretch's own verge (the volcano's ash, the jungle's
          // undergrowth), else the layout's.
          const kind = g.kind[k];
          const road = kind === KIND_ROAD || kind === KIND_BRANCH;
          c.copy(kind === KIND_BRANCH ? surfaceColors[g.branchSurface[k]] : road ? surfaceColors[main.surface[i]] : main.verge[i] === VERGE_DEFAULT ? vergeColor : surfaceColors[main.verge[i]]);
          const steep = Math.hypot(hx, hz);
          const x = pos[o];
          const z = pos[o + 2];
          // Smooth noise, so the edges between them wander instead of stepping cell by cell.
          const n = surfaceNoise(x, z);
          if (kind === KIND_SHORE) c.copy(SAND_WET);
          else if (kind === KIND_SAND) c.copy(SAND);
          // (A beach's sand a little damper in patches.)
          else if (kind === KIND_BEACH) c.copy(SAND).lerp(SAND_WET, 0.25 * smoothstep(0, 1, (n - 0.5) * 3));
          // A lava stream's rock: dark, in patches, scorched darker toward the lava.
          else if (kind === KIND_LAVA_ROCK) c.copy(LAVA_ROCK).lerp(LAVA_ROCK_2, smoothstep(0, 1, (n - 0.3) * 2.5)).lerp(ASH, 0.3 * smoothstep(0, 1, (noise(x, z, 9, 11) - 0.5) * 3));
          if (isle && !road && kind !== KIND_SHORE && kind !== KIND_SAND && kind !== KIND_BEACH && kind !== KIND_LAVA_ROCK) {
            const off = Math.abs(lateral[k]) - main.width[i] / 2;
            if (grass) {
              // Inland of the beach, the island's green, darkening into forest away from the roads;
              // a stretch's own verge (the volcano's ash, the jungle's undergrowth) by its road,
              // fading into it over a wandering edge rather than filling the ground to where the
              // next stretch's starts (straight-edged blocks of ash across the grass).
              vergeC.copy(c);
              c.copy(grass).lerp(grass2!, smoothstep(0, 1, (n - 0.45) * 4));
              c.lerp(FOREST, 0.6 * smoothstep(0, 1, (Math.abs(lateral[k]) - 25) / 60) * (0.5 + 0.5 * n));
              // A coast's (with no volcano) in broad patches of dry scrub, so a far hillside isn't one green.
              if (!volcano) c.lerp(SCRUB, 0.45 * smoothstep(0, 1, (noise(x, z, 70, 17) - 0.55) * 4));
              if (main.verge[i] !== VERGE_DEFAULT) c.lerp(vergeC, 1 - smoothstep(0, 1, (off - 10 - 25 * n) / 20));
            }
            // Black lava rock up the volcano, blended in at its edge: dark rock and lighter, ashier
            // patches and warm earth, at two sizes, not one tone.
            if (volcano) {
              const up = (0.62 + 0.1 * noise(x, z, 40, 9)) * volcano.r - Math.hypot(x - volcano.x, z - volcano.z);
              if (up > -12) {
                const fine = noise(x, z, 9, 11);
                const broad = noise(x, z, 55, 13);
                rock.copy(LAVA_ROCK).lerp(LAVA_ROCK_2, smoothstep(0, 1, (n - 0.3) * 2.5));
                rock.lerp(ASH, 0.75 * smoothstep(0, 1, (broad - 0.55) * 4));
                rock.lerp(EARTH, 0.6 * smoothstep(0, 1, (0.4 - broad) * 4));
                rock.multiplyScalar(0.9 + 0.2 * fine);
                c.lerp(rock, smoothstep(0, 1, (up + 12) / 24));
              }
            }
          }
          // (A volcanic island's crags are dark rock; a coast's without one pale limestone; the
          // mountains' grey.)
          // A coast's limestone in beds across the slope and patches, its edge with the grass wandering
          // but sharp (a smooth tan smear down every bank read as sand).
          if (isle && !volcano) {
            const edge = ROCK + 0.25 * (noise(x, z, 12, 23) - 0.5);
            if (steep > edge - 0.1) {
              rock.copy(LIMESTONE).lerp(LIMESTONE_BED, 0.7 * smoothstep(0, 1, Math.sin(h[k] * 1.3 + 3 * noise(x, z, 20, 29)) * 2 - 0.4));
              rock.multiplyScalar(0.9 + 0.18 * noise(x, z, 5, 31));
              c.lerp(rock, smoothstep(0, 1, (steep - edge + 0.1) * 6));
            }
          } else if (steep > ROCK) c.lerp(isle ? CRAG : ROCK_COLOR, Math.min(1, (steep - ROCK) * 2));
          col[o] = c.r;
          col[o + 1] = c.g;
          col[o + 2] = c.b;
        }
      }
      // The cells cut at a portal, each clipped once (its triangles' vertices after the skirt's),
      // and drawn at full detail in every level.
      const extra: number[] = [];
      const cut = new Map<number, number[]>();
      if (portals) {
        const vert = (k: number) => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2], nor[k * 3], nor[k * 3 + 1], nor[k * 3 + 2], col[k * 3], col[k * 3 + 1], col[k * 3 + 2]];
        for (let vz = 0; vz < d - 1; vz++)
          for (let vx = 0; vx < w - 1; vx++) {
            if (!portals.cells[(tz + vz) * nx + tx + vx]) continue;
            const a = vert(vz * w + vx);
            const b = vert((vz + 1) * w + vx);
            const a1 = vert(vz * w + vx + 1);
            const b1 = vert((vz + 1) * w + vx + 1);
            const tris: number[] = [];
            portals.clip(a, b, a1, extra, tris);
            portals.clip(a1, b, b1, extra, tris);
            cut.set(vz * (w - 1) + vx, tris);
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
      const base = all + edge.length;
      const P = new Float32Array((base + extra.length / VERTEX) * 3);
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
      for (let v = 0; v < extra.length / VERTEX; v++)
        for (let a = 0; a < 3; a++) {
          P[(base + v) * 3 + a] = extra[v * VERTEX + a];
          N[(base + v) * 3 + a] = extra[v * VERTEX + 3 + a];
          C[(base + v) * 3 + a] = extra[v * VERTEX + 6 + a];
        }
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
            // At a portal, the cells clipped to the tunnel's outline: at full detail only (further
            // off, a coarse quad drawn as fine cells left cracks against its coarse neighbours, and
            // a 7 m mouth is a few pixels there).
            let portal = false;
            for (let vz = zs[j]; vz < zs[j + 1] && !portal && cut.size && stride === 1; vz++) for (let vx = xs[i]; vx < xs[i + 1] && !portal; vx++) portal = cut.has(vz * (w - 1) + vx);
            if (portal) {
              for (let vz = zs[j]; vz < zs[j + 1]; vz++)
                for (let vx = xs[i]; vx < xs[i + 1]; vx++) {
                  const tris = cut.get(vz * (w - 1) + vx);
                  if (tris) for (const v of tris) index.push(base + v);
                  else index.push(vz * w + vx, (vz + 1) * w + vx, vz * w + vx + 1, vz * w + vx + 1, (vz + 1) * w + vx, (vz + 1) * w + vx + 1);
                }
              continue;
            }
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
 * Rocks (solid props of kind `rock`): on the piste lumpy, snow-capped, half buried; on a coast
 * (Coastal's Rocks) capped in limestone. Each fills its
 * collider (a box hx × hz across and along, 2 hy high): a little wider than the box's middle, as
 * high as its top, so what you see is what you hit.
 */
function buildRocks(track: Track): Mesh | null {
  const rocks = track.props.filter((p) => p.kind === 'rock');
  if (!rocks.length) return null;
  // (Snow on their tops on a mountain; on a coast, sun-bleached limestone: Coastal's Rocks.)
  const top = track.layout.ground?.coast ? LIMESTONE : CAP;
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
      c.copy(up > 0.82 ? top : up > -0.05 ? STONE : STONE_DARK);
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
 * road isn't snow (a piste has none), and the checkered finish across whatever it's on. On an
 * island (Paradise Open) no lines, but the roads themselves, main and branches, laid over the
 * ground in their own colors: the ground is colored per grid point, so on its own the grass
 * blended in over the road's edges.
 */
function roadLines(track: Track): Mesh | null {
  const g = track.ground!;
  const main = track.main;
  const pos: number[] = [];
  const col: number[] = [];
  const white = new Color('#f4efe6');
  const yellow = new Color('#ffc93c');
  const black = new Color('#120a20');
  const isle = !!track.layout.ground?.coast;
  const quad = (i: number, l0: number, l1: number, color: Color, sp = main, lift = LIFT) => {
    const j = sp.closed ? (i + 1) % sp.n : Math.min(sp.n - 1, i + 1);
    const p = (k: number, l: number) => {
      const x = sp.px[k] - sp.tz[k] * l;
      const z = sp.pz[k] + sp.tx[k] * l;
      // (The main road's floor, the one at its own height: not a tunnel's rock over it.)
      pos.push(x, (sp === main ? g.top(x, z, sp.py[k] + 1) : g.height(x, z)) + lift, z);
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
  const colors = new Map<number, Color>();
  const surfaceColor = (k: number) => {
    let c = colors.get(k);
    if (!c) colors.set(k, (c = new Color(track.surfaces[k].color)));
    return c;
  };
  /** Whether the main road is uneven `s` m along it (an `uneven` feature's stretch, a little past its ends). */
  const uneven = g.features.flatMap((f) => (f.def?.kind === 'uneven' ? [f.def.s] : []));
  const lumpy = (s: number) => uneven.some(([a, b]) => s >= a - 2 && s <= b + 2);
  const red = new Color('#e8433a');
  const blue = new Color('#2f6bff');
  // A drawbridge's span is its leaves (lifts.ts): no road drawn there.
  const lifted = g.pieces.list.flatMap((p) => (p.spline === main.index && p.lift ? [p.lift.s] : []));
  for (let i = 0; i < last; i++) {
    const s = i * main.step;
    const wa = main.width[i] / 2;
    if (lifted.some(([a, b]) => s + main.step > a && s < b)) continue;
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
    if (isle) {
      // Over a deck too (the Freeway's: track.ts leaves its road's top to this): where the deck's
      // road met this one across the road, the ground came up to within millimetres of the deck's
      // end and showed through it (a green line, the owner), and its edge was a line across it.
      // Where it's uneven, in strips across, so it follows the lumps and doesn't cut through them.
      const strips = lumpy(s) ? STRIPS : 1;
      for (let k = 0; k < strips; k++) quad(i, -wa + (k * 2 * wa) / strips, -wa + ((k + 1) * 2 * wa) / strips, surfaceColor(main.surface[i]), main, LIFT * 0.6);
      // Paved (not the jungle's earth), its lines: the owner lost the dark rim road against its ash.
      const surf = track.surfaces[main.surface[i]];
      if (surf.offroad || surf.slide) continue;
    } else if (track.surfaces[main.surface[i]].slide) continue;
    quad(i, -wa + 0.35, -wa + 0.5, white);
    quad(i, wa - 0.5, wa - 0.35, white);
    if (main.lanes[i] >= 4) {
      // Four lanes (the Riviera's boulevard): a double yellow down the middle, white dashes between
      // each way's two.
      quad(i, -0.3, -0.15, yellow);
      quad(i, 0.15, 0.3, yellow);
      if (s % 10 < 3.5) for (const at of [-wa / 2, wa / 2]) quad(i, at - 0.08, at + 0.08, white);
    } else if (s % 10 < 3.5) quad(i, -0.09, 0.09, yellow);
  }
  // A branch's road on the ground (not its decks or gaps), just under the main road's where they
  // meet: drawn on into the junction, so its edge there is its own, not the ground's cells (left to
  // the ground's colours, it was a staircase where it peeled off the main road).
  if (isle)
    for (const sp of track.splines) {
      if (sp === main) continue;
      const floors = g.pieces.floors(sp.index);
      const gaps = g.pieces.gaps(sp.index);
      for (let i = 0; i + 1 < sp.n; i++) {
        if (floors?.[i] || floors?.[i + 1] || gaps?.[i]) continue;
        quad(i, -sp.width[i] / 2, sp.width[i] / 2, surfaceColor(sp.surface[i]), sp, LIFT * 0.4);
      }
    }
  if (!pos.length) return null;
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const material = toon({ vertexColors: true });
  // Drawn over the ground it lies on, never fighting it.
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -2;
  const mesh = new Mesh(geo, material);
  mesh.matrixAutoUpdate = false;
  return mesh;
}
