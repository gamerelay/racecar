import { describe, expect, test } from 'bun:test';
import { MeshBasicMaterial, ShaderLib } from 'three';
import { Ev } from '../src/core/events';
import { Sim } from '../src/core/sim';
import { bakeTrack, wrap } from '../src/core/track/bake';
import { FADE, FADE_BACK, GRID_CLEAR, LOD_STRAIGHT, TRAFFIC_KINDS, TRAFFIC_RESPAWN, Traffic, newTrafficPose } from '../src/core/world/traffic';
import { fadeMaterial, injectFade } from '../src/render/fade';
import { carPaint } from '../src/render/skins/greybox/car/paint';
import { toon } from '../src/render/skins/greybox/toon';
import { CLASSES, DOWNTOWN, SURFACES, layout } from './helpers';
import { EXPERIMENTAL_KEYS, LAYOUT_KEYS } from '../tools/content';

// Regressions for traffic popping in and out near the player (SPEC "Traffic that doesn't pop").
// Three causes were measured: cars appearing at a lane section's edge, at the start grid's clear
// zone, and cars near in a straight line but far by road never being posed. Visibility is now a
// formula with fades; these hold it to that.

const track = bakeTrack(DOWNTOWN, SURFACES);
/** The slowest a fade may be allowed to go, fixed here so shrinking FADE can't pass by moving the bar. */
const MIN_FADE_M = 30;
const MIN_FADE_S = 0.5;
const L = track.main.length;

/** A car in lane `lane`, and the race time it's at main distance `s` (after the grid's clear time). */
function carAt(tr: Traffic, lane: number, s: number): [k: number, t: number] {
  const k = [...Array(tr.count).keys()].find((j) => tr.lane[j] === lane)!;
  const l = tr.lanes[lane];
  // sAt = s0 + dir·speed·t (mod L): solve for t, then step whole laps past the clear time.
  const lap = L / l.speed;
  let t = wrap((s - tr.s0[k]) * l.dir, L) / l.speed;
  while (t < GRID_CLEAR.seconds + FADE_BACK + 1) t += lap;
  return [k, t];
}

