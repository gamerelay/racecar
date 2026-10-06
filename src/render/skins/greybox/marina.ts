// Riviera's marina (docs/COASTAL.md, "The look and the sound": white yachts with navy and teak):
// a timber pontoon out from the harbour's side, boats moored stern-to along both its sides, motor
// yachts and sailboats, each a little different. Drawn only: it's on the water, where no car goes.
// One merged mesh per pontoon, in vertex colors.

import { type BufferGeometry, Mesh } from 'three';
import type { LandmarkDef } from '../../../core/content';
import { Rng } from '../../../core/rng';
import { box, merge } from './lifts';
import { toon } from './toon';

const WHITE = '#f4f1e8';
const TEAK = '#a87a4f';
const NAVY = '#1d2b4f';
const GLASS = '#26323d';
const PLANK = ['#9c7a55', '#8e6e4b', '#a7845d'];
/** Hull colors: mostly white, now and then navy or a deep green. */
const HULLS = [WHITE, WHITE, WHITE, WHITE, NAVY, '#24433a'];

/** A pontoon's deck: how wide, how high over the water (m); boats moored every `every` m along it, `gap` m off its side. */
const DECK = { wide: 2.6, high: 0.7, every: 7.5, gap: 1 };

/**
 * A pontoon from `at` (its shore end) out over the water the way `rot` faces, `length` m long
 * (params.length), with boats along both sides from `seed` (params.seed). `sea` is the water's
 * level relative to `at`'s ground.
 */
export function pontoon(m: LandmarkDef, sea: number): Mesh {
  const len = m.params?.length ?? 45;
  const rng = new Rng(m.params?.seed ?? 1);
  const y = sea + DECK.high;
  const parts: BufferGeometry[] = [];
  // The deck in planks, a row of piles down each side.
  for (let z = 0; z < len; z += 1.5) parts.push(box(DECK.wide, 0.18, 1.4, PLANK[Math.floor(rng.next() * PLANK.length)], 0, y, z + 0.7));
  for (let z = 1; z < len; z += 6) for (const x of [-1, 1]) parts.push(box(0.3, 2.4, 0.3, '#5e4a38', x * (DECK.wide / 2 + 0.1), y - 0.9, z));
  for (let z = DECK.every / 2 + 2; z < len - 2; z += DECK.every) {
    for (const side of [-1, 1]) {
      if (rng.next() < 0.15) continue;
      const sail = rng.next() < 0.4;
      const L = sail ? rng.range(9, 14) : rng.range(11, 20);
      const boat = sail ? sailboat(L, rng) : motorYacht(L, rng);
      // Stern to the pontoon, bow out.
      boat.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2).translate(side * (DECK.wide / 2 + DECK.gap), sea, z + rng.range(-0.6, 0.6));
      parts.push(boat);
    }
  }
  const mesh = new Mesh(merge(parts), toon({ vertexColors: true }));
  return mesh;
}

/** A motor yacht `L` m long, its stern at z 0 and bow toward +z, its waterline at y 0. */
function motorYacht(L: number, rng: Rng): BufferGeometry {
  const B = L * rng.range(0.28, 0.32);
  const hull = HULLS[Math.floor(rng.next() * HULLS.length)];
  const parts = [
    box(B, 1.6, L * 0.78, hull, 0, 0.3, L * 0.39),
    box(B * 0.66, 1.6, L * 0.16, hull, 0, 0.3, L * 0.86),
    box(B * 0.4, 1.5, L * 0.06, hull, 0, 0.35, L * 0.96),
    box(B + 0.05, 0.3, L * 0.78, hull === WHITE ? NAVY : WHITE, 0, 0.75, L * 0.39),
    box(B * 0.9, 0.12, L * 0.85, TEAK, 0, 1.15, L * 0.45),
    box(B * 0.72, 1.4, L * 0.38, WHITE, 0, 1.9, L * 0.4),
    box(B * 0.73, 0.45, L * 0.34, GLASS, 0, 2.1, L * 0.42),
  ];
  // The bigger ones a flybridge on top.
  if (L > 15) parts.push(box(B * 0.6, 0.8, L * 0.2, WHITE, 0, 3.0, L * 0.36), box(B * 0.62, 0.3, L * 0.12, GLASS, 0, 3.3, L * 0.4));
  return merge(parts);
}

/** A sailboat `L` m long (stern at z 0, bow toward +z): a low hull, a small cabin, a tall mast and its boom. */
function sailboat(L: number, rng: Rng): BufferGeometry {
  const B = L * 0.32;
  const hull = HULLS[Math.floor(rng.next() * HULLS.length)];
  return merge([
    box(B, 1.2, L * 0.75, hull, 0, 0.2, L * 0.38),
    box(B * 0.6, 1.1, L * 0.18, hull, 0, 0.25, L * 0.84),
    box(B * 0.3, 1, L * 0.07, hull, 0, 0.3, L * 0.95),
    box(B * 0.92, 0.1, L * 0.8, TEAK, 0, 0.85, L * 0.42),
    box(B * 0.6, 0.6, L * 0.3, WHITE, 0, 1.2, L * 0.5),
    box(B * 0.62, 0.2, L * 0.26, GLASS, 0, 1.3, L * 0.5),
    box(0.16, L * 1.25, 0.16, '#d8d8d8', 0, 0.9 + L * 0.62, L * 0.6),
    box(0.12, 0.12, L * 0.35, '#d8d8d8', 0, 2.2, L * 0.43),
    // The furled mainsail along the boom, under its navy cover.
    box(0.4, 0.35, L * 0.32, NAVY, 0, 2.45, L * 0.43),
  ]);
}
