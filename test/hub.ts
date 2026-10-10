// A stand-in for the SDK's room and entities (the network left out), shared by the net tests.

import type { NetEntity, NetKind, NetRoom } from '../src/net/cars';

/** A room's entities, shared by every player's view of it: the SDK, minus the network. */
export class Hub {
  entities: { kind: string; owner: string; fields: Record<string, unknown>; teleports: number; removed: boolean }[] = [];
  renderTime = 0;
  now = 0;
  /** Who holds the host role: host entities are theirs to write. */
  host = 'ada';
  /** Claims, by key: who holds each. */
  claims = new Map<string, string>();
  /** Every room's event handlers (sent to all, the sender's only with echo). */
  handlers: { me: string; type: string; fn: (data: unknown, from: string) => void }[] = [];
  /** Events sent, in order. */
  sent: { type: string; from: string; data: unknown }[] = [];
  room(me: string): NetRoom {
    const hub = this;
    return {
      me,
      async claim(key) {
        if (hub.claims.has(key)) return false;
        hub.claims.set(key, me);
        return true;
      },
      release(key) {
        if (hub.claims.get(key) === me) hub.claims.delete(key);
      },
      emit(type, data, options) {
        hub.sent.push({ type, from: me, data });
        const to = options?.to === 'host' ? hub.host : options?.to;
        for (const h of [...hub.handlers]) if (h.type === type && (h.me !== me || options?.echo !== false) && (to === undefined || h.me === to)) h.fn(structuredClone(data), me);
      },
      on(type, fn) {
        const h = { me, type, fn };
        hub.handlers.push(h);
        return () => (hub.handlers = hub.handlers.filter((x) => x !== h));
      },
      get isHost() {
        return hub.host === me;
      },
      get hostId() {
        return hub.host;
      },
      get renderTime() {
        return hub.renderTime;
      },
      define(kind: string): NetKind {
        const mine = (e: Hub['entities'][number]) => e.owner === me || (e.owner === 'host' && hub.host === me);
        const view = (e: Hub['entities'][number]): NetEntity =>
          new Proxy(
            { owner: { id: e.owner === 'host' ? hub.host : e.owner }, mine: mine(e), teleport: () => e.teleports++, remove: () => (e.removed = true) },
            {
              get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : e.fields[k as string]),
              set: (_t, k, v) => ((e.fields[k as string] = v), true),
            },
          ) as unknown as NetEntity;
        const live = () => hub.entities.filter((e) => e.kind === kind && !e.removed);
        return {
          spawn(initial, options) {
            const e = { kind, owner: options?.owner === 'host' ? 'host' : me, fields: { ...initial }, teleports: 0, removed: false };
            hub.entities.push(e);
            return view(e);
          },
          all: () => live().map(view),
          mine: () => live().filter(mine).map(view),
        };
      },
    };
  }
}
