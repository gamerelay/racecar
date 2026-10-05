// The road graph (docs/CALDERA.md, step 6, "Routes: a graph, not a loop"): the roads as streets
// joined at nodes, and a race as a route through them, its checkpoints gates on streets.
//
// Step 6a: built from the baked roads as they are (a main road, branches leaving and rejoining it),
// alongside what drives today. Nothing reads it in the sim yet; locate, progress and the AI move onto
// it in the steps after (6b–6d). Bake-time only: no per-tick work.
//
// - A **node** is where streets meet: a junction (a branch leaving or rejoining the main road; two at
//   one spot are one junction), the line (a closed main road's s = 0, so no street wraps round it), a
//   run's start or finish, or an open road's end (past a run's start and finish, off its route).
// - A **street** is a stretch of one road between two nodes, run in its road's direction: the main
//   road cut at every node on it, and each branch whole.
// - A **route** is the race's way through: its nodes, how far along it each is, every street between
//   two of them (the main road's, and a branch the other way between the same two), and its gates
//   (the checkpoints, and the finish) on the main road's. Today's loops go round the main road; a run
//   goes from its start to its finish.

import type { BakedSpline, Track } from './bake';
import { newHit, sampleAt } from './query';

export type NodeKind = 'junction' | 'line' | 'start' | 'finish' | 'end';

export interface GraphNode {
  index: number;
  kind: NodeKind;
  x: number;
  y: number;
  z: number;
  /** The streets that start here (leaving it) and end here (coming in). */
  out: number[];
  in: number[];
}

export interface Street {
  index: number;
  /** Its road (spline index) and the stretch of it, s0 < s1 (never wrapping). */
  spline: number;
  s0: number;
  s1: number;
  length: number;
  /** Its nodes: it runs from `from` to `to`. */
  from: number;
  to: number;
  /** Its road's id, for messages and tools ('riviera', 'basin-road'). */
  road: string;
}

/** A gate across a street: a checkpoint, or the finish. */
export interface Gate {
  street: number;
  /** Along its road (spline distance), and where that is. */
  spline: number;
  s: number;
  x: number;
  y: number;
  z: number;
  /** The road's direction there (a car crosses it going this way), and half its width to the walls. */
  tx: number;
  tz: number;
  half: number;
  /** The finish line (a lap's end, or a run's), not a checkpoint. */
  finish: boolean;
}

export interface Route {
  /** Round and round (a lap) or once through (a run). */
  closed: boolean;
  /** Where it starts and finishes (a lap: both the line's node). */
  start: number;
  finish: number;
  /** How far along it (m) each node is, by node: the start 0 (a lap's line too), NaN off it. */
  at: number[];
  /** Its main road's streets in order, from the start to the finish: they add up to its length. */
  way: number[];
  /** Every street on it: its way's, and each branch between two of its nodes (another way between them; not a side street). */
  streets: number[];
  /** Its gates in order: the checkpoints, then the finish. */
  gates: Gate[];
  length: number;
}

/**
 * Where another road meets this one: at `s` along this one, `other` (a spline index) at `os` along
 * it. What locate.ts (6b) checks near a node: a car on this road might be on that one.
 */
export interface Link {
  node: number;
  s: number;
  other: number;
  os: number;
  /**
   * How far along the other road a metre along this one goes from here. From a branch onto the road
   * it leaves and rejoins, the other's distance between the two nodes over its own (where it is on
   * that road is as far through its span); else 1 (leaving a road, a branch runs beside it at first).
   */
  scale: number;
}

export interface RoadGraph {
  nodes: GraphNode[];
  /** By spline: where the other roads meet it, grouped by the other road (in spline order), each group in order along this one. */
  links: Link[][];
  /** A closed main road's line (s = 0; a junction too if a branch leaves there), -1 on an open one. */
  line: number;
  streets: Street[];
  route: Route;
  /** The street that `spline` is on at `s` (its road's stretch holding it), or -1. */
  streetAt(spline: number, s: number): number;
}

/** The distance from a to b along a closed road of length L, going forward (or back). */
const wrapAround = (d: number, L: number, forward: boolean) => (((forward ? d : -d) % L) + L) % L;

/** Two ends of roads this close (m) on the main road are one junction. */
const SAME = 1;
/** Which kind a node is when two meet at one spot: the most particular. */
const RANK: Record<NodeKind, number> = { end: 0, junction: 1, line: 2, start: 2, finish: 2 };

