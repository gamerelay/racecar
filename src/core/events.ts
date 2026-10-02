// The per-tick event queue (SPEC §2). The sim pushes; render, audio, HUD, net and telemetry each
// read from their own cursor after the frame. Events are preallocated records reused in a ring,
// so pushing never allocates.

export const Ev = {
  WallHit: 1,
  /** a = closing speed, other = the other car (-1 for traffic or a hazard), b = who attacked (`Contact`). */
  CarContact: 2,
  Wreck: 3,
  /** a = catch-up boost paid (0..1 of a bar). */
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
  /** a = gap (m), b = 1 if oncoming. */
  NearMiss: 16,
  /** Started driving in the oncoming lane (once per stint). */
  Oncoming: 17,
  /** Rammed a traffic car out of the way while boosting. other = traffic index. */
  TrafficCheck: 18,
  /** A hazard occurrence starts its telegraph. a = occurrence id, b = kind index. */
  Hazard: 19,
  /** car took down other. a = points, b = 1 if revenge. */
  Takedown: 20,
  /** The lights went green. */
  RaceStart: 21,
  /** car finished the race. a = race time, b = place. */
  Finish: 22,
  /** car got a start boost (b = 1) or stalled (b = 0). */
  StartBoost: 23,
  /** A traffic car was wrecked (by a car, a hazard or debris). other = traffic index. */
  TrafficWreck: 24,
  /** A clean drift paid its banked boost into the meter. a = amount (0..1 of a bar). */
  DriftBoost: 25,
  /** A drift chain (two drifts or more, each started within chainWindow of the last) ran out cleanly. a = its points, b = drifts in it. */
  DriftChain: 26,
  /** A chain was broken (a spin-out, a wreck, a wall) before it paid. b = drifts it had. */
  ChainLost: 27,
  /** A clean landing paid for the air time. a = boost paid (0..1 of a bar), b = seconds in the air, other = 1 for a Superman (boosted through it). */
  AirBoost: 28,
  /** car smashed a smashable. a = its speed, b = the prop's kind (SMASH_KINDS). */
  Smash: 29,
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
  16: 'near_miss',
  17: 'oncoming',
  18: 'traffic_check',
  19: 'hazard',
  20: 'takedown',
  21: 'race_start',
  22: 'finish',
  23: 'start_boost',
  24: 'traffic_wreck',
  25: 'drift_boost',
  26: 'drift_chain',
  27: 'chain_lost',
  28: 'air_boost',
  29: 'smash',
};

/**
 * Who attacked, in `GameEvent.b` of a CarContact: not a car (`World`), the event's car or the
 * other; and the same two for a bump another screen sent (net/contact.ts), which isn't sent back.
 */
export const Contact = { World: 0, Car: 1, Other: 2, BumpCar: 3, BumpOther: 4 } as const;

/** Wreck causes, in `GameEvent.b` of a Wreck. */
export const Cause = { Wall: 1, Car: 2, OutOfBounds: 3, Reset: 4, SpinOut: 5, Traffic: 6, Hazard: 7, Prop: 8 } as const;

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
  /**
   * No reader starts before this: `skip()` moves it to now, after a stretch the readers that draw
   * (sound, sparks, the HUD) didn't see (an online race goes on in a hidden tab), so coming back
   * doesn't play it all at once.
   */
  floor = 0;

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

  /** Every reader's next read starts from here: what's happened so far is skipped. */
  skip(): void {
    this.floor = this.head;
  }

  /** Calls `fn` for every event after `cursor`, oldest first, and returns the new cursor. Events that fell out of the ring, or are before `floor`, are skipped. */
  read(cursor: number, fn: (e: GameEvent) => void): number {
    const from = Math.max(cursor, this.head - this.capacity, this.floor);
    for (let s = from; s < this.head; s++) fn(this.ring[s % this.capacity]);
    return this.head;
  }
}
