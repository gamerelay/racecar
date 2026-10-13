import { describe, expect, test } from 'bun:test';
import { Lobbies, LocalBackend, LOCAL_ID } from '../src/lobby/backend';
import { AWAY_MS, netRoute, PING_MS, Presence } from '../src/lobby/presence';
import { RelayBackend, serverLocked, type RelayLike, type RoomLike } from '../src/lobby/relay';
import { readAction, readListing, readLobby, readPing } from '../src/lobby/wire';
import { createLobby, type Lobby } from '../src/lobby/lobby';
import { raceFromLobby } from '../src/ui/setup';

// Online lobbies (milestone 3): a lobby is a GameRelay room, written only by the SDK's host, which
// applies everyone's actions with the lobby rules. These run against a stand-in for the server: a
// hub of rooms, with the SDK's host election (the longest-present player still connected).

type Handler = (...args: never[]) => void;

class Hub {
  rooms = new Map<string, FakeRoom>();
  /** Each player's round trip to the server, as `relay.ping()` measures it. */
  pings = new Map<string, number>();
  /** The SDK's channel between two players (`a>b`), as `room.lanRoute` says it. */
  routes = new Map<string, 'direct' | 'relay'>();
  /** setAccess calls to fail before one gets through. */
  failAccess = 0;
  failListing = 0;
  /** Parties, by code: who's in each. */
  parties = new Map<string, Set<string>>();
  /** How long a party join takes (ms). */
  joinMs = 0;
  /** How long joining a room takes (ms). */
  roomMs = 0;
  /** Each room made, with the party its maker was in then (a leader's room pulls its party in). */
  made: { code: string; party?: string }[] = [];
  private n = 0;
  code(): string {
    return `R${++this.n}`;
  }
}

class FakeRoom {
  state: Record<string, unknown> = {};
  members: FakeClient[] = [];
  listing: { name?: string | null; meta?: unknown } = {};
  public = true;
  /** A short link's room: its code doesn't get newcomers in. */
  linkOnly = false;
  /** Nobody new may join (`setAccess({ locked })`); its own players can come back. */
  locked = false;
  /** Who's banned from it (a kick with `ban`), until it closes. */
  banned = new Set<string>();
  /** Every kick, as the host sent it. */
  kicks: { id: string; ban: boolean; message?: string }[] = [];
  constructor(
    readonly hub: Hub,
    readonly code: string,
  ) {}
  get host(): FakeClient | undefined {
    return this.members.find((m) => m.connected);
  }
  emit(event: string, ...args: unknown[]): void {
    for (const m of this.members) m.fire(event, ...args);
  }
  /**
   * `c`'s connection gone past the server's grace (a hidden tab, a laptop asleep): out of the room
   * (an empty one stays, state and all, for its idle time), and when its SDK reconnects it can't
   * resume, so it hears `closed('lost')`.
   */
  timeOut(relay: FakeRelay): void {
    const c = relay.room!;
    // (The SDK forgets the room before it says so.)
    relay.room = null;
    const wasHost = this.host === c;
    this.members = this.members.filter((m) => m !== c);
    this.emit('player_left', c.id, 'timeout');
    if (wasHost && this.host) this.emit('host_changed', this.host.id, c.id);
    c.fire('closed', 'lost');
  }
  remove(c: FakeClient): void {
    const wasHost = this.host === c;
    this.members = this.members.filter((m) => m !== c);
    this.emit('player_left', c.id);
    // As the SDK says it: `host_changed` to everyone, with the new host's id.
    if (wasHost && this.host) this.emit('host_changed', this.host.id, c.id);
    if (!this.members.length) this.hub.rooms.delete(this.code);
  }
}

/** One player's view of one room. */
class FakeClient implements RoomLike {
  connected = true;
  /** The SDK it came from, which forgets the room when it's kicked. */
  relay: FakeRelay | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private answers = new Map<string, (data: unknown, from: string) => unknown>();
  constructor(
    readonly room: FakeRoom,
    readonly me: string,
  ) {}
  get id() {
    return this.me;
  }
  get code() {
    return this.room.code;
  }
  get isHost() {
    return this.room.host === this;
  }
  get isPublic() {
    return this.room.public;
  }
  get linkOnly() {
    return this.room.linkOnly;
  }
  get locked() {
    return this.room.locked;
  }
  /** The room's short link, as the SDK's (`gamerelay.io/<game>/<link>`): the link is its code backwards and padded. */
  async shareLink(): Promise<string> {
    return `https://gamerelay.io/racer/${linkOf(this.room.code)}`;
  }
  get players() {
    return this.room.members.map((m) => ({ id: m.id, connected: m.connected }));
  }
  get state() {
    return this.room.state;
  }
  fire(event: string, ...args: unknown[]): void {
    for (const h of this.handlers.get(event) ?? []) (h as (...a: unknown[]) => void)(...args);
  }
  setState(patch: Record<string, unknown>): void {
    if (!this.isHost) throw new Error('not host');
    this.room.state = { ...this.room.state, ...structuredClone(patch) };
    this.room.emit('state', this.room.state);
  }
  async request(type: string, data?: never): Promise<unknown> {
    const host = this.room.host!;
    return structuredClone(await host.answers.get(type)!(structuredClone(data), this.me));
  }
  onRequest(type: string, handler: (data: unknown, from: string) => unknown): () => void {
    this.answers.set(type, handler);
    return () => this.answers.delete(type);
  }
  on(event: string, handler: Handler): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return () => this.handlers.get(event)!.delete(handler);
  }
  async setListing(listing: { name?: string | null; meta?: never }): Promise<void> {
    if (this.room.hub.failListing > 0) {
      this.room.hub.failListing--;
      throw new Error('rate_limited');
    }
    if (!this.isHost) throw new Error('room.setListing: only the host can do this');
    this.room.listing = structuredClone(listing);
  }
  async setAccess(access: { public?: boolean; linkOnly?: boolean; locked?: boolean }): Promise<void> {
    if (this.room.hub.failAccess > 0) {
      this.room.hub.failAccess--;
      throw new Error('rate_limited');
    }
    if (access.public !== undefined) this.room.public = access.public;
    if (access.linkOnly !== undefined) this.room.linkOnly = access.linkOnly;
    if (access.locked !== undefined) this.room.locked = access.locked;
  }
  send(data: never): void {
    for (const m of this.room.members) if (m !== this) m.fire('message', structuredClone(data), this.me);
  }
  lanRoute(playerId: string): 'direct' | 'relay' | null {
    return this.room.hub.routes.get(`${this.me}>${playerId}`) ?? null;
  }
  async kick(playerId: string, options: { ban?: boolean; message?: string } = {}): Promise<void> {
    if (playerId === this.me) throw new Error("the host can't kick itself");
    const c = this.room.members.find((m) => m.id === playerId);
    if (!c) return;
    // The SDK bans by default.
    const ban = options.ban ?? true;
    this.room.kicks.push({ id: playerId, ban, message: options.message });
    if (ban) this.room.banned.add(playerId);
    // (The SDK forgets the room before it says so.)
    if (c.relay?.room === c) c.relay.room = null;
    c.fire('closed', 'kicked', options.message);
    this.room.remove(c);
  }
  async transferHost(playerId: string): Promise<void> {
    if (!this.isHost) throw new Error('not_host');
    const c = this.room.members.find((m) => m.id === playerId && m.connected);
    if (!c) throw new Error('player_not_found');
    const was = this.room.host!;
    this.room.members = [c, ...this.room.members.filter((m) => m !== c)];
    this.room.emit('host_changed', c.id, was.id);
  }
  async leave(): Promise<void> {
    // (The SDK forgets the room it left.)
    if (this.relay?.room === this) this.relay.room = null;
    this.room.remove(this);
  }
}

