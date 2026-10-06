// Traffic from side streets (docs/COASTAL.md, "Traffic from side streets"; TrafficLaneDef.streets):
// Coastal's home-straight traffic comes down one street, drives the main road and turns off up the
// next, fading in and out at the streets' middles, never on the main road. Still a formula of the
// seed and the race time.

import { describe, expect, test } from 'bun:test';
import type { TrackLayout } from '../src/core/content';
import { bakeTrack } from '../src/core/track/bake';
import { newHit, projectGlobal } from '../src/core/track/query';
import { validateLayout } from '../src/core/track/validate';
import { newTrafficPose, Traffic } from '../src/core/world/traffic';
import { setup } from '../src/dev/drive';
import { CLASSES, SURFACES, layout } from './helpers';

const riviera = layout('coastal/riviera');
const track = bakeTrack(riviera, SURFACES);

describe('side streets', () => {
  test("Coastal's traffic comes and goes by side streets: a lane against the lap, its streets on its own side (the sea side is the sea wall's)", () => {
    // (And rue Haute's two, along it: below.)
    const lanes = riviera.traffic!.lanes.filter((l) => l.road === undefined);
    expect(lanes.length).toBe(1);
    expect(lanes[0].dir).toBe(-1);
    for (const lane of lanes) {
      expect(lane.streets!.length).toBeGreaterThanOrEqual(2);
      expect(lane.sections).toBeUndefined();
      for (const id of lane.streets!) expect(riviera.branches!.find((b) => b.id === id)!.kind).toBe('street');
    }
    // Run as one route per pair of streets, each with its main stretch as its section.
    const tr = new Traffic(track, 7);
    expect(tr.lanes.filter((l) => l.road === undefined).length).toBe(1);
    expect(tr.routes.every((r) => r !== null)).toBe(true);
    expect(tr.count).toBeGreaterThan(0);
  });

  test('smooth all the way round, on its own side of the road, and only ever fading well off it', () => {
    const tr = new Traffic(track, 7);
    const p = newTrafficPose();
    const q = newTrafficPose();
    const hit = newHit();
    let seen = 0;
    for (let k = 0; k < tr.count; k++) {
      const lane = tr.lanes[tr.lane[k]];
      for (let t = 20; t < 140; t += 1 / 30) {
        const v = tr.visibility(k, t);
        if (v <= 0) continue;
        tr.poseAt(k, t, p);
        projectGlobal(track.main, p.x, p.z, hit);
        // Past the main road's edge: how far.
        const off = Math.abs(hit.lateral) - hit.width / 2;
        // Fading only well off it: behind where the houses will stand, not on its verge.
        if (v < 1) expect(off).toBeGreaterThan(15);
        if (off < 0) {
          seen++;
          // On the main road, on its lane's side: the oncoming lane on the left.
          expect(Math.sign(hit.lateral)).toBe(Math.sign(lane.pos));
        }
        if (tr.visibility(k, t + 1 / 30) > 0) {
          tr.poseAt(k, t + 1 / 30, q);
          // At its lane's speed (a little more as it blends between roads), and no snaps round.
          expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeLessThan((lane.speed / 30) * 1.4);
          expect(Math.abs(((q.h - p.h + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)).toBeLessThan(0.1);
        }
      }
    }
    expect(seen).toBeGreaterThan(100);
  });

  test('the same on every screen: a pure function of the seed and the race time', () => {
    const a = new Traffic(track, 42);
    const b = new Traffic(track, 42);
    const p = newTrafficPose();
    const q = newTrafficPose();
    for (let k = 0; k < a.count; k++)
      for (const t of [0, 33.3, 71.7]) {
        expect(a.visibility(k, t)).toBe(b.visibility(k, t));
        expect(a.poseAt(k, t, p)).toEqual(b.poseAt(k, t, q));
      }
  });

  test("its main distance is its pose's, through the blend at a street's mouth (or a near miss pays out every tick)", () => {
    const tr = new Traffic(track, 7);
    const p = newTrafficPose();
    for (let k = 0; k < tr.count; k++) for (let t = 0; t < 120; t += 0.05) expect(tr.sAt(k, t)).toBe(tr.poseAt(k, t, p).s);
  });

  test('wrecked, it stays gone until it next comes up a street: never back where it was hit', () => {
    const tr = new Traffic(track, 7);
    const p = newTrafficPose();
    const hit = newHit();
    for (let k = 0; k < tr.count; k++) {
      // (Rue Haute's never comes onto the main road: below.)
      if (tr.routes[tr.lane[k]]!.road) continue;
      // Hit on the main road.
      let w = 30;
      while (true) {
        tr.poseAt(k, w, p);
        projectGlobal(track.main, p.x, p.z, hit);
        if (tr.visibility(k, w) >= 1 && Math.abs(hit.lateral) < hit.width / 2) break;
        w += 0.1;
      }
      tr.wreckedAt[k] = w;
      let back = -1;
      for (let t = w; t < w + 120 && back < 0; t += 0.05) if (tr.visibility(k, t) > 0) back = t;
      expect(back).toBeGreaterThan(w + 12);
      tr.poseAt(k, back, p);
      projectGlobal(track.main, p.x, p.z, hit);
      expect(Math.abs(hit.lateral) - hit.width / 2).toBeGreaterThan(15);
      tr.wreckedAt[k] = -1;
    }
  });

  test('the AI keeps to the main road past them', () => {
    const streets = track.splines.filter((sp) => riviera.branches!.find((b) => b.id === sp.id)?.kind === 'street');
    // Past both, round the line.
    const from = Math.max(...streets.map((sp) => sp.mainFrom));
    const sim = setup(track, CLASSES, SURFACES, { s: from - 100 }, 'ai', { kmh: 100 });
    for (let k = 0; k < 60 * 12; k++) {
      sim.step([]);
      expect(streets.map((sp) => sp.index)).not.toContain(sim.cars.spline[0]);
    }
  });

  test('the validator: streets, on the lane’s own side, long enough, in order', () => {
    const errors = (l: TrackLayout) => validateLayout(l, SURFACES, CLASSES).filter((p) => p.level === 'error' && p.message.includes('traffic lane'));
    const withLane = (lane: object) => ({ ...riviera, traffic: { ...riviera.traffic!, lanes: [{ ...riviera.traffic!.lanes[0], ...lane }] } });
    expect(errors(riviera)).toEqual([]);
    // In order, but across the road from its lane (a lane with the lap, on the right, by the town
    // side's streets): only the side errs.
    const across = errors(withLane({ pos: 0.7, dir: 1, streets: ['rue-des-pins', 'rue-du-port'] }));
    expect(across.length).toBe(2);
    expect(across.every((p) => p.message.includes('across the road'))).toBe(true);
    // Not a street, and both streets and sections.
    expect(errors(withLane({ streets: ['basin-road', 'rue-du-port'] })).length).toBeGreaterThan(0);
    expect(errors(withLane({ sections: [[100, 200]] })).length).toBeGreaterThan(0);
    // Out of order: off the main road before it's on it (against the lap, rue-du-port comes first).
    expect(errors(withLane({ streets: ['rue-des-pins', 'rue-du-port'] })).length).toBeGreaterThan(0);
  }, 60_000);
});

describe('rue Haute, the back street (the owner: "a second row of buildings and a back street behind the village")', () => {
  const haute = track.splines.find((sp) => sp.id === 'rue-haute')!;

  test('a side street up behind the waterfront and back, on the town side, short of the line; up the hill, no steeper than 9%, no steps', () => {
    expect(riviera.branches!.find((b) => b.id === 'rue-haute')!.kind).toBe('street');
    expect(haute.mainFrom).toBeLessThan(haute.mainTo);
    expect(track.main.length - haute.mainTo).toBeGreaterThan(20);
    const hit = newHit();
    let deepest = 0;
    for (let i = 0; i < haute.n; i++) {
      projectGlobal(track.main, haute.px[i], haute.pz[i], hit);
      // Left of the lap: the town's side (the sea's on the right).
      if (Math.abs(hit.lateral) > 20) expect(hit.lateral).toBeLessThan(0);
      deepest = Math.max(deepest, -hit.lateral);
      if (i > 0) {
        expect(Math.abs(haute.py[i] - haute.py[i - 1])).toBeLessThan(0.15);
        expect(Math.abs(haute.py[i] - haute.py[i - 1]) / haute.step).toBeLessThan(0.09);
      }
    }
    expect(deepest).toBeGreaterThan(90);
    expect(Math.max(...haute.py) - haute.py[0]).toBeGreaterThan(3);
  });

  test('traffic up and down it: on it, at its pace, fading in and out only round the houses, never on the boulevard', () => {
    const tr = new Traffic(track, 7);
    const p = newTrafficPose();
    const q = newTrafficPose();
    const hit = newHit();
    const ways = new Set<number>();
    let seen = 0;
    for (let k = 0; k < tr.count; k++) {
      const r = tr.routes[tr.lane[k]]!;
      if (!r.road) continue;
      const lane = tr.lanes[tr.lane[k]];
      expect(r.road).toBe(haute);
      // (Never one of the main road's lanes: the AI's own side and the oncoming score skip it.)
      expect(lane.sections).toEqual([]);
      for (let t = 20; t < 140; t += 1 / 30) {
        const v = tr.visibility(k, t);
        if (v <= 0) continue;
        seen++;
        ways.add(lane.dir);
        tr.poseAt(k, t, p);
        projectGlobal(haute, p.x, p.z, hit);
        // On its lane's side of the street (the street's frame), each way on its own right.
        expect(Math.abs(hit.lateral)).toBeLessThan(haute.width[0] / 2);
        expect(hit.lateral * lane.pos).toBeGreaterThan(0);
        expect(lane.pos * lane.dir).toBeGreaterThan(0);
        projectGlobal(track.main, p.x, p.z, hit);
        expect(Math.abs(hit.lateral) - hit.width / 2).toBeGreaterThan(v < 1 ? 30 : 10);
        if (tr.visibility(k, t + 1 / 30) > 0) {
          tr.poseAt(k, t + 1 / 30, q);
          // (A little more on the outside of a bend: its lane's a few meters off the middle.)
          expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeLessThan((lane.speed / 30) * 1.2);
        }
      }
    }
    expect([...ways].sort()).toEqual([-1, 1]);
    expect(seen).toBeGreaterThan(1000);
  });

  test('the validator: a road lane runs along a side street, over a stretch of it, and nowhere else', () => {
    const errors = (lane: object) =>
      validateLayout({ ...riviera, traffic: { ...riviera.traffic!, lanes: [{ pos: 0.7, dir: 1, speed: 11, ...lane }] } }, SURFACES, CLASSES).filter((p) => p.level === 'error' && p.message.includes('traffic lane'));
    expect(errors({ road: 'rue-haute', span: [75, 300] })).toEqual([]);
    expect(errors({ road: 'basin-road' }).length).toBe(1);
    expect(errors({ road: 'rue-haute', span: [300, 75] }).length).toBe(1);
    expect(errors({ road: 'rue-haute', span: [0, 50] }).length).toBe(1);
    expect(errors({ road: 'rue-haute', sections: [[100, 200]] }).length).toBe(1);
    expect(errors({ sections: [[100, 200]], span: [0, 100] }).length).toBe(1);
  }, 60_000);
});
