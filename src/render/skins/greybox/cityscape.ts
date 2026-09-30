// City around the track: a street grid out to the fog with sidewalks, blocks of buildings sized by
// district (towers downtown, low shops in the Market), rooftop clutter, neon blade signs and
// billboards facing the road, parked cars, trees, street lamps, ambient cars on the side streets,
// steam from the manholes, blinking aviation lights, searchlights sweeping the sky, pillars under
// every bridge and lamps down the tunnel. All of it is scenery (not gameplay): the same every race,
// built once, a few dozen draw calls, and nothing but the ambient cars and a few uniforms per frame.

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { hashString, Rng } from '../../../core/rng';
import type { Track } from '../../../core/track/bake';
import { streetLamps, windowMaterial } from './city';
import type { Palette } from './palettes';
import { faceted, glow, toon } from './toon';

/** The street grid: blocks this big (street to street), streets this wide, sidewalks inside that. */
const BLOCK = 64;
const STREET = 12;
const SIDEWALK = 3;
/** How far past the track the city goes (the fog takes it from there). */
const MARGIN = 460;
const WALL_THICK = 0.5;

export interface CityScape {
  objects: Object3D[];
  update(time: number, dt: number): void;
}

// ---- where the roads are ----

/**
 * Every road sample (all splines, every 2 m) in a spatial hash, for "how far is this spot from a
 * road" when placing things. `half` is the road's reach from its centerline to the back of the wall.
 */
class Corridors {
  private readonly cell = 16;
  private readonly map = new Map<number, number[]>();
  readonly x: number[] = [];
  readonly y: number[] = [];
  readonly z: number[] = [];
  readonly half: number[] = [];
  readonly tx: number[] = [];
  readonly tz: number[] = [];
  private maxHalf = 0;

  constructor(track: Track) {
    for (const sp of track.splines) {
      for (let i = 0; i < sp.n; i += 2) {
        const k = this.x.length;
        this.x.push(sp.px[i]);
        this.y.push(sp.py[i] + sp.ramp[i]);
        this.z.push(sp.pz[i]);
        this.tx.push(sp.tx[i]);
        this.tz.push(sp.tz[i]);
        const h = sp.width[i] / 2 + sp.shoulder[i] + WALL_THICK;
        this.half.push(h);
        this.maxHalf = Math.max(this.maxHalf, h);
        const key = this.key(Math.floor(sp.px[i] / this.cell), Math.floor(sp.pz[i] / this.cell));
        let list = this.map.get(key);
        if (!list) this.map.set(key, (list = []));
        list.push(k);
      }
    }
  }

