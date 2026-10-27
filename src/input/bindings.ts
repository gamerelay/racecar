// The driving controls' bindings (docs/MENU.md, "Controls"): which keys and pad buttons drive, set
// on the Controls tab and kept in the settings. Each action has two of each, a primary and an
// alternate (WASD and the arrows; the pad's RB and X for drift). The left stick always steers, and
// what moves through the menus (the arrows, WASD, Enter, Esc; the pad's d-pad, A, B, Y, the bumpers
// and Start) isn't here at all: it's fixed in input.ts, so no binding can lock a menu.
//
// Pure: the defaults, the labels, reading what was stored and changing one binding (a key or button
// another action has swaps over to it).

/** The driving actions. The pad has no left and right: the left stick steers. */
export type DriveAction = 'throttle' | 'brake' | 'left' | 'right' | 'drift' | 'boost' | 'reset' | 'look' | 'horn';
export type PadAction = Exclude<DriveAction, 'left' | 'right'>;

export const DRIVE_ACTIONS: readonly DriveAction[] = ['throttle', 'brake', 'left', 'right', 'drift', 'boost', 'reset', 'look', 'horn'];
export const PAD_ACTIONS: readonly PadAction[] = ['throttle', 'brake', 'drift', 'boost', 'reset', 'look', 'horn'];

export const ACTION_NAMES: Record<DriveAction, string> = {
  throttle: 'Accelerate',
  brake: 'Brake, reverse',
  left: 'Steer left',
  right: 'Steer right',
  drift: 'Drift',
  boost: 'Boost',
  reset: 'Reset to road',
  look: 'Look back',
  horn: 'Horn',
};

/**
 * A pad binding: a button (its value is the analog one, so a trigger read as a button still eases
 * the throttle), or an axis pushed one way from where it rests (a trigger some pads report as an
 * axis, resting at -1; or the right stick, resting at 0).
 */
export type PadBind = { b: number } | { a: number; dir: 1 | -1; rest: number };

/** Two per action: the primary and the alternate. '' and null are none. */
export type KeyBinds = Record<DriveAction, [string, string]>;
export type PadBinds = Record<PadAction, [PadBind | null, PadBind | null]>;

/** Today's keys: WASD and the arrows, Shift drifts, Space boosts, R resets, Q or C looks back, H. */
export const DEFAULT_KEYS: KeyBinds = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  drift: ['ShiftLeft', 'ShiftRight'],
  boost: ['Space', ''],
  reset: ['KeyR', ''],
  look: ['KeyQ', 'KeyC'],
  horn: ['KeyH', ''],
};

/** A standard-mapping pad, as it always was: RT and LT, A boost, RB or X drift, Y reset, B look back, the left stick's click the horn. */
export const DEFAULT_PAD: PadBinds = {
  throttle: [{ b: 7 }, null],
  brake: [{ b: 6 }, null],
  drift: [{ b: 5 }, { b: 2 }],
  boost: [{ b: 0 }, null],
  reset: [{ b: 3 }, null],
  look: [{ b: 1 }, null],
  horn: [{ b: 10 }, null],
};

/**
 * The game's own keys (input.ts routes them, before any driving key): Esc (the menu), F8 (felt
 * wrong), the dev keys (` F2 F4 F6), the sound keys (M, N, − and +). The one list: input.ts's
 * SYSTEM is this, so a key added here can't also be bound.
 */
export const GAME_KEYS = {
  Escape: 'pause',
  F8: 'report',
  Backquote: 'editor',
  F2: 'debug',
  F4: 'tuning',
  F6: 'ink',
  KeyM: 'mute',
  KeyN: 'music',
  // - and + (= unshifted, and the keypad's): the previous or next track.
  Minus: 'track-prev',
  NumpadSubtract: 'track-prev',
  Equal: 'track-next',
  NumpadAdd: 'track-next',
} as const;

/**
 * The browser's and the system's: the modifiers (Cmd, Ctrl and Alt make a key a shortcut, and a key
 * held with them never drives), Tab, Caps Lock, the menu key, and every F-key. Shift is fine: it drifts.
 */
