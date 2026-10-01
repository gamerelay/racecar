import { describe, expect, test } from 'bun:test';
import { LocalBackend, type KeyValue } from '../src/lobby/backend';
import { aiPlate } from '../src/lobby/plate';
import { FILL_DIFFICULTY, SEATS, allReady, apply, createLobby, encodeSeats, legacySeats, roster, summarize, type Lobby, type Player } from '../src/lobby/lobby';
import { raceFromLobby, readSetup, toQuery } from '../src/ui/setup';
import { thumb } from '../src/ui/thumb';
import { CLASSES, LAYOUT_KEYS, layout as readLayout } from '../tools/content';

// Lobbies (PLAN phase 2): the host rules, seats becoming a race's cars, the race link a lobby
// makes, the local backend, and the map thumbnail.

const host: Player = { id: 'you', name: 'You', car: 'bus', paint: 2 };
const guest: Player = { id: 'kev', name: 'Kev', car: 'rally', paint: 5 };
const ids = CLASSES.map((c) => c.id);

/** `apply`, asserting it was allowed. */
function ok(lobby: Lobby, actor: string, action: Parameters<typeof apply>[2]): Lobby {
  const next = apply(lobby, actor, action);
  expect(next).not.toBeNull();
  return next!;
}

describe('a lobby', () => {
  test('starts with the host in the first seat and the rest open', () => {
    const l = createLobby('local', host);
    expect(l.seats.length).toBe(SEATS);
    expect(l.seats[0]).toEqual({ kind: 'player', ready: true, ...host });
    expect(l.seats.slice(1).every((s) => s.kind === 'open')).toBe(true);
    expect(l.name).toBe("You's lobby");
    expect(createLobby('local', host, { name: '   Friday   wrecks  ' }).name).toBe('Friday wrecks');
  });

  test('only the host sets seats and options, starts, and kicks', () => {
    let l = ok(createLobby('local', host), 'kev', { type: 'join', player: guest });
    expect(l.seats[1]).toMatchObject({ kind: 'player', id: 'kev', ready: false });
    for (const action of [
      { type: 'seat', index: 2, to: 'ai-hard' },
      { type: 'options', options: { laps: 5 } },
      { type: 'start' },
      { type: 'kick', index: 0 },
    ] as const) expect(apply(l, 'kev', action)).toBeNull();
    l = ok(l, 'you', { type: 'seat', index: 2, to: 'ai-hard' });
    l = ok(l, 'you', { type: 'seat', index: 7, to: 'closed' });
    expect(l.seats[2]).toEqual({ kind: 'ai', difficulty: 2 });
    expect(l.seats[7]).toEqual({ kind: 'closed' });
    // A player's seat is theirs: the host can kick them, not turn their seat into an AI.
    expect(apply(l, 'you', { type: 'seat', index: 1, to: 'ai-easy' })).toBeNull();
    expect(ok(l, 'you', { type: 'kick', index: 1 }).seats[1]).toEqual({ kind: 'open' });
    // Laps stay in range.
    expect(ok(l, 'you', { type: 'options', options: { laps: 99 } }).options.laps).toBe(5);
  });

  test("the host's Start waits for everyone to be ready; a new car un-readies you", () => {
    let l = ok(createLobby('local', host), 'kev', { type: 'join', player: guest });
    expect(allReady(l)).toBe(false);
    expect(apply(l, 'you', { type: 'start' })).toBeNull();
    l = ok(l, 'kev', { type: 'ready', ready: true });
    l = ok(l, 'kev', { type: 'car', car: 'bus', paint: 1 });
    expect(allReady(l)).toBe(false);
    l = ok(l, 'kev', { type: 'ready', ready: true });
    l = ok(l, 'you', { type: 'start' });
    expect(l.phase).toBe('racing');
    // No seat changes mid-race; the host ends it back to the lobby.
    expect(apply(l, 'you', { type: 'seat', index: 3, to: 'closed' })).toBeNull();
    expect(ok(l, 'you', { type: 'end' }).phase).toBe('lobby');
  });

  test('the host leaving passes it on; the last one out leaves no host', () => {
    let l = ok(createLobby('local', host), 'kev', { type: 'join', player: guest });
    l = ok(l, 'you', { type: 'leave' });
    expect(l.host).toBe('kev');
    expect(l.seats[0]).toEqual({ kind: 'open' });
    const empty = ok(l, 'kev', { type: 'leave' });
    expect(empty.host).toBe('');
    // Online the room can outlive its seats: whoever sits down next hosts it.
    expect(ok(empty, 'zed', { type: 'join', player: { ...guest, id: 'zed' } }).host).toBe('zed');
  });

  test('the start keeps its seed, and the end un-readies everyone but the host for the next race', () => {
    let l = ok(createLobby('local', host), 'kev', { type: 'join', player: guest });
    l = ok(l, 'kev', { type: 'ready', ready: true });
    l = ok(l, 'you', { type: 'start', seed: 99 });
    expect(l.seed).toBe(99);
    l = ok(l, 'you', { type: 'end' });
    expect(l.seats[1]).toMatchObject({ ready: false });
    expect(allReady(l)).toBe(false);
    expect(apply(l, 'you', { type: 'start' })).toBeNull();
  });

  test("joining takes the first open seat, and a full lobby can't be joined", () => {
    let l = createLobby('local', host);
    for (let k = 1; k < SEATS; k++) l = ok(l, 'you', { type: 'seat', index: k, to: k === 4 ? 'open' : 'ai-normal' });
    l = ok(l, 'kev', { type: 'join', player: guest });
    expect(l.seats[4]).toMatchObject({ id: 'kev' });
    expect(apply(l, 'zed', { type: 'join', player: { ...guest, id: 'zed' } })).toBeNull();
    expect(summarize(l)).toMatchObject({ players: 2, filled: 8, pips: 'pnnnpnnn' });
  });
});

