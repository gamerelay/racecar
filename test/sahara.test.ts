// Sahara (docs/SAHARA.md), step 1: the pyramids are ground you drive up, stone to drive on, and the
// Pyramid Run goes over the Great Pyramid's top. Experimental, so not in the every-map tests yet.

import { describe, expect, test } from 'bun:test';
import { bakeTrack } from '../src/core/track/bake';
import { pyramidHeight } from '../src/core/track/features/pyramid';
import { KIND_STONE } from '../src/core/track/ground';
import { newHit, projectGlobal, surfaceAt } from '../src/core/track/query';
import type { PyramidDef } from '../src/core/content';
import { SURFACES, layout } from './helpers';

describe('Sahara', () => {
  const sahara = layout('sahara/dunes');
  const track = bakeTrack(sahara, SURFACES);
  const g = track.ground!;
  const pyramids = sahara.ground!.features!.filter((f): f is PyramidDef => f.kind === 'pyramid');

  test('a pyramid rises in flat faces from its foot to its top, square to its heading', () => {
    const p: PyramidDef = { kind: 'pyramid', at: [0, 0], half: 40, top: 4, h: 18, y: 0, rot: 0.3 };
    const h = pyramidHeight(p);
    expect(h(0, 0)).toBe(18);
    // Halfway up a face, along its heading or across it, the same height: a square, turned.
    const [fx, fz] = [Math.sin(0.3), Math.cos(0.3)];
    expect(h(fx * 22, fz * 22)).toBeCloseTo(9, 6);
    expect(h(fz * 22, -fx * 22)).toBeCloseTo(9, 6);
    // Off its foot, nothing (a corner reaches farther than a face).
    expect(h(fx * 41, fz * 41)).toBe(0);
    expect(h((fx + fz) * 39, (fz - fx) * 39)).toBeGreaterThan(0);
  });

  test('the pyramids stand on the ground, stone, driven as sandstone', () => {
    expect(pyramids.length).toBe(3);
    const hit = newHit();
    for (const p of pyramids) {
      // Halfway up a face across its heading (the Pyramid Run goes along the Great Pyramid's).
      const [x, z] = [p.at[0] + Math.cos(p.rot) * p.half * 0.5, p.at[1] - Math.sin(p.rot) * p.half * 0.5];
      expect(g.height(x, z)).toBeCloseTo(p.y + p.h * ((p.half * 0.5) / (p.half - p.top)), 0);
      expect(g.kindAt(x, z)).toBe(KIND_STONE);
      projectGlobal(track.main, x, z, hit);
      expect(SURFACES[surfaceAt(track, hit, x, g.height(x, z), z, false, track.surfaceIndex.get('sand')!)].id).toBe('sandstone');
    }
  });

  test('the Pyramid Run goes over the Great Pyramid, its top the highest point on it', () => {
    const run = track.splines.find((s) => s.id === 'pyramid-run')!;
    const great = pyramids[0];
    let top = 0;
    for (let i = 1; i < run.n; i++) if (run.py[i] > run.py[top]) top = i;
    expect(Math.hypot(run.px[top] - great.at[0], run.pz[top] - great.at[1])).toBeLessThan(great.top + 2);
    expect(run.py[top]).toBeGreaterThan(great.y + great.h - 1);
  });
});
