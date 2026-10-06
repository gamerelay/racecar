// Grass tufts (the owner, 2026-10-05: "tufts of grass scattered occasionally"; then "less of them,
// a solid color like the grass with a few outlines, and less scattered"): low clumps the grass's own
// colour, inked like everything else, in patches here and there over a coast's grass where it isn't
// road, sand or steep rock. Scenery only (the sim never sees them): where each stands is a hash of
// its spot, the same on every screen. Instanced, a mesh per chunk of ground.

import { Color, ConeGeometry, type BufferGeometry, type InstancedMesh } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash01 } from '../../../core/rng';
import { VERGE_DEFAULT, type Track } from '../../../core/track/bake';
import { KIND_VERGE, noise } from '../../../core/track/ground';
import { instanced, type Part } from './forest';
import { toon } from './toon';

/**
 * One tuft every `every` m at most, in patches (where a broad noise, `patch` m across, is over
 * `patchy`), kept there with this chance; none steeper than `steep` (rise over run) or within `clear`
 * m of a road's edge.
 */
const TUFTS = { every: 3, patch: 40, patchy: 0.68, keep: 0.3, steep: 0.6, clear: 2, chunk: 200 };

/** A low clump: three stubby, faceted cones round one, about 0.6 m tall. */
function tuftModel(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const [x, z, r, h] of [
    [0, 0, 0.42, 0.7],
    [0.38, 0.12, 0.3, 0.5],
    [-0.3, 0.25, 0.28, 0.45],
    [0.05, -0.36, 0.3, 0.52],
  ]) {
    const c = new ConeGeometry(r, h, 5, 1, true);
    c.translate(x, h / 2, z);
    parts.push(c.toNonIndexed());
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

export function buildTufts(track: Track, green: Color): InstancedMesh[] {
  const g = track.ground;
  if (!g) return [];
  const main = track.main;
  const sea = g.sea ?? -Infinity;
  const chunks = new Map<string, Part[]>();
  // The ground's own grass (snow.ts's: the palette's, softened toward the forest), a shade either way.
  const grass = green.clone().lerp(new Color('#2a6b33'), 0.3);
  const shades = [grass.clone().multiplyScalar(0.94), grass.clone(), grass.clone().multiplyScalar(1.05)].map((c) => c.getHex());
  const span = g.cell * (g.nx - 1);
  const depth = g.cell * (g.nz - 1);
  let n = 0;
  for (let z = 0; z < depth; z += TUFTS.every)
    for (let x = 0; x < span; x += TUFTS.every, n++) {
      if (hash01(n, 61, 7) > TUFTS.keep) continue;
      const px = g.x0 + x + hash01(n, 62, 7) * TUFTS.every;
      const pz = g.z0 + z + hash01(n, 63, 7) * TUFTS.every;
      if (noise(px, pz, TUFTS.patch, 37) < TUFTS.patchy) continue;
      if (g.kindAt(px, pz) !== KIND_VERGE) continue;
      const y = g.height(px, pz);
      if (y < sea + 0.5) continue;
      const e = g.cell;
      const slope = Math.hypot(g.height(px + e, pz) - g.height(px - e, pz), g.height(px, pz + e) - g.height(px, pz - e)) / (2 * e);
      if (slope > TUFTS.steep) continue;
      // Off the main road's edge (its own kind says the rest: a branch's ground is its own), and off
      // a stretch's own verge (the town's pavements: snow.ts fades it into the grass ~60 m out).
      const i = g.nearAt(px, pz);
      const off = Math.abs(g.lateral[(Math.round((pz - g.z0) / g.cell)) * g.nx + Math.round((px - g.x0) / g.cell)] ?? 0) - main.width[i] / 2;
      if (off < main.shoulder[i] + TUFTS.clear || (main.verge[i] !== VERGE_DEFAULT && off < 60)) continue;
      const key = `${Math.floor(px / TUFTS.chunk)},${Math.floor(pz / TUFTS.chunk)}`;
      let list = chunks.get(key);
      if (!list) chunks.set(key, (list = []));
      const size = 0.8 + hash01(n, 64, 7) * 0.7;
      // Sunk as far as the ground falls across it (0.42 m out at full size): no rim standing clear downhill.
      list.push({ x: px, y: y - 0.05 - slope * 0.42 * size, z: pz, yaw: hash01(n, 65, 7) * Math.PI * 2, sx: size, sy: size, sz: size, color: shades[Math.floor(hash01(n, 66, 7) * shades.length)] });
    }
  const geo = tuftModel();
  const mat = toon({});
  const out: InstancedMesh[] = [];
  for (const parts of chunks.values()) {
    const mesh = instanced(geo, mat, parts);
    mesh.matrixAutoUpdate = false;
    out.push(mesh);
  }
  return out;
}
