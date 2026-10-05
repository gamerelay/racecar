// A lava stream (docs/CALDERA.md, "A feature, end to end"; core/track/features/lava-stream.ts):
// Paradise Open's, down the volcano's south-west flank to the sea. A channel in the ground, rock
// banks, lava that wrecks you, a jump at speed, no trees in it, and off the roads.

import { describe, expect, test } from 'bun:test';
import type { LavaStreamDef } from '../src/core/content';
import { bakeTrack } from '../src/core/track/bake';
import { LAVA_BANK, LAVA_EDGE, LAVA_FILL } from '../src/core/track/ground';
import { newHit, projectGlobal, surfaceAt } from '../src/core/track/query';
import { validateLayout } from '../src/core/track/validate';
import { run, setup } from '../src/dev/drive';
import { CLASSES, SURFACES, layout } from './helpers';

const open = layout('paradise-open/open');
const track = bakeTrack(open, SURFACES);
const g = track.ground!;
const stream = open.ground!.features!.find((f): f is LavaStreamDef => f.kind === 'lava-stream')!;
const half = stream.width / 2;
/** A point `off` m across the stream (+ to its right, going down it) at its path's point `k`, and the way across it there (degrees, as drive.ts's heading). */
const across = (k: number, off: number) => {
  const [ax, az] = stream.path[k - 1];
  const [bx, bz] = stream.path[k + 1];
  const [x, z] = stream.path[k];
  const l = Math.hypot(bx - ax, bz - az);
  const rx = -(bz - az) / l;
  const rz = (bx - ax) / l;
  return { x: x + rx * off, z: z + rz * off, heading: (Math.atan2(-Math.sign(off) * rx, -Math.sign(off) * rz) * 180) / Math.PI };
};

