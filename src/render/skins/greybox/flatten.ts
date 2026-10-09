// Flattening a built model's plain parts into a few meshes (the owner, 2026-10-09: "do the draw call
// pass on heist"): each Mesh is a draw call, and a landmark built of hundreds of boxes (the Golden
// Gate's suspenders, the Bay Bridge's cable segments) was hundreds of draws a frame wherever it was
// in view. Its plain toon parts (no texture, not see-through, not lit from within) become one mesh
// per kind of material, each part's colour carried in the vertices. What it can't merge it leaves
// as it was: anything with render state of its own, and whatever its update moves (`userData.moves`
// on it or a parent: landmarks.ts's `moves`).

import { type BufferGeometry, Float32BufferAttribute, Matrix4, Mesh, MeshToonMaterial, type Object3D, type Side } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon } from './toon';

/** The shared toon ramp, and a default toon material to compare render state against. */
let base: MeshToonMaterial | undefined;
/** Textures a toon material may carry: a part with any of them isn't plain. */
const MAPS = ['map', 'gradientMap', 'lightMap', 'aoMap', 'emissiveMap', 'bumpMap', 'normalMap', 'displacementMap', 'alphaMap'] as const;
/** Render state that must be the default's for a part to merge into a default toon mesh. */
const STATE = ['transparent', 'opacity', 'alphaTest', 'depthTest', 'depthWrite', 'colorWrite', 'blending', 'polygonOffset', 'toneMapped', 'wireframe', 'visible', 'premultipliedAlpha', 'stencilWrite'] as const;

/**
 * Whether a mesh is a plain toon part: one toon material in its default render state (no texture
 * but the shared ramp, opaque, no depth or polygon tricks, not emissive, not reshaded: no
 * onBeforeCompile of its own), not inked, shown, and nothing its update moves.
 */
function plain(m: Mesh, root: Object3D): m is Mesh & { material: MeshToonMaterial } {
  const mat = m.material;
  if (Array.isArray(mat) || !(mat instanceof MeshToonMaterial)) return false;
  if ((m as { isInstancedMesh?: boolean }).isInstancedMesh || m.userData.ink !== undefined) return false;
  base ??= toon();
  for (const k of MAPS) if (mat[k] !== base[k]) return false;
  for (const k of STATE) if (mat[k] !== base[k]) return false;
  if (mat.emissive.getHex() !== 0 || Object.hasOwn(mat, 'onBeforeCompile')) return false;
  // (Shown, and neither it nor what it's on moved by an update.)
  for (let p: Object3D | null = m; p && p !== root; p = p.parent) if (!p.visible || p.userData.moves) return false;
  return !root.userData.moves;
}

/**
 * Merges `root`'s plain toon meshes (in its own frame) into one per kind of material (its side and
 * fog), their colours in the vertices, and takes them out. A part an update moves must be marked
 * (`userData.moves`, on it or a parent). Returns how many meshes it took out.
 */
export function flatten(root: Object3D): number {
  root.updateMatrixWorld(true);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, { geos: BufferGeometry[]; side: Side; fog: boolean }>();
  const taken: Mesh[] = [];
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || !plain(m, root)) return;
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
    const rel = new Matrix4().multiplyMatrices(toRoot, m.matrixWorld);
    g = g.applyMatrix4(rel);
    // (A part mirrored in the model's frame turns its faces inside out: flip it back. The root's own mirroring the renderer handles.)
    if (rel.determinant() < 0) {
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
  for (const m of taken) m.removeFromParent();
  for (const { geos, side, fog } of groups.values()) {
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    root.add(new Mesh(merged, toon({ vertexColors: true, side, fog })));
  }
  return taken.length;
}
