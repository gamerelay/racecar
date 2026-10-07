import { describe, expect, test } from 'bun:test';
import type { TrackLayout } from '../src/core/content';
import { neutralControls } from '../src/core/controls';
import { Sim } from '../src/core/sim';
import { bakeTrack } from '../src/core/track/bake';
import { DECK_CATCH, TUBE_H, newCast } from '../src/core/track/ground';
import { validateLayout } from '../src/core/track/validate';
import { cameraFloor, clearView, slopeRise } from '../src/render/camera';
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
    pieces: [{ id: 'bridge', s: [300, 700], under: { floor: -6, ease: 60, reach: 30 } }],
    ground: { cell: 2, wallFrom: 120, wallRise: 0.3, sea: 0 },
    shoulderSurface: 'beach',
  };
}

describe('a road over the ground', () => {
  const track = bakeTrack(bridge(), SURFACES);
  const g = track.ground!;

  test('under the deck the ground is the floor, the deck is the road, and past its edge there is none', () => {
    expect(g.height(0, 500)).toBeCloseTo(-6, 0);
    expect(g.pieceFloor(0, 500)).toBeCloseTo(10, 1);
    // The road's half width and its shoulder: 11 m out is on it, 12 m isn't.
    expect(g.pieceFloor(10.5, 500)).toBeCloseTo(10, 1);
    expect(Number.isNaN(g.pieceFloor(12, 500))).toBe(true);
    // Off the deck's span, none: the road is the ground there.
    expect(Number.isNaN(g.pieceFloor(0, 150))).toBe(true);
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
        const deck = gr.pieceFloor(x, z === 300 ? z + 0.5 : z - 0.5);
        expect(Math.abs(before - deck)).toBeLessThan(0.15);
      }
    }
  });

  test('it validates', () => {
    expect(validateLayout(bridge(), SURFACES, CLASSES).filter((p) => p.level === 'error')).toEqual([]);
  });
});

