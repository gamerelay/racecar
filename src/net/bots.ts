// Bots (GameRelay's BOTS.md): an agent's test car. Online, the host drives the AI cars (net/rivals.ts);
// a bot takes one of those cars and its brain's controls replace the AI's (Sim.setOverride). Every
// screen already draws the AI cars, so nothing new goes over the wire.

import type { BotAdapter, BotInfo, Json } from '@gamerelay/sdk';
import { neutralControls, type Controls } from '../core/controls';
import type { Sim } from '../core/sim';
import { newHit, sampleAt } from '../core/track/query';

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
  /** 'countdown' | 'racing' | … */
  phase: string;
}

const hit = newHit();
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** What a bot's brain sees of car `i`: enough to drive with in ten lines. */
export function observeCar(sim: Sim, i: number): CarView {
  const c = sim.cars;
  const speed = Math.hypot(c.vx[i], c.vz[i]);
  sampleAt(sim.track.splines[c.spline[i]], c.s[i] + 12 + speed, hit); // about a second ahead, and never closer than 12 m
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
    phase: sim.race.phase,
  };
}

const num = (x: unknown, lo: number, hi: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : 0);

/** A brain's action as controls: numbers clamped to their ranges, junk as 0 or off. */
export function applyBrainAction(action: unknown, out: Controls): Controls {
  const a = (typeof action === 'object' && action !== null ? action : {}) as Record<string, unknown>;
  out.steer = num(a.steer, -1, 1);
  out.throttle = num(a.throttle, 0, 1);
  out.brake = num(a.brake, 0, 1);
  out.boost = a.boost === true || a.boost === 1;
  out.drift = a.drift === true || a.drift === 1;
  out.reset = a.reset === true;
  out.lookBack = out.horn = false;
  return out;
}

/** The adapter: each bot takes the next AI car without one, in seat order. */
export function racecarBots(sim: Sim, aiSeats: ReadonlyMap<number, number>): BotAdapter {
  const cars = new Map<string, number>();
  const controls = new Map<string, Controls>();
  const carOf = (bot: BotInfo) => cars.get(bot.id);
  return {
    join(bot) {
      const taken = new Set(cars.values());
      const free = [...aiSeats.values()].find((i) => !taken.has(i));
      if (free === undefined) return false; // more bots than AI cars: it sits out, and the SDK logs "no room for this bot in the game"
      cars.set(bot.id, free);
      controls.set(bot.id, neutralControls());
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
