import { describe, expect, test } from 'bun:test';
import { neutralControls } from '../src/core/controls';
import type { Sim } from '../src/core/sim';
import { createLobby, apply, encodeSeats, othersIn, roster, type Lobby } from '../src/lobby/lobby';
import { NetCars, predict, remoteSteer } from '../src/net/cars';
import { CLOCK_SNAP, startDelay, syncClock } from '../src/net/clock';
import { HOLD_S, NetTraffic, readHit, RELEASE_S, TRAFFIC_HIT } from '../src/net/traffic';
import { NetBreakables, NEWS_S, WALL_BREAK } from '../src/net/breakables';
import { Breakables } from '../src/core/world/breakables';
import { BUMP, carNames, NetContact, TAKEDOWN } from '../src/net/contact';
import { MAX_CLOSING, readBump, readHandover, readRunEnd, readTakedown, readTarget } from '../src/net/wire';
import { Ev } from '../src/core/events';
import { NetRivals } from '../src/net/rivals';
import { FALLBACK_MS, joinRace, type RaceJoin } from '../src/net/join';
import { MAX_STEPS, Stepper, type Tick } from '../src/net/stepper';
import { wreckCar } from '../src/core/car/physics';
import { Cause } from '../src/core/events';
import { raceFromLobby, readSetup, toQuery } from '../src/ui/setup';
import { CLASSES, SURFACES, citySim, layout, ringSim } from './helpers';
import { Hub } from './hub';
import { Getaway } from '../src/core/rules/getaway';
import { Sim as SimClass } from '../src/core/sim';
import { bakeTrack } from '../src/core/track/bake';

// Remote cars (milestone 3): each player owns their car and sends it as an entity; everyone else
// has it as a remote car in their sim, put where the entity says (predicted to now) before each
// step. These run two sims through a stand-in for the SDK's entities.

/** Two players on a wide ring: ada in seat 0, bo in seat 1, each with the other as a remote car. */
function twoPlayers() {
  const hub = new Hub();
  const make = (meSeat: 0 | 1) => {
    const sim = ringSim(1);
    const ids = ['ada', 'bo'];
    sim.addCar(meSeat === 0 ? { cls: 'coupe', human: true } : { cls: 'coupe', remote: true });
    sim.addCar(meSeat === 1 ? { cls: 'coupe', human: true } : { cls: 'coupe', remote: true });
    sim.startRace(1, 0.1);
    const other = 1 - meSeat;
    const net = new NetCars(hub.room(ids[meSeat]), () => hub.now, sim, meSeat, new Map([[ids[other], other]]));
    return { sim, net, me: meSeat };
  };
  return { hub, ada: make(0), bo: make(1) };
}

function step(p: { sim: Sim; net: NetCars; me: number }, controls = neutralControls()) {
  const input: ReturnType<typeof neutralControls>[] = [];
  input[p.me] = controls;
  p.net.beforeStep();
  p.sim.step(input);
  p.net.afterStep();
}

describe('remote cars', () => {
  test("each player's car is where its owner put it, on everyone else's screen", () => {
    const { ada, bo } = twoPlayers();
    for (let k = 0; k < 180; k++) {
      step(ada, { ...neutralControls(), throttle: 1 });
      step(bo);
    }
    expect(Math.hypot(ada.sim.cars.vx[0], ada.sim.cars.vz[0])).toBeGreaterThan(10);
    // Bo's copy of Ada's car (with no render delay here, the pose as sent: a step behind at most).
    const gap = Math.hypot(bo.sim.cars.x[0] - ada.sim.cars.x[0], bo.sim.cars.z[0] - ada.sim.cars.z[0]);
    expect(gap).toBeLessThan(Math.hypot(ada.sim.cars.vx[0], ada.sim.cars.vz[0]) / 60 + 0.05);
    expect(bo.sim.cars.remote[0]).toBe(1);
    // Bo's sim never drives it: on Ada's screen alone it moves.
    expect(bo.sim.cars.progress[0]).toBeGreaterThan(bo.sim.cars.progress[1]);
  });

  test('shown ~100 ms in the past, a remote car is predicted forward to now from its velocity and yaw rate', () => {
    const e = { x: 10, y: 1, z: 0, h: 0, vx: 50, vy: 0, vz: 0, yaw: 0.5, wreck: false };
    const p = predict(e, 0.1);
    expect(p.x).toBeCloseTo(15);
    expect(p.h).toBeCloseTo(0.05);
    // A wreck isn't driving anywhere: it stays where it was said to be.
    expect(predict({ ...e, wreck: true }, 0.1).x).toBe(10);

    const { hub, ada, bo } = twoPlayers();
    for (let k = 0; k < 120; k++) step(ada, { ...neutralControls(), throttle: 1 });
    hub.now = 100;
    hub.renderTime = 0;
    step(bo);
    const v = Math.hypot(ada.sim.cars.vx[0], ada.sim.cars.vz[0]);
    const ahead = Math.hypot(bo.sim.cars.x[0] - ada.sim.cars.x[0], bo.sim.cars.z[0] - ada.sim.cars.z[0]);
    expect(ahead).toBeCloseTo(v * 0.1, 0);
  });

  test("your sim bumps your car off theirs, but doesn't move theirs for good or wreck it: the victim decides", () => {
    const { ada, bo } = twoPlayers();
    // Bo sits still; on Ada's screen, Ada's car hits Bo's square at speed.
    const a = ada.sim;
    a.placeCar(0, 0, 40, 0, 0);
    bo.sim.placeCar(1, 0, 60, 0, 0);
    step(bo);
    a.placeCar(0, 0, 50, 0, 40);
    const boAt = [bo.sim.cars.x[1], bo.sim.cars.z[1]];
    for (let k = 0; k < 40; k++) {
      step(ada, { ...neutralControls(), throttle: 1 });
      step(bo);
    }
    expect(a.cars.wreck[1]).toBe(0);
    // Ada's car came off worse than a free run would (it hit something).
    expect(Math.hypot(a.cars.vx[0], a.cars.vz[0])).toBeLessThan(40);
    // ...and Bo's car is where Bo says, on Ada's screen too. (Bo's own sim bumped it, off Ada's.)
    step(ada);
    expect(Math.hypot(a.cars.x[1] - bo.sim.cars.x[1], a.cars.z[1] - bo.sim.cars.z[1])).toBeLessThan(0.05);
    expect(Math.hypot(bo.sim.cars.x[1] - boAt[0], bo.sim.cars.z[1] - boAt[1])).toBeGreaterThan(0.1);
  });

  test("a car whose player left goes from the race, and one that hasn't shown up isn't in it (no car parked on the grid)", () => {
    const { hub, ada, bo } = twoPlayers();
    // Bo's page hasn't connected yet.
    const boCar = hub.entities.find((e) => e.kind === 'car' && e.owner === 'bo')!;
    boCar.removed = true;
    step(ada);
    expect(ada.sim.cars.active[1]).toBe(0);
    boCar.removed = false;
    step(bo);
    step(ada);
    expect(ada.sim.cars.active[1]).toBe(1);
    hub.entities.find((e) => e.kind === 'car' && e.owner === 'bo')!.removed = true;
    step(ada);
    expect(ada.sim.cars.active[1]).toBe(0);
  });

  test("a car ghosted on its own screen (just respawned) is ghosted on yours: you pass through it", () => {
    const { ada, bo } = twoPlayers();
    step(bo);
    bo.sim.cars.ghostT[1] = 1.5;
    step(bo);
    step(ada);
    expect(ada.sim.cars.ghostT[1]).toBeGreaterThan(0);
    bo.sim.cars.ghostT[1] = 0;
    step(bo);
    step(ada);
    expect(ada.sim.cars.ghostT[1]).toBe(0);
  });

  test('a reset is a teleport (everyone snaps), and the lights go green on the server clock, whatever the sim clock says', () => {
    const { hub, ada } = twoPlayers();
    step(ada);
    ada.sim.placeCar(0, 0, 400, 0, 0);
    step(ada);
    expect(hub.entities.find((e) => e.kind === 'car' && e.owner === 'ada')!.teleports).toBe(1);

    expect(startDelay(10_000, 4_000)).toBe(6);
    expect(startDelay(10_000, 12_000)).toBe(0);
    expect(startDelay(1e12, 0)).toBe(30);
    const sim = ringSim(1);
    sim.addCar({ cls: 'coupe', human: true });
    sim.startRace(1, 30);
    hub.now = 5_000;
    const net = new NetCars(hub.room('cy'), () => hub.now, sim, 0, new Map(), 6_000);
    net.beforeStep();
    expect(sim.race.goTime - sim.time).toBeCloseTo(1);
    // The tab was in the background: the sim didn't step, but the server's clock went on.
    hub.now = 7_000;
    net.beforeStep();
    sim.step([neutralControls()]);
    expect(sim.race.phase).toBe('racing');
  });
});

