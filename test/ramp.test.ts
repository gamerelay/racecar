import { describe, expect, test } from 'bun:test';
import type { TrackLayout } from '../src/core/content';
import { neutralControls } from '../src/core/controls';
import { Ev } from '../src/core/events';
import { Sim } from '../src/core/sim';
import { bakeTrack } from '../src/core/track/bake';
import { newHit, project } from '../src/core/track/query';
import { CLASSES, SURFACES } from './helpers';

// Kickers: a straight wedge with a sheer back, or rounded (`back`: a rise that curves up from flat
// and a roll down behind the lip). Logger's Leap's is rounded (it looked like a triangle).

const strip = (ramp: TrackLayout['ramps']): TrackLayout => ({
  id: 'strip',
  name: 'Strip',
  main: { points: [0, 1, 2, 3, 4].map((k) => ({ p: [0, 0, k * 200] as [number, number, number], width: 16 })) },
  ramps: ramp,
});
const WEDGE = [{ s: 300, height: 2.2, length: 12 }];
const ROUND = [{ s: 297, height: 2.2, length: 15, back: 10 }];
const FLANKED = [{ s: 297, height: 2.2, length: 15, back: 10, flank: 6 }];

/** A car driven straight across the road at `speed` m/s, from 26 m out, at the kicker's top: its first air time (s). */
function across(ramps: TrackLayout['ramps'], speed: number): number {
  const sim = new Sim(bakeTrack(strip(ramps), SURFACES), CLASSES, SURFACES, { seed: 1 });
  const i = sim.addCar({ cls: 'coupe', human: true });
  const c = sim.cars;
  sim.placeCar(i, 0, 312, 26);
  // Heading across, toward the road (the strip runs up z; 26 m to its right is -x).
  c.h[i] = Math.PI / 2;
  c.vx[i] = speed;
  c.vz[i] = 0;
  c.y[i] = 0;
  let air = 0;
  let cursor = sim.events.head;
  for (let t = 0; t < 60 * 4 && !air; t++) {
    sim.step([{ ...neutralControls(), throttle: 1 }]);
    cursor = sim.events.read(cursor, (e) => {
      if (e.type === Ev.Land && e.car === i) air = e.a;
    });
  }
  return air;
}

/** A car flat out at `speed` m/s over the kicker: its first air time (s) and how high it got over the road. */
function jump(ramps: TrackLayout['ramps'], speed: number) {
  const sim = new Sim(bakeTrack(strip(ramps), SURFACES), CLASSES, SURFACES, { seed: 1 });
  const i = sim.addCar({ cls: 'coupe', human: true });
  // A couple of seconds before it, at speed already.
  sim.placeCar(i, 0, 296 - Math.max(15, speed * 2), 0, speed);
  let air = 0;
  let up = 0;
  let cursor = sim.events.head;
  for (let t = 0; t < 60 * 8 && !air; t++) {
    // Hold the speed: throttle under it, coast over.
    const v = Math.hypot(sim.cars.vx[i], sim.cars.vz[i]);
    sim.step([{ ...neutralControls(), throttle: v < speed ? 1 : 0 }]);
    up = Math.max(up, sim.cars.y[i]);
    cursor = sim.events.read(cursor, (e) => {
      if (e.type === Ev.Land && e.car === i) air = e.a;
    });
  }
  return { air, up };
}

describe('kickers', () => {
  test('with flanks, its sides run out past the road: driven up from the side, it throws you across', () => {
    const sp = bakeTrack(strip(FLANKED), SURFACES).main;
    expect(Math.max(...sp.rampFlank)).toBe(6);
    // Halfway down a bank (3 m past the 8 m road's edge and its 4 m shoulder), half the height.
    const hit = newHit();
    project(sp, -15, 312, 312, hit);
    expect(hit.ground).toBeCloseTo(sp.ramp[Math.round(312 / sp.step)] / 2, 1);
    // From the side at 25 m/s: up one bank, across, and off the other. Across a flat road, no air.
    expect(across(FLANKED, 25)).toBeGreaterThan(0.3);
    expect(across([], 25)).toBe(0);
  });

  test('a rounded one has no step: the ground rolls up and back down', () => {
    const sp = bakeTrack(strip(ROUND), SURFACES).main;
    let worst = 0;
    for (let i = 1; i < sp.n; i++) worst = Math.max(worst, Math.abs(sp.ramp[i] - sp.ramp[i - 1]));
    // At most its steepest slope's worth a sample (the wedge drops 2.2 m in one).
    expect(worst).toBeLessThan(0.35 * sp.step);
    expect(Math.max(...sp.ramp)).toBeCloseTo(2.2, 1);
  });

  test('flat out, a rounded one launches you about as far as the wedge', () => {
    const wedge = jump(WEDGE, 35);
    const round = jump(ROUND, 35);
    expect(wedge.air).toBeGreaterThan(0.5);
    expect(round.air).toBeGreaterThan(wedge.air * 0.85);
    expect(round.air).toBeLessThan(wedge.air * 1.35);
  });

  test('slow, a rounded one rolls you over it, with no drop off its back', () => {
    // At 6 m/s the wedge's sheer back is a 2 m fall; the round one's back is driven down.
    expect(jump(WEDGE, 6).air).toBeGreaterThan(0.3);
    expect(jump(ROUND, 6).air).toBeLessThan(0.15);
  });
});
