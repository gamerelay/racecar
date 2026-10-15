// Online leaderboards (SPEC §10): your best lap per layout, from Time Trial only, on GameRelay's
// leaderboards. One board a layout, `lap:<map>.<layout>`, lower is better. The board's rules on
// the server hold the layout's lap floor (tools/lap-report.ts), so a faked time is refused there;
// the names on it are GameRelay's to moderate (the game's "Name moderation" setting).

/** What the page uses of the SDK's `relay.leaderboard`. */
export interface LeaderboardLike {
  submit(board: string, score: number, options?: { order?: 'asc' | 'desc' }): Promise<{ best: number; rank: number; improved: boolean }>;
  top(board: string, options?: { limit?: number }): Promise<BoardPage>;
}

export interface BoardEntry {
  rank: number;
  playerId: string;
  name: string;
  score: number;
}

export interface BoardPage {
  entries: BoardEntry[];
  /** Your own entry, even outside the top. */
  me: BoardEntry | null;
}

/** GameRelay's board names: 1–32 letters, digits and `_ . : -`. */
const BOARD_NAME = /^[A-Za-z0-9_.:-]{1,32}$/;

/** A layout's board (`downtown/downtown` -> `lap:downtown.downtown`), or null if its key can't make one. */
export function lapBoard(layoutKey: string): string | null {
  const name = `lap:${layoutKey.replace('/', '.')}`;
  return BOARD_NAME.test(name) ? name : null;
}

/** Times go up to the millisecond: the sim's float isn't worth more, and ties then mean something. */
export const lapScore = (seconds: number) => Math.round(seconds * 1000) / 1000;

/** How many rows the results show. */
export const BOARD_ROWS = 10;

/** What the results screen shows: the board as it stands, and how your best did on it. */
export interface BoardView {
  state: 'loading' | 'ready' | 'offline';
  page: BoardPage | null;
  /** Your submitted best this session: its rank, and whether it beat your old best. */
  mine: { rank: number; best: number; improved: boolean } | null;
  /** A time the server refused (under the lap floor, say): kept off the board. */
  rejected: boolean;
}

/**
 * One layout's board on a Time Trial page: each new best lap goes up as it happens (so leaving
 * early still counts), one submit at a time, and the board is read back after each.
 */
export class LapBoard {
  private submitted = Infinity;
  private chain: Promise<unknown> = Promise.resolve();
  view: BoardView = { state: 'loading', page: null, mine: null, rejected: false };
  /** The view changed (main.ts redraws the results' board). */
  onChange: (view: BoardView) => void = () => {};

  constructor(
    private readonly board: string,
    private readonly api: () => Promise<LeaderboardLike | null>,
  ) {}

  /** Read the board (the results screen, before any lap is in). */
  load(): Promise<void> {
    return this.run(async (lb) => this.refresh(lb));
  }

  /** Your best lap so far this run (0 = none yet): a new best goes up. */
  lap(best: number): void {
    if (!(best > 0)) return;
    const score = lapScore(best);
    if (score >= this.submitted) return;
    this.submitted = score;
    void this.run(async (lb) => {
      try {
        const r = await lb.submit(this.board, score, { order: 'asc' });
        this.set({ mine: r, rejected: false });
      } catch (err) {
        if ((err as { code?: string }).code !== 'rejected') throw err;
        this.set({ rejected: true });
      }
      await this.refresh(lb);
    });
  }

  private async refresh(lb: LeaderboardLike): Promise<void> {
    const top = await lb.top(this.board, { limit: BOARD_ROWS });
    this.set({ state: 'ready', page: { entries: top.entries, me: top.me } });
  }

  /** One call at a time, in order; no connection or a failure: offline (the race goes on). */
  private run(fn: (lb: LeaderboardLike) => Promise<void>): Promise<void> {
    const next = this.chain.then(async () => {
      const lb = await this.api().catch(() => null);
      if (!lb) return this.set({ state: 'offline' });
      await fn(lb).catch(() => this.set({ state: this.view.page ? 'ready' : 'offline' }));
    });
    this.chain = next;
    return next;
  }

  private set(change: Partial<BoardView>): void {
    this.view = { ...this.view, ...change };
    this.onChange(this.view);
  }
}
