// The getaway's city (docs/CHASE_MODE.md; tools/gen-heist.ts), drawn: each district's buildings in
// a look of its own (HouseDef.look), their facades a window a bay across and a storey high, tiled
// up the whole building (not one texture stretched over it), over a ground floor of shopfronts.
//   tower      the Financial District: glass and stone, mullions, a plant room on top
//   chinatown  painted walls, balconies, signs over the shops
//   victorian  the Hills and the Mission: painted ladies, bay windows, white trim
//   warehouse  SoMa: brick, big steel windows, loading doors
// And the one-offs: the Bank (a granite temple at the foot of its tower, its name over the
// columns), the Ferry Building (its clock tower), the piers out in the bay (each its number over
// its doors), Lombard's planters, Dolores Park's palms, the Freeway's wall. Every building of a look
// is one mesh (merged, vertex coloured): a draw for its walls, one for its ground floors.

import { BoxGeometry, BufferGeometry, CanvasTexture, CatmullRomCurve3, ConeGeometry, CylinderGeometry, Float32BufferAttribute, Group, IcosahedronGeometry, Matrix4, Mesh, MeshBasicMaterial, type Object3D, PlaneGeometry, Quaternion, RepeatWrapping, Vector3 } from 'three';
import { Rng } from '../../../core/rng';
import { buildCar } from './car/build';
import { glowPoints } from './scenery';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { KIND_ROAD } from '../../../core/track/ground';
import type { HouseDef } from '../../../core/content';
import { hash01 } from '../../../core/rng';
import type { Track } from '../../../core/track/bake';
import { instanced, type Part } from './forest';
import { palmGeometry } from './island';
import { canvas } from './scenery';
import { faceted, toon } from './toon';

/** The looks drawn here (any other is houses.ts's). */
export const CITY_LOOKS: ReadonlySet<string> = new Set(['tower', 'chinatown', 'victorian', 'warehouse', 'bank', 'ferry', 'pier', 'planter', 'palm', 'wall']);

/** A storey (m): the generator's houses are a whole number of them high. */
const STOREY = 3.4;

interface Style {
  /** A bay's width (m), its ground floor's height (m). */
  bay: number;
  base: number;
  walls: number[];
  /** The cornice and roof. */
  trim: number[];
  roof: number;
  upper: () => CanvasTexture;
  ground: () => CanvasTexture;
}

/** A tile's texture, made once, repeating. */
function tile(draw: (g: CanvasRenderingContext2D) => void): () => CanvasTexture {
  let t: CanvasTexture | undefined;
  return () => {
    if (t) return t;
    t = canvas(64, 64, (g) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 64, 64);
      draw(g);
    });
    t.wrapS = t.wrapT = RepeatWrapping;
    return t;
  };
}

