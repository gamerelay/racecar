// Rock rails (docs/COASTAL.md; the owner: rails on the tight corners up top, rock-themed): where a
// road draped over open ground has a wall (a layout keeps it, and isn't a deck's or a tunnel's: their
// own barriers and tubes stand there), a parapet of limestone blocks along its edge, on the wall's
// line (collide/walls.ts: a shoulder's width past the road). The road chunks draw walls where the
// road is built, not draped; this is the draped road's. Along a sea wall (a `seawall` feature) a
// stone ledge runs on from it to the quay's edge (SEAWALL_FACE), and a stone face from there down
// to the floor under the water: a retaining wall, the sea against it.

import { DoubleSide, Mesh, type Object3D } from 'three';
import { hash01 } from '../../../core/rng';
import { SEAWALL_FACE } from '../../../core/track/features/seawall';
import type { SeawallDef } from '../../../core/content';
import type { BakedSpline, Track } from '../../../core/track/bake';
import { newHit, sampleAt } from '../../../core/track/query';
import { Geo } from './track';
import { toon } from './toon';

/** A block's length along the road, the gap between blocks, how thick and how high it stands (m). */
const BLOCK = 2.1;
const JOINT = 0.12;
const THICK = 0.9;
const HIGH = 0.85;
/** How far its foot sinks into the ground, so a slope never shows a gap under it. */
const SINK = 0.5;
const STONE = ['#d8ccb2', '#cbbd9f', '#e2d7bf', '#bfb092'];
const CAP = '#ece4d2';
/** A sea wall's ledge: worn paving. */
const LEDGE = '#cfc3a9';

export function buildRockRails(track: Track): Object3D[] {
  const g = track.ground;
  if (!g || !track.layout.ground?.coast) return [];
  const geo = new Geo();
  for (const sp of [track.main]) rails(geo, track, sp);
  if (!geo.pos.length) return [];
  const mesh = new Mesh(geo.build(), toon({ vertexColors: true, side: DoubleSide }));
  mesh.matrixAutoUpdate = false;
  return [mesh];
}

/** The sea wall's floor at `s` m along the main road on `side`, if one stands there (NaN if not). */
function seawallFloor(walls: SeawallDef[], length: number, s: number, side: -1 | 1): number {
  for (const w of walls) {
    if ((w.side === 'left' ? -1 : 1) !== side) continue;
    const len = (((w.s[1] - w.s[0]) % length) + length) % length;
    if ((((s - w.s[0]) % length) + length) % length <= len) return w.floor;
  }
  return Number.NaN;
}

function rails(geo: Geo, track: Track, sp: BakedSpline): void {
  const g = track.ground!;
  const decks = g.pieces.floors(sp.index);
  const hit = newHit();
  const seawalls = (track.layout.ground?.features ?? []).filter((f): f is SeawallDef => f.kind === 'seawall');
  for (const side of [-1, 1] as const) {
    const wall = side < 0 ? sp.wallL : sp.wallR;
    const on = (i: number) => wall[i] === 1 && !decks?.[i];
    for (let i = 0; i < sp.n; ) {
      if (!on(i)) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < sp.n && on(j + 1)) j++;
      // Blocks along the run, from its first sample to its last.
      for (let s = i * sp.step; s + BLOCK * 0.5 < j * sp.step; s += BLOCK) {
        const s1 = Math.min(s + BLOCK - JOINT, j * sp.step);
        const floor = sp.index === 0 && seawalls.length ? seawallFloor(seawalls, sp.length, (s + s1) / 2, side) : Number.NaN;
        block(geo, g, sp, hit, s, s1, side, floor);
      }
      i = j + 1;
    }
  }
}

/**
 * A block from `s0` to `s1` along `sp`, on its `side` edge's wall line, its top following the road;
 * over a sea wall (`floor` a number), the ledge past it and the sea face down to `floor`.
 */
function block(geo: Geo, g: NonNullable<Track['ground']>, sp: BakedSpline, hit: ReturnType<typeof newHit>, s0: number, s1: number, side: -1 | 1, floor: number): void {
  const corner = (s: number, out: number, up: number) => {
    sampleAt(sp, s, hit);
    const l = side * (hit.width / 2 + hit.shoulder + out);
    const x = hit.cx - hit.tz * l;
    const z = hit.cz + hit.tx * l;
    // On the road's own floor beside it (not a tunnel's rock over it).
    const y = Math.max(g.top(x, z, hit.cy + 1), hit.cy - l * Math.tan(hit.bank));
    return [x, y + up, z];
  };
  const k = Math.floor(s0 / BLOCK);
  const color = STONE[Math.floor(hash01(sp.index, k, side + 5) * STONE.length)];
  const high = HIGH * (0.9 + 0.2 * hash01(sp.index, k, side + 9));
  // Inner face (the road's side), top, outer face, and the two ends.
  const a = [corner(s0, 0, -SINK), corner(s0, 0, high), corner(s0, THICK, high), corner(s0, THICK, -SINK)];
  const b = [corner(s1, 0, -SINK), corner(s1, 0, high), corner(s1, THICK, high), corner(s1, THICK, -SINK)];
  if (!Number.isNaN(floor)) {
    // The ledge (its top at the road's, a hair under so it never shows through the block), to the
    // quay's edge, and the sea face down to the floor; joints and all, a block's length each.
    const ledge = (s: number, up: number) => corner(s, SEAWALL_FACE, up);
    const deep = (s: number) => {
      const c = corner(s, SEAWALL_FACE, 0);
      c[1] = floor;
      return c;
    };
    const [la, lb] = [corner(s0, THICK, -0.02), corner(s1, THICK, -0.02)];
    const [ea, eb] = [ledge(s0, -0.02), ledge(s1, -0.02)];
    geo.face(la, lb, eb, ea, LEDGE);
    geo.face(ea, eb, deep(s1), deep(s0), color);
    // Its ends, where the run starts and stops (the next block's covers a joint).
    geo.face(la, ea, deep(s0), corner(s0, THICK, -SINK), color);
    geo.face(lb, corner(s1, THICK, -SINK), deep(s1), eb, color);
  }
  geo.face(a[0], b[0], b[1], a[1], color);
  geo.face(a[1], b[1], b[2], a[2], CAP);
  geo.face(a[2], b[2], b[3], a[3], color);
  geo.face(a[0], a[1], a[2], a[3], color);
  geo.face(b[0], b[3], b[2], b[1], color);
}
