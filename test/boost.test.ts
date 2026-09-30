import { describe, expect, test } from 'bun:test';
import { earnBoost } from '../src/core/car/physics';
import { TUNING } from '../src/core/car/tuning';
import { neutralControls } from '../src/core/controls';
import { Ev, type GameEvent } from '../src/core/events';
import { ringSim } from './helpers';

// Air time pays on a clean landing, and boost from moves is scaled by race position: a little
// less for the leader, a little more for whoever is last.

/** A car on a big flat ring, dropped from `height` m (at speed), and the events it saw. */
function drop(height: number) {
  const sim = ringSim(1, 600, 60);
  const i = sim.addCar({ cls: 'coupe', human: true });
  sim.placeCar(i, 0, 100, 0, 30);
  sim.cars.boost[i] = 0;
  const c = { ...neutralControls(), throttle: 1 };
  sim.step([c]);
  sim.cars.y[i] += height;
  sim.cars.grounded[i] = 0;
  const seen: GameEvent[] = [];
  let cursor = sim.events.head;
  for (let t = 0; t < 120; t++) {
    sim.step([c]);
    cursor = sim.events.read(cursor, (e) => {
      if (e.car === i) seen.push({ ...e });
    });
  }
  return { sim, i, seen };
}

describe('air boost', () => {
  test('a clean landing pays for the air time, on the landing', () => {
    const { sim, i, seen } = drop(4);
    const air = seen.filter((e) => e.type === Ev.AirBoost);
    expect(air.length).toBe(1);
    expect(air[0].b).toBeGreaterThan(TUNING.airMin);
    expect(air[0].a).toBeCloseTo(TUNING.boostFromAir * air[0].b, 3);
    expect(sim.cars.boost[i]).toBeCloseTo(air[0].a, 3);
    expect(sim.cars.score[i]).toBeGreaterThanOrEqual(Math.round(TUNING.airPoints * air[0].b));
  });

  test("a hop shorter than airMin doesn't pay", () => {
    const { seen } = drop(0.4);
    expect(seen.some((e) => e.type === Ev.Land)).toBe(true);
    expect(seen.filter((e) => e.type === Ev.AirBoost)).toEqual([]);
  });
});

describe('boost by position', () => {
  const race = () => {
    const sim = ringSim(1, 400, 60);
    for (let k = 0; k < 4; k++) sim.addCar({ cls: 'coupe', racer: { difficulty: 1 } });
    sim.startRace(3, 0.1);
    for (let t = 0; t < 60; t++) sim.step([]);
    expect(sim.race.phase).toBe('racing');
    return sim;
  };

  test('last place earns boostPlaceLast times as much from a move as a car with no scaling; the leader boostPlaceLead', () => {
    const sim = race();
    const c = sim.cars;
    const paid = (rank: number) => {
      c.rank[0] = rank;
      c.boost[0] = 0;
      return earnBoost(sim, 0, 0.1);
    };
    expect(paid(0)).toBeCloseTo(0.1 * TUNING.boostPlaceLead, 6);
    expect(paid(3)).toBeCloseTo(0.1 * TUNING.boostPlaceLast, 6);
    expect(paid(1)).toBeGreaterThan(paid(0));
    expect(paid(2)).toBeLessThan(paid(3));
    // Never past a full meter.
    c.boost[0] = 0.98;
    expect(earnBoost(sim, 0, 0.1)).toBeCloseTo(0.02, 6);
    expect(c.boost[0]).toBe(1);
  });

  test("ranks follow the race order, and outside a race there's no scaling", () => {
    const sim = race();
    const c = sim.cars;
    for (let t = 0; t < 60 * 5; t++) sim.step([]);
    const order = [0, 1, 2, 3].sort((a, b) => c.progress[b] - c.progress[a]);
    expect(order.map((i) => c.rank[i])).toEqual([0, 1, 2, 3]);
    const free = ringSim(1, 400, 60);
    for (let k = 0; k < 2; k++) free.addCar({ cls: 'coupe', racer: { difficulty: 1 } });
    free.cars.rank[1] = 1;
    expect(earnBoost(free, 1, 0.1)).toBeCloseTo(0.1, 6);
  });
});
