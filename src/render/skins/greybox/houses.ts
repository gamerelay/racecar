// Houses on open ground (TrackLayout.houses; docs/COASTAL.md, the Riviera town): stucco blocks in
// the Riviera's colours (ochre, salmon, rose, cream, yellow), tall shuttered windows a storey apart,
// shopfronts on the ground floor, under low terracotta roofs. Each stands where the sim's solid
// block does (core bake: on the lowest ground under its corners). One draw for the walls, one for
// the roofs.

import { BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, type Object3D, RepeatWrapping, SphereGeometry } from 'three';
import type { HouseDef } from '../../../core/content';
import { hash01 } from '../../../core/rng';
import { COLUMN as COLUMN_R, porchColumns, type BakedProp, type Track } from '../../../core/track/bake';
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
  const hawaii = harborTown();
  defs.forEach((h, k) => {
    const y = solid[k]?.y ?? track.ground!.height(h.at[0], h.at[1]);
    if (h.look === 'casino') {
      out.push(casino(h, y));
      return;
    }
    if (h.look === 'club') {
      out.push(club(h, y));
      return;
    }
    if (h.look === 'hotel') {
      out.push(...hotel(h, y, track.props.filter((p) => p.kind === 'house-column')));
      return;
    }
    // (A landmark's solid block: the landmark's drawn instead.)
    if (h.look === 'landmark') return;
    if (h.look === 'banyan') {
      out.push(banyan(h, y));
      return;
    }
    if (h.look === 'plantation' || h.look === 'shop' || h.look === 'parked') {
      hawaii.add(h, k, y);
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
  out.push(...hawaii.build());
  return out;
}

// ---- Harbor Town (Paradise Open; the owner: Hawaii, Lahaina's Front Street) ----

/** Board walls in faded plantation colours: teal, mustard, coral, sea green, cream, sky. */
const BOARDS = [0x6fb8a8, 0xe0b35a, 0xe68a6e, 0x8cc49a, 0xf2e6c8, 0x8fc2d8, 0xd9a0b8, 0xf0d27a];
/** Corrugated tin roofs: red, green, rust, grey-blue. */
const TIN = [0xb5463a, 0x4f8a5c, 0x9a5b38, 0x6d7f8e, 0xc25a3c];
/** White trim (fascia, posts, rails). */
const WHITE = 0xf4f1e6;
/** Parked cars' paint. */
const PAINT = [0xe8483b, 0x2f7fd8, 0xf2f2f0, 0x2b2b30, 0xf2c23a, 0x46b07a, 0xb8bfc8, 0xe07ab0];

/** A board wall's texture: clapboard lines, a door between two shuttered windows, white trim (the instance's colour tints it). */
function boardFacade(shop: boolean) {
  return canvas(128, 128, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(0,0,0,0.10)';
    for (let y = 4; y < 128; y += 8) g.fillRect(0, y, 128, 2);
    if (shop) {
      // Shopfront glass below, the boardwalk's shade over it; a sign band above.
      g.fillStyle = '#2d3a4a';
      g.fillRect(8, 74, 50, 46);
      g.fillRect(70, 74, 50, 46);
      g.fillStyle = '#f4f1e6';
      g.fillRect(6, 70, 116, 4);
      g.fillRect(31, 74, 3, 46);
      g.fillRect(94, 74, 3, 46);
      g.fillStyle = '#2d3a4a';
      for (const x of [22, 84]) g.fillRect(x, 20, 22, 30);
      g.fillStyle = '#f4f1e6';
      for (const x of [22, 84]) g.strokeRect(x, 20, 22, 30);
    } else {
      g.fillStyle = '#5a3f2e';
      g.fillRect(54, 64, 20, 64);
      g.fillStyle = '#2d3a4a';
      for (const x of [14, 90]) g.fillRect(x, 58, 24, 30);
      g.fillStyle = '#f4f1e6';
      for (const x of [14, 90]) {
        g.fillRect(x - 3, 56, 30, 3);
        g.fillRect(x - 3, 88, 30, 3);
        g.fillRect(x + 11, 58, 2, 30);
      }
    }
  });
}

/** A hip roof, a unit box's worth: its eaves round the bottom, its ridge along x halfway in. */
function hip() {
  const g = new BufferGeometry();
  const [a, b, c, d, r0, r1] = [
    [-0.5, 0, -0.5],
    [0.5, 0, -0.5],
    [0.5, 0, 0.5],
    [-0.5, 0, 0.5],
    [-0.25, 1, 0],
    [0.25, 1, 0],
  ];
  const tris = [d, c, r1, d, r1, r0, b, a, r0, b, r0, r1, a, d, r0, c, b, r1];
  g.setAttribute('position', new Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Harbor Town's houses, instanced: plantation cottages (board walls, a tin hip roof, a lanai roof
 * over the front on posts), Front Street's shops (a false front over the eaves, a veranda over the
 * boardwalk), and parked cars (a body and a cabin).
 */
function harborTown() {
  const homes: Part[] = [];
  const shops: Part[] = [];
  const roofs: Part[] = [];
  const trim: Part[] = [];
  const bodies: Part[] = [];
  const glass: Part[] = [];
  /** A part at (lx, ly, lz) in the house's own frame (its front toward +z). */
  const at = (h: HouseDef, y: number, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color: number): Part => {
    const [c, s] = [Math.cos(h.rot), Math.sin(h.rot)];
    return { x: h.at[0] + lx * c + lz * s, y: y + ly, z: h.at[1] - lx * s + lz * c, yaw: h.rot, sx, sy, sz, color };
  };
  return {
    add(h: HouseDef, k: number, y: number) {
      const [w, d, high] = h.size;
      const pick = <T>(list: T[], salt: number) => list[Math.floor(hash01(k, salt, 23) * list.length)];
      if (h.look === 'parked') {
        const paint = pick(PAINT, 3);
        bodies.push(at(h, y, 0, 0.45, 0, w, 0.7, d, paint));
        bodies.push(at(h, y, 0, 1.05, -0.2, w * 0.86, 0.55, d * 0.5, paint));
        glass.push(at(h, y, 0, 1.06, -0.2, w * 0.88, 0.42, d * 0.46, 0x26303c));
        return;
      }
      const wall = pick(BOARDS, 5);
      const tin = pick(TIN, 7);
      if (h.look === 'shop') {
        shops.push(at(h, y, 0, high / 2, 0, w, high, d, wall));
        // The false front: up past the eaves, flat-topped, a white cap.
        const front = high + 1.6;
        shops.push(at(h, y, 0, front / 2, d / 2 + 0.1, w + 0.2, front, 0.3, wall));
        trim.push(at(h, y, 0, front + 0.1, d / 2 + 0.1, w + 0.5, 0.25, 0.5, WHITE));
        roofs.push({ ...at(h, y, 0, high, -0.2, w + 0.4, 1.2, d + 0.2, tin) });
        // The veranda over the boardwalk, on posts at its front edge.
        trim.push(at(h, y, 0, 3.3, d / 2 + 1.4, w + 0.2, 0.18, 2.6, tin));
        for (const px of [-w / 2 + 0.3, 0, w / 2 - 0.3]) trim.push(at(h, y, px, 1.65, d / 2 + 2.55, 0.18, 3.3, 0.18, WHITE));
        return;
      }
      homes.push(at(h, y, 0, high / 2, 0, w, high, d, wall));
      // A hip roof, its ridge across the front, and a lanai's roof over the front on posts.
      roofs.push(at(h, y, 0, high, 0, w + 1, Math.min(w, d) * 0.32, d + 1, tin));
      trim.push(at(h, y, 0, high - 0.5, d / 2 + 1.1, w * 0.8, 0.15, 2.2, tin));
      for (const px of [-w * 0.38, w * 0.38]) trim.push(at(h, y, px, (high - 0.5) / 2, d / 2 + 2.05, 0.16, high - 0.5, 0.16, WHITE));
      trim.push(at(h, y, 0, 0.5, d / 2 + 2.05, w * 0.76, 0.1, 0.1, WHITE));
    },
    build(): Object3D[] {
      const out: Object3D[] = [];
      if (homes.length) out.push(instanced(new BoxGeometry(1, 1, 1), toon({ map: boardFacade(false) }), homes));
      if (shops.length) out.push(instanced(new BoxGeometry(1, 1, 1), toon({ map: boardFacade(true) }), shops));
      if (roofs.length) out.push(instanced(hip(), toon({ side: DoubleSide }), roofs));
      if (trim.length) out.push(instanced(new BoxGeometry(1, 1, 1), toon(), trim));
      if (bodies.length) out.push(instanced(new BoxGeometry(1, 1, 1), toon(), bodies), instanced(new BoxGeometry(1, 1, 1), toon(), glass));
      return out;
    },
  };
}

/**
 * The banyan in the square (Lahaina's, by the harbour): its solid block the trunk; drawn as a knot
 * of trunks and the aerial roots round it, under a crown far wider than it, low and spreading.
 */
function banyan(h: HouseDef, y: number): Object3D {
  const root = new Group();
  root.position.set(h.at[0], y, h.at[1]);
  const BARK = 0x7a6a58;
  const LEAF = [0x2f6b34, 0x3d7d3c, 0x2a5e30, 0x4a8a44];
  const [w, , high] = h.size;
  const trunk = new Mesh(faceted(new CylinderGeometry(w * 0.45, w * 0.7, high * 0.7, 9)), toon({ color: BARK }));
  trunk.position.y = high * 0.35;
  root.add(trunk);
  // Roots dropped from its limbs, a ring of them out under the crown.
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2 + hash01(k, 1, 31);
    const r = 5 + hash01(k, 2, 31) * 9;
    const tall = high * (0.55 + hash01(k, 3, 31) * 0.2);
    const rootM = new Mesh(faceted(new CylinderGeometry(0.22, 0.4, tall, 6)), toon({ color: BARK }));
    rootM.position.set(Math.cos(a) * r, tall / 2, Math.sin(a) * r);
    root.add(rootM);
  }
  // Limbs out to them, and the crown: wide flattened lumps.
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const limb = new Mesh(faceted(new CylinderGeometry(0.4, 0.7, 11, 6)), toon({ color: BARK }));
    limb.position.set(Math.cos(a) * 4.5, high * 0.68, Math.sin(a) * 4.5);
    limb.rotation.set(Math.sin(a) * 1.25, 0, -Math.cos(a) * 1.25);
    root.add(limb);
  }
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + hash01(k, 4, 31);
    const r = k === 0 ? 0 : 6 + hash01(k, 5, 31) * 7;
    const lump = new Mesh(faceted(new SphereGeometry(1, 9, 6)), toon({ color: LEAF[k % LEAF.length] }));
    const size = 6 + hash01(k, 6, 31) * 3;
    lump.scale.set(size, size * 0.42, size);
    lump.position.set(Math.cos(a) * r, high * 0.82 + hash01(k, 7, 31) * 1.5, Math.sin(a) * r);
    root.add(lump);
  }
  root.updateMatrixWorld(true);
  return root;
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
 * gilded clock, its front toward the road. All of it inside the block, the portico too (its columns
 * stood in front, where a car drove through them), and no two faces in one plane (the towers' sides
 * were the hall's, and the spires stood on the towers' tops: they shimmered in and out).
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
  // The hall, set back behind the portico and in from the towers' sides, a cornice round its top.
  const porch = 5;
  const hw = w - 1;
  const hd = d - porch;
  const hz = -porch / 2;
  solidBox(hw, high, hd, 0, high / 2, hz);
  solidBox(hw + 0.6, 0.8, hd + 0.8, 0, high + 0.4, hz, plain(TRIM));
  // The dome: a drum, the dome, a lantern.
  const drum = new Mesh(faceted(new CylinderGeometry(d * 0.24, d * 0.24, 3.5, 16)), plain(CREAM));
  drum.position.set(0, high + 2.5, hz);
  root.add(drum);
  const dome = new Mesh(faceted(new SphereGeometry(d * 0.25, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), plain(COPPER));
  dome.position.set(0, high + 4.2, hz);
  root.add(dome);
  const lantern = new Mesh(faceted(new CylinderGeometry(0.9, 0.9, 2.4, 8)), plain(GOLD));
  lantern.position.set(0, high + 4.2 + d * 0.25 + 1, hz);
  root.add(lantern);
  // The towers at the front corners, flanking the portico, each under a copper spire (sunk into a
  // parapet on its top).
  const tw = 6;
  for (const sx of [-1, 1]) {
    const tx = sx * (w / 2 - tw / 2);
    const tz = d / 2 - tw / 2;
    solidBox(tw, high + 7, tw, tx, (high + 7) / 2, tz);
    solidBox(tw + 0.6, 0.9, tw + 0.6, tx, high + 7 + 0.15, tz, plain(TRIM));
    const spire = new Mesh(faceted(new ConeGeometry(tw * 0.62, 7, 4, 1, true)), plain(COPPER));
    spire.position.set(tx, high + 7 + 3.5, tz);
    spire.rotation.y = Math.PI / 4;
    root.add(spire);
  }
  // The portico between the towers: a pediment on six columns, the clock in it.
  const pw = w * 0.4;
  const front = d / 2;
  for (let k = 0; k < 6; k++) {
    const col = new Mesh(faceted(new CylinderGeometry(0.55, 0.65, high * 0.62, 10)), plain(CREAM));
    col.position.set(-pw / 2 + (k * pw) / 5, high * 0.31, front - 1.2);
    root.add(col);
  }
  solidBox(pw + 2, 1.4, porch, 0, high * 0.62 + 0.7, front - porch / 2 - 0.2, plain(TRIM));
  const ped = new Mesh(faceted(new ConeGeometry(pw * 0.62, 3.2, 3, 1, true)), plain(CREAM));
  ped.scale.z = 0.3;
  ped.rotation.y = Math.PI;
  ped.position.set(0, high * 0.62 + 2.9, front - 2.4);
  root.add(ped);
  const clock = new Mesh(faceted(new CylinderGeometry(1, 1, 0.3, 16)), plain(GOLD));
  clock.rotation.x = Math.PI / 2;
  clock.position.set(0, high * 0.62 + 2.6, front - 1.2);
  root.add(clock);
  root.position.set(h.at[0], y, h.at[1]);
  root.rotation.y = h.rot;
  return root;
}