class FakeRelay implements RelayLike {
  room: FakeClient | null = null;
  now = () => 1_000_000;
  async ping(): Promise<number> {
    return this.hub.pings.get(this.playerId) ?? 20;
  }
  /** A fresh page: the server has you in a party still, but the SDK doesn't know it until it joins one. */
  fresh = false;
  get party(): { code: string } | null {
    if (this.fresh) return null;
    for (const [code, members] of this.hub.parties) if (members.has(this.playerId)) return { code };
    return null;
  }
  async createParty(): Promise<{ code: string }> {
    await this.leaveParty();
    const code = `P${this.hub.code()}`;
    this.hub.parties.set(code, new Set([this.playerId]));
    return { code };
  }
  async joinParty(code: string): Promise<unknown> {
    if (this.hub.joinMs) await new Promise((r) => setTimeout(r, this.hub.joinMs));
    const p = this.hub.parties.get(code);
    if (!p) throw new Error('not_found');
    this.fresh = false;
    await this.leaveParty();
    p.add(this.playerId);
    return { code };
  }
  async leaveParty(): Promise<void> {
    for (const [code, members] of this.hub.parties) {
      members.delete(this.playerId);
      if (!members.size) this.hub.parties.delete(code);
    }
  }
  constructor(
    readonly hub: Hub,
    readonly playerId: string,
  ) {}
  async createRoom(o: { public?: boolean; linkOnly?: boolean }): Promise<RoomLike> {
    const room = new FakeRoom(this.hub, this.hub.code());
    this.hub.made.push({ code: room.code, party: [...this.hub.parties].find(([, m]) => m.has(this.playerId))?.[0] });
    room.public = o.public ?? true;
    room.linkOnly = o.linkOnly ?? false;
    this.hub.rooms.set(room.code, room);
    return this.enter(room);
  }
  async joinRoom(code: string): Promise<RoomLike> {
    if (this.hub.roomMs) await new Promise((r) => setTimeout(r, this.hub.roomMs));
    const room = this.hub.rooms.get(code);
    if (!room) throw Object.assign(new Error('room_not_found'), { code: 'room_not_found' });
    const back = room.members.find((m) => m.id === this.playerId);
    if (back) {
      // A reload: the same player, back in their seat.
      back.connected = true;
      return (this.room = back);
    }
    // A link-only room: its code finds nothing for a newcomer, as for a wrong one.
    if (room.linkOnly) throw Object.assign(new Error('room_not_found'), { code: 'room_not_found' });
    if (room.banned.has(this.playerId)) throw Object.assign(new Error('banned'), { code: 'banned' });
    if (room.locked) throw Object.assign(new Error('locked'), { code: 'locked' });
    return this.enter(room);
  }
  async joinLink(link: string): Promise<RoomLike> {
    if (this.hub.roomMs) await new Promise((r) => setTimeout(r, this.hub.roomMs));
    const room = [...this.hub.rooms.values()].find((r) => linkOf(r.code) === link);
    if (!room) throw Object.assign(new Error('room_not_found'), { code: 'room_not_found' });
    const back = room.members.find((m) => m.id === this.playerId);
    if (back) return back;
    if (room.banned.has(this.playerId)) throw Object.assign(new Error('banned'), { code: 'banned' });
    if (room.locked) throw Object.assign(new Error('locked'), { code: 'locked' });
    return this.enter(room);
  }
  private enter(room: FakeRoom): FakeClient {
    const c = new FakeClient(room, this.playerId);
    c.relay = this;
    room.members.push(c);
    this.room = c;
    // As the SDK says it: the player, not just their id (a host may kick them on it: a ban).
    room.emit('player_joined', { id: c.id });
    return c;
  }
  async listRooms() {
    return [...this.hub.rooms.values()].filter((r) => r.public).map((r) => ({ code: r.code, players: r.members.length, name: r.listing.name ?? null, meta: r.listing.meta ?? null, locked: false }));
  }
}

const player = (name: string) => ({ id: '', name, car: 'coupe', paint: 0 });
/** A fake room's short-link id (11 characters, from its code). */
const linkOf = (code: string) => code.split('').reverse().join('').padEnd(11, 'x');
const settle = () => new Promise((r) => setTimeout(r, 0));

function players(hub: Hub, ...ids: string[]) {
  return ids.map((id) => {
    const relay = new FakeRelay(hub, id);
    return { relay, backend: new RelayBackend(async () => relay) };
  });
}

describe('back after the connection was gone a while', () => {
  // The server holds a dropped player's seat 30 s; past that a lone host's room is empty but still
  // there (its idle time), with the lobby in its state. Coming back, the SDK can't resume it.
  for (const visibility of ['invite', 'public', 'locked'] as const)
    test(`alone in a ${visibility} lobby: back in it, in your seat, still its host`, async () => {
      const hub = new Hub();
      const [ada] = players(hub, 'ada');
      const lobby = await ada.backend.create(player('Ada'), { visibility, online: true });
      await ada.backend.shareLink(lobby.id);
      const seen: (string | null)[] = [];
      ada.backend.subscribe(lobby.id, (l) => seen.push(l ? l.host : null));
      // Long enough for the listing to settle (a Private one isn't locked with nobody else to keep out).
      await new Promise((r) => setTimeout(r, 1100));
      hub.rooms.get(lobby.id)!.timeOut(ada.relay);
      for (let n = 0; n < 5; n++) await settle();
      const back = await ada.backend.get(lobby.id);
      expect(back?.host).toBe('ada');
      expect(back?.seats[0]).toMatchObject({ kind: 'player', id: 'ada' });
      expect(ada.backend.current?.code).toBe(lobby.id);
      expect(ada.backend.current?.isHost).toBe(true);
      // The screen never saw it gone (that's the title screen).
      expect(seen).not.toContain(null);
    });

  test("a guest gone too long from someone else's Private lobby is kept out, and told why", async () => {
    const hub = new Hub();
    const [ada, bo] = players(hub, 'ada', 'bo');
    // Invite only first: Bo comes in by its link (the way into a room that isn't Public), then it's made Private.
    const lobby = await ada.backend.create(player('Ada'), { visibility: 'invite', online: true });
    expect(await bo.backend.joinLink(linkOf(lobby.id))).toBe(lobby.id);
    await bo.backend.send(lobby.id, { type: 'join', player: player('BO') });
    await new Promise((r) => setTimeout(r, 1100));
    await ada.backend.send(lobby.id, { type: 'options', visibility: 'locked' });
    await new Promise((r) => setTimeout(r, 1100));
    expect(hub.rooms.get(lobby.id)!.locked).toBe(true);
    hub.rooms.get(lobby.id)!.timeOut(bo.relay);
    for (let n = 0; n < 5; n++) await settle();
    expect(bo.backend.why(lobby.id)).toEqual({ kind: 'locked' });
  });

  test('back as a new player (the SDK lost its token): you are who the SDK says, and sitting down makes the lobby yours', async () => {
    const hub = new Hub();
    const [ada] = players(hub, 'ada');
    const lobby = await ada.backend.create(player('Ada'), { visibility: 'invite', online: true });
    await ada.backend.shareLink(lobby.id);
    (ada.relay as { playerId: string }).playerId = 'ada-2';
    hub.rooms.get(lobby.id)!.timeOut(ada.relay);
    for (let n = 0; n < 5; n++) await settle();
    expect(ada.backend.youIn()).toBe('ada-2');
    // Your old seat was freed (nobody's in it), the lobby hostless until you sit (the screen does).
    const sat = await ada.backend.send(lobby.id, { type: 'join', player: { ...player('Ada'), id: 'ada-2' } });
    expect(sat?.host).toBe('ada-2');
    expect(sat?.seats.filter((s) => s.kind === 'player').map((s) => s.kind === 'player' && s.id)).toEqual(['ada-2']);
  });
});

describe("Private's lock at the server", () => {
  const lone = createLobby('L1', { id: 'ada', name: 'ADA', car: 'coupe', paint: 0 }, { visibility: 'locked' });
  test('locked while the lobby has a host and someone else is in the room', () => {
    expect(serverLocked(lone, ['ada', 'bo'])).toBe(true);
    expect(serverLocked({ ...lone, visibility: 'invite' }, ['ada', 'bo'])).toBe(false);
  });
  test("open with nobody else in it, so its host can come back after a long disconnect (the room outlives them, the SDK can't resume)", () => {
    expect(serverLocked(lone, ['ada'])).toBe(false);
  });
  test("open once the lobby has no host, as canJoin is: whoever sits down gets it", () => {
    expect(serverLocked({ ...lone, host: '' }, ['bo', 'cy'])).toBe(false);
  });
});

