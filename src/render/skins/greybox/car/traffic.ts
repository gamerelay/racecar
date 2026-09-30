// Traffic models, two ways. trafficModel: a car design (car/designs.ts) flattened into instanced
// parts, which is how race traffic is drawn (every kind has a design). trafficModels: simple
// one-draw cars (a side profile with arches, glass, bumpers, wheels and lamps, one merged mesh a
// kind) for the city's parked and ambient cars, the garage's T lineup, and any kind with no design.
//
// Each vertex carries a color and `surf` = (paint, glow): paint 1 takes the instance's color (the
// body), paint 0 keeps its own (glass, trim, lamps); glow lights it regardless of the sun (lamps).

import { BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, type Material, type Matrix4, Mesh, type MeshToonMaterial } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PaintDef } from '../../../../core/content';
import { SEAM } from '../../../ink';
import { toon } from '../toon';
import { buildCar, extrudeProfile, prep } from './build';
import { DESIGNS as CAR_DESIGNS } from './designs';
import { chunks } from '../../../shader';

interface TrafficDesign {
  /** Half width and half length, meters (from the traffic kind's collider). */
  hw: number;
  hl: number;
  /** Body top line, nose bottom to tail bottom; the builder closes it along the sill with arches. */
  body: [number, number][];
  sill: number;
  /** Glass greenhouse (closed outline) and how much of the width it takes, base and top; none for slab-sided vans and buses. */
  cabin?: [number, number][];
  cabinBase?: number;
  cabinRoof?: number;
  /** Window bands set into a slab side: [z front, z back, y bottom, y top]. */
  bands?: [number, number, number, number][];
  /** A cargo box behind the cab (the truck): [z front, z back, y bottom, y top]. */
  cargo?: [number, number, number, number];
  wheels: number[];
  r: number;
  head: number;
  tail: number;
}

const DESIGNS: Record<string, TrafficDesign> = {
  sedan: {
    hw: 0.95,
    hl: 2.25,
    body: [[2.25, 0.32], [2.28, 0.6], [2.1, 0.72], [1.05, 0.84], [-1.35, 0.86], [-2.18, 0.88], [-2.25, 0.62], [-2.25, 0.32]],
    sill: 0.32,
    cabin: [[1.0, 0.84], [0.3, 1.36], [-0.95, 1.38], [-1.55, 0.86]],
    cabinBase: 0.86,
    cabinRoof: 0.72,
    wheels: [1.42, -1.42],
    r: 0.34,
    head: 0.62,
    tail: 0.72,
  },
  compact: {
    hw: 0.9,
    hl: 1.95,
    body: [[1.95, 0.3], [1.98, 0.6], [1.72, 0.76], [0.9, 0.86], [-1.78, 0.92], [-1.95, 0.86], [-1.95, 0.3]],
    sill: 0.3,
    cabin: [[0.86, 0.86], [0.22, 1.42], [-1.55, 1.46], [-1.86, 0.92]],
    cabinBase: 0.88,
    cabinRoof: 0.76,
    wheels: [1.25, -1.25],
    r: 0.32,
    head: 0.64,
    tail: 0.8,
  },
  van: {
    hw: 1.0,
    hl: 2.5,
    body: [[2.5, 0.36], [2.53, 0.92], [2.25, 1.12], [1.7, 1.3], [1.05, 2.08], [-2.46, 2.14], [-2.5, 2.0], [-2.5, 0.36]],
    sill: 0.36,
    bands: [[1.55, 1.1, 1.25, 1.85], [0.8, -0.6, 1.35, 1.85], [-0.8, -2.2, 1.35, 1.85]],
    wheels: [1.7, -1.75],
    r: 0.38,
    head: 0.82,
    tail: 1.0,
  },
  truck: {
    hw: 1.2,
    hl: 3.8,
    body: [[3.8, 0.5], [3.84, 1.3], [3.62, 2.28], [3.3, 2.45], [1.7, 2.45], [1.7, 1.15], [-3.8, 1.15], [-3.8, 0.5]],
    sill: 0.5,
    bands: [[3.8, 2.0, 1.55, 2.2]],
    cargo: [1.5, -3.8, 1.15, 3.0],
    wheels: [2.85, -1.9, -2.95],
    r: 0.5,
    head: 0.95,
    tail: 0.85,
  },
  bus: {
    hw: 1.25,
    hl: 5.2,
    body: [[5.2, 0.42], [5.24, 1.2], [5.18, 2.72], [4.95, 3.0], [-5.1, 3.0], [-5.2, 2.85], [-5.2, 0.42]],
    sill: 0.42,
    bands: [[5.26, 3.6, 1.35, 2.7], [3.3, -4.9, 1.7, 2.6]],
    wheels: [3.55, -3.4],
    r: 0.52,
    head: 0.85,
    tail: 1.0,
  },
};

