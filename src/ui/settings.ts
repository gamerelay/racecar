// Settings and Controls (docs/MENU.md): one panel, two tabs (Q and E, or the pad's bumpers, switch
// them), over whatever's on screen: the title (its cog), or a race (the in-race menu's Settings and
// Controls). Settings: sound and graphics, applied as they change and kept on this device
// (settings.ts). Controls: the controller's buttons, then the keyboard's keys, each action's two
// set by pressing the new one (a key or button another action has swaps over: bindings.ts), with
// the pad's deadzone, rumble and steering. Done, Esc or the pad's B close it, back to the button
// that opened it.

import { chooser } from './chooser';
import { esc } from './html';
import { button, caps, hints, key, pad, row, segmented, slider, toggle, toggled } from './kit';
import { Overlay } from './overlay';
import { ACTION_NAMES, assignKey, assignPad, DEFAULT_KEYS, DEFAULT_PAD, DRIVE_ACTIONS, keyLabel, PAD_ACTIONS, padLabel, type DriveAction, type Moved, type PadAction, type PadBind } from '../input/bindings';
import type { Heard } from '../input/input';
import { DEFAULT_SETTINGS, MAX_DEADZONE, type Quality, type Settings, type SettingsStore } from '../settings';

/** What the Controls tab needs of Input: to hear the next key or button, and a buzz to feel rumble by. */
export interface Listener {
  listen(kind: 'key' | 'pad', fn: (h: Heard) => void): void;
  stopListening(): void;
  rumble(strong: number, weak: number, ms: number): void;
}

export type SettingsTab = 'settings' | 'controls';
const TABS: [SettingsTab, string][] = [['settings', 'Settings'], ['controls', 'Controls']];
const QUALITIES: [Quality | 'custom', string][] = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];
const RESOLUTIONS: [string, string][] = [0.5, 0.6, 0.7, 0.8, 0.9, 1].map((r) => [String(r), `${Math.round(r * 100)}%`]);
const VOLUMES: [keyof Settings['volume'], string][] = [['master', 'Master'], ['music', 'Music'], ['engines', 'Engines'], ['effects', 'Effects']];

type Device = 'pad' | 'kb';
/** A binding's cell: which device, which action, which of its two. */
interface Cell {
  dev: Device;
  action: DriveAction;
  slot: 0 | 1;
}
const cellId = (c: Cell) => `cb-${c.dev}-${c.action}-${c.slot}`;
/** A key, or a pad button from what Input heard ("b9", "a0"), by name. */
const heardName = (r: string) => (/^b\d+$/.test(r) ? padLabel({ b: Number(r.slice(1)) }) : /^a[01]$/.test(r) ? 'The left stick' : keyLabel(r));
/** Why a key or button can't be taken. */
const whyNot = (r: string) =>
  r === 'b9' ? 'Start is the menu' : r === 'b8' ? 'Select is for "felt wrong"' : /^a[01]$/.test(r) ? 'The left stick steers' : /^b\d+$/.test(r) ? `${heardName(r)} is the system's` : r === 'Escape' ? 'Esc is the menu' : `${keyLabel(r)} is the game's`;

export class SettingsPanel extends Overlay {
  private current: SettingsTab = 'settings';
  /** The binding being set (listening for its key or button), if any. */
  private setting: (Cell & { refused?: string }) | null = null;
  /** What the last change did, under the tables, and the cell it moved another action to (rung for a moment). */
  private said = '';
  private movedTo = '';
  /** Space, set as a binding, clicks the cell under it as it's let go: that's not another listen. */
  private spaceDown = false;

  constructor(
    private readonly store: SettingsStore,
    private readonly input?: Listener,
  ) {
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
    // A click on the other tab while one's being set: that's a cancel.
    if (this.setting) {
      this.setting = null;
      this.input?.stopListening();
    }
    this.current = tab;
    document.getElementById('sBody')?.setAttribute('data-from', d < 0 ? 'left' : 'right');
    this.render(true);
    this.focusFirst();
  }

