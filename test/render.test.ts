import { describe, expect, test } from 'bun:test';
import { flatten } from '../src/render/skins/greybox/flatten';
import { toon } from '../src/render/skins/greybox/toon';
import { chaseOffset, lookBackOffset } from '../src/render/camera';
import { chunks } from '../src/render/shader';
import { Skids } from '../src/render/skids';
import { carPaint } from '../src/render/skins/greybox/car/paint';
import { windowMaterial } from '../src/render/skins/greybox/city';
import { SHADOW, shadowOpacity } from '../src/render/skins/greybox/car/shadow';
import { BoxGeometry, Euler, Group, Mesh, MeshBasicMaterial, Quaternion, ShaderLib } from 'three';
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

describe('skid marks', () => {
  const alphaAt = (sk: Skids, seg: number, vert: number) => (sk as unknown as { info: Float32Array }).info[seg * 12 + vert * 3 + 1];
  const drive = (sk: Skids, key: number, x0: number, x1: number) => {
    for (let x = x0; x <= x1; x += 0.25) sk.mark(key, x, 0, 0, 0.4, 0.3, 0.3, 0.3, 0.8);
  };

  test('a wheel lays a joined strip that fades in from nothing, and lifting it ends the strip', () => {
    const sk = new Skids();
    drive(sk, 0, 0, 10);
    // ~0.5 m a segment over 10 m.
    expect(sk.laid).toBeGreaterThanOrEqual(18);
    expect(sk.laid).toBeLessThanOrEqual(21);
    // The first segment starts at alpha 0; the next picks up where it ended.
    expect(alphaAt(sk, 0, 0)).toBe(0);
    expect(alphaAt(sk, 0, 2)).toBeCloseTo(0.8, 5);
    expect(alphaAt(sk, 1, 0)).toBeCloseTo(0.8, 5);
    const before = sk.laid;
    sk.lift(0);
    // After a lift the next mark only starts a strip; one more step lays a fresh fade-in.
    drive(sk, 0, 20, 20.6);
    expect(sk.laid).toBe(before + 1);
    expect(alphaAt(sk, before, 0)).toBe(0);
  });

  test('a teleport (a respawn) starts over instead of drawing a mark across the map', () => {
    const sk = new Skids();
    drive(sk, 3, 0, 5);
    const before = sk.laid;
    sk.mark(3, 200, 0, 0, 0.4, 0.3, 0.3, 0.3, 0.8);
    expect(sk.laid).toBe(before);
  });

  test("snow's ring: its own size and segment length, and the oldest overwritten when it's full", () => {
    const sk = new Skids(40, 900, 1.2);
    drive(sk, 0, 0, 12);
    // ~1.2 m a segment over 12 m.
    expect(sk.laid).toBeGreaterThanOrEqual(9);
    expect(sk.laid).toBeLessThanOrEqual(11);
    drive(sk, 0, 12.25, 200);
    expect(sk.laid).toBe(40);
  });

  test('the ring wraps: old marks are overwritten, never more than it holds', () => {
    const sk = new Skids();
    drive(sk, 1, 0, 4000);
    expect(sk.laid).toBe(6000);
    sk.clear();
    expect(sk.laid).toBe(0);
  });
});

describe('contact shadow', () => {
  const q = (pitch: number, roll: number, yaw = 0) => new Quaternion().setFromEuler(new Euler(pitch, yaw, roll, 'YXZ'));
  const settle = (qq: Quaternion, onRoad: boolean, from = SHADOW) => {
    let o = from;
    for (let k = 0; k < 60; k++) o = shadowOpacity(o, qq.x, qq.z, onRoad, 1 / 60);
    return o;
  };

  test('on its wheels it shows, whichever way the car faces and on a banked road', () => {
    expect(settle(q(0, 0), true, 0)).toBeCloseTo(SHADOW, 3);
    expect(settle(q(0, 0, 2.5), true, 0)).toBeCloseTo(SHADOW, 3);
    expect(settle(q(0.1, 0.15, 1), true, 0)).toBeCloseTo(SHADOW, 3);
  });

  test('flipped, on its side or in the air it fades out (it hung off the car like a black slab)', () => {
    expect(settle(q(0, Math.PI), true)).toBeCloseTo(0, 3);
    expect(settle(q(0, Math.PI / 2), true)).toBeCloseTo(0, 3);
    expect(settle(q(0.9, 0), true)).toBeCloseTo(0, 3);
    expect(settle(q(0, 0), false)).toBeCloseTo(0, 3);
  });

  test('it eases over a few frames, and snaps when no time passes', () => {
    const flipped = q(0, Math.PI);
    const one = shadowOpacity(SHADOW, flipped.x, flipped.z, true, 1 / 60);
    expect(one).toBeGreaterThan(0.2);
    expect(one).toBeLessThan(SHADOW);
    expect(shadowOpacity(SHADOW, flipped.x, flipped.z, true, 0)).toBe(0);
  });
});

describe('flatten (the draw call pass)', () => {
  test("a model's plain toon parts become one mesh, coloured per part and where they stood; the rest are left", () => {
    const root = new Group();
    for (let k = 0; k < 100; k++) {
      const m = new Mesh(new BoxGeometry(1, 1, 1), toon({ color: k % 2 ? 0xff0000 : 0x0000ff }));
      m.position.set(k * 3, 0, 0);
      root.add(m);
    }
    const lit = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: 0xffffff }));
    const glass = new Mesh(new BoxGeometry(1, 1, 1), toon({ transparent: true, opacity: 0.5 }));
    root.add(lit, glass);
    expect(flatten(root)).toBe(100);
    const meshes = root.children.filter((o) => (o as Mesh).isMesh) as Mesh[];
    expect(meshes.length).toBe(3);
    const merged = meshes.find((m) => m !== lit && m !== glass)!;
    const pos = merged.geometry.getAttribute('position');
    const col = merged.geometry.getAttribute('color');
    expect(pos.count).toBe(100 * 36);
    // The last box (k 99, red) out at x 297.
    let far = -Infinity;
    for (let i = 0; i < pos.count; i++) far = Math.max(far, pos.getX(i));
    expect(far).toBeCloseTo(297.5);
    const last = pos.count - 1;
    expect([col.getX(last), col.getY(last), col.getZ(last)]).toEqual([1, 0, 0]);
  });
});
