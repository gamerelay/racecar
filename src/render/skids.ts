// Skid marks: rubber laid down under the rear wheels in a slide, a drift or a hard stop, dark on
// asphalt and churned on dirt and grass. One pooled ring of quads (one draw call): each wheel
// extends its own strip, the oldest marks are overwritten first, and a mark fades out with age.
// Presentation only: the sim never sees them.

import { AddEquation, BufferAttribute, BufferGeometry, CustomBlending, DoubleSide, DstColorFactor, Mesh, OneFactor, ShaderMaterial, ZeroFactor } from 'three';

/** Segments in the ring: ~0.5 m each, so a few kilometers of marks across the field. */
const MAX = 6000;
/** Seconds a mark stays, the last third of them fading. */
export const SKID_LIFE = 30;
/** A strip adds a segment once its wheel has moved this far (m); further than JUMP is a teleport. */
const STEP = 0.5;
const JUMP = 6;
/** How far above the ground the marks sit (m), under polygon offset. */
const LIFT = 0.025;

interface Strip {
  on: boolean;
  x: number;
  y: number;
  z: number;
  /** The last segment's end corners (left x, y, z, right x, y, z) and alpha, to join the next to. */
  corners: Float32Array;
  alpha: number;
  joined: boolean;
}

export class Skids {
  readonly mesh: Mesh;
  private readonly pos = new Float32Array(MAX * 4 * 3);
  private readonly col = new Float32Array(MAX * 4 * 3);
  /** Per vertex: born (s), alpha, side (-1 or 1, for the soft edges). */
  private readonly info = new Float32Array(MAX * 4 * 3);
  private readonly geo = new BufferGeometry();
  private readonly material: ShaderMaterial;
  private readonly strips = new Map<number, Strip>();
  private head = 0;
  /** Segments written this frame, [first, count] (a wrap makes two runs). */
  private dirtyFrom = -1;
  private dirtyCount = 0;
  private time = 0;

  constructor() {
    const index = new Uint32Array(MAX * 6);
    for (let k = 0; k < MAX; k++) {
      const v = k * 4;
      index.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], k * 6);
    }
    this.geo.setIndex(new BufferAttribute(index, 1));
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new BufferAttribute(this.col, 3));
    this.geo.setAttribute('info', new BufferAttribute(this.info, 3));
    this.material = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLife: { value: SKID_LIFE } },
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
      // Multiplied into the road, so a mark darkens whatever it's on, lit or in shadow, wet or dry;
      // the alpha channel (the post pass's mirror mask) is left alone.
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: DstColorFactor,
      blendDst: ZeroFactor,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor,
      vertexShader: `attribute vec3 info;attribute vec3 color;uniform float uTime;uniform float uLife;
        varying vec3 vColor;varying float vAlpha;varying float vSide;
        void main(){
          vColor=color;vSide=info.z;
          float age=uTime-info.x;
          vAlpha=info.y*(1.0-smoothstep(uLife*0.66,uLife,age));
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
        }`,
      fragmentShader: `varying vec3 vColor;varying float vAlpha;varying float vSide;
        void main(){
          // Soft at the edges, like rubber rather than paint.
          float edge=1.0-smoothstep(0.55,1.0,abs(vSide));
          gl_FragColor=vec4(mix(vec3(1.0),vColor,vAlpha*edge),1.0);
        }`,
    });
    this.mesh = new Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /**
   * Wheel `key` is on the ground at (x, y, z), leaving a mark `width` m wide that multiplies the
   * road by (r, g, b) at `alpha`. Adds a segment to its strip once the wheel has moved far enough.
   */
  mark(key: number, x: number, y: number, z: number, width: number, r: number, g: number, b: number, alpha: number): void {
    let s = this.strips.get(key);
    if (!s) this.strips.set(key, (s = { on: false, x, y, z, corners: new Float32Array(6), alpha: 0, joined: false }));
    if (!s.on) {
      s.on = true;
      s.joined = false;
      s.x = x;
      s.y = y;
      s.z = z;
      return;
    }
    const dx = x - s.x;
    const dz = z - s.z;
    const d = Math.hypot(dx, dz);
    if (d < STEP) return;
    if (d > JUMP) {
      // Teleported (a respawn, a reset): start over from here.
      s.joined = false;
      s.x = x;
      s.y = y;
      s.z = z;
      return;
    }
    const px = (-dz / d) * width * 0.5;
    const pz = (dx / d) * width * 0.5;
    const k = this.head;
    const v = k * 12;
    const c = s.corners;
    if (s.joined) this.pos.set(c, v);
    else {
      // A strip's first segment starts from nothing, so it fades in.
      this.pos.set([s.x + px, s.y + LIFT, s.z + pz, s.x - px, s.y + LIFT, s.z - pz], v);
      s.alpha = 0;
    }
    c[0] = x + px;
    c[1] = y + LIFT;
    c[2] = z + pz;
    c[3] = x - px;
    c[4] = y + LIFT;
    c[5] = z - pz;
    this.pos.set(c, v + 6);
    for (let n = 0; n < 4; n++) {
      this.col.set([r, g, b], v + n * 3);
      const a = n < 2 ? s.alpha : alpha;
      this.info.set([this.time, a, n % 2 === 0 ? 1 : -1], v + n * 3);
    }
    s.alpha = alpha;
    s.joined = true;
    s.x = x;
    s.y = y;
    s.z = z;
    this.head = (k + 1) % MAX;
    if (this.dirtyFrom < 0) this.dirtyFrom = k;
    this.dirtyCount++;
  }

  /** Wheel `key` stopped marking: its strip ends here (the next mark starts a new one). */
  lift(key: number): void {
    const s = this.strips.get(key);
    if (s) s.on = false;
  }

  /** Advances the fade by world seconds `dt` and uploads what changed this frame. */
  update(dt: number): void {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    if (this.dirtyCount === 0) return;
    const count = Math.min(MAX, this.dirtyCount);
    for (const name of ['position', 'color', 'info']) {
      const a = this.geo.getAttribute(name) as BufferAttribute;
      a.clearUpdateRanges();
      const first = this.dirtyFrom;
      const run = Math.min(count, MAX - first);
      a.addUpdateRange(first * 12, run * 12);
      if (run < count) a.addUpdateRange(0, (count - run) * 12);
      a.needsUpdate = true;
    }
    this.dirtyFrom = -1;
    this.dirtyCount = 0;
  }

  /** Every mark gone (a new track). */
  clear(): void {
    this.info.fill(0);
    this.pos.fill(0);
    for (const s of this.strips.values()) s.on = false;
    this.head = 0;
    this.dirtyFrom = 0;
    this.dirtyCount = MAX;
  }

  /** How many segments are laid (for tests and the debug panel). */
  get laid(): number {
    let n = 0;
    for (let k = 0; k < MAX; k++) if (this.info[k * 12 + 7] > 0 || this.info[k * 12 + 10] > 0) n++;
    return n;
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}
