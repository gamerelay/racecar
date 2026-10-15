import { describe, expect, test } from 'bun:test';
import { LapBoard, lapBoard, lapScore, type BoardPage, type LeaderboardLike } from '../src/net/leaderboard';
import { nameChecker } from '../src/net/names';
import { lapTime } from '../src/ui/format';
import { menuQuery, readSetup, toQuery, trialSetup } from '../src/ui/setup';
import { LAYOUT_KEYS } from '../tools/content';

/** A board in memory, ranked like GameRelay's: each player's best, lower first. */
class FakeBoard implements LeaderboardLike {
  scores = new Map<string, number>();
  submits: number[] = [];
  floor = 0;
  constructor(public player = 'p_me') {}
  async submit(_board: string, score: number) {
    this.submits.push(score);
    if (score < this.floor) throw Object.assign(new Error('Score rejected'), { code: 'rejected' });
    const old = this.scores.get(this.player);
    const improved = old === undefined || score < old;
    if (improved) this.scores.set(this.player, score);
    return { best: this.scores.get(this.player)!, rank: this.rank(this.player), improved };
  }
  async top(): Promise<BoardPage> {
    const entries = [...this.scores].sort((a, b) => a[1] - b[1]).map(([playerId, score]) => ({ rank: this.rank(playerId), playerId, name: playerId.toUpperCase(), score }));
    return { entries, me: entries.find((e) => e.playerId === this.player) ?? null };
  }
  private rank(id: string) {
    const mine = this.scores.get(id)!;
    return 1 + [...this.scores.values()].filter((s) => s < mine).length;
  }
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('lap boards', () => {
  test('every layout has a board name GameRelay takes', () => {
    for (const key of LAYOUT_KEYS) expect([key, lapBoard(key)]).toEqual([key, expect.stringMatching(/^lap:[a-z0-9-]+\.[a-z0-9-]+$/)]);
    expect(lapBoard('downtown/downtown')).toBe('lap:downtown.downtown');
    expect(lapBoard(`a/${'b'.repeat(40)}`)).toBeNull();
  });

  test('times go up to the millisecond and read that way', () => {
    expect(lapScore(62.81949)).toBe(62.819);
    expect(lapTime(62.819)).toBe('1:02.819');
    expect(lapTime(9.5)).toBe('0:09.500');
  });

  test('each lap goes up only if it beats your best, one at a time, and the board is read back', async () => {
    const fake = new FakeBoard();
    fake.scores.set('p_rival', 61);
    const board = new LapBoard('lap:x.y', async () => fake);
    const views: string[] = [];
    board.onChange = (v) => views.push(v.state);
    await board.load();
    board.lap(0); // no lap
    board.lap(65.4321);
    board.lap(65.4321); // the same time again: nothing
    board.lap(63);
    board.lap(64); // slower than your best
    await settle();
    await board.load();
    expect(fake.submits).toEqual([65.432, 63]);
    expect(board.view.mine).toEqual({ best: 63, rank: 2, improved: true });
    expect(board.view.page?.entries.map((e) => e.playerId)).toEqual(['p_rival', 'p_me']);
    expect(views[0]).toBe('ready');
  });

  test('a time under the floor is refused and said so; no connection is offline', async () => {
    const fake = new FakeBoard();
    fake.floor = 50;
    const board = new LapBoard('lap:x.y', async () => fake);
    board.lap(12);
    await board.load();
    expect(board.view).toMatchObject({ rejected: true, state: 'ready', mine: null });

    // A refused lap doesn't hide the next good one, faster or slower.
    board.lap(55);
    await board.load();
    expect(fake.submits).toEqual([12, 55]);
    expect(board.view).toMatchObject({ rejected: false, mine: { best: 55, improved: true } });

    // A lap that failed to send: the next one still goes up.
    let down = true;
    const flaky = new FakeBoard();
    const retry = new LapBoard('lap:x.y', async () => (down ? Promise.reject(new Error('offline')) : flaky));
    retry.lap(60);
    await retry.load();
    down = false;
    retry.lap(61);
    await retry.load();
    expect(flaky.submits).toEqual([61]);

    const none = new LapBoard('lap:x.y', async () => null);
    none.lap(60);
    await none.load();
    expect(none.view.state).toBe('offline');
    const gone = new LapBoard('lap:x.y', () => Promise.reject(new Error('no network')));
    await gone.load();
    expect(gone.view.state).toBe('offline');
  });
});

describe('Time Trial setup', () => {
  test("a trial link is yours alone in the board's conditions, whatever it says", () => {
    const q = new URLSearchParams('mode=trial&map=downtown/downtown&seats=phhhhhhh&weather=rain&mayhem=chaos&traffic=1&lobby=abc&laps=2');
    expect(readSetup(q, 'downtown/downtown')).toMatchObject({ mode: 'trial', seats: 'p', weather: 'clear', mayhem: 'off', traffic: false, lobby: undefined, laps: 2 });
  });

  test('round trips, and goes back to the menu without its mode', () => {
    const s = trialSetup('backroads/valley', { car: 'rally', paint: 2 }, 'sunset');
    expect(readSetup(new URLSearchParams(toQuery(s)), 'downtown/downtown')).toEqual({ ...s, lobby: undefined, others: undefined, at: undefined });
    const back = new URLSearchParams(menuQuery(s));
    // Back on the menu, the trial's conditions aren't your next race's defaults.
    for (const k of ['mode', 'seats', 'weather', 'mayhem', 'traffic', 'laps']) expect([k, back.get(k)]).toEqual([k, null]);
    expect(back.get('map')).toBe('backroads/valley');
    expect(back.get('car')).toBe('rally');
  });
});

describe('name checks', () => {
  const answering = (status: number, body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  test("GameRelay's verdict, as a player reads it", async () => {
    let sent: unknown = null;
    const fetcher = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ ok: false, error: { code: 'moderated', reason: 'offensive', message: 'Invalid name: offensive language' } }));
    }) as unknown as typeof fetch;
    expect(await nameChecker('gr_pub_x', 'http://localhost:8787/', fetcher)('B4D')).toBe("That name isn't allowed");
    expect(sent).toEqual({ url: 'http://localhost:8787/v1/moderate', body: { publicKey: 'gr_pub_x', text: 'B4D' } });
    expect(await nameChecker('k', undefined, answering(200, { ok: false, error: { code: 'moderated', reason: 'reserved', message: '' } }))('ADMIN')).toBe('That name is kept for the game');
    expect(await nameChecker('k', undefined, answering(200, { ok: true, value: 'RC 1' }))('RC 1')).toBeNull();
  });

  test('fails open: a plan without it, an error or no network lets the name through', async () => {
    expect(await nameChecker('k', undefined, answering(403, { error: 'plan_required' }))('X')).toBeNull();
    expect(await nameChecker('k', undefined, answering(500, {}))('X')).toBeNull();
    expect(await nameChecker('k', undefined, (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch)('X')).toBeNull();
  });
});