/** Ada and Bo, with a hard AI in seat 2 on both screens: the host's to drive. */
function withRival() {
  const hub = new Hub();
  const make = (meSeat: 0 | 1) => {
    const sim = ringSim(1);
    const ids = ['ada', 'bo'];
    sim.addCar(meSeat === 0 ? { cls: 'coupe', human: true } : { cls: 'coupe', human: true, remote: true });
    sim.addCar(meSeat === 1 ? { cls: 'coupe', human: true } : { cls: 'coupe', human: true, remote: true });
    sim.addCar({ cls: 'coupe', racer: { difficulty: 2 } });
    sim.startRace(1, 0.1);
    const other = 1 - meSeat;
    const room = hub.room(ids[meSeat]);
    const net = new NetCars(room, () => hub.now, sim, meSeat, new Map([[ids[other], other]]));
    const rivals = new NetRivals(room, () => hub.now, sim, new Map([[2, 2]]), 'r1');
    return { sim, net, rivals, me: meSeat };
  };
  return { hub, ada: make(0), bo: make(1) };
}

function stepAll(p: ReturnType<typeof withRival>['ada']) {
  const input: ReturnType<typeof neutralControls>[] = [];
  input[p.me] = neutralControls();
  p.net.beforeStep();
  p.rivals.beforeStep();
  p.sim.step(input);
  p.net.afterStep();
  p.rivals.afterStep();
}

const rivalsIn = (hub: Hub) => hub.entities.filter((e) => e.kind === 'rival' && !e.removed);
const gap = (a: Sim, b: Sim, i: number) => Math.hypot(a.cars.x[i] - b.cars.x[i], a.cars.z[i] - b.cars.z[i]);

