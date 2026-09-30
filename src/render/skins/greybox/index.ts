// The greybox skin: flat-shaded geometry under the prototype's dusk sky (SPEC §6: the greybox
// borrows City's sky, fog and light from day one, so it already feels like City).

import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  Color,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  type Scene,
} from 'three';
import type { CarClass, PaintDef } from '../../../core/content';
import type { Track } from '../../../core/track/bake';
import type { Sim } from '../../../core/sim';
import type { CarVisual, Skin, TrackVisual, WorldVisual } from '../../skin';
import { glow, toon } from './toon';
import { buildWorldVisual } from './world';
import { PALETTES, type Palette } from './palettes';
import { buildTrackVisual } from './track';

const RAIN_FOG = new Color(0x3a4460);

export class GreyboxSkin implements Skin {
  readonly id = 'greybox';
  private palette: Palette = PALETTES.dusk;
  private sky?: Mesh;
  private skyTime?: { value: number };
  private sun?: DirectionalLight;
  private fog?: Fog;
  private hemi?: HemisphereLight;
  ink = PALETTES.dusk.ink;

  environment(scene: Scene, palette: string): void {
    const p = (this.palette = PALETTES[palette] ?? PALETTES.dusk);
    this.ink = p.ink;
    scene.background = new Color(p.fog);
    scene.fog = this.fog = new Fog(p.fog, p.fogNear, p.fogFar);
    scene.add((this.hemi = new HemisphereLight(p.hemiSky, p.hemiGround, p.hemiIntensity)));
    const sun = (this.sun = new DirectionalLight(p.dir, p.dirIntensity));
    sun.position.set(-300, 400, -800);
    scene.add(sun);
    scene.add(sun.target);
    this.skyTime = { value: 0 };
    const sky = (this.sky = new Mesh(
      new SphereGeometry(1600, 32, 16),
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new Color(p.top) },
          mid: { value: new Color(p.mid) },
          hor: { value: new Color(p.horizon) },
          sunC: { value: new Color(p.sun) },
          uTime: this.skyTime,
        },
        vertexShader: `varying vec3 vDir;void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        // The prototype's synthwave sky: a gradient, a banded sun low on the horizon, stars.
        fragmentShader: `uniform vec3 top,mid,hor,sunC;uniform float uTime;varying vec3 vDir;
        void main(){
          vec3 d=normalize(vDir);float h=d.y;
          vec3 col=mix(hor,mid,smoothstep(-0.02,0.16,h));
          col=mix(col,top,smoothstep(0.14,0.55,h));
          vec3 sd=normalize(vec3(0.35,0.07,-1.0));
          float dist=distance(d,sd);
          float disc=1.0-smoothstep(0.17,0.175,dist);
          float yy=d.y-sd.y;
          float gap=clamp(-yy*5.5,0.0,0.85);
          float band=fract(yy*42.0-uTime*0.15);
          disc*=step(gap,band);
          vec3 sunCol=mix(sunC,vec3(1.0,0.32,0.55),1.0-smoothstep(-0.16,0.12,yy));
          col=mix(col,sunCol,disc);
          col+=sunC*0.28*exp(-dist*5.0);
          float s=fract(sin(dot(floor(d*420.0),vec3(12.9898,78.233,37.719)))*43758.5453);
          col+=vec3(step(0.9985,s))*smoothstep(0.2,0.6,h)*0.8;
          gl_FragColor=vec4(col,1.0);
        }`,
      }),
    ));
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    scene.add(sky);
  }

  track(track: Track, seed: number): TrackVisual {
    return buildTrackVisual(track, this.palette, seed);
  }

  car(cls: CarClass, paint: PaintDef): CarVisual {
    return buildCar(cls, paint);
  }

  world(scene: Scene, sim: Sim): WorldVisual {
    return buildWorldVisual(scene, sim);
  }

  update(time: number, x: number, y: number, z: number, wetness = 0): void {
    if (this.skyTime) this.skyTime.value = time;
    if (this.fog) {
      const p = this.palette;
      this.fog.near = p.fogNear * (1 - 0.5 * wetness);
      this.fog.far = p.fogFar * (1 - 0.55 * wetness);
      this.fog.color.setHex(p.fog).lerp(RAIN_FOG, wetness * 0.6);
      if (this.hemi) this.hemi.intensity = p.hemiIntensity * (1 - 0.35 * wetness);
      if (this.sun) this.sun.intensity = p.dirIntensity * (1 - 0.6 * wetness);
    }
    this.sky?.position.set(x, y, z);
    if (this.sun) {
      this.sun.position.set(x - 300, y + 400, z - 800);
      this.sun.target.position.set(x, y, z);
    }
  }
}

// ---- Cars: box-built, one shape per class, like the prototype ----

const trim = toon({ color: 0x16121f });
const glass = toon({ color: 0x243a66, emissive: 0x0c1638 });
const headMat = new MeshBasicMaterial({ color: 0xfff4cc });
const headGlow = new SpriteMaterial({ map: glow(), color: 0xfff0c0, transparent: true, blending: AdditiveBlending, depthWrite: false });
let beamShared: MeshBasicMaterial | undefined;

function beamMat(): MeshBasicMaterial {
  if (beamShared) return beamShared;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  // Bright at the car (the canvas bottom), fading and widening ahead.
  const l = g.createLinearGradient(0, 256, 0, 0);
  l.addColorStop(0, 'rgba(255,240,200,.9)');
  l.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = l;
  g.beginPath();
  g.moveTo(64 * 0.32, 256);
  g.lineTo(64 * 0.68, 256);
  g.lineTo(64, 0);
  g.lineTo(0, 0);
  g.closePath();
  g.fill();
  return (beamShared = new MeshBasicMaterial({ map: new CanvasTexture(c), color: 0xfff0c8, transparent: true, opacity: 0.3, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
}
const wheelGeo = new CylinderGeometry(0.38, 0.38, 0.3, 12);
wheelGeo.rotateZ(Math.PI / 2);

function buildCar(cls: CarClass, paint: PaintDef): CarVisual {
  const [hw, hl] = cls.size;
  const root = new Group();
  const body = new Group();
  root.add(body);
  const bodyMat = toon({
    color: paint.color,
    emissive: paint.finish === 'chrome' ? 0x222233 : 0x000000,
  });
  const second = toon({ color: paint.secondary ?? paint.color });
  const box = (w: number, h: number, d: number, m: MeshToonMaterial | MeshBasicMaterial, x: number, y: number, z: number) => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    body.add(mesh);
    return mesh;
  };
  const W = hw * 2;
  const L = hl * 2;
  if (cls.id === 'van') {
    box(W, 1.7, L, bodyMat, 0, 1.25, 0);
    box(W + 0.04, 0.55, 0.9, glass, 0, 1.6, L / 2 - 0.5);
    box(W + 0.04, 0.45, L * 0.55, glass, 0, 1.7, -0.3);
    box(W + 0.02, 0.15, L - 0.2, second, 0, 0.75, 0);
  } else if (cls.id === 'muscle') {
    box(W, 0.55, L, bodyMat, 0, 0.66, 0);
    box(W * 0.84, 0.38, L * 0.36, glass, 0, 1.12, -0.35);
    box(W * 0.8, 0.12, L * 0.3, bodyMat, 0, 1.35, -0.35);
    box(0.5, 0.04, L * 0.45, second, 0, 0.95, L * 0.22);
    box(W + 0.05, 0.08, 0.45, trim, 0, 1.12, -L / 2 + 0.2);
  } else if (cls.id === 'hatch') {
    box(W, 0.62, L, bodyMat, 0, 0.72, 0);
    box(W * 0.88, 0.48, L * 0.52, glass, 0, 1.25, -0.2);
    box(W * 0.84, 0.12, L * 0.5, bodyMat, 0, 1.54, -0.2);
  } else {
    // coupe
    box(W, 0.5, L, bodyMat, 0, 0.62, 0);
    box(W * 0.85, 0.32, L * 0.42, glass, 0, 1.02, -0.25);
    box(W * 0.79, 0.12, L * 0.35, bodyMat, 0, 1.22, -0.3);
    box(W + 0.05, 0.08, 0.5, trim, 0, 1.2, -L / 2 + 0.1);
    box(0.45, 0.03, L * 0.35, second, 0, 0.885, L * 0.25);
  }
  const lightY = cls.id === 'van' ? 0.8 : 0.7;
  const tailMat = new MeshBasicMaterial({ color: 0x991122 });
  const tailGlow = new SpriteMaterial({ map: glow(), color: 0xff2344, transparent: true, opacity: 0.6, blending: AdditiveBlending, depthWrite: false });
  for (const s of [-1, 1]) {
    box(0.42, 0.16, 0.06, headMat, s * (hw - 0.36), lightY, L / 2 + 0.01);
    box(0.42, 0.14, 0.06, tailMat, s * (hw - 0.36), lightY, -L / 2 - 0.01);
    const hg = new Sprite(headGlow);
    hg.scale.set(1.5, 1.5, 1);
    hg.position.set(s * (hw - 0.36), lightY, L / 2 + 0.12);
    const tg = new Sprite(tailGlow);
    tg.scale.set(1, 1, 1);
    tg.position.set(s * (hw - 0.36), lightY, -L / 2 - 0.12);
    body.add(hg, tg);
  }
  // Headlight beam: a soft additive wedge on the road ahead.
  const beam = new Mesh(new PlaneGeometry(W + 1.4, 12), beamMat());
  // Tipped so the texture's bright end (v = 0) sits at the car, which faces +z.
  beam.rotation.x = Math.PI / 2;
  beam.position.set(0, 0.05, L / 2 + 6.1);
  root.add(beam);
  const wheels: Mesh[] = [];
  const front: Group[] = [];
  const wz = hl - 0.75;
  for (const z of [wz, -wz]) {
    for (const s of [-1, 1]) {
      const pivot = new Group();
      pivot.position.set(s * (hw - 0.08), 0.38, z);
      const w = new Mesh(wheelGeo, trim);
      pivot.add(w);
      root.add(pivot);
      wheels.push(w);
      if (z > 0) front.push(pivot);
    }
  }
  if (paint.underglow) {
    const u = new Mesh(new PlaneGeometry(W + 2.2, L + 1.6), new MeshBasicMaterial({ map: glow(), color: paint.underglow, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false }));
    u.rotation.x = -Math.PI / 2;
    u.position.y = 0.06;
    root.add(u);
  }
  const shadow = new Mesh(new PlaneGeometry(W + 0.8, L + 0.8), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.04;
  root.add(shadow);
  const flame = new Mesh(new PlaneGeometry(0.9, 2.2), new MeshBasicMaterial({ map: glow(), color: 0xff7a1a, transparent: true, blending: AdditiveBlending, depthWrite: false }));
  flame.rotation.x = -Math.PI / 2;
  flame.position.set(0, lightY, -L / 2 - 1.1);
  flame.visible = false;
  root.add(flame);

  return {
    root,
    update(spin, steer, braking, boosting, onRoad) {
      beam.visible = onRoad;
      for (const w of wheels) w.rotation.x = spin;
      for (const f of front) f.rotation.y = steer * 0.45;
      tailMat.color.setHex(braking ? 0xff2344 : 0x991122);
      tailGlow.opacity = braking ? 1 : 0.6;
      flame.visible = boosting;
      if (boosting) flame.scale.set(1, 0.8 + Math.random() * 0.5, 1);
    },
    dispose() {
      root.traverse((o) => {
        if (o instanceof Mesh && o.geometry !== wheelGeo) o.geometry.dispose();
      });
      bodyMat.dispose();
      second.dispose();
      tailMat.dispose();
      tailGlow.dispose();
    },
  };
}
