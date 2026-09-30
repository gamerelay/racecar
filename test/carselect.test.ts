import { describe, expect, test } from 'bun:test';
import { Group, PerspectiveCamera } from 'three';
import { Sim } from '../src/core/sim';
import { bakeTrack } from '../src/core/track/bake';
import { DRIVE_UP, Showroom, driveUp, frameStage, tableRadius } from '../src/render/showroom';
import type { CarVisual, Skin } from '../src/render/skin';
import { carStats } from '../src/ui/stats';
import { CLASSES, PAINTS, SURFACES, layout } from '../tools/content';

// The car select (PLAN phase 4): the turntable's drive-up and framing, the stat bars, and the
// race behind the lobby moving to another map in place.

describe('the drive-up', () => {
  test('starts back, eases to a stop in the middle of the table, and stays there', () => {
    expect(driveUp(0, 5).back).toBe(5);
    expect(driveUp(DRIVE_UP, 5)).toEqual({ back: 0, speed: 0 });
    expect(driveUp(DRIVE_UP * 3, 5)).toEqual({ back: 0, speed: 0 });
    // Fastest at the start, slowing all the way.
    const speeds = [0, 0.25, 0.5, 0.75].map((u) => driveUp(u * DRIVE_UP, 5).speed);
    for (let k = 1; k < speeds.length; k++) expect(speeds[k]).toBeLessThan(speeds[k - 1]);
  });
});

describe('framing the table', () => {
  test("puts the table in the middle of the stage's box", () => {
    // A box in the right two thirds of a 1500 × 900 view: the car's middle goes to the box's.
    const f = frameStage(1500, 900, { left: 540, top: 0, width: 960, height: 670 }, 3);
    expect(1500 / 2 - f.offX).toBe(540 + 480);
    expect(900 / 2 - f.offY).toBe(335);
  });

  test('stands back for a bigger car or a smaller box', () => {
    const box = { left: 0, top: 0, width: 800, height: 600 };
    const small = frameStage(800, 600, box, 2.6).dist;
    expect(frameStage(800, 600, box, 6.6).dist).toBeGreaterThan(small);
    expect(frameStage(800, 600, { ...box, height: 300 }, 2.6).dist).toBeGreaterThan(small);
    // A narrow box (a phone) is limited by its width, not its height.
    const phone = (height: number) => frameStage(390, 844, { left: 16, top: 0, width: 358, height }, 2.6).dist;
    expect(phone(1000)).toBe(phone(600));
  });

  test('the table fits every car, the bus the biggest', () => {
    for (const c of CLASSES) expect(tableRadius(c)).toBeGreaterThan(c.size[1]);
    const bus = CLASSES.find((c) => c.id === 'bus')!;
    expect(Math.max(...CLASSES.map(tableRadius))).toBe(tableRadius(bus));
  });
});

describe('the turntable', () => {
  // A skin whose cars are empty groups, counting what it builds and frees.
  const built: string[] = [];
  let freed = 0;
  const skin = {
    car: (cls: { id: string }, paint: { id: string }) => {
      built.push(`${cls.id}/${paint.id}`);
      return { root: new Group(), update() {}, dispose: () => void freed++ } as CarVisual;
    },
  } as unknown as Skin;
  const [coupe, muscle] = CLASSES;
  const plate = { text: 'NITRO', region: 'Downtown', map: 'downtown' };

  test('a new car drives up; a new paint or plate swaps in place; the same car does nothing', () => {
    const s = new Showroom(skin);
    const t = () => (s as unknown as { t: number }).t;
    s.show(coupe, PAINTS[0], plate);
    expect(s.visible).toBe(true);
    expect(t()).toBe(0);
    s.frame({ left: 0, top: 0, width: 800, height: 600 }, 800, 600);
    s.update(2, new PerspectiveCamera());
    s.show(coupe, PAINTS[0], plate);
    expect(built).toEqual(['coupe/' + PAINTS[0].id]);
    s.show(coupe, PAINTS[1], plate);
    expect(t()).toBe(2);
    s.show(coupe, PAINTS[1], { ...plate, text: 'ACE 7' });
    expect(t()).toBe(2);
    s.show(muscle, PAINTS[1], plate);
    expect(t()).toBe(0);
    expect(built.length).toBe(4);
    // Every car but the one on the table was freed.
    expect(freed).toBe(3);
    s.hide();
    expect(s.visible).toBe(false);
    s.dispose();
    expect(freed).toBe(4);
  });
});

describe('the stat bars', () => {
  test('five of them, each 0–1, with the class that has the most at a full bar', () => {
    for (const c of CLASSES) {
      const bars = carStats(CLASSES, c.id);
      expect(bars.map((b) => b.name)).toEqual(['Speed', 'Accel', 'Handling', 'Weight', 'Boost']);
      for (const b of bars) {
        expect(b.t).toBeGreaterThan(0);
        expect(b.t).toBeLessThanOrEqual(1);
      }
    }
    const heaviest = CLASSES.reduce((a, b) => (b.mass > a.mass ? b : a));
    expect(carStats(CLASSES, heaviest.id).find((b) => b.name === 'Weight')!.t).toBe(1);
    const boost = CLASSES.reduce((a, b) => (b.boostCapacity > a.boostCapacity ? b : a));
    expect(carStats(CLASSES, boost.id).find((b) => b.name === 'Boost')!.t).toBe(1);
  });

  test('none for a car that is not a class', () => {
    expect(carStats(CLASSES, 'hovercraft')).toEqual([]);
  });
});

describe('another map behind the lobby', () => {
  test('the race moves to the new track from the grid, with its shoulder and weather', () => {
    const sim = new Sim(bakeTrack(layout('downtown/downtown'), SURFACES), CLASSES, SURFACES, { seed: 4, weather: 'clear' });
    for (let k = 0; k < 4; k++) sim.addCar({ cls: CLASSES[k].id, racer: { difficulty: 1 } });
    sim.startRace(3, 1);
    for (let k = 0; k < 240; k++) sim.step([]);
    const valley = bakeTrack(layout('backroads/valley'), SURFACES);
    sim.setTrack(valley);
    sim.setWeather('rain', ['clear', 'rain']);
    sim.startRace(3, 1);
    expect(sim.track).toBe(valley);
    expect(sim.shoulderSurface).toBe(valley.surfaceIndex.get(valley.layout.shoulderSurface ?? 'sidewalk') ?? 0);
    expect(sim.wetness).toBe(1);
    expect(sim.race.phase).toBe('countdown');
    for (let i = 0; i < 4; i++) expect(sim.cars.lap[i]).toBe(0);
    // And it races there.
    for (let k = 0; k < 600; k++) sim.step([]);
    for (let i = 0; i < 4; i++) {
      expect(Number.isFinite(sim.cars.x[i])).toBe(true);
      expect(sim.cars.wreck[i] === 1 || Math.hypot(sim.cars.vx[i], sim.cars.vz[i]) > 5).toBe(true);
    }
    // A map that never rains stays dry, whatever is asked.
    sim.setWeather('rain', ['clear']);
    expect(sim.wetness).toBe(0);
  });
});
