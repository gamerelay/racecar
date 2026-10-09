// Inside a post on X: GameRelay's short links send X a player card that plays this page with
// `?embed=1` in a 480×480 frame. Every race and menu is a page load of its own (ui/fade.ts), and
// the host lets X frame only `?embed=1` pages, so the flag rides along each one. A button opens
// the full game in a tab, in the same lobby.

// No page in the tests (Bun): never embedded there.
export const EMBED = typeof location !== 'undefined' && new URLSearchParams(location.search).has('embed');

/** A page's query (`?a=1` or `a=1`), with the embed flag kept when we're in the frame. */
export function keepEmbed(search: string): string {
  if (!EMBED) return search;
  const q = new URLSearchParams(search);
  q.set('embed', '1');
  return `?${q}`;
}

/** The chase mode's map (docs/CHASE_MODE.md): a getaway is a race on it. */
export const GETAWAY_MAP = 'heist/city';

/**
 * A page that starts a getaway (main.ts), so a link plays at once: the X card's first page
 * (`?embed=1`), or the game's link (`?start=getaway`, its play URL on GameRelay, which people who
 * open the card's link land on). Nothing else may be in the address: a room's `join`, a lobby, or
 * the menu after a race (which keeps your choices) stays what it is.
 */
export function startsGetaway(q: URLSearchParams): boolean {
  const asked = q.has('embed') || q.get('start') === 'getaway';
  return asked && [...q.keys()].every((k) => k === 'embed' || k === 'start');
}

/** This page without the flag: the full game. */
function fullPage(): string {
  const u = new URL(location.href);
  u.searchParams.delete('embed');
  return u.href;
}

/** In the frame: the "Open full game" button, which opens a tab (navigating X's frame goes nowhere useful). */
export function installEmbed(): void {
  if (!EMBED) return;
  document.body.classList.add('embed');
  const a = document.createElement('a');
  a.id = 'embedOpen';
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = 'Open full game ↗';
  a.href = fullPage();
  // The menu rewrites the address (a lobby's `?lobby=`), so take it as it is at the click.
  a.onclick = () => (a.href = fullPage());
  document.body.append(a);
}
