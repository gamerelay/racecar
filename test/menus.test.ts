import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { filterLobbies, quickJoinPick, readInvite } from '../src/ui/menu';
import { carRole, rating } from '../src/ui/kit';
import { createLobby, apply, summarize, type LobbySummary } from '../src/lobby/lobby';
import { readAction, readListing } from '../src/lobby/wire';
import { raceFromLobby } from '../src/ui/setup';
import { LOCAL_ID } from '../src/lobby/backend';
import { Input, type SystemAction } from '../src/input/input';
import { fakeBrowser } from './fake-audio';

// The UI polish (docs/MENU.md): the lobby list's search, filters and order, Quick join, a pasted
// invite, the car card's ratings, the lobby's "fill open seats with bots", what an online lobby's
// listing says, and the pad in menus (a held d-pad repeats; the hints follow the device used last).

const row = (id: string, o: Partial<LobbySummary> = {}): LobbySummary => ({ id, name: `${id}'s lobby`, map: 'downtown/downtown', laps: 2, phase: 'lobby', visibility: 'public', pips: 'pooooooo', players: 1, filled: 1, ...o });
const names = (rows: LobbySummary[]) => rows.map((r) => r.id);
const mapName = (k: string) => ({ 'downtown/downtown': 'Downtown', 'sahara/dunes': 'Sahara', 'backroads/valley': 'Backroads' })[k] ?? k;
const all = { query: '', track: '', hideFull: false, sort: 'drivers' as const };

describe('the lobby list', () => {
  const rows = [
    row('ZIP', { filled: 2, players: 1, map: 'sahara/dunes', host: 'ZIPZAP' }),
    row('NIT', { name: 'No brakes club', filled: 7, players: 3, host: 'KATANA', laps: 3 }),
    row('FUL', { filled: 8, players: 8, map: 'backroads/valley', laps: 5 }),
    row(LOCAL_ID, { filled: 8 }),
    row('CRU', { name: 'Chill laps', filled: 2, players: 2, host: 'CRUZN', laps: 1 }),
  ];

  test("online lobbies only, fullest first (then the most players, then by name), and never your own lobby in this browser", () => {
    expect(names(filterLobbies(rows, all, mapName))).toEqual(['FUL', 'NIT', 'CRU', 'ZIP']);
  });

  test('the search matches a lobby\'s name or its host, in any case', () => {
    expect(names(filterLobbies(rows, { ...all, query: 'katana' }, mapName))).toEqual(['NIT']);
    expect(names(filterLobbies(rows, { ...all, query: '  CHILL ' }, mapName))).toEqual(['CRU']);
    expect(names(filterLobbies(rows, { ...all, query: 'nobody' }, mapName))).toEqual([]);
  });

  test('a track keeps its own map\'s lobbies; Hide full drops the full ones', () => {
    expect(names(filterLobbies(rows, { ...all, track: 'sahara' }, mapName))).toEqual(['ZIP']);
    expect(names(filterLobbies(rows, { ...all, hideFull: true }, mapName))).toEqual(['NIT', 'CRU', 'ZIP']);
  });

  test('by name, by track (then name) and by laps (then name)', () => {
    expect(names(filterLobbies(rows, { ...all, sort: 'name' }, mapName))).toEqual(['CRU', 'FUL', 'NIT', 'ZIP']);
    expect(names(filterLobbies(rows, { ...all, sort: 'track' }, mapName))).toEqual(['FUL', 'CRU', 'NIT', 'ZIP']);
    expect(names(filterLobbies(rows, { ...all, sort: 'laps' }, mapName))).toEqual(['CRU', 'ZIP', 'NIT', 'FUL']);
  });

  test("Quick join takes the lobby with the most players that's between races and has a seat; none, nothing", () => {
    expect(quickJoinPick(rows)?.id).toBe('NIT');
    expect(quickJoinPick([row('A', { phase: 'racing', players: 4, filled: 4 }), row('B', { players: 2, filled: 3 })])?.id).toBe('B');
    expect(quickJoinPick([row('A', { filled: 8, players: 8 }), row(LOCAL_ID)])).toBeNull();
    // A room everyone left (nobody in it) isn't one to join.
    expect(quickJoinPick([row('A', { players: 0, filled: 0 })])).toBeNull();
  });
});

describe('Join with code', () => {
  test('a code, in any case, is a lobby', () => {
    expect(readInvite('z442ee')).toEqual({ code: 'Z442EE' });
    expect(readInvite('  K7QM ')).toEqual({ code: 'K7QM' });
  });

  test("a pasted link: an old invite's lobby, a short link's join, or the short link itself", () => {
    expect(readInvite('https://racecar.gamerelay.io/?lobby=K7QM')).toEqual({ code: 'K7QM' });
    expect(readInvite('https://racecar.gamerelay.io/?join=abc123')).toEqual({ link: 'abc123' });
    expect(readInvite('https://play.gamerelay.io/racecar/abc123')).toEqual({ link: 'abc123' });
    expect(readInvite('play.gamerelay.io/racecar/abc123')).toEqual({ link: 'abc123' });
  });

  test("nothing, or something that's neither, is nothing", () => {
    expect(readInvite('')).toBeNull();
    expect(readInvite('   ')).toBeNull();
    expect(readInvite('two words')).toBeNull();
    expect(readInvite('<script>')).toBeNull();
  });
});

