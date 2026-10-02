// Menus by controller (SPEC §13): the d-pad, stick or arrow keys move focus to the nearest
// control in that direction, by where things are on screen; on a chooser (chooser.ts), a slider or
// a dropdown, left and right change its value. The choice of "nearest" is pure (pickNext) so it's
// tested without a DOM.

import { isChooser, stepChooser } from './chooser';

export type Dir = 'up' | 'down' | 'left' | 'right';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The index of the box to move to from box `from` going `dir`, or -1 if nothing lies that way.
 * Distance along the direction counts once, across it three times, so a move stays in its row or
 * column when it can.
 */
export function pickNext(boxes: Box[], from: number, dir: Dir): number {
  const a = boxes[from];
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  let best = -1;
  let bestScore = Infinity;
  for (let k = 0; k < boxes.length; k++) {
    if (k === from) continue;
    const b = boxes[k];
    const dx = b.x + b.w / 2 - ax;
    const dy = b.y + b.h / 2 - ay;
    const along = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 1) continue;
    const score = along + across * 3;
    if (score < bestScore) {
      bestScore = score;
      best = k;
    }
  }
  return best;
}

const CONTROLS = 'button, select, input, [tabindex]:not([tabindex="-1"])';

/** The controls a player can reach in `root`: visible and enabled. */
function controls(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(CONTROLS)].filter((el) => el.offsetParent !== null && !(el as HTMLButtonElement).disabled);
}

/** Moves focus within `root` (or changes the focused chooser's, slider's or dropdown's value on left and right). */
export function navigate(root: HTMLElement, dir: Dir): void {
  const list = controls(root);
  if (!list.length) return;
  const at = list.indexOf(document.activeElement as HTMLElement);
  if (at < 0) {
    list[0].focus();
    return;
  }
  const el = list[at];
  const side = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
  if (side && isChooser(el)) return stepChooser(el, side);
  if (side && el instanceof HTMLInputElement && el.type === 'range') {
    if (side > 0) el.stepUp();
    else el.stepDown();
    el.dispatchEvent(new Event('input'));
    return;
  }
  if (el instanceof HTMLSelectElement && (dir === 'left' || dir === 'right')) {
    const n = el.options.length;
    el.selectedIndex = (el.selectedIndex + (dir === 'right' ? 1 : n - 1)) % n;
    el.dispatchEvent(new Event('change'));
    return;
  }
  const next = pickNext(
    list.map((c) => {
      const r = c.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }),
    at,
    dir,
  );
  if (next >= 0) list[next].focus();
}

/** Presses the focused control in `root`, if focus is in it. */
export function accept(root: HTMLElement): void {
  const el = document.activeElement as HTMLElement | null;
  if (el && root.contains(el) && !(el instanceof HTMLSelectElement)) el.click();
}
