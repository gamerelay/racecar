// Breakable walls online (docs/CALDERA.md, "Online first": a trigger; core/world/breakables.ts).
// A panel breaks only on the screen of the car that broke it (each screen collides its own cars),
// and it changes where everyone can drive: so that screen claims it (`room.claim`), and the winner
// tells everyone when. Every screen has it down from then (a screen that broke it too but lost the
// claim takes the winner's time). As with traffic hits, only the time is shared: the car's own
// slowdown and points are its sim's. A panel down for the race keeps its claim to the end; one
// that stands again lets it go a second before it does.

import { Ev } from '../core/events';
import type { Sim } from '../core/sim';
import type { NetRoom } from './cars';
import { readHit, type TrafficHit } from './wire';

/** The event the claim's winner sends (a TrafficHit's shape: k the panel, b unused). */
export const WALL_BREAK = 'wall_break';
/** A break is news within this long of now (s): what a message's delay can be, no more. */
export const NEWS_S = 10;

export class NetBreakables {
  private cursor: number;
  /** Claims won, and the race time each is let go at (Infinity: at the end). */
  private held = new Map<string, number>();
  private asking = new Set<string>();
  private off: () => void;

  constructor(
    private room: NetRoom,
    private sim: Sim,
    /** This race (its seed and start): a claim from the last race in the room isn't this one's. */
    private race: string,
  ) {
    this.cursor = sim.events.head;
    this.off = room.on(WALL_BREAK, (data, from) => {
      if (from === room.me) return;
      const hit = readHit(data, sim.world.breakables.n, sim.time, NEWS_S);
      if (hit) this.apply(hit);
    });
  }

  key(k: number): string {
    return `wall:${this.race}:${k}`;
  }

  /** After each step: claim the panels your cars broke, and let go of claims on panels standing again. */
  afterStep(): void {
    const sim = this.sim;
    const br = sim.world.breakables;
    this.cursor = sim.events.read(this.cursor, (e) => {
      if (e.type !== Ev.WallBreak || e.car < 0 || sim.cars.remote[e.car]) return;
      const key = this.key(e.b);
      if (this.held.has(key) || this.asking.has(key)) return;
      const hit: TrafficHit = { k: e.b, t: br.brokenAt[e.b], x: e.x, y: e.y, z: e.z, a: e.a, b: 0 };
      this.asking.add(key);
      this.room.claim(key).then(
        (won) => {
          this.asking.delete(key);
          if (!won) return;
          this.held.set(key, hit.t + br.down[hit.k] - 1);
          this.room.emit(WALL_BREAK, { ...hit }, { echo: false });
        },
        () => this.asking.delete(key),
      );
    });
    for (const [key, until] of this.held) {
      if (sim.time < until) continue;
      this.held.delete(key);
      this.room.release(key);
    }
  }

  /** Another screen's break: that panel is down from its time here too (and bursts, if it was standing here). */
  private apply(hit: TrafficHit): void {
    const br = this.sim.world.breakables;
    const was = br.brokenAt[hit.k];
    // Broken here since it stood again: a later break, not this one.
    if (was > hit.t + br.down[hit.k]) return;
    const standing = br.standing(hit.k, this.sim.time);
    br.brokenAt[hit.k] = hit.t;
    if (standing) this.sim.events.push(this.sim.tick, Ev.WallBreak, -1, hit.x, hit.y, hit.z, hit.a, hit.k, -1);
  }

  /** The race page is done with it. */
  close(): void {
    this.off();
    for (const key of this.held.keys()) this.room.release(key);
    this.held.clear();
  }
}