describe('online lobbies', () => {
  test("a lobby is a room: listed with its summary, joined by its code, everyone's changes seen by all", async () => {
    const hub = new Hub();
    const [ada, bo] = players(hub, 'ada', 'bo');
    const lobby = await ada.backend.create(player('ADA'), { name: 'Friday wrecks', options: { map: 'backroads/valley' } });
    expect(lobby.host).toBe('ada');
    await settle();
    const rows = await bo.backend.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: lobby.id, name: 'Friday wrecks', map: 'backroads/valley', phase: 'lobby', players: 1 });

    const seen: string[] = [];
    ada.backend.subscribe(lobby.id, (l) => l && seen.push(l.seats[1].kind));
    expect(await bo.backend.get(lobby.id)).not.toBeNull();
    const joined = await bo.backend.send(lobby.id, { type: 'join', player: { ...player('BO'), id: 'bo' } });
    expect(joined?.seats[1]).toMatchObject({ kind: 'player', id: 'bo', name: 'BO', ready: false });
    expect(seen).toContain('player');

    // Bo readies; Ada (the lobby's host) sets a seat and the laps; both see both.
    await bo.backend.send(lobby.id, { type: 'ready', ready: true });
    await ada.backend.send(lobby.id, { type: 'seat', index: 2, to: 'ai-hard' });
    await ada.backend.send(lobby.id, { type: 'options', options: { laps: 4 } });
    const fromBo = await bo.backend.get(lobby.id);
    expect(fromBo?.seats[1]).toMatchObject({ ready: true });
    expect(fromBo?.seats[2]).toEqual({ kind: 'ai', difficulty: 2 });
    expect(fromBo?.options.laps).toBe(4);
  });

  test("the lobby's rules hold online: only its host sets seats and starts, and a join is always the sender's own", async () => {
    const hub = new Hub();
    const [ada, bo] = players(hub, 'ada', 'bo');
    const lobby = await ada.backend.create(player('ADA'), {});
    await bo.backend.get(lobby.id);
    // Bo claims to be someone else: the host seats Bo, as the server says it's Bo.
    const joined = await bo.backend.send(lobby.id, { type: 'join', player: { ...player('BO'), id: 'ada' } });
    expect(joined?.seats[1]).toMatchObject({ id: 'bo' });
    expect(await bo.backend.send(lobby.id, { type: 'seat', index: 3, to: 'closed' })).toBeNull();
    expect(await bo.backend.send(lobby.id, { type: 'start' })).toBeNull();
    expect((await ada.backend.get(lobby.id))?.seats[3]).toEqual({ kind: 'open' });
  });

  test('the start carries a seed, so everyone races the same race, each from their own seat', async () => {
    const hub = new Hub();
    const [ada, bo] = players(hub, 'ada', 'bo');
    const lobby = await ada.backend.create(player('ADA'), {});
    await bo.backend.get(lobby.id);
    await bo.backend.send(lobby.id, { type: 'join', player: player('BO') });
    await bo.backend.send(lobby.id, { type: 'ready', ready: true });
    const started = await ada.backend.send(lobby.id, { type: 'start', seed: 1234 });
    expect(started?.phase).toBe('racing');
    const seenByBo = (await bo.backend.get(lobby.id))!;
    const a = raceFromLobby(started!, 'ada', started!.seed!);
    const b = raceFromLobby(seenByBo, 'bo', seenByBo.seed!);
    expect(b.seed).toBe(1234);
    expect({ ...a, seats: '', car: '' }).toEqual({ ...b, seats: '', car: '' });
    // Each drives their own seat (the other's is empty until remote cars land).
    expect(a.seats.slice(0, 2)).toBe('px');
    expect(b.seats.slice(0, 2)).toBe('xp');
  });

  test('when the SDK host changes, the lobby carries on: the next one applies actions, and the lobby host stays', async () => {
    const hub = new Hub();
    const [ada, bo, cy] = players(hub, 'ada', 'bo', 'cy');
    const lobby = await ada.backend.create(player('ADA'), {});
    for (const p of [bo, cy]) {
      await p.backend.get(lobby.id);
      await p.backend.send(lobby.id, { type: 'join', player: player(p.relay.playerId) });
    }
    // Ada's page reloads (a race): she's disconnected for a moment and the role moves to Bo.
    hub.rooms.get(lobby.id)!.members[0].connected = false;
    expect(bo.relay.room!.isHost).toBe(true);
    const r = await cy.backend.send(lobby.id, { type: 'ready', ready: true });
    expect(r?.seats[2]).toMatchObject({ id: 'cy', ready: true });
    expect(r?.host).toBe('ada');
    // Bo can't start: he holds the SDK's role, not the lobby.
    expect(await bo.backend.send(lobby.id, { type: 'start' })).toBeNull();
  });

  test('someone gone for good gives up their seat, and the lobby host passes on when they leave', async () => {
    const hub = new Hub();
    const [ada, bo, cy] = players(hub, 'ada', 'bo', 'cy');
    const lobby = await ada.backend.create(player('ADA'), {});
    for (const p of [bo, cy]) {
      await p.backend.get(lobby.id);
      await p.backend.send(lobby.id, { type: 'join', player: player(p.relay.playerId) });
    }
    // Cy closes the tab: the room drops her (after the SDK's grace), and the host opens her seat.
    await hub.rooms.get(lobby.id)!.members[2].leave();
    expect((await ada.backend.get(lobby.id))?.seats[2]).toEqual({ kind: 'open' });
    // Ada leaves: Bo hosts the lobby, and Ada's view of it is gone.
    let adaSees: unknown = 'still there';
    ada.backend.subscribe(lobby.id, (l) => (adaSees = l));
    expect(await ada.backend.send(lobby.id, { type: 'leave' })).toBeNull();
    expect(adaSees).toBeNull();
    const now = await bo.backend.get(lobby.id);
    expect(now?.host).toBe('bo');
    expect(now?.seats[0]).toEqual({ kind: 'open' });
  });

  test("a lobby in state that fails its checks isn't the lobby gone: every screen keeps the last good one", async () => {
    const hub = new Hub();
    const [ada, bo] = players(hub, 'ada', 'bo');
    const lobby = await ada.backend.create(player('ADA'), {});
    await bo.backend.get(lobby.id);
    await bo.backend.send(lobby.id, { type: 'join', player: player('BO') });
    const seen: unknown[] = [];
    bo.backend.subscribe(lobby.id, (l) => seen.push(l));
    const room = hub.rooms.get(lobby.id)!;
    const good = room.state.lobby as { seats: Record<string, unknown>[] };
    // Whoever holds the host role writes a seat no plate can name.
    const seats = good.seats.map((x, i) => (i === 1 ? { ...x, name: '!!' } : x));
    room.members.find((m) => m.id === 'ada')!.setState({ lobby: { ...good, seats } });
    await settle();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((l) => l !== null)).toBe(true);
    expect((await bo.backend.get(lobby.id))?.seats[1]).toMatchObject({ kind: 'player', name: 'BO' });
  });

  test("a kick opens the seat and puts them out of the room, and the listing follows the lobby's visibility", async () => {
    const hub = new Hub();
    const [ada, bo] = players(hub, 'ada', 'bo');
    const lobby = await ada.backend.create(player('ADA'), {});
    await bo.backend.get(lobby.id);
    await bo.backend.send(lobby.id, { type: 'join', player: player('BO') });
    let boSees: unknown = 'still there';
    bo.backend.subscribe(lobby.id, (l) => (boSees = l));
    const after = await ada.backend.send(lobby.id, { type: 'kick', index: 1 });
    await settle();
    expect(after?.seats[1]).toEqual({ kind: 'open' });
    expect(boSees).toBeNull();
    expect(hub.rooms.get(lobby.id)!.members.map((m) => m.id)).toEqual(['ada']);

    await new Promise((r) => setTimeout(r, 1100));
    await ada.backend.send(lobby.id, { type: 'options', visibility: 'invite' });
    await new Promise((r) => setTimeout(r, 1100));
    expect(hub.rooms.get(lobby.id)!.public).toBe(false);
    expect(await bo.backend.list()).toEqual([]);
  });

  test('the first kick lets them back; the second bans them from the room, even after the SDK host changed', async () => {
    const hub = new Hub();
    const [ada, bo, cy] = players(hub, 'ada', 'bo', 'cy');
    const lobby = await ada.backend.create(player('ADA'), {});
    await cy.backend.get(lobby.id);
    await cy.backend.send(lobby.id, { type: 'join', player: player('CY') });
    await bo.backend.get(lobby.id);
    await bo.backend.send(lobby.id, { type: 'join', player: player('BO') });
    await ada.backend.send(lobby.id, { type: 'kick', index: 2 });
    const room = hub.rooms.get(lobby.id)!;
    expect(room.kicks.at(-1)).toEqual({ id: 'bo', ban: false, message: 'Removed by the host' });
    // Back in, and kicked again, with Cy holding the SDK's role now (Ada reloaded).
    expect(await bo.backend.get(lobby.id)).not.toBeNull();
    await bo.backend.send(lobby.id, { type: 'join', player: player('BO') });
    room.members = [room.members.find((m) => m.id === 'cy')!, ...room.members.filter((m) => m.id !== 'cy')];
    await ada.backend.send(lobby.id, { type: 'kick', index: 2 });
    expect(room.kicks.at(-1)).toEqual({ id: 'bo', ban: true, message: "Removed by the host, and can't rejoin this lobby" });
    expect(await bo.backend.get(lobby.id)).toBeNull();
  });

  test("kicked twice while holding the SDK's role (it can't kick itself): still told, and banned when they come back", async () => {
    const hub = new Hub();
    const [ada, bo] = players(hub, 'ada', 'bo');
    const lobby = await ada.backend.create(player('ADA'), {});
    const room = hub.rooms.get(lobby.id)!;
    /** Bo's page holds the SDK's role (a reload moved it). */
    const boHolds = () => {
      room.members = [room.members.find((m) => m.id === 'bo')!, ...room.members.filter((m) => m.id !== 'bo')];
      room.emit('host_changed', 'bo', 'ada');
    };
    for (const [n, message] of [[1, 'Removed by the host'], [2, "Removed by the host, and can't rejoin this lobby"]] as const) {
      await bo.backend.get(lobby.id);
      await bo.backend.send(lobby.id, { type: 'join', player: player('BO') });
      boHolds();
      await ada.backend.send(lobby.id, { type: 'kick', index: 1 });
      await settle();
      expect(bo.backend.why(lobby.id)).toEqual({ kind: 'kicked', message });
      expect(room.members.map((m) => m.id)).toEqual(['ada']);
      if (n === 1) expect((room.state.lobby as { banned?: string[] }).banned).toBeUndefined();
    }
    // Back in the room: the SDK host bans them from it, and the lobby won't seat them.
    await bo.backend.get(lobby.id);
    await settle();
    expect(room.kicks.at(-1)).toEqual({ id: 'bo', ban: true, message: "Removed by the host, and can't rejoin this lobby" });
    expect(room.banned.has('bo')).toBe(true);
    expect(room.members.map((m) => m.id)).toEqual(['ada']);
  });

  test('why you are out: kicked (with the host\'s words), banned, or a private room, said once', async () => {
    const hub = new Hub();
    const [ada, bo, cy] = players(hub, 'ada', 'bo', 'cy');
    const lobby = await ada.backend.create(player('ADA'), {});
    await bo.backend.get(lobby.id);
    await bo.backend.send(lobby.id, { type: 'join', player: player('BO') });
    await ada.backend.send(lobby.id, { type: 'kick', index: 1 });
    await settle();
    expect(bo.backend.why(lobby.id)).toEqual({ kind: 'kicked', message: 'Removed by the host' });
    expect(bo.backend.why(lobby.id)).toBeNull();
    hub.rooms.get(lobby.id)!.banned.add('bo');
    expect(await bo.backend.get(lobby.id)).toBeNull();
    expect(bo.backend.why(lobby.id)).toEqual({ kind: 'banned' });
    hub.rooms.get(lobby.id)!.locked = true;
    expect(await cy.backend.get(lobby.id)).toBeNull();
    expect(cy.backend.why(lobby.id)).toEqual({ kind: 'locked' });
  });

  test("a code that finds nothing (a Private lobby is link-only, or it closed) is said too", async () => {
    const hub = new Hub();
    const [ada, bo, cy] = players(hub, 'ada', 'bo', 'cy');
    const lobby = await ada.backend.create(player('ADA'), {});
    await bo.backend.get(lobby.id);
    await ada.backend.send(lobby.id, { type: 'options', visibility: 'locked' });
    await new Promise((r) => setTimeout(r, 1100));
    await settle();
    expect(await cy.backend.get(lobby.id)).toBeNull();
    expect(cy.backend.why(lobby.id)).toEqual({ kind: 'missing' });
    expect(await cy.backend.get('ZZZZZZ')).toBeNull();
    expect(cy.backend.why('ZZZZZZ')).toEqual({ kind: 'missing' });
  });

  test("a refusal nobody asked about is forgotten once you're in: it can't be said later, about something else", async () => {
    const hub = new Hub();
    const [ada, cy] = players(hub, 'ada', 'cy');
    const lobby = await ada.backend.create(player('ADA'), {});
    const room = hub.rooms.get(lobby.id)!;
    room.locked = true;
    expect(await cy.backend.get(lobby.id)).toBeNull();
    room.locked = false;
    expect(await cy.backend.get(lobby.id)).not.toBeNull();
    expect(cy.backend.why(lobby.id)).toBeNull();
  });

  test("Make host hands over the lobby and the SDK's role with it; to a player whose connection is down, just the lobby", async () => {
    const hub = new Hub();
    const [ada, bo, cy] = players(hub, 'ada', 'bo', 'cy');
    const lobby = await ada.backend.create(player('ADA'), {});
    for (const p of [bo, cy]) {
      await p.backend.get(lobby.id);
      await p.backend.send(lobby.id, { type: 'join', player: player(p.relay.playerId.toUpperCase()) });
    }
    const after = await ada.backend.send(lobby.id, { type: 'host', index: 1 });
    expect(after?.host).toBe('bo');
    expect(bo.relay.room!.isHost).toBe(true);
    // Bo's turn: Cy's connection is down, so the SDK's role stays with Bo.
    const room = hub.rooms.get(lobby.id)!;
    room.members.find((m) => m.id === 'cy')!.connected = false;
    const later = await bo.backend.send(lobby.id, { type: 'host', index: 2 });
    expect(later?.host).toBe('cy');
    expect(bo.relay.room!.isHost).toBe(true);
  });

  test('Private locks the room at the server: nobody new gets in, its own players come back, and Public opens it', async () => {
    const hub = new Hub();
    const [ada, bo, cy] = players(hub, 'ada', 'bo', 'cy');
    const lobby = await ada.backend.create(player('ADA'), {});
    await bo.backend.get(lobby.id);
    await bo.backend.send(lobby.id, { type: 'join', player: player('BO') });
    await ada.backend.send(lobby.id, { type: 'options', visibility: 'locked' });
    await new Promise((r) => setTimeout(r, 1100));
    const room = hub.rooms.get(lobby.id)!;
    expect(room.locked).toBe(true);
    // A stranger is refused by the server, not only by the lobby's rules.
    expect(await cy.backend.get(lobby.id)).toBeNull();
    // Bo's race page coming back (a reload) still gets in.
    room.members.find((m) => m.id === 'bo')!.connected = false;
    expect(await bo.relay.joinRoom(lobby.id)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 1100));
    await ada.backend.send(lobby.id, { type: 'options', visibility: 'public' });
    await new Promise((r) => setTimeout(r, 1100));
    expect(room.locked).toBe(false);
  });

  test('a lobby an older build made "private" (by link) is invite only: a friend with the link still sits down', async () => {
    const hub = new Hub();
    const [ada, bo] = players(hub, 'ada', 'bo');
    const lobby = await ada.backend.create(player('ADA'), {});
    const room = hub.rooms.get(lobby.id)!;
    room.state = { ...room.state, lobby: { ...(room.state.lobby as object), visibility: 'private' } };
    await bo.backend.get(lobby.id);
    const joined = await bo.backend.send(lobby.id, { type: 'join', player: player('BO') });
    expect(joined?.visibility).toBe('invite');
    expect(joined?.seats[1]).toMatchObject({ kind: 'player', id: 'bo' });
  });

  test("a ping someone sends is checked before it's shown", () => {
    expect(readPing({ type: 'ping', ms: 42 })).toBe(42);
    expect(readPing({ type: 'ping', ms: -1 })).toBeNull();
    expect(readPing({ type: 'ping', ms: 'fast' })).toBeNull();
    expect(readPing({ type: 'chat', ms: 42 })).toBeNull();
  });

  test("the lobby's connection is its slowest route: P2P only if every pair is direct, Server if any pair has no channel", () => {
    expect(netRoute([])).toBeNull();
    expect(netRoute(['direct', 'direct'])).toBe('p2p');
    expect(netRoute(['direct', 'relay'])).toBe('relay');
    expect(netRoute(['relay', null])).toBe('server');
  });

  test("a lobby everyone left isn't listed while its room waits out its idle time", async () => {
    const hub = new Hub();
    const [ada, bo] = players(hub, 'ada', 'bo');
    const lobby = await ada.backend.create(player('ADA'), {});
    await settle();
    expect(await bo.backend.list()).toHaveLength(1);
    const room = hub.rooms.get(lobby.id)!;
    await ada.backend.send(lobby.id, { type: 'leave' });
    // The room's still there (the server closes it later), but out of the list.
    hub.rooms.set(lobby.id, room);
    expect(room.public).toBe(false);
    expect(await bo.backend.list()).toEqual([]);
    // And one whose public flag is still up (its last player's page just closed) isn't listed either.
    room.public = true;
    expect(await bo.backend.list()).toEqual([]);
  });

  test("a map that isn't a layout's key (constructor, __proto__) is refused, from a listing or the host's options", () => {
    const meta = { map: 'constructor', laps: 2, phase: 'lobby', pips: 'pooooooo', players: 1, filled: 1 };
    expect(readListing({ code: 'K7QM', name: 'x', meta })).toBeNull();
    expect(readListing({ code: 'K7QM', name: 'x', meta: { ...meta, map: '__proto__' } })).toBeNull();
    expect(readAction({ type: 'options', options: { map: 'toString' } }, 'x')).toBeNull();
    expect(readAction({ type: 'options', options: { map: 'backroads/valley' } }, 'x')).toEqual({ type: 'options', options: { map: 'backroads/valley' } });
    expect(readAction({ type: 'options', options: { laps: 1e9 } }, 'x')).toBeNull();
  });

  test("a plate the menu would refuse, sent by someone else's page, is shown as a stock plate", () => {
    const join = (name: string) => readAction({ type: 'join', player: { name, car: 'coupe', paint: 0 } }, 'x');
    expect(join('SH1T')).toEqual({ type: 'join', player: { id: 'x', name: 'RC', car: 'coupe', paint: 0 } });
    expect(join('ace 7')).toEqual({ type: 'join', player: { id: 'x', name: 'ACE 7', car: 'coupe', paint: 0 } });
    expect(join('')).toBeNull();
  });

  test('a short-link join too slow to wait for is left once it lands', async () => {
    let land!: (code: string) => void;
    const abandoned: string[] = [];
    const online = {
      joinLink: () => new Promise<string>((r) => (land = r)),
      abandon: async (id: string) => void abandoned.push(id),
    } as unknown as ConstructorParameters<typeof Lobbies>[1];
    const both = new Lobbies(new LocalBackend(null), online, 20, 20);
    expect(await both.joinLink('ZwsG3pRrM1s')).toBeNull();
    // Said, not just dropped on the title.
    expect(both.why('ZwsG3pRrM1s')).toEqual({ kind: 'slow' });
    expect(both.why('ZwsG3pRrM1s')).toBeNull();
    land('K7QM');
    await settle();
    // The link at once (a refusal landing later isn't kept), the lobby once it's known.
    expect(abandoned).toEqual(['ZwsG3pRrM1s', 'K7QM']);
  });

  test("a join waits longer than the list (a cold page connects first), and one too slow even so is said", async () => {
    let land!: (lobby: Lobby | null) => void;
    const online = {
      list: () => new Promise(() => {}),
      get: () => new Promise<Lobby | null>((r) => (land = r)),
      why: () => null,
    } as unknown as ConstructorParameters<typeof Lobbies>[1];
    const both = new Lobbies(new LocalBackend(null), online, 20, 60);
    expect(await both.list()).toEqual([]);
    const lobby = createLobby('K7QM', { id: 'ada', name: 'ADA', car: 'coupe', paint: 1 });
    const got = both.get('K7QM');
    await new Promise((r) => setTimeout(r, 30));
    land(lobby);
    expect(await got).toEqual(lobby);
    expect(both.why('K7QM')).toBeNull();
    expect(await both.get('K7QM')).toBeNull();
    expect(both.why('K7QM')).toEqual({ kind: 'slow' });
  });

  test("only the latest try at a lobby says it was too slow: an older one timing out after says nothing", async () => {
    const online = { get: (id: string) => (id === 'K7QM' ? new Promise(() => {}) : null), why: () => null } as unknown as ConstructorParameters<typeof Lobbies>[1];
    const both = new Lobbies(new LocalBackend(null), online, 10, 40);
    void both.get('K7QM');
    await new Promise((r) => setTimeout(r, 20));
    // Esc, then the lobby again: the first try times out while the second waits.
    await both.abandon('K7QM').catch(() => {});
    const second = both.get('K7QM');
    await new Promise((r) => setTimeout(r, 30));
    expect(both.why('K7QM')).toBeNull();
    expect(await second).toBeNull();
    expect(both.why('K7QM')).toEqual({ kind: 'slow' });
  });

  test("a join waits long only while there's no connection up: a fresh page, or one that dropped", async () => {
    let up = false;
    const online = { ready: () => up, get: () => new Promise(() => {}), why: () => null } as unknown as ConstructorParameters<typeof Lobbies>[1];
    const both = new Lobbies(new LocalBackend(null), online, 20, 300);
    const took = async () => {
      const t = Date.now();
      expect(await both.get('K7QM')).toBeNull();
      return Date.now() - t;
    };
    expect(await took()).toBeGreaterThanOrEqual(250);
    up = true;
    expect(await took()).toBeLessThan(200);
    up = false;
    expect(await took()).toBeGreaterThanOrEqual(250);
  });

  test("the menu's order: a join too slow is abandoned, then asked why, and says it was too slow", async () => {
    const online = { get: () => new Promise(() => {}), abandon: async () => {}, why: () => null } as unknown as ConstructorParameters<typeof Lobbies>[1];
    const both = new Lobbies(new LocalBackend(null), online, 10, 10);
    expect(await both.get('K7QM')).toBeNull();
    void both.abandon('K7QM');
    expect(both.why('K7QM')).toEqual({ kind: 'slow' });
    expect(both.why('K7QM')).toBeNull();
  });

  test("a join the menu gave up on, refused after, leaves nothing to say later", async () => {
    const hub = new Hub();
    const [ada, bo] = players(hub, 'ada', 'bo');
    const lobby = await ada.backend.create(player('ADA'), {});
    hub.rooms.get(lobby.id)!.banned.add('bo');
    hub.roomMs = 30;
    const side = new Lobbies(new LocalBackend(null), bo.backend, 5, 5);
    expect(await side.get(lobby.id)).toBeNull();
    await side.abandon(lobby.id);
    await new Promise((r) => setTimeout(r, 60));
    // Too slow, as it was when given up on; the ban landing after isn't kept to be said later.
    expect(side.why(lobby.id)).toEqual({ kind: 'slow' });
    expect(side.why(lobby.id)).toBeNull();
  });

  test("a refusal that lands before the menu asks is said instead of too slow", async () => {
    const online = { get: () => new Promise(() => {}), why: () => ({ kind: 'banned' }) } as unknown as ConstructorParameters<typeof Lobbies>[1];
    const both = new Lobbies(new LocalBackend(null), online, 10, 10);
    expect(await both.get('K7QM')).toBeNull();
    expect(both.why('K7QM')).toEqual({ kind: 'banned' });
  });

  test("a too-slow try is forgotten once you're in the lobby: a later close isn't said to be too slow", async () => {
    const online = { get: () => new Promise(() => {}), subscribe: () => () => {}, why: () => null } as unknown as ConstructorParameters<typeof Lobbies>[1];
    const both = new Lobbies(new LocalBackend(null), online, 10, 10);
    // The race page's own get timing out, nobody asking why; then the lobby screen subscribes.
    expect(await both.get('K7QM')).toBeNull();
    both.subscribe('K7QM', () => {});
    expect(both.why('K7QM')).toBeNull();
  });

  test("a short link given up on as too slow, refused after, leaves nothing to say later", async () => {
    const hub = new Hub();
    const [ada, bo] = players(hub, 'ada', 'bo');
    const lobby = await ada.backend.create(player('ADA'), {});
    hub.rooms.get(lobby.id)!.banned.add('bo');
    hub.roomMs = 30;
    const side = new Lobbies(new LocalBackend(null), bo.backend, 5, 5);
    const link = linkOf(lobby.id);
    expect(await side.joinLink(link)).toBeNull();
    expect(side.why(link)).toEqual({ kind: 'slow' });
    await new Promise((r) => setTimeout(r, 60));
    expect(side.why(link)).toBeNull();
    expect(bo.backend.why(link)).toBeNull();
  });

  test("a short link that's refused or gone says why, as a code does", async () => {
    const hub = new Hub();
    const [bo] = players(hub, 'bo');
    expect(await bo.backend.joinLink('nothing-here')).toBeNull();
    // A link finds a Private lobby, so one that finds nothing is gone.
    expect(bo.backend.why('nothing-here')).toEqual({ kind: 'closed' });
  });

  test("the lobby in a room's state is checked all through: whoever holds the host role writes it", () => {
    const good = createLobby('K7QM', { id: 'ada', name: 'ADA', car: 'coupe', paint: 1 });
    expect(readLobby({ lobby: good })).toEqual(good);
    const bad = (patch: (l: Record<string, unknown>) => void) => {
      const l = structuredClone(good) as unknown as Record<string, unknown>;
      patch(l);
      return readLobby({ lobby: l });
    };
    expect(bad((l) => ((l.seats as unknown[])[3] = null))).toBeNull();
    expect(bad((l) => ((l.seats as unknown[])[3] = { kind: 'ai', difficulty: 7 }))).toBeNull();
    expect(bad((l) => ((l.seats as Record<string, unknown>[])[0].paint = 'red'))).toBeNull();
    expect(bad((l) => ((l.options as Record<string, unknown>).laps = 'lots'))).toBeNull();
    expect(bad((l) => ((l.options as Record<string, unknown>).map = 'constructor'))).toBeNull();
    expect(bad((l) => (l.phase = 'party'))).toBeNull();
    expect(bad((l) => (l.startAt = Infinity))).toBeNull();
    // A seated player's name is a plate there too, and anything extra is dropped.
    const named = bad((l) => {
      (l.seats as Record<string, unknown>[])[0].name = '<i>ada</i>';
      l.junk = 1;
    });
    expect(named?.seats[0]).toMatchObject({ name: 'IADAI' });
    expect(named).not.toHaveProperty('junk');
  });

  test("a player's name from another page is a plate: no markup reaches anyone's screen", () => {
    const evil = '<img src=x onerror=alert(1)>';
    expect(readAction({ type: 'name', name: evil }, 'x')).toEqual({ type: 'name', name: 'IMG SRC' });
    expect(readAction({ type: 'join', player: { name: 'ada <b>', car: 'coupe', paint: 1 } }, 'bo')).toMatchObject({ player: { name: 'ADA B' } });
    // Nothing a plate can show: no name, no action.
    expect(readAction({ type: 'name', name: '<>' }, 'x')).toBeNull();
    expect(readAction({ type: 'join', player: { name: '!!', car: 'coupe', paint: 1 } }, 'bo')).toBeNull();
  });

  test("another player's action is checked before the host applies it, and a listing before it's shown", () => {
    expect(readAction({ type: 'seat', index: 9, to: 'open' }, 'x')).toBeNull();
    expect(readAction({ type: 'seat', index: 2, to: 'piano' }, 'x')).toBeNull();
    expect(readAction({ type: 'options', options: { weather: 'snow' } }, 'x')).toBeNull();
    expect(readAction({ type: 'options', visibility: 'invite' }, 'x')).toEqual({ type: 'options', visibility: 'invite' });
    expect(readAction({ type: 'options', visibility: 'secret' }, 'x')).toBeNull();
    // An older build's "private" was by link: invite only, not locked.
    expect(readAction({ type: 'options', visibility: 'private' }, 'x')).toEqual({ type: 'options', visibility: 'invite' });
    expect(readAction({ type: 'options', options: { laps: 3, junk: 1 } }, 'x')).toEqual({ type: 'options', options: { laps: 3 } });
    expect(readAction({ type: 'join', player: { id: 'ada', name: 'X', car: 'coupe', paint: 1 } }, 'bo')).toEqual({ type: 'join', player: { id: 'bo', name: 'X', car: 'coupe', paint: 1 } });
    expect(readAction({ type: 'start', seed: -1 }, 'x')).toBeNull();
    expect(readAction({ type: 'racing', racing: false }, 'x')).toEqual({ type: 'racing', racing: false });
    expect(readAction({ type: 'racing', racing: 'no' }, 'x')).toBeNull();
    expect(readAction('start', 'x')).toBeNull();
    expect(readListing({ code: 'K7QM', name: 'ok', meta: { map: 'downtown/downtown', laps: 2, phase: 'lobby', pips: 'pooooooo', players: 1, filled: 1 } })).toMatchObject({ id: 'K7QM' });
    expect(readListing({ code: 'K7QM', name: 'ok', meta: { map: 'downtown/downtown', laps: 2, phase: 'lobby', pips: '<img>', players: 1, filled: 1 } })).toBeNull();
    expect(readListing({ code: 'K7QM', name: 'ok', meta: null })).toBeNull();
    // A listing that says it's invite only or private isn't a row, even if the room is still listed.
    expect(readListing({ code: 'K7QM', name: 'ok', meta: { map: 'downtown/downtown', laps: 2, phase: 'lobby', pips: 'pooooooo', players: 1, filled: 1, visibility: 'invite' } })).toBeNull();
  });

  test('Lobbies: your own lobby stays local and unlisted, the rest are online (and none when offline)', async () => {
    const hub = new Hub();
    const [ada] = players(hub, 'ada');
    const local = new LocalBackend(null);
    const both = new Lobbies(local, ada.backend);
    const mine = await both.create(player('ADA'), {});
    expect(mine.id).toBe(LOCAL_ID);
    const room = await both.create(player('ADA'), { online: true });
    expect(room.id).not.toBe(LOCAL_ID);
    expect(both.youIn(LOCAL_ID)).toBe('you');
    expect(both.youIn(room.id)).toBe('ada');
    await settle();
    expect((await both.list()).map((l) => l.id)).toEqual([room.id]);

    const down = new Lobbies(new LocalBackend(null), new RelayBackend(() => Promise.reject(new Error('offline'))));
    await down.create(player('ADA'), {});
    expect(await down.list()).toEqual([]);
    expect(down.offline).not.toBe('');
    expect(new Lobbies(new LocalBackend(null), null).offline).toContain('VITE_GAMERELAY_KEY');
  });

  test("kicking the player who holds the SDK's role (it can't kick itself): they hand the lobby on and go", async () => {
    const hub = new Hub();
    const [ada, bo] = players(hub, 'ada', 'bo');
    const lobby = await ada.backend.create(player('ADA'), {});
    await bo.backend.get(lobby.id);
    await bo.backend.send(lobby.id, { type: 'join', player: player('BO') });
    // Ada reloaded once, so Bo holds the SDK's role now.
    const room = hub.rooms.get(lobby.id)!;
    room.members.reverse();
    expect(bo.relay.room!.isHost).toBe(true);
    const after = await ada.backend.send(lobby.id, { type: 'kick', index: 1 });
    await settle();
    expect(after?.seats[1]).toEqual({ kind: 'open' });
    expect(room.members.map((m) => m.id)).toEqual(['ada']);
    expect((await ada.backend.get(lobby.id))?.seats[1]).toEqual({ kind: 'open' });
  });

  test('Leave without a seat (watching a full or racing lobby) still leaves the room', async () => {
    const hub = new Hub();
    const [ada, bo] = players(hub, 'ada', 'bo');
    const lobby = await ada.backend.create(player('ADA'), {});
    await ada.backend.send(lobby.id, { type: 'start', seed: 1 });
    await bo.backend.get(lobby.id);
    expect(await bo.backend.send(lobby.id, { type: 'join', player: player('BO') })).toBeNull();
    await bo.backend.send(lobby.id, { type: 'leave' });
    expect(hub.rooms.get(lobby.id)!.members.map((m) => m.id)).toEqual(['ada']);
  });
});

