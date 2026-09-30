// Greybox track meshes: one merged, vertex-colored mesh per 60 m chunk (road, markings, shoulders,
// curbs, walls with their gaps), city blocks beyond the walls as one instanced mesh, and a ground
// plane. Flat shading, one color per surface: readable, and cheap on any machine.

import {
  BoxGeometry,
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
import { newHit, projectGlobal } from '../../../core/track/query';
import type { TrackVisual } from '../../skin';
import { streetLamps, windowMaterial } from './city';
import { faceted, toon } from './toon';
import type { Palette } from './palettes';

const WALL_HEIGHT = 1.1;
const WALL_THICK = 0.5;
const CURB = 0.14;

class Geo {
  pos: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  private c = new Color();
  quad(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, color: number | string): void {
    const base = this.pos.length / 3;
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
    this.c.set(color);
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
  const groundY = minY - 0.4;

  for (const sp of track.splines) {
    for (let k = 0; k < sp.chunks.length - 1; k++) {
      const g = new Geo();
      buildChunk(g, track, sp, sp.chunks[k], sp.chunks[k + 1], groundY);
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

  const extras: Object3D[] = [ground];
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
  if (track.layout.scenery === 'city') extras.push(cityBlocks(track, palette, seed, groundY), streetLamps(track));
  if (track.layout.scenery === 'countryside') extras.push(...countryside(track, palette, seed, groundY));

  return {
    chunks,
    extras,
    debug: debugVolumes(track),
    dispose() {
      for (const c of chunks) (c as Mesh).geometry.dispose();
      road.dispose();
    },
  };
}

function buildChunk(g: Geo, track: Track, sp: BakedSpline, i0: number, i1: number, groundY: number): void {
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
      const downA = [baseA[0], groundY, baseA[2]] as const;
      const downB = [baseB[0], groundY, baseB[2]] as const;
      if (wall) {
        const topA = at(A, side * sa, CURB + WALL_HEIGHT);
        const topB = at(B, side * sb, CURB + WALL_HEIGHT);
        const backA = at(A, side * (sa + WALL_THICK), CURB + WALL_HEIGHT);
        const backB = at(B, side * (sb + WALL_THICK), CURB + WALL_HEIGHT);
        const bottomA = [backA[0], groundY, backA[2]] as const;
        const bottomB = [backB[0], groundY, backB[2]] as const;
        const face = Math.floor(s / 12) % 2 === 0 ? '#d8cfe8' : '#bfb3d6';
        if (side < 0) {
          g.quad(baseA[0], baseA[1], baseA[2], baseB[0], baseB[1], baseB[2], topB[0], topB[1], topB[2], topA[0], topA[1], topA[2], face);
          g.quad(topA[0], topA[1], topA[2], topB[0], topB[1], topB[2], backB[0], backB[1], backB[2], backA[0], backA[1], backA[2], '#8f84a8');
          g.quad(backA[0], backA[1], backA[2], backB[0], backB[1], backB[2], bottomB[0], bottomB[1], bottomB[2], bottomA[0], bottomA[1], bottomA[2], '#3a2f52');
        } else {
          g.quad(baseB[0], baseB[1], baseB[2], baseA[0], baseA[1], baseA[2], topA[0], topA[1], topA[2], topB[0], topB[1], topB[2], face);
          g.quad(topB[0], topB[1], topB[2], topA[0], topA[1], topA[2], backA[0], backA[1], backA[2], backB[0], backB[1], backB[2], '#8f84a8');
          g.quad(backB[0], backB[1], backB[2], backA[0], backA[1], backA[2], bottomA[0], bottomA[1], bottomA[2], bottomB[0], bottomB[1], bottomB[2], '#3a2f52');
        }
      } else if (baseA[1] > groundY + 0.2) {
        // No wall: the shoulder's edge drops to the ground.
        if (side < 0) g.quad(baseA[0], baseA[1], baseA[2], baseB[0], baseB[1], baseB[2], downB[0], downB[1], downB[2], downA[0], downA[1], downA[2], '#3a2f52');
        else g.quad(baseB[0], baseB[1], baseB[2], baseA[0], baseA[1], baseA[2], downA[0], downA[1], downA[2], downB[0], downB[1], downB[2], '#3a2f52');
      }
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

/** Blocky buildings along the walls, seeded so the city is the same every time. */
function cityBlocks(track: Track, palette: Palette, seed: number, groundY: number): Object3D {
  const rng = Rng.stream(seed, 'scenery');
  const placed: { x: number; z: number; w: number; d: number; h: number; heading: number; color: number }[] = [];
  const hit = newHit();
  for (const sp of track.splines) {
    let s = 0;
    while (s < sp.length) {
      const i = Math.min(sp.n - 1, Math.round(s / sp.step));
      const edge = sp.width[i] / 2 + sp.shoulder[i] + WALL_THICK;
      for (const side of [-1, 1]) {
        if (rng.next() < 0.12) continue;
        const w = rng.range(12, 24);
        const d = rng.range(12, 22);
        const h = rng.range(10, 55) * (rng.next() < 0.12 ? 1.8 : 1);
        const off = edge + rng.range(3, 9) + d / 2;
        const rx = -sp.tz[i];
        const rz = sp.tx[i];
        const x = sp.px[i] + rx * off * side;
        const z = sp.pz[i] + rz * off * side;
        // Keep clear of every road, including the ones this block isn't next to.
        let clear = true;
        const radius = Math.hypot(w, d) / 2;
        for (const other of track.splines) {
          projectGlobal(other, x, z, hit);
          if (Math.abs(hit.lateral) < hit.width / 2 + hit.shoulder + WALL_THICK + radius + 2 && hit.s > 0.5 && hit.s < other.length - 0.5) clear = false;
          if (!other.closed && (hit.s <= 0.5 || hit.s >= other.length - 0.5)) {
            // Past the end of a branch: measure to its end point instead.
            const e = hit.s <= 0.5 ? 0 : other.n - 1;
            if (Math.hypot(other.px[e] - x, other.pz[e] - z) < radius + other.width[e]) clear = false;
          }
        }
        if (!clear) continue;
        placed.push({ x, z, w, d, h, heading: Math.atan2(sp.tx[i], sp.tz[i]), color: palette.blocks[Math.floor(rng.next() * palette.blocks.length)] });
      }
      s += rng.range(18, 28);
    }
  }
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), windowMaterial(palette.windows), placed.length);
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const c = new Color();
  placed.forEach((b, k) => {
    q.setFromAxisAngle(up, b.heading);
    m.compose(new Vector3(b.x, groundY + b.h / 2, b.z), q, new Vector3(b.w, b.h, b.d));
    mesh.setMatrixAt(k, m);
    mesh.setColorAt(k, c.set(b.color));
  });
  mesh.computeBoundingSphere();
  return mesh;
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
