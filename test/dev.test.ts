// Caldera's dev helpers (src/dev/, docs/CALDERA.md "Developer tools"): what the tools and
// window.__rc.dev stand on, so they say true things about the game.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bakeTrack } from '../src/core/track/bake';
import { describeDrive, run, setup } from '../src/dev/drive';
import { describeProbe, probe } from '../src/dev/probe';
import { CLASSES, SURFACES, layout } from './helpers';

const open = bakeTrack(layout('paradise-open/open'), SURFACES);
const tube = open.splines.find((sp) => sp.id === 'lava-tube')!;
const at = (s: number) => {
  const k = Math.round(s / tube.step);
  return { x: tube.px[k], z: tube.pz[k], y: tube.py[k] };
};

describe('probe', () => {
  test('in the tube: on its deck, under the volcano', () => {
    const p = at(120);
    const r = probe(open, p.x, p.z, p.y + 0.3);
    expect(r.near.road).toBe('lava-tube');
    expect(r.near.on).toBe('road');
    expect(r.ground!.on).toBe('lava-tube-in');
    expect(r.ground!.space).toBe('enclosed');
    expect(r.ground!.height).toBeGreaterThan(p.y + 7);
  });

  test("over the jump's gap: nothing to stand on but the shaft far below", () => {
    const p = at(250);
    const r = probe(open, p.x, p.z, p.y);
    expect(r.ground!.on).toBe('ground');
    expect(r.ground!.stand).toBeLessThan(p.y - 3);
  });

  test('a layout without ground: the road and its surface only', () => {
    const r = probe(bakeTrack(layout('downtown/downtown'), SURFACES), 0, 100);
    expect(r.ground).toBeUndefined();
    expect(r.surface).toBe('asphalt');
    expect(describeProbe(r)).toContain('surface: asphalt');
  });
});

describe('drive', () => {
  const jump = (kmh: number) => {
    const sim = setup(open, CLASSES, SURFACES, { road: 'lava-tube', s: 205 }, { throttle: 1 }, { kmh });
    return run(sim, { throttle: 1 }, 2.5);
  };

  test('flat out, the jump clears: air, a landing, no wreck', () => {
    const d = jump(175);
    expect(d.summary.wrecks).toEqual([]);
    expect(d.summary.airSeconds).toBeGreaterThan(0.5);
    expect(d.events.some((e) => e.type === 'land')).toBe(true);
    expect(d.summary.end.s).toBeGreaterThan(290);
  });

  test('too slow, it falls in the lava', () => {
    expect(jump(100).summary.wrecks.length).toBeGreaterThan(0);
  });

  test('the AI drives from a spot on the main road', () => {
    const sim = setup(open, CLASSES, SURFACES, { s: 100 }, 'ai');
    const d = run(sim, 'ai', 5, 1);
    // (On along the main road, or down the market street off it.)
    expect(Math.hypot(d.summary.end.x - d.rows[0].x, d.summary.end.z - d.rows[0].z)).toBeGreaterThan(50);
    expect(describeDrive(d)).toContain('summary:');
  });

  test('placed at a point, the car finds the road there', () => {
    const p = at(150);
    const sim = setup(open, CLASSES, SURFACES, { x: p.x, z: p.z, y: p.y }, {});
    expect(sim.track.splines[sim.cars.spline[0]].id).toBe('lava-tube');
  });
});

describe('architecture', () => {
  test('src/dev imports only core and itself, and no DOM or three', () => {
    const dir = join(import.meta.dir, '../src/dev');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      for (const m of src.matchAll(/from '([^']+)'/g)) expect(m[1].startsWith('./') || m[1].startsWith('../core/') ? true : `${f}: ${m[1]}`).toBe(true);
      expect(/\b(document|window|requestAnimationFrame)\b/.test(src.replace(/\/\/.*$/gm, '')) ? f : true).toBe(true);
    }
  });
});