const STYLES: Record<string, Style> = {
  tower: {
    bay: 3,
    base: 5,
    walls: [0xc9ccd2, 0xb8c4d6, 0xd8cdb8, 0x9fb0c4, 0xe2ddd2, 0xa9b6c2, 0x8e9fb4],
    trim: [0x8a919c, 0x6f7784],
    roof: 0x5d636e,
    upper: tile((g) => {
      // A glass panel between mullions, a spandrel under it.
      g.fillStyle = '#34465f';
      g.fillRect(6, 4, 52, 44);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(8, 6, 18, 40);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(0, 52, 64, 12);
    }),
    ground: tile((g) => {
      g.fillStyle = '#2a3446';
      g.fillRect(3, 6, 58, 58);
      g.fillStyle = 'rgba(255,255,255,0.15)';
      g.fillRect(6, 10, 20, 54);
      g.fillStyle = '#ffffff';
      g.fillRect(31, 6, 2, 58);
    }),
  },
  chinatown: {
    bay: 4,
    base: STOREY,
    walls: [0xe8d9b5, 0xd2523f, 0x5f9a72, 0xe9c35a, 0xf1ebe0, 0xc8735a, 0x7fb3a8],
    trim: [0xb8332a, 0x2f6b4a, 0xd9a33a],
    roof: 0x5a4a44,
    upper: tile((g) => {
      g.fillStyle = '#2b3550';
      g.fillRect(16, 10, 32, 30);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(12, 6, 40, 4);
      // A little balcony's rail.
      g.fillStyle = '#3a3d48';
      g.fillRect(10, 46, 44, 3);
      for (let x = 11; x < 54; x += 6) g.fillRect(x, 38, 2, 9);
    }),
    ground: tile((g) => {
      // A shop: its sign over its window and door.
      g.fillStyle = '#c8302a';
      g.fillRect(0, 2, 64, 14);
      g.fillStyle = '#f2c84a';
      g.fillRect(10, 6, 44, 5);
      g.fillStyle = '#2b2f3c';
      g.fillRect(4, 22, 36, 42);
      g.fillStyle = '#4a3428';
      g.fillRect(44, 24, 16, 40);
    }),
  },
  victorian: {
    bay: 5,
    base: STOREY,
    walls: [0xc9b3e0, 0xa9dcc4, 0xf3df8f, 0x9fc8ea, 0xf2a99a, 0xf4efe4, 0xe7c0d6, 0xb6d98f],
    trim: [0xffffff, 0xf4efe4],
    roof: 0x6a5a5a,
    upper: tile((g) => {
      // A bay window: three tall panes in a white frame, a band under it.
      g.fillStyle = '#ffffff';
      g.fillRect(8, 4, 48, 48);
      g.fillStyle = '#2d3a55';
      for (const x of [12, 27, 42]) g.fillRect(x, 8, 10, 38);
      g.fillStyle = 'rgba(0,0,0,0.16)';
      g.fillRect(6, 52, 52, 4);
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.fillRect(0, 58, 64, 3);
    }),
    ground: tile((g) => {
      // A garage door and a front door up a step.
      g.fillStyle = '#ffffff';
      g.fillRect(2, 16, 34, 48);
      g.fillStyle = '#7a6a5a';
      g.fillRect(5, 20, 28, 44);
      g.fillStyle = 'rgba(0,0,0,0.15)';
      for (let y = 26; y < 64; y += 7) g.fillRect(5, y, 28, 1);
      g.fillStyle = '#3a2f4a';
      g.fillRect(44, 18, 14, 40);
      g.fillStyle = '#d8d0c4';
      g.fillRect(40, 58, 22, 6);
    }),
  },
  warehouse: {
    bay: 6,
    base: 4.4,
    walls: [0xa8553e, 0x8f4a38, 0xb8704f, 0xc49a74, 0x9c6a52, 0x7d5446],
    trim: [0x5a4038, 0xd9cbb2],
    roof: 0x4e4a48,
    upper: tile((g) => {
      // Brick courses, a big steel-framed window of small panes.
      g.fillStyle = 'rgba(0,0,0,0.08)';
      for (let y = 2; y < 64; y += 5) g.fillRect(0, y, 64, 1);
      g.fillStyle = '#2f3a44';
      g.fillRect(10, 8, 44, 40);
      g.fillStyle = '#c9cfd4';
      for (let x = 10; x <= 54; x += 11) g.fillRect(x, 8, 1.5, 40);
      for (let y = 8; y <= 48; y += 10) g.fillRect(10, y, 44, 1.5);
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.fillRect(8, 48, 48, 4);
    }),
    ground: tile((g) => {
      // A roll-up loading door.
      g.fillStyle = 'rgba(0,0,0,0.08)';
      for (let y = 2; y < 64; y += 5) g.fillRect(0, y, 64, 1);
      g.fillStyle = '#8e969c';
      g.fillRect(8, 14, 48, 50);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      for (let y = 18; y < 64; y += 4) g.fillRect(8, y, 48, 1);
      g.fillStyle = '#f2c23a';
      g.fillRect(8, 12, 48, 2);
    }),
  },
};

/** Faces, merged: positions, normals, uvs and colours, a quad at a time. */
class Merge {
  readonly p: number[] = [];
  readonly n: number[] = [];
  readonly uv: number[] = [];
  readonly c: number[] = [];

  /** A quad from its four corners (counter-clockwise from outside: bottom left, bottom right, top right, top left). */
  quad(q: number[][], normal: number[], uvs: number[][], color: number): void {
    const r = ((color >> 16) & 255) / 255;
    const g = ((color >> 8) & 255) / 255;
    const b = (color & 255) / 255;
    for (const k of [0, 1, 2, 0, 2, 3]) {
      this.p.push(...q[k]);
      this.n.push(...normal);
      this.uv.push(...uvs[k]);
      this.c.push(r, g, b);
    }
  }

  /**
   * The sides of a box round (x, z) turned `yaw`, `w` across its front and `d` deep, from y0 up to
   * y1: its texture repeating every `bay` m across and `storey` m up (0: once over the face). With
   * `top`, its top too.
   */
  box(x: number, z: number, yaw: number, w: number, d: number, y0: number, y1: number, color: number, bay = 0, storey = 0, top = false): void {
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    // (Local to world: three's turn about y.)
    const W = (lx: number, y: number, lz: number) => [x + lx * cs + lz * sn, y, z - lx * sn + lz * cs];
    for (const [nx, nz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const hn = nx ? w / 2 : d / 2;
      const hr = nx ? d / 2 : w / 2;
      // (Its right, seen from outside.)
      const [rx, rz] = [nz, -nx];
      const [cx, cz] = [nx * hn, nz * hn];
      const u = bay ? Math.max(1, Math.round((2 * hr) / bay)) : 1;
      const v = storey ? Math.max(1, Math.round((y1 - y0) / storey)) : 1;
      const corners = [W(cx - rx * hr, y0, cz - rz * hr), W(cx + rx * hr, y0, cz + rz * hr), W(cx + rx * hr, y1, cz + rz * hr), W(cx - rx * hr, y1, cz - rz * hr)];
      this.quad(corners, [nx * cs + nz * sn, 0, -nx * sn + nz * cs], [[0, 0], [u, 0], [u, v], [0, v]], color);
    }
    if (top) this.quad([W(-w / 2, y1, d / 2), W(w / 2, y1, d / 2), W(w / 2, y1, -d / 2), W(-w / 2, y1, -d / 2)], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], color);
  }

  mesh(map?: CanvasTexture): Mesh | null {
    if (!this.p.length) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return new Mesh(g, toon({ map, vertexColors: true }));
  }
}

const pick = (list: readonly number[], k: number, salt: number) => list[Math.floor(hash01(k, salt, 29) * list.length)];

