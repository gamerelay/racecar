import { describe, expect, test } from 'bun:test';
import { delta, fmt, ordinal } from '../src/ui/format';
import { pickNext, type Box } from '../src/ui/nav';
import { readChoices, readSetup } from '../src/ui/setup';

// The HUD's formatting, the URL setup parser (hand-edited and stale links), and menu navigation.

describe('format', () => {
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
  const read = (q: string) => readSetup(new URLSearchParams(q), 'city/downtown', known);
  test('no mode is the menu', () => {
    expect(read('car=bus')).toBeNull();
  });
  test('good values pass through', () => {
    expect(read('mode=race&map=countryside/valley&car=bus&paint=3&opponents=5&difficulty=2&laps=4&weather=rain&mayhem=chaos&traffic=0&seed=42')).toEqual({
      mode: 'race', map: 'countryside/valley', car: 'bus', paint: 3, opponents: 5, difficulty: 2, laps: 4, weather: 'rain', mayhem: 'chaos', traffic: false, seed: 42,
    });
  });
  test('junk falls back instead of crashing or never finishing', () => {
    const s = read('mode=race&car=lambo&paint=abc&opponents=x&difficulty=1.6&laps=x&weather=snow&mayhem=&seed=')!;
    expect(s.car).toBe('coupe');
    expect(s.paint).toBe(0);
    expect(s.opponents).toBe(7);
    expect(s.difficulty).toBe(2);
    expect(s.laps).toBe(3);
    expect(s.weather).toBe('random');
    expect(s.mayhem).toBe('normal');
    expect(Number.isInteger(s.seed)).toBe(true);
  });
  test('out of range clamps', () => {
    const s = read('mode=free&paint=-1&opponents=99&difficulty=-3&laps=0')!;
    expect([s.paint, s.opponents, s.difficulty, s.laps]).toEqual([0, 7, 0, 1]);
    expect(read('mode=race&paint=40')!.paint).toBe(8);
  });
  test("the menu's defaults are the last race's choices", () => {
    const c = readChoices(new URLSearchParams('map=countryside/valley&car=bus&laps=5&weather=rain'), 'city/downtown', known);
    expect([c.map, c.car, c.laps, c.weather]).toEqual(['countryside/valley', 'bus', 5, 'rain']);
    expect(readChoices(new URLSearchParams(''), 'city/downtown', known)).toEqual({ map: 'city/downtown' });
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
