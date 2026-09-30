// Small builders shared by the city and the forest: instanced boxes, canvas textures, glow
// sprites, and points animated entirely in the shader (blinking lights, steam and smoke, fireflies,
// embers, birds), so scenery that moves costs no CPU per frame.

import { AdditiveBlending, BoxGeometry, NormalBlending, BufferGeometry, CanvasTexture, Color, Float32BufferAttribute, InstancedMesh, Matrix4, Points, Quaternion, ShaderMaterial, Vector3, type Material } from 'three';
import { glow } from './toon';

const up = new Vector3(0, 1, 0);
const m4 = new Matrix4();
const q4 = new Quaternion();
const v3 = new Vector3();
const s3 = new Vector3();
const col = new Color();

export interface Box {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  rot: number;
  color: number;
}

/** One instanced mesh for a list of boxes (unit geometry scaled per instance). */
export function boxes(list: Box[], mat: Material, geo: BufferGeometry = new BoxGeometry(1, 1, 1)): InstancedMesh {
  const mesh = new InstancedMesh(geo, mat, Math.max(1, list.length));
  list.forEach((b, k) => {
    m4.compose(v3.set(b.x, b.y, b.z), q4.setFromAxisAngle(up, b.rot), s3.set(b.w, b.h, b.d));
    mesh.setMatrixAt(k, m4);
    mesh.setColorAt(k, col.setHex(b.color));
  });
  mesh.count = list.length;
  mesh.computeBoundingSphere();
  return mesh;
}

export function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new CanvasTexture(c);
  t.anisotropy = 4;
  // Redraw once the display font has loaded (the first draw may have used a fallback).
  document.fonts?.ready.then(() => {
    g.clearRect(0, 0, w, h);
    draw(g);
    t.needsUpdate = true;
  });
  return t;
}

export const FONT = "'Bungee', 'Impact', 'Arial Black', sans-serif";


/** How each kind of animated point moves (GLSL, with p, a, s, phase, uTime in scope). */
const POINT_MODES = {
  blink: 'a=step(0.5,fract(uTime*0.8+phase))*0.9+0.1;',
  steam: 'float u=fract(uTime*0.35+phase);p.y+=u*7.0;p.x+=sin(phase*40.0+u*3.0)*u*1.5;p.z+=cos(phase*23.0+u*2.0)*u*1.5;s*=0.6+u*1.8;a=(1.0-u)*smoothstep(0.0,0.1,u)*0.5;',
  // Chimney and campfire smoke: slower, taller, drifting downwind (+x).
  smoke: 'float u=fract(uTime*0.12+phase);p.y+=u*16.0;p.x+=u*u*9.0+sin(phase*40.0+u*4.0)*u*1.5;p.z+=cos(phase*23.0+u*3.0)*u*1.5;s*=0.5+u*2.6;a=(1.0-u)*smoothstep(0.0,0.08,u)*0.45;',
  // Fireflies: wandering loops, each pulsing on its own beat.
  firefly: 'float w=uTime*0.4+phase*40.0;p.x+=sin(w)*2.5+sin(w*2.3)*1.0;p.y+=sin(w*1.7)*0.9;p.z+=cos(w*0.9)*2.5;a=pow(max(0.0,sin(uTime*(1.5+phase)+phase*30.0)),6.0);',
  // Campfire embers: quick, rising, flickering out.
  ember: 'float u=fract(uTime*0.7+phase);p.y+=u*4.0;p.x+=sin(phase*50.0+u*6.0)*u*0.8;p.z+=cos(phase*31.0+u*5.0)*u*0.8;a=(1.0-u)*step(0.3,fract(uTime*9.0+phase*7.0));s*=1.0-u*0.6;',
  // Birds: circling a point, wings flicking (size), each at its own radius and height.
  bird: 'float w=uTime*(0.18+fract(phase*7.0)*0.12)+phase*6.283;float r=18.0+fract(phase*13.0)*30.0;p.x+=cos(w)*r;p.z+=sin(w)*r;p.y+=fract(phase*3.0)*14.0+sin(w*3.0)*1.5;s*=0.7+0.3*abs(sin(uTime*9.0+phase*20.0));',
  // Mist: big soft puffs drifting slowly over water, fading in and out.
  mist: 'p.x+=sin(uTime*0.05+phase*20.0)*14.0;p.z+=cos(uTime*0.04+phase*13.0)*14.0;p.y+=sin(uTime*0.1+phase*9.0)*0.6;a=0.1+0.08*sin(uTime*0.2+phase*30.0);',
} as const;
export type PointMode = keyof typeof POINT_MODES;

export function animatedPoints(pos: number[], phase: number[], colors: number[], mode: PointMode, size: number, time: { value: number }): Points {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('phase', new Float32BufferAttribute(phase, 1));
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const mat = new ShaderMaterial({
    uniforms: { uTime: time, uSize: { value: size }, map: { value: glow() } },
    transparent: true,
    depthWrite: false,
    blending: mode === 'blink' || mode === 'firefly' || mode === 'ember' ? AdditiveBlending : NormalBlending,
    vertexShader: `attribute float phase;attribute vec3 color;uniform float uTime,uSize;varying vec3 vColor;varying float vA;
      void main(){
        vec3 p=position;float a=1.0;float s=uSize;
        ${POINT_MODES[mode]}
        vColor=color;vA=a;
        vec4 mv=modelViewMatrix*vec4(p,1.0);
        gl_PointSize=s*300.0/-mv.z;
        gl_Position=projectionMatrix*mv;
      }`,
    fragmentShader: `uniform sampler2D map;varying vec3 vColor;varying float vA;
      void main(){vec4 t=texture2D(map,gl_PointCoord);gl_FragColor=vec4(vColor,t.a*vA);}`,
  });
  const pts = new Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}


export function glowMaterial(size: number, vertexColors = false, color = 0xffffff): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { map: { value: glow() }, uSize: { value: size }, uColor: { value: new Color(color) } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: `uniform float uSize;${vertexColors ? 'attribute vec3 color;' : ''}varying vec3 vColor;
      void main(){vColor=${vertexColors ? 'color' : 'vec3(1.0)'};vec4 mv=modelViewMatrix*vec4(position,1.0);gl_PointSize=uSize*300.0/-mv.z;gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `uniform sampler2D map;uniform vec3 uColor;varying vec3 vColor;
      void main(){vec4 t=texture2D(map,gl_PointCoord);gl_FragColor=vec4(vColor*uColor,t.a);}`,
  });
}


export function glowPoints(pos: number[], color: number, size: number): Points {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.computeBoundingSphere();
  return new Points(geo, glowMaterial(size, false, color));
}

