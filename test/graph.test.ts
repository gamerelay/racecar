// The road graph (docs/CALDERA.md, step 6a; core/track/graph.ts): every map's roads as streets
// between nodes, and its race as a route through them, its checkpoints gates on streets. Built
// alongside what drives today: nothing in the sim reads it yet.

import { describe, expect, test } from 'bun:test';
import { bakeTrack, mainDistance, type Track } from '../src/core/track/bake';
import { newHit, projectGlobal, sampleAt } from '../src/core/track/query';
import type { TrackLayout } from '../src/core/content';
import { validateLayout } from '../src/core/track/validate';
import { locateCar } from '../src/core/track/locate';
import { setup } from '../src/dev/drive';
import { Ev } from '../src/core/events';
import { wayCosts } from '../src/core/ai/racer';
import { LANE_FROM, LANE_TO, laneLayout } from './fixtures-lane';
import { CLASSES, SURFACES, layout } from './helpers';

const MAPS = ['coastal/riviera', 'downtown/downtown', 'backroads/valley', 'paradise/island', 'paradise-open/open', 'avalanche/slope'];
const tracks = new Map<string, Track>(MAPS.map((k) => [k, bakeTrack(layout(k), SURFACES)]));

describe('the road graph', () => {
  test('the main road is cut into streets end to end, at every node on it, none wrapping', () => {
    for (const [key, t] of tracks) {
      const g = t.graph;
      const main = g.streets.filter((s) => s.spline === 0).sort((a, b) => a.s0 - b.s0);
      expect([key, main[0].s0]).toEqual([key, 0]);
      expect(main[main.length - 1].s1).toBeCloseTo(t.main.length, 6);
      for (let k = 1; k < main.length; k++) {
        expect(main[k].s0).toBe(main[k - 1].s1);
        // One street's end is the next one's start.
        expect(main[k].from).toBe(main[k - 1].to);
      }
      for (const s of g.streets) expect(s.s1).toBeGreaterThan(s.s0);
      // A lap's last street comes back to the line; a run's ends are ends.
      if (t.main.closed) expect(g.nodes[main[main.length - 1].to].kind === 'line' || g.nodes[main[main.length - 1].to].kind === 'junction').toBe(true);
      else expect([g.nodes[main[0].from].kind, g.nodes[main[main.length - 1].to].kind]).toEqual(['end', 'end']);
    }
  });

  test('each branch is one street, between the junctions where it leaves and rejoins, and they are where it does', () => {
    const hit = newHit();
    for (const [key, t] of tracks)
      for (const sp of t.splines.slice(1)) {
        const mine = t.graph.streets.filter((s) => s.spline === sp.index);
        expect([key, sp.id, mine.length]).toEqual([key, sp.id, 1]);
        const [st] = mine;
        expect([st.s0, st.s1]).toEqual([0, sp.length]);
        for (const [n, s] of [
          [st.from, 0],
          [st.to, sp.length],
        ] as const) {
          const node = t.graph.nodes[n];
          expect(node.kind).toBe('junction');
          sampleAt(sp, s, hit);
          expect(Math.hypot(node.x - hit.cx, node.z - hit.cz)).toBeLessThan(1.5);
        }
      }
  });

  test('every street leaves its node and comes into the next: a closed map has no dead ends', () => {
    for (const [, t] of tracks) {
      const g = t.graph;
      for (const s of g.streets) {
        expect(g.nodes[s.from].out).toContain(s.index);
        expect(g.nodes[s.to].in).toContain(s.index);
      }
      if (t.main.closed) for (const n of g.nodes) expect([n.in.length > 0, n.out.length > 0]).toEqual([true, true]);
    }
  });

  test('the route: a lap round the main road, its gates the checkpoints and then the finish, on its streets', () => {
    const hit = newHit();
    for (const [key, t] of tracks) {
      const r = t.graph.route;
      expect([key, r.closed]).toEqual([key, t.main.closed && !t.run]);
      expect(r.gates.map((x) => x.s)).toEqual([...t.checkpoints, t.run ? t.run.finish : t.main.length]);
      expect(r.gates.filter((x) => x.finish).length).toBe(1);
      expect(r.gates[r.gates.length - 1].finish).toBe(true);
      for (const x of r.gates) {
        const st = t.graph.streets[x.street];
        expect(r.way).toContain(x.street);
        expect(x.s).toBeGreaterThanOrEqual(st.s0);
        expect(x.s).toBeLessThanOrEqual(st.s1);
        sampleAt(t.main, x.s, hit);
        expect([x.x, x.z]).toEqual([hit.cx, hit.cz]);
        expect(x.half).toBeGreaterThan(hit.width / 2);
      }
      // Its way: the main road's streets in order from its start to its finish, adding up to the race.
      const sts = r.way.map((k) => t.graph.streets[k]);
      for (let k = 1; k < sts.length; k++) expect(sts[k].s0).toBe(sts[k - 1].s1);
      expect([sts[0].from, sts[sts.length - 1].to]).toEqual([r.start, r.finish]);
      expect(sts.reduce((a, s) => a + s.length, 0)).toBeCloseTo(r.length, 6);
      expect(r.length).toBeCloseTo(t.run ? t.run.finish - t.run.start : t.main.length, 6);
      // Each node on it as far along as its street says; a lap's line is its start and its finish.
      for (const st of sts) expect(r.at[st.from]).toBeCloseTo(st.s0 - (t.run?.start ?? 0), 6);
      if (r.closed) expect([r.start, r.finish, r.at[r.start]]).toEqual([t.graph.line, t.graph.line, 0]);
      // Every branch between two of its nodes is on it too, the other way between them; a side street isn't.
      for (const k of r.streets) {
        const st = t.graph.streets[k];
        expect([Number.isNaN(r.at[st.from]), Number.isNaN(r.at[st.to])]).toEqual([false, false]);
        if (st.spline > 0) expect(t.layout.branches!.find((b) => b.id === st.road)!.kind).not.toBe('street');
      }
    }
  });

  test("Coastal: the Basin Road the other way between the bridge's two junctions, and two side streets", () => {
    const t = tracks.get('coastal/riviera')!;
    const g = t.graph;
    const basin = g.streets.find((s) => s.road === 'basin-road')!;
    // The main road's street between the same two junctions: the bridge.
    const bridge = g.streets.filter((s) => s.spline === 0 && s.from === basin.from && s.to === basin.to);
    expect(bridge.length).toBe(1);
    expect(t.layout.pieces!.find((p) => p.id === 'harbour-bridge')!.s[0]).toBeGreaterThanOrEqual(bridge[0].s0);
    expect(g.streets.filter((s) => s.spline > 0).map((s) => s.road).sort()).toEqual(['basin-road', 'rue-des-pins', 'rue-du-port']);
    expect(g.nodes.filter((n) => n.kind === 'junction').length).toBe(6);
    // The Basin Road's a way round on the race's route; the side streets are traffic's.
    expect(g.route.streets.filter((k) => g.streets[k].spline > 0).map((k) => g.streets[k].road)).toEqual(['basin-road']);
  });

  test("Avalanche: a run, its start and finish nodes on the road, the road past them off its route", () => {
    const t = tracks.get('avalanche/slope')!;
    const g = t.graph;
    expect([g.line, g.nodes[g.route.start].kind, g.nodes[g.route.finish].kind]).toEqual([-1, 'start', 'finish']);
    expect(g.route.way.map((k) => [g.streets[k].s0, g.streets[k].s1])).toEqual([[t.run!.start, t.run!.finish]]);
    const off = g.streets.filter((s) => !g.route.streets.includes(s.index));
    expect(off.map((s) => [s.s0, s.s1])).toEqual([
      [0, t.run!.start],
      [t.run!.finish, t.main.length],
    ]);
  });

  test('the validator: a branch round the line (it would miss the finish) is an error', () => {
    const l = layout('backroads/valley');
    const L = tracks.get('backroads/valley')!.main.length;
    const errs = (x: TrackLayout) => validateLayout(x, SURFACES, CLASSES).filter((p) => p.level === 'error' && p.message.includes('across the line'));
    expect(errs(l)).toEqual([]);
    const round = { ...l, branches: l.branches!.map((b, k) => (k === 0 ? { ...b, from: L - 60, to: 80 } : b)) };
    expect(errs(round).length).toBe(1);
  }, 30_000);

  test('streetAt: the stretch holding a spot, and none off its road', () => {
    for (const [, t] of tracks)
      for (const s of t.graph.streets) {
        const mid = (s.s0 + s.s1) / 2;
        expect(t.graph.streetAt(s.spline, mid)).toBe(s.index);
        expect(t.graph.streetAt(s.spline, -5)).toBe(-1);
      }
  });

  test("each road's links: at every node, every other road there, and where it is on each", () => {
    for (const [, t] of tracks) {
      const g = t.graph;
      for (const [a, links] of g.links.entries())
        for (const l of links) {
          // The same node, seen from the other road.
          expect(g.links[l.other].some((m) => m.node === l.node && m.other === a && m.s === l.os && m.os === l.s)).toBe(true);
          const n = g.nodes[l.node];
          const hit = sampleAt(t.splines[a], l.s, newHit());
          expect(Math.hypot(n.x - hit.cx, n.z - hit.cz)).toBeLessThan(1.5);
        }
      // A branch onto the main road: its span there over its own length; the main road onto it, 1.
      for (const sp of t.splines.slice(1)) {
        for (const l of g.links[sp.index]) if (l.other === 0) expect(l.scale).toBeCloseTo((((sp.mainTo - sp.mainFrom) % t.main.length) + t.main.length) % t.main.length / sp.length, 9);
        for (const l of g.links[0]) expect(l.scale).toBe(1);
      }
    }
  });
});