describe("the lobby screen's connection and pings", () => {
  async function pair() {
    const hub = new Hub();
    const [ada, bo] = players(hub, 'ada', 'bo');
    const lobby = await ada.backend.create(player('ADA'), {});
    await bo.backend.get(lobby.id);
    await bo.backend.send(lobby.id, { type: 'join', player: player('BO') });
    return { hub, ada, bo, id: lobby.id };
  }

  test('each player sends their own ping while a lobby screen watches, and sees everyone\'s', async () => {
    const { hub, ada, bo, id } = await pair();
    hub.pings.set('ada', 31).set('bo', 87);
    await settle();
    // Nobody's watching (the race page attaches the room too): nothing measured or sent.
    expect(ada.backend.ping(id, 'bo')).toBeNull();
    const offA = ada.backend.subscribe(id, () => {});
    const offB = bo.backend.subscribe(id, () => {});
    await new Promise((r) => setTimeout(r, 10));
    expect(ada.backend.ping(id, 'ada')).toBe(31);
    expect(ada.backend.ping(id, 'bo')).toBe(87);
    expect(bo.backend.ping(id, 'ada')).toBe(31);
    expect(ada.backend.ping('elsewhere', 'bo')).toBeNull();
    // Junk in a message is ignored, not shown.
    hub.rooms.get(id)!.members.find((m) => m.id === 'bo')!.send({ type: 'ping', ms: 'fast' } as never);
    expect(ada.backend.ping(id, 'bo')).toBe(87);
    offA();
    offB();
    expect(PING_MS).toBeGreaterThanOrEqual(1000);
  });

  test("leaving forgets the room's pings", async () => {
    const { ada, id } = await pair();
    ada.backend.subscribe(id, () => {});
    await new Promise((r) => setTimeout(r, 10));
    expect(ada.backend.ping(id, 'ada')).toBe(20);
    await ada.backend.send(id, { type: 'leave' });
    expect(ada.backend.ping(id, 'ada')).toBeNull();
  });

  test('the connection is the slowest route to anyone: none alone, Server until a channel is up, then Relay or P2P', async () => {
    const hub = new Hub();
    const [ada, bo, cy] = players(hub, 'ada', 'bo', 'cy');
    const lobby = await ada.backend.create(player('ADA'), {});
    expect(ada.backend.route(lobby.id)).toBeNull();
    for (const p of [bo, cy]) {
      await p.backend.get(lobby.id);
      await p.backend.send(lobby.id, { type: 'join', player: player('X') });
    }
    expect(ada.backend.route(lobby.id)).toBe('server');
    hub.routes.set('ada>bo', 'direct').set('ada>cy', 'direct');
    expect(ada.backend.route(lobby.id)).toBe('p2p');
    hub.routes.set('ada>cy', 'relay');
    expect(ada.backend.route(lobby.id)).toBe('relay');
    // Your own lobby has no connection to speak of.
    expect(new Lobbies(new LocalBackend(null), ada.backend).route(LOCAL_ID)).toBeNull();
  });

  test("unlisting that fails is tried again, and the listing says who can join, so the list leaves it out meanwhile", async () => {
    const hub = new Hub();
    const [ada, bo] = players(hub, 'ada', 'bo');
    const lobby = await ada.backend.create(player('ADA'), {});
    const room = hub.rooms.get(lobby.id)!;
    await new Promise((r) => setTimeout(r, 1100));
    hub.failAccess = 1;
    await ada.backend.send(lobby.id, { type: 'options', visibility: 'invite' });
    await settle();
    expect(room.public).toBe(true);
    expect((room.listing.meta as { visibility?: string }).visibility).toBe('invite');
    expect(await bo.backend.list()).toEqual([]);
    await new Promise((r) => setTimeout(r, 1100));
    await ada.backend.send(lobby.id, { type: 'options', options: { laps: 3 } });
    await settle();
    expect(room.public).toBe(false);
  });

  test("a listing that fails is tried again a second later, with nothing else happening", async () => {
    const hub = new Hub();
    const [ada] = players(hub, 'ada');
    const lobby = await ada.backend.create(player('ADA'), {});
    const room = hub.rooms.get(lobby.id)!;
    await new Promise((r) => setTimeout(r, 1100));
    hub.failListing = 1;
    await ada.backend.send(lobby.id, { type: 'options', options: { laps: 5 } });
    await settle();
    expect((room.listing.meta as { laps?: number }).laps).not.toBe(5);
    await new Promise((r) => setTimeout(r, 1100));
    await settle();
    expect((room.listing.meta as { laps?: number }).laps).toBe(5);
  });

  test("a listing that keeps failing is tried once more, then waits for the next change; a room you left isn't tried", async () => {
    const hub = new Hub();
    const [ada] = players(hub, 'ada');
    const lobby = await ada.backend.create(player('ADA'), {});
    await new Promise((r) => setTimeout(r, 1100));
    hub.failListing = 100;
    const warn = console.warn;
    console.warn = () => {};
    try {
      await ada.backend.send(lobby.id, { type: 'options', options: { laps: 5 } });
      // At once and a second later, then no more until something changes.
      await new Promise((r) => setTimeout(r, 3500));
      expect(100 - hub.failListing).toBe(2);
      await ada.backend.send(lobby.id, { type: 'options', options: { laps: 6 } });
      await new Promise((r) => setTimeout(r, 2500));
      expect(100 - hub.failListing).toBe(4);
      // Out of the room: nothing more, and nothing left armed.
      await ada.backend.send(lobby.id, { type: 'leave' });
      const left = hub.failListing;
      await new Promise((r) => setTimeout(r, 4100));
      expect(hub.failListing).toBe(left);
    } finally {
      console.warn = warn;
    }
  });

  test("who-can-join failing while the listing goes through is tried once more too, not every second", async () => {
    const hub = new Hub();
    const [ada] = players(hub, 'ada');
    const lobby = await ada.backend.create(player('ADA'), {});
    await new Promise((r) => setTimeout(r, 1100));
    hub.failAccess = 100;
    const warn = console.warn;
    console.warn = () => {};
    try {
      await ada.backend.send(lobby.id, { type: 'options', visibility: 'invite' });
      await new Promise((r) => setTimeout(r, 3500));
      expect(100 - hub.failAccess).toBe(2);
    } finally {
      console.warn = warn;
    }
  });

  test("whoever the host role comes back to lists the room again, though their lobby looks as it did", async () => {
    const hub = new Hub();
    const [ada, bo] = players(hub, 'ada', 'bo');
    const lobby = await ada.backend.create(player('ADA'), {});
    await bo.backend.get(lobby.id);
    await settle();
    const room = hub.rooms.get(lobby.id)!;
    const listedByAda = structuredClone(room.listing);
    const member = (id: string) => room.members.find((m) => m.id === id)!;
    await member('ada').transferHost('bo');
    await settle();
    // Bo's page listed something else meanwhile (its own last change).
    room.listing = { name: 'something else', meta: null };
    await member('bo').transferHost('ada');
    // (At most once a second: Ada listed when Bo came in.)
    await new Promise((r) => setTimeout(r, 1100));
    await settle();
    expect(room.listing).toEqual(listedByAda);
  });
});

