// Where the chase camera sits for a car, by its size (pure, so it's tested for every class): tight
// and low behind the car, with only a little pull-back with speed and boost (playtest: it stretched
// too far, then wanted closer still for immersion). Taller and longer cars sit it higher and further
// back so the roof doesn't fill the screen; very long ones (the bus) look further ahead over it.
// The coupe (0.65 m half height, 2.15 m half length) is the base.

import type { Vec3 } from '../core/content';
import { DECK_CATCH, type Ground } from '../core/track/ground';

export interface ChaseOffset {
  /** Meters behind the car's center, and above its base. */
  dist: number;
  height: number;
  /** The look point: meters ahead of the center, and above the base. */
  ahead: number;
  lookUp: number;
}

export function chaseOffset(size: Vec3, speed = 0, boost = 0, out: ChaseOffset = { dist: 0, height: 0, ahead: 0, lookUp: 0 }): ChaseOffset {
  const tall = Math.max(0, size[2] - 0.65);
  const long = Math.max(0, size[1] - 2.5);
  out.dist = 4.7 + boost * 0.5 + speed * 0.005 + Math.max(0, size[1] - 2.15) * 1.4 + tall * 1.5;
  out.height = 1.85 + tall * 2.2 + long * 0.35 - boost * 0.12;
  out.ahead = 11 + long * 2;
  out.lookUp = 1 + long * 0.2;
  return out;
}

/** Looking back: in front of the nose (the coupe's 5 m from center), high enough to see over the roof. */
export function lookBackOffset(size: Vec3, out: ChaseOffset = { dist: 0, height: 0, ahead: 0, lookUp: 0 }): ChaseOffset {
  const tall = Math.max(0, size[2] - 0.65);
  out.dist = size[1] + 2.85;
  out.height = 2.4 + tall * 2.2 + Math.max(0, size[1] - 2.5) * 0.35;
  out.ahead = 20;
  out.lookUp = 1;
  return out;
}

/**
 * On open ground (docs/AVALANCHE.md), the camera follows the slope: `rise` is how far the ground
 * ahead (smoothed) is above the ground under the car, negative downhill. The look point goes with
 * it, so a steep pitch looks steep and a crest hides what's past it, and uphill the camera lifts a
 * little to see over the top. Maps without open ground keep the level camera.
 */
export function slopeView(rise: number): { look: number; lift: number } {
  return { look: rise * 0.6, lift: Math.min(2.5, Math.max(0, rise * 0.25)) };
}

/** On a deck, the camera reads the deck's plane this far (m) past its edges. */
const DECK_LOOK = 40;

/**
 * The rise `slopeView` takes: the ground `ahead` m and twice that along (fx, fz) from a car at
 * (x, y, z), over the ground under it. On a deck it's the deck's own plane, carried out past its
 * edges: swerving near the edge looks off it, and the bay 18 m down tipped the view. On the road
 * leading onto one, the deck ahead counts even where it climbs more than DECK_CATCH above the car
 * (the camera dipped at the bay floor the moment a car got on the ramp); under one, the ground does.
 */
export function slopeRise(g: Ground, x: number, y: number, z: number, fx: number, fz: number, ahead: number): number {
  const on = g.deckUnder(x, z, y);
  const over = g.deck(x, z);
  const under = !(on === on) && over === over && over > y + DECK_CATCH && g.height(x, z) <= y + DECK_CATCH;
  const at = (k: number) => {
    const px = x + fx * k;
    const pz = z + fz * k;
    if (under) return g.height(px, pz);
    // What's ahead is what's at or below a little over the car, more the further ahead (a ramp
    // climbs), so a deck up ahead counts but the slope over a tunnel doesn't.
    const reach = (on === on ? on : y) + 2 + 0.15 * k;
    if (on === on) {
      const v = g.deck(px, pz, DECK_LOOK, reach);
      if (v === v) return v;
    }
    return g.top(px, pz, reach);
  };
  return (at(ahead) + at(ahead * 2)) / 2 - g.top(x, z, y);
}

/** On open ground the camera stays this far above the snow under it (behind a car on a steep pitch, it would be in the slope). */
export const GROUND_CLEAR = 1.2;
