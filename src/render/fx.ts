// Particles: one pooled Points buffer, additive, never touched by core (SPEC §2, "Data layout").
// Sparks on impacts, drift smoke, mini-turbo sparks colored by stage, boost flames, landing dust,
// wreck bursts. Driven by the event queue and by per-frame car state.

import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, Points, PointsMaterial } from 'three';

const MAX = 2000;

export class Particles {
  readonly points: Points;
  private readonly pos = new Float32Array(MAX * 3);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly col = new Float32Array(MAX * 3);
  private readonly base = new Float32Array(MAX * 3);
  private readonly life = new Float32Array(MAX);
  private readonly maxLife = new Float32Array(MAX);
  private readonly drag = new Float32Array(MAX);
  private readonly grav = new Float32Array(MAX);
  private readonly geo = new BufferGeometry();
  private head = 0;
  /** Particles alive after the last update, and whether any were emitted since: none of either, nothing to do. */
  private alive = 0;
  private emitted = false;
  private readonly tmp = new Color();

  constructor() {
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = -1e4;
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new BufferAttribute(this.col, 3));
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d')!;
    const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.35, 'rgba(255,255,255,.5)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 32, 32);
    this.points = new Points(
      this.geo,
      new PointsMaterial({ size: 0.7, map: new CanvasTexture(c), vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }),
    );
    this.points.frustumCulled = false;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: number, gravity = 22, drag = 0.5): void {
    const i = this.head;
    this.head = (this.head + 1) % MAX;
    this.emitted = true;
    const j = i * 3;
    this.pos[j] = x;
    this.pos[j + 1] = y;
    this.pos[j + 2] = z;
    this.vel[j] = vx;
    this.vel[j + 1] = vy;
    this.vel[j + 2] = vz;
    this.life[i] = this.maxLife[i] = life;
    this.grav[i] = gravity;
    this.drag[i] = drag;
    this.tmp.setHex(color);
    this.base[j] = this.tmp.r;
    this.base[j + 1] = this.tmp.g;
    this.base[j + 2] = this.tmp.b;
  }

  burst(x: number, y: number, z: number, n: number, speed: number, color: number, vx = 0, vz = 0): void {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const u = Math.random();
      this.emit(x, y, z, Math.cos(a) * speed * u + vx, (0.3 + Math.random() * 0.7) * speed, Math.sin(a) * speed * u + vz, 0.4 + Math.random() * 0.8, color);
    }
  }

  update(dt: number): void {
    // Paused (nothing moves) or empty: no work, no upload.
    if (dt === 0 || (this.alive === 0 && !this.emitted)) return;
    this.emitted = false;
    let alive = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      alive++;
      const j = i * 3;
      this.life[i] -= dt;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[j] *= k;
      this.vel[j + 2] *= k;
      this.vel[j + 1] = this.vel[j + 1] * k - this.grav[i] * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      this.col[j] = this.base[j] * f;
      this.col[j + 1] = this.base[j + 1] * f;
      this.col[j + 2] = this.base[j + 2] * f;
      if (this.life[i] <= 0) this.pos[j + 1] = -1e4;
    }
    this.alive = alive;
    (this.geo.attributes.position as BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as BufferAttribute).needsUpdate = true;
  }
}
