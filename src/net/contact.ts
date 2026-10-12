// Contact between cars on different screens (SPEC §4): bumps and takedown credit. Each screen
// moves only its own cars (yours, and the AIs on the host) and decides only their wrecks, so:
//
// - A bump: your car touched another screen's car. Your sim pushed yours; you tell its owner what
//   you saw (`bump`), and they apply it to theirs unless their sim saw that contact itself within
//   ±150 ms (then it's been resolved there, once). So a contact both screens saw is pushed once on
//   each, and one only you saw still reaches their car, with the takedown rule run there if yours
//   was the attacker.
// - Credit: your car was wrecked by another screen's car. Your screen decides the wreck, and tells
//   the attacker's owner (`takedown`), whose screen credits its own car: the boost, the points,
//   "Takedown!". Without it, a takedown only counted on the victim's screen.
//
// A car is named the same on every screen: `p:<player id>` for a player's, `s:<seat>` for an AI,
// `c:<k>` for a getaway's cop.

import { takedownCheck } from '../core/collide/cars';
import { creditTakedown } from '../core/car/physics';
import { TUNING as T } from '../core/car/tuning';
import { Cause, Contact, Ev } from '../core/events';
import type { Sim } from '../core/sim';
import type { NetRoom } from './cars';
import { readBump, readTakedown } from './wire';

export const BUMP = 'bump';
export const TAKEDOWN = 'takedown';
/** A contact seen here within this long (s) of another screen's is the same one. */
export const SAME_CONTACT_S = 0.15;
/** At most one bump a pair this often (s): a contact lasts a few steps. */
const BUMP_EVERY_S = 0.15;
/** The most a bump changes a car's speed (m/s): the other screen's word, so capped. */
const MAX_DV = 30;

/** What the cars are called on every screen, and here. */
export interface CarNames {
  /** This screen's car index → its name (`p:<id>`, `s:<seat>`, `c:<k>`). */
  name(i: number): string | null;
  /** A name → this screen's car index. */
  index(name: string): number | undefined;
}

export function carNames(me: number, myId: string, remote: ReadonlyMap<string, number>, aiSeats: ReadonlyMap<number, number>, cops: readonly number[] = []): CarNames {
  const byName = new Map<string, number>([[`p:${myId}`, me]]);
  for (const [id, i] of remote) byName.set(`p:${id}`, i);
  for (const [seat, i] of aiSeats) byName.set(`s:${seat}`, i);
  // A getaway's cops, by their place among its cops (the same on every screen: rules/getaway.ts).
  cops.forEach((i, k) => byName.set(`c:${k}`, i));
  const byIndex = new Map([...byName].map(([n, i]) => [i, n]));
  return { name: (i) => byIndex.get(i) ?? null, index: (n) => byName.get(n) };
}

/** Who to tell about a car: its player, or the host for an AI or a cop. */
const ownerOf = (name: string): string => (name.startsWith('s:') || name.startsWith('c:') ? 'host' : name.slice(2));


export class NetContact {
  private cursor: number;
  /**
   * When each pair (`a|b`, by name, sorted) touched in this screen's sim lately, race time (s):
   * every step's, gentle ones too, so a contact that lasts is seen all along. Bumps applied from
   * other screens aren't in it.
   */
  private touched = new Map<string, number[]>();
  /** When each pair's bump last went out. */
  private sent = new Map<string, number>();
  /** Other screens' bumps, held until it's clear this screen didn't see the contact too. */
  private pending: { key: string; m: number; r: number; t: number; dvx: number; dvz: number; closing: number; att: boolean }[] = [];
  private offs: (() => void)[];

  constructor(
    private room: NetRoom,
    private sim: Sim,
    private names: CarNames,
  ) {
    this.cursor = sim.events.head;
    this.offs = [room.on(BUMP, (d, from) => from !== room.me && this.bumped(d, from)), room.on(TAKEDOWN, (d, from) => from !== room.me && this.tookDown(d, from))];
  }

  /** Whether `from` speaks for that car: its player, or the host for an AI. */
  private speaksFor(from: string, name: string): boolean {
    const owner = ownerOf(name);
    return owner === 'host' ? from === this.room.hostId : from === owner;
  }