const GLASS = new Color(0x27366a);
const TRIM = new Color(0x16121f);
const METAL = new Color(0xb9b6cf);
const HEAD = new Color(0xfff2c8);
const TAIL = new Color(0xff2344);
const WHITE = new Color(0xffffff);
const CARGO = new Color(0xe6e1ee);

/** Tags every vertex of a part with its color and surf flags. */
function tag(geo: BufferGeometry, color: Color, paint: number, glow: number): BufferGeometry {
  const g = prep(geo);
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  const s = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    c.set([color.r, color.g, color.b], i * 3);
    s.set([paint, glow], i * 2);
  }
  g.setAttribute('color', new BufferAttribute(c, 3));
  g.setAttribute('surf', new BufferAttribute(s, 2));
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): BufferGeometry {
  return new BoxGeometry(w, h, d).translate(x, y, z);
}

/** The body outline: top line, then back along the sill with an arch over each wheel. */
function outline(d: TrafficDesign): [number, number][] {
  const out = d.body.slice();
  const R = d.r + 0.08;
  const e = Math.asin(Math.max(-1, Math.min(1, (d.sill - d.r) / R)));
  for (const wz of d.wheels.slice().sort((a, b) => a - b)) {
    for (let i = 0; i <= 8; i++) {
      const phi = Math.PI - e + ((2 * e - Math.PI) * i) / 8;
      out.push([wz + R * Math.cos(phi), d.r + R * Math.sin(phi)]);
    }
  }
  return out;
}

