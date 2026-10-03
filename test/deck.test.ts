import { describe, expect, test } from 'bun:test';
import type { TrackLayout } from '../src/core/content';
import { neutralControls } from '../src/core/controls';
import { Sim } from '../src/core/sim';
import { bakeTrack } from '../src/core/track/bake';
import { DECK_CATCH, TUBE_H } from '../src/core/track/ground';
import { validateLayout } from '../src/core/track/validate';
import { slopeRise } from '../src/render/camera';
import { TUNING } from '../src/core/car/tuning';
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
      // Down the middle, and swerving near either edge, the view turned up to 35° toward it.
      for (const lat of [-10, -6, 0, 6, 10]) {
        for (const turn of [-0.6, -0.3, 0, 0.3, 0.6]) {
          const x = m.px[i] - m.tz[i] * lat;
          const z = m.pz[i] + m.tx[i] * lat;
          const h = Math.atan2(m.tx[i], m.tz[i]) + turn;
          worst = Math.min(worst, slopeRise(g, x, g.top(x, z), z, Math.sin(h), Math.cos(h), 13));
        }
      }
    }
    // The ground ahead falls no more than a couple of meters over 26 m anywhere there (beside the
    // ramp's foot, looking off toward the bay, it does fall); the bay floor is 6–20 m under the deck.
    expect(worst).toBeGreaterThan(-2.5);
  });

  test('the two turns off the Freeway are banked steeply into themselves, the second the other way', () => {
    const m = bakeTrack(layout('paradise-open/open'), SURFACES).main;
    const at = (s: number) => m.bank[Math.round(s / m.step)];
    // The right-hander low on the right (its inside), the left-hander low on the left.
    expect(at(2260)).toBeGreaterThan(0.24);
    expect(at(2450)).toBeLessThan(-0.24);
  });

  test('a drift through either banked turn leans on the bank: it runs less wide than with no hold', () => {
    const track = bakeTrack(layout('paradise-open/open'), SURFACES);
    /** Where a drift from `s`, steering `steer`, is across the road a second on. */
    const drift = (s: number, steer: number, hold: number) => {
      const was = TUNING.bankHold;
      TUNING.bankHold = hold;
      try {
        const sim = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
        const i = sim.addCar({ cls: 'coupe', human: true });
        sim.placeCar(i, 0, s, 0, 28);
        const c = { ...neutralControls(), throttle: 1, steer, drift: true };
        let drifting = 0;
        for (let t = 0; t < 60; t++) {
          sim.step([c]);
          drifting += sim.cars.drift[i];
        }
        expect(drifting).toBeGreaterThan(20);
        return sim.cars.lateral[i];
      } finally {
        TUNING.bankHold = was;
      }
    };
    // Right is +lateral: the inside of the right-hander, the outside of the left-hander.
    expect(drift(2200, 0.8, 1)).toBeGreaterThan(drift(2200, 0.8, 0) + 1);
    expect(drift(2395, -0.8, 1)).toBeLessThan(drift(2395, -0.8, 0) - 0.5);
  });

  test('the Freeway is a deck over the bay, its rails on, and open off it', () => {
    const track = bakeTrack(layout('paradise-open/open'), SURFACES);
    const g = track.ground!;
    const m = track.main;
    const i = Math.round(1600 / m.step);
    expect(g.deckSample[i]).toBe(1);
    expect(g.deck(m.px[i], m.pz[i])).toBeCloseTo(m.py[i], 0);
    expect(g.height(m.px[i], m.pz[i])).toBeLessThan(g.sea! - 3);
    expect(m.wallL[i] + m.wallR[i]).toBe(2);
    const off = Math.round(2300 / m.step);
    expect(m.wallL[off] + m.wallR[off]).toBe(0);
  });

  test('steering into a rail keeps you on the bridge', () => {
    const track = bakeTrack(layout('paradise-open/open'), SURFACES);
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
    const i = sim.addCar({ cls: 'coupe', human: true });
    sim.placeCar(i, 0, 1600, 6, 25);
    const c = { ...neutralControls(), throttle: 0.5, steer: 0.7 };
    let low = Infinity;
    for (let t = 0; t < 120; t++) {
      sim.step([c]);
      low = Math.min(low, sim.cars.y[i]);
    }
    expect(low).toBeGreaterThan(track.main.py[Math.round(1600 / track.main.step)] - 1);
  });

  test('a car on the sand outside a rail stays outside it', () => {
    const track = bakeTrack(layout('paradise-open/open'), SURFACES);
    const m = track.main;
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
    const i = sim.addCar({ cls: 'coupe', human: true });
    // Beside the deck's start, where the ground's still up by the road, heading in alongside it.
    sim.placeCar(i, 0, 1190, 17, 15);
    const c = { ...neutralControls(), throttle: 1, steer: -0.5 };
    let inside = false;
    let closest = Infinity;
    for (let t = 0; t < 150; t++) {
      sim.step([c]);
      const s = sim.cars.s[i];
      if (s > 1205 && s < 2050 && Math.abs(sim.cars.lateral[i]) < m.width[Math.round(s / m.step)] / 2) inside = true;
      if (s > 1205) closest = Math.min(closest, sim.cars.lateral[i]);
    }
    expect(inside).toBe(false);
    // It got to the rail (12 m out, the car's reach past it), not just short of it.
    expect(closest).toBeLessThan(14.6);
  });
});

