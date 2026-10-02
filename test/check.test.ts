import { describe, expect, test } from 'bun:test';
import { clamp, fields, finite, finiteOr, intIn, shortText } from '../src/net/check';

// The checks on what another player's page sends during a race (net/check.ts): their word, so
// anything that isn't the shape asked for is null.

/** What a hostile or broken page might send in place of a number or a name. */
const JUNK: unknown[] = [NaN, Infinity, -Infinity, '1', '', true, null, undefined, {}, [], [1], () => 1, 1n, Symbol('x'), new Number(1), new String('a')];

describe('net checks', () => {
  test('finite: a finite number as it is, anything else null', () => {
    for (const v of [0, -0, 1, -2.5, 1e308, -1e308, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER]) expect(finite(v)).toBe(v as number);
    for (const v of JUNK) expect(finite(v)).toBeNull();
    // A number too big for a double, as JSON brings it in: Infinity, refused.
    expect(finite(JSON.parse('1e999'))).toBeNull();
  });

  test('finiteOr: the number, or the fallback for anything else', () => {
    expect(finiteOr(3, 7)).toBe(3);
    expect(finiteOr(0, 7)).toBe(0);
    for (const v of JUNK) expect(finiteOr(v, 7)).toBe(7);
  });

  test('intIn: an integer within its bounds (both included), else null', () => {
    expect(intIn(0, 0, 5)).toBe(0);
    expect(intIn(5, 0, 5)).toBe(5);
    expect(intIn(-1, 0, 5)).toBeNull();
    expect(intIn(6, 0, 5)).toBeNull();
    expect(intIn(2.5, 0, 5)).toBeNull();
    // Huge numbers are integers to JavaScript: the bounds keep them out.
    expect(intIn(1e300, 0, 2 ** 31 - 1)).toBeNull();
    expect(intIn(2 ** 53, 0, 2 ** 31 - 1)).toBeNull();
    // Infinity isn't an integer, even with no upper bound.
    expect(intIn(Infinity, 0, Infinity)).toBeNull();
    for (const v of JUNK) expect(intIn(v, -10, 10)).toBeNull();
    // An empty range (a count of 0, `count - 1` = -1) lets nothing through.
    expect(intIn(0, 0, -1)).toBeNull();
  });

  test('shortText: a non-empty string up to its limit (64 by default), else null', () => {
    expect(shortText('a')).toBe('a');
    expect(shortText('x'.repeat(64))).toBe('x'.repeat(64));
    expect(shortText('x'.repeat(65))).toBeNull();
    expect(shortText('abc', 3)).toBe('abc');
    expect(shortText('abcd', 3)).toBeNull();
    expect(shortText('')).toBeNull();
    for (const v of JUNK.filter((v) => typeof v !== 'string')) expect(shortText(v)).toBeNull();
    // Megabytes of name are refused without trouble.
    expect(shortText('x'.repeat(5_000_000))).toBeNull();
  });

  test("clamp bounds a number, but isn't a check: NaN goes through, so callers check finite first", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp(Infinity, -1e4, 1e4)).toBe(1e4);
    expect(clamp(-Infinity, -1e4, 1e4)).toBe(-1e4);
    expect(clamp(NaN, 0, 1)).toBeNaN();
  });

  test("fields: a plain object's fields to read, never an array or a primitive", () => {
    const o = { a: 1 };
    expect(fields(o)).toBe(o);
    expect(fields({})).toEqual({});
    for (const v of [null, undefined, 0, 1, '', 'x', true, [], [1, 2], NaN]) expect(fields(v)).toBeNull();
    // One with no prototype is still fields.
    const bare = Object.create(null) as Record<string, unknown>;
    bare.k = 1;
    expect(fields(bare)?.k).toBe(1);
  });

  test("a __proto__ key off the network is only a field: it changes no prototype, and reads nothing it doesn't hold", () => {
    const evil = JSON.parse('{"__proto__": {"polluted": 1, "k": 3}, "constructor": {"prototype": {"polluted": 1}}}') as unknown;
    const f = fields(evil)!;
    expect(f).not.toBeNull();
    expect(Object.getPrototypeOf(f)).toBe(Object.prototype);
    expect(f.k).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // The checks on its fields refuse what's there (objects, not numbers or names).
    expect(finite(f.constructor)).toBeNull();
    expect(intIn(f.k, 0, 9)).toBeNull();
    expect(shortText(f.__proto__)).toBeNull();
  });
});
