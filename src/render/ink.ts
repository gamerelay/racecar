// Ink for the things that deserve more than silhouettes: cars. The depth-based outline in the post
// pass only sees where depth jumps or kinks, so a window, a lamp or a hood seam on a flat panel
// never inks. This pass renders just the marked meshes (a layer of their own) with a flat shader
// that writes the view-space normal and a part id; the post pass then inks where the id changes
// (panel and part boundaries) and where the normal turns sharply (creases), on pixels where that
// mesh is what the main pass actually shows. Seam strips (id SEAM) exist only in this pass: they are
// ink drawn onto the body, for door cuts and panel gaps that have no geometry of their own.
//
// Cost: one extra draw per marked mesh, into an 8-bit target, only while ink is on.

import {
  Color,
  DepthTexture,
  DoubleSide,
  type Material,
  type Mesh,
  NoBlending,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  ShaderMaterial,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';

export const INK_LAYER = 2;
/** Part ids, 1–254; 0 is "nothing here". Anything with a different id from its neighbour gets a line. */
export const INK = { paint: 1, trim: 2, metal: 3, glass: 4, lens: 5, head: 6, tail: 7, plate: 8, hood: 9, trunk: 10, lip: 11, mirror: 12, wheel: 13, rim: 14, debris: 15, sign: 16, beacon: 17 } as const;
export const SEAM = 255;
/** This frame's near marked meshes: what the pass actually draws. */
const PASS_LAYER = 3;
const FAR = 90;

const marked = new Set<Mesh>();
const materials = new Map<number, ShaderMaterial>();

function inkMaterial(id: number): ShaderMaterial {
  let m = materials.get(id);
  if (m) return m;
  m = new ShaderMaterial({
    blending: NoBlending,
    side: DoubleSide,
    vertexShader: `#include <common>
      varying vec3 vN;
      void main(){
        #include <beginnormal_vertex>
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          objectNormal=mat3(instanceMatrix)*objectNormal;
        #endif
        vN=normalize(normalMatrix*objectNormal);
        #include <project_vertex>
      }`,
    fragmentShader: `varying vec3 vN;
      void main(){
        vec3 n=normalize(gl_FrontFacing?vN:-vN);
        gl_FragColor=vec4(n*0.5+0.5,${(id / 255).toFixed(6)});
      }`,
  });
  materials.set(id, m);
  return m;
}

/** Puts a mesh in the ink pass with a part id. `inkOnly` meshes (seams) are drawn nowhere else. */
export function markInk(mesh: Mesh, id: number, inkOnly = false): void {
  mesh.userData.ink = id;
  if (inkOnly) mesh.layers.set(INK_LAYER);
  else mesh.layers.enable(INK_LAYER);
  marked.add(mesh);
}

export function unmarkInk(root: Object3D): void {
  root.traverse((o) => marked.delete(o as Mesh));
}

export class InkPass {
  readonly target: WebGLRenderTarget;
  private readonly saved: Material[] = [];
  private readonly clear = new Color();

  constructor(width: number, height: number) {
    this.target = new WebGLRenderTarget(width, height);
    this.target.depthTexture = new DepthTexture(width, height);
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
  }

  /** This frame's meshes to ink (reused, so a frame doesn't allocate). */
  private readonly list: Mesh[] = [];

  render(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): void {
    // Car lines fade out by ~80 m (post.ts), so farther meshes are skipped rather than drawn for nothing.
    const cam = camera.position;
    const list = this.list;
    list.length = 0;
    for (const m of marked) {
      const e = m.matrixWorld.elements;
      // An instanced mesh (traffic, debris) sits at the world origin with its instances anywhere:
      // its owner says whether any are near (userData.inkNear), else it's inked.
      const near = (m as { isInstancedMesh?: boolean }).isInstancedMesh ? m.userData.inkNear !== false : (e[12] - cam.x) ** 2 + (e[13] - cam.y) ** 2 + (e[14] - cam.z) ** 2 < FAR * FAR;
      if (near) list.push(m);
    }
    this.saved.length = 0;
    for (const m of list) {
      this.saved.push(m.material as Material);
      m.material = inkMaterial(m.userData.ink as number);
      m.layers.enable(PASS_LAYER);
    }
    const layers = camera.layers.mask;
    const bg = scene.background;
    const fog = scene.fog;
    scene.background = null;
    scene.fog = null;
    camera.layers.set(PASS_LAYER);
    renderer.getClearColor(this.clear);
    const alpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setClearColor(this.clear, alpha);
    camera.layers.mask = layers;
    scene.background = bg;
    scene.fog = fog;
    for (let i = 0; i < list.length; i++) {
      list[i].material = this.saved[i];
      list[i].layers.disable(PASS_LAYER);
    }
  }
}
