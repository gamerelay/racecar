// The road graph (docs/CALDERA.md, step 6a; core/track/graph.ts): every map's roads as streets
// between nodes, and its race as a route through them, its checkpoints gates on streets. Built
// alongside what drives today: nothing in the sim reads it yet.

import { describe, expect, test } from 'bun:test';
import { bakeTrack, type Track } from '../src/core/track/bake';
import { newHit, sampleAt } from '../src/core/track/query';
import type { TrackLayout } from '../src/core/content';
import { validateLayout } from '../src/core/track/validate';
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
});
