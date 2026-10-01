// How the players in a lobby's room are doing (milestone 3): each one's ping, how you reach them
// (P2P, a relay or only the server) and who's away. The SDK only knows your own ping, so each lobby
// page measures its own every PING_MS and tells the room; the rest it says itself.
//
// Like a console's party screen: a ping per player, the connection type (Xbox's NAT type,
// here the route), and someone whose connection dropped shown as away rather than as still there.

import type { NetRoute } from './backend';
import type { RoomLike } from './relay';
import { readPing } from './wire';

/** How often each player measures their ping and tells the room (ms). */
export const PING_MS = 3000;
/** A player whose connection has been gone this long is away (ms): a page load between the lobby and a race takes a moment. */
export const AWAY_MS = 4000;

/** The slowest of the routes to everyone else: no channel to someone is the server; nobody else, none at all. */
export function netRoute(routes: ('direct' | 'relay' | null)[]): NetRoute | null {
  if (!routes.length) return null;
  if (routes.includes(null)) return 'server';
  return routes.includes('relay') ? 'relay' : 'p2p';
}

/** One room's players, while you're in it. */
export class Presence {
  private pings = new Map<string, number>();
  /** Since when each player's connection has been gone (ms), by id. */
  private gone = new Map<string, number>();
  private readonly since: number;
  private off: (() => void)[];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private room: RoomLike,
    /** Your round trip to the server (ms), or null if it can't be measured. */
    private measure: () => Promise<number | null>,
    private clock: () => number = Date.now,
  ) {
    this.since = clock();
    this.off = [
      room.on('message', (data: unknown, from: string) => {
        const ms = readPing(data);
        if (ms !== null) this.pings.set(from, ms);
      }),
      room.on('player_disconnected', (id: string) => this.gone.set(id, this.clock())),
      room.on('player_reconnected', (id: string) => this.gone.delete(id)),
      room.on('player_left', (id: string) => {
        this.gone.delete(id);
        this.pings.delete(id);
      }),
    ];
  }

  /** Measuring and sending your ping, while a lobby screen is up (the race page has no use for it). */
  watch(on: boolean): void {
    if (on === !!this.timer) return;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!on) return;
    const tick = async () => {
      const ms = await this.measure().catch(() => null);
      if (ms === null || !this.timer) return;
      this.pings.set(this.room.me, Math.round(ms));
      this.room.send?.({ type: 'ping', ms: Math.round(ms) } as never);
    };
    this.timer = setInterval(() => void tick(), PING_MS);
    void tick();
  }

  /** Player `id`'s ping to the server (ms), as they last said (yours as you measured it), or null. */
  ping(id: string): number | null {
    return this.pings.get(id) ?? null;
  }

  /** Whether player `id`'s connection has been gone a while (the server holds their seat through its grace). */
  away(id: string): boolean {
    const p = this.room.players.find((x) => x.id === id);
    if (!p || p.connected !== false || id === this.room.me) return false;
    return this.clock() - (this.gone.get(id) ?? this.since) >= AWAY_MS;
  }

  /** How your broadcasts reach everyone else, or null with nobody else here. */
  route(): NetRoute | null {
    const room = this.room;
    if (!room.lanRoute) return null;
    return netRoute(room.players.filter((p) => p.id !== room.me).map((p) => room.lanRoute!(p.id)));
  }

  dispose(): void {
    this.watch(false);
    for (const f of this.off) f();
    this.off = [];
  }
}
