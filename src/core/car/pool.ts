// Every car's state, struct-of-arrays (SPEC §2, "Data layout"). A car is an index. Fixed capacity,
// typed arrays, so the tick never allocates and a snapshot is a copy of each array.

export const CAR_FIELDS = [
  // pose and motion
  'x', 'y', 'z', 'vx', 'vy', 'vz', 'h', 'yaw', 'pitch', 'roll',
  // last tick's pose, for render interpolation
  'px', 'py', 'pz', 'ph', 'ppitch', 'proll', 'prx', 'prz',
  // driving
  'grounded', 'airT', 'superT', 'boost', 'boosting', 'miniT', 'miniStage',
  'drift', 'driftDir', 'driftT', 'driftCharge', 'driftStage', 'slip', 'driftCooldown', 'driftTight', 'driftExit', 'driftBank',
  'spinT', 'ghostT', 'resetCooldown', 'wallT', 'stuckT', 'oncomingT', 'startPress', 'stallT',
  // the slipstream (0..1, and seconds in it), a slingshot's seconds left, and the straight-line build past top speed (0..1, and 1 once it's popped)
  'draft', 'draftT', 'slingT', 'cruise', 'cruiseFull',
  // wreck body
  'wreck', 'wreckT', 'wreckCause', 'rx', 'rz', 'wx', 'wy', 'wz',
  // where on the track
  'spline', 's', 'lateral', 'surface', 'junctionFree', 'lastSpline', 'lastS', 'lastLat',
  // race
  'lap', 'nextCp', 'progress', 'lapStartTime', 'bestLap', 'lastLap', 'score', 'driftChain', 'chainT', 'chainPts', 'lastHitBy', 'lastHitT',
  'finished', 'finishTime', 'place', 'takedowns', 'wrecks', 'lastTakenBy',
  // race position right now, 0 = leading (updated at the end of each tick)
  'rank',
  // AI: the lateral line it has committed to round something, and for how long (s); backing out
  // when pinned (s left, or negative: s until it may try again); the branch it's merging off (its
  // spline, till it's past where it rejoins; 0 none).
  'aiLat', 'aiHold', 'aiBack', 'aiMerge',
  // identity: `remote` is another player's car online, which follows the pose it's given (net/cars.ts)
  'active', 'cls', 'paint', 'human', 'remote',
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
