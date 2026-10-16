import { describe, expect, test } from 'bun:test';
import { chase, CHASE_TURN, CHASE_TURN_DONUTS, courseFor, StuntDriver, STUNT } from '../src/render/credits-drive';

// The credits' stunt driver (render/credits-drive.ts): figure 8s and donuts that stay where the
// backdrop's camera frames them, with no snaps, the nose into the turn, the same show every time.

const DT = 1 / 120;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Every step of `seconds` of the show. */
function drive(seconds: number) {
  const d = new StuntDriver();
  const steps: { x: number; z: number; heading: number; course: number; yawRate: number; slip: number; speed: number; donuts: boolean }[] = [];
  for (let t = 0; t < seconds; t += DT) {
    d.step(DT);
    steps.push({ ...d.pose });
  }
  return steps;
}

const show = drive(90);

describe('the credits stunt driver', () => {
  test('figure 8s: round the left cone one way and the right cone the other', () => {
    const turning = (side: -1 | 1, sign: 1 | -1) => show.filter((p) => Math.sign(p.x) === side && !p.donuts && p.yawRate * sign > 1).length;
    expect(turning(-1, 1)).toBeGreaterThan(turning(-1, -1) * 5);
    expect(turning(1, -1)).toBeGreaterThan(turning(1, 1) * 5);
  });

  test('donuts at both cones, three full turns each, then back to the 8', () => {
    const runs: { side: number; turned: number }[] = [];
    let run: { side: number; turned: number } | null = null;
    for (let i = 1; i < show.length; i++) {
      const p = show[i];
      if (p.donuts && !run) runs.push((run = { side: Math.sign(p.x), turned: 0 }));
      if (!p.donuts) run = null;
      if (run) run.turned += Math.abs(wrap(p.course - show[i - 1].course));
    }
    // The last may be cut off by the end of the show.
    const done = runs.slice(0, -1);
    expect(done.length).toBeGreaterThanOrEqual(2);
    expect(new Set(done.map((r) => r.side))).toEqual(new Set([-1, 1]));
    for (const r of done) expect(r.turned).toBeGreaterThan(3 * 2 * Math.PI - 0.05);
    expect(show.at(-1)!.donuts || show.slice(-120 * 3).some((p) => !p.donuts)).toBe(true);
  });

  test("stays on the lot the camera frames: the circles either side and the straight between", () => {
    for (const p of show) {
      expect(Math.abs(p.x)).toBeLessThan(STUNT.coneX + STUNT.wide + 2);
      expect(Math.abs(p.z)).toBeLessThan(STUNT.wide + 2);
    }
  });

  test('no snaps: the heading turns smoothly, the slip and speed stay in range', () => {
    for (let i = 1; i < show.length; i++) {
      expect(Math.abs(wrap(show[i].heading - show[i - 1].heading))).toBeLessThan(0.06);
      expect(Math.abs(show[i].slip)).toBeLessThanOrEqual(1.2);
      expect(show[i].speed).toBeGreaterThanOrEqual(8 - 1e-6);
    }
  });

  test('it drifts: in a steady turn the nose points into it, well past the course', () => {
    const steady = show.filter((p, i) => i > 60 && Math.abs(p.yawRate) > 1.2 && Math.abs(show[i - 60].yawRate - p.yawRate) < 0.2);
    expect(steady.length).toBeGreaterThan(1000);
    for (const p of steady) {
      expect(Math.sign(p.slip)).toBe(Math.sign(p.yawRate));
      expect(Math.abs(p.slip)).toBeGreaterThan(0.4);
    }
  });

  test('the same show every time (a reduced-motion still is always the same frame)', () => {
    const again = drive(90);
    expect(again.at(-1)).toEqual(show.at(-1)!);
  });

  test("courseFor: on the circle it's the tangent, outside it heads for the tangent point, inside it turns out", () => {
    // On the circle at (0, −5) round the origin (the car's angles: 0 is +z, π/2 is +x): turning
    // positive it's heading −x, turning negative +x.
    expect(courseFor(0, -5, 0, 0, 5, 1)).toBeCloseTo(-Math.PI / 2, 6);
    expect(courseFor(0, -5, 0, 0, 5, -1)).toBeCloseTo(Math.PI / 2, 6);
    // Far out on -z, it heads back in (toward +z), off to the side the turn needs.
    const out = courseFor(0, -50, 0, 0, 5, 1);
    expect(Math.abs(out)).toBeLessThan(0.2);
    // Inside, it's turned out from the tangent (−π/2) toward straight out (±π).
    const inside = courseFor(0, -2, 0, 0, 5, 1);
    expect(inside).toBeLessThan(-Math.PI / 2);
    expect(inside).toBeGreaterThan(-Math.PI);
  });

  test("the chase camera: behind the car round the 8, slow in the donuts (the car spins, not the world)", () => {
    let yaw = show[0].course;
    let behind = 0;
    let eights = 0;
    for (let i = 1; i < show.length; i++) {
      const p = show[i];
      const next = chase(yaw, p.course, DT, p.donuts);
      expect(Math.abs(wrap(next - yaw))).toBeLessThanOrEqual((p.donuts ? CHASE_TURN_DONUTS : CHASE_TURN) * DT + 1e-9);
      yaw = next;
      if (p.donuts) continue;
      eights++;
      if (Math.abs(wrap(p.course - yaw)) < Math.PI / 3) behind++;
    }
    expect(behind / eights).toBeGreaterThan(0.85);
  });
});