describe('Paradise Open: the island (docs/PARADISE.md)', () => {
  const track = bakeTrack(layout('paradise-open/open'), SURFACES);
  const g = track.ground!;
  const v = track.layout.ground!.volcano!;
  const m = track.main;

  test('the road keeps its own height, off it the coast falls into the sea', () => {
    let worst = 0;
    for (let i = 0; i < m.n; i += 4) if (!g.deckSample[i]) worst = Math.max(worst, Math.abs(g.height(m.px[i], m.pz[i]) - m.py[i]));
    // (The swell rolls the road a little: the same as before the island.)
    expect(worst).toBeLessThan(1.5);
    // Well out past the coast, deep water; well inland, dry land.
    const [cx, cz] = track.layout.ground!.coast![0];
    expect(g.coast(cx, cz + 60)).toBeLessThan(0);
    expect(g.height(cx, cz + 60)).toBeLessThan(g.sea! - 3);
    expect(g.height(-200, 200)).toBeGreaterThan(g.sea! + 1);
  });

  test('the volcano rises in the middle, its crater a bowl with lava in it, and down in the lava is a wreck', () => {
    expect(g.height(v.x + v.crater, v.z)).toBeGreaterThan(90);
    expect(g.height(v.x, v.z)).toBeLessThan(g.height(v.x + v.crater, v.z) - 15);
    expect(g.inLava(v.x, v.z, g.height(v.x, v.z))).toBe(true);
    expect(g.inLava(v.x + v.crater + 10, v.z, g.height(v.x + v.crater + 10, v.z))).toBe(false);
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
    const i = sim.addCar({ cls: 'coupe', human: true });
    sim.placeCar(i, 0, 100, 0, 0);
    sim.cars.x[i] = v.x;
    sim.cars.z[i] = v.z;
    sim.cars.y[i] = g.height(v.x, v.z);
    sim.step([neutralControls()]);
    expect(sim.cars.wreck[i]).toBe(1);
    expect(sim.cars.wreckCause[i]).toBe(Cause.Hazard);
  });

  test('palms by the sea and jungle inland, none in the water, up the bare cone or on a road', () => {
    const p = track.pines!;
    expect(p.n).toBeGreaterThan(300);
    let palms = 0;
    for (let k = 0; k < p.n; k++) {
      expect(p.y[k]).toBeGreaterThan(g.sea! + 0.5);
      expect(Math.hypot(p.x[k] - v.x, p.z[k] - v.z)).toBeGreaterThan(v.r * 0.6);
      const gx = Math.round((p.x[k] - g.x0) / g.cell);
      const gz = Math.round((p.z[k] - g.z0) / g.cell);
      const i = g.near[gz * g.nx + gx];
      expect(Math.abs(g.lateral[gz * g.nx + gx])).toBeGreaterThan(m.width[i] / 2 + m.shoulder[i]);
      if (p.kind[k] === 1) {
        palms++;
        expect(g.coast(p.x[k], p.z[k])).toBeLessThan(75);
      }
    }
    expect(palms).toBeGreaterThan(50);
    expect(p.n - palms).toBeGreaterThan(50);
  });

  test('off the road, the ash pulls you back down the volcano: a climb up its flank is slower than on the flat', () => {
    /** How far a car gets in 3 s from (x, z), heading `h`, flat out. */
    const run = (x: number, z: number, h: number, pull: number) => {
      const was = TUNING.offroadSlope;
      TUNING.offroadSlope = pull;
      try {
        const sim = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
        const i = sim.addCar({ cls: 'coupe', human: true });
        sim.placeCar(i, 0, 100, 0, 0);
        sim.cars.x[i] = x;
        sim.cars.z[i] = z;
        sim.cars.y[i] = g.height(x, z);
        sim.cars.h[i] = h;
        sim.cars.vx[i] = sim.cars.vz[i] = 0;
        for (let t = 0; t < 180; t++) sim.step([{ ...neutralControls(), throttle: 1 }]);
        return Math.hypot(sim.cars.x[i] - x, sim.cars.z[i] - z);
      } finally {
        TUNING.offroadSlope = was;
      }
    };
    // Up the cone from partway up its flank, toward the crater.
    const x = v.x - v.r * 0.55;
    const up = Math.atan2(v.x - x, 0);
    expect(run(x, v.z, up, TUNING.offroadSlope)).toBeLessThan(run(x, v.z, up, 0) - 5);
  });
});

