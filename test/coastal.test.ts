// Coastal (docs/COASTAL.md): a harbour town on a headland, built on Caldera from the start. Its
// first lap (COASTAL's step 2): the land in world space (the coast, and hills off the roads), the
// harbour bridge a deck over the harbour mouth, mostly blue skies, and its own music.

import { describe, expect, test } from 'bun:test';
import { playlistFor, ANY_MAP } from '../src/audio/soundtrack';
import type { MapDef } from '../src/core/content';
import { bakeTrack } from '../src/core/track/bake';
import { hillHeight } from '../src/core/track/features/hills';
import { newCast } from '../src/core/track/ground';
import { KIND_BEACH } from '../src/core/track/ground/surface';
import { newHit, offRoad, projectGlobal, sampleAt } from '../src/core/track/query';
import { planWeather } from '../src/core/world/weather';
import { run, setup } from '../src/dev/drive';
import { driveRacer, racingLine } from '../src/core/ai/racer';
import { neutralControls } from '../src/core/controls';
import { validateLayout } from '../src/core/track/validate';
import { ALL_MAPS } from '../tools/content';
import { CLASSES, SURFACES, layout } from './helpers';
import { InstancedMesh, Matrix4, Mesh, MeshBasicMaterial } from 'three';
import { buildLandmarks } from '../src/render/skins/greybox/landmarks';
import { buildOpenIsland } from '../src/render/skins/greybox/openIsland';
import { PALETTES } from '../src/render/skins/greybox/palettes';

const riviera = layout('coastal/riviera');
const track = bakeTrack(riviera, SURFACES);
const g = track.ground!;
const def = riviera.ground!;
const map = ALL_MAPS.find((m) => m.id === 'coastal') as MapDef;
const bridge = g.pieces.list.find((p) => p.id === 'harbour-bridge')!;

