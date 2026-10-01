// Online lobbies (milestone 3): a lobby is a GameRelay room. The lobby itself lives in the room's
// state (`state.lobby`), and only the SDK's host writes it: everyone else sends their actions to
// the host (`room.request('lobby', action)`), which applies them with `apply`, the same rules a
// local lobby runs. The SDK's host and the lobby's host are different things: the SDK's moves
// on its own (a reload, a hidden tab), while the lobby's (who sets the seats and starts) only
// changes when they leave. Whoever holds the SDK's role applies the actions, and `apply` checks
// the lobby's host, so it doesn't matter who that is.
//
// The room lists show each room's lobby summary (`setListing`), and a race keeps your seat: the
// race page joins the room again (a reload resumes the same player), so the room lives through
// many races, as SPEC §10 has it.

import type { LobbyBackend, NetRoute } from './backend';
import { apply, createLobby, DEFAULT_OPTIONS, SEATS, summarize, type Lobby, type LobbyAction, type LobbyOptions, type LobbySummary, type Player, type SeatChoice } from './lobby';

/** What the backend uses of `@gamerelay/sdk`, so tests can stand in a hub of their own. */
export interface RelayLike {
  readonly playerId: string;
  /** The server's clock (ms). */
  now(): number;
  readonly room: RoomLike | null;
  createRoom(options: { maxPlayers?: number; tag?: string; public?: boolean }): Promise<RoomLike>;
  joinRoom(code: string): Promise<RoomLike>;
  listRooms(tag?: string, options?: { includeFull?: boolean }): Promise<{ code: string; players: number; name: string | null; meta: unknown; locked: boolean }[]>;
  /** Your round trip to the server (ms). */
  ping?(): Promise<number>;
}

export interface RoomLike {
  readonly me: string;
  readonly code: string;
  readonly isHost: boolean;
  /** Listed by listRooms (`setAccess({ public })`). */
  readonly isPublic: boolean;
  readonly players: readonly { id: string }[];
  readonly state: Record<string, unknown>;
  setState(patch: Record<string, unknown>): void;
  request(type: string, data?: never): Promise<unknown>;
  onRequest(type: string, handler: (data: unknown, from: string) => unknown): () => void;
  on(event: string, handler: (...args: never[]) => void): () => void;
  setListing(listing: { name?: string | null; meta?: never }): Promise<void>;
  setAccess(access: { public?: boolean }): Promise<void>;
  kick(playerId: string, options?: { ban?: boolean }): Promise<void>;
  leave(): Promise<void>;
  /** A message to everyone else in the room (their `message` event). */
  send?(data: never): void;
  /** The SDK's channel with a player straight to them: across one network, through its TURN relay, or none. */
  lanRoute?(playerId: string): 'direct' | 'relay' | null;
}

/** How often each player measures their ping and tells the room (ms). */
export const PING_MS = 3000;

/** A player's ping as they sent it (`{ type: 'ping', ms }`), checked, or null. */
export function readPing(data: unknown): number | null {
  return obj(data) && data.type === 'ping' && int(data.ms, 0, 60_000) ? data.ms : null;
}

/** The slowest of the routes to everyone else: no channel to someone is the server; none at all, nobody else. */
export function netRoute(routes: ('direct' | 'relay' | null)[]): NetRoute | null {
  if (!routes.length) return null;
  if (routes.includes(null)) return 'server';
  return routes.includes('relay') ? 'relay' : 'lan';
}

/** How far ahead of the Start the lights go green (ms): everyone's race page loads and connects in it. */
export const START_LEAD_MS = 6000;

/** The room tag racecar's lobbies list under. */
export const TAG = 'race';
/** setListing allows 10 changes in a row, then one a second: the listing follows at most this often (ms). */
const LISTING_MS = 1000;

const SEAT_CHOICES: readonly SeatChoice[] = ['open', 'closed', 'ai-easy', 'ai-normal', 'ai-hard'];
const OPTION_KEYS: readonly (keyof LobbyOptions)[] = ['map', 'laps', 'weather', 'time', 'mayhem', 'traffic'];
const OPTION_VALUES: Partial<Record<keyof LobbyOptions, readonly unknown[]>> = {
  weather: ['clear', 'rain', 'random'],
  time: ['day', 'sunset', 'random'],
  mayhem: ['off', 'normal', 'chaos'],
};

const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const int = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

/**
 * An action as another player sent it, checked, with the player it comes from: `from` is the id
 * the server vouches for, so a join is always the sender's own. Null for anything malformed.
 */
