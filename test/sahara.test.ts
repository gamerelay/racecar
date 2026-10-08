// Sahara (docs/SAHARA.md): the pyramids are ground you drive up, stone to drive on, and the Pyramid
// Run goes over the Great Pyramid's top, open either side; the river, its ford and its bridge; Giza
// dressed, its avenue's market; its life, a camel caravan and dust devils.

import { describe, expect, test } from 'bun:test';
import { bakeTrack } from '../src/core/track/bake';
import { pyramidHeight } from '../src/core/track/features/pyramid';
import { KIND_STONE, KIND_WATER, riverAt } from '../src/core/track/ground';
import { newHit, projectGlobal, sampleAt, surfaceAt } from '../src/core/track/query';
import { SMASH_IDS, Smashables } from '../src/core/world/smash';
import { TRAFFIC_KINDS, Traffic, newTrafficPose } from '../src/core/world/traffic';
import { Sim } from '../src/core/sim';
import { planWeather, weatherAt } from '../src/core/world/weather';
import { paletteFor, type MapDef, type PyramidDef, type RiverDef } from '../src/core/content';
import { readFileSync } from 'node:fs';
import { Ev } from '../src/core/events';
import { neutralControls } from '../src/core/controls';
import { wrap } from '../src/core/track/bake';
import { wrapAngle } from '../src/core/math';
import { CLASSES, SURFACES, layout } from './helpers';

describe('Sahara', () => {
  const sahara = layout('sahara/dunes');
  const track = bakeTrack(sahara, SURFACES);
  const g = track.ground!;
  const pyramids = sahara.ground!.features!.filter((f): f is PyramidDef => f.kind === 'pyramid');

  test('a pyramid rises in flat faces from its foot to its top, square to its heading', () => {
    const p: PyramidDef = { kind: 'pyramid', at: [0, 0], half: 40, top: 4, h: 18, y: 0, rot: 0.3 };
    const h = pyramidHeight(p);
    expect(h(0, 0)).toBe(18);
    // Halfway up a face, along its heading or across it, the same height: a square, turned.
    const [fx, fz] = [Math.sin(0.3), Math.cos(0.3)];
    expect(h(fx * 22, fz * 22)).toBeCloseTo(9, 6);
    expect(h(fz * 22, -fx * 22)).toBeCloseTo(9, 6);
    // Off its foot, nothing (a corner reaches farther than a face).
    expect(h(fx * 41, fz * 41)).toBe(0);
    expect(h((fx + fz) * 39, (fz - fx) * 39)).toBeGreaterThan(0);
  });

  test('the pyramids stand on the ground, stone, driven as sandstone', () => {
    expect(pyramids.length).toBe(7);
    const hit = newHit();
    for (const p of pyramids) {
      // Halfway up a face across its heading (the Pyramid Run goes along the Great Pyramid's).
      const [x, z] = [p.at[0] + Math.cos(p.rot) * p.half * 0.5, p.at[1] - Math.sin(p.rot) * p.half * 0.5];
      expect(g.height(x, z)).toBeCloseTo(p.y + p.h * ((p.half * 0.5) / (p.half - p.top)), 0);
      expect(g.kindAt(x, z)).toBe(KIND_STONE);
      projectGlobal(track.main, x, z, hit);
      expect(SURFACES[surfaceAt(track, hit, x, g.height(x, z), z, false, track.surfaceIndex.get('sand')!)].id).toBe('sandstone');
    }
  });

  test('the Pyramid Run goes over the Great Pyramid, its top the highest point on it', () => {
    const run = track.splines.find((s) => s.id === 'pyramid-run')!;
    const great = pyramids[0];
    let top = 0;
    for (let i = 1; i < run.n; i++) if (run.py[i] > run.py[top]) top = i;
    expect(Math.hypot(run.px[top] - great.at[0], run.pz[top] - great.at[1])).toBeLessThan(great.top + 2);
    expect(run.py[top]).toBeGreaterThan(great.y + great.h - 1);
  });
});

