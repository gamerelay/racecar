import { describe, expect, test } from 'bun:test';
import { neutralControls } from '../src/core/controls';
import { Ev } from '../src/core/events';
import { Sim } from '../src/core/sim';
import { bakeTrack } from '../src/core/track/bake';
import { Hazards } from '../src/core/world/hazards';
import { newTrafficPose, Traffic } from '../src/core/world/traffic';
import { planWeather, weatherAt } from '../src/core/world/weather';
import { CLASSES, DOWNTOWN, SURFACES } from './helpers';

const track = bakeTrack(DOWNTOWN, SURFACES);

describe('traffic', () => {
  test('is the same on every client: a pure function of seed and time', () => {
    const a = new Traffic(track, 42);
    const b = new Traffic(track, 42);
    const c = new Traffic(track, 43);
    expect(a.count).toBeGreaterThan(20);
    for (const t of [0, 12.5, 90, 600]) expect(a.poseAll(t)).toEqual(b.poseAll(t));
    expect(a.poseAll(30)).not.toEqual(c.poseAll(30));
  });
  test('only appears in its sections, and never on the start grid early on', () => {
    const tr = new Traffic(track, 1);
    const L = track.main.length;
    const sections = tr.lanes[0].sections!;
    for (let k = 0; k < tr.count; k++) {
      for (const t of [0, 5, 45, 200]) {
        if (!tr.present(k, t)) continue;
        const s = tr.sAt(k, t);
        expect(sections.some(([a, b]) => (a <= b ? s >= a && s <= b : s >= a || s <= b))).toBe(true);
        if (t < 10) expect(s > L - 160 || s < 60).toBe(false);
      }
    }
  });
  test('nothing pops: visibility changes no faster than a fade, and only solid cars are posed', () => {
    const tr = new Traffic(track, 1);
    const dt = 1 / 60;
    // The fastest a fade can go: a lane's speed over FADE meters, or FADE_BACK's one second.
    // Against a fixed 30 m / 0.5 s floor, so shrinking FADE can't pass by moving the bar.
    const maxStep = Math.max(...tr.lanes.map((l) => (l.speed * dt) / 30), dt / 0.5);
    let fading = 0;
    for (let k = 0; k < tr.count; k++) {
      let prev = tr.visibility(k, 0);
      for (let t = dt; t < 90; t += dt) {
        const v = tr.visibility(k, t);
        expect(Math.abs(v - prev)).toBeLessThanOrEqual(maxStep);
        if (v > 0 && v < 1) fading++;
        prev = v;
      }
    }
    expect(fading).toBeGreaterThan(0);
    // A wreck vanishes at once (the renderer tumbles a copy) and fades back in.
    const w = [...Array(tr.count).keys()].find((j) => tr.visibility(j, 32.5) === 1 && tr.visibility(j, 33.5) === 1)!;
    tr.wreckedAt[w] = 20;
    expect(tr.visibility(w, 25)).toBe(0);
    expect(tr.visibility(w, 32.5)).toBeGreaterThan(0);
    expect(tr.visibility(w, 32.5)).toBeLessThan(1);
    expect(tr.visibility(w, 33.5)).toBe(1);
    tr.wreckedAt[w] = -1;
    tr.update(60, new Float64Array([100, 1500]), new Float64Array([1e6, 1e6]), new Float64Array([1e6, 1e6]), 2);
    for (let p = 0; p < tr.posed; p++) expect(tr.visibility(tr.idx[p], 60)).toBe(1);
  });
  test('a car near in a straight line is posed even when far by road', () => {
    const tr = new Traffic(track, 1);
    const k = [...Array(tr.count).keys()].find((j) => tr.present(j, 60))!;
    const at = tr.poseAt(k, 60, newTrafficPose());
    // The racer stands next to it but reports a main distance half a lap away.
    tr.update(60, new Float64Array([(at.s + track.main.length / 2) % track.main.length]), new Float64Array([at.x + 30]), new Float64Array([at.z]), 1);
    expect(Array.from(tr.idx.subarray(0, tr.posed))).toContain(k);
  });
  test('poseAt matches the pooled pose, and leaves the pool alone', () => {
    const tr = new Traffic(track, 1);
    tr.update(60, new Float64Array([100]), new Float64Array([1e6]), new Float64Array([1e6]), 1);
    expect(tr.posed).toBeGreaterThan(0);
    const before = Array.from(tr.x.subarray(0, tr.posed));
    const pose = newTrafficPose();
    for (let p = 0; p < tr.posed; p++) {
      tr.poseAt(tr.idx[p], 60, pose);
      expect(pose.x).toBeCloseTo(tr.x[p], 9);
      expect(pose.z).toBeCloseTo(tr.z[p], 9);
      expect(pose.h).toBeCloseTo(tr.h[p], 9);
      // Between ticks it's just a little further along.
      tr.poseAt(tr.idx[p], 60 + 1 / 120, pose);
      expect(Math.hypot(pose.x - tr.x[p], pose.z - tr.z[p])).toBeLessThan(0.3);
    }
    expect(Array.from(tr.x.subarray(0, tr.posed))).toEqual(before);
  });
  test('LOD poses only cars near a racer', () => {
    const tr = new Traffic(track, 1);
    // A racer far away in a straight line: only the along-the-road test counts.
    tr.update(60, new Float64Array([100]), new Float64Array([1e6]), new Float64Array([1e6]), 1);
    const L = track.main.length;
    for (let p = 0; p < tr.posed; p++) {
      const d = Math.abs(((tr.s[p] - 100 + L * 1.5) % L) - L / 2);
      expect(d).toBeLessThan(351);
    }
  });
});

