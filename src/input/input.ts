// Keyboard and gamepads → one Controls object (SPEC §13). The driving keys and pad buttons are the
// player's (bindings.ts, set on the Controls tab); by default a standard-mapping pad's left stick
// steers, RT/LT throttle and brake, A boost, RB (or X) drift, B look back, Y reset. Start pauses and
// Select+Start is "something felt wrong", always. Keyboard steering starts at KEY_ONSET and eases
// in and out from there, so it isn't all-or-nothing.
//
// The menus' keys and buttons are fixed (MENU_KEYS, PAD_NAV, A, B, Y, Start), whatever the
// bindings, so no binding can lock you out of a menu.

import type { Controls } from '../core/controls';
import { approach, clamp } from '../core/math';
import { TUNING } from '../core/car/tuning';
import { DEFAULT_KEYS, DEFAULT_PAD, GAME_KEYS, PAD_ACTIONS, PAD_B, padDown, padValue, reservedKey, reservedPad, type DriveAction, type KeyBinds, type PadBind, type PadBinds } from './bindings';

export type SystemAction = 'pause' | 'report' | 'editor' | 'debug' | 'tuning' | 'ink' | 'mute' | 'music' | 'track-prev' | 'track-next' | MenuAction;
/**
 * In a menu (menuOpen): move focus, press the focused control, or back out. WASD (and the pad's
 * bumpers) pick: in the lobby they cycle your car and paint, and elsewhere they move focus too.
 * Q and E switch a panel's tabs (the pad's bumpers do, there); R (the pad's Y) is a screen's own
 * extra (Refresh, in the lobby list). Backspace or Delete (the pad's X) clears a binding on the
 * Controls tab.
 */
export type MenuAction = 'nav-up' | 'nav-down' | 'nav-left' | 'nav-right' | 'pick-up' | 'pick-down' | 'pick-left' | 'pick-right' | 'tab-prev' | 'tab-next' | 'alt' | 'clear' | 'accept' | 'back';

const MENU_KEYS: Record<string, MenuAction> = {
  ArrowUp: 'nav-up',
  ArrowDown: 'nav-down',
  ArrowLeft: 'nav-left',
  ArrowRight: 'nav-right',
  KeyW: 'pick-up',
  KeyS: 'pick-down',
  KeyA: 'pick-left',
  KeyD: 'pick-right',
  KeyQ: 'tab-prev',
  KeyE: 'tab-next',
  KeyR: 'alt',
  Backspace: 'clear',
  Delete: 'clear',
};
/** Every menu action, for checks like the keys card's that take any of them (the Record keeps it whole). */
const MENU_ACTIONS: Record<MenuAction, true> = {
  'nav-up': true,
  'nav-down': true,
  'nav-left': true,
  'nav-right': true,
  'pick-up': true,
  'pick-down': true,
  'pick-left': true,
  'pick-right': true,
  'tab-prev': true,
  'tab-next': true,
  alt: true,
  clear: true,
  accept: true,
  back: true,
};
export const isMenuAction = (a: string): a is MenuAction => Object.hasOwn(MENU_ACTIONS, a);
/** Standard-mapping d-pad buttons, and LB and RB. */
const PAD_NAV: [number, MenuAction][] = [[12, 'nav-up'], [13, 'nav-down'], [14, 'nav-left'], [15, 'nav-right'], [4, 'pick-left'], [5, 'pick-right']];
/** A d-pad button or the stick held over in a menu moves again after this (ms), then every REPEAT_MS. */
const REPEAT_DELAY_MS = 380;
const REPEAT_MS = 95;

/** The driving keys held now (by action: two keys on one action are either). */
const held = new Map<string, DriveAction>();
const holding = (a: DriveAction) => {
  for (const v of held.values()) if (v === a) return true;
  return false;
};

/** A pad button held this long while listening is bound, not a cancel (B cancels with a press). */
export const HOLD_TO_BIND_MS = 600;

/**
 * What a press was while listening for a binding (Input.listen). `reserved` is the key's code, a pad
 * button ("b9") or axis ("a0"), or "mod": a key held with Cmd, Ctrl or Alt.
 */
export type Heard = { key: string } | { pad: PadBind } | { cancel: true } | { reserved: string };

/** The game's own keys (bindings.ts: the same list says they can't be bound). */
const SYSTEM: Record<string, SystemAction> = GAME_KEYS;

/** A key the game's own handler routes (a system key, or a menu's), so others leave it to it. */
export function routedKey(code: string): boolean {
  return Object.hasOwn(SYSTEM, code) || Object.hasOwn(MENU_KEYS, code);
}

