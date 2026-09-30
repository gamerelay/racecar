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
  /** The scene has standing water (a river) that mirrors in any weather. */
  water?: boolean;
  /** How high the cover over this ground is (a tunnel roof, a bridge deck), or -Infinity under open sky. */
  roof?(x: number, z: number): number;
  dispose(): void;
}

/** Traffic, hazards, weather: everything the world systems put on screen. */
export interface WorldVisual {
  /** `time` is the sim time being drawn (between the last two ticks, like the cars). */
  update(dt: number, camera: Vector3, time: number): void;
  dispose(): void;
}

/** A car's license plate: its lettering, the region printed across the top, and the map it's from. */
export interface CarPlate {
  text: string;
  region: string;
  map: string;
}

export interface Skin {
  id: string;
  /** Ink color for the post pass's outlines, once environment() has run. */
  ink?: number;
  /** The map's color grade in the post pass (none: as rendered). */
  grade?: Grade;
  /** Sky, fog, lights. Called again on the same scene for another palette, it replaces them. */
  environment(scene: Scene, palette: string): void;
  track(track: Track, seed: number): TrackVisual;
  /** `plate`: what its license plates say, and the map's region and id for their look. */
  car(cls: CarClass, paint: PaintDef, plate?: CarPlate): CarVisual;
  /** `track` is this track's visual, for what it covers (rain stops under a roof). */
  world(scene: Scene, sim: Sim, track?: TrackVisual): WorldVisual;
  /** Per frame, for animated skies and the like. */
  update?(time: number, cameraX: number, cameraY: number, cameraZ: number, wetness: number): void;
}

/** A map's look in the post pass: saturation and contrast (1: as rendered), a tint multiplied into the shadows, and the vignette's strength (0.5 by default). */
export interface Grade {
  saturation: number;
  contrast: number;
  shadow: number;
  vignette: number;
}
