// Builds a car from its design (designs.ts). The body is the side profile extruded across the car
// with chamfered edges, wheel arches cut into the sill and the nose and tail pinched in plan view;
// the greenhouse is a second extrusion that narrows toward the roof. Details (lamps, pipes, wing,
// diffuser, mirrors) are small boxes and cylinders placed on those surfaces. Everything static is
// merged per material, so a car is about a dozen draw calls however much detail it carries.

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  ExtrudeGeometry,
  Group,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Shape,
  Sprite,
  SpriteMaterial,
  Vector3,
  CanvasTexture,
  Box3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CarClass, PaintDef } from '../../../../core/content';
import { INK, markInk, SEAM, unmarkInk } from '../../../ink';
import type { CarVisual } from '../../../skin';
import { glow, toon } from '../toon';
import { type CarDesign, DESIGNS } from './designs';
import { carPaint } from './paint';
import { CarWreck, type Detachable } from './wreck';

/**
 * Chamfer on the body's long edges: depth into the side, and outward offset of the walls. Kept
 * shallow (about 18° off the top): the ink pass creases at 25° or more, and a chamfer near that
 * angle inked in and out along its edge, a dashed line wherever a taper or a sloping deck nudged it.
 */
const BT = 0.09;
const BS = 0.03;

const trim = toon({ color: 0x16121f });
// A touch blue: the dusk key light is pink, and a neutral grey came out rosy under it.
const metal = toon({ color: 0xaeb6cc });
/** Unlit parts that never change color (lens surrounds, lamps, plates, signs) share one mesh, colored per vertex. */
const LAMP: Partial<Record<Key, number>> = { lens: 0x3a0a18, head: 0xfff4cc, plate: 0xd6d0e4, sign: 0xffb13b };
const lampMat = new MeshBasicMaterial({ vertexColors: true });
/** Rims: a flat face colored per vertex (bright spokes and lip over a dark dish), one mesh a wheel. */
const rimMat = toon({ vertexColors: true });
const RIM = { light: 0xb4bfd8, dark: 0x2a2436, gold: 0xffd23f, goldDark: 0x5a3f12 };
const glassMat = carPaint({ id: 'glass', name: 'glass', color: '#27366a', finish: 'gloss' }, 'none', undefined, true);
const headGlow = new SpriteMaterial({ map: glow(), color: 0xfff0c0, transparent: true, blending: AdditiveBlending, depthWrite: false });
const flameMat = new MeshBasicMaterial({ map: glow(), color: 0xff7a1a, transparent: true, blending: AdditiveBlending, depthWrite: false });
/** Materials every car shares (module-level): never freed with one car or one world. */
export const CAR_MATERIALS: readonly Material[] = [trim, metal, lampMat, rimMat, glassMat, headGlow, flameMat];
/** Light bar lens colors, off and lit. */
const BEACON = { red: [0x5a0a1c, 0xff2848], blue: [0x0c1a5c, 0x3a7bff] } as const;
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

/** Non-indexed, position and normal only, flat normals: what every merged bucket holds. `keep`: the normals it has are the right ones. */
export function prep(geo: BufferGeometry, keep = false): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && !(keep && name === 'normal')) g.deleteAttribute(name);
  if (!keep) g.computeVertexNormals();
  return g;
}

type Key = 'paint' | 'trim' | 'metal' | 'glass' | 'lens' | 'head' | 'tail' | 'plate' | 'sign' | 'red' | 'blue' | 'lamp';
/** Ink id for a bucket: the light bar's two colors are one part, lines come from its housing. */
const inkOf = (key: Key) => (key === 'red' || key === 'blue' ? INK.beacon : key === 'lamp' ? INK.head : INK[key]);

/** Flat per-vertex color (linear, like a material color) for a prepped geometry. */
function paintVertices(g: BufferGeometry, hex: number): void {
  const c = new Color(hex);
  const a = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) a.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new BufferAttribute(a, 3));
}

class Parts {
  readonly buckets = new Map<Key, BufferGeometry[]>();
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();

  add(key: Key, geo: BufferGeometry, keepNormals = false): void {
    const g = prep(geo, keepNormals);
    const lamp = LAMP[key];
    if (lamp !== undefined) {
      paintVertices(g, lamp);
      key = 'lamp';
    }
    const list = this.buckets.get(key) ?? [];
    list.push(g);
    this.buckets.set(key, list);
  }

  /** A box of size w × h × d centered at (x, y, z), tipped by rx then rz. */
  box(key: Key, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, rz = 0): void {
    this.put(key, new BoxGeometry(w, h, d), x, y, z, rx, rz);
  }

  /** A disc or pipe along z: radius r, length d. */
  pipe(key: Key, r: number, d: number, x: number, y: number, z: number, segments = 10): void {
    const g = new CylinderGeometry(r, r, d, segments);
    g.rotateX(Math.PI / 2);
    this.put(key, g, x, y, z);
  }

  put(key: Key, geo: BufferGeometry, x: number, y: number, z: number, rx = 0, rz = 0): void {
    this.q.setFromEuler(this.e.set(rx, 0, rz));
    geo.applyMatrix4(this.m.compose(new Vector3(x, y, z), this.q, new Vector3(1, 1, 1)));
    this.add(key, geo);
  }
}

/**
 * A rim's outer face in the plane x = `x`, facing `sx`: a hub, five spokes and a lip in `light`
 * over a `dark` dish, all one flat disc (so no creases to ink), plus a small raised hub cap.
 */
function rimFace(R: number, x: number, sx: 1 | -1, light: number, dark: number): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const cl = new Color(light);
  const cd = new Color(dark);
  const n = 30;
  // Built facing +z, counter-clockwise from the front, then turned to face ±x.
  const tri = (c: Color, ...p: number[]) => {
    pos.push(...p);
    for (let i = 0; i < 3; i++) col.push(c.r, c.g, c.b);
  };
  const ring = (r0: number, r1: number, colorOf: (i: number) => Color) => {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const [c0, s0, c1, s1] = [Math.cos(a0), Math.sin(a0), Math.cos(a1), Math.sin(a1)];
      const c = colorOf(i);
      if (r0 === 0) tri(c, 0, 0, 0, r1 * c0, r1 * s0, 0, r1 * c1, r1 * s1, 0);
      else {
        tri(c, r0 * c0, r0 * s0, 0, r1 * c0, r1 * s0, 0, r1 * c1, r1 * s1, 0);
        tri(c, r0 * c0, r0 * s0, 0, r1 * c1, r1 * s1, 0, r0 * c1, r0 * s1, 0);
      }
    }
  };
  ring(0, R * 0.24, () => cl);
  // Five spokes, two segments wide out of every six.
  ring(R * 0.24, R * 0.8, (i) => (i % 6 < 2 ? cl : cd));
  ring(R * 0.8, R, () => cl);
  const face = new BufferGeometry();
  face.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  face.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  face.computeVertexNormals();
  // The cap: a short eight-sided drum out of the middle, lit the same as the spokes.
  const cap = new CylinderGeometry(R * 0.16, R * 0.16, 0.04, 8).rotateX(Math.PI / 2).translate(0, 0, 0.02).toNonIndexed();
  cap.deleteAttribute('uv');
  cap.computeVertexNormals();
  const cc = new Float32Array(cap.attributes.position.count * 3);
  for (let i = 0; i < cc.length; i += 3) cc.set([cl.r, cl.g, cl.b], i);
  cap.setAttribute('color', new BufferAttribute(cc, 3));
  const g = mergeGeometries([face, cap])!;
  face.dispose();
  cap.dispose();
  return g.rotateY((sx * Math.PI) / 2).translate(x, 0, 0);
}

