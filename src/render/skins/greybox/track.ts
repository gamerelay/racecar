// Greybox track meshes: one merged, vertex-colored mesh per 60 m chunk (road, markings, shoulders,
// curbs, walls with their gaps), city blocks beyond the walls as one instanced mesh, and a ground
// plane. Flat shading, one color per surface: readable, and cheap on any machine.

import {
  AddEquation,
  BoxGeometry,
  CustomBlending,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  SrcAlphaFactor,
  ZeroFactor,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Object3D,
} from 'three';
import type { BakedSpline, Track } from '../../../core/track/bake';
import { newHit, sampleAt } from '../../../core/track/query';
import type { TrackVisual } from '../../skin';
import { buildCityscape } from './cityscape';
import { buildForest } from './forest';
import { buildTerrain } from './terrain';
import { disposeTree } from './dispose';
import { toon, WET } from './toon';
import type { Palette } from './palettes';

const WALL_HEIGHT = 1.1;
const WALL_THICK = 0.5;
const CURB = 0.14;
/** Street level for city scenery; roads well above it are bridges, below it trenches. */
export const CITY_GROUND = -0.25;
/** A road this far above the ground, for at least DECK_RUN meters, is a deck on pillars; shorter humps are solid. */
const BRIDGE_H = 3.5;
const DECK_RUN = 60;
/** Deck thickness under a bridge. */
const DECK = 1.2;
/** A road this far below the ground is covered: a tunnel. */
const TUNNEL_H = 4.5;
/** A trench's retaining wall stands this high above the ground, and its lip reaches this far. */
const RAIL = 0.9;
const LIP = 5;
/** A bridge's barrier height; the railing on it reaches the full wall height and a bit. */
const BARRIER = 0.55;
const RAIL_TOP = 1.25;

