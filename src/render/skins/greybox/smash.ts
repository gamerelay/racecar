// Greybox smashables (core/world/smash.ts): one instanced mesh per kind, each model a few parts
// merged with their own colors. A smashed one is hidden (the burst is the renderer's, from the
// Smash event) and pops back up when it stands again.

import { BoxGeometry, type BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, IcosahedronGeometry, InstancedMesh, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SimState } from '../../../core/state';
import { hash01 } from '../../../core/rng';
import { newHit, sampleAt } from '../../../core/track/query';
import { SMASH_IDS, SMASH_KINDS, SMASH_OPEN, SMASH_RESPAWN } from '../../../core/world/smash';
import { toon } from './toon';

/** A part: a geometry moved into place, painted one colour. */
function part(geo: BufferGeometry, color: number, x = 0, y = 0, z = 0, rz = 0): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  const c = new Color(color);
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new Float32BufferAttribute(Array.from({ length: n * 3 }, (_, k) => [c.r, c.g, c.b][k % 3]), 3));
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

/** The models, at the prop's foot, front toward +z (the road). */
const MODELS: Record<string, () => BufferGeometry> = {
  cone: () =>
    mergeGeometries([part(new BoxGeometry(0.62, 0.06, 0.62), 0xff7a1a, 0, 0.03), part(new ConeGeometry(0.28, 0.72, 10), 0xff7a1a, 0, 0.42), part(new CylinderGeometry(0.17, 0.2, 0.12, 10), 0xffffff, 0, 0.48)])!,
  'newspaper-box': () =>
    mergeGeometries([
      part(new BoxGeometry(0.62, 0.72, 0.52), 0x3a86ff, 0, 0.72),
      part(new BoxGeometry(0.5, 0.26, 0.04), 0xcfe8ff, 0, 0.82, 0.27),
      part(new BoxGeometry(0.66, 0.08, 0.56), 0x2a5ec0, 0, 1.1),
      part(new BoxGeometry(0.08, 0.36, 0.08), 0x2a2140, -0.24, 0.18, 0),
      part(new BoxGeometry(0.08, 0.36, 0.08), 0x2a2140, 0.24, 0.18, 0),
    ])!,
  'hay-bale': () => mergeGeometries([part(new CylinderGeometry(0.7, 0.7, 1.5, 12), 0xe2c36a, 0, 0.7, 0, Math.PI / 2), part(new CylinderGeometry(0.72, 0.72, 0.12, 12), 0xc9a44a, 0.5, 0.7, 0, Math.PI / 2)])!,
  mailbox: () =>
    mergeGeometries([
      part(new BoxGeometry(0.12, 1.05, 0.12), 0x6b4a3a, 0, 0.52),
      part(new BoxGeometry(0.34, 0.32, 0.6), 0x6b7078, 0, 1.2),
      part(new BoxGeometry(0.04, 0.3, 0.1), 0xd7263d, 0.2, 1.36, -0.1),
    ])!,
  'beach-umbrella': () =>
    mergeGeometries([
      part(new CylinderGeometry(0.05, 0.05, 2.4, 6), 0xf2f2f2, 0, 1.2),
      part(new ConeGeometry(1.3, 0.55, 8), 0xff2e88, 0, 2.45),
      part(new ConeGeometry(0.5, 0.25, 8), 0xffffff, 0, 2.75),
    ])!,
  // A slalom gate's flag: a pole and a panel across it, square to the road (seen from up the slope).
  'gate-red': () =>
    mergeGeometries([
      part(new CylinderGeometry(0.07, 0.08, 3.2, 6), 0xf2f2f2, 0, 1.6),
      part(new BoxGeometry(0.06, 1.3, 1.7), 0xe8433a, 0, 2.5),
      part(new BoxGeometry(0.07, 0.16, 1.72), 0xffffff, 0, 2.05),
    ])!,
  'gate-blue': () =>
    mergeGeometries([
      part(new CylinderGeometry(0.07, 0.08, 3.2, 6), 0xf2f2f2, 0, 1.6),
      part(new BoxGeometry(0.06, 1.3, 1.7), 0x2f6bff, 0, 2.5),
      part(new BoxGeometry(0.07, 0.16, 1.72), 0xffffff, 0, 2.05),
    ])!,
  'fruit-stand': () =>
    mergeGeometries([
      part(new BoxGeometry(2.2, 0.8, 1), 0x8a5a33, 0, 0.4),
      part(new BoxGeometry(2.4, 0.08, 1.2), 0xa87a4a, 0, 0.84),
      part(new BoxGeometry(0.08, 1, 0.08), 0x6b4a3a, -1.05, 1.3, -0.45),
      part(new BoxGeometry(0.08, 1, 0.08), 0x6b4a3a, 1.05, 1.3, -0.45),
      part(new BoxGeometry(2.4, 0.08, 1.3), 0x35f0ff, 0, 1.82, 0.05),
      part(new IcosahedronGeometry(0.2, 0), 0xffd23f, -0.6, 1, 0.1),
      part(new IcosahedronGeometry(0.2, 0), 0xff6a00, -0.15, 1, 0.2),
      part(new IcosahedronGeometry(0.22, 0), 0x7cff6b, 0.35, 1, 0),
      part(new IcosahedronGeometry(0.2, 0), 0xff2e88, 0.75, 1, 0.2),
    ])!,
  // A Mediterranean bush: a few low, lumpy greens in a clump.
  bush: () =>
    mergeGeometries([
      part(new IcosahedronGeometry(0.95, 0), 0x3f6b2c, 0, 0.75, 0),
      part(new IcosahedronGeometry(0.7, 0), 0x557f34, 0.6, 0.6, 0.3),
      part(new IcosahedronGeometry(0.65, 0), 0x4a7530, -0.55, 0.55, -0.25),
      part(new IcosahedronGeometry(0.55, 0), 0x66893a, 0.1, 1.25, -0.1),
    ])!,
};

