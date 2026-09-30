// PostHog sink for playtest and production builds (SPEC §14). Anonymous: a random id kept in
// localStorage, no names. Off unless VITE_POSTHOG_KEY is set at build time, and players can turn
// it off (Settings, or localStorage racecar.telemetry = "off"). Records are batched: at most one
// request every 10 s, plus one on page hide. Per-tick traces never go here.

import type { Record } from './telemetry';

const HOST = import.meta.env.VITE_POSTHOG_HOST ?? 'https://us.i.posthog.com';
const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const MIN_INTERVAL = 10_000;

function store(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function posthogEnabled(): boolean {
  return !!KEY && store('racecar.telemetry') !== 'off';
}

export function setTelemetryOptOut(off: boolean): void {
  store('racecar.telemetry', off ? 'off' : 'on');
}

export function posthogSink(session: string, build: string): (lines: Record[], beacon: boolean) => void {
  // randomUUID only exists in secure contexts (not a LAN playtest over plain http).
  const fresh = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const id = store('racecar.id') ?? store('racecar.id', fresh) ?? session;
  let pending: Record[] = [];
  let last = 0;
  const send = (beacon: boolean) => {
    if (!pending.length || !KEY) return;
    const batch = pending
      .filter((r) => r.t !== 'trace')
      .map((r) => {
        const { t, at, ...props } = r;
        return { event: `racecar_${t}`, timestamp: new Date(at).toISOString(), properties: { distinct_id: id, session, build, ...props, $process_person_profile: false } };
      });
    pending = [];
    last = performance.now();
    const body = JSON.stringify({ api_key: KEY, batch });
    const url = `${HOST}/batch/`;
    if (beacon && navigator.sendBeacon) navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    else fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  };
  return (lines, beacon) => {
    pending.push(...lines);
    if (beacon || performance.now() - last > MIN_INTERVAL) send(beacon);
  };
}