describe('weather', () => {
  test('random weather is seeded, and rain lowers grip and turns puddles on', () => {
    expect(planWeather('random', 5)).toEqual(planWeather('random', 5));
    const rain = weatherAt(planWeather('rain', 1), 10, { wetness: 0, grip: 1, wet: false, visibility: 1 });
    expect(rain.wet).toBe(true);
    expect(rain.grip).toBeLessThan(0.9);
    expect(weatherAt(planWeather('clear', 1), 10, { wetness: 0, grip: 1, wet: false, visibility: 1 }).wet).toBe(false);
    // A map without rain never rains.
    expect(planWeather('rain', 1, ['clear']).to).toBe(0);
  });
});

describe('hazards', () => {
  test('a log truck sheds logs that roll to a stop, the same way every time', () => {
    const tr = new Traffic(track, 3);
    const hz = new Hazards(track, tr, 3, 'chaos');
    const logs = hz.occurrences.filter((o) => hz.defs[o.def].use === 'log-truck');
    expect(logs.length).toBeGreaterThan(5);
    // Find an occurrence that has a truck, and check its logs settle.
    const q = new (class {
      push() {}
    })() as never;
    let found = false;
    for (const o of logs) {
      hz.update(o.t0 + 1, q, 0);
      if (!hz.pieces) continue;
      found = true;
      hz.update(o.t0 + 10, q, 0);
      const a = Array.from(hz.px.subarray(0, hz.pieces));
      hz.update(o.t0 + 12, q, 0);
      const b = Array.from(hz.px.subarray(0, hz.pieces));
      a.forEach((x, k) => expect(Math.abs(x - b[k])).toBeLessThan(0.05));
      break;
    }
    expect(found).toBe(true);
  });
  test('restoring mid-telegraph does not fire that telegraph again', () => {
    const tr = new Traffic(track, 3);
    const fired = (hz: Hazards, t: number) => {
      const ids: number[] = [];
      hz.update(t, { push: (_tick: number, type: number, _car: number, _x: number, _y: number, _z: number, a: number) => type === Ev.Hazard && ids.push(a) } as never, 0);
      return ids;
    };
    const make = () => new Hazards(track, tr, 3, 'chaos');
    const probe = make();
    const o = probe.occurrences[0];
    const start = o.t0 - (probe as unknown as { kinds: { telegraph: number }[] }).kinds[o.def].telegraph;
    // Playing through, the telegraph fires as its window opens...
    const live = make();
    fired(live, start - 0.01);
    expect(fired(live, start + 0.01)).toContain(o.id);
    // ...but restoring a snapshot taken inside the window doesn't fire it a second time.
    const restored = make();
    restored.restoreTriggered([], start + 0.1);
    expect(fired(restored, start + 0.1 + 1 / 60)).not.toContain(o.id);
  });
  test('the falling sign fires when a car drives under it, and drops behind them', () => {
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0 });
    const i = sim.addCar({ cls: 'muscle', human: true });
    const sign = DOWNTOWN.hazards!.find((h) => h.use === 'falling-sign')!;
    sim.placeCar(i, 0, (sign.s as number) - 60, -3, 40);
    const c = neutralControls();
    c.throttle = 1;
    let fired = -1;
    let cursor = 0;
    for (let t = 0; t < 120; t++) {
      sim.step([c]);
      cursor = sim.events.read(cursor, (e) => {
        if (e.type === Ev.Hazard && e.car === i) fired = t;
      });
    }
    expect(fired).toBeGreaterThan(0);
    // Solid once it's down (lead + telegraph + the fall, about a second after the trigger).
    for (let t = 0; t < 70; t++) sim.step([c]);
    const hz = sim.world.hazards;
    expect(Array.from(hz.pSolid.subarray(0, hz.pieces))).toContain(1);
    // Re-armed only after its cool-down.
    expect(hz.crossTriggers(i, (sign.s as number) - 1, (sign.s as number) + 1, sim.time, sim.events, sim.tick)).toBe(false);
  });
});

