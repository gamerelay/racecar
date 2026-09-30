// Paradise's dressing (PLAN phase 5), built from the track and its land like the forest: palms
// along the beaches and leaning over the coast road (swaying in the vertex shader), jungle inland,
// thickest round the switchbacks, with a waterfall and a rope bridge over the road; black boulders
// on the volcano, the crater's lava and a plume of smoke; Harbor Town (pastel houses, the tiki bar
// with its torches, the pier and the fishing boats), beach umbrellas and huts, gulls; the Lava Tube
// roofed over and lit by lava; the lighthouse on its point with a sweeping beam; and signs at the
// shortcuts. All of it is scenery, the same every race, one draw per kind of thing.

import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  type MeshToonMaterial,
  PlaneGeometry,
  ShaderMaterial,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../../../core/rng';
import type { BakedSpline, Track } from '../../../core/track/bake';
import { houseTexture, instanced, prism, type Part } from './forest';
import { animatedPoints, branchSide, canvas, FONT, glowPoints } from './scenery';
import { coneHeight, type Terrain } from './terrain';
import type { Cover } from './track';
import { faceted, toon } from './toon';

export interface Island {
  objects: Object3D[];
  update(time: number): void;
  /** Stretches of road under a roof the scenery puts over them (the Lava Tube): no rain there. */
  covers: Cover[];
}

const PALM_LEAVES = [0x3f8f3a, 0x4ea03c, 0x358a44, 0x5aa83a];
const JUNGLE = [0x2f7a3a, 0x266b34, 0x3c8a3a, 0x1f5f35, 0x4a9a3f];
const PASTELS = [0xf4a6a0, 0x9fd9c8, 0xf6d38a, 0xa7c4f2, 0xf0b6d6, 0xfff1d6, 0xbfe3a0];
const CANOPIES = [0xff5a5f, 0xffc93c, 0x35c9e8, 0xff8fc7, 0xffffff, 0x6fdc8c];
/** The Lava Tube's roof, above its road. */
const TUBE_H = 6.5;
const LAVA_ROCK = [0x2e2729, 0x3a3134, 0x453a3a];

/**
 * A toon material whose instances sway in the wind, more the higher up a vertex is: `amount` per
 * unit of height squared, in the shape's own units, counted from `base` below its origin (a
 * crown is a unit ball, but it sits `base` units up its tree).
 */
