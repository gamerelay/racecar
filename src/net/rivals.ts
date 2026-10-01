// The AIs online (SPEC §10, milestone 3): the room's host drives them, so every screen races the
// same bots. Each AI seat is a host entity (`rival`, a car's fields plus its seat), written from the
// host's sim after each step; everyone else has it as a remote car, like another player's.
//
// The host role moves by itself (net layer: the SDK's host), and its entities go with it. The AI
// keeps no memory but the car's pose (ai/racer.ts), so whoever holds the role just drives them on
// from where they are: before each step a screen that's the host steps them itself, any other one
// puts them where their entity says. Until the host's rivals show up (it hasn't connected yet, or
// nobody has), every screen drives them itself, from the same grid.

import type { Sim } from '../core/sim';
import { CAR_FIELDS, CAR_RATE, carFields, predict, TELEPORT_M, type NetEntity, type NetKind, type NetRoom } from './cars';

/** A rival's entity: its car, and the lobby seat it's in (the same on every screen). */
export const RIVAL_FIELDS = { ...CAR_FIELDS, seat: { type: 'number', precision: 1, smooth: false } } as const;

/** Prediction looks this far ahead at most (s), as for players' cars. */
const MAX_LEAD = 0.25;

export class NetRivals {
  private kind: NetKind;
  /** Where each rival was after the last step it was written in, to tell a respawn from a drive. */
  private last = new Map<number, { x: number; z: number }>();

  constructor(
    private room: NetRoom,
    /** The server's clock (ms). */
    private now: () => number,
    private sim: Sim,
    /** The AIs' car indexes, by lobby seat. */
    private seats: ReadonlyMap<number, number>,
  ) {
    this.kind = room.define('rival', RIVAL_FIELDS, { rate: CAR_RATE });
  }

  /** The rival entities by seat: the first of each (two hosts at once, for a moment, can both spawn one). */
  private bySeat(list: NetEntity[]): Map<number, NetEntity> {
    const out = new Map<number, NetEntity>();
    for (const e of list) {
      const seat = e.seat;
      if (typeof seat === 'number' && this.seats.has(seat) && !out.has(seat)) out.set(seat, e);
    }
    return out;
  }

  /** Before each step: drive them here (you're the host, or nobody's sending them), or put them where the host says. */
  beforeStep(): void {
    const c = this.sim.cars;
    if (this.room.isHost) {
      // Yours to drive, from wherever they are now (on the last host's word, if it was someone else).
      for (const i of this.seats.values()) c.remote[i] = 0;
      return;
    }
    const lead = Math.min(MAX_LEAD, Math.max(0, (this.now() - this.room.renderTime) / 1000));
    const theirs = this.bySeat(this.kind.all());
    for (const [seat, i] of this.seats) {
      const e = theirs.get(seat);
      // Not sent (yet): this screen drives it, as the host would.
      if (!e) {
        c.remote[i] = 0;
        continue;
      }
      c.remote[i] = 1;
      c.active[i] = 1;
      this.sim.setPose(i, predict(e, lead));
      this.sim.controls[i].steer = typeof e.steer === 'number' ? e.steer : 0;
    }
  }

  /** After each step, on the host: every rival as it is now, for everyone else (spawned the first time). */
  afterStep(): void {
    if (!this.room.isHost) return;
    const c = this.sim.cars;
    const ours = this.kind.mine();
    const bySeat = this.bySeat(ours);
    // A second host's rivals for the same seats (it was host too, for a moment): one each is enough.
    for (const e of ours) if (bySeat.get(e.seat as number) !== e) e.remove();
    for (const [seat, i] of this.seats) {
      const f = { ...carFields(this.sim, i), seat };
      let e = bySeat.get(seat);
      if (!e) {
        e = this.kind.spawn(f, { owner: 'host' });
      } else {
        for (const k in f) e[k] = f[k as keyof typeof f];
        const was = this.last.get(seat);
        if (was && Math.hypot(c.x[i] - was.x, c.z[i] - was.z) > TELEPORT_M) e.teleport();
      }
      this.last.set(seat, { x: c.x[i], z: c.z[i] });
    }
  }
}
