// Traffic hits online (SPEC §4, T). Traffic is the same on every screen (a function of the seed and
// the race time, which the net layer keeps on the server's clock), but a hit happens only on the
// screen of the car that made it: each screen collides its own cars (yours, and the AIs on the
// host). So whoever wrecks a traffic car claims it (`room.claim`), and the one that gets the claim
// tells everyone when: each screen wrecks that car from then, so nobody hits a car that's gone
// on another screen. A screen that wrecked it too but lost the claim takes the winner's time (only
// the wreck's time is shared: your car's crash, boost and score are your sim's, as always). The
// claim is let go as the car comes back.

import { Ev } from '../core/events';
import type { Sim } from '../core/sim';
import { FADE_BACK, TRAFFIC_RESPAWN } from '../core/world/traffic';
import type { NetRoom } from './cars';

/** The event the claim's winner sends. */
export const TRAFFIC_HIT = 'traffic_hit';
/** A wreck is this wreck (and a hit is near now) within this long of it (s): until the car is back on the road. */
export const HOLD_S = TRAFFIC_RESPAWN + FADE_BACK;
/**
 * Its claim is let go this long after (s): as the car starts fading back, a second before it can
 * be hit again, so the next hit's claim isn't refused by this one (a screen's clock can run a
 * little ahead, and the release takes a moment to land).
 */
export const RELEASE_S = TRAFFIC_RESPAWN;

/** What the winner sends: the traffic car, when (race time, s), where, how hard, and how (0 a crash, 1 a check). */
export interface TrafficHit {
  k: number;
  t: number;
  x: number;
  y: number;
  z: number;
  a: number;
  b: number;
}

/** A hit as another screen sent it, checked: a traffic car there is, a time near now, numbers that are numbers. */
export function readHit(data: unknown, sim: Sim): TrafficHit | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const k = n(d.k);
  const t = n(d.t);
  if (k === null || !Number.isInteger(k) || k < 0 || k >= sim.world.traffic.count) return null;
  if (t === null || Math.abs(t - sim.time) > HOLD_S) return null;
  const [x, y, z, a] = [n(d.x), n(d.y), n(d.z), n(d.a)];
  if (x === null || y === null || z === null || a === null) return null;
  return { k, t, x, y, z, a: Math.max(0, Math.min(100, a)), b: d.b === 1 ? 1 : 0 };
}

export class NetTraffic {
  private cursor: number;
  /** Claims won, and the race time each is let go at. */
  private held = new Map<string, number>();
  /** Claims asked for and not answered yet (one ask per car at a time). */
  private asking = new Set<string>();
  private off: () => void;

  constructor(
    private room: NetRoom,
    private sim: Sim,
    /** This race (its seed and start): a claim from the last race in the room isn't this one's. */
    private race: string,
  ) {
    this.cursor = sim.events.head;
    this.off = room.on(TRAFFIC_HIT, (data, from) => {
      if (from === room.me) return;
      const hit = readHit(data, sim);
      if (hit) this.apply(hit);
    });
  }

  key(k: number): string {
    return `traffic:${this.race}:${k}`;
  }

  /** After each step: claim the traffic your cars wrecked, and let go of claims whose car is back. */
  afterStep(): void {
    const sim = this.sim;
    const tr = sim.world.traffic;
    this.cursor = sim.events.read(this.cursor, (e) => {
      // Your cars' wrecks only (a hazard's, car -1, is the same on every screen).
      if (e.type !== Ev.TrafficWreck || e.car < 0 || sim.cars.remote[e.car]) return;
      const key = this.key(e.other);
      if (this.held.has(key) || this.asking.has(key)) return;
      // The event's slot is reused: keep what's sent now.
      const hit: TrafficHit = { k: e.other, t: tr.wreckedAt[e.other], x: e.x, y: e.y, z: e.z, a: e.a, b: e.b === 1 ? 1 : 0 };
      this.asking.add(key);
      this.room.claim(key).then(
        (won) => {
          this.asking.delete(key);
          if (!won) return;
          this.held.set(key, hit.t + RELEASE_S);
          this.room.emit(TRAFFIC_HIT, { ...hit }, { echo: false });
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

  /** Another screen's hit: that car is wrecked from its time here too (and the debris flies, if this screen hadn't wrecked it). */
  private apply(hit: TrafficHit): void {
    const tr = this.sim.world.traffic;
    const was = tr.wreckedAt[hit.k];
    // A later wreck of this car here (it's been back since): not this one.
    if (was > hit.t + HOLD_S) return;
    const seen = was >= 0 && Math.abs(was - hit.t) < HOLD_S;
    tr.wreckedAt[hit.k] = hit.t;
    if (!seen) this.sim.events.push(this.sim.tick, Ev.TrafficWreck, -1, hit.x, hit.y, hit.z, hit.a, hit.b, hit.k);
  }

  /** The race page is done with it. */
  close(): void {
    this.off();
    for (const key of this.held.keys()) this.room.release(key);
    this.held.clear();
  }
}
