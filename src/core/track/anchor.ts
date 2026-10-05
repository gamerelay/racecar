// Things placed along the main spline (branch ends, ramps, zones, gaps, props, takedown spots,
// listed checkpoints) are stored as distances. Moving an earlier control point changes every
// distance after it, so after an edit we re-anchor: find where each thing was in the world on the
// old track, and look up that spot's distance on the new one.

import type { TrackLayout } from '../content';
import { bakeTrack, sampleIndex, type BakedSpline, type Track } from './bake';
import { newHit, projectGlobal } from './query';
import type { SurfaceDef } from '../content';

/** Returns `next` with its main-spline distances moved to follow the geometry of `prev`. */
export function reanchor(prev: Track, next: TrackLayout, surfaces: SurfaceDef[]): TrackLayout {
  const out = structuredClone(next);
  let fresh = bakeTrack(out, surfaces);
  const hit = newHit();
  const mapS = (s: number, from: BakedSpline = prev.main, to: BakedSpline = fresh.main): number => {
    const i = sampleIndex(from, s);
    projectGlobal(to, from.px[i], from.pz[i], hit, from.py[i]);
    return Math.round(hit.s * 10) / 10;
  };
  const oldSpline = (id?: string) => (id ? prev.splines.find((s) => s.id === id) : prev.main);
  const newSpline = (id?: string) => (id ? fresh.splines.find((s) => s.id === id) : fresh.main);
  const map = (s: number, id?: string) => {
    const a = oldSpline(id);
    const b = newSpline(id);
    return a && b ? mapS(s, a, b) : s;
  };
  // Branch ends, each along its own road, in rounds: a branch is baked joined to its roads at its
  // ends, so one leaving another is mapped once that one's ends have moved and it's baked again.
  // (A road the bake doesn't know is the main road, as there.)
  const branches = out.branches ?? [];
  const road = (id?: string) => (id && branches.some((b) => b.id === id) ? id : undefined);
  const moved = new Set<string | undefined>([undefined]);
  let todo = branches;
  while (todo.length) {
    const ready = todo.filter((b) => moved.has(road(b.leaves)) && moved.has(road(b.rejoins)));
    if (!ready.length) break; // (one naming a later branch: the validator's to say)
    for (const b of ready) {
      b.from = map(b.from, road(b.leaves));
      b.to = map(b.to, road(b.rejoins));
    }
    for (const b of ready) moved.add(b.id);
    todo = todo.filter((b) => !moved.has(b.id));
    fresh = bakeTrack(out, surfaces);
  }
  for (const r of out.ramps ?? []) r.s = map(r.s, r.spline);
  for (const z of out.zones ?? []) z.s = [map(z.s[0], z.spline), map(z.s[1], z.spline)];
  for (const g of out.walls?.gaps ?? []) g.s = [map(g.s[0], g.spline), map(g.s[1], g.spline)];
  for (const p of out.props ?? []) p.s = map(p.s, p.spline);
  for (const t of out.takedownSpots ?? []) t.s = mapS(t.s);
  if (Array.isArray(out.checkpoints)) out.checkpoints = out.checkpoints.map((s) => mapS(s));
  return out;
}
