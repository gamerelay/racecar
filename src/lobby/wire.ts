// What other players send, checked before anything uses it (milestone 3). Everything here comes
// off the network from someone else's page: an action for the host to apply, a room's listing, the
// lobby in a room's state, a ping. Each reader returns the value in its proper shape, or null for
// anything malformed. Pure: no SDK, no DOM.

import { cleanPlate, plateProblem } from './plate';
import { DEFAULT_OPTIONS, SEATS, VISIBILITIES, type Difficulty, type Lobby, type LobbyAction, type LobbyOptions, type LobbySummary, type ResultRow, type Seat, type SeatChoice, type Vote } from './lobby';

const SEAT_CHOICES: readonly SeatChoice[] = ['open', 'closed', 'ai-easy', 'ai-normal', 'ai-hard'];
const OPTION_KEYS: readonly (keyof LobbyOptions)[] = ['map', 'laps', 'weather', 'time', 'mayhem', 'traffic'];
const OPTION_VALUES: Partial<Record<keyof LobbyOptions, readonly unknown[]>> = {
  weather: ['clear', 'rain', 'random'],
  time: ['day', 'sunset', 'random'],
  mayhem: ['off', 'normal', 'chaos'],
};

export const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
/** A player's name is their plate: only what a plate can show (it's drawn in other players' pages),
 * and one the menu would have refused is shown as a stock plate. */
const plate = (v: unknown): string | null => {
  const p = str(v, 64) ? cleanPlate(v) : '';
  return p ? (plateProblem(p) ? 'RC' : p) : null;
};
const int = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
/** A layout key's shape (`downtown/downtown`): never a name every object has, like `constructor`. */
const MAP_KEY = /^[a-z0-9-]{1,30}\/[a-z0-9-]{1,30}$/;
const mapKey = (v: unknown): v is string => typeof v === 'string' && MAP_KEY.test(v);

const time = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
/** A race time or lap (s): a day's worth at most, or null for none. */
const raceSeconds = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 86_400);

/** A car's result row, checked. */
export function readResult(v: unknown): ResultRow | null {
  if (!obj(v) || !int(v.seat, 0, SEATS - 1) || !raceSeconds(v.time) || !raceSeconds(v.best)) return null;
  if (!int(v.takedowns, 0, 999) || !int(v.wrecks, 0, 999) || !(typeof v.score === 'number' && Number.isFinite(v.score) && v.score >= 0 && v.score < 1e9)) return null;
  return { seat: v.seat, time: v.time, best: v.best, takedowns: v.takedowns, wrecks: v.wrecks, score: v.score };
}

/** The vote in a lobby's state, checked: a close time and each player's map. */
function readVote(v: unknown): Vote | null {
  if (!obj(v) || !time(v.ends) || !obj(v.votes)) return null;
  const votes: Record<string, string> = {};
  for (const [id, m] of Object.entries(v.votes)) {
    if (!str(id, 64) || !mapKey(m)) return null;
    votes[id] = m;
  }
  return Object.keys(votes).length <= SEATS ? { ends: v.ends, votes } : null;
}

/** A lobby's options as someone sent them (any of them), or null if one is malformed. Unknown keys are dropped. */
function readOptions(v: unknown): Partial<LobbyOptions> | null {
  if (!obj(v)) return null;
  const o: Partial<LobbyOptions> = {};
  for (const k of OPTION_KEYS) {
    const x = v[k];
    if (x === undefined) continue;
    const ok = k === 'map' ? mapKey(x) : k === 'laps' ? int(x, 1, 9) : k === 'traffic' ? typeof x === 'boolean' : OPTION_VALUES[k]!.includes(x);
    if (!ok) return null;
    (o as Record<string, unknown>)[k] = x;
  }
  return o;
}

/** A seat in a lobby's state, checked: a player's with a plate for a name, or one of the others. */
function readSeat(v: unknown): Seat | null {
  if (!obj(v)) return null;
  switch (v.kind) {
    case 'open':
    case 'closed':
      return { kind: v.kind };
    case 'ai':
      return int(v.difficulty, 0, 2) ? { kind: 'ai', difficulty: v.difficulty as Difficulty } : null;
    case 'player': {
      const name = plate(v.name);
      if (!str(v.id, 64) || !v.id || !name || !str(v.car, 32) || !int(v.paint, 0, 255) || typeof v.ready !== 'boolean') return null;
      if (v.racing !== undefined && typeof v.racing !== 'boolean') return null;
      return { kind: 'player', id: v.id, name, car: v.car, paint: v.paint, ready: v.ready, ...(v.racing === undefined ? {} : { racing: v.racing }) };
    }
  }
  return null;
}

/**
 * An action as another player sent it, checked, with the player it comes from: `from` is the id
 * the server vouches for, so a join is always the sender's own. Null for anything malformed.
 */
