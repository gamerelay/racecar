// The pieces on open ground that aren't decks or buildings (core/track/ground, PieceDef): the Lava
// Tube (docs/PARADISE.md), a branch's, and Coastal's Rock Tunnel on the main road (its tube and the
// road in it: the main road's decks are track.ts's). Where the ground is over its road it's a tunnel: a rock tube round the road
// (its walls on the piece's outline, core's `outlineAt`, where the ground's cut to meet them at its
// mouths: portal.ts), a rough arch framing each, and lava
// glowing in the cracks along its walls. Where the ground falls away under it (the volcano's shaft)
// it's a bridge of jagged black rock, hanging in spikes over the lava, its edges open: off it is
// down into the lava. Its road is painted on the rock either way.

import { DoubleSide, Mesh, type Object3D } from 'three';
import { hash01 } from '../../../core/rng';
import type { BakedSpline, Track } from '../../../core/track/bake';
import { OUTLINE_POINTS, outlineAt } from '../../../core/track/ground';
import { ARCH_DEPTH, tubeCeiling, tubeSegments } from './portal';
import { glowPoints } from './scenery';
import { Geo } from './track';
import { toon } from './toon';

/** The Lava Tube's black rock, lava glowing in its cracks; a rock tunnel's limestone, lit by lamps (by the piece's `indoor`). */
const LOOKS = {
  lava: { rock: ['#2e2729', '#3a3134', '#453a3a', '#352d2f'], dark: '#1f1a1c' },
  tunnel: { rock: ['#b5a78f', '#a6977e', '#c2b59d', '#9b8d76'], dark: '#7a6e5c' },
};
const ROCK = LOOKS.lava.rock;
const ROCK_DARK = LOOKS.lava.dark;
/** A rock tunnel's lamps: every this far (m) along each wall, this far under its ceiling. */
const LAMP_EVERY = 14;
const LAMP_DOWN = 1.4;
/** How far under its road the bridge's slab goes, and how far its spikes hang under that. */
const SLAB = 1.6;
const SPIKE = 5;
/** The road's lift off its rock (so the two don't fight). */
const LIFT = 0.04;
/** Scratch for an outline. */
const OUTLINE = new Float64Array(OUTLINE_POINTS * 2);

