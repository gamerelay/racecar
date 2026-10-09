// Small builders shared by the city and the forest: instanced boxes, canvas textures, glow
// sprites, and points animated entirely in the shader (blinking lights, steam and smoke, fireflies,
// embers, birds), so scenery that moves costs no CPU per frame.

import { AdditiveBlending, BoxGeometry, NormalBlending, BufferGeometry, CanvasTexture, Color, Float32BufferAttribute, InstancedMesh, Matrix4, Mesh, Points, Quaternion, ShaderMaterial, Vector3, type Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BakedSpline } from '../../../core/track/bake';
import { newHit, projectGlobal } from '../../../core/track/query';
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

/** One picture in an atlas: its size (px) and how it's drawn (from its own top left). */
export interface AtlasItem {
  w: number;
  h: number;
  draw: (g: CanvasRenderingContext2D) => void;
}

/** An atlas's pages are at most this big each way (px): what every GPU takes. */
const ATLAS_MAX = 4096;
/** Each picture's edge is drawn out this far round it (px), so a far-off, mipmapped sign samples its own edge, not its neighbour. */
const ATLAS_PAD = 8;

export interface Atlas {
  pages: CanvasTexture[];
  /** Which page a picture is on. */
  page(key: string): number;
  /** Maps a plane's 0–1 uvs onto the picture's place on its page (in place). */
  uv(key: string, g: BufferGeometry): BufferGeometry;
}

/**
 * Many small pictures on a few textures (the owner, 2026-10-09: "do the draw call pass on heist"):
 * a mesh per picture is a draw per picture, and Heist's neon words and street names were a hundred.
 * Packed in rows, tallest first, onto pages up to ATLAS_MAX square (another page when one's full; a
 * picture too big for one scaled down to fit), each picture's edge pixels drawn out into the gap
 * round it. Redrawn once the display font has loaded, as `canvas` is.
 */
export function atlas(items: ReadonlyMap<string, AtlasItem>): Atlas {
  const P = ATLAS_PAD;
  const widest = Math.max(...[...items.values()].map((it) => it.w));
  const W = Math.min(ATLAS_MAX, 2 ** Math.ceil(Math.log2(Math.max(512, widest + 2 * P))));
  /** Where each picture is: its page, its top left there, its size there and its scale. */
  const at = new Map<string, { page: number; x: number; y: number; w: number; h: number; scale: number }>();
  const used: number[] = [0];
  let [x, y, row, page] = [P, P, 0, 0];
  for (const [key, it] of [...items].sort((a, b) => b[1].h - a[1].h)) {
    const scale = Math.min(1, (W - 2 * P) / it.w, (ATLAS_MAX - 2 * P) / it.h);
    const [w, h] = [Math.ceil(it.w * scale), Math.ceil(it.h * scale)];
    if (x + w + P > W) [x, y, row] = [P, y + row + 2 * P, 0];
    if (y + h + P > ATLAS_MAX) [x, y, row, page] = [P, P, 0, page + 1];
    at.set(key, { page, x, y, w, h, scale });
    used[page] = Math.max(used[page] ?? 0, y + h + P);
    x += w + 2 * P;
    row = Math.max(row, h);
  }
  const heights = used.map((u) => 2 ** Math.ceil(Math.log2(Math.max(1, u))));
  const pages = heights.map((H, n) =>
    canvas(W, H, (g) => {
      const cv = g.canvas;
      for (const [key, it] of items) {
        const a = at.get(key)!;
        if (a.page !== n) continue;
        g.save();
        g.translate(a.x, a.y);
        g.beginPath();
        g.rect(0, 0, a.w, a.h);
        g.clip();
        g.scale(a.scale, a.scale);
        it.draw(g);
        g.restore();
        // Its edges drawn out into the gap: the columns, then the rows (corners and all).
        g.drawImage(cv, a.x, a.y, 1, a.h, a.x - P, a.y, P, a.h);
        g.drawImage(cv, a.x + a.w - 1, a.y, 1, a.h, a.x + a.w, a.y, P, a.h);
        g.drawImage(cv, a.x - P, a.y, a.w + 2 * P, 1, a.x - P, a.y - P, a.w + 2 * P, P);
        g.drawImage(cv, a.x - P, a.y + a.h - 1, a.w + 2 * P, 1, a.x - P, a.y + a.h, a.w + 2 * P, P);
      }
    }),
  );
  return {
    pages,
    page: (key) => at.get(key)!.page,
    uv(key, g) {
      const a = at.get(key)!;
      const H = heights[a.page];
      const uv = g.getAttribute('uv');
      // (The canvas's rows run down; the texture's v up.)
      for (let k = 0; k < uv.count; k++) uv.setXY(k, (a.x + uv.getX(k) * a.w) / W, 1 - (a.y + (1 - uv.getY(k)) * a.h) / H);
      return g;
    },
  };
}

