// The open island's wild parts dressed (docs/PARADISE.md, "The mud and the volcano"; the owner,
// 2026-10-07: "add some more detail to the mud and volcano like we did on the original map"). On
// open ground anything standing is solid, so what's here is drawn only and either lies on the
// ground (low enough to drive over) or hangs from the jungle's trees, which are solid already:
// - the jungle's red-earth road: tyre ruts (openIsland.ts's), puddles of mud on it, ferns and
//   flowers along its verges, lianas hanging from the trees beside it, and a rope bridge high over
//   it between two of them;
// - the volcano's cone: glowing cracks in the rock, steam rising from vents ringed with sulphur,
//   and cinders scattered over it and along the rim road.

import { BufferGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, IcosahedronGeometry, BoxGeometry, Mesh, ShaderMaterial, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rng } from '../../../core/rng';
import type { Track } from '../../../core/track/bake';
import { KIND_LAVA_ROCK, KIND_PAVED } from '../../../core/track/ground';
import { TREE_JUNGLE } from '../../../core/track/pines';
import { instanced, type Part } from './forest';
import { lavaMaterial } from './island';
import { animatedPoints, glowPoints } from './scenery';
import { faceted, toon } from './toon';

/** The jungle's mud puddles: one every `every` m or so down its road, `long` by `wide` m (ranges), this far over the road. */
const PUDDLES = { every: [18, 40], long: [2.2, 5], wide: [1.2, 2.6], over: 0.035 };
/** Ferns along its verges: one every `every` m each side, `out` m past the verge (a range), this tall (m, a range); this share flowering. */
const FERNS = { every: 1.6, out: [0.6, 9], size: [1.3, 2.6], flowers: 0.3 };
const FERN_GREENS = [0x2f7a3a, 0x3c8a3a, 0x4a9a3f, 0x5aa83a, 0x266b34];
/** Hibiscus, plumeria, and the rest. */
const FLOWERS = [0xff3b5c, 0xffc93c, 0xff7ab6, 0xfff4e0, 0xff6a2a];
/** Lianas from the trees within `reach` m of the jungle's road: up to `per` each, `long` m (a range). */
const LIANAS = { reach: 22, per: 3, long: [2.5, 6.5] };
/** The rope bridge: between trees `out` m past the verge each side (a range) and within `along` m of each other along the road; its deck at least `clear` m over the road, sagging `sag` of its span, no longer than `span` m, `wide` m across. */
const BRIDGE = { out: [2, 22], along: 8, span: 75, clear: 6, crown: 0.8, sag: 0.035, wide: 1.6, plank: 0.45, rail: 1.0 };
const WOOD = 0x8a6a44;
const ROPE = 0xcdb88a;

/** The volcano's cracks: how many, how long (m), how wide at their widest (m), from `inner` m past the crater to `outer` of the cone's radius. */
const CRACKS = { n: 40, long: [12, 36], wide: [0.5, 1.1], inner: 14, outer: 0.6 };
/** Its steam vents: on the cone, and beside the rim road `out` m past its verge (a range); each a ring of sulphur `ring` m across (a range). */
const VENTS = { cone: 14, road: 7, out: [4, 12], ring: [1.4, 2.6], puffs: 16 };
/** Cinders: how many, how big (m, a range). */
const CINDERS = { n: 650, size: [0.15, 0.5] };
const CINDER = [0x2e2729, 0x3a3134, 0x453a3a, 0x5a2e24, 0x24201f];

export function buildWilds(track: Track, time: { value: number }, rng: Rng): Object3D[] {
  const out: Object3D[] = [];
  const mud = track.surfaceIndex.get('red-earth');
  if (mud !== undefined) out.push(...jungle(track, time, rng, mud));
  if (track.layout.ground?.volcano) out.push(...volcano(track, time, rng));
  return out;
}

