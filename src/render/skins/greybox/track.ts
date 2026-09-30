// Greybox track meshes: one merged, vertex-colored mesh per 60 m chunk (road, markings, shoulders,
// curbs, walls with their gaps), city blocks beyond the walls as one instanced mesh, and a ground
// plane. Flat shading, one color per surface: readable, and cheap on any machine.

import {
  AddEquation,
  BoxGeometry,
  CustomBlending,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  SrcAlphaFactor,
  ZeroFactor,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Object3D,
} from 'three';
import { Rng } from '../../../core/rng';
import type { BakedSpline, Track } from '../../../core/track/bake';
import { newHit, projectGlobal, sampleAt } from '../../../core/track/query';
import type { TrackVisual } from '../../skin';
import { buildCityscape } from './cityscape';
import { faceted, toon, WET } from './toon';
import type { Palette } from './palettes';

const WALL_HEIGHT = 1.1;
const WALL_THICK = 0.5;
const CURB = 0.14;
/** Street level for city scenery; roads well above it are bridges, below it trenches. */
export const CITY_GROUND = -0.25;
/** A road this far above the ground is a deck on pillars, not an embankment. */
const BRIDGE_H = 3.5;
/** Deck thickness under a bridge. */
const DECK = 1.2;
/** A road this far below the ground is covered: a tunnel. */
const TUNNEL_H = 4.5;
/** A trench's retaining wall stands this high above the ground, and its lip reaches this far. */
const RAIL = 0.9;
const LIP = 5;
/** A bridge's barrier height; the railing on it reaches the full wall height and a bit. */
const BARRIER = 0.55;
const RAIL_TOP = 1.25;

class Geo {
  pos: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  private c = new Color();
  /** Multiplies every color (the tunnel's shade). */
  shade = 1;
  face(a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[], color: number | string): void {
    this.quad(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2], color);
  }
  quad(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, color: number | string): void {
    const base = this.pos.length / 3;
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
    this.c.set(color).multiplyScalar(this.shade);
    for (let k = 0; k < 4; k++) this.col.push(this.c.r, this.c.g, this.c.b);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

interface Cross {
  cx: number;
  cy: number;
  cz: number;
  rx: number;
  rz: number;
  tb: number;
}

function cross(sp: BakedSpline, i: number, out: Cross): Cross {
  out.cx = sp.px[i];
  out.cy = sp.py[i] + sp.ramp[i];
  out.cz = sp.pz[i];
  out.rx = -sp.tz[i];
  out.rz = sp.tx[i];
  out.tb = Math.tan(sp.bank[i]);
  return out;
}

export function buildTrackVisual(track: Track, palette: Palette, seed: number): TrackVisual {
  const road = toon({ vertexColors: true, side: DoubleSide });
  const chunks: Object3D[] = [];
  let minY = Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const sp of track.splines) {
    for (let i = 0; i < sp.n; i++) {
      minY = Math.min(minY, sp.py[i]);
      minX = Math.min(minX, sp.px[i]);
      maxX = Math.max(maxX, sp.px[i]);
      minZ = Math.min(minZ, sp.pz[i]);
      maxZ = Math.max(maxZ, sp.pz[i]);
    }
  }
  const city = track.layout.scenery === 'city';
  const groundY = city ? CITY_GROUND : minY - 0.4;

  for (const sp of track.splines) {
    for (let k = 0; k < sp.chunks.length - 1; k++) {
      const g = new Geo();
      buildChunk(g, track, sp, sp.chunks[k], sp.chunks[k + 1], groundY, city);
      const mesh = new Mesh(g.build(), road);
      mesh.matrixAutoUpdate = false;
      chunks.push(mesh);
    }
  }

  const ground = new Mesh(new PlaneGeometry(maxX - minX + 3000, maxZ - minZ + 3000), toon({ color: palette.ground }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((minX + maxX) / 2, groundY, (minZ + maxZ) / 2);
  ground.updateMatrix();
  ground.matrixAutoUpdate = false;

  // The city lays its own ground (streets, with holes where a trench runs).
  const extras: Object3D[] = city ? [] : [ground];
  const wet = puddles(track);
  if (wet) extras.push(wet);
  // Solid props on the road (the pillars): tall striped boxes.
  const solid = track.props.filter((p) => p.solid);
  if (solid.length) {
    const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), toon({ color: 0xbfb3d6 }), solid.length);
    const mat = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    solid.forEach((p, k) => {
      mat.compose(new Vector3(p.x, p.y + p.hy, p.z), q.setFromAxisAngle(up, p.heading), new Vector3(p.hx * 2, p.hy * 2, p.hz * 2));
      mesh.setMatrixAt(k, mat);
    });
    mesh.computeBoundingSphere();
    extras.push(mesh);
  }
  let update: TrackVisual['update'];
  if (city) {
    const scape = buildCityscape(track, palette, groundY);
    extras.push(...scape.objects);
    update = scape.update;
  }
  if (track.layout.scenery === 'countryside') extras.push(...countryside(track, palette, seed, groundY));

  return {
    chunks,
    extras,
    debug: debugVolumes(track),
    update,
    dispose() {
      for (const c of chunks) (c as Mesh).geometry.dispose();
      road.dispose();
    },
  };
}

