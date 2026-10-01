import { describe, expect, test } from 'bun:test';
import { apply, createLobby, raceKey, tally, type Lobby, type LobbyAction, type Player, type ResultRow } from '../src/lobby/lobby';
import { VOTE_MAX_MS, VOTE_MS, VOTED_MS, voteStep } from '../src/lobby/vote';
import { readAction, readLobby } from '../src/lobby/wire';
import { PostRace, resultOf } from '../src/net/postrace';
import { raceFromLobby } from '../src/ui/setup';
import { ringSim } from './helpers';

// After an online race (SPEC §11): one results table from each car's own screen, the vote on the
// next map (the host breaks a tie), and the next race for everyone still in.

const ada: Player = { id: 'ada', name: 'ADA', car: 'coupe', paint: 0 };
const bo: Player = { id: 'bo', name: 'BO', car: 'rally', paint: 1 };
const cy: Player = { id: 'cy', name: 'CY', car: 'bus', paint: 2 };
const DOWNTOWN = 'downtown/downtown';
const VALLEY = 'backroads/valley';
const ISLAND = 'paradise/island';

function ok(lobby: Lobby, actor: string, action: LobbyAction): Lobby {
  const next = apply(lobby, actor, action);
  expect(next).not.toBeNull();
  return next!;
}

/** ada's lobby with bo and cy seated (seats 0–2), an AI in seat 3, racing race 7 at t 1000. */
function racing(): Lobby {
  let l = createLobby('K7QM', ada);
  l = ok(l, 'bo', { type: 'join', player: bo });
  l = ok(l, 'cy', { type: 'join', player: cy });
  l = ok(l, 'ada', { type: 'seat', index: 3, to: 'ai-hard' });
  l = ok(l, 'bo', { type: 'ready', ready: true });
  l = ok(l, 'cy', { type: 'ready', ready: true });
  return ok(l, 'ada', { type: 'start', seed: 7, at: 1000 });
}

const row = (seat: number, time: number | null = 60): ResultRow => ({ seat, time, best: time && time / 2, takedowns: 1, wrecks: 0, score: 1200 });

describe('results', () => {
  test("each player reports their own seat's row; the host the AIs'; nobody else's", () => {
    let l = racing();
    const race = raceKey(l);
    l = ok(l, 'bo', { type: 'result', race, row: row(1) });
    l = ok(l, 'ada', { type: 'result', race, row: row(3, 70) });
    expect(apply(l, 'bo', { type: 'result', race, row: row(2) })).toBeNull();
    expect(apply(l, 'bo', { type: 'result', race, row: row(3) })).toBeNull();
    // The host doesn't speak for another player either.
    expect(apply(l, 'ada', { type: 'result', race, row: row(2) })).toBeNull();
    // Another race's, or between races.
    expect(apply(l, 'cy', { type: 'result', race: '7:999', row: row(2) })).toBeNull();
    expect(l.results?.map((r) => r.seat)).toEqual([1, 3]);
    // Sent again: replaced, not added.
    l = ok(l, 'bo', { type: 'result', race, row: row(1, 58) });
    expect(l.results?.find((r) => r.seat === 1)?.time).toBe(58);
    expect(l.results).toHaveLength(2);
    const back = ok(ok(l, 'ada', { type: 'racing', racing: false }), 'ada', { type: 'end' });
    expect(back.results).toBeUndefined();
    expect(apply(back, 'cy', { type: 'result', race, row: row(2) })).toBeNull();
  });
});

