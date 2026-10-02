// Open ground drawn (docs/AVALANCHE.md): the track's heightfield (core/track/ground.ts) as one mesh,
// exactly the ground the car drives on. Colored by what's under it: the road's own surface on the
// road (groomed snow on the piste, asphalt on a road), the verge's past it (powder), and grey rock
// where it's too steep for snow to sit (a canyon's lip, the walls at the edges).

import { BufferAttribute, BufferGeometry, Color, Float32BufferAttribute, Mesh, type Object3D } from 'three';
import type { Track } from '../../../core/track/bake';
import { toon } from './toon';

/** Steeper than this (rise per meter), it's rock. */
const ROCK = 1.1;
const ROCK_COLOR = new Color('#7d8796');

export function buildSnow(track: Track): Object3D[] {
  const g = track.ground!;
  const main = track.main;
  const { nx, nz, cell, x0, z0, h, lateral, near } = g;
  const verge = track.surfaces[track.surfaceIndex.get(track.layout.shoulderSurface ?? 'powder') ?? 0].color;
  const vergeColor = new Color(verge);
  const surfaceColors = track.surfaces.map((s) => new Color(s.color));
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const c = new Color();
  for (let gz = 0; gz < nz; gz++) {
    for (let gx = 0; gx < nx; gx++) {
      const k = gz * nx + gx;
      pos[k * 3] = x0 + gx * cell;
      pos[k * 3 + 1] = h[k];
      pos[k * 3 + 2] = z0 + gz * cell;
      const i = near[k];
      const onRoad = i >= 0 && Math.abs(lateral[k]) <= main.width[i] / 2;
      c.copy(onRoad ? surfaceColors[main.surface[i]] : vergeColor);
      // Rock where it's steep.
      const hx = (h[gz * nx + Math.min(nx - 1, gx + 1)] - h[gz * nx + Math.max(0, gx - 1)]) / (2 * cell);
      const hz = (h[Math.min(nz - 1, gz + 1) * nx + gx] - h[Math.max(0, gz - 1) * nx + gx]) / (2 * cell);
      const steep = Math.hypot(hx, hz);
      if (steep > ROCK) c.lerp(ROCK_COLOR, Math.min(1, (steep - ROCK) * 2));
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
    }
  }
  const index = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let n = 0;
  for (let gz = 0; gz < nz - 1; gz++) {
    for (let gx = 0; gx < nx - 1; gx++) {
      const a = gz * nx + gx;
      const d = a + nx;
      index[n++] = a;
      index[n++] = d;
      index[n++] = a + 1;
      index[n++] = a + 1;
      index[n++] = d;
      index[n++] = d + 1;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.setIndex(new BufferAttribute(index, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new Mesh(geo, toon({ vertexColors: true }));
  mesh.matrixAutoUpdate = false;
  return [mesh];
}
