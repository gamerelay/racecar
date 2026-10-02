// Fades between pages (docs/MENU.md): every race, and the menu after one, is a page load
// (`location.search`). The screen goes dark just before one, the crossed flags pulse in the middle
// while the next page loads and builds its map (the loading screen is in index.html, so it's up
// from the first paint), and it lifts once the page has drawn its first frames. The browser's
// reduced-motion setting keeps it short and still.

/** How long the screen takes to go dark before the next page (ms). */
const OUT_MS = 180;
/**
 * The loading screen stays up at least this long from the page's navigation (ms), so a fast load
 * shows the flags rather than a flash of them, and what loads in just after (the fonts, the
 * textures' first upload) has a moment.
 */
const MIN_MS = 700;
/** Up no longer than this (ms) whatever happens: a hidden tab draws no frames, so it'd never be ready. */
const MAX_MS = 5000;

function veil(): HTMLElement {
  let el = document.getElementById('pageFade');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pageFade';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
  }
  return el;
}

let lifted = false;

/** Whether the loading screen is still up: an offline race waits behind it, so its countdown isn't missed. */
export const veiled = (): boolean => !lifted;

function lift(): void {
  if (lifted) return;
  lifted = true;
  const el = veil();
  el.classList.remove('out');
  el.classList.add('in');
}

/** At startup: the loading screen lifts by itself after MAX_MS, if the page never says it's ready. */
export function fadeIn(): void {
  setTimeout(lift, Math.max(0, MAX_MS - performance.now()));
  // Back to this page from the browser's cache (the back button): it was left dark.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    lifted = false;
    lift();
  });
}

/** The page has drawn its first frames: the loading screen lifts, once it's been up MIN_MS. */
export function ready(): void {
  if (lifted) return;
  const quick = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const wait = (quick ? MIN_MS / 2 : MIN_MS) - performance.now();
  // The fonts too (they're the menu's and the HUD's), though not for long.
  void Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1000))]).then(() => setTimeout(lift, Math.max(0, wait)));
}

/** To another page (a race, or the menu after one), once the screen has gone dark. */
export function goTo(search: string): void {
  const el = veil();
  el.classList.remove('in');
  el.classList.add('out');
  const quick = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => (location.search = search), quick ? 60 : OUT_MS);
}