/** Steel railing along one edge between two cross-sections: posts every 3 m, a top and a mid rail. */
function railing(g: Geo, A: Cross, B: Cross, la: number, lb: number, s: number, step: number): void {
  const at = (c: Cross, l: number, y: number) => [c.cx + c.rx * l, c.cy - l * c.tb + y, c.cz + c.rz * l];
  const bar = (y0: number, y1: number, half: number, color: string) => {
    const a0 = at(A, la - half, y0);
    const a1 = at(A, la + half, y0);
    const b0 = at(B, lb - half, y0);
    const b1 = at(B, lb + half, y0);
    const a2 = at(A, la - half, y1);
    const a3 = at(A, la + half, y1);
    const b2 = at(B, lb - half, y1);
    const b3 = at(B, lb + half, y1);
    g.face(a2, b2, b3, a3, color);
    g.face(a0, b0, b2, a2, color);
    g.face(a1, b1, b3, a3, color);
  };
  bar(CURB + RAIL_TOP - 0.12, CURB + RAIL_TOP, 0.09, '#c9c0e0');
  bar(CURB + 0.86, CURB + 0.92, 0.05, '#a89cc0');
  if (Math.floor(s / 3) !== Math.floor((s + step) / 3)) {
    // A post: a thin box at A, the length of a tenth of a step along the road.
    const t = 0.12;
    const post = (dl: number, y: number) => at(A, la + dl, y);
    const dx = (B.cx - A.cx) * t;
    const dz = (B.cz - A.cz) * t;
    const p = [post(-0.07, CURB + BARRIER), post(0.07, CURB + BARRIER), post(-0.07, CURB + RAIL_TOP), post(0.07, CURB + RAIL_TOP)];
    const q = p.map((v) => [v[0] + dx, v[1], v[2] + dz]);
    g.face(p[0], p[1], p[3], p[2], '#8f84a8');
    g.face(q[0], q[1], q[3], q[2], '#8f84a8');
    g.face(p[0], q[0], q[2], p[2], '#8f84a8');
    g.face(p[1], q[1], q[3], p[3], '#8f84a8');
  }
}