export type InputDevice = 'keyboard' | 'gamepad' | 'touch';

/** The device used last, kept for the tab: a race is a page load, and its hints should be the menu's. */
const DEVICE_KEY = 'racecar.device';
function keptDevice(): InputDevice {
  try {
    const d = sessionStorage.getItem(DEVICE_KEY);
    return d === 'gamepad' || d === 'touch' ? d : 'keyboard';
  } catch {
    return 'keyboard';
  }
}

/**
 * A steer key from straight starts the steer here, then eases on to full lock (7/s: about 100 ms).
 * Eased from 0 at 4.5/s, the Brute at 140 km/h took 10 ticks to turn 3°, a pad's full lock 5 (the
 * owner, 2026-10-14: "a slight initial delay"). Under cruiseSteer, so a one-frame tap keeps the
 * straight-line build climbing (a longer one fades it from its second frame, as any steer past it does).
 */
export const KEY_ONSET = 0.3;

export class Input {
  private keySteer = 0;
  private keyMap = new Map<string, DriveAction>();
  private padBinds: PadBinds = DEFAULT_PAD;
  /** The stick's curve: steer is the stick to this power. */
  steerCurve = 1.4;
  /** Listening for a binding (the Controls tab): the next key or pad press goes to `fn`, and nothing else. */
  private listening: { kind: 'key' | 'pad'; fn: (h: Heard) => void; base: number[]; bAt: number; stickSaid: boolean; axis: { a: number; dir: 1 | -1 } | null } | null = null;
  /** The key just heard as a binding: its repeats and its keyup are swallowed (Enter held would press the cell again). */
  private heardKey = '';
  /** The pad's axes that have moved on this page (an untouched trigger reads 0 in some browsers, -1 once touched). */
  private axisLive: boolean[] = [];
  private readonly listeners: ((a: SystemAction) => void)[] = [];
  private prevButtons: boolean[] = [];
  private device: InputDevice = keptDevice();
  private readonly deviceListeners: ((d: InputDevice) => void)[] = [];
  deadZone = 0.12;
  rumbleOn = true;
  /** Set while a text field has focus, so typing doesn't drive. */
  suspended = false;
  /** A menu is up: arrows and the d-pad move focus, A presses, B backs out. */
  menuOpen = false;
  /**
   * Your car could start a drift now (not drifting, fast enough, off its cooldown: main.ts sets it
   * each frame). Then, with drift held, a steer key goes straight to the drift's threshold.
   */
  readyToDrift = false;
  /** When the stick (or a d-pad button) moves menu focus again while held, and which way it's held. */
  private stickNavAt = 0;
  private stickDir: MenuAction | null = null;
  private padNavAt: number[] = [];

  constructor() {
    this.setBindings(DEFAULT_KEYS, DEFAULT_PAD);
    window.addEventListener('keydown', (e) => {
      if (this.listening) return this.hearKey(e);
      if (e.code === this.heardKey) return e.preventDefault();
      // Browser and OS shortcuts (Cmd+R, Ctrl+Tab…) are theirs, not a reset or a steer.
      // Esc still backs out of a menu from its text fields (the lobby list's search, a name).
      const typing = isTyping(e, this.menuOpen) && !(this.menuOpen && e.code === 'Escape');
      if (this.suspended || typing || e.metaKey || e.ctrlKey || e.altKey) return;
      this.lastDevice = 'keyboard';
      if (this.menuOpen && MENU_KEYS[e.code]) {
        e.preventDefault();
        this.fire(MENU_KEYS[e.code]);
        return;
      }
      const sys = SYSTEM[e.code];
      if (sys && !e.repeat) {
        e.preventDefault();
        this.fire(sys);
        return;
      }
      // In a menu, the rest are the page's: Space and Enter press the focused button.
      if (this.menuOpen) return;
      const k = this.keyMap.get(e.code);
      if (k) {
        held.set(e.code, k);
        e.preventDefault();
      }
    });
    const release = () => {
      held.clear();
      this.heardKey = '';
    };
    window.addEventListener('keyup', (e) => {
      held.delete(e.code);
      if (e.code === this.heardKey) {
        // Not Space's click on the cell as it comes up.
        e.preventDefault();
        this.heardKey = '';
      }
      // macOS sends no keyup for keys let go while Cmd was down: drop everything with it.
      if (e.key === 'Meta') release();
    });
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', release);
  }

