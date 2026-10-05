// The road graph (docs/CALDERA.md, step 6, "Routes: a graph, not a loop"): the roads as streets
// joined at nodes, and a race as a route through them, its checkpoints gates on streets.
//
// Step 6a: built from the baked roads as they are (a main road, branches leaving and rejoining it),
// alongside what drives today. Nothing reads it in the sim yet; locate, progress and the AI move onto
// it in the steps after (6b–6d). Bake-time only: no per-tick work.
//
// - A **node** is where streets meet: a junction (a branch leaving or rejoining the main road; two at
//   one spot are one junction), the line (a closed main road's s = 0, so no street wraps round it), or
//   an open road's end (a run's top and bottom).
// - A **street** is a stretch of one road between two nodes, run in its road's direction: the main
//   road cut at every node on it, and each branch whole.
// - A **route** is the race's way through: its streets in order, and its gates (the checkpoints, and
//   the finish) on them. Today's loops go round the main road; a run goes from its start to its finish.

import type { BakedSpline, Track } from './bake';
import { newHit, sampleAt } from './query';

export type NodeKind = 'junction' | 'line' | 'end';

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
  /** Its streets in order: a lap's from the line round to it again. */
  streets: number[];
  /** Its gates in order: the checkpoints, then the finish. */
  gates: Gate[];
  length: number;
}

export interface RoadGraph {
  nodes: GraphNode[];
  streets: Street[];
  route: Route;
  /** The street that `spline` is on at `s` (its road's stretch holding it), or -1. */
  streetAt(spline: number, s: number): number;
}

/** Two ends of roads this close (m) on the main road are one junction. */
const SAME = 1;

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

  // The nodes on the main road, by distance along it: the line (closed) or its ends (open), and a
  // junction wherever a branch leaves or rejoins it.
  const onMain: { s: number; node: number }[] = [];
  const atMain = (s: number, kind: NodeKind): number => {
    const near = onMain.find((m) => Math.abs(m.s - s) < SAME || (main.closed && Math.abs(Math.abs(m.s - s) - L) < SAME));
    if (near) {
      // (A junction at the line: the line's node is the junction too.)
      if (kind === 'junction' && nodes[near.node].kind !== 'junction') nodes[near.node].kind = 'junction';
      return near.node;
    }
    const n = node(kind, main, s);
    onMain.push({ s, node: n });
    return n;
  };
  if (main.closed) atMain(0, 'line');
  else {
    atMain(0, 'end');
    atMain(L, 'end');
  }
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
  for (const e of ends) street(e.sp, 0, e.sp.length, e.from, e.to);

  const streetAt = (spline: number, s: number): number => {
    for (const st of streets) if (st.spline === spline && s >= st.s0 && s <= st.s1) return st.index;
    return -1;
  };

  // The route: the main road's streets, from the line (or a run's start) round to the finish, its
  // gates the checkpoints and the finish on the streets holding them.
  const run = track.run;
  const startS = run ? run.start : 0;
  const finishS = run ? run.finish : L;
  const routeStreets = mainStreets.filter((k) => streets[k].s1 > startS && streets[k].s0 < finishS);
  const gate = (s: number, finish: boolean): Gate => {
    sampleAt(main, s, hit);
    // (The finish of a lap is the line: the end of the last street, not the start of the first.)
    const st = finish && main.closed ? mainStreets[mainStreets.length - 1] : streetAt(0, s);
    return { street: st, spline: 0, s, x: hit.cx, y: hit.cy, z: hit.cz, tx: hit.tx, tz: hit.tz, half: hit.width / 2 + hit.shoulder, finish };
  };
  const gates = [...track.checkpoints.map((s) => gate(s, false)), gate(finishS, true)];
  const route: Route = { closed: main.closed && !run, streets: routeStreets, gates, length: finishS - startS };

  return { nodes, streets, route, streetAt };
}