function buildChunk(g: Geo, track: Track, sp: BakedSpline, i0: number, i1: number, groundY: number, levels: boolean): void {
  const A: Cross = { cx: 0, cy: 0, cz: 0, rx: 0, rz: 0, tb: 0 };
  const B: Cross = { cx: 0, cy: 0, cz: 0, rx: 0, rz: 0, tb: 0 };
  const at = (c: Cross, l: number, lift: number) => [c.cx + c.rx * l, c.cy - l * c.tb + lift, c.cz + c.rz * l] as const;
  const shoulderColor = track.surfaces[track.surfaceIndex.get(track.layout.shoulderSurface ?? 'sidewalk') ?? 0].color;
  const last = sp.closed ? i1 : Math.min(i1, sp.n - 1);
  for (let i = i0; i < last; i++) {
    const j = sp.closed ? (i + 1) % sp.n : i + 1;
    cross(sp, i, A);
    cross(sp, j, B);
    const wa = sp.width[i] / 2;
    const wb = sp.width[j] / 2;
    const sa = wa + sp.shoulder[i];
    const sb = wb + sp.shoulder[j];
    const s = i * sp.step;
    const surf = track.surfaces[sp.surface[i]];
    // Levels (city): high roads are decks on pillars, low ones trenches, very low ones tunnels.
    const hA = A.cy - groundY;
    const hB = B.cy - groundY;
    const bridge = levels && Math.min(hA, hB) > BRIDGE_H;
    const sunk = levels && Math.max(hA, hB) < -0.5;
    const covered = levels && Math.max(hA, hB) < -TUNNEL_H;
    g.shade = covered ? 0.5 : 1;
    const outer = [0, 0];

    // Road deck (right edge to left edge, winding up).
    let p = at(A, -wa, 0);
    let q = at(A, wa, 0);
    let r = at(B, wa, 0);
    let t = at(B, -wa, 0);
    g.quad(q[0], q[1], q[2], p[0], p[1], p[2], t[0], t[1], t[2], r[0], r[1], r[2], surf.color);

    // Shoulders (sidewalks) with a curb step, both sides.
    for (const side of [-1, 1]) {
      const inA = at(A, side * wa, CURB);
      const inB = at(B, side * wb, CURB);
      const outA = at(A, side * sa, CURB);
      const outB = at(B, side * sb, CURB);
      const curbA = at(A, side * wa, 0);
      const curbB = at(B, side * wb, 0);
      const color = shoulderColor;
      if (side < 0) g.quad(inA[0], inA[1], inA[2], outA[0], outA[1], outA[2], outB[0], outB[1], outB[2], inB[0], inB[1], inB[2], color);
      else g.quad(outA[0], outA[1], outA[2], inA[0], inA[1], inA[2], inB[0], inB[1], inB[2], outB[0], outB[1], outB[2], color);
      // Curb face, striped red and white on corners of the lap for speed.
      const stripe = Math.floor(s / 4) % 2 === 0 ? '#e0d6f0' : '#c43a5a';
      if (side < 0) g.quad(curbA[0], curbA[1], curbA[2], inA[0], inA[1], inA[2], inB[0], inB[1], inB[2], curbB[0], curbB[1], curbB[2], stripe);
      else g.quad(inA[0], inA[1], inA[2], curbA[0], curbA[1], curbA[2], curbB[0], curbB[1], curbB[2], inB[0], inB[1], inB[2], stripe);

      const wall = side < 0 ? sp.wallL[i] && sp.wallL[j] : sp.wallR[i] && sp.wallR[j];
      const baseA = at(A, side * sa, CURB);
      const baseB = at(B, side * sb, CURB);
      // Where the outside drops to: the deck's underside on a bridge, else the ground.
      const lowA = bridge ? A.cy - DECK : groundY;
      const lowB = bridge ? B.cy - DECK : groundY;
      if (wall) {
        // A trench's walls hold the ground back, so they reach up past it.
        // A bridge's is a low barrier with a railing on top, so you can see over the edge.
        const plain = bridge ? CURB + BARRIER : CURB + WALL_HEIGHT;
        const liftA = sunk ? Math.max(plain, groundY + RAIL - A.cy) : plain;
        const liftB = sunk ? Math.max(plain, groundY + RAIL - B.cy) : plain;
        const topA = at(A, side * sa, liftA);
        const topB = at(B, side * sb, liftB);
        const backA = at(A, side * (sa + WALL_THICK), liftA);
        const backB = at(B, side * (sb + WALL_THICK), liftB);
        const face = sunk ? (Math.floor(s / 6) % 2 === 0 ? '#9a8fb0' : '#8a7fa2') : Math.floor(s / 12) % 2 === 0 ? '#d8cfe8' : '#bfb3d6';
        g.face(baseA, baseB, topB, topA, face);
        g.face(topA, topB, backB, backA, '#8f84a8');
        g.face(backA, backB, [backB[0], lowB, backB[2]], [backA[0], lowA, backA[2]], '#3a2f52');
        if (sunk) {
          // A lip of pavement round the top, so the ground meets the trench with no gap.
          const lipA = at(A, side * (sa + WALL_THICK + LIP), 0);
          const lipB = at(B, side * (sb + WALL_THICK + LIP), 0);
          const y = groundY + 0.01;
          g.face([backA[0], y, backA[2]], [backB[0], y, backB[2]], [lipB[0], y, lipB[2]], [lipA[0], y, lipA[2]], '#6d5f86');
        }
        outer[side < 0 ? 0 : 1] = WALL_THICK;
        if (bridge) railing(g, A, B, side * (sa + WALL_THICK / 2), side * (sb + WALL_THICK / 2), s, sp.step);
      } else if (baseA[1] > lowA + 0.2) {
        // No wall: the shoulder's edge drops to the ground (or the deck's underside).
        g.face(baseA, baseB, [baseB[0], lowB, baseB[2]], [baseA[0], lowA, baseA[2]], '#3a2f52');
      }
    }
    if (bridge) {
      // The deck's underside.
      const l = -(sa + outer[0]);
      const r = sa + outer[1];
      const la = at(A, l, 0);
      const ra = at(A, r, 0);
      const lb = at(B, -(sb + outer[0]), 0);
      const rb = at(B, sb + outer[1], 0);
      g.face([la[0], A.cy - DECK, la[2]], [lb[0], B.cy - DECK, lb[2]], [rb[0], B.cy - DECK, rb[2]], [ra[0], A.cy - DECK, ra[2]], '#2c2440');
    }
    if (covered) {
      // The tunnel roof: a concrete slab at street level, the plaza on top.
      const la = at(A, -(sa + WALL_THICK), 0);
      const ra = at(A, sa + WALL_THICK, 0);
      const lb = at(B, -(sb + WALL_THICK), 0);
      const rb = at(B, sb + WALL_THICK, 0);
      const under = groundY - 0.6;
      g.face([la[0], under, la[2]], [lb[0], under, lb[2]], [rb[0], under, rb[2]], [ra[0], under, ra[2]], '#5a5070');
      g.shade = 1;
      const top = groundY + 0.02;
      g.face([la[0], top, la[2]], [ra[0], top, ra[2]], [rb[0], top, rb[2]], [lb[0], top, lb[2]], (Math.floor(s / 8) + Math.floor(Math.abs(la[0]) / 8)) % 2 === 0 ? '#7a6c96' : '#6d5f86');
      g.shade = 0.5;
    }

    // Markings: solid edge lines, dashed lane lines (the center one yellow), a checkered finish.
    const lanes = sp.lanes[i] || 2;
    const lift = 0.02;
    const line = (l0: number, l1: number, color: string) => {
      p = at(A, l0, lift);
      q = at(A, l1, lift);
      r = at(B, l1, lift);
      t = at(B, l0, lift);
      g.quad(q[0], q[1], q[2], p[0], p[1], p[2], t[0], t[1], t[2], r[0], r[1], r[2], color);
    };
    line(-wa + 0.35, -wa + 0.5, '#f4efe6');
    line(wa - 0.5, wa - 0.35, '#f4efe6');
    if (s % 10 < 3.5) {
      for (let k = 1; k < lanes; k++) {
        const l = -wa + (k * 2 * wa) / lanes;
        const center = lanes % 2 === 0 && k === lanes / 2;
        line(l - 0.09, l + 0.09, center ? '#ffc93c' : '#f4efe6');
      }
    }
    if (sp.index === 0 && s < 4) {
      const cells = 12;
      for (let k = 0; k < cells; k++) {
        const l0 = -wa + (k * 2 * wa) / cells;
        const l1 = l0 + (2 * wa) / cells;
        line(l0, l1, (k + Math.floor(s)) % 2 === 0 ? '#f4efe6' : '#120a20');
      }
    }
  }
}

