// How the HUD and results write times and places.

/** Race time as m:ss.t, rounded once so 59.97 s is 1:00.0 (not 0:60.0). */
export function fmt(t: number): string {
  const d = Math.round(Math.max(0, t) * 10);
  const m = Math.floor(d / 600);
  return `${m}:${((d % 600) / 10).toFixed(1).padStart(4, '0')}`;
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st; 0 is "Finished" (no place yet). */
export function ordinal(n: number): string {
  if (!n) return 'Finished';
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
}

/** A lap against the best before it: "−1.2" faster, "+0.8" slower, to a tenth. */
export function delta(t: number, best: number): string {
  const d = Math.round((t - best) * 10) / 10;
  return `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(1)}`;
}