describe('P2P: a lobby is a party too', () => {
  const partyOf = (hub: Hub, id: string) => [...hub.parties].find(([, m]) => m.has(id))?.[0];

  test("its host makes the party with the room, everyone who comes in joins it, and leaving leaves it", async () => {
    const hub = new Hub();
    const [ada, bo] = players(hub, 'ada', 'bo');
    const lobby = await ada.backend.create(player('ADA'), {});
    expect(lobby.party).toBeDefined();
    expect(partyOf(hub, 'ada')).toBe(lobby.party);
    await bo.backend.get(lobby.id);
    await settle();
    expect(partyOf(hub, 'bo')).toBe(lobby.party);
    await bo.backend.send(lobby.id, { type: 'leave' });
    // Out of the party with the room: its leader can't drag them into its next one.
    expect(partyOf(hub, 'bo')).toBeUndefined();
    expect(partyOf(hub, 'ada')).toBe(lobby.party);
  });

  test("someone kicked is out of the party too, and a new lobby doesn't keep the old one's", async () => {
    const hub = new Hub();
    const [ada, bo] = players(hub, 'ada', 'bo');
    const lobby = await ada.backend.create(player('ADA'), {});
    await bo.backend.get(lobby.id);
    await bo.backend.send(lobby.id, { type: 'join', player: player('BO') });
    await settle();
    expect(partyOf(hub, 'bo')).toBe(lobby.party);
    await ada.backend.send(lobby.id, { type: 'kick', index: 1 });
    await settle();
    expect(partyOf(hub, 'bo')).toBeUndefined();
    const next = await ada.backend.create(player('ADA'), {});
    expect(next.party).not.toBe(lobby.party);
    expect(partyOf(hub, 'ada')).toBe(next.party);
  });

  test("a lobby whose party is gone gets a new one from the SDK's host, and the others follow it", async () => {
    const hub = new Hub();
    const [ada, bo] = players(hub, 'ada', 'bo');
    const lobby = await ada.backend.create(player('ADA'), {});
    const room = hub.rooms.get(lobby.id)!;
    await new Promise((r) => setTimeout(r, 10));
    // The party went (everyone dropped out of it, say a server restart), but the room's still there.
    hub.parties.clear();
    room.state = { ...room.state, lobby: { ...(room.state.lobby as object), party: 'PGONE' } };
    await bo.backend.get(lobby.id);
    // Bo can't join it (and isn't the host): no party. Ada's next look (her page reloading) mends it.
    await settle();
    expect(partyOf(hub, 'bo')).toBeUndefined();
    const ada2 = players(hub, 'ada')[0];
    await ada2.backend.get(lobby.id);
    await new Promise((r) => setTimeout(r, 10));
    const mended = (room.state.lobby as { party?: string }).party;
    expect(mended).not.toBe('PGONE');
    expect(partyOf(hub, 'ada')).toBe(mended);
    expect(partyOf(hub, 'bo')).toBe(mended);
  });
});

