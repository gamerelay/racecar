import { describe, expect, test } from 'bun:test';
import { TUNING } from '../src/core/car/tuning';
import { neutralControls, type Controls } from '../src/core/controls';
import { Ev } from '../src/core/events';
import type { Sim } from '../src/core/sim';
import { sampleAt, newHit } from '../src/core/track/query';
import { respawn } from '../src/core/car/physics';
import { ringSim } from './helpers';

// Past the class's top speed: the straight-line build (flat out and clean), and the slipstream
// behind another car, with its slingshot for pulling out to pass.

const hit = newHit();

/** Flat out round a huge ring, steering along it, `lat` m off the middle. */
function drive(sim: Sim, i: number, lat = 0, extra: Partial<Controls> = {}): Controls {
  const c = sim.cars;
  const at = sampleAt(sim.track.main, c.s[i] + 8, hit);
  const tx = at.cx - at.tz * lat - c.x[i];
  const tz = at.cz + at.tx * lat - c.z[i];
  let err = Math.atan2(tx, tz) - c.h[i];
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;
  return { ...neutralControls(), throttle: 1, steer: Math.max(-1, Math.min(1, -err * 3)), ...extra };
}

function track(radius = 3000) {
  return ringSim(1, radius, 40);
}

describe('the straight-line build', () => {
  test('flat out and clean, the top speed climbs to cruiseTop over the class\'s; a brake ends it at once', () => {
    const sim = track();
    const i = sim.addCar({ cls: 'coupe', human: true });
    sim.placeCar(i, 0, 100, 0, 60);
    let overdrive = false;
    let cursor = sim.events.head;
    const speed = () => Math.hypot(sim.cars.vx[i], sim.cars.vz[i]);
    // Flat out without the build (a touch of brake every so often keeps it at zero).
    for (let t = 0; t < 60 * 8; t++) sim.step([drive(sim, i, 0, { brake: t % 60 === 0 ? 0.01 : 0 })]);
    const flat = speed();
    for (let t = 0; t < 60 * 14; t++) {
      sim.step([drive(sim, i)]);
      cursor = sim.events.read(cursor, (e) => {
        if (e.type === Ev.Overdrive && e.car === i) overdrive = true;
      });
    }
    expect(sim.cars.cruise[i]).toBe(1);
    expect(overdrive).toBe(true);
    // A few percent faster flat out (the drag takes some of cruiseTop back).
    expect(speed()).toBeGreaterThan(flat * 1.04);
    sim.step([drive(sim, i, 0, { throttle: 0, brake: 1 })]);
    expect(sim.cars.cruise[i]).toBe(0);
  });

  test('Overdrive pops once per build: easing off for a tick and back on doesn\'t pop it again', () => {
    const sim = track();
    const i = sim.addCar({ cls: 'coupe', human: true });
    sim.placeCar(i, 0, 100, 0, 60);
    let pops = 0;
    let cursor = sim.events.head;
    const run = (ticks: number, extra: (t: number) => Partial<Controls> = () => ({})) => {
      for (let t = 0; t < ticks; t++) {
        sim.step([drive(sim, i, 0, extra(t))]);
        cursor = sim.events.read(cursor, (e) => {
          if (e.type === Ev.Overdrive && e.car === i) pops++;
        });
      }
    };
    run(60 * 10);
    expect(pops).toBe(1);
    // A tick off the throttle every half second: it dips under 1 and comes back, one pop.
    run(60 * 4, (t) => (t % 30 === 0 ? { throttle: 0.5 } : {}));
    expect(pops).toBe(1);
    // Ended (a touch of brake) and built again: a second pop.
    run(1, () => ({ brake: 0.01 }));
    run(60 * 10);
    expect(pops).toBe(2);
  });

  test('no build off the throttle', () => {
    const sim = track();
    const i = sim.addCar({ cls: 'coupe', human: true });
    sim.placeCar(i, 0, 100, 0, 60);
    for (let t = 0; t < 60 * 6; t++) sim.step([drive(sim, i, 0, { throttle: 0.5 })]);
    expect(sim.cars.cruise[i]).toBe(0);
  });
});

