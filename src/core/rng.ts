// Seeded random numbers. Each system gets its own stream derived from the room seed and the
// system's name, so adding a hazard never changes where traffic spawns (SPEC §4).

/** FNV-1a over a string, for deriving stream seeds from names. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mixes two 32-bit values (a finalizer from murmur3). */
export function mix(a: number, b: number): number {
  let h = (a ^ Math.imul(b, 0x9e3779b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A stateless hash to [0, 1): the same (seed, a, b) always gives the same number. For closed-form world systems. */
export function hash01(seed: number, a: number, b = 0): number {
  return mix(mix(seed, a), b) / 4294967296;
}

/** A small, fast stream (mulberry32). Its state is one number, so it snapshots for free. */
export class Rng {
  state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  static stream(roomSeed: number, name: string): Rng {
    return new Rng(mix(roomSeed, hashString(name)));
  }
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
}
