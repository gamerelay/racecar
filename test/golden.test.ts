// The golden fingerprints (docs/CALDERA.md, step 0): every layout's bake, its open ground and a
// fixed 40 s drive must match test/golden/fingerprints.json to the last bit. A clean-up changes
// nothing, so these hold; a change meant to move a map re-records them with
// `bun tools/fingerprint.ts --update`, and says so in its PR.

import { describe, expect, test } from 'bun:test';
import { fingerprint } from '../src/dev/fingerprint';
import { Hasher, hashOf } from '../src/dev/hash';
import { bakeTrack } from '../src/core/track/bake';
import { GOLDEN_KEYS, moved, readGolden } from '../tools/fingerprint';
import { CLASSES, SURFACES, layout } from './helpers';

describe('golden fingerprints', () => {
  const golden = readGolden();
  for (const key of GOLDEN_KEYS)
    test(`${key} is as recorded`, () => {
      // An empty list means nothing moved; otherwise it names what did.
      expect(moved(golden[key], fingerprint(layout(key), CLASSES, SURFACES))).toEqual([]);
    });

  test('a hash sees the last bit of one height', () => {
    const ground = bakeTrack(layout('paradise-open/open'), SURFACES).ground!;
    const before = hashOf(ground);
    const k = ground.h.length >> 1;
    const view = new Uint32Array(ground.h.buffer, ground.h.byteOffset, ground.h.length);
    view[k] ^= 1;
    expect(hashOf(ground)).not.toBe(before);
    view[k] ^= 1;
    expect(hashOf(ground)).toBe(before);
  });

  test('a hash tells numbers, strings and order apart', () => {
    const of = (f: (h: Hasher) => void) => {
      const h = new Hasher();
      f(h);
      return h.hex();
    };
    expect(of((h) => h.num(0))).not.toBe(of((h) => h.num(-0)));
    expect(of((h) => (h.str('ab'), h.str('c')))).not.toBe(of((h) => (h.str('a'), h.str('bc'))));
    expect(hashOf({ a: 1, b: 2 })).toBe(hashOf({ b: 2, a: 1 }));
    expect(hashOf([1, 2])).not.toBe(hashOf([2, 1]));
  });
});
