import { beforeAll, describe, expect, test } from 'bun:test';
import { InstancedMesh, Matrix4, Vector3, type Object3D } from 'three';
import { bakeTrack } from '../src/core/track/bake';
import { PALETTES } from '../src/render/skins/greybox/palettes';
import { buildTerrain } from '../src/render/skins/greybox/terrain';
import { SURFACES, layout } from './helpers';

// Paradise's scenery (island.ts): built from the track, the same every race, and off the road.

// The scenery draws a few canvas textures (the signs, the house fronts): a stand-in canvas whose
// drawing calls do nothing is enough to build it without a DOM.
beforeAll(() => {
  const ctx = new Proxy({}, { get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}) });
  (globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
});

const track = bakeTrack(layout('paradise/island'), SURFACES);

async function build(seed: number) {
  const { buildIsland } = await import('../src/render/skins/greybox/island');
  return buildIsland(track, seed, buildTerrain(track, PALETTES.tropic, seed));
}

/** Every instance's position in the island's instanced meshes. */
function instances(objects: Object3D[]): Vector3[] {
  const m = new Matrix4();
  const out: Vector3[] = [];
  for (const o of objects) {
    if (!(o instanceof InstancedMesh)) continue;
    for (let k = 0; k < o.count; k++) {
      o.getMatrixAt(k, m);
      out.push(new Vector3().setFromMatrixPosition(m));
    }
  }
  return out;
}

describe('shortcut signs', () => {
  test('stand on the side each shortcut leaves on: where the main road opens for it', async () => {
    const { branchSide } = await import('../src/render/skins/greybox/scenery');
    for (const key of ['backroads/valley', 'paradise/island']) {
      const t = bakeTrack(layout(key), SURFACES);
      for (const sp of t.splines.slice(1)) {
        // The first open stretch of verge from the fork on.
        let open: number = 0;
        for (let d = 0; d < 80 && !open; d++) {
          const i = Math.round((sp.mainFrom + d) / t.main.step) % t.main.n;
          open = t.main.openL[i] ? -1 : t.main.openR[i] ? 1 : 0;
        }
        expect(open, `${key} ${sp.id}`).not.toBe(0);
        expect(branchSide(t.main, sp) as number, `${key} ${sp.id}`).toBe(open);
      }
    }
  });
});

describe('Paradise scenery', () => {
  test('nothing stands on a road: trees, houses and rocks keep off every road surface', async () => {
    const island = await build(1);
    const all = instances(island.objects);
    expect(all.length).toBeGreaterThan(3000);
    // The road's samples every 2 m, hashed on a 20 m grid: an instance is on a road if it's within
    // half the road's width of one, and near its height (over it, like the rope bridge, is fine).
    const cells = new Map<number, [number, number, number, number][]>();
    const key = (x: number, z: number) => Math.floor(x / 20) * 100003 + Math.floor(z / 20);
    for (const sp of track.splines) for (let i = 0; i < sp.n; i += 2) {
      const k = key(sp.px[i], sp.pz[i]);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k)!.push([sp.px[i], sp.py[i], sp.pz[i], sp.width[i] / 2]);
    }
    let onRoad = 0;
    for (const p of all) {
      let hit = false;
      for (let a = -1; a <= 1 && !hit; a++) for (let b = -1; b <= 1 && !hit; b++) {
        for (const [x, y, z, half] of cells.get(key(p.x + a * 20, p.z + b * 20)) ?? []) {
          if (Math.hypot(p.x - x, p.z - z) < half && p.y - y < 6 && p.y - y > -3) hit = true;
        }
      }
      if (hit) onRoad++;
    }
    expect(onRoad).toBe(0);
  });

  test('the same island every race with the same seed', async () => {
    const a = instances((await build(3)).objects);
    const b = instances((await build(3)).objects);
    expect(b.length).toBe(a.length);
    for (let k = 0; k < a.length; k += 97) expect(b[k].equals(a[k])).toBe(true);
  });
});
