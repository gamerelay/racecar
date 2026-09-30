// What a driver asks for this tick, from a person (input/) or the AI (core/ai). Plain numbers and
// booleans so it records into a report and replays exactly.

export interface Controls {
  /** -1 (left) … 1 (right) */
  steer: number;
  /** 0 … 1 */
  throttle: number;
  /** 0 … 1; also reverse when stopped */
  brake: number;
  boost: boolean;
  drift: boolean;
  reset: boolean;
  lookBack: boolean;
  horn: boolean;
}

export const neutralControls = (): Controls => ({
  steer: 0,
  throttle: 0,
  brake: 0,
  boost: false,
  drift: false,
  reset: false,
  lookBack: false,
  horn: false,
});

export function copyControls(from: Controls, to: Controls): Controls {
  to.steer = from.steer;
  to.throttle = from.throttle;
  to.brake = from.brake;
  to.boost = from.boost;
  to.drift = from.drift;
  to.reset = from.reset;
  to.lookBack = from.lookBack;
  to.horn = from.horn;
  return to;
}

/** The precision analog controls are stepped and recorded at (a thousandth). */
const quantize = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * `from` at the precision reports record, into `to`. The sim steps human input through this, so
 * a replay (or a peer, online) steps on exactly what the player's sim did.
 */
export function quantizeControls(from: Controls, to: Controls): Controls {
  copyControls(from, to);
  to.steer = quantize(from.steer);
  to.throttle = quantize(from.throttle);
  to.brake = quantize(from.brake);
  return to;
}

/** Packs controls into a small array for reports: [steer, throttle, brake, bits]. */
export function packControls(c: Controls): [number, number, number, number] {
  const bits = (c.boost ? 1 : 0) | (c.drift ? 2 : 0) | (c.reset ? 4 : 0) | (c.lookBack ? 8 : 0) | (c.horn ? 16 : 0);
  return [quantize(c.steer), quantize(c.throttle), quantize(c.brake), bits];
}

export function unpackControls(p: readonly number[], out: Controls): Controls {
  out.steer = p[0];
  out.throttle = p[1];
  out.brake = p[2];
  out.boost = (p[3] & 1) !== 0;
  out.drift = (p[3] & 2) !== 0;
  out.reset = (p[3] & 4) !== 0;
  out.lookBack = (p[3] & 8) !== 0;
  out.horn = (p[3] & 16) !== 0;
  return out;
}
