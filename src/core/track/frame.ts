// Where a point is by a road sample (docs/CALDERA.md, step 1a: one home for what was copied about):
// how far along the road from sample `i` and across it, and the road's plane carried out to it.

/** The sample's frame: where it is and which way the road runs (tx, tz: unit, along it). */
export interface Frame {
  readonly px: ArrayLike<number>;
  readonly pz: ArrayLike<number>;
  readonly tx: ArrayLike<number>;
  readonly tz: ArrayLike<number>;
}

/** How far (x, z) is along the road from sample `i` (m, + ahead). */
export const along = (sp: Frame, i: number, x: number, z: number): number => (x - sp.px[i]) * sp.tx[i] + (z - sp.pz[i]) * sp.tz[i];

/** How far (x, z) is across the road from sample `i` (m, + right: the right is (-tz, tx)). */
export const across = (sp: Frame, i: number, x: number, z: number): number => (x - sp.px[i]) * -sp.tz[i] + (z - sp.pz[i]) * sp.tx[i];
