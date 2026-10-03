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
    a.splice(i, 2);
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
  const p = v.split(',').map(Number);
  if (p.length < 2 || p.some((n) => !Number.isFinite(n))) throw new Error(`a point is "x,z" or "x,z,y", got "${v}"`);
  return p;
}