describe('locate over the graph (6b)', () => {
  // Backroads with a second branch leaving where the barn shortcut rejoins (334 m), out 18 m to the
  // side and back at 500 m: two branches meeting at one junction, which the old locate (a branch
  // hands back to the main road only) couldn't go between.
  const base = layout('backroads/valley');
  const plain = tracks.get('backroads/valley')!;
  const hit = newHit();
  const side = [360, 390, 420, 450, 475].map((s) => {
    sampleAt(plain.main, s, hit);
    return { p: [hit.cx - hit.tz * 18, hit.cy, hit.cz + hit.tx * 18] as [number, number, number], width: 7, lanes: 1, shoulder: 1, surface: 'dirt' };
  });
  const two: TrackLayout = { ...base, branches: [...base.branches!, { id: 'byway', kind: 'shortcut', from: 334, to: 500, points: side }] };
  const t = bakeTrack(two, SURFACES);
  const barn = t.splines.find((sp) => sp.id === 'barn')!;
  const byway = t.splines.find((sp) => sp.id === 'byway')!;

  test('the two meet at one junction: each linked to the other there', () => {
    const at = t.graph.links[barn.index].filter((l) => l.other === byway.index);
    expect(at.length).toBe(1);
    expect([at[0].s, at[0].os]).toEqual([barn.length, 0]);
  });

  test('off the end of one, well onto the other: on the other, not handed back to the main road', () => {
    const sim = setup(t, CLASSES, SURFACES, { road: 'barn', s: barn.length - 5 }, 'ai');
    const { cars } = sim;
    const at = sampleAt(byway, 40, newHit());
    cars.spline[0] = barn.index;
    cars.s[0] = barn.length - 0.5;
    cars.x[0] = at.cx;
    cars.y[0] = at.cy;
    cars.z[0] = at.cz;
    locateCar(sim, 0);
    expect(cars.spline[0]).toBe(byway.index);
    expect(cars.s[0]).toBeCloseTo(40, 0);
    expect(Math.abs(cars.lateral[0])).toBeLessThan(0.5);
  });

  test('and back: off the start of the second, well onto the first, on the first', () => {
    const sim = setup(t, CLASSES, SURFACES, { road: 'byway', s: 5 }, 'ai');
    const { cars } = sim;
    const at = sampleAt(barn, barn.length - 40, newHit());
    cars.spline[0] = byway.index;
    cars.s[0] = 0.5;
    cars.x[0] = at.cx;
    cars.y[0] = at.cy;
    cars.z[0] = at.cz;
    locateCar(sim, 0);
    expect(cars.spline[0]).toBe(barn.index);
    expect(cars.s[0]).toBeCloseTo(barn.length - 40, 0);
  });

  test("a branch from the line: the main road's link there is at 0, first of its group", () => {
    const v = layout('backroads/valley');
    const atLine = bakeTrack({ ...v, branches: v.branches!.map((b, k) => (k === 0 ? { ...b, from: 0, to: 254 } : b)) }, SURFACES);
    const main = atLine.graph.links[0].filter((l) => l.other === 1);
    expect(main.map((l) => l.s)).toEqual([0, 254]);
  });
});

