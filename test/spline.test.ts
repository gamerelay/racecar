import { describe, expect, test } from 'bun:test';
import type { Vec3 } from '../src/core/content';
import { locateCar } from '../src/core/track/locate';
import { newHit, sampleAt } from '../src/core/track/query';
import { catmullRom, sampleDense } from '../src/core/track/spline';
import { citySim } from './helpers';

// The curve every track is drawn with (core/track/spline.ts), and which road a car is on
// (core/track/locate.ts).

const dist = (a: { x: number; y: number; z: number }, p: Vec3) => Math.hypot(a.x - p[0], a.y - p[1], a.z - p[2]);
const circle = (n: number, r: number): Vec3[] => Array.from({ length: n }, (_, k) => [Math.sin((k / n) * Math.PI * 2) * r, 0, Math.cos((k / n) * Math.PI * 2) * r]);

describe('spline', () => {
  test('Catmull-Rom passes through its two middle points, and stays finite with repeated points', () => {
    const [p0, p1, p2, p3]: Vec3[] = [
      [0, 0, 0],
      [10, 0, 0],
      [20, 5, 3],
      [40, 0, 0],
    ];
    const out: Vec3 = [0, 0, 0];
    expect(catmullRom(p0, p1, p2, p3, 0, out)).toEqual(p1);
    catmullRom(p0, p1, p2, p3, 1, out);
    out.forEach((v, i) => expect(v).toBeCloseTo(p2[i], 9));
    // All four the same (a layout with a doubled point): no NaN.
    for (const t of [0, 0.5, 1]) for (const v of catmullRom(p1, p1, p1, p1, t, out)) expect(Number.isFinite(v)).toBe(true);
  });

  test('an open spline goes through every control point, ends on the last, and measures its length', () => {
    const pts: Vec3[] = [
      [0, 0, 0],
      [0, 0, 50],
      [30, 2, 80],
      [80, 0, 80],
    ];
    const d = sampleDense(pts, false);
    expect(d[0]).toMatchObject({ x: 0, y: 0, z: 0, s: 0, seg: 0, t: 0 });
    for (let i = 0; i < pts.length - 1; i++) expect(dist(d.find((p) => p.seg === i && p.t === 0)!, pts[i])).toBeLessThan(1e-9);
    const last = d.at(-1)!;
    expect(dist(last, pts[3])).toBeLessThan(1e-9);
    expect(last).toMatchObject({ seg: 2, t: 1 });
    // s is the distance along it: rising, about a spacing apart, and at least the chords' sum.
    for (let k = 1; k < d.length; k++) {
      const step = d[k].s - d[k - 1].s;
      expect(step).toBeGreaterThan(0);
      expect(step).toBeLessThan(0.5);
    }
    const chords = 50 + Math.hypot(30, 2, 30) + 50;
    expect(last.s).toBeGreaterThanOrEqual(chords - 1e-9);
    expect(last.s).toBeLessThan(chords * 1.05);
  });

  test('a straight line is its own length, sampled about every `spacing`', () => {
    const d = sampleDense(
      [
        [0, 0, 0],
        [0, 0, 10],
        [0, 0, 20],
      ],
      false,
      1,
    );
    expect(d.at(-1)!.s).toBeCloseTo(20, 9);
    expect(d).toHaveLength(21);
    for (const p of d) expect(p.x).toBeCloseTo(0, 12);
  });

  test("a closed one joins back to its start: the last sample is the first, and a circle's length is 2πr", () => {
    const r = 100;
    const d = sampleDense(circle(24, r), true);
    const [first, last] = [d[0], d.at(-1)!];
    expect([last.x, last.y, last.z]).toEqual([first.x, first.y, first.z]);
    expect(last).toMatchObject({ seg: 23, t: 1 });
    expect(Math.abs(last.s - 2 * Math.PI * r) / (2 * Math.PI * r)).toBeLessThan(0.002);
    // It's round: every sample about r from the middle.
    for (const p of d) expect(Math.abs(Math.hypot(p.x, p.z) - r)).toBeLessThan(0.5);
  });

  test('every segment gets at least four samples, however short', () => {
    const d = sampleDense(
      [
        [0, 0, 0],
        [0, 0, 0.01],
        [0, 0, 0.02],
      ],
      false,
    );
    expect(d.filter((p) => p.seg === 0)).toHaveLength(4);
    expect(d.filter((p) => p.seg === 1)).toHaveLength(5);
  });

  test("an open spline's end tangents follow `before` and `after` (a branch leaving the main road); the ends stay put", () => {
    const pts: Vec3[] = [
      [0, 0, 0],
      [0, 0, 20],
    ];
    const plain = sampleDense(pts, false);
    const bent = sampleDense(pts, false, 0.25, [-20, 0, -5], [20, 0, 25]);
    expect(dist(bent[0], pts[0])).toBeLessThan(1e-9);
    expect(dist(bent.at(-1)!, pts[1])).toBeLessThan(1e-9);
    // Mirrored ends: a straight line. Given ends: it bows.
    expect(Math.max(...plain.map((p) => Math.abs(p.x)))).toBeLessThan(1e-9);
    expect(Math.max(...bent.map((p) => Math.abs(p.x)))).toBeGreaterThan(0.5);
  });
});

