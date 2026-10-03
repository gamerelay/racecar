// One surface function (docs/CALDERA.md, step 1d): the ground's kind per grid point
// (core/track/ground/surface.ts) is what's drawn and what's driven. The coast's sand drove as the
// verge beside it (grass) while it was drawn as sand.

import { describe, expect, test } from 'bun:test';
import { bakeTrack, VERGE_DEFAULT } from '../src/core/track/bake';
import { KIND_SAND, KIND_SHORE } from '../src/core/track/ground';
import { newHit, projectGlobal, surfaceAt } from '../src/core/track/query';
import { SURFACES, layout } from './helpers';

// (Without its authored zones, which come first: a strip of `beach` along the harbour.)
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
      if (kind !== KIND_SAND && kind !== KIND_SHORE) continue;
      const x = g.x0 + (k % g.nx) * g.cell;
      const z = g.z0 + Math.floor(k / g.nx) * g.cell;
      projectGlobal(track.main, x, z, hit, g.h[k]);
      if (Math.abs(hit.lateral) <= hit.width / 2) continue;
      const want = kind === KIND_SAND ? 'sand' : 'shore';
      expect(id(surfaceAt(track, hit, x, z, false, shoulder))).toBe(want);
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
      if (g.kind[k] === KIND_SAND || g.kind[k] === KIND_SHORE) continue;
      const x = g.x0 + (k % g.nx) * g.cell;
      const z = g.z0 + Math.floor(k / g.nx) * g.cell;
      projectGlobal(track.main, x, z, hit, g.h[k]);
      if (Math.abs(hit.lateral) <= hit.width / 2 || Math.abs(hit.lateral) > 40) continue;
      expect(surfaceAt(track, hit, x, z, false, shoulder)).toBe(hit.verge === VERGE_DEFAULT ? shoulder : hit.verge);
      verge++;
    }
    expect(verge).toBeGreaterThan(1000);
    const slope = bakeTrack(layout('avalanche/slope'), SURFACES).ground!;
    expect(slope.kind.some((v) => v === KIND_SAND || v === KIND_SHORE)).toBe(false);
  });
});