describe('traffic visibility', () => {
  const tr = new Traffic(track, 1);
  test('fades are long enough to read as fades', () => {
    expect(FADE).toBeGreaterThanOrEqual(MIN_FADE_M);
    expect(FADE_BACK).toBeGreaterThanOrEqual(MIN_FADE_S);
  });
  test('fades over FADE meters before a section and after it, in the direction of travel', () => {
    for (let lane = 0; lane < tr.lanes.length; lane++) {
      const l = tr.lanes[lane];
      for (const [a, b] of l.sections!) {
        const entry = l.dir > 0 ? a : b;
        const exit = l.dir > 0 ? b : a;
        const at = (s: number) => {
          const [k, t] = carAt(tr, lane, wrap(s, L));
          return tr.visibility(k, t);
        };
        // Approaching the entry: half way through the fade, then solid just inside.
        expect(at(entry - l.dir * FADE * 0.5)).toBeCloseTo(0.5, 2);
        expect(at(entry - l.dir * FADE * 1.2)).toBe(0);
        expect(at(entry + l.dir * 2)).toBe(1);
        // Past the exit: fading out, then gone.
        expect(at(exit + l.dir * FADE * 0.25)).toBeCloseTo(0.75, 2);
        expect(at(exit + l.dir * FADE * 1.2)).toBe(0);
        expect(at(exit - l.dir * 2)).toBe(1);
      }
    }
  });

  test('the start grid is clear by where the cars start, not by a fade', () => {
    // No lane here needs the fade: every car starts where it won't come within FADE of the clear
    // zone in the clear time, and the clear time's end changes nothing.
    expect(tr.gridFade.every((g) => !g)).toBe(true);
    for (let k = 0; k < tr.count; k++) {
      for (let t = 0; t <= GRID_CLEAR.seconds; t += 0.05) {
        if (tr.visibility(k, t) <= 0) continue;
        const s = tr.sAt(k, t);
        expect(s > L - GRID_CLEAR.behind - FADE + 0.5 || s < GRID_CLEAR.ahead + FADE - 0.5).toBe(false);
      }
      // Over the clear time's end, only as fast as a section's fade (its car moving 2/60 s of road).
      const t = GRID_CLEAR.seconds;
      const l = tr.lanes[tr.lane[k]];
      expect(Math.abs(tr.visibility(k, t + 1 / 60) - tr.visibility(k, t - 1 / 60))).toBeLessThanOrEqual((l.speed * 2) / 60 / FADE + 1e-9);
    }
    // …and its lanes still run over the line once that's done.
    const overLine = (t: number) => [...Array(tr.count).keys()].some((k) => tr.visibility(k, t) === 1 && (tr.sAt(k, t) > L - GRID_CLEAR.behind || tr.sAt(k, t) < GRID_CLEAR.ahead));
    expect([...Array(60).keys()].some((j) => overLine(30 + j * 5))).toBe(true);
  });

  test('a wreck is gone at once and fades back after TRAFFIC_RESPAWN', () => {
    const t0 = 200;
    const k = [...Array(tr.count).keys()].find((j) => tr.visibility(j, t0) === 1 && tr.visibility(j, t0 + TRAFFIC_RESPAWN + FADE_BACK) === 1)!;
    const w = new Traffic(track, 1);
    w.wreckedAt[k] = t0;
    expect(w.visibility(k, t0)).toBe(0);
    expect(w.visibility(k, t0 + TRAFFIC_RESPAWN - 0.01)).toBe(0);
    expect(w.visibility(k, t0 + TRAFFIC_RESPAWN + FADE_BACK / 2)).toBeCloseTo(0.5, 5);
    expect(w.present(k, t0 + TRAFFIC_RESPAWN + FADE_BACK / 2)).toBe(false);
    expect(w.visibility(k, t0 + TRAFFIC_RESPAWN + FADE_BACK)).toBe(1);
  });

  test('what the renderer draws is every visible car in range, not the sim pool', () => {
    const t = 60;
    tr.posed = 0;
    const [x, z] = [track.main.px[400], track.main.pz[400]];
    const seen = new Map<number, number>();
    tr.visibleNear(t, x, z, 500, (k, v) => seen.set(k, v));
    const pose = newTrafficPose();
    for (let k = 0; k < tr.count; k++) {
      const v = tr.visibility(k, t);
      tr.poseAt(k, t, pose);
      const inRange = Math.hypot(pose.x - x, pose.z - z) <= 500;
      expect(seen.get(k)).toBe(v > 0 && inRange ? v : undefined);
    }
    expect(seen.size).toBeGreaterThan(0);
  });
});

describe('the start grid on every map', () => {
  for (const key of [...LAYOUT_KEYS, ...EXPERIMENTAL_KEYS]) {
    test(`${key}: no car seen near the grid in the clear time but a lane that can't start clear of it`, () => {
      const t3 = bakeTrack(layout(key), SURFACES);
      const L3 = t3.main.length;
      const start = t3.layout.getaway?.start;
      for (const seed of [1, 7, 42]) {
        const tr = new Traffic(t3, seed);
        for (let k = 0; k < tr.count; k++) {
          const l = tr.lane[k];
          if (tr.gridFade[l]) continue;
          const path = tr.routes[l]?.path;
          for (let t = 0; t <= GRID_CLEAR.seconds; t += 0.1) {
            if (tr.visibility(k, t) <= 0) continue;
            if (path) {
              if (!start) continue;
              const p = tr.poseAt(k, t, newTrafficPose());
              expect(Math.hypot(p.x - start.at[0], p.z - start.at[1])).toBeGreaterThan(110 + FADE - 3);
            } else {
              const s = tr.sAt(k, t);
              const ahead = TRAFFIC_KINDS[tr.kind[k]].animal ? 0 : GRID_CLEAR.ahead + FADE - 0.5;
              expect(s > L3 - GRID_CLEAR.behind - FADE + 0.5 || s < ahead).toBe(false);
            }
          }
        }
      }
    });
  }
});

