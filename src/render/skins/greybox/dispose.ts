// Freeing what a build made on the GPU: geometries, materials, their maps, and instanced meshes'
// instance buffers. Things shared across builds (the traffic models, the cars' common materials, the glow sprite)
// are skipped.

import type { InstancedMesh, Mesh, MeshBasicMaterial, Object3D } from 'three';
import { sharedCarResources } from './car/build';
import { trafficModels } from './car/traffic';
import { glow } from './toon';

/** What every greybox build shares and must not free. */
export function sharedResources(): Set<unknown> {
  const models = trafficModels();
  return new Set<unknown>([...Object.values(models.geos), models.material, glow(), ...sharedCarResources()]);
}

export function disposeTree(roots: Object3D[], shared = sharedResources()): void {
  for (const root of roots) {
    root.traverse((o) => {
      if ((o as InstancedMesh).isInstancedMesh) (o as InstancedMesh).dispose();
      const m = o as Mesh;
      if (m.geometry && !shared.has(m.geometry)) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        if (shared.has(mat)) continue;
        const map = (mat as MeshBasicMaterial).map;
        if (map && !shared.has(map)) map.dispose();
        mat.dispose();
      }
    });
  }
}
