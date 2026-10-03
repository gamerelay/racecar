// The golden fingerprints (docs/CALDERA.md, step 0): every layout's bake, its open ground and its
// fixed drives must match this platform's recording (test/golden/fingerprints.<platform>-<arch>.json)
// to the last bit. A clean-up changes nothing, so these hold; a change meant to move a map
// re-records them with `bun tools/fingerprint.ts --update`, and says so in its PR.
//
// Floats differ in their last bits between platforms, so a platform with no recording skips the
// check. Any platform that misses or mismatches prints its fresh fingerprints, so CI's can be
// written back from its log: `bun tools/fingerprint.ts --from-ci`.

import { describe, expect, test } from 'bun:test';
import { fingerprint, groundHash, type Fingerprint } from '../src/dev/fingerprint';
import { Hasher, hashOf } from '../src/dev/hash';
import { bakeTrack } from '../src/core/track/bake';
import { FRESH_MARK, GOLDEN_KEYS, PLATFORM, moved, readGolden } from '../tools/fingerprint';
import { CLASSES, SURFACES, layout } from './helpers';

/** A layout's fingerprint takes a second or two here, longer on CI's machines. */
const SLOW = 60_000;

describe('golden fingerprints', () => {
  const golden = readGolden();
  const recorded = Object.keys(golden).length > 0;
  const fresh: Record<string, Fingerprint> = {};
  let differs = !recorded;
  for (const key of GOLDEN_KEYS)
    test(
      `${key} is as recorded`,
      () => {
        const now = fingerprint(layout(key), CLASSES, SURFACES);
        fresh[key] = now;
        if (!recorded) return;
        // An empty list means nothing moved; otherwise it names what did.
        const parts = moved(golden[key], now);
        if (parts.length) differs = true;
        expect(parts).toEqual([]);
      },
      SLOW,
    );
  test('a platform without its recording, or off it, prints its fingerprints', () => {
    if (!differs) return;
    console.log(`${FRESH_MARK} ${PLATFORM} (save as test/golden/fingerprints.${PLATFORM}.json, or run \`bun tools/fingerprint.ts --from-ci\`):`);
    console.log(JSON.stringify(fresh));
  });

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
