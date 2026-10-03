import { describe, expect, test } from 'bun:test';
import type { TrackLayout } from '../src/core/content';
import { bakeTrack, wrap, type BakedSpline } from '../src/core/track/bake';
import { newHit, projectGlobal } from '../src/core/track/query';
import { Cause, Ev } from '../src/core/events';
import { neutralControls } from '../src/core/controls';
import { Sim } from '../src/core/sim';
import { racingLine } from '../src/core/ai/racer';
import { validateLayout } from '../src/core/track/validate';
import { lapReport } from '../tools/lap';
import { CLASSES, SURFACES, layout } from './helpers';

// Shortcut junctions (they used to meet the main road up to 1.7 m off its surface, with a curb
// across the mouth) and the Valley's v3 shape (sweepers to drift, a wider road, banked corners).

const MAPS = ['downtown/downtown', 'backroads/valley', 'paradise/island'];

/** Heading change (radians) over ±`half` samples at i: positive turns left. */
const turnAt = (sp: BakedSpline, i: number, half: number) => {
  const a = (i - half + sp.n) % sp.n;
  const b = (i + half) % sp.n;
  return wrap(Math.atan2(sp.tx[b], sp.tz[b]) - Math.atan2(sp.tx[a], sp.tz[a]) + Math.PI, Math.PI * 2) - Math.PI;
};

