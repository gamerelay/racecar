// Portals (docs/CALDERA.md, step 1b; render/skins/greybox/portal.ts): where the ground comes down
// over the Lava Tube, it's drawn cut to the tube's own outline, the one its walls are built on.

import { describe, expect, test } from 'bun:test';
import { bakeTrack } from '../src/core/track/bake';
import { OUTLINE_POINTS, outlineAt } from '../src/core/track/ground';
import { ARCH_DEPTH, buildPortals, tubeCeiling, VERTEX } from '../src/render/skins/greybox/portal';
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
    let ends = 0;
    const tri = (n: number) => [verts[n * VERTEX], verts[n * VERTEX + 1], verts[n * VERTEX + 2]];
    for (let t = 0; t < tris.length; t += 3) {
      const [p, q, r] = [tri(tris[t]), tri(tris[t + 1]), tri(tris[t + 2])];
      for (const v of [p, q, r]) if (Math.abs(P.dist(v[0], v[1], v[2])) < 0.01) onCut++;
      // Its corners, edge middles and middle: none inside the outline (a little at its corners,
      // where a small triangle is kept whole), but where the cut stops, at the arch's outer face.
      const mid = (u: number[], v: number[], w = v) => [0, 1, 2].map((a) => (u[a] + v[a] + w[a]) / (w === v ? 2 : 3));
      for (const v of [p, q, r, mid(p, q), mid(q, r), mid(r, p), mid(p, q, r)]) {
        const f = P.dist(v[0], v[1], v[2]);
        if (f >= -0.3) continue;
        let end = false;
        for (const [dx, dz] of [[0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05]]) end ||= P.dist(v[0] + dx, v[1], v[2] + dz) === Infinity;
        expect(end).toBe(true);
        ends++;
      }
    }
    expect(ends).toBeLessThan(30);
    expect(onCut).toBeGreaterThan(100);
  });

  test("in front of a tube's open end (inside its arch), ground standing in the opening is cut", () => {
    const tube = track.splines.find((s) => s.id === 'lava-tube')!;
    const floors = g.pieces.floors(tube.index)!;
    const walled = (k: number) => k >= 0 && k + 1 < tube.n && floors[k] === 1 && floors[k + 1] === 1 && g.height(tube.px[k], tube.pz[k]) > tube.py[k] - 0.5;
    let ends = 0;
    let standing = 0;
    for (let k = 1; k < tube.n; k++) {
      const dir = walled(k) && !walled(k - 1) ? -1 : walled(k - 1) && !walled(k) ? 1 : 0;
      if (!dir) continue;
      ends++;
      // The road carried on past the end at its end's slope (and its bank across).
      const rise = (tube.py[k] + tube.ramp[k] - tube.py[k - dir] - tube.ramp[k - dir]) / tube.step;
      for (let d = 0.3; d < ARCH_DEPTH - 0.1; d += 0.3)
        for (let l = -tube.width[k] / 2 + 0.5; l <= tube.width[k] / 2 - 0.5; l += 1) {
          const x = tube.px[k] - tube.tz[k] * l + tube.tx[k] * d * dir;
          const z = tube.pz[k] + tube.tx[k] * l + tube.tz[k] * d * dir;
          const y = g.height(x, z);
          if (y - (tube.py[k] + tube.ramp[k] + rise * d - l * Math.tan(tube.bank[k])) < 0.3) continue;
          standing++;
          expect(P.dist(x, y, z)).toBeLessThan(0);
        }
    }
    // Both tunnels' two ends; the shaft side's (k 291) has the slope standing 1.9 m over its road.
    expect(ends).toBe(4);
    expect(standing).toBeGreaterThan(0);
  });

  test("the tube's walls lie on the outline the ground's cut to (what tube.ts builds, in the world)", () => {
    const tube = track.splines.find((s) => s.id === 'lava-tube')!;
    const floors = g.pieces.floors(tube.index)!;
    const O0 = new Float64Array(OUTLINE_POINTS * 2);
    const O1 = new Float64Array(OUTLINE_POINTS * 2);
    const p = (k: number, l: number, up: number) => [tube.px[k] - tube.tz[k] * l, tube.py[k] + tube.ramp[k] - l * Math.tan(tube.bank[k]) + up, tube.pz[k] + tube.tx[k] * l];
    let worst = 0;
    let checked = 0;
    for (let k = 0; k + 1 < tube.n; k++) {
      if (!floors[k] || !floors[k + 1] || g.height(tube.px[k], tube.pz[k]) <= tube.py[k] - 0.5) continue;
      outlineAt(tube, k, tubeCeiling(track, tube, k), O0);
      outlineAt(tube, k + 1, tubeCeiling(track, tube, k + 1), O1);
      // The walls and vault (not the floor's own edge, raised to the cut's KEEP).
      for (let q = 1; q + 2 < OUTLINE_POINTS; q++)
        for (const [t, s] of [[0.25, 0.5], [0.5, 0.25], [0.75, 0.75]]) {
          const a = p(k, O0[q * 2] + (O0[q * 2 + 2] - O0[q * 2]) * s, O0[q * 2 + 1] + (O0[q * 2 + 3] - O0[q * 2 + 1]) * s);
          const b = p(k + 1, O1[q * 2] + (O1[q * 2 + 2] - O1[q * 2]) * s, O1[q * 2 + 1] + (O1[q * 2 + 3] - O1[q * 2 + 1]) * s);
          const v = [0, 1, 2].map((n) => a[n] + (b[n] - a[n]) * t);
          worst = Math.max(worst, Math.abs(P.dist(v[0], v[1], v[2])));
          checked++;
        }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(worst).toBeLessThan(0.08);
  });
});
