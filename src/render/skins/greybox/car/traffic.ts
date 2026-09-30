// Traffic cars from the same designs as the racers, flattened for instancing: build the car once,
// merge every static mesh into one geometry per (material, ink id), and let world.ts draw each as
// an InstancedMesh. Nothing comes off and nothing crumples (a wrecked traffic car is cosmetic
// debris, category L), so the pieces are just more triangles. The body paint is white, tinted per
// instance; the band on a bus keeps its own color.

import { type BufferGeometry, type Material, Mesh } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PaintDef } from '../../../../core/content';
import { SEAM } from '../../../ink';
import { buildCar } from './build';
import { DESIGNS } from './designs';

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

/** A design's static meshes in the car frame, or undefined if the kind has no design (it stays a box). */
export function trafficModel(id: string, size: [number, number, number]): TrafficPart[] | undefined {
  if (!DESIGNS[id]) return undefined;
  const v = buildCar({ id, size }, PAINT);
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
    for (const name of Object.keys(flat.attributes)) if (name !== 'position' && name !== 'normal') flat.deleteAttribute(name);
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
