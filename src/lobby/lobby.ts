// A lobby (SPEC §11, PLAN phase 2): every race is one. It has a name, a host, the race options
// and eight seats, each a player, open, an AI or closed; bots fill the open seats when the race
// starts, so playing alone is a lobby with seven of them. Changes are actions applied by `apply`,
// which holds the host rules, so a backend (local now, GameRelay rooms in milestone 3) only has
// to store lobbies and pass actions along. Pure: no DOM, no network.

import type { TimeOption } from '../core/content';
import type { CarSpec } from '../core/sim';
import { aiPlate } from './plate';

export const SEATS = 8;
export type Difficulty = 0 | 1 | 2;
export const DIFFICULTY_NAMES = ['easy', 'normal', 'hard'] as const;
/** What an open seat's bot drives at when the race starts. */
export const FILL_DIFFICULTY: Difficulty = 1;

export interface Player {
  id: string;
  name: string;
  car: string;
  paint: number;
}

export type Seat =
  /** `racing`: still in the lobby's race (online, the others may be back before them). */
  | ({ kind: 'player'; ready: boolean; racing?: boolean } & Player)
  | { kind: 'open' }
  | { kind: 'ai'; difficulty: Difficulty }
  | { kind: 'closed' };

export interface LobbyOptions {
  /** A layout key, like `downtown/downtown`. */
  map: string;
  laps: number;
  weather: 'clear' | 'rain' | 'random';
  /** Day or sunset, on a map that has a sunset (others ignore it). */
  time: TimeOption;
  mayhem: 'off' | 'normal' | 'chaos';
  traffic: boolean;
}

export interface Lobby {
  id: string;
  name: string;
  /** The host's player id: only the host changes seats and options, and starts the race. */
  host: string;
  /** Who can join: anyone (listed online), anyone with the link, or nobody new ("Private"). An older build's `private` was by link: `invite`. */
  visibility: 'public' | 'invite' | 'locked';
  phase: 'lobby' | 'racing';
  options: LobbyOptions;
  seats: Seat[];
  /** The race's seed, set at the start: online, everyone in the lobby races the same race. */
  seed?: number;
  /** When its lights go green, on the server's clock (ms): online, everyone's at once. */
  startAt?: number;
}

/** A row in the lobby list. */
export interface LobbySummary {
  id: string;
  name: string;
  map: string;
  laps: number;
  phase: Lobby['phase'];
  visibility: Lobby['visibility'];
  /** One letter per seat, as in a race's `seats` (with `o` open and `x` closed). */
  pips: string;
  players: number;
  /** Players and AIs: the cars on the grid if it started now, not counting the open seats' bots. */
  filled: number;
}

export type SeatChoice = 'open' | 'closed' | 'ai-easy' | 'ai-normal' | 'ai-hard';

export type LobbyAction =
  | { type: 'seat'; index: number; to: SeatChoice }
  | { type: 'options'; options?: Partial<LobbyOptions>; name?: string; visibility?: Lobby['visibility'] }
  | { type: 'car'; car: string; paint: number }
  /** Your name (your plate) changed. */
  | { type: 'name'; name: string }
  | { type: 'ready'; ready: boolean }
  /** You're in the lobby's race, or back from it. */
  | { type: 'racing'; racing: boolean }
  | { type: 'join'; player: Player }
  | { type: 'leave' }
  | { type: 'kick'; index: number }
  | { type: 'start'; seed?: number; at?: number }
  | { type: 'end' };

export const DEFAULT_OPTIONS: LobbyOptions = { map: 'downtown/downtown', laps: 2, weather: 'random', time: 'random', mayhem: 'normal', traffic: true };
const MAX_NAME = 32;

/** A new lobby: the host in the first seat, the rest open. */
export function createLobby(id: string, host: Player, init: { name?: string; visibility?: Lobby['visibility']; options?: Partial<LobbyOptions> } = {}): Lobby {
  const seats: Seat[] = [{ kind: 'player', ready: true, ...host }];
  while (seats.length < SEATS) seats.push({ kind: 'open' });
  return {
    id,
    name: cleanName(init.name) || `${host.name}'s lobby`,
    host: host.id,
    visibility: init.visibility ?? 'public',
    phase: 'lobby',
    options: { ...DEFAULT_OPTIONS, ...init.options },
    seats,
  };
}