describe('the car card', () => {
  test('a stat out of ten, from where it is in the range across the cars: never 0, never past 10', () => {
    expect([0, 0.05, 0.5, 0.94, 1, 1.4, -1].map(rating)).toEqual([1, 1, 6, 9, 10, 10, 1]);
  });

  test("a car's job is its blurb's first words", () => {
    expect(carRole('All-rounder: sharp grip, quick, easy to place.')).toBe('All-rounder');
    expect(carRole('Dirt specialist: keeps its grip off the asphalt')).toBe('Dirt specialist');
    expect(carRole('No colon here')).toBe('');
    expect(carRole()).toBe('');
  });
});

describe('fill open seats with bots', () => {
  const host = { id: 'h', name: 'HOST', car: 'coupe', paint: 0 };

  test("on (the default), the open seats are bots at the start; off, they start empty, as closed ones do", () => {
    const lobby = createLobby('K7QM', host, { options: { map: 'downtown/downtown' } });
    expect(lobby.options.fill).toBe(true);
    expect(raceFromLobby(lobby, 'h', 1).seats).toBe('pooooooo');
    const off = apply(lobby, 'h', { type: 'options', options: { fill: false } });
    expect(off?.options.fill).toBe(false);
    expect(raceFromLobby(off!, 'h', 1).seats).toBe('pxxxxxxx');
  });

  test('the host sets it over the wire as a yes or no, nothing else', () => {
    expect(readAction({ type: 'options', options: { fill: false } }, 'h')).toEqual({ type: 'options', options: { fill: false } });
    expect(readAction({ type: 'options', options: { fill: 'no' } }, 'h')).toBeNull();
  });
});

describe("an online lobby's listing", () => {
  const meta = { map: 'downtown/downtown', laps: 2, phase: 'lobby', pips: 'pooooooo', players: 1, filled: 1 };

  test('it says who hosts it and its rules, as the lobby list shows them', () => {
    const lobby = createLobby('K7QM', { id: 'h', name: 'KATANA', car: 'coupe', paint: 0 }, { options: { map: 'downtown/downtown', mayhem: 'chaos', traffic: false } });
    const { id: _, name, ...listed } = summarize(lobby);
    expect(listed).toMatchObject({ host: 'KATANA', mayhem: 'chaos', traffic: false });
    expect(readListing({ code: 'K7QM', name, meta: listed })).toMatchObject({ host: 'KATANA', mayhem: 'chaos', traffic: false });
  });

  test("an older host's listing (none of those) still lists; bad ones are left out, not the lobby", () => {
    const old = readListing({ code: 'K7QM', name: 'x', meta });
    expect(old).not.toBeNull();
    expect(old).not.toHaveProperty('host');
    expect(old).not.toHaveProperty('mayhem');
    const bad = readListing({ code: 'K7QM', name: 'x', meta: { ...meta, host: '<img src=x>'.repeat(4), mayhem: 'nuclear', traffic: 'yes' } });
    expect(bad).not.toBeNull();
    expect(bad).not.toHaveProperty('host');
    expect(bad).not.toHaveProperty('mayhem');
    expect(bad).not.toHaveProperty('traffic');
  });
});

describe('the pad in menus', () => {
  let browser: ReturnType<typeof fakeBrowser>;
  let input: Input;
  const fired: SystemAction[] = [];
  const nav = navigator as unknown as { getGamepads?: () => unknown[] };
  const perf = performance as unknown as { now: () => number };
  let was: typeof nav.getGamepads;
  let wasNow: () => number;
  let now = 1000;
  let down = new Set<number>();
  beforeEach(() => {
    browser = fakeBrowser();
    input = new Input();
    fired.length = 0;
    input.on((a) => fired.push(a));
    was = nav.getGamepads;
    wasNow = perf.now;
    now = 1000;
    down = new Set();
    perf.now = () => now;
    nav.getGamepads = () => [{ connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, k) => ({ pressed: down.has(k), value: down.has(k) ? 1 : 0 })) }];
  });
  afterEach(() => {
    nav.getGamepads = was;
    perf.now = wasNow;
    browser.window.fire('blur');
    browser.restore();
  });
  /** Frames at 60 fps with the menu up. */
  const frames = (ms: number) => {
    for (let t = 0; t < ms; t += 1000 / 60) {
      now += 1000 / 60;
      input.pollMenu();
    }
  };

  test('a held d-pad moves once, then again after a pause, then quickly; let go, it stops', () => {
    input.menuOpen = true;
    down.add(13);
    frames(1000 / 60);
    expect(fired).toEqual(['nav-down']);
    frames(300);
    expect(fired.length).toBe(1);
    frames(400);
    // Past the first pause (380 ms), then every 95 ms.
    expect(fired.length).toBeGreaterThanOrEqual(4);
    expect(fired.every((a) => a === 'nav-down')).toBe(true);
    const n = fired.length;
    down.clear();
    frames(500);
    expect(fired.length).toBe(n);
  });

  test("a held bumper doesn't repeat (it would spin the cars past)", () => {
    input.menuOpen = true;
    down.add(5);
    frames(1500);
    expect(fired).toEqual(['pick-right']);
  });

  test("Y is the screen's extra (Refresh), only in a menu", () => {
    down.add(3);
    frames(100);
    expect(fired).toEqual([]);
    down.clear();
    frames(100);
    input.menuOpen = true;
    down.add(3);
    frames(100);
    expect(fired).toEqual(['alt']);
  });

  test('the hints follow the device used last: a pad press makes it the pad, a key the keyboard', () => {
    const seen: string[] = [];
    input.onDevice((d) => seen.push(d));
    input.menuOpen = true;
    down.add(0);
    frames(50);
    browser.window.fire('keydown', { code: 'ArrowDown', key: 'ArrowDown', repeat: false, metaKey: false, ctrlKey: false, altKey: false, target: null, preventDefault() {} });
    expect(seen).toEqual(['keyboard', 'gamepad', 'keyboard']);
  });
});
