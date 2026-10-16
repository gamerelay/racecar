// The player's settings (docs/MENU.md): one object, kept on this device in localStorage, read once
// at startup and saved on every change. Each part of the game reads its own settings from here and
// is told when they change (`onChange`), so a change applies at once. Nothing here goes over the
// network: online play doesn't see it.
//
// Pure apart from storage, which is passed in (tests use none), so a blocked or cleared storage
// only means the defaults.

import { DEFAULT_KEYS, DEFAULT_PAD, parseKeys, parsePad, type KeyBinds, type PadBinds } from './input/bindings';

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  /** Volumes, 0 to 1: everything, and each bus (scaling its level in audio.ts). */
  volume: { master: number; music: number; engines: number; effects: number };
  /** Graphics: the preset, and what it sets (a change to one of those makes it `custom`). */
  graphics: { quality: Quality | 'custom'; resolution: number; post: boolean; outline: boolean; fps: boolean };
  /**
   * Controls (input/bindings.ts): the driving keys and pad buttons, and the pad's options: its
   * deadzone (0 to 0.3 of the stick's travel), rumble, and steering sensitivity (0 to 1: the stick's
   * curve, from gentle near the middle to straight).
   */
  controls: { keys: KeyBinds; pad: PadBinds; deadzone: number; rumble: boolean; sensitivity: number };
}

/** The deadzone's most: past it, a worn stick isn't the trouble. */
export const MAX_DEADZONE = 0.3;
/** The stick's curve: steer is the stick to this power (1.4 at the default 0.6, as it always was; 1, straight, at 1). */
export const steerCurve = (sensitivity: number) => 2 - sensitivity;

/** What each preset sets. Resolution is a share of the screen's own (at most 2× on high). */
export const QUALITY: Record<Quality, Pick<Settings['graphics'], 'resolution' | 'post' | 'outline'>> = {
  low: { resolution: 0.6, post: false, outline: false },
  medium: { resolution: 0.8, post: true, outline: true },
  high: { resolution: 1, post: true, outline: true },
};

export const DEFAULT_SETTINGS: Settings = {
  volume: { master: 1, music: 1, engines: 1, effects: 1 },
  graphics: { quality: 'high', ...QUALITY.high, fps: false },
  controls: { keys: DEFAULT_KEYS, pad: DEFAULT_PAD, deadzone: 0.12, rumble: true, sensitivity: 0.6 },
};

export const SETTINGS_KEY = 'racecar.settings';

const unit = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** Settings from what was stored (anything, or nothing): what's missing or wrong is the default. */
export function parseSettings(raw: string | null): Settings {
  let s: Partial<{ [K in keyof Settings]: Partial<Settings[K]> }> = {};
  try {
    const v = raw ? JSON.parse(raw) : {};
    if (v && typeof v === 'object') s = v;
  } catch {
    // Unreadable: the defaults.
  }
  const d = DEFAULT_SETTINGS;
  const vol = (s.volume ?? {}) as Record<string, unknown>;
  const gr = (s.graphics ?? {}) as Record<string, unknown>;
  const co = (s.controls ?? {}) as Record<string, unknown>;
  const quality = gr.quality === 'custom' || (typeof gr.quality === 'string' && Object.hasOwn(QUALITY, gr.quality)) ? (gr.quality as Settings['graphics']['quality']) : d.graphics.quality;
  return {
    volume: { master: unit(vol.master, d.volume.master), music: unit(vol.music, d.volume.music), engines: unit(vol.engines, d.volume.engines), effects: unit(vol.effects, d.volume.effects) },
    graphics: {
      quality,
      // A preset's own values come from the preset (a stored one can't drift from it).
      ...(quality === 'custom'
        ? { resolution: Math.min(1, Math.max(0.5, unit(gr.resolution, d.graphics.resolution))), post: bool(gr.post, d.graphics.post), outline: bool(gr.outline, d.graphics.outline) }
        : QUALITY[quality]),
      fps: bool(gr.fps, d.graphics.fps),
    },
    controls: {
      keys: parseKeys(co.keys),
      pad: parsePad(co.pad),
      deadzone: Math.min(MAX_DEADZONE, unit(co.deadzone, d.controls.deadzone)),
      rumble: bool(co.rumble, d.controls.rumble),
      sensitivity: unit(co.sensitivity, d.controls.sensitivity),
    },
  };
}

/** The graphics after a change: a preset sets its values; changing one of those makes it `custom`. */
export function withGraphics(g: Settings['graphics'], change: Partial<Settings['graphics']>): Settings['graphics'] {
  if (change.quality && change.quality !== 'custom') return { ...g, ...change, ...QUALITY[change.quality] };
  const next = { ...g, ...change };
  const preset = (Object.keys(QUALITY) as Quality[]).find((q) => QUALITY[q].resolution === next.resolution && QUALITY[q].post === next.post && QUALITY[q].outline === next.outline);
  return { ...next, quality: preset ?? 'custom' };
}

/** Where settings are kept: localStorage-like, or nothing (blocked storage). */
/**
 * Clears what an older build kept for its analytics (a random id, the opt-out), so the browser holds
 * only what the privacy page says: settings, plate and best times. Blocked storage: nothing to do.
 */
export function forgetAnalytics(storage: { removeItem(key: string): void } | null): void {
  for (const key of ['racecar.id', 'racecar.telemetry'])
    try {
      storage?.removeItem(key);
    } catch {
      return;
    }
}

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class SettingsStore {
  private value: Settings;
  private readonly listeners: ((s: Settings) => void)[] = [];

  constructor(private readonly storage: SettingsStorage | null) {
    let raw: string | null = null;
    try {
      raw = storage?.getItem(SETTINGS_KEY) ?? null;
    } catch {
      // Blocked storage: the defaults, for this page.
    }
    this.value = parseSettings(raw);
  }

  get(): Settings {
    return this.value;
  }

  /** Changes some settings, saves them, and tells everyone listening. */
  set(change: { volume?: Partial<Settings['volume']>; graphics?: Partial<Settings['graphics']>; controls?: Partial<Settings['controls']> }): void {
    const v = this.value;
    this.value = {
      volume: { ...v.volume, ...change.volume },
      graphics: change.graphics ? withGraphics(v.graphics, change.graphics) : v.graphics,
      controls: { ...v.controls, ...change.controls },
    };
    try {
      this.storage?.setItem(SETTINGS_KEY, JSON.stringify(this.value));
    } catch {
      // Blocked storage: the change lasts this page.
    }
    for (const fn of this.listeners) fn(this.value);
  }

  /** Called now and on every change. */
  onChange(fn: (s: Settings) => void): void {
    this.listeners.push(fn);
    fn(this.value);
  }
}
