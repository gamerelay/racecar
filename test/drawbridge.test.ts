// Drawbridges (docs/COASTAL.md, "The drawbridge"; CALDERA step 4, moving pieces; PieceDef.lift,
// core/world/lifts.ts): Coastal's Harbour Bridge. Two leaves whose angle is a pure function of the
// seed and the race clock: a ramp to jump early in a lift, a wall when it's up, and an AI that
// waits for it.

import { describe, expect, test } from 'bun:test';
import { respawn } from '../src/core/car/physics';
import type { TrackLayout } from '../src/core/content';
import { Ev } from '../src/core/events';
import { bakeTrack } from '../src/core/track/bake';
import { newCast } from '../src/core/track/ground';
import { newHit, sampleAt } from '../src/core/track/query';
import { validateLayout } from '../src/core/track/validate';
import { boatAt, buildLifts, cycle, liftAngleAt, liftStarts } from '../src/core/world/lifts';
import { run, setup } from '../src/dev/drive';
import { CLASSES, SURFACES, layout } from './helpers';

const riviera = layout('coastal/riviera');
const track = bakeTrack(riviera, SURFACES);
const g = track.ground!;
const bridge = g.pieces.list.find((p) => p.lift)!;
const def = bridge.lift!;
const half = (def.s[1] - def.s[0]) / 2;
/** The deck's road at `s` m along the main road. */
const at = (s: number) => sampleAt(track.main, s, newHit());
/** When seed 7's first lift starts (its warning), and its leaves reach `angle` on the way up. */
const t0 = liftStarts(def, 7, bridge.id)[0];
const rising = (angle: number) => {
  let u = def.warn;
  while (liftAngleAt(def, u) < angle) u += 0.01;
  return t0 + u;
};

