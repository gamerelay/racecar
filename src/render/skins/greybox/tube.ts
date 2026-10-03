// A branch's decks on open ground (core/track/ground.ts, GroundDef.branchDecks): the Lava Tube
// (docs/PARADISE.md). Where the ground is over its road it's a tunnel: a rock tube round the road,
// the ground's own slope opened at its mouths (Ground.hole), a rough arch framing each, and lava
// glowing in the cracks along its walls. Where the ground falls away under it (the volcano's shaft)
// it's a bridge of jagged black rock, hanging in spikes over the lava, its edges open: off it is
// down into the lava. Its road is painted on the rock either way.

import { DoubleSide, Mesh, type Object3D } from 'three';
import { hash01 } from '../../../core/rng';
import type { BakedSpline, Track } from '../../../core/track/bake';
import { TUBE_H } from '../../../core/track/ground';
import { glowPoints } from './scenery';
import { Geo } from './track';
import { toon } from './toon';

const ROCK = ['#2e2729', '#3a3134', '#453a3a', '#352d2f'];
const ROCK_DARK = '#1f1a1c';
/** How far under its road the bridge's slab goes, and how far its spikes hang under that. */
const SLAB = 1.6;
const SPIKE = 5;
/** The road's lift off its rock (so the two don't fight). */
const LIFT = 0.04;

export function buildTubes(track: Track): Object3D[] {
  const g = track.ground!;
  const out: Object3D[] = [];
  const geo = new Geo();
  const glow: number[] = [];
  for (const sp of track.splines) {
    const decks = g.branchDeck.get(sp.index);
    if (!decks) continue;
    const surface = track.surfaces[sp.surface[0]].color;
    // A tunnel where the ground's over its road, a bridge where it's fallen away.
    const coveredAt = (k: number) => k >= 0 && k < sp.n && decks[k] === 1 && g.height(sp.px[k], sp.pz[k]) > sp.py[k] - 0.5;
    for (let i = 0; i + 1 < sp.n; i++) {
      if (!decks[i] || !decks[i + 1]) continue;
      const j = i + 1;
      const covered = coveredAt(i);
      const rock = ROCK[Math.floor(hash01(sp.index, i >> 2, 7) * ROCK.length)];
      const p = (k: number, l: number, up: number) => [sp.px[k] - sp.tz[k] * l, sp.py[k] - l * Math.tan(sp.bank[k]) + up, sp.pz[k] + sp.tx[k] * l];
      const half = (k: number) => sp.width[k] / 2;
      const edge = (k: number) => sp.width[k] / 2 + sp.shoulder[k];
      // The road and its verge.
      geo.face(p(i, -half(i), LIFT), p(i, half(i), LIFT), p(j, half(j), LIFT), p(j, -half(j), LIFT), surface);
      for (const side of [-1, 1]) geo.face(p(i, side * half(i), LIFT), p(i, side * edge(i), LIFT), p(j, side * edge(j), LIFT), p(j, side * half(j), LIFT), ROCK_DARK);
      if (covered) {
        // A floor of rock a little wider than the tube, under its road (the slope's opened round its mouth).
        geo.face(p(i, -edge(i) - 2, -0.06), p(i, edge(i) + 2, -0.06), p(j, edge(j) + 2, -0.06), p(j, -edge(j) - 2, -0.06), ROCK_DARK);
        // The tube: walls up from the verge, a rough vault over the road (inside faces; drawn both sides).
        const ring = (k: number): number[][] => {
          const e = edge(k);
          const bump = (a: number) => 0.4 * (hash01(sp.index, k >> 3, a) - 0.5);
          return [
            p(k, -e, 0),
            p(k, -e - 0.6 + bump(1), TUBE_H * 0.55),
            p(k, -e * 0.55, TUBE_H + bump(2)),
            p(k, e * 0.55, TUBE_H + bump(3)),
            p(k, e + 0.6 + bump(4), TUBE_H * 0.55),
            p(k, e, 0),
          ];
        };
        const a = ring(i);
        const b = ring(j);
        for (let q = 0; q + 1 < a.length; q++) geo.face(a[q], a[q + 1], b[q + 1], b[q], q === 2 ? ROCK_DARK : rock);
        // Lava in the cracks at the walls' feet, every so often.
        if (i % 9 === 0) for (const side of [-1, 1]) glow.push(...p(i, side * (edge(i) - 0.3), 0.5));
        // A rough arch framing each mouth, and an apron of rock out in front of it (over the
        // ground's edge round the opening).
        // (Into the shaft, its wall's sheer: the arch is a tall collar, over the slivers its steep
        // ground leaves round the opening.)
        const shaft = (k: number) => g.height(sp.px[Math.max(0, Math.min(sp.n - 1, k))], sp.pz[Math.max(0, Math.min(sp.n - 1, k))]) < sp.py[i] - 0.5;
        if (!coveredAt(i - 1)) arch(geo, sp, i, edge(i), -1, shaft(i - 8));
        else if (!coveredAt(j + 1)) arch(geo, sp, i, edge(i), 1, shaft(j + 8));
      } else {
        // The bridge: a slab of black rock under the road, spikes hanging off it over the lava.
        for (const side of [-1, 1]) geo.face(p(i, side * edge(i), 0), p(i, side * edge(i), -SLAB), p(j, side * edge(j), -SLAB), p(j, side * edge(j), 0), rock);
        geo.face(p(i, -edge(i), -SLAB), p(i, edge(i), -SLAB), p(j, edge(j), -SLAB), p(j, -edge(j), -SLAB), ROCK_DARK);
        if (i % 3 === 0) {
          for (let k = 0; k < 3; k++) {
            const l = (hash01(sp.index, i, 11 + k) - 0.5) * 2 * edge(i);
            const len = SPIKE * (0.4 + hash01(sp.index, i, 21 + k));
            spike(geo, p(i, l, -SLAB + 0.1), len, 0.8 + hash01(sp.index, i, 31 + k) * 1.6, ROCK[k % ROCK.length]);
          }
          // Its edges jagged: rocks along them, under the road's level (nothing to catch a wheel on).
          for (const side of [-1, 1]) spike(geo, p(i, side * (edge(i) + 0.2), -0.25), -1.2, 0.9 + hash01(sp.index, i, 41 + side), rock);
        }
      }
    }
  }
  if (geo.pos.length) {
    const mesh = new Mesh(geo.build(), toon({ vertexColors: true, side: DoubleSide }));
    mesh.matrixAutoUpdate = false;
    out.push(mesh);
  }
  if (glow.length) out.push(glowPoints(glow, 0xff6a1a, 7));
  return out;
}

