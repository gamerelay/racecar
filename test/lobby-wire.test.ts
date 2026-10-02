import { describe, expect, test } from 'bun:test';
import { createLobby, DEFAULT_OPTIONS, SEATS } from '../src/lobby/lobby';
import { readAction, readLobby, readResult } from '../src/lobby/wire';

// The lobby's wire readers (lobby/wire.ts), past what relay.test.ts covers: votes, options and
// their bounds, layout keys, plates in seats and renames, and result rows.

const good = createLobby('K7QM', { id: 'ada', name: 'ADA', car: 'coupe', paint: 1 });
/** The lobby with `patch` applied to a copy, read back. */
const lobbyWith = (patch: (l: Record<string, unknown>) => void) => {
  const l = structuredClone(good) as unknown as Record<string, unknown>;
  patch(l);
  return readLobby({ lobby: l });
};
const options = (o: unknown) => readAction({ type: 'options', options: o }, 'x');
const row = { seat: 0, time: 92.5, best: 30.1, takedowns: 2, wrecks: 1, score: 1200 };

describe('lobby wire: options', () => {
  test('laps are a whole number from 1 to 9', () => {
    for (const laps of [1, 3, 9]) expect(options({ laps })).toEqual({ type: 'options', options: { laps } });
    for (const laps of [0, 10, -1, 1.5, '3', NaN, Infinity, null, true]) expect(options({ laps })).toBeNull();
  });

  test('weather, time and mayhem are one of theirs; traffic is a boolean', () => {
    expect(options({ weather: 'rain', time: 'sunset', mayhem: 'chaos', traffic: false })).toEqual({ type: 'options', options: { weather: 'rain', time: 'sunset', mayhem: 'chaos', traffic: false } });
    expect(options({ time: 'night' })).toBeNull();
    expect(options({ mayhem: 'max' })).toBeNull();
    expect(options({ traffic: 'yes' })).toBeNull();
    expect(options({ traffic: 0 })).toBeNull();
    // Options that aren't an object at all.
    for (const o of [null, 'laps', 3, [3]]) expect(options(o)).toBeNull();
  });

  test("a map is a layout key's shape: lowercase words, one slash, short", () => {
    for (const map of ['downtown/downtown', 'backroads/valley', 'a/b', 'x-1/y-2', `${'a'.repeat(30)}/${'b'.repeat(30)}`]) expect(options({ map })).toEqual({ type: 'options', options: { map } });
    for (const map of ['Downtown/downtown', 'downtown', 'a/b/c', '/b', 'a/', 'a b/c', '../etc', `${'a'.repeat(31)}/b`, 'downtown/downtown\n', 'hasOwnProperty', 7, null]) expect(options({ map })).toBeNull();
  });

  test("a lobby's options in a room's state are the defaults where it doesn't say, and one bad one refuses the lobby", () => {
    expect(lobbyWith((l) => (l.options = { laps: 5 }))?.options).toEqual({ ...DEFAULT_OPTIONS, laps: 5 });
    expect(lobbyWith((l) => delete l.options)?.options).toEqual(DEFAULT_OPTIONS);
    expect(lobbyWith((l) => (l.options = { laps: 0 }))).toBeNull();
    expect(lobbyWith((l) => (l.options = { map: '__proto__' }))).toBeNull();
  });
});