  private focusFirst(): void {
    const first = this.current === 'settings' ? document.getElementById('vol-master') : document.getElementById(document.body.classList.contains('pad') ? 'cb-pad-throttle-0' : 'cb-kb-throttle-0');
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
    body.classList.toggle('c-on', this.current === 'controls');
    this.foot();
    body.classList.remove('swap');
    if (swap) {
      void body.offsetWidth;
      body.classList.add('swap');
    }
    if (this.current === 'settings') this.wire();
    else this.wireControls();
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

  /** The foot's left: Reset to defaults on Settings; on Controls, what the last change did, or the prompt while one's being set. */
  private foot(): void {
    const left = document.getElementById('sFootLeft');
    if (!left) return;
    left.className = '';
    // While one's being set, B (and Esc) cancel it, not go back: the Back hint goes.
    left.parentElement?.classList.toggle('listening', !!this.setting);
    if (this.current === 'settings') {
      left.innerHTML = button('sReset', 'Reset to defaults', 'link');
      return;
    }
    const c = this.setting;
    if (c) {
      left.className = 'c-prompt';
      const what = c.dev === 'pad' ? 'a button' : 'a key';
      const how = c.dev === 'pad' ? `${pad('B')}<span>cancels</span><span class="s-or">·</span><span>hold</span>${pad('B')}<span>to use B</span>` : `${key('Esc')}<span>cancels</span>`;
      left.innerHTML = `<b class="c-ask">Press ${what} for ${esc(ACTION_NAMES[c.action])}</b><span class="c-how">${c.refused ? `<span class="c-no">${esc(c.refused)}: pick another.</span>` : ''}${how}</span>`;
      return;
    }
    left.innerHTML = `<span class="c-said" id="cSaid">${esc(this.said)}</span>${hints(['confirm', 'Change'], ['clear', 'Clear'])}`;
  }

  private controlsHtml(): string {
    const s = this.store.get().controls;
    const cell = (c: Cell) => {
      const label = c.dev === 'kb' ? keyLabel(s.keys[c.action][c.slot]) : padLabel(s.pad[c.action as PadAction][c.slot]);
      const on = this.setting && cellId(this.setting) === cellId(c);
      const moved = !on && this.movedTo === cellId(c);
      const face = on ? '<span class="c-wait">Press…</span>' : label ? (c.dev === 'kb' ? key(label) : pad(label)) : '<span class="c-none">—</span>';
      const name = `${ACTION_NAMES[c.action]}, ${c.slot ? 'alternate' : 'primary'} ${c.dev === 'kb' ? 'key' : 'button'}: ${label || 'none'}`;
      return `<button type="button" class="c-bind${on ? ' on' : ''}${moved ? ' moved' : ''}" id="${cellId(c)}" data-dev="${c.dev}" data-act="${c.action}" data-slot="${c.slot}" aria-label="${esc(name)}">${face}</button>`;
    };
    const rows = (dev: Device, actions: readonly DriveAction[]) =>
      actions.map((a) => {
        const has = dev === 'kb' ? s.keys[a].some(Boolean) : s.pad[a as PadAction].some(Boolean);
        return `<div class="c-row"><b>${ACTION_NAMES[a]}${has ? '' : ' <span class="c-warn">none</span>'}</b>${cell({ dev, action: a, slot: 0 })}${cell({ dev, action: a, slot: 1 })}</div>`;
      }).join('');
    const head = (a: string, b: string) => `<div class="c-row c-chead"><span>Action</span><span>${a}</span><span>${b}</span></div>`;
    /** The keys and buttons that are always the same, then Reset at the end of the line. */
    const fixed = (items: [string, string][], reset: string) => `<div class="c-fixed k-hints">${items.map(([k, l]) => `<span class="k-hint">${k}<span>${l}</span></span>`).join('')}${reset}</div>`;
    const dz = Math.round((s.deadzone / MAX_DEADZONE) * 100);
    const sens = Math.round(s.sensitivity * 100);
    return `<div class="s-cols c-cols">
      <section class="c-dev"><h2 class="k-h2 ice">Controller</h2>
        <div class="c-table">${head('Button', 'Or')}
          <div class="c-row"><b>Steer</b><span class="c-fixedCell">${pad('Left stick')}</span></div>
          ${rows('pad', PAD_ACTIONS)}
        </div>
        ${row('Rumble', `<span class="s-slide c-slide">${toggle('cRumble', s.rumble, 'Rumble')}</span>`, 's-vol')}
        ${row('Deadzone', `<span class="s-slide c-slide">${slider('cDead', dz, 'Deadzone')}<b class="k-num" id="cDead-v">${Math.round(s.deadzone * 100)}%</b></span>`, 's-vol')}
        ${row('Steering sensitivity', `<span class="s-slide c-slide">${slider('cSens', sens, 'Steering sensitivity')}<b class="k-num" id="cSens-v">${sens}</b></span>`, 's-vol')}
        ${fixed([[pad('Start'), 'Menu'], [`${pad('Select')}<span class="s-or">+</span>${pad('Start')}`, 'Felt wrong?']], button('cResetPad', 'Reset the controller', 'link', { class: 'c-reset' }))}
      </section>
      <section class="c-dev"><h2 class="k-h2 ice">Keyboard</h2>
        <div class="c-table">${head('Key', 'Or')}${rows('kb', DRIVE_ACTIONS)}</div>
        ${fixed([[key('Esc'), 'Menu'], [key('M'), 'Mute'], [key('N'), 'Music'], [key('− +'), 'Track'], [key('F8'), 'Felt wrong?']], button('cResetKb', 'Reset the keys', 'link', { class: 'c-reset' }))}
      </section>
    </div>`;
  }

  private wireControls(): void {
    for (const el of this.el.querySelectorAll<HTMLButtonElement>('.c-bind'))
      el.onclick = () => {
        if (this.spaceDown || this.setting) return;
        this.startSetting({ dev: el.dataset.dev as Device, action: el.dataset.act as DriveAction, slot: Number(el.dataset.slot) as 0 | 1 });
      };
    const dead = document.getElementById('cDead') as HTMLInputElement | null;
    if (dead)
      dead.oninput = () => {
        const dz = (Number(dead.value) / 100) * MAX_DEADZONE;
        document.getElementById('cDead-v')!.textContent = `${Math.round(dz * 100)}%`;
        this.store.set({ controls: { deadzone: dz } });
      };
    const sens = document.getElementById('cSens') as HTMLInputElement | null;
    if (sens)
      sens.oninput = () => {
        document.getElementById('cSens-v')!.textContent = sens.value;
        this.store.set({ controls: { sensitivity: Number(sens.value) / 100 } });
      };
    const rumble = document.getElementById('cRumble') as HTMLButtonElement | null;
    if (rumble)
      rumble.onchange = () => {
        this.store.set({ controls: { rumble: toggled(rumble) } });
        // Turned on: a short buzz, to feel it.
        if (toggled(rumble)) this.input?.rumble(0.5, 0.5, 180);
      };
    const reset = (id: string, dev: Device) => {
      const el = document.getElementById(id);
      if (el)
        el.onclick = () => {
          const d = DEFAULT_SETTINGS.controls;
          this.store.set({ controls: dev === 'kb' ? { keys: DEFAULT_KEYS } : { pad: DEFAULT_PAD, deadzone: d.deadzone, rumble: d.rumble, sensitivity: d.sensitivity } });
          this.said = dev === 'kb' ? 'The keys are back to their defaults.' : "The controller's back to its defaults.";
          this.render(false);
          document.getElementById(id)?.focus({ preventScroll: true });
        };
    };
    reset('cResetKb', 'kb');
    reset('cResetPad', 'pad');
  }

  /** Listens for the cell's new key or button. */
  private startSetting(c: Cell): void {
    if (!this.input) return;
    this.setting = c;
    this.said = '';
    this.movedTo = '';
    this.render(false);
    document.getElementById(cellId(c))?.focus({ preventScroll: true });
    this.input.listen(c.dev === 'pad' ? 'pad' : 'key', (h) => {
      if ('reserved' in h) {
        this.setting = { ...c, refused: whyNot(h.reserved) };
        return this.foot();
      }
      this.setting = null;
      if ('key' in h && h.key === 'Space') {
        this.spaceDown = true;
        // Its click comes after its keyup: let it by first.
        const up = (e: KeyboardEvent) => e.code === 'Space' && (window.removeEventListener('keyup', up), setTimeout(() => (this.spaceDown = false)));
        window.addEventListener('keyup', up);
      }
      if ('key' in h) this.bind(c, h.key);
      else if ('pad' in h) this.bind(c, h.pad);
      this.render(false);
      document.getElementById(cellId(c))?.focus({ preventScroll: true });
    });
  }

  /** The focused cell's binding cleared (Delete, Backspace, the pad's X). */
  clear(): void {
    const el = document.activeElement as HTMLElement | null;
    if (!this.isOpen || this.current !== 'controls' || this.setting || !el?.classList.contains('c-bind')) return;
    const c: Cell = { dev: el.dataset.dev as Device, action: el.dataset.act as DriveAction, slot: Number(el.dataset.slot) as 0 | 1 };
    this.bind(c, null);
    this.render(false);
  }

  /** Sets (or clears) a cell's binding; one another action had swaps over to it. Says what moved. */
  private bind(c: Cell, value: string | PadBind | null): void {
    const s = this.store.get().controls;
    let moved: Moved<string> | Moved<PadBind | null> | null;
    let name: string;
    if (c.dev === 'kb') {
      const r = assignKey(s.keys, c.action, c.slot, (value as string | null) ?? '');
      this.store.set({ controls: { keys: r.binds } });
      moved = r.moved;
      name = keyLabel((value as string | null) ?? '');
    } else {
      const r = assignPad(s.pad, c.action as PadAction, c.slot, value as PadBind | null);
      this.store.set({ controls: { pad: r.binds } });
      moved = r.moved;
      name = padLabel(value as PadBind | null);
    }
    const thing = c.dev === 'kb' ? 'key' : 'button';
    const now = (m: { now: string | PadBind | null }) => (c.dev === 'kb' ? keyLabel(m.now as string) : padLabel(m.now as PadBind | null));
    this.said = !value ? `${ACTION_NAMES[c.action]}: that ${thing} is cleared.` : `${ACTION_NAMES[c.action]} is on ${name}.`;
    this.movedTo = moved ? cellId({ dev: c.dev, action: moved.action, slot: moved.slot }) : '';
    if (!moved || moved.action === c.action) return;
    // The other action: on what this one had, or keeping its other one, or with none at all now.
    const left = this.store.get().controls;
    const other = c.dev === 'kb' ? keyLabel(left.keys[moved.action][1 - moved.slot]) : padLabel(left.pad[moved.action as PadAction][1 - moved.slot]);
    const them = ACTION_NAMES[moved.action];
    this.said += now(moved) ? ` ${them} moved to ${now(moved)}.` : other ? ` ${them} keeps ${other}.` : ` ${them} has no ${thing} now.`;
  }

  override close(): void {
    if (this.setting) {
      this.setting = null;
      this.input?.stopListening();
    }
    this.said = '';
    this.movedTo = '';
    super.close();
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
