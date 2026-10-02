import { describe, expect, spyOn, test } from 'bun:test';
import { CLASS_ORDER } from '../src/core/content';
import { doppler, ENGINE_SOUNDS, engineHz, engineSound, gearbox, musicMix, MUSIC_LEVEL, spatial } from '../src/audio/model';
import { CLASSES } from './helpers';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ANY_MAP, MAP_TRACKS, pickTrack, playlistFor, Soundtrack, TITLE_TRACKS, TRACKS, trackUrl } from '../src/audio/soundtrack';
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
  test("the title's tracks behind the menus; in a race the map's own and the four for any map; a file for every one", () => {
    expect(playlistFor('downtown', true)).toEqual(['title', 'pursuit-orchestra']);
    expect(playlistFor('backroads', false)).toEqual(['backroads', 'backroads-acoustic', ...ANY_MAP]);
    // Every map has its own (named after it, first), and every track is someone's.
    for (const m of MAPS) expect(playlistFor(m.id, false)).toEqual([m.id as (typeof TRACKS)[number], ...MAP_TRACKS[m.id]!.slice(1), ...ANY_MAP]);
    expect(playlistFor('downtown', false)).toEqual(['downtown', 'tokyo-dubstep', ...ANY_MAP]);
    expect(playlistFor('paradise', false)).toEqual(['paradise', 'hawaiian-vibes', ...ANY_MAP]);
    expect(new Set([...TITLE_TRACKS, ...Object.values(MAP_TRACKS).flat(), ...ANY_MAP])).toEqual(new Set(TRACKS));
    expect(playlistFor('volcano', false)).toEqual([...ANY_MAP]);
    expect(playlistFor('constructor', false)).toEqual([...ANY_MAP]);
    for (const name of TRACKS) expect(existsSync(join(import.meta.dir, '..', 'public', 'music', `${name}.m4a`))).toBe(true);
  });

  test('never the same song twice in a row: a pick skips the last one, whatever the dice say', () => {
    const list = playlistFor('paradise', false);
    for (const last of list) for (const r of [0, 0.34, 0.67, 0.999]) expect(pickTrack(list, last, () => r)).not.toBe(last);
    // Every other track comes up.
    expect(new Set([0, 0.2, 0.4, 0.6, 0.99].map((r) => pickTrack(list, 'paradise', () => r)))).toEqual(new Set(['hawaiian-vibes', ...ANY_MAP]));
    // A playlist of one (the title's) is that one.
    expect(pickTrack(['title'], 'title')).toBe('title');
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
    on: Record<string, () => void> = {};
    addEventListener(type: string, f: () => void) {
      this.on[type] = f;
    }
    play() {
      this.plays++;
      return FakeAudio.answer().then(() => {
        this.paused = false;
        this.on.playing?.();
      });
    }
    pause() {
      this.paused = true;
    }
  }
  const refuse = () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
  function player() {
    (globalThis as { Audio?: unknown }).Audio = FakeAudio;
    const t = new Soundtrack(['title'], '/music/');
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

  test("a race's playlist starts off the last race's track, goes on to another when one ends, and remembers what played", async () => {
    FakeAudio.answer = () => Promise.resolve();
    (globalThis as { Audio?: unknown }).Audio = FakeAudio;
    const played: string[] = [];
    const t = new Soundtrack(playlistFor('downtown', false), '/music/', { last: 'downtown', remember: (x) => played.push(x) }, () => 0);
    const el = t.el as unknown as FakeAudio;
    t.connect({ createMediaElementSource: () => ({ connect() {} }) } as unknown as AudioContext, {} as AudioNode);
    expect(t.current).not.toBe('downtown');
    expect(el.loop).toBe(false);
    t.play(true);
    await settle();
    expect(played).toEqual([t.current]);
    const first = t.current;
    el.paused = true;
    el.on.ended();
    await settle();
    expect(t.current).not.toBe(first);
    expect(el.src).toBe(`/music/${t.current}.m4a`);
    expect(el.paused).toBe(false);
    expect(played).toEqual([first, t.current]);
  });

  const ctxOf = (sources: { n: number } = { n: 0 }) =>
    ({
      createMediaElementSource: () => {
        sources.n++;
        return { connect() {} };
      },
    }) as unknown as AudioContext;
  function race(list = playlistFor('backroads', false), rand = Math.random) {
    FakeAudio.answer = () => Promise.resolve();
    (globalThis as { Audio?: unknown }).Audio = FakeAudio;
    const played: string[] = [];
    const t = new Soundtrack(list, '/music/', { last: null, remember: (x) => played.push(x) }, rand);
    t.connect(ctxOf(), {} as AudioNode);
    return { t, el: t.el as unknown as FakeAudio, played };
  }
  /** performance.now, held still or moved on, for the frame throttle. */
  function clock() {
    let t = 10_000;
    const spy = spyOn(performance, 'now').mockImplementation(() => t);
    return { at: (ms: number) => (t = ms), restore: () => spy.mockRestore() };
  }

  test("the title's track loops alone; a race's playlist doesn't (it moves on), and both stream with CORS", () => {
    const title = player().el;
    expect(title.loop).toBe(true);
    expect(title.src).toBe('/music/title.m4a');
    const { el, t } = race();
    expect(el.loop).toBe(false);
    expect(el.src).toBe(`/music/${t.current}.m4a`);
    expect(el.crossOrigin).toBe('anonymous');
    expect(el.preload).toBe('auto');
  });

  test("a track that can't load is the synth's from then on, and says so in the console", async () => {
    const warn = console.warn;
    const said: unknown[] = [];
    console.warn = (...a: unknown[]) => void said.push(a[0]);
    try {
      const { t, el } = race();
      el.on.error();
      expect(t.failed).toBe(true);
      expect(String(said[0])).toContain("can't play");
      t.play(true);
      await settle();
      expect(el.plays).toBe(0);
    } finally {
      console.warn = warn;
    }
  });

  test('joining the audio graph happens once, and a graph that refuses it is the synth', () => {
    FakeAudio.answer = () => Promise.resolve();
    (globalThis as { Audio?: unknown }).Audio = FakeAudio;
    const t = new Soundtrack(['title'], '/music/');
    const sources = { n: 0 };
    t.connect(ctxOf(sources), {} as AudioNode);
    t.connect(ctxOf(sources), {} as AudioNode);
    expect(sources.n).toBe(1);
    const warn = console.warn;
    console.warn = () => {};
    try {
      const u = new Soundtrack(['title'], '/music/');
      u.connect({ createMediaElementSource: () => { throw new Error('taken'); } } as unknown as AudioContext, {} as AudioNode);
      expect(u.failed).toBe(true);
    } finally {
      console.warn = warn;
    }
  });

  test('nothing plays before the graph exists, one play is on its way at a time, and none while it already plays', async () => {
    FakeAudio.answer = () => Promise.resolve();
    (globalThis as { Audio?: unknown }).Audio = FakeAudio;
    const t = new Soundtrack(['title'], '/music/');
    const el = t.el as unknown as FakeAudio;
    t.play(true);
    expect(el.plays).toBe(0);
    t.connect(ctxOf(), {} as AudioNode);
    t.play(true);
    t.play(true);
    expect(el.plays).toBe(1);
    await settle();
    expect(el.paused).toBe(false);
    t.play(true);
    expect(el.plays).toBe(1);
  });

  test('from frames it tries at most once a second; a key or click tries at once', async () => {
    const c = clock();
    try {
      const { t, el } = race();
      FakeAudio.answer = refuse;
      t.play();
      await settle();
      c.at(10_500);
      t.play();
      await settle();
      expect(el.plays).toBe(1);
      c.at(11_001);
      t.play();
      await settle();
      expect(el.plays).toBe(2);
      t.play(true);
      await settle();
      expect(el.plays).toBe(3);
    } finally {
      c.restore();
    }
  });

  test('through a long race, never the same song twice in a row, every one comes round, and each is remembered', async () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const { t, el, played } = race(playlistFor('paradise', false), rand);
    t.play(true);
    await settle();
    const order = [t.current];
    for (let k = 0; k < 60; k++) {
      el.paused = true;
      // A track ending a moment after the last play: the next starts at once, not a second later.
      el.on.ended();
      await settle();
      order.push(t.current);
    }
    for (let k = 1; k < order.length; k++) expect(order[k]).not.toBe(order[k - 1]);
    expect(new Set(order)).toEqual(new Set(playlistFor('paradise', false)));
    expect(played).toEqual(order);
    expect(el.plays).toBe(61);
  });
});

