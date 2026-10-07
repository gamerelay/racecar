// Sahara (docs/SAHARA.md): the pyramids are ground you drive up, stone to drive on, and the Pyramid
// Run goes over the Great Pyramid's top; the river, its ford and its bridge; Giza dressed.

import { describe, expect, test } from 'bun:test';
import { bakeTrack } from '../src/core/track/bake';
import { pyramidHeight } from '../src/core/track/features/pyramid';
import { KIND_STONE, KIND_WATER, riverAt } from '../src/core/track/ground';
import { newHit, projectGlobal, sampleAt, surfaceAt } from '../src/core/track/query';
import type { PyramidDef, RiverDef } from '../src/core/content';
import { SURFACES, layout } from './helpers';

describe('Sahara', () => {
  const sahara = layout('sahara/dunes');
  const track = bakeTrack(sahara, SURFACES);
  const g = track.ground!;
  const pyramids = sahara.ground!.features!.filter((f): f is PyramidDef => f.kind === 'pyramid');

  test('a pyramid rises in flat faces from its foot to its top, square to its heading', () => {
    const p: PyramidDef = { kind: 'pyramid', at: [0, 0], half: 40, top: 4, h: 18, y: 0, rot: 0.3 };
    const h = pyramidHeight(p);
    expect(h(0, 0)).toBe(18);
    // Halfway up a face, along its heading or across it, the same height: a square, turned.
    const [fx, fz] = [Math.sin(0.3), Math.cos(0.3)];
    expect(h(fx * 22, fz * 22)).toBeCloseTo(9, 6);
    expect(h(fz * 22, -fx * 22)).toBeCloseTo(9, 6);
    // Off its foot, nothing (a corner reaches farther than a face).
    expect(h(fx * 41, fz * 41)).toBe(0);
    expect(h((fx + fz) * 39, (fz - fx) * 39)).toBeGreaterThan(0);
  });

  test('the pyramids stand on the ground, stone, driven as sandstone', () => {
    expect(pyramids.length).toBe(7);
    const hit = newHit();
    for (const p of pyramids) {
      // Halfway up a face across its heading (the Pyramid Run goes along the Great Pyramid's).
      const [x, z] = [p.at[0] + Math.cos(p.rot) * p.half * 0.5, p.at[1] - Math.sin(p.rot) * p.half * 0.5];
      expect(g.height(x, z)).toBeCloseTo(p.y + p.h * ((p.half * 0.5) / (p.half - p.top)), 0);
      expect(g.kindAt(x, z)).toBe(KIND_STONE);
      projectGlobal(track.main, x, z, hit);
      expect(SURFACES[surfaceAt(track, hit, x, g.height(x, z), z, false, track.surfaceIndex.get('sand')!)].id).toBe('sandstone');
    }
  });

  test('the Pyramid Run goes over the Great Pyramid, its top the highest point on it', () => {
    const run = track.splines.find((s) => s.id === 'pyramid-run')!;
    const great = pyramids[0];
    let top = 0;
    for (let i = 1; i < run.n; i++) if (run.py[i] > run.py[top]) top = i;
    expect(Math.hypot(run.px[top] - great.at[0], run.pz[top] - great.at[1])).toBeLessThan(great.top + 2);
    expect(run.py[top]).toBeGreaterThan(great.y + great.h - 1);
  });
});

describe("Sahara's river", () => {
  const sahara = layout('sahara/dunes');
  const track = bakeTrack(sahara, SURFACES);
  const g = track.ground!;
  const river = sahara.ground!.features!.find((f): f is RiverDef => f.kind === 'river')!;
  const at = riverAt(river, 60);
  const w = { level: 0 };
  const hit = newHit();
  const surface = (x: number, y: number, z: number) => (projectGlobal(track.main, x, z, hit, y), SURFACES[surfaceAt(track, hit, x, y, z, false, track.surfaceIndex.get('sand')!)].id);

  test('it falls along its course, in a channel under its water, wading', () => {
    expect(river.level[0]).toBeGreaterThan(river.level[1]);
    // Midway, away from the roads: its floor under the water, its banks over it, and wading (not a wreck).
    const [x, z] = river.path[Math.floor(river.path.length * 0.45)];
    at(x, z, w);
    expect(g.height(x, z)).toBeCloseTo(w.level - river.depth, 1);
    expect(g.kindAt(x, z)).toBe(KIND_WATER);
    expect(surface(x, g.height(x, z), z)).toBe('river');
    expect(g.hazard(x, g.height(x, z) + 0.5, z, 10)).toBe('none');
  });

  test('the ford: the road dips under the water, and drives as a ford', () => {
    const zone = sahara.zones!.find((z) => z.surface === 'ford')!;
    const s = (zone.s[0] + zone.s[1]) / 2;
    sampleAt(track.main, s, hit);
    const [x, y, z] = [hit.cx, hit.cy, hit.cz];
    at(x, z, w);
    expect(y).toBeLessThan(w.level);
    expect(y).toBeGreaterThan(w.level - 0.6);
    expect(surface(x, y, z)).toBe('ford');
  });

  test("the bridge: a deck over the water, the ground under it down at the river's floor", () => {
    const piece = sahara.pieces!.find((p) => p.id === 'wadi-bridge')!;
    sampleAt(track.main, (piece.s[0] + piece.s[1]) / 2, hit);
    const [x, y, z] = [hit.cx, hit.cy, hit.cz];
    at(x, z, w);
    expect(y).toBeGreaterThan(w.level + 2);
    expect(g.height(x, z)).toBeLessThan(w.level);
    expect(g.pieceFloor(x, z, 1, y + 0.5)).toBeCloseTo(y, 1);
  });
});

describe('Giza dressed', () => {
  const sahara = layout('sahara/dunes');
  const track = bakeTrack(sahara, SURFACES);

  test('the Sphinx and the obelisks stand solid, off the road, and the palms keep off every road', () => {
    expect(sahara.landmarks!.map((m) => m.kind).sort()).toEqual(['obelisk', 'obelisk', 'obelisk', 'obelisk', 'sphinx']);
    for (const m of sahara.landmarks!) expect(sahara.houses!.some((h) => h.at[0] === m.at[0] && h.at[1] === m.at[1] && h.look === 'landmark')).toBe(true);
    const palms = sahara.ground!.pines!.plant!;
    expect(palms.length).toBeGreaterThan(150);
    const hit = newHit();
    for (const [x, z] of palms)
      for (const sp of track.splines) {
        projectGlobal(sp, x, z, hit);
        expect(Math.abs(hit.lateral) > hit.width / 2 + hit.shoulder || Math.hypot(hit.cx - x, hit.cz - z) > hit.width / 2 + hit.shoulder).toBe(true);
      }
  });
});