/** The city's houses (those with a look of CITY_LOOKS), each `k` its index in the layout's houses, `y` where the sim stood it. */
export function buildHeistCity(track: Track, list: { h: HouseDef; k: number; y: number }[]): Object3D[] {
  const out: Object3D[] = [];
  const sea = track.layout.ground?.sea ?? 0;
  const upper = new Map<string, Merge>();
  const ground = new Map<string, Merge>();
  const plain = new Merge();
  const planters: Part[] = [];
  const blooms: Part[] = [];
  const palms: Part[] = [];
  const neon = new Neon();
  for (const { h, k, y } of list) {
    const [w, d, high] = h.size;
    const style = STYLES[h.look ?? ''];
    if (style) {
      const look = h.look!;
      if (!upper.has(look)) upper.set(look, new Merge()), ground.set(look, new Merge());
      const wall = pick(style.walls, k, 1);
      const base = Math.min(style.base, high);
      ground.get(look)!.box(h.at[0], h.at[1], h.rot, w, d, y, y + base, wall, style.bay, base);
      if (high > base) upper.get(look)!.box(h.at[0], h.at[1], h.rot, w, d, y + base, y + high, wall, style.bay, STOREY);
      if (h.label) neon.add(h, y, base, plain);
      // A cornice, a little proud, and the roof under it.
      const trim = pick(style.trim, k, 2);
      plain.box(h.at[0], h.at[1], h.rot, w + 0.6, d + 0.6, y + high - 0.2, y + high + 0.6, trim, 0, 0, false);
      plain.box(h.at[0], h.at[1], h.rot, w + 0.2, d + 0.2, y + high, y + high + 0.3, style.roof, 0, 0, true);
      // A tower's plant room; a warehouse's rooftop water tank, now and then.
      if (look === 'tower' && high > 30) plain.box(h.at[0], h.at[1], h.rot, w * 0.45, d * 0.45, y + high, y + high + 4, 0x7a818c, 0, 0, true);
      if (look === 'warehouse' && hash01(k, 3, 29) < 0.3) {
        const t = new Mesh(faceted(new CylinderGeometry(1.6, 1.6, 3, 8)), toon({ color: 0x7a5a40 }));
        t.position.set(h.at[0] + Math.cos(h.rot) * w * 0.2, y + high + 4, h.at[1] - Math.sin(h.rot) * w * 0.2);
        const cap = new Mesh(faceted(new ConeGeometry(1.8, 1.4, 8)), toon({ color: 0x5a4a3a }));
        cap.position.set(t.position.x, t.position.y + 2.2, t.position.z);
        out.push(t, cap);
        for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) plain.box(t.position.x + lx * 1, t.position.z + lz * 1, 0, 0.2, 0.2, y + high, y + high + 2.5, 0x3a3a3a);
      }
      continue;
    }
    switch (h.look) {
      case 'bank':
        out.push(bank(h, y));
        break;
      case 'ferry':
        out.push(ferry(h, y));
        break;
      case 'pier':
        out.push(pier(h, sea));
        break;
      case 'planter':
        planters.push({ x: h.at[0], y: y + high / 2, z: h.at[1], yaw: h.rot, sx: w, sy: high, sz: d, color: 0xa8553e });
        blooms.push({ x: h.at[0], y: y + high, z: h.at[1], yaw: h.rot, sx: w - 0.4, sy: 0.9, sz: d - 0.4, color: pick([0xe0559a, 0xd8384a, 0xf08ac0, 0x6fae4a], k, 4) });
        break;
      case 'palm': {
        const s = high / 8.5;
        palms.push({ x: h.at[0], y: y - 0.2, z: h.at[1], yaw: hash01(k, 5, 29) * 6.28, sx: s, sy: s, sz: s, color: pick([0x3f8a3a, 0x4f9a3f, 0x5aa04a], k, 6) });
        break;
      }
      case 'wall':
        plain.box(h.at[0], h.at[1], h.rot, w, d, y, y + high, 0xa8a49c, 0, 0, true);
        break;
    }
  }
  for (const [look, m] of upper) {
    const style = STYLES[look];
    out.push(...[m.mesh(style.upper()), ground.get(look)!.mesh(style.ground())].filter((q): q is Mesh => !!q));
  }
  const rest = plain.mesh();
  if (rest) out.push(rest);
  out.push(...neon.build());
  if (planters.length) out.push(instanced(new BoxGeometry(1, 1, 1), toon(), planters), instanced(faceted(new BoxGeometry(1, 1, 1, 3, 1, 1)), toon(), blooms));
  if (palms.length) {
    const geo = palmGeometry();
    out.push(instanced(geo.trunk, toon({ color: 0x8a6a44 }), palms.map((q) => ({ ...q, color: 0xffffff }))), instanced(geo.fronds, toon(), palms));
  }
  return out;
}

// ---- The one-offs ----

const GRANITE = 0xd9d4c8;
const STONE_DARK = 0xb8b1a2;
const CREAM = 0xf1e6cc;
const COPPER = 0x5f9a86;

/** Words on a panel: `w`×`h` px, light letters on a dark ground or the other way. */
function panel(text: string, w: number, h: number, fg: string, bg: string, font: string): CanvasTexture {
  return canvas(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);
  });
}

