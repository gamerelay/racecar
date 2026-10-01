// P2P (milestone 3): every online lobby is also a GameRelay party, because GameRelay only connects
// party members straight to each other over the internet (`lan: { direct: 'party' }`, with the
// instance's Direct connections setting on). Everyone else in a room goes through its TURN relay.
//
// A party has a cost a lobby doesn't: its leader drags every connected member into any room it
// makes or joins. So the party never outlives the lobby. Leaving the lobby (Leave, a kick, the room
// closing, a new lobby) leaves the party, always asked of the server: after a page load the SDK
// doesn't know it's in one, while the server keeps it there through its reconnect grace (30 s).
//
// Xbox keeps the two apart (a party is your friends, across games; a game session is the match),
// and joining a party's game is something you choose. Here the party is only the key to a direct
// connection: GameRelay's ask is direct connections between a room's players, with no party.

import type { RelayLike, RoomLike } from './relay';
import { readLobby } from './wire';
import type { Lobby } from './lobby';

export class LobbyParty {
  /** A follow on its way, and whether another was asked for meanwhile. */
  private busy = false;
  private again = false;

  constructor(
    private relay: () => Promise<RelayLike | null>,
    /** The room you're in now (it changes while a party call is on its way). */
    private current: () => RoomLike | null,
    /** On the SDK's host: the lobby with its new party's code, written to the room. */
    private commit: (room: RoomLike, lobby: Lobby) => void,
  ) {}

  /** A new party for a lobby being made (after its room: a leader drags its party into any room it makes). */
  async create(): Promise<string | undefined> {
    const relay = await this.relay();
    return (await relay?.createParty?.().catch(() => null))?.code;
  }

  /**
   * Into the current lobby's party (one at a time; one asked for meanwhile runs next, with the lobby
   * as it is then). Its party gone (everyone left it), the SDK's host makes a new one and writes it
   * to the lobby; anyone else waits for that.
   */
  async follow(): Promise<void> {
    if (this.busy) return void (this.again = true);
    this.busy = true;
    try {
      const room = this.current();
      const lobby = room && readLobby(room.state);
      const relay = await this.relay();
      if (!room || !lobby || !relay?.joinParty || (lobby.party && relay.party?.code === lobby.party)) return;
      const joined = lobby.party ? await relay.joinParty(lobby.party).then(() => true, () => false) : false;
      // Left (or kicked) while it was joining: out again, or it outlives the lobby.
      if (this.current() !== room) return void (joined && (await this.leave()));
      if (joined || !room.isHost) return;
      await this.leave();
      const party = await this.create();
      if (this.current() !== room) return void (party && (await this.leave()));
      const now = readLobby(room.state);
      if (party && now) this.commit(room, { ...now, party });
    } finally {
      this.busy = false;
      if (this.again) {
        this.again = false;
        void this.follow();
      }
    }
  }

  /** Out of any party, asked of the server every time (leaving none is a no-op there). */
  async leave(): Promise<void> {
    const relay = await this.relay();
    await relay?.leaveParty?.().catch(() => {});
  }
}
