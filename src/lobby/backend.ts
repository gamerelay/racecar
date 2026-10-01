// Where lobbies live. The screens only talk to a LobbyBackend, so the local one (in this browser)
// and the relay one (GameRelay rooms: relay.ts) are interchangeable, and `Lobbies` puts both
// behind one: your own lobby is local (`LOCAL_ID`), every other is a room, by its code.

import { apply, createLobby, DEFAULT_OPTIONS, summarize, type Lobby, type LobbyAction, type LobbyOptions, type LobbySummary, type Player } from './lobby';

export interface LobbyBackend {
  /** Your player id in lobby `id` (online it's the relay's, which is only known once connected). */
  youIn(id: string): string;
  list(): Promise<LobbySummary[]>;
  /** `online`: a GameRelay room (when there's a relay), else a lobby in this browser. */
  create(host: Player, init: { name?: string; visibility?: Lobby['visibility']; options?: Partial<LobbyOptions>; online?: boolean }): Promise<Lobby>;
  get(id: string): Promise<Lobby | null>;
  /** Your action on a lobby: the lobby after it, or null if it was refused (or the lobby is gone). */
  send(id: string, action: LobbyAction): Promise<Lobby | null>;
  /** Calls `fn` whenever the lobby changes (from here or elsewhere); returns an unsubscribe. */
  subscribe(id: string, fn: (lobby: Lobby | null) => void): () => void;
}

/** What the local backend keeps its lobby in: localStorage in the game, a Map in tests. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = 'racecar.lobby.v1';
export const LOCAL_ID = 'local';

/**
 * Your own lobby, kept in this browser so it's still there after a race (each race is a page
 * load). One at a time: creating a lobby replaces the last. Storage that throws (a private window,
 * blocked site data) falls back to memory, which lasts until the page reloads.
 */
export class LocalBackend implements LobbyBackend {
  readonly you = 'you';

  youIn(): string {
    return this.you;
  }
  private memory: Lobby | null = null;
  private listeners = new Set<(lobby: Lobby | null) => void>();

  constructor(private store: KeyValue | null) {}

  private load(): Lobby | null {
    try {
      const raw = this.store?.getItem(KEY);
      if (raw) {
        // Lobbies kept from an older build may be missing options added since.
        const lobby = JSON.parse(raw) as Lobby;
        return { ...lobby, options: { ...DEFAULT_OPTIONS, ...lobby.options } };
      }
    } catch {
      // Unreadable: use what's in memory.
    }
    return this.memory;
  }

  private save(lobby: Lobby | null): void {
    this.memory = lobby;
    try {
      if (lobby) this.store?.setItem(KEY, JSON.stringify(lobby));
      else this.store?.removeItem(KEY);
    } catch {
      // Memory only.
    }
    for (const fn of this.listeners) fn(lobby);
  }

  /** The lobby now, without waiting (main.ts runs its map behind the menu before the menu opens). */
  peek(id: string): Lobby | null {
    const lobby = this.load();
    return lobby && lobby.id === id ? lobby : null;
  }

  async list(): Promise<LobbySummary[]> {
    const lobby = this.load();
    return lobby ? [summarize(lobby)] : [];
  }

  async create(host: Player, init: Parameters<LobbyBackend['create']>[1]): Promise<Lobby> {
    const lobby = createLobby(LOCAL_ID, { ...host, id: this.you }, init);
    this.save(lobby);
    return lobby;
  }

  async get(id: string): Promise<Lobby | null> {
    return this.peek(id);
  }

  async send(id: string, action: LobbyAction): Promise<Lobby | null> {
    const lobby = await this.get(id);
    if (!lobby) return null;
    const next = apply(lobby, this.you, action);
    if (!next) return null;
    // The last player out closes the lobby.
    this.save(next.host ? next : null);
    return next.host ? next : null;
  }

  subscribe(id: string, fn: (lobby: Lobby | null) => void): () => void {
    const each = (lobby: Lobby | null) => fn(lobby && lobby.id === id ? lobby : null);
    this.listeners.add(each);
    return () => this.listeners.delete(each);
  }
}

/** Online calls the screens wait on give up after this long (ms): a server that never answers isn't one. */
const ONLINE_WAIT_MS = 5000;

function inTime<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ONLINE_WAIT_MS))]);
}

/**
 * Your local lobby and the online ones, as one backend. Without a relay (no key, or offline), only
 * the local one: the list shows what it can and an online create fails.
 */
export class Lobbies implements LobbyBackend {
  /** Why the online list is missing ('' when it isn't): shown on the title. */
  offline = '';

  constructor(
    readonly local: LocalBackend,
    readonly online: LobbyBackend | null,
  ) {
    if (!online) this.offline = 'Online lobbies need a GameRelay key (VITE_GAMERELAY_KEY).';
  }

  private of(id: string): LobbyBackend | null {
    return id === LOCAL_ID ? this.local : this.online;
  }

  youIn(id: string): string {
    return this.of(id)?.youIn(id) ?? '';
  }

  async list(): Promise<LobbySummary[]> {
    const own = await this.local.list();
    if (!this.online) return own;
    try {
      const rows = await inTime(this.online.list());
      this.offline = '';
      return [...own, ...rows];
    } catch {
      this.offline = "Can't reach the lobby server right now.";
      return own;
    }
  }

  async create(host: Player, init: Parameters<LobbyBackend['create']>[1]): Promise<Lobby> {
    if (!init.online) return this.local.create(host, init);
    if (!this.online) throw new Error(this.offline);
    return this.online.create(host, init);
  }

  async get(id: string): Promise<Lobby | null> {
    const backend = this.of(id);
    if (!backend) return null;
    return (await (backend === this.local ? backend.get(id) : inTime(backend.get(id))).catch(() => null)) ?? null;
  }

  async send(id: string, action: LobbyAction): Promise<Lobby | null> {
    return (await this.of(id)?.send(id, action).catch(() => null)) ?? null;
  }

  subscribe(id: string, fn: (lobby: Lobby | null) => void): () => void {
    return this.of(id)?.subscribe(id, fn) ?? (() => {});
  }
}
