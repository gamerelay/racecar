// The player's settings (docs/MENU.md): one object, kept on this device in localStorage, read once
// at startup and saved on every change. Each part of the game reads its own settings from here and
// is told when they change (`onChange`), so a change applies at once. Nothing here goes over the
// network: online play doesn't see it.
//
// Pure apart from storage, which is passed in (tests use none), so a blocked or cleared storage
// only means the defaults.

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  /** Volumes, 0 to 1: everything, and each bus (scaling its level in audio.ts). */
  volume: { master: number; music: number; engines: number; effects: number };
  /** Graphics: the preset, and what it sets (a change to one of those makes it `custom`). */
  graphics: { quality: Quality | 'custom'; resolution: number; post: boolean; outline: boolean; fps: boolean };
  /** Send anonymous playtest analytics (PostHog), where the build has them. */
  analytics: boolean;
}

/** What each preset sets. Resolution is a share of the screen's own (at most 2× on high). */
export const QUALITY: Record<Quality, Pick<Settings['graphics'], 'resolution' | 'post' | 'outline'>> = {
  low: { resolution: 0.6, post: false, outline: false },
  medium: { resolution: 0.8, post: true, outline: true },
  high: { resolution: 1, post: true, outline: true },
};

export const DEFAULT_SETTINGS: Settings = {
  volume: { master: 1, music: 1, engines: 1, effects: 1 },
  graphics: { quality: 'high', ...QUALITY.high, fps: false },
  analytics: true,
};

export const SETTINGS_KEY = 'racecar.settings';

const unit = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** Settings from what was stored (anything, or nothing): what's missing or wrong is the default. */
export function parseSettings(raw: string | null): Settings {
  let s: Partial<{ [K in keyof Settings]: Partial<Settings[K]> }> & { analytics?: unknown } = {};
  try {
    const v = raw ? JSON.parse(raw) : {};
    if (v && typeof v === 'object') s = v;
  } catch {
    // Unreadable: the defaults.
  }
  const d = DEFAULT_SETTINGS;
  const vol = (s.volume ?? {}) as Record<string, unknown>;
  const gr = (s.graphics ?? {}) as Record<string, unknown>;
  const quality = gr.quality === 'custom' || (typeof gr.quality === 'string' && gr.quality in QUALITY) ? (gr.quality as Settings['graphics']['quality']) : d.graphics.quality;
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
    analytics: bool(s.analytics, d.analytics),
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
  set(change: { volume?: Partial<Settings['volume']>; graphics?: Partial<Settings['graphics']>; analytics?: boolean }): void {
    const v = this.value;
    this.value = {
      volume: { ...v.volume, ...change.volume },
      graphics: change.graphics ? withGraphics(v.graphics, change.graphics) : v.graphics,
      analytics: change.analytics ?? v.analytics,
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
