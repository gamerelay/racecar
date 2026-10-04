// Buildings (core/track/buildings.ts, PieceDef.building): a hall a road runs through, drawn on its
// piece's stretch of road. Its walls stand where the sim's are (out from the road's edge, as thick
// as BUILDING_WALL, up to its ceiling and BUILDING_ROOF over it), a pitched roof over them, and
// the way through open at each end under a lintel. Its look (the building's key) says how it's
// dressed: 'market', Harbor Town's market hall, pastel plaster outside, timber beams inside,
// lanterns and bunting strung across, striped awnings over the stalls along its walls.

import { DoubleSide, Mesh, type Object3D } from 'three';
import { hash01 } from '../../../core/rng';
import type { BakedSpline, Track } from '../../../core/track/bake';
import { BUILDING_ROOF, BUILDING_WALL } from '../../../core/track/buildings';
import type { Piece } from '../../../core/track/ground';
import { INK, markInk } from '../../ink';
import { glowPoints } from './scenery';
import { Geo } from './track';
import { toon } from './toon';

interface BuildingLook {
  /** Outside: its plaster, a band of trim along its foot and under its eaves, its window glass. */
  plaster: string[];
  trim: string;
  glass: string;
  /** Inside: its walls, its floor's two tiles and the sand over them (sand: what's left showing of each, 0–1), its ceiling and beams. */
  inner: string;
  tiles: [string, string];
  sand?: { colors: [string, string]; showing: number };
  ceiling: string;
  beam: string;
  /** Its roof's tiles, and the stripes of its awnings and its bunting's flags. */
  roof: string[];
  awning: [string, string][];
  flags: string[];
  /** Its lanterns' light. */
  lantern: number;
}

const LOOKS: Record<string, BuildingLook> = {
  market: {
    plaster: ['#f2d7c4', '#cfe6dc', '#f4e7b8', '#d9d2ee'],
    trim: '#f7f2e6',
    glass: '#7fb6c4',
    inner: '#ead9b8',
    tiles: ['#b9643e', '#d8a072'],
    // Blown in off the beach (it drives as sand: the layout's zone), the tiles showing through here and there.
    sand: { colors: ['#e8d4a2', '#dcc48e'], showing: 0.2 },
    ceiling: '#5e4130',
    beam: '#45301f',
    roof: ['#b5523a', '#c4613f', '#a84a35'],
    awning: [
      ['#e04f3c', '#f7f2e6'],
      ['#2f8f83', '#f7f2e6'],
      ['#f0a630', '#f7f2e6'],
      ['#3f6fb5', '#f7f2e6'],
    ],
    flags: ['#e04f3c', '#f0a630', '#2f8f83', '#3f6fb5', '#f7f2e6'],
    lantern: 0xffc070,
  },
};

/** How high its roof's ridge stands over the tops of its walls (m), and how far its eaves reach out past them. */
const RIDGE = 3.2;
const EAVES = 0.9;
/** The floor's lift off the ground (the ground's shaped to the road's plane under it). */
const LIFT = 0.05;
/** A window every this many m along its walls, this wide. */
const WINDOW_EVERY = 6;
const WINDOW_W = 2.6;
/** Beams across its ceiling, bunting and lanterns, every this many m. */
const BEAM_EVERY = 4;
const BUNTING_EVERY = 8;
const LANTERN_EVERY = 5;
/** A stall's awning on each wall every this many m (inside), this long. */
const STALL_EVERY = 7;
const STALL_LEN = 5;

export function buildBuildings(track: Track): Object3D[] {
  const g = track.ground;
  if (!g) return [];
  const out: Object3D[] = [];
  for (const p of g.pieces.list) {
    if (!p.building) continue;
    const look = LOOKS[p.building] ?? LOOKS.market;
    const geo = new Geo();
    const glow: number[] = [];
    hall(geo, glow, track.splines[p.spline], p, look);
    const mesh = new Mesh(geo.build(), toon({ vertexColors: true, side: DoubleSide }));
    mesh.matrixAutoUpdate = false;
    markInk(mesh, INK.sign);
    out.push(mesh);
    if (glow.length) out.push(glowPoints(glow, look.lantern, 5));
  }
  return out;
}

