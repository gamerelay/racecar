// The sea wall (docs/COASTAL.md, "The sea wall"; features/seawall.ts): along Coastal's waterfront
// the sea comes right up to a wall on the right, not a beach. Checked headless, by sampling the
// ground past the wall against the sea, all along it.

import { describe, expect, test } from 'bun:test';
import type { SeawallDef, TrackLayout } from '../src/core/content';
import { bakeTrack } from '../src/core/track/bake';
import { SEAWALL_FACE, SEAWALL_LEDGE } from '../src/core/track/features/seawall';
import { newHit, sampleAt } from '../src/core/track/query';
import { validateLayout } from '../src/core/track/validate';
import { CLASSES, SURFACES, layout } from './helpers';

const riviera = layout('coastal/riviera');
const track = bakeTrack(riviera, SURFACES);
const wall = riviera.ground!.features!.find((f): f is SeawallDef => f.kind === 'seawall')!;
const sea = riviera.ground!.sea ?? 0;
const L = track.main.length;
/** Every 5 m along the wall, `in` m in from its ends (through the lap's end). */
const along = (inset: number) => {
  const len = (((wall.s[1] - wall.s[0]) % L) + L) % L;
  const out: number[] = [];
  for (let d = inset; d <= len - inset; d += 5) out.push((wall.s[0] + d) % L);
  return out;
};

describe('the sea wall', () => {
  test('Coastal has one, on the right, from the lighthouse hairpin through the line to the bridge', () => {
    expect(wall.side).toBe('right');
    expect(wall.floor).toBeLessThan(sea);
    // Through the lap's end: from late in the lap to early in it.
    expect(wall.s[0]).toBeGreaterThan(wall.s[1]);
  });

  test("a wall stands on the right all along it, and the ground keeps the road's height across the shoulder (no dip)", () => {
    // Against the same layout without it: the shoulder's ground is just what it was.
    const g = track.ground!;
    const g0 = bakeTrack({ ...riviera, ground: { ...riviera.ground!, features: [] } }, SURFACES).ground!;
    const hit = newHit();
    for (const s of along(2)) {
      expect(track.main.wallR[Math.round(s / track.main.step) % track.main.n]).toBe(1);
      sampleAt(track.main, s, hit);
      for (let out = hit.width / 2; out <= hit.width / 2 + hit.shoulder; out += 0.25) {
        const [x, z] = [hit.cx - hit.tz * out, hit.cz + hit.tx * out];
        expect(Math.abs(g.height(x, z) - g0.height(x, z))).toBeLessThan(0.01);
      }
    }
  });

  test('past its ledge, water: deep against the quay, and under the sea for 40 m out (no beach)', () => {
    const g = track.ground!;
    const hit = newHit();
    for (const s of along(10)) {
      sampleAt(track.main, s, hit);
      const edge = hit.width / 2 + hit.shoulder + SEAWALL_LEDGE;
      const at = (out: number) => g.height(hit.cx - hit.tz * (edge + out), hit.cz + hit.tx * (edge + out));
      // Under the sea by the sea face (SEAWALL_FACE: the slope across the drop's cell is behind
      // it), a grid cell out at the floor, then never above the sea.
      expect(at(SEAWALL_FACE - SEAWALL_LEDGE)).toBeLessThan(sea);
      expect(at(2.6)).toBeLessThan(sea - 5);
      for (let out = 2.6; out <= 40; out += 2.5) expect(at(out)).toBeLessThan(sea - 0.3);
    }
  });

  test('the town side keeps its land', () => {
    const g = track.ground!;
    const hit = newHit();
    for (const s of along(10)) {
      sampleAt(track.main, s, hit);
      const out = hit.width / 2 + hit.shoulder + 10;
      expect(g.height(hit.cx + hit.tz * out, hit.cz - hit.tx * out)).toBeGreaterThan(sea + 1);
    }
  });

  test('the validator: a side, a stretch, a floor under the sea', () => {
    const errors = (w: object) => {
      const l: TrackLayout = { ...riviera, ground: { ...riviera.ground!, features: [{ ...wall, ...w } as SeawallDef] } };
      return validateLayout(l, SURFACES, CLASSES).filter((p) => p.level === 'error' && p.message.includes('seawall'));
    };
    expect(errors({})).toEqual([]);
    expect(errors({ floor: sea + 1 }).length).toBeGreaterThan(0);
    expect(errors({ side: 'up' }).length).toBeGreaterThan(0);
    expect(errors({ s: [100, 100] }).length).toBeGreaterThan(0);
    const coarse: TrackLayout = { ...riviera, ground: { ...riviera.ground!, cell: 5 } };
    expect(validateLayout(coarse, SURFACES, CLASSES).some((p) => p.level === 'error' && p.message.includes('2.5 m'))).toBe(true);
  }, 60_000);
});