describe('rivals', () => {
  test("the host drives the AIs, and every other screen has them where the host's sim puts them", () => {
    const { hub, ada, bo } = withRival();
    for (let k = 0; k < 240; k++) {
      stepAll(ada);
      stepAll(bo);
    }
    expect(ada.sim.cars.progress[2]).toBeGreaterThan(50);
    expect(rivalsIn(hub)).toHaveLength(1);
    expect(rivalsIn(hub)[0]).toMatchObject({ owner: 'host', fields: { seat: 2 } });
    expect(ada.sim.cars.remote[2]).toBe(0);
    expect(bo.sim.cars.remote[2]).toBe(1);
    // Bo's copy is Ada's car, a step behind at most.
    const v = Math.hypot(ada.sim.cars.vx[2], ada.sim.cars.vz[2]);
    expect(gap(ada.sim, bo.sim, 2)).toBeLessThan(v / 60 + 0.05);
  });

  test("until the host's rivals show up, every screen drives them itself, from the same grid", () => {
    const { hub, ada, bo } = withRival();
    hub.host = 'nobody';
    for (let k = 0; k < 120; k++) {
      stepAll(ada);
      stepAll(bo);
    }
    expect(rivalsIn(hub)).toHaveLength(0);
    expect(ada.sim.cars.remote[2]).toBe(0);
    expect(bo.sim.cars.remote[2]).toBe(0);
    expect(bo.sim.cars.progress[2]).toBeGreaterThan(10);
    // The same driver from the same place, with the players parked: the same car.
    expect(gap(ada.sim, bo.sim, 2)).toBeLessThan(0.5);
  });

  test('when the host role moves, the next host drives them on from where they are: no new rivals, no jump', () => {
    const { hub, ada, bo } = withRival();
    for (let k = 0; k < 240; k++) {
      stepAll(ada);
      stepAll(bo);
    }
    const id = rivalsIn(hub)[0];
    const before = { x: bo.sim.cars.x[2], z: bo.sim.cars.z[2], p: bo.sim.cars.progress[2] };
    hub.host = 'bo';
    stepAll(bo);
    stepAll(ada);
    expect(bo.sim.cars.remote[2]).toBe(0);
    expect(ada.sim.cars.remote[2]).toBe(1);
    expect(Math.hypot(bo.sim.cars.x[2] - before.x, bo.sim.cars.z[2] - before.z)).toBeLessThan(2);
    for (let k = 0; k < 120; k++) {
      stepAll(bo);
      stepAll(ada);
    }
    expect(rivalsIn(hub)).toEqual([id]);
    expect(id.teleports).toBe(0);
    expect(bo.sim.cars.progress[2]).toBeGreaterThan(before.p + 20);
    expect(gap(ada.sim, bo.sim, 2)).toBeLessThan(Math.hypot(bo.sim.cars.vx[2], bo.sim.cars.vz[2]) / 60 + 0.05);
  });

  test("a rival wrecked when the role moves carries on its wreck, and respawns where it was, not on the grid", () => {
    const { hub, ada, bo } = withRival();
    for (let k = 0; k < 240; k++) {
      stepAll(ada);
      stepAll(bo);
    }
    wreckCar(ada.sim, 2, Cause.Wall, 0, 0, -1);
    for (let k = 0; k < 30; k++) {
      stepAll(ada);
      stepAll(bo);
    }
    const spot = ada.sim.cars.lastS[2];
    expect(spot).toBeGreaterThan(50);
    expect(bo.sim.cars.wreckT[2]).toBeCloseTo(ada.sim.cars.wreckT[2], 1);
    expect(bo.sim.cars.lastS[2]).toBeCloseTo(spot, 1);
    hub.host = 'bo';
    // On through the respawn: back on the road by its last spot, nowhere near the grid.
    for (let k = 0; k < 360; k++) {
      stepAll(bo);
      stepAll(ada);
    }
    expect(bo.sim.cars.wreck[2]).toBe(0);
    expect(bo.sim.cars.progress[2]).toBeGreaterThan(spot - 20);
  });

  test("the last race's rivals are left alone (each screen drives its own until this race's show up), and the host removes them", () => {
    const { hub, ada, bo } = withRival();
    const old = { kind: 'rival', owner: 'host', fields: { seat: 2, race: 'r0', x: 500, z: 500 }, teleports: 0, removed: false };
    hub.entities.push(old);
    stepAll(bo);
    expect(bo.sim.cars.remote[2]).toBe(0);
    stepAll(ada);
    expect(old.removed).toBe(true);
    expect(rivalsIn(hub)).toHaveLength(1);
  });

  test("the role coming back isn't a teleport for every rival", () => {
    const { hub, ada, bo } = withRival();
    for (let k = 0; k < 120; k++) {
      stepAll(ada);
      stepAll(bo);
    }
    hub.host = 'bo';
    for (let k = 0; k < 240; k++) {
      stepAll(bo);
      stepAll(ada);
    }
    hub.host = 'ada';
    stepAll(ada);
    expect(rivalsIn(hub)[0].teleports).toBe(0);
  });

  test("a rival only the host role owns is driven by it, and its handover is range-checked", () => {
    const { hub, ada, bo } = withRival();
    for (let k = 0; k < 120; k++) {
      stepAll(ada);
      stepAll(bo);
    }
    // A third page spawns a rival of its own for seat 2, far away: Bo's screen doesn't follow it.
    hub.entities.unshift({ kind: 'rival', owner: 'cy', fields: { seat: 2, race: 'r1', x: 900, z: 900 }, teleports: 0, removed: false });
    stepAll(bo);
    stepAll(ada);
    stepAll(bo);
    expect(Math.abs(bo.sim.cars.x[2])).toBeLessThan(100);
    // The host's own rival with a spline that isn't one and a cause that isn't one: not copied.
    const real = rivalsIn(hub).find((e) => e.owner === 'host')!;
    real.fields.lastSpline = 999;
    real.fields.wreckCause = 42;
    real.fields.vx = 1e6;
    stepAll(bo);
    expect(bo.sim.cars.lastSpline[2]).toBeLessThan(bo.sim.track.splines.length);
    expect(bo.sim.cars.wreckCause[2]).not.toBe(42);
    expect(Math.hypot(bo.sim.cars.vx[2], bo.sim.cars.vz[2])).toBeLessThanOrEqual(140 + 1e-9);
    // And taking the role then, and respawning, doesn't throw.
    hub.host = 'bo';
    wreckCar(bo.sim, 2, Cause.Wall, 0, 0, -1);
    expect(() => {
      for (let k = 0; k < 360; k++) stepAll(bo);
    }).not.toThrow();
  });

  test("another page's car can't be flung at you: its speed, turn and steering are capped", () => {
    const p = predict({ x: 0, z: 0, vx: 1e6, vz: 0, yaw: 1e3, steer: 9 }, 0.1);
    expect(Math.hypot(p.vx, p.vz)).toBeCloseTo(140);
    expect(p.x).toBeCloseTo(14);
    expect(p.yaw).toBe(12);
    expect(remoteSteer({ steer: 9 })).toBe(1);
    expect(remoteSteer({ steer: 'left' })).toBe(0);
    expect(predict({ x: NaN, vx: Infinity }, 0.1)).toMatchObject({ x: 0, vx: 0 });
  });

  test('two hosts at once (for a moment) leave one rival per seat', () => {
    const { hub, ada } = withRival();
    hub.entities.push({ kind: 'rival', owner: 'host', fields: { seat: 2, race: 'r1' }, teleports: 0, removed: false });
    hub.entities.push({ kind: 'rival', owner: 'host', fields: { seat: 2, race: 'r1' }, teleports: 0, removed: false });
    stepAll(ada);
    expect(rivalsIn(hub)).toHaveLength(1);
  });
});

describe('an online race link', () => {
  const ids = CLASSES.map((c) => c.id);
  function lobby(): Lobby {
    let l = createLobby('K7QM', { id: 'ada', name: 'ADA', car: 'coupe', paint: 1 });
    l = apply(l, 'bo', { type: 'join', player: { id: 'bo', name: 'BO', car: 'muscle', paint: 3 } })!;
    l = apply(l, 'bo', { type: 'ready', ready: true })!;
    return apply(l, 'ada', { type: 'start', seed: 7, at: 123_456 })!;
  }

  test("another player's seat is `r`, with their car and plate in the link, and the lights' time", () => {
    const l = lobby();
    expect(encodeSeats(l, 'ada', true)).toBe('proooooo');
    expect(encodeSeats(l, 'ada')).toBe('pxoooooo');
    expect(othersIn(l, 'ada')).toEqual([{ seat: 1, id: 'bo', car: 'muscle', paint: 3, name: 'BO' }]);
    const setup = raceFromLobby(l, 'ada', l.seed!, true);
    const back = readSetup(new URLSearchParams(toQuery(setup)), 'downtown/downtown', { cars: ids, paints: 8 });
    expect(back).toMatchObject({ seats: 'proooooo', seed: 7, at: 123_456, others: [{ seat: 1, id: 'bo', car: 'muscle', paint: 3, name: 'BO' }] });
  });

  test("the roster makes their seat a remote car in their car and paint, named by their plate, in its grid slot", () => {
    const l = lobby();
    const r = roster(encodeSeats(l, 'ada', true), ids, 8, { car: 'coupe', paint: 1, plate: 'ADA' }, othersIn(l, 'ada'));
    expect(r.specs[1]).toEqual({ cls: 'muscle', paint: 3, human: true, remote: true });
    expect(r.names[1]).toBe('BO');
    expect(r.remote.get('bo')).toBe(1);
    // Bo's view: Ada is the remote one, in seat 0.
    const b = roster(encodeSeats(l, 'bo', true), ids, 8, { car: 'muscle', paint: 3, plate: 'BO' }, othersIn(l, 'bo'));
    expect(b.me).toBe(1);
    expect(b.remote.get('ada')).toBe(0);
  });

  test("the AIs are the same rivals on every screen (seat, car, paint and plate), whoever's paint you race in", () => {
    const l = lobby();
    const a = roster(encodeSeats(l, 'ada', true), ids, 8, { car: 'coupe', paint: 1, plate: 'ADA' }, othersIn(l, 'ada'));
    const b = roster(encodeSeats(l, 'bo', true), ids, 8, { car: 'muscle', paint: 3, plate: 'BO' }, othersIn(l, 'bo'));
    expect([...a.rivals.keys()]).toEqual([2, 3, 4, 5, 6, 7]);
    expect([...b.rivals]).toEqual([...a.rivals]);
    for (const [, i] of a.rivals) {
      expect(b.specs[i]).toEqual(a.specs[i]);
      expect(b.names[i]).toBe(a.names[i]);
    }
    // Alone (no other players), they're in your paint plus their seat, as offline.
    const solo = roster('poxxxxxx', ids, 8, { car: 'coupe', paint: 5 });
    expect(solo.specs[1].paint).toBe(6);
  });

  test('a link with a bad `others` is a race without them', () => {
    const q = new URLSearchParams({ mode: 'race', seats: 'proooooo', others: '[[9,"x","y",1,"Z"],"junk"]' });
    expect(readSetup(q, 'downtown/downtown')?.others).toBeUndefined();
    const r = roster('proooooo', ids, 8, { car: 'coupe', paint: 0 });
    expect(r.specs).toHaveLength(7);
  });
});