describe('the soundtrack files', () => {
  test('every track is AAC in an MP4 box (not a WAV that slipped in), and a few MB at most', () => {
    for (const name of TRACKS) {
      const path = join(import.meta.dir, '..', 'public', 'music', `${name}.m4a`);
      const head = readFileSync(path).subarray(0, 12);
      expect(head.subarray(4, 8).toString('latin1')).toBe('ftyp');
      expect(['M4A ', 'mp42', 'isom']).toContain(head.subarray(8, 12).toString('latin1'));
      const mb = statSync(path).size / 1e6;
      expect(mb).toBeGreaterThan(0.5);
      expect(mb).toBeLessThan(5);
    }
  });
});

describe('the music mix', () => {
  const base = { recorded: true, on: true, menu: false, titleTrack: false, racing: true, finalLap: false, timeScale: 1 };

  test('a recorded track plays instead of the synth; without one (or failed), the synth', () => {
    expect(musicMix(base)).toMatchObject({ track: true, synth: false, level: MUSIC_LEVEL, tone: 12000 });
    expect(musicMix({ ...base, recorded: false })).toMatchObject({ track: false, synth: true, intensity: 1 });
  });

  test('N off: neither plays, and the bus is silent', () => {
    expect(musicMix({ ...base, on: false })).toMatchObject({ track: false, synth: false, level: 0 });
    expect(musicMix({ ...base, on: false, recorded: false })).toMatchObject({ track: false, synth: false, level: 0 });
  });

  test("behind the menus the title's track is clear; the synth (or a race track there) is muffled", () => {
    expect(musicMix({ ...base, menu: true, titleTrack: true }).tone).toBe(12000);
    expect(musicMix({ ...base, menu: true, titleTrack: true, recorded: false }).tone).toBe(1400);
    expect(musicMix({ ...base, menu: true }).tone).toBe(1400);
  });

  test("slow-mo muffles it; the synth's layers follow the race (none behind a menu or once finished, more on the final lap)", () => {
    expect(musicMix({ ...base, timeScale: 0.5 }).tone).toBe(550);
    const synth = { ...base, recorded: false };
    expect(musicMix({ ...synth, menu: true }).intensity).toBe(0);
    expect(musicMix({ ...synth, racing: false }).intensity).toBe(0);
    expect(musicMix(synth).intensity).toBe(1);
    expect(musicMix({ ...synth, finalLap: true }).intensity).toBe(2);
  });
});

