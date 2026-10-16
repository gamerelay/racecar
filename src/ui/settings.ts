// Settings and Controls (docs/MENU.md): one panel, two tabs (Q and E, or the pad's bumpers, switch
// them), over whatever's on screen: the title (its cog), or a race (the in-race menu's Settings and
// Controls). Settings: sound and graphics, applied as they change and kept on this device
// (settings.ts). Controls: what each key and pad button does, side by side (read-only: remapping
// is next). Done, Esc or the pad's B close it, back to the button that opened it.

import { chooser } from './chooser';
import { button, caps, hints, key, pad, row, segmented, slider, toggle, toggled } from './kit';
import { Overlay } from './overlay';
import { DEFAULT_SETTINGS, type Quality, type Settings, type SettingsStore } from '../settings';

export type SettingsTab = 'settings' | 'controls';
const TABS: [SettingsTab, string][] = [['settings', 'Settings'], ['controls', 'Controls']];
const QUALITIES: [Quality | 'custom', string][] = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];
const RESOLUTIONS: [string, string][] = [0.5, 0.6, 0.7, 0.8, 0.9, 1].map((r) => [String(r), `${Math.round(r * 100)}%`]);
const VOLUMES: [keyof Settings['volume'], string][] = [['master', 'Master'], ['music', 'Music'], ['engines', 'Engines'], ['effects', 'Effects']];

const or = '<span class="s-or">or</span>';
const note = (t: string) => `<span class="s-note">${t}</span>`;
/** What each key and pad button does: the action, the keyboard's, the pad's. */
const CONTROLS: [string, string, string][] = [
  ['Drive &amp; steer', `${key('W A S D')}${or}${key('↑ ↓ ← →')}`, `${pad('RT')}${pad('LT')}${pad('Left stick')}`],
  ['Drift', `${key('Shift')}${note('hold while steering')}`, `${pad('RB')}${or}${pad('X')}`],
  ['Boost', key('Space'), pad('A')],
  ['Reset to road', key('R'), pad('Y')],
  ['Look back', `${key('Q')}${or}${key('C')}${note('hold: the car keeps driving')}`, `${pad('B')}${note('hold')}`],
  ['Horn', key('H'), pad('Left stick click')],
  ['Pause', key('Esc'), pad('Start')],
  ['Sound', `${key('M')}${note('mute')}${key('N')}${note('music')}${key('− +')}${note('track')}`, note('—')],
];

export class SettingsPanel extends Overlay {
  private current: SettingsTab = 'settings';

  constructor(private readonly store: SettingsStore) {
    super('settings');
    this.el.classList.add('k');
    // A graphics preset changes the settings under it: those redraw. Volumes don't (a redraw would
    // drop the slider being dragged).
    let graphics = '';
    store.onChange((s) => {
      const g = JSON.stringify(s.graphics);
      if (g !== graphics && this.isOpen && this.current === 'settings') this.render(false);
      graphics = g;
    });
  }

