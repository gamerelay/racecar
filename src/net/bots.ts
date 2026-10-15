// Bots (GameRelay's BOTS.md): an agent's test car. Online, the host drives the AI cars (net/rivals.ts);
// a bot takes one of those cars and its brain's controls replace the AI's (Sim.setOverride). Every
// screen already draws the AI cars, so nothing new goes over the wire.

import type { BotAdapter, BotInfo, Json } from '@gamerelay/sdk';
import { neutralControls, type Controls } from '../core/controls';
import { wrapAngle } from '../core/math';
import type { Sim } from '../core/sim';
import { newHit, sampleAt, type TrackHit } from '../core/track/query';
import { clamp, fields, finiteOr } from './check';

/** What a bot's brain sees as `view.game`. */
export interface CarView {
  /** m/s */
  speed: number;
  /** rad: the road ~1 s ahead relative to the car's heading; steer toward its sign. */
  angleToNext: number;
  /** m from the centre line, + right */
  lateral: number;
  /** m: the road's half width there */
  halfWidth: number;
  lap: number;
  laps: number;
  /** 0 = leading */
  rank: number;
  wrecked: boolean;
  /** s it's been stuck (pressing on, not moving); a car stuck past ~2.5 s wants `reset: true`, as the AI's does. */
  stuck: number;
  /** 'countdown' | 'racing' | … */
  phase: string;
}

const hit = newHit();

/**
 * The road `ahead` m on from car `i`, into `out`: past a branch's end, on along the road it rejoins
 * (sampled on the branch alone, it stopped at the end, by then a few metres off, and the angle swung).
 */
export function roadAhead(sim: Sim, i: number, ahead: number, out: TrackHit): TrackHit {
  let k = sim.cars.spline[i];
  let s = sim.cars.s[i] + ahead;
  for (let hops = 0; hops < 4 && k !== 0; hops++) {
    const sp = sim.track.splines[k];
    if (s <= sp.length) break;
    s = sp.toS + (s - sp.length);
    k = sp.toRoad;
  }
  return sampleAt(sim.track.splines[k], s, out);
}

/** What a bot's brain sees of car `i`: enough to drive with in ten lines. */
export function observeCar(sim: Sim, i: number): CarView {
  const c = sim.cars;
  const speed = Math.hypot(c.vx[i], c.vz[i]);
  roadAhead(sim, i, 12 + speed, hit); // about a second ahead, and never closer than 12 m
  // The point there in the car's own lane (as placeCar puts one): a car off the centre line still
  // reads ~0 when it follows the road, and the brain sees `lateral` for the rest.
  const lat = c.lateral[i];
  const px = hit.cx - hit.tz * lat;
  const pz = hit.cz + hit.tx * lat;
  // h = 0 points toward +z (dev/drive.ts), and steering right (+) turns h down: heading minus the
  // bearing, so + means the road bends right (test/bots.test.ts checks the sign).
  const angleToNext = wrapAngle(c.h[i] - Math.atan2(px - c.x[i], pz - c.z[i]));
  return {
    speed,
    angleToNext,
    lateral: lat,
    halfWidth: hit.width / 2,
    lap: c.lap[i],
    laps: sim.race.laps,
    rank: c.rank[i],
    wrecked: c.wreck[i] > 0,
    stuck: c.stuckT[i],
    phase: sim.race.phase,
  };
}

/** A brain's action as controls: numbers clamped to their ranges, junk as 0 or off. */
export function applyBrainAction(action: unknown, out: Controls): Controls {
  const a = fields(action) ?? {};
  out.steer = clamp(finiteOr(a.steer, 0), -1, 1);
  out.throttle = clamp(finiteOr(a.throttle, 0), 0, 1);
  out.brake = clamp(finiteOr(a.brake, 0), 0, 1);
  out.boost = a.boost === true || a.boost === 1;
  out.drift = a.drift === true || a.drift === 1;
  out.reset = a.reset === true;
  out.lookBack = out.horn = false;
  return out;
}

/** FNV-1a: a bot's id as a number, the same on every screen. */
function idHash(id: string): number {
  let h = 0x811c9dc5;
  for (let k = 0; k < id.length; k++) h = Math.imul(h ^ id.charCodeAt(k), 0x01000193);
  return h >>> 0;
}

/**
 * Which AI car a bot takes: the seat its id picks, or the next free one after it. By the id, not by
 * which brain loads first, so the host taking over mid-race gives each bot the car it had.
 */
export function seatFor(id: string, seats: readonly number[], taken: ReadonlySet<number>): number | undefined {
  for (let k = 0; k < seats.length; k++) {
    const i = seats[(idHash(id) + k) % seats.length];
    if (!taken.has(i)) return i;
  }
  return undefined;
}

/** The adapter: each bot takes an AI car (seatFor), from its join: coasting until its brain's first answer. */
export function racecarBots(sim: Sim, aiSeats: ReadonlyMap<number, number>): BotAdapter {
  const cars = new Map<string, number>();
  const controls = new Map<string, Controls>();
  const carOf = (bot: BotInfo) => cars.get(bot.id);
  const seats = [...aiSeats.values()];
  return {
    join(bot) {
      const free = seatFor(bot.id, seats, new Set(cars.values()));
      if (free === undefined) return false; // more bots than AI cars: it sits out, and the SDK logs "no room for this bot in the game"
      const c = neutralControls();
      cars.set(bot.id, free);
      controls.set(bot.id, c);
      // The bot's from now: the AI stops here, not at its first answer (a brain that never answers
      // would have the AI driving while its log said it had started).
      sim.setOverride(free, c, 0);
      return true;
    },
    leave(bot) {
      const i = carOf(bot);
      if (i !== undefined) sim.setOverride(i, null);
      cars.delete(bot.id);
      controls.delete(bot.id);
    },
    observe(bot) {
      const i = carOf(bot);
      return i === undefined ? null : (observeCar(sim, i) as unknown as Json);
    },
    drive(bot, action) {
      const i = carOf(bot);
      const c = controls.get(bot.id);
      if (i === undefined || !c) return;
      sim.setOverride(i, applyBrainAction(action, c));
    },
  };
}