describe('race', () => {
  test('countdown: a well-timed throttle gets a start boost, flooring it early stalls', () => {
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
    const good = sim.addCar({ cls: 'coupe', human: true });
    const early = sim.addCar({ cls: 'coupe', human: true });
    sim.startRace(3, 3);
    const g = neutralControls();
    const e = neutralControls();
    e.throttle = 1;
    const boosts: [number, number][] = [];
    let cursor = 0;
    for (let t = 0; t < 60 * 3.2; t++) {
      g.throttle = sim.race.goTime - sim.time < 0.3 ? 1 : 0;
      sim.step([g, e]);
      cursor = sim.events.read(cursor, (ev) => {
        if (ev.type === Ev.StartBoost) boosts.push([ev.car, ev.b]);
      });
    }
    expect(sim.race.phase).toBe('racing');
    expect(boosts).toContainEqual([good, 1]);
    expect(boosts).toContainEqual([early, 0]);
  });
  test('cars finish in order and the race records places', () => {
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 2, traffic: 0, mayhem: 'off', slowmo: 'wreck' });
    for (let k = 0; k < 3; k++) sim.addCar({ cls: 'coupe', racer: { difficulty: (2 - k) as 0 | 1 | 2 } });
    sim.startRace(1, 0.5);
    const finishes: number[] = [];
    let cursor = 0;
    for (let t = 0; t < 60 * 200 && finishes.length < 3; t++) {
      sim.step([]);
      cursor = sim.events.read(cursor, (e) => {
        if (e.type === Ev.Finish) finishes.push(e.car);
      });
    }
    expect(finishes).toHaveLength(3);
    expect(finishes.map((i) => sim.cars.place[i])).toEqual([1, 2, 3]);
    expect(sim.cars.finishTime[finishes[0]]).toBeGreaterThan(50);
  });
});

describe('replay', () => {
  test('a race with traffic, hazards, weather and AI replays exactly from a mid-race snapshot', () => {
    const opts = { seed: 99, weather: 'random' as const, mayhem: 'chaos' as const, traffic: 1 };
    const make = () => {
      const s = new Sim(track, CLASSES, SURFACES, opts);
      s.addCar({ cls: 'hatch', human: true });
      for (let k = 0; k < 5; k++) s.addCar({ cls: CLASSES[k % 4].id, racer: { difficulty: (k % 3) as 0 | 1 | 2 } });
      s.startRace(3, 1);
      return s;
    };
    const drive = (s: Sim, from: number, to: number) => {
      const c = neutralControls();
      for (let t = from; t < to; t++) {
        c.throttle = 1;
        c.steer = Math.sin(t / 55) * 0.6;
        c.drift = t % 400 > 330;
        c.boost = t % 600 > 520;
        s.step([c]);
      }
    };
    // Hazard telegraphs from the snapshot on: already-running ones mustn't fire again on restore.
    const hazards = (s: Sim, run: () => void) => {
      const seen: number[] = [];
      const cursor = s.events.head;
      run();
      s.events.read(cursor, (e) => {
        if (e.type === Ev.Hazard) seen.push(e.a);
      });
      return seen;
    };
    const a = make();
    drive(a, 0, 60 * 40);
    const snap = JSON.parse(JSON.stringify(a.snapshot()));
    const firedA = hazards(a, () => drive(a, 60 * 40, 60 * 70));
    const b = make();
    b.restore(snap);
    const firedB = hazards(b, () => drive(b, 60 * 40, 60 * 70));
    expect(firedB).toEqual(firedA);
    for (let i = 0; i < 6; i++) {
      expect(b.cars.x[i]).toBe(a.cars.x[i]);
      expect(b.cars.z[i]).toBe(a.cars.z[i]);
    }
    expect(Array.from(b.world.traffic.wreckedAt)).toEqual(Array.from(a.world.traffic.wreckedAt));
  });
});