function build(d: TrafficDesign): BufferGeometry {
  const W = d.hw * 2;
  const parts: BufferGeometry[] = [];
  const add = (g: BufferGeometry, color: Color, paint = 0, glow = 0) => parts.push(tag(g, color, paint, glow));
  add(extrudeProfile(outline(d), W), WHITE, 1);
  if (d.cabin) {
    // Glass greenhouse, narrower than the body, with a painted roof panel on top.
    const glass = extrudeProfile(d.cabin, W * (d.cabinBase ?? 0.86));
    const p = glass.attributes.position;
    const base = d.cabin.reduce((m, q) => Math.min(m, q[1]), Infinity);
    const top = d.cabin.reduce((m, q) => Math.max(m, q[1]), -Infinity);
    const k = (d.cabinRoof ?? 0.72) / (d.cabinBase ?? 0.86);
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) - base) / (top - base);
      p.setX(i, p.getX(i) * (1 - (1 - k) * t));
    }
    add(glass, GLASS);
    const roofZ = d.cabin.filter((q) => q[1] > top - 0.05).map((q) => q[0]);
    const z0 = Math.min(...roofZ);
    const z1 = Math.max(...roofZ);
    add(box(W * (d.cabinRoof ?? 0.72) * 0.96, 0.06, Math.max(0.3, z1 - z0) * 0.92, 0, top + 0.02, (z0 + z1) / 2), WHITE, 1);
  }
  for (const [zf, zb, y0, y1] of d.bands ?? []) {
    // Windows set into the slab sides (and the windshield when the band reaches the nose).
    add(box(W + 0.03, y1 - y0, zf - zb, 0, (y0 + y1) / 2, (zf + zb) / 2), GLASS);
  }
  if (d.cargo) {
    const [zf, zb, y0, y1] = d.cargo;
    add(box(W + 0.1, y1 - y0, zf - zb, 0, (y0 + y1) / 2, (zf + zb) / 2), CARGO);
    // A painted stripe down the box, and a roll-up door outline at the back.
    add(box(W + 0.14, 0.35, zf - zb - 0.2, 0, y0 + 0.6, (zf + zb) / 2), WHITE, 1);
    add(box(W * 0.8, (y1 - y0) * 0.8, 0.04, 0, (y0 + y1) / 2, zb - 0.02), METAL);
  }
  // Bumpers.
  const front = d.body[0][0];
  const back = d.body[d.body.length - 1][0];
  add(box(W + 0.06, 0.22, 0.2, 0, d.sill + 0.08, front), TRIM);
  add(box(W + 0.06, 0.22, 0.2, 0, d.sill + 0.08, back), TRIM);
  // Lamps: glowing, so they read at dusk from far off.
  for (const s of [-1, 1]) {
    add(box(0.34, 0.14, 0.05, s * (d.hw - 0.3), d.head, front + 0.03), HEAD, 0, 1);
    add(box(0.3, 0.16, 0.05, s * (d.hw - 0.28), d.tail, back - 0.03), TAIL, 0, 1);
  }
  // A plate at the back.
  add(box(0.5, 0.14, 0.03, 0, d.sill + 0.28, back - 0.12), METAL);
  // Wheels, with a hub.
  for (const z of d.wheels) {
    for (const s of [-1, 1]) {
      add(new CylinderGeometry(d.r, d.r, 0.26, 12).rotateZ(Math.PI / 2).translate(s * (d.hw - 0.12), d.r, z), TRIM);
      add(new CylinderGeometry(d.r * 0.5, d.r * 0.5, 0.28, 8).rotateZ(Math.PI / 2).translate(s * (d.hw - 0.12), d.r, z), METAL);
    }
  }
  const merged = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

let cache: { geos: Record<string, BufferGeometry>; material: MeshToonMaterial } | undefined;

