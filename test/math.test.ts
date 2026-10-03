// The sim's own math (src/core/math.ts; docs/CALDERA.md, "Same math in every browser"): close to
// Math's, the same bits on every platform, and the only math src/core uses.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atan, atan2, cos, exp, hypot, log, pow, sin, tan } from '../src/core/math';
import { Hasher } from '../src/dev/hash';

const view = new DataView(new ArrayBuffer(8));
/** How many doubles apart a and b are. */
function ulps(a: number, b: number): number {
  if (Object.is(a, b) || (a !== a && b !== b)) return 0;
  if (a === 0 && b === 0) return Infinity; // +0 and -0: a sign wrong
  const ord = (x: number) => {
    view.setFloat64(0, x);
    const i = view.getBigInt64(0);
    return i < 0n ? -(i & 0x7fffffffffffffffn) : i;
  };
  const d = ord(a) - ord(b);
  return Number(d < 0n ? -d : d);
}

/** The next double up from x (x finite and not 0). */
function nextUp(x: number): number {
  view.setFloat64(0, x);
  view.setBigInt64(0, view.getBigInt64(0) + (x > 0 ? 1n : -1n));
  return view.getFloat64(0);
}

let seed = 1;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

type Case = [name: string, ours: (x: number, y: number) => number, theirs: (x: number, y: number) => number, input: () => number[], most: number];
const CASES: Case[] = [
  ['sin', sin, Math.sin, () => [(rnd() - 0.5) * 40], 2],
  ['sin, far out', sin, Math.sin, () => [(rnd() - 0.5) * 2e6], 2],
  ['cos', cos, Math.cos, () => [(rnd() - 0.5) * 40], 2],
  ['tan', tan, Math.tan, () => [(rnd() - 0.5) * 3], 4],
  ['atan', atan, Math.atan, () => [(rnd() - 0.5) * 10 ** (rnd() * 8 - 4)], 2],
  ['atan2', atan2, Math.atan2, () => [rnd() - 0.5, rnd() - 0.5], 2],
  ['exp', exp, Math.exp, () => [(rnd() - 0.5) * 60], 2],
  ['log', log, Math.log, () => [10 ** (rnd() * 12 - 6)], 2],
  ['pow, the game’s sizes', pow, Math.pow, () => [0.01 + rnd() * 3, rnd() * 2], 16],
  ['hypot', hypot, Math.hypot, () => [(rnd() - 0.5) * 1e3, (rnd() - 0.5) * 1e3], 2],
];

describe('own math', () => {
  for (const [name, ours, theirs, input, most] of CASES)
    test(`${name}: within ${most} ulp of Math's`, () => {
      let worst = 0;
      for (let k = 0; k < 20000; k++) {
        const [x, y] = input();
        worst = Math.max(worst, ulps(ours(x, y), theirs(x, y)));
      }
      expect(worst).toBeLessThanOrEqual(most);
    });

  test('the edges, as Math has them', () => {
    for (const [y, x] of [[0, 0], [-0, 0], [0, -0], [-0, -0], [0, -1], [-0, -1], [1, 0], [-1, -0], [1, -Infinity], [-1, Infinity], [Infinity, Infinity], [-Infinity, -Infinity], [NaN, 1]])
      expect(Object.is(atan2(y, x), Math.atan2(y, x))).toBe(true);
    expect(exp(800)).toBe(Infinity);
    expect(exp(-800)).toBe(0);
    expect(ulps(exp(-740), Math.exp(-740))).toBeLessThanOrEqual(1);
    expect(log(0)).toBe(-Infinity);
    expect(log(-1)).toBeNaN();
    expect(ulps(log(5e-324), Math.log(5e-324))).toBeLessThanOrEqual(1);
    expect(sin(NaN)).toBeNaN();
    expect(cos(Infinity)).toBeNaN();
    for (const x of [-709.79, -708.4, -745.13, 709.78, 0.3465735902799726, -0.3465735902799727]) expect(ulps(exp(x), Math.exp(x))).toBeLessThanOrEqual(1);
    const special = [0, -0, 1, -1, 0.5, -0.5, 2, -2, 3, -3, 65, -65, 1025, -1025, 1026, 0.7, -0.7, 1.5, Infinity, -Infinity, NaN];
    // The special values exactly; a finite answer within about 2·|y·ln x| ulp (e^(y·ln x)).
    for (const x of special)
      for (const y of special) {
        const [a, b] = [pow(x, y), Math.pow(x, y)];
        if (ulps(a, b) > (Number.isFinite(b) && b !== 0 ? 4 + 2 * Math.abs(y * Math.log(Math.abs(x))) : 0)) throw new Error(`pow(${x}, ${y}) is ${pow(x, y)}, Math says ${b}`);
      }
    expect(ulps(atan2(1, -5e-324), Math.atan2(1, -5e-324))).toBe(0);
  });

  test('sin and cos near multiples of π/2 (to 2^20·π/2, past which they only wrap), where most bits cancel', () => {
    let worst = 0;
    for (let n = -1e6; n <= 1e6; n += 997) {
      let x = n * (Math.PI / 2);
      for (let k = 0; k < 3; k++, x = nextUp(x)) worst = Math.max(worst, ulps(sin(x), Math.sin(x)), ulps(cos(x), Math.cos(x)));
    }
    expect(worst).toBeLessThanOrEqual(2);
  });

  // The point of it: these bits on every OS, CPU and engine (CI runs it on Linux x64). If this
  // moves, the math changed, and so do the golden fingerprints.
  test('the same bits everywhere', () => {
    const h = new Hasher();
    seed = 7;
    for (let k = 0; k < 5000; k++) {
      const x = (rnd() - 0.5) * 20;
      const y = rnd() * 3;
      for (const v of [sin(x), cos(x), tan(x * 0.15), atan(x), atan2(x, y - 1.5), exp(x), log(y), pow(y, 1.6), pow(y, 0.3), hypot(x, y)]) h.num(v);
    }
    expect(h.hex()).toBe(BITS);
  });
});

const BITS = '51599ab2928dd6e9';

describe('the sim uses only its own math', () => {
  // Math's exactly-specified parts only; anything else (Math['sin'], `const { sin } = Math`) fails.
  const EXACT = /^\.(abs|min|max|floor|ceil|round|trunc|sqrt|sign|imul|fround|PI|SQRT2)\b/;
  test('src/core and src/dev: no Math.sin and the like, no `**`, no Math.random', () => {
    const found: string[] = [];
    for (const dir of ['core', 'dev']) {
      const root = join(import.meta.dir, '../src', dir);
      for (const f of new Bun.Glob('**/*.ts').scanSync(root)) {
        const code = readFileSync(join(root, f), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '');
        for (const m of code.matchAll(/\bMath\b/g)) if (!EXACT.test(code.slice(m.index + 4))) found.push(`${dir}/${f}: ${code.slice(m.index, m.index + 12)}`);
        if (code.includes('**')) found.push(`${dir}/${f}: **`);
      }
    }
    expect(found).toEqual([]);
  });
});
