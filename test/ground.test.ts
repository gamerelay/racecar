import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import type { TrackLayout } from '../src/core/content';
import { neutralControls } from '../src/core/controls';
import { Sim } from '../src/core/sim';
import { bakeTrack } from '../src/core/track/bake';
import { canyonAt, canyonDepth } from '../src/core/track/ground';
import { buildPines } from '../src/core/track/pines';
import { newHit, projectGlobal, sampleAt } from '../src/core/track/query';
import { slopeView } from '../src/render/camera';
import { Cause, Ev } from '../src/core/events';
import { avalancheSpeed } from '../src/core/world/avalanche';
import { SMASH_IDS } from '../src/core/world/smash';
import { ALL_MAPS, EXPERIMENTAL_KEYS, LAYOUT_KEYS, MAPS } from '../tools/content';
import { CLASSES, SURFACES, layout } from './helpers';

// Open ground (docs/AVALANCHE.md, experimental): a heightfield the car drives on everywhere, the
// slope pulling you along it on snow, and Avalanche's Slope built on it.

// Whole runs down a 6 km mountain: seconds each on a slow CI machine.
setDefaultTimeout(30_000);

/** The Slope, baked once for the file (its ground and forest take a few seconds on a slow machine). */
let baked: ReturnType<typeof bakeTrack> | undefined;
const slope = () => (baked ??= bakeTrack(layout('avalanche/slope'), SURFACES));

/** A straight strip falling `grade` m per m, all ground, its road `surface`. */
function incline(grade: number, surface: string): TrackLayout {
  return {
    id: 'incline',
    name: 'Incline',
    main: { points: [0, 1, 2, 3, 4].map((k) => ({ p: [0, -k * 200 * grade, k * 200] as [number, number, number], width: 30, surface })) },
    ground: { cell: 2, wallFrom: 60, wallRise: 0.8 },
    shoulderSurface: 'powder',
  };
}

/** A car coasting (no throttle) down `layout`'s road from 200 m at `speed`: its speed 3 s on. */
function coast(l: TrackLayout, speed: number): number {
  const sim = new Sim(bakeTrack(l, SURFACES), CLASSES, SURFACES, { seed: 1 });
  const i = sim.addCar({ cls: 'coupe', human: true });
  sim.placeCar(i, 0, 200, 0, speed);
  for (let t = 0; t < 180; t++) sim.step([neutralControls()]);
  return Math.hypot(sim.cars.vx[i], sim.cars.vz[i]);
}

describe('open ground', () => {
  test('it carries the road: along the middle it is the road, and far out it rises into walls', () => {
    const track = bakeTrack(incline(0.2, 'snow'), SURFACES);
    const g = track.ground!;
    const m = track.main;
    let worst = 0;
    for (let i = Math.round(100 / m.step); i < Math.round(600 / m.step); i++) worst = Math.max(worst, Math.abs(g.height(m.px[i], m.pz[i]) - m.py[i]));
    expect(worst).toBeLessThan(0.05);
    // 100 m out (40 past the walls' start), 32 m up.
    const i = Math.round(400 / m.step);
    expect(g.height(m.px[i] - 100, m.pz[i]) - m.py[i]).toBeCloseTo(32, 0);
  });

  test('on snow the slope pulls you down it; on asphalt it doesn\'t', () => {
    // Coasting at 15 m/s down a 20% grade: faster on snow, slower (drag) on asphalt.
    expect(coast(incline(0.2, 'snow'), 15)).toBeGreaterThan(20);
    expect(coast(incline(0.2, 'asphalt'), 15)).toBeLessThan(15);
    // And up it (a negative grade), snow slows you more than asphalt does.
    expect(coast(incline(-0.1, 'snow'), 25)).toBeLessThan(coast(incline(-0.1, 'asphalt'), 25) - 3);
  });

  test("a canyon's walls are a quarter circle: the floor's depth, about 60° at the lip, level ground past it", () => {
    expect(canyonDepth(0, 10, 5)).toBe(5);
    expect(canyonDepth(5, 10, 5)).toBe(5);
    // The lip is sqrt(2 r d - d²) past the floor, r = 2 d: 8.66 m for a 5 m deep canyon.
    expect(canyonDepth(5 + 8.6, 10, 5)).toBeLessThan(0.15);
    expect(canyonDepth(5 + 8.7, 10, 5)).toBe(0);
    const lip = (canyonDepth(5 + 8.5, 10, 5) - canyonDepth(5 + 8.6, 10, 5)) / 0.1;
    expect((Math.atan(lip) * 180) / Math.PI).toBeLessThan(62);
  });
});