describe('progress along the route (6c)', () => {
  test("along(): on every road of every map, exactly the old main-road distance (from a run's start)", () => {
    for (const [key, t] of tracks) {
      const start = t.run?.start ?? 0;
      for (const sp of t.splines)
        for (let s = 0; s <= sp.length; s += 3.7) {
          const want = mainDistance(t, sp.index, s) - start;
          expect([key, sp.id, s, t.graph.along(sp.index, s)]).toEqual([key, sp.id, s, want]);
        }
    }
  });

  test('a run with branches, one past its finish: exactly the old distance, and never NaN', () => {
    const a = layout('avalanche/slope');
    const t0 = tracks.get('avalanche/slope')!;
    const fin = t0.run!.finish;
    const side = (from: number, to: number) =>
      [0.3, 0.5, 0.7].map((f) => {
        const h = sampleAt(t0.main, from + (to - from) * f, newHit());
        return { p: [h.cx - h.tz * 16, h.cy, h.cz + h.tx * 16] as [number, number, number], width: 7, lanes: 1, shoulder: 1, surface: 'powder' };
      });
    const t = bakeTrack({ ...a, branches: [{ id: 'gully', kind: 'shortcut', from: 2000, to: 2200, points: side(2000, 2200) }, { id: 'runout', kind: 'shortcut', from: fin + 20, to: fin + 180, points: side(fin + 20, fin + 180) }] }, SURFACES);
    for (const sp of t.splines.slice(1))
      for (let s = 0; s <= sp.length; s += 2.3) expect([sp.id, s, t.graph.along(sp.index, s)]).toEqual([sp.id, s, mainDistance(t, sp.index, s) - t.run!.start]);
  });

  test('where one node stands for two ends of roads under a metre apart, off by no more than that', () => {
    const v = layout('backroads/valley');
    // A second branch leaving 0.6 m after the barn shortcut does (80 m): one junction for both.
    const barn = v.branches![0];
    const t = bakeTrack({ ...v, branches: [...v.branches!, { ...barn, id: 'barn-2', from: barn.from + 0.6 }] }, SURFACES);
    const sp = t.splines.find((x) => x.id === 'barn-2')!;
    expect(t.graph.streets.find((st) => st.road === 'barn-2')!.from).toBe(t.graph.streets.find((st) => st.road === 'barn')!.from);
    for (let s = 0; s <= sp.length; s += 5) expect(Math.abs(t.graph.along(sp.index, s) - mainDistance(t, sp.index, s))).toBeLessThanOrEqual(0.6 + 1e-9);
  });

  test("the gates: each as far along the route as its checkpoint, the finish at the route's end", () => {
    for (const [, t] of tracks) {
      const start = t.run?.start ?? 0;
      const g = t.graph.route.gates;
      expect(g.slice(0, -1).map((x) => x.at)).toEqual(t.checkpoints.map((c) => c - start));
      expect(g[g.length - 1].at).toBeCloseTo(t.graph.route.length, 9);
    }
  });

  test("a race's laps and positions count the route's gates: a lap's checkpoints in order, then the line", () => {
    const t = tracks.get('coastal/riviera')!;
    const sim = setup(t, CLASSES, SURFACES, { s: t.main.length - 30 }, 'ai', { kmh: 120 });
    const seen: number[] = [];
    let cursor = sim.events.head;
    for (let k = 0; k < 60 * 110 && sim.cars.lap[0] < 1; k++) {
      sim.step([]);
      cursor = sim.events.read(cursor, (e) => {
        if (e.car === 0 && e.type === Ev.Checkpoint) seen.push(e.a);
      });
    }
    expect(seen).toEqual(t.graph.route.gates.slice(0, -1).map((_, k) => k));
    expect(sim.cars.lap[0]).toBe(1);
  }, 60_000);
});

