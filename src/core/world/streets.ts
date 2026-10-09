// A getaway's streets (docs/CHASE_MODE.md, step 1): the crossings and the streets between them that
// the cops find their way round the city by (TrackLayout.getaway), and whether the buildings
// (TrackLayout.houses) stand between two points. Until the road graph has a city's streets and its
// own path search (CHASE_MODE's steps 2 and 3), this is the whole of it: a small graph, searched
// with A*, and a line of sight against the houses' boxes.

import type { GetawayDef, HouseDef } from '../content';
import { cos, hypot, sin } from '../math';

/** A house as a box for the line of sight: its middle, its axes, its half sizes (a little inside its walls). */
interface Box {
  x: number;
  z: number;
  fx: number;
  fz: number;
  hl: number;
  hw: number;
  r: number;
}

/** Sight passes this close (m) to a wall: a car's half width, so a path seen is a path a car fits down. */
const SIGHT_MARGIN = 1.2;
/** The houses are found by a grid of this many metres a cell. */
const CELL = 40;
/** A node in sight is looked for among this many nearest. */
const NEAREST = 8;

export class Streets {
  readonly nodes: Float64Array;
  readonly n: number;
  /** Each node's neighbours (indices) and the length of the street to each. */
  private readonly adj: { to: number; len: number }[][];
  private readonly boxes: Box[];
  /** The grid: per cell (by `key`), the boxes reaching into it; and a stamp per box, so a box in two cells is tested once a call. */
  private readonly cells = new Map<number, number[]>();
  private readonly stamp: Uint32Array;
  private calls = 0;
  /** The nearest nodes, for `nearest` (scratch). */
  private readonly near: Int32Array;
  private readonly nearD: Float64Array;
  // A*'s scratch, reused: the cost so far, where from, and whether closed.
  private readonly g: Float64Array;
  private readonly from: Int32Array;
  private readonly done: Uint8Array;
  private readonly open: Int32Array;

  constructor(def: GetawayDef, houses: readonly HouseDef[]) {
    this.n = def.nodes.length;
    this.nodes = new Float64Array(this.n * 2);
    def.nodes.forEach(([x, z], k) => {
      this.nodes[k * 2] = x;
      this.nodes[k * 2 + 1] = z;
    });
    this.adj = Array.from({ length: this.n }, () => []);
    for (const [a, b] of def.links) {
      const len = hypot(def.nodes[a][0] - def.nodes[b][0], def.nodes[a][1] - def.nodes[b][1]);
      this.adj[a].push({ to: b, len });
      this.adj[b].push({ to: a, len });
    }
    this.boxes = houses.map((h) => ({ x: h.at[0], z: h.at[1], fx: sin(h.rot), fz: cos(h.rot), hl: h.size[1] / 2 + SIGHT_MARGIN, hw: h.size[0] / 2 + SIGHT_MARGIN, r: hypot(h.size[0], h.size[1]) / 2 + SIGHT_MARGIN }));
    this.boxes.forEach((b, k) => {
      for (let gx = Math.floor((b.x - b.r) / CELL); gx <= Math.floor((b.x + b.r) / CELL); gx++)
        for (let gz = Math.floor((b.z - b.r) / CELL); gz <= Math.floor((b.z + b.r) / CELL); gz++) {
          const list = this.cells.get(key(gx, gz));
          if (list) list.push(k);
          else this.cells.set(key(gx, gz), [k]);
        }
    });
    this.stamp = new Uint32Array(this.boxes.length);
    this.near = new Int32Array(NEAREST);
    this.nearD = new Float64Array(NEAREST);
    this.g = new Float64Array(this.n);
    this.from = new Int32Array(this.n);
    this.done = new Uint8Array(this.n);
    this.open = new Int32Array(this.n);
  }

  x(k: number): number {
    return this.nodes[k * 2];
  }

  z(k: number): number {
    return this.nodes[k * 2 + 1];
  }

  /** The node nearest (x, z) that's in sight of it, of the NEAREST nearest; else the nearest. */
  nearest(x: number, z: number): number {
    const { near, nearD } = this;
    let m = 0;
    for (let k = 0; k < this.n; k++) {
      const d = hypot(this.x(k) - x, this.z(k) - z);
      if (m === NEAREST && d >= nearD[m - 1]) continue;
      // Into the sorted list (insertion: a handful).
      let j = m < NEAREST ? m++ : m - 1;
      while (j > 0 && nearD[j - 1] > d) {
        near[j] = near[j - 1];
        nearD[j] = nearD[j - 1];
        j--;
      }
      near[j] = k;
      nearD[j] = d;
    }
    for (let j = 0; j < m; j++) if (this.clear(x, z, this.x(near[j]), this.z(near[j]))) return near[j];
    return m ? near[0] : -1;
  }

