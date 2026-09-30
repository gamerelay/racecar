// What a wreck does to a car's looks (Burnout, SPEC §9): the body crumples where it was hit, the
// hood and trunk spring open or tear off, the wing, mirrors, plate and sometimes a wheel break away
// and tumble down the road, and glass and paint chips spray from the impact. All cosmetic and local:
// the sim only knows the car is a wreck body. `repair` puts everything back for the respawn.

import {
  DoubleSide,
  BufferGeometry,
  BufferAttribute,
  Euler,
  type Group,
  InstancedMesh,
  type Material,
  Matrix4,
  type Mesh,
  MeshBasicMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { INK, markInk, unmarkInk } from '../../../ink';

export interface Detachable {
  obj: Object3D;
  /** Hinged panels (hood, trunk) spring open about x; sign is which way is up. */
  hinge?: 1 | -1;
  /** Where on the car it sits (car frame), for "near the impact" tests. */
  at: Vector3;
  /** 0–1: how easily it tears off. */
  weak: number;
  /** Rolling things (wheels) keep more of their bounce. */
  bouncy?: boolean;
}

interface Flying {
  obj: Object3D;
  v: Vector3;
  w: Vector3;
  ground: number;
  bouncy: boolean;
  home: { parent: Object3D; m: Matrix4 };
}

interface Hinged {
  obj: Object3D;
  sign: number;
  a: number;
  av: number;
  target: number;
}

const SHARDS = 36;
const GRAVITY = 20;
const shardGeo = (() => {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-0.07, 0, -0.05, 0.08, 0, -0.04, 0, 0, 0.09]), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  return g;
})();
const glassShardMat = new MeshBasicMaterial({ color: 0xcdefff, side: DoubleSide });
export const crackedGlass = new MeshBasicMaterial({ color: 0x9fb8ea });

/** Stable per-vertex noise in [−1, 1] from a position, so coincident vertices move together. */
function hash(x: number, y: number, z: number, s: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 19.3) * 43758.5453;
  return (h - Math.floor(h)) * 2 - 1;
}

export class CarWreck {
  private readonly original = new Map<Mesh, Float32Array>();
  private readonly flying: Flying[] = [];
  private readonly hinged: Hinged[] = [];
  private readonly shards: InstancedMesh[];
  private readonly sv: Vector3[] = [];
  private readonly sp: Vector3[] = [];
  private readonly sr: Vector3[] = [];
  private readonly sw: Vector3[] = [];
  private shardGround = 0;
  private shardsLive = false;
  private readonly last = new Vector3();
  private readonly vel = new Vector3();
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly one = new Vector3(1, 1, 1);
  wrecked = false;

  constructor(
    private readonly root: Group,
    /** Meshes that crumple, with the offset from their local frame to the car frame. */
    private readonly deform: { mesh: Mesh; offset: Vector3 }[],
    private readonly parts: Detachable[],
    private readonly glass: Mesh,
    private readonly glassMat: Material,
    paintMat: Material,
    private readonly size: { hw: number; hl: number; top: number },
  ) {
    this.shards = [glassShardMat, paintMat].map((mat) => {
      const s = new InstancedMesh(shardGeo, mat, SHARDS / 2);
      s.frustumCulled = false;
      markInk(s as unknown as Mesh, INK.debris);
      return s;
    });
    for (let i = 0; i < SHARDS; i++) {
      this.sv.push(new Vector3());
      this.sp.push(new Vector3());
      this.sr.push(new Vector3());
      this.sw.push(new Vector3());
    }
    this.last.copy(root.position);
  }

  /** `dx, dz`: direction from the car's center to the impact, in the car's frame. `strength` 0–1. */
  hit(dx: number, dz: number, strength: number): void {
    const scene = this.root.parent;
    if (!scene || this.wrecked) return;
    this.wrecked = true;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const { hw, hl, top } = this.size;
    const t = Math.min(hw / Math.max(Math.abs(dx), 1e-3), hl / Math.max(Math.abs(dz), 1e-3));
    const p = new Vector3(dx * t, 0.6, dz * t);
    this.crumple(p, dx, dz, 0.2 + 0.35 * strength, 1.0 + 0.6 * strength, 1);
    // A second, lighter dent on the roof or a flank: the tumble.
    const r = Math.random;
    this.crumple(new Vector3((r() - 0.5) * hw, top, (r() - 0.5) * hl), 0, 0, 0.12 * strength, 0.9, 2);
    this.glass.material = crackedGlass;

    this.root.updateMatrixWorld(true);
    const ground = this.root.position.y;
    const carM = this.root.matrixWorld;
    const rot = new Quaternion().setFromRotationMatrix(carM);
    for (const part of this.parts) {
      const near = Math.max(0, 1 - part.at.distanceTo(p) / 2.6);
      const chance = part.weak * (0.35 + 0.65 * near) * (0.5 + 0.5 * strength);
      if (part.hinge && r() > chance * 0.8) {
        // Springs open instead: further the nearer the hit.
        if (near > 0.15 || r() < 0.3) this.hinged.push({ obj: part.obj, sign: part.hinge, a: 0, av: 0, target: 0.4 + near * 0.9 + r() * 0.3 });
        continue;
      }
      if (r() > chance) continue;
      const home = { parent: part.obj.parent!, m: part.obj.matrix.clone() };
      scene.attach(part.obj);
      const out = part.at.clone().setY(0).normalize().applyQuaternion(rot);
      const v = this.vel.clone().multiplyScalar(0.75).addScaledVector(out, 2 + r() * 4);
      v.y += 4 + r() * 5 * strength;
      const w = new Vector3((r() - 0.5) * 14, (r() - 0.5) * 10, (r() - 0.5) * 14);
      this.flying.push({ obj: part.obj, v, w, ground, bouncy: !!part.bouncy, home });
    }

    // Shards from the impact point.
    const pw = p.clone().applyMatrix4(carM);
    const outW = new Vector3(dx, 0, dz).applyQuaternion(rot);
    this.shardGround = ground;
    for (let i = 0; i < SHARDS; i++) {
      this.sp[i].set(pw.x + (r() - 0.5) * 1.2, pw.y + 0.3 + r() * 0.6, pw.z + (r() - 0.5) * 1.2);
      this.sv[i]
        .copy(this.vel)
        .multiplyScalar(0.6)
        .addScaledVector(outW, 2 + r() * 5)
        .add(new Vector3((r() - 0.5) * 6, 2 + r() * 6, (r() - 0.5) * 6));
      this.sr[i].set(r() * 6, r() * 6, r() * 6);
      this.sw[i].set((r() - 0.5) * 30, (r() - 0.5) * 30, (r() - 0.5) * 30);
    }
    for (const s of this.shards) scene.add(s);
    this.shardsLive = true;
  }

