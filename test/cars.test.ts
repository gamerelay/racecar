import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TrackLayout } from '../src/core/content';
import { lapReport } from '../tools/lap-report';
import { CLASSES } from './helpers';

// Balance (SPEC "Changed while building"): every class's hard solo lap stays within a band of the
// field's mean on every layout, so a car is a style, not a win button. The rally car's dirt edge
// on the Valley is the one allowed outlier, and it's still bounded.
const layouts = ['city/downtown', 'countryside/valley'].map((key) => {
  const [map, name] = key.split('/');
  return [key, JSON.parse(readFileSync(join(import.meta.dir, '..', 'content', 'maps', map, `${name}.track.json`), 'utf8')) as TrackLayout] as const;
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
        const band = c.id === 'rally' && key.startsWith('countryside') ? 0.07 : 0.05;
        expect(Math.abs(floors[k] / mean - 1)).toBeLessThan(band);
      });
    });
  }
});
