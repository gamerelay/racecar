// The race page's join (milestone 3): it stays in its lobby's room, so the seat is still yours
// after the race, and once it's in, your car (and, on the host, the AIs) go out. However long that
// takes: the menu gives up on a slow join, the race page never does. If it isn't in within
// FALLBACK_MS, the race starts from here anyway, and your car goes out whenever it gets in.

import type { Sim } from '../core/sim';
import { NetCars, type NetRoom } from './cars';
import { NetRivals } from './rivals';
import type { Tick } from './stepper';
import { NetBreakables } from './breakables';
import { NetTraffic } from './traffic';
import { carNames, NetContact } from './contact';

/** Not connected by then (ms): the lights go anyway, 3 s on, and you race from here. */
export const FALLBACK_MS = 8000;

export interface RaceJoin {
  /** The lobby's room joined (the backend's own join: `Lobbies.get`), or null if it's gone. */
  lobby: () => Promise<unknown>;
  /** The connection, once joined: its room, the server's clock, and its tick (a timer that keeps going in hidden tabs). */
  connection: () => Promise<{ room?: unknown; now(): number; tick?: Tick }>;
  sim: Sim;
  /** Your car's index, the other players' by id, and the AIs' by lobby seat. */
  me: number;
  remote: Map<string, number>;
  aiSeats: ReadonlyMap<number, number>;
  seed: number;
  /** When the lights go green on the server's clock (ms), if the link says. */
  at?: number;
  /** Where the net layers go once they're made (the page's step loop calls them), with the tick to step the race on from then. */
  onNet: (layers: NetLayers) => void;
  timers?: { set: (f: () => void, ms: number) => unknown; clear: (t: unknown) => void };
}

/** The race page's net layers, once in: its car, the AIs (if any), the traffic hits, and the tick. */
export interface NetLayers {
  cars: NetCars;
  rivals: NetRivals | null;
  /** Traffic hits, and bumps and takedown credit between screens: null for a race on its own clock. */
  traffic: NetTraffic | null;
  /** Breakable walls broken (claimed like traffic hits): null for a race on its own clock, or a map without any. */
  walls: NetBreakables | null;
  contact: NetContact | null;
  tick: Tick | null;
}

export async function joinRace(j: RaceJoin): Promise<boolean> {
  const timers = j.timers ?? { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };
  const sim = j.sim;
  let joined = false;
  /** The fallback started the race here: it isn't on the server's clock, so a late join leaves its time alone. */
  let ownClock = false;
  // Not connected in time: race the rest from here (your car goes out once it's in).
  const fallback = timers.set(() => {
    if (!joined && sim.race.phase === 'countdown') {
      sim.race.goTime = sim.time + 3;
      ownClock = true;
    }
  }, FALLBACK_MS);
  try {
    const lobby = await j.lobby();
    const relay = await j.connection();
    if (!lobby || !relay.room) return false;
    // The SDK's room: NetRoom is the part of it the net layers use.
    const room = relay.room as NetRoom;
    const now = () => relay.now();
    const net = new NetCars(room, now, sim, j.me, j.remote, ownClock ? undefined : j.at);
    const race = `${j.seed}:${j.at ?? 0}`;
    const rivals = j.aiSeats.size ? new NetRivals(room, now, sim, j.aiSeats, race) : null;
    joined = true;
    // Traffic hits, bumps and credit say when on the race's clock: a race on its own clock (the
    // fallback started it, or the link had no time) has nothing to compare, so it keeps them to itself.
    const shared = !ownClock && j.at !== undefined;
    const traffic = shared ? new NetTraffic(room, sim, race) : null;
    const walls = shared && sim.world.breakables.n ? new NetBreakables(room, sim, race) : null;
    const contact = shared ? new NetContact(room, sim, carNames(j.me, room.me, j.remote, j.aiSeats)) : null;
    j.onNet({ cars: net, rivals, traffic, walls, contact, tick: relay.tick ? (rate, fn) => relay.tick!(rate, fn) : null });
    // No time from the link: green 3 s from now (once racing, it's too late to matter).
    if (sim.race.phase === 'countdown' && !j.at) sim.race.goTime = sim.time + 3;
    timers.clear(fallback);
    return true;
  } catch (err) {
    // The fallback starts it.
    console.warn('[racecar] the race page could not join its room; racing from here', err);
    return false;
  }
}
