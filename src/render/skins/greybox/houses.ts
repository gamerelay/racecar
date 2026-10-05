// Houses on open ground (TrackLayout.houses; docs/COASTAL.md, the Riviera town): stucco blocks in
// the Riviera's colours (ochre, salmon, rose, cream, yellow), tall shuttered windows a storey apart,
// shopfronts on the ground floor, under low terracotta roofs. Each stands where the sim's solid
// block does (core bake: on the lowest ground under its corners). One draw for the walls, one for
// the roofs.

import { BoxGeometry, DoubleSide, type Object3D } from 'three';
import { hash01 } from '../../../core/rng';
import type { Track } from '../../../core/track/bake';
import { instanced, prism, type Part } from './forest';
import { canvas } from './scenery';
import { toon } from './toon';

const STUCCO = [0xe8a650, 0xe98d6b, 0xe7a3a0, 0xf3e3c0, 0xf2c860, 0xf0b88a, 0xd9774a, 0xf5d7a6];
const TILES = [0xb9532c, 0xc4633b, 0xa84a2a, 0xcf7a4c];
/** A facade's texture: white stucco (the instance's colour tints it), a row of tall shuttered windows per storey, a shopfront below. */
function facade() {
  const tex = canvas(128, 128, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 128, 128);
    // The ground floor: shopfronts, an awning stripe.
    g.fillStyle = '#3a3340';
    for (const x of [10, 70]) g.fillRect(x, 100, 48, 28);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(0, 94, 128, 6);
    // Three storeys of windows over it, each with shutters either side.
    for (let row = 0; row < 3; row++) {
      const y = 8 + row * 30;
      for (const x of [18, 78]) {
        g.fillStyle = '#2b3550';
        g.fillRect(x, y, 14, 22);
        g.fillStyle = row % 2 ? '#3d7a5a' : '#4a8f6a';
        g.fillRect(x - 8, y, 7, 22);
        g.fillRect(x + 15, y, 7, 22);
        g.fillStyle = 'rgba(0,0,0,0.15)';
        g.fillRect(x - 9, y + 22, 32, 3);
      }
    }
  });
  return tex;
}

export function buildHouses(track: Track): Object3D[] {
  const defs = track.layout.houses ?? [];
  if (!defs.length || !track.ground) return [];
  const walls: Part[] = [];
  const roofs: Part[] = [];
  // Where the sim stood each (its props, in order after the rest: kind 'house').
  const solid = track.props.filter((p) => p.kind === 'house');
  defs.forEach((h, k) => {
    const y = solid[k]?.y ?? track.ground!.height(h.at[0], h.at[1]);
    const [w, d, high] = h.size;
    const color = STUCCO[Math.floor(hash01(k, 3, 11) * STUCCO.length)];
    walls.push({ x: h.at[0], y: y + high / 2, z: h.at[1], yaw: h.rot, sx: w, sy: high, sz: d, color });
    // Low, a little proud of the walls; now and then the other way (its ridge front to back).
    const across = hash01(k, 5, 11) < 0.7;
    roofs.push({ x: h.at[0], y: y + high, z: h.at[1], yaw: h.rot + (across ? Math.PI / 2 : 0), sx: (across ? d : w) + 0.8, sy: Math.min(w, d) * 0.18, sz: (across ? w : d) + 0.8, color: TILES[Math.floor(hash01(k, 7, 11) * TILES.length)] });
  });
  return [instanced(new BoxGeometry(1, 1, 1), toon({ map: facade() }), walls), instanced(prism(), toon({ side: DoubleSide }), roofs)];
}
