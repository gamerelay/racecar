// The sim's shared state, as the systems see it. Kept separate from sim.ts so systems can import
// the type without importing the pipeline.

import type { CarPool } from './car/pool';
import type { CarClass, SurfaceDef } from './content';
import type { EventQueue } from './events';
import type { Rng } from './rng';
import type { Track } from './track/bake';
import type { TrackHit } from './track/query';
import type { Hazards } from './world/hazards';
import type { Traffic } from './world/traffic';

export interface RaceState {
  phase: 'free' | 'countdown' | 'racing';
  /** World time the lights go green. */
  goTime: number;
  laps: number;
  finishedCount: number;
}

export interface SimState {
  track: Track;
  cars: CarPool;
  classes: CarClass[];
  surfaces: SurfaceDef[];
  events: EventQueue;
  tick: number;
  /** Seconds per tick (1/60), before time scaling. */
  dt: number;
  /** Whole-world time scale (single-player slow-mo). */
  timeScale: number;
  /** 'world': a wreck slows everything (single player). 'wreck': only the wreck body slows (online). */
  slowmo: 'world' | 'wreck';
  seed: number;
  rng: Rng;
  /** World seconds since the sim started (slows with single-player slow-mo). D-systems read this. */
  time: number;
  weatherGrip: number;
  wet: boolean;
  wetness: number;
  world?: { traffic: Traffic; hazards: Hazards };
  race: RaceState;
  /** Surface index used beyond the road edge. */
  readonly shoulderSurface: number;
  /** Scratch track hits, reused every tick. */
  hitA: TrackHit;
  hitB: TrackHit;
}
