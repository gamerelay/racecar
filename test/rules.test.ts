import { describe, expect, test } from 'bun:test';
import type { TrackLayout } from '../src/core/content';
import { neutralControls } from '../src/core/controls';
import { Ev, EventQueue } from '../src/core/events';
import { positions } from '../src/core/rules/progress';
import { Sim } from '../src/core/sim';
import { bakeTrack } from '../src/core/track/bake';
import { CLASSES, SURFACES, ringSim } from './helpers';

// Race rules at their edges: slow-mo and lap times, photo finishes, the order after the line,
// checkpoints on the line, silly lap counts, teleports, and the event ring.

const ringLayout = (checkpoints?: number[]): TrackLayout => ({
  id: 'ring',
  name: 'Ring',
  main: {
    points: Array.from({ length: 24 }, (_, k) => {
      const a = (k / 24) * Math.PI * 2;
      return { p: [Math.sin(a) * 200, 0, Math.cos(a) * 200] as [number, number, number], width: 60, lanes: 4 };
    }),
  },
  ...(checkpoints ? { checkpoints } : {}),
});

describe('race rules', () => {
  test('lap times are world time, so slow-mo stretches them like the race clock', () => {
    const sim = ringSim();
    const pace = sim.addCar({ cls: 'coupe', racer: { difficulty: 2 } });
    const me = sim.addCar({ cls: 'coupe', human: true });
    sim.startRace(1, 0.1);
    for (let t = 0; t < 60 * 200 && !sim.cars.finished[pace]; t++) {
      // A human wreck that never ends: the world stays in slow-mo.
      sim.cars.wreck[me] = 1;
      sim.cars.wreckT[me] = 0;
      sim.step([]);
    }
    expect(sim.cars.finished[pace]).toBe(1);
    expect(sim.timeScale).toBeLessThan(0.5);
    expect(Math.abs(sim.cars.lastLap[pace] - sim.cars.finishTime[pace])).toBeLessThan(0.1);
  });

  test('after the line, the order is the finishing order, not who drives on furthest', () => {
    const sim = ringSim();
    for (let k = 0; k < 3; k++) sim.addCar({ cls: 'coupe' });
    const c = sim.cars;
    c.finished[0] = c.finished[1] = 1;
    c.place[0] = 1;
    c.place[1] = 2;
    c.progress[0] = 1000;
    c.progress[1] = 1500;
    c.progress[2] = 1200;
    expect(positions(sim, [])).toEqual([0, 1, 2]);
  });

  test('two cars finishing on the same tick are placed by who crossed first', () => {
    const sim = ringSim();
    for (let k = 0; k < 2; k++) sim.addCar({ cls: 'coupe' });
    sim.startRace(1, 0);
    const c = sim.cars;
    const line = sim.track.main.length;
    // Car 1 is further past the line at the same speed: it crossed earlier.
    c.progress[0] = line + 0.5;
    c.progress[1] = line + 1.5;
    c.vx[0] = c.vx[1] = 40;
    const s = sim as unknown as { finishers: Int32Array; finish(n: number): void };
    s.finishers[0] = 0;
    s.finishers[1] = 1;
    s.finish(2);
    expect(c.place[1]).toBe(1);
    expect(c.place[0]).toBe(2);
  });

  test('a checkpoint on the line is dropped (it would halve the laps)', () => {
    const L = bakeTrack(ringLayout(), SURFACES).main.length;
    const track = bakeTrack(ringLayout([0, 400, 800, L, L + 3]), SURFACES);
    expect(track.checkpoints).toEqual([400, 800]);
  });

  test('startRace with 0 or a fraction of a lap races a whole lap, and resets slow-mo', () => {
    const sim = ringSim();
    sim.addCar({ cls: 'coupe' });
    sim.timeScale = 0.3;
    sim.startRace(0, 1);
    expect(sim.race.laps).toBe(1);
    expect(sim.timeScale).toBe(1);
    sim.startRace(2.7, 1);
    expect(sim.race.laps).toBe(2);
    for (let t = 0; t < 70; t++) sim.step([]);
    expect(sim.cars.finished[0]).toBe(0);
  });

  test('placeCar clears transient state: no ghosting, no stale attacker, no tilt', () => {
    const sim = ringSim();
    const i = sim.addCar({ cls: 'coupe' });
    const c = sim.cars;
    c.ghostT[i] = 1.5;
    c.lastHitBy[i] = 3;
    c.lastHitT[i] = 50;
    c.pitch[i] = 0.4;
    c.stuckT[i] = 2;
    sim.placeCar(i, 0, 100, 0);
    expect([c.ghostT[i], c.lastHitT[i], c.pitch[i], c.stuckT[i]]).toEqual([0, 0, 0, 0]);
  });

  test("a wall that ends a drift stops it: a held drift button doesn't restart it next tick", () => {
    const sim = new Sim(bakeTrack({ ...ringLayout(), main: { points: ringLayout().main.points.map((p) => ({ ...p, width: 20 })) } }, SURFACES), CLASSES, SURFACES, { seed: 1 });
    const i = sim.addCar({ cls: 'coupe', human: true });
    // Near the wall, fast, drifting into it: a glancing knock (19 m/s out), not a wreck.
    sim.placeCar(i, 0, 50, 8, 35);
    const ctl = { ...neutralControls(), throttle: 1, drift: true, steer: 1 };
    const log: [number, number][] = [];
    let cursor = sim.events.head;
    for (let t = 0; t < 120; t++) {
      sim.step([ctl]);
      cursor = sim.events.read(cursor, (e) => {
        if (e.car === i && (e.type === Ev.DriftStart || e.type === Ev.DriftEnd || e.type === Ev.WallHit)) log.push([e.tick, e.type]);
      });
    }
    const cut = log.find(([tick, type]) => type === Ev.DriftEnd && log.some(([t2, ty2]) => ty2 === Ev.WallHit && t2 === tick));
    expect(cut).toBeDefined();
    const restart = log.find(([tick, type]) => type === Ev.DriftStart && tick > cut![0] && tick <= cut![0] + 8);
    expect(restart).toBeUndefined();
  });
});

describe('event queue', () => {
  test('a reader that fell behind gets the newest ring-full, oldest first, then the head', () => {
    const q = new EventQueue(64);
    for (let n = 0; n < 64 + 10; n++) q.push(n, Ev.Lap, 0);
    const seen: number[] = [];
    const next = q.read(0, (e) => seen.push(e.seq));
    expect(seen.length).toBe(64);
    expect(seen[0]).toBe(10);
    expect(seen.at(-1)).toBe(73);
    expect(next).toBe(q.head);
    // Nothing new: nothing read.
    expect(q.read(next, () => expect.unreachable())).toBe(next);
  });
});
