// What other players send, checked before anything uses it (milestone 3). Everything here comes
// off the network from someone else's page: an action for the host to apply, a room's listing, the
// lobby in a room's state, a ping. Each reader returns the value in its proper shape, or null for
// anything malformed. Pure: no SDK, no DOM.

import { cleanPlate } from './plate';
import { DEFAULT_OPTIONS, SEATS, VISIBILITIES, type Lobby, type LobbyAction, type LobbyOptions, type LobbySummary, type SeatChoice } from './lobby';

const SEAT_CHOICES: readonly SeatChoice[] = ['open', 'closed', 'ai-easy', 'ai-normal', 'ai-hard'];
const OPTION_KEYS: readonly (keyof LobbyOptions)[] = ['map', 'laps', 'weather', 'time', 'mayhem', 'traffic'];
const OPTION_VALUES: Partial<Record<keyof LobbyOptions, readonly unknown[]>> = {
  weather: ['clear', 'rain', 'random'],
  time: ['day', 'sunset', 'random'],
  mayhem: ['off', 'normal', 'chaos'],
};

export const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
/** A player's name is their plate: only what a plate can show (it's drawn in other players' pages). */
const plate = (v: unknown): string | null => (str(v, 64) ? cleanPlate(v) || null : null);
const int = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

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
        if (!obj(data.options)) return null;
        const o: Partial<LobbyOptions> = {};
        for (const k of OPTION_KEYS) {
          const v = data.options[k];
          if (v === undefined) continue;
          const ok = k === 'map' ? str(v, 64) : k === 'laps' ? typeof v === 'number' && Number.isFinite(v) : k === 'traffic' ? typeof v === 'boolean' : OPTION_VALUES[k]!.includes(v);
          if (!ok) return null;
          (o as Record<string, unknown>)[k] = v;
        }
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
  }
  return null;
}

const PIPS = /^[penhox]{8}$/;

/** A room's listing as a lobby row, or null if it isn't a racecar lobby's (a host writes it, so it's checked). */
export function readListing(r: { code: string; name: string | null; meta: unknown }): LobbySummary | null {
  const m = r.meta;
  if (!obj(m) || !str(m.map, 64) || !int(m.laps, 1, 9) || (m.phase !== 'lobby' && m.phase !== 'racing') || !str(m.pips, 8) || !PIPS.test(m.pips)) return null;
  if (!int(m.players, 0, SEATS) || !int(m.filled, 0, SEATS)) return null;
  // Invite only or private, by its host's own word (an older host's listing doesn't say: public).
  if (m.visibility !== undefined && m.visibility !== 'public') return null;
  return { id: r.code, name: (r.name ?? '').slice(0, 48) || 'Lobby', map: m.map, laps: m.laps, phase: m.phase, visibility: 'public', pips: m.pips, players: m.players, filled: m.filled };
}

/** The lobby in a room's state (`state.lobby`), if it holds one: the SDK's host writes it, so it's checked. */
export function readLobby(state: Record<string, unknown>): Lobby | null {
  const l = state.lobby;
  if (!obj(l) || !Array.isArray(l.seats) || l.seats.length !== SEATS || typeof l.host !== 'string') return null;
  const lobby = l as unknown as Lobby;
  // Kept by an older build, whose `private` was by link (not locked).
  const visibility = (lobby.visibility as string) === 'private' ? 'invite' : lobby.visibility;
  return { ...lobby, visibility, options: { ...DEFAULT_OPTIONS, ...lobby.options } };
}

/** A player's ping as they sent it (`{ type: 'ping', ms }`), or null. */
export function readPing(data: unknown): number | null {
  return obj(data) && data.type === 'ping' && int(data.ms, 0, 60_000) ? data.ms : null;
}
