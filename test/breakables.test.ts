// Breakable walls (docs/CALDERA.md step 3b; core/world/breakables.ts): smashables grown into wall
// panels in world space. A wall to a slow car, through for a fast one; down for the race or standing
// again; saved in snapshots; checked by the validator; on Paradise Open, the Lava Tube boarded up.

import { describe, expect, test } from 'bun:test';
import type { BreakableDef } from '../src/core/content';
import { neutralControls } from '../src/core/controls';
import { Ev } from '../src/core/events';
import { Sim } from '../src/core/sim';
import { bakeTrack } from '../src/core/track/bake';
import { validateLayout } from '../src/core/track/validate';
import { Breakables, PANEL_WIDTH } from '../src/core/world/breakables';
import { run as drive, setup } from '../src/dev/drive';
import { describeProbe, probe } from '../src/dev/probe';
import { CLASSES, SURFACES, layout } from './helpers';

const open = layout('paradise-open/open');
const track = bakeTrack(open, SURFACES);
const tube = track.splines.find((s) => s.id === 'lava-tube')!;
const boards = open.breakables!.find((b) => b.id === 'lava-tube-boards')!;

/** A coupe on the tube `s` m along, `lat` across, at `kmh`, held at `throttle` for `seconds`: its sim. */
function run(kmh: number, throttle: number, seconds: number, opts: { lat?: number; s?: number; layout?: typeof open; cls?: string; turn?: number } = {}) {
  const t = opts.layout ? bakeTrack(opts.layout, SURFACES) : track;
  const sim = new Sim(t, CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
  const c = sim.addCar({ cls: opts.cls ?? 'coupe', human: true });
  sim.placeCar(c, tube.index, opts.s ?? 50, opts.lat ?? 0, kmh / 3.6);
  if (opts.turn) {
    // Angled to the road (and so to the wall), going the way it points.
    const v = Math.hypot(sim.cars.vx[c], sim.cars.vz[c]);
    sim.cars.h[c] += opts.turn;
    sim.cars.vx[c] = Math.sin(sim.cars.h[c]) * v;
    sim.cars.vz[c] = Math.cos(sim.cars.h[c]) * v;
  }
  const breaks: number[] = [];
  let cursor = sim.events.head;
  for (let k = 0; k < 60 * seconds; k++) {
    sim.step([{ ...neutralControls(), throttle }]);
    cursor = sim.events.read(cursor, (e) => void (e.type === Ev.WallBreak && breaks.push(e.b)));
  }
  const down = [...sim.world.breakables.brokenAt.keys()].filter((k) => !sim.world.breakables.standing(k, sim.time));
  return { sim, c, breaks, down, speed: Math.hypot(sim.cars.vx[c], sim.cars.vz[c]) * 3.6 };
}

describe('breakable walls', () => {
  test("a wall's cut into panels about PANEL_WIDTH wide, end to end along it, each standing", () => {
    const br = new Breakables([boards, { ...boards, id: 'b', panel: 5 }]);
    const len = Math.hypot(boards.to[0] - boards.from[0], boards.to[2] - boards.from[2]);
    const n = Math.round(len / PANEL_WIDTH);
    expect(br.n).toBe(n + Math.round(len / 5));
    for (let k = 0; k < n; k++) {
      expect(br.half[k] * 2).toBeCloseTo(len / n, 6);
      expect(br.standing(k, 1e6)).toBe(true);
    }
    // In order from `from` to `to`, all on its line.
    expect(Math.hypot(br.x[0] - boards.from[0], br.z[0] - boards.from[2])).toBeCloseTo(br.half[0], 6);
    expect(br.wall[n]).toBe(1);
  });

  test('met slowly it is a wall: the car stops at it, and nothing breaks', () => {
    for (const kmh of [25, 40]) {
      const r = run(kmh, 0, 2.5);
      expect([kmh, r.down]).toEqual([kmh, []]);
      expect(r.sim.cars.s[r.c]).toBeLessThan(64);
      expect(r.sim.cars.wreck[r.c]).toBe(0);
    }
  });

  test('flat out, the car bursts the panels in its way and drives on, a little slower; the rest stand', () => {
    for (const lat of [-5, 0, 2]) {
      const r = run(150, 1, 2.5, { lat });
      expect(r.down.length).toBeGreaterThanOrEqual(1);
      expect(r.down.length).toBeLessThanOrEqual(3);
      expect(r.breaks.sort()).toEqual(r.down);
      expect(r.sim.cars.s[r.c]).toBeGreaterThan(140);
      expect(r.sim.cars.wreck[r.c]).toBe(0);
    }
    // Where the car went, not across the whole tube.
    expect(run(150, 1, 2.5, { lat: -5 }).down).not.toEqual(run(150, 1, 2.5, { lat: 2 }).down);
  });

  test('just over its speed on a seam between two panels, a car breaks both and goes on (it broke one and bounced off the other)', () => {
    // The seams are every 2.5 m across from the wall's end at 7.5 m.
    for (const lat of [-5, -2.5, 0, 2.5]) {
      const r = run(46, 0, 2.5, { lat, s: 55 });
      expect([lat, r.down.length]).toEqual([lat, 2]);
      expect(r.sim.cars.s[r.c]).toBeGreaterThan(70);
    }
  });

  test('angled into a seam just over its speed, a car breaks a hole its width at once and goes on (its nose met the second panel a tick later, slowed, and bounced)', () => {
    for (const lat of [-2.5, 0, 2.5])
      for (const turn of [-0.2, -0.1, 0.1, 0.2]) {
        const r = run(46, 0, 2.5, { lat, s: 55, turn });
        expect([lat, turn, r.down.length >= 2, r.sim.cars.s[r.c] > 68]).toEqual([lat, turn, true, true]);
      }
  });

  test('across at a shallow angle, just over its speed, a car goes through: the hole is as long as it slides along the wall (it met the next panel, slowed, and bounced or wrecked)', () => {
    // A 30 m wall across the main road (its walls are off), broken at 12 m/s across it.
    const m = track.main;
    const k = Math.round(400 / m.step);
    const [px, py, pz, tx, tz] = [m.px[k], m.py[k], m.pz[k], m.tx[k], m.tz[k]];
    const wall: BreakableDef = { id: 'w', look: 'boards', from: [px + tz * 15, py, pz - tx * 15], to: [px - tz * 15, py, pz + tx * 15], height: 3, breaks: 12 };
    const t = bakeTrack({ ...open, breakables: [wall] }, SURFACES);
    for (const [cls, deg, ratio] of [['coupe', 30, 1.3], ['coupe', 45, 1.15], ['coupe', 60, 1.3], ['bus', 45, 1.3]] as const) {
      const a = (deg * Math.PI) / 180;
      const back = cls === 'bus' ? 10 : 6.5;
      const heading = ((Math.atan2(tx, tz) + a) * 180) / Math.PI;
      const sim = setup(t, CLASSES, SURFACES, { x: px - tx * back, z: pz - tz * back, heading }, { throttle: 0 }, { cls, kmh: (12 * 3.6 * ratio) / Math.cos(a) });
      drive(sim, { throttle: 0 }, 1.5, 1.5);
      const past = (sim.cars.x[0] - px) * tx + (sim.cars.z[0] - pz) * tz;
      expect([cls, deg, past > 3, sim.cars.wreck[0]]).toEqual([cls, deg, true, 0]);
    }
  }, 30_000);

  test("a fast car into a wall that takes more than it has is stopped, however deep it gets in a tick", () => {
    // 200 km/h is 0.93 m a tick, past a panel's thickness and more: into a wall that breaks at
    // 250 km/h, it bounces off.
    const strong = { ...open, breakables: [{ ...boards, breaks: 250 / 3.6 }] };
    // (From a few starts a fraction of a tick apart: how deep it gets in its first tick hangs on it.)
    for (const s of [50, 50.3, 50.6, 50.9]) {
      const r = run(200, 0, 1.5, { layout: strong, s });
      expect([s, r.down, r.sim.cars.s[r.c] < 64]).toEqual([s, [], true]);
    }
  });

  test('a car inside a standing panel (one standing again round it) goes on through, not thrown out along the wall', () => {
    for (const cls of ['coupe', 'bus']) {
      const sim = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
      const c = sim.addCar({ cls, human: true });
      const k = Math.round(64 / tube.step);
      sim.placeCar(c, tube.index, 64, 0, 0);
      const [x, z] = [sim.cars.x[c], sim.cars.z[c]];
      sim.step([neutralControls()]);
      expect([cls, Math.hypot(sim.cars.x[c] - x, sim.cars.z[c] - z) < 0.5]).toEqual([cls, true]);
      expect(Math.abs(sim.cars.y[c] - tube.py[k]) < 1).toBe(true);
    }
  });

  test('a wide car through a one-panel hole breaks the panels it pushes into (it wedged on their ends)', () => {
    // The AI's bus from rest just short of it: it backs off and goes again, breaking one panel, and
    // then it met the next ones on their ends, slowly, and stuck there.
    const sim = setup(track, CLASSES, SURFACES, { road: 'lava-tube', s: 58, lateral: 0 }, 'ai', { cls: 'bus' });
    const r = drive(sim, 'ai', 11, 1).summary;
    expect(sim.world.breakables.broken(sim.time).length).toBeGreaterThanOrEqual(2);
    expect(r.end.s).toBeGreaterThan(100);
  }, 30_000);

  test('down for the race, or standing again after its time; a ghost (respawning) goes through it', () => {
    const r = run(150, 1, 2);
    const k = r.down[0];
    expect(r.sim.world.breakables.standing(k, r.sim.time + 3600)).toBe(false);
    const again = new Breakables([{ ...boards, standsAgain: 5 }]);
    again.brokenAt[k] = 10;
    expect(again.standing(k, 14.9)).toBe(false);
    expect(again.standing(k, 15)).toBe(true);
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
    const c = sim.addCar({ cls: 'coupe', human: true });
    sim.placeCar(c, tube.index, 50, 0, 150 / 3.6);
    sim.cars.ghostT[c] = 5;
    for (let t = 0; t < 120; t++) sim.step([{ ...neutralControls(), throttle: 1 }]);
    expect(sim.world.breakables.broken(sim.time)).toEqual([]);
    expect(sim.cars.s[c]).toBeGreaterThan(100);
  });

  test("snapshots keep what's down", () => {
    const r = run(150, 1, 2);
    const snap = r.sim.snapshot();
    expect(snap.wallsBroken!.map(([k]) => k)).toEqual(r.down);
    const fresh = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
    fresh.addCar({ cls: 'coupe', human: true });
    fresh.restore(snap);
    expect(fresh.world.breakables.broken(fresh.time)).toEqual(r.sim.world.breakables.broken(r.sim.time));
  });

  test('probe says one is near, and what breaks it', () => {
    const k = Math.round(50 / tube.step);
    const p = probe(track, tube.px[k], tube.pz[k]);
    expect(p.walls.map((w) => w.id)).toEqual(['lava-tube-boards']);
    expect(describeProbe(p)).toContain('breakable wall lava-tube-boards');
    expect(probe(track, tube.px[k] + 200, tube.pz[k]).walls).toEqual([]);
  });

  test('the validator wants open ground, a size, what breaks it, and its foot on a floor', () => {
    const bad: BreakableDef[] = [
      boards,
      { ...boards, id: 'flat', height: 0 },
      { ...boards, id: 'dot', to: boards.from },
      { ...boards, id: 'air', from: [boards.from[0], boards.from[1] + 5, boards.from[2]], to: [boards.to[0], boards.to[1] + 5, boards.to[2]] },
      { ...boards, id: 'lava-tube-boards' },
      { ...boards, id: 'no-width', panel: 0 },
      { ...boards, id: 'slivers', panel: 0.01 },
    ];
    const problems = validateLayout({ ...open, breakables: bad }, SURFACES, CLASSES).map((p) => p.message);
    const of = (id: string) => problems.filter((m) => m.startsWith(`breakable wall ${id}:`));
    expect(of('flat').some((m) => m.includes('must be over 0'))).toBe(true);
    expect(of('dot').some((m) => m.includes('same place'))).toBe(true);
    expect(of('air').some((m) => m.includes('the floor there'))).toBe(true);
    expect(of('lava-tube-boards').some((m) => m.includes('another with that id'))).toBe(true);
    // (A panel of no width hung the validator: one panel after another, forever.)
    expect(of('no-width').some((m) => m.includes('must be over 0'))).toBe(true);
    expect(of('slivers').some((m) => m.includes('more than'))).toBe(true);
    expect(validateLayout(open, SURFACES, CLASSES).filter((p) => p.message.startsWith('breakable'))).toEqual([]);
    const city = layout('downtown/downtown');
    expect(validateLayout({ ...city, breakables: [boards] }, SURFACES, CLASSES).some((p) => p.message.includes('need open ground'))).toBe(true);
  }, 60_000);
});
