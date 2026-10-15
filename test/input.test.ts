import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Input, KEY_ONSET, type SystemAction } from '../src/input/input';
import { neutralControls } from '../src/core/controls';
import { canStartDrift } from '../src/core/car/physics';
import { TUNING } from '../src/core/car/tuning';
import { wrapAngle } from '../src/core/math';
import { Ev } from '../src/core/events';
import { ringSim } from './helpers';
import { fakeBrowser } from './fake-audio';

// The keyboard (input/input.ts): steering eases in and out, and the keys that aren't driving
// (system keys, menus, shortcuts, text fields) don't drive. No gamepad: Bun has none.

let browser: ReturnType<typeof fakeBrowser>;
let input: Input;
const fired: SystemAction[] = [];
beforeEach(() => {
  browser = fakeBrowser();
  input = new Input();
  fired.length = 0;
  input.on((a) => fired.push(a));
});
afterEach(() => {
  // The held keys are the module's: let go of them all for the next test.
  browser.window.fire('blur');
  browser.restore();
});

const key = (type: 'keydown' | 'keyup', code: string, more: Record<string, unknown> = {}) => browser.window.fire(type, { code, key: code, repeat: false, metaKey: false, ctrlKey: false, altKey: false, target: null, preventDefault() {}, ...more });
const out = neutralControls();
/** Frames at 60 fps; the steer after each. */
const frames = (n: number) => Array.from({ length: n }, () => input.poll(out, 1 / 60).steer);

describe('keyboard input', () => {
  test("steering starts at KEY_ONSET and eases in: not all at once, full within a quarter second, and right is positive", () => {
    key('keydown', 'KeyD');
    const s = frames(15);
    expect(s[0]).toBe(KEY_ONSET);
    expect(s[1]).toBeLessThan(0.5);
    for (let k = 1; k < s.length; k++) expect(s[k]).toBeGreaterThanOrEqual(s[k - 1]);
    expect(s.at(-1)).toBe(1);
    key('keyup', 'KeyD');
    key('keydown', 'ArrowLeft');
    expect(frames(30).at(-1)).toBe(-1);
  });

  test('let go, it eases back to straight; turning the other way gets through the middle faster', () => {
    key('keydown', 'KeyD');
    frames(30);
    key('keyup', 'KeyD');
    const back = frames(15);
    expect(back[0]).toBeGreaterThan(0.8);
    const released = back.findIndex((v) => v === 0);
    expect(released).toBeGreaterThan(4);
    expect(back.at(-1)).toBe(0);

    key('keydown', 'KeyD');
    frames(30);
    key('keyup', 'KeyD');
    key('keydown', 'KeyA');
    const across = frames(30);
    const crossed = across.findIndex((v) => v <= 0);
    expect(crossed).toBeLessThan(released);
    expect(across.at(-1)).toBe(-1);
  });

  test('a steer key turns the car its first 3° within 3 ticks of a pad at full lock (eased from 0, twice its time)', () => {
    /** Ticks from the steer to 3° of turn, the Brute at 140 km/h on a wide ring; `pad` is full lock from the first tick. */
    const ticks = (pad: boolean) => {
      browser.window.fire('blur');
      input.poll(neutralControls(), 1);
      const sim = ringSim(1, 2000, 60);
      const i = sim.addCar({ cls: 'muscle', human: true });
      sim.placeCar(i, 0, 100, 0, 39);
      const c = neutralControls();
      key('keydown', 'KeyW');
      for (let t = 0; t < 30; t++) sim.step([input.poll(c, 1 / 60)]);
      const h0 = sim.cars.h[i];
      key('keydown', 'KeyD');
      for (let t = 1; t <= 30; t++) {
        input.poll(c, 1 / 60);
        if (pad) c.steer = 1;
        sim.step([c]);
        if (Math.abs(wrapAngle(sim.cars.h[i] - h0)) >= (3 * Math.PI) / 180) return t;
      }
      return Infinity;
    };
    // 7 against the pad's 5 (eased from 0: 10). The pad's turns, or neither run measures anything.
    const pad = ticks(true);
    expect(pad).toBeLessThanOrEqual(10);
    expect(ticks(false)).toBeLessThanOrEqual(pad + 3);
  });

  test('both ways held is straight, and the steer never leaves -1 to 1 whatever the frame time', () => {
    key('keydown', 'KeyA');
    key('keydown', 'KeyD');
    expect(frames(20).at(-1)).toBe(0);
    key('keyup', 'KeyA');
    expect(input.poll(out, 10).steer).toBe(1);
  });

  test('throttle, brake, boost and the rest are on while held', () => {
    for (const code of ['KeyW', 'ArrowDown', 'Space', 'ShiftLeft', 'KeyR', 'KeyC', 'KeyH']) key('keydown', code);
    expect(input.poll(out, 1 / 60)).toMatchObject({ throttle: 1, brake: 1, boost: true, drift: true, reset: true, lookBack: true, horn: true });
    key('keyup', 'KeyW');
    expect(input.poll(out, 1 / 60).throttle).toBe(0);
  });

  test("a shortcut (Cmd, Ctrl, Alt), a text field or a suspended input doesn't drive", () => {
    key('keydown', 'KeyW', { metaKey: true });
    key('keydown', 'KeyR', { ctrlKey: true });
    key('keydown', 'KeyD', { altKey: true });
    key('keydown', 'Space', { target: { tagName: 'INPUT', type: 'text' } });
    key('keydown', 'KeyH', { target: { tagName: 'TEXTAREA' } });
    input.suspended = true;
    key('keydown', 'KeyS');
    expect(input.poll(out, 1 / 60)).toMatchObject({ throttle: 0, brake: 0, steer: 0, boost: false, reset: false, horn: false });
    // A slider isn't typing: its keys still count.
    input.suspended = false;
    key('keydown', 'KeyW', { target: { tagName: 'INPUT', type: 'range' } });
    expect(input.poll(out, 1 / 60).throttle).toBe(1);
  });

  test('losing focus, or letting go of Cmd (macOS sends no keyup for the rest), lets go of everything', () => {
    key('keydown', 'KeyW');
    browser.window.fire('blur');
    expect(input.poll(out, 1 / 60).throttle).toBe(0);
    key('keydown', 'KeyW');
    key('keydown', 'KeyD');
    browser.window.fire('keyup', { code: 'MetaLeft', key: 'Meta' });
    expect(input.poll(out, 1 / 60)).toMatchObject({ throttle: 0, steer: 0 });
    key('keydown', 'KeyW');
    browser.document.fire('visibilitychange');
    expect(input.poll(out, 1 / 60).throttle).toBe(0);
  });

  test("system keys fire once per press (not on a key's repeat) and don't drive", () => {
    key('keydown', 'KeyM');
    key('keydown', 'KeyM', { repeat: true });
    key('keydown', 'Escape');
    expect(fired).toEqual(['mute', 'pause']);
  });

  test('in a menu, arrows and WASD move focus instead of driving; Space is the page\'s', () => {
    input.menuOpen = true;
    key('keydown', 'ArrowUp');
    key('keydown', 'KeyD');
    key('keydown', 'Space');
    expect(fired).toEqual(['nav-up', 'pick-right']);
    expect(input.poll(out, 1 / 60)).toMatchObject({ steer: 0, throttle: 0, boost: false });
    // Escape still backs out (pauses) in a menu.
    key('keydown', 'Escape');
    expect(fired.at(-1)).toBe('pause');
  });
});

