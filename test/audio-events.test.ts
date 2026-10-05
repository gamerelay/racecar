import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { PerspectiveCamera } from 'three';
import { GameAudio, type AudioFrame } from '../src/audio/audio';
import { Music } from '../src/audio/music';
import { note } from '../src/audio/synth';
import type { Soundtrack } from '../src/audio/soundtrack';
import { Ev } from '../src/core/events';
import { fakeBrowser, FakeAudioContext, type FakeTarget } from './fake-audio';
import { Sim } from '../src/core/sim';
import { bakeTrack } from '../src/core/track/bake';
import { newHit, sampleAt } from '../src/core/track/query';
import { CLASSES, citySim, layout, SURFACES } from './helpers';

// The audio's event handling and the synth's sequencer, on a fake Web Audio (fake-audio.ts): what
// would play, counted as the oscillators and noise sources made.

let browser: ReturnType<typeof fakeBrowser>;
beforeEach(() => (browser = fakeBrowser()));
afterEach(() => browser.restore());

/** A game's audio with its graph made (a key press), the synth off (only the events make sounds). */
function started() {
  const sim = citySim();
  const audio = new GameAudio(sim);
  (browser.window as FakeTarget).fire('keydown');
  const ctx = FakeAudioContext.all.at(-1)!;
  audio.settings.music = false;
  // M's mute is remembered on the device: start unmuted whatever it says.
  if (audio.settings.muted) audio.toggleMute();
  const frame: AudioFrame = { focus: 0, camera: new PerspectiveCamera(), paused: false, menu: false };
  /** Sounds one frame made. */
  const step = (f: Partial<AudioFrame> = {}) => {
    const before = ctx.made;
    audio.update(1 / 60, { ...frame, ...f });
    return ctx.made - before;
  };
  // A hazard's alert: three tones, wherever you are.
  const hazard = () => sim.events.push(0, Ev.Hazard, -1);
  step();
  return { sim, audio, ctx, step, hazard };
}