/** A box in a group, its local middle at (x, y, z). */
function part(root: Group, w: number, hgt: number, d: number, color: number | Mesh['material'], x: number, y: number, z: number): Mesh {
  const m = new Mesh(new BoxGeometry(w, hgt, d), typeof color === 'number' ? toon({ color }) : color);
  m.position.set(x, y, z);
  root.add(m);
  return m;
}

/**
 * The Bank: its tower (the house's block) over a granite temple across its front, three storeys of
 * it: steps, six columns, its name over them, a pediment.
 */
function bank(h: HouseDef, y: number): Object3D {
  const [w, d, high] = h.size;
  const root = new Group();
  const tower = STYLES.tower;
  const podium = Math.min(13, high);
  const m = new Merge();
  m.box(0, 0, 0, w - 2, d - 2, podium, high, 0xcfd3d8, tower.bay, STOREY);
  const shaft = m.mesh(tower.upper());
  if (shaft) root.add(shaft);
  part(root, w + 0.8, 0.8, d + 0.8, STONE_DARK, 0, high + 0.4, 0);
  // The portico, inside the block (the sim's solid box is the whole of it: nothing out over the
  // pavement to drive through): the granite set back behind its columns, steps up to them.
  const porch = 6;
  const front = d / 2;
  part(root, w, podium, d - porch, GRANITE, 0, podium / 2, -porch / 2);
  const across = Math.min(w - 2, 30);
  part(root, across, 0.6, porch, STONE_DARK, 0, 0.3, front - porch / 2);
  part(root, across - 1, 0.6, porch - 1.4, GRANITE, 0, 0.9, front - porch / 2 - 0.7);
  part(root, w, 2.4, porch, GRANITE, 0, podium - 1.2, front - porch / 2);
  const cols = 6;
  for (let c = 0; c < cols; c++) {
    const x = -across / 2 + 1.5 + (c * (across - 3)) / (cols - 1);
    const col = new Mesh(faceted(new CylinderGeometry(0.8, 0.9, podium - 3.6, 12)), toon({ color: GRANITE }));
    col.position.set(x, 1.2 + (podium - 3.6) / 2, front - 1.2);
    root.add(col);
  }
  const sign = new Mesh(new BoxGeometry(across, 1.8, 0.2), toon({ map: panel('BANK OF THE BAY', 512, 64, '#e8c050', '#3a3a42', 'bold 40px Georgia, serif') }));
  sign.position.set(0, podium - 1.2, front + 0.05);
  root.add(sign);
  // (A triangular prism, its ridge across the front.)
  const ped = new Mesh(faceted(new CylinderGeometry(1, 1, w, 3).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2)), toon({ color: GRANITE }));
  ped.scale.set(1, 2, 2.9);
  ped.position.set(0, podium + 2, front - 2.9);
  root.add(ped);
  // A flag on the roof.
  const pole = new Mesh(new CylinderGeometry(0.12, 0.12, 8, 6), toon({ color: 0xdddddd }));
  pole.position.set(0, high + 4.8, 0);
  const flag = part(root, 3.4, 2, 0.08, 0x2f5fb8, 1.75, high + 7.6, 0);
  root.add(pole, flag);
  root.position.set(h.at[0], y, h.at[1]);
  root.rotation.y = h.rot;
  return root;
}

/** A clock face: a cream dial, its numerals' marks, hands at ten past ten. */
function dial(): CanvasTexture {
  return canvas(128, 128, (g) => {
    g.fillStyle = '#3a3a42';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#f4ecd6';
    g.beginPath();
    g.arc(64, 64, 56, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2a2a30';
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      g.fillRect(64 + Math.sin(a) * 46 - 3, 64 - Math.cos(a) * 46 - 3, 6, 6);
    }
    g.lineWidth = 6;
    g.strokeStyle = '#2a2a30';
    g.beginPath();
    g.moveTo(64, 64);
    g.lineTo(64 + Math.sin(-1.05) * 30, 64 - Math.cos(-1.05) * 30);
    g.moveTo(64, 64);
    g.lineTo(64 + Math.sin(1.05) * 42, 64 - Math.cos(1.05) * 42);
    g.stroke();
  });
}

/** Arched windows in cream stone, a bay of them. */
const arches = tile((g) => {
  g.fillStyle = '#2d3a55';
  g.fillRect(18, 22, 28, 42);
  g.beginPath();
  g.arc(32, 22, 14, Math.PI, 0);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, 0, 64, 4);
});

