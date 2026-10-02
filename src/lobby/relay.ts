// Online lobbies (milestone 3): a lobby is a GameRelay room. The lobby itself lives in the room's
// state (`state.lobby`), and only the SDK's host writes it: everyone else sends their actions to
// the host (`room.request('lobby', action)`), which applies them with `apply`, the same rules a
// local lobby runs.
//
// Two hosts, on purpose. The SDK's host is whoever holds the room's write role: it moves on its
// own (a reload, a dropped connection), and whoever has it applies everyone's actions. The lobby's
// host (`lobby.host`) is the player who sets the seats and starts: it only changes when they leave.
// `apply` checks the lobby's, so it doesn't matter who holds the SDK's.
//
// The room lists show each lobby's summary (`setListing`), and a race keeps your seat: the race page
// joins the room again (a reload resumes the same player), so a room lives through many races, as
// SPEC §10 has it. Each lobby is also a party, for P2P (party.ts), and the lobby screen shows how
// everyone's connected (presence.ts). What other players send is checked first (wire.ts).

import type { LobbyBackend, NetRoute } from './backend';
import { apply, createLobby, SEATS, summarize, type Lobby, type LobbyAction, type LobbySummary, type Player } from './lobby';
import { LobbyParty } from './party';
import { Presence } from './presence';
import { warned } from './warn';
import { readAction, readListing, readLobby } from './wire';

/** The room events racecar listens to: the SDK's names, so a misspelt one doesn't compile (it would never fire). */
export type RoomEvent = 'state' | 'message' | 'player_left' | 'player_disconnected' | 'player_reconnected' | 'host_changed' | 'closed';

/** What the backend uses of `@gamerelay/sdk`, so tests can stand in a hub of their own. */
export interface RelayLike {
  readonly playerId: string;
  /** The server's clock (ms). */
  now(): number;
  readonly room: RoomLike | null;
  createRoom(options: { maxPlayers?: number; tag?: string; public?: boolean; linkOnly?: boolean }): Promise<RoomLike>;
  joinRoom(code: string): Promise<RoomLike>;
  /** Join the room a short link is for, by its id (`?join=<link>`), on an SDK with short links. */
  joinLink?(link: string): Promise<RoomLike>;
  listRooms(tag?: string, options?: { includeFull?: boolean }): Promise<{ code: string; players: number; name: string | null; meta: unknown; locked: boolean }[]>;
  /** Your round trip to the server (ms). */
  ping?(): Promise<number>;
  /** `fn` at a fixed rate on a timer that keeps going in hidden tabs (the race page steps on it: net/stepper.ts). */
  tick?(rate: number, fn: (dt: number, tick: number) => void): () => void;
  /** Your party (the SDK's), if it knows you're in one. */
  readonly party?: { code: string } | null;
  createParty?(): Promise<{ code: string }>;
  joinParty?(code: string): Promise<unknown>;
  leaveParty?(): Promise<void>;
}

export interface RoomLike {
  readonly me: string;
  readonly code: string;
  readonly isHost: boolean;
  /** Listed by listRooms (`setAccess({ public })`). */
  readonly isPublic: boolean;
  /** Joined by its short link only, not its code (an SDK with short links; older ones leave it undefined). */
  readonly linkOnly?: boolean;
  /** `connected`: false while their connection is gone (the server holds their seat through its grace). */
  readonly players: readonly { id: string; connected?: boolean }[];
  readonly state: Record<string, unknown>;
  setState(patch: Record<string, unknown>): void;
  request(type: string, data?: never): Promise<unknown>;
  onRequest(type: string, handler: (data: unknown, from: string) => unknown): () => void;
  on(event: RoomEvent, handler: (...args: never[]) => void): () => void;
  setListing(listing: { name?: string | null; meta?: never }): Promise<void>;
  setAccess(access: { public?: boolean; linkOnly?: boolean }): Promise<void>;
  /** The room's short link (`https://gamerelay.io/<game>/<link>`), on an SDK with short links. */
  shareLink?(): Promise<string>;
  kick(playerId: string, options?: { ban?: boolean }): Promise<void>;
  leave(): Promise<void>;
  /** A message to everyone else in the room (their `message` event). */
  send?(data: never): void;
  /** The SDK's channel with a player straight to them: direct, through its TURN relay, or none. */
  lanRoute?(playerId: string): 'direct' | 'relay' | null;
}

/** How far ahead of the Start the lights go green (ms): everyone's race page loads and connects in it. */
export const START_LEAD_MS = 6000;

/** The room tag racecar's lobbies list under. */
export const TAG = 'race';
/** setListing allows 10 changes in a row, then one a second: the listing follows at most this often (ms). */
const LISTING_MS = 1000;