/** A spike of rock from `top` hanging `len` m down (negative: a stub sticking up), `r` m across: a four-sided cone. */
function spike(geo: Geo, top: number[], len: number, r: number, color: string): void {
  const tip = [top[0], top[1] - len, top[2]];
  const c = [
    [top[0] - r, top[1], top[2]],
    [top[0], top[1], top[2] - r],
    [top[0] + r, top[1], top[2]],
    [top[0], top[1], top[2] + r],
  ];
  for (let k = 0; k < 4; k++) geo.face(c[k], c[(k + 1) % 4], tip, tip, color);
}

/** A rough arch of rock across the tube at sample `i`: two pillars and a lintel, a little proud of the tube, its apron reaching out `out` (-1 back, +1 ahead). */
function arch(geo: Geo, sp: BakedSpline, i: number, e: number, out: number, tall: boolean): void {
  const p = (l: number, up: number, along: number) => [sp.px[i] - sp.tz[i] * l + sp.tx[i] * along, sp.py[i] + up, sp.pz[i] + sp.tx[i] * l + sp.tz[i] * along];
  const box = (l0: number, l1: number, y0: number, y1: number, color: string) => {
    const a = [p(l0, y0, -1.5), p(l1, y0, -1.5), p(l1, y1, -1.5), p(l0, y1, -1.5)];
    const b = [p(l0, y0, 1.5), p(l1, y0, 1.5), p(l1, y1, 1.5), p(l0, y1, 1.5)];
    for (let k = 0; k < 4; k++) geo.face(a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k], color);
    geo.face(a[0], a[1], a[2], a[3], color);
    geo.face(b[0], b[1], b[2], b[3], color);
  };
  const w = tall ? 6 : 2.5;
  box(-e - w, -e - 0.2, 0, TUBE_H + 1.5, ROCK[1]);
  box(e + 0.2, e + w, 0, TUBE_H + 1.5, ROCK[2]);
  box(-e - w, e + w, TUBE_H, TUBE_H + (tall ? 22 : 2.5), ROCK[0]);
  const f = (l: number, along: number) => [sp.px[i] - sp.tz[i] * l + sp.tx[i] * along, sp.py[i] - l * Math.tan(sp.bank[i]) - 0.06, sp.pz[i] + sp.tx[i] * l + sp.tz[i] * along];
  geo.face(f(-e - 2.5, 0), f(e + 2.5, 0), f(e + 2.5, out * 4), f(-e - 2.5, out * 4), ROCK_DARK);
}
