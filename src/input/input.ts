// Keyboard and gamepads → one Controls object (SPEC §13). Gamepads use the standard mapping:
// left stick steers, RT/LT throttle and brake, A boost, RB (or X) drift, B look back, Y reset,
// Start pause, Select+Start "something felt wrong". Keyboard steering eases in and out so it
// isn't all-or-nothing.

import type { Controls } from '../core/controls';
import { approach, clamp } from '../core/math';

export type SystemAction = 'pause' | 'report' | 'editor' | 'debug' | 'tuning' | 'camera' | 'ink' | 'mute' | 'music';

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
  KeyV: 'camera',
  KeyM: 'mute',
  KeyN: 'music',
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

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (this.suspended || isTyping(e)) return;
      const sys = SYSTEM[e.code];
      if (sys && !e.repeat) {
        e.preventDefault();
        this.fire(sys);
        return;
      }
      const k = KEYS[e.code];
      if (k) {
        held[k] = true;
        this.lastDevice = 'keyboard';
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      const k = KEYS[e.code];
      if (k) held[k] = false;
    });
    window.addEventListener('blur', () => {
      for (const k of Object.keys(held) as (keyof typeof held)[]) held[k] = false;
    });
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
      // System buttons fire on the press.
      const pressed = (k: number) => b(k) && !this.prevButtons[k];
      if (b(8) && pressed(9)) this.fire('report');
      else if (pressed(9)) this.fire('pause');
      this.prevButtons = pad.buttons.map((x) => x.pressed);
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

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
