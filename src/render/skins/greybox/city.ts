// City dressing from the prototype: lit windows on the blocks, and street lamps with a glow and a
// pool of light on the road. Both are one or two draw calls for the whole lap.

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  Vector3,
  type MeshToonMaterial,
  type Object3D,
} from 'three';
import type { Track } from '../../../core/track/bake';
import { glow, toon } from './toon';

/**
 * A toon material that draws a grid of lit and dark windows on the walls of whatever it's on,
 * from world position (so it works on instanced blocks of any size, with no UVs). Roofs stay plain.
 */
export function windowMaterial(intensity: number): MeshToonMaterial {
  const mat = toon();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWin = { value: intensity };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWinPos;\nvarying vec3 vWinN;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 winP=vec4(transformed,1.0);
        vec3 winN=objectNormal;
        #ifdef USE_INSTANCING
          winP=instanceMatrix*winP;
          winN=mat3(instanceMatrix)*winN;
        #endif
        vWinPos=(modelMatrix*winP).xyz;
        vWinN=normalize(mat3(modelMatrix)*winN);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWinPos;\nvarying vec3 vWinN;\nuniform float uWin;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if(abs(vWinN.y)<0.5&&vWinPos.y>1.5){
          vec2 t=normalize(vec2(-vWinN.z,vWinN.x));
          vec2 g=vec2(dot(vWinPos.xz,t),vWinPos.y)/vec2(3.2,3.4);
          vec2 cell=floor(g);
          vec2 f=fract(g);
          float h=fract(sin(dot(cell,vec2(12.9898,78.233))+dot(floor(vWinPos.xz/40.0),vec2(3.1,7.7)))*43758.5453);
          float pane=step(0.22,f.x)*step(f.x,0.78)*step(0.2,f.y)*step(f.y,0.8);
          vec3 lit=h<0.12?vec3(0.62,0.95,1.0):h<0.2?vec3(1.0,0.6,0.84):vec3(1.0,0.82,0.5);
          totalEmissiveRadiance+=pane*step(h,0.38)*lit*uWin;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'greybox-windows';
  return mat;
}

/** Lamps along the main road's edges, alternating sides, every `spacing` meters. */
export function streetLamps(track: Track, spacing = 34): Object3D {
  const sp = track.main;
  const spots: { x: number; y: number; z: number; rx: number; rz: number }[] = [];
  let side = 1;
  for (let s = 10; s < sp.length - 5; s += spacing, side = -side) {
    const i = Math.min(sp.n - 1, Math.round(s / sp.step));
    const rx = -sp.tz[i] * side;
    const rz = sp.tx[i] * side;
    const off = sp.width[i] / 2 + sp.shoulder[i] - 0.6;
    spots.push({ x: sp.px[i] + rx * off, y: sp.py[i] + sp.ramp[i], z: sp.pz[i] + rz * off, rx, rz });
  }
  const group = new Group();
  const n = spots.length;
  const poleMat = toon({ color: 0x2a2140 });
  const pole = new InstancedMesh(new BoxGeometry(0.24, 7, 0.24).translate(0, 3.5, 0), poleMat, n);
  const arm = new InstancedMesh(new BoxGeometry(2.6, 0.18, 0.24), poleMat, n);
  const head = new InstancedMesh(new BoxGeometry(1, 0.2, 0.5), new MeshBasicMaterial({ color: 0xffe2a8 }), n);
  const pool = new InstancedMesh(
    new PlaneGeometry(9, 9).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ map: glow(), color: 0xffb86b, transparent: true, opacity: 0.32, blending: AdditiveBlending, depthWrite: false }),
    n,
  );
  const glowPos = new Float32Array(n * 3);
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const one = new Vector3(1, 1, 1);
  const p = new Vector3();
  spots.forEach((l, k) => {
    // Arms reach in over the road: turn local +x, (cos a, 0, -sin a), to point inward (-r).
    q.setFromAxisAngle(up, Math.atan2(l.rz, -l.rx));
    m.compose(p.set(l.x, l.y, l.z), q, one);
    pole.setMatrixAt(k, m);
    m.compose(p.set(l.x - l.rx * 1.2, l.y + 7, l.z - l.rz * 1.2), q, one);
    arm.setMatrixAt(k, m);
    m.compose(p.set(l.x - l.rx * 2.3, l.y + 6.88, l.z - l.rz * 2.3), q, one);
    head.setMatrixAt(k, m);
    m.compose(p.set(l.x - l.rx * 2.6, l.y + 0.05, l.z - l.rz * 2.6), q, one);
    pool.setMatrixAt(k, m);
    glowPos.set([l.x - l.rx * 2.3, l.y + 6.7, l.z - l.rz * 2.3], k * 3);
  });
  for (const mesh of [pole, arm, head, pool]) mesh.computeBoundingSphere();
  pool.renderOrder = 1;
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(glowPos, 3));
  const glows = new Points(geo, new PointsMaterial({ map: glow(), color: 0xffc27a, size: 3.4, transparent: true, blending: AdditiveBlending, depthWrite: false }));
  group.add(pole, arm, head, pool, glows);
  return group;
}
