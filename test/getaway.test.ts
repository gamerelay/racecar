// The getaway (docs/CHASE_MODE.md, step 1): the test city's streets are the cops' way round it, the
// heat goes up every minute, cops are called out of your sight, and your first wreck (or being
// stopped with a cop on you) is the end of it: no respawn, no laps.

import { describe, expect, test } from 'bun:test';
import { copPace } from '../src/core/ai/cop';
import { Cause, Ev } from '../src/core/events';
import { wreckCar } from '../src/core/car/physics';
import { BUSTED, COP_POOL, Getaway, HEAT_EVERY } from '../src/core/rules/getaway';
import { Sim } from '../src/core/sim';
import { bakeTrack } from '../src/core/track/bake';
import { Streets } from '../src/core/world/streets';
import { cityHeight, inLoop, insideLoop } from '../src/core/track/features/city';
import { KIND_OASIS, KIND_PAVED } from '../src/core/track/ground';
import { curve, loopDist, loopDistance } from '../src/core/track/island';
import { Rng } from '../src/core/rng';
import type { CityDef } from '../src/core/content';
import { CLASSES, SURFACES, layout } from './helpers';

const city = layout('heist/city');

/** A getaway on the test city: your car (index 0, steered by `drive` if given) and its cops, the lights already green. */
function getaway(seed = 1): { sim: Sim; g: Getaway } {
  const sim = new Sim(bakeTrack(city, SURFACES), CLASSES, SURFACES, { seed, traffic: 0, mayhem: 'off', weather: 'clear' });
  sim.addCar({ cls: 'coupe', human: true });
  const g = new Getaway(sim, 0);
  sim.startRace(3, 0.05);
  // On to the green light, and the first tick of the run.
  while (g.heat === 0) sim.step([]);
  return { sim, g };
}

