import { wrapAngle } from '../src/core/math';
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { newContact, obbOverlap } from '../src/core/collide/obb';
import { SpatialGrid } from '../src/core/collide/grid';
import { neutralControls, packControls, unpackControls } from '../src/core/controls';
import { Cause, Ev } from '../src/core/events';
import { Rng, hash01 } from '../src/core/rng';
import { bakeTrack, mainDistance, signedGap } from '../src/core/track/bake';
import { newHit, project, projectGlobal, sampleAt } from '../src/core/track/query';
import { validateLayout } from '../src/core/track/validate';
import { Sim } from '../src/core/sim';
import { respawn } from '../src/core/car/physics';
import { TUNING } from '../src/core/car/tuning';
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
  test('bakes a closed main spline of about 3.3 km sampled every meter', () => {
    expect(track.main.length).toBeGreaterThan(2800);
    expect(track.main.length).toBeLessThan(4000);
    expect(track.main.step).toBeCloseTo(1, 1);
    expect(track.checkpoints.length).toBeGreaterThanOrEqual(5);
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
  test('signedGap is the short way round a loop', () => {
    expect(signedGap(10, 990, 1000)).toBe(20);
    expect(signedGap(990, 10, 1000)).toBe(-20);
    expect(signedGap(300, 100, 1000)).toBe(200);
    expect(signedGap(100, 100, 1000)).toBe(0);
  });

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

  test('a held drift turns the car, keeps its speed, and banks boost that a clean exit pays in', () => {
    // A huge open ring, so a drift can circle freely without meeting a wall.
    const sim = ringSim(1, 600, 320);
    const i = sim.addCar({ cls: 'hatch', human: true });
    const c = neutralControls();
    c.throttle = 1;
    for (let t = 0; t < 60 * 2.5; t++) sim.step([c]);
    const entry = Math.hypot(sim.cars.vx[i], sim.cars.vz[i]);
    const h0 = sim.cars.h[i];
    const boost0 = sim.cars.boost[i];
    c.drift = true;
    c.steer = -1;
    const seen: number[] = [];
    let cursor = sim.events.head;
    const watch = () =>
      (cursor = sim.events.read(cursor, (e) => {
        if (e.type === Ev.DriftStage || e.type === Ev.MiniTurbo || e.type === Ev.DriftBoost) seen.push(e.type);
      }));
    for (let t = 0; t < 60 * 2; t++) {
      sim.step([c]);
      watch();
    }
    expect(sim.cars.drift[i]).toBe(1);
    const turned = Math.abs(wrapAngle(sim.cars.h[i] - h0));
    const held = Math.hypot(sim.cars.vx[i], sim.cars.vz[i]);
    const boost = sim.cars.boost[i];
    const releaseSlip = Math.abs(sim.cars.slip[i]);
    c.drift = false;
    c.steer = 0;
    for (let t = 0; t < 30; t++) {
      sim.step([c]);
      watch();
      // The slide carries after release instead of snapping straight (playtest).
      if (t === 6) expect(Math.abs(sim.cars.slip[i])).toBeGreaterThan(releaseSlip * 0.6);
    }
    for (let t = 0; t < 30; t++) sim.step([c]);
    expect(Math.abs(sim.cars.slip[i])).toBeLessThan(0.05);
    expect(sim.cars.wreck[i]).toBe(0);
    expect(turned).toBeGreaterThan(1.5);
    expect(held).toBeGreaterThan(entry * 0.85);
    // Banked while drifting (the meter doesn't move), paid in on release; no mini-turbo kick.
    expect(boost).toBe(boost0);
    expect(seen).toEqual([Ev.DriftBoost]);
    expect(sim.cars.miniT[i]).toBe(0);
    expect(sim.cars.boost[i] - boost).toBeGreaterThan(0.2);
    expect(sim.cars.boost[i] - boost).toBeLessThan(0.55);
  });

  test('a wreck in a race respawns with catch-up boost by how far behind the leader; a reset gets none', () => {
    const sim = citySim();
    for (let k = 0; k < 4; k++) sim.addCar({ cls: 'coupe' });
    sim.startRace(3, 0.2);
    for (let t = 0; t < 30; t++) sim.step([]);
    expect(sim.race.phase).toBe('racing');
    const c = sim.cars;
    const paid: number[] = [];
    const [leader, close, far, reset] = [0, 1, 2, 3];
    c.progress[leader] = 1000;
    c.progress[close] = 990;
    c.progress[far] = 1000 - TUNING.respawnBoostGap * 2;
    c.progress[reset] = 500;
    for (const i of [leader, close, far, reset]) {
      c.boost[i] = 0;
      c.wreckCause[i] = i === reset ? Cause.Reset : Cause.Wall;
      respawn(sim, i);
      paid.push(c.boost[i]);
    }
    expect(paid[leader]).toBeCloseTo(TUNING.respawnBoost, 5);
    expect(paid[close]).toBeGreaterThan(paid[leader]);
    expect(paid[far]).toBeCloseTo(TUNING.respawnBoost + TUNING.respawnBoostBehind, 5);
    expect(paid[reset]).toBe(0);
    // The meter never overfills.
    c.boost[far] = 0.9;
    respawn(sim, far);
    expect(c.boost[far]).toBe(1);
  });

  describe('drift feel', () => {
    // Up to speed on the open ring, then a full-lock drift to the right for `hold` seconds.
    const drift = (cls: string, hold: number) => {
      const sim = ringSim(1, 600, 320);
      const i = sim.addCar({ cls, human: true });
      const c = neutralControls();
      c.throttle = 1;
      for (let t = 0; t < 60 * 3; t++) sim.step([c]);
      c.drift = true;
      c.steer = -1;
      for (let t = 0; t < 60 * hold; t++) sim.step([c]);
      return { sim, i, c };
    };
    const events = (sim: Sim, type: number, run: () => void) => {
      let n = 0;
      let cursor = sim.events.head;
      run();
      sim.events.read(cursor, (e) => {
        if (e.type === type) n++;
      });
      return n;
    };

    test('a tap-drift banks nothing', () => {
      const { sim, i, c } = drift('coupe', 0.1);
      const boost = sim.cars.boost[i];
      c.drift = false;
      const paid = events(sim, Ev.DriftBoost, () => {
        for (let t = 0; t < 30; t++) sim.step([c]);
      });
      expect(paid).toBe(0);
      expect(sim.cars.boost[i]).toBe(boost);
    });

    test('a spin-out loses the bank', () => {
      const { sim, i, c } = drift('coupe', 1.5);
      expect(sim.cars.driftBank[i]).toBeGreaterThan(0.05);
      const boost = sim.cars.boost[i];
      // Overcook it: swing the nose far past the drift angle.
      sim.cars.h[i] = wrapAngle(sim.cars.h[i] + Math.sign(sim.cars.slip[i]) * 0.6);
      const paid = events(sim, Ev.DriftBoost, () => {
        for (let t = 0; t < 30; t++) sim.step([c]);
      });
      expect(sim.cars.spinT[i]).toBeGreaterThan(0);
      expect(paid).toBe(0);
      expect(sim.cars.driftBank[i]).toBe(0);
      expect(sim.cars.boost[i]).toBe(boost);
    });

    test('the bank never overfills the meter', () => {
      const { sim, i, c } = drift('hatch', 1.5);
      sim.cars.boost[i] = 0.95;
      c.drift = false;
      sim.step([c]);
      expect(sim.cars.boost[i]).toBeLessThanOrEqual(1);
    });

    test('heavier cars carry their slide longer (driftCarry)', () => {
      const straighten = (cls: string) => {
        const { sim, i, c } = drift(cls, 1.5);
        c.drift = false;
        c.steer = 0;
        let t = 0;
        while (Math.abs(sim.cars.slip[i]) > 0.02 && t < 300) {
          sim.step([c]);
          t++;
        }
        return t;
      };
      const hatch = straighten('hatch');
      const coupe = straighten('coupe');
      const muscle = straighten('muscle');
      expect(hatch).toBeLessThan(coupe);
      expect(coupe).toBeLessThan(muscle);
      expect(muscle).toBeLessThan(60);
    });

    test('placing a car (the grid, the editor) clears transient driving state', () => {
      const { sim, i, c } = drift('coupe', 1);
      c.drift = false;
      sim.step([c]);
      sim.cars.miniT[i] = 1;
      sim.cars.stallT[i] = 1;
      sim.cars.lastTakenBy[i] = 3;
      sim.placeCar(i, 0, 50, 0);
      for (const f of ['driftExit', 'driftBank', 'driftChain', 'miniT', 'stallT', 'lastTakenBy', 'drift'] as const) expect(sim.cars[f][i]).toBe(0);
    });

    test('a respawn clears the drift state', () => {
      const { sim, i, c } = drift('coupe', 1);
      c.drift = false;
      sim.step([c]);
      expect(sim.cars.driftExit[i]).toBeGreaterThan(0);
      respawn(sim, i);
      expect(sim.cars.driftExit[i]).toBe(0);
      expect(sim.cars.driftBank[i]).toBe(0);
      expect(sim.cars.drift[i]).toBe(0);
    });
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

  test('stepping does not allocate after warm-up (full world: 8 AI, traffic, chaos hazards, rain)', () => {
    const sim = new Sim(bakeTrack(DOWNTOWN, SURFACES), CLASSES, SURFACES, { seed: 3, weather: 'rain', mayhem: 'chaos', traffic: 1 });
    for (let k = 0; k < 8; k++) sim.addCar({ cls: CLASSES[k % 4].id, racer: { difficulty: (k % 3) as 0 | 1 | 2 } });
    sim.startRace(3, 0.5);
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

describe('editing', () => {
  test('moving an early point keeps the shortcut, ramp and spots where they were in the world', async () => {
    const { reanchor } = await import('../src/core/track/anchor');
    const before = bakeTrack(DOWNTOWN, SURFACES);
    const edited = structuredClone(DOWNTOWN);
    // Bulge the Climb (nothing placed on it) east, making the lap longer.
    const k = edited.main.points.findIndex((q) => Math.abs(q.p[0] - 240) < 1 && q.p[2] > 470 && q.p[2] < 590);
    edited.main.points[k].p[0] += 60;
    const moved = reanchor(before, edited, SURFACES);
    const after = bakeTrack(moved, SURFACES);
    expect(after.main.length).toBeGreaterThan(before.main.length + 20);
    const at = (t: typeof before, s: number) => sampleAt(t.main, s, newHit());
    for (const [a, b] of [
      [DOWNTOWN.branches![0].from, moved.branches![0].from],
      [DOWNTOWN.branches![0].to, moved.branches![0].to],
      [DOWNTOWN.props![0].s, moved.props![0].s],
    ]) {
      const p = at(before, a);
      const q = at(after, b);
      expect(Math.hypot(p.cx - q.cx, p.cz - q.cz)).toBeLessThan(1.5);
    }
    expect(validateLayout(moved, SURFACES, CLASSES).filter((p) => p.level === 'error' && p.message.includes('branch'))).toEqual([]);
  });
});
