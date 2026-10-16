import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { assignKey, assignPad, browserKey, DEFAULT_KEYS, GAME_KEYS, DEFAULT_PAD, DRIVE_ACTIONS, keyLabel, PAD_ACTIONS, padLabel, padValue, parseKeys, parsePad, reservedKey, reservedPad, type KeyBinds, type PadBinds } from '../src/input/bindings';
import { HOLD_TO_BIND_MS, Input, type Heard, type SystemAction } from '../src/input/input';
import { neutralControls } from '../src/core/controls';
import { DEFAULT_SETTINGS, parseSettings, SETTINGS_KEY, SettingsStore, steerCurve } from '../src/settings';
import { driveLabels, hint, setDriveBinds } from '../src/ui/kit';
import { keysNote, keysSvg, padRows } from '../src/ui/keys';
import { fakeBrowser } from './fake-audio';

// Remapping (input/bindings.ts, docs/MENU.md "Controls"): the driving keys and pad buttons are the
// player's, set on the Controls tab and kept in the settings. The defaults are the controls as they
// always were, the menus' keys and buttons can't be taken, and the hints say what's bound.

let browser: ReturnType<typeof fakeBrowser>;
let input: Input;
const fired: SystemAction[] = [];
const nav = navigator as unknown as { getGamepads?: () => unknown[] };
const perf = performance as unknown as { now: () => number };
let wasPads: typeof nav.getGamepads;
let wasNow: () => number;
let now = 1000;
/** The fake pad: buttons down (with their values) and its axes. */
let down = new Map<number, number>();
let axes = [0, 0, 0, 0];
beforeEach(() => {
  browser = fakeBrowser();
  input = new Input();
  fired.length = 0;
  input.on((a) => fired.push(a));
  wasPads = nav.getGamepads;
  wasNow = perf.now;
  now = 1000;
  perf.now = () => now;
  down = new Map();
  axes = [0, 0, 0, 0];
  nav.getGamepads = () => [{ connected: true, mapping: 'standard', axes, buttons: Array.from({ length: 17 }, (_, k) => ({ pressed: down.has(k), value: down.get(k) ?? 0 })) }];
});
afterEach(() => {
  nav.getGamepads = wasPads;
  perf.now = wasNow;
  browser.window.fire('blur');
  browser.restore();
  setDriveBinds(DEFAULT_KEYS, DEFAULT_PAD);
});

const key = (type: 'keydown' | 'keyup', code: string, more: Record<string, unknown> = {}) => browser.window.fire(type, { code, key: code, repeat: false, metaKey: false, ctrlKey: false, altKey: false, target: null, preventDefault() {}, ...more });
const poll = () => input.poll(neutralControls(), 1 / 60);
/** Frames at 60 fps, the menu's polling (as while paused or over Settings). */
const frames = (ms: number) => {
  for (let t = 0; t < ms; t += 1000 / 60) {
    now += 1000 / 60;
    input.pollMenu();
  }
};

/** The keys as they were before remapping (input.ts's KEYS, 2026-10-16), by the action they drive. */
const OLD_KEYS: Record<string, string> = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'throttle', KeyW: 'throttle', ArrowDown: 'brake', KeyS: 'brake',
  Space: 'boost', ShiftLeft: 'drift', ShiftRight: 'drift', KeyR: 'reset', KeyC: 'look', KeyQ: 'look', KeyH: 'horn',
};