/** The Ferry Building: long, cream, arched windows; its clock tower in the middle, four faces and a cupola. */
function ferry(h: HouseDef, y: number): Object3D {
  const [w, d, high] = h.size;
  const root = new Group();
  const m = new Merge();
  m.box(0, 0, 0, w, d, 0, high, CREAM, 6, high / 2);
  const body = m.mesh(arches());
  if (body) root.add(body);
  part(root, w + 1, 0.8, d + 1, 0xd8c8a4, 0, high + 0.4, 0);
  part(root, w - 2, 2.4, d - 6, 0x8a8c90, 0, high + 1.2, 0);
  const tower = 46;
  const t = new Merge();
  t.box(0, 0, 0, 9, 9, high, tower, CREAM, 3, 5);
  const shaft = t.mesh(arches());
  if (shaft) root.add(shaft);
  const face = toon({ map: dial() });
  const cream = toon({ color: CREAM });
  const clock = new Mesh(new BoxGeometry(10, 10, 10), [face, face, cream, cream, face, face]);
  clock.position.set(0, tower + 5, 0);
  root.add(clock);
  part(root, 11, 1, 11, 0xd8c8a4, 0, tower + 10.5, 0);
  part(root, 7, 6, 7, CREAM, 0, tower + 14, 0);
  const cupola = new Mesh(faceted(new ConeGeometry(4.6, 8, 8)), toon({ color: COPPER }));
  cupola.position.set(0, tower + 21, 0);
  const spire = new Mesh(new CylinderGeometry(0.15, 0.15, 6, 6), toon({ color: 0x404040 }));
  spire.position.set(0, tower + 28, 0);
  root.add(cupola, spire);
  // Its name along the front, over the arcade.
  const sign = new Mesh(new BoxGeometry(40, 2.4, 0.3), toon({ map: panel('FERRY  BUILDING', 512, 32, '#2f3a4a', '#f1e6cc', 'bold 24px Georgia, serif') }));
  sign.position.set(0, high - 2.2, d / 2 + 0.2);
  root.add(sign);
  root.position.set(h.at[0], y, h.at[1]);
  root.rotation.y = h.rot;
  return root;
}

/** A pier: a deck on piles just over the sea, a long shed on it, its doors and number toward the road. */
function pier(h: HouseDef, sea: number): Object3D {
  const [w, d] = h.size;
  const root = new Group();
  const deck = sea + 2.6;
  part(root, w, 0.8, d, 0x8a7f72, 0, deck - 0.4, 0);
  const piles: Part[] = [];
  for (let lz = -d / 2 + 3; lz <= d / 2 - 3; lz += 9) for (const lx of [-w / 2 + 1.5, 0, w / 2 - 1.5]) piles.push({ x: lx, y: sea - 3, z: lz, yaw: 0, sx: 0.7, sy: 5.5, sz: 0.7, color: 0x5a4a3c });
  root.add(instanced(new CylinderGeometry(0.5, 0.5, 1, 6).translate(0, 0.5, 0), toon(), piles));
  const shed = { w: w - 4, d: d - 10, h: 9 };
  const wall = [0xcfd2c4, 0xd8cdb4, 0xbac4b8][Math.round(hash01(Math.round(h.at[0]), Math.round(h.at[1]), 31) * 2)];
  const m = new Merge();
  m.box(0, 0, 0, shed.w, shed.d, deck, deck + shed.h, wall, 6, shed.h);
  const body = m.mesh(STYLES.warehouse.ground());
  if (body) root.add(body);
  // A shallow pitched roof down its length.
  const roof = new Mesh(faceted(new CylinderGeometry(1, 1, shed.d + 1, 3).rotateX(Math.PI / 2)), toon({ color: 0x6d7f8e }));
  roof.scale.set(shed.w / 1.7, 2.2, 1);
  roof.position.set(0, deck + shed.h + 0.6, 0);
  root.add(roof);
  // Its front: a taller headhouse with its number.
  part(root, shed.w + 1, shed.h + 4, 2, wall, 0, deck + (shed.h + 4) / 2, shed.d / 2);
  const label = new Mesh(new BoxGeometry(12, 2.4, 0.3), toon({ map: panel(h.label ?? 'PIER', 256, 52, '#f4f1e6', '#2f4a5a', 'bold 34px Georgia, serif') }));
  label.position.set(0, deck + shed.h + 1.6, shed.d / 2 + 1.1);
  root.add(label);
  root.position.set(h.at[0], 0, h.at[1]);
  root.rotation.y = h.rot;
  return root;
}

// ---- The streets' paint ----

const PAINT_WHITE = 0xeeeeea;
const PAINT_YELLOW = 0xf0c63a;
/** The pavements (gen-heist's SIDEWALK, m: from the kerb to the buildings), their concrete and kerb. */
const SIDEWALK = 3;
const PAVEMENT = 0x8f8898;
const KERB = 0xc4bdc8;
/** A crossing's level ground reaches this far from its middle (gen-heist's crossings, r 9): the crosswalks start just past it. */
const CROSSING = 9.5;
/** A crosswalk's depth along the street (m), its bars' width across and the gap between them. */
const ZEBRA = { deep: 3, bar: 0.6, gap: 0.7 };
/** Paint stands this far over the ground (m), and follows it in pieces this long. */
const LIFT = 0.05;
const PIECE = 1.5;

/**
 * The streets' paint (GetawayDef.paint): a crosswalk across each end of a street where it meets two
 * or more others, and down its middle a double yellow line (a wide street) or a dashed white one,
 * laid on the ground (it follows the hills up and over each crossing's crest).
 */