export function buildGraph(track: Track): RoadGraph {
  const { main, splines } = track;
  const L = main.length;
  const hit = newHit();
  const nodes: GraphNode[] = [];
  const streets: Street[] = [];
  const node = (kind: NodeKind, sp: BakedSpline, s: number): number => {
    sampleAt(sp, s, hit);
    nodes.push({ index: nodes.length, kind, x: hit.cx, y: hit.cy, z: hit.cz, out: [], in: [] });
    return nodes.length - 1;
  };

  // The nodes on the main road, by distance along it: the line (closed) or its ends (open), a run's
  // start and finish, and a junction wherever a branch leaves or rejoins it. One within SAME of
  // another is that one (the first's distance, so a run of them doesn't creep).
  const run = track.run;
  const onMain: { s: number; node: number }[] = [];
  const atMain = (s: number, kind: NodeKind): number => {
    const near = onMain.find((m) => Math.abs(m.s - s) < SAME || (main.closed && Math.abs(Math.abs(m.s - s) - L) < SAME));
    if (near) {
      // (The more particular kind: a junction at a run's start is still where it starts.)
      if (RANK[kind] > RANK[nodes[near.node].kind]) nodes[near.node].kind = kind;
      return near.node;
    }
    const n = node(kind, main, s);
    onMain.push({ s, node: n });
    return n;
  };
  const line = main.closed ? atMain(0, 'line') : -1;
  if (!main.closed) {
    atMain(0, 'end');
    atMain(L, 'end');
  }
  const startNode = run ? atMain(run.start, 'start') : line;
  const finishNode = run ? atMain(run.finish, 'finish') : line;
  const ends = splines.slice(1).map((sp) => ({ sp, from: atMain(sp.mainFrom, 'junction'), to: atMain(sp.mainTo, 'junction') }));
  onMain.sort((a, b) => a.s - b.s);

  const street = (sp: BakedSpline, s0: number, s1: number, from: number, to: number): number => {
    const k = streets.length;
    streets.push({ index: k, spline: sp.index, s0, s1, length: s1 - s0, from, to, road: sp.id });
    nodes[from].out.push(k);
    nodes[to].in.push(k);
    return k;
  };
  // The main road between each node and the next (a closed one's last back round to the line).
  const mainStreets: number[] = [];
  for (let k = 0; k < onMain.length; k++) {
    const a = onMain[k];
    const b = onMain[k + 1];
    if (b) mainStreets.push(street(main, a.s, b.s, a.node, b.node));
    else if (main.closed && L - a.s > 0) mainStreets.push(street(main, a.s, L, a.node, onMain[0].node));
  }
  const branchStreets = ends.map((e) => street(e.sp, 0, e.sp.length, e.from, e.to));

  const streetAt = (spline: number, s: number): number => {
    for (const st of streets) if (st.spline === spline && s >= st.s0 && s <= st.s1) return st.index;
    return -1;
  };

  // The route: the main road's streets from the start round (or down) to the finish, each node's
  // distance along it, and the branches between two of its nodes; its gates the checkpoints and the
  // finish, on the main road's streets holding them.
  const startS = run ? run.start : 0;
  const finishS = run ? run.finish : L;
  const way = mainStreets.filter((k) => streets[k].s0 >= startS - SAME && streets[k].s1 <= finishS + SAME);
  const at = nodes.map(() => NaN);
  for (const k of way) {
    const st = streets[k];
    at[st.from] = st.s0 - startS;
    if (st.to !== line) at[st.to] = st.s1 - startS;
  }
  if (line >= 0) at[line] = 0;
  const onRoute = (n: number) => !Number.isNaN(at[n]);
  // (Not a side street: traffic's loop off the main road, not a way through; BranchDef.kind.)
  const kinds = new Map((track.layout.branches ?? []).map((b) => [b.id, b.kind]));
  const routeStreets = [...way, ...branchStreets.filter((k) => kinds.get(streets[k].road) !== 'street' && onRoute(streets[k].from) && onRoute(streets[k].to))];
  const gate = (s: number, finish: boolean): Gate => {
    sampleAt(main, s, hit);
    // (The finish of a lap is the line: the end of the last street, not the start of the first.)
    const st = finish ? way[way.length - 1] : streetAt(0, s);
    return { street: st, spline: 0, s, x: hit.cx, y: hit.cy, z: hit.cz, tx: hit.tx, tz: hit.tz, half: hit.width / 2 + hit.shoulder, finish };
  };
  const gates = [...track.checkpoints.map((s) => gate(s, false)), gate(finishS, true)];
  const route: Route = { closed: main.closed && !run, start: startNode, finish: finishNode, at, way, streets: routeStreets, gates, length: finishS - startS };

  // Each road's links: at every node on it, every other road there (both ways round).
  const links: Link[][] = splines.map(() => []);
  for (const n of nodes) {
    const here = new Map<number, number>();
    for (const k of [...n.out, ...n.in]) {
      const st = streets[k];
      // (A closed road at its line both leaves it, s = 0, and comes back, s = L: it's at 0, so its
      // link sorts with the rest from the start of the road.)
      if (!here.has(st.spline)) here.set(st.spline, n.out.includes(k) ? st.s0 : st.s1);
    }
    for (const [a, sa] of here) for (const [b, sb] of here) if (a !== b) links[a].push({ node: n.index, s: sa, other: b, os: sb, scale: 1 });
  }
  // From a branch onto the road it spans (meeting it at both its ends), the scale between them.
  for (const l of links.slice(1))
    for (const p of l)
      for (const q of l)
        if (q !== p && q.other === p.other && q.s !== p.s) {
          const mine = Math.abs(q.s - p.s);
          const theirs = splines[p.other].closed ? wrapAround(q.os - p.os, splines[p.other].length, q.s > p.s) : Math.abs(q.os - p.os);
          if (mine > 0 && theirs > 0) p.scale = theirs / mine;
        }
  for (const l of links) l.sort((p, q) => p.other - q.other || p.s - q.s);

  return { nodes, line, links, streets, route, streetAt };
}
