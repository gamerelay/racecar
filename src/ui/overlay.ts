// A panel over whatever's on screen (Settings, Controls): what's behind it can't be tabbed to or
// pressed while it's up, and closing it gives focus back to the button that opened it.

/** How many overlays are up, and who wants to know when that changes. */
let up = 0;
const watchers = new Set<() => void>();

/**
 * Whether an overlay is up. Something that sets its own `inert` (the menu, while a screen fades
 * out) has to keep it set while one is: an overlay makes the rest inert when it opens, but a
 * redraw that clears it after would let Tab back into what's behind.
 */
export const overlayUp = (): boolean => up > 0;

/** Calls `fn` when an overlay opens or closes, after the rest has been made inert or given back. */
export function onOverlay(fn: () => void): void {
  watchers.add(fn);
}

export class Overlay {
  readonly el: HTMLElement;
  /** Where focus goes back to on close. */
  private from: HTMLElement | null = null;
  /** What this made inert, to give back on close (what was inert already stays so). */
  private stilled: HTMLElement[] = [];

  constructor(id: string) {
    this.el = document.createElement('div');
    this.el.id = id;
    document.body.appendChild(this.el);
  }

  get isOpen(): boolean {
    return this.el.classList.contains('on');
  }

  /** Shows it; `from` is where focus goes back to (the button that opened it: a click may not focus it). */
  protected show(from?: HTMLElement | null): void {
    if (!this.isOpen) {
      this.from = from ?? (document.activeElement as HTMLElement | null);
      this.stilled = [...document.body.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c !== this.el && !c.inert);
      for (const c of this.stilled) c.inert = true;
      up++;
      this.el.classList.add('on');
      for (const fn of watchers) fn();
    }
  }

  close(): void {
    if (this.isOpen) {
      this.el.classList.remove('on');
      for (const c of this.stilled) c.inert = false;
      this.stilled = [];
      up--;
      for (const fn of watchers) fn();
    }
    // The button may have been drawn again meanwhile (the title's list refreshes): the new one, by its id.
    const back = this.from?.isConnected ? this.from : this.from?.id ? document.getElementById(this.from.id) : null;
    back?.focus({ preventScroll: true });
    this.from = null;
  }
}
