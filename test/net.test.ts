import { describe, expect, test } from 'bun:test';
import { neutralControls } from '../src/core/controls';
import type { Sim } from '../src/core/sim';
import { createLobby, apply, encodeSeats, othersIn, roster, type Lobby } from '../src/lobby/lobby';
import { NetCars, predict, remoteSteer, startDelay, type NetEntity, type NetKind, type NetRoom } from '../src/net/cars';
import { NetRivals } from '../src/net/rivals';
import { FALLBACK_MS, joinRace, type RaceJoin } from '../src/net/join';
import { MAX_STEPS, Stepper, type Tick } from '../src/net/stepper';
import { wreckCar } from '../src/core/car/physics';
import { Cause } from '../src/core/events';
import { raceFromLobby, readSetup, toQuery } from '../src/ui/setup';
import { CLASSES, ringSim } from './helpers';

// Remote cars (milestone 3): each player owns their car and sends it as an entity; everyone else
// has it as a remote car in their sim, put where the entity says (predicted to now) before each
// step. These run two sims through a stand-in for the SDK's entities.

/** A room's entities, shared by every player's view of it: the SDK, minus the network. */
class Hub {
  entities: { kind: string; owner: string; fields: Record<string, unknown>; teleports: number; removed: boolean }[] = [];
  renderTime = 0;
  now = 0;
  /** Who holds the host role: host entities are theirs to write. */
  host = 'ada';
  room(me: string): NetRoom {
    const hub = this;
    return {
      me,
      get isHost() {
        return hub.host === me;
      },
      get hostId() {
        return hub.host;
      },
      get renderTime() {
        return hub.renderTime;
      },
      define(kind: string): NetKind {
        const mine = (e: Hub['entities'][number]) => e.owner === me || (e.owner === 'host' && hub.host === me);
        const view = (e: Hub['entities'][number]): NetEntity =>
          new Proxy(
            { owner: { id: e.owner === 'host' ? hub.host : e.owner }, mine: mine(e), teleport: () => e.teleports++, remove: () => (e.removed = true) },
            {
              get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : e.fields[k as string]),
              set: (_t, k, v) => ((e.fields[k as string] = v), true),
            },
          ) as unknown as NetEntity;
        const live = () => hub.entities.filter((e) => e.kind === kind && !e.removed);
        return {
          spawn(initial, options) {
            const e = { kind, owner: options?.owner === 'host' ? 'host' : me, fields: { ...initial }, teleports: 0, removed: false };
            hub.entities.push(e);
            return view(e);
          },
          all: () => live().map(view),
          mine: () => live().filter(mine).map(view),
        };
      },
    };
  }
}

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
    const got: { net: unknown; rivals: unknown; tick: Tick | null } = { net: null, rivals: null, tick: null };
    const j: RaceJoin = {
      lobby: async () => (await opts.slow, opts.lobby === undefined ? { id: 'K7QM' } : opts.lobby),
      connection: async () => ({ room: opts.room === false ? null : hub.room('ada'), now: () => hub.now, tick: opts.tick }),
      sim,
      me: 0,
      remote: new Map(),
      aiSeats: new Map([[1, 1]]),
      seed: 7,
      at: opts.at,
      onNet: (net, rivals, tick) => Object.assign(got, { net, rivals, tick }),
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
  });

  test("with the link's time, green is the server clock's (not 3 s on); without AIs, no rivals", async () => {
    const p = page({ at: 5_000 });
    p.j.aiSeats = new Map();
    p.hub.now = 1_000;
    await joinRace(p.j);
    expect(p.got.rivals).toBeNull();
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
