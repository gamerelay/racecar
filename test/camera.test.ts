// The cameras against the ground (src/render/camera.ts): what keeps them out of it.

import { describe, expect, test } from 'bun:test';
import { bakeTrack } from '../src/core/track/bake';
import { WRECK_ORBIT, indoorAt, wreckView } from '../src/render/camera';
import { SURFACES, layout } from './helpers';

describe('the wreck camera', () => {
  // (The owner, 2026-10-05: wrecked by a bank off Coastal's road, the screen was sand.)
  for (const key of ['coastal/riviera', 'avalanche/slope', 'paradise-open/open']) {
    test(`${key}: circling a car wrecked on the road or off it, never in the ground`, () => {
      const track = bakeTrack(layout(key), SURFACES);
      const g = track.ground!;
      const walls = track.props.filter((p) => p.kind === 'building-wall' || p.kind === 'house');
      const m = track.main;
      const cam = { x: 0, y: 0, z: 0 };
      let checked = 0;
      for (let i = 0; i < m.n; i += 40)
        for (const off of [0, 1.2, 2]) {
          // On the road, and off it past its edge either side (where the banks are).
          for (const side of off ? [-1, 1] : [1]) {
            const lat = side * (m.width[i] / 2) * off;
            const x = m.px[i] - m.tz[i] * lat;
            const z = m.pz[i] + m.tx[i] * lat;
            const y = off ? g.height(x, z) : m.py[i];
            if (indoorAt(g, x, y + 1.5, z)) continue;
            // Round at 60 fps (0.7 rad/s, as the renderer): over the ground, out at the orbit's
            // distance (never pulled in to the car), and no jumps from one frame to the next.
            let last: { x: number; y: number; z: number } | undefined;
            for (let a = 0; a < Math.PI * 2; a += 0.7 / 60) {
              wreckView(g, walls, x, y, z, a, cam);
              expect(cam.y).toBeGreaterThan(g.height(cam.x, cam.z) + 1);
              expect(Math.hypot(cam.x - x, cam.z - z)).toBeCloseTo(WRECK_ORBIT.r, 3);
              if (last) expect(Math.hypot(cam.x - last.x, cam.y - last.y, cam.z - last.z)).toBeLessThan(1);
              last = { ...cam };
              checked++;
            }
          }
        }
      expect(checked).toBeGreaterThan(10000);
    }, 60_000);
  }
});
