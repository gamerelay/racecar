// Ripples on water: flat rings that spread and fade where a car wades or splashes down (a ring
// pool, like the skid marks: the oldest is reused). Additive, so a fading ring dims to nothing.

import { AdditiveBlending, Color, DynamicDrawUsage, InstancedMesh, MeshBasicMaterial, Object3D, RingGeometry } from 'three';

const MAX = 48;

export class Ripples {
  readonly mesh: InstancedMesh;
  private readonly x = new Float32Array(MAX);
  private readonly y = new Float32Array(MAX);
  private readonly z = new Float32Array(MAX);
  /** Its radius at the start and at the end (m), and how long it lasts (s). */
  private readonly r0 = new Float32Array(MAX);
  private readonly r1 = new Float32Array(MAX);
  private readonly life = new Float32Array(MAX);
  private readonly age = new Float32Array(MAX).fill(Infinity);
  private readonly bright = new Float32Array(MAX);
  private head = 0;
  private readonly dummy = new Object3D();
  private readonly color = new Color();

  constructor() {
    const ring = new RingGeometry(0.88, 1, 40);
    ring.rotateX(-Math.PI / 2);
    this.mesh = new InstancedMesh(ring, new MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false }), MAX);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, this.color.setScalar(0));
  }

  /** A ring at (x, y, z), spreading from r0 to r1 m over `life` s, `bright` 0–1. */
  add(x: number, y: number, z: number, r0: number, r1: number, life: number, bright = 0.5): void {
    const i = this.head;
    this.head = (this.head + 1) % MAX;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.r0[i] = r0;
    this.r1[i] = r1;
    this.life[i] = life;
    this.age[i] = 0;
    this.bright[i] = bright;
  }

  update(dt: number): void {
    let n = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.age[i] >= this.life[i]) continue;
      this.age[i] += dt;
      const u = Math.min(1, this.age[i] / this.life[i]);
      // Quick out at first, slowing as it spreads; bright at first, gone at the end.
      const r = this.r0[i] + (this.r1[i] - this.r0[i]) * (1 - (1 - u) * (1 - u));
      this.dummy.position.set(this.x[i], this.y[i], this.z[i]);
      this.dummy.scale.set(r, 1, r);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(n, this.dummy.matrix);
      this.mesh.setColorAt(n, this.color.setScalar(this.bright[i] * (1 - u) * (1 - u)));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    this.age.fill(Infinity);
    this.mesh.count = 0;
  }
}
