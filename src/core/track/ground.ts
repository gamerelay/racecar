// Open ground (docs/AVALANCHE.md): a heightfield the car drives on everywhere, the same one the
// renderer draws, for a layout with `ground`. Built once from the main road: on the road and its
// shoulder, the road's own height; off it, the land between the roads (relaxed smooth, so two
// stretches meet in a slope, not a cliff); then whatever the layout adds by where the point is
// along and across the road: rough snow off the road, mogul fields, canyons, and walls rising at the
// edges. All of it is yours to drive, ridges and mountainsides too: out of bounds is only off the
// grid, where the ground ends.
//
// A deck (GroundDef.decks, docs/PARADISE.md) is the main road over the ground, a bridge: there the
// grid is the ground under it (the bay), and the deck is the road's own plane, found by where the
// point is along and across it. A car on the deck drives on it; off its edge, it falls.
//
// Branches shape the ground too, off the main road: their own height on them, cut into a slope or
// built up over a dip. A branch's decks (GroundDef.branchDecks) leave the ground as it is: a tunnel
// where it's over the road (the Lava Tube through the volcano), a bridge where it's under. Wherever
// there's more than one surface, a car is on the highest one at or below it.
//
// Pure arithmetic from the layout, so every screen builds the same ground.

import type { GroundDef } from '../content';
import { hash01 } from '../rng';
import { curve, loopDist, shaftHeight } from './island';
import type { BakedSpline } from './bake';
import { cos, hypot, sq, tan } from '../math';

export interface Ground {
  /** The ground's height at (x, z), bilinear between grid points. */
  height(x: number, z: number): number;
  /** Its slope at (x, z): the rise per meter along x and along z, into `out`. */
  slope(x: number, z: number, out: { x: number; z: number }): { x: number; z: number };
  /** The grid, for drawing it: heights and, per point, how far across the main road it lies (m, + right). */
  readonly x0: number;
  readonly z0: number;
  readonly cell: number;
  readonly nx: number;
  readonly nz: number;
  readonly h: Float32Array;
  readonly lateral: Float32Array;
  /** Per point, the main road's sample nearest it. */
  readonly near: Int32Array;
  /** Off the grid, where the ground ends: out of bounds (anywhere drawn is in bounds). */
  outside(x: number, z: number): boolean;
  /** Per main-road sample, 1 where it's a deck (GroundDef.decks). */
  readonly deckSample: Uint8Array;
  /** Per branch (by its spline index), 1 per sample where it's a deck (GroundDef.branchDecks). */
  readonly branchDeck: Map<number, Uint8Array>;
  /** Per branch (by its spline index), 1 per sample where it's a gap: no road (GroundDef.branchGaps). */
  readonly branchGap: Map<number, Uint8Array>;
  /** Per grid point: 2 on a branch's road, 1 on its verge (and a little past: no trees), 0 off it. */
  readonly onBranch: Uint8Array;
  /** Per grid point on a branch's road, its surface. */
  readonly branchSurface: Uint8Array;
  /** Per grid point, 1 where the ground is left out of the drawing: a tunnel's mouth, opened in the slope. */
  readonly hole: Uint8Array;
  /** The sea's level (GroundDef.sea), if the ground has one. */
  readonly sea?: number;
  /** Steeper than this is a rock face (GroundDef.face), if the ground has them. */
  readonly face?: number;
  /**
   * Per main-road sample, its beach (GroundDef.beaches): which side (-1 left, 1 right) times how
   * far in from the beach's ends (0 to 1 over BEACH_FADE m); 0 with none.
   */
  readonly beach: Float32Array;
  /** Signed distance to the coast (GroundDef.coast), positive inland; Infinity with none. */
  coast(x: number, z: number): number;
  /** Whether (x, z) at height `y` is down in the volcano's lava lake (GroundDef.volcano). */
  inLava(x: number, z: number, y: number): boolean;
  /**
   * A deck's height at (x, z): its road's plane, if the point is over one, within `slack` m past
   * its edges (the road and its shoulder); the highest at or below `y` (by DECK_CATCH), if there's
   * more than one. NaN if there's none.
   */
  deck(x: number, z: number, slack?: number, y?: number): number;
  /** The deck something at height `y` at (x, z) is on (NaN if it's on the ground): the highest surface at or below it is a deck. */
  deckUnder(x: number, z: number, y: number): number;
  /** What's under (x, z) for something at height `y`: the highest surface at or below it (unset: the highest), else the ground. */
  top(x: number, z: number, y?: number): number;
  /** The slope of `top` at (x, z) for something at height `y`, into `out`. */
  topSlope(x: number, z: number, y: number, out: { x: number; z: number }): { x: number; z: number };
}