describe('the vote', () => {
  test('opens by the host only; any racer may pick, once it is open, and change their mind', () => {
    let l = racing();
    expect(apply(l, 'bo', { type: 'vote', map: VALLEY })).toBeNull();
    expect(apply(l, 'bo', { type: 'voteEnds', ends: 5000 })).toBeNull();
    l = ok(l, 'ada', { type: 'voteEnds', ends: 5000 });
    l = ok(l, 'bo', { type: 'vote', map: VALLEY });
    l = ok(l, 'bo', { type: 'vote', map: ISLAND });
    expect(l.vote).toEqual({ ends: 5000, votes: { bo: ISLAND } });
    // Moving the close keeps the votes.
    l = ok(l, 'ada', { type: 'voteEnds', ends: 3000 });
    expect(l.vote?.votes).toEqual({ bo: ISLAND });
    // Gone back to the lobby: not a racer, no vote.
    l = ok(l, 'cy', { type: 'racing', racing: false });
    expect(apply(l, 'cy', { type: 'vote', map: VALLEY })).toBeNull();
  });

  test('the winner: the most picked; a tie goes the host\'s way; else by the seed; no votes, the same map', () => {
    const base = ok(racing(), 'ada', { type: 'voteEnds', ends: 5000 });
    const with_ = (votes: Record<string, string>) => ({ ...base, vote: { ends: 5000, votes } });
    expect(tally(with_({ ada: VALLEY, bo: ISLAND, cy: ISLAND }))).toBe(ISLAND);
    expect(tally(with_({ ada: VALLEY, bo: ISLAND }))).toBe(VALLEY);
    // The host picked neither of the tied: the seed's pick, the same on every screen.
    const tied = tally(with_({ bo: ISLAND, cy: VALLEY }));
    expect([ISLAND, VALLEY]).toContain(tied);
    expect(tally(with_({ cy: VALLEY, bo: ISLAND }))).toBe(tied);
    expect(tally(with_({}))).toBe(DOWNTOWN);
    // Someone who left the race doesn't count.
    const left = ok(with_({ ada: VALLEY, bo: ISLAND, cy: ISLAND }), 'cy', { type: 'racing', racing: false });
    expect(tally(left)).toBe(VALLEY);
  });

  test('next: the winning map, a new race for everyone still in, results and votes cleared', () => {
    let l = ok(ok(racing(), 'bo', { type: 'result', race: '7:1000', row: row(1) }), 'cy', { type: 'racing', racing: false });
    l = ok(l, 'ada', { type: 'voteEnds', ends: 5000 });
    expect(apply(l, 'bo', { type: 'next', map: VALLEY, seed: 9, at: 9000 })).toBeNull();
    l = ok(l, 'ada', { type: 'next', map: VALLEY, seed: 9, at: 9000 });
    expect(l.phase).toBe('racing');
    expect(l.options.map).toBe(VALLEY);
    expect(raceKey(l)).toBe('9:9000');
    expect(l.results).toBeUndefined();
    expect(l.vote).toBeUndefined();
    expect(l.seats.slice(0, 3).map((s) => s.kind === 'player' && !!s.racing)).toEqual([true, true, false]);
    // cy sat out: an empty seat in the next race, not a car nobody drives.
    const link = raceFromLobby(l, 'ada', 9, true);
    expect(link.seats.slice(0, 4)).toBe('prxh');
    expect(link.others?.map((o) => o.id)).toEqual(['bo']);
    // At the start, everyone seated is in it.
    const first = raceFromLobby(racing(), 'ada', 7, true);
    expect(first.seats.slice(0, 3)).toBe('prr');
    expect(first.others?.map((o) => o.id)).toEqual(['bo', 'cy']);
  });
});

