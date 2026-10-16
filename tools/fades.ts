// Fades seen (SPEC "Traffic that doesn't pop"): 8 AI race a layout with traffic, and from each
// racer's chase camera it counts the traffic cars it sees fading in or out (0 < visibility < 1): in
// sight as track/sight.ts has it (in front, within SEEN m, not behind the ground, a crest of the
// road or a tall prop; the skin's buildings and hills aren't known, so it's high there). Each fade is
// put down to the section end (or the start grid, or a wreck coming back) it happened at, so the
// ends to move are the ones at the top. The number to drive down is fades seen per racer per lap.
//
//   bun tools/fades.ts                 every layout with traffic
//   bun tools/fades.ts sahara          one (a map id or a map/layout key)
//   --seeds 4  --laps 2  --json

import { resolveLayout } from '../src/core/content';
import { Sim } from '../src/core/sim';
import { bakeTrack, signedGap } from '../src/core/track/bake';
import { newHit } from '../src/core/track/query';
import { inSight, tallProps } from '../src/core/track/sight';
import { FADE, GRID_CLEAR, newTrafficPose, type Traffic } from '../src/core/world/traffic';
import { CLASSES, EXPERIMENTAL_KEYS, LAYOUT_KEYS, SURFACES, layout } from './content';

export interface FadeEnd {
  /** What it was: a lane's section end (`end` m, `in` or `out` as its cars cross it), the start grid, or a wreck coming back. */
  what: string;
  lane: number;
  s: number;
  /** Fades there, and of those seen by some racer, and racer sightings (one racer seeing one fade). */
  fades: number;
  seen: number;
  sightings: number;
}

export interface FadesReport {
  key: string;
  racerLaps: number;
  fades: number;
  sightings: number;
  ends: FadeEnd[];
}

/** Which end a fading car at main distance s is fading at: the nearest section end of its lane within FADE, else the grid or a wreck. */
function endOf(tr: Traffic, k: number, s: number, t: number, L: number): { what: string; s: number } {
  const lane = tr.lanes[tr.lane[k]];
  const w = tr.wreckedAt[k];
  if (w >= 0 && t >= w) return { what: 'wreck back', s: Math.round(s / 50) * 50 };
  // (A build from before the start was kept clear by placement fades every lane out of it.)
  if (t < GRID_CLEAR.seconds + 2 && (tr.gridFade?.[tr.lane[k]] ?? true) && (s > L - GRID_CLEAR.behind - FADE || s < GRID_CLEAR.ahead + FADE)) return { what: 'grid', s: 0 };
  const r = tr.routes[tr.lane[k]];
  if (r) return { what: r.path ? 'path' : 'street', s: Math.round(s / 50) * 50 };
  let best = { what: '?', s: 0, d: Infinity };
  for (const [a, b] of lane.sections ?? []) {
    for (const e of [a, b]) {
      const d = Math.abs(signedGap(s, e, L));
      const entry = lane.dir > 0 ? a : b;
      if (d < best.d && d <= FADE + 5) best = { what: e === entry ? 'in' : 'out', s: Math.round(e), d };
    }
  }
  return best;
}

export function fadesReport(key: string, seeds: number[], laps: number): FadesReport {
  const track = bakeTrack(layout(key), SURFACES);
  const L = track.main.length;
  const tall = tallProps(track);
  const ends = new Map<string, FadeEnd>();
  let racerLaps = 0;
  let fadesTotal = 0;
  let sightingsTotal = 0;
  const pose = newTrafficPose();
  const hit = newHit();
  for (const seed of seeds) {
    const sim = new Sim(track, CLASSES, SURFACES, { seed, traffic: 1, mayhem: 'normal' });
    for (let k = 0; k < 8; k++) sim.addCar({ cls: CLASSES[k % CLASSES.length].id, racer: { difficulty: (k % 3) as 0 | 1 | 2 } });
    sim.startRace(laps, 3);
    const tr = sim.world.traffic;
    const c = sim.cars;
    // Each car's fade now (its end's key, or ''), and who's seen it.
    const fading: string[] = Array(tr.count).fill('');
    const seenBy: Set<number>[] = Array.from({ length: tr.count }, () => new Set());
    const close = (k: number) => {
      const e = ends.get(fading[k])!;
      e.fades++;
      fadesTotal++;
      if (seenBy[k].size) e.seen++;
      e.sightings += seenBy[k].size;
      sightingsTotal += seenBy[k].size;
      fading[k] = '';
      seenBy[k].clear();
    };
    const cap = (laps * 140 + 20) * 60;
    for (let tick = 0; tick < cap && sim.race.finishedCount < c.count; tick++) {
      sim.step([]);
      // Every third tick is plenty: a fade lasts a second or more.
      if (tick % 3) continue;
      const t = sim.time;
      for (let k = 0; k < tr.count; k++) {
        const v = tr.visibility(k, t);
        if (v <= 0 || v >= 1) {
          if (fading[k]) close(k);
          continue;
        }
        tr.poseAt(k, t, pose);
        if (!fading[k]) {
          const end = endOf(tr, k, pose.s, t, L);
          const id = `${tr.lane[k]}:${end.what}:${end.s}`;
          if (!ends.has(id)) ends.set(id, { what: end.what, lane: tr.lane[k], s: end.s, fades: 0, seen: 0, sightings: 0 });
          fading[k] = id;
        }
        for (let i = 0; i < c.count; i++) {
          if (seenBy[k].has(i) || c.finished[i]) continue;
          if (inSight(track, c.x[i], c.y[i], c.z[i], c.h[i], c.s[i], pose.x, pose.y, pose.z, pose.s, tall, hit)) seenBy[k].add(i);
        }
      }
    }
    for (let k = 0; k < tr.count; k++) if (fading[k]) close(k);
    for (let i = 0; i < c.count; i++) racerLaps += Math.min(laps, c.lap[i]);
  }
  return { key, racerLaps: Math.max(1, racerLaps), fades: fadesTotal, sightings: sightingsTotal, ends: [...ends.values()].sort((a, b) => b.sightings - a.sightings) };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const value = (flag: string): string | undefined => {
    const k = args.indexOf(flag);
    return k >= 0 && k + 1 < args.length ? args[k + 1] : undefined;
  };
  const named = args.find((a, k) => !a.startsWith('-') && !(k > 0 && ['--seeds', '--laps'].includes(args[k - 1])));
  const all = [...LAYOUT_KEYS, ...EXPERIMENTAL_KEYS];
  const only = named && (resolveLayout(named, all) ?? named);
  const keys = (only ? all.filter((key) => key === only) : LAYOUT_KEYS).filter((key) => (layout(key).traffic?.lanes.length ?? 0) > 0);
  const seeds = Array.from({ length: Number(value('--seeds') ?? 3) }, (_, i) => i + 1);
  const laps = Number(value('--laps') ?? 2);
  const reports = keys.map((key) => fadesReport(key, seeds, laps));
  if (args.includes('--json')) console.log(JSON.stringify(reports, null, 1));
  else
    for (const r of reports) {
      console.log(`${r.key}: ${(r.sightings / r.racerLaps).toFixed(2)} fades seen per racer per lap (${r.sightings} sightings, ${r.fades} fades, ${r.racerLaps} racer laps)`);
      for (const e of r.ends.filter((e) => e.sightings > 0).slice(0, 8))
        console.log(`  lane ${e.lane} ${e.what.padEnd(10)} ${String(e.s).padStart(5)} m: ${String(e.sightings).padStart(4)} sightings, ${e.seen}/${e.fades} fades seen`);
    }
}
