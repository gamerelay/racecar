import { describe, expect, test } from 'bun:test';
import { ShaderLib } from 'three';
import { chaseOffset, lookBackOffset } from '../src/render/camera';
import { chunks } from '../src/render/shader';
import { carPaint } from '../src/render/skins/greybox/car/paint';
import { windowMaterial } from '../src/render/skins/greybox/city';
import { CLASSES } from './helpers';

// Render logic that runs without WebGL: where the camera sits for every car, and that every shader
// patch still finds the chunk it hooks (a miss throws, see render/shader.ts).

describe('chase camera', () => {
  // The collider is a box of half extents `size` on the road; the camera must never be inside it.
  const inside = (size: number[], along: number, up: number) => Math.abs(along) < size[1] + 0.3 && up < size[2] * 2 + 0.2;
  test('sits outside every car: chasing at rest and at speed, snapped, and looking back', () => {
    for (const c of CLASSES) {
      for (const [speed, boost] of [[0, 0], [60, 1]]) {
        const o = chaseOffset(c.size, speed, boost);
        expect(inside(c.size, -o.dist, o.height)).toBe(false);
        // Looking ahead of the nose, not into the car.
        expect(o.ahead).toBeGreaterThan(c.size[1]);
      }
      const b = lookBackOffset(c.size);
      expect(inside(c.size, b.dist, b.height)).toBe(false);
    }
  });
  test('the coupe keeps the tuned numbers (4.7 m back, 1.85 m up; look-back 5 m ahead, 2.4 up)', () => {
    const coupe = CLASSES.find((c) => c.id === 'coupe')!;
    expect(chaseOffset(coupe.size)).toEqual({ dist: 4.7, height: 1.85, ahead: 11, lookUp: 1 });
    expect(lookBackOffset(coupe.size).dist).toBeCloseTo(5, 5);
    expect(lookBackOffset(coupe.size).height).toBeCloseTo(2.4, 5);
  });
  test('the bus sits further back, higher, and looks further ahead than the coupe', () => {
    const [coupe, bus] = ['coupe', 'bus'].map((id) => chaseOffset(CLASSES.find((c) => c.id === id)!.size));
    expect(bus.dist).toBeGreaterThan(coupe.dist);
    expect(bus.height).toBeGreaterThan(coupe.height);
    expect(bus.ahead).toBeGreaterThan(coupe.ahead);
  });
});

describe('shader patches', () => {
  const compile = (mat: { onBeforeCompile: (s: never, r: never) => void }, lib: { vertexShader: string; fragmentShader: string; uniforms: object }) => {
    const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: { ...lib.uniforms } };
    mat.onBeforeCompile(shader as never, undefined as never);
    return shader;
  };
  test('lit windows hook the toon shader', () => {
    const s = compile(windowMaterial(1), ShaderLib.toon);
    expect(s.vertexShader).toContain('vWinPos=');
    expect(s.fragmentShader).toContain('totalEmissiveRadiance+=pane');
  });
  test('car paint hooks the toon shader (livery and finish)', () => {
    const s = compile(carPaint({ id: 'x', name: 'x', color: '#ff2e88', finish: 'chrome', secondary: '#35f0ff' }, 'rally'), ShaderLib.toon);
    expect(s.vertexShader).toContain('vObjPos=position');
    expect(s.fragmentShader).toContain('liveryMask()');
    expect(s.fragmentShader).toContain('rallyNumbers');
  });
  test('a patch whose chunk is missing throws, naming it', () => {
    expect(() => chunks('void main(){}', 'test').replace('#include <nope>', '')).toThrow('test');
    expect(chunks('a #include <x> b').after('#include <x>', 'y;').text).toBe('a #include <x>\ny; b');
  });
});