  /** The driving keys and pad buttons (bindings.ts). A key held under its old binding is let go. */
  setBindings(keys: KeyBinds, pad: PadBinds): void {
    this.keyMap = new Map();
    for (const [a, codes] of Object.entries(keys) as [DriveAction, [string, string]][]) for (const c of codes) if (c && !reservedKey(c)) this.keyMap.set(c, a);
    for (const [c, a] of held) if (this.keyMap.get(c) !== a) held.delete(c);
    this.padBinds = pad;
  }

  /**
   * Listens for a binding: the next key (`key`) or pad button or axis (`pad`) goes to `fn`, and
   * nothing else happens with it (no menu move, no pause). Esc, or the pad's B pressed and let go,
   * cancels; B held (HOLD_TO_BIND_MS) is bound. A key or button that isn't the driving's (Esc's
   * F-keys, Start) is `reserved`, and it goes on listening. The pad's buttons down now don't count.
   */
  listen(kind: 'key' | 'pad', fn: (h: Heard) => void): void {
    this.settleButtons();
    const pad = this.pad();
    this.listening = { kind, fn, base: pad ? [...pad.axes] : [], bAt: -1, stickSaid: false, axis: null };
  }

  /** Stops listening (the panel closed under it). */
  stopListening(): void {
    this.listening = null;
  }

  get isListening(): boolean {
    return !!this.listening;
  }

  private heard(h: Heard): void {
    const l = this.listening;
    if (!l) return;
    if (!('reserved' in h)) this.listening = null;
    l.fn(h);
  }

  private hearKey(e: KeyboardEvent): void {
    this.lastDevice = 'keyboard';
    if (e.code === 'Escape') {
      e.preventDefault();
      return this.heard({ cancel: true });
    }
    // The browser's keys and shortcuts still do their thing (F5, Cmd+R, F12): they're only refused.
    if (e.repeat || this.listening?.kind !== 'key') return;
    if (reservedKey(e.code)) return this.heard({ reserved: e.code });
    // A key with Cmd, Ctrl or Alt down is a shortcut, and never drives.
    if (e.metaKey || e.ctrlKey || e.altKey) return this.heard({ reserved: 'mod' });
    e.preventDefault();
    this.heardKey = e.code;
    this.heard({ key: e.code });
  }

  /** The pad while listening: a new press (or an axis pushed past halfway from where it rested) is the binding. */
  private hearPad(pad: Gamepad): void {
    const l = this.listening!;
    const b = (k: number) => pad.buttons[k]?.pressed ?? false;
    const pressed = (k: number) => b(k) && !this.prevButtons[k];
    const now = performance.now();
    if (pressed(PAD_B)) l.bAt = now;
    if (l.bAt >= 0 && !b(PAD_B)) {
      // B let go before it's held long enough: a cancel (either way of listening).
      return this.heard({ cancel: true });
    }
    if (l.kind !== 'pad') return;
    if (l.bAt >= 0 && now - l.bAt >= HOLD_TO_BIND_MS) return this.heard({ pad: { b: PAD_B } });
    for (let k = 0; k < pad.buttons.length; k++) {
      if (k === PAD_B || !pressed(k)) continue;
      const p = { b: k };
      return this.heard(reservedPad(p) ? { reserved: `b${k}` } : { pad: p });
    }
    // The left stick steers: said once a push, not every frame it's held over or on its way back.
    const stick = Math.max(Math.abs(pad.axes[0] ?? 0), Math.abs(pad.axes[1] ?? 0));
    if (stick > 0.6 && !l.stickSaid) {
      l.stickSaid = true;
      return this.heard({ reserved: Math.abs(pad.axes[0] ?? 0) >= Math.abs(pad.axes[1] ?? 0) ? 'a0' : 'a1' });
    }
    if (stick < 0.3) l.stickSaid = false;
    // An axis pushed past halfway is heard once it's let go, from where it comes to rest: a trigger
    // goes back to an end (-1), a stick to the middle. (Where it read when listening started isn't
    // enough: some browsers report an untouched trigger as 0.)
    if (l.axis) {
      const v = pad.axes[l.axis.a] ?? 0;
      // At rest in the middle, or at the end it was pushed away from (not the one it's still held at).
      const end = -l.axis.dir;
      const rest = Math.abs(v) < 0.25 ? 0 : Math.abs(v - end) < 0.25 ? end : null;
      if (rest !== null) this.heard({ pad: { ...l.axis, rest } });
      return;
    }
    for (let k = 2; k < pad.axes.length; k++) {
      const d = (pad.axes[k] ?? 0) - (l.base[k] ?? 0);
      if (Math.abs(d) >= 0.5) {
        l.axis = { a: k, dir: d > 0 ? 1 : -1 };
        return;
      }
    }
  }

