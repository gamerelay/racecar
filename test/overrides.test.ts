// Overrides (docs/CALDERA.md, "Overrides: the escape hatch"; core/track/overrides.ts): a map's own
// code for a small region, through fixed hooks only, inside the region only, with the last word.

import { describe, expect, test } from 'bun:test';
import type { OverrideDef, TrackLayout } from '../src/core/content';
import { respawn } from '../src/core/car/physics';
import { Sim } from '../src/core/sim';
import { bakeTrack } from '../src/core/track/bake';
import { newCast } from '../src/core/track/ground';
import type { OverrideCode } from '../src/core/track/overrides';
import { newHit, projectGlobal, sampleAt, surfaceAt } from '../src/core/track/query';
import { validateLayout } from '../src/core/track/validate';
import { run, setup } from '../src/dev/drive';
import { describeProbe, probe } from '../src/dev/probe';
import { CLASSES, SURFACES, layout } from './helpers';

const base: TrackLayout = layout('avalanche/slope');
const ice = SURFACES.findIndex((s) => s.id === 'ice');
const stretch: OverrideDef = { id: 'test-stretch', reason: 'a test', region: { s: [1000, 1200] } };
const box: OverrideDef = { id: 'test-box', reason: 'a test', region: { box: [-1e5, -1e5, -1e5 + 10, -1e5 + 10] } };
const steps: number[] = [];
const code: Record<string, OverrideCode> = {
  'test-stretch': {
    cast: (out) => {
      out.floor += 5;
    },
    surface: () => ice,
    hazard: () => 'lava',
    respawn: { s: 1500, lateral: 3 },
    step: (_sim, car) => {
      steps.push(car);
    },
  },
  'test-box': { surface: () => ice },
};
const plain = bakeTrack(base, SURFACES);
const track = bakeTrack({ ...base, overrides: [stretch, box] }, SURFACES, code);
const main = track.main;
const at = (s: number, lat = 0) => {
  const a = sampleAt(main, s, newHit());
  return { x: a.cx - a.tz * lat, z: a.cz + a.tx * lat };
};