describe('drawbridge', () => {
  test('lifts once or twice a race, at seeded times, the second after the first is down', () => {
    let twice = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const starts = liftStarts(def, seed, bridge.id);
      expect(liftStarts(def, seed, bridge.id)).toEqual(starts);
      expect(starts[0]).toBeGreaterThanOrEqual(def.first[0]);
      expect(starts[0]).toBeLessThanOrEqual(def.first[1]);
      if (starts.length === 2) {
        twice++;
        expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(cycle(def));
      } else expect(starts.length).toBe(1);
    }
    expect(twice / 400).toBeGreaterThan(def.twice - 0.1);
    expect(twice / 400).toBeLessThan(def.twice + 0.1);
  });

  test('its cycle: down through the warning, up to its angle smoothly, held, and down again', () => {
    const lifts = buildLifts(track, 7);
    expect(lifts.angle(0, t0 - 1)).toBe(0);
    expect(lifts.phase(0, t0 + 1)).toBe('warn');
    expect(lifts.angle(0, t0 + def.warn - 0.01)).toBe(0);
    let last = 0;
    for (let u = def.warn; u <= def.warn + def.rise; u += 0.25) {
      const a = lifts.angle(0, t0 + u);
      expect(a).toBeGreaterThanOrEqual(last);
      expect(a - last).toBeLessThan(0.15);
      last = a;
    }
    expect(lifts.angle(0, t0 + def.warn + def.rise + def.up / 2)).toBe(def.angle);
    expect(lifts.phase(0, t0 + def.warn + def.rise + def.up + 1)).toBe('falling');
    expect(lifts.angle(0, t0 + cycle(def) + 0.01)).toBe(0);
    expect(lifts.phase(0, t0 + cycle(def) + 0.01)).toBe('down');
  });

  test('its boat: moored in the harbour, out under the leaves in the first lift, back in the second', () => {
    const [inner, outer] = def.boat!;
    // The harbour's side of the road (its head, left of the road east over the bridge), and the sea's.
    expect(inner).toBeLessThan(0);
    expect(outer).toBeGreaterThan(0);
    const starts = [60, 160];
    const at = (t: number) => boatAt(def, starts, t).across;
    const under = def.warn + def.rise + def.up / 2;
    expect(at(0)).toBe(inner);
    expect(at(60)).toBe(inner);
    // Under the road halfway through the leaves' time up (they're up the whole time it's near), and on out.
    expect(at(60 + under)).toBeCloseTo(0, 9);
    for (const u of [def.warn + def.rise, def.warn + def.rise + def.up]) expect(Math.abs(at(60 + u))).toBeGreaterThan(20);
    expect(at(150)).toBe(outer);
    expect(at(160 + under)).toBeCloseTo(0, 9);
    expect(at(300)).toBe(inner);
    // Steady, no jumps.
    for (let t = 0; t < 300; t += 0.1) expect(Math.abs(at(t + 0.1) - at(t))).toBeLessThan(1.2);
  });

  test("the leaves' floor: flat down; tilted about each hinge up to the wall angle, nothing past their tips; steeper, nothing at all", () => {
    const mid = at((def.s[0] + def.s[1]) / 2);
    const c = newCast();
    try {
      for (const th of [0, 0.15, 0.4]) {
        g.setLift(bridge.index, th);
        for (const out of [2, 10, half * Math.cos(th) - 0.5]) {
          // Off the near hinge and back off the far one.
          for (const [s, sign] of [
            [def.s[0] + out, 1],
            [def.s[1] - out, -1],
          ] as const) {
            const p = at(s);
            expect([th, out, sign, g.pieceFloor(p.cx, p.cz)]).toEqual([th, out, sign, expect.closeTo(p.cy + out * Math.tan(th), 1)]);
          }
        }
      }
      // Past a tilted leaf's tip: no floor, the water under it.
      g.setLift(bridge.index, 0.4);
      g.cast(mid.cx, mid.cy + 0.3, mid.cz, c);
      expect(c.piece).toBe(-1);
      expect(c.floor).toBeLessThan(riviera.ground!.sea! - 2);
      // Steeper than its wall: no floor anywhere over it.
      g.setLift(bridge.index, def.wall + 0.05);
      const p = at(def.s[0] + 2);
      expect(g.pieceFloor(p.cx, p.cz)).toBeNaN();
    } finally {
      g.setLift(bridge.index, 0);
    }
  });

  test("the sim sets its leaves each tick: a pure function of the race clock, the same in any sim with that seed", () => {
    const input = { throttle: 0 };
    const a = setup(track, CLASSES, SURFACES, { s: 100 }, input, { t: t0 + def.warn + 2 });
    run(a, input, 1, 1);
    const angle = g.pieces.angle[bridge.index];
    expect(angle).toBeCloseTo(liftAngleAt(def, a.time - t0), 9);
    expect(angle).toBeGreaterThan(0);
    const b = setup(track, CLASSES, SURFACES, { s: 100 }, input, { t: a.time });
    expect(g.pieces.angle[bridge.index]).toBe(angle);
    // Back down for the rest of the tests.
    setup(track, CLASSES, SURFACES, { s: 100 }, input, { t: 0 });
    expect(b.world.lifts.starts).toEqual(a.world.lifts.starts);
  });

  test('early in a lift, a ramp: jumped flat out, every class lands it', () => {
    for (const cls of ['coupe', 'muscle', 'bus']) {
      const input = { throttle: 1 };
      // Arriving at its hinge as the leaves pass 0.15 rad (about 9°), at 150 km/h.
      const kmh = 150;
      const sim = setup(track, CLASSES, SURFACES, { s: def.s[0] - 60 }, input, { cls, kmh, t: rising(0.15) - 60 / (kmh / 3.6) });
      const d = run(sim, input, 3, 0.25);
      expect([cls, d.summary.wrecks]).toEqual([cls, []]);
      expect(d.summary.airSeconds).toBeGreaterThan(0.4);
      expect(d.summary.end.s).toBeGreaterThan(def.s[1]);
    }
  }, 30_000);

  test('up, a wall: driven into, a car is stopped short of the hinge (and wrecked if fast)', () => {
    const input = { throttle: 1 };
    const up = t0 + def.warn + def.rise + 1;
    const fast = run(setup(track, CLASSES, SURFACES, { s: def.s[0] - 60 }, input, { kmh: 120, t: up }), input, 3, 0.25);
    expect(fast.summary.wrecks.map((w) => w.cause)).toEqual(['wall']);
    expect(fast.summary.end.s).toBeLessThan(def.s[0] + 1);
    const crawl = { throttle: 0.15 };
    const slow = run(setup(track, CLASSES, SURFACES, { s: def.s[0] - 12 }, crawl, { kmh: 15, t: up }), crawl, 3, 0.25);
    expect(slow.summary.wrecks).toEqual([]);
    expect(slow.summary.end.s).toBeLessThan(def.s[0] + 1);
  }, 30_000);

  test('past the Basin Road, the AI waits for it when it would get there up, then goes on once it is down', () => {
    // A hard AI 150 m out (past the turn for the Basin Road), the leaves rising as it would get
    // there: too late to jump, and too late to go round.
    const up = t0 + def.warn + def.rise / 2;
    expect(track.splines.find((sp) => sp.id === 'basin-road')!.mainFrom + 60).toBeLessThan(def.s[0] - 150);
    const sim = setup(track, CLASSES, SURFACES, { s: def.s[0] - 150 }, 'ai', { kmh: 100, t: up - 5 });
    let stopped = false;
    let crossed = -1;
    let hits = 0;
    let cursor = sim.events.head;
    for (let k = 0; k < 60 * 40 && crossed < 0; k++) {
      sim.step([]);
      const c = sim.cars;
      cursor = sim.events.read(cursor, (e) => {
        if (e.car === 0 && e.type === Ev.WallHit) hits++;
      });
      // Held short of the hinge (not parked with its nose on the raised leaf, nor rolled onto it).
      if (Math.hypot(c.vx[0], c.vz[0]) < 1 && c.s[0] < def.s[0] - 4) stopped = true;
      if (c.s[0] > def.s[1] + 10 && c.s[0] < def.s[1] + 200) crossed = sim.time;
    }
    expect(stopped).toBe(true);
    expect(hits).toBe(0);
    expect(sim.cars.wreck[0]).toBe(0);
    expect(crossed).toBeGreaterThan(t0 + cycle(def) - 3);
  }, 30_000);

  test('the Basin Road: the AI goes round the harbour when the bridge would stop it, over it when it is down', () => {
    const basin = track.splines.find((sp) => sp.id === 'basin-road')!;
    expect(riviera.branches!.find((b) => b.id === 'basin-road')!.kind).toBe('alternate');
    // Round the inner harbour: it leaves before the bridge's deck and rejoins past it.
    expect(basin.mainFrom).toBeLessThan(bridge.s[0]);
    expect(basin.mainTo).toBeGreaterThan(bridge.s[1]);
    for (const [phase, t, round] of [
      ['down', 5, false],
      ['rising', t0 + def.warn + 2, true],
      ['up', t0 + def.warn + def.rise + 2, true],
    ] as const) {
      const sim = setup(track, CLASSES, SURFACES, { s: basin.mainFrom - 150 }, 'ai', { kmh: 120, t });
      let took = false;
      let hits = 0;
      let crossed = -1;
      let cursor = sim.events.head;
      for (let k = 0; k < 60 * 30 && crossed < 0; k++) {
        sim.step([]);
        const c = sim.cars;
        if (c.spline[0] === basin.index) took = true;
        cursor = sim.events.read(cursor, (e) => {
          if (e.car === 0 && e.type === Ev.WallHit) hits++;
        });
        if (c.spline[0] === 0 && c.s[0] > basin.mainTo + 20 && c.s[0] < basin.mainTo + 300) crossed = sim.time - t;
      }
      expect([phase, took, hits, sim.cars.wreck[0]]).toEqual([phase, round, 0, 0]);
      // Never held up: on round it without stopping, a few seconds slower than the bridge.
      expect([phase, crossed]).toEqual([phase, expect.any(Number)]);
      expect(crossed).toBeGreaterThan(0);
      expect(crossed).toBeLessThan(round ? 20 : 14);
    }
  }, 60_000);

  test('a respawn on it, or just before it, while it lifts goes back to its approach', () => {
    const input = { throttle: 0 };
    const sim = setup(track, CLASSES, SURFACES, { s: 100 }, input, { t: t0 + def.warn + 1 });
    sim.cars.lastSpline[0] = 0;
    for (const at of [def.s[0] + 5, def.s[0] - 30]) {
      sim.cars.lastSpline[0] = 0;
      sim.cars.lastS[0] = at;
      respawn(sim, 0);
      // (Back past a respawn's ghost run, 1.5 s at 22 m/s: from 30 m out, it ghosted through the leaf.)
      expect([at, sim.cars.s[0]]).toEqual([at, expect.closeTo(def.s[0] - 60, 0)]);
    }
    // Down, where you were.
    const down = setup(track, CLASSES, SURFACES, { s: 100 }, input, { t: 1 });
    down.cars.lastSpline[0] = 0;
    down.cars.lastS[0] = def.s[0] + 5;
    respawn(down, 0);
    expect(down.cars.s[0]).toBeCloseTo(def.s[0] + 5, 0);
  });

  test('the validator: on the main road, inside its deck, its wall under its angle', () => {
    const withLift = (lift: object) => ({ ...riviera, pieces: riviera.pieces!.map((p) => (p.lift ? { ...p, lift: { ...p.lift, ...lift } } : p)) });
    const errors = (l: TrackLayout) => validateLayout(l, SURFACES, CLASSES).filter((p) => p.level === 'error' && p.message.includes('drawbridge'));
    expect(errors(riviera)).toEqual([]);
    expect(errors(withLift({ wall: 1.3 })).length).toBe(1);
    expect(errors(withLift({ s: [bridge.s[0] - 10, def.s[1]] })).length).toBe(1);
    // Its boat: a mooring either side of the road, and across before a second lift.
    expect(errors(withLift({ boat: [-100, -50] })).length).toBe(1);
    expect(errors(withLift({ again: [25, 130] })).length).toBe(1);
  }, 60_000);
});
