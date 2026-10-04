// The skin's part of the ground's features (docs/CALDERA.md, "A feature, end to end"): core's
// features (core/track/features) say what they do to the ground and the cars; what they look like
// past the ground's own colours (ground/surface.ts's kinds, snow.ts) is drawn here, by kind. A
// feature with nothing to add has no entry.

import type { Object3D } from 'three';
import { BufferGeometry, Float32BufferAttribute, Mesh } from 'three';
import type { LavaStreamDef } from '../../../core/content';
import type { Track } from '../../../core/track/bake';
import { LAVA_EDGE, LAVA_FILL, lavaSource, type Feature, type Ground } from '../../../core/track/ground';
import { lavaMaterial } from './island';
import { glowPoints } from './scenery';

type Draw = (f: Feature, ground: Ground, time: { value: number }) => Object3D[];

const DRAW: Partial<Record<string, Draw>> = {
  'lava-stream': (f, ground, time) => lavaStream(f.def as LavaStreamDef, ground, time),
};

/** Everything the track's features draw; `update` runs their animation. */
export function drawFeatures(track: Track): { objects: Object3D[]; update(t: number): void } {
  const ground = track.ground;
  const time = { value: 0 };
  const objects = ground ? ground.features.flatMap((f) => DRAW[f.kind]?.(f, ground, time) ?? []) : [];
  return {
    objects,
    update(t) {
      time.value = t;
    },
  };
}

/** The ribbon's vertices are this far apart along it (m). */
const RIBBON_STEP = 3;
/** A glow over it this often (m). */
const GLOW_EVERY = 18;

/**
 * A lava stream: molten rock filling its channel, LAVA_FILL m over the floor and level across it
 * (out LAVA_EDGE m past the floor, to meet the banks: where the sim's lava is too), narrow at its source, scrolling down the path,
 * with a glow along it.
 */
function lavaStream(f: LavaStreamDef, ground: Ground, time: { value: number }): Object3D[] {
  // The path, every RIBBON_STEP m.
  const pts: [number, number][] = [];
  for (let k = 0; k < f.path.length - 1; k++) {
    const [ax, az] = f.path[k];
    const [bx, bz] = f.path[k + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / RIBBON_STEP));
    for (let j = 0; j < n; j++) pts.push([ax + ((bx - ax) * j) / n, az + ((bz - az) * j) / n]);
  }
  pts.push(f.path[f.path.length - 1]);
  const half = f.width / 2 + LAVA_EDGE;
  let total = 0;
  for (let k = 1; k < pts.length; k++) total += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const glow: number[] = [];
  let along = 0;
  let lastGlow = -Infinity;
  for (let k = 0; k < pts.length; k++) {
    const [x, z] = pts[k];
    const [px, pz] = pts[Math.max(0, k - 1)];
    const [qx, qz] = pts[Math.min(pts.length - 1, k + 1)];
    const l = Math.hypot(qx - px, qz - pz) || 1;
    const nx = -(qz - pz) / l;
    const nz = (qx - px) / l;
    if (k) along += Math.hypot(x - pts[k - 1][0], z - pts[k - 1][1]);
    // Level across, at the floor's height in the middle (into the sea: at the sea).
    const y = Math.max(ground.height(x, z), (ground.sea ?? -Infinity) - LAVA_FILL) + LAVA_FILL;
    // (Narrow where it comes out of the ground, as the channel is shallow there.)
    const w = half * Math.max(0.15, lavaSource(along));
    for (const side of [-1, 1]) {
      pos.push(x + nx * w * side, y, z + nz * w * side);
      uv.push(side < 0 ? 0 : 1, along / total);
    }
    if (k < pts.length - 1) idx.push(k * 2, k * 2 + 1, k * 2 + 3, k * 2, k * 2 + 3, k * 2 + 2);
    if (along - lastGlow >= GLOW_EVERY) {
      glow.push(x, y + 2, z);
      lastGlow = along;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const mesh = new Mesh(g, lavaMaterial(time));
  mesh.name = 'lava-stream';
  return [mesh, glowPoints(glow, 0xff5a14, 14)];
}
