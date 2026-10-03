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
    expect(open.features.map((f) => f.kind)).toEqual(['volcano', 'coast', 'beach', 'uneven']);
    expect(bakeTrack(layout('avalanche/slope'), SURFACES).ground!.features.map((f) => f.kind)).toEqual(['moguls', 'moguls', 'canyon', 'canyon']);
  });

  test('a canyon sinks the ground and keeps the trees off it; a mogul field keeps them off too', () => {
    const slope = bakeTrack(layout('avalanche/slope'), SURFACES).ground!;
    const [canyon] = slope.features.filter((f) => f.kind === 'canyon');
    const c = canyon.def!;
    if (c.kind !== 'canyon') throw new Error('not a canyon');
    const mid = (c.s[0] + c.s[1]) / 2;
    // Its floor is its depth down; far across from it, nothing.
    expect(slope.sunk(mid, c.lateral)).toBeCloseTo(c.depth, 6);
    expect(slope.sunk(mid, -c.lateral)).toBe(0);
    expect(slope.bare(mid, c.lateral)).toBe(true);
    const [moguls] = slope.features.filter((f) => f.kind === 'moguls');
    const m = moguls.def!;
    if (m.kind !== 'moguls') throw new Error('not moguls');
    expect(slope.bare((m.s[0] + m.s[1]) / 2, (m.lateral[0] + m.lateral[1]) / 2)).toBe(true);
    // Well clear of every feature (on the piste, between the mogul fields and the canyons), trees may grow.
    expect(slope.bare(400, 0)).toBe(false);
  });

  test('the volcano says where its lava is; nothing else does', () => {
    const v = layout('paradise-open/open').ground!.volcano!;
    const sea = open.sea ?? 0;
    expect(open.hazard(v.x, sea + v.lava, v.z)).toBe('lava');
    expect(open.hazard(v.x, sea + v.lava + 5, v.z)).toBe('none');
    expect(open.hazard(v.x + v.crater + 5, sea, v.z)).toBe('none');
  });

  test('the coast says where its sand is: low ground within a wandering 12–24 m of it', () => {
    const [coast] = groundFeatures(layout('paradise-open/open').ground!, bakeTrack(layout('paradise-open/open'), SURFACES).main).filter((f) => f.kind === 'coast');
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
    expect(coast.surface!(near, 0, sea + 0.1, 0.5, 0, 0)).toBe(KIND_SHORE);
    expect(coast.surface!(near, 0, sea + 2, 0, 0, 0)).toBe(KIND_SAND);
    // 40 m in is past the wandering edge whatever the noise; and high ground is never sand.
    expect(coast.surface!(far, 0, sea + 2, 1, 0, 0)).toBe(-1);
    expect(coast.surface!(near, 0, sea + 8, 0.5, 0, 0)).toBe(-1);
  });

  test("the jungle's mud is a little uneven: lumps on the red-earth road, a few tenths high, and only there", () => {
    const track = bakeTrack(layout('paradise-open/open'), SURFACES);
    const [mud] = track.ground!.features.filter((f) => f.kind === 'uneven');
    const u = mud.def!;
    if (u.kind !== 'uneven') throw new Error('not uneven');
    // It's where the road is red earth.
    const red = track.surfaceIndex.get('red-earth')!;
    const mid = Math.round((u.s[0] + u.s[1]) / 2 / track.main.step);
    expect(track.main.surface[mid]).toBe(red);
    expect(track.main.surface[Math.round((u.s[0] - 30) / track.main.step)]).not.toBe(red);
    // What it adds on the road: lumps both ways, within its height; nothing outside its stretch.
    const at = (s: number, x: number, z: number) => mud.rise!({ x, z, s, lat: 0, d: 0, half: 6, shoulder: 2, edge: 8, bank: 0, keep: 1 });
    let lo = 0;
    let hi = 0;
    for (let k = 0; k < 400; k++) {
      const v = at(u.s[0] + 30 + k, k * 1.7, k * 0.9);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(hi - lo).toBeGreaterThan(u.height * 0.3);
    expect(Math.max(-lo, hi)).toBeLessThanOrEqual(u.height * 0.5);
    expect(at(u.s[0] - 1, 3, 4)).toBe(0);
    expect(at(u.s[1] + 1, 3, 4)).toBe(0);
  });
});
