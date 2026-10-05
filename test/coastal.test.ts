// Coastal (docs/COASTAL.md): a harbour town on a headland, built on Caldera from the start. Its
// first lap (COASTAL's step 2): the land in world space (the coast, and hills off the roads), the
// harbour bridge a deck over the harbour mouth, mostly blue skies, and its own music.

import { describe, expect, test } from 'bun:test';
import { playlistFor, ANY_MAP } from '../src/audio/soundtrack';
import type { MapDef } from '../src/core/content';
import { bakeTrack } from '../src/core/track/bake';
import { hillHeight } from '../src/core/track/features/hills';
import { newCast } from '../src/core/track/ground';
import { newHit, sampleAt } from '../src/core/track/query';
import { planWeather } from '../src/core/world/weather';
import { run, setup } from '../src/dev/drive';
import { ALL_MAPS } from '../tools/content';
import { CLASSES, SURFACES, layout } from './helpers';

const riviera = layout('coastal/riviera');
const track = bakeTrack(riviera, SURFACES);
const g = track.ground!;
const def = riviera.ground!;
const map = ALL_MAPS.find((m) => m.id === 'coastal') as MapDef;
const bridge = g.pieces.list.find((p) => p.id === 'harbour-bridge')!;

describe('coastal', () => {
  test('an experimental map (out of the lobby), one layout, Riviera', () => {
    expect(map).toMatchObject({ name: 'Coastal', layouts: ['riviera'], experimental: true });
  });

  test('hills: the highest dome at a point, nothing past their feet', () => {
    const hills = [
      { x: 0, z: 0, h: 50, r: 100 },
      { x: 60, z: 0, h: 20, r: 100 },
    ];
    expect(hillHeight(hills, 0, 0)).toBeCloseTo(50, 6);
    // (The lower one's top, over the higher one's side there.)
    expect(hillHeight(hills, 60, 0)).toBeCloseTo(20, 6);
    expect(hillHeight(hills, 200, 0)).toBe(0);
    expect(hillHeight(hills, 0, 101)).toBe(0);
  });

  test("the town's hill rises off the road, and the road keeps its own height", () => {
    const town = def.hills![0];
    const plain = bakeTrack({ ...riviera, ground: { ...def, hills: undefined } }, SURFACES).ground!;
    // Near its top, well off any road: the hill.
    let risen = 0;
    for (let x = town.x - 60; x <= town.x + 60; x += 30)
      for (let z = town.z - 60; z <= town.z + 60; z += 30) risen = Math.max(risen, g.height(x, z) - plain.height(x, z));
    expect(risen).toBeGreaterThan(15);
    // On the road, as without the hills.
    const hit = newHit();
    for (let s = 0; s < track.main.length; s += 50) {
      sampleAt(track.main, s, hit);
      expect([s, g.height(hit.cx, hit.cz)]).toEqual([s, expect.closeTo(plain.height(hit.cx, hit.cz), 3)]);
    }
  });

  test('the harbour bridge is a deck over the water: the sea well under it, and a car over it at speed', () => {
    const c = newCast();
    const mid = sampleAt(track.main, (bridge.s[0] + bridge.s[1]) / 2, newHit());
    g.cast(mid.cx, mid.cy + 0.3, mid.cz, c);
    expect(c.piece).toBe(bridge.index);
    expect(c.floor).toBeCloseTo(mid.cy, 1);
    expect(c.ground).toBeLessThan(def.sea! - 2);
    // A harbour, not a pit under the deck: deep water up the channel, well off the bridge (the deck's
    // `under` only reaches 15 m past its edges), and its sides still in the water.
    for (const z of [240, 270]) {
      expect(g.height(mid.cx, z)).toBeLessThan(def.sea! - 5);
      expect(g.height(mid.cx - 35, z)).toBeLessThan(def.sea! - 1);
      expect(g.height(mid.cx + 35, z)).toBeLessThan(def.sea! - 1);
    }
    const input = { throttle: 1 };
    const d = run(setup(track, CLASSES, SURFACES, { s: bridge.s[0] - 40 }, input, { kmh: 120 }), input, 7, 0.5);
    expect(d.summary.wrecks).toEqual([]);
    expect(d.summary.end.s).toBeGreaterThan(bridge.s[1]);
  }, 30_000);

  test('mostly blue skies: a shower one race in about seven (`rare`), against more than half on Paradise', () => {
    const showers = (allowed: string[]) => Array.from({ length: 400 }, (_, seed) => planWeather('random', seed + 1, allowed)).filter((p) => p.to > 0).length / 400;
    expect(map.weather).toContain('rare');
    expect(showers(map.weather)).toBeGreaterThan(0.08);
    expect(showers(map.weather)).toBeLessThan(0.22);
    expect(showers(['clear', 'rain', 'shower'])).toBeGreaterThan(0.5);
  });

  test('its music: the coastal track, then the ones for any map', () => {
    expect(playlistFor('coastal', false)).toEqual(['coastal', ...ANY_MAP]);
  });
});
