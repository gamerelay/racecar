// Hashes for the golden fingerprints (docs/CALDERA.md, step 0): two FNV-1a lanes over the exact
// bits of numbers and typed arrays, so a change anywhere, even in the last bit of one height,
// changes the hash. Dev only: it allocates freely, and nothing in the sim calls it.

const F64 = new Float64Array(1);
const F64_BYTES = new Uint8Array(F64.buffer);

/** A running hash. Feed it with `num`, `str`, `bytes` or `deep`; read it with `hex`. */
export class Hasher {
  private a = 0x811c9dc5;
  private b = 0x050c5d1f;

  byte(v: number): void {
    this.a = Math.imul(this.a ^ v, 0x01000193) >>> 0;
    this.b = Math.imul(this.b ^ v, 0x01000193) >>> 0;
    this.b = (this.b ^ (this.b >>> 13)) >>> 0;
  }

  bytes(u8: Uint8Array): void {
    for (let k = 0; k < u8.length; k++) this.byte(u8[k]);
  }

  num(v: number): void {
    F64[0] = v;
    this.bytes(F64_BYTES);
  }

  str(s: string): void {
    for (let k = 0; k < s.length; k++) {
      const c = s.charCodeAt(k);
      this.byte(c & 0xff);
      this.byte(c >>> 8);
    }
    this.byte(0);
  }

  /** A typed array's exact bytes (its length first). */
  typed(arr: ArrayBufferView & { length: number }): void {
    this.num(arr.length);
    this.bytes(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
  }

  /**
   * Anything plain: numbers, strings, booleans, typed arrays, arrays, maps (by sorted key) and
   * objects (by sorted key). Functions and the keys in `skip` are left out; a value seen before
   * (a cycle, or a shared object) counts once.
   */
  deep(v: unknown, skip: ReadonlySet<string> = NONE, seen = new Set<unknown>()): void {
    if (v === null || v === undefined) return this.str(String(v));
    if (typeof v === 'number') return this.num(v);
    if (typeof v === 'string') return this.str(v);
    if (typeof v === 'boolean') return this.byte(v ? 1 : 2);
    if (typeof v !== 'object') return;
    if (seen.has(v)) return this.str('<seen>');
    seen.add(v);
    if (ArrayBuffer.isView(v)) return this.typed(v as ArrayBufferView & { length: number });
    if (Array.isArray(v)) {
      this.num(v.length);
      for (const x of v) this.deep(x, skip, seen);
      return;
    }
    if (v instanceof Map) {
      const keys = [...v.keys()].sort((p, q) => (String(p) < String(q) ? -1 : String(p) > String(q) ? 1 : 0));
      // Its size first, as an array's length, so a field moved in or out of it shows.
      this.num(keys.length);
      for (const k of keys) {
        this.str(String(k));
        this.deep(v.get(k), skip, seen);
      }
      return;
    }
    const keys = Object.keys(v)
      .filter((k) => !skip.has(k) && typeof (v as Record<string, unknown>)[k] !== 'function')
      .sort();
    this.num(keys.length);
    for (const k of keys) {
      const x = (v as Record<string, unknown>)[k];
      this.str(k);
      this.deep(x, skip, seen);
    }
  }

  hex(): string {
    return this.a.toString(16).padStart(8, '0') + this.b.toString(16).padStart(8, '0');
  }
}

const NONE: ReadonlySet<string> = new Set();

/** The hash of one value, deep (see `Hasher.deep`). */
export function hashOf(v: unknown, skip: readonly string[] = []): string {
  const h = new Hasher();
  h.deep(v, new Set(skip));
  return h.hex();
}
