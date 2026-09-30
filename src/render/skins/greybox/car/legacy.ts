// The milestone 1 cars (boxes, one shape per class), kept only so the car viewer can show before
// and after. Nothing in the game uses it.

import { AdditiveBlending, BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, type MeshToonMaterial, PlaneGeometry, Sprite, SpriteMaterial } from 'three';
import type { CarClass, PaintDef } from '../../../../core/content';
import type { CarVisual } from '../../../skin';
import { glow, toon } from '../toon';

const trim = toon({ color: 0x16121f });
const glass = toon({ color: 0x243a66, emissive: 0x0c1638 });
const headMat = new MeshBasicMaterial({ color: 0xfff4cc });
const headGlow = new SpriteMaterial({ map: glow(), color: 0xfff0c0, transparent: true, blending: AdditiveBlending, depthWrite: false });
const wheelGeo = new CylinderGeometry(0.38, 0.38, 0.3, 12);
wheelGeo.rotateZ(Math.PI / 2);

export function buildLegacyCar(cls: CarClass, paint: PaintDef): CarVisual {
  const [hw, hl] = cls.size;
  const root = new Group();
  const body = new Group();
  root.add(body);
  const bodyMat = toon({
    color: paint.color,
    emissive: paint.finish === 'chrome' ? 0x222233 : 0x000000,
  });
  const second = toon({ color: paint.secondary ?? paint.color });
  const box = (w: number, h: number, d: number, m: MeshToonMaterial | MeshBasicMaterial, x: number, y: number, z: number) => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    body.add(mesh);
    return mesh;
  };
  const W = hw * 2;
  const L = hl * 2;
  if (cls.id === 'van') {
    box(W, 1.7, L, bodyMat, 0, 1.25, 0);
    box(W + 0.04, 0.55, 0.9, glass, 0, 1.6, L / 2 - 0.5);
    box(W + 0.04, 0.45, L * 0.55, glass, 0, 1.7, -0.3);
    box(W + 0.02, 0.15, L - 0.2, second, 0, 0.75, 0);
  } else if (cls.id === 'muscle') {
    box(W, 0.55, L, bodyMat, 0, 0.66, 0);
    box(W * 0.84, 0.38, L * 0.36, glass, 0, 1.12, -0.35);
    box(W * 0.8, 0.12, L * 0.3, bodyMat, 0, 1.35, -0.35);
    box(0.5, 0.04, L * 0.45, second, 0, 0.95, L * 0.22);
    box(W + 0.05, 0.08, 0.45, trim, 0, 1.12, -L / 2 + 0.2);
  } else if (cls.id === 'hatch') {
    box(W, 0.62, L, bodyMat, 0, 0.72, 0);
    box(W * 0.88, 0.48, L * 0.52, glass, 0, 1.25, -0.2);
    box(W * 0.84, 0.12, L * 0.5, bodyMat, 0, 1.54, -0.2);
  } else {
    // coupe
    box(W, 0.5, L, bodyMat, 0, 0.62, 0);
    box(W * 0.85, 0.32, L * 0.42, glass, 0, 1.02, -0.25);
    box(W * 0.79, 0.12, L * 0.35, bodyMat, 0, 1.22, -0.3);
    box(W + 0.05, 0.08, 0.5, trim, 0, 1.2, -L / 2 + 0.1);
    box(0.45, 0.03, L * 0.35, second, 0, 0.885, L * 0.25);
  }
  const lightY = cls.id === 'van' ? 0.8 : 0.7;
  const tailMat = new MeshBasicMaterial({ color: 0x991122 });
  const tailGlow = new SpriteMaterial({ map: glow(), color: 0xff2344, transparent: true, opacity: 0.6, blending: AdditiveBlending, depthWrite: false });
  for (const s of [-1, 1]) {
    box(0.42, 0.16, 0.06, headMat, s * (hw - 0.36), lightY, L / 2 + 0.01);
    box(0.42, 0.14, 0.06, tailMat, s * (hw - 0.36), lightY, -L / 2 - 0.01);
    const hg = new Sprite(headGlow);
    hg.scale.set(1.5, 1.5, 1);
    hg.position.set(s * (hw - 0.36), lightY, L / 2 + 0.12);
    const tg = new Sprite(tailGlow);
    tg.scale.set(1, 1, 1);
    tg.position.set(s * (hw - 0.36), lightY, -L / 2 - 0.12);
    body.add(hg, tg);
  }
  const wheels: Mesh[] = [];
  const front: Group[] = [];
  const wz = hl - 0.75;
  for (const z of [wz, -wz]) {
    for (const s of [-1, 1]) {
      const pivot = new Group();
      pivot.position.set(s * (hw - 0.08), 0.38, z);
      const w = new Mesh(wheelGeo, trim);
      pivot.add(w);
      root.add(pivot);
      wheels.push(w);
      if (z > 0) front.push(pivot);
    }
  }
  if (paint.underglow) {
    const u = new Mesh(new PlaneGeometry(W + 2.2, L + 1.6), new MeshBasicMaterial({ map: glow(), color: paint.underglow, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false }));
    u.rotation.x = -Math.PI / 2;
    u.position.y = 0.06;
    root.add(u);
  }
  const shadow = new Mesh(new PlaneGeometry(W + 0.8, L + 0.8), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.04;
  root.add(shadow);
  const flame = new Mesh(new PlaneGeometry(0.9, 2.2), new MeshBasicMaterial({ map: glow(), color: 0xff7a1a, transparent: true, blending: AdditiveBlending, depthWrite: false }));
  flame.rotation.x = -Math.PI / 2;
  flame.position.set(0, lightY, -L / 2 - 1.1);
  flame.visible = false;
  root.add(flame);

  return {
    root,
    update(spin, steer, braking, boosting, onRoad) {
      for (const w of wheels) w.rotation.x = spin;
      for (const f of front) f.rotation.y = steer * 0.45;
      tailMat.color.setHex(braking ? 0xff2344 : 0x991122);
      tailGlow.opacity = braking ? 1 : 0.6;
      flame.visible = boosting;
      if (boosting) flame.scale.set(1, 0.8 + Math.random() * 0.5, 1);
    },
    dispose() {
      root.traverse((o) => {
        if (o instanceof Mesh && o.geometry !== wheelGeo) o.geometry.dispose();
      });
      bodyMat.dispose();
      second.dispose();
      tailMat.dispose();
      tailGlow.dispose();
    },
  };
}
