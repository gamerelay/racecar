// After an online race: the vote on the next race's map, run by the lobby's host (SPEC §11). The
// host's race page calls `voteStep` a few times a second and sends what it says; `apply` holds the
// rules, so this only decides when. Pure: no SDK, no DOM.
//
//   - The first player over the line opens the vote, for VOTE_MAX_MS at most.
//   - Everyone still racing in: it closes VOTE_MS from then (if that's sooner).
//   - Everyone in and voted: it closes VOTED_MS from then, long enough to see the winner.
//   - Closed: the next race, on the winner (`tally`: the host breaks a tie), for everyone still in.

import { racers, seatIndex, tally, type Lobby, type LobbyAction } from './lobby';

/** The vote's length once everyone's in (ms). */
export const VOTE_MS = 15_000;
/** The most it waits for the last players to finish (ms, from the first finish). */
export const VOTE_MAX_MS = 60_000;
/** Everyone's voted: the winner's on screen this long before the next race (ms). */
export const VOTED_MS = 3_000;

/** What the host sends now, if anything, for the lobby's vote at server time `now` (ms). */
export function voteStep(lobby: Lobby, now: number, seed: () => number): LobbyAction | null {
  if (lobby.phase !== 'racing' || lobby.seed === undefined) return null;
  const rs = racers(lobby);
  if (!rs.length) return null;
  const done = new Set((lobby.results ?? []).filter((r) => r.time !== null).map((r) => r.seat));
  const finished = rs.filter((p) => done.has(seatIndex(lobby, p.id))).length;
  const vote = lobby.vote;
  if (!vote) return finished ? { type: 'voteEnds', ends: now + VOTE_MAX_MS } : null;
  if (now >= vote.ends) return { type: 'next', map: tally(lobby), seed: seed() };
  if (finished < rs.length) return null;
  const voted = rs.every((p) => vote.votes[p.id]);
  const by = now + (voted ? VOTED_MS : VOTE_MS);
  // Only ever sooner (and not again for a second's difference).
  return vote.ends > by + 1000 ? { type: 'voteEnds', ends: by } : null;
}
