// Fades between pages (docs/MENU.md): every race, and the menu after one, is a page load
// (`location.search`), so the screen goes dark just before one and comes up out of the dark
// after it, instead of jumping. The browser's reduced-motion setting keeps it short.

/** How long the screen takes to go dark before the next page (ms). */
const OUT_MS = 180;

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

/** The page comes up out of the dark (once, at startup). */
export function fadeIn(): void {
  const el = veil();
  el.classList.add('in');
  // Back to this page from the browser's cache (the back button): it was left dark.
  window.addEventListener('pageshow', (e) => e.persisted && el.classList.remove('out'));
}

/** To another page (a race, or the menu after one), once the screen has gone dark. */
export function goTo(search: string): void {
  const el = veil();
  el.classList.add('out');
  const quick = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => (location.search = search), quick ? 60 : OUT_MS);
}
