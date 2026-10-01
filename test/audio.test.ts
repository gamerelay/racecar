import { describe, expect, test } from 'bun:test';
import { CLASS_ORDER } from '../src/core/content';
import { doppler, ENGINE_SOUNDS, engineHz, engineSound, gearbox, spatial } from '../src/audio/model';
import { CLASSES } from './helpers';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Soundtrack, TRACKS, trackFor, trackUrl, type TrackName } from '../src/audio/soundtrack';
import { MAPS } from '../tools/content';

// The sound model is pure (the Web Audio graph isn't testable in Bun): gears, pitch, where a sound
// sits, and Doppler.
describe('audio model', () => {
  test('every class has an engine sound, and an unknown one falls back', () => {
    for (const id of CLASS_ORDER) expect(ENGINE_SOUNDS[id]).toBeDefined();
    expect(engineSound('nope')).toBe(ENGINE_SOUNDS.coupe);
  });

  test('the gearbox climbs through every gear, revs rise within a gear and drop at each shift', () => {
    for (const cls of CLASSES) {
      const s = engineSound(cls.id);
      let prev = gearbox(0, cls.topSpeed, s.gears);
      expect(prev.gear).toBe(0);
      expect(prev.rpm).toBeGreaterThan(0);
      let shifts = 0;
      for (let v = 0.25; v <= cls.topSpeed; v += 0.25) {
        const g = gearbox(v, cls.topSpeed, s.gears, { gear: 0, rpm: 0 });
        expect(g.gear).toBeGreaterThanOrEqual(prev.gear);
        if (g.gear === prev.gear) expect(g.rpm).toBeGreaterThanOrEqual(prev.rpm);
        else {
          shifts++;
          expect(g.rpm).toBeLessThan(prev.rpm);
        }
        expect(g.rpm).toBeLessThanOrEqual(1.1);
        prev = g;
      }
      expect(shifts).toBe(s.gears - 1);
      // Past top speed it holds the last gear at the limiter, never NaN.
      const over = gearbox(cls.topSpeed * 2, cls.topSpeed, s.gears);
      expect(over.gear).toBe(s.gears - 1);
      expect(over.rpm).toBe(1.1);
      expect(Number.isFinite(gearbox(-5, cls.topSpeed, s.gears).rpm)).toBe(true);
    }
  });

  test('the bus sounds lower than the hatch at the same revs', () => {
    expect(engineHz(0.5, engineSound('bus'))).toBeLessThan(engineHz(0.5, engineSound('hatch')));
    expect(engineHz(1, engineSound('coupe'))).toBeGreaterThan(engineHz(0, engineSound('coupe')));
  });

  test('spatial: right is right, behind is centered-ish, far is quiet, on top is centered', () => {
    // Facing +z: the right is -x (the game's heading convention).
    expect(spatial(-10, 0, 0, 1).pan).toBeCloseTo(1, 5);
    expect(spatial(10, 0, 0, 1).pan).toBeCloseTo(-1, 5);
    expect(Math.abs(spatial(0, -10, 0, 1).pan)).toBeLessThan(1e-9);
    expect(spatial(0, 0, 0, 1)).toEqual({ pan: 0, gain: 1 });
    expect(spatial(0, 200, 0, 1).gain).toBeLessThan(0.01);
    expect(spatial(0, 5, 0, 1).gain).toBeGreaterThan(spatial(0, 50, 0, 1).gain);
  });

  test('doppler: higher closing, lower going away, 1 at rest or on top, clamped', () => {
    // A source 50 m ahead coming at a stopped listener.
    expect(doppler(0, 50, 0, -40, 0, 0)).toBeGreaterThan(1);
    expect(doppler(0, 50, 0, 40, 0, 0)).toBeLessThan(1);
    expect(doppler(0, 50, 0, 0, 0, 0)).toBe(1);
    expect(doppler(0, 0, 0, 40, 0, 0)).toBe(1);
    // Moving together: no shift.
    expect(doppler(0, 50, 0, 30, 0, 30)).toBeCloseTo(1, 9);
    expect(doppler(0, 50, 0, -1e6, 0, 0)).toBeLessThanOrEqual(1.4);
    expect(doppler(0, 50, 0, 1e6, 0, 0)).toBeGreaterThanOrEqual(0.7);
  });
});

describe('the soundtrack', () => {
  test("the title's track behind the menus, each map's in its race, and a file for every one", () => {
    expect(trackFor('downtown', true)).toBe('title');
    for (const m of MAPS) expect(trackFor(m.id, false)).toBe(m.id as TrackName);
    expect(trackFor('volcano', false)).toBeNull();
    for (const name of TRACKS) expect(existsSync(join(import.meta.dir, '..', 'public', 'music', `${name}.m4a`))).toBe(true);
  });

  test('a track is at the base given, with or without its slash', () => {
    expect(trackUrl('paradise', '/music/')).toBe('/music/paradise.m4a');
    expect(trackUrl('title', 'https://cdn.example/racecar')).toBe('https://cdn.example/racecar/title.m4a');
  });
});

describe('the soundtrack player', () => {
  /** A stand-in <audio>: `answer` decides what each play() does. */
  class FakeAudio {
    paused = true;
    plays = 0;
    static answer: () => Promise<void> = () => Promise.resolve();
    crossOrigin = '';
    loop = false;
    preload = '';
    src = '';
    addEventListener() {}
    play() {
      this.plays++;
      return FakeAudio.answer().then(() => void (this.paused = false));
    }
    pause() {
      this.paused = true;
    }
  }
  const refuse = () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
  function player() {
    (globalThis as { Audio?: unknown }).Audio = FakeAudio;
    const t = new Soundtrack('/music/title.m4a');
    const ctx = { createMediaElementSource: () => ({ connect() {} }) } as unknown as AudioContext;
    t.connect(ctx, {} as AudioNode);
    return { t, el: t.el as unknown as FakeAudio };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  test("a browser that only plays from a gesture: refused from frames it keeps waiting, and it's the synth's after three refused gestures", async () => {
    FakeAudio.answer = refuse;
    const { t, el } = player();
    // From frames: tried once a second at most, and never given up on.
    for (let k = 0; k < 50; k++) {
      t.play();
      await settle();
    }
    expect(el.plays).toBe(1);
    expect(t.failed).toBe(false);
    for (let k = 0; k < 3; k++) {
      t.play(true);
      await settle();
    }
    expect(t.failed).toBe(true);
  });

  test('a gesture that plays it resets the count; a file it cannot play is the synth at once', async () => {
    const { t, el } = player();
    FakeAudio.answer = refuse;
    t.play(true);
    await settle();
    t.play(true);
    await settle();
    FakeAudio.answer = () => Promise.resolve();
    t.play(true);
    await settle();
    expect(el.paused).toBe(false);
    el.pause();
    FakeAudio.answer = refuse;
    t.play(true);
    await settle();
    t.play(true);
    await settle();
    expect(t.failed).toBe(false);
    FakeAudio.answer = () => Promise.reject(Object.assign(new Error('codec'), { name: 'NotSupportedError' }));
    t.play(true);
    await settle();
    expect(t.failed).toBe(true);
  });
});