describe("the race page's join", () => {
  /** A race page's join with its timer in hand: `fire()` runs the fallback. */
  function page(opts: { lobby?: unknown; room?: boolean; at?: number; slow?: Promise<void>; tick?: Tick } = {}) {
    const hub = new Hub();
    const sim = ringSim(1);
    sim.addCar({ cls: 'coupe', human: true });
    sim.addCar({ cls: 'coupe', racer: { difficulty: 1 } });
    sim.startRace(1, 30);
    let pending: (() => void) | null = null;
    const got: { net: unknown; rivals: unknown; tick: Tick | null; traffic: unknown } = { net: null, rivals: null, tick: null, traffic: null };
    const j: RaceJoin = {
      lobby: async () => (await opts.slow, opts.lobby === undefined ? { id: 'K7QM' } : opts.lobby),
      connection: async () => ({ room: opts.room === false ? null : hub.room('ada'), now: () => hub.now, tick: opts.tick }),
      sim,
      me: 0,
      remote: new Map(),
      aiSeats: new Map([[1, 1]]),
      seed: 7,
      at: opts.at,
      onNet: (l) => Object.assign(got, { net: l.cars, rivals: l.rivals, tick: l.tick, traffic: l.traffic }),
      timers: { set: (f) => ((pending = f), 1), clear: () => (pending = null) },
    };
    return { hub, sim, j, got, fire: () => pending?.(), armed: () => pending !== null };
  }

  test('in: your car and the AIs go out, the fallback is called off, and green is 3 s on (no time in the link)', async () => {
    const p = page();
    expect(await joinRace(p.j)).toBe(true);
    expect(p.got.net).not.toBeNull();
    expect(p.got.rivals).not.toBeNull();
    expect(p.hub.entities.filter((e) => e.kind === 'car')).toHaveLength(1);
    expect(p.armed()).toBe(false);
    expect(p.sim.race.goTime - p.sim.time).toBeCloseTo(3);
    // No time in the link: its race isn't on the server's clock, so no traffic hits or contact to share.
    expect(p.got.traffic).toBeNull();
  });

  test('the lobby gone, or no room: no net layers, and the fallback starts the race 3 s on', async () => {
    for (const p of [page({ lobby: null }), page({ room: false })]) {
      expect(await joinRace(p.j)).toBe(false);
      expect(p.got.net).toBeNull();
      expect(p.armed()).toBe(true);
      p.fire();
      expect(p.sim.race.goTime - p.sim.time).toBeCloseTo(3);
    }
  });

  test("slower than the fallback: the race has started from here, and the late join doesn't move green", async () => {
    let land!: () => void;
    const p = page({ slow: new Promise<void>((r) => (land = r)) });
    const joining = joinRace(p.j);
    p.fire();
    const go = p.sim.race.goTime;
    for (let k = 0; k < 4 * 60; k++) p.sim.step([neutralControls()]);
    expect(p.sim.race.phase).toBe('racing');
    land();
    expect(await joining).toBe(true);
    expect(p.got.net).not.toBeNull();
    expect(p.sim.race.goTime).toBe(go);
    // Started on its own clock: none either, even with the link's time.
    const q = page({ at: 5_000, slow: new Promise<void>((r) => (land = r)) });
    const late = joinRace(q.j);
    q.fire();
    land();
    await late;
    expect(q.got.net).not.toBeNull();
    expect(q.got.traffic).toBeNull();
  });

  test("with the link's time, green is the server clock's (not 3 s on); without AIs, no rivals", async () => {
    const p = page({ at: 5_000 });
    p.j.aiSeats = new Map();
    p.hub.now = 1_000;
    await joinRace(p.j);
    expect(p.got.rivals).toBeNull();
    expect(p.got.traffic).not.toBeNull();
    expect(p.sim.race.goTime - p.sim.time).toBeGreaterThan(20);
    (p.got.net as NetCars).beforeStep();
    expect(p.sim.race.goTime - p.sim.time).toBeCloseTo(4);
    expect(FALLBACK_MS).toBe(8000);
  });
  test("joined, the page gets the connection's tick to step the race on (null when it has none)", async () => {
    const t = fakeTick();
    const p = page({ tick: t.tick });
    await joinRace(p.j);
    expect(p.got.tick).not.toBeNull();
    let fired = 0;
    const stop = p.got.tick!(60, () => fired++);
    t.run(3);
    expect(t.rate()).toBe(60);
    expect(fired).toBe(3);
    stop();
    expect(t.running()).toBe(false);
    const q = page();
    await joinRace(q.j);
    expect(q.got.net).not.toBeNull();
    expect(q.got.tick).toBeNull();
  });
});

/** A fake `relay.tick`: `run(n)` fires its loop n times, as the worker timer would in a hidden tab. */
function fakeTick() {
  let loop: ((dt: number, tick: number) => void) | null = null;
  let rate = 0;
  const tick: Tick = (r, fn) => ((rate = r), (loop = fn), () => (loop = null));
  return { tick, rate: () => rate, running: () => loop !== null, run: (n: number) => { for (let k = 0; k < n; k++) loop?.(1 / rate, k + 1); } };
}

describe('the race on the relay\'s tick', () => {
  test('on frames: a frame steps the time it covers, at most MAX_STEPS, and says how far into the next step it is', () => {
    let steps = 0;
    const s = new Stepper(60, () => steps++);
    expect(s.frame(2.5 / 60, true)).toBeCloseTo(0.5);
    expect(steps).toBe(2);
    // Not stepping (paused, the editor): no steps, and where it was.
    expect(s.frame(1, false)).toBeCloseTo(0.5);
    expect(steps).toBe(2);
    // A stall: five steps, and the rest dropped.
    expect(s.frame(1, true)).toBe(0);
    expect(steps).toBe(2 + MAX_STEPS);
  });

  test("on the tick: drawn from when each step was due, not when the timer woke", () => {
    // The SDK's ticker: a timer that wakes about every 16 ms, late by up to 6 ms, and runs the
    // steps that are due (0, 1 or 2), numbering them; frames at 120 Hz in between.
    let clock = 1000;
    let truth: number | null = null;
    const s = new Stepper(60, () => {}, () => clock);
    const h = 1000 / 60;
    let fn: ((dt: number, tick: number) => void) | null = null;
    s.useTick((_r, f) => ((fn = f), () => {}), () => true);
    const start = clock;
    let k = 0;
    let rand = 7;
    const jitter = () => ((rand = (rand * 16807) % 2147483647) / 2147483647) * 6;
    let worst = 0;
    for (let wake = 1; wake <= 600; wake++) {
      const at = start + wake * 16 + jitter();
      // Frames until the wake.
      for (let f = clock + 1000 / 120; f < at; f += 1000 / 120) {
        clock = f;
        const alpha = s.frame(1 / 120, true);
        if (truth !== null && wake > 30) {
          const want = Math.min(1, (clock - truth) / h);
          worst = Math.max(worst, Math.abs(alpha - want));
        }
      }
      clock = at;
      while (start + (k + 1) * h <= clock) {
        k++;
        truth = start + k * h;
        fn!(1 / 60, k);
      }
    }
    expect(worst).toBeLessThan(0.05);
  });

  test("on the tick: frames only draw, the tick steps (when it may), and a hidden tab's race goes on", () => {
    let clock = 0;
    let steps = 0;
    let may = true;
    const s = new Stepper(60, () => steps++, () => clock);
    s.frame(1 / 60, true);
    expect(steps).toBe(1);
    const t = fakeTick();
    s.useTick(t.tick, () => may);
    expect(s.ticking).toBe(true);
    expect(t.rate()).toBe(60);
    // No frames at all (the tab is hidden): two seconds of race.
    t.run(120);
    expect(steps).toBe(121);
    // A frame steps nothing now, and draws between the tick's steps.
    expect(s.frame(1, true)).toBe(0);
    clock += 1000 / 120;
    expect(s.frame(1 / 60, true)).toBeCloseTo(0.5);
    clock += 1000;
    expect(s.frame(1 / 60, true)).toBe(1);
    expect(steps).toBe(121);
    // The editor open: the tick holds.
    may = false;
    t.run(10);
    expect(steps).toBe(121);
    // A second useTick doesn't start a second loop; stop hands it back to frames.
    s.useTick(fakeTick().tick, () => true);
    s.stop();
    expect(t.running()).toBe(false);
    s.frame(1 / 60, true);
    expect(steps).toBe(122);
  });
});