function hall(geo: Geo, glow: number[], sp: BakedSpline, p: Piece, look: BuildingLook): void {
  const k0 = Math.max(0, Math.ceil(p.s[0] / sp.step));
  const k1 = Math.min(sp.n - 1, Math.floor(p.s[1] / sp.step));
  const h = p.ceiling;
  const top = h + BUILDING_ROOF;
  // A point `l` across the road at sample k (+ right), `up` over its plane, `along` m on.
  const at = (k: number, l: number, up: number, along = 0) => [sp.px[k] - sp.tz[k] * l + sp.tx[k] * along, sp.py[k] - l * Math.tan(sp.bank[k]) + up, sp.pz[k] + sp.tx[k] * l + sp.tz[k] * along];
  const edge = (k: number) => sp.width[k] / 2 + sp.shoulder[k];
  const plaster = look.plaster[Math.floor(hash01(sp.index, p.index, 3) * look.plaster.length)];
  const STRIDE = Math.max(1, Math.round(2 / sp.step));
  for (let i = k0; i < k1; i += STRIDE) {
    const j = Math.min(k1, i + STRIDE);
    const s = i * sp.step;
    const ei = edge(i);
    const ej = edge(j);
    // The floor: tiles in a checker, two across the road's width each way.
    const tile = Math.floor(s / 2) % 2;
    const across = Math.ceil((ei * 2) / 2.5);
    for (let t = 0; t < across; t++) {
      const a = -ei + (2 * ei * t) / across;
      const b = -ei + (2 * ei * (t + 1)) / across;
      const a2 = -ej + (2 * ej * t) / across;
      const b2 = -ej + (2 * ej * (t + 1)) / across;
      const bare = !look.sand || hash01(sp.index, i * 31 + t, 9) < look.sand.showing;
      const color = bare ? look.tiles[(tile + t) % 2] : look.sand!.colors[Math.floor(hash01(sp.index, Math.floor(s / 6) * 31 + (t >> 1), 13) * 2)];
      geo.face(at(i, a, LIFT), at(i, b, LIFT), at(j, b2, LIFT), at(j, a2, LIFT), color);
    }
    for (const side of [-1, 1]) {
      const wi = side * ei;
      const wj = side * ej;
      const oi = side * (ei + BUILDING_WALL);
      const oj = side * (ej + BUILDING_WALL);
      // Inside the wall, outside it (a little into the ground), and its top.
      geo.face(at(i, wi, 0), at(j, wj, 0), at(j, wj, h), at(i, wi, h), look.inner);
      geo.face(at(i, oi, -0.6), at(j, oj, -0.6), at(j, oj, top), at(i, oi, top), plaster);
      geo.face(at(i, wi, top), at(j, wj, top), at(j, oj, top), at(i, oi, top), look.trim);
      // A band of trim along its foot and under its eaves, outside.
      geo.face(at(i, oi * 1.002, -0.1), at(j, oj * 1.002, -0.1), at(j, oj * 1.002, 0.7), at(i, oi * 1.002, 0.7), look.trim);
      geo.face(at(i, oi * 1.002, top - 0.6), at(j, oj * 1.002, top - 0.6), at(j, oj * 1.002, top), at(i, oi * 1.002, top), look.trim);
      // Its windows, both faces, framed in trim outside.
      const w = s % WINDOW_EVERY;
      if (w < sp.step * STRIDE && s - p.s[0] > 3 && p.s[1] - s > WINDOW_W + 3) {
        const out = (l: number, up: number, along: number) => at(i, l * 1.004, up, along);
        geo.face(out(oi, 1.6, -0.15), out(oi, 1.6, WINDOW_W + 0.15), out(oi, h - 0.9, WINDOW_W + 0.15), out(oi, h - 0.9, -0.15), look.trim);
        geo.face(out(oi * 1.001, 1.75, 0), out(oi * 1.001, 1.75, WINDOW_W), out(oi * 1.001, h - 1.05, WINDOW_W), out(oi * 1.001, h - 1.05, 0), look.glass);
        geo.face(at(i, wi * 0.998, 1.75), at(i, wi * 0.998, 1.75, WINDOW_W), at(i, wi * 0.998, h - 1.05, WINDOW_W), at(i, wi * 0.998, h - 1.05), look.glass);
      }
      // A stall's striped awning, out from the wall over its shoulder, high over the cars.
      const st = (s - p.s[0]) % STALL_EVERY;
      if (st < sp.step * STRIDE && p.s[1] - s > STALL_LEN + 2 && s - p.s[0] > 2) {
        const reach = Math.min(1.6, sp.shoulder[i] + 0.4);
        const stripes = 5;
        for (let q = 0; q < stripes; q++) {
          const a0 = (STALL_LEN * q) / stripes;
          const a1 = (STALL_LEN * (q + 1)) / stripes;
          const pair = look.awning[Math.floor(hash01(sp.index, i, 5 + side) * look.awning.length)];
          geo.face(at(i, wi * 0.995, h - 1.2, a0), at(i, wi * 0.995, h - 1.2, a1), at(i, wi - side * reach, h - 2, a1), at(i, wi - side * reach, h - 2, a0), pair[q % 2]);
        }
      }
    }
    // The ceiling, and the roof: two pitched faces from the eaves to the ridge.
    geo.face(at(i, -ei, h), at(i, ei, h), at(j, ej, h), at(j, -ej, h), look.ceiling);
    const roof = look.roof[Math.floor(s / 3) % look.roof.length];
    const eaveI = ei + BUILDING_WALL + EAVES;
    const eaveJ = ej + BUILDING_WALL + EAVES;
    for (const side of [-1, 1]) geo.face(at(i, side * eaveI, top - 0.3), at(j, side * eaveJ, top - 0.3), at(j, 0, top + RIDGE), at(i, 0, top + RIDGE), roof);
    // Beams across under the ceiling.
    if (s % BEAM_EVERY < sp.step * STRIDE) beam(geo, at, i, ei, h, look.beam);
    // Bunting across: a string of little flags hanging under the beams.
    if ((s + BUNTING_EVERY / 2) % BUNTING_EVERY < sp.step * STRIDE) {
      const n = Math.ceil((ei * 2) / 0.9);
      for (let f = 0; f < n; f++) {
        const l = -ei + ((f + 0.5) * 2 * ei) / n;
        const sag = 0.6 * (1 - (l / ei) ** 2);
        const y = h - 0.5 - sag;
        const flag = look.flags[(f + i) % look.flags.length];
        geo.face(at(i, l - 0.3, y), at(i, l + 0.3, y), at(i, l, y - 0.55), at(i, l, y - 0.55), flag);
      }
    }
    // Lanterns along its middle.
    if ((s + 1) % LANTERN_EVERY < sp.step * STRIDE) glow.push(...at(i, 0, h - 1.4), ...at(i, -ei * 0.6, h - 1.1), ...at(i, ei * 0.6, h - 1.1));
  }
  // Its two ends: a lintel over the way through (between the walls, from its ceiling up), and the
  // gable over that up to the ridge, both faces.
  for (const [k, d] of [
    [k0, -1],
    [k1, 1],
  ] as const) {
    const e = edge(k);
    const o = e + BUILDING_WALL;
    const front = (l: number, up: number) => at(k, l, up, d * 0.02);
    geo.face(front(-o, h), front(o, h), front(o, top), front(-o, top), look.trim);
    geo.face(front(-o - EAVES, top - 0.3), front(o + EAVES, top - 0.3), front(0, top + RIDGE), front(0, top + RIDGE), plaster);
    // A wall's end, framing the opening (its thickness).
    for (const side of [-1, 1]) geo.face(at(k, side * e, -0.6), at(k, side * o, -0.6), at(k, side * o, top), at(k, side * e, top), look.trim);
    // A sign board over the way in: a band of the awnings' colours.
    const signs = look.awning.length;
    for (let q = 0; q < signs; q++) {
      const a = -e * 0.6 + (1.2 * e * q) / signs;
      const b = -e * 0.6 + (1.2 * e * (q + 1)) / signs;
      geo.face(at(k, a, top + 0.4, d * 0.06), at(k, b, top + 0.4, d * 0.06), at(k, b, top + 1.6, d * 0.06), at(k, a, top + 1.6, d * 0.06), look.awning[q][0]);
    }
  }
}

/** A timber beam across the hall at sample `i`, under its ceiling `h`, wall to wall. */
function beam(geo: Geo, at: (k: number, l: number, up: number, along?: number) => number[], i: number, e: number, h: number, color: string): void {
  const y0 = h - 0.35;
  const w = 0.2;
  geo.face(at(i, -e, y0, -w), at(i, e, y0, -w), at(i, e, y0, w), at(i, -e, y0, w), color);
  for (const a of [-w, w]) geo.face(at(i, -e, y0, a), at(i, e, y0, a), at(i, e, h, a), at(i, -e, h, a), color);
}
