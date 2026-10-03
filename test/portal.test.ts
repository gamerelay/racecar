// Portals (docs/CALDERA.md, step 1b; render/skins/greybox/portal.ts): where the ground comes down
// over the Lava Tube, it's drawn cut to the tube's own outline, the one its walls are built on.

import { describe, expect, test } from 'bun:test';
import { bakeTrack } from '../src/core/track/bake';
import { buildPortals, VERTEX } from '../src/render/skins/greybox/portal';
import { SURFACES, layout } from './helpers';

const track = bakeTrack(layout('paradise-open/open'), SURFACES);
const g = track.ground!;
const P = buildPortals(track)!;

/** Every grid cell near the tube, by its first corner. */
const cellsNear = () => {
  const out: number[] = [];
  for (let gz = 0; gz < g.nz - 1; gz++)
    for (let gx = 0; gx < g.nx - 1; gx++) {
      const k = gz * g.nx + gx;
      if (P.dist(g.x0 + gx * g.cell, g.h[k], g.z0 + gz * g.cell) < 20 || P.cells[k]) out.push(k);
    }
  return out;
};

describe('portals', () => {
  test('a map without tunnels has none', () => {
    expect(buildPortals(bakeTrack(layout('avalanche/slope'), SURFACES))).toBeNull();
  });

  test('the cells it leaves whole never reach inside the tube (a 5 × 5 over each)', () => {
    let inside = 0;
    for (const k of cellsNear()) {
      if (P.cells[k]) continue;
      const gx = k % g.nx;
      const gz = (k - gx) / g.nx;
      const [ha, hb, ha1, hb1] = [g.h[k], g.h[k + g.nx], g.h[k + 1], g.h[k + g.nx + 1]];
      for (let i = 0; i <= 4; i++)
        for (let j = 0; j <= 4; j++) {
          const u = i / 4;
          const v = j / 4;
          const y = u + v <= 1 ? ha + (ha1 - ha) * u + (hb - ha) * v : hb1 + (hb - hb1) * (1 - u) + (ha1 - hb1) * (1 - v);
          if (P.dist(g.x0 + (gx + u) * g.cell, y, g.z0 + (gz + v) * g.cell) < -0.02) inside++;
        }
    }
    expect(inside).toBe(0);
  });

  test('the cut ones are clipped to its outline: nothing drawn inside it, the cut on it', () => {
    const verts: number[] = [];
    const tris: number[] = [];
    let cut = 0;
    for (const k of cellsNear()) {
      if (!P.cells[k]) continue;
      cut++;
      const gx = k % g.nx;
      const gz = (k - gx) / g.nx;
      const v = (dx: number, dz: number) => [g.x0 + (gx + dx) * g.cell, g.h[k + dz * g.nx + dx], g.z0 + (gz + dz) * g.cell, 0, 1, 0, 1, 1, 1];
      P.clip(v(0, 0), v(0, 1), v(1, 0), verts, tris);
      P.clip(v(1, 0), v(0, 1), v(1, 1), verts, tris);
    }
    // Both mouths and both ways out into the shaft: a few dozen cells, not the whole slope.
    expect(cut).toBeGreaterThan(40);
    expect(cut).toBeLessThan(400);
    let onCut = 0;
    for (let n = 0; n < verts.length / VERTEX; n++) {
      const [x, y, z] = [verts[n * VERTEX], verts[n * VERTEX + 1], verts[n * VERTEX + 2]];
      const f = P.dist(x, y, z);
      if (Math.abs(f) < 0.01) onCut++;
      if (f >= -0.02) continue;
      // Inside it only on a tube's open end, where it stops (the arch frames that edge).
      let end = false;
      for (const [dx, dz] of [[0.02, 0], [-0.02, 0], [0, 0.02], [0, -0.02]]) end ||= P.dist(x + dx, y, z + dz) === Infinity;
      expect(end).toBe(true);
    }
    expect(onCut).toBeGreaterThan(100);
  });
});