/** Trees in clumps along the road, and flat field patches: enough to read speed and the lie of the land. */
function countryside(track: Track, palette: Palette, seed: number, groundY: number): Object3D[] {
  const rng = Rng.stream(seed, 'scenery');
  const hit = newHit();
  const trees: { x: number; y: number; z: number; s: number; c: number }[] = [];
  const fields: { x: number; y: number; z: number; w: number; d: number; h: number; c: number }[] = [];
  const clear = (x: number, z: number, r: number) => {
    for (const other of track.splines) {
      projectGlobal(other, x, z, hit);
      if (Math.abs(hit.lateral) < hit.width / 2 + hit.shoulder + r + 2 && hit.s > 0.5 && hit.s < other.length - 0.5) return false;
    }
    return true;
  };
  for (const sp of track.splines) {
    for (let s = 0; s < sp.length; s += rng.range(6, 14)) {
      const i = Math.min(sp.n - 1, Math.round(s / sp.step));
      const edge = sp.width[i] / 2 + sp.shoulder[i] + 3;
      for (const side of [-1, 1]) {
        if (rng.next() < 0.45) continue;
        const off = edge + rng.range(0, 40) * rng.next();
        const x = sp.px[i] - sp.tz[i] * off * side;
        const z = sp.pz[i] + sp.tx[i] * off * side;
        if (!clear(x, z, 2)) continue;
        trees.push({ x, y: sp.py[i], z, s: rng.range(0.7, 1.5), c: palette.blocks[Math.floor(rng.next() * 4)] });
      }
      if (rng.next() < 0.05) {
        const side = rng.next() < 0.5 ? -1 : 1;
        const off = edge + 30 + rng.range(0, 60);
        const x = sp.px[i] - sp.tz[i] * off * side;
        const z = sp.pz[i] + sp.tx[i] * off * side;
        if (clear(x, z, 25)) fields.push({ x, y: groundY + 0.05, z, w: rng.range(40, 90), d: rng.range(40, 90), h: Math.atan2(sp.tx[i], sp.tz[i]), c: [0xc9a94a, 0x8fae4a, 0x6f8f3a, 0xb58a4a][Math.floor(rng.next() * 4)] });
      }
    }
  }
  const crown = new InstancedMesh(faceted(new ConeGeometry(2.4, 7, 7).translate(0, 5.5, 0)), toon(), trees.length);
  const trunk = new InstancedMesh(new BoxGeometry(0.5, 2.2, 0.5).translate(0, 1.1, 0), toon({ color: 0x5a3f2a }), trees.length);
  const m = new Matrix4();
  const q = new Quaternion();
  const c = new Color();
  trees.forEach((t, k) => {
    m.compose(new Vector3(t.x, Math.min(t.y, groundY + 20) - 0.5, t.z), q, new Vector3(t.s, t.s, t.s));
    crown.setMatrixAt(k, m);
    trunk.setMatrixAt(k, m);
    crown.setColorAt(k, c.set(t.c));
  });
  crown.computeBoundingSphere();
  trunk.computeBoundingSphere();
  const patch = new InstancedMesh(new BoxGeometry(1, 0.1, 1), toon(), Math.max(1, fields.length));
  const up = new Vector3(0, 1, 0);
  fields.forEach((f, k) => {
    m.compose(new Vector3(f.x, f.y, f.z), q.setFromAxisAngle(up, f.h), new Vector3(f.w, 1, f.d));
    patch.setMatrixAt(k, m);
    patch.setColorAt(k, c.set(f.c));
  });
  patch.count = fields.length;
  patch.computeBoundingSphere();
  return [crown, trunk, patch];
}

