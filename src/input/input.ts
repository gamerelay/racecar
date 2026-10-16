// Keyboard and gamepads → one Controls object (SPEC §13). Gamepads use the standard mapping:
// left stick steers, RT/LT throttle and brake, A boost, RB (or X) drift, B look back, Y reset,
// Start pause, Select+Start "something felt wrong". Keyboard steering starts at KEY_ONSET and eases
// in and out from there, so it isn't all-or-nothing.

import type { Controls } from '../core/controls';
import { approach, clamp } from '../core/math';
import { TUNING } from '../core/car/tuning';

export type SystemAction = 'pause' | 'report' | 'editor' | 'debug' | 'tuning' | 'ink' | 'mute' | 'music' | 'track-prev' | 'track-next' | MenuAction;
/**
 * In a menu (menuOpen): move focus, press the focused control, or back out. WASD (and the pad's
 * bumpers) pick: in the lobby they cycle your car and paint, and elsewhere they move focus too.
 * Q and E switch a panel's tabs (the pad's bumpers do, there); R (the pad's Y) is a screen's own
 * extra (Refresh, in the lobby list).
 */
export type MenuAction = 'nav-up' | 'nav-down' | 'nav-left' | 'nav-right' | 'pick-up' | 'pick-down' | 'pick-left' | 'pick-right' | 'tab-prev' | 'tab-next' | 'alt' | 'accept' | 'back';

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
  accept: true,
  back: true,
};
export const isMenuAction = (a: string): a is MenuAction => Object.hasOwn(MENU_ACTIONS, a);
/** Standard-mapping d-pad buttons, and LB and RB. */
const PAD_NAV: [number, MenuAction][] = [[12, 'nav-up'], [13, 'nav-down'], [14, 'nav-left'], [15, 'nav-right'], [4, 'pick-left'], [5, 'pick-right']];
/** A d-pad button or the stick held over in a menu moves again after this (ms), then every REPEAT_MS. */
const REPEAT_DELAY_MS = 380;
const REPEAT_MS = 95;

const KEYS: Record<string, keyof typeof held> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  Space: 'boost',
  ShiftLeft: 'drift',
  ShiftRight: 'drift',
  KeyR: 'reset',
  KeyC: 'look',
  KeyQ: 'look',
  KeyH: 'horn',
};

const held = { left: false, right: false, up: false, down: false, boost: false, drift: false, reset: false, look: false, horn: false };

const SYSTEM: Record<string, SystemAction> = {
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
};

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
    window.addEventListener('keydown', (e) => {
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
      const k = KEYS[e.code];
      if (k) {
        held[k] = true;
        e.preventDefault();
      }
    });
    const release = () => {
      for (const k of Object.keys(held) as (keyof typeof held)[]) held[k] = false;
    };
    window.addEventListener('keyup', (e) => {
      const k = KEYS[e.code];
      if (k) held[k] = false;
      // macOS sends no keyup for keys let go while Cmd was down: drop everything with it.
      if (e.key === 'Meta') release();
    });
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', release);
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
    const want = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    const rate = want * this.keySteer < 0 ? 9 : 7;
    this.keySteer = approach(this.keySteer, want, rate * dt);
    // From straight, a steer key starts at KEY_ONSET; turning the other way, it eases to the middle
    // at 9/s, then steps out to KEY_ONSET on the other side.
    const along = this.keySteer * want;
    if (want !== 0 && along >= 0) this.keySteer = want * Math.max(KEY_ONSET, along);
    let steer = this.keySteer;
    let throttle = held.up ? 1 : 0;
    let brake = held.down ? 1 : 0;
    let boost = held.boost;
    let drift = held.drift;
    let reset = held.reset;
    let look = held.look;
    let horn = held.horn;

    const pad = this.pad();
    if (pad) {
      const b = (k: number) => pad.buttons[k]?.pressed ?? false;
      const v = (k: number) => pad.buttons[k]?.value ?? 0;
      const ax = pad.axes[0] ?? 0;
      const stick = Math.abs(ax) < this.deadZone ? 0 : (ax - Math.sign(ax) * this.deadZone) / (1 - this.deadZone);
      const padSteer = Math.sign(stick) * Math.abs(stick) ** 1.4;
      const rt = v(7);
      const lt = v(6);
      const any = Math.abs(stick) > 0 || rt > 0.05 || lt > 0.05 || pad.buttons.some((x) => x.pressed);
      if (any) this.lastDevice = 'gamepad';
      if (Math.abs(padSteer) > Math.abs(steer)) steer = padSteer;
      throttle = Math.max(throttle, rt);
      brake = Math.max(brake, lt);
      boost ||= b(0);
      drift ||= b(5) || b(2);
      look ||= b(1);
      reset ||= b(3);
      horn ||= b(10);
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
      // The stick moves focus too, the same way: once as it's pushed over, then repeating while held.
      const [ax, ay] = [pad.axes[0] ?? 0, pad.axes[1] ?? 0];
      const far = Math.max(Math.abs(ax), Math.abs(ay));
      const dir: MenuAction = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'nav-right' : 'nav-left') : ay > 0 ? 'nav-down' : 'nav-up';
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
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') return p;
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Rumble on the active gamepad: strong/weak 0–1, for `ms`. */
  rumble(strong: number, weak: number, ms: number): void {
    if (!this.rumbleOn || this.lastDevice !== 'gamepad') return;
    const pad = this.pad() as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null;
    pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) }).catch(() => {});
  }
}

/** Keys for a text field (and a dropdown outside the menus: in them, arrows move between controls). */
function isTyping(e: KeyboardEvent, menuOpen: boolean): boolean {
  const t = e.target as HTMLElement | null;
  // A slider or a checkbox isn't typing: the menu's keys move it, and Esc still backs out.
  const typed = t?.tagName === 'INPUT' && !['range', 'checkbox'].includes((t as HTMLInputElement).type);
  return !!t && (typed || t.tagName === 'TEXTAREA' || (t.tagName === 'SELECT' && !menuOpen) || t.isContentEditable);
}
