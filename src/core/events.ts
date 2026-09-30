// The per-tick event queue (SPEC §2). The sim pushes; render, audio, HUD, net and telemetry each
// read from their own cursor after the frame. Events are preallocated records reused in a ring,
// so pushing never allocates.

export const Ev = {
  WallHit: 1,
  CarContact: 2,
  Wreck: 3,
  Respawn: 4,
  DriftStart: 5,
  DriftEnd: 6,
  MiniTurbo: 7,
  BoostStart: 8,
  BoostEnd: 9,
  Takeoff: 10,
  Land: 11,
  Checkpoint: 12,
  Lap: 13,
  SpinOut: 14,
  DriftStage: 15,
} as const;
export type Ev = (typeof Ev)[keyof typeof Ev];

export const EV_NAMES: Record<number, string> = {
  1: 'wall_hit',
  2: 'car_contact',
  3: 'wreck',
  4: 'respawn',
  5: 'drift_start',
  6: 'drift_end',
  7: 'mini_turbo',
  8: 'boost_start',
  9: 'boost_end',
  10: 'takeoff',
  11: 'land',
  12: 'checkpoint',
  13: 'lap',
  14: 'spin_out',
  15: 'drift_stage',
};

/** Wreck causes, in `GameEvent.b` of a Wreck. */
export const Cause = { Wall: 1, Car: 2, OutOfBounds: 3, Reset: 4, SpinOut: 5 } as const;

/**
 * One event. Fields are generic so the record can be reused; each type documents what it puts
 * where. `car` is the car index; `other` a second car (or -1); `x, y, z` a world position; `a`, `b`
 * numbers (a speed, a stage, a lap time…).
 */
export interface GameEvent {
  seq: number;
  tick: number;
  type: Ev;
  car: number;
  other: number;
  x: number;
  y: number;
  z: number;
  a: number;
  b: number;
}

export class EventQueue {
  readonly capacity: number;
  private readonly ring: GameEvent[];
  /** Sequence number of the next event pushed. Readers keep the last seq they saw. */
  head = 0;

  constructor(capacity = 1024) {
    this.capacity = capacity;
    this.ring = Array.from({ length: capacity }, () => ({ seq: -1, tick: 0, type: Ev.WallHit as Ev, car: -1, other: -1, x: 0, y: 0, z: 0, a: 0, b: 0 }));
  }

  push(tick: number, type: Ev, car: number, x = 0, y = 0, z = 0, a = 0, b = 0, other = -1): GameEvent {
    const e = this.ring[this.head % this.capacity];
    e.seq = this.head++;
    e.tick = tick;
    e.type = type;
    e.car = car;
    e.other = other;
    e.x = x;
    e.y = y;
    e.z = z;
    e.a = a;
    e.b = b;
    return e;
  }

  /** Calls `fn` for every event after `cursor`, oldest first, and returns the new cursor. Events that fell out of the ring are skipped. */
  read(cursor: number, fn: (e: GameEvent) => void): number {
    const from = Math.max(cursor, this.head - this.capacity);
    for (let s = from; s < this.head; s++) fn(this.ring[s % this.capacity]);
    return this.head;
  }
}