const BROWSER_KEYS = new Set(['MetaLeft', 'MetaRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'OSLeft', 'OSRight', 'ContextMenu', 'CapsLock', 'Tab', 'Fn', 'FnLock']);
export const browserKey = (code: string): boolean => BROWSER_KEYS.has(code) || (/^F\d+$/.test(code) && !Object.hasOwn(GAME_KEYS, code));
/** Keys that aren't the driving's to take: the game's own, and the browser's. */
export const reservedKey = (code: string): boolean => Object.hasOwn(GAME_KEYS, code) || browserKey(code);

/** Standard-mapping buttons. */
export const PAD_A = 0;
export const PAD_B = 1;
export const PAD_SELECT = 8;
export const PAD_START = 9;
export const PAD_GUIDE = 16;
/**
 * Pad buttons that aren't the driving's: Start (the menu), Select (with Start, "felt wrong") and
 * the guide button (the system's). The left stick's axes (0 and 1) steer.
 */
export const reservedPad = (p: PadBind): boolean => ('b' in p ? p.b === PAD_START || p.b === PAD_SELECT || p.b === PAD_GUIDE : p.a < 2);

const KEY_LABELS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
  ShiftLeft: 'Shift',
  ShiftRight: 'R Shift',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Del',
  Insert: 'Ins',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  IntlBackslash: '§',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .',
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl',
  AltLeft: 'Alt',
  AltRight: 'Alt',
  MetaLeft: 'Cmd',
  MetaRight: 'Cmd',
  CapsLock: 'Caps Lock',
  Backquote: '`',
  Minus: '−',
  Equal: '+',
  Escape: 'Esc',
};

/** A key's cap, from its code (the US layout's: the code is where the key is, not what it types). */
export function keyLabel(code: string): string {
  if (!code) return '';
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  const m = /^(?:Key|Digit)(.)$/.exec(code) ?? /^Numpad(\d)$/.exec(code);
  if (m) return code.startsWith('Numpad') ? `Num ${m[1]}` : m[1];
  return code;
}

const PAD_LABELS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Select', 'Start', 'Left stick click', 'Right stick click', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Guide'];

/** A pad binding's name, as a standard pad's buttons are named (another pad's are numbered). */
export function padLabel(p: PadBind | null, standard = true): string {
  if (!p) return '';
  if ('b' in p) return standard && PAD_LABELS[p.b] ? PAD_LABELS[p.b] : `Button ${p.b}`;
  if (standard && (p.a === 2 || p.a === 3)) return `Right stick ${p.a === 2 ? (p.dir > 0 ? '→' : '←') : p.dir > 0 ? '↓' : '↑'}`;
  return `Axis ${p.a}${p.dir > 0 ? '+' : '−'}`;
}

export const samePad = (x: PadBind | null, y: PadBind | null): boolean =>
  !!x && !!y && ('b' in x ? 'b' in y && x.b === y.b : 'a' in y && x.a === y.a && x.dir === y.dir);

/** What a change moved: the action that had the key or button, the slot, and what it has there now. */
export interface Moved<T> {
  action: DriveAction;
  slot: 0 | 1;
  now: T;
}

/**
 * Binds `value` to `action`'s `slot`. If another action (or this one's other slot) has it, the two
 * swap: it gets what this slot had (which may be none). Returns the new bindings and what moved.
 */
export function assign<A extends DriveAction, T>(binds: Record<A, [T, T]>, action: A, slot: 0 | 1, value: T, same: (x: T, y: T) => boolean, none: T): { binds: Record<A, [T, T]>; moved: Moved<T> | null } {
  const next = Object.fromEntries(Object.entries(binds).map(([k, v]) => [k, [...(v as [T, T])]])) as Record<A, [T, T]>;
  const was = next[action][slot];
  let moved: Moved<T> | null = null;
  if (!isNone(value, none)) {
    for (const a of Object.keys(next) as A[])
      for (const s of [0, 1] as const)
        if ((a !== action || s !== slot) && same(next[a][s], value)) {
          next[a][s] = was;
          moved = { action: a, slot: s, now: was };
        }
  }
  next[action][slot] = value;
  return { binds: next, moved };
}