describe('P2P: never left in a party the lobby is done with', () => {
  const partyOf = (hub: Hub, id: string) => [...hub.parties].find(([, m]) => m.has(id))?.[0];

  test("a fresh page leaves the party too, though its SDK doesn't know it's in one", async () => {
    const hub = new Hub();
    const [ada] = players(hub, 'ada');
    const lobby = await ada.backend.create(player('ADA'), {});
    const [bo] = players(hub, 'bo');
    await bo.backend.get(lobby.id);
    await new Promise((r) => setTimeout(r, 10));
    expect(partyOf(hub, 'bo')).toBe(lobby.party);
    // Bo's page reloads: the server still has him in the party, his new SDK doesn't know.
    const relay = new FakeRelay(hub, 'bo');
    relay.fresh = true;
    relay.room = hub.rooms.get(lobby.id)!.members.find((m) => m.id === 'bo')!;
    const fresh = new RelayBackend(async () => relay);
    const mine = await fresh.create(player('BO'), {});
    // Making his own lobby, he's out of Ada's party before the room exists, so it can't pull anyone along.
    expect(hub.made.find((m) => m.code === mine.id)?.party).toBeUndefined();
    expect(hub.parties.get(lobby.party!)?.has('bo')).toBe(false);
  });

  test('a party join that lands after you left is undone', async () => {
    const hub = new Hub();
    const [ada, bo] = players(hub, 'ada', 'bo');
    const lobby = await ada.backend.create(player('ADA'), {});
    hub.joinMs = 20;
    await bo.backend.get(lobby.id);
    await bo.backend.send(lobby.id, { type: 'leave' });
    await new Promise((r) => setTimeout(r, 40));
    expect(partyOf(hub, 'bo')).toBeUndefined();
  });

  test("a new party's code that comes in while a join is still trying is tried next, not dropped", async () => {
    const hub = new Hub();
    const [ada, bo] = players(hub, 'ada', 'bo');
    const lobby = await ada.backend.create(player('ADA'), {});
    const room = hub.rooms.get(lobby.id)!;
    await new Promise((r) => setTimeout(r, 10));
    // The party's gone; Bo's join to it is slow, and the host makes a new one meanwhile.
    hub.parties.clear();
    room.state = { ...room.state, lobby: { ...(room.state.lobby as object), party: 'PGONE' } };
    hub.joinMs = 20;
    await bo.backend.get(lobby.id);
    const { code } = await ada.relay.createParty();
    const host = room.members.find((m) => m.id === 'ada')!;
    host.setState({ lobby: { ...(room.state.lobby as object), party: code } });
    await new Promise((r) => setTimeout(r, 80));
    expect(partyOf(hub, 'bo')).toBe(code);
  });
});