describe('the AI picks its way by cost (6d)', () => {
  test("each street's time by the racing line; from each node the quickest on to the finish, 0 there", () => {
    for (const [key, t] of tracks) {
      const g = t.graph;
      const { time, toGo } = wayCosts(t);
      expect([key, toGo[g.route.finish]]).toEqual([key, 0]);
      for (const k of g.route.streets) {
        expect(time[k]).toBeGreaterThan(0);
        // Never more than going this way (it's the quickest).
        if (g.streets[k].from !== g.route.finish) expect(toGo[g.streets[k].from]).toBeLessThanOrEqual(time[k] + toGo[g.streets[k].to] + 1e-9);
      }
      // Every shortcut today is quicker than the main road it skips (so the roll decides, as before).
      for (const k of g.route.streets) {
        const st = g.streets[k];
        if (st.spline === 0 || t.layout.branches![st.spline - 1].kind !== 'shortcut') continue;
        const main = g.nodes[st.from].out.find((m) => g.streets[m].spline === 0)!;
        expect([key, st.road, time[k] < time[main] + toGo[g.streets[main].to] - toGo[st.to]]).toEqual([key, st.road, true]);
      }
    }
  });

  test('a shortcut that is slower than the road it skips: no driver takes it, however often it rolls', () => {
    // Backroads' barn shortcut dragged out into a long loop 120 m off the road: longer than the
    // 254 m of main road it skips, by a lot.
    const v = layout('backroads/valley');
    const plain = tracks.get('backroads/valley')!;
    const hit = newHit();
    const loop = [110, 160, 210, 260, 300].map((s, k) => {
      sampleAt(plain.main, s, hit);
      const out = 40 + 80 * Math.sin((Math.PI * (k + 0.5)) / 5);
      return { p: [hit.cx - hit.tz * out, hit.cy, hit.cz + hit.tx * out] as [number, number, number], width: 8, lanes: 1, shoulder: 1.5, surface: 'dirt' };
    });
    const t = bakeTrack({ ...v, branches: v.branches!.map((b, k) => (k === 0 ? { ...b, points: loop } : b)) }, SURFACES);
    const barn = t.splines.find((sp) => sp.id === 'barn')!;
    const { time, toGo } = wayCosts(t);
    const g = t.graph;
    const st = g.streets.find((x) => x.road === 'barn')!;
    const main = g.nodes[st.from].out.find((m) => g.streets[m].spline === 0)!;
    expect(time[st.index] + toGo[st.to]).toBeGreaterThan(time[main] + toGo[g.streets[main].to]);
    // (Where the loop leaves along the main road a car can read as on it a moment: the fork's
    // flicker. What matters is where it drives: never out onto the loop, and on past its end.)
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const sim = setup(t, CLASSES, SURFACES, { s: barn.mainFrom - 60 }, 'ai', { kmh: 90, seed });
      let widest = 0;
      for (let k = 0; k < 60 * 10; k++) {
        sim.step([]);
        projectGlobal(t.main, sim.cars.x[0], sim.cars.z[0], hit);
        widest = Math.max(widest, Math.abs(hit.lateral));
      }
      expect([seed, widest < 12]).toEqual([seed, true]);
      expect(sim.cars.spline[0]).toBe(0);
      expect(sim.cars.s[0]).toBeGreaterThan(barn.mainTo);
    }
  }, 60_000);
});