/** Side profile → solid across the car: shape (u, v) = (z, y), extruded along x and centered. */
export function extrudeProfile(points: [number, number][], width: number): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const depth = width - 2 * BT;
  const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: BT, bevelSize: BS, bevelSegments: 1, curveSegments: 1, steps: 1 });
  // (a, b, c) → (d/2 − c, b, a): swap into the car frame keeping the winding (a rotation, det +1).
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const a = p.getX(i);
    const b = p.getY(i);
    const c = p.getZ(i);
    p.setXYZ(i, depth / 2 - c, b, a);
  }
  return g;
}

/** Body outline: the design's top line, then the sill back to the front with arches over each wheel. */
function bodyOutline(d: CarDesign): [number, number][] {
  const out = d.body.slice();
  const { r } = d.wheel;
  const R = r + (d.archGap ?? 0.08);
  const arch = (wz: number) => {
    const e = Math.asin(Math.max(-1, Math.min(1, (d.sill - r) / R)));
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const phi = Math.PI - e + ((e - (Math.PI - e)) * i) / n;
      out.push([wz + R * Math.cos(phi), r + R * Math.sin(phi)]);
    }
  };
  arch(d.wheel.rear);
  arch(d.wheel.front);
  return out;
}

/** Where the body's top line is at z (the highest segment spanning it). */
function topY(d: CarDesign, z: number): number {
  let best = 0;
  for (let i = 0; i + 1 < d.body.length; i++) {
    const [z0, y0] = d.body[i];
    const [z1, y1] = d.body[i + 1];
    if (z < Math.min(z0, z1) || z > Math.max(z0, z1) || z0 === z1) continue;
    best = Math.max(best, y0 + ((y1 - y0) * (z - z0)) / (z1 - z0));
  }
  return best;
}

/** The nose (end = 1) or tail (end = −1) surface at height y: its z and its tilt about x. */
function endAt(d: CarDesign, y: number, end: 1 | -1): { z: number; tilt: number } {
  const pts = end === 1 ? d.body : d.body.slice().reverse();
  for (let i = 0; i + 1 < pts.length; i++) {
    const [z0, y0] = pts[i];
    const [z1, y1] = pts[i + 1];
    if (y >= Math.min(y0, y1) && y <= Math.max(y0, y1) && y0 !== y1) {
      const z = z0 + ((z1 - z0) * (y - y0)) / (y1 - y0);
      return { z: z + end * BS, tilt: Math.atan2(z1 - z0, y1 - y0) };
    }
  }
  return { z: pts[0][0] + end * BS, tilt: 0 };
}

/** Splits the body's upward-facing top faces over the hood and deck into their own triangle lists. */
function splitLids(body: BufferGeometry, hoodFrom: number, trunkTo: number): { rest: BufferGeometry; hood: number[]; trunk: number[] } {
  const p = body.attributes.position;
  const n = body.attributes.normal;
  const rest: number[] = [];
  const restN: number[] = [];
  const hood: number[] = [];
  const trunk: number[] = [];
  for (let t = 0; t < p.count; t += 3) {
    // The deck and its shallow chamfer (n.y ≈ 0.95), so the lid's edge falls on the flank crease,
    // which inks anyway; cut at the chamfer's top, the edge inked as a broken line seen side on.
    const up = n.getY(t) > 0.85;
    let zMin = Infinity;
    let zMax = -Infinity;
    for (let j = 0; j < 3; j++) {
      zMin = Math.min(zMin, p.getZ(t + j));
      zMax = Math.max(zMax, p.getZ(t + j));
    }
    const into = up && zMin >= hoodFrom ? hood : up && zMax <= trunkTo ? trunk : rest;
    for (let j = 0; j < 3; j++) into.push(p.getX(t + j), p.getY(t + j), p.getZ(t + j));
    if (into === rest) for (let j = 0; j < 3; j++) restN.push(n.getX(t + j), n.getY(t + j), n.getZ(t + j));
  }
  body.dispose();
  // The rest keeps its normals: the flanks' are set by hand (buildCar).
  const g = tris(rest).setAttribute('normal', new BufferAttribute(new Float32Array(restN), 3));
  return { rest: g, hood, trunk };
}

const tris = (a: number[]) => new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(a), 3));

/** A part that can come off in a wreck: its own buckets, built in the car frame, pivoting at `pivot`. */
interface Piece {
  parts: Parts;
  pivot: Vector3;
  weak: number;
  ids?: Partial<Record<Key, number>>;
  hinge?: 1 | -1;
}