function debugVolumes(track: Track): Object3D {
  const group = new Group();
  const cpMat = new MeshBasicMaterial({ color: 0x35f0ff, transparent: true, opacity: 0.18, side: DoubleSide, depthWrite: false });
  const gapMat = new MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.25, side: DoubleSide, depthWrite: false });
  const main = track.main;
  for (const cp of track.checkpoints) {
    const i = Math.round(cp / main.step) % main.n;
    const gate = new Mesh(new PlaneGeometry(main.width[i] + 2 * main.shoulder[i], 6), cpMat);
    gate.position.set(main.px[i], main.py[i] + 3, main.pz[i]);
    gate.rotation.y = Math.atan2(main.tx[i], main.tz[i]);
    group.add(gate);
  }
  for (const sp of track.splines.slice(1)) {
    for (const s of [sp.mainFrom, sp.mainTo]) {
      const i = Math.round(s / main.step) % main.n;
      const post = new Mesh(new BoxGeometry(1, 8, 1), gapMat);
      post.position.set(main.px[i], main.py[i] + 4, main.pz[i]);
      group.add(post);
    }
  }
  group.visible = false;
  return group;
}

/**
 * The rain's puddles (zones on a 'puddle' surface), drawn as dark water that fades in with the
 * wetness. They're slippery, so they must be seen: each also clears the alpha channel where it's
 * drawn, which the post pass reads as "mirror here" for its reflections.
 */