/** Whether (x, z) is clear of every road by `margin` m past its verge, off the lava's rock and the car parks, and not dangerous. */
function clearOf(track: Track): (x: number, z: number, margin: number) => boolean {
  const g = track.ground!;
  const main = track.main;
  const cell = (x: number, z: number) => {
    const gx = Math.round((x - g.x0) / g.cell);
    const gz = Math.round((z - g.z0) / g.cell);
    return gx < 0 || gz < 0 || gx >= g.nx || gz >= g.nz ? -1 : gz * g.nx + gx;
  };
  return (x, z, margin) => {
    if (g.outside(x, z)) return false;
    const k = cell(x, z);
    if (k < 0) return false;
    const i = g.near[k];
    if (Math.abs(g.lateral[k]) < main.width[i] / 2 + main.shoulder[i] + margin) return false;
    // (A branch's: its grid's marks, round about.)
    for (const [dx, dz] of [[0, 0], [margin, 0], [-margin, 0], [0, margin], [0, -margin]]) {
      const j = cell(x + dx, z + dz);
      if (j < 0 || g.onBranch[j] || g.hole[j] || g.kind[j] === KIND_LAVA_ROCK || g.kind[j] === KIND_PAVED) return false;
    }
    return g.hazard(x, g.height(x, z), z) === 'none';
  };
}

/** A flat blob on the ground: a fan of `n` points round (x, z), `a` by `b` m (along `yaw`), wobbling, each vertex `over` m over the ground. */
function blob(track: Track, rng: Rng, x: number, z: number, a: number, b: number, yaw: number, over: number, n = 16): { pos: number[]; rim: number[] } {
  const g = track.ground!;
  const pos = [x, g.height(x, z) + over, z];
  const rim = [0];
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const wob = Array.from({ length: n }, () => rng.range(0.82, 1.12));
  for (let k = 0; k < n; k++) {
    const t = (k / n) * Math.PI * 2;
    const la = Math.cos(t) * a * 0.5 * wob[k];
    const lb = Math.sin(t) * b * 0.5 * wob[k];
    const px = x + la * s + lb * c;
    const pz = z + la * c - lb * s;
    pos.push(px, g.height(px, pz) + over, pz);
    rim.push(1);
  }
  return { pos, rim };
}