class Geo {
  pos: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  private c = new Color();
  /** Multiplies every color (the tunnel's shade). */
  shade = 1;
  face(a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[], color: number | string): void {
    this.quad(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2], color);
  }
  quad(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, color: number | string): void {
    const base = this.pos.length / 3;
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
    this.c.set(color).multiplyScalar(this.shade);
    for (let k = 0; k < 4; k++) this.col.push(this.c.r, this.c.g, this.c.b);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

interface Cross {
  cx: number;
  cy: number;
  cz: number;
  rx: number;
  rz: number;
  tb: number;
}

/** A country road's grass bank: run per meter of drop, and at most this far out. */
const BANK_SLOPE = 2.5;
const BANK_RUN = 7;

/** How far a branch's deck sits under the main road's where they overlap, so the main road's shows. */
const SINK = 0.05;

function cross(sp: BakedSpline, i: number, out: Cross): Cross {
  out.cx = sp.px[i];
  out.cy = sp.py[i] + sp.ramp[i] - SINK * Math.min(1, sp.merge[i] * 4);
  out.cz = sp.pz[i];
  out.rx = -sp.tz[i];
  out.rz = sp.tx[i];
  out.tb = Math.tan(sp.bank[i]);
  return out;
}

export function buildTrackVisual(track: Track, palette: Palette, seed: number): TrackVisual {
  const road = toon({ vertexColors: true, side: DoubleSide });
  const chunks: Object3D[] = [];
  let minY = Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const sp of track.splines) {
    for (let i = 0; i < sp.n; i++) {
      minY = Math.min(minY, sp.py[i]);
      minX = Math.min(minX, sp.px[i]);
      maxX = Math.max(maxX, sp.px[i]);
      minZ = Math.min(minZ, sp.pz[i]);
      maxZ = Math.max(maxZ, sp.pz[i]);
    }
  }
  const city = track.layout.scenery === 'city';
  const groundY = city ? CITY_GROUND : minY - 0.4;
  // Open country gets real land: roads meet it at their edges, and bridges come from its mask.
  const land = track.layout.scenery === 'countryside' ? buildTerrain(track, palette, seed) : null;
  const style: Style = land ? { country: true, floor: land.height } : { country: false };

  for (const sp of track.splines) {
    const deck = land ? land.deck[sp.index] : deckMask(sp, groundY);
    for (let k = 0; k < sp.chunks.length - 1; k++) {
      const g = new Geo();
      buildChunk(g, track, sp, sp.chunks[k], sp.chunks[k + 1], groundY, city, deck, style);
      const mesh = new Mesh(g.build(), road);
      mesh.matrixAutoUpdate = false;
      chunks.push(mesh);
    }
  }

  // The city lays its own ground (streets, with holes where a trench runs); the country has its land.
  // Anything else gets a plain plane.
  const plainGround = () => {
    const ground = new Mesh(new PlaneGeometry(maxX - minX + 3000, maxZ - minZ + 3000), toon({ color: palette.ground }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((minX + maxX) / 2, groundY, (minZ + maxZ) / 2);
    ground.updateMatrix();
    ground.matrixAutoUpdate = false;
    return ground;
  };
  const extras: Object3D[] = city ? [] : land ? [...land.objects] : [plainGround()];
  const wet = puddles(track);
  if (wet) extras.push(wet);
  // Solid props on the road (the pillars): tall striped boxes.
  const solid = track.props.filter((p) => p.solid);
  if (solid.length) {
    const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), toon({ color: 0xbfb3d6 }), solid.length);
    const mat = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    solid.forEach((p, k) => {
      mat.compose(new Vector3(p.x, p.y + p.hy, p.z), q.setFromAxisAngle(up, p.heading), new Vector3(p.hx * 2, p.hy * 2, p.hz * 2));
      mesh.setMatrixAt(k, mat);
    });
    mesh.computeBoundingSphere();
    extras.push(mesh);
  }
  let update: TrackVisual['update'];
  if (city) {
    const scape = buildCityscape(track, palette, groundY);
    extras.push(...scape.objects);
    update = scape.update;
  }
  if (land) {
    const forest = buildForest(track, palette, seed, land);
    extras.push(...forest.objects);
    update = (t, dt, cam) => {
      land.time.value = t;
      forest.update(t, dt, cam);
    };
  }

  const debug = debugVolumes(track);
  return {
    chunks,
    extras,
    debug,
    update,
    roof: roofMap(track, groundY, city, land ? (sp) => land.deck[sp.index] : (sp) => deckMask(sp, groundY)),
    water: !!land?.objects.length && !!track.layout.terrain?.river,
    dispose() {
      for (const c of chunks) (c as Mesh).geometry.dispose();
      road.dispose();
      // Everything else this build made (the city: hundreds of instanced meshes, sign textures).
      disposeTree([...extras, debug]);
    },
  };
}

/** Steel railing along one edge between two cross-sections: posts every 3 m, a top and a mid rail. */
interface RailStyle {
  top: string;
  mid: string;
  post: string;
  /** Where the posts start (above the curb), how high the top rail is, and the post spacing. */
  base: number;
  height: number;
  every: number;
  /** Half thickness of the top rail. */
  thick: number;
}
const STEEL: RailStyle = { top: '#c9c0e0', mid: '#a89cc0', post: '#8f84a8', base: BARRIER, height: RAIL_TOP, every: 3, thick: 0.09 };
const TIMBER: RailStyle = { top: '#9a7a52', mid: '#86683f', post: '#5e4630', base: -0.2, height: 0.95, every: 2.5, thick: 0.13 };

