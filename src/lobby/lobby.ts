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
  | ({ kind: 'player'; ready: boolean } & Player)
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
  visibility: 'public' | 'private';
  phase: 'lobby' | 'racing';
  options: LobbyOptions;
  seats: Seat[];
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
  | { type: 'join'; player: Player }
  | { type: 'leave' }
  | { type: 'kick'; index: number }
  | { type: 'start' }
  | { type: 'end' };

export const DEFAULT_OPTIONS: LobbyOptions = { map: 'downtown/downtown', laps: 3, weather: 'random', time: 'random', mayhem: 'normal', traffic: true };
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
    case 'join': {
      if (mine >= 0 || seatIndex(lobby, action.player.id) >= 0 || lobby.phase !== 'lobby') return null;
      const open = lobby.seats.findIndex((s) => s.kind === 'open');
      if (open < 0) return null;
      next.seats[open] = { kind: 'player', ready: false, ...action.player };
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
      return next;
    }
    case 'end': {
      if (!isHost || lobby.phase !== 'racing') return null;
      next.phase = 'lobby';
      return next;
    }
  }
}

// ---- seats in a race link ----
// A race's cars, one letter a seat: `p` you, `e` `n` `h` an AI (easy, normal, hard), `o` an open
// seat (a bot at FILL_DIFFICULTY) and `x` closed. `pnnnnnnn` is you and seven normal AIs.

const AI_LETTERS = 'enh';
const SEATS_RE = /^[penhox]{1,8}$/;

/** The race link's seats for this lobby, as `you` see it (another player's seat is `x` until online races land). */
export function encodeSeats(lobby: Lobby, you: string): string {
  return lobby.seats
    .map((s) => (s.kind === 'player' ? (s.id === you ? 'p' : 'x') : s.kind === 'ai' ? AI_LETTERS[s.difficulty] : s.kind === 'open' ? 'o' : 'x'))
    .join('');
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
}

/**
 * The race's cars from its seats, in seat order (which is the grid), and their names: plates
 * (plate.ts), yours and each AI class's. An AI's car and paint come from its seat, so a seat keeps
 * its rival from race to race: seat `s` drives class `s` in your paint plus `s`, with that class's
 * plate. Closed seats get no car.
 */
export function roster(seats: string, classes: readonly string[], paints: number, you: { car: string; paint: number; plate?: string }): Roster {
  const specs: CarSpec[] = [];
  const names: string[] = [];
  let me = -1;
  [...seats].forEach((c, s) => {
    if (c === 'x') return;
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
  return { specs, names, me };
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
