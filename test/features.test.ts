// Feature modules (docs/CALDERA.md step 2; core/track/features): the volcano and the coast as
// modules the ground runs, each by its hooks. Moved without changing a bit (the fingerprints).

import { describe, expect, test } from 'bun:test';
import { bakeTrack } from '../src/core/track/bake';
import { groundFeatures } from '../src/core/track/features';
import { KIND_SAND, KIND_SHORE } from '../src/core/track/ground';
import { SURFACES, layout } from './helpers';

describe('feature modules', () => {
  const open = bakeTrack(layout('paradise-open/open'), SURFACES).ground!;

  test("a layout's features, in the order they shape the ground", () => {
    expect(open.features.map((f) => f.kind)).toEqual(['volcano', 'coast']);
    expect(bakeTrack(layout('avalanche/slope'), SURFACES).ground!.features).toEqual([]);
  });

  test('the volcano says where its lava is; nothing else does', () => {
    const v = layout('paradise-open/open').ground!.volcano!;
    const sea = open.sea ?? 0;
    expect(open.hazard(v.x, sea + v.lava, v.z)).toBe('lava');
    expect(open.hazard(v.x, sea + v.lava + 5, v.z)).toBe('none');
    expect(open.hazard(v.x + v.crater + 5, sea, v.z)).toBe('none');
  });

  test('the coast says where its sand is: low ground within a wandering 12–24 m of it', () => {
    const [coast] = groundFeatures(layout('paradise-open/open').ground!).filter((f) => f.kind === 'coast');
    const sea = open.sea ?? 0;
    // The ground's coast is the feature's.
    expect(coast.coast!(5000, 5000)).toBe(open.coast(5000, 5000));
    expect(open.coast(5000, 5000)).toBeLessThan(0);
    // Points on the island 5 m and 40 m in from the coast (found along a line in from the sea).
    const inland = (want: number) => {
      for (let x = -900; x < 900; x += 0.5) if (open.coast(x, 0) >= want) return x;
      throw new Error('no coast');
    };
    const near = inland(5);
    const far = inland(40);
    expect(coast.surface!(near, 0, sea + 0.1, 0.5)).toBe(KIND_SHORE);
    expect(coast.surface!(near, 0, sea + 2, 0)).toBe(KIND_SAND);
    // 40 m in is past the wandering edge whatever the noise; and high ground is never sand.
    expect(coast.surface!(far, 0, sea + 2, 1)).toBe(-1);
    expect(coast.surface!(near, 0, sea + 8, 0.5)).toBe(-1);
  });
});