describe('a lava stream', () => {
  test('a channel: its floor its depth down, its banks rock, lava over its floor only', () => {
    const plain = bakeTrack({ ...open, ground: { ...open.ground!, features: open.ground!.features!.filter((f) => f.kind !== 'lava-stream') } }, SURFACES).ground!;
    const hit = newHit();
    const shoulder = track.surfaceIndex.get(open.shoulderSurface ?? 'grass')!;
    const id = (x: number, y: number, z: number) => {
      projectGlobal(track.main, x, z, hit, y);
      return track.surfaces[surfaceAt(track, hit, x, y, z, false, shoulder)].id;
    };
    for (const k of [4, 10, 16, 22]) {
      const mid = across(k, 0);
      const h = g.height(mid.x, mid.z);
      expect(plain.height(mid.x, mid.z) - h).toBeCloseTo(stream.depth, 0);
      // In the lava down there; over it in the air (a jump), not; under the ground (a tunnel), not.
      expect(g.hazard(mid.x, h + 0.2, mid.z)).toBe('lava');
      expect(g.hazard(mid.x, h + LAVA_FILL + 1, mid.z)).toBe('none');
      expect(g.hazard(mid.x, h - 5, mid.z)).toBe('none');
      expect(id(mid.x, h + 0.3, mid.z)).toBe('lava-rock');
      // Up its bank: rock, no lava.
      const bank = across(k, half + LAVA_BANK / 2);
      expect(g.hazard(bank.x, g.height(bank.x, bank.z) + 0.2, bank.z)).toBe('none');
      expect(id(bank.x, g.height(bank.x, bank.z) + 0.3, bank.z)).toBe('lava-rock');
      // Well past it, the ground as it was.
      const past = across(k, half + LAVA_BANK + 15);
      expect(g.height(past.x, past.z)).toBeCloseTo(plain.height(past.x, past.z), 6);
    }
  });

  test("the lava is where it is drawn: level across, at the floor's height on its path, to LAVA_EDGE past the floor", () => {
    // (The ground's own height off the path isn't the floor: the grid's cells round the channel's
    // edges, and the lava was felt up to 1.3 m over where it's drawn.)
    for (let k = 3; k < stream.path.length - 3; k++) {
      const mid = across(k, 0);
      const level = g.height(mid.x, mid.z) + LAVA_FILL;
      for (const off of [-(half + LAVA_EDGE) + 0.2, -half, -1.5, 0, 1.5, half, half + LAVA_EDGE - 0.2]) {
        const p = across(k, off);
        expect([k, off, g.hazard(p.x, level - 0.2, p.z)]).toEqual([k, off, 'lava']);
        expect([k, off, g.hazard(p.x, level + 0.5, p.z)]).toEqual([k, off, 'none']);
      }
      const out = across(k, half + LAVA_EDGE + 0.3);
      expect(g.hazard(out.x, level - 0.2, out.z)).toBe('none');
    }
  });

  test('no trees in it or on its banks', () => {
    const p = track.pines!;
    let nearest = Infinity;
    for (let m = 0; m < p.n; m++) for (const [x, z] of stream.path) nearest = Math.min(nearest, Math.hypot(p.x[m] - x, p.z[m] - z));
    expect(p.n).toBeGreaterThan(1000);
    expect(nearest).toBeGreaterThan(half + LAVA_BANK);
  });

  test('rolled into slowly, it wrecks you (a hazard); jumped at speed, you clear it', () => {
    // On the flank, from the stream's right (a clear run-up: no trees on the line).
    const from = across(4, 45);
    // (Long enough to reach it and be over it, not to run on into the jungle's trees past it.)
    const drive = (kmh: number, seconds: number) => {
      const input = { throttle: kmh > 60 ? 1 : 0.3 };
      return run(setup(track, CLASSES, SURFACES, from, input, { kmh }), input, seconds, 0.5).summary;
    };
    const slow = drive(40, 5);
    expect(slow.wrecks.map((w) => w.cause)).toEqual(['hazard']);
    const fast = drive(140, 2);
    expect(fast.wrecks).toEqual([]);
    // (Over it: the far side of the stream, well past its banks.)
    const there = across(4, -(half + LAVA_BANK + 5));
    expect(Math.hypot(fast.end.x - from.x, fast.end.z - from.z)).toBeGreaterThan(Math.hypot(there.x - from.x, there.z - from.z));
  }, 30_000);

  test('the validator wants it off the roads', () => {
    // Across the main road: from one side of its first sample to the other.
    const m = track.main;
    const rx = -m.tz[0];
    const rz = m.tx[0];
    const path: [number, number][] = [
      [m.px[0] - rx * 40, m.pz[0] - rz * 40],
      [m.px[0] + rx * 40, m.pz[0] + rz * 40],
    ];
    const problems = validateLayout({ ...open, ground: { ...open.ground!, features: [{ kind: 'lava-stream', path, width: 6, depth: 4 }] } }, SURFACES, CLASSES);
    expect(problems.some((p) => p.level === 'error' && p.message.includes('lava stream crosses'))).toBe(true);
    expect(validateLayout(open, SURFACES, CLASSES).filter((p) => p.message.includes('lava stream'))).toEqual([]);
  }, 60_000);

  test("the validator checks every feature's shape before baking (an empty path threw; a zero spacing was NaN heights)", () => {
    const features = (fs: unknown[]) => validateLayout({ ...open, ground: { ...open.ground!, features: fs as never } }, SURFACES, CLASSES).filter((p) => p.level === 'error').map((p) => p.message);
    expect(features([{ kind: 'lava-stream', path: [], width: 6, depth: 4 }]).join()).toContain('needs a path of 2 points');
    expect(features([{ kind: 'lava_stream', path: [], width: 6, depth: 4 }]).join()).toContain('unknown kind "lava_stream"');
    expect(features([{ kind: 'moguls', s: [100, 200], lateral: [-5, 5], height: 1, spacing: 0 }]).join()).toContain('a height and a spacing');
    expect(features([{ kind: 'uneven', s: [300, 200], height: 0.3, size: 4 }]).join()).toContain('from the smaller');
    expect(features([{ kind: 'canyon', s: [100, 200], lateral: 10, floor: 4, depth: 3, ease: 0 }]).join()).toContain('an ease');
    expect(features([{ kind: 'beach', s: [2000, 100], side: 'left' }])).toEqual([]);
  }, 60_000);
});
