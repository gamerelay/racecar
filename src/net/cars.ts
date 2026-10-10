// Remote cars (SPEC §10, milestone 3): every player owns their car. Yours is a GameRelay entity,
// written from your sim after each step, 30 times a second; everyone else's is a remote car in your
// sim (`CarSpec.remote`), put where its entity says before each step.
//
// The SDK draws others' entities about 100 ms in the past (`room.renderTime`), smoothed. A car at
// 250 km/h is 7 m on by now, so each is predicted forward to now from its velocity and yaw rate:
// near enough over a tenth of a second, and it's what you bump into (collisions use the pose).
// Steering, drift and the track aren't in the prediction yet (SPEC's `net/predict`).
//
// Your sim bumps your car off theirs and theirs off yours, but only yours stays bumped: theirs is
// put back where its owner says on the next step, and their own sim bumps it there. Nor does your
// sim wreck it: the victim decides.

import type { RemotePose, Sim } from '../core/sim';
import { clamp, finiteOr } from './check';
import { syncClock } from './clock';
import { readRunEnd } from './wire';

/** What the SDK's entity kinds look like here (the real ones: `room.define`), so tests can stand in their own. */
export interface NetEntity {
  readonly owner: { id: string };
  readonly mine: boolean;
  [field: string]: unknown;
  teleport(): void;
  remove(): void;
}

export interface NetKind {
  /** `{ owner: 'host' }`: the host role's, not yours (only on the host; the next host carries on writing it). */
  spawn(initial: Record<string, number | boolean | string>, options?: { owner?: 'host' }): NetEntity;
  all(): NetEntity[];
  /** The ones you write: yours, and the host's while you're the host. */
  mine(): NetEntity[];
}

export interface NetRoom {
  readonly me: string;
  /** Whether you hold the room's host role (it moves by itself). */
  readonly isHost: boolean;
  /** Who holds it: a host entity's owner is them. */
  readonly hostId: string;
  /** The server-clock moment others' entities are shown at (ms). */
  readonly renderTime: number;
  define(kind: string, fields: Record<string, unknown>, options?: { rate?: number }): NetKind;
  /** Take `key` if nobody holds it: true for exactly one player (the server decides). */
  claim(key: string): Promise<boolean>;
  release(key: string): void;
  /** To everyone, `'host'` or one player; your own handler too unless `echo: false`. */
  emit(type: string, data?: unknown, options?: { to?: string; echo?: boolean }): void;
  on(type: string, handler: (data: unknown, from: string) => void): () => void;
}

/** Cars go out this often a second (SPEC §10: 30 Hz). */
export const CAR_RATE = 30;
/** Prediction looks this far ahead at most (s): past it, a stalled connection would fling the car. */
const MAX_LEAD = 0.25;
/**
 * The most another page's car may be said to move (m/s, about twice the fastest car's top speed) and
 * turn (rad/s): what it sends is its word, and a car flung at you is your sim's problem.
 */
const MAX_SPEED = 140;
const MAX_YAW = 12;
/** A getaway runner not heard from for this long (s) after green is out (their page went, or never came). */
export const GONE_S = 3;
/** A jump this long in one step (m) is a reset or a respawn: everyone snaps instead of sliding. */
export const TELEPORT_M = 12;

const num = { type: 'number', precision: 0.01 } as const;
/** A car's entity: its pose and motion, its steering (for the wheels) and what it's doing. */
export const CAR_FIELDS = {
  x: num,
  y: num,
  z: num,
  h: 'angle',
  vx: num,
  vy: num,
  vz: num,
  yaw: num,
  pitch: 'angle',
  roll: 'angle',
  rx: 'angle',
  rz: 'angle',
  steer: num,
  grounded: 'flag',
  drift: 'flag',
  boosting: 'flag',
  wreck: 'flag',
  ghost: 'flag',
} as const;

/** A getaway runner's run on their car (rules/getaway.ts): 0 going, 1 wrecked, 2 busted, and how long they've lasted (s). */
export const RUN_FIELDS = {
  out: { type: 'number', precision: 1, smooth: false },
  runT: { type: 'number', precision: 0.01, smooth: false },
} as const;

const n = (v: unknown) => finiteOr(v, 0);
const within = (v: number, lim: number) => clamp(v, -lim, lim);

/** How far ahead to predict others' entities now (s): from the SDK's render delay, capped. */
export function predictLead(room: NetRoom, now: number): number {
  return Math.min(MAX_LEAD, Math.max(0, (now - room.renderTime) / 1000));
}

/** Another page's steering, as a control (the wheels show it). */
export const remoteSteer = (e: Record<string, unknown>) => within(n(e.steer), 1);

/** Car `i`'s entity fields, from the sim as it is now. */
export function carFields(sim: Sim, i: number): Record<string, number | boolean> {
  const c = sim.cars;
  return {
    x: c.x[i],
    y: c.y[i],
    z: c.z[i],
    h: c.h[i],
    vx: c.vx[i],
    vy: c.vy[i],
    vz: c.vz[i],
    yaw: c.yaw[i],
    pitch: c.pitch[i],
    roll: c.roll[i],
    rx: c.rx[i],
    rz: c.rz[i],
    steer: sim.controls[i].steer,
    grounded: c.grounded[i] === 1,
    drift: c.drift[i] === 1,
    boosting: c.boosting[i] === 1,
    wreck: c.wreck[i] === 1,
    ghost: c.ghostT[i] > 0,
  };
}