const isNone = <T>(v: T, none: T) => v === none || v === null || v === '';

export const assignKey = (binds: KeyBinds, action: DriveAction, slot: 0 | 1, code: string) => assign(binds, action, slot, code, (x, y) => !!x && x === y, '');
export const assignPad = (binds: PadBinds, action: PadAction, slot: 0 | 1, p: PadBind | null) => assign(binds, action, slot, p, samePad, null);

// ---- reading what was stored ----

const KEY_CODE = /^[A-Za-z][A-Za-z0-9]{0,23}$/;

/**
 * Reads stored bindings (`read` makes one stored value good, or none). The stored ones first, so an
 * action missing altogether (its default) doesn't take a key the player gave another; a repeat is none.
 */
function parseBinds<A extends string, T>(v: unknown, actions: readonly A[], defaults: Record<A, [T, T]>, read: (x: unknown) => T, none: T, same: (x: T, y: T) => boolean): Record<A, [T, T]> {
  const s = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out = {} as Record<A, [T, T]>;
  const seen: T[] = [];
  const take = (x: T) => {
    if (x === none || seen.some((y) => same(x, y))) return none;
    seen.push(x);
    return x;
  };
  const stored = (a: A) => Object.hasOwn(s, a) && Array.isArray(s[a]);
  for (const a of actions) if (stored(a)) out[a] = [take(read((s[a] as unknown[])[0])), take(read((s[a] as unknown[])[1]))];
  for (const a of actions) if (!stored(a)) out[a] = [take(defaults[a][0]), take(defaults[a][1])];
  // In the actions' order, as the defaults are.
  return Object.fromEntries(actions.map((a) => [a, out[a]])) as Record<A, [T, T]>;
}

/** Stored keys: a bad, a system or a repeated one is none; an action missing altogether is its default. */
export const parseKeys = (v: unknown): KeyBinds =>
  parseBinds(v, DRIVE_ACTIONS, DEFAULT_KEYS, (c) => (typeof c === 'string' && KEY_CODE.test(c) && !reservedKey(c) ? c : ''), '', (x, y) => x === y);

const int = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < max;

function parsePadBind(v: unknown): PadBind | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  let p: PadBind | null = null;
  if (int(o.b, 32)) p = { b: o.b };
  else if (int(o.a, 16) && (o.dir === 1 || o.dir === -1)) p = { a: o.a, dir: o.dir, rest: o.rest === -1 || o.rest === 1 ? o.rest : 0 };
  return p && !reservedPad(p) ? p : null;
}

/** Stored pad bindings, the same way as the keys. */
export const parsePad = (v: unknown): PadBinds => parseBinds<PadAction, PadBind | null>(v, PAD_ACTIONS, DEFAULT_PAD, parsePadBind, null, samePad);

/**
 * How far a pad binding is pushed, 0 to 1: a button's value (a trigger's is analog), or an axis's
 * way from where it rests. `live`: whether that axis has moved yet on this page. Some browsers
 * report a trigger as 0 until it's first touched, then -1 at rest: untouched, a trigger (resting
 * at an end) is at rest, not halfway.
 */
export function padValue(pad: Pick<Gamepad, 'buttons' | 'axes'>, p: PadBind | null, live = true): number {
  if (!p) return 0;
  if ('a' in p && p.rest !== 0 && !live) return 0;
  if ('b' in p) {
    const b = pad.buttons[p.b];
    return b ? (typeof b.value === 'number' ? b.value : b.pressed ? 1 : 0) : 0;
  }
  const v = pad.axes[p.a] ?? p.rest;
  const span = p.dir > 0 ? 1 - p.rest : 1 + p.rest;
  return span > 0 ? Math.min(1, Math.max(0, ((v - p.rest) * p.dir) / span)) : 0;
}

/** Whether a pad binding is down: a button pressed, an axis past halfway. */
export function padDown(pad: Pick<Gamepad, 'buttons' | 'axes'>, p: PadBind | null, live = true): boolean {
  if (!p) return false;
  if ('b' in p) return pad.buttons[p.b]?.pressed ?? false;
  return padValue(pad, p, live) > 0.5;
}