const CLUB_WHITE = 0xf6f3ec;
const POOL = 0x3fc6d8;
const DECK = 0xb08458;
const STRIPES = [
  [0x1d4f8f, 0xf6f3ec],
  [0xf2c84a, 0xf6f3ec],
  [0xe0563f, 0xf6f3ec],
];

/**
 * The beach club in the cove (docs/COASTAL.md, "The Beach": umbrellas, a pool): the solid block is
 * the house `h` (look 'club'), drawn as a low white modern pavilion, glass along its front under
 * striped awnings, and on its flat roof a terrace with a pool, loungers and umbrellas behind a glass
 * balustrade. Its front toward the sea.
 */
function club(h: HouseDef, y: number): Object3D {
  const [w, d, high] = h.size;
  const root = new Group();
  const add = (geo: BoxGeometry | ReturnType<typeof faceted>, color: number, x: number, yy: number, z: number, ry = 0) => {
    const m = new Mesh(geo, toon({ color }));
    m.position.set(x, yy, z);
    m.rotation.y = ry;
    root.add(m);
    return m;
  };
  // The pavilion, its roof slab a little proud all round, and glass across the front and down its ends.
  add(new BoxGeometry(w, high, d), CLUB_WHITE, 0, high / 2, 0);
  add(new BoxGeometry(w + 1.2, 0.45, d + 1.2), CLUB_WHITE, 0, high + 0.2, 0);
  add(new BoxGeometry(w * 0.86, high * 0.5, 0.1), 0x2b3a48, 0, high * 0.3, d / 2 + 0.05);
  for (const sx of [-1, 1]) add(new BoxGeometry(0.1, high * 0.5, d * 0.6), 0x2b3a48, sx * (w / 2 + 0.05), high * 0.3, 0);
  // Striped awnings over the glass, sloping out.
  const strips = 24;
  for (let k = 0; k < strips; k++) {
    const a = add(new BoxGeometry(w / strips, 0.08, 2.4), STRIPES[0][k % 2], -w / 2 + (w * (k + 0.5)) / strips, high * 0.62, d / 2 + 1.1);
    a.rotation.x = 0.25;
  }
  // The roof terrace: decking, the pool at its front, loungers along the pool, umbrellas, and the balustrade.
  const top = high + 0.45;
  add(new BoxGeometry(w - 0.6, 0.06, d - 0.6), DECK, 0, top, 0);
  add(new BoxGeometry(w * 0.55, 0.08, d * 0.36), POOL, -w * 0.12, top + 0.04, d * 0.18);
  add(new BoxGeometry(w * 0.55 + 0.6, 0.05, d * 0.36 + 0.6), CLUB_WHITE, -w * 0.12, top + 0.01, d * 0.18);
  for (let k = 0; k < 6; k++) add(new BoxGeometry(0.75, 0.35, 1.9), CLUB_WHITE, -w * 0.38 + k * w * 0.11, top + 0.2, -d * 0.12);
  for (let k = 0; k < 3; k++) {
    const x = -w * 0.33 + k * w * 0.22;
    add(faceted(new CylinderGeometry(0.05, 0.05, 2.4, 5)), 0xdedede, x, top + 1.2, -d * 0.28);
    const stripe = STRIPES[k % STRIPES.length];
    // (Closed underneath: an open shallow cone's every face is a back face from the road below.)
    for (let q = 0; q < 8; q++) {
      add(faceted(new ConeGeometry(1.6, 0.6, 8, 1, false, (q * Math.PI) / 4, Math.PI / 4)), stripe[q % 2], x, top + 2.4, -d * 0.28);
    }
  }
  // A bar at the back of the terrace under a white canopy.
  add(new BoxGeometry(w * 0.3, 1.1, 1.2), CLUB_WHITE, w * 0.28, top + 0.55, -d * 0.35);
  add(new BoxGeometry(w * 0.34, 0.15, 3.2), CLUB_WHITE, w * 0.28, top + 2.6, -d * 0.3);
  for (const [cx, cz] of [[w * 0.12, -d * 0.18], [w * 0.44, -d * 0.18]]) add(new BoxGeometry(0.15, 2.6, 0.15), CLUB_WHITE, cx, top + 1.3, cz);
  // The glass balustrade round the terrace's edge.
  const glass = toon({ color: 0xcfe8f0, transparent: true, opacity: 0.55 });
  for (const [sx, sz, x, z] of [[w + 1, 0.06, 0, d / 2 + 0.5], [w + 1, 0.06, 0, -d / 2 - 0.5], [0.06, d + 1, w / 2 + 0.5, 0], [0.06, d + 1, -w / 2 - 0.5, 0]]) {
    const b = new Mesh(new BoxGeometry(sx, 1, sz), glass);
    b.position.set(x, top + 0.5, z);
    root.add(b);
  }
  root.position.set(h.at[0], y, h.at[1]);
  root.rotation.y = h.rot;
  return root;
}

