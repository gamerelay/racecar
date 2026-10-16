// The menus' parts (docs/MENU.md, "The UI kit"): small builders that return HTML, styled by
// kit.css, that every screen is made of. Ink, Night, Sun, Hot, Ice, Cream and Muted; Bungee for
// titles, buttons and big numbers, Chakra Petch for the rest; a hard pink shadow on the one main
// action per screen, and an 8° lean on titles and menu actions only.
//
// Key hints are drawn for both keyboard and pad, and CSS shows the one used last (`body.pad`,
// set from Input.onDevice in main.ts), so nothing is redrawn when you pick up the pad.

import { esc } from './html';

/** What a hint stands for, as keycaps on the keyboard and buttons on the pad. */
export const BINDS = {
  select: { kb: ['↑↓'], pad: ['✚'] },
  move: { kb: ['↑↓←→'], pad: ['✚'] },
  confirm: { kb: ['Enter'], pad: ['A'] },
  back: { kb: ['Esc'], pad: ['B'] },
  resume: { kb: ['Esc'], pad: ['B'] },
  tab: { kb: ['Q', 'E'], pad: ['LB', 'RB'] },
  refresh: { kb: ['R'], pad: ['Y'] },
  car: { kb: ['A', 'D'], pad: ['LB', 'RB'] },
  paint: { kb: ['W', 'S'], pad: [] },
  drift: { kb: ['Shift'], pad: ['RB'] },
  boost: { kb: ['Space'], pad: ['A'] },
} as const satisfies Record<string, { kb: readonly string[]; pad: readonly string[] }>;

export type Bind = keyof typeof BINDS;

/** One keycap. */
export const key = (label: string) => `<kbd class="k-key">${esc(label)}</kbd>`;
/** One pad button: a pill, round for the face buttons. */
export const pad = (label: string) => `<kbd class="k-pad${/^[ABXY]$/.test(label) ? ' face' : ''}">${esc(label)}</kbd>`;

/** Keycaps for the keyboard and buttons for the pad, only one of them showing (by the device used last). */
export function caps(kb: readonly string[], gp: readonly string[]): string {
  const k = kb.map(key).join('');
  const g = gp.map(pad).join('');
  if (!g) return `<span class="k-caps">${k}</span>`;
  return `<span class="k-caps"><span class="kb">${k}</span><span class="gp">${g}</span></span>`;
}

/** A key hint: the caps for `bind`, then what it does. */
export function hint(bind: Bind, label: string): string {
  const b = BINDS[bind];
  return `<span class="k-hint">${caps(b.kb, b.pad)}<span>${esc(label)}</span></span>`;
}

/** A row of hints, along a screen's foot. */
export const hints = (...items: [Bind, string][]) => `<div class="k-hints">${items.map(([b, l]) => hint(b, l)).join('')}</div>`;

type Attrs = Record<string, string | number | boolean | undefined>;
function attrs(a: Attrs = {}): string {
  return Object.entries(a)
    .filter(([, v]) => v !== undefined && v !== false)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(String(v))}"`))
    .join('');
}

export type ButtonKind = 'primary' | 'secondary' | 'small' | 'danger' | 'link' | 'icon';

/** A button: `primary` is the one main action on a screen (the pink shadow), `small` a JOIN. */
export function button(id: string, label: string, kind: ButtonKind = 'secondary', extra: Attrs = {}): string {
  const cls = `k-btn ${kind}${extra.class ? ` ${extra.class}` : ''}`;
  return `<button type="button" id="${esc(id)}"${attrs({ ...extra, class: cls })}><span>${label}</span></button>`;
}

/** One of a screen's big menu actions: leaning, and the focused one opens to say what it does. */
export function menuItem(id: string, label: string, desc = '', danger = false): string {
  return `<button type="button" class="k-item${danger ? ' danger' : ''}" id="${esc(id)}"><b>${esc(label)}</b>${desc ? `<span class="k-desc"><span>${esc(desc)}</span></span>` : ''}</button>`;
}

export type TagKind = 'ice' | 'outline' | 'line' | 'quiet' | 'sun' | 'hot';
/** A little label: READY, PRIVATE, ALL-ROUNDER, BOT. */
export const tag = (label: string, kind: TagKind = 'ice', title = '') => `<span class="k-tag ${kind}"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</span>`;

/** A name as its plate. */
export const plate = (name: string) => `<span class="k-plate">${esc(name || ' ')}</span>`;

/** An on/off switch: a button with `aria-checked`, which `installKit` flips and says so (`change`). */
export function toggle(id: string, on: boolean, label: string, disabled = false): string {
  return `<button type="button" role="switch" class="k-toggle" id="${esc(id)}" aria-checked="${on}" aria-label="${esc(label)}"${disabled ? ' disabled' : ''}><i></i></button>`;
}

export const isToggle = (el: Element | null): el is HTMLButtonElement => el instanceof HTMLButtonElement && el.classList.contains('k-toggle');
export const toggled = (el: HTMLElement | null): boolean => el?.getAttribute('aria-checked') === 'true';

/** A few choices side by side, one lit (Public / Link only, Low / Medium / High): a radio group the arrows step through. */
export function segmented(id: string, opts: [string, string][], value: string, disabled = false): string {
  const at = Math.max(0, opts.findIndex(([v]) => v === value));
  const items = opts.map(([v, l], k) => `<span class="${k === at ? 'on' : ''}" data-v="${esc(v)}">${esc(l)}</span>`).join('');
  return `<button type="button" class="k-seg" id="${esc(id)}" value="${esc(opts[at]?.[0] ?? '')}" data-opts="${esc(JSON.stringify(opts))}"${disabled ? ' disabled' : ''}>${items}</button>`;
}

