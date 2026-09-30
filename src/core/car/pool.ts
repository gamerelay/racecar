// Every car's state, struct-of-arrays (SPEC §2, "Data layout"). A car is an index. Fixed capacity,
// typed arrays, so the tick never allocates and a snapshot is a copy of each array.

export const CAR_FIELDS = [
  // pose and motion
  'x', 'y', 'z', 'vx', 'vy', 'vz', 'h', 'yaw', 'pitch', 'roll',
  // last tick's pose, for render interpolation
  'px', 'py', 'pz', 'ph', 'ppitch', 'proll', 'prx', 'prz',
  // driving
  'grounded', 'airT', 'boost', 'boosting', 'miniT', 'miniStage',
  'drift', 'driftDir', 'driftT', 'driftCharge', 'driftStage', 'slip', 'driftCooldown',
  'spinT', 'ghostT', 'resetCooldown', 'wallT', 'stuckT', 'oncomingT', 'startPress', 'stallT',
  // wreck body
  'wreck', 'wreckT', 'rx', 'rz', 'wx', 'wy', 'wz',
  // where on the track
  'spline', 's', 'lateral', 'surface', 'junctionFree', 'lastSpline', 'lastS', 'lastLat',
  // race
  'lap', 'nextCp', 'progress', 'lapStartTick', 'bestLap', 'lastLap', 'score', 'driftChain', 'chainT', 'lastHitBy', 'lastHitT',
  'finished', 'finishTime', 'place', 'takedowns', 'wrecks', 'lastTakenBy',
  // AI: the lateral line it has committed to round something, and for how long (s).
  'aiLat', 'aiHold',
  // identity
  'active', 'cls', 'paint', 'human',
] as const;

export type CarField = (typeof CAR_FIELDS)[number];

export type CarPool = { readonly capacity: number; count: number } & { [K in CarField]: Float64Array };

export function createCarPool(capacity: number): CarPool {
  const pool = { capacity, count: 0 } as CarPool;
  for (const f of CAR_FIELDS) (pool as Record<string, unknown>)[f] = new Float64Array(capacity);
  return pool;
}

export function snapshotCars(pool: CarPool): Record<CarField, number[]> & { count: number } {
  const out = { count: pool.count } as Record<CarField, number[]> & { count: number };
  for (const f of CAR_FIELDS) out[f] = Array.from(pool[f].subarray(0, pool.count));
  return out;
}

export function restoreCars(pool: CarPool, snap: Record<CarField, number[]> & { count: number }): void {
  pool.count = snap.count;
  for (const f of CAR_FIELDS) {
    pool[f].fill(0);
    pool[f].set(snap[f] ?? []);
  }
}
