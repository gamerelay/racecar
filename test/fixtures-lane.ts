// A test layout for branches off branches (CALDERA 6e): Backroads with a lane leaving the barn
// shortcut partway along and rejoining the main road past the corner after it.
import type { BranchDef, TrackLayout } from '../src/core/content';
import { bakeTrack } from '../src/core/track/bake';
import { newHit, sampleAt } from '../src/core/track/query';
import { SURFACES, layout } from './helpers';

export const LANE_FROM = 110;
export const LANE_TO = 480;

export function laneLayout(kind: BranchDef['kind'] = 'alternate'): TrackLayout {
  const v = layout('backroads/valley');
  const t = bakeTrack(v, SURFACES);
  const barn = t.splines.find((sp) => sp.id === 'barn')!;
  const a = sampleAt(barn, LANE_FROM + 25, newHit());
  const b = sampleAt(t.main, LANE_TO - 25, newHit());
  const points = [0.15, 0.5, 0.85].map((f) => {
    const x = a.cx + (b.cx - a.cx) * f;
    const z = a.cz + (b.cz - a.cz) * f;
    const y = a.cy + (b.cy - a.cy) * f;
    return { p: [x, y, z] as [number, number, number], width: 7, lanes: 1, shoulder: 1, surface: 'dirt' };
  });
  return { ...v, branches: [...v.branches!, { id: 'lane', kind, leaves: 'barn', from: LANE_FROM, to: LANE_TO, points }] };
}

export const LOOP_FROM = 50;
export const LOOP_TO = 190;

/** Backroads with a lane that leaves the barn shortcut and comes back onto it, 15 m off to its side. */
export function loopLayout(): TrackLayout {
  const v = layout('backroads/valley');
  const t = bakeTrack(v, SURFACES);
  const barn = t.splines.find((sp) => sp.id === 'barn')!;
  const hit = newHit();
  const points = [0.2, 0.4, 0.6, 0.8].map((f) => {
    sampleAt(barn, LOOP_FROM + (LOOP_TO - LOOP_FROM) * f, hit);
    return { p: [hit.cx - hit.tz * 15, hit.cy, hit.cz + hit.tx * 15] as [number, number, number], width: 7, lanes: 1, shoulder: 1, surface: 'dirt' };
  });
  return { ...v, branches: [...v.branches!, { id: 'loop', kind: 'alternate', leaves: 'barn', rejoins: 'barn', from: LOOP_FROM, to: LOOP_TO, points }] };
}
