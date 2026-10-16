import { describe, expect, test } from 'bun:test';
import { ShaderLib } from 'three';

// The camel's walk (render/skins/greybox/car/traffic.ts): render only, in the vertex shader of a
// material of its own, by a per-vertex rig. Cars never move.

// The car builder makes its glow texture as it loads: a canvas stub for the import, and whatever
// was there before put back.
const g = globalThis as { document?: unknown };
const was = g.document;
const ctx = { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} };
g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
const { CAMEL_STRIDE, CAMEL_WALK, trafficModels } = await import('../src/render/skins/greybox/car/traffic');
g.document = was;

describe('the camel walks', () => {
  test('with a material of its own: the cars have no rig and their material no walk', () => {
    const { geos, material, walker } = trafficModels();
    const vertex = (m: typeof material) => {
      const shader = { vertexShader: ShaderLib.toon.vertexShader, fragmentShader: ShaderLib.toon.fragmentShader, uniforms: {} };
      m.onBeforeCompile(shader as never, undefined as never);
      return shader.vertexShader;
    };
    expect(vertex(walker)).toContain('objectNormal=walk(objectNormal,0.0)');
    expect(vertex(walker)).toContain('transformed=walk(transformed,1.0)');
    expect(vertex(material)).not.toContain('walk(');
    for (const [id, geo] of Object.entries(geos)) {
      expect([id, geo.userData.walks === true]).toEqual([id, id === 'camel']);
      if (id !== 'camel') {
        expect([id, geo.hasAttribute('rig')]).toEqual([id, false]);
        continue;
      }
      // Every part on its rig (the body bobs): each leg a thigh and a shin, its neck and tail.
      const rig = geo.getAttribute('rig').array;
      const parts = new Set<number>();
      for (let i = 0; i < rig.length; i += 4) parts.add(rig[i]);
      expect([...parts].sort()).toEqual([1, 2, 3, 4, 5]);
    }
  });

  // The shader's leg in TypeScript: the same steps as `walk` in traffic.ts's WALK (change both
  // together). Where a front sole is at gait g, from under its hip at rest: [up, forward].
  const { LEG, KNEE, SWING, LIFT, REACH } = CAMEL_WALK;
  const THIGH = LEG - KNEE;
  const fract = (x: number) => x - Math.floor(x);
  const reachAt = (u: number) => (u >= 0.5 ? 3 - 4 * u : ((-8 * 2 * u + 12) * 2 * u - 2) * 2 * u - 1);
  const rigX = ([y, z]: number[], a: number, [cy, cz]: number[]) => [(y - cy) * Math.cos(a) - (z - cz) * Math.sin(a) + cy, (y - cy) * Math.sin(a) + (z - cz) * Math.cos(a) + cz];
  const clamp = (x: number) => Math.max(-1, Math.min(1, x));
  const leg = (gait: number, right: boolean) => {
    const u = fract(gait / (2 * Math.PI));
    const down = 1 - 2 * fract(2 * u);
    const hip = Math.sqrt(1 - Math.sin(SWING) ** 2 * down * down);
    const ul = fract(u + (right ? 0.5 : 0));
    const foot = [LEG * Math.sin(SWING) * reachAt(ul), LIFT * Math.max(Math.sin(2 * Math.PI * ul), 0)];
    if (ul < 0.5) foot[1] = Math.max(foot[1], LEG * hip - Math.sqrt(Math.max((REACH * LEG) ** 2 - foot[0] ** 2, 0)));
    const d = [foot[0], LEG * hip - foot[1]];
    const n = Math.hypot(d[0], d[1]);
    const line = Math.atan2(d[0], d[1]);
    const th = Math.acos(clamp((THIGH * THIGH - KNEE * KNEE + n * n) / (2 * THIGH * n)));
    const sh = Math.acos(clamp((KNEE * KNEE - THIGH * THIGH + n * n) / (2 * KNEE * n)));
    // The sole, folded at the knee, swung at the hip, dropped with the body.
    const [y, z] = rigX(rigX([0, 0], th + sh, [KNEE, 0]), -(line + th), [LEG, 0]);
    return { down: ul >= 0.5, n, sole: [y - LEG * (1 - hip), z], foot };
  };

  test('a planted foot stays put on the sand; a lifted one is where it was sent, clear of it', () => {
    // The gait is the camel's distance walked: a stride a cycle.
    const N = 4000;
    const step = 1e-4;
    for (const right of [false, true]) {
      for (let i = 0; i < N; i++) {
        const gait = (2 * Math.PI * i) / N;
        const at = leg(gait, right);
        const next = leg(gait + step, right);
        // Within reach, so the leg gets there (it's never straightened short of where it's sent).
        expect(at.n).toBeLessThanOrEqual(LEG + 1e-9);
        expect(Math.hypot(at.sole[0] - at.foot[1], at.sole[1] - at.foot[0])).toBeLessThan(1e-6);
        if (at.down && next.down) {
          expect(Math.abs(at.sole[0])).toBeLessThan(1e-6);
          // Not sliding: the foot goes back by just what the camel walks on.
          expect(Math.abs((CAMEL_STRIDE * step) / (2 * Math.PI) + (next.sole[1] - at.sole[1]))).toBeLessThan(1e-7);
        } else expect(at.sole[0]).toBeGreaterThan(-1e-6);
      }
    }
  });

  test('the pairs pace: half a stride apart, one always down', () => {
    for (let i = 0; i < 1000; i++) {
      const gait = (2 * Math.PI * i) / 1000;
      expect(leg(gait, false).down).not.toBe(leg(gait, true).down);
    }
  });
});