describe("Avalanche's Slope", () => {
  test("its ground has no cliffs: nowhere steeper than a canyon's lip (60°) between neighbours", () => {
    const g = slope().ground!;
    let worst = 0;
    for (let gz = 0; gz < g.nz - 1; gz++) {
      for (let gx = 0; gx < g.nx - 1; gx++) {
        const k = gz * g.nx + gx;
        worst = Math.max(worst, Math.abs(g.h[k + 1] - g.h[k]), Math.abs(g.h[k + g.nx] - g.h[k]));
      }
    }
    expect(worst / g.cell).toBeLessThan(Math.tan((60 * Math.PI) / 180));
  });

  test('all the drawn ground is in bounds: a car driven up the walls is only out of bounds where the ground ends', () => {
    const l = layout('avalanche/slope');
    const track = slope();
    const g = track.ground!;
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1 });
    const i = sim.addCar({ cls: 'coupe', human: true });
    sim.placeCar(i, 0, 700, 0, 25);
    // Turned square to the piste, flat out at the wall on its right.
    sim.cars.h[i] += Math.PI / 2;
    sim.cars.vx[i] = Math.sin(sim.cars.h[i]) * 25;
    sim.cars.vz[i] = Math.cos(sim.cars.h[i]) * 25;
    let wrecked = false;
    let furthest = 0;
    for (let t = 0; t < 60 * 20 && !wrecked; t++) {
      const c = neutralControls();
      c.throttle = 1;
      sim.step([c]);
      const gx = Math.round((sim.cars.x[i] - g.x0) / g.cell);
      const gz = Math.round((sim.cars.z[i] - g.z0) / g.cell);
      if (gx >= 0 && gz >= 0 && gx < g.nx && gz < g.nz) furthest = Math.max(furthest, Math.abs(g.lateral[gz * g.nx + gx]));
      wrecked = sim.cars.wreck[i] === 1;
    }
    // Up past where the old line was (wallOut), and out of bounds only at the grid's edge.
    expect(furthest).toBeGreaterThan(l.ground!.wallFrom + (l.ground!.wallOut ?? 25) + 10);
    if (wrecked) {
      expect(sim.cars.wreckCause[i]).toBe(Cause.OutOfBounds);
      const gx = (sim.cars.x[i] - g.x0) / g.cell;
      const gz = (sim.cars.z[i] - g.z0) / g.cell;
      expect(Math.min(gx, gz, g.nx - 1 - gx, g.nz - 1 - gz)).toBeLessThan(3);
    }
  });

  test('is experimental: out of the maps the game, the validator and the lap report run', () => {
    expect(ALL_MAPS.find((m) => m.id === 'avalanche')?.experimental).toBe(true);
    expect(MAPS.some((m) => m.id === 'avalanche')).toBe(false);
    expect(LAYOUT_KEYS).not.toContain('avalanche/slope');
    expect(EXPERIMENTAL_KEYS).toContain('avalanche/slope');
  });

  test('has a ground, groomed snow on the piste, powder off it, a mogul field and a canyon', () => {
    const l = layout('avalanche/slope');
    const track = bakeTrack(l, SURFACES);
    expect(track.ground).toBeDefined();
    expect(l.shoulderSurface).toBe('powder');
    expect(SURFACES[track.main.surface[0]].id).toBe('snow');
    expect(l.ground!.moguls!.length).toBeGreaterThan(0);
    expect(l.ground!.canyons!.length).toBeGreaterThan(0);
  });

  test('the hard AI gets down it clean, in one run', async () => {
    const { lapReport } = await import('../tools/lap');
    // However many laps are asked for, a run is one.
    const r = lapReport('avalanche/slope', layout('avalanche/slope'), 'coupe', { laps: 3 });
    expect(r.finished).toBe(true);
    expect(r.laps.length).toBe(1);
    expect(r.wrecks).toEqual([]);
  });

  test('is one run: the main road open, about 6 km and 1,000 m of drop or more, the grid at the top', () => {
    const l = layout('avalanche/slope');
    const track = bakeTrack(l, SURFACES);
    const m = track.main;
    expect(m.closed).toBe(false);
    expect(m.length).toBeGreaterThan(5500);
    expect(m.py[0] - m.py[m.n - 1]).toBeGreaterThan(1000);
    const run = track.run!;
    expect(run.start).toBeGreaterThan(40);
    // Past the finish, a run-out to stop in.
    expect(m.length - run.finish).toBeGreaterThan(150);
    // The checkpoints between the start and the finish, in order.
    expect(track.checkpoints.every((c, k) => c > run.start && c < run.finish && (k === 0 || c > track.checkpoints[k - 1]))).toBe(true);
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1 });
    for (let k = 0; k < 8; k++) sim.addCar({ cls: 'coupe', human: k === 0 });
    // The whole grid behind the start, on the road.
    for (let k = 0; k < 8; k++) {
      expect(sim.cars.s[k]).toBeLessThan(run.start);
      expect(sim.cars.s[k]).toBeGreaterThan(0);
    }
  });

  test("a kicker's height runs out past the piste's edge: a bump on it, not a ridge across the mountain", () => {
    const l = layout('avalanche/slope');
    const track = bakeTrack(l, SURFACES);
    const g = track.ground!;
    const m = track.main;
    const r = l.ramps![0];
    const k = Math.round((r.s + r.length) / m.step);
    const at = (lat: number) => g.height(m.px[k] - m.tz[k] * lat, m.pz[k] + m.tx[k] * lat);
    const flat = (lat: number) => at(lat) - (m.py[k] - lat * Math.tan(m.bank[k]));
    // At the lip, on the piste, it stands its height (give or take the swells).
    expect(flat(0)).toBeGreaterThan(r.height - 1);
    // 25 m past the piste's edge it's gone.
    const out = m.width[k] / 2 + m.shoulder[k] + 25;
    expect(at(-out) - g.height(m.px[k - 40] - m.tz[k - 40] * -out, m.pz[k - 40] + m.tx[k - 40] * -out)).toBeLessThan(r.height);
  });
});