describe('the defaults are the controls as they were', () => {
  test('every old key is bound to its old action, and no other key is', () => {
    const now: Record<string, string> = {};
    for (const a of DRIVE_ACTIONS) for (const c of DEFAULT_KEYS[a]) if (c) now[c] = a;
    expect(now).toEqual(OLD_KEYS);
  });

  test('each old key drives what it did', () => {
    const read = { throttle: (c: ReturnType<typeof poll>) => c.throttle === 1, brake: (c: ReturnType<typeof poll>) => c.brake === 1, left: (c: ReturnType<typeof poll>) => c.steer < 0, right: (c: ReturnType<typeof poll>) => c.steer > 0, boost: (c: ReturnType<typeof poll>) => c.boost, drift: (c: ReturnType<typeof poll>) => c.drift, reset: (c: ReturnType<typeof poll>) => c.reset, look: (c: ReturnType<typeof poll>) => c.lookBack, horn: (c: ReturnType<typeof poll>) => c.horn };
    nav.getGamepads = () => [];
    for (const [code, action] of Object.entries(OLD_KEYS)) {
      browser.window.fire('blur');
      input.poll(neutralControls(), 1);
      key('keydown', code);
      expect([code, read[action as keyof typeof read](poll())]).toEqual([code, true]);
    }
  });

  test("a standard pad: RT and LT (analog), A boost, RB or X drift, B look back, Y reset, the stick's click the horn, the left stick steers on its old curve", () => {
    const at = (k: number, v = 1) => {
      down = new Map([[k, v]]);
      return poll();
    };
    expect(at(7, 0.6).throttle).toBe(0.6);
    expect(at(6, 0.3).brake).toBe(0.3);
    expect(at(0).boost).toBe(true);
    expect(at(5).drift).toBe(true);
    expect(at(2).drift).toBe(true);
    expect(at(1).lookBack).toBe(true);
    expect(at(3).reset).toBe(true);
    expect(at(10).horn).toBe(true);
    // Nothing else drives: the d-pad, the right stick's click, Select, Start, the bumper LB.
    for (const k of [4, 8, 9, 11, 12, 13, 14, 15]) {
      const c = at(k);
      expect([k, c.throttle, c.brake, c.boost, c.drift, c.lookBack, c.reset, c.horn]).toEqual([k, 0, 0, false, false, false, false, false]);
    }
    down = new Map();
    axes = [0.5, 0, 0, 0];
    expect(poll().steer).toBeCloseTo(((0.5 - 0.12) / 0.88) ** 1.4, 10);
    axes = [0.1, 0, 0, 0];
    expect(poll().steer).toBe(0);
  });

  test("the pad's options default to what Input always had: deadzone 0.12, rumble on, the stick to the power 1.4", () => {
    const c = DEFAULT_SETTINGS.controls;
    expect([c.deadzone, c.rumble, steerCurve(c.sensitivity)]).toEqual([input.deadZone, input.rumbleOn, input.steerCurve]);
    expect(steerCurve(c.sensitivity)).toBeCloseTo(1.4, 10);
  });
});