export function readAction(data: unknown, from: string): LobbyAction | null {
  if (!obj(data) || typeof data.type !== 'string') return null;
  switch (data.type) {
    case 'seat':
      return int(data.index, 0, SEATS - 1) && SEAT_CHOICES.includes(data.to as SeatChoice) ? { type: 'seat', index: data.index, to: data.to as SeatChoice } : null;
    case 'options': {
      const out: Extract<LobbyAction, { type: 'options' }> = { type: 'options' };
      if (data.name !== undefined) {
        if (!str(data.name, 64)) return null;
        out.name = data.name;
      }
      if (data.visibility !== undefined) {
        // An older build's `private` was by link.
        const v = data.visibility === 'private' ? 'invite' : data.visibility;
        if (!VISIBILITIES.includes(v as Lobby['visibility'])) return null;
        out.visibility = v as Lobby['visibility'];
      }
      if (data.options !== undefined) {
        if (!obj(data.options)) return null;
        const o: Partial<LobbyOptions> = {};
        for (const k of OPTION_KEYS) {
          const v = data.options[k];
          if (v === undefined) continue;
          const ok = k === 'map' ? str(v, 64) : k === 'laps' ? typeof v === 'number' && Number.isFinite(v) : k === 'traffic' ? typeof v === 'boolean' : OPTION_VALUES[k]!.includes(v);
          if (!ok) return null;
          (o as Record<string, unknown>)[k] = v;
        }
        out.options = o;
      }
      return out;
    }
    case 'car':
      return str(data.car, 32) && int(data.paint, 0, 255) ? { type: 'car', car: data.car, paint: data.paint } : null;
    case 'name':
      return str(data.name, 64) ? { type: 'name', name: data.name } : null;
    case 'ready':
      return typeof data.ready === 'boolean' ? { type: 'ready', ready: data.ready } : null;
    case 'racing':
      return typeof data.racing === 'boolean' ? { type: 'racing', racing: data.racing } : null;
    case 'join': {
      const p = data.player;
      if (!obj(p) || !str(p.name, 64) || !str(p.car, 32) || !int(p.paint, 0, 255)) return null;
      return { type: 'join', player: { id: from, name: p.name, car: p.car, paint: p.paint } };
    }
    case 'kick':
      return int(data.index, 0, SEATS - 1) ? { type: 'kick', index: data.index } : null;
    case 'start': {
      if (data.seed !== undefined && !int(data.seed, 0, 2 ** 31 - 1)) return null;
      if (data.at !== undefined && !(typeof data.at === 'number' && Number.isFinite(data.at) && data.at > 0)) return null;
      return { type: 'start', ...(data.seed === undefined ? {} : { seed: data.seed as number }), ...(data.at === undefined ? {} : { at: data.at as number }) };
    }
    case 'leave':
    case 'end':
      return { type: data.type };
  }
  return null;
}

const VISIBILITIES: readonly Lobby['visibility'][] = ['public', 'invite', 'locked'];

const PIPS = /^[penhox]{8}$/;

/** A room's listing as a lobby row, or null if it isn't a racecar lobby's (a host writes it, so it's checked). */
export function readListing(r: { code: string; name: string | null; meta: unknown }): LobbySummary | null {
  const m = r.meta;
  if (!obj(m) || !str(m.map, 64) || !int(m.laps, 1, 9) || (m.phase !== 'lobby' && m.phase !== 'racing') || !str(m.pips, 8) || !PIPS.test(m.pips)) return null;
  if (!int(m.players, 0, SEATS) || !int(m.filled, 0, SEATS)) return null;
  // Invite only or private, by its host's own word (an older host's listing doesn't say: public).
  if (m.visibility !== undefined && m.visibility !== 'public') return null;
  return { id: r.code, name: (r.name ?? '').slice(0, 48) || 'Lobby', map: m.map, laps: m.laps, phase: m.phase, visibility: 'public', pips: m.pips, players: m.players, filled: m.filled };
}

/** The lobby in a room's state, if it holds one. */
function lobbyIn(room: RoomLike): Lobby | null {
  const l = room.state.lobby;
  if (!obj(l) || !Array.isArray(l.seats) || l.seats.length !== SEATS || typeof l.host !== 'string') return null;
  const lobby = l as unknown as Lobby;
  // Kept by an older build, whose `private` was by link (not locked).
  const visibility = (lobby.visibility as string) === 'private' ? 'invite' : lobby.visibility;
  return { ...lobby, visibility, options: { ...DEFAULT_OPTIONS, ...lobby.options } };
}

export class RelayBackend implements LobbyBackend {
  private relay: Promise<RelayLike> | null = null;
  private room: RoomLike | null = null;
  private off: (() => void)[] = [];
  /** Each player's ping in the room you're in (ms), by id. */
  private pings = new Map<string, number>();
  private pingRoom: RoomLike | null = null;
  private stopPings: (() => void) | null = null;
  private listeners = new Set<(lobby: Lobby | null) => void>();
  private listed = '';
  private listingTimer: ReturnType<typeof setTimeout> | null = null;
  private listingAt = 0;