  /**
   * The way from node `a` to node `b` along the streets (A*, by length), as nodes after `a` up to
   * `b`, into `out`; its length in nodes (0 if there's none, or a is b).
   */
  path(a: number, b: number, out: Int32Array): number {
    if (a === b) return 0;
    const { g, from, done } = this;
    g.fill(Infinity);
    from.fill(-1);
    done.fill(0);
    g[a] = 0;
    const bx = this.x(b);
    const bz = this.z(b);
    // The open nodes (a scan of them for the least cost: a city's frontier is a few dozen, no heap needed).
    const open = this.open;
    let nOpen = 0;
    open[nOpen++] = a;
    for (;;) {
      let pick = -1;
      let curF = Infinity;
      for (let q = 0; q < nOpen; q++) {
        const k = open[q];
        const f = g[k] + hypot(this.x(k) - bx, this.z(k) - bz);
        if (f < curF) (curF = f), (pick = q);
      }
      if (pick < 0) return 0;
      const cur = open[pick];
      open[pick] = open[--nOpen];
      if (cur === b) break;
      done[cur] = 1;
      for (const e of this.adj[cur]) {
        if (done[e.to]) continue;
        const c = g[cur] + e.len;
        if (c < g[e.to]) {
          if (g[e.to] === Infinity) open[nOpen++] = e.to;
          g[e.to] = c;
          from[e.to] = cur;
        }
      }
    }
    let len = 0;
    for (let k = b; k !== a; k = from[k]) len++;
    let at = len;
    for (let k = b; k !== a; k = from[k]) out[--at] = k;
    return Math.min(len, out.length);
  }

  /** Whether nothing stands between (x0, z0) and (x1, z1): no house's walls (with a car's width to spare) across the line. */
  clear(x0: number, z0: number, x1: number, z1: number): boolean {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = hypot(dx, dz);
    const call = ++this.calls;
    // The cells the segment's box covers (a street's length: a few dozen at most).
    for (let gx = Math.floor(Math.min(x0, x1) / CELL); gx <= Math.floor(Math.max(x0, x1) / CELL); gx++)
      for (let gz = Math.floor(Math.min(z0, z1) / CELL); gz <= Math.floor(Math.max(z0, z1) / CELL); gz++) {
        const list = this.cells.get(key(gx, gz));
        if (!list) continue;
        for (const k of list) {
          if (this.stamp[k] === call) continue;
          this.stamp[k] = call;
          const b = this.boxes[k];
          // Far off the line: skip it (its distance from the segment, against its radius).
          const t = len > 0 ? Math.max(0, Math.min(1, ((b.x - x0) * dx + (b.z - z0) * dz) / (len * len))) : 0;
          if (hypot(x0 + dx * t - b.x, z0 + dz * t - b.z) > b.r) continue;
          if (crosses(b, x0, z0, x1, z1)) return false;
        }
      }
    return true;
  }
}

const key = (gx: number, gz: number) => (gx + 4096) * 8192 + (gz + 4096);

/** Whether the segment crosses the box (slab test in the box's own axes). */
function crosses(b: Box, x0: number, z0: number, x1: number, z1: number): boolean {
  // Into the box's frame: along its front (fx, fz) and across it (fz, -fx).
  const ax = (x0 - b.x) * b.fx + (z0 - b.z) * b.fz;
  const az = (x0 - b.x) * b.fz - (z0 - b.z) * b.fx;
  const ex = (x1 - b.x) * b.fx + (z1 - b.z) * b.fz;
  const ez = (x1 - b.x) * b.fz - (z1 - b.z) * b.fx;
  span.lo = 0;
  span.hi = 1;
  return slab(ax, ex - ax, b.hl) && slab(az, ez - az, b.hw);
}

/** The part of the segment (0..1) inside the slabs so far. */
const span = { lo: 0, hi: 1 };

/** Narrows `span` to where p + q·t is within ±h; false once nothing's left. */
function slab(p: number, q: number, h: number): boolean {
  if (Math.abs(q) < 1e-9) return Math.abs(p) <= h;
  const t0 = (-h - p) / q;
  const t1 = (h - p) / q;
  span.lo = Math.max(span.lo, Math.min(t0, t1));
  span.hi = Math.min(span.hi, Math.max(t0, t1));
  return span.lo <= span.hi;
}
