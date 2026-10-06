// Grass tufts (the owner, 2026-10-05: "tufts of grass scattered occasionally"): a few blades in a
// clump, scattered over a coast's grass where it isn't road, sand or steep rock, so the hills read
// as grass up close and not as one smooth colour. Scenery only (the sim never sees them): where each
// stands is a hash of its spot, the same on every screen. Instanced, a mesh per chunk of ground.

import { Color, ConeGeometry, type BufferGeometry, type InstancedMesh } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash01 } from '../../../core/rng';
import { VERGE_DEFAULT, type Track } from '../../../core/track/bake';
import { KIND_VERGE } from '../../../core/track/ground';
import { instanced, type Part } from './forest';
import { toon } from './toon';

/** One tuft every `every` m at most, kept with this chance; none steeper than `steep` (rise over run) or within `clear` m of a road's edge. */
const TUFTS = { every: 4, keep: 0.22, steep: 0.7, clear: 1.5, chunk: 200 };

/** A clump of five blades, about 1 m tall (scaled 1–1.9), leaning out. */
function tuftModel(): BufferGeometry {
  const blades: BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const h = 0.7 + 0.3 * ((k * 7) % 5) / 4;
    const b = new ConeGeometry(0.16, h, 3, 1, true);
    b.translate(0, h / 2, 0);
    b.rotateZ(0.35);
    b.rotateY(a);
    b.translate(Math.cos(a) * 0.12, 0, -Math.sin(a) * 0.12);
    blades.push(b);
  }
  return mergeGeometries(blades)!;
}

export function buildTufts(track: Track, green: Color): InstancedMesh[] {
  const g = track.ground;
  if (!g) return [];
  const main = track.main;
  const sea = g.sea ?? -Infinity;
  const chunks = new Map<string, Part[]>();
  // A little darker, lighter and drier than the ground's grass, so a tuft shows against it.
  const shades = [green.clone().multiplyScalar(0.88), green.clone().lerp(new Color('#b7c75a'), 0.35), green.clone().lerp(new Color('#9aa64a'), 0.5)].map((c) => c.getHex());
  const span = g.cell * (g.nx - 1);
  const depth = g.cell * (g.nz - 1);
  let n = 0;
  for (let z = 0; z < depth; z += TUFTS.every)
    for (let x = 0; x < span; x += TUFTS.every, n++) {
      if (hash01(n, 61, 7) > TUFTS.keep) continue;
      const px = g.x0 + x + hash01(n, 62, 7) * TUFTS.every;
      const pz = g.z0 + z + hash01(n, 63, 7) * TUFTS.every;
      if (g.kindAt(px, pz) !== KIND_VERGE) continue;
      const y = g.height(px, pz);
      if (y < sea + 0.5) continue;
      const e = g.cell;
      if (Math.hypot(g.height(px + e, pz) - g.height(px - e, pz), g.height(px, pz + e) - g.height(px, pz - e)) / (2 * e) > TUFTS.steep) continue;
      // Off the main road's edge (its own kind says the rest: a branch's ground is its own), and off
      // a stretch's own verge (the town's pavements: snow.ts fades it into the grass ~60 m out).
      const i = g.nearAt(px, pz);
      const off = Math.abs(g.lateral[(Math.round((pz - g.z0) / g.cell)) * g.nx + Math.round((px - g.x0) / g.cell)] ?? 0) - main.width[i] / 2;
      if (off < main.shoulder[i] + TUFTS.clear || (main.verge[i] !== VERGE_DEFAULT && off < 60)) continue;
      const key = `${Math.floor(px / TUFTS.chunk)},${Math.floor(pz / TUFTS.chunk)}`;
      let list = chunks.get(key);
      if (!list) chunks.set(key, (list = []));
      const size = 1 + hash01(n, 64, 7) * 0.9;
      list.push({ x: px, y: y - 0.05, z: pz, yaw: hash01(n, 65, 7) * Math.PI * 2, sx: size, sy: size, sz: size, color: shades[Math.floor(hash01(n, 66, 7) * shades.length)] });
    }
  const geo = tuftModel();
  // No ink: the outline pass inks by depth, and a blade's all edge (black weeds). So they write no
  // depth, and are drawn after everything else opaque, tested against it.
  const mat = toon({ depthWrite: false });
  const out: InstancedMesh[] = [];
  for (const parts of chunks.values()) {
    const mesh = instanced(geo, mat, parts);
    mesh.renderOrder = 10;
    mesh.matrixAutoUpdate = false;
    out.push(mesh);
  }
  return out;
}