describe("the host's vote timer", () => {
  const seed = () => 42;
  test('opens at the first finish, closes 15 s after the last (or 3 s once everyone voted), then the next race', () => {
    let l = racing();
    const race = raceKey(l);
    expect(voteStep(l, 10_000, seed)).toBeNull();
    // An AI's finish doesn't open it: a player's does.
    l = ok(l, 'ada', { type: 'result', race, row: row(3) });
    expect(voteStep(l, 10_000, seed)).toBeNull();
    l = ok(l, 'bo', { type: 'result', race, row: row(1) });
    const open = voteStep(l, 10_000, seed);
    expect(open).toEqual({ type: 'voteEnds', ends: 10_000 + VOTE_MAX_MS });
    l = ok(l, 'ada', open!);
    // Still waiting on two: nothing to do.
    expect(voteStep(l, 20_000, seed)).toBeNull();
    l = ok(l, 'ada', { type: 'result', race, row: row(0) });
    l = ok(l, 'cy', { type: 'result', race, row: row(2) });
    const all = voteStep(l, 20_000, seed);
    expect(all).toEqual({ type: 'voteEnds', ends: 20_000 + VOTE_MS });
    l = ok(l, 'ada', all!);
    expect(voteStep(l, 20_500, seed)).toBeNull();
    for (const p of ['ada', 'bo', 'cy']) l = ok(l, p, { type: 'vote', map: p === 'ada' ? VALLEY : ISLAND });
    const voted = voteStep(l, 22_000, seed);
    expect(voted).toEqual({ type: 'voteEnds', ends: 22_000 + VOTED_MS });
    l = ok(l, 'ada', voted!);
    expect(voteStep(l, 25_000, seed)).toEqual({ type: 'next', map: ISLAND, seed: 42 });
  });

  test("the last player never finishing: it closes a minute after the first", () => {
    let l = ok(racing(), 'bo', { type: 'result', race: '7:1000', row: row(1) });
    l = ok(l, 'ada', voteStep(l, 10_000, () => 1)!);
    expect(voteStep(l, 10_000 + VOTE_MAX_MS - 1, () => 1)).toBeNull();
    expect(voteStep(l, 10_000 + VOTE_MAX_MS, () => 1)?.type).toBe('next');
  });
});

describe('what other players send about results and votes', () => {
  test('actions are checked', () => {
    expect(readAction({ type: 'result', race: '7:1000', row: row(1) }, 'bo')).toEqual({ type: 'result', race: '7:1000', row: row(1) });
    for (const bad of [{ ...row(1), seat: 9 }, { ...row(1), time: -1 }, { ...row(1), time: 'x' }, { ...row(1), score: NaN }, { ...row(1), wrecks: 1.5 }]) expect(readAction({ type: 'result', race: '7:1000', row: bad }, 'bo')).toBeNull();
    expect(readAction({ type: 'vote', map: VALLEY }, 'bo')).toEqual({ type: 'vote', map: VALLEY });
    expect(readAction({ type: 'vote', map: 'constructor' }, 'bo')).toBeNull();
    expect(readAction({ type: 'voteEnds', ends: 5 }, 'bo')).toEqual({ type: 'voteEnds', ends: 5 });
    expect(readAction({ type: 'voteEnds', ends: -5 }, 'bo')).toBeNull();
    expect(readAction({ type: 'next', map: VALLEY, seed: 3 }, 'bo')).toEqual({ type: 'next', map: VALLEY, seed: 3 });
    expect(readAction({ type: 'next', map: VALLEY, seed: 1.5 }, 'bo')).toBeNull();
  });

  test("the lobby's results and vote: kept when good, dropped (not the lobby) when not", () => {
    let l = ok(ok(racing(), 'bo', { type: 'result', race: '7:1000', row: row(1) }), 'ada', { type: 'voteEnds', ends: 5000 });
    l = ok(l, 'bo', { type: 'vote', map: VALLEY });
    expect(readLobby({ lobby: structuredClone(l) })).toEqual(l);
    const bad = { ...structuredClone(l), results: [row(1), { seat: 'x' }], vote: { ends: 5000, votes: { bo: 'toString' } } };
    const read = readLobby({ lobby: bad })!;
    expect(read.results).toEqual([row(1)]);
    expect(read.vote).toBeUndefined();
  });
});

