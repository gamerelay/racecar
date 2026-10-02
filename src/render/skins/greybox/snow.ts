// Open ground drawn (docs/AVALANCHE.md): the track's heightfield (core/track/ground.ts), exactly the
// ground the car drives on, in tiles the camera culls (a 6 km run's ground is far more than it
// sees). Colored by what's under it: the road's own surface on the road (groomed snow on the piste,
// asphalt on a road), the verge's past it (powder), and grey rock where it's too steep for snow to
// sit (a canyon's lip, the walls at the edges). A road that isn't snow gets its lines painted on.

import { BufferAttribute, BufferGeometry, Color, Float32BufferAttribute, Mesh, type Object3D } from 'three';
import type { Track } from '../../../core/track/bake';
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
  return out;
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
