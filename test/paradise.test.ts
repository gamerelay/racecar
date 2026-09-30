import { describe, expect, test } from 'bun:test';
import { Ev } from '../src/core/events';
import { Sim } from '../src/core/sim';
import { bakeTrack, wrap } from '../src/core/track/bake';
import { validateLayout } from '../src/core/track/validate';
import { PALETTES } from '../src/render/skins/greybox/palettes';
import { buildTerrain, coneHeight, loopDist } from '../src/render/skins/greybox/terrain';
import { lapReport } from '../tools/lap';
import { CLASSES, SURFACES, layout } from './helpers';

// Paradise (PLAN phase 5): the Island's lap, its land and sea, and how the AI drives it.

const island = layout('paradise/island');
const track = bakeTrack(island, SURFACES);
const main = track.main;
const land = buildTerrain(track, PALETTES.tropic, 1);
const sea = island.terrain!.sea!;

/** The main road's sample nearest (x, z) (and y, where it passes over itself). */
const nearest = (x: number, z: number, y = 0) => {
  const d = (i: number) => Math.hypot(main.px[i] - x, main.pz[i] - z, (main.py[i] - y) * 3);
  let best = 0;
  for (let i = 1; i < main.n; i++) if (d(i) < d(best)) best = i;
  return best;
};

describe('Paradise (Island)', () => {
  test('the layout validates clean', () => {
    expect(validateLayout(island, SURFACES, CLASSES)).toEqual([]);
  });

  test('a lap is 3.3–3.8 km, clockwise, on asphalt, sand, red earth and lava rock', () => {
    expect(main.length).toBeGreaterThan(3300);
    expect(main.length).toBeLessThan(3800);
    // Heading change round the lap: a full turn to the right (turnAt's sign: left is positive).
    let turn = 0;
    for (let i = 0; i < main.n; i++) {
      const j = (i + 1) % main.n;
      turn += wrap(Math.atan2(main.tx[j], main.tz[j]) - Math.atan2(main.tx[i], main.tz[i]) + Math.PI, Math.PI * 2) - Math.PI;
    }
    expect(turn).toBeCloseTo(-Math.PI * 2, 1);
    const used = new Set(track.splines.flatMap((sp) => [...sp.surface].map((k) => SURFACES[k].id)));
    for (const s of ['asphalt', 'sand', 'red-earth', 'lava-rock']) expect(used).toContain(s);
    expect(track.splines[1].zones.some((z) => SURFACES[z.surface].id === 'shore')).toBe(true);
  });

  test('the roads are wide: the coast road 18 m and more, nowhere under 14 m (but the shortcuts)', () => {
    expect(Math.min(...main.width)).toBeGreaterThanOrEqual(14.5);
    expect(main.width[nearest(-410, 170)]).toBeGreaterThanOrEqual(18);
  });

  test('corners bank into the turn', () => {
    // Where the road turns hard over 30 m and is banked, it's lowered on the inside: a left
    // (positive turn) has a negative bank.
    const half = Math.round(15 / main.step);
    let banked = 0;
    for (let i = 0; i < main.n; i += 3) {
      const a = (i - half + main.n) % main.n;
      const b = (i + half) % main.n;
      const t = wrap(Math.atan2(main.tx[b], main.tz[b]) - Math.atan2(main.tx[a], main.tz[a]) + Math.PI, Math.PI * 2) - Math.PI;
      if (Math.abs(t) < 0.35 || Math.abs(main.bank[i]) < 0.03) continue;
      expect(Math.sign(main.bank[i])).toBe(-Math.sign(t));
      banked++;
    }
    expect(banked).toBeGreaterThan(40);
  });

  test('the land never comes up through a road, and the sea is below every road', () => {
    for (const sp of track.splines) {
      let worst = 0;
      for (let i = 0; i < sp.n; i += 2) {
        const y = sp.py[i] + sp.ramp[i];
        expect(y).toBeGreaterThan(sea + 1.5);
        if (land.deck[sp.index][i]) continue;
        const half = sp.width[i] / 2 + sp.shoulder[i];
        const tb = Math.tan(sp.bank[i]);
        for (let l = -half; l <= half; l += 1) worst = Math.max(worst, land.height(sp.px[i] - sp.tz[i] * l, sp.pz[i] + sp.tx[i] * l) - (y - l * tb));
        // Off the decks the road is on land: the island, not the sea.
        expect(land.sea!.coast(sp.px[i], sp.pz[i])).toBeGreaterThan(0);
      }
      expect(worst).toBeLessThan(0.05);
    }
  });

  test('the Freeway is a deck over the bay, 10–14 m up, and the town is on the ground', () => {
    for (const x of [-200, 0, 120]) {
      const i = nearest(x, -430, 12);
      expect(land.deck[0][i]).toBe(1);
      expect(main.py[i]).toBeGreaterThan(10);
      expect(main.py[i]).toBeLessThan(14.5);
      // Over the water.
      expect(land.height(main.px[i], main.pz[i])).toBeLessThan(sea);
    }
    expect(land.deck[0][nearest(60, 430)]).toBe(0);
    let deck = 0;
    for (let i = 0; i < main.n; i++) deck += land.deck[0][i];
    expect(deck * main.step).toBeGreaterThan(350);
  });

  test('the island: sea past the coast, a beach, and the volcano rising to its crater', () => {
    const v = island.terrain!.volcano!;
    expect(loopDist([[0, 0], [10, 0], [10, 10], [0, 10]], 5, 5)).toBeCloseTo(5);
    expect(loopDist([[0, 0], [10, 0], [10, 10], [0, 10]], 15, 5)).toBeCloseTo(-5);
    // Well out to sea, the bed is under the water.
    expect(land.height(-600, 0)).toBeLessThan(sea - 3);
    expect(land.height(700, 0)).toBeLessThan(sea - 3);
    // The cone: highest at the lip, a bowl inside, and it climbs from its foot.
    expect(coneHeight(v, v.x + v.crater, v.z)).toBeGreaterThan(v.h);
    expect(coneHeight(v, v.x, v.z)).toBeLessThan(v.h - 15);
    expect(coneHeight(v, v.x + v.r, v.z)).toBe(0);
    expect(land.height(v.x + v.crater, v.z)).toBeGreaterThan(v.h * 0.9);
  });

  test('a hard lap flies the jumps and takes both shortcuts without wrecking', () => {
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 3 });
    const i = sim.addCar({ cls: 'coupe', racer: { difficulty: 2 } });
    let cursor = sim.events.head;
    const air: number[] = [];
    let wrecks = 0;
    const took = new Set<string>();
    for (let t = 0; t < 60 * 80; t++) {
      sim.step([]);
      if (sim.cars.spline[i] > 0) took.add(track.splines[sim.cars.spline[i]].id);
      cursor = sim.events.read(cursor, (e) => {
        if (e.car !== i) return;
        if (e.type === Ev.Land) air.push(e.a);
        if (e.type === Ev.Wreck) wrecks++;
      });
    }
    expect(wrecks).toBe(0);
    expect(air.filter((a) => a > 0.5).length).toBeGreaterThanOrEqual(2);
    expect([...took].sort()).toEqual(['lava-tube', 'sandbar']);
  });

  test('the lap floor is around 70 s', () => {
    const r = lapReport('paradise/island', island);
    expect(r.finished).toBe(true);
    expect(r.wrecks).toEqual([]);
    expect(r.lapFloor!).toBeGreaterThan(64);
    expect(r.lapFloor!).toBeLessThan(80);
  });
});