/** A beach's ends (GroundDef.beaches) fade in over this many meters. */
export const BEACH_FADE = 40;

/** On a deck: a car this far under its surface still drives on it (a hard landing); further down, it's under it. */
export const DECK_CATCH = 1;
/** A tunnel's ceiling over its road (m): where the ground's between its road and this, its mouth is open in the slope. */
export const TUBE_H = 7;


/** Off the road, the rough snow comes in over this many meters past the shoulder. */
const ROUGH_IN = 10;
/** An island's beach: the ground's height at the waterline over the sea, how steeply it rises inland of it (1:x), and the sea bed's depth (as the lapped island's land, terrain.ts). */
const SHORE = 1.2;
const SHORE_RISE = 0.6;
const SEA_BED = 9;
/** Off a road, the volcano's flank comes in over this many meters past its edge (a cutting, not a cliff). */
const CONE_IN = 40;
/** Mogul fields and canyons ease in at their edges over this many meters. */
const EDGE = 6;
/** Past the walls' foot (`wallFrom`), the grid reaches this far up them, and 20 m more, at its narrowest (GroundDef.wallOut). */
const WALL_OUT = 25;
/** The land between the roads is relaxed on a grid this coarse (m), this many passes. */
const BASE_CELL = 8;
const RELAX = 300;

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Smooth value noise, 0–1, at (x, z) in cells of `size` m (seeded by the grid, so the same everywhere). */
export function noise(x: number, z: number, size: number, seed = 91): number {
  const u = x / size;
  const v = z / size;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const su = fu * fu * (3 - 2 * fu);
  const sv = fv * fv * (3 - 2 * fv);
  const a = hash01(seed, i, j);
  const b = hash01(seed, i + 1, j);
  const c = hash01(seed, i, j + 1);
  const d = hash01(seed, i + 1, j + 1);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

/** How deep a canyon is `d` m from its middle: a flat floor, then a quarter-circle wall (radius 2 × depth, about 60° at the lip). */
export function canyonDepth(d: number, floor: number, depth: number): number {
  const half = floor / 2;
  if (d <= half) return depth;
  const r = 2 * depth;
  const reach = Math.sqrt(2 * r * depth - depth * depth);
  const x = d - half;
  if (x >= reach) return 0;
  return depth - (r - Math.sqrt(r * r - x * x));
}

/** How far down in a canyon `s` m along the main road and `lat` m across it is (0: in none). */
export function canyonAt(def: GroundDef, s: number, lat: number): number {
  let h = 0;
  for (const c of def.canyons ?? []) {
    if (s < c.s[0] || s > c.s[1]) continue;
    const ease = smooth(0, c.ease, Math.min(s - c.s[0], c.s[1] - s));
    h += canyonDepth(Math.abs(lat - c.lateral), c.floor, c.depth * ease);
  }
  return h;
}

/** What `def` adds to the road's height at `s` m along the main road and `lat` m across it (road half width `half`, shoulder `shoulder`). */
export function groundShape(def: GroundDef, s: number, lat: number, half: number, shoulder: number, x: number, z: number): number {
  const a = Math.abs(lat);
  let h = 0;
  // Swell: long, low rolls everywhere, the piste too (it tilts you a little, side to side).
  if (def.swell) h += def.swell.height * (noise(x, z, def.swell.size, 37) - 0.5);
  if (def.rough) h += def.rough.height * noise(x, z, def.rough.size) * smooth(half + shoulder, half + shoulder + ROUGH_IN, a);
  for (const m of def.moguls ?? []) {
    if (s < m.s[0] || s > m.s[1] || lat < m.lateral[0] || lat > m.lateral[1]) continue;
    const fade = smooth(0, EDGE, Math.min(s - m.s[0], m.s[1] - s, lat - m.lateral[0], m.lateral[1] - lat));
    // Bumps on a grid, flat between them; every other row offset half a bump, like skied moguls.
    const row = Math.floor(s / m.spacing);
    const off = row % 2 ? m.spacing / 2 : 0;
    const bu = 0.5 - 0.5 * cos((2 * Math.PI * s) / m.spacing);
    const bv = 0.5 - 0.5 * cos((2 * Math.PI * (lat + off)) / m.spacing);
    h += m.height * bu * bv * fade;
  }
  h -= canyonAt(def, s, lat);
  if (a > def.wallFrom) h += (a - def.wallFrom) * def.wallRise;
  return h;
}

/** The ground's swell and bumps fade out over this many meters of road before a deck, so the road meets the deck at its own height. */
const DECK_RUN_IN = 30;

/**
 * How much of what the layout adds (swell, bumps) the ground keeps `s` m along the main road and
 * `d` m from its middle (0–1): none where a deck starts or ends, on the road and out to the deck's
 * reach, so a car rolls onto the deck at the height it is, not a step up or down (a step of more
 * than DECK_CATCH would take it under the deck).
 */
export function deckRunIn(decks: GroundDef['decks'], s: number, d: number, edge: number): number {
  let keep = 1;
  for (const dk of decks ?? []) {
    const out = s < dk.s[0] ? dk.s[0] - s : s > dk.s[1] ? s - dk.s[1] : 0;
    if (out >= DECK_RUN_IN) continue;
    const near = 1 - smooth(edge, edge + dk.reach, d);
    keep = Math.min(keep, 1 - (1 - smooth(0, DECK_RUN_IN, out)) * near);
  }
  return keep;
}

/** How far toward a deck's floor the ground `s` m along the main road and `d` m from its middle is pulled (0–1; the road's edge `edge` m out). */
export function deckPull(deck: NonNullable<GroundDef['decks']>[number], s: number, d: number, edge: number): number {
  if (s < deck.s[0] || s > deck.s[1]) return 0;
  return smooth(0, deck.ease, Math.min(s - deck.s[0], deck.s[1] - s)) * (1 - smooth(edge, edge + deck.reach, d));
}

/** The search's coarse samples: one in this many of the road's. */
const COARSE = 8;

/**
 * The nearest of `main`'s samples to a point, exactly, bucketed `B` m. Per bucket, once: every
 * coarse sample (one in COARSE) that could be nearest to a point in it, by rings of buckets out
 * from it. Per point: the nearest of those, then every sample near any of them that could still
 * beat it (a sample is at most COARSE/2 samples from the coarse one it rounds to). Searching every
 * sample in rings for every point was 1.7 s of Avalanche's 2 s bake, nearly all of it in empty
 * buckets far off the road.
 */
function sampleSearch(main: BakedSpline, x0: number, z0: number, w: number, d: number, B: number) {
  const bx = Math.ceil(w / B);
  const bz = Math.ceil(d / B);
  const half = COARSE / 2;
  const slack = half * main.step;
  // The coarse samples, each standing for the samples within `half` of it.
  const reps: number[] = [];
  for (let j = 0; j - half <= main.n - 1; j += COARSE) reps.push(Math.min(j, main.n - 1));
  const buckets: number[][] = Array.from({ length: bx * bz }, () => []);
  for (let k = 0; k < reps.length; k++) {
    const i = reps[k];
    buckets[Math.floor((main.pz[i] - z0) / B) * bx + Math.floor((main.px[i] - x0) / B)].push(k);
  }
  const reach = Math.max(bx, bz);
  const dist2 = (i: number, x: number, z: number) => sq(main.px[i] - x) + sq(main.pz[i] - z);
  /** Every coarse sample in rings of buckets out from bucket (cx, cz), while a ring could hold one within `limit()` m of (x, z). */
  const rings = (cx: number, cz: number, x: number, z: number, limit: () => number, visit: (k: number, e: number) => void) => {
    for (let r = 0; r <= reach && Math.max(0, r - 1) * B < limit(); r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const ux = cx + dx;
          const uz = cz + dz;
          if (ux < 0 || uz < 0 || ux >= bx || uz >= bz) continue;
          for (const k of buckets[uz * bx + ux]) visit(k, dist2(reps[k], x, z));
        }
      }
    }
  };
  // A point in a bucket is within `rho` of its middle, so its nearest is within 2 rho (and the
  // slack) of the middle's nearest.
  const rho = (B * Math.SQRT2) / 2;
  const lists: (Int32Array | undefined)[] = new Array(bx * bz);
  const candidates = (cx: number, cz: number) => {
    const x = x0 + (cx + 0.5) * B;
    const z = z0 + (cz + 0.5) * B;
    let mid = Infinity;
    rings(cx, cz, x, z, () => Math.sqrt(mid), (_k, e) => (mid = Math.min(mid, e)));
    const within = Math.sqrt(mid) + 2 * rho + slack;
    const out: number[] = [];
    rings(cx, cz, x, z, () => within, (k, e) => {
      if (e <= within * within) out.push(k);
    });
    return Int32Array.from(out);
  };
  const found = { i: 0, d: Infinity };
  let best = -1;
  let bestD = Infinity;
  let px = 0;
  let pz = 0;
  /** The samples coarse sample `k` stands for, against the best so far. */
  const refine = (k: number) => {
    const lo = Math.max(0, k * COARSE - half);
    const hi = Math.min(main.n - 1, Math.max(reps[k], k * COARSE + half));
    for (let i = lo; i <= hi; i++) {
      const e = dist2(i, px, pz);
      if (e < bestD || (e === bestD && i < best)) {
        bestD = e;
        best = i;
      }
    }
  };
  return (x: number, z: number) => {
    const cx = Math.min(bx - 1, Math.max(0, Math.floor((x - x0) / B)));
    const cz = Math.min(bz - 1, Math.max(0, Math.floor((z - z0) / B)));
    const list = (lists[cz * bx + cx] ??= candidates(cx, cz));
    // The nearest coarse sample, then every sample that could beat what's found near it.
    let coarse = list[0];
    let coarseD = Infinity;
    for (let n = 0; n < list.length; n++) {
      const e = dist2(reps[list[n]], x, z);
      if (e < coarseD) {
        coarseD = e;
        coarse = list[n];
      }
    }
    px = x;
    pz = z;
    best = -1;
    bestD = Infinity;
    refine(coarse);
    const bound = sq(Math.sqrt(bestD) + slack);
    for (let n = 0; n < list.length; n++) if (list[n] !== coarse && dist2(reps[list[n]], x, z) <= bound) refine(list[n]);
    found.i = best;
    found.d = Math.sqrt(bestD);
    return found;
  };
}

