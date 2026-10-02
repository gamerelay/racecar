// The menus' press feel (PLAN "Next up"): every button in a card (and the in-race menu button)
// flashes and dips when pressed, by pointer, key or pad alike (a key's or the pad's press has no
// :active), with a click through the audio's menu bus. A chooser's step and a slider's move tick
// instead (chooser.ts calls `uiSound` itself, for the arrow keys too).

export type UiSound = 'press' | 'back' | 'tick';

let sound: (kind: UiSound) => void = () => {};
/** When the last tick played (ms): a dragged slider ticks at most this often. */
let lastTick = -Infinity;
const TICK_MS = 70;

/** Plays a menu sound, once the audio says how (`installClicks`). */
export function uiSound(kind: UiSound): void {
  if (kind === 'tick') {
    const now = performance.now();
    if (now - lastTick < TICK_MS) return;
    lastTick = now;
  }
  sound(kind);
}

/** Restarts the press flash on `el`. */
export function pressFx(el: HTMLElement): void {
  el.classList.remove('pressed');
  void el.offsetWidth;
  el.classList.add('pressed');
}

let installed = false;

/** Once, for the whole page: `play` makes the sounds (GameAudio's `uiSound`). */
export function installClicks(play: (kind: UiSound) => void): void {
  sound = play;
  if (installed) return;
  installed = true;
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as Element | null)?.closest('.card button, #quit') ?? null;
      if (!(el instanceof HTMLButtonElement) || el.disabled) return;
      pressFx(el);
      // A chooser ticks as it steps (chooser.ts).
      if (!el.classList.contains('chooser')) uiSound(el.classList.contains('ghost') ? 'back' : 'press');
    },
    true,
  );
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el instanceof HTMLInputElement && el.type === 'range' && el.closest('.card')) uiSound('tick');
  });
  document.addEventListener('animationend', (e) => {
    if (e.animationName.startsWith('pressFx') && e.target instanceof HTMLElement) e.target.classList.remove('pressed');
  });
}