export class RelayBackend implements LobbyBackend {
  private relay: Promise<RelayLike> | null = null;
  private room: RoomLike | null = null;
  private off: (() => void)[] = [];
  private presence: Presence | null = null;
  private readonly party = new LobbyParty(
    () => this.relayNow().catch(() => null),
    () => this.room,
    (room, lobby) => this.commit(room, lobby),
  );
  private listeners = new Set<(lobby: Lobby | null) => void>();
  private listed = '';
  private listingTimer: ReturnType<typeof setTimeout> | null = null;
  private listingAt = 0;
  /**
   * Joins, creates and leaves run one at a time, in order: the SDK has one room at a time, and its
   * leave doesn't say which room. Overlapping, a late join's leave could take you out of the next.
   */
  private queue: Promise<unknown> = Promise.resolve();
  /** The lobby the screens want you in (a create's is its new room's, once there is one). */
  private wanted: string | null = null;

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

  /** The room's presence, if `id` is the lobby you're in. */
  private presenceOf(id: string): Presence | null {
    return this.room?.code === id ? this.presence : null;
  }

  ping(id: string, player: string): number | null {
    return this.presenceOf(id)?.ping(player) ?? null;
  }

  away(id: string, player: string): boolean {
    return this.presenceOf(id)?.away(player) ?? false;
  }