describe("the race's clock online", () => {
  test('two pages loaded at different times have the same race time, so the same traffic', () => {
    const at = 10_000;
    const make = () => {
      const sim = citySim(4);
      sim.addCar({ cls: 'coupe', human: true });
      sim.startRace(1, 30);
      return sim;
    };
    const a = make();
    const b = make();
    // b's page loaded 1.3 s after a's: a has stepped that much more by the same server moment.
    let now = 0;
    for (let k = 0; k < 78; k++) {
      syncClock(a, at, now);
      a.step([neutralControls()]);
      now += 1000 / 60;
    }
    for (let k = 0; k < 600; k++) {
      syncClock(a, at, now);
      a.step([neutralControls()]);
      syncClock(b, at, now);
      b.step([neutralControls()]);
      now += 1000 / 60;
    }
    expect(a.race.phase).toBe('racing');
    expect(Math.abs(a.time - b.time)).toBeLessThan(1e-9);
    const tr = (s: Sim) => s.world.traffic.sAt(3, s.time);
    expect(tr(a)).toBeCloseTo(tr(b), 6);
    // On the server's clock: the race time is how long since green at `at` (the last sync, plus its step).
    expect(a.time - a.race.goTime).toBeCloseTo((now - 1000 / 60 - at) / 1000 + 1 / 60, 6);
  });

  test('racing: a little behind is slewed out, a lot behind is jumped, ahead goes back at most half a step', () => {
    const sim = ringSim(1);
    sim.addCar({ cls: 'coupe', human: true });
    sim.startRace(1, 3);
    sim.race.phase = 'racing';
    sim.race.goTime = 3;
    const at = 0;
    // Server says 2 s after green: race time 5.
    sim.time = 4.9;
    syncClock(sim, at, 2000);
    expect(sim.time).toBeCloseTo(4.905, 6);
    sim.time = 5 - CLOCK_SNAP - 0.1;
    syncClock(sim, at, 2000);
    expect(sim.time).toBe(5);
    sim.time = 6;
    syncClock(sim, at, 2000);
    expect(sim.time).toBeCloseTo(6 - sim.dt / 2, 9);
    // Free drive has no race clock.
    sim.race.phase = 'free';
    sim.time = 1;
    syncClock(sim, at, 2000);
    expect(sim.time).toBe(1);
  });
});

describe('traffic hits online', () => {
  /** Two screens of one race (ada in seat 0, bo in seat 1) with traffic, each with its traffic layer. */
  function pair() {
    const hub = new Hub();
    const make = (me: 'ada' | 'bo') => {
      const sim = citySim(4);
      sim.addCar(me === 'ada' ? { cls: 'coupe', human: true } : { cls: 'coupe', remote: true });
      sim.addCar(me === 'bo' ? { cls: 'coupe', human: true } : { cls: 'coupe', remote: true });
      sim.time = 40;
      return { sim, net: new NetTraffic(hub.room(me), sim, '4:0'), car: me === 'ada' ? 0 : 1 };
    };
    return { hub, ada: make('ada'), bo: make('bo') };
  }
  /** Car `i` wrecks traffic car k on this screen now (as collideWorld does). */
  const wreck = (p: { sim: Sim }, i: number, k: number) => {
    p.sim.world.traffic.wreckedAt[k] = p.sim.time;
    p.sim.events.push(p.sim.tick, Ev.TrafficWreck, i, 10, 0, 20, 12, 0, k);
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));

  test('your car wrecks one: you claim it, and every other screen wrecks it from your time (with its debris)', async () => {
    const { hub, ada, bo } = pair();
    wreck(ada, 0, 5);
    ada.net.afterStep();
    await settle();
    expect(hub.claims.get(ada.net.key(5))).toBe('ada');
    expect(hub.sent.map((e) => e.type)).toEqual([TRAFFIC_HIT]);
    expect(bo.sim.world.traffic.wreckedAt[5]).toBe(40);
    const seen: number[] = [];
    bo.sim.events.read(0, (e) => e.type === Ev.TrafficWreck && seen.push(e.other));
    expect(seen).toEqual([5]);
    // As it comes back (a second before it's solid), the claim goes.
    ada.sim.time = 40 + RELEASE_S - 0.01;
    ada.net.afterStep();
    expect(hub.claims.size).toBe(1);
    ada.sim.time = 40 + RELEASE_S;
    ada.net.afterStep();
    expect(hub.claims.size).toBe(0);
    expect(RELEASE_S).toBeLessThan(HOLD_S);
  });

  test('both screens wreck it: one claim wins, and both end with its time', async () => {
    const { hub, ada, bo } = pair();
    bo.sim.time = 40.05;
    wreck(ada, 0, 7);
    wreck(bo, 1, 7);
    ada.net.afterStep();
    bo.net.afterStep();
    await settle();
    expect(hub.sent).toHaveLength(1);
    expect(hub.sent[0].from).toBe('ada');
    expect(ada.sim.world.traffic.wreckedAt[7]).toBe(40);
    expect(bo.sim.world.traffic.wreckedAt[7]).toBe(40);
    // bo had its own debris already: none again.
    let n = 0;
    bo.sim.events.read(0, (e) => e.type === Ev.TrafficWreck && n++);
    expect(n).toBe(1);
  });

  test("not claimed: another player's car (their screen does), a hazard's (every screen does); a later wreck of the car stays", async () => {
    const { hub, ada, bo } = pair();
    wreck(ada, 1, 5);
    wreck(ada, -1, 6);
    ada.net.afterStep();
    await settle();
    expect(hub.sent).toHaveLength(0);
    // A hit from before bo's own later wreck of that car (it's been back since) doesn't undo it.
    bo.sim.world.traffic.wreckedAt[9] = 40 + HOLD_S + 2;
    bo.sim.time = 40 + HOLD_S + 3;
    ada.net['room'].emit(TRAFFIC_HIT, { k: 9, t: 40, x: 0, y: 0, z: 0, a: 5, b: 0 });
    expect(bo.sim.world.traffic.wreckedAt[9]).toBe(40 + HOLD_S + 2);
  });

  test("another screen's word is checked: a traffic car there is, a time near now, numbers", () => {
    const sim = citySim(4);
    sim.time = 40;
    const ok = { k: 3, t: 40.1, x: 1, y: 2, z: 3, a: 1e6, b: 1 as const };
    const read = (d: unknown) => readHit(d, sim.world.traffic.count, sim.time, HOLD_S);
    expect(read(ok)).toEqual({ ...ok, a: 100 });
    for (const bad of [null, 'x', { ...ok, k: -1 }, { ...ok, k: 1.5 }, { ...ok, k: sim.world.traffic.count }, { ...ok, t: 40 + HOLD_S + 1 }, { ...ok, x: NaN }, { ...ok, y: '2' }]) expect(read(bad)).toBeNull();
  });
});