describe('lobby wire: votes', () => {
  const vote = (v: unknown) => lobbyWith((l) => (l.vote = v));

  test("a vote in the lobby's state is kept when every pick is a layout key", () => {
    const v = { ends: 1_700_000_000_000, votes: { ada: 'downtown/downtown', bo: 'backroads/valley' } };
    expect(vote(v)?.vote).toEqual(v);
  });

  test("a bad vote is dropped, not the lobby: a bad close time, a pick that isn't a key, too many picks", () => {
    const votes = { ada: 'downtown/downtown' };
    for (const ends of [0, -5, NaN, Infinity, '123', null]) {
      const l = vote({ ends, votes });
      expect(l).not.toBeNull();
      expect(l).not.toHaveProperty('vote');
    }
    expect(vote({ ends: 5, votes: { ada: 'constructor' } })).not.toHaveProperty('vote');
    expect(vote({ ends: 5, votes: { ada: 3 } })).not.toHaveProperty('vote');
    expect(vote({ ends: 5, votes: ['downtown/downtown'] })).not.toHaveProperty('vote');
    expect(vote({ ends: 5 })).not.toHaveProperty('vote');
    expect(vote('soon')).not.toHaveProperty('vote');
    const many = Object.fromEntries(Array.from({ length: SEATS + 1 }, (_, k) => [`p${k}`, 'downtown/downtown']));
    expect(vote({ ends: 5, votes: many })).not.toHaveProperty('vote');
    const full = Object.fromEntries(Array.from({ length: SEATS }, (_, k) => [`p${k}`, 'downtown/downtown']));
    expect(vote({ ends: 5, votes: full })?.vote?.votes).toEqual(full);
    // A voter id longer than any player's.
    expect(vote({ ends: 5, votes: { ['x'.repeat(65)]: 'downtown/downtown' } })).not.toHaveProperty('vote');
  });

  test("a vote keyed __proto__ (as JSON brings it in) changes no object's prototype", () => {
    const l = vote(JSON.parse('{"ends": 5, "votes": {"__proto__": "downtown/downtown", "ada": "backroads/valley"}}'));
    expect(Object.getPrototypeOf(l!.vote!.votes)).toBe(Object.prototype);
    expect(l!.vote!.votes.ada).toBe('backroads/valley');
    expect(({} as Record<string, unknown>).ada).toBeUndefined();
  });

  test('vote, voteEnds and next actions: a layout key, a close time, a seed in range', () => {
    expect(readAction({ type: 'vote', map: 'backroads/valley' }, 'x')).toEqual({ type: 'vote', map: 'backroads/valley' });
    expect(readAction({ type: 'vote', map: 'toString' }, 'x')).toBeNull();
    expect(readAction({ type: 'voteEnds', ends: 10 }, 'x')).toEqual({ type: 'voteEnds', ends: 10 });
    expect(readAction({ type: 'voteEnds', ends: 0 }, 'x')).toBeNull();
    expect(readAction({ type: 'voteEnds', ends: Infinity }, 'x')).toBeNull();
    expect(readAction({ type: 'next', map: 'a/b', seed: 2 ** 31 - 1 }, 'x')).toEqual({ type: 'next', map: 'a/b', seed: 2 ** 31 - 1 });
    expect(readAction({ type: 'next', map: 'a/b', seed: 2 ** 31 }, 'x')).toBeNull();
    expect(readAction({ type: 'next', map: 'a/b', seed: 1, at: -1 }, 'x')).toBeNull();
    expect(readAction({ type: 'next', map: 'A/B', seed: 1 }, 'x')).toBeNull();
  });
});

describe('lobby wire: plates', () => {
  test("a seated player's plate the menu would refuse is shown as a stock plate, in the lobby's state too", () => {
    const named = (name: unknown) => lobbyWith((l) => ((l.seats as Record<string, unknown>[])[0].name = name));
    expect(named('NAZI')?.seats[0]).toMatchObject({ kind: 'player', name: 'RC' });
    // Look-alike digits and spaces don't get past it.
    expect(named('sh 1t')?.seats[0]).toMatchObject({ name: 'RC' });
    // Ordinary plates are as they were sent (cleaned).
    expect(named('grape')?.seats[0]).toMatchObject({ name: 'GRAPE' });
    // A seat with no plate at all isn't a seat, and so not a lobby.
    expect(named('')).toBeNull();
    expect(named('x'.repeat(65))).toBeNull();
    expect(named(42)).toBeNull();
  });

  test('a rename to a refused plate is a stock plate too; one too long to be a name is refused', () => {
    expect(readAction({ type: 'name', name: 'f u c k' }, 'x')).toEqual({ type: 'name', name: 'RC' });
    expect(readAction({ type: 'name', name: 'Spicy' }, 'x')).toEqual({ type: 'name', name: 'SPICY' });
    expect(readAction({ type: 'name', name: 'A'.repeat(65) }, 'x')).toBeNull();
    expect(readAction({ type: 'name', name: { toString: () => 'ADA' } }, 'x')).toBeNull();
  });
});

describe('lobby wire: results', () => {
  test('a result row: a seat, times under a day (or none), counts and a score in range', () => {
    expect(readResult(row)).toEqual(row);
    expect(readResult({ ...row, time: null, best: null })).toEqual({ ...row, time: null, best: null });
    expect(readResult({ ...row, junk: '<b>' })).toEqual(row);
    for (const bad of [{ seat: SEATS }, { seat: -1 }, { time: 86_400 }, { time: 0 }, { best: -1 }, { time: Infinity }, { takedowns: 1000 }, { wrecks: 1.5 }, { score: 1e9 }, { score: -1 }, { score: NaN }, { time: '92' }]) {
      expect(readResult({ ...row, ...bad })).toBeNull();
    }
    expect(readResult(null)).toBeNull();
    expect(readResult([row])).toBeNull();
  });

  test("the results in a lobby's state: bad rows are dropped, at most a row a seat, none at all is no results", () => {
    const results = (r: unknown) => lobbyWith((l) => (l.results = r));
    expect(results([row, { ...row, seat: 99 }, null, { ...row, seat: 1 }])?.results).toEqual([row, { ...row, seat: 1 }]);
    expect(results(Array.from({ length: 20 }, (_, k) => ({ ...row, seat: k % SEATS })))?.results).toHaveLength(SEATS);
    expect(results([{ ...row, score: 'lots' }])).not.toHaveProperty('results');
    expect(results('first')).not.toHaveProperty('results');
  });
});
