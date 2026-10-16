// The keys card: your first race on this device shows the keys you drive with (WASD, Shift, Space,
// or whatever they've been set to on the Controls tab), drawn as a keyboard with each key's job
// pointed at, or the pad's buttons when the pad was used last (`body.pad`). A key, a click or a
// pad's button puts it away (main.ts), and it doesn't come back (`racecar.seenKeys`). Not on a
// touch screen: there are no keys there.

import { DEFAULT_KEYS, DEFAULT_PAD, keyLabel, padLabel, type KeyBinds, type PadAction, type PadBinds } from '../input/bindings';
import { esc } from './html';
import { button, pad } from './kit';
import { Overlay } from './overlay';

const SEEN = 'racecar.seenKeys';

/** A keycap, its drop and its letter. */
const cap = (x: number, y: number, w: number, label: string, small = label.length > 1) =>
  `<rect class="kDrop" x="${x + 5}" y="${y + 5}" width="${w}" height="56" rx="8"/><rect class="kCap" x="${x}" y="${y}" width="${w}" height="56" rx="8"/><text class="kLetter${small ? ' small' : ''}" x="${x + w / 2}" y="${y + 37}">${esc(label)}</text>`;
/** A leader from a key (x, y) to its job, down to `bend` first if it's another height. */
const lead = (x: number, y: number, bend: number, job: string) => {
  const points = bend === y ? `${x},${y} 392,${y}` : `${x},${y} ${x},${bend} 392,${bend}`;
  return `<polyline class="kLead" points="${points}"/><circle class="kDot" cx="${x}" cy="${y}" r="3.5"/><text class="kJob" x="402" y="${bend + 6}">${job}</text>`;
};

/** An action's key for the card: its primary, or else its alternate ('—' with neither). */
const first = (k: [string, string]) => keyLabel(k[0] || k[1]) || '—';

/** The keyboard, drawn as WASD is: the accelerate key over the steer and brake keys, drift's down the left, boost's under them. */
export function keysSvg(keys: KeyBinds = DEFAULT_KEYS): string {
  const [t, l, b, r, d, bo] = [keys.throttle, keys.left, keys.brake, keys.right, keys.drift, keys.boost].map(first);
  const up = (x: string) => x.toUpperCase();
  return `<svg class="kc-art" viewBox="0 0 560 300" role="img" aria-label="${esc(`${t} accelerates, ${l} and ${r} steer, ${b} brakes and reverses, ${d} drifts, ${bo} boosts`)}">
  ${cap(140, 6, 56, up(t))}
  ${cap(80, 76, 56, up(l))}${cap(140, 76, 56, up(b))}${cap(200, 76, 56, up(r))}
  ${cap(10, 158, 124, up(d))}
  ${cap(120, 236, 240, up(bo))}
  ${lead(196, 34, 34, 'Accelerate')}
  ${lead(256, 104, 104, esc(`Steer (${l} and ${r})`))}
  ${lead(168, 132, 146, 'Brake, reverse')}
  ${lead(134, 186, 186, 'Drift (hold)')}
  ${lead(360, 264, 264, 'Boost')}
</svg>`;
}

/** The keyboard's line under it: the other keys that drive, and the reset key. */
export function keysNote(keys: KeyBinds = DEFAULT_KEYS): string {
  const alts = [keys.throttle[1], keys.brake[1], keys.left[1], keys.right[1]];
  const arrows = alts.join() === 'ArrowUp,ArrowDown,ArrowLeft,ArrowRight';
  const also = arrows ? 'The arrows drive too. ' : alts.every(Boolean) ? `${alts.map(keyLabel).join(' ')} drive too. ` : '';
  const reset = keyLabel(keys.reset[0] || keys.reset[1]);
  return `${also}${reset ? `${reset} puts you back on the road, ` : ''}Esc is the menu.`;
}

const or = '<span class="s-or">or</span>';
/** The same on a pad: each button and its job. */
export function padRows(binds: PadBinds = DEFAULT_PAD): [string, string][] {
  const btns = (a: PadAction) => binds[a].filter((p) => p).map((p) => pad(padLabel(p))).join(or) || '<span class="k-muted">none</span>';
  return [
    [btns('throttle'), 'Accelerate'],
    [pad('Left stick'), 'Steer'],
    [btns('brake'), 'Brake, reverse'],
    [btns('drift'), 'Drift (hold)'],
    [btns('boost'), 'Boost'],
  ];
}

export class KeysCard extends Overlay {
  /** Called once it's put away. */
  onClose: () => void = () => {};

  constructor(
    private readonly store: Storage | null,
    private readonly binds: () => { keys: KeyBinds; pad: PadBinds } = () => ({ keys: DEFAULT_KEYS, pad: DEFAULT_PAD }),
  ) {
    super('keys');
    this.el.classList.add('k');
  }

  /**
   * Whether it's still to be shown here: never on this device, and there's a keyboard. Not where
   * storage is blocked: it couldn't remember, and every race would wait behind it.
   */
  static due(store: Storage | null): boolean {
    const touchOnly = !!window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia?.('(any-pointer: fine)').matches;
    if (touchOnly || !store) return false;
    try {
      return store.getItem(SEEN) !== '1';
    } catch {
      return false;
    }
  }

  open(): void {
    const { keys, pad: pads } = this.binds();
    const reset = padLabel(pads.reset[0] ?? pads.reset[1]);
    this.el.innerHTML = `<div class="k-panel kc-sheet" role="dialog" aria-label="The keys">
      <p class="k-eyebrow">Your first race</p>
      <h1 class="k-h1">The keys</h1>
      <div class="kc-kb">${keysSvg(keys)}<p class="k-muted">${esc(keysNote(keys))}</p></div>
      <div class="kc-pad">${padRows(pads).map(([b, job]) => `<div class="kc-row"><span>${b}</span><b>${job}</b></div>`).join('')}<p class="k-muted">${reset ? `${esc(reset)} puts you back on the road, ` : ''}Start is the menu.</p></div>
      <div class="kc-go">${button('kGo', "Let's go", 'primary')}<span class="k-muted">or press any <span class="kc-kbOnly">key</span><span class="kc-padOnly">button</span></span></div>
    </div>`;
    // A click anywhere puts it away, on the card or off it.
    this.el.onclick = () => this.close();
    this.show(null);
    document.getElementById('kGo')!.focus({ preventScroll: true });
  }

  override close(): void {
    if (!this.isOpen) return;
    super.close();
    this.el.innerHTML = '';
    try {
      this.store?.setItem(SEEN, '1');
    } catch {
      // Blocked storage: it may show again next race.
    }
    this.onClose();
  }
}