export function buildStreetPaint(track: Track): Object3D[] {
  const def = track.layout.getaway;
  const ground = track.ground;
  if (!def?.paint || !ground) return [];
  const m = new Merge();
  const walks = new Merge();
  const ys = (x: number, z: number) => ground.height(x, z) + LIFT;
  /** A strip from (x0, z0) to (x1, z1), `w` m wide, in pieces so it lies on the ground (into `into`; not on the main road). */
  const strip = (x0: number, z0: number, x1: number, z1: number, w: number, color: number, into = m, piece = PIECE) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(len / piece));
    const [ax, az] = [(-(z1 - z0) / len) * (w / 2), ((x1 - x0) / len) * (w / 2)];
    for (let k = 0; k < n; k++) {
      const [px, pz] = [x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n];
      const [qx, qz] = [x0 + ((x1 - x0) * (k + 1)) / n, z0 + ((z1 - z0) * (k + 1)) / n];
      if (into === walks && ground.kindAt((px + qx) / 2, (pz + qz) / 2) === KIND_ROAD) continue;
      // (Counter-clockwise seen from above.)
      into.quad([[px - ax, ys(px - ax, pz - az), pz - az], [px + ax, ys(px + ax, pz + az), pz + az], [qx + ax, ys(qx + ax, qz + az), qz + az], [qx - ax, ys(qx - ax, qz - az), qz - az]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], color);
    }
  };
  const degree = new Uint16Array(def.nodes.length);
  for (const [a, b] of def.links) degree[a]++, degree[b]++;
  // The widest street at each crossing: a pavement starts at its edge.
  const widest = new Float32Array(def.nodes.length);
  def.links.forEach(([a, b], k) => {
    widest[a] = Math.max(widest[a], def.paint![k]);
    widest[b] = Math.max(widest[b], def.paint![k]);
  });
  def.links.forEach(([a, b], k) => {
    const w = def.paint![k];
    if (!w) return;
    const [ax, az] = def.nodes[a];
    const [bx, bz] = def.nodes[b];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 2 * (CROSSING + ZEBRA.deep) + 2) return;
    const [dx, dz] = [(bx - ax) / len, (bz - az) / len];
    const [cx, cz] = [-dz, dx];
    const along = (t: number, lat: number): [number, number] => [ax + dx * t + cx * lat, az + dz * t + cz * lat];
    // Its pavements, a kerb along each.
    const [t0, t1] = [widest[a] / 2, len - widest[b] / 2];
    for (const side of [-1, 1]) {
      strip(...along(t0, side * (w / 2 + SIDEWALK / 2)), ...along(t1, side * (w / 2 + SIDEWALK / 2)), SIDEWALK - 0.1, PAVEMENT, walks, 2.5);
      strip(...along(t0, side * (w / 2 + 0.15)), ...along(t1, side * (w / 2 + 0.15)), 0.3, KERB, walks, 2.5);
    }
    // The crosswalks: bars along the street, side by side across it.
    for (const [end, node] of [[0, a], [1, b]] as const) {
      if (degree[node] < 3) continue;
      const t0 = end ? len - CROSSING - ZEBRA.deep : CROSSING;
      for (let lat = -w / 2 + ZEBRA.bar; lat <= w / 2 - ZEBRA.bar / 2; lat += ZEBRA.bar + ZEBRA.gap) strip(...along(t0, lat), ...along(t0 + ZEBRA.deep, lat), ZEBRA.bar, PAINT_WHITE);
    }
    // Down its middle, between them.
    const [from, to] = [CROSSING + ZEBRA.deep + 2, len - CROSSING - ZEBRA.deep - 2];
    if (w >= 16) for (const lat of [-0.2, 0.2]) strip(...along(from, lat), ...along(to, lat), 0.15, PAINT_YELLOW);
    else for (let t = from; t + 3 <= to; t += 7) strip(...along(t, 0), ...along(t + 3, 0), 0.15, PAINT_WHITE);
  });
  const out: Object3D[] = [];
  const pavement = walks.mesh();
  if (pavement) {
    const mat = pavement.material as ReturnType<typeof toon>;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -1;
    out.push(pavement);
  }
  const mesh = m.mesh();
  if (!mesh) return out;
  const mat = mesh.material as ReturnType<typeof toon>;
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -2;
  return [...out, mesh];
}

// ---- Neon ----

/** Neon's colours: pink, cyan, yellow, green, red, violet. */
const NEON = ['#ff3d9a', '#3df2ff', '#ffe14d', '#6dff7a', '#ff4a3d', '#c27dff'];
/** A letter's height on a sign (m), and a blade sign's depth out from its wall. */
const LETTER = 0.62;
const BLADE = 1.1;

/** A sign's face: the word in neon on a dark board, its letters stacked (a blade) or in a row. */
function neonFace(word: string, upright: boolean): CanvasTexture {
  const color = NEON[Math.floor(hash01(word.length, word.charCodeAt(0), word.charCodeAt(word.length - 1)) * NEON.length)];
  const n = word.length;
  const [w, h] = upright ? [64, 64 * n + 32] : [48 * n + 48, 80];
  return canvas(w, h, (g) => {
    g.fillStyle = '#16111f';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = color;
    g.lineWidth = 3;
    g.shadowColor = color;
    g.shadowBlur = 10;
    g.strokeRect(5, 5, w - 10, h - 10);
    g.fillStyle = '#ffffff';
    g.font = 'bold 46px "Arial Black", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowBlur = 16;
    // (Twice: a coloured halo, then the white-hot tube over it.)
    for (const fill of [color, '#fff6fb']) {
      g.fillStyle = fill;
      if (upright) [...word].forEach((ch, k) => g.fillText(ch, w / 2, 16 + 64 * k + 34));
      else g.fillText(word, w / 2, h / 2 + 2);
    }
  });
}