describe('the getaway', () => {
  test('every street the cops are given is one a car fits down, and they join the city up', () => {
    const def = city.getaway!;
    const st = new Streets(def, city.houses!);
    for (const [a, b] of def.links) expect(st.clear(st.x(a), st.z(a), st.x(b), st.z(b))).toBe(true);
    // From the first crossing to every other: one city, no island of streets.
    const path = new Int32Array(256);
    for (let k = 1; k < st.n; k++) expect(st.path(0, k, path)).toBeGreaterThan(0);
  });

  test("a building blocks the line of sight; the street beside it doesn't", () => {
    const st = new Streets({ nodes: [], links: [] }, [{ at: [0, 0], size: [20, 10, 12], rot: 0 }]);
    expect(st.clear(-30, 0, 30, 0)).toBe(false);
    expect(st.clear(-30, 12, 30, 12)).toBe(true);
    // Turned a quarter, it's 10 across x and 20 along z.
    const turned = new Streets({ nodes: [], links: [] }, [{ at: [0, 0], size: [20, 10, 12], rot: Math.PI / 2 }]);
    expect(turned.clear(-30, 8, 30, 8)).toBe(false);
    expect(turned.clear(-30, 12, 30, 12)).toBe(true);
    expect(turned.clear(8, -30, 8, 30)).toBe(true);
  });

  test('the cops start out of the race, two come out on green, and one more each heat', () => {
    const { sim, g } = getaway();
    const c = sim.cars;
    expect(g.cops.length).toBe(COP_POOL);
    expect(g.cops.slice(2).every((i) => !c.active[i])).toBe(true);
    const out = () => g.cops.filter((i) => c.active[i]).length;
    expect(g.heat).toBe(1);
    expect(out()).toBe(2);
    // Your car held still where it is (the cops come, but not up to you: the test's about the heat).
    const heats: number[] = [];
    let cur = 0;
    for (let k = 0; k < 60 * (HEAT_EVERY + 10) && !g.end; k++) {
      sim.step([]);
      cur = sim.events.read(cur, (e) => void (e.type === Ev.Heat && heats.push(e.a)));
    }
    if (!g.end) {
      expect(heats).toEqual([2]);
      expect(out()).toBe(3);
    }
  });

  test('a cop is quicker each heat, past your car at heat 4', () => {
    const top = 64;
    for (let h = 1; h < 10; h++) expect(copPace(h + 1, top)).toBeGreaterThan(copPace(h, top));
    expect(copPace(1, top)).toBeLessThan(top);
    expect(copPace(4, top)).toBeGreaterThan(top);
  });

  test('your first wreck is the end of it: it stays a wreck, the clock stops, and laps never finish it', () => {
    const { sim, g } = getaway();
    const c = sim.cars;
    for (let k = 0; k < 60; k++) sim.step([]);
    wreckCar(sim, 0, Cause.Wall, 0, 0, -1);
    let over = -1;
    let cur = 0;
    for (let k = 0; k < 60 * 5; k++) {
      sim.step([]);
      cur = sim.events.read(cur, (e) => void (e.type === Ev.Busted && (over = e.b)));
    }
    expect(g.end).toBe('wrecked');
    expect(over).toBe(0);
    expect(c.finished[0]).toBe(1);
    // Well past the wreck's respawn time, still a wreck.
    expect(c.wreck[0]).toBe(1);
    expect(c.finishTime[0]).toBeCloseTo(g.time, 6);
    expect(g.time).toBeLessThan(1.5);
  });

  test('stopped with a cop on you for long enough, busted', () => {
    const { sim, g } = getaway();
    const c = sim.cars;
    // A cop pulled up beside you, both stopped (it's told to stay put: it's pulled up as if the run were over).
    const cop = g.cops[0];
    c.x[cop] = c.x[0] + 4;
    c.z[cop] = c.z[0];
    c.vx[cop] = c.vz[cop] = 0;
    sim.cops[cop]!.stop = true;
    sim.cops[g.cops[1]]!.stop = true;
    for (let k = 0; k < 60 * (BUSTED + 0.5) && !g.end; k++) sim.step([]);
    expect(g.end).toBe('busted');
    expect(g.time).toBeGreaterThan(BUSTED - 0.1);
  });

  test("a city's crossing is nearly level on its hill, the street's grade easing back off it (a rounded crest, no step)", () => {
    const c: CityDef = { kind: 'city', outline: [], y: 2, hills: [{ x: 0, z: 0, h: 30, r: 200 }], level: [[100, 0, 6]] };
    const h = cityHeight(c);
    const raw = cityHeight({ ...c, level: [] });
    const grade = (f: (x: number, z: number) => number, x: number) => Math.abs(f(x + 0.5, 0) - f(x - 0.5, 0));
    // On it, most of the slope gone (about 30% of the hill's left).
    expect(grade(h, 100)).toBeLessThan(grade(raw, 100) * 0.35);
    // Well off it, the hill's own.
    expect(h(60, 0)).toBeCloseTo(raw(60, 0), 6);
    expect(h(0, 0)).toBeCloseTo(32, 6);
    // And no step or cliff on the way: nowhere steeper than twice the hill.
    for (let x = 60; x <= 140; x += 0.5) expect(grade(h, x)).toBeLessThan(2 * Math.max(grade(raw, x), 0.05));
  });

  test('two crossings close together blend: no seam between them', () => {
    const c: CityDef = { kind: 'city', outline: [], y: 0, hills: [{ x: 0, z: 0, h: 30, r: 200 }], level: [[100, 0, 6], [124, 0, 6]] };
    const h = cityHeight(c);
    let worst = 0;
    for (let x = 90; x <= 135; x += 0.25) worst = Math.max(worst, Math.abs(h(x + 0.25, 0) - h(x, 0)) / 0.25);
    expect(worst).toBeLessThan(0.6);
  });

  test("the banded outline test agrees with the plain one", () => {
    const outline = city.ground!.features!.find((f): f is CityDef => f.kind === 'city')!.outline;
    const fast = inLoop(outline);
    const rng = new Rng(11);
    for (let k = 0; k < 4000; k++) {
      const x = rng.range(-800, 800);
      const z = rng.range(-700, 700);
      expect(fast(x, z)).toBe(insideLoop(outline, x, z));
    }
  });

  test('the parks are lawn, the streets round it paving; the bay is under the sea', () => {
    const ground = bakeTrack(city, SURFACES).ground!;
    const park = (city.ground!.features!.find((f) => f.kind === 'city') as CityDef).parks!;
    // (Dolores Park's two blocks, Pioneer Park round Coit Tower; and the Presidio's lawns, past Van Ness.)
    expect(park.length).toBe(4);
    for (const loop of park.slice(0, 3)) {
      const x = loop.reduce((a, p) => a + p[0], 0) / loop.length;
      const z = loop.reduce((a, p) => a + p[1], 0) / loop.length;
      expect(ground.kindAt(x, z)).toBe(KIND_OASIS);
    }
    expect(ground.kindAt(-590, 30)).toBe(KIND_OASIS);
    // The start's street is paving; off the Embarcadero past the sea wall, deep water.
    const [sx, sz] = city.getaway!.start!.at;
    expect(ground.kindAt(sx, sz)).toBe(KIND_PAVED);
    expect(ground.height(660, -250)).toBeLessThan(city.ground!.sea! - 5);
  });

  test('past Van Ness, the Presidio: open to its lawns, a drive winding through them in sweepers, hedged in', () => {
    const track = bakeTrack(city, SURFACES);
    const main = track.main;
    const drive = track.splines.find((sp) => sp.id === 'presidio-drive')!;
    expect(drive).toBeDefined();
    // Van Ness's west side (its left: the road runs north) has no wall beside the lawns; the bay's side north of them does.
    const at = (z: number) => {
      let best = 0;
      for (let i = 0; i < main.n; i++) if (Math.hypot(main.px[i] + 560, main.pz[i] - z) < Math.hypot(main.px[best] + 560, main.pz[best] - z)) best = i;
      return best;
    };
    for (const z of [300, 0, -300]) expect(main.wallL[at(z)]).toBe(0);
    expect(main.wallL[at(-440)]).toBe(1);
    // Its corners sweep (no tighter than 35 m, but at its mouths) and it turns a lot: back and forth across the park.
    const k = Math.round(10 / drive.step);
    let turned = 0;
    for (let i = k; i < drive.n - k; i += 2 * k) {
      let d = Math.atan2(drive.tx[i + k], drive.tz[i + k]) - Math.atan2(drive.tx[i - k], drive.tz[i - k]);
      d = Math.atan2(Math.sin(d), Math.cos(d));
      turned += Math.abs(d);
      if (i * drive.step > 60 && i * drive.step < drive.length - 60) expect((2 * k * drive.step) / Math.abs(d || 1e-9)).toBeGreaterThan(35);
    }
    expect(turned).toBeGreaterThan(5 * Math.PI);
    // Hedged in to the west and south: a solid house along each.
    const hedges = city.houses!.filter((h) => h.look === 'hedge');
    expect(hedges.length).toBe(2);
    expect(Math.max(...hedges.map((h) => Math.max(h.size[0], h.size[1])))).toBeGreaterThan(800);
  });

  test("Broadway: wider, its clubs fronting it, every one lit; Chinatown's Dragon Gate on Grant Avenue's pavements", () => {
    const clubs = city.houses!.filter((h) => h.look === 'broadway');
    expect(clubs.length).toBeGreaterThan(20);
    for (const h of clubs) {
      expect(h.label).toBeDefined();
      // Its front (local +z) toward Broadway's line, z -230.
      expect(Math.cos(h.rot) * Math.sign(-230 - h.at[1])).toBeGreaterThan(0.99);
    }
    const paint = city.getaway!.paint!;
    expect(Math.max(...paint)).toBe(22);
    const gate = city.landmarks!.find((m) => m.kind === 'chinatown-gate')!;
    expect(gate).toBeDefined();
    // Its posts (solid) either side of the street, on the pavements: none out in the street.
    const posts = city.houses!.filter((h) => h.look === 'landmark' && Math.abs(h.at[1] - gate.at[1]) < 0.5);
    expect(posts.length).toBe(2);
    for (const p of posts) expect(Math.abs(p.at[0] - gate.at[0]) - p.size[0] / 2).toBeGreaterThan(7);
  });

  test("a coast's distance, from its cells' few segments, is the plain scan's, exactly", () => {
    const line = city.ground!.coast!;
    const loop = curve([...line, line[0]], 12);
    const fast = loopDistance(loop);
    const rng = new Rng(5);
    for (let k = 0; k < 3000; k++) {
      // (On the grid, and off it.)
      const x = rng.range(-2200, 2200);
      const z = rng.range(-2200, 2200);
      expect(fast(x, z)).toBe(loopDist(loop as [number, number][], x, z));
    }
  });

  test('cars cruise the streets: on their loops, never in a building, not by the Bank at the start, stopping at crossings', () => {
    // (Traffic on, as a race has it: the helper's getaway runs without.)
    const sim = new Sim(bakeTrack(city, SURFACES), CLASSES, SURFACES, { seed: 4, traffic: 1, mayhem: 'off', weather: 'clear' });
    const tr = sim.world.traffic;
    const loops = tr.lanes.flatMap((l, n) => (l.path ? [n] : []));
    expect(loops.length).toBeGreaterThan(4);
    const cars = Array.from({ length: tr.count }, (_, k) => k).filter((k) => loops.includes(tr.lane[k]));
    expect(cars.length).toBeGreaterThan(15);
    expect(cars.length).toBeLessThan(45);
    const st = new Streets(city.getaway!, city.houses!);
    const start = city.getaway!.start!.at;
    const pose = { s: 0, lat: 0, x: 0, y: 0, z: 0, h: 0, vx: 0, vz: 0 };
    for (let t = 0; t < 240; t += 0.7)
      for (const k of cars) {
        if (!tr.present(k, t)) continue;
        tr.poseAt(k, t, pose);
        // (A point in a building's box: no clear line from it to itself nudged a metre on.)
        expect(st.clear(pose.x, pose.z, pose.x + Math.sin(pose.h), pose.z + Math.cos(pose.h))).toBe(true);
        if (t < 8) expect(Math.hypot(pose.x - start[0], pose.z - start[1])).toBeGreaterThan(100);
      }
    // They stop at crossings: each comes to a standstill now and then, and never goes over its lane's speed.
    for (const k of cars) {
      let stood = false;
      const v = tr.lanes[tr.lane[k]].speed;
      for (let t = 0; t < 120; t += 0.25) {
        tr.poseAt(k, t, pose);
        const speed = Math.hypot(pose.vx, pose.vz);
        stood ||= speed < 0.01;
        expect(speed).toBeLessThanOrEqual(v + 1e-9);
      }
      expect(stood).toBe(true);
    }
  });

  test('the getaway starts outside the Bank, facing its way, the cops behind', () => {
    const { sim, g } = getaway();
    const c = sim.cars;
    const start = city.getaway!.start!;
    expect(Math.hypot(c.x[0] - start.at[0], c.z[0] - start.at[1])).toBeLessThan(1);
    expect(c.h[0]).toBeCloseTo(start.heading, 3);
    const [hx, hz] = [Math.sin(start.heading), Math.cos(start.heading)];
    for (const i of g.cops.slice(0, 2)) {
      expect(c.active[i]).toBe(1);
      expect((c.x[i] - c.x[0]) * hx + (c.z[i] - c.z[0]) * hz).toBeLessThan(0);
    }
  });

  test('stopped, the cops pull up round you (busted), rather than shove you down the street', () => {
    const { sim, g } = getaway(3);
    for (let k = 0; k < 60 * 30 && !g.end; k++) sim.step([]);
    expect(g.end).toBe('busted');
  });

  test('a race on any other map has no getaway', () => {
    const sim = new Sim(bakeTrack(layout('downtown/downtown'), SURFACES), CLASSES, SURFACES, { seed: 1, traffic: 0 });
    sim.addCar({ cls: 'coupe', human: true });
    expect(sim.getaway).toBeNull();
    expect(city.getaway).toBeDefined();
  });
});