  /** Opens it on `tab`; `from` is where focus goes back to. */
  open(from?: HTMLElement | null, tab: SettingsTab = 'settings'): void {
    this.current = tab;
    this.el.innerHTML = `<div class="k-panel s-sheet" role="dialog" aria-label="Settings">
      <div class="s-top"><div class="k-tabs" role="tablist">${TABS.map(([t, l]) => `<button type="button" role="tab" class="k-tab" id="sTab-${t}" data-tab="${t}">${l}</button>`).join('')}</div>${hints(['tab', 'Switch tab'])}</div>
      <div class="s-body" id="sBody"></div>
      <div class="s-foot"><span id="sFootLeft"></span><span class="s-acts">${hints(['back', 'Back'])}${button('sDone', 'Done', 'primary')}</span></div>
    </div>`;
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('.k-tab')) b.onclick = () => this.switchTo(b.dataset.tab as SettingsTab, b.dataset.tab === 'settings' ? -1 : 1);
    document.getElementById('sDone')!.onclick = () => this.close();
    // A click on the dim round it closes it, as Done does.
    this.el.onclick = (e) => e.target === this.el && this.close();
    this.render(false);
    this.show(from);
    this.focusFirst();
  }

  /** The next or previous tab (Q and E, the pad's bumpers). */
  tab(d: number): void {
    const at = TABS.findIndex(([t]) => t === this.current);
    this.switchTo(TABS[(at + d + TABS.length) % TABS.length][0], d);
  }

  private switchTo(tab: SettingsTab, d: number): void {
    if (tab === this.current) return;
    this.current = tab;
    document.getElementById('sBody')?.setAttribute('data-from', d < 0 ? 'left' : 'right');
    this.render(true);
    this.focusFirst();
  }

  private focusFirst(): void {
    const first = this.current === 'settings' ? document.getElementById('vol-master') : document.getElementById('sDone');
    first?.focus({ preventScroll: true });
  }

  /** Draws the tab that's up; `swap`: another tab was up, so this one slides in. */
  private render(swap: boolean): void {
    const body = document.getElementById('sBody');
    if (!body) return;
    for (const b of this.el.querySelectorAll<HTMLElement>('.k-tab')) {
      const on = b.dataset.tab === this.current;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    const was = document.activeElement?.id;
    body.innerHTML = this.current === 'settings' ? this.settingsHtml() : this.controlsHtml();
    document.getElementById('sFootLeft')!.innerHTML = this.current === 'settings' ? button('sReset', 'Reset to defaults', 'link') : '<span class="k-muted">Changing the keys is coming soon.</span>';
    body.classList.remove('swap');
    if (swap) {
      void body.offsetWidth;
      body.classList.add('swap');
    }
    if (this.current === 'settings') this.wire();
    // Redrawn in place (a preset changed): focus stays where it was.
    if (!swap && was) document.getElementById(was)?.focus({ preventScroll: true });
  }

  private settingsHtml(): string {
    const s = this.store.get();
    const g = s.graphics;
    const sliders = VOLUMES.map(([k, name]) => row(name, `<span class="s-slide">${slider(`vol-${k}`, s.volume[k] * 100, name)}<b class="k-num" id="vol-${k}-v">${Math.round(s.volume[k] * 100)}</b></span>`, 's-vol')).join('');
    const qualities: [string, string][] = g.quality === 'custom' ? [...QUALITIES, ['custom', 'Custom']] : QUALITIES;
    const keys = ([['M', 'Mute all'], ['N', 'Music on/off'], ['− +', 'Track']] as const).map(([k, l]) => `<span class="k-hint">${caps([k], [])}<span>${l}</span></span>`).join('');
    return `<div class="s-cols">
      <section><h2 class="k-h2 ice">Sound</h2>${sliders}<div class="s-keys k-hints">${keys}</div></section>
      <section><h2 class="k-h2 ice">Graphics</h2>
        ${row('Quality', segmented('gQuality', qualities, g.quality))}
        ${row('Resolution', chooser('gRes', RESOLUTIONS, String(g.resolution)))}
        ${row('Post effects', toggle('gPost', g.post, 'Post effects'))}
        ${row('Outlines', toggle('gOutline', g.outline, 'Outlines'))}
        ${row('Show FPS', toggle('gFps', g.fps, 'Show FPS'))}
        <p class="s-hint k-muted">Lower quality runs smoother on slower devices. Turning post effects back on smooths edges from the next race.</p>
      </section>
    </div>`;
  }

  private controlsHtml(): string {
    const rows = CONTROLS.map(([a, kb, gp]) => `<div class="s-crow"><b>${a}</b><span>${kb}</span><span>${gp}</span></div>`).join('');
    return `<div class="s-ctable">
      <div class="s-crow s-chead"><span>Action</span><span>Keyboard</span><span>Gamepad</span></div>
      ${rows}
      <div class="s-crow s-felt"><b>Felt wrong?</b><span>${key('F8')}${note('saves the last 30 s with a note')}</span><span>${pad('Select')}<span class="s-or">+</span>${pad('Start')}</span></div>
    </div>`;
  }

  private wire(): void {
    for (const [k] of VOLUMES) {
      const input = document.getElementById(`vol-${k}`) as HTMLInputElement;
      input.oninput = () => {
        document.getElementById(`vol-${k}-v`)!.textContent = input.value;
        this.store.set({ volume: { [k]: Number(input.value) / 100 } });
      };
    }
    const on = (id: string, fn: (el: HTMLButtonElement) => void) => {
      const el = document.getElementById(id) as HTMLButtonElement | null;
      if (el) el.onchange = () => fn(el);
    };
    on('gQuality', (el) => el.value !== 'custom' && this.store.set({ graphics: { quality: el.value as Quality } }));
    on('gRes', (el) => this.store.set({ graphics: { resolution: Number(el.value) } }));
    on('gPost', (el) => this.store.set({ graphics: { post: toggled(el) } }));
    on('gOutline', (el) => this.store.set({ graphics: { outline: toggled(el) } }));
    on('gFps', (el) => this.store.set({ graphics: { fps: toggled(el) } }));
    const reset = document.getElementById('sReset');
    if (reset)
      reset.onclick = () => {
        this.store.set({ volume: DEFAULT_SETTINGS.volume, graphics: DEFAULT_SETTINGS.graphics });
        // The volumes don't redraw by themselves (a slider being dragged would drop): this does.
        this.render(false);
        document.getElementById('sReset')?.focus({ preventScroll: true });
      };
  }
}