describe('breakable walls online', () => {
  /** Two screens of one race, each with a 15 m wall of 6 panels (down for the race, or standing again after `again` s). */
  function pair(again?: number) {
    const hub = new Hub();
    const make = (me: 'ada' | 'bo') => {
      const sim = citySim(4);
      sim.addCar(me === 'ada' ? { cls: 'coupe', human: true } : { cls: 'coupe', remote: true });
      sim.addCar(me === 'bo' ? { cls: 'coupe', human: true } : { cls: 'coupe', remote: true });
      sim.world.breakables = new Breakables([{ id: 'w', look: 'boards', from: [0, 0, 0], to: [15, 0, 0], height: 3, breaks: 12, standsAgain: again }]);
      sim.time = 40;
      return { sim, net: new NetBreakables(hub.room(me), sim, '4:0') };
    };
    return { hub, ada: make('ada'), bo: make('bo') };
  }
  /** Car `i` breaks panel k on this screen now (as collideBreakables does). */
  const smash = (p: { sim: Sim }, i: number, k: number) => {
    p.sim.world.breakables.brokenAt[k] = p.sim.time;
    p.sim.events.push(p.sim.tick, Ev.WallBreak, i, 5, 1.5, 0, 30, k, -1);
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));

  test("your car breaks a panel: you claim it, every other screen has it down from your time (and bursts it), and it's held for the race", async () => {
    const { hub, ada, bo } = pair();
    smash(ada, 0, 2);
    ada.net.afterStep();
    await settle();
    expect(hub.claims.get(ada.net.key(2))).toBe('ada');
    expect(hub.sent.map((e) => e.type)).toEqual([WALL_BREAK]);
    expect(bo.sim.world.breakables.brokenAt[2]).toBe(40);
    expect(bo.sim.world.breakables.standing(2, 1e6)).toBe(false);
    const seen: number[] = [];
    bo.sim.events.read(0, (e) => e.type === Ev.WallBreak && seen.push(e.b));
    expect(seen).toEqual([2]);
    ada.sim.time = 1e5;
    ada.net.afterStep();
    expect(hub.claims.size).toBe(1);
    ada.net.close();
    expect(hub.claims.size).toBe(0);
  });

  test('both screens break it: one claim wins and both have its time; one that stands again lets go a second before', async () => {
    const { hub, ada, bo } = pair(20);
    bo.sim.time = 40.05;
    smash(ada, 0, 4);
    smash(bo, 1, 4);
    ada.net.afterStep();
    bo.net.afterStep();
    await settle();
    expect(hub.sent).toHaveLength(1);
    expect(bo.sim.world.breakables.brokenAt[4]).toBe(40);
    let n = 0;
    bo.sim.events.read(0, (e) => e.type === Ev.WallBreak && n++);
    expect(n).toBe(1);
    ada.sim.time = 40 + 19 - 0.01;
    ada.net.afterStep();
    expect(hub.claims.size).toBe(1);
    ada.sim.time = 40 + 19;
    ada.net.afterStep();
    expect(hub.claims.size).toBe(0);
  });

  test("not claimed: another player's car's break (their screen does); a word that isn't a panel, or isn't now, is dropped", async () => {
    const { hub, ada, bo } = pair();
    smash(ada, 1, 1);
    ada.net.afterStep();
    await settle();
    expect(hub.sent).toHaveLength(0);
    for (const bad of [{ k: 6, t: 40 }, { k: 1, t: 40 + NEWS_S + 1 }, { k: -1, t: 40 }]) ada.net['room'].emit(WALL_BREAK, { ...bad, x: 0, y: 0, z: 0, a: 5, b: 0 });
    expect([...bo.sim.world.breakables.brokenAt].every((t) => t === -Infinity)).toBe(true);
  });
});