const HOTEL_WHITE = 0xf7efdf;
const HOTEL_BASE = 0xead9b8;
const SLATE = 0x4f5a6e;
const ROSE = 0xe79a96;
/** A hotel's upper floors, one bay of them (3.6 m across, a storey high): a tall window, its balcony's railing. */
let hotelUpper: ReturnType<typeof canvas> | undefined;
/** Its ground floor, one bay (6 m): an arched glass door in rusticated stone. */
let hotelBase: ReturnType<typeof canvas> | undefined;
function hotelTextures() {
  hotelUpper ??= canvas(64, 64, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#2b3550';
    g.fillRect(20, 10, 24, 40);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(16, 6, 32, 4);
    // The balcony: its slab and railing across the window's foot.
    g.fillStyle = '#3a3d48';
    g.fillRect(12, 50, 40, 3);
    for (let x = 13; x < 52; x += 5) g.fillRect(x, 40, 2, 10);
    g.fillRect(12, 40, 40, 2);
  });
  hotelBase ??= canvas(64, 64, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(0,0,0,0.1)';
    for (let y = 8; y < 64; y += 10) g.fillRect(0, y, 64, 2);
    g.fillStyle = '#2b3550';
    g.fillRect(18, 22, 28, 42);
    g.beginPath();
    g.arc(32, 22, 14, Math.PI, 0);
    g.fill();
  });
  for (const t of [hotelUpper, hotelBase]) t.wrapS = t.wrapT = RepeatWrapping;
  return { upper: hotelUpper, base: hotelBase };
}

