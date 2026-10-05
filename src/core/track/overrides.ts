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
import { newHit, sampleAt } from './query';

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
  /** What's under (x, y, z): change `out` (its floor, piece, space). Every `cast`, `top` and `topSlope` sees it, and a car's wheels stand on it. Open ground only. */
  cast?(out: Cast, x: number, y: number, z: number): void;
  /** The surface a car at (x, y, z) drives on (an index into the track's surfaces), given what the engine found. */
  surface?(surface: number, x: number, y: number, z: number): number;
  /** What's dangerous at (x, y, z) at time `t`, given what the features said. Open ground only. */
  hazard?(hazard: Hazard, x: number, y: number, z: number, t: number): Hazard;
  /**
   * A wrecked car whose comeback spot falls inside comes back here instead. The engine's own rules
   * then apply to it as to any spot: ahead of an avalanche, past a gap with no run-up.
   */
  respawn?: RespawnSpot;
  /** Per tick, for each of your own cars inside (after it's stepped, before collisions). No allocation. */
  step?(sim: SimState, car: number): void;
}

/** An override bound to its region: the layout's declaration and its code. */
export interface Override extends OverrideCode {
  id: string;
  reason: string;
  /** Whether (x, z) is inside its region (a box's low edges in, its high edges out: [x0, x1) × [z0, z1)). */
  inside(x: number, z: number): boolean;
  /** Its region's outline, [x, z] pairs in order (a box's four corners; a stretch's edges, out one side and back the other), for tools and drawing. */
  outline: Float64Array;
  /** The road its respawn spot is on (an index into the track's splines), -1 with none. */
  respawnSpline: number;
}

/**
 * Why an override's region can't be built (unknown road, empty stretch), or '' if it can. A
 * stretch with `s[0]` past `s[1]` runs through the start line, on a looped road.
 */
export function regionProblem(def: OverrideDef, splines: readonly BakedSpline[]): string {
  const r = def.region;
  if ('box' in r) {
    const [x0, z0, x1, z1] = r.box;
    return x1 > x0 && z1 > z0 ? '' : 'its box is empty (x0 < x1 and z0 < z1)';
  }
  const sp = r.road ? splines.find((s) => s.id === r.road) : splines[0];
  if (!sp) return `no road "${r.road}"`;
  if (!(r.s[0] >= 0 && r.s[1] <= sp.length && r.s[0] <= sp.length && r.s[1] >= 0)) return `its stretch runs off "${sp.id}" (0 to ${sp.length.toFixed(0)} m)`;
  if (r.s[1] === r.s[0] || (r.s[1] < r.s[0] && !sp.closed)) return `its stretch is empty (s[0] < s[1]${sp.closed ? ', or past it through the start line' : ''})`;
  if (r.lateral && !(r.lateral[1] > r.lateral[0])) return 'its band is empty (lateral[0] < lateral[1])';
  return '';
}

/** Why an override's respawn spot can't be used (unknown road, off its end), or ''. */
export function respawnProblem(code: OverrideCode, splines: readonly BakedSpline[]): string {
  const r = code.respawn;
  if (!r) return '';
  const sp = r.road ? splines.find((s) => s.id === r.road) : splines[0];
  if (!sp) return `its respawn spot is on no road "${r.road}"`;
  if (!(r.s >= 0 && r.s <= sp.length)) return `its respawn spot is off "${sp.id}" (0 to ${sp.length.toFixed(0)} m)`;
  return '';
}

/**
 * The layout's overrides bound to their code (`code`, by id) and their regions on `splines`. One
 * with no code, a region that can't be built or a respawn spot that can't be used is left out
 * (the validator says so).
 */
export function bindOverrides(defs: readonly OverrideDef[], code: Readonly<Record<string, OverrideCode>>, splines: readonly BakedSpline[]): Override[] {
  const out: Override[] = [];
  for (const def of defs) {
    const c = code[def.id];
    if (!c || regionProblem(def, splines) || respawnProblem(c, splines)) continue;
    const outline = outlineOf(def, splines);
    const respawnSpline = c.respawn ? (c.respawn.road ? splines.find((s) => s.id === c.respawn!.road)!.index : 0) : -1;
    out.push({ ...c, id: def.id, reason: def.reason, outline, inside: insideOf(outline), respawnSpline });
  }
  return out;
}

/**
 * A region's outline (see Override.outline). A stretch runs its left edge forward and its right
 * edge back, from exactly `s[0]` to exactly `s[1]`, a sample's step apart. (A band wider than a
 * hairpin's radius folds on its inside, and the fold reads as outside: keep bands narrow there.)
 */
function outlineOf(def: OverrideDef, splines: readonly BakedSpline[]): Float64Array {
  const r = def.region;
  if ('box' in r) {
    const [x0, z0, x1, z1] = r.box;
    return Float64Array.of(x0, z0, x1, z0, x1, z1, x0, z1);
  }
  const sp = r.road ? splines.find((s) => s.id === r.road)! : splines[0];
  // Through the start line on a looped road: on past its length.
  const span = r.s[1] > r.s[0] ? r.s[1] - r.s[0] : r.s[1] + sp.length - r.s[0];
  const steps = Math.max(1, Math.ceil(span / sp.step));
  const n = steps + 1;
  const out = new Float64Array(n * 4);
  const at = newHit();
  for (let k = 0; k < n; k++) {
    sampleAt(sp, r.s[0] + (span * k) / steps, at);
    const edge = at.width / 2 + at.shoulder;
    const [l, rr] = r.lateral ?? [-edge, edge];
    // right = (-tz, tx)
    out[k * 2] = at.cx - at.tz * l;
    out[k * 2 + 1] = at.cz + at.tx * l;
    const b = (2 * n - 1 - k) * 2;
    out[b] = at.cx - at.tz * rr;
    out[b + 1] = at.cz + at.tx * rr;
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