export function readAction(data: unknown, from: string): LobbyAction | null {
  if (!obj(data) || typeof data.type !== 'string') return null;
  switch (data.type) {
    case 'seat':
      return int(data.index, 0, SEATS - 1) && SEAT_CHOICES.includes(data.to as SeatChoice) ? { type: 'seat', index: data.index, to: data.to as SeatChoice } : null;
    case 'options': {
      const out: Extract<LobbyAction, { type: 'options' }> = { type: 'options' };
      if (data.name !== undefined) {
        if (!str(data.name, 64)) return null;
        out.name = data.name;
      }
      if (data.visibility !== undefined) {
        // An older build's `private` was by link.
        const v = data.visibility === 'private' ? 'invite' : data.visibility;
        if (!VISIBILITIES.includes(v as Lobby['visibility'])) return null;
        out.visibility = v as Lobby['visibility'];
      }
      if (data.options !== undefined) {
        const o = readOptions(data.options);
        if (!o) return null;
        out.options = o;
      }
      return out;
    }
    case 'car':
      return str(data.car, 32) && int(data.paint, 0, 255) ? { type: 'car', car: data.car, paint: data.paint } : null;
    case 'name': {
      const name = plate(data.name);
      return name ? { type: 'name', name } : null;
    }
    case 'ready':
      return typeof data.ready === 'boolean' ? { type: 'ready', ready: data.ready } : null;
    case 'racing':
      return typeof data.racing === 'boolean' ? { type: 'racing', racing: data.racing } : null;
    case 'join': {
      const p = data.player;
      const name = obj(p) ? plate(p.name) : null;
      if (!obj(p) || !name || !str(p.car, 32) || !int(p.paint, 0, 255)) return null;
      return { type: 'join', player: { id: from, name, car: p.car, paint: p.paint } };
    }
    case 'kick':
      return int(data.index, 0, SEATS - 1) ? { type: 'kick', index: data.index } : null;
    case 'start': {
      if (data.seed !== undefined && !int(data.seed, 0, 2 ** 31 - 1)) return null;
      if (data.at !== undefined && !(typeof data.at === 'number' && Number.isFinite(data.at) && data.at > 0)) return null;
      return { type: 'start', ...(data.seed === undefined ? {} : { seed: data.seed as number }), ...(data.at === undefined ? {} : { at: data.at as number }) };
    }
    case 'leave':
    case 'end':
      return { type: data.type };
    case 'result': {
      const row = readResult(data.row);
      return row && str(data.race, 40) ? { type: 'result', race: data.race, row } : null;
    }
    case 'vote':
      return mapKey(data.map) ? { type: 'vote', map: data.map } : null;
    case 'voteEnds':
      return time(data.ends) ? { type: 'voteEnds', ends: data.ends } : null;
    case 'next': {
      if (!mapKey(data.map) || !int(data.seed, 0, 2 ** 31 - 1) || (data.at !== undefined && !time(data.at))) return null;
      return { type: 'next', map: data.map, seed: data.seed, ...(data.at === undefined ? {} : { at: data.at as number }) };
    }
  }
  return null;
}

const PIPS = /^[penhox]{8}$/;

/** A room's listing as a lobby row, or null if it isn't a racecar lobby's (a host writes it, so it's checked). */
export function readListing(r: { code: string; name: string | null; meta: unknown }): LobbySummary | null {
  const m = r.meta;
  if (!obj(m) || !mapKey(m.map) || !int(m.laps, 1, 9) || (m.phase !== 'lobby' && m.phase !== 'racing') || !str(m.pips, 8) || !PIPS.test(m.pips)) return null;
  if (!int(m.players, 0, SEATS) || !int(m.filled, 0, SEATS)) return null;
  // Invite only or private, by its host's own word (an older host's listing doesn't say: public).
  if (m.visibility !== undefined && m.visibility !== 'public') return null;
  return { id: r.code, name: (r.name ?? '').slice(0, 48) || 'Lobby', map: m.map, laps: m.laps, phase: m.phase, visibility: 'public', pips: m.pips, players: m.players, filled: m.filled };
}

/**
 * The lobby in a room's state (`state.lobby`), if it holds one. Whoever holds the SDK's host role
 * writes it, and that role moves to any player, so all of it is checked: one bad seat or option and
 * it's not a lobby (the screens keep the last good one).
 */
export function readLobby(state: Record<string, unknown>): Lobby | null {
  const l = state.lobby;
  if (!obj(l) || !Array.isArray(l.seats) || l.seats.length !== SEATS || !str(l.host, 64) || !str(l.id, 16) || !str(l.name, 64)) return null;
  const seats = l.seats.map(readSeat);
  if (seats.some((x) => !x)) return null;
  // Kept by an older build, whose `private` was by link (not locked).
  const visibility = l.visibility === 'private' ? 'invite' : l.visibility;
  if (!VISIBILITIES.includes(visibility as Lobby['visibility'])) return null;
  if (l.phase !== 'lobby' && l.phase !== 'racing') return null;
  const options = l.options === undefined ? {} : readOptions(l.options);
  if (!options) return null;
  if (l.seed !== undefined && !int(l.seed, 0, 2 ** 31 - 1)) return null;
  if (l.startAt !== undefined && !(typeof l.startAt === 'number' && Number.isFinite(l.startAt) && l.startAt > 0)) return null;
  if (l.party !== undefined && !str(l.party, 64)) return null;
  // The results and vote (online, after a race): bad ones are dropped, not the whole lobby.
  const results = Array.isArray(l.results) ? l.results.slice(0, SEATS).map(readResult).filter((r): r is ResultRow => !!r) : undefined;
  const vote = l.vote === undefined ? null : readVote(l.vote);
  return {
    id: l.id,
    name: l.name,
    host: l.host,
    visibility: visibility as Lobby['visibility'],
    phase: l.phase,
    options: { ...DEFAULT_OPTIONS, ...options },
    seats: seats as Seat[],
    ...(l.seed === undefined ? {} : { seed: l.seed as number }),
    ...(l.startAt === undefined ? {} : { startAt: l.startAt as number }),
    ...(l.party === undefined ? {} : { party: l.party as string }),
    ...(results?.length ? { results } : {}),
    ...(vote ? { vote } : {}),
  };
}

/** A player's ping as they sent it (`{ type: 'ping', ms }`), or null. */
export function readPing(data: unknown): number | null {
  return obj(data) && data.type === 'ping' && int(data.ms, 0, 60_000) ? data.ms : null;
}
