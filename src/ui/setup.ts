// A race as a link (SPEC §12): the map, your car and paint, the seats, laps, weather, mayhem,
// traffic and seed. Starting a race writes it into the URL and reloads into it, which keeps each
// race a clean start and a shareable link. The lobby (ui/lobby.ts) makes these; links from before
// lobbies (`opponents` and `difficulty` instead of `seats`) still start the race they meant.

import { resolveLayout } from '../core/content';
import { encodeSeats, legacySeats, parseSeats, seatIndex, type Difficulty, type Lobby } from '../lobby/lobby';

export interface RaceSetup {
  mode: 'race' | 'free';
  map: string;
  car: string;
  paint: number;
  /** One letter a seat (lobby.ts): `p` you, `e` `n` `h` AIs, `o` open (a bot), `x` closed. */
  seats: string;
  laps: number;
  weather: 'clear' | 'rain' | 'random';
  mayhem: 'off' | 'normal' | 'chaos';
  traffic: boolean;
  seed: number;
  /** The lobby this race came from: after it, the menu goes back there. */
  lobby?: string;
}

/** What a setup may name: car ids, how many paints there are, and the layout keys. */
export interface Known {
  cars: string[];
  paints: number;
  /** Layout keys; with these, a renamed or bare map id in the URL resolves to one. */
  layouts?: string[];
}

/** The most laps a race can have (the menu offers 1 to this; a link asking for more gets this). */
export const MAX_LAPS = 5;

/**
 * The race the URL asks for, or null for the menu (no mode). Anything missing or out of range
 * falls back to a default, so a hand-edited or stale link still starts a race.
 */
export function readSetup(q: URLSearchParams, defaultMap: string, known?: Known): RaceSetup | null {
  const mode = q.get('mode');
  if (mode !== 'race' && mode !== 'free') return null;
  /** A whole number in [lo, hi], or `d` if it's missing or not a number. */
  const int = (k: string, d: number, lo: number, hi: number) => {
    const v = Number(q.get(k));
    return q.has(k) && q.get(k) !== '' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d;
  };
  const oneOf = <T extends string>(k: string, options: readonly T[], d: T): T => (options.includes(q.get(k) as T) ? (q.get(k) as T) : d);
  const car = q.get('car') ?? 'coupe';
  const difficulty = int('difficulty', 1, 0, 2) as Difficulty;
  // Free drive always had three rivals; a race, `opponents` of them.
  const seats = parseSeats(q.get('seats')) ?? legacySeats(mode === 'free' ? 3 : int('opponents', 7, 0, 7), difficulty);
  const lobby = q.get('lobby');
  return {
    mode,
    map: (known?.layouts ? resolveLayout(q.get('map'), known.layouts) : q.get('map')) ?? defaultMap,
    car: known && !known.cars.includes(car) ? 'coupe' : car,
    paint: int('paint', 0, 0, Math.max(0, (known?.paints ?? 1e9) - 1)),
    seats,
    laps: int('laps', 3, 1, MAX_LAPS),
    weather: oneOf('weather', ['clear', 'rain', 'random'] as const, 'random'),
    mayhem: oneOf('mayhem', ['off', 'normal', 'chaos'] as const, 'normal'),
    traffic: q.get('traffic') !== '0',
    seed: int('seed', Math.floor(Math.random() * 1e9), 0, 2 ** 31 - 1),
    ...(lobby ? { lobby } : {}),
  };
}

/** Your last choices from the URL (after a race's "Main menu"), for the menu's defaults. */
export function readChoices(q: URLSearchParams, defaultMap: string, known?: Known): Partial<RaceSetup> {
  if (!q.has('car') && !q.has('map')) return { map: defaultMap };
  const withMode = new URLSearchParams(q);
  withMode.set('mode', 'race');
  return readSetup(withMode, defaultMap, known) ?? {};
}

export function toQuery(s: RaceSetup): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(s)) if (v !== undefined) q.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  return q.toString();
}

/** The same race again: same seed, so the same weather and traffic (the pause menu's Restart). */
export function restart(s: RaceSetup): void {
  location.search = toQuery(s);
}

/** Another race with the same setup and a fresh seed (the results screen's Race again). */
export function raceAgain(s: RaceSetup): void {
  location.search = toQuery({ ...s, seed: Math.floor(Math.random() * 1e9) });
}

/** Where the menu goes after a race: back to its lobby, or the title with your choices kept. */
export function menuQuery(s: RaceSetup): string {
  if (s.lobby) return new URLSearchParams({ lobby: s.lobby }).toString();
  const q = new URLSearchParams(toQuery(s));
  q.delete('mode');
  return q.toString();
}

export function backToSetup(s: RaceSetup): void {
  location.search = menuQuery(s);
}

/** The race link for a lobby's race, as `you` drive it: its seats become the race's cars. */
export function raceFromLobby(lobby: Lobby, you: string, seed: number): RaceSetup {
  const seat = lobby.seats[seatIndex(lobby, you)];
  const o = lobby.options;
  return {
    mode: 'race',
    map: o.map,
    car: seat?.kind === 'player' ? seat.car : 'coupe',
    paint: seat?.kind === 'player' ? seat.paint : 0,
    seats: encodeSeats(lobby, you),
    laps: o.laps,
    weather: o.weather,
    mayhem: o.mayhem,
    traffic: o.traffic,
    seed,
    lobby: lobby.id,
  };
}