function puddles(track: Track): Object3D | null {
  const pos: number[] = [];
  const uv: number[] = [];
  const seed: number[] = [];
  const idx: number[] = [];
  const hit = newHit();
  let k = 0;
  for (const sp of track.splines) {
    for (const z of sp.zones) {
      if (track.surfaces[z.surface]?.id !== 'puddle') continue;
      const { s0, s1, l0, l1 } = z;
      const steps = Math.max(2, Math.ceil((s1 - s0) / 1.5));
      const across = 6;
      const base = pos.length / 3;
      for (let a = 0; a <= steps; a++) {
        const s = s0 + ((s1 - s0) * a) / steps;
        sampleAt(sp, s, hit);
        const tb = Math.tan(hit.bank);
        for (let b = 0; b <= across; b++) {
          const l = l0 + ((l1 - l0) * b) / across;
          pos.push(hit.cx - hit.tz * l, hit.cy - l * tb + 0.03, hit.cz + hit.tx * l);
          uv.push(a / steps, b / across);
          seed.push(k * 1.7);
        }
      }
      for (let a = 0; a < steps; a++) {
        for (let b = 0; b < across; b++) {
          const i = base + a * (across + 1) + b;
          idx.push(i, i + across + 1, i + 1, i + 1, i + across + 1, i + across + 2);
        }
      }
      k++;
    }
  }
  if (!pos.length) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('seed', new Float32BufferAttribute(seed, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const mat = new ShaderMaterial({
    uniforms: { uWet: WET },
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: SrcAlphaFactor,
    blendDst: OneMinusSrcAlphaFactor,
    // Alpha: dst * (1 - src), so a puddle's middle writes ~0: the post pass's mirror mask.
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
    vertexShader: `attribute float seed;varying vec2 vUv;varying float vSeed;
      void main(){vUv=uv;vSeed=seed;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `uniform float uWet;varying vec2 vUv;varying float vSeed;
      void main(){
        vec2 q=(vUv-0.5)*2.0;
        float ang=atan(q.y,q.x);
        // A wobbly blob, not a rectangle.
        float d=length(q)+0.1*sin(ang*3.0+vSeed)+0.07*sin(ang*7.0+vSeed*2.3)+0.05*sin(q.x*11.0+vSeed);
        float a=(1.0-smoothstep(0.7,0.92,d))*smoothstep(0.1,0.6,uWet);
        gl_FragColor=vec4(0.07,0.08,0.16,a*0.85);
      }`,
  });
  const mesh = new Mesh(g, mat);
  mesh.renderOrder = 2;
  return mesh;
}
