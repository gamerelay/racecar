// The Skin interface (SPEC §6): everything about how the world looks, and nothing about how it
// plays. Greybox is the default; the neon City skin comes in milestone 3b. A skin gets baked
// track data and car classes and returns Three.js objects; it can't change colliders or timings.

import type { Object3D, Scene, Vector3 } from 'three';
import type { CarClass, PaintDef } from '../core/content';
import type { Sim } from '../core/sim';
import type { Track } from '../core/track/bake';

export interface CarVisual {
  root: Object3D;
  /** Per frame: wheel spin (radians), front wheel steer, light states, whether it's on the road (not airborne or wrecked), and sim-time seconds since the last frame. */
  update(wheelSpin: number, steer: number, braking: boolean, boosting: boolean, onRoad: boolean, dt?: number): void;
  /** Wrecked: `dx, dz` point from the car's center toward the impact, in the car's frame; strength 0–1. Cosmetic only. */
  wreck?(dx: number, dz: number, strength: number): void;
  /** Respawned: undo whatever `wreck` did. */
  repair?(): void;
  dispose(): void;
}

export interface TrackVisual {
  /** One object per chunk, for culling; the scene adds them all. */
  chunks: Object3D[];
  /** Everything else (scenery, ground), culled by Three's frustum test. */
  extras: Object3D[];
  /** Debug volumes (checkpoints, gaps, branch starts); toggled from the HUD. */
  debug: Object3D;
  /** Per frame, for animated scenery (seconds since start, seconds since last frame). */
  update?(time: number, dt: number, camera: Vector3): void;
  dispose(): void;
}

/** Traffic, hazards, weather: everything the world systems put on screen. */
export interface WorldVisual {
  /** `time` is the sim time being drawn (between the last two ticks, like the cars). */
  update(dt: number, camera: Vector3, time: number): void;
  dispose(): void;
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