describe('seats become the race', () => {
  test('AI seats get their difficulty, open seats a bot, closed seats nothing', () => {
    let l = createLobby('local', host);
    l = ok(l, 'you', { type: 'seat', index: 1, to: 'ai-easy' });
    l = ok(l, 'you', { type: 'seat', index: 2, to: 'ai-hard' });
    for (const k of [5, 6, 7]) l = ok(l, 'you', { type: 'seat', index: k, to: 'closed' });
    const seats = encodeSeats(l, 'you');
    expect(seats).toBe('pehooxxx');
    const r = roster(seats, ids, 9, host);
    expect(r.me).toBe(0);
    expect(r.specs.length).toBe(5);
    expect(r.specs[0]).toEqual({ cls: 'bus', paint: 2, human: true });
    expect(r.specs.slice(1).map((s) => s.racer?.difficulty)).toEqual([0, 2, FILL_DIFFICULTY, FILL_DIFFICULTY]);
    expect(r.names).toEqual(['YOU', ...ids.slice(1, 5).map(aiPlate)]);
    // Your plate is your name.
    expect(roster(seats, ids, 9, { ...host, plate: 'ACE 7' }).names[0]).toBe('ACE 7');
  });

  test("a seat keeps its rival: the same car and paint as an old link's rival in that place, and its class's plate", () => {
    // Before lobbies, rival k drove class k + 1 in your paint plus k + 1.
    const r = roster(legacySeats(7, 2), ids, 9, { car: 'coupe', paint: 3 });
    for (let k = 0; k < 7; k++) {
      expect(r.specs[k + 1]).toEqual({ cls: ids[(k + 1) % ids.length], paint: (3 + k + 1) % 9, racer: { difficulty: 2 } });
      expect(r.names[k + 1]).toBe(aiPlate(ids[(k + 1) % ids.length]));
    }
  });

  test("you can be in any seat, and attract mode's seats have no you", () => {
    const r = roster('nnpn', ids, 9, host);
    expect(r.me).toBe(2);
    expect(r.specs[2].human).toBe(true);
    expect(roster('hnehnehn', ids, 9, host).me).toBe(-1);
  });

  test("another player's seat is closed in a local race link (until online races land)", () => {
    const l = ok(createLobby('local', host), 'kev', { type: 'join', player: guest });
    expect(encodeSeats(l, 'you')).toBe('pxoooooo');
  });

  test('the race link a lobby makes starts that race, and comes back to the lobby', () => {
    let l = createLobby('local', host, { options: { map: 'backroads/valley', laps: 4, weather: 'rain', mayhem: 'chaos', traffic: false } });
    l = ok(l, 'you', { type: 'seat', index: 3, to: 'ai-hard' });
    const race = raceFromLobby(l, 'you', 42);
    const back = readSetup(new URLSearchParams(toQuery(race)), 'downtown/downtown', { cars: ids, paints: 9 });
    expect(back).toEqual(race);
    expect(back).toMatchObject({ mode: 'race', map: 'backroads/valley', car: 'bus', paint: 2, seats: 'poohoooo', laps: 4, lobby: 'local' });
  });
});

