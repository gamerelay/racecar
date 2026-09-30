import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CLASS_ORDER } from '../src/core/content';
import { CONTENT } from '../tools/content';
import { lapReport } from '../tools/lap';
import { CLASSES, layout } from './helpers';

// Balance (SPEC "Changed while building"): every class's hard solo lap stays within a band of the
// field's mean on every layout, so a car is a style, not a win button. The rally car's dirt edge
// on the Valley is the one allowed outlier, and it's still bounded.
const layouts = ['downtown/downtown', 'backroads/valley', 'paradise/island'].map((key) => [key, layout(key)] as const);

describe('car content', () => {
  test('every car file is a class the game loads (CLASS_ORDER), and every class has a file', () => {
    const files = readdirSync(join(CONTENT, 'cars'))
      .filter((f) => f.endsWith('.json') && f !== 'paints.json')
      .map((f) => f.replace('.json', ''));
    expect(files.sort()).toEqual([...CLASS_ORDER].sort());
  });
});

describe('the police car', () => {
  test('is a player class with the sedan shell it is drawn on, heavier for the push bar', () => {
    const police = CLASSES.find((c) => c.id === 'police')!;
    const sedan = CLASSES.find((c) => c.id === 'sedan')!;
    expect(CLASS_ORDER).toContain('police');
    expect(police.name).toBe('Interceptor');
    expect(police.size).toEqual(sedan.size);
    expect(police.mass).toBeGreaterThan(sedan.mass);
  });
});

describe('car balance', () => {
  for (const [key, layout] of layouts) {
    test(`${key}: every class laps clean within ±5% of the mean (rally ±7% on dirt)`, () => {
      const floors = CLASSES.map((c) => {
        const r = lapReport(key, layout, c.id);
        expect(r.wrecks.length).toBe(0);
        expect(r.lapFloor).not.toBeNull();
        return r.lapFloor!;
      });
      const mean = floors.reduce((a, b) => a + b, 0) / floors.length;
      CLASSES.forEach((c, k) => {
        const band = c.id === 'rally' && key.startsWith('backroads') ? 0.07 : 0.05;
        expect(Math.abs(floors[k] / mean - 1)).toBeLessThan(band);
      });
    });
  }
});