function railing(g: Geo, A: Cross, B: Cross, la: number, lb: number, s: number, step: number, st: RailStyle): void {
  const at = (c: Cross, l: number, y: number) => [c.cx + c.rx * l, c.cy - l * c.tb + y, c.cz + c.rz * l];
  const bar = (y0: number, y1: number, half: number, color: string) => {
    const a0 = at(A, la - half, y0);
    const a1 = at(A, la + half, y0);
    const b0 = at(B, lb - half, y0);
    const b1 = at(B, lb + half, y0);
    const a2 = at(A, la - half, y1);
    const a3 = at(A, la + half, y1);
    const b2 = at(B, lb - half, y1);
    const b3 = at(B, lb + half, y1);
    g.face(a2, b2, b3, a3, color);
    g.face(a0, b0, b2, a2, color);
    g.face(a1, b1, b3, a3, color);
  };
  bar(CURB + st.height - 0.16, CURB + st.height, st.thick, st.top);
  bar(CURB + st.height * 0.55 - 0.05, CURB + st.height * 0.55 + 0.05, st.thick * 0.6, st.mid);
  if (Math.floor(s / st.every) !== Math.floor((s + step) / st.every)) {
    // A post: a thin box at A, the length of a tenth of a step along the road.
    const t = 0.12;
    const post = (dl: number, y: number) => at(A, la + dl, y);
    const dx = (B.cx - A.cx) * t;
    const dz = (B.cz - A.cz) * t;
    const p = [post(-0.09, CURB + st.base), post(0.09, CURB + st.base), post(-0.09, CURB + st.height + 0.05), post(0.09, CURB + st.height + 0.05)];
    const q = p.map((v) => [v[0] + dx, v[1], v[2] + dz]);
    g.face(p[0], p[1], p[3], p[2], st.post);
    g.face(q[0], q[1], q[3], q[2], st.post);
    g.face(p[0], q[0], q[2], p[2], st.post);
    g.face(p[1], q[1], q[3], p[3], st.post);
  }
}

/**
 * Which samples are bridge deck: high above the ground for a long enough run. A short hump (the
 * Market's bridge) is an embankment: solid to the ground, no pillars.
 */
/** Roof cells: 4 m on a side, keyed by cell, holding the highest cover over that ground. */
const ROOF_CELL = 4;
const roofKey = (x: number, z: number) => (Math.floor(x / ROOF_CELL) + 32768) * 65536 + (Math.floor(z / ROOF_CELL) + 32768);

/**
 * Where the sky is covered, and how high the cover is: the tunnel roof at street level, and every
 * bridge deck over whatever runs beneath it. Rain stops under it.
 */
function roofMap(track: Track, groundY: number, levels: boolean, deckOf: (sp: BakedSpline) => Uint8Array): (x: number, z: number) => number {
  const cells = new Map<number, number>();
  for (const sp of track.splines) {
    const deck = deckOf(sp);
    for (let i = 0; i < sp.n; i++) {
      const y = sp.py[i] + sp.ramp[i];
      const top = levels && y - groundY < -TUNNEL_H ? groundY : deck[i] === 1 ? y : -Infinity;
      if (top === -Infinity) continue;
      const reach = sp.width[i] / 2 + sp.shoulder[i] + WALL_THICK + 1;
      for (let l = -reach; l <= reach; l += ROOF_CELL / 2) {
        const k = roofKey(sp.px[i] - sp.tz[i] * l, sp.pz[i] + sp.tx[i] * l);
        cells.set(k, Math.max(cells.get(k) ?? -Infinity, top));
      }
    }
  }
  return (x, z) => cells.get(roofKey(x, z)) ?? -Infinity;
}

/** The outside face of a raised road: dressed stone in the city (a hump bridge, a ramp), else shadow. */
function embankment(stone: boolean, s: number): string {
  if (!stone) return '#3a2f52';
  return Math.floor(s / 3) % 2 === 0 ? '#5d4f7c' : '#544672';
}

