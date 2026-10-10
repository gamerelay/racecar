// The race page's online part (milestone 3), in one place: it joins the lobby's room (join.ts),
// holds the net layers the step loop calls before and after each step (your car, the host's AIs,
// traffic hits, bumps and credit), hands the page the relay's tick to step on, and after the race
// sends the results and runs the vote (postrace.ts). main.ts makes one when the race is online.

import type { MapDef } from '../core/content';
import type { Sim } from '../core/sim';
import type { LobbyBackend } from '../lobby/backend';
import type { RelayLike } from '../lobby/relay';
import type { RaceUi } from '../ui/race';
import { goTo } from '../ui/fade';
import { raceFromLobby, toQuery, type RaceSetup } from '../ui/setup';
import { joinRace, type NetLayers } from './join';
import { PostRace } from './postrace';
import type { Tick } from './stepper';

export interface OnlineRaceDeps {
  /** The lobbies (results, the vote, the next race). */
  lobbies: Pick<LobbyBackend, 'get' | 'send' | 'subscribe' | 'youIn'>;
  /** The online backend: the lobby's room, and the connection. */
  online: { get(id: string): Promise<unknown>; connection(): Promise<RelayLike> };
  run: RaceSetup & { lobby: string };
  sim: Sim;
  /** Your car's index, the other players' by id, and the AIs' by seat. */
  me: number;
  remote: Map<string, number>;
  aiSeats: ReadonlyMap<number, number>;
  /** Once in: the tick to step the race on (it keeps going in a hidden tab). */
  onTick: (tick: Tick) => void;
}

export class OnlineRace {
  /** The net layers, once in. */
  layers: NetLayers | null = null;
  /** What else runs on the tick once it's here. */
  private whenTick: ((tick: Tick) => void)[] = [];

  constructor(private d: OnlineRaceDeps) {
    void joinRace({
      lobby: () => d.online.get(d.run.lobby),
      connection: () => d.online.connection(),
      sim: d.sim,
      me: d.me,
      remote: d.remote,
      aiSeats: d.aiSeats,
      seed: d.run.seed,
      at: d.run.at,
      onNet: (layers) => {
        this.layers = layers;
        if (!layers.tick) return;
        d.onTick(layers.tick);
        for (const f of this.whenTick) f(layers.tick);
      },
    });
  }

  /** Before each step: the others' cars and the AIs where they are now, and the race's clock. */
  beforeStep(): void {
    this.layers?.cars.beforeStep();
    this.layers?.rivals?.beforeStep();
    this.layers?.cops?.beforeStep();
  }

  /** After each step: your car (and the host's AIs) out, traffic hits claimed, bumps and wrecks told. */
  afterStep(): void {
    const l = this.layers;
    if (!l) return;
    l.cars.afterStep();
    l.rivals?.afterStep();
    l.cops?.afterStep();
    l.traffic?.afterStep();
    l.walls?.afterStep();
    l.contact?.afterStep();
  }

  /**
   * After the race (postrace.ts): the lobby's results on the results screen, the vote on the next
   * map, and on into the next race. Not for a link without the race's start (an older one).
   */
  results(raceUi: RaceUi, maps: readonly MapDef[]): void {
    const { run, sim, me, remote, aiSeats, lobbies, online } = this.d;
    if (run.at === undefined) return;
    let serverNow: () => number = () => Date.now();
    void online
      .connection()
      .then((r) => (serverNow = () => r.now()))
      .catch(() => {});
    const seat = run.seats.indexOf('p');
    const cars = new Map<number, number>([[seat, me], ...aiSeats]);
    for (const o of run.others ?? []) {
      const i = remote.get(o.id);
      if (i !== undefined) cars.set(o.seat, i);
    }
    const post = new PostRace({
      backend: lobbies,
      lobby: run.lobby,
      race: `${run.seed}:${run.at}`,
      sim,
      cars,
      seat,
      // Every map, in name order.
      maps: [...maps].sort((a, b) => a.name.localeCompare(b.name)).map((m) => `${m.id}/${m.layouts[0]}`),
      now: () => serverNow(),
      go: (l) => goTo(toQuery(raceFromLobby(l, lobbies.youIn(l.id), l.seed!, true))),
    });
    // On a page timer until the race page is in, then on the relay's tick: the lobby host's page
    // runs the vote, and a hidden tab's timers slow to once a minute.
    const timer = setInterval(() => void post.tick(), 250);
    this.whenTick.push((tick) => {
      clearInterval(timer);
      tick(4, () => void post.tick());
    });
    raceUi.official = () => post.official();
    raceUi.vote = () => post.view();
    raceUi.onVote = (map) => post.vote(map);
    raceUi.mapName = (key) => maps.find((m) => key.startsWith(`${m.id}/`))?.name ?? key;
  }
}
