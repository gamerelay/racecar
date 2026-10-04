// Where the chase camera sits for a car, by its size (pure, so it's tested for every class): tight
// and low behind the car, with only a little pull-back with speed and boost (playtest: it stretched
// too far, then wanted closer still for immersion). Taller and longer cars sit it higher and further
// back so the roof doesn't fill the screen; very long ones (the bus) look further ahead over it.
// The coupe (0.65 m half height, 2.15 m half length) is the base.

import type { Vec3 } from '../core/content';
import type { BakedProp } from '../core/track/bake';
import { DECK_CATCH, newCast, type Cast, type Ground, type Piece } from '../core/track/ground';

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
  const c = g.cast(x, y, z, CAST);
  const on = c.piece >= 0 ? c.floor : NaN;
  const below = c.floor;
  const over = g.pieceFloor(x, z);
  const under = !(on === on) && over === over && over > y + DECK_CATCH && c.ground <= y + DECK_CATCH;
  const at = (k: number) => {
    const px = x + fx * k;
    const pz = z + fz * k;
    if (under) return g.height(px, pz);
    // On a deck, its road ahead (at or below a little over the car, more the further ahead: a ramp
    // climbs), not the slope over a tunnel. On the ground, the ground ahead, or a deck up ahead
    // above it (a bridge's ramp), never a tunnel's road down under a slope.
    const reach = (on === on ? on : y) + 2 + 0.15 * k;
    if (on === on) {
      const v = g.pieceFloor(px, pz, DECK_LOOK, reach);
      if (v === v) return v;
      // Off its end over a drop (the Lava Tube's jump): its level, across to the far side, not
      // down into the lava as you line the jump up.
      if (g.height(px, pz) < on - 3) return on;
    }
    const gh = g.height(px, pz);
    const d = g.pieceFloor(px, pz, 0, reach);
    if (d === d && d >= gh) return d;
    // A tunnel's road ahead, nearer the car than the slope over it is: into a tunnel's mouth, or up
    // one steeper than `reach` allows (the Lava Tube's climb out read the volcano over its roof, and
    // the view tipped up at the rock 15 m over the road).
    const base = on === on ? on : y;
    const t = g.pieceFloor(px, pz, on === on ? DECK_LOOK : 0);
    return t === t && Math.abs(t - base) < Math.abs(gh - base) ? t : gh;
  };
  return (at(ahead) + at(ahead * 2)) / 2 - below;
}

/** Scratch for the camera's casts. */
const CAST = newCast();

/** The camera keeps this far (m) under an enclosed piece's ceiling. */
const UNDER_CEILING = 1;

/**
 * What the camera at (x, y, z) keeps GROUND_CLEAR above: an enclosed piece's floor while it's under
 * the ceiling (in the Lava Tube's space, its road), else what's under it. At a tunnel's mouth the
 * slope rises off the road just over the camera, and lifted clear of that it rode the slope up, 7 m
 * over the car, as the car went in.
 */
export function cameraFloor(g: Ground, x: number, y: number, z: number): number {
  const c = g.cast(x, y, z, CAST);
  return y < c.ceiling - UNDER_CEILING ? c.over : c.floor;
}

/**
 * The highest the chase camera may sit over (x, z) for a car at `carY`: under the ceiling of an
 * enclosed piece the car's in there, by UNDER_CEILING; else no limit. (Lifted for a slope ahead, it
 * would otherwise rise into a low roof and clearView would then pull it in to the car.)
 */
export function cameraCeiling(g: Ground, x: number, carY: number, z: number): number {
  const c = g.cast(x, carY + 1, z, CAST);
  return c.space === 'enclosed' && covered(g, c, carY + 1) ? c.ceiling - UNDER_CEILING : Infinity;
}

/**
 * Whether what's over an enclosed piece at height `y` is a roof: the rock over a tunnel, or a
 * building's own (it stands on the ground: nothing's over it but its roof).
 */
function covered(g: Ground, c: Cast, y: number): boolean {
  return c.ground > y || (c.room >= 0 && g.pieces.list[c.room].building !== '');
}

/**
 * The enclosed piece the camera at (x, y, z) is inside (over its floor, under its ceiling, with the
 * rock or a building's roof over it), or null: what's lit and heard as indoors. (An enclosed piece
 * runs on out over the open shaft as a bridge, under the sky: that's outdoors.)
 */
export function indoorAt(g: Ground, x: number, y: number, z: number): Piece | null {
  const c = g.cast(x, y, z, CAST);
  return c.room >= 0 && covered(g, c, y) ? g.pieces.list[c.room] : null;
}

/** Whether (x, y, z) is in the rock: under the ground and in no piece (the wreck camera's orbit, out through a tube's wall). */
export function inRock(g: Ground, x: number, y: number, z: number): boolean {
  return g.cast(x, y, z, CAST).space === 'rock';
}

/** On open ground the camera stays this far above the snow under it (behind a car on a steep pitch, it would be in the slope). */
export const GROUND_CLEAR = 1.2;

/** A building's wall keeps the camera this far (m) off it. */
const OFF_WALL = 0.3;

/** Whether (x, y, z) is in one of `walls` (a building's: BakedProp boxes), or within OFF_WALL of it. */
function inWall(walls: readonly BakedProp[], x: number, y: number, z: number): boolean {
  for (const w of walls) {
    const dx = x - w.x;
    const dz = z - w.z;
    if (y < w.y - 1 || y > w.y + w.hy * 2 + OFF_WALL || Math.abs(dx) > w.hx + w.hz + 1 || Math.abs(dz) > w.hx + w.hz + 1) continue;
    // Its across (x) and along (z) axes: along = (sin h, cos h), across = (cos h, -sin h).
    const sh = Math.sin(w.heading);
    const ch = Math.cos(w.heading);
    if (Math.abs(dx * ch - dz * sh) < w.hx + OFF_WALL && Math.abs(dx * sh + dz * ch) < w.hz + OFF_WALL) return true;
  }
  return false;
}

/**
 * Keeps the chase camera at (x, y, z) in the open: from a little over the car at (cx, cy, cz) back
 * toward it, the camera stops short of the first point in the rock (under the ground and not
 * inside a tunnel's tube), so in a tunnel it stays in the tube. Behind a car turned in one, it sat
 * in the rock beside it and the ground clearance then lifted it out over the volcano: a black screen.
 * Likewise short of a building's wall (`walls`), in the hall or outside it.
 */
export function clearView(g: Ground, cx: number, cy: number, cz: number, cam: { x: number; y: number; z: number }, walls: readonly BakedProp[] = []): void {
  const y0 = cy + 1;
  const open = (x: number, y: number, z: number) => {
    if (walls.length && inWall(walls, x, y, z)) return false;
    if (g.height(x, z) < y - 0.3) return true;
    const c = g.cast(x, y, z, CAST);
    return c.space === 'enclosed' && y > c.over && y < c.ceiling - UNDER_CEILING;
  };
  const STEPS = 16;
  for (let k = 1; k <= STEPS; k++) {
    const t = k / STEPS;
    if (open(cx + (cam.x - cx) * t, y0 + (cam.y - y0) * t, cz + (cam.z - cz) * t)) continue;
    const back = (k - 1) / STEPS;
    cam.x = cx + (cam.x - cx) * back;
    cam.y = y0 + (cam.y - y0) * back;
    cam.z = cz + (cam.z - cz) * back;
    return;
  }
}
