// Fading instanced meshes: a see-through copy of a material whose opacity is an `aFade` instance
// attribute (0–1), so a traffic car can dissolve in or out of its lane instead of popping. The copy
// doesn't write depth, so the post pass's depth outlines leave a fading car alone (a screen-door
// dither would ink every pixel edge). Used by greybox world.ts for core/world/traffic.ts's visibility.

import { FrontSide, InstancedBufferAttribute, type Material } from 'three';

export const FADE_ATTR = 'aFade';

/** Where the fade goes in three's built-in shaders. Missing one throws: a silent miss would bring the pops back. */
const HOOKS: [stage: 'vertexShader' | 'fragmentShader', chunk: string, add: string][] = [
  ['vertexShader', '#include <common>', `attribute float ${FADE_ATTR};varying float vFade;`],
  ['vertexShader', '#include <begin_vertex>', `vFade=${FADE_ATTR};`],
  ['fragmentShader', '#include <common>', 'varying float vFade;'],
  ['fragmentShader', '#include <dithering_fragment>', 'gl_FragColor.a*=vFade;'],
];

export function injectFade(shader: { vertexShader: string; fragmentShader: string }): void {
  for (const [stage, chunk, add] of HOOKS) {
    if (!shader[stage].includes(chunk)) throw new Error(`fade: ${stage} has no ${chunk}`);
    shader[stage] = shader[stage].replace(chunk, `${chunk}\n${add}`);
  }
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
    injectFade(shader);
  };
  m.customProgramCacheKey = () => `${src.customProgramCacheKey()}|fade`;
  cache.set(src, m);
  return m;
}

/** The per-instance fade attribute for `count` instances. */
export const fadeAttribute = (count: number): InstancedBufferAttribute => new InstancedBufferAttribute(new Float32Array(count), 1);