  /** What was used last: the menus' key hints follow it (keycaps, or the pad's buttons). */
  get lastDevice(): InputDevice {
    return this.device;
  }

  set lastDevice(d: InputDevice) {
    if (d === this.device) return;
    this.device = d;
    try {
      sessionStorage.setItem(DEVICE_KEY, d);
    } catch {
      // Blocked storage: the next page starts on the keyboard's hints.
    }
    for (const fn of this.deviceListeners) fn(d);
  }

  /** Calls `fn` now and whenever the device used last changes. */
  onDevice(fn: (d: InputDevice) => void): void {
    this.deviceListeners.push(fn);
    fn(this.device);
  }

  on(fn: (a: SystemAction) => void): void {
    this.listeners.push(fn);
  }

  private fire(a: SystemAction): void {
    for (const fn of this.listeners) fn(a);
  }

  /** Reads every device into `out` for this frame. `dt` in seconds (for keyboard easing). */
  poll(out: Controls, dt: number): Controls {
    const want = (holding('right') ? 1 : 0) - (holding('left') ? 1 : 0);
    const rate = want * this.keySteer < 0 ? 9 : 7;
    this.keySteer = approach(this.keySteer, want, rate * dt);
    // From straight, a steer key starts at KEY_ONSET; turning the other way, it eases to the middle
    // at 9/s, then steps out to KEY_ONSET on the other side.
    const along = this.keySteer * want;
    if (want !== 0 && along >= 0) this.keySteer = want * Math.max(KEY_ONSET, along);
    let steer = this.keySteer;
    let throttle = holding('throttle') ? 1 : 0;
    let brake = holding('brake') ? 1 : 0;
    let boost = holding('boost');
    let drift = holding('drift');
    let reset = holding('reset');
    let look = holding('look');
    let horn = holding('horn');

    const pad = this.pad();
    if (pad && this.listening) this.buttons(pad);
    else if (pad) {
      const binds = this.padBinds;
      const live = (p: PadBind | null) => !p || 'b' in p || !!this.axisLive[p.a];
      const value = (a: (typeof PAD_ACTIONS)[number]) => Math.max(...binds[a].map((p) => padValue(pad, p, live(p))));
      const down = (a: (typeof PAD_ACTIONS)[number]) => binds[a].some((p) => padDown(pad, p, live(p)));
      const ax = pad.axes[0] ?? 0;
      const stick = Math.abs(ax) < this.deadZone ? 0 : (ax - Math.sign(ax) * this.deadZone) / (1 - this.deadZone);
      const padSteer = Math.sign(stick) * Math.abs(stick) ** this.steerCurve;
      const rt = value('throttle');
      const lt = value('brake');
      const any = Math.abs(stick) > 0 || rt > 0.05 || lt > 0.05 || pad.buttons.some((x) => x.pressed);
      if (any) this.lastDevice = 'gamepad';
      if (Math.abs(padSteer) > Math.abs(steer)) steer = padSteer;
      throttle = Math.max(throttle, rt);
      brake = Math.max(brake, lt);
      boost ||= down('boost');
      drift ||= down('drift');
      look ||= down('look');
      reset ||= down('reset');
      horn ||= down('horn');
      this.buttons(pad);
    }
    // Drift held (a key or the pad's) and a steer key down, ready to drift: straight past the
    // drift's threshold, so it starts on the next tick. Eased up to it from straight, the drift
    // came 7–9 ticks after the key (the owner, 2026-10-14: the drift "slower to react", pressing
    // drift then steering). Mid-drift, counter-steering eases as any steer key does (KEY_ONSET).
    // (Not ready, a steer key from straight now takes 3 ticks to the threshold.)
    if (this.readyToDrift && drift && want !== 0 && this.keySteer * want < TUNING.driftMinSteer) {
      this.keySteer = want * Math.min(1, TUNING.driftMinSteer + 0.05);
      if (Math.abs(this.keySteer) > Math.abs(steer)) steer = this.keySteer;
    }

    out.steer = clamp(steer, -1, 1);
    out.throttle = throttle;
    out.brake = brake;
    out.boost = boost;
    out.drift = drift;
    out.reset = reset;
    out.lookBack = look;
    out.horn = horn;
    return out;
  }

  /**
   * The pad's system and menu buttons only, for while the game is paused (poll doesn't run then,
   * and Start has to be able to unpause).
   */
  pollMenu(): void {
    const pad = this.pad();
    if (pad) this.buttons(pad);
  }