describe('the SDK host role moving, and who is away', () => {
  test("whoever the SDK's host role moves to tidies up: a seat whose player left while nobody held it opens", async () => {
    const hub = new Hub();
    const [ada, bo] = players(hub, 'ada', 'bo');
    const lobby = await ada.backend.create(player('ADA'), {});
    await bo.backend.get(lobby.id);
    await bo.backend.send(lobby.id, { type: 'join', player: player('BO') });
    const room = hub.rooms.get(lobby.id)!;
    // Someone left while the role was between pages (nobody saw it go): their seat's still down.
    const seats = (room.state.lobby as { seats: unknown[] }).seats.slice();
    seats[2] = { kind: 'player', ready: false, id: 'zed', name: 'ZED', car: 'coupe', paint: 0 };
    room.state = { ...room.state, lobby: { ...(room.state.lobby as object), seats } };
    // Ada's page drops: the role moves to Bo, and the SDK says so with `host_changed`.
    room.members.find((m) => m.id === 'ada')!.connected = false;
    room.emit('host_changed', 'bo', 'ada');
    expect((room.state.lobby as { seats: { kind: string }[] }).seats[2]).toEqual({ kind: 'open' });
  });

  test("a player whose connection has been gone a while is away (not a page load's moment), and back when it's back", () => {
    const hub = new Hub();
    const room = new FakeRoom(hub, 'R');
    const ada = new FakeClient(room, 'ada');
    const bo = new FakeClient(room, 'bo');
    room.members.push(ada, bo);
    let t = 1000;
    const p = new Presence(ada, async () => 10, () => t);
    expect(p.away('bo')).toBe(false);
    bo.connected = false;
    room.emit('player_disconnected', 'bo');
    t += AWAY_MS - 1;
    expect(p.away('bo')).toBe(false);
    t += 1;
    expect(p.away('bo')).toBe(true);
    // You're never away to yourself.
    expect(p.away('ada')).toBe(false);
    bo.connected = true;
    room.emit('player_reconnected', 'bo');
    expect(p.away('bo')).toBe(false);
    p.dispose();
  });

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const membersOf = (hub: Hub, code: string) => hub.rooms.get(code)?.members.map((m) => m.id) ?? [];

  test("a join the menu gave up on (too slow, or Esc) leaves when it lands; one it didn't give up on stays (the race page's)", async () => {
    const hub = new Hub();
    const [ada, bo, cy] = players(hub, 'ada', 'bo', 'cy');
    const lobby = await ada.backend.create(player('ADA'), {});
    hub.roomMs = 30;
    // The screens wait 10 ms: both gets come back empty while the joins go on.
    const boSide = new Lobbies(new LocalBackend(null), bo.backend, 10, 10);
    const cySide = new Lobbies(new LocalBackend(null), cy.backend, 10, 10);
    expect(await boSide.get(lobby.id)).toBeNull();
    expect(await cySide.get(lobby.id)).toBeNull();
    // Bo's menu gives up; Cy's is a race page, which keeps waiting.
    void boSide.abandon(lobby.id);
    await wait(60);
    expect(membersOf(hub, lobby.id).sort()).toEqual(['ada', 'cy']);
  });

  test('Esc while joining one lobby, then into another: the late join leaves its own room, never the new one', async () => {
    const hub = new Hub();
    const [ada, cy, bo] = players(hub, 'ada', 'cy', 'bo');
    const x = await ada.backend.create(player('ADA'), {});
    const y = await cy.backend.create(player('CY'), {});
    hub.roomMs = 20;
    const joiningX = bo.backend.get(x.id);
    // Esc: the menu gives X up, and Bo opens Y straight away.
    void bo.backend.abandon(x.id);
    const inY = await bo.backend.get(y.id);
    await joiningX;
    expect(inY?.id).toBe(y.id);
    expect(membersOf(hub, x.id)).toEqual(['ada']);
    expect(membersOf(hub, y.id).sort()).toEqual(['bo', 'cy']);
    expect(bo.backend.current?.code).toBe(y.id);
  });

  test("a join given up on after you're in another lobby doesn't take you out of it", async () => {
    const hub = new Hub();
    const [ada, cy, bo] = players(hub, 'ada', 'cy', 'bo');
    const x = await ada.backend.create(player('ADA'), {});
    hub.roomMs = 20;
    const side = new Lobbies(new LocalBackend(null), bo.backend, 5, 5);
    expect(await side.get(x.id)).toBeNull();
    void side.abandon(x.id);
    // To the title, then Bo makes a lobby of his own while X's join is still landing.
    const mine = await bo.backend.create(player('BO'), {});
    await wait(50);
    expect(bo.backend.current?.code).toBe(mine.id);
    expect(membersOf(hub, mine.id)).toEqual(['bo']);
    expect(membersOf(hub, x.id)).toEqual(['ada']);
    void cy;
  });
});

