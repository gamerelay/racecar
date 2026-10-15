import { describe, expect, test } from 'bun:test';
import { LapBoard, lapBoard, lapScore, type BoardPage, type LeaderboardLike } from '../src/net/leaderboard';
import { nameCheck, type Moderate, type RelayLike } from '../src/lobby/relay';
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
  const refused = (message: string): Moderate => async () => ({ ok: false, error: { message } });
  const passed: Moderate = async (text) => ({ ok: true, value: text });

  test("over the open connection when there is one, else over HTTP; the SDK's message as the player reads it", async () => {
    const calls: unknown[] = [];
    const http: Moderate = async (text, rules) => (calls.push(['http', text, rules]), { ok: false, error: { message: 'Invalid name: offensive language' } });
    let relay: RelayLike | null = null;
    const check = nameCheck(() => relay, http);
    expect(await check('B4D', { maxLength: 7, charset: 'alnum' })).toBe('Invalid name: offensive language');
    relay = { moderate: async (text: string) => (calls.push(['socket', text]), { ok: true, value: text }) } as unknown as RelayLike;
    expect(await check('RC 1')).toBeNull();
    expect(calls).toEqual([['http', 'B4D', { maxLength: 7, charset: 'alnum' }], ['socket', 'RC 1']]);
    expect(await nameCheck(() => null, refused('Invalid name: kept for the game'))('ADMIN')).toBe('Invalid name: kept for the game');
    expect(await nameCheck(() => null, passed)('RC 1')).toBeNull();
  });

  test('fails open: a plan without it, an error or no network lets the name through', async () => {
    const failing: Moderate = () => Promise.reject(Object.assign(new Error('plan'), { code: 'plan_required' }));
    expect(await nameCheck(() => null, failing)('X')).toBeNull();
    // An SDK from before relay.moderate: HTTP, as before connecting.
    expect(await nameCheck(() => ({}) as RelayLike, refused('no'))('X')).toBe('no');
  });
});
