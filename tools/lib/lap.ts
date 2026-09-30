// What every lap generator shares (MAPS.md, "Laying out a lap"), from the Valley's generator:
// corners as nodes filleted into constant-radius arcs, widths that grow through drift corners,
// corners banked into the turn, height between the corners' anchors, bank, width and height
// smoothed by distance rather than by sample, and crests anchored to the road. Then, once the lap
// is baked, the helpers the shortcuts and walls are placed with.

import type { TrackPoint, Vec3 } from '../../src/core/content';
import type { Track } from '../../src/core/track/bake';
import { newHit, projectGlobal, sampleAt } from '../../src/core/track/query';

/** A corner of the lap: r is its radius (none: a plain point). Bank: unset banks into the turn. */
export type Node = { x: number; z: number; y: number; w: number; r?: number; surface: string; shoulder: number; bank?: number };

/** A bump in the height (meters) centered on the road nearest (x, z), over a length. */
export interface Crest {
  x: number;
  z: number;
  h: number;
  len: number;
}

export interface LapOptions {
  /** Drift corners (sweepers, not hairpins or kinks) are this much wider. */
  driftWidth?: number;
  /** Bank into a corner of radius r (radians). */
  bankFor?: (r: number) => number;
  /** The radii (m) that count as drift corners. */
  drift?: [number, number];
  /** Gaussian smoothing (m) of height, width and bank. */
  sigma?: { height: number; width: number; bank: number };
}

interface Sample {
  x: number;
  z: number;
  n: Node;
  /** Width and bank before smoothing: a corner's own on its arc, the plain road's elsewhere. */
  w: number;
  bank: number;
  /** On a corner's middle sample: the road is at the node's height there. */
  anchor?: number;
}

/** Hairpins bank a little, sweepers more. */
const BANK_FOR = (r: number) => (r < 35 ? 0.06 : 0.1);

export const r1 = (n: number) => Math.round(n * 10) / 10;

/** The lap's filleted corners, sampled every few meters. */
function path(ns: Node[], o: Required<LapOptions>): Sample[] {
  const N = ns.length;
  const corner = ns.map((c, i) => {
    const p = ns[(i - 1 + N) % N];
    const q = ns[(i + 1) % N];
    const inLen = Math.hypot(c.x - p.x, c.z - p.z);
    const outLen = Math.hypot(q.x - c.x, q.z - c.z);
    const di = [(c.x - p.x) / inLen, (c.z - p.z) / inLen];
    const dO = [(q.x - c.x) / outLen, (q.z - c.z) / outLen];
    const cr = di[0] * dO[1] - di[1] * dO[0];
    const theta = Math.acos(Math.max(-1, Math.min(1, di[0] * dO[0] + di[1] * dO[1])));
    const t = c.r && theta > 0.02 ? Math.min(c.r * Math.tan(theta / 2), inLen * 0.48, outLen * 0.48) : 0;
    return { di, dO, cr, theta, t, t1: [c.x - di[0] * t, c.z - di[1] * t], t2: [c.x + dO[0] * t, c.z + dO[1] * t] };
  });
  const out: Sample[] = [];
  for (let i = 0; i < N; i++) {
    const c = ns[i];
    const k = corner[i];
    if (!k.t) out.push({ x: c.x, z: c.z, n: c, anchor: c.y, w: c.w, bank: c.bank ?? 0 });
    else {
      // The arc, centered off the incoming tangent toward the turn.
      const r = k.t / Math.tan(k.theta / 2);
      const sgn = k.cr > 0 ? 1 : -1;
      const cx = k.t1[0] - k.di[1] * r * sgn;
      const cz = k.t1[1] + k.di[0] * r * sgn;
      const a0 = Math.atan2(k.t1[1] - cz, k.t1[0] - cx);
      const steps = Math.max(2, Math.ceil((r * k.theta) / 7));
      // The lap's right is (-z, x) of its heading, so a positive cross product is a right turn,
      // and a positive bank lowers the right: into the turn.
      const drift = r >= o.drift[0] && r <= o.drift[1] && k.theta > 0.35;
      const w = c.w + (drift ? o.driftWidth : 0);
      const bank = c.bank ?? (k.theta > 0.2 ? sgn * o.bankFor(r) : 0);
      for (let j = 0; j <= steps; j++) {
        const a = a0 + sgn * k.theta * (j / steps);
        out.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, n: c, anchor: j === Math.floor(steps / 2) ? c.y : undefined, w, bank });
      }
    }
    // The straight on to the next corner.
    const q = ns[(i + 1) % N];
    const f = k.t2;
    const g = corner[(i + 1) % N].t1;
    const steps = Math.floor(Math.hypot(g[0] - f[0], g[1] - f[1]) / 22);
    for (let j = 1; j < steps; j++) {
      const u = j / steps;
      const n = u < 0.5 ? c : q;
      out.push({ x: f[0] + (g[0] - f[0]) * u, z: f[1] + (g[1] - f[1]) * u, n, w: n.w, bank: 0 });
    }
  }
  return out;
}

/**
 * The lap's main road from its corners and crests: points with smoothed height, width and bank.
 * A node's surface is left off its points when it's asphalt (the default).
 */