describe('locate', () => {
  test('a car well onto a branch is on the branch; one at the junction, inside both roads, is free of both walls', () => {
    const sim = citySim();
    const { track, cars } = sim;
    const br = track.splines[1];
    const put = (spline: number, hint: number, x: number, z: number, y = 0) => {
      cars.spline[0] = spline;
      cars.s[0] = hint;
      cars.x[0] = x;
      cars.z[0] = z;
      cars.y[0] = y;
      locateCar(sim, 0);
    };
    const on = (s: number) => sampleAt(br, s, newHit());
    let h = on(40);
    put(0, br.mainFrom, h.cx, h.cz, h.cy);
    expect([cars.spline[0], cars.junctionFree[0]]).toEqual([1, 0]);
    expect(cars.s[0]).toBeCloseTo(40, 1);
    expect(cars.lateral[0]).toBeCloseTo(0, 1);
    // Near the junction, inside both: it stays on whichever it was on (hysteresis), walls off.
    h = on(10);
    put(0, br.mainFrom, h.cx, h.cz, h.cy);
    expect([cars.spline[0], cars.junctionFree[0]]).toEqual([0, 1]);
    put(1, 10, h.cx, h.cz, h.cy);
    expect([cars.spline[0], cars.junctionFree[0]]).toEqual([1, 1]);
  });

  test('a car off the end of a branch (back on the main road before it) is on the main road', () => {
    const sim = citySim();
    const { track, cars } = sim;
    const br = track.splines[1];
    const m = sampleAt(track.main, br.mainFrom - 40, newHit());
    cars.spline[0] = 1;
    cars.s[0] = 1;
    cars.x[0] = m.cx;
    cars.z[0] = m.cz;
    locateCar(sim, 0);
    expect(cars.spline[0]).toBe(0);
    expect(cars.s[0]).toBeCloseTo(br.mainFrom - 40, 0);
  });

  test("a stale hint (a teleport across the map) is searched again, not trusted", () => {
    const sim = citySim();
    const { track, cars } = sim;
    const at = sampleAt(track.main, 1000, newHit());
    cars.spline[0] = 0;
    cars.s[0] = 2500;
    // 3 m to one side of the centerline.
    cars.x[0] = at.cx + at.tz * 3;
    cars.z[0] = at.cz - at.tx * 3;
    locateCar(sim, 0);
    expect(cars.spline[0]).toBe(0);
    expect(cars.s[0]).toBeCloseTo(1000, 0);
    expect(Math.abs(cars.lateral[0])).toBeCloseTo(3, 1);
  });
});
