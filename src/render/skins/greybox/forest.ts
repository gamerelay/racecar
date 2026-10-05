// Countryside dressing, built from the track and its land: pine forest (dense by the road, thinning
// up the valley walls) with autumn broadleaves, rocks and bushes; the village round the start (houses
// with smoking chimneys, a church, a sawmill, pastures with fences and hay bales) and the barn over
// the Barn shortcut; the covered bridge and the timber trestle (whichever each bridge is); chevron
// boards round every tight corner; telegraph poles and wires along the asphalt; a fire lookout on
// the lap's high point; a campsite by the creek with a fire, embers and fireflies; birds, and mist
// on the river. Everything is instanced or merged, and whatever moves is animated in the shader.

import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../../../core/rng';
import { BENT, BENT_INSET, BENT_LEGS, LEG, type BakedSpline, type Track } from '../../../core/track/bake';
import { animatedPoints, branchSide, canvas, FONT } from './scenery';
import type { Terrain } from './terrain';
import { faceted, toon } from './toon';
import type { Palette } from './palettes';

export interface Forest {
  objects: Object3D[];
  update(time: number, dt: number, camera: Vector3): void;
}

/** One instance: position, a yaw (and optional tilt about the local z axis), and a scale. */
export interface Part {
  x: number;
  y: number;
  z: number;
  yaw: number;
  sx: number;
  sy: number;
  sz: number;
  color: number;
  roll?: number;
  pitch?: number;
}

const m4 = new Matrix4();
const q = new Quaternion();
const q2 = new Quaternion();
const v = new Vector3();
const sv = new Vector3();
const c3 = new Color();
const UP = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);
const Z = new Vector3(0, 0, 1);

export function instanced(geo: BufferGeometry, mat: Material, parts: Part[]): InstancedMesh {
  const mesh = new InstancedMesh(geo, mat, Math.max(1, parts.length));
  parts.forEach((p, k) => {
    q.setFromAxisAngle(UP, p.yaw);
    if (p.pitch) q.multiply(q2.setFromAxisAngle(X, p.pitch));
    if (p.roll) q.multiply(q2.setFromAxisAngle(Z, p.roll));
    m4.compose(v.set(p.x, p.y, p.z), q, sv.set(p.sx, p.sy, p.sz));
    mesh.setMatrixAt(k, m4);
    mesh.setColorAt(k, c3.setHex(p.color));
  });
  mesh.count = parts.length;
  mesh.computeBoundingSphere();
  return mesh;
}

