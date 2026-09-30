import { describe, expect, test } from 'bun:test';
import valley from '../content/maps/backroads/valley.track.json';
import type { TrackLayout } from '../src/core/content';
import { Ev } from '../src/core/events';
import { Sim } from '../src/core/sim';
import { bakeTrack } from '../src/core/track/bake';
import { validateLayout } from '../src/core/track/validate';
import { PALETTES } from '../src/render/skins/greybox/palettes';
import { buildTerrain } from '../src/render/skins/greybox/terrain';
import { CLASSES, SURFACES } from './helpers';

const layout = valley as unknown as TrackLayout;
const track = bakeTrack(layout, SURFACES);

describe('countryside (Valley)', () => {
  test('the layout validates', () => {
    expect(validateLayout(layout, SURFACES, CLASSES).filter((m) => m.level === 'error')).toEqual([]);
  });

  test('the land never comes up through a road, and the river crossings are bridges', () => {
    const land = buildTerrain(track, PALETTES.golden, 1);
    for (const sp of track.splines) {
      let worst = 0;
      for (let i = 0; i < sp.n; i += 2) {
        if (land.deck[sp.index][i]) continue;
        const half = sp.width[i] / 2 + sp.shoulder[i];
        const tb = Math.tan(sp.bank[i]);
        for (let l = -half; l <= half; l += 1) {
          const y = sp.py[i] + sp.ramp[i] - l * tb;
          worst = Math.max(worst, land.height(sp.px[i] - sp.tz[i] * l, sp.pz[i] + sp.tx[i] * l) - y);
        }
      }
      expect(worst).toBeLessThan(0.05);
    }
    // The Trestle (over the river and the start road) and the Covered Bridge.
    const deckAt = (x: number, z: number, y: number) => {
      const sp = track.main;
      const d = (i: number) => Math.hypot(sp.px[i] - x, sp.pz[i] - z, (sp.py[i] - y) * 3);
      let best = 0;
      for (let i = 1; i < sp.n; i++) if (d(i) < d(best)) best = i;
      return land.deck[0][best];
    };
    expect(deckAt(0, -280, 24)).toBe(1);
    expect(deckAt(40, -280, 25)).toBe(1);
    expect(deckAt(55, 320, 2)).toBe(1);
    expect(deckAt(0, -280, 0)).toBe(0);
    expect(deckAt(0, 100, 0)).toBe(0);
    // The Trestle stands well clear of the river road under it.
    expect(land.height(0, -280)).toBeLessThan(2);
  });

  test('a hard lap flies off the jumps and takes the shortcuts without wrecking', () => {
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 3 });
    const i = sim.addCar({ cls: 'coupe', racer: { difficulty: 2 } });
    let cursor = sim.events.head;
    const air: number[] = [];
    let wrecks = 0;
    const took = new Set<string>();
    for (let t = 0; t < 60 * 75; t++) {
      sim.step([]);
      if (sim.cars.spline[i] > 0) took.add(track.splines[sim.cars.spline[i]].id);
      cursor = sim.events.read(cursor, (e) => {
        if (e.car !== i) return;
        if (e.type === Ev.Land) air.push(e.a);
        if (e.type === Ev.Wreck) wrecks++;
      });
    }
    expect(wrecks).toBe(0);
    expect(air.filter((a) => a > 0.5).length).toBeGreaterThanOrEqual(3);
    expect([...took].sort()).toEqual(['barn', 'creek', 'leap']);
  });
});