  /** The pad's buttons that are down now aren't presses: only their next press is (a menu coming up under a held button). */
  settleButtons(): void {
    const pad = this.pad();
    if (pad) for (let k = 0; k < pad.buttons.length; k++) this.prevButtons[k] = pad.buttons[k].pressed;
  }

  /** Fires system and menu actions on the press (not while held). */
  private buttons(pad: Gamepad): void {
    const b = (k: number) => pad.buttons[k]?.pressed ?? false;
    const pressed = (k: number) => b(k) && !this.prevButtons[k];
    if (pad.buttons.some((x, k) => x.pressed && !this.prevButtons[k]) || Math.max(Math.abs(pad.axes[0] ?? 0), Math.abs(pad.axes[1] ?? 0)) > 0.6) this.lastDevice = 'gamepad';
    if (this.listening) {
      this.hearPad(pad);
      for (let k = 0; k < pad.buttons.length; k++) this.prevButtons[k] = pad.buttons[k].pressed;
      // Back in the menu after it, a stick still held over waits as if it had just moved focus.
      this.stickDir = Math.max(Math.abs(pad.axes[0] ?? 0), Math.abs(pad.axes[1] ?? 0)) > 0.6 ? stickWay(pad) : null;
      this.stickNavAt = performance.now() + REPEAT_DELAY_MS;
      return;
    }
    if (b(8) && pressed(9)) this.fire('report');
    else if (pressed(9)) this.fire('pause');
    if (this.menuOpen) {
      const now = performance.now();
      // The d-pad moves on the press, then again and again while it's held (not the bumpers: a held one would spin the cars past).
      for (const [k, a] of PAD_NAV) {
        if (pressed(k)) {
          this.fire(a);
          this.padNavAt[k] = now + REPEAT_DELAY_MS;
        } else if (k >= 12 && b(k) && now >= (this.padNavAt[k] ?? Infinity)) {
          this.fire(a);
          this.padNavAt[k] = now + REPEAT_MS;
        }
      }
      if (pressed(0)) this.fire('accept');
      if (pressed(1)) this.fire('back');
      if (pressed(3)) this.fire('alt');
      if (pressed(2)) this.fire('clear');
      // The stick moves focus too, the same way: once as it's pushed over, then repeating while held.
      const [ax, ay] = [pad.axes[0] ?? 0, pad.axes[1] ?? 0];
      const far = Math.max(Math.abs(ax), Math.abs(ay));
      const dir = stickWay(pad);
      if (far > 0.6 && (dir !== this.stickDir || now >= this.stickNavAt)) {
        this.stickNavAt = now + (dir === this.stickDir ? REPEAT_MS + 25 : REPEAT_DELAY_MS);
        this.stickDir = dir;
        this.fire(dir);
      } else if (far < 0.3) this.stickDir = null;
    }
    for (let k = 0; k < pad.buttons.length; k++) this.prevButtons[k] = pad.buttons[k].pressed;
  }

  private pad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    let found: Gamepad | null = null;
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') found ??= p;
    for (const p of pads) if (p && p.connected) found ??= p;
    if (found) for (let k = 0; k < found.axes.length; k++) if (found.axes[k] !== 0) this.axisLive[k] = true;
    return found;
  }

  /** Rumble on the active gamepad: strong/weak 0–1, for `ms`. */
  rumble(strong: number, weak: number, ms: number): void {
    if (!this.rumbleOn || this.lastDevice !== 'gamepad') return;
    const pad = this.pad() as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null;
    pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) }).catch(() => {});
  }
}

/** Which way the left stick is pushed most. */
function stickWay(pad: Gamepad): MenuAction {
  const [ax, ay] = [pad.axes[0] ?? 0, pad.axes[1] ?? 0];
  return Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'nav-right' : 'nav-left') : ay > 0 ? 'nav-down' : 'nav-up';
}

/** Keys for a text field (and a dropdown outside the menus: in them, arrows move between controls). */
function isTyping(e: KeyboardEvent, menuOpen: boolean): boolean {
  const t = e.target as HTMLElement | null;
  // A slider or a checkbox isn't typing: the menu's keys move it, and Esc still backs out.
  const typed = t?.tagName === 'INPUT' && !['range', 'checkbox'].includes((t as HTMLInputElement).type);
  return !!t && (typed || t.tagName === 'TEXTAREA' || (t.tagName === 'SELECT' && !menuOpen) || t.isContentEditable);
}