describe("the Slope's rocks", () => {
  test('a few snow-capped rocks and ridges stand on the piste, solid, on the ground', () => {
    const track = slope();
    const rocks = track.props.filter((p) => p.kind === 'rock');
    expect(rocks.length).toBeGreaterThanOrEqual(5);
    expect(rocks.length).toBeLessThanOrEqual(12);
    for (const r of rocks) {
      expect(r.solid).toBe(true);
      // On the piste, and standing on the ground (not on the road's line under a swell).
      expect(Math.abs(r.lateral)).toBeLessThan(track.main.width[Math.round(r.s / track.main.step)] / 2);
      expect(Math.abs(r.y - track.ground!.height(r.x, r.z))).toBeLessThan(1e-6);
    }
    // At least one ridge: a long one, to go round.
    expect(rocks.some((r) => r.hz > 3 * r.hx)).toBe(true);
  });

  test('driven straight at, a rock wrecks you', () => {
    const track = slope();
    const r = track.props.find((p) => p.kind === 'rock')!;
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1 });
    const i = sim.addCar({ cls: 'coupe', human: true });
    sim.placeCar(i, 0, r.s - 60, r.lateral, 30);
    let wrecked = false;
    for (let t = 0; t < 60 * 5 && !wrecked; t++) {
      const c = neutralControls();
      c.throttle = 1;
      sim.step([c]);
      wrecked = sim.cars.wreck[i] === 1;
    }
    expect(wrecked).toBe(true);
    expect(Math.abs(sim.cars.s[i] - r.s)).toBeLessThan(r.hz + 4);
  });
});

describe("the Slope's gates", () => {
  test('a gate over the start and the finish: a solid post either side, just off the piste', () => {
    const track = slope();
    const posts = track.props.filter((p) => p.kind === 'gate-post');
    expect(posts.length).toBe(4);
    for (const s of [track.run!.start, track.run!.finish]) {
      const pair = posts.filter((p) => p.s === s);
      expect(pair.length).toBe(2);
      const half = track.main.width[Math.round(s / track.main.step)] / 2;
      for (const p of pair) {
        expect(p.solid).toBe(true);
        expect(Math.abs(p.lateral)).toBeGreaterThan(half);
        expect(Math.abs(p.lateral)).toBeLessThan(half + 3);
      }
      expect(Math.sign(pair[0].lateral)).toBe(-Math.sign(pair[1].lateral));
    }
  });
});

