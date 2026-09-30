import { describe, expect, test } from 'bun:test';
import type { KeyValue } from '../src/lobby/backend';
import { AI_PLATES, PLATE_MAX, aiPlate, cleanPlate, loadPlate, plateProblem, savePlate } from '../src/lobby/plate';
import { apply, createLobby } from '../src/lobby/lobby';
import { ATLAS, CELL, CELLS, CellTable, WHITE_UV, cellUv } from '../src/render/skins/greybox/car/plates';
import { CLASS_ORDER } from '../src/core/content';

// License plates (PLAN phase 3): the text rules, the blocklist, where your plate is kept, the AI
// plates, and the atlas cells the cars' plates are drawn in.

const memory = (): KeyValue & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

describe('plate text', () => {
  test('uppercase, A–Z 0–9 and single spaces, at most seven', () => {
    expect(cleanPlate('ace 7')).toBe('ACE 7');
    expect(cleanPlate('  r@ce--car!! ')).toBe('RCECAR');
    expect(cleanPlate('a  b   c')).toBe('A B C');
    expect(cleanPlate('toolongplate')).toBe('TOOLONG');
    // Cut at seven, the space it ends on goes.
    expect(cleanPlate('ABCDEF GH')).toBe('ABCDEF');
    expect(cleanPlate('ñandú 9')).toBe('AND 9');
    for (const s of ['ACE 7', 'RC 1234', 'Z', 'MUD LRK']) expect(plateProblem(s)).toBeNull();
    expect(plateProblem('')).not.toBeNull();
    expect(plateProblem('ace')).not.toBeNull();
    expect(plateProblem('TOOLONG1')).not.toBeNull();
  });

  test('the blocklist sees through spaces and look-alike digits, and leaves ordinary words alone', () => {
    for (const bad of ['FUCK', 'SH1T', 'F U C K', 'ASS', 'N4Z1', 'KKK', 'FAG', 'RAPE']) expect(plateProblem(cleanPlate(bad))).not.toBeNull();
    for (const ok of ['PASS', 'CLASS', 'GRAPE', 'SPICY', 'SWANK', 'SCRAPE', 'ASSET', 'TITAN', 'GAY', 'JEW', 'SEXTET']) expect(plateProblem(ok)).toBeNull();
  });

  test('every AI plate is a good plate, one per class', () => {
    for (const cls of CLASS_ORDER) {
      expect(AI_PLATES[cls]).toBeDefined();
      expect(plateProblem(aiPlate(cls))).toBeNull();
    }
    expect(new Set(CLASS_ORDER.map(aiPlate)).size).toBe(CLASS_ORDER.length);
    expect(plateProblem(aiPlate('hovercraft'))).toBeNull();
  });
});

describe('your plate', () => {
  test('a fresh one is made and kept; a saved one comes back; a bad one is refused', () => {
    const store = memory();
    const first = loadPlate(store, () => 0.5);
    expect(first).toBe('RC 5500');
    expect(plateProblem(first)).toBeNull();
    expect(loadPlate(store, () => 0.1)).toBe(first);
    expect(savePlate(store, 'ACE 7')).toBeNull();
    expect(loadPlate(store)).toBe('ACE 7');
    expect(savePlate(store, 'FUCK')).not.toBeNull();
    expect(loadPlate(store)).toBe('ACE 7');
  });

  test('a stored plate that no longer passes is replaced, and storage that throws still gives one', () => {
    const store = memory();
    store.setItem('racecar.plate', 'SH1T');
    expect(loadPlate(store, () => 0)).toBe('RC 1000');
    const broken: KeyValue = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => {} };
    expect(plateProblem(loadPlate(broken))).toBeNull();
    expect(savePlate(broken, 'ACE 7')).toBeNull();
  });

  test('renaming your seat in a lobby: only your own, and never blank', () => {
    const l = createLobby('local', { id: 'you', name: 'RC 1234', car: 'coupe', paint: 0 });
    expect(apply(l, 'you', { type: 'name', name: 'ACE 7' })!.seats[0]).toMatchObject({ name: 'ACE 7' });
    expect(apply(l, 'kev', { type: 'name', name: 'ACE 7' })).toBeNull();
    expect(apply(l, 'you', { type: 'name', name: '   ' })).toBeNull();
    expect(l.name).toBe("RC 1234's lobby");
  });
});

describe('the plate atlas', () => {
  test('each car gets a cell, identical plates share one, and freed cells come back', () => {
    const t = new CellTable(3);
    const a = t.take('ACE 7|DOWNTOWN|downtown')!;
    const b = t.take('RT 88|DOWNTOWN|downtown')!;
    expect(a.fresh && b.fresh).toBe(true);
    expect(a.cell).not.toBe(b.cell);
    const a2 = t.take('ACE 7|DOWNTOWN|downtown')!;
    expect(a2).toEqual({ cell: a.cell, fresh: false });
    // The same text on another map is another plate.
    expect(t.take('ACE 7|BACKROADS|backroads')!.fresh).toBe(true);
    expect(t.take('ZIPZAP|DOWNTOWN|downtown')).toBeNull();
    t.release('ACE 7|DOWNTOWN|downtown');
    expect(t.take('ZIPZAP|DOWNTOWN|downtown')).toBeNull();
    t.release('ACE 7|DOWNTOWN|downtown');
    expect(t.take('ZIPZAP|DOWNTOWN|downtown')).toEqual({ cell: a.cell, fresh: true });
  });

  test("the cells tile the top half without overlapping, and the white sample is outside them all", () => {
    expect(CELLS).toBeGreaterThanOrEqual(8);
    const rects = Array.from({ length: CELLS }, (_, k) => cellUv(k));
    for (const [u0, v0, u1, v1] of rects) {
      expect(u0).toBeGreaterThanOrEqual(0);
      expect(u1).toBeLessThanOrEqual(1);
      expect(v0).toBeGreaterThanOrEqual(0.5);
      expect(v1).toBeLessThanOrEqual(1);
      // A plate's shape in pixels (4:1), give or take the half-texel inset.
      expect(((u1 - u0) * ATLAS.w) / ((v1 - v0) * ATLAS.h)).toBeCloseTo(CELL.w / CELL.h, 0);
    }
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const [a0, b0, a1, b1] = rects[i];
        const [c0, d0, c1, d1] = rects[j];
        expect(a1 <= c0 || c1 <= a0 || b1 <= d0 || d1 <= b0).toBe(true);
      }
    const [wu, wv] = WHITE_UV;
    expect(wv).toBeLessThan(0.5);
    expect(wu).toBeGreaterThan(0);
    expect(PLATE_MAX).toBe(7);
  });
});
