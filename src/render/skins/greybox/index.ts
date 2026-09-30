// The greybox skin: flat-shaded geometry under the prototype's dusk sky (SPEC §6: the greybox
// borrows City's sky, fog and light from day one, so it already feels like City).

import {
  BackSide,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  type Scene,
} from 'three';
import type { CarClass, PaintDef } from '../../../core/content';
import type { Track } from '../../../core/track/bake';
import type { Sim } from '../../../core/sim';
import type { CarVisual, Skin, TrackVisual, WorldVisual } from '../../skin';
import { buildCar } from './car/build';
import { WET } from './toon';
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
    WET.value = wetness;
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

