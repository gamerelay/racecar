import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { newContact, obbOverlap } from '../src/core/collide/obb';
import { SpatialGrid } from '../src/core/collide/grid';
import { neutralControls, packControls, unpackControls } from '../src/core/controls';
import { Ev } from '../src/core/events';
import { Rng, hash01 } from '../src/core/rng';
import { bakeTrack, mainDistance } from '../src/core/track/bake';
import { newHit, project, projectGlobal, sampleAt } from '../src/core/track/query';
import { validateLayout } from '../src/core/track/validate';
import { CLASSES, DOWNTOWN, SURFACES, citySim, ringSim } from './helpers';

describe('rng', () => {
  test('streams are independent and repeatable', () => {
    const a = Rng.stream(42, 'traffic');
    const b = Rng.stream(42, 'traffic');
    const c = Rng.stream(42, 'hazards');
    const xs = [a.next(), a.next(), a.next()];
    expect([b.next(), b.next(), b.next()]).toEqual(xs);
    expect(c.next()).not.toBe(xs[0]);
    expect(hash01(7, 3, 1)).toBe(hash01(7, 3, 1));
  });
});

describe('track', () => {
  const track = bakeTrack(DOWNTOWN, SURFACES);
  test('bakes a closed main spline of about 4.3 km sampled every meter', () => {
    expect(track.main.length).toBeGreaterThan(3500);
    expect(track.main.length).toBeLessThan(5000);
    expect(track.main.step).toBeCloseTo(1, 1);
    expect(track.checkpoints).toHaveLength(7);
  });
  test('projection round-trips s and lateral', () => {
    const hit = newHit();
    for (const s of [0, 123.4, 1000, 2500.5, track.main.length - 3]) {
      for (const lat of [-6, 0, 5]) {
        const at = sampleAt(track.main, s, newHit());
        const x = at.cx - at.tz * lat;
        const z = at.cz + at.tx * lat;
        project(track.main, x, z, s + 7, hit);
        expect(Math.abs(((hit.s - s + track.main.length / 2) % track.main.length) - track.main.length / 2)).toBeLessThan(0.3);
        expect(hit.lateral).toBeCloseTo(lat, 0);
        projectGlobal(track.main, x, z, hit);
        expect(hit.lateral).toBeCloseTo(lat, 0);
      }
    }
  });
  test('the alley starts and ends on the main road and maps onto its span', () => {
    const alley = track.splines[1];
    const start = sampleAt(alley, 0, newHit());
    const from = sampleAt(track.main, alley.mainFrom, newHit());
    expect(Math.hypot(start.cx - from.cx, start.cz - from.cz)).toBeLessThan(1);
    expect(mainDistance(track, 1, alley.length)).toBeCloseTo(alley.mainTo, 0);
    // The wall is open on the branch's side where it leaves.
    const i = Math.round((alley.mainFrom + 20) / track.main.step);
    expect(track.main.wallR[i] + track.main.wallL[i]).toBe(1);
  });
  test('the layout validates', () => {
    const problems = validateLayout(DOWNTOWN, SURFACES, CLASSES);
    expect(problems.filter((p) => p.level === 'error')).toEqual([]);
  });
});

describe('collide', () => {
  test('obb overlap finds the least-penetration axis', () => {
    const c = newContact();
    expect(obbOverlap(0, 0, 0, 1, 2, 1.5, 0, 0, 1, 2, c)).toBe(true);
    expect(c.nx).toBeCloseTo(1);
    expect(c.depth).toBeCloseTo(0.5);
    expect(obbOverlap(0, 0, 0, 1, 2, 2.5, 0, 0, 1, 2, c)).toBe(false);
    // Rotated 90°: B's length now lies along x.
    expect(obbOverlap(0, 0, 0, 1, 2, 2.5, 0, Math.PI / 2, 1, 2, c)).toBe(true);
  });
  test('grid returns neighbours and not far items', () => {
    const g = new SpatialGrid(16, 64, 8);
    const xs = [0, 5, 100, -3];
    const zs = [0, 5, 100, 14];
    g.rebuild(4, xs, zs, () => true);
    const out = new Int32Array(8);
    const n = g.near(1, 1, out);
    const got = Array.from(out.subarray(0, n)).sort();
    expect(got).toContain(0);
    expect(got).toContain(1);
    expect(got).toContain(3);
    expect(got).not.toContain(2);
  });
});