describe('a binding saves and loads', () => {
  const memory = () => {
    const kept = new Map<string, string>();
    return { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
  };

  test('keys, pad buttons and axes, and the options, are read back by the next page', () => {
    const storage = memory();
    const store = new SettingsStore(storage);
    const keys = assignKey(store.get().controls.keys, 'boost', 1, 'KeyB').binds;
    const pad = assignPad(assignPad(store.get().controls.pad, 'throttle', 1, { a: 5, dir: 1, rest: -1 }).binds, 'horn', 0, { b: 12 }).binds;
    store.set({ controls: { keys, pad, deadzone: 0.2, rumble: false, sensitivity: 0.9 } });
    const next = new SettingsStore(storage).get().controls;
    expect(next.keys.boost).toEqual(['Space', 'KeyB']);
    expect(next.pad.throttle).toEqual([{ b: 7 }, { a: 5, dir: 1, rest: -1 }]);
    expect(next.pad.horn).toEqual([{ b: 12 }, null]);
    expect([next.deadzone, next.rumble, next.sensitivity]).toEqual([0.2, false, 0.9]);
    // The rest are kept: the volumes, the graphics.
    expect(new SettingsStore(storage).get().volume).toEqual(DEFAULT_SETTINGS.volume);
  });

  test("an action missing from what's stored gets its default, but not a key the player gave another", () => {
    const keys = parseKeys({ ...DEFAULT_KEYS, reset: undefined, boost: ['KeyR', 'Space'] });
    expect(keys.boost).toEqual(['KeyR', 'Space']);
    expect(keys.reset).toEqual(['', '']);
    const pad = parsePad({ ...DEFAULT_PAD, drift: undefined, boost: [{ b: 5 }, null] });
    expect(pad.boost).toEqual([{ b: 5 }, null]);
    expect(pad.drift).toEqual([null, { b: 2 }]);
    // Still in the actions' order.
    expect(Object.keys(keys)).toEqual([...DRIVE_ACTIONS]);
  });

  test("the game's own keys can't be bound: the list input.ts routes is the list that's refused", () => {
    for (const c of Object.keys(GAME_KEYS)) expect([c, reservedKey(c)]).toEqual([c, true]);
    expect([browserKey('F5'), browserKey('F8'), browserKey('ControlLeft'), browserKey('KeyM')]).toEqual([true, false, true, false]);
  });

  test('a setting from before remapping (no controls) is the defaults', () => {
    const s = parseSettings(JSON.stringify({ volume: { master: 0.5 } }));
    expect(s.controls).toEqual(DEFAULT_SETTINGS.controls);
    expect(s.volume.master).toBe(0.5);
  });

  test("what's wrong in what's stored is none (or the default, for an action missing altogether); the rest is kept", () => {
    const keys = parseKeys({ throttle: ['KeyI', 'Escape'], brake: ['KeyK', 'KeyI'], left: 'KeyJ', boost: [42, '<b>'], horn: ['F5', 'KeyM'] });
    expect(keys.throttle).toEqual(['KeyI', '']); // Esc is the menu's
    expect(keys.brake).toEqual(['KeyK', '']); // KeyI is throttle's already
    expect(keys.left).toEqual(DEFAULT_KEYS.left); // not a pair
    expect(keys.boost).toEqual(['', '']);
    expect(keys.horn).toEqual(['', '']); // F5 and M are the game's
    expect(keys.right).toEqual(DEFAULT_KEYS.right);
    const pad = parsePad({ boost: [{ b: 9 }, { b: 3 }], reset: [{ b: 3 }, { a: 0, dir: 1, rest: 0 }], look: [{ a: 2, dir: 2 }, { b: 1.5 }], horn: [{ a: 3, dir: -1, rest: 7 }, null] });
    expect(pad.boost).toEqual([null, { b: 3 }]); // Start is the menu's
    expect(pad.reset).toEqual([null, null]); // Y is boost's already, the left stick steers
    expect(pad.look).toEqual([null, null]);
    expect(pad.horn).toEqual([{ a: 3, dir: -1, rest: 0 }, null]);
    for (const junk of [null, 'x', [], { throttle: null }, { __proto__: { throttle: ['KeyZ', ''] } }]) {
      expect(parseKeys(junk).brake).toEqual(DEFAULT_KEYS.brake);
      expect(parsePad(junk).brake).toEqual(DEFAULT_PAD.brake);
    }
    const s = parseSettings(JSON.stringify({ controls: { deadzone: 5, rumble: 'yes', sensitivity: -1 } }));
    expect([s.controls.deadzone, s.controls.rumble, s.controls.sensitivity]).toEqual([0.3, true, 0]);
  });

  test('Input drives from the bindings it is given: a moved key drives, its old one no longer does', () => {
    nav.getGamepads = () => [];
    const keys = assignKey(DEFAULT_KEYS, 'boost', 0, 'KeyJ').binds;
    input.setBindings(keys, DEFAULT_PAD);
    key('keydown', 'Space');
    expect(poll().boost).toBe(false);
    key('keydown', 'KeyJ');
    expect(poll().boost).toBe(true);
    // Let go of the old binding while held: it doesn't stick on.
    input.setBindings(DEFAULT_KEYS, DEFAULT_PAD);
    expect(poll().boost).toBe(false);
  });

  test('a pad trigger read as an axis (resting at -1) eases the throttle; the right stick can be a button', () => {
    const pad = assignPad(assignPad(DEFAULT_PAD, 'throttle', 0, { a: 5, dir: 1, rest: -1 }).binds, 'boost', 0, { a: 3, dir: -1, rest: 0 }).binds;
    input.setBindings(DEFAULT_KEYS, pad);
    axes = [0, 0, 0, 0, 0, -1];
    expect(poll().throttle).toBe(0);
    axes = [0, 0, 0, 0, 0, 0];
    expect(poll().throttle).toBe(0.5);
    axes = [0, 0, 0, -0.7, 0, 1];
    const c = poll();
    expect([c.throttle, c.boost]).toEqual([1, true]);
    expect(padValue({ buttons: [], axes: [0, 0, 0, 0.4] }, { a: 3, dir: -1, rest: 0 })).toBe(0);
  });

  test("the deadzone and the sensitivity set the stick: a wider deadzone ignores more, a higher sensitivity turns more for the same push", () => {
    axes = [0.15, 0, 0, 0];
    expect(poll().steer).toBeGreaterThan(0);
    input.deadZone = 0.2;
    expect(poll().steer).toBe(0);
    input.deadZone = 0.12;
    axes = [0.5, 0, 0, 0];
    const normal = poll().steer;
    input.steerCurve = steerCurve(1);
    expect(poll().steer).toBeGreaterThan(normal);
    input.steerCurve = steerCurve(0);
    expect(poll().steer).toBeLessThan(normal);
  });
});

describe('changing a binding: one another action has swaps over', () => {
  test("a key another action has: the two trade (it gets this one's)", () => {
    const { binds, moved } = assignKey(DEFAULT_KEYS, 'boost', 0, 'KeyR');
    expect(binds.boost).toEqual(['KeyR', '']);
    expect(binds.reset).toEqual(['Space', '']);
    expect(moved).toEqual({ action: 'reset', slot: 0, now: 'Space' });
    // The defaults themselves aren't changed.
    expect(DEFAULT_KEYS.boost).toEqual(['Space', '']);
  });

  test('into an empty slot, the other action gives it up (and may have none left)', () => {
    const { binds, moved } = assignKey(DEFAULT_KEYS, 'boost', 1, 'KeyH');
    expect(binds.boost).toEqual(['Space', 'KeyH']);
    expect(binds.horn).toEqual(['', '']);
    expect(moved).toEqual({ action: 'horn', slot: 0, now: '' });
  });

  test("an action's own other key: its two swap places", () => {
    const { binds } = assignKey(DEFAULT_KEYS, 'throttle', 0, 'ArrowUp');
    expect(binds.throttle).toEqual(['ArrowUp', 'KeyW']);
  });

  test('a pad button the same way; clearing one leaves the rest', () => {
    const { binds, moved } = assignPad(DEFAULT_PAD, 'boost', 0, { b: 3 });
    expect(binds.boost[0]).toEqual({ b: 3 });
    expect(binds.reset[0]).toEqual({ b: 0 });
    expect(moved?.action).toBe('reset');
    expect(assignPad(DEFAULT_PAD, 'drift', 1, null).binds.drift).toEqual([{ b: 5 }, null]);
    expect(assignKey(DEFAULT_KEYS, 'look', 1, '').binds.look).toEqual(['KeyQ', '']);
  });

  test('any run of changes keeps every key and button on one action at most', () => {
    let keys: KeyBinds = DEFAULT_KEYS;
    let pad: PadBinds = DEFAULT_PAD;
    let seed = 7;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    const codes = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyR', 'KeyQ', 'KeyC', 'KeyH', 'KeyJ', 'ArrowUp', 'ShiftLeft', ''];
    for (let k = 0; k < 2000; k++) {
      keys = assignKey(keys, DRIVE_ACTIONS[rand(DRIVE_ACTIONS.length)], rand(2) as 0 | 1, codes[rand(codes.length)]).binds;
      const b = rand(13);
      pad = assignPad(pad, PAD_ACTIONS[rand(PAD_ACTIONS.length)], rand(2) as 0 | 1, b === 12 ? null : { b }).binds;
      const ks = DRIVE_ACTIONS.flatMap((a) => keys[a]).filter(Boolean);
      const ps = PAD_ACTIONS.flatMap((a) => pad[a]).filter((p) => p).map((p) => JSON.stringify(p));
      expect(new Set(ks).size).toBe(ks.length);
      expect(new Set(ps).size).toBe(ps.length);
    }
    // And what that left is what loads back.
    expect(parseKeys(JSON.parse(JSON.stringify(keys)))).toEqual(keys);
    expect(parsePad(JSON.parse(JSON.stringify(pad)))).toEqual(pad);
  });
});

describe("the menus' keys and buttons can't be taken", () => {
  test('Esc, the F-keys, the dev and sound keys and the modifiers are the game\'s; driving keys and Shift are fine', () => {
    for (const c of ['Escape', 'F1', 'F2', 'F8', 'F12', 'Backquote', 'KeyM', 'KeyN', 'Minus', 'Equal', 'NumpadAdd', 'NumpadSubtract', 'MetaLeft', 'ControlLeft', 'AltRight', 'Tab']) expect([c, reservedKey(c)]).toEqual([c, true]);
    for (const c of ['KeyW', 'ArrowUp', 'Space', 'ShiftLeft', 'KeyF', 'Enter', 'Digit1']) expect([c, reservedKey(c)]).toEqual([c, false]);
    for (const b of [8, 9, 16]) expect(reservedPad({ b })).toBe(true);
    for (const a of [0, 1]) expect(reservedPad({ a, dir: 1, rest: 0 })).toBe(true);
    for (const b of [0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15]) expect(reservedPad({ b })).toBe(false);
  });

  test("listening: Start and the left stick are refused (and it listens on), with nothing paused or moved; another press is the binding", () => {
    const heard: Heard[] = [];
    input.menuOpen = true;
    input.listen('pad', (h) => heard.push(h));
    down.set(9, 1);
    frames(50);
    down.clear();
    axes = [0.9, 0, 0, 0];
    frames(50);
    axes = [0, 0, 0, 0];
    frames(50);
    down.set(13, 1);
    frames(50);
    expect(heard).toEqual([{ reserved: 'b9' }, { reserved: 'a0' }, { pad: { b: 13 } }]);
    expect(fired).toEqual([]);
    expect(input.isListening).toBe(false);
    // Listening done, the held d-pad isn't a fresh press.
    frames(50);
    expect(fired).toEqual([]);
  });

  test('listening for a key: Esc cancels, a system key or a shortcut is refused, the button that started it (held) is not a press', () => {
    const heard: Heard[] = [];
    input.menuOpen = true;
    down.set(0, 1);
    input.listen('key', (h) => heard.push(h));
    frames(50);
    key('keydown', 'KeyM');
    key('keydown', 'KeyK', { ctrlKey: true });
    key('keydown', 'Escape');
    expect(heard).toEqual([{ reserved: 'KeyM' }, { reserved: 'mod' }, { cancel: true }]);
    // No mute, no back: those were the listening's.
    expect(fired).toEqual([]);
  });

  test("the pad's B pressed and let go cancels; held, it's the binding", () => {
    const heard: Heard[] = [];
    input.menuOpen = true;
    input.listen('pad', (h) => heard.push(h));
    down.set(1, 1);
    frames(100);
    down.clear();
    frames(20);
    expect(heard).toEqual([{ cancel: true }]);
    input.listen('pad', (h) => heard.push(h));
    down.set(1, 1);
    frames(HOLD_TO_BIND_MS + 50);
    expect(heard.at(-1)).toEqual({ pad: { b: 1 } });
    down.clear();
    frames(50);
    expect(fired).toEqual([]);
  });

  test('an axis is heard once let go, resting where it comes back to: a trigger at -1 (even one that read 0 untouched), a stick in the middle', () => {
    const heard: Heard[] = [];
    // Untouched, as some browsers report a trigger till it's moved: 0.
    axes = [0, 0, 0, 0, 0, 0];
    input.listen('pad', (h) => heard.push(h));
    axes = [0, 0, 0, 0, 0, 0.8];
    frames(20);
    expect(heard).toEqual([]);
    axes = [0, 0, 0, 0, 0, -1];
    frames(20);
    expect(heard).toEqual([{ pad: { a: 5, dir: 1, rest: -1 } }]);
    input.listen('pad', (h) => heard.push(h));
    axes = [0, 0, 0, -0.9, 0, -1];
    frames(20);
    axes = [0, 0, 0, 0.05, 0, -1];
    frames(20);
    expect(heard.at(-1)).toEqual({ pad: { a: 3, dir: -1, rest: 0 } });
  });

  test("a trigger bound as an axis is at rest till it's first moved on the page (it reads 0, not halfway)", () => {
    input.setBindings(DEFAULT_KEYS, assignPad(DEFAULT_PAD, 'throttle', 0, { a: 5, dir: 1, rest: -1 }).binds);
    axes = [0, 0, 0, 0, 0, 0];
    expect(poll().throttle).toBe(0);
    axes = [0, 0, 0, 0, 0, -1];
    expect(poll().throttle).toBe(0);
    axes = [0, 0, 0, 0, 0, 0];
    expect(poll().throttle).toBe(0.5);
  });

  test("while listening, the browser's keys and shortcuts keep their default (F5, Ctrl+R), refused; a key set is swallowed till it's let go (Enter held doesn't press the cell again)", () => {
    const heard: Heard[] = [];
    input.menuOpen = true;
    input.listen('key', (h) => heard.push(h));
    const prevented: string[] = [];
    const press = (type: 'keydown' | 'keyup', code: string, more: Record<string, unknown> = {}) => key(type, code, { preventDefault: () => prevented.push(`${type} ${code}`), ...more });
    press('keydown', 'F5');
    press('keydown', 'KeyR', { ctrlKey: true });
    press('keydown', 'Tab');
    expect(heard).toEqual([{ reserved: 'F5' }, { reserved: 'mod' }, { reserved: 'Tab' }]);
    expect(prevented).toEqual([]);
    press('keydown', 'Enter');
    press('keydown', 'Enter', { repeat: true });
    press('keydown', 'Enter', { repeat: true });
    press('keyup', 'Enter');
    expect(heard.at(-1)).toEqual({ key: 'Enter' });
    expect(prevented).toEqual(['keydown Enter', 'keydown Enter', 'keydown Enter', 'keyup Enter']);
    // Let go, Enter is the menu's again (the page's: it presses the focused button).
    press('keydown', 'Enter');
    expect(prevented.length).toBe(4);
  });

  test("whatever the bindings, the menu's buttons still move, press, back out and pause", () => {
    // Every pad action moved onto the menus' own buttons (A, B, Y, the d-pad, the bumpers).
    const pad = { throttle: [{ b: 12 }, null], brake: [{ b: 13 }, null], drift: [{ b: 4 }, { b: 14 }], boost: [{ b: 1 }, null], reset: [{ b: 0 }, null], look: [{ b: 3 }, null], horn: [{ b: 15 }, null] } as PadBinds;
    const keys = { ...DEFAULT_KEYS, throttle: ['ArrowDown', 'Enter'], brake: ['ArrowUp', 'KeyE'], reset: ['KeyQ', ''], look: ['KeyR', ''] } as KeyBinds;
    input.setBindings(keys, pad);
    input.menuOpen = true;
    for (const [k, a] of [[0, 'accept'], [1, 'back'], [3, 'alt'], [12, 'nav-up'], [13, 'nav-down'], [14, 'nav-left'], [15, 'nav-right'], [4, 'pick-left'], [5, 'pick-right'], [9, 'pause']] as const) {
      fired.length = 0;
      down = new Map([[k, 1]]);
      frames(20);
      down.clear();
      frames(20);
      expect([k, fired]).toEqual([k, [a]]);
    }
    fired.length = 0;
    for (const c of ['ArrowUp', 'ArrowDown', 'KeyQ', 'KeyE', 'KeyR', 'Escape']) key('keydown', c);
    expect(fired).toEqual(['nav-up', 'nav-down', 'tab-prev', 'tab-next', 'alt', 'pause']);
  });
});

describe('the hints follow the bindings', () => {
  test("by default they're as they were: Shift and RB to drift, Space and A to boost", () => {
    expect(hint('drift', 'Drift')).toContain('>Shift<');
    expect(hint('drift', 'Drift')).toContain('>RB<');
    expect(hint('boost', '')).toContain('>Space<');
    expect(hint('boost', '')).toContain('>A<');
    expect(keysNote()).toBe('The arrows drive too. R puts you back on the road, Esc is the menu.');
    expect(keysSvg()).toContain('aria-label="W accelerates, A and D steer, S brakes and reverses, Shift drifts, Space boosts"');
  });

  test('moved, the menu hints, the keys card and its pad rows say the new ones', () => {
    const keys = assignKey(assignKey(DEFAULT_KEYS, 'drift', 0, 'KeyF').binds, 'reset', 0, 'KeyT').binds;
    const pad = assignPad(DEFAULT_PAD, 'boost', 0, { b: 11 }).binds;
    setDriveBinds(keys, pad);
    const h = hint('drift', 'Drift');
    expect(h).toContain('>F<');
    expect(h).not.toContain('>Shift<');
    expect(hint('boost', '')).toContain('>R3<');
    expect(keysSvg(keys)).toContain('F drifts');
    expect(keysNote(keys)).toBe('The arrows drive too. T puts you back on the road, Esc is the menu.');
    expect(padRows(pad).find(([, job]) => job === 'Boost')?.[0]).toContain('Right stick click');
  });

  test('an action with nothing bound says none', () => {
    setDriveBinds(assignKey(assignKey(DEFAULT_KEYS, 'boost', 0, '').binds, 'boost', 1, '').binds, DEFAULT_PAD);
    expect(hint('boost', '')).toContain('none');
  });

  test("the Controls table's names: keys by their cap, pad buttons by a standard pad's names, axes by their way", () => {
    expect(['KeyW', 'ArrowLeft', 'ShiftLeft', 'Space', 'Digit3', 'Numpad4', 'Semicolon'].map(keyLabel)).toEqual(['W', '←', 'Shift', 'Space', '3', 'Num 4', ';']);
    expect([{ b: 0 }, { b: 7 }, { b: 10 }, { b: 13 }, { b: 20 }].map((p) => padLabel(p))).toEqual(['A', 'RT', 'Left stick click', 'D-pad ↓', 'Button 20']);
    expect(padLabel({ a: 3, dir: -1, rest: 0 })).toBe('Right stick ↑');
    expect(padLabel({ a: 5, dir: 1, rest: -1 })).toBe('Axis 5+');
    const l = driveLabels(DEFAULT_KEYS, DEFAULT_PAD);
    expect([l.kb.look, l.pad.drift, l.pad.left]).toEqual([['Q', 'C'], ['RB', 'X'], ['Left stick']]);
  });
});

test("reading what was stored doesn't change it: the defaults load as the defaults", () => {
  expect(parseSettings(JSON.stringify(DEFAULT_SETTINGS))).toEqual(DEFAULT_SETTINGS);
  expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  expect(SETTINGS_KEY).toBe('racecar.settings');
});

test('whatever the bindings, options and pad, the controls are finite and in range', () => {
  let seed = 11;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const junk = [undefined, null, 'x', -1, 0, 0.5, 1, 2, 1e999, -1e999, [], {}];
  for (let k = 0; k < 3000; k++) {
    // Settings as stored by anything (parseSettings is what main.ts hands Input).
    const s = parseSettings(JSON.stringify({ controls: { deadzone: pick(junk), sensitivity: pick(junk), pad: { throttle: [pick([{ b: 7 }, { a: Math.floor(rand() * 8), dir: pick([1, -1]), rest: pick([-1, 0, 1, 7]) }, null])], boost: [pick([{ b: Math.floor(rand() * 20) }, { a: 3, dir: 1, rest: 0 }])] } } })).controls;
    input.setBindings(s.keys, s.pad);
    input.deadZone = s.deadzone;
    input.steerCurve = steerCurve(s.sensitivity);
    // A pad with fewer axes or buttons than bound, values missing or past their ends.
    const n = Math.floor(rand() * 18);
    axes = Array.from({ length: Math.floor(rand() * 8) }, () => rand() * 2.4 - 1.2);
    const buttons = Array.from({ length: n }, () => (rand() < 0.3 ? { pressed: rand() < 0.5 } : { pressed: rand() < 0.5, value: rand() * 1.2 }));
    nav.getGamepads = () => [{ connected: true, mapping: pick(['standard', '']), axes, buttons }];
    const c = input.poll(neutralControls(), rand() * 0.1);
    for (const v of [c.steer, c.throttle, c.brake]) expect(Number.isFinite(v)).toBe(true);
    expect(Math.abs(c.steer)).toBeLessThanOrEqual(1);
    expect(c.throttle).toBeGreaterThanOrEqual(0);
    expect(c.brake).toBeGreaterThanOrEqual(0);
  }
});
