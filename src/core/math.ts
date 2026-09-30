// Small numeric helpers. Everything here works on plain numbers so the hot path never allocates.

export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const sign = (v: number): number => (v < 0 ? -1 : 1);

/** Moves `v` toward `target` by at most `step`. */
export const approach = (v: number, target: number, step: number): number =>
  v < target ? Math.min(v + step, target) : Math.max(v - step, target);

/** Wraps an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

/** Frame-rate independent exponential smoothing factor for a rate in 1/s. */
export const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Headings: 0 faces +z, and h grows toward +x, which is the car's left (y up, right-handed).
 * forward = (sin h, cos h), right = (-cos h, sin h). Steering right (steer > 0) lowers h.
 */
export const forwardX = (h: number): number => Math.sin(h);
export const forwardZ = (h: number): number => Math.cos(h);
export const headingOf = (x: number, z: number): number => Math.atan2(x, z);

export const KMH = 3.6;
