import { describe, expect, test } from 'bun:test';
import { TUNING } from '../src/core/car/tuning';
import { neutralControls, type Controls } from '../src/core/controls';
import { Ev } from '../src/core/events';
import type { Sim } from '../src/core/sim';
import { sampleAt, newHit } from '../src/core/track/query';
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

function track() {
  return ringSim(1, 3000, 40);
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
  function pair(out: number) {
    const sim = track();
    const a = sim.addCar({ cls: 'coupe', human: true });
    const b = sim.addCar({ cls: 'coupe', human: true });
    sim.placeCar(a, 0, 112, 0, 50);
    sim.placeCar(b, 0, 100, 0, 50);
    const seen: number[] = [];
    let drafted = 0;
    let cursor = sim.events.head;
    for (let t = 0; t < 60 * 4; t++) {
      // The leader holds a little under top speed, so the follower can't just drive away.
      const lead = drive(sim, a, 0, { throttle: Math.hypot(sim.cars.vx[a], sim.cars.vz[a]) < 55 ? 1 : 0 });
      sim.step([lead, drive(sim, b, t >= out ? 6 : 0)]);
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
});
