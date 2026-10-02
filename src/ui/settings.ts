// The Settings panel (docs/MENU.md): sound, graphics and privacy, over whatever's on screen: the
// title (its Settings button) or a race (the in-race menu's). The same panel everywhere. Changes
// apply as they're made and are kept on this device (settings.ts); Done, Esc or the pad's B close
// it, back to the button that opened it.

import { chooser } from './chooser';
import { Overlay } from './overlay';
import type { Quality, Settings, SettingsStore } from '../settings';

const ON_OFF: [string, string][] = [['1', 'On'], ['0', 'Off']];
const QUALITIES: [Quality, string][] = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];
const RESOLUTIONS: [string, string][] = [0.5, 0.6, 0.7, 0.8, 0.9, 1].map((r) => [String(r), `${Math.round(r * 100)}%`]);
const VOLUMES: [keyof Settings['volume'], string][] = [['master', 'Master'], ['music', 'Music'], ['engines', 'Engines'], ['effects', 'Effects']];

export class SettingsPanel extends Overlay {
  constructor(
    private readonly store: SettingsStore,
    /** Whether this build sends analytics at all (it has a PostHog key). */
    private readonly analyticsBuilt: boolean,
  ) {
    super('settings');
    // A graphics preset changes the settings under it: those redraw. Volumes don't (a redraw would
    // drop the slider being dragged).
    let graphics = '';
    store.onChange((s) => {
      const g = JSON.stringify(s.graphics);
      if (g !== graphics && this.isOpen) this.render();
      graphics = g;
    });
  }

  /** Opens it; `from` is where focus goes back to. */
  open(from?: HTMLElement | null): void {
    this.render();
    this.show(from);
    (document.getElementById('vol-master') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  private render(): void {
    const s = this.store.get();
    const g = s.graphics;
    const was = document.activeElement?.id;
    const sliders = VOLUMES.map(
      ([k, name]) => `<label class="slider"><span>${name}</span><input type="range" id="vol-${k}" min="0" max="100" step="5" value="${Math.round(s.volume[k] * 100)}"><b id="vol-${k}-v">${Math.round(s.volume[k] * 100)}</b></label>`,
    ).join('');
    const qualities: [string, string][] = g.quality === 'custom' ? [...QUALITIES, ['custom', 'Custom']] : QUALITIES;
    const analytics = this.analyticsBuilt
      ? `<label>Analytics ${chooser('sAnalytics', ON_OFF, s.analytics ? '1' : '0')}</label><p class="muted">Anonymous playtest data (laps, crashes, frame rates; no names) that helps tune the game. Off sends nothing more.</p>`
      : '<p class="muted">This build sends no analytics.</p>';
    this.el.innerHTML = `<div class="card settings">
      <h1>Settings</h1>
      <h2>Sound</h2>
      <div class="sliders">${sliders}</div>
      <p class="muted">M mutes everything, N turns the music on or off.</p>
      <h2>Graphics</h2>
      <div class="grid">
        <label>Quality ${chooser('gQuality', qualities, g.quality)}</label>
        <label>Resolution ${chooser('gRes', RESOLUTIONS, String(g.resolution))}</label>
        <label>Post effects ${chooser('gPost', ON_OFF, g.post ? '1' : '0')}</label>
        <label>Outlines ${chooser('gOutline', ON_OFF, g.outline ? '1' : '0')}</label>
        <label>Show FPS ${chooser('gFps', ON_OFF, g.fps ? '1' : '0')}</label>
      </div>
      <p class="muted">Lower quality runs smoother on slower devices. Turning post effects back on smooths edges from the next race.</p>
      <h2>Privacy</h2>
      ${analytics}
      <div class="row"><button id="sDone">Done</button></div>
    </div>`;
    for (const [k] of VOLUMES) {
      const input = document.getElementById(`vol-${k}`) as HTMLInputElement;
      input.oninput = () => {
        document.getElementById(`vol-${k}-v`)!.textContent = input.value;
        this.store.set({ volume: { [k]: Number(input.value) / 100 } });
      };
    }
    const on = (id: string, fn: (v: string) => void) => {
      const el = document.getElementById(id) as HTMLButtonElement | null;
      if (el) el.onchange = () => fn(el.value);
    };
    on('gQuality', (v) => v !== 'custom' && this.store.set({ graphics: { quality: v as Quality } }));
    on('gRes', (v) => this.store.set({ graphics: { resolution: Number(v) } }));
    on('gPost', (v) => this.store.set({ graphics: { post: v === '1' } }));
    on('gOutline', (v) => this.store.set({ graphics: { outline: v === '1' } }));
    on('gFps', (v) => this.store.set({ graphics: { fps: v === '1' } }));
    on('sAnalytics', (v) => this.store.set({ analytics: v === '1' }));
    document.getElementById('sDone')!.onclick = () => this.close();
    // Redrawn (a preset changed): focus stays where it was.
    if (was && this.isOpen) document.getElementById(was)?.focus({ preventScroll: true });
  }
}
