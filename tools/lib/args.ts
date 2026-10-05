// Command-line flags for the dev tools: `--name value`, `--switch`, and the rest positional.

export interface Args {
  /** A flag's value (and removes it), or undefined. */
  str(name: string): string | undefined;
  num(name: string): number | undefined;
  /** A switch (and removes it). */
  has(name: string): boolean;
  /** What's left, once every flag has been read (an unread flag is an error). */
  rest(): string[];
}

export function args(argv = process.argv.slice(2)): Args {
  const a = [...argv];
  const str = (name: string) => {
    const i = a.indexOf(`--${name}`);
    if (i < 0) return undefined;
    const v = a[i + 1];
    // (`--s --kmh 100` would read "--kmh" as the distance.)
    if (v === undefined || v.startsWith('--')) throw new Error(`--${name} wants a value`);
    a.splice(i, 2);
    if (a.includes(`--${name}`)) throw new Error(`--${name} given twice`);
    return v;
  };
  return {
    str,
    num: (name) => {
      const v = str(name);
      if (v === undefined) return undefined;
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`--${name} wants a number, got "${v}"`);
      return n;
    },
    has: (name) => {
      const i = a.indexOf(`--${name}`);
      if (i >= 0) a.splice(i, 1);
      return i >= 0;
    },
    rest: () => {
      // Read every flag first: one left over is unknown (and its value would pass for an argument).
      const left = a.filter((x) => x.startsWith('--'));
      if (left.length) throw new Error(`unknown flag${left.length > 1 ? 's' : ''}: ${left.join(' ')}`);
      return a;
    },
  };
}

/** "x,z" or "x,z,y" as numbers. */
export function point(v: string): number[] {
  const parts = v.split(',');
  const p = parts.map(Number);
  // (An empty part, "129,-127,", is Number('') = 0: a height of 0, not the ground's.)
  if (p.length < 2 || p.length > 3 || parts.some((x) => x.trim() === '') || p.some((n) => !Number.isFinite(n))) throw new Error(`a point is "x,z" or "x,z,y", got "${v}"`);
  return p;
}