/** Only the id (which design) and size are read, so traffic and garage-only designs can build too. */
export function buildCar(cls: Pick<CarClass, 'id' | 'size'>, paint: PaintDef): CarVisual {
  const d = DESIGNS[cls.id] ?? DESIGNS.coupe;
  const [hw, hl] = cls.size;
  const W = hw * 2;
  const zFront = Math.max(...d.body.map((p) => p[0]));
  const zRear = Math.min(...d.body.map((p) => p[0]));
  /** Plan-view pinch: the fraction of half-width left at z. */
  const taper = (z: number) => {
    const f = Math.max(0, (z - (zFront - 0.9)) / 0.9);
    const r = Math.max(0, (zRear + 0.6 - z) / 0.6);
    return 1 - d.noseTaper * f * f - d.tailTaper * r * r;
  };
  /** d(taper)/dz, for the flank's true slope. */
  const taperSlope = (z: number) => {
    const f = Math.max(0, (z - (zFront - 0.9)) / 0.9);
    const r = Math.max(0, (zRear + 0.6 - z) / 0.6);
    return (-2 * d.noseTaper * f) / 0.9 + (2 * d.tailTaper * r) / 0.6;
  };
  const parts = new Parts();

  const seams = new Parts();
  const pieces: Piece[] = [];
  const piece = (pivot: Vector3, weak: number, ids?: Piece['ids'], hinge?: 1 | -1) => {
    const p: Piece = { parts: new Parts(), pivot, weak, ids, hinge };
    pieces.push(p);
    return p.parts;
  };

  // Body, with the hood and deck lids cut out of its top so they can spring open in a wreck.
  const body = prep(extrudeProfile(bodyOutline(d), W));
  const bp = body.attributes.position;
  // The flanks are the profile polygon, triangulated into long slivers nose to tail; pinched, those
  // fold, and flat normals on the folds shaded and inked as a broken line down the belt. So flank
  // triangles get the normal of the tapered surface they stand for, per vertex, instead.
  const flank: boolean[] = [];
  for (let t = 0; t < bp.count; t += 3) flank.push(Math.abs(body.attributes.normal.getX(t)) > 0.99);
  for (let i = 0; i < bp.count; i++) bp.setX(i, bp.getX(i) * taper(bp.getZ(i)));
  body.computeVertexNormals();
  const bn = body.attributes.normal;
  const fn = new Vector3();
  flank.forEach((is, t) => {
    if (!is) return;
    for (let j = t * 3; j < t * 3 + 3; j++) {
      const sx = Math.sign(bp.getX(j));
      fn.set(sx, 0, -sx * (W / 2) * taperSlope(bp.getZ(j))).normalize();
      bn.setXYZ(j, fn.x, fn.y, fn.z);
    }
  });
  const cabinFront = d.cabin[0][0];
  const cabinRear = Math.min(...d.cabin.map((p) => p[0]));
  // A bus has no deck to lift: its cabin runs the whole length.
  const lids = d.lids === false ? { rest: body, hood: [], trunk: [] } : splitLids(body, cabinFront - 0.1, cabinRear + 0.15);
  parts.add('paint', lids.rest, true);
  const lidPivot = (a: number[], atFront: boolean) => {
    let best = atFront ? -Infinity : Infinity;
    let y = 0;
    let yMin = Infinity;
    for (let i = 0; i < a.length; i += 3) {
      if (atFront ? a[i + 2] > best : a[i + 2] < best) {
        best = a[i + 2];
        y = a[i + 1];
      }
      yMin = Math.min(yMin, a[i + 1]);
    }
    return { pivot: new Vector3(0, y, best), yMin };
  };
  // Hood: hinged at its back edge, over a dark engine bay.
  let hoodP: Parts | undefined;
  if (lids.hood.length) {
    const { pivot, yMin } = lidPivot(lids.hood, false);
    hoodP = piece(pivot, 0.55, { paint: INK.hood }, 1);
    hoodP.add('paint', tris(lids.hood));
    const z1 = zFront - 0.25;
    parts.box('trim', W - 2 * BT - 0.1, yMin - 0.05 - (d.sill + 0.1), z1 - pivot.z, 0, (yMin - 0.05 + d.sill + 0.1) / 2, (z1 + pivot.z) / 2);
  }
  if (lids.trunk.length) {
    const { pivot, yMin } = lidPivot(lids.trunk, true);
    piece(pivot, 0.45, { paint: INK.trunk }, -1).add('paint', tris(lids.trunk));
    const z0 = zRear + 0.25;
    parts.box('trim', W - 2 * BT - 0.1, yMin - 0.05 - (d.sill + 0.1), pivot.z - z0, 0, (yMin - 0.05 + d.sill + 0.1) / 2, (z0 + pivot.z) / 2);
  }
  // Door cuts: ink-only seams down each flank.
  for (const z of d.doors ?? []) {
    const y0 = d.sill + 0.06;
    const y1 = topY(d, z) - 0.05;
    for (const sx of [-1, 1]) seams.box('trim', 0.01, y1 - y0, 0.018, sx * ((W / 2) * taper(z) + 0.004), (y0 + y1) / 2, z);
  }
  // A pull handle near the back edge of each door (every cut but the last closes one off).
  const cuts = d.doors ?? [];
  for (let i = 1; i < cuts.length; i++) {
    const z = cuts[i] + 0.2;
    const y = topY(d, z) - 0.13;
    for (const sx of [-1, 1]) parts.box('trim', 0.03, 0.035, 0.16, sx * ((W / 2) * taper(z) + 0.01), y, z);
  }

  // Greenhouse: narrower toward the roof; roof painted, the rest glass (or painted, for the van).
  const Wc = W * d.cabinBase;
  const cabin = prep(extrudeProfile(d.cabin, Wc));
  cabin.computeBoundingBox();
  const cy0 = cabin.boundingBox!.min.y;
  const cy1 = cabin.boundingBox!.max.y;
  const k = d.cabinRoof / d.cabinBase;
  // A painted cabin stands on the body's top edge at full width (designs.ts) and narrows from that
  // edge, so the two flanks meet flush: tucked in, a sliver of the body's chamfer showed under it and
  // inked as a dashed line; overlapping, the two flanks z-fought into specks of ink.
  const cn0 = d.cabinPainted ? cy0 + BS : cy0;
  const narrow = (y: number) => 1 + (k - 1) * Math.max(0, Math.min(1, (y - cn0) / (cy1 - cn0)));
  const cp = cabin.attributes.position;
  for (let i = 0; i < cp.count; i++) cp.setX(i, cp.getX(i) * narrow(cp.getY(i)));
  cabin.computeVertexNormals();
  const roof: number[] = [];
  const glass: number[] = [];
  const cn = cabin.attributes.normal;
  // The roof is the run of outline points along the top, by position: by normal alone, a raked
  // screen or a fastback (the coupe's are 25° and 18° off flat) was up-facing enough to be painted.
  const roofPts = d.cabin.filter((p) => p[1] > cy1 - BS - 0.1).map((p) => p[0]);
  const roofZ0 = Math.max(...roofPts) + 0.01;
  const roofZ1 = Math.min(...roofPts) - 0.01;
  for (let t = 0; t < cp.count; t += 3) {
    const nx = cn.getX(t);
    const ny = cn.getY(t);
    const nz = cn.getZ(t);
    const zc = (cp.getZ(t) + cp.getZ(t + 1) + cp.getZ(t + 2)) / 3;
    const onRoof = ny > 0.5 && zc <= roofZ0 && zc >= roofZ1;
    const painted = d.cabinPainted ? ny > 0.85 || Math.abs(nx) > 0.6 || nz < -0.6 || ny < -0.5 : onRoof;
    const into = painted ? roof : glass;
    for (let j = 0; j < 3; j++) into.push(cp.getX(t + j), cp.getY(t + j), cp.getZ(t + j));
  }
  parts.add('paint', tris(roof));
  parts.add('glass', tris(glass));
  cabin.dispose();
  /** Cabin side at height y: x and the lean of the side face (for glass and pillars laid on it). */
  const side = (y: number) => ({ x: (Wc / 2) * narrow(y), lean: Math.atan2((Wc / 2) * (1 - k), cy1 - cn0) });
  const onSide = (key: Key, z0: number, z1: number, y0: number, y1: number, out = 0.012) => {
    const s = side((y0 + y1) / 2);
    for (const sx of [-1, 1]) parts.box(key, 0.02, y1 - y0, z1 - z0, sx * (s.x + out), (y0 + y1) / 2, (z0 + z1) / 2, 0, sx * s.lean);
  };
  const base = d.cabin[0];
  if (d.pillar !== undefined) onSide('trim', d.pillar - 0.07, d.pillar + 0.07, cy0 + 0.1, cy1 - 0.08);
  if (d.cabinPainted) {
    for (const [z0, z1, y0, y1] of d.sideWindows ?? []) onSide('glass', z0, z1, y0, y1);
    const rz = Math.min(...d.cabin.map((p) => p[0])) - BS - 0.012;
    const rw = d.rearWindow;
    if (rw) for (const sx of rw.x ? [-1, 1] : [1]) parts.box('glass', rw.w, rw.h, 0.02, sx * rw.x, rw.y, rz);
  }
  /** The front of the greenhouse (the screen) at height y: its z and tilt. */
  const screenAt = (y: number) => {
    const [[z0, y0], [z1, y1]] = d.cabin;
    return { z: z0 + ((z1 - z0) * (y - y0)) / (y1 - y0) + BS, tilt: Math.atan2(z1 - z0, y1 - y0) };
  };
  if (d.cargo) {
    // The box behind the cab: a second, square extrusion on the frame, so the gap to the cab is real.
    const { z0, z1, y0, y1 } = d.cargo;
    parts.add('paint', extrudeProfile([[z0, y0], [z0, y1], [z1, y1], [z1, y0]], W));
    const bz = z1 - BS;
    // Roll-up door on the back: a sill, runner seams up each side and the slat lines across.
    parts.box('trim', W - 0.3, 0.08, 0.03, 0, y0 + 0.08, bz - 0.01);
    for (const sx of [-1, 1]) seams.box('trim', 0.018, y1 - y0 - 0.3, 0.01, sx * (W / 2 - 0.2), (y0 + y1) / 2, bz - 0.004);
    for (let i = 1; i <= 5; i++) seams.box('trim', W - 0.4, 0.018, 0.01, 0, y0 + 0.08 + ((y1 - y0 - 0.2) * i) / 6, bz - 0.004);
    // Marker lamps along the top edges: amber over the cab, red (lit with the brakes) at the back.
    for (const x of [-0.3, 0, 0.3]) parts.box('sign', 0.14, 0.07, 0.03, x, y1 - 0.12, z0 + BS + 0.01);
    for (const sx of [-1, 1]) parts.box('tail', 0.14, 0.07, 0.03, sx * (W / 2 - 0.2), y1 - 0.12, bz - 0.01);
    // Side guards between the axles, under the box.
    const g0 = d.wheel.front - d.wheel.r - 0.25;
    const g1 = d.wheel.rear + d.wheel.r + 0.25;
    for (const sx of [-1, 1]) parts.box('trim', 0.05, 0.1, g0 - g1, sx * (W / 2 - 0.08), d.sill - 0.12, (g0 + g1) / 2);
  }
  if (d.mirrors === 'bus') {
    // Bus mirrors: arms out of the roof corners, reaching forward, heads hanging past the screen.
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 + 0.1);
      const zf = screenAt(cy1 - 0.2).z;
      const m = piece(new Vector3(x, cy1 - 0.3, zf + 0.4), 0.7, { paint: INK.mirror });
      m.box('trim', 0.05, 0.05, 0.55, sx * (W / 2 - 0.05), cy1 - 0.2, zf + 0.2, 0, 0);
      m.box('trim', 0.2, 0.05, 0.05, sx * (W / 2 + 0.03), cy1 - 0.2, zf + 0.45);
      m.box('trim', 0.05, 0.3, 0.05, x, cy1 - 0.34, zf + 0.45);
      m.box('paint', 0.16, 0.46, 0.12, x, cy1 - 0.72, zf + 0.46);
      m.box('trim', 0.12, 0.4, 0.02, x, cy1 - 0.72, zf + 0.39);
    }
  } else {
    // Mirrors, just behind the base of the screen.
    for (const sx of [-1, 1]) {
      const s = side(base[1] + 0.18);
      const m = piece(new Vector3(sx * (s.x + 0.06), base[1] + 0.16, base[0] - 0.28), 0.8, { paint: INK.mirror });
      m.box('paint', 0.18, 0.11, 0.14, sx * (s.x + 0.1), base[1] + 0.18, base[0] - 0.28);
      m.box('trim', 0.12, 0.04, 0.05, sx * (s.x + 0.02), base[1] + 0.14, base[0] - 0.3);
    }
  }
  if (d.destination) {
    // A lit sign over the screen, and the bar that splits the screen in two.
    const y = cy1 - 0.3;
    const f = screenAt(y);
    parts.box('trim', Wc * k * 0.94, 0.36, 0.03, 0, y, f.z + 0.005, f.tilt);
    parts.box('sign', Wc * k * 0.62, 0.2, 0.03, 0, y, f.z + 0.02, f.tilt);
    const y0 = base[1] + 0.1;
    const y1 = y - 0.2;
    const g = screenAt((y0 + y1) / 2);
    parts.box('trim', 0.06, y1 - y0, 0.03, 0, (y0 + y1) / 2, g.z + 0.005, g.tilt);
  }
  {
    // Wipers parked along the bottom of the screen, both leaning the same way.
    const y = base[1] + 0.09;
    const f = screenAt(y);
    const len = Wc * 0.3;
    for (const x of [-0.26, 0.2]) parts.box('trim', len, 0.025, 0.025, x * Wc, y + 0.02, f.z + 0.012, f.tilt, 0.12);
  }
  for (const [z0, z1] of d.glassDoors ?? []) {
    // Curb-side doors: glass from the step to the window line, a seam down the middle of each pair.
    const y0 = d.sill + 0.1;
    const y1 = Math.max(...(d.sideWindows ?? []).map((w) => w[3]), cy0 + 0.5);
    const x = -((W / 2) * taper((z0 + z1) / 2) + 0.014);
    parts.box('trim', 0.02, y1 - y0 + 0.1, z1 - z0 + 0.1, x + 0.006, (y0 + y1) / 2, (z0 + z1) / 2);
    parts.box('glass', 0.02, y1 - y0, z1 - z0, x, (y0 + y1) / 2, (z0 + z1) / 2);
    seams.box('trim', 0.01, y1 - y0, 0.02, x - 0.012, (y0 + y1) / 2, (z0 + z1) / 2);
  }

  // Rear: lamps on the tail face, plate, diffuser, pipes.
  const tailHW = (W / 2 - BT) * taper(zRear) - 0.04;
  const tailAt = (y: number) => endAt(d, y, -1);
  const { y: ty, h: th } = d.tail;
  const tz = tailAt(ty).z - 0.012;
  const tails: [number, number][] = [];
  switch (d.tail.style) {
    case 'bar':
      parts.box('lens', tailHW * 2, th + 0.06, 0.03, 0, ty, tz);
      parts.box('tail', tailHW * 2 - 0.3, th * 0.45, 0.04, 0, ty, tz - 0.01);
      for (const sx of [-1, 1]) {
        parts.box('tail', 0.42, th, 0.04, sx * (tailHW - 0.24), ty, tz - 0.01);
        tails.push([sx * (tailHW - 0.24), ty]);
      }
      break;
    case 'round':
      parts.box('trim', tailHW * 2, th + 0.12, 0.03, 0, ty, tz);
      for (const sx of [-1, 1]) {
        for (const off of [0.2, 0.52]) parts.pipe('tail', th / 2, 0.05, sx * (tailHW - off), ty, tz - 0.02, 12);
        tails.push([sx * (tailHW - 0.36), ty]);
      }
      break;
    case 'vertical':
      for (const sx of [-1, 1]) {
        parts.box('lens', 0.24, th + 0.05, 0.03, sx * (tailHW - 0.14), ty, tz);
        parts.box('tail', 0.12, th, 0.04, sx * (tailHW - 0.12), ty, tz - 0.01);
        tails.push([sx * (tailHW - 0.12), ty]);
      }
      parts.box('trim', tailHW * 2 - 0.56, 0.1, 0.03, 0, ty + th / 2 - 0.05, tz);
      break;
    case 'rect':
      // Plain rectangles in a dark surround, the sedan's.
      for (const sx of [-1, 1]) {
        parts.box('lens', 0.5, th + 0.06, 0.03, sx * (tailHW - 0.28), ty, tz);
        parts.box('tail', 0.34, th * 0.6, 0.04, sx * (tailHW - 0.3), ty, tz - 0.01);
        tails.push([sx * (tailHW - 0.3), ty]);
      }
      break;
    case 'dot':
      // One round lamp a side in a dark ring, the compact's.
      for (const sx of [-1, 1]) {
        parts.pipe('trim', th / 2 + 0.035, 0.03, sx * (tailHW - 0.2), ty, tz, 14);
        parts.pipe('tail', th / 2, 0.04, sx * (tailHW - 0.2), ty, tz - 0.01, 14);
        tails.push([sx * (tailHW - 0.2), ty]);
      }
      break;
    case 'block':
      for (const sx of [-1, 1]) {
        parts.box('lens', 0.26, th + 0.05, 0.03, sx * (tailHW - 0.15), ty, tz);
        parts.box('tail', 0.18, th * 0.55, 0.04, sx * (tailHW - 0.15), ty + th * 0.18, tz - 0.01);
        parts.box('plate', 0.18, th * 0.2, 0.04, sx * (tailHW - 0.15), ty - th * 0.3, tz - 0.01);
        tails.push([sx * (tailHW - 0.15), ty + th * 0.18]);
      }
      break;
  }
  const plateY = d.sill + 0.2;
  const plate = piece(new Vector3(0, plateY, tailAt(plateY).z), 0.6);
  plate.box('trim', 0.6, 0.18, 0.03, 0, plateY, tailAt(plateY).z - 0.01);
  plate.box('plate', 0.52, 0.12, 0.03, 0, plateY, tailAt(plateY).z - 0.02);
  // Bumper line under the lamps.
  const by = ty - th / 2 - 0.1;
  seams.box('trim', tailHW * 2 - 0.1, 0.018, 0.01, 0, by, tailAt(by).z - 0.004);
  const diffY = d.sill + 0.02;
  const diffZ = tailAt(d.sill + 0.05).z;
  parts.box('trim', tailHW * 2 - 0.1, 0.12, 0.3, 0, diffY, diffZ + 0.1);
  if (d.diffuser) for (const fx of [-0.45, -0.15, 0.15, 0.45]) parts.box('trim', 0.03, 0.16, 0.34, fx * (W / 2), diffY - 0.06, diffZ + 0.05);
  const pipes: [number, number][] = [];
  const py = d.sill + 0.06;
  if (d.exhaust === 'twin') pipes.push([-0.14, py], [0.14, py]);
  if (d.exhaust === 'quad') for (const sx of [-1, 1]) pipes.push([sx * (tailHW - 0.3), py], [sx * (tailHW - 0.5), py]);
  if (d.exhaust === 'side') pipes.push([-(tailHW - 0.35), py]);
  const pr = d.exhaust === 'side' ? 0.08 : 0.06;
  for (const [x, y] of pipes) {
    parts.pipe('metal', pr, 0.24, x, y, diffZ - 0.06);
    parts.pipe('trim', pr * 0.65, 0.02, x, y, diffZ - 0.185);
  }

  // Front: lamps, grille, intake.
  const noseHW = (W / 2 - BT) * taper(zFront) - 0.04;
  const headAt = (y: number) => endAt(d, y, 1);
  const hy = d.head.y;
  const hf = headAt(hy);
  const heads: [number, number, number][] = [];
  for (const sx of [-1, 1]) {
    const x = sx * (noseHW - 0.3);
    if (d.head.style === 'slit') parts.box('head', 0.46, 0.06, 0.04, x, hy, hf.z, hf.tilt);
    else if (d.head.style === 'round') {
      parts.pipe('head', 0.11, 0.04, x, hy, hf.z);
      parts.pipe('head', 0.08, 0.04, x - sx * 0.26, hy, hf.z);
    } else if (d.head.style === 'bug') {
      // One big round lamp a side in a dark ring: the compact's friendly face.
      parts.pipe('trim', 0.185, 0.03, x, hy, hf.z, 16);
      parts.pipe('head', 0.15, 0.04, x, hy, hf.z + 0.01, 16);
    } else if (d.head.style === 'square') parts.box('head', 0.34, 0.14, 0.04, x, hy, hf.z, hf.tilt);
    else parts.box('head', 0.4, 0.2, 0.04, x, hy, hf.z, hf.tilt);
    heads.push([x, hy, hf.z]);
  }
  // Every face the same way: a slatted grille between the lamps (the slit-lamp coupe's is its
  // intake), a lower intake across the bumper, and a plate on it.
  const gy = d.sill + 0.16;
  const gf = headAt(gy);
  const grilleW = d.head.style === 'slit' ? noseHW * 1.3 : noseHW * 2 - 0.9;
  parts.box('trim', grilleW, d.head.style === 'slit' ? 0.12 : 0.2, 0.04, 0, gy, gf.z, gf.tilt);
  if (d.head.style !== 'slit' && !d.grille) {
    const g2 = headAt(hy);
    const gw = noseHW * 2 - 1.2;
    parts.box('trim', gw, 0.16, 0.04, 0, hy, g2.z, g2.tilt);
    for (const oy of [-0.035, 0.035]) parts.box('metal', gw - 0.06, 0.018, 0.02, 0, hy + oy, g2.z + 0.02, g2.tilt);
  }
  const fpy = d.grille ? d.grille.y - 0.08 : gy;
  const fp = headAt(fpy);
  // On a truck the plate hangs on the heavy bumper, which stands proud of the nose.
  const fpz = d.grille ? headAt(d.grille.y).z + 0.17 : fp.z + 0.02;
  parts.box('trim', 0.46, 0.15, 0.03, 0, fpy, fpz, d.grille ? 0 : fp.tilt);
  parts.box('plate', 0.4, 0.1, 0.03, 0, fpy, fpz + 0.01, d.grille ? 0 : fp.tilt);
  const fby = hy - 0.13;
  const fb = headAt(fby);
  seams.box('trim', noseHW * 2 - 0.1, 0.018, 0.01, 0, fby, fb.z + 0.004, fb.tilt);
  if (d.grille) {
    // A truck face: a tall dark grille between the lamps, bright slats across it, a heavy bumper.
    const { y, h } = d.grille;
    const gw = (noseHW - 0.3 - 0.25) * 2;
    const g = headAt(y + h / 2);
    parts.box('trim', gw, h, 0.06, 0, y + h / 2, g.z + 0.02, g.tilt);
    for (let i = 1; i <= 4; i++) parts.box('metal', gw - 0.08, 0.035, 0.03, 0, y + (h * i) / 5, g.z + 0.06, g.tilt);
    const b = headAt(y);
    parts.box('trim', noseHW * 2 + 0.12, 0.24, 0.22, 0, y - 0.08, b.z + 0.04);
  }
  if (d.pushBar) {
    // A push bar bolted ahead of the grille: two uprights and two rails, the first thing off in a head-on.
    const y0 = d.sill - 0.02;
    const y1 = hy + 0.16;
    const z = zFront + BS + 0.16;
    const bar = piece(new Vector3(0, (y0 + y1) / 2, z), 0.6, { trim: INK.lip });
    for (const sx of [-1, 1]) {
      bar.box('trim', 0.07, y1 - y0, 0.07, sx * 0.34, (y0 + y1) / 2, z);
      bar.box('trim', 0.05, 0.05, 0.2, sx * 0.34, d.sill + 0.12, z - 0.12);
    }
    for (const y of [y1 - 0.04, d.sill + 0.2]) bar.box('trim', 0.9, 0.06, 0.06, 0, y, z + 0.01);
  }
  // A splitter lip on the sporty ones: the first thing to go in a head-on.
  if (d.diffuser) piece(new Vector3(0, d.sill - 0.03, zFront), 0.7, { trim: INK.lip }).box('trim', noseHW * 2 - 0.1, 0.05, 0.28, 0, d.sill - 0.03, zFront - 0.06);

  // Aero and extras.
  if (d.wing) {
    const { y, z, chord } = d.wing;
    const span = W - 0.16;
    const wing = piece(new Vector3(0, y, z), 0.9);
    wing.box('trim', span, 0.05, chord, 0, y, z, -0.08);
    for (const sx of [-1, 1]) {
      wing.box('trim', 0.04, 0.2, chord + 0.08, sx * span / 2, y - 0.04, z);
      const deck = topY(d, z + 0.05);
      wing.box('trim', 0.05, y - deck, 0.1, sx * 0.55, (y + deck) / 2, z + 0.05);
    }
  }
  if (d.roofSpoiler) {
    const back = d.cabin.reduce((a, p) => (p[1] > cy1 - 0.1 && p[0] < a[0] ? p : a), d.cabin[1]);
    piece(new Vector3(0, cy1, back[0] - 0.08), 0.6).box('trim', Wc * k * 0.98, 0.05, 0.36, 0, cy1 + 0.02, back[0] - 0.08, -0.12);
  }
  if (d.hoodScoop && hoodP) {
    const sz = 1.35;
    const sy = topY(d, sz);
    hoodP.box('paint', 0.62, 0.14, 0.8, 0, sy + 0.05, sz);
    hoodP.box('trim', 0.5, 0.08, 0.02, 0, sy + 0.08, sz + 0.41);
  }
  if (d.roofBox) {
    const { z, l, w: bw, h } = d.roofBox;
    const rb = piece(new Vector3(0, cy1 + h / 2, z), 0.3);
    rb.box('paint', Wc * k * bw, h, l, 0, cy1 + h / 2 - 0.02, z);
    for (const f of [-0.3, 0, 0.3]) rb.box('trim', Wc * k * bw * 0.7, 0.03, l * 0.18, 0, cy1 + h - 0.01, z + f * l);
  }
  if (d.roofScoop) {
    const sz = d.cabin[1][0] - 0.3;
    parts.box('paint', 0.36, 0.1, 0.55, 0, cy1 + 0.03, sz);
    parts.box('trim', 0.28, 0.07, 0.02, 0, cy1 + 0.045, sz + 0.28);
  }
  const podLamps: [number, number, number][] = [];
  let pod: Parts | undefined;
  if (d.lightPod) {
    // Four spots on a plate standing on the nose, bolted on for night stages: first off in a head-on.
    const y = topY(d, zFront - 0.1) + 0.08;
    const z = zFront - 0.06;
    pod = piece(new Vector3(0, y, z), 0.75, { trim: INK.lip });
    pod.box('trim', 1.3, 0.2, 0.06, 0, y, z);
    for (const x of [-0.48, -0.16, 0.16, 0.48]) {
      pod.pipe('trim', 0.09, 0.08, x, y, z + 0.03, 12);
      pod.pipe('head', 0.07, 0.04, x, y, z + 0.07, 12);
      podLamps.push([x, y, z + 0.1]);
    }
  }
  const beacons: { x: number; y: number; z: number; red: boolean }[] = [];
  let lightBar: Parts | undefined;
  if (d.lightBar) {
    // Across the middle of the roof: a dark housing, red lenses on the left, blue on the right.
    const back = d.cabin.reduce((a, p) => (p[1] > cy1 - 0.1 && p[0] < a[0] ? p : a), d.cabin[1]);
    const z = (d.cabin[1][0] + back[0]) / 2;
    const span = Wc * k * 0.9;
    const y = cy1 + 0.05;
    lightBar = piece(new Vector3(0, y, z), 0.85, { trim: INK.lip });
    lightBar.box('trim', span, 0.07, 0.3, 0, y, z);
    lightBar.box('trim', 0.14, 0.13, 0.26, 0, y + 0.08, z);
    for (const sx of [-1, 1]) {
      const w = span / 2 - 0.12;
      lightBar.box(sx > 0 ? 'red' : 'blue', w, 0.12, 0.26, sx * (0.07 + w / 2), y + 0.09, z);
      beacons.push({ x: sx * (0.07 + w / 2), y: y + 0.1, z, red: sx > 0 });
    }
  }
  if (d.roofRack) {
    const rack = piece(new Vector3(0, cy1 + 0.1, -0.8), 0.5);
    for (const sx of [-1, 1]) rack.box('trim', 0.05, 0.06, 3.2, sx * (Wc * k * 0.44), cy1 + 0.08, -0.8);
    for (const z of [0.5, -0.6, -1.7, -2.3]) rack.box('trim', Wc * k * 0.92, 0.04, 0.06, 0, cy1 + 0.11, z);
  }

  if (d.mudFlaps) {
    // Behind every wheel: a rubber flap from the arch to just off the road.
    const { r: wr0, w: ww } = d.wheel;
    const R = wr0 + (d.archGap ?? 0.08);
    const x = W / 2 - ww / 2 - 0.03;
    for (const z of [d.wheel.front, d.wheel.rear]) {
      for (const sx of [-1, 1]) {
        // Thick rubber, swept back at the bottom as if by the air: side on it reads as a flap, not a post.
        const fz = z - R - 0.05;
        const y1 = d.sill + 0.06;
        const h = y1 - 0.07;
        const rake = 0.32;
        const flap = piece(new Vector3(sx * x, y1, fz), 0.5);
        const cy = (y1 + 0.07) / 2;
        const cz = fz - (Math.sin(rake) * h) / 2;
        flap.box('trim', ww + 0.08, h, 0.08, sx * x, cy, cz, rake);
        flap.box('paint', ww - 0.02, 0.07, 0.09, sx * x, 0.14, fz - Math.tan(rake) * (y1 - 0.14), rake);
      }
    }
  }

  // Merge each bucket into one mesh (per piece, for the parts that can come off).
  const paintMat = carPaint(paint, d.livery, d.band);
  paintMat.side = DoubleSide;
  const tailMat = new MeshBasicMaterial({ color: 0xc4153a });
  // The light bar's lenses, per car: they flash in `update`.
  const redMat = new MeshBasicMaterial({ color: BEACON.red[0] });
  const blueMat = new MeshBasicMaterial({ color: BEACON.blue[0] });
  const mats: Partial<Record<Key, Material>> = { paint: paintMat, trim, metal, glass: glassMat, lamp: lampMat, tail: tailMat, red: redMat, blue: blueMat };
  const root = new Group();
  // For traffic (traffic.ts), which tints the body per instance.
  root.userData.paint = paintMat;
  const shell = new Group();
  root.add(shell);
  const deform: { mesh: Mesh; offset: Vector3 }[] = [];
  let glassMesh: Mesh | undefined;
  const bake = (p: Parts, into: Group, offset: Vector3, ids: Piece['ids'] = {}) => {
    for (const [key, list] of p.buckets) {
      const merged = mergeGeometries(list)!;
      for (const g of list) g.dispose();
      merged.translate(-offset.x, -offset.y, -offset.z);
      const mesh = new Mesh(merged, mats[key]!);
      markInk(mesh, ids[key] ?? inkOf(key));
      into.add(mesh);
      deform.push({ mesh, offset });
      if (key === 'glass' && into === shell) glassMesh = mesh;
    }
  };
  const zero = new Vector3();
  bake(parts, shell, zero);
  const detachables: Detachable[] = [];
  const box = new Box3();
  let barGroup: Group | undefined;
  let podGroup: Group | undefined;
  for (const pc of pieces) {
    const g = new Group();
    g.position.copy(pc.pivot);
    shell.add(g);
    box.makeEmpty();
    for (const list of pc.parts.buckets.values()) for (const geo of list) box.union((geo.computeBoundingBox(), geo.boundingBox!));
    bake(pc.parts, g, pc.pivot, pc.ids);
    if (pc.parts === lightBar) barGroup = g;
    if (pc.parts === pod) podGroup = g;
    detachables.push({ obj: g, hinge: pc.hinge, at: box.getCenter(new Vector3()), weak: pc.weak });
  }
  for (const list of seams.buckets.values()) {
    const seam = new Mesh(mergeGeometries(list)!, trim);
    for (const g of list) g.dispose();
    markInk(seam, SEAM, true);
    shell.add(seam);
    deform.push({ mesh: seam, offset: zero });
  }

  // Glows at the lamps; a wreck puts out the ones near the hit (`wreck` below).
  const tailGlow = new SpriteMaterial({ map: glow(), color: 0xff2344, transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false });
  /** Each lamp glow and where it sits in the car frame. */
  const lampGlows: { s: Sprite; at: Vector3 }[] = [];
  for (const [x, y, z] of heads) {
    const s = new Sprite(headGlow);
    s.scale.set(1.2, 1.2, 1);
    s.position.set(x, y, z + 0.12);
    shell.add(s);
    lampGlows.push({ s, at: s.position.clone() });
  }
  // The pod's glows ride on the pod, so they go with it when it tears off.
  for (const [x, y, z] of podLamps) {
    const s = new Sprite(headGlow);
    s.scale.set(0.6, 0.6, 1);
    s.position.set(x, y, z).sub(podGroup!.position);
    podGroup!.add(s);
    lampGlows.push({ s, at: new Vector3(x, y, z) });
  }
  for (const [x, y] of tails) {
    const s = new Sprite(tailGlow);
    s.scale.set(0.75, 0.75, 1);
    s.position.set(x, y, tz - 0.1);
    shell.add(s);
    lampGlows.push({ s, at: s.position.clone() });
  }
  // Beacon glows ride on the light bar, so they fly off with it.
  const redGlow = new SpriteMaterial({ map: glow(), color: BEACON.red[1], transparent: true, blending: AdditiveBlending, depthWrite: false });
  const blueGlow = new SpriteMaterial({ map: glow(), color: BEACON.blue[1], transparent: true, blending: AdditiveBlending, depthWrite: false });
  const flashes = beacons.map((b) => {
    const s = new Sprite(b.red ? redGlow : blueGlow);
    s.scale.set(1.4, 1.4, 1);
    s.position.set(b.x, b.y, b.z).sub(barGroup!.position);
    s.visible = false;
    barGroup!.add(s);
    return { s, red: b.red };
  });
  let flashT = 0;

  // Wheels: tyre, and a rim: five spokes, a lip and a hub painted onto one flat face over a dark
  // dish, so it reads by color at any distance instead of by a scatter of little creases.
  const { r, w, front: wf, rear: wr } = d.wheel;
  const wheelX = W / 2 - w / 2 - 0.03;
  const tyre = prep(new CylinderGeometry(r, r, w, 16).rotateZ(Math.PI / 2));
  const gold = paint.finish === 'chrome';
  const rims = [-1, 1].map((sx) => rimFace(r * 0.68, sx * (w / 2 + 0.005), sx as 1 | -1, gold ? RIM.gold : RIM.light, gold ? RIM.goldDark : RIM.dark));
  const dark = toon({ color: 0x2a2436 });
  const wheels: Group[] = [];
  const steerers: Group[] = [];
  for (const z of [wf, wr]) {
    for (const [i, sx] of [-1, 1].entries()) {
      const pivot = new Group();
      pivot.position.set(sx * wheelX, r, z);
      const wheel = new Group();
      const tm = new Mesh(tyre, trim);
      const rm = new Mesh(rims[i], rimMat);
      markInk(tm, INK.wheel);
      markInk(rm, INK.rim);
      wheel.add(tm, rm);
      if (d.dualRear && z === wr) {
        // The inner twin: a second tyre just inboard, sharing the geometry.
        const inner = new Mesh(tyre, trim);
        inner.position.x = -sx * (w + 0.03);
        markInk(inner, INK.wheel);
        wheel.add(inner);
      }
      pivot.add(wheel);
      root.add(pivot);
      wheels.push(wheel);
      if (z === wf) steerers.push(pivot);
      detachables.push({ obj: pivot, at: pivot.position.clone(), weak: 0.22, bouncy: true });
    }
  }
  // A dark wall down the middle of each arch, so the cut doesn't show the road through the car: both
  // in one mesh.
  const wellParts = [wf, wr].map((z) => new BoxGeometry(0.02, r * 1.4, (r + 0.08) * 2).translate(0, r + 0.02, z));
  root.add(new Mesh(mergeGeometries(wellParts)!, dark));
  for (const g of wellParts) g.dispose();

  // Headlight beam, underglow, contact shadow, boost flames. This car's own materials, freed with it.
  const owned: Material[] = [];
  const own = <M extends Material>(m: M): M => (owned.push(m), m);
  // Headlight beam, underglow, contact shadow, boost flames.
  const L = hl * 2;
  const beam = new Mesh(new PlaneGeometry(W + 1.4, 12), beamMat());
  // Tipped so the texture's bright end (v = 0) sits at the car, which faces +z.
  beam.rotation.x = Math.PI / 2;
  beam.position.set(0, 0.05, L / 2 + 6.1);
  root.add(beam);
  if (paint.underglow) {
    const u = new Mesh(new PlaneGeometry(W + 2.2, L + 1.6), own(new MeshBasicMaterial({ map: glow(), color: paint.underglow, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false })));
    u.rotation.x = -Math.PI / 2;
    u.position.y = 0.06;
    root.add(u);
  }
  const shadow = new Mesh(new PlaneGeometry(W + 0.6, L + 0.6), own(new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false })));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.04;
  root.add(shadow);
  const flameGeo = new PlaneGeometry(pr * 9, 1.6);
  const flames = pipes.map(([x, y]) => {
    const f = new Mesh(flameGeo, flameMat);
    f.rotation.x = -Math.PI / 2;
    f.position.set(x, y, diffZ - 0.9);
    f.visible = false;
    root.add(f);
    return f;
  });

  const top = Math.max(...d.cabin.map((p) => p[1]), d.cargo?.y1 ?? 0);
  const wreck = new CarWreck(root, deform, detachables, glassMesh!, glassMat, paintMat, { hw, hl, top });
  const spinScale = 0.38 / r;
  return {
    root,
    update(spin, steer, braking, boosting, onRoad, dt = 0) {
      wreck.update(dt);
      beam.visible = onRoad && !wreck.wrecked;
      for (const wh of wheels) if (wh.parent!.parent === root) wh.rotation.x = spin * spinScale;
      for (const s of steerers) if (s.parent === root) s.rotation.y = steer * 0.45;
      tailMat.color.setHex(braking ? 0xff4d6a : 0xc4153a);
      tailGlow.opacity = braking ? 1 : 0.5;
      for (const f of flames) {
        f.visible = boosting;
        if (boosting) f.scale.set(1, 0.7 + Math.random() * 0.6, 1);
      }
      if (flashes.length) {
        // Double blinks, red then blue, a second a cycle: swap the lens colors, toggle the glows.
        flashT = (flashT + dt) % 1;
        const ph = Math.floor(flashT * 8);
        const red = ph === 0 || ph === 2;
        const blue = ph === 4 || ph === 6;
        redMat.color.setHex(BEACON.red[red ? 1 : 0]);
        blueMat.color.setHex(BEACON.blue[blue ? 1 : 0]);
        for (const f of flashes) f.s.visible = f.red ? red : blue;
      }
    },
    wreck(dx, dz, strength) {
      const hit = wreck.hit(dx, dz, strength);
      // Smashed lamps go dark: no glow floating over a crushed nose or tail.
      if (hit) for (const g of lampGlows) if (g.at.distanceTo(hit.at) < hit.radius * 0.7) g.s.visible = false;
    },
    repair() {
      wreck.repair();
      for (const g of lampGlows) g.s.visible = true;
    },
    dispose() {
      wreck.dispose();
      unmarkInk(root);
      root.traverse((o) => {
        if (o instanceof Mesh && o.geometry !== flameGeo) o.geometry.dispose();
      });
      flameGeo.dispose();
      paintMat.dispose();
      tailMat.dispose();
      tailGlow.dispose();
      redMat.dispose();
      blueMat.dispose();
      redGlow.dispose();
      blueGlow.dispose();
      dark.dispose();
      for (const m of owned) m.dispose();
    },
  };
}
