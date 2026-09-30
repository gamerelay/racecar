// The contact shadow under a car: a dark plane stuck to the floor pan. On its wheels it sits on the
// road; tipped over or in the air it'd be a black slab hanging off the car, so it fades out.

/** Its opacity on its wheels. */
export const SHADOW = 0.4;
/** How upright (the car's up vector's height, 1 = level) it must be to show: past ~30° it goes. */
const UPRIGHT = 0.85;

/**
 * The shadow's next opacity from `current`, for a car rotated by quaternion (qx, qz: the other
 * components don't tip it) and whether it's on the road. Eases over ~0.1 s of world time `dt`;
 * with no time passing (paused, or the first frame) it snaps.
 */
export function shadowOpacity(current: number, qx: number, qz: number, onRoad: boolean, dt: number): number {
  const upright = 1 - 2 * (qx * qx + qz * qz);
  const want = onRoad && upright > UPRIGHT ? SHADOW : 0;
  const k = dt > 0 ? Math.min(1, dt * 10) : 1;
  return current + (want - current) * k;
}