describe('Paradise Open (docs/PARADISE.md)', () => {
  test('in the game as Paradise (the owner, 2026-10-07: "make this the displayed Paradise map"); the old island lap experimental, opened from a link', () => {
    expect(MAPS.find((m) => m.id === 'paradise-open')).toMatchObject({ name: 'Paradise', layouts: ['open'] });
    expect(MAPS.some((m) => m.id === 'paradise')).toBe(false);
    expect(EXPERIMENTAL_KEYS).toContain('paradise/island');
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
    expect(at(2370)).toBeGreaterThan(0.24);
    expect(at(2560)).toBeLessThan(-0.24);
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
    expect(drift(2310, 0.8, 1)).toBeGreaterThan(drift(2310, 0.8, 0) + 1);
    expect(drift(2505, -0.8, 1)).toBeLessThan(drift(2505, -0.8, 0) - 0.5);
  });

  test('the Freeway is a deck over the bay, its rails on, and open off it', () => {
    const track = bakeTrack(layout('paradise-open/open'), SURFACES);
    const g = track.ground!;
    const m = track.main;
    const i = Math.round(1600 / m.step);
    expect(g.pieces.floors(m.index)![i]).toBe(1);
    expect(g.pieceFloor(m.px[i], m.pz[i])).toBeCloseTo(m.py[i], 0);
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
    sim.placeCar(i, 0, 1300, 17, 15);
    const c = { ...neutralControls(), throttle: 1, steer: -0.5 };
    let inside = false;
    let closest = Infinity;
    for (let t = 0; t < 150; t++) {
      sim.step([c]);
      const s = sim.cars.s[i];
      if (s > 1315 && s < 2160 && Math.abs(sim.cars.lateral[i]) < m.width[Math.round(s / m.step)] / 2) inside = true;
      if (s > 1315) closest = Math.min(closest, sim.cars.lateral[i]);
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
    for (let i = 0; i < m.n; i += 4) if (!g.pieces.floors(m.index)![i]) worst = Math.max(worst, Math.abs(g.height(m.px[i], m.pz[i]) - m.py[i]));
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
    expect(g.hazard(v.x, g.height(v.x, v.z), v.z) === 'lava').toBe(true);
    expect(g.hazard(v.x + v.crater + 10, g.height(v.x + v.crater + 10, v.z), v.z) === 'lava').toBe(false);
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
    const plant = track.layout.ground?.pines?.plant ?? [];
    const planted = (x: number, z: number) => plant.some(([px, pz]) => Math.hypot(px - x, pz - z) < 0.5);
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
        // (Or anywhere on a beach, however far back from the water it runs; or planted along Harbor
        // Town's streets, up the hill.)
        const onBeach = g.beach[i] * g.lateral[gz * g.nx + gx] > 0;
        if (!onBeach && !planted(p.x[k], p.z[k])) expect(g.coast(p.x[k], p.z[k])).toBeLessThan(75);
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
  const decks = g.pieces.floors(tube.index)!;
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
    // (Less the jump's gap in its middle.)
    expect(bridge.length).toBeGreaterThan(30);
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

describe('Paradise Open: the Lava Tube, after review', () => {
  const track = bakeTrack(layout('paradise-open/open'), SURFACES);
  const g = track.ground!;
  const tube = track.splines.find((s) => s.id === 'lava-tube')!;
  const decks = g.pieces.floors(tube.index)!;

  test('a car drives into the tunnel on its road, not up the rock rising off it at the mouth', () => {
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
    const c = sim.addCar({ cls: 'coupe', human: true });
    sim.placeCar(c, tube.index, 30, 0, 40);
    let worst = 0;
    for (let t = 0; t < 60 * 3; t++) {
      sim.step([{ ...neutralControls(), throttle: 1 }]);
      if (sim.cars.spline[c] !== tube.index) continue;
      const i = Math.round(sim.cars.s[c] / tube.step);
      if (sim.cars.grounded[c]) worst = Math.max(worst, sim.cars.y[c] - tube.py[i]);
    }
    expect(worst).toBeLessThan(0.6);
  });

  test('on the slope over a tunnel, heading up it, the camera sees the slope rise', () => {
    let worst = Infinity;
    for (let i = 0; i < tube.n; i += 10) {
      const v = track.layout.ground!.volcano!;
      // (Well out from the crater: near it, 26 m ahead is down its shaft.)
      if (!decks[i] || g.height(tube.px[i], tube.pz[i]) < tube.py[i] + TUBE_H + 4 || Math.hypot(tube.px[i] - v.x, tube.pz[i] - v.z) < v.crater + 45) continue;
      // Off to the side of the tunnel, up the slope (toward the crater).
      const x = tube.px[i] - tube.tz[i] * 4;
      const z = tube.pz[i] + tube.tx[i] * 4;
      const h = Math.atan2(v.x - x, v.z - z);
      worst = Math.min(worst, slopeRise(g, x, g.height(x, z), z, Math.sin(h), Math.cos(h), 13));
    }
    expect(worst).toBeGreaterThan(-1);
  });

  test('a tunnel mouth never opens the cutting\'s floor beside the road', () => {
    for (let k = 0; k < g.nx * g.nz; k++) {
      if (!g.hole[k]) continue;
      const x = g.x0 + (k % g.nx) * g.cell;
      const z = g.z0 + Math.floor(k / g.nx) * g.cell;
      let near = Infinity;
      let ni = 0;
      for (let i = 0; i < tube.n; i++) {
        const d = Math.hypot(x - tube.px[i], z - tube.pz[i]);
        if (d < near) {
          near = d;
          ni = i;
        }
      }
      // (Against the nearest sample's road: the mouth's own sample is within a step of it. Where the
      // road climbs steeply out of a mouth, the berm's way out at 27%, that sample's off by up to
      // half a step's climb: 0.6 there.)
      const climb = Math.abs(tube.py[Math.min(tube.n - 1, ni + 1)] - tube.py[Math.max(0, ni - 1)]) / (2 * tube.step);
      expect(g.h[k]).toBeGreaterThan(tube.py[ni] + (climb > 0.2 ? 0.6 : 0.7));
    }
  });
});

describe('Paradise Open: the Lava Tube, the camera through it', () => {
  const track = bakeTrack(layout('paradise-open/open'), SURFACES);
  const g = track.ground!;
  const tube = track.splines.find((s) => s.id === 'lava-tube')!;

  test('driving it, the camera sees its road ahead: never the rock over a mouth or over the climb out', () => {
    // (Into the first mouth it read the slope over the tunnel, 16 m up; up the climb out, the
    // volcano over the roof.)
    let worst = 0;
    const ahead = 13;
    // (Not up the jump's kicker or over its gap: there it's level, across to the far side.)
    const jump = track.layout.ramps!.find((r) => r.spline === 'lava-tube')!;
    const far = jump.s + jump.length + 40;
    for (let i = 0; i + Math.round((2 * ahead) / tube.step) < tube.n; i += 2) {
      if (i * tube.step > jump.s - 2 * ahead && i * tube.step < far) continue;
      const k = (d: number) => i + Math.round(d / tube.step);
      const road = (tube.py[k(ahead)] + tube.py[k(2 * ahead)]) / 2 - tube.py[i];
      const seen = slopeRise(g, tube.px[i], tube.py[i], tube.pz[i], tube.tx[i], tube.tz[i], ahead);
      worst = Math.max(worst, Math.abs(seen - road));
    }
    expect(worst).toBeLessThan(1.5);
  });

  test('flat out of the exit tunnel, a car stays on the road (it launched 4 m off a hump onto the rim road)', () => {
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
    const c = sim.addCar({ cls: 'coupe', human: true });
    sim.placeCar(c, tube.index, 300, 0, 200 / 3.6);
    let air = 0;
    for (let t = 0; t < 60 * 4; t++) {
      sim.step([{ ...neutralControls(), throttle: 1 }]);
      air = Math.max(air, sim.cars.y[c] - g.top(sim.cars.x[c], sim.cars.z[c], sim.cars.y[c] + 0.5));
    }
    expect(sim.cars.wreck[c]).toBe(0);
    expect(air).toBeLessThan(1.5);
  });

  test('at a tunnel\'s mouth, the camera keeps its height over the road, not over the slope rising off it', () => {
    // (It rode that slope up, 7 m over the car, as the car went in.)
    const decks = g.pieces.floors(tube.index)!;
    let checked = 0;
    for (let i = 0; i < tube.n; i++) {
      const y = tube.py[i] + 2;
      const gh = g.height(tube.px[i], tube.pz[i]);
      if (!decks[i] || gh < y - 1 || gh > tube.py[i] + TUBE_H) continue;
      expect(cameraFloor(g, tube.px[i], y, tube.pz[i])).toBeCloseTo(tube.py[i], 0);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  test('flat out into the tube from the rim road, a car stays on its road (no hop where its deck starts)', () => {
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
    const c = sim.addCar({ cls: 'coupe', human: true });
    sim.placeCar(c, tube.index, 25, 0, 165 / 3.6);
    let air = 0;
    for (let t = 0; t < 60 * 1.2; t++) {
      sim.step([{ ...neutralControls(), throttle: 1 }]);
      air = Math.max(air, sim.cars.y[c] - g.top(sim.cars.x[c], sim.cars.z[c], sim.cars.y[c] + 0.5));
    }
    expect(sim.cars.wreck[c]).toBe(0);
    expect(air).toBeLessThan(0.3);
  });

  test('turned toward a tunnel wall, the camera behind the car stays in the tube, not in the rock', () => {
    let checked = 0;
    for (let i = 0; i < tube.n; i += 15) {
      if (g.height(tube.px[i], tube.pz[i]) < tube.py[i] + TUBE_H + 4) continue;
      for (const turn of [-0.8, 0.8]) {
        const h = Math.atan2(tube.tx[i], tube.tz[i]) + turn;
        const cam = { x: tube.px[i] - Math.sin(h) * 6, y: tube.py[i] + 2.5, z: tube.pz[i] - Math.cos(h) * 6 };
        clearView(g, tube.px[i], tube.py[i], tube.pz[i], cam);
        const d = g.pieceFloor(cam.x, cam.z, 0, cam.y);
        expect(d === d && cam.y > d && cam.y < d + TUBE_H).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  test('off line into a mouth, the volcano\'s face beside it is a wall: no lifting up it and out over the mountain', () => {
    for (const steer of [-0.6, 0.6]) {
      const sim = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
      const c = sim.addCar({ cls: 'coupe', human: true });
      sim.placeCar(c, tube.index, 20, 0, 40);
      let highest = -Infinity;
      for (let t = 0; t < 60 * 2.5; t++) {
        sim.step([{ ...neutralControls(), throttle: 1, steer: t < 40 ? steer : 0 }]);
        if (!sim.cars.wreck[c]) highest = Math.max(highest, sim.cars.y[c]);
      }
      expect(highest).toBeLessThan(tube.py[Math.round(80 / tube.step)] + 3);
    }
  });
});

describe('Paradise Open: the Lava Tube\'s jump over the lava', () => {
  const lay = layout('paradise-open/open');
  const track = bakeTrack(lay, SURFACES);
  const g = track.ground!;
  const tube = track.splines.find((s) => s.id === 'lava-tube')!;
  const v = lay.ground!.volcano!;
  const kicker = lay.ramps!.find((r) => r.spline === 'lava-tube')!;
  const lip = kicker.s + kicker.length;
  const [gapFrom, gapTo] = lay.pieces!.find((p) => p.road === 'lava-tube' && p.floor === false)!.s;
  /** A car of `cls` at `kmh` just before the kicker, flat out: over, or down in the lava. */
  const jump = (cls: string, kmh: number) => {
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
    const c = sim.addCar({ cls, human: true });
    sim.placeCar(c, tube.index, lip - 14, 0, kmh / 3.6);
    for (let t = 0; t < 60 * 3; t++) {
      sim.step([{ ...neutralControls(), throttle: 1 }]);
      if (sim.cars.wreck[c]) return { over: false, sim, c };
      if (sim.cars.s[c] > gapTo + 30 && sim.cars.grounded[c]) return { over: true, sim, c };
    }
    return { over: false, sim, c };
  };

  test('the bridge is broken over the middle of the shaft, a kicker up to its edge, and only the lava under the gap', () => {
    expect(gapFrom).toBe(lip);
    expect(gapTo - gapFrom).toBeGreaterThan(25);
    for (let s = gapFrom + 3; s < gapTo - 3; s += 2) {
      const i = Math.round(s / tube.step);
      expect(Math.hypot(tube.px[i] - v.x, tube.pz[i] - v.z)).toBeLessThan(v.crater - 10);
      expect(g.pieceFloor(tube.px[i], tube.pz[i])).toBeNaN();
      expect(g.hazard(tube.px[i], g.height(tube.px[i], tube.pz[i]), tube.pz[i]) === 'lava').toBe(true);
    }
  });

  test('the crossing is straight: a jump lands on the road it took off along', () => {
    const h = (s: number) => {
      const i = Math.round(s / tube.step);
      return Math.atan2(tube.tx[i], tube.tz[i]);
    };
    expect(Math.abs(h(kicker.s) - h(gapTo + 20))).toBeLessThan(0.02);
  });

  test('flat out every car makes it; off the throttle (~120 km/h) it\'s the lava', () => {
    // (Flat out from the tube's mouth the slowest car is at 175 km/h at the kicker.)
    for (const cls of CLASSES.map((c) => c.id)) {
      expect(jump(cls, 170).over).toBe(true);
      const short = jump(cls, 120);
      expect(short.over).toBe(false);
      expect(short.sim.cars.wreckCause[short.c]).toBe(Cause.Hazard);
    }
  });

  test('down in the lava, you\'re back on the far side of the gap, not at its edge with no run-up', () => {
    const { sim, c } = jump('coupe', 110);
    for (let t = 0; t < 60 * 4 && sim.cars.wreck[c]; t++) sim.step([neutralControls()]);
    expect(sim.cars.wreck[c]).toBe(0);
    expect(sim.cars.spline[c]).toBe(tube.index);
    expect(sim.cars.s[c]).toBeGreaterThan(gapTo);
    expect(g.pieceFloor(sim.cars.x[c], sim.cars.z[c])).toBeCloseTo(sim.cars.y[c], 0);
  });

  test('lining up the jump, the camera looks across the gap, not down into the lava', () => {
    for (let s = kicker.s - 30; s < kicker.s; s += 2) {
      const i = Math.round(s / tube.step);
      expect(slopeRise(g, tube.px[i], tube.py[i], tube.pz[i], tube.tx[i], tube.tz[i], 13)).toBeGreaterThan(-0.5);
    }
  });
});

describe('Paradise Open, after review (2026-10-03)', () => {
  const track = bakeTrack(layout('paradise-open/open'), SURFACES);
  const g = track.ground!;
  const tube = track.splines.find((s) => s.id === 'lava-tube')!;

  test('flat out up the slope over a mouth, a car meets the rock: it never comes down through it onto the tunnel\'s road', () => {
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
    const c = sim.addCar({ cls: 'coupe', human: true });
    sim.placeCar(c, 0, 100, 0, 0);
    const k = Math.round(66 / tube.step);
    const cars = sim.cars;
    cars.x[c] = tube.px[k];
    cars.z[c] = tube.pz[k];
    cars.y[c] = g.height(tube.px[k], tube.pz[k]) + 0.3;
    cars.h[c] = Math.atan2(tube.tx[k], tube.tz[k]);
    cars.vx[c] = tube.tx[k] * 45;
    cars.vz[c] = tube.tz[k] * 45;
    cars.grounded[c] = 0;
    for (let t = 0; t < 90; t++) {
      sim.step([{ ...neutralControls(), throttle: 1 }]);
      if (cars.grounded[c]) expect(g.height(cars.x[c], cars.z[c]) - cars.y[c]).toBeLessThan(2);
    }
  });

  test('reversing on a banked road, the bank\'s hold doesn\'t push you up it', () => {
    const hold = TUNING.bankHold;
    const moved = (h: number) => {
      TUNING.bankHold = h;
      const sim = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
      const c = sim.addCar({ cls: 'coupe', human: true });
      sim.placeCar(c, 0, 2265, 0, 0);
      sim.cars.vx[c] = -Math.sin(sim.cars.h[c]) * 9;
      sim.cars.vz[c] = -Math.cos(sim.cars.h[c]) * 9;
      const lat0 = sim.cars.lateral[c];
      for (let t = 0; t < 30; t++) sim.step([{ ...neutralControls(), brake: 1 }]);
      return sim.cars.lateral[c] - lat0;
    };
    try {
      // (Bank 0.25 there, low on the right: up it is left, negative.)
      expect(moved(hold)).toBeGreaterThan(moved(0) - 0.05);
    } finally {
      TUNING.bankHold = hold;
    }
  });

  test('a wreck in the tunnel before the jump respawns you there, not past the jump; one on its kicker, past it', () => {
    const lay = track.layout;
    const kicker = lay.ramps!.find((r) => r.spline === 'lava-tube')!;
    const gapTo = lay.pieces!.find((p) => p.floor === false)!.s[1];
    const respawnAt = (s: number) => {
      const sim = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
      const c = sim.addCar({ cls: 'coupe', human: true });
      sim.placeCar(c, tube.index, s, 0, 0);
      sim.step([{ ...neutralControls(), reset: true }]);
      for (let t = 0; t < 60 * 4 && sim.cars.wreck[c]; t++) sim.step([neutralControls()]);
      return sim.cars.s[c];
    };
    expect(respawnAt(kicker.s - 50)).toBeLessThan(kicker.s);
    expect(respawnAt(kicker.s + 4)).toBeGreaterThan(gapTo);
  });
});

describe('pieces and the cast (docs/CALDERA.md, step 1a)', () => {
  const track = bakeTrack(layout('paradise-open/open'), SURFACES);
  const g = track.ground!;
  const tube = track.splines.find((s) => s.id === 'lava-tube')!;
  const piece = (id: string) => g.pieces.list.findIndex((p) => p.id === id);
  const c = newCast();

  test("the layout's pieces: the Freeway, the tube's two tunnels and the jump's gap between them, and the market hall", () => {
    expect(g.pieces.list.map((p) => [p.id, p.floor, p.ceiling, p.building])).toEqual([
      ['freeway', true, NaN, ''],
      ['lava-tube-in', true, TUBE_H, ''],
      ['lava-jump', false, NaN, ''],
      ['lava-tube-out', true, TUBE_H, ''],
      ['market-hall', true, 7, 'market'],
    ]);
  });

  test('in the tube: on its floor, enclosed under its ceiling, the volcano over it; on the slope over it, the open; in the rock beside it, the rock', () => {
    const i = Math.round(120 / tube.step);
    const [x, y, z] = [tube.px[i], tube.py[i], tube.pz[i]];
    g.cast(x, y + 1, z, c);
    expect(c.piece).toBe(piece('lava-tube-in'));
    expect(c.floor).toBeCloseTo(y, 1);
    expect(c.space).toBe('enclosed');
    expect(c.ceiling).toBeCloseTo(y + TUBE_H, 1);
    expect(c.ground).toBeGreaterThan(y + TUBE_H);
    // A car on the floor, or sunk into it by a hard landing, is inside too.
    for (const at of [y, y - 0.3]) expect(g.cast(x, at, z, c).space).toBe('enclosed');
    g.cast(x, c.ground + 1, z, c);
    expect(c.piece).toBe(-1);
    expect(c.space).toBe('open');
    expect(c.over).toBeCloseTo(y, 1);
    // 3 m over the ceiling, under the slope: in the rock.
    g.cast(x, y + TUBE_H + 3, z, c);
    expect(c.space).toBe('rock');
  });

  test('on the Freeway: its floor from above, the bay from under it', () => {
    const m = track.main;
    const i = Math.round(1600 / m.step);
    g.cast(m.px[i], m.py[i] + 0.5, m.pz[i], c);
    expect(c.piece).toBe(piece('freeway'));
    expect(c.space).toBe('open');
    g.cast(m.px[i], m.py[i] - DECK_CATCH - 1, m.pz[i], c);
    expect(c.piece).toBe(-1);
    expect(c.floor).toBe(c.ground);
  });

  test('over the gap there is no floor: down to the lava', () => {
    const p = g.pieces.list[piece('lava-jump')];
    const i = Math.round((p.s[0] + p.s[1]) / 2 / tube.step);
    expect(g.pieceFloor(tube.px[i], tube.pz[i])).toBeNaN();
    expect(g.pieces.gaps(tube.index)![i]).toBe(1);
    // What a car there stands on is the shaft's floor, 6 m down.
    expect(g.top(tube.px[i], tube.pz[i], tube.py[i])).toBe(g.height(tube.px[i], tube.pz[i]));
    expect(g.height(tube.px[i], tube.pz[i])).toBeLessThan(tube.py[i] - 5);
  });

  test('the validator checks them', () => {
    const lay = layout('paradise-open/open');
    lay.pieces!.push({ id: 'freeway', s: [0, 10] }, { id: 'a', road: 'nope', s: [0, 10] }, { id: 'b', road: 'lava-tube', s: [10, 20], under: { floor: 0, ease: 1, reach: 1 } }, { id: 'c', s: [5, 1], floor: false, ceiling: 3 });
    const errors = validateLayout(lay, SURFACES, CLASSES).filter((p) => p.level === 'error').map((p) => p.message);
    expect(errors.some((m) => m.includes('another piece'))).toBe(true);
    expect(errors.some((m) => m.includes('no branch "nope"'))).toBe(true);
    expect(errors.some((m) => m.includes('main road only'))).toBe(true);
    expect(errors.some((m) => m.includes("isn't a stretch"))).toBe(true);
    expect(errors.some((m) => m.includes('a ceiling needs a floor'))).toBe(true);
    expect(errors.some((m) => m.includes('branches only'))).toBe(true);
  });

  test('the validator: pieces of one road may share an end, not overlap; under needs an ease and a reach', () => {
    const lay = layout('paradise-open/open');
    expect(validateLayout(lay, SURFACES, CLASSES).filter((p) => p.level === 'error')).toEqual([]);
    lay.pieces!.push({ id: 'over', road: 'lava-tube', s: [200, 300] }, { id: 'flat', s: [10, 20], under: { floor: 0, ease: 0, reach: 5 } });
    const errors = validateLayout(lay, SURFACES, CLASSES).filter((p) => p.level === 'error').map((p) => p.message);
    expect(errors.some((m) => m.includes('overlap on lava-tube'))).toBe(true);
    expect(errors.some((m) => m.includes('an ease and a reach'))).toBe(true);
  });

  test('the validator: a sample one step into the next piece is an overlap; ground shaping clear of the start line', () => {
    const lay = layout('paradise-open/open');
    const tube = lay.pieces!.find((p) => p.id === 'lava-tube-in')!;
    // Half a meter into the jump: a sample would be both a floor and a gap (it used to pass, up to a step).
    tube.s = [tube.s[0], tube.s[1] + 0.5];
    // Its run-in doesn't wrap past the line, so the ground there would meet the floor with a step.
    lay.pieces!.push({ id: 'start', s: [10, 100], under: { floor: 0, ease: 5, reach: 5 } });
    const errors = validateLayout(lay, SURFACES, CLASSES).filter((p) => p.level === 'error').map((p) => p.message);
    expect(errors.some((m) => m.includes('lava-tube-in and lava-jump overlap'))).toBe(true);
    expect(errors.some((m) => m.includes('from the start line'))).toBe(true);
  });
});
