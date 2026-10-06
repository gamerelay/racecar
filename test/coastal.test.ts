// Coastal (docs/COASTAL.md): a harbour town on a headland, built on Caldera from the start. Its
// first lap (COASTAL's step 2): the land in world space (the coast, and hills off the roads), the
// harbour bridge a deck over the harbour mouth, mostly blue skies, and its own music.

import { describe, expect, test } from 'bun:test';
import { playlistFor, ANY_MAP } from '../src/audio/soundtrack';
import type { MapDef } from '../src/core/content';
import { bakeTrack } from '../src/core/track/bake';
import { hillHeight } from '../src/core/track/features/hills';
import { newCast } from '../src/core/track/ground';
import { newHit, projectGlobal, sampleAt } from '../src/core/track/query';
import { planWeather } from '../src/core/world/weather';
import { run, setup } from '../src/dev/drive';
import { driveRacer, racingLine } from '../src/core/ai/racer';
import { neutralControls } from '../src/core/controls';
import { validateLayout } from '../src/core/track/validate';
import { ALL_MAPS } from '../tools/content';
import { CLASSES, SURFACES, layout } from './helpers';

const riviera = layout('coastal/riviera');
const track = bakeTrack(riviera, SURFACES);
const g = track.ground!;
const def = riviera.ground!;
const map = ALL_MAPS.find((m) => m.id === 'coastal') as MapDef;
const bridge = g.pieces.list.find((p) => p.id === 'harbour-bridge')!;

