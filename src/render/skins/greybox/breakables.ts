// Greybox breakable walls (core/world/breakables.ts): each panel a few parts merged with their own
// colours, by its wall's look. A broken one is hidden (the burst is the renderer's, from the
// WallBreak event), and one that stands again pops back up.

import { BoxGeometry, type BufferGeometry, Color, Float32BufferAttribute, Mesh, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash01 } from '../../../core/rng';
import type { SimState } from '../../../core/state';
import { PANEL_THICK } from '../../../core/world/breakables';
import { toon } from './toon';

/** A box `w` × `h` × `d` at (x, y, z), turned `rz` about its depth, painted one colour. */
function box(w: number, h: number, d: number, color: string, x: number, y: number, z: number, rz = 0): BufferGeometry {
  const g = new BoxGeometry(w, h, d).toNonIndexed();
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  const c = new Color(color);
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new Float32BufferAttribute(Array.from({ length: n * 3 }, (_, k) => [c.r, c.g, c.b][k % 3]), 3));
  g.deleteAttribute('uv');
  return g;
}

const WOOD = ['#c08a52', '#d49a5e', '#a8743f', '#caa070'];

/**
 * The looks (BreakableDef.look), a panel `w` wide and `h` tall at its foot, along x, facing z.
 * `seed` varies one panel from the next.
 */
const LOOKS: Record<string, (w: number, h: number, seed: number) => BufferGeometry> = {
  // A barricade of planks nailed across two posts, a little crooked, the top one painted a warning.
  boards: (w, h, seed) => {
    const parts = [box(0.18, h + 0.25, 0.18, '#5a3a22', -w / 2 + 0.12, (h + 0.25) / 2, -0.08), box(0.18, h + 0.25, 0.18, '#5a3a22', w / 2 - 0.12, (h + 0.25) / 2, -0.08)];
    const n = Math.max(2, Math.floor(h / 0.42));
    for (let k = 0; k < n; k++) {
      const top = k === n - 1;
      const tilt = (hash01(seed, k, 3) - 0.5) * 0.12;
      const color = top ? (seed % 2 ? '#e8e2d0' : '#d7263d') : WOOD[Math.floor(hash01(seed, k, 5) * WOOD.length)];
      parts.push(box(w + 0.2, 0.38, PANEL_THICK * 0.4, color, (hash01(seed, k, 7) - 0.5) * 0.2, 0.3 + ((h - 0.5) * k) / (n - 1), 0.06, tilt));
    }
    // A brace across, corner to corner.
    parts.push(box(Math.hypot(w, h * 0.8), 0.22, 0.06, WOOD[seed % WOOD.length], 0, h / 2, 0.12, Math.atan2(h * 0.8, w) * (seed % 2 ? 1 : -1)));
    const g = mergeGeometries(parts)!;
    g.computeVertexNormals();
    return g;
  },
};

/** A panel standing again grows back over this long (s). */
const POP = 0.35;

export function buildBreakablesVisual(sim: SimState): { objects: Object3D[]; update(time: number): void } {
  const br = sim.world!.breakables;
  const looks = sim.track.layout.breakables ?? [];
  const material = toon({ vertexColors: true });
  const meshes: Mesh[] = [];
  const shown = new Float32Array(br.n).fill(-1);
  for (let k = 0; k < br.n; k++) {
    const look = LOOKS[looks[br.wall[k]]?.look] ?? LOOKS.boards;
    const mesh = new Mesh(look(br.half[k] * 2, br.height[k], k), material);
    mesh.position.set(br.x[k], br.y[k], br.z[k]);
    // Its x along the wall: forward (sin h, cos h).
    mesh.rotation.y = br.h[k] - Math.PI / 2;
    meshes.push(mesh);
  }
  return {
    objects: meshes,
    update(time) {
      for (let k = 0; k < br.n; k++) {
        // (Never broken, it stands; down for the race, never broken is -Infinity + Infinity: ask first.)
        const since = br.standing(k, time) ? time - br.brokenAt[k] - br.down[k] : -1;
        const s = since < 0 ? 0 : since === Infinity || since !== since ? 1 : Math.min(1, since / POP);
        if (s === shown[k]) continue;
        shown[k] = s;
        meshes[k].visible = s > 0;
        meshes[k].scale.setScalar(Math.max(s, 1e-4));
      }
    },
  };
}