/** One geometry per traffic kind (by id) and the shared material; built once. */
export function trafficModels(): { geos: Record<string, BufferGeometry>; material: MeshToonMaterial } {
  if (cache) return cache;
  const geos: Record<string, BufferGeometry> = {};
  for (const [id, d] of Object.entries(DESIGNS)) geos[id] = build(d);
  const material = toon({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = chunks(shader.vertexShader, 'traffic')
      .replace('#include <common>', '#include <common>\nattribute vec2 surf;\nvarying float vGlow;')
      .replace(
        '#include <color_vertex>',
        // The instance color paints only the body.
        `vColor=vec4(color.rgb,1.0);
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb=mix(vColor.rgb,vColor.rgb*instanceColor.rgb,surf.x);
        #endif
        vGlow=surf.y;`,
      ).text;
    shader.fragmentShader = chunks(shader.fragmentShader, 'traffic')
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vColor.rgb*vGlow*1.4;').text;
  };
  material.customProgramCacheKey = () => 'greybox-traffic';
  return (cache = { geos, material });
}

/** Local positions of a kind's head (front) and tail lamps, for glow sprites: [x, y, z] × 4. */
export function lampSpots(id: string): number[][] {
  const d = DESIGNS[id];
  const front = d.body[0][0] + 0.1;
  const back = d.body[d.body.length - 1][0] - 0.1;
  return [
    [-(d.hw - 0.3), d.head, front],
    [d.hw - 0.3, d.head, front],
    [-(d.hw - 0.28), d.tail, back],
    [d.hw - 0.28, d.tail, back],
  ];
}


/**
 * Glow points for traffic lamps: four per car (two head, two tail), written from each car's
 * matrix. Race traffic and the city's ambient cars share it; the caller picks the material.
 */
export class LampPoints {
  readonly geo = new BufferGeometry();
  private readonly pos: Float32Array;

  constructor(max: number) {
    this.pos = new Float32Array(max * 12);
    const col = new Float32Array(max * 12);
    for (let n = 0; n < max; n++) col.set(LAMP_COLORS, n * 12);
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new BufferAttribute(col, 3));
  }

  /** Puts car `slot`'s four lamps where `m` (the car's matrix) puts its kind's lamp spots. */
  write(slot: number, m: Matrix4, spots: number[][]): void {
    const e = m.elements;
    for (let n = 0; n < 4; n++) {
      const [x, y, z] = spots[n];
      const j = slot * 12 + n * 3;
      this.pos[j] = e[0] * x + e[4] * y + e[8] * z + e[12];
      this.pos[j + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      this.pos[j + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
  }

  /** Parks car `slot`'s lamps out of sight. */
  hide(slot: number): void {
    this.pos.fill(0, slot * 12, slot * 12 + 12);
    for (let n = 0; n < 4; n++) this.pos[slot * 12 + n * 3 + 1] = -1e4;
  }

  /** Marks the positions for upload; `count` cars from the start are drawn (all when omitted). */
  commit(count?: number): void {
    if (count !== undefined) this.geo.setDrawRange(0, count * 4);
    (this.geo.attributes.position as BufferAttribute).needsUpdate = true;
  }
}

/** Warm white heads, red tails, per car. */
const LAMP_COLORS = [1, 0.95, 0.8, 1, 0.95, 0.8, 1, 0.13, 0.2, 1, 0.13, 0.2];

const PAINT: PaintDef = { id: 'traffic', name: 'traffic', color: '#ffffff', finish: 'gloss', secondary: '#ff2e88' };

export interface TrafficPart {
  geometry: BufferGeometry;
  material: Material;
  ink?: number;
  /** Ink-only seams (door cuts, bumper lines): drawn in the ink pass and nowhere else. */
  inkOnly: boolean;
  /** Body paint: takes the per-instance color. */
  tint: boolean;
}

/**
 * Race traffic drawn from the racers' own designs, flattened for instancing: build the car once,
 * merge every static mesh into one geometry per (material, ink id), and let world.ts draw each as
 * an InstancedMesh. Nothing comes off and nothing crumples (a wrecked traffic car is cosmetic
 * debris), so the pieces are just more triangles. The body paint is white, tinted per instance.
 */

/** A design's static meshes in the car frame, or undefined if the kind has no design (it stays a box). */
export function trafficModel(design: string, size: [number, number, number]): TrafficPart[] | undefined {
  if (!CAR_DESIGNS[design]) return undefined;
  // Only a band (the van's, the bus's) keeps its second color; racing liveries stay on racers.
  const v = buildCar({ id: design, size }, CAR_DESIGNS[design].livery === 'band' ? PAINT : { ...PAINT, secondary: undefined });
  const paint = v.root.userData.paint as Material;
  v.root.updateMatrixWorld(true);
  const groups = new Map<string, { list: BufferGeometry[]; part: Omit<TrafficPart, 'geometry'> }>();
  v.root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const mat = o.material as Material;
    const inkOnly = o.userData.ink === SEAM;
    // Beams, underglow, shadow and flames are additive or see-through: the racers' only.
    if (mat.transparent && !inkOnly) return;
    const g = (o.geometry as BufferGeometry).clone().applyMatrix4(o.matrixWorld);
    const flat = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(flat.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') flat.deleteAttribute(name);
    const key = `${mat.uuid}:${o.userData.ink ?? ''}`;
    const e = groups.get(key) ?? { list: [], part: { material: mat, ink: o.userData.ink as number | undefined, inkOnly, tint: mat === paint } };
    e.list.push(flat);
    groups.set(key, e);
  });
  const parts = [...groups.values()].map(({ list, part }) => {
    const geometry = mergeGeometries(list)!;
    for (const g of list) g.dispose();
    return { geometry, ...part };
  });
  // Frees the source car's geometry and ink marks. Its materials go on being used by the instances;
  // disposing a material only drops its GPU program, which three rebuilds on first use.
  v.dispose();
  return parts;
}