/** A popped-back prop grows to full size over this long (s). */
const POP = 0.35;

export function buildSmashVisual(sim: SimState): { objects: Object3D[]; update(time: number): void } {
  const sm = sim.world!.smash;
  const hit = newHit();
  const material = toon({ vertexColors: true });
  const meshes: { mesh: InstancedMesh; pieces: number[]; yaw: number[]; shown: Float32Array }[] = [];
  const m4 = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const p = new Vector3();
  const sc = new Vector3();
  SMASH_IDS.forEach((id, kind) => {
    const pieces: number[] = [];
    for (let k = 0; k < sm.n; k++) if (sm.kind[k] === kind) pieces.push(k);
    if (!pieces.length) return;
    // Each faces the road it stands by.
    const yaw = pieces.map((k) => {
      // (One on open ground faces any way: its spot's own.)
      if (sm.spline[k] === SMASH_OPEN) return hash01(k, 71, 3) * Math.PI * 2;
      const at = sampleAt(sim.track.splines[sm.spline[k]], sm.s[k], hit);
      const lat = (sm.x[k] - at.cx) * -at.tz + (sm.z[k] - at.cz) * at.tx;
      const face = lat > 0 ? Math.atan2(at.tz, -at.tx) : Math.atan2(-at.tz, at.tx);
      return face + (SMASH_KINDS[kind].id === 'hay-bale' ? Math.PI / 2 : 0);
    });
    const mesh = new InstancedMesh(MODELS[id](), material, pieces.length);
    mesh.frustumCulled = false;
    meshes.push({ mesh, pieces, yaw, shown: new Float32Array(pieces.length).fill(-1) });
  });
  return {
    objects: meshes.map((x) => x.mesh),
    update(time) {
      for (const g of meshes) {
        let dirty = false;
        g.pieces.forEach((k, j) => {
          const since = time - sm.brokenAt[k] - SMASH_RESPAWN;
          const s = since < 0 ? 0 : Math.min(1, since / POP);
          if (s === g.shown[j]) return;
          g.shown[j] = s;
          dirty = true;
          m4.compose(p.set(sm.x[k], sm.y[k], sm.z[k]), q.setFromAxisAngle(up, g.yaw[j]), sc.setScalar(Math.max(s, 1e-4)));
          g.mesh.setMatrixAt(j, m4);
        });
        if (dirty) {
          g.mesh.instanceMatrix.needsUpdate = true;
          g.mesh.computeBoundingSphere();
        }
      }
    },
  };
}