describe('the camera on a slope', () => {
  test('it looks down a pitch and up a climb, lifting only uphill, and a little', () => {
    expect(slopeView(-10).look).toBeLessThan(-4);
    expect(slopeView(-10).lift).toBe(0);
    expect(slopeView(6).look).toBeGreaterThan(2);
    expect(slopeView(6).lift).toBeGreaterThan(0);
    expect(slopeView(100).lift).toBeLessThanOrEqual(2.5);
    expect(slopeView(0)).toEqual({ look: 0, lift: 0 });
  });
});

describe("the Slope's slalom gates", () => {
  test('a gate is two flags 10–14 m apart on the piste, clear of the rocks; their flags are smashable', () => {
    const track = slope();
    const gates = track.layout.slalom!;
    expect(gates.length).toBeGreaterThanOrEqual(10);
    for (const g of gates) {
      expect(g.gap).toBeGreaterThanOrEqual(10);
      expect(g.gap).toBeLessThanOrEqual(14);
      expect(Math.abs(g.lateral) + g.gap / 2).toBeLessThan(track.main.width[Math.round(g.s / track.main.step)] / 2);
      for (const r of track.props.filter((p) => p.kind === 'rock')) expect(Math.abs(r.s - g.s)).toBeGreaterThan(30 + r.hz);
    }
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1 });
    const flags = Array.from(sim.world.smash.kind).filter((k) => SMASH_IDS[k].startsWith('gate-'));
    expect(flags.length).toBe(gates.length * 2);
  });

  test('through a gate pays boost and points, more for gates in a row; a missed one ends the streak', () => {
    const track = slope();
    const gates = track.layout.slalom!;
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1 });
    const i = sim.addCar({ cls: 'coupe', human: true });
    const streaks: number[] = [];
    let cursor = sim.events.head;
    /** Drives car i through gate g (or `off` m wide of it). */
    const drive = (g: number, off = 0) => {
      sim.placeCar(i, 0, gates[g].s - 3, gates[g].lateral + off, 25);
      for (let t = 0; t < 20; t++) sim.step([neutralControls()]);
      cursor = sim.events.read(cursor, (e) => {
        if (e.type === Ev.Gate && e.car === i) streaks.push(e.b);
      });
    };
    sim.cars.boost[i] = 0;
    drive(0);
    expect(sim.cars.boost[i]).toBeGreaterThan(0);
    drive(1);
    drive(2, gates[2].gap);
    drive(3);
    expect(streaks).toEqual([1, 2, 1]);
  });

  test('the hard AI takes most of them', () => {
    const sim = new Sim(slope(), CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
    sim.addCar({ cls: 'coupe', racer: { difficulty: 2 } });
    sim.startRace(1, 0.1);
    let gates = 0;
    let cursor = sim.events.head;
    while (!sim.cars.finished[0] && sim.tick < 60 * 200) {
      sim.step([]);
      cursor = sim.events.read(cursor, (e) => {
        if (e.type === Ev.Gate) gates++;
      });
    }
    expect(gates).toBeGreaterThanOrEqual(sim.track.layout.slalom!.length * 0.7);
  });
});

