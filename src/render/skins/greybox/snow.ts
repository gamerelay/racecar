// Open ground drawn (docs/AVALANCHE.md): the track's heightfield (core/track/ground.ts), exactly the
// ground the car drives on, in tiles the camera culls (a 6 km run's ground is far more than it
// sees). Colored by what's under it: the road's own surface on the road (groomed snow on the piste,
// asphalt on a road), the verge's past it (powder), and grey rock where it's too steep for snow to
// sit (a canyon's lip, the walls at the edges). A road that isn't snow gets its lines painted on.

import { BufferAttribute, BufferGeometry, Color, Float32BufferAttribute, IcosahedronGeometry, Mesh, type Object3D } from 'three';
import type { Track } from '../../../core/track/bake';
import { hash01 } from '../../../core/rng';
import { toon } from './toon';

/** Steeper than this (rise per meter), it's rock. */
const ROCK = 1.1;
const ROCK_COLOR = new Color('#7d8796');
/** A tile's side, in cells. */
const TILE = 64;
/** The lines' lift off the ground: clear of it, under the skids. */
const LIFT = 0.05;

export function buildSnow(track: Track): Object3D[] {
  const g = track.ground!;
  const main = track.main;
  const { nx, nz, cell, x0, z0, h, lateral, near } = g;
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
          c.copy(Math.abs(lateral[k]) <= main.width[i] / 2 ? surfaceColors[main.surface[i]] : vergeColor);
          const steep = Math.hypot(hx, hz);
          if (steep > ROCK) c.lerp(ROCK_COLOR, Math.min(1, (steep - ROCK) * 2));
          col[o] = c.r;
          col[o + 1] = c.g;
          col[o + 2] = c.b;
        }
      }
      const index = new Uint32Array((w - 1) * (d - 1) * 6);
      let m = 0;
      for (let vz = 0; vz < d - 1; vz++) {
        for (let vx = 0; vx < w - 1; vx++) {
          const a = vz * w + vx;
          const b = a + w;
          index[m++] = a;
          index[m++] = b;
          index[m++] = a + 1;
          index[m++] = a + 1;
          index[m++] = b;
          index[m++] = b + 1;
        }
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new Float32BufferAttribute(nor, 3));
      geo.setAttribute('color', new Float32BufferAttribute(col, 3));
      geo.setIndex(new BufferAttribute(index, 1));
      geo.computeBoundingSphere();
      const mesh = new Mesh(geo, material);
      mesh.matrixAutoUpdate = false;
      out.push(mesh);
    }
  }
  const lines = roadLines(track);
  if (lines) out.push(lines);
  const rocks = buildRocks(track);
  if (rocks) out.push(rocks);
  const gates = buildGates(track);
  if (gates) out.push(gates);
  return out;
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
  /** A box: centered on `c`, `hu` along the unit `u` (level), `hv` up, `hw` across both. */
  const box = (c: number[], u: number[], hu: number, hv: number, hw: number, color: Color) => {
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
  };
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
      pos.push(x, g.height(x, z) + LIFT, z);
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
  for (let i = 0; i < last; i++) {
    const s = i * main.step;
    const wa = main.width[i] / 2;
    if (lines.some((at) => s >= at && s < at + 4)) {
      const cells = 12;
      for (let k = 0; k < cells; k++) quad(i, -wa + (k * 2 * wa) / cells, -wa + ((k + 1) * 2 * wa) / cells, (k + Math.floor(s)) % 2 === 0 ? white : black);
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