/** A box whose texture repeats a bay `bay` m across and `storey` m high on each face (not stretched once over it). */
function tiledBox(w: number, h: number, d: number, bay: number, storey: number): BoxGeometry {
  const g = new BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv');
  // Faces in BoxGeometry's order: +x, -x, +y, -y, +z, -z; four corners each.
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++)
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(dims[f][0] / bay)), uv.getY(i) * Math.max(1, Math.round(dims[f][1] / storey)));
    }
  return g;
}

/** The hotel's name on its terrace's front. */
let hotelSign: ReturnType<typeof canvas> | undefined;
function sign() {
  return (hotelSign ??= canvas(512, 64, (g) => {
    g.fillStyle = '#22304f';
    g.fillRect(0, 0, 512, 64);
    g.fillStyle = '#e8c050';
    g.fillRect(0, 4, 512, 2);
    g.fillRect(0, 58, 512, 2);
    g.font = 'bold 34px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('HÔTEL  DES  PINS', 256, 33);
  }));
}

/**
 * The hotel (the owner, 2026-10-05: "a pull in hotel with a front terrace you drive under"): its
 * solid block is the house `h` (look 'hotel'), drawn as a white Belle Époque hotel, balconies on
 * every floor over a rusticated ground floor, a slate roof with a rose dome on each front corner;
 * its terrace out over the street in front on cream columns (the sim's own: `columns`, kind
 * 'house-column'), its name along the front, parasols and planters on top. No two faces in one plane.
 */
