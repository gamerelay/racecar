// The credits' backdrop (ui/pages.ts): an outrun night, drawn live. A banded sun setting in a gap
// in wire mountains, stars, a neon grid floor with the sun in its gloss, rows of palms out to the
// horizon, and a silver Vanta doing figure 8s and donuts (credits-drive.ts), laying light trails
// and smoking its tires, followed by a chase camera that keeps it in the open under the page. The game's own car and post pass (ink, grade,
// grain), on a small renderer of its own that only runs while the page is up. With reduced motion
// it's one still frame.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  BackSide,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { CLASSES } from '../content';
import { PALM_PATHS } from '../ui/palm';
import { chase, StuntDriver } from './credits-drive';
import { InkPass } from './ink';
import { PostPass } from './post';
import type { LiveBackdrop } from '../ui/pages';
import type { CarVisual } from './skin';
import { GreyboxSkin } from './skins/greybox';
import { glow } from './skins/greybox/toon';

/** Where the sun sits (just over the horizon, its middle): the stage looks straight at it. */
const SUN = new Vector3(0.35, 0.05, -1).normalize();
const HAZE = 0xff3d7f;
const FOV = 44;
/** The chase camera: how tall the car is on screen as a share of the open strip under the page, and
 * how far up the horizon sits above the page's top (shares of the screen's height). */
const CAR_SHARE = 0.62;
const HORIZON_DROP = 0.1;
/** How much of the car is on screen top to bottom, seen from high behind (m). */
const CAR_EXTENT = 3;

/** Fixed steps for the driver, the trails and the smoke (s); a still is this far into the show. */
const STEP = 1 / 120;
const STILL_AT = 10.4;
/** Played before the first frame, so the floor already has trails on it (s). */
const WARM = 4;
const NEON = { pink: 0xff2e88, cyan: 0x35f0ff, sun: 0xff8a3d };

