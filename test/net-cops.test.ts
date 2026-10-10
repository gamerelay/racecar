// The cops online (docs/superpowers/specs/2026-10-09-online-getaway-design.md): the room's host
// drives every runner's cops and sends them as `cop` entities; everyone else has them where the
// host's sim puts them. These run two screens through the stand-in room.

import { describe, expect, test } from 'bun:test';
import { Getaway } from '../src/core/rules/getaway';
import { Sim } from '../src/core/sim';
import { bakeTrack } from '../src/core/track/bake';
import { NetCars } from '../src/net/cars';
import { NetCops } from '../src/net/cops';
import { carNames } from '../src/net/contact';
import { CLASSES, SURFACES, layout } from './helpers';
import { Hub } from './hub';

const city = layout('heist/city');

/** Ada (seat 0) and Bo (seat 1), each a runner on their own screen with the other remote, and the cops. */
function chase() {
  const hub = new Hub();
  const make = (meSeat: 0 | 1) => {
    const sim = new Sim(bakeTrack(city, SURFACES), CLASSES, SURFACES, { seed: 7, traffic: 0, mayhem: 'off', weather: 'clear' });
    const ids = ['ada', 'bo'];
    sim.addCar(meSeat === 0 ? { cls: 'coupe', human: true } : { cls: 'coupe', human: true, remote: true });
    sim.addCar(meSeat === 1 ? { cls: 'coupe', human: true } : { cls: 'coupe', human: true, remote: true });
    const g = new Getaway(sim, [0, 1]);
    sim.startRace(3, 0.05);
    const room = hub.room(ids[meSeat]);
    const net = new NetCars(room, () => hub.now, sim, meSeat, new Map([[ids[1 - meSeat], 1 - meSeat]]));
    const cops = new NetCops(room, () => hub.now, sim, 'r1');
    return { sim, g, net, cops };
  };
  return { hub, ada: make(0), bo: make(1) };
}

type Screen = ReturnType<typeof chase>['ada'];

function step(p: Screen): void {
  p.net.beforeStep();
  p.cops.beforeStep();
  p.sim.step([]);
  p.net.afterStep();
  p.cops.afterStep();
}

const copsIn = (hub: Hub) => hub.entities.filter((e) => e.kind === 'cop' && !e.removed);
const gap = (a: Sim, b: Sim, i: number) => Math.hypot(a.cars.x[i] - b.cars.x[i], a.cars.z[i] - b.cars.z[i]);

describe('cops online', () => {
  test("the host drives every cop, and the other screen has them where the host's sim puts them", () => {
    const { hub, ada, bo } = chase();
    for (let k = 0; k < 300; k++) step(ada), step(bo);
    // One entity a cop, the host's, for every runner's pool.
    expect(copsIn(hub)).toHaveLength(ada.g.cops.length);
    expect(copsIn(hub).every((e) => e.owner === 'host')).toBe(true);
    const active = ada.g.cops.filter((i) => ada.sim.cars.active[i]);
    expect(active.length).toBeGreaterThanOrEqual(4);
    for (const i of ada.g.cops) {
      expect(ada.sim.cars.remote[i]).toBe(0);
      expect(bo.sim.cars.remote[i]).toBe(1);
      expect(bo.sim.cars.active[i]).toBe(ada.sim.cars.active[i]);
    }
    // Bo's copy of each is Ada's, a step behind at most.
    for (const i of active) expect(gap(ada.sim, bo.sim, i)).toBeLessThan(Math.hypot(ada.sim.cars.vx[i], ada.sim.cars.vz[i]) / 60 + 0.05);
    // And who each is after, so a new host carries on.
    for (const i of active) expect(bo.sim.cops[i]!.target).toBe(ada.sim.cops[i]!.target);
  });

  test("until the host's cops show up, every screen drives them itself, from the same start", () => {
    const { hub, ada, bo } = chase();
    hub.host = 'nobody';
    for (let k = 0; k < 300; k++) step(ada), step(bo);
    expect(copsIn(hub)).toHaveLength(0);
    for (const i of ada.g.cops) expect(bo.sim.cars.remote[i]).toBe(0);
    const active = ada.g.cops.filter((i) => ada.sim.cars.active[i]);
    expect(active.length).toBeGreaterThanOrEqual(4);
    // The same cops called out to the same places (the runners parked on both screens).
    for (const i of active) expect(gap(ada.sim, bo.sim, i)).toBeLessThan(0.5);
  });

  test('when the host role moves, the next host drives them on from where they are: no new cops, no jump', () => {
    const { hub, ada, bo } = chase();
    for (let k = 0; k < 300; k++) step(ada), step(bo);
    const before = copsIn(hub).length;
    const i = ada.g.cops.find((j) => ada.sim.cars.active[j])!;
    const was = { x: bo.sim.cars.x[i], z: bo.sim.cars.z[i] };
    hub.host = 'bo';
    step(bo);
    expect(bo.sim.cars.remote[i]).toBe(0);
    expect(Math.hypot(bo.sim.cars.x[i] - was.x, bo.sim.cars.z[i] - was.z)).toBeLessThan(2);
    for (let k = 0; k < 60; k++) step(ada), step(bo);
    expect(copsIn(hub)).toHaveLength(before);
    expect(ada.sim.cars.remote[i]).toBe(1);
  });

  test("the host's gone mid-chase: the next host takes the gone runner's cops off (review, 2026-10-09)", () => {
    const { hub, ada, bo } = chase();
    for (let k = 0; k < 120; k++) step(ada), step(bo);
    expect(bo.g.runs[0].cops.some((i) => bo.sim.cars.active[i])).toBe(true);
    // Ada's page goes: her car with it, and the host role to Bo.
    for (const e of hub.entities) if (e.kind === 'car' && e.owner === 'ada') e.removed = true;
    hub.host = 'bo';
    for (let k = 0; k < 60 * 4; k++) step(bo);
    expect(bo.g.runs[0].end).toBe('wrecked');
    expect(bo.g.runs[0].cops.some((i) => bo.sim.cars.active[i])).toBe(false);
  });

  test("a cop's name is its place among the getaway's cops, the host's to tell", () => {
    const names = carNames(0, 'ada', new Map([['bo', 1]]), new Map(), [2, 3, 4]);
    expect(names.name(3)).toBe('c:1');
    expect(names.index('c:2')).toBe(4);
  });
});