describe('game audio', () => {
  test('the graph is made on the first key press, and an event heard then is played', () => {
    const { ctx, step, hazard } = started();
    expect(ctx).toBeDefined();
    expect(step()).toBe(0);
    hazard();
    expect(step()).toBe(3);
  });

  test("muted, events don't pile up: unmuting doesn't play what happened meanwhile", () => {
    const { audio, step, hazard } = started();
    expect(audio.toggleMute()).toBe(true);
    step();
    for (let k = 0; k < 20; k++) hazard();
    expect(step()).toBe(0);
    expect(audio.toggleMute()).toBe(false);
    expect(step()).toBe(0);
    // And what happens after is heard as usual.
    hazard();
    expect(step()).toBe(3);
  });

  test("paused, or in a hidden tab, the same: back from it, the old events aren't played", () => {
    const { step, hazard } = started();
    hazard();
    expect(step({ paused: true })).toBe(0);
    expect(step()).toBe(0);
    browser.document.hidden = true;
    browser.document.fire('visibilitychange');
    hazard();
    hazard();
    expect(step()).toBe(0);
    browser.document.hidden = false;
    browser.document.fire('visibilitychange');
    expect(step()).toBe(0);
  });

  test('quiet suspends the context, and the next frame that isn\'t resumes it', () => {
    const { ctx, step } = started();
    step({ paused: true });
    expect(ctx.state).toBe('suspended');
    step();
    expect(ctx.state).toBe('running');
  });

  test('unmuting (M is a key press) resumes the context at once, not on the next frame', () => {
    const { audio, ctx, step } = started();
    audio.toggleMute();
    step();
    expect(ctx.state).toBe('suspended');
    const resumes = ctx.resumes;
    audio.toggleMute();
    expect(ctx.state).toBe('running');
    expect(ctx.resumes).toBe(resumes + 1);
  });

  test('held back by the browser, events before the first gesture are never heard, not even after it', () => {
    const sim = citySim();
    const audio = new GameAudio(sim);
    // Made at load, in case the browser allows it; this one doesn't.
    const ctx = FakeAudioContext.all[0];
    expect(ctx.state).toBe('suspended');
    audio.settings.music = false;
    if (audio.settings.muted) audio.toggleMute();
    const frame = { focus: 0, camera: new PerspectiveCamera(), paused: false, menu: false };
    const before = ctx.made;
    sim.events.push(0, Ev.Hazard, -1);
    audio.update(1 / 60, frame);
    expect(ctx.state).toBe('suspended');
    browser.window.fire('keydown');
    expect(ctx.state).toBe('running');
    audio.update(1 / 60, frame);
    expect(ctx.made - before).toBe(0);
    expect(FakeAudioContext.all).toHaveLength(1);
  });

  test('a frame while the first gesture\'s resume is still settling leaves the track it started playing', () => {
    let pauses = 0;
    let plays = 0;
    const track = { failed: false, connect() {}, play: () => plays++, pause: () => pauses++ };
    const audio = new GameAudio(citySim(), track as unknown as Soundtrack, true);
    if (audio.settings.muted) audio.toggleMute();
    audio.settings.music = true;
    browser.window.fire('keydown');
    expect(plays).toBeGreaterThan(0);
    // The context hasn't switched to running yet (a real one takes a few ms).
    FakeAudioContext.all[0].state = 'suspended';
    FakeAudioContext.lag = true;
    audio.update(1 / 60, { focus: 0, camera: new PerspectiveCamera(), paused: false, menu: true });
    expect(pauses).toBe(0);
  });

  test('held back by the browser, frames don\'t keep asking to resume (they\'d never settle)', () => {
    const nav = globalThis.navigator as unknown as Record<string, unknown>;
    const was = Object.getOwnPropertyDescriptor(nav, 'userActivation');
    Object.defineProperty(nav, 'userActivation', { value: { hasBeenActive: false }, configurable: true });
    try {
      const audio = new GameAudio(citySim());
      if (audio.settings.muted) audio.toggleMute();
      const ctx = FakeAudioContext.all[0];
      const before = ctx.resumes;
      for (let k = 0; k < 30; k++) audio.update(1 / 60, { focus: 0, camera: new PerspectiveCamera(), paused: false, menu: true });
      expect(ctx.resumes - before).toBe(0);
    } finally {
      if (was) Object.defineProperty(nav, 'userActivation', was);
      else delete nav.userActivation;
    }
  });

  test('where the browser allows sound without a gesture, it runs from the start (the title music)', () => {
    browser.restore();
    browser = fakeBrowser({ autoplay: true });
    const sim = citySim();
    const audio = new GameAudio(sim);
    audio.settings.music = false;
    if (audio.settings.muted) audio.toggleMute();
    expect(audio.audible).toBe(true);
    audio.update(1 / 60, { focus: 0, camera: new PerspectiveCamera(), paused: false, menu: false });
    sim.events.push(0, Ev.Hazard, -1);
    const ctx = FakeAudioContext.all[0];
    const before = ctx.made;
    audio.update(1 / 60, { focus: 0, camera: new PerspectiveCamera(), paused: false, menu: false });
    expect(ctx.made - before).toBe(3);
  });

  test("a drawbridge's bells: from its warning till it's down, quicker in the warning, and only near it", () => {
    const sim = new Sim(bakeTrack(layout('coastal/riviera'), SURFACES), CLASSES, SURFACES, { seed: 7 });
    const audio = new GameAudio(sim);
    (browser.window as FakeTarget).fire('keydown');
    const ctx = FakeAudioContext.all.at(-1)!;
    audio.settings.music = false;
    if (audio.settings.muted) audio.toggleMute();
    const lifts = sim.world!.lifts;
    const def = lifts.defs[0];
    const mid = sampleAt(sim.track.main, (def.s[0] + def.s[1]) / 2, newHit());
    const camera = new PerspectiveCamera();
    /** Sounds made over `secs` from `from` s after the race's green, the camera `off` m from the bridge. */
    const over = (from: number, secs: number, off = 20) => {
      camera.position.set(mid.cx + off, mid.cy + 5, mid.cz);
      const before = ctx.made;
      for (let k = 0; k < secs * 60; k++) {
        sim.time = lifts.origin + from + k / 60;
        audio.update(1 / 60, { focus: 0, camera, paused: false, menu: false });
      }
      return ctx.made - before;
    };
    const t0 = lifts.starts[0][0];
    // Down: none. The warning: twice a second (two tones a ring). Up: once a second. Far off: none heard.
    expect(over(t0 - 4, 3.9)).toBe(0);
    expect(over(t0 + 0.05, def.warn - 0.1)).toBe(2 * 8);
    expect(over(t0 + def.warn + def.rise + 0.05, 3.9)).toBe(2 * 4);
    expect(over(t0 + def.warn + def.rise + 0.05, 3.9, 900)).toBe(0);
  });
});