describe('contact between screens', () => {
  /** ada's and bo's screens, each moving its own car (ada car 0, bo car 1), side by side on a ring. */
  function pair() {
    const hub = new Hub();
    const make = (me: 'ada' | 'bo') => {
      const sim = ringSim(1);
      sim.addCar(me === 'ada' ? { cls: 'coupe', human: true } : { cls: 'coupe', remote: true });
      sim.addCar(me === 'bo' ? { cls: 'coupe', human: true } : { cls: 'coupe', remote: true });
      sim.startRace(1, 0.1);
      for (let k = 0; k < 30; k++) sim.step([neutralControls(), neutralControls()]);
      const c = sim.cars;
      c.active[0] = c.active[1] = 1;
      // ada's car at x 0, bo's 2 m to its right (+x), both still.
      [c.x[0], c.z[0], c.x[1], c.z[1]] = [0, 0, 2, 0];
      for (const i of [0, 1]) c.vx[i] = c.vz[i] = 0;
      const myIdx = me === 'ada' ? 0 : 1;
      const other = me === 'ada' ? 'bo' : 'ada';
      const net = new NetContact(hub.room(me), sim, carNames(myIdx, me, new Map([[other, 1 - myIdx]]), new Map()));
      return { sim, net };
    };
    return { hub, ada: make('ada'), bo: make('bo') };
  }
  /** On this screen, car a ran into car b at `closing` m/s (as resolve() reports it). */
  const touch = (p: { sim: Sim }, a: number, b: number, closing: number) => {
    const c = p.sim.cars;
    [c.lastHitBy[a], c.lastHitBy[b], c.lastHitT[a], c.lastHitT[b]] = [b, a, p.sim.tick - 1, p.sim.tick - 1];
    p.sim.events.push(p.sim.tick, Ev.CarContact, a, 1, 0.5, 0, closing, 1, b);
  };
  /** A fifth of a second on, on this screen: past the window for seeing a contact too. */
  const later = (p: { sim: Sim; net: NetContact }) => {
    p.sim.time += 0.2;
    p.net.afterStep();
  };

  test('a bump only your screen saw reaches their car: pushed away from yours, once', () => {
    const { hub, ada, bo } = pair();
    touch(ada, 0, 1, 6);
    ada.net.afterStep();
    ada.net.afterStep();
    expect(hub.sent.filter((e) => e.type === BUMP)).toHaveLength(1);
    // Held for the window first: bo's sim might see it itself.
    bo.net.afterStep();
    expect(bo.sim.cars.vx[1]).toBe(0);
    later(bo);
    expect(bo.sim.cars.vx[1]).toBeGreaterThan(1);
    expect(Math.abs(bo.sim.cars.vz[1])).toBeLessThan(1e-9);
    // Applied there, it isn't sent back.
    bo.net.afterStep();
    expect(hub.sent.filter((e) => e.type === BUMP)).toHaveLength(1);
  });

  test("a contact both screens saw is pushed once on each: neither applies the other's bump (whichever came first)", () => {
    const { ada, bo } = pair();
    // bo's sim saw it first, and its bump reached ada before ada's sim saw it too.
    touch(bo, 0, 1, 6);
    bo.net.afterStep();
    touch(ada, 0, 1, 6);
    ada.net.afterStep();
    later(ada);
    later(bo);
    expect(bo.sim.cars.vx[1]).toBe(0);
    expect(ada.sim.cars.vx[0]).toBe(0);
  });

  test('hit hard by their car, yours wrecks on your screen, and theirs gets the takedown on theirs', () => {
    const { hub, ada, bo } = pair();
    touch(ada, 0, 1, 45);
    ada.net.afterStep();
    later(bo);
    expect(bo.sim.cars.wreck[1]).toBe(1);
    // bo's screen decided it: it tells ada's.
    bo.net.afterStep();
    expect(hub.sent.filter((e) => e.type === TAKEDOWN).map((e) => e.data)).toEqual([{ victim: 'p:bo', by: 'p:ada', t: bo.sim.time }]);
    expect(ada.sim.cars.takedowns[0]).toBe(1);
    expect(ada.sim.cars.score[0]).toBeGreaterThan(0);
    const got: number[] = [];
    ada.sim.events.read(0, (e) => e.type === Ev.Takedown && got.push(e.car));
    expect(got).toEqual([0]);
  });

  /** One step on this screen, with (or without) its sim resolving a contact between cars a and b. */
  const stepTouching = (p: { sim: Sim; net: NetContact }, contact: [number, number] | null, closing = 6) => {
    p.sim.time += 1 / 60;
    p.sim.tick++;
    if (contact) touch(p, contact[0], contact[1], closing);
    p.net.afterStep();
  };

  test('grinding side by side, both screens resolving it every step: the other screen\'s bumps are never added on', () => {
    const { hub, ada, bo } = pair();
    for (let k = 0; k < 60; k++) {
      stepTouching(ada, [0, 1]);
      stepTouching(bo, [0, 1]);
    }
    expect(hub.sent.filter((e) => e.type === BUMP).length).toBeGreaterThan(10);
    expect(bo.sim.cars.vx[1]).toBe(0);
    expect(ada.sim.cars.vx[0]).toBe(0);
  });

  test('a gentle contact (no event) still counts as seen', () => {
    const { ada, bo } = pair();
    stepTouching(ada, [0, 1]);
    // bo's sim resolved it too, too gently for an event: only lastHitT says so.
    bo.sim.time = ada.sim.time;
    bo.sim.tick++;
    [bo.sim.cars.lastHitBy[1], bo.sim.cars.lastHitT[1]] = [0, bo.sim.tick - 1];
    bo.net.afterStep();
    for (let k = 0; k < 15; k++) stepTouching(bo, null);
    expect(bo.sim.cars.vx[1]).toBe(0);
  });

  test("a long push only your screen sees reaches theirs in full: every bump, not every other", () => {
    const { hub, ada, bo } = pair();
    bo.sim.time = ada.sim.time;
    const pushes: number[] = [];
    for (let k = 0; k < 90; k++) {
      stepTouching(ada, [0, 1]);
      const before = bo.sim.cars.vx[1];
      stepTouching(bo, null);
      if (bo.sim.cars.vx[1] !== before) pushes.push(k);
    }
    const sent = hub.sent.filter((e) => e.type === BUMP && e.from === 'ada').length;
    // The last one or two are still held when it stops.
    expect(pushes.length).toBeGreaterThanOrEqual(sent - 2);
    expect(sent).toBeGreaterThan(4);
  });

  test("other screens' word is checked: from the car's owner, to your own car, capped, near now", () => {
    const { hub, bo } = pair();
    const ada = hub.room('ada');
    const carl = hub.room('carl');
    // About bo's own car, from "bo's car": not ada's to say. From carl, about ada's car: not carl's.
    ada.emit(BUMP, { to: 'p:bo', by: 'p:bo', t: bo.sim.time, dvx: 5, dvz: 0, closing: 5, att: false }, { to: 'bo' });
    carl.emit(BUMP, { to: 'p:bo', by: 'p:ada', t: bo.sim.time, dvx: 5, dvz: 0, closing: 5, att: false }, { to: 'bo' });
    // To ada's car, on bo's screen (not bo's to move).
    ada.emit(BUMP, { to: 'p:ada', by: 'p:bo', t: bo.sim.time, dvx: 5, dvz: 0, closing: 5, att: false }, { to: 'bo' });
    // Long ago, or not numbers.
    ada.emit(BUMP, { to: 'p:bo', by: 'p:ada', t: bo.sim.time - 10, dvx: 5, dvz: 0, closing: 5 }, { to: 'bo' });
    ada.emit(BUMP, { to: 'p:bo', by: 'p:ada', t: bo.sim.time, dvx: 'x', dvz: 0, closing: 5 }, { to: 'bo' });
    // A takedown for bo's car, said by someone who isn't the victim's owner.
    carl.emit(TAKEDOWN, { victim: 'p:ada', by: 'p:bo', t: bo.sim.time }, { to: 'bo' });
    later(bo);
    expect(bo.sim.cars.vx[1]).toBe(0);
    expect(bo.sim.cars.vx[0]).toBe(0);
    expect(bo.sim.cars.takedowns[1]).toBe(0);
    // A huge one is capped.
    ada.emit(BUMP, { to: 'p:bo', by: 'p:ada', t: bo.sim.time, dvx: 1e6, dvz: 0, closing: 5, att: false }, { to: 'bo' });
    later(bo);
    expect(bo.sim.cars.vx[1]).toBeCloseTo(30, 6);
  });
});

