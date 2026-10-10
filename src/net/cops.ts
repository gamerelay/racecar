// The cops online (docs/superpowers/specs/2026-10-09-online-getaway-design.md): the room's host
// drives every runner's cops (rules/getaway.ts), so every screen is chased by the same ones. Each
// cop is a host entity (`cop`: a car's fields, its place among the getaway's cops, whether it's out,
// who it's after, and the rivals' handover), written from the host's sim after each step; everyone
// else has it as a remote car, put where its entity says.
//
// As with the rivals (net/rivals.ts): the host role moves by itself and its entities go with it. A
// cop plans its way again every half second (ai/cop.ts), so whoever holds the role drives them on
// from where they are. Until the host's cops show up, every screen drives them itself.

import type { Sim } from '../core/sim';
import { CAR_FIELDS, CAR_RATE, carFields, predict, predictLead, remoteSteer, TELEPORT_M, type NetEntity, type NetKind, type NetRoom } from './cars';
import { HANDOVER, HANDOVER_FIELDS } from './rivals';
import { readHandover, readTarget } from './wire';

const int = { type: 'number', precision: 1, smooth: false } as const;

/** A cop's entity: its car, its place among the getaway's cops, the race, whether it's out, its runner, and the handover. */
export const COP_FIELDS = {
  ...CAR_FIELDS,
  slot: int,
  race: 'text',
  active: 'flag',
  target: int,
  ...HANDOVER_FIELDS,
} as const;

export class NetCops {
  private kind: NetKind;
  /** Where each cop was after the last step it was written in, to tell a call-out from a drive. */
  private last = new Map<number, { x: number; z: number }>();

  constructor(
    private room: NetRoom,
    /** The server's clock (ms). */
    private now: () => number,
    private sim: Sim,
    /** This race, the same on every screen (its seed and start). */
    private race: string,
  ) {
    this.kind = room.define('cop', COP_FIELDS, { rate: CAR_RATE });
  }

  /** This race's cop entities by slot: the first of each (two hosts at once, for a moment, can both spawn one). */
  private bySlot(list: NetEntity[]): Map<number, NetEntity> {
    const n = this.sim.getaway?.cops.length ?? 0;
    const out = new Map<number, NetEntity>();
    for (const e of list) {
      const k = e.slot;
      if (e.race === this.race && typeof k === 'number' && Number.isInteger(k) && k >= 0 && k < n && !out.has(k)) out.set(k, e);
    }
    return out;
  }

  /** Before each step: drive them here (you're the host, or nobody's sending them), or put them where the host says. */
  beforeStep(): void {
    const g = this.sim.getaway;
    if (!g) return;
    const c = this.sim.cars;
    if (this.room.isHost) {
      for (const i of g.cops) c.remote[i] = 0;
      return;
    }
    this.last.clear();
    const lead = predictLead(this.room, this.now());
    const theirs = this.bySlot(this.kind.all().filter((e) => e.owner.id === this.room.hostId));
    g.cops.forEach((i, k) => {
      const e = theirs.get(k);
      // Not sent (yet): this screen drives it, as the host would.
      if (!e) {
        c.remote[i] = 0;
        return;
      }
      c.remote[i] = 1;
      c.active[i] = e.active ? 1 : 0;
      const target = readTarget(e.target, g.runners);
      if (target !== null) this.sim.cops[i]!.target = target;
      if (!e.active) return;
      this.sim.setPose(i, predict(e, lead));
      this.sim.controls[i].steer = remoteSteer(e);
      for (const f of HANDOVER) {
        const v = readHandover(f, e[f], this.sim.track.splines.length);
        if (v !== null) c[f][i] = v;
      }
    });
  }

  /** After each step, on the host: every cop as it is now, out or not, for everyone else (spawned the first time). */
  afterStep(): void {
    const g = this.sim.getaway;
    if (!g || !this.room.isHost) return;
    const c = this.sim.cars;
    const ours = this.kind.mine();
    const bySlot = this.bySlot(ours);
    // A second host's cops for the same slots, and the last race's: done with.
    for (const e of ours) if (bySlot.get(e.slot as number) !== e) e.remove();
    g.cops.forEach((i, k) => {
      const f: Record<string, number | boolean | string> = { ...carFields(this.sim, i), slot: k, race: this.race, active: c.active[i] === 1, target: this.sim.cops[i]!.target };
      for (const h of HANDOVER) f[h] = c[h][i];
      let e = bySlot.get(k);
      if (!e) {
        e = this.kind.spawn(f, { owner: 'host' });
      } else {
        for (const key in f) e[key] = f[key];
        // Called out (or brought back): a jump, not a drive across the city.
        const was = this.last.get(k);
        if (was && Math.hypot(c.x[i] - was.x, c.z[i] - was.z) > TELEPORT_M) e.teleport();
      }
      this.last.set(k, { x: c.x[i], z: c.z[i] });
    });
  }
}
