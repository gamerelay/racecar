import { describe, expect, test } from 'bun:test';
import { neutralControls } from '../src/core/controls';
import { Ev, type GameEvent } from '../src/core/events';
import { TUNING } from '../src/core/car/tuning';
import { wrapAngle } from '../src/core/math';
import { ringSim } from './helpers';

// Drift chains: drifts that start within TUNING.chainWindow of the last one's end link up, bank
// more boost each, and pay a pop when the chain runs out; a spin-out breaks one.

/** Up to speed on a huge open ring, then `plan`: drift for d[0] s, straighten for d[1] s, drift d[2] s… */
function run(plan: number[], opts: { spinIn?: number } = {}) {
  const sim = ringSim(1, 600, 320);
  const i = sim.addCar({ cls: 'coupe', human: true });
  const c = neutralControls();
  c.throttle = 1;
  for (let t = 0; t < 60 * 3; t++) sim.step([c]);
  const seen: GameEvent[] = [];
  let cursor = sim.events.head;
  const step = () => {
    sim.step([c]);
    cursor = sim.events.read(cursor, (e) => {
      if (e.car === i) seen.push({ ...e });
    });
  };
  plan.forEach((seconds, k) => {
    const drifting = k % 2 === 0;
    c.drift = drifting;
    c.steer = drifting ? -1 : 0;
    // Empty meter at each drift's start, so no payout is capped by a full bar.
    if (drifting) sim.cars.boost[i] = 0;
    for (let t = 0; t < 60 * seconds; t++) {
      step();
      if (opts.spinIn === k && t === 60) sim.cars.h[i] = wrapAngle(sim.cars.h[i] + Math.sign(sim.cars.slip[i]) * 0.6);
    }
  });
  c.drift = false;
  c.steer = 0;
  // Let the last window run out.
  for (let t = 0; t < 60 * (TUNING.chainWindow + 1); t++) step();
  const of = (type: number) => seen.filter((e) => e.type === type);
  return { sim, i, of };
}

describe('drift chains', () => {
  test('two drifts inside the window make a chain, which pays a pop with both drifts in it', () => {
    const { of } = run([1.2, 0.6, 1.2]);
    const chain = of(Ev.DriftChain);
    expect(chain.length).toBe(1);
    expect(chain[0].b).toBe(2);
    expect(chain[0].a).toBeGreaterThan(500);
  });

  /** The same drives with a window shorter than their gap: two lone drifts. */
  const unlinked = <T>(f: () => T): T => {
    const was = TUNING.chainWindow;
    (TUNING as { chainWindow: number }).chainWindow = 0.3;
    try {
      return f();
    } finally {
      (TUNING as { chainWindow: number }).chainWindow = was;
    }
  };

  test('drifts further apart than the window are two lone drifts, with no chain pop', () => {
    const { of } = unlinked(() => run([1.2, 0.6, 1.2]));
    expect(of(Ev.DriftChain)).toEqual([]);
  });

  test("the window doesn't run during a drift: a long second drift keeps the chain", () => {
    // Before, the second drift outlasting the window quietly dropped the chain.
    const { of } = run([1.2, 0.5, TUNING.chainWindow + 1.5, 0.5, 1.2]);
    const chain = of(Ev.DriftChain);
    expect(chain.length).toBe(1);
    expect(chain[0].b).toBe(3);
  });

  test('a linked drift banks more boost than the same drift alone', () => {
    const linked = run([1.2, 0.6, 1.2]).of(Ev.DriftBoost);
    const alone = unlinked(() => run([1.2, 0.6, 1.2])).of(Ev.DriftBoost);
    expect(linked.length).toBe(2);
    expect(alone.length).toBe(2);
    const ratio = linked[1].a / alone[1].a;
    // ×(1 + chainBoost) for the one link, give or take the speed the gap left it at.
    expect(ratio).toBeGreaterThan(1 + TUNING.chainBoost * 0.6);
    expect(ratio).toBeLessThan(1 + TUNING.chainBoost * 1.6);
  });

  test('a spin-out in the second drift loses the chain: a lost pop, no chain pop', () => {
    const { sim, i, of } = run([1.2, 0.6, 1.5], { spinIn: 2 });
    const lost = of(Ev.ChainLost);
    expect(lost.length).toBe(1);
    expect(lost[0].b).toBe(2);
    expect(of(Ev.DriftChain)).toEqual([]);
    expect(sim.cars.driftChain[i]).toBe(0);
    expect(sim.cars.chainPts[i]).toBe(0);
  });
});
