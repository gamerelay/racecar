// A race as a link (SPEC §12): the map, your car and paint, the seats, laps, weather, time, mayhem,
// traffic and seed. Starting a race writes it into the URL and reloads into it, which keeps each
// race a clean start and a shareable link. The lobby (ui/lobby.ts) makes these; links from before
// lobbies (`opponents` and `difficulty` instead of `seats`) still start the race they meant.

import { resolveLayout, type TimeOption } from '../core/content';
import { DEFAULT_OPTIONS, FILL_DIFFICULTY, encodeSeats, legacySeats, othersIn, parseSeats, seatIndex, type Difficulty, type Lobby, type Other } from '../lobby/lobby';

export interface RaceSetup {
  mode: 'race' | 'free';
  map: string;
  car: string;
  paint: number;
  /** One letter a seat (lobby.ts): `p` you, `e` `n` `h` AIs, `o` open (a bot), `x` closed. */
  seats: string;
  laps: number;
  weather: 'clear' | 'rain' | 'random';
  time: TimeOption;
  mayhem: 'off' | 'normal' | 'chaos';
  traffic: boolean;
  seed: number;
  /** The lobby this race came from: after it, the menu goes back there. */
  lobby?: string;
  /** Online: the other players (their seats are `r`). */
  others?: Other[];
  /** Online: when the lights go green, on the server's clock (ms). */
  at?: number;
}

/** The `others` a link carries, checked: each a seat, an id, a car, a paint and a plate. */
function readOthers(v: string | null): Other[] | undefined {
  if (!v) return undefined;
  try {
    const list = JSON.parse(v) as unknown;
    if (!Array.isArray(list)) return undefined;
    const out = list.flatMap((o): Other[] =>
      Array.isArray(o) && o.length === 5 && Number.isInteger(o[0]) && o[0] >= 0 && o[0] < 8 && typeof o[1] === 'string' && typeof o[2] === 'string' && Number.isInteger(o[3]) && o[3] >= 0 && typeof o[4] === 'string'
        ? [{ seat: o[0], id: o[1].slice(0, 64), car: o[2].slice(0, 32), paint: o[3], name: o[4].slice(0, 16) }]
        : [],
    );
    return out.length ? out : undefined;
  } catch {
    return undefined;
  }
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
  const others = readOthers(q.get('others'));
  const at = Number(q.get('at'));
  return {
    mode,
    map: (known?.layouts ? resolveLayout(q.get('map'), known.layouts) : q.get('map')) ?? defaultMap,
    car: known && !known.cars.includes(car) ? 'coupe' : car,
    paint: int('paint', 0, 0, Math.max(0, (known?.paints ?? 1e9) - 1)),
    seats,
    laps: int('laps', 2, 1, MAX_LAPS),
    weather: oneOf('weather', ['clear', 'rain', 'random'] as const, 'random'),
    time: oneOf('time', ['day', 'sunset', 'random'] as const, 'random'),
    mayhem: oneOf('mayhem', ['off', 'normal', 'chaos'] as const, 'normal'),
    traffic: q.get('traffic') !== '0',
    seed: int('seed', Math.floor(Math.random() * 1e9), 0, 2 ** 31 - 1),
    ...(lobby ? { lobby } : {}),
    ...(others ? { others } : {}),
    ...(q.has('at') && Number.isFinite(at) && at > 0 ? { at } : {}),
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
  for (const [k, v] of Object.entries(s)) {
    if (v === undefined) continue;
    if (k === 'others') q.set(k, JSON.stringify((v as Other[]).map((o) => [o.seat, o.id, o.car, o.paint, o.name])));
    else q.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  }
  return q.toString();
}

/** The same race again: same seed, so the same weather and traffic (the pause menu's Restart). */
export function restart(s: RaceSetup): void {
  location.search = toQuery(offline(s));
}

/** An online race's link without its online parts: a restart or another race is yours alone. */
function offline(s: RaceSetup): RaceSetup {
  if (!s.others && !s.at) return s;
  const { others: _, at: __, ...rest } = s;
  return { ...rest, seats: rest.seats.replace(/r/g, 'x') };
}

/** Another race with the same setup and a fresh seed (the results screen's Race again). */
export function raceAgain(s: RaceSetup): void {
  location.search = toQuery({ ...offline(s), seed: Math.floor(Math.random() * 1e9) });
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

/**
 * The race link for a lobby's race, as `you` drive it: its seats become the race's cars. Online,
 * the other players' seats are their cars, and the lights go green at the lobby's `startAt`.
 */
export function raceFromLobby(lobby: Lobby, you: string, seed: number, online = false): RaceSetup {
  const seat = lobby.seats[seatIndex(lobby, you)];
  const o = lobby.options;
  const others = online ? othersIn(lobby, you) : [];
  return {
    mode: 'race',
    map: o.map,
    car: seat?.kind === 'player' ? seat.car : 'coupe',
    paint: seat?.kind === 'player' ? seat.paint : 0,
    seats: encodeSeats(lobby, you, online),
    laps: o.laps,
    weather: o.weather,
    time: o.time,
    mayhem: o.mayhem,
    traffic: o.traffic,
    seed,
    lobby: lobby.id,
    ...(others.length ? { others } : {}),
    ...(online && lobby.startAt ? { at: lobby.startAt } : {}),
  };
}

/** A car and paint picked at random from `cars` (ids) and `paints` (how many): yours, new to a lobby. */
export function randomCar(cars: readonly string[], paints: number, rand: () => number = Math.random): { car: string; paint: number } {
  return { car: cars[Math.floor(rand() * cars.length)], paint: Math.floor(rand() * paints) };
}

/** Quick race: no lobby, you in `yours` and seven normal bots, on one of `maps` at random, in random weather and time. */
export function quickRaceSetup(maps: readonly string[], yours: { car: string; paint: number }, rand: () => number = Math.random): RaceSetup {
  return {
    mode: 'race',
    map: maps[Math.floor(rand() * maps.length)],
    car: yours.car,
    paint: yours.paint,
    seats: legacySeats(7, FILL_DIFFICULTY),
    laps: DEFAULT_OPTIONS.laps,
    weather: 'random',
    time: 'random',
    mayhem: DEFAULT_OPTIONS.mayhem,
    traffic: true,
    seed: Math.floor(rand() * 1e9),
  };
}
