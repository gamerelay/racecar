// Checks for what another player's page sends during a race (entity fields and events): its word,
// so a number is only a finite number, a name only a short string. Each returns what it found, or
// null (the message readers in net/wire.ts and the layers decide what null means).

/** A finite number, or null. */
export const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A finite number, or `d`. */
export const finiteOr = (v: unknown, d: number): number => finite(v) ?? d;

/** An integer in [lo, hi], or null. */
export const intIn = (v: unknown, lo: number, hi: number): number | null => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : null);

/** A non-empty string of at most `max` characters (a car's name, a key), or null. */
export const shortText = (v: unknown, max = 64): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** An object's fields to read, or null for anything else. */
export const fields = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
