// Overrides (docs/CALDERA.md, "Overrides: the escape hatch"): one map's own code for one small
// region, where an engine feature for one corner isn't worth it. Declared in the layout (`overrides`:
// an id, the reason, the region), the code in core/maps/<map>/overrides.ts keyed by that id. It runs
// only through the fixed hooks below, inside its region only, after every feature's, and wins: it
// never replaces an engine function, so what a function does is always what it says.
//
// Meant to be rare, and each one is a to-do: when the same kind turns up twice it becomes an engine
// feature and the overrides go. Like everything in core, a pure function of position, time and seed,
// with no allocation per tick.

import type { OverrideDef } from '../content';
import type { SimState } from '../state';
import type { BakedSpline } from './bake';
import type { Cast, Hazard } from './ground';

/** Where a car comes back after a wreck: `s` m along a road (unset: the main road), `lateral` across it. */
export interface RespawnSpot {
  road?: string;
  s: number;
  lateral: number;
}

/**
 * An override's code (core/maps/<map>/overrides.ts). Every hook is optional, runs only for a point
 * (or a car) inside the region, after every feature's, and has the last word.
 */
export interface OverrideCode {
  /** What's under (x, y, z): change `out` (its floor, piece, space). Every `cast`, `top` and `topSlope` sees it. */
  cast?(out: Cast, x: number, y: number, z: number): void;
  /** The surface a car at (x, y, z) drives on (an index into the track's surfaces), given what the engine found. */
  surface?(surface: number, x: number, y: number, z: number): number;
  /** What's dangerous at (x, y, z) at time `t`, given what the features said. Open ground only. */
  hazard?(hazard: Hazard, x: number, y: number, z: number, t: number): Hazard;
  /** A wrecked car whose comeback spot falls inside comes back here instead. */
  respawn?: RespawnSpot;
  /** Per tick, for each of your own cars inside (after it's stepped, before collisions). No allocation. */
  step?(sim: SimState, car: number): void;
}

/** An override bound to its region: the layout's declaration and its code. */
export interface Override extends OverrideCode {
  id: string;
  reason: string;
  /** Whether (x, z) is inside its region. */
  inside(x: number, z: number): boolean;
  /** Its region's outline, [x, z] pairs in order (a box's four corners; a stretch's edges, out one side and back the other), for tools and drawing. */
  outline: Float64Array;
}

/** Why an override's region can't be built (unknown road, empty stretch), or '' if it can. */
export function regionProblem(def: OverrideDef, splines: readonly BakedSpline[]): string {
  const r = def.region;
  if ('box' in r) {
    const [x0, z0, x1, z1] = r.box;
    return x1 > x0 && z1 > z0 ? '' : 'its box is empty (x0 < x1 and z0 < z1)';
  }
  const sp = r.road ? splines.find((s) => s.id === r.road) : splines[0];
  if (!sp) return `no road "${r.road}"`;
  if (!(r.s[1] > r.s[0])) return 'its stretch is empty (s[0] < s[1])';
  if (r.s[0] < 0 || r.s[1] > sp.length) return `its stretch runs off "${sp.id}" (0 to ${sp.length.toFixed(0)} m)`;
  if (r.lateral && !(r.lateral[1] > r.lateral[0])) return 'its band is empty (lateral[0] < lateral[1])';
  return '';
}

/**
 * The layout's overrides bound to their code (`code`, by id) and their regions on `splines`. One
 * with no code, or a region that can't be built, is left out (the validator says so).
 */
export function bindOverrides(defs: readonly OverrideDef[], code: Readonly<Record<string, OverrideCode>>, splines: readonly BakedSpline[]): Override[] {
  const out: Override[] = [];
  for (const def of defs) {
    const c = code[def.id];
    if (!c || regionProblem(def, splines)) continue;
    const outline = outlineOf(def, splines);
    out.push({ ...c, id: def.id, reason: def.reason, outline, inside: insideOf(outline) });
  }
  return out;
}

/** A region's outline (see Override.outline). A stretch runs its left edge forward and its right edge back, sample by sample. */
function outlineOf(def: OverrideDef, splines: readonly BakedSpline[]): Float64Array {
  const r = def.region;
  if ('box' in r) {
    const [x0, z0, x1, z1] = r.box;
    return Float64Array.of(x0, z0, x1, z0, x1, z1, x0, z1);
  }
  const sp = r.road ? splines.find((s) => s.id === r.road)! : splines[0];
  const i0 = Math.max(0, Math.floor(r.s[0] / sp.step));
  const i1 = Math.min(sp.n - 1, Math.ceil(r.s[1] / sp.step));
  const n = i1 - i0 + 1;
  const out = new Float64Array(n * 4);
  for (let k = 0; k < n; k++) {
    const i = i0 + k;
    const edge = sp.width[i] / 2 + sp.shoulder[i];
    const [l, rr] = r.lateral ?? [-edge, edge];
    // right = (-tz, tx)
    const rx = -sp.tz[i];
    const rz = sp.tx[i];
    out[k * 2] = sp.px[i] + rx * l;
    out[k * 2 + 1] = sp.pz[i] + rz * l;
    const b = (2 * n - 1 - k) * 2;
    out[b] = sp.px[i] + rx * rr;
    out[b + 1] = sp.pz[i] + rz * rr;
  }
  return out;
}

/** Inside a closed outline: its bounds first, then the even-odd rule. */
function insideOf(o: Float64Array): (x: number, z: number) => boolean {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let k = 0; k < o.length; k += 2) {
    minX = Math.min(minX, o[k]);
    maxX = Math.max(maxX, o[k]);
    minZ = Math.min(minZ, o[k + 1]);
    maxZ = Math.max(maxZ, o[k + 1]);
  }
  return (x, z) => {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return false;
    let inside = false;
    for (let a = 0, b = o.length - 2; a < o.length; b = a, a += 2) {
      const az = o[a + 1];
      const bz = o[b + 1];
      if (az > z !== bz > z && x < o[a] + ((z - az) * (o[b] - o[a])) / (bz - az)) inside = !inside;
    }
    return inside;
  };
}

/** The overrides active at (x, z), by id (tools: probe, validate). */
export const activeAt = (overrides: readonly Override[], x: number, z: number): string[] => overrides.filter((o) => o.inside(x, z)).map((o) => o.id);
