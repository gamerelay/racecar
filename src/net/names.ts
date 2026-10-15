// Names other players see (your plate, a lobby's name), checked with GameRelay's name moderation
// (`POST /v1/names/check`) before they're used. The plate's own blocklist (lobby/plate.ts) still
// runs first and offline; this adds GameRelay's lists, its lookalike and leetspeak handling, and
// the terms the game's owner blocks in the dashboard.

/** Why a name was refused, as a player reads it. */
const REASONS: Record<string, string> = {
  offensive: "That name isn't allowed",
  reserved: 'That name is kept for the game',
  link: "Names can't be links",
  blocked: "That name isn't allowed",
  empty: 'Type a name',
  too_long: 'Too long',
};

/** Checks a name: null when it's fine, or what to tell the player. */
export type NameCheck = (name: string) => Promise<string | null>;

/**
 * A checker against GameRelay at `base` with the game's public key. It fails open: no network, a
 * server without the feature or a plan without it lets the name through, since the server still
 * swaps a failing name wherever others see it when the game moderates names.
 */
export function nameChecker(publicKey: string, base = 'https://gamerelay.io', fetcher: typeof fetch = fetch): NameCheck {
  return async (name) => {
    try {
      const res = await fetcher(`${base.replace(/\/$/, '')}/v1/names/check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publicKey, name }),
        // A server that hangs mustn't hold the Save or Create button: the name goes through.
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { ok?: boolean; reason?: string };
      return body.ok === false ? (REASONS[body.reason ?? ''] ?? "That name isn't allowed") : null;
    } catch {
      return null;
    }
  };
}