describe('coastal', () => {
  test('in the lobby as Riviera (the owner, 2026-10-05: out of experimental), one layout', () => {
    expect(map).toMatchObject({ name: 'Riviera', layouts: ['riviera'] });
    expect(map.experimental).toBeUndefined();
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

  test('the town two deep and more: a row each side of rue Haute up behind the waterfront, and on up the hill behind the casino; every house clear of every road', () => {
    // (The owner, 2026-10-06: "a second row of buildings and a back street behind the village", and
    // behind the casino "looks a little barren".)
    const haute = track.splines.find((sp) => sp.id === 'rue-haute')!;
    const port = track.splines.find((sp) => sp.id === 'rue-du-port')!;
    const hit = newHit();
    const sides = [0, 0];
    let behind = 0;
    for (const h of riviera.houses!) {
      // Every corner clear of every road (past a branch's end, from its end: offRoad).
      const fx = Math.sin(h.rot);
      const fz = Math.cos(h.rot);
      for (const [a, b] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        const x = h.at[0] + (a * h.size[0] * fz) / 2 + (b * h.size[1] * fx) / 2;
        const z = h.at[1] - (a * h.size[0] * fx) / 2 + (b * h.size[1] * fz) / 2;
        for (const sp of track.splines) {
          projectGlobal(sp, x, z, hit);
          expect(offRoad(sp, x, z, hit) - hit.width / 2 - hit.shoulder).toBeGreaterThan(sp.id.startsWith('stairs') ? 0.9 : 2.5);
        }
      }
      projectGlobal(haute, h.at[0], h.at[1], hit);
      if (hit.s > 1 && hit.s < haute.length - 1 && Math.abs(hit.lateral) < 20) sides[hit.lateral < 0 ? 0 : 1]++;
      projectGlobal(track.main, h.at[0], h.at[1], hit);
      const behindPort = (() => {
        const m = { ...hit };
        projectGlobal(port, h.at[0], h.at[1], hit);
        return m.s > 10 && m.s < 170 && m.lateral < 0 && -m.lateral > 80 && hit.s > 1 && hit.s < port.length - 1;
      })();
      if (behindPort) behind++;
    }
    // (Uphill, its own row; below it, the waterfront's back rows reach up to it too.)
    expect(sides[0]).toBeGreaterThan(20);
    expect(sides[1]).toBeGreaterThan(8);
    expect(behind).toBeGreaterThan(30);
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

  test('into the Rock Tunnel off line, at an angle: nobody thrown up off its road at the mouths, nor onto the hill over it', () => {
    const tunnel = g.pieces.list.find((p) => p.id === 'rock-tunnel')!;
    const hit = newHit();
    const controls = neutralControls();
    controls.throttle = 1;
    let high = -Infinity;
    let pop = 0;
    for (const up of [true, false])
      for (const back of [15, 30, 50])
        for (const lateral of [-6, -3, 3, 6])
          for (const angle of [-40, -15, -8, 8, 15, 40])
            for (const kmh of [60, 120, 180]) {
              const sim = setup(track, CLASSES, SURFACES, up ? { s: tunnel.s[0] - back, lateral } : { s: tunnel.s[1] + back, lateral, reverse: true }, {}, { kmh });
              const c = sim.cars;
              c.h[0] += (angle * Math.PI) / 180;
              c.ph[0] = c.h[0];
              c.vx[0] = (Math.sin(c.h[0]) * kmh) / 3.6;
              c.vz[0] = (Math.cos(c.h[0]) * kmh) / 3.6;
              for (let k = 0; k < 240; k++) {
                const [y, wrecked] = [c.y[0], c.wreck[0]];
                sim.step([controls]);
                // (A respawn puts a wrecked car back on the road: not thrown. Wrecking is: up into the rock.)
                if (!wrecked) pop = Math.max(pop, c.y[0] - y);
                if (c.spline[0] !== 0 || c.s[0] < tunnel.s[0] - 5 || c.s[0] > tunnel.s[1] + 5 || Math.abs(c.lateral[0]) > 20) continue;
                sampleAt(track.main, c.s[0], hit);
                high = Math.max(high, c.y[0] - hit.cy);
              }
            }
    // Its front wheels read the rock over the mouth, not its road: thrown 3–6 m up in a tick, then
    // flying over its walls inside, out into the rock and onto the hill, 25–37 m up. Off the road by
    // a mouth, a car may hop the slope beside it, 8 m up at most.
    expect(pop).toBeLessThan(2);
    expect(high).toBeLessThan(12);
  }, 120_000);

  test('on the hill over the Rock Tunnel, cars stay on the hill: none sink through the rock into it', () => {
    const tunnel = g.pieces.list.find((p) => p.id === 'rock-tunnel')!;
    const hit = newHit();
    const cast = newCast();
    const controls = neutralControls();
    controls.throttle = 0.6;
    let runs = 0;
    let sunk = 0;
    for (let s = tunnel.s[0] - 20; s <= tunnel.s[1] + 20; s += 30)
      for (const lateral of [-40, -25, 25, 40])
        for (let heading = 0; heading < 360; heading += 45)
          for (const kmh of [20, 50]) {
            sampleAt(track.main, s, hit);
            const [x, z] = [hit.cx - hit.tz * lateral, hit.cz + hit.tx * lateral];
            const sim = setup(track, CLASSES, SURFACES, { x, z, heading }, {}, { kmh });
            const c = sim.cars;
            runs++;
            for (let k = 0; k < 180; k++) sim.step([controls]);
            g.cast(c.x[0], c.y[0], c.z[0], cast);
            if (cast.space === 'enclosed' && cast.ground > c.y[0] + 3 && !c.wreck[0]) sunk++;
          }
    // (Reading the tunnel's road from anywhere over it, 3029 of a sweep like this sank in; before
    // that 35 did, by the old rock faces' gaps. A handful left, at the mouths' corners.)
    expect(runs).toBeGreaterThan(400);
    expect(sunk).toBeLessThanOrEqual(3);
  }, 120_000);

  test("out of the Rock Tunnel down its middle, at any speed, no step at its mouths (the ground meets its floor)", () => {
    const tunnel = g.pieces.list.find((p) => p.id === 'rock-tunnel')!;
    for (const [s, reverse] of [[tunnel.s[1] - 20, false], [tunnel.s[0] + 20, true]] as const)
      for (const kmh of [40, 50, 60, 70, 90, 120]) {
        const sim = setup(track, CLASSES, SURFACES, { s, reverse }, { throttle: 0.3 }, { kmh });
        const d = run(sim, { throttle: 0.3 }, 2, 1);
        // (A rock face's knock has no side, b 0; unsteered, past the mouth a car may graze a side wall.)
        expect(d.events.filter((e) => e.type === 'wall_hit' && /b 0$/.test(e.detail))).toEqual([]);
      }
  });

  test("in the Rock Tunnel the ground over its road stands clear of it (drawn, it's cut away, not a slab across the tunnel), and out of it meets the road", () => {
    const tunnel = g.pieces.list.find((p) => p.id === 'rock-tunnel')!;
    const hit = newHit();
    // (Two grid cells in from its ends: in the last it's the road's height, so as not to blend into the
    // ground out of the tunnel, where there's no floor: a hop off its end.)
    for (let s = tunnel.s[0] + 2 * g.cell; s <= tunnel.s[1] - 2 * g.cell; s += 0.5)
      for (const lateral of [-6, 0, 6]) {
        sampleAt(track.main, s, hit);
        const road = hit.cy - lateral * Math.tan(hit.bank);
        expect(g.height(hit.cx - hit.tz * lateral, hit.cz + hit.tx * lateral) - road).toBeGreaterThan(0.25);
      }
    // 3 m out of each mouth, within a few centimetres of the road (a step there was a wall).
    for (const s of [tunnel.s[0] - 3, tunnel.s[1] + 3]) {
      sampleAt(track.main, s, hit);
      expect(Math.abs(g.height(hit.cx, hit.cz) - hit.cy)).toBeLessThan(0.05);
    }
  });

  test('through the Rock Tunnel on the AI, every class leaves the ground once at each mouth at most (no hop off its ends)', () => {
    const tunnel = g.pieces.list.find((p) => p.id === 'rock-tunnel')!;
    for (const cls of ['coupe', 'rally', 'bus']) {
      const sim = setup(track, CLASSES, SURFACES, { s: tunnel.s[0] - 50 }, 'ai', { cls });
      const d = run(sim, 'ai', 9, 1);
      const takeoffs = d.events.filter((e) => e.type === 'takeoff' && e.t > 0.1);
      // (One at each mouth: the road's own crest into it, and out.)
      expect(takeoffs.length).toBeLessThanOrEqual(2);
      expect(d.summary.airSeconds).toBeLessThan(0.5);
    }
  }, 60_000);

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

    test('heading for the Stairs, a car keeps the road\'s pace until it must brake for them', () => {
      // (The first lap's pack ran into a car that had chosen the Stairs: 65 m short of them it slowed
      // to their limit straight away.)
      const sim = setup(track, CLASSES, SURFACES, { s: 560 }, 'ai', { kmh: 110, seed: 1 });
      const c = sim.cars;
      let at650 = 0;
      let took = false;
      for (let k = 0; k < 60 * 5; k++) {
        sim.step([]);
        if (c.spline[0] === stairs.index) took = true;
        if (c.spline[0] === 0 && c.s[0] >= 650 && !at650) at650 = Math.hypot(c.vx[0], c.vz[0]) * 3.6;
      }
      expect(took).toBe(true);
      expect(c.wrecks[0]).toBe(0);
      // 41 m short of the fork: still at the road's pace (it was down to 95 km/h).
      expect(at650).toBeGreaterThan(130);
    }, 30_000);
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

    test('taken at its limit, the Rocks save every class 2-4 s clean; flat out, the ridges throw most into the boulders', () => {
      const time = (t: typeof track, cls: string) => {
        // (From 60 m before its fork to 41 m past its end, as measured: from the chicane's way out.)
        const sim = setup(t, CLASSES, SURFACES, { s: rocks.mainFrom - 120 }, 'ai', { kmh: 110, seed: 1, cls });
        let t0 = -1;
        let wrecked = false;
        let used = false;
        for (let k = 0; k < 60 * 30; k++) {
          sim.step([]);
          if (t.splines[sim.cars.spline[0]].id === 'rocks') used = true;
          if (sim.cars.wreck[0]) wrecked = true;
          if (sim.cars.spline[0] === 0 && t0 < 0 && sim.cars.s[0] >= rocks.mainFrom - 60) t0 = sim.time;
          if (sim.cars.spline[0] === 0 && sim.cars.s[0] >= rocks.mainTo + 41 && sim.cars.s[0] < rocks.mainTo + 90) return { t: sim.time - t0, used, wrecked };
        }
        throw new Error('never got there');
      };
      const road = bakeTrack({ ...riviera, branches: riviera.branches!.filter((b) => b.id !== 'rocks') }, SURFACES);
      // (No limit: flat out over the ridges.)
      const flat = bakeTrack({ ...riviera, branches: riviera.branches!.map((b) => (b.id === 'rocks' ? { ...b, limit: undefined } : b)) }, SURFACES);
      let thrown = 0;
      for (const c of CLASSES) {
        const base = time(road, c.id).t;
        const cut = time(track, c.id);
        expect([c.id, cut.used, cut.wrecked]).toEqual([c.id, true, false]);
        expect(base - cut.t).toBeGreaterThan(2);
        expect(base - cut.t).toBeLessThan(4);
        if (time(flat, c.id).wrecked) thrown++;
      }
      expect(thrown).toBeGreaterThanOrEqual(CLASSES.length / 2);
    }, 120_000);
  });

  describe('the cove and the Sand (COASTAL step 7c)', () => {
    const sand = track.splines.find((x) => x.id === 'sand')!;
    const def = riviera.branches!.find((b) => b.id === 'sand')!;

    test('a cut along the beach past the club: off the main road and back, on the route, packed sand on the cove\'s beach, umbrellas by the sea', () => {
      expect([sand.fromRoad, sand.toRoad]).toEqual([0, 0]);
      expect(track.graph.route.streets.map((k) => track.graph.streets[k].road)).toContain('sand');
      // The road round the club is the long way.
      expect(sand.mainTo - sand.mainFrom).toBeGreaterThan(1.3 * sand.length);
      expect(new Set(Array.from(sand.surface.slice(Math.round(20 / sand.step), sand.n - Math.round(20 / sand.step))).map((k) => track.surfaces[k].id))).toEqual(new Set(['beach']));
      expect(def.heights).toBe('own');
      // Down at the beach in its middle, a few metres over the sea; beach either side of it.
      const hit = newHit();
      sampleAt(sand, sand.length / 2, hit);
      expect(hit.cy).toBeLessThan(5);
      for (const lat of [-12, 12]) expect(g.kindAt(hit.cx - hit.tz * lat, hit.cz + hit.tx * lat)).toBe(KIND_BEACH);
      // Beach umbrellas on its sea side (west, in the cove), a row of them.
      const row = riviera.smashables!.find((d) => d.kind === 'beach-umbrella' && d.spline === 'sand')!;
      expect((row.s[1] - row.s[0]) / row.every).toBeGreaterThan(6);
      for (const u of [row.s[0], row.s[1]]) {
        sampleAt(sand, u, hit);
        const lat = (row.side ?? 1) * (hit.width / 2 + row.lateral!);
        expect(hit.cx - hit.tz * lat).toBeLessThan(hit.cx - 4);
      }
      const on = newHit();
      // The club inside the chicane: the road round it on three sides.
      const club = riviera.houses!.find((h) => Math.hypot(h.at[0] + 690, h.at[1] - 85) < 1)!;
      expect(club).toBeDefined();
      // The road round it to its north, east and south (the chicane), within 50 m.
      const loop: [number, number][] = [];
      for (let u = sand.mainFrom; u < sand.mainTo; u += 2) loop.push((sampleAt(track.main, u, on), [on.cx - club.at[0], on.cz - club.at[1]]));
      const near = loop.filter(([dx, dz]) => Math.hypot(dx, dz) < 50);
      expect([near.some(([, dz]) => dz < -20), near.some(([dx]) => dx > 20), near.some(([, dz]) => dz > 20)]).toEqual([true, true, true]);
    });

    test('taken, the Sand saves every class 1.5-3.5 s on the road round the club, clean and on the ground', () => {
      const time = (t: typeof track, cls: string) => {
        const sim = setup(t, CLASSES, SURFACES, { s: sand.mainFrom - 300 }, 'ai', { kmh: 110, seed: 1, cls });
        let t0 = -1;
        let wrecked = false;
        let used = false;
        let air = 0;
        for (let k = 0; k < 60 * 30; k++) {
          sim.step([]);
          if (t.splines[sim.cars.spline[0]].id === 'sand') used = true;
          if (t.splines[sim.cars.spline[0]].id === 'sand' && !sim.cars.grounded[0]) air += 1 / 60;
          if (sim.cars.wreck[0]) wrecked = true;
          if (sim.cars.spline[0] === 0 && t0 < 0 && sim.cars.s[0] >= sand.mainFrom - 100) t0 = sim.time;
          // (Short of the Rocks' fork, 27 m past its end.)
          if (sim.cars.spline[0] === 0 && sim.cars.s[0] >= sand.mainTo + 15 && sim.cars.s[0] < sand.mainTo + 60) return { t: sim.time - t0, used, wrecked, air };
        }
        throw new Error('never got there');
      };
      const road = bakeTrack({ ...riviera, branches: riviera.branches!.filter((b) => b.id !== 'sand') }, SURFACES);
      for (const c of CLASSES) {
        const base = time(road, c.id);
        const cut = time(track, c.id);
        expect([c.id, cut.used, cut.wrecked, base.wrecked]).toEqual([c.id, true, false, false]);
        // On the ground the whole way: off the road onto the beach it once threw every class 40 m.
        expect([c.id, cut.air < 0.15]).toEqual([c.id, true]);
        expect([c.id, base.t - cut.t > 1.5, base.t - cut.t < 3.5]).toEqual([c.id, true, true]);
      }
    }, 120_000);
  });

  describe("the Descent's hillside (COASTAL step 8c)", () => {
    const bushes = riviera.smashables!.find((d) => d.kind === 'bush')!.at!;
    const rocks = track.props.filter((p) => p.kind === 'rock' && p.spline === 0);

    test('rocks and bushes over it, all well off every road (the AI never meets them) and off its steep banks', () => {
      expect(rocks.length).toBeGreaterThan(60);
      expect(bushes.length).toBeGreaterThan(100);
      const hit = newHit();
      for (const [x, z, r] of [...rocks.map((p) => [p.x, p.z, p.hx * 2]), ...bushes.map(([x, z]) => [x, z, 1.1])]) {
        for (const sp of track.splines) {
          projectGlobal(sp, x, z, hit);
          // (By the distance to where it's nearest: off a street's end its lateral is across the street's line.)
          expect(Math.hypot(x - hit.cx, z - hit.cz)).toBeGreaterThan(hit.width / 2 + hit.shoulder + 3 + r / 2);
        }
        const e = g.cell;
        expect(Math.hypot(g.height(x + e, z) - g.height(x - e, z), g.height(x, z + e) - g.height(x, z - e)) / (2 * e)).toBeLessThan(0.8);
      }
      // Each rock stands on the ground where it is (not on the road it's placed by).
      for (const p of rocks) expect(p.y).toBeCloseTo(g.top(p.x, p.z), 3);
    });

    test('cutting straight down it from a row, half the time you meet a bush or a rock, and can wreck on one', () => {
      let smashed = 0;
      let wrecked = 0;
      let met = 0;
      const lanes = Array.from({ length: 16 }, (_, k) => -600 + k * 10);
      for (const x of lanes) {
        const sim = setup(track, CLASSES, SURFACES, { x, z: -432, heading: 0 }, { throttle: 0.6 }, { kmh: 90 });
        const d = run(sim, { throttle: 0.6 }, 5, 1 / 60);
        if (d.events.some((e) => e.type === 'smash')) smashed++;
        // (On a rock, not a tree: 'prop' is both. Where it wrecked, by the trace's row then, beside one.)
        const on = d.summary.wrecks.filter((w) => w.cause === 'prop').map((w) => d.rows.reduce((a, b) => (Math.abs(b.t - w.t) < Math.abs(a.t - w.t) ? b : a)));
        if (on.some((at) => rocks.some((p) => Math.hypot(p.x - at.x, p.z - at.z) < p.hx + 4))) wrecked++;
        // (The hillside's own: a bush, or a rock. Trees by the next row's road are there without it.)
        if (d.events.some((e) => e.type === 'smash') || on.some((at) => rocks.some((p) => Math.hypot(p.x - at.x, p.z - at.z) < p.hx + 4))) met++;
      }
      // (Thinned since: the owner, 2026-10-05, "a little too littered". Still, half the cuts meet a bush or a rock.)
      expect(smashed).toBeGreaterThanOrEqual(2);
      expect(wrecked).toBeGreaterThanOrEqual(2);
      expect(met).toBeGreaterThanOrEqual(lanes.length / 2);
    }, 60_000);
  });

  describe("the hotel off the boulevard (COASTAL step 8g)", () => {
    const k = riviera.houses!.findIndex((h) => h.look === 'hotel');
    const h = riviera.houses![k];
    const pins = track.splines.find((sp) => sp.id === 'rue-des-pins')!;

    test('rue-des-pins runs under its terrace, 20 m and more of it, with room over a car', () => {
      expect(k).toBeGreaterThanOrEqual(0);
      const p = h.porch!;
      const y = track.props.filter((q) => q.kind === 'house')[k].y;
      let under = 0;
      for (let i = 0; i < pins.n; i++) {
        // Where the street's middle is, in the hotel's own frame (its front toward +z).
        const [dx, dz] = [pins.px[i] - h.at[0], pins.pz[i] - h.at[1]];
        const lx = dx * Math.cos(h.rot) - dz * Math.sin(h.rot);
        const lz = dx * Math.sin(h.rot) + dz * Math.cos(h.rot);
        if (Math.abs(lx) > p.width / 2 || lz < h.size[1] / 2 || lz > h.size[1] / 2 + p.depth) continue;
        under += pins.step;
        // The street's whole width under it (its verge short of the columns' line and the front wall).
        expect(lz - pins.width[i] / 2 - pins.shoulder[i]).toBeGreaterThan(h.size[1] / 2);
        expect(lz + pins.width[i] / 2 + pins.shoulder[i]).toBeLessThan(h.size[1] / 2 + p.depth - 1);
        expect(y + p.high - pins.py[i]).toBeGreaterThan(5);
      }
      expect(under).toBeGreaterThan(20);
    });

    test('its columns are solid: off every road, but drive into one and you wreck', () => {
      const cols = track.props.filter((q) => q.kind === 'house-column');
      expect(cols.length).toBe(h.porch!.columns);
      expect(validateLayout(riviera, SURFACES, CLASSES).filter((q) => q.message.includes('porch'))).toEqual([]);
      const c = cols[1];
      // From 20 m off, toward the boulevard's side of it, square on.
      const [ax, az] = [Math.sin(h.rot), Math.cos(h.rot)];
      const d = run(setup(track, CLASSES, SURFACES, { x: c.x + ax * 20, z: c.z + az * 20, heading: (Math.atan2(-ax, -az) * 180) / Math.PI }, { throttle: 1 }, { kmh: 100 }), { throttle: 1 }, 3, 1 / 60);
      // (On the column: where it wrecked, by the trace's row then.)
      const at = d.summary.wrecks.filter((w) => w.cause === 'prop').map((w) => d.rows.reduce((a, b) => (Math.abs(b.t - w.t) < Math.abs(a.t - w.t) ? b : a)));
      expect(at.some((r) => Math.hypot(r.x - c.x, r.z - c.z) < 4)).toBe(true);
    }, 30_000);
  });

  describe('landmarks (COASTAL step 8a)', () => {
    test('the grand casino: a solid block on the boulevard just past the line, facing it, its garden and fountain clear of houses', () => {
      const houses = riviera.houses!;
      const k = houses.findIndex((h) => h.look === 'casino');
      expect(k).toBeGreaterThanOrEqual(0);
      const c = houses[k];
      const hit = newHit();
      projectGlobal(track.main, c.at[0], c.at[1], hit);
      expect(hit.s).toBeGreaterThan(60);
      expect(hit.s).toBeLessThan(120);
      // Facing the road: its front (+z turned by rot) toward the road's middle.
      const [fx, fz] = [Math.sin(c.rot), Math.cos(c.rot)];
      expect((hit.cx - c.at[0]) * fx + (hit.cz - c.at[1]) * fz).toBeGreaterThan(0);
      // Solid, as every house.
      expect(track.props.filter((p) => p.kind === 'house')[k].solid).toBe(true);
      const fountain = riviera.landmarks!.find((m) => m.kind === 'fountain')!;
      // Clear of every house's box, the casino's too, by 2 m past the fountain's plaza.
      for (const h of houses) {
        const [dx, dz] = [fountain.at[0] - h.at[0], fountain.at[1] - h.at[1]];
        const lx = dx * Math.cos(h.rot) - dz * Math.sin(h.rot);
        const lz = dx * Math.sin(h.rot) + dz * Math.cos(h.rot);
        expect(Math.hypot(Math.max(0, Math.abs(lx) - h.size[0] / 2), Math.max(0, Math.abs(lz) - h.size[1] / 2))).toBeGreaterThan(fountain.params!.r + 2);
      }
    });

    test("rue-du-port's corners round the casino's square are wide enough for the traffic", () => {
      const sp = track.splines.find((s) => s.id === 'rue-du-port')!;
      const w = Math.round(3 / sp.step);
      for (let i = w; i < sp.n - w; i++) {
        const turn = Math.hypot(sp.tx[i + w] - sp.tx[i - w], sp.tz[i + w] - sp.tz[i - w]);
        expect((2 * w * sp.step) / turn).toBeGreaterThan(10);
      }
    });

    test("the lighthouse inside the cape's loop, and the fort on the mountain's top; no trees on either", () => {
      const light = riviera.landmarks!.find((m) => m.kind === 'lighthouse')!;
      const fort = riviera.landmarks!.find((m) => m.kind === 'fort')!;
      expect(light && fort).toBeTruthy();
      // The fort on the highest ground for 60 m round.
      const top = g.height(fort.at[0], fort.at[1]);
      for (let a = 0; a < 8; a++) expect(g.height(fort.at[0] + 30 * Math.cos(a), fort.at[1] + 30 * Math.sin(a))).toBeLessThanOrEqual(top + 0.5);
      expect(top).toBeGreaterThan(150);
      const pines = track.pines!;
      // As far out as the fort's drawn (its bastions' tips, 47 m out on the diagonals): every tree.
      expect(fort.r).toBeGreaterThanOrEqual((fort.params!.size / 2) * Math.SQRT2 + 7.8);
      for (const m of [light, fort]) for (let k = 0; k < pines.n; k++) expect(Math.hypot(pines.x[k] - m.at[0], pines.z[k] - m.at[1])).toBeGreaterThanOrEqual(m.r);
      expect(validateLayout(riviera, SURFACES, CLASSES).filter((p) => p.message.includes('landmark'))).toEqual([]);
    });
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

describe("coastal's look (COASTAL's step 8)", () => {
  test('its own palettes: a deep blue sea, by day and at sunset', () => {
    expect(map).toMatchObject({ palette: 'riviera', sunset: 'riviera-sunset' });
    for (const p of [PALETTES.riviera, PALETTES['riviera-sunset']]) expect(p.sea).toBeDefined();
    expect(PALETTES.tropic.sea).toBeUndefined();
  });

  test('its trees are umbrella pines, holm oaks and cypresses, no palms, each drawn over its collider', () => {
    // (The trees' four meshes first, then the promenade's.)
    const drawn = buildOpenIsland(track, PALETTES.riviera, 1).objects.filter((o): o is InstancedMesh => o instanceof InstancedMesh).slice(0, 4);
    // Every tree has a trunk or is a cypress, and every trunk has a crown.
    const counts = drawn.map((m) => m.count);
    const [trunks, pines, oaks, cypresses] = counts;
    expect(pines + oaks).toBe(trunks);
    expect(trunks + cypresses).toBe(track.pines!.n);
    expect(Math.min(pines, oaks, cypresses)).toBeGreaterThan(100);
    // Each trunk stands where a tree's collider does.
    const m = new Matrix4();
    const at = new Set(Array.from({ length: track.pines!.n }, (_, k) => `${track.pines!.x[k].toFixed(2)},${track.pines!.z[k].toFixed(2)}`));
    for (let k = 0; k < trunks; k++) {
      drawn[0].getMatrixAt(k, m);
      expect(at.has(`${m.elements[12].toFixed(2)},${m.elements[14].toFixed(2)}`)).toBe(true);
    }
  });

  test('the promenade: palms and lamp posts along the sea wall, behind its parapet (where no car reaches)', () => {
    // Its palms' trunks and fronds, the lamps' posts, arms and lanterns (after the trees' four).
    const [palms, , posts] = buildOpenIsland(track, PALETTES.riviera, 1).objects.filter((o): o is InstancedMesh => o instanceof InstancedMesh).slice(4);
    const m = new Matrix4();
    const hit = newHit();
    for (const mesh of [palms, posts]) {
      expect(mesh.count).toBeGreaterThan(20);
      for (let k = 0; k < mesh.count; k++) {
        mesh.getMatrixAt(k, m);
        projectGlobal(track.main, m.elements[12], m.elements[14], hit);
        // Past the verge and the parapet's 0.9 m, on the sea side.
        expect(hit.lateral).toBeGreaterThan(hit.width / 2 + hit.shoulder + 0.9);
      }
    }
  });

  test("the lighthouse's beam sweeps at sunset, not by day", () => {
    // (Its lamp's glow is drawn on a canvas: a stand-in for the page's.)
    const ctx = { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} };
    (globalThis as { document?: unknown }).document ??= { createElement: () => ({ getContext: () => ctx }) };
    const beam = (day: boolean) => {
      // (The lighthouse alone: the fountain's glow needs a page.)
      const lh = buildLandmarks({ ...riviera, landmarks: riviera.landmarks!.filter((m) => m.kind === 'lighthouse') }, () => 0, day).objects[0];
      return lh.children.filter((c) => c instanceof Mesh && c.material instanceof MeshBasicMaterial).map((c) => c.visible);
    };
    expect(beam(false)).toEqual([true]);
    expect(beam(true)).toEqual([false]);
  });
});