describe('coastal', () => {
  test('an experimental map (out of the lobby), one layout, Riviera', () => {
    expect(map).toMatchObject({ name: 'Coastal', layouts: ['riviera'], experimental: true });
  });

  test('hills: the highest dome at a point, nothing past their feet', () => {
    const hills = [
      { x: 0, z: 0, h: 50, r: 100 },
      { x: 60, z: 0, h: 20, r: 100 },
    ];
    expect(hillHeight(hills, 0, 0)).toBeCloseTo(50, 6);
    // (The lower one's top, over the higher one's side there.)
    expect(hillHeight(hills, 60, 0)).toBeCloseTo(20, 6);
    expect(hillHeight(hills, 200, 0)).toBe(0);
    expect(hillHeight(hills, 0, 101)).toBe(0);
  });

  test('the mountain rises off the road, and the road keeps its own height', () => {
    const town = def.hills!.reduce((a, b) => (b.h > a.h ? b : a));
    const plain = bakeTrack({ ...riviera, ground: { ...def, hills: undefined } }, SURFACES).ground!;
    // Near its top, well off any road: the hill.
    let risen = 0;
    for (let x = town.x - 60; x <= town.x + 60; x += 30)
      for (let z = town.z - 60; z <= town.z + 60; z += 30) risen = Math.max(risen, g.height(x, z) - plain.height(x, z));
    expect(risen).toBeGreaterThan(40);
    // On the road, as without the hills (but in the Rock Tunnel, under them: tunnel.test.ts).
    const hit = newHit();
    const tunnel = g.pieces.list.find((p) => p.id === 'rock-tunnel')!;
    for (let s = 0; s < track.main.length; s += 50) {
      if (s > tunnel.s[0] && s < tunnel.s[1]) continue;
      sampleAt(track.main, s, hit);
      expect([s, g.height(hit.cx, hit.cz)]).toEqual([s, expect.closeTo(plain.height(hit.cx, hit.cz), 3)]);
    }
  });

  test('the harbour bridge is a deck over the water: the sea well under it, and a car over it at speed', () => {
    const c = newCast();
    const mid = sampleAt(track.main, (bridge.s[0] + bridge.s[1]) / 2, newHit());
    g.cast(mid.cx, mid.cy + 0.3, mid.cz, c);
    expect(c.piece).toBe(bridge.index);
    expect(c.floor).toBeCloseTo(mid.cy, 1);
    expect(c.ground).toBeLessThan(def.sea! - 2);
    // A harbour, not a pit under the deck: deep water up the channel, well off the bridge (the deck's
    // `under` only reaches 15 m past its edges), and its sides still in the water.
    for (const z of [240, 270]) {
      expect(g.height(mid.cx, z)).toBeLessThan(def.sea! - 5);
      expect(g.height(mid.cx - 35, z)).toBeLessThan(def.sea! - 1);
      expect(g.height(mid.cx + 35, z)).toBeLessThan(def.sea! - 1);
    }
    const input = { throttle: 1 };
    const d = run(setup(track, CLASSES, SURFACES, { s: bridge.s[0] - 40 }, input, { kmh: 120 }), input, 7, 0.5);
    expect(d.summary.wrecks).toEqual([]);
    expect(d.summary.end.s).toBeGreaterThan(bridge.s[1]);
  }, 30_000);

  test("rock rails: a wall on the outside of every tight corner up top, the inside open, and open between them", () => {
    const m = track.main;
    const w = Math.round(10 / m.step);
    let corners = 0;
    let open = 0;
    // From the Old Town's first row to the lighthouse (the generator's RAILS: a point on each).
    const hit = newHit();
    const sAt = (x: number, z: number) => (projectGlobal(m, x, z, hit), hit.s);
    for (let i = Math.round((sAt(405, 258) + 20) / m.step); i < Math.round((sAt(-758, 384) - 20) / m.step); i++) {
      const turn = (m.tx[i + w] - m.tx[i - w]) * -m.tz[i] + (m.tz[i + w] - m.tz[i - w]) * m.tx[i];
      const radius = (2 * w * m.step) / Math.max(1e-6, Math.abs(turn));
      // (Not in the tunnel: walls both sides. Nor where a branch forks off or comes back: the bake
      // opens the wall there, as the Stairs' arm does on the way into the second hairpin.)
      if (g.pieces.floors(0)?.[i]) continue;
      const at = i * m.step;
      if (track.splines.some((b) => (b.fromRoad === 0 && at > b.fromS - 5 && at < b.fromS + 70) || (b.toRoad === 0 && at > b.toS - 70 && at < b.toS + 5))) continue;
      if (radius < 80) {
        corners++;
        // Outside: turning right, the left.
        expect([i * m.step, turn > 0 ? m.wallL[i] : m.wallR[i]]).toEqual([i * m.step, 1]);
        expect([i * m.step, turn > 0 ? m.wallR[i] : m.wallL[i]]).toEqual([i * m.step, 0]);
      } else if (radius > 400 && !m.wallL[i] && !m.wallR[i]) open++;
    }
    expect(corners).toBeGreaterThan(50);
    expect(open).toBeGreaterThan(200);
  });

  test('the Riviera town: solid houses stacked up from the boulevard, clear of the roads, no trees in them', () => {
    const houses = riviera.houses!;
    expect(houses.length).toBeGreaterThan(200);
    // The boulevard: four lanes.
    expect(track.main.lanes[Math.round(10 / track.main.step)]).toBe(4);
    // Each a solid block, on the lowest ground under it.
    const solid = track.props.filter((p) => p.kind === 'house');
    expect(solid.length).toBe(houses.length);
    expect(solid.every((p) => p.solid && p.wall && p.y <= g.height(p.x, p.z) + 0.01)).toBe(true);
    // No tree stands in one.
    const pines = track.pines!;
    for (const h of houses) {
      const fx = Math.sin(h.rot);
      const fz = Math.cos(h.rot);
      pines.near(h.at[0], h.at[1], (k) => {
        const dx = pines.x[k] - h.at[0];
        const dz = pines.z[k] - h.at[1];
        expect(Math.abs(dx * fz - dz * fx) < h.size[0] / 2 && Math.abs(dx * fx + dz * fz) < h.size[1] / 2).toBe(false);
      });
    }
  });

  test('driven into a house, a car is stopped at its wall, not through it', () => {
    // The house nearest the start line, and a car aimed at its middle from 25 m out in front of it.
    const h = riviera.houses!.reduce((a, b) => (Math.hypot(b.at[0] + 210, b.at[1] - 322) < Math.hypot(a.at[0] + 210, a.at[1] - 322) ? b : a));
    const fx = Math.sin(h.rot);
    const fz = Math.cos(h.rot);
    const spot = { x: h.at[0] + fx * (h.size[1] / 2 + 25), z: h.at[1] + fz * (h.size[1] / 2 + 25), heading: ((h.rot + Math.PI) * 180) / Math.PI };
    const input = { throttle: 1 };
    const sim = setup(track, CLASSES, SURFACES, spot, input, { kmh: 40 });
    let closest = Infinity;
    let inside = false;
    for (let k = 0; k < 60 * 3; k++) {
      run(sim, input, 1 / 60, 1);
      const dx = sim.cars.x[0] - h.at[0];
      const dz = sim.cars.z[0] - h.at[1];
      const across = Math.abs(dx * fz - dz * fx);
      const along = dx * fx + dz * fz;
      closest = Math.min(closest, along - h.size[1] / 2);
      if (across < h.size[0] / 2 - 1 && Math.abs(along) < h.size[1] / 2 - 1) inside = true;
    }
    // It got there (its nose at the wall), and never into it.
    expect(closest).toBeLessThan(3);
    expect(inside).toBe(false);
  }, 30_000);

  describe('the Old Town and the Stairs (COASTAL step 7)', () => {
    const sp = (id: string) => track.splines.find((x) => x.id === id)!;
    const [stairs, top, arm] = ['stairs', 'stairs-top', 'stairs-arm'].map(sp);

    test('two flights through a crossroads on the second row, and an arm off the first (a lane off a branch)', () => {
      const gr = track.graph;
      const street = (road: string) => gr.streets.filter((st) => st.road === road);
      // The first flight's end and the second's start: one node on the main road.
      expect(street('stairs').at(-1)!.to).toBe(street('stairs-top')[0].from);
      expect([arm.fromRoad, arm.toRoad]).toEqual([stairs.index, 0]);
      expect(street('stairs-arm')[0].from).toBe(street('stairs')[0].to);
      // Off and onto the main road the right way round: no branch end against its heading.
      expect(validateLayout(riviera, SURFACES, CLASSES).filter((p) => p.spline?.startsWith('stairs') || /stairs/.test(p.message))).toEqual([]);
    });

    test('stepped (their own heights, a lip every tread), narrow, walled in by the houses', () => {
      for (const f of [stairs, top, arm]) {
        expect(riviera.branches!.find((b) => b.id === f.id)!.heights).toBe('own');
        // A riser every tread: the climb steepest at each, flatter between (not a smooth slope).
        let risers = 0;
        for (let i = 2; i < f.n - 2; i++) {
          const [a, b, c] = [f.py[i] - f.py[i - 1], f.py[i + 1] - f.py[i], f.py[i + 2] - f.py[i + 1]];
          if (b > a && b >= c) risers++;
        }
        expect([f.id, risers > f.length / 8]).toEqual([f.id, true]);
      }
      // Houses close along them, both sides (where there's room: not in the wedge inside the arm).
      const hit = newHit();
      const near = [0, 0];
      for (const f of [stairs, top, arm])
        for (const h of riviera.houses!) {
          projectGlobal(f, h.at[0], h.at[1], hit);
          if (hit.s > 5 && hit.s < f.length - 5 && Math.abs(hit.lateral) < hit.width / 2 + hit.shoulder + Math.max(h.size[0], h.size[1]) / 2 + 1.5) near[hit.lateral < 0 ? 0 : 1]++;
        }
      expect(Math.min(...near)).toBeGreaterThanOrEqual(4);
    });

    test("the AI takes them no faster than their limit: its line capped, so it reckons them as they drive", () => {
      for (const f of [stairs, top, arm]) {
        const limit = riviera.branches!.find((b) => b.id === f.id)!.limit!;
        expect(Math.max(...racingLine(track, f).speed)).toBeLessThanOrEqual(limit);
      }
      const bad = { ...riviera, branches: riviera.branches!.map((b) => (b.id === 'stairs' ? { ...b, limit: 0 } : b)) };
      expect(validateLayout(bad, SURFACES, CLASSES).some((p) => p.level === 'error' && p.message.includes("stairs's limit"))).toBe(true);
    });

    test("read as on the arm just past its fork (as the fork flickers), the AI still follows the flight it chose from where it is on it", () => {
      for (const seed of [1, 2, 4]) {
        const sim = setup(track, CLASSES, SURFACES, { road: 'stairs', s: arm.fromS + 4 }, 'ai', { kmh: 80, seed });
        const on = driveRacer(sim, 0, sim.racers[0]!, neutralControls()).steer;
        const hit = newHit();
        projectGlobal(arm, sim.cars.x[0], sim.cars.z[0], hit);
        sim.cars.spline[0] = arm.index;
        sim.cars.s[0] = hit.s;
        sim.cars.lateral[0] = hit.lateral;
        const read = driveRacer(sim, 0, sim.racers[0]!, neutralControls()).steer;
        // (Following the flight from its start, it aimed 20 m back down it: the other way.)
        expect(Math.abs(read - on)).toBeLessThan(0.15);
      }
    });

    test('taken clean, both flights save 2-4 s on the road through the hairpins', () => {
      // Hard AI from the quay to past the top of the town, with and without the Stairs.
      const time = (t: typeof track) => {
        const sim = setup(t, CLASSES, SURFACES, { s: 560 }, 'ai', { kmh: 110, seed: 1 });
        let t0 = -1;
        const used = new Set<string>();
        for (let k = 0; k < 60 * 30; k++) {
          sim.step([]);
          used.add(t.splines[sim.cars.spline[0]].id);
          expect(sim.cars.wreck[0]).toBe(0);
          if (sim.cars.spline[0] === 0 && t0 < 0 && sim.cars.s[0] >= 620) t0 = sim.time;
          if (sim.cars.spline[0] === 0 && sim.cars.s[0] >= 1130 && sim.cars.s[0] < 1180) return { t: sim.time - t0, used };
        }
        throw new Error('never got there');
      };
      const road = time(bakeTrack({ ...riviera, branches: riviera.branches!.filter((b) => !b.id.startsWith('stairs')) }, SURFACES));
      const cut = time(track);
      expect([...cut.used]).toEqual(expect.arrayContaining(['stairs', 'stairs-top']));
      expect(road.t - cut.t).toBeGreaterThan(2);
      expect(road.t - cut.t).toBeLessThan(4);
    }, 60_000);
  });

  describe('Lighthouse Point and the Rocks (COASTAL step 7b)', () => {
    const rocks = track.splines.find((x) => x.id === 'rocks')!;
    const def = riviera.branches!.find((b) => b.id === 'rocks')!;

    test('a cut across the loop round the cape: off the main road and back, on the route, rough rock lined with boulders', () => {
      expect([rocks.fromRoad, rocks.toRoad]).toEqual([0, 0]);
      expect(track.graph.route.streets.map((k) => track.graph.streets[k].road)).toContain('rocks');
      // The loop it skips is nearly twice as long.
      expect(rocks.mainTo - rocks.mainFrom).toBeGreaterThan(1.8 * rocks.length);
      // (Rock between its ends: where it meets the road, the road's.)
      expect(new Set(Array.from(rocks.surface.slice(Math.round(20 / rocks.step), rocks.n - Math.round(20 / rocks.step))).map((k) => track.surfaces[k].id))).toEqual(new Set(['rock']));
      expect(def.heights).toBe('own');
      const boulders = track.props.filter((p) => p.kind === 'rock' && p.spline === rocks.index);
      expect(boulders.length).toBeGreaterThan(20);
      // Solid, and off it: beyond its verge on either side.
      for (const b of boulders) {
        expect(b.solid).toBe(true);
        const mid = rocks.n >> 1;
        expect(Math.abs(b.lateral) - b.hx).toBeGreaterThan(rocks.width[mid] / 2 + rocks.shoulder[mid]);
      }
      expect(boulders.some((b) => b.lateral < 0) && boulders.some((b) => b.lateral > 0)).toBe(true);
    });

    test('taken at its limit, the Rocks save 2-4 s clean; flat out, the ridges throw a hard coupe into the boulders', () => {
      const time = (t: typeof track, cls: string) => {
        const sim = setup(t, CLASSES, SURFACES, { s: 4560 }, 'ai', { kmh: 110, seed: 1, cls });
        let t0 = -1;
        let wrecked = false;
        const used = new Set<string>();
        for (let k = 0; k < 60 * 30; k++) {
          sim.step([]);
          used.add(t.splines[sim.cars.spline[0]].id);
          if (sim.cars.wreck[0]) wrecked = true;
          if (sim.cars.spline[0] === 0 && t0 < 0 && sim.cars.s[0] >= 4620) t0 = sim.time;
          if (sim.cars.spline[0] === 0 && sim.cars.s[0] >= 5100 && sim.cars.s[0] < 5150) return { t: sim.time - t0, used, wrecked };
        }
        throw new Error('never got there');
      };
      const without = (keep: (b: NonNullable<typeof riviera.branches>[number]) => unknown) => bakeTrack({ ...riviera, branches: riviera.branches!.filter(keep) }, SURFACES);
      const road = time(without((b) => b.id !== 'rocks'), 'coupe');
      const cut = time(track, 'coupe');
      expect(cut.used.has('rocks')).toBe(true);
      expect(cut.wrecked).toBe(false);
      expect(road.t - cut.t).toBeGreaterThan(2);
      expect(road.t - cut.t).toBeLessThan(4);
      // (No limit: flat out over the ridges.)
      const flat = bakeTrack({ ...riviera, branches: riviera.branches!.map((b) => (b.id === 'rocks' ? { ...b, limit: undefined } : b)) }, SURFACES);
      const flatOut = time(flat, 'coupe');
      expect(flatOut.used.has('rocks')).toBe(true);
      expect(flatOut.wrecked).toBe(true);
      // (It still gets there, but the wreck ate most of what the Rocks saved.)
      expect(road.t - flatOut.t).toBeLessThan(1);
    }, 60_000);
  });

  test('mostly blue skies: a shower one race in about seven (`rare`), against more than half on Paradise', () => {
    const showers = (allowed: string[]) => Array.from({ length: 400 }, (_, seed) => planWeather('random', seed + 1, allowed)).filter((p) => p.to > 0).length / 400;
    expect(map.weather).toContain('rare');
    expect(showers(map.weather)).toBeGreaterThan(0.08);
    expect(showers(map.weather)).toBeLessThan(0.22);
    expect(showers(['clear', 'rain', 'shower'])).toBeGreaterThan(0.5);
  });

  test('its music: the coastal track, then the ones for any map', () => {
    expect(playlistFor('coastal', false)).toEqual(['coastal', ...ANY_MAP]);
  });
});