  /** `connect` opens the connection, once, when the backend is first used (the SDK's `GameRelay.connect`). */
  constructor(private connect: () => Promise<RelayLike>) {}

  /** The connection, once there is one (the race page's net layer uses it: net/cars.ts). */
  async connection(): Promise<RelayLike> {
    return this.relayNow();
  }

  /** The room you're in, if any. */
  get current(): RoomLike | null {
    return this.room;
  }

  /** Your player id in online lobbies ('' until connected). */
  you = '';

  youIn(): string {
    return this.you;
  }

  /** Player `player`'s ping to the server (ms), as they last said (yours as you measured it), or null. */
  ping(id: string, player: string): number | null {
    return this.room?.code === id ? (this.pings.get(player) ?? null) : null;
  }

  route(id: string): NetRoute | null {
    const room = this.room?.code === id ? this.room : null;
    if (!room?.lanRoute) return null;
    return netRoute(room.players.filter((p) => p.id !== room.me).map((p) => room.lanRoute!(p.id)));
  }

  private async relayNow(): Promise<RelayLike> {
    this.relay ??= this.connect().then(
      (r) => ((this.you = r.playerId), r),
      (err) => {
        // Try again next time (the server was down, or the network).
        this.relay = null;
        throw err;
      },
    );
    return this.relay;
  }

  async list(): Promise<LobbySummary[]> {
    const relay = await this.relayNow();
    const rows = await relay.listRooms(TAG, { includeFull: true });
    // A room everyone left waits out its idle time (two minutes) before it closes, still listed
    // as it last was: by the server's count, nobody's in it, so it isn't a lobby to join.
    return rows.flatMap((r) => (r.players > 0 && readListing(r)) || []);
  }

  async create(host: Player, init: Parameters<LobbyBackend['create']>[1]): Promise<Lobby> {
    const relay = await this.relayNow();
    await this.leaveRoom();
    const visibility = init.visibility ?? 'public';
    const room = await relay.createRoom({ maxPlayers: SEATS, tag: TAG, public: visibility === 'public' });
    const lobby = createLobby(room.code, { ...host, id: room.me }, { ...init, visibility });
    this.attach(room);
    this.commit(room, lobby);
    return lobby;
  }

  async get(id: string): Promise<Lobby | null> {
    const room = await this.enter(id);
    return room && lobbyIn(room);
  }

  /** The room for lobby `id`: the one you're in, or joined now (a reload resumes your seat). */
  private async enter(id: string): Promise<RoomLike | null> {
    if (this.room?.code === id) return this.room;
    const relay = await this.relayNow();
    if (relay.room?.code === id) {
      this.attach(relay.room);
      return relay.room;
    }
    await this.leaveRoom();
    const room = await relay.joinRoom(id).catch(() => null);
    if (!room) return null;
    this.attach(room);
    return room;
  }

  async send(id: string, action: LobbyAction): Promise<Lobby | null> {
    const room = this.room?.code === id ? this.room : null;
    if (!room) return null;
    // The lights go green a few seconds from now on the server's clock, the same moment for everyone.
    if (action.type === 'start' && action.at === undefined) action = { ...action, at: (await this.relayNow()).now() + START_LEAD_MS };
    let next: Lobby | null;
    if (room.isHost) next = this.applyHere(room, room.me, action);
    else next = (await room.request('lobby', action as never).catch(() => null)) as Lobby | null;
    // Out of the room whether or not you had a seat (you may have been watching: it was full, or racing).
    if (action.type === 'leave') {
      await this.leaveRoom();
      return null;
    }
    return next && obj(next) ? next : null;
  }

  subscribe(id: string, fn: (lobby: Lobby | null) => void): () => void {
    const each = (lobby: Lobby | null) => fn(lobby && lobby.id === id ? lobby : null);
    this.listeners.add(each);
    this.pinging();
    return () => {
      this.listeners.delete(each);
      this.pinging();
    };
  }

  private notify(lobby: Lobby | null): void {
    for (const fn of this.listeners) fn(lobby);
  }

  private attach(room: RoomLike): void {
    if (this.room === room) return;
    this.detach();
    this.room = room;
    this.listed = '';
    this.off = [
      room.onRequest('lobby', (data, from) => {
        const action = readAction(data, from);
        const next = action && this.applyHere(room, from, action);
        // A refusal is null, not an error: the sender's screen just stays as it was.
        return next ?? null;
      }),
      room.on('state', () => this.notify(lobbyIn(room))),
      // Everyone's ping, as each measures it: the SDK only knows your own.
      room.on('message', (data: unknown, from: string) => {
        const ms = readPing(data);
        if (ms !== null) this.pings.set(from, ms);
      }),
      // The host's work: someone gone for good gives up their seat, and a new host checks for
      // anyone who left while nobody was host (and lists the room).
      room.on('player_left', () => room.isHost && this.tidy(room)),
      room.on('host', () => this.tidy(room)),
      room.on('closed', () => {
        if (this.room !== room) return;
        this.detach();
        this.notify(null);
      }),
    ];
    if (room.isHost) this.tidy(room);
    this.pinging();
  }

