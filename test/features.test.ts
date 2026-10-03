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

  test("the coast says where its sand is, and how far in from it a point is", () => {
    const [coast] = groundFeatures(layout('paradise-open/open').ground!).filter((f) => f.kind === 'coast');
    const sea = open.sea ?? 0;
    // Out at sea it's negative, and the ground's coast is the feature's.
    expect(open.coast(5000, 5000)).toBeLessThan(0);
    expect(coast.coast!(5000, 5000)).toBe(open.coast(5000, 5000));
    expect(coast.surface!(5000, 5000, sea + 0.1, 0.5)).toBe(KIND_SHORE);
    expect(coast.surface!(5000, 5000, sea + 2, 0.5)).toBe(KIND_SAND);
    expect(coast.surface!(5000, 5000, sea + 8, 0.5)).toBe(-1);
  });
});