  private pair(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  /** Yours to move and wreck here: not another screen's car. */
  private mine(i: number): boolean {
    return i >= 0 && i < this.sim.cars.count && !this.sim.cars.remote[i];
  }

  /** After each step: tell the other screens' owners about contacts with their cars, and wrecks they caused. */
  afterStep(): void {
    const sim = this.sim;
    const c = sim.cars;
    // What the step just run resolved: every contact sets lastHitT, however gentle (only harder
    // ones are events). A bump applied here writes the step before (see apply), so it isn't one.
    for (let i = 0; i < c.count; i++) {
      const o = c.lastHitBy[i];
      if (c.lastHitT[i] !== sim.tick - 1 || o < 0 || !this.mine(i) || this.mine(o)) continue;
      const a = this.names.name(i);
      const b = this.names.name(o);
      if (!a || !b) continue;
      const key = this.pair(a, b);
      const seen = this.touched.get(key) ?? [];
      seen.push(sim.time);
      // A second's worth is plenty for a ±SAME_CONTACT_S check.
      while (seen.length && seen[0] < sim.time - 1) seen.shift();
      this.touched.set(key, seen);
    }
    this.cursor = sim.events.read(this.cursor, (e) => {
      // A bump applied here (apply) isn't one to tell them about.
      if (e.type === Ev.CarContact && e.other >= 0 && (e.b === Contact.Car || e.b === Contact.Other)) {
        const na = this.names.name(e.car);
        const nb = this.names.name(e.other);
        if (!na || !nb) return;
        const key = this.pair(na, nb);
        // One of yours and one of theirs (two of yours are settled here; two of theirs aren't yours to tell).
        const ours = this.mine(e.car);
        if (ours === this.mine(e.other)) return;
        const [m, r, nm, nr] = ours ? [e.car, e.other, na, nb] : [e.other, e.car, nb, na];
        if (sim.time - (this.sent.get(key) ?? -Infinity) < BUMP_EVERY_S) return;
        this.sent.set(key, sim.time);
        // The push their car took here: along the line from yours to theirs, its share of the impulse.
        let nx = c.x[r] - c.x[m];
        let nz = c.z[r] - c.z[m];
        const d = Math.hypot(nx, nz) || 1;
        nx /= d;
        nz /= d;
        const im = 1 / sim.classes[c.cls[m]].mass;
        const ir = 1 / sim.classes[c.cls[r]].mass;
        const dv = ((1 + T.carRestitution) * e.a) / (im + ir) * ir;
        const attacked = (e.b === Contact.Car ? e.car : e.other) === m;
        this.room.emit(BUMP, { to: nr, by: nm, t: sim.time, dvx: nx * dv, dvz: nz * dv, closing: e.a, att: attacked }, { to: ownerOf(nr), echo: false });
      } else if (e.type === Ev.Wreck && e.other >= 0 && e.b !== Cause.Reset && this.mine(e.car) && !this.mine(e.other)) {
        const victim = this.names.name(e.car);
        const by = this.names.name(e.other);
        if (victim && by) this.room.emit(TAKEDOWN, { victim, by, t: sim.time }, { to: ownerOf(by), echo: false });
      }
    });
    // Bumps from other screens, once this one has had its ±SAME_CONTACT_S to see them too.
    if (this.pending.length) {
      const due = this.pending.filter((b) => sim.time >= b.t + SAME_CONTACT_S);
      this.pending = this.pending.filter((b) => sim.time < b.t + SAME_CONTACT_S);
      for (const b of due) {
        const seen = this.touched.get(b.key);
        if (!seen?.some((t) => Math.abs(t - b.t) <= SAME_CONTACT_S)) this.apply(b);
      }
    }
    // Forget old contacts.
    if (this.touched.size > 64) for (const [k, t] of this.touched) if (!t.length || sim.time - t[t.length - 1] > 2) (this.touched.delete(k), this.sent.delete(k));
  }

  /** Another screen's bump to one of your cars: held, then applied unless this screen saw it too. */
  private bumped(data: unknown, from: string): void {
    const b = readBump(data);
    if (!b || !this.speaksFor(from, b.by)) return;
    const m = this.names.index(b.to);
    const r = this.names.index(b.by);
    if (m === undefined || r === undefined || !this.mine(m) || this.mine(r)) return;
    if (Math.abs(b.t - this.sim.time) > 2 || this.pending.length > 64) return;
    this.pending.push({ key: this.pair(b.to, b.by), m, r, t: b.t, dvx: b.dvx, dvz: b.dvz, closing: b.closing, att: b.att });
  }

  private apply(b: NetContact['pending'][number]): void {
    const sim = this.sim;
    const c = sim.cars;
    const { m, r } = b;
    if (!c.active[m] || c.wreck[m] || c.ghostT[m] > 0) return;
    const dv = Math.hypot(b.dvx, b.dvz);
    const k = dv > MAX_DV ? MAX_DV / dv : 1;
    c.vx[m] += b.dvx * k;
    c.vz[m] += b.dvz * k;
    // Who hit it, for a wreck's credit; as of the step before, so the next afterStep doesn't take
    // it for a contact this sim resolved.
    c.lastHitBy[m] = r;
    c.lastHitT[m] = sim.tick - 1;
    c.lastHitBy[r] = m;
    c.lastHitT[r] = sim.tick - 1;
    if (b.closing > 1.5) sim.events.push(sim.tick, Ev.CarContact, m, c.x[m], c.y[m] + 0.5, c.z[m], b.closing, b.att ? Contact.BumpOther : Contact.BumpCar, r);
    if (b.att && dv > 0) takedownCheck(sim, r, m, b.closing, b.dvx / dv, b.dvz / dv);
  }

  /** Your car took one of theirs out (their screen decided it): your car's credit. */
  private tookDown(data: unknown, from: string): void {
    const d = readTakedown(data);
    // The victim's screen decides its wreck: only it may say so.
    if (!d || !this.speaksFor(from, d.victim)) return;
    const by = this.names.index(d.by);
    const victim = this.names.index(d.victim);
    if (by === undefined || victim === undefined || !this.mine(by) || this.mine(victim) || Math.abs(d.t - this.sim.time) > 2) return;
    creditTakedown(this.sim, by, victim);
  }

  close(): void {
    for (const off of this.offs) off();
  }
}
