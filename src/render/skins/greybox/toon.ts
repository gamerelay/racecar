// The prototype's cel look for the greybox: a three-step toon ramp for every lit surface, and a
// shared radial glow texture for lamps, lights and underglow. The ink outlines are drawn in the
// post pass from depth (render/post.ts), so instanced and merged meshes get them for free.

import { type BufferGeometry, CanvasTexture, DataTexture, MeshToonMaterial, NearestFilter, RGBAFormat, type MeshToonMaterialParameters } from 'three';

let ramp: DataTexture | undefined;

/** Shadow, mid, lit: the prototype's [80, 165, 255] ramp. */
function gradient(): DataTexture {
  if (ramp) return ramp;
  const steps = [80, 165, 255];
  const d = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => {
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  });
  ramp = new DataTexture(d, steps.length, 1, RGBAFormat);
  ramp.minFilter = ramp.magFilter = NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

export function toon(params: MeshToonMaterialParameters = {}): MeshToonMaterial {
  return new MeshToonMaterial({ gradientMap: gradient(), ...params });
}

let glowTex: CanvasTexture | undefined;

export function glow(): CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.22, 'rgba(255,255,255,.55)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return (glowTex = new CanvasTexture(c));
}

/** Flat facets for a smooth primitive (cones, cylinders), so the ramp bands per face. */
export function faceted<T extends BufferGeometry>(geo: T): BufferGeometry {
  const g = geo.toNonIndexed();
  g.computeVertexNormals();
  geo.dispose();
  return g;
}
