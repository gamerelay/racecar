// The Controls screen (docs/MENU.md), from the in-race menu: what each key and gamepad button does.
// Read-only for now: it's where remapping goes (step 3). Back, Esc or the pad's B close it, back to the button that opened it.

export class ControlsPanel {
  readonly el: HTMLElement;
  private from: HTMLElement | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'controls';
    document.body.appendChild(this.el);
  }

  get isOpen(): boolean {
    return this.el.classList.contains('on');
  }

  open(from?: HTMLElement | null): void {
    this.from = from ?? (document.activeElement as HTMLElement | null);
    this.el.innerHTML = `<div class="card controls">
      <h1>Controls</h1>
      <dl>
        <dt>Drive</dt><dd>WASD or the arrows; on a gamepad, RT and LT, and the left stick to steer</dd>
        <dt>Drift</dt><dd>Shift (RB or X), held while steering</dd>
        <dt>Boost</dt><dd>Space (A)</dd>
        <dt>Reset</dt><dd>R (Y): back on the road</dd>
        <dt>Look back</dt><dd>C (B)</dd>
        <dt>Horn</dt><dd>H</dd>
        <dt>Menu</dt><dd>Esc (Start)</dd>
        <dt>Sound</dt><dd>M mutes everything, N turns the music on or off</dd>
        <dt>Felt wrong?</dt><dd>F8 (Select+Start) saves the last 30 s with a note</dd>
      </dl>
      <p class="muted">Changing the keys is coming next.</p>
      <div class="row stack"><button id="cBack" class="ghost">Back</button></div>
    </div>`;
    document.getElementById('cBack')!.onclick = () => this.close();
    this.el.classList.add('on');
    document.getElementById('cBack')!.focus({ preventScroll: true });
  }

  close(): void {
    this.el.classList.remove('on');
    this.el.innerHTML = '';
    this.from?.focus({ preventScroll: true });
    this.from = null;
  }
}
