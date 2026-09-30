// Fading instanced meshes: a see-through copy of a material whose opacity is an `aFade` instance
// attribute (0–1), so a traffic car can dissolve in or out of its lane instead of popping. The copy
// doesn't write depth, so the post pass's depth outlines leave a fading car alone (a screen-door
// dither would ink every pixel edge). Used by greybox world.ts for core/world/traffic.ts's visibility.

import { FrontSide, InstancedBufferAttribute, type Material } from 'three';

export const FADE_ATTR = 'aFade';

function inject(shader: { vertexShader: string; fragmentShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\nattribute float ${FADE_ATTR};varying float vFade;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\nvFade=${FADE_ATTR};`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vFade;')
    .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a*=vFade;');
}

/**
 * A fading copy of `src`: its look (its own shader patch runs first), blended by the instance's
 * fade, front faces only so a see-through body doesn't show its far side. One copy per source.
 */
export function fadeMaterial(src: Material, cache: Map<Material, Material>): Material {
  let m = cache.get(src);
  if (m) return m;
  m = src.clone();
  m.transparent = true;
  m.depthWrite = false;
  m.side = FrontSide;
  m.onBeforeCompile = (shader, renderer) => {
    src.onBeforeCompile(shader, renderer);
    inject(shader);
  };
  m.customProgramCacheKey = () => `${src.customProgramCacheKey()}|fade`;
  cache.set(src, m);
  return m;
}

/** The per-instance fade attribute for `count` instances. */
export const fadeAttribute = (count: number): InstancedBufferAttribute => new InstancedBufferAttribute(new Float32Array(count), 1);