describe('the slipstream', () => {
  /** Two cars flat out in line, the second 12 m behind; `out` from when the follower pulls out. */
  function pair(out: number, radius = 3000, cap = 55, gap = 12) {
    const sim = track(radius);
    const a = sim.addCar({ cls: 'coupe', human: true });
    const b = sim.addCar({ cls: 'coupe', human: true });
    sim.placeCar(a, 0, 100 + gap, 0, Math.min(50, cap));
    sim.placeCar(b, 0, 100, 0, Math.min(50, cap));
    const seen: number[] = [];
    let drafted = 0;
    let cursor = sim.events.head;
    for (let t = 0; t < 60 * 4; t++) {
      // The leader holds a little under top speed, so the follower can't just drive away.
      const lead = drive(sim, a, 0, { throttle: Math.hypot(sim.cars.vx[a], sim.cars.vz[a]) < cap ? 1 : 0 });
      const follow = drive(sim, b, t >= out ? 6 : 0, radius < 3000 ? { throttle: Math.hypot(sim.cars.vx[b], sim.cars.vz[b]) < cap ? 1 : 0 } : {});
      sim.step([lead, follow]);
      drafted = Math.max(drafted, sim.cars.draft[b]);
      cursor = sim.events.read(cursor, (e) => {
        if (e.type === Ev.Slingshot) seen.push(e.car);
      });
    }
    return { sim, a, b, seen, drafted };
  }

  test('tucked in behind, the follower is in the slipstream and the leader isn\'t', () => {
    const { sim, a, drafted } = pair(Infinity);
    expect(drafted).toBeGreaterThan(0.95);
    expect(sim.cars.draft[a]).toBe(0);
  });

  test('pulling out to pass after slipCharge s is a slingshot: slingTop for slingTime s', () => {
    const { sim, b, seen } = pair(60 * 2);
    expect(seen).toEqual([b]);
    // It's still going, or ran out within the 2 s since.
    expect(sim.cars.slingT[b]).toBeLessThanOrEqual(TUNING.slingTime);
  });

  test('pulling out too soon is no slingshot', () => {
    expect(pair(Math.floor(60 * TUNING.slipCharge * 0.5)).seen).toEqual([]);
  });

  test('following a car round a bend is no slingshot (the car ahead is off the nose, not passed)', () => {
    // 21 m behind on a 400 m radius (3° of road between them), the car ahead is about 0.6 m off
    // the follower's nose; on a 70 m one (17°, past the straight's 11°) there's no slipstream at all.
    const wide = pair(Infinity, 400, 45, 21);
    expect(wide.drafted).toBeGreaterThan(0.95);
    expect(wide.seen).toEqual([]);
    const tight = pair(Infinity, 70, 24, 21);
    expect(tight.drafted).toBe(0);
    expect(tight.seen).toEqual([]);
  });

  test('a ghost (just respawned) gives no slipstream', () => {
    const sim = track();
    const a = sim.addCar({ cls: 'coupe', human: true });
    const b = sim.addCar({ cls: 'coupe', human: true });
    sim.placeCar(a, 0, 112, 0, 50);
    sim.placeCar(b, 0, 100, 0, 50);
    let drafted = 0;
    for (let t = 0; t < 60; t++) {
      sim.cars.ghostT[a] = 1;
      sim.step([drive(sim, a), drive(sim, b)]);
      drafted = Math.max(drafted, sim.cars.draft[b]);
    }
    expect(drafted).toBe(0);
  });
});

describe('through a wreck', () => {
  test('a respawn clears the slipstream, the slingshot and Overdrive', () => {
    const sim = track();
    const i = sim.addCar({ cls: 'coupe', human: true });
    sim.placeCar(i, 0, 100, 0, 60);
    sim.step([drive(sim, i)]);
    const c = sim.cars;
    c.draft[i] = 1;
    c.draftT[i] = 1;
    c.slingT[i] = 1;
    c.cruise[i] = 1;
    c.cruiseFull[i] = 1;
    respawn(sim, i);
    expect([c.draft[i], c.draftT[i], c.slingT[i], c.cruise[i], c.cruiseFull[i]]).toEqual([0, 0, 0, 0, 0]);
  });
});