function cleanName(s: string | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

function seatOf(choice: SeatChoice): Seat {
  if (choice === 'open' || choice === 'closed') return { kind: choice };
  return { kind: 'ai', difficulty: (['ai-easy', 'ai-normal', 'ai-hard'] as const).indexOf(choice) as Difficulty };
}

/** The seat index of player `id`, or -1. */
export function seatIndex(lobby: Lobby, id: string): number {
  return lobby.seats.findIndex((s) => s.kind === 'player' && s.id === id);
}

/** Every non-host player is ready (the host's Start waits on them). */
export function allReady(lobby: Lobby): boolean {
  return lobby.seats.every((s) => s.kind !== 'player' || s.id === lobby.host || s.ready);
}

/**
 * `lobby` after `actor` does `action`, or null if they may not. Never mutates: a refused action
 * leaves the lobby as it was. A lobby its last player leaves comes back with no host, for the
 * backend to drop.
 */
export function apply(lobby: Lobby, actor: string, action: LobbyAction): Lobby | null {
  const isHost = actor === lobby.host;
  const mine = seatIndex(lobby, actor);
  const next: Lobby = { ...lobby, options: { ...lobby.options }, seats: lobby.seats.slice() };
  switch (action.type) {
    case 'seat': {
      // The host sets the seats that aren't players'; a player's seat is theirs until they leave or are kicked.
      const s = lobby.seats[action.index];
      if (!isHost || lobby.phase !== 'lobby' || !s || s.kind === 'player') return null;
      next.seats[action.index] = seatOf(action.to);
      return next;
    }
    case 'options': {
      if (!isHost || lobby.phase !== 'lobby') return null;
      if (action.name !== undefined) next.name = cleanName(action.name) || lobby.name;
      if (action.visibility) next.visibility = action.visibility;
      Object.assign(next.options, action.options);
      next.options.laps = Math.max(1, Math.min(5, Math.round(next.options.laps)));
      return next;
    }
    case 'car': {
      const s = lobby.seats[mine];
      if (mine < 0 || s.kind !== 'player' || lobby.phase !== 'lobby') return null;
      // A new car un-readies you, so the host sees what you'll drive before starting.
      next.seats[mine] = { ...s, car: action.car, paint: action.paint, ready: actor === lobby.host };
      return next;
    }
    case 'name': {
      const s = lobby.seats[mine];
      const name = cleanName(action.name);
      if (mine < 0 || s.kind !== 'player' || !name) return null;
      next.seats[mine] = { ...s, name };
      return next;
    }
    case 'ready': {
      const s = lobby.seats[mine];
      if (mine < 0 || s.kind !== 'player') return null;
      next.seats[mine] = { ...s, ready: action.ready };
      return next;
    }
    case 'racing': {
      const s = lobby.seats[mine];
      if (mine < 0 || s.kind !== 'player' || !!s.racing === action.racing) return null;
      next.seats[mine] = { ...s, racing: action.racing };
      return next;
    }
    case 'join': {
      if (mine >= 0 || seatIndex(lobby, action.player.id) >= 0 || lobby.phase !== 'lobby') return null;
      // Private: nobody new sits down (unless there's nobody left to say so).
      if (lobby.visibility === 'locked' && lobby.host) return null;
      const open = lobby.seats.findIndex((s) => s.kind === 'open');
      if (open < 0) return null;
      next.seats[open] = { kind: 'player', ready: false, ...action.player };
      // A lobby everyone left (an online room can outlive its seats) goes to whoever sits down.
      if (!lobby.host) next.host = action.player.id;
      return next;
    }
    case 'leave': {
      if (mine < 0) return null;
      next.seats[mine] = { kind: 'open' };
      if (isHost) next.host = next.seats.find((s): s is Extract<Seat, { kind: 'player' }> => s.kind === 'player')?.id ?? '';
      return next;
    }
    case 'kick': {
      const s = lobby.seats[action.index];
      if (!isHost || !s || s.kind !== 'player' || s.id === actor) return null;
      next.seats[action.index] = { kind: 'open' };
      return next;
    }
    case 'start': {
      if (!isHost || lobby.phase !== 'lobby' || !allReady(lobby)) return null;
      next.phase = 'racing';
      // Everyone seated goes; each is back when their lobby screen opens again.
      next.seats = next.seats.map((s) => (s.kind === 'player' ? { ...s, racing: true } : s));
      if (action.seed !== undefined) next.seed = action.seed;
      if (action.at !== undefined) next.startAt = action.at;
      return next;
    }
    case 'end': {
      if (!isHost || lobby.phase !== 'racing') return null;
      next.phase = 'lobby';
      // Ready again for the next one: the host can't start it while the others are still racing this one.
      next.seats = next.seats.map((s) => (s.kind === 'player' && s.id !== lobby.host ? { ...s, ready: false } : s));
      return next;
    }
  }
}

// ---- seats in a race link ----
// A race's cars, one letter a seat: `p` you, `r` another player online, `e` `n` `h` an AI (easy,
// normal, hard), `o` an open seat (a bot at FILL_DIFFICULTY) and `x` closed. `pnnnnnnn` is you
// and seven normal AIs.

const AI_LETTERS = 'enh';
const SEATS_RE = /^[penhoxr]{1,8}$/;

/**
 * The race link's seats for this lobby, as `you` see it. Another player's seat is `r` online (their
 * car, driven by them: net/cars.ts), and `x` in a local lobby, where nobody else drives.
 */
export function encodeSeats(lobby: Lobby, you: string, online = false): string {
  return lobby.seats
    .map((s) => (s.kind === 'player' ? (s.id === you ? 'p' : online ? 'r' : 'x') : s.kind === 'ai' ? AI_LETTERS[s.difficulty] : s.kind === 'open' ? 'o' : 'x'))
    .join('');
}

/** Another player in an online race: their seat (the grid slot), id, car, paint and plate. */
export interface Other {
  seat: number;
  id: string;
  car: string;
  paint: number;
  name: string;
}

/** The other players in a lobby, as `you` race them. */
export function othersIn(lobby: Lobby, you: string): Other[] {
  return lobby.seats.flatMap((s, seat) => (s.kind === 'player' && s.id !== you ? [{ seat, id: s.id, car: s.car, paint: s.paint, name: s.name }] : []));
}

/** A `seats` value if it's a valid one with exactly one `p`, else null. */
export function parseSeats(v: string | null): string | null {
  if (!v || !SEATS_RE.test(v)) return null;
  return v.split('p').length === 2 ? v : null;
}

/** The seats an old link meant: you, then `opponents` AIs at one difficulty. */
export function legacySeats(opponents: number, difficulty: Difficulty): string {
  return ('p' + AI_LETTERS[difficulty].repeat(opponents)).padEnd(SEATS, 'x').slice(0, SEATS);
}

export interface Roster {
  specs: CarSpec[];
  names: string[];
  /** Your car's index, or -1 when there's no you (attract mode). */
  me: number;
  /** Each other player's car index, by their id (online). */
  remote: Map<string, number>;
}

/**
 * The race's cars from its seats, in seat order (which is the grid), and their names: plates
 * (plate.ts), yours and each AI class's. An AI's car and paint come from its seat, so a seat keeps
 * its rival from race to race: seat `s` drives class `s` in your paint plus `s`, with that class's
 * plate. Closed seats get no car.
 */
export function roster(seats: string, classes: readonly string[], paints: number, you: { car: string; paint: number; plate?: string }, others: readonly Other[] = []): Roster {
  const specs: CarSpec[] = [];
  const names: string[] = [];
  const remote = new Map<string, number>();
  let me = -1;
  [...seats].forEach((c, s) => {
    if (c === 'x') return;
    if (c === 'r') {
      // Their car as the lobby had it; a seat the link doesn't describe stays empty.
      const o = others.find((x) => x.seat === s);
      if (!o) return;
      remote.set(o.id, specs.length);
      specs.push({ cls: classes.includes(o.car) ? o.car : classes[0], paint: o.paint % paints, remote: true });
      names.push(o.name);
      return;
    }
    if (c === 'p') {
      me = specs.length;
      specs.push({ cls: you.car, paint: you.paint, human: true });
      names.push(you.plate ?? 'YOU');
      return;
    }
    const difficulty = (c === 'o' ? FILL_DIFFICULTY : AI_LETTERS.indexOf(c)) as Difficulty;
    const cls = classes[s % classes.length];
    specs.push({ cls, paint: (you.paint + s) % paints, racer: { difficulty } });
    names.push(aiPlate(cls));
  });
  return { specs, names, me, remote };
}

/** The lobby list's row for a lobby. */
export function summarize(lobby: Lobby): LobbySummary {
  const pips = encodeSeats(lobby, '').replace(/x/g, (_, k: number) => (lobby.seats[k].kind === 'player' ? 'p' : 'x'));
  const players = lobby.seats.filter((s) => s.kind === 'player').length;
  return {
    id: lobby.id,
    name: lobby.name,
    map: lobby.options.map,
    laps: lobby.options.laps,
    phase: lobby.phase,
    visibility: lobby.visibility,
    pips,
    players,
    filled: players + lobby.seats.filter((s) => s.kind === 'ai').length,
  };
}
