// A ruined colonnade's columns (solid props of kind `ruin-column`: Sahara's, down the Sphinx avenue,
// docs/SAHARA.md): Karnak's papyrus columns in sandstone, on square plinths, their painted bands
// faded. A column standing whole is crowned in a flared capital and an abacus; a broken one ends in a
// jagged, tilted drum. Each fills its collider (a box 2 hx across, 2 hy high), so what you see is what
// you hit.

import { BoxGeometry, type BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, Mesh } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Track } from '../../../core/track/bake';
import { hash01 } from '../../../core/rng';
import { toon } from './toon';

const STONE = new Color('#ddc9a0');
const STONE_DARK = new Color('#bfa77c');
/** The paint left on them: a faded blue and an ochre red, in bands. */
const BLUE = new Color('#7d95a8');
const OCHRE = new Color('#b8653a');
/** A column at least this tall (m) stands whole; a shorter one is broken. */
const WHOLE = 7;

/** A part: moved into place (and tilted about x, then turned to `yaw`), painted one colour. */
function part(geo: BufferGeometry, color: Color, x: number, y: number, z: number, yaw: number, tilt = 0): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (tilt) g.rotateX(tilt);
  g.translate(0, y, 0);
  g.rotateY(yaw);
  g.translate(x, 0, z);
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new Float32BufferAttribute(Array.from({ length: n * 3 }, (_, k) => [color.r, color.g, color.b][k % 3]), 3));
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  return g;
}

export function buildColonnade(track: Track): Mesh | null {
  const cols = track.props.filter((p) => p.kind === 'ruin-column');
  if (!cols.length) return null;
  const parts: BufferGeometry[] = [];
  cols.forEach((p, k) => {
    const r = p.hx;
    const high = p.hy * 2;
    const whole = high >= WHOLE;
    const at = (geo: BufferGeometry, c: Color, y: number, tilt = 0) => parts.push(part(geo, c, p.x, p.y + y, p.z, p.heading, tilt));
    // Its plinth, and the shaft (a little taper) up to where it ends.
    at(new BoxGeometry(r * 2, 0.5, r * 2), STONE_DARK, 0.25);
    const shaft = whole ? high - 1.6 : high - 0.5;
    at(new CylinderGeometry(r * 0.8, r * 0.88, shaft, 12), STONE, 0.5 + shaft / 2);
    // The painted bands, a little proud of the shaft: three near its foot, and under the capital.
    for (const [y, c] of [[1.2, BLUE], [1.5, OCHRE], [1.8, BLUE]] as const) if (y < 0.5 + shaft - 0.3) at(new CylinderGeometry(r * 0.9, r * 0.9, 0.16, 12), c, y);
    if (whole) {
      at(new CylinderGeometry(r * 0.9, r * 0.9, 0.2, 12), OCHRE, high - 1.25);
      // The capital, flared like an open papyrus flower, and the abacus block on it.
      at(new CylinderGeometry(r * 1.2, r * 0.8, 0.8, 12), STONE, high - 0.7);
      at(new BoxGeometry(r * 1.7, 0.3, r * 1.7), STONE_DARK, high - 0.15);
    } else {
      // Broken: a last drum knocked askew, its top jagged (a wedge of it missing).
      const tilt = (hash01(k, 31, 7) - 0.5) * 0.35;
      at(new CylinderGeometry(r * 0.78, r * 0.8, 0.45, 12, 1, false, 0, Math.PI * 1.4), STONE_DARK, high - 0.2, tilt);
    }
  });
  const geo = mergeGeometries(parts)!;
  for (const g of parts) g.dispose();
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new Mesh(geo, toon({ vertexColors: true }));
  mesh.matrixAutoUpdate = false;
  return mesh;
}
