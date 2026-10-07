// The golden fingerprints (docs/CALDERA.md, step 0): every layout's bake, its open ground and its
// fixed drives must match the recording (test/golden/fingerprints.json) to the last bit, on every
// platform: the sim does its own math (src/core/math.ts), so the bits don't depend on the OS or CPU. A clean-up changes nothing, so these hold; a change meant to move a map
// re-records them with `bun tools/fingerprint.ts --update`, and says so in its PR.

import { describe, expect, test } from 'bun:test';
import { fingerprint, groundHash } from '../src/dev/fingerprint';
import { Hasher, hashOf } from '../src/dev/hash';
import { bakeTrack } from '../src/core/track/bake';
import { GOLDEN_KEYS, moved, readGolden } from '../tools/fingerprint';
import { CLASSES, SURFACES, layout } from './helpers';
import { EXPERIMENTAL_KEYS } from '../tools/content';

/** A layout's fingerprint takes a second or two here, longer on CI's machines. */
const SLOW = 60_000;

describe('golden fingerprints', () => {
  const golden = readGolden();
  // (An experimental map not recorded yet is skipped, as Sahara was while it was built (docs/
  // SAHARA.md: "we can hold off on recording fingerprints for now"); a map in the game always has one.)
  for (const key of GOLDEN_KEYS)
    (golden[key] || !EXPERIMENTAL_KEYS.includes(key) ? test : test.skip)(
      `${key} is as recorded`,
      () => {
        // An empty list means nothing moved; otherwise it names what did.
        expect(moved(golden[key], fingerprint(layout(key), CLASSES, SURFACES))).toEqual([]);
      },
      SLOW,
    );

  const open = layout('paradise-open/open');
  const track = bakeTrack(open, SURFACES);

  test('a hash sees the last bit of one number', () => {
    const h = track.main.py;
    const before = hashOf(h);
    const view = new Uint32Array(h.buffer, h.byteOffset, h.length * 2);
    view[2] ^= 1;
    expect(hashOf(h)).not.toBe(before);
    view[2] ^= 1;
    expect(hashOf(h)).toBe(before);
  });

  test(
    "the ground's fingerprint is by its answers: it sees the lava's level, which lives only in a query",
    () => {
      const raised = layout('paradise-open/open');
      raised.ground!.volcano!.lava += 0.5;
      const other = bakeTrack(raised, SURFACES);
      // The heights can't tell them apart; the answers to the ground's questions can.
      expect(hashOf(other.ground!.h)).toBe(hashOf(track.ground!.h));
      expect(groundHash(other)).not.toBe(groundHash(track));
    },
    SLOW,
  );

  test('a hash tells numbers, strings, nesting and order apart', () => {
    const of = (f: (h: Hasher) => void) => {
      const h = new Hasher();
      f(h);
      return h.hex();
    };
    expect(of((h) => h.num(0))).not.toBe(of((h) => h.num(-0)));
    expect(of((h) => (h.str('ab'), h.str('c')))).not.toBe(of((h) => (h.str('a'), h.str('bc'))));
    expect(hashOf({ a: 1, b: 2 })).toBe(hashOf({ b: 2, a: 1 }));
    expect(hashOf([1, 2])).not.toBe(hashOf([2, 1]));
    expect(hashOf({ a: { b: 1 }, c: 2 })).not.toBe(hashOf({ a: { b: 1, c: 2 } }));
  });
});
