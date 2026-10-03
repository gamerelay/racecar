// What's at a point (docs/CALDERA.md, "Developer tools"): the road it's nearest and where on it,
// the surface a car there drives on, and on open ground the heights there (the ground, a deck,
// what a car at `y` stands on), a tunnel's mouth, the coast, the lava. The first thing to check
// when something feels wrong at a spot. Dev only: plain objects, allocating freely.

import type { Track } from '../core/track/bake';
import { newHit, projectGlobal, sampleAt, surfaceAt, type TrackHit } from '../core/track/query';

export interface RoadSpot {
  /** The road's id ("lava-tube"; the main road is the layout's id) and its index in `track.splines`. */
  road: string;
  spline: number;
  /** Meters along it, and across it (+ right of the way it runs). */
  s: number;
  lateral: number;
  width: number;
  shoulder: number;
  /** 'road' on the asphalt, 'verge' on its shoulder, 'off' past it. */
  on: 'road' | 'verge' | 'off';
}

export interface Probe {
  x: number;
  z: number;
  /** The height asked about (or, unasked, what a car dropped here lands on). */
  y: number;
  /** The road nearest (the one the point is most inside of). */
  near: RoadSpot;
  /** The surface a car here drives on (wet off). */
  surface: string;
  /** Open ground only. */
  ground?: {
    /** In bounds (on the grid). */
    inside: boolean;
    /** The ground's own height, its grade (% up along x and z), and what a car at `y` stands on. */
    height: number;
    grade: [number, number];
    stand: number;
    /** 'deck' when what it stands on is a deck (a bridge, a tunnel's road), else 'ground'. */
    on: 'deck' | 'ground';
    /** The highest deck over the point, if any (a car on the ground under it is under a bridge or over a tunnel). */
    deck: number | null;
    /** The slope's opened here (a tunnel's mouth), the main road's beach side (-1, 1, 0), meters inland, in the lava. */
    hole: boolean;
    beach: number;
    coast: number | null;
    lava: boolean;
  };
}

/** The road a point is most inside of: the least distance past its edge (negative inside). */
export function nearestRoad(track: Track, x: number, z: number, y?: number, out: TrackHit = newHit()): RoadSpot {
  let best: RoadSpot | null = null;
  let bestPast = Infinity;
  const hit = newHit();
  for (const sp of track.splines) {
    projectGlobal(sp, x, z, hit, y);
    const past = Math.abs(hit.lateral) - hit.width / 2 - hit.shoulder;
    // A branch only counts on its own stretch: near its ends it lies on the main road.
    if (past < bestPast - 1e-9) {
      bestPast = past;
      Object.assign(out, hit);
      const on = Math.abs(hit.lateral) <= hit.width / 2 ? 'road' : past <= 0 ? 'verge' : 'off';
      best = { road: sp.id, spline: sp.index, s: hit.s, lateral: hit.lateral, width: hit.width, shoulder: hit.shoulder, on };
    }
  }
  return best!;
}

export function probe(track: Track, x: number, z: number, y?: number): Probe {
  const hit = newHit();
  const g = track.ground;
  const yy = y ?? (g ? g.top(x, z) : sampleAt(track.main, 0, newHit()).cy);
  const near = nearestRoad(track, x, z, yy, hit);
  const shoulder = track.surfaceIndex.get(track.layout.shoulderSurface ?? 'sidewalk') ?? 0;
  const out: Probe = { x, z, y: yy, near, surface: track.surfaces[surfaceAt(track, hit, false, shoulder)].id };
  if (!g) {
    if (y === undefined) out.y = hit.ground;
    return out;
  }
  const gx = Math.round((x - g.x0) / g.cell);
  const gz = Math.round((z - g.z0) / g.cell);
  const k = gx >= 0 && gz >= 0 && gx < g.nx && gz < g.nz ? gz * g.nx + gx : -1;
  const slope = g.slope(x, z, { x: 0, z: 0 });
  const under = g.deckUnder(x, z, yy);
  const deck = g.deck(x, z);
  const coast = g.coast(x, z);
  const nearMain = k >= 0 ? g.near[k] : -1;
  out.ground = {
    inside: !g.outside(x, z),
    height: g.height(x, z),
    grade: [slope.x * 100, slope.z * 100],
    stand: g.top(x, z, yy),
    on: under === under ? 'deck' : 'ground',
    deck: deck === deck ? deck : null,
    hole: k >= 0 && g.hole[k] === 1,
    beach: nearMain >= 0 ? Math.sign(g.beach[nearMain]) : 0,
    coast: Number.isFinite(coast) ? coast : null,
    lava: g.inLava(x, z, yy),
  };
  return out;
}

/** A probe as a few lines of text. */
export function describeProbe(p: Probe): string {
  const f = (v: number, d = 2) => v.toFixed(d);
  const lines = [
    `at x ${f(p.x, 1)}, z ${f(p.z, 1)}, y ${f(p.y)}`,
    `road: ${p.near.road} (spline ${p.near.spline}) s ${f(p.near.s, 1)}, lateral ${f(p.near.lateral)} (${p.near.on}; road ${f(p.near.width, 1)} m wide, shoulder ${f(p.near.shoulder, 1)})`,
    `surface: ${p.surface}`,
  ];
  const g = p.ground;
  if (g) {
    lines.push(`ground: ${f(g.height)} m, grade ${f(g.grade[0], 1)}% / ${f(g.grade[1], 1)}% (x / z)${g.inside ? '' : ', OUT OF BOUNDS'}`);
    lines.push(`stands on: ${g.on} at ${f(g.stand)} m${g.deck !== null ? `; highest deck here ${f(g.deck)} m` : ''}`);
    const flags = [g.hole && "a tunnel's mouth (the slope's open)", g.lava && 'IN THE LAVA', g.beach && `beach (${g.beach < 0 ? 'left' : 'right'} of the main road)`, g.coast !== null && `${f(g.coast, 0)} m inland`].filter(Boolean);
    if (flags.length) lines.push(flags.join('; '));
  }
  return lines.join('\n');
}
