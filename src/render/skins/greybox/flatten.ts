// Flattening a built model's plain parts into a few meshes (the owner, 2026-10-09: "do the draw call
// pass on heist"): each Mesh is a draw call, and a landmark built of hundreds of boxes (the Golden
// Gate's suspenders, the Bay Bridge's cable segments) was hundreds of draws a frame wherever it was
// in view. Its plain toon parts (no texture, not see-through, not lit from within) become one mesh
// per kind of material, each part's colour carried in the vertices. What it can't merge it leaves
// as it was.

import { type BufferGeometry, Float32BufferAttribute, Matrix4, Mesh, MeshToonMaterial, type Object3D, type Side } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SEAM, unmarkInk } from '../../ink';
import { toon } from './toon';

/** Whether a mesh is a plain toon part: one toon material, no map, opaque, not emissive, not reshaded (no onBeforeCompile of its own); inked only if `ink`. */
function plain(m: Mesh, ink: boolean): m is Mesh & { material: MeshToonMaterial } {
  const mat = m.material;
  if (Array.isArray(mat) || !(mat instanceof MeshToonMaterial)) return false;
  if ((m as { isInstancedMesh?: boolean }).isInstancedMesh || !m.visible || (m.userData.ink !== undefined && !ink) || m.userData.ink === SEAM) return false;
  return !mat.map && !mat.transparent && mat.emissive.getHex() === 0 && !Object.hasOwn(mat, 'onBeforeCompile') && mat.alphaTest === 0;
}

/**
 * Merges `root`'s plain toon meshes (in its own frame) into one per kind of material (its side and
 * fog), their colours in the vertices, and takes them out. Only for a model nothing
 * moves a part of afterwards. With `ink`, its inked parts too (out of the ink pass: a parked car
 * seen from afar keeps its silhouette's ink, not its panel lines). Returns how many meshes it took out.
 */
export function flatten(root: Object3D, ink = false): number {
  root.updateMatrixWorld(true);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, { geos: BufferGeometry[]; side: Side; fog: boolean }>();
  const taken: Mesh[] = [];
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || !plain(m, ink)) return;
    // Hidden by a parent: left alone.
    for (let p = m.parent; p && p !== root; p = p.parent) if (!p.visible) return;
    const src = m.geometry;
    let g = src.index ? src.toNonIndexed() : src.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const n = g.getAttribute('position').count;
    const c = m.material.color;
    const own = m.material.vertexColors ? g.getAttribute('color') : undefined;
    const colors = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      colors[k * 3] = c.r * (own ? own.getX(k) : 1);
      colors[k * 3 + 1] = c.g * (own ? own.getY(k) : 1);
      colors[k * 3 + 2] = c.b * (own ? own.getZ(k) : 1);
    }
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    g = g.applyMatrix4(new Matrix4().multiplyMatrices(toRoot, m.matrixWorld));
    // (A mirrored part turns its faces inside out: flip it back.)
    if (m.matrixWorld.determinant() < 0) {
      const p = g.getAttribute('position');
      const nm = g.getAttribute('normal');
      for (let k = 0; k < n; k += 3) for (const a of [p, nm, g.getAttribute('color')]) {
        const [x, y, z] = [a.getX(k + 1), a.getY(k + 1), a.getZ(k + 1)];
        a.setXYZ(k + 1, a.getX(k + 2), a.getY(k + 2), a.getZ(k + 2));
        a.setXYZ(k + 2, x, y, z);
      }
    }
    const mat = m.material as MeshToonMaterial;
    const key = `${mat.side}|${mat.fog}`;
    const group = groups.get(key) ?? { geos: [], side: mat.side, fog: mat.fog };
    group.geos.push(g);
    groups.set(key, group);
    taken.push(m);
  });
  if (taken.length < 2) return 0;
  for (const m of taken) {
    m.removeFromParent();
    unmarkInk(m);
  }
  for (const { geos, side, fog } of groups.values()) {
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    root.add(new Mesh(merged, toon({ vertexColors: true, side, fog })));
  }
  return taken.length;
}