describe('short links (GameRelay)', () => {
  test("an Invite only lobby's room is link-only: its code doesn't get a stranger in, its link does", async () => {
    const hub = new Hub();
    const [ada, bo, cy] = players(hub, 'ada', 'bo', 'cy');
    const lobby = await ada.backend.create(player('ADA'), { visibility: 'invite' });
    const room = hub.rooms.get(lobby.id)!;
    expect([room.public, room.linkOnly]).toEqual([false, true]);
    // A guess at the code: nothing.
    expect(await bo.backend.get(lobby.id)).toBeNull();
    // The link: in, and the lobby's the same (its id is the room's code).
    const link = await ada.backend.shareLink(lobby.id);
    expect(link).toBe(`https://gamerelay.io/racer/${linkOf(lobby.id)}`);
    expect(await cy.backend.joinLink(linkOf(lobby.id))).toBe(lobby.id);
    expect((await cy.backend.get(lobby.id))?.id).toBe(lobby.id);
    // A Public one isn't: listed, and its code works.
    const open = await bo.backend.create(player('BO'), { visibility: 'public' });
    expect([hub.rooms.get(open.id)!.public, hub.rooms.get(open.id)!.linkOnly]).toEqual([true, false]);
    // A link whose room is gone: null.
    expect(await cy.backend.joinLink('nothingxxxx')).toBeNull();
  });

  test('changing who can join keeps link-only with it: Public opens the code, Invite only closes it again', async () => {
    const hub = new Hub();
    const [ada] = players(hub, 'ada');
    const lobby = await ada.backend.create(player('ADA'), { visibility: 'invite' });
    const room = hub.rooms.get(lobby.id)!;
    await ada.backend.send(lobby.id, { type: 'options', visibility: 'public' });
    await new Promise((r) => setTimeout(r, 1100));
    expect([room.public, room.linkOnly]).toEqual([true, false]);
    await ada.backend.send(lobby.id, { type: 'options', visibility: 'invite' });
    await new Promise((r) => setTimeout(r, 1100));
    expect([room.public, room.linkOnly]).toEqual([false, true]);
  });

  test('an SDK without short links: no link to share, no join by one (the page falls back to ?lobby=)', async () => {
    const hub = new Hub();
    const relay = new FakeRelay(hub, 'ada');
    (relay as { joinLink?: unknown }).joinLink = undefined;
    const backend = new RelayBackend(async () => relay);
    const lobby = await backend.create(player('ADA'), { visibility: 'public' });
    (relay.room as { shareLink?: unknown }).shareLink = undefined;
    expect(await backend.shareLink(lobby.id)).toBeNull();
    expect(await backend.joinLink('whateverxxx')).toBeNull();
  });
});