function hotel(h: HouseDef, y: number, columns: readonly BakedProp[]): Object3D[] {
  const [w, d, high] = h.size;
  const p = h.porch;
  const root = new Group();
  const tex = hotelTextures();
  const plain = (color: number) => toon({ color });
  const box = (geo: BoxGeometry, m: ReturnType<typeof toon> | ReturnType<typeof toon>[], x: number, yy: number, z: number) => {
    const b = new Mesh(geo, m);
    b.position.set(x, yy, z);
    root.add(b);
    return b;
  };
  // The ground floor, the floors over it, a cornice, the roof.
  const base = 4.6;
  box(tiledBox(w, base, d, 6, base), toon({ color: HOTEL_BASE, map: tex.base }), 0, base / 2, 0);
  box(tiledBox(w, high - base, d, 3.6, 3.2), toon({ color: HOTEL_WHITE, map: tex.upper }), 0, base + (high - base) / 2, 0);
  box(new BoxGeometry(w + 0.8, 0.8, d + 0.8), plain(TRIM), 0, high + 0.4, 0);
  box(new BoxGeometry(w + 0.5, 0.5, d + 0.5), plain(TRIM), 0, base + 0.15, 0);
  const roof = new Mesh(prism(), toon({ color: SLATE, side: DoubleSide }));
  roof.scale.set(d - 0.4, 4.5, w - 0.4);
  roof.rotation.y = Math.PI / 2;
  roof.position.set(0, high + 0.8, 0);
  root.add(roof);
  for (const sx of [-1, 1]) {
    const [dx, dz] = [sx * (w / 2 - 3.4), d / 2 - 3.4];
    const drum = new Mesh(faceted(new CylinderGeometry(2.6, 2.6, 3.4, 12)), plain(HOTEL_WHITE));
    drum.position.set(dx, high + 2.5, dz);
    const dome = new Mesh(faceted(new SphereGeometry(2.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)), plain(ROSE));
    dome.position.set(dx, high + 4.2, dz);
    const tip = new Mesh(faceted(new ConeGeometry(0.4, 1.8, 6)), plain(GOLD));
    tip.position.set(dx, high + 4.2 + 2.6 + 0.7, dz);
    root.add(drum, dome, tip);
  }
  const out: Object3D[] = [root];
  if (p) {
    // The terrace: its deck (from just inside the front wall out), a deep front with the name on
    // it standing proud of the deck and over it as a parapet, low walls along its sides.
    const front = d / 2 + p.depth;
    const deck = 0.7;
    box(new BoxGeometry(p.width, deck, p.depth + 0.4), plain(HOTEL_WHITE), 0, p.high + deck / 2, d / 2 + p.depth / 2 - 0.2);
    const fascia = 1.8;
    const side = plain(HOTEL_WHITE);
    box(new BoxGeometry(p.width + 0.4, fascia, 0.5), [side, side, side, side, toon({ map: sign() }), side], 0, p.high - 0.2 + fascia / 2, front);
    for (const sx of [-1, 1]) box(new BoxGeometry(0.3, 1, p.depth - 0.4), plain(HOTEL_WHITE), sx * (p.width / 2 - 0.35), p.high + deck + 0.5, d / 2 + p.depth / 2 - 0.2);
    // Parasols over tables, planters at the front's corners.
    const shades = [0xffffff, 0x2a9d8f, 0xe76f51];
    for (let k = 0; k < 3; k++) {
      const x = (k - 1) * (p.width / 3.4);
      const z = d / 2 + p.depth * 0.5;
      const top = p.high + deck;
      const pole = new Mesh(new CylinderGeometry(0.07, 0.07, 2.4, 6), plain(0x6b5a48));
      pole.position.set(x, top + 1.2, z);
      const shade = new Mesh(faceted(new ConeGeometry(1.7, 0.7, 8)), plain(shades[k % shades.length]));
      shade.position.set(x, top + 2.5, z);
      const table = new Mesh(faceted(new CylinderGeometry(0.55, 0.55, 0.08, 10)), plain(0xffffff));
      table.position.set(x, top + 0.75, z);
      root.add(pole, shade, table);
    }
    for (const sx of [-1, 1]) {
      const pot = new Mesh(new BoxGeometry(0.9, 0.7, 0.9), plain(0xb9532c));
      pot.position.set(sx * (p.width / 2 - 1.3), p.high + deck + 0.35, front - 1.1);
      const bush = new Mesh(faceted(new SphereGeometry(0.75, 8, 5)), plain(0x2f7d3a));
      bush.position.set(sx * (p.width / 2 - 1.3), p.high + deck + 1.2, front - 1.1);
      root.add(pot, bush);
    }
    // The columns, where the sim stands them (each from its own ground up under the deck), a
    // capital on each.
    for (const [x, z] of porchColumns(h)) {
      const c = columns.find((q) => Math.abs(q.x - x) < 0.01 && Math.abs(q.z - z) < 0.01);
      const foot = c ? c.y : y;
      const tall = y + p.high - foot;
      const col = new Mesh(faceted(new CylinderGeometry(COLUMN_R * 0.9, COLUMN_R, tall, 10)), plain(CREAM));
      col.position.set(x, foot + tall / 2, z);
      const cap = new Mesh(new BoxGeometry(COLUMN_R * 2.6, 0.35, COLUMN_R * 2.6), plain(TRIM));
      cap.position.set(x, y + p.high - 0.2, z);
      cap.rotation.y = h.rot;
      out.push(col, cap);
    }
  }
  root.position.set(h.at[0], y, h.at[1]);
  root.rotation.y = h.rot;
  return out;
}