describe('overrides', () => {
  test('a stretch of road is inside along it and across its road and shoulder, not past them', () => {
    const o = track.overrides.find((o) => o.id === 'test-stretch')!;
    const edge = main.width[Math.round(1100 / main.step)] / 2 + main.shoulder[Math.round(1100 / main.step)];
    for (const [s, lat, inside] of [
      [1010, 0, true],
      [1100, edge - 1, true],
      [1190, -(edge - 1), true],
      [990, 0, false],
      [1210, 0, false],
      [1100, edge + 2, false],
    ] as const) {
      const p = at(s, lat);
      expect([s, lat, o.inside(p.x, p.z)]).toEqual([s, lat, inside]);
    }
    const b = track.overrides.find((o) => o.id === 'test-box')!;
    expect(b.inside(-1e5 + 5, -1e5 + 5)).toBe(true);
    expect(b.inside(-1e5 + 11, -1e5 + 5)).toBe(false);
  });

  test('its hooks have the last word inside the region, and nothing changes outside it', () => {
    const g = track.ground!;
    const g0 = plain.ground!;
    const hit = newHit();
    const shoulder = track.surfaceIndex.get(track.layout.shoulderSurface ?? 'sidewalk') ?? 0;
    for (const [s, inside] of [
      [1100, true],
      [800, false],
      [1400, false],
    ] as const) {
      const { x, z } = at(s);
      const y = g0.top(x, z) + 0.3;
      projectGlobal(main, x, z, hit, y);
      const surface = surfaceAt(track, hit, x, y, z, false, shoulder);
      const surface0 = surfaceAt(plain, hit, x, y, z, false, shoulder);
      expect(surface === ice).toBe(inside);
      if (!inside) expect(surface).toBe(surface0);
      expect(g.hazard(x, y, z, 1)).toBe(inside ? 'lava' : g0.hazard(x, y, z, 1));
      expect(g.cast(x, y, z, newCast()).floor).toBeCloseTo(g0.cast(x, y, z, newCast()).floor + (inside ? 5 : 0), 6);
      expect(g.top(x, z, y)).toBeCloseTo(g0.top(x, z, y) + (inside ? 5 : 0), 6);
    }
  });

  test('a car wrecked inside comes back at its spot; elsewhere where it would have', () => {
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0 });
    const [a, b] = [sim.addCar({ cls: 'coupe', human: true }), sim.addCar({ cls: 'coupe', human: true })];
    const c = sim.cars;
    c.lastSpline[a] = c.lastSpline[b] = 0;
    c.lastS[a] = 1100;
    c.lastS[b] = 700;
    c.lastLat[a] = c.lastLat[b] = 0;
    respawn(sim, a);
    respawn(sim, b);
    expect(c.s[a]).toBeCloseTo(1500, 0);
    const want = at(1500, 3);
    expect(Math.hypot(c.x[a] - want.x, c.z[a] - want.z)).toBeLessThan(0.5);
    expect(c.s[b]).toBeCloseTo(700, 0);
  });

  test("the engine's rules apply to an override's spot as to any: not back under an avalanche", () => {
    // (Its spot behind the region: the avalanche rule put a car into the region, and the spot
    // then put it back under the avalanche.)
    const back = bakeTrack({ ...base, overrides: [stretch] }, SURFACES, { 'test-stretch': { respawn: { s: 200, lateral: 0 } } });
    const sim = new Sim(back, CLASSES, SURFACES, { seed: 1, traffic: 0 });
    const a = sim.addCar({ cls: 'coupe', human: true });
    const c = sim.cars;
    sim.avalancheFront = 900;
    c.lastSpline[a] = 0;
    c.lastS[a] = 500;
    c.lastLat[a] = 0;
    respawn(sim, a);
    expect(c.s[a]).toBeGreaterThanOrEqual(900);
    // Inside the region, the spot, then ahead of the avalanche.
    c.lastS[a] = 1100;
    respawn(sim, a);
    expect(c.s[a]).toBeGreaterThanOrEqual(900);
  });

  test("the body leans with a cast hook's floor (topSlope), not the ground under it", () => {
    const g = track.ground!;
    const tilt = bakeTrack({ ...base, overrides: [stretch] }, SURFACES, { 'test-stretch': { cast: (out, x) => void (out.floor += 0.5 * x) } }).ground!;
    const { x, z } = at(1100);
    const y = tilt.top(x, z) + 0.3;
    const e = g.cell / 2;
    const want = (tilt.top(x + e, z, y) - tilt.top(x - e, z, y)) / (2 * e);
    expect(tilt.topSlope(x, z, y, { x: 0, z: 0 }).x).toBeCloseTo(want, 6);
    expect(tilt.topSlope(x, z, y, { x: 0, z: 0 }).x - g.topSlope(x, z, y, { x: 0, z: 0 }).x).toBeCloseTo(0.5, 1);
  });

  test("a car stands on a cast hook's floor (its wheels), not the ground under it", () => {
    const raised = bakeTrack({ ...base, overrides: [stretch] }, SURFACES, { 'test-stretch': { cast: (out) => void (out.floor += 5) } });
    const sim = setup(raised, CLASSES, SURFACES, { s: 1100 }, { throttle: 0 }, { kmh: 0 });
    run(sim, { throttle: 0 }, 2, 1);
    const c = sim.cars;
    const g = raised.ground!;
    expect(c.grounded[0]).toBe(1);
    expect(c.y[0]).toBeCloseTo(g.top(c.x[0], c.z[0], c.y[0]), 1);
    expect(c.y[0] - g.height(c.x[0], c.z[0])).toBeGreaterThan(4.5);
  });

  test('on a looped road a stretch can run through the start line, to exactly its ends', () => {
    const city = layout('downtown/downtown');
    const L = bakeTrack(city, SURFACES).main.length;
    const loop = bakeTrack({ ...city, overrides: [{ id: 'w', reason: 'a test', region: { s: [L - 20, 20] } }] }, SURFACES, { w: {} });
    const o = loop.overrides[0];
    const where = (s: number) => sampleAt(loop.main, s, newHit());
    for (const [s, inside] of [
      [L - 10, true],
      [L - 0.5, true],
      [10, true],
      [19.5, true],
      [L - 25, false],
      [25, false],
    ] as const)
      expect([s, o.inside(where(s).cx, where(s).cz)]).toEqual([s, inside]);
  });

  test('its step runs each tick for the cars inside only', () => {
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0 });
    const [a, b] = [sim.addCar({ cls: 'coupe', human: true }), sim.addCar({ cls: 'coupe', human: true })];
    sim.placeCar(a, 0, 1100, 0, 0);
    sim.placeCar(b, 0, 700, 0, 0);
    steps.length = 0;
    for (let t = 0; t < 10; t++) sim.step([]);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((i) => i === a)).toBe(true);
  });

  test('probe says which are active', () => {
    const { x, z } = at(1100);
    expect(probe(track, x, z).overrides).toEqual(['test-stretch']);
    expect(describeProbe(probe(track, x, z))).toContain('override active: test-stretch');
    expect(probe(track, at(700).x, at(700).z).overrides).toEqual([]);
  });

  test('the validator wants code, a reason and a region for each, and warns when there are many', () => {
    // (One layout: the validator bakes and checks the whole track.)
    const ok = validateLayout({ ...base, overrides: [stretch, box] }, SURFACES, CLASSES, code).map((p) => p.message);
    expect(ok.filter((m) => m.includes('override'))).toEqual([]);
    const bad: OverrideDef[] = [
      stretch,
      stretch,
      { ...stretch, id: 'nobody' },
      { ...stretch, id: 'why', reason: ' ' },
      { ...stretch, id: 'road', region: { road: 'nowhere', s: [0, 10] } },
      { ...stretch, id: 'short', region: { s: [10, 5] } },
      { ...box, id: 'flat', region: { box: [0, 0, 0, 5] } },
      { ...box, id: 'lost' },
    ];
    const all = { ...code, why: {}, road: {}, short: {}, flat: {}, lost: { respawn: { road: 'nope', s: 0, lateral: 0 } } };
    const problems = validateLayout({ ...base, overrides: bad }, SURFACES, CLASSES, all).map((p) => `${p.level}: ${p.message}`);
    for (const want of ['error: override "test-stretch" is declared twice', 'error: override "nobody" has no code', 'error: override "why" has no reason', 'error: override "road": no road "nowhere"', 'error: override "short": its stretch is empty', 'error: override "flat": its box is empty', 'error: override "lost": its respawn spot is on no road "nope"', 'warning: 7 overrides'])
      expect(problems.some((p) => p.startsWith(want))).toBe(true);
  }, 30_000);

  test('a layout without any has none, and one with no code is left out', () => {
    expect(plain.overrides).toEqual([]);
    expect(bakeTrack({ ...base, overrides: [{ ...stretch, id: 'nobody' }] }, SURFACES, code).overrides).toEqual([]);
  });
});