describe("the Slope's pines", () => {
  test('hundreds of solid pines off the piste: none near its edge, in a canyon or its mouth, or in the moguls', () => {
    const track = slope();
    const p = track.pines!;
    const g = track.layout.ground!;
    // Sparse: the slopes stay open to drive up.
    expect(p.n).toBeGreaterThan(300);
    expect(p.n).toBeLessThan(1500);
    // The same forest every time (every screen builds its own).
    expect(Array.from(buildPines(g.pines!, track.layout, track.main, track.ground!).x)).toEqual(Array.from(p.x));
    const main = track.main;
    for (let k = 0; k < p.n; k += 7) {
      const at = sampleAt(main, 0, newHit());
      projectGlobal(main, p.x[k], p.z[k], at);
      const edge = at.width / 2 + main.shoulder[Math.round(at.s / main.step)];
      expect(Math.abs(at.lateral) - edge).toBeGreaterThan(g.pines!.clear - 3);
      expect(canyonAt(g, at.s, at.lateral)).toBeLessThan(0.5);
      expect(Math.abs(p.y[k] - track.ground!.height(p.x[k], p.z[k]))).toBeLessThan(1e-3);
    }
  });

  test('driven into, a pine wrecks you', () => {
    const track = slope();
    const p = track.pines!;
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1 });
    const i = sim.addCar({ cls: 'coupe', human: true });
    // A tree on fairly level ground well down the run, with nothing else in the way, the car 12 m off, aimed at it.
    const tilt = { x: 0, z: 0 };
    const hit = newHit();
    const clear = (k: number) => {
      let others = 0;
      p.near(p.x[k] - 6, p.z[k], (j) => {
        if (j !== k && p.x[j] < p.x[k] && p.x[j] > p.x[k] - 14 && Math.abs(p.z[j] - p.z[k]) < 4) others++;
      });
      return others === 0;
    };
    let k = 0;
    while (track.ground!.slope(p.x[k], p.z[k], tilt) && (Math.hypot(tilt.x, tilt.z) > 0.15 || projectGlobal(track.main, p.x[k], p.z[k], hit) < 0 || hit.s < 500 || !clear(k))) k++;
    sim.placeCar(i, 0, hit.s, 0, 0);
    sim.cars.x[i] = p.x[k] - 12;
    sim.cars.z[i] = p.z[k];
    sim.cars.y[i] = track.ground!.height(p.x[k] - 12, p.z[k]) + 0.5;
    sim.cars.h[i] = Math.PI / 2;
    sim.cars.vx[i] = 35;
    sim.cars.vz[i] = 0;
    let wrecked = false;
    for (let t = 0; t < 90 && !wrecked; t++) {
      sim.step([neutralControls()]);
      wrecked = sim.cars.wreck[i] === 1 && sim.cars.wreckCause[i] === Cause.Prop;
    }
    expect(wrecked).toBe(true);
  });
});