export function lapPoints(nodes: Node[], crests: Crest[], opts: LapOptions = {}): TrackPoint[] {
  const o: Required<LapOptions> = { driftWidth: 1.5, bankFor: BANK_FOR, drift: [35, 110], sigma: { height: 14, width: 10, bank: 12 }, ...opts };
  const samples = path(nodes, o);
  const S = samples.length;
  const dist: number[] = [0];
  for (let k = 1; k <= S; k++) dist.push(dist[k - 1] + Math.hypot(samples[k % S].x - samples[k - 1].x, samples[k % S].z - samples[k - 1].z));
  const L0 = dist[S];
  const gap = (a: number, b: number) => Math.abs(((dist[a] - dist[b] + L0 * 1.5) % L0) - L0 / 2);
  // Height: linear in distance between the corners' anchors, smoothed, plus the crests.
  const anchors = samples.flatMap((s, k) => (s.anchor === undefined ? [] : [{ k, y: s.anchor }]));
  const raw = samples.map((_, k) => {
    let j = anchors.findIndex((a) => a.k > k);
    if (j < 0) j = 0;
    const b = anchors[j];
    const a = anchors[(j - 1 + anchors.length) % anchors.length];
    const da = (dist[k] - dist[a.k] + L0) % L0;
    const ab = (dist[b.k] - dist[a.k] + L0) % L0 || 1;
    return a.y + (b.y - a.y) * (da / ab);
  });
  /** `v` (one value per sample) at distance d along the lap, linear between samples. */
  const valueAt = (v: number[], d: number) => {
    d = ((d % L0) + L0) % L0;
    let lo = 0;
    let hi = S;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (dist[mid] <= d) lo = mid;
      else hi = mid;
    }
    const f = (d - dist[lo]) / (dist[lo + 1] - dist[lo] || 1);
    return v[lo] + (v[(lo + 1) % S] - v[lo]) * f;
  };
  /** A value along the lap, smoothed with a Gaussian of `sigma` meters (by distance, however sparse the samples). */
  const smoothed = (v: number[], sigma: number) =>
    v.map((_, k) => {
      let sum = 0;
      let wsum = 0;
      for (let u = -3 * sigma; u <= 3 * sigma; u += 1) {
        const w = Math.exp(-(u * u) / (2 * sigma * sigma));
        sum += valueAt(v, dist[k] + u) * w;
        wsum += w;
      }
      return sum / wsum;
    });
  // Crests sit on the road nearest their (x, z), measured along it.
  const crestAt = crests.map((c) => {
    let best = 0;
    for (let k = 1; k < S; k++) if (Math.hypot(samples[k].x - c.x, samples[k].z - c.z) < Math.hypot(samples[best].x - c.x, samples[best].z - c.z)) best = k;
    return { ...c, k: best };
  });
  const heights = smoothed(raw, o.sigma.height).map((y, k) => {
    for (const c of crestAt) {
      const d = gap(k, c.k);
      if (d < c.len / 2) y += c.h * 0.5 * (1 + Math.cos((Math.PI * d) / (c.len / 2)));
    }
    return y;
  });
  // Widths ease in and out of the corners; banks roll over an S instead of flipping.
  const widths = smoothed(
    samples.map((s) => s.w),
    o.sigma.width,
  );
  const banks = smoothed(
    samples.map((s) => s.bank),
    o.sigma.bank,
  );
  return samples.map((s, k) => ({
    p: [r1(s.x), r1(heights[k]), r1(s.z)] as Vec3,
    width: Math.round(widths[k] * 10) / 10,
    lanes: 2,
    shoulder: s.n.shoulder,
    ...(s.n.surface !== 'asphalt' ? { surface: s.n.surface } : {}),
    ...(Math.abs(banks[k]) > 0.002 ? { bank: Math.round(banks[k] * 1000) / 1000 } : {}),
  }));
}

/** Where things are on a baked lap's main road, for placing shortcuts, walls and sections. */
export function onLap(baked: Track) {
  const hit = newHit();
  /** The main road's s nearest (x, z) (at height y, where the lap crosses itself). */
  const sAt = (x: number, z: number, y?: number) => (projectGlobal(baked.main, x, z, hit, y), Math.round(hit.s));
  /** The main road's height nearest (x, z). */
  const yAt = (x: number, z: number, y?: number) => (projectGlobal(baked.main, x, z, hit, y), hit.cy);
  /**
   * A shortcut's first (or last) point: `along` m on from where it leaves the main road at `s` (or
   * back from where it rejoins), and `lat` m out to the side (right positive). Close in and shallow,
   * so it forks off gently.
   */
  const fork = (s: number, along: number, lat: number, dy: number, width: number, surface = 'dirt'): TrackPoint => {
    sampleAt(baked.main, s + along, hit);
    return { p: [r1(hit.cx - hit.tz * lat), r1(hit.cy + dy), r1(hit.cz + hit.tx * lat)], width, lanes: 1, shoulder: 1.5, surface };
  };
  return { sAt, yAt, fork };
}

export const span = (a: number, b: number): [number, number] => [Math.min(a, b), Math.max(a, b)];

/** Wall gaps (open both sides) everywhere but the `walled` spans, on a lap `L` m long. */
export function wallGaps(walled: [number, number][], L: number): { s: [number, number]; side: 'both' }[] {
  const gaps: { s: [number, number]; side: 'both' }[] = [];
  let cursor = 0;
  for (const [a, b] of [...walled].sort((a, b) => a[0] - b[0])) {
    if (a > cursor) gaps.push({ s: [cursor, a], side: 'both' });
    cursor = Math.max(cursor, b);
  }
  if (cursor < L) gaps.push({ s: [cursor, L], side: 'both' });
  return gaps;
}