export const isSegmented = (el: Element | null): el is HTMLButtonElement => el instanceof HTMLButtonElement && el.classList.contains('k-seg');

/** Moves a segmented control `d` along (not round: it's a row you can see the ends of). */
export function stepSegmented(el: HTMLButtonElement, d: number, to?: string): void {
  if (el.disabled) return;
  const opts = JSON.parse(el.dataset.opts ?? '[]') as [string, string][];
  const at = opts.findIndex(([v]) => v === el.value);
  const next = to !== undefined ? opts.findIndex(([v]) => v === to) : Math.max(0, Math.min(opts.length - 1, at + d));
  if (next < 0 || next === at) return;
  el.value = opts[next][0];
  el.querySelectorAll('span').forEach((s, k) => s.classList.toggle('on', k === next));
  el.dispatchEvent(new Event('change'));
}

/** A slider: 0 to 100 in fives, its fill drawn from `--v`. */
export function slider(id: string, value: number, label: string): string {
  const v = Math.round(value);
  return `<input type="range" class="k-slider" id="${esc(id)}" min="0" max="100" step="5" value="${v}" style="--v:${v}%" aria-label="${esc(label)}">`;
}

/** A text field. */
export function field(id: string, value: string, opts: { placeholder?: string; max?: number; search?: boolean; code?: boolean } = {}): string {
  return `<label class="k-field${opts.search ? ' search' : ''}${opts.code ? ' code' : ''}">${opts.search ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>' : ''}<input id="${esc(id)}" value="${esc(value)}" autocomplete="off" spellcheck="false" data-1p-ignore data-lpignore="true"${opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : ''}${opts.max ? ` maxlength="${opts.max}"` : ''}></label>`;
}

/** A label and its control on one line, as the options and settings are laid out. */
export const row = (label: string, control: string, cls = '') => `<div class="k-row${cls ? ` ${cls}` : ''}"><span class="k-label">${esc(label)}</span>${control}</div>`;

/** A rated stat: its name, its number out of ten, and a bar. */
export const stat = (name: string, rating: number) => `<span class="k-stat"><span>${esc(name)}</span><b>${rating}</b><i style="--t:${(rating / 10).toFixed(2)}"></i></span>`;

/** How full something is (a lobby's seats): the count over a bar. */
export const fill = (n: number, of: number) => `<span class="k-fill"><b>${n}/${of}</b><i style="--t:${of ? (n / of).toFixed(2) : 0}"></i></span>`;

/** A screen's header: Esc BACK, the title, then whatever follows it (a tag, a status). */
export function header(title: string, after = '', right = ''): string {
  return `<header class="k-head" data-in="t">
    <button type="button" class="k-back" id="kBack">${caps(BINDS.back.kb, BINDS.back.pad)}<span>Back</span></button>
    <h1 class="k-h1">${esc(title)}</h1>${after}
    <div class="k-headRight">${right}</div>
  </header>`;
}

/** You, top right of the title and the lobby list: your plate, and EDIT. */
export function driverChip(name: string, editable = true): string {
  return `<div class="k-driver"><span class="k-dl">Driver</span>${plate(name)}${editable ? '<button type="button" id="mPlate" class="k-edit" title="Your plate: your name in races">Edit</button>' : ''}</div>`;
}

/** The cog, for Settings. */
export const GEAR =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>';

/** A stat out of ten from a 0–1 share of the range across the classes (stats.ts): never 0. */
export const rating = (t: number) => Math.max(1, Math.min(10, Math.round(1 + t * 9)));

/** A car's job, from its blurb's first words ("All-rounder: …"). */
export const carRole = (blurb = '') => (blurb.includes(':') ? blurb.slice(0, blurb.indexOf(':')).trim() : '');

let installed = false;

/**
 * Once, for the page: switches flip on a press, segmented controls take a click on a choice, and
 * a slider draws its fill as it moves. (Arrows on them are nav.ts's.)
 */
export function installKit(): void {
  if (installed) return;
  installed = true;
  document.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    const sw = target?.closest('.k-toggle') ?? null;
    if (isToggle(sw) && !sw.disabled) {
      sw.setAttribute('aria-checked', String(!toggled(sw)));
      sw.dispatchEvent(new Event('change'));
      return;
    }
    const seg = target?.closest('.k-seg') ?? null;
    if (isSegmented(seg)) {
      const span = target?.closest('span[data-v]') as HTMLElement | null;
      // A press from Enter or the pad (no span under it): on to the next, round.
      if (span) stepSegmented(seg, 0, span.dataset.v);
      else {
        const opts = JSON.parse(seg.dataset.opts ?? '[]') as [string, string][];
        const at = opts.findIndex(([v]) => v === seg.value);
        stepSegmented(seg, 0, opts[(at + 1) % opts.length]?.[0]);
      }
    }
  });
  // The pointer over a menu action or a row takes focus, so what it says follows the mouse as it does the pad.
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = (e.target as Element | null)?.closest('.k-item, .k-lrow') as HTMLElement | null;
    if (el && document.activeElement !== el && !(el as HTMLButtonElement).disabled && !el.closest('[inert]')) el.focus({ preventScroll: true });
  });
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el instanceof HTMLInputElement && el.classList.contains('k-slider')) el.style.setProperty('--v', `${el.value}%`);
  });
}

/** Follows the device used last: `body.pad` shows the pad's buttons in every hint. */
export function showDevice(device: string): void {
  document.body.classList.toggle('pad', device === 'gamepad');
}
