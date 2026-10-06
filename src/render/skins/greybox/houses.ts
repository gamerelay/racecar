// Houses on open ground (TrackLayout.houses; docs/COASTAL.md, the Riviera town): stucco blocks in
// the Riviera's colours (ochre, salmon, rose, cream, yellow), tall shuttered windows a storey apart,
// shopfronts on the ground floor, under low terracotta roofs. Each stands where the sim's solid
// block does (core bake: on the lowest ground under its corners). One draw for the walls, one for
// the roofs.

import { BoxGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Group, Mesh, type Object3D, SphereGeometry } from 'three';
import { hash01 } from '../../../core/rng';
import type { Track } from '../../../core/track/bake';
import { instanced, prism, type Part } from './forest';
import { canvas } from './scenery';
import { faceted, toon } from './toon';

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
  const out: Object3D[] = [];
  defs.forEach((h, k) => {
    const y = solid[k]?.y ?? track.ground!.height(h.at[0], h.at[1]);
    if (h.look === 'casino') {
      out.push(casino(h, y));
      return;
    }
    const [w, d, high] = h.size;
    const color = STUCCO[Math.floor(hash01(k, 3, 11) * STUCCO.length)];
    walls.push({ x: h.at[0], y: y + high / 2, z: h.at[1], yaw: h.rot, sx: w, sy: high, sz: d, color });
    // Low, a little proud of the walls; now and then the other way (its ridge front to back).
    const across = hash01(k, 5, 11) < 0.7;
    roofs.push({ x: h.at[0], y: y + high, z: h.at[1], yaw: h.rot + (across ? Math.PI / 2 : 0), sx: (across ? d : w) + 0.8, sy: Math.min(w, d) * 0.18, sz: (across ? w : d) + 0.8, color: TILES[Math.floor(hash01(k, 7, 11) * TILES.length)] });
  });
  if (walls.length) out.push(instanced(new BoxGeometry(1, 1, 1), toon({ map: facade() }), walls), instanced(prism(), toon({ side: DoubleSide }), roofs));
  return out;
}

const CREAM = 0xf1e2c2;
const TRIM = 0xd8c39a;
const COPPER = 0x5fa38a;
const GOLD = 0xe8c050;
/** A casino facade's texture: tall arched windows over a rusticated ground floor. */
let casinoTex: ReturnType<typeof canvas> | undefined;
function casinoFacade() {
  return (casinoTex ??= canvas(128, 128, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(0,0,0,0.08)';
    for (let y = 92; y < 128; y += 9) g.fillRect(0, y, 128, 2);
    g.fillStyle = '#2b3550';
    for (const x of [14, 50, 86]) {
      g.fillRect(x, 26, 26, 50);
      g.beginPath();
      g.arc(x + 13, 26, 13, Math.PI, 0);
      g.fill();
    }
    g.fillStyle = 'rgba(0,0,0,0.14)';
    g.fillRect(0, 82, 128, 5);
    g.fillRect(0, 4, 128, 4);
  }));
}

/**
 * The grand casino (the owner, 2026-10-05: Monte Carlo's, on the boulevard): its solid block is the
 * house `h` (look 'casino'); drawn as a cream Beaux-Arts hall with arched windows, a copper dome on a
 * drum over its middle, a tower at each front corner under a copper spire, a columned portico and a
 * gilded clock, its front toward the road.
 */
function casino(h: { at: [number, number]; size: [number, number, number]; rot: number }, y: number): Object3D {
  const [w, d, high] = h.size;
  const root = new Group();
  const mat = toon({ color: CREAM, map: casinoFacade() });
  const solidBox = (sx: number, sy: number, sz: number, x: number, yy: number, z: number, m = mat) => {
    const b = new Mesh(new BoxGeometry(sx, sy, sz), m);
    b.position.set(x, yy, z);
    root.add(b);
    return b;
  };
  const plain = (color: number) => toon({ color });
  // The hall, a cornice round its top, a balustrade.
  solidBox(w, high, d, 0, high / 2, 0);
  solidBox(w + 0.8, 0.8, d + 0.8, 0, high + 0.4, 0, plain(TRIM));
  // The dome: a drum, the dome, a lantern.
  const drum = new Mesh(faceted(new CylinderGeometry(d * 0.24, d * 0.24, 3.5, 16)), plain(CREAM));
  drum.position.set(0, high + 2.5, 0);
  root.add(drum);
  const dome = new Mesh(faceted(new SphereGeometry(d * 0.25, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), plain(COPPER));
  dome.position.set(0, high + 4.2, 0);
  root.add(dome);
  const lantern = new Mesh(faceted(new CylinderGeometry(0.9, 0.9, 2.4, 8)), plain(GOLD));
  lantern.position.set(0, high + 4.2 + d * 0.25 + 1, 0);
  root.add(lantern);
  // The towers at the front corners, each under a copper spire.
  for (const sx of [-1, 1]) {
    const tw = 6;
    solidBox(tw, high + 7, tw, sx * (w / 2 - tw / 2), (high + 7) / 2, d / 2 - tw / 2);
    const spire = new Mesh(faceted(new ConeGeometry(tw * 0.62, 7, 4)), plain(COPPER));
    spire.position.set(sx * (w / 2 - tw / 2), high + 7 + 3.5, d / 2 - tw / 2);
    spire.rotation.y = Math.PI / 4;
    root.add(spire);
  }
  // The portico: a pediment on six columns, the clock in it.
  const pw = w * 0.4;
  for (let k = 0; k < 6; k++) {
    const col = new Mesh(faceted(new CylinderGeometry(0.55, 0.65, high * 0.62, 10)), plain(CREAM));
    col.position.set(-pw / 2 + (k * pw) / 5, high * 0.31, d / 2 + 2.6);
    root.add(col);
  }
  solidBox(pw + 2, 1.4, 4.4, 0, high * 0.62 + 0.7, d / 2 + 2.4, plain(TRIM));
  const ped = new Mesh(faceted(new ConeGeometry(pw * 0.62, 3.2, 3)), plain(CREAM));
  ped.scale.z = 0.3;
  ped.rotation.y = Math.PI;
  ped.position.set(0, high * 0.62 + 3, d / 2 + 2.4);
  root.add(ped);
  const clock = new Mesh(faceted(new CylinderGeometry(1, 1, 0.3, 16)), plain(GOLD));
  clock.rotation.x = Math.PI / 2;
  clock.position.set(0, high * 0.62 + 2.6, d / 2 + 3.4);
  root.add(clock);
  root.position.set(h.at[0], y, h.at[1]);
  root.rotation.y = h.rot;
  return root;
}