describe('drift on the keyboard', () => {
  test('ready to drift, with drift held, a steer key goes straight past the drift threshold', () => {
    input.readyToDrift = true;
    key('keydown', 'ShiftLeft');
    key('keydown', 'KeyD');
    expect(input.poll(out, 1 / 120).steer).toBeGreaterThan(TUNING.driftMinSteer);
  });

  test("drift held on the pad's RB, a steer key goes straight past the threshold too", () => {
    const nav = navigator as unknown as { getGamepads?: () => unknown[] };
    const was = nav.getGamepads;
    const buttons = Array.from({ length: 17 }, (_, k) => ({ pressed: k === 5, value: k === 5 ? 1 : 0 }));
    nav.getGamepads = () => [{ connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons }];
    try {
      input.readyToDrift = true;
      key('keydown', 'KeyD');
      const c = input.poll(out, 1 / 120);
      expect(c.drift).toBe(true);
      expect(c.steer).toBeGreaterThan(TUNING.driftMinSteer);
    } finally {
      nav.getGamepads = was;
    }
  });

  test("mid-drift (not ready), or with drift not held, steering eases in as before", () => {
    input.readyToDrift = false;
    key('keydown', 'ShiftLeft');
    key('keydown', 'KeyD');
    expect(input.poll(out, 1 / 60).steer).toBe(KEY_ONSET);
    browser.window.fire('blur');
    input.poll(out, 1);
    input.readyToDrift = true;
    key('keydown', 'KeyD');
    expect(input.poll(out, 1 / 60).steer).toBe(KEY_ONSET);
  });

  test('drift held, then a steer key: the drift starts on the next tick (eased from KEY_ONSET, 3 ticks; from 0, before it, 7–9)', () => {
    /** Ticks from the steer key to the drift's start, the Brute at 140 km/h on a wide ring. */
    const after = (ready: boolean) => {
      // Let go of everything and ease back to straight (the Input is the test's, run twice).
      browser.window.fire('blur');
      input.poll(neutralControls(), 1);
      const sim = ringSim(1, 600, 60);
      const i = sim.addCar({ cls: 'muscle', human: true });
      sim.placeCar(i, 0, 100, 0, 39);
      const c = neutralControls();
      expect(input.poll(c, 1 / 60).steer).toBe(0);
      key('keydown', 'KeyW');
      key('keydown', 'ShiftLeft');
      const tick = () => {
        input.readyToDrift = ready && canStartDrift(sim, i);
        input.poll(c, 1 / 60);
        const from = sim.events.head;
        sim.step([c]);
        let started = false;
        sim.events.read(from, (e) => void (started ||= e.car === i && e.type === Ev.DriftStart));
        return started;
      };
      // Drift held with no steer: no drift.
      for (let t = 0; t < 10; t++) expect(tick()).toBe(false);
      key('keydown', 'KeyA');
      for (let t = 0; t < 30; t++) if (tick()) return t;
      return Infinity;
    };
    expect(after(true)).toBe(0);
    // Eased from KEY_ONSET, 3 (from 0, before it, 7–9).
    expect(after(false)).toBeGreaterThanOrEqual(2);
  });

  test("in the air or spinning out, a car isn't ready to drift (stepCar's entry is on the ground and out of a spin)", () => {
    const sim = ringSim(1, 600, 60);
    const i = sim.addCar({ cls: 'muscle', human: true });
    sim.placeCar(i, 0, 100, 0, 39);
    expect(canStartDrift(sim, i)).toBe(true);
    sim.cars.grounded[i] = 0;
    expect(canStartDrift(sim, i)).toBe(false);
    sim.cars.grounded[i] = 1;
    sim.cars.spinT[i] = 0.5;
    expect(canStartDrift(sim, i)).toBe(false);
  });
});
