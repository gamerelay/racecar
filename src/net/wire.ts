// What other players' pages send during a race, checked before anything uses it (as lobby/wire.ts
// does for the lobby): each reader returns the message in its proper shape, or null if it's
// malformed. Whether its sender may say it (it owns that car, it holds that claim) is the layer's
// to decide; this is only the shape. Pure: no SDK, no DOM.

import { Cause } from '../core/events';
import { clamp, fields, finite, intIn, shortText } from './check';

/** A traffic car's wreck, from the claim's winner (net/traffic.ts). */
export interface TrafficHit {
  k: number;
  /** When, on the race's clock (s). */
  t: number;
  x: number;
  y: number;
  z: number;
  /** How hard (m/s). */
  a: number;
  /** 0 a crash, 1 a check. */
  b: 0 | 1;
}

/** A traffic hit, checked: a traffic car there is (`count` of them), a time within `within` s of `now`. */
export function readHit(data: unknown, count: number, now: number, within: number): TrafficHit | null {
  const d = fields(data);
  if (!d) return null;
  const k = intIn(d.k, 0, count - 1);
  const t = finite(d.t);
  const [x, y, z, a] = [finite(d.x), finite(d.y), finite(d.z), finite(d.a)];
  if (k === null || t === null || Math.abs(t - now) > within || x === null || y === null || z === null || a === null) return null;
  return { k, t, x, y, z, a: clamp(a, 0, 100), b: d.b === 1 ? 1 : 0 };
}

/** The most a contact's closing speed can be (m/s), as with poses. */
export const MAX_CLOSING = 140;

/** A bump to one of your cars, from the owner of the car that made it (net/contact.ts). */
export interface Bump {
  /** Your car, and theirs, by name (`p:<id>`, `s:<seat>`). */
  to: string;
  by: string;
  t: number;
  /** The change in your car's velocity (m/s). */
  dvx: number;
  dvz: number;
  closing: number;
  /** Their car was the attacker. */
  att: boolean;
}

export function readBump(data: unknown): Bump | null {
  const d = fields(data);
  if (!d) return null;
  const [to, by] = [shortText(d.to), shortText(d.by)];
  const [t, dvx, dvz, closing] = [finite(d.t), finite(d.dvx), finite(d.dvz), finite(d.closing)];
  if (!to || !by || to === by || t === null || dvx === null || dvz === null || closing === null) return null;
  return { to, by, t, dvx, dvz, closing: clamp(closing, 0, MAX_CLOSING), att: d.att === true };
}

/** A takedown your car made, from the victim's owner. */
export interface Takedown {
  victim: string;
  by: string;
  t: number;
}

export function readTakedown(data: unknown): Takedown | null {
  const d = fields(data);
  if (!d) return null;
  const [victim, by, t] = [shortText(d.victim), shortText(d.by), finite(d.t)];
  return victim && by && victim !== by && t !== null ? { victim, by, t } : null;
}

/** A rival's handover field as the host sent it (net/rivals.ts): in its range, or null to leave this screen's. */
export function readHandover(k: string, v: unknown, splines: number): number | null {
  const n = finite(v);
  if (n === null) return null;
  switch (k) {
    case 'lastSpline':
      return intIn(n, 0, splines - 1);
    case 'wreckCause':
      return Number.isInteger(n) && Object.values(Cause).includes(n as never) ? n : null;
    case 'boost':
      return clamp(n, 0, 1);
    case 'wreckT':
      return clamp(n, 0, 60);
    default:
      return clamp(n, -1e4, 1e4);
  }
}