/** The road's plane at (x, z) as `sp`'s sample `i` carries it out (its slope along, its bank across, a kicker's height over its flank). */
function planeOf(sp: BakedSpline, i: number, x: number, z: number): number {
  const j = sp.closed ? (i + 1) % sp.n : Math.min(sp.n - 1, i + 1);
  const along = (x - sp.px[i]) * sp.tx[i] + (z - sp.pz[i]) * sp.tz[i];
  const lat = (x - sp.px[i]) * -sp.tz[i] + (z - sp.pz[i]) * sp.tx[i];
  const rise = (sp.py[j] - sp.py[i]) / sp.step;
  // A kicker's height runs out past the road's edge over its flank (RampDef.flank; 8 m unset),
  // so it's a bump on the piste, not a ridge across the mountain.
  let ramp = 0;
  if (sp.ramp[i] > 0 || sp.ramp[j] > 0) {
    const over = Math.abs(lat) - sp.width[i] / 2 - sp.shoulder[i];
    const fade = over <= 0 ? 1 : Math.max(0, 1 - over / (sp.rampFlank[i] || 8));
    ramp = (sp.ramp[i] + ((sp.ramp[j] - sp.ramp[i]) * along) / sp.step) * fade;
  }
  return sp.py[i] + ramp + along * rise - lat * tan(sp.bank[i]);
}

