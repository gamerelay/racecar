// An island on open ground (docs/PARADISE.md): the sea round it (terrain.ts's, over the ground's
// own grid: turquoise over the sand, foam on the beach), the volcano's crater with its lava lake and
// plume (island.ts's), and the trees the sim collides with (core/track/pines.ts, `tropic`): palms
// along the coast, leaning out to sea, and jungle trees inland, each drawn where its collider
// stands. The rest of the island's dressing stands on open ground only once it's solid too.

import { Color, CylinderGeometry, IcosahedronGeometry, type Object3D } from 'three';
import { Rng } from '../../../core/rng';
import type { Track } from '../../../core/track/bake';
import { TREE_JUNGLE, TREE_PALM } from '../../../core/track/pines';
import { instanced, type Part } from './forest';
import { crater, JUNGLE, PALM_LEAVES, palmGeometry, swaying } from './island';
import type { Palette } from './palettes';
import { sea } from './terrain';
import { faceted, toon } from './toon';

export interface OpenIsland {
  objects: Object3D[];
  update(time: number): void;
}

/** The palm model's height (island.ts's palmGeometry): scaled to each tree's. */
const PALM_H = 8.5;

export function buildOpenIsland(track: Track, palette: Palette, seed: number): OpenIsland {
  const g = track.ground!;
  const def = track.layout.ground!;
  const rng = Rng.stream(seed, 'open-island');
  const pick = <T>(list: readonly T[]) => list[Math.floor(rng.next() * list.length)];
  const time = { value: 0 };
  const objects: Object3D[] = [];
  const seaY = g.sea ?? 0;
  if (g.sea !== undefined) objects.push(sea(seaY, g.x0, g.z0, g.nx, g.nz, g.h, time, palette.seaLight ?? 0xffffff, g.cell));
  if (def.volcano) objects.push(...crater(def.volcano, seaY + def.volcano.lava, time, rng));

  const p = track.pines;
  if (p && p.n) {
    const palms: Part[] = [];
    const trunks: Part[] = [];
    const crowns: Part[] = [];
    for (let k = 0; k < p.n; k++) {
      const x = p.x[k];
      const z = p.z[k];
      if (p.kind[k] === TREE_PALM) {
        // Leaning out to sea: down the coast's distance.
        const gx = g.coast(x + 2, z) - g.coast(x - 2, z);
        const gz = g.coast(x, z + 2) - g.coast(x, z - 2);
        const yaw = Math.atan2(gz, -gx) + rng.range(-0.4, 0.4);
        const s = p.h[k] / PALM_H;
        palms.push({ x, y: p.y[k] - 0.2, z, yaw, sx: s, sy: s, sz: s, color: pick(PALM_LEAVES) });
      } else if (p.kind[k] === TREE_JUNGLE) {
        const tall = p.h[k] * 0.62;
        const sc = p.h[k] / 9;
        trunks.push({ x, y: p.y[k] - 0.3, z, yaw: 0, sx: sc * 1.4, sy: tall, sz: sc * 1.4, color: 0x6b4a32 });
        crowns.push({ x, y: p.y[k] + tall - 0.5, z, yaw: rng.range(0, 6), sx: sc * rng.range(2.6, 3.4), sy: sc * rng.range(1.8, 2.4), sz: sc * rng.range(2.6, 3.4), color: pick(JUNGLE) });
      }
    }
    const palmGeo = palmGeometry();
    const trunkMat = swaying(time, 0.006);
    trunkMat.color = new Color(0x8a6a44);
    // The trunks keep their own brown (the instance colors are the fronds').
    if (palms.length) objects.push(instanced(palmGeo.trunk, trunkMat, palms.map((q) => ({ ...q, color: 0xffffff }))), instanced(palmGeo.fronds, swaying(time, 0.006), palms));
    if (trunks.length) {
      objects.push(instanced(new CylinderGeometry(0.22, 0.3, 1, 6).translate(0, 0.5, 0), toon(), trunks));
      objects.push(instanced(faceted(new IcosahedronGeometry(1, 0)), swaying(time, 0.01, 3), crowns));
    }
  }
  return {
    objects,
    update(t) {
      time.value = t;
    },
  };
}