/** The meshes for pictures on an atlas: each key's geometries, uv-mapped and merged by page, a material per page. */
export function atlasMeshes(sheet: Atlas, parts: Iterable<[string, BufferGeometry[]]>, material: (map: CanvasTexture) => Material): Mesh[] {
  const byPage = sheet.pages.map((): BufferGeometry[] => []);
  for (const [key, geos] of parts) for (const g of geos) byPage[sheet.page(key)].push(sheet.uv(key, g));
  return byPage.flatMap((geos, n) => (geos.length ? [new Mesh(mergeGeometries(geos)!, material(sheet.pages[n]))] : []));
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
  // A volcano's plume: huge, slow, climbing high and leaning downwind.
  plume: 'float u=fract(uTime*0.03+phase);p.y+=u*140.0;p.x+=u*u*70.0+sin(phase*40.0+u*3.0)*u*8.0;p.z+=cos(phase*23.0+u*2.0)*u*8.0;s*=0.4+u*3.2;a=(1.0-u)*smoothstep(0.0,0.05,u)*0.75;',
  // Gulls: wide, lazy circles over the water.
  gull: 'float w=uTime*(0.12+fract(phase*7.0)*0.1)+phase*6.283;float r=25.0+fract(phase*13.0)*45.0;p.x+=cos(w)*r;p.z+=sin(w)*r;p.y+=fract(phase*3.0)*18.0+sin(w*2.0)*2.0;s*=0.6+0.4*abs(sin(uTime*5.0+phase*20.0));',
  // A splash (a whale's, a blow): one burst, driven by its own clock from 0; up and out, falling back.
  splash: 'float u=clamp(uTime*0.55-phase*0.15,0.0,1.0);float w=phase*97.0;float r=(0.5+fract(phase*23.0))*9.0;p.x+=cos(w)*r*u;p.z+=sin(w)*r*u;p.y+=(26.0*u-24.0*u*u)*(0.4+fract(phase*7.0)*0.8);a=step(0.001,u)*(1.0-u)*0.85;s*=0.6+u;',
  // A fountain's spray: thrown out and up from its spout, falling back into the basin.
  spray: 'float u=fract(uTime*0.8+phase);float w=phase*83.0;float r=1.2+fract(phase*17.0)*2.6;p.x+=cos(w)*r*u;p.z+=sin(w)*r*u;p.y+=7.0*u-12.3*u*u;a=(1.0-u*u)*0.8;s*=0.6+u*0.8;',
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

/**
 * Which side of the main road a branch leaves on (1 right, -1 left), measured like the baker's
 * `sideOf`: 30 m into the branch, against the main road nearest it. (A few metres in, the branch
 * is still on the main road, and the road's own curve decides the answer.)
 */
export function branchSide(main: BakedSpline, branch: BakedSpline): -1 | 1 {
  const j = Math.min(branch.n - 1, Math.round(30 / branch.step));
  const hit = newHit();
  projectGlobal(main, branch.px[j], branch.pz[j], hit, branch.py[j]);
  return hit.lateral < 0 ? -1 : 1;
}
