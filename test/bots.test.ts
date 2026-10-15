import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { neutralControls } from '../src/core/controls';
import { OVERRIDE_HOLD, Sim } from '../src/core/sim';
import { bakeTrack } from '../src/core/track/bake';
import { newHit, sampleAt } from '../src/core/track/query';
import { applyBrainAction, observeCar, racecarBots, roadAhead, seatFor } from '../src/net/bots';
import { CLASSES, SURFACES, layout, ringSim } from './helpers';

// The sample brain, as a function (the file is what an agent sends to add_bot).
const brain = new Function('log', `return (${readFileSync('bots/follow-the-road.js', 'utf8')})`)(() => {}) as (v: unknown, m: object) => unknown;

describe('applyBrainAction', () => {
  test('clamps, defaults and ignores junk', () => {
    const c = applyBrainAction({ steer: 4, throttle: -1, brake: NaN, boost: 1, drift: 'yes' }, neutralControls());
    expect(c).toMatchObject({ steer: 1, throttle: 0, brake: 0, boost: true, drift: false });
    expect(applyBrainAction(null, neutralControls())).toMatchObject({ steer: 0, throttle: 0, brake: 0 });
  });
});

describe('observeCar', () => {
  test('a car facing the road has angleToNext near 0; turned away, the sign that steers it back', () => {
    const sim = ringSim();
    const i = sim.addCar({ cls: 'coupe', racer: { difficulty: 1 } });
    const ahead = observeCar(sim, i);
    expect(Math.abs(ahead.angleToNext)).toBeLessThan(0.3);
    sim.cars.h[i] += 0.8; // turn it
    const off = observeCar(sim, i);
    // Steering by angleToNext's sign for a second brings it back toward the road ahead.
    const c = neutralControls();
    for (let t = 0; t < 60; t++) {
      c.steer = Math.sign(observeCar(sim, i).angleToNext);
      c.throttle = 0.5;
      sim.setOverride(i, c);
      sim.step([]);
    }
    expect(Math.abs(observeCar(sim, i).angleToNext)).toBeLessThan(Math.abs(off.angleToNext));
  });
});

describe('roadAhead', () => {
  test("past a branch's end, on along the road it rejoins (sampled on the branch alone, it stopped at the end)", () => {
    const sim = new Sim(bakeTrack(layout('backroads/valley'), SURFACES), CLASSES, SURFACES, { seed: 1, traffic: 0 });
    const barn = sim.track.splines.find((sp) => sp.id === 'barn')!;
    const i = sim.addCar({ cls: 'coupe', racer: { difficulty: 1 } });
    sim.placeCar(i, barn.index, barn.length - 5, 0, 30);
    sim.cars.spline[i] = barn.index;
    sim.cars.s[i] = barn.length - 5;
    const got = roadAhead(sim, i, 25, newHit());
    const want = sampleAt(sim.track.splines[barn.toRoad], barn.toS + 20, newHit());
    expect(Math.hypot(got.cx - want.cx, got.cz - want.cz)).toBeLessThan(0.01);
    const end = sampleAt(barn, barn.length, newHit());
    expect(Math.hypot(got.cx - end.cx, got.cz - end.cz)).toBeGreaterThan(15);
  });
});

describe('seatFor', () => {
  test('a bot gets the seat its id picks, whichever bot joined first; a taken one, the next free; none, undefined', () => {
    const seats = [10, 11, 12, 13];
    // Two ids that pick different seats.
    const ids = ['bot-a', 'bot-b', 'bot-c', 'bot-d', 'bot-e'];
    const a = ids[0];
    const b = ids.find((id) => seatFor(id, seats, new Set()) !== seatFor(a, seats, new Set()))!;
    const aFirst = seatFor(a, seats, new Set());
    const bThen = seatFor(b, seats, new Set([aFirst!]));
    const bFirst = seatFor(b, seats, new Set());
    const aThen = seatFor(a, seats, new Set([bFirst!]));
    expect([aFirst, bThen]).toEqual([aThen, bFirst]);
    const taken = new Set([aFirst!]);
    expect(seats).toContain(seatFor(`${b}-x`, seats, taken)!);
    expect(seatFor(a, seats, taken)).not.toBe(aFirst);
    expect(seatFor(a, seats, new Set(seats))).toBeUndefined();
  });
});

