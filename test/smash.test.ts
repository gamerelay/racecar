import { describe, expect, test } from 'bun:test';
import { neutralControls } from '../src/core/controls';
import type { TrackLayout } from '../src/core/content';
import { Ev } from '../src/core/events';
import { Sim } from '../src/core/sim';
import { bakeTrack } from '../src/core/track/bake';
import { newHit, projectGlobal } from '../src/core/track/query';
import { validateLayout } from '../src/core/track/validate';
import { SMASH_KINDS, SMASH_RESPAWN, Smashables } from '../src/core/world/smash';
import { CLASSES, DOWNTOWN, SURFACES, layout } from './helpers';

// Smashables (PLAN phase 6): props on the verge that burst when hit, paying a pinch of boost.
// They're sim pieces placed from the layout, so every client has the same ones, and when each was
// smashed is state that snapshots carry.

const MAPS = ['downtown/downtown', 'backroads/valley', 'paradise/island'];

/** A sim on Downtown, one car driving straight at smashable `k` from 25 m back. */
function atProp(k = 0) {
  const sim = new Sim(bakeTrack(DOWNTOWN, SURFACES), CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
  const i = sim.addCar({ cls: 'coupe', human: true });
  const sm = sim.world.smash;
  const hit = newHit();
  projectGlobal(sim.track.splines[sm.spline[k]], sm.x[k], sm.z[k], hit);
  sim.placeCar(i, sm.spline[k], sm.s[k] - 25, hit.lateral, 20);
  return { sim, i, sm };
}

describe('smashables', () => {
  test('every map has them, each on the verge: past the road\'s edge, short of the wall', () => {
    for (const key of MAPS) {
      const l = layout(key);
      const track = bakeTrack(l, SURFACES);
      const sm = new Smashables(track);
      expect(sm.n, key).toBeGreaterThan(10);
      const hit = newHit();
      for (let k = 0; k < sm.n; k++) {
        const sp = track.splines[sm.spline[k]];
        projectGlobal(sp, sm.x[k], sm.z[k], hit, sm.y[k]);
        const r = SMASH_KINDS[sm.kind[k]].r;
        const out = Math.abs(hit.lateral) - hit.width / 2;
        expect(out - r, `${key} #${k}`).toBeGreaterThan(-0.05);
        expect(out + r, `${key} #${k}`).toBeLessThan(hit.shoulder + 0.05);
        // ...and not on any other road (the Sandbar runs along the beach road's verge).
        for (const other of track.splines) {
          if (other.index === sp.index) continue;
          projectGlobal(other, sm.x[k], sm.z[k], hit, sm.y[k]);
          if (Math.abs(hit.cy - sm.y[k]) < 4) expect(Math.abs(hit.lateral), `${key} #${k} on ${other.id}`).toBeGreaterThan(hit.width / 2 + hit.shoulder);
        }
      }
      expect(validateLayout(l, SURFACES, CLASSES).filter((p) => p.message.startsWith('smash'))).toEqual([]);
    }
  });

  test("a car checks only those near it: every one within reach, by a road or on open ground, in index order", () => {
    const sm = new Smashables(bakeTrack(layout('heist/city'), SURFACES));
    expect(sm.n).toBeGreaterThan(5000);
    const out: number[] = [];
    let most = 0;
    for (let k = 0; k < 400; k++) {
      // Round the Presidio's woods (thick with trees), and anywhere.
      const [x, z] = k % 2 ? [-1040 + ((k * 37) % 480), -150 + ((k * 53) % 540)] : [-1100 + ((k * 211) % 2200), -700 + ((k * 157) % 1400)];
      const near = sm.near(x, z, out);
      most = Math.max(most, near.length);
      for (let j = 1; j < near.length; j++) expect(near[j]).toBeGreaterThan(near[j - 1]);
      const set = new Set(near);
      for (let j = 0; j < sm.n; j++) if (Math.abs(sm.x[j] - x) <= 8 && Math.abs(sm.z[j] - z) <= 8) expect(set.has(j)).toBe(true);
    }
    expect(most).toBeLessThan(200);
  });

  test("a ground's reach must be a box", () => {
    const l = { ...DOWNTOWN, ground: { cell: 4, wallFrom: 60, wallRise: 0.5, reach: [0, 0, -10, 10] as [number, number, number, number] } };
    expect(validateLayout(l, SURFACES, CLASSES).some((p) => p.message.includes('reach'))).toBe(true);
  });

  test('built the same from the same layout (online, every client has the same ones)', () => {
    const a = new Smashables(bakeTrack(DOWNTOWN, SURFACES));
    const b = new Smashables(bakeTrack(DOWNTOWN, SURFACES));
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    expect(Array.from(a.kind)).toEqual(Array.from(b.kind));
  });

  test('driving through one smashes it: an event, a pinch of boost and points, a little speed lost, never a wreck', () => {
    const { sim, i, sm } = atProp(0);
    sim.cars.boost[i] = 0;
    let smashed = -1;
    let other = 0;
    let speedBefore = 0;
    let cursor = sim.events.head;
    for (let t = 0; t < 120 && smashed < 0; t++) {
      speedBefore = Math.hypot(sim.cars.vx[i], sim.cars.vz[i]);
      sim.step([{ ...neutralControls(), throttle: 0.4 }]);
      cursor = sim.events.read(cursor, (e) => {
        if (e.type === Ev.Smash && e.car === i) {
          smashed = sm.standing(0, sim.time) ? -2 : 0;
          other = e.other;
        }
      });
    }
    expect(smashed).toBe(0);
    // No `other`: it isn't a car (listeners check it against the car they follow).
    expect(other).toBe(-1);
    expect(sm.standing(0, sim.time)).toBe(false);
    expect(sim.cars.boost[i]).toBeGreaterThan(0);
    expect(sim.cars.score[i]).toBeGreaterThanOrEqual(SMASH_KINDS[sm.kind[0]].points);
    expect(Math.hypot(sim.cars.vx[i], sim.cars.vz[i])).toBeLessThan(speedBefore + 0.5);
    expect(sim.cars.wreck[i]).toBe(0);
  });

  test('it stands again SMASH_RESPAWN s later, and a snapshot carries what\'s down', () => {
    const { sim, sm } = atProp(0);
    sm.brokenAt[0] = sim.time;
    const snap = sim.snapshot();
    expect(snap.smashed).toEqual([[0, sim.time]]);
    sm.brokenAt[0] = -Infinity;
    sim.restore(snap);
    expect(sm.standing(0, sim.time)).toBe(false);
    expect(sm.standing(0, sim.time + SMASH_RESPAWN)).toBe(true);
  });

  test('the validator refuses an unknown kind and a row with no spacing', () => {
    const bad: TrackLayout = { ...DOWNTOWN, smashables: [{ kind: 'piano', s: [0, 100], every: 10 }, { kind: 'cone', s: [0, 100], every: 0 }] };
    const msgs = validateLayout(bad, SURFACES, CLASSES).map((p) => p.message);
    expect(msgs).toContain('smashables: unknown kind "piano"');
    expect(msgs.some((m) => m.includes('"every" must be at least 2 m'))).toBe(true);
  });
});
