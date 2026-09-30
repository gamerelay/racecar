// Oriented boxes in the xz plane, tested with the separating axis theorem. A car is a box
// (half width, half length) turned by its heading. Results go into a reused `Contact`.

export interface Contact {
  /** Unit normal from box A toward box B. */
  nx: number;
  nz: number;
  depth: number;
  /** Contact point (approximate). */
  x: number;
  z: number;
}

export const newContact = (): Contact => ({ nx: 0, nz: 0, depth: 0, x: 0, z: 0 });

/** Projected half-extent of a box with axes (fx,fz) (length) and (rx,rz) (width) onto axis (ax,az). */
function extent(fx: number, fz: number, hw: number, hl: number, ax: number, az: number): number {
  return Math.abs(fx * ax + fz * az) * hl + Math.abs(-fz * ax + fx * az) * hw;
}

/**
 * True if the boxes overlap; fills `out` with the axis of least penetration. Boxes: center (x, z),
 * heading h (forward = (sin h, cos h)), half width hw, half length hl.
 */
export function obbOverlap(
  ax: number,
  az: number,
  ah: number,
  ahw: number,
  ahl: number,
  bx: number,
  bz: number,
  bh: number,
  bhw: number,
  bhl: number,
  out: Contact,
): boolean {
  const afx = Math.sin(ah);
  const afz = Math.cos(ah);
  const bfx = Math.sin(bh);
  const bfz = Math.cos(bh);
  const dx = bx - ax;
  const dz = bz - az;
  let best = Infinity;
  let bnx = 0;
  let bnz = 0;
  // The four candidate axes: each box's forward and right.
  for (let k = 0; k < 4; k++) {
    let nx: number;
    let nz: number;
    if (k === 0) (nx = afx), (nz = afz);
    else if (k === 1) (nx = -afz), (nz = afx);
    else if (k === 2) (nx = bfx), (nz = bfz);
    else (nx = -bfz), (nz = bfx);
    const dist = dx * nx + dz * nz;
    const overlap = extent(afx, afz, ahw, ahl, nx, nz) + extent(bfx, bfz, bhw, bhl, nx, nz) - Math.abs(dist);
    if (overlap <= 0) return false;
    if (overlap < best) {
      best = overlap;
      const s = dist < 0 ? -1 : 1;
      bnx = nx * s;
      bnz = nz * s;
    }
  }
  out.nx = bnx;
  out.nz = bnz;
  out.depth = best;
  out.x = (ax + bx) / 2;
  out.z = (az + bz) / 2;
  return true;
}
