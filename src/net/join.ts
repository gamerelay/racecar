// The race page's join (milestone 3): it stays in its lobby's room, so the seat is still yours
// after the race, and once it's in, your car (and, on the host, the AIs) go out. However long that
// takes: the menu gives up on a slow join, the race page never does. If it isn't in within
// FALLBACK_MS, the race starts from here anyway, and your car goes out whenever it gets in.

import type { Sim } from '../core/sim';
import { NetCars, type NetRoom } from './cars';
import { NetRivals } from './rivals';

/** Not connected by then (ms): the lights go anyway, 3 s on, and you race from here. */
export const FALLBACK_MS = 8000;

export interface RaceJoin {
  /** The lobby's room joined (the backend's own join: `Lobbies.get`), or null if it's gone. */
  lobby: () => Promise<unknown>;
  /** The connection, once joined: its room and the server's clock. */
  connection: () => Promise<{ room?: unknown; now(): number }>;
  sim: Sim;
  /** Your car's index, the other players' by id, and the AIs' by lobby seat. */
  me: number;
  remote: Map<string, number>;
  aiSeats: ReadonlyMap<number, number>;
  seed: number;
  /** When the lights go green on the server's clock (ms), if the link says. */
  at?: number;
  /** Where the net layers go once they're made (the page's step loop calls them). */
  onNet: (net: NetCars, rivals: NetRivals | null) => void;
  timers?: { set: (f: () => void, ms: number) => unknown; clear: (t: unknown) => void };
}

export async function joinRace(j: RaceJoin): Promise<boolean> {
  const timers = j.timers ?? { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };
  const sim = j.sim;
  let joined = false;
  // Not connected in time: race the rest from here (your car doesn't go out).
  const fallback = timers.set(() => {
    if (!joined && sim.race.phase === 'countdown') sim.race.goTime = sim.time + 3;
  }, FALLBACK_MS);
  try {
    const lobby = await j.lobby();
    const relay = await j.connection();
    if (!lobby || !relay.room) return false;
    // The SDK's room: NetRoom is the part of it the net layers use.
    const room = relay.room as NetRoom;
    const now = () => relay.now();
    const net = new NetCars(room, now, sim, j.me, j.remote, j.at);
    const rivals = j.aiSeats.size ? new NetRivals(room, now, sim, j.aiSeats, `${j.seed}:${j.at ?? 0}`) : null;
    joined = true;
    j.onNet(net, rivals);
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