describe("the race's messages, checked (net/wire.ts)", () => {
  test('a bump: two different cars, numbers, the closing speed capped', () => {
    const ok = { to: 'p:bo', by: 'p:ada', t: 3, dvx: 1, dvz: -2, closing: 1e6, att: true };
    expect(readBump(ok)).toEqual({ ...ok, closing: MAX_CLOSING });
    expect(readBump({ ...ok, att: 'yes' })?.att).toBe(false);
    // A player id is up to 64 characters, so a car's name (`p:` and the id) up to 66.
    const long = `p:${'x'.repeat(64)}`;
    expect(readBump({ ...ok, by: long })?.by).toBe(long);
    expect(readTakedown({ victim: long, by: 's:3', t: 1 })?.victim).toBe(long);
    for (const bad of [null, [], { ...ok, to: '' }, { ...ok, by: 'p:bo' }, { ...ok, by: 'x'.repeat(67) }, { ...ok, dvx: Infinity }, { ...ok, t: '3' }]) expect(readBump(bad)).toBeNull();
  });

  test('a takedown: a victim, another car, a time', () => {
    expect(readTakedown({ victim: 'p:bo', by: 's:3', t: 1 })).toEqual({ victim: 'p:bo', by: 's:3', t: 1 });
    for (const bad of [{ victim: 'p:bo', by: 'p:bo', t: 1 }, { victim: 'p:bo', by: 's:3' }, { victim: 7, by: 's:3', t: 1 }]) expect(readTakedown(bad)).toBeNull();
  });

  test("a rival's handover: each field in its range, or this screen's", () => {
    expect(readHandover('lastSpline', 2, 3)).toBe(2);
    expect(readHandover('lastSpline', 3, 3)).toBeNull();
    expect(readHandover('wreckCause', Cause.Car, 3)).toBe(Cause.Car);
    expect(readHandover('wreckCause', 99, 3)).toBeNull();
    expect(readHandover('boost', 5, 3)).toBe(1);
    expect(readHandover('wreckT', -1, 3)).toBe(0);
    expect(readHandover('wx', 1e9, 3)).toBe(1e4);
    expect(readHandover('wx', 'x', 3)).toBeNull();
  });
});

describe("a getaway runner's end, on their car", () => {
  test('read as wrecked (1) or busted (2) with the time lasted; anything else is still going, or nonsense', () => {
    expect(readRunEnd(1, 61.25)).toEqual({ end: 'wrecked', time: 61.25 });
    expect(readRunEnd(2, 5)).toEqual({ end: 'busted', time: 5 });
    expect(readRunEnd(0, 30)).toBeNull();
    expect(readRunEnd(3, 30)).toBeNull();
    expect(readRunEnd(1.5, 30)).toBeNull();
    expect(readRunEnd(1, -1)).toBeNull();
    expect(readRunEnd(1, NaN)).toBeNull();
    expect(readRunEnd(1, 1e9)).toBeNull();
    expect(readRunEnd('1', 30)).toBeNull();
  });

  test("a cop's target is one of the runners, or nothing", () => {
    expect(readTarget(2, [0, 1, 2])).toBe(2);
    expect(readTarget(5, [0, 1, 2])).toBeNull();
    expect(readTarget(1.5, [0, 1, 2])).toBeNull();
    expect(readTarget('1', [0, 1, 2])).toBeNull();
  });

  test("your run's end goes out on your car, and theirs ends their run on your screen", () => {
    const hub = new Hub();
    const city = layout('heist/city');
    const make = (meSeat: 0 | 1) => {
      const sim = new SimClass(bakeTrack(city, SURFACES), CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off', weather: 'clear' });
      const ids = ['ada', 'bo'];
      sim.addCar(meSeat === 0 ? { cls: 'coupe', human: true } : { cls: 'coupe', human: true, remote: true });
      sim.addCar(meSeat === 1 ? { cls: 'coupe', human: true } : { cls: 'coupe', human: true, remote: true });
      const g = new Getaway(sim, [0, 1]);
      sim.startRace(3, 0.05);
      const net = new NetCars(hub.room(ids[meSeat]), () => hub.now, sim, meSeat, new Map([[ids[1 - meSeat], 1 - meSeat]]));
      return { sim, g, net, me: meSeat };
    };
    const ada = make(0);
    const bo = make(1);
    const both = () => {
      for (const p of [ada, bo]) {
        p.net.beforeStep();
        p.sim.step([]);
        p.net.afterStep();
      }
    };
    while (ada.g.heat === 0 || bo.g.heat === 0) both();
    for (let k = 0; k < 30; k++) both();
    wreckCar(ada.sim, 0, Cause.Wall, 0, 0, -1);
    both();
    expect(ada.g.runs[0].end).toBe('wrecked');
    both();
    expect(bo.g.runs[0].end).toBe('wrecked');
    expect(bo.g.runs[0].time).toBeCloseTo(ada.g.runs[0].time, 2);
    expect(bo.g.runs[1].end).toBeNull();
  });
});

/** Ada and Bo as getaway runners on Splash City, each a screen with the other remote (not stepped yet). */
function getawayPair() {
  const hub = new Hub();
  const city = layout('heist/city');
  const make = (meSeat: 0 | 1) => {
    const sim = new SimClass(bakeTrack(city, SURFACES), CLASSES, SURFACES, { seed: 1, traffic: 0, mayhem: 'off', weather: 'clear' });
    const ids = ['ada', 'bo'];
    sim.addCar(meSeat === 0 ? { cls: 'coupe', human: true } : { cls: 'coupe', human: true, remote: true });
    sim.addCar(meSeat === 1 ? { cls: 'coupe', human: true } : { cls: 'coupe', human: true, remote: true });
    const g = new Getaway(sim, [0, 1]);
    sim.startRace(3, 0.05);
    return { sim, g, room: hub.room(ids[meSeat]), other: ids[1 - meSeat], me: meSeat };
  };
  return { hub, ada: make(0), bo: make(1) };
}

describe("a getaway runner's end, from the review (2026-10-09)", () => {
  type Side = ReturnType<typeof getawayPair>['ada'];
  const netOf = (hub: Hub, p: Side) => new NetCars(p.room, () => hub.now, p.sim, p.me, new Map([[p.other, 1 - p.me]]));
  const run = (p: Side, net: NetCars) => {
    net.beforeStep();
    p.sim.step([]);
    net.afterStep();
  };

  test("a car left from the last race saying it's out doesn't end this race's run", () => {
    const { hub, bo } = getawayPair();
    // Ada's page from the last race, still in the room: her car says she was busted.
    hub.entities.push({ kind: 'car', owner: 'ada', fields: { x: bo.sim.cars.x[0], y: bo.sim.cars.y[0], z: bo.sim.cars.z[0], out: 2, runT: 50 }, teleports: 0, removed: false });
    const net = netOf(hub, bo);
    while (bo.g.heat === 0) run(bo, net);
    for (let k = 0; k < 60; k++) run(bo, net);
    expect(bo.g.runs[0].end).toBeNull();
  });

  test("a runner never seen is out a few seconds after green, at no time lasted", () => {
    const { hub, bo } = getawayPair();
    const net = netOf(hub, bo);
    while (bo.g.heat === 0) run(bo, net);
    for (let k = 0; k < 60 * 4; k++) run(bo, net);
    expect(bo.g.runs[0]).toMatchObject({ end: 'wrecked', time: 0 });
  });

  test("a runner gone for a moment and back is still going", () => {
    const { hub, ada, bo } = getawayPair();
    const an = netOf(hub, ada);
    const bn = netOf(hub, bo);
    while (ada.g.heat === 0 || bo.g.heat === 0) run(ada, an), run(bo, bn);
    for (let k = 0; k < 60; k++) run(ada, an), run(bo, bn);
    const car = hub.entities.find((e) => e.kind === 'car' && e.owner === 'ada')!;
    car.removed = true;
    for (let k = 0; k < 60; k++) run(ada, an), run(bo, bn);
    car.removed = false;
    for (let k = 0; k < 60; k++) run(ada, an), run(bo, bn);
    expect(bo.g.runs[0].end).toBeNull();
  });
});