describe("Sahara's river", () => {
  const sahara = layout('sahara/dunes');
  const track = bakeTrack(sahara, SURFACES);
  const g = track.ground!;
  const river = sahara.ground!.features!.find((f): f is RiverDef => f.kind === 'river')!;
  const at = riverAt(river, 60);
  const w = { level: 0 };
  const hit = newHit();
  const surface = (x: number, y: number, z: number) => (projectGlobal(track.main, x, z, hit, y), SURFACES[surfaceAt(track, hit, x, y, z, false, track.surfaceIndex.get('sand')!)].id);

  test('it falls along its course, in a channel under its water, wading', () => {
    expect(river.level[0]).toBeGreaterThan(river.level[1]);
    // Midway, away from the roads: its floor under the water, its banks over it, and wading (not a wreck).
    const [x, z] = river.path[Math.floor(river.path.length * 0.45)];
    at(x, z, w);
    expect(g.height(x, z)).toBeCloseTo(w.level - river.depth, 1);
    expect(g.kindAt(x, z)).toBe(KIND_WATER);
    expect(surface(x, g.height(x, z), z)).toBe('river');
    expect(g.hazard(x, g.height(x, z) + 0.5, z, 10)).toBe('none');
  });

  test('the ford: the road dips under the water, and drives as a ford', () => {
    const zone = sahara.zones!.find((z) => z.surface === 'ford')!;
    const s = (zone.s[0] + zone.s[1]) / 2;
    sampleAt(track.main, s, hit);
    const [x, y, z] = [hit.cx, hit.cy, hit.cz];
    at(x, z, w);
    expect(y).toBeLessThan(w.level);
    expect(y).toBeGreaterThan(w.level - 0.6);
    expect(surface(x, y, z)).toBe('ford');
  });

  test("the bridge: a deck over the water, the ground under it down at the river's floor", () => {
    const piece = sahara.pieces!.find((p) => p.id === 'wadi-bridge')!;
    sampleAt(track.main, (piece.s[0] + piece.s[1]) / 2, hit);
    const [x, y, z] = [hit.cx, hit.cy, hit.cz];
    at(x, z, w);
    expect(y).toBeGreaterThan(w.level + 2);
    expect(g.height(x, z)).toBeLessThan(w.level);
    expect(g.pieceFloor(x, z, 1, y + 0.5)).toBeCloseTo(y, 1);
  });
});

describe('Giza dressed', () => {
  const sahara = layout('sahara/dunes');
  const track = bakeTrack(sahara, SURFACES);

  test('the Sphinx and the obelisks stand solid, off the road, and the palms keep off every road', () => {
    expect(sahara.landmarks!.map((m) => m.kind).sort()).toEqual(['obelisk', 'obelisk', 'obelisk', 'obelisk', 'sphinx']);
    for (const m of sahara.landmarks!) expect(sahara.houses!.some((h) => h.at[0] === m.at[0] && h.at[1] === m.at[1] && h.look === 'landmark')).toBe(true);
    const palms = sahara.ground!.pines!.plant!;
    expect(palms.length).toBeGreaterThan(150);
    const hit = newHit();
    for (const [x, z] of palms)
      for (const sp of track.splines) {
        projectGlobal(sp, x, z, hit);
        expect(Math.abs(hit.lateral) > hit.width / 2 + hit.shoulder || Math.hypot(hit.cx - x, hit.cz - z) > hit.width / 2 + hit.shoulder).toBe(true);
      }
  });

  test('no road has walls: the Pyramid Run is open either side, as the main road is', () => {
    for (const sp of track.splines) expect([sp.id, sp.wallL.some((w) => w > 0) || sp.wallR.some((w) => w > 0)]).toEqual([sp.id, false]);
  });

  test("the Sphinx avenue: a market either side, and its road clear", () => {
    expect(track.props.filter((p) => p.solid && p.spline === 0)).toEqual([]);
    const hit = newHit();
    // The market: stalls and pots on both verges, off the road itself.
    const sm = new Smashables(track);
    for (const id of ['market-stall', 'clay-pots']) {
      const mine = Array.from({ length: sm.n }, (_, k) => k).filter((k) => SMASH_IDS[sm.kind[k]] === id);
      expect(mine.length).toBeGreaterThan(8);
      const sides = new Set<number>();
      for (const k of mine) {
        sampleAt(track.main, sm.s[k], hit);
        const lat = (sm.x[k] - hit.cx) * -hit.tz + (sm.z[k] - hit.cz) * hit.tx;
        expect(Math.abs(lat)).toBeGreaterThan(hit.width / 2);
        sides.add(Math.sign(lat));
      }
      expect(sides.size).toBe(2);
    }
  });
});

