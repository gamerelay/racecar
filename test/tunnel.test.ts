// A tunnel on the main road (docs/COASTAL.md, the Rock Tunnel; CALDERA's pieces): an enclosed piece
// on the main road keeps the land's rock over its road (ground/land.ts), where a deck has the
// ground brought down to it. A car in it is on its floor, under its ceiling, in its space; its
// walls hold; out of it the ground's the road's again.

import { describe, expect, test } from 'bun:test';
import type { TrackLayout } from '../src/core/content';
import { neutralControls } from '../src/core/controls';
import { Ev } from '../src/core/events';
import { bakeTrack } from '../src/core/track/bake';
import { KIND_ROAD, newCast } from '../src/core/track/ground';
import { newHit, sampleAt } from '../src/core/track/query';
import { validateLayout } from '../src/core/track/validate';
import { setup } from '../src/dev/drive';
import { CLASSES, SURFACES, layout } from './helpers';

const riviera = layout('coastal/riviera');
const track = bakeTrack(riviera, SURFACES);
const g = track.ground!;
const tunnel = g.pieces.list.find((p) => p.id === 'rock-tunnel')!;

describe('the Rock Tunnel', () => {
  test('on the main road, through the spur: a long one, lit as a tunnel', () => {
    expect(tunnel.spline).toBe(0);
    expect(tunnel.s[1] - tunnel.s[0]).toBeGreaterThan(150);
    expect(tunnel.ceiling).toBeGreaterThan(6);
    expect(tunnel.indoor).toBe('tunnel');
  });

  test('inside: its floor under the rock, enclosed; the rock over it, not the road; outside, open', () => {
    const c = newCast();
    const hit = newHit();
    // Past its mouths (the rock starts a little in).
    for (let s = tunnel.s[0] + 10; s < tunnel.s[1] - 10; s += 10) {
      sampleAt(track.main, s, hit);
      g.cast(hit.cx, hit.cy + 0.5, hit.cz, c);
      expect([s, c.piece, c.space]).toEqual([s, tunnel.index, 'enclosed']);
      expect(c.floor).toBeCloseTo(hit.cy, 1);
      expect(c.ceiling).toBeCloseTo(hit.cy + tunnel.ceiling, 1);
      // The rock over its ceiling, and drawn as rock, not road.
      expect(c.ground).toBeGreaterThan(hit.cy + tunnel.ceiling + 2);
      expect(g.kindAt(hit.cx, hit.cz)).not.toBe(KIND_ROAD);
      // From the sky: the hill's top.
      expect(g.top(hit.cx, hit.cz)).toBeCloseTo(c.ground, 3);
    }
    for (const s of [tunnel.s[0] - 20, tunnel.s[1] + 20]) {
      sampleAt(track.main, s, hit);
      g.cast(hit.cx, hit.cy + 0.5, hit.cz, c);
      expect([s, c.space, c.piece]).toEqual([s, 'open', -1]);
      expect(c.ground).toBeCloseTo(hit.cy, 0);
    }
  });

  test('driven through by the hard AI at speed: on its road the whole way, no wreck', () => {
    const sim = setup(track, CLASSES, SURFACES, { s: tunnel.s[0] - 60 }, 'ai', { kmh: 150 });
    const hit = newHit();
    let deepest = 0;
    for (let k = 0; k < 60 * 8 && sim.cars.s[0] < tunnel.s[1] + 30; k++) {
      sim.step([]);
      const c = sim.cars;
      if (c.s[0] > tunnel.s[0] && c.s[0] < tunnel.s[1]) {
        sampleAt(track.main, c.s[0], hit);
        deepest = Math.max(deepest, Math.abs(c.y[0] - hit.cy));
      }
    }
    expect(sim.cars.wreck[0]).toBe(0);
    expect(sim.cars.s[0]).toBeGreaterThan(tunnel.s[1]);
    expect(deepest).toBeLessThan(1.5);
  }, 30_000);

  test('its walls hold: steered into one, a car is turned back, not out into the rock', () => {
    const mid = (tunnel.s[0] + tunnel.s[1]) / 2;
    const input = { ...neutralControls(), throttle: 1, steer: 1 };
    const sim = setup(track, CLASSES, SURFACES, { s: mid - 40 }, input, { kmh: 60 });
    let hits = 0;
    let cursor = sim.events.head;
    const hit = newHit();
    let widest = 0;
    for (let k = 0; k < 60 * 3; k++) {
      sim.step([input]);
      cursor = sim.events.read(cursor, (e) => {
        if (e.car === 0 && e.type === Ev.WallHit) hits++;
      });
      sampleAt(track.main, sim.cars.s[0], hit);
      widest = Math.max(widest, Math.abs(sim.cars.lateral[0]));
    }
    expect(hits).toBeGreaterThan(0);
    expect(widest).toBeLessThan(hit.width / 2 + hit.shoulder + 1.5);
  }, 30_000);

  test('the validator: a ceiling on the main road is fine now; a gap or a building there is not', () => {
    const errors = (l: TrackLayout) => validateLayout(l, SURFACES, CLASSES).filter((p) => p.level === 'error' && p.message.includes('branches only'));
    const withTunnel = (more: object) => ({ ...riviera, pieces: riviera.pieces!.map((p) => (p.id === 'rock-tunnel' ? { ...p, ...more } : p)) });
    expect(errors(riviera)).toEqual([]);
    expect(errors(withTunnel({ building: 'market' })).length).toBe(1);
    expect(errors(withTunnel({ floor: false, ceiling: undefined })).length).toBe(1);
  }, 60_000);
});
