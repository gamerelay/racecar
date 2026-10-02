import { describe, expect, test } from 'bun:test';
import type { TrackLayout } from '../src/core/content';
import { neutralControls } from '../src/core/controls';
import { Sim } from '../src/core/sim';
import { bakeTrack } from '../src/core/track/bake';
import { canyonDepth } from '../src/core/track/ground';
import { ALL_MAPS, EXPERIMENTAL_KEYS, LAYOUT_KEYS, MAPS } from '../tools/content';
import { CLASSES, SURFACES, layout } from './helpers';

// Open ground (docs/AVALANCHE.md, experimental): a heightfield the car drives on everywhere, the
// slope pulling you along it on snow, and Avalanche's Slope built on it.

/** A straight strip falling `grade` m per m, all ground, its road `surface`. */
function incline(grade: number, surface: string): TrackLayout {
  return {
    id: 'incline',
    name: 'Incline',
    main: { points: [0, 1, 2, 3, 4].map((k) => ({ p: [0, -k * 200 * grade, k * 200] as [number, number, number], width: 30, surface })) },
    ground: { cell: 2, wallFrom: 60, wallRise: 0.8 },
    shoulderSurface: 'powder',
  };
}

/** A car coasting (no throttle) down `layout`'s road from 200 m at `speed`: its speed 3 s on. */
function coast(l: TrackLayout, speed: number): number {
  const sim = new Sim(bakeTrack(l, SURFACES), CLASSES, SURFACES, { seed: 1 });
  const i = sim.addCar({ cls: 'coupe', human: true });
  sim.placeCar(i, 0, 200, 0, speed);
  for (let t = 0; t < 180; t++) sim.step([neutralControls()]);
  return Math.hypot(sim.cars.vx[i], sim.cars.vz[i]);
}

describe('open ground', () => {
  test('it carries the road: along the middle it is the road, and far out it rises into walls', () => {
    const track = bakeTrack(incline(0.2, 'snow'), SURFACES);
    const g = track.ground!;
    const m = track.main;
    let worst = 0;
    for (let i = Math.round(100 / m.step); i < Math.round(600 / m.step); i++) worst = Math.max(worst, Math.abs(g.height(m.px[i], m.pz[i]) - m.py[i]));
    expect(worst).toBeLessThan(0.05);
    // 100 m out (40 past the walls' start), 32 m up.
    const i = Math.round(400 / m.step);
    expect(g.height(m.px[i] - 100, m.pz[i]) - m.py[i]).toBeCloseTo(32, 0);
  });

  test('on snow the slope pulls you down it; on asphalt it doesn\'t', () => {
    // Coasting at 15 m/s down a 20% grade: faster on snow, slower (drag) on asphalt.
    expect(coast(incline(0.2, 'snow'), 15)).toBeGreaterThan(20);
    expect(coast(incline(0.2, 'asphalt'), 15)).toBeLessThan(15);
    // And up it (a negative grade), snow slows you more than asphalt does.
    expect(coast(incline(-0.1, 'snow'), 25)).toBeLessThan(coast(incline(-0.1, 'asphalt'), 25) - 3);
  });

  test("a canyon's walls are a quarter circle: the floor's depth, about 60° at the lip, level ground past it", () => {
    expect(canyonDepth(0, 10, 5)).toBe(5);
    expect(canyonDepth(5, 10, 5)).toBe(5);
    // The lip is sqrt(2 r d - d²) past the floor, r = 2 d: 8.66 m for a 5 m deep canyon.
    expect(canyonDepth(5 + 8.6, 10, 5)).toBeLessThan(0.15);
    expect(canyonDepth(5 + 8.7, 10, 5)).toBe(0);
    const lip = (canyonDepth(5 + 8.5, 10, 5) - canyonDepth(5 + 8.6, 10, 5)) / 0.1;
    expect((Math.atan(lip) * 180) / Math.PI).toBeLessThan(62);
  });
});

describe("Avalanche's Slope", () => {
  test('is experimental: out of the maps the game, the validator and the lap report run', () => {
    expect(ALL_MAPS.find((m) => m.id === 'avalanche')?.experimental).toBe(true);
    expect(MAPS.some((m) => m.id === 'avalanche')).toBe(false);
    expect(LAYOUT_KEYS).not.toContain('avalanche/slope');
    expect(EXPERIMENTAL_KEYS).toContain('avalanche/slope');
  });

  test('has a ground, groomed snow on the piste, powder off it, a mogul field and a canyon', () => {
    const l = layout('avalanche/slope');
    const track = bakeTrack(l, SURFACES);
    expect(track.ground).toBeDefined();
    expect(l.shoulderSurface).toBe('powder');
    expect(SURFACES[track.main.surface[0]].id).toBe('snow');
    expect(l.ground!.moguls!.length).toBeGreaterThan(0);
    expect(l.ground!.canyons!.length).toBeGreaterThan(0);
  });

  test('the hard AI gets round it clean', async () => {
    const { lapReport } = await import('../tools/lap');
    const r = lapReport('avalanche/slope', layout('avalanche/slope'), 'coupe', { laps: 2 });
    expect(r.finished).toBe(true);
    expect(r.wrecks).toEqual([]);
  });
});