describe("the race page's post-race", () => {
  /** A race page for `me` against a shared lobby, with a ring sim: car 0 is seat 0 (ada), car 1 seat 1 (bo), car 2 seat 3 (the AI). */
  function page(me: string) {
    let lobby = racing();
    const listeners = new Set<(l: Lobby | null) => void>();
    const went: Lobby[] = [];
    const backend = {
      youIn: () => me,
      get: async () => lobby,
      subscribe: (_id: string, fn: (l: Lobby | null) => void) => (listeners.add(fn), () => listeners.delete(fn)),
      send: async (_id: string, action: LobbyAction) => {
        const next = apply(lobby, me, action);
        if (next) {
          lobby = next;
          for (const fn of listeners) fn(lobby);
        }
        return next;
      },
    };
    const sim = ringSim(1);
    for (let k = 0; k < 3; k++) sim.addCar({ cls: 'coupe', human: k < 2 });
    let now = 10_000;
    const post = new PostRace({ backend, lobby: 'K7QM', race: '7:1000', sim, cars: new Map([[0, 0], [1, 1], [3, 2]]), seat: me === 'ada' ? 0 : 1, maps: [VALLEY, DOWNTOWN, ISLAND], now: () => now, go: (l) => went.push(l), seed: () => 5 });
    const finish = (i: number, t: number) => {
      sim.cars.finished[i] = 1;
      sim.cars.finishTime[i] = t;
    };
    return { post, sim, finish, went, lobby: () => lobby, set: (l: Lobby) => ((lobby = l), listeners.forEach((fn) => fn(l))), at: (t: number) => (now = t) };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  test("reports your own finish, and the host's page the AIs'; the lobby's rows show by car", async () => {
    const p = page('ada');
    await settle();
    await p.post.tick();
    expect(p.lobby().results).toBeUndefined();
    p.finish(0, 61);
    p.finish(1, 62);
    p.finish(2, 63);
    await p.post.tick();
    // Yours and the AI's (you're the host), not bo's: that's bo's page's to say.
    expect(p.lobby().results?.map((r) => r.seat)).toEqual([0, 3]);
    expect(p.lobby().results?.[0]).toEqual(resultOf(p.sim, 0, 0));
    expect([...p.post.official().keys()]).toEqual([0, 2]);
  });

  test("the host's page opens and closes the vote; everyone's page goes on to the next race", async () => {
    const p = page('ada');
    await settle();
    p.finish(0, 61);
    await p.post.tick();
    await p.post.tick();
    expect(p.lobby().vote?.ends).toBe(10_000 + VOTE_MAX_MS);
    p.post.vote(ISLAND);
    await settle();
    expect(p.post.view()).toMatchObject({ choices: [{ map: VALLEY, votes: 0 }, { map: DOWNTOWN, votes: 0 }, { map: ISLAND, votes: 1, mine: true }], allIn: false, over: false });
    p.at(10_000 + VOTE_MAX_MS);
    await p.post.tick();
    expect(p.lobby().options.map).toBe(ISLAND);
    expect(p.went).toHaveLength(1);
    expect(raceKey(p.went[0])).toBe('5:1000');
  });

  test('not the host: no vote timer; the host going back to the lobby ends it', async () => {
    const p = page('bo');
    await settle();
    p.finish(1, 61);
    await p.post.tick();
    await p.post.tick();
    expect(p.lobby().results?.map((r) => r.seat)).toEqual([1]);
    expect(p.lobby().vote).toBeUndefined();
    p.set({ ...p.lobby(), phase: 'lobby' });
    expect(p.post.view()).toMatchObject({ over: true });
    expect(p.went).toHaveLength(0);
  });

  test("sitting out (you went back): the next race doesn't take you", async () => {
    const p = page('bo');
    await settle();
    const l = ok(ok(p.lobby(), 'bo', { type: 'racing', racing: false }), 'ada', { type: 'voteEnds', ends: 1 });
    p.set(ok(l, 'ada', { type: 'next', map: VALLEY, seed: 8, at: 2000 }));
    expect(p.went).toHaveLength(0);
  });
});
