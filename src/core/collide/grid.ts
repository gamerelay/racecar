// A uniform grid (spatial hash) rebuilt every tick for everything that moves (SPEC §9, "Spatial
// index"). Counting sort into typed arrays: O(n), no allocation after construction. Hash
// collisions only add false candidates, which the narrow phase throws out.

export class SpatialGrid {
  readonly cell: number;
  private readonly buckets: number;
  private readonly start: Int32Array;
  private readonly count: Int32Array;
  private readonly items: Int32Array;
  private readonly keys: Int32Array;
  private n = 0;

  constructor(cell = 16, buckets = 1024, capacity = 512) {
    this.cell = cell;
    this.buckets = buckets;
    this.start = new Int32Array(buckets + 1);
    this.count = new Int32Array(buckets);
    this.items = new Int32Array(capacity);
    this.keys = new Int32Array(capacity);
  }

  private hash(cx: number, cz: number): number {
    return (((Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) >>> 0) % this.buckets) | 0;
  }

  /** Rebuilds from positions; `include(i)` picks which of the first `n` items go in. */
  rebuild(n: number, xs: ArrayLike<number>, zs: ArrayLike<number>, include: (i: number) => boolean): void {
    this.count.fill(0);
    let m = 0;
    for (let i = 0; i < n; i++) {
      if (!include(i)) {
        this.keys[i] = -1;
        continue;
      }
      const k = this.hash(Math.floor(xs[i] / this.cell), Math.floor(zs[i] / this.cell));
      this.keys[i] = k;
      this.count[k]++;
      m++;
    }
    this.start[0] = 0;
    for (let b = 0; b < this.buckets; b++) this.start[b + 1] = this.start[b] + this.count[b];
    this.count.fill(0);
    for (let i = 0; i < n; i++) {
      const k = this.keys[i];
      if (k < 0) continue;
      this.items[this.start[k] + this.count[k]++] = i;
    }
    this.n = m;
  }

  get size(): number {
    return this.n;
  }

  /**
   * Writes the items in the 3×3 cells around (x, z) into `out` and returns how many. Buckets that
   * two cells hash into are read once.
   */
  near(x: number, z: number, out: Int32Array): number {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    const seen = this.seen;
    let ns = 0;
    let m = 0;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const k = this.hash(cx + ox, cz + oz);
        let dup = false;
        for (let q = 0; q < ns; q++) if (seen[q] === k) dup = true;
        if (dup) continue;
        seen[ns++] = k;
        for (let p = this.start[k]; p < this.start[k + 1] && m < out.length; p++) out[m++] = this.items[p];
      }
    }
    return m;
  }

  private readonly seen = new Int32Array(9);
}