/**
 * The city's neon signs (a house's `label`): a blade out over the pavement from the street front
 * (its front, gen-heist turns each building to face its street), up its first floors, the word's
 * letters stacked; on a building too low for one, a sign across its front over the shops. Unlit
 * (they glow at dusk). Merged per word: a draw each.
 */
class Neon {
  private readonly faces = new Map<string, BufferGeometry[]>();

  add(h: HouseDef, y: number, base: number, frame: Merge): void {
    const word = h.label!;
    const [w, d, high] = h.size;
    const tall = word.replace(/ /g, '').length * LETTER + 0.5;
    const m = new Matrix4().makeRotationY(h.rot).setPosition(h.at[0], y, h.at[1]);
    const cs = Math.cos(h.rot);
    const sn = Math.sin(h.rot);
    const W = (lx: number, lz: number): [number, number] => [h.at[0] + lx * cs + lz * sn, h.at[1] - lx * sn + lz * cs];
    if (high - base - 1 >= tall && w > 6) {
      // A blade: out from the front near one end, from just over the shops.
      const lx = (hash01(Math.round(h.at[0]), Math.round(h.at[1]), 41) < 0.5 ? -1 : 1) * (w / 2 - 1.4);
      const lz = d / 2 + BLADE / 2 + 0.1;
      const y0 = base + 0.6;
      for (const side of [1, -1]) {
        const g = new PlaneGeometry(BLADE, tall).rotateY((side * Math.PI) / 2).translate(lx + side * 0.13, y0 + tall / 2, lz);
        this.put(`${word}|1`, g.applyMatrix4(m));
      }
      const [fx, fz] = W(lx, lz);
      frame.box(fx, fz, h.rot, 0.22, BLADE + 0.16, y + y0 - 0.08, y + y0 + tall + 0.08, 0x2a2433);
      // Its bracket to the wall.
      const [bx, bz] = W(lx, d / 2 + 0.05);
      frame.box(bx, bz, h.rot, 0.12, 0.2, y + y0 + tall - 0.2, y + y0 + tall + 0.3, 0x2a2433);
    } else {
      // Across the front, over the shops.
      const long = Math.min(w - 1.5, word.length * 0.75 + 1);
      if (long < 3) return;
      const g = new PlaneGeometry(long, 1.1).translate(0, base + 0.75, d / 2 + 0.12);
      this.put(`${word}|0`, g.applyMatrix4(m));
    }
  }

  private put(key: string, g: BufferGeometry): void {
    const list = this.faces.get(key);
    if (list) list.push(g);
    else this.faces.set(key, [g]);
  }

  build(): Mesh[] {
    return [...this.faces].map(([key, list]) => {
      const [word, up] = key.split('|');
      return new Mesh(mergeGeometries(list)!, new MeshBasicMaterial({ map: neonFace(word, up === '1') }));
    });
  }
}

// ---- Round the city: the bridges' approaches, closed by the police; the Presidio ----

const DECK_GREY = 0x8d8a92;
/** The police car's size (content/cars/police.json): half width, half length, height. */
const POLICE_SIZE: [number, number, number] = [0.95, 2.25, 0.72];
const PARAPET = 0xb8b4bc;
const COLUMN = 0xa39d94;

/**
 * What's round the getaway's city past its walls (GetawayDef.scenery; drawing only): each bridge's
 * approach, a deck on columns curving down from the bridge's end, its parapets, lane lines, police
 * cars parked across it where it's closed and a striped barrier in front of them, their light bars
 * lit; and the Presidio's woods, cypress and eucalyptus over the land past Van Ness, kept off the
 * approach through them.
 */
