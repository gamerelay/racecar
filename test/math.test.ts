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
  const ord = (x: number) => {
    view.setFloat64(0, x);
    const i = view.getBigInt64(0);
    return i < 0n ? -(i & 0x7fffffffffffffffn) : i;
  };
  const d = ord(a) - ord(b);
  return Number(d < 0n ? -d : d);
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
    expect(pow(-2, 3)).toBe(-8);
    expect(pow(-2, 0.5)).toBeNaN();
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

const BITS = 'e2029bd2f0a8d8cb';

describe('src/core uses only its own math', () => {
  test("no Math.sin and the like, no `**`, no Math.random", () => {
    const root = join(import.meta.dir, '../src/core');
    const found: string[] = [];
    for (const f of new Bun.Glob('**/*.ts').scanSync(root)) {
      if (f === 'math.ts') continue;
      const code = readFileSync(join(root, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const m of code.matchAll(/Math\.(sin|cos|tan|asin|acos|atan2?|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot|random)\b|\*\*/g)) found.push(`${f}: ${m[0]}`);
    }
    expect(found).toEqual([]);
  });
});
