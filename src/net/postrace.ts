// After an online race, on its page (SPEC §11): the results go to the lobby, the vote on the next
// map, and into the next race.
//
// - Each car's result is reported by the screen that drives it: yours by you, the AIs' by the
//   lobby's host (whose screen counts their laps like any). The lobby keeps one table, and the
//   results screen shows it over this screen's own numbers.
// - The vote opens when the first player finishes; the lobby host's page runs it (lobby/vote.ts).
// - The next race starts by itself, for everyone still on a race page: each moves to it when the
//   lobby says so. "Back to lobby" sits you out (your seat stops racing), and the lobby's host
//   going back ends it for everyone, as before.

import type { Sim } from '../core/sim';
import type { LobbyBackend } from '../lobby/backend';
import { raceKey, seatIndex, type Lobby, type ResultRow } from '../lobby/lobby';
import { voteStep } from '../lobby/vote';
import { warned } from '../lobby/warn';

/** What the results screen shows of the vote. */
export interface VoteView {
  /** The maps, in order, with how many picked each and whether you did. */
  choices: { map: string; votes: number; mine: boolean }[];
  /** Seconds until it closes (0 once it has). */
  left: number;
  /** Everyone still racing is in. */
  allIn: boolean;
  /** The host went back to the lobby: no next race. */
  over: boolean;
}

export interface PostRaceDeps {
  backend: Pick<LobbyBackend, 'get' | 'send' | 'subscribe' | 'youIn'>;
  lobby: string;
  /** This race (its seed and start, as the lobby has them). */
  race: string;
  sim: Sim;
  /** Each seat's car on this screen. */
  cars: ReadonlyMap<number, number>;
  /** Your seat. */
  seat: number;
  /** The maps to vote on (layout keys). */
  maps: readonly string[];
  /** The server's clock (ms). */
  now: () => number;
  /** Into the next race. */
  go: (lobby: Lobby) => void;
  seed?: () => number;
}

/** A car's row from this screen's sim. */
export function resultOf(sim: Sim, i: number, seat: number): ResultRow {
  const c = sim.cars;
  return { seat, time: c.finished[i] ? c.finishTime[i] : null, best: c.bestLap[i] > 0 ? c.bestLap[i] : null, takedowns: c.takedowns[i], wrecks: c.wrecks[i], score: Math.floor(c.score[i]) };
}

export class PostRace {
  /** The lobby as it last came. */
  lobby: Lobby | null = null;
  private reported = new Map<number, number>();
  private sending = false;
  private gone = false;
  private off: () => void;

  constructor(private d: PostRaceDeps) {
    // No pings: nothing on the race page shows them.
    this.off = d.backend.subscribe(d.lobby, (l) => this.update(l), { pings: false });
    // The lobby as it is now (a subscription only says when it changes); the race page's join has it already.
    void d.backend.get(d.lobby).then(
      (l) => l && !this.lobby && this.update(l),
      () => {},
    );
  }

  private get you(): string {
    return this.d.backend.youIn(this.d.lobby);
  }

  private update(l: Lobby | null): void {
    this.lobby = l;
    if (!l || this.gone) return;
    // The next race: you're still in this one (on its page), so on to it.
    const s = l.seats[seatIndex(l, this.you)];
    if (l.phase === 'racing' && l.seed !== undefined && raceKey(l) !== this.d.race && s?.kind === 'player' && s.racing) {
      this.gone = true;
      this.d.go(l);
    }
  }

  /** A few times a second: report finishes, and on the lobby host's page, run the vote. */
  async tick(): Promise<void> {
    const l = this.lobby;
    if (!l || this.gone || this.sending || l.phase !== 'racing' || raceKey(l) !== this.d.race) return;
    this.sending = true;
    try {
      const host = l.host === this.you;
      const theirs = new Set((l.results ?? []).filter((r) => r.time !== null).map((r) => r.seat));
      for (const [seat, i] of this.d.cars) {
        const s = l.seats[seat];
        const mine = seat === this.d.seat || (host && (s?.kind === 'ai' || s?.kind === 'open'));
        if (!mine || !this.d.sim.cars.finished[i] || theirs.has(seat)) continue;
        // One try every couple of seconds until the lobby has it (the host role may be moving).
        if (performance.now() - (this.reported.get(seat) ?? -Infinity) < 2000) continue;
        this.reported.set(seat, performance.now());
        await this.send({ type: 'result', race: this.d.race, row: resultOf(this.d.sim, i, seat) });
      }
      if (host) {
        const action = voteStep(this.lobby ?? l, this.d.now(), this.d.seed ?? (() => Math.floor(Math.random() * 2 ** 31)));
        if (action) await this.send(action);
      }
    } finally {
      this.sending = false;
    }
  }

  private async send(action: Parameters<PostRaceDeps['backend']['send']>[1]): Promise<void> {
    const next = await this.d.backend.send(this.d.lobby, action).catch(warned(`the lobby didn't take ${action.type}`, null));
    if (next) this.update(next);
  }

  /** Your pick. */
  vote(map: string): void {
    void this.send({ type: 'vote', map });
  }

  /** The lobby's results for this race, by car on this screen. */
  official(): Map<number, ResultRow> {
    const out = new Map<number, ResultRow>();
    const l = this.lobby;
    if (!l || raceKey(l) !== this.d.race) return out;
    for (const r of l.results ?? []) {
      const i = this.d.cars.get(r.seat);
      if (i !== undefined) out.set(i, r);
    }
    return out;
  }

  /** The vote as the results screen shows it, or null before it opens. */
  view(): VoteView | null {
    const l = this.lobby;
    if (!l) return null;
    if (l.phase !== 'racing') return { choices: [], left: 0, allIn: false, over: true };
    if (raceKey(l) !== this.d.race || !l.vote) return null;
    const votes = l.vote.votes;
    const racing = l.seats.filter((s) => s.kind === 'player' && s.racing);
    const counts = new Map<string, number>();
    for (const s of racing) if (s.kind === 'player' && votes[s.id]) counts.set(votes[s.id], (counts.get(votes[s.id]) ?? 0) + 1);
    const done = new Set((l.results ?? []).filter((r) => r.time !== null).map((r) => r.seat));
    return {
      choices: this.d.maps.map((map) => ({ map, votes: counts.get(map) ?? 0, mine: votes[this.you] === map })),
      left: Math.max(0, Math.ceil((l.vote.ends - this.d.now()) / 1000)),
      allIn: racing.every((s) => s.kind === 'player' && done.has(seatIndex(l, s.id))),
      over: false,
    };
  }

  close(): void {
    this.off();
  }
}
