// A chooser in place of a dropdown (docs/MENU.md): `‹ Paradise ›`, a button that cycles through its
// values. A click on its left side goes back one, anywhere else on to the next; left and right (the
// arrows, the d-pad, the bumpers) do the same when it has focus (nav.ts), and Enter, Space or the
// pad's A go on to the next. It's a <button> with a `value` and a `change` event, so code reads it
// as it read a <select>: `el.value`, `el.onchange`, `el.disabled`.

import { uiSound } from './click';
import { esc } from './html';

/** Index `i` moved `d` along a list of `n`, wrapping round. */
export function cycleIndex(i: number, n: number, d: number): number {
  return n ? (((i + d) % n) + n) % n : 0;
}

/** The chooser's HTML: `opts` as [value, label], starting on `value` (the first if it isn't one). */
export function chooser(id: string, opts: [string, string][], value: string, disabled = false): string {
  const at = Math.max(0, opts.findIndex(([v]) => v === value));
  const [v, l] = opts[at] ?? ['', ''];
  // Where it is in a long list (the maps), unless the values say so themselves (the laps).
  const count = opts.length > 3 && opts.some(([, l]) => !/^\d+%?$/.test(l)) ? `<small class="cn">${at + 1}/${opts.length}</small>` : '';
  return `<button type="button" class="chooser" id="${esc(id)}" value="${esc(v)}" data-opts="${esc(JSON.stringify(opts))}"${disabled ? ' disabled' : ''}><i class="cprev" aria-hidden="true">‹</i><span class="cv">${esc(l)}</span>${count}<i class="cnext" aria-hidden="true">›</i></button>`;
}

export const isChooser = (el: Element | null): el is HTMLButtonElement => !!el && el instanceof HTMLButtonElement && el.classList.contains('chooser');

/** Moves the chooser `d` values along, and says so (`change`) as a <select> would. */
export function stepChooser(el: HTMLButtonElement, d: number): void {
  if (el.disabled) return;
  const opts = JSON.parse(el.dataset.opts ?? '[]') as [string, string][];
  if (opts.length < 2) return;
  const at = cycleIndex(Math.max(0, opts.findIndex(([v]) => v === el.value)), opts.length, d);
  el.value = opts[at][0];
  el.querySelector('.cv')!.textContent = opts[at][1];
  const cn = el.querySelector('.cn');
  if (cn) cn.textContent = `${at + 1}/${opts.length}`;
  // Restart the little nudge in the direction it went.
  el.classList.remove('nudge-l', 'nudge-r');
  void el.offsetWidth;
  el.classList.add(d < 0 ? 'nudge-l' : 'nudge-r');
  uiSound('tick');
  el.dispatchEvent(new Event('change'));
}

let installed = false;

/** Clicks on any chooser on the page, once: its left side goes back, the rest (and a key's click) on. */
export function installChoosers(): void {
  if (installed) return;
  installed = true;
  document.addEventListener('click', (e) => {
    const el = (e.target as Element | null)?.closest('.chooser') ?? null;
    if (!isChooser(el)) return;
    // A click from Enter or Space has no position (detail 0): on to the next.
    const r = el.getBoundingClientRect();
    const back = e.detail > 0 && e.clientX < r.left + Math.min(40, r.width * 0.3);
    stepChooser(el, back ? -1 : 1);
  });
}
