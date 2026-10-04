// One surface function (docs/CALDERA.md, step 1d): the ground's kind per grid point
// (core/track/ground/surface.ts) is what's drawn and what's driven. The coast's sand drove as the
// verge beside it (grass) while it was drawn as sand.

import { describe, expect, test } from 'bun:test';
import { bakeTrack, VERGE_DEFAULT } from '../src/core/track/bake';
import { KIND_BEACH, KIND_LAVA_ROCK, KIND_SAND, KIND_SHORE } from '../src/core/track/ground';
import { newHit, projectGlobal, sampleAt, surfaceAt } from '../src/core/track/query';
import { SURFACES, layout } from './helpers';

// (Without its authored zones, which come first: puddles in the wet.)
const track = bakeTrack({ ...layout('paradise-open/open'), zones: [] }, SURFACES);
const g = track.ground!;
const id = (k: number) => track.surfaces[k].id;
const shoulder = track.surfaceIndex.get(track.layout.shoulderSurface ?? 'grass')!;

describe('one surface function', () => {
  test('wherever the ground is sand (drawn as sand), a car off the road drives on sand', () => {
    const hit = newHit();
    const seen = { sand: 0, shore: 0 };
    for (let k = 0; k < g.nx * g.nz; k += 5) {
      const kind = g.kind[k];
      if (kind !== KIND_SAND && kind !== KIND_BEACH && kind !== KIND_SHORE) continue;
      const x = g.x0 + (k % g.nx) * g.cell;
      const z = g.z0 + Math.floor(k / g.nx) * g.cell;
      projectGlobal(track.main, x, z, hit, g.h[k]);
      if (Math.abs(hit.lateral) <= hit.width / 2) continue;
      const want = kind === KIND_SHORE ? 'shore' : 'sand';
      expect(id(surfaceAt(track, hit, x, g.h[k] + 0.3, z, false, shoulder))).toBe(want);
      seen[want]++;
    }
    // The coast has plenty of both, and the beach west of the Freeway.
    expect(seen.sand).toBeGreaterThan(500);
    expect(seen.shore).toBeGreaterThan(100);
  });

  test('off the sand, the verge beside the road as before; on a map without a coast, nothing changes', () => {
    const hit = newHit();
    // Inland of the coast, by the road: its verge.
    let verge = 0;
    for (let k = 0; k < g.nx * g.nz; k += 7) {
      // (Nor a lava stream's rock: test/lava-stream.test.ts.)
      if (g.kind[k] === KIND_SAND || g.kind[k] === KIND_BEACH || g.kind[k] === KIND_SHORE || g.kind[k] === KIND_LAVA_ROCK) continue;
      const x = g.x0 + (k % g.nx) * g.cell;
      const z = g.z0 + Math.floor(k / g.nx) * g.cell;
      projectGlobal(track.main, x, z, hit, g.h[k]);
      if (Math.abs(hit.lateral) <= hit.width / 2 || Math.abs(hit.lateral) > 40) continue;
      expect(surfaceAt(track, hit, x, g.h[k] + 0.3, z, false, shoulder)).toBe(hit.verge === VERGE_DEFAULT ? shoulder : hit.verge);
      verge++;
    }
    expect(verge).toBeGreaterThan(1000);
    const slope = bakeTrack(layout('avalanche/slope'), SURFACES).ground!;
    expect(slope.kind.some((v) => v === KIND_SAND || v === KIND_BEACH || v === KIND_SHORE)).toBe(false);
  });

  test("between grid points it's the nearest one's: the driven edge is within half a cell of the drawn one", () => {
    const hit = newHit();
    let checked = 0;
    for (let k = 0; k < g.nx * g.nz; k += 11) {
      if (g.kind[k] !== KIND_SAND && g.kind[k] !== KIND_SHORE) continue;
      const x = g.x0 + (k % g.nx) * g.cell + g.cell * 0.4;
      const z = g.z0 + Math.floor(k / g.nx) * g.cell - g.cell * 0.3;
      projectGlobal(track.main, x, z, hit, g.h[k]);
      if (Math.abs(hit.lateral) <= hit.width / 2) continue;
      expect(id(surfaceAt(track, hit, x, g.h[k] + 0.3, z, false, shoulder))).toBe(g.kind[k] === KIND_SHORE ? 'shore' : 'sand');
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  test("on the Freeway's shoulder it's the deck's verge, not the sand or the sea under it", () => {
    // (It drove as the wet sand under the deck: grip 0.55 for 0.8.)
    const hit = newHit();
    const deck = track.layout.pieces!.find((p) => p.id === 'freeway')!;
    let under = 0;
    for (let s = deck.s[0] + 10; s < deck.s[1] - 10; s += 7) {
      sampleAt(track.main, s, hit);
      for (const side of [-1, 1]) {
        hit.lateral = side * (hit.width / 2 + Math.min(hit.shoulder, 1.5));
        const x = hit.cx - hit.tz * hit.lateral;
        const z = hit.cz + hit.tx * hit.lateral;
        const k = g.kindAt(x, z);
        if (k === KIND_SAND || k === KIND_BEACH || k === KIND_SHORE) under++;
        expect(surfaceAt(track, hit, x, hit.cy + 0.3, z, false, shoulder)).toBe(hit.verge === VERGE_DEFAULT ? shoulder : hit.verge);
      }
    }
    expect(under).toBeGreaterThan(20);
  });
});