  private crumple(p: Vector3, dx: number, dz: number, depth: number, radius: number, seed: number): void {
    for (const { mesh, offset } of this.deform) {
      const pos = mesh.geometry.attributes.position as BufferAttribute;
      if (!this.original.has(mesh)) this.original.set(mesh, (pos.array as Float32Array).slice());
      const a = pos.array as Float32Array;
      for (let i = 0; i < a.length; i += 3) {
        const x = a[i] + offset.x;
        const y = a[i + 1] + offset.y;
        const z = a[i + 2] + offset.z;
        const d = Math.hypot(x - p.x, (y - p.y) * 1.4, z - p.z);
        if (d >= radius) continue;
        const f = (1 - d / radius) ** 2 * depth;
        // In along the hit, down a little, and a ragged jitter so it reads as crushed metal.
        const jx = hash(x, y, z, seed);
        const jy = hash(y, z, x, seed + 1);
        const jz = hash(z, x, y, seed + 2);
        const inward = dx === 0 && dz === 0;
        a[i] += (inward ? 0 : -dx * f) + jx * f * 0.3;
        a[i + 1] += (inward ? -f : -f * 0.25) + jy * f * 0.2;
        a[i + 2] += (inward ? 0 : -dz * f) + jz * f * 0.3;
      }
      pos.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    }
  }

  update(dt: number): void {
    // The car's own velocity, so debris leaves at the speed the car was doing.
    if (dt > 0) {
      this.vel.subVectors(this.root.position, this.last).divideScalar(dt);
      if (this.vel.lengthSq() > 90 * 90) this.vel.setScalar(0);
    }
    this.last.copy(this.root.position);
    if (dt <= 0) return;
    for (const f of this.flying) {
      f.v.y -= GRAVITY * dt;
      f.obj.position.addScaledVector(f.v, dt);
      f.obj.rotation.x += f.w.x * dt;
      f.obj.rotation.y += f.w.y * dt;
      f.obj.rotation.z += f.w.z * dt;
      if (f.obj.position.y < f.ground + 0.08) {
        f.obj.position.y = f.ground + 0.08;
        if (f.v.y < 0) f.v.y *= f.bouncy ? -0.45 : -0.25;
        f.v.x *= f.bouncy ? 0.9 : 0.55;
        f.v.z *= f.bouncy ? 0.9 : 0.55;
        f.w.multiplyScalar(f.bouncy ? 0.85 : 0.5);
      }
    }
    for (const h of this.hinged) {
      h.av += ((h.target - h.a) * 90 - h.av * 7) * dt;
      h.a += h.av * dt;
      h.obj.rotation.x = -h.sign * h.a;
    }
    if (!this.shardsLive) return;
    for (let i = 0; i < SHARDS; i++) {
      const v = this.sv[i];
      const p = this.sp[i];
      v.y -= GRAVITY * dt;
      p.addScaledVector(v, dt);
      if (p.y < this.shardGround + 0.03) {
        p.y = this.shardGround + 0.03;
        v.set(v.x * 0.4, Math.abs(v.y) * 0.2, v.z * 0.4);
        this.sw[i].multiplyScalar(0.3);
      }
      this.sr[i].addScaledVector(this.sw[i], dt);
      this.m.compose(p, this.q.setFromEuler(this.e.setFromVector3(this.sr[i])), this.one);
      this.shards[i & 1].setMatrixAt(i >> 1, this.m);
    }
    for (const s of this.shards) s.instanceMatrix.needsUpdate = true;
  }

  repair(): void {
    if (!this.wrecked) return;
    this.wrecked = false;
    for (const [mesh, a] of this.original) {
      (mesh.geometry.attributes.position.array as Float32Array).set(a);
      mesh.geometry.attributes.position.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    }
    this.glass.material = this.glassMat;
    for (const f of this.flying) {
      f.home.parent.add(f.obj);
      f.obj.matrix.copy(f.home.m);
      f.obj.matrix.decompose(f.obj.position, f.obj.quaternion, f.obj.scale);
    }
    this.flying.length = 0;
    for (const h of this.hinged) h.obj.rotation.x = 0;
    this.hinged.length = 0;
    for (const s of this.shards) s.removeFromParent();
    this.shardsLive = false;
  }

  dispose(): void {
    this.repair();
    for (const s of this.shards) {
      unmarkInk(s);
      s.dispose();
    }
  }
}