function jungle(track: Track, time: { value: number }, rng: Rng, mud: number): Object3D[] {
  const g = track.ground!;
  const main = track.main;
  const clear = clearOf(track);
  const out: Object3D[] = [];
  const on = (i: number) => main.surface[(i + main.n) % main.n] === mud;

  // Mud puddles on the road, never on its lines' middle: in the wheel tracks, where the water sits.
  const pos: number[] = [];
  const rim: number[] = [];
  const idx: number[] = [];
  for (let s = 0; s < main.length; s += rng.range(PUDDLES.every[0], PUDDLES.every[1])) {
    const i = Math.round(s / main.step) % main.n;
    if (!on(i) || !on(i - 6) || !on(i + 6)) continue;
    const half = main.width[i] / 2;
    const lat = (rng.next() < 0.5 ? -1 : 1) * rng.range(0.5, half - 1.6);
    const x = main.px[i] - main.tz[i] * lat;
    const z = main.pz[i] + main.tx[i] * lat;
    const yaw = Math.atan2(main.tx[i], main.tz[i]) + rng.range(-0.3, 0.3);
    const b = blob(track, rng, x, z, rng.range(PUDDLES.long[0], PUDDLES.long[1]), rng.range(PUDDLES.wide[0], PUDDLES.wide[1]), yaw, PUDDLES.over);
    const base = pos.length / 3;
    pos.push(...b.pos);
    rim.push(...b.rim);
    const n = b.rim.length - 1;
    for (let k = 0; k < n; k++) idx.push(base, base + 1 + k, base + 1 + ((k + 1) % n));
  }
  if (pos.length) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('rim', new Float32BufferAttribute(rim, 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mesh = new Mesh(geo, mudMaterial(time));
    mesh.name = 'mud-puddles';
    out.push(mesh);
  }

  // Ferns and flowers along the verges, both sides.
  const ferns: Part[] = [];
  const flowers: Part[] = [];
  for (let s = 0; s < main.length; s += FERNS.every) {
    const i = Math.round(s / main.step) % main.n;
    if (!on(i)) continue;
    for (const side of [-1, 1]) {
      if (rng.next() < 0.25) continue;
      const lat = side * (main.width[i] / 2 + main.shoulder[i] + rng.range(FERNS.out[0], FERNS.out[1]));
      const x = main.px[i] - main.tz[i] * lat + rng.range(-1, 1);
      const z = main.pz[i] + main.tx[i] * lat + rng.range(-1, 1);
      if (!clear(x, z, 0.6)) continue;
      const sc = rng.range(FERNS.size[0], FERNS.size[1]);
      const y = g.height(x, z) - 0.05;
      ferns.push({ x, y, z, yaw: rng.range(0, 6.3), sx: sc, sy: sc * rng.range(0.8, 1.1), sz: sc, color: FERN_GREENS[Math.floor(rng.next() * FERN_GREENS.length)] });
      if (rng.next() < FERNS.flowers) {
        const color = FLOWERS[Math.floor(rng.next() * FLOWERS.length)];
        for (let k = 0, n = 1 + Math.floor(rng.next() * 3); k < n; k++) {
          const a = rng.range(0, 6.3);
          const r = sc * rng.range(0.2, 0.55);
          const fs = rng.range(0.1, 0.16);
          flowers.push({ x: x + Math.cos(a) * r, y: y + sc * rng.range(0.45, 0.7), z: z + Math.sin(a) * r, yaw: a, sx: fs, sy: fs * 0.6, sz: fs, color });
        }
      }
    }
  }
  if (ferns.length) out.push(instanced(fernGeometry(), toon({ side: DoubleSide }), ferns));
  if (flowers.length) out.push(instanced(faceted(new IcosahedronGeometry(1, 0)), toon(), flowers));

  // Lianas hanging from the trees by the road, and the trees to string the rope bridge between.
  const p = track.pines;
  if (!p) return out;
  const lianas: Part[] = [];
  /** By the road's sample nearest them: the jungle's trees near enough its verge for a bridge, [k, lateral]. */
  const byRoad = new Map<number, [number, number][]>();
  for (let k = 0; k < p.n; k++) {
    if (p.kind[k] !== TREE_JUNGLE) continue;
    const x = p.x[k];
    const z = p.z[k];
    const gx = Math.round((x - g.x0) / g.cell);
    const gz = Math.round((z - g.z0) / g.cell);
    if (gx < 0 || gz < 0 || gx >= g.nx || gz >= g.nz) continue;
    const c = gz * g.nx + gx;
    const i = g.near[c];
    if (!on(i)) continue;
    const lat = g.lateral[c];
    const off = Math.abs(lat) - main.width[i] / 2 - main.shoulder[i];
    if (off > LIANAS.reach) continue;
    if (off > BRIDGE.out[0] && off < BRIDGE.out[1]) {
      const key = Math.round(i * main.step / 5);
      if (!byRoad.has(key)) byRoad.set(key, []);
      byRoad.get(key)!.push([k, lat]);
    }
    // (As openIsland.ts draws it: the crown `tall` up, `sc` its size.)
    const tall = p.h[k] * 0.62;
    const sc = p.h[k] / 9;
    for (let n = 0, m = 1 + Math.floor(rng.next() * LIANAS.per); n < m; n++) {
      const a = rng.range(0, 6.3);
      const r = sc * rng.range(0.8, 1.9);
      const len = Math.min(rng.range(LIANAS.long[0], LIANAS.long[1]), tall - 1);
      const top = p.y[k] + tall - 0.3 - sc * 0.8;
      lianas.push({ x: x + Math.cos(a) * r, y: top - len, z: z + Math.sin(a) * r, yaw: 0, sx: 1, sy: len, sz: 1, color: rng.next() < 0.5 ? 0x3d6b2a : 0x51793a, roll: rng.range(-0.08, 0.08), pitch: rng.range(-0.08, 0.08) });
    }
  }
  if (lianas.length) out.push(instanced(new CylinderGeometry(0.035, 0.05, 1, 4).translate(0, 0.5, 0), toon(), lianas));
  out.push(...ropeBridge(track, byRoad));
  return out;
}

/**
 * The rope bridge: over the jungle's road, between the pair of trees either side nearest each other
 * and tall enough for its deck to clear the road by BRIDGE.clear m (where its middle is nearest the
 * middle of the jungle). Planks on a sagging span, a rope rail either side, a platform at each tree.
 */
function ropeBridge(track: Track, byRoad: Map<number, [number, number][]>): Object3D[] {
  const p = track.pines!;
  const main = track.main;
  const keys = [...byRoad.keys()].sort((a, b) => a - b);
  if (!keys.length) return [];
  const mid = keys[Math.floor(keys.length / 2)];
  let best: { a: number; b: number; deck: number; score: number } | null = null;
  for (const key of keys) {
    const near = [...(byRoad.get(key - 1) ?? []), ...byRoad.get(key)!, ...(byRoad.get(key + 1) ?? [])];
    for (const [a, la] of near) {
      if (la >= 0) continue;
      for (const [b, lb] of near) {
        if (lb <= 0) continue;
        const i = Math.round((key * 5) / main.step) % main.n;
        // Across the road, not along it.
        const along = Math.abs((p.x[a] - p.x[b]) * main.tx[i] + (p.z[a] - p.z[b]) * main.tz[i]);
        const span = Math.hypot(p.x[a] - p.x[b], p.z[a] - p.z[b]);
        if (along > BRIDGE.along || span > BRIDGE.span) continue;
        const deck = Math.min(p.y[a] + p.h[a] * BRIDGE.crown, p.y[b] + p.h[b] * BRIDGE.crown);
        if (deck - BRIDGE.sag * span - main.py[i] < BRIDGE.clear) continue;
        const score = Math.abs(key - mid) + along;
        if (!best || score < best.score) best = { a, b, deck, score };
      }
    }
  }
  if (!best) return [];
  const { a, b, deck } = best;
  const dx = p.x[b] - p.x[a];
  const dz = p.z[b] - p.z[a];
  const span = Math.hypot(dx, dz);
  const ux = dx / span;
  const uz = dz / span;
  const yaw = Math.atan2(ux, uz);
  // Across the bridge (its width): right of its way.
  const rx = uz;
  const rz = -ux;
  const y = (u: number) => deck - BRIDGE.sag * span * 4 * u * (1 - u);
  const planks: Part[] = [];
  const ropes: Part[] = [];
  const posts: Part[] = [];
  const n = Math.ceil(span / BRIDGE.plank);
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    const pitch = -Math.atan((y(Math.min(1, u + 0.01)) - y(Math.max(0, u - 0.01))) / (0.02 * span));
    planks.push({ x: p.x[a] + dx * u, y: y(u), z: p.z[a] + dz * u, yaw, pitch, sx: BRIDGE.wide, sy: 0.06, sz: BRIDGE.plank * 0.75, color: k % 3 ? WOOD : 0x7a5a3a });
  }
  // The rails: a rope either side, sagging with the deck, posts every few planks; and a rope under
  // each edge of the deck.
  const seg = 8;
  for (const side of [-1, 1]) {
    for (const up of [BRIDGE.rail, 0]) {
      for (let k = 0; k < seg; k++) {
        const u0 = k / seg;
        const u1 = (k + 1) / seg;
        const x0 = p.x[a] + dx * u0 + rx * side * BRIDGE.wide / 2;
        const z0 = p.z[a] + dz * u0 + rz * side * BRIDGE.wide / 2;
        const len = Math.hypot(span / seg, y(u1) - y(u0));
        const pitch = -Math.atan((y(u1) - y(u0)) / (span / seg));
        ropes.push({ x: x0 + (dx / seg) / 2, y: (y(u0) + y(u1)) / 2 + up - (up ? 0.12 * Math.sin(Math.PI * (u0 + u1) / 2) : 0), z: z0 + (dz / seg) / 2, yaw, pitch, sx: 0.05, sy: 0.05, sz: len, color: ROPE });
      }
    }
    for (let k = 0; k <= n; k += 4) {
      const u = k / n;
      posts.push({ x: p.x[a] + dx * u + rx * side * BRIDGE.wide / 2, y: y(u), z: p.z[a] + dz * u + rz * side * BRIDGE.wide / 2, yaw, sx: 0.07, sy: BRIDGE.rail, sz: 0.07, color: WOOD });
    }
  }
  // A platform round each tree, at the deck.
  for (const k of [a, b]) planks.push({ x: p.x[k], y: deck, z: p.z[k], yaw, sx: 2.6, sy: 0.15, sz: 2.6, color: WOOD });
  return [
    instanced(new BoxGeometry(1, 1, 1), toon(), planks),
    instanced(new BoxGeometry(1, 1, 1), toon(), ropes),
    instanced(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), toon(), posts),
  ];
}

