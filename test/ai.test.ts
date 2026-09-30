import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TrackLayout } from '../src/core/content';
import { neutralControls } from '../src/core/controls';
import { Ev } from '../src/core/events';
import { Sim } from '../src/core/sim';
import { bakeTrack, forRange, mainDistance } from '../src/core/track/bake';
import { validateLayout } from '../src/core/track/validate';
import { Traffic } from '../src/core/world/traffic';
import { lapReport } from '../tools/lap-report';
import { CLASSES, DOWNTOWN, SURFACES } from './helpers';

// The AI and the track at their edges: getting unstuck, triggers on the right road, ranges through
// the line, and the validator catching layouts that would silently misbehave.

const layout = (key: string): TrackLayout => {
  const [map, name] = key.split('/');
  return JSON.parse(readFileSync(join(import.meta.dir, '..', 'content', 'maps', map, `${name}.track.json`), 'utf8')) as TrackLayout;
};
const strip: TrackLayout = { id: 'strip', name: 'Strip', main: { points: [0, 1, 2, 3].map((k) => ({ p: [0, 0, k * 300] as [number, number, number], width: 30 })) } };

describe('getting unstuck', () => {
  test('brake held from a standstill reverses (it used to snap back to 0)', () => {
    const sim = new Sim(bakeTrack(strip, SURFACES), CLASSES, SURFACES, { seed: 1 });
    const i = sim.addCar({ cls: 'coupe', human: true });
    sim.placeCar(i, 0, 300, 0, 0);
    const ctl = { ...neutralControls(), brake: 1 };
    for (let t = 0; t < 120; t++) sim.step([ctl]);
    // Heading +z along the strip: reversing is -z.
    expect(sim.cars.vz[i]).toBeLessThan(-3);
  });

  test('Valley races that used to end in AI resets (seeds 2 and 4) have none', () => {
    const valley = layout('countryside/valley');
    for (const seed of [2, 4]) {
      const r = lapReport('countryside/valley', valley, 'coupe', { field: true, seed });
      expect(r.finished).toBe(true);
      expect(r.wrecks.filter((w) => w.cause === 'reset')).toEqual([]);
    }
  });
});

describe('triggers', () => {
  // The Valley's falling sign is at 212 m on the main road, inside the Barn shortcut's span.
  const valley = layout('countryside/valley');
  const sign = valley.hazards!.findIndex((h) => h.use === 'falling-sign');
  const signs = (spline: number, s: number) => {
    const sim = new Sim(bakeTrack(valley, SURFACES), CLASSES, SURFACES, { seed: 1, traffic: 0 });
    const i = sim.addCar({ cls: 'coupe', human: true });
    sim.placeCar(i, spline, s, 0, 25);
    let n = 0;
    let cursor = sim.events.head;
    const ctl = { ...neutralControls(), throttle: 0.6 };
    for (let t = 0; t < 90; t++) {
      sim.step([ctl]);
      cursor = sim.events.read(cursor, (e) => {
        if (e.type === Ev.Hazard && e.b === sign) n++;
      });
    }
    return { n, mapped: mainDistance(sim.track, sim.cars.spline[i], sim.cars.s[i]) };
  };
  test('a car on the main road past the sign sets it off', () => {
    expect(sign).toBeGreaterThanOrEqual(0);
    const r = signs(0, 190);
    expect(r.mapped).toBeGreaterThan(212);
    expect(r.n).toBe(1);
  });
  test('a car on the shortcut passing the same mapped distance does not', () => {
    const track = bakeTrack(valley, SURFACES);
    const barn = track.splines.find((sp) => sp.id === 'barn')!;
    // Start where the barn maps to 190 m on the main road.
    const s = ((190 - barn.mainFrom) / (barn.mainTo - barn.mainFrom)) * barn.length;
    const r = signs(barn.index, s);
    expect(r.mapped).toBeGreaterThan(212);
    expect(r.n).toBe(0);
  });
});

describe('track edges', () => {
  test('a range through the line covers both sides of it', () => {
    const track = bakeTrack(DOWNTOWN, SURFACES);
    const main = track.main;
    const L = main.length;
    const seen = new Set<number>();
    forRange(main, L - 20, 20, (i) => seen.add(i));
    for (const s of [L - 20, L - 10, 0, 10, 20]) expect(seen.has(Math.round((s % L) / main.step) % main.n)).toBe(true);
    // About 40 m of samples, not one.
    expect(seen.size).toBeGreaterThan(35 / main.step);
    expect(seen.size).toBeLessThan(46 / main.step);
  });

  test("poseAll (the editor's scrubber) leaves the live pool alone", () => {
    const tr = new Traffic(bakeTrack(DOWNTOWN, SURFACES), 1);
    tr.update(60, new Float64Array([100]), new Float64Array([1e6]), new Float64Array([1e6]), 1);
    const before = [tr.idx[0], tr.x[0], tr.z[0]];
    tr.poseAll(30);
    expect([tr.idx[0], tr.x[0], tr.z[0]]).toEqual(before);
  });

  test('the validator catches hazards and lanes that would silently do nothing', () => {
    const bad: TrackLayout = {
      ...structuredClone(DOWNTOWN),
      hazards: [{ use: 'meteor', s: 100 }, { use: 'falling-sign', s: [100, 200] }, { use: 'log-truck', s: [100, 99999] }],
      traffic: { density: 4, lanes: [{ pos: 3, dir: 1, speed: 15 }, { pos: 0.5, dir: 1, speed: 0 }] },
    };
    const messages = validateLayout(bad, SURFACES, CLASSES)
      .filter((p) => p.level === 'error')
      .map((p) => p.message);
    expect(messages.some((m) => m.includes('unknown kind "meteor"'))).toBe(true);
    expect(messages.some((m) => m.includes('falling-sign is a trigger'))).toBe(true);
    expect(messages.some((m) => m.includes('log-truck') && m.includes('off the main spline'))).toBe(true);
    expect(messages.some((m) => m.includes('pos 3 is off the road'))).toBe(true);
    expect(messages.some((m) => m.includes('speed must be positive'))).toBe(true);
    // And the real layouts are clean.
    for (const key of ['city/downtown', 'countryside/valley']) expect(validateLayout(layout(key), SURFACES, CLASSES).filter((p) => p.level === 'error')).toEqual([]);
  });
});