describe("the Slope's ski jump", () => {
  test('a straight, level in-run, a lip, and a landing hill that falls away below it', () => {
    const track = slope();
    const { lip, landing } = track.layout.skiJump!;
    const m = track.main;
    const grade = (s: number) => (m.py[Math.round((s - 4) / m.step)] - m.py[Math.round((s + 4) / m.step)]) / 8;
    expect(Math.abs(grade(lip - 12))).toBeLessThan(0.1);
    expect(grade(lip + 40)).toBeGreaterThan(0.4);
    expect(landing).toBeGreaterThan(200);
    for (let s = lip - 40; s < lip + 60; s += 10) expect(Math.abs(m.bank[Math.round(s / m.step)])).toBeLessThan(0.02);
    expect(track.props.some((p) => p.kind === 'jump-tower' && p.solid)).toBe(true);
  });

  test('every class flies it, long and clean, and lands on the hill', () => {
    const track = slope();
    const { lip, landing } = track.layout.skiJump!;
    for (const cls of ['coupe', 'bus']) {
      const sim = new Sim(track, CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off' });
      sim.addCar({ cls, racer: { difficulty: 2 } });
      sim.startRace(1, 0.1);
      let flight = 0;
      let landed = 0;
      let wrecks = 0;
      let cursor = sim.events.head;
      while (!sim.cars.finished[0] && sim.tick < 60 * 200) {
        sim.step([]);
        cursor = sim.events.read(cursor, (e) => {
          if (e.type === Ev.Land && sim.cars.s[0] > lip && sim.cars.s[0] < lip + landing && e.a > flight) {
            flight = e.a;
            landed = sim.cars.s[0];
          }
          if (e.type === Ev.Wreck) wrecks++;
        });
      }
      expect(flight).toBeGreaterThan(1.5);
      expect(landed - lip).toBeGreaterThan(80);
      expect(wrecks).toBe(0);
    }
  });
});

describe("the Slope's avalanche", () => {
  const race = (mayhem: 'normal' | 'chaos') => {
    const sim = new Sim(slope(), CLASSES, SURFACES, { seed: 1, mayhem });
    const i = sim.addCar({ cls: 'coupe', human: true });
    sim.startRace(1, 0.1);
    return { sim, i };
  };
  /** Steps `sim` `seconds` with car `i` standing still (no throttle). */
  const wait = (sim: Sim, seconds: number) => {
    for (let t = 0; t < seconds * 60; t++) sim.step([neutralControls()]);
  };

  test('comes only at chaos, after the green light, down the run, faster on a pitch than on a flat', () => {
    expect(race('normal').sim.avalanche).toBeNull();
    const { sim } = race('chaos');
    const av = sim.avalanche!;
    expect(av.front(0)).toBe(-Infinity);
    let last = -Infinity;
    for (let u = av.delay; u < av.delay + 200; u += 1) {
      const f = av.front(u);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
    // It runs out short of the finish.
    expect(last).toBeLessThan(sim.track.run!.finish);
    // Steeper is faster.
    expect(avalancheSpeed(56, 0.7)).toBeGreaterThan(avalancheSpeed(56, 0.05));
  });

  test('buries a car standing on the piste, and it respawns ahead of it', () => {
    const { sim, i } = race('chaos');
    let buried = false;
    let cursor = sim.events.head;
    for (let t = 0; t < 60 * 20 && !buried; t++) {
      sim.step([neutralControls()]);
      cursor = sim.events.read(cursor, (e) => {
        if (e.type === Ev.Wreck && e.car === i && e.b === Cause.Hazard) buried = true;
      });
    }
    expect(buried).toBe(true);
    wait(sim, 4);
    expect(sim.cars.wreck[i]).toBe(0);
    expect(sim.cars.s[i]).toBeGreaterThan(sim.avalancheFront);
  });

  test("a car down in a canyon is under it, and isn't buried", () => {
    const { sim, i } = race('chaos');
    const track = sim.track;
    const canyon = track.layout.ground!.canyons![0];
    const s = (canyon.s[0] + canyon.s[1]) / 2;
    // Hold the car on the canyon's floor while the avalanche goes over.
    const k = Math.round(s / track.main.step);
    const x = track.main.px[k] - track.main.tz[k] * canyon.lateral;
    const z = track.main.pz[k] + track.main.tx[k] * canyon.lateral;
    const av = sim.avalanche!;
    let u = av.delay;
    while (av.front(u) < s + 50) u += 0.5;
    let wrecked = false;
    for (let t = 0; t < u * 60; t++) {
      sim.placeCar(i, 0, s, canyon.lateral, 0);
      sim.cars.x[i] = x;
      sim.cars.z[i] = z;
      sim.cars.y[i] = track.ground!.height(x, z) + 0.5;
      sim.step([neutralControls()]);
      if (sim.cars.wreck[i] && sim.cars.wreckCause[i] === Cause.Hazard) wrecked = true;
    }
    expect(sim.avalancheFront).toBeGreaterThan(s);
    expect(wrecked).toBe(false);
  });
});

describe('one run (layout.run)', () => {
  /** A straight run down a 10% grade: 1,400 m, the start at 60, the finish 200 m from the end. */
  const straight = (): TrackLayout => ({
    id: 'run',
    name: 'Run',
    main: { points: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({ p: [0, -k * 20, k * 200] as [number, number, number], width: 30, surface: 'snow' })) },
    ground: { cell: 2, wallFrom: 60, wallRise: 0.8 },
    shoulderSurface: 'powder',
    run: { start: 60, finish: 1200 },
  });

  test('a race is one run: crossing the finish, past the checkpoints, finishes it', () => {
    const track = bakeTrack(straight(), SURFACES);
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1 });
    const i = sim.addCar({ cls: 'coupe', human: true });
    sim.startRace(3, 0);
    expect(sim.race.laps).toBe(1);
    let t = 0;
    for (; t < 60 * 120 && !sim.cars.finished[i]; t++) {
      const c = neutralControls();
      c.throttle = 1;
      sim.step([c]);
    }
    expect(sim.cars.finished[i]).toBe(1);
    expect(sim.cars.nextCp[i]).toBe(track.checkpoints.length);
    expect(sim.cars.s[i]).toBeGreaterThan(1200);
    expect(sim.cars.s[i]).toBeLessThan(1250);
  });

  test('in free drive, a few seconds past the finish you start again at the top, your best run kept', () => {
    const track = bakeTrack(straight(), SURFACES);
    const sim = new Sim(track, CLASSES, SURFACES, { seed: 1 });
    const i = sim.addCar({ cls: 'coupe', human: true });
    sim.placeCar(i, 0, 1150, 0, 30);
    // As if it had come down the run: every checkpoint passed.
    sim.cars.nextCp[i] = track.checkpoints.length;
    sim.cars.progress[i] = 1150 - 60;
    let back = false;
    for (let t = 0; t < 60 * 10 && !back; t++) {
      sim.step([neutralControls()]);
      back = sim.cars.s[i] < 100;
    }
    expect(back).toBe(true);
    expect(sim.cars.lap[i]).toBe(0);
    expect(sim.cars.bestLap[i]).toBeGreaterThan(0);
  });
});
