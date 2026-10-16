import { expect, test } from 'bun:test';
import { ShaderLib } from 'three';

// The camel's walk (render/skins/greybox/car/traffic.ts): render only, in the traffic material's
// vertex shader, by a per-vertex rig. Cars share that material and must never move.

// The car builder makes its glow texture as it loads: a canvas stub for the import, gone after.
const g = globalThis as { document?: unknown };
const ctx = { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} };
g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
const { trafficModels } = await import('../src/render/skins/greybox/car/traffic');
delete g.document;

test("the walk hooks the toon shader, and only the camel walks (every car's rig is 0)", () => {
  const { geos, material } = trafficModels();
  const shader = { vertexShader: ShaderLib.toon.vertexShader, fragmentShader: ShaderLib.toon.fragmentShader, uniforms: {} };
  material.onBeforeCompile(shader as never, undefined as never);
  expect(shader.vertexShader).toContain('objectNormal=walk(objectNormal,0.0)');
  expect(shader.vertexShader).toContain('transformed=walk(transformed,1.0)');
  for (const [id, geo] of Object.entries(geos)) {
    const rig = geo.getAttribute('rig').array;
    const parts = new Set<number>();
    for (let i = 0; i < rig.length; i += 4) parts.add(rig[i]);
    // The camel: every part on its rig (the body bobs), each leg a thigh and a shin, its neck and tail.
    expect([id, ...[...parts].sort()]).toEqual(id === 'camel' ? [id, 1, 2, 3, 4, 5] : [id, 0]);
    expect(geo.userData.walks === true).toBe(id === 'camel');
  }
});
