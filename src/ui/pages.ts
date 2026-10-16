// Credits, Privacy and Terms (docs/superpowers/specs/2026-10-10-public-polish-design.md): pages in
// the game, not files, since the hosted build is one HTML file. One layer over the title (an
// Overlay, like Settings) with an animated background in the soundtrack art's look; Back, Esc or
// the pad's B return. `?page=credits` (or privacy, terms) opens the title with one up. Behind the
// credits it's drawn live (render/credits.ts): a chrome Vanta doing donuts and figure 8s.

import PRIVACY from '../../docs/PRIVACY.md?raw';
import TERMS from '../../docs/TERMS.md?raw';
import { PALM_PATHS } from './palm';
import { BINDS, caps } from './kit';
import { renderDoc } from './legal';
import { Overlay } from './overlay';

export type Page = 'credits' | 'privacy' | 'terms';

/** The credits' live backdrop (render/credits.ts), as the panel uses it: main.ts hands it one. */
export interface LiveBackdrop {
  readonly canvas: HTMLCanvasElement;
  readonly running: boolean;
  start(): void;
  stop(): void;
}
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
const PALM = `<svg viewBox="0 0 100 200">${PALM_PATHS.map((d) => `<path d="${d}"/>`).join('')}</svg>`;

/** The background: a sun, a grid running at you, palms, and now and then a car's tail-lights. The credits' live one goes over it; without WebGL, this is what shows. */
const SCENE = `<div class="pgScene" aria-hidden="true"><div class="pgSun"></div><div class="pgGrid"></div><div class="pgPalm l">${PALM}</div><div class="pgPalm r">${PALM}</div><div class="pgCar"></div></div>`;

export class PagesPanel extends Overlay {
  /** The credits' live backdrop: made the first time they open (null: no WebGL here). */
  private backdrop: LiveBackdrop | null | undefined;

  /** `live` makes the credits' live backdrop (null where it can't); without it they keep the CSS scene. */
  constructor(private readonly live: () => LiveBackdrop | null = () => null) {
    super('pages');
    this.el.classList.add('k');
  }

  /** The live backdrop is up, over everything: the world behind needn't be drawn. */
  get coversWorld(): boolean {
    return this.isOpen && !!this.backdrop?.running;
  }

  /** Up or down the page a step (the arrows, the d-pad): the only control on it is Back. */
  scroll(d: -1 | 1): void {
    const body = this.el.querySelector<HTMLElement>('#pgBody');
    body?.scrollBy({ top: d * body.clientHeight * 0.4, behavior: 'smooth' });
  }

  open(page: Page, from?: HTMLElement | null): void {
    this.el.innerHTML = `${SCENE}${pageHtml(page)}`;
    if (page === 'credits' && this.backdrop === undefined) this.backdrop = this.live();
    const live = page === 'credits' && !!this.backdrop;
    this.el.classList.toggle('live', live);
    if (live) {
      this.el.prepend(this.backdrop!.canvas);
      this.backdrop!.start();
    } else this.backdrop?.stop();
    this.el.querySelector<HTMLButtonElement>('#pgBack')!.onclick = () => this.close();
    this.show(from);
    this.el.querySelector<HTMLButtonElement>('#pgBack')!.focus({ preventScroll: true });
  }

  override close(): void {
    super.close();
    this.backdrop?.stop();
  }
}