export function deckMask(sp: BakedSpline, groundY: number): Uint8Array {
  const out = new Uint8Array(sp.n);
  const high = (i: number) => sp.py[i] + sp.ramp[i] - groundY > BRIDGE_H;
  let i = 0;
  while (i < sp.n) {
    if (!high(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j < sp.n && high(j)) j++;
    if ((j - i) * sp.step >= DECK_RUN) out.fill(1, i, j);
    i = j;
  }
  return out;
}

/** How roads look off the city grid: timber and earth, land under them rather than a flat ground. */
type Style = { country: false } | { country: true; floor: (x: number, z: number) => number };

function buildChunk(g: Geo, track: Track, sp: BakedSpline, i0: number, i1: number, groundY: number, levels: boolean, deck: Uint8Array, style: Style): void {
  const A: Cross = { cx: 0, cy: 0, cz: 0, rx: 0, rz: 0, tb: 0 };
  const B: Cross = { cx: 0, cy: 0, cz: 0, rx: 0, rz: 0, tb: 0 };
  const at = (c: Cross, l: number, lift: number) => [c.cx + c.rx * l, c.cy - l * c.tb + lift, c.cz + c.rz * l] as const;
  const shoulderColor = track.surfaces[track.surfaceIndex.get(track.layout.shoulderSurface ?? 'sidewalk') ?? 0].color;
  const last = sp.closed ? i1 : Math.min(i1, sp.n - 1);
  for (let i = i0; i < last; i++) {
    const j = sp.closed ? (i + 1) % sp.n : i + 1;
    cross(sp, i, A);
    cross(sp, j, B);
    const wa = sp.width[i] / 2;
    const wb = sp.width[j] / 2;
    const sa = wa + sp.shoulder[i];
    const sb = wb + sp.shoulder[j];
    const s = i * sp.step;
    const surf = track.surfaces[sp.surface[i]];
    // Levels (city): high roads are decks on pillars, low ones trenches, very low ones tunnels.
    const hA = A.cy - groundY;
    const hB = B.cy - groundY;
    const bridge = (levels || style.country) && deck[i] === 1 && deck[j] === 1;
    const sunk = levels && Math.max(hA, hB) < -0.5;
    const covered = levels && Math.max(hA, hB) < -TUNNEL_H;
    g.shade = covered ? 0.5 : 1;
    const outer = [0, 0];

    // Road deck (right edge to left edge, winding up).
    let p = at(A, -wa, 0);
    let q = at(A, wa, 0);
    let r = at(B, wa, 0);
    let t = at(B, -wa, 0);
    g.quad(q[0], q[1], q[2], p[0], p[1], p[2], t[0], t[1], t[2], r[0], r[1], r[2], surf.color);

    // Shoulders (sidewalks) with a curb step, both sides. Where another road runs through a
    // side (a branch's mouth), it's open: flush with the road and paved like it, no curb.
    for (const side of [-1, 1]) {
      const open = side < 0 ? sp.openL : sp.openR;
      const liftA = open[i] ? 0 : CURB;
      const liftB = open[j] ? 0 : CURB;
      const inA = at(A, side * wa, liftA);
      const inB = at(B, side * wb, liftB);
      const outA = at(A, side * sa, liftA);
      const outB = at(B, side * sb, liftB);
      const curbA = at(A, side * wa, 0);
      const curbB = at(B, side * wb, 0);
      // A bridge's verge in the country is its timber deck.
      const color = open[i] ? surf.color : style.country && bridge ? (Math.floor(s / 1.5) % 2 === 0 ? '#7a5c3c' : '#6e5236') : shoulderColor;
      if (side < 0) g.quad(inA[0], inA[1], inA[2], outA[0], outA[1], outA[2], outB[0], outB[1], outB[2], inB[0], inB[1], inB[2], color);
      else g.quad(outA[0], outA[1], outA[2], inA[0], inA[1], inA[2], inB[0], inB[1], inB[2], outB[0], outB[1], outB[2], color);
      // Curb face, striped red and white on corners of the lap for speed (a grass verge in the country).
      const stripe = style.country ? (bridge ? '#5e4630' : '#4d5f32') : Math.floor(s / 4) % 2 === 0 ? '#e0d6f0' : '#c43a5a';
      if (side < 0) g.quad(curbA[0], curbA[1], curbA[2], inA[0], inA[1], inA[2], inB[0], inB[1], inB[2], curbB[0], curbB[1], curbB[2], stripe);
      else g.quad(inA[0], inA[1], inA[2], curbA[0], curbA[1], curbA[2], curbB[0], curbB[1], curbB[2], inB[0], inB[1], inB[2], stripe);

      const wall = side < 0 ? sp.wallL[i] && sp.wallL[j] : sp.wallR[i] && sp.wallR[j];
      const baseA = at(A, side * sa, liftA);
      const baseB = at(B, side * sb, liftB);
      // Where the outside drops to: the deck's underside on a bridge, else the ground (the land).
      const lowA = bridge ? A.cy - DECK : style.country ? Math.min(baseA[1] - 0.3, style.floor(baseA[0], baseA[2]) - 0.3) : groundY;
      const lowB = bridge ? B.cy - DECK : style.country ? Math.min(baseB[1] - 0.3, style.floor(baseB[0], baseB[2]) - 0.3) : groundY;
      if (wall && style.country) {
        // Timber: a guardrail on posts, or a bridge's railing; the edge drops to the land below.
        g.face(baseA, baseB, [baseB[0], lowB, baseB[2]], [baseA[0], lowA, baseA[2]], bridge ? '#4a3626' : '#6b553b');
        railing(g, A, B, side * (sa - 0.15), side * (sb - 0.15), s, sp.step, TIMBER);
      } else if (wall) {
        // A trench's walls hold the ground back, so they reach up past it.
        // A bridge's is a low barrier with a railing on top, so you can see over the edge.
        const plain = bridge ? CURB + BARRIER : CURB + WALL_HEIGHT;
        const liftA = sunk ? Math.max(plain, groundY + RAIL - A.cy) : plain;
        const liftB = sunk ? Math.max(plain, groundY + RAIL - B.cy) : plain;
        const topA = at(A, side * sa, liftA);
        const topB = at(B, side * sb, liftB);
        const backA = at(A, side * (sa + WALL_THICK), liftA);
        const backB = at(B, side * (sb + WALL_THICK), liftB);
        const face = sunk ? (Math.floor(s / 6) % 2 === 0 ? '#9a8fb0' : '#8a7fa2') : Math.floor(s / 12) % 2 === 0 ? '#d8cfe8' : '#bfb3d6';
        g.face(baseA, baseB, topB, topA, face);
        g.face(topA, topB, backB, backA, '#8f84a8');
        g.face(backA, backB, [backB[0], lowB, backB[2]], [backA[0], lowA, backA[2]], embankment(levels && !bridge && hA > 1.2, s));
        if (sunk) {
          // A lip of pavement round the top, so the ground meets the trench with no gap.
          const lipA = at(A, side * (sa + WALL_THICK + LIP), 0);
          const lipB = at(B, side * (sb + WALL_THICK + LIP), 0);
          const y = groundY + 0.01;
          g.face([backA[0], y, backA[2]], [backB[0], y, backB[2]], [lipB[0], y, lipB[2]], [lipA[0], y, lipA[2]], '#6d5f86');
        }
        outer[side < 0 ? 0 : 1] = WALL_THICK;
        if (bridge) railing(g, A, B, side * (sa + WALL_THICK / 2), side * (sb + WALL_THICK / 2), s, sp.step, STEEL);
      } else if (style.country && !bridge && baseA[1] > lowA + 0.2) {
        // No wall in the country: a grass bank slopes from the verge down into the land, not a
        // sheer drop (you see it when a drift runs wide, and on every crest).
        const foot = (c: Cross, edge: number, base: readonly number[]) => {
          const run = Math.min(BANK_RUN, (base[1] - style.floor(base[0], base[2])) * BANK_SLOPE);
          const p = at(c, side * (edge + run), 0);
          return [p[0], style.floor(p[0], p[2]) - 0.15, p[2]];
        };
        g.face(baseA, baseB, foot(B, sb, baseB), foot(A, sa, baseA), shoulderColor);
      } else if (baseA[1] > lowA + 0.2) {
        // No wall: the shoulder's edge drops to the ground (or the deck's underside).
        g.face(baseA, baseB, [baseB[0], lowB, baseB[2]], [baseA[0], lowA, baseA[2]], style.country ? (bridge ? '#4a3626' : '#6b553b') : embankment(levels && !bridge && hA > 1.2, s));
      }
    }
    if (bridge) {
      // The deck's underside.
      const l = -(sa + outer[0]);
      const r = sa + outer[1];
      const la = at(A, l, 0);
      const ra = at(A, r, 0);
      const lb = at(B, -(sb + outer[0]), 0);
      const rb = at(B, sb + outer[1], 0);
      g.face([la[0], A.cy - DECK, la[2]], [lb[0], B.cy - DECK, lb[2]], [rb[0], B.cy - DECK, rb[2]], [ra[0], A.cy - DECK, ra[2]], style.country ? '#3a2a1e' : '#2c2440');
    }
    if (covered) {
      // The tunnel roof: a concrete slab at street level, the plaza on top.
      const la = at(A, -(sa + WALL_THICK), 0);
      const ra = at(A, sa + WALL_THICK, 0);
      const lb = at(B, -(sb + WALL_THICK), 0);
      const rb = at(B, sb + WALL_THICK, 0);
      const under = groundY - 0.6;
      g.face([la[0], under, la[2]], [lb[0], under, lb[2]], [rb[0], under, rb[2]], [ra[0], under, ra[2]], '#5a5070');
      g.shade = 1;
      const top = groundY + 0.02;
      g.face([la[0], top, la[2]], [ra[0], top, ra[2]], [rb[0], top, rb[2]], [lb[0], top, lb[2]], (Math.floor(s / 8) + Math.floor(Math.abs(la[0]) / 8)) % 2 === 0 ? '#7a6c96' : '#6d5f86');
      g.shade = 0.5;
    }

    // Markings: solid edge lines, dashed lane lines (the center one yellow), a checkered finish.
    const lanes = sp.lanes[i] || 2;
    const lift = 0.02;
    const line = (l0: number, l1: number, color: string) => {
      p = at(A, l0, lift);
      q = at(A, l1, lift);
      r = at(B, l1, lift);
      t = at(B, l0, lift);
      g.quad(q[0], q[1], q[2], p[0], p[1], p[2], t[0], t[1], t[2], r[0], r[1], r[2], color);
    };
    if (surf.offroad) {
      // Dirt: two worn ruts per lane.
      const lw = (2 * wa) / lanes;
      for (let k = 0; k < lanes; k++) {
        const mid = -wa + lw * (k + 0.5);
        line(mid - 1.05, mid - 0.6, '#6f5438');
        line(mid + 0.6, mid + 1.05, '#6f5438');
      }
      continue;
    }
    if (!sp.openL[i]) line(-wa + 0.35, -wa + 0.5, '#f4efe6');
    if (!sp.openR[i]) line(wa - 0.5, wa - 0.35, '#f4efe6');
    if (s % 10 < 3.5) {
      for (let k = 1; k < lanes; k++) {
        const l = -wa + (k * 2 * wa) / lanes;
        const center = lanes % 2 === 0 && k === lanes / 2;
        line(l - 0.09, l + 0.09, center ? '#ffc93c' : '#f4efe6');
      }
    }
    if (sp.index === 0 && s < 4) {
      const cells = 12;
      for (let k = 0; k < cells; k++) {
        const l0 = -wa + (k * 2 * wa) / cells;
        const l1 = l0 + (2 * wa) / cells;
        line(l0, l1, (k + Math.floor(s)) % 2 === 0 ? '#f4efe6' : '#120a20');
      }
    }
  }
}

function debugVolumes(track: Track): Object3D {
  const group = new Group();
  const cpMat = new MeshBasicMaterial({ color: 0x35f0ff, transparent: true, opacity: 0.18, side: DoubleSide, depthWrite: false });
  const gapMat = new MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.25, side: DoubleSide, depthWrite: false });
  const main = track.main;
  for (const cp of track.checkpoints) {
    const i = Math.round(cp / main.step) % main.n;
    const gate = new Mesh(new PlaneGeometry(main.width[i] + 2 * main.shoulder[i], 6), cpMat);
    gate.position.set(main.px[i], main.py[i] + 3, main.pz[i]);
    gate.rotation.y = Math.atan2(main.tx[i], main.tz[i]);
    group.add(gate);
  }
  for (const sp of track.splines.slice(1)) {
    for (const s of [sp.mainFrom, sp.mainTo]) {
      const i = Math.round(s / main.step) % main.n;
      const post = new Mesh(new BoxGeometry(1, 8, 1), gapMat);
      post.position.set(main.px[i], main.py[i] + 4, main.pz[i]);
      group.add(post);
    }
  }
  group.visible = false;
  return group;
}