function swaying(time: { value: number }, amount: number, base = 0): MeshToonMaterial {
  const mat = toon();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
      #else
        vec2 ip = vec2(0.0);
      #endif
      float ph = ip.x * 0.13 + ip.y * 0.17;
      float hh = max(0.0, position.y + ${base.toFixed(2)});
      transformed.x += (sin(uTime * 1.1 + ph) * 0.6 + sin(uTime * 2.3 + ph * 1.7) * 0.25) * ${amount.toFixed(4)} * hh * hh;
      transformed.z += cos(uTime * 0.9 + ph) * ${(amount * 0.5).toFixed(4)} * hh * hh;`,
    );
  };
  mat.customProgramCacheKey = () => `sway${amount}/${base}`;
  return mat;
}

/** A palm, about 8.5 m tall, its trunk curving toward local +x: the trunk and nuts, and the fronds. */
function palmGeometry(): { trunk: BufferGeometry; fronds: BufferGeometry } {
  const seg = 5;
  const H = 8.2;
  const bend = (y: number) => 0.035 * y * y;
  const parts: BufferGeometry[] = [];
  for (let k = 0; k < seg; k++) {
    const y0 = (k / seg) * H;
    const y1 = ((k + 1) / seg) * H;
    const r0 = 0.3 - 0.1 * (k / seg);
    const r1 = 0.3 - 0.1 * ((k + 1) / seg);
    const len = Math.hypot(bend(y1) - bend(y0), y1 - y0);
    const g = new CylinderGeometry(r1, r0, len * 1.04, 6).rotateZ(-Math.atan2(bend(y1) - bend(y0), y1 - y0)).translate((bend(y0) + bend(y1)) / 2, (y0 + y1) / 2, 0);
    parts.push(faceted(g));
  }
  const tx = bend(H);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    parts.push(faceted(new IcosahedronGeometry(0.28, 0).translate(tx + Math.cos(a) * 0.35, H - 0.25, Math.sin(a) * 0.35)));
  }
  const fronds: BufferGeometry[] = [];
  for (let k = 0; k < 8; k++) {
    const yaw = (k / 8) * Math.PI * 2 + (k % 2) * 0.2;
    // Each frond: out and a little up, then drooping to its tip.
    const inner = new BoxGeometry(1.0, 0.07, 2.2).translate(0, 0, 1.1).rotateX(-0.15).rotateY(yaw).translate(tx, H, 0);
    const outer = new BoxGeometry(0.8, 0.06, 2.0)
      .translate(0, 0, 1.0)
      .rotateX(0.75)
      .translate(0, -Math.sin(-0.15) * 2.2, Math.cos(-0.15) * 2.2)
      .rotateY(yaw)
      .translate(tx, H, 0);
    fronds.push(inner, outer);
  }
  return { trunk: mergeGeometries(parts)!, fronds: faceted(mergeGeometries(fronds)!) };
}

export function buildIsland(track: Track, seed: number, land: Terrain): Island {
  const rng = Rng.stream(seed, 'island');
  const objects: Object3D[] = [];
  const time = { value: 0 };
  const updates: ((t: number) => void)[] = [];
  const layout = track.layout;
  const seaY = land.sea?.y ?? 0;
  const coast = (x: number, z: number) => land.sea?.coast(x, z) ?? Infinity;
  const volcano = layout.terrain?.volcano;
  const main = track.main;
  const L = main.length;
  const pick = <T>(list: readonly T[]) => list[Math.floor(rng.next() * list.length)];
  const at = (sp: BakedSpline, s: number) => Math.max(0, Math.min(sp.n - 1, Math.round(s / sp.step)));

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
  /** Meters from (x, z) to the nearest road edge within ~`reach` (Infinity past it), and that road's point. */
  let nearX = 0;
  let nearZ = 0;
  const roadGap = (x: number, z: number, reach = 40) => {
    const r = Math.ceil(reach / HC);
    const cx = Math.floor(x / HC);
    const cz = Math.floor(z / HC);
    let best = Infinity;
    for (let a = -r; a <= r; a++) {
      for (let b = -r; b <= r; b++) {
        for (const s of hash.get(key(cx + a, cz + b)) ?? []) {
          const d = Math.hypot(s.x - x, s.z - z) - s.half;
          if (d < best) {
            best = d;
            nearX = s.x;
            nearZ = s.z;
          }
        }
      }
    }
    return best;
  };
  /** Circles kept clear of trees (buildings, the harbour, the lighthouse). */
  const keep: { x: number; z: number; r: number }[] = [];
  const kept = (x: number, z: number) => keep.some((k) => (k.x - x) ** 2 + (k.z - z) ** 2 < k.r * k.r);
  /** How far up the cone (0 at the crater's middle, 1 at its foot); Infinity with no volcano. */
  const onCone = (x: number, z: number) => (volcano ? Math.hypot(x - volcano.x, z - volcano.z) / volcano.r : Infinity);
  /** The ground is under the lap's lowest road (the Freeway's pillars stand in the bay). */
  const dry = (x: number, z: number, margin = 2) => coast(x, z) > margin && land.height(x, z) > seaY + 0.3;
  if (x0 === Infinity) return { objects, update() {}, covers: [] };

  // ---- Harbor Town: pastel houses both sides of the start, the tiki bar, the pier and boats ----
  const houses: Part[] = [];
  const plain: Part[] = [];
  const roofs: Part[] = [];
  const thatch: Part[] = [];
  const torches: number[] = [];
  const roofColor = () => pick([0xc9573f, 0x3a8a8a, 0xe8e1d0, 0x2f6fb0]);
  const house = (x: number, z: number, yaw: number, w: number, d: number, h: number) => {
    const y = land.height(x, z) - 0.3;
    houses.push({ x, y: y + h / 2, z, yaw, sx: w, sy: h, sz: d, color: pick(PASTELS) });
    roofs.push({ x, y: y + h, z, yaw, sx: w * 1.1, sy: w * 0.35, sz: d * 1.08, color: roofColor() });
    keep.push({ x, z, r: Math.max(w, d) * 0.8 + 2 });
  };
  const townS: number[] = [];
  for (let s = -260; s < 320; s += 10) townS.push((s + L) % L);
  for (const s of townS) {
    const i = at(main, s);
    for (const side of [-1, 1]) {
      if (rng.next() < 0.35) continue;
      const off = main.width[i] / 2 + main.shoulder[i] + rng.range(6, 10);
      const x = main.px[i] - main.tz[i] * off * side;
      const z = main.pz[i] + main.tx[i] * off * side;
      const w = rng.range(6, 9);
      const d = rng.range(6, 9);
      if (roadGap(x, z) < Math.max(w, d) * 0.6 + 1.5 || !dry(x, z, 12) || kept(x, z)) continue;
      house(x, z, Math.atan2(main.tx[i], main.tz[i]), w, d, rng.range(3.4, 6.5));
      // A second storey now and then, a little smaller.
      if (rng.next() < 0.3) {
        const y = land.height(x, z) - 0.3;
        const h = houses[houses.length - 1].sy;
        houses.push({ x, y: y + h + 1.6, z, yaw: Math.atan2(main.tx[i], main.tz[i]), sx: w * 0.7, sy: 3.2, sz: d * 0.7, color: pick(PASTELS) });
        roofs[roofs.length - 1].y = y + h + 3.2;
      }
    }
  }
  // The tiki bar: on the sand between the start and the water, a thatched hut on posts with torches.
  const bar = (() => {
    for (let s = 40; s < 200; s += 12) {
      const i = at(main, s);
      for (const side of [-1, 1]) {
        // Out from the road toward the water, onto the sand.
        for (let off = main.width[i] / 2 + main.shoulder[i] + 10; off < 70; off += 3) {
          const x = main.px[i] - main.tz[i] * off * side;
          const z = main.pz[i] + main.tx[i] * off * side;
          if (coast(x, z) > 22 || !dry(x, z, 7) || roadGap(x, z) < 9 || kept(x, z)) continue;
          return { x, z, yaw: Math.atan2(main.tx[i], main.tz[i]) };
        }
      }
    }
    return null;
  })();
  if (bar) {
    const y = land.height(bar.x, bar.z);
    const c = Math.cos(bar.yaw);
    const sn = Math.sin(bar.yaw);
    for (const a of [-1, 1]) for (const b of [-1, 1]) plain.push({ x: bar.x + c * a * 3 + sn * b * 3.5, y: y + 1.5, z: bar.z - sn * a * 3 + c * b * 3.5, yaw: bar.yaw, sx: 0.35, sy: 3, sz: 0.35, color: 0x8a6a3e });
    plain.push({ x: bar.x, y: y + 0.6, z: bar.z, yaw: bar.yaw, sx: 5, sy: 1.2, sz: 1.2, color: 0x9a7040 });
    thatch.push({ x: bar.x, y: y + 3, z: bar.z, yaw: bar.yaw, sx: 8.5, sy: 3, sz: 9.5, color: 0xd9b870 });
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const tx = bar.x + c * a * 5.5 + sn * b * 5.5;
      const tz = bar.z - sn * a * 5.5 + c * b * 5.5;
      plain.push({ x: tx, y: y + 1.1, z: tz, yaw: 0, sx: 0.15, sy: 2.2, sz: 0.15, color: 0x6b4a2e });
      torches.push(tx, y + 2.4, tz);
    }
    keep.push({ x: bar.x, z: bar.z, r: 9 });
  }
  // The pier: out from the beach nearest the harbour front, into the sea.
  const boats: Part[] = [];
  const cabins: Part[] = [];
  const masts: Part[] = [];
  {
    let best: { x: number; z: number; nx: number; nz: number } | null = null;
    // From the harbour front out, first one way along the road and then the other.
    for (let k = 0; k < 28 && !best; k++) {
      const s = (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 10 + 110;
      const i = at(main, (s + L) % L);
      for (const side of [-1, 1]) {
        // Walk out from the road until the water, and build from the waterline.
        for (let off = 12; off < 90; off += 2) {
          const x = main.px[i] - main.tz[i] * off * side;
          const z = main.pz[i] + main.tx[i] * off * side;
          if (coast(x, z) < 0 && !kept(x, z)) {
            best = { x, z, nx: -main.tz[i] * side, nz: main.tx[i] * side };
            break;
          }
        }
        if (best) break;
      }
    }
    if (best) {
      const yaw = Math.atan2(best.nx, best.nz);
      const len = 60;
      for (let d = -6; d <= len; d += 4) {
        const x = best.x + best.nx * d;
        const z = best.z + best.nz * d;
        plain.push({ x, y: seaY + 1.4, z, yaw, sx: 4, sy: 0.3, sz: 4.1, color: 0xb08a5a });
        for (const side of [-1, 1]) plain.push({ x: x - best.nz * 1.8 * side, y: seaY - 1, z: z + best.nx * 1.8 * side, yaw, sx: 0.3, sy: 5, sz: 0.3, color: 0x6b553b });
      }
      keep.push({ x: best.x, z: best.z, r: 10 });
      // Fishing boats moored along it.
      for (let k = 0; k < 5; k++) {
        const d = 10 + k * 11;
        const side = k % 2 ? 1 : -1;
        const x = best.x + best.nx * d - best.nz * 6 * side;
        const z = best.z + best.nz * d + best.nx * 6 * side;
        const byaw = yaw + rng.range(-0.25, 0.25);
        boats.push({ x, y: seaY + 0.2, z, yaw: byaw, sx: 2.4, sy: 1.2, sz: 7, color: pick([0xffffff, 0xff5a5f, 0x35a7e8, 0xffc93c]) });
        cabins.push({ x: x + Math.sin(byaw) * 0.8, y: seaY + 1.4, z: z + Math.cos(byaw) * 0.8, yaw: byaw, sx: 1.6, sy: 1.2, sz: 2, color: 0xf4efe6 });
        masts.push({ x: x - Math.sin(byaw) * 1.2, y: seaY + 3.5, z: z - Math.cos(byaw) * 1.2, yaw: 0, sx: 0.12, sy: 6, sz: 0.12, color: 0x8a6a3e });
      }
    }
  }

  // ---- the lighthouse: on the point, past the road on the seaward side ----
  let lamp: { x: number; y: number; z: number } | null = null;
  {
    // The point: the lap's last third furthest out from the island's middle (the coast's centroid).
    const loop = layout.terrain?.island ?? [];
    const cx = loop.reduce((a, p) => a + p[0], 0) / Math.max(1, loop.length);
    const cz = loop.reduce((a, p) => a + p[1], 0) / Math.max(1, loop.length);
    let bi = -1;
    const out = (i: number) => Math.hypot(main.px[i] - cx, main.pz[i] - cz);
    for (let i = Math.floor(main.n * 0.7); i < main.n; i++) if (bi < 0 || out(i) > out(bi)) bi = i;
    if (bi >= 0) {
      for (const side of [-1, 1]) {
        const off = main.width[bi] / 2 + main.shoulder[bi] + 12;
        const x = main.px[bi] - main.tz[bi] * off * side;
        const z = main.pz[bi] + main.tx[bi] * off * side;
        if (Math.hypot(x - cx, z - cz) < out(bi) || !dry(x, z, 1) || roadGap(x, z) < 6) continue;
        const y = land.height(x, z) - 0.2;
        const H = 18;
        for (let k = 0; k < 6; k++) {
          const r = 2.4 - k * 0.18;
          plain.push({ x, y: y + (k + 0.5) * (H / 6), z, yaw: 0, sx: r * 2, sy: H / 6, sz: r * 2, color: k % 2 ? 0xe0413a : 0xf8f4ea });
        }
        plain.push({ x, y: y + H + 0.3, z, yaw: 0, sx: 3.4, sy: 0.6, sz: 3.4, color: 0x2e3a44 });
        roofs.push({ x, y: y + H + 2.6, z, yaw: Math.PI / 4, sx: 2.6, sy: 1.8, sz: 2.6, color: 0xe0413a });
        lamp = { x, y: y + H + 1.6, z };
        keep.push({ x, z, r: 7 });
        break;
      }
    }
  }
  if (lamp) {
    objects.push(glowPoints([lamp.x, lamp.y, lamp.z], 0xfff2b0, 9));
    // The beam: a long faint cone, turning.
    const beam = new Mesh(
      new ConeGeometry(9, 160, 16, 1, true).translate(0, -80, 0).rotateX(Math.PI / 2),
      new MeshBasicMaterial({ color: 0xfff4c0, transparent: true, opacity: 0.1, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false }),
    );
    beam.position.set(lamp.x, lamp.y, lamp.z);
    objects.push(beam);
    updates.push((t) => {
      beam.rotation.y = t * 0.6;
      beam.updateMatrix();
    });
    beam.matrixAutoUpdate = false;
    beam.updateMatrix();
  }

  // ---- the volcano: the crater's lava, a glow round the lip, the plume ----
  const lavaRocks: Part[] = [];
  if (volcano) {
    const floor = seaY + coneHeight(volcano, volcano.x, volcano.z);
    const pool = new Mesh(new CircleGeometry(volcano.crater * 0.62, 32).rotateX(-Math.PI / 2), new ShaderMaterial({
      uniforms: { uTime: time },
      vertexShader: `varying vec2 vP;void main(){vP=position.xz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      // Molten rock: a bright crust breaking up over the glow, churning slowly.
      fragmentShader: `uniform float uTime;varying vec2 vP;
        void main(){
          vec2 q=vP*0.12;
          float n=sin(q.x*3.1+uTime*0.4)*sin(q.y*2.7-uTime*0.3)+0.5*sin((q.x+q.y)*5.3+uTime*0.7);
          vec3 col=mix(vec3(1.0,0.35,0.05),vec3(1.0,0.85,0.3),smoothstep(0.2,0.9,n));
          col=mix(col,vec3(0.25,0.05,0.03),smoothstep(-0.2,-0.7,n));
          gl_FragColor=vec4(col,1.0);
        }`,
    }));
    pool.position.set(volcano.x, floor + 1.2, volcano.z);
    objects.push(pool);
    const glow: number[] = [];
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2;
      const r = volcano.crater * rng.range(0.55, 0.8);
      glow.push(volcano.x + Math.cos(a) * r, floor + 4, volcano.z + Math.sin(a) * r);
    }
    objects.push(glowPoints(glow, 0xff6a1a, 22));
    const plume = { pos: [] as number[], phase: [] as number[], col: [] as number[] };
    for (let k = 0; k < 90; k++) {
      plume.pos.push(volcano.x + rng.range(-12, 12), floor + 6, volcano.z + rng.range(-12, 12));
      plume.phase.push(k / 90 + rng.next() * 0.01);
      const g = rng.range(0.3, 0.46);
      plume.col.push(g, g * 0.97, g * 0.95);
    }
    objects.push(animatedPoints(plume.pos, plume.phase, plume.col, 'plume', 30, time));
    // Boulders of black rock over the upper cone, and along the rim road's verges.
    for (let k = 0; k < 260; k++) {
      const a = rng.range(0, Math.PI * 2);
      const r = volcano.r * Math.sqrt(rng.range(0.03, 0.5));
      const x = volcano.x + Math.cos(a) * r;
      const z = volcano.z + Math.sin(a) * r;
      if (roadGap(x, z, 30) < 4 || Math.hypot(x - volcano.x, z - volcano.z) < volcano.crater + 4) continue;
      const s = rng.range(1, 4.5);
      lavaRocks.push({ x, y: land.height(x, z) - s * 0.3, z, yaw: rng.range(0, 6), sx: s * rng.range(0.8, 1.5), sy: s * rng.range(0.5, 0.9), sz: s * rng.range(0.8, 1.5), color: pick(LAVA_ROCK), roll: rng.range(-0.3, 0.3) });
    }
  }

  // ---- the Lava Tube: the shortcut roofed over through the cone's shoulder, lit by lava ----
  const tube = track.splines.find((sp) => sp.id === 'lava-tube');
  const tubeRock: Part[] = [];
  const lavaStrips: Part[] = [];
  const tubeLights: number[] = [];
  if (tube) {
    const from = tube.length * 0.22;
    const to = tube.length * 0.78;
    const H = TUBE_H;
    for (let s = from; s < to; s += 3) {
      const i = at(tube, s);
      const yaw = Math.atan2(tube.tx[i], tube.tz[i]);
      const y = tube.py[i];
      const half = tube.width[i] / 2 + tube.shoulder[i] + 0.4;
      for (const side of [-1, 1]) {
        const x = tube.px[i] - tube.tz[i] * half * side;
        const z = tube.pz[i] + tube.tx[i] * half * side;
        tubeRock.push({ x, y: y + H / 2 - 0.5, z, yaw, sx: 1.6, sy: H + 1, sz: 3.2, color: pick(LAVA_ROCK) });
        // A seam of lava low on each wall.
        const lx = tube.px[i] - tube.tz[i] * (half - 0.85) * side;
        const lz = tube.pz[i] + tube.tx[i] * (half - 0.85) * side;
        lavaStrips.push({ x: lx, y: y + 0.55 + 0.25 * Math.sin(s * 0.3), z: lz, yaw, sx: 0.12, sy: 0.35, sz: 3.1, color: 0xffffff });
      }
      tubeRock.push({ x: tube.px[i], y: y + H + 0.6, z: tube.pz[i], yaw, sx: half * 2 + 3, sy: 1.6, sz: 3.2, color: pick(LAVA_ROCK) });
      // Rubble heaped over the roof, so it reads as rock, not a box.
      if (Math.round(s) % 9 < 3) tubeRock.push({ x: tube.px[i] + rng.range(-3, 3), y: y + H + 2, z: tube.pz[i] + rng.range(-3, 3), yaw: rng.range(0, 6), sx: rng.range(6, 10), sy: rng.range(2, 4), sz: rng.range(5, 8), color: pick(LAVA_ROCK), roll: rng.range(-0.2, 0.2) });
      if (Math.round(s) % 12 < 3) tubeLights.push(tube.px[i], y + 1.2, tube.pz[i]);
    }
  }

  // ---- the jungle's waterfall and rope bridge, by the switchbacks ----
  const jungleSp = (i: number) => track.surfaces[main.surface[i]].id === 'red-earth';
  const jungle: number[] = [];
  for (let i = 0; i < main.n; i += 5) if (jungleSp(i)) jungle.push(i);
  const ropes: Part[] = [];
  if (jungle.length > 20) {
    // The rope bridge: high over the first leg of the switchbacks, between two rock stacks.
    const i = jungle[Math.floor(jungle.length * 0.3)];
    const yaw = Math.atan2(main.tx[i], main.tz[i]);
    const y = main.py[i];
    const half = main.width[i] / 2 + main.shoulder[i] + 3;
    const deck = y + 9;
    const ends: [number, number][] = [];
    for (const side of [-1, 1]) {
      const x = main.px[i] - main.tz[i] * half * side;
      const z = main.pz[i] + main.tx[i] * half * side;
      ends.push([x, z]);
      tubeRock.push({ x, y: (land.height(x, z) + deck) / 2, z, yaw, sx: 4, sy: deck - land.height(x, z) + 1, sz: 4, color: 0x5a5048 });
      keep.push({ x, z, r: 4 });
    }
    const [a, b] = ends;
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const byaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
    for (let k = 1; k < span / 0.9; k++) {
      const u = (k * 0.9) / span;
      const sag = Math.sin(u * Math.PI) * 1.2;
      ropes.push({ x: a[0] + (b[0] - a[0]) * u, y: deck - sag, z: a[1] + (b[1] - a[1]) * u, yaw: byaw, sx: 2, sy: 0.1, sz: 0.6, color: 0x9a7a4a });
    }
    for (const side of [-1, 1]) {
      for (let k = 0; k < span / 1.2; k++) {
        const u = (k * 1.2 + 0.6) / span;
        const sag = Math.sin(u * Math.PI) * 1.2;
        const ox = Math.cos(byaw) * side;
        const oz = -Math.sin(byaw) * side;
        ropes.push({ x: a[0] + (b[0] - a[0]) * u + ox, y: deck - sag + 1, z: a[1] + (b[1] - a[1]) * u + oz, yaw: byaw, sx: 0.06, sy: 0.06, sz: 1.25, color: 0x6b553b });
      }
    }
  }
  if (jungle.length > 20) {
    // The waterfall: down a cliff outside a hairpin, into a pool, with mist.
    let placed = false;
    for (const f of [0.55, 0.5, 0.6, 0.45, 0.65]) {
      if (placed) break;
      const i = jungle[Math.floor(jungle.length * f)];
      for (const side of [-1, 1]) {
        const off = main.width[i] / 2 + main.shoulder[i] + 26;
        const x = main.px[i] - main.tz[i] * off * side;
        const z = main.pz[i] + main.tx[i] * off * side;
        if (roadGap(x, z) < 16 || !dry(x, z, 20) || kept(x, z)) continue;
        const y = land.height(x, z);
        const yaw = Math.atan2(main.px[i] - x, main.pz[i] - z);
        const H = 18;
        // The cliff behind: stacked rock slabs.
        for (let k = 0; k < 5; k++) tubeRock.push({ x: x - Math.sin(yaw) * (2 + k * 0.4), y: y + (k + 0.5) * (H / 5), z: z - Math.cos(yaw) * (2 + k * 0.4), yaw: yaw + rng.range(-0.1, 0.1), sx: 16 - k * 1.2, sy: H / 5 + 0.4, sz: 4, color: pick([0x5a5048, 0x6a6058, 0x4f463f]) });
        const fall = new Mesh(new PlaneGeometry(5, H, 1, 8).translate(0, H / 2, 0), new ShaderMaterial({
          uniforms: { uTime: time },
          transparent: true,
          side: DoubleSide,
          vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
          fragmentShader: `uniform float uTime;varying vec2 vUv;
            float h(float x){return fract(sin(x*91.7)*43758.5);}
            void main(){
              float lane=floor(vUv.x*14.0);
              float s=fract(vUv.y*3.0+uTime*(1.2+h(lane)*0.8)+h(lane+3.0));
              vec3 col=mix(vec3(0.62,0.86,0.92),vec3(0.95,0.99,1.0),step(0.7,s));
              float edge=smoothstep(0.0,0.15,vUv.x)*smoothstep(1.0,0.85,vUv.x);
              gl_FragColor=vec4(col,0.85*edge);
            }`,
        }));
        fall.position.set(x - Math.sin(yaw) * 0.6, y, z - Math.cos(yaw) * 0.6);
        fall.rotation.y = yaw;
        objects.push(fall);
        const pool = new Mesh(new CircleGeometry(5, 16).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0x3fb8c8 }));
        pool.position.set(x + Math.sin(yaw) * 3, y + 0.15, z + Math.cos(yaw) * 3);
        objects.push(pool);
        const mist = { pos: [] as number[], phase: [] as number[], col: [] as number[] };
        for (let k = 0; k < 14; k++) {
          mist.pos.push(x + Math.sin(yaw) * 3 + rng.range(-3, 3), y + 0.5, z + Math.cos(yaw) * 3 + rng.range(-3, 3));
          mist.phase.push(k / 14);
          mist.col.push(0.95, 0.98, 1);
        }
        objects.push(animatedPoints(mist.pos, mist.phase, mist.col, 'steam', 2.2, time));
        keep.push({ x, z, r: 12 });
        placed = true;
        break;
      }
    }
  }

  // ---- trees: palms by the sea and the roads, jungle inland; umbrellas and huts on the beach ----
  const palms: Part[] = [];
  const crowns: Part[] = [];
  const trunks: Part[] = [];
  const bushes: Part[] = [];
  const poles: Part[] = [];
  const canopies: Part[] = [];
  const towels: Part[] = [];
  const clump = (x: number, z: number) => Math.sin(x / 47 + seed) * Math.cos(z / 41 - seed) + 0.5 * Math.sin((x - z) / 29);
  const palm = (x: number, z: number, lean: [number, number], scale: number) => {
    // Its trunk curves toward `lean` (local +x).
    const yaw = Math.atan2(-lean[1], lean[0]) + rng.range(-0.4, 0.4);
    palms.push({ x, y: land.height(x, z) - 0.2, z, yaw, sx: scale, sy: scale * rng.range(0.85, 1.2), sz: scale, color: pick(PALM_LEAVES) });
  };
  /** The way out to sea from (x, z): down the coast's distance. */
  const seaward = (x: number, z: number): [number, number] => {
    const gx = coast(x + 2, z) - coast(x - 2, z);
    const gz = coast(x, z + 2) - coast(x, z - 2);
    const l = Math.hypot(gx, gz) || 1;
    return [-gx / l, -gz / l];
  };
  const bx0 = x0 - 120;
  const bz0 = z0 - 120;
  const bx1 = x1 + 120;
  const bz1 = z1 + 120;
  // Huts on the beach, thatched, now and then along the coast (before the trees, so none grows
  // through one).
  for (let k = 0; k < 400; k++) {
    const x = rng.range(bx0, bx1);
    const z = rng.range(bz0, bz1);
    const sd = coast(x, z);
    if (sd < 6 || sd > 20 || roadGap(x, z) < 8 || kept(x, z) || !dry(x, z)) continue;
    const y = land.height(x, z);
    const yaw = rng.range(0, Math.PI);
    plain.push({ x, y: y + 1.1, z, yaw, sx: 3.2, sy: 2.2, sz: 3.6, color: 0xc9a46a });
    thatch.push({ x, y: y + 2.2, z, yaw, sx: 4.4, sy: 2.2, sz: 4.8, color: 0xd9b870 });
    keep.push({ x, z, r: 4 });
  }

  for (let z = bz0; z < bz1; z += 7) {
    for (let x = bx0; x < bx1; x += 7) {
      const px = x + rng.range(-3, 3);
      const pz = z + rng.range(-3, 3);
      const sd = coast(px, pz);
      if (sd < 1.5 || kept(px, pz)) continue;
      const gap = roadGap(px, pz, 60);
      if (gap < 3) continue;
      const y = land.height(px, pz);
      if (y < seaY + 0.4) continue;
      const cone = onCone(px, pz);
      if (cone < 0.66) continue;
      const beach = sd < 26;
      if (beach) {
        // The beach: palms leaning out to sea (or over the road, right beside it), umbrellas.
        if (gap < 8 && rng.next() < 0.35) {
          roadGap(px, pz, 20);
          const l = Math.hypot(nearX - px, nearZ - pz) || 1;
          palm(px, pz, [(nearX - px) / l, (nearZ - pz) / l], rng.range(0.9, 1.15));
        } else if (gap >= 8 && rng.next() < 0.16) palm(px, pz, seaward(px, pz), rng.range(0.8, 1.2));
        else if (gap >= 6 && sd < 16 && rng.next() < 0.05) {
          const c = pick(CANOPIES);
          poles.push({ x: px, y: y + 1.1, z: pz, yaw: 0, sx: 0.08, sy: 2.2, sz: 0.08, color: 0xf4efe6 });
          canopies.push({ x: px, y: y + 2.2, z: pz, yaw: rng.range(0, 6), sx: 1.6, sy: 0.7, sz: 1.6, color: c });
          towels.push({ x: px + rng.range(0.6, 1.6), y: y + 0.05, z: pz + rng.range(-0.6, 0.6), yaw: rng.range(0, 6), sx: 0.9, sy: 0.04, sz: 1.8, color: pick(CANOPIES) });
        }
        continue;
      }
      // Inland: jungle, thickest near the switchbacks and in the clumps, thin in town.
      if (gap < 5) {
        if (rng.next() < 0.2) bushes.push({ x: px, y: y - 0.2, z: pz, yaw: rng.range(0, 6), sx: rng.range(1, 2), sy: rng.range(0.8, 1.4), sz: rng.range(1, 2), color: pick(JUNGLE) });
        continue;
      }
      const dense = clump(px, pz) < 0.3;
      if (rng.next() < (dense ? 0.25 : 0.7)) continue;
      if (rng.next() < 0.25) palm(px, pz, [rng.range(-1, 1), rng.range(-1, 1)], rng.range(0.9, 1.3));
      else {
        const sc = rng.range(0.8, 1.5);
        const tall = rng.range(4, 9) * sc;
        trunks.push({ x: px, y: y - 0.3, z: pz, yaw: 0, sx: sc, sy: tall, sz: sc, color: 0x6b4a32 });
        crowns.push({ x: px, y: y + tall - 0.5, z: pz, yaw: rng.range(0, 6), sx: sc * rng.range(2.2, 3.4), sy: sc * rng.range(1.6, 2.4), sz: sc * rng.range(2.2, 3.4), color: pick(JUNGLE) });
        if (rng.next() < 0.4) bushes.push({ x: px + rng.range(-3, 3), y: y - 0.2, z: pz + rng.range(-3, 3), yaw: rng.range(0, 6), sx: rng.range(1.2, 2.4), sy: rng.range(0.8, 1.5), sz: rng.range(1.2, 2.4), color: pick(JUNGLE) });
      }
    }
  }
  // ---- gulls over the harbour and the beaches ----
  {
    const pos: number[] = [];
    const phase: number[] = [];
    const col: number[] = [];
    for (let k = 0; k < 24; k++) {
      const i = at(main, ((k % 3) * 0.12 + rng.range(-0.04, 0.04) + 1) % 1 * L);
      pos.push(main.px[i], main.py[i] + 14, main.pz[i]);
      phase.push(rng.next());
      col.push(0.98, 0.98, 0.96);
    }
    objects.push(animatedPoints(pos, phase, col, 'gull', 0.9, time));
  }

  // ---- signs at the shortcuts, facing the drivers coming up to them ----
  {
    const names: Record<string, string> = { sandbar: 'SANDBAR', 'lava-tube': 'LAVA TUBE' };
    for (const sp of track.splines.slice(1)) {
      const i = at(main, (sp.mainFrom - 25 + L) % L);
      const side = branchSide(main, sp);
      const off = main.width[i] / 2 + main.shoulder[i] + 2;
      const x = main.px[i] - main.tz[i] * off * side;
      const z = main.pz[i] + main.tx[i] * off * side;
      const y = Math.max(land.height(x, z), main.py[i] - 1);
      const tex = canvas(256, 96, (g) => {
        g.fillStyle = '#1f8a8a';
        g.fillRect(0, 0, 256, 96);
        g.strokeStyle = '#f6d38a';
        g.lineWidth = 8;
        g.strokeRect(4, 4, 248, 88);
        g.fillStyle = '#fff8e6';
        g.font = `34px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(`${side > 0 ? '' : '◀ '}${names[sp.id] ?? sp.id.toUpperCase()}${side > 0 ? ' ▶' : ''}`, 128, 50);
      });
      const sign = new Mesh(new PlaneGeometry(4, 1.5), new MeshBasicMaterial({ map: tex, side: DoubleSide }));
      sign.position.set(x, y + 2.4, z);
      sign.rotation.y = Math.atan2(main.tx[i], main.tz[i]) + Math.PI;
      objects.push(sign);
      for (const d of [-1, 1]) poles.push({ x: x - Math.cos(sign.rotation.y) * 1.6 * d, y: y + 1, z: z + Math.sin(sign.rotation.y) * 1.6 * d, yaw: 0, sx: 0.18, sy: 2, sz: 0.18, color: 0x8a6a3e });
    }
  }

  // ---- meshes ----
  const tint = toon();
  const unit = new BoxGeometry(1, 1, 1);
  const palmGeo = palmGeometry();
  const trunkMat = swaying(time, 0.006);
  trunkMat.color = new Color(0x8a6a44);
  // The trunks keep their own brown (the instance colors are the fronds').
  objects.push(instanced(palmGeo.trunk, trunkMat, palms.map((p) => ({ ...p, color: 0xffffff }))), instanced(palmGeo.fronds, swaying(time, 0.006), palms));
  objects.push(instanced(new CylinderGeometry(0.22, 0.3, 1, 6).translate(0, 0.5, 0), tint, trunks));
  // A crown (a unit ball scaled 2–3×) sways as if it were ~3 units up its trunk: 20–40 cm at its top.
  objects.push(instanced(faceted(new IcosahedronGeometry(1, 0)), swaying(time, 0.01, 3), crowns));
  objects.push(instanced(faceted(new IcosahedronGeometry(0.9, 0).translate(0, 0.5, 0)), tint, bushes));
  objects.push(instanced(faceted(new IcosahedronGeometry(1, 0)), tint, lavaRocks));
  objects.push(instanced(unit, toon({ map: houseTexture() }), houses), instanced(unit, tint, plain), instanced(prism(), toon({ side: DoubleSide }), roofs));
  objects.push(instanced(faceted(new ConeGeometry(0.72, 1, 4).rotateY(Math.PI / 4)), tint, thatch));
  objects.push(instanced(unit, tint, poles), instanced(faceted(new ConeGeometry(1, 1, 8)), tint, canopies), instanced(unit, tint, towels));
  objects.push(instanced(faceted(new CylinderGeometry(0.5, 0.35, 1, 6).rotateX(Math.PI / 2)), tint, boats), instanced(unit, tint, cabins), instanced(unit, tint, masts));
  objects.push(instanced(faceted(new IcosahedronGeometry(0.62, 0).scale(1, 1, 1)), tint, tubeRock.filter((p) => p.roll !== undefined)), instanced(unit, tint, tubeRock.filter((p) => p.roll === undefined)));
  objects.push(instanced(unit, tint, ropes));
  if (lavaStrips.length) objects.push(instanced(unit, new MeshBasicMaterial({ color: 0xff7a1a }), lavaStrips));
  if (tubeLights.length) objects.push(glowPoints(tubeLights, 0xff7a2a, 7));
  if (torches.length) objects.push(glowPoints(torches, 0xffa040, 2.6));

  return {
    objects,
    update(t) {
      time.value = t;
      for (const u of updates) u(t);
    },
    covers: tube ? [{ spline: tube.index, from: tube.length * 0.22, to: tube.length * 0.78, height: TUBE_H + 0.6 }] : [],
  };
}
