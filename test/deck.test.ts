import { describe, expect, test } from 'bun:test';
import type { TrackLayout } from '../src/core/content';
import { neutralControls } from '../src/core/controls';
import { Sim } from '../src/core/sim';
import { bakeTrack } from '../src/core/track/bake';
import { DECK_CATCH } from '../src/core/track/ground';
import { validateLayout } from '../src/core/track/validate';
import { slopeRise } from '../src/render/camera';
import { Cause } from '../src/core/events';
import { EXPERIMENTAL_KEYS, MAPS } from '../tools/content';
import { CLASSES, SURFACES, layout } from './helpers';

// A road over the ground (docs/PARADISE.md, step 0): a deck the car drives on while it's on it,
// with the ground under it (the bay), and over its edge, it falls.

/** A straight road 10 m up (one run, so it doesn't loop back), over open ground, a deck over the sea from 300 to 700 m. */
function bridge(): TrackLayout {
  return {
    id: 'bridge',
    name: 'Bridge',
    main: { points: [0, 1, 2, 3, 4, 5].map((k) => ({ p: [0, 10, k * 200] as [number, number, number], width: 16, shoulder: 3, surface: 'asphalt' })) },
    walls: { gaps: [{ s: [0, 1000], side: 'both' }] },
    run: { start: 50, finish: 800 },
    ground: { cell: 2, wallFrom: 120, wallRise: 0.3, decks: [{ s: [300, 700], floor: -6, ease: 60, reach: 30 }], sea: 0 },
    shoulderSurface: 'beach',
  };
}

describe('a road over the ground', () => {
  const track = bakeTrack(bridge(), SURFACES);
  const g = track.ground!;

  test('under the deck the ground is the floor, the deck is the road, and past its edge there is none', () => {
    expect(g.height(0, 500)).toBeCloseTo(-6, 0);
    expect(g.deck(0, 500)).toBeCloseTo(10, 1);
    // The road's half width and its shoulder: 11 m out is on it, 12 m isn't.
    expect(g.deck(10.5, 500)).toBeCloseTo(10, 1);
    expect(Number.isNaN(g.deck(12, 500))).toBe(true);
    // Off the deck's span, none: the road is the ground there.
    expect(Number.isNaN(g.deck(0, 150))).toBe(true);
    expect(g.height(0, 150)).toBeCloseTo(10, 0);
    // What's under: the deck from above, the ground from under it.
    expect(g.top(0, 500)).toBeCloseTo(10, 1);
    expect(g.top(0, 500, 10 - DECK_CATCH - 0.5)).toBeCloseTo(-6, 0);
  });

  test('a car drives across it on the deck', () => {
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
    const i = sim.addCar({ cls: 'coupe', human: true });
    sim.placeCar(i, 0, 200, 0, 25);
    const c = { ...neutralControls(), throttle: 1 };
    let low = Infinity;
    for (let t = 0; t < 60 * 12 && sim.cars.z[i] < 760; t++) {
      sim.step([c]);
      if (sim.cars.z[i] > 320 && sim.cars.z[i] < 680) low = Math.min(low, sim.cars.y[i]);
    }
    expect(sim.cars.z[i]).toBeGreaterThan(700);
    expect(sim.cars.wreck[i]).toBe(0);
    expect(low).toBeGreaterThan(9.9);
  });

  test('over its edge a car falls into the sea, is out, and comes back on the deck', () => {
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
    const i = sim.addCar({ cls: 'coupe', human: true });
    sim.placeCar(i, 0, 450, 8, 20);
    // Hard right, off the side.
    const c = { ...neutralControls(), throttle: 0.6, steer: 1 };
    let fell = Infinity;
    let out = false;
    for (let t = 0; t < 60 * 6 && !out; t++) {
      sim.step([c]);
      fell = Math.min(fell, sim.cars.y[i]);
      out = sim.cars.wreck[i] === 1 && sim.cars.wreckCause[i] === Cause.OutOfBounds;
    }
    expect(out).toBe(true);
    expect(fell).toBeLessThan(0);
    // Back on the deck, not down in the bay.
    let back = false;
    for (let t = 0; t < 60 * 5 && !back; t++) {
      sim.step([neutralControls()]);
      back = sim.cars.wreck[i] === 0;
    }
    expect(back).toBe(true);
    for (let t = 0; t < 30; t++) sim.step([neutralControls()]);
    expect(sim.cars.y[i]).toBeGreaterThan(9.5);
  });

  test('with swell and bumps on the ground, the road still meets the deck at its own height', () => {
    const l = bridge();
    l.ground!.swell = { height: 3, size: 40 };
    l.ground!.rough = { height: 2, size: 15 };
    const t = bakeTrack(l, SURFACES);
    const gr = t.ground!;
    for (const z of [300, 700]) {
      for (const x of [-10, -5, 0, 5, 10]) {
        const before = gr.height(x, z === 300 ? z - 0.5 : z + 0.5);
        const deck = gr.deck(x, z === 300 ? z + 0.5 : z - 0.5);
        expect(Math.abs(before - deck)).toBeLessThan(0.15);
      }
    }
  });

  test('it validates', () => {
    expect(validateLayout(bridge(), SURFACES, CLASSES).filter((p) => p.level === 'error')).toEqual([]);
  });
});

describe('Paradise Open (docs/PARADISE.md)', () => {
  test('is experimental: out of the game, opened from a link', () => {
    expect(EXPERIMENTAL_KEYS).toContain('paradise-open/open');
    expect(MAPS.some((m) => m.id === 'paradise-open')).toBe(false);
  });

  test('the camera sees the deck ahead up the Freeway\'s ramp, not the bay under it', () => {
    const track = bakeTrack(layout('paradise-open/open'), SURFACES);
    const g = track.ground!;
    const m = track.main;
    let worst = 0;
    for (let s = 1150; s <= 2100; s += 5) {
      const i = Math.round(s / m.step);
      worst = Math.min(worst, slopeRise(g, m.px[i], g.top(m.px[i], m.pz[i]), m.pz[i], m.tx[i], m.tz[i], 13));
    }
    // The road falls no more than a meter or so over 26 m anywhere there; the bay is 6 m under it.
    expect(worst).toBeGreaterThan(-1.5);
  });

  test('the Freeway is a deck over the bay, no walls on it', () => {
    const track = bakeTrack(layout('paradise-open/open'), SURFACES);
    const g = track.ground!;
    const m = track.main;
    const i = Math.round(1600 / m.step);
    expect(g.deckSample[i]).toBe(1);
    expect(g.deck(m.px[i], m.pz[i])).toBeCloseTo(m.py[i], 0);
    expect(g.height(m.px[i], m.pz[i])).toBeLessThan(g.sea! - 3);
    expect(m.wallL[i] + m.wallR[i]).toBe(0);
  });
});