/** The branches' deck samples are bucketed this big (m), to find the one over a point. */
const DECK_BUCKET = 8;

/** The ground for `def` round `main`, and its `branches`. */
export function buildGround(def: GroundDef, main: BakedSpline, branches: BakedSpline[] = []): Ground {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < main.n; i++) {
    minX = Math.min(minX, main.px[i]);
    maxX = Math.max(maxX, main.px[i]);
    minZ = Math.min(minZ, main.pz[i]);
    maxZ = Math.max(maxZ, main.pz[i]);
  }
  const wallOut = def.wallOut ?? WALL_OUT;
  const margin = def.wallFrom + wallOut + 20;
  const cell = def.cell;
  const x0 = Math.floor((minX - margin) / cell) * cell;
  const z0 = Math.floor((minZ - margin) / cell) * cell;
  const nx = Math.ceil((maxX + margin - x0) / cell) + 1;
  const nz = Math.ceil((maxZ + margin - z0) / cell) + 1;
  const nearest = sampleSearch(main, x0, z0, nx * cell, nz * cell, 24);
  const sea = def.sea ?? 0;
  const coastLoop = def.coast && def.coast.length > 2 ? curve([...def.coast, def.coast[0]], 12) : null;
  const coast = (x: number, z: number) => (coastLoop ? loopDist(coastLoop, x, z) : Infinity);
  const volcano = def.volcano;
  const plane = (i: number, x: number, z: number) => planeOf(main, i, x, z);

  // The land between the roads, on a coarse grid: the road's height on the road, and off it relaxed
  // smooth from the road's plane carried out. Carried out alone, the plane jumps where two stretches
  // are equally near (the ridge between the run and the road back, inside a switchback); relaxed,
  // they meet in a slope.
  const C = BASE_CELL;
  const cnx = Math.ceil(((nx - 1) * cell) / C) + 1;
  const cnz = Math.ceil(((nz - 1) * cell) / C) + 1;
  const base = new Float32Array(cnx * cnz);
  const fixed = new Uint8Array(cnx * cnz);
  for (let cz = 0; cz < cnz; cz++) {
    for (let cx = 0; cx < cnx; cx++) {
      const x = x0 + cx * C;
      const z = z0 + cz * C;
      const a = nearest(x, z);
      base[cz * cnx + cx] = plane(a.i, x, z);
      fixed[cz * cnx + cx] = a.d < main.width[a.i] / 2 + main.shoulder[a.i] ? 1 : 0;
    }
  }
  for (let it = 0; it < RELAX; it++) {
    for (let cz = 0; cz < cnz; cz++) {
      for (let cx = 0; cx < cnx; cx++) {
        const k = cz * cnx + cx;
        if (fixed[k]) continue;
        // Gauss–Seidel, the grid's edges mirrored.
        const l = base[k - (cx > 0 ? 1 : 0)];
        const r = base[k + (cx < cnx - 1 ? 1 : 0)];
        const u = base[k - (cz > 0 ? cnx : 0)];
        const d = base[k + (cz < cnz - 1 ? cnx : 0)];
        base[k] = (l + r + u + d) / 4;
      }
    }
  }
  const land = (x: number, z: number) => {
    const u = Math.min(cnx - 1.001, Math.max(0, (x - x0) / C));
    const v = Math.min(cnz - 1.001, Math.max(0, (z - z0) / C));
    const gx = Math.floor(u);
    const gz = Math.floor(v);
    const fu = u - gx;
    const fv = v - gz;
    const k = gz * cnx + gx;
    return base[k] + (base[k + 1] - base[k]) * fu + (base[k + cnx] - base[k]) * fv + (base[k] - base[k + 1] - base[k + cnx] + base[k + cnx + 1]) * fu * fv;
  };

  const h = new Float32Array(nx * nz);
  const lateral = new Float32Array(nx * nz);
  const near = new Int32Array(nx * nz);
  for (let gz = 0; gz < nz; gz++) {
    for (let gx = 0; gx < nx; gx++) {
      const x = x0 + gx * cell;
      const z = z0 + gz * cell;
      const g = gz * nx + gx;
      const { i, d } = nearest(x, z);
      const along = (x - main.px[i]) * main.tx[i] + (z - main.pz[i]) * main.tz[i];
      const lat = (x - main.px[i]) * -main.tz[i] + (z - main.pz[i]) * main.tx[i];
      // On the road and its shoulder, the road exactly; out through the rough snow, the land.
      const half = main.width[i] / 2;
      const edge = half + main.shoulder[i];
      const road = plane(i, x, z);
      const y = road + (land(x, z) - road) * smooth(edge, edge + ROUGH_IN, d);
      // What the layout adds, by the distance across (not the lateral: that jumps between stretches).
      const s = i * main.step + along;
      let gy = y + groundShape(def, s, lat < 0 ? -d : d, half, main.shoulder[i], x, z) * deckRunIn(def.decks, s, d, edge);
      // The volcano rises off the roads (cut back to them over CONE_IN), and the coast falls away
      // into the sea, a beach along it: off them, the road's own height on them.
      if (volcano) {
        // (A shaft for a crater: inside the lip the walls fall nearly sheer to its floor.)
        const cone = sea + shaftHeight(volcano, x, z);
        const pit = volcano.pit !== undefined && hypot(x - volcano.x, z - volcano.z) < volcano.crater;
        if (cone > gy || pit) gy += (cone - gy) * smooth(edge, edge + CONE_IN, d);
      }
      if (coastLoop) {
        const sd = coast(x, z);
        let isle = gy;
        if (sd > 20) isle = Math.max(isle, sea + SHORE);
        isle = Math.min(isle, sea - SEA_BED + (SEA_BED + SHORE) * smooth(-90, 2, sd) + Math.max(0, sd - 2) * SHORE_RISE);
        gy += (isle - gy) * smooth(edge, edge + ROUGH_IN, d);
      }
      // Under a deck, the ground falls away to its floor.
      for (const dk of def.decks ?? []) {
        const pull = deckPull(dk, s, d, edge);
        if (pull > 0 && dk.floor < gy) gy += (dk.floor - gy) * pull;
      }
      h[g] = gy;
      lateral[g] = lat < 0 ? -d : d;
      near[g] = i;
    }
  }

  // Which samples are deck.
  const fillSpan = (out: Uint8Array, sp: BakedSpline, span: [number, number]) => {
    for (let i = Math.max(0, Math.ceil(span[0] / sp.step)); i <= Math.min(sp.n - 1, Math.floor(span[1] / sp.step)); i++) out[i] = 1;
  };
  const deckSample = new Uint8Array(main.n);
  for (const dk of def.decks ?? []) fillSpan(deckSample, main, dk.s);
  const hasDeck = deckSample.some((v) => v === 1);
  const beach = new Float32Array(main.n);
  for (const b of def.beaches ?? []) {
    const len = (((b.s[1] - b.s[0]) % main.length) + main.length) % main.length;
    const side = b.side === 'left' ? -1 : 1;
    for (let d = 0; d <= len; d += main.step) {
      const i = Math.round((((b.s[0] + d) % main.length) + main.length) % main.length / main.step) % main.n;
      beach[i] = side * smooth(0, BEACH_FADE, Math.min(d, len - d));
    }
  }
  const branchDeck = new Map<number, Uint8Array>();
  for (const dk of def.branchDecks ?? []) {
    const sp = branches.find((b) => b.id === dk.spline);
    if (!sp) continue;
    let m = branchDeck.get(sp.index);
    if (!m) branchDeck.set(sp.index, (m = new Uint8Array(sp.n)));
    fillSpan(m, sp, dk.s);
  }
  // A branch's gaps (GroundDef.branchGaps): no road, so nothing shaped under them either.
  const branchGap = new Map<number, Uint8Array>();
  for (const gp of def.branchGaps ?? []) {
    const sp = branches.find((b) => b.id === gp.spline);
    if (!sp) continue;
    let m = branchGap.get(sp.index);
    if (!m) branchGap.set(sp.index, (m = new Uint8Array(sp.n)));
    fillSpan(m, sp, gp.s);
  }

  // The branches, off the main road: each grid point near one takes its nearest sample's plane,
  // eased out past its edge into what's there (a cutting into a slope). Not on its decks: there the
  // ground stays (over a tunnel, under a bridge). Not on the main road: it has the junctions.
  const onBranch = new Uint8Array(nx * nz);
  const branchSurface = new Uint8Array(nx * nz);
  const hole = new Uint8Array(nx * nz);
  if (branches.length) {
    const bestD = new Float32Array(nx * nz).fill(Infinity);
    const bestY = new Float32Array(nx * nz);
    const bestEdge = new Float32Array(nx * nz);
    const bestHalf = new Float32Array(nx * nz);
    const each = (sp: BakedSpline, i: number, reach: number, fn: (g: number, x: number, z: number, d: number) => void) => {
      const gx0 = Math.max(0, Math.floor((sp.px[i] - reach - x0) / cell));
      const gx1 = Math.min(nx - 1, Math.ceil((sp.px[i] + reach - x0) / cell));
      const gz0 = Math.max(0, Math.floor((sp.pz[i] - reach - z0) / cell));
      const gz1 = Math.min(nz - 1, Math.ceil((sp.pz[i] + reach - z0) / cell));
      for (let gz = gz0; gz <= gz1; gz++)
        for (let gx = gx0; gx <= gx1; gx++) {
          const x = x0 + gx * cell;
          const z = z0 + gz * cell;
          const d = hypot(x - sp.px[i], z - sp.pz[i]);
          if (d < reach) fn(gz * nx + gx, x, z, d);
        }
    };
    for (const sp of branches) {
      const decks = branchDeck.get(sp.index);
      const gaps = branchGap.get(sp.index);
      for (let i = 0; i < sp.n; i++) {
        const edge = sp.width[i] / 2 + sp.shoulder[i];
        if (decks?.[i] || gaps?.[i]) continue;
        each(sp, i, edge + ROUGH_IN, (g, x, z, d) => {
          if (d >= bestD[g]) return;
          bestD[g] = d;
          bestY[g] = planeOf(sp, i, x, z);
          bestEdge[g] = edge;
          bestHalf[g] = sp.width[i] / 2;
          branchSurface[g] = sp.surface[i];
        });
      }
    }
    for (let g = 0; g < nx * nz; g++) {
      const d = bestD[g];
      if (d === Infinity) continue;
      const i = near[g];
      if (Math.abs(lateral[g]) < main.width[i] / 2 + main.shoulder[i]) continue;
      h[g] += (bestY[g] - h[g]) * (1 - smooth(bestEdge[g], bestEdge[g] + ROUGH_IN, d));
      onBranch[g] = d <= bestHalf[g] ? 2 : d <= bestEdge[g] + 3 ? 1 : 0;
    }
    // A tunnel's mouth: where the slope comes down into the space over its road, it's open (after
    // the cuttings are shaped: one's floor at the road's height stays).
    for (const sp of branches) {
      const decks = branchDeck.get(sp.index);
      if (!decks) continue;
      for (let i = 0; i < sp.n; i++) {
        if (!decks[i]) continue;
        const road = sp.py[i];
        each(sp, i, sp.width[i] / 2 + sp.shoulder[i], (g, x, z) => {
          // Only across this sample's own strip of road (not spilling back onto a cutting behind
          // the first), and never in the main road: a mouth stays clear of it.
          if (Math.abs((x - sp.px[i]) * sp.tx[i] + (z - sp.pz[i]) * sp.tz[i]) > sp.step * 0.75) return;
          if (Math.abs(lateral[g]) < main.width[near[g]] / 2 + main.shoulder[near[g]] + 2) return;
          // Over the road and under its ceiling: not a cutting's floor at the road's height, nor
          // the slope over the mouth (its arch frames the edge).
          if (h[g] > road + 0.8 && h[g] < road + TUBE_H) hole[g] = 1;
        });
      }
    }
  }
  // The branches' deck samples, bucketed.
  const bx = Math.ceil((nx * cell) / DECK_BUCKET);
  const bz = Math.ceil((nz * cell) / DECK_BUCKET);
  const buckets = new Map<number, number[]>();
  const deckBranches = branches.filter((b) => branchDeck.has(b.index));
  deckBranches.forEach((sp, k) => {
    const m = branchDeck.get(sp.index)!;
    for (let i = 0; i < sp.n; i++) {
      if (!m[i]) continue;
      const key = Math.floor((sp.pz[i] - z0) / DECK_BUCKET) * bx + Math.floor((sp.px[i] - x0) / DECK_BUCKET);
      let list = buckets.get(key);
      if (!list) buckets.set(key, (list = []));
      list.push(k * 65536 + i);
    }
  });
  const near2 = new Float64Array(deckBranches.length);
  const nearI = new Int32Array(deckBranches.length);
  /** The highest of the branches' decks over (x, z) within `slack`, at or below `top`. */
  const branchDeckAt = (x: number, z: number, slack: number, top: number) => {
    if (!deckBranches.length) return NaN;
    near2.fill(Infinity);
    const r = Math.ceil((12 + slack) / DECK_BUCKET);
    const cx = Math.floor((x - x0) / DECK_BUCKET);
    const cz = Math.floor((z - z0) / DECK_BUCKET);
    for (let a = Math.max(0, cz - r); a <= Math.min(bz - 1, cz + r); a++)
      for (let b = Math.max(0, cx - r); b <= Math.min(bx - 1, cx + r); b++) {
        const list = buckets.get(a * bx + b);
        if (!list) continue;
        for (const v of list) {
          const k = v >> 16;
          const i = v & 65535;
          const sp = deckBranches[k];
          const e = sq(sp.px[i] - x) + sq(sp.pz[i] - z);
          if (e < near2[k]) {
            near2[k] = e;
            nearI[k] = i;
          }
        }
      }
    let best = NaN;
    for (let k = 0; k < deckBranches.length; k++) {
      if (near2[k] === Infinity) continue;
      const sp = deckBranches[k];
      const i = nearI[k];
      const along = (x - sp.px[i]) * sp.tx[i] + (z - sp.pz[i]) * sp.tz[i];
      const lat = (x - sp.px[i]) * -sp.tz[i] + (z - sp.pz[i]) * sp.tx[i];
      // Past the deck's end it isn't over it (its nearest deck sample is its last one).
      if (Math.abs(along) > sp.step || Math.abs(lat) > sp.width[i] / 2 + sp.shoulder[i] + slack) continue;
      const y = planeOf(sp, i, x, z);
      if (y <= top + DECK_CATCH && !(y <= best)) best = y;
    }
    return best;
  };
  const d2 = (i: number, x: number, z: number) => sq(main.px[i] - x) + sq(main.pz[i] - z);
  const next = (i: number, by: number) => (main.closed ? (i + by + main.n) % main.n : Math.min(main.n - 1, Math.max(0, i + by)));

  const at = (gx: number, gz: number) => h[Math.min(nz - 1, Math.max(0, gz)) * nx + Math.min(nx - 1, Math.max(0, gx))];
  return {
    x0,
    z0,
    cell,
    nx,
    nz,
    h,
    lateral,
    near,
    deckSample,
    beach,
    branchDeck,
    branchGap,
    onBranch,
    branchSurface,
    hole,
    sea: def.sea,
    face: def.face,
    coast,
    inLava(x, z, y) {
      return !!volcano && sq(x - volcano.x) + sq(z - volcano.z) < sq(volcano.crater) && y < sea + volcano.lava + 0.3;
    },
    deck(x, z, slack = 0, y = Infinity) {
      const other = branchDeckAt(x, z, slack, y);
      if (!hasDeck) return other;
      const gx = Math.min(nx - 1, Math.max(0, Math.round((x - x0) / cell)));
      const gz = Math.min(nz - 1, Math.max(0, Math.round((z - z0) / cell)));
      // The grid point's nearest sample, then down the road to the point's own.
      let i = near[gz * nx + gx];
      let e = d2(i, x, z);
      for (const by of [1, -1]) {
        for (let k = 0; k < 8; k++) {
          const j = next(i, by);
          const f = d2(j, x, z);
          if (f >= e) break;
          i = j;
          e = f;
        }
      }
      if (!deckSample[i]) return other;
      const lat = (x - main.px[i]) * -main.tz[i] + (z - main.pz[i]) * main.tx[i];
      if (Math.abs(lat) > main.width[i] / 2 + main.shoulder[i] + slack) return other;
      const mine = plane(i, x, z);
      if (mine > y + DECK_CATCH) return other;
      return other > mine ? other : mine;
    },
    deckUnder(x, z, y) {
      const d = this.deck(x, z, 0, y);
      if (!(d === d)) return NaN;
      const gh = this.height(x, z);
      // Over the ground (a bridge), the deck; under it by more than a hard landing (a tunnel's roof
      // over the car), the deck too; and under it by less (a tunnel's mouth, its slope rising off
      // the road) the deck for a car on it, within a hard landing of it: the slope over the mouth
      // rises off the road, and riding it carried cars up into the rock.
      if (d >= gh || gh > y + DECK_CATCH) return d;
      return y !== Infinity && Math.abs(y - d) <= DECK_CATCH ? d : NaN;
    },
    top(x, z, y = Infinity) {
      const d = this.deckUnder(x, z, y);
      return d === d ? d : this.height(x, z);
    },
    topSlope(x, z, y, out) {
      const d = this.deckUnder(x, z, y);
      if (!(d === d)) return this.slope(x, z, out);
      // The deck's own plane, a little past its edge if need be.
      const e = cell / 2;
      const on = (px: number, pz: number) => {
        const v = this.deck(px, pz, e + 1, d + DECK_CATCH);
        return v === v ? v : d;
      };
      out.x = (on(x + e, z) - on(x - e, z)) / (2 * e);
      out.z = (on(x, z + e) - on(x, z - e)) / (2 * e);
      return out;
    },
    outside(x, z) {
      const gx = Math.round((x - x0) / cell);
      const gz = Math.round((z - z0) / cell);
      // (The owner: an invisible wall up a slope, with snow drawn on past it, was no fun. A ridge
      // between two stretches, a mountainside: drive it, jump off it.)
      return gx < 1 || gz < 1 || gx >= nx - 1 || gz >= nz - 1;
    },
    height(x, z) {
      const u = (x - x0) / cell;
      const v = (z - z0) / cell;
      const gx = Math.floor(u);
      const gz = Math.floor(v);
      const fu = u - gx;
      const fv = v - gz;
      const a = at(gx, gz);
      const b = at(gx + 1, gz);
      const c = at(gx, gz + 1);
      const d = at(gx + 1, gz + 1);
      return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
    },
    slope(x, z, out) {
      const e = cell / 2;
      out.x = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
      out.z = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
      return out;
    },
  };
}
