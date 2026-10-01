import { describe, expect, test } from 'bun:test';
import { Lobbies, LocalBackend, LOCAL_ID } from '../src/lobby/backend';
import { netRoute, readAction, readPing, PING_MS, readListing, RelayBackend, type RelayLike, type RoomLike } from '../src/lobby/relay';
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
  /** Parties, by code: who's in each. */
  parties = new Map<string, Set<string>>();
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
  remove(c: FakeClient): void {
    const wasHost = this.host === c;
    this.members = this.members.filter((m) => m !== c);
    this.emit('player_left', c.id);
    if (wasHost) this.host?.fire('host');
    if (!this.members.length) this.hub.rooms.delete(this.code);
  }
}

/** One player's view of one room. */
class FakeClient implements RoomLike {
  connected = true;
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
  get players() {
    return this.room.members.map((m) => ({ id: m.id }));
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
    this.room.listing = structuredClone(listing);
  }
  async setAccess(access: { public?: boolean }): Promise<void> {
    if (this.room.hub.failAccess > 0) {
      this.room.hub.failAccess--;
      throw new Error('rate_limited');
    }
    if (access.public !== undefined) this.room.public = access.public;
  }
  send(data: never): void {
    for (const m of this.room.members) if (m !== this) m.fire('message', structuredClone(data), this.me);
  }
  lanRoute(playerId: string): 'direct' | 'relay' | null {
    return this.room.hub.routes.get(`${this.me}>${playerId}`) ?? null;
  }
  async kick(playerId: string): Promise<void> {
    if (playerId === this.me) throw new Error("the host can't kick itself");
    const c = this.room.members.find((m) => m.id === playerId);
    if (!c) return;
    c.fire('closed', 'kicked');
    this.room.remove(c);
  }
  async leave(): Promise<void> {
    this.room.remove(this);
  }
}

class FakeRelay implements RelayLike {
  room: FakeClient | null = null;
  now = () => 1_000_000;
  async ping(): Promise<number> {
    return this.hub.pings.get(this.playerId) ?? 20;
  }
  get party(): { code: string } | null {
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
    const p = this.hub.parties.get(code);
    if (!p) throw new Error('not_found');
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
  async createRoom(o: { public?: boolean }): Promise<RoomLike> {
    const room = new FakeRoom(this.hub, this.hub.code());
    room.public = o.public ?? true;
    this.hub.rooms.set(room.code, room);
    return this.enter(room);
  }
  async joinRoom(code: string): Promise<RoomLike> {
    const room = this.hub.rooms.get(code);
    if (!room) throw new Error('not_found');
    const back = room.members.find((m) => m.id === this.playerId);
    if (back) {
      // A reload: the same player, back in their seat.
      back.connected = true;
      return (this.room = back);
    }
    return this.enter(room);
  }
  private enter(room: FakeRoom): FakeClient {
    const c = new FakeClient(room, this.playerId);
    room.members.push(c);
    room.emit('player_joined', c.id);
    return (this.room = c);
  }
  async listRooms() {
    return [...this.hub.rooms.values()].filter((r) => r.public).map((r) => ({ code: r.code, players: r.members.length, name: r.listing.name ?? null, meta: r.listing.meta ?? null, locked: false }));
  }
}

const player = (name: string) => ({ id: '', name, car: 'coupe', paint: 0 });
const settle = () => new Promise((r) => setTimeout(r, 0));

function players(hub: Hub, ...ids: string[]) {
  return ids.map((id) => {
    const relay = new FakeRelay(hub, id);
    return { relay, backend: new RelayBackend(async () => relay) };
  });
}

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
