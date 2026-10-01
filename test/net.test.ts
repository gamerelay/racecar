import { describe, expect, test } from 'bun:test';
import { neutralControls } from '../src/core/controls';
import type { Sim } from '../src/core/sim';
import { createLobby, apply, encodeSeats, othersIn, roster, type Lobby } from '../src/lobby/lobby';
import { NetCars, predict, startDelay, type NetEntity, type NetKind, type NetRoom } from '../src/net/cars';
import { raceFromLobby, readSetup, toQuery } from '../src/ui/setup';
import { CLASSES, ringSim } from './helpers';

// Remote cars (milestone 3): each player owns their car and sends it as an entity; everyone else
// has it as a remote car in their sim, put where the entity says (predicted to now) before each
// step. These run two sims through a stand-in for the SDK's entities.

/** A room's entities, shared by every player's view of it: the SDK, minus the network. */
class Hub {
  entities: { owner: string; fields: Record<string, unknown>; teleports: number; removed: boolean }[] = [];
  renderTime = 0;
  now = 0;
  room(me: string): NetRoom {
    const hub = this;
    return {
      me,
      get renderTime() {
        return hub.renderTime;
      },
      define(): NetKind {
        const view = (e: Hub['entities'][number]): NetEntity =>
          new Proxy(
            { owner: { id: e.owner }, mine: e.owner === me, teleport: () => e.teleports++, remove: () => (e.removed = true) },
            {
              get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : e.fields[k as string]),
              set: (_t, k, v) => ((e.fields[k as string] = v), true),
            },
          ) as unknown as NetEntity;
        return {
          spawn(initial) {
            const e = { owner: me, fields: { ...initial }, teleports: 0, removed: false };
            hub.entities.push(e);
            return view(e);
          },
          all: () => hub.entities.filter((e) => !e.removed).map(view),
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
    const boCar = hub.entities.find((e) => e.owner === 'bo')!;
    boCar.removed = true;
    step(ada);
    expect(ada.sim.cars.active[1]).toBe(0);
    boCar.removed = false;
    step(bo);
    step(ada);
    expect(ada.sim.cars.active[1]).toBe(1);
    hub.entities.find((e) => e.owner === 'bo')!.removed = true;
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
    expect(hub.entities.find((e) => e.owner === 'ada')!.teleports).toBe(1);

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
    expect(r.specs[1]).toEqual({ cls: 'muscle', paint: 3, remote: true });
    expect(r.names[1]).toBe('BO');
    expect(r.remote.get('bo')).toBe(1);
    // Bo's view: Ada is the remote one, in seat 0.
    const b = roster(encodeSeats(l, 'bo', true), ids, 8, { car: 'muscle', paint: 3, plate: 'BO' }, othersIn(l, 'bo'));
    expect(b.me).toBe(1);
    expect(b.remote.get('ada')).toBe(0);
  });

  test('a link with a bad `others` is a race without them', () => {
    const q = new URLSearchParams({ mode: 'race', seats: 'proooooo', others: '[[9,"x","y",1,"Z"],"junk"]' });
    expect(readSetup(q, 'downtown/downtown')?.others).toBeUndefined();
    const r = roster('proooooo', ids, 8, { car: 'coupe', paint: 0 });
    expect(r.specs).toHaveLength(7);
  });
});
