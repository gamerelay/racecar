import { afterEach, describe, expect, test } from 'bun:test';
import { posthogBuilt, posthogEnabled, setTelemetryOptOut, telemetryOptedOut } from '../src/telemetry/posthog';

// The analytics opt-out (telemetry/posthog.ts, Settings → Privacy). Bun has no localStorage, and
// no PostHog key in its environment (import.meta.env is process.env there): this is a build that
// doesn't send, and the opt-out still has to hold.

const g = globalThis as { localStorage?: unknown };

/** A localStorage that keeps what's set, counting the writes. */
function memory() {
  const data: Record<string, string> = {};
  const s = { data, writes: 0, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (s.writes++, (data[k] = v)) };
  return s;
}
/** One that throws on every use (blocked storage, a sandboxed frame). */
const blocked = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('SecurityError');
  },
};

afterEach(() => {
  setTelemetryOptOut(false);
  delete g.localStorage;
});

describe('analytics opt-out', () => {
  // A shell with a key exported would build one: these say nothing then.
  test.if(!process.env.VITE_POSTHOG_KEY)('with no key in the build, nothing is sent and none is built', () => {
    expect(posthogBuilt).toBe(false);
    expect(posthogEnabled()).toBe(false);
  });

  test('opted out holds for the page even when storage throws, and opting back in clears it', () => {
    g.localStorage = blocked;
    expect(telemetryOptedOut()).toBe(false);
    setTelemetryOptOut(true);
    expect(telemetryOptedOut()).toBe(true);
    setTelemetryOptOut(false);
    expect(telemetryOptedOut()).toBe(false);
  });

  test('the same with no storage at all', () => {
    setTelemetryOptOut(true);
    expect(telemetryOptedOut()).toBe(true);
  });

  test('with storage, the choice is kept for the next page, written only when it changes', () => {
    const s = memory();
    g.localStorage = s;
    setTelemetryOptOut(true);
    expect(s.data['racecar.telemetry']).toBe('off');
    expect(s.writes).toBe(1);
    setTelemetryOptOut(true);
    expect(s.writes).toBe(1);
    setTelemetryOptOut(false);
    expect(s.data['racecar.telemetry']).toBe('on');
    expect(telemetryOptedOut()).toBe(false);
  });

  test('a choice stored by an earlier page counts on this one', () => {
    const s = memory();
    s.data['racecar.telemetry'] = 'off';
    g.localStorage = s;
    expect(telemetryOptedOut()).toBe(true);
  });
});