/** A fern, about 1 m across and a little under that tall: seven fronds arching out from its heart. */
function fernGeometry(): BufferGeometry {
  const fronds: BufferGeometry[] = [];
  for (let k = 0; k < 7; k++) {
    fronds.push(
      faceted(new ConeGeometry(0.14, 0.9, 3))
        .scale(1, 1, 0.3)
        .translate(0, 0.45, 0)
        .rotateX(0.85 + 0.15 * (k % 2))
        .rotateY((k / 7) * Math.PI * 2),
    );
  }
  fronds.push(faceted(new ConeGeometry(0.1, 0.6, 3)).translate(0, 0.3, 0));
  return mergeGeometries(fronds);
}

/** Mud (linear colours, as a ShaderMaterial writes them): dark and wet in its middle, a lighter, drier rim, the sky's sheen sliding over it. */
function mudMaterial(time: { value: number }): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: time },
    // (Opaque: the post pass reads a cleared alpha as a mirror, the rain's puddles'.)
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    vertexShader: `attribute float rim;varying float vR;varying vec3 vW;void main(){vR=rim;vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader: `uniform float uTime;varying float vR;varying vec3 vW;
      void main(){
        vec3 col=mix(vec3(0.03,0.016,0.008),vec3(0.13,0.065,0.03),smoothstep(0.55,1.0,vR));
        float sheen=0.5+0.5*sin(vW.x*0.9+vW.z*0.6+uTime*0.7)*sin(vW.z*1.3-uTime*0.5);
        col+=vec3(0.07,0.07,0.075)*smoothstep(0.7,1.0,sheen)*(1.0-smoothstep(0.5,0.9,vR));
        gl_FragColor=vec4(col,1.0);
      }`,
  });
}

function volcano(track: Track, time: { value: number }, rng: Rng): Object3D[] {
  const g = track.ground!;
  const v = track.layout.ground!.volcano!;
  const main = track.main;
  const clear = clearOf(track);
  const out: Object3D[] = [];
  const onCone = () => {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(v.crater + CRACKS.inner, v.r * CRACKS.outer);
    return [v.x + Math.cos(a) * r, v.z + Math.sin(a) * r, a] as const;
  };

  // Cracks in the rock, glowing: down the cone from where each opens, wandering, widest in the middle.
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const glow: number[] = [];
  for (let c = 0, tries = 0; c < CRACKS.n && tries < CRACKS.n * 8; tries++) {
    let [x, z, a] = onCone();
    if (!clear(x, z, 2)) continue;
    c++;
    const long = rng.range(CRACKS.long[0], CRACKS.long[1]);
    const wide = rng.range(CRACKS.wide[0], CRACKS.wide[1]);
    const pts: [number, number][] = [];
    for (let d = 0; d <= long; d += 1.5) {
      if (!clear(x, z, 1.5)) break;
      pts.push([x, z]);
      a += rng.range(-0.35, 0.35);
      x += Math.cos(a) * 1.5;
      z += Math.sin(a) * 1.5;
    }
    if (pts.length < 4) continue;
    const base = pos.length / 3;
    for (let k = 0; k < pts.length; k++) {
      const [px, pz] = pts[k];
      const [qx, qz] = pts[Math.min(pts.length - 1, k + 1)];
      const [ox, oz] = pts[Math.max(0, k - 1)];
      const l = Math.hypot(qx - ox, qz - oz) || 1;
      const nx = -(qz - oz) / l;
      const nz = (qx - ox) / l;
      const u = k / (pts.length - 1);
      const w = (wide / 2) * Math.max(0.15, Math.sqrt(Math.sin(Math.PI * u)));
      for (const side of [-1, 1]) {
        const ex = px + nx * w * side;
        const ez = pz + nz * w * side;
        pos.push(ex, g.height(ex, ez) + 0.05, ez);
        uv.push(side < 0 ? 0 : 1, u * 0.2);
      }
      if (k < pts.length - 1) idx.push(base + k * 2, base + k * 2 + 1, base + k * 2 + 3, base + k * 2, base + k * 2 + 3, base + k * 2 + 2);
      if (k % 5 === 2) glow.push(px, g.height(px, pz) + 0.6, pz);
    }
  }
  if (pos.length) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mesh = new Mesh(geo, lavaMaterial(time));
    mesh.name = 'lava-cracks';
    out.push(mesh, glowPoints(glow, 0xff6a1a, 3.5));
  }

  // Steam vents: on the cone, and beside the rim road (the lava rock's road), each ringed with
  // sulphur, a little steam always rising.
  const vents: [number, number][] = [];
  for (let tries = 0; vents.length < VENTS.cone && tries < 200; tries++) {
    const [x, z] = onCone();
    if (clear(x, z, 3)) vents.push([x, z]);
  }
  const rim = track.surfaceIndex.get('lava-rock');
  const rimRoad: number[] = [];
  for (let i = 0; i < main.n; i += 10) if (main.surface[i] === rim) rimRoad.push(i);
  for (let tries = 0, made = 0; made < VENTS.road && rimRoad.length && tries < 100; tries++) {
    const i = rimRoad[Math.floor(rng.next() * rimRoad.length)];
    const side = rng.next() < 0.5 ? -1 : 1;
    const lat = side * (main.width[i] / 2 + main.shoulder[i] + rng.range(VENTS.out[0], VENTS.out[1]));
    const x = main.px[i] - main.tz[i] * lat;
    const z = main.pz[i] + main.tx[i] * lat;
    if (!clear(x, z, 3)) continue;
    vents.push([x, z]);
    made++;
  }
  const sPos: number[] = [];
  const sCol: number[] = [];
  const sIdx: number[] = [];
  const puffs = { pos: [] as number[], phase: [] as number[], col: [] as number[] };
  for (const [x, z] of vents) {
    for (const [scale, inner] of [[1, false], [0.55, true]] as const) {
      const r = rng.range(VENTS.ring[0], VENTS.ring[1]) * scale;
      const b = blob(track, rng, x, z, r * 2, r * 2 * rng.range(0.7, 1), rng.range(0, 6), inner ? 0.07 : 0.05, 12);
      const base = sPos.length / 3;
      sPos.push(...b.pos);
      for (let k = 0; k < b.rim.length; k++) {
        const t = b.rim[k];
        // Bright yellow in the middle, paler and greyer to its edge.
        const c = inner ? [0.93, 0.83, 0.3] : t ? [0.62, 0.58, 0.42] : [0.85, 0.78, 0.4];
        sCol.push(...c);
      }
      const n = b.rim.length - 1;
      for (let k = 0; k < n; k++) sIdx.push(base, base + 1 + ((k + 1) % n), base + 1 + k);
    }
    const y = g.height(x, z) + 0.3;
    for (let k = 0; k < VENTS.puffs; k++) {
      puffs.pos.push(x + rng.range(-0.5, 0.5), y, z + rng.range(-0.5, 0.5));
      puffs.phase.push(k / VENTS.puffs + rng.next() * 0.03);
      const w = rng.range(0.82, 0.95);
      puffs.col.push(w, w, w * 0.97);
    }
  }
  if (sPos.length) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(sPos, 3));
    geo.setAttribute('color', new Float32BufferAttribute(sCol, 3));
    geo.setIndex(sIdx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new Mesh(geo, toon({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, side: DoubleSide }));
    mesh.name = 'sulphur';
    out.push(mesh, animatedPoints(puffs.pos, puffs.phase, puffs.col, 'steam', 3.5, time));
  }

  // Cinders: over the cone and along the rim road's verges, mostly sunk in it.
  const cinders: Part[] = [];
  for (let tries = 0; cinders.length < CINDERS.n && tries < CINDERS.n * 4; tries++) {
    let x: number;
    let z: number;
    if (rimRoad.length && rng.next() < 0.35) {
      const i = rimRoad[Math.floor(rng.next() * rimRoad.length)];
      const lat = (rng.next() < 0.5 ? -1 : 1) * (main.width[i] / 2 + main.shoulder[i] + rng.range(1.5, 14));
      x = main.px[i] - main.tz[i] * lat + rng.range(-4, 4);
      z = main.pz[i] + main.tx[i] * lat + rng.range(-4, 4);
    } else {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(v.crater + 6, v.r * 0.62);
      x = v.x + Math.cos(a) * r;
      z = v.z + Math.sin(a) * r;
    }
    if (!clear(x, z, 1.2)) continue;
    const s = rng.range(CINDERS.size[0], CINDERS.size[1]);
    cinders.push({ x, y: g.height(x, z) - s * 0.35, z, yaw: rng.range(0, 6.3), sx: s * rng.range(0.8, 1.4), sy: s * rng.range(0.5, 0.8), sz: s * rng.range(0.8, 1.4), color: CINDER[Math.floor(rng.next() * CINDER.length)], roll: rng.range(-0.3, 0.3) });
  }
  if (cinders.length) out.push(instanced(faceted(new IcosahedronGeometry(1, 0)), toon(), cinders));
  return out;
}