describe('sim', () => {
  test('a pace car laps the circuit', () => {
    const sim = citySim();
    const i = sim.addCar({ cls: 'coupe', follow: { lane: 0, speed: 45 } });
    let laps = 0;
    let cursor = 0;
    for (let t = 0; t < 60 * 240 && laps === 0; t++) {
      sim.step([]);
      cursor = sim.events.read(cursor, (e) => {
        if (e.type === Ev.Lap && e.car === i) laps++;
      });
    }
    expect(laps).toBe(1);
    expect(sim.cars.bestLap[i]).toBeGreaterThan(60);
  });

  test('full throttle down the boulevard reaches top speed without leaving the road', () => {
    const sim = citySim();
    const i = sim.addCar({ cls: 'muscle', human: true });
    const c = neutralControls();
    c.throttle = 1;
    for (let t = 0; t < 60 * 12; t++) sim.step([c]);
    const speed = Math.hypot(sim.cars.vx[i], sim.cars.vz[i]);
    expect(speed).toBeGreaterThan(50);
    expect(sim.cars.wreck[i]).toBe(0);
  });

  test('a held drift charges the mini-turbo and pays it out', () => {
    // A huge open ring, so a drift can circle freely without meeting a wall.
    const sim = ringSim(1, 600, 320);
    const i = sim.addCar({ cls: 'hatch', human: true });
    const c = neutralControls();
    c.throttle = 1;
    for (let t = 0; t < 60 * 2.5; t++) sim.step([c]);
    c.drift = true;
    c.steer = -1;
    const stages: number[] = [];
    let cursor = sim.events.head;
    for (let t = 0; t < 60 * 3.5; t++) {
      sim.step([c]);
      cursor = sim.events.read(cursor, (e) => {
        if (e.type === Ev.DriftStage) stages.push(e.b);
      });
    }
    c.drift = false;
    let mini = 0;
    for (let t = 0; t < 5; t++) {
      sim.step([c]);
      cursor = sim.events.read(cursor, (e) => {
        if (e.type === Ev.MiniTurbo) mini = e.b;
      });
    }
    expect(sim.cars.wreck[i]).toBe(0);
    expect(stages).toEqual([1, 2, 3]);
    expect(mini).toBe(3);
    expect(sim.cars.miniT[i]).toBeGreaterThan(1);
  });

  test('ramming a pace car at speed takes it down', () => {
    const sim = citySim();
    const victim = sim.addCar({ cls: 'coupe', follow: { lane: 3, speed: 12 } });
    const me = sim.addCar({ cls: 'van', human: true });
    sim.placeCar(victim, 0, 200, 3, 12);
    sim.placeCar(me, 0, 150, 3, 50);
    const c = neutralControls();
    c.throttle = 1;
    c.boost = true;
    sim.cars.boost[me] = 1;
    let wrecked = -1;
    let cursor = 0;
    for (let t = 0; t < 60 * 3; t++) {
      sim.step([undefined, c]);
      cursor = sim.events.read(cursor, (e) => {
        if (e.type === Ev.Wreck) wrecked = e.car;
      });
    }
    expect(wrecked).toBe(victim);
  });

  test('the same inputs from a snapshot give the same state', () => {
    const run = (sim: ReturnType<typeof citySim>, from: number, n: number) => {
      const c = neutralControls();
      for (let t = from; t < from + n; t++) {
        c.throttle = 1;
        c.steer = Math.sin(t / 40) * 0.8;
        c.drift = t % 300 > 200;
        c.boost = t % 500 > 400;
        sim.step([c]);
      }
    };
    const a = citySim(9);
    a.addCar({ cls: 'coupe', human: true });
    a.addCar({ cls: 'van', follow: { lane: 2, speed: 40 } });
    run(a, 0, 600);
    const snap = JSON.parse(JSON.stringify(a.snapshot()));
    run(a, 600, 1200);
    const b = citySim(9);
    b.addCar({ cls: 'coupe', human: true });
    b.addCar({ cls: 'van', follow: { lane: 2, speed: 40 } });
    b.restore(snap);
    run(b, 600, 1200);
    expect(b.cars.x[0]).toBe(a.cars.x[0]);
    expect(b.cars.z[0]).toBe(a.cars.z[0]);
    expect(b.cars.h[1]).toBe(a.cars.h[1]);
  });

  test('stepping does not allocate after warm-up', () => {
    const sim = citySim();
    for (let k = 0; k < 8; k++) sim.addCar({ cls: 'coupe', follow: { lane: (k % 4) * 3 - 4.5, speed: 30 + k * 3 } });
    const human = sim.addCar({ cls: 'hatch', human: true });
    const c = neutralControls();
    c.throttle = 1;
    const input: (typeof c | undefined)[] = [];
    input[human] = c;
    for (let t = 0; t < 600; t++) sim.step(input);
    Bun.gc(true);
    const before = process.memoryUsage().heapUsed;
    for (let t = 0; t < 6000; t++) {
      c.steer = Math.sin(t / 50);
      sim.step(input);
    }
    const grown = process.memoryUsage().heapUsed - before;
    // Allow noise from the runtime itself; 6,000 ticks allocating even one small object each would be far more.
    expect(grown).toBeLessThan(400_000);
  });

  test('a tick stays well under budget', () => {
    const sim = citySim();
    for (let k = 0; k < 8; k++) sim.addCar({ cls: 'coupe', follow: { lane: (k % 4) * 3 - 4.5, speed: 30 + k * 3 } });
    for (let t = 0; t < 300; t++) sim.step([]);
    const t0 = performance.now();
    for (let t = 0; t < 3000; t++) sim.step([]);
    const perTick = (performance.now() - t0) / 3000;
    expect(perTick).toBeLessThan(0.5);
  });
});

describe('controls', () => {
  test('pack and unpack', () => {
    const c = neutralControls();
    c.steer = -0.5;
    c.drift = true;
    c.boost = true;
    expect(unpackControls(packControls(c), neutralControls())).toEqual(c);
  });
});

describe('architecture', () => {
  test('core imports nothing outside core, and no DOM or three', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(join(import.meta.dir, '../src/core'));
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/from '([^']+)'/g)) {
        const spec = m[1];
        expect(spec.startsWith('.') ? true : `${f}: ${spec}`).toBe(true);
        const resolved = join(f, '..', spec);
        expect(resolved.includes('/src/core') ? true : `${f}: ${spec}`).toBe(true);
      }
      expect(/\b(document|window|requestAnimationFrame)\b/.test(src.replace(/\/\/.*$/gm, '')) ? f : true).toBe(true);
    }
  });
});