describe('racecarBots', () => {
  test("from its join the car is the bot's: the AI stops at once, before the brain's first answer", () => {
    const sim = ringSim();
    const twin = ringSim();
    const i = sim.addCar({ cls: 'coupe', racer: { difficulty: 1 } });
    twin.addCar({ cls: 'coupe', racer: { difficulty: 1 } });
    racecarBots(sim, new Map([[0, i]])).join!({ id: 'b', name: 'Test car' });
    let aiThrottle = 0;
    for (let t = 0; t < 60; t++) {
      sim.step([]);
      twin.step([]);
      expect(sim.controls[i]).toMatchObject({ steer: 0, throttle: 0, brake: 0 });
      aiThrottle = Math.max(aiThrottle, twin.controls[i].throttle);
    }
    expect(aiThrottle).toBeGreaterThan(0); // the AI would have driven it
  });

  test('a brain that stops answering: its last controls hold OVERRIDE_HOLD ticks, then the car coasts (still not the AI)', () => {
    const sim = ringSim();
    const i = sim.addCar({ cls: 'coupe', racer: { difficulty: 1 } });
    const adapter = racecarBots(sim, new Map([[0, i]]));
    const bot = { id: 'b', name: 'Test car' };
    adapter.join!(bot);
    adapter.drive(bot, { steer: 1, throttle: 1 });
    for (let t = 0; t < OVERRIDE_HOLD; t++) {
      sim.step([]);
      expect(sim.controls[i]).toMatchObject({ steer: 1, throttle: 1 });
    }
    for (let t = 0; t < 120; t++) {
      sim.step([]);
      expect(sim.controls[i]).toMatchObject({ steer: 0, throttle: 0, brake: 0 });
    }
    adapter.drive(bot, { steer: -1, throttle: 0.5 }); // it answers again
    sim.step([]);
    expect(sim.controls[i]).toMatchObject({ steer: -1, throttle: 0.5 });
  });

  test('join returns false when every AI car is taken (the SDK logs it), and true otherwise', () => {
    const sim = ringSim();
    const i = sim.addCar({ cls: 'coupe', racer: { difficulty: 1 } });
    const adapter = racecarBots(sim, new Map([[0, i]]));
    expect(adapter.join!({ id: 'a', name: 'A' })).toBe(true);
    expect(adapter.join!({ id: 'b', name: 'B' })).toBe(false);
    expect(adapter.observe({ id: 'b', name: 'B' })).toBeNull();
    adapter.leave!({ id: 'a', name: 'A' });
    expect(adapter.join!({ id: 'b', name: 'B' })).toBe(true); // the car is free again
  });

  test('drive takes the car over from the AI, and leave hands it back', () => {
    const sim = ringSim();
    const twin = ringSim(); // the same car, AI only
    const i = sim.addCar({ cls: 'coupe', racer: { difficulty: 1 } });
    twin.addCar({ cls: 'coupe', racer: { difficulty: 1 } });
    const adapter = racecarBots(sim, new Map([[0, i]]));
    const bot = { id: 'b', name: 'Test car' };
    adapter.join!(bot);
    for (let t = 0; t < 60; t++) {
      adapter.drive(bot, { steer: 1, throttle: 1 });
      sim.step([]);
      twin.step([]);
    }
    expect(sim.controls[i]).toMatchObject({ steer: 1, throttle: 1 });
    expect(Math.hypot(sim.cars.x[i] - twin.cars.x[i], sim.cars.z[i] - twin.cars.z[i])).toBeGreaterThan(2);
    adapter.leave!(bot);
    expect(sim.controlOverrides[i]).toBeNull();
    // The AI drives it again: after a second of full right it steers back left, toward the road.
    const steers: number[] = [];
    for (let t = 0; t < 30; t++) {
      sim.step([]);
      steers.push(sim.controls[i].steer);
    }
    expect(steers.includes(1)).toBe(false);
    expect(steers.some((x) => x < 0)).toBe(true);
    adapter.drive(bot, { steer: 1, throttle: 1 }); // a left bot's late action changes nothing
    expect(sim.controlOverrides[i]).toBeNull();
  });
});

describe('the sample brain', () => {
  test("stuck past 2.5 s (it can see it: view.game.stuck), it resets, as the AI does; wrecked, it doesn't", () => {
    const sim = ringSim();
    const i = sim.addCar({ cls: 'coupe', racer: { difficulty: 1 } });
    sim.cars.stuckT[i] = 3;
    const view = observeCar(sim, i);
    expect(view.stuck).toBe(3);
    expect(brain({ game: { ...view, phase: 'racing' }, now: 0 }, {})).toMatchObject({ reset: true });
    expect(brain({ game: { ...view, phase: 'racing', stuck: 1 }, now: 0 }, {})).toMatchObject({ reset: false });
    expect(brain({ game: { ...view, phase: 'racing', wrecked: true }, now: 0 }, {})).toMatchObject({ reset: false });
  });

  test('drives the ring for 20 s without stopping', () => {
    const sim = ringSim();
    const i = sim.addCar({ cls: 'coupe', racer: { difficulty: 1 } });
    const adapter = racecarBots(sim, new Map([[0, i]]));
    const bot = { id: 'b', name: 'Test car' };
    adapter.join!(bot);
    const memory = {};
    // Distance along the ring, step by step: the grid is behind the line (s wraps there), and laps
    // only count in a race.
    const length = sim.track.main.length;
    let s = sim.cars.s[i];
    let driven = 0;
    for (let t = 0; t < 20 * 60; t++) {
      if (t % 2 === 0) adapter.drive(bot, brain({ game: adapter.observe(bot), now: t }, memory) as never);
      sim.step([]);
      const ds = sim.cars.s[i] - s;
      driven += ds - Math.round(ds / length) * length;
      s = sim.cars.s[i];
    }
    expect(driven).toBeGreaterThan(300); // ~15 m/s average at least
    adapter.leave!(bot);
  });
});
