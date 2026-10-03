// The island's shapes (Paradise): its coastline and its volcano, pure arithmetic shared by the
// land the renderer draws round a lapped island (render/skins/greybox/terrain.ts) and the open
// ground the car drives on (core/track/ground.ts, docs/PARADISE.md), so both build the same island.

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Signed distance from (x, z) to a closed loop: positive inside it. */
export function loopDist(loop: [number, number][], x: number, z: number): number {
  let best = Infinity;
  let inside = false;
  for (let k = 0, j = loop.length - 1; k < loop.length; j = k++) {
    const [ax, az] = loop[j];
    const [bx, bz] = loop[k];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
    if (az > z !== bz > z && x < ax + ((z - az) * dx) / dz) inside = !inside;
  }
  return inside ? best : -best;
}

/** A volcano's cone: its middle, the crater's radius, the lip's height over the sea, its foot's radius. */
export interface Volcano {
  x: number;
  z: number;
  crater: number;
  h: number;
  r: number;
}

/** A volcano's cone above the sea at (x, z): steepening to the lip, a bowl in the crater. */
export function coneHeight(v: Volcano, x: number, z: number): number {
  const rr = Math.hypot(x - v.x, z - v.z);
  if (rr >= v.r) return 0;
  const u = Math.min(1, (v.r - rr) / (v.r - v.crater));
  const lip = 4 * Math.exp(-(((rr - v.crater) / 9) ** 2));
  return v.h * u ** 1.6 + lip - (rr < v.crater ? 26 * smooth(v.crater, v.crater * 0.35, rr) : 0);
}

/** A crater's shaft (GroundDef.volcano.pit): inside the lip, its walls fall over this many meters to its floor. */
export const PIT_WALL = 18;

/** The cone at (x, z) with its crater a shaft down to `pit` (over the sea), if it has one. */
export function shaftHeight(v: Volcano & { pit?: number }, x: number, z: number): number {
  const cone = coneHeight(v, x, z);
  const rr = Math.hypot(x - v.x, z - v.z);
  if (v.pit === undefined || rr >= v.crater) return cone;
  return v.pit + (cone - v.pit) * smooth(v.crater - PIT_WALL, v.crater, rr);
}

/** A polyline smoothed into a curve (Catmull-Rom), every few meters. */
export function curve(poly: [number, number][], step = 6): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < poly.length; k++) {
    const p0 = poly[Math.max(0, k - 1)];
    const p1 = poly[k];
    const p2 = poly[k + 1];
    const p3 = poly[Math.min(poly.length - 1, k + 2)];
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let j = 0; j < n; j++) {
      const t = j / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(poly[poly.length - 1]);
  return out;
}

