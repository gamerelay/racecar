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
import type { CarPlate, CarVisual, Grade, Skin, TrackVisual, WorldVisual } from '../../skin';
import { buildCar } from './car/build';
import { WET } from './toon';
import { buildWorldVisual } from './world';
import { PALETTES, type Palette } from './palettes';
import { buildTrackVisual } from './track';

const RAIN_FOG = new Color(0x3a4460);
/** Snowfall's fog: a pale whiteout, not rain's grey. */
const SNOW_FOG = new Color(0xdfe6ee);
/** Rain cloud, for the sky. */
const RAIN_SKY = 0x6d7488;
const SUN_FROM: [number, number, number] = [-300, 400, -800];

export class GreyboxSkin implements Skin {
  readonly id = 'greybox';
  private palette: Palette = PALETTES.dusk;
  private sky?: Mesh;
  private skyTime?: { value: number };
  private skyWet?: { value: number };
  private sun?: DirectionalLight;
  private fog?: Fog;
  private hemi?: HemisphereLight;
  private background?: Color;
  ink = PALETTES.dusk.ink;
  grade?: Grade;

  environment(scene: Scene, palette: string): void {
    // Again for another map (behind the menu): the last sky and lights go first.
    if (this.sky) {
      this.sky.removeFromParent();
      this.sky.geometry.dispose();
      (this.sky.material as ShaderMaterial).dispose();
      this.hemi?.removeFromParent();
      this.sun?.target.removeFromParent();
      this.sun?.removeFromParent();
    }
    const p = (this.palette = PALETTES[palette] ?? PALETTES.dusk);
    this.ink = p.ink;
    this.grade = p.grade;
    scene.background = this.background = new Color(p.fog);
    scene.fog = this.fog = new Fog(p.fog, p.fogNear, p.fogFar);
    scene.add((this.hemi = new HemisphereLight(p.hemiSky, p.hemiGround, p.hemiIntensity)));
    const sun = (this.sun = new DirectionalLight(p.dir, p.dirIntensity));
    sun.position.set(...(p.sunFrom ?? SUN_FROM));
    scene.add(sun);
    scene.add(sun.target);
    this.skyTime = { value: 0 };
    this.skyWet = { value: 0 };
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
          uDay: { value: p.day ? 1 : 0 },
          uSunset: { value: p.sunset ? 1 : 0 },
          uWet: this.skyWet,
          cloud: { value: new Color(RAIN_SKY) },
          uTime: this.skyTime,
        },
        vertexShader: `varying vec3 vDir;void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        // The prototype's synthwave sky: a gradient, a banded sun low on the horizon, stars. By day
        // (uDay) the sun is high and whole, with a wide glare, and there are no stars; at sunset
        // (uSunset) it's low and whole with a wider glow. Rain (uWet, already scaled by how
        // overcast the palette gets) greys the gradient toward cloud and hides the sun behind it.
        fragmentShader: `uniform vec3 top,mid,hor,sunC,cloud;uniform float uTime,uDay,uSunset,uWet;varying vec3 vDir;
        void main(){
          vec3 d=normalize(vDir);float h=d.y;
          vec3 col=mix(hor,mid,smoothstep(-0.02,0.16,h));
          col=mix(col,top,smoothstep(0.14,0.55,h));
          float grey=dot(col,vec3(0.3,0.59,0.11));
          col=mix(col,mix(cloud,vec3(grey),0.35)*(1.0-0.25*smoothstep(0.0,0.6,h)),uWet*0.8);
          vec3 sd=normalize(mix(vec3(0.35,0.07,-1.0),vec3(0.3,0.75,-1.0),uDay));
          float dist=distance(d,sd);
          float disc=1.0-smoothstep(0.17,0.175,dist);
          float yy=d.y-sd.y;
          float gap=clamp(-yy*5.5,0.0,0.85);
          float band=fract(yy*42.0-uTime*0.15);
          disc*=max(step(gap,band),max(uDay,uSunset));
          vec3 sunCol=mix(sunC,vec3(1.0,0.32,0.55),(1.0-smoothstep(-0.16,0.12,yy))*(1.0-uDay)*(1.0-0.6*uSunset));
          float out_=1.0-uWet*0.95;
          col=mix(col,sunCol,disc*out_);
          col+=sunC*(0.28+0.3*uDay+0.3*uSunset)*exp(-dist*(5.0-2.0*uDay-2.5*uSunset))*out_;
          float s=fract(sin(dot(floor(d*420.0),vec3(12.9898,78.233,37.719)))*43758.5453);
          col+=vec3(step(0.9985,s))*smoothstep(0.2,0.6,h)*0.8*(1.0-uDay)*(1.0-uSunset)*(1.0-uWet);
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

  car(cls: CarClass, paint: PaintDef, plate?: CarPlate): CarVisual {
    return buildCar(cls, paint, plate);
  }

  world(scene: Scene, sim: Sim, track?: TrackVisual): WorldVisual {
    return buildWorldVisual(scene, sim, track?.roof);
  }

  update(time: number, x: number, y: number, z: number, wetness = 0, snow = false): void {
    WET.value = snow ? 0 : wetness;
    if (this.skyTime) this.skyTime.value = time;
    const p = this.palette;
    // How overcast the rain makes it: all the way in the city, a sunny shower in the tropics.
    // Snow comes out of a full overcast, whatever the palette's showers do.
    const cloud = wetness * (snow ? 1 : (p.overcast ?? 1));
    if (this.skyWet) this.skyWet.value = cloud;
    if (this.fog) {
      // Rain still thickens the air where the sun stays out, if less.
      // Snow closes in further (AVALANCHE.md: fog that closes in), and whiter.
      const thick = wetness * (snow ? 1.2 : 0.5 + 0.5 * (p.overcast ?? 1));
      this.fog.near = p.fogNear * (1 - 0.5 * thick);
      this.fog.far = p.fogFar * (1 - 0.55 * thick);
      if (snow) this.fog.color.setHex(p.fog).lerp(SNOW_FOG, wetness * 0.8);
      else this.fog.color.setHex(p.fog).lerp(RAIN_FOG, wetness * 0.6 * (0.4 + 0.6 * (p.overcast ?? 1)));
      // What shows past the sky's reach is the fog's color, in any weather.
      if (this.background) this.background.copy(this.fog.color);
      if (this.hemi) this.hemi.intensity = p.hemiIntensity * (1 - 0.35 * cloud);
      if (this.sun) this.sun.intensity = p.dirIntensity * (1 - 0.6 * cloud);
    }
    this.sky?.position.set(x, y, z);
    if (this.sun) {
      const [sx, sy, sz] = p.sunFrom ?? SUN_FROM;
      this.sun.position.set(x + sx, y + sy, z + sz);
      this.sun.target.position.set(x, y, z);
    }
  }
}

