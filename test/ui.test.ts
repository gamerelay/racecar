import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LAYOUT_ALIASES, PAINT_ALIASES, paletteFor, resolveLayout } from '../src/core/content';
import { CONTENT, LAYOUT_KEYS, MAPS, PAINTS } from '../tools/content';
import { describe, expect, test } from 'bun:test';
import { delta, fmt, ordinal, pingClass } from '../src/ui/format';
import { pickNext, type Box } from '../src/ui/nav';
import { readChoices, readSetup } from '../src/ui/setup';

// The HUD's formatting, the URL setup parser (hand-edited and stale links), and menu navigation.

describe('format', () => {
  test('a ping goes yellow at 50 ms, orange at 75 and red at 100', () => {
    expect([0, 49, 50, 74, 75, 99, 100, 400].map(pingClass)).toEqual(['good', 'good', 'fair', 'fair', 'poor', 'poor', 'bad', 'bad']);
  });

  test('race times never read 0:60.0', () => {
    expect(fmt(0)).toBe('0:00.0');
    expect(fmt(5.04)).toBe('0:05.0');
    expect(fmt(59.94)).toBe('0:59.9');
    expect(fmt(59.97)).toBe('1:00.0');
    expect(fmt(119.96)).toBe('2:00.0');
    expect(fmt(3599.99)).toBe('60:00.0');
    expect(fmt(-1)).toBe('0:00.0');
  });
  test('ordinals, teens included', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '112th']);
    expect(ordinal(0)).toBe('Finished');
  });
  test('lap deltas', () => {
    expect(delta(64.1, 65.3)).toBe('−1.2');
    expect(delta(66.1, 65.3)).toBe('+0.8');
    expect(delta(65.3, 65.3)).toBe('+0.0');
  });
});

describe('readSetup', () => {
  const known = { cars: ['coupe', 'bus'], paints: 9 };
  const read = (q: string) => readSetup(new URLSearchParams(q), 'downtown/downtown', known);
  test('no mode is the menu', () => {
    expect(read('car=bus')).toBeNull();
  });
  test('good values pass through', () => {
    expect(read('mode=race&map=backroads/valley&car=bus&paint=3&seats=pnhoexxx&laps=4&weather=rain&time=sunset&mayhem=chaos&traffic=0&seed=42&lobby=local')).toEqual({
      mode: 'race', map: 'backroads/valley', car: 'bus', paint: 3, seats: 'pnhoexxx', laps: 4, weather: 'rain', time: 'sunset', mayhem: 'chaos', traffic: false, seed: 42, lobby: 'local',
    });
  });
  test('links from before lobbies: opponents and difficulty become seats', () => {
    expect(read('mode=race&opponents=5&difficulty=2')!.seats).toBe('phhhhhxx');
    expect(read('mode=race&opponents=0')!.seats).toBe('pxxxxxxx');
    expect(read('mode=race')!.seats).toBe('pnnnnnnn');
    // Free drive always had three rivals.
    expect(read('mode=free&difficulty=0')!.seats).toBe('peeexxxx');
    // Bad seats (no you, two of you, junk, too many) fall back the same way.
    for (const bad of ['nnnnnnnn', 'ppnnnnnn', 'pq', 'pnnnnnnnn']) expect(read(`mode=race&opponents=2&seats=${bad}`)!.seats).toBe('pnnxxxxx');
  });
  test('junk falls back instead of crashing or never finishing', () => {
    const s = read('mode=race&car=lambo&paint=abc&opponents=x&difficulty=1.6&laps=x&weather=snow&mayhem=&seed=')!;
    expect(s.car).toBe('coupe');
    expect(s.paint).toBe(0);
    // opponents=x is the default 7; difficulty 1.6 rounds to hard.
    expect(s.seats).toBe('phhhhhhh');
    expect(s.laps).toBe(2);
    expect(s.weather).toBe('random');
    expect(s.mayhem).toBe('normal');
    expect(Number.isInteger(s.seed)).toBe(true);
  });
  test('out of range clamps', () => {
    const s = read('mode=race&paint=-1&opponents=99&difficulty=-3&laps=0')!;
    expect([s.paint, s.seats, s.laps]).toEqual([0, 'peeeeeee', 1]);
    expect(read('mode=race&paint=40')!.paint).toBe(8);
  });
  test("the menu's defaults are the last race's choices", () => {
    const c = readChoices(new URLSearchParams('map=backroads/valley&car=bus&laps=5&weather=rain'), 'downtown/downtown', known);
    expect([c.map, c.car, c.laps, c.weather]).toEqual(['backroads/valley', 'bus', 5, 'rain']);
    expect(readChoices(new URLSearchParams(''), 'downtown/downtown', known)).toEqual({ map: 'downtown/downtown' });
  });
});

