// Keyboard and gamepads → one Controls object (SPEC §13). Gamepads use the standard mapping:
// left stick steers, RT/LT throttle and brake, A boost, RB (or X) drift, B look back, Y reset,
// Start pause, Select+Start "something felt wrong". Keyboard steering eases in and out so it
// isn't all-or-nothing.

import type { Controls } from '../core/controls';
import { approach, clamp } from '../core/math';

export type SystemAction = 'pause' | 'report' | 'editor' | 'debug' | 'tuning' | 'ink' | 'mute' | 'music' | 'track-prev' | 'track-next' | MenuAction;
/**
 * In a menu (menuOpen): move focus, press the focused control, or back out. WASD (and the pad's
 * bumpers) pick: in the lobby they cycle your car and paint, and elsewhere they move focus too.
 */
export type MenuAction = 'nav-up' | 'nav-down' | 'nav-left' | 'nav-right' | 'pick-up' | 'pick-down' | 'pick-left' | 'pick-right' | 'accept' | 'back';

const MENU_KEYS: Record<string, MenuAction> = { ArrowUp: 'nav-up', ArrowDown: 'nav-down', ArrowLeft: 'nav-left', ArrowRight: 'nav-right', KeyW: 'pick-up', KeyS: 'pick-down', KeyA: 'pick-left', KeyD: 'pick-right' };
/** Standard-mapping d-pad buttons, and LB and RB. */
const PAD_NAV: [number, MenuAction][] = [[12, 'nav-up'], [13, 'nav-down'], [14, 'nav-left'], [15, 'nav-right'], [4, 'pick-left'], [5, 'pick-right']];

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

export type InputDevice = 'keyboard' | 'gamepad' | 'touch';

export class Input {
  private keySteer = 0;
  private readonly listeners: ((a: SystemAction) => void)[] = [];
  private prevButtons: boolean[] = [];
  lastDevice: InputDevice = 'keyboard';
  deadZone = 0.12;
  rumbleOn = true;
  /** Set while a text field has focus, so typing doesn't drive. */
  suspended = false;
  /** A menu is up: arrows and the d-pad move focus, A presses, B backs out. */
  menuOpen = false;
  /** When the stick last moved menu focus (it repeats while held). */
  private stickNavAt = 0;

  constructor() {
    window.addEventListener('keydown', (e) => {
      // Browser and OS shortcuts (Cmd+R, Ctrl+Tab…) are theirs, not a reset or a steer.
      if (this.suspended || isTyping(e, this.menuOpen) || e.metaKey || e.ctrlKey || e.altKey) return;
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
        this.lastDevice = 'keyboard';
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

  on(fn: (a: SystemAction) => void): void {
    this.listeners.push(fn);
  }

  private fire(a: SystemAction): void {
    for (const fn of this.listeners) fn(a);
  }

  /** Reads every device into `out` for this frame. `dt` in seconds (for keyboard easing). */
  poll(out: Controls, dt: number): Controls {
    const want = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    const rate = want === 0 ? 7 : Math.sign(want) !== Math.sign(this.keySteer) ? 9 : 4.5;
    this.keySteer = approach(this.keySteer, want, rate * dt);
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

  /** Fires system and menu actions on the press (not while held). */
  private buttons(pad: Gamepad): void {
    const b = (k: number) => pad.buttons[k]?.pressed ?? false;
    const pressed = (k: number) => b(k) && !this.prevButtons[k];
    if (b(8) && pressed(9)) this.fire('report');
    else if (pressed(9)) this.fire('pause');
    if (this.menuOpen) {
      for (const [k, a] of PAD_NAV) if (pressed(k)) this.fire(a);
      if (pressed(0)) this.fire('accept');
      if (pressed(1)) this.fire('back');
      // The stick moves focus too, repeating every quarter second while held over.
      const [ax, ay] = [pad.axes[0] ?? 0, pad.axes[1] ?? 0];
      const now = performance.now();
      if (Math.max(Math.abs(ax), Math.abs(ay)) > 0.6 && now - this.stickNavAt > 250) {
        this.stickNavAt = now;
        this.fire(Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'nav-right' : 'nav-left') : ay > 0 ? 'nav-down' : 'nav-up');
      } else if (Math.max(Math.abs(ax), Math.abs(ay)) < 0.3) this.stickNavAt = 0;
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
