// Rock rails (docs/COASTAL.md; the owner: rails on the tight corners up top, rock-themed): where a
// road draped over open ground has a wall (a layout keeps it, and isn't a deck's or a tunnel's: their
// own barriers and tubes stand there), a parapet of limestone blocks along its edge, on the wall's
// line (collide/walls.ts: a shoulder's width past the road). The road chunks draw walls where the
// road is built, not draped; this is the draped road's.

import { DoubleSide, Mesh, type Object3D } from 'three';
import { hash01 } from '../../../core/rng';
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

function rails(geo: Geo, track: Track, sp: BakedSpline): void {
  const g = track.ground!;
  const decks = g.pieces.floors(sp.index);
  const hit = newHit();
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
      for (let s = i * sp.step; s + BLOCK * 0.5 < j * sp.step; s += BLOCK) block(geo, g, sp, hit, s, Math.min(s + BLOCK - JOINT, j * sp.step), side);
      i = j + 1;
    }
  }
}

/** A block from `s0` to `s1` along `sp`, on its `side` edge's wall line, its top following the road. */
function block(geo: Geo, g: NonNullable<Track['ground']>, sp: BakedSpline, hit: ReturnType<typeof newHit>, s0: number, s1: number, side: -1 | 1): void {
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
  geo.face(a[0], b[0], b[1], a[1], color);
  geo.face(a[1], b[1], b[2], a[2], CAP);
  geo.face(a[2], b[2], b[3], a[3], color);
  geo.face(a[0], a[1], a[2], a[3], color);
  geo.face(b[0], b[3], b[2], b[1], color);
}
