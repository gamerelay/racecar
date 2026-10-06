// The cameras against the ground (src/render/camera.ts): what keeps them out of it.

import { describe, expect, test } from 'bun:test';
import { bakeTrack } from '../src/core/track/bake';
import { inRock, indoorAt, wreckView } from '../src/render/camera';
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
      for (let i = 0; i < m.n; i += 20)
        for (const off of [0, 1.2, 2]) {
          // On the road, and off it past its edge either side (where the banks are).
          for (const side of off ? [-1, 1] : [1]) {
            const lat = side * (m.width[i] / 2) * off;
            const x = m.px[i] - m.tz[i] * lat;
            const z = m.pz[i] + m.tx[i] * lat;
            const y = off ? g.height(x, z) : m.py[i];
            // (Not in a tunnel, nor down a trench with the ground over its head: there it's pulled in to the car.)
            if (indoorAt(g, x, y + 1.5, z) || inRock(g, x, y + 1, z)) continue;
            for (let a = 0; a < 16; a++) {
              wreckView(g, walls, x, y, z, (a / 16) * Math.PI * 2, cam);
              expect(cam.y).toBeGreaterThan(g.height(cam.x, cam.z));
              checked++;
            }
          }
        }
      expect(checked).toBeGreaterThan(1000);
    }, 60_000);
  }
});
