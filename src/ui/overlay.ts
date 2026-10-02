// A panel over whatever's on screen (Settings, Controls): what's behind it can't be tabbed to or
// pressed while it's up, and closing it gives focus back to the button that opened it.

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
    }
    this.el.classList.add('on');
  }

  close(): void {
    this.el.classList.remove('on');
    for (const c of this.stilled) c.inert = false;
    this.stilled = [];
    // The button may have been drawn again meanwhile (the title's list refreshes): the new one, by its id.
    const back = this.from?.isConnected ? this.from : this.from?.id ? document.getElementById(this.from.id) : null;
    back?.focus({ preventScroll: true });
    this.from = null;
  }
}
