/**
 * A failure the lobby carries on through (its fallback is the same either way), said in the console
 * so a lobby that misbehaves online leaves a trace.
 */
export const warned =
  <T>(what: string, value: T) =>
  (err: unknown): T => {
    console.warn(`[racecar] ${what}:`, err);
    return value;
  };
