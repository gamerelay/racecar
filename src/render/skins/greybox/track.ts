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
  LineBasicMaterial,
  LineLoop,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Object3D,
} from 'three';
import { hash01 } from '../../../core/rng';
import { VERGE_DEFAULT, type BakedSpline, type Track } from '../../../core/track/bake';
import { newHit, sampleAt } from '../../../core/track/query';
import type { TrackVisual } from '../../skin';
import { buildCityscape } from './cityscape';
import { buildForest } from './forest';
import { buildIsland } from './island';
import { buildLandmarks, landmarkCircles, landmarkKeeps } from './landmarks';
import { buildSnow } from './snow';
import { drawFeatures } from './features';
import { buildOpenIsland } from './openIsland';
import { buildTubes } from './tube';
import { buildBuildings } from './building';
import { buildTerrain } from './terrain';
import { boxes, type Box } from './scenery';
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
/** The island's concrete barrier, above the curb. */
const ISLAND_BARRIER = 0.85;

export class Geo {
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
/** And each of its deck's points over the main road or its verge, under that point of the main road's. */
const UNDER = 0.06;

/**
 * For a branch: holds a point of its deck that's over the main road (or its verge) under the main
 * road's surface there, so the main road shows and the branch's edge stops along the main road's.
 * A branch is the main road's ground only along its middle (joinBranch, bake.ts): crossing it at
 * an angle, or on a bend, the edges of its flat deck come up through the main road in a sawtooth.
 * `i` is the branch sample the point belongs to.
 */
function underMain(main: BakedSpline, sp: BakedSpline): ((x: number, y: number, z: number, i: number) => number) | null {
  if (sp.index === 0) return null;
  // The main road's sample nearest each overlapping branch sample (in 3D: not a road above or below).
  const near = new Int32Array(sp.n).fill(-1);
  for (let i = 0; i < sp.n; i++) {
    if (sp.merge[i] <= 0) continue;
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < main.n; k++) {
      const d = (main.px[k] - sp.px[i]) ** 2 + (main.py[k] - sp.py[i]) ** 2 * 4 + (main.pz[k] - sp.pz[i]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    near[i] = best;
  }
  return (x, y, z, i) => {
    const k = near[i];
    if (k < 0) return y;
    const rx = -main.tz[k];
    const rz = main.tx[k];
    const lat = (x - main.px[k]) * rx + (z - main.pz[k]) * rz;
    if (Math.abs(lat) > main.width[k] / 2 + main.shoulder[k]) return y;
    const along = (x - main.px[k]) * main.tx[k] + (z - main.pz[k]) * main.tz[k];
    const k1 = (k + 1) % main.n;
    const slope = (main.py[k1] + main.ramp[k1] - main.py[k] - main.ramp[k]) / main.step;
    const ground = main.py[k] + main.ramp[k] + along * slope - lat * Math.tan(main.bank[k]);
    return Math.min(y, ground - UNDER);
  };
}

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
  const island = track.layout.scenery === 'island';
  const land = track.layout.scenery === 'countryside' || island ? buildTerrain(track, palette, seed) : null;
  const style: Style = land ? { country: true, floor: land.height, island } : { country: false };

  // Open ground (docs/AVALANCHE.md) is drawn as itself, the roads' surfaces painted on it.
  for (const sp of track.ground ? [] : track.splines) {
    const deck = land ? land.deck[sp.index] : deckMask(sp, groundY);
    const under = underMain(track.main, sp);
    for (let k = 0; k < sp.chunks.length - 1; k++) {
      const g = new Geo();
      buildChunk(g, track, sp, sp.chunks[k], sp.chunks[k + 1], groundY, city, deck, style, under);
      const mesh = new Mesh(g.build(), road);
      mesh.matrixAutoUpdate = false;
      chunks.push(mesh);
    }
  }
  // A piece's floor on the main road (a deck over open ground) is drawn as a road: the island's concrete bridge,
  // its edges open (no barrier: drive off it), on pillars down into the water.
  const decks: Object3D[] = [];
  if (track.ground) {
    const ground = track.ground;
    const main = track.main;
    // (The island's road, draped over the ground, runs on over its decks: snow.ts. Two roads, one
    // on the other, made a line across it where they met and speckled where they fought.)
    const style: Style = { country: true, floor: (x, z) => ground.height(x, z), island: true, draped: !!ground.coast };
    const deckSample = ground.pieces.floors(main.index) ?? new Uint8Array(main.n);
    for (let i = 0; i < main.n; i++) {
      if (!deckSample[i]) continue;
      let j = i;
      while (j + 1 < main.n && deckSample[j + 1]) j++;
      const g = new Geo();
      buildChunk(g, track, main, i, j, groundY, false, deckSample, style, null);
      const mesh = new Mesh(g.build(), road);
      mesh.matrixAutoUpdate = false;
      chunks.push(mesh);
      i = j;
    }
    const sea = ground.sea;
    const { pillars, caps } = deckPillars(main, deckSample, (x, z) => ground.height(x, z) - 0.5, (x, z) => sea === undefined || ground.height(x, z) > sea, 0xd9d0bd, 0xbdb3a0);
    if (pillars.length) decks.push(boxes(pillars, toon()), boxes(caps, toon()));
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
  // An island on open ground (docs/PARADISE.md): its sea, its crater, its trees.
  const isle = track.ground && (track.ground.sea !== undefined || track.pines) ? buildOpenIsland(track, palette, seed) : null;
  // What the ground's features draw (features.ts): a lava stream's lava.
  const features = drawFeatures(track);
  const extras: Object3D[] = track.ground ? [...buildSnow(track, track.layout.ground?.coast ? new Color(palette.ground) : undefined), ...decks, ...buildTubes(track), ...buildBuildings(track), ...(isle?.objects ?? []), ...features.objects] : city ? [] : land ? [...land.objects] : [plainGround()];
  const wet = puddles(track);
  if (wet) extras.push(wet);
  // Solid props on the road (the pillars): tall striped boxes. The Trestle's legs are the forest's.
  // (Rocks on the snow, a run's gates and a ski jump's tower are snow.ts's; a building's walls, building.ts's.)
  const solid = track.props.filter((p) => p.solid && p.kind !== 'trestle-leg' && p.kind !== 'rock' && p.kind !== 'gate-post' && p.kind !== 'jump-tower' && p.kind !== 'building-wall');
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
  let covers: Cover[] = [];
  if (city) {
    const scape = buildCityscape(track, palette, groundY, landmarkKeeps(track.layout));
    extras.push(...scape.objects);
    update = scape.update;
  }
  if (land && island) {
    // The Freeway's pillars, down into the bay.
    const under = track.splines.map((sp) => deckPillars(sp, land.deck[sp.index], (x, z) => land.height(x, z) - 0.5, () => false, 0xd9d0bd, 0xbdb3a0));
    extras.push(boxes(under.flatMap((u) => u.pillars), toon()), boxes(under.flatMap((u) => u.caps), toon()));
    const dressing = buildIsland(track, seed, land, landmarkCircles(track.layout));
    extras.push(...dressing.objects);
    covers = dressing.covers;
    update = (t, _dt, _cam, live) => {
      land.time.value = t;
      dressing.update(t, live?.wetness ?? 0);
    };
  } else if (land) {
    const forest = buildForest(track, palette, seed, land, landmarkCircles(track.layout));
    extras.push(...forest.objects);
    update = (t, dt, cam) => {
      land.time.value = t;
      forest.update(t, dt, cam);
    };
  }

  if (isle) update = (t) => isle.update(t);

  // Landmarks, on the city's streets, the land or the open ground.
  const ground = track.ground;
  const marks = buildLandmarks(track.layout, land ? land.height : ground ? (x, z) => ground.top(x, z) : () => groundY);
  extras.push(...marks.objects);
  const scenery = update;
  update = (t, dt, cam, live) => {
    scenery?.(t, dt, cam, live);
    features.update(t);
    marks.update(t, live);
  };

  const debug = debugVolumes(track);
  return {
    chunks,
    extras,
    debug,
    update,
    roof: roofMap(track, groundY, city, land ? (sp) => land.deck[sp.index] : (sp) => deckMask(sp, groundY), covers),
    water: (!!land?.objects.length && (!!track.layout.terrain?.river || !!land.sea)) || track.ground?.sea !== undefined,
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

/** A stretch of road the scenery roofs over (spline index, distances), `height` m above the road. */
export interface Cover {
  spline: number;
  from: number;
  to: number;
  height: number;
}

/**
 * Where the sky is covered, and how high the cover is: the tunnel roof at street level, every
 * bridge deck over whatever runs beneath it, and the scenery's covers (the Lava Tube). Rain stops
 * under it.
 */
function roofMap(track: Track, groundY: number, levels: boolean, deckOf: (sp: BakedSpline) => Uint8Array, covers: Cover[] = []): (x: number, z: number) => number {
  const cells = new Map<number, number>();
  for (const sp of track.splines) {
    const deck = deckOf(sp);
    const mine = covers.filter((c) => c.spline === sp.index);
    for (let i = 0; i < sp.n; i++) {
      const y = sp.py[i] + sp.ramp[i];
      const cover = mine.find((c) => i * sp.step >= c.from && i * sp.step <= c.to);
      const top = cover ? y + cover.height : levels && y - groundY < -TUNNEL_H ? groundY : deck[i] === 1 ? y : -Infinity;
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

/**
 * Pillars under a deck every 24 m, from its underside down to `floor` (two across a wide deck), and
 * a cap across the deck over them. `blocked` keeps a pillar off a road below it.
 */
export function deckPillars(sp: BakedSpline, deck: Uint8Array, floor: (x: number, z: number) => number, blocked: (x: number, z: number, y: number) => boolean, color: number, capColor: number): { pillars: Box[]; caps: Box[] } {
  const pillars: Box[] = [];
  const caps: Box[] = [];
  for (let i = 0; i < sp.n; i++) {
    const s = i * sp.step;
    if (!deck[i] || Math.round(s) % 24 !== 0) continue;
    const y = sp.py[i] + sp.ramp[i];
    const rx = -sp.tz[i];
    const rz = sp.tx[i];
    const rot = Math.atan2(sp.tx[i], sp.tz[i]);
    const bottom = y - 1.2;
    const off = sp.width[i] >= 18 ? [-(sp.width[i] / 2 - 3), sp.width[i] / 2 - 3] : [0];
    let placed = false;
    for (const l of off) {
      const x = sp.px[i] + rx * l;
      const z = sp.pz[i] + rz * l;
      // Not on a road below (the colonnade on the Boulevard is gameplay, already there).
      if (blocked(x, z, y)) continue;
      const ground = floor(x, z);
      pillars.push({ x, y: (ground + bottom) / 2, z, w: 2.2, h: bottom - ground, d: 2.2, rot, color });
      placed = true;
    }
    if (placed) caps.push({ x: sp.px[i], y: bottom - 0.5, z: sp.pz[i], w: sp.width[i] * 0.8, h: 1, d: 2.6, rot, color: capColor });
  }
  return { pillars, caps };
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
/** `draped`: the road's top and its lines are drawn by what lies on it (open ground's road, snow.ts), not here. */
type Style = { country: false; draped?: false } | { country: true; floor: (x: number, z: number) => number; island: boolean; draped?: boolean };

const ruts = new Map<string, number>();
/** A rut's color: the road's own, darker. */
function rutColor(color: string): number {
  let c = ruts.get(color);
  if (c === undefined) ruts.set(color, (c = new Color(color).multiplyScalar(0.78).getHex()));
  return c;
}

function buildChunk(g: Geo, track: Track, sp: BakedSpline, i0: number, i1: number, groundY: number, levels: boolean, deck: Uint8Array, style: Style, under: ReturnType<typeof underMain>): void {
  const A: Cross = { cx: 0, cy: 0, cz: 0, rx: 0, rz: 0, tb: 0 };
  const B: Cross = { cx: 0, cy: 0, cz: 0, rx: 0, rz: 0, tb: 0 };
  // The samples A and B are (a branch's points over the main road go under it).
  let ia = 0;
  let ib = 0;
  const at = (c: Cross, l: number, lift: number) => {
    const x = c.cx + c.rx * l;
    const z = c.cz + c.rz * l;
    const y = c.cy - l * c.tb + lift;
    return [x, under ? under(x, y, z, c === A ? ia : ib) : y, z] as const;
  };
  const layoutVerge = track.surfaces[track.surfaceIndex.get(track.layout.shoulderSurface ?? 'sidewalk') ?? 0].color;
  const last = sp.closed ? i1 : Math.min(i1, sp.n - 1);
  for (let i = i0; i < last; i++) {
    const j = sp.closed ? (i + 1) % sp.n : i + 1;
    cross(sp, i, A);
    cross(sp, j, B);
    ia = i;
    ib = j;
    const wa = sp.width[i] / 2;
    const wb = sp.width[j] / 2;
    const sa = wa + sp.shoulder[i];
    const sb = wb + sp.shoulder[j];
    const s = i * sp.step;
    const surf = track.surfaces[sp.surface[i]];
    // The verge in its own surface's color where the stretch sets one (the jungle's earth, the beach's sand).
    const shoulderColor = sp.verge[i] === VERGE_DEFAULT ? layoutVerge : track.surfaces[sp.verge[i]].color;
    // Levels (city): high roads are decks on pillars, low ones trenches, very low ones tunnels.
    const hA = A.cy - groundY;
    const hB = B.cy - groundY;
    const bridge = (levels || style.country) && deck[i] === 1 && deck[j] === 1;
    const sunk = levels && Math.max(hA, hB) < -0.5;
    const covered = levels && Math.max(hA, hB) < -TUNNEL_H;
    g.shade = covered ? 0.5 : 1;
    const outer = [0, 0];
    // The island's roads are concrete where the country's are timber.
    const concrete = style.country && style.island;

    // Road deck (right edge to left edge, winding up).
    let p = at(A, -wa, 0);
    let q = at(A, wa, 0);
    let r = at(B, wa, 0);
    let t = at(B, -wa, 0);
    // The island's earth roads are packed laterite in patches, not one flat color: three strips
    // across, each a little lighter or darker every few meters.
    const earth = style.country && style.island && !style.draped && surf.offroad;
    if (earth) {
      const shade = g.shade;
      for (let k = 0; k < 3; k++) {
        const l0 = -wa + (2 * wa * k) / 3;
        const l1 = -wa + (2 * wa * (k + 1)) / 3;
        const m0 = -wb + (2 * wb * k) / 3;
        const m1 = -wb + (2 * wb * (k + 1)) / 3;
        g.shade = shade * (0.93 + 0.12 * hash01(sp.index, Math.floor(s / 3.5) * 3 + k, 71));
        p = at(A, l0, 0);
        q = at(A, l1, 0);
        r = at(B, m1, 0);
        t = at(B, m0, 0);
        g.quad(q[0], q[1], q[2], p[0], p[1], p[2], t[0], t[1], t[2], r[0], r[1], r[2], surf.color);
      }
      g.shade = shade;
    } else if (!style.draped) g.quad(q[0], q[1], q[2], p[0], p[1], p[2], t[0], t[1], t[2], r[0], r[1], r[2], surf.color);

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
      const color = open[i] ? surf.color : concrete && bridge ? '#cfc7b5' : style.country && bridge ? (Math.floor(s / 1.5) % 2 === 0 ? '#7a5c3c' : '#6e5236') : shoulderColor;
      if (side < 0) g.quad(inA[0], inA[1], inA[2], outA[0], outA[1], outA[2], outB[0], outB[1], outB[2], inB[0], inB[1], inB[2], color);
      else g.quad(outA[0], outA[1], outA[2], inA[0], inA[1], inA[2], inB[0], inB[1], inB[2], outB[0], outB[1], outB[2], color);
      // Curb face, striped red and white on corners of the lap for speed (a grass verge in the country).
      const stripe = concrete ? (bridge ? '#a39a88' : earth ? '#5c4030' : '#c9b27e') : style.country ? (bridge ? '#5e4630' : '#4d5f32') : Math.floor(s / 4) % 2 === 0 ? '#e0d6f0' : '#c43a5a';
      if (side < 0) g.quad(curbA[0], curbA[1], curbA[2], inA[0], inA[1], inA[2], inB[0], inB[1], inB[2], curbB[0], curbB[1], curbB[2], stripe);
      else g.quad(inA[0], inA[1], inA[2], curbA[0], curbA[1], curbA[2], curbB[0], curbB[1], curbB[2], inB[0], inB[1], inB[2], stripe);

      const wall = side < 0 ? sp.wallL[i] && sp.wallL[j] : sp.wallR[i] && sp.wallR[j];
      const baseA = at(A, side * sa, liftA);
      const baseB = at(B, side * sb, liftB);
      // Where the outside drops to: the deck's underside on a bridge, else the ground (the land).
      const lowA = bridge ? A.cy - DECK : style.country ? Math.min(baseA[1] - 0.3, style.floor(baseA[0], baseA[2]) - 0.3) : groundY;
      const lowB = bridge ? B.cy - DECK : style.country ? Math.min(baseB[1] - 0.3, style.floor(baseB[0], baseB[2]) - 0.3) : groundY;
      if (wall && concrete) {
        // A white concrete barrier; the edge under it drops to the land (or the deck's underside).
        const topA = at(A, side * sa, liftA + ISLAND_BARRIER);
        const topB = at(B, side * sb, liftB + ISLAND_BARRIER);
        const backA = at(A, side * (sa + WALL_THICK), liftA + ISLAND_BARRIER);
        const backB = at(B, side * (sb + WALL_THICK), liftB + ISLAND_BARRIER);
        g.face(baseA, baseB, topB, topA, Math.floor(s / 12) % 2 === 0 ? '#f1ebdc' : '#e4dcc9');
        g.face(topA, topB, backB, backA, '#cfc7b5');
        g.face(backA, backB, [backB[0], lowB, backB[2]], [backA[0], lowA, backA[2]], bridge ? '#a39a88' : '#b8ae99');
        outer[side < 0 ? 0 : 1] = WALL_THICK;
      } else if (wall && style.country) {
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
          // 5 cm up: the ground under it reaches the trench, and a closer gap flickers from far away.
          const y = groundY + 0.05;
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
        // A kicker with sides (RampDef.flank): its bank first, down to the road's own height as the
        // physics has it (flankDrop), then the usual bank on down to the land.
        const fa = sp.ramp[i] > 0 ? sp.rampFlank[i] : 0;
        const fb = sp.ramp[j] > 0 ? sp.rampFlank[j] : 0;
        if (fa > 0 || fb > 0) {
          const flankA = at(A, side * (sa + fa), -sp.ramp[i]);
          const flankB = at(B, side * (sb + fb), -sp.ramp[j]);
          g.face(baseA, baseB, flankB, flankA, shoulderColor);
          if (flankA[1] > style.floor(flankA[0], flankA[2]) + 0.2) g.face(flankA, flankB, foot(B, sb + fb, flankB), foot(A, sa + fa, flankA), shoulderColor);
        } else g.face(baseA, baseB, foot(B, sb, baseB), foot(A, sa, baseA), shoulderColor);
      } else if (baseA[1] > lowA + 0.2) {
        // No wall: the shoulder's edge drops to the ground (or the deck's underside).
        g.face(baseA, baseB, [baseB[0], lowB, baseB[2]], [baseA[0], lowA, baseA[2]], concrete ? '#a39a88' : style.country ? (bridge ? '#4a3626' : '#6b553b') : embankment(levels && !bridge && hA > 1.2, s));
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
      g.face([la[0], A.cy - DECK, la[2]], [lb[0], B.cy - DECK, lb[2]], [rb[0], B.cy - DECK, rb[2]], [ra[0], A.cy - DECK, ra[2]], concrete ? '#7d7566' : style.country ? '#3a2a1e' : '#2c2440');
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
      const top = groundY + 0.05;
      g.face([la[0], top, la[2]], [ra[0], top, ra[2]], [rb[0], top, rb[2]], [lb[0], top, lb[2]], (Math.floor(s / 8) + Math.floor(Math.abs(la[0]) / 8)) % 2 === 0 ? '#7a6c96' : '#6d5f86');
      g.shade = 0.5;
    }

    // Markings: solid edge lines, dashed lane lines (the center one yellow), a checkered finish.
    if (style.draped) continue;
    const lanes = sp.lanes[i] || 2;
    // Clear of the asphalt as far off as the depth buffer allows (closer flickers on long straights), under the skids (skids.ts).
    const lift = 0.035;
    const line = (l0: number, l1: number, color: number | string) => {
      p = at(A, l0, lift);
      q = at(A, l1, lift);
      r = at(B, l1, lift);
      t = at(B, l0, lift);
      g.quad(q[0], q[1], q[2], p[0], p[1], p[2], t[0], t[1], t[2], r[0], r[1], r[2], color);
    };
    if (earth) {
      // The island's earth: ruts a shade darker than the road, wandering a little and worn away
      // in places (straight, unbroken ones read as stripes painted on).
      const lw = (2 * wa) / lanes;
      const rut = rutColor(surf.color);
      for (let k = 0; k < lanes; k++) {
        const mid = -wa + lw * (k + 0.5) + Math.sin(s / 13 + k * 2.1) * 0.35;
        if (hash01(sp.index, Math.floor(s / 5.5) * 4 + k * 2, 72) > 0.22) line(mid - 1.1, mid - 0.65, rut);
        if (hash01(sp.index, Math.floor(s / 4.5) * 4 + k * 2 + 1, 72) > 0.22) line(mid + 0.65, mid + 1.1, rut);
      }
      continue;
    }
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
    // The checkered finish has the line to itself: lines under it, at the same lift, flickered through.
    const finish = sp.index === 0 && s < 4;
    if (!sp.openL[i] && !finish) line(-wa + 0.35, -wa + 0.5, '#f4efe6');
    if (!sp.openR[i] && !finish) line(wa - 0.5, wa - 0.35, '#f4efe6');
    if (s % 10 < 3.5 && !finish) {
      for (let k = 1; k < lanes; k++) {
        const l = -wa + (k * 2 * wa) / lanes;
        const center = lanes % 2 === 0 && k === lanes / 2;
        line(l - 0.09, l + 0.09, center ? '#ffc93c' : '#f4efe6');
      }
    }
    if (finish) {
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
  // Each override's region (core/track/overrides.ts), outlined a little over what's there: where
  // a map's own code has the last word.
  const overMat = new LineBasicMaterial({ color: 0xff3fd2, depthTest: false });
  for (const o of track.overrides) {
    const pts: Vector3[] = [];
    for (let k = 0; k < o.outline.length; k += 2) {
      const x = o.outline[k];
      const z = o.outline[k + 1];
      pts.push(new Vector3(x, (track.ground ? track.ground.top(x, z) : nearestY(main, x, z)) + 1.5, z));
    }
    group.add(new LineLoop(new BufferGeometry().setFromPoints(pts), overMat));
  }
  group.visible = false;
  return group;
}

/** The main road's height at its sample nearest (x, z): for drawing over it off open ground. */
function nearestY(sp: BakedSpline, x: number, z: number): number {
  let best = Infinity;
  let y = 0;
  for (let i = 0; i < sp.n; i++) {
    const d = (sp.px[i] - x) ** 2 + (sp.pz[i] - z) ** 2;
    if (d < best) [best, y] = [d, sp.py[i]];
  }
  return y;
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