  route(id: string): NetRoute | null {
    return this.presenceOf(id)?.route() ?? null;
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

  /** `fn` after every room change before it (whether those worked or not). */
  private inTurn<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  async create(host: Player, init: Parameters<LobbyBackend['create']>[1]): Promise<Lobby> {
    this.wanted = null;
    return this.inTurn(() => this.createNow(host, init));
  }

  private async createNow(host: Player, init: Parameters<LobbyBackend['create']>[1]): Promise<Lobby> {
    const relay = await this.relayNow();
    await this.leaveRoom();
    // Out of any party first (a fresh page's SDK doesn't know it's in one): a leader's new room
    // would pull its old lobby's players in.
    await this.party.leave();
    const visibility = init.visibility ?? 'public';
    // Invite only: nobody gets in by guessing the 4-letter code, only by the lobby's link.
    const room = await relay.createRoom({ maxPlayers: SEATS, tag: TAG, public: visibility === 'public', linkOnly: visibility !== 'public' });
    const party = await this.party.create();
    const lobby: Lobby = { ...createLobby(room.code, { ...host, id: room.me }, { ...init, visibility }), ...(party ? { party } : {}) };
    this.wanted = room.code;
    this.attach(room);
    this.commit(room, lobby);
    return lobby;
  }

  /** The last lobby a room's state held that passed its checks, by room code. */
  private good: { code: string; lobby: Lobby } | null = null;

  /**
   * The lobby in a room's state. One that fails its checks (whoever holds the SDK's host role wrote
   * it, and that's any player) isn't the lobby gone: the screens keep the last good one, and the
   * next host to write it writes a good one again. Only a room with no lobby in its state has none.
   */
  private lobbyOf(room: RoomLike): Lobby | null {
    const lobby = readLobby(room.state);
    if (lobby) {
      this.good = { code: room.code, lobby };
      return lobby;
    }
    if (room.state.lobby !== undefined && this.good?.code === room.code) return this.good.lobby;
    return null;
  }

  async get(id: string): Promise<Lobby | null> {
    this.wanted = id;
    const room = await this.inTurn(() => this.enter(id));
    return room && this.lobbyOf(room);
  }

  /**
   * Into the lobby a short link is for (`?join=<link>`): its id (the room's code), or null if the
   * link's room is gone or this SDK has no short links.
   */
  async joinLink(link: string): Promise<string | null> {
    const relay = await this.relayNow();
    if (!relay.joinLink) return null;
    const room = await this.inTurn(async () => {
      await this.leaveRoom();
      const r = await relay.joinLink!(link).catch(warned('joining by a link failed', null));
      if (r) {
        this.wanted = r.code;
        this.attach(r);
      }
      return r;
    });
    return room?.code ?? null;
  }

  /** Lobby `id`'s short link, if you're in it and the SDK has them. */
  async shareLink(id: string): Promise<string | null> {
    const room = this.room?.code === id ? this.room : null;
    return (await room?.shareLink?.().catch(warned('getting the lobby link failed', null))) ?? null;
  }

  /** The room for lobby `id`: the one you're in, or joined now (a reload resumes your seat). */
  private async enter(id: string): Promise<RoomLike | null> {
    // Given up on before its turn came.
    if (this.wanted !== id) return null;
    if (this.room?.code === id) return this.room;
    const relay = await this.relayNow();
    if (relay.room?.code === id) {
      this.attach(relay.room);
      return relay.room;
    }
    await this.leaveRoom();
    const room = await relay.joinRoom(id).catch(warned('joining a lobby failed', null));
    if (!room) return null;
    this.attach(room);
    // Given up on while it joined (Esc, or too slow for the screen): out again, before anything
    // after it runs, so this leave can only be this room's.
    if (this.wanted !== id) {
      await this.leaveRoom();
      return null;
    }
    return room;
  }

  /**
   * The screens no longer want lobby `id` (Esc while joining, or a join too slow to wait for): out
   * of it if you got in, or as soon as you do. Only the menu gives up on a lobby; the race page
   * stays in its room however long joining takes.
   */
  async abandon(id: string): Promise<void> {
    if (this.wanted === id) this.wanted = null;
    await this.inTurn(async () => {
      if (this.room?.code === id && this.wanted !== id) await this.leaveRoom();
    });
  }

  async send(id: string, action: LobbyAction): Promise<Lobby | null> {
    const room = this.room?.code === id ? this.room : null;
    if (!room) return null;
    // The lights go green a few seconds from now on the server's clock, the same moment for
    // everyone: the first race's start, and the next one's after a vote.
    if ((action.type === 'start' || action.type === 'next') && action.at === undefined) action = { ...action, at: (await this.relayNow()).now() + START_LEAD_MS };
    let next: Lobby | null;
    if (room.isHost) next = this.applyHere(room, room.me, action);
    // The host's answer is another player's word, like the room's state.
    else next = readLobby({ lobby: await room.request('lobby', action as never).catch(warned(`the host didn't answer ${action.type}`, null)) });
    // Out of the room whether or not you had a seat (you may have been watching: it was full, or racing).
    if (action.type === 'leave') {
      if (this.wanted === id) this.wanted = null;
      await this.inTurn(async () => {
        if (this.room === room) await this.leaveRoom();
      });
      return null;
    }
    return next;
  }

  subscribe(id: string, fn: (lobby: Lobby | null) => void): () => void {
    const each = (lobby: Lobby | null) => fn(lobby && lobby.id === id ? lobby : null);
    this.listeners.add(each);
    this.presence?.watch(true);
    return () => {
      this.listeners.delete(each);
      this.presence?.watch(this.listeners.size > 0);
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
    this.presence = new Presence(room, async () => {
      const relay = await this.relayNow();
      return relay.ping ? relay.ping() : null;
    });
    // Pings go round while a lobby screen watches (the race page attaches the room too, with no use for them).
    this.presence.watch(this.listeners.size > 0);
    this.off = [
      room.onRequest('lobby', (data, from) => {
        const action = readAction(data, from);
        const next = action && this.applyHere(room, from, action);
        // A refusal is null, not an error: the sender's screen just stays as it was.
        return next ?? null;
      }),
      room.on('state', () => {
        void this.party.follow();
        this.notify(this.lobbyOf(room));
      }),
      // The SDK host's work: someone gone for good gives up their seat, and whoever the role moves
      // to checks for anyone who left while nobody held it (and lists the room).
      room.on('player_left', () => room.isHost && this.tidy(room)),
      room.on('host_changed', () => room.isHost && this.tidy(room)),
      room.on('closed', () => {
        if (this.room !== room) return;
        this.detach();
        // Kicked, or the room closed: out of its party too.
        void this.party.leave();
        this.notify(null);
      }),
    ];
    if (room.isHost) this.tidy(room);
    void this.party.follow();
  }

  private detach(): void {
    for (const f of this.off) f();
    this.off = [];
    this.presence?.dispose();
    this.presence = null;
    this.room = null;
    if (this.listingTimer) clearTimeout(this.listingTimer);
    this.listingTimer = null;
  }

  private async leaveRoom(): Promise<void> {
    const room = this.room;
    if (!room) return;
    this.detach();
    await this.party.leave();
    // The last one out unlists it, so nothing (quick match included) sends anyone into an empty room.
    if (room.isHost && room.isPublic && room.players.every((p) => p.id === room.me)) await room.setAccess({ public: false }).catch(() => {});
    await room.leave().catch(warned('leaving a lobby failed', undefined));
    this.notify(null);
  }

  /** On the SDK's host: `actor` does `action`. The lobby after it, or null if it was refused. */
  private applyHere(room: RoomLike, actor: string, action: LobbyAction): Lobby | null {
    const lobby = this.lobbyOf(room);
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
        if (this.wanted === room.code) this.wanted = null;
        void this.inTurn(async () => {
          if (this.room === room) await this.leaveRoom();
        });
        return next;
      }
      if (s.kind === 'player') void room.kick(s.id, { ban: false }).catch(warned('a kick failed', undefined));
    }
    this.commit(room, next);
    return next;
  }

  /** On the SDK's host: a seat whose player has left the room is open again. */
  private tidy(room: RoomLike): void {
    const was = this.lobbyOf(room);
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
      void room.setListing({ name, meta: meta as never }).catch(warned('updating the listing failed', undefined));
      // Against the room itself, not what we last sent: a host before us may not have got to it.
      // One that fails is tried again with the next change.
      const listed = visibility === 'public';
      // Unlisted is link-only too (on an SDK that has it: `linkOnly` is undefined on older ones).
      const linkWrong = room.linkOnly !== undefined && room.linkOnly !== !listed;
      if (room.isPublic !== listed || linkWrong) void room.setAccess({ public: listed, linkOnly: !listed }).catch(() => (this.listed = ''));
    };
    if (this.listingTimer) return;
    const wait = this.listingAt + LISTING_MS - Date.now();
    if (wait <= 0) send();
    // The last change in the second wins: it reads the lobby again when the timer fires.
    else
      this.listingTimer = setTimeout(() => {
        this.listingTimer = null;
        const now = this.lobbyOf(room);
        if (now && this.room === room && room.isHost) this.relist(room, now);
      }, wait);
  }
}