describe('menu navigation', () => {
  // A 2×2 grid of buttons and a wide one under it.
  const b = (x: number, y: number, w = 100): Box => ({ x, y, w, h: 40 });
  const boxes = [b(0, 0), b(200, 0), b(0, 100), b(200, 100), b(0, 200, 300)];
  test('moves within its row or column first', () => {
    expect(pickNext(boxes, 0, 'right')).toBe(1);
    expect(pickNext(boxes, 0, 'down')).toBe(2);
    expect(pickNext(boxes, 3, 'left')).toBe(2);
    expect(pickNext(boxes, 3, 'up')).toBe(1);
  });
  test('reaches the wide one below, and stops at the edges', () => {
    expect(pickNext(boxes, 3, 'down')).toBe(4);
    expect(pickNext(boxes, 0, 'up')).toBe(-1);
    expect(pickNext(boxes, 1, 'right')).toBe(-1);
  });
});

describe('renamed maps and paints', () => {
  const keys = ['downtown/downtown', 'backroads/valley'];
  const known = { cars: ['coupe'], paints: 9, layouts: keys };

  test('old links still start the same race: City is Downtown, Countryside is Backroads', () => {
    expect(resolveLayout('city/downtown', keys)).toBe('downtown/downtown');
    expect(resolveLayout('countryside/valley', keys)).toBe('backroads/valley');
    expect(readSetup(new URLSearchParams('mode=race&map=countryside/valley'), 'downtown/downtown', known)?.map).toBe('backroads/valley');
    // A bare map id, old or new, is its first layout; nonsense falls back to the default.
    expect(resolveLayout('backroads', keys)).toBe('backroads/valley');
    expect(resolveLayout('city', keys)).toBe('downtown/downtown');
    expect(readSetup(new URLSearchParams('mode=race&map=nowhere'), 'downtown/downtown', known)?.map).toBe('downtown/downtown');
    // Every key the aliases point to exists.
    for (const to of Object.values(LAYOUT_ALIASES)) expect(LAYOUT_KEYS).toContain(to);
  });

  test('map and paint names are one word, and paint ids have no hyphens', () => {
    for (const key of LAYOUT_KEYS) expect(existsSync(join(CONTENT, 'maps', key.split('/')[0], 'map.json'))).toBe(true);
    const maps = LAYOUT_KEYS.map((k) => JSON.parse(readFileSync(join(CONTENT, 'maps', k.split('/')[0], 'map.json'), 'utf8')));
    expect(maps.map((m) => m.name).sort()).toEqual(['Backroads', 'Downtown', 'Paradise']);
    for (const p of PAINTS) {
      expect(p.name).toMatch(/^[A-Z][a-z]+$/);
      expect(p.id).toMatch(/^[a-z]+$/);
    }
    for (const to of Object.values(PAINT_ALIASES)) expect(PAINTS.map((p) => p.id)).toContain(to);
  });
});

describe('time of day', () => {
  const map = { id: 'paradise', name: 'Paradise', layouts: ['island'], palette: 'tropic', sunset: 'sunset', weather: [] };
  test('a map with a sunset races by day or at sunset; random is seeded, about a third at sunset', () => {
    expect(paletteFor(map, 'day', 1)).toBe('tropic');
    expect(paletteFor(map, 'sunset', 1)).toBe('sunset');
    const sunsets = Array.from({ length: 300 }, (_, seed) => paletteFor(map, 'random', seed)).filter((p) => p === 'sunset').length;
    expect(sunsets).toBeGreaterThan(70);
    expect(sunsets).toBeLessThan(140);
    expect(paletteFor(map, 'random', 12)).toBe(paletteFor(map, 'random', 12));
  });
  test('a map without one ignores it', () => {
    expect(paletteFor({ ...map, sunset: undefined }, 'sunset', 1)).toBe('tropic');
  });
  test("every map's palettes exist", async () => {
    const { PALETTES } = await import('../src/render/skins/greybox/palettes');
    for (const m of MAPS) for (const p of [m.palette, m.sunset]) if (p) expect(PALETTES[p], `${m.id} ${p}`).toBeDefined();
  });
});