  private key(cx: number, cz: number): number {
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  /**
   * Distance from (x, z) to the nearest road's outer edge (negative: on it), looking `reach` meters
   * out; roads whose height fails `level` are ignored. Returns `reach` when nothing is that close.
   */
  clear(x: number, z: number, reach: number, level?: (y: number) => boolean): number {
    let best = reach;
    const r = Math.ceil((reach + this.maxHalf) / this.cell);
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    for (let a = -r; a <= r; a++) {
      for (let b = -r; b <= r; b++) {
        const list = this.map.get(this.key(cx + a, cz + b));
        if (!list) continue;
        for (const k of list) {
          if (level && !level(this.y[k])) continue;
          const d = Math.hypot(this.x[k] - x, this.z[k] - z) - this.half[k];
          if (d < best) best = d;
        }
      }
    }
    return best;
  }

  /** The nearest road sample to (x, z) within `reach`, or -1. */
  nearest(x: number, z: number, reach: number): number {
    let best = -1;
    let bestD = reach;
    const r = Math.ceil(reach / this.cell);
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    for (let a = -r; a <= r; a++) {
      for (let b = -r; b <= r; b++) {
        const list = this.map.get(this.key(cx + a, cz + b));
        if (!list) continue;
        for (const k of list) {
          const d = Math.hypot(this.x[k] - x, this.z[k] - z);
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        }
      }
    }
    return best;
  }
}

// ---- small builders ----

interface Box {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  rot: number;
  color: number;
}

const up = new Vector3(0, 1, 0);
const m4 = new Matrix4();
const q4 = new Quaternion();
const v3 = new Vector3();
const s3 = new Vector3();
const col = new Color();

/** One instanced mesh for a list of boxes (unit geometry scaled per instance). */
function boxes(list: Box[], mat: Material, geo: BufferGeometry = new BoxGeometry(1, 1, 1)): InstancedMesh {
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

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
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

const NEON = ['#ff2e88', '#35f0ff', '#ffd23f', '#7cff6b', '#b26bff', '#ff7a2e'];
const WORDS = ['RAMEN', '24H', 'HOTEL', 'ARCADE', 'NOODLE', 'GARAGE', 'DINER', 'KARAOKE'];
const FONT = "'Bungee', 'Impact', 'Arial Black', sans-serif";

/** A vertical neon blade sign, like the prototype's. */
function bladeTexture(word: string, color: string): CanvasTexture {
  return canvas(128, 512, (g) => {
    g.fillStyle = 'rgba(10,4,20,.9)';
    g.fillRect(8, 8, 112, 496);
    g.shadowColor = color;
    g.shadowBlur = 18;
    g.strokeStyle = color;
    g.lineWidth = 6;
    g.strokeRect(12, 12, 104, 488);
    g.font = `58px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const letters = word.split('');
    const step = (512 - 60) / letters.length;
    letters.forEach((ch, k) => {
      const y = 32 + step * (k + 0.5);
      g.shadowBlur = 24;
      g.fillStyle = color;
      g.fillText(ch, 64, y);
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,.8)';
      g.fillText(ch, 64, y);
    });
  });
}

/** Rooftop billboards: made-up ads, neon on dark. */
const ADS: { top: string; bottom: string; a: string; b: string }[] = [
  { top: 'RACECAR', bottom: 'EIGHT CARS · NO BRAKES', a: '#ff2e88', b: '#35f0ff' },
  { top: 'NITRO COLA', bottom: 'TASTES LIKE A TAKEDOWN', a: '#ff4b2e', b: '#ffd23f' },
  { top: 'GAMERELAY', bottom: 'PLAY TOGETHER', a: '#35f0ff', b: '#b26bff' },
  { top: 'ZAP', bottom: 'ENERGY · 24/7', a: '#7cff6b', b: '#ffd23f' },
];

function adTexture(ad: (typeof ADS)[number]): CanvasTexture {
  return canvas(512, 256, (g) => {
    const grad = g.createLinearGradient(0, 0, 512, 256);
    grad.addColorStop(0, '#140828');
    grad.addColorStop(1, '#2a0e3e');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 256);
    g.strokeStyle = ad.a;
    g.lineWidth = 10;
    g.shadowColor = ad.a;
    g.shadowBlur = 20;
    g.strokeRect(14, 14, 484, 228);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `96px ${FONT}`;
    g.fillStyle = ad.a;
    g.fillText(ad.top, 256, 110, 460);
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.fillText(ad.top, 256, 110, 460);
    g.font = `30px ${FONT}`;
    g.shadowColor = ad.b;
    g.shadowBlur = 12;
    g.fillStyle = ad.b;
    g.fillText(ad.bottom, 256, 196, 440);
  });
}

/** A green road sign over the Skyway. */
function signTexture(lines: [string, string]): CanvasTexture {
  return canvas(512, 192, (g) => {
    g.fillStyle = '#1f6b44';
    g.fillRect(0, 0, 512, 192);
    g.strokeStyle = '#f4efe6';
    g.lineWidth = 6;
    g.strokeRect(8, 8, 496, 176);
    g.fillStyle = '#f4efe6';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = `52px ${FONT}`;
    g.fillText(lines[0], 30, 64, 452);
    g.font = `40px ${FONT}`;
    g.fillText(lines[1], 30, 136, 452);
  });
}

/**
 * Points whose look runs in the shader from a time uniform: `blink` (aviation lights) or `steam`
 * (puffs rising and spreading from a vent). No per-frame buffer updates.
 */
function animatedPoints(pos: number[], phase: number[], colors: number[], mode: 'blink' | 'steam', size: number, time: { value: number }): Points {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('phase', new Float32BufferAttribute(phase, 1));
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const mat = new ShaderMaterial({
    uniforms: { uTime: time, uSize: { value: size }, map: { value: glow() } },
    transparent: true,
    depthWrite: false,
    blending: mode === 'blink' ? AdditiveBlending : undefined,
    vertexShader: `attribute float phase;attribute vec3 color;uniform float uTime,uSize;varying vec3 vColor;varying float vA;
      void main(){
        vec3 p=position;float a=1.0;float s=uSize;
        ${
          mode === 'blink'
            ? 'a=step(0.5,fract(uTime*0.8+phase))*0.9+0.1;'
            : 'float u=fract(uTime*0.35+phase);p.y+=u*7.0;p.x+=sin(phase*40.0+u*3.0)*u*1.5;p.z+=cos(phase*23.0+u*2.0)*u*1.5;s*=0.6+u*1.8;a=(1.0-u)*smoothstep(0.0,0.1,u)*0.5;'
        }
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

// ---- the city ----

export function buildCityscape(track: Track, palette: Palette, ground: number): CityScape {
  const rng = Rng.stream(hashString(track.layout.id), 'cityscape');
  const roads = new Corridors(track);
  const objects: Object3D[] = [];
  const time = { value: 0 };
  const animators: ((t: number, dt: number) => void)[] = [];

  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, sx = 0, sz = 0, n = 0;
  for (const sp of track.splines) {
    for (let i = 0; i < sp.n; i += 4) {
      x0 = Math.min(x0, sp.px[i]);
      x1 = Math.max(x1, sp.px[i]);
      z0 = Math.min(z0, sp.pz[i]);
      z1 = Math.max(z1, sp.pz[i]);
      sx += sp.px[i];
      sz += sp.pz[i];
      n++;
    }
  }
  // Downtown's core (tallest towers) is the middle of the lap; the Market is the lap's lowest,
  // tightest corner: wherever the narrow two-lane streets are, shops instead of towers.
  const core = { x: sx / n, z: sz / n };
  let market = { x: 0, z: 0, n: 0 };
  for (let i = 0; i < track.main.n; i += 4) {
    if (track.main.width[i] < 18 && Math.abs(track.main.py[i]) < 3) market = { x: market.x + track.main.px[i], z: market.z + track.main.pz[i], n: market.n + 1 };
  }
  const mk = market.n ? { x: market.x / market.n, z: market.z / market.n } : { x: 1e9, z: 1e9 };
  const gx0 = Math.floor((x0 - MARGIN) / BLOCK) * BLOCK;
  const gz0 = Math.floor((z0 - MARGIN) / BLOCK) * BLOCK;
  const gx1 = Math.ceil((x1 + MARGIN) / BLOCK) * BLOCK;
  const gz1 = Math.ceil((z1 + MARGIN) / BLOCK) * BLOCK;
  // Roads in a trench or tunnel cut the ground; anything else sits on it (or passes over it).
  const sunk = (y: number) => y < ground - 0.5;

  // ---- ground: asphalt everywhere, with holes where a trench runs ----
  {
    const pos: number[] = [];
    const colors: number[] = [];
    const idx: number[] = [];
    const street = new Color(0x2a2140);
    const quad = (ax: number, az: number, bx: number, bz: number) => {
      const b = pos.length / 3;
      pos.push(ax, ground, az, bx, ground, az, bx, ground, bz, ax, ground, bz);
      for (let k = 0; k < 4; k++) colors.push(street.r, street.g, street.b);
      idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    };
    const C = 16;
    const inTrench = (x: number, z: number) => roads.clear(x, z, 2, sunk) < 0;
    for (let x = gx0; x < gx1; x += C) {
      for (let z = gz0; z < gz1; z += C) {
        const hits = [inTrench(x, z), inTrench(x + C, z), inTrench(x, z + C), inTrench(x + C, z + C), inTrench(x + C / 2, z + C / 2)];
        if (!hits.some(Boolean)) quad(x, z, x + C, z + C);
        else {
          // Near a trench: 4 m cells, keeping those whose middle is off it.
          for (let a = 0; a < C; a += 4) for (let b = 0; b < C; b += 4) if (!inTrench(x + a + 2, z + b + 2)) quad(x + a, z + b, x + a + 4, z + b + 4);
        }
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new Mesh(g, toon({ vertexColors: true }));
    mesh.matrixAutoUpdate = false;
    objects.push(mesh);
  }

  // ---- the grid: blocks (sidewalk slabs) and lots, clear of every road ----
  const slabs: Box[] = [];
  const buildings: Box[] = [];
  const roofs: Box[] = [];
  const clutter: Box[] = [];
  const awnings: Box[] = [];
  const antennas: Box[] = [];
  const waterTowers: { x: number; y: number; z: number; s: number }[] = [];
  const blinkPos: number[] = [];
  const blinkPhase: number[] = [];
  const blinkColor: number[] = [];
  const blades: { x: number; y: number; z: number; rot: number; word: number; s: number }[] = [];
  const boards: { x: number; y: number; z: number; rot: number; ad: number; w: number }[] = [];
  const searchSpots: { x: number; y: number; z: number }[] = [];
  const blink = (x: number, y: number, z: number, red = true) => {
    blinkPos.push(x, y, z);
    blinkPhase.push(rng.next());
    blinkColor.push(red ? 1 : 1, red ? 0.12 : 0.9, red ? 0.2 : 0.8);
  };
  // Raised roads keep buildings further off, so from up there you see down over the city.
  const raised = (y: number) => y > ground + 3.5;
  const lotClear = (cx: number, cz: number, w: number, d: number, margin: number) => {
    for (let a = -0.5; a <= 0.5; a += 0.25) {
      for (let b = -0.5; b <= 0.5; b += 0.25) {
        if (roads.clear(cx + a * w, cz + b * d, margin + 1) < margin) return false;
        if (roads.clear(cx + a * w, cz + b * d, margin + 15, raised) < margin + 14) return false;
      }
    }
    return true;
  };
  // Which way a building's road-facing wall points: the axis direction closest to the nearest road.
  const facing = (x: number, z: number, reach: number): number | null => {
    const k = roads.nearest(x, z, reach);
    if (k < 0) return null;
    const dx = roads.x[k] - x;
    const dz = roads.z[k] - z;
    return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? Math.PI / 2 : -Math.PI / 2) : dz > 0 ? 0 : Math.PI;
  };

  const heightAt = (x: number, z: number) => {
    const dCore = Math.hypot(x - core.x, z - core.z);
    const dMarket = Math.hypot(x - mk.x, z - mk.z);
    if (dMarket < 170) return { lo: 7, hi: 16, kind: 'shop' as const };
    if (dCore < 260) return { lo: 45, hi: 150, kind: 'tower' as const };
    if (dCore < 520) return { lo: 18, hi: 60, kind: 'mid' as const };
    return { lo: 10, hi: 32, kind: 'low' as const };
  };

  const addBuilding = (cx: number, cz: number, w: number, d: number, dist: number) => {
    const { lo, hi, kind } = heightAt(cx, cz);
    // Taller the closer to the middle of its district, with a few landmarks.
    let h = lo + (hi - lo) * rng.next() ** 1.6;
    if (kind === 'tower' && rng.next() < 0.12) h *= 1.35;
    const color = palette.blocks[Math.floor(rng.next() * palette.blocks.length)];
    const base = ground;
    if (kind === 'tower' && h > 70) {
      // Setbacks: a base, a shaft, a crown.
      const h1 = h * 0.35;
      const h2 = h * 0.45;
      const h3 = h - h1 - h2;
      buildings.push({ x: cx, y: base + h1 / 2, z: cz, w, h: h1, d, rot: 0, color });
      buildings.push({ x: cx, y: base + h1 + h2 / 2, z: cz, w: w * 0.78, h: h2, d: d * 0.78, rot: 0, color });
      buildings.push({ x: cx, y: base + h1 + h2 + h3 / 2, z: cz, w: w * 0.55, h: h3, d: d * 0.55, rot: 0, color });
      roofs.push({ x: cx, y: base + h1 + 0.3, z: cz, w: w + 0.6, h: 0.6, d: d + 0.6, rot: 0, color: 0x221a36 });
      roofs.push({ x: cx, y: base + h1 + h2 + 0.3, z: cz, w: w * 0.78 + 0.6, h: 0.6, d: d * 0.78 + 0.6, rot: 0, color: 0x221a36 });
      roofs.push({ x: cx, y: base + h + 0.3, z: cz, w: w * 0.55 + 0.6, h: 0.6, d: d * 0.55 + 0.6, rot: 0, color: 0x221a36 });
      // Some get a mast with a red light; all get lights at the crown's corners.
      if (rng.next() < 0.25) {
        const mast = 8 + rng.next() * 16;
        antennas.push({ x: cx, y: base + h + mast / 2, z: cz, w: 0.5, h: mast, d: 0.5, rot: 0, color: 0x3a3050 });
        blink(cx, base + h + mast + 0.3, cz);
      } else if (rng.next() < 0.4) {
        // A lit crown: a glowing band round the top.
        clutter.push({ x: cx, y: base + h - 1.5, z: cz, w: w * 0.55 + 0.2, h: 1.2, d: d * 0.55 + 0.2, rot: 0, color: 0x6d5f86 });
      }
      for (const [a, b] of [[-1, -1], [1, 1]]) blink(cx + (a * w * 0.55) / 2, base + h + 0.8, cz + (b * d * 0.55) / 2);
      if (rng.next() < 0.1) searchSpots.push({ x: cx, y: base + h + 1, z: cz });
    } else {
      buildings.push({ x: cx, y: base + h / 2, z: cz, w, h, d, rot: 0, color });
      roofs.push({ x: cx, y: base + h + 0.3, z: cz, w: w + 0.6, h: 0.6, d: d + 0.6, rot: 0, color: 0x221a36 });
      // Rooftop clutter: AC units and stair boxes.
      const units = Math.floor(rng.next() * 4);
      for (let k = 0; k < units; k++) {
        const s = 1.5 + rng.next() * 3;
        clutter.push({ x: cx + (rng.next() - 0.5) * (w - s - 2), y: base + h + 0.6 + s / 3, z: cz + (rng.next() - 0.5) * (d - s - 2), w: s, h: (s * 2) / 3, d: s, rot: 0, color: 0x6d5f86 });
      }
      if ((kind === 'mid' || kind === 'low') && h > 16 && rng.next() < 0.3) waterTowers.push({ x: cx + (rng.next() - 0.5) * (w - 6), y: base + h + 0.6, z: cz + (rng.next() - 0.5) * (d - 6), s: 0.8 + rng.next() * 0.5 });
      if (h > 40 && rng.next() < 0.5) blink(cx, base + h + 1, cz);
    }
    // Near the road: neon blade signs on the road side, a billboard on the roof, shop awnings.
    const rot = dist < 70 ? facing(cx, cz, 120) : null;
    if (rot !== null) {
      const fx = Math.sin(rot);
      const fz = Math.cos(rot);
      const half = Math.abs(fx) > 0.5 ? w / 2 : d / 2;
      const across = Math.abs(fx) > 0.5 ? d : w;
      if (dist < 45 && rng.next() < (kind === 'shop' ? 0.9 : 0.55)) {
        const signs = kind === 'shop' ? 1 + Math.floor(rng.next() * 2) : 1;
        for (let k = 0; k < signs; k++) {
          const along = (rng.next() - 0.5) * (across - 4);
          const s = 1.5 + rng.next() * 0.9;
          const y = base + Math.min(h - 2 * s - 1, 4 + 2 * s + rng.next() * 12);
          if (y < base + 2 * s + 1) continue;
          blades.push({ x: cx + fx * (half + 1.1) + fz * along, y, z: cz + fz * (half + 1.1) - fx * along, rot, word: Math.floor(rng.next() * WORDS.length), s });
        }
      }
      if (kind === 'shop' && dist < 40) {
        awnings.push({ x: cx + fx * (half + 0.9), y: base + 3.2, z: cz + fz * (half + 0.9), w: Math.abs(fx) > 0.5 ? 1.8 : across - 2, h: 0.35, d: Math.abs(fx) > 0.5 ? across - 2 : 1.8, rot: 0, color: [0xff2e88, 0x35a8ff, 0xffbe0b, 0x7cff6b, 0xb26bff][Math.floor(rng.next() * 5)] });
      }
      if (h > 12 && h < 60 && dist < 70 && rng.next() < 0.35) boards.push({ x: cx, y: base + h + 0.6, z: cz, rot, ad: Math.floor(rng.next() * ADS.length), w: Math.min(across, 16) });
    }
  };

  for (let bx = gx0; bx < gx1; bx += BLOCK) {
    for (let bz = gz0; bz < gz1; bz += BLOCK) {
      const size = BLOCK - STREET;
      const cx = bx + STREET / 2 + size / 2;
      const cz = bz + STREET / 2 + size / 2;
      const dist = roads.clear(cx, cz, 400);
      // Whole block, or its four quarters, as far as the roads allow.
      const quarters: [number, number, number][] = [];
      if (lotClear(cx, cz, size, size, 1)) quarters.push([cx, cz, size]);
      else {
        const qs = size / 2;
        for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const qx = cx + (a * qs) / 2;
          const qz = cz + (b * qs) / 2;
          if (lotClear(qx, qz, qs, qs, 1)) quarters.push([qx, qz, qs]);
        }
      }
      for (const [qx, qz, qs] of quarters) {
        slabs.push({ x: qx, y: ground + 0.07, z: qz, w: qs, h: 0.14, d: qs, rot: 0, color: 0x6d5f86 });
        const lot = qs - SIDEWALK * 2;
        // Split a lot into one to four buildings.
        const split = heightAt(qx, qz).kind === 'shop' || qs < size ? 2 : rng.next() < 0.5 ? 1 : 2;
        const cell = lot / split;
        for (let a = 0; a < split; a++) {
          for (let b = 0; b < split; b++) {
            if (rng.next() < 0.08) continue; // a gap: a parking lot, a plaza
            const w = cell - rng.range(1, 3);
            const d = cell - rng.range(1, 3);
            const x = qx - lot / 2 + cell * (a + 0.5);
            const z = qz - lot / 2 + cell * (b + 0.5);
            if (!lotClear(x, z, w, d, 3)) continue;
            addBuilding(x, z, w, d, Math.max(0, dist));
          }
        }
      }
    }
  }

  const blockMat = toon();
  objects.push(boxes(slabs, blockMat));
  objects.push(boxes(buildings, windowMaterial(palette.windows)));
  objects.push(boxes(roofs, toon()));
  objects.push(boxes(clutter, toon()));
  objects.push(boxes(antennas, toon()));
  if (awnings.length) objects.push(boxes(awnings, toon()));

  // Water towers: legs, tank, cone roof.
  if (waterTowers.length) {
    const tank = new InstancedMesh(faceted(new CylinderGeometry(2.2, 2.2, 3.6, 10)), toon({ color: 0x8a5a3a }), waterTowers.length);
    const cap = new InstancedMesh(faceted(new ConeGeometry(2.5, 1.6, 10)), toon({ color: 0x4a3a50 }), waterTowers.length);
    const legs = new InstancedMesh(new BoxGeometry(3.4, 2.4, 3.4), toon({ color: 0x2a2140, wireframe: false }), waterTowers.length);
    waterTowers.forEach((t, k) => {
      m4.compose(v3.set(t.x, t.y + 1.2 * t.s, t.z), q4.identity(), s3.set(t.s * 0.4, t.s, t.s * 0.4));
      legs.setMatrixAt(k, m4);
      m4.compose(v3.set(t.x, t.y + (2.4 + 1.8) * t.s, t.z), q4.identity(), s3.set(t.s, t.s, t.s));
      tank.setMatrixAt(k, m4);
      m4.compose(v3.set(t.x, t.y + (2.4 + 3.6 + 0.8) * t.s, t.z), q4.identity(), s3.set(t.s, t.s, t.s));
      cap.setMatrixAt(k, m4);
    });
    for (const mesh of [tank, cap, legs]) mesh.computeBoundingSphere();
    objects.push(tank, cap, legs);
  }

  // Neon blade signs: one instanced mesh per word.
  {
    const geo = new PlaneGeometry(1, 4);
    WORDS.forEach((word, wi) => {
      const list = blades.filter((b) => b.word === wi);
      if (!list.length) return;
      const mat = new MeshBasicMaterial({ map: bladeTexture(word, NEON[wi % NEON.length]), transparent: true, side: DoubleSide, fog: false });
      const mesh = new InstancedMesh(geo, mat, list.length);
      list.forEach((b, k) => {
        // The blade stands out from the wall: its face is perpendicular to the wall.
        m4.compose(v3.set(b.x, b.y, b.z), q4.setFromAxisAngle(up, b.rot + Math.PI / 2), s3.set(b.s, b.s, 1));
        mesh.setMatrixAt(k, m4);
      });
      mesh.computeBoundingSphere();
      objects.push(mesh);
    });
  }

  // Billboards: a frame on legs and a face, one mesh per ad.
  {
    const frames: Box[] = [];
    const geo = new PlaneGeometry(1, 0.5);
    ADS.forEach((ad, ai) => {
      const list = boards.filter((b) => b.ad === ai);
      if (!list.length) return;
      const mesh = new InstancedMesh(geo, new MeshBasicMaterial({ map: adTexture(ad), fog: false }), list.length);
      list.forEach((b, k) => {
        const fx = Math.sin(b.rot);
        const fz = Math.cos(b.rot);
        const hgt = b.w / 2;
        m4.compose(v3.set(b.x + fx * 0.3, b.y + 3 + hgt / 2, b.z + fz * 0.3), q4.setFromAxisAngle(up, b.rot), s3.set(b.w, b.w, 1));
        mesh.setMatrixAt(k, m4);
        frames.push({ x: b.x, y: b.y + 3 + hgt / 2, z: b.z, w: Math.abs(fx) > 0.5 ? 0.4 : b.w + 0.6, h: hgt + 0.6, d: Math.abs(fx) > 0.5 ? b.w + 0.6 : 0.4, rot: 0, color: 0x1a1428 });
        for (const s of [-0.35, 0.35]) frames.push({ x: b.x + fz * s * b.w, y: b.y + 1.5, z: b.z - fx * s * b.w, w: 0.4, h: 3, d: 0.4, rot: 0, color: 0x1a1428 });
      });
      mesh.computeBoundingSphere();
      objects.push(mesh);
    });
    if (frames.length) objects.push(boxes(frames, toon()));
  }

  // ---- side streets: lamps, parked cars, trees, ambient traffic, steam ----
  // Street centerlines between the blocks, cut wherever a road (or its walls) is in the way.
  const segments: { x: number; z: number; dx: number; dz: number; len: number }[] = [];
  const cut = (x: number, z: number) => roads.clear(x, z, 12) < 6;
  for (let bx = gx0; bx <= gx1; bx += BLOCK) {
    let start = -1;
    for (let z = gz0; z <= gz1; z += 4) {
      const blocked = cut(bx, z) || z >= gz1;
      if (!blocked && start < 0) start = z;
      if (blocked && start >= 0) {
        if (z - start > 40) segments.push({ x: bx, z: start, dx: 0, dz: 1, len: z - start });
        start = -1;
      }
    }
  }
  for (let bz = gz0; bz <= gz1; bz += BLOCK) {
    let start = -1;
    for (let x = gx0; x <= gx1; x += 4) {
      const blocked = cut(x, bz) || x >= gx1;
      if (!blocked && start < 0) start = x;
      if (blocked && start >= 0) {
        if (x - start > 40) segments.push({ x: start, z: bz, dx: 1, dz: 0, len: x - start });
        start = -1;
      }
    }
  }

  const parked: Box[] = [];
  const trees: { x: number; z: number; s: number; c: number }[] = [];
  const lampPos: number[] = [];
  const poles: Box[] = [];
  const dashes: Box[] = [];
  const PARK = [0xf2f2f2, 0x3a86ff, 0xffbe0b, 0x8338ec, 0x06d6a0, 0xef476f, 0x2a2a3a, 0xc9c1d9];
  for (const sg of segments) {
    const rx = sg.dz;
    const rz = -sg.dx;
    const rot = Math.atan2(sg.dx, sg.dz);
    for (let u = 6; u < sg.len - 6; u += 8) {
      const x = sg.x + sg.dx * u;
      const z = sg.z + sg.dz * u;
      dashes.push({ x, y: ground + 0.015, z, w: sg.dx ? 3 : 0.18, h: 0.02, d: sg.dx ? 0.18 : 3, rot: 0, color: 0xa89cc0 });
      for (const side of [-1, 1]) {
        if (rng.next() < 0.45) parked.push({ x: x + rx * side * (STREET / 2 - 1.2), y: ground + 0.75, z: z + rz * side * (STREET / 2 - 1.2), w: 1.9, h: 1.3, d: 4.2, rot, color: PARK[Math.floor(rng.next() * PARK.length)] });
      }
    }
    for (let u = 10, side = 1; u < sg.len - 10; u += 26, side = -side) {
      const x = sg.x + sg.dx * u + rx * side * (STREET / 2 + 1);
      const z = sg.z + sg.dz * u + rz * side * (STREET / 2 + 1);
      poles.push({ x, y: ground + 3.5, z, w: 0.22, h: 7, d: 0.22, rot: 0, color: 0x2a2140 });
      lampPos.push(x - rx * side * 1.6, ground + 6.8, z - rz * side * 1.6);
    }
    for (let u = 16; u < sg.len - 10; u += 13) {
      for (const side of [-1, 1]) {
        if (rng.next() < 0.5) continue;
        const x = sg.x + sg.dx * u + rx * side * (STREET / 2 + SIDEWALK - 1);
        const z = sg.z + sg.dz * u + rz * side * (STREET / 2 + SIDEWALK - 1);
        if (roads.clear(x, z, 8) < 3) continue;
        trees.push({ x, z, s: 0.8 + rng.next() * 0.5, c: [0x3f6b3a, 0x2f5a32, 0x4f7d3a, 0x5a3f6b][Math.floor(rng.next() * 4)] });
      }
    }
  }
  objects.push(boxes(parked, toon()));
  objects.push(boxes(poles, toon()));
  objects.push(boxes(dashes, new MeshBasicMaterial({ color: 0xa89cc0 })));
  objects.push(glowPoints(lampPos, 0xffc27a, 3.2));
  if (trees.length) {
    const crown = new InstancedMesh(faceted(new IcosahedronGeometry(2.2, 0)), toon(), trees.length);
    const trunk = new InstancedMesh(new BoxGeometry(0.35, 2.4, 0.35), toon({ color: 0x3a2a30 }), trees.length);
    trees.forEach((t, k) => {
      m4.compose(v3.set(t.x, ground + 1.2 * t.s, t.z), q4.identity(), s3.set(t.s, t.s, t.s));
      trunk.setMatrixAt(k, m4);
      m4.compose(v3.set(t.x, ground + 3.8 * t.s, t.z), q4.setFromAxisAngle(up, t.x), s3.set(t.s, t.s * 0.9, t.s));
      crown.setMatrixAt(k, m4);
      crown.setColorAt(k, col.setHex(t.c));
    });
    crown.computeBoundingSphere();
    trunk.computeBoundingSphere();
    objects.push(crown, trunk);
  }

  // Ambient cars: driving the side streets both ways, wrapping at each segment's ends.
  {
    const cars: { sg: number; u: number; v: number; lane: number; color: number; long: number }[] = [];
    segments.forEach((sg, k) => {
      const count = Math.floor(sg.len / 45);
      for (let c = 0; c < count; c++) cars.push({ sg: k, u: rng.next() * sg.len, v: 8 + rng.next() * 6, lane: rng.next() < 0.5 ? -1 : 1, color: PARK[Math.floor(rng.next() * PARK.length)], long: rng.next() < 0.15 ? 1.4 : 1 });
    });
    const body = new InstancedMesh(new BoxGeometry(1.9, 1.1, 4.3), toon(), Math.max(1, cars.length));
    const cabin = new InstancedMesh(new BoxGeometry(1.7, 0.6, 2.2), toon({ color: 0x243a66 }), Math.max(1, cars.length));
    body.frustumCulled = cabin.frustumCulled = false;
    cars.forEach((c, k) => body.setColorAt(k, col.setHex(c.color)));
    body.count = cabin.count = cars.length;
    const lights = new Float32Array(cars.length * 4 * 3);
    const lightCol = new Float32Array(cars.length * 4 * 3);
    for (let k = 0; k < cars.length; k++) {
      lightCol.set([1, 0.95, 0.8, 1, 0.95, 0.8, 1, 0.13, 0.2, 1, 0.13, 0.2], k * 12);
    }
    const lgeo = new BufferGeometry();
    lgeo.setAttribute('position', new BufferAttribute(lights, 3));
    lgeo.setAttribute('color', new BufferAttribute(lightCol, 3));
    const lpts = new Points(lgeo, glowMaterial(1.3, true));
    lpts.frustumCulled = false;
    objects.push(body, cabin, lpts);
    animators.push((_t, dt) => {
      for (let k = 0; k < cars.length; k++) {
        const c = cars[k];
        const sg = segments[c.sg];
        c.u = (c.u + c.v * dt * c.lane + sg.len) % sg.len;
        const rx = sg.dz;
        const rz = -sg.dx;
        const off = c.lane * 2.6;
        const x = sg.x + sg.dx * c.u + rx * off;
        const z = sg.z + sg.dz * c.u + rz * off;
        const hx = sg.dx * c.lane;
        const hz = sg.dz * c.lane;
        const rot = Math.atan2(hx, hz);
        q4.setFromAxisAngle(up, rot);
        m4.compose(v3.set(x, ground + 0.8, z), q4, s3.set(1, 1, c.long));
        body.setMatrixAt(k, m4);
        m4.compose(v3.set(x - hx * 0.3, ground + 1.6, z - hz * 0.3), q4, s3.set(1, 1, c.long));
        cabin.setMatrixAt(k, m4);
        const L = 2.2 * c.long;
        const j = k * 12;
        for (const [n, along, side] of [[0, L, -0.6], [1, L, 0.6], [2, -L, -0.6], [3, -L, 0.6]] as const) {
          lights[j + n * 3] = x + hx * along + -hz * side;
          lights[j + n * 3 + 1] = ground + 0.8;
          lights[j + n * 3 + 2] = z + hz * along + hx * side;
        }
      }
      body.instanceMatrix.needsUpdate = cabin.instanceMatrix.needsUpdate = true;
      (lgeo.attributes.position as BufferAttribute).needsUpdate = true;
    });
  }

  // Steam from manholes near the track.
  {
    const pos: number[] = [];
    const phase: number[] = [];
    const colors: number[] = [];
    let vents = 0;
    for (const sg of segments) {
      if (vents >= 14 || rng.next() < 0.6) continue;
      const u = rng.range(10, sg.len - 10);
      const x = sg.x + sg.dx * u;
      const z = sg.z + sg.dz * u;
      if (roads.clear(x, z, 120) > 90) continue;
      vents++;
      for (let k = 0; k < 36; k++) {
        pos.push(x, ground + 0.2, z);
        phase.push(k / 36 + rng.next() * 0.02);
        colors.push(0.8, 0.72, 0.9);
      }
    }
    if (pos.length) objects.push(animatedPoints(pos, phase, colors, 'steam', 2.2, time));
  }

  objects.push(animatedPoints(blinkPos, blinkPhase, blinkColor, 'blink', 2.4, time));

  // Searchlights: long faint cones sweeping the sky from a few rooftops.
  {
    const geo = new ConeGeometry(18, 420, 20, 1, true).translate(0, -210, 0).rotateX(Math.PI);
    const mat = new MeshBasicMaterial({ color: 0xbfd8ff, transparent: true, opacity: 0.07, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false });
    const lights = searchSpots.slice(0, 4).map((s, k) => {
      const g = new Group();
      g.position.set(s.x, s.y, s.z);
      const beam = new Mesh(geo, mat);
      g.add(beam);
      objects.push(g);
      return { g, beam, phase: k * 1.7 };
    });
    animators.push((t) => {
      for (const l of lights) {
        l.g.rotation.y = t * 0.25 + l.phase;
        l.beam.rotation.x = 0.45 + Math.sin(t * 0.4 + l.phase) * 0.2;
      }
    });
  }

  // ---- under bridges and in the tunnel ----
  {
    const pillars: Box[] = [];
    const caps: Box[] = [];
    const tunnelLamps: number[] = [];
    const pools: Box[] = [];
    const fixtures: Box[] = [];
    const strips: Box[] = [];
    for (const sp of track.splines) {
      for (let i = 0; i < sp.n; i += 1) {
        const y = sp.py[i] + sp.ramp[i];
        const s = i * sp.step;
        const rx = -sp.tz[i];
        const rz = sp.tx[i];
        const rot = Math.atan2(sp.tx[i], sp.tz[i]);
        if (y - ground > 3.5 && Math.round(s) % 24 === 0) {
          const bottom = y - 1.2;
          const off = sp.width[i] >= 18 ? [-(sp.width[i] / 2 - 3), sp.width[i] / 2 - 3] : [0];
          let placed = false;
          for (const l of off) {
            const x = sp.px[i] + rx * l;
            const z = sp.pz[i] + rz * l;
            // Not on a road below (the colonnade on the Boulevard is gameplay, already there).
            if (roads.clear(x, z, 4, (ry) => ry < y - 3) < 1.5) continue;
            pillars.push({ x, y: (ground + bottom) / 2, z, w: 2.2, h: bottom - ground, d: 2.2, rot, color: 0x8f84a8 });
            placed = true;
          }
          if (placed) caps.push({ x: sp.px[i], y: bottom - 0.5, z: sp.pz[i], w: sp.width[i] * 0.8, h: 1, d: 2.6, rot, color: 0x6d5f86 });
        }
        if (y < ground - 4.5 && i % 10 === 0) {
          tunnelLamps.push(sp.px[i], ground - 1.05, sp.pz[i]);
          fixtures.push({ x: sp.px[i], y: ground - 0.8, z: sp.pz[i], w: 3, h: 0.25, d: 0.8, rot, color: 0xffe0b0 });
          pools.push({ x: sp.px[i], y: y + 0.04, z: sp.pz[i], w: sp.width[i] * 0.9, h: 1, d: 7, rot, color: 0xff9a3c });
          // Neon strips along both walls, a dash every lamp.
          const edge = sp.width[i] / 2 + sp.shoulder[i] - 0.06;
          for (const side of [-1, 1]) strips.push({ x: sp.px[i] + rx * side * edge, y: y + 2.4, z: sp.pz[i] + rz * side * edge, w: 0.1, h: 0.22, d: 8, rot, color: side < 0 ? 0x35f0ff : 0xff2e88 });
        }
      }
    }
    objects.push(boxes(pillars, toon()));
    if (caps.length) objects.push(boxes(caps, toon()));
    if (tunnelLamps.length) {
      objects.push(glowPoints(tunnelLamps, 0xffa54a, 4));
      objects.push(boxes(fixtures, new MeshBasicMaterial({ color: 0xffffff })));
      objects.push(boxes(strips, new MeshBasicMaterial({ color: 0xffffff })));
      const pool = boxes(pools, new MeshBasicMaterial({ map: glow(), transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false }), new PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
      objects.push(pool);
    }
  }

  // Overhead signs on the Skyway.
  {
    const main = track.main;
    const spots: number[] = [];
    for (let i = 0; i < main.n; i += 10) if (main.py[i] - ground > 10 && (spots.length === 0 || i - spots[spots.length - 1] > 500)) spots.push(i);
    const texts: [string, string][] = [
      ['SKYWAY', 'DOWNTOWN · MARKET ↓'],
      ['MARKET', 'NEXT EXIT · TUNNEL'],
    ];
    const posts = new BoxGeometry(0.5, 1, 0.5);
    const postMat = toon({ color: 0x5a5470 });
    spots.slice(0, 2).forEach((i, k) => {
      const g = new Group();
      const span = main.width[i] / 2 + main.shoulder[i];
      for (const side of [-1, 1]) {
        const p = new Mesh(posts, postMat);
        p.scale.y = 7.4;
        p.position.set(side * span, 3.7, 0);
        g.add(p);
      }
      const beam = new Mesh(new BoxGeometry(span * 2, 0.5, 0.5), postMat);
      beam.position.y = 7.2;
      g.add(beam);
      const face = new Mesh(new PlaneGeometry(9, 3.4), new MeshBasicMaterial({ map: signTexture(texts[k % texts.length]), side: DoubleSide }));
      face.position.set(span * 0.35, 6.2, -0.3);
      face.rotation.y = Math.PI;
      g.add(face);
      g.position.set(main.px[i], main.py[i], main.pz[i]);
      g.rotation.y = Math.atan2(main.tx[i], main.tz[i]);
      objects.push(g);
    });
  }

  objects.push(streetLamps(track));

  return {
    objects,
    update(t, dt) {
      time.value = t;
      for (const a of animators) a(t, dt);
    },
  };
}

function glowMaterial(size: number, vertexColors = false, color = 0xffffff): ShaderMaterial {
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

/** Static glow points (lamp heads), sized in world meters. */
function glowPoints(pos: number[], color: number, size: number): Points {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.computeBoundingSphere();
  return new Points(geo, glowMaterial(size, false, color));
}