/** A remote car's pose `lead` seconds on from the entity's (straight on, turning at its yaw rate), its motion capped. */
export function predict(e: Record<string, unknown>, lead: number): RemotePose {
  // A wreck tumbles on its own path; it isn't driving anywhere worth guessing at.
  const t = e.wreck ? 0 : lead;
  let vx = n(e.vx);
  let vy = n(e.vy);
  let vz = n(e.vz);
  const v = Math.hypot(vx, vy, vz);
  if (v > MAX_SPEED) {
    vx *= MAX_SPEED / v;
    vy *= MAX_SPEED / v;
    vz *= MAX_SPEED / v;
  }
  const yaw = within(n(e.yaw), MAX_YAW);
  return {
    x: n(e.x) + vx * t,
    y: n(e.y) + vy * t,
    z: n(e.z) + vz * t,
    h: n(e.h) + yaw * t,
    vx,
    vy,
    vz,
    yaw,
    pitch: n(e.pitch),
    roll: n(e.roll),
    rx: n(e.rx),
    rz: n(e.rz),
    grounded: !!e.grounded,
    drift: !!e.drift,
    boosting: !!e.boosting,
    wreck: !!e.wreck,
    ghost: !!e.ghost,
  };
}

export class NetCars {
  private kind: NetKind;
  private mine: NetEntity;
  /** Players whose car has been seen: one that then goes is gone (left), not still loading. */
  private seen = new Set<string>();
  private lastX: number;
  private lastZ: number;
  /** Each other runner's time lasted, as last sent: their time if they go. */
  private runT = new Map<string, number>();
  /** When (sim time) each other player's car was last here, racing. */
  private heard = new Map<string, number>();
  /** Players whose car has said it's going in this race: only then is its word that it's out taken (a car left from the last race says it's out). */
  private going = new Set<string>();

  constructor(
    private room: NetRoom,
    /** The server's clock (ms): `relay.now()`. */
    private now: () => number,
    private sim: Sim,
    /** Your car's index. */
    private me: number,
    /** The other players' car indexes, by player id. */
    private remote: Map<string, number>,
    /** When the lights go green, on the server's clock (ms); without it, in 3 s. */
    private at?: number,
  ) {
    this.kind = room.define('car', { ...CAR_FIELDS, ...RUN_FIELDS }, { rate: CAR_RATE });
    this.mine = this.kind.spawn(this.fields());
    this.lastX = sim.cars.x[me];
    this.lastZ = sim.cars.z[me];
  }

  /** Before each step: the countdown on the server's clock, and every other player's car where they are now. */
  beforeStep(): void {
    // Each step, not once: the server's clock is measured again now and then, and a step can be dropped.
    if (this.at !== undefined) syncClock(this.sim, this.at, this.now());
    const lead = predictLead(this.room, this.now());
    const here = new Set<string>();
    for (const e of this.kind.all()) {
      if (e.mine) continue;
      const i = this.remote.get(e.owner.id);
      if (i === undefined) continue;
      here.add(e.owner.id);
      this.seen.add(e.owner.id);
      this.sim.cars.active[i] = 1;
      this.sim.setPose(i, predict(e, lead));
      this.sim.controls[i].steer = remoteSteer(e);
      // A getaway: their screen says when they're out.
      const g = this.sim.getaway;
      if (g && this.sim.race.phase === 'racing') {
        this.heard.set(e.owner.id, this.sim.time);
        if (e.out === 0) this.going.add(e.owner.id);
        if (!this.going.has(e.owner.id)) continue;
        this.runT.set(e.owner.id, finiteOr(e.runT, 0));
        const end = readRunEnd(e.out, e.runT);
        if (end) g.endRemote(i, end.end, end.time);
      }
    }
    // Gone for good (left the room): their car leaves the race. One not seen yet isn't in it yet
    // (`addCar` leaves a remote car out until it shows up).
    for (const [id, i] of this.remote) if (this.seen.has(id) && !here.has(id)) this.sim.cars.active[i] = 0;
    // A getaway runner gone a while (or never here since green): out, at the time they'd lasted when last heard from.
    const g = this.sim.getaway;
    if (g && this.sim.race.phase === 'racing')
      for (const [id, i] of this.remote)
        if (this.sim.time - Math.max(this.heard.get(id) ?? -Infinity, this.sim.race.goTime) > GONE_S) g.endRemote(i, 'wrecked', this.runT.get(id) ?? 0);
  }

  /** After each step: your car as it is now, for everyone else. */
  afterStep(): void {
    const c = this.sim.cars;
    const i = this.me;
    const f = this.fields();
    for (const k in f) this.mine[k] = f[k];
    // A reset or a respawn: a jump, not a drive across the map.
    if (Math.hypot(c.x[i] - this.lastX, c.z[i] - this.lastZ) > TELEPORT_M) this.mine.teleport();
    this.lastX = c.x[i];
    this.lastZ = c.z[i];
  }

  /** Your car's fields, with your getaway run's end and time (0, 0 when it isn't one). */
  private fields(): Record<string, number | boolean> {
    const run = this.sim.getaway?.runOf(this.me);
    return { ...carFields(this.sim, this.me), out: run?.end === 'busted' ? 2 : run?.end ? 1 : 0, runT: run?.time ?? 0 };
  }

  dispose(): void {
    this.mine.remove();
  }
}