  /** Pings go round while a lobby screen is watching (the race page attaches the room too, but has no use for them). */
  private pinging(): void {
    const want = this.room && this.listeners.size > 0 ? this.room : null;
    if (want === this.pingRoom) return;
    this.stopPings?.();
    this.stopPings = want ? this.measurePings(want) : null;
    this.pingRoom = want;
  }

  /** Every PING_MS while you're in `room`: your ping, kept and sent to everyone else. Returns a stop. */
  private measurePings(room: RoomLike): () => void {
    const measure = async () => {
      const relay = await this.relayNow().catch(() => null);
      const ms = relay?.ping ? await relay.ping().catch(() => null) : null;
      if (ms === null || this.room !== room) return;
      this.pings.set(room.me, Math.round(ms));
      room.send?.({ type: 'ping', ms: Math.round(ms) } as never);
    };
    void measure();
    const timer = setInterval(() => void measure(), PING_MS);
    return () => clearInterval(timer);
  }

  private detach(): void {
    for (const f of this.off) f();
    this.off = [];
    this.pings.clear();
    this.room = null;
    this.pinging();
    if (this.listingTimer) clearTimeout(this.listingTimer);
    this.listingTimer = null;
  }

  private async leaveRoom(): Promise<void> {
    const room = this.room;
    if (!room) return;
    this.detach();
    // The last one out unlists it, so nothing (quick match included) sends anyone into an empty room.
    if (room.isHost && room.isPublic && room.players.every((p) => p.id === room.me)) await room.setAccess({ public: false }).catch(() => {});
    await room.leave().catch(() => {});
    this.notify(null);
  }

  /** On the host: `actor` does `action`. The lobby after it, or null if it was refused. */
  private applyHere(room: RoomLike, actor: string, action: LobbyAction): Lobby | null {
    const lobby = lobbyIn(room);
    if (!lobby) return null;
    const next = apply(lobby, actor, action);
    if (!next) return null;
    if (action.type === 'kick') {
      const s = lobby.seats[action.index];
      // Out of the room too (not banned: a kick is for this lobby, and they may come back).
      if (s.kind === 'player' && s.id === room.me) {
        // You're the one kicked, and you hold the SDK's role (it moves on reloads), which can't
        // kick itself: hand on the lobby, then go.
        this.commit(room, next);
        void this.leaveRoom();
        return next;
      }
      if (s.kind === 'player') void room.kick(s.id, { ban: false }).catch(() => {});
    }
    this.commit(room, next);
    return next;
  }

  /** On the host: a seat whose player has left the room is open again. */
  private tidy(room: RoomLike): void {
    const was = lobbyIn(room);
    if (!was) return;
    const here = new Set(room.players.map((p) => p.id));
    let lobby = was;
    for (const s of was.seats) if (s.kind === 'player' && !here.has(s.id)) lobby = apply(lobby, s.id, { type: 'leave' }) ?? lobby;
    if (lobby !== was) this.commit(room, lobby);
    else this.relist(room, lobby);
  }

  private commit(room: RoomLike, lobby: Lobby): void {
    room.setState({ lobby: lobby as never });
    this.notify(lobby);
    this.relist(room, lobby);
  }

  /** What the room lists show: the lobby's summary, when it changes, at most once a second. */
  private relist(room: RoomLike, lobby: Lobby): void {
    // Who can join goes in the listing too: if unlisting the room didn't land, the list still leaves it out.
    const { id: _, name, ...meta } = summarize(lobby);
    const { visibility } = meta;
    const key = JSON.stringify([name, meta]);
    if (key === this.listed) return;
    const send = () => {
      this.listingTimer = null;
      this.listingAt = Date.now();
      this.listed = key;
      void room.setListing({ name, meta: meta as never }).catch(() => {});
      // Against the room itself, not what we last sent: a host before us may not have got to it.
      // One that fails is tried again with the next change.
      if (room.isPublic !== (visibility === 'public')) void room.setAccess({ public: visibility === 'public' }).catch(() => (this.listed = ''));
    };
    if (this.listingTimer) return;
    const wait = this.listingAt + LISTING_MS - Date.now();
    if (wait <= 0) send();
    // The last change in the second wins: it reads the lobby again when the timer fires.
    else
      this.listingTimer = setTimeout(() => {
        this.listingTimer = null;
        const now = lobbyIn(room);
        if (now && this.room === room && room.isHost) this.relist(room, now);
      }, wait);
  }
}