describe('branches off branches (6e)', () => {
  const t = bakeTrack(laneLayout(), SURFACES);
  const g = t.graph;
  const barn = t.splines.find((sp) => sp.id === 'barn')!;
  const lane = t.splines.find((sp) => sp.id === 'lane')!;

  test('the lane leaves the barn shortcut partway along: a junction there, the barn cut in two at it', () => {
    expect([lane.fromRoad, lane.fromS, lane.toRoad, lane.toS]).toEqual([barn.index, LANE_FROM, 0, LANE_TO]);
    const pieces = g.streets.filter((st) => st.spline === barn.index);
    expect(pieces.map((st) => [st.s0, st.s1])).toEqual([
      [0, LANE_FROM],
      [LANE_FROM, barn.length],
    ]);
    const x = pieces[0].to;
    expect([g.nodes[x].kind, pieces[1].from]).toEqual(['junction', x]);
    const st = g.streets.find((s) => s.road === 'lane')!;
    expect(st.from).toBe(x);
    // Its start where the barn's 110 m is; it ends on the main road at 480 m.
    const at = sampleAt(barn, LANE_FROM, newHit());
    expect(Math.hypot(g.nodes[x].x - at.cx, g.nodes[x].z - at.cz)).toBeLessThan(1e-9);
    expect(g.streets.find((s) => s.spline === 0 && s.from === st.to)!.s0).toBeCloseTo(LANE_TO, 6);
    // All three on the race's route, the junction on it too (as far along as it is through the barn).
    for (const s of [...pieces, st]) expect(g.route.streets).toContain(s.index);
    const [a, b] = [g.route.at[pieces[0].from], g.route.at[pieces[1].to]];
    expect(g.route.at[x]).toBeCloseTo(a + (LANE_FROM / barn.length) * (b - a), 9);
    // The barn and the lane linked at it, each where it is on the other.
    expect(g.links[barn.index].some((l) => l.other === lane.index && l.s === LANE_FROM && l.os === 0)).toBe(true);
    expect(g.links[lane.index].some((l) => l.other === barn.index && l.s === 0 && l.os === LANE_FROM)).toBe(true);
  });

  test('along(): on the barn as before (through the junction), on the lane from there to its end', () => {
    for (let s = 0; s <= barn.length; s += 2.9) expect(g.along(barn.index, s)).toBeCloseTo(mainDistance(t, barn.index, s), 9);
    let prev = -Infinity;
    for (let s = 0; s <= lane.length; s += 2.9) {
      const d = g.along(lane.index, s);
      expect(d).toBeGreaterThan(prev);
      prev = d;
    }
    expect(g.along(lane.index, 0)).toBeCloseTo(g.along(barn.index, LANE_FROM), 9);
    expect(g.along(lane.index, lane.length)).toBeCloseTo(LANE_TO, 6);
  });

  test('a car on the barn, out onto the lane: on the lane', () => {
    const sim = setup(t, CLASSES, SURFACES, { road: 'barn', s: LANE_FROM - 20 }, 'ai');
    const at = sampleAt(lane, 35, newHit());
    sim.cars.spline[0] = barn.index;
    sim.cars.s[0] = LANE_FROM + 20;
    sim.cars.x[0] = at.cx;
    sim.cars.y[0] = at.cy;
    sim.cars.z[0] = at.cz;
    locateCar(sim, 0);
    expect(sim.cars.spline[0]).toBe(lane.index);
    expect(sim.cars.s[0]).toBeCloseTo(35, 0);
  });

  test('the AI on the barn takes the lane where it is the quicker way on, and comes out on the main road', () => {
    const { time, toGo } = wayCosts(t);
    const st = g.streets.find((s) => s.road === 'lane')!;
    const rest = g.streets.find((s) => s.spline === barn.index && s.s0 === LANE_FROM)!;
    expect(time[st.index] + toGo[st.to]).toBeLessThan(time[rest.index] + toGo[rest.to]);
    const sim = setup(t, CLASSES, SURFACES, { road: 'barn', s: 20 }, 'ai', { kmh: 80 });
    let onLane = 0;
    let barnPast = 0;
    for (let k = 0; k < 60 * 12; k++) {
      sim.step([]);
      if (sim.cars.spline[0] === lane.index) onLane++;
      if (sim.cars.spline[0] === barn.index && sim.cars.s[0] > LANE_FROM + 40) barnPast++;
    }
    expect(onLane).toBeGreaterThan(60);
    expect(barnPast).toBe(0);
    expect(sim.cars.spline[0]).toBe(0);
    expect(sim.cars.s[0]).toBeGreaterThan(LANE_TO);
    expect(sim.cars.wreck[0]).toBe(0);
  }, 60_000);

  test('the validator: a branch off an earlier branch, not a side street, clear of its ends', () => {
    const errs = (x: TrackLayout) => validateLayout(x, SURFACES, CLASSES).filter((p) => p.level === 'error' && /leaves|rejoins/.test(p.message) && p.message.includes('lane'));
    const l = laneLayout();
    expect(errs(l)).toEqual([]);
    const withLane = (more: object) => ({ ...l, branches: l.branches!.map((b) => (b.id === 'lane' ? { ...b, ...more } : b)) });
    expect(errs(withLane({ leaves: 'nowhere' })).length).toBe(1);
    expect(errs(withLane({ from: 10 })).length).toBe(1);
    expect(errs({ ...l, branches: [...l.branches!.filter((b) => b.id !== 'barn'), l.branches!.find((b) => b.id === 'barn')!] }).length).toBeGreaterThan(0);
  }, 60_000);
});