describe('shortcut junctions', () => {
  for (const key of MAPS) {
    const track = bakeTrack(layout(key), SURFACES);
    const main = track.main;

    test(`${key}: where a shortcut is on the main road, it's at the main road's height`, () => {
      const hit = newHit();
      for (const sp of track.splines.slice(1)) {
        let worst = 0;
        for (const i of [...Array(60).keys(), ...Array.from({ length: 60 }, (_, k) => sp.n - 1 - k)]) {
          projectGlobal(main, sp.px[i], sp.pz[i], hit, sp.py[i]);
          if (Math.abs(hit.lateral) > hit.width / 2) continue;
          worst = Math.max(worst, Math.abs(sp.py[i] - hit.ground));
        }
        expect(worst).toBeLessThan(0.08);
      }
    });

    test(`${key}: where the verge opens for a shortcut, the wall is open too (on that side)`, () => {
      // The side came from the main road's heading where the branch forks, measured 30 m on: on a
      // curve it picked the wrong side (the Barn's mouths had the far wall open, the near one up).
      for (let i = 0; i < main.n; i++) {
        if (main.openL[i]) expect(main.wallL[i]).toBe(0);
        if (main.openR[i]) expect(main.wallR[i]).toBe(0);
      }
    });

    test(`${key}: the main road's verge opens only across the shortcuts' mouths`, () => {
      const forks = track.splines.slice(1).flatMap((sp) => [sp.mainFrom, sp.mainTo]);
      let open = 0;
      for (let i = 0; i < main.n; i++) {
        if (!main.openL[i] && !main.openR[i]) continue;
        open++;
        const s = i * main.step;
        const nearest = Math.min(...forks.map((f) => Math.abs(wrap(s - f + main.length / 2, main.length) - main.length / 2)));
        expect(nearest).toBeLessThan(90);
      }
      // Each mouth opens it for a stretch.
      expect(open).toBeGreaterThan(forks.length * 5);
    });
  }

  for (const key of MAPS) {
    test(`${key}: wherever a shortcut's deck crosses the main road's verge, the verge is open (no grass through it)`, () => {
      // Opened only round the branch's middle, a branch crossing at an angle had the verge's grass
      // across its deck in a stripe (the Leap's fork).
      const track = bakeTrack(layout(key), SURFACES);
      const main = track.main;
      const hit = newHit();
      let checked = 0;
      for (const sp of track.splines.slice(1)) {
        for (let i = 0; i < sp.n; i++) {
          if (sp.merge[i] <= 0) continue;
          const bh = sp.width[i] / 2;
          for (let l = -bh; l <= bh; l += 1) {
            const x = sp.px[i] - sp.tz[i] * l;
            const z = sp.pz[i] + sp.tx[i] * l;
            projectGlobal(main, x, z, hit, sp.py[i]);
            const mh = hit.width / 2;
            // Well inside the verge's band (not on its edges, where a sample either way decides it).
            if (Math.abs(hit.lateral) < mh + 0.75 || Math.abs(hit.lateral) > mh + hit.shoulder - 0.75) continue;
            const k = Math.round(hit.s / main.step) % main.n;
            const open = hit.lateral < 0 ? main.openL : main.openR;
            expect(open[k]).toBe(1);
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(0);
    });
  }

  test('a branch with its own heights keeps them: held to the main road only on it, no fade', () => {
    // (BranchDef.heights, docs/CALDERA.md step 1c.) Where the default bake fades a branch onto the
    // main road's ground, its own-heights twin is as authored: the default is that, pulled by its
    // merge toward the ground. Where it's on the main road or its verge, both are the ground.
    for (const key of ['downtown/downtown', 'backroads/valley']) {
      const base = layout(key);
      const mine = structuredClone(base);
      for (const b of mine.branches!) b.heights = 'own';
      const def = bakeTrack(base, SURFACES);
      const own = bakeTrack(mine, SURFACES);
      const hit = newHit();
      for (let k = 1; k < def.splines.length; k++) {
        const d = def.splines[k];
        const o = own.splines[k];
        let faded = 0;
        for (let i = 0; i < d.n; i++) {
          const w = d.merge[i];
          if (w <= 0) continue;
          if (w >= 1) {
            expect(o.py[i]).toBeCloseTo(d.py[i], 6);
            continue;
          }
          projectGlobal(def.main, d.px[i], d.pz[i], hit, d.py[i]);
          expect(Math.abs(o.py[i] + (hit.ground - o.py[i]) * w - d.py[i])).toBeLessThan(0.08);
          faded = Math.max(faded, Math.abs(o.py[i] - d.py[i]));
        }
        // The fade moved it, somewhere: the twin isn't the same road.
        expect(faded).toBeGreaterThan(0.5);
      }
    }
  });

  test("Logger's Leap: a bermed left on its own ground, and it rejoins without a kink", () => {
    const track = bakeTrack(layout('backroads/valley'), SURFACES);
    const leap = track.splines.find((sp) => sp.id === 'leap')!;
    // Banked into the left (negative) where it's pulled clear of the ridge road.
    let berm = 0;
    for (let i = 0; i < leap.n; i++) if (leap.merge[i] < 0.1) berm = Math.min(berm, leap.bank[i]);
    expect(berm).toBeLessThan(-0.12);
    // Its last 40 m: no bend tighter than 25 m (it kinked through 18 m, off-camber, onto the Descent).
    const half = 3;
    for (let i = leap.n - Math.round(40 / leap.step); i < leap.n - half; i++) {
      expect(Math.abs(turnAt(leap, i, half))).toBeLessThan((2 * half * leap.step) / 25);
    }
  });

  test('the baker adds a slip road: a shortcut forks off along the main road, not at its first point', () => {
    const strip: TrackLayout = {
      id: 'strip',
      name: 'Strip',
      main: { points: [0, 1, 2, 3, 4].map((k) => ({ p: [0, 0, k * 200] as [number, number, number], width: 16 })) },
      branches: [{ id: 'b', kind: 'shortcut', from: 100, to: 500, points: [{ p: [-25, 0, 160], width: 10 }, { p: [-40, 0, 300], width: 10 }, { p: [-25, 0, 440], width: 10 }] }],
    };
    const b = bakeTrack(strip, SURFACES).splines[1];
    // The first authored point is 23° off; 6 m in, the branch still runs within 10° of the road.
    const i = Math.round(6 / b.step);
    expect(Math.abs(Math.atan2(b.tx[i], b.tz[i])) * (180 / Math.PI)).toBeLessThan(10);
    expect(validateLayout(strip, SURFACES, CLASSES).filter((p) => p.message.includes('leaves the main road'))).toEqual([]);
  });

  test('the validator warns about a shortcut that forks off sharply', () => {
    const bad = layout('backroads/valley');
    const creek = bad.branches!.find((b) => b.id === 'creek')!;
    // Its first point swung out to the side of the fork: 10 m along, 25 m out.
    const main = bakeTrack(bad, SURFACES).main;
    const i = Math.round((creek.from + 10) / main.step);
    creek.points[0] = { ...creek.points[0], p: [main.px[i] + main.tz[i] * 25, main.py[i], main.pz[i] - main.tx[i] * 25] };
    const warnings = validateLayout(bad, SURFACES, CLASSES).filter((m) => m.level === 'warning' && m.message.includes('creek leaves the main road'));
    expect(warnings.length).toBe(1);
    for (const key of MAPS) expect(validateLayout(layout(key), SURFACES, CLASSES).filter((m) => m.message.includes('the main road at'))).toEqual([]);
  });
});

describe('Valley v3', () => {
  const track = bakeTrack(layout('backroads/valley'), SURFACES);
  const main = track.main;

  test('a lap of corners to drift: more of them, sweepers among them, and shorter straights', () => {
    // A corner is a run turning more than 20° over 40 m; its radius is at its tightest.
    // (v2: 18 corners, 8 of them sweepers, 41% of the lap curved, a 454 m straight.)
    const radii: number[] = [];
    let peak = 0;
    let curved = 0;
    let longest = 0;
    let straight = 0;
    const first = (() => {
      let k = 0;
      while (Math.abs(turnAt(main, k, 20)) > (20 * Math.PI) / 180) k++;
      return k;
    })();
    for (let j = 0; j <= main.n; j++) {
      const i = (first + j) % main.n;
      const turn = Math.abs(turnAt(main, i, 20));
      if (turn > (20 * Math.PI) / 180) peak = Math.max(peak, turn);
      else if (peak > 0) {
        radii.push((40 * main.step) / peak);
        peak = 0;
      }
      if (j < main.n && turn > (10 * Math.PI) / 180) curved++;
      straight = turn < (4 * Math.PI) / 180 ? straight + main.step : 0;
      longest = Math.max(longest, straight);
    }
    expect(radii.length).toBeGreaterThanOrEqual(24);
    expect(radii.filter((r) => r >= 35 && r <= 110).length).toBeGreaterThanOrEqual(16);
    expect(curved / main.n).toBeGreaterThan(0.55);
    expect(longest).toBeLessThan(350);
  });

  test('the road is wider, and wider still through the sweepers', () => {
    let narrowest = Infinity;
    for (let i = 0; i < main.n; i++) narrowest = Math.min(narrowest, main.width[i]);
    expect(narrowest).toBeGreaterThanOrEqual(13);
    expect(Math.max(...main.width)).toBeGreaterThanOrEqual(15.5);
  });

  test('corners bank into the turn, and the bank rolls over rather than flips', () => {
    let banked = 0;
    let steepest = 0;
    for (let i = 0; i < main.n; i++) {
      const turn = turnAt(main, i, 10);
      if (Math.abs(main.bank[i]) > 0.04 && Math.abs(turn) > 0.15) {
        banked++;
        // A left turn (positive) lowers the left side, which is a negative bank.
        expect(Math.sign(main.bank[i])).toBe(-Math.sign(turn));
      }
      steepest = Math.max(steepest, Math.abs(main.bank[(i + 1) % main.n] - main.bank[i]) / main.step);
    }
    expect(banked).toBeGreaterThan(300);
    // Under 0.5° per meter.
    expect(steepest).toBeLessThan((0.5 * Math.PI) / 180);
  });
});

describe('the Trestle stands on the road under it', () => {
  const track = bakeTrack(layout('backroads/valley'), SURFACES);
  const legs = track.props.filter((p) => p.kind === 'trestle-leg');

  test('its legs on the home stretch are solid, and rows of them leave gaps to drive through', () => {
    expect(legs.length).toBeGreaterThanOrEqual(8);
    for (const p of legs) {
      expect(p.solid).toBe(true);
      // On the road (or its shoulder) under the deck, reaching up to it.
      const sp = track.splines[p.spline];
      const i = Math.round(p.s / sp.step);
      expect(Math.abs(p.lateral)).toBeLessThan(sp.width[i] / 2 + sp.shoulder[i] + 1);
      expect(p.y + p.hy * 2).toBeGreaterThan(sp.py[i] + 15);
    }
    // A gap wide enough for a car between neighbouring rows.
    const lats = [...new Set(legs.map((p) => Math.round(p.lateral)))].sort((a, b) => a - b);
    expect(Math.max(...lats.slice(1).map((l, k) => l - lats[k]))).toBeGreaterThan(5);
    // The city's flyovers span the roads beneath them: no legs there.
    expect(bakeTrack(layout('downtown/downtown'), SURFACES).props.some((p) => p.kind === 'trestle-leg')).toBe(false);
  });

  test('driving into a leg at speed wrecks you', () => {
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1 });
    const i = sim.addCar({ cls: 'coupe', human: true });
    const leg = legs[0];
    sim.placeCar(i, leg.spline, leg.s - 40, leg.lateral, 40);
    const c = { ...neutralControls(), throttle: 1 };
    let cause = -1;
    let cursor = sim.events.head;
    for (let t = 0; t < 120 && cause < 0; t++) {
      sim.step([c]);
      cursor = sim.events.read(cursor, (e) => {
        if (e.type === Ev.Wreck && e.car === i) cause = e.b;
      });
    }
    expect(cause).toBe(Cause.Prop);
  });
});

describe('the AI under the Trestle', () => {
  const track = bakeTrack(layout('backroads/valley'), SURFACES);
  const legs = track.props.filter((p) => p.kind === 'trestle-leg');

  test('the racing line threads a gap between the legs, with room for a car either side', () => {
    const line = racingLine(track, track.main);
    for (const p of legs) {
      const i = Math.round(p.s / track.main.step);
      expect(Math.abs(line.offset[i] - p.lateral)).toBeGreaterThan(p.hx + 2);
    }
  });

  test('hard AIs race through it without wrecking (they swerved late into the traffic lane)', () => {
    for (const [seed, cls] of [[1, 'coupe'], [3, 'coupe'], [5, 'police'], [8, 'muscle']] as const) {
      const sim = new Sim(track, CLASSES, SURFACES, { seed });
      const i = sim.addCar({ cls, racer: { difficulty: 2 } });
      let wrecks = 0;
      let cursor = sim.events.head;
      let passed = false;
      for (let t = 0; t < 60 * 75; t++) {
        sim.step([]);
        if (sim.cars.spline[i] === 0 && sim.cars.s[i] > 2760 && sim.cars.s[i] < 2800) passed = true;
        cursor = sim.events.read(cursor, (e) => {
          if (e.car === i && e.type === Ev.Wreck && sim.cars.s[i] > 2600 && sim.cars.s[i] < 2800) wrecks++;
        });
      }
      expect(passed).toBe(true);
      expect(wrecks).toBe(0);
    }
  });
});

describe("Downtown's field wrecks", () => {
  test('an 8-car field with traffic and hazards wrecks at most 1.5 times a race (MAPS.md)', () => {
    // It was quoted as ~1.6 since the quick wins; a 16-seed sweep found 1.0 (SPEC "Downtown's
    // field wrecks"), so nothing moved.
    const downtown = layout('downtown/downtown');
    let wrecks = 0;
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    for (const seed of seeds) {
      const r = lapReport('downtown/downtown', downtown, 'coupe', { field: true, seed });
      expect(r.finished, `seed ${seed}`).toBe(true);
      wrecks += r.wrecks.length;
    }
    expect(wrecks / seeds.length).toBeLessThanOrEqual(1.5);
  }, 30_000);
});