describe('the local backend', () => {
  const memory = (): KeyValue & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
  };

  test('keeps your lobby across page loads, and closes it when you leave', async () => {
    const store = memory();
    const a = new LocalBackend(store);
    const l = await a.create({ ...host, id: 'ignored' }, { name: 'Friday wrecks' });
    expect(l.host).toBe(a.you);
    await a.send(l.id, { type: 'seat', index: 1, to: 'ai-hard' });
    // A race is a page load: a new backend reads the same lobby.
    const b = new LocalBackend(store);
    expect((await b.get(l.id))?.seats[1]).toEqual({ kind: 'ai', difficulty: 2 });
    expect((await b.list()).map((s) => s.name)).toEqual(['Friday wrecks']);
    // Refused actions change nothing.
    expect(await b.send(l.id, { type: 'kick', index: 0 })).toBeNull();
    const seen: (Lobby | null)[] = [];
    b.subscribe(l.id, (x) => seen.push(x));
    expect(await b.send(l.id, { type: 'leave' })).toBeNull();
    expect(seen).toEqual([null]);
    expect(await b.list()).toEqual([]);
    expect(store.data.size).toBe(0);
  });

  test('a lobby kept by an older build gets the options added since', async () => {
    const store = memory();
    const l = await new LocalBackend(store).create(host, {});
    const [key, raw] = [...store.data.entries()][0];
    const old = JSON.parse(raw);
    delete old.options.time;
    store.setItem(key, JSON.stringify(old));
    expect((await new LocalBackend(store).get(l.id))?.options.time).toBe('random');
  });

  test('storage that throws (a private window) falls back to memory', async () => {
    const broken: KeyValue = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const b = new LocalBackend(broken);
    const l = await b.create(host, {});
    expect((await b.send(l.id, { type: 'options', options: { laps: 2 } }))?.options.laps).toBe(2);
    expect((await b.get(l.id))?.options.laps).toBe(2);
    expect((await new LocalBackend(null).list()).length).toBe(0);
  });
});

/** Each layout's lap length, km (MAPS.md's table). */
const LAP_KM: Record<string, number> = { 'downtown/downtown': 3.26, 'backroads/valley': 2.92, 'paradise/island': 3.44 };

describe('map thumbnails', () => {
  test('every layout fits its box, with its shortcuts', () => {
    for (const key of LAYOUT_KEYS) {
      const layout = readLayout(key);
      const t = thumb(layout, 64, 4);
      const nums = [t.main, ...t.branches].join(' ').match(/-?\d+(\.\d+)?/g)!.map(Number);
      expect(Math.min(...nums)).toBeGreaterThanOrEqual(4 - 0.05);
      expect(Math.max(...nums)).toBeLessThanOrEqual(60 + 0.05);
      expect(t.main.endsWith('Z')).toBe(true);
      expect(t.branches.length).toBe(layout.branches?.length ?? 0);
      // Within 3% of the map's lap length in MAPS.md (control points cut the corners a little).
      const km = LAP_KM[key];
      expect(km, `${key}: add its lap length to LAP_KM`).toBeDefined();
      expect(Math.abs(t.km - km) / km, key).toBeLessThan(0.03);
    }
  });
});
