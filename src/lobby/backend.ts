// Where lobbies live. The screens only talk to a LobbyBackend, so the local one (in this browser,
// the only one until milestone 3) and the relay one (GameRelay rooms, with setListing and
// listRooms from gamerelay PR #30) are interchangeable. Async throughout, as the relay's will be.

import { apply, createLobby, summarize, type Lobby, type LobbyAction, type LobbyOptions, type LobbySummary, type Player } from './lobby';

export interface LobbyBackend {
  /** Your player id. */
  readonly you: string;
  list(): Promise<LobbySummary[]>;
  create(host: Player, init: { name?: string; visibility?: Lobby['visibility']; options?: Partial<LobbyOptions> }): Promise<Lobby>;
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
  private memory: Lobby | null = null;
  private listeners = new Set<(lobby: Lobby | null) => void>();

  constructor(private store: KeyValue | null) {}

  private load(): Lobby | null {
    try {
      const raw = this.store?.getItem(KEY);
      if (raw) return JSON.parse(raw) as Lobby;
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