/**
 * The rain's puddles (zones on a 'puddle' surface), drawn as dark water that fades in with the
 * wetness. They're slippery, so they must be seen: each also clears the alpha channel where it's
 * drawn, which the post pass reads as "mirror here" for its reflections.
 */
function puddles(track: Track): Object3D | null {
  const pos: number[] = [];
  const uv: number[] = [];
  const seed: number[] = [];
  const idx: number[] = [];
  const hit = newHit();
  let k = 0;
  for (const sp of track.splines) {
    for (const z of sp.zones) {
      if (track.surfaces[z.surface]?.id !== 'puddle') continue;
      const { s0, s1, l0, l1 } = z;
      const steps = Math.max(2, Math.ceil((s1 - s0) / 1.5));
      const across = 6;
      const base = pos.length / 3;
      for (let a = 0; a <= steps; a++) {
        const s = s0 + ((s1 - s0) * a) / steps;
        sampleAt(sp, s, hit);
        const tb = Math.tan(hit.bank);
        for (let b = 0; b <= across; b++) {
          const l = l0 + ((l1 - l0) * b) / across;
          pos.push(hit.cx - hit.tz * l, hit.cy - l * tb + 0.03, hit.cz + hit.tx * l);
          uv.push(a / steps, b / across);
          seed.push(k * 1.7);
        }
      }
      for (let a = 0; a < steps; a++) {
        for (let b = 0; b < across; b++) {
          const i = base + a * (across + 1) + b;
          idx.push(i, i + across + 1, i + 1, i + 1, i + across + 1, i + across + 2);
        }
      }
      k++;
    }
  }
  if (!pos.length) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('seed', new Float32BufferAttribute(seed, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const mat = new ShaderMaterial({
    uniforms: { uWet: WET },
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: SrcAlphaFactor,
    blendDst: OneMinusSrcAlphaFactor,
    // Alpha: dst * (1 - src), so a puddle's middle writes ~0: the post pass's mirror mask.
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
    vertexShader: `attribute float seed;varying vec2 vUv;varying float vSeed;
      void main(){vUv=uv;vSeed=seed;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `uniform float uWet;varying vec2 vUv;varying float vSeed;
      void main(){
        vec2 q=(vUv-0.5)*2.0;
        float ang=atan(q.y,q.x);
        // A wobbly blob, not a rectangle.
        float d=length(q)+0.1*sin(ang*3.0+vSeed)+0.07*sin(ang*7.0+vSeed*2.3)+0.05*sin(q.x*11.0+vSeed);
        float a=(1.0-smoothstep(0.7,0.92,d))*smoothstep(0.1,0.6,uWet);
        gl_FragColor=vec4(0.07,0.08,0.16,a*0.85);
      }`,
  });
  const mesh = new Mesh(g, mat);
  mesh.renderOrder = 2;
  return mesh;
}