export function buildCitySurrounds(track: Track): Object3D[] {
  const sc = track.layout.getaway?.scenery;
  const ground = track.ground;
  if (!sc || !ground) return [];
  const out: Object3D[] = [];
  const decks = new Merge();
  const lines = new Merge();
  const geos: BufferGeometry[] = [];
  const up = new Vector3(0, 1, 0);
  const q = new Quaternion();
  const m4 = new Matrix4();
  /** A box `w` × `h` × `len` from a to b (its length along a→b, level across it), coloured. */
  const beam = (a: Vector3, b: Vector3, w: number, h: number, color: number) => {
    const d = new Vector3().subVectors(b, a);
    const len = d.length();
    const g = new BoxGeometry(w, h, len);
    q.setFromUnitVectors(new Vector3(0, 0, 1), d.normalize());
    m4.compose(new Vector3().addVectors(a, b).multiplyScalar(0.5), q, new Vector3(1, 1, 1));
    g.applyMatrix4(m4);
    const n = g.getAttribute('position').count;
    const c = [((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255];
    g.setAttribute('color', new Float32BufferAttribute(Array.from({ length: n * 3 }, (_, k) => c[k % 3]), 3));
    geos.push(g.index ? g.toNonIndexed() : g);
  };
  const lights: number[] = [];
  const near: [number, number][] = [];
  for (const ap of sc.approaches) {
    const curve = new CatmullRomCurve3(ap.path.map(([x, z, y]) => new Vector3(x, y, z)));
    const n = Math.ceil(curve.getLength() / 6);
    const pts = curve.getSpacedPoints(n);
    const half = ap.width / 2;
    for (let k = 0; k < n; k++) {
      const a = pts[k];
      const b = pts[k + 1];
      const side = new Vector3().subVectors(b, a).cross(up).setY(0).normalize();
      beam(a.clone().setY(a.y - 0.7), b.clone().setY(b.y - 0.7), ap.width, 1.4, DECK_GREY);
      for (const s of [-1, 1]) beam(a.clone().addScaledVector(side, s * (half - 0.3)).setY(a.y + 0.5), b.clone().addScaledVector(side, s * (half - 0.3)).setY(b.y + 0.5), 0.5, 1.1, PARAPET);
      // Dashed lane lines.
      if (k % 2 === 0) for (const s of [-1, 1]) beam(a.clone().addScaledVector(side, (s * half) / 3).setY(a.y + 0.03), b.clone().addScaledVector(side, (s * half) / 3).setY(b.y + 0.03), 0.18, 0.02, 0xeeeeea);
      // A column every 30 m, down to the ground (or the sea bed).
      if (k % 5 === 2 && a.y > 3) {
        const foot = ground.height(a.x, a.z);
        beam(new Vector3(a.x, foot - 1, a.z), new Vector3(a.x, a.y - 1.4, a.z), 2.4, 3.2, COLUMN);
      }
      near.push([a.x, a.z]);
    }
    // The roadblock: police cars parked across it, a barrier in front.
    // (The cops' own model: buildCar reads only the design's id and the car's size, content/cars/police.json's.
    // Not src/content.ts's list: that's the bundler's, and the skin also builds under the tests.)
    const police = { id: 'police', size: POLICE_SIZE };
    for (const [x, z, h] of ap.cars) {
      const y = curve.getPoint(1).y;
      const car = buildCar(police, { id: 'roadblock', name: 'Police', color: '#15151b', finish: 'gloss' });
      car.root.position.set(x, y, z);
      car.root.rotation.y = h;
      out.push(car.root);
      lights.push(x - 0.3, y + 1.6, z, x + 0.3, y + 1.6, z);
    }
    const [[bx0, bz0], [bx1, bz1]] = ap.barrier;
    const y = curve.getPoint(1).y;
    const len = Math.hypot(bx1 - bx0, bz1 - bz0);
    for (let t = 0; t <= len; t += 2.4) {
      const x = bx0 + ((bx1 - bx0) * t) / len;
      const z = bz0 + ((bz1 - bz0) * t) / len;
      // A sawhorse: two legs, its striped board.
      lines.box(x, z, Math.atan2(bx1 - bx0, bz1 - bz0) + Math.PI / 2, 2, 0.25, y + 0.8, y + 1.15, Math.round(t / 2.4) % 2 ? 0xffffff : 0xff6a1a);
      decks.box(x, z, 0, 0.12, 0.12, y, y + 0.8, 0x444444);
    }
  }
  const merged = mergeGeometries(geos);
  if (merged) out.push(new Mesh(merged, toon({ vertexColors: true })));
  for (const m of [decks.mesh(), lines.mesh()]) if (m) out.push(m);
  if (lights.length) {
    // Red and blue in turn.
    const red: number[] = [];
    const blue: number[] = [];
    for (let k = 0; k < lights.length; k += 3) (k % 6 ? blue : red).push(lights[k], lights[k + 1], lights[k + 2]);
    out.push(glowPoints(red, 0xff2a2a, 3), glowPoints(blue, 0x2a6bff, 3));
  }
  // The Presidio: woods over the land in its box, off the shore, the main road and the approaches.
  const [x0, z0, x1, z1] = sc.presidio;
  const sea = track.layout.ground?.sea ?? 0;
  const rng = new Rng(0x9e51d10);
  const cypress: Part[] = [];
  const gums: Part[] = [];
  const trunks: Part[] = [];
  for (let x = x0; x <= x1; x += 11)
    for (let z = z0; z <= z1; z += 11) {
      const px = x + rng.range(-4, 4);
      const pz = z + rng.range(-4, 4);
      const y = ground.height(px, pz);
      if (y < sea + 1.2 || rng.next() < 0.25) continue;
      if (near.some(([nx, nz]) => Math.abs(nx - px) < 14 && Math.abs(nz - pz) < 14)) continue;
      const h = rng.range(9, 16);
      if (rng.next() < 0.55) cypress.push({ x: px, y, z: pz, yaw: rng.range(0, 6.3), sx: h * 0.3, sy: h, sz: h * 0.3, color: rng.next() < 0.5 ? 0x2f5a3a : 0x3a6640 });
      else {
        trunks.push({ x: px, y, z: pz, yaw: 0, sx: 0.5, sy: h * 0.6, sz: 0.5, color: 0xb8a890 });
        gums.push({ x: px, y: y + h * 0.7, z: pz, yaw: rng.range(0, 6.3), sx: h * 0.28, sy: h * 0.35, sz: h * 0.28, color: rng.next() < 0.5 ? 0x6f8a5c : 0x5f7a52 });
      }
    }
  if (cypress.length) out.push(instanced(faceted(new ConeGeometry(1, 1, 7).translate(0, 0.5, 0)), toon(), cypress));
  if (trunks.length) out.push(instanced(new CylinderGeometry(0.6, 1, 1, 5).translate(0, 0.5, 0), toon(), trunks), instanced(faceted(new IcosahedronGeometry(1, 0)), toon(), gums));
  return out;
}