// The synth soundtrack (music.ts): Am–F–C–G, a bar each, sixteen steps a bar.
const STEP = 60 / 112 / 4;
const CHORDS = [
  { tones: [0, 3, 7], root: -24 },
  { tones: [-4, 0, 3], root: -28 },
  { tones: [3, 7, 10], root: -21 },
  { tones: [-2, 2, 5], root: -26 },
];

function sequencer(intensity: 0 | 1 | 2 = 0) {
  const ctx = new FakeAudioContext();
  const music = new Music(ctx as unknown as AudioContext, ctx.createGain() as unknown as AudioNode);
  music.intensity = intensity;
  /** Runs the sequencer frame by frame (60 fps) for `seconds`. */
  const run = (seconds: number) => {
    const end = ctx.currentTime + seconds;
    while (ctx.currentTime < end) {
      music.update();
      ctx.currentTime += 1 / 60;
    }
  };
  /** The frequencies of the saws started at `t` (a bar's first step: its pad and its bass). */
  const sawsAt = (t: number) =>
    ctx.oscillators
      .filter((o) => o.type === 'sawtooth' && Math.abs(o.startedAt - t) < 1e-6)
      .map((o) => o.frequency.scheduled[0].v)
      .sort((a, b) => a - b);
  return { ctx, music, run, sawsAt };
}

const close = (a: number[], b: number[]) => {
  expect(a).toHaveLength(b.length);
  a.forEach((v, k) => expect(v).toBeCloseTo(b[k], 6));
};

describe('synth music', () => {
  test("each bar's pad and bass are its chord's, Am F C G, and after four bars it goes round again", () => {
    const { run, sawsAt } = sequencer();
    run(STEP * 16 * 5 + 0.5);
        for (let bar = 0; bar < 5; bar++) {
      const c = CHORDS[bar % 4];
      const want = [...c.tones.map((t) => note(t - 12)), note(c.root)].sort((a, b) => a - b);
      close(sawsAt(bar * 16 * STEP), want);
    }
  });

  test('behind a menu (intensity 0) there are no drums; a race adds them, and the final lap puts the arp up an octave', () => {
    const calm = sequencer(0);
    calm.run(STEP * 16);
    expect(calm.ctx.sources).toHaveLength(0);
    expect(calm.ctx.oscillators.some((o) => o.type === 'triangle')).toBe(false);

    const race = sequencer(1);
    race.run(STEP * 16);
    expect(race.ctx.sources.length).toBeGreaterThan(0);
    const final = sequencer(2);
    final.run(STEP * 16);
    // The arp's first note (step 0: the chord's root an octave down, up one on the final lap).
    const arp = (s: typeof race) => s.ctx.oscillators.find((o) => o.type === 'triangle' && o.startedAt === 0)!.frequency.scheduled[0].v;
    expect(arp(race)).toBeCloseTo(note(-12), 6);
    expect(arp(final)).toBeCloseTo(note(0), 6);
    // More hats on the final lap.
    expect(final.ctx.sources.length).toBeGreaterThan(race.ctx.sources.length);
  });

  test("back from a suspend (a pause, a hidden tab) it picks up from now: the backlog isn't played", () => {
    const { ctx, music, run } = sequencer();
    run(1);
    const made = ctx.oscillators.length;
    ctx.currentTime += 30;
    music.update();
    // A quarter second ahead is a few steps (a pad and some bass), not 30 s of them.
    const added = ctx.oscillators.slice(made);
    expect(added.length).toBeLessThan(8);
    for (const o of added) expect(o.startedAt).toBeGreaterThanOrEqual(ctx.currentTime);
  });
});