export function buildTubes(track: Track): Object3D[] {
  const g = track.ground!;
  const out: Object3D[] = [];
  const geo = new Geo();
  const glow: number[] = [];
  const lamps: number[] = [];
  for (const sp of track.splines) {
    const decks = g.pieces.floors(sp.index);
    if (!decks) continue;
    // The main road: its tunnels' tubes only.
    const main = sp === track.main;
    // (A building's stretch is building.ts's.)
    const at = g.pieces.at(sp.index)!;
    const built = (k: number) => at[k] >= 0 && g.pieces.list[at[k]].building !== '';
    const surface = track.surfaces[sp.surface[0]].color;
    // A tunnel where an enclosed piece has the ground over its road, a bridge where it's fallen
    // away (or the piece is open: it has no ceiling).
    const seg = tubeSegments(track, sp);
    const ceiling = (k: number) => tubeCeiling(track, sp, k);
    /** Whether the tube's walls run from sample k to the next (as portal.ts cuts the ground for them). */
    const walled = (k: number) => k >= 0 && !!seg?.[k];
    for (let i = 0; i + 1 < sp.n; i++) {
      if (!decks[i] || !decks[i + 1] || built(i) || built(i + 1)) continue;
      const j = i + 1;
      const covered = walled(i);
      if (main && !covered) continue;
      const look = at[i] >= 0 && g.pieces.list[at[i]].indoor === 'tunnel' ? LOOKS.tunnel : LOOKS.lava;
      const rock = look.rock[Math.floor(hash01(sp.index, i >> 2, 7) * look.rock.length)];
      // (Up a kicker where there's one: the jump's, on the bridge.)
      const p = (k: number, l: number, up: number) => [sp.px[k] - sp.tz[k] * l, sp.py[k] + sp.ramp[k] - l * Math.tan(sp.bank[k]) + up, sp.pz[k] + sp.tx[k] * l];
      const half = (k: number) => sp.width[k] / 2;
      const edge = (k: number) => sp.width[k] / 2 + sp.shoulder[k];
      // The road and its verge (the main road's too, in its tunnel: draped over the ground elsewhere,
      // it has no ground at its height in there).
      geo.face(p(i, -half(i), LIFT), p(i, half(i), LIFT), p(j, half(j), LIFT), p(j, -half(j), LIFT), surface);
      for (const side of [-1, 1]) geo.face(p(i, side * half(i), LIFT), p(i, side * edge(i), LIFT), p(j, side * edge(j), LIFT), p(j, side * half(j), LIFT), look.dark);
      if (covered) {
        // A floor of rock a little wider than the tube, under its road.
        geo.face(p(i, -edge(i) - 2, -0.06), p(i, edge(i) + 2, -0.06), p(j, edge(j) + 2, -0.06), p(j, -edge(j) - 2, -0.06), look.dark);
        // The tube: walls up from the verge, a rough vault over the road (inside faces; drawn both sides).
        const ring = (k: number): number[][] => {
          outlineAt(sp, k, ceiling(k), OUTLINE);
          const pts: number[][] = [];
          for (let q = 0; q < OUTLINE_POINTS; q++) pts.push(p(k, OUTLINE[q * 2], OUTLINE[q * 2 + 1]));
          return pts;
        };
        const a = ring(i);
        const b = ring(j);
        for (let q = 0; q + 1 < a.length; q++) geo.face(a[q], a[q + 1], b[q + 1], b[q], q === 2 ? look.dark : rock);
        if (look === LOOKS.lava) {
          // Lava in the cracks at the walls' feet, every so often.
          if (i % 9 === 0) for (const side of [-1, 1]) glow.push(...p(i, side * (edge(i) - 0.3), 0.5));
        } else if (Math.floor(i * sp.step / LAMP_EVERY) !== Math.floor(j * sp.step / LAMP_EVERY)) {
          // Lamps high on both walls, staggered.
          const side = Math.floor(j * sp.step / LAMP_EVERY) % 2 ? 1 : -1;
          lamps.push(...p(i, side * (edge(i) - 0.6), ceiling(i) - LAMP_DOWN));
        }
        // A rough arch framing each mouth, and an apron of rock out in front of it (over the
        // ground's edge round the opening).
        // (Into the shaft, its wall's sheer: the arch is a tall collar, over the slivers its steep
        // ground leaves round the opening.)
        // (Its ground falling away well under the road: a cutting's floor a little under it isn't the
        // shaft, and gave the way in a 22 m collar standing up out of the slope.)
        const shaft = (k: number) => g.height(sp.px[Math.max(0, Math.min(sp.n - 1, k))], sp.pz[Math.max(0, Math.min(sp.n - 1, k))]) < sp.py[i] - 3;
        // (Each on its end ring, where the ground's cut on ARCH_DEPTH past it: portal.ts.)
        if (!walled(i - 1)) arch(geo, sp, i, edge(i), ceiling(i), -1, shaft(i - 8), look);
        if (!walled(j)) arch(geo, sp, j, edge(j), ceiling(j), 1, shaft(j + 8), look);
      } else {
        // Up a kicker (the jump's): chevrons pointing over the edge, red and white, every 3 m.
        const at = i * sp.step;
        if (sp.ramp[i] > 0 && sp.ramp[j] > 0 && at % 3 < sp.step) chevron(geo, sp, i, half(i), at % 6 < 3 ? '#e8433a' : '#f4efe6');
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
  // A gap in a bridge (the jump): lava light along both its edges, under the road's lip, so it shows
  // coming up to it (dark rock over dark lava, it didn't).
  for (const sp of track.splines) {
    const gaps = g.pieces.gaps(sp.index);
    if (!gaps) continue;
    for (let i = 1; i < sp.n; i++) {
      if (gaps[i] === gaps[i - 1]) continue;
      const k = gaps[i] ? i - 1 : i;
      const e = sp.width[k] / 2 + sp.shoulder[k];
      for (let l = -e; l <= e; l += 1.5) glow.push(sp.px[k] - sp.tz[k] * l, sp.py[k] + sp.ramp[k] - SLAB, sp.pz[k] + sp.tx[k] * l);
    }
  }
  if (geo.pos.length) {
    const mesh = new Mesh(geo.build(), toon({ vertexColors: true, side: DoubleSide }));
    mesh.matrixAutoUpdate = false;
    out.push(mesh);
  }
  if (glow.length) out.push(glowPoints(glow, 0xff6a1a, 7));
  if (lamps.length) out.push(glowPoints(lamps, 0xffb050, 5));
  return out;
}

/** A chevron painted across the road at sample `i`, its point 1.5 m ahead in the middle, a 0.8 m band. */
function chevron(geo: Geo, sp: BakedSpline, i: number, half: number, color: string): void {
  const p = (l: number, along: number) => {
    const k = Math.min(sp.n - 1, i + Math.round(along / sp.step));
    return [sp.px[k] - sp.tz[k] * l, sp.py[k] + sp.ramp[k] - l * Math.tan(sp.bank[k]) + LIFT * 2, sp.pz[k] + sp.tx[k] * l];
  };
  for (const side of [-1, 1]) geo.face(p(side * half, 0), p(side * half, 0.8), p(0, 2.3), p(0, 1.5), color);
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
function arch(geo: Geo, sp: BakedSpline, i: number, e: number, h: number, out: number, tall: boolean, look = LOOKS.lava): void {
  const p = (l: number, up: number, along: number) => [sp.px[i] - sp.tz[i] * l + sp.tx[i] * along, sp.py[i] + up, sp.pz[i] + sp.tx[i] * l + sp.tz[i] * along];
  const box = (l0: number, l1: number, y0: number, y1: number, color: string) => {
    const a = [p(l0, y0, -ARCH_DEPTH), p(l1, y0, -ARCH_DEPTH), p(l1, y1, -ARCH_DEPTH), p(l0, y1, -ARCH_DEPTH)];
    const b = [p(l0, y0, ARCH_DEPTH), p(l1, y0, ARCH_DEPTH), p(l1, y1, ARCH_DEPTH), p(l0, y1, ARCH_DEPTH)];
    for (let k = 0; k < 4; k++) geo.face(a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k], color);
    geo.face(a[0], a[1], a[2], a[3], color);
    geo.face(b[0], b[1], b[2], b[3], color);
  };
  const w = tall ? 6 : 2.5;
  box(-e - w, -e - 0.2, 0, h + 1.5, look.rock[1]);
  box(e + 0.2, e + w, 0, h + 1.5, look.rock[2]);
  box(-e - w, e + w, h, h + (tall ? 22 : 2.5), look.rock[0]);
  const f = (l: number, along: number) => [sp.px[i] - sp.tz[i] * l + sp.tx[i] * along, sp.py[i] - l * Math.tan(sp.bank[i]) - 0.06, sp.pz[i] + sp.tx[i] * l + sp.tz[i] * along];
  geo.face(f(-e - 2.5, 0), f(e + 2.5, 0), f(e + 2.5, out * 4), f(-e - 2.5, out * 4), look.dark);
}
