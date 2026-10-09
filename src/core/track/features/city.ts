// A city's ground (GroundDef.features; docs/CHASE_MODE.md, the getaway's city): paved inside its
// outline, its hills raised under it, and every crossing nearly level at the hills' height at its
// middle: San Francisco's flattened crossings on steep streets. A street climbing a hill meets each
// crossing at a rounded crest, a lift at speed (the hill jumps). Off the main road it's cut back to
// the road over CUT m, as the hills are, so the road round it keeps its own heights. Its parks are
// lawn (Dolores Park, on its hill).

import type { CityDef } from '../../content';
import { hypot, smoothstep as smooth } from '../../math';
import { KIND_OASIS, KIND_PAVED } from '../ground/surface';
import { hillHeight } from './hills';
import type { Feature } from '.';

/** Off the main road, the city's ground comes in over this many metres past the road's edge. */
const CUT = 24;
/**
 * A crossing's level eases into the street's slope over this many metres past its radius: long
 * enough that the street's grade comes back gradually (a crest, rounded) and no cell is a step. At
 * 2.5 m it was a lip a few metres high at 55° on the steep hills, and jagged where drawn.
 */
const EDGE = 16;
/**
 * How much of the way to level a crossing comes (1: flat). Not all of it: on a 30% hill two
 * crossings a block apart, each flat, left the street between them twice as steep as the hill.
 */
const FLATTEN = 0.7;
/** The crossings are found by a grid of this many metres a cell. */
const CELL = 40;

/** Whether (x, z) is inside the loop (even-odd). */
export function insideLoop(loop: readonly [number, number][], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, zi] = loop[i];
    const [xj, zj] = loop[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** The bands `inLoop` sorts a loop's edges into (m). */
const BAND = 10;

/**
 * `insideLoop` for many points against one loop: its edges sorted into bands of z, so each point
 * tests only the few its band crosses (a city's outline has a thousand edges; its ground, a quarter
 * of a million points).
 */
export function inLoop(loop: readonly [number, number][]): (x: number, z: number) => boolean {
  const bands = new Map<number, number[]>();
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const lo = Math.min(loop[i][1], loop[j][1]);
    const hi = Math.max(loop[i][1], loop[j][1]);
    for (let b = Math.floor(lo / BAND); b <= Math.floor(hi / BAND); b++) {
      const list = bands.get(b);
      if (list) list.push(i, j);
      else bands.set(b, [i, j]);
    }
  }
  return (x, z) => {
    const list = bands.get(Math.floor(z / BAND));
    if (!list) return false;
    let inside = false;
    for (let k = 0; k < list.length; k += 2) {
      const [xi, zi] = loop[list[k]];
      const [xj, zj] = loop[list[k + 1]];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };
}

/** The city's height at (x, z) (inside its outline): its base, its hills, its crossings level. */
export function cityHeight(c: CityDef): (x: number, z: number) => number {
  // Each crossing's level, and the crossings by grid cell (a crossing in every cell it reaches).
  const levels = c.level.map(([x, z]) => c.y + hillHeight(c.hills, x, z));
  const cells = new Map<number, number[]>();
  const key = (gx: number, gz: number) => (gx + 4096) * 8192 + (gz + 4096);
  c.level.forEach(([x, z, r], k) => {
    const reach = r + EDGE;
    for (let gx = Math.floor((x - reach) / CELL); gx <= Math.floor((x + reach) / CELL); gx++)
      for (let gz = Math.floor((z - reach) / CELL); gz <= Math.floor((z + reach) / CELL); gz++) {
        const list = cells.get(key(gx, gz));
        if (list) list.push(k);
        else cells.set(key(gx, gz), [k]);
      }
  });
  return (x, z) => {
    const raw = c.y + hillHeight(c.hills, x, z);
    const list = cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return raw;
    // Every crossing near enough pulls toward its level, by how far out of it (1 on it, 0 past its
    // edge); where two reach, together and no more than all the way (no seam where one's nearer).
    let pull = 0;
    let sum = 0;
    for (const k of list) {
      const [cx, cz, r] = c.level[k];
      const w = 1 - smooth(0, EDGE, hypot(x - cx, z - cz) - r);
      if (w <= 0) continue;
      pull += w;
      sum += w * FLATTEN * (levels[k] - raw);
    }
    if (pull <= 0) return raw;
    return raw + sum / Math.max(1, pull);
  };
}

export function cityFeature(c: CityDef): Feature {
  const height = cityHeight(c);
  const within = inLoop(c.outline);
  const parks = (c.parks ?? []).map(inLoop);
  return {
    kind: 'city',
    def: c,
    first: true,
    shape(p, y) {
      if (!within(p.x, p.z)) return y;
      // (Over a main-road tunnel, uncut: the road runs under it.)
      return y + (height(p.x, p.z) - y) * (p.rock ? 1 : smooth(p.edge, p.edge + (c.cut ?? CUT), p.d));
    },
    surface(x, z) {
      // (A park's lawn: driven as undergrowth, a short cut that costs a little. Out past the city
      // too: the Presidio's lawns, past Van Ness.)
      for (const park of parks) if (park(x, z)) return KIND_OASIS;
      return within(x, z) ? KIND_PAVED : -1;
    },
    bare(_s, _lat, x, z) {
      return within(x, z) || parks.some((park) => park(x, z));
    },
  };
}