/** A triangular prism (a gable roof, a tent): unit width, height and length, ridge along z, base at y=0. */
export function prism(): BufferGeometry {
  const g = new BufferGeometry();
  const p = [
    // Two slopes, two gable ends (a flat underside isn't seen).
    [-0.5, 0, -0.5, 0, 1, -0.5, 0, 1, 0.5, -0.5, 0, -0.5, 0, 1, 0.5, -0.5, 0, 0.5],
    [0.5, 0, -0.5, 0.5, 0, 0.5, 0, 1, 0.5, 0.5, 0, -0.5, 0, 1, 0.5, 0, 1, -0.5],
    [-0.5, 0, 0.5, 0, 1, 0.5, 0.5, 0, 0.5],
    [0.5, 0, -0.5, 0, 1, -0.5, -0.5, 0, -0.5],
  ].flat();
  g.setAttribute('position', new Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

const PINES = [0x2f5a32, 0x3b6b3a, 0x2a4f36, 0x44683a, 0x335f40];
const LEAVES = [0xd98a2b, 0xc9642a, 0xe0b33a, 0x9a4b2a, 0x7d9a3a, 0xb8552a];
const HOUSES = [0xe9dcc4, 0xc9573f, 0xe4c46a, 0xb9c9c4, 0x9a6a4a, 0xf1ece0];
const ROOFS = [0x4a3a3a, 0x6b3a2a, 0x3a4450, 0x5a4a3a];

/**
 * The countryside round the lap. `marks` is ground the landmarks keep (render/skins/greybox/
 * landmarks.ts): no houses, pastures or trees in it.
 */
export function buildForest(track: Track, palette: Palette, seed: number, land: Terrain, marks: { x: number; z: number; r: number }[] = []): Forest {
  const rng = Rng.stream(seed, 'forest');
  const objects: Object3D[] = [];
  const time = { value: 0 };
  const L = track.main.length;

  // ---- where the roads are ----
  interface S {
    x: number;
    z: number;
    y: number;
    half: number;
  }
  const HC = 20;
  const hash = new Map<number, S[]>();
  const key = (a: number, b: number) => a * 73856093 + b * 19349663;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const sp of track.splines) {
    for (let i = 0; i < sp.n; i += 2) {
      const s = { x: sp.px[i], z: sp.pz[i], y: sp.py[i], half: sp.width[i] / 2 + sp.shoulder[i] };
      const k = key(Math.floor(s.x / HC), Math.floor(s.z / HC));
      let list = hash.get(k);
      if (!list) hash.set(k, (list = []));
      list.push(s);
      x0 = Math.min(x0, s.x);
      x1 = Math.max(x1, s.x);
      z0 = Math.min(z0, s.z);
      z1 = Math.max(z1, s.z);
    }
  }
  /** Meters from (x, z) to the nearest road edge, looking up to ~`reach` (Infinity past it). */
  const roadGap = (x: number, z: number, reach = 40) => {
    const r = Math.ceil(reach / HC);
    const cx = Math.floor(x / HC);
    const cz = Math.floor(z / HC);
    let best = Infinity;
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (const s of hash.get(key(cx + a, cz + b)) ?? []) best = Math.min(best, Math.hypot(s.x - x, s.z - z) - s.half);
    return best;
  };
  /** Height of the nearest road sample within ~40 m (NaN with none). */
  const roadY = (x: number, z: number) => {
    const cx = Math.floor(x / HC);
    const cz = Math.floor(z / HC);
    let best = Infinity;
    let y = NaN;
    for (let a = -2; a <= 2; a++) {
      for (let b = -2; b <= 2; b++) {
        for (const s of hash.get(key(cx + a, cz + b)) ?? []) {
          const d = Math.hypot(s.x - x, s.z - z) - s.half;
          if (d < best) {
            best = d;
            y = s.y;
          }
        }
      }
    }
    return y;
  };
  const wet = (x: number, z: number, margin = 3) => land.river(x, z) < land.riverHalf + margin;
  /** Circles kept clear of trees (buildings, fields, the campsite). */
  const keep: { x: number; z: number; r: number }[] = [...marks];
  const kept = (x: number, z: number) => keep.some((k) => (k.x - x) ** 2 + (k.z - z) ** 2 < k.r * k.r);
  /** Whether something `r` m round (x, z) would reach into a landmark's ground. */
  const onMark = (x: number, z: number, r: number) => marks.some((k) => Math.hypot(k.x - x, k.z - z) < k.r + r);
  const at = (sp: BakedSpline, s: number) => Math.max(0, Math.min(sp.n - 1, Math.round(s / sp.step)));

  // ---- the village: houses along the road either side of the start ----
  const houses: Part[] = [];
  /** Timber and hay that shouldn't get windows: barn walls, posts, stacks. */
  const plain: Part[] = [];
  const roofs: Part[] = [];
  const chimneys: Part[] = [];
  const smoke: { pos: number[]; phase: number[]; col: number[] } = { pos: [], phase: [], col: [] };
  const puff = (x: number, y: number, z: number, n: number, color: [number, number, number]) => {
    for (let k = 0; k < n; k++) {
      smoke.pos.push(x, y, z);
      smoke.phase.push(k / n + rng.next() * 0.03);
      smoke.col.push(...color);
    }
  };
  const house = (x: number, z: number, yaw: number, w: number, d: number, h: number, color: number, chimney: boolean) => {
    if (onMark(x, z, Math.max(w, d) * 0.7)) return;
    const y = land.height(x, z) - 0.3;
    houses.push({ x, y: y + h / 2, z, yaw, sx: w, sy: h, sz: d, color });
    roofs.push({ x, y: y + h, z, yaw, sx: w * 1.12, sy: w * 0.45, sz: d * 1.08, color: ROOFS[Math.floor(rng.next() * ROOFS.length)] });
    keep.push({ x, z, r: Math.max(w, d) * 0.8 + 3 });
    if (chimney) {
      const cx = x + Math.cos(yaw) * w * 0.25;
      const cz = z - Math.sin(yaw) * w * 0.25;
      chimneys.push({ x: cx, y: y + h + w * 0.35, z: cz, yaw, sx: 0.8, sy: w * 0.5, sz: 0.8, color: 0x7a5a4a });
      puff(cx, y + h + w * 0.55, cz, 22, [0.86, 0.84, 0.82]);
    }
  };
  const main = track.main;
  const villageS: number[] = [];
  for (let s = -130; s < 300; s += 9) villageS.push((s + L) % L);
  for (const s of villageS) {
    const i = at(main, s);
    for (const side of [-1, 1]) {
      if (rng.next() < 0.45) continue;
      const off = main.width[i] / 2 + main.shoulder[i] + rng.range(7, 13);
      const x = main.px[i] - main.tz[i] * off * side;
      const z = main.pz[i] + main.tx[i] * off * side;
      const w = rng.range(6, 9);
      const d = rng.range(7, 11);
      if (roadGap(x, z) < Math.max(w, d) * 0.6 + 2 || wet(x, z, 8) || kept(x, z)) continue;
      house(x, z, Math.atan2(main.tx[i], main.tz[i]), w, d, rng.range(3.6, 5.2), HOUSES[Math.floor(rng.next() * HOUSES.length)], rng.next() < 0.6);
    }
  }
  // The church: tall, white, a steeple, set back from the village square.
  {
    const i = at(main, 170);
    const off = main.width[i] / 2 + main.shoulder[i] + 22;
    for (const side of [1, -1]) {
      const x = main.px[i] - main.tz[i] * off * side;
      const z = main.pz[i] + main.tx[i] * off * side;
      if (roadGap(x, z) < 12 || wet(x, z, 10)) continue;
      const yaw = Math.atan2(main.tx[i], main.tz[i]);
      house(x, z, yaw, 9, 16, 7, 0xf1ece0, false);
      const y = land.height(x, z) - 0.3;
      const tx = x + Math.sin(yaw) * 9;
      const tz = z + Math.cos(yaw) * 9;
      houses.push({ x: tx, y: y + 7, z: tz, yaw, sx: 4, sy: 14, sz: 4, color: 0xf1ece0 });
      objects.push(instanced(faceted(new ConeGeometry(0.72, 1, 4).translate(0, 0.5, 0)), toon(), [{ x: tx, y: y + 14, z: tz, yaw: yaw + Math.PI / 4, sx: 4, sy: 8, sz: 4, color: 0x4a3a3a }]));
      keep.push({ x: tx, z: tz, r: 5 });
      break;
    }
  }

  // ---- the barn over the Barn shortcut ----
  const barnSp = track.splines.find((sp) => sp.id === 'barn');
  if (barnSp) {
    const i = at(barnSp, barnSp.length / 2);
    const yaw = Math.atan2(barnSp.tx[i], barnSp.tz[i]);
    const half = barnSp.width[i] / 2 + barnSp.shoulder[i] + 0.8;
    const y = barnSp.py[i];
    const len = 28;
    for (const side of [-1, 1]) {
      plain.push({ x: barnSp.px[i] - barnSp.tz[i] * half * side, y: y + 3, z: barnSp.pz[i] + barnSp.tx[i] * half * side, yaw, sx: 0.6, sy: 6, sz: len, color: 0xa8382e });
    }
    roofs.push({ x: barnSp.px[i], y: y + 6, z: barnSp.pz[i], yaw, sx: half * 2 + 2, sy: 4.5, sz: len + 1.5, color: 0x4a3a3a });
    keep.push({ x: barnSp.px[i], z: barnSp.pz[i], r: len * 0.7 });
    // Hay inside, either side of the way through.
    for (const side of [-1, 1]) for (let k = -2; k <= 2; k += 2) plain.push({ x: barnSp.px[i] - barnSp.tz[i] * (half - 1.6) * side + barnSp.tx[i] * k * 4, y: y + 0.6, z: barnSp.pz[i] + barnSp.tx[i] * (half - 1.6) * side + barnSp.tz[i] * k * 4, yaw, sx: 1.4, sy: 1.2, sz: 2.4, color: 0xd9b75a });
  }

  // ---- the sawmill by the start: a long open shed, log piles, a smokestack ----
  const logs: Part[] = [];
  const pile = (x: number, z: number, yaw: number, rows: number, len: number) => {
    const y = land.height(x, z) - 0.1;
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < rows - r; k++) {
        const across = (k - (rows - r - 1) / 2) * 0.72;
        logs.push({ x: x + Math.cos(yaw) * across, y: y + 0.36 + r * 0.62, z: z - Math.sin(yaw) * across, yaw, sx: 0.36, sy: len, sz: 0.36, color: [0x8a5a33, 0x9a6a3e, 0x7a4f2e][Math.floor(rng.next() * 3)], pitch: Math.PI / 2 });
      }
    }
    keep.push({ x, z, r: len / 2 + 3 });
  };
  {
    const i = at(main, (L - 70) % L);
    for (const side of [1, -1]) {
      const off = main.width[i] / 2 + main.shoulder[i] + 16;
      const x = main.px[i] - main.tz[i] * off * side;
      const z = main.pz[i] + main.tx[i] * off * side;
      if (roadGap(x, z) < 12 || wet(x, z, 8)) continue;
      const yaw = Math.atan2(main.tx[i], main.tz[i]);
      const y = land.height(x, z) - 0.3;
      // Open shed: posts and a roof.
      for (const a of [-1, 1]) for (const b of [-1, 0, 1]) plain.push({ x: x + Math.cos(yaw) * a * 5 + Math.sin(yaw) * b * 9, y: y + 2.5, z: z - Math.sin(yaw) * a * 5 + Math.cos(yaw) * b * 9, yaw, sx: 0.5, sy: 5, sz: 0.5, color: 0x5e4630 });
      roofs.push({ x, y: y + 5, z, yaw, sx: 12, sy: 2.4, sz: 21, color: 0x6a6f75 });
      plain.push({ x: x + Math.cos(yaw) * 8, y: y + 6, z: z - Math.sin(yaw) * 8, yaw, sx: 1.2, sy: 12, sz: 1.2, color: 0x6b4a3a });
      puff(x + Math.cos(yaw) * 8, y + 12.5, z - Math.sin(yaw) * 8, 26, [0.7, 0.68, 0.66]);
      keep.push({ x, z, r: 15 });
      pile(x + Math.sin(yaw) * 17, z + Math.cos(yaw) * 17, yaw, 4, 8);
      pile(x - Math.sin(yaw) * 17 + Math.cos(yaw) * 3, z - Math.cos(yaw) * 17 - Math.sin(yaw) * 3, yaw + 0.2, 3, 7);
      break;
    }
  }

  // ---- pastures by the village: fences and hay bales ----
  const fence: Part[] = [];
  const bales: Part[] = [];
  for (let n = 0, tries = 0; n < 3 && tries < 40; tries++) {
    const s = villageS[Math.floor(rng.next() * villageS.length)];
    const i = at(main, s);
    const side = rng.next() < 0.5 ? -1 : 1;
    const off = main.width[i] / 2 + main.shoulder[i] + rng.range(34, 60);
    const cx = main.px[i] - main.tz[i] * off * side;
    const cz = main.pz[i] + main.tx[i] * off * side;
    const w = rng.range(36, 56);
    const d = rng.range(30, 48);
    const r = Math.hypot(w, d) / 2;
    if (roadGap(cx, cz, 60) < r + 4 || wet(cx, cz, r + 6) || kept(cx, cz) || onMark(cx, cz, r)) continue;
    n++;
    const yaw = Math.atan2(main.tx[i], main.tz[i]);
    keep.push({ x: cx, z: cz, r: r + 2 });
    const corner = (u: number, t: number) => [cx + Math.cos(yaw) * u + Math.sin(yaw) * t, cz - Math.sin(yaw) * u + Math.cos(yaw) * t];
    const edges: [number, number, number, number][] = [
      [-w / 2, -d / 2, w / 2, -d / 2],
      [w / 2, -d / 2, w / 2, d / 2],
      [w / 2, d / 2, -w / 2, d / 2],
      [-w / 2, d / 2, -w / 2, -d / 2],
    ];
    for (const [u0, t0, u1, t1] of edges) {
      const len = Math.hypot(u1 - u0, t1 - t0);
      const steps = Math.ceil(len / 3);
      for (let k = 0; k < steps; k++) {
        const [ax, az] = corner(u0 + ((u1 - u0) * k) / steps, t0 + ((t1 - t0) * k) / steps);
        const [bx, bz] = corner(u0 + ((u1 - u0) * (k + 1)) / steps, t0 + ((t1 - t0) * (k + 1)) / steps);
        const ya = land.height(ax, az);
        const yb = land.height(bx, bz);
        const ryaw = Math.atan2(bx - ax, bz - az);
        const pitch = -Math.atan2(yb - ya, Math.hypot(bx - ax, bz - az));
        fence.push({ x: ax, y: ya + 0.6, z: az, yaw: ryaw, sx: 0.18, sy: 1.2, sz: 0.18, color: 0x6b553b });
        for (const hgt of [0.55, 1.0]) fence.push({ x: (ax + bx) / 2, y: (ya + yb) / 2 + hgt, z: (az + bz) / 2, yaw: ryaw, sx: 0.08, sy: 0.12, sz: Math.hypot(bx - ax, bz - az, yb - ya), color: 0x8a6d4a, pitch });
      }
    }
    for (let k = 0; k < 7; k++) {
      const [bx, bz] = corner(rng.range(-w / 2 + 4, w / 2 - 4), rng.range(-d / 2 + 4, d / 2 - 4));
      bales.push({ x: bx, y: land.height(bx, bz) + 0.55, z: bz, yaw: rng.range(0, Math.PI), sx: 0.75, sy: 1.5, sz: 0.75, color: [0xd9b75a, 0xc9a44a, 0xe2c36a][k % 3], roll: Math.PI / 2 });
    }
  }

  // ---- bridges: covered (short, over the river) or a timber trestle (long, high) ----
  const timber: Part[] = [];
  // The legs the sim made solid, where the Trestle stands on the road beneath it: drawn as they
  // collide, from the road up.
  const standing = track.props.filter((p) => p.kind === 'trestle-leg');
  const onRoad = (x: number, z: number) => standing.find((p) => Math.abs(p.x - x) < 0.05 && Math.abs(p.z - z) < 0.05);
  for (const sp of track.splines) {
    const deck = land.deck[sp.index];
    let i = 0;
    while (i < sp.n) {
      if (!deck[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < sp.n && deck[j]) j++;
      const len = (j - i) * sp.step;
      const mid = Math.floor((i + j) / 2);
      const drop = sp.py[mid] - land.height(sp.px[mid], sp.pz[mid]);
      if (len < 140 && drop < 10) coveredBridge(sp, i, j);
      else trestle(sp, i, j);
      i = j;
    }
  }
  function coveredBridge(sp: BakedSpline, i0: number, i1: number): void {
    const step = Math.max(1, Math.round(4 / sp.step));
    for (let i = i0 + step; i < i1 - step; i += step) {
      const yaw = Math.atan2(sp.tx[i], sp.tz[i]);
      const half = sp.width[i] / 2 + sp.shoulder[i] + 0.4;
      const y = sp.py[i];
      const seg = step * sp.step + 0.1;
      for (const side of [-1, 1]) {
        const x = sp.px[i] - sp.tz[i] * half * side;
        const z = sp.pz[i] + sp.tx[i] * half * side;
        // Siding above a window band, and posts.
        timber.push({ x, y: y + 4, z, yaw, sx: 0.3, sy: 2.2, sz: seg, color: 0xa8382e });
        timber.push({ x, y: y + 1.3, z, yaw, sx: 0.32, sy: 0.35, sz: seg, color: 0x8a2e28 });
        if ((i / step) % 2 === 0) timber.push({ x, y: y + 2.5, z, yaw, sx: 0.4, sy: 5, sz: 0.4, color: 0x5e4630 });
      }
      roofs.push({ x: sp.px[i], y: y + 5.1, z: sp.pz[i], yaw, sx: half * 2 + 1.6, sy: 2.6, sz: seg, color: 0x4a3a3a });
    }
  }
  function trestle(sp: BakedSpline, i0: number, i1: number): void {
    // Bents on the sim's grid (BENT), so the legs it made solid are these.
    const step = Math.max(1, Math.round(BENT / sp.step));
    for (let i = Math.ceil((i0 + step / 2) / step) * step; i < i1; i += step) {
      const yaw = Math.atan2(sp.tx[i], sp.tz[i]);
      const top = sp.py[i] - 1.2;
      const half = sp.width[i] / 2 + sp.shoulder[i] - BENT_INSET;
      const rx = -sp.tz[i];
      const rz = sp.tx[i];
      const legs: [number, number, number][] = [];
      // Cross beams stay clear of a road underneath.
      let floor = -Infinity;
      for (const f of BENT_LEGS) {
        const x = sp.px[i] + rx * half * f;
        const z = sp.pz[i] + rz * half * f;
        const solid = onRoad(x, z);
        if (solid) {
          floor = Math.max(floor, solid.y + 5);
          legs.push([x, z, solid.y]);
          continue;
        }
        const g = Math.min(land.height(x, z), land.riverY - 1);
        legs.push([x, z, land.height(x, z) > land.riverY ? land.height(x, z) : g]);
      }
      const low = Math.min(...legs.map((l) => l[2]));
      if (top - low < 2) continue;
      for (const [x, z, g] of legs) {
        const w = onRoad(x, z) ? LEG * 2 : 0.55;
        timber.push({ x, y: (top + g) / 2, z, yaw, sx: w, sy: top - g, sz: w, color: 0x5e4630 });
      }
      // Cross beams every 5 m down, and an X brace between each pair.
      const bottom = Math.max(low + 1, floor);
      for (let y = top - 0.3; y > bottom; y -= 5) {
        timber.push({ x: sp.px[i], y, z: sp.pz[i], yaw: yaw + Math.PI / 2, sx: 0.35, sy: 0.35, sz: half * 2 + 0.6, color: 0x6e5236 });
        if (y - 5 > bottom) {
          const a = Math.atan2(5, half * 2);
          for (const sgn of [-1, 1]) timber.push({ x: sp.px[i], y: y - 2.5, z: sp.pz[i], yaw: yaw + Math.PI / 2, sx: 0.22, sy: 0.22, sz: Math.hypot(5, half * 2), color: 0x7a5c3c, pitch: sgn * a });
        }
      }
      // Stringers along the road under the deck.
      timber.push({ x: sp.px[i], y: top + 0.2, z: sp.pz[i], yaw, sx: half * 2, sy: 0.5, sz: step * sp.step, color: 0x4a3626 });
    }
  }

  // ---- chevron boards round every tight corner; telegraph poles along the asphalt ----
  const chevR: Part[] = [];
  const chevL: Part[] = [];
  const posts: Part[] = [];
  for (const sp of track.splines) {
    const span = Math.round(10 / sp.step);
    let last = -Infinity;
    for (let i = span; i < sp.n - span; i += Math.max(1, Math.round(3 / sp.step))) {
      const h0 = Math.atan2(sp.tx[i - span], sp.tz[i - span]);
      const h1 = Math.atan2(sp.tx[i + span], sp.tz[i + span]);
      let turn = h1 - h0;
      while (turn > Math.PI) turn -= 2 * Math.PI;
      while (turn < -Math.PI) turn += 2 * Math.PI;
      const radius = (2 * span * sp.step) / Math.max(1e-6, Math.abs(turn));
      if (radius > 35 || i * sp.step - last < 7 || land.deck[sp.index][i]) continue;
      last = i * sp.step;
      // Heading grows to the left, so a positive turn is a left-hander: boards go on the right.
      const side = turn > 0 ? 1 : -1;
      const off = sp.width[i] / 2 + sp.shoulder[i] + 1.2;
      const x = sp.px[i] - sp.tz[i] * off * side;
      const z = sp.pz[i] + sp.tx[i] * off * side;
      const y = Math.max(land.height(x, z), sp.py[i] - 1);
      // The board faces the drivers coming into the corner.
      const yaw = Math.atan2(sp.tx[i], sp.tz[i]) + Math.PI;
      (turn > 0 ? chevL : chevR).push({ x, y: y + 1.9, z, yaw, sx: 2.1, sy: 1.4, sz: 1, color: 0xffffff });
      posts.push({ x, y: y + 0.7, z, yaw, sx: 0.14, sy: 1.4, sz: 0.14, color: 0x5e4630 });
    }
  }
  const chevronTex = canvas(128, 96, (g) => {
    g.fillStyle = '#ffd23f';
    g.fillRect(0, 0, 128, 96);
    g.fillStyle = '#1a1410';
    for (const dx of [0, 40]) {
      g.beginPath();
      g.moveTo(18 + dx, 14);
      g.lineTo(50 + dx, 48);
      g.lineTo(18 + dx, 82);
      g.lineTo(36 + dx, 82);
      g.lineTo(68 + dx, 48);
      g.lineTo(36 + dx, 14);
      g.fill();
    }
  });
  const board = new PlaneGeometry(1, 1);
  const chevMat = new MeshBasicMaterial({ map: chevronTex, side: DoubleSide });
  if (chevR.length) objects.push(instanced(board, chevMat, chevR));
  // Left-handers: the same board mirrored.
  if (chevL.length) objects.push(instanced(board, chevMat, chevL.map((p) => ({ ...p, sx: -p.sx }))));

  const poles: Part[] = [];
  const wires: number[] = [];
  {
    let prev: [number, number, number] | null = null;
    for (let s = 20; s < L; s += 42) {
      const i = at(main, s);
      if (track.surfaces[main.surface[i]].offroad || land.deck[0][i]) {
        prev = null;
        continue;
      }
      const off = main.width[i] / 2 + main.shoulder[i] + 3.5;
      const x = main.px[i] + main.tz[i] * off;
      const z = main.pz[i] - main.tx[i] * off;
      if (wet(x, z, 2) || roadGap(x, z) < 2.5) {
        prev = null;
        continue;
      }
      const y = land.height(x, z);
      const yaw = Math.atan2(main.tx[i], main.tz[i]);
      poles.push({ x, y: y + 4.5, z, yaw, sx: 0.28, sy: 9, sz: 0.28, color: 0x5e4630 });
      poles.push({ x, y: y + 8.6, z, yaw: yaw + Math.PI / 2, sx: 0.16, sy: 0.16, sz: 2.4, color: 0x5e4630 });
      const top: [number, number, number] = [x, y + 8.75, z];
      if (prev) {
        // Two wires sagging between poles, in four segments each.
        for (const o of [-0.9, 0.9]) {
          const ox = Math.cos(yaw) * o;
          const oz = -Math.sin(yaw) * o;
          for (let k = 0; k < 4; k++) {
            const a = k / 4;
            const b = (k + 1) / 4;
            const pt = (t: number) => [prev![0] + (top[0] - prev![0]) * t + ox, prev![1] + (top[1] - prev![1]) * t - Math.sin(Math.PI * t) * 1.1, prev![2] + (top[2] - prev![2]) * t + oz];
            wires.push(...pt(a), ...pt(b));
          }
        }
      }
      prev = top;
    }
  }
  if (wires.length) {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(wires, 3));
    objects.push(new LineSegments(g, new LineBasicMaterial({ color: 0x2a1c14 })));
  }

  // ---- the fire lookout on the lap's high point ----
  {
    let top = 0;
    for (let i = 0; i < main.n; i++) if (main.py[i] > main.py[top]) top = i;
    for (const side of [1, -1]) {
      const off = main.width[top] / 2 + main.shoulder[top] + 20;
      const x = main.px[top] - main.tz[top] * off * side;
      const z = main.pz[top] + main.tx[top] * off * side;
      if (roadGap(x, z) < 14) continue;
      const g = land.height(x, z) - 0.3;
      const yaw = Math.atan2(main.tx[top], main.tz[top]);
      for (const a of [-1, 1]) for (const b of [-1, 1]) timber.push({ x: x + a * 2.2, y: g + 7, z: z + b * 2.2, yaw: 0, sx: 0.35, sy: 14, sz: 0.35, color: 0x5e4630 });
      for (const hgt of [4, 9]) {
        timber.push({ x, y: g + hgt, z: z - 2.2, yaw: 0, sx: 4.6, sy: 0.25, sz: 0.25, color: 0x6e5236 });
        timber.push({ x, y: g + hgt, z: z + 2.2, yaw: 0, sx: 4.6, sy: 0.25, sz: 0.25, color: 0x6e5236 });
      }
      houses.push({ x, y: g + 15.5, z, yaw, sx: 5.5, sy: 3, sz: 5.5, color: 0xe9dcc4 });
      roofs.push({ x, y: g + 17, z, yaw, sx: 6.5, sy: 2, sz: 6.5, color: 0x6b3a2a });
      keep.push({ x, z, r: 7 });
      break;
    }
  }

  // ---- the campsite by the creek: tents, a fire with embers and smoke, fireflies round the Hollow ----
  const tents: Part[] = [];
  const embers: { pos: number[]; phase: number[]; col: number[] } = { pos: [], phase: [], col: [] };
  const creekSp = track.splines.find((sp) => sp.id === 'creek');
  const fireflies: { pos: number[]; phase: number[]; col: number[] } = { pos: [], phase: [], col: [] };
  if (creekSp) {
    const i = at(creekSp, creekSp.length * 0.3);
    for (const side of [1, -1]) {
      const off = creekSp.width[i] / 2 + creekSp.shoulder[i] + 16;
      const x = creekSp.px[i] - creekSp.tz[i] * off * side;
      const z = creekSp.pz[i] + creekSp.tx[i] * off * side;
      if (roadGap(x, z) < 10) continue;
      const g = land.height(x, z);
      keep.push({ x, z, r: 12 });
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.4;
        const tx = x + Math.cos(a) * 6;
        const tz = z + Math.sin(a) * 6;
        tents.push({ x: tx, y: land.height(tx, tz) - 0.1, z: tz, yaw: a + Math.PI / 2, sx: 2.6, sy: 1.8, sz: 3, color: [0xe07a2a, 0x3a86c8, 0x6aa84a][k] });
      }
      for (let k = 0; k < 5; k++) logs.push({ x: x + Math.cos(k * 1.26) * 0.5, y: g + 0.2, z: z + Math.sin(k * 1.26) * 0.5, yaw: k * 1.26, sx: 0.14, sy: 1.3, sz: 0.14, color: 0x5a3a24, pitch: Math.PI / 2 - 0.25 });
      for (let k = 0; k < 30; k++) {
        embers.pos.push(x, g + 0.5, z);
        embers.phase.push(k / 30 + rng.next() * 0.05);
        embers.col.push(1, 0.55 + rng.next() * 0.3, 0.15);
      }
      puff(x, g + 1, z, 24, [0.62, 0.6, 0.58]);
      break;
    }
  }
  // Fireflies: swarms along the low dirt roads (the Hollow, the creek).
  for (const sp of track.splines) {
    for (let s = 0; s < sp.length; s += 45) {
      const i = at(sp, s);
      if (!track.surfaces[sp.surface[i]].offroad || sp.py[i] > 9 || rng.next() < 0.4) continue;
      const side = rng.next() < 0.5 ? -1 : 1;
      const off = sp.width[i] / 2 + sp.shoulder[i] + rng.range(6, 18);
      const x = sp.px[i] - sp.tz[i] * off * side;
      const z = sp.pz[i] + sp.tx[i] * off * side;
      const g = land.height(x, z);
      for (let k = 0; k < 10; k++) {
        fireflies.pos.push(x + rng.range(-5, 5), g + rng.range(0.8, 2.6), z + rng.range(-5, 5));
        fireflies.phase.push(rng.next());
        fireflies.col.push(0.85, 1, 0.45);
      }
    }
  }

  // ---- trees, rocks and bushes ----
  const pines: Part[] = [];
  const farPines: Part[] = [];
  const broad: Part[] = [];
  const rocks: Part[] = [];
  const bushes: Part[] = [];
  // Low-frequency noise for where the forest opens into clearings (> 0) and closes up (< 0).
  const clump = (x: number, z: number) => Math.sin(x / 57 + seed) * Math.cos(z / 49 - seed) + 0.5 * Math.sin((x + z) / 31);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rng.next() * list.length)];
  const plant = (x: number, z: number, near: boolean, gap: number) => {
    if (wet(x, z, 4) || kept(x, z)) return;
    const y = land.height(x, z);
    const sc = rng.range(0.6, 1.2) * (near ? 1 : 1.15);
    const yaw = rng.range(0, Math.PI * 2);
    // Broadleaves in the low ground near the roads; pines everywhere else.
    if (near && y < 12 && rng.next() < 0.22) broad.push({ x, y: y - 0.3, z, yaw, sx: sc, sy: sc, sz: sc, color: pick(LEAVES) });
    else (near ? pines : farPines).push({ x, y: y - 0.4, z, yaw, sx: sc, sy: sc * rng.range(0.9, 1.25), sz: sc, color: pick(PINES) });
    if (near && gap < 30 && rng.next() < 0.06) rocks.push({ x: x + rng.range(-3, 3), y: y - 0.3, z: z + rng.range(-3, 3), yaw, sx: rng.range(0.8, 2.2), sy: rng.range(0.6, 1.6), sz: rng.range(0.8, 2.2), color: pick([0x8a8074, 0x7a7064, 0x958b7c]), roll: rng.range(-0.3, 0.3) });
  };
  // Near the roads, thick forest on a 7 m jittered grid, kept back from the verge.
  const NEAR = 150;
  for (let z = z0 - NEAR; z < z1 + NEAR; z += 7) {
    for (let x = x0 - NEAR; x < x1 + NEAR; x += 7) {
      const px = x + rng.range(-3, 3);
      const pz = z + rng.range(-3, 3);
      const gap = roadGap(px, pz, 60);
      if (gap === Infinity) continue;
      if (gap < 6) {
        // The verge: bushes and the odd rock, never on the road.
        if (gap > 2.5 && rng.next() < 0.18) bushes.push({ x: px, y: land.height(px, pz) - 0.2, z: pz, yaw: rng.range(0, 6), sx: rng.range(0.8, 1.6), sy: rng.range(0.6, 1.1), sz: rng.range(0.8, 1.6), color: pick([0x4a6d34, 0x5b7f36, 0x6a8a3a]) });
        continue;
      }
      if (rng.next() < 0.45 * Math.max(0, clump(px, pz))) continue;
      // Thin by the road, thick further in; and mostly open where the land falls away from the
      // road (the ridge, the switchbacks' downhill side), so you see down into the valley.
      if (rng.next() < (gap < 14 ? 0.55 : 0.2)) continue;
      const below = roadY(px, pz) - land.height(px, pz);
      if (below > 3 && rng.next() < Math.min(0.85, below / 10)) continue;
      plant(px, pz, true, gap);
    }
  }
  // Out to the valley walls: a coarser, taller forest.
  const FAR = 650;
  for (let z = z0 - FAR; z < z1 + FAR; z += 17) {
    for (let x = x0 - FAR; x < x1 + FAR; x += 17) {
      const px = x + rng.range(-7, 7);
      const pz = z + rng.range(-7, 7);
      // Clumps and clearings, so the lie of the land shows through.
      if (roadGap(px, pz, 60) < 62 || rng.next() < 0.3 + 0.5 * Math.max(0, clump(px, pz))) continue;
      plant(px, pz, false, Infinity);
    }
  }
  // Boulders on the ridge and the valley walls.
  for (let k = 0; k < 160; k++) {
    const x = rng.range(x0 - 300, x1 + 300);
    const z = rng.range(z0 - 300, z1 + 300);
    const gap = roadGap(x, z, 40);
    if (gap < 8 || wet(x, z, 4) || kept(x, z)) continue;
    const y = land.height(x, z);
    const s = rng.range(2, 6);
    rocks.push({ x, y: y - s * 0.3, z, yaw: rng.range(0, 6), sx: s * rng.range(0.8, 1.4), sy: s * rng.range(0.5, 0.9), sz: s * rng.range(0.8, 1.4), color: pick([0x8a8074, 0x7a7064, 0x958b7c]), roll: rng.range(-0.2, 0.2) });
  }
  // Log piles by the dirt roads (a logging forest), and at the top of any jump shortcut.
  for (const sp of track.splines) {
    for (let s = 60; s < sp.length; s += 260) {
      const i = at(sp, s);
      if (!track.surfaces[sp.surface[i]].offroad) continue;
      const side = rng.next() < 0.5 ? -1 : 1;
      const off = sp.width[i] / 2 + sp.shoulder[i] + 4;
      const x = sp.px[i] - sp.tz[i] * off * side;
      const z = sp.pz[i] + sp.tx[i] * off * side;
      if (roadGap(x, z) < 3 || wet(x, z)) continue;
      pile(x, z, Math.atan2(sp.tx[i], sp.tz[i]), 3, 6);
    }
  }

  // A sign at each shortcut's mouth, facing the drivers coming up to it.
  {
    const names: Record<string, string> = { barn: 'THE BARN', leap: "LOGGER'S LEAP", creek: 'CREEK BED' };
    for (const sp of track.splines.slice(1)) {
      // (Off the main road: a lane off another branch has none.)
      if (sp.fromRoad !== 0) continue;
      const i = at(main, (sp.mainFrom - 25 + L) % L);
      const side = branchSide(main, sp);
      const off = main.width[i] / 2 + main.shoulder[i] + 2;
      const x = main.px[i] - main.tz[i] * off * side;
      const z = main.pz[i] + main.tx[i] * off * side;
      const y = Math.max(land.height(x, z), main.py[i] - 1);
      const tex = canvas(256, 96, (g) => {
        g.fillStyle = '#6b4a2e';
        g.fillRect(0, 0, 256, 96);
        g.strokeStyle = '#3a2618';
        g.lineWidth = 8;
        g.strokeRect(4, 4, 248, 88);
        g.fillStyle = '#f4e6c8';
        g.font = `34px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(`${side > 0 ? '' : '◀ '}${names[sp.id] ?? sp.id.toUpperCase()}${side > 0 ? ' ▶' : ''}`, 128, 50);
      });
      const sign = new Mesh(new PlaneGeometry(4, 1.5), new MeshBasicMaterial({ map: tex, side: DoubleSide }));
      sign.position.set(x, y + 2.4, z);
      sign.rotation.y = Math.atan2(main.tx[i], main.tz[i]) + Math.PI;
      objects.push(sign);
      posts.push({ x: x - Math.cos(sign.rotation.y) * 1.6, y: y + 1, z: z + Math.sin(sign.rotation.y) * 1.6, yaw: 0, sx: 0.18, sy: 2, sz: 0.18, color: 0x5e4630 });
      posts.push({ x: x + Math.cos(sign.rotation.y) * 1.6, y: y + 1, z: z - Math.sin(sign.rotation.y) * 1.6, yaw: 0, sx: 0.18, sy: 2, sz: 0.18, color: 0x5e4630 });
    }
  }


  // ---- meshes ----
  const pineGeo = mergeGeometries([
    faceted(new ConeGeometry(2.6, 5.2, 7).translate(0, 4.2, 0)),
    faceted(new ConeGeometry(2.0, 4.4, 7).translate(0, 6.8, 0)),
    faceted(new ConeGeometry(1.3, 3.4, 7).translate(0, 9.0, 0)),
  ])!;
  const trunkGeo = new BoxGeometry(0.45, 2.4, 0.45).translate(0, 1.2, 0);
  const trunkMat = toon({ color: 0x5a3f2a });
  const tint = toon();
  objects.push(instanced(pineGeo, tint, pines), instanced(trunkGeo, trunkMat, pines));
  objects.push(instanced(faceted(new ConeGeometry(2.8, 11, 6).translate(0, 6, 0)), tint, farPines));
  const crown = faceted(new IcosahedronGeometry(2.6, 0).translate(0, 5.2, 0));
  objects.push(instanced(crown, tint, broad), instanced(trunkGeo, trunkMat, broad));
  objects.push(instanced(faceted(new IcosahedronGeometry(1, 0)), tint, rocks));
  objects.push(instanced(faceted(new IcosahedronGeometry(0.9, 0).translate(0, 0.5, 0)), tint, bushes));
  const unit = new BoxGeometry(1, 1, 1);
  objects.push(instanced(unit, toon({ map: houseTexture() }), houses), instanced(unit, tint, plain), instanced(prism(), toon({ side: DoubleSide }), roofs), instanced(unit, tint, chimneys));
  objects.push(instanced(unit, tint, timber), instanced(unit, tint, fence), instanced(unit, tint, posts), instanced(unit, tint, poles));
  objects.push(instanced(new CylinderGeometry(1, 1, 1, 8), tint, logs), instanced(new CylinderGeometry(1, 1, 1, 10), tint, bales));
  objects.push(instanced(prism(), toon({ side: DoubleSide }), tents));
  if (smoke.pos.length) objects.push(animatedPoints(smoke.pos, smoke.phase, smoke.col, 'smoke', 3, time));
  if (embers.pos.length) objects.push(animatedPoints(embers.pos, embers.phase, embers.col, 'ember', 0.35, time));
  if (fireflies.pos.length) objects.push(animatedPoints(fireflies.pos, fireflies.phase, fireflies.col, 'firefly', 0.3, time));
  // Birds: flocks over the high point, the river and the Hollow.
  {
    const pos: number[] = [];
    const phase: number[] = [];
    const col: number[] = [];
    const flock = (x: number, z: number, y: number) => {
      for (let k = 0; k < 9; k++) {
        pos.push(x, y, z);
        phase.push(rng.next());
        col.push(0.16, 0.12, 0.1);
      }
    };
    let top = 0;
    for (let i = 0; i < main.n; i++) if (main.py[i] > main.py[top]) top = i;
    flock(main.px[top] + 60, main.pz[top], main.py[top] + 45);
    const river = track.layout.terrain?.river;
    if (river) flock(river[Math.floor(river.length / 2)][0], river[Math.floor(river.length / 2)][1], land.riverY + 40);
    flock((x0 + x1) / 2 - 150, (z0 + z1) / 2 - 150, 40);
    objects.push(animatedPoints(pos, phase, col, 'bird', 1.1, time));
  }
  // Mist lying on the river.
  const river = track.layout.terrain?.river;
  if (river) {
    const pos: number[] = [];
    const phase: number[] = [];
    const col: number[] = [];
    for (let k = 0; k + 1 < river.length; k++) {
      for (let n = 0; n < 6; n++) {
        const t = rng.next();
        pos.push(river[k][0] + (river[k + 1][0] - river[k][0]) * t, land.riverY + 2, river[k][1] + (river[k + 1][1] - river[k][1]) * t);
        phase.push(rng.next());
        const f = new Color(palette.fog);
        col.push(f.r, f.g, f.b);
      }
    }
    objects.push(animatedPoints(pos, phase, col, 'mist', 26, time));
  }

  return {
    objects,
    update(t) {
      time.value = t;
    },
  };
}

/** A house wall: white (the instance color tints it), two framed windows over a door and a sill line. */
export function houseTexture() {
  return canvas(128, 128, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 128, 128);
    // Clapboard lines.
    g.fillStyle = 'rgba(0,0,0,0.07)';
    for (let y = 6; y < 128; y += 10) g.fillRect(0, y, 128, 2);
    const pane = (x: number, y: number) => {
      g.fillStyle = '#f7f1e3';
      g.fillRect(x - 4, y - 4, 32, 36);
      g.fillStyle = '#2b3550';
      g.fillRect(x, y, 24, 28);
      g.fillStyle = '#ffd98a';
      g.fillRect(x + 2, y + 2, 9, 11);
      g.fillStyle = '#f7f1e3';
      g.fillRect(x + 11, y, 2, 28);
      g.fillRect(x, y + 13, 24, 2);
    };
    pane(14, 22);
    pane(90, 22);
    g.fillStyle = '#5a3a28';
    g.fillRect(52, 70, 24, 58);
    g.fillStyle = '#d9b75a';
    g.fillRect(70, 100, 3, 3);
  });
}
