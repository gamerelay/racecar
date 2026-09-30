// The sound model (SPEC §13), pure so it can be tested without Web Audio: each car's engine voice
// (a fake gearbox turning speed into revs), where a sound sits relative to the listener (pan and
// distance falloff), and the Doppler shift of something passing by. Presentation only: the sim
// never hears any of it.

import { clamp } from '../core/math';

/** How a class sounds. `pitch` scales the whole engine, `growl` the sub and fifth under it. */
export interface EngineSound {
  pitch: number;
  growl: number;
  gears: number;
}

/** By class id; unknown classes get the coupe's. */
export const ENGINE_SOUNDS: Record<string, EngineSound> = {
  coupe: { pitch: 1.1, growl: 0.5, gears: 6 },
  muscle: { pitch: 0.78, growl: 1, gears: 5 },
  hatch: { pitch: 1.3, growl: 0.3, gears: 5 },
  van: { pitch: 0.85, growl: 0.6, gears: 5 },
  sedan: { pitch: 1, growl: 0.45, gears: 5 },
  rally: { pitch: 1.2, growl: 0.7, gears: 6 },
  bus: { pitch: 0.55, growl: 0.9, gears: 4 },
};
export const engineSound = (id: string): EngineSound => ENGINE_SOUNDS[id] ?? ENGINE_SOUNDS.coupe;

export interface Gear {
  /** 0-based gear. */
  gear: number;
  /** Revs, 0 (idle) to 1 (the limiter); a little past 1 above top speed or with the wheels free. */
  rpm: number;
}

/**
 * Speed (m/s) to gear and revs for a car with top speed `top`. Gears get longer as they go up
 * (edges at (g/gears)^0.8 of top speed); revs climb through each and drop at the shift.
 */
export function gearbox(speed: number, top: number, gears: number, out: Gear = { gear: 0, rpm: 0 }): Gear {
  const v = Math.max(0, speed);
  const edge = (g: number) => top * ((g + 1) / gears) ** 0.8;
  let g = 0;
  while (g < gears - 1 && v >= edge(g)) g++;
  const lo = g === 0 ? 0 : edge(g - 1);
  const t = (v - lo) / (edge(g) - lo);
  // First gear starts from idle; the others pick up where the shift drops the revs.
  out.gear = g;
  out.rpm = clamp(g === 0 ? 0.12 + 0.88 * t : 0.45 + 0.55 * t, 0, 1.1);
  return out;
}

/** Engine fundamental in Hz for revs 0–1: idle burble to a howl, scaled by the class. */
export const engineHz = (rpm: number, s: EngineSound): number => (34 + rpm * 150) * s.pitch;

export interface Spatial {
  /** -1 (left) to 1 (right). */
  pan: number;
  /** 0–1. */
  gain: number;
}

/**
 * Where a sound at offset (dx, dz) from the listener sits, for a listener facing (fx, fz)
 * (normalized): pan from how far right it is, gain falling off past `ref` meters.
 */
export function spatial(dx: number, dz: number, fx: number, fz: number, ref = 12, out: Spatial = { pan: 0, gain: 1 }): Spatial {
  const d = Math.hypot(dx, dz);
  // The listener's right is (-fz, fx) (the game's heading convention).
  out.pan = d < 1e-3 ? 0 : clamp(((dx * -fz + dz * fx) / d) * Math.min(1, d / 4), -1, 1);
  out.gain = 1 / (1 + (d / ref) ** 2);
  return out;
}

/** Speed of sound, m/s; a bit slow, so passes are audible at game speeds. */
const SOUND = 300;

/**
 * Doppler pitch factor for a source at offset (dx, dz) moving at (svx, svz) relative to a
 * listener moving at (lvx, lvz): above 1 closing, below 1 going away, clamped to a sane range.
 */
export function doppler(dx: number, dz: number, svx: number, svz: number, lvx: number, lvz: number): number {
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) return 1;
  // Closing speed along the line between them (positive when getting closer).
  const closing = -((svx - lvx) * dx + (svz - lvz) * dz) / d;
  return clamp(SOUND / (SOUND - clamp(closing, -SOUND * 0.5, SOUND * 0.5)), 0.7, 1.4);
}
