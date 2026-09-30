// The Skin interface (SPEC §6): everything about how the world looks, and nothing about how it
// plays. Greybox is the default; the neon City skin comes in milestone 3b. A skin gets baked
// track data and car classes and returns Three.js objects; it can't change colliders or timings.

import type { Object3D, Scene, Vector3 } from 'three';
import type { CarClass, PaintDef } from '../core/content';
import type { Sim } from '../core/sim';
import type { Track } from '../core/track/bake';

export interface CarVisual {
  root: Object3D;
  /** Per frame: wheel spin (radians), front wheel steer, light states, and whether it's on the road (not airborne or wrecked). */
  update(wheelSpin: number, steer: number, braking: boolean, boosting: boolean, onRoad: boolean): void;
  dispose(): void;
}

export interface TrackVisual {
  /** One object per chunk, for culling; the scene adds them all. */
  chunks: Object3D[];
  /** Everything else (scenery, ground), culled by Three's frustum test. */
  extras: Object3D[];
  /** Debug volumes (checkpoints, gaps, branch starts); toggled from the HUD. */
  debug: Object3D;
  dispose(): void;
}

/** Traffic, hazards, weather: everything the world systems put on screen. */
export interface WorldVisual {
  update(dt: number, camera: Vector3): void;
}

export interface Skin {
  id: string;
  /** Ink color for the post pass's outlines, once environment() has run. */
  ink?: number;
  /** Sky, fog, lights. Called once per scene. */
  environment(scene: Scene, palette: string): void;
  track(track: Track, seed: number): TrackVisual;
  car(cls: CarClass, paint: PaintDef): CarVisual;
  world(scene: Scene, sim: Sim): WorldVisual;
  /** Per frame, for animated skies and the like. */
  update?(time: number, cameraX: number, cameraY: number, cameraZ: number, wetness: number): void;
}