const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** A small seeded random, so the smoke in a still is the same every time. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The sky: deep indigo overhead down to hot pink at the horizon, stars that twinkle, and the sun, yellow to pink, its lower half cut by bands that slide down into the horizon. */
function buildSky(): { mesh: Mesh; uniforms: Record<string, { value: unknown }> } {
  const uniforms = { uSun: { value: SUN.clone() }, uTime: { value: 0 } };
  const mesh = new Mesh(
    new SphereGeometry(1500, 32, 24),
    new ShaderMaterial({
      uniforms,
      side: BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `varying vec3 vDir;void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `uniform vec3 uSun;uniform float uTime;varying vec3 vDir;
        vec3 ramp(float e){
          vec3 c=mix(vec3(1.0,0.42,0.3),vec3(1.0,0.16,0.42),smoothstep(0.0,0.035,e));
          c=mix(c,vec3(0.42,0.07,0.42),smoothstep(0.03,0.13,e));
          c=mix(c,vec3(0.11,0.03,0.24),smoothstep(0.1,0.26,e));
          return mix(c,vec3(0.03,0.01,0.08),smoothstep(0.24,0.6,e));
        }
        void main(){
          vec3 d=normalize(vDir);
          vec3 col=ramp(max(d.y,0.0));
          // The sun: a disc, yellow at the top to hot pink at the bottom, banded below its middle.
          float dist=distance(d,uSun);
          float r=0.13;
          float yy=(d.y-uSun.y)/r;
          float disc=1.0-smoothstep(r-0.0015,r,dist);
          float gap=clamp((0.62-yy)*0.3,0.0,0.6);
          float band=fract(yy*7.0+uTime*0.12);
          disc*=step(gap,band);
          vec3 sunCol=mix(vec3(1.0,0.36,0.6),vec3(1.0,0.86,0.3),smoothstep(-0.9,0.7,yy));
          col=mix(col,sunCol,disc);
          col+=vec3(1.0,0.35,0.45)*0.38*exp(-dist*7.5);
          // Stars, higher up, each at its own pace.
          vec3 cell=floor(d*380.0);
          float h=fract(sin(dot(cell,vec3(12.9898,78.233,37.719)))*43758.5453);
          float tw=0.55+0.45*sin(uTime*(1.0+h*3.0)+h*40.0);
          col+=vec3(0.9,0.85,1.0)*step(0.9975,h)*smoothstep(0.08,0.3,d.y)*tw;
          gl_FragColor=vec4(col,1.0);
        }`,
    }),
  );
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

/** The floor: a dark glossy plane, a neon grid with rings of light running out across it, the sun's streak in it, and the haze at the horizon. */
function buildFloor(fog: Color): { mesh: Mesh; uniforms: Record<string, { value: unknown }> } {
  const uniforms = {
    uBase: { value: new Color(0x07030f) },
    uLine: { value: new Color(NEON.cyan) },
    uSunCol: { value: new Color(0xff5a8a) },
    uFog: { value: fog.clone() },
    uSun: { value: SUN.clone() },
    uCam: { value: new Vector3() },
    uTime: { value: 0 },
    uCell: { value: 6 },
    uNear: { value: 70 },
    uFar: { value: 640 },
  };
  const mat = new ShaderMaterial({
    uniforms,
    vertexShader: `varying vec3 vW;varying vec2 vP;
      void main(){vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;vP=position.xy;gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader: `uniform vec3 uBase,uLine,uSunCol,uFog,uSun,uCam;uniform float uTime,uCell,uNear,uFar;varying vec3 vW;varying vec2 vP;
      void main(){
        vec2 p=vP/uCell;
        vec2 d=abs(fract(p-0.5)-0.5);
        vec2 aa=d/fwidth(p);
        float line=1.0-min(min(aa.x,aa.y),1.0);
        float dist=distance(vW,uCam);
        float far=smoothstep(uNear,uFar,dist);
        float halo=exp(-min(d.x,d.y)*16.0)*(1.0-far);
        // Rings of light running out from the middle of the lot.
        float pulse=0.72+0.28*sin(length(vP)*0.07-uTime*1.8);
        vec3 col=uBase;
        // The sun on the gloss: a streak down from it toward you, brightest far off, and a faint wide sheen.
        vec3 v=normalize(vW-uCam);
        vec2 h=normalize(v.xz);
        float off=1.0-dot(h,normalize(uSun.xz));
        col+=uSunCol*(exp(-off*900.0)*(0.15+0.85*far)*0.9+exp(-off*40.0)*0.06);
        col+=uLine*(line*1.1+halo*0.28)*pulse*(1.0-far*0.8);
        col=mix(col,uFog,far*far*(3.0-2.0*far)*0.9);
        gl_FragColor=vec4(col,1.0);
      }`,
  });
  const mesh = new Mesh(new PlaneGeometry(2400, 2400), mat);
  mesh.rotation.x = -Math.PI / 2;
  return { mesh, uniforms };
}

/** The mountains far off, all the way round: a dark ridge with a gap where the sun sets, edged in hot pink wire. */
function buildMountains(): Group {
  const g = new Group();
  const n = 360;
  const R = 760;
  // Round the ring by angle: 0 is toward the sun (−z). `a` is along the ridge (m), for its peaks.
  const ridge = (phi: number) => {
    const a = phi * R;
    const gap = Math.min(1, Math.max(0, (Math.abs(a) - 70) / 230));
    const peaks = 0.55 * Math.abs(Math.sin(a * 0.0105 + 1.3)) + 0.3 * Math.abs(Math.sin(a * 0.029 + 0.4)) + 0.15 * Math.abs(Math.sin(a * 0.083));
    return 4 + 78 * gap * gap * (3 - 2 * gap) * peaks;
  };
  const at = (phi: number, inset = 0): [number, number] => [(R - inset) * Math.sin(phi), -(R - inset) * Math.cos(phi)];
  const fill: number[] = [];
  const wire: number[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = -Math.PI + (2 * Math.PI * i) / n;
    const p1 = -Math.PI + (2 * Math.PI * (i + 1)) / n;
    const h0 = ridge(p0);
    const h1 = ridge(p1);
    const [x0, z0] = at(p0);
    const [x1, z1] = at(p1);
    fill.push(x0, 0, z0, x1, 0, z1, x1, h1, z1, x0, 0, z0, x1, h1, z1, x0, h0, z0);
    // The wire just in front of the fill, so it's never behind it.
    const [wx0, wz0] = at(p0, 1);
    const [wx1, wz1] = at(p1, 1);
    wire.push(wx0, h0, wz0, wx1, h1, wz1);
    // Down each slope, a line to the foot: the wireframe's facets.
    if (i % 3 === 0) {
      const [fx, fz] = at(p0 + (i % 2 ? 0.012 : -0.012), 1);
      wire.push(wx0, h0, wz0, fx, 0, fz);
    }
  }
  const fg = new BufferGeometry();
  fg.setAttribute('position', new BufferAttribute(new Float32Array(fill), 3));
  g.add(new Mesh(fg, new MeshBasicMaterial({ color: 0x14082a, fog: false, side: DoubleSide })));
  const wg = new BufferGeometry();
  wg.setAttribute('position', new BufferAttribute(new Float32Array(wire), 3));
  g.add(new LineSegments(wg, new LineBasicMaterial({ color: NEON.pink, fog: false, transparent: true, opacity: 0.85 })));
  return g;
}

/** Palms all round the lot out to the horizon: silhouettes the haze turns pink the farther they are, turned to face the camera. */
function buildPalms(rand: () => number): Group {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const g2 = c.getContext('2d');
  if (g2) {
    g2.scale(2.56, 2.56);
    g2.fillStyle = '#fff';
    for (const d of PALM_PATHS) g2.fill(new Path2D(d));
  }
  const tex = new CanvasTexture(c);
  const mat = new MeshBasicMaterial({ map: tex, color: 0x12071f, alphaTest: 0.5, side: DoubleSide });
  const geo = new PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const g = new Group();
  const palm = (x: number, z: number, h: number) => {
    const m = new Mesh(geo, mat);
    m.position.set(x, 0, z);
    // Half lean one way, half the other.
    m.scale.set((rand() < 0.5 ? 1 : -1) * h * 0.5, h, 1);
    g.add(m);
  };
  // A ring of them round the lot, then more and more spread out to the horizon.
  // Out past where the chase camera goes (it's up to ~45 m from the car), so none comes between them.
  for (let k = 0; k < 130; k++) {
    const phi = rand() * Math.PI * 2;
    const r = k < 24 ? 95 + rand() * 35 : 130 + rand() ** 0.7 * 470;
    palm(r * Math.sin(phi), r * Math.cos(phi), 12 + rand() * 6);
  }
  return g;
}

/** A light trail behind a rear wheel: a ribbon on the floor, bright where it drifted, fading out. */
class Trail {
  static readonly N = 300;
  static readonly LIFE = 3.4;
  static readonly SPACING = 0.28;
  readonly mesh: Mesh;
  /** x, z, time laid, brightness: oldest first. */
  private readonly pts = new Float32Array(Trail.N * 4);
  private count = 0;
  private readonly pos = new Float32Array(Trail.N * 2 * 3);
  private readonly alpha = new Float32Array(Trail.N * 2);
  private readonly geo = new BufferGeometry();

  constructor(color: number, private readonly width = 0.42) {
    const index: number[] = [];
    for (let i = 0; i < Trail.N - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const side = new Float32Array(Trail.N * 2).map((_, i) => (i % 2 ? 1 : -1));
    this.geo.setIndex(index);
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1));
    this.geo.setAttribute('aSide', new BufferAttribute(side, 1));
    const mat = new ShaderMaterial({
      uniforms: { uColor: { value: new Color(color) } },
      vertexShader: `attribute float aAlpha;attribute float aSide;varying float vA;varying float vS;
        void main(){vA=aAlpha;vS=aSide;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `uniform vec3 uColor;varying float vA;varying float vS;
        void main(){float edge=1.0-vS*vS;float a=vA*(0.35+0.65*edge);gl_FragColor=vec4(uColor*a*2.2+vec3(a*edge*0.5),a);}`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
  }

  add(x: number, z: number, t: number, bright: number): void {
    const p = this.pts;
    if (this.count) {
      const k = (this.count - 1) * 4;
      if (Math.hypot(x - p[k], z - p[k + 1]) < Trail.SPACING) return;
    }
    if (this.count === Trail.N) {
      p.copyWithin(0, 4);
      this.count--;
    }
    const k = this.count * 4;
    p[k] = x;
    p[k + 1] = z;
    p[k + 2] = t;
    p[k + 3] = bright;
    this.count++;
  }

  sync(now: number): void {
    const p = this.pts;
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, Math.min(i + 1, n - 1));
      const b = Math.max(0, i - 1);
      let dx = p[a * 4] - p[b * 4];
      let dz = p[a * 4 + 1] - p[b * 4 + 1];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const w = this.width;
      const v = i * 6;
      this.pos[v] = p[i * 4] + dz * w;
      this.pos[v + 1] = 0.03;
      this.pos[v + 2] = p[i * 4 + 1] - dx * w;
      this.pos[v + 3] = p[i * 4] - dz * w;
      this.pos[v + 4] = 0.03;
      this.pos[v + 5] = p[i * 4 + 1] + dx * w;
      const age = Math.min(1, (now - p[i * 4 + 2]) / Trail.LIFE);
      this.alpha[i * 2] = this.alpha[i * 2 + 1] = (1 - age) ** 1.6 * p[i * 4 + 3];
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(0, n - 1) * 6);
  }
}

/** Tire smoke: soft puffs off the rear wheels that swell, drift and thin out, more the harder it slides. */
class Smoke {
  static readonly N = 360;
  readonly points: Points;
  private readonly pos = new Float32Array(Smoke.N * 3);
  private readonly vel = new Float32Array(Smoke.N * 3);
  private readonly age = new Float32Array(Smoke.N).fill(1);
  private readonly life = new Float32Array(Smoke.N).fill(1);
  private readonly size = new Float32Array(Smoke.N);
  private readonly alpha = new Float32Array(Smoke.N);
  private next = 0;
  readonly uniforms = { uScale: { value: 1 }, uMap: { value: glow() }, uColor: { value: new Color(0xd9c6ff) } };
  private readonly geo = new BufferGeometry();

  constructor(private readonly rand: () => number) {
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aSize', new BufferAttribute(this.size, 1));
    this.geo.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1));
    this.points = new Points(
      this.geo,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: `attribute float aSize;attribute float aAlpha;uniform float uScale;varying float vA;
          void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mv;gl_PointSize=aSize*uScale/-mv.z;vA=aAlpha;}`,
        fragmentShader: `uniform sampler2D uMap;uniform vec3 uColor;varying float vA;
          void main(){float a=texture2D(uMap,gl_PointCoord).a*vA;if(a<0.003)discard;gl_FragColor=vec4(uColor,a);}`,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
  }

  /** A puff at (x, z), thrown back against the car's travel (vx, vz). */
  emit(x: number, z: number, vx: number, vz: number): void {
    const r = this.rand;
    const i = this.next;
    this.next = (i + 1) % Smoke.N;
    this.pos.set([x + (r() - 0.5) * 0.4, 0.35, z + (r() - 0.5) * 0.4], i * 3);
    this.vel.set([-vx * 0.12 + (r() - 0.5) * 2.2, 0.5 + r() * 0.9, -vz * 0.12 + (r() - 0.5) * 2.2], i * 3);
    this.age[i] = 0;
    this.life[i] = 1.5 + r() * 1.1;
  }

  step(dt: number): void {
    const drag = Math.exp(-dt * 1.3);
    for (let i = 0; i < Smoke.N; i++) {
      if (this.age[i] >= this.life[i]) continue;
      this.age[i] += dt;
      for (let k = 0; k < 3; k++) {
        this.vel[i * 3 + k] *= drag;
        this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt;
      }
    }
  }

  sync(): void {
    for (let i = 0; i < Smoke.N; i++) {
      const t = Math.min(1, this.age[i] / this.life[i]);
      this.size[i] = 1.2 + 4.4 * Math.sqrt(t);
      // In fast, out slow.
      this.alpha[i] = t >= 1 ? 0 : Math.min(1, t * 8) * (1 - t) ** 1.5 * 0.3;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

export class CreditsBackdrop implements LiveBackdrop {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly post = new PostPass(1, 1);
  private readonly ink = new InkPass(1, 1);
  private readonly scene = new Scene();
  /** Everything on the ground, turned so the camera looks down it at the sun. */
  private readonly stage = new Group();
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.5, 4000);
  private readonly skin = new GreyboxSkin();
  private readonly sky: Record<string, { value: unknown }>;
  private readonly skyMesh: Mesh;
  private readonly car: CarVisual;
  private readonly carHalf: [number, number];
  private readonly driver = new StuntDriver();
  private readonly trails = [new Trail(NEON.pink), new Trail(NEON.pink)];
  private readonly smoke: Smoke;
  private readonly floor: Record<string, { value: unknown }>;
  private readonly palms: Group;
  /** The cool white that keeps the car silver: from over the camera's shoulder, wherever it is. */
  private readonly front = new DirectionalLight(0xe6ebff, 1.5);
  private readonly rand = seeded(88);
  /** Which way the chase camera faces (the car's angles, on the stage). */
  private chaseYaw = 0;
  /** Where the page sits on screen, to keep the car in the open under it. */
  private sheet: () => DOMRect | null = () => null;
  private time = 0;
  private spin = 0;
  private carry = 0;
  private raf = 0;
  private last = 0;
  private size = [0, 0];
  /** It's drawing (and the world behind it needn't be). */
  running = false;

  /** A backdrop, or null where there's no WebGL (the page keeps its CSS scene). */
  static create(): CreditsBackdrop | null {
    try {
      return new CreditsBackdrop();
    } catch {
      return null;
    }
  }

  private constructor() {
    this.renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'pgGl';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.post.uniforms.tInk.value = this.ink.target.texture;
    this.post.uniforms.tInkDepth.value = this.ink.target.depthTexture;

    // The dusk palette's ink and lights, graded a touch richer, with purple shadows and less grain.
    const u = this.post.uniforms;
    u.uInk.value.setHex(0x120a20);
    u.uSat.value = 1.12;
    u.uContrast.value = 1.06;
    u.uShadow.value.setHex(0x7a5cc0);
    u.uVignette.value = 0.4;
    u.uGrain.value = 0.45;
    this.scene.fog = new Fog(HAZE, 120, 900);
    this.scene.add(new HemisphereLight(0xffb0d8, 0x2a1045, 1.4));
    const key = new DirectionalLight(0xffd6a8, 1.9);
    key.position.set(-300, 400, -800);
    this.scene.add(key, key.target);
    const sky = buildSky();
    this.sky = sky.uniforms;
    this.skyMesh = sky.mesh;
    this.scene.add(sky.mesh);

    this.stage.rotation.y = -Math.atan2(SUN.x, -SUN.z);
    this.scene.add(this.stage);
    const floor = buildFloor(new Color(HAZE));
    this.floor = floor.uniforms;
    this.palms = buildPalms(this.rand);
    this.stage.add(floor.mesh, buildMountains(), this.palms);

    // The sun rims the car pink; a cool white from over the camera's shoulder keeps it silver, and
    // a cyan fill from across the lot.
    const rim = new DirectionalLight(0xff4f9e, 1.8);
    rim.position.set(0, 30, -200);
    const fill = new DirectionalLight(NEON.cyan, 0.7);
    fill.position.set(-60, 25, 60);
    this.stage.add(rim, rim.target, fill, fill.target);
    this.scene.add(this.front, this.front.target);

    const cls = CLASSES.find((c) => c.id === 'coupe') ?? CLASSES[0];
    // Silver: the metallic finish, lit by the scene (the chrome finish mirrors a fixed sky, and reads purple here).
    this.car = this.skin.car(cls, { id: 'silver', name: 'Silver', color: '#cfd4de', finish: 'metallic', underglow: '#ff2e88' });
    this.car.root.rotation.order = 'YXZ';
    this.carHalf = [cls.size[0], cls.size[1]];
    this.stage.add(this.car.root);
    for (const t of this.trails) this.stage.add(t.mesh);
    this.smoke = new Smoke(this.rand);
    this.stage.add(this.smoke.points);

    this.chaseYaw = this.driver.pose.course;
    this.play(WARM);
  }

  /** Draws from now on (one still with reduced motion). `sheet`: where the page is on screen. */
  start(sheet?: () => DOMRect | null): void {
    if (sheet) this.sheet = sheet;
    if (this.running) return;
    this.running = true;
    if (reducedMotion()) {
      if (this.time < STILL_AT) this.play(STILL_AT - this.time);
      this.draw();
      return;
    }
    this.last = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.play(dt);
      this.draw();
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Plays the show on by `seconds`: the driver, its trails and its smoke, in fixed steps. */
  private play(seconds: number): void {
    this.carry += seconds;
    const p = this.driver.pose;
    const [hw, hl] = this.carHalf;
    while (this.carry >= STEP) {
      this.carry -= STEP;
      this.time += STEP;
      this.driver.step(STEP);
      this.spin += (p.speed * STEP) / 0.38;
      const c = Math.cos(p.heading);
      const s = Math.sin(p.heading);
      const slide = Math.min(1, Math.abs(p.slip) / 0.9);
      const vx = Math.sin(p.course) * p.speed;
      const vz = Math.cos(p.course) * p.speed;
      for (let w = 0; w < 2; w++) {
        // The rear wheels: across and back from the car's middle, turned with it.
        const lx = (w ? 1 : -1) * hw * 0.82;
        const lz = -hl * 0.62;
        const x = p.x + lx * c + lz * s;
        const z = p.z - lx * s + lz * c;
        this.trails[w].add(x, z, this.time, 0.25 + 0.75 * slide);
        if (this.rand() < slide * slide * 0.55) this.smoke.emit(x, z, vx, vz);
      }
      this.smoke.step(STEP);
      this.chaseYaw = chase(this.chaseYaw, p.course, STEP, p.donuts);
    }
  }

  /**
   * The chase camera: high behind the car, the way it's going, and the view shifted so the car sits
   * in the open strip under the page, as big as fits there, with the horizon a little under the
   * page's top so the sky shows above it.
   */
  private place(w: number, h: number): void {
    const tanV = Math.tan((FOV * Math.PI) / 360);
    const box = this.sheet();
    const below = Math.min(h * 0.9, Math.max(h * 0.5, box?.bottom ?? h * 0.7));
    const top = box?.top ?? h * 0.15;
    const carY = below + (h - below) * 0.46;
    const horizonY = Math.max(h * 0.08, Math.min(carY - h * 0.25, top + h * HORIZON_DROP));
    // How far back for the car to fill its share of the strip, and how steeply down for the horizon to land where it should.
    const share = Math.max(0.05, ((h - below) / h) * CAR_SHARE);
    const dist = Math.min(44, Math.max(9, CAR_EXTENT / (share * 2 * tanV)));
    const down = Math.atan(((carY - horizonY) / (h / 2)) * tanV);
    const p = this.driver.pose;
    const back = Math.cos(down) * dist;
    const at = new Vector3(p.x, 0.6, p.z);
    const eye = new Vector3(p.x - Math.sin(this.chaseYaw) * back, 0.6 + Math.sin(down) * dist, p.z - Math.cos(this.chaseYaw) * back);
    this.stage.localToWorld(at);
    this.stage.localToWorld(eye);
    this.camera.position.copy(eye);
    this.camera.lookAt(at);
    this.camera.aspect = w / h;
    // The car's at the middle of the full view: shift it down to its strip.
    this.camera.setViewOffset(w, h, 0, h / 2 - carY, w, h);
    this.camera.updateProjectionMatrix();
    this.smoke.uniforms.uScale.value = (h * this.renderer.getPixelRatio()) / (2 * tanV);
    this.front.position.set(eye.x, eye.y + 30, eye.z);
    this.front.target.position.copy(at);
    // The palms face the camera.
    const local = this.stage.worldToLocal(eye.clone());
    for (const m of this.palms.children) m.rotation.y = Math.atan2(local.x - m.position.x, local.z - m.position.z);
  }

  private resize(): [number, number] {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    if (w !== this.size[0] || h !== this.size[1]) {
      this.size = [w, h];
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(w, h, false);
      this.post.setSize(Math.floor(w * ratio), Math.floor(h * ratio), 1.5 * ratio);
      this.ink.setSize(Math.floor(w * ratio), Math.floor(h * ratio));
    }
    return [w, h];
  }

  private draw(): void {
    const [w, h] = this.resize();
    this.place(w, h);
    const p = this.driver.pose;
    const r = this.car.root;
    r.position.set(p.x, 0, p.z);
    r.rotation.y = p.heading;
    // Leaning out of the turn a little.
    r.rotation.z = Math.max(-0.07, Math.min(0.07, p.yawRate * p.speed * 0.0016));
    this.car.update(this.spin, p.steer, p.donuts, p.boost, true, 1 / 60);
    for (const t of this.trails) t.sync(this.time);
    this.smoke.sync();

    const cam = this.camera.position;
    this.skyMesh.position.copy(cam);
    this.sky.uTime.value = this.time;
    (this.floor.uCam.value as Vector3).copy(cam);
    this.floor.uTime.value = this.time;

    const u = this.post.uniforms;
    u.uTime.value = this.time;
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    u.uCarInk.value = 1;
    this.ink.render(this.renderer, this.scene, this.camera);
    this.renderer.setRenderTarget(this.post.target);
    this.renderer.render(this.scene, this.camera);
    this.post.render(this.renderer);
  }
}