describe('traffic in a race never pops', () => {
  for (const key of ['downtown/downtown', 'backroads/valley']) {
    test(`${key}: 8 AI, traffic on, 70 s: no jumps in sight, solid cars near a racer are posed`, () => {
      const sim = new Sim(bakeTrack(layout(key), SURFACES), CLASSES, SURFACES, { seed: 3, traffic: 1, mayhem: 'normal' });
      for (let k = 0; k < 8; k++) sim.addCar({ cls: CLASSES[k % CLASSES.length].id, racer: { difficulty: (k % 3) as 0 | 1 | 2 } });
      sim.startRace(1, 4);
      const tr = sim.world.traffic;
      const c = sim.cars;
      const maxStep = Math.max(...tr.lanes.map((l) => (l.speed * sim.dt) / MIN_FADE_M), sim.dt / MIN_FADE_S);
      const prev = new Float64Array(tr.count);
      const wrecked = new Set<number>();
      const pose = newTrafficPose();
      let cursor = 0;
      let checked = 0;
      let faded = 0;
      for (let tick = 0; tick < 60 * 70; tick++) {
        sim.step([]);
        wrecked.clear();
        cursor = sim.events.read(cursor, (e) => {
          if (e.type === Ev.TrafficWreck) wrecked.add(e.other);
        });
        const posed = new Set(tr.idx.subarray(0, tr.posed));
        for (let k = 0; k < tr.count; k++) {
          const v = tr.visibility(k, sim.time);
          tr.poseAt(k, sim.time, pose);
          let nearest = Infinity;
          for (let i = 0; i < c.count; i++) nearest = Math.min(nearest, Math.hypot(pose.x - c.x[i], pose.z - c.z[i]));
          // In sight of someone: it only ever fades (a wreck vanishes on purpose; debris takes over).
          if (tick > 0 && nearest < 160 && !wrecked.has(k)) {
            expect(Math.abs(v - prev[k])).toBeLessThanOrEqual(maxStep);
            checked++;
            if (v > 0 && v < 1) faded++;
          }
          // The pool is exactly the solid cars near a racer (it has room for all of them here). It's
          // built at the start of the tick from where the racers were, so allow a tick's travel.
          // (A car wrecked this tick was solid when the pool was built.)
          if (posed.has(k) && !wrecked.has(k)) expect(v).toBe(1);
          else if (v === 1 && nearest < LOD_STRAIGHT - 5) throw new Error(`solid car ${k} ${nearest.toFixed(0)} m from a racer wasn't posed`);
          prev[k] = v;
        }
      }
      expect(checked).toBeGreaterThan(1000);
      // The fades actually happen in front of people (else this proves nothing).
      expect(faded).toBeGreaterThan(0);
    });
  }
});

describe('fade shader', () => {
  // The fade patches three's built-in shaders; if an upgrade renames a chunk it must fail here,
  // not silently draw fading cars solid (the pops, back).
  const lib = { toon: ShaderLib.toon, basic: ShaderLib.basic };
  test('patches every material traffic draws with, after their own patches', () => {
    const cache = new Map();
    const materials = [
      ['toon', toon()],
      ['basic', new MeshBasicMaterial()],
      ['toon', carPaint({ id: 'x', name: 'x', color: '#ffffff', finish: 'gloss', secondary: '#ff2e88' }, 'band')],
    ] as const;
    for (const [kind, src] of materials) {
      const m = fadeMaterial(src, cache);
      expect(fadeMaterial(src, cache)).toBe(m);
      expect(m.transparent).toBe(true);
      expect(m.depthWrite).toBe(false);
      expect(m.customProgramCacheKey()).not.toBe(src.customProgramCacheKey());
      const shader = { vertexShader: lib[kind].vertexShader, fragmentShader: lib[kind].fragmentShader, uniforms: { ...lib[kind].uniforms } };
      m.onBeforeCompile(shader as never, undefined as never);
      expect(shader.vertexShader).toContain('vFade=aFade;');
      expect(shader.fragmentShader).toContain('gl_FragColor.a*=vFade;');
    }
  });
  test('a shader missing a hook throws instead of fading nothing', () => {
    expect(() => injectFade({ vertexShader: 'void main(){}', fragmentShader: 'void main(){}' })).toThrow();
  });
});
