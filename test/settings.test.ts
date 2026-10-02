import { describe, expect, test } from 'bun:test';
import { DEFAULT_SETTINGS, parseSettings, QUALITY, SETTINGS_KEY, SettingsStore, withGraphics, type SettingsStorage } from '../src/settings';
import { cycleIndex } from '../src/ui/chooser';

// The player's settings (settings.ts, docs/MENU.md): what's stored, read back whatever it is, and
// the graphics presets; and the chooser's cycling (ui/chooser.ts).

/** A storage that keeps what's set, or one that throws (blocked storage). */
function memory(start: Record<string, string> = {}): SettingsStorage & { data: Record<string, string> } {
  const data = { ...start };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}
const blocked: SettingsStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('settings', () => {
  test('nothing stored, or nothing readable: the defaults', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('42')).toEqual(DEFAULT_SETTINGS);
    expect(new SettingsStore(blocked).get()).toEqual(DEFAULT_SETTINGS);
  });

  test("what's wrong in what's stored is the default, and the rest is kept", () => {
    const s = parseSettings(JSON.stringify({ volume: { master: 0.4, music: 7, engines: 'loud' }, graphics: { quality: 'ultra', fps: true }, analytics: 'no' }));
    expect(s.volume).toEqual({ master: 0.4, music: 1, engines: 1, effects: 1 });
    expect(s.graphics).toEqual({ quality: 'high', ...QUALITY.high, fps: true });
    expect(s.analytics).toBe(true);
  });

  test("a preset's values come from the preset; custom keeps its own (resolution 50% to 100%)", () => {
    expect(parseSettings(JSON.stringify({ graphics: { quality: 'low', resolution: 1, post: true } })).graphics).toMatchObject({ quality: 'low', ...QUALITY.low });
    expect(parseSettings(JSON.stringify({ graphics: { quality: 'custom', resolution: 0.1, post: false, outline: true } })).graphics).toMatchObject({ quality: 'custom', resolution: 0.5, post: false, outline: true });
  });

  test("a preset sets its values; changing one makes it custom, and matching a preset's again names it", () => {
    const high = DEFAULT_SETTINGS.graphics;
    expect(withGraphics(high, { quality: 'low' })).toEqual({ ...high, quality: 'low', ...QUALITY.low });
    const custom = withGraphics(high, { outline: false });
    expect(custom.quality).toBe('custom');
    expect(withGraphics(custom, { outline: true }).quality).toBe('high');
    // Show FPS isn't part of a preset.
    expect(withGraphics(high, { fps: true }).quality).toBe('high');
  });

  test('a change is saved, read back by the next page, and heard by everyone listening (now and after)', () => {
    const store = memory();
    const s = new SettingsStore(store);
    const heard: number[] = [];
    s.onChange((v) => heard.push(v.volume.music));
    s.set({ volume: { music: 0.25 } });
    expect(heard).toEqual([1, 0.25]);
    expect(JSON.parse(store.data[SETTINGS_KEY]!).volume.music).toBe(0.25);
    expect(new SettingsStore(store).get().volume).toEqual({ ...DEFAULT_SETTINGS.volume, music: 0.25 });
    // Blocked storage: the change still lasts the page.
    const b = new SettingsStore(blocked);
    b.set({ analytics: false });
    expect(b.get().analytics).toBe(false);
  });
});

describe('chooser', () => {
  test('cycles both ways and wraps round', () => {
    expect([cycleIndex(0, 3, 1), cycleIndex(2, 3, 1), cycleIndex(0, 3, -1), cycleIndex(1, 3, -4)]).toEqual([1, 0, 2, 0]);
    expect(cycleIndex(0, 0, 1)).toBe(0);
  });
});