describe("Sahara's life: the caravan and the dust devils", () => {
  const sahara = layout('sahara/dunes');
  const track = bakeTrack(sahara, SURFACES);

  test('the caravan: camels only, in strings of five nose to tail, on the Caravan Road', () => {
    const tr = new Traffic(track, 7, 1);
    expect(tr.count).toBeGreaterThan(0);
    expect(new Set(Array.from(tr.kind, (k) => TRAFFIC_KINDS[k].id))).toEqual(new Set(['camel']));
    const s = Array.from({ length: tr.count }, (_, k) => tr.sAt(k, 0));
    // Each string's camels 3.6 m apart; a string's last and the next one's head much further.
    for (let k = 0; k + 1 < 5; k++) expect(Math.abs(wrap(s[k] - s[k + 1] + 50, track.main.length) - 50)).toBeCloseTo(3.6, 3);
    expect(Math.abs(wrap(s[4] - s[5] + 2000, track.main.length) - 2000)).toBeGreaterThan(50);
  });

  test('a camel hit scatters: the camel gone for a while, the car a little slower, nobody wrecked', () => {
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 7, traffic: 1, mayhem: 'off' });
    const c = sim.addCar({ cls: 'coupe', human: true });
    sim.time = 20;
    const tr = sim.world.traffic;
    const k = Array.from({ length: tr.count }, (_, k) => k).find((k) => tr.visibility(k, 20) === 1)!;
    expect(k).toBeDefined();
    // 15 m short of it, in its lane, at 100 km/h.
    const s = tr.sAt(k, 20);
    const at = sampleAt(track.main, s, newHit());
    const lat = (tr.poseAt(k, 20, newTrafficPose()).x - at.cx) * -at.tz + (tr.poseAt(k, 20, newTrafficPose()).z - at.cz) * at.tx;
    sim.placeCar(c, 0, s - 15, lat, 100 / 3.6);
    let scattered = false;
    let wrecked = false;
    let cursor = sim.events.head;
    let before = 0;
    for (let n = 0; n < 60 && !scattered; n++) {
      before = Math.hypot(sim.cars.vx[c], sim.cars.vz[c]);
      sim.step([{ ...neutralControls(), throttle: 1 }]);
      cursor = sim.events.read(cursor, (e) => {
        if (e.type === Ev.TrafficWreck && TRAFFIC_KINDS[tr.kind[e.other]].animal) scattered = true;
        if (e.type === Ev.Wreck) wrecked = true;
      });
    }
    expect(scattered).toBe(true);
    expect(wrecked).toBe(false);
    expect(sim.cars.wreck[c]).toBe(0);
    const after = Math.hypot(sim.cars.vx[c], sim.cars.vz[c]);
    expect(after).toBeLessThan(before * 0.9);
    expect(after).toBeGreaterThan(before * 0.7);
  });

  test('a dust devil crosses the Dune Sea and throws a car: off its line, spun and hopped, never wrecked', () => {
    const run = (mayhem: 'normal' | 'off') => {
      const sim = new Sim(track, CLASSES, SURFACES, { seed: 7, traffic: 0, mayhem });
      const c = sim.addCar({ cls: 'coupe', human: true });
      // The first devil, 3 s after it's up (over the road then): the car driven into it at 80 km/h
      // from 25 m back, along the road (placed on its spot, open ground there would throw it up).
      const h = new Sim(track, CLASSES, SURFACES, { seed: 7, traffic: 0, mayhem: 'normal' }).world.hazards;
      const o = h.occurrences.find((o) => h.kindOf(o).id === 'dust-devil')!;
      h.update(o.t0 + 3, sim.events, 0);
      const p = Array.from({ length: h.pieces }, (_, p) => p).find((p) => h.pOcc[p] === o.id)!;
      const near = newHit();
      projectGlobal(track.main, h.px[p], h.pz[p], near);
      sim.time = o.t0 + 3 - 1.1;
      sim.placeCar(c, 0, near.s - 25, near.lateral, 80 / 3.6);
      let wrecked = false;
      let air = 0;
      let cursor = sim.events.head;
      for (let n = 0; n < 120; n++) {
        sim.step([neutralControls()]);
        if (n > 5 && !sim.cars.grounded[c]) air++;
        cursor = sim.events.read(cursor, (e) => void (e.type === Ev.Wreck && (wrecked = true)));
      }
      return { x: sim.cars.x[c], z: sim.cars.z[c], h: sim.cars.h[c], air, wrecked };
    };
    const calm = run('off');
    const devil = run('normal');
    expect(devil.wrecked).toBe(false);
    // Thrown: well off its line, spun round, and off the ground for a moment.
    expect(Math.hypot(devil.x - calm.x, devil.z - calm.z)).toBeGreaterThan(1.5);
    expect(Math.abs(wrapAngle(devil.h - calm.h))).toBeGreaterThan(0.15);
    expect(calm.air).toBe(0);
    expect(devil.air).toBeGreaterThan(10);
  });
});

describe("Sahara's skies: sandstorms and sunsets", () => {
  const map = JSON.parse(readFileSync(`${import.meta.dir}/../content/maps/sahara/map.json`, 'utf8')) as MapDef;
  const state = () => ({ wetness: 0, grip: 1, wet: false, visibility: 1 });

  test('a sandstorm blows in about one race in three, and blows over again', () => {
    const plans = Array.from({ length: 600 }, (_, seed) => planWeather('random', seed + 1, map.weather));
    const storms = plans.filter((p) => p.to > 0);
    expect(storms.length / plans.length).toBeGreaterThan(0.25);
    expect(storms.length / plans.length).toBeLessThan(0.45);
    for (const p of storms) {
      expect(p.sand).toBe(true);
      expect(p.t0).toBeGreaterThan(30);
      expect(weatherAt(p, p.t3! + 1, state()).wetness).toBe(0);
    }
  });

  test('in a sandstorm nothing is wet, the air thickens and grip drops a touch', () => {
    const at = weatherAt(planWeather('rain', 1, map.weather), 10, state());
    expect(at.wetness).toBe(1);
    expect(at.wet).toBe(false);
    expect(at.grip).toBeCloseTo(0.94);
    expect(at.visibility).toBeLessThan(0.4);
  });

  test('it has a sunset', () => {
    expect(paletteFor(map, 'sunset', 1)).toBe('sahara-sunset');
    expect(paletteFor(map, 'day', 1)).toBe('sahara');
  });
});
