// Credits, Privacy and Terms (docs/superpowers/specs/2026-10-10-public-polish-design.md): pages in
// the game, not files, since the hosted build is one HTML file. One layer over the title (an
// Overlay, like Settings) with an animated background in the soundtrack art's look; Back, Esc or
// the pad's B return. `?page=credits` (or privacy, terms) opens the title with one up.

import PRIVACY from '../../docs/PRIVACY.md?raw';
import TERMS from '../../docs/TERMS.md?raw';
import { BINDS, caps } from './kit';
import { renderDoc } from './legal';
import { Overlay } from './overlay';

export type Page = 'credits' | 'privacy' | 'terms';
const PAGES: readonly Page[] = ['credits', 'privacy', 'terms'];

/** The page a link asks for (`?page=`), or null. */
export function readPage(v: string | null): Page | null {
  return PAGES.find((p) => p === v) ?? null;
}

const link = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;

const CREDITS = `
  <h1>Credits</h1>
  <p class="pg-lede"><b class="pg-word">RACECAR</b> An arcade street racer for the browser.</p>
  <dl>
    <dt>Made by</dt><dd><b>Colin Teahan</b> and <b>Claude</b> (Anthropic): Colin directing, Claude writing most of the code.</dd>
    <dt>Music</dt><dd>The original soundtrack, by Colin Teahan.</dd>
    <dt>Online</dt><dd>${link('https://gamerelay.io', 'GameRelay')}, multiplayer for browser games. Races travel over Resonance, its relay network.</dd>
    <dt>Source</dt><dd>${link('https://github.com/gamerelay/racecar', 'github.com/gamerelay/racecar')} (MIT). racecar is GameRelay's open-source example game: read how it's built.</dd>
    <dt>Built with</dt><dd>Three.js, TypeScript, Bun and Vite.</dd>
  </dl>`;

/** A page's sheet: Back and its title over the page, which scrolls (the arrows and the pad's d-pad do too). */
export function pageHtml(page: Page): string {
  const doc = (page === 'credits' ? CREDITS : renderDoc(page === 'privacy' ? PRIVACY : TERMS)).trim();
  const title = doc.match(/^<h1>.*?<\/h1>/)?.[0] ?? '';
  return `<div class="k-panel pg-sheet ${page}" role="dialog">
    <header class="pg-top"><button type="button" class="k-back" id="pgBack">${caps(BINDS.back.kb, BINDS.back.pad)}<span>Back</span></button>${title}</header>
    <div class="pg-body" id="pgBody">${doc.slice(title.length)}</div>
  </div>`;
}

/** A palm's silhouette: a leaning trunk and its fronds. */
const PALM = `<svg viewBox="0 0 100 200"><path d="M52 200 C50 150 44 100 50 52 L56 52 C52 100 58 150 60 200 Z"/><path d="M53 50 C34 34 14 38 2 56 C18 44 34 44 53 54 Z M53 50 C70 30 90 32 99 50 C84 40 70 42 54 55 Z M52 50 C40 26 44 8 58 0 C50 16 52 30 55 50 Z M53 52 C30 52 18 68 16 88 C26 70 38 60 54 56 Z M54 52 C74 54 86 70 86 92 C78 72 68 62 53 57 Z"/></svg>`;

/** The background: a sun, a grid running at you, palms, and now and then a car's tail-lights. */
const SCENE = `<div class="pgScene" aria-hidden="true"><div class="pgSun"></div><div class="pgGrid"></div><div class="pgPalm l">${PALM}</div><div class="pgPalm r">${PALM}</div><div class="pgCar"></div></div>`;

export class PagesPanel extends Overlay {
  constructor() {
    super('pages');
    this.el.classList.add('k');
  }

  /** Up or down the page a step (the arrows, the d-pad): the only control on it is Back. */
  scroll(d: -1 | 1): void {
    const body = this.el.querySelector<HTMLElement>('#pgBody');
    body?.scrollBy({ top: d * body.clientHeight * 0.4, behavior: 'smooth' });
  }

  open(page: Page, from?: HTMLElement | null): void {
    this.el.innerHTML = `${SCENE}${pageHtml(page)}`;
    this.el.querySelector<HTMLButtonElement>('#pgBack')!.onclick = () => this.close();
    this.show(from);
    this.el.querySelector<HTMLButtonElement>('#pgBack')!.focus({ preventScroll: true });
  }
}
