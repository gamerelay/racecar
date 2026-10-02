import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Input, type SystemAction } from '../src/input/input';
import { neutralControls } from '../src/core/controls';
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
  test("steering eases in: not all at once, full within a quarter second, and right is positive", () => {
    key('keydown', 'KeyD');
    const s = frames(15);
    expect(s[0]).toBeGreaterThan(0);
    expect(s[0]).toBeLessThan(0.2);
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
