// The keys card: your first race on this device shows the keys you drive with (WASD, Shift, Space),
// drawn as a keyboard with each key's job pointed at. Any key, a click or a pad's button puts it
// away, and it doesn't come back (`racecar.seenKeys`). Not on a touch screen: there are no keys there.

import { Overlay } from './overlay';

const SEEN = 'racecar.seenKeys';

/** A keycap, its drop and its letter. */
const cap = (x: number, y: number, w: number, label: string, small = false) =>
  `<rect class="kDrop" x="${x + 5}" y="${y + 5}" width="${w}" height="56" rx="8"/><rect class="kCap" x="${x}" y="${y}" width="${w}" height="56" rx="8"/><text class="kLetter${small ? ' small' : ''}" x="${x + w / 2}" y="${y + 37}">${label}</text>`;
/** A leader from a key (x, y) to its job, down to `bend` first if it's another height. */
const lead = (x: number, y: number, bend: number, job: string) => {
  const points = bend === y ? `${x},${y} 392,${y}` : `${x},${y} ${x},${bend} 392,${bend}`;
  return `<polyline class="kLead" points="${points}"/><circle class="kDot" cx="${x}" cy="${y}" r="3.5"/><text class="kJob" x="402" y="${bend + 6}">${job}</text>`;
};

/** The keyboard, drawn: W over A S D, Shift down the left, Space under them. */
export const KEYS_SVG = `<svg class="keysArt" viewBox="0 0 560 300" role="img" aria-label="W accelerates, A and D steer, S brakes and reverses, Shift drifts, Space boosts">
  ${cap(140, 6, 56, 'W')}
  ${cap(80, 76, 56, 'A')}${cap(140, 76, 56, 'S')}${cap(200, 76, 56, 'D')}
  ${cap(10, 158, 124, 'SHIFT', true)}
  ${cap(120, 236, 240, 'SPACE', true)}
  ${lead(196, 34, 34, 'Accelerate')}
  ${lead(256, 104, 104, 'Steer (A and D)')}
  ${lead(168, 132, 146, 'Brake, reverse')}
  ${lead(134, 186, 186, 'Drift (hold)')}
  ${lead(360, 264, 264, 'Boost')}
</svg>`;

export class KeysCard extends Overlay {
  /** Called once it's put away. */
  onClose: () => void = () => {};

  constructor(private readonly store: Storage | null) {
    super('keys');
  }

  /** Whether it's still to be shown here: never on this device, and there's a keyboard. */
  static due(store: Storage | null): boolean {
    const touchOnly = !!window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia?.('(any-pointer: fine)').matches;
    if (touchOnly) return false;
    try {
      return store?.getItem(SEEN) !== '1';
    } catch {
      return false;
    }
  }

  open(): void {
    this.el.innerHTML = `<div class="card keysCard">
      <h1>The keys</h1>
      ${KEYS_SVG}
      <p class="muted">The arrows drive too. R puts you back on the road, Esc is the menu.</p>
      <div class="row stack"><button id="kGo">Let's go</button></div>
      <p class="muted kAny">or press any key</p>
    </div>`;
    document.getElementById('kGo')!.onclick = () => this.close();
    this.el.onclick = (e) => e.target === this.el && this.close();
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