describe('Paradise Open: the Lava Tube (docs/PARADISE.md)', () => {
  const track = bakeTrack(layout('paradise-open/open'), SURFACES);
  const g = track.ground!;
  const tube = track.splines.find((s) => s.id === 'lava-tube')!;
  const v = track.layout.ground!.volcano!;
  const decks = g.branchDeck.get(tube.index)!;
  /** Its samples by what's round them: under the volcano (a tunnel) or over the shaft (the bridge). */
  const tunnel: number[] = [];
  const bridge: number[] = [];
  for (let i = 0; i < tube.n; i++) {
    if (!decks[i]) continue;
    const over = g.height(tube.px[i], tube.pz[i]) - tube.py[i];
    if (over > TUBE_H) tunnel.push(i);
    else if (over < -2) bridge.push(i);
  }

  test('it\'s a shortcut through the volcano: tunnels under it, a bridge over the lava in its shaft, shorter than the road round', () => {
    expect(tube.length).toBeLessThan(wrapGap(tube.mainFrom, tube.mainTo, track.main.length) - 80);
    expect(tunnel.length).toBeGreaterThan(150);
    expect(bridge.length).toBeGreaterThan(60);
    for (const i of bridge) {
      expect(Math.hypot(tube.px[i] - v.x, tube.pz[i] - v.z)).toBeLessThan(v.crater);
      expect(tube.py[i]).toBeGreaterThan(g.sea! + v.lava + 2);
    }
  });

  test('in a tunnel a car drives on its road; on the slope over it, a car stays on the slope', () => {
    const i = tunnel[Math.floor(tunnel.length / 2)];
    const x = tube.px[i];
    const z = tube.pz[i];
    expect(g.top(x, z, tube.py[i])).toBeCloseTo(tube.py[i], 0);
    expect(g.top(x, z, g.height(x, z))).toBeCloseTo(g.height(x, z), 3);
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
    const c = sim.addCar({ cls: 'coupe', human: true });
    sim.placeCar(c, tube.index, (tunnel[0] + 10) * tube.step, 0, 25);
    let off = 0;
    for (let t = 0; t < 90; t++) {
      sim.step([{ ...neutralControls(), throttle: 0.6 }]);
      off = Math.max(off, Math.abs(sim.cars.y[c] - g.top(sim.cars.x[c], sim.cars.z[c], sim.cars.y[c])));
    }
    expect(sim.cars.wreck[c]).toBe(0);
    expect(off).toBeLessThan(0.5);
  });

  test('off the bridge is down into the lava: a wreck, and back on the bridge', () => {
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
    const c = sim.addCar({ cls: 'coupe', human: true });
    const i = bridge[Math.floor(bridge.length / 2)];
    sim.placeCar(c, tube.index, i * tube.step, 3, 18);
    let burnt = false;
    for (let t = 0; t < 60 * 5 && !burnt; t++) {
      sim.step([{ ...neutralControls(), throttle: 0.5, steer: 1 }]);
      burnt = sim.cars.wreck[c] === 1 && sim.cars.wreckCause[c] === Cause.Hazard;
    }
    expect(burnt).toBe(true);
    for (let t = 0; t < 60 * 4 && sim.cars.wreck[c]; t++) sim.step([neutralControls()]);
    expect(sim.cars.wreck[c]).toBe(0);
    expect(sim.cars.spline[c]).toBe(tube.index);
    expect(sim.cars.y[c]).toBeGreaterThan(g.sea! + v.lava + 2);
  });

  test('a hard rival takes it, and gets round clean', () => {
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 7, slowmo: 'wreck', traffic: 0, mayhem: 'off' });
    const c = sim.addCar({ cls: 'coupe', racer: { difficulty: 2 } });
    sim.startRace(2, 0.1);
    let inTube = 0;
    let wrecks = 0;
    for (let t = 0; t < 60 * 200 && !sim.cars.finished[c]; t++) {
      sim.step([]);
      if (sim.cars.spline[c] === tube.index && sim.cars.s[c] > 100 && sim.cars.s[c] < 400) inTube++;
      if (sim.cars.wreck[c] && sim.cars.wreckT[c] === 0) wrecks++;
    }
    expect(sim.cars.finished[c]).toBe(1);
    expect(inTube).toBeGreaterThan(200);
    expect(sim.cars.wrecks[c]).toBe(0);
  });

  test('its mouths open the slope only off the main road, and no tree grows on it', () => {
    const m = track.main;
    for (let k = 0; k < g.nx * g.nz; k++) if (g.hole[k]) expect(Math.abs(g.lateral[k])).toBeGreaterThan(m.width[g.near[k]] / 2 + m.shoulder[g.near[k]]);
    const p = track.pines!;
    for (let k = 0; k < p.n; k++) {
      let near = Infinity;
      let ni = 0;
      for (let i = 0; i < tube.n; i++) {
        const d = Math.hypot(p.x[k] - tube.px[i], p.z[k] - tube.pz[i]);
        if (d < near) {
          near = d;
          ni = i;
        }
      }
      // (Over a tunnel the volcano's slope is free to grow on; by its road at the ground, nothing.)
      if (near < tube.width[ni] / 2 + tube.shoulder[ni]) expect(p.y[k] - tube.py[ni]).toBeGreaterThan(TUBE_H);
    }
  });
});

const wrapGap = (from: number, to: number, L: number) => (((to - from) % L) + L) % L;
